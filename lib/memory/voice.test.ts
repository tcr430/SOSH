import { vi, describe, it, expect, beforeEach } from 'vitest'
import { retrieveVoice } from './voice'
import * as brandVoicesDb from '@/lib/db/brand-voices'
import * as voiceDb from '@/lib/db/voice'
import type { BrandVoiceRow, BrandVoiceVariationRow, VoiceAxes } from '@/lib/db/types'

vi.mock('@/lib/db/brand-voices', () => ({
  getBrandVoice: vi.fn(),
}))
vi.mock('@/lib/db/voice', () => ({
  getVariationForBusiness: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const BASE_AXES: VoiceAxes = {
  formal_casual: 50,
  expert_peer: 50,
  serious_playful: 50,
  reserved_warm: 50,
  calm_energetic: 50,
  rational_emotional: 50,
  exclusive_inclusive: 50,
}

const VARIATION_AXES: VoiceAxes = {
  formal_casual: 85,
  expert_peer: 85,
  serious_playful: 85,
  reserved_warm: 85,
  calm_energetic: 85,
  rational_emotional: 85,
  exclusive_inclusive: 85,
}

function makeBrandVoice(overrides: Partial<BrandVoiceRow> = {}): BrandVoiceRow {
  return {
    id: 'bv-1',
    business_id: 'biz-1',
    voice_axes: BASE_AXES,
    tone: [],
    target_audience: null,
    keywords: [],
    avoid_words: [],
    writing_examples: [],
    competitors: [],
    unique_value_prop: null,
    inferred_from_url: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function makeVariation(overrides: Partial<BrandVoiceVariationRow> = {}): BrandVoiceVariationRow {
  return {
    id: 'var-1',
    business_id: 'biz-1',
    name: 'Playful',
    voice_axes: VARIATION_AXES,
    created_at: '2026-06-15T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    ...overrides,
  }
}

describe('retrieveVoice', () => {
  it('returns null when the business has no brand voice — core rules are simply absent, not a thrown error', async () => {
    vi.mocked(brandVoicesDb.getBrandVoice).mockResolvedValue(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveVoice(client, 'biz-1')

    expect(result).toBeNull()
  })

  it('returns the base voice axes + a descriptor when no variation is requested', async () => {
    vi.mocked(brandVoicesDb.getBrandVoice).mockResolvedValue(makeBrandVoice())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveVoice(client, 'biz-1')

    expect(result).not.toBeNull()
    expect(result?.voice_axes).toEqual(BASE_AXES)
    expect(typeof result?.descriptor).toBe('string')
    expect(result?.descriptor.length).toBeGreaterThan(0)
    expect(voiceDb.getVariationForBusiness).not.toHaveBeenCalled()
  })

  it('applies the variation axes when voiceVariationId resolves to a variation owned by the business', async () => {
    vi.mocked(brandVoicesDb.getBrandVoice).mockResolvedValue(makeBrandVoice())
    vi.mocked(voiceDb.getVariationForBusiness).mockResolvedValue(makeVariation())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveVoice(client, 'biz-1', 'var-1')

    expect(voiceDb.getVariationForBusiness).toHaveBeenCalledWith(client, 'var-1', 'biz-1')
    expect(result?.voice_axes).toEqual(VARIATION_AXES)
  })

  it('falls back to the base axes when the variation is not found (deleted, wrong business, or bad id) — never silently returns null instead', async () => {
    vi.mocked(brandVoicesDb.getBrandVoice).mockResolvedValue(makeBrandVoice())
    vi.mocked(voiceDb.getVariationForBusiness).mockResolvedValue(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveVoice(client, 'biz-1', 'missing-variation')

    expect(result).not.toBeNull()
    expect(result?.voice_axes).toEqual(BASE_AXES)
  })

  it('does not look up a variation at all when voiceVariationId is null or undefined', async () => {
    vi.mocked(brandVoicesDb.getBrandVoice).mockResolvedValue(makeBrandVoice())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any
    await retrieveVoice(client, 'biz-1', null)
    await retrieveVoice(client, 'biz-1', undefined)

    expect(voiceDb.getVariationForBusiness).not.toHaveBeenCalled()
  })
})
