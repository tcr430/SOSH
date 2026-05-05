import { describe, it, expect } from 'vitest'
import { SocialProviderError } from '../errors'

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
