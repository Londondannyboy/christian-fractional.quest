/**
 * Voice Sandwich Demo
 * 
 * A slim demo showing how to use the voice agent abstractions.
 * This demonstrates a WebRTC-based voice agent for a sandwich shop.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import wrtc from "@roamhq/wrtc";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createSandwichShopVoiceAgent, getAvailableProviders, type STTProvider, type TTSProvider } from "./agent.js";

const { RTCPeerConnection, RTCSessionDescription } = wrtc;


// =============================================================================
// Voice Agent Setup
// =============================================================================



// =============================================================================
// Server Setup
// =============================================================================

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("/*", cors());

// Serve static HTML
const htmlPath = join(process.cwd(), "src", "static", "index.html");
const html = readFileSync(htmlPath, "utf-8");
app.get("/", (c) => c.html(html));

// API endpoint to get available providers
app.get("/api/providers", (c) => {
  const providers = getAvailableProviders();
  return c.json(providers);
});

// =============================================================================
// WebRTC Signaling
// =============================================================================

app.get(
  "/ws/signaling",
  upgradeWebSocket(() => {
    let peerConnection: InstanceType<typeof RTCPeerConnection> | null = null;
    let audioDataChannel: wrtc.RTCDataChannel | null = null;
    let controller: ReadableStreamDefaultController<Buffer>;
    let pipelineClosed = false;
    let signalingWs: { send: (data: string) => void; readyState: number } | null = null;
    let agent: ReturnType<typeof createSandwichShopVoiceAgent> | null = null;
    let sttProvider: STTProvider = "assemblyai";
    let ttsProvider: TTSProvider = "elevenlabs";
    
    function sendSignalingMessage(message: object) {
      if (signalingWs && signalingWs.readyState === 1) {
        signalingWs.send(JSON.stringify(message));
      }
    }

    function closeConnection(reason: string) {
      console.log(`Closing connection: ${reason}`);
      pipelineClosed = true;

      if (audioDataChannel && audioDataChannel.readyState === "open") {
        audioDataChannel.send(JSON.stringify({ type: "call-ended", reason }));
      }

      setTimeout(() => {
        audioDataChannel?.close();
        audioDataChannel = null;
        peerConnection?.close();
        peerConnection = null;
        try { controller.close(); } catch { /* ignore */ }
        sendSignalingMessage({ type: "connection-closed", reason });
      }, 500);
    }

    // Create input stream for audio
    const inputStream = new ReadableStream<Buffer>({
      start(c) { controller = c; },
    });

    return {
      onOpen(_evt, ws) {
        console.log("Signaling WebSocket connected");
        signalingWs = ws;

        peerConnection = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        });

        peerConnection.onicecandidate = (event: { candidate: wrtc.RTCIceCandidate | null }) => {
          if (event.candidate) {
            sendSignalingMessage({ type: "ice-candidate", candidate: event.candidate });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          console.log("Connection state:", peerConnection?.connectionState);
        };

        peerConnection.ondatachannel = (event: { channel: wrtc.RTCDataChannel }) => {
          if (event.channel.label === "audio") {
            audioDataChannel = event.channel;

            audioDataChannel.onopen = () => {
              console.log("Audio channel open");
              
              // Create the voice agent with selected providers
              agent = createSandwichShopVoiceAgent({
                closeConnection,
                onSpeechStart: () => {
                  // Barge-in: user started speaking
                  console.log("Barge-in: User started speaking, interrupting TTS");
                  agent?.tts.interrupt();

                  if (audioDataChannel && audioDataChannel.readyState === "open") {
                    audioDataChannel.send(JSON.stringify({ type: "clear-audio" }));
                  }
                },
                providers: { sttProvider, ttsProvider },
              });

              // Process audio through the voice agent pipeline
              const audioOutput = agent.process(inputStream);
              const reader = audioOutput.getReader();

              (async function startPipelineReader() {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done || pipelineClosed) break;

                    if (audioDataChannel && audioDataChannel.readyState === "open") {
                      audioDataChannel.send(value as unknown as ArrayBuffer);
                    }
                  }
                } catch (e) {
                  console.error("Pipeline error:", e);
                  pipelineClosed = true;
                }
              })();
            };

            audioDataChannel.onmessage = (msgEvent: { data: ArrayBuffer | string }) => {
              if (pipelineClosed) return;
              const data = msgEvent.data;
              if (data instanceof ArrayBuffer) {
                try {
                  controller.enqueue(Buffer.from(data));
                } catch { pipelineClosed = true; }
              }
            };

            audioDataChannel.onclose = () => console.log("Audio channel closed");
          }
        };
      },

      async onMessage(evt) {
        const message = JSON.parse(evt.data as string);

        // Handle provider configuration message
        if (message.type === "configure-providers") {
          console.log("Configuring providers:", message);
          if (message.sttProvider) {
            sttProvider = message.sttProvider as STTProvider;
          }
          if (message.ttsProvider) {
            ttsProvider = message.ttsProvider as TTSProvider;
          }
          sendSignalingMessage({ type: "providers-configured", providers: { sttProvider, ttsProvider } });
          return;
        }

        if (message.type === "offer") {
          await peerConnection!.setRemoteDescription(new RTCSessionDescription(message.sdp));
          const answer = await peerConnection!.createAnswer();
          await peerConnection!.setLocalDescription(answer);
          sendSignalingMessage({ type: "answer", sdp: peerConnection!.localDescription });
        } else if (message.type === "ice-candidate" && message.candidate) {
          await peerConnection!.addIceCandidate(message.candidate);
        }
      },

      onClose() {
        console.log("Signaling disconnected");
        pipelineClosed = true;
        signalingWs = null;
        audioDataChannel?.close();
        peerConnection?.close();
        try { controller.close(); } catch { /* ignore */ }
      },
    };
  })
);

// =============================================================================
// Start Server
// =============================================================================

const port = 3001;
const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);

console.log(`🥪 Voice Sandwich Demo running on http://localhost:${port}`);
