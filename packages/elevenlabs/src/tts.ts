/**
 * ElevenLabs Text-to-Speech Model
 *
 * Uses HTTP streaming API for reliable audio generation.
 * Input: Text string (sentences/tokens)
 * Output: PCM audio buffer (16-bit, mono, 16kHz)
 */

import { BaseTextToSpeechModel, type TextToSpeechModelParams } from '../../../core/src/index.js'

/**
 * Voice settings for controlling speech characteristics.
 */
export interface ElevenLabsVoiceSettings {
  /**
   * Controls the stability of the generated speech. Lower values introduce more
   * variability and expressiveness, while higher values make the speech more consistent.
   * @default 0.5
   */
  stability?: number
  /**
   * Controls how closely the AI should match the original voice. Higher values
   * make the output more similar to the reference voice.
   * @default 0.75
   */
  similarityBoost?: number
  /**
   * Enables or disables the speaker boost feature which can enhance voice clarity.
   */
  useSpeakerBoost?: boolean
  /**
   * Controls the expressiveness/style of the speech. Higher values add more style.
   * Only available for certain models.
   */
  style?: number
  /**
   * Controls the speed of the generated speech. Values typically range from 0.5 to 2.0.
   */
  speed?: number
}

/**
 * Output format options for the generated audio.
 * Format: codec_sampleRate_bitrate
 *
 * @example "pcm_16000" - PCM at 16kHz (default)
 * @example "mp3_44100_128" - MP3 at 44.1kHz, 128kbps
 */
export type ElevenLabsOutputFormat =
  | 'mp3_22050_32'
  | 'mp3_24000_48'
  | 'mp3_44100_32'
  | 'mp3_44100_64'
  | 'mp3_44100_96'
  | 'mp3_44100_128'
  | 'mp3_44100_192'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_22050'
  | 'pcm_24000'
  | 'pcm_32000'
  | 'pcm_44100'
  | 'pcm_48000'
  | 'ulaw_8000'
  | 'alaw_8000'
  | 'opus_48000_32'
  | 'opus_48000_64'
  | 'opus_48000_96'
  | 'opus_48000_128'
  | 'opus_48000_192'

/**
 * Text normalization mode for processing input text.
 */
export type ElevenLabsTextNormalization = 'auto' | 'on' | 'off'

/**
 * Configuration options for ElevenLabs Text-to-Speech.
 */
export interface ElevenLabsOptions extends TextToSpeechModelParams {
  /**
   * Your ElevenLabs API key. Required for authentication.
   * @see https://elevenlabs.io/app/settings/api-keys
   */
  apiKey: string

  /**
   * ID of the voice to use for speech generation.
   * Use the ElevenLabs API to list available voices: GET /v1/voices
   * @see https://elevenlabs.io/docs/api-reference/voices/search
   */
  voiceId: string

  /**
   * Identifier of the model to use for speech generation.
   * The model must support text-to-speech (check `can_do_text_to_speech` property).
   * @default "eleven_flash_v2_5"
   * @see https://elevenlabs.io/docs/api-reference/models
   */
  modelId?: string

  /**
   * ISO 639-1 language code to enforce for the model and text normalization.
   * If the model doesn't support the provided language, an error will be returned.
   * @example "en", "es", "ja"
   */
  languageCode?: string

  /**
   * Voice settings to override the stored settings for the given voice.
   * These are applied only to the current request.
   */
  voiceSettings?: ElevenLabsVoiceSettings

  /**
   * Controls the stability of the generated speech.
   * @deprecated Use `voiceSettings.stability` instead
   * @default 0.5
   */
  stability?: number

  /**
   * Controls voice similarity matching.
   * @deprecated Use `voiceSettings.similarityBoost` instead
   * @default 0.75
   */
  similarityBoost?: number

  /**
   * Output format for the audio stream.
   * @default "pcm_16000"
   */
  outputFormat?: ElevenLabsOutputFormat

  /**
   * Latency optimization level for streaming.
   * - 0: Default mode (no optimizations)
   * - 1: Normal optimizations (~50% of max improvement)
   * - 2: Strong optimizations (~75% of max improvement)
   * - 3: Max optimizations
   * - 4: Max optimizations with text normalizer disabled (best latency, may mispronounce numbers/dates)
   * @default 3
   */
  optimizeStreamingLatency?: 0 | 1 | 2 | 3 | 4

  /**
   * Seed for deterministic generation. When specified, the system will attempt
   * to sample deterministically so repeated requests with the same seed and
   * parameters return the same result. Determinism is not guaranteed.
   * Must be an integer between 0 and 4294967295.
   */
  seed?: number

  /**
   * Text that came before the current request. Can improve speech continuity
   * when concatenating multiple generations or influence the current generation.
   */
  previousText?: string

  /**
   * Text that comes after the current request. Can improve speech continuity
   * when concatenating multiple generations or influence the current generation.
   */
  nextText?: string

  /**
   * Controls text normalization behavior.
   * - "auto": System decides whether to apply normalization (e.g., spelling out numbers)
   * - "on": Always apply text normalization
   * - "off": Skip text normalization
   *
   * Note: For 'eleven_turbo_v2_5' and 'eleven_flash_v2_5' models, text normalization
   * can only be enabled with Enterprise plans.
   * @default "auto"
   */
  applyTextNormalization?: ElevenLabsTextNormalization

  /**
   * Enables language-specific text normalization for proper pronunciation.
   * Currently only supported for Japanese.
   *
   * ⚠️ WARNING: This can significantly increase request latency.
   * @default false
   */
  applyLanguageTextNormalization?: boolean

  /**
   * Time in milliseconds to wait after the last text token before sending
   * the accumulated text to ElevenLabs. This allows batching tokens for
   * more natural speech generation.
   * @default 300
   */
  flushDelayMs?: number
}

export class ElevenLabsTextToSpeech extends BaseTextToSpeechModel {
  readonly provider = 'elevenlabs'
  private _interrupt: () => void = () => {}

  interrupt(): void {
    this._interrupt()
  }

  constructor(options: ElevenLabsOptions) {
    const {
      apiKey,
      voiceId,
      modelId = 'eleven_flash_v2_5',
      languageCode,
      voiceSettings,
      stability = 0.5,
      similarityBoost = 0.75,
      outputFormat = 'pcm_16000',
      optimizeStreamingLatency = 3,
      seed,
      previousText,
      nextText,
      applyTextNormalization,
      applyLanguageTextNormalization,
      flushDelayMs = 300,
      onInterrupt,
      onAudioComplete,
    } = options

    // Build voice settings, preferring new voiceSettings object over deprecated individual props
    const resolvedVoiceSettings = {
      stability: voiceSettings?.stability ?? stability,
      similarity_boost: voiceSettings?.similarityBoost ?? similarityBoost,
      ...(voiceSettings?.useSpeakerBoost !== undefined && {
        use_speaker_boost: voiceSettings.useSpeakerBoost,
      }),
      ...(voiceSettings?.style !== undefined && { style: voiceSettings.style }),
      ...(voiceSettings?.speed !== undefined && { speed: voiceSettings.speed }),
    }

    // Callback to notify audio complete listeners (assigned after super())
    let notifyAudioCompleteCallback: () => void = () => {}

    let activeController: TransformStreamDefaultController<Buffer> | null = null
    let textBuffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let isShuttingDown = false
    let isInterrupted = false
    let currentAbortController: AbortController | null = null
    let pendingRequest: Promise<void> | null = null

    const getStreamUrl = () => {
      const params = new URLSearchParams({
        output_format: outputFormat,
        optimize_streaming_latency: String(optimizeStreamingLatency),
      })
      return `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?${params}`
    }

    const streamAudio = async (text: string): Promise<void> => {
      if (!text.trim() || isInterrupted || isShuttingDown) return

      currentAbortController = new AbortController()
      const signal = currentAbortController.signal

      console.log(
        `ElevenLabs: Streaming TTS for "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
      )

      try {
        const requestBody: Record<string, unknown> = {
          text,
          model_id: modelId,
          voice_settings: resolvedVoiceSettings,
        }

        // Add optional parameters only if provided
        if (languageCode) requestBody.language_code = languageCode
        if (seed !== undefined) requestBody.seed = seed
        if (previousText) requestBody.previous_text = previousText
        if (nextText) requestBody.next_text = nextText
        if (applyTextNormalization) requestBody.apply_text_normalization = applyTextNormalization
        if (applyLanguageTextNormalization !== undefined) {
          requestBody.apply_language_text_normalization = applyLanguageTextNormalization
        }

        const response = await fetch(getStreamUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
          signal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`)
        }

        if (!response.body) {
          throw new Error('No response body from ElevenLabs')
        }

        const contentType = response.headers.get('content-type')
        console.log(`ElevenLabs: Response content-type: ${contentType}`)

        const reader = response.body.getReader()
        let totalBytes = 0
        let chunkCount = 0

        // Buffer to hold incomplete samples (PCM is 16-bit = 2 bytes per sample)
        let pendingByte: number | null = null

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            console.log(`ElevenLabs: Stream complete (${chunkCount} chunks, ${totalBytes} bytes)`)
            break
          }

          if (isInterrupted || signal.aborted) {
            console.log('ElevenLabs: Stream aborted')
            reader.cancel()
            break
          }

          if (value && activeController) {
            let buffer = Buffer.from(value)
            totalBytes += buffer.length
            chunkCount++

            // Log first chunk for debugging
            if (chunkCount === 1) {
              console.log(
                `ElevenLabs: First chunk size: ${buffer.length} bytes, first 16 bytes: ${buffer.slice(0, 16).toString('hex')}`
              )
            }

            // Handle sample alignment for 16-bit PCM
            // If we have a pending byte from the previous chunk, prepend it
            if (pendingByte !== null) {
              const newBuffer = Buffer.alloc(buffer.length + 1)
              newBuffer[0] = pendingByte
              buffer.copy(newBuffer, 1)
              buffer = newBuffer
              pendingByte = null
            }

            // If odd number of bytes, save the last byte for the next chunk
            if (buffer.length % 2 !== 0) {
              pendingByte = buffer[buffer.length - 1]
              buffer = buffer.subarray(0, buffer.length - 1)
            }

            // Only enqueue if we have data
            if (buffer.length > 0) {
              try {
                activeController.enqueue(buffer)
              } catch {
                console.warn('ElevenLabs: Controller closed, stopping audio output')
                reader.cancel()
                break
              }
            }
          }
        }

        if (!isInterrupted && !signal.aborted) {
          // Notify user callback and registered listeners
          onAudioComplete?.()
          notifyAudioCompleteCallback()
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('ElevenLabs: Request aborted')
        } else {
          console.error('ElevenLabs: Streaming error:', err)
          throw err
        }
      } finally {
        currentAbortController = null
      }
    }

    const scheduleFlush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
      }

      flushTimer = setTimeout(async () => {
        flushTimer = null
        if (textBuffer.trim() && !isShuttingDown && !isInterrupted) {
          const text = textBuffer
          textBuffer = ''
          pendingRequest = streamAudio(text)
          await pendingRequest
          pendingRequest = null
        }
      }, flushDelayMs)
    }

    const cancelScheduledFlush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
    }

    const interruptTTS = () => {
      if (isInterrupted) return

      console.log('ElevenLabs: Interrupted by user (barge-in)')
      isInterrupted = true

      // Cancel pending flush
      cancelScheduledFlush()

      // Clear text buffer
      textBuffer = ''

      // Abort current request
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
      }

      onInterrupt?.()

      // Reset interrupted state after a brief delay
      setTimeout(() => {
        isInterrupted = false
      }, 100)
    }

    super({
      start(controller) {
        activeController = controller
      },

      async transform(token) {
        if (isShuttingDown || isInterrupted) return
        if (!token || token.length === 0) return

        // Wait for any pending request to complete before accumulating new text
        if (pendingRequest) {
          await pendingRequest
        }

        textBuffer += token
        scheduleFlush()
      },

      async flush() {
        console.log('ElevenLabs: Flushing stream...')
        isShuttingDown = true

        // Cancel any scheduled flush
        cancelScheduledFlush()

        // Wait for pending request
        if (pendingRequest) {
          await pendingRequest
        }

        // Process remaining text buffer
        if (textBuffer.trim() && !isInterrupted) {
          const text = textBuffer
          textBuffer = ''
          await streamAudio(text)
        }
      },
    })

    this._interrupt = interruptTTS

    // Assign callback now that `this` is available
    notifyAudioCompleteCallback = () => this.notifyAudioComplete()
  }
}
