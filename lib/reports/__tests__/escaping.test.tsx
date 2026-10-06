// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render as renderEmail } from '@react-email/render'

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import { makeTranslator, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { makeTranslator as makeEmailTranslator } from '@/lib/email/templates/__tests__/helpers'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport, type ReportPayload } from '../assemble'
import type { ReportLabels } from '@/lib/analytics/labels'
import { fixtureReaders, fixturePatternRow, FIXTURE_LABELS_A } from '../__fixtures__/readers'
import { ReportBody } from '@/components/analytics/ReportBody'
import { MonthlyReportEmail, monthlyReportSubject } from '@/lib/email/templates/monthly-report'
import type { T } from '@/components/analytics/shared'
import { PDF_CSP, buildReportHtml, escapeHtml } from '../pdf-html'
import { compileReportCss, extractBlock, extractClasses } from '../pdf-css'

// ADR 0031 §9.7-ish, REPORT-OUTPUT-ESCAPING (#29), Tier 2 — every customer string is inert in ALL the sinks: the report page,
// the email body, the email subject and the PDF document. The hostile value carries markup, an event handler and a header
// injection: "<script>…</script>\r\nBcc: x@y". The three sinks are rendered through the REAL components.

const HOSTILE = '<script>alert(1)</script>\r\nBcc: x@y <img src=x onerror=alert(2)>'
const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}

async function hostilePayload(): Promise<ReportPayload> {
  const base = (
    await assembleReport({
      readers: fixtureReaders({ patterns: [fixturePatternRow()] }),
      businessId: BUSINESS_A_ID,
      period: '2026-03',
      now: MARCH_REPORT_OUTCOMES_THROUGH,
    })
  ).payload
  return base
}

// Customer strings no longer live in the payload (MINOR-7): the hostile business name, campaign names and account labels enter
// ReportBody where they now arrive, as props resolved at read time. Pattern text is gone altogether: a stored pattern is a cell.
const HOSTILE_LABELS: ReportLabels = {
  campaigns: Object.fromEntries(Object.keys(FIXTURE_LABELS_A.campaigns).map((id) => [id, HOSTILE])),
  accounts: Object.fromEntries(Object.keys(FIXTURE_LABELS_A.accounts).map((id) => [id, HOSTILE])),
}

// Inert means: no LIVE tag. Escaped text may contain the characters "onerror=" (it is text); a tag may not carry one. The email
// layout owns a logo <img>, so only the hostile image (src=x) is looked for there; the page and the PDF have no <img> at all.
const noLiveMarkup = (html: string, { layoutImage = false }: { layoutImage?: boolean } = {}) => {
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toMatch(/<\/script/i)
  expect(html).not.toMatch(/<[^>]*\son(error|load|click)\s*=/i)
  expect(html).not.toMatch(/<img[^>]*\ssrc=["']?x["'\s>]/i)
  if (!layoutImage) expect(html).not.toMatch(/<img/i)
}

describe('sink 1: the report page (ReportBody)', () => {
  it('the hostile business name, campaign names and account labels are escaped text, never markup', async () => {
    const html = renderToStaticMarkup(<ReportBody t={tFor('en')} locale="en" timezone="Europe/Lisbon" payload={await hostilePayload()} proAllowed={true} businessName={HOSTILE} labels={HOSTILE_LABELS} />)
    noLiveMarkup(html)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('the same holds with the plain (PDF) render and on a plan without Pro', async () => {
    const p = await hostilePayload()
    noLiveMarkup(renderToStaticMarkup(<ReportBody t={tFor('pt')} locale="pt" timezone="Europe/Lisbon" payload={p} proAllowed={false} plain businessName={HOSTILE} labels={HOSTILE_LABELS} />))
  })
})

describe('sinks 2 and 3: the email body and the email subject', () => {
  it('a hostile business name is escaped in the body, in html and in plain text, in all three locales', async () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const el = React.createElement(MonthlyReportEmail, { locale, t: makeEmailTranslator(locale), businessName: HOSTILE, periodLabel: 'March 2026', summaryLines: ['12 posts published, 9 the month before.'], reportUrl: 'https://app.example.test/en/analytics/reports/2026-03' })
      const html = await renderEmail(el)
      noLiveMarkup(html, { layoutImage: true })
      expect(html).toContain('&lt;script&gt;')
    }
  })

  it('the subject is built from a template key and the month ONLY: no customer string can reach it, and CR/LF never survive', () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const subject = monthlyReportSubject(makeEmailTranslator(locale), { businessName: HOSTILE, periodLabel: 'March 2026', summaryLines: [], reportUrl: 'https://app.example.test/x' })
      expect(subject).not.toContain('script')
      expect(subject).not.toContain('Bcc')
      expect(subject).not.toMatch(/[\r\n]/)
    }
  })

  it('and when the month label itself is hostile, every line break is stripped from the subject', () => {
    const subject = monthlyReportSubject(makeEmailTranslator('en'), { businessName: 'Acme', periodLabel: 'March\r\nBcc: x@y', summaryLines: [], reportUrl: 'https://app.example.test/x' })
    expect(subject).not.toMatch(/[\r\n]/)
  })
})

describe('sink 4: the PDF document', () => {
  it('has no script, image, link, iframe, base or form element, and no event handler, whatever the customer strings hold', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    noLiveMarkup(html)
    expect(html).not.toMatch(/<(link|iframe|object|embed|base|form|a)[\s>]/i)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('is a sealed document: exactly one CSP meta (the ADR text, verbatim), exactly one style element, no external reference', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    expect(PDF_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:")
    expect(html.match(/<meta http-equiv="Content-Security-Policy"/g)).toHaveLength(1)
    expect(html).toContain(`content="${PDF_CSP}"`)
    expect(html.match(/<style>/g)).toHaveLength(1)
    expect(html).not.toMatch(/(src|href|action|poster|data)=["']?https?:/i)
    expect(html).not.toMatch(/url\(\s*["']?https?:/i)
    expect(html).not.toMatch(/@import/i)
  })

  it('carries the stylesheet inline and it is the page\'s: the tokens and the print rules are in it', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]
    expect(css.length).toBeGreaterThan(2000)
    // `@theme inline` resolves the alias, so the utilities reference the page's own variables, which the :root block defines.
    expect(css).toMatch(/--muted-foreground:/)
    expect(css).toMatch(/var\(--muted-foreground\)/)
    expect(css).toMatch(/--border:/)
    expect(css).toContain('text-sm')
    expect(css).toMatch(/@media print/)
    expect(css).toMatch(/break-before:\s*page/)
    expect(css).toContain('@page')
    expect(css).not.toMatch(/<\/|<!--/)
  })

  it('an unknown locale falls back to en in the lang attribute (it is never written unchecked)', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: '"><script>x</script>', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    expect(html).toContain('<html lang="en">')
    noLiveMarkup(html)
  })

  it('the title is a translated key, HTML-escaped', async () => {
    const t: T = (key) => (key === 'analytics.report.title' ? '<b>"x"</b>' : tFor('en')(key))
    const html = await buildReportHtml({ t, locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    expect(html).toContain('<title>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</title>')
  })

  it('the plain render invokes no client-boundary component (it renders with no link element at all)', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: false, businessName: HOSTILE, labels: HOSTILE_LABELS })
    expect(html).not.toMatch(/<a[\s>]/)
    expect(html).toContain('Available on Pro:')
  })
})

describe('the helpers cannot be turned against the document', () => {
  it('escapeHtml escapes the five characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('extractClasses reads only real class attributes: escaped customer text cannot form one', () => {
    // React escapes a quote in text as &quot;, so customer text can never close or open an attribute.
    const html = '<p class="text-sm font-medium">x</p><p>class=&quot;evil&quot; and &lt;p class=&quot;inj&quot;&gt;</p>'
    expect(extractClasses(html)).toEqual(['text-sm', 'font-medium'])
  })

  it('extractClasses decodes the "&amp;" React writes into a class attribute, so arbitrary variants reach the compiler as written', () => {
    expect(extractClasses('<article class="[&amp;_section]:border-t print:[&amp;_tr]:break-inside-avoid">')).toEqual(['[&_section]:border-t', 'print:[&_tr]:break-inside-avoid'])
  })

  it('the PDF stylesheet really contains the report\'s arbitrary-variant rules (section hairlines, print breaks): they are not silently dropped', async () => {
    const html = await buildReportHtml({ t: tFor('en'), locale: 'en', timezone: 'Europe/Lisbon', payload: await hostilePayload(), proAllowed: true, businessName: HOSTILE, labels: HOSTILE_LABELS })
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]
    expect(css).toMatch(/section[\s\S]{0,80}border-top-style|section[\s\S]{0,80}border-top-width/)
    expect(css).toMatch(/@media print[\s\S]*break-inside:\s*avoid/)
    expect(css).toMatch(/break-after:\s*avoid/)
  })

  it('extractClasses drops a token that carries markup characters', () => {
    expect(extractClasses('<p class="ok <b>no</b>">')).toEqual(['ok'])
  })

  it('extractBlock returns a balanced block, and nothing when the header is absent', () => {
    expect(extractBlock('a{} :root { --x: 1; .n { y: 2 } } b{}', ':root')).toBe(':root { --x: 1; .n { y: 2 } }')
    expect(extractBlock('a{}', ':root')).toBe('')
  })

  it('a candidate that would put a closing tag into the stylesheet is dropped BEFORE the compiler (extractClasses)', () => {
    const html = '<p class="text-sm content-[&quot;&lt;/style&gt;&quot;]">a</p><p class="x content-[\'</style>\']">b</p>'
    for (const token of extractClasses(html)) expect(token).not.toMatch(/[<>"'`\\]/)
  })

  it('one request\'s classes never leak into the next request\'s stylesheet (the compiler is fresh per request)', async () => {
    const first = await compileReportCss(['text-lg', 'font-bold'])
    const second = await compileReportCss(['text-sm'])
    expect(first).toContain('.text-lg')
    expect(second).toContain('.text-sm')
    expect(second).not.toContain('.text-lg')
    expect(second).not.toContain('.font-bold')
  })

  it('and, as a second layer, the compiler REFUSES output that is not safe inside a style element', async () => {
    // Fed directly (bypassing extractClasses), the hostile candidate makes tailwind emit "</style>": the guard throws.
    await expect(compileReportCss(['text-sm', 'content-["</style><script>x</script>"]'])).rejects.toThrow('not safe to inline')
    // And the failure is not cached: a clean request still compiles.
    await expect(compileReportCss(['text-sm'])).resolves.toContain('text-sm')
  })
})
