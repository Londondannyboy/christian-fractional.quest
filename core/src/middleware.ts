/**
 * Voice Middleware - Extends LangChain's middleware concept with voice-specific transform and event hooks.
 *
 * This module provides a `createVoiceMiddleware` function that mirrors LangChain's `createMiddleware`
 * pattern, allowing users to create middleware with:
 * - All standard LangChain agent middleware hooks (wrapToolCall, wrapModelCall, beforeModel, afterModel, etc.)
 * - Voice-specific transform hooks (beforeSTT, afterSTT, beforeTTS, afterTTS)
 * - Voice-specific event hooks (onSpeechStart, onAudioComplete)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  AgentMiddleware,
  createMiddleware,
} from 'langchain'
import type { ClientTool, ServerTool } from '@langchain/core/tools'
import type {
  InteropZodObject,
  InferInteropZodOutput,
} from '@langchain/core/utils/types'

// Re-export AgentMiddleware for consumers
export type { AgentMiddleware }

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Voice-specific transform hooks.
 *
 * Pipeline flow:
 * Audio Input → [beforeSTT] → STT → [afterSTT] → Agent → [beforeTTS] → TTS → [afterTTS] → Output
 */
export interface VoiceTransformHooks {
  /**
   * Transforms applied before Speech-to-Text.
   * Useful for audio preprocessing, noise reduction, etc.
   * Input/Output: Buffer (PCM audio)
   */
  beforeSTT?: TransformStream<Buffer, Buffer>[]

  /**
   * Transforms applied after Speech-to-Text, before the agent.
   * Useful for text preprocessing, filtering, etc.
   * Input/Output: string
   */
  afterSTT?: TransformStream<string, string>[]

  /**
   * Transforms applied after agent response, before Text-to-Speech.
   * Useful for text postprocessing, adding filler phrases, etc.
   * Input/Output: string
   */
  beforeTTS?: TransformStream<string, string>[]

  /**
   * Transforms applied after Text-to-Speech.
   * Useful for audio postprocessing, volume normalization, etc.
   * Input/Output: Buffer (PCM audio)
   */
  afterTTS?: TransformStream<Buffer, Buffer>[]
}

/**
 * Voice-specific event hooks.
 */
export interface VoiceEventHooks {
  /**
   * Called when the STT detects that the user started speaking.
   * Useful for barge-in handling (e.g., canceling pending fillers, interrupting TTS).
   * Multiple middleware can register this hook; all will be called.
   */
  onSpeechStart?: () => void

  /**
   * Called when the TTS finishes playing audio.
   * Useful for triggering actions after the agent finishes speaking
   * (e.g., hang up, UI updates).
   * Multiple middleware can register this hook; all will be called.
   */
  onAudioComplete?: () => void
}

/**
 * Combined voice hooks interface.
 */
export interface VoiceHooks extends VoiceTransformHooks, VoiceEventHooks {}

/**
 * Normalized context schema type helper.
 */
type NormalizeContextSchema<TContextSchema extends InteropZodObject | undefined = undefined> =
  TContextSchema extends InteropZodObject ? InferInteropZodOutput<TContextSchema> : never

/**
 * Voice Middleware interface - extends LangChain's AgentMiddleware with voice-specific hooks.
 */
export interface VoiceMiddleware<
  TStateSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
> extends AgentMiddleware<TStateSchema, TContextSchema, NormalizeContextSchema<TContextSchema>> {
  /** Marker to identify this as a VoiceMiddleware */
  readonly __voiceMiddleware: true

  /** Voice-specific hooks (transforms and events) */
  readonly voiceHooks: VoiceHooks
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration Interface
// ═══════════════════════════════════════════════════════════════════════════════

type CreateMiddlewareParams<
  TStateSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
> = Parameters<typeof createMiddleware<TStateSchema, TContextSchema>>[0]

/**
 * Configuration for creating a voice middleware.
 * Extends LangChain's middleware configuration with voice-specific hooks.
 */
export interface CreateVoiceMiddlewareConfig<
  TSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
> extends CreateMiddlewareParams<TSchema, TContextSchema> {
  /**
   * Transforms applied before Speech-to-Text.
   * Useful for audio preprocessing, noise reduction, etc.
   */
  beforeSTT?: TransformStream<Buffer, Buffer>[]

  /**
   * Transforms applied after Speech-to-Text, before the agent.
   * Useful for text preprocessing, filtering, etc.
   */
  afterSTT?: TransformStream<string, string>[]

  /**
   * Transforms applied after agent response, before Text-to-Speech.
   * Useful for text postprocessing, adding filler phrases, etc.
   */
  beforeTTS?: TransformStream<string, string>[]

  /**
   * Transforms applied after Text-to-Speech.
   * Useful for audio postprocessing, volume normalization, etc.
   */
  afterTTS?: TransformStream<Buffer, Buffer>[]

  // ═══════════════════════════════════════════════════════════════════════════
  // Voice Event Hooks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Called when the STT detects that the user started speaking.
   * Useful for barge-in handling.
   */
  onSpeechStart?: () => void

  /**
   * Called when the TTS finishes playing audio.
   * Useful for triggering actions after the agent finishes speaking.
   */
  onAudioComplete?: () => void
}

// ═══════════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates a voice middleware instance with automatic schema inference.
 *
 * This function mirrors LangChain's `createMiddleware` pattern while adding
 * voice-specific transform and event hooks.
 *
 * @param config - Middleware configuration
 * @returns A VoiceMiddleware instance
 *
 * @example
 * ```ts
 * import { createVoiceMiddleware } from "create-voice-agent";
 * import { z } from "zod";
 *
 * // Simple voice middleware with just voice hooks
 * const loggingMiddleware = createVoiceMiddleware({
 *   name: "LoggingMiddleware",
 *   onSpeechStart: () => console.log("User started speaking"),
 *   onAudioComplete: () => console.log("Audio playback complete"),
 * });
 *
 * // Full middleware with state, context, and all hooks
 * const authMiddleware = createVoiceMiddleware({
 *   name: "AuthMiddleware",
 *   stateSchema: z.object({
 *     isAuthenticated: z.boolean().default(false),
 *   }),
 *   contextSchema: z.object({
 *     userId: z.string(),
 *   }),
 *   beforeModel: async (state, runtime) => {
 *     if (!state.isAuthenticated) {
 *       throw new Error("Not authenticated");
 *     }
 *   },
 *   afterSTT: [myTextFilterTransform],
 *   onSpeechStart: () => console.log("Barge-in detected"),
 * });
 * ```
 */
export function createVoiceMiddleware<
  TSchema extends InteropZodObject | undefined = undefined,
  TContextSchema extends InteropZodObject | undefined = undefined,
>(
  config: CreateVoiceMiddlewareConfig<TSchema, TContextSchema>
): VoiceMiddleware<TSchema, TContextSchema> {
  const middleware = {
    // Marker
    __voiceMiddleware: true as const,

    // LangChain AgentMiddleware properties
    name: config.name,
    stateSchema: config.stateSchema,
    contextSchema: config.contextSchema,
    tools: config.tools ?? [],
    wrapToolCall: config.wrapToolCall,
    wrapModelCall: config.wrapModelCall,
    beforeAgent: config.beforeAgent,
    afterAgent: config.afterAgent,
    beforeModel: config.beforeModel,
    afterModel: config.afterModel,

    // Voice-specific hooks
    voiceHooks: {
      beforeSTT: config.beforeSTT,
      afterSTT: config.afterSTT,
      beforeTTS: config.beforeTTS,
      afterTTS: config.afterTTS,
      onSpeechStart: config.onSpeechStart,
      onAudioComplete: config.onAudioComplete,
    },
  } satisfies VoiceMiddleware<TSchema, TContextSchema>

  return middleware
}

// ═══════════════════════════════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard to check if a middleware is a VoiceMiddleware.
 */
export function isVoiceMiddleware(
  middleware: AgentMiddleware<any, any, any> | VoiceMiddleware<any, any>
): middleware is VoiceMiddleware<any, any> {
  return '__voiceMiddleware' in middleware && middleware.__voiceMiddleware === true
}

// ═══════════════════════════════════════════════════════════════════════════════
// Combining Middleware
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Combined hooks from multiple middleware.
 * Includes both agent middleware and extracted voice hooks.
 */
export interface CombinedVoiceHooks extends VoiceHooks {
  /** The combined agent middleware (for passing to LangChain) */
  agentMiddleware: AgentMiddleware<any, any, any>[]
}

/**
 * Combines multiple middleware (both VoiceMiddleware and AgentMiddleware) into combined hooks.
 *
 * - AgentMiddleware is collected and passed through to the LangChain agent
 * - VoiceMiddleware voice hooks are combined (transforms concatenated, event callbacks merged)
 *
 * @param middlewares - Array of middleware (VoiceMiddleware or AgentMiddleware)
 * @returns Combined hooks object
 */
export function combineMiddleware(
  ...middlewares: Array<VoiceMiddleware<any, any> | AgentMiddleware<any, any, any>>
): CombinedVoiceHooks {
  const combined: CombinedVoiceHooks = {
    beforeSTT: [],
    afterSTT: [],
    beforeTTS: [],
    afterTTS: [],
    agentMiddleware: [],
  }

  // Collect event callbacks from all voice middleware
  const speechStartCallbacks: Array<() => void> = []
  const audioCompleteCallbacks: Array<() => void> = []

  for (const middleware of middlewares) {
    // All middleware goes to the agent middleware list
    // (VoiceMiddleware extends AgentMiddleware, so it works)
    combined.agentMiddleware.push(middleware as AgentMiddleware<any, any, any>)

    // Extract voice-specific hooks from VoiceMiddleware
    if (isVoiceMiddleware(middleware)) {
      const voiceHooks = middleware.voiceHooks

      // Transform hooks
      if (voiceHooks.beforeSTT) {
        combined.beforeSTT!.push(...voiceHooks.beforeSTT)
      }
      if (voiceHooks.afterSTT) {
        combined.afterSTT!.push(...voiceHooks.afterSTT)
      }
      if (voiceHooks.beforeTTS) {
        combined.beforeTTS!.push(...voiceHooks.beforeTTS)
      }
      if (voiceHooks.afterTTS) {
        combined.afterTTS!.push(...voiceHooks.afterTTS)
      }

      // Event hooks
      if (voiceHooks.onSpeechStart) {
        speechStartCallbacks.push(voiceHooks.onSpeechStart)
      }
      if (voiceHooks.onAudioComplete) {
        audioCompleteCallbacks.push(voiceHooks.onAudioComplete)
      }
    }
  }

  // Combine event callbacks into single functions
  if (speechStartCallbacks.length > 0) {
    combined.onSpeechStart = () => {
      for (const callback of speechStartCallbacks) {
        callback()
      }
    }
  }

  if (audioCompleteCallbacks.length > 0) {
    combined.onAudioComplete = () => {
      for (const callback of audioCompleteCallbacks) {
        callback()
      }
    }
  }

  return combined
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pipes a stream through an array of transforms.
 * Helper function for applying middleware hooks.
 */
export function pipeThroughTransforms<T>(
  stream: ReadableStream<T>,
  transforms: TransformStream<T, T>[]
): ReadableStream<T> {
  let result = stream
  for (const transform of transforms) {
    result = result.pipeThrough(transform)
  }
  return result
}
