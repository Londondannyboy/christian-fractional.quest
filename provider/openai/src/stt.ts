/**
 * OpenAI Speech-to-Text (Whisper) Model
 * 
 * Input: PCM audio buffer (16-bit, mono)
 * Output: Transcribed text string
 * 
 * Note: OpenAI Whisper doesn't support real-time streaming.
 * Audio is sent in batches. For real-time use cases, combine with VADBufferTransform.
 */

import { OpenAI, toFile } from "openai";
import { BaseSpeechToTextModel, type SpeechToTextModelParams } from "create-voice-agent";

export interface OpenAISTTOptions extends SpeechToTextModelParams {
  apiKey: string;
  model?: string;
}

/**
 * Creates a WAV header for PCM audio data.
 */
function createWavHeader(len: number): Buffer {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + len, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28); // Byte Rate (16000 * 2)
  buffer.writeUInt16LE(2, 32); // Block align
  buffer.writeUInt16LE(16, 34); // Bits
  buffer.write("data", 36);
  buffer.writeUInt32LE(len, 40);
  return buffer;
}

export class OpenAISpeechToText extends BaseSpeechToTextModel {
  readonly provider = "openai";

  constructor(options: OpenAISTTOptions) {
    const { apiKey, model = "whisper-1", onSpeechStart } = options;
    const openai = new OpenAI({ apiKey });

    super({
      async transform(chunk, controller) {
        try {
          // Notify speech start if callback is provided
          onSpeechStart?.();

          // Chunk is raw PCM 16-bit 16kHz
          const header = createWavHeader(chunk.length);
          const wavData = Buffer.concat([header, chunk]);

          const file = await toFile(wavData, "input.wav", { type: "audio/wav" });

          const response = await openai.audio.transcriptions.create({
            file,
            model,
          });

          const text = response.text;
          if (text && text.trim().length > 0) {
            console.log(`OpenAI STT: Transcribed: "${text}"`);
            controller.enqueue(text);
          } else {
            console.log("OpenAI STT: Transcription empty, ignoring.");
          }
        } catch (err) {
          console.error("OpenAI STT Error:", err);
        }
      },
    });
  }
}

