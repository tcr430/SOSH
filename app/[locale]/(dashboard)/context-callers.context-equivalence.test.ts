import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── MAJOR-4 (Session 23 review) · the remaining THREE callers ──────────────
//
// The Reviewer enumerated five production callers of buildCustomerContext and
// found zero covered for the rewire. Two generation callers get full
// prompt-level coverage in their own *.context-equivalence.test.ts files.
// This file covers the other three — thinner by design, since none of them
// renders performance evidence, but NOT zero:
//
//   3. campaigns/[id]/generate-action.ts        (startGenerationAction)
//   4. onboarding/infer-brand-voice/actions.ts  (inferBrandVoiceAction)
//   5. settings/voice/refine-from-posts-action.ts (refineFromPostsAction)
//
// As everywhere in this pass, buildCustomerContext and runPrompt are REAL;
// only lib/db beneath and the Anthropic client above are mocked. Each
// caller's existing suite mocks buildCustomerContext, which is why none of
// them could observe the rewire.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('next/server', () => ({ after: vi.fn() }))

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
  listPostsByCampaign: vi.fn(),
  listPostsByIds: vi.fn(),
  listRecentPublishedPostTexts: vi.fn(),
}))
vi.mock('@/lib/db/post-generation-sessions', () => ({
  createGenerationSession: vi.fn(),
  getGenerationSession: vi.fn(),
}))
vi.mock('@/lib/campaigns/generate', () => ({
  generatePostsForCampaign: vi.fn().mockResolvedValue({ sessionId: 'session-1', postsCreated: 0 }),
}))
vi.mock('@/lib/db/brand-voices', () => ({
  getBrandVoice: vi.fn(),
  upsertBrandVoice: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/db/voice', () => ({ getVariationForBusiness: vi.fn() }))
vi.mock('@/lib/db/post-metrics', () => ({ listTopPostMetrics: vi.fn() }))
vi.mock('@/lib/db/memory-performance', () => ({ listPerformanceMemoryCandidates: vi.fn() }))
vi.mock('@/lib/db/social-accounts', () => ({ listActiveSocialAccounts: vi.fn() }))
vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
  incrementBrandVoiceAttempts: vi.fn().mockResolvedValue(undefined),
  incrementPostsGenerated: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ai/client', () => ({ getAnthropicClient: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({
  recordAiUsage: vi.fn().mockResolvedValue({}),
  countRecentCalls: vi.fn(),
}))

import { startGenerationAction } from './campaigns/[id]/generate-action'
import { inferBrandVoiceAction } from './onboarding/infer-brand-voice/actions'
import { refineFromPostsAction } from './settings/voice/refine-from-posts-action'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser, getBusinessById } from '@/lib/db/businesses'
import { getCampaignById, listCampaigns } from '@/lib/db/campaigns'
import { listPostsByCampaign, listPostsByIds, listRecentPublishedPostTexts } from '@/lib/db/posts'
import { createGenerationSession } from '@/lib/db/post-generation-sessions'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getAnthropicClient } from '@/lib/ai/client'
import { countRecentCalls } from '@/lib/db/ai-usage'
import type { BusinessRow, BrandVoiceRow, CampaignRow, PostMetricsRow, PostRow } from '@/lib/db/types'

const BUSINESS_ID = 'biz-1'
const CAMPAIGN_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

const axes = { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 }

const mockBusiness: BusinessRow = {
  id: BUSINESS_ID, name: 'BUSINESS-NAME-MARKER',
  // null so inferBrandVoiceAction skips its website fetch entirely.
  website: null,
  industry: 'SaaS', description: 'A SaaS company', logo_url: null, owner_id: 'user-1',
  plan: 'plus', stripe_customer_id: null, stripe_subscription_id: null,
  language: 'en', timezone: 'UTC', onboarding_completed: true,
  total_posts_published: 0, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockBrandVoice: BrandVoiceRow = {
  id: 'bv-1', business_id: BUSINESS_ID, voice_axes: axes,
  tone: ['professional'], target_audience: 'VOICE-AUDIENCE-MARKER',
  keywords: ['growth'], avoid_words: [], writing_examples: [], competitors: [],
  unique_value_prop: 'The best', inferred_from_url: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockCampaign: CampaignRow = {
  id: CAMPAIGN_ID, business_id: BUSINESS_ID, name: 'RECENT-CAMPAIGN-MARKER',
  objective: 'Drive awareness', special_instructions: null,
  platforms: ['linkedin'], frequency: 'weekly', posts_per_week: 1,
  start_date: '2026-06-01', end_date: null, status: 'draft',
  total_posts_planned: 3, total_posts_published: 0, voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
}

const perfMetric: PostMetricsRow = {
  id: 'pm-1', post_id: 'post-1', business_id: BUSINESS_ID,
  likes: 100, comments: 5, shares: 2, saves: 1, clicks: 10, reach: 500, impressions: 1000,
  last_synced_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const perfPost: PostRow = {
  id: 'post-1', campaign_id: CAMPAIGN_ID, business_id: BUSINESS_ID, social_account_id: null,
  platform: 'linkedin', content: 'PERF-SNIPPET-MARKER', hashtags: [], media_urls: [],
  scheduled_at: '2026-01-01T00:00:00Z', published_at: null,
  platform_post_id: null, platform_url: null, status: 'published',
  role: null, rejection_note: null, ai_generation_metadata: {}, publish_attempts: 0,
  last_publish_attempt_at: null, last_publish_error: null, deleted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const mockCreate = vi.fn()

const validVoiceOutput = {
  tone: ['professional'],
  targetAudience: 'B2B SaaS founders and marketing teams',
  keywords: ['growth', 'pipeline', 'retention'],
  avoidWords: [],
  uniqueValueProp: 'We help B2B SaaS teams ship content faster.',
  competitors: [],
  voiceAxes: axes,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(mockBusiness)
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(getCampaignById).mockResolvedValue(mockCampaign)
  vi.mocked(listCampaigns).mockResolvedValue([mockCampaign])
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(getBrandVoice).mockResolvedValue(mockBrandVoice)
  vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
  vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([])
  vi.mocked(listTopPostMetrics).mockResolvedValue([perfMetric])
  vi.mocked(listPostsByIds).mockResolvedValue([perfPost])
  vi.mocked(createGenerationSession).mockResolvedValue({ id: 'session-1', business_id: BUSINESS_ID } as never)
  vi.mocked(listActiveSocialAccounts).mockResolvedValue([{ id: 'acct-1' }] as never)
  vi.mocked(listRecentPublishedPostTexts).mockResolvedValue(['a published post text'])
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(validVoiceOutput) }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
  })
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
})

function promptText(): string {
  expect(mockCreate).toHaveBeenCalled()
  const args = mockCreate.mock.calls[0][0]
  return `${args.system[0].text}\n${args.messages[0].content[0].text}`
}

describe('caller 3 — campaigns/[id]/generate-action.ts (startGenerationAction)', () => {
  it('assembles context through the rewired path without throwing, and reaches the success branch', async () => {
    const result = await startGenerationAction(CAMPAIGN_ID)

    // Reaching { sessionId } requires customerCtx.brandVoice to be non-null,
    // so this also proves the D2 voice rewire (lib/memory retrieveVoice)
    // resolved a voice for this caller — a null would have returned
    // invalid_campaign_state instead.
    expect(result).toEqual({ sessionId: 'session-1' })
  })

  it('sources performance through lib/memory at the cap, not the pre-rewire 10', async () => {
    await startGenerationAction(CAMPAIGN_ID)
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), BUSINESS_ID, 3)
  })
})

describe('caller 4 — onboarding/infer-brand-voice/actions.ts (inferBrandVoiceAction)', () => {
  it('assembles context and completes without throwing', async () => {
    const result = await inferBrandVoiceAction()
    expect(result.success).toBe(true)
  })

  it('sends business only — the narrowing adjudicated in ADR 0016 §7.1 holds for this caller', async () => {
    await inferBrandVoiceAction()

    const sent = promptText()
    expect(sent).toContain('BUSINESS-NAME-MARKER')
    // Voice inference must not be primed by the voice already on file.
    expect(sent).not.toContain('VOICE-AUDIENCE-MARKER')
    expect(sent).not.toContain('RECENT-CAMPAIGN-MARKER')
    expect(sent).not.toContain('PERF-SNIPPET-MARKER')
  })
})

describe('caller 5 — settings/voice/refine-from-posts-action.ts (refineFromPostsAction)', () => {
  it('assembles context and completes without throwing', async () => {
    const result = await refineFromPostsAction()
    expect(result).not.toHaveProperty('error')
  })

  it('sends business only — same narrowing as caller 4 (same prompt template)', async () => {
    await refineFromPostsAction()

    const sent = promptText()
    expect(sent).toContain('BUSINESS-NAME-MARKER')
    expect(sent).not.toContain('VOICE-AUDIENCE-MARKER')
    expect(sent).not.toContain('RECENT-CAMPAIGN-MARKER')
    expect(sent).not.toContain('PERF-SNIPPET-MARKER')
  })
})
