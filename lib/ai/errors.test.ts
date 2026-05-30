import { describe, it, expect } from 'vitest'
import { AiError } from './errors'
import type { AiErrorCode } from './errors'

describe('AiError', () => {
  it('has the correct code', () => {
    const err = new AiError('quota_exceeded', 'Trial cap reached')
    expect(err.code).toBe('quota_exceeded')
  })

  it('has the correct message', () => {
    const err = new AiError('rate_limited', 'Too many requests')
    expect(err.message).toBe('Too many requests')
  })

  it('is an instance of Error', () => {
    const err = new AiError('invalid_response', 'Bad response')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name AiError', () => {
    const err = new AiError('provider_error', 'Server error')
    expect(err.name).toBe('AiError')
  })

  it('all error codes are accepted', () => {
    const codes: AiErrorCode[] = [
      'quota_exceeded',
      'rate_limited',
      'invalid_response',
      'provider_error',
      'rate_limit',
      'timeout',
      'fetch_failed',
    ]
    for (const code of codes) {
      expect(() => new AiError(code, 'test')).not.toThrow()
    }
  })

  it('can be caught as AiError', () => {
    function thrower() {
      throw new AiError('timeout', 'Timed out')
    }
    try {
      thrower()
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('timeout')
    }
  })
})
