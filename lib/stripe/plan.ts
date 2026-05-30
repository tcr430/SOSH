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
