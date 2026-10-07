import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport, type ReportPayload } from '@/lib/reports/assemble'
import { fixtureReaders, fixturePatternRow, FIXTURE_LABELS_A, FIXTURE_NAME_A } from '@/lib/reports/__fixtures__/readers'
import { renderOutcomePattern } from '@/lib/outcomes/template'
import enAnalytics from '@/i18n/en/analytics.json'
import { ReportBody } from './ReportBody'
import { PatternsSection } from './PortfolioView'
import type { T } from './shared'
import type { PatternObservation } from '@/lib/analytics/load'

// Session 37-D D6 (MAJOR-2, MAJOR-1 under A-8(a)). A stored pattern is a CELL; the words come from the reader's locale. These tests use
// the REAL cell of a REAL row (pattern_key set, the English sentence memory stores alongside it) and assert that sentence never reaches a
// pt or es page or report. The sentence under test is what renderOutcomePattern itself produces, not an invented one.

const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const CELL: PatternObservation = { platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }
const STORED_ENGLISH = renderOutcomePattern({ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate' })

const expectedLine = (locale: Locale, c: PatternObservation) => {
  const t = tFor(locale)
  return t('analytics.pattern.' + c.direction + (c.basis === 'count' ? '_count' : ''), {
    platform: t('analytics.platform.' + c.platform),
    subject: t('outcome.observed.subject.' + c.dimension + '.' + c.value),
    wins: c.wins,
    n: c.n,
    campaigns: c.campaigns,
  })
}

async function payload(patterns: ReturnType<typeof fixturePatternRow>[]): Promise<ReportPayload> {
  return (await assembleReport({ readers: fixtureReaders({ patterns }), businessId: BUSINESS_A_ID, period: '2026-03', now: MARCH_REPORT_OUTCOMES_THROUGH })).payload
}
const renderReport = (p: ReportPayload, locale: Locale) =>
  text(renderToStaticMarkup(<ReportBody t={tFor(locale)} locale={locale} timezone="Europe/Lisbon" payload={p} proAllowed businessName={FIXTURE_NAME_A} labels={FIXTURE_LABELS_A} />))
const renderPage = (locale: Locale, data: PatternObservation[]) =>
  text(renderToStaticMarkup(<PatternsSection t={tFor(locale)} patterns={{ status: 'ok', data }} />))

describe('MAJOR-2: a pattern renders from its cell in the reader locale, never from the stored English sentence', () => {
  it('the control: the stored sentence really is English and is not any locale rendering', () => {
    expect(STORED_ENGLISH).toBe("On X, thread posts beat this brand's usual engagement.")
    for (const locale of LOCALES) expect(expectedLine(locale, CELL)).not.toContain(STORED_ENGLISH)
  })

  it.each(LOCALES)('%s: the live page section shows the localized sentence with the evidence once, and none of the stored English', (locale) => {
    const body = renderPage(locale, [CELL])
    expect(body).not.toContain('⟦missing')
    expect(body).toContain(expectedLine(locale, CELL))
    expect(body).not.toContain(STORED_ENGLISH)
    if (locale !== 'en') expect(body).not.toContain('beat')
  })

  it.each(LOCALES)('%s: the report (a real stored payload, rendered) shows the same sentence and none of the stored English', async (locale) => {
    const body = renderReport(await payload([fixturePatternRow()]), locale)
    expect(body).toContain(expectedLine(locale, CELL))
    expect(body).not.toContain(STORED_ENGLISH)
    expect(body).not.toContain('⟦missing')
  })

  it('the evidence is stated ONCE: the old separate "Based on n posts across c campaigns" line is gone', () => {
    for (const locale of LOCALES) {
      const body = renderPage(locale, [CELL])
      expect(body.match(/\b10\b/g)).toHaveLength(1)
    }
  })

  it('a count-basis cell uses the count template (LinkedIn), in every locale', () => {
    const li: PatternObservation = { ...CELL, platform: 'linkedin', basis: 'count', direction: 'below' }
    for (const locale of LOCALES) expect(renderPage(locale, [li])).toContain(expectedLine(locale, li))
  })
})

describe('MAJOR-1 under A-8(a): a Pro month with posts and no pattern says so truthfully', () => {
  it('the en text is the ruled literal', () => {
    expect(enAnalytics.state.noPatternYet).toBe('No pattern has enough evidence yet. Jemip only learns a pattern from at least 10 posts across 3 campaigns.')
  })

  it.each(LOCALES)('%s: the page section says noPatternYet and NOT "Nothing published yet"', (locale) => {
    const t = tFor(locale)
    const body = renderPage(locale, [])
    expect(body).toContain(t('analytics.state.noPatternYet'))
    expect(body).not.toContain(t('analytics.state.empty'))
  })

  it.each(LOCALES)('%s: the report of a month with 13 posts and zero patterns says noPatternYet, and "Nothing published yet" is absent from the whole report', async (locale) => {
    const t = tFor(locale)
    const p = await payload([])
    expect(p.patterns).toEqual([])
    const body = renderReport(p, locale)
    expect(body).toContain(t('analytics.state.noPatternYet'))
    expect(body).not.toContain(t('analytics.state.empty'))
  })
})
