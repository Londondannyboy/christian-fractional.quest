/**
 * ThinkingFillerMiddleware
 * 
 * Emits "filler" phrases (e.g., "Let me see...", "Hmm, one moment...")
 * when the upstream agent takes longer than a specified threshold to respond.
 * This creates a more natural, conversational experience for voice applications.
 */

import { createVoiceMiddleware, type VoiceMiddleware } from "./middleware.js";

/**
 * Options for the thinking filler middleware.
 */
export interface ThinkingFillerOptions {
  /**
   * Time in milliseconds before emitting a filler phrase.
   * @default 1000
   */
  thresholdMs?: number;

  /**
   * Array of filler phrases to randomly choose from.
   */
  fillerPhrases?: string[];

  /**
   * Whether the filler functionality is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum number of fillers to emit per turn.
   * @default 1
   */
  maxFillersPerTurn?: number;

  /**
   * Delay in milliseconds between consecutive filler phrases.
   * @default 2000
   */
  fillerIntervalMs?: number;

  /**
   * Callback when a filler phrase is emitted.
   */
  onFillerEmitted?: (phrase: string) => void;
}

const DEFAULT_FILLER_PHRASES = [
  "Let me see here...",
  "Hmm, one moment...",
  "Ah, let me think...",
  "Just a second...",
  "Mhm, okay...",
];

/**
 * Internal state for the thinking filler transform.
 */
interface ThinkingFillerState {
  controller: TransformStreamDefaultController<string> | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  intervalId: ReturnType<typeof setInterval> | null;
  fillersEmittedThisTurn: number;
  hasReceivedResponse: boolean;
  processingStarted: boolean;
}

/**
 * Creates a ThinkingFillerTransform that can be controlled externally.
 */
export class ThinkingFillerTransform extends TransformStream<string, string> {
  readonly #thresholdMs: number;
  readonly #fillerPhrases: string[];
  readonly #enabled: boolean;
  readonly #maxFillersPerTurn: number;
  readonly #fillerIntervalMs: number;
  readonly #onFillerEmitted?: (phrase: string) => void;
  readonly #state: ThinkingFillerState;

  constructor(options: ThinkingFillerOptions = {}) {
    const {
      thresholdMs = 1000,
      fillerPhrases = DEFAULT_FILLER_PHRASES,
      enabled = true,
      maxFillersPerTurn = 1,
      fillerIntervalMs = 2000,
      onFillerEmitted,
    } = options;

    const state: ThinkingFillerState = {
      controller: null,
      timeoutId: null,
      intervalId: null,
      fillersEmittedThisTurn: 0,
      hasReceivedResponse: false,
      processingStarted: false,
    };

    const clearTimers = () => {
      if (state.timeoutId) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
      }
    };

    super({
      start(controller) {
        state.controller = controller;
      },

      transform(chunk, controller) {
        // Real text arrived - cancel any pending filler timers
        clearTimers();
        state.hasReceivedResponse = true;
        state.processingStarted = false;

        // Pass through the actual response
        controller.enqueue(chunk);
      },

      flush() {
        clearTimers();
      },
    });

    this.#state = state;
    this.#thresholdMs = thresholdMs;
    this.#fillerPhrases = fillerPhrases;
    this.#enabled = enabled;
    this.#maxFillersPerTurn = maxFillersPerTurn;
    this.#fillerIntervalMs = fillerIntervalMs;
    this.#onFillerEmitted = onFillerEmitted;
  }

  /**
   * Call this method when the agent starts processing a user request.
   * This starts the filler timer.
   */
  notifyProcessingStarted(): void {
    if (!this.#enabled || this.#state.processingStarted) return;

    this.#state.processingStarted = true;
    this.#state.fillersEmittedThisTurn = 0;
    this.#state.hasReceivedResponse = false;
    this.#clearTimers();

    this.#state.timeoutId = setTimeout(() => {
      this.#emitFiller();

      if (this.#maxFillersPerTurn > 1) {
        this.#state.intervalId = setInterval(() => {
          if (
            this.#state.fillersEmittedThisTurn < this.#maxFillersPerTurn &&
            !this.#state.hasReceivedResponse
          ) {
            this.#emitFiller();
          } else {
            this.#clearTimers();
          }
        }, this.#fillerIntervalMs);
      }
    }, this.#thresholdMs);
  }

  /**
   * Cancel any pending filler.
   * Useful when the user interrupts or the turn is cancelled.
   */
  cancelPendingFiller(): void {
    this.#clearTimers();
    this.#state.processingStarted = false;
  }

  #clearTimers(): void {
    if (this.#state.timeoutId) {
      clearTimeout(this.#state.timeoutId);
      this.#state.timeoutId = null;
    }
    if (this.#state.intervalId) {
      clearInterval(this.#state.intervalId);
      this.#state.intervalId = null;
    }
  }

  #emitFiller(): void {
    if (
      !this.#state.controller ||
      this.#state.hasReceivedResponse ||
      this.#state.fillersEmittedThisTurn >= this.#maxFillersPerTurn
    ) {
      return;
    }

    const phrase =
      this.#fillerPhrases[
        Math.floor(Math.random() * this.#fillerPhrases.length)
      ];

    console.log(`[ThinkingFiller] Emitting filler: "${phrase}"`);
    this.#state.controller.enqueue(phrase);
    this.#state.fillersEmittedThisTurn++;
    this.#onFillerEmitted?.(phrase);
  }
}

/**
 * A passthrough transform that notifies the ThinkingFillerTransform
 * when user input arrives (afterSTT).
 */
class NotifyOnInputTransform extends TransformStream<string, string> {
  constructor(fillerTransform: ThinkingFillerTransform) {
    super({
      transform(chunk, controller) {
        // User input received - start the filler timer
        fillerTransform.notifyProcessingStarted();
        controller.enqueue(chunk);
      },
    });
  }
}

/**
 * Creates a thinking filler middleware.
 * 
 * This middleware inserts "thinking" filler phrases when the agent
 * takes longer than the threshold to respond.
 * 
 * The middleware automatically:
 * - Starts the filler timer via the `afterSTT` hook when user input is received
 * - Cancels pending fillers via the `onSpeechStart` hook when the user starts speaking (barge-in)
 * 
 * @example
 * ```ts
 * const fillerMiddleware = createThinkingFillerMiddleware({ thresholdMs: 1200 });
 * 
 * const agent = createVoiceAgent({
 *   stt: new AssemblyAISpeechToText({ ... }),
 *   tts: new ElevenLabsTextToSpeech({ ... }),
 *   middleware: [fillerMiddleware],
 * });
 * ```
 */
export function createThinkingFillerMiddleware(
  options: ThinkingFillerOptions = {}
): VoiceMiddleware {
  const transform = new ThinkingFillerTransform(options);
  const notifyTransform = new NotifyOnInputTransform(transform);
  
  const middleware = createVoiceMiddleware("ThinkingFiller", {
    afterSTT: [notifyTransform],
    beforeTTS: [transform],
    onSpeechStart: () => transform.cancelPendingFiller(),
  });
  
  return middleware;
}

