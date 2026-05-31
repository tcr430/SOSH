import { describe, it, expect } from 'vitest'
import { STATIC_SECURITY_HEADERS } from './security-headers'

describe('STATIC_SECURITY_HEADERS', () => {
  it('contains exactly seven headers', () => {
    expect(STATIC_SECURITY_HEADERS).toHaveLength(7)
  })

  it('HSTS value is exactly max-age=63072000; includeSubDomains — no preload', () => {
    const hsts = STATIC_SECURITY_HEADERS.find((h) => h.key === 'Strict-Transport-Security')
    expect(hsts?.value).toBe('max-age=63072000; includeSubDomains')
    expect(hsts?.value).not.toContain('preload')
  })

  it('includes X-Content-Type-Options: nosniff', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'X-Content-Type-Options')
    expect(h?.value).toBe('nosniff')
  })

  it('includes X-Frame-Options: DENY', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'X-Frame-Options')
    expect(h?.value).toBe('DENY')
  })

  it('includes Referrer-Policy', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'Referrer-Policy')
    expect(h?.value).toBe('strict-origin-when-cross-origin')
  })

  it('includes Permissions-Policy', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'Permissions-Policy')
    expect(h).toBeDefined()
    expect(h?.value).toContain('camera=()')
    expect(h?.value).toContain('payment=(self')
  })

  it('includes Cross-Origin-Opener-Policy: same-origin', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'Cross-Origin-Opener-Policy')
    expect(h?.value).toBe('same-origin')
  })

  it('includes Cross-Origin-Resource-Policy: same-site', () => {
    const h = STATIC_SECURITY_HEADERS.find((h) => h.key === 'Cross-Origin-Resource-Policy')
    expect(h?.value).toBe('same-site')
  })
})
