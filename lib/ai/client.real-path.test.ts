import { describe, it, expect, vi, afterEach } from 'vitest'

// QA-REAL-API-SOSH-FIELD — the real Anthropic API rejects unknown body fields
// with HTTP 400, so the real client path must never send `_sosh`.

const realCreate = vi.fn(async (_body: unknown) => ({ id: 'msg_real' }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: realCreate }
  },
}))

let provider: 'mock' | 'anthropic' = 'anthropic'
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      get AI_PROVIDER() {
        return provider
      },
      ANTHROPIC_API_KEY: 'test-key',
    },
  },
}))

import { getAnthropicClient, stripRoutingFields, _resetClient } from '@/lib/ai/client'

afterEach(() => {
  _resetClient()
  realCreate.mockClear()
  provider = 'anthropic'
})

const params = {
  model: 'claude-sonnet-4-6',
  max_tokens: 10,
  messages: [{ role: 'user' as const, content: 'x' }],
  _sosh: { promptId: 'brief', input: { a: 1 } },
}

describe('real client path never sends _sosh', () => {
  it('strips _sosh before delegating to the SDK, keeping every other field', async () => {
    provider = 'anthropic'
    const client = await getAnthropicClient()
    await client.messages.create(params)

    expect(realCreate).toHaveBeenCalledTimes(1)
    const sent = realCreate.mock.calls[0][0] as Record<string, unknown>
    expect('_sosh' in sent).toBe(false)
    expect(sent).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    })
  })

  it('does not mutate the caller params (the mock still needs _sosh)', () => {
    stripRoutingFields(params)
    expect(params._sosh).toEqual({ promptId: 'brief', input: { a: 1 } })
  })

  it('leaves the mock client untouched: it still receives _sosh for routing', async () => {
    provider = 'mock'
    const client = await getAnthropicClient()
    // post-generation routes on _sosh.input.targetPlatform; a missing-fixture
    // error naming post-generation proves the field reached the mock.
    const routed = {
      ...params,
      _sosh: { promptId: 'post-generation', input: { targetPlatform: 'no-such-platform' } },
    }
    await expect(client.messages.create(routed)).rejects.toThrow(/post-generation/)
    expect(realCreate).not.toHaveBeenCalled()
  })
})
