import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { runPublishTick, runJanitorTick } from '@/lib/publishing/orchestrator'
import { reapStuckScheduledPosts } from '@/lib/db/posts'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Pro. Hobby: change to 30.

async function publishTick(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(JSON.stringify({
        kind: 'cron-auth-failure',
        route: 'publish',
        trigger: 'qstash',
        reason: e instanceof QStashAuthError ? e.reason : 'unknown',
      }))
      return new NextResponse('Unauthorized', { status: 401 })
    }
  } else {
    // ── Auth ──────────────────────────────────────────────────
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
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // ── Phase A (janitor + reaper before claim) ───────────────
  const triggeredBy = config.server.CRON_TRIGGER
  const now = new Date()
  const tick = formatISO(now)

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  let janitor, reaped = 0
  try {
    janitor = await runJanitorTick({ now, triggeredBy })
  } catch (err) {
    janitor = {
      tick, durationMs: 0,
      stuckGenerationSessionsReaped: 0,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }

  try {
    reaped = await reapStuckScheduledPosts(client, {
      now,
      stuckMinutes: config.server.PUBLISH_STUCK_MINUTES,
    })
  } catch (err) {
    console.error('reaper error', err instanceof Error ? err.message : err)
  }

  // ── Phase B (publish) ─────────────────────────────────────
  let publish
  try {
    publish = await runPublishTick({ now, batchSize: config.server.PUBLISH_BATCH_SIZE, reaped, triggeredBy })
  } catch (err) {
    publish = {
      tick, durationMs: 0,
      claimed: 0, published: 0, failed: 0, retried: 0,
      refreshed: 0, reaped,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }

  // Always 200 — non-2xx triggers Vercel retry which we don't want
  return NextResponse.json({ tick, janitor, publish })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return publishTick(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new NextResponse('Method Not Allowed', { status: 405 })
  }
  return publishTick(request)
}
