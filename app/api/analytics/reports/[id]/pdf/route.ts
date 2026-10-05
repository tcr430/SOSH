import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getReportById } from '@/lib/db/analytics-reports'
import { hasAdvancedAnalytics } from '@/lib/stripe/plan'
import { REPORT_SCHEMA_VERSION } from '@/lib/reports/constants'
import type { ReportPayload } from '@/lib/reports/assemble'
import { buildReportHtml } from '@/lib/reports/pdf-html'
import { launchChromium } from '@/lib/reports/pdf-launch'
import { PdfBusyError, PdfTimeoutError, pdfQueueFull, renderPdf } from '@/lib/reports/pdf'
import type { T } from '@/components/analytics/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ADR 0031 §5.5, §9.5, REPORT-PDF-ISOLATED (#30), ANALYTICS-PLAN-GATE-SERVER (#14, third arm), REPORT-OUTPUT-ESCAPING (#29).
// GET /api/analytics/reports/[id]/pdf — the stored report as a PDF, generated on demand and NEVER stored.
//
// ORDER (it is the security argument; every line before the launch can end the request):
//   1. the id is a Zod uuid (anything else is a 404);
//   2. authenticate (no session: 401);
//   3. resolve the SERVER-SIDE active business (never a parameter);
//   4. load the report by (that business, the id): another business's id is a 404, indistinguishable from an unknown one;
//   5. a payload shape this build does not read is a 404 (never reinterpreted);
//   6. read the CURRENT plan (A-5): a Pro section is in the PDF only while the plan allows it, as on the page;
//   7. build the document (ReportBody, escaped by React, CSP meta, inlined CSS): still no browser;
//   8. ONLY THEN launch Chromium, sealed (lib/reports/pdf.ts).
// No path, query, header or cookie is ever handed to the browser: the document is a string.

type Ctx = { params: Promise<{ id: string }> }

const ID = z.string().uuid()
const PERIOD_MONTH = /^(\d{4}-(?:0[1-9]|1[0-2]))-01$/

const notFound = () => new NextResponse('Not Found', { status: 404 })

export async function GET(_request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const parsed = ID.safeParse((await params).id)
  if (!parsed.success) return notFound()

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const business = await getBusinessForUser(client, user.id)
  if (!business) return notFound()

  const row = await getReportById(client, business.id, parsed.data)
  const period = row ? PERIOD_MONTH.exec(row.period_month)?.[1] : undefined
  if (!row || !period || row.schema_version !== REPORT_SCHEMA_VERSION) return notFound()

  const proAllowed = hasAdvancedAnalytics(business.plan)

  // A saturated instance answers before it builds the document or compiles any CSS (the work that precedes the queue).
  if (pdfQueueFull()) return new NextResponse('Busy', { status: 503, headers: { 'retry-after': '10' } })

  const translate = await getTranslations({ locale: business.language })
  const t: T = (key, values) => translate(key as never, values as never)
  const html = await buildReportHtml({
    t,
    locale: business.language,
    timezone: business.timezone,
    payload: row.payload as unknown as ReportPayload,
    proAllowed,
  })

  try {
    const { pdf } = await renderPdf(html, { launch: launchChromium })
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="report-${period}.pdf"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof PdfBusyError) return new NextResponse('Busy', { status: 503, headers: { 'retry-after': '10' } })
    if (error instanceof PdfTimeoutError) return new NextResponse('Timeout', { status: 504 })
    // No report content, id or business reaches the capture: only that a render failed.
    Sentry.captureException(error, { tags: { route: 'report-pdf' } })
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
