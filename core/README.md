# create-voice-agent 🗣️🔉

Core building blocks for creating voice agents with [LangChain](https://langchain.com/).

This library extends LangChain's `createAgent()` function with voice capabilities, providing a simple and composable API for building conversational voice applications.

## Installation

```bash
npm install create-voice-agent
# or
pnpm add create-voice-agent
```

You'll also need to install provider packages for Speech-to-Text and Text-to-Speech:

```bash
# STT Providers
npm install @create-voice-agent/assemblyai  # Real-time streaming STT
npm install @create-voice-agent/openai      # Whisper-based STT

# TTS Providers
npm install @create-voice-agent/elevenlabs  # ElevenLabs TTS
npm install @create-voice-agent/hume        # Hume AI TTS
npm install @create-voice-agent/openai      # OpenAI TTS
```

## Quick Start

```typescript
import { createVoiceAgent } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";

const voiceAgent = createVoiceAgent({
  // LangChain agent parameters
  model: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [/* your tools here */],
  prompt: "You are a helpful voice assistant.",
  checkpointer: new MemorySaver(),
  
  // Voice-specific parameters
  stt: new AssemblyAISpeechToText({ apiKey: process.env.ASSEMBLYAI_API_KEY }),
  tts: new ElevenLabsTextToSpeech({ 
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: "your-voice-id"
  }),
});

// Process audio input and get audio output
const audioOutput = voiceAgent.process(audioInputStream);
```

## Core Concepts

### Voice Pipeline Architecture

```txt
Audio Input → [beforeSTT] → STT → [afterSTT] → Agent → [beforeTTS] → TTS → [afterTTS] → Audio Output
```

The voice pipeline transforms audio through several stages:

1. **Audio Input**: Raw PCM audio from microphone/stream
2. **STT (Speech-to-Text)**: Transcribes audio to text
3. **Agent**: LangChain agent processes the text and generates a response
4. **TTS (Text-to-Speech)**: Converts agent response to audio
5. **Audio Output**: PCM audio for playback

Middleware hooks (`beforeSTT`, `afterSTT`, `beforeTTS`, `afterTTS`) allow you to customize each stage.

## API Reference

### `createVoiceAgent(params)`

Creates a voice-enabled agent with STT and TTS capabilities.

```typescript
interface CreateVoiceAgentParams extends CreateAgentParams {
  /** Speech-to-Text model for transcribing user input */
  stt: BaseSpeechToTextModel;
  
  /** Text-to-Speech model for generating audio output */
  tts: BaseTextToSpeechModel;
  
  /** Optional middleware for customizing the pipeline */
  middleware?: VoiceMiddleware[];
  
  /** Callback when a LangGraph interrupt occurs */
  onInterrupt?: (value: unknown) => void;
  
  /** Callback when the agent calls the hang_up tool */
  onHangUp?: (reason: string) => void;
}
```

#### Returns: `VoiceAgent`

```typescript
interface VoiceAgent {
  /** The underlying LangGraph agent */
  readonly agent: ReactAgent;
  
  /** The TTS model (useful for interrupt/barge-in control) */
  readonly tts: BaseTextToSpeechModel;
  
  /** The STT model */
  readonly stt: BaseSpeechToTextModel;
  
  /** Start processing audio from a readable stream */
  process(audioInput: ReadableStream<Buffer>): ReadableStream<Buffer>;
  
  /** Stop processing and clean up */
  stop(): void;
}
```

### Base Models

#### `BaseSpeechToTextModel`

Abstract base class for Speech-to-Text providers. Extends `TransformStream<Buffer, string>`.

```typescript
abstract class BaseSpeechToTextModel extends TransformStream<Buffer, string> {
  abstract readonly provider: string;
  
  /** Interrupt current transcription (for barge-in support) */
  interrupt?(): void;
  
  /** Add listener for speech detection */
  addSpeechStartListener(listener: () => void): void;
  
  /** Remove speech start listener */
  removeSpeechStartListener(listener: () => void): void;
  
  /** Called by implementations when speech is detected */
  protected notifySpeechStart(): void;
}
```

#### `BaseTextToSpeechModel`

Abstract base class for Text-to-Speech providers. Extends `TransformStream<string, Buffer>`.

```typescript
abstract class BaseTextToSpeechModel extends TransformStream<string, Buffer> {
  abstract readonly provider: string;
  
  /** Interrupt current TTS output (for barge-in support) */
  abstract interrupt(): void;
  
  /** 
   * Speak text directly and return a stream of audio buffers.
   * Useful for one-off speech synthesis (e.g., greetings) without 
   * going through the full voice agent pipeline.
   */
  abstract speak(text: string): ReadableStream<Buffer>;
  
  /** Add listener for when audio playback completes */
  addAudioCompleteListener(listener: () => void): void;
  
  /** Remove audio complete listener */
  removeAudioCompleteListener(listener: () => void): void;
  
  /** Called by implementations when audio playback completes */
  protected notifyAudioComplete(): void;
}
```

##### Using `speak()` for Direct Speech Synthesis

The `speak()` method allows you to generate speech independently of the voice pipeline. This is useful for:

- **Initial greetings** when a call starts
- **System announcements** that don't require agent processing
- **One-off audio generation** outside of conversations

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY,
  voiceId: "your-voice-id",
});

// Generate greeting audio
const audioStream = tts.speak("Hello! How can I help you today?");

// Stream the audio to your output
for await (const chunk of audioStream) {
  await playAudio(chunk);
}
```

## Middleware

Middleware allows you to hook into the voice pipeline at different stages for custom processing.

### Creating Middleware

```typescript
import { createVoiceMiddleware, type VoiceMiddleware } from "create-voice-agent";

const myMiddleware = createVoiceMiddleware("MyMiddleware", {
  // Transform hooks (stream-based)
  beforeSTT: [new MyAudioPreprocessor()],   // Buffer → Buffer
  afterSTT: [new MyTextFilter()],           // string → string
  beforeTTS: [new MyTextPostprocessor()],   // string → string
  afterTTS: [new MyAudioPostprocessor()],   // Buffer → Buffer
  
  // Event hooks (callback-based)
  onSpeechStart: () => console.log("User started speaking"),
  onAudioComplete: () => console.log("Agent finished speaking"),
});
```

### Combining Middleware

Multiple middleware are applied in order:

```typescript
const voiceAgent = createVoiceAgent({
  // ...
  middleware: [
    loggingMiddleware,
    thinkingFillerMiddleware,
    visualizerMiddleware,
  ],
});
```

### Middleware Hooks

| Hook | Type | Description |
|------|------|-------------|
| `beforeSTT` | `TransformStream<Buffer, Buffer>[]` | Audio preprocessing before STT |
| `afterSTT` | `TransformStream<string, string>[]` | Text processing after STT |
| `beforeTTS` | `TransformStream<string, string>[]` | Text processing before TTS |
| `afterTTS` | `TransformStream<Buffer, Buffer>[]` | Audio processing after TTS |
| `onSpeechStart` | `() => void` | Called when user starts speaking |
| `onAudioComplete` | `() => void` | Called when agent finishes speaking |

## Built-in Middleware

### Thinking Filler Middleware

Emits natural "thinking" phrases (e.g., "Let me see...", "Hmm, one moment...") when the agent takes time to respond.

```typescript
import { createThinkingFillerMiddleware } from "create-voice-agent";

const fillerMiddleware = createThinkingFillerMiddleware({
  thresholdMs: 1000,         // Wait 1s before emitting filler
  maxFillersPerTurn: 2,      // Max fillers per response
  fillerIntervalMs: 2000,    // Delay between consecutive fillers
  fillerPhrases: [           // Custom phrases
    "Let me think about that...",
    "One moment please...",
    "Hmm, let me see...",
  ],
  onFillerEmitted: (phrase) => console.log(`Emitted: ${phrase}`),
});

const voiceAgent = createVoiceAgent({
  // ...
  middleware: [fillerMiddleware],
});
```

#### `ThinkingFillerTransform` Class

For more control, use the `ThinkingFillerTransform` class directly:

```typescript
import { ThinkingFillerTransform } from "create-voice-agent";

const filler = new ThinkingFillerTransform({ thresholdMs: 1200 });

// Manually control the filler
filler.notifyProcessingStarted();  // Start the filler timer
filler.cancelPendingFiller();      // Cancel pending fillers
```

### Pipeline Visualizer Middleware

Tracks metrics at each pipeline stage for debugging and observability.

```typescript
import { createPipelineVisualizerMiddleware } from "create-voice-agent";

const visualizer = createPipelineVisualizerMiddleware({
  verbose: true,
  onEvent: (event) => {
    // Send to your visualization frontend
    websocket.send(JSON.stringify(event));
  },
});
```

#### Event Types

```typescript
type PipelineEvent =
  | { type: "stage_registered"; stageName: string; shortName: string; color: string }
  | { type: "turn_start"; stageName: string; turnNumber: number }
  | { type: "stage_input"; stageName: string; turnNumber: number; chunkPreview?: string }
  | { type: "first_chunk"; stageName: string; turnNumber: number; ttfc: number }
  | { type: "chunk"; stageName: string; metrics: StageMetrics }
  | { type: "latency_update"; stageName: string; latency: LatencyData }
  | { type: "stage_complete"; stageName: string; metrics: StageMetrics }
  | { type: "pipeline_summary"; stages: StageMetrics[] };
```

## Utilities

### VAD Buffer Transform

Voice Activity Detection (VAD) buffer that collects audio until speech ends, then emits the complete utterance. Useful for non-streaming STT providers like OpenAI Whisper.

```typescript
import { VADBufferTransform } from "create-voice-agent";

const vadBuffer = new VADBufferTransform({
  sampleRate: 16000,      // Input sample rate
  minSpeechFrames: 4,     // Minimum speech frames to trigger
  onSpeechEnd: (audio) => console.log(`Speech ended: ${audio.length} bytes`),
});

// Use in middleware
const vadMiddleware = createVoiceMiddleware("VAD", {
  beforeSTT: [vadBuffer],
});
```

## Handling Interruptions (Barge-in)

The library provides built-in support for handling user interruptions:

```typescript
const voiceAgent = createVoiceAgent({
  stt: new AssemblyAISpeechToText({
    apiKey: process.env.ASSEMBLYAI_API_KEY,
  }),
  tts: new ElevenLabsTextToSpeech({
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: "your-voice-id",
  }),
  // ...
});

// The STT model notifies listeners when the user starts speaking
// The TTS model can be interrupted to stop playback
voiceAgent.tts.interrupt(); // Manually interrupt TTS
```

With middleware, you can automatically handle barge-in:

```typescript
const bargeInMiddleware = createVoiceMiddleware("BargeIn", {
  onSpeechStart: () => {
    // User started speaking - interrupt the agent
    voiceAgent.tts.interrupt();
  },
});
```

## LangGraph Integration

### Interrupt Support

The library integrates with LangGraph's interrupt feature for human-in-the-loop workflows:

```typescript
const voiceAgent = createVoiceAgent({
  // ...
  onInterrupt: (value) => {
    console.log("Agent needs confirmation:", value);
    // The interrupt message is automatically spoken to the user
    // The next user input will resume the graph with Command({ resume: text })
  },
});
```

### Hang Up Tool

Register a `hang_up` tool to gracefully end conversations:

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const hangUpTool = tool(
  ({ reason }) => reason,
  {
    name: "hang_up",
    description: "End the call when the conversation is complete",
    schema: z.object({
      reason: z.string().describe("Reason for ending the call"),
    }),
  }
);

const voiceAgent = createVoiceAgent({
  tools: [hangUpTool],
  onHangUp: (reason) => {
    console.log("Call ended:", reason);
    // Clean up resources, close connections, etc.
  },
  // ...
});
```

## Available Provider Packages

| Package | Provider | Type | Description |
|---------|----------|------|-------------|
| `@create-voice-agent/assemblyai` | AssemblyAI | STT | Real-time streaming transcription |
| `@create-voice-agent/openai` | OpenAI | STT/TTS | Whisper STT and OpenAI TTS |
| `@create-voice-agent/elevenlabs` | ElevenLabs | TTS | High-quality voice synthesis |
| `@create-voice-agent/hume` | Hume AI | TTS | Emotionally expressive TTS |

## Example: Complete Voice Agent

```typescript
import { 
  createVoiceAgent, 
  createThinkingFillerMiddleware,
  createPipelineVisualizerMiddleware,
} from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Define tools
const getWeather = tool(
  async ({ location }) => `The weather in ${location} is sunny and 72°F`,
  {
    name: "get_weather",
    description: "Get current weather for a location",
    schema: z.object({
      location: z.string().describe("City name"),
    }),
  }
);

// Create the voice agent
const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getWeather],
  prompt: `You are a friendly voice assistant. 
    Keep responses concise and conversational.
    Speak naturally as if having a real conversation.`,
  checkpointer: new MemorySaver(),
  
  stt: new AssemblyAISpeechToText({
    apiKey: process.env.ASSEMBLYAI_API_KEY,
  }),
  
  tts: new ElevenLabsTextToSpeech({
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
  }),
  
  middleware: [
    createThinkingFillerMiddleware({ thresholdMs: 1200 }),
    createPipelineVisualizerMiddleware({ verbose: true }),
  ],
  
  onInterrupt: (value) => console.log("Interrupt:", value),
  onHangUp: (reason) => console.log("Hang up:", reason),
});

// Process audio streams
const audioOutput = voiceAgent.process(audioInputStream);

// Pipe to output (e.g., speakers, WebRTC, etc.)
for await (const chunk of audioOutput) {
  await playAudio(chunk);
}
```

## License

MIT
