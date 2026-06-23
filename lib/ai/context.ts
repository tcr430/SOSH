import type { BusinessRow, BrandVoiceRow, CampaignRow, Platform } from '@/lib/db/types'
import { getBusinessById } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listCampaigns } from '@/lib/db/campaigns'
import { listTopPostMetrics } from '@/lib/db/post-metrics'
import { listPostsByIds } from '@/lib/db/posts'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { vectorToVoiceFields } from '@/lib/voice/translate'

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

export async function buildCustomerContext(businessId: string): Promise<CustomerContext> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const { config } = await import('@/lib/config')
  const client = createServiceRoleClient()

  const [business, brandVoice, campaigns, topMetrics, trialStateRow] = await Promise.all([
    getBusinessById(client, businessId),
    getBrandVoice(client, businessId),
    listCampaigns(client, businessId, 5),
    listTopPostMetrics(client, businessId, 10),
    getTrialStateMaybe(client, businessId),
  ])

  let recentPostPerformance: CustomerContext['recentPostPerformance'] = []
  if (topMetrics.length > 0) {
    const postIds = topMetrics.map(m => m.post_id)
    const posts = await listPostsByIds(client, postIds)
    const postsById = Object.fromEntries(posts.map(p => [p.id, p]))
    recentPostPerformance = topMetrics
      .filter(m => postsById[m.post_id] !== undefined)
      .map(m => ({
        platform: postsById[m.post_id].platform,
        topContent: postsById[m.post_id].content,
        likes: m.likes ?? 0,
        impressions: m.impressions ?? 0,
      }))
  }

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
    brandVoice: brandVoice
      ? { ...brandVoice, descriptor: vectorToVoiceFields(brandVoice.voice_axes).descriptor }
      : null,
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
