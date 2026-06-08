import { describe, it, expect } from 'vitest'
import { MockEmailProvider } from '../mock-provider'

const baseInput = {
  to: 'user@example.com',
  subject: 'Welcome to SOSH',
  html: '<p>Hello</p>',
  text: 'Hello',
  replyTo: 'support@sosh.app',
  idempotencyKey: 'outbox-row-uuid-001',
}

describe('MockEmailProvider', () => {
  it('send() returns providerMessageId derived from idempotencyKey', async () => {
    const provider = new MockEmailProvider()
    const result = await provider.send(baseInput)
    expect(result.providerMessageId).toBe('mock_outbox-row-uuid-001')
  })

  it('send() captures the input in getSends()', async () => {
    const provider = new MockEmailProvider()
    await provider.send(baseInput)
    expect(provider.getSends()).toHaveLength(1)
    expect(provider.getSends()[0]).toEqual(baseInput)
  })

  it('accumulates multiple sends', async () => {
    const provider = new MockEmailProvider()
    await provider.send(baseInput)
    await provider.send({ ...baseInput, idempotencyKey: 'uuid-002' })
    expect(provider.getSends()).toHaveLength(2)
  })

  it('failNextSend causes the next send to throw with the specified code', async () => {
    const provider = new MockEmailProvider()
    provider.failNextSend('provider_unavailable')
    await expect(provider.send(baseInput)).rejects.toMatchObject({
      code: 'provider_unavailable',
      name: 'EmailProviderError',
    })
  })

  it('subsequent send succeeds after failNextSend fires', async () => {
    const provider = new MockEmailProvider()
    provider.failNextSend('provider_unavailable')
    await expect(provider.send(baseInput)).rejects.toThrow()
    const result = await provider.send(baseInput)
    expect(result.providerMessageId).toBe('mock_outbox-row-uuid-001')
  })

  it('reset() clears sends and error injection state', async () => {
    const provider = new MockEmailProvider()
    await provider.send(baseInput)
    provider.failNextSend('unknown')
    provider.reset()
    expect(provider.getSends()).toHaveLength(0)
    await expect(provider.send(baseInput)).resolves.toBeDefined()
  })
})
