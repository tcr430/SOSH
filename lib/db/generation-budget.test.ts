import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { reserveGenerationPost, releaseGenerationPost } from './generation-budget'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

// ADR 0024 §7.5a/§7.5b (Session 31, H2.9) — a DIFFERENT caller of the same
// reserve_ai_budget/reconcile_ai_budget RPCs H2.8 renamed, hardcoding
// purpose='generation_posts' (never 'triage_cents' — lib/db/signal-triage-
// budget.ts owns that purpose).
describe('lib/db/generation-budget.ts (ADR 0024 §7.5a/§7.5b)', () => {
  it('reserveGenerationPost calls reserve_ai_budget with purpose=generation_posts and exactly 1 unit', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'generation_posts', reserved_units: 1 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveGenerationPost('biz-1', 15)

    expect(client.rpc).toHaveBeenCalledWith('reserve_ai_budget', {
      p_business_id: 'biz-1',
      p_purpose: 'generation_posts',
      p_units: 1,
      p_cap: 15,
    })
    expect(result).toEqual({ business_id: 'biz-1', purpose: 'generation_posts', reserved_units: 1 })
  })

  it('reserveGenerationPost returns null when the RPC returns zero rows (cap reached)', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await reserveGenerationPost('biz-1', 15)

    expect(result).toBeNull()
  })

  it('releaseGenerationPost calls reconcile_ai_budget with purpose=generation_posts, 1 reserved, 0 actual', async () => {
    const { client } = createMockClient([{ business_id: 'biz-1', purpose: 'generation_posts', reserved_units: 0 }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await releaseGenerationPost('biz-1')

    expect(client.rpc).toHaveBeenCalledWith('reconcile_ai_budget', {
      p_business_id: 'biz-1',
      p_purpose: 'generation_posts',
      p_reserved_units: 1,
      p_actual_units: 0,
    })
    expect(result).toEqual({ business_id: 'biz-1', purpose: 'generation_posts', reserved_units: 0 })
  })
})
