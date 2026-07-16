import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))

vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  getPostById: vi.fn(),
  approvePost: vi.fn(),
  unapprovePost: vi.fn(),
  skipPost: vi.fn(),
  unskipPost: vi.fn(),
  updatePostContent: vi.fn(),
  updatePostContentAndMetadata: vi.fn(),
  bulkApproveDraftPosts: vi.fn(),
  // Real value, not vi.fn(): actions.ts reads this at module scope to build
  // bulkApproveSchema's .max() bound, so a missing/mocked constant would
  // silently produce .max(undefined) (Session 22-E, ADR 0014 §A1.2).
  APPROVALS_POST_LIMIT: 200,
  getPostSiblingTopics: vi.fn(),
}))

vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: vi.fn(),
}))

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { regeneratePostAction, bulkApprovePostsAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import {
  getPostById,
  getPostSiblingTopics,
  updatePostContentAndMetadata,
  bulkApproveDraftPosts,
  APPROVALS_POST_LIMIT,
} from '@/lib/db/posts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { AiError } from '@/lib/ai/errors'
import type { BusinessRow, CampaignRow, PostRow, AiGenerationMetadata } from '@/lib/db/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_POST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const VALID_CAMPAIGN_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const VALID_FEEDBACK = 'The tone was too formal, make it more casual'

const MOCK_USER = { id: 'user-123' }

const MOCK_BUSINESS: BusinessRow = {
  id: 'biz-456',
  name: 'Acme Corp',
  website: 'https://acme.com',
  industry: 'SaaS',
  description: 'A SaaS company',
  logo_url: null,
  owner_id: 'user-123',
  plan: 'trial',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const MOCK_CAMPAIGN: CampaignRow = {
  id: VALID_CAMPAIGN_ID,
  business_id: 'biz-456',
  name: 'Q2 Launch',
  objective: 'Drive awareness',
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'daily',
  posts_per_week: 7,
  start_date: '2026-05-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 10,
  total_posts_published: 0,
  voice_variation_id: null,
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
}

const BASE_METADATA: AiGenerationMetadata = {
  promptId: 'post-generation',
  promptVersion: 1,
  model: 'claude-sonnet-4-6',
  generationSessionId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  platformContext: 'linkedin constraints v1',
  platformConstraintsVersion: 1,
  rationale: 'Tuesday post leans on product launch angle',
  regenerationCount: 0,
  previousVersions: [],
  generatedAt: '2026-05-23T10:00:00Z',
}

const MOCK_DRAFT_POST: PostRow = {
  id: VALID_POST_ID,
  campaign_id: VALID_CAMPAIGN_ID,
  business_id: 'biz-456',
  platform: 'linkedin',
  content: 'Original post content',
  hashtags: ['#saas', '#launch'],
  media_urls: [],
  scheduled_at: '2026-05-27T09:00:00Z',
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'draft',
  rejection_note: null,
  ai_generation_metadata: BASE_METADATA as unknown as Record<string, unknown>,
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-05-23T10:00:00Z',
  updated_at: '2026-05-23T10:00:00Z',
}

const MOCK_AI_CTX = {
  business: {
    id: 'biz-456',
    name: 'Acme Corp',
    industry: 'SaaS',
    description: null,
    language: 'en',
    website: null,
    timezone: 'UTC',
  },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: { postsRemaining: 10, campaignsRemaining: 1 },
}

const MOCK_REGEN_OUTPUT = {
  content: 'Refreshed post content with casual tone',
  hashtags: ['#saas'],
  rationale: 'More casual tone as requested',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuthClient() {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
  }
  vi.mocked(createClient).mockResolvedValue(client as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── regeneratePostAction ──────────────────────────────────────────────────────

describe('regeneratePostAction', () => {
  it('returns not_eligible when post status is not draft', async () => {
    // Arrange
    makeAuthClient()
    vi.mocked(getPostById).mockResolvedValue({ ...MOCK_DRAFT_POST, status: 'approved' })
    vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)

    // Act
    const result = await regeneratePostAction(VALID_POST_ID, VALID_FEEDBACK)

    // Assert
    expect(result).toEqual({ error: 'not_eligible' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('returns quota_exceeded when trial postsRemaining is 0', async () => {
    // Arrange
    makeAuthClient()
    vi.mocked(getPostById).mockResolvedValue(MOCK_DRAFT_POST)
    vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
    vi.mocked(getPostSiblingTopics).mockResolvedValue([])
    vi.mocked(buildCustomerContext).mockResolvedValue({
      ...MOCK_AI_CTX,
      trialState: { postsRemaining: 0, campaignsRemaining: 0 },
    } as never)

    // Act
    const result = await regeneratePostAction(VALID_POST_ID, VALID_FEEDBACK)

    // Assert
    expect(result).toEqual({ error: 'quota_exceeded' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('returns success and calls updatePostContentAndMetadata when runPrompt succeeds', async () => {
    // Arrange
    makeAuthClient()
    vi.mocked(getPostById).mockResolvedValue(MOCK_DRAFT_POST)
    vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
    vi.mocked(getPostSiblingTopics).mockResolvedValue(['other angle'])
    vi.mocked(buildCustomerContext).mockResolvedValue(MOCK_AI_CTX as never)
    vi.mocked(runPrompt).mockResolvedValue(MOCK_REGEN_OUTPUT as never)
    vi.mocked(updatePostContentAndMetadata).mockResolvedValue({
      ...MOCK_DRAFT_POST,
      content: MOCK_REGEN_OUTPUT.content,
    })

    // Act
    const result = await regeneratePostAction(VALID_POST_ID, VALID_FEEDBACK)

    // Assert
    expect(result).toEqual({
      success: true,
      content: MOCK_REGEN_OUTPUT.content,
      hashtags: MOCK_REGEN_OUTPUT.hashtags,
    })
    expect(updatePostContentAndMetadata).toHaveBeenCalledOnce()
    const [, calledPostId, patch] = vi.mocked(updatePostContentAndMetadata).mock.calls[0]
    expect(calledPostId).toBe(VALID_POST_ID)
    expect(patch.content).toBe(MOCK_REGEN_OUTPUT.content)
    expect(patch.hashtags).toEqual(MOCK_REGEN_OUTPUT.hashtags)
    expect(patch.metadata.regenerationCount).toBe(1)
    expect(patch.metadata.rationale).toBe(MOCK_REGEN_OUTPUT.rationale)
  })

  it('caps previousVersions at 5 — oldest entry is dropped when already at limit', async () => {
    // Arrange: post already has 5 previous versions
    const fullHistory: AiGenerationMetadata['previousVersions'] = [
      { content: 'v5', rejectionNote: 'note5', regeneratedAt: '2026-05-23T05:00:00Z' },
      { content: 'v4', rejectionNote: 'note4', regeneratedAt: '2026-05-23T04:00:00Z' },
      { content: 'v3', rejectionNote: 'note3', regeneratedAt: '2026-05-23T03:00:00Z' },
      { content: 'v2', rejectionNote: 'note2', regeneratedAt: '2026-05-23T02:00:00Z' },
      { content: 'v1', rejectionNote: 'note1', regeneratedAt: '2026-05-23T01:00:00Z' },
    ]
    const postWithHistory: PostRow = {
      ...MOCK_DRAFT_POST,
      ai_generation_metadata: {
        ...BASE_METADATA,
        regenerationCount: 5,
        previousVersions: fullHistory,
      } as unknown as Record<string, unknown>,
    }

    makeAuthClient()
    vi.mocked(getPostById).mockResolvedValue(postWithHistory)
    vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
    vi.mocked(getPostSiblingTopics).mockResolvedValue([])
    vi.mocked(buildCustomerContext).mockResolvedValue(MOCK_AI_CTX as never)
    vi.mocked(runPrompt).mockResolvedValue(MOCK_REGEN_OUTPUT as never)
    vi.mocked(updatePostContentAndMetadata).mockResolvedValue(postWithHistory)

    // Act
    await regeneratePostAction(VALID_POST_ID, VALID_FEEDBACK)

    // Assert: still 5 entries; newest first; oldest (v1) dropped
    const [, , patch] = vi.mocked(updatePostContentAndMetadata).mock.calls[0]
    const versions = patch.metadata.previousVersions
    expect(versions).toHaveLength(5)
    expect(versions[0].content).toBe(MOCK_DRAFT_POST.content) // new entry is prepended
    expect(versions[4].content).toBe('v2')                    // v1 (oldest) was dropped; v2 is now last
  })

  it('maps AiError code to error string without calling updatePostContentAndMetadata', async () => {
    // Arrange
    makeAuthClient()
    vi.mocked(getPostById).mockResolvedValue(MOCK_DRAFT_POST)
    vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
    vi.mocked(getPostSiblingTopics).mockResolvedValue([])
    vi.mocked(buildCustomerContext).mockResolvedValue(MOCK_AI_CTX as never)
    vi.mocked(runPrompt).mockRejectedValue(new AiError('rate_limited', 'Rate limit hit'))

    // Act
    const result = await regeneratePostAction(VALID_POST_ID, VALID_FEEDBACK)

    // Assert
    expect(result).toEqual({ error: 'rate_limited' })
    expect(updatePostContentAndMetadata).not.toHaveBeenCalled()
  })
})

// ── bulkApprovePostsAction (Session 22-D: renderedIds only, BLOCKER-1/2) ───────

describe('bulkApprovePostsAction', () => {
  const RENDERED_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  const RENDERED_ID_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

  it('passes renderedIds and the caller business id through to bulkApproveDraftPosts', async () => {
    makeAuthClient()
    vi.mocked(bulkApproveDraftPosts).mockResolvedValue(2)

    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, [RENDERED_ID_1, RENDERED_ID_2])

    expect(bulkApproveDraftPosts).toHaveBeenCalledWith(
      expect.anything(),
      VALID_CAMPAIGN_ID,
      [RENDERED_ID_1, RENDERED_ID_2],
      MOCK_BUSINESS.id,
    )
    expect(result).toEqual({ success: true, count: 2 })
  })

  it('regression: unfiltered bulk over a fully-rendered small campaign still approves all of them', async () => {
    makeAuthClient()
    vi.mocked(bulkApproveDraftPosts).mockResolvedValue(3)
    const allIds = [RENDERED_ID_1, RENDERED_ID_2, VALID_POST_ID]

    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, allIds)

    expect(bulkApproveDraftPosts).toHaveBeenCalledWith(
      expect.anything(),
      VALID_CAMPAIGN_ID,
      allIds,
      MOCK_BUSINESS.id,
    )
    expect(result).toEqual({ success: true, count: 3 })
  })

  it('rejects a non-uuid renderedIds entry (Zod)', async () => {
    makeAuthClient()
    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, ['not-a-uuid'])
    expect(result).toEqual({ error: 'invalid_input' })
    expect(bulkApproveDraftPosts).not.toHaveBeenCalled()
  })

  it('rejects a renderedIds array longer than APPROVALS_POST_LIMIT (Session 22-E, ADR 0014 §A1.2)', async () => {
    makeAuthClient()
    // One past the cap. Above ~210 ids the PostgREST query string crosses the
    // 8 KB request-line limit and the write fails closed with an opaque error
    // — §A1.1 rejected the id-list mechanism over exactly this, so the cap is
    // what makes §A1.2's reversal safe. A Server Action is a public endpoint;
    // Zod is the only real bound, not the UI's render count.
    const tooMany = Array.from(
      { length: APPROVALS_POST_LIMIT + 1 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    )

    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, tooMany)

    expect(result).toEqual({ error: 'invalid_input' })
    expect(bulkApproveDraftPosts).not.toHaveBeenCalled()
  })

  it('accepts a renderedIds array exactly at APPROVALS_POST_LIMIT (boundary)', async () => {
    makeAuthClient()
    vi.mocked(bulkApproveDraftPosts).mockResolvedValue(APPROVALS_POST_LIMIT)
    const atCap = Array.from(
      { length: APPROVALS_POST_LIMIT },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    )

    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, atCap)

    expect(result).toEqual({ success: true, count: APPROVALS_POST_LIMIT })
  })

  it('empty renderedIds still calls through (bulkApproveDraftPosts short-circuits to 0)', async () => {
    makeAuthClient()
    vi.mocked(bulkApproveDraftPosts).mockResolvedValue(0)

    const result = await bulkApprovePostsAction(VALID_CAMPAIGN_ID, [])

    expect(bulkApproveDraftPosts).toHaveBeenCalledWith(expect.anything(), VALID_CAMPAIGN_ID, [], MOCK_BUSINESS.id)
    expect(result).toEqual({ success: true, count: 0 })
  })
})
