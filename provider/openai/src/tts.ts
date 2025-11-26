/**
 * OpenAI Text-to-Speech Model
 *
 * Input: Text string
 * Output: Audio buffer (MP3 format)
 *
 * Note: OpenAI TTS returns MP3 audio, not PCM.
 * You may need additional transforms to convert to PCM for playback.
 */

import { OpenAI } from 'openai'
import { BaseTextToSpeechModel, type TextToSpeechModelParams } from 'create-voice-agent'

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export interface OpenAITTSOptions extends TextToSpeechModelParams {
  apiKey: string
  model?: string
  voice?: OpenAIVoice
}

export class OpenAITextToSpeech extends BaseTextToSpeechModel {
  readonly provider = 'openai'
  private isInterrupted = false

  interrupt(): void {
    console.log('OpenAI TTS: Interrupted by user (barge-in)')
    this.isInterrupted = true
    setTimeout(() => {
      this.isInterrupted = false
    }, 100)
  }

  constructor(options: OpenAITTSOptions) {
    const { apiKey, model = 'tts-1', voice = 'alloy', onInterrupt, onAudioComplete } = options

    const openai = new OpenAI({ apiKey })
    const instance = { isInterrupted: false }

    super({
      async transform(text, controller) {
        if (instance.isInterrupted) {
          onInterrupt?.()
          return
        }

        try {
          console.log(`OpenAI TTS: Generating speech for: "${text.substring(0, 50)}..."`)

          const mp3Response = await openai.audio.speech.create({
            model,
            voice,
            input: text,
            response_format: 'mp3',
          })

          const buffer = Buffer.from(await mp3Response.arrayBuffer())
          controller.enqueue(buffer)

          onAudioComplete?.()
        } catch (err) {
          console.error('OpenAI TTS Error:', err)
          controller.error(err)
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
  }
}
