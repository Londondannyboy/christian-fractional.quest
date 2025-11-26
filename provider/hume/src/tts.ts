/**
 * Hume AI Text-to-Speech Model
 *
 * Input: Text string (sentences)
 * Output: PCM audio buffer (16-bit, mono, resampled to target rate)
 */

import WebSocket from 'ws'
import { BaseTextToSpeechModel, type TextToSpeechModelParams } from 'create-voice-agent'

export interface HumeOptions extends TextToSpeechModelParams {
  apiKey: string
  voiceName?: string
  voiceProvider?: 'HUME_AI' | 'CUSTOM_VOICE'
}

/**
 * Resample PCM audio from source rate to target rate
 * Simple linear interpolation resampling
 */
function resamplePCM(input: Buffer, sourceSampleRate: number, targetSampleRate: number): Buffer {
  if (sourceSampleRate === targetSampleRate) {
    return input
  }

  const ratio = sourceSampleRate / targetSampleRate
  const inputSamples = input.length / 2 // 16-bit = 2 bytes per sample
  const outputSamples = Math.floor(inputSamples / ratio)
  const output = Buffer.alloc(outputSamples * 2)

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1)
    const fraction = srcIndex - srcIndexFloor

    const sample1 = input.readInt16LE(srcIndexFloor * 2)
    const sample2 = input.readInt16LE(srcIndexCeil * 2)
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction)

    output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2)
  }

  return output
}

export class HumeTextToSpeech extends BaseTextToSpeechModel {
  readonly provider = 'hume'
  private _interrupt: () => void = () => {}

  interrupt(): void {
    this._interrupt()
  }

  constructor(options: HumeOptions) {
    const {
      apiKey,
      voiceName = 'Ava Song',
      voiceProvider = 'HUME_AI',
      outputSampleRate = 16000,
      onInterrupt,
      onAudioComplete,
    } = options

    const HUME_SAMPLE_RATE = 48000

    let ws: WebSocket | null = null
    let connectionPromise: Promise<void> | null = null
    let activeController: TransformStreamDefaultController<Buffer> | null = null
    let isShuttingDown = false
    let isInterrupted = false

    let closeResolve: (() => void) | null = null
    let closePromise: Promise<void> | null = null

    const resetClosePromise = () => {
      closePromise = new Promise((resolve) => {
        closeResolve = resolve
      })
    }

    const interruptTTS = () => {
      if (isInterrupted) return

      console.log('Hume TTS: Interrupted by user (barge-in)')
      isInterrupted = true

      if (ws) {
        try {
          ws.close()
        } catch {
          // Ignore close errors
        }
        ws = null
      }
      connectionPromise = null

      if (closeResolve) {
        closeResolve()
        closeResolve = null
      }

      onInterrupt?.()

      setTimeout(() => {
        isInterrupted = false
      }, 100)
    }

    const createConnection = (): Promise<void> => {
      resetClosePromise()

      return new Promise((resolve, reject) => {
        const params = new URLSearchParams({
          api_key: apiKey,
          no_binary: 'true',
          instant_mode: 'true',
          strip_headers: 'true',
          format_type: 'pcm',
        })

        const url = `wss://api.hume.ai/v0/tts/stream/input?${params.toString()}`
        console.log('Hume TTS: Connecting...')

        const newWs = new WebSocket(url)

        newWs.on('open', () => {
          console.log('Hume TTS: WebSocket connected')
          ws = newWs
          resolve()
        })

        newWs.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString())

            if (message.type === 'audio' && message.audio) {
              let audioBuffer: Buffer = Buffer.from(message.audio, 'base64')

              if (HUME_SAMPLE_RATE !== outputSampleRate) {
                audioBuffer = resamplePCM(audioBuffer, HUME_SAMPLE_RATE, outputSampleRate) as Buffer
              }

              if (activeController) {
                activeController.enqueue(audioBuffer)
              }
            } else if (message.type === 'error') {
              console.error('Hume TTS error:', message.message || message)
            }
          } catch (e) {
            console.error('Hume TTS: Error parsing message:', e)
          }
        })

        newWs.on('error', (err) => {
          console.error('Hume TTS WebSocket Error:', err)
          if (ws === newWs) {
            ws = null
            connectionPromise = null
          }
          reject(err)
        })

        newWs.on('close', (code, reason) => {
          console.log(`Hume TTS: WebSocket closed (code: ${code}, reason: ${reason})`)
          if (ws === newWs) {
            ws = null
            connectionPromise = null
          }
          if (closeResolve) {
            closeResolve()
            closeResolve = null
          }
          onAudioComplete?.()
        })
      })
    }

    const ensureConnection = async (): Promise<void> => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        return
      }
      if (connectionPromise) {
        await connectionPromise
        if (ws && ws.readyState === WebSocket.OPEN) {
          return
        }
      }
      connectionPromise = createConnection()
      await connectionPromise
    }

    super({
      start(controller) {
        activeController = controller
      },

      async transform(text) {
        if (isShuttingDown || isInterrupted) return

        try {
          await ensureConnection()

          if (ws && ws.readyState === WebSocket.OPEN) {
            const message = {
              text,
              voice: {
                name: voiceName,
                provider: voiceProvider,
              },
            }
            ws.send(JSON.stringify(message))
            ws.send(JSON.stringify({ flush: true }))
          } else {
            console.warn('Hume TTS: WebSocket not open, dropping text:', text)
          }
        } catch (err) {
          console.error('Hume TTS: Error in transform:', err)
        }
      },

      async flush() {
        console.log('Hume TTS: Flushing stream...')
        isShuttingDown = true

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ close: true }))

          const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
              console.log('Hume TTS: Flush timeout reached')
              resolve()
            }, 5000)
          })

          await Promise.race([closePromise, timeoutPromise])

          try {
            ws.close()
          } catch {
            // Ignore close errors
          }
          ws = null
        }
        connectionPromise = null
      },
    })

    this._interrupt = interruptTTS
  }
}
