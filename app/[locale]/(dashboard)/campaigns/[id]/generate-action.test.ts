import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ getBriefByCampaign: vi.fn() }))
vi.mock('@/lib/db/posts', () => ({ listPostsByCampaign: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/db/post-generation-sessions', () => ({ createGenerationSession: vi.fn(), getGenerationSession: vi.fn() }))
vi.mock('@/lib/campaigns/generate', () => ({ generatePostsForCampaign: vi.fn() }))

import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { listPostsByCampaign } from '@/lib/db/posts'
import { buildCustomerContext } from '@/lib/ai/context'
import { createGenerationSession } from '@/lib/db/post-generation-sessions'
import { generatePostsForCampaign } from '@/lib/campaigns/generate'
import { generateStage } from '@/lib/campaigns/generate-stage'
import { startGenerationAction } from './generate-action'

// ADR 0017 §11 / K2.12 — generation starts from an APPROVED brief on an 'awaiting_brief' campaign. Before K2.12 this
// action demanded 'draft', a state generatePostsForCampaign then rejected, so no production path could take an approved
// brief to posts (docs/backlog.md S34-APPROVE-TO-GENERATE).
//
// SHARED-FUNCTION CALLERS (ADR 0015): startGenerationAction's one production caller is GeneratePostsButton.tsx, shown
// only at generateStage(...) === 'generate'; the agreement between the two is asserted below.

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = '44444444-4444-4444-8444-444444444444'
const authClient = { auth: { getUser: vi.fn() }, tag: 'authenticated' }

const campaign = { id: CAMPAIGN_ID, business_id: BUSINESS_ID, status: 'awaiting_brief', total_posts_planned: 6 }

beforeEach(() => {
  vi.resetAllMocks()
  authClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.mocked(createClient).mockResolvedValue(authClient as never)
  vi.mocked(getBusinessForUser).mockResolvedValue({ id: BUSINESS_ID } as never)
  vi.mocked(getCampaignById).mockResolvedValue(campaign as never)
  vi.mocked(getBriefByCampaign).mockResolvedValue({ status: 'approved' } as never)
  vi.mocked(buildCustomerContext).mockResolvedValue({ brandVoice: { id: 'v' }, trialState: null } as never)
  vi.mocked(listPostsByCampaign).mockResolvedValue([])
  vi.mocked(createGenerationSession).mockResolvedValue({ id: SESSION_ID, business_id: BUSINESS_ID } as never)
})

describe('startGenerationAction — accepts exactly an approved brief on an awaiting_brief campaign', () => {
  it('starts a session and schedules generation for the approved-brief case', async () => {
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ sessionId: SESSION_ID })
    expect(createGenerationSession).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    // The scheduled callback is the real generation entry point with the ids this action resolved.
    const scheduled = vi.mocked(after).mock.calls[0][0] as () => unknown
    scheduled()
    expect(generatePostsForCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, BUSINESS_ID, SESSION_ID)
  })

  it("reads the brief through the caller's AUTHENTICATED client, never the service-role one", async () => {
    await startGenerationAction(CAMPAIGN_ID)
    expect(getBriefByCampaign).toHaveBeenCalledWith(authClient, CAMPAIGN_ID)
  })

  it.each([null, 'draft', 'critiqued', 'generated'] as const)('refuses brief_not_approved when the brief is %s, and starts nothing', async (status) => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(status === null ? null : ({ status } as never))
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'brief_not_approved' })
    expect(createGenerationSession).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it.each(['draft', 'active', 'paused', 'completed'] as const)('refuses a %s campaign: only awaiting_brief can generate', async (status) => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...campaign, status } as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'invalid_campaign_state' })
    expect(getBriefByCampaign).not.toHaveBeenCalled()
    expect(createGenerationSession).not.toHaveBeenCalled()
  })

  it("refuses another business's campaign, and a campaign with nothing planned", async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce({ ...campaign, business_id: '99999999-9999-4999-8999-999999999999' } as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'invalid_campaign_state' })
    vi.mocked(getCampaignById).mockResolvedValueOnce({ ...campaign, total_posts_planned: 0 } as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'invalid_campaign_state' })
    expect(createGenerationSession).not.toHaveBeenCalled()
  })

  it('keeps every pre-existing guard: brand voice, trial quota, and already-generated', async () => {
    vi.mocked(buildCustomerContext).mockResolvedValueOnce({ brandVoice: null, trialState: null } as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'invalid_campaign_state' })

    vi.mocked(buildCustomerContext).mockResolvedValueOnce({ brandVoice: { id: 'v' }, trialState: { postsRemaining: 2 } } as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'quota_exceeded' })

    vi.mocked(listPostsByCampaign).mockResolvedValueOnce([{ id: 'p' }] as never)
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'already_generated' })
    expect(createGenerationSession).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller and a malformed id', async () => {
    authClient.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    await expect(startGenerationAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'unauthorized' })
    await expect(startGenerationAction('not-a-uuid')).resolves.toEqual({ error: 'invalid_campaign_state' })
  })
})

describe('the page and the action agree', () => {
  it('startGenerationAction proceeds for exactly the combinations generateStage calls "generate"', async () => {
    const campaignStatuses = ['draft', 'awaiting_brief', 'active', 'paused', 'completed'] as const
    const briefStatuses = [null, 'draft', 'critiqued', 'approved', 'generated'] as const
    for (const c of campaignStatuses) {
      for (const b of briefStatuses) {
        vi.mocked(createGenerationSession).mockClear()
        vi.mocked(getCampaignById).mockResolvedValue({ ...campaign, status: c } as never)
        vi.mocked(getBriefByCampaign).mockResolvedValue(b === null ? null : ({ status: b } as never))
        const result = await startGenerationAction(CAMPAIGN_ID)
        const started = 'sessionId' in result
        expect(started, `${c}/${b}`).toBe(generateStage(c, b) === 'generate')
      }
    }
  })
})
