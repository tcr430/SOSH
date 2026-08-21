import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listPendingCardsForBusiness, getCardForBusiness, insertCard, transitionCardStatus, setCardCampaignId, clearCampaignReferenceOnCards } from './insight-cards'
import type { InsightCardInsert } from './types'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

const baseInsert: Omit<InsightCardInsert, 'business_id'> = {
  signal_candidate_id: 'cand-1',
  observation: 'obs',
  why_it_matters: 'why',
  audience: 'aud',
  angle_options: [{ angle: 'a', rationale: 'r' }],
  evidence: [],
  novelty: 10,
  freshness: 20,
  sensitivity: 0,
  confidence: 30,
  rubric_scores: {},
  score: 42,
  occurred_at: '2026-07-01T00:00:00Z',
}

describe('lib/db/insight-cards.ts (ADR 0021 §10.1)', () => {
  it('listPendingCardsForBusiness filters pending, bounds with limit, and ORDER BY matches insight_cards_feed_idx (score DESC, occurred_at DESC, id ASC)', async () => {
    const { client, builder } = createMockClient([], null)

    await listPendingCardsForBusiness(client, 'biz-1', 25)

    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.order).toHaveBeenCalledWith('score', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(25)
  })

  it('listPendingCardsForBusiness defaults its bound to 50', async () => {
    const { client, builder } = createMockClient([], null)

    await listPendingCardsForBusiness(client, 'biz-1')

    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('getCardForBusiness scopes to id + business_id', async () => {
    const { client, builder } = createMockClient(null, null)

    await getCardForBusiness(client, 'biz-1', 'card-1')

    expect(builder.eq).toHaveBeenCalledWith('id', 'card-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })

  it('insertCard routes through the insert_insight_card_if_claimed RPC (A-5), not a plain .insert(), and returns "inserted" on a matched row', async () => {
    const { client } = createMockClient([{ id: 'card-1', business_id: 'biz-1' }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await insertCard(baseInsert, '2026-08-09T00:00:00Z')

    expect(result).toEqual({ outcome: 'inserted', card: { id: 'card-1', business_id: 'biz-1' } })
    expect(client.rpc).toHaveBeenCalledWith(
      'insert_insight_card_if_claimed',
      expect.objectContaining({
        p_signal_candidate_id: 'cand-1',
        p_claimed_at: '2026-08-09T00:00:00Z',
      }),
    )
    // business_id is never a caller input — the RPC derives it from
    // signal_candidates itself, inside the same statement (A-5).
    expect(client.rpc).not.toHaveBeenCalledWith('insert_insight_card_if_claimed', expect.objectContaining({ business_id: expect.anything() }))
  })

  it('insertCard returns "claim_lost" (fail-closed, not an error) when the RPC matches zero rows', async () => {
    const { client } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await insertCard(baseInsert, '2026-08-09T00:00:00Z')

    expect(result).toEqual({ outcome: 'claim_lost' })
  })

  it("transitionCardStatus's zero-row arm returns already_triaged rather than throwing", async () => {
    const { client, builders } = createSequentialMockClient([
      { data: null, error: null },
      { data: { status: 'approved' }, error: null },
    ])

    const result = await transitionCardStatus(client, 'biz-1', 'card-1', 'pending', { status: 'saved' })

    expect(result).toEqual({ outcome: 'already_triaged', currentStatus: 'approved' })
    expect(builders[0].eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('transitionCardStatus returns ok with the new status on a successful atomic UPDATE', async () => {
    const { client, builder } = createMockClient({ status: 'saved' }, null)

    const result = await transitionCardStatus(client, 'biz-1', 'card-1', 'pending', { status: 'saved' })

    expect(result).toEqual({ outcome: 'ok', currentStatus: 'saved' })
    expect(builder.update).toHaveBeenCalledWith({ status: 'saved' })
  })

  // §9.2/§6.4 (Session 28-D, D7, MINOR-7)
  it('setCardCampaignId writes campaign_id via an atomic conditional UPDATE (id + campaign_id IS NULL), service-role', async () => {
    const { client, builder } = createMockClient({ id: 'card-1' }, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await setCardCampaignId('card-1', 'campaign-1')

    expect(builder.update).toHaveBeenCalledWith({ campaign_id: 'campaign-1' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'card-1')
    expect(builder.is).toHaveBeenCalledWith('campaign_id', null)
  })

  it('setCardCampaignId throws on a DB error rather than swallowing it', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    mockCreateServiceRoleClient.mockReturnValue(client)

    await expect(setCardCampaignId('card-1', 'campaign-1')).rejects.toThrow()
  })

  // database-reviewer (Session 28-D, D7 follow-up, MINOR-1)
  it('clearCampaignReferenceOnCards nulls campaign_id for every card pointing at the given campaign, service-role', async () => {
    const { client, builder } = createMockClient([{ id: 'card-1' }], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await clearCampaignReferenceOnCards('campaign-1')

    expect(builder.update).toHaveBeenCalledWith({ campaign_id: null })
    expect(builder.eq).toHaveBeenCalledWith('campaign_id', 'campaign-1')
  })

  it('clearCampaignReferenceOnCards throws on a DB error rather than swallowing it', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    mockCreateServiceRoleClient.mockReturnValue(client)

    await expect(clearCampaignReferenceOnCards('campaign-1')).rejects.toThrow()
  })
})
