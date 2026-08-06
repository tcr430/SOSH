import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/config'
import { runSignalsTick } from '@/lib/signals/orchestrator'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ADR 0020 §4.1 — reuses capture-learning's exact shape (Reality §2): no new
// scheduling machinery. Identical to app/api/cron/capture-learning/route.ts,
// swapping only the orchestrator invoked.
async function signalsPollTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'signals-poll',
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
      console.warn(JSON.stringify({ kind: 'cron-auth-failure', route: 'signals-poll', trigger: 'secret', reason: 'bearer-invalid' }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  let signals
  try {
    signals = await runSignalsTick({ triggeredBy })
  } catch (err) {
    signals = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // Always 200 — non-2xx triggers a retry we don't want (the orchestrator
  // owns its own claim/retry state machine, same posture as publish and
  // capture-learning).
  return NextResponse.json({ signals })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return signalsPollTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return signalsPollTick(request)
}
