import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      AI_TRIAL_BRAND_VOICE_ATTEMPTS: 3,
      AI_TRIAL_POST_CAP: 50,
      AI_TRIAL_CAMPAIGN_CAP: 1,
    },
  },
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: vi.fn(),
}))

vi.mock('@/lib/db/brand-voices', () => ({
  getBrandVoice: vi.fn(),
}))

vi.mock('@/lib/db/campaigns', () => ({
  listCampaigns: vi.fn(),
}))

vi.mock('@/lib/db/post-metrics', () => ({
  listTopPostMetrics: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  listPostsByIds: vi.fn(),
}))

vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
}))

vi.mock('@/lib/db/voice', () => ({
  getVariationForBusiness: vi.fn(),
}))

import { buildCustomerContext } from './context'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listCampaigns } from '@/lib/db/campaigns'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPostsByIds } from '@/lib/db/posts'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getVariationForBusiness } from '@/lib/db/voice'
import type {
  BusinessRow,
  BrandVoiceRow,
  BrandVoiceVariationRow,
  CampaignRow,
  PostMetricsRow,
  PostRow,
  TrialStatePublicRow,
} from '@/lib/db/types'

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme Corp',
  website: 'https://acme.com',
  industry: 'SaaS',
  description: 'A SaaS company',
  logo_url: null,
  owner_id: 'user-1',
  plan: 'trial',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: false,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockBrandVoice: BrandVoiceRow = {
  id: 'bv-1',
  business_id: 'biz-1',
  voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
  tone: ['professional'],
  target_audience: 'B2B SaaS founders',
  keywords: ['growth', 'pipeline'],
  avoid_words: [],
  writing_examples: [],
  competitors: [],
  unique_value_prop: 'The best',
  inferred_from_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const makeCampaign = (n: number): CampaignRow => ({
  id: `camp-${n}`,
  business_id: 'biz-1',
  name: `Campaign ${n}`,
  objective: `Objective ${n}`,
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'weekly',
  posts_per_week: 1,
  start_date: '2026-01-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 10,
  total_posts_published: 0,
  voice_variation_id: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const mockMetric: PostMetricsRow = {
  id: 'pm-1',
  post_id: 'post-1',
  business_id: 'biz-1',
  likes: 100,
  comments: 5,
  shares: 2,
  saves: 1,
  clicks: 10,
  reach: 500,
  impressions: 1000,
  last_synced_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockPost: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  content: 'Top content here',
  hashtags: [],
  media_urls: [],
  scheduled_at: '2026-01-01T00:00:00Z',
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'published',
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockTrialState: TrialStatePublicRow = {
  id: 'ts-1',
  business_id: 'biz-1',
  trial_started_at: '2026-01-01T00:00:00Z',
  campaigns_created_count: 0,
  posts_generated_count: 10,
  brand_voice_inference_attempts: 1,
  work_email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockVariation: BrandVoiceVariationRow = {
  id: 'var-1',
  business_id: 'biz-1',
  name: 'Bolder',
  voice_axes: {
    formal_casual: 30,
    expert_peer: 20,
    serious_playful: 70,
    reserved_warm: 50,
    calm_energetic: 85,
    rational_emotional: 60,
    exclusive_inclusive: 50,
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(getBrandVoice).mockResolvedValue(mockBrandVoice)
  vi.mocked(listCampaigns).mockResolvedValue([makeCampaign(1)])
  vi.mocked(listTopPostMetrics).mockResolvedValue([mockMetric])
  vi.mocked(listPostsByIds).mockResolvedValue([mockPost])
  vi.mocked(getTrialStateMaybe).mockResolvedValue(mockTrialState)
  vi.mocked(getVariationForBusiness).mockResolvedValue(null)
})

describe('buildCustomerContext', () => {
  it('returns only the 7 business fields in the correct shape', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.business).toEqual({
      id: 'biz-1',
      name: 'Acme Corp',
      website: 'https://acme.com',
      industry: 'SaaS',
      description: 'A SaaS company',
      language: 'en',
      timezone: 'UTC',
    })
    expect(Object.keys(ctx.business)).toHaveLength(7)
  })

  it('passes all BrandVoiceRow fields through unchanged', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.brandVoice).toMatchObject(mockBrandVoice)
  })

  it('attaches descriptor derived from voice_axes to brandVoice', async () => {
    const ctx = await buildCustomerContext('biz-1')
    // voice_axes are all-neutral (50s) → locked descriptor
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
  })

  it('returns null brandVoice when none exists', async () => {
    vi.mocked(getBrandVoice).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.brandVoice).toBeNull()
  })

  it('returns campaigns with only the 4 required fields', async () => {
    vi.mocked(listCampaigns).mockResolvedValue([makeCampaign(1), makeCampaign(2)])
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.recentCampaigns).toHaveLength(2)
    expect(ctx.recentCampaigns[0]).toEqual({
      id: 'camp-1',
      name: 'Campaign 1',
      objective: 'Objective 1',
      status: 'active',
    })
    expect(Object.keys(ctx.recentCampaigns[0])).toHaveLength(4)
  })

  it('queries listCampaigns with limit=5', async () => {
    await buildCustomerContext('biz-1')
    expect(listCampaigns).toHaveBeenCalledWith(expect.anything(), 'biz-1', 5)
  })

  it('queries listTopPostMetrics with limit=10', async () => {
    await buildCustomerContext('biz-1')
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), 'biz-1', 10)
  })

  it('maps post performance by joining metrics with posts', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.recentPostPerformance).toEqual([
      {
        platform: 'linkedin',
        topContent: 'Top content here',
        likes: 100,
        impressions: 1000,
      },
    ])
  })

  it('defaults null likes and impressions to 0', async () => {
    vi.mocked(listTopPostMetrics).mockResolvedValue([
      { ...mockMetric, likes: null, impressions: null },
    ])
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.recentPostPerformance[0].likes).toBe(0)
    expect(ctx.recentPostPerformance[0].impressions).toBe(0)
  })

  it('skips post fetch and returns empty performance when no metrics', async () => {
    vi.mocked(listTopPostMetrics).mockResolvedValue([])
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.recentPostPerformance).toEqual([])
    expect(listPostsByIds).not.toHaveBeenCalled()
  })

  it('returns trialState null for paid plan regardless of trial_state row', async () => {
    vi.mocked(getBusinessById).mockResolvedValue({ ...mockBusiness, plan: 'plus' })
    vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState).toBeNull()
  })

  it('returns trialState with full caps when business.plan is trial but no DB row exists', async () => {
    vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState).not.toBeNull()
    expect(ctx.trialState?.isTrial).toBe(true)
    expect(ctx.trialState?.postsRemaining).toBe(50)
    expect(ctx.trialState?.campaignsRemaining).toBe(1)
    expect(ctx.trialState?.brandVoiceAttemptsRemaining).toBe(3)
  })

  it('uses config brandVoiceAttemptsRemaining when no DB row exists', async () => {
    vi.mocked(getTrialStateMaybe).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.brandVoiceAttemptsRemaining).toBe(3)
  })

  it('sets isTrial true when trial_state row exists', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.isTrial).toBe(true)
  })

  it('computes brandVoiceAttemptsRemaining as cap minus used (3 - 1 = 2)', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.brandVoiceAttemptsRemaining).toBe(2)
  })

  it('computes postsRemaining as 50 - posts_generated_count (50 - 10 = 40)', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.postsRemaining).toBe(40)
  })

  it('computes campaignsRemaining as 1 - campaigns_created_count (1 - 0 = 1)', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.campaignsRemaining).toBe(1)
  })

  it('floors postsRemaining at 0 when cap exceeded', async () => {
    vi.mocked(getTrialStateMaybe).mockResolvedValue({
      ...mockTrialState,
      posts_generated_count: 60,
    })
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.postsRemaining).toBe(0)
  })

  it('floors brandVoiceAttemptsRemaining at 0 when cap exceeded', async () => {
    vi.mocked(getTrialStateMaybe).mockResolvedValue({
      ...mockTrialState,
      brand_voice_inference_attempts: 5,
    })
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.trialState?.brandVoiceAttemptsRemaining).toBe(0)
  })
})

describe('buildCustomerContext — voice variation read-through (BP7 §4.3/§8.2)', () => {
  it('uses base voice_axes when voiceVariationId is null (L-10)', async () => {
    const ctx = await buildCustomerContext('biz-1', null)
    // base voice_axes are all 50 (neutral) → locked descriptor
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
    expect(getVariationForBusiness).not.toHaveBeenCalled()
  })

  it('uses base voice_axes when voiceVariationId is omitted', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
  })

  it('loads variation axes when voiceVariationId is set and calls getVariationForBusiness with businessId', async () => {
    vi.mocked(getVariationForBusiness).mockResolvedValue(mockVariation)
    await buildCustomerContext('biz-1', 'var-1')
    expect(getVariationForBusiness).toHaveBeenCalledWith(expect.anything(), 'var-1', 'biz-1')
  })

  it('descriptor differs between base and variation axes (§4.3)', async () => {
    vi.mocked(getVariationForBusiness).mockResolvedValue(mockVariation)
    const ctxVariation = await buildCustomerContext('biz-1', 'var-1')

    const ctxBase = await buildCustomerContext('biz-1', null)

    expect(ctxVariation.brandVoice?.descriptor).not.toBe(ctxBase.brandVoice?.descriptor)
  })

  it('voice_axes on brandVoice are replaced with variation axes when voiceVariationId is set', async () => {
    vi.mocked(getVariationForBusiness).mockResolvedValue(mockVariation)
    const ctx = await buildCustomerContext('biz-1', 'var-1')
    expect(ctx.brandVoice?.voice_axes).toEqual(mockVariation.voice_axes)
  })

  it('falls back to base when variation is not found (ON DELETE SET NULL path)', async () => {
    vi.mocked(getVariationForBusiness).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1', 'var-deleted')
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
    expect(ctx.brandVoice?.voice_axes).toEqual(mockBrandVoice.voice_axes)
  })

  it('§3.3 defense-in-depth: does not load a variation whose business_id differs from the campaign business', async () => {
    // getVariationForBusiness filters by id AND business_id; cross-tenant → null
    vi.mocked(getVariationForBusiness).mockResolvedValue(null)
    const ctx = await buildCustomerContext('biz-1', 'var-from-biz-2')
    expect(ctx.brandVoice?.voice_axes).toEqual(mockBrandVoice.voice_axes)
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
    expect(getVariationForBusiness).toHaveBeenCalledWith(expect.anything(), 'var-from-biz-2', 'biz-1')
  })

  it('CampaignUpdate type includes voice_variation_id (§3.3 — ordinary updatable field)', () => {
    // Type-level check: CampaignUpdate must allow voice_variation_id
    // If this compiles, the field is included (not excluded like business_id)
    type HasVoiceVariationId = 'voice_variation_id' extends keyof import('@/lib/db/types').CampaignUpdate ? true : false
    const check: HasVoiceVariationId = true
    expect(check).toBe(true)
  })
})
