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

// A-9 (Session 29-D, MAJOR-5, D5) — routed by prompt.id so this ONE mock can
// drive the full brief -> critique -> approve -> generate -> activate chain,
// not just assembleBrief. 'brief-assembly' shape matches CampaignBriefContent
// (narrative/proofPlan/pinnedEvidence/roleSequence); 'rubric' is shared by
// critiqueBrief's brief-mode call AND generate.ts's per-post opener-scoring
// call — both just need a score above BRIEF_QUALITY_THRESHOLD (70); the
// 'native-generation-*' ids are generateNativeContent's real production
// callers (lib/ai/generate-native.ts).
const RUBRIC_DIMENSIONS = [
  'specificity', 'originality', 'evidenceSufficiency', 'audienceRelevance',
  'platformNativeness', 'brandVoiceAlignment', 'openingStrength', 'ctaFit',
  'unsupportedClaimsRisk', 'redundancy',
] as const

vi.mock('@/lib/ai/runner', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runPrompt: vi.fn(async (prompt: { id: string }): Promise<any> => {
    if (prompt.id === 'brief-assembly') {
      return {
        narrative: 'We just shipped SSO support for enterprise customers, removing their biggest blocker.',
        proofPlan: 'Cite the SSO launch and early customer reaction.',
        pinnedEvidence: [],
        roleSequence: [
          { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'Announce SSO for enterprise customers' },
          { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'Early customer reaction to SSO' },
        ],
      }
    }
    if (prompt.id === 'rubric') {
      return {
        dimensions: Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, { score: 90, note: 'ok' }])),
        overall: 90,
        critique: ['fine as-is'],
        verdict: 'pass',
      }
    }
    if (prompt.id === 'native-generation-single') {
      return { format: 'single', body: 'Generated post body\nRest of the generated post.', imageBrief: null, scriptBrief: null }
    }
    throw new Error(`studio-promote-brief-end-to-end.test.ts mock: unexpected prompt id "${prompt.id}"`)
  }),
}))

import { promoteDraftToCampaignCore } from '@/lib/campaigns/promote'
import { createStudioDraft, persistSuggestions, acceptSuggestion } from '@/lib/db/studio-drafts'
import { critiqueBrief, approveBriefIfQualified } from '@/lib/campaigns/brief'
import { generatePostsForCampaign } from '@/lib/campaigns/generate'
import { createGenerationSession } from '@/lib/db/post-generation-sessions'

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

    // brand_voices is a DIFFERENT table (voice/tone config, not the learned
    // memory stores above) — buildCustomerContext requires a non-null
    // brandVoice or generatePostsForCampaign refuses with
    // invalid_campaign_state (lib/ai/context.ts). All-default row: only
    // business_id is required (20260430120005_brand_voices.sql).
    const { error: voiceErr } = await admin.from('brand_voices').insert({ business_id: businessId })
    if (voiceErr) throw voiceErr

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
    await admin.from('post_generation_sessions').delete().eq('business_id', businessId)
    await admin.from('posts').delete().eq('business_id', businessId)
    await admin.from('post_ai_originals').delete().eq('business_id', businessId)
    await admin.from('campaign_briefs').delete().eq('business_id', businessId)
    await admin.from('studio_drafts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    await admin.from('brand_voices').delete().eq('business_id', businessId)
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

  // A-9 (Session 29-D, MAJOR-5, D5) — THE regression this correction closes:
  // pre-fix, generatePostsForCampaign's idempotency guard counted the
  // promoted campaign's own pre-existing post (role===null) as "already
  // generated" and returned immediately, so activateCampaign was NEVER
  // reached and the campaign stayed 'awaiting_brief' forever. Driven through
  // REAL Postgres end to end: promote -> critique -> approve -> generate ->
  // activate.
  it('drives a promoted campaign through brief -> generation -> activation, ending active (not stuck at awaiting_brief)', async () => {
    const draftId2 = await createDraft()
    const promoted = await promoteDraftToCampaignCore(authedClient, businessId, draftId2, '2026-09-03T09:00:00.000Z')
    expect(promoted.outcome).toBe('promoted')
    if (promoted.outcome !== 'promoted') return

    await critiqueBrief(promoted.campaignId)
    const approved = await approveBriefIfQualified(promoted.campaignId)
    expect(approved.approved).toBe(true)

    const session = await createGenerationSession(admin, {
      business_id: businessId,
      campaign_id: promoted.campaignId,
      status: 'pending',
      posts_planned: 2,
    })

    const result = await generatePostsForCampaign(promoted.campaignId, businessId, session.id)
    expect(result.postsCreated).toBe(2)

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .select('status, total_posts_planned')
      .eq('id', promoted.campaignId)
      .single()
    if (campErr) throw campErr
    // §2.7 arithmetic, now the live path: 2 brief-derived posts + the 1
    // pre-existing promoted post = 3.
    expect(campaign.status).toBe('active')
    expect(campaign.total_posts_planned).toBe(3)

    const { data: allPosts, error: postsErr } = await admin
      .from('posts')
      .select('id, role')
      .eq('campaign_id', promoted.campaignId)
    if (postsErr) throw postsErr
    expect(allPosts).toHaveLength(3)
    expect(allPosts.filter((p: { role: string | null }) => p.role === null)).toHaveLength(1)
    expect(allPosts.filter((p: { role: string | null }) => p.role !== null)).toHaveLength(2)
  })
})
