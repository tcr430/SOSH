import { describe, it, expect, vi } from 'vitest'
import { ReadCeilingExceeded } from '@/lib/db/keyset-pager'
import type { Readers } from '@/lib/analytics/load'
import { BUSINESS_A_ID, BUSINESS_B_ID, MARCH_REPORT_OUTCOMES_THROUGH, EXPECTED, postIdFor } from '@/lib/analytics/__fixtures__/portfolio'
import { REPORT_METHODOLOGY_KEYS } from '../constants'
import { assembleReport, rankTopPosts } from '../assemble'
import { TenantMismatchError } from '../isolation'
import { fixtureReaders, fixturePatternRow } from '../__fixtures__/readers'

// ADR 0031 §5.3, §5.6, §9.3 — one business's report for one month, as data. The readers are fakes driven by the O2.1
// fixture; the numbers below are the fixture's hand-computed literals.
const NOW = MARCH_REPORT_OUTCOMES_THROUGH // 2026-04-10T06:00:00Z
// What the reader returns: the row with its identity (business_id, pattern_key) and the English sentence memory stores.
const patternRows = [fixturePatternRow()]
// What the payload STORES (Session 37-D D2): the parsed cell and its evidence, no sentence.
const patterns = [{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }]
const run = (businessId: string, over: { readers?: Readers; plan?: Record<string, unknown>; period?: string; loaderDeps?: Record<string, unknown> } = {}) =>
  assembleReport({
    readers: over.readers ?? fixtureReaders({ plan: over.plan, patterns: patternRows }),
    businessId,
    period: over.period ?? '2026-03',
    now: NOW,
    loaderDeps: over.loaderDeps,
  })

describe('the Pro report: business A, March 2026', () => {
  it('is the advanced tier, for 2026-03-01, measured as of the instant it was given', async () => {
    const r = await run(BUSINESS_A_ID)
    expect(r).toMatchObject({ periodMonth: '2026-03-01', tier: 'advanced', stub: false, outcomesThrough: NOW, generatedAt: NOW })
    expect(r.payload).toMatchObject({ schemaVersion: 2, period: '2026-03', timezone: 'Europe/Lisbon', tier: 'advanced', outcomesThrough: NOW })
    expect(r.payload.header).toEqual({ key: 'analytics.report.header', params: { month: '2026-03', measuredAsOf: NOW, generatedOn: NOW } })
  })

  it('section 3, activity: 13 published, 5 the month before, posts from 3 campaigns and 1 retrospective completed in the month', async () => {
    const a = (await run(BUSINESS_A_ID)).payload.activity!
    expect(a.total).toBe(13)
    expect(a.previousTotal).toBe(5)
    expect(a.campaigns).toEqual({ withPosts: 3, retrospectivesCompleted: 1 })
  })

  it('section 4, X results: 3.1% over 7, wins 4 of 6, 7 of 10 measured', async () => {
    const x = (await run(BUSINESS_A_ID)).payload.xResults!
    expect(x).toHaveLength(1)
    expect(x[0]).toMatchObject({ platform: 'twitter', state: 'measured' })
    expect(x[0].current.typical).toEqual({ state: 'number', key: 'analytics.typical', params: { n: 7, rate: '3.1%', lo: '0.0%', hi: '6.4%', rangeKind: 'minmax' } })
    expect(x[0].current.wins).toMatchObject({ params: { wins: 4, n: 6 } })
    expect(x[0].current.exclusions.params).toEqual({ measured: 7, published: 10, notIncluded: 3 })
    expect(x[0].current).not.toHaveProperty('breakdowns')
  })

  it('section 5, three X posts by engagement rate: the highest day-7 rates, with the caveat key and never "top" or "best"', async () => {
    const t = (await run(BUSINESS_A_ID)).payload.ratedPosts!
    expect(t.state).toBe('shown')
    expect(t.titleKey).toBe('analytics.report.ratedPosts.title')
    expect(t.caveatKey).toBe('analytics.report.ratedPosts.caveat')
    expect(t.byPlatform).toHaveLength(1)
    expect(t.byPlatform[0].posts).toEqual(EXPECTED.march.x.topThreePostKeys.map((key, i) => ({ postId: postIdFor(key), rate: ['6.4%', '4.7%', '4.0%'][i], badge: ['no_baseline', 'above', 'above'][i] })))
    expect(t.titleKey + t.caveatKey).not.toMatch(/top|best/i)
  })

  it('section 5 reads nothing from post_metrics: each cited post carries exactly a post id, a rate token and a badge', async () => {
    const t = (await run(BUSINESS_A_ID)).payload.ratedPosts!
    for (const p of t.byPlatform[0].posts) expect(Object.keys(p).sort()).toEqual(['badge', 'postId', 'rate'])
  })

  it('section 6, LinkedIn: the unavailable state with its publishing count (from the capability)', async () => {
    expect((await run(BUSINESS_A_ID)).payload.unavailable).toEqual([{ platform: 'linkedin', published: 3 }])
  })

  it('section 7, campaign results: the retrospective completed in the month, with its verdict keys and a link', async () => {
    const c = (await run(BUSINESS_A_ID)).payload.campaigns!
    const done = c.find((r) => r.retro)!
    expect(done.retro!.verdict.key).toBe('outcome.retrospective.verdict_supported')
    expect(done.href).toBe('/campaigns/' + done.campaignId)
  })

  it('sections 8 to 10 (Pro): a 6-month trend, the breakdowns WITHOUT hook_type, and the patterns', async () => {
    const p = (await run(BUSINESS_A_ID)).payload
    expect(p.trend!.months.map((m) => m.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'])
    expect(p.trend!.months.slice(-3).map((m) => m.published)).toEqual([4, 5, 13])
    const dims = p.observed![0].breakdowns.map((b) => b.dimension)
    expect(dims).toEqual(['role', 'format', 'origin_mode', 'length_band', 'cta_present'])
    expect(dims).not.toContain('hook_type')
    expect(p.patterns).toEqual(patterns)
  })

  it('section 11, how to read this: every methodology key is present', async () => {
    const p = (await run(BUSINESS_A_ID)).payload
    expect(p.methodology.keys).toEqual([...REPORT_METHODOLOGY_KEYS])
    expect(p.methodology.keys).toHaveLength(8)
    for (const key of p.methodology.keys) expect(key).toMatch(/^analytics\.report\.methodology\./)
  })

  it('"Posts measured after {date} are not included" carries the instant', async () => {
    expect((await run(BUSINESS_A_ID)).payload.lateOutcomes).toEqual({ key: 'analytics.report.lateOutcomes', params: { date: NOW } })
  })

  it('the summary is closed template sentences: the activity line, then the typical rate and the wins', async () => {
    const s = (await run(BUSINESS_A_ID)).payload.summary
    expect(s.map((l) => l.key)).toEqual(['analytics.activity.total', 'analytics.typical', 'analytics.wins'])
  })

  it('NO post text anywhere in the payload', async () => {
    expect(JSON.stringify((await run(BUSINESS_A_ID)).payload)).not.toContain('Fixture post')
  })
})

describe('the tier is read from the PLAN on the business row (ANALYTICS-PLAN-GATE-SERVER, the generator arm)', () => {
  it('Plus (business B): basic, and a basic payload has NO Pro key at all', async () => {
    const r = await run(BUSINESS_B_ID)
    expect(r.tier).toBe('basic')
    for (const key of ['trend', 'observed', 'patterns']) expect(r.payload).not.toHaveProperty(key)
  })

  it('an UNKNOWN plan on a live business gets the basic report, never none', async () => {
    const r = await run(BUSINESS_A_ID, { plan: { [BUSINESS_A_ID]: 'enterprise' } })
    expect(r.tier).toBe('basic')
    expect(r.payload).not.toHaveProperty('trend')
    expect(r.payload.tier).toBe('basic')
  })

  it('trial is basic; agency is advanced', async () => {
    expect((await run(BUSINESS_A_ID, { plan: { [BUSINESS_A_ID]: 'trial' } })).tier).toBe('basic')
    expect((await run(BUSINESS_A_ID, { plan: { [BUSINESS_A_ID]: 'agency' } })).tier).toBe('advanced')
  })

  it('the patterns reader (a Pro read) is never called for a basic business', async () => {
    const spy = vi.fn<Readers['listPatterns']>(async () => patternRows)
    await run(BUSINESS_B_ID, { readers: { ...fixtureReaders({ patterns: patternRows }), listPatterns: spy } })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the capability decides section 6 (ANALYTICS-UNAVAILABLE-FROM-CAPABILITY, the assembler arm)', () => {
  it('flipped on by injection: LinkedIn leaves the unavailable list and appears among the results as a COUNT basis', async () => {
    const p = (await run(BUSINESS_A_ID, { loaderDeps: { metricsReadAvailable: () => true } })).payload
    expect(p.unavailable).toEqual([])
    const li = p.xResults!.find((x) => x.platform === 'linkedin')!
    expect(li.current.basis).toBe('count')
    expect(li.current.typical).toBeNull()
    // A count is never ranked into section 5.
    expect(p.ratedPosts!.byPlatform.map((b) => b.platform)).toEqual(['twitter'])
  })

  it('flipped off for everything: both platforms are unavailable and there is no section 5', async () => {
    const p = (await run(BUSINESS_A_ID, { loaderDeps: { metricsReadAvailable: () => false } })).payload
    expect(p.unavailable!.map((u) => u.platform)).toEqual(['linkedin', 'twitter'])
    expect(p.xResults).toEqual([])
    expect(p.ratedPosts!.state).toBe('absent')
  })
})

describe('section 5 floors and ranking', () => {
  it('absent when X has fewer than 5 measured posts (business B has 2), with its caveat key still named', async () => {
    const t = (await run(BUSINESS_B_ID)).payload.ratedPosts!
    expect(t.state).toBe('absent')
    expect(t.byPlatform).toEqual([])
  })

  it('rankTopPosts: by value DESC, ties by published_at DESC then post id; a count basis is never ranked', () => {
    const row = (post_id: string, value: number, published_at: string, metric_basis: 'rate' | 'count' = 'rate') =>
      ({ post_id, value, published_at, metric_basis, business_id: 'b', platform: 'twitter', ai_original_id: null, beat_baseline: null, baseline_source: null, length_band: null, cta_present: null, hook_survived: null, measured_at: 'x' })
    const ranked = rankTopPosts([
      row('p1', 0.05, '2026-03-01T09:00:00Z'),
      row('p2', 0.05, '2026-03-09T09:00:00Z'),
      row('p3', 0.05, '2026-03-09T09:00:00Z'),
      row('p4', 0.09, '2026-03-02T09:00:00Z'),
      row('p5', 99, '2026-03-02T09:00:00Z', 'count'),
      row('p6', 0.01, '2026-03-02T09:00:00Z'),
    ])
    expect(ranked.map((r) => r.post_id)).toEqual(['p4', 'p3', 'p2'])
  })
})

describe('the empty month: a stub, with the methodology and no email-worthy content (§5.6)', () => {
  it('a live business that published nothing in the month gets a STUB', async () => {
    const r = await run(BUSINESS_A_ID, { period: '2025-11' })
    expect(r.stub).toBe(true)
    expect(r.periodMonth).toBe('2025-11-01')
    expect(r.payload.stub).toBe(true)
    expect(r.payload.summary).toEqual([{ key: 'analytics.report.stub', params: { month: '2025-11' } }])
    for (const key of ['activity', 'xResults', 'ratedPosts', 'trend']) expect(r.payload).not.toHaveProperty(key)
  })

  it('the stub carries every methodology key too (REPORT-METHODOLOGY-PRESENT)', async () => {
    expect((await run(BUSINESS_A_ID, { period: '2025-11' })).payload.methodology.keys).toEqual([...REPORT_METHODOLOGY_KEYS])
  })

  it('a month with LinkedIn posts only is NOT empty (it is activity plus the unavailable state)', async () => {
    const real = fixtureReaders()
    const readers: Readers = { ...real, listPublishedPostsInRange: async (id, r) => (await real.listPublishedPostsInRange(id, r)).filter((p) => p.platform === 'linkedin') }
    const r = await run(BUSINESS_A_ID, { readers })
    expect(r.stub).toBe(false)
    expect(r.payload.unavailable).toEqual([{ platform: 'linkedin', published: 3 }])
  })
})

describe('isolation and bounds (REPORT-RLS-ISOLATED)', () => {
  it('a planted B row in a worker read THROWS and nothing is returned for A', async () => {
    const real = fixtureReaders()
    const readers: Readers = {
      ...real,
      listPublishedPostsInRange: async (id, r) => {
        const rows = await real.listPublishedPostsInRange(id, r)
        return [...rows, { ...rows[0], id: 'planted', business_id: BUSINESS_B_ID }]
      },
    }
    await expect(run(BUSINESS_A_ID, { readers })).rejects.toBeInstanceOf(TenantMismatchError)
  })

  it('every outcomes read behind the report is bounded by the ONE instant', async () => {
    const real = fixtureReaders()
    const month = vi.fn(real.listMonthOutcomes)
    const trend = vi.fn(real.listTrendOutcomes)
    await run(BUSINESS_A_ID, { readers: { ...real, listMonthOutcomes: month, listTrendOutcomes: trend } })
    expect(month.mock.calls.length + trend.mock.calls.length).toBeGreaterThanOrEqual(3)
    for (const c of [...month.mock.calls, ...trend.mock.calls]) expect(c[1].outcomesThrough).toBe(NOW)
  })

  it('every id the payload cites belongs to business A: B\'s posts, campaigns and accounts never appear', async () => {
    const text = JSON.stringify((await run(BUSINESS_A_ID)).payload)
    expect(text).not.toContain(BUSINESS_B_ID)
    for (const bKey of ['b_boundary_sao_paulo', 'b_x02', 'b_l01']) expect(text).not.toContain(postIdFor(bKey))
  })

  it('a read over its ceiling FAILS the report instead of storing a number over part of the data', async () => {
    const real = fixtureReaders()
    const ceiling = new ReadCeilingExceeded('month outcomes', 5000)
    await expect(run(BUSINESS_A_ID, { readers: { ...real, listMonthOutcomes: async () => { throw ceiling } } })).rejects.toThrow(/ceiling/)
    await expect(run(BUSINESS_A_ID, { readers: { ...real, listPublishedPostsInRange: async () => { throw ceiling } } })).rejects.toThrow(/ceiling/)
    await expect(run(BUSINESS_A_ID, { readers: { ...real, listTrendOutcomes: async () => { throw ceiling } } })).rejects.toThrow(/ceiling/)
  })
})
