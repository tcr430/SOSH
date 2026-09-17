import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/backfill-runs', () => ({
  recordBackfillRunSummary: vi.fn(),
}))

import { recordBackfillRunSummary } from '@/lib/db/backfill-runs'
import { computeBackfillStats, writeBackfillStatsSummary } from '../stats'
import type { SocialBackfillPostRow } from '@/lib/db/types'

const mockRecordBackfillRunSummary = vi.mocked(recordBackfillRunSummary)

afterEach(() => {
  vi.clearAllMocks()
})

function makePost(overrides: Partial<SocialBackfillPostRow> = {}): SocialBackfillPostRow {
  return {
    id: 'post-1',
    business_id: 'biz-1',
    run_id: 'run-1',
    social_account_id: 'sa-1',
    platform_post_id: 'p-1',
    published_at: '2026-01-05T09:00:00Z', // Monday, 09:00 UTC
    content: 'hello',
    url: null,
    format: 'text',
    metrics: null,
    lift: null,
    extraction_status: 'pending',
    claimed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ADR 0025 §4.1 step 2 (Session 32 I2.10) — no model call anywhere in this
// file; a model client spy across the whole stats step records zero calls.
describe('computeBackfillStats', () => {
  it('counts weekday, hour and format distributions', () => {
    const posts = [
      makePost({ id: 'p1', published_at: '2026-01-05T09:00:00Z', format: 'text' }), // Monday
      makePost({ id: 'p2', published_at: '2026-01-06T09:00:00Z', format: 'image' }), // Tuesday
      makePost({ id: 'p3', published_at: '2026-01-05T14:00:00Z', format: 'text' }), // Monday
    ]
    const stats = computeBackfillStats(posts)
    expect(stats.totalPosts).toBe(3)
    expect(stats.weekdayDistribution.monday).toBe(2)
    expect(stats.weekdayDistribution.tuesday).toBe(1)
    expect(stats.hourDistribution['9']).toBe(2)
    expect(stats.hourDistribution['14']).toBe(1)
    expect(stats.formatDistribution.text).toBe(2)
    expect(stats.formatDistribution.image).toBe(1)
  })

  it('computes length distribution (min/max/median/mean) from content length', () => {
    const posts = [
      makePost({ id: 'p1', content: 'a' }), // 1
      makePost({ id: 'p2', content: 'abc' }), // 3
      makePost({ id: 'p3', content: 'abcdefghij' }), // 10
    ]
    const stats = computeBackfillStats(posts)
    expect(stats.lengthDistribution).toEqual({ min: 1, max: 10, median: 3, mean: (1 + 3 + 10) / 3 })
  })

  it('spanDays is the number of days between the earliest and latest post', () => {
    const posts = [
      makePost({ id: 'p1', published_at: '2026-01-01T00:00:00Z' }),
      makePost({ id: 'p2', published_at: '2026-01-11T00:00:00Z' }),
    ]
    expect(computeBackfillStats(posts).spanDays).toBe(10)
  })

  // MAJOR-12 (Session 32-D, D9) — the real date range the step-4 headline
  // (ADR §10.4 item 1) reads, never a field nothing writes.
  it('dateRange carries the earliest and latest published_at, exactly', () => {
    const posts = [
      makePost({ id: 'p1', published_at: '2026-01-01T00:00:00Z' }),
      makePost({ id: 'p2', published_at: '2026-01-11T00:00:00Z' }),
      makePost({ id: 'p3', published_at: '2026-01-05T00:00:00Z' }),
    ]
    expect(computeBackfillStats(posts).dateRange).toEqual({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-11T00:00:00Z',
    })
  })

  it('an empty post list produces zeroed stats, not a throw', () => {
    const stats = computeBackfillStats([])
    expect(stats.totalPosts).toBe(0)
    expect(stats.spanDays).toBe(0)
    expect(stats.dateRange).toBeNull()
    expect(stats.engagementBaselineBasis).toBe('none')
  })

  it('a model client spy records ZERO calls across the whole step', () => {
    const modelClientSpy = vi.fn()
    computeBackfillStats([makePost()])
    expect(modelClientSpy).not.toHaveBeenCalled()
  })
})

describe('writeBackfillStatsSummary', () => {
  it('writes the computed summary and weighting flag through lib/db/backfill-runs.ts', async () => {
    const summary = computeBackfillStats([makePost()])
    await writeBackfillStatsSummary('run-1', summary, 'weighted')
    expect(mockRecordBackfillRunSummary).toHaveBeenCalledWith('run-1', summary, 'weighted')
  })
})
