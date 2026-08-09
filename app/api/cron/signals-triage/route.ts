import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/config'
import { runSignalsTriageTick } from '@/lib/signals/triage/orchestrator'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
// Next.js route segment config must be a literal, not an expression on an
// import (it is statically extracted at build time) — kept in step with
// lib/signals/triage/orchestrator.ts's TICK_MAX_DURATION_MS (300_000ms) by
// convention, not by reference.
export const maxDuration = 300

async function signalsTriageTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'signals-triage',
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
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'signals-triage', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  let triage
  try {
    triage = await runSignalsTriageTick({ triggeredBy })
  } catch (err) {
    triage = {
      businessesConsidered: 0, staleReclaimed: 0, triaged: 0, carded: 0, noCard: 0,
      ageGated: 0, triageFailed: 0, cappedBusinesses: 0, deadlineDeferred: 0,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }

  // Always 200 — non-2xx triggers a retry we don't want (the orchestrator
  // owns its own claim/reclaim state machine, same posture as
  // publish/capture-learning).
  return NextResponse.json({ triage })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return signalsTriageTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return signalsTriageTick(request)
}
