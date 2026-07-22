import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── MAJOR-4 (Session 23 review) · SHARED-FUNCTION CALLERS (CLAUDE.md) ──────
//
// generate.test.ts — the existing suite for this caller — MOCKS
// buildCustomerContext. That is correct for testing generate.ts's own
// orchestration, but it means the B3 rewire (performance 10 → 3, sourced via
// lib/memory) and the D2 voice rewire are INVISIBLE to it: the mock returns
// whatever the test hands it. Five callers, zero covering the rewire, was the
// exact shape of Session 22's BLOCKER-1/2.
//
// This file is deliberately the opposite: buildCustomerContext and runPrompt
// are REAL. Only the lib/db layer beneath them and the Anthropic client above
// them are mocked. The assertion is on the ASSEMBLED PROMPT — the text
// actually sent to the model — because that is where the 70% reduction in
// performance evidence lands. Asserting on the context object would not show
// it reaching a prompt at all.

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
vi.mock('@/lib/db/businesses', () => ({ getBusinessById: vi.fn() }))
vi.mock('@/lib/db/brand-voices', () => ({ getBrandVoice: vi.fn() }))
vi.mock('@/lib/db/voice', () => ({ getVariationForBusiness: vi.fn() }))
vi.mock('@/lib/db/post-metrics', () => ({ listTopPostMetrics: vi.fn() }))
vi.mock('@/lib/db/memory-performance', () => ({ listPerformanceMemoryCandidates: vi.fn() }))
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
// @/lib/ai/prompts/*, @/lib/voice/translate.

import { generatePostsForCampaign } from './generate'
import { getCampaignById, listCampaigns } from '@/lib/db/campaigns'
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
import type { BusinessRow, BrandVoiceRow, BrandVoiceVariationRow, CampaignRow, PostMetricsRow, PostRow } from '@/lib/db/types'

const BUSINESS_ID = 'biz-1'
const CAMPAIGN_ID = 'campaign-1'
const SESSION_ID = 'session-1'
const VARIATION_ID = 'var-1'

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
  start_date: '2026-06-01', end_date: '2026-06-14', status: 'draft',
  total_posts_planned: 3, total_posts_published: 0,
  voice_variation_id: VARIATION_ID,   // the ONLY caller that sets this
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
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

const validGeneration = {
  posts: [
    { content: 'a', hashtags: [], scheduledAt: '2026-08-01T10:00:00Z', rationale: 'a valid rationale one' },
    { content: 'b', hashtags: [], scheduledAt: '2026-08-02T10:00:00Z', rationale: 'a valid rationale two' },
    { content: 'c', hashtags: [], scheduledAt: '2026-08-03T10:00:00Z', rationale: 'a valid rationale three' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCampaignById).mockResolvedValue(mockCampaign)
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(createPosts).mockResolvedValue([{}, {}, {}] as never)
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(getBrandVoice).mockResolvedValue(mockBrandVoice)
  vi.mocked(getVariationForBusiness).mockResolvedValue(mockVariation)
  vi.mocked(listCampaigns).mockResolvedValue([])
  vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
  vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([])
  // SIX metrics/posts available — more than PERFORMANCE_CAP. Pre-rewire this
  // caller would have sent up to 10; the cap must bite here, in the prompt.
  vi.mocked(listTopPostMetrics).mockResolvedValue(Array.from({ length: 6 }, (_, i) => metric(i)))
  vi.mocked(listPostsByIds).mockResolvedValue(Array.from({ length: 6 }, (_, i) => post(i)))
  vi.mocked(schedulePosts).mockReturnValue(['2026-08-01T10:00:00Z', '2026-08-02T10:00:00Z', '2026-08-03T10:00:00Z'] as never)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(validGeneration) }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
  })
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
})

/** The full text the model received: cached system block + uncached user message. */
function promptText(): string {
  expect(mockCreate).toHaveBeenCalled()
  const args = mockCreate.mock.calls[0][0]
  return `${args.system[0].text}\n${args.messages[0].content[0].text}`
}

describe('lib/campaigns/generate.ts caller — context reaches the PROMPT capped and voice-resolved (MAJOR-4)', () => {
  it('sends at most PERFORMANCE_CAP (3) performance snippets into the assembled prompt', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const sent = promptText()
    const snippets = sent.match(/PERF-SNIPPET-\d/g) ?? []
    expect(snippets).toHaveLength(3)
  })

  it('sends the HIGHEST-RANKED three snippets, not an arbitrary three', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const sent = promptText()
    // listTopPostMetrics returns in rank order and the fallback path preserves
    // it, so the survivors are the first three — and the rest must be absent.
    expect(sent).toContain('PERF-SNIPPET-0')
    expect(sent).toContain('PERF-SNIPPET-1')
    expect(sent).toContain('PERF-SNIPPET-2')
    expect(sent).not.toContain('PERF-SNIPPET-3')
    expect(sent).not.toContain('PERF-SNIPPET-4')
    expect(sent).not.toContain('PERF-SNIPPET-5')
  })

  it('queries the metrics source at the cap, not the pre-rewire 10', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), BUSINESS_ID, 3)
  })

  // D2 moved voice resolution into lib/memory's retrieveVoice. This caller is
  // the ONLY one passing a voiceVariationId, so it is the only place the
  // variation-override branch is exercised end-to-end.
  it('resolves the campaign voice VARIATION through lib/memory and sends its descriptor to the model', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(getVariationForBusiness).toHaveBeenCalledWith(expect.anything(), VARIATION_ID, BUSINESS_ID)

    const variationDescriptor = vectorToVoiceFields(variationAxes).descriptor
    const baseDescriptor = vectorToVoiceFields(baseAxes).descriptor
    expect(variationDescriptor).not.toBe(baseDescriptor) // fixture sanity

    const sent = promptText()
    expect(sent).toContain(variationDescriptor)
    expect(sent).not.toContain(baseDescriptor)
  })

  it('does not leak trialState or a raw context dump into the prompt', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const sent = promptText()
    expect(sent).not.toContain('"trialState"')
    expect(sent).not.toContain('"recentPostPerformance"')
  })

  it('prefers governed performance_memory over the post_metrics fallback, still capped at 3', async () => {
    vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `pf-${i}`, business_id: BUSINESS_ID, source: 'distilled',
        // Descending confidence: pf-0 is the strongest, pf-4 the weakest.
        confidence: 0.9 - i * 0.1, observation_count: 4, status: 'active',
        sensitivity: 'internal', public_use_permission: false,
        scope: 'brand', scope_ref: null,
        last_confirmed_at: '2026-07-19T00:00:00Z', recency_at: '2026-07-19T00:00:00Z',
        expires_at: null, deleted_at: null,
        created_at: '2026-06-01T00:00:00Z', updated_at: '2026-07-19T00:00:00Z',
        dimension: 'topic', pattern: `GOVERNED-PATTERN-${i}`, platform: 'linkedin',
      })) as never,
    )

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const sent = promptText()
    expect(sent.match(/GOVERNED-PATTERN-\d/g) ?? []).toHaveLength(3)
    // Highest-confidence three survive the cap.
    expect(sent).toContain('GOVERNED-PATTERN-0')
    expect(sent).toContain('GOVERNED-PATTERN-1')
    expect(sent).toContain('GOVERNED-PATTERN-2')
    expect(sent).not.toContain('GOVERNED-PATTERN-3')
    expect(sent).not.toContain('GOVERNED-PATTERN-4')
    // The post_metrics fallback must not also fire.
    expect(sent).not.toContain('PERF-SNIPPET-')
    expect(listTopPostMetrics).not.toHaveBeenCalled()
  })
})
