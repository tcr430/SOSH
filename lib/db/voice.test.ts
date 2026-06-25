import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  createVoiceVariation,
  VoiceVariationCapError,
  addVariation,
  renameVariation,
  listVariations,
  updateVariationAxes,
} from './voice'
import type { VoiceAxes } from '@/lib/validation/voice'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const neutralAxes: VoiceAxes = {
  formal_casual: 50,
  expert_peer: 50,
  serious_playful: 50,
  reserved_warm: 50,
  calm_energetic: 50,
  rational_emotional: 50,
  exclusive_inclusive: 50,
}

const baseParams = {
  businessId: 'biz-uuid-001',
  name: 'Bolder',
  voiceAxes: neutralAxes,
}

const mockVariationRow = {
  id: 'var-uuid-001',
  business_id: 'biz-uuid-001',
  name: 'Bolder',
  voice_axes: neutralAxes,
  created_at: '2026-06-23T21:00:00.000Z',
  updated_at: '2026-06-23T21:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createVoiceVariation', () => {
  it('returns the inserted variation row on success', async () => {
    const { client } = createMockClient(mockVariationRow, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const result = await createVoiceVariation(baseParams)

    expect(result).toEqual(mockVariationRow)
    expect(client.rpc).toHaveBeenCalledWith('create_voice_variation', {
      p_business_id: 'biz-uuid-001',
      p_name: 'Bolder',
      p_voice_axes: neutralAxes,
    })
  })

  it('throws VoiceVariationCapError when RPC message is voice_variation_cap_reached', async () => {
    const { client } = createMockClient(null, {
      code: 'P0001',
      message: 'voice_variation_cap_reached',
    })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(createVoiceVariation(baseParams)).rejects.toBeInstanceOf(VoiceVariationCapError)
  })

  it('VoiceVariationCapError has the expected name', async () => {
    const { client } = createMockClient(null, {
      code: 'P0001',
      message: 'voice_variation_cap_reached',
    })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const err = await createVoiceVariation(baseParams).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VoiceVariationCapError)
    expect((err as VoiceVariationCapError).name).toBe('VoiceVariationCapError')
  })

  it('throws a plain Error with the DB message on other RPC errors', async () => {
    const { client } = createMockClient(null, {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(createVoiceVariation(baseParams)).rejects.toThrow(
      'duplicate key value violates unique constraint',
    )
    await expect(createVoiceVariation(baseParams)).rejects.not.toBeInstanceOf(VoiceVariationCapError)
  })

  it('throws a generic error when the error has no message', async () => {
    const { client } = createMockClient(null, { code: 'PGRST301' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(createVoiceVariation(baseParams)).rejects.toThrow('Database error')
  })

  it('uses the service-role client (not the anon client)', async () => {
    const { client } = createMockClient(mockVariationRow, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await createVoiceVariation(baseParams)

    expect(serviceModule.createServiceRoleClient).toHaveBeenCalledTimes(1)
  })
})

// ── addVariation ──────────────────────────────────────────────────────────

describe('addVariation', () => {
  it('delegates to createVoiceVariation and returns the row', async () => {
    const { client } = createMockClient(mockVariationRow, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const result = await addVariation(baseParams)

    expect(result).toEqual(mockVariationRow)
    expect(client.rpc).toHaveBeenCalledWith('create_voice_variation', {
      p_business_id: baseParams.businessId,
      p_name: baseParams.name,
      p_voice_axes: baseParams.voiceAxes,
    })
  })

  it('surfaces VoiceVariationCapError on cap hit (no app-layer count)', async () => {
    const { client } = createMockClient(null, {
      code: 'P0001',
      message: 'voice_variation_cap_reached',
    })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(addVariation(baseParams)).rejects.toBeInstanceOf(VoiceVariationCapError)
  })
})

// ── renameVariation ───────────────────────────────────────────────────────

describe('renameVariation', () => {
  it('issues UPDATE on brand_voice_variations with the new name', async () => {
    const { client, builder } = createMockClient({ id: 'var-uuid-001', name: 'Renamed' }, null)

    await renameVariation(client, 'var-uuid-001', 'Renamed')

    expect(client.from).toHaveBeenCalledWith('brand_voice_variations')
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }))
    expect(builder.eq).toHaveBeenCalledWith('id', 'var-uuid-001')
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'unique constraint' })

    await expect(renameVariation(client, 'var-uuid-001', 'Duplicate')).rejects.toThrow()
  })
})

// ── listVariations ────────────────────────────────────────────────────────

describe('listVariations', () => {
  it('queries brand_voice_variations filtered by business_id', async () => {
    const { client, builder } = createMockClient([mockVariationRow], null)

    const result = await listVariations(client, 'biz-uuid-001')

    expect(client.from).toHaveBeenCalledWith('brand_voice_variations')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-uuid-001')
    expect(result).toEqual([mockVariationRow])
  })

  it('returns empty array when no variations exist', async () => {
    const { client } = createMockClient([], null)

    const result = await listVariations(client, 'biz-uuid-001')

    expect(result).toEqual([])
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })

    await expect(listVariations(client, 'biz-uuid-001')).rejects.toThrow()
  })
})

// ── updateVariationAxes ───────────────────────────────────────────────────

describe('updateVariationAxes', () => {
  const newAxes: VoiceAxes = { ...neutralAxes, formal_casual: 80 }

  it('issues UPDATE on brand_voice_variations with the new axes', async () => {
    const { client, builder } = createMockClient({ id: 'var-uuid-001' }, null)

    await updateVariationAxes(client, 'var-uuid-001', newAxes)

    expect(client.from).toHaveBeenCalledWith('brand_voice_variations')
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ voice_axes: newAxes }))
    expect(builder.eq).toHaveBeenCalledWith('id', 'var-uuid-001')
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })

    await expect(updateVariationAxes(client, 'var-uuid-001', newAxes)).rejects.toThrow()
  })
})
