import { describe, it, expect } from 'vitest'
import { resolvePostJudgment, isExcludedFromBulkApprove } from './judgment'
import type { PostAiOriginalRow } from '@/lib/db/types'

function makeOriginal(overrides: Partial<PostAiOriginalRow> = {}): PostAiOriginalRow {
  const dim = { score: 80, note: 'ok' }
  return {
    id: 'orig-1',
    business_id: 'biz-1',
    post_id: 'post-1',
    campaign_id: 'camp-1',
    revision: 1,
    generation_kind: 'initial',
    format: 'single',
    payload: {},
    rendered_content: 'x',
    hashtags: [],
    schema_version: 2,
    overall_score: 75,
    dimension_scores: {
      specificity: dim, originality: dim, evidenceSufficiency: dim, audienceRelevance: dim,
      platformNativeness: dim, brandVoiceAlignment: dim, openingStrength: dim, ctaFit: dim,
      unsupportedClaimsRisk: dim, redundancy: dim,
    },
    candidate_count: 3,
    cleared_quality_threshold: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolvePostJudgment (ADR 0024 §8.3, H2.12)', () => {
  it('returns null when no original row exists at all', () => {
    expect(resolvePostJudgment(undefined)).toBeNull()
  })

  it('returns judged-and-passed when cleared_quality_threshold is true', () => {
    const result = resolvePostJudgment(makeOriginal({ cleared_quality_threshold: true, overall_score: 82, candidate_count: 3 }))
    expect(result).toMatchObject({ state: 'judged-and-passed', overall: 82, candidateCount: 3 })
  })

  it('returns all-below-threshold when cleared_quality_threshold is false', () => {
    const result = resolvePostJudgment(makeOriginal({ cleared_quality_threshold: false, overall_score: 55 }))
    expect(result).toMatchObject({ state: 'all-below-threshold', overall: 55 })
  })

  it('returns judging-failed when cleared_quality_threshold is null (the §2.3 unscored outcome)', () => {
    const result = resolvePostJudgment(makeOriginal({
      cleared_quality_threshold: null,
      overall_score: null,
      dimension_scores: null,
      candidate_count: null,
    }))
    expect(result).toEqual({ state: 'judging-failed' })
  })

  it('returns judging-failed for a pre-H2.4 legacy row (schema_version 1, all four columns null) — honestly "not scored", never a passing badge', () => {
    const result = resolvePostJudgment(makeOriginal({
      schema_version: 1,
      overall_score: null,
      dimension_scores: null,
      candidate_count: null,
      cleared_quality_threshold: null,
    }))
    expect(result).toEqual({ state: 'judging-failed' })
  })
})

describe('isExcludedFromBulkApprove (ADR 0024 §8.4, A-3, H2.12)', () => {
  it('excludes a below-threshold post', () => {
    expect(isExcludedFromBulkApprove(makeOriginal({ cleared_quality_threshold: false }))).toBe(true)
  })

  it('does NOT exclude a judged-and-passed post', () => {
    expect(isExcludedFromBulkApprove(makeOriginal({ cleared_quality_threshold: true }))).toBe(false)
  })

  it('does NOT exclude an unscored post — only a CONFIRMED below-threshold result is excluded', () => {
    expect(isExcludedFromBulkApprove(makeOriginal({ cleared_quality_threshold: null }))).toBe(false)
  })

  it('does NOT exclude a post with no original row at all', () => {
    expect(isExcludedFromBulkApprove(undefined)).toBe(false)
  })
})
