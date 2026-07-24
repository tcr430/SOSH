import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))
vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
}))
vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: vi.fn(),
  reviseBrief: vi.fn(),
}))
vi.mock('@/lib/campaigns/brief', () => ({
  approveBriefIfQualified: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { approveBriefAction, rejectBriefAction, editBriefAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign, reviseBrief } from '@/lib/db/campaign-briefs'
import { approveBriefIfQualified } from '@/lib/campaigns/brief'
import type { CampaignRow, CampaignBriefRow, BusinessRow } from '@/lib/db/types'

const MOCK_USER = { id: 'user-1' }
const MOCK_BUSINESS: BusinessRow = {
  id: 'biz-1', name: 'Acme', website: null, industry: null, description: null, logo_url: null,
  owner_id: 'user-1', plan: 'plus', stripe_customer_id: null, stripe_subscription_id: null,
  language: 'en', timezone: 'UTC', onboarding_completed: true, total_posts_published: 0,
  deleted_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}
const MOCK_CAMPAIGN: CampaignRow = {
  id: 'camp-1', business_id: 'biz-1', name: 'Q3', objective: 'Grow', special_instructions: null,
  platforms: ['linkedin'], frequency: 'weekly', posts_per_week: 3, start_date: '2026-08-01',
  end_date: null, status: 'awaiting_brief', total_posts_planned: 3, total_posts_published: 0,
  voice_variation_id: null, origin: 'objective_generated', deleted_at: null,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
}
const MOCK_CONTENT = {
  narrative: 'Original narrative', proofPlan: 'Original proof plan',
  pinnedEvidence: [], roleSequence: [{ order: 0, role: 'anchor_thesis' as const, platform: 'linkedin' as const, angle: 'a' }],
}
function makeBrief(overrides: Partial<CampaignBriefRow> = {}): CampaignBriefRow {
  return {
    id: 'brief-1', business_id: 'biz-1', campaign_id: 'camp-1', content: MOCK_CONTENT,
    status: 'critiqued', version: 1, overall_score: 85, critique: { critique: ['note'] },
    frozen_at: null, deleted_at: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function makeAuthClient() {
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) } }
  vi.mocked(createClient).mockResolvedValue(client as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS)
  return client
}

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  makeAuthClient()
  vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
  vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
})

describe('approveBriefAction — Zod validation', () => {
  it('rejects a malformed campaignId (not a uuid) without touching the DB', async () => {
    const result = await approveBriefAction({ status: 'idle' }, formDataOf({ campaignId: 'not-a-uuid' }))
    expect(result).toEqual({ status: 'error', error: 'invalid_input' })
    expect(getCampaignById).not.toHaveBeenCalled()
  })
})

describe('approveBriefAction — the HARD gate holds at the app layer (MODE2-CRITIQUE-GATE)', () => {
  it('is REFUSED below threshold — approveBriefIfQualified drives the decision, not re-implemented here', async () => {
    vi.mocked(approveBriefIfQualified).mockResolvedValue({ approved: false, overallScore: 55, critique: null })

    const result = await approveBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111' }),
    )

    expect(result).toEqual({ status: 'gate_refused', overallScore: 55, critique: null })
  })

  // Session 24-D (MINOR-4 correction) — critique was previously dropped on
  // the gate_refused path: approveBriefIfQualified returns it
  // (ApproveBriefResult, brief.ts), but the action discarded it before it
  // ever reached ApproveBriefState. Pinned with a NON-null critique so this
  // can't pass by accident on the always-null case above.
  it('threads critique through on gate_refused — survives the refusal, not dropped (MINOR-4)', async () => {
    const critique = { critique: ['Add a stronger opening line.'], overall: 55 }
    vi.mocked(approveBriefIfQualified).mockResolvedValue({ approved: false, overallScore: 55, critique })

    const result = await approveBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111' }),
    )

    expect(result).toEqual({ status: 'gate_refused', overallScore: 55, critique })
  })

  it('succeeds above threshold', async () => {
    vi.mocked(approveBriefIfQualified).mockResolvedValue({
      approved: true,
      brief: { id: 'brief-1', businessId: 'biz-1', campaignId: 'camp-1', content: MOCK_CONTENT, frozenAt: 'x' } as never,
    })

    const result = await approveBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111' }),
    )

    expect(result).toEqual({ status: 'approved' })
  })

  it('refuses when the brief is not in critiqued status', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ status: 'draft' }))
    const result = await approveBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111' }),
    )
    expect(result).toEqual({ status: 'error', error: 'invalid_brief_state' })
    expect(approveBriefIfQualified).not.toHaveBeenCalled()
  })
})

describe('rejectBriefAction — Zod validation', () => {
  it('rejects a malformed campaignId', async () => {
    const result = await rejectBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: 'nope', expectedVersion: '1' }),
    )
    expect(result).toEqual({ status: 'error', error: 'invalid_input' })
  })

  it('rejects a non-numeric expectedVersion', async () => {
    const result = await rejectBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111', expectedVersion: 'not-a-number' }),
    )
    expect(result).toEqual({ status: 'error', error: 'invalid_input' })
  })
})

describe('rejectBriefAction — revises with UNCHANGED content, bumps version', () => {
  it('calls reviseBrief with the brief\'s own content, not a modified one', async () => {
    vi.mocked(reviseBrief).mockResolvedValue(makeBrief({ status: 'draft', version: 2 }))

    const result = await rejectBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111', expectedVersion: '1' }),
    )

    expect(reviseBrief).toHaveBeenCalledWith(expect.anything(), 'brief-1', 1, MOCK_CONTENT)
    expect(result).toEqual({ status: 'rejected' })
  })

  it('surfaces a concurrent_edit error when reviseBrief\'s guard rejects (version mismatch)', async () => {
    vi.mocked(reviseBrief).mockResolvedValue(null)
    const result = await rejectBriefAction(
      { status: 'idle' },
      formDataOf({ campaignId: '11111111-1111-4111-8111-111111111111', expectedVersion: '1' }),
    )
    expect(result).toEqual({ status: 'error', error: 'concurrent_edit' })
  })
})

describe('editBriefAction — Zod validation', () => {
  it('rejects empty narrative', async () => {
    const result = await editBriefAction(
      { status: 'idle' },
      formDataOf({
        campaignId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: '1',
        narrative: '',
        proofPlan: 'valid',
      }),
    )
    expect(result).toEqual({ status: 'error', error: 'invalid_input' })
    expect(reviseBrief).not.toHaveBeenCalled()
  })

  it('rejects an oversized narrative (>2000 chars)', async () => {
    const result = await editBriefAction(
      { status: 'idle' },
      formDataOf({
        campaignId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: '1',
        narrative: 'x'.repeat(2001),
        proofPlan: 'valid',
      }),
    )
    expect(result).toEqual({ status: 'error', error: 'invalid_input' })
  })
})

describe('editBriefAction — revises with NEW narrative/proofPlan, preserves the rest of content', () => {
  it('calls reviseBrief with updated narrative/proofPlan and unchanged pinnedEvidence/roleSequence', async () => {
    vi.mocked(reviseBrief).mockResolvedValue(makeBrief({ status: 'draft', version: 2 }))

    const result = await editBriefAction(
      { status: 'idle' },
      formDataOf({
        campaignId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: '1',
        narrative: 'Updated narrative',
        proofPlan: 'Updated proof plan',
      }),
    )

    expect(reviseBrief).toHaveBeenCalledWith(expect.anything(), 'brief-1', 1, {
      ...MOCK_CONTENT,
      narrative: 'Updated narrative',
      proofPlan: 'Updated proof plan',
    })
    expect(result).toEqual({ status: 'saved' })
  })
})
