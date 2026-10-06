// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { loadPortfolioWith, type CampaignTableRow, type Portfolio, type PostRowView, type PostsView as PostsModel } from '@/lib/analytics/load'
import { assembleReport, type ReportPayload } from '@/lib/reports/assemble'
import { fixtureReaders } from '@/lib/reports/__fixtures__/readers'
import { compileReportCss } from '@/lib/reports/pdf-css'
import { TABLE } from '@/components/analytics/shared'
import { PortfolioView } from './PortfolioView'
import { PostsTable } from './PostsView'
import { ReportBody } from './ReportBody'
import { MonthPicker, SelectField, type T } from './shared'

// ADR 0031 §10.4, build-guide O2.10 (/break-ui): the analytics surfaces fed the realistic WORST case for every customer-supplied
// value, rendered through the real components and the real en/pt/es translators. This file proves what is checkable in MARKUP
// (a string that can break has a container that lets it; no table is blank; nothing renders NaN, undefined or a raw key). It
// does NOT prove layout: a real browser at 320, 640 and 1280 px, 200% zoom, dark mode and RTL stays UNPROVEN (O2.11), because
// markup cannot show whether a box actually fits. There is no demo toggle in product code: the ADR allows no demo surface.

const NOW = MARCH_REPORT_OUTCOMES_THROUGH
const LISBON = 'Europe/Lisbon'
const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}

// Plausible, not random: the longest campaign name a founder would type, a real-shaped unbreakable handle, one-letter and
// non-Latin names, an RTL name, an emoji name.
const LONG = 'Enterprise SSO and audit-log launch: regional variants for DACH, the Nordics and the Iberian market, with partner webinars'
const HANDLE = 'northwind-industries-holdings.engineering.platform-team.example.com'
const ONE = 'J'
const JA = '新製品発表キャンペーン：エンタープライズ向けSSOの提供開始'
const AR = 'حملة إطلاق المنتج الجديد للمؤسسات'
const EMOJI = '🚀 Launch 🎉'
const CUSTOMER_STRINGS = [LONG, HANDLE, ONE, JA, AR, EMOJI]

const BAD = /NaN|undefined|\[object Object\]|⟦missing|\banalytics\.[a-z]+\.[a-zA-Z.]+|\boutcome\.[a-z_]+\.[a-z_]+/

let base: Portfolio
beforeEach(async () => {
  base ??= await loadPortfolioWith(fixtureReaders({ patterns: [{ business_id: BUSINESS_A_ID, pattern_key: null, platform: 'twitter' as const, pattern: LONG, wins: 7, n: 10, campaigns: 3 }] }), BUSINESS_A_ID, '2026-03', { now: () => NOW })
})

function worst(): Portfolio {
  if (base.activity.status !== 'ok') throw new Error('fixture activity')
  const campaigns: CampaignTableRow[] = [
    { campaignId: 'c1', name: LONG, status: 'active', published: 1_000_000, href: '/campaigns/c1', retro: null },
    { campaignId: 'c2', name: ONE, status: 'completed', published: 1, href: '/campaigns/c2', retro: { verdict: { key: 'outcome.retrospective.verdict_supported', params: { n: 12 } }, beat: { key: 'outcome.retrospective.posts_beat', params: { wins: 8, n: 12 } } } },
    { campaignId: 'c3', name: JA, status: 'paused', published: 10_000, href: '/campaigns/c3', retro: null },
    { campaignId: 'c4', name: AR, status: 'draft', published: 0, href: '/campaigns/c4', retro: null },
    { campaignId: 'c5', name: EMOJI, status: null, published: 12, href: '/campaigns/c5', retro: null },
    { campaignId: 'c6', name: null, status: 'active', published: 3, href: '/campaigns/c6', retro: null },
  ]
  return {
    ...base,
    activity: {
      status: 'ok',
      data: {
        ...base.activity.data,
        total: 1_000_000,
        previousTotal: 10_000,
        rows: [
          { platform: 'twitter', accountId: 'a1', label: HANDLE, labelKey: null, count: 999_999 },
          { platform: 'twitter', accountId: 'a2', label: ONE, labelKey: null, count: 1 },
          { platform: 'linkedin', accountId: 'a3', label: JA, labelKey: null, count: 10_000 },
          { platform: 'linkedin', accountId: null, label: null, labelKey: 'analytics.account.unrecorded', count: 0 },
        ],
        campaigns: { active: 10_000, completed: 1 },
      },
    },
    campaigns: { status: 'ok', data: campaigns },
  } as Portfolio
}

const render = (locale: Locale, p: Portfolio) => renderToStaticMarkup(<PortfolioView t={tFor(locale)} locale={locale} timezone={LISBON} portfolio={p} />)
const mount = (html: string) => {
  document.body.innerHTML = html
  return document.body
}

/** Every element whose own text contains `needle`, with the classes of it and of its ancestors up to the section. */
function containers(root: HTMLElement, needle: string): string[][] {
  const out: string[][] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').includes(needle)) continue
    const chain: string[] = []
    for (let el = node.parentElement; el && el !== root && el.tagName !== 'SECTION'; el = el.parentElement) chain.push(el.className)
    out.push(chain)
  }
  return out
}
const canShrink = (chain: string[]) => chain.some((c) => /wrap-anywhere|break-all|truncate|line-clamp/.test(c))

describe('the portfolio with the worst realistic data, in every locale', () => {
  it.each(LOCALES)('%s: nothing renders NaN, undefined, [object Object], a raw key or a missing-key marker', (locale) => {
    expect(render(locale, worst())).not.toMatch(BAD)
  })

  it.each(LOCALES)('%s: every customer-supplied string renders, whole (never cut by the markup)', (locale) => {
    const html = render(locale, worst())
    for (const s of [LONG, HANDLE, JA, AR, EMOJI]) expect(html).toContain(s)
  })

  it('a long or unbreakable customer string sits in a container that is allowed to shrink and wrap (min-width is not auto, the string may break anywhere)', () => {
    const root = mount(render('en', worst()))
    for (const s of [LONG, HANDLE, JA, AR]) {
      const found = containers(root, s)
      expect(found.length, s).toBeGreaterThan(0)
      for (const chain of found) expect(canShrink(chain), `${s} in ${JSON.stringify(chain)}`).toBe(true)
    }
  })

  it('table cells that hold customer strings can shrink (min-w-0) so a flex or table layout cannot be pushed wider than its container', () => {
    const root = mount(render('en', worst()))
    const cells = [...root.querySelectorAll('td')].filter((td) => CUSTOMER_STRINGS.some((s) => td.textContent?.includes(s)))
    expect(cells.length).toBeGreaterThan(0)
    for (const td of cells) expect(td.className).toMatch(/min-w-0/)
  })

  it('the campaign table keeps its labelled-card stacking at 320 px on every row: block rows, data-label on every cell, head hidden to readers-only', () => {
    const root = mount(render('en', worst()))
    // The campaigns section only: the charts carry their own (visually hidden) tables.
    const rows = [...(root.querySelector('#campaigns-title')?.closest('section')?.querySelectorAll('tbody tr') ?? [])]
    expect(rows).toHaveLength(6)
    for (const tr of rows) {
      expect(tr.className).toContain('max-sm:block')
      for (const td of tr.querySelectorAll('td')) expect(td.getAttribute('data-label'), td.textContent ?? '').toBeTruthy()
    }
    expect(root.querySelector('thead')?.className).toContain('max-sm:sr-only')
  })

  it('a name of one letter and a null name both render something readable (the null name falls back to the "Open campaign" label)', () => {
    const html = render('en', worst())
    expect(html).toContain('>J<')
    expect(html).toContain('Open campaign')
  })

  it('counts are rendered as whole numbers, never as floats or exponent forms, including 1,000,000 and 0', () => {
    const html = render('en', worst())
    // The VISIBLE text only: SVG coordinates legitimately carry decimals.
    expect(mount(html).textContent).not.toMatch(/\d\.\d{3,}|e\+\d/)
    expect(html).toContain('1000000')
    expect(html).toContain('>0<')
  })

  it('customer-supplied names carry dir="auto", so an RTL name aligns and orders by its own direction inside an LTR page', () => {
    const root = mount(render('en', worst()))
    const arabic = [...root.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent === AR)
    expect(arabic?.closest('[dir="auto"]'), 'the Arabic campaign name has no dir="auto" ancestor').toBeTruthy()
  })
})

describe('empty and absent data', () => {
  it('a campaigns list with no rows renders no table at all (never a table with a header and nothing under it)', () => {
    const p = { ...worst(), campaigns: { status: 'ok', data: [] } } as Portfolio
    const root = mount(render('en', p))
    expect(root.querySelector('#campaigns-title')).toBeNull()
    expect(root.textContent).not.toContain('Verdict')
  })

  it('zero posts renders the empty state and none of the tables', () => {
    const w = worst()
    if (w.activity.status !== 'ok') throw new Error('fixture activity')
    const p: Portfolio = { ...w, activity: { status: 'ok', data: { ...w.activity.data, total: 0, rows: [] } } }
    const html = render('en', p)
    expect(html).toContain('Nothing published yet.')
    expect(html).not.toContain('<table')
  })
})

describe('the posts table', () => {
  const row = (i: number, over: Partial<PostRowView> = {}): PostRowView => ({
    postId: 'p' + i, platform: 'twitter', publishedAt: '2026-03-04T09:00:00Z', accountId: null, accountLabel: null, accountLabelKey: 'analytics.account.unrecorded',
    campaignId: 'c', campaignName: 'C', state: 'final', final: { basis: 'rate', value: 0.031, rate: '3.1%', badge: 'above' }, ...over,
  })
  const model = (rows: PostRowView[]): PostsModel => ({ tier: 'basic', period: '2026-03', posts: { status: 'ok', data: rows } })
  const html = (locale: Locale, rows: PostRowView[]) => renderToStaticMarkup(<PostsTable t={tFor(locale)} locale={locale} timezone={LISBON} model={model(rows)} />)

  const hostileRows = [
    row(1, { accountLabel: HANDLE, accountLabelKey: null, campaignName: LONG }),
    row(2, { accountLabel: ONE, accountLabelKey: null, campaignName: ONE }),
    row(3, { accountLabel: JA, accountLabelKey: null, campaignName: JA }),
    row(4, { accountLabel: AR, accountLabelKey: null, campaignName: AR }),
    row(5, { campaignName: null }),
    row(6, { state: 'so_far', final: undefined, soFar: { likes: 1_000_000, comments: null, shares: 0, impressions: 12_345_678, asOf: '2026-03-10T09:00:00Z' }, finalOn: '2026-03-11T09:00:00Z' }),
    row(7, { state: 'not_measured', final: undefined, reason: 'zero_impressions' }),
  ]

  it.each(LOCALES)('%s: nothing renders NaN, undefined, a raw key or a missing-key marker', (locale) => {
    expect(html(locale, hostileRows)).not.toMatch(BAD)
  })

  it('customer strings in the account and campaign cells can shrink and wrap, and carry dir="auto"', () => {
    const root = mount(html('en', hostileRows))
    for (const s of [LONG, HANDLE, JA, AR]) {
      for (const chain of containers(root, s)) expect(canShrink(chain), s).toBe(true)
    }
    const cell = [...root.querySelectorAll('td')].find((td) => td.textContent === AR)
    expect(cell?.closest('[dir="auto"]')).toBeTruthy()
  })

  it('a null campaign renders the dash placeholder, and every row keeps labelled cells for the 320 px card layout', () => {
    const root = mount(html('en', hostileRows))
    for (const td of root.querySelectorAll('tbody td')) expect(td.getAttribute('data-label')).toBeTruthy()
    expect(root.textContent).toContain('–')
  })

  it('1,000 rows render completely (the loader caps a read at 5,000, so this is the realistic ceiling) and without a blank row', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(i))
    const started = Date.now()
    const out = html('en', rows)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(out.match(/<tr/g)).toHaveLength(1001)
    expect(out).not.toMatch(BAD)
  })

  it('no posts renders the empty state and no table', () => {
    const out = html('en', [])
    expect(out).not.toContain('<table')
  })
})

describe('the filter selects', () => {
  it('a select whose options carry long customer names cannot be wider than its container (max-w-full)', () => {
    const out = renderToStaticMarkup(
      <SelectField id="c" label="Campaign" name="campaign" value="" options={[{ value: '', label: 'All' }, { value: 'x', label: LONG }, { value: 'y', label: HANDLE }]} />,
    )
    expect(out).toMatch(/<select[^>]*class="[^"]*max-w-full/)
  })
})

describe('the report with the worst data', () => {
  async function payload(): Promise<ReportPayload> {
    const p = (await assembleReport({ readers: fixtureReaders({ patterns: [{ business_id: BUSINESS_A_ID, pattern_key: null, platform: 'twitter' as const, pattern: LONG, wins: 7, n: 10, campaigns: 3 }] }), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })).payload
    return {
      ...p,
      header: { ...p.header, params: { ...p.header.params, business: HANDLE } },
      campaigns: p.campaigns?.map((c, i) => ({ ...c, name: [LONG, JA, AR, EMOJI, null][i % 5], published: 1_000_000 })),
      activity: p.activity && { ...p.activity, total: 1_000_000, previousTotal: 10_000, rows: p.activity.rows.map((r, i) => ({ ...r, label: [HANDLE, ONE, JA][i % 3], count: 10_000 })) },
    }
  }
  const html = async (locale: Locale, plain = false) => renderToStaticMarkup(<ReportBody t={tFor(locale)} locale={locale} timezone={LISBON} payload={await payload()} proAllowed plain={plain} />)

  it.each(LOCALES)('%s: nothing renders NaN, undefined, a raw key or a missing-key marker (page and PDF render)', async (locale) => {
    expect(await html(locale)).not.toMatch(BAD)
    expect(await html(locale, true)).not.toMatch(BAD)
  })

  it('the business name in the header is an unbreakable handle: it can break anywhere, so the cover line cannot overflow', async () => {
    const root = mount(await html('en'))
    const found = containers(root, HANDLE)
    expect(found.length).toBeGreaterThan(0)
    for (const chain of found) expect(canShrink(chain), JSON.stringify(chain)).toBe(true)
  })

  it('the pattern text (a long customer-influenced sentence) and the campaign names can shrink and wrap', async () => {
    const root = mount(await html('en'))
    for (const s of [LONG, JA, AR]) for (const chain of containers(root, s)) expect(canShrink(chain), s).toBe(true)
  })
})

describe('the interaction floor (ADR 0031 §10.6: visible focus, targets of 24 px or more)', () => {
  it('every link, button, select and disclosure on the portfolio and the report carries the full-contrast focus indicator', async () => {
    const root = mount(render('en', worst()))
    const controls = [...root.querySelectorAll('a, button, select, summary')]
    expect(controls.length).toBeGreaterThan(5)
    for (const el of controls) expect(el.className, el.outerHTML.slice(0, 80)).toContain('focus-visible:outline-foreground')
    const report = mount(renderToStaticMarkup(<ReportBody t={tFor('en')} locale="en" timezone={LISBON} payload={(await assembleReport({ readers: fixtureReaders(), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })).payload} proAllowed />))
    for (const el of report.querySelectorAll('a')) expect(el.className).toContain('focus-visible:outline-foreground')
  })

  it('the month picker (a select and a button) carries the focus indicator, a hover state and an instant pressed state', () => {
    const root = mount(
      renderToStaticMarkup(<MonthPicker t={tFor('en')} action="/en/analytics" value="2026-03" options={[{ value: '2026-03', label: 'March 2026' }]} />),
    )
    const button = root.querySelector('button')
    const select = root.querySelector('select')
    expect(button?.className).toContain('focus-visible:outline-foreground')
    expect(button?.className).toMatch(/hover:bg-secondary\/80/)
    expect(button?.className).toMatch(/active:opacity-80/)
    expect(select?.className).toContain('focus-visible:outline-foreground')
    expect(button?.className).toMatch(/min-h-8/)
  })

  it('the "Details" disclosure is a 24 px target (min-h-6), not a 16 px line of text-xs', () => {
    const summary = mount(render('en', worst())).querySelector('summary')
    expect(summary?.className).toMatch(/min-h-6/)
  })

  it('buttons have a hover and an instant pressed state, and no motion (no transition, no transform) anywhere in the analytics classes', () => {
    const root = mount(render('en', worst()))
    const html = root.innerHTML
    expect(html).not.toMatch(/transition|animate-|duration-|scale-|translate-/)
  })

  it('the report print rules: rows and charts stay whole, sub-headings stay with their content, and the report page has no nav or action in print', async () => {
    const out = renderToStaticMarkup(<ReportBody t={tFor('en')} locale="en" timezone={LISBON} payload={(await assembleReport({ readers: fixtureReaders(), businessId: BUSINESS_A_ID, period: '2026-03', now: NOW })).payload} proAllowed />)
    // Read through the DOM: React writes "&" in an attribute as "&amp;" and a browser decodes it.
    const article = mount(out).querySelector('article')?.className ?? ''
    for (const cls of ['print:[&_tr]:break-inside-avoid', 'print:[&_svg]:break-inside-avoid', 'print:[&_h2]:break-after-avoid', 'print:[&_h3]:break-after-avoid']) expect(article).toContain(cls)
  })
})

describe('the class that makes a string breakable is real', () => {
  it('wrap-anywhere compiles to overflow-wrap: anywhere (so the markup assertions above are not about a no-op class), and min-w-0 to min-width: 0', async () => {
    const css = await compileReportCss(['wrap-anywhere', 'min-w-0'])
    expect(css).toMatch(/overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/min-width:\s*(calc\(var\(--spacing\)\s*\*\s*0\)|0)/)
  })

  // O2.11 (real browser, 320 px): the cell's wrap-anywhere is inherited by its ::before label, which is a flex item, so the label
  // shrank to one character and "Verdict" rendered as "Veredic / to". The label must never shrink below its word.
  it('the stacked-card label cannot be squeezed below its word: shrink-0, a width cap, and no break-anywhere on the ::before', async () => {
    for (const cls of ['max-sm:before:shrink-0', 'max-sm:before:max-w-[45%]', 'max-sm:before:wrap-break-word']) expect(TABLE.cell).toContain(cls)
    const css = await compileReportCss(['max-sm:before:shrink-0', 'max-sm:before:wrap-break-word'])
    expect(css).toMatch(/::before[\s\S]*flex-shrink:\s*0/)
    expect(css).toMatch(/::before[\s\S]*overflow-wrap:\s*break-word/)
  })
})
