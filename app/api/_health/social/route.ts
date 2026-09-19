import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getRegistry, VALID_PLATFORMS } from '@/lib/social'

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

  // ADR 0028 §8.3 (N2.11) — no single app-wide "provider" name any more:
  // the registry is per-platform and overrides-only (§8.2), so absence is
  // per-platform too. Report each platform's actual resolved provider (or
  // 'not_configured' when get() would throw) rather than one broker label.
  let providers: Record<string, string>
  let status: 'ok' | 'error'

  try {
    const registry = getRegistry()

    providers = Object.fromEntries(
      VALID_PLATFORMS.map((platform) => {
        try {
          return [platform, registry.get(platform).platform]
        } catch {
          return [platform, 'not_configured']
        }
      }),
    )

    status = 'ok'
  } catch {
    providers = {}
    status = 'error'
  }

  return NextResponse.json({
    providers,
    status,
    platform_count: PLATFORM_COUNT,
    env: config.public.NODE_ENV,
  })
}
