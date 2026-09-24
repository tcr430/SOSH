import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0017 Amendment E (J2.10) — the brief-review edit action carries the hypothesis and criteria: accepted
// BEFORE freeze, refused AFTER freeze, validated by the same Zod schema Stage A uses, and never clamped.
// OUTCOME-HYPOTHESIS-IN-BRIEF (24). The freeze guard itself (supabase/__tests__/mode2-brief-rls.test.ts) is
// run UNMODIFIED alongside this.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ getBriefByCampaign: vi.fn(), reviseBriefAndSupersedeProposals: vi.fn() }))
vi.mock('@/lib/campaigns/brief', () => ({ approveBriefIfQualified: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { editBriefAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign, reviseBriefAndSupersedeProposals } from '@/lib/db/campaign-briefs'
import type { CampaignRow, CampaignBriefRow, BusinessRow } from '@/lib/db/types'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const BUSINESS = { id: 'biz-1' } as BusinessRow
const CAMPAIGN = { id: 'camp-1', business_id: 'biz-1' } as CampaignRow
const CONTENT = {
  narrative: 'Original narrative', proofPlan: 'Original proof plan', pinnedEvidence: [],
  roleSequence: [{ order: 0, role: 'anchor_thesis' as const, platform: 'linkedin' as const, angle: 'a' }],
}
const brief = (over: Partial<CampaignBriefRow> = {}): CampaignBriefRow => ({
  id: 'brief-1', business_id: 'biz-1', campaign_id: 'camp-1', content: CONTENT, status: 'critiqued', version: 1,
  overall_score: 85, critique: null, frozen_at: null, deleted_at: null, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  plan_analysis_status: 'not_run', plan_analysis_reason: null, ...over,
})

const fd = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const edit = (extra: Record<string, string> = {}) =>
  editBriefAction({ status: 'idle' }, fd({ campaignId: CAMPAIGN_ID, expectedVersion: '1', narrative: 'N', proofPlan: 'P', ...extra }))
const good = { hypothesis: 'Threads beat singles for this brand', criteriaMetric: 'win_rate', criteriaTarget: '0.6', criteriaWindow: '14' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) } } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS)
  vi.mocked(getCampaignById).mockResolvedValue(CAMPAIGN)
  vi.mocked(getBriefByCampaign).mockResolvedValue(brief())
  vi.mocked(reviseBriefAndSupersedeProposals).mockResolvedValue(brief({ status: 'draft', version: 2 }))
})

describe('editBriefAction — hypothesis and success criteria', () => {
  it('BEFORE freeze: an edit with a valid hypothesis and criteria is accepted and written into the content', async () => {
    expect(await edit(good)).toEqual({ status: 'saved' })
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledWith('biz-1', 'brief-1', 1, {
      ...CONTENT, narrative: 'N', proofPlan: 'P',
      hypothesis: 'Threads beat singles for this brand',
      successCriteria: { metric: 'win_rate', target: 0.6, evaluationWindowDays: 14 },
    })
  })

  it('AFTER freeze: refused — an approved (frozen) brief is never revised, hypothesis or not', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status: 'approved', frozen_at: '2026-07-02T00:00:00Z' }))
    expect(await edit(good)).toEqual({ status: 'error', error: 'invalid_brief_state' })
    expect(reviseBriefAndSupersedeProposals).not.toHaveBeenCalled()
  })

  it.each([
    ['win_rate target above 0.95', { criteriaTarget: '0.99' }],
    ['win_rate target below 0.5', { criteriaTarget: '0.4' }],
    ['median_lift target below 1.0', { criteriaMetric: 'median_lift', criteriaTarget: '0.8' }],
    ['median_lift target above 3.0', { criteriaMetric: 'median_lift', criteriaTarget: '3.5' }],
    ['window below 7', { criteriaWindow: '6' }],
    ['window above 60', { criteriaWindow: '61' }],
    ['a non-integer window', { criteriaWindow: '14.5' }],
    ['an unmeasured metric', { criteriaMetric: 'reach' }],
    ['a hypothesis over 300 characters', { hypothesis: 'x'.repeat(301) }],
    ['a hypothesis with no criteria', { criteriaTarget: '', criteriaWindow: '' }],
    ['criteria with no hypothesis', { hypothesis: '' }],
  ])('REFUSED, never clamped: %s', async (_name, override) => {
    expect(await edit({ ...good, ...override })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(reviseBriefAndSupersedeProposals).not.toHaveBeenCalled()
  })

  it('all fields blank CLEARS the hypothesis and criteria', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ content: { ...CONTENT, hypothesis: 'Old', successCriteria: { metric: 'win_rate', target: 0.6, evaluationWindowDays: 14 } } }))
    expect(await edit({ hypothesis: '', criteriaMetric: 'win_rate', criteriaTarget: '', criteriaWindow: '' })).toEqual({ status: 'saved' })
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledWith('biz-1', 'brief-1', 1, { ...CONTENT, narrative: 'N', proofPlan: 'P' })
  })

  it('a form that does not carry the fields at all leaves an existing hypothesis unchanged', async () => {
    const withHypothesis = { ...CONTENT, hypothesis: 'Keep me', successCriteria: { metric: 'median_lift' as const, target: 1.5, evaluationWindowDays: 30 } }
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ content: withHypothesis }))
    await edit()
    expect(reviseBriefAndSupersedeProposals).toHaveBeenCalledWith('biz-1', 'brief-1', 1, { ...withHypothesis, narrative: 'N', proofPlan: 'P' })
  })
})
