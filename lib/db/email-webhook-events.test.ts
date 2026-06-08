import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { recordWebhookEvent } from './email-webhook-events'

describe('recordWebhookEvent', () => {
  it('returns { inserted: true } on first insert', async () => {
    const { client } = createMockClient(null, null)
    const result = await recordWebhookEvent(client, {
      id: 'evt_resend_001',
      event_type: 'email.bounced',
      payload: { type: 'email.bounced', data: { email_id: 'msg_001' } },
    })
    expect(result).toEqual({ inserted: true })
    expect(client.from).toHaveBeenCalledWith('email_webhook_events')
  })

  it('returns { inserted: false } on duplicate event id (23505)', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key value' })
    const result = await recordWebhookEvent(client, {
      id: 'evt_resend_001',
      event_type: 'email.bounced',
      payload: {},
    })
    expect(result).toEqual({ inserted: false })
  })

  it('does not throw on duplicate — original event is preserved', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key' })
    await expect(
      recordWebhookEvent(client, { id: 'evt_resend_001', event_type: 'email.delivered', payload: {} }),
    ).resolves.toEqual({ inserted: false })
  })

  it('throws on non-duplicate DB errors', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'permission denied' })
    await expect(
      recordWebhookEvent(client, { id: 'evt_001', event_type: 'email.bounced', payload: {} }),
    ).rejects.toThrow('permission denied')
  })

  it('inserts the correct fields', async () => {
    const { client, builder } = createMockClient(null, null)
    const payload = { foo: 'bar' }
    await recordWebhookEvent(client, {
      id: 'evt_resend_002',
      event_type: 'email.complained',
      payload,
    })
    expect(builder.insert).toHaveBeenCalledWith({
      id: 'evt_resend_002',
      event_type: 'email.complained',
      payload,
    })
  })
})
