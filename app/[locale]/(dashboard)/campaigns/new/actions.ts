'use server'

import { differenceInWeeks, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { createCampaignSchema } from '@/lib/validation/campaign'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getTrialStateMaybe, incrementCampaignsCreated } from '@/lib/db/trial-state'
import { checkCampaignCreationAllowed } from '@/lib/campaigns/enforcement'
import { createCampaign } from '@/lib/db/campaigns'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import type { Platform } from '@/lib/db/types'

export type CreateCampaignState = {
  errors?: {
    name?: string
    objective?: string
    platforms?: string
    endDate?: string
    voice_variation?: string
    _form?: string
    _limit?: 'trial_campaign_limit' | 'plus_campaign_limit'
  }
  success?: boolean
  campaignId?: string
}

function computeTotalPostsPlanned(
  postsPerWeek: number,
  startDate: string,
  endDate?: string,
): number {
  if (endDate) {
    const weeks = Math.max(1, differenceInWeeks(parseISO(endDate), parseISO(startDate)))
    return weeks * postsPerWeek
  }
  return postsPerWeek * 4
}

export async function createCampaignAction(
  _prevState: CreateCampaignState,
  formData: FormData,
): Promise<CreateCampaignState> {
  // Step 1: Parse and validate
  const rawVoiceVariationId = formData.get('voiceVariationId') as string | null
  const rawData = {
    name: formData.get('name') as string,
    objective: formData.get('objective') as string,
    specialInstructions: (formData.get('specialInstructions') as string) || undefined,
    platforms: formData.getAll('platforms') as string[],
    frequency: formData.get('frequency') as string,
    postsPerWeek: Number(formData.get('postsPerWeek')),
    startDate: formData.get('startDate') as string,
    endDate: (formData.get('endDate') as string) || undefined,
    voiceVariationId: rawVoiceVariationId || undefined,
  }

  const parsed = createCampaignSchema.safeParse(rawData)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    return {
      errors: {
        name: fieldErrors.name?.[0],
        objective: fieldErrors.objective?.[0],
        platforms: fieldErrors.platforms?.[0],
        endDate: fieldErrors.endDate?.[0],
      },
    }
  }

  try {
    // Step 2: Get authenticated user
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) {
      return { errors: { _form: 'errors.campaign.generic' } }
    }

    // Step 3: Get business
    const business = await getBusinessForUser(client, user.id)
    if (!business) {
      return { errors: { _form: 'errors.campaign.generic' } }
    }

    // Step 4: Verify all selected platforms are connected for this business
    const connectedAccounts = await listActiveSocialAccounts(client, business.id)
    const connectedPlatforms = new Set(connectedAccounts.map((a) => a.platform))
    const unconnectedPlatforms = parsed.data.platforms.filter(
      (p) => !connectedPlatforms.has(p as Platform),
    )
    if (unconnectedPlatforms.length > 0) {
      return { errors: { platforms: 'errors.campaign.platform_not_connected' } }
    }

    // Step 5a: Verify voice variation belongs to this business (write-time ownership guard §3.3)
    if (parsed.data.voiceVariationId) {
      const { getVariationById } = await import('@/lib/db/voice')
      const variation = await getVariationById(client, parsed.data.voiceVariationId)
      if (!variation) {
        return { errors: { voice_variation: 'errors.campaign.invalid_voice_variation' } }
      }
    }

    // Step 5: Get trial state (null if trial hasn't started)
    const trialState = await getTrialStateMaybe(client, business.id)

    // Step 5: Check plan enforcement
    const enforcement = await checkCampaignCreationAllowed(client, business, trialState)
    if (!enforcement.allowed) {
      return { errors: { _limit: enforcement.reason } }
    }

    // Step 6: Compute totalPostsPlanned
    const totalPostsPlanned = computeTotalPostsPlanned(
      parsed.data.postsPerWeek,
      parsed.data.startDate,
      parsed.data.endDate,
    )

    // Step 7: Create campaign
    const campaign = await createCampaign(client, {
      business_id: business.id,
      name: parsed.data.name,
      objective: parsed.data.objective,
      special_instructions: parsed.data.specialInstructions ?? null,
      platforms: parsed.data.platforms as Platform[],
      frequency: parsed.data.frequency,
      posts_per_week: parsed.data.postsPerWeek,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate ?? null,
      status: 'draft',
      total_posts_planned: totalPostsPlanned,
      total_posts_published: 0,
      voice_variation_id: parsed.data.voiceVariationId ?? null,
    })

    // Step 8: Increment trial counter (errors swallowed — must not block the user)
    if (business.plan === 'trial') {
      try {
        await incrementCampaignsCreated(business.id)
      } catch {
        // intentional: counter failure does not block campaign creation
      }
    }

    // Step 9: Return success with campaignId for client-side redirect
    return { success: true, campaignId: campaign.id }
  } catch {
    return { errors: { _form: 'errors.campaign.generic' } }
  }
}
