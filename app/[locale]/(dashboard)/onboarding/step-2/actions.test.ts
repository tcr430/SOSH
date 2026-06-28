import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/brand-voices', () => ({
  getBrandVoice: vi.fn(),
  upsertBrandVoice: vi.fn(),
}))

import { saveVoiceAxesAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { redirect } from 'next/navigation'
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
  onboarding_completed: false,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockClient = { auth: { getUser: vi.fn() } }

const validPayload: VoiceEditorSavePayload = {
  voiceAxes: {
    formal_casual: 50, expert_peer: 38, serious_playful: 56,
    reserved_warm: 50, calm_energetic: 68, rational_emotional: 58,
    exclusive_inclusive: 50,
  },
  tone: ['professional'],
  keywords: ['SaaS'],
  avoidWords: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createClient).mockResolvedValue(mockClient as never)
  vi.mocked(mockClient.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.mocked(getBusinessByOwner).mockResolvedValue(mockBusiness)
  vi.mocked(upsertBrandVoice).mockResolvedValue(undefined as never)
})

describe('saveVoiceAxesAction (§3.1 base-voice guard)', () => {
  it('returns validation error for out-of-range voiceAxes (not a silent no-op)', async () => {
    const badPayload: VoiceEditorSavePayload = {
      ...validPayload,
      voiceAxes: { ...validPayload.voiceAxes, formal_casual: 200 },
    }
    const result = await saveVoiceAxesAction(badPayload, 'en')
    expect(result?.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  it('returns validation error for negative axis (not a silent no-op)', async () => {
    const badPayload: VoiceEditorSavePayload = {
      ...validPayload,
      voiceAxes: { ...validPayload.voiceAxes, expert_peer: -5 },
    }
    const result = await saveVoiceAxesAction(badPayload, 'en')
    expect(result?.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  it('calls upsertBrandVoice and redirects on valid payload', async () => {
    await saveVoiceAxesAction(validPayload, 'en')
    expect(upsertBrandVoice).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/en/onboarding/step-3')
  })
})
