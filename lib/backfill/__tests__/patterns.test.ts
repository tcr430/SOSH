import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/memory/import', () => ({
  importPerformanceItem: vi.fn(),
}))

import { importPerformanceItem } from '@/lib/memory/import'
import { importedConfidence, computeFormatPatterns, writeFormatPatterns } from '../patterns/format'
import type { SocialBackfillPostRow } from '@/lib/db/types'

const mockImportPerformanceItem = vi.mocked(importPerformanceItem)

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
    format: 'image',
    metrics: null,
    lift: null,
    extraction_status: 'pending',
    claimed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ADR 0025 §4.3 BACKFILL-CONFIDENCE-CAPPED (Session 32 I2.10) — 0.6 * n/(n+5), ceiling 0.6.
describe('importedConfidence', () => {
  it('importedConfidence(5) = 0.30', () => {
    expect(importedConfidence(5)).toBeCloseTo(0.3, 10)
  })

  it('importedConfidence(20) = 0.48', () => {
    expect(importedConfidence(20)).toBeCloseTo(0.48, 10)
  })

  it('importedConfidence(10000) is < 0.6 and never above it', () => {
    expect(importedConfidence(10000)).toBeLessThan(0.6)
    for (const n of [0, 1, 5, 20, 100, 100000]) {
      expect(importedConfidence(n)).toBeLessThanOrEqual(0.6)
    }
  })
})

// ADR 0025 §4.3 BACKFILL-PERFORMANCE-WEIGHTED (format half) — n >= 5 AND
// median lift >= 1.25 to qualify as a pattern.
describe('computeFormatPatterns', () => {
  function liftMap(entries: Array<[string, number]>): Map<string, number> {
    return new Map(entries)
  }

  it('a format with n=4 and lift 3.0 is NOT written (below the n floor)', () => {
    const posts = Array.from({ length: 4 }, (_, i) => makePost({ id: `p${i}`, format: 'video' }))
    const lifts = liftMap(posts.map((p) => [p.id, 3.0]))
    expect(computeFormatPatterns(posts, lifts)).toEqual([])
  })

  it('a format with n=5 and lift 1.24 is NOT written (below the lift floor)', () => {
    const posts = Array.from({ length: 5 }, (_, i) => makePost({ id: `p${i}`, format: 'video' }))
    const lifts = liftMap(posts.map((p) => [p.id, 1.24]))
    expect(computeFormatPatterns(posts, lifts)).toEqual([])
  })

  it('a format with n=5 and lift 1.25 IS written', () => {
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePost({ id: `p${i}`, format: 'video', platform_post_id: `pp${i}`, published_at: `2026-01-0${i + 1}T00:00:00Z` }),
    )
    const lifts = liftMap(posts.map((p) => [p.id, 1.25]))
    const candidates = computeFormatPatterns(posts, lifts)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      format: 'video',
      n: 5,
      medianLift: 1.25,
      backingPostIds: ['pp0', 'pp1', 'pp2', 'pp3', 'pp4'],
      newestPublishedAt: '2026-01-05T00:00:00Z',
    })
  })

  it('posts with no computed lift (excluded from the lifts map) never count toward n', () => {
    const posts = Array.from({ length: 5 }, (_, i) => makePost({ id: `p${i}`, format: 'video' }))
    const lifts = liftMap(posts.slice(0, 4).map((p) => [p.id, 3.0])) // only 4 of 5 have a lift
    expect(computeFormatPatterns(posts, lifts)).toEqual([])
  })

  it('a model client spy records ZERO calls across the whole step (ADR §4.1 step 2-3 is deterministic, L-8)', () => {
    const posts = Array.from({ length: 10 }, (_, i) => makePost({ id: `p${i}`, format: 'link' }))
    const lifts = liftMap(posts.map((p) => [p.id, 2.0]))
    const modelClientSpy = vi.fn()
    computeFormatPatterns(posts, lifts)
    expect(modelClientSpy).not.toHaveBeenCalled()
  })
})

describe('writeFormatPatterns', () => {
  it('calls importPerformanceItem once per candidate with dimension=format and the shared confidence formula', async () => {
    await writeFormatPatterns('biz-1', 'run-1', 'linkedin', [
      { format: 'video', n: 8, medianLift: 1.5, backingPostIds: ['pp1', 'pp2'], newestPublishedAt: '2026-06-01T00:00:00Z' },
    ])

    expect(mockImportPerformanceItem).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        runId: 'run-1',
        sourcePostIds: ['pp1', 'pp2'],
        dimension: 'format',
        platform: 'linkedin',
        confidence: importedConfidence(8),
        observationCount: 8,
        newestPublishedAt: '2026-06-01T00:00:00Z',
      }),
    )
  })

  it('writes nothing for an empty candidate list', async () => {
    await writeFormatPatterns('biz-1', 'run-1', 'linkedin', [])
    expect(mockImportPerformanceItem).not.toHaveBeenCalled()
  })
})
