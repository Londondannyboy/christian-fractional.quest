import { AssemblyAISpeechToText } from '@create-voice-agent/assemblyai'
import { ElevenLabsTextToSpeech } from '@create-voice-agent/elevenlabs'
import { HumeTextToSpeech } from '@create-voice-agent/hume'
import { OpenAISpeechToText, OpenAITextToSpeech } from '@create-voice-agent/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createVoiceAgent } from 'create-voice-agent'

import { LangGraphModel } from './langgraph-model.js'
import { createFillerMiddleware } from './middleware.js'
import { hangUp } from './tools.js'

const SYSTEM_PROMPT = `
You are a warm, encouraging career coach assistant. Your goal is to help job seekers with their career journey.
Be supportive, professional, and actionable in your advice.

CAPABILITIES:
- Career path advice and planning
- Job search strategies and tips
- Resume and cover letter feedback
- Interview preparation and practice
- Salary negotiation guidance
- Skills development recommendations
- Work-life balance advice

CONVERSATION STYLE:
- Be warm and encouraging
- Ask clarifying questions to understand their situation
- Provide specific, actionable advice
- Celebrate their wins and progress
- Be empathetic about job search challenges

IMPORTANT: Call the hang_up tool when:
- The user says goodbye, thanks you, or ends the conversation
- The user says "that's all", "bye", "thank you", etc.
`

let pendingHangUp: string | null = null

// Provider type definitions
export type STTProvider = 'assemblyai' | 'openai'
export type TTSProvider = 'elevenlabs' | 'hume' | 'openai'

export interface ProviderConfig {
  sttProvider: STTProvider
  ttsProvider: TTSProvider
}

interface CreateVoiceAgentParams {
  closeConnection?: (reason: string) => void
  /** Additional callback to run when speech starts (for barge-in handling). */
  onSpeechStart?: () => void
  /** Provider configuration */
  providers?: ProviderConfig
  /** User's name for personalized greeting */
  userName?: string
  /** The thread ID for the conversation */
  threadId?: string
}

/**
 * Create the STT provider based on user selection
 */
function createSTTProvider(provider: STTProvider, onSpeechStart?: () => void) {
  switch (provider) {
    case 'assemblyai':
      return new AssemblyAISpeechToText({
        apiKey: process.env.ASSEMBLYAI_API_KEY!,
        sampleRate: 16000,
        onSpeechStart,
      })
    case 'openai':
      return new OpenAISpeechToText({
        apiKey: process.env.OPENAI_API_KEY!,
        onSpeechStart,
      })
    default:
      throw new Error(`Unknown STT provider: ${provider}`)
  }
}

/**
 * Create the TTS provider based on user selection
 */
function createTTSProvider(provider: TTSProvider, onAudioComplete?: () => void) {
  switch (provider) {
    case 'elevenlabs':
      return new ElevenLabsTextToSpeech({
        apiKey: process.env.ELEVENLABS_API_KEY!,
        voiceId: process.env.ELEVENLABS_VOICE_ID!,
        onAudioComplete,
      })
    case 'hume':
      return new HumeTextToSpeech({
        apiKey: process.env.HUME_API_KEY!,
        onAudioComplete,
      })
    case 'openai':
      return new OpenAITextToSpeech({
        apiKey: process.env.OPENAI_API_KEY!,
        onAudioComplete,
      })
    default:
      throw new Error(`Unknown TTS provider: ${provider}`)
  }
}

/**
 * Get available providers based on environment configuration
 */
export function getAvailableProviders(): {
  stt: { id: STTProvider; name: string; available: boolean }[]
  tts: { id: TTSProvider; name: string; available: boolean }[]
} {
  return {
    stt: [
      {
        id: 'assemblyai',
        name: 'AssemblyAI',
        available: !!process.env.ASSEMBLYAI_API_KEY,
      },
      {
        id: 'openai',
        name: 'OpenAI Whisper',
        available: !!process.env.OPENAI_API_KEY,
      },
    ],
    tts: [
      {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        available: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
      },
      {
        id: 'hume',
        name: 'Hume AI',
        available: !!process.env.HUME_API_KEY,
      },
      {
        id: 'openai',
        name: 'OpenAI TTS',
        available: !!process.env.OPENAI_API_KEY,
      },
    ],
  }
}

export function createCareerCoachVoiceAgent(params: CreateVoiceAgentParams) {
  const {
    closeConnection,
    onSpeechStart,
    providers = { sttProvider: 'assemblyai', ttsProvider: 'elevenlabs' },
    userName,
    threadId,
  } = params

  console.log(
    `Creating voice agent with STT: ${
      providers.sttProvider
    }, TTS: ${providers.ttsProvider}, User: ${
      userName || 'Anonymous'
    }, Thread: ${threadId || 'N/A'}`
  )

  const stt = createSTTProvider(providers.sttProvider, onSpeechStart)
  const tts = createTTSProvider(providers.ttsProvider, () => {
    if (pendingHangUp && closeConnection) {
      closeConnection(pendingHangUp)
      pendingHangUp = null
    }
  })

  return createVoiceAgent({
    // LangChain agent configuration
    model: new LangGraphModel(threadId),
    checkpointer: new MemorySaver(),

    // Voice configuration
    stt,
    tts,
    middleware: [createFillerMiddleware()],

    // Callbacks
    onInterrupt: (value: unknown) => {
      console.log('[VoiceAgent] Interrupt:', value)
    },
    onHangUp: (reason: string) => {
      console.log('[VoiceAgent] Hang up requested:', reason)
      pendingHangUp = reason
    },
  })
}
