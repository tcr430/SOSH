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
    })

    const claims = await verifyOAuthState(token)

    expect(claims.businessId).toBe('biz-123')
    expect(claims.platform).toBe('linkedin')
    expect(typeof claims.nonce).toBe('string')
    expect(claims.nonce.length).toBeGreaterThan(0)
  })

  it('each call produces a different nonce', async () => {
    const t1 = await signOAuthState({ businessId: 'biz-1', platform: 'twitter' })
    const t2 = await signOAuthState({ businessId: 'biz-1', platform: 'twitter' })

    const c1 = await verifyOAuthState(t1)
    const c2 = await verifyOAuthState(t2)

    expect(c1.nonce).not.toBe(c2.nonce)
  })

  it('throws when verified with a different secret', async () => {
    const token = await signOAuthState({ businessId: 'biz-1', platform: 'instagram' })

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
    const token = await signOAuthState({ businessId: 'biz-1', platform: 'facebook' })
    const [header, , signature] = token.split('.')
    // Replace payload with different content
    const fakePayload = Buffer.from(JSON.stringify({ businessId: 'evil', platform: 'facebook', nonce: 'x' })).toString('base64url')
    const tampered = `${header}.${fakePayload}.${signature}`

    await expect(verifyOAuthState(tampered)).rejects.toThrow()
  })

  it('throws on malformed input (not a JWT)', async () => {
    await expect(verifyOAuthState('not.a.valid.jwt.at.all')).rejects.toThrow()
  })

  it('throws when OAUTH_STATE_SECRET is too short', async () => {
    const { config } = await import('@/lib/config')
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: 'short',
    }

    await expect(
      signOAuthState({ businessId: 'biz-1', platform: 'threads' }),
    ).rejects.toThrow()

    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      OAUTH_STATE_SECRET: 'test-secret-that-is-at-least-32-chars-long!',
    }
  })
})
