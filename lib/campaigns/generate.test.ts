import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/db/post-generation-sessions', () => ({
  updateGenerationSessionStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
  activateCampaign: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: vi.fn(),
  markBriefGenerated: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  listPostsByCampaign: vi.fn(),
  createPosts: vi.fn(),
}))

vi.mock('@/lib/db/post-ai-originals', () => ({
  createPostAiOriginal: vi.fn(),
  AI_ORIGINAL_SCHEMA_VERSION: 2,
}))

vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: vi.fn(),
  withPostQueryContext: vi.fn(),
}))

vi.mock('@/lib/db/brand-voices', () => ({
  getBrandVoice: vi.fn(),
}))

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn(),
}))

vi.mock('@/lib/ai/generate-native', () => ({
  generateNativeContent: vi.fn(),
}))

vi.mock('@/lib/db/trial-state', () => ({
  incrementPostsGeneratedBy: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/campaigns/schedule', () => ({
  schedulePosts: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: vi.fn(),
}))

vi.mock('@/lib/db/generation-budget', () => ({
  reserveGenerationPost: vi.fn(),
  releaseGenerationPost: vi.fn(),
}))

// ADR 0027 §4.2 (K2.9) — generate.ts now binds the campaign's pinned evidence ONCE (bindEvidenceForPrompt: one
// fetch -> the prompt text AND the set of ids sent) and verifies claims against that set. Both are mocked here
// so the existing tests stay about what they were about; the claim behaviour has its own tests below.
vi.mock('@/lib/ai/wrap-evidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/wrap-evidence')>()
  return { ...actual, bindEvidenceForPrompt: vi.fn() }
})
vi.mock('@/lib/memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/memory')>()
  return { ...actual, retrieveEvidenceMemory: vi.fn() }
})

// ── Imports after mocks ─────────────────────────────────────────────────────

import { generatePostsForCampaign } from './generate'
import { updateGenerationSessionStatus } from '@/lib/db/post-generation-sessions'
import { getCampaignById, activateCampaign } from '@/lib/db/campaigns'
import { getBriefByCampaign, markBriefGenerated } from '@/lib/db/campaign-briefs'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { createPostAiOriginal } from '@/lib/db/post-ai-originals'
import { buildCustomerContext, withPostQueryContext } from '@/lib/ai/context'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { runPrompt } from '@/lib/ai/runner'
import { generateNativeContent } from '@/lib/ai/generate-native'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import { getBusinessById } from '@/lib/db/businesses'
import { reserveGenerationPost, releaseGenerationPost } from '@/lib/db/generation-budget'
import { bindEvidenceForPrompt } from '@/lib/ai/wrap-evidence'
import { retrieveEvidenceMemory } from '@/lib/memory'
import type { CampaignRow, CampaignBriefRow, PostRow, BusinessRow } from '@/lib/db/types'
import type { CustomerContext } from '@/lib/ai/context'
import type { RubricOutput } from '@/lib/ai/prompts/rubric'
import type { SinglePostOutput, ThreadOutput } from '@/lib/ai/prompts/formats/schemas'

// ── Fixtures ────────────────────────────────────────────────────────────────

const SESSION_ID = 'session-1'
const CAMPAIGN_ID = 'campaign-1'
const BUSINESS_ID = 'biz-1'
const BRIEF_ID = 'brief-1'

const mockCampaign: CampaignRow = {
  id: CAMPAIGN_ID,
  business_id: BUSINESS_ID,
  name: 'Q2 Launch',
  objective: 'Drive awareness',
  special_instructions: null,
  platforms: ['linkedin', 'twitter'],
  frequency: '3x_week',
  posts_per_week: 3,
  start_date: '2026-06-01',
  end_date: '2026-06-14',
  status: 'awaiting_brief',
  total_posts_planned: 6,
  total_posts_published: 0,
  voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
}

// 3 linkedin + 3 twitter roleSequence entries — mirrors the pre-B2.6 fixture's
// 6-post/2-platform shape so existing "6 posts" assertions still hold.
const mockBrief: CampaignBriefRow = {
  id: BRIEF_ID,
  business_id: BUSINESS_ID,
  campaign_id: CAMPAIGN_ID,
  content: {
    narrative: 'We help B2B SaaS teams post consistently.',
    proofPlan: 'Cite churn-reduction data.',
    pinnedEvidence: [{ evidenceMemoryId: 'ev-1' }],
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
      { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'social proof' },
      { order: 2, role: 'objection_response', platform: 'linkedin', angle: 'address the objection' },
      { order: 3, role: 'conversation_starter', platform: 'twitter', angle: 'a discussion prompt' },
      { order: 4, role: 'follow_up', platform: 'twitter', angle: 'a closing follow-up' },
      { order: 5, role: 'founder_perspective', platform: 'twitter', angle: 'the founder take' },
    ],
  },
  status: 'approved',
  version: 1,
  overall_score: 85,
  critique: { note: 'solid' },
  frozen_at: '2026-06-01T00:00:00.000Z',
  deleted_at: null,
  created_at: '2026-05-15T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  plan_analysis_status: 'not_run',
  plan_analysis_reason: null,
}

const mockCtx: CustomerContext = {
  business: {
    id: BUSINESS_ID,
    name: 'Acme SaaS',
    industry: 'Software',
    description: null,
    language: 'en',
    website: null,
    timezone: 'Europe/London',
  },
  brandVoice: {
    id: 'bv-1',
    business_id: BUSINESS_ID,
    voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
    descriptor: 'A balanced, neutral voice with no strong leanings.',
    tone: ['professional'],
    target_audience: 'Engineering leads',
    keywords: ['data-driven'],
    avoid_words: ['synergy'],
    unique_value_prop: 'Real-time analytics',
    competitors: [],
    writing_examples: [],
    inferred_from_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: {
    isTrial: true,
    postsRemaining: 50,
    campaignsRemaining: 1,
    brandVoiceAttemptsRemaining: 3,
  },
}

const mockCtxPaid: CustomerContext = { ...mockCtx, trialState: null }

// ADR 0024 §7.4/§7.5a (H2.9) — CustomerContext carries no `plan`; the Pro
// daily-cap reservation reads it from a separate getBusinessById call.
// 'trial' by default to match mockCtx's default trialState above; H2.9's
// own describe block below overrides with mockBusinessPro/mockBusinessPlus.
const mockBusiness: BusinessRow = {
  id: BUSINESS_ID,
  name: 'Acme SaaS',
  website: null,
  industry: 'Software',
  description: null,
  logo_url: null,
  owner_id: 'owner-1',
  plan: 'trial',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'Europe/London',
  onboarding_completed: true,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const mockBusinessPro: BusinessRow = { ...mockBusiness, plan: 'pro' }
const mockBusinessPlus: BusinessRow = { ...mockBusiness, plan: 'plus' }

const linkedinDates = ['2026-06-03T09:00:00.000Z', '2026-06-04T09:00:00.000Z', '2026-06-05T09:00:00.000Z']
const twitterDates = ['2026-06-03T12:00:00.000Z', '2026-06-04T12:00:00.000Z', '2026-06-05T12:00:00.000Z']

function makeSingleOutput(i: number): SinglePostOutput {
  return { format: 'single', body: `Post ${i} body\nRest of the post`, imageBrief: null, scriptBrief: null }
}

const highOpenerScore: RubricOutput = {
  dimensions: {
    specificity: { score: 90, note: 'ok' }, originality: { score: 90, note: 'ok' },
    evidenceSufficiency: { score: 90, note: 'ok' }, audienceRelevance: { score: 90, note: 'ok' },
    platformNativeness: { score: 90, note: 'ok' }, brandVoiceAlignment: { score: 90, note: 'ok' },
    openingStrength: { score: 90, note: 'strong opener' }, ctaFit: { score: 90, note: 'ok' },
    unsupportedClaimsRisk: { score: 90, note: 'ok' }, redundancy: { score: 90, note: 'ok' },
  },
  overall: 90,
  critique: ['fine as-is'],
  verdict: 'pass',
}

// ADR 0024 §2.1/§2.7 (H2.7) — a single-entry brief isolates the N=3 fan-out
// to exactly 3 generateNativeContent/runPrompt calls per test, so
// mockResolvedValueOnce sequences map 1:1 onto candidate index without the
// 6-entry fixture's 18-call noise.
const singleEntryBrief: CampaignBriefRow = {
  ...mockBrief,
  content: {
    ...mockBrief.content,
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
    ],
  },
}

// Session 31-D, D6 (MINOR-1) — three same-platform entries so
// reserveGenerationPost's mockResolvedValueOnce chain maps 1:1 onto entry
// order, isolated from the 6-entry fixture's cross-platform noise.
const threeEntryBrief: CampaignBriefRow = {
  ...mockBrief,
  content: {
    ...mockBrief.content,
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
      { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'social proof' },
      { order: 2, role: 'objection_response', platform: 'linkedin', angle: 'address the objection' },
    ],
  },
}

function scoreAt(overall: number): RubricOutput {
  return { ...highOpenerScore, overall }
}

function makeInsertedRows(count: number): PostRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `post-${i}`,
    campaign_id: CAMPAIGN_ID,
    business_id: BUSINESS_ID,
    social_account_id: null,
    platform: (i < 3 ? 'linkedin' : 'twitter') as 'linkedin' | 'twitter',
    content: `Post ${i}`,
    hashtags: [],
    media_urls: [],
    scheduled_at: i < 3 ? linkedinDates[i] : twitterDates[i - 3],
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    status: 'draft' as const,
    role: null,
    rejection_note: null,
    ai_generation_metadata: {},
    publish_attempts: 0,
    last_publish_attempt_at: null,
    last_publish_error: null,
    deleted_at: null,
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // An EMPTY bound set by default: nothing pinned/sent. (A test that cares overrides it.)
  vi.mocked(bindEvidenceForPrompt).mockResolvedValue({ rendered: '', sentIds: new Set<string>() } as never)
  vi.mocked(retrieveEvidenceMemory).mockResolvedValue([])
  vi.mocked(getCampaignById).mockResolvedValue(mockCampaign)
  vi.mocked(getBriefByCampaign).mockResolvedValue(mockBrief)
  vi.mocked(markBriefGenerated).mockResolvedValue({ ...mockBrief, status: 'generated' })
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(buildCustomerContext).mockResolvedValue(mockCtx)
  vi.mocked(activateCampaign).mockResolvedValue({} as never)
  vi.mocked(updateGenerationSessionStatus).mockResolvedValue(undefined)
  vi.mocked(incrementPostsGeneratedBy).mockResolvedValue(undefined)
  vi.mocked(schedulePosts).mockReturnValueOnce(linkedinDates).mockReturnValueOnce(twitterDates)
  vi.mocked(generateNativeContent).mockImplementation(async (_client, _ctx, input) => {
    const idx = mockBrief.content.roleSequence.findIndex((r) => r.angle === input.angle)
    return makeSingleOutput(idx)
  })
  // High opener score by default — hook loop stays quiet unless a test overrides it.
  vi.mocked(runPrompt).mockResolvedValue(highOpenerScore)
  vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(6))
  vi.mocked(createPostAiOriginal).mockResolvedValue({} as never)
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(reserveGenerationPost).mockResolvedValue({} as never)
  vi.mocked(releaseGenerationPost).mockResolvedValue({} as never)
  vi.mocked(getBrandVoice).mockResolvedValue(null)
  // ADR 0024 §5.2b (H2.11) — identity passthrough by default: existing
  // tests assert against `ctx` as generateNativeContent/runPrompt's
  // received context, so an unmocked identity keeps every prior assertion
  // valid. Tests that specifically cover withPostQueryContext's wiring
  // override this.
  vi.mocked(withPostQueryContext).mockImplementation(async (ctx) => ctx)
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generatePostsForCampaign — campaign validation', () => {
  it('sets session failed with invalid_campaign_state when campaign is not awaiting_brief', async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...mockCampaign, status: 'draft' })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'invalid_campaign_state' }),
    )
  })

  it('sets session failed with invalid_campaign_state when business_id does not match', async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...mockCampaign, business_id: 'other-biz' })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'invalid_campaign_state' }),
    )
  })
})

describe('generatePostsForCampaign — idempotency guard (A-9, Session 29-D MAJOR-5)', () => {
  // BYTE-IDENTITY (A-9's required regression) — a non-promoted campaign with
  // at least one GENERATED post (role !== null) still returns
  // already_generated, exactly as before the fix.
  it('sets session failed with already_generated when a generated post exists for campaign', async () => {
    vi.mocked(listPostsByCampaign).mockResolvedValue(
      makeInsertedRows(1).map((p) => ({ ...p, role: 'anchor_thesis' as const })),
    )

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'already_generated' }),
    )
  })

  // A-9's fix, reddens against the pre-fix guard: a promoted campaign's sole
  // existing post has role === null (promote.ts's createPosts call never
  // sets it) and must NOT be counted as "already generated" — generation
  // must proceed.
  it('does NOT treat a promoted campaign\'s human-authored post (role null) as already generated', async () => {
    vi.mocked(listPostsByCampaign).mockResolvedValue(
      makeInsertedRows(1).map((p) => ({ ...p, role: null })),
    )

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).toHaveBeenCalled()
    expect(updateGenerationSessionStatus).not.toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ error_code: 'already_generated' }),
    )
  })
})

describe('generatePostsForCampaign — brief gate (NEW, ADR §11)', () => {
  it('sets session failed with invalid_campaign_state when no brief exists', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'invalid_campaign_state' }),
    )
  })

  it('sets session failed with invalid_campaign_state when the brief is not approved', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue({ ...mockBrief, status: 'critiqued' })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(markBriefGenerated).not.toHaveBeenCalled()
  })

  it('sets session failed with already_generated when markBriefGenerated guard rejects (race)', async () => {
    vi.mocked(markBriefGenerated).mockResolvedValue(null)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'already_generated' }),
    )
  })

  it('claims the brief via markBriefGenerated (approved -> generated) before generating', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(markBriefGenerated).toHaveBeenCalledWith(expect.anything(), BRIEF_ID)
  })
})

describe('generatePostsForCampaign — MODE2-BRIEF-FROZEN', () => {
  it('passes narrative/pinnedEvidenceIds derived from the SAME frozen brief content to every per-platform call', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const calls = vi.mocked(generateNativeContent).mock.calls
    // 6 roleSequence entries x N_CANDIDATES=3 (ADR 0024 §2.1, H2.7).
    expect(calls).toHaveLength(18)
    const narratives = new Set(calls.map((c) => c[2].narrative))
    const evidenceSets = new Set(calls.map((c) => JSON.stringify(c[2].pinnedEvidenceIds)))
    // Every call reads from the identical frozen content — not six different
    // fetches that happened to agree.
    expect(narratives.size).toBe(1)
    expect([...narratives][0]).toBe(mockBrief.content.narrative)
    expect(evidenceSets.size).toBe(1)
    expect(JSON.parse([...evidenceSets][0])).toEqual(['ev-1'])
  })
})

// ADR 0024 §5.1/§5.4 (Session 31, H2.11) — the campaign-level queryContext.
describe('generatePostsForCampaign — campaign-level query context (ADR §5.1/§5.4, H2.11)', () => {
  it('calls buildCustomerContext with {objective, audience, campaignId} — the ONLY caller that passes a queryContext', async () => {
    vi.mocked(getBrandVoice).mockResolvedValue({
      id: 'bv-1', business_id: BUSINESS_ID, voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
      tone: [], target_audience: 'Engineering leads', keywords: [], avoid_words: [], writing_examples: [], competitors: [],
      unique_value_prop: '', inferred_from_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(buildCustomerContext).toHaveBeenCalledWith(BUSINESS_ID, mockCampaign.voice_variation_id, {
      objective: mockCampaign.objective,
      audience: 'Engineering leads',
      campaignId: CAMPAIGN_ID,
    })
  })

  it('audience is undefined, not null or a thrown error, when no brand voice exists yet', async () => {
    vi.mocked(getBrandVoice).mockResolvedValue(null)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(buildCustomerContext).toHaveBeenCalledWith(BUSINESS_ID, mockCampaign.voice_variation_id,
      expect.objectContaining({ audience: undefined }),
    )
  })
})

// ADR 0024 §5.2b (Session 31, H2.11) — per-post refinement wiring.
describe('generatePostsForCampaign — per-post query context (ADR §5.2b, H2.11)', () => {
  it('calls withPostQueryContext once per roleSequence entry, with that entry\'s platform and role', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(withPostQueryContext).toHaveBeenCalledTimes(6) // 6 roleSequence entries
    // Session 31-D, D4 (MAJOR-4): postContext now carries STEP 4's
    // campaign-level queryContext (objective, campaignId — audience is
    // undefined here since getBrandVoice is mocked to null) spread in
    // alongside platform/role, not platform/role alone.
    expect(withPostQueryContext).toHaveBeenCalledWith(mockCtx, {
      objective: mockCampaign.objective,
      campaignId: CAMPAIGN_ID,
      platform: 'linkedin',
      role: 'anchor_thesis',
    })
    expect(withPostQueryContext).toHaveBeenCalledWith(mockCtx, {
      objective: mockCampaign.objective,
      campaignId: CAMPAIGN_ID,
      platform: 'twitter',
      role: 'conversation_starter',
    })
  })

  // Session 31-D, D4 (MAJOR-4). Closing the finding itself: campaignId must
  // actually reach the per-post seam, not just platform/role.
  it('MAJOR-4: campaignId from STEP 4\'s campaign-level queryContext reaches withPostQueryContext for every entry', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const calls = vi.mocked(withPostQueryContext).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const [, postContext] of calls) {
      expect(postContext.campaignId).toBe(CAMPAIGN_ID)
    }
  })

  it('uses the per-post refined context for both generation and judging, not the campaign-level ctx', async () => {
    const refinedCtx = { ...mockCtx, recentPostPerformance: [{ platform: 'linkedin' as const, topContent: 'REFINED' }] }
    vi.mocked(withPostQueryContext).mockResolvedValue(refinedCtx)
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).toHaveBeenCalledWith(expect.anything(), refinedCtx, expect.anything())
    expect(runPrompt).toHaveBeenCalledWith(expect.anything(), refinedCtx, expect.anything())
  })
})

describe('generatePostsForCampaign — post_ai_originals snapshot write (ADR 0018 §2.6)', () => {
  it('writes one post_ai_originals row per created post', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(createPostAiOriginal).toHaveBeenCalledTimes(6)
  })

  it('rendered_content is byte-identical to the content that lands in the posts insert row (single format)', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const insertedPosts = vi.mocked(createPosts).mock.calls[0][1]
    const snapshotCalls = vi.mocked(createPostAiOriginal).mock.calls.map((c) => c[1])

    for (const post of insertedPosts) {
      const matchingSnapshot = snapshotCalls.find((s) => s.post_id === post.id)
      expect(matchingSnapshot).toBeDefined()
      expect(matchingSnapshot?.rendered_content).toBe(post.content)
      expect(matchingSnapshot?.generation_kind).toBe('initial')
      expect(matchingSnapshot?.revision).toBe(1)
      expect(matchingSnapshot?.schema_version).toBe(2)
    }
  })

  it('payload round-trips a thread output\'s posts[] array intact (§2.3 — the whole reason payload exists)', async () => {
    const threadOutput: ThreadOutput = {
      format: 'thread',
      posts: [
        { text: 'Hook text', role: 'hook' },
        { text: 'Body text', role: 'body' },
        { text: 'Close text', role: 'close' },
      ],
      imageBrief: null,
      scriptBrief: null,
    }
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockResolvedValue(threadOutput)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const snapshotCalls = vi.mocked(createPostAiOriginal).mock.calls.map((c) => c[1])
    expect(snapshotCalls.length).toBeGreaterThan(0)
    for (const snapshot of snapshotCalls) {
      expect(snapshot.format).toBe('thread')
      expect(snapshot.payload).toEqual(threadOutput)
      const payload = snapshot.payload as ThreadOutput
      expect(payload.posts).toHaveLength(3)
      expect(payload.posts[0].text).toBe('Hook text')
    }
  })

  // ADR 0026 §4.3 (J2.4, OUTCOME-HOOKTYPE-ADDITIVE) — hookType is a TAG about the
  // post, never part of it. It must reach the stored snapshot payload (the tagging
  // trigger reads NEW.payload->>'hookType' from exactly there) and must NEVER leak
  // into the content a customer approves and publishes.
  it('hookType rides in the snapshot payload and never in the post content', async () => {
    const withHook = { ...makeSingleOutput(7), hookType: 'statistic' as const }
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockResolvedValue(withHook)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const snapshots = vi.mocked(createPostAiOriginal).mock.calls.map((c) => c[1])
    expect(snapshots.length).toBeGreaterThan(0)
    for (const snapshot of snapshots) {
      expect((snapshot.payload as { hookType?: string }).hookType).toBe('statistic')
      expect(snapshot.payload).toEqual(withHook)
      expect(snapshot.rendered_content).toBe(withHook.body)
      expect(snapshot.rendered_content).not.toMatch(/statistic|hookType/i)
    }

    const inserted = vi.mocked(createPosts).mock.calls.flatMap((c) => c[1] as Array<{ content: string }>)
    expect(inserted.length).toBeGreaterThan(0)
    for (const row of inserted) {
      expect(row.content).toBe(withHook.body)
      expect(row.content).not.toMatch(/statistic|hookType/i)
    }
  })

  // silent-failure-hunter's concern: a snapshot write that fails must not be
  // silently swallowed — it must fail the whole generation session loudly,
  // since it is the ground truth of the entire learning-capture track.
  it('a snapshot write failure propagates and fails the session — it is NOT silently swallowed', async () => {
    vi.mocked(createPostAiOriginal).mockRejectedValueOnce(new Error('snapshot insert failed'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(0)
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed' }),
    )
  })
})

describe('generatePostsForCampaign — role assignment (write-once, ADR §3.2)', () => {
  it('assigns each PostInsert the role from its originating roleSequence entry', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const insertedPosts = vi.mocked(createPosts).mock.calls[0][1]
    const roles = insertedPosts.map((p) => p.role)
    expect(roles).toEqual([
      'anchor_thesis', 'customer_proof', 'objection_response',
      'conversation_starter', 'follow_up', 'founder_perspective',
    ])
  })
})

describe('generatePostsForCampaign — generateNativeContent failure', () => {
  it('sets session failed, inserts zero posts, does not activate or increment', async () => {
    const { AiError } = await import('@/lib/ai/errors')
    vi.mocked(generateNativeContent).mockReset()
    // ADR 0024 §2.3 (H2.7) — HARD FAIL requires 0 of N_CANDIDATES=3 to
    // succeed; a single mockRejectedValueOnce would leave the other 2
    // concurrent candidates resolving to `undefined` (no implementation
    // queued), which is not the "0 generated" case this test means to prove.
    vi.mocked(generateNativeContent).mockRejectedValue(new AiError('provider_error', 'SDK error'))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(createPosts).not.toHaveBeenCalled()
    expect(activateCampaign).not.toHaveBeenCalled()
    expect(incrementPostsGeneratedBy).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'provider_error' }),
    )
  })
})

// ADR 0024 §2.9 (Session 31, H2.5) — the judge REPLACES the openingStrength
// retry (formerly 'generatePostsForCampaign — hook Tier-2 loop (ADR §7,
// MODE2-HOOK-STANDALONE)', now retired). Every one of that block's five test
// cases is mapped forward individually, per §4.4, rather than deleted
// wholesale:
//   opener-scored-against-rubric      -> QUAL-JUDGE-RUBRIC-UNFORKED (below)
//   opener-neutralized                -> QUAL-CANDIDATE-NEUTRALIZED (below)
//   scoring-failure-does-not-abort    -> kept below, renamed for the judge
//   regeneration-fires-below-threshold -> QUAL-BELOW-THRESHOLD-SURFACED (H2.7 — placeholder only, not yet implemented)
//   regeneration-fires-at-most-once    -> QUAL-N-CANDIDATE-COUNT (H2.7 — placeholder only, not yet implemented)
// N is still 1 in this step — regeneration is REMOVED, not replaced by a
// fan-out yet, so there is no "regenerates once" behavior left to test here.
describe('generatePostsForCampaign — full-rubric judge (ADR 0024 §2.6, QUAL-JUDGE-RUBRIC-UNFORKED)', () => {
  it('scores the WHOLE candidate content (joinContent), not just the opener', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    // 6 roleSequence entries x N_CANDIDATES=3 (ADR 0024 §2.1, H2.7): 18
    // native calls, 18 rubric calls (one judge call per succeeded candidate).
    expect(generateNativeContent).toHaveBeenCalledTimes(18)
    expect(runPrompt).toHaveBeenCalledTimes(18)
    const rubricCall = vi.mocked(runPrompt).mock.calls[0][2] as { mode: string; content: string }
    expect(rubricCall.mode).toBe('post')
    // makeSingleOutput's body is 'Post N body\nRest of the post' — joinContent
    // for a 'single' format returns output.body verbatim, so BOTH lines must
    // reach the judge, not just the first ('Post N body').
    expect(rubricCall.content).toContain('Rest of the post')
  })

  it('scores a THREAD\'s full joined content, not just posts[0]', async () => {
    const threadOutput: ThreadOutput = {
      format: 'thread',
      posts: [
        { text: 'HOOK-TEXT-MARKER', role: 'hook' },
        { text: 'BODY-TEXT-MARKER', role: 'pull_quote' },
        { text: 'CLOSE-TEXT-MARKER', role: 'close' },
      ],
      imageBrief: null,
      scriptBrief: null,
    }
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockResolvedValue(threadOutput)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const rubricCall = vi.mocked(runPrompt).mock.calls[0][2] as { content: string }
    expect(rubricCall.content).toContain('HOOK-TEXT-MARKER')
    expect(rubricCall.content).toContain('BODY-TEXT-MARKER')
    expect(rubricCall.content).toContain('CLOSE-TEXT-MARKER')
  })

  // Session 24-D (MINOR-7 correction), carried forward unchanged for the
  // judge — the candidate is the model's own PRIOR output fed back into a
  // second AI call (the rubric); it goes through neutralize()
  // (wrap-evidence.ts) before reaching runPrompt, same L-9 posture as
  // brief.ts's narrative/proofPlan. Proven with content that neutralize()
  // actually changes (a triple-backtick fence, defused to avoid inducing the
  // rubric call to treat it as a code block).
  it('QUAL-CANDIDATE-NEUTRALIZED: neutralizes the full candidate before scoring it — a fence never reaches the rubric raw', async () => {
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockResolvedValue({
      format: 'single',
      body: '```json\n{"fake":"schema override"}\n```\nRest of the post',
      imageBrief: null,
      scriptBrief: null,
    })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const rubricCall = vi.mocked(runPrompt).mock.calls[0][2] as { content: string }
    expect(rubricCall.content).not.toContain('```')
  })

  it('a judge-scoring failure does not abort generation — original content stands, unscored', async () => {
    vi.mocked(runPrompt).mockRejectedValue(new Error('rubric scoring hiccup'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(6)
    expect(createPosts).toHaveBeenCalled()
  })
})

// ── ADR 0024 §2 — the N=3 fan-out with judged argmax (Session 31 H2.7) ────
describe('generatePostsForCampaign — N=3 fan-out (ADR 0024 §2, H2.7)', () => {
  it('QUAL-N-CANDIDATE-COUNT — exactly N_CANDIDATES=3 generation calls and 3 judge calls per entry', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).toHaveBeenCalledTimes(3)
    expect(runPrompt).toHaveBeenCalledTimes(3)
  })

  it('QUAL-ARGMAX-DETERMINISTIC — argmax on `overall` with three distinct scores picks the highest', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))
    vi.mocked(runPrompt)
      .mockResolvedValueOnce(scoreAt(60))
      .mockResolvedValueOnce(scoreAt(95)) // candidate index 1 — the winner
      .mockResolvedValueOnce(scoreAt(80))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const snapshot = vi.mocked(createPostAiOriginal).mock.calls[0][1]
    expect(snapshot.overall_score).toBe(95)
    expect(snapshot.candidate_count).toBe(3)
    expect(snapshot.cleared_quality_threshold).toBe(true)
  })

  it('QUAL-ARGMAX-DETERMINISTIC — a deliberate tie goes to the LOWEST candidate index, meaningless without distinct candidate content', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))
    // Three DISTINCT candidate payloads — without this, every argmax
    // assertion below would pass on a 3-way tie and prove nothing (ADR
    // §4.5 blocker 2 / H2.3's own stated purpose).
    vi.mocked(generateNativeContent)
      .mockReset()
      .mockResolvedValueOnce(makeSingleOutput(100))
      .mockResolvedValueOnce(makeSingleOutput(101))
      .mockResolvedValueOnce(makeSingleOutput(102))
    vi.mocked(runPrompt)
      .mockResolvedValueOnce(scoreAt(90)) // candidate 0 — ties, must win
      .mockResolvedValueOnce(scoreAt(90)) // candidate 1 — ties, must lose
      .mockResolvedValueOnce(scoreAt(70)) // candidate 2

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const insertedPost = vi.mocked(createPosts).mock.calls[0][1][0]
    expect(insertedPost.content).toBe('Post 100 body\nRest of the post')
  })

  it('QUAL-THREE-OUTCOMES — hard fail when 0 of N candidates generate', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    const { AiError } = await import('@/lib/ai/errors')
    vi.mocked(generateNativeContent).mockReset().mockRejectedValue(new AiError('provider_error', 'all three failed'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(0)
    expect(createPosts).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'provider_error' }),
    )
  })

  it('QUAL-THREE-OUTCOMES — unscored: every judge call throws, proceeds unscored/ungated and does NOT fail the session', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))
    vi.mocked(runPrompt).mockRejectedValue(new Error('judge hiccup'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(1)
    const snapshot = vi.mocked(createPostAiOriginal).mock.calls[0][1]
    expect(snapshot.overall_score).toBeNull()
    expect(snapshot.dimension_scores).toBeNull()
    expect(snapshot.candidate_count).toBe(3)
    // Absent badge must not read as a passing one (ADR §8.3) — null, never
    // a defaulted false.
    expect(snapshot.cleared_quality_threshold).toBeNull()
  })

  it('QUAL-THREE-OUTCOMES — partial generation failure: argmax runs over the surviving candidates only', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))
    vi.mocked(generateNativeContent)
      .mockReset()
      .mockResolvedValueOnce(makeSingleOutput(1)) // candidate 0 succeeds
      .mockRejectedValueOnce(new Error('candidate 1 failed'))
      .mockResolvedValueOnce(makeSingleOutput(3)) // candidate 2 succeeds
    // Only the two survivors are judged, in candidate-index order (0 then 2).
    vi.mocked(runPrompt)
      .mockResolvedValueOnce(scoreAt(70))
      .mockResolvedValueOnce(scoreAt(95))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(1)
    expect(runPrompt).toHaveBeenCalledTimes(2)
    const snapshot = vi.mocked(createPostAiOriginal).mock.calls[0][1]
    expect(snapshot.candidate_count).toBe(2)
    expect(snapshot.overall_score).toBe(95)
    const insertedPost = vi.mocked(createPosts).mock.calls[0][1][0]
    expect(insertedPost.content).toBe('Post 3 body\nRest of the post')
  })

  it('QUAL-BELOW-THRESHOLD-SURFACED — all candidates below 70: best of the set is persisted and flagged, session is NOT failed', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))
    vi.mocked(runPrompt)
      .mockResolvedValueOnce(scoreAt(50))
      .mockResolvedValueOnce(scoreAt(65)) // best of the set, still below 70
      .mockResolvedValueOnce(scoreAt(40))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(1)
    expect(updateGenerationSessionStatus).not.toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed' }),
    )
    const snapshot = vi.mocked(createPostAiOriginal).mock.calls[0][1]
    expect(snapshot.overall_score).toBe(65)
    expect(snapshot.cleared_quality_threshold).toBe(false)
  })

  // Completes the two H2.6 constraints whose generate.ts half was deferred
  // to this step (docs/build-guide/session-31.md H2.6/H2.7).
  it('QUAL-TRIAL-UNIT-PER-POST — the N=3 fan-out (18 candidate generations for 6 entries) still consumes exactly 1 trial post per entry, not per candidate', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).toHaveBeenCalledTimes(18)
    expect(incrementPostsGeneratedBy).toHaveBeenCalledTimes(1)
    expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6) // not 18
  })

  it('QUAL-RATE-LIMIT-COUNTS-CALLS — concurrency per entry never exceeds N_CANDIDATES=3 (the overshoot bound from H2.6)', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    // Bounding the fan-out to exactly N=3 IS the N-1=2 overshoot bound
    // (ADR §2.2) — proven here as "never more than N calls per entry",
    // the runner-level rate-limit mechanics themselves live in
    // lib/ai/runner.test.ts (H2.6).
    expect(generateNativeContent).toHaveBeenCalledTimes(3)
  })
})

// QUAL-HOOK-RETRY-REMOVED (Tier 3, diff-verified — no runtime test): zero
// remaining references to the removed openingStrength-retry block
// (extractOpener, the `regenerationCount = 1` branch, the second
// generateNativeContent call gated on a threshold comparison). Confirmed by
// `git grep -n "extractOpener\|openingStrength.score <" lib/campaigns/generate.ts`
// returning no matches as of this commit.
//
// QUAL-RUBRIC-UNCHANGED (Tier 3, diff-verified — no runtime test): rubric.ts
// itself is untouched by H2.5 — ten dimensions, no rename,
// RubricOutputSchema byte-unchanged, its §6.1 invariant comment intact. The
// judge is a NEW caller of the EXISTING rubricPrompt at mode:'post', not a
// fork of it.

// ADR 0024 §7.4/§7.5/§7.5a — the Pro daily post cap (A-1, H2.9). App-layer
// half of QUAL-PRO-DAILY-POST-CAP: the reservation happens ONCE per entry,
// BEFORE the fan-out, never per candidate — the Tier-1 15-post ceiling
// itself lives in supabase/__tests__.
describe('generatePostsForCampaign — Pro daily post cap (ADR §7.5a, H2.9)', () => {
  it('reserves exactly ONE unit before the fan-out for a Pro business — not once per candidate', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPro)
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(reserveGenerationPost).toHaveBeenCalledTimes(1)
    expect(reserveGenerationPost).toHaveBeenCalledWith(BUSINESS_ID, 15)
    expect(generateNativeContent).toHaveBeenCalledTimes(3) // N=3 candidates, still ONE reservation
  })

  it('does NOT reserve for a Plus business — bounded by its own monthly cap instead', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPlus)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(reserveGenerationPost).not.toHaveBeenCalled()
  })

  it('does NOT reserve for a trial business — bounded by AI_TRIAL_POST_CAP at STEP 5 instead', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusiness) // plan: 'trial'

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(reserveGenerationPost).not.toHaveBeenCalled()
  })

  it('fails the session with daily_quota_exceeded — a code distinct from the trial cap — when the reservation is refused', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPro)
    vi.mocked(reserveGenerationPost).mockResolvedValue(null)

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(0)
    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'daily_quota_exceeded' }),
    )
  })

  it('releases the reserved unit when the generation hard-fails (0 of N candidates)', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPro)
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    const { AiError } = await import('@/lib/ai/errors')
    vi.mocked(generateNativeContent).mockReset().mockRejectedValue(new AiError('provider_error', 'all three failed'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(0)
    expect(releaseGenerationPost).toHaveBeenCalledTimes(1)
    expect(releaseGenerationPost).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it('does NOT release the unit when the generation succeeds — a generation keeps its unit regardless of candidate count', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPro)
    vi.mocked(getBriefByCampaign).mockResolvedValue(singleEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z'])
    vi.mocked(createPosts).mockResolvedValue(makeInsertedRows(1))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(releaseGenerationPost).not.toHaveBeenCalled()
  })

  // Session 31-D, D6 (MINOR-1). Before this fix, a mid-campaign reservation
  // refusal left every EARLIER entry's already-reserved unit stranded: the
  // whole session fails with postsCreated: 0 (no posts are ever inserted —
  // STEP 8's createPosts runs only after the entry loop completes), but
  // those units stayed consumed against the day's cap forever.
  it('MINOR-1: releases every unit reserved by earlier entries when entry 2 of 3 is refused mid-campaign', async () => {
    vi.mocked(getBusinessById).mockResolvedValue(mockBusinessPro)
    vi.mocked(getBriefByCampaign).mockResolvedValue(threeEntryBrief)
    vi.mocked(schedulePosts).mockReset().mockReturnValue(['2026-06-03T09:00:00.000Z', '2026-06-04T09:00:00.000Z', '2026-06-05T09:00:00.000Z'])
    // Entry 1 reserves successfully; entry 2's reservation is refused.
    vi.mocked(reserveGenerationPost)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce(null)

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(0)
    // Entry 1's unit is released; entry 2's own reservation never succeeded,
    // so there is nothing of its own to release — exactly ONE release call,
    // not zero (the pre-fix behaviour) and not two.
    expect(releaseGenerationPost).toHaveBeenCalledTimes(1)
    expect(releaseGenerationPost).toHaveBeenCalledWith(BUSINESS_ID)
    // Entry 3 is never reached — the session fails at entry 2.
    expect(generateNativeContent).toHaveBeenCalledTimes(3) // entry 1's N=3 fan-out only
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'daily_quota_exceeded' }),
    )
  })
})

describe('generatePostsForCampaign — trial pre-flight', () => {
  it('sets session failed with quota_exceeded when postsRemaining < roleSequence.length', async () => {
    vi.mocked(buildCustomerContext).mockResolvedValue({
      ...mockCtx,
      trialState: { isTrial: true, postsRemaining: 2, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 3 },
    })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'quota_exceeded' }),
    )
  })

  it('does NOT block paid plans even when postsRemaining would be 0', async () => {
    vi.mocked(buildCustomerContext).mockResolvedValue(mockCtxPaid)
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    // 6 roleSequence entries x N_CANDIDATES=3 (ADR 0024 §2.1, H2.7).
    expect(generateNativeContent).toHaveBeenCalledTimes(18)
  })
})

describe('generatePostsForCampaign — success path', () => {
  it('returns sessionId and postsCreated', async () => {
    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(result).toEqual({ sessionId: SESSION_ID, postsCreated: 6 })
  })

  it('inserts posts with business_id from param, not campaign row', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    const insertedPosts = vi.mocked(createPosts).mock.calls[0][1]
    for (const post of insertedPosts) {
      expect(post.business_id).toBe(BUSINESS_ID)
    }
  })

  // ADR 0022 §2.7 — ACTIVATE-PLANNED-UNCHANGED: activateCampaign's `planned`
  // argument is now `postsCreated + existingPosts.length` (the promoted-
  // campaign fix), not bare `postsCreated`. For every NON-promoted campaign
  // — this test's fixture, via the default listPostsByCampaign mock at
  // beforeEach's `mockResolvedValue([])` — existingPosts.length is 0, so the
  // value is BYTE-IDENTICAL to before the fix: 6, not 6 + something.
  it('updates campaign to active (guarded on awaiting_brief) with actual inserted post count — unchanged for a non-promoted campaign', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(activateCampaign).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, 6)
  })

  // A-9 (Session 29-D, MAJOR-5) — §2.7's arithmetic on the LIVE path: a
  // promoted campaign's one pre-existing post (role === null) now clears the
  // idempotency guard (see the guard's own describe block above) and reaches
  // this line, where existingPosts.length is 1 — so `planned` is the brief-
  // derived 6 generated posts PLUS that 1 pre-existing post = 7.
  it('reaches activateCampaign for a promoted campaign and plans generated + pre-existing posts (§2.7, now reachable)', async () => {
    vi.mocked(listPostsByCampaign).mockResolvedValue(
      makeInsertedRows(1).map((p) => ({ ...p, role: null })),
    )

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(generateNativeContent).toHaveBeenCalled()
    expect(activateCampaign).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, 7)
  })

  it('increments trial counter by postsCreated', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6)
  })

  it('marks session complete with posts_created and completed_at', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'complete', posts_created: 6 }),
    )
  })
})

describe('generatePostsForCampaign — platform grouping (from roleSequence, not an even split)', () => {
  it('calls platforms in canonical order (linkedin before twitter)', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    const calls = vi.mocked(generateNativeContent).mock.calls
    // 3 linkedin entries x N_CANDIDATES=3 = 9 calls before twitter starts
    // (ADR 0024 §2.1, H2.7).
    expect(calls[0][2].platform).toBe('linkedin')
    expect(calls[9][2].platform).toBe('twitter')
  })

  it('calls schedulePosts once per active platform, sized by that platform\'s roleSequence entries', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(schedulePosts).toHaveBeenCalledTimes(2)
    expect(schedulePosts).toHaveBeenCalledWith(expect.objectContaining({ platform: 'linkedin', count: 3 }))
    expect(schedulePosts).toHaveBeenCalledWith(expect.objectContaining({ platform: 'twitter', count: 3 }))
  })
})

describe('generatePostsForCampaign — consistency pass wiring (ADR §8)', () => {
  it('aborts with consistency_check_failed and inserts nothing on a tweet-1 link violation', async () => {
    const badThread: ThreadOutput = {
      format: 'thread',
      posts: [
        { text: 'Check this out https://example.com', role: 'hook' },
        { text: 'quote', role: 'pull_quote' },
        { text: 'close', role: 'close' },
      ],
      imageBrief: null,
      scriptBrief: null,
    }
    vi.mocked(generateNativeContent).mockResolvedValue(badThread)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(createPosts).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'consistency_check_failed' }),
    )
  })

  // Session 24-D (MINOR-6 correction) — checkRoleCoverage's own unit tests
  // (consistency.test.ts) already prove the pure function is correct in
  // isolation, but that alone doesn't prove generate.ts's real STEP 7 loop
  // can actually PRODUCE a `generated` set narrower than `roleSequence` for
  // checkRoleCoverage to catch — under today's control flow, activePlatforms
  // is built by filtering CANONICAL_PLATFORM_ORDER against roleSequence, so
  // every entry whose platform IS one of the five canonical platforms gets
  // iterated 1:1. This orchestrator-level test drives the ACTUAL reachable
  // gap: a roleSequence entry citing a platform outside
  // CANONICAL_PLATFORM_ORDER (a corrupted/future-schema brief — freezeBrief
  // does not validate platform values, only status/frozen_at) is silently
  // never iterated by the STEP 7 loop, so `generated` ends up short by
  // exactly that one entry. This is the safety net a future "continue on
  // per-post error" refactor (ADR §7/§8 note) must not be able to silently
  // lose — pinned here against the REAL orchestrator, not just the pure
  // function.
  it('ORCHESTRATOR-LEVEL: a roleSequence entry citing a platform outside CANONICAL_PLATFORM_ORDER is never generated — checkRoleCoverage catches the gap and aborts (MINOR-6)', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue({
      ...mockBrief,
      content: {
        ...mockBrief.content,
        roleSequence: [
          ...mockBrief.content.roleSequence,
          { order: 99, role: 'follow_up', platform: 'pinterest' as never, angle: 'not a launch platform yet' },
        ],
      },
    })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(createPosts).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(), SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'consistency_check_failed' }),
    )
  })
})

// ── ADR 0027 §4 (Session 34 K2.9) — claim verification wiring ───────────────────────────────────────────────
//
// AGENCY-CLAIM-EVIDENCE-TRACEABLE (19), AGENCY-CLAIM-NO-CORPUS-DISTINCT (20), AGENCY-CLAIMS-FLAGGED-NEVER-EDITED
// (18, Tier-2 half). The verdict rides in ai_generation_metadata.claimCheck; posts.content is never touched and no
// post is ever dropped. The pure verifier is exercised in verify-claims.test.ts; THIS block proves the wiring:
// the set the verifier uses is the set that was SENT (bound once), never a second read.
//
// SHARED-FUNCTION CALLERS: generatePostsForCampaign has one production caller (generate-action.ts); its callers'
// tests are unchanged by this block. generateNativeContent's callers: generate.ts (passes `evidence`) and the
// regeneration path (does not) — generate-native.test.ts covers both shapes.
describe('generatePostsForCampaign — claim verification (ADR 0027 §4)', () => {
  const CLAIM = 'We cut churn by 42% in Q3.'
  type TestClaim = { text: string; evidenceMemoryId?: string | null }
  const claimingOutput = (idx: number, claims: TestClaim[]): SinglePostOutput => ({
    format: 'single',
    body: `Update ${idx}: ${CLAIM}\nRest of the post ${idx}`,
    imageBrief: null,
    scriptBrief: null,
    claims,
  })
  const withClaims = (claims: TestClaim[]) => {
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockImplementation(async (_c, _x, input) => {
      const idx = mockBrief.content.roleSequence.findIndex((r) => r.angle === input.angle)
      return claimingOutput(idx, claims)
    })
  }
  const sent = (ids: string[]) =>
    vi.mocked(bindEvidenceForPrompt).mockResolvedValue({ rendered: ids.map((i) => `Evidence id: ${i}`).join('\n'), sentIds: new Set(ids) } as never)
  const insertedPosts = () => vi.mocked(createPosts).mock.calls[0][1]
  type CheckedClaim = { outcome: string; span: { start: number; end: number } | null; evidenceMemoryId?: string }
  const checkOf = (post: { ai_generation_metadata?: unknown }) =>
    (post.ai_generation_metadata as { claimCheck?: { status: string; claims?: CheckedClaim[] } }).claimCheck

  it('a claim citing an id that WAS in the sent set is recorded as supported, with the id and a span into the post text', async () => {
    sent(['ev-1'])
    withClaims([{ text: CLAIM, evidenceMemoryId: 'ev-1' }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) {
      const check = checkOf(post)
      expect(check?.status).toBe('checked')
      const claim = check!.claims![0]
      expect(claim.outcome).toBe('supported')
      expect(claim.evidenceMemoryId).toBe('ev-1')
      const start = post.content.indexOf(CLAIM)
      expect(claim.span).toEqual({ start, end: start + CLAIM.length })
      // every rendered byte comes from the post itself
      expect(post.content.slice(claim.span!.start, claim.span!.end)).toBe(CLAIM)
    }
  })

  it('a CROSS-TENANT id (not in the sent set) is FABRICATED — and the foreign id is never persisted', async () => {
    sent(['ev-1'])
    withClaims([{ text: CLAIM, evidenceMemoryId: 'ev-OTHER-TENANT' }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) {
      const claim = checkOf(post)!.claims![0]
      expect(claim.outcome).toBe('fabricated')
      expect(claim).not.toHaveProperty('evidenceMemoryId')
      expect(JSON.stringify(post.ai_generation_metadata)).not.toContain('ev-OTHER-TENANT')
    }
  })

  it('a claim with no evidenceMemoryId is unsupported', async () => {
    sent(['ev-1'])
    withClaims([{ text: CLAIM }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) expect(checkOf(post)!.claims![0].outcome).toBe('unsupported')
  })

  it('REDDEN: a row PROMOTED AFTER the prompt was sent cannot legitimise a citation — the evidence is bound ONCE, never re-fetched', async () => {
    // First (and only legitimate) bind: {ev-1}. Any SECOND bind would see the promotion and return {ev-1, ev-promoted}.
    vi.mocked(bindEvidenceForPrompt)
      .mockResolvedValueOnce({ rendered: 'Evidence id: ev-1', sentIds: new Set(['ev-1']) } as never)
      .mockResolvedValue({ rendered: 'Evidence id: ev-1\nEvidence id: ev-promoted', sentIds: new Set(['ev-1', 'ev-promoted']) } as never)
    withClaims([{ text: CLAIM, evidenceMemoryId: 'ev-promoted' }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(bindEvidenceForPrompt).toHaveBeenCalledTimes(1)
    for (const post of insertedPosts()) expect(checkOf(post)!.claims![0].outcome).toBe('fabricated')
  })

  it('every candidate call is handed the SAME bound evidence object (prompt and oracle cannot drift)', async () => {
    sent(['ev-1'])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    const bound = await vi.mocked(bindEvidenceForPrompt).mock.results[0].value
    const calls = vi.mocked(generateNativeContent).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call[2].evidence).toBe(bound)
  })

  it('NO CORPUS: nothing sent AND no active evidence -> "no_corpus", never "N unsupported claims"', async () => {
    sent([])
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([])
    withClaims([{ text: CLAIM }, { text: 'It is the fastest tool.' }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) expect(checkOf(post)).toEqual({ status: 'no_corpus' })
  })

  it('evidence EXISTS but none was pinned: the claims really are uncited, so they ARE flagged (not no_corpus)', async () => {
    sent([])
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([{ id: 'ev-9' }] as never)
    withClaims([{ text: CLAIM }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) expect(checkOf(post)?.status).toBe('checked')
  })

  it('a post with no claims is recorded as no_claims (checked, and clean of assertions)', async () => {
    sent(['ev-1'])
    withClaims([])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    for (const post of insertedPosts()) expect(checkOf(post)).toEqual({ status: 'no_claims' })
  })

  it('FLAGGED, NEVER EDITED, NEVER WITHHELD: content is unchanged and every post is inserted even when every claim is fabricated', async () => {
    sent(['ev-1'])
    withClaims([{ text: CLAIM, evidenceMemoryId: 'ev-x' }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    const posts = insertedPosts()
    expect(posts.length).toBe(mockBrief.content.roleSequence.length)
    for (const post of posts) expect(post.content).toContain(CLAIM)
    // the session did not fail, and nothing was rejected
    expect(updateGenerationSessionStatus).not.toHaveBeenCalledWith(expect.anything(), SESSION_ID, expect.objectContaining({ status: 'failed' }))
  })

  it('the corpus lookup FAILING leaves claimCheck absent ("not checked") — it never fails generation and never reads as clean', async () => {
    sent([])
    vi.mocked(retrieveEvidenceMemory).mockRejectedValue(new Error('memory down'))
    withClaims([{ text: CLAIM }])
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    const posts = insertedPosts()
    expect(posts.length).toBe(mockBrief.content.roleSequence.length)
    for (const post of posts) expect(checkOf(post)).toBeUndefined()
  })
})
