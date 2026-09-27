import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { sweepInterviewData } from '@/lib/db/founder-interview-rounds'
import type { SweepInterviewDataResult } from '@/lib/db/types'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ADR 0029 §5.4 (Session 35 M2.9) — the daily interview retention sweep: stuck-round failure, expiry,
// answer/span redaction, retired-candidate deletion (§6.3). Retention must not depend on the founder
// returning, so it cannot be on-read — this is its own cron route, dual-auth exactly as
// app/api/cron/extract-outcomes/route.ts (copied, not shared, per that route's own precedent). NO model
// call: sweep_interview_data is a pure retention RPC.
async function interviewSweepTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'interview-sweep',
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
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'interview-sweep', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  const startedAt = Date.now()
  // null = the sweep threw before it could report; never fabricate a zero (the extract-outcomes MINOR-2
  // precedent) — an unknown count is honestly unknown, not "nothing was due."
  let swept: SweepInterviewDataResult | null = null
  try {
    swept = await sweepInterviewData()
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'interview-sweep', phase: 'route' } })
  }

  // The ONE canonical structured-JSON line (CLAUDE.md worker carve-out).
  console.log(JSON.stringify({
    kind: 'interview.sweep.tick',
    triggeredBy,
    tick: formatISO(new Date()),
    durationMs: Date.now() - startedAt,
    failedStuck: swept?.failedStuck ?? null,
    expired: swept?.expired ?? null,
    candidatesRetired: swept?.candidatesRetired ?? null,
    answersRedacted: swept?.answersRedacted ?? null,
    spansRedacted: swept?.spansRedacted ?? null,
    candidatesDeleted: swept?.candidatesDeleted ?? null,
    errors: swept === null ? 1 : 0,
  }))

  // Always 200 — the sweep is idempotent and re-runs safely tomorrow; a non-2xx would only retrigger it.
  return NextResponse.json({ swept })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return interviewSweepTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return interviewSweepTick(request)
}
