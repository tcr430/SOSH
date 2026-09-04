import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCookieStore = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(mockCookieStore) }))

import {
  generatePkceVerifier,
  generatePkceChallenge,
  setPkceVerifierCookie,
  readAndClearPkceVerifierCookie,
} from './pkce'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generatePkceVerifier / generatePkceChallenge', () => {
  it('the verifier is 43 chars of unreserved base64url characters (RFC 7636 §4.1 minimum length)', () => {
    const verifier = generatePkceVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  })

  it('two calls produce different verifiers', () => {
    expect(generatePkceVerifier()).not.toBe(generatePkceVerifier())
  })

  it('the S256 challenge is deterministic for a given verifier and differs from the verifier itself', async () => {
    const verifier = 'fixed-test-verifier-value-for-deterministic-check'
    const c1 = await generatePkceChallenge(verifier)
    const c2 = await generatePkceChallenge(verifier)
    expect(c1).toBe(c2)
    expect(c1).not.toBe(verifier)
  })
})

describe('SOCIAL-PKCE-COOKIE (ADR 0028 §2.3)', () => {
  it('sets the verifier cookie httpOnly, Secure, SameSite=Lax, path-scoped, 600s', async () => {
    await setPkceVerifierCookie('verifier-abc')
    expect(mockCookieStore.set).toHaveBeenCalledWith('sosh_pkce_verifier', 'verifier-abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/social',
      maxAge: 600,
    })
  })

  it('reading the verifier clears the cookie on the SUCCESS path', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'verifier-abc' })
    const verifier = await readAndClearPkceVerifierCookie()
    expect(verifier).toBe('verifier-abc')
    expect(mockCookieStore.delete).toHaveBeenCalledWith('sosh_pkce_verifier')
  })

  it('reading the verifier clears the cookie on the FAILURE path too (no verifier present)', async () => {
    mockCookieStore.get.mockReturnValue(undefined)
    const verifier = await readAndClearPkceVerifierCookie()
    expect(verifier).toBeNull()
    expect(mockCookieStore.delete).toHaveBeenCalledWith('sosh_pkce_verifier')
  })
})
