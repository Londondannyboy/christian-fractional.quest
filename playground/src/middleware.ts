import { createThinkingFillerMiddleware } from 'create-voice-agent'

export const fillerMiddleware = createThinkingFillerMiddleware({
  thresholdMs: 1200,
  fillerPhrases: [
    'Let me see here...',
    'Hmm, one moment...',
    'Ah, let me check...',
    'Just a second...',
  ],
  maxFillersPerTurn: 1,
})
