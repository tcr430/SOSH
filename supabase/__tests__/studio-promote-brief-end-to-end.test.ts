import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ADR 0021 §0.2 A-2's BINDING CONDITION, applied to assembleBrief's SECOND
// production caller (ADR 0022 §9/§11.1, Session 29 F1b.4). Drives
// promoteDraftToCampaignCore end to end through REAL Postgres: real auth
// context (a real signed-in owner, not the service-role admin client), real
// business-scoped memory reads, and the missing-rows path (zero evidence/
// audience/brand memory for the business). Only the AI call itself is
// mocked (matching signals3-seed.test.ts's own Tier-2-adjacent approach) —
// the property under test here is DB correctness, not generation quality.

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn().mockResolvedValue({
    hook: 'Our new SSO feature is live.',
    body: 'We just shipped SSO support for enterprise customers.',
    hashtags: [],
    pinnedEvidence: [],
  }),
}))

import { promoteDraftToCampaignCore } from '@/lib/campaigns/promote'
import { createStudioDraft, persistSuggestions, acceptSuggestion } from '@/lib/db/studio-drafts'

const PASSWORD = 'TestPass123!'

describe('promoteDraftToCampaignCore end-to-end (ADR 0022 §2, §9, §11.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let ownerEmail: string
  let businessId: string
  let authedClient: SupabaseClient
  let draftId: string

  async function createDraft(): Promise<string> {
    const { data, error } = await authedClient
      .from('studio_drafts')
      .insert({
        business_id: businessId,
        content: 'We just shipped SSO support for our enterprise customers.',
        platform: 'linkedin',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `promote-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    ownerId = data.user.id as string
    ownerEmail = email

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote E2E Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    // The MISSING-ROWS path (§0.2 A-2, mirrored from signals3-seed.test.ts)
    // — deliberately NO evidence_memory, audience_memory, or brand_memory
    // rows for this business.

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    authedClient = createClient(url, anonKey)
    const { error: signInErr } = await authedClient.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })
    if (signInErr) throw signInErr

    draftId = await createDraft()
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('posts').delete().eq('business_id', businessId)
    await admin.from('post_ai_originals').delete().eq('business_id', businessId)
    await admin.from('campaign_briefs').delete().eq('business_id', businessId)
    await admin.from('studio_drafts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('creates a campaign (origin=studio_promoted), a post, and a brief, driving assembleBrief through real auth + RLS-filtered reads + the missing-rows path', async () => {
    expect(ownerEmail).toBeTruthy() // real auth context, not the service-role admin client

    const result = await promoteDraftToCampaignCore(authedClient, businessId, draftId, '2026-09-01T09:00:00.000Z')
    expect(result.outcome).toBe('promoted')
    if (result.outcome !== 'promoted') return

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('*')
      .eq('id', result.campaignId)
      .single()
    if (campErr) throw campErr
    expect(campaign.origin).toBe('studio_promoted')
    expect(campaign.business_id).toBe(businessId)
    expect(campaign.status).toBe('awaiting_brief') // assembleBrief moved it (lib/db/campaigns.ts:71-77)
    expect(campaign.platforms).toEqual(['linkedin'])

    const { data: post, error: postErr } = await admin
      .from('posts')
      .select('*')
      .eq('id', result.postId)
      .single()
    if (postErr) throw postErr
    expect(post.campaign_id).toBe(result.campaignId)
    expect(post.status).toBe('draft')
    expect(post.content).toContain('SSO')

    const { data: brief, error: briefErr } = await admin
      .from('campaign_briefs')
      .select('*')
      .eq('id', result.briefId)
      .single()
    if (briefErr) throw briefErr
    expect(brief.campaign_id).toBe(result.campaignId)

    // §2.1 step 3 — the write-back landed BEFORE assembleBrief returned.
    const { data: draftAfter, error: draftAfterErr } = await admin
      .from('studio_drafts')
      .select('promoted_campaign_id')
      .eq('id', draftId)
      .single()
    if (draftAfterErr) throw draftAfterErr
    expect(draftAfter.promoted_campaign_id).toBe(result.campaignId)

    // ADR 0018 Amd A.1's binding corollary — this draft was never
    // suggested-on (accepted_revision is NULL), so NO post_ai_originals
    // snapshot exists for it.
    const { data: snapshots, error: snapshotErr } = await admin
      .from('post_ai_originals')
      .select('id')
      .eq('post_id', result.postId)
    if (snapshotErr) throw snapshotErr
    expect(snapshots ?? []).toHaveLength(0)
  })

  it('writes a post_ai_originals snapshot from accepted_revision when the draft was suggested-on — driven through the REAL acceptSuggestion write path, not a raw insert', async () => {
    const acceptedRevision = 'SSO support just shipped for enterprise customers — a top blocker removed.'

    // ADR 0022 §4.2/§13.3 (F1b.4 security-review fix) — accepted_revision's
    // only production write site is acceptSuggestion. Driving it through
    // createStudioDraft -> persistSuggestions -> acceptSuggestion (rather
    // than a raw insert of accepted_revision) is the whole point of this
    // test: it proves the REAL path populates the column, not just that
    // promote reads it correctly if it happens to be set.
    const draft = await createStudioDraft(authedClient, {
      business_id: businessId,
      content: 'SSO is out now.',
      platform: 'linkedin',
    })
    const suggested = await persistSuggestions(
      authedClient,
      draft.id,
      businessId,
      'SSO is out now.',
      [{ kind: 'model_judgment', text: 'a real suggestion' }],
      draft.content_hash,
    )
    if (suggested.outcome !== 'saved') throw new Error(`expected persistSuggestions to save, got: ${suggested.outcome}`)

    const accepted = await acceptSuggestion(
      authedClient,
      draft.id,
      businessId,
      acceptedRevision,
      suggested.draft.content_hash,
      suggested.draft.suggestions_for_hash as string,
    )
    if (accepted.outcome !== 'accepted') throw new Error(`expected acceptSuggestion to accept, got: ${accepted.outcome}`)
    expect(accepted.draft.accepted_revision).toBe(acceptedRevision)

    const result = await promoteDraftToCampaignCore(authedClient, businessId, draft.id, '2026-09-02T09:00:00.000Z')
    expect(result.outcome).toBe('promoted')
    if (result.outcome !== 'promoted') return

    const { data: snapshots, error: snapshotErr } = await admin
      .from('post_ai_originals')
      .select('generation_kind, rendered_content')
      .eq('post_id', result.postId)
    if (snapshotErr) throw snapshotErr
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].generation_kind).toBe('studio_promoted')
    expect(snapshots[0].rendered_content).toBe(acceptedRevision)
  })
})
