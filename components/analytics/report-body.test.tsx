// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport, type ReportPayload } from '@/lib/reports/assemble'
import { REPORT_METHODOLOGY_KEYS } from '@/lib/reports/constants'
import { fixtureReaders } from '@/lib/reports/__fixtures__/readers'
import { ReportBody } from './ReportBody'
import type { T } from './shared'

// ADR 0031 §5.3, §10.5, ruling A-5 — the stored report, rendered. A real translator over the message files, so what a
// customer reads is what is asserted. The payloads are the REAL assembler's, over the O2.1 fixture.

const NOW = MARCH_REPORT_OUTCOMES_THROUGH
const LISBON = 'Europe/Lisbon'
const patterns = [{ business_id: BUSINESS_A_ID, pattern_key: null, platform: 'twitter' as const, pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }]

const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}

async function payload(over: { plan?: Record<string, unknown>; period?: string } = {}): Promise<ReportPayload> {
  const r = await assembleReport({
    readers: fixtureReaders({ plan: over.plan, patterns }),
    businessId: BUSINESS_A_ID,
    period: over.period ?? '2026-03',
    now: NOW,
  })
  return r.payload
}

const render = (p: ReportPayload, proAllowed: boolean, locale: Locale = 'en') =>
  renderToStaticMarkup(<ReportBody t={tFor(locale)} locale={locale} timezone={LISBON} payload={p} proAllowed={proAllowed} />)

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const sectionIds = (html: string) => [...html.matchAll(/id="([a-z]+)-title"/g)].map((m) => m[1])

describe('a Pro report on a Pro plan: the eleven sections, in order', () => {
  it('renders summary, activity, results, rated posts, unavailable, campaigns, trend, breakdowns, patterns and methodology, in that order', async () => {
    const html = render(await payload(), true)
    expect(sectionIds(html)).toEqual(['summary', 'activity', 'results', 'rated', 'unavailable', 'campaigns', 'trend', 'breakdowns', 'patterns', 'methodology'])
  })

  it('opens with the month as the heading and the header sentence: business, measured-as-of and generated dates', async () => {
    const html = render(await payload(), true)
    expect(html).toMatch(/<h1[^>]*>March 2026<\/h1>/)
    expect(text(html)).toContain('Fixture A (Lisbon) · March 2026. Measured as of')
    expect(text(html)).toMatch(/Generated on /)
  })

  it('the rated-posts section is titled by the closed key (never "top" or "best") and carries the caveat and the n of each row', async () => {
    const html = render(await payload(), true)
    expect(text(html)).toContain('Three X posts by engagement rate')
    expect(text(html)).toContain('A post seen by few people can have a high rate.')
    expect(text(html)).toMatch(/Post 1: engagement rate 6\.4% \(1 post\)/)
    expect(text(html)).not.toMatch(/\b(top|best)\b/i)
  })

  it('the methodology renders all eight closed keys', async () => {
    const html = render(await payload(), true)
    expect(REPORT_METHODOLOGY_KEYS).toHaveLength(8)
    const body = text(html)
    expect(body).toContain('This measures engagement, not signups or revenue.')
    expect(body).toContain('The typical rate is the median engagement rate')
    expect(body).toContain('A post is measured 7 days after it goes out.')
  })

  it('print: page breaks before the trend and the methodology, and tables and charts are kept whole', async () => {
    const html = render(await payload(), true)
    expect(html.match(/print:break-before-page/g)).toHaveLength(2)
    expect(html).toContain('break-inside-avoid')
  })

  it('carries no action: no form, no button, no input (the setting lives on the list page, and the PDF shows none)', async () => {
    const html = render(await payload(), true)
    expect(html).not.toMatch(/<form|<button|<input|<select/)
  })
})

describe('A-5: Pro sections render only while the CURRENT plan allows them', () => {
  it('a stored Pro report on a plan that no longer allows them shows the plain "Available on Pro" line and none of the Pro content', async () => {
    const p = await payload()
    expect(p.trend && p.observed && p.patterns).toBeTruthy()
    const html = render(p, false)
    const body = text(html)
    expect(body.match(/Available on Pro:/g)).toHaveLength(3)
    expect(sectionIds(html)).toEqual(['summary', 'activity', 'results', 'rated', 'unavailable', 'campaigns', 'trend', 'breakdowns', 'patterns', 'methodology'])
    expect(body).not.toContain('Posts with a question opening beat your usual.')
    expect(body).not.toContain('Based on 10 posts across 3 campaigns.')
    expect(html).not.toContain('trend-posts')
  })

  it('a re-upgrade restores them from the same stored payload (nothing was lost or recomputed)', async () => {
    const p = await payload()
    const before = JSON.stringify(p)
    render(p, false)
    const restored = render(p, true)
    expect(JSON.stringify(p)).toBe(before)
    expect(text(restored)).toContain('Posts with a question opening beat your usual.')
  })

  it('a report generated on a basic plan, viewed on a Pro plan, says so plainly and invents no number', async () => {
    const p = await payload({ plan: { [BUSINESS_A_ID]: 'plus' } })
    expect(p.tier).toBe('basic')
    expect(p).not.toHaveProperty('trend')
    const html = render(p, true)
    expect(text(html).match(/This report was generated before your plan included this section\./g)).toHaveLength(3)
    expect(html).not.toContain('trend-posts')
  })

  it('a basic report on a basic plan shows the Pro lines, exactly as the live page does', async () => {
    const p = await payload({ plan: { [BUSINESS_A_ID]: 'plus' } })
    expect(text(render(p, false)).match(/Available on Pro:/g)).toHaveLength(3)
  })
})

describe('a stub month (nothing published)', () => {
  it('shows the one sentence and the methodology, with no activity, results or campaign tables', async () => {
    const p = await payload({ period: '2025-11' })
    expect(p.stub).toBe(true)
    const html = render(p, true)
    expect(sectionIds(html)).toEqual(['summary', 'methodology'])
    expect(text(html)).toContain('No posts were published in November 2025, so there is nothing to measure.')
    expect(html).not.toContain('<table')
  })
})

describe('every locale renders completely', () => {
  it.each(LOCALES)('%s: no missing key marker and no raw key reaches the page, for a Pro report, a basic report and a stub', async (locale) => {
    for (const [p, pro] of [
      [await payload(), true],
      [await payload(), false],
      [await payload({ plan: { [BUSINESS_A_ID]: 'plus' } }), true],
      [await payload({ period: '2025-11' }), true],
    ] as const) {
      const html = render(p, pro, locale)
      expect(html).not.toContain('⟦missing')
      expect(text(html)).not.toMatch(/\banalytics\.[a-z]+\.[a-zA-Z.]+/)
      expect(text(html)).not.toMatch(/\boutcome\.[a-z_]+\.[a-z_]+/)
    }
  })

  it('the section titles and the methodology are in the locale language, not English, in pt and es', async () => {
    const p = await payload()
    expect(text(render(p, true, 'pt'))).toContain('Como ler este relatório')
    expect(text(render(p, true, 'es'))).toContain('Cómo leer este informe')
  })
})
