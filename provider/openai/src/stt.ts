/**
 * OpenAI Speech-to-Text (Whisper) Model
 *
 * Input: PCM audio buffer (16-bit, mono)
 * Output: Transcribed text string
 *
 * Note: OpenAI Whisper doesn't support real-time streaming.
 * This implementation includes built-in VAD (Voice Activity Detection) to:
 * 1. Buffer audio until speech ends
 * 2. Only trigger onSpeechStart when actual speech is detected
 * 3. Avoid echo/feedback from TTS playback
 */

import { OpenAI, toFile } from 'openai'
import { BaseSpeechToTextModel, type SpeechToTextModelParams } from 'create-voice-agent'

export interface OpenAISTTOptions extends SpeechToTextModelParams {
  apiKey: string
  model?: string
  /**
   * Minimum audio duration in milliseconds to be considered valid speech.
   * Helps filter out noise and echo. Default: 500ms
   */
  minAudioDurationMs?: number
  /**
   * Energy threshold for VAD speech detection.
   * Higher values = less sensitive to quiet sounds. Default: 500
   */
  vadEnergyThreshold?: number
  /**
   * Number of silence frames (32ms each) before speech is considered ended.
   * Default: 15 (~480ms of silence)
   */
  vadSilenceFrames?: number
  /**
   * Enable partial transcription during speech.
   * When enabled, periodically sends buffered audio to Whisper to show
   * what the user is saying in real-time (like AssemblyAI's partial transcripts).
   * Note: This uses additional API calls. Default: true
   */
  partialTranscripts?: boolean
  /**
   * Interval in milliseconds between partial transcription requests.
   * Only used when partialTranscripts is enabled. Default: 1000ms
   */
  partialIntervalMs?: number
}

/**
 * Creates a WAV header for PCM audio data.
 */
function createWavHeader(len: number, sampleRate = 16000): Buffer {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + len, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // Mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // Byte Rate (sampleRate * 2)
  buffer.writeUInt16LE(2, 32) // Block align
  buffer.writeUInt16LE(16, 34) // Bits
  buffer.write('data', 36)
  buffer.writeUInt32LE(len, 40)
  return buffer
}

/**
 * Calculate RMS energy of an audio frame
 */
function calculateEnergy(frame: Buffer): number {
  let sum = 0
  for (let i = 0; i < frame.length - 1; i += 2) {
    const sample = frame.readInt16LE(i)
    sum += Math.abs(sample)
  }
  return sum / (frame.length / 2)
}

export class OpenAISpeechToText extends BaseSpeechToTextModel {
  readonly provider = 'openai'

  constructor(options: OpenAISTTOptions) {
    const {
      apiKey,
      model = 'whisper-1',
      sampleRate = 16000,
      onSpeechStart,
      minAudioDurationMs = 500,
      vadEnergyThreshold = 500,
      vadSilenceFrames = 15,
      partialTranscripts = true,
      partialIntervalMs = 1000,
    } = options
    const openai = new OpenAI({ apiKey })

    // VAD state
    const frameSizeMs = 32
    const samplesPerFrame = Math.floor((sampleRate * frameSizeMs) / 1000)
    const bytesPerFrame = samplesPerFrame * 2 // 16-bit audio
    const minSpeechFrames = 4 // ~128ms of speech to start

    let audioBuffer: Buffer[] = []
    let speechFrameCount = 0
    let silenceFrameCount = 0
    let isSpeaking = false
    let pendingBytes = Buffer.alloc(0)
    let speechStartSignaled = false
    let speechStartTime = 0
    let lastBufferLogTime = 0
    let peakEnergy = 0
    let totalEnergy = 0
    let frameCount = 0

    // Partial transcription state
    let lastPartialTime = 0
    let lastPartialText = ''
    let partialInProgress = false

    // Helper to format duration
    const formatDuration = (ms: number): string => {
      if (ms < 1000) return `${ms.toFixed(0)}ms`
      return `${(ms / 1000).toFixed(2)}s`
    }

    // Helper to format bytes
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes}B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
      return `${(bytes / 1024 / 1024).toFixed(2)}MB`
    }

    // Helper to get partial transcription (non-blocking)
    const getPartialTranscription = async (): Promise<void> => {
      if (!partialTranscripts || partialInProgress || audioBuffer.length === 0) return

      const now = Date.now()
      const timeSinceLastPartial = now - lastPartialTime
      const timeSinceSpeechStart = now - speechStartTime

      // Only do partial if enough time has passed and we have enough audio
      if (timeSinceLastPartial < partialIntervalMs || timeSinceSpeechStart < 500) return

      partialInProgress = true
      lastPartialTime = now

      try {
        const partialAudio = Buffer.concat(audioBuffer)
        const durationMs = (partialAudio.length / 2 / sampleRate) * 1000

        const header = createWavHeader(partialAudio.length, sampleRate)
        const wavData = Buffer.concat([header, partialAudio])

        const file = await toFile(wavData, 'partial.wav', { type: 'audio/wav' })
        const response = await openai.audio.transcriptions.create({
          file,
          model,
        })

        const text = response.text?.trim()
        if (text && text.length > 0 && text !== lastPartialText) {
          lastPartialText = text
          console.log(
            `OpenAI STT [partial]: "${text}" (${formatDuration(durationMs)})`
          )
        }
      } catch (err) {
        // Silently ignore partial transcription errors
      } finally {
        partialInProgress = false
      }
    }

    // Helper to process a single frame
    const processFrame = (frame: Buffer): { speechEnded: boolean; audioData: Buffer | null } => {
      const energy = calculateEnergy(frame)
      const isSpeech = energy > vadEnergyThreshold

      if (isSpeech) {
        silenceFrameCount = 0
        speechFrameCount++

        if (!isSpeaking && speechFrameCount >= minSpeechFrames) {
          isSpeaking = true
          speechStartTime = Date.now()
          peakEnergy = 0
          totalEnergy = 0
          frameCount = 0
          lastBufferLogTime = speechStartTime
          console.log(`OpenAI STT [VAD]: Speech started (energy: ${energy.toFixed(0)}, threshold: ${vadEnergyThreshold})`)

          // Signal speech start for barge-in (only once per utterance)
          if (!speechStartSignaled && onSpeechStart) {
            speechStartSignaled = true
            onSpeechStart()
          }
        }

        if (isSpeaking) {
          audioBuffer.push(frame)
          peakEnergy = Math.max(peakEnergy, energy)
          totalEnergy += energy
          frameCount++

          // Log buffer progress every 500ms while speaking
          const now = Date.now()
          if (now - lastBufferLogTime >= 500) {
            const currentDuration = now - speechStartTime
            const bufferSize = audioBuffer.reduce((sum, b) => sum + b.length, 0)
            const avgEnergy = frameCount > 0 ? totalEnergy / frameCount : 0
            console.log(
              `OpenAI STT [buffering]: ${formatDuration(currentDuration)} | ` +
                `${formatBytes(bufferSize)} | ` +
                `energy: avg=${avgEnergy.toFixed(0)}, peak=${peakEnergy.toFixed(0)}`
            )
            lastBufferLogTime = now

            // Trigger partial transcription (non-blocking)
            getPartialTranscription()
          }
        }
      } else {
        if (isSpeaking) {
          silenceFrameCount++
          audioBuffer.push(frame) // Include some trailing silence

          if (silenceFrameCount >= vadSilenceFrames) {
            // Speech ended, return the complete buffer
            const completeAudio = Buffer.concat(audioBuffer)
            const speechDuration = Date.now() - speechStartTime
            const avgEnergy = frameCount > 0 ? totalEnergy / frameCount : 0

            console.log(
              `OpenAI STT [VAD]: Speech ended | ` +
                `duration: ${formatDuration(speechDuration)} | ` +
                `size: ${formatBytes(completeAudio.length)} | ` +
                `energy: avg=${avgEnergy.toFixed(0)}, peak=${peakEnergy.toFixed(0)}`
            )

            // Reset state
            audioBuffer = []
            speechFrameCount = 0
            silenceFrameCount = 0
            isSpeaking = false
            speechStartSignaled = false
            lastPartialTime = 0
            lastPartialText = ''

            return { speechEnded: true, audioData: completeAudio }
          }
        } else {
          speechFrameCount = 0
        }
      }

      return { speechEnded: false, audioData: null }
    }

    super({
      async transform(chunk, controller) {
        // Combine pending bytes with new chunk
        const combined = Buffer.concat([pendingBytes, chunk])

        // Process complete frames through VAD
        let offset = 0
        while (offset + bytesPerFrame <= combined.length) {
          const frame = combined.subarray(offset, offset + bytesPerFrame)
          const result = processFrame(frame)

          if (result.speechEnded && result.audioData) {
            // Check minimum duration
            const durationMs = (result.audioData.length / 2 / sampleRate) * 1000
            if (durationMs < minAudioDurationMs) {
              console.log(
                `OpenAI STT [skip]: Audio too short (${formatDuration(durationMs)} < ${formatDuration(minAudioDurationMs)})`
              )
              offset += bytesPerFrame
              continue
            }

            try {
              // Create WAV and send to Whisper
              const header = createWavHeader(result.audioData.length, sampleRate)
              const wavData = Buffer.concat([header, result.audioData])

              console.log(
                `OpenAI STT [Whisper]: Sending ${formatBytes(wavData.length)} audio (${formatDuration(durationMs)}) to model "${model}"...`
              )
              const transcribeStart = Date.now()

              const file = await toFile(wavData, 'input.wav', { type: 'audio/wav' })

              const response = await openai.audio.transcriptions.create({
                file,
                model,
              })

              const transcribeTime = Date.now() - transcribeStart
              const text = response.text?.trim()

              if (text && text.length > 0) {
                // Filter out likely echo/noise transcriptions
                // Single short words that are commonly misheard from TTS audio
                const suspiciousPatterns = /^(you|yeah|hey|hi|uh|um|oh|ah|the|a|and|hmm|mhm)\.?$/i
                if (suspiciousPatterns.test(text) && durationMs < 800) {
                  console.log(
                    `OpenAI STT [filtered]: "${text}" (${formatDuration(durationMs)}, likely echo/noise)`
                  )
                } else {
                  console.log(
                    `OpenAI STT [transcribed]: "${text}" | ` +
                      `audio: ${formatDuration(durationMs)} | ` +
                      `latency: ${transcribeTime}ms`
                  )
                  controller.enqueue(text)
                }
              } else {
                console.log(
                  `OpenAI STT [empty]: No speech detected in ${formatDuration(durationMs)} audio (latency: ${transcribeTime}ms)`
                )
              }
            } catch (err) {
              console.error('OpenAI STT [error]:', err)
            }
          }

          offset += bytesPerFrame
        }

        // Save remaining bytes for next chunk
        pendingBytes = combined.subarray(offset)
      },

      flush() {
        // If there's speech in progress when stream ends, process it
        if (isSpeaking && audioBuffer.length > 0) {
          const completeAudio = Buffer.concat(audioBuffer)
          const speechDuration = Date.now() - speechStartTime
          console.log(
            `OpenAI STT [flush]: Discarding incomplete speech | ` +
              `duration: ${formatDuration(speechDuration)} | ` +
              `size: ${formatBytes(completeAudio.length)}`
          )
          // Note: We can't await here in flush, so this is best-effort
          audioBuffer = []
          isSpeaking = false
          speechStartSignaled = false
        }
      },
    })
  }
}
