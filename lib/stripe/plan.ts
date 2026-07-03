import type { Plan, Platform } from '@/lib/db/types'

export type { Plan }

export interface PlanCapabilities {
  plan: Plan
  /** Canonical display key — i18n is the caller's job. */
  displayKey: string
  /** Monthly post-generation cap. null = unlimited. */
  postsPerMonth: number | null
  /** Concurrent active campaign cap. null = unlimited. */
  activeCampaigns: number | null
  /** Trial-only lifetime campaigns-created cap. null on paid plans. */
  lifetimeCampaigns: number | null
  /** Platforms this plan may publish to. */
  allowedPlatforms: ReadonlyArray<Platform>
  engagementInbox: boolean
  advancedAnalytics: boolean
  /** Max total seats (active members + pending invites, owner incl.). null = unlimited. */
  maxSeats: number | null
}

const LAUNCH_PLATFORMS: ReadonlyArray<Platform> = ['linkedin', 'twitter']
const ALL_PLATFORMS: ReadonlyArray<Platform> = [
  'linkedin',
  'twitter',
  'instagram',
  'facebook',
  'threads',
]

const PRO_CAPABILITIES: Omit<PlanCapabilities, 'plan' | 'displayKey'> = {
  postsPerMonth: null,
  activeCampaigns: null,
  lifetimeCampaigns: null,
  allowedPlatforms: ALL_PLATFORMS,
  engagementInbox: true,
  advancedAnalytics: true,
  maxSeats: null,
}

const CAPABILITIES: Record<Plan, PlanCapabilities> = {
  trial: {
    plan: 'trial',
    displayKey: 'trial',
    postsPerMonth: 50,
    activeCampaigns: null,
    lifetimeCampaigns: 1,
    allowedPlatforms: LAUNCH_PLATFORMS,
    engagementInbox: false,
    advancedAnalytics: false,
    maxSeats: 10,
  },
  plus: {
    plan: 'plus',
    displayKey: 'plus',
    postsPerMonth: 50,
    activeCampaigns: 5,
    lifetimeCampaigns: null,
    allowedPlatforms: LAUNCH_PLATFORMS,
    engagementInbox: false,
    advancedAnalytics: false,
    maxSeats: 10,
  },
  pro: {
    plan: 'pro',
    displayKey: 'pro',
    ...PRO_CAPABILITIES,
  },
  // Phase 1: agency mirrors pro. Phase 4 will diverge.
  agency: {
    plan: 'agency',
    displayKey: 'agency',
    ...PRO_CAPABILITIES,
  },
}

export function getPlanCapabilities(plan: Plan): PlanCapabilities {
  return CAPABILITIES[plan]
}

/** Plans shown on the marketing pricing surface, in display order. */
export const MARKETING_PLANS: ReadonlyArray<Plan> = ['plus', 'pro']

/** A feature row = an i18n label key + values to interpolate. */
export interface PricingFeatureRow {
  key: string // → marketing.pricing.feature.<key>
  values?: Record<string, number>
}

/**
 * Ordered feature rows for a plan card, derived from getPlanCapabilities.
 * Numbers come from capabilities; only label templates live in i18n.
 * This is what keeps the marketing card and the billing layer from disagreeing.
 */
export function pricingFeatureRows(plan: Plan): ReadonlyArray<PricingFeatureRow> {
  const c = getPlanCapabilities(plan)
  const rows: PricingFeatureRow[] = []
  rows.push(
    c.postsPerMonth === null
      ? { key: 'posts_unlimited' }
      : { key: 'posts', values: { count: c.postsPerMonth } },
  )
  rows.push(
    c.activeCampaigns === null
      ? { key: 'campaigns_unlimited' }
      : { key: 'campaigns', values: { count: c.activeCampaigns } },
  )
  rows.push(
    c.allowedPlatforms.length >= ALL_PLATFORMS.length
      ? { key: 'platforms_all', values: { count: c.allowedPlatforms.length } }
      : { key: 'platforms_launch' },
  )
  rows.push({ key: c.advancedAnalytics ? 'analytics_advanced' : 'analytics_basic' })
  if (c.engagementInbox) rows.push({ key: 'inbox' })
  return rows
}
