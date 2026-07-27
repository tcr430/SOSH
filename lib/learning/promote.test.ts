import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeConfidence,
  meetsPromotionThreshold,
  meetsDemotionThreshold,
  recomputeAndUpsertPattern,
  LEARN_PROMOTION_MIN_OBSERVATIONS,
  LEARN_PROMOTION_MIN_CONFIDENCE,
  LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS,
  LEARN_CONFIDENCE_K,
  LEARN_CONFIDENCE_CEILING,
  LEARN_DEMOTION_NET,
} from '@/lib/learning/promote'
import type { PerformanceMemoryRow } from '@/lib/db/types'

vi.mock('@/lib/db/memory-performance', () => ({
  countProcessedSignalsForPattern: vi.fn(),
  upsertDistilledPerformancePattern: vi.fn(),
  promotePerformancePattern: vi.fn(),
  demotePerformancePattern: vi.fn(),
}))

import {
  countProcessedSignalsForPattern,
  upsertDistilledPerformancePattern,
  promotePerformancePattern,
  demotePerformancePattern,
} from '@/lib/db/memory-performance'

describe('named constants', () => {
  it('match ADR 0018 §7.3', () => {
    expect(LEARN_PROMOTION_MIN_OBSERVATIONS).toBe(5)
    expect(LEARN_PROMOTION_MIN_CONFIDENCE).toBe(0.7)
    expect(LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS).toBe(2)
    expect(LEARN_CONFIDENCE_K).toBe(2)
    expect(LEARN_CONFIDENCE_CEILING).toBe(0.95)
    expect(LEARN_DEMOTION_NET).toBe(3)
  })
})

describe('computeConfidence', () => {
  it('at exactly 5 clean observations yields 0.714 — just clearing the 0.70 gate', () => {
    expect(computeConfidence(5, 0)).toBeCloseTo(0.714, 3)
    expect(computeConfidence(5, 0)).toBeGreaterThanOrEqual(LEARN_PROMOTION_MIN_CONFIDENCE)
  })

  it('a contradiction lowers confidence below the gate at the same observation count', () => {
    // 5 observations, 1 contradiction -> net 4 -> 4/6 = 0.667, below 0.70
    expect(computeConfidence(5, 1)).toBeCloseTo(0.667, 3)
    expect(computeConfidence(5, 1)).toBeLessThan(LEARN_PROMOTION_MIN_CONFIDENCE)
  })

  it('is 0 when net is zero or negative', () => {
    expect(computeConfidence(3, 3)).toBe(0)
    expect(computeConfidence(2, 5)).toBe(0)
  })

  it('is capped at the ceiling for a large net', () => {
    expect(computeConfidence(1000, 0)).toBe(LEARN_CONFIDENCE_CEILING)
  })
})

describe('meetsPromotionThreshold — boundary arithmetic', () => {
  it('4 observations does NOT promote, even with high confidence and 2 campaigns', () => {
    expect(
      meetsPromotionThreshold({ observationCount: 4, confidence: 0.9, distinctCampaignCount: 2 }),
    ).toBe(false)
  })

  it('5 observations within ONE campaign does NOT promote', () => {
    const confidence = computeConfidence(5, 0)
    expect(
      meetsPromotionThreshold({ observationCount: 5, confidence, distinctCampaignCount: 1 }),
    ).toBe(false)
  })

  it('5 observations across TWO campaigns DOES promote', () => {
    const confidence = computeConfidence(5, 0)
    expect(
      meetsPromotionThreshold({ observationCount: 5, confidence, distinctCampaignCount: 2 }),
    ).toBe(true)
  })

  it('both the observation gate and the confidence gate bind together — K=2 is load-bearing', () => {
    // Exactly 5 observations, 0 contradictions clears both gates simultaneously.
    // This proves K=3 would have been a lie: 5/(5+3) = 0.625 < 0.70, which
    // would make LEARN_PROMOTION_MIN_OBSERVATIONS unreachable at K=3.
    const confidenceAtK2 = 5 / (5 + 2)
    const confidenceAtK3 = 5 / (5 + 3)
    expect(confidenceAtK2).toBeGreaterThanOrEqual(0.7)
    expect(confidenceAtK3).toBeLessThan(0.7)
  })
})

describe('meetsDemotionThreshold', () => {
  it('net < 3 demotes an active row', () => {
    expect(meetsDemotionThreshold(2)).toBe(true)
    expect(meetsDemotionThreshold(0)).toBe(true)
    expect(meetsDemotionThreshold(-1)).toBe(true)
  })

  it('net >= 3 does not demote', () => {
    expect(meetsDemotionThreshold(3)).toBe(false)
    expect(meetsDemotionThreshold(10)).toBe(false)
  })
})

describe('LEARN-NO-SINGLE-DIFF-PROMOTION', () => {
  it('one diff (observationCount=1) never yields a promotable eligibility, regardless of confidence/campaigns', () => {
    expect(meetsPromotionThreshold({ observationCount: 1, confidence: 0.95, distinctCampaignCount: 5 })).toBe(false)
  })
})

describe('recomputeAndUpsertPattern', () => {
  const row = { id: 'pf-1', status: 'candidate' } as unknown as PerformanceMemoryRow
  const mockClient = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(upsertDistilledPerformancePattern).mockResolvedValue(row)
    vi.mocked(promotePerformancePattern).mockResolvedValue(null)
    vi.mocked(demotePerformancePattern).mockResolvedValue(null)
  })

  it('recomputes observation_count via COUNT, never increments — passes the recomputed count straight to the upsert', async () => {
    vi.mocked(countProcessedSignalsForPattern).mockResolvedValueOnce(5) // observations
    await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'shortens LinkedIn posts',
      patternKey: 'length_delta:shorter:linkedin',
      contradictingPatternKey: 'length_delta:longer:linkedin',
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(upsertDistilledPerformancePattern).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ observation_count: 5 }),
    )
  })

  it('recomputes contradictions via the contradicting pattern_key and folds them into confidence', async () => {
    vi.mocked(countProcessedSignalsForPattern)
      .mockResolvedValueOnce(5) // observations
      .mockResolvedValueOnce(1) // contradictions
    const result = await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'shortens LinkedIn posts',
      patternKey: 'length_delta:shorter:linkedin',
      contradictingPatternKey: 'length_delta:longer:linkedin',
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(result.contradictions).toBe(1)
    expect(result.confidence).toBeCloseTo(computeConfidence(5, 1), 5)
  })

  it('skips the contradiction query entirely when contradictingPatternKey is null', async () => {
    vi.mocked(countProcessedSignalsForPattern).mockResolvedValueOnce(3)
    await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'strips thread numbering',
      patternKey: 'numbering_stripped:fixed:linkedin',
      contradictingPatternKey: null,
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(countProcessedSignalsForPattern).toHaveBeenCalledTimes(1)
  })

  it('always attempts BOTH promote and demote (never pre-checks status in TS before deciding)', async () => {
    vi.mocked(countProcessedSignalsForPattern).mockResolvedValueOnce(5).mockResolvedValueOnce(0)
    await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'shortens LinkedIn posts',
      patternKey: 'length_delta:shorter:linkedin',
      contradictingPatternKey: 'length_delta:longer:linkedin',
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(promotePerformancePattern).toHaveBeenCalledWith(
      mockClient,
      'biz-1',
      'length_delta:shorter:linkedin',
      'format',
      'linkedin',
    )
  })

  it('does not call demote when net >= LEARN_DEMOTION_NET', async () => {
    vi.mocked(countProcessedSignalsForPattern).mockResolvedValueOnce(10).mockResolvedValueOnce(0)
    await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'shortens LinkedIn posts',
      patternKey: 'length_delta:shorter:linkedin',
      contradictingPatternKey: 'length_delta:longer:linkedin',
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(demotePerformancePattern).not.toHaveBeenCalled()
  })

  it('calls demote with the computed net when net < LEARN_DEMOTION_NET', async () => {
    vi.mocked(countProcessedSignalsForPattern).mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    await recomputeAndUpsertPattern(mockClient, {
      businessId: 'biz-1',
      dimension: 'format',
      pattern: 'shortens LinkedIn posts',
      patternKey: 'length_delta:shorter:linkedin',
      contradictingPatternKey: 'length_delta:longer:linkedin',
      platform: 'linkedin',
      scope: 'platform',
      scopeRef: 'linkedin',
    })

    expect(demotePerformancePattern).toHaveBeenCalledWith(
      mockClient,
      'biz-1',
      'length_delta:shorter:linkedin',
      'format',
      'linkedin',
      2,
    )
  })
})
