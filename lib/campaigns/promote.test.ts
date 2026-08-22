import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/studio-drafts', () => ({
  claimStudioDraftForPromotion: vi.fn(),
  writeBackPromotedCampaignId: vi.fn(),
}))
vi.mock('@/lib/db/campaigns', () => ({
  createCampaign: vi.fn(),
}))
vi.mock('@/lib/db/posts', () => ({
  createPosts: vi.fn(),
}))
vi.mock('@/lib/db/post-ai-originals', () => ({
  createPostAiOriginal: vi.fn(),
  AI_ORIGINAL_SCHEMA_VERSION: 1,
}))
vi.mock('@/lib/campaigns/brief', () => ({
  assembleBrief: vi.fn(),
}))

import { promoteDraftToCampaignCore } from './promote'
import { claimStudioDraftForPromotion, writeBackPromotedCampaignId } from '@/lib/db/studio-drafts'
import { createCampaign } from '@/lib/db/campaigns'
import { createPosts } from '@/lib/db/posts'
import { createPostAiOriginal } from '@/lib/db/post-ai-originals'
import { assembleBrief } from '@/lib/campaigns/brief'
import type { StudioDraftRow } from '@/lib/db/types'

// ADR 0022 §2, §3.3, §4 (Session 29, F1b.4) — PROMOTE-ACTION-VALIDATED:
// the Zod contract (incl. the max(5000) copy bound, §5.1), the losing-claim
// path performing NO writes, and the snapshot's BINDING condition (ADR 0018
// Amd A.1) — written iff accepted_revision is non-NULL, from THAT revision,
// never the human's raw draft.

const CLIENT = {} as never
const BUSINESS_ID = 'biz-1'
const DRAFT_ID = 'draft-1'
const SCHEDULED_AT = '2026-09-01T09:00:00.000Z'

function draftFixture(overrides: Partial<StudioDraftRow> = {}): StudioDraftRow {
  return {
    id: DRAFT_ID,
    business_id: BUSINESS_ID,
    content: 'A human-authored post about our new SSO feature.',
    platform: 'linkedin',
    content_hash: 'hash-1',
    suggestions: null,
    suggestions_for_hash: null,
    promotion_claimed_at: '2026-08-22T12:00:00.000Z',
    promoted_campaign_id: null,
    accepted_revision: null,
    deleted_at: null,
    created_at: '2026-08-22T11:00:00.000Z',
    updated_at: '2026-08-22T12:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

describe('promoteDraftToCampaignCore (ADR 0022 §2)', () => {
  it('claims, creates the campaign with origin=studio_promoted, writes back, inserts the post, and assembles the brief, in that order', async () => {
    const draft = draftFixture()
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: BUSINESS_ID } as never)
    vi.mocked(createPosts).mockResolvedValue([{ id: 'post-1' } as never])
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    const callOrder: string[] = []
    vi.mocked(createCampaign).mockImplementation(async () => {
      callOrder.push('createCampaign')
      return { id: 'campaign-1', business_id: BUSINESS_ID } as never
    })
    vi.mocked(writeBackPromotedCampaignId).mockImplementation(async () => {
      callOrder.push('writeBackPromotedCampaignId')
    })
    vi.mocked(createPosts).mockImplementation(async () => {
      callOrder.push('createPosts')
      return [{ id: 'post-1' } as never]
    })
    vi.mocked(assembleBrief).mockImplementation(async () => {
      callOrder.push('assembleBrief')
      return { id: 'brief-1' } as never
    })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'promoted', campaignId: 'campaign-1', briefId: 'brief-1', postId: 'post-1' })
    expect(createCampaign).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ business_id: BUSINESS_ID, origin: 'studio_promoted', platforms: ['linkedin'] }),
    )
    expect(createPosts).toHaveBeenCalledWith(CLIENT, [
      expect.objectContaining({
        campaign_id: 'campaign-1',
        business_id: BUSINESS_ID,
        platform: 'linkedin',
        content: draft.content,
        scheduled_at: SCHEDULED_AT,
        status: 'draft',
      }),
    ])
    // ADR 0022 §2.1 — write-back BEFORE the post insert and assembleBrief.
    expect(callOrder).toEqual(['createCampaign', 'writeBackPromotedCampaignId', 'createPosts', 'assembleBrief'])
  })

  it('a LOSING claim (already_promoted) performs NO writes and returns the typed outcome', async () => {
    const draft = draftFixture({ promoted_campaign_id: 'campaign-existing' })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'already_promoted', draft })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'already_promoted', draft })
    expect(createCampaign).not.toHaveBeenCalled()
    expect(writeBackPromotedCampaignId).not.toHaveBeenCalled()
    expect(createPosts).not.toHaveBeenCalled()
    expect(createPostAiOriginal).not.toHaveBeenCalled()
    expect(assembleBrief).not.toHaveBeenCalled()
  })

  it('a LOSING claim (claimed_by_another) performs NO writes and returns the typed outcome', async () => {
    const draft = draftFixture()
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed_by_another', draft })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'claimed_by_another', draft })
    expect(createCampaign).not.toHaveBeenCalled()
    expect(writeBackPromotedCampaignId).not.toHaveBeenCalled()
    expect(createPosts).not.toHaveBeenCalled()
    expect(createPostAiOriginal).not.toHaveBeenCalled()
    expect(assembleBrief).not.toHaveBeenCalled()
  })

  it('a WON but ineligible claim (empty content) returns not_eligible and performs no further writes', async () => {
    const draft = draftFixture({ content: '   ' })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'not_eligible' })
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('a WON but ineligible claim (platform NULL) returns not_eligible and performs no further writes', async () => {
    const draft = draftFixture({ platform: null })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'not_eligible' })
    expect(createCampaign).not.toHaveBeenCalled()
  })

  // ADR 0022 §5.1 — studio_drafts.content is UNBOUNDED today; promote must
  // not be the one write path into posts.content with a weaker contract
  // than calendar/actions.ts:48 and posts/actions.ts:179's max(5000).
  it('content over 5000 characters returns content_too_long and performs no further writes', async () => {
    const draft = draftFixture({ content: 'x'.repeat(5001) })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'content_too_long' })
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('content at exactly 5000 characters is accepted', async () => {
    const draft = draftFixture({ content: 'x'.repeat(5000) })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: BUSINESS_ID } as never)
    vi.mocked(createPosts).mockResolvedValue([{ id: 'post-1' } as never])
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result.outcome).toBe('promoted')
  })

  // ADR 0018 Amendment A.1's BINDING corollary — the single most damaging
  // mistake available in this step.
  it('writes the post_ai_originals snapshot from accepted_revision, generation_kind=studio_promoted, when accepted_revision is NON-NULL', async () => {
    const draft = draftFixture({ accepted_revision: 'The AI-suggested revision the human accepted.' })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: BUSINESS_ID } as never)
    vi.mocked(createPosts).mockResolvedValue([{ id: 'post-1' } as never])
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(createPostAiOriginal).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        business_id: BUSINESS_ID,
        post_id: 'post-1',
        campaign_id: 'campaign-1',
        generation_kind: 'studio_promoted',
        rendered_content: draft.accepted_revision,
        payload: expect.objectContaining({ content: draft.accepted_revision }),
      }),
    )
    // Never the human's raw draft.content as the snapshot payload.
    const call = vi.mocked(createPostAiOriginal).mock.calls[0][1]
    expect(call.rendered_content).not.toBe(draft.content)
  })

  it('writes NO post_ai_originals row when accepted_revision is NULL (human-authored, no suggestion accepted)', async () => {
    const draft = draftFixture({ accepted_revision: null })
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })
    vi.mocked(createCampaign).mockResolvedValue({ id: 'campaign-1', business_id: BUSINESS_ID } as never)
    vi.mocked(createPosts).mockResolvedValue([{ id: 'post-1' } as never])
    vi.mocked(assembleBrief).mockResolvedValue({ id: 'brief-1' } as never)

    await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(createPostAiOriginal).not.toHaveBeenCalled()
  })

  it('a thrown error after a successful claim is caught and returns a typed error outcome, never a crash', async () => {
    const draft = draftFixture()
    vi.mocked(claimStudioDraftForPromotion).mockResolvedValue({ outcome: 'claimed', draft })
    vi.mocked(createCampaign).mockRejectedValue(new Error('db unavailable'))

    const result = await promoteDraftToCampaignCore(CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)

    expect(result).toEqual({ outcome: 'error' })
  })
})
