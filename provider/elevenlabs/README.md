# @create-voice-agent/elevenlabs 🔊

ElevenLabs Text-to-Speech integration for [create-voice-agent](../../core/README.md).

This package provides high-quality, low-latency voice synthesis using [ElevenLabs' streaming TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech).

## Installation

```bash
npm install @create-voice-agent/elevenlabs
# or
pnpm add @create-voice-agent/elevenlabs
```

## Quick Start

```typescript
import { createVoiceAgent } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  
  stt: new AssemblyAISpeechToText({ /* ... */ }),
  
  tts: new ElevenLabsTextToSpeech({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: process.env.ELEVENLABS_VOICE_ID!,
  }),
});
```

## API Reference

### `ElevenLabsTextToSpeech`

Streaming Text-to-Speech model using ElevenLabs' HTTP API.

```typescript
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";

const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
  
  // Optional configuration
  modelId: "eleven_flash_v2_5",
  outputFormat: "pcm_16000",
  optimizeStreamingLatency: 3,
  
  // Voice settings
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.3,
    speed: 1.0,
    useSpeakerBoost: true,
  },
  
  // Token batching
  flushDelayMs: 300,
  
  // Callbacks
  onAudioComplete: () => console.log("Finished speaking"),
  onInterrupt: () => console.log("Speech interrupted"),
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | ElevenLabs API key |
| `voiceId` | `string` | **required** | Voice ID to use |
| `modelId` | `string` | `"eleven_flash_v2_5"` | TTS model ID |
| `languageCode` | `string` | - | ISO 639-1 language code (e.g., "en", "es") |
| `outputFormat` | `string` | `"pcm_16000"` | Audio output format |
| `optimizeStreamingLatency` | `0-4` | `3` | Latency optimization level |
| `flushDelayMs` | `number` | `300` | Token batching delay (ms) |
| `seed` | `number` | - | Seed for deterministic generation |
| `previousText` | `string` | - | Context text before current request |
| `nextText` | `string` | - | Context text after current request |
| `applyTextNormalization` | `"auto" \| "on" \| "off"` | `"auto"` | Text normalization mode |
| `applyLanguageTextNormalization` | `boolean` | `false` | Language-specific normalization (⚠️ high latency) |

### Voice Settings

Fine-tune the generated speech characteristics:

```typescript
interface ElevenLabsVoiceSettings {
  /** Speech stability (0-1). Lower = more expressive, higher = more consistent */
  stability?: number;
  
  /** Voice similarity (0-1). Higher = closer to reference voice */
  similarityBoost?: number;
  
  /** Enable speaker boost for enhanced clarity */
  useSpeakerBoost?: boolean;
  
  /** Style/expressiveness (0-1). Only for certain models */
  style?: number;
  
  /** Speech speed (0.5-2.0) */
  speed?: number;
}
```

#### Example: Expressive Storytelling Voice

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  voiceSettings: {
    stability: 0.3,        // More expressive
    similarityBoost: 0.8,  // Close to reference
    style: 0.6,            // More stylized
    speed: 0.9,            // Slightly slower
  },
});
```

#### Example: Consistent Professional Voice

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  voiceSettings: {
    stability: 0.8,        // Very consistent
    similarityBoost: 0.7,
    useSpeakerBoost: true, // Enhanced clarity
    speed: 1.0,
  },
});
```

### Models

| Model ID | Description | Best For |
|----------|-------------|----------|
| `eleven_flash_v2_5` | Fastest, lowest latency (default) | Real-time conversations |
| `eleven_turbo_v2_5` | Fast with higher quality | Balanced speed/quality |
| `eleven_multilingual_v2` | Best multilingual support | Non-English or mixed languages |
| `eleven_monolingual_v1` | Original English model | Legacy compatibility |

### Output Formats

#### PCM (Recommended for voice agents)

| Format | Sample Rate | Description |
|--------|-------------|-------------|
| `pcm_8000` | 8 kHz | Telephone quality |
| `pcm_16000` | 16 kHz | Standard voice (default) |
| `pcm_22050` | 22.05 kHz | Higher quality |
| `pcm_24000` | 24 kHz | High quality |
| `pcm_44100` | 44.1 kHz | CD quality |
| `pcm_48000` | 48 kHz | Professional quality |

#### MP3

| Format | Sample Rate | Bitrate |
|--------|-------------|---------|
| `mp3_22050_32` | 22.05 kHz | 32 kbps |
| `mp3_44100_64` | 44.1 kHz | 64 kbps |
| `mp3_44100_128` | 44.1 kHz | 128 kbps |
| `mp3_44100_192` | 44.1 kHz | 192 kbps |

#### Other Formats

| Format | Description |
|--------|-------------|
| `ulaw_8000` | μ-law 8kHz (telephony) |
| `alaw_8000` | A-law 8kHz (telephony) |
| `opus_48000_*` | Opus codec (32-192 kbps) |

### Latency Optimization

Control the trade-off between latency and quality:

| Level | Description | Use Case |
|-------|-------------|----------|
| `0` | No optimization | Highest quality |
| `1` | ~50% latency reduction | Balanced |
| `2` | ~75% latency reduction | Lower latency |
| `3` | Maximum optimization (default) | Real-time conversations |
| `4` | Max + disable text normalizer | Fastest (may mispronounce numbers/dates) |

```typescript
// For real-time conversations (fastest)
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  optimizeStreamingLatency: 4,
});

// For pre-recorded content (highest quality)
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  optimizeStreamingLatency: 0,
});
```

### Token Batching

The TTS model batches incoming text tokens before sending to ElevenLabs for more natural speech generation:

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  
  // Wait 300ms after last token before generating speech
  flushDelayMs: 300,
});
```

- **Lower values** (100-200ms): Faster response, may sound choppy
- **Higher values** (400-500ms): More natural speech, higher latency
- **Default** (300ms): Good balance for most use cases

### Instance Methods

#### `interrupt()`

Interrupt the current speech generation. Useful for barge-in handling.

```typescript
// User started speaking - stop the agent
tts.interrupt();
```

#### `speak(text: string): ReadableStream<Buffer>`

Generate speech directly without going through the voice pipeline. Returns a `ReadableStream` of PCM audio buffers.

This is useful for:

- **Initial greetings** when a call starts
- **System announcements** that bypass the agent
- **One-off speech synthesis** outside of conversations

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
});

// Generate and play a greeting
const audioStream = tts.speak("Welcome to our service! How can I help you?");

for await (const chunk of audioStream) {
  // Send to audio output (speakers, WebRTC, etc.)
  audioOutput.write(chunk);
}
```

The `speak()` method uses the same voice settings and configuration as the main TTS pipeline, ensuring consistent voice quality.

### Callbacks

#### `onAudioComplete`

Called when speech generation finishes (not interrupted).

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  onAudioComplete: () => {
    console.log("Agent finished speaking");
    // Trigger next action, update UI, etc.
  },
});
```

#### `onInterrupt`

Called when speech is interrupted (e.g., by barge-in).

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  onInterrupt: () => {
    console.log("Speech was interrupted");
  },
});
```

## Finding Voice IDs

### Using the API

```typescript
const response = await fetch("https://api.elevenlabs.io/v1/voices", {
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
});
const { voices } = await response.json();

for (const voice of voices) {
  console.log(`${voice.name}: ${voice.voice_id}`);
}
```

### Popular Pre-made Voices

| Voice | ID | Description |
|-------|-----|-------------|
| Rachel | `21m00Tcm4TlvDq8ikWAM` | American female, calm |
| Domi | `AZnzlk1XvdvUeBnXmlld` | American female, strong |
| Bella | `EXAVITQu4vr4xnSDxMaL` | American female, soft |
| Antoni | `ErXwobaYiN019PkySvjV` | American male, warm |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | American male, deep |
| Arnold | `VR6AewLTigWG4xSOukaG` | American male, crisp |
| Adam | `pNInz6obpgDQGcFmaJgB` | American male, deep |
| Sam | `yoZ06aMxZJJ28mfd3POQ` | American male, raspy |

## Multilingual Support

For non-English or mixed-language content:

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  modelId: "eleven_multilingual_v2",
  languageCode: "es", // Spanish
});
```

### Supported Languages

The `eleven_multilingual_v2` model supports 29 languages including:
English, Spanish, French, German, Italian, Portuguese, Polish, Hindi, Arabic, Japanese, Korean, Mandarin, and more.

## Text Normalization

Control how text is processed before synthesis:

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  
  // "auto" - Let the system decide (default)
  // "on"   - Always normalize (spell out numbers, dates, etc.)
  // "off"  - Skip normalization
  applyTextNormalization: "on",
});
```

**Note:** For `eleven_turbo_v2_5` and `eleven_flash_v2_5` models, text normalization requires an Enterprise plan.

## Deterministic Generation

Use seeds for reproducible output:

```typescript
const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  seed: 12345, // 0 to 4294967295
});
```

**Note:** Determinism is not guaranteed but the system will attempt to produce consistent results.

## Complete Example

```typescript
import { createVoiceAgent, createThinkingFillerMiddleware } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";
import { ChatOpenAI } from "@langchain/openai";

const tts = new ElevenLabsTextToSpeech({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: process.env.ELEVENLABS_VOICE_ID!,
  modelId: "eleven_flash_v2_5",
  outputFormat: "pcm_16000",
  optimizeStreamingLatency: 3,
  
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.75,
    useSpeakerBoost: true,
  },
  
  onAudioComplete: () => console.log("Agent finished speaking"),
});

const stt = new AssemblyAISpeechToText({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
  onSpeechStart: () => {
    // Barge-in: user started speaking, interrupt the agent
    tts.interrupt();
  },
});

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  prompt: "You are a friendly voice assistant. Keep responses concise.",
  
  stt,
  tts,
  
  middleware: [
    createThinkingFillerMiddleware({ thresholdMs: 1000 }),
  ],
});

// Process audio streams
const audioOutput = voiceAgent.process(audioInputStream);
```

## License

MIT
