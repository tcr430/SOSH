import type { BusinessRow, BrandVoiceRow, CampaignRow, Platform } from '@/lib/db/types'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listCampaigns } from '@/lib/db/campaigns'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getVariationForBusiness } from '@/lib/db/voice'
import { vectorToVoiceFields } from '@/lib/voice/translate'
import { retrievePerformancePatterns } from '@/lib/memory'

export type BrandVoiceContext = BrandVoiceRow & { readonly descriptor: string }

export interface CustomerContext {
  business: Pick<BusinessRow, 'id' | 'name' | 'industry' | 'description' | 'language' | 'website' | 'timezone'>
  brandVoice: BrandVoiceContext | null
  recentCampaigns: Array<Pick<CampaignRow, 'id' | 'name' | 'objective' | 'status'>>
  recentPostPerformance: Array<{
    platform: Platform
    topContent: string
    likes: number
    impressions: number
  }>
  trialState: {
    isTrial: boolean
    postsRemaining: number
    campaignsRemaining: number
    brandVoiceAttemptsRemaining: number
  } | null
}

export async function buildCustomerContext(
  businessId: string,
  voiceVariationId?: string | null,
): Promise<CustomerContext> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const { config } = await import('@/lib/config')
  const client = createServiceRoleClient()

  // ADR 0016 §6 — recentPostPerformance is sourced through lib/memory's
  // governed retrieval (scored + capped at PERFORMANCE_CAP=3) instead of a
  // direct lib/db fan-out. No campaign/post-specific queryContext is known
  // at this call site (buildCustomerContext is business-scoped, not
  // per-post), so an empty queryContext is passed — lib/memory/performance.ts
  // falls back to today's post_metrics-derived behaviour while
  // performance_memory ships empty in Track A (ADR §3.4).
  const [business, brandVoice, campaigns, recentPostPerformance, trialStateRow] = await Promise.all([
    getBusinessById(client, businessId),
    getBrandVoice(client, businessId),
    listCampaigns(client, businessId, 5),
    retrievePerformancePatterns(client, businessId, {}),
    getTrialStateMaybe(client, businessId),
  ])

  let trialState: CustomerContext['trialState'] = null
  if (business.plan === 'trial') {
    if (trialStateRow !== null) {
      trialState = {
        isTrial: true,
        postsRemaining: Math.max(0, config.server.AI_TRIAL_POST_CAP - trialStateRow.posts_generated_count),
        campaignsRemaining: Math.max(0, config.server.AI_TRIAL_CAMPAIGN_CAP - trialStateRow.campaigns_created_count),
        brandVoiceAttemptsRemaining: Math.max(
          0,
          config.server.AI_TRIAL_BRAND_VOICE_ATTEMPTS - trialStateRow.brand_voice_inference_attempts,
        ),
      }
    } else {
      // trial_state row missing (trigger hasn't fired yet) — full caps
      trialState = {
        isTrial: true,
        postsRemaining: config.server.AI_TRIAL_POST_CAP,
        campaignsRemaining: config.server.AI_TRIAL_CAMPAIGN_CAP,
        brandVoiceAttemptsRemaining: config.server.AI_TRIAL_BRAND_VOICE_ATTEMPTS,
      }
    }
  }

  // When a campaign has a variation selected (§8.2/§4.3), override the base voice_axes
  // and recompute descriptor. Falls back to base on null, missing id, or deleted variation (ON DELETE SET NULL).
  let resolvedBrandVoice: BrandVoiceContext | null = null
  if (brandVoice) {
    let axesToUse = brandVoice.voice_axes
    if (voiceVariationId) {
      const variation = await getVariationForBusiness(client, voiceVariationId, businessId)
      if (variation) axesToUse = variation.voice_axes
    }
    const { descriptor } = vectorToVoiceFields(axesToUse)
    resolvedBrandVoice = { ...brandVoice, voice_axes: axesToUse, descriptor }
  }

  return {
    business: {
      id: business.id,
      name: business.name,
      industry: business.industry,
      description: business.description,
      language: business.language,
      website: business.website,
      timezone: business.timezone,
    },
    brandVoice: resolvedBrandVoice,
    recentCampaigns: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
    })),
    recentPostPerformance,
    trialState,
  }
}
