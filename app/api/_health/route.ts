import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getCronLastSeen } from '@/lib/db/cron-health'

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

const PUBLISH_STALE_MS = 5 * 60 * 1000
const METRICS_STALE_MS = 2 * 60 * 60 * 1000

function isStale(lastSeen: string | null, thresholdMs: number): boolean {
  if (lastSeen === null) return true
  return Date.now() - new Date(lastSeen).getTime() > thresholdMs
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const isDev = config.public.NODE_ENV === 'development'

  if (!isDev) {
    const token = request.headers.get('x-healthcheck-token')
    let expectedToken: string
    try {
      expectedToken = config.server.HEALTHCHECK_TOKEN
    } catch {
      return new NextResponse(null, { status: 404 })
    }
    if (!expectedToken || !token || !safeCompare(token, expectedToken)) {
      return new NextResponse(null, { status: 404 })
    }
  }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  let db: 'ok' | 'err' = 'ok'
  try {
    await Promise.race([
      client.from('cron_health').select('cron_slug').limit(1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db timeout')), 2000),
      ),
    ])
  } catch {
    db = 'err'
  }

  const [publishLastSeen, metricsLastSeen] = await Promise.all([
    getCronLastSeen(client, 'publish'),
    getCronLastSeen(client, 'metrics-sync'),
  ])

  return NextResponse.json({
    ts: new Date().toISOString(),
    db,
    cron: {
      publish: {
        lastSeen: publishLastSeen,
        stale: isStale(publishLastSeen, PUBLISH_STALE_MS),
      },
      metricsSync: {
        lastSeen: metricsLastSeen,
        stale: isStale(metricsLastSeen, METRICS_STALE_MS),
      },
    },
    sentry: {
      dsnConfigured: Boolean(config.public.SENTRY_DSN),
    },
  })
}
