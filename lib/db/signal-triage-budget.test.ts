import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { reserveTriageBudget, reconcileTriageBudget, isTriageBudgetCapped } from './signal-triage-budget'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/signal-triage-budget.ts (ADR 0021 §10.1)', () => {
  it('reserveTriageBudget calls reserve_triage_budget with the exact RPC params and returns the row', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', reserved_cents: 22 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveTriageBudget('biz-1', 22, 125)

    expect(client.rpc).toHaveBeenCalledWith('reserve_triage_budget', {
      p_business_id: 'biz-1',
      p_cents: 22,
      p_cap: 125,
    })
    expect(result).toEqual({ business_id: 'biz-1', reserved_cents: 22 })
  })

  it('reserveTriageBudget returns null when the RPC returns zero rows (refused)', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveTriageBudget('biz-1', 100, 50)

    expect(result).toBeNull()
  })

  it('reconcileTriageBudget calls reconcile_triage_budget with the exact RPC params', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', reserved_cents: 8 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reconcileTriageBudget('biz-1', 22, 8)

    expect(client.rpc).toHaveBeenCalledWith('reconcile_triage_budget', {
      p_business_id: 'biz-1',
      p_reserved_cents: 22,
      p_actual_cents: 8,
    })
    expect(result).toEqual({ business_id: 'biz-1', reserved_cents: 8 })
  })

  it('isTriageBudgetCapped returns a plain boolean and never leaks reserved_cents when NOT capped', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', reserved_cents: 47 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await isTriageBudgetCapped('biz-1', 125)

    expect(result).toBe(false)
    expect(typeof result).toBe('boolean')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).reserved_cents).toBeUndefined()
  })

  it('isTriageBudgetCapped returns true when the zero-cent reservation is refused (already at cap)', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await isTriageBudgetCapped('biz-1', 125)

    expect(result).toBe(true)
  })

  it('isTriageBudgetCapped calls the RPC with a zero-cent reservation, not a direct table read', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', reserved_cents: 0 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await isTriageBudgetCapped('biz-1', 125)

    expect(client.rpc).toHaveBeenCalledWith('reserve_triage_budget', {
      p_business_id: 'biz-1',
      p_cents: 0,
      p_cap: 125,
    })
    expect(client.from).not.toHaveBeenCalled()
  })
})
