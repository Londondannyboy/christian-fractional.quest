# @create-voice-agent/assemblyai 🎙️

AssemblyAI Real-Time Speech-to-Text integration for [create-voice-agent](../../core/README.md).

This package provides a streaming STT model using [AssemblyAI's v3 Real-Time Transcription API](https://www.assemblyai.com/docs/speech-to-text/streaming) for low-latency, accurate speech recognition.

## Installation

```bash
npm install @create-voice-agent/assemblyai
# or
pnpm add @create-voice-agent/assemblyai
```

## Quick Start

```typescript
import { createVoiceAgent } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  
  stt: new AssemblyAISpeechToText({
    apiKey: process.env.ASSEMBLYAI_API_KEY!,
  }),
  
  tts: new ElevenLabsTextToSpeech({ /* ... */ }),
});
```

## API Reference

### `AssemblyAISpeechToText`

Real-time streaming Speech-to-Text model using AssemblyAI's WebSocket API.

```typescript
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";

const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  
  // Optional configuration
  sampleRate: 16000,
  encoding: "pcm_s16le",
  speechModel: "universal-streaming-english",
  region: "us",
  formatTurns: true,
  
  // Endpointing configuration
  endOfTurnConfidenceThreshold: 0.4,
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1280,
  
  // Improve recognition for specific terms
  keytermsPrompt: ["LangChain", "OpenAI", "Anthropic"],
  
  // Callbacks
  onSpeechStart: () => console.log("User started speaking"),
  onTurn: (turn) => console.log("Turn event:", turn),
  onEndOfTurn: (turn) => console.log("Turn ended:", turn.transcript),
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | AssemblyAI API key |
| `token` | `string` | - | Temporary auth token (alternative to apiKey for client-side) |
| `sampleRate` | `number` | `16000` | Audio sample rate in Hz |
| `encoding` | `"pcm_s16le" \| "pcm_mulaw"` | `"pcm_s16le"` | Audio encoding format |
| `speechModel` | `string` | `"universal-streaming-english"` | Speech recognition model |
| `region` | `"us" \| "eu"` | `"us"` | API endpoint region |
| `formatTurns` | `boolean` | `true` | Return formatted transcripts (punctuation, casing) |
| `keytermsPrompt` | `string[]` | - | Words/phrases to boost recognition accuracy (max 100) |
| `endOfTurnConfidenceThreshold` | `number` | `0.4` | Confidence threshold (0-1) for end of turn detection |
| `minEndOfTurnSilenceWhenConfident` | `number` | `400` | Min silence (ms) to trigger end of turn when confident |
| `maxTurnSilence` | `number` | `1280` | Max silence (ms) before end of turn is triggered |

### Speech Models

| Model | Languages | Description |
|-------|-----------|-------------|
| `universal-streaming-english` | English | Lower latency, English-only (default) |
| `universal-streaming-multi` | EN, ES, FR, DE, IT, PT | Multilingual support |

### Regions

| Region | Endpoint | Use Case |
|--------|----------|----------|
| `us` | `streaming.assemblyai.com` | Default, US-based |
| `eu` | `streaming.eu.assemblyai.com` | EU data residency requirements |

### Callbacks

#### `onSpeechStart`

Triggered when the user starts speaking. Useful for barge-in detection.

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  onSpeechStart: () => {
    // User started speaking - interrupt agent if needed
    voiceAgent.tts.interrupt();
  },
});
```

#### `onTurn`

Triggered on every turn event (both partial and final transcripts).

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  onTurn: (turn) => {
    console.log(`Turn ${turn.turn_order}: "${turn.transcript}"`);
    console.log(`  Formatted: ${turn.turn_is_formatted}`);
    console.log(`  End of turn: ${turn.end_of_turn}`);
    console.log(`  Confidence: ${turn.end_of_turn_confidence}`);
    console.log(`  Words:`, turn.words);
  },
});
```

#### `onEndOfTurn`

Triggered specifically when end of turn is detected.

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  onEndOfTurn: (turn) => {
    console.log(`User finished: "${turn.transcript}"`);
  },
});
```

### Instance Methods

#### `updateConfiguration(config)`

Update endpointing parameters during an active session.

```typescript
// Switch to live captioning mode (faster endpointing)
stt.updateConfiguration({
  minEndOfTurnSilenceWhenConfident: 560,
  maxTurnSilence: 800,
});

// Switch back to conversational mode
stt.updateConfiguration({
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1280,
});
```

#### `forceEndpoint()`

Force an immediate end of turn. Useful when you know the user has finished speaking via external signals (e.g., button press, external VAD).

```typescript
// User pressed "done" button
stt.forceEndpoint();
```

#### `interrupt()`

Interrupt and close the current transcription session.

```typescript
// Clean up when done
stt.interrupt();
```

### Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `provider` | `"assemblyai"` | Provider identifier |
| `sessionId` | `string \| null` | Current session ID |
| `isConnected` | `boolean` | Whether WebSocket is connected |

## Turn Event Data

The `AssemblyAITurnEvent` object provides detailed transcription data:

```typescript
interface AssemblyAITurnEvent {
  /** Integer that increments with each new turn */
  turn_order: number;
  
  /** Whether the text is formatted (punctuation, casing) */
  turn_is_formatted: boolean;
  
  /** Whether this is the end of the current turn */
  end_of_turn: boolean;
  
  /** The transcript text */
  transcript: string;
  
  /** Confidence (0-1) that the turn has finished */
  end_of_turn_confidence: number;
  
  /** Word-level data */
  words: AssemblyAIWord[];
}

interface AssemblyAIWord {
  text: string;
  word_is_final: boolean;
  start: number;      // ms
  end: number;        // ms
  confidence: number; // 0-1
}
```

## Endpointing Configuration

AssemblyAI's v3 API uses intelligent endpointing to detect when the user has finished speaking. You can tune this behavior:

### For Conversational AI (default)

Balanced settings that wait for natural pauses:

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  endOfTurnConfidenceThreshold: 0.4,
  minEndOfTurnSilenceWhenConfident: 400,
  maxTurnSilence: 1280,
});
```

### For Live Captioning

Faster endpointing for real-time display:

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  endOfTurnConfidenceThreshold: 0.3,
  minEndOfTurnSilenceWhenConfident: 560,
  maxTurnSilence: 800,
});
```

### For Dictation

Longer pauses allowed between sentences:

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  endOfTurnConfidenceThreshold: 0.5,
  minEndOfTurnSilenceWhenConfident: 600,
  maxTurnSilence: 2000,
});
```

## Improving Recognition Accuracy

Use `keytermsPrompt` to boost recognition of specific terms:

```typescript
const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  keytermsPrompt: [
    // Product names
    "LangChain",
    "LangGraph", 
    "LangSmith",
    // Technical terms
    "RAG",
    "embeddings",
    "vector store",
    // Custom vocabulary
    "Acme Corp",
  ],
});
```

**Limits:**
- Maximum 100 terms
- Terms longer than 50 characters are ignored

## Client-Side Usage with Temporary Tokens

For browser-based applications, generate temporary tokens server-side:

```typescript
// Server: Generate temporary token
const response = await fetch("https://api.assemblyai.com/v2/realtime/token", {
  method: "POST",
  headers: {
    Authorization: process.env.ASSEMBLYAI_API_KEY!,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ expires_in: 3600 }),
});
const { token } = await response.json();

// Client: Use temporary token
const stt = new AssemblyAISpeechToText({
  apiKey: "", // Not needed when using token
  token: token,
});
```

## Complete Example

```typescript
import { createVoiceAgent, createThinkingFillerMiddleware } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";
import { ChatOpenAI } from "@langchain/openai";

const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  speechModel: "universal-streaming-english",
  
  // Boost recognition for domain terms
  keytermsPrompt: ["LangChain", "voice agent", "AI assistant"],
  
  // Log all transcription events
  onTurn: (turn) => {
    if (!turn.turn_is_formatted) {
      process.stdout.write(`\r[Partial] ${turn.transcript}`);
    }
  },
  onEndOfTurn: (turn) => {
    console.log(`\n[Final] ${turn.transcript}`);
  },
});

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  prompt: "You are a helpful voice assistant.",
  
  stt,
  tts: new ElevenLabsTextToSpeech({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: process.env.ELEVENLABS_VOICE_ID!,
  }),
  
  middleware: [
    createThinkingFillerMiddleware({ thresholdMs: 1000 }),
  ],
});

// Process audio
const audioOutput = voiceAgent.process(audioInputStream);
```

## License

MIT
