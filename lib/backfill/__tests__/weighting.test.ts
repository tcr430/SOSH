import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/backfill-posts', () => ({
  updateBackfillPostLifts: vi.fn(),
}))

import { updateBackfillPostLifts } from '@/lib/db/backfill-posts'
import { computeWeightedSubset, writeBackfillLifts } from '../weighting'
import { computeEngagementBaseline } from '../stats'
import { BACKFILL_WEIGHTED_SUBSET } from '../constants'
import type { SocialBackfillPostRow } from '@/lib/db/types'

const mockUpdateBackfillPostLifts = vi.mocked(updateBackfillPostLifts)

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
    published_at: '2026-01-01T00:00:00Z',
    content: 'hello world',
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

describe('computeWeightedSubset (ADR 0025 §4.1 step 3, Session 32 I2.10)', () => {
  it('a 40-post fixture with known metrics: the subset is exactly the known top 30 ids', () => {
    // engagement = index (0..39, all via raw likes/comments/shares, no
    // impressions) — baseline = median = value at index 19/20 midpoint.
    // Regardless of the exact baseline, dividing every post by the SAME
    // baseline preserves rank order, so "top 30 by engagement" ==
    // "top 30 by lift". Post 39 has the highest engagement, post 0 lowest.
    const posts = Array.from({ length: 40 }, (_, i) =>
      makePost({
        id: `post-${i}`,
        published_at: new Date(2026, 0, 1 + i).toISOString(),
        metrics: { likes: i, comments: 0, shares: 0 },
      }),
    )

    const { subset, weighting } = computeWeightedSubset(posts)

    expect(weighting).toBe('weighted')
    expect(subset).toHaveLength(BACKFILL_WEIGHTED_SUBSET)
    const expectedTop30Ids = Array.from({ length: 30 }, (_, i) => `post-${39 - i}`) // 39 down to 10
    expect(subset.map((p) => p.id)).toEqual(expectedTop30Ids)
  })

  it('a metrics-separate fixture (all null): subset = 30 most recent, weighting=unweighted_no_metrics', () => {
    const posts = Array.from({ length: 40 }, (_, i) =>
      makePost({ id: `post-${i}`, published_at: new Date(2026, 0, 1 + i).toISOString(), metrics: null }),
    )

    const { subset, weighting, lifts } = computeWeightedSubset(posts)

    expect(weighting).toBe('unweighted_no_metrics')
    expect(lifts.size).toBe(0)
    expect(subset).toHaveLength(30)
    // 30 most recent = the 30 with the latest publishedAt (post-10..post-39)
    const expectedIds = Array.from({ length: 30 }, (_, i) => `post-${39 - i}`)
    expect(subset.map((p) => p.id)).toEqual(expectedIds)
  })

  it('ties in lift break toward the newer publishedAt', () => {
    const posts = [
      makePost({ id: 'older', published_at: '2026-01-01T00:00:00Z', metrics: { likes: 10, comments: 0, shares: 0 } }),
      makePost({ id: 'newer', published_at: '2026-02-01T00:00:00Z', metrics: { likes: 10, comments: 0, shares: 0 } }),
    ]
    const { subset } = computeWeightedSubset(posts)
    expect(subset.map((p) => p.id)).toEqual(['newer', 'older'])
  })

  it('a post with metrics but no impressions gets excluded from ranking when the run basis is impressions', () => {
    const posts = [
      makePost({ id: 'with-impressions', metrics: { likes: 10, comments: 0, shares: 0, impressions: 100 } }),
      makePost({ id: 'no-impressions', metrics: { likes: 1000, comments: 0, shares: 0 } }), // huge raw, but no impressions
    ]
    const { subset, lifts } = computeWeightedSubset(posts)
    expect(lifts.has('no-impressions')).toBe(false)
    expect(subset.map((p) => p.id)).toEqual(['with-impressions'])
  })

  describe('baseline basis switching (computeEngagementBaseline)', () => {
    it('switches to the impressions form when any post has impressions', () => {
      const posts = [makePost({ metrics: { likes: 10, comments: 0, shares: 0, impressions: 100 } })]
      const { basis } = computeEngagementBaseline(posts)
      expect(basis).toBe('impressions')
    })

    it('switches to the raw form when no post has impressions', () => {
      const posts = [makePost({ metrics: { likes: 10, comments: 0, shares: 0 } })]
      const { basis } = computeEngagementBaseline(posts)
      expect(basis).toBe('raw')
    })

    it('is "none" when no post has metrics at all', () => {
      const posts = [makePost({ metrics: null })]
      const { basis, baseline } = computeEngagementBaseline(posts)
      expect(basis).toBe('none')
      expect(baseline).toBe(0)
    })
  })
})

describe('writeBackfillLifts', () => {
  it('maps the lifts Map to an {id, lift}[] array for the RPC wrapper', async () => {
    mockUpdateBackfillPostLifts.mockResolvedValue(2)
    const lifts = new Map([
      ['post-a', 1.5],
      ['post-b', 0.8],
    ])
    const result = await writeBackfillLifts('run-1', lifts)
    expect(mockUpdateBackfillPostLifts).toHaveBeenCalledWith('run-1', [
      { id: 'post-a', lift: 1.5 },
      { id: 'post-b', lift: 0.8 },
    ])
    expect(result).toBe(2)
  })
})
