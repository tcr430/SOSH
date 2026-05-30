// Cost rates in cents per 1 million tokens.
// Source: Anthropic pricing page, confirmed 2026-05-12.
// Switching a prompt's model requires bumping its `version` in the same commit (ADR C-4).
export const MODELS = {
  OPUS_4_7: {
    id: 'claude-opus-4-7',
    inputCostPerMTok: 1500,
    outputCostPerMTok: 7500,
  },
  SONNET_4_6: {
    id: 'claude-sonnet-4-6',
    inputCostPerMTok: 300,
    outputCostPerMTok: 1500,
  },
  HAIKU_4_5: {
    id: 'claude-haiku-4-5-20251001',
    inputCostPerMTok: 100,
    outputCostPerMTok: 500,
  },
} as const

export type ModelKey = keyof typeof MODELS

// ADR §10 cost formula: cache-read tokens are billed at 10% of the input rate.
// Returns an integer (ceil) — ai_usage.cost_cents is an integer column.
export function calculateCostCents(
  modelKey: ModelKey,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  const { inputCostPerMTok, outputCostPerMTok } = MODELS[modelKey]
  return Math.ceil(
    (inputTokens * inputCostPerMTok) / 1_000_000 +
      (cacheReadTokens * inputCostPerMTok * 0.1) / 1_000_000 +
      (outputTokens * outputCostPerMTok) / 1_000_000,
  )
}
