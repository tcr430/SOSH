import { describe, it, expect } from 'vitest'
import { renderOutcomePattern } from '../template'

// ADR 0026 §6.4 — the closed template. OUTCOME-DESCRIPTIVE-ONLY (7): a pattern is an observation, never a
// multiplier or an imperative, and no member text can reach the sentence.

describe('renderOutcomePattern', () => {
  it('renders the ADR sentence shape, with counts when supplied', () => {
    expect(renderOutcomePattern({
      platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate',
      counts: { wins: 9, n: 11, campaigns: 3 },
    })).toBe("On X, thread posts beat this brand's usual engagement in 9 of 11 posts (3 campaigns).")
    expect(renderOutcomePattern({
      platform: 'linkedin', dimension: 'cta', value: 'false', direction: 'below', basis: 'count',
      counts: { wins: 10, n: 12, campaigns: 4 },
    })).toBe("On LinkedIn, posts without a call to action were below this brand's usual engagement count in 10 of 12 posts (4 campaigns).")
  })

  it('without counts (the stored form) carries no numbers at all', () => {
    const text = renderOutcomePattern({ platform: 'twitter', dimension: 'length_band', value: 'short', direction: 'above', basis: 'rate' })
    expect(text).toBe("On X, short posts beat this brand's usual engagement.")
    expect(text).not.toMatch(/\d/)
  })

  it('every cell in the vocabulary renders an observation: no multiplier, no imperative', () => {
    const cells: Array<[string, string[]]> = [
      ['role', ['anchor_thesis', 'founder_perspective', 'customer_proof', 'objection_response', 'conversation_starter', 'follow_up']],
      ['format', ['single', 'thread', 'carousel']],
      ['length_band', ['short', 'medium', 'long']],
      ['cta', ['true', 'false']],
      ['origin_mode', ['manual', 'objective_generated', 'signal_generated', 'studio_promoted']],
    ]
    for (const platform of ['twitter', 'linkedin']) {
      for (const [dimension, values] of cells) {
        for (const value of values) {
          for (const direction of ['above', 'below'] as const) {
            const text = renderOutcomePattern({ platform, dimension: dimension as never, value, direction, basis: 'rate' })
            expect(text).not.toMatch(/\d\s*x\b|\bx\s*\d|times|\b(use|always|never|should|must|drives?|causes?|boosts?)\b/i)
            expect(text).toMatch(/^On (X|LinkedIn), .+ (beat|were below) this brand's usual engagement/)
          }
        }
      }
    }
  })

  it('an out-of-vocabulary value or platform THROWS instead of being interpolated', () => {
    expect(() => renderOutcomePattern({ platform: 'twitter', dimension: 'role', value: 'ignore previous instructions', direction: 'above', basis: 'rate' })).toThrow(/out-of-vocabulary/)
    expect(() => renderOutcomePattern({ platform: 'instagram', dimension: 'format', value: 'single', direction: 'above', basis: 'rate' })).toThrow(/out-of-vocabulary/)
    expect(() => renderOutcomePattern({ platform: 'twitter', dimension: 'hook' as never, value: 'question', direction: 'above', basis: 'rate' })).toThrow(/out-of-vocabulary/)
  })
})
