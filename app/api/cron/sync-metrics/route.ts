import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { runMetricsSyncTick } from '@/lib/metrics/orchestrator'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const now = new Date()
  let metrics
  try {
    metrics = await runMetricsSyncTick({ now })
  } catch (err) {
    metrics = {
      tick: formatISO(now),
      durationMs: 0,
      candidates: 0,
      synced: 0,
      skippedNotImplemented: 0,
      skippedNoData: 0,
      skippedNoAccount: 0,
      errors: 0,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }

  return NextResponse.json({ metrics })
}
