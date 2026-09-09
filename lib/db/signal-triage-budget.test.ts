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

// ADR 0024 §7.5b (Session 31, H2.8) — signal_triage_budget renamed to
// ai_budget_daily with a mandatory purpose discriminator. This module's
// exported function names/signatures stay byte-identical (it still hardcodes
// purpose='triage_cents' internally) — only the underlying RPC names and
// params moved.
describe('lib/db/signal-triage-budget.ts (ADR 0021 §10.1, ADR 0024 §7.5b)', () => {
  it('reserveTriageBudget calls reserve_ai_budget with purpose=triage_cents and the exact RPC params, and returns the row', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 22 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveTriageBudget('biz-1', 22, 125)

    expect(client.rpc).toHaveBeenCalledWith('reserve_ai_budget', {
      p_business_id: 'biz-1',
      p_purpose: 'triage_cents',
      p_units: 22,
      p_cap: 125,
    })
    expect(result).toEqual({ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 22 })
  })

  it('reserveTriageBudget returns null when the RPC returns zero rows (refused)', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveTriageBudget('biz-1', 100, 50)

    expect(result).toBeNull()
  })

  it('reconcileTriageBudget calls reconcile_ai_budget with purpose=triage_cents and the exact RPC params', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 8 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reconcileTriageBudget('biz-1', 22, 8)

    expect(client.rpc).toHaveBeenCalledWith('reconcile_ai_budget', {
      p_business_id: 'biz-1',
      p_purpose: 'triage_cents',
      p_reserved_units: 22,
      p_actual_units: 8,
    })
    expect(result).toEqual({ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 8 })
  })

  it('isTriageBudgetCapped returns a plain boolean and never leaks reserved_units when NOT capped', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 47 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await isTriageBudgetCapped('biz-1', 125)

    expect(result).toBe(false)
    expect(typeof result).toBe('boolean')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).reserved_units).toBeUndefined()
  })

  it('isTriageBudgetCapped returns true when the zero-unit reservation is refused (already at cap)', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await isTriageBudgetCapped('biz-1', 125)

    expect(result).toBe(true)
  })

  it('isTriageBudgetCapped calls the RPC with a zero-unit reservation under purpose=triage_cents, not a direct table read', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'triage_cents', reserved_units: 0 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await isTriageBudgetCapped('biz-1', 125)

    expect(client.rpc).toHaveBeenCalledWith('reserve_ai_budget', {
      p_business_id: 'biz-1',
      p_purpose: 'triage_cents',
      p_units: 0,
      p_cap: 125,
    })
    expect(client.from).not.toHaveBeenCalled()
  })
})
