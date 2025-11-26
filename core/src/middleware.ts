/**
 * Voice Middleware - Allows users to hook into the voice pipeline at different stages.
 * This extends LangChain's middleware concept with voice-specific transform and event hooks.
 */

/**
 * Hook points in the voice pipeline.
 * 
 * Pipeline flow:
 * Audio Input → [beforeSTT] → STT → [afterSTT] → Agent → [beforeTTS] → TTS → [afterTTS] → Output
 * 
 * Event hooks:
 * - onSpeechStart: Triggered when STT detects user speech (for barge-in handling)
 * - onAudioComplete: Triggered when TTS finishes playing audio
 */
export interface VoiceMiddlewareHooks {
  // ═══════════════════════════════════════════════════════════════════════════
  // Transform Hooks (stream-based)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** 
   * Transforms applied before Speech-to-Text.
   * Useful for audio preprocessing, noise reduction, etc.
   * Input/Output: Buffer (PCM audio)
   */
  beforeSTT?: TransformStream<Buffer, Buffer>[];
  
  /**
   * Transforms applied after Speech-to-Text, before the agent.
   * Useful for text preprocessing, filtering, etc.
   * Input/Output: string
   */
  afterSTT?: TransformStream<string, string>[];
  
  /**
   * Transforms applied after agent response, before Text-to-Speech.
   * Useful for text postprocessing, adding filler phrases, etc.
   * Input/Output: string
   */
  beforeTTS?: TransformStream<string, string>[];
  
  /**
   * Transforms applied after Text-to-Speech.
   * Useful for audio postprocessing, volume normalization, etc.
   * Input/Output: Buffer (PCM audio)
   */
  afterTTS?: TransformStream<Buffer, Buffer>[];

  // ═══════════════════════════════════════════════════════════════════════════
  // Event Hooks (callback-based)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Called when the STT detects that the user started speaking.
   * Useful for barge-in handling (e.g., canceling pending fillers, interrupting TTS).
   * Multiple middleware can register this hook; all will be called.
   */
  onSpeechStart?: () => void;

  /**
   * Called when the TTS finishes playing audio.
   * Useful for triggering actions after the agent finishes speaking
   * (e.g., hang up, UI updates).
   * Multiple middleware can register this hook; all will be called.
   */
  onAudioComplete?: () => void;
}

/**
 * Voice Middleware definition.
 * Middleware can provide transforms at any hook point in the pipeline.
 */
export interface VoiceMiddleware {
  /** Unique name for the middleware */
  name: string;
  /** Hooks provided by this middleware */
  hooks: VoiceMiddlewareHooks;
}

/**
 * Creates a voice middleware from hooks.
 */
export function createVoiceMiddleware(
  name: string,
  hooks: VoiceMiddlewareHooks
): VoiceMiddleware {
  return { name, hooks };
}

/**
 * Combines multiple voice middleware into a single set of hooks.
 * Transforms from each middleware are concatenated in order.
 * Event hooks from each middleware are combined and all called when triggered.
 */
export function combineVoiceMiddleware(
  ...middlewares: VoiceMiddleware[]
): VoiceMiddlewareHooks {
  const combined: VoiceMiddlewareHooks = {
    beforeSTT: [],
    afterSTT: [],
    beforeTTS: [],
    afterTTS: [],
  };

  // Collect event callbacks from all middleware
  const speechStartCallbacks: Array<() => void> = [];
  const audioCompleteCallbacks: Array<() => void> = [];

  for (const middleware of middlewares) {
    // Transform hooks
    if (middleware.hooks.beforeSTT) {
      combined.beforeSTT!.push(...middleware.hooks.beforeSTT);
    }
    if (middleware.hooks.afterSTT) {
      combined.afterSTT!.push(...middleware.hooks.afterSTT);
    }
    if (middleware.hooks.beforeTTS) {
      combined.beforeTTS!.push(...middleware.hooks.beforeTTS);
    }
    if (middleware.hooks.afterTTS) {
      combined.afterTTS!.push(...middleware.hooks.afterTTS);
    }

    // Event hooks
    if (middleware.hooks.onSpeechStart) {
      speechStartCallbacks.push(middleware.hooks.onSpeechStart);
    }
    if (middleware.hooks.onAudioComplete) {
      audioCompleteCallbacks.push(middleware.hooks.onAudioComplete);
    }
  }

  // Combine event callbacks into single functions
  if (speechStartCallbacks.length > 0) {
    combined.onSpeechStart = () => {
      for (const callback of speechStartCallbacks) {
        callback();
      }
    };
  }

  if (audioCompleteCallbacks.length > 0) {
    combined.onAudioComplete = () => {
      for (const callback of audioCompleteCallbacks) {
        callback();
      }
    };
  }

  return combined;
}

/**
 * Pipes a stream through an array of transforms.
 * Helper function for applying middleware hooks.
 */
export function pipeThroughTransforms<T>(
  stream: ReadableStream<T>,
  transforms: TransformStream<T, T>[]
): ReadableStream<T> {
  let result = stream;
  for (const transform of transforms) {
    result = result.pipeThrough(transform);
  }
  return result;
}

