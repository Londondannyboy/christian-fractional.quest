# Voice Agent Abstractions for LangChain

**RFC: Building Voice-Enabled Agents with LangChain**

## Overview

This proposal introduces a set of abstractions that extend LangChain to support voice-enabled agents. The goal is to make building voice agents feel as natural as building chat-based agents—same patterns, same simplicity, just with audio I/O.

```ts
// Creating a voice agent should feel just like creating a chat agent
const voiceAgent = createVoiceAgent({
  // Standard LangChain agent params
  model: new ChatOpenAI({ model: "gpt-4" }),
  tools: [myTools],
  systemPrompt: "You are a helpful assistant.",
  checkpointer: new MemorySaver(),

  // Voice-specific params
  stt: new AssemblyAISpeechToText({ apiKey: "..." }),
  tts: new ElevenLabsTextToSpeech({ apiKey: "...", voiceId: "..." }),
  transport: "webrtc",
  middleware: [thinkingFillerMiddleware],
});

// Process audio streams
const audioOutput = voiceAgent.process(audioInput);
```

---

## Architecture

### Pipeline Overview

The voice agent processes audio through a streaming pipeline:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Voice Agent Pipeline                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Audio In ──► [beforeSTT] ──► STT ──► [afterSTT] ──► Agent ──►               │
│                                                                              │
│              ──► [beforeTTS] ──► TTS ──► [afterTTS] ──► Audio Out            │
│                                                                              │
│  Events:                                                                     │
│    • onSpeechStart ─────────────────────────────────────────► (barge-in)     │
│    • onAudioComplete ───────────────────────────────────────► (hang-up)      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Extends LangChain's `createAgent`**: `CreateVoiceAgentParams` extends `CreateAgentParams`, so all existing agent configuration works seamlessly.

2. **Stream-based transforms**: Uses native Web Streams API (`TransformStream`) for composable, backpressure-aware pipeline stages.

3. **Middleware with hooks**: Middleware can inject transforms at any pipeline stage AND subscribe to events (speech detection, audio completion).

4. **Provider-agnostic**: STT and TTS are abstract base classes—swap providers without changing agent code.

---

## Core Primitives

### 1. `createVoiceAgent()` 
📁 [`packages/core/src/agent.ts`](packages/core/src/agent.ts)

The main entry point. Creates a LangChain agent internally and wraps it with voice I/O.

```ts
interface CreateVoiceAgentParams extends CreateAgentParams {
  stt: BaseSpeechToTextModel;
  tts: BaseTextToSpeechModel;
  transport: "webrtc" | "websocket";
  middleware?: VoiceMiddleware[];
  onInterrupt?: (value: unknown) => void;
  onHangUp?: (reason: string) => void;
}

function createVoiceAgent(params: CreateVoiceAgentParams): VoiceAgent;
```

**Why this abstraction?**
- Aligns with LangChain's existing `createAgent()` pattern
- Single function call to get a fully configured voice agent
- Internally handles agent creation, pipeline wiring, and middleware composition

---

### 2. `BaseSpeechToTextModel` / `BaseTextToSpeechModel`
📁 [`packages/core/src/models.ts`](packages/core/src/models.ts)

Abstract base classes for speech models. Each extends `TransformStream` with voice-specific capabilities.

```ts
abstract class BaseSpeechToTextModel extends TransformStream<Buffer, string> {
  abstract readonly provider: string;
  
  // Event listener pattern for middleware integration
  addSpeechStartListener(listener: () => void): void;
  protected notifySpeechStart(): void;  // Called by implementations
}

abstract class BaseTextToSpeechModel extends TransformStream<string, Buffer> {
  abstract readonly provider: string;
  abstract interrupt(): void;  // For barge-in support
  
  addAudioCompleteListener(listener: () => void): void;
  protected notifyAudioComplete(): void;  // Called by implementations
}
```

**Why this abstraction?**
- **Uniform interface**: All STT/TTS providers expose the same API
- **Event listener pattern**: Middleware can subscribe to speech events without knowing provider internals
- **Stream-based**: Naturally composable with other transforms

---

### 3. `VoiceMiddleware`
📁 [`packages/core/src/middleware.ts`](packages/core/src/middleware.ts)

Middleware can hook into the pipeline at multiple points with both transforms and event callbacks.

```ts
interface VoiceMiddlewareHooks {
  // Transform hooks (stream-based)
  beforeSTT?: TransformStream<Buffer, Buffer>[];
  afterSTT?: TransformStream<string, string>[];
  beforeTTS?: TransformStream<string, string>[];
  afterTTS?: TransformStream<Buffer, Buffer>[];

  // Event hooks (callback-based)
  onSpeechStart?: () => void;    // STT detected speech
  onAudioComplete?: () => void;  // TTS finished playing
}

interface VoiceMiddleware {
  name: string;
  hooks: VoiceMiddlewareHooks;
}
```

**Why this abstraction?**
- **Transform hooks**: Process/modify data at any pipeline stage
- **Event hooks**: React to pipeline events without injecting transforms
- **Composable**: Multiple middleware combine cleanly via `combineVoiceMiddleware()`

---

### 4. `combineVoiceMiddleware()`
📁 [`packages/core/src/middleware.ts`](packages/core/src/middleware.ts)

Combines multiple middleware into a single set of hooks. Transforms are concatenated; event callbacks are all invoked.

```ts
function combineVoiceMiddleware(...middlewares: VoiceMiddleware[]): VoiceMiddlewareHooks;
```

**How it works:**
1. Collects transform arrays from all middleware
2. Collects event callbacks from all middleware
3. Creates combined callbacks that invoke all registered handlers

---

### 5. `ThinkingFillerMiddleware`
📁 [`packages/core/src/thinking-filler.ts`](packages/core/src/thinking-filler.ts)

A built-in middleware that emits filler phrases ("Let me see...", "Hmm, one moment...") when the agent takes too long to respond. Creates a more natural conversation experience.

```ts
const fillerMiddleware = createThinkingFillerMiddleware({
  thresholdMs: 1200,
  fillerPhrases: ["Let me see here...", "Hmm, one moment..."],
  maxFillersPerTurn: 1,
});
```

**How it uses middleware hooks:**

| Hook | Purpose |
|------|---------|
| `afterSTT` | Starts filler timer when user input is received |
| `beforeTTS` | Emits filler phrases to TTS output |
| `onSpeechStart` | Cancels pending filler when user interrupts (barge-in) |

**Why this is powerful:**
Previously, wiring filler logic required manual coordination:
```ts
// Before: Manual wiring everywhere
stt.onSpeechStart = () => fillerTransform.cancelPendingFiller();
afterSTT.push(notifyTransform);
beforeTTS.push(fillerTransform);
```

Now, it's automatic:
```ts
// After: Just add to middleware array
middleware: [createThinkingFillerMiddleware()]
```

---

## Provider Packages

### STT Providers

| Package | Class | Features |
|---------|-------|----------|
| `@voice-sandwich-demo/assemblyai` | `AssemblyAISpeechToText` | Real-time streaming, built-in VAD, barge-in detection |
| `@voice-sandwich-demo/openai` | `OpenAISpeechToText` | Batch-based (Whisper), requires external VAD |

### TTS Providers

| Package | Class | Features |
|---------|-------|----------|
| `@voice-sandwich-demo/elevenlabs` | `ElevenLabsTextToSpeech` | Streaming WebSocket, low latency, interrupt support |
| `@voice-sandwich-demo/hume` | `HumeTextToSpeech` | Streaming, emotional expression, auto-resampling |
| `@voice-sandwich-demo/openai` | `OpenAITextToSpeech` | Batch-based, MP3 output |

---

## Demo: Sandwich Shop Voice Agent

📁 [`packages/demo/`](packages/demo/)

A minimal example showing how clean the final code is:

```ts
// agent.ts - ~70 lines total
export function createSandwichShopVoiceAgent(params) {
  return createVoiceAgent({
    model: new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash" }),
    tools: [addToOrder, confirmOrder, hangUp],
    systemPrompt: SYSTEM_PROMPT,
    checkpointer: new MemorySaver(),

    stt: new AssemblyAISpeechToText({ ... }),
    tts: new ElevenLabsTextToSpeech({ ... }),
    transport: "webrtc",
    middleware: [fillerMiddleware],
  });
}
```

```ts
// index.ts - Server is just transport plumbing
const agent = createSandwichShopVoiceAgent({ closeConnection, onSpeechStart });
const audioOutput = agent.process(inputStream);
```

---

## Event Hook Wiring

A key insight: the voice agent automatically wires middleware event hooks to the underlying models.

```ts
// Inside createVoiceAgent():
const hooks = combineVoiceMiddleware(...middleware);

// Wire middleware event hooks to STT/TTS models
if (hooks.onSpeechStart) {
  stt.addSpeechStartListener(hooks.onSpeechStart);
}
if (hooks.onAudioComplete) {
  tts.addAudioCompleteListener(hooks.onAudioComplete);
}
```

**Result**: Middleware authors don't need to know about model internals. They just declare which events they care about.

---

## Future Improvements

### 1. Transport Abstraction
Currently, `transport` is just a hint. We could provide actual transport handlers:

```ts
// Future API
const handler = voiceAgent.createHandler("hono");  // or "express", "fastify"
app.get("/ws", handler);
```

### 2. Built-in Observability
The current `PipelineVisualizerMiddleware` is basic. We could add:
- OpenTelemetry integration
- Latency histograms per stage
- Token/audio byte throughput metrics

### 3. More Event Hooks
Additional events middleware might want:
- `onTranscriptReady(text)` — Full transcript before agent processing
- `onAgentResponse(text)` — Agent text before TTS
- `onError(stage, error)` — Pipeline error handling

### 4. Streaming Interrupts
Human-in-the-loop interrupts currently buffer until the agent finishes streaming. We could support:
- Immediate interrupt emission
- Streaming the interrupt while the agent continues

### 5. Multi-turn Memory
The current `checkpointer` handles persistence, but voice-specific memory could include:
- Audio embeddings for speaker identification
- Conversation tone/sentiment tracking
- Prosody adaptation

### 6. Client SDK
A browser SDK that handles:
- WebRTC/WebSocket connection
- AudioWorklet setup
- Barge-in detection on the client side
- Audio buffer management

### 7. VAD as Middleware
Currently, `VADBufferTransform` is a standalone utility. It could be a middleware:

```ts
middleware: [
  createVADMiddleware({ sampleRate: 16000 }),  // beforeSTT
  createThinkingFillerMiddleware(),
]
```

---

## Summary

This proposal introduces a minimal but powerful set of abstractions:

| Primitive | Purpose |
|-----------|---------|
| `createVoiceAgent()` | Main entry point, extends LangChain's `createAgent` |
| `BaseSpeechToTextModel` | Abstract STT with event listeners |
| `BaseTextToSpeechModel` | Abstract TTS with interrupt support |
| `VoiceMiddleware` | Transform + event hooks for pipeline customization |
| `combineVoiceMiddleware()` | Compose multiple middleware |

**Key benefits:**
- ✅ Feels like building a chat agent
- ✅ Stream-based, composable pipeline
- ✅ Provider-agnostic
- ✅ Middleware auto-wiring (no manual event plumbing)
- ✅ Clean separation between agent logic and transport

The demo package shows that a complete voice agent can be built in ~70 lines of agent code + transport plumbing.

