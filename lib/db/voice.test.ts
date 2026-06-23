import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { createVoiceVariation, VoiceVariationCapError } from './voice'
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
