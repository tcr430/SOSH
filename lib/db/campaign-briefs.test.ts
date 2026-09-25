import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'
import {
  getBriefByCampaign,
  createBrief,
  submitBriefForCritique,
  approveBriefAndSupersedeProposals,
  reviseBriefAndSupersedeProposals,
  markBriefGenerated,
} from './campaign-briefs'
import type { CampaignBriefRow, CampaignBriefContent, CampaignRow } from './types'

const mockContent: CampaignBriefContent = {
  narrative: 'We help B2B SaaS teams post consistently.',
  proofPlan: 'Cite three customer quotes and a usage-data stat.',
  pinnedEvidence: [{ evidenceMemoryId: 'ev-1', note: 'strong quote' }],
  roleSequence: [
    { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
    { order: 1, role: 'customer_proof', platform: 'twitter', angle: 'social proof thread' },
  ],
}

const mockBrief: CampaignBriefRow = {
  id: 'brief-1',
  business_id: 'biz-1',
  campaign_id: 'camp-1',
  content: mockContent,
  status: 'draft',
  version: 1,
  overall_score: null,
  critique: null,
  frozen_at: null,
  deleted_at: null,
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  plan_analysis_status: 'not_run',
  plan_analysis_reason: null,
}

const mockCampaign: CampaignRow = {
  id: 'camp-1',
  business_id: 'biz-1',
  name: 'Q3 Launch',
  objective: 'Drive signups',
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'weekly',
  posts_per_week: 3,
  start_date: '2026-07-01',
  end_date: null,
  status: 'awaiting_brief',
  total_posts_planned: 0,
  total_posts_published: 0,
  voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

describe('getBriefByCampaign', () => {
  it('returns the brief for a campaign', async () => {
    const { client, builder } = createMockClient(mockBrief)
    const result = await getBriefByCampaign(client, 'camp-1')
    expect(result).toEqual(mockBrief)
    expect(client.from).toHaveBeenCalledWith('campaign_briefs')
    expect(builder.eq).toHaveBeenCalledWith('campaign_id', 'camp-1')
  })

  it('returns null when no brief exists for the campaign', async () => {
    const { client } = createMockClient(null, null)
    const result = await getBriefByCampaign(client, 'camp-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Query error' })
    await expect(getBriefByCampaign(client, 'camp-1')).rejects.toThrow('Query error')
  })
})

describe('createBrief', () => {
  it('sources business_id from the campaign row, not a caller-supplied value', async () => {
    // A campaign whose business_id differs from anything a careless caller
    // might otherwise pass — proves the insert uses THIS value.
    const campaignWithDistinctBusiness: CampaignRow = { ...mockCampaign, business_id: 'biz-from-campaign' }
    const insertedBrief: CampaignBriefRow = { ...mockBrief, business_id: 'biz-from-campaign' }

    const { client, builders } = createSequentialMockClient([
      { data: campaignWithDistinctBusiness, error: null },
      { data: insertedBrief, error: null },
    ])

    const result = await createBrief(client, 'camp-1', mockContent)

    expect(result).toEqual(insertedBrief)
    expect(client.from).toHaveBeenNthCalledWith(1, 'campaigns')
    expect(client.from).toHaveBeenNthCalledWith(2, 'campaign_briefs')
    expect(builders[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-from-campaign',
        campaign_id: 'camp-1',
        content: mockContent,
        status: 'draft',
      }),
    )
  })

  it('throws when the campaign does not exist', async () => {
    const { client } = createSequentialMockClient([{ data: null, error: null }])
    await expect(createBrief(client, 'missing-campaign', mockContent)).rejects.toThrow()
  })
})

describe('submitBriefForCritique (draft -> critiqued)', () => {
  it('succeeds when the brief is in draft', async () => {
    const critiqued = { ...mockBrief, status: 'critiqued' as const }
    const { client, builder } = createMockClient(critiqued)
    const result = await submitBriefForCritique(client, 'brief-1', { overallScore: 82, critique: { note: 'ok' } })
    expect(result).toEqual(critiqued)
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'critiqued', overall_score: 82, critique: { note: 'ok' } }),
    )
  })

  it('is a no-op (returns null) when the brief is not in draft', async () => {
    const { client } = createMockClient(null, null)
    const result = await submitBriefForCritique(client, 'brief-1', { overallScore: 82, critique: {} })
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(
      submitBriefForCritique(client, 'brief-1', { overallScore: 82, critique: {} }),
    ).rejects.toThrow('Update error')
  })
})

// ADR 0027 §5.7 (Session 34-D D4, BLOCKER-1) — the approve and revise writers are RPC wrappers (service-role,
// no client parameter). The RPC itself is exercised against live Postgres by
// supabase/__tests__/plan-proposals-approve-revise-path.test.ts; here the mapping of its typed outcome onto the
// predecessors' row | null contract is pinned.
const rpcMock = vi.fn()
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ rpc: rpcMock }) }))

describe('approveBriefAndSupersedeProposals (critiqued -> approved + supersede, ONE RPC)', () => {
  beforeEach(() => rpcMock.mockReset())

  it('calls approve_brief_and_supersede_proposals with the business and brief ids and returns the frozen row', async () => {
    const approved = { ...mockBrief, status: 'approved' as const, frozen_at: '2026-07-23T01:00:00Z' }
    rpcMock.mockResolvedValue({ data: { outcome: 'ok', brief: approved }, error: null })
    const result = await approveBriefAndSupersedeProposals('biz-1', 'brief-1')
    expect(result).toEqual(approved)
    expect(rpcMock).toHaveBeenCalledWith('approve_brief_and_supersede_proposals', {
      p_business_id: 'biz-1',
      p_brief_id: 'brief-1',
    })
  })

  it("returns null on 'invalid_state' (the brief is not critiqued) — the predecessor's no-op contract", async () => {
    rpcMock.mockResolvedValue({ data: { outcome: 'invalid_state' }, error: null })
    expect(await approveBriefAndSupersedeProposals('biz-1', 'brief-1')).toBeNull()
  })

  it('throws on an outcome it does not know, rather than treating it as a refusal', async () => {
    rpcMock.mockResolvedValue({ data: { outcome: 'surprise' }, error: null })
    await expect(approveBriefAndSupersedeProposals('biz-1', 'brief-1')).rejects.toThrow('unexpected outcome')
    rpcMock.mockResolvedValue({ data: null, error: null })
    await expect(approveBriefAndSupersedeProposals('biz-1', 'brief-1')).rejects.toThrow('unexpected outcome')
  })

  it('throws when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Update error' } })
    await expect(approveBriefAndSupersedeProposals('biz-1', 'brief-1')).rejects.toThrow('Update error')
  })
})

describe('reviseBriefAndSupersedeProposals (critiqued -> draft, version + 1, ONE RPC)', () => {
  beforeEach(() => rpcMock.mockReset())

  it('calls revise_brief_and_supersede_proposals with the expected version and content and returns the new row', async () => {
    const revised = { ...mockBrief, status: 'draft' as const, version: 2, content: mockContent }
    rpcMock.mockResolvedValue({ data: { outcome: 'ok', brief: revised }, error: null })
    const result = await reviseBriefAndSupersedeProposals('biz-1', 'brief-1', 1, mockContent)
    expect(result).toEqual(revised)
    expect(rpcMock).toHaveBeenCalledWith('revise_brief_and_supersede_proposals', {
      p_business_id: 'biz-1',
      p_brief_id: 'brief-1',
      p_expected_version: 1,
      p_content: mockContent,
    })
  })

  it("returns null on 'concurrent_edit' (status or version did not match)", async () => {
    rpcMock.mockResolvedValue({ data: { outcome: 'concurrent_edit' }, error: null })
    expect(await reviseBriefAndSupersedeProposals('biz-1', 'brief-1', 1, mockContent)).toBeNull()
  })

  it('throws on an outcome it does not know, and when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: { outcome: 'invalid_state' }, error: null })
    await expect(reviseBriefAndSupersedeProposals('biz-1', 'brief-1', 1, mockContent)).rejects.toThrow('unexpected outcome')
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Update error' } })
    await expect(reviseBriefAndSupersedeProposals('biz-1', 'brief-1', 1, mockContent)).rejects.toThrow('Update error')
  })
})

describe('markBriefGenerated (approved -> generated)', () => {
  it('succeeds when the brief is approved', async () => {
    const generated = { ...mockBrief, status: 'generated' as const }
    const { client, builder } = createMockClient(generated)
    const result = await markBriefGenerated(client, 'brief-1')
    expect(result).toEqual(generated)
    expect(builder.eq).toHaveBeenCalledWith('status', 'approved')
  })

  it('is a no-op (returns null) when the brief is not approved', async () => {
    const { client } = createMockClient(null, null)
    const result = await markBriefGenerated(client, 'brief-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(markBriefGenerated(client, 'brief-1')).rejects.toThrow('Update error')
  })
})
