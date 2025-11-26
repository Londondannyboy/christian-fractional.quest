/**
 * AssemblyAI Real-Time Streaming Speech-to-Text Model (v3 API)
 *
 * Input: PCM 16-bit audio buffer
 * Output: Transcribed text string (final/formatted transcripts only)
 *
 * Uses AssemblyAI's WebSocket-based real-time transcription API
 * for significantly lower latency than batch-based STT.
 */

import querystring from 'querystring'

import { BaseSpeechToTextModel, type SpeechToTextModelParams } from '../../../core/src/index.js'
import WebSocket from 'ws'

/**
 * Audio encoding formats supported by AssemblyAI streaming API
 */
export type AssemblyAIEncoding = 'pcm_s16le' | 'pcm_mulaw'

/**
 * Speech model options for AssemblyAI streaming
 * - universal-streaming-english: English-only (default, lower latency)
 * - universal-streaming-multi: Multilingual (English, Spanish, French, German, Italian, Portuguese)
 */
export type AssemblyAISpeechModel = 'universal-streaming-english' | 'universal-streaming-multi'

/**
 * Region options for AssemblyAI streaming API
 * - us: US endpoint (default) - streaming.assemblyai.com
 * - eu: EU endpoint - streaming.eu.assemblyai.com
 */
export type AssemblyAIRegion = 'us' | 'eu'

/**
 * Word-level transcription data
 */
export interface AssemblyAIWord {
  /** The string representation of the word */
  text: string
  /** Whether the word is finalized and won't change */
  word_is_final: boolean
  /** Timestamp for word start (in milliseconds) */
  start: number
  /** Timestamp for word end (in milliseconds) */
  end: number
  /** Confidence score for the word (0-1) */
  confidence: number
}

/**
 * Turn event data with full transcription details
 */
export interface AssemblyAITurnEvent {
  /** Integer that increments with each new turn */
  turn_order: number
  /** Whether the text is formatted (punctuation, casing, ITN) */
  turn_is_formatted: boolean
  /** Whether this is the end of the current turn */
  end_of_turn: boolean
  /** The transcript text (only finalized words) */
  transcript: string
  /** Confidence that the current turn has finished (0-1) */
  end_of_turn_confidence: number
  /** List of Word objects with individual metadata */
  words: AssemblyAIWord[]
}

/**
 * Configuration options that can be updated during a session
 */
export interface AssemblyAISessionConfig {
  /** Confidence threshold (0.0-1.0) for end of turn detection */
  endOfTurnConfidenceThreshold?: number
  /** Min silence (ms) required to detect end of turn when confident */
  minEndOfTurnSilenceWhenConfident?: number
  /** Max silence (ms) allowed before end of turn is triggered */
  maxTurnSilence?: number
  /** Whether to return formatted final transcripts */
  formatTurns?: boolean
}

export interface AssemblyAISTTOptions extends SpeechToTextModelParams {
  /**
   * AssemblyAI API key for authentication
   */
  apiKey: string

  /**
   * Temporary authentication token (alternative to apiKey)
   * Generated via AssemblyAI's token endpoint for client-side usage
   */
  token?: string

  /**
   * Audio encoding format
   * @default "pcm_s16le"
   */
  encoding?: AssemblyAIEncoding

  /**
   * Whether to return formatted final transcripts with punctuation,
   * casing, and inverse text normalization
   * @default true
   */
  formatTurns?: boolean

  /**
   * List of words and phrases to improve recognition accuracy for.
   * Terms longer than 50 characters are ignored.
   * Maximum 100 terms allowed.
   */
  keytermsPrompt?: string[]

  /**
   * Speech model to use for transcription
   * @default "universal-streaming-english"
   */
  speechModel?: AssemblyAISpeechModel

  /**
   * Region for the streaming endpoint
   * @default "us"
   */
  region?: AssemblyAIRegion

  /**
   * Confidence threshold (0.0-1.0) for determining end of turn
   * @default 0.4
   */
  endOfTurnConfidenceThreshold?: number

  /**
   * Minimum silence in milliseconds required to detect end of turn when confident
   * For live captioning, 560ms is recommended
   * @default 400
   */
  minEndOfTurnSilenceWhenConfident?: number

  /**
   * Maximum silence in milliseconds allowed in a turn before end of turn is triggered
   * @default 1280
   */
  maxTurnSilence?: number

  /**
   * Callback fired on each turn event (both partial and final)
   * Provides full turn data including word-level information
   */
  onTurn?: (turn: AssemblyAITurnEvent) => void

  /**
   * Callback fired when end of turn is detected
   */
  onEndOfTurn?: (turn: AssemblyAITurnEvent) => void
}

interface BeginMessage {
  type: 'Begin'
  id: string
  expires_at: number
}

interface TurnMessage {
  type: 'Turn'
  turn_order: number
  turn_is_formatted: boolean
  end_of_turn: boolean
  transcript: string
  end_of_turn_confidence: number
  words: AssemblyAIWord[]
}

interface TerminationMessage {
  type: 'Termination'
  audio_duration_seconds: number
  session_duration_seconds: number
}

interface ErrorMessage {
  type: 'Error'
  error: string
}

type AssemblyAIMessage = BeginMessage | TurnMessage | TerminationMessage | ErrorMessage

/**
 * Get the WebSocket endpoint URL based on region
 */
function getEndpointUrl(region: AssemblyAIRegion): string {
  switch (region) {
    case 'eu':
      return 'wss://streaming.eu.assemblyai.com/v3/ws'
    case 'us':
    default:
      return 'wss://streaming.assemblyai.com/v3/ws'
  }
}

export class AssemblyAISpeechToText extends BaseSpeechToTextModel {
  readonly provider = 'assemblyai'

  private _ws: WebSocket | null = null
  private _sessionId: string | null = null

  constructor(options: AssemblyAISTTOptions) {
    const {
      apiKey,
      token,
      sampleRate = 16000,
      encoding = 'pcm_s16le',
      formatTurns = true,
      keytermsPrompt,
      speechModel,
      region = 'us',
      endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfident,
      maxTurnSilence,
      onSpeechStart,
      onTurn,
      onEndOfTurn,
    } = options

    let ws: WebSocket | null = null
    let connectionPromise: Promise<void> | null = null
    let activeController: TransformStreamDefaultController<string> | null = null
    let sessionId: string | null = null
    let speechStartSignaled = false

    // Callback to notify speech start listeners (assigned after super())
    let notifySpeechStartCallback: () => void = () => {}

    const self = {
      _ws: null as WebSocket | null,
      _sessionId: null as string | null,
    }

    const resetConnection = () => {
      if (ws) {
        try {
          ws.close()
        } catch (e) {
          console.error('AssemblyAI: Error closing WebSocket:', e)
        }
        ws = null
        self._ws = null
      }
      connectionPromise = null
      sessionId = null
      self._sessionId = null
    }

    const ensureConnection = (): Promise<void> => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        return Promise.resolve()
      }
      if (connectionPromise) return connectionPromise

      connectionPromise = new Promise((resolve, reject) => {
        // Build connection parameters
        const params: Record<string, string | number | boolean> = {
          sample_rate: sampleRate,
          encoding: encoding,
          format_turns: formatTurns,
        }

        // Add optional parameters
        if (keytermsPrompt && keytermsPrompt.length > 0) {
          // Filter out terms longer than 50 characters
          const validTerms = keytermsPrompt.filter((term) => term.length <= 50)
          if (validTerms.length > 100) {
            console.warn('AssemblyAI: More than 100 keyterms provided, only first 100 will be used')
          }
          params.keyterms_prompt = validTerms.slice(0, 100).join(',')
        }

        if (speechModel) {
          params.speech_model = speechModel
        }

        if (endOfTurnConfidenceThreshold !== undefined) {
          params.end_of_turn_confidence_threshold = endOfTurnConfidenceThreshold
        }

        if (minEndOfTurnSilenceWhenConfident !== undefined) {
          params.min_end_of_turn_silence_when_confident = minEndOfTurnSilenceWhenConfident
        }

        if (maxTurnSilence !== undefined) {
          params.max_turn_silence = maxTurnSilence
        }

        const baseUrl = getEndpointUrl(region)
        const url = `${baseUrl}?${querystring.stringify(params)}`
        console.log(`AssemblyAI: Connecting to v3 streaming API (${region})...`)

        // Determine auth header
        const authValue = token || apiKey

        ws = new WebSocket(url, {
          headers: {
            Authorization: authValue,
          },
        })
        self._ws = ws

        ws.on('open', () => {
          console.log('AssemblyAI: WebSocket connected')
        })

        ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString()) as AssemblyAIMessage

            switch (message.type) {
              case 'Begin':
                sessionId = message.id
                self._sessionId = sessionId
                console.log(
                  `AssemblyAI: Session started (${sessionId}), expires at ${new Date(message.expires_at * 1000).toISOString()}`
                )
                resolve()
                break

              case 'Turn': {
                const turnEvent: AssemblyAITurnEvent = {
                  turn_order: message.turn_order,
                  turn_is_formatted: message.turn_is_formatted,
                  end_of_turn: message.end_of_turn,
                  transcript: message.transcript,
                  end_of_turn_confidence: message.end_of_turn_confidence,
                  words: message.words || [],
                }

                // Fire turn callback for all turn events
                onTurn?.(turnEvent)

                // Fire end of turn callback
                if (message.end_of_turn) {
                  onEndOfTurn?.(turnEvent)
                }

                if (message.turn_is_formatted) {
                  // Final/formatted transcript - send to pipeline
                  if (message.transcript && message.transcript.trim().length > 0) {
                    console.log(`AssemblyAI [final]: "${message.transcript}"`)
                    if (activeController) {
                      activeController.enqueue(message.transcript)
                    }
                  }
                  // Reset speech start flag for next utterance
                  speechStartSignaled = false
                } else {
                  // Partial transcript - log for debugging
                  if (message.transcript) {
                    console.log(`AssemblyAI [partial]: "${message.transcript}"`)

                    // Signal speech start for barge-in (only once per utterance)
                    if (!speechStartSignaled && message.transcript.trim().length > 0) {
                      speechStartSignaled = true
                      // Notify user callback and registered listeners
                      onSpeechStart?.()
                      notifySpeechStartCallback()
                    }
                  }
                }
                break
              }

              case 'Termination':
                console.log(
                  `AssemblyAI: Session terminated (audio: ${message.audio_duration_seconds}s, session: ${message.session_duration_seconds}s)`
                )
                resetConnection()
                break

              case 'Error':
                console.error('AssemblyAI error:', message.error)
                break

              default: {
                const msg = message as unknown as { error?: string }
                if (msg.error) {
                  console.error('AssemblyAI error:', msg.error)
                }
              }
            }
          } catch (e) {
            console.error('AssemblyAI: Error parsing message:', e)
          }
        })

        ws.on('error', (err) => {
          console.error('AssemblyAI WebSocket Error:', err)
          resetConnection()
          reject(err)
        })

        ws.on('close', (code, reason) => {
          console.log(`AssemblyAI: WebSocket closed (code: ${code}, reason: ${reason})`)
          resetConnection()
        })

        // Timeout for connection
        setTimeout(() => {
          if (!sessionId) {
            reject(new Error('AssemblyAI: Connection timeout'))
            resetConnection()
          }
        }, 10000)
      })

      return connectionPromise
    }

    super({
      start(controller) {
        activeController = controller
      },

      async transform(chunk) {
        try {
          await ensureConnection()

          if (ws && ws.readyState === WebSocket.OPEN) {
            // v3 API: Send raw PCM audio bytes directly (not base64)
            ws.send(chunk)
          } else {
            console.warn('AssemblyAI: WebSocket not open, dropping audio chunk')
          }
        } catch (err) {
          console.error('AssemblyAI: Error in transform:', err)
        }
      },

      async flush() {
        console.log('AssemblyAI: Flushing stream...')
        if (ws && ws.readyState === WebSocket.OPEN) {
          // v3 API: Send terminate message
          ws.send(JSON.stringify({ type: 'Terminate' }))

          // Wait for termination or timeout
          await new Promise<void>((resolve) => {
            const checkClosed = setInterval(() => {
              if (!ws || ws.readyState !== WebSocket.OPEN) {
                clearInterval(checkClosed)
                resolve()
              }
            }, 100)

            // Timeout after 3 seconds
            setTimeout(() => {
              clearInterval(checkClosed)
              resetConnection()
              resolve()
            }, 3000)
          })
        }
      },
    })

    // Assign callback now that `this` is available
    notifySpeechStartCallback = () => this.notifySpeechStart()

    // Store references for instance methods
    this._ws = self._ws
    this._sessionId = self._sessionId

    // Proxy the self object to this instance
    Object.defineProperty(this, '_ws', {
      get: () => self._ws,
      set: (value) => {
        self._ws = value
      },
    })
    Object.defineProperty(this, '_sessionId', {
      get: () => self._sessionId,
      set: (value) => {
        self._sessionId = value
      },
    })
  }

  /**
   * Get the current session ID
   */
  get sessionId(): string | null {
    return this._sessionId
  }

  /**
   * Check if the WebSocket connection is open
   */
  get isConnected(): boolean {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN
  }

  /**
   * Update session configuration during an active session.
   * Allows changing endpointing parameters on-the-fly.
   */
  updateConfiguration(config: AssemblyAISessionConfig): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('AssemblyAI: Cannot update configuration - WebSocket not connected')
      return
    }

    const updateMessage: Record<string, unknown> = {
      type: 'UpdateConfiguration',
    }

    if (config.endOfTurnConfidenceThreshold !== undefined) {
      updateMessage.end_of_turn_confidence_threshold = config.endOfTurnConfidenceThreshold
    }

    if (config.minEndOfTurnSilenceWhenConfident !== undefined) {
      updateMessage.min_end_of_turn_silence_when_confident = config.minEndOfTurnSilenceWhenConfident
    }

    if (config.maxTurnSilence !== undefined) {
      updateMessage.max_turn_silence = config.maxTurnSilence
    }

    if (config.formatTurns !== undefined) {
      updateMessage.format_turns = config.formatTurns
    }

    console.log('AssemblyAI: Updating configuration', updateMessage)
    this._ws.send(JSON.stringify(updateMessage))
  }

  /**
   * Force an endpoint (end of turn) immediately.
   * Useful when you know the user has finished speaking
   * (e.g., via a button press or external VAD).
   */
  forceEndpoint(): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('AssemblyAI: Cannot force endpoint - WebSocket not connected')
      return
    }

    console.log('AssemblyAI: Forcing endpoint')
    this._ws.send(JSON.stringify({ type: 'ForceEndpoint' }))
  }

  /**
   * Interrupt the current transcription session.
   * Sends a terminate message and closes the connection.
   */
  interrupt(): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      console.log('AssemblyAI: Interrupting session')
      this._ws.send(JSON.stringify({ type: 'Terminate' }))
      this._ws.close()
    }
  }
}
