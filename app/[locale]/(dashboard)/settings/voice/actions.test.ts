import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))

vi.mock('@/lib/db/brand-voices', () => ({
  upsertBrandVoice: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/db/voice', () => ({
  addVariation: vi.fn(),
  renameVariation: vi.fn(),
  updateVariationAxes: vi.fn(),
  deleteVariation: vi.fn(),
  listVariations: vi.fn(),
  VoiceVariationCapError: class VoiceVariationCapError extends Error {
    override name = 'VoiceVariationCapError'
    constructor() { super('Voice variation cap reached (max 5 per business)') }
  },
}))

import {
  addVariationAction,
  renameVariationAction,
  deleteVariationAction,
  saveBaseVoiceAction,
  type VoiceVariationActionState,
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { addVariation, renameVariation, deleteVariation, VoiceVariationCapError } from '@/lib/db/voice'
import { revalidatePath } from 'next/cache'
import type { BusinessRow } from '@/lib/db/types'
import type { VoiceEditorSavePayload } from '@/lib/voice/editor-state'

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme Corp',
  website: null,
  industry: null,
  description: null,
  logo_url: null,
  owner_id: 'user-1',
  plan: 'plus',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockVariationRow = {
  id: 'var-1',
  business_id: 'biz-1',
  name: 'Bolder',
  voice_axes: {
    formal_casual: 50, expert_peer: 38, serious_playful: 56,
    reserved_warm: 50, calm_energetic: 68, rational_emotional: 58,
    exclusive_inclusive: 50,
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockClient = { auth: { getUser: vi.fn() } }

function makeVoiceAxesFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('formal_casual', '50')
  fd.set('expert_peer', '38')
  fd.set('serious_playful', '56')
  fd.set('reserved_warm', '50')
  fd.set('calm_energetic', '68')
  fd.set('rational_emotional', '58')
  fd.set('exclusive_inclusive', '50')
  fd.set('name', 'Bolder')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue(mockClient as never)
  vi.mocked(mockClient.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.mocked(getBusinessForUser).mockResolvedValue(mockBusiness)
  vi.mocked(addVariation).mockResolvedValue(mockVariationRow)
  vi.mocked(renameVariation).mockResolvedValue(undefined)
  vi.mocked(deleteVariation).mockResolvedValue(undefined)
})

describe('addVariationAction', () => {
  it('returns success with the new variation row', async () => {
    const result = await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())
    expect(result.success).toBe(true)
    expect(result.variation).toEqual(mockVariationRow)
  })

  it('calls addVariation with businessId, name, and voiceAxes', async () => {
    await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())
    expect(addVariation).toHaveBeenCalledWith({
      businessId: 'biz-1',
      name: 'Bolder',
      voiceAxes: {
        formal_casual: 50, expert_peer: 38, serious_playful: 56,
        reserved_warm: 50, calm_energetic: 68, rational_emotional: 58,
        exclusive_inclusive: 50,
      },
    })
  })

  it('calls revalidatePath for the voice settings route on success', async () => {
    await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/settings/voice', 'page')
  })

  it('does not call revalidatePath on cap error', async () => {
    vi.mocked(addVariation).mockRejectedValue(new VoiceVariationCapError())
    await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns variation_cap_reached error when VoiceVariationCapError is thrown (cap-hit surfaces to UI)', async () => {
    vi.mocked(addVariation).mockRejectedValue(new VoiceVariationCapError())

    const result = await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())

    expect(result.success).toBeUndefined()
    expect(result.error).toBe('variation_cap_reached')
  })

  it('returns generic error on unknown failure', async () => {
    vi.mocked(addVariation).mockRejectedValue(new Error('DB down'))

    const result = await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())

    expect(result.error).toBe('generic')
  })

  it('returns auth error when user is not authenticated', async () => {
    vi.mocked(mockClient.auth.getUser).mockResolvedValue({ data: { user: null } } as never)

    const result = await addVariationAction({} as VoiceVariationActionState, makeVoiceAxesFormData())

    expect(result.error).toBe('generic')
  })
})

describe('renameVariationAction', () => {
  it('calls renameVariation with the correct id and name', async () => {
    const fd = new FormData()
    fd.set('id', 'var-1')
    fd.set('name', 'Renamed Bolder')

    const result = await renameVariationAction({} as VoiceVariationActionState, fd)

    expect(result.success).toBe(true)
    expect(renameVariation).toHaveBeenCalledWith(expect.anything(), 'var-1', 'Renamed Bolder')
  })

  it('calls revalidatePath for the voice settings route on success', async () => {
    const fd = new FormData()
    fd.set('id', 'var-1')
    fd.set('name', 'Renamed')
    await renameVariationAction({} as VoiceVariationActionState, fd)
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/settings/voice', 'page')
  })

  it('returns error on DB failure', async () => {
    vi.mocked(renameVariation).mockRejectedValue(new Error('unique constraint'))
    const fd = new FormData()
    fd.set('id', 'var-1')
    fd.set('name', 'Duplicate')

    const result = await renameVariationAction({} as VoiceVariationActionState, fd)

    expect(result.error).toBe('generic')
  })
})

describe('deleteVariationAction', () => {
  it('calls deleteVariation with the correct id', async () => {
    const fd = new FormData()
    fd.set('id', 'var-1')

    const result = await deleteVariationAction({} as VoiceVariationActionState, fd)

    expect(result.success).toBe(true)
    expect(deleteVariation).toHaveBeenCalledWith(expect.anything(), 'var-1')
  })

  it('calls revalidatePath for the voice settings route on success', async () => {
    const fd = new FormData()
    fd.set('id', 'var-1')
    await deleteVariationAction({} as VoiceVariationActionState, fd)
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/settings/voice', 'page')
  })

  it('returns error on DB failure', async () => {
    vi.mocked(deleteVariation).mockRejectedValue(new Error('FK constraint'))
    const fd = new FormData()
    fd.set('id', 'var-1')

    const result = await deleteVariationAction({} as VoiceVariationActionState, fd)

    expect(result.error).toBe('generic')
  })
})

const validPayload: VoiceEditorSavePayload = {
  voiceAxes: {
    formal_casual: 50, expert_peer: 38, serious_playful: 56,
    reserved_warm: 50, calm_energetic: 68, rational_emotional: 58,
    exclusive_inclusive: 50,
  },
  tone: ['professional', 'warm'],
  keywords: ['SaaS', 'growth'],
  avoidWords: ['cheap'],
}

describe('saveBaseVoiceAction (§3.1 base-voice guard)', () => {
  beforeEach(() => {
    vi.mocked(upsertBrandVoice).mockResolvedValue(undefined as never)
  })

  it('returns validation error for out-of-range voiceAxes (not a silent no-op)', async () => {
    const badPayload: VoiceEditorSavePayload = {
      ...validPayload,
      voiceAxes: { ...validPayload.voiceAxes, formal_casual: 200 },
    }
    const result = await saveBaseVoiceAction(badPayload)
    expect(result?.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  it('returns validation error for negative axis value (not a silent no-op)', async () => {
    const badPayload: VoiceEditorSavePayload = {
      ...validPayload,
      voiceAxes: { ...validPayload.voiceAxes, calm_energetic: -1 },
    }
    const result = await saveBaseVoiceAction(badPayload)
    expect(result?.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  it('calls upsertBrandVoice and returns success on valid payload', async () => {
    const result = await saveBaseVoiceAction(validPayload)
    expect(result?.error).toBeUndefined()
    expect(upsertBrandVoice).toHaveBeenCalledOnce()
  })

  it('returns generic error when upsertBrandVoice throws (not swallowed silently)', async () => {
    vi.mocked(upsertBrandVoice).mockRejectedValue(new Error('DB down'))
    const result = await saveBaseVoiceAction(validPayload)
    expect(result?.error).toBe('generic')
  })
})
