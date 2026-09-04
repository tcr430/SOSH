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

// New call in the graph since B3: recentPostPerformance now goes through
// lib/memory/performance.ts, which checks performance_memory FIRST and
// falls back to the post_metrics-derived path (mocked above) only when it's
// empty. Defaulted to [] so every existing test exercises the same
// post_metrics fallback behaviour it always has (performance_memory ships
// empty in Track A — ADR 0016 §3.4).
vi.mock('@/lib/db/memory-performance', () => ({
  listPerformanceMemoryCandidates: vi.fn(),
}))

vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
}))

vi.mock('@/lib/db/voice', () => ({
  getVariationForBusiness: vi.fn(),
}))

import { buildCustomerContext, type CustomerContext } from './context'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listCampaigns } from '@/lib/db/campaigns'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPostsByIds } from '@/lib/db/posts'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getVariationForBusiness } from '@/lib/db/voice'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import type {
  BusinessRow,
  BrandVoiceRow,
  BrandVoiceVariationRow,
  CampaignRow,
  PerformanceMemoryRow,
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
  origin: 'objective_generated',
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
  social_account_id: null,
  platform: 'linkedin',
  content: 'Top content here',
  hashtags: [],
  media_urls: [],
  scheduled_at: '2026-01-01T00:00:00Z',
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'published',
  role: null,
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// A governed performance_memory row (ADR 0016 §3.4). Track A ships this
// table empty, so every case that wants the governed branch must supply its
// own rows; the overrides keep each case's intent (platform, confidence)
// visible at the call site instead of buried in a 20-field literal.
const makeGovernedPerfRow = (
  overrides: Partial<PerformanceMemoryRow> & Pick<PerformanceMemoryRow, 'id'>,
): PerformanceMemoryRow => ({
  business_id: 'biz-1',
  source: 'distilled',
  confidence: 0.8,
  observation_count: 4,
  status: 'active',
  sensitivity: 'internal',
  public_use_permission: false,
  scope: 'brand',
  scope_ref: null,
  last_confirmed_at: '2026-07-19T00:00:00Z',
  recency_at: '2026-07-19T00:00:00Z',
  expires_at: null,
  deleted_at: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-07-19T00:00:00Z',
  dimension: 'topic',
  pattern: 'a distilled pattern',
  platform: 'linkedin',
  pattern_key: null,
  ...overrides,
})

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
  vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([])
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

  // ADR 0016 §6.2 — the ONE pre-authorised assertion change in this file.
  // This case pinned the pre-cap "fetch top-10" behaviour L-4 exists to
  // kill; performance.ts's post_metrics fallback now requests
  // PERFORMANCE_CAP (3), not 10. This is a content change the ADR
  // explicitly ratifies, not a masked regression — every other case in
  // this file passes unchanged.
  it('queries listTopPostMetrics with limit=PERFORMANCE_CAP (3), not the pre-cap 10', async () => {
    await buildCustomerContext('biz-1')
    expect(listTopPostMetrics).toHaveBeenCalledWith(expect.anything(), 'biz-1', 3)
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

describe('buildCustomerContext — B3 behaviour-equivalence (ADR 0016 §6, MEM-CONTEXT-EQUIVALENT)', () => {
  it('CustomerContext contract shape is unchanged: exactly the 5 known top-level fields', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(Object.keys(ctx).sort()).toEqual(
      ['brandVoice', 'business', 'recentCampaigns', 'recentPostPerformance', 'trialState'].sort(),
    )
  })

  // MAJOR-2 (Session 23 review). This case previously asserted only
  // `expect(ctx.recentPostPerformance.length).toBeLessThanOrEqual(3)`, which
  // is green at ZERO — it could not distinguish "capped correctly" from
  // "returned nothing", and returning nothing is the most likely regression
  // in this design: performance.ts has two paths that can silently empty
  // the result (the early return on no metrics, and the metric→post join
  // filter — one case each, below). The governed branch no longer drops
  // platform-less rows (MINOR-3, fixed), so it is no longer a silent-empty
  // path.
  //
  // Pinned now as EXACT length AND survivor identity, mirroring
  // lib/memory/scoring.test.ts:158-170. PerformancePattern carries no post
  // id, so identity is pinned through `topContent`, the per-post field.
  //
  // 3 is written LITERALLY, not imported as PERFORMANCE_CAP: importing the
  // constant would make the assertion self-fulfilling and it would survive a
  // cap mutation, which is the exact failure this fix exists to close.
  it('recentPostPerformance is EXACTLY the cap (3) — the top-ranked three, never silently fewer', async () => {
    const overflowMetrics = Array.from({ length: 6 }, (_, i) => ({ ...mockMetric, id: `pm-${i}`, post_id: `post-${i}` }))
    const overflowPosts = Array.from({ length: 6 }, (_, i) => ({ ...mockPost, id: `post-${i}`, content: `Content for post-${i}` }))
    vi.mocked(listTopPostMetrics).mockResolvedValue(overflowMetrics)
    vi.mocked(listPostsByIds).mockResolvedValue(overflowPosts)

    const ctx = await buildCustomerContext('biz-1')

    expect(ctx.recentPostPerformance).toHaveLength(3)
    // Identity AND order: the fallback path maps over topMetrics, preserving
    // listTopPostMetrics' ranking, so the retained three are the FIRST three
    // it returned — not an arbitrary three, not the last three.
    expect(ctx.recentPostPerformance.map(p => p.topContent)).toEqual([
      'Content for post-0',
      'Content for post-1',
      'Content for post-2',
    ])
  })

  // --- The three silent-empty paths named by the Reviewer (MAJOR-2). Each is
  // --- pinned either as "a non-empty result survives it" or as "the emptying
  // --- is intentional", so none of them can start returning [] unnoticed.

  // PATH 1 — performance.ts's early `if (topMetrics.length === 0) return []`.
  // Emptying here is INTENTIONAL and pinned as such: a business with no post
  // metrics genuinely has no performance evidence to offer the model. What
  // must NOT happen silently is this path being reached when metrics DO
  // exist — the two cases above and below cover that.
  it('recentPostPerformance is empty when there are no post metrics at all — intentional, not a cap failure', async () => {
    vi.mocked(listTopPostMetrics).mockResolvedValue([])

    const ctx = await buildCustomerContext('biz-1')

    expect(ctx.recentPostPerformance).toEqual([])
    // The join is not even attempted — proves we took the early return, not
    // a path that filtered everything away downstream.
    expect(listPostsByIds).not.toHaveBeenCalled()
  })

  // PATH 2 — the metric→post join `.filter(m => postsById[m.post_id] !== undefined)`.
  // A metric whose post is missing (deleted, or outside the fetched set) is
  // dropped. Proves a NON-EMPTY result survives a partial drop rather than
  // the whole slice collapsing.
  it('drops only the metrics whose post is missing, keeping the rest — a partial join miss does not empty the result', async () => {
    vi.mocked(listTopPostMetrics).mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ ...mockMetric, id: `pm-${i}`, post_id: `post-${i}` })),
    )
    // post-1 and post-3 are absent from the join result.
    vi.mocked(listPostsByIds).mockResolvedValue([
      { ...mockPost, id: 'post-0', content: 'Content for post-0' },
      { ...mockPost, id: 'post-2', content: 'Content for post-2' },
    ])

    const ctx = await buildCustomerContext('biz-1')

    expect(ctx.recentPostPerformance).toHaveLength(2)
    expect(ctx.recentPostPerformance.map(p => p.topContent)).toEqual([
      'Content for post-0',
      'Content for post-2',
    ])
  })

  // MINOR-3 (Session 23 review, now FIXED). The governed branch previously
  // DROPPED rows with a null platform, so a business whose distilled patterns
  // were all cross-platform got zero performance context. That filter is
  // removed: cross-platform rows are kept and carry platform: null (the prompt
  // renders them "Across platforms"), never a guessed platform.
  it('keeps governed rows with a null platform (cross-platform) alongside the platform-specific ones (MINOR-3)', async () => {
    vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([
      makeGovernedPerfRow({ id: 'pf-1', pattern: 'cross-platform pattern', platform: null, confidence: 0.9 }),
      makeGovernedPerfRow({ id: 'pf-2', pattern: 'linkedin pattern', platform: 'linkedin', confidence: 0.8 }),
    ])

    const ctx = await buildCustomerContext('biz-1')

    expect(ctx.recentPostPerformance).toHaveLength(2)
    expect(ctx.recentPostPerformance.map(p => p.topContent)).toEqual([
      'cross-platform pattern',
      'linkedin pattern',
    ])
    // The cross-platform row carries an explicit null, not a guessed platform.
    expect(ctx.recentPostPerformance[0].platform).toBeNull()
  })

  // PATH 3, the degenerate case — ALL governed rows are platform-less. The
  // governed branch is entered (candidates exist) and, since MINOR-3 removed
  // the platform===null drop, all the rows are KEPT with platform: null. The
  // post_metrics fallback is still NOT reconsidered — the governed branch is
  // preferred whenever candidates exist. Previously this returned [] (every
  // row dropped); pinned now as the fixed behaviour so it cannot silently
  // regress back to dropping.
  it('keeps all-cross-platform governed rows and does not fall back to post_metrics (MINOR-3, fixed)', async () => {
    vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([
      makeGovernedPerfRow({ id: 'pf-1', pattern: 'cross-platform A', platform: null }),
      makeGovernedPerfRow({ id: 'pf-2', pattern: 'cross-platform B', platform: null }),
    ])

    const ctx = await buildCustomerContext('biz-1')

    expect(ctx.recentPostPerformance).toHaveLength(2)
    expect(ctx.recentPostPerformance.every(p => p.platform === null)).toBe(true)
    expect(ctx.recentPostPerformance.map(p => p.topContent)).toEqual(['cross-platform A', 'cross-platform B'])
    expect(listTopPostMetrics).not.toHaveBeenCalled()
  })

  it('core voice (brandVoice) is still returned through the rewired call — the rewire touches ONLY recentPostPerformance', async () => {
    const ctx = await buildCustomerContext('biz-1')
    expect(ctx.brandVoice).not.toBeNull()
    expect(ctx.brandVoice?.descriptor).toBe('A balanced, neutral voice with no strong leanings.')
  })

  it('prefers governed performance_memory rows over the post_metrics fallback when any exist', async () => {
    vi.mocked(listPerformanceMemoryCandidates).mockResolvedValue([
      {
        id: 'pf-1',
        business_id: 'biz-1',
        source: 'distilled',
        confidence: 0.8,
        observation_count: 4,
        status: 'active',
        sensitivity: 'internal',
        public_use_permission: false,
        scope: 'brand',
        scope_ref: null,
        last_confirmed_at: '2026-07-19T00:00:00Z',
        recency_at: '2026-07-19T00:00:00Z',
        expires_at: null,
        deleted_at: null,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-07-19T00:00:00Z',
        dimension: 'topic',
        pattern: 'technical-comparison posts perform well for CTO audiences',
        platform: 'linkedin',
        pattern_key: null,
      },
    ])

    const ctx = await buildCustomerContext('biz-1')

    // Governed rows carry no per-post metrics — likes/impressions omitted, not
    // invented as 0 (MINOR-2).
    expect(ctx.recentPostPerformance).toEqual([
      { platform: 'linkedin', topContent: 'technical-comparison posts perform well for CTO audiences' },
    ])
    expect(listTopPostMetrics).not.toHaveBeenCalled()
  })
})

// ADR 0017 §5.1 (L-10) — B2.5 wires memory into the BRIEF assembly input
// only; CustomerContext itself must be byte-for-byte unchanged. A compile-time
// shape diff (not a runtime check — TS types don't exist at runtime), mirroring
// lib/db/types.test.ts's Assert<Equals<...>> pattern: this reddens at BUILD
// TIME if a field is ever added to, removed from, or renamed on
// CustomerContext without deliberately updating this literal alongside it.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

type _CustomerContextShapeUnchanged = Assert<
  Equals<
    keyof CustomerContext,
    'business' | 'brandVoice' | 'recentCampaigns' | 'recentPostPerformance' | 'trialState'
  >
>
