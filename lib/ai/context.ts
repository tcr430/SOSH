import type { BusinessRow, BrandVoiceRow, CampaignRow, Platform } from '@/lib/db/types'
import { getBusinessById } from '@/lib/db/businesses'
import { listCampaigns } from '@/lib/db/campaigns'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { retrievePerformancePatterns, retrieveVoice } from '@/lib/memory'

export type BrandVoiceContext = BrandVoiceRow & { readonly descriptor: string }

export interface CustomerContext {
  business: Pick<BusinessRow, 'id' | 'name' | 'industry' | 'description' | 'language' | 'website' | 'timezone'>
  brandVoice: BrandVoiceContext | null
  recentCampaigns: Array<Pick<CampaignRow, 'id' | 'name' | 'objective' | 'status'>>
  recentPostPerformance: Array<{
    // platform is nullable (MINOR-3): a cross-platform governed pattern
    // carries null, rendered "Across platforms" rather than dropped/guessed.
    platform: Platform | null
    topContent: string
    // Optional (MINOR-2): governed patterns omit per-post metrics rather than
    // inventing 0s; the post_metrics fallback still provides real counts.
    likes?: number
    impressions?: number
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
  // ADR 0016 §3.5 (MEM-VOICE-THROUGH-EXISTING) — voice resolves through
  // lib/memory's retrieveVoice, which reads the EXISTING brand_voices /
  // brand_voice_variations stores (there is no voice_memory table). This
  // replaces an inline copy of the same logic that lived here; two
  // implementations of voice resolution had to be kept in step by hand,
  // including the variation-override branch lib/campaigns/generate.ts
  // depends on. The variation fetch now happens inside this Promise.all
  // rather than sequentially after it — same calls, same arguments, one
  // fewer round-trip.
  const [business, resolvedBrandVoice, campaigns, recentPostPerformance, trialStateRow] = await Promise.all([
    getBusinessById(client, businessId),
    retrieveVoice(client, businessId, voiceVariationId),
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
    // ADR 0019 §8.2 — PerformancePattern (lib/memory/performance.ts) gained a
    // `provenance` discriminant. MEM-CONTEXT-EQUIVALENT requires this
    // shape's RUNTIME fields, not just its declared type, to stay
    // byte-identical: TypeScript's structural typing would silently allow
    // passing PerformancePattern[] straight through (extra fields on an
    // assigned variable aren't excess-property-checked), but every
    // downstream consumer that renders/stringifies this array would then
    // leak `provenance` into a Mode 2 prompt. Explicitly re-mapped to strip
    // it — this is the fix, not a workaround; lib/ai/context.test.ts's
    // literal-shape assertions are what caught the gap.
    recentPostPerformance: recentPostPerformance.map(p => ({
      platform: p.platform,
      topContent: p.topContent,
      ...(p.likes !== undefined ? { likes: p.likes } : {}),
      ...(p.impressions !== undefined ? { impressions: p.impressions } : {}),
    })),
    trialState,
  }
}
