import { describe, it, expect } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'
import {
  getBriefByCampaign,
  createBrief,
  submitBriefForCritique,
  approveBrief,
  reviseBrief,
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
    const result = await submitBriefForCritique(client, 'brief-1')
    expect(result).toEqual(critiqued)
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('is a no-op (returns null) when the brief is not in draft', async () => {
    const { client } = createMockClient(null, null)
    const result = await submitBriefForCritique(client, 'brief-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(submitBriefForCritique(client, 'brief-1')).rejects.toThrow('Update error')
  })
})

describe('approveBrief (critiqued -> approved)', () => {
  it('succeeds when the brief is critiqued and sets frozen_at', async () => {
    const approved = { ...mockBrief, status: 'approved' as const, frozen_at: '2026-07-23T01:00:00Z' }
    const { client, builder } = createMockClient(approved)
    const result = await approveBrief(client, 'brief-1')
    expect(result).toEqual(approved)
    expect(builder.eq).toHaveBeenCalledWith('status', 'critiqued')
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', frozen_at: expect.any(String) }),
    )
  })

  it('is a no-op (returns null) when the brief is not critiqued', async () => {
    const { client } = createMockClient(null, null)
    const result = await approveBrief(client, 'brief-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(approveBrief(client, 'brief-1')).rejects.toThrow('Update error')
  })
})

describe('reviseBrief (critiqued -> draft, human revise)', () => {
  it('bumps version and guards on both status and the expected version', async () => {
    const revised = { ...mockBrief, status: 'draft' as const, version: 2, content: mockContent }
    const { client, builder } = createMockClient(revised)
    const result = await reviseBrief(client, 'brief-1', 1, mockContent)
    expect(result).toEqual(revised)
    expect(builder.eq).toHaveBeenCalledWith('status', 'critiqued')
    expect(builder.eq).toHaveBeenCalledWith('version', 1)
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', version: 2, content: mockContent }),
    )
  })

  it('leaves frozen_at untouched (stays NULL — revise only happens pre-freeze)', async () => {
    const revised = { ...mockBrief, status: 'draft' as const, version: 2 }
    const { client, builder } = createMockClient(revised)
    await reviseBrief(client, 'brief-1', 1, mockContent)
    const updateCall = (builder.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(updateCall).not.toHaveProperty('frozen_at')
  })

  it('is a no-op (returns null) when status or version does not match (concurrent edit)', async () => {
    const { client } = createMockClient(null, null)
    const result = await reviseBrief(client, 'brief-1', 1, mockContent)
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(reviseBrief(client, 'brief-1', 1, mockContent)).rejects.toThrow('Update error')
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
