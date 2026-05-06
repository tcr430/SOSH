import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getRegistry } from '@/lib/social'

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}

const PLATFORM_COUNT = 5 // linkedin, twitter, instagram, facebook, threads

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

  let providerName: string
  let status: 'ok' | 'error'

  try {
    getRegistry()

    try {
      const mode = config.server.SOCIAL_PROVIDER_MODE
      const postizUrl = config.server.POSTIZ_BASE_URL
      providerName = mode === 'mock' ? 'mock' : postizUrl ? 'postiz' : 'mock'
    } catch {
      providerName = 'unknown'
    }

    status = 'ok'
  } catch {
    providerName = 'unknown'
    status = 'error'
  }

  return NextResponse.json({
    provider: providerName,
    status,
    platform_count: PLATFORM_COUNT,
    env: config.public.NODE_ENV,
  })
}
