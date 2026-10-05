import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { runReportJob, type ReportJobSummary } from '@/lib/reports/job'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ADR 0031 §5.2, §5.4 — the generate-reports tick: hourly at :20, AFTER extract-outcomes (the report reads the outcomes that
// worker writes). Dual-mode auth copied from extract-outcomes: a QStash-signed POST, or the bearer-secret GET.
async function generateReportsTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'generate-reports',
        trigger: 'qstash',
        reason: e instanceof QStashAuthError ? e.reason : 'unknown',
      }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  } else {
    const isProd = config.public.NODE_ENV === 'production'
    const authHeader = request.headers.get('authorization') ?? ''
    const devTrigger = request.headers.get('x-cron-dev-trigger') === 'true'

    let authorised = false
    if (isProd) {
      const expected = `Bearer ${config.server.CRON_SECRET}`
      const a = Buffer.from(authHeader)
      const b = Buffer.from(expected)
      if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
    } else {
      const secret = config.server.CRON_SECRET ?? ''
      if (secret) {
        const expected = `Bearer ${secret}`
        const a = Buffer.from(authHeader)
        const b = Buffer.from(expected)
        if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
      }
      if (devTrigger) authorised = true
    }

    if (!authorised) {
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'generate-reports', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  const startedAt = Date.now()
  // null = the job threw before it could report: the counters it reached are UNKNOWN, never zero.
  let report: ReportJobSummary | null = null
  try {
    report = await runReportJob()
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'generate-reports', phase: 'route' } })
  }

  // The ONE canonical structured-JSON line (CLAUDE.md worker carve-out): counts only, picked by name so nothing else can
  // leak in (no business id, no member, no address, no report text). A job that threw reports `null` counters and
  // errors: 1, never a fabricated 0 that would say "nothing was due".
  console.log(JSON.stringify({
    kind: 'report.tick',
    triggeredBy,
    tick: report?.tick ?? formatISO(new Date()),
    durationMs: Date.now() - startedAt,
    scanned: report?.scanned ?? null,
    notDue: report?.notDue ?? null,
    ineligible: report?.ineligible ?? null,
    exists: report?.exists ?? null,
    inserted: report?.inserted ?? null,
    stubs: report?.stubs ?? null,
    raced: report?.raced ?? null,
    capped: report?.capped ?? null,
    emailsEnqueued: report?.emails.enqueued ?? null,
    emailsDeduped: report?.emails.deduped ?? null,
    emailsSuppressed: report?.emails.suppressed ?? null,
    emailErrors: report?.emails.errors ?? null,
    errors: report ? report.errors : 1,
  }))

  // Always 200 — the job is idempotent and owns its own error accounting; a non-2xx would only retrigger it.
  return NextResponse.json({ ok: report !== null })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return generateReportsTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return generateReportsTick(request)
}
