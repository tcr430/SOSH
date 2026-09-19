import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0026 J2.7 wrapper contract: every function filters on business_id, lists are bounded + ordered.
const calls: Array<[string, ...unknown[]]> = []
// One queued result per awaited query, in order; the last one repeats.
let queue: Array<{ data: unknown; error: unknown }> = []

function next() {
  return queue.length > 1 ? queue.shift()! : queue[0] ?? { data: [], error: null }
}

function chain(table: string) {
  const c: Record<string, unknown> = {}
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([`${table}.${name}`, ...args])
    return c
  }
  for (const m of ['select', 'eq', 'lt', 'lte', 'not', 'is', 'in', 'order', 'limit', 'upsert']) c[m] = rec(m)
  c.maybeSingle = () => Promise.resolve(next())
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej)
  return c
}
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: chain }) }))

import { getEngagementSeed, insertPostOutcome, listMaturedOutcomesForBaseline, listPostsDueForOutcome } from './post-outcomes'

beforeEach(() => {
  calls.length = 0
  queue = [{ data: [], error: null }]
})

describe('post-outcomes wrappers', () => {
  it('listMaturedOutcomesForBaseline filters business + platform, orders published_at DESC, bounds', async () => {
    await listMaturedOutcomesForBaseline('biz', 'twitter', { before: '2026-09-10T00:00:00Z', limit: 50 })
    expect(calls).toContainEqual(['post_outcomes.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['post_outcomes.eq', 'platform', 'twitter'])
    expect(calls).toContainEqual(['post_outcomes.lt', 'published_at', '2026-09-10T00:00:00Z'])
    expect(calls).toContainEqual(['post_outcomes.order', 'published_at', { ascending: false }])
    expect(calls).toContainEqual(['post_outcomes.limit', 50])
  })

  it('listMaturedOutcomesForBaseline clamps an absurd limit', async () => {
    await listMaturedOutcomesForBaseline('biz', 'twitter', { before: '2026-09-10T00:00:00Z', limit: 1e9 })
    expect(calls).toContainEqual(['post_outcomes.limit', 500])
  })

  it('listPostsDueForOutcome filters on business, published, oldest first, bounded', async () => {
    queue = [{ data: [{ id: 'x', published_at: '2026-09-01T00:00:00Z', post_metrics: null }], error: null }, { data: [], error: null }]
    await listPostsDueForOutcome('biz', { now: '2026-09-19T00:00:00Z', limit: 10 })
    expect(calls).toContainEqual(['posts.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['posts.eq', 'status', 'published'])
    expect(calls).toContainEqual(['posts.order', 'published_at', { ascending: true }])
    expect(calls).toContainEqual(['posts.limit', 10])
    expect(calls).toContainEqual(['post_outcomes.eq', 'business_id', 'biz'])
  })

  it('classifies ready / no_metrics / waiting and skips posts that already have an outcome', async () => {
    const post = (id: string, publishedAt: string, synced: string | null) => ({
      id, published_at: publishedAt, post_metrics: synced ? { last_synced_at: synced } : null,
    })
    queue = [
      {
        data: [
          post('ready', '2026-09-01T00:00:00Z', '2026-09-09T00:00:00Z'),
          post('nosync', '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z'), // synced before day 7, past grace
          post('grace', '2026-09-11T12:00:00Z', null), // 7.5 days old: inside grace, left for a later tick
          post('done', '2026-09-01T00:00:00Z', '2026-09-09T00:00:00Z'),
        ],
        error: null,
      },
      { data: [{ post_id: 'done' }], error: null },
    ]
    const out = await listPostsDueForOutcome('biz', { now: '2026-09-19T00:00:00Z' })
    const byId = Object.fromEntries(out.map((d) => [d.post.id, d.due]))
    expect(byId).toEqual({ ready: 'ready', nosync: 'no_metrics' })
  })

  it('insertPostOutcome upserts ignoring duplicates on post_id and reports whether it wrote', async () => {
    queue = [{ data: [{ post_id: 'p' }], error: null }]
    expect(await insertPostOutcome({ post_id: 'p' } as never)).toBe(true)
    expect(calls).toContainEqual(['post_outcomes.upsert', { post_id: 'p' }, { onConflict: 'post_id', ignoreDuplicates: true }])
    queue = [{ data: [], error: null }]
    expect(await insertPostOutcome({ post_id: 'p' } as never)).toBe(false)
  })

  it('getEngagementSeed maps impressions->rate, raw->count, none->null and filters on business', async () => {
    queue = [{ data: { summary: { engagementBaseline: 0.03, engagementBaselineBasis: 'impressions' } }, error: null }]
    expect(await getEngagementSeed('biz', 'twitter')).toEqual({ value: 0.03, basis: 'rate' })
    expect(calls).toContainEqual(['social_backfill_runs.eq', 'business_id', 'biz'])
    queue = [{ data: { summary: { engagementBaseline: 30, engagementBaselineBasis: 'raw' } }, error: null }]
    expect(await getEngagementSeed('biz', 'twitter')).toEqual({ value: 30, basis: 'count' })
    queue = [{ data: { summary: { engagementBaseline: 0, engagementBaselineBasis: 'none' } }, error: null }]
    expect(await getEngagementSeed('biz', 'twitter')).toBeNull()
  })
})
