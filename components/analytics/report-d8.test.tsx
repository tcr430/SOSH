// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render as renderEmail } from '@react-email/render'
import enAnalytics from '@/i18n/en/analytics.json'
import ptAnalytics from '@/i18n/pt/analytics.json'
import esAnalytics from '@/i18n/es/analytics.json'

// Session 37-D D8: the summary and the email (MAJOR-7), the report's trend heading (MINOR-1), the interval in section 7 (MINOR-3) and the
// cited posts resolved at render (MINOR-4). Everything is the REAL assembler's payload over the O2.1 fixture, rendered through the real
// message files, so what is asserted is what a customer reads.

const enqueue = vi.hoisted(() => vi.fn())
const business = vi.hoisted(() => ({ language: 'en' as 'en' | 'pt' | 'es' }))
vi.mock('@/lib/config', () => ({ config: { server: { APP_URL: 'https://app.example.test' } } }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessByIdForWorker: async () => ({ id: 'biz', name: 'Fixture A', language: business.language, report_email: 'admins' }) }))
vi.mock('@/lib/db/business-members', () => ({ resolveReportRecipients: async () => [{ id: 'm1', email: 'owner@example.com' }] }))
vi.mock('@/lib/db/email-outbox', () => ({ countMonthlyReportEmailsForWorker: async () => 0 }))
vi.mock('@/lib/email/enqueue', () => ({ enqueueEmail: enqueue }))

import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { makeTranslator as makeEmailTranslator } from '@/lib/email/templates/__tests__/helpers'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport, type ReportPayload } from '@/lib/reports/assemble'
import { deliverMonthlyReport } from '@/lib/reports/deliver'
import { fixtureReaders, fixturePatternRow, FIXTURE_LABELS_A, FIXTURE_NAME_A } from '@/lib/reports/__fixtures__/readers'
import { buildReportHtml } from '@/lib/reports/pdf-html'
import { MonthlyReportEmail } from '@/lib/email/templates/monthly-report'
import { NO_LABELS, type ReportLabels } from '@/lib/analytics/labels'
import { ReportBody } from './ReportBody'
import { CampaignsSection } from './PortfolioView'
import type { T } from './shared'

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: Locale }) => (key: string, values?: Record<string, string | number>) => {
    const dot = key.indexOf('.')
    return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
  },
}))

const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

async function payload(over: { plan?: Record<string, unknown> } = {}): Promise<ReportPayload> {
  return (
    await assembleReport({ readers: fixtureReaders({ plan: over.plan, patterns: [fixturePatternRow()] }), businessId: BUSINESS_A_ID, period: '2026-03', now: MARCH_REPORT_OUTCOMES_THROUGH })
  ).payload
}
const body = (p: ReportPayload, locale: Locale, opts: { pro?: boolean; labels?: ReportLabels } = {}) =>
  renderToStaticMarkup(
    <ReportBody t={tFor(locale)} locale={locale} timezone="Europe/Lisbon" payload={p} proAllowed={opts.pro ?? true} businessName={FIXTURE_NAME_A} labels={opts.labels ?? FIXTURE_LABELS_A} />,
  )

const FILES = { en: enAnalytics, pt: ptAnalytics, es: esAnalytics }
const REPORT = { businessId: 'biz', period: '2026-03' }

beforeEach(() => {
  enqueue.mockReset().mockResolvedValue({ outcome: 'enqueued', row_id: 'r' })
})

describe('MAJOR-7: the email states every win count with its usual and drift sentences, under a platform heading', () => {
  it.each(LOCALES)('%s: the delivered summary lines are the heading, the typical line, the win line, then the usual definition, the drift sentence and the import note, in that order', async (locale) => {
    business.language = locale
    const p = await payload()
    await deliverMonthlyReport({ businessId: REPORT.businessId, period: REPORT.period, summary: p.summary })
    const lines = enqueue.mock.calls[0][0].props.summaryLines as string[]
    const d = FILES[locale].disclosure
    const platform = FILES[locale].platform.twitter
    expect(lines[1]).toBe(platform + ':')
    // lines[2] is the typical rate, lines[3] the win count; the definition and the drift sentence follow the count immediately.
    expect(lines[4]).toBe(d.usual)
    expect(lines[5]).toBe(d.usualUpdates)
    expect(lines[6]).toBe(d.importSeed)
    expect(lines).toHaveLength(7)
  })

  it('en: the rendered email body orders the heading, the win count, the definition and the drift sentence', async () => {
    business.language = 'en'
    const p = await payload()
    await deliverMonthlyReport({ businessId: REPORT.businessId, period: REPORT.period, summary: p.summary })
    const summaryLines = enqueue.mock.calls[0][0].props.summaryLines as string[]
    const html = await renderEmail(
      React.createElement(MonthlyReportEmail, { locale: 'en', t: makeEmailTranslator('en'), businessName: 'Fixture A', periodLabel: 'March 2026', summaryLines, reportUrl: 'https://app.example.test/en/analytics/reports/2026-03' }),
      { plainText: true },
    )
    const at = (needle: string) => html.indexOf(needle)
    expect(at('X:')).toBeGreaterThan(-1)
    expect(at('beat your usual engagement.')).toBeGreaterThan(at('X:'))
    expect(at(enAnalytics.disclosure.usual)).toBeGreaterThan(at('beat your usual engagement.'))
    expect(at(enAnalytics.disclosure.usualUpdates)).toBeGreaterThan(at(enAnalytics.disclosure.usual))
  })

  it('the email cap no longer drops a disclosure: two copies of the summary (14 lines) are all kept', async () => {
    business.language = 'en'
    const p = await payload()
    await deliverMonthlyReport({ businessId: REPORT.businessId, period: REPORT.period, summary: [...p.summary, ...p.summary] })
    expect((enqueue.mock.calls[0][0].props.summaryLines as string[]).length).toBe(14)
  })

  it.each(LOCALES)('%s: the report page shows the same structure: the platform heading, then its lines, with the definitions after the win count', async (locale) => {
    const p = await payload()
    const t = text(body(p, locale))
    const d = FILES[locale].disclosure
    const heading = t.indexOf(FILES[locale].platform.twitter)
    expect(heading).toBeGreaterThan(-1)
    const usual = t.indexOf(d.usual)
    expect(usual).toBeGreaterThan(heading)
    expect(t.indexOf(d.usualUpdates)).toBeGreaterThan(usual)
  })
})

describe('MINOR-1: the report trend says 6 months', () => {
  it.each(LOCALES)('%s: the heading is the 6-month key and the 12-month heading is nowhere in the report', async (locale) => {
    const p = await payload()
    const t = text(body(p, locale))
    expect(t).toContain(FILES[locale].report.section.trend6)
    expect(t).not.toContain(FILES[locale].section.trend)
  })

  it('a plan without Pro: the gated trend section carries the 6-month heading too', async () => {
    const p = await payload()
    expect(text(body(p, 'en', { pro: false }))).toContain('6-month trend')
    expect(text(body(p, 'en', { pro: false }))).not.toContain('12-month trend')
  })

  it('literal: en "6-month trend", pt "Tendência de 6 meses", es "Tendencia de 6 meses"', () => {
    expect(enAnalytics.report.section.trend6).toBe('6-month trend')
    expect(ptAnalytics.report.section.trend6).toBe('Tendência de 6 meses')
    expect(esAnalytics.report.section.trend6).toBe('Tendencia de 6 meses')
  })
})

describe('MINOR-3: section 7 carries the interval of a supported retrospective', () => {
  it('the report shows "likely between 40% and 85% of posts" after the share that beat the usual', async () => {
    const p = await payload()
    const t = text(body(p, 'en'))
    expect(t).toContain('likely between 40% and 85% of posts')
    expect(t.indexOf('likely between 40% and 85% of posts')).toBeGreaterThan(t.indexOf('8 of 12'))
  })

  it('the live page table is unchanged: the same rows without the opt-in show no interval', async () => {
    const p = await payload()
    const rows = (p.campaigns ?? []).map((c) => ({ ...c, name: 'N' }))
    const html = renderToStaticMarkup(<CampaignsSection t={tFor('en')} rows={{ status: 'ok', data: rows }} />)
    expect(text(html)).not.toContain('likely between')
  })
})

describe('MINOR-4: a cited post says which post it was, or that it is gone', () => {
  it('resolved: each rated post links to the posts view of its campaign, and none says removed', async () => {
    const p = await payload()
    const ids = p.ratedPosts!.byPlatform.flatMap((x) => x.posts.map((post) => post.postId))
    expect(ids).toHaveLength(3)
    const html = body(p, 'en')
    expect(text(html)).not.toContain('Post removed')
    for (const id of ids) {
      const c = FIXTURE_LABELS_A.posts[id]
      expect(html).toContain('/en/analytics/posts?month=2026-03&amp;platform=' + c.platform + '&amp;campaign=' + c.campaignId)
    }
  })

  it('a deleted cited post renders "Post removed" in en, pt and es, and keeps its stored rate', async () => {
    const p = await payload()
    const gone: ReportLabels = { ...FIXTURE_LABELS_A, posts: {} }
    for (const locale of LOCALES) {
      const t = text(body(p, locale, { labels: gone }))
      expect(t.split(FILES[locale].report.post.removed).length - 1).toBe(3)
    }
    expect(text(body(p, 'en', { labels: gone }))).toMatch(/engagement rate \d+\.\d%/)
  })

  it('the PDF HTML (plain render) says "Post removed" for a gone post, and has no link for a resolved one', async () => {
    const p = await payload()
    const gone = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: p, proAllowed: true, businessName: FIXTURE_NAME_A, labels: { ...NO_LABELS } })
    expect(gone.split('Post removed').length - 1).toBe(3)
    const resolved = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: p, proAllowed: true, businessName: FIXTURE_NAME_A, labels: FIXTURE_LABELS_A })
    expect(resolved).not.toContain('Post removed')
    expect(resolved).not.toContain('/analytics/posts?month=')
  })
})
