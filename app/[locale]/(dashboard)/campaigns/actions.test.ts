import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/campaigns', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/campaigns')>()
  return {
    ...original,
    pauseCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
    softDeleteCampaignGuarded: vi.fn(),
  }
})

import { pauseCampaignAction, resumeCampaignAction, deleteCampaignAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { pauseCampaign, resumeCampaign, softDeleteCampaignGuarded } from '@/lib/db/campaigns'
import type { BusinessRow, CampaignRow } from '@/lib/db/types'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessByOwner = vi.mocked(getBusinessByOwner)
const mockPauseCampaign = vi.mocked(pauseCampaign)
const mockResumeCampaign = vi.mocked(resumeCampaign)
const mockSoftDeleteCampaignGuarded = vi.mocked(softDeleteCampaignGuarded)

const MOCK_USER = { id: 'user-123' }
const MOCK_BUSINESS: BusinessRow = {
  id: 'biz-456',
  name: 'Acme Corp',
  website: 'https://acme.com',
  industry: 'SaaS',
  description: null,
  logo_url: null,
  owner_id: 'user-123',
  plan: 'trial',
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
const MOCK_CAMPAIGN: CampaignRow = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  business_id: 'biz-456',
  name: 'Q2 Launch',
  objective: 'Drive awareness',
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'daily',
  posts_per_week: 7,
  start_date: '2026-05-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 28,
  total_posts_published: 0,
  voice_variation_id: null,
  deleted_at: null,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
}

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const INVALID_ID = 'not-a-uuid'

function makeAuthClient() {
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) } }
  mockCreateClient.mockResolvedValue(client as never)
  mockGetBusinessByOwner.mockResolvedValue(MOCK_BUSINESS)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── pauseCampaignAction ──────────────────────────────────────────────────────

describe('pauseCampaignAction', () => {
  it('returns invalid_id for non-UUID input', async () => {
    const result = await pauseCampaignAction(INVALID_ID)
    expect(result).toEqual({ error: 'invalid_id' })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('returns generic error when unauthenticated', async () => {
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }
    mockCreateClient.mockResolvedValue(client as never)
    const result = await pauseCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'generic' })
  })

  it('returns invalid_state when campaign is not active (guard returns null)', async () => {
    makeAuthClient()
    mockPauseCampaign.mockResolvedValue(null)
    const result = await pauseCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'invalid_state' })
  })

  it('returns success when pause succeeds', async () => {
    makeAuthClient()
    mockPauseCampaign.mockResolvedValue({ ...MOCK_CAMPAIGN, status: 'paused' })
    const result = await pauseCampaignAction(VALID_UUID)
    expect(result).toEqual({ success: true })
  })

  it('returns generic error when DB throws', async () => {
    makeAuthClient()
    mockPauseCampaign.mockRejectedValue(new Error('DB down'))
    const result = await pauseCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'generic' })
  })
})

// ── resumeCampaignAction ─────────────────────────────────────────────────────

describe('resumeCampaignAction', () => {
  it('returns invalid_id for non-UUID input', async () => {
    const result = await resumeCampaignAction(INVALID_ID)
    expect(result).toEqual({ error: 'invalid_id' })
  })

  it('returns invalid_state when campaign is not paused (guard returns null)', async () => {
    makeAuthClient()
    mockResumeCampaign.mockResolvedValue(null)
    const result = await resumeCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'invalid_state' })
  })

  it('returns success when resume succeeds', async () => {
    makeAuthClient()
    mockResumeCampaign.mockResolvedValue({ ...MOCK_CAMPAIGN, status: 'active' })
    const result = await resumeCampaignAction(VALID_UUID)
    expect(result).toEqual({ success: true })
  })

  it('returns generic error when DB throws', async () => {
    makeAuthClient()
    mockResumeCampaign.mockRejectedValue(new Error('DB down'))
    const result = await resumeCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'generic' })
  })
})

// ── deleteCampaignAction ─────────────────────────────────────────────────────

describe('deleteCampaignAction', () => {
  it('returns invalid_id for non-UUID input', async () => {
    const result = await deleteCampaignAction(INVALID_ID)
    expect(result).toEqual({ error: 'invalid_id' })
  })

  it('returns delete_active_error when campaign cannot be deleted (guard returns false)', async () => {
    makeAuthClient()
    mockSoftDeleteCampaignGuarded.mockResolvedValue(false)
    const result = await deleteCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'delete_active_error' })
  })

  it('returns success when delete succeeds', async () => {
    makeAuthClient()
    mockSoftDeleteCampaignGuarded.mockResolvedValue(true)
    const result = await deleteCampaignAction(VALID_UUID)
    expect(result).toEqual({ success: true })
  })

  it('returns generic error when DB throws', async () => {
    makeAuthClient()
    mockSoftDeleteCampaignGuarded.mockRejectedValue(new Error('DB down'))
    const result = await deleteCampaignAction(VALID_UUID)
    expect(result).toEqual({ error: 'generic' })
  })
})
