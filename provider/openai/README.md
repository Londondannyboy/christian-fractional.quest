# @create-voice-agent/openai 🤖

OpenAI Speech-to-Text (Whisper) and Text-to-Speech integration for [create-voice-agent](../../core/README.md).

This package provides both STT and TTS capabilities using [OpenAI's Audio API](https://platform.openai.com/docs/guides/speech-to-text).

## Installation

```bash
npm install @create-voice-agent/openai
# or
pnpm add @create-voice-agent/openai
```

## Quick Start

```typescript
import { createVoiceAgent } from "create-voice-agent";
import { OpenAISpeechToText, OpenAITextToSpeech } from "@create-voice-agent/openai";

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  
  stt: new OpenAISpeechToText({
    apiKey: process.env.OPENAI_API_KEY!,
    // Built-in VAD automatically buffers audio until speech ends
    partialTranscripts: true,  // See partial results as user speaks
  }),
  
  tts: new OpenAITextToSpeech({
    apiKey: process.env.OPENAI_API_KEY!,
    voice: "nova",
  }),
});
```

## Speech-to-Text (Whisper)

### `OpenAISpeechToText`

Speech-to-Text using OpenAI's Whisper model with **built-in VAD** (Voice Activity Detection).

> ✅ **No external VAD required!** Unlike raw Whisper, this implementation includes energy-based VAD that automatically buffers audio and detects speech boundaries.

This implementation automatically:

- Buffers audio until speech ends (using energy-based VAD)
- Only triggers `onSpeechStart` when actual speech is detected
- Provides partial transcriptions as you speak
- Filters out echo/noise from TTS playback

```typescript
import { OpenAISpeechToText } from "@create-voice-agent/openai";

const stt = new OpenAISpeechToText({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "whisper-1",
  
  // Callback when speech is detected (for barge-in)
  onSpeechStart: () => console.log("User started speaking..."),
  
  // Enable real-time partial transcriptions
  partialTranscripts: true,
  partialIntervalMs: 1000,
});
```

### STT Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | OpenAI API key |
| `model` | `string` | `"whisper-1"` | Whisper model ID |
| `sampleRate` | `number` | `16000` | Input audio sample rate |
| `onSpeechStart` | `() => void` | - | Callback when VAD detects speech start |
| `minAudioDurationMs` | `number` | `500` | Minimum audio duration to transcribe (filters noise) |
| `vadEnergyThreshold` | `number` | `500` | Energy threshold for speech detection |
| `vadSilenceFrames` | `number` | `15` | Silence frames (~480ms) before speech end |
| `partialTranscripts` | `boolean` | `true` | Enable partial transcriptions during speech |
| `partialIntervalMs` | `number` | `1000` | Interval between partial transcription requests |

### Partial Transcriptions

When `partialTranscripts` is enabled, you'll see real-time transcriptions in the logs as the user speaks:

```txt
OpenAI STT [VAD]: Speech started (energy: 1523, threshold: 500)
OpenAI STT [buffering]: 1.00s | 32.0KB | energy: avg=2654, peak=5234
OpenAI STT [partial]: "I would like a" (1.05s)
OpenAI STT [buffering]: 2.00s | 64.0KB | energy: avg=2298, peak=5234
OpenAI STT [partial]: "I would like a turkey sandwich" (2.10s)
OpenAI STT [VAD]: Speech ended | duration: 2.85s | size: 91.2KB
OpenAI STT [transcribed]: "I would like a turkey sandwich with cheese" | audio: 2.85s | latency: 312ms
```

> **Note:** Partial transcripts use additional Whisper API calls. Set `partialTranscripts: false` to disable and reduce API costs.

### VAD Tuning

The built-in VAD can be tuned for different environments:

```typescript
const stt = new OpenAISpeechToText({
  apiKey: process.env.OPENAI_API_KEY!,
  
  // For noisy environments - increase thresholds
  vadEnergyThreshold: 800,      // Higher = less sensitive
  minAudioDurationMs: 700,      // Longer minimum to filter noise
  vadSilenceFrames: 20,         // ~640ms silence before end
  
  // For quiet environments - decrease thresholds
  vadEnergyThreshold: 300,      // Lower = more sensitive
  minAudioDurationMs: 300,      // Shorter minimum
  vadSilenceFrames: 10,         // ~320ms silence before end
});
```

## Text-to-Speech

### `OpenAITextToSpeech`

Text-to-Speech using OpenAI's TTS API.

> ⚠️ **Note:** OpenAI TTS outputs **MP3 audio**, not PCM. You may need additional transforms to convert to PCM for certain playback systems.

```typescript
import { OpenAITextToSpeech } from "@create-voice-agent/openai";

const tts = new OpenAITextToSpeech({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "tts-1",
  voice: "nova",
  
  // Callbacks
  onAudioComplete: () => console.log("Finished speaking"),
  onInterrupt: () => console.log("Speech interrupted"),
});
```

### TTS Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | OpenAI API key |
| `model` | `string` | `"tts-1"` | TTS model ID |
| `voice` | `OpenAIVoice` | `"alloy"` | Voice to use |

### TTS Models

| Model | Description | Use Case |
|-------|-------------|----------|
| `tts-1` | Optimized for speed | Real-time applications |
| `tts-1-hd` | Higher quality | Pre-recorded content |

### Available Voices

| Voice | Description |
|-------|-------------|
| `alloy` | Neutral and balanced |
| `echo` | Warm and conversational |
| `fable` | Expressive and dramatic |
| `onyx` | Deep and authoritative |
| `nova` | Friendly and upbeat |
| `shimmer` | Soft and gentle |

### Instance Methods

#### `interrupt()`

Interrupt the current speech generation.

```typescript
// User started speaking - stop the agent
tts.interrupt();
```

### Callbacks

#### `onAudioComplete`

Called when speech generation finishes.

```typescript
const tts = new OpenAITextToSpeech({
  apiKey: process.env.OPENAI_API_KEY!,
  voice: "nova",
  onAudioComplete: () => {
    console.log("Agent finished speaking");
  },
});
```

#### `onInterrupt`

Called when speech is interrupted.

```typescript
const tts = new OpenAITextToSpeech({
  apiKey: process.env.OPENAI_API_KEY!,
  voice: "nova",
  onInterrupt: () => {
    console.log("Speech was interrupted");
  },
});
```

## Audio Format Considerations

### STT Input

OpenAI Whisper expects audio in common formats. This integration:

- Accepts raw PCM (16-bit, mono, 16kHz)
- Automatically wraps in WAV headers before sending to the API

### TTS Output

OpenAI TTS returns **MP3 audio**. If your pipeline expects PCM:

```typescript
import { createVoiceMiddleware } from "create-voice-agent";

// You'll need an MP3-to-PCM decoder transform
const mp3DecoderMiddleware = createVoiceMiddleware("MP3Decoder", {
  afterTTS: [new MP3ToPCMTransform()], // Implement or use a library
});
```

## Complete Example

```typescript
import { 
  createVoiceAgent, 
  createThinkingFillerMiddleware,
} from "create-voice-agent";
import { OpenAISpeechToText, OpenAITextToSpeech } from "@create-voice-agent/openai";
import { ChatOpenAI } from "@langchain/openai";

const tts = new OpenAITextToSpeech({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "tts-1",
  voice: "nova",
  onAudioComplete: () => console.log("Agent finished speaking"),
});

const stt = new OpenAISpeechToText({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "whisper-1",
  // Built-in VAD handles buffering automatically
  partialTranscripts: true,
  onSpeechStart: () => {
    // Barge-in: interrupt TTS when user starts speaking
    tts.interrupt();
  },
});

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  prompt: "You are a helpful voice assistant.",
  
  stt,
  tts,
  
  middleware: [
    createThinkingFillerMiddleware({ thresholdMs: 1500 }),
  ],
});

// Process audio streams
const audioOutput = voiceAgent.process(audioInputStream);
```

## When to Use OpenAI vs Other Providers

### Use OpenAI When

- You want a single API key for STT, TTS, and LLM
- You need high-accuracy transcription (Whisper is excellent)
- You want built-in VAD and partial transcription support
- MP3 output format works for your use case

### Consider Alternatives When

- You need lower-latency streaming STT → Use [AssemblyAI](../assemblyai/README.md)
- You need PCM output or more voice options → Use [ElevenLabs](../elevenlabs/README.md)
- You need emotionally expressive voices → Use [Hume](../hume/README.md)

## License

MIT
