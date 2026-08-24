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
  AI_ORIGINAL_SCHEMA_VERSION: 1,
}))

vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: vi.fn(),
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

// ── Imports after mocks ─────────────────────────────────────────────────────

import { generatePostsForCampaign } from './generate'
import { updateGenerationSessionStatus } from '@/lib/db/post-generation-sessions'
import { getCampaignById, activateCampaign } from '@/lib/db/campaigns'
import { getBriefByCampaign, markBriefGenerated } from '@/lib/db/campaign-briefs'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { createPostAiOriginal } from '@/lib/db/post-ai-originals'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { generateNativeContent } from '@/lib/ai/generate-native'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import type { CampaignRow, CampaignBriefRow, PostRow } from '@/lib/db/types'
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

function makeInsertedRows(count: number): PostRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `post-${i}`,
    campaign_id: CAMPAIGN_ID,
    business_id: BUSINESS_ID,
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
    expect(calls).toHaveLength(6)
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
      expect(matchingSnapshot?.schema_version).toBe(1)
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
    vi.mocked(generateNativeContent).mockRejectedValueOnce(new AiError('provider_error', 'SDK error'))

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

describe('generatePostsForCampaign — hook Tier-2 loop (ADR §7, MODE2-HOOK-STANDALONE)', () => {
  it('regenerates EXACTLY ONCE when a single-post opener scores below threshold, then stops (no re-score)', async () => {
    const weak: RubricOutput = { ...highOpenerScore, dimensions: { ...highOpenerScore.dimensions, openingStrength: { score: 40, note: 'weak' } } }
    // Weak score for every rubric call would make EVERY post regenerate; to
    // isolate the ceiling, weaken only the first rubric call.
    vi.mocked(runPrompt).mockReset()
    vi.mocked(runPrompt)
      .mockResolvedValueOnce(weak)
      .mockResolvedValue(highOpenerScore)
    vi.mocked(generateNativeContent).mockReset()
    let nativeCallCount = 0
    vi.mocked(generateNativeContent).mockImplementation(async () => {
      nativeCallCount++
      return makeSingleOutput(nativeCallCount)
    })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    // 6 roleSequence entries, one of which regenerates once = 7 native calls.
    expect(generateNativeContent).toHaveBeenCalledTimes(7)
    // Session 24-D (MINOR-2 correction) — pins the exact double-count the ADR
    // worries about: the trial counter must increment by POSTS CREATED (6,
    // one row per roleSequence entry — createPosts inserts exactly one row
    // per entry regardless of how many native-generation attempts it took),
    // never by the native-CALL count (7, which would double-count the single
    // regenerated post). generate.ts:377 sources this from
    // `postsCreated = inserted.length` (generate.ts:355), not from a
    // native-call counter.
    expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6)
  })

  it('does NOT regenerate when the opener already scores at/above threshold', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    // 6 roleSequence entries, none regenerate = exactly 6 native calls.
    expect(generateNativeContent).toHaveBeenCalledTimes(6)
  })

  it('scores a THREAD opener from posts[0].text, not the whole thread', async () => {
    const threadOutput: ThreadOutput = {
      format: 'thread',
      posts: [
        { text: 'HOOK-TEXT-MARKER', role: 'hook' },
        { text: 'quote', role: 'pull_quote' },
        { text: 'close', role: 'close' },
      ],
      imageBrief: null,
      scriptBrief: null,
    }
    vi.mocked(generateNativeContent).mockReset()
    vi.mocked(generateNativeContent).mockResolvedValue(threadOutput)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const rubricCall = vi.mocked(runPrompt).mock.calls[0][2] as { content: string }
    expect(rubricCall.content).toBe('HOOK-TEXT-MARKER')
  })

  // Session 24-D (MINOR-7 correction) — the opener is the model's own PRIOR
  // output fed back into a second AI call (the rubric); it now goes through
  // neutralize() (wrap-evidence.ts) before reaching runPrompt, same L-9
  // posture as brief.ts's narrative/proofPlan. Proven with content that
  // neutralize() actually changes (a triple-backtick fence, defused to
  // avoid inducing the rubric call to treat it as a code block) — the
  // MARKER-string test above alone can't tell "neutralized" from "untouched"
  // since plain ASCII text with no special chars passes through unchanged.
  it('neutralizes the opener before scoring it — a fence in the opener never reaches the rubric raw (MINOR-7)', async () => {
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

  it('a hook-scoring failure does not abort generation — original content stands', async () => {
    vi.mocked(runPrompt).mockRejectedValue(new Error('rubric scoring hiccup'))

    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(result.postsCreated).toBe(6)
    expect(createPosts).toHaveBeenCalled()
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
    expect(generateNativeContent).toHaveBeenCalledTimes(6)
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
    expect(calls[0][2].platform).toBe('linkedin')
    expect(calls[3][2].platform).toBe('twitter')
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
