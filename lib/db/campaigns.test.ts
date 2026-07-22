import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  softDeleteCampaignGuarded,
} from './campaigns'
import type { CampaignRow, CampaignInsert } from './types'

const mockCampaign: CampaignRow = {
  id: 'camp-1',
  business_id: 'biz-1',
  name: 'Q2 Launch',
  objective: 'Increase brand awareness',
  special_instructions: null,
  platforms: ['linkedin', 'twitter'],
  frequency: 'daily',
  posts_per_week: 5,
  start_date: '2026-05-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 20,
  total_posts_published: 0,
  voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('listCampaigns', () => {
  it('returns list of campaigns', async () => {
    const { client } = createMockClient([mockCampaign])
    const result = await listCampaigns(client, 'biz-1')
    expect(result).toEqual([mockCampaign])
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listCampaigns(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listCampaigns(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('getCampaignById', () => {
  it('returns a campaign when found', async () => {
    const { client } = createMockClient(mockCampaign)
    const result = await getCampaignById(client, 'camp-1')
    expect(result).toEqual(mockCampaign)
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getCampaignById(client, 'camp-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getCampaignById(client, 'missing')).rejects.toThrow()
  })
})

describe('createCampaign', () => {
  const insertData: CampaignInsert = {
    business_id: 'biz-1',
    name: 'Q2 Launch',
    objective: 'Increase brand awareness',
    platforms: ['linkedin'],
    frequency: 'daily',
    posts_per_week: 5,
    start_date: '2026-05-01',
    origin: 'objective_generated',
  }

  it('returns the created campaign', async () => {
    const { client } = createMockClient(mockCampaign)
    const result = await createCampaign(client, insertData)
    expect(result).toEqual(mockCampaign)
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    await expect(createCampaign(client, insertData)).rejects.toThrow('Insert error')
  })
})

describe('updateCampaign', () => {
  it('returns the updated campaign', async () => {
    const { client } = createMockClient(mockCampaign)
    const result = await updateCampaign(client, 'camp-1', { status: 'paused' })
    expect(result).toEqual(mockCampaign)
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(updateCampaign(client, 'camp-1', { status: 'paused' })).rejects.toThrow('Update error')
  })
})

describe('pauseCampaign', () => {
  it('returns updated row when campaign is active', async () => {
    const { client } = createMockClient({ ...mockCampaign, status: 'paused' })
    const result = await pauseCampaign(client, 'camp-1')
    expect(result).toMatchObject({ id: 'camp-1', status: 'paused' })
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('returns null when guard fails (non-active status)', async () => {
    const { client } = createMockClient(null, null)
    const result = await pauseCampaign(client, 'camp-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(pauseCampaign(client, 'camp-1')).rejects.toThrow('Update error')
  })
})

describe('resumeCampaign', () => {
  it('returns updated row when campaign is paused', async () => {
    const { client } = createMockClient({ ...mockCampaign, status: 'active' })
    const result = await resumeCampaign(client, 'camp-1')
    expect(result).toMatchObject({ id: 'camp-1', status: 'active' })
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('returns null when guard fails (non-paused status)', async () => {
    const { client } = createMockClient(null, null)
    const result = await resumeCampaign(client, 'camp-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(resumeCampaign(client, 'camp-1')).rejects.toThrow('Update error')
  })
})

describe('softDeleteCampaignGuarded', () => {
  it('returns true when campaign is in draft status', async () => {
    const { client } = createMockClient({ id: 'camp-1' })
    const result = await softDeleteCampaignGuarded(client, 'camp-1')
    expect(result).toBe(true)
    expect(client.from).toHaveBeenCalledWith('campaigns')
  })

  it('returns false when guard fails (active/paused status — no row updated)', async () => {
    const { client } = createMockClient(null, null)
    const result = await softDeleteCampaignGuarded(client, 'camp-1')
    expect(result).toBe(false)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Delete error' })
    await expect(softDeleteCampaignGuarded(client, 'camp-1')).rejects.toThrow('Delete error')
  })
})
