import { describe, it, expect } from 'vitest'
import { validateThreadPolicy } from './policy'
import { AiError } from '@/lib/ai/errors'
import type { ThreadOutput } from './schemas'

function makeThread(overrides: Partial<ThreadOutput['posts'][number]>[] = []): ThreadOutput {
  const base: ThreadOutput['posts'] = [
    { text: 'Hook', role: 'hook' },
    { text: 'Quote', role: 'pull_quote' },
    { text: 'Close', role: 'close' },
  ]
  return {
    format: 'thread',
    imageBrief: null,
    posts: overrides.length > 0 ? (overrides as ThreadOutput['posts']) : base,
  }
}

describe('validateThreadPolicy (MODE2-THREAD-GUARDRAILS)', () => {
  it('accepts a valid sequence: hook first, close last, >=1 pull_quote', () => {
    expect(() => validateThreadPolicy(makeThread())).not.toThrow()
  })

  it('throws policy_violation (not invalid_response) when posts[0] is not hook', () => {
    const thread = makeThread([
      { text: 'Not a hook', role: 'body' },
      { text: 'Quote', role: 'pull_quote' },
      { text: 'Close', role: 'close' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/hook/)
    }
  })

  it('throws policy_violation when the last post is not close', () => {
    const thread = makeThread([
      { text: 'Hook', role: 'hook' },
      { text: 'Quote', role: 'pull_quote' },
      { text: 'Not closing', role: 'body' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/close/)
    }
  })

  it('throws policy_violation when there is no pull_quote', () => {
    const thread = makeThread([
      { text: 'Hook', role: 'hook' },
      { text: 'Body', role: 'body' },
      { text: 'Close', role: 'close' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/pull_quote/)
    }
  })

  it('reports ALL violated rules in one message, not just the first', () => {
    const thread = makeThread([
      { text: 'Not a hook', role: 'body' },
      { text: 'Not closing', role: 'body' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      const msg = (err as AiError).message
      expect(msg).toMatch(/hook/)
      expect(msg).toMatch(/close/)
      expect(msg).toMatch(/pull_quote/)
    }
  })
})
