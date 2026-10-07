// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import enAnalytics from '@/i18n/en/analytics.json'

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import { makeTranslator, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { fixtureRecords } from '@/lib/analytics/__fixtures__/adapters'
import { BUSINESS_A_ID, FIXTURE_NOW, postIdFor } from '@/lib/analytics/__fixtures__/portfolio'
import { monthOptions } from '@/lib/analytics/search-params'
import { typicalOf } from '@/lib/analytics/rates'
import { breakdownView, monthPairView, platformMonthView, typicalView, type PlatformMonthView } from '@/lib/analytics/view-model'
import type { AdvancedPlatformSection, AdvancedPortfolio, BasicPlatformSection, BasicPortfolio, PostRowView, PostsView as PostsModel, TrendView } from '@/lib/analytics/load'
import { PortfolioView } from './PortfolioView'
import { PostsTable } from './PostsView'
import type { T } from './shared'
import AnalyticsLoading from '@/app/[locale]/(dashboard)/analytics/loading'
import AnalyticsError from '@/app/[locale]/(dashboard)/analytics/error'

// ADR 0031 §8.2, §10 — the surfaces, rendered. A real translator over the message files asserts the strings a customer
// reads; a key-echo translator asserts WHICH key each state renders. Tier 2, executed in CI. The real-browser half
// (1280/640/320 px, scrollWidth) is manual QA and is never counted as COVERED here.

const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}
const echo: T = (key) => key
const LISBON = 'Europe/Lisbon'

// ─── builders: the REAL pure functions over the O2.1 fixture, never hand-written numbers ───────────────────────────
const records = fixtureRecords(BUSINESS_A_ID)
const view = (platform: string, period: string, live = true): PlatformMonthView =>
  platformMonthView({ platform, period, timezone: LISBON, now: FIXTURE_NOW, records, includeLiveOnly: live })

const MARCH = [0, 0.018, 0.025, 0.031, 0.04, 0.047, 0.064]
const FEB = [0.022, 0.028, 0.03, 0.036, 0.044]
const pair = () => monthPairView({ period: '2026-02', values: FEB }, { period: '2026-03', values: MARCH })

const measured = (current: PlatformMonthView, platform = 'twitter'): AdvancedPlatformSection => ({ platform, state: 'measured', current, pair: pair(), finalOn: null })
const toBasic = (s: AdvancedPlatformSection): BasicPlatformSection => {
  if (s.state === 'unavailable' || s.state === 'error') return s
  const { breakdowns, ...current } = s.current
  void breakdowns
  return { platform: s.platform, state: s.state, current, pair: s.pair, finalOn: s.finalOn }
}

const activity = {
  status: 'ok' as const,
  data: {
    total: 13,
    previousTotal: 5,
    rows: [
      { platform: 'twitter', accountId: 'a-x', label: 'Fixture A on X', labelKey: null, count: 9 },
      { platform: 'twitter', accountId: null, label: null, labelKey: 'analytics.account.unrecorded' as const, count: 1 },
    ],
    campaigns: { withPosts: 2, retrospectivesCompleted: 1 },
  },
}
const unavailableLi: AdvancedPlatformSection = { platform: 'linkedin', state: 'unavailable', published: 3 }
const campaigns = {
  status: 'ok' as const,
  data: [{ campaignId: 'c1', name: 'A completed', status: 'completed', published: 2, href: '/campaigns/c1', retro: { verdict: { key: 'outcome.retrospective.verdict_supported', params: { n: 12 } }, beat: { key: 'outcome.retrospective.posts_beat' as const, params: { wins: 8, n: 12 } }, interval: null } }],
}

const months = monthOptions('2026-03').reverse()
const trend: TrendView = {
  months: months.map((period) => ({ period, published: period === '2026-03' ? 13 : period === '2026-02' ? 5 : 0 })),
  series: [
    {
      platform: 'twitter',
      points: months.map((period) => {
        const values = period === '2026-03' ? MARCH : period === '2026-02' ? FEB : []
        const typical = typicalView(values)
        const t = typical.state === 'number' ? typicalOf(values) : null
        return { period, typical, dots: t ? values : [], stats: t ? { median: t.median, lo: t.range.lo, hi: t.range.hi } : null }
      }),
    },
  ],
}

const advanced = (over: Partial<AdvancedPortfolio> = {}): AdvancedPortfolio => ({
  tier: 'advanced',
  period: '2026-03',
  previousPeriod: '2026-02',
  activity,
  platforms: { status: 'ok', data: [unavailableLi, measured(view('twitter', '2026-03'))] },
  campaigns,
  trend: { status: 'ok', data: trend },
  patterns: { status: 'ok', data: [{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }] },
  retrospectives: { status: 'ok', data: [{ campaignId: 'c1', campaignName: 'A completed', completedAt: '2026-03-27T10:00:00+00:00', href: '/campaigns/c1', verdict: { key: 'outcome.retrospective.verdict_supported', params: { n: 12 } }, beat: { key: 'outcome.retrospective.posts_beat', params: { wins: 8, n: 12 } }, interval: null }] },
  accounts: { status: 'ok', data: [{ platform: 'twitter', accountId: 'a-x', label: 'Fixture A on X', labelKey: null, n: 6, typical: typicalView([0, 0.018, 0.025, 0.031, 0.04, 0.064]), wins: { state: 'thin', key: 'analytics.state.thinWins', params: { n: 4 } }, comparison: 'counts' }] },
  ...over,
})
const basic = (over: Partial<BasicPortfolio> = {}): BasicPortfolio => ({
  tier: 'basic',
  period: '2026-03',
  previousPeriod: '2026-02',
  activity,
  platforms: { status: 'ok', data: [toBasic(unavailableLi), toBasic(measured(view('twitter', '2026-03')))] },
  campaigns,
  ...over,
})

const render = (t: T, portfolio: AdvancedPortfolio | BasicPortfolio, locale = 'en') =>
  renderToStaticMarkup(<PortfolioView t={t} locale={locale} timezone={LISBON} portfolio={portfolio} />)
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

describe('the states: each renders its expected i18n key (ANALYTICS-FOUR-STATES)', () => {
  it('EMPTY: nothing published renders the empty copy and nothing else', () => {
    const p = basic({ activity: { status: 'ok', data: { ...activity.data, total: 0, rows: [] } } })
    expect(render(echo, p)).toContain('analytics.state.empty')
    expect(text(render(tFor('en'), p))).toContain('Nothing published yet. Results appear here after Jemip publishes your first post.')
    expect(render(echo, p)).not.toContain('analytics.section.activity')
  })

  it('IMMATURE: "Measuring..." with the count of posts and the date they become final', () => {
    const april = toBasic(measured(view('twitter', '2026-04')))
    if (april.state !== 'measured') throw new Error('expected a measured April section')
    const section: BasicPlatformSection = { platform: 'twitter', state: 'immature', current: april.current, pair: null, finalOn: '2026-04-17T09:00:00.000Z' }
    const p = basic({ platforms: { status: 'ok', data: [section] } })
    expect(render(echo, p)).toContain('analytics.state.immature')
    expect(text(render(tFor('en'), p))).toMatch(/Measuring\. Engagement is final 7 days after a post goes out\. Final for 3 posts on Apr 17, 2026\./)
  })

  it('UNAVAILABLE: the platform sentence, from the capability (the platform name is a label, not a decision)', () => {
    const html = render(tFor('en'), basic())
    expect(text(html)).toContain("LinkedIn doesn't share engagement data with Jemip, so we show your publishing activity there instead.")
    expect(render(echo, basic())).toContain('analytics.state.unavailable')
  })

  it('THIN: below 5 measured posts renders the thin copy with its n and no rate', () => {
    const april = toBasic(measured(view('twitter', '2026-04')))
    const html = render(tFor('en'), basic({ platforms: { status: 'ok', data: [april] } }))
    expect(text(html)).toContain('1 measured post so far. A typical rate appears from 5.')
    expect(render(echo, basic({ platforms: { status: 'ok', data: [april] } }))).toContain('analytics.state.thin')
  })

  it('ERROR: a section that hit the ceiling renders the error copy as an alert, with no number', () => {
    const p = basic({ activity: { status: 'error', reason: 'ceiling' }, platforms: { status: 'error', reason: 'ceiling' }, campaigns: { status: 'error', reason: 'ceiling' } })
    const html = render(tFor('en'), p)
    expect(html).toContain('role="alert"')
    expect(text(html)).toContain("We couldn't load your results.")
    expect(html).not.toMatch(/\d+%/)
  })

  it('GATED: a basic plan sees "Available on Pro: ..." five times with a plain billing link, and no chart, blur or number', () => {
    const html = render(tFor('en'), basic())
    const gated = text(html).match(/Available on Pro:/g) ?? []
    expect(gated).toHaveLength(5)
    expect(html).toContain('href="/en/billing"')
    expect(html).not.toMatch(/blur|<svg|dialog|aria-modal/)
    expect(render(echo, basic())).toContain('analytics.gated.prefix')
  })

  it('POPULATED: the typical rate with its n and range, wins of n, the month pair, exclusions, and the Pro sections', () => {
    const t = text(render(tFor('en'), advanced()))
    expect(t).toContain('7 posts measured. Typical engagement rate: 3.1% (range 0.0%–6.4%).')
    expect(t).toContain('4 of 6 posts beat your usual engagement.')
    expect(t).toContain('February 2026: 3.0% (5 posts) · March 2026: 3.1% (7 posts).')
    expect(t).toContain('7 of 10 posts measured.')
    expect(t).toContain('3 not included: no data returned (1), a field was missing (1), zero impressions (1).')
    expect(t).toContain('Usual = your median over the previous 90 days on X, or the history you imported.')
    expect(t).toContain("'Usual' updates as you post, so this is not a measure of overall progress.")
    expect(t).toContain('This measures engagement, not signups or revenue.')
    expect(t).not.toContain('Available on Pro:')
  })

  it('LOADING: an accessible status with the "Loading results" label', async () => {
    const html = renderToStaticMarkup(await AnalyticsLoading())
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('loading')
  })
})

describe('error.tsx: the one Client Component, the ERROR state with a Reload control that receives no data', () => {
  const mounted: Array<() => void> = []
  afterEach(() => {
    while (mounted.length) mounted.pop()?.()
  })

  it('renders the 8.2 error copy and a Reload button that calls reset(); the error message is never rendered', () => {
    const reset = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={{ analytics: enAnalytics } as never}>
          <AnalyticsError error={new Error('SECRET internal detail')} reset={reset} />
        </NextIntlClientProvider>,
      )
    })
    mounted.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    expect(container.textContent).toContain("We couldn't load your results.")
    expect(container.textContent).not.toContain('SECRET')
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('Reload')
    act(() => button.click())
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe('the LinkedIn disclosure (ANALYTICS-LINKEDIN-DISCLOSED): verbatim wherever a count is shown, dormant otherwise', () => {
  const SENTENCE = 'LinkedIn results compare engagement counts, which also rise as your audience grows.'
  const li = (): AdvancedPlatformSection => ({ platform: 'linkedin', state: 'measured', current: view('linkedin', '2026-03'), pair: null, finalOn: null })

  it('the fixture really is a COUNT basis', () => {
    expect(view('linkedin', '2026-03').basis).toBe('count')
  })

  it('portfolio, capability flipped on (a count fixture): the sentence appears VERBATIM', () => {
    expect(text(render(tFor('en'), advanced({ platforms: { status: 'ok', data: [li()] } })))).toContain(SENTENCE)
  })

  it('portfolio, default capability (LinkedIn unavailable): the sentence is NOT shown', () => {
    expect(text(render(tFor('en'), advanced()))).not.toContain(SENTENCE)
  })

  it('posts table: shown when a LinkedIn count row is shown, absent when none is', () => {
    const row = (over: Partial<PostRowView>): PostRowView => ({ postId: 'p', platform: 'linkedin', publishedAt: '2026-03-04T09:00:00Z', accountId: null, accountLabel: null, accountLabelKey: 'analytics.account.unrecorded', campaignId: 'c', campaignName: 'C', state: 'final', final: { basis: 'count', value: 14, rate: null, badge: 'no_baseline' }, ...over })
    const withCount: PostsModel = { tier: 'basic', period: '2026-03', posts: { status: 'ok', data: [row({})] } }
    const without: PostsModel = { tier: 'basic', period: '2026-03', posts: { status: 'ok', data: [row({ state: 'unavailable', final: undefined })] } }
    expect(text(renderToStaticMarkup(<PostsTable t={tFor('en')} locale="en" timezone={LISBON} model={withCount} />))).toContain(SENTENCE)
    expect(text(renderToStaticMarkup(<PostsTable t={tFor('en')} locale="en" timezone={LISBON} model={without} />))).not.toContain(SENTENCE)
  })

  it('pt and es carry the same obligation, in their own words', () => {
    expect(text(render(tFor('pt'), advanced({ platforms: { status: 'ok', data: [li()] } })))).toContain('Os resultados do LinkedIn comparam contagens de interação')
    expect(text(render(tFor('es'), advanced({ platforms: { status: 'ok', data: [li()] } })))).toContain('Los resultados de LinkedIn comparan recuentos de interacción')
  })
})

describe('breakdowns carry their population tag and coverage line (ANALYTICS-COVERAGE-DISCLOSED)', () => {
  const html = render(tFor('en'), advanced())

  it('every breakdown block has its tag and its "Covers k of n" line', () => {
    const blocks = html.split('data-dimension="').slice(1)
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    for (const block of blocks) {
      const t = text(block)
      expect(t, block.slice(0, 20)).toMatch(/AI-written posts only|All measured posts/)
      if (/AI-written posts only/.test(t)) {
        expect(t, block.slice(0, 20)).toMatch(/Covers \d+ of \d+ measured posts\. Posts written outside Jemip's generator aren't classified\./)
      } else {
        // MINOR-2: length and CTA cover ALL measured posts, so the "not classified" tail would be false for them.
        expect(t, block.slice(0, 20)).toMatch(/Covers \d+ of \d+ measured posts\./)
        expect(t, block.slice(0, 20)).not.toContain("aren't classified")
      }
    }
  })

  it('AI-written dimensions are tagged AI-only (5 of 7) and length/CTA are tagged all measured (7 of 7)', () => {
    const block = (d: string) => text(html.split('data-dimension="' + d + '"')[1].split('data-dimension="')[0])
    expect(block('role')).toContain('AI-written posts only')
    expect(block('role')).toContain('Covers 5 of 7 measured posts')
    expect(block('length_band')).toContain('All measured posts')
    expect(block('length_band')).toContain('Covers 7 of 7 measured posts')
  })

  it('below 10 per side the values are COUNTS with a Provisional label: no bar, no percentage', () => {
    const t = text(html.split('data-dimension="role"')[1].split('data-dimension="')[0])
    // The fixture's value has 1 post: below the display floor of 5 it is thin and prints no k of n (A-11(a), MINOR-6).
    expect(t).toContain('Founder perspective: Fewer than 5 posts')
    expect(t).not.toContain('0 of 1')
    expect(t).not.toContain('Provisional')
    expect(t).not.toMatch(/likely between/)
  })

  it('a value with 4 posts reads "Fewer than 5 posts" and one with 5 reads "k of 5" (literal), in the page', () => {
    const bd = breakdownView({
      dimension: 'role',
      population: 'ai_only',
      coverage: { k: 9, n: 9 },
      presentation: 'counts',
      values: [
        { value: 'anchor_thesis', wins: 1, of: 4, provisional: true, interval: null },
        { value: 'follow_up', wins: 3, of: 5, provisional: true, interval: null },
      ],
    })
    const current = { ...view('twitter', '2026-03'), breakdowns: [bd] }
    const t = text(render(tFor('en'), advanced({ platforms: { status: 'ok', data: [measured(current)] } })))
    expect(t).toContain('Anchor thesis: Fewer than 5 posts')
    expect(t).toContain('Posts with Follow-up: 3 of 5 beat your usual.')
    expect(t).not.toContain('1 of 4')
  })

  it('hook_type is ABSENT below 10 (and when no opening survived)', () => {
    expect(html).not.toContain('data-dimension="hook_type"')
    expect(view('twitter', '2026-03').breakdowns.find((b) => b.dimension === 'hook_type')?.rows).toEqual([])
  })

  it('hook_type appears with its caveat only when a value reaches 10', () => {
    const rows = Array.from({ length: 1 }, () => ({ value: 'question', key: 'analytics.breakdown.row' as const, params: { wins: 8, n: 12 }, provisional: false, interval: { key: 'analytics.interval' as const, params: { lo: '39%', hi: '86%' } }, share: 8 / 12, bar: { lo: 0.39, hi: 0.86 } }))
    const hook = { dimension: 'hook_type' as const, populationKey: 'analytics.population.aiOnly' as const, coverage: { key: 'analytics.coverage.generated' as const, params: { k: 12, n: 20 } }, presentation: 'counts' as const, rows, thinValues: [] as string[] }
    const current = { ...view('twitter', '2026-03'), breakdowns: [hook] }
    const t = text(render(tFor('en'), advanced({ platforms: { status: 'ok', data: [measured(current)] } })))
    expect(t).toContain('As classified by the AI when writing, not independently checked.')
  })
})

describe('the chart contract (ANALYTICS-A11Y-FLOOR): every chart has a table and an aria-describedby that resolves', () => {
  const bars = breakdownView({
    dimension: 'role',
    population: 'ai_only',
    coverage: { k: 22, n: 22 },
    presentation: 'bars',
    values: [
      { value: 'anchor_thesis', wins: 9, of: 12, provisional: false, interval: { lo: 0.4677, hi: 0.9111 } },
      { value: 'customer_proof', wins: 5, of: 10, provisional: false, interval: { lo: 0.2366, hi: 0.7634 } },
    ],
  })
  const withBars = advanced({ platforms: { status: 'ok', data: [measured({ ...view('twitter', '2026-03'), breakdowns: [bars] })] } })
  const html = render(tFor('en'), withBars)

  it('renders the three chart kinds as figures: posts per month, the trend strip, and win-share bars', () => {
    expect((html.match(/<figure/g) ?? []).length).toBe(3)
    expect((html.match(/<svg[^>]*role="img"/g) ?? []).length).toBe(3)
  })

  it('every figure holds a real <table> with a caption and header cells', () => {
    const figures = html.split('<figure').slice(1).map((f) => f.split('</figure>')[0])
    expect(figures).toHaveLength(3)
    for (const f of figures) {
      // The hidden table sits in a clipped div: a bare absolutely-positioned <table> ignores overflow:hidden and stretched
      // the page to scrollWidth 505 at 320 px (found in the browser QA).
      expect(f).toMatch(/<div class="sr-only"><table>/)
      expect(f).toMatch(/<caption>/)
      expect(f).toMatch(/<th scope="col"/)
    }
  })

  it('every svg\'s aria-describedby points at an element that exists, and it carries text', () => {
    const ids = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(3)
    for (const id of ids) {
      const m = html.match(new RegExp('id="' + id + '"[^>]*>([^<]+)<'))
      expect(m, id).not.toBeNull()
      expect(m![1].trim().length, id).toBeGreaterThan(10)
    }
  })

  it('the summaries are the closed templates, with the data filled in', () => {
    const t = text(html)
    // 13 (March) + 5 (February): the closed template filled with the bars' own total.
    expect(t).toContain('18 posts published between April 2025 and March 2026, shown by month.')
    expect(t).toContain('Typical engagement rate for X between April 2025 and March 2026; months with fewer than 5 measured posts are left blank.')
    expect(t).toContain('Share of posts that beat your usual, by Post role.')
  })

  it('no number exists only as a shape: each month\'s count is printed on its bar and again in the table', () => {
    expect(html).toMatch(/<text[^>]*>13<\/text>/)
    expect(text(html)).toContain('March 2026 13')
  })

  it('the bars appear ONLY at n >= 10 per side, and carry the plain-language range (never "95% confidence")', () => {
    const t = text(html)
    expect(t).toContain('likely between 47% and 91% of posts')
    expect(t).not.toMatch(/95%/)
  })

  it('a chart is not a focus trap: no focusable element inside any figure', () => {
    for (const f of html.split('<figure').slice(1)) expect(f.split('</figure>')[0]).not.toMatch(/<(a|button|input|select|textarea)\b|tabindex/i)
  })

  it('a gap is not drawn: a month under the floor has no dot and no whisker in the strip', () => {
    const strip = html.split('<figure')[2]
    expect((strip.match(/<circle/g) ?? []).length).toBe(MARCH.length + FEB.length)
  })
})

describe('no meaning rides on colour alone: the badge carries text AND an icon', () => {
  const row = (key: string, badge: 'above' | 'below' | 'no_baseline'): PostRowView => ({
    postId: postIdFor(key), platform: 'twitter', publishedAt: '2026-03-12T09:00:00Z', accountId: null, accountLabel: null, accountLabelKey: 'analytics.account.unrecorded', campaignId: 'c', campaignName: 'C',
    state: 'final', final: { basis: 'rate', value: 0.031, rate: '3.1%', badge },
  })
  const model: PostsModel = { tier: 'basic', period: '2026-03', posts: { status: 'ok', data: [row('a_x04', 'above'), row('a_x01', 'below'), row('a_x07', 'no_baseline')] } }
  const html = renderToStaticMarkup(<PostsTable t={tFor('en')} locale="en" timezone={LISBON} model={model} />)

  it('each badge has its words and an aria-hidden svg icon', () => {
    for (const words of ['Above your usual', 'Below your usual', 'No baseline yet']) {
      const m = html.match(new RegExp('<span[^>]*>(<svg[^>]*aria-hidden="true"[^>]*>.*?</svg>)' + words))
      expect(m, words).not.toBeNull()
    }
  })
})

describe('the post-level states', () => {
  const base = { platform: 'twitter', publishedAt: '2026-04-10T09:00:00Z', accountId: null, accountLabel: null, accountLabelKey: 'analytics.account.unrecorded' as const, campaignId: 'c', campaignName: 'C' }
  const rows: PostRowView[] = [
    { ...base, postId: '1', state: 'measuring', finalOn: '2026-04-17T09:00:00.000Z' },
    { ...base, postId: '2', state: 'so_far', soFar: { likes: 3, comments: 1, shares: 0, impressions: null, asOf: '2026-04-11T04:00:00Z' }, finalOn: '2026-04-17T09:00:00.000Z' },
    { ...base, postId: '3', state: 'not_measured', reason: 'field_missing' },
    { ...base, postId: '4', platform: 'linkedin', state: 'unavailable' },
  ]
  const model: PostsModel = { tier: 'basic', period: '2026-04', posts: { status: 'ok', data: rows } }

  it('renders measuring, "so far" (a missing field is "not available", never 0), not measured with its reason, and unavailable', () => {
    const t = text(renderToStaticMarkup(<PostsTable t={tFor('en')} locale="en" timezone={LISBON} model={model} />))
    expect(t).toContain('Measuring')
    expect(t).toContain('So far, as of Apr 11, 2026: 3 likes, 1 comments, 0 shares, not available impressions. Final on Apr 17, 2026.')
    expect(t).toContain('Not measured: a field was missing')
    expect(t).toContain("LinkedIn doesn't share engagement data with Jemip")
  })

  it('the key-echo render names every state key', () => {
    const html = renderToStaticMarkup(<PostsTable t={echo} locale="en" timezone={LISBON} model={model} />)
    for (const key of ['analytics.posts.state.measuring', 'analytics.posts.state.soFar', 'analytics.posts.state.notMeasured', 'analytics.state.unavailable']) expect(html).toContain(key)
  })

  it('an empty list and an errored read each render their own state', () => {
    const empty: PostsModel = { tier: 'basic', period: '2026-04', posts: { status: 'ok', data: [] } }
    const failed: PostsModel = { tier: 'basic', period: '2026-04', posts: { status: 'error', reason: 'ceiling' } }
    expect(renderToStaticMarkup(<PostsTable t={echo} locale="en" timezone={LISBON} model={empty} />)).toContain('analytics.state.empty')
    expect(renderToStaticMarkup(<PostsTable t={echo} locale="en" timezone={LISBON} model={failed} />)).toContain('analytics.state.error')
  })
})

describe('the same surface in all three locales renders no missing key', () => {
  it.each([['en'], ['pt'], ['es']] as const)('%s: the populated Pro portfolio and a basic one have no ⟦missing⟧ marker', (locale) => {
    expect(render(tFor(locale), advanced(), locale)).not.toContain('⟦missing')
    expect(render(tFor(locale), basic(), locale)).not.toContain('⟦missing')
  })

  it('pt and es read in their own language', () => {
    expect(text(render(tFor('pt'), advanced(), 'pt'))).toContain('Taxa de interação típica: 3,1%'.replace('3,1', '3.1'))
    expect(text(render(tFor('es'), advanced(), 'es'))).toContain('Tasa de interacción típica: 3.1%')
  })
})
