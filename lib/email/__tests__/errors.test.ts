import { describe, it, expect } from 'vitest'
import { REDACTED_KEYS as emailRedactedKeys, EmailProviderError } from '../errors'
import { REDACTED_KEYS } from '@/lib/observability/sentry-scrub'

describe('REDACTED_KEYS reference equality', () => {
  it('is the same Set instance exported from sentry-scrub — not a copy', () => {
    expect(emailRedactedKeys).toBe(REDACTED_KEYS)
  })
})

describe('EmailProviderError', () => {
  it('stores code, message, and name', () => {
    const err = new EmailProviderError('unknown', 'test message')
    expect(err.code).toBe('unknown')
    expect(err.message).toBe('test message')
    expect(err.name).toBe('EmailProviderError')
    expect(err).toBeInstanceOf(Error)
  })

  it('details is always defined (empty object when omitted)', () => {
    const err = new EmailProviderError('unknown', 'msg')
    expect(err.details).toEqual({})
  })

  it('redacts authorization key in details', () => {
    const err = new EmailProviderError('unknown', 'msg', {
      authorization: 'Bearer secret123',
    })
    expect(err.details.authorization).toBe('[REDACTED]')
  })

  it('redacts apikey in details', () => {
    const err = new EmailProviderError('unknown', 'msg', { apikey: 'my-key' })
    expect(err.details.apikey).toBe('[REDACTED]')
  })

  it('recursively redacts nested sensitive keys', () => {
    const err = new EmailProviderError('unknown', 'msg', {
      nested: { apikey: 'hidden', safe: 'value' },
    })
    const nested = err.details.nested as Record<string, unknown>
    expect(nested.apikey).toBe('[REDACTED]')
    expect(nested.safe).toBe('value')
  })

  it('preserves non-sensitive detail fields', () => {
    const err = new EmailProviderError('unknown', 'msg', { statusCode: 503, region: 'us-east-1' })
    expect(err.details.statusCode).toBe(503)
    expect(err.details.region).toBe('us-east-1')
  })

  it('stores retryAfterSeconds when provided', () => {
    const err = new EmailProviderError('provider_rate_limit', 'rate limited', {}, 30)
    expect(err.retryAfterSeconds).toBe(30)
  })

  it('retryAfterSeconds is undefined when not provided', () => {
    const err = new EmailProviderError('unknown', 'msg')
    expect(err.retryAfterSeconds).toBeUndefined()
  })
})
