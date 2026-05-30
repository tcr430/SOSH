import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { recordBillingEvent, updateBillingEventOutcome } from './billing-events'
import type { BillingEventOutcome } from './billing-events'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const baseInput = {
  id: 'evt_test_001',
  type: 'checkout.session.completed',
  businessId: 'biz-1',
  stripeCustomerId: 'cus_test_001',
  payload: { id: 'evt_test_001', type: 'checkout.session.completed' },
  outcome: 'applied' as BillingEventOutcome,
}

describe('recordBillingEvent', () => {
  it('returns { duplicate: false } on first insert', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await recordBillingEvent(baseInput)
    expect(result).toEqual({ duplicate: false })
    expect(client.from).toHaveBeenCalledWith('billing_events')
  })

  it('returns { duplicate: true } on re-insert (unique violation)', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key value violates unique constraint' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await recordBillingEvent(baseInput)
    expect(result).toEqual({ duplicate: true })
  })

  it('does not throw on duplicate — original outcome is preserved at DB layer', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(recordBillingEvent({ ...baseInput, outcome: 'error' })).resolves.toEqual({ duplicate: true })
  })

  it('throws on non-duplicate DB errors', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'permission denied' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(recordBillingEvent(baseInput)).rejects.toThrow('permission denied')
  })
})

describe('updateBillingEventOutcome', () => {
  it('updates the outcome column for the given event id', async () => {
    const { client, builder } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await updateBillingEventOutcome('evt_test_001', 'error')
    expect(client.from).toHaveBeenCalledWith('billing_events')
    expect(builder.update).toHaveBeenCalledWith({ processed_outcome: 'error' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'evt_test_001')
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { code: 'PGRST301', message: 'update failed' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(updateBillingEventOutcome('evt_test_001', 'error')).rejects.toThrow('update failed')
  })
})
