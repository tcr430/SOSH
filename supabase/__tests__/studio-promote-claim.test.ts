import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  createStudioDraft,
  claimStudioDraftForPromotion,
  writeBackPromotedCampaignId,
  clearPromotedCampaignReferenceOnDrafts,
} from '@/lib/db/studio-drafts'
import { softDeleteCampaignGuarded } from '@/lib/db/campaigns'
import type { StudioDraftRow } from '@/lib/db/types'

// ADR 0022 §3.1-§3.4, §12.1 (Session 29, F1b.3) — the promote claim, the
// guarded write-back, staleness reclaim, and the soft-delete cleanup.
// Tier-1, live Postgres: PROMOTE-CLAIM-ATOMIC needs Postgres's real
// row-level locking to serialize two concurrent UPDATEs — a mocked client
// cannot exhibit this.

const PASSWORD = 'TestPass123!'

describe('studio_drafts promote claim, write-back, and cleanup (ADR 0022 §3, §12.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let ownerEmail: string
  let businessId: string
  let authedClient: SupabaseClient

  async function createDraft(content: string): Promise<StudioDraftRow> {
    return createStudioDraft(authedClient, { business_id: businessId, content })
  }

  async function createRealCampaign(name: string): Promise<string> {
    const { data, error } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name,
        objective: 'Test objective for promote claim fixtures',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-08-01',
        origin: 'studio_promoted',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `promote-claim-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    ownerId = data.user.id as string
    ownerEmail = email

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Claim Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    authedClient = createClient(url, anonKey)
    const { error: signInErr } = await authedClient.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })
    if (signInErr) throw signInErr
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('studio_drafts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('PROMOTE-CLAIM-ATOMIC: two concurrent claims of one draft — exactly one wins, the loser gets a typed outcome', async () => {
    const draft = await createDraft('atomic claim fixture')

    const [first, second] = await Promise.all([
      claimStudioDraftForPromotion(authedClient, draft.id, businessId),
      claimStudioDraftForPromotion(authedClient, draft.id, businessId),
    ])

    const outcomes = [first.outcome, second.outcome].sort()
    // Exactly one 'claimed', exactly one 'claimed_by_another' — never both
    // 'claimed' (that would mean the WHERE guard failed to serialize) and
    // never a thrown exception (the loser gets a typed result, not an error).
    expect(outcomes).toEqual(['claimed', 'claimed_by_another'])

    const winner = first.outcome === 'claimed' ? first : second
    const loser = first.outcome === 'claimed' ? second : first
    expect(winner.draft.promotion_claimed_at).not.toBeNull()
    // The loser's typed result carries the draft's REAL current state (§3.3),
    // not a generic error — it must reflect the winner's claim.
    if (loser.outcome === 'claimed_by_another') {
      expect(loser.draft.promotion_claimed_at).not.toBeNull()
      expect(loser.draft.promoted_campaign_id).toBeNull()
    }
  })

  it('PROMOTE-WRITEBACK-GUARDED: a second write-back no-ops rather than overwriting', async () => {
    const draft = await createDraft('write-back guard fixture')
    const claim = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(claim.outcome).toBe('claimed')

    const campaignA = await createRealCampaign('Write-Back Guard Campaign A')
    const campaignB = await createRealCampaign('Write-Back Guard Campaign B')

    await writeBackPromotedCampaignId(authedClient, draft.id, businessId, campaignA)
    // Second write-back targets a DIFFERENT campaign — if the guard failed,
    // this would silently overwrite campaignA with campaignB.
    await writeBackPromotedCampaignId(authedClient, draft.id, businessId, campaignB)

    const { data: row, error } = await admin
      .from('studio_drafts')
      .select('promoted_campaign_id')
      .eq('id', draft.id)
      .single()
    expect(error).toBeNull()
    expect(row.promoted_campaign_id).toBe(campaignA)
  })

  it('PROMOTE-CLAIM-RECLAIMABLE: a claim older than the staleness window with promoted_campaign_id NULL is reclaimable', async () => {
    const draft = await createDraft('reclaimable stale fixture')
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago, past the 5-min window
    const { error: setupErr } = await admin
      .from('studio_drafts')
      .update({ promotion_claimed_at: staleTimestamp })
      .eq('id', draft.id)
    expect(setupErr).toBeNull()

    const result = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(result.outcome).toBe('claimed')
  })

  it('PROMOTE-CLAIM-RECLAIMABLE: a fresh claim (within the staleness window) is NOT reclaimable', async () => {
    const draft = await createDraft('fresh unreclaimable fixture')
    const first = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(first.outcome).toBe('claimed')

    const second = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(second.outcome).toBe('claimed_by_another')
  })

  it('PROMOTE-CLAIM-RECLAIMABLE: a claim with promoted_campaign_id SET is NEVER reclaimable, even when stale', async () => {
    const draft = await createDraft('promoted never reclaimable fixture')
    const campaignId = await createRealCampaign('Never Reclaimable Campaign')
    const veryStaleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const { error: setupErr } = await admin
      .from('studio_drafts')
      .update({ promotion_claimed_at: veryStaleTimestamp, promoted_campaign_id: campaignId })
      .eq('id', draft.id)
    expect(setupErr).toBeNull()

    const result = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(result.outcome).toBe('already_promoted')
  })

  it('PROMOTE-SOFTDELETE-CLEARED: soft-deleting the campaign leaves no dangling promoted_campaign_id', async () => {
    const draft = await createDraft('softdelete cleanup fixture')
    const claim = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(claim.outcome).toBe('claimed')
    const campaignId = await createRealCampaign('Softdelete Cleanup Campaign')
    await writeBackPromotedCampaignId(authedClient, draft.id, businessId, campaignId)

    // softDeleteCampaignGuarded requires status 'draft' or 'completed' —
    // createCampaign above left it at the default 'draft'.
    const deleted = await softDeleteCampaignGuarded(authedClient, campaignId)
    expect(deleted).toBe(true)

    // Before cleanup: ON DELETE SET NULL never fired (this was an UPDATE,
    // not a DELETE) — the dangling reference is still there.
    const { data: beforeCleanup, error: beforeErr } = await admin
      .from('studio_drafts')
      .select('promoted_campaign_id')
      .eq('id', draft.id)
      .single()
    expect(beforeErr).toBeNull()
    expect(beforeCleanup.promoted_campaign_id).toBe(campaignId)

    await clearPromotedCampaignReferenceOnDrafts(authedClient, businessId, campaignId)

    const { data: afterCleanup, error: afterErr } = await admin
      .from('studio_drafts')
      .select('promoted_campaign_id')
      .eq('id', draft.id)
      .single()
    expect(afterErr).toBeNull()
    expect(afterCleanup.promoted_campaign_id).toBeNull()
  })

  it('clearPromotedCampaignReferenceOnDrafts is idempotent — a second call on an already-cleared reference no-ops without error', async () => {
    const draft = await createDraft('idempotent cleanup fixture')
    const claim = await claimStudioDraftForPromotion(authedClient, draft.id, businessId)
    expect(claim.outcome).toBe('claimed')
    const campaignId = await createRealCampaign('Idempotent Cleanup Campaign')
    await writeBackPromotedCampaignId(authedClient, draft.id, businessId, campaignId)

    await clearPromotedCampaignReferenceOnDrafts(authedClient, businessId, campaignId)
    // Second call: zero rows now match promoted_campaign_id = campaignId —
    // must not throw.
    await expect(
      clearPromotedCampaignReferenceOnDrafts(authedClient, businessId, campaignId),
    ).resolves.toBeUndefined()
  })
})
