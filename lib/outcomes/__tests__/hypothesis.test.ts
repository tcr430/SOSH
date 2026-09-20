import { describe, it, expect } from 'vitest'
import { HypothesisFieldsSchema, HypothesisSchema, SuccessCriteriaSchema } from '../hypothesis'

// ADR 0017 Amendment E / ADR 0026 §8.1 (J2.10) — OUTCOME-HYPOTHESIS-IN-BRIEF (24). Every range boundary in and
// out, the metric/target discriminant, and a pre-amendment brief (neither field) still parsing.

const criteria = (over: Record<string, unknown> = {}) => ({ metric: 'win_rate', target: 0.6, evaluationWindowDays: 14, ...over })

describe('hypothesis text: 1..300 characters', () => {
  it.each([[1, true], [300, true], [0, false], [301, false]])('length %i -> accepted: %s', (n, ok) => {
    expect(HypothesisSchema.safeParse('x'.repeat(n)).success).toBe(ok)
  })
  it('is trimmed, so whitespace alone is empty', () => {
    expect(HypothesisSchema.safeParse('   ').success).toBe(false)
  })
})

describe('win_rate target: [0.5, 0.95]', () => {
  it.each([[0.5, true], [0.95, true], [0.7, true], [0.49, false], [0.951, false], [1, false], [0, false]])('target %f -> %s', (target, ok) => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ target })).success).toBe(ok)
  })
})

describe('median_lift target: [1.0, 3.0]', () => {
  it.each([[1.0, true], [3.0, true], [2, true], [0.99, false], [3.01, false], [0.6, false]])('target %f -> %s', (target, ok) => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ metric: 'median_lift', target })).success).toBe(ok)
  })
})

describe('the metric / target discriminant', () => {
  it('a target valid for one metric is refused for the other (never clamped)', () => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ metric: 'win_rate', target: 2 })).success).toBe(false)
    expect(SuccessCriteriaSchema.safeParse(criteria({ metric: 'median_lift', target: 0.6 })).success).toBe(false)
  })
  it('an unknown metric is refused', () => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ metric: 'likes' })).success).toBe(false)
  })
  it('a non-finite target is refused', () => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ target: Number.NaN })).success).toBe(false)
    expect(SuccessCriteriaSchema.safeParse(criteria({ target: Number.POSITIVE_INFINITY, metric: 'median_lift' })).success).toBe(false)
  })
})

describe('evaluationWindowDays: integer in [7, 60]', () => {
  it.each([[7, true], [60, true], [30, true], [6, false], [61, false], [14.5, false]])('window %f -> %s', (evaluationWindowDays, ok) => {
    expect(SuccessCriteriaSchema.safeParse(criteria({ evaluationWindowDays })).success).toBe(ok)
  })
})

describe('both or neither', () => {
  it('a pre-amendment brief with neither field still parses', () => {
    expect(HypothesisFieldsSchema.safeParse({}).success).toBe(true)
  })
  it('both together parse', () => {
    expect(HypothesisFieldsSchema.safeParse({ hypothesis: 'Threads beat singles', successCriteria: criteria() }).success).toBe(true)
  })
  it('a hypothesis without criteria, or criteria without a hypothesis, is refused', () => {
    expect(HypothesisFieldsSchema.safeParse({ hypothesis: 'Threads beat singles' }).success).toBe(false)
    expect(HypothesisFieldsSchema.safeParse({ successCriteria: criteria() }).success).toBe(false)
  })
})
