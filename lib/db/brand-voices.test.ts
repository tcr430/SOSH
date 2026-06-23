import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { getBrandVoice, upsertBrandVoice } from './brand-voices'
import type { BrandVoiceRow, BrandVoiceInsert } from './types'

const mockBrandVoice: BrandVoiceRow = {
  id: 'bv-1',
  business_id: 'biz-1',
  voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
  tone: ['professional', 'friendly'],
  target_audience: 'B2B SaaS founders',
  keywords: ['AI', 'automation'],
  avoid_words: ['cheap'],
  writing_examples: [],
  competitors: [],
  unique_value_prop: 'AI-powered social media',
  inferred_from_url: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('getBrandVoice', () => {
  it('returns a brand voice when found', async () => {
    const { client } = createMockClient(mockBrandVoice)
    const result = await getBrandVoice(client, 'biz-1')
    expect(result).toEqual(mockBrandVoice)
    expect(client.from).toHaveBeenCalledWith('brand_voices')
  })

  it('returns null when not found', async () => {
    const { client } = createMockClient(null, null)
    const result = await getBrandVoice(client, 'biz-missing')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getBrandVoice(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('upsertBrandVoice', () => {
  const insertData: BrandVoiceInsert = {
    business_id: 'biz-1',
    tone: ['professional'],
  }

  it('returns the upserted brand voice', async () => {
    const { client } = createMockClient(mockBrandVoice)
    const result = await upsertBrandVoice(client, insertData)
    expect(result).toEqual(mockBrandVoice)
    expect(client.from).toHaveBeenCalledWith('brand_voices')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Upsert error' })
    await expect(upsertBrandVoice(client, insertData)).rejects.toThrow('Upsert error')
  })
})
