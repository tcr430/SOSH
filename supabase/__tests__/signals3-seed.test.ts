import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// ADR 0021 §0.2 A-2's BINDING CONDITION (Session 28 E5.10) — assembleBrief
// has had ZERO production callers until seedCampaignFromCard. "Unchanged
// code" and "exercised code" are different claims (both Session 22
// blockers were exactly that gap) — this drives it end to end through REAL
// Postgres: real auth context (a real signed-up owner), real business-
// scoped memory reads, and the missing-rows path (zero evidence/audience/
// brand memory for the business). Only the AI call itself is mocked
// (matching lib/campaigns/brief.test.ts's own Tier-2 approach) — the
// property under test here is DB correctness, not generation quality.

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn().mockResolvedValue({
    hook: 'SSO is here.',
    body: 'Announcing SSO support for enterprise buyers.',
    hashtags: [],
    pinnedEvidence: [],
  }),
}))

import { seedCampaignFromCard } from '@/lib/signals/seed'

const PASSWORD = 'TestPass123!'

describe('seedCampaignFromCard end-to-end (ADR 0021 §6, §0.2 A-2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let ownerEmail: string
  let businessId: string
  let cardId: string

  async function createUser(label: string) {
    const email = `signals3-seed-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id
    ownerEmail = owner.email

    const { data: business, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Seed Test Co', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = business.id

    // The MISSING-ROWS path (§0.2 A-2) — deliberately NO evidence_memory,
    // audience_memory, or brand_memory rows for this business.

    // One connected account so seedCampaignFromCard's platforms derivation
    // (Session 28 E5.10 resolution) has a real, non-empty value.
    const { error: acctErr } = await admin.from('social_accounts').insert({
      business_id: businessId,
      platform: 'linkedin',
      platform_user_id: 'seed-test-user',
      platform_username: 'seed-test',
      vault_access_token_id: '00000000-0000-0000-0000-000000000000',
    })
    if (acctErr) throw acctErr

    const { data: connection, error: connErr } = await admin
      .from('github_connections')
      .insert({ business_id: businessId, installation_id: 990001, account_login: 'acct-990001' })
      .select('id')
      .single()
    if (connErr) throw connErr

    const { data: repo, error: repoErr } = await admin
      .from('watched_repos')
      .insert({ business_id: businessId, connection_id: connection.id, repo_id: 990001, owner: 'acme', name: 'repo-990001' })
      .select('id')
      .single()
    if (repoErr) throw repoErr

    const { data: signal, error: sigErr } = await admin
      .from('signals')
      .insert({
        business_id: businessId,
        watched_repo_id: repo.id,
        source: 'github',
        kind: 'release',
        external_id: 'seed-ext-1',
        title: 'v2.4.0',
        body: 'Adds SSO support.',
        occurred_at: '2026-07-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (sigErr) throw sigErr

    const { data: candidate, error: candErr } = await admin
      .from('signal_candidates')
      .insert({ business_id: businessId, signal_id: signal.id, score: 42, occurred_at: '2026-07-01T00:00:00Z' })
      .select('id')
      .single()
    if (candErr) throw candErr

    const { data: card, error: cardErr } = await admin
      .from('insight_cards')
      .insert({
        business_id: businessId,
        signal_candidate_id: candidate.id,
        observation: 'v2.4 shipped SSO support.',
        why_it_matters: 'SSO is a top-3 objection in enterprise deals.',
        audience: 'Enterprise IT buyers evaluating SSO.',
        angle_options: [{ angle: 'SSO is now available', rationale: 'Removes the #1 blocker in enterprise deals.' }],
        evidence: [],
        suggested_objective: 'Announce SSO to enterprise prospects.',
        novelty: 60,
        freshness: 90,
        sensitivity: 0,
        confidence: 70,
        rubric_scores: { specificity: 80, originality: 60, evidenceSufficiency: 70, audienceRelevance: 75, unsupportedClaimsRisk: 10, redundancy: 5 },
        score: 42,
        occurred_at: '2026-07-01T00:00:00Z',
        status: 'approved',
      })
      .select('id')
      .single()
    if (cardErr) throw cardErr
    cardId = card.id
  })

  afterAll(async () => {
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('creates a campaign (origin=signal_generated) and a brief, driving assembleBrief through real auth + RLS-filtered reads + the missing-rows path', async () => {
    expect(ownerEmail).toBeTruthy() // real auth context existed for this business

    const result = await seedCampaignFromCard(cardId)
    expect(result.campaignId).toBeTruthy()
    expect(result.briefId).toBeTruthy()

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('*')
      .eq('id', result.campaignId)
      .single()
    if (campErr) throw campErr
    expect(campaign.origin).toBe('signal_generated')
    expect(campaign.business_id).toBe(businessId)
    expect(campaign.objective).toContain('SSO')
    expect(campaign.platforms).toContain('linkedin')

    const { data: brief, error: briefErr } = await admin
      .from('campaign_briefs')
      .select('*')
      .eq('id', result.briefId)
      .single()
    if (briefErr) throw briefErr
    expect(brief.campaign_id).toBe(result.campaignId)

    // D7 (MINOR-7) — the write-back that makes §9.2's "approved and in
    // flight" state legible: the card now points at the campaign it seeded.
    const { data: cardAfter, error: cardAfterErr } = await admin
      .from('insight_cards')
      .select('campaign_id')
      .eq('id', cardId)
      .single()
    if (cardAfterErr) throw cardAfterErr
    expect(cardAfter.campaign_id).toBe(result.campaignId)
  })

  it('throws for a card id that does not exist', async () => {
    await expect(seedCampaignFromCard('00000000-0000-0000-0000-000000000000')).rejects.toThrow()
  })

  // D7 (MINOR-7), A-6 (already adjudicated §4) — proves ON DELETE SET NULL
  // was actually chosen, not CASCADE: deleting the campaign a card points at
  // must leave the card row intact (it is the eval corpus's history) and
  // merely null out the reference.
  it('deleting the seeded campaign SETS NULL on insight_cards.campaign_id and leaves the card row intact', async () => {
    // Reset campaign_id to NULL first (admin, bypassing setCardCampaignId's
    // app-level `.is('campaign_id', null)` guard) so this test drives its
    // own seed -> delete -> assert cycle independently of whether the
    // earlier test in this file already linked cardId to a campaign.
    const { error: resetErr } = await admin.from('insight_cards').update({ campaign_id: null }).eq('id', cardId)
    if (resetErr) throw resetErr

    const result = await seedCampaignFromCard(cardId)

    const { error: deleteErr } = await admin.from('campaigns').delete().eq('id', result.campaignId)
    if (deleteErr) throw deleteErr

    const { data: cardAfterDelete, error: cardErr } = await admin
      .from('insight_cards')
      .select('id, campaign_id, status')
      .eq('id', cardId)
      .single()
    if (cardErr) throw cardErr
    expect(cardAfterDelete).not.toBeNull()
    expect(cardAfterDelete.campaign_id).toBeNull()
    // The card itself — the eval corpus's history — was NOT cascaded away.
    expect(cardAfterDelete.status).toBe('approved')
  })
})
