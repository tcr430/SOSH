import { describe, it, expect } from 'vitest'
import { getPlanCapabilities } from './plan'
import type { Plan } from '@/lib/db/types'

const ALL_PLANS: Plan[] = ['trial', 'plus', 'pro', 'agency']

describe('getPlanCapabilities', () => {
  it('returns non-null capabilities for every plan value', () => {
    for (const plan of ALL_PLANS) {
      expect(getPlanCapabilities(plan)).not.toBeNull()
      expect(getPlanCapabilities(plan).plan).toBe(plan)
    }
  })

  it("trial's lifetimeCampaigns === 1", () => {
    expect(getPlanCapabilities('trial').lifetimeCampaigns).toBe(1)
  })

  it("plus's activeCampaigns === 5", () => {
    expect(getPlanCapabilities('plus').activeCampaigns).toBe(5)
  })

  it("pro's activeCampaigns === null (unlimited)", () => {
    expect(getPlanCapabilities('pro').activeCampaigns).toBeNull()
  })

  it("pro's allowedPlatforms has length 5", () => {
    expect(getPlanCapabilities('pro').allowedPlatforms).toHaveLength(5)
  })

  it('agency matches pro capabilities for Phase 1', () => {
    const agency = getPlanCapabilities('agency')
    const pro = getPlanCapabilities('pro')
    expect(agency.activeCampaigns).toBe(pro.activeCampaigns)
    expect(agency.postsPerMonth).toBe(pro.postsPerMonth)
    expect(agency.allowedPlatforms).toEqual(pro.allowedPlatforms)
    expect(agency.engagementInbox).toBe(pro.engagementInbox)
    expect(agency.advancedAnalytics).toBe(pro.advancedAnalytics)
  })
})
