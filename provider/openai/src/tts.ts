/**
 * OpenAI Text-to-Speech Model
 *
 * Input: Text string
 * Output: PCM audio buffer (16-bit, mono, 16kHz)
 *
 * Uses OpenAI's TTS API with PCM output format, resampled from 24kHz to 16kHz
 * for compatibility with standard voice pipelines.
 */

import { OpenAI } from 'openai'
import { BaseTextToSpeechModel, type TextToSpeechModelParams } from 'create-voice-agent'

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export interface OpenAITTSOptions extends TextToSpeechModelParams {
  apiKey: string
  model?: string
  voice?: OpenAIVoice
  /**
   * Output sample rate. OpenAI outputs 24kHz PCM, which is resampled to this rate.
   * @default 16000
   */
  sampleRate?: number
}

/**
 * Resample PCM audio from one sample rate to another using linear interpolation.
 * Input and output are 16-bit signed PCM.
 */
function resamplePCM(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return input

  const ratio = fromRate / toRate
  const inputSamples = input.length / 2
  const outputSamples = Math.floor(inputSamples / ratio)
  const output = Buffer.alloc(outputSamples * 2)

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1)
    const fraction = srcIndex - srcIndexFloor

    const sample1 = input.readInt16LE(srcIndexFloor * 2)
    const sample2 = input.readInt16LE(srcIndexCeil * 2)

    // Linear interpolation
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction)
    output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2)
  }

  return output
}

export class OpenAITextToSpeech extends BaseTextToSpeechModel {
  readonly provider = 'openai'
  private isInterrupted = false
  private _speak: (text: string) => ReadableStream<Buffer>

  interrupt(): void {
    console.log('OpenAI TTS: Interrupted by user (barge-in)')
    this.isInterrupted = true
    setTimeout(() => {
      this.isInterrupted = false
    }, 100)
  }

  speak(text: string): ReadableStream<Buffer> {
    return this._speak(text)
  }

  constructor(options: OpenAITTSOptions) {
    const {
      apiKey,
      model = 'tts-1',
      voice = 'alloy',
      sampleRate = 16000,
      onInterrupt,
      onAudioComplete,
    } = options

    const openai = new OpenAI({ apiKey })
    const instance = { isInterrupted: false }

    // OpenAI PCM output is always 24kHz
    const openaiSampleRate = 24000
    const chunkSize = 4096

    // Generate speech and return resampled PCM buffer
    const generateSpeech = async (text: string, logPrefix: string): Promise<Buffer> => {
      const displayText = text.length > 50 ? `${text.substring(0, 50)}...` : text
      console.log(`${logPrefix}: Generating speech for: "${displayText}"`)

      const response = await openai.audio.speech.create({
        model,
        voice,
        input: text,
        response_format: 'pcm',
      })

      const rawBuffer = Buffer.from(await response.arrayBuffer())
      console.log(`${logPrefix}: Received ${(rawBuffer.length / 1024).toFixed(1)}KB PCM audio (24kHz)`)

      const resampledBuffer = resamplePCM(rawBuffer, openaiSampleRate, sampleRate)
      console.log(
        `${logPrefix}: Resampled to ${sampleRate}Hz (${(resampledBuffer.length / 1024).toFixed(1)}KB)`
      )

      return resampledBuffer
    }

    // Stream buffer in chunks to controller
    const streamChunks = (
      buffer: Buffer,
      controller: { enqueue: (chunk: Buffer) => void },
      checkInterrupt?: () => boolean
    ): boolean => {
      for (let i = 0; i < buffer.length; i += chunkSize) {
        if (checkInterrupt?.()) {
          return false
        }
        const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length))
        controller.enqueue(chunk)
      }
      return true
    }

    super({
      async transform(text, controller) {
        if (instance.isInterrupted) {
          onInterrupt?.()
          return
        }

        try {
          const resampledBuffer = await generateSpeech(text, 'OpenAI TTS')

          const completed = streamChunks(resampledBuffer, controller, () => {
            if (instance.isInterrupted) {
              console.log('OpenAI TTS: Stream interrupted')
              onInterrupt?.()
              return true
            }
            return false
          })

          if (completed) {
            onAudioComplete?.()
          }
        } catch (err) {
          console.error('OpenAI TTS Error:', err)
        }
      },
    })

    // Store reference for interrupt method
    Object.defineProperty(this, 'isInterrupted', {
      get: () => instance.isInterrupted,
      set: (value) => {
        instance.isInterrupted = value
      },
    })

    // Implement speak method for one-off TTS
    this._speak = (text: string): ReadableStream<Buffer> => {
      return new ReadableStream<Buffer>({
        async start(controller) {
          try {
            const resampledBuffer = await generateSpeech(text, 'OpenAI speak')
            streamChunks(resampledBuffer, controller)
            controller.close()
          } catch (err) {
            console.error('OpenAI speak Error:', err)
            controller.close()
          }
        },
      })
    }
  }
}
