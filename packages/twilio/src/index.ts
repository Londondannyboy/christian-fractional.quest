import "dotenv/config";

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { agent } from "@voice-sandwich-demo/graphs";
import {
  AssemblyAISTTTransform,
  AgentTransform,
  AIMessageChunkTransform,
  ElevenLabsTTSTransform,
  LangChainAudioReadableStream,
  PipelineVisualizer,
} from "@voice-sandwich-demo/web";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { MulawToPcmTransform } from "./MulawToPcmTransform.js";
import { PcmToMulawTransform } from "./PcmToMulawTransform.js";
import { ThinkingFillerTransform } from "./ThinkingFillerTransform.js";

/**
 * Twilio Media Stream message types
 */
interface TwilioConnectedMessage {
  event: "connected";
  protocol: string;
  version: string;
}

interface TwilioStartMessage {
  event: "start";
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  streamSid: string;
}

interface TwilioMediaMessage {
  event: "media";
  sequenceNumber: string;
  media: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64-encoded audio
  };
  streamSid: string;
}

interface TwilioStopMessage {
  event: "stop";
  sequenceNumber: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
  streamSid: string;
}

interface TwilioMarkMessage {
  event: "mark";
  sequenceNumber: string;
  mark: {
    name: string;
  };
  streamSid: string;
}

type TwilioMessage =
  | TwilioConnectedMessage
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioStopMessage
  | TwilioMarkMessage;

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("/*", cors());

// Shared pipeline visualizer for debugging
const pipelineVisualizer = new PipelineVisualizer();

/**
 * TwiML webhook endpoint - Twilio calls this when an incoming call arrives.
 * Returns TwiML that instructs Twilio to connect to our WebSocket for audio streaming.
 */
app.post("/voice", (c) => {
  const host = c.req.header("host") || "localhost:3002";
  const protocol = host.includes("localhost") ? "ws" : "wss";

  // TwiML response that connects the call to our WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${protocol}://${host}/media-stream">
      <Parameter name="caller" value="twilio-call" />
    </Stream>
  </Connect>
</Response>`;

  c.header("Content-Type", "application/xml");
  return c.body(twiml);
});

/**
 * Alternative TwiML endpoint using GET (for testing)
 */
app.get("/voice", (c) => {
  const host = c.req.header("host") || "localhost:3002";
  const protocol = host.includes("localhost") ? "ws" : "wss";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${protocol}://${host}/media-stream">
      <Parameter name="caller" value="twilio-call" />
    </Stream>
  </Connect>
</Response>`;

  c.header("Content-Type", "application/xml");
  return c.body(twiml);
});

// Pipeline visualizer WebSocket endpoint (for debugging)
app.get(
  "/ws/pipeline",
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      console.log("Pipeline visualizer connected");
      pipelineVisualizer.setWebSocket(ws);
    },
    onClose() {
      console.log("Pipeline visualizer disconnected");
      pipelineVisualizer.clearWebSocket();
    },
  }))
);

/**
 * Twilio Media Stream WebSocket endpoint
 * This is where the bidirectional audio streaming happens
 */
app.get(
  "/media-stream",
  upgradeWebSocket(() => {
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let controller: ReadableStreamDefaultController<Buffer>;
    let pipelineClosed = false;
    // Store WebSocket reference for sending audio back to Twilio
    let twilioWs: { send: (data: string) => void; readyState: number } | null =
      null;

    // Track if hang up has been requested
    let pendingHangUp: string | null = null;

    // Sequence counter for outgoing media
    let mediaSequence = 0;

    /**
     * Send audio back to Twilio
     */
    function sendAudioToTwilio(mulawBuffer: Buffer) {
      if (!twilioWs || twilioWs.readyState !== 1 || !streamSid) return;

      const payload = mulawBuffer.toString("base64");
      const message = JSON.stringify({
        event: "media",
        streamSid,
        media: {
          payload,
        },
      });

      twilioWs.send(message);
      mediaSequence++;
    }

    /**
     * Send a mark event to Twilio (for tracking when audio finishes playing)
     */
    function sendMarkToTwilio(name: string) {
      if (!twilioWs || twilioWs.readyState !== 1 || !streamSid) return;

      const message = JSON.stringify({
        event: "mark",
        streamSid,
        mark: { name },
      });

      twilioWs.send(message);
    }

    /**
     * Clear the audio buffer on the client side (for barge-in)
     */
    function clearTwilioAudioBuffer() {
      if (!twilioWs || twilioWs.readyState !== 1 || !streamSid) return;

      const message = JSON.stringify({
        event: "clear",
        streamSid,
      });

      twilioWs.send(message);
    }

    /**
     * Close the call gracefully
     */
    function closeCall(reason: string) {
      console.log(`Twilio: Closing call - ${reason}`);
      pipelineClosed = true;

      // Send a final mark before closing
      sendMarkToTwilio("call-ended");

      // Close the stream
      try {
        controller.close();
      } catch {
        // Ignore if already closed
      }
    }

    // Create TTS transform with barge-in and audio complete support
    const ttsTransform = new ElevenLabsTTSTransform({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID!,
      onInterrupt: () => {
        console.log("Twilio: TTS interrupted (barge-in), clearing audio buffer");
        clearTwilioAudioBuffer();
      },
      onAudioComplete: () => {
        console.log("Twilio: TTS audio complete");
        sendMarkToTwilio("audio-complete");

        // Check if we have a pending hang up
        if (pendingHangUp) {
          console.log(`Twilio: Executing pending hang up - ${pendingHangUp}`);
          closeCall(pendingHangUp);
          pendingHangUp = null;
        }
      },
    });

    // Create thinking filler transform for natural conversations
    const fillerTransform = new ThinkingFillerTransform({
      thresholdMs: 1200,
      fillerPhrases: [
        "Let me see here...",
        "Hmm, one moment...",
        "Ah, let me check...",
        "Just a second...",
        "Mhm, okay...",
      ],
      maxFillersPerTurn: 1,
      onFillerEmitted: (phrase) => {
        console.log(`Twilio: Thinking filler emitted - "${phrase}"`);
      },
    });

    // Create STT transform with barge-in support
    const sttTransform = new AssemblyAISTTTransform({
      apiKey: process.env.ASSEMBLYAI_API_KEY!,
      sampleRate: 16000, // We upsample from 8kHz to 16kHz
      onSpeechStart: () => {
        console.log("Twilio: User started speaking (barge-in), interrupting TTS");
        ttsTransform.interrupt();
        fillerTransform.cancelPendingFiller();
      },
    });

    // Create the input stream for audio from Twilio
    const inputStream = new ReadableStream<Buffer>({
      start(c) {
        controller = c;
      },
    });

    // Observable stream for pipeline visualization
    const observableStream = new LangChainAudioReadableStream(inputStream, {
      visualizer: pipelineVisualizer,
      turnIdleThresholdMs: 1000,
    });

    // Named passthrough to notify filler transform when agent starts processing
    class FillerNotifyPassthrough extends TransformStream<string, string> {
      constructor() {
        super({
          transform(text, controller) {
            console.log("Twilio: Agent processing started");
            fillerTransform.notifyProcessingStarted();
            controller.enqueue(text);
          },
        });
      }
    }
    const agentNotifyTransform = new FillerNotifyPassthrough();

    // Build the audio pipeline
    // Twilio Audio (mulaw 8kHz) → PCM 16kHz → STT → Agent → TTS → PCM 16kHz → mulaw 8kHz
    const pipeline = observableStream
      .pipeThrough(new MulawToPcmTransform({ targetSampleRate: 16000 }))
      .pipeThrough(sttTransform)
      .pipeThrough(agentNotifyTransform)
      .pipeThrough(
        new AgentTransform(agent, {
          onInterrupt: (value) => {
            console.log("[Twilio] Human-in-the-loop interrupt:", value);
          },
          onHangUp: (reason) => {
            console.log("[Twilio] Agent initiated hang up:", reason);
            pendingHangUp = reason;
          },
        })
      )
      .pipeThrough(new AIMessageChunkTransform())
      .pipeThrough(fillerTransform)
      .pipeThrough(ttsTransform)
      .pipeThrough(new PcmToMulawTransform({ sourceSampleRate: 16000 }));

    const reader = pipeline.getReader();

    // Track pipeline stats
    let audioChunksSent = 0;
    let totalBytesSent = 0;
    let pipelineErrored = false;

    // Start reading from pipeline and send audio back to Twilio
    async function startPipelineReader() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || pipelineClosed) break;

          if (twilioWs && twilioWs.readyState === 1) {
            sendAudioToTwilio(value);
            audioChunksSent++;
            totalBytesSent += value.length;

            if (audioChunksSent === 1) {
              console.log("Twilio: Sending first audio chunk back");
            }
          }
        }
        console.log(
          `Twilio: Pipeline finished (${audioChunksSent} chunks, ${totalBytesSent} bytes sent)`
        );
      } catch (e) {
        if (!pipelineErrored) {
          pipelineErrored = true;
          console.error("Twilio: Pipeline error:", e);
          pipelineClosed = true;
        }
      }
    }

    return {
      onOpen(_evt, ws) {
        console.log("Twilio: Media stream WebSocket connected");
        twilioWs = ws;
      },

      onMessage(evt) {
        try {
          const message = JSON.parse(evt.data as string) as TwilioMessage;

          switch (message.event) {
            case "connected":
              console.log(
                `Twilio: Connected (protocol: ${message.protocol}, version: ${message.version})`
              );
              break;

            case "start":
              streamSid = message.streamSid;
              callSid = message.start.callSid;
              console.log(
                `Twilio: Stream started (streamSid: ${streamSid}, callSid: ${callSid})`
              );
              console.log(
                `Twilio: Media format - ${message.start.mediaFormat.encoding} @ ${message.start.mediaFormat.sampleRate}Hz`
              );

              // Start the pipeline reader
              startPipelineReader();
              break;

            case "media":
              // Don't process if pipeline is closed
              if (pipelineClosed || pipelineErrored) return;

              // Decode base64 audio and send to pipeline
              const audioData = Buffer.from(message.media.payload, "base64");
              try {
                controller.enqueue(audioData);
              } catch {
                if (!pipelineClosed) {
                  console.warn("Twilio: Failed to enqueue audio, closing pipeline");
                  pipelineClosed = true;
                }
              }
              break;

            case "stop":
              console.log(`Twilio: Stream stopped (callSid: ${message.stop.callSid})`);
              pipelineClosed = true;
              try {
                controller.close();
              } catch {
                // Ignore if already closed
              }
              break;

            case "mark":
              console.log(`Twilio: Mark received - ${message.mark.name}`);
              break;

            default:
              console.log("Twilio: Unknown message type:", message);
          }
        } catch (e) {
          console.error("Twilio: Error processing message:", e);
        }
      },

      onClose() {
        console.log("Twilio: Media stream WebSocket disconnected");
        pipelineClosed = true;
        twilioWs = null;

        try {
          controller.close();
        } catch {
          // Ignore if already closed
        }
      },

      onError(error) {
        console.error("Twilio: WebSocket error:", error);
      },
    };
  })
);

/**
 * Health check endpoint
 */
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "twilio-voice-agent" });
});

/**
 * Status page with setup instructions
 */
app.get("/", (c) => {
  const host = c.req.header("host") || "localhost:3002";

  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Twilio Voice Agent</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --border: #2a2a3a;
      --text: #e4e4e7;
      --muted: #71717a;
      --accent: #f472b6;
      --accent-dim: #831843;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
      background-image: 
        radial-gradient(circle at 20% 80%, var(--accent-dim) 0%, transparent 40%),
        radial-gradient(circle at 80% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 40%);
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--accent) 0%, #a855f7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: var(--muted);
      margin-bottom: 2rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 1rem;
      font-weight: 500;
      color: var(--accent);
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    code {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      display: block;
      font-size: 0.875rem;
      color: var(--accent);
      margin: 0.5rem 0;
      overflow-x: auto;
    }
    ol {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 1rem;
      color: var(--muted);
    }
    li strong {
      color: var(--text);
    }
    .endpoint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.5rem 0;
    }
    .method {
      background: var(--accent-dim);
      color: var(--accent);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📞 Twilio Voice Agent</h1>
    <p class="subtitle">Voice AI agent powered by LangChain</p>
    
    <div class="card">
      <h2>Status</h2>
      <div class="status">
        <div class="status-dot"></div>
        <span>Server running on ${host}</span>
      </div>
    </div>
    
    <div class="card">
      <h2>Endpoints</h2>
      <div class="endpoint">
        <span class="method">POST</span>
        <code>/voice</code>
      </div>
      <p style="color: var(--muted); font-size: 0.875rem; margin-top: 0.5rem;">
        TwiML webhook for incoming calls
      </p>
      <div class="endpoint" style="margin-top: 1rem;">
        <span class="method">WS</span>
        <code>/media-stream</code>
      </div>
      <p style="color: var(--muted); font-size: 0.875rem; margin-top: 0.5rem;">
        WebSocket endpoint for bidirectional audio
      </p>
    </div>
    
    <div class="card">
      <h2>Setup Instructions</h2>
      <ol>
        <li>
          <strong>Get a public URL</strong><br>
          Use ngrok or deploy to a public server:
          <code>ngrok http 3002</code>
        </li>
        <li>
          <strong>Configure Twilio</strong><br>
          Set your Twilio phone number's voice webhook to:
          <code>https://YOUR_NGROK_URL/voice</code>
        </li>
        <li>
          <strong>Set environment variables</strong><br>
          <code>ASSEMBLYAI_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id</code>
        </li>
        <li>
          <strong>Call your Twilio number</strong><br>
          The voice agent will answer and respond!
        </li>
      </ol>
    </div>
  </div>
</body>
</html>
`);
});

const port = parseInt(process.env.PORT || "3002", 10);
const server = serve({
  fetch: app.fetch,
  port,
});

injectWebSocket(server);

console.log(`🎙️  Twilio Voice Agent running on http://localhost:${port}`);
console.log(`📞 Configure your Twilio webhook to: POST /voice`);
console.log(`🔗 Media stream WebSocket: /media-stream`);

