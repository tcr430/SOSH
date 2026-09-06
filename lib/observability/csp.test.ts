import { describe, it, expect } from 'vitest'
import { buildCsp } from './csp'

const NONCE = 'abc123'
const REPORT_URI = 'https://sentry.example.io/api/123/security/?sentry_key=pub'

describe('buildCsp — header name', () => {
  it('returns Content-Security-Policy when enforce is true', () => {
    const { headerName } = buildCsp(NONCE, REPORT_URI, true)
    expect(headerName).toBe('Content-Security-Policy')
  })

  it('returns Content-Security-Policy-Report-Only when enforce is false', () => {
    const { headerName } = buildCsp(NONCE, REPORT_URI, false)
    expect(headerName).toBe('Content-Security-Policy-Report-Only')
  })
})

describe('buildCsp — script-src', () => {
  it('contains exactly the required script-src tokens', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    const scriptSrc = headerValue.match(/script-src ([^;]+)/)?.[1] ?? ''
    const tokens = scriptSrc.trim().split(/\s+/)
    expect(tokens).toContain("'self'")
    expect(tokens).toContain(`'nonce-${NONCE}'`)
    expect(tokens).toContain("'strict-dynamic'")
    expect(tokens).toContain('https://js.stripe.com')
    expect(tokens).toContain('https://va.vercel-scripts.com')
    expect(tokens).toHaveLength(5)
  })

  it('does not contain unsafe-inline in script-src', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    const scriptSrc = headerValue.match(/script-src ([^;]+)/)?.[1] ?? ''
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/)
  })
})

describe('buildCsp — connect-src', () => {
  it('contains the seven required connect-src entries', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    const connectSrc = headerValue.match(/connect-src ([^;]+)/)?.[1] ?? ''
    expect(connectSrc).toContain("'self'")
    expect(connectSrc).toContain('https://*.supabase.co')
    expect(connectSrc).toContain('wss://*.supabase.co')
    expect(connectSrc).toContain('https://api.stripe.com')
    expect(connectSrc).toContain('https://*.sentry.io')
    expect(connectSrc).toContain('https://*.ingest.sentry.io')
    expect(connectSrc).toContain('https://*.vercel-insights.com')
    expect(connectSrc).toContain('https://vitals.vercel-insights.com')
  })

  // SOCIAL-CSP-NO-POSTIZ-HOST (ADR 0028 §8.3, N2.11). buildCsp no longer
  // takes a postizHost parameter at all — native provider calls are
  // server-side only, so there is no browser-facing origin to add. Asserts
  // the SECOND half explicitly: connect-src's other seven entries survive
  // the removal unchanged. A CSP "cleanup" that quietly drops a real
  // origin (not just the Postiz one) would be a regression, not a cleanup.
  it('SOCIAL-CSP-NO-POSTIZ-HOST: connect-src carries exactly the seven remaining entries, no postiz host, nothing else dropped', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    const connectSrc = headerValue.match(/connect-src ([^;]+)/)?.[1] ?? ''
    const tokens = connectSrc.trim().split(/\s+/)
    expect(tokens).toEqual([
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://api.stripe.com',
      'https://*.sentry.io',
      'https://*.ingest.sentry.io',
      'https://*.vercel-insights.com',
      'https://vitals.vercel-insights.com',
    ])
    expect(connectSrc).not.toContain('postiz')
  })
})

describe('buildCsp — report-uri', () => {
  it('includes report-uri directive when reportUri is non-null', () => {
    const { headerValue } = buildCsp(NONCE, REPORT_URI, false)
    expect(headerValue).toContain(`report-uri ${REPORT_URI}`)
  })

  it('omits report-uri directive when reportUri is null', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    expect(headerValue).not.toContain('report-uri')
  })
})

describe('buildCsp — safety assertions', () => {
  it('does not contain unsafe-eval anywhere', () => {
    const { headerValue } = buildCsp(NONCE, REPORT_URI, true)
    expect(headerValue).not.toContain("'unsafe-eval'")
  })

  it('contains upgrade-insecure-requests', () => {
    const { headerValue } = buildCsp(NONCE, null, false)
    expect(headerValue).toContain('upgrade-insecure-requests')
  })
})
