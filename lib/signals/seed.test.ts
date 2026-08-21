import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/insight-cards', () => ({
  getCardById: vi.fn(),
  setCardCampaignId: vi.fn(),
}))
vi.mock('@/lib/db/campaigns', () => ({
  createCampaign: vi.fn(),
}))
vi.mock('@/lib/db/social-accounts', () => ({
  listActiveSocialAccounts: vi.fn(),
}))
vi.mock('@/lib/campaigns/brief', () => ({
  assembleBrief: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn().mockReturnValue({}),
}))

import { seedCampaignFromCard, composeObjective } from './seed'
import { getCardById, setCardCampaignId } from '@/lib/db/insight-cards'
import { createCampaign } from '@/lib/db/campaigns'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { assembleBrief } from '@/lib/campaigns/brief'
import type { InsightCardRow } from '@/lib/db/types'

const CARD: InsightCardRow = {
  id: 'card-1',
  business_id: 'biz-1',
  signal_candidate_id: 'cand-1',
  observation: 'v2.4 shipped SSO support.',
  why_it_matters: 'SSO is a top-3 objection in enterprise deals.',
  audience: 'Enterprise IT buyers evaluating SSO.',
  angle_options: [],
  evidence: [],
  suggested_objective: 'Announce SSO to enterprise prospects.',
  novelty: 60,
  freshness: 90,
  sensitivity: 0,
  confidence: 70,
  rubric_scores: {},
  score: 42,
  occurred_at: '2026-07-01T00:00:00Z',
  status: 'approved',
  dismiss_reason: null,
  expires_at: null,
  campaign_id: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

afterEach(() => vi.clearAllMocks())

describe('lib/signals/seed.ts composeObjective (ADR 0021 §6.1)', () => {
  it('joins observation + why_it_matters + audience + suggested_objective', () => {
    const result = composeObjective(CARD)
    expect(result).toContain(CARD.observation)
    expect(result).toContain(CARD.why_it_matters)
    expect(result).toContain(CARD.audience)
    expect(result).toContain(CARD.suggested_objective)
  })

  it('omits suggested_objective when null', () => {
    const result = composeObjective({ ...CARD, suggested_objective: null })
    expect(result).not.toMatch(/null/i)
  })
})

describe('lib/signals/seed.ts seedCampaignFromCard (ADR 0021 §6, D-7)', () => {
  it('creates a campaign with origin = signal_generated and composes the objective', async () => {
    vi.mocked(getCardById).mockResolvedValue(CARD)
    vi.mocked(listActiveSocialAccounts).mockResolvedValue([])
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: 'biz-1' } as never)
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    const result = await seedCampaignFromCard('card-1')

    expect(createCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        business_id: 'biz-1',
        origin: 'signal_generated',
        objective: composeObjective(CARD),
      }),
    )
    expect(assembleBrief).toHaveBeenCalledWith('campaign-1')
    expect(result).toEqual({ campaignId: 'campaign-1', briefId: 'brief-1' })
  })

  // D7 (MINOR-7) — the write-back that makes §9.2's "approved and in
  // flight" state legible.
  it('writes campaign_id back onto the card, after the brief exists, via the atomic conditional setCardCampaignId', async () => {
    vi.mocked(getCardById).mockResolvedValue(CARD)
    vi.mocked(listActiveSocialAccounts).mockResolvedValue([])
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: 'biz-1' } as never)
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)
    const callOrder: string[] = []
    vi.mocked(assembleBrief).mockImplementation(async () => {
      callOrder.push('assembleBrief')
      return { id: 'brief-1' } as never
    })
    vi.mocked(setCardCampaignId).mockImplementation(async () => {
      callOrder.push('setCardCampaignId')
    })

    await seedCampaignFromCard('card-1')

    expect(setCardCampaignId).toHaveBeenCalledWith('card-1', 'campaign-1')
    expect(callOrder).toEqual(['assembleBrief', 'setCardCampaignId'])
  })

  it('sets platforms from the business currently-connected accounts', async () => {
    vi.mocked(getCardById).mockResolvedValue(CARD)
    vi.mocked(listActiveSocialAccounts).mockResolvedValue([
      { platform: 'linkedin' } as never,
      { platform: 'twitter' } as never,
      { platform: 'linkedin' } as never,
    ])
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: 'biz-1' } as never)
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    await seedCampaignFromCard('card-1')

    expect(createCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ platforms: ['linkedin', 'twitter'] }),
    )
  })

  it('throws when no card exists at that id', async () => {
    vi.mocked(getCardById).mockResolvedValue(null)
    await expect(seedCampaignFromCard('missing')).rejects.toThrow()
    expect(createCampaign).not.toHaveBeenCalled()
    expect(setCardCampaignId).not.toHaveBeenCalled()
  })

  it('introduces no new generation call — never calls runPrompt or a rubric prompt directly', async () => {
    // Documentation-only assertion, mirroring the Tier-3-adjacent pattern
    // used elsewhere in this codebase: the REAL proof that no generation
    // path was introduced is the diff itself (SIGNAL3-SEED-ONLY-NO-
    // GENERATION, Tier 3) — this module's only calls are to
    // getCardById/createCampaign/listActiveSocialAccounts/assembleBrief,
    // none of which is lib/ai/runner.ts.
    const source = seedCampaignFromCard.toString()
    expect(source).not.toMatch(/runPrompt/)
  })
})
