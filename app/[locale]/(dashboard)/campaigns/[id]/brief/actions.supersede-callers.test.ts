import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0027 §5.7 — Session 34-D D4 (BLOCKER-1), SHARED-FUNCTION CALLERS. The three actions that move a brief are
// the callers of the two supersede wrappers; EACH is asserted on the wrapper mock's ARGUMENTS, with the LOADED
// brief's business_id (never the action input's):
//   approveBriefAction -> approveBriefIfQualified (REAL, lib/campaigns/brief.ts) -> approveBriefAndSupersedeProposals
//   rejectBriefAction  -> reviseBriefAndSupersedeProposals
//   editBriefAction    -> reviseBriefAndSupersedeProposals
// approveBriefIfQualified is deliberately NOT mocked here (the sibling actions.test.ts mocks it), so this file
// proves the approve action reaches the wrapper and that a below-threshold brief never does.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn(), moveCampaignToAwaitingBrief: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: vi.fn(),
  createBrief: vi.fn(),
  submitBriefForCritique: vi.fn(),
  approveBriefAndSupersedeProposals: vi.fn(),
  reviseBriefAndSupersedeProposals: vi.fn(),
}))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/ai/runner', () => ({ runPrompt: vi.fn() }))
vi.mock('@/lib/ai/wrap-evidence', () => ({ wrapEvidenceForPrompt: vi.fn(), neutralize: vi.fn((s: string) => s) }))
vi.mock('@/lib/memory', () => ({
  retrieveEvidenceMemory: vi.fn(),
  retrieveAudienceMemory: vi.fn(),
  retrieveBrandMemory: vi.fn(),
  retrieveHypothesisResults: vi.fn(),
}))
vi.mock('@/lib/db/posts', () => ({ listPostsByCampaign: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { approveBriefAction, rejectBriefAction, editBriefAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import {
  getBriefByCampaign,
  approveBriefAndSupersedeProposals,
  reviseBriefAndSupersedeProposals,
} from '@/lib/db/campaign-briefs'
import type { CampaignRow, CampaignBriefRow, BusinessRow } from '@/lib/db/types'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const BUSINESS = { id: 'biz-loaded' } as BusinessRow
const CAMPAIGN = { id: 'camp-1', business_id: 'biz-loaded' } as CampaignRow
const CONTENT = {
  narrative: 'Original narrative',
  proofPlan: 'Original proof plan',
  pinnedEvidence: [],
  roleSequence: [{ order: 0, role: 'anchor_thesis' as const, platform: 'linkedin' as const, angle: 'a' }],
}
const brief = (over: Partial<CampaignBriefRow> = {}): CampaignBriefRow =>
  ({
    id: 'brief-1',
    business_id: 'biz-loaded',
    campaign_id: 'camp-1',
    content: CONTENT,
    status: 'critiqued',
    version: 1,
    overall_score: 85,
    critique: { critique: ['note'] },
    frozen_at: null,
    deleted_at: null,
    ...over,
  }) as CampaignBriefRow

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) } } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS)
  vi.mocked(getCampaignById).mockResolvedValue(CAMPAIGN)
  vi.mocked(getBriefByCampaign).mockResolvedValue(brief())
})

describe("the three brief-moving actions call the supersede wrappers with the LOADED brief's business_id (BLOCKER-1)", () => {
  it('approveBriefAction -> approveBriefIfQualified (real) -> approveBriefAndSupersedeProposals(biz-loaded, brief-1)', async () => {
    vi.mocked(approveBriefAndSupersedeProposals).mockResolvedValue(brief({ status: 'approved', frozen_at: '2026-09-24T00:00:00Z' }))

    const result = await approveBriefAction({ status: 'idle' }, formDataOf({ campaignId: CAMPAIGN_ID }))

    expect(result).toEqual({ status: 'approved' })
    expect(approveBriefAndSupersedeProposals).toHaveBeenCalledTimes(1)
    expect(approveBriefAndSupersedeProposals).toHaveBeenCalledWith('biz-loaded', 'brief-1')
  })

  it('approveBriefAction: a below-threshold brief is REFUSED and never reaches the wrapper', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ overall_score: 55 }))

    const result = await approveBriefAction({ status: 'idle' }, formDataOf({ campaignId: CAMPAIGN_ID }))

    expect(result).toMatchObject({ status: 'gate_refused', overallScore: 55 })
    expect(approveBriefAndSupersedeProposals).not.toHaveBeenCalled()
  })

  it("rejectBriefAction -> reviseBriefAndSupersedeProposals(biz-loaded, brief-1, expectedVersion, the brief's own content)", async () => {
    vi.mocked(reviseBriefAndSupersedeProposals).mockResolvedValue(brief({ status: 'draft', version: 2 }))

    const result = await rejectBriefAction({ status: 'idle' }, formDataOf({ campaignId: CAMPAIGN_ID, expectedVersion: '1' }))

    expect(result).toEqual({ status: 'rejected' })
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledTimes(1)
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledWith('biz-loaded', 'brief-1', 1, CONTENT)
  })

  it('editBriefAction -> reviseBriefAndSupersedeProposals(biz-loaded, brief-1, expectedVersion, edited content)', async () => {
    vi.mocked(reviseBriefAndSupersedeProposals).mockResolvedValue(brief({ status: 'draft', version: 2 }))

    const result = await editBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: CAMPAIGN_ID, expectedVersion: '1', narrative: 'New narrative', proofPlan: 'New proof' }),
    )

    expect(result).toEqual({ status: 'saved' })
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledTimes(1)
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledWith(
      'biz-loaded',
      'brief-1',
      1,
      expect.objectContaining({ narrative: 'New narrative', proofPlan: 'New proof' }),
    )
  })

  it("a null from the wrapper (concurrent edit) surfaces concurrent_edit on both revise callers — the predecessor's contract", async () => {
    vi.mocked(reviseBriefAndSupersedeProposals).mockResolvedValue(null)

    expect(await rejectBriefAction({ status: 'idle' }, formDataOf({ campaignId: CAMPAIGN_ID, expectedVersion: '1' }))).toEqual({
      status: 'error',
      error: 'concurrent_edit',
    })
    expect(
      await editBriefAction(
        { status: 'idle' },
        formDataOf({ campaignId: CAMPAIGN_ID, expectedVersion: '1', narrative: 'N', proofPlan: 'P' }),
      ),
    ).toEqual({ status: 'error', error: 'concurrent_edit' })
  })
})
