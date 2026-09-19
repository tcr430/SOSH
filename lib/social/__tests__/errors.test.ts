import { describe, it, expect } from 'vitest'
import { SocialProviderError, CATCH_ALL_SUBSTRINGS as fromErrors } from '../errors'
import { CATCH_ALL_SUBSTRINGS as fromScrub } from '@/lib/observability/sentry-scrub'

describe('SocialProviderError', () => {
  it('sets code, message, platform, and retryAfterSeconds', () => {
    const err = new SocialProviderError({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      platform: 'linkedin',
      retryAfterSeconds: 30,
    })

    expect(err.code).toBe('RATE_LIMITED')
    expect(err.message).toBe('Too many requests')
    expect(err.platform).toBe('linkedin')
    expect(err.retryAfterSeconds).toBe(30)
    expect(err.name).toBe('SocialProviderError')
    expect(err instanceof Error).toBe(true)
  })

  it('defaults platform to null when not provided', () => {
    const err = new SocialProviderError({ code: 'NETWORK', message: 'Timeout' })
    expect(err.platform).toBeNull()
    expect(err.retryAfterSeconds).toBeNull()
  })

  it('redacts fields whose names match the sensitive pattern', () => {
    const err = new SocialProviderError({
      code: 'UNKNOWN',
      message: 'test',
      details: {
        accessToken: 'tok_abc123',
        refreshToken: 'ref_xyz',
        authorization: 'Bearer abc',
        cookie: 'session=...',
        platform_message: 'some error text',
        statusCode: 400,
      },
    })

    expect(err.details['accessToken']).toBe('[REDACTED]')
    expect(err.details['refreshToken']).toBe('[REDACTED]')
    expect(err.details['authorization']).toBe('[REDACTED]')
    expect(err.details['cookie']).toBe('[REDACTED]')
    expect(err.details['platform_message']).toBe('some error text')
    expect(err.details['statusCode']).toBe(400)
  })

  it('handles empty details gracefully', () => {
    const err = new SocialProviderError({ code: 'UNKNOWN', message: 'x' })
    expect(err.details).toEqual({})
  })

  it('details object is frozen (immutable)', () => {
    const err = new SocialProviderError({
      code: 'UNKNOWN',
      message: 'x',
      details: { foo: 'bar' },
    })
    expect(Object.isFrozen(err.details)).toBe(true)
  })

  it('redacts token_secret key and recursively redacts nested sensitive keys', () => {
    const err = new SocialProviderError({
      code: 'UNKNOWN',
      message: 'test',
      details: {
        Authorization: 'Bearer abc123',
        token_secret: 'my-secret',
        nested: { access_token: 'nested-token' },
        safe: 'safe-value',
      },
    })

    expect(err.details['Authorization']).toBe('[REDACTED]')
    expect(err.details['token_secret']).toBe('[REDACTED]')
    expect((err.details['nested'] as Record<string, unknown>)['access_token']).toBe('[REDACTED]')
    expect(err.details['safe']).toBe('safe-value')
  })

  it('redacts fields case-insensitively', () => {
    const err = new SocialProviderError({
      code: 'UNKNOWN',
      message: 'x',
      details: { ACCESS_TOKEN: 'leak', REFRESH_TOKEN: 'leak2' },
    })
    expect(err.details['ACCESS_TOKEN']).toBe('[REDACTED]')
    expect(err.details['REFRESH_TOKEN']).toBe('[REDACTED]')
  })
})

// ── SOCIAL-NO-SECRET-EGRESS (ADR 0028 §2.1/§2.7, N2.6) ───────────────────────
// The primary control, not the backstop: constructing an error from a
// realistic failed code-exchange must never carry the client secret or PKCE
// verifier into the serialised result. The redaction above is what makes
// this true; this asserts the OUTCOME a caller actually observes.

describe('SOCIAL-NO-SECRET-EGRESS — a failed exchange never carries the client secret in details', () => {
  it('client_secret is absent from the serialised error, even when the raw exchange failure payload contained it', () => {
    const err = new SocialProviderError({
      code: 'PLATFORM_REJECTED',
      message: 'Token exchange failed',
      platform: 'twitter',
      details: {
        // What a naive implementation might pass straight through from the
        // failed request it just made.
        grant_type: 'authorization_code',
        client_id: 'public-client-id-ok-to-log',
        client_secret: 'super-secret-value',
        redirect_uri: 'https://app.example.com/api/social/twitter/callback',
        error: 'invalid_client',
      },
    })

    const serialised = JSON.stringify(err.details)
    expect(serialised).not.toContain('super-secret-value')
    expect(err.details['client_secret']).toBe('[REDACTED]')
    // Non-secret fields survive — the control is targeted, not a blanket wipe.
    expect(err.details['client_id']).toBe('public-client-id-ok-to-log')
    expect(err.details['grant_type']).toBe('authorization_code')
  })
})

// ── Single source of truth — CATCH_ALL_SUBSTRINGS ────────────────────────────

describe('CATCH_ALL_SUBSTRINGS — single source of truth', () => {
  it('errors.ts re-exports the identical array reference from sentry-scrub (=== equality)', () => {
    expect(fromErrors).toBe(fromScrub)
  })
})
