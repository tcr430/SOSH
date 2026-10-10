import { createElement } from 'react'
import { ReportBody } from '@/components/analytics/ReportBody'
import type { ReportLabels } from '@/lib/analytics/labels'
import type { T } from '@/components/analytics/shared'
import type { ReportPayload } from './assemble'
import { compileReportCss, extractClasses } from './pdf-css'

// ADR 0031 §5.5 — the PDF's document: the SAME ReportBody the page renders, rendered to static markup, with the compiled CSS
// inlined and a Content-Security-Policy meta that denies everything but inline style and data: images and fonts. There is no
// script, no link and no external reference in the document: the CSP and the request interception (lib/reports/pdf.ts) are
// two further layers, not the only one.
//
// Customer strings (business name, campaign names, patterns) are escaped by React inside ReportBody; the only strings this
// file writes into the document itself are the closed CSP, the locale (checked against the three it can be) and the page
// title (a translated key, HTML-escaped here).

/** The CSP of ADR 0031 §5.5, verbatim. */
export const PDF_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

const LOCALES = ['en', 'pt', 'es'] as const
type Locale = (typeof LOCALES)[number]

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface ReportHtmlInput {
  t: T
  locale: string
  timezone: string
  payload: ReportPayload
  /** The CURRENT plan's gate (A-5): the PDF shows a Pro section only while the plan allows it, exactly as the page does. */
  proAllowed: boolean
  /** The business's current name and the resolved campaign / account labels: the stored payload holds ids only (D2). */
  businessName: string
  labels: ReportLabels
}

export async function buildReportHtml(input: ReportHtmlInput): Promise<string> {
  const locale: Locale = (LOCALES as readonly string[]).includes(input.locale) ? (input.locale as Locale) : 'en'
  // The route's React copy and react-dom/server's are different modules: a static import fails to compile under Turbopack
  // (ADR 0031 V.3), a dynamic one works. ReportBody is synchronous and hook-free, so the two copies never meet in a hook.
  const { renderToStaticMarkup } = await import('react-dom/server')
  const body = renderToStaticMarkup(createElement(ReportBody, { ...input, locale, plain: true }))
  const css = await compileReportCss(extractClasses(body))
  const title = escapeHtml(input.t('analytics.report.title'))
  return [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PDF_CSP}">`,
    `<title>${title}</title>`,
    `<style>${css}</style>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
  ].join('')
}
