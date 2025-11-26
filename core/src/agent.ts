/**
 * Voice Agent - Main abstraction for creating voice-enabled agents.
 * Extends LangChain's agent concept with voice-specific features.
 */

import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { createAgent, type CreateAgentParams, type ReactAgent } from 'langchain'
import type { AgentMiddleware } from 'langchain'

import {
  combineMiddleware,
  pipeThroughTransforms,
  type VoiceMiddleware,
  type VoiceHooks,
} from './middleware.js'
import { type BaseSpeechToTextModel, type BaseTextToSpeechModel } from './models.js'

/**
 * Parameters for creating a voice agent.
 * Extends LangChain's CreateAgentParams with voice-specific options.
 */
export interface CreateVoiceAgentParams extends Omit<CreateAgentParams, 'middleware'> {
  /** Speech-to-Text model for transcribing user input */
  stt: BaseSpeechToTextModel
  /** Text-to-Speech model for generating audio output */
  tts: BaseTextToSpeechModel
  /**
   * Optional middleware for customizing the pipeline.
   * Accepts both VoiceMiddleware (with voice hooks) and standard AgentMiddleware from LangChain.
   */
  middleware?: Array<VoiceMiddleware<any, any> | AgentMiddleware<any, any, any>>
  /** Callback when an interrupt occurs */
  onInterrupt?: (value: unknown) => void
  /** Callback when the agent calls hang_up tool */
  onHangUp?: (reason: string) => void
}

/**
 * Voice Agent interface - represents a voice-enabled agent.
 */
export interface VoiceAgent {
  /** The underlying LangGraph agent */
  readonly agent: ReactAgent
  /** The TTS model (useful for interrupt/barge-in control) */
  readonly tts: BaseTextToSpeechModel
  /** The STT model */
  readonly stt: BaseSpeechToTextModel
  /** Start processing audio from a readable stream */
  process(audioInput: ReadableStream<Buffer>): ReadableStream<Buffer>
  /** Stop processing and clean up */
  stop(): void
}

/**
 * Internal state for the voice agent.
 */
interface VoiceAgentState {
  threadId: string
  pendingInterrupt?: unknown
  stopped: boolean
}

/**
 * Creates a voice agent with the specified configuration.
 *
 * This function creates a LangChain agent internally using `createAgent()`
 * and wraps it with voice capabilities (STT, TTS, middleware).
 *
 * @example
 * ```ts
 * import { createVoiceAgent, createVoiceMiddleware } from "create-voice-agent";
 * import { createMiddleware } from "langchain";
 * import { AssemblyAISpeechToText } from "@create-voice-agent/assemblyai";
 * import { ElevenLabsTextToSpeech } from "@create-voice-agent/elevenlabs";
 *
 * // Create a voice-specific middleware
 * const fillerMiddleware = createVoiceMiddleware({
 *   name: "FillerMiddleware",
 *   beforeTTS: [myFillerTransform],
 *   onSpeechStart: () => console.log("Barge-in!"),
 * });
 *
 * // Create a standard LangChain agent middleware
 * const authMiddleware = createMiddleware({
 *   name: "AuthMiddleware",
 *   beforeModel: async (state, runtime, controls) => {
 *     // authentication logic
 *   },
 * });
 *
 * const voiceAgent = createVoiceAgent({
 *   // LangChain agent params
 *   model: new ChatOpenAI({ model: "gpt-4" }),
 *   tools: [myTool],
 *   systemPrompt: "You are a helpful assistant.",
 *   checkpointer: new MemorySaver(),
 *
 *   // Voice-specific params
 *   stt: new AssemblyAISpeechToText({ apiKey: "..." }),
 *   tts: new ElevenLabsTextToSpeech({ apiKey: "...", voiceId: "..." }),
 *
 *   // Mix of voice middleware and standard agent middleware
 *   middleware: [fillerMiddleware, authMiddleware],
 * });
 *
 * const audioOutput = voiceAgent.process(audioInput);
 * ```
 */
export function createVoiceAgent(params: CreateVoiceAgentParams): VoiceAgent {
  const {
    stt,
    tts,
    middleware = [],
    onInterrupt,
    onHangUp,
    // Extract CreateAgentParams
    ...agentParams
  } = params

  // Combine all middleware - separates voice hooks from agent middleware
  const combinedHooks = middleware.length > 0 ? combineMiddleware(...middleware) : null

  // Create the LangChain agent using createAgent() with the agent middleware
  const agent = createAgent({
    ...agentParams,
    middleware: combinedHooks?.agentMiddleware,
  })

  const state: VoiceAgentState = {
    threadId: crypto.randomUUID(),
    stopped: false,
  }

  // Extract voice hooks (empty object if no middleware)
  const voiceHooks: VoiceHooks = combinedHooks ?? {}

  // Wire middleware event hooks to STT/TTS models
  if (voiceHooks.onSpeechStart) {
    stt.addSpeechStartListener(voiceHooks.onSpeechStart)
  }
  if (voiceHooks.onAudioComplete) {
    tts.addAudioCompleteListener(voiceHooks.onAudioComplete)
  }

  /**
   * Creates the agent transform that processes text through the LangGraph agent.
   */
  function createAgentTransform(): TransformStream<string, string> {
    return new TransformStream<string, string>({
      async transform(text, controller) {
        if (state.stopped) return

        let input: { messages: HumanMessage[] } | Command

        // If there's a pending interrupt, resume with Command
        if (state.pendingInterrupt !== undefined) {
          console.log('[VoiceAgent] Resuming from interrupt with user response:', text)
          input = new Command({ resume: text })
          state.pendingInterrupt = undefined
        } else {
          input = { messages: [new HumanMessage(text)] }
        }

        const graphStream = await agent.stream(input, {
          configurable: { thread_id: state.threadId },
          streamMode: 'messages',
        })

        // Track hang_up request to defer until all text is enqueued
        let pendingHangUpReason: string | null = null

        for await (const [chunk] of graphStream) {
          if (state.stopped) break

          // Check if it's an AIMessageChunk - extract text content
          // Skip ToolMessages (they have tool_call_id) - only AIMessages should go to TTS
          if (
            chunk &&
            typeof chunk === 'object' &&
            'content' in chunk &&
            !('tool_call_id' in chunk)
          ) {
            const content = (chunk as { content: unknown }).content
            if (typeof content === 'string' && content.length > 0) {
              controller.enqueue(content)
            }
          }

          // Check for hang_up tool - defer calling onHangUp until stream completes
          if (chunk && typeof chunk === 'object' && 'name' in chunk) {
            const toolChunk = chunk as { name: string; content: unknown }
            if (toolChunk.name === 'hang_up') {
              console.log('[VoiceAgent] Hang up tool called:', toolChunk.content)
              pendingHangUpReason = toolChunk.content as string
            }
          }
        }

        // Call onHangUp after all text is enqueued to TTS
        // This ensures the actual agent response is queued before signaling hang up
        if (pendingHangUpReason !== null && onHangUp) {
          console.log('[VoiceAgent] All text enqueued, signaling hang up:', pendingHangUpReason)
          onHangUp(pendingHangUpReason)
        }

        // Check for interrupts
        const graphState = (await agent.getState({
          configurable: { thread_id: state.threadId },
        })) as { tasks?: Array<{ interrupts?: Array<{ value: unknown }> }> }

        if (graphState.tasks) {
          for (const task of graphState.tasks) {
            if (task.interrupts && task.interrupts.length > 0) {
              const interruptValue = task.interrupts[0].value
              console.log('[VoiceAgent] Interrupt detected:', interruptValue)
              state.pendingInterrupt = interruptValue
              onInterrupt?.(interruptValue)

              // Emit interrupt message
              if (typeof interruptValue === 'string') {
                controller.enqueue(interruptValue)
              }
            }
          }
        }
      },
    })
  }

  return {
    agent,
    tts,
    stt,

    process(audioInput: ReadableStream<Buffer>): ReadableStream<Buffer> {
      // Build the pipeline with middleware hooks

      // Step 1: Apply beforeSTT transforms
      let pipeline: ReadableStream<Buffer> = audioInput
      if (voiceHooks.beforeSTT && voiceHooks.beforeSTT.length > 0) {
        pipeline = pipeThroughTransforms(pipeline, voiceHooks.beforeSTT)
      }

      // Step 2: Speech-to-Text
      let textStream: ReadableStream<string> = pipeline.pipeThrough(stt)

      // Step 3: Apply afterSTT transforms
      if (voiceHooks.afterSTT && voiceHooks.afterSTT.length > 0) {
        textStream = pipeThroughTransforms(textStream, voiceHooks.afterSTT)
      }

      // Step 4: Agent processing
      let agentOutput = textStream.pipeThrough(createAgentTransform())

      // Step 5: Apply beforeTTS transforms
      if (voiceHooks.beforeTTS && voiceHooks.beforeTTS.length > 0) {
        agentOutput = pipeThroughTransforms(agentOutput, voiceHooks.beforeTTS)
      }

      // Step 6: Text-to-Speech
      let audioOutput: ReadableStream<Buffer> = agentOutput.pipeThrough(tts)

      // Step 7: Apply afterTTS transforms
      if (voiceHooks.afterTTS && voiceHooks.afterTTS.length > 0) {
        audioOutput = pipeThroughTransforms(audioOutput, voiceHooks.afterTTS)
      }

      return audioOutput
    },

    stop() {
      state.stopped = true
      // Interrupt TTS if possible
      tts.interrupt()
    },
  }
}
