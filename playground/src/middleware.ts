import { createThinkingFillerMiddleware } from '../../core/src/index.js'

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
