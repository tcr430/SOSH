import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signOAuthState, verifyOAuthState } from '../oauth/state'

// Provide a valid OAUTH_STATE_SECRET for all tests in this file.
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      OAUTH_STATE_SECRET: 'test-secret-that-is-at-least-32-chars-long!',
    },
  },
}))

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips correctly: sign then verify yields the same claims', async () => {
    const token = await signOAuthState({
      businessId: 'biz-123',
      platform: 'linkedin',
      locale: 'en',
    })

    const claims = await verifyOAuthState(token)

    expect(claims.businessId).toBe('biz-123')
    expect(claims.platform).toBe('linkedin')
    expect(claims.locale).toBe('en')
    expect(typeof claims.nonce).toBe('string')
    expect(claims.nonce.length).toBeGreaterThan(0)
  })

  it('each call produces a different nonce', async () => {
    const t1 = await signOAuthState({ businessId: 'biz-1', platform: 'twitter', locale: 'en' })
    const t2 = await signOAuthState({ businessId: 'biz-1', platform: 'twitter', locale: 'en' })

    const c1 = await verifyOAuthState(t1)
    const c2 = await verifyOAuthState(t2)

    expect(c1.nonce).not.toBe(c2.nonce)
  })

  it('throws when verified with a different secret', async () => {
    const token = await signOAuthState({ businessId: 'biz-1', platform: 'instagram', locale: 'pt' })

    // Temporarily mock config to return a different secret
    const { config } = await import('@/lib/config')
    const original = config.server.OAUTH_STATE_SECRET
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: 'totally-different-secret-that-is-also-long-enough!!',
    }

    await expect(verifyOAuthState(token)).rejects.toThrow()

    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: original,
    }
  })

  it('throws on a tampered payload', async () => {
    const token = await signOAuthState({ businessId: 'biz-1', platform: 'facebook', locale: 'en' })
    const [header, , signature] = token.split('.')
    // Replace payload with different content
    const fakePayload = Buffer.from(JSON.stringify({ businessId: 'evil', platform: 'facebook', nonce: 'x' })).toString('base64url')
    const tampered = `${header}.${fakePayload}.${signature}`

    await expect(verifyOAuthState(tampered)).rejects.toThrow()
  })

  it('throws on malformed input (not a JWT)', async () => {
    await expect(verifyOAuthState('not.a.valid.jwt.at.all')).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode('test-secret-that-is-at-least-32-chars-long!')
    const expiredToken = await new SignJWT({
      businessId: 'test-uuid',
      platform: 'linkedin',
      nonce: 'test-nonce',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 700)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 100)
      .sign(secret)

    await expect(verifyOAuthState(expiredToken)).rejects.toThrow()
  })

  // ADR 0028 §2.3 (N2.6) — SOCIAL-PKCE-NOT-IN-STATE. The state JWT is
  // signed, not encrypted; its payload is base64-decodable by anyone who
  // observes the redirect. Publishing the PKCE verifier here would defeat
  // PKCE entirely, so this decodes a REAL signed state and asserts the
  // absence directly, rather than trusting that no code path adds it.
  it('SOCIAL-PKCE-NOT-IN-STATE: a real signed state JWT carries no verifier/code_verifier field of any kind', async () => {
    const token = await signOAuthState({ businessId: 'biz-1', platform: 'twitter', locale: 'en' })
    const payloadB64 = token.split('.')[1]!
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual(['businessId', 'exp', 'iat', 'locale', 'nonce', 'platform'])
    expect(payload['verifier']).toBeUndefined()
    expect(payload['codeVerifier']).toBeUndefined()
    expect(payload['code_verifier']).toBeUndefined()
  })

  it('throws when OAUTH_STATE_SECRET is too short', async () => {
    const { config } = await import('@/lib/config')
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: 'short',
    }

    await expect(
      signOAuthState({ businessId: 'biz-1', platform: 'threads', locale: 'es' }),
    ).rejects.toThrow()

    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: 'test-secret-that-is-at-least-32-chars-long!',
    }
  })
})
