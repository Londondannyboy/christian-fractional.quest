# @create-voice-agent/hume 🎭

Hume AI Text-to-Speech integration for [create-voice-agent](../../core/README.md).

This package provides emotionally expressive voice synthesis using [Hume AI's streaming TTS API](https://dev.hume.ai/docs/text-to-speech-tts/overview).

## Installation

```bash
npm install @create-voice-agent/hume
# or
pnpm add @create-voice-agent/hume
```

## Quick Start

```typescript
import { createVoiceAgent } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { HumeTextToSpeech } from "@create-voice-agent/hume";

const voiceAgent = createVoiceAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  
  stt: new AssemblyAISpeechToText({ /* ... */ }),
  
  tts: new HumeTextToSpeech({
    apiKey: process.env.HUME_API_KEY!,
  }),
});
```

## API Reference

### `HumeTextToSpeech`

Streaming Text-to-Speech model using Hume AI's WebSocket API with instant mode for low latency.

```typescript
import { HumeTextToSpeech } from "@create-voice-agent/hume";

const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  
  // Optional configuration
  voiceName: "Ava Song",
  voiceProvider: "HUME_AI",
  outputSampleRate: 16000,
  
  // Callbacks
  onAudioComplete: () => console.log("Finished speaking"),
  onInterrupt: () => console.log("Speech interrupted"),
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | Hume AI API key |
| `voiceName` | `string` | `"Ava Song"` | Name of the voice to use |
| `voiceProvider` | `"HUME_AI" \| "CUSTOM_VOICE"` | `"HUME_AI"` | Voice provider |
| `outputSampleRate` | `number` | `16000` | Output audio sample rate (Hz) |

### Available Voices

Hume AI provides a variety of expressive voices. Here are some of the built-in options:

| Voice Name | Description |
|------------|-------------|
| `Ava Song` | Default voice, warm and expressive |
| `Kora` | Friendly and conversational |
| `Dacher` | Calm and professional |
| `Aura` | Gentle and soothing |
| `Finn` | Energetic and upbeat |

To get the full list of available voices, use the Hume API:

```typescript
const response = await fetch("https://api.hume.ai/v0/tts/voices", {
  headers: { "X-Hume-Api-Key": process.env.HUME_API_KEY! },
});
const voices = await response.json();
console.log(voices);
```

### Voice Providers

| Provider | Description |
|----------|-------------|
| `HUME_AI` | Built-in Hume AI voices (default) |
| `CUSTOM_VOICE` | Your custom cloned voices |

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
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  voiceName: "Kora",
});

// Generate and play a greeting
const audioStream = tts.speak("Hello! I'm here to help. What's on your mind?");

for await (const chunk of audioStream) {
  // Send to audio output (speakers, WebRTC, etc.)
  audioOutput.write(chunk);
}
```

The `speak()` method opens a dedicated WebSocket connection and uses the same voice configuration as the main TTS pipeline.

### Callbacks

#### `onAudioComplete`

Called when speech generation finishes and the WebSocket closes.

```typescript
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  onAudioComplete: () => {
    console.log("Agent finished speaking");
  },
});
```

#### `onInterrupt`

Called when speech is interrupted (e.g., by barge-in).

```typescript
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  onInterrupt: () => {
    console.log("Speech was interrupted");
  },
});
```

## Features

### Instant Mode

This integration uses Hume's **instant mode** for the lowest possible latency. Audio starts streaming as soon as text is received, making it ideal for real-time conversational AI.

### Automatic Resampling

Hume outputs audio at 48kHz. This integration automatically resamples to your target sample rate (default: 16kHz) using linear interpolation.

```typescript
// Output at 8kHz for telephony
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  outputSampleRate: 8000,
});

// Output at 24kHz for higher quality
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  outputSampleRate: 24000,
});
```

### PCM Output

Audio is output as raw PCM (16-bit signed, little-endian, mono) for easy integration with audio pipelines.

## Custom Voices

To use a custom cloned voice:

```typescript
const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  voiceName: "my-custom-voice",
  voiceProvider: "CUSTOM_VOICE",
});
```

See [Hume's voice cloning documentation](https://dev.hume.ai/docs/text-to-speech-tts/voice-creation) for creating custom voices.

## Complete Example

```typescript
import { createVoiceAgent, createThinkingFillerMiddleware } from "create-voice-agent";
import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
import { HumeTextToSpeech } from "@create-voice-agent/hume";
import { ChatOpenAI } from "@langchain/openai";

const tts = new HumeTextToSpeech({
  apiKey: process.env.HUME_API_KEY!,
  voiceName: "Kora",
  outputSampleRate: 16000,
  
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
  prompt: "You are an empathetic voice assistant. Respond with warmth and understanding.",
  
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
