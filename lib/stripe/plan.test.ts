import { describe, it, expect } from 'vitest'
import { getPlanCapabilities, MARKETING_PLANS, pricingFeatureRows } from './plan'
import type { PricingFeatureRow } from './plan'
import marketingEn from '@/i18n/en/marketing.json'
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
    expect(agency.maxSeats).toBe(pro.maxSeats)
  })

  // ADR 0013 §6.1 — seat caps (SEAT-MAXSEATS-NULL-UNLIMITED).
  it("trial's maxSeats === 10", () => {
    expect(getPlanCapabilities('trial').maxSeats).toBe(10)
  })

  it("plus's maxSeats === 10", () => {
    expect(getPlanCapabilities('plus').maxSeats).toBe(10)
  })

  it("pro's maxSeats === null (unlimited)", () => {
    expect(getPlanCapabilities('pro').maxSeats).toBeNull()
  })

  it("agency's maxSeats === null (unlimited)", () => {
    expect(getPlanCapabilities('agency').maxSeats).toBeNull()
  })
})

/**
 * ADR 0009 §14: the regression guard against price drift. The marketing
 * cards derive feature rows from getPlanCapabilities via pricingFeatureRows;
 * if a capability changes (e.g. Plus bumps to 100 posts/month), these
 * assertions catch the marketing surface lagging. No HTML snapshots (§14
 * bans copy snapshots) — assertions are on the key/values structure plus
 * the interpolated i18n label templates.
 */

/** Interpolate a marketing.pricing.feature.<key> template with row values. */
function renderLabel(row: PricingFeatureRow): string {
  const template = marketingEn.pricing.feature[row.key as keyof typeof marketingEn.pricing.feature]
  return Object.entries(row.values ?? {}).reduce(
    (label, [name, value]) => label.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

describe('pricingFeatureRows (ADR 0009 §5.2)', () => {
  it('MARKETING_PLANS lists plus then pro', () => {
    expect(MARKETING_PLANS).toEqual(['plus', 'pro'])
  })

  it('plus rows derive from getPlanCapabilities(plus)', () => {
    const capabilities = getPlanCapabilities('plus')
    const rows = pricingFeatureRows('plus')
    expect(rows).toEqual([
      { key: 'posts', values: { count: capabilities.postsPerMonth } },
      { key: 'campaigns', values: { count: capabilities.activeCampaigns } },
      { key: 'platforms_launch' },
      { key: 'analytics_basic' },
    ])
  })

  it('plus interpolated labels read the launch strings', () => {
    const labels = pricingFeatureRows('plus').map(renderLabel)
    expect(labels).toEqual([
      '50 posts a month',
      'Up to 5 active campaigns',
      'LinkedIn + X (Twitter)',
      'Basic analytics',
    ])
  })

  it('pro rows are unlimited/all-channels/advanced/inbox', () => {
    expect(pricingFeatureRows('pro')).toEqual([
      { key: 'posts_unlimited' },
      { key: 'campaigns_unlimited' },
      { key: 'platforms_all', values: { count: 5 } },
      { key: 'analytics_advanced' },
      { key: 'inbox' },
    ])
  })

  it('every row key has a label template in marketing.json', () => {
    for (const plan of MARKETING_PLANS) {
      for (const row of pricingFeatureRows(plan)) {
        expect(marketingEn.pricing.feature).toHaveProperty(row.key)
      }
    }
  })
})
