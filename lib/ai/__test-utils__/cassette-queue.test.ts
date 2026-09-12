import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: { server: { AI_PROVIDER: 'mock' } },
}))

import { getAnthropicClient, _resetClient } from '@/lib/ai/client'
import { enqueueCassettes, drainCassetteQueue, makeCassetteMessage } from './cassette-queue'

// ADR 0024 §4.5(3), §10.2 (Session 31, H2.3) — proves the harness itself,
// before anything downstream depends on it. This step closes no QUAL
// constraint; it is the named prerequisite for QUAL-ARGMAX-DETERMINISTIC
// and QUAL-BELOW-THRESHOLD-SURFACED (H2.7).

afterEach(() => {
  _resetClient()
})

describe('cassette-queue harness (ADR 0024 §4.5(3), prerequisite for H2.7)', () => {
  it('returns three distinct enqueued payloads for one promptId, in order, ahead of fixture routing', async () => {
    const client = await getAnthropicClient()

    enqueueCassettes([
      makeCassetteMessage({ overall: 40 }),
      makeCassetteMessage({ overall: 90 }),
      makeCassetteMessage({ overall: 65 }),
    ])

    const responses = []
    for (let i = 0; i < 3; i++) {
      responses.push(
        await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'x' }],
          // @ts-expect-error _sosh is a runtime-only mock-routing extension, not part of the SDK's public type
          _sosh: { promptId: 'rubric', input: {} },
        }),
      )
    }

    const scores = responses.map((r) => JSON.parse((r.content[0] as { text: string }).text).overall)
    expect(scores).toEqual([40, 90, 65])
    expect(new Set(scores).size).toBe(3) // distinct, not a 3-way tie

    drainCassetteQueue() // queue is empty — must not throw
  })

  it('drainCassetteQueue FAILS LOUDLY when a test leaves cassettes unconsumed, rather than silently poisoning the next file', async () => {
    const client = await getAnthropicClient()

    enqueueCassettes([makeCassetteMessage({ overall: 1 }), makeCassetteMessage({ overall: 2 })])

    await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
      // @ts-expect-error _sosh is a runtime-only mock-routing extension, not part of the SDK's public type
      _sosh: { promptId: 'rubric', input: {} },
    })
    // deliberately do NOT consume the second cassette

    expect(() => drainCassetteQueue()).toThrow(/1 cassette\(s\) left unconsumed/)
    // drainCassetteQueue clears the global even when it throws, so it never
    // actually poisons the next file — the throw is the loud failure signal
    expect(globalThis.__evalCassetteQueue).toBeUndefined()
  })
})
