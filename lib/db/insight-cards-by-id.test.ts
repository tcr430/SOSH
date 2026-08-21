import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getCardById } from './insight-cards'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

// ADR 0021 §6.1 (Session 28 E5.10) — seedCampaignFromCard(cardId) is called
// with ONLY a card id (no business_id, no authenticated session), so it
// needs a service-role lookup by id alone — distinct from
// getCardForBusiness, which requires a business_id the caller doesn't have
// yet.
describe('lib/db/insight-cards.ts getCardById (ADR 0021 §6.1)', () => {
  it('queries by id only, service-role', async () => {
    const cardRow = { id: 'card-1', business_id: 'biz-1' }
    const { client, builder } = createMockClient(cardRow, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await getCardById('card-1')

    expect(builder.eq).toHaveBeenCalledWith('id', 'card-1')
    expect(result).toEqual(cardRow)
  })

  it('returns null when no card exists at that id', async () => {
    const { client } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await getCardById('missing')
    expect(result).toBeNull()
  })
})
