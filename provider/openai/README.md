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
import { createVoiceAgent, VADBufferTransform, createVoiceMiddleware } from "create-voice-agent";
import { OpenAISpeechToText, OpenAITextToSpeech } from "@create-voice-agent/openai";

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  
  stt: new OpenAISpeechToText({
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  
  tts: new OpenAITextToSpeech({
    apiKey: process.env.OPENAI_API_KEY!,
    voice: "nova",
  }),
  
  // Recommended: Use VAD to buffer audio for Whisper
  middleware: [
    createVoiceMiddleware("VAD", {
      beforeSTT: [new VADBufferTransform()],
    }),
  ],
});
```

## Speech-to-Text (Whisper)

### `OpenAISpeechToText`

Batch-based Speech-to-Text using OpenAI's Whisper model.

> ⚠️ **Note:** Whisper is **not a streaming model**. Audio is transcribed in batches. For real-time applications, use `VADBufferTransform` to buffer audio until speech ends, then send complete utterances to Whisper.

```typescript
import { OpenAISpeechToText } from "@create-voice-agent/openai";

const stt = new OpenAISpeechToText({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "whisper-1",
  
  // Callback when processing starts
  onSpeechStart: () => console.log("Processing audio..."),
});
```

### STT Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | OpenAI API key |
| `model` | `string` | `"whisper-1"` | Whisper model ID |
| `sampleRate` | `number` | `16000` | Input audio sample rate |
| `onSpeechStart` | `() => void` | - | Callback when transcription starts |

### Using with VAD

For real-time voice applications, combine Whisper with Voice Activity Detection:

```typescript
import { 
  createVoiceAgent, 
  VADBufferTransform, 
  createVoiceMiddleware 
} from "create-voice-agent";
import { OpenAISpeechToText } from "@create-voice-agent/openai";

// VAD buffers audio until speech ends, then sends to Whisper
const vadMiddleware = createVoiceMiddleware("VAD", {
  beforeSTT: [
    new VADBufferTransform({
      sampleRate: 16000,
      minSpeechFrames: 4,
      onSpeechEnd: (audio) => console.log(`Buffered ${audio.length} bytes`),
    }),
  ],
});

const voiceAgent = createVoiceAgent({
  stt: new OpenAISpeechToText({
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  // ...
  middleware: [vadMiddleware],
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
  VADBufferTransform,
  createVoiceMiddleware,
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
});

// Use VAD for buffering audio before sending to Whisper
const vadMiddleware = createVoiceMiddleware("VAD", {
  beforeSTT: [new VADBufferTransform({ sampleRate: 16000 })],
});

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  prompt: "You are a helpful voice assistant.",
  
  stt,
  tts,
  
  middleware: [
    vadMiddleware,
    createThinkingFillerMiddleware({ thresholdMs: 1500 }),
  ],
});

// Process audio streams
const audioOutput = voiceAgent.process(audioInputStream);
```

## When to Use OpenAI vs Other Providers

### Use OpenAI When:
- You want a single API key for STT, TTS, and LLM
- Batch transcription latency is acceptable
- You need high-accuracy transcription (Whisper is excellent)
- MP3 output format works for your use case

### Consider Alternatives When:
- You need real-time streaming STT → Use [AssemblyAI](../assemblyai/README.md)
- You need PCM output or more voice options → Use [ElevenLabs](../elevenlabs/README.md)
- You need emotionally expressive voices → Use [Hume](../hume/README.md)

## License

MIT
