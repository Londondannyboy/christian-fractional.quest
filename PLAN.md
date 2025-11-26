We have been developing a POC for this voice agent and are ready to productionize it. The goal is to create abstractions for user that want to build voice agents with LangChain. This should not look much different from building chat based agents, so our abstractions should align with the existing LangChain abstractions.

For voice we will introduce a new type of "ChatModels":
- models for text to speech
- models for speech to text

### Speech to Text
Different model provider offer different features. Currently we explored AssemblyAI which offers real-time streaming and VAD. A Speech to text model here only requires to offer an integration into AssemblyAI's API.

On the other side we have OpenAI Whisper which doesn't allow streaming and sends audio chunks in batches. This solution requires a VAD buffer to be implemented, see `VADBufferTransform.ts`.

### Text to Speech
Here we currently have explored `ElevenLabsTTSTransform` and `HumeTTSTransform`. Both offer different options, e.g. for voice selection etc. These options should be exposed to the user.

## Setup

Let's create new packages for the voice agent abstractions:
- [x] `@voice-sandwich-demo/core`: offers common building blocks for a voice model (VAD, STT, TTS)
- [x] `@voice-sandwich-demo/elevenlabs`: integration for ElevenLabs
- [x] `@voice-sandwich-demo/hume`: integration for Hume
- [x] `@voice-sandwich-demo/openai`: integration for OpenAI
- [x] `@voice-sandwich-demo/assemblyai`: integration for AssemblyAI
- [x] `@voice-sandwich-demo/demo`: demo application using the new abstractions

### Core

Let's create a core abstraction that aligns with LangChain's `createAgent` but enhances it with voice specific features. We call it `createVoiceAgent`. The current createAgent uses `CreateAgentParams` which we want to extend with the following:

```ts
import { type CreateAgentParams } from "langchain";

export interface CreateVoiceAgentParams extends CreateAgentParams {
  stt: SpeechToTextModel
  tts: TextToSpeechModel
  transport: "webrtc" | "websocket"
}

export function createVoiceAgent(params: CreateVoiceAgentParams): VoiceAgent {
    // Creates the agent internally using createAgent()
}
```

**Status: ✅ IMPLEMENTED**

The `transport` parameter is used to determine the transport layer to use. We currently support two transports:
- `webrtc`: uses WebRTC for the transport
- `websocket`: uses WebSocket for the transport

Furthermore we want to allow users to hook into the stream pipeline as they like. Hence we want to enhance the middleware with voice specific transforms. We call this `VoiceMiddleware`.

```ts
export interface VoiceMiddlewareHooks {
  beforeSTT?: TransformStream<Buffer, Buffer>[];
  afterSTT?: TransformStream<string, string>[];
  beforeTTS?: TransformStream<string, string>[];
  afterTTS?: TransformStream<Buffer, Buffer>[];
}
```

**Status: ✅ IMPLEMENTED**

The design of the middleware should allow to build two middleware:
- [x] ThinkingFillerMiddleware: emits filler phrases when the agent takes longer than a certain threshold to respond
- [x] PipelineVisualizerMiddleware: visualizes the pipeline metrics

---

## Implementation Complete ✅

### Packages Created

1. **@voice-sandwich-demo/core** (`packages/core/`)
   - `BaseSpeechToTextModel` - Abstract base class for STT models
   - `BaseTextToSpeechModel` - Abstract base class for TTS models
   - `createVoiceAgent()` - Main factory function (extends LangChain's `createAgent`)
   - `VoiceMiddleware` - Middleware abstraction with hooks (beforeSTT, afterSTT, beforeTTS, afterTTS)
   - `ThinkingFillerTransform` & `createThinkingFillerMiddleware()` - Filler phrases for latency masking
   - `createPipelineVisualizerMiddleware()` - Pipeline metrics visualization
   - `VADBufferTransform` - Voice Activity Detection for non-streaming STT

2. **@voice-sandwich-demo/elevenlabs** (`packages/elevenlabs/`)
   - `ElevenLabsTextToSpeech` - TTS with streaming WebSocket support, barge-in

3. **@voice-sandwich-demo/hume** (`packages/hume/`)
   - `HumeTextToSpeech` - TTS with streaming WebSocket support, resampling

4. **@voice-sandwich-demo/openai** (`packages/openai/`)
   - `OpenAISpeechToText` - Whisper-based batch STT
   - `OpenAITextToSpeech` - TTS (returns MP3)

5. **@voice-sandwich-demo/assemblyai** (`packages/assemblyai/`)
   - `AssemblyAISpeechToText` - Real-time streaming STT with VAD

6. **@voice-sandwich-demo/demo** (`packages/demo/`)
   - Complete demo application showing how to use the new abstractions
   - Slim, easy-to-understand implementation
   - WebRTC-based voice agent for a sandwich shop

---

## Demo Usage

The demo shows how simple it is to create a voice agent with the new abstractions:

```ts
import { createVoiceAgent, createThinkingFillerMiddleware } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";

const voiceAgent = createVoiceAgent({
  // LangChain agent configuration
  model: new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash" }),
  tools: [addToOrder, confirmOrder, hangUp],
  systemPrompt: "You are a helpful sandwich shop assistant...",
  checkpointer: new MemorySaver(),

  // Voice configuration
  stt: new AssemblyAISpeechToText({ apiKey: "...", sampleRate: 16000 }),
  tts: new ElevenLabsTextToSpeech({ apiKey: "...", voiceId: "..." }),
  transport: "webrtc",
  middleware: [createThinkingFillerMiddleware()],

  // Callbacks
  onHangUp: (reason) => closeConnection(reason),
});

// Process audio through the voice agent
const audioOutput = voiceAgent.process(audioInput);
```

To run the demo:
```bash
cd packages/demo
pnpm start
```

---

## Running the Demo

1. Set environment variables:
   ```
   ASSEMBLYAI_API_KEY=your_key
   ELEVENLABS_API_KEY=your_key
   ELEVENLABS_VOICE_ID=your_voice_id
   GOOGLE_API_KEY=your_key (for Gemini)
   ```

2. Start the demo:
   ```bash
   pnpm --filter @voice-sandwich-demo/demo start
   ```

3. Open http://localhost:3001 in your browser

---

## Proposal Document

See [PROPOSAL.md](PROPOSAL.md) for a high-level architecture overview, explanation of each primitive, and future improvement ideas.
