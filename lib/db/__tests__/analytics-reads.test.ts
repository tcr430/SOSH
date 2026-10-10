import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ADR 0031 §9.1 — every new analytics read, row by row: the business filter, the ORDER BY, the page size. A recording
// client proves each reader applies `.eq('business_id', businessId)` ITSELF (get_user_business_ids() returns an array,
// so RLS alone does not separate a user's two businesses) and orders and bounds exactly as the table says.
//
// The service-role factory THROWS here: an authenticated reader that reached for it fails by name
// (ANALYTICS-AUTHENTICATED-READS).
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => {
    throw new Error('service-role client used by an authenticated analytics reader')
  },
}))

type Call = [string, ...unknown[]]
const calls: Call[] = []
let pages: Array<{ data?: unknown; error?: unknown; count?: number | null }> = []

function chain(table: string) {
  const c: Record<string, unknown> = {}
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([`${table}.${name}`, ...args])
    return c
  }
  for (const m of ['select', 'eq', 'is', 'gte', 'lt', 'lte', 'in', 'order', 'limit', 'or']) c[m] = rec(m)
  const next = () => {
    const p = pages.length > 1 ? pages.shift()! : (pages[0] ?? { data: [] })
    return { data: p.data ?? [], error: p.error ?? null, count: p.count ?? null }
  }
  c.maybeSingle = () => {
    calls.push([`${table}.maybeSingle`])
    const r = next()
    return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })
  }
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej)
  return c
}
const client = { from: chain } as unknown as SupabaseClient

import { countPublishedPostsInRange, listPublishedPostsInRange } from '../posts'
import { listMonthOutcomes, listTrendOutcomes, listDimensionsForAnalytics } from '../post-outcomes'
import { listMetricsForPosts } from '../post-metrics'
import { listCompletedRetrospectivesInRange } from '../campaign-retrospectives'
import { listAccountLabels } from '../social-accounts'
import { getReportById, getReportByPeriod, listReports } from '../analytics-reports'
import { ReadCeilingExceeded } from '../keyset-pager'

const RANGE = { start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' }
const OUT_Q = { platform: 'twitter', ...RANGE, outcomesThrough: '2026-04-10T06:00:00.000Z' }

const callsFor = (table: string) => calls.filter((c) => c[0].startsWith(`${table}.`))
const has = (...c: Call) => expect(calls).toContainEqual(c)
const selectOf = (table: string) => String(callsFor(table).find((c) => c[0] === `${table}.select`)?.[1])

beforeEach(() => {
  calls.length = 0
  pages = [{ data: [] }]
})

describe('published posts in the month (ADR 0031 §9.1 row 1)', () => {
  it('filters business, published, not deleted and the range, orders published_at DESC then id DESC, 500 a page', async () => {
    await listPublishedPostsInRange(client, 'biz', RANGE)
    has('posts.eq', 'business_id', 'biz')
    has('posts.eq', 'status', 'published')
    has('posts.is', 'deleted_at', null)
    has('posts.gte', 'published_at', RANGE.start)
    has('posts.lt', 'published_at', RANGE.end)
    has('posts.order', 'published_at', { ascending: false })
    has('posts.order', 'id', { ascending: false })
    has('posts.limit', 500)
  })

  it('the tie-breaker is the SECOND order key, after published_at', async () => {
    await listPublishedPostsInRange(client, 'biz', RANGE)
    const orders = callsFor('posts').filter((c) => c[0] === 'posts.order').map((c) => c[1])
    expect(orders).toEqual(['published_at', 'id'])
  })

  it('selects business_id with every row, and no post text', async () => {
    await listPublishedPostsInRange(client, 'biz', RANGE)
    expect(selectOf('posts')).toContain('business_id')
    expect(selectOf('posts')).not.toMatch(/content|hashtags/)
  })

  it('pages with a keyset on the ORDER BY columns: page two starts strictly after page one\'s last row', async () => {
    const row = (id: string, at: string) => ({ id, business_id: 'biz', platform: 'twitter', published_at: at, social_account_id: null, campaign_id: 'c' })
    pages = [
      { data: [row('p3', '2026-03-09T09:00:00+00:00'), row('p2', '2026-03-05T09:00:00+00:00')] },
      { data: [row('p1', '2026-03-05T09:00:00+00:00')] },
    ]
    const out = await listPublishedPostsInRange(client, 'biz', RANGE, { pageSize: 2 })
    expect(out.map((r) => r.id)).toEqual(['p3', 'p2', 'p1'])
    has('posts.limit', 2)
    has('posts.or', 'published_at.lt."2026-03-05T09:00:00+00:00",and(published_at.eq."2026-03-05T09:00:00+00:00",id.lt."p2")')
    expect(callsFor('posts').filter((c) => c[0] === 'posts.or')).toHaveLength(1)
    // The business filter is on EVERY page, not only the first.
    expect(callsFor('posts').filter((c) => c[0] === 'posts.eq' && c[1] === 'business_id')).toHaveLength(2)
  })

  it('a page size above the table\'s 500 is clamped to 500', async () => {
    await listPublishedPostsInRange(client, 'biz', RANGE, { pageSize: 1e9 })
    has('posts.limit', 500)
  })

  it('more than 5,000 rows throws ReadCeilingExceeded instead of returning a truncated list', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, published_at: '2026-03-05T09:00:00+00:00' }))
    pages = [{ data: full }]
    await expect(listPublishedPostsInRange(client, 'biz', RANGE)).rejects.toBeInstanceOf(ReadCeilingExceeded)
  })

  it('a database error is thrown, not read as an empty month', async () => {
    pages = [{ error: { message: 'boom' } }]
    await expect(listPublishedPostsInRange(client, 'biz', RANGE)).rejects.toThrow('boom')
  })
})

describe('the activity count (ADR 0031 §9.1 row 2)', () => {
  it('is a head count with the same predicates, no rows, no order, no limit', async () => {
    pages = [{ data: null, count: 13 }]
    expect(await countPublishedPostsInRange(client, 'biz', RANGE)).toBe(13)
    has('posts.select', 'id', { count: 'exact', head: true })
    has('posts.eq', 'business_id', 'biz')
    has('posts.eq', 'status', 'published')
    has('posts.is', 'deleted_at', null)
    has('posts.gte', 'published_at', RANGE.start)
    has('posts.lt', 'published_at', RANGE.end)
    expect(callsFor('posts').some((c) => c[0] === 'posts.order' || c[0] === 'posts.limit')).toBe(false)
  })

  it('a null count THROWS: it is never read as 0', async () => {
    pages = [{ data: null, count: null }]
    await expect(countPublishedPostsInRange(client, 'biz', RANGE)).rejects.toThrow(/count/)
  })
})

describe('outcomes in the month and the trend (ADR 0031 §9.1 rows 3 and 4)', () => {
  it('month: business, platform, range, measured_at <= outcomes_through, published_at DESC then post_id DESC, 500 a page', async () => {
    await listMonthOutcomes(client, 'biz', OUT_Q)
    has('post_outcomes.eq', 'business_id', 'biz')
    has('post_outcomes.eq', 'platform', 'twitter')
    has('post_outcomes.gte', 'published_at', RANGE.start)
    has('post_outcomes.lt', 'published_at', RANGE.end)
    has('post_outcomes.lte', 'measured_at', OUT_Q.outcomesThrough)
    has('post_outcomes.order', 'published_at', { ascending: false })
    has('post_outcomes.order', 'post_id', { ascending: false })
    has('post_outcomes.limit', 500)
  })

  it('trend: the same predicates at 1,000 a page', async () => {
    await listTrendOutcomes(client, 'biz', OUT_Q)
    has('post_outcomes.eq', 'business_id', 'biz')
    has('post_outcomes.lte', 'measured_at', OUT_Q.outcomesThrough)
    has('post_outcomes.limit', 1000)
  })

  it('the tie-breaker is post_id, second', async () => {
    await listMonthOutcomes(client, 'biz', OUT_Q)
    expect(callsFor('post_outcomes').filter((c) => c[0] === 'post_outcomes.order').map((c) => c[1])).toEqual(['published_at', 'post_id'])
  })

  it('never selects log_lift, and selects business_id', async () => {
    await listMonthOutcomes(client, 'biz', OUT_Q)
    expect(selectOf('post_outcomes')).not.toMatch(/log_lift/)
    expect(selectOf('post_outcomes')).toContain('business_id')
  })

  it('pages by keyset on (published_at, post_id) and keeps the business filter on page two', async () => {
    const row = (id: string, at: string) => ({ post_id: id, business_id: 'biz', platform: 'twitter', published_at: at, ai_original_id: null, metric_basis: 'rate', value: '0.031', beat_baseline: null, baseline_source: null, length_band: null, cta_present: null, hook_survived: null, measured_at: '2026-04-01T04:00:00+00:00' })
    pages = [{ data: [row('o2', '2026-03-09T09:00:00+00:00'), row('o1', '2026-03-05T09:00:00+00:00')] }, { data: [row('o0', '2026-03-03T09:00:00+00:00')] }]
    const out = await listMonthOutcomes(client, 'biz', OUT_Q, { pageSize: 2 })
    expect(out.map((r) => r.post_id)).toEqual(['o2', 'o1', 'o0'])
    has('post_outcomes.or', 'published_at.lt."2026-03-05T09:00:00+00:00",and(published_at.eq."2026-03-05T09:00:00+00:00",post_id.lt."o1")')
    expect(callsFor('post_outcomes').filter((c) => c[0] === 'post_outcomes.eq' && c[1] === 'business_id')).toHaveLength(2)
  })

  it('value comes back as a number (numeric columns arrive as strings)', async () => {
    pages = [{ data: [{ post_id: 'o', business_id: 'biz', platform: 'twitter', published_at: '2026-03-05T09:00:00+00:00', ai_original_id: null, metric_basis: 'rate', value: '0.031', beat_baseline: true, baseline_source: 'own', length_band: 'short', cta_present: false, hook_survived: null, measured_at: 'x' }] }]
    const out = await listMonthOutcomes(client, 'biz', OUT_Q)
    expect(out[0].value).toBe(0.031)
  })

  it('more than 5,000 outcomes throw ReadCeilingExceeded', async () => {
    pages = [{ data: Array.from({ length: 500 }, (_, i) => ({ post_id: `o${i}`, published_at: '2026-03-05T09:00:00+00:00', value: '0.1' })) }]
    await expect(listMonthOutcomes(client, 'biz', OUT_Q)).rejects.toBeInstanceOf(ReadCeilingExceeded)
  })
})

describe('raw metrics "so far" (ADR 0031 §9.1 row 5)', () => {
  it('business, post_id IN, ordered by post_id, 120 a chunk; 250 ids are three queries', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`)
    await listMetricsForPosts(client, 'biz', ids)
    const queries = callsFor('post_metrics').filter((c) => c[0] === 'post_metrics.in')
    expect(queries.map((c) => (c[2] as string[]).length)).toEqual([120, 120, 10])
    expect(callsFor('post_metrics').filter((c) => c[0] === 'post_metrics.eq' && c[1] === 'business_id')).toHaveLength(3)
    expect(callsFor('post_metrics').filter((c) => c[0] === 'post_metrics.order').every((c) => c[1] === 'post_id')).toBe(true)
    has('post_metrics.limit', 120)
  })

  it('no ids is no query', async () => {
    expect(await listMetricsForPosts(client, 'biz', [])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('dimensions (ADR 0031 §9.1 row 6)', () => {
  it('business, ai_original_id IN in chunks of 200, ordered by ai_original_id; ids are de-duplicated', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `a${i}`)
    await listDimensionsForAnalytics(client, 'biz', [...ids, 'a0', 'a1'])
    const queries = callsFor('post_dimensions').filter((c) => c[0] === 'post_dimensions.in')
    expect(queries.map((c) => (c[2] as string[]).length)).toEqual([200, 200, 50])
    expect(callsFor('post_dimensions').filter((c) => c[0] === 'post_dimensions.eq' && c[1] === 'business_id')).toHaveLength(3)
    has('post_dimensions.order', 'ai_original_id', { ascending: true })
    has('post_dimensions.limit', 200)
  })

  it('no ids is no query', async () => {
    expect(await listDimensionsForAnalytics(client, 'biz', [])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('retrospectives completed in the month (ADR 0031 §9.1 row 7)', () => {
  it('business, completed_at range, completed_at DESC, 100; no log-lift column is selected', async () => {
    await listCompletedRetrospectivesInRange(client, 'biz', RANGE)
    has('campaign_retrospectives.eq', 'business_id', 'biz')
    has('campaign_retrospectives.gte', 'completed_at', RANGE.start)
    has('campaign_retrospectives.lt', 'completed_at', RANGE.end)
    has('campaign_retrospectives.order', 'completed_at', { ascending: false })
    has('campaign_retrospectives.limit', 100)
    expect(selectOf('campaign_retrospectives')).not.toMatch(/log_lift/)
  })
})

describe('reports (ADR 0031 §9.1 rows 8 and 9)', () => {
  it('by period: business and period_month, one row', async () => {
    await getReportByPeriod(client, 'biz', '2026-03-01')
    has('analytics_reports.eq', 'business_id', 'biz')
    has('analytics_reports.eq', 'period_month', '2026-03-01')
    expect(callsFor('analytics_reports').some((c) => c[0] === 'analytics_reports.maybeSingle')).toBe(true)
  })

  it('by id: business AND id (a report id alone never reads across businesses)', async () => {
    await getReportById(client, 'biz', 'rid')
    has('analytics_reports.eq', 'business_id', 'biz')
    has('analytics_reports.eq', 'id', 'rid')
  })

  it('a missing report is null, not an error', async () => {
    expect(await getReportByPeriod(client, 'biz', '2026-03-01')).toBeNull()
  })

  it('the list: business, period_month DESC, 24, and an absurd limit is clamped to 24', async () => {
    await listReports(client, 'biz', 1e9)
    has('analytics_reports.eq', 'business_id', 'biz')
    has('analytics_reports.order', 'period_month', { ascending: false })
    has('analytics_reports.limit', 24)
  })
})

describe('social account labels (ADR 0031 §9.1 row 11)', () => {
  it('business, id IN in chunks of 20, ordered by id, 20; selects no token or vault column', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `s${i}`)
    await listAccountLabels(client, 'biz', ids)
    const queries = callsFor('social_accounts').filter((c) => c[0] === 'social_accounts.in')
    expect(queries.map((c) => (c[2] as string[]).length)).toEqual([20, 20, 5])
    expect(callsFor('social_accounts').filter((c) => c[0] === 'social_accounts.eq' && c[1] === 'business_id')).toHaveLength(3)
    has('social_accounts.order', 'id', { ascending: true })
    has('social_accounts.limit', 20)
    expect(selectOf('social_accounts')).not.toMatch(/vault|token|secret/i)
  })

  it('no ids is no query', async () => {
    expect(await listAccountLabels(client, 'biz', [])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('every reader binds the business ITSELF (ANALYTICS-AUTHENTICATED-READS)', () => {
  it('a business id is applied by each of the eleven readers, and the service-role factory is never reached', async () => {
    pages = [{ data: [], count: 0 }]
    await listPublishedPostsInRange(client, 'bizX', RANGE)
    await countPublishedPostsInRange(client, 'bizX', RANGE)
    await listMonthOutcomes(client, 'bizX', OUT_Q)
    await listTrendOutcomes(client, 'bizX', OUT_Q)
    await listDimensionsForAnalytics(client, 'bizX', ['a'])
    await listMetricsForPosts(client, 'bizX', ['p'])
    await listCompletedRetrospectivesInRange(client, 'bizX', RANGE)
    await listAccountLabels(client, 'bizX', ['s'])
    await getReportByPeriod(client, 'bizX', '2026-03-01')
    await getReportById(client, 'bizX', 'r')
    await listReports(client, 'bizX')
    const tables = ['posts', 'post_outcomes', 'post_dimensions', 'post_metrics', 'campaign_retrospectives', 'social_accounts', 'analytics_reports']
    for (const t of tables) expect(calls, t).toContainEqual([`${t}.eq`, 'business_id', 'bizX'])
    // Every query began with a select, and each was followed by a business filter before the next select.
    const sequence = calls.filter((c) => c[0].endsWith('.select') || (c[0].endsWith('.eq') && c[1] === 'business_id'))
    let open = 0
    for (const c of sequence) {
      if (c[0].endsWith('.select')) {
        expect(open, 'a select started before the previous query bound its business').toBe(0)
        open = 1
      } else open = 0
    }
  })
})
