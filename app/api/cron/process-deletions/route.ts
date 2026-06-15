import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/config'
import { runDeletionTick } from '@/lib/deletion/orchestrator'
import { verifyQStashRequest, QStashAuthError } from '@/lib/cron/qstash-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function deletionTick(request: NextRequest): Promise<Response> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    try {
      await verifyQStashRequest(request)
    } catch (e) {
      console.warn(
        JSON.stringify({
          kind: 'cron-auth-failure',
          route: 'process-deletions',
          trigger: 'qstash',
          reason: e instanceof QStashAuthError ? e.reason : 'unknown',
        }),
      )
      return new Response('Unauthorized', { status: 401 })
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
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const triggeredBy = config.server.CRON_TRIGGER
  const summary = await runDeletionTick({ triggeredBy })
  return NextResponse.json({ ok: true, ...summary })
}

export async function GET(request: NextRequest): Promise<Response> {
  if (config.server.CRON_TRIGGER === 'qstash') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return deletionTick(request)
}

export async function POST(request: NextRequest): Promise<Response> {
  if (config.server.CRON_TRIGGER !== 'qstash') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return deletionTick(request)
}
