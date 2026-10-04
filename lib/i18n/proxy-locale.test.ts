import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// QA-LOCALE-HEADER-DROPPED — proxy.ts builds its final response from cloned
// request headers; next-intl's locale header must survive on the forwarded
// request, or every page renders the default locale.

// next-intl's middleware cannot resolve `next/server` under vitest; a no-op
// stand-in is enough because the property under test is what proxy.ts itself
// forwards, not next-intl's detection.
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => ({ response: NextResponse.next(), user: { id: 'u1' } }),
}))
vi.mock('@/lib/config', () => ({
  config: { public: { SENTRY_DSN: undefined }, server: { CSP_ENFORCE: false } },
}))

import { proxy } from '../../proxy'

async function forwardedLocale(path: string): Promise<string | null> {
  const res = await proxy(new NextRequest(`http://localhost:3000${path}`))
  // NextResponse.next({ request: { headers } }) exposes the forwarded request
  // headers as x-middleware-request-* on the response.
  return res.headers.get('x-middleware-request-x-next-intl-locale')
}

describe('proxy forwards the resolved locale to the render layer', () => {
  it.each(['en', 'pt', 'es'])('forwards %s for its /login path', async (locale) => {
    expect(await forwardedLocale(`/${locale}/login`)).toBe(locale)
  })
})
