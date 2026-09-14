import { describe, it, expect } from 'vitest'
import { BackfillInsightsOutputSchema } from './backfill-insights'

function validOutput() {
  return {
    patterns: [{ dimension: 'topic', pattern: 'talks about pricing transparency often', backingPostIds: ['p1', 'p2', 'p3', 'p4', 'p5'] }],
    audienceStatements: [{ kind: 'problem', statement: 'audience struggles with onboarding time', backingPostIds: ['p1', 'p2'] }],
  }
}

// ADR 0025 §4.1 step 4 (Session 32 I2.11) — the model NEVER supplies n or
// confidence; the schema has no field for either.
describe('BackfillInsightsOutputSchema', () => {
  it('accepts a well-formed output', () => {
    expect(BackfillInsightsOutputSchema.safeParse(validOutput()).success).toBe(true)
  })

  it('REJECTS a pattern carrying a confidence field (strict — not silently stripped)', () => {
    const output = validOutput()
    ;(output.patterns[0] as Record<string, unknown>).confidence = 0.9
    expect(BackfillInsightsOutputSchema.safeParse(output).success).toBe(false)
  })

  it('REJECTS a pattern carrying an observationCount/n field', () => {
    const output = validOutput()
    ;(output.patterns[0] as Record<string, unknown>).n = 12
    expect(BackfillInsightsOutputSchema.safeParse(output).success).toBe(false)
  })

  it('REJECTS an audience statement carrying a confidence field', () => {
    const output = validOutput()
    ;(output.audienceStatements[0] as Record<string, unknown>).confidence = 0.3
    expect(BackfillInsightsOutputSchema.safeParse(output).success).toBe(false)
  })
})
