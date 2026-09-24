import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ getBriefByCampaign: vi.fn() }))
vi.mock('./BriefReviewForm', () => ({ BriefReviewForm: vi.fn(() => null) }))
// ADR 0027 K2.10 — the page now reads the caller's member row and the brief's proposals, and renders the panel.
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db/campaign-plan-proposals', () => ({ listPlanProposalsForBrief: vi.fn().mockResolvedValue([]) }))
vi.mock('./PlanReviewPanel', () => ({ PlanReviewPanel: vi.fn(() => null) }))

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { BriefReviewForm } from './BriefReviewForm'
import { PlanReviewPanel } from './PlanReviewPanel'
import { getMemberForUser } from '@/lib/db/business-members'
import { listPlanProposalsForBrief } from '@/lib/db/campaign-plan-proposals'
import CampaignBriefPage from './page'
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
    plan_analysis_status: 'not_run', plan_analysis_reason: null,
    ...overrides,
  }
}

function mockAuthedClient() {
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) } }
  vi.mocked(createClient).mockResolvedValue(client as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS)
  vi.mocked(getCampaignById).mockResolvedValue(MOCK_CAMPAIGN)
}

describe('CampaignBriefPage — MAJOR-2 (Session 24-D D0): remount key on BriefReviewForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keys BriefReviewForm on brief.id so a different brief forces a remount (re-seeded edit state)', async () => {
    mockAuthedClient()
    const brief = makeBrief({ id: 'brief-42' })
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief)

    const result = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })

    // Server Component returns an un-rendered React element tree — read the
    // key/props off the <BriefReviewForm> element directly rather than
    // rendering (approvals/page.test.tsx precedent; no RTL/jsdom in this repo).
    type ReactElementLike = { type: unknown; key: string | null; props: { campaignId: string; brief: CampaignBriefRow } }
    const outer = result as unknown as { props: { children: ReactElementLike[] } }
    const formElement = outer.props.children.find((child) => child.type === BriefReviewForm)

    expect(formElement).toBeTruthy()
    expect(formElement?.key).toBe('brief-42')
    expect(formElement?.props.campaignId).toBe('camp-1')
    expect(formElement?.props.brief).toBe(brief)
  })

  it('changes key when the brief row changes (e.g. a revise producing a new brief id)', async () => {
    mockAuthedClient()

    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ id: 'brief-1' }))
    const first = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })

    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ id: 'brief-2' }))
    const second = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })

    type ReactElementLike = { type: unknown; key: string | null }
    const keyOf = (r: unknown) =>
      (r as { props: { children: ReactElementLike[] } }).props.children.find((c) => c.type === BriefReviewForm)?.key

    expect(keyOf(first)).toBe('brief-1')
    expect(keyOf(second)).toBe('brief-2')
    expect(keyOf(first)).not.toBe(keyOf(second))
  })
})

// ── ADR 0027 §8 (Session 34 K2.10) — the planner panel on the EXISTING brief-review page ──────────────────────────
//
// SHARED-FUNCTION CALLERS: CampaignBriefPage is a route module (one caller: Next). BriefReviewForm's props and key
// are UNCHANGED (asserted by the two tests above, which still pass). The panel is a new sibling, not a new route.
describe('CampaignBriefPage — planner panel (ADR 0027 K2.10)', () => {
  beforeEach(() => vi.clearAllMocks())

  type PanelProps = {
    campaignId: string
    briefVersion: number
    briefStatus: string
    planStatus: string
    planReason: string | null
    proposals: Array<Record<string, unknown>>
    roleSequence: unknown[]
    canAuthor: boolean
  }
  type El = { type: unknown; key: string | null; props: PanelProps }
  const childrenOf = (r: unknown) => (r as { props: { children: El[] } }).props.children
  const panelOf = (r: unknown) => childrenOf(r).find((c) => c.type === PlanReviewPanel)

  it('hands the panel the PERSISTED plan_analysis_status and _reason, never a derived value', async () => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ plan_analysis_status: 'unavailable', plan_analysis_reason: 'wall_clock_exceeded' }))
    const result = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    const panel = panelOf(result)
    expect(panel?.props.planStatus).toBe('unavailable')
    expect(panel?.props.planReason).toBe('wall_clock_exceeded')
  })

  it.each(['not_run', 'ok', 'unavailable', 'capped'] as const)('passes plan_analysis_status=%s through untouched', async (status) => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ plan_analysis_status: status }))
    const result = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    expect(panelOf(result)?.props.planStatus).toBe(status)
  })

  it('reads proposals through the BOUNDED list function with the CALLER client (RLS applies), not the service client', async () => {
    mockAuthedClient()
    const brief = makeBrief({ id: 'brief-9' })
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief)
    await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    const callerClient = await vi.mocked(createClient).mock.results[0].value
    expect(listPlanProposalsForBrief).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listPlanProposalsForBrief).mock.calls[0][0]).toBe(callerClient)
    expect(vi.mocked(listPlanProposalsForBrief).mock.calls[0][1]).toBe('brief-9')
  })

  it('maps proposal rows to the serialisable view (snake_case -> camelCase), including the superseded reason', async () => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    vi.mocked(listPlanProposalsForBrief).mockResolvedValue([
      {
        id: 'p-1', kind: 'substitute', target_order: 0, proposed_role: 'objection_response', proposed_order: null,
        reason: 'No customer evidence exists.', status: 'superseded', superseded_reason: 'brief_frozen', brief_version: 1,
      },
    ] as never)
    const result = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    expect(panelOf(result)?.props.proposals).toEqual([
      {
        id: 'p-1', kind: 'substitute', targetOrder: 0, proposedRole: 'objection_response', proposedOrder: null,
        reason: 'No customer evidence exists.', status: 'superseded', supersededReason: 'brief_frozen', briefVersion: 1,
      },
    ])
  })

  it('keys the panel on brief id AND version, so a ratified round (which advances the version) clears the selection', async () => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ id: 'brief-1', version: 1 }))
    const v1 = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ id: 'brief-1', version: 2 }))
    const v2 = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    expect(panelOf(v1)?.key).toBe('brief-1-1')
    expect(panelOf(v2)?.key).toBe('brief-1-2')
  })

  it('renders the panel BEFORE the review form, so the proposals are read before the human can approve', async () => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    const result = await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) })
    const types = childrenOf(result).map((c) => c.type)
    expect(types.indexOf(PlanReviewPanel)).toBeGreaterThan(-1)
    expect(types.indexOf(PlanReviewPanel)).toBeLessThan(types.indexOf(BriefReviewForm))
  })

  it("canAuthor is true for the business owner and false for a viewer member (UX echo of user_can 'author')", async () => {
    mockAuthedClient()
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    expect(panelOf(await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) }))?.props.canAuthor).toBe(true)

    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', status: 'active', user_id: 'user-1' } as never)
    expect(panelOf(await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) }))?.props.canAuthor).toBe(false)

    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', status: 'active', user_id: 'user-1' } as never)
    expect(panelOf(await CampaignBriefPage({ params: Promise.resolve({ locale: 'en', id: 'camp-1' }) }))?.props.canAuthor).toBe(true)
  })
})
