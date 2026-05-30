import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCampaignSchema } from '@/lib/validation/campaign'
import { checkCampaignCreationAllowed, upgradeCtaTargetFor } from '@/lib/campaigns/enforcement'
import { countActiveCampaigns } from '@/lib/db/campaigns'
import type { BusinessRow, TrialStatePublicRow } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      AI_TRIAL_CAMPAIGN_CAP: 1,
    },
  },
}))

vi.mock('@/lib/db/campaigns', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/campaigns')>()
  return {
    ...original,
    countActiveCampaigns: vi.fn(),
  }
})

const mockCountActiveCampaigns = vi.mocked(countActiveCampaigns)
const mockClient = {} as SupabaseClient

function makeBusiness(plan: BusinessRow['plan']): BusinessRow {
  return {
    id: 'biz-1',
    name: 'Test Business',
    website: null,
    industry: null,
    description: null,
    logo_url: null,
    owner_id: 'user-1',
    plan,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    language: 'en',
    timezone: 'UTC',
    onboarding_completed: true,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeTrialState(campaigns_created_count: number): TrialStatePublicRow {
  return {
    id: 'ts-1',
    business_id: 'biz-1',
    trial_started_at: '2026-01-01T00:00:00Z',
    campaigns_created_count,
    posts_generated_count: 0,
    brand_voice_inference_attempts: 0,
    work_email_verified: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// createCampaignSchema
// ---------------------------------------------------------------------------

describe('createCampaignSchema', () => {
  const validInput = {
    name: 'Q3 LinkedIn Campaign',
    objective: 'Drive awareness of our new product launch among B2B SaaS decision-makers',
    platforms: ['linkedin'],
    frequency: 'weekly',
    postsPerWeek: 3,
    startDate: '2026-06-01',
    endDate: '2026-09-30',
  }

  it('accepts valid input', () => {
    const result = createCampaignSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts valid input without endDate', () => {
    const { endDate: _endDate, ...withoutEnd } = validInput
    const result = createCampaignSchema.safeParse(withoutEnd)
    expect(result.success).toBe(true)
  })

  it('accepts valid input without specialInstructions', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, specialInstructions: undefined })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true)
    }
  })

  it('rejects name longer than 100 characters', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('name'))).toBe(true)
    }
  })

  it('rejects objective shorter than 10 characters', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, objective: 'Too short' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('objective'))).toBe(true)
    }
  })

  it('rejects empty platforms array', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, platforms: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('platforms'))).toBe(true)
    }
  })

  it('rejects invalid platform value', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, platforms: ['reddit'] })
    expect(result.success).toBe(false)
  })

  it('rejects postsPerWeek of 0', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, postsPerWeek: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects postsPerWeek greater than 21', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, postsPerWeek: 22 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid startDate', () => {
    const result = createCampaignSchema.safeParse({ ...validInput, startDate: 'not-a-date' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('startDate'))).toBe(true)
    }
  })

  it('rejects endDate before startDate', () => {
    const result = createCampaignSchema.safeParse({
      ...validInput,
      startDate: '2026-06-01',
      endDate: '2026-05-01',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('endDate'))).toBe(true)
    }
  })

  it('rejects endDate equal to startDate', () => {
    const result = createCampaignSchema.safeParse({
      ...validInput,
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('endDate'))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// checkCampaignCreationAllowed
// ---------------------------------------------------------------------------

describe('checkCampaignCreationAllowed', () => {
  beforeEach(() => {
    mockCountActiveCampaigns.mockReset()
  })

  describe('trial plan', () => {
    it('blocks when campaigns_created_count equals cap (1)', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('trial'),
        makeTrialState(1),
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('trial_campaign_limit')
    })

    it('blocks when campaigns_created_count exceeds cap', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('trial'),
        makeTrialState(5),
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('trial_campaign_limit')
    })

    it('allows when campaigns_created_count is under cap', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('trial'),
        makeTrialState(0),
      )
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('allows when trialState is null (treats count as 0)', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('trial'),
        null,
      )
      expect(result.allowed).toBe(true)
    })

    it('does not call countActiveCampaigns', async () => {
      await checkCampaignCreationAllowed(mockClient, makeBusiness('trial'), makeTrialState(0))
      expect(mockCountActiveCampaigns).not.toHaveBeenCalled()
    })
  })

  describe('plus plan', () => {
    it('blocks when active+draft count is 5', async () => {
      mockCountActiveCampaigns.mockResolvedValue(5)
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('plus'),
        null,
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('plus_campaign_limit')
    })

    it('blocks when active+draft count exceeds 5', async () => {
      mockCountActiveCampaigns.mockResolvedValue(6)
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('plus'),
        null,
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('plus_campaign_limit')
    })

    it('allows when active+draft count is 1', async () => {
      mockCountActiveCampaigns.mockResolvedValue(1)
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('plus'),
        null,
      )
      expect(result.allowed).toBe(true)
    })

    it('allows when active+draft count is 0', async () => {
      mockCountActiveCampaigns.mockResolvedValue(0)
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('plus'),
        null,
      )
      expect(result.allowed).toBe(true)
    })
  })

  describe('pro plan', () => {
    it('always allows', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('pro'),
        null,
      )
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('does not call countActiveCampaigns', async () => {
      await checkCampaignCreationAllowed(mockClient, makeBusiness('pro'), null)
      expect(mockCountActiveCampaigns).not.toHaveBeenCalled()
    })
  })

  describe('agency plan', () => {
    it('always allows', async () => {
      const result = await checkCampaignCreationAllowed(
        mockClient,
        makeBusiness('agency'),
        null,
      )
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('does not call countActiveCampaigns', async () => {
      await checkCampaignCreationAllowed(mockClient, makeBusiness('agency'), null)
      expect(mockCountActiveCampaigns).not.toHaveBeenCalled()
    })
  })
})

describe('upgradeCtaTargetFor', () => {
  it('returns /billing for trial_campaign_limit', () => {
    expect(upgradeCtaTargetFor('trial_campaign_limit')).toBe('/billing')
  })

  it('returns /billing for plus_campaign_limit', () => {
    expect(upgradeCtaTargetFor('plus_campaign_limit')).toBe('/billing')
  })
})
