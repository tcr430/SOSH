import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listPendingCardsForBusiness, getCardForBusiness, insertCard, transitionCardStatus } from './insight-cards'
import type { InsightCardInsert } from './types'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

const baseInsert: InsightCardInsert = {
  business_id: 'biz-1',
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

  it('insertCard derives business_id from the parent candidate row and writes it', async () => {
    const { client, builders } = createSequentialMockClient([
      { data: { business_id: 'biz-1' }, error: null },
      { data: { id: 'card-1', business_id: 'biz-1' }, error: null },
    ])
    mockCreateServiceRoleClient.mockReturnValue(client)

    const result = await insertCard(baseInsert)

    expect(result).toEqual({ id: 'card-1', business_id: 'biz-1' })
    expect(builders[0].eq).toHaveBeenCalledWith('id', 'cand-1')
    expect(builders[1].insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'biz-1' }))
  })

  it('insertCard REJECTS a business_id that disagrees with the parent candidate', async () => {
    const { client } = createSequentialMockClient([{ data: { business_id: 'biz-DIFFERENT' }, error: null }])
    mockCreateServiceRoleClient.mockReturnValue(client)

    await expect(insertCard(baseInsert)).rejects.toThrow(/business_id/i)
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
})
