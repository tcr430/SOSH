import { describe, it, expect } from 'vitest'
import { buildRetrospectivePattern } from '../retrospective-text'

// ADR 0026 §8.4 (J2.11) — the closed template around member-editable text.

const retro = (over: Record<string, unknown> = {}) => ({
  verdict: 'supported' as const, n: 11, wins: 9, interval_low: 0.62, interval_high: 0.95,
  hypothesis_snapshot: 'Threads beat singles', ...over,
})

describe('buildRetrospectivePattern', () => {
  it("renders ADR 0026 §8.4's sentence", () => {
    expect(buildRetrospectivePattern(retro(), 'Q3 launch')).toBe(
      "Campaign 'Q3 launch' tested: 'Threads beat singles'. Result: supported — 9 of 11 posts beat this brand's usual engagement (interval 0.62–0.95).",
    )
  })

  it('a not-supported verdict says so plainly, and never a multiplier or a causal verb', () => {
    const text = buildRetrospectivePattern(retro({ verdict: 'not_supported', wins: 3 }), 'Q3') as string
    expect(text).toContain('Result: not supported — 3 of 11 posts')
    expect(text).not.toMatch(/\d\s*x\b|causes|drives|leads to|proven/i)
  })

  it('an inconclusive retrospective writes NOTHING (null)', () => {
    expect(buildRetrospectivePattern(retro({ verdict: 'inconclusive' }), 'Q3')).toBeNull()
  })

  it('is bounded well under the 500-character column even for a 300-char hypothesis and a long name', () => {
    const text = buildRetrospectivePattern(retro({ hypothesis_snapshot: 'h'.repeat(300) }), 'N'.repeat(200)) as string
    expect(text.length).toBeLessThanOrEqual(400)
    expect(text).toContain("this brand's usual engagement")
  })

  it('member text is flattened to one line so it cannot break the sentence shape', () => {
    const text = buildRetrospectivePattern(retro({ hypothesis_snapshot: 'a\n\nb   c' }), 'x\ny') as string
    expect(text).not.toContain('\n')
    expect(text).toContain("'a b c'")
  })
})
