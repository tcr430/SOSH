import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/campaigns/prepare-brief', () => ({ prepareBriefForCampaign: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getCampaignById } from '@/lib/db/campaigns'
import { prepareBriefForCampaign } from '@/lib/campaigns/prepare-brief'
import { prepareBriefAction } from './prepare-brief-action'

// K2.12 — retry the brief pipeline for a campaign left 'draft' because Stage A failed at submit.
//
// SHARED-FUNCTION CALLERS (ADR 0015): prepareBriefAction's one production caller is PrepareBriefButton.tsx, shown only at
// generateStage(...) === 'prepare_brief' (a draft campaign, for an author). prepareBriefForCampaign now has TWO production
// callers, both asserted to pass the caller's authenticated client: createCampaignAction (campaigns/new/actions.test.ts)
// and this action (below).

const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const OWNER_ID = 'owner-1'
const authClient = { auth: { getUser: vi.fn() }, tag: 'authenticated' }

const business = { id: BUSINESS_ID, owner_id: OWNER_ID }
const campaign = { id: CAMPAIGN_ID, business_id: BUSINESS_ID, status: 'draft' }

beforeEach(() => {
  vi.resetAllMocks()
  authClient.auth.getUser.mockResolvedValue({ data: { user: { id: OWNER_ID } } })
  vi.mocked(createClient).mockResolvedValue(authClient as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(business as never)
  vi.mocked(getCampaignById).mockResolvedValue(campaign as never)
  vi.mocked(prepareBriefForCampaign).mockResolvedValue({ briefReady: true, critiqued: true })
})

describe('prepareBriefAction', () => {
  it("runs the pipeline for a draft campaign on the caller's AUTHENTICATED client and revalidates the page", async () => {
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ briefReady: true })
    expect(prepareBriefForCampaign).toHaveBeenCalledWith(authClient, CAMPAIGN_ID)
    expect(revalidatePath).toHaveBeenCalledWith(`/[locale]/campaigns/${CAMPAIGN_ID}`, 'page')
  })

  it('reports failed when Stage A fails again, and does not revalidate', async () => {
    vi.mocked(prepareBriefForCampaign).mockResolvedValue({ briefReady: false })
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'failed' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['awaiting_brief', 'active', 'paused', 'completed'] as const)(
    'refuses a %s campaign: only a draft can be (re)prepared, so a stale page cannot create a second brief',
    async (status) => {
      vi.mocked(getCampaignById).mockResolvedValue({ ...campaign, status } as never)
      await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'invalid_campaign_state' })
      expect(prepareBriefForCampaign).not.toHaveBeenCalled()
    },
  )

  it("refuses another business's campaign and a missing one, without leaking which", async () => {
    vi.mocked(getCampaignById).mockResolvedValueOnce({ ...campaign, business_id: '99999999-9999-4999-8999-999999999999' } as never)
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'not_found' })
    vi.mocked(getCampaignById).mockRejectedValueOnce(new Error('missing'))
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'not_found' })
    expect(prepareBriefForCampaign).not.toHaveBeenCalled()
  })

  it('refuses a member without the author capability (a viewer), and allows an editor', async () => {
    authClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'member-1' } } })
    vi.mocked(getMemberForUser).mockResolvedValueOnce({ role: 'viewer', is_admin: false } as never)
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'forbidden' })
    expect(prepareBriefForCampaign).not.toHaveBeenCalled()

    vi.mocked(getMemberForUser).mockResolvedValueOnce({ role: 'editor', is_admin: false } as never)
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ briefReady: true })
  })

  it('rejects an unauthenticated caller, a caller with no business, and a malformed id', async () => {
    authClient.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'unauthorized' })
    vi.mocked(getBusinessForUser).mockResolvedValueOnce(null as never)
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'unauthorized' })
    await expect(prepareBriefAction('not-a-uuid')).resolves.toEqual({ error: 'invalid_input' })
    expect(prepareBriefForCampaign).not.toHaveBeenCalled()
  })

  it('never throws: an unexpected failure is reported as failed', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('boom'))
    await expect(prepareBriefAction(CAMPAIGN_ID)).resolves.toEqual({ error: 'failed' })
  })
})
