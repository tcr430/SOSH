import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── MAJOR-4 (Session 23 review) · SHARED-FUNCTION CALLERS (CLAUDE.md) ──────
// ── B2.6 update — MODE2-CONTEXT-EQUIVALENT ─────────────────────────────────
//
// generate.test.ts — the existing suite for this caller — MOCKS
// buildCustomerContext. That is correct for testing generate.ts's own
// orchestration, but it means a CustomerContext rewire would be invisible to
// it: the mock returns whatever the test hands it.
//
// This file is deliberately the opposite: buildCustomerContext and runPrompt
// are REAL. Only the lib/db layer beneath them and the Anthropic client above
// them are mocked.
//
// B2.6 STOP-and-show finding (surfaced to the user, confirmed how to
// proceed): generatePostsForCampaign no longer calls postGenerationPrompt at
// all — Stage D calls generate-native.ts's per-platform native-generation
// prompt instead, driven by the frozen brief. buildCustomerContext ITSELF is
// still called identically (same args, same shape, byte-for-byte unchanged —
// asserted directly below). But native-generation-prompt.ts (B2.4) and
// briefAssemblyPrompt (B2.5) do NOT render ctx.recentPostPerformance or
// ctx.recentCampaigns into any prompt — Mode 2 delegates "what to argue" to
// the frozen brief's narrative/proofPlan/pinnedEvidence, not to freshly-
// considered performance patterns. That data is still computed (capped,
// governed-preferred, correctly) by buildCustomerContext, but is no longer
// rendered downstream in this caller — so the capping/governed-preference
// claims below are proven by calling buildCustomerContext directly with the
// same args generate.ts uses, not by grepping a prompt that structurally no
// longer contains them. Voice resolution IS still asserted against the real
// rendered prompt text, because native-generation-prompt.ts DOES render
// brandVoice.

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      AI_TRIAL_BRAND_VOICE_ATTEMPTS: 3,
      AI_TRIAL_POST_CAP: 50,
      AI_TRIAL_CAMPAIGN_CAP: 1,
      AI_RATE_LIMIT_BRAND_VOICE_PER_MIN: 10,
      AI_RATE_LIMIT_POST_GENERATION_PER_MIN: 30,
    },
  },
}))

// generate.ts's own collaborators
vi.mock('@/lib/db/post-generation-sessions', () => ({
  updateGenerationSessionStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/campaigns/schedule', () => ({
  schedulePosts: vi.fn(),
}))
vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: vi.fn(),
  markBriefGenerated: vi.fn(),
}))

// The lib/db layer buildCustomerContext + lib/memory read through.
vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
  activateCampaign: vi.fn().mockResolvedValue({}),
  listCampaigns: vi.fn(),
}))
vi.mock('@/lib/db/posts', () => ({
  listPostsByCampaign: vi.fn(),
  createPosts: vi.fn(),
  listPostsByIds: vi.fn(),
}))

vi.mock('@/lib/db/post-ai-originals', () => ({
  createPostAiOriginal: vi.fn(),
  AI_ORIGINAL_SCHEMA_VERSION: 1,
}))
vi.mock('@/lib/db/businesses', () => ({ getBusinessById: vi.fn() }))
vi.mock('@/lib/db/brand-voices', () => ({ getBrandVoice: vi.fn() }))
vi.mock('@/lib/db/voice', () => ({ getVariationForBusiness: vi.fn() }))
vi.mock('@/lib/db/post-metrics', () => ({ listTopPostMetrics: vi.fn() }))
vi.mock('@/lib/db/memory-performance', () => ({ listPerformanceMemoryCandidates: vi.fn() }))
vi.mock('@/lib/db/memory-evidence', () => ({ getEvidenceMemoryByIds: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
  incrementPostsGeneratedBy: vi.fn().mockResolvedValue(undefined),
  incrementPostsGenerated: vi.fn().mockResolvedValue(undefined),
  incrementBrandVoiceAttempts: vi.fn().mockResolvedValue(undefined),
}))

// Above runPrompt: the SDK and usage recording.
vi.mock('@/lib/ai/client', () => ({ getAnthropicClient: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({
  recordAiUsage: vi.fn().mockResolvedValue({}),
  countRecentCalls: vi.fn(),
}))

// NOT mocked, deliberately: @/lib/ai/context, @/lib/ai/runner, @/lib/memory/*,
// @/lib/ai/prompts/*, @/lib/ai/generate-native, @/lib/ai/wrap-evidence,
// @/lib/campaigns/brief (freezeBrief), @/lib/campaigns/consistency,
// @/lib/voice/translate.

import { generatePostsForCampaign } from './generate'
import * as contextModule from '@/lib/ai/context'
import { buildCustomerContext } from '@/lib/ai/context'
import { getCampaignById, listCampaigns } from '@/lib/db/campaigns'
import { getBriefByCampaign, markBriefGenerated } from '@/lib/db/campaign-briefs'
import { listPostsByCampaign, createPosts, listPostsByIds } from '@/lib/db/posts'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { getVariationForBusiness } from '@/lib/db/voice'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getAnthropicClient } from '@/lib/ai/client'
import { countRecentCalls } from '@/lib/db/ai-usage'
import { schedulePosts } from '@/lib/campaigns/schedule'
import { vectorToVoiceFields } from '@/lib/voice/translate'
import type {
  BusinessRow,
  BrandVoiceRow,
  BrandVoiceVariationRow,
  CampaignRow,
  PostMetricsRow,
  PostRow,
  CampaignBriefRow,
} from '@/lib/db/types'

const BUSINESS_ID = 'biz-1'
const CAMPAIGN_ID = 'campaign-1'
const SESSION_ID = 'session-1'
const VARIATION_ID = 'var-1'
const BRIEF_ID = 'brief-1'

const baseAxes = { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 }
// Deliberately far from baseAxes so the derived descriptor differs — that
// difference is what proves the variation override actually took effect.
const variationAxes = { formal_casual: 10, expert_peer: 15, serious_playful: 90, reserved_warm: 80, calm_energetic: 95, rational_emotional: 85, exclusive_inclusive: 20 }

const mockBusiness: BusinessRow = {
  id: BUSINESS_ID, name: 'Acme SaaS', website: null, industry: 'Software',
  description: 'A SaaS company', logo_url: null, owner_id: 'user-1',
  plan: 'plus', stripe_customer_id: null, stripe_subscription_id: null,
  language: 'en', timezone: 'UTC', onboarding_completed: true,
  total_posts_published: 0, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockBrandVoice: BrandVoiceRow = {
  id: 'bv-1', business_id: BUSINESS_ID, voice_axes: baseAxes,
  tone: ['professional'], target_audience: 'Engineering leads',
  keywords: ['data-driven'], avoid_words: ['synergy'], writing_examples: [],
  competitors: [], unique_value_prop: 'Real-time analytics',
  inferred_from_url: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockVariation: BrandVoiceVariationRow = {
  id: VARIATION_ID, business_id: BUSINESS_ID, name: 'Bolder',
  voice_axes: variationAxes,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockCampaign: CampaignRow = {
  id: CAMPAIGN_ID, business_id: BUSINESS_ID, name: 'Q2 Launch',
  objective: 'Drive awareness', special_instructions: null,
  platforms: ['linkedin'], frequency: '3x_week', posts_per_week: 3,
  start_date: '2026-06-01', end_date: '2026-06-14',
  status: 'awaiting_brief', // B2.6: the new brief-gated entry point
  total_posts_planned: 3, total_posts_published: 0,
  voice_variation_id: VARIATION_ID,   // the ONLY caller that sets this
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
}

// B2.6: an approved, frozen brief with 3 linkedin roleSequence entries —
// matches the pre-B2.6 fixture's 3-post/linkedin-only shape so the rest of
// the test's assumptions (schedulePosts returning 3 dates, etc.) still hold.
const mockBrief: CampaignBriefRow = {
  id: BRIEF_ID, business_id: BUSINESS_ID, campaign_id: CAMPAIGN_ID,
  content: {
    narrative: 'We help B2B SaaS teams post consistently.',
    proofPlan: 'Cite performance data.',
    pinnedEvidence: [],
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
      { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'social proof' },
      { order: 2, role: 'follow_up', platform: 'linkedin', angle: 'a closing follow-up' },
    ],
  },
  status: 'approved', version: 1, overall_score: 85, critique: null,
  frozen_at: '2026-07-23T00:00:00Z', deleted_at: null,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-23T00:00:00Z',
}

const metric = (i: number): PostMetricsRow => ({
  id: `pm-${i}`, post_id: `post-${i}`, business_id: BUSINESS_ID,
  likes: 100 - i, comments: 5, shares: 2, saves: 1, clicks: 10,
  reach: 500, impressions: 1000,
  last_synced_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

const post = (i: number): PostRow => ({
  id: `post-${i}`, campaign_id: CAMPAIGN_ID, business_id: BUSINESS_ID,
  platform: 'linkedin', content: `PERF-SNIPPET-${i}`, hashtags: [], media_urls: [],
  scheduled_at: '2026-01-01T00:00:00Z', published_at: null,
  platform_post_id: null, platform_url: null, status: 'published',
  role: null, rejection_note: null, ai_generation_metadata: {}, publish_attempts: 0,
  last_publish_attempt_at: null, last_publish_error: null, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

const mockCreate = vi.fn()

// Routes by prompt.id (the same _sosh.promptId field runner.ts attaches,
// mirroring lib/ai/client.ts's real MockAnthropicClient fixture-routing
// pattern) — three DIFFERENT prompts now hit the wire per post
// (native-generation + the hook-loop rubric scoring call), each needing a
// structurally different response.
mockCreate.mockImplementation(async (params: { _sosh?: { promptId: string } }) => {
  const promptId = params._sosh?.promptId
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 }
  if (promptId === 'rubric') {
    const dim = { score: 90, note: 'strong' } // high score — hook loop never fires, keeps call-count predictable
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dimensions: {
          specificity: dim, originality: dim, evidenceSufficiency: dim, audienceRelevance: dim,
          platformNativeness: dim, brandVoiceAlignment: dim, openingStrength: dim, ctaFit: dim,
          unsupportedClaimsRisk: dim, redundancy: dim,
        },
        overall: 90, critique: ['fine as-is'], verdict: 'pass',
      }) }],
      usage,
    }
  }
  // native-generation-single (mockCampaign is linkedin-only -> always 'single' family)
  return {
    content: [{ type: 'text', text: JSON.stringify({ format: 'single', body: 'Generated body text', imageBrief: null }) }],
    usage,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCampaignById).mockResolvedValue(mockCampaign)
  vi.mocked(getBriefByCampaign).mockResolvedValue(mockBrief)
  vi.mocked(markBriefGenerated).mockResolvedValue({ ...mockBrief, status: 'generated' })
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(createPosts).mockResolvedValue([{}, {}, {}] as never)
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(getBrandVoice).mockResolvedValue(mockBrandVoice)
  vi.mocked(getVariationForBusiness).mockResolvedValue(mockVariation)
  vi.mocked(listCampaigns).mockResolvedValue([])
  vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
  vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([])
  // SIX metrics/posts available — more than PERFORMANCE_CAP. The cap must
  // still bite in buildCustomerContext's OWN return value (asserted
  // directly below — no longer via a prompt, see the file header note).
  vi.mocked(listTopPostMetrics).mockResolvedValue(Array.from({ length: 6 }, (_, i) => metric(i)))
  vi.mocked(listPostsByIds).mockResolvedValue(Array.from({ length: 6 }, (_, i) => post(i)))
  vi.mocked(schedulePosts).mockReturnValue(['2026-08-01T10:00:00Z', '2026-08-02T10:00:00Z', '2026-08-03T10:00:00Z'] as never)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
})

/** All text sent to the model across every call this run made. */
function allPromptText(): string {
  expect(mockCreate).toHaveBeenCalled()
  return mockCreate.mock.calls
    .map((call) => {
      const args = call[0] as { system: [{ text: string }]; messages: [{ content: [{ text: string }] } ] }
      return `${args.system[0].text}\n${args.messages[0].content[0].text}`
    })
    .join('\n---\n')
}

describe('lib/campaigns/generate.ts caller — buildCustomerContext is called byte-identically (MODE2-CONTEXT-EQUIVALENT)', () => {
  it('calls buildCustomerContext with the exact same args as before B2.6', async () => {
    // Session 24-D (MINOR-1 correction) — buildCustomerContext itself is not
    // mocked in this file (module-level intent, see header note above), but
    // spying on it (calls-through to the REAL implementation, only records
    // invocations) lets this test assert the exact call shape rather than
    // just letting the real function run unobserved. Previously this test
    // had ZERO expect() calls — it could never redden on an args regression.
    const spy = vi.spyOn(contextModule, 'buildCustomerContext')

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    // Same call shape as the pre-B2.6 STEP 4: (businessId, campaign.voice_variation_id).
    expect(spy).toHaveBeenCalledWith(BUSINESS_ID, VARIATION_ID)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('resolves the campaign voice VARIATION and sends its descriptor into the native-generation prompt', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(getVariationForBusiness).toHaveBeenCalledWith(expect.anything(), VARIATION_ID, BUSINESS_ID)

    const variationDescriptor = vectorToVoiceFields(variationAxes).descriptor
    const baseDescriptor = vectorToVoiceFields(baseAxes).descriptor
    expect(variationDescriptor).not.toBe(baseDescriptor) // fixture sanity

    const sent = allPromptText()
    expect(sent).toContain(variationDescriptor)
    expect(sent).not.toContain(baseDescriptor)
  })

  it('does not leak trialState or a raw context dump into any prompt sent', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const sent = allPromptText()
    expect(sent).not.toContain('"trialState"')
    expect(sent).not.toContain('"recentPostPerformance"')
  })

  // B2.6: recentPostPerformance is no longer RENDERED into any Mode 2 prompt
  // (see file header) — proven here directly against buildCustomerContext's
  // own return, with the exact same args generate.ts uses, rather than by
  // grepping a prompt that structurally no longer contains it.
  it('buildCustomerContext itself still caps performance snippets at PERFORMANCE_CAP (3), highest-ranked first', async () => {
    const ctx = await buildCustomerContext(BUSINESS_ID, VARIATION_ID)
    expect(ctx.recentPostPerformance).toHaveLength(3)
    expect(ctx.recentPostPerformance.map((p) => p.topContent)).toEqual([
      'PERF-SNIPPET-0', 'PERF-SNIPPET-1', 'PERF-SNIPPET-2',
    ])
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), BUSINESS_ID, 3)
  })

  it('buildCustomerContext still prefers governed performance_memory over the post_metrics fallback, capped at 3', async () => {
    vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `pf-${i}`, business_id: BUSINESS_ID, source: 'distilled',
        confidence: 0.9 - i * 0.1, observation_count: 4, status: 'active',
        sensitivity: 'internal', public_use_permission: false,
        scope: 'brand', scope_ref: null,
        last_confirmed_at: '2026-07-19T00:00:00Z', recency_at: '2026-07-19T00:00:00Z',
        expires_at: null, deleted_at: null,
        created_at: '2026-06-01T00:00:00Z', updated_at: '2026-07-19T00:00:00Z',
        dimension: 'topic', pattern: `GOVERNED-PATTERN-${i}`, platform: 'linkedin',
      })) as never,
    )

    const ctx = await buildCustomerContext(BUSINESS_ID, VARIATION_ID)
    expect(ctx.recentPostPerformance.map((p) => p.topContent)).toEqual([
      'GOVERNED-PATTERN-0', 'GOVERNED-PATTERN-1', 'GOVERNED-PATTERN-2',
    ])
    expect(listTopPostMetrics).not.toHaveBeenCalled()
  })

  it('MODE2-BRIEF-BEFORE-COPY / end-to-end sanity: the run still succeeds and creates posts via the new brief-gated path', async () => {
    const result = await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(result.postsCreated).toBe(3)
    expect(createPosts).toHaveBeenCalled()
  })
})
