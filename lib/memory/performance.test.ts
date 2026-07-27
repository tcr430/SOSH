import { vi, describe, it, expect, beforeEach } from 'vitest'
import { retrieveRelevant } from './performance'
import * as memoryPerformanceDb from '@/lib/db/memory-performance'
import * as postMetricsDb from '@/lib/db/post-metrics'
import * as postsDb from '@/lib/db/posts'
import type { PerformanceMemoryRow, PostMetricsRow, PostRow } from '@/lib/db/types'
import { PERFORMANCE_CAP } from './constants'

vi.mock('@/lib/db/memory-performance', () => ({
  listPerformanceMemoryCandidates: vi.fn(),
}))
vi.mock('@/lib/db/post-metrics', () => ({
  listTopPostMetrics: vi.fn(),
}))
vi.mock('@/lib/db/posts', () => ({
  listPostsByIds: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeGovernedRow(overrides: Partial<PerformanceMemoryRow> = {}): PerformanceMemoryRow {
  return {
    id: 'pf-1',
    business_id: 'biz-1',
    source: 'distilled',
    confidence: 0.7,
    observation_count: 3,
    status: 'active',
    sensitivity: 'internal',
    public_use_permission: false,
    scope: 'brand',
    scope_ref: null,
    last_confirmed_at: '2026-07-19T00:00:00Z',
    recency_at: '2026-07-19T00:00:00Z',
    expires_at: null,
    deleted_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    dimension: 'topic',
    pattern: 'technical-comparison posts perform well for CTO audiences',
    platform: 'linkedin',
    pattern_key: null,
    ...overrides,
  }
}

function makeMetricsRow(overrides: Partial<PostMetricsRow> = {}): PostMetricsRow {
  return {
    id: 'pm-1',
    post_id: 'post-1',
    business_id: 'biz-1',
    likes: 42,
    comments: 3,
    shares: 1,
    saves: 0,
    clicks: 5,
    reach: 900,
    impressions: 1200,
    last_synced_at: '2026-07-19T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    ...overrides,
  }
}

function makePostRow(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'post-1',
    campaign_id: 'camp-1',
    business_id: 'biz-1',
    platform: 'linkedin',
    content: 'Why technical comparisons win CTO trust',
    hashtags: [],
    media_urls: [],
    scheduled_at: '2026-07-01T00:00:00Z',
    published_at: '2026-07-01T00:00:00Z',
    platform_post_id: 'li-123',
    platform_url: null,
    status: 'published',
    role: null,
    rejection_note: null,
    ai_generation_metadata: {},
    publish_attempts: 1,
    last_publish_attempt_at: '2026-07-01T00:00:00Z',
    last_publish_error: null,
    deleted_at: null,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

describe('retrieveRelevant (performance) — governed rows preferred', () => {
  it('prefers scored performance_memory rows when any exist, and does not touch post_metrics', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([makeGovernedRow()])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    // A governed pattern is a distilled insight, not a specific post — it has
    // no per-post likes/impressions, so those keys are OMITTED, not invented
    // as 0 (MINOR-2). Only platform + topContent are carried.
    expect(result).toEqual([
      { platform: 'linkedin', topContent: 'technical-comparison posts perform well for CTO audiences' },
    ])
    expect(result[0]).not.toHaveProperty('likes')
    expect(result[0]).not.toHaveProperty('impressions')
    expect(postMetricsDb.listTopPostMetrics).not.toHaveBeenCalled()
  })

  it('keeps a governed row with a NULL platform (cross-platform) rather than dropping it, carrying platform: null (MINOR-3)', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([
      makeGovernedRow({ id: 'pf-no-platform', pattern: 'cross-platform pattern', platform: null, confidence: 0.9 }),
      makeGovernedRow({ id: 'pf-linkedin', pattern: 'linkedin pattern', platform: 'linkedin', confidence: 0.1 }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    // Both survive — the cross-platform row is no longer silently dropped. It
    // carries platform: null (the prompt renders it "Across platforms"), never
    // a guessed platform. The higher-confidence null-platform row ranks first.
    expect(result).toEqual([
      { platform: null, topContent: 'cross-platform pattern' },
      { platform: 'linkedin', topContent: 'linkedin pattern' },
    ])
  })

  it('caps governed results at PERFORMANCE_CAP', async () => {
    const candidates = Array.from({ length: PERFORMANCE_CAP + 2 }, (_, i) =>
      makeGovernedRow({ id: `pf-${i}`, confidence: (i + 1) / 10, pattern: `pattern-${i}` }),
    )
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue(candidates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toHaveLength(PERFORMANCE_CAP)
  })
})

describe('retrieveRelevant (performance) — post_metrics fallback (Track A empty-table reality)', () => {
  it('falls back to post_metrics when performance_memory has no rows yet', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue([makeMetricsRow()])
    vi.mocked(postsDb.listPostsByIds).mockResolvedValue([makePostRow()])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toEqual([
      { platform: 'linkedin', topContent: 'Why technical comparisons win CTO trust', likes: 42, impressions: 1200 },
    ])
  })

  it('requests at most PERFORMANCE_CAP metrics from post_metrics (not the old cap of 10)', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue([])
    vi.mocked(postsDb.listPostsByIds).mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    await retrieveRelevant(client, 'biz-1', {})

    expect(postMetricsDb.listTopPostMetrics).toHaveBeenCalledWith(client, 'biz-1', PERFORMANCE_CAP)
  })

  it('enforces PERFORMANCE_CAP itself, independent of whether listTopPostMetrics honoured the limit it was asked for', async () => {
    // Defense-in-depth: even if the (mocked, or a hypothetically buggy real)
    // post_metrics query ignored its limit argument and returned more than
    // PERFORMANCE_CAP rows, this layer must not pass that overflow through.
    const overflowMetrics = Array.from({ length: PERFORMANCE_CAP + 4 }, (_, i) =>
      makeMetricsRow({ post_id: `post-${i}`, likes: i }),
    )
    const overflowPosts = Array.from({ length: PERFORMANCE_CAP + 4 }, (_, i) =>
      makePostRow({ id: `post-${i}`, content: `content-${i}` }),
    )
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue(overflowMetrics)
    vi.mocked(postsDb.listPostsByIds).mockResolvedValue(overflowPosts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toHaveLength(PERFORMANCE_CAP)
  })

  it('preserves null-vs-zero: a metric with null likes becomes 0, not dropped or NaN', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue([makeMetricsRow({ likes: null, impressions: null })])
    vi.mocked(postsDb.listPostsByIds).mockResolvedValue([makePostRow()])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result[0].likes).toBe(0)
    expect(result[0].impressions).toBe(0)
  })

  it('filters out a metric row whose post was not found (soft-deleted or missing)', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue([makeMetricsRow({ post_id: 'missing-post' })])
    vi.mocked(postsDb.listPostsByIds).mockResolvedValue([]) // post not found (e.g. soft-deleted)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toEqual([])
  })

  it('returns empty immediately when there are no post_metrics rows at all', async () => {
    vi.mocked(memoryPerformanceDb.listPerformanceMemoryCandidates).mockResolvedValue([])
    vi.mocked(postMetricsDb.listTopPostMetrics).mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toEqual([])
    expect(postsDb.listPostsByIds).not.toHaveBeenCalled()
  })
})
