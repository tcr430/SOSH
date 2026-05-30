import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn(),
  incrementCampaignsCreated: vi.fn(),
}))

vi.mock('@/lib/campaigns/enforcement', () => ({
  checkCampaignCreationAllowed: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  listActiveSocialAccounts: vi.fn(),
}))

vi.mock('@/lib/db/campaigns', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/campaigns')>()
  return {
    ...original,
    createCampaign: vi.fn(),
  }
})

import { createCampaignAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getTrialStateMaybe, incrementCampaignsCreated } from '@/lib/db/trial-state'
import { checkCampaignCreationAllowed } from '@/lib/campaigns/enforcement'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { createCampaign } from '@/lib/db/campaigns'
import type { BusinessRow } from '@/lib/db/types'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessByOwner = vi.mocked(getBusinessByOwner)
const mockGetTrialStateMaybe = vi.mocked(getTrialStateMaybe)
const mockIncrementCampaignsCreated = vi.mocked(incrementCampaignsCreated)
const mockCheckCampaignCreationAllowed = vi.mocked(checkCampaignCreationAllowed)
const mockListActiveSocialAccounts = vi.mocked(listActiveSocialAccounts)
const mockCreateCampaign = vi.mocked(createCampaign)

const MOCK_USER = { id: 'user-123' }

const MOCK_BUSINESS_TRIAL: BusinessRow = {
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
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const MOCK_CAMPAIGN = {
  id: 'camp-789',
  business_id: 'biz-456',
  name: 'Q3 Launch',
  objective: 'Drive awareness of our new product among B2B decision-makers',
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'weekly',
  posts_per_week: 3,
  start_date: '2026-06-01',
  end_date: null,
  status: 'draft',
  total_posts_planned: 12,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
}

function makeAuthClient(user: typeof MOCK_USER | null = MOCK_USER) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  }
}

function makeFormData(overrides: Record<string, string | string[]> = {}): FormData {
  const defaults: Record<string, string | string[]> = {
    name: 'Q3 Launch',
    objective: 'Drive awareness of our new product among B2B decision-makers',
    platforms: ['linkedin'],
    frequency: 'weekly',
    postsPerWeek: '3',
    startDate: '2026-06-01',
  }
  const merged = { ...defaults, ...overrides }
  const fd = new FormData()
  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v)
    } else {
      fd.append(key, value)
    }
  }
  return fd
}

const prevState = {}

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateClient.mockResolvedValue(makeAuthClient() as never)
  mockGetBusinessByOwner.mockResolvedValue(MOCK_BUSINESS_TRIAL)
  mockGetTrialStateMaybe.mockResolvedValue(null)
  mockCheckCampaignCreationAllowed.mockResolvedValue({ allowed: true })
  mockListActiveSocialAccounts.mockResolvedValue([{ platform: 'linkedin' }] as never)
  mockCreateCampaign.mockResolvedValue(MOCK_CAMPAIGN as never)
  mockIncrementCampaignsCreated.mockResolvedValue(undefined)
})

describe('createCampaignAction', () => {
  describe('validation', () => {
    it('returns field error for empty name', async () => {
      const result = await createCampaignAction(prevState, makeFormData({ name: '' }))
      expect(result.success).toBeUndefined()
      expect(result.errors?.name).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })

    it('returns field error for objective too short', async () => {
      const result = await createCampaignAction(prevState, makeFormData({ objective: 'Short' }))
      expect(result.errors?.objective).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })

    it('returns field error for empty platforms', async () => {
      const fd = new FormData()
      fd.append('name', 'Q3 Launch')
      fd.append('objective', 'Drive awareness of our new product among B2B decision-makers')
      fd.append('frequency', 'weekly')
      fd.append('postsPerWeek', '3')
      fd.append('startDate', '2026-06-01')
      // platforms intentionally omitted
      const result = await createCampaignAction(prevState, fd)
      expect(result.errors?.platforms).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })

    it('returns field error when endDate is before startDate', async () => {
      const result = await createCampaignAction(
        prevState,
        makeFormData({ startDate: '2026-06-01', endDate: '2026-05-01' }),
      )
      expect(result.errors?.endDate).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })
  })

  describe('authentication and business checks', () => {
    it('returns _form error when user is not authenticated', async () => {
      mockCreateClient.mockResolvedValue(makeAuthClient(null) as never)
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.errors?._form).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })

    it('returns _form error when business not found', async () => {
      mockGetBusinessByOwner.mockResolvedValue(null)
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.errors?._form).toBeDefined()
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })
  })

  describe('plan enforcement', () => {
    it('returns _limit error when trial user is at campaign limit', async () => {
      mockCheckCampaignCreationAllowed.mockResolvedValue({
        allowed: false,
        reason: 'trial_campaign_limit',
      })
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.errors?._limit).toBe('trial_campaign_limit')
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })

    it('returns _limit error when plus user is at campaign limit', async () => {
      mockCheckCampaignCreationAllowed.mockResolvedValue({
        allowed: false,
        reason: 'plus_campaign_limit',
      })
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.errors?._limit).toBe('plus_campaign_limit')
      expect(mockCreateCampaign).not.toHaveBeenCalled()
    })
  })

  describe('successful creation', () => {
    it('returns success and campaignId on valid input', async () => {
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.success).toBe(true)
      expect(result.campaignId).toBe('camp-789')
      expect(result.errors).toBeUndefined()
    })

    it('creates campaign with status draft', async () => {
      await createCampaignAction(prevState, makeFormData())
      expect(mockCreateCampaign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'draft' }),
      )
    })

    it('creates campaign with total_posts_published 0', async () => {
      await createCampaignAction(prevState, makeFormData())
      expect(mockCreateCampaign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ total_posts_published: 0 }),
      )
    })

    it('computes total_posts_planned as postsPerWeek × 4 when no endDate', async () => {
      // 3 posts/week × 4 weeks = 12
      await createCampaignAction(prevState, makeFormData({ postsPerWeek: '3' }))
      expect(mockCreateCampaign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ total_posts_planned: 12 }),
      )
    })

    it('computes total_posts_planned from date range when endDate provided', async () => {
      // startDate: 2026-06-01, endDate: 2026-08-31 = ~13 weeks × 2 = 26
      const result = await createCampaignAction(
        prevState,
        makeFormData({ postsPerWeek: '2', startDate: '2026-06-01', endDate: '2026-08-31' }),
      )
      expect(result.success).toBe(true)
      const call = mockCreateCampaign.mock.calls[0][1]
      expect(call.total_posts_planned).toBeGreaterThan(0)
    })

    it('increments campaigns_created_count for trial plan', async () => {
      await createCampaignAction(prevState, makeFormData())
      expect(mockIncrementCampaignsCreated).toHaveBeenCalledWith(MOCK_BUSINESS_TRIAL.id)
    })

    it('does NOT increment campaigns_created_count for pro plan', async () => {
      mockGetBusinessByOwner.mockResolvedValue({
        ...MOCK_BUSINESS_TRIAL,
        plan: 'pro',
      })
      await createCampaignAction(prevState, makeFormData())
      expect(mockIncrementCampaignsCreated).not.toHaveBeenCalled()
    })

    it('does NOT increment campaigns_created_count for plus plan', async () => {
      mockGetBusinessByOwner.mockResolvedValue({
        ...MOCK_BUSINESS_TRIAL,
        plan: 'plus',
      })
      await createCampaignAction(prevState, makeFormData())
      expect(mockIncrementCampaignsCreated).not.toHaveBeenCalled()
    })

    it('still returns success if incrementCampaignsCreated throws (swallowed)', async () => {
      mockIncrementCampaignsCreated.mockRejectedValue(new Error('rpc failure'))
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.success).toBe(true)
      expect(result.campaignId).toBe('camp-789')
    })
  })

  describe('error handling', () => {
    it('returns _form error when createCampaign throws', async () => {
      mockCreateCampaign.mockRejectedValue(new Error('db error'))
      const result = await createCampaignAction(prevState, makeFormData())
      expect(result.errors?._form).toBeDefined()
      expect(result.success).toBeUndefined()
    })
  })
})
