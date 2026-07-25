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

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { BriefReviewForm } from './BriefReviewForm'
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
