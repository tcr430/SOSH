import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  listActiveSocialAccounts: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  listRecentPublishedPostTexts: vi.fn(),
}))

vi.mock('@/lib/db/brand-voices', () => ({
  upsertBrandVoice: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  runPrompt: vi.fn(),
  buildCustomerContext: vi.fn(),
  brandVoiceInferencePrompt: { id: 'brand-voice-inference', version: 1 },
  AiError: class AiError extends Error {
    constructor(public code: string, msg = '') {
      super(msg)
      this.name = 'AiError'
    }
  },
}))

// ── imports (after mocks) ──────────────────────────────────────────────────

import { refineFromPostsAction } from './refine-from-posts-action'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { listRecentPublishedPostTexts } from '@/lib/db/posts'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { runPrompt, buildCustomerContext, brandVoiceInferencePrompt, AiError } from '@/lib/ai'

// ── fixtures ───────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'user-1' }
const MOCK_BUSINESS = { id: 'biz-1', name: 'Acme', industry: 'saas', language: 'en' }
const MOCK_ACCOUNTS = [{ id: 'acc-1', platform: 'linkedin', is_active: true }]
const MOCK_POSTS = ['Post one text', 'Post two text', 'Post three text']
const MOCK_CTX = { business: MOCK_BUSINESS }
const MOCK_AXES = {
  formal_casual: 40, expert_peer: 30, serious_playful: 50,
  reserved_warm: 60, calm_energetic: 55, rational_emotional: 45, exclusive_inclusive: 50,
}
const MOCK_RESULT = {
  voiceAxes: MOCK_AXES,
  tone: ['professional', 'warm'],
  keywords: ['saas', 'productivity'],
  avoidWords: ['synergy'],
  targetAudience: 'B2B SaaS founders',
  uniqueValueProp: 'AI-powered social media.',
  competitors: [],
}
const MOCK_SERVICE_CLIENT = { __tag: 'service' }

function makeAuthClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
  }
}

// ── test suite ─────────────────────────────────────────────────────────────

describe('refineFromPostsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createClient).mockResolvedValue(makeAuthClient() as never)
    vi.mocked(createServiceRoleClient).mockReturnValue(MOCK_SERVICE_CLIENT as never)
    vi.mocked(getBusinessByOwner).mockResolvedValue(MOCK_BUSINESS as never)
    vi.mocked(listActiveSocialAccounts).mockResolvedValue(MOCK_ACCOUNTS as never)
    vi.mocked(listRecentPublishedPostTexts).mockResolvedValue(MOCK_POSTS)
    vi.mocked(buildCustomerContext).mockResolvedValue(MOCK_CTX as never)
    vi.mocked(runPrompt).mockResolvedValue(MOCK_RESULT)
    vi.mocked(upsertBrandVoice).mockResolvedValue(undefined)
  })

  it('returns no_connected_accounts when no active social accounts exist', async () => {
    vi.mocked(listActiveSocialAccounts).mockResolvedValue([])
    const result = await refineFromPostsAction()
    expect(result).toEqual({ error: 'no_connected_accounts' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('returns no_posts when no published posts exist in the database', async () => {
    vi.mocked(listRecentPublishedPostTexts).mockResolvedValue([])
    const result = await refineFromPostsAction()
    expect(result).toEqual({ error: 'no_posts' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('calls brandVoiceInferencePrompt with post texts as writingExamples (reuses §5 assessment, not a new prompt)', async () => {
    await refineFromPostsAction()
    const [calledPrompt, , input] = vi.mocked(runPrompt).mock.calls[0] as [
      typeof brandVoiceInferencePrompt,
      unknown,
      { writingExamples: string[]; websiteText: null },
    ]
    expect(calledPrompt.id).toBe('brand-voice-inference')
    expect(input.writingExamples).toEqual(MOCK_POSTS)
    expect(input.websiteText).toBeNull()
  })

  it('fetches at most 3 posts (cap-3 per ADR §7)', async () => {
    await refineFromPostsAction()
    const [, , limit] = vi.mocked(listRecentPublishedPostTexts).mock.calls[0] as [
      unknown, unknown, number
    ]
    expect(limit).toBe(3)
  })

  it('returns trial_cap_reached when the trial cap is exhausted (same cap as initial inference)', async () => {
    vi.mocked(runPrompt).mockRejectedValue(new AiError('quota_exceeded', 'Trial cap hit'))
    const result = await refineFromPostsAction()
    expect(result).toEqual({ error: 'trial_cap_reached', errorCode: 'quota_exceeded' })
  })

  it('returns generic error for other AI failures', async () => {
    vi.mocked(runPrompt).mockRejectedValue(new AiError('provider_error', 'Service unavailable'))
    const result = await refineFromPostsAction()
    expect(result).toEqual({ error: 'generic', errorCode: 'provider_error' })
  })

  it('upserts brand voice with new axes and returns success', async () => {
    const result = await refineFromPostsAction()
    expect(result).toEqual({ success: true })
    expect(upsertBrandVoice).toHaveBeenCalledWith(
      MOCK_SERVICE_CLIENT,
      expect.objectContaining({
        business_id: MOCK_BUSINESS.id,
        voice_axes: MOCK_AXES,
        tone: MOCK_RESULT.tone,
        keywords: MOCK_RESULT.keywords,
        avoid_words: MOCK_RESULT.avoidWords,
      }),
    )
  })
})
