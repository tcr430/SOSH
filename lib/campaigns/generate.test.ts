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
  updateCampaign: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/db/posts', () => ({
  listPostsByCampaign: vi.fn(),
  createPosts: vi.fn(),
}))

vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: vi.fn(),
}))

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn(),
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
import { getCampaignById, updateCampaign } from '@/lib/db/campaigns'
import { listPostsByCampaign, createPosts } from '@/lib/db/posts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { incrementPostsGeneratedBy } from '@/lib/db/trial-state'
import { schedulePosts } from '@/lib/campaigns/schedule'
import type { CampaignRow } from '@/lib/db/types'
import type { CustomerContext } from '@/lib/ai/context'

// ── Fixtures ────────────────────────────────────────────────────────────────

const SESSION_ID = 'session-1'
const CAMPAIGN_ID = 'campaign-1'
const BUSINESS_ID = 'biz-1'

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
  status: 'draft',
  total_posts_planned: 6,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
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

const linkedinDates = [
  '2026-06-03T09:00:00.000Z',
  '2026-06-04T09:00:00.000Z',
  '2026-06-05T09:00:00.000Z',
]
const twitterDates = [
  '2026-06-03T12:00:00.000Z',
  '2026-06-04T12:00:00.000Z',
  '2026-06-05T12:00:00.000Z',
]

function makePost(platform: string, idx: number) {
  return {
    content: `Post ${idx} for ${platform}`,
    hashtags: [`#${platform}`],
    scheduledAt: platform === 'linkedin' ? linkedinDates[idx] : twitterDates[idx],
    rationale: `Rationale for post ${idx} on ${platform}`,
  }
}

const linkedinOutput = { posts: [0, 1, 2].map(i => makePost('linkedin', i)) }
const twitterOutput = { posts: [0, 1, 2].map(i => makePost('twitter', i)) }

function makeInsertedRows() {
  return [...linkedinOutput.posts, ...twitterOutput.posts].map((p, i) => ({
    id: `post-${i}`,
    campaign_id: CAMPAIGN_ID,
    business_id: BUSINESS_ID,
    platform: (i < 3 ? 'linkedin' : 'twitter') as 'linkedin' | 'twitter',
    content: p.content,
    hashtags: p.hashtags,
    media_urls: [] as string[],
    scheduled_at: p.scheduledAt,
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    status: 'draft' as const,
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
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(buildCustomerContext).mockResolvedValue(mockCtx)
  vi.mocked(updateCampaign).mockResolvedValue({} as never)
  vi.mocked(updateGenerationSessionStatus).mockResolvedValue(undefined)
  vi.mocked(incrementPostsGeneratedBy).mockResolvedValue(undefined)
  vi.mocked(schedulePosts)
    .mockReturnValueOnce(linkedinDates)
    .mockReturnValueOnce(twitterDates)
  vi.mocked(runPrompt)
    .mockResolvedValueOnce(linkedinOutput)
    .mockResolvedValueOnce(twitterOutput)
  vi.mocked(createPosts).mockResolvedValue(makeInsertedRows())
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generatePostsForCampaign — trial pre-flight', () => {
  it('sets session failed with quota_exceeded when postsRemaining < totalPosts', async () => {
    const exhaustedCtx: CustomerContext = {
      ...mockCtx,
      trialState: { isTrial: true, postsRemaining: 2, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 3 },
    }
    vi.mocked(buildCustomerContext).mockResolvedValue(exhaustedCtx)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(runPrompt).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'quota_exceeded' }),
    )
  })

  it('does NOT block paid plans even when postsRemaining would be 0', async () => {
    vi.mocked(buildCustomerContext).mockResolvedValue(mockCtxPaid)

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(runPrompt).toHaveBeenCalledTimes(2)
  })
})

describe('generatePostsForCampaign — idempotency guard', () => {
  it('sets session failed with already_generated when posts exist for campaign', async () => {
    vi.mocked(listPostsByCampaign).mockResolvedValue([
      {
        id: 'existing-post',
        campaign_id: CAMPAIGN_ID,
        business_id: BUSINESS_ID,
        platform: 'linkedin',
        content: 'existing',
        hashtags: [],
        media_urls: [],
        scheduled_at: '2026-06-01T09:00:00.000Z',
        published_at: null,
        platform_post_id: null,
        platform_url: null,
        status: 'draft',
        rejection_note: null,
        ai_generation_metadata: {},
        publish_attempts: 0,
        last_publish_attempt_at: null,
        last_publish_error: null,
        deleted_at: null,
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ])

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(runPrompt).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'already_generated' }),
    )
  })
})

describe('generatePostsForCampaign — campaign validation', () => {
  it('sets session failed with invalid_campaign_state when campaign is not draft', async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...mockCampaign, status: 'active' })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(runPrompt).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'invalid_campaign_state' }),
    )
  })

  it('sets session failed with invalid_campaign_state when business_id does not match', async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...mockCampaign, business_id: 'other-biz' })

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(runPrompt).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'invalid_campaign_state' }),
    )
  })
})

describe('generatePostsForCampaign — runPrompt failure', () => {
  it('sets session failed, inserts zero posts, leaves campaign draft, does not increment counter', async () => {
    const { AiError } = await import('@/lib/ai/errors')
    vi.mocked(runPrompt).mockReset()
    vi.mocked(runPrompt).mockRejectedValueOnce(new AiError('provider_error', 'SDK error'))

    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(createPosts).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
    expect(incrementPostsGeneratedBy).not.toHaveBeenCalled()
    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'failed', error_code: 'provider_error' }),
    )
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

  it('inserts posts with all ai_generation_metadata fields present', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const insertedPosts = vi.mocked(createPosts).mock.calls[0][1]
    for (const post of insertedPosts) {
      const meta = post.ai_generation_metadata as Record<string, unknown>
      expect(meta).toMatchObject({
        promptId: 'post-generation',
        promptVersion: 1,
        generationSessionId: SESSION_ID,
        regenerationCount: 0,
        previousVersions: [],
      })
      expect(typeof meta.model).toBe('string')
      expect(typeof meta.platformContext).toBe('string')
      expect(typeof meta.platformConstraintsVersion).toBe('number')
      expect(typeof meta.rationale).toBe('string')
      expect(typeof meta.generatedAt).toBe('string')
    }
  })

  it('updates campaign to active with actual inserted post count', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(updateCampaign).toHaveBeenCalledWith(
      expect.anything(),
      CAMPAIGN_ID,
      expect.objectContaining({ status: 'active', total_posts_planned: 6 }),
    )
  })

  it('increments trial counter by postsCreated', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6)
  })

  it('marks session complete with posts_created and completed_at', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(updateGenerationSessionStatus).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      expect.objectContaining({ status: 'complete', posts_created: 6 }),
    )
  })
})

describe('generatePostsForCampaign — alreadyGeneratedTopics', () => {
  it('passes empty array to the first platform call', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const firstInput = vi.mocked(runPrompt).mock.calls[0][2] as { alreadyGeneratedTopics: string[] }
    expect(firstInput.alreadyGeneratedTopics).toEqual([])
  })

  it('passes first platform rationales to second platform call', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const secondInput = vi.mocked(runPrompt).mock.calls[1][2] as { alreadyGeneratedTopics: string[] }
    expect(secondInput.alreadyGeneratedTopics).toEqual(linkedinOutput.posts.map(p => p.rationale))
  })
})

describe('generatePostsForCampaign — platform post split (P-5)', () => {
  it('calls platforms in canonical order (linkedin before twitter)', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    const firstInput = vi.mocked(runPrompt).mock.calls[0][2] as { targetPlatform: string }
    const secondInput = vi.mocked(runPrompt).mock.calls[1][2] as { targetPlatform: string }
    expect(firstInput.targetPlatform).toBe('linkedin')
    expect(secondInput.targetPlatform).toBe('twitter')
  })

  it('calls schedulePosts for each active platform', async () => {
    await generatePostsForCampaign(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)

    expect(schedulePosts).toHaveBeenCalledTimes(2)
  })
})
