import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCookieStore = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(mockCookieStore) }))

import {
  setPkceVerifierCookie,
  readAndClearPkceVerifierCookie,
} from './pkce'

beforeEach(() => {
  vi.clearAllMocks()
})

// generatePkceVerifier/generatePkceChallenge moved to ./pkce-crypto.test.ts
// (Vercel build fix, 2026-09-06) — see pkce.ts's header comment for why.

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
