import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// O-1 (ADR 0031 V.1 item 1) — proxy.ts sent every /api/* request through
// next-intl, which 307-redirects it to /{locale}/api/* (a 404). /api must skip
// locale routing, the login guard and the CSP, but still refresh the session.

const { i18n, updateSession } = vi.hoisted(() => ({
  i18n: vi.fn(),
  updateSession: vi.fn(),
}))

vi.mock('next-intl/middleware', () => ({ default: () => i18n }))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: (req: NextRequest) => updateSession(req),
}))
vi.mock('@/lib/config', () => ({
  config: { public: { SENTRY_DSN: undefined }, server: { CSP_ENFORCE: false } },
}))

import { proxy } from '../../proxy'

function refreshed() {
  const response = NextResponse.next()
  response.cookies.set('sb-access-token', 'fresh')
  return { response, user: null }
}

beforeEach(() => {
  i18n.mockReset()
  i18n.mockImplementation((req: NextRequest) =>
    NextResponse.redirect(new URL(`/en${req.nextUrl.pathname}`, req.url)),
  )
  updateSession.mockReset()
  updateSession.mockImplementation(async () => refreshed())
})

describe('proxy passes /api through without locale routing (O-1)', () => {
  it.each([
    '/api/cron/generate-reports',
    '/api/billing/webhook',
    '/api/social/linkedin/callback',
    '/api/analytics/reports/2026-09/pdf',
    '/api',
  ])('%s is not redirected and does not reach next-intl', async (path) => {
    const res = await proxy(new NextRequest(`http://localhost:3000${path}`))
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
    expect(i18n).not.toHaveBeenCalled()
  })

  it('still refreshes the session and returns its cookies', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/api/analytics/reports/x/pdf'))
    expect(updateSession).toHaveBeenCalledTimes(1)
    expect(res.cookies.get('sb-access-token')?.value).toBe('fresh')
  })

  it('does not add a CSP or a nonce to an API response', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/api/cron/generate-reports'))
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(res.headers.get('content-security-policy-report-only')).toBeNull()
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull()
  })

  it('does not treat /apix/foo as the API', async () => {
    await proxy(new NextRequest('http://localhost:3000/apix/foo'))
    expect(i18n).toHaveBeenCalled()
  })

  it('does not treat a locale-prefixed /en/api/foo as the API (it is a page path, guarded)', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/en/api/foo'))
    expect(res.headers.get('location')).toContain('/en/login')
  })
})

describe('page routing is unchanged', () => {
  it('still locale-redirects a bare page path', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/pricing'))
    expect(res.headers.get('location')).toContain('/en/pricing')
    expect(i18n).toHaveBeenCalled()
  })

  it('still sends an unauthenticated dashboard request to login', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/en/analytics'))
    expect(res.headers.get('location')).toContain('/en/login')
  })
})
