import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseISO } from 'date-fns'
import { ReadCeilingExceeded } from '@/lib/db/keyset-pager'

// ADR 0031 §3, §4.2, §4.4 — the loaders. The db readers are faked from the portfolio fixture so the loader's own logic is what
// runs, and every reader's ARGUMENTS are asserted (the client by identity, the business id): a loader that mocked its
// callees' return values without checking what it passed them would prove nothing about tenancy (cerebrum, 36-D).
const mocks = vi.hoisted(() => ({
  getBusinessById: vi.fn(),
  listPublishedPostsInRange: vi.fn(),
  countPublishedPostsInRange: vi.fn(),
  listMonthOutcomes: vi.fn(),
  listTrendOutcomes: vi.fn(),
  listDimensionsForAnalytics: vi.fn(),
  listMetricsForPosts: vi.fn(),
  listAccountLabels: vi.fn(),
  listCampaigns: vi.fn(),
  listCompletedRetrospectivesInRange: vi.fn(),
  retrievePatterns: vi.fn(),
}))
vi.mock('@/lib/db/businesses', () => ({ getBusinessById: mocks.getBusinessById }))
vi.mock('@/lib/db/posts', () => ({ listPublishedPostsInRange: mocks.listPublishedPostsInRange, countPublishedPostsInRange: mocks.countPublishedPostsInRange }))
vi.mock('@/lib/db/post-outcomes', () => ({ listMonthOutcomes: mocks.listMonthOutcomes, listTrendOutcomes: mocks.listTrendOutcomes, listDimensionsForAnalytics: mocks.listDimensionsForAnalytics }))
vi.mock('@/lib/db/post-metrics', () => ({ listMetricsForPosts: mocks.listMetricsForPosts }))
vi.mock('@/lib/db/social-accounts', () => ({ listAccountLabels: mocks.listAccountLabels }))
vi.mock('@/lib/db/campaigns', () => ({ listCampaigns: mocks.listCampaigns }))
vi.mock('@/lib/db/campaign-retrospectives', () => ({ listCompletedRetrospectivesInRange: mocks.listCompletedRetrospectivesInRange }))

import {
  A_CAMPAIGN_ACTIVE_ID,
  A_CAMPAIGN_COMPLETED_ID,
  A_CAMPAIGN_MANUAL_ID,
  A_LI_ACCOUNT_ID,
  A_X_ACCOUNT_ID,
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  FIXTURE_ACCOUNTS,
  FIXTURE_BUSINESSES,
  FIXTURE_CAMPAIGNS,
  FIXTURE_NOW,
  FIXTURE_POSTS,
  FIXTURE_POST_DIMENSIONS,
  FIXTURE_POST_METRICS,
  FIXTURE_POST_OUTCOMES,
  postIdFor,
} from '../__fixtures__/portfolio'
import { loadPortfolio, loadPosts, type AdvancedPortfolio, type BasicPortfolio, type PostRowView } from '../load'

const client = { tag: 'authenticated-client' } as unknown as SupabaseClient
const inRange = (at: string | null, start: string, end: string) => at !== null && parseISO(at) >= parseISO(start) && parseISO(at) < parseISO(end)

// Business plans can be overridden per test; the fixture says A is pro and B is plus.
let planOverride: Record<string, unknown> = {}

const RETROS = [
  { id: 'r1', campaign_id: A_CAMPAIGN_COMPLETED_ID, business_id: BUSINESS_A_ID, verdict: 'supported', n: 12, wins: 8, interval_low: 0.4, interval_high: 0.85, status: 'completed', completed_at: '2026-03-27T10:00:00+00:00', acknowledged_at: null },
  { id: 'r2', campaign_id: A_CAMPAIGN_ACTIVE_ID, business_id: BUSINESS_A_ID, verdict: 'inconclusive', n: 3, wins: 1, interval_low: null, interval_high: null, status: 'completed', completed_at: '2026-03-30T10:00:00+00:00', acknowledged_at: null },
]

beforeEach(() => {
  planOverride = {}
  for (const fn of Object.values(mocks)) fn.mockReset()

  mocks.getBusinessById.mockImplementation(async (_c: unknown, id: string) => {
    const b = FIXTURE_BUSINESSES.find((x) => x.id === id)
    if (!b) throw new Error('not found')
    return { ...b, plan: id in planOverride ? planOverride[id] : b.plan }
  })
  mocks.listPublishedPostsInRange.mockImplementation(async (_c: unknown, biz: string, r: { start: string; end: string }) =>
    FIXTURE_POSTS.filter((p) => p.business_id === biz && p.status === 'published' && p.deleted_at === null && inRange(p.published_at, r.start, r.end))
      .sort((a, b) => (a.published_at === b.published_at ? b.id.localeCompare(a.id) : (b.published_at as string).localeCompare(a.published_at as string)))
      .map((p) => ({ id: p.id, business_id: p.business_id, platform: p.platform, published_at: p.published_at, social_account_id: p.social_account_id, campaign_id: p.campaign_id })),
  )
  mocks.countPublishedPostsInRange.mockImplementation(async (_c: unknown, biz: string, r: { start: string; end: string }) =>
    FIXTURE_POSTS.filter((p) => p.business_id === biz && p.status === 'published' && p.deleted_at === null && inRange(p.published_at, r.start, r.end)).length,
  )
  const outcomes = async (_c: unknown, biz: string, q: { platform: string; start: string; end: string; outcomesThrough: string }) =>
    FIXTURE_POST_OUTCOMES.filter((o) => o.business_id === biz && o.platform === q.platform && inRange(o.published_at, q.start, q.end) && parseISO(o.measured_at) <= parseISO(q.outcomesThrough)).map((o) => ({
      post_id: o.post_id, business_id: o.business_id, platform: o.platform, published_at: o.published_at, ai_original_id: o.ai_original_id, metric_basis: o.metric_basis, value: o.value,
      beat_baseline: o.beat_baseline, baseline_source: o.baseline_source, length_band: o.length_band, cta_present: o.cta_present, hook_survived: o.hook_survived, measured_at: o.measured_at,
    }))
  mocks.listMonthOutcomes.mockImplementation(outcomes)
  mocks.listTrendOutcomes.mockImplementation(outcomes)
  mocks.listDimensionsForAnalytics.mockImplementation(async (_c: unknown, biz: string, ids: string[]) =>
    FIXTURE_POST_DIMENSIONS.filter((d) => d.business_id === biz && ids.includes(d.ai_original_id)).map((d) => ({ ai_original_id: d.ai_original_id, role: d.role, format: d.format, origin_mode: d.origin_mode, hook_type: d.hook_type })),
  )
  mocks.listMetricsForPosts.mockImplementation(async (_c: unknown, biz: string, ids: string[]) =>
    FIXTURE_POST_METRICS.filter((m) => m.business_id === biz && ids.includes(m.post_id)),
  )
  mocks.listAccountLabels.mockImplementation(async (_c: unknown, biz: string, ids: string[]) =>
    FIXTURE_ACCOUNTS.filter((a) => a.business_id === biz && ids.includes(a.id)).map((a) => ({ id: a.id, platform: a.platform, platform_username: a.platform_username, platform_display_name: a.platform_display_name })),
  )
  mocks.listCampaigns.mockImplementation(async (_c: unknown, biz: string) => FIXTURE_CAMPAIGNS.filter((c) => c.business_id === biz))
  mocks.listCompletedRetrospectivesInRange.mockImplementation(async (_c: unknown, biz: string, r: { start: string; end: string }) =>
    RETROS.filter((x) => x.business_id === biz && inRange(x.completed_at, r.start, r.end)).sort((a, b) => b.completed_at.localeCompare(a.completed_at)),
  )
  mocks.retrievePatterns.mockResolvedValue([{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }])
})

const deps = (over: Record<string, unknown> = {}) => ({ now: () => FIXTURE_NOW, retrievePatterns: mocks.retrievePatterns, ...over })
const proReaders = () => [mocks.listTrendOutcomes, mocks.listDimensionsForAnalytics, mocks.countPublishedPostsInRange, mocks.retrievePatterns]

async function portfolio(businessId: string, month = '2026-03', over: Record<string, unknown> = {}) {
  return loadPortfolio(client, businessId, month, deps(over))
}
const ok = <T,>(s: { status: string; data?: T }): T => {
  expect(s.status).toBe('ok')
  return s.data as T
}

describe('loadPortfolio, an advanced (Pro) business: March 2026, business A (Europe/Lisbon)', () => {
  it('is the advanced tier, and the period is the one asked for', async () => {
    const p = (await portfolio(BUSINESS_A_ID)) as AdvancedPortfolio
    expect(p.tier).toBe('advanced')
    expect(p.period).toBe('2026-03')
    expect(p.previousPeriod).toBe('2026-02')
  })

  it('activity: 13 published (X 9 + 1 with no account, LinkedIn 3), 5 the month before, 2 active and 1 completed campaign', async () => {
    const a = ok((await portfolio(BUSINESS_A_ID)).activity)
    expect(a.total).toBe(13)
    expect(a.previousTotal).toBe(5)
    expect(a.campaigns).toEqual({ active: 2, completed: 1 })
    expect(a.rows.map((r) => [r.platform, r.accountId, r.count])).toEqual([
      ['linkedin', A_LI_ACCOUNT_ID, 3],
      ['twitter', A_X_ACCOUNT_ID, 9],
      ['twitter', null, 1],
    ])
  })

  it('the NULL account is its OWN labelled bucket and is never resolved to the default account (ANALYTICS-ACCOUNT-SLICEABLE)', async () => {
    const a = ok((await portfolio(BUSINESS_A_ID)).activity)
    const none = a.rows.find((r) => r.accountId === null)!
    expect(none).toMatchObject({ platform: 'twitter', count: 1, label: null, labelKey: 'analytics.account.unrecorded' })
    // Had it been defaulted, the X account would carry 10.
    expect(a.rows.find((r) => r.accountId === A_X_ACCOUNT_ID)?.count).toBe(9)
    expect(a.rows.find((r) => r.accountId === A_X_ACCOUNT_ID)).toMatchObject({ label: 'Fixture A on X', labelKey: null })
  })

  it('X, the real capability: a typical rate of 3.1% over 7, wins 4 of 6, the exclusions, a pair beside February; LinkedIn is UNAVAILABLE (no outcome read for it)', async () => {
    const platforms = ok((await portfolio(BUSINESS_A_ID)).platforms)
    expect(platforms.map((s) => [s.platform, s.state])).toEqual([['linkedin', 'unavailable'], ['twitter', 'measured']])
    expect(platforms[0]).toEqual({ platform: 'linkedin', state: 'unavailable', published: 3 })
    const x = platforms[1]
    if (x.state !== 'measured') throw new Error('X should be measured')
    expect(x.current.typical).toEqual({ state: 'number', key: 'analytics.typical', params: { n: 7, rate: '3.1%', lo: '0.0%', hi: '6.4%', rangeKind: 'minmax' } })
    expect(x.current.wins).toMatchObject({ state: 'number', params: { wins: 4, n: 6 } })
    expect(x.current.exclusions.params).toEqual({ measured: 7, published: 10, notIncluded: 3 })
    expect(x.pair?.state).toBe('pair')
    expect(x.pair?.sides.map((s) => s.period)).toEqual(['2026-02', '2026-03'])
    // LinkedIn is never asked for outcomes: the state comes from the capability, not from missing rows.
    expect(mocks.listMonthOutcomes.mock.calls.map((c) => c[2].platform)).toEqual(['twitter'])
    expect(mocks.listMetricsForPosts.mock.calls.flatMap((c) => c[2] as string[])).not.toContain(postIdFor('a_l01'))
  })

  it('Pro adds the breakdowns (with hook_type on the live page), the 12-month trend, the patterns, the retrospectives and the accounts', async () => {
    const p = (await portfolio(BUSINESS_A_ID)) as AdvancedPortfolio
    const x = ok(p.platforms).find((s) => s.platform === 'twitter')
    if (!x || x.state !== 'measured') throw new Error('X should be measured')
    expect(x.current.breakdowns.map((b) => b.dimension)).toEqual(['role', 'format', 'origin_mode', 'length_band', 'cta_present', 'hook_type'])
    expect(x.current.breakdowns[0]).toMatchObject({ dimension: 'role', populationKey: 'analytics.population.aiOnly', coverage: { key: 'analytics.coverage', params: { k: 5, n: 7 } } })

    const trend = ok(p.trend)
    expect(trend.months).toHaveLength(12)
    expect(trend.months[0]).toEqual({ period: '2025-04', published: 0 })
    expect(trend.months.slice(-3)).toEqual([{ period: '2026-01', published: 4 }, { period: '2026-02', published: 5 }, { period: '2026-03', published: 13 }])
    const series = trend.series.find((s) => s.platform === 'twitter')!
    expect(series.points).toHaveLength(12)
    expect(series.points.slice(-3).map((pt) => [pt.period, pt.typical.state])).toEqual([['2026-01', 'thin'], ['2026-02', 'number'], ['2026-03', 'number']])
    // A gap is a thin point, never a zero: January's four posts carry no median.
    expect(JSON.stringify(series.points.slice(-3)[0])).not.toContain('2.3%')

    expect(ok(p.patterns)).toEqual([{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }])
    expect(ok(p.retrospectives).map((r) => [r.campaignId, r.verdict.key])).toEqual([
      [A_CAMPAIGN_ACTIVE_ID, 'outcome.retrospective.inconclusive'],
      [A_CAMPAIGN_COMPLETED_ID, 'outcome.retrospective.verdict_supported'],
    ])
    const accounts = ok(p.accounts).filter((a) => a.platform === 'twitter')
    expect(accounts.map((a) => [a.accountId, a.n])).toEqual([[A_X_ACCOUNT_ID, 6], [null, 1]])
    expect(accounts[0].typical).toMatchObject({ state: 'number', params: { n: 6, rate: '2.8%' } })
    expect(accounts[1].typical.state).toBe('thin')
    expect(accounts[1].labelKey).toBe('analytics.account.unrecorded')
  })

  it('the campaign table reuses RetrospectiveCard\'s i18n KEYS (asserted as strings) and links each row to /campaigns/[id]', async () => {
    const t = ok((await portfolio(BUSINESS_A_ID)).campaigns)
    expect(t.map((r) => [r.campaignId, r.published, r.href])).toEqual([
      [A_CAMPAIGN_ACTIVE_ID, 10, `/campaigns/${A_CAMPAIGN_ACTIVE_ID}`],
      [A_CAMPAIGN_COMPLETED_ID, 2, `/campaigns/${A_CAMPAIGN_COMPLETED_ID}`],
      [A_CAMPAIGN_MANUAL_ID, 1, `/campaigns/${A_CAMPAIGN_MANUAL_ID}`],
    ])
    const completed = t.find((r) => r.campaignId === A_CAMPAIGN_COMPLETED_ID)!
    expect(completed.retro).toEqual({
      verdict: { key: 'outcome.retrospective.verdict_supported', params: { n: 12 } },
      beat: { key: 'outcome.retrospective.posts_beat', params: { wins: 8, n: 12 } },
    })
    const active = t.find((r) => r.campaignId === A_CAMPAIGN_ACTIVE_ID)!
    expect(active.retro).toEqual({ verdict: { key: 'outcome.retrospective.inconclusive', params: { n: 3 } }, beat: null })
    expect(t.find((r) => r.campaignId === A_CAMPAIGN_MANUAL_ID)!.retro).toBeNull()
  })
})

describe('loadPortfolio, a basic business: the Pro readers are NEVER CALLED (ANALYTICS-PLAN-GATE-SERVER)', () => {
  it('Plus (business B, March in Sao Paulo): the basic tier, with exactly the basic keys and no Pro key', async () => {
    const p = await portfolio(BUSINESS_B_ID)
    expect(p.tier).toBe('basic')
    expect(Object.keys(p).sort()).toEqual(['activity', 'campaigns', 'period', 'platforms', 'previousPeriod', 'tier'])
    for (const proKey of ['trend', 'patterns', 'retrospectives', 'accounts']) expect(p).not.toHaveProperty(proKey)
    const platforms = ok(p.platforms)
    for (const s of platforms) if (s.state === 'measured') expect(s.current).not.toHaveProperty('breakdowns')
    for (const reader of proReaders()) expect(reader).not.toHaveBeenCalled()
    // Exactly one retrospective read (the month), not the 12-month one.
    expect(mocks.listCompletedRetrospectivesInRange).toHaveBeenCalledTimes(1)
  })

  it('B\'s numbers: 3 published, X 2 measured (thin: below 5), LinkedIn unavailable with its 1 post', async () => {
    const p = await portfolio(BUSINESS_B_ID)
    expect(ok(p.activity).total).toBe(3)
    expect(ok(p.activity).previousTotal).toBe(0)
    const platforms = ok(p.platforms)
    const x = platforms.find((s) => s.platform === 'twitter')
    if (!x || x.state !== 'measured') throw new Error('X should be measured')
    expect(x.current.typical).toEqual({ state: 'thin', key: 'analytics.state.thin', params: { n: 2 } })
    expect(platforms.find((s) => s.platform === 'linkedin')).toEqual({ platform: 'linkedin', state: 'unavailable', published: 1 })
  })

  it.each([['enterprise'], [null], [undefined], [42], ['']])('an UNKNOWN plan (%j) is basic and no Pro reader runs', async (plan) => {
    planOverride = { [BUSINESS_A_ID]: plan }
    const p = await portfolio(BUSINESS_A_ID)
    expect(p.tier).toBe('basic')
    for (const reader of proReaders()) expect(reader).not.toHaveBeenCalled()
  })

  it.each([['trial'], ['plus']])('%s is basic; pro and agency are advanced', async (plan) => {
    planOverride = { [BUSINESS_A_ID]: plan }
    expect((await portfolio(BUSINESS_A_ID)).tier).toBe('basic')
    for (const adv of ['pro', 'agency']) {
      planOverride = { [BUSINESS_A_ID]: adv }
      expect((await portfolio(BUSINESS_A_ID)).tier).toBe('advanced')
    }
  })

  it('the type is a discriminated union on tier: a Pro key on a basic model does not compile', async () => {
    const basic = (await portfolio(BUSINESS_B_ID)) as BasicPortfolio
    // @ts-expect-error a basic portfolio has no trend
    const bad: BasicPortfolio = { ...basic, trend: { status: 'ok', data: { months: [], series: [] } } }
    expect(bad.tier).toBe('basic')
  })

  it('the plan is read from the business row (by id), never taken from the caller', async () => {
    await portfolio(BUSINESS_B_ID)
    expect(mocks.getBusinessById).toHaveBeenCalledWith(client, BUSINESS_B_ID)
  })
})

describe('the capability decides the state, by injection (ANALYTICS-UNAVAILABLE-FROM-CAPABILITY, loader arm)', () => {
  it('flipped TRUE for every platform: LinkedIn is read, as a COUNT basis with no typical rate', async () => {
    const p = await portfolio(BUSINESS_A_ID, '2026-03', { metricsReadAvailable: () => true })
    const li = ok(p.platforms).find((s) => s.platform === 'linkedin')
    if (!li || li.state !== 'measured') throw new Error('LinkedIn should be measured when the capability says so')
    expect(li.current.basis).toBe('count')
    expect(li.current.typical).toBeNull()
    expect(mocks.listMonthOutcomes.mock.calls.map((c) => c[2].platform).sort()).toEqual(['linkedin', 'twitter'])
  })

  it('flipped FALSE for X: X is unavailable and its outcomes are never read', async () => {
    const p = await portfolio(BUSINESS_A_ID, '2026-03', { metricsReadAvailable: () => false })
    expect(ok(p.platforms).map((s) => s.state)).toEqual(['unavailable', 'unavailable'])
    expect(mocks.listMonthOutcomes).not.toHaveBeenCalled()
    expect(mocks.listMetricsForPosts).not.toHaveBeenCalled()
  })

  it('it is asked about the platform it holds, never given a name to compare', async () => {
    const spy = vi.fn(() => true)
    await portfolio(BUSINESS_A_ID, '2026-03', { metricsReadAvailable: spy })
    expect(spy.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(['linkedin', 'twitter'])
  })
})

describe('states: empty, immature and a month with no posts', () => {
  it('a month with nothing published has no platform sections and a zero total', async () => {
    const p = await portfolio(BUSINESS_A_ID, '2025-11')
    expect(ok(p.activity).total).toBe(0)
    expect(ok(p.platforms)).toEqual([])
  })

  it('April for A: X is MEASURED with one measured post and two not final; the day-2 posts are counted, not hidden', async () => {
    const x = ok((await portfolio(BUSINESS_A_ID, '2026-04')).platforms).find((s) => s.platform === 'twitter')
    if (!x) throw new Error('X section missing')
    expect(x.state).toBe('measured')
    if (x.state === 'measured') expect(x.current.exclusions.reasons).toEqual([{ key: 'analytics.exclusions.notFinal', count: 2 }])
  })

  it('a platform whose every post is not final yet is IMMATURE', async () => {
    const base = mocks.listPublishedPostsInRange.getMockImplementation()!
    const only = [postIdFor('a_immature_1'), postIdFor('a_immature_2')]
    mocks.listPublishedPostsInRange.mockImplementation(async (...args: unknown[]) => ((await base(...args)) as Array<{ id: string }>).filter((p) => only.includes(p.id)))
    const x = ok((await portfolio(BUSINESS_A_ID, '2026-04')).platforms).find((s) => s.platform === 'twitter')
    expect(x?.state).toBe('immature')
  })
})

describe('tenancy: every reader is handed the caller\'s client and the caller\'s business', () => {
  it('no reader sees another business or a different client, across the whole Pro load', async () => {
    await portfolio(BUSINESS_A_ID)
    for (const [name, fn] of Object.entries(mocks)) {
      if (name === 'retrievePatterns') {
        for (const c of fn.mock.calls) expect(c[0], name).toBe(BUSINESS_A_ID)
        continue
      }
      expect(fn.mock.calls.length, name).toBeGreaterThan(0)
      for (const c of fn.mock.calls) {
        expect(c[0], `${name} client`).toBe(client)
        if (name !== 'getBusinessById') expect(c[1], `${name} business`).toBe(BUSINESS_A_ID)
      }
    }
  })

  it('B\'s portfolio never contains one of A\'s ids', async () => {
    const text = JSON.stringify(await portfolio(BUSINESS_B_ID))
    for (const id of [BUSINESS_A_ID, A_X_ACCOUNT_ID, A_CAMPAIGN_ACTIVE_ID, A_CAMPAIGN_COMPLETED_ID]) expect(text).not.toContain(id)
  })
})

describe('a ReadCeilingExceeded becomes that section\'s error state; any other failure is NOT swallowed (ANALYTICS-NO-SILENT-TRUNCATION)', () => {
  it('the posts read over the ceiling errors the activity, the platforms and the campaigns, and nothing is computed', async () => {
    mocks.listPublishedPostsInRange.mockRejectedValue(new ReadCeilingExceeded('published posts in the month', 5000))
    const p = await portfolio(BUSINESS_A_ID)
    expect(p.activity).toEqual({ status: 'error', reason: 'ceiling' })
    expect(p.platforms).toEqual({ status: 'error', reason: 'ceiling' })
    expect(p.campaigns).toEqual({ status: 'error', reason: 'ceiling' })
  })

  it('an outcomes read over the ceiling errors THAT platform only', async () => {
    mocks.listMonthOutcomes.mockRejectedValue(new ReadCeilingExceeded('month outcomes', 5000))
    const platforms = ok((await portfolio(BUSINESS_A_ID)).platforms)
    expect(platforms.find((s) => s.platform === 'twitter')).toEqual({ platform: 'twitter', state: 'error', reason: 'ceiling' })
    expect(platforms.find((s) => s.platform === 'linkedin')?.state).toBe('unavailable')
  })

  it('a trend read over the ceiling errors the trend and leaves the rest', async () => {
    mocks.listTrendOutcomes.mockRejectedValue(new ReadCeilingExceeded('trend outcomes', 5000))
    const p = (await portfolio(BUSINESS_A_ID)) as AdvancedPortfolio
    expect(p.trend).toEqual({ status: 'error', reason: 'ceiling' })
    expect(p.activity.status).toBe('ok')
  })

  it('an ordinary error propagates (the route shows its error boundary)', async () => {
    mocks.listPublishedPostsInRange.mockRejectedValue(new Error('connection reset'))
    await expect(portfolio(BUSINESS_A_ID)).rejects.toThrow('connection reset')
  })

  it('an invalid month throws before any read', async () => {
    await expect(portfolio(BUSINESS_A_ID, '2026-3')).rejects.toThrow(/period/)
    expect(mocks.listPublishedPostsInRange).not.toHaveBeenCalled()
  })
})

describe('loadPosts: the post level, available to every plan (ADR 0031 §2.1, §3.2)', () => {
  const load = (businessId: string, filters: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    loadPosts(client, businessId, { period: '2026-03', ...filters }, deps(over))
  const row = (rows: PostRowView[], key: string) => rows.find((r) => r.postId === postIdFor(key))!

  it('13 published posts for A in March, newest first; draft, failed and deleted posts are absent', async () => {
    const out = ok((await load(BUSINESS_A_ID)).posts)
    expect(out).toHaveLength(13)
    const times = out.map((r) => r.publishedAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('the state of each X post: final with a badge, or not measured with its reason', async () => {
    const out = ok((await load(BUSINESS_A_ID)).posts)
    expect(row(out, 'a_x04')).toMatchObject({ state: 'final', final: { basis: 'rate', rate: '3.1%', badge: 'above' } })
    expect(row(out, 'a_x01')).toMatchObject({ state: 'final', final: { rate: '0.0%', badge: 'below' } })
    expect(row(out, 'a_x07')).toMatchObject({ state: 'final', final: { rate: '6.4%', badge: 'no_baseline' } })
    expect(row(out, 'a_x08_null_field')).toMatchObject({ state: 'not_measured', reason: 'field_missing' })
    expect(row(out, 'a_x09_zero_impressions')).toMatchObject({ state: 'not_measured', reason: 'zero_impressions' })
    expect(row(out, 'a_x10_no_metrics_row')).toMatchObject({ state: 'not_measured', reason: 'no_data_returned' })
  })

  it('LinkedIn posts are UNAVAILABLE by capability: no number, no zero, no outcome read for them', async () => {
    const out = ok((await load(BUSINESS_A_ID)).posts)
    const li = row(out, 'a_l01')
    expect(li.state).toBe('unavailable')
    expect(li).not.toHaveProperty('final')
    expect(li).not.toHaveProperty('soFar')
    expect(mocks.listMonthOutcomes.mock.calls.map((c) => c[2].platform)).toEqual(['twitter'])
  })

  it('with the capability flipped on, a LinkedIn post shows its COUNT, never a rate', async () => {
    const out = ok((await load(BUSINESS_A_ID, {}, { metricsReadAvailable: () => true })).posts)
    expect(row(out, 'a_l01')).toMatchObject({ state: 'final', final: { basis: 'count', value: 14, rate: null, badge: 'no_baseline' } })
  })

  it('a post under 9 days old shows "so far" counts and the day it becomes final; with no metrics row it is "measuring"', async () => {
    const out = ok((await load(BUSINESS_A_ID, { period: '2026-04' })).posts)
    expect(row(out, 'a_immature_1')).toMatchObject({
      state: 'so_far',
      soFar: { likes: 3, comments: 1, shares: 0, impressions: 120 },
      finalOn: '2026-04-17T09:00:00.000Z',
    })
    mocks.listMetricsForPosts.mockResolvedValue([])
    const bare = ok((await load(BUSINESS_A_ID, { period: '2026-04' })).posts)
    expect(row(bare, 'a_immature_1').state).toBe('measuring')
  })

  it('filters: platform, account (the NULL bucket is "none"), campaign', async () => {
    expect(ok((await load(BUSINESS_A_ID, { platform: 'twitter' })).posts)).toHaveLength(10)
    expect(ok((await load(BUSINESS_A_ID, { accountId: A_X_ACCOUNT_ID })).posts)).toHaveLength(9)
    const none = ok((await load(BUSINESS_A_ID, { accountId: 'none' })).posts)
    expect(none.map((r) => r.postId)).toEqual([postIdFor('a_x06')])
    expect(none[0]).toMatchObject({ accountId: null, accountLabelKey: 'analytics.account.unrecorded', accountLabel: null })
    expect(ok((await load(BUSINESS_A_ID, { campaignId: A_CAMPAIGN_COMPLETED_ID })).posts)).toHaveLength(2)
    expect(ok((await load(BUSINESS_A_ID, { campaignId: A_CAMPAIGN_COMPLETED_ID, platform: 'twitter' })).posts)).toHaveLength(1)
  })

  it('rows carry the campaign name and the account label', async () => {
    const out = ok((await load(BUSINESS_A_ID)).posts)
    expect(row(out, 'a_x05')).toMatchObject({ campaignName: 'A completed', accountLabel: 'Fixture A on X', accountLabelKey: null })
  })

  it('post level is basic content on every plan: Pro readers never run, and the tier follows the plan', async () => {
    const plus = await load(BUSINESS_B_ID)
    expect(plus.tier).toBe('basic')
    expect(await load(BUSINESS_A_ID)).toMatchObject({ tier: 'advanced' })
    for (const reader of [mocks.listTrendOutcomes, mocks.listDimensionsForAnalytics, mocks.countPublishedPostsInRange, mocks.retrievePatterns]) expect(reader).not.toHaveBeenCalled()
  })

  it('every reader gets the caller\'s client and business', async () => {
    await load(BUSINESS_A_ID)
    for (const [name, fn] of Object.entries(mocks)) {
      for (const c of fn.mock.calls) {
        expect(c[0], `${name} client`).toBe(client)
        if (name !== 'getBusinessById') expect(c[1], `${name} business`).toBe(BUSINESS_A_ID)
      }
    }
  })

  it('the posts read over the ceiling is the section\'s error state', async () => {
    mocks.listPublishedPostsInRange.mockRejectedValue(new ReadCeilingExceeded('published posts in the month', 5000))
    expect((await load(BUSINESS_A_ID)).posts).toEqual({ status: 'error', reason: 'ceiling' })
  })
})
