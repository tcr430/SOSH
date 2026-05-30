import { describe, it, expect } from 'vitest'
import { MODELS, calculateCostCents } from './models'

describe('MODELS', () => {
  it('OPUS_4_7 has correct id and positive rates', () => {
    expect(MODELS.OPUS_4_7.id).toBe('claude-opus-4-7')
    expect(MODELS.OPUS_4_7.inputCostPerMTok).toBeGreaterThan(0)
    expect(MODELS.OPUS_4_7.outputCostPerMTok).toBeGreaterThan(0)
  })

  it('SONNET_4_6 has correct id and positive rates', () => {
    expect(MODELS.SONNET_4_6.id).toBe('claude-sonnet-4-6')
    expect(MODELS.SONNET_4_6.inputCostPerMTok).toBeGreaterThan(0)
    expect(MODELS.SONNET_4_6.outputCostPerMTok).toBeGreaterThan(0)
  })

  it('HAIKU_4_5 has correct id and positive rates', () => {
    expect(MODELS.HAIKU_4_5.id).toBe('claude-haiku-4-5-20251001')
    expect(MODELS.HAIKU_4_5.inputCostPerMTok).toBeGreaterThan(0)
    expect(MODELS.HAIKU_4_5.outputCostPerMTok).toBeGreaterThan(0)
  })

  it('output rate is greater than input rate for all models', () => {
    for (const key of ['OPUS_4_7', 'SONNET_4_6', 'HAIKU_4_5'] as const) {
      expect(MODELS[key].outputCostPerMTok).toBeGreaterThan(
        MODELS[key].inputCostPerMTok,
      )
    }
  })
})

describe('calculateCostCents', () => {
  it('returns 0 for zero tokens', () => {
    expect(calculateCostCents('OPUS_4_7', 0, 0, 0)).toBe(0)
  })

  it('computes 1M input tokens at OPUS_4_7 rate', () => {
    // 1_000_000 * 1500 / 1_000_000 = 1500, ceil(1500) = 1500
    expect(calculateCostCents('OPUS_4_7', 1_000_000, 0)).toBe(1500)
  })

  it('computes 1M output tokens at OPUS_4_7 rate', () => {
    // 1_000_000 * 7500 / 1_000_000 = 7500
    expect(calculateCostCents('OPUS_4_7', 0, 1_000_000)).toBe(7500)
  })

  it('computes combined input + output cost (OPUS_4_7)', () => {
    // input: 3000 * 1500 / 1M = 4.5
    // output:  800 * 7500 / 1M = 6.0
    // total: ceil(10.5) = 11
    expect(calculateCostCents('OPUS_4_7', 3000, 800)).toBe(11)
  })

  it('weights cache_read_tokens at 10% of input rate', () => {
    // 1M cache-read * (1500 * 0.10) / 1M = 150
    expect(calculateCostCents('OPUS_4_7', 0, 0, 1_000_000)).toBe(150)
  })

  it('combines input + cache_read + output correctly', () => {
    // input:      1000 * 1500        / 1M = 1.5
    // cacheRead:  2000 * 1500 * 0.1  / 1M = 0.3
    // output:      400 * 7500        / 1M = 3.0
    // total: ceil(4.8) = 5
    expect(calculateCostCents('OPUS_4_7', 1000, 400, 2000)).toBe(5)
  })

  it('returns an integer (ceil) for fractional cent costs', () => {
    // 1 input token at OPUS_4_7: 1500 / 1_000_000 = 0.0015 → ceil = 1
    const result = calculateCostCents('OPUS_4_7', 1, 0)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1)
  })

  it('uses SONNET_4_6 rates correctly', () => {
    // 1M input at 300 cents/MTok = 300
    expect(calculateCostCents('SONNET_4_6', 1_000_000, 0)).toBe(300)
  })

  it('uses HAIKU_4_5 rates correctly', () => {
    // 1M input at 100 cents/MTok = 100
    expect(calculateCostCents('HAIKU_4_5', 1_000_000, 0)).toBe(100)
  })

  it('cacheReadTokens defaults to 0 when omitted', () => {
    const explicit = calculateCostCents('OPUS_4_7', 1000, 500, 0)
    const omitted = calculateCostCents('OPUS_4_7', 1000, 500)
    expect(explicit).toBe(omitted)
  })
})
