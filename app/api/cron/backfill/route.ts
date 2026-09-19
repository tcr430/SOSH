import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { runBackfillTick } from '@/lib/backfill/orchestrator'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

// ADR 0025 §6.6 (Session 32 I2.9) — the sync-metrics pattern, line for
// line: dual-mode auth (QStash signature verification, or a Bearer secret
// with a dev-trigger escape hatch outside production), maxDuration = 60.
// The every-minute QStash schedule itself is NOT created here (I2.9 point
// 4) — it is added to docs/launch-checklist.md at I2.15.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function backfillTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'backfill',
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
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'backfill', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const now = new Date()
  let tick
  try {
    tick = await runBackfillTick({ now })
  } catch (err) {
    tick = {
      tick: formatISO(now),
      durationMs: 0,
      runId: null,
      runStatus: null,
      outcome: 'idle' as const,
      errorCode: null,
      staleFailed: 0,
      stagingPurged: 0,
      stagedVoiceNulled: 0,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }

  return NextResponse.json({ tick })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return backfillTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return backfillTick(request)
}
