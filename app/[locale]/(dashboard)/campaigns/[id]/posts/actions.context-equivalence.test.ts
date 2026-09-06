import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── MAJOR-4 (Session 23 review) · SHARED-FUNCTION CALLERS (CLAUDE.md) ──────
//
// actions.test.ts — the existing suite for this caller — mocks BOTH
// buildCustomerContext and runPrompt. Correct for testing the action's own
// auth/eligibility/state logic, but it makes the B3 performance rewire, the
// D2 voice rewire and D3's regeneration-context restore all invisible: the
// mocks return whatever the test hands them.
//
// Here buildCustomerContext and runPrompt are REAL; only the lib/db layer
// beneath and the Anthropic client above are mocked. Assertions are on the
// ASSEMBLED PROMPT, because that is where the narrowing actually lands.
//
// This file additionally covers MAJOR-1b: D3 restored recentCampaigns +
// recentPostPerformance to post-regeneration.ts. Those must now be observable
// in the real regeneration request.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
  getBusinessById: vi.fn(),
}))
vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
  listCampaigns: vi.fn(),
}))
vi.mock('@/lib/db/posts', () => ({
  getPostById: vi.fn(),
  getPostSiblingTopics: vi.fn(),
  updatePostContentAndMetadata: vi.fn(),
  listPostsByIds: vi.fn(),
  approvePost: vi.fn(),
  unapprovePost: vi.fn(),
  skipPost: vi.fn(),
  unskipPost: vi.fn(),
  updatePostContent: vi.fn(),
  bulkApproveDraftPosts: vi.fn(),
  // Real values, not vi.fn(): actions.ts reads these at MODULE SCOPE to build
  // bulkApproveSchema's .max() bound (Session 22-E / 22-F precedent).
  APPROVALS_POST_LIMIT: 200,
  BULK_APPROVE_ID_CAP: 200,
}))
vi.mock('@/lib/db/brand-voices', () => ({ getBrandVoice: vi.fn() }))
vi.mock('@/lib/db/voice', () => ({ getVariationForBusiness: vi.fn() }))
vi.mock('@/lib/db/post-metrics', () => ({ listTopPostMetrics: vi.fn() }))
vi.mock('@/lib/db/memory-performance', () => ({ listPerformanceMemoryCandidates: vi.fn() }))
vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
  incrementPostsGenerated: vi.fn().mockResolvedValue(undefined),
  incrementBrandVoiceAttempts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ai/client', () => ({ getAnthropicClient: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({
  recordAiUsage: vi.fn().mockResolvedValue({}),
  countRecentCalls: vi.fn(),
}))
vi.mock('@/lib/db/post-ai-originals', () => ({
  createNextPostAiOriginalRevision: vi.fn().mockResolvedValue({}),
  AI_ORIGINAL_SCHEMA_VERSION: 1,
}))

// NOT mocked, deliberately: @/lib/ai/context, @/lib/ai/runner, @/lib/memory/*,
// @/lib/ai/prompts/*.

import { regeneratePostAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser, getBusinessById } from '@/lib/db/businesses'
import { getCampaignById, listCampaigns } from '@/lib/db/campaigns'
import { getPostById, getPostSiblingTopics, updatePostContentAndMetadata, listPostsByIds } from '@/lib/db/posts'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getAnthropicClient } from '@/lib/ai/client'
import { countRecentCalls } from '@/lib/db/ai-usage'
import type { BusinessRow, BrandVoiceRow, CampaignRow, PostMetricsRow, PostRow } from '@/lib/db/types'

const POST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const CAMPAIGN_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const BUSINESS_ID = 'biz-456'
const FEEDBACK = 'The tone was too formal, make it more casual'

const axes = { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 }

const mockBusiness: BusinessRow = {
  id: BUSINESS_ID, name: 'Acme Corp', website: 'https://acme.com', industry: 'SaaS',
  description: 'A SaaS company', logo_url: null, owner_id: 'user-123',
  plan: 'plus', stripe_customer_id: null, stripe_subscription_id: null,
  language: 'en', timezone: 'UTC', onboarding_completed: true,
  total_posts_published: 0, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockBrandVoice: BrandVoiceRow = {
  id: 'bv-1', business_id: BUSINESS_ID, voice_axes: axes,
  tone: ['professional'], target_audience: 'VOICE-AUDIENCE-MARKER',
  keywords: ['data-driven'], avoid_words: [], writing_examples: [],
  competitors: [], unique_value_prop: 'Real-time analytics', inferred_from_url: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockCampaign: CampaignRow = {
  id: CAMPAIGN_ID, business_id: BUSINESS_ID, name: 'Q2 Launch',
  objective: 'Drive awareness', special_instructions: null,
  platforms: ['linkedin'], frequency: 'weekly', posts_per_week: 1,
  start_date: '2026-06-01', end_date: null, status: 'active',
  total_posts_planned: 6, total_posts_published: 0, voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
}

const mockDraftPost: PostRow = {
  id: POST_ID, campaign_id: CAMPAIGN_ID, business_id: BUSINESS_ID, social_account_id: null,
  platform: 'linkedin', content: 'The previous draft', hashtags: ['#saas'],
  media_urls: [], scheduled_at: '2026-08-01T10:00:00Z', published_at: null,
  platform_post_id: null, platform_url: null, status: 'draft',
  role: null, rejection_note: null, ai_generation_metadata: {}, publish_attempts: 0,
  last_publish_attempt_at: null, last_publish_error: null, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const metric = (i: number): PostMetricsRow => ({
  id: `pm-${i}`, post_id: `perfpost-${i}`, business_id: BUSINESS_ID,
  likes: 100 - i, comments: 5, shares: 2, saves: 1, clicks: 10,
  reach: 500, impressions: 1000, last_synced_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

const perfPost = (i: number): PostRow => ({
  ...mockDraftPost, id: `perfpost-${i}`, content: `PERF-SNIPPET-${i}`, status: 'published',
})

const mockCreate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
  } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(mockBusiness)
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(getPostById).mockResolvedValue(mockDraftPost)
  vi.mocked(getCampaignById).mockResolvedValue(mockCampaign)
  vi.mocked(getPostSiblingTopics).mockResolvedValue([])
  vi.mocked(updatePostContentAndMetadata).mockResolvedValue({} as never)
  vi.mocked(getBrandVoice).mockResolvedValue(mockBrandVoice)
  vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
  vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([])
  vi.mocked(listCampaigns).mockResolvedValue([
    { ...mockCampaign, id: 'camp-a', name: 'RECENT-CAMPAIGN-A' },
    { ...mockCampaign, id: 'camp-b', name: 'RECENT-CAMPAIGN-B' },
  ])
  // Six available — more than PERFORMANCE_CAP.
  vi.mocked(listTopPostMetrics).mockResolvedValue(Array.from({ length: 6 }, (_, i) => metric(i)))
  vi.mocked(listPostsByIds).mockResolvedValue(Array.from({ length: 6 }, (_, i) => perfPost(i)))
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  mockCreate.mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({ content: 'Refreshed content', hashtags: ['#saas'], rationale: 'More casual as requested' }),
    }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
  })
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
})

function promptText(): string {
  expect(mockCreate).toHaveBeenCalled()
  const args = mockCreate.mock.calls[0][0]
  return `${args.system[0].text}\n${args.messages[0].content[0].text}`
}

describe('regeneratePostAction caller — context reaches the PROMPT capped (MAJOR-4)', () => {
  it('sends at most PERFORMANCE_CAP (3) performance snippets, and the highest-ranked three', async () => {
    await regeneratePostAction(POST_ID, FEEDBACK)

    const sent = promptText()
    expect(sent.match(/PERF-SNIPPET-\d/g) ?? []).toHaveLength(3)
    expect(sent).toContain('PERF-SNIPPET-0')
    expect(sent).toContain('PERF-SNIPPET-1')
    expect(sent).toContain('PERF-SNIPPET-2')
    expect(sent).not.toContain('PERF-SNIPPET-3')
    expect(sent).not.toContain('PERF-SNIPPET-4')
    expect(sent).not.toContain('PERF-SNIPPET-5')
  })

  it('queries the metrics source at the cap, not the pre-rewire 10', async () => {
    await regeneratePostAction(POST_ID, FEEDBACK)
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), BUSINESS_ID, 3)
  })

  // MAJOR-1b: D3 restored these two to post-regeneration.ts. Before D3 they
  // reached this prompt only via the JSON dump B4 deleted, so between B4 and
  // D3 the regeneration path silently lost them. This is the caller-level
  // proof that the restore landed where it matters.
  it('sends recentCampaigns and recentPostPerformance — restored by D3 (MAJOR-1b)', async () => {
    await regeneratePostAction(POST_ID, FEEDBACK)

    const sent = promptText()
    expect(sent).toContain('RECENT-CAMPAIGN-A')
    expect(sent).toContain('RECENT-CAMPAIGN-B')
    expect(sent).toContain('PERF-SNIPPET-0')
  })

  it('resolves brand voice through lib/memory and sends it (base voice — this caller passes no variation)', async () => {
    await regeneratePostAction(POST_ID, FEEDBACK)

    const sent = promptText()
    expect(sent).toContain('VOICE-AUDIENCE-MARKER')
  })

  it('does not leak trialState or a raw context dump into the prompt', async () => {
    await regeneratePostAction(POST_ID, FEEDBACK)

    const sent = promptText()
    expect(sent).not.toContain('"trialState"')
    expect(sent).not.toContain('"recentPostPerformance"')
  })
})
