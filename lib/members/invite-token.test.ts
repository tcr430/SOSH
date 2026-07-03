import { describe, it, expect, vi } from 'vitest'
import { signInviteToken, verifyInviteToken } from './invite-token'

// Provide a valid INVITE_TOKEN_SECRET for all tests in this file.
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      INVITE_TOKEN_SECRET: 'test-invite-secret-that-is-at-least-32-chars!',
    },
  },
}))

describe('signInviteToken / verifyInviteToken', () => {
  it('round-trips correctly: sign then verify yields the same claims', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    const claims = await verifyInviteToken(token)

    expect(claims.memberId).toBe('member-1')
    expect(claims.businessId).toBe('biz-1')
  })

  it('throws when verified with a different secret', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })

    const { config } = await import('@/lib/config')
    const original = config.server.INVITE_TOKEN_SECRET
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      INVITE_TOKEN_SECRET: 'totally-different-secret-that-is-also-long-enough!!',
    }

    await expect(verifyInviteToken(token)).rejects.toThrow()

    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      INVITE_TOKEN_SECRET: original,
    }
  })

  it('throws on a tampered payload', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    const [header, , signature] = token.split('.')
    const fakePayload = Buffer.from(
      JSON.stringify({ memberId: 'evil', businessId: 'biz-1' }),
    ).toString('base64url')
    const tampered = `${header}.${fakePayload}.${signature}`

    await expect(verifyInviteToken(tampered)).rejects.toThrow()
  })

  it('throws on malformed input (not a JWT)', async () => {
    await expect(verifyInviteToken('not.a.valid.jwt.at.all')).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode('test-invite-secret-that-is-at-least-32-chars!')
    const expiredToken = await new SignJWT({ memberId: 'member-1', businessId: 'biz-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 700)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 100)
      .sign(secret)

    await expect(verifyInviteToken(expiredToken)).rejects.toThrow()
  })

  it('throws when INVITE_TOKEN_SECRET is too short', async () => {
    const { config } = await import('@/lib/config')
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      INVITE_TOKEN_SECRET: 'short',
    }

    await expect(
      signInviteToken({ memberId: 'member-1', businessId: 'biz-1' }),
    ).rejects.toThrow()

    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      INVITE_TOKEN_SECRET: 'test-invite-secret-that-is-at-least-32-chars!',
    }
  })
})
