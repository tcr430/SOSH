import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow, TrialStatePublicRow } from '@/lib/db/types'
import { countActiveCampaigns } from '@/lib/db/campaigns'
import { config } from '@/lib/config'

export type CampaignEnforcementReason = 'trial_campaign_limit' | 'plus_campaign_limit'

const PLUS_CAMPAIGN_LIMIT = 5

export async function checkCampaignCreationAllowed(
  client: SupabaseClient,
  business: BusinessRow,
  trialState: TrialStatePublicRow | null,
): Promise<{ allowed: boolean; reason?: CampaignEnforcementReason }> {
  if (business.plan === 'trial') {
    const cap = config.server.AI_TRIAL_CAMPAIGN_CAP
    const count = trialState?.campaigns_created_count ?? 0
    if (count >= cap) {
      return { allowed: false, reason: 'trial_campaign_limit' }
    }
    return { allowed: true }
  }

  if (business.plan === 'plus') {
    const count = await countActiveCampaigns(client, business.id)
    if (count >= PLUS_CAMPAIGN_LIMIT) {
      return { allowed: false, reason: 'plus_campaign_limit' }
    }
    return { allowed: true }
  }

  return { allowed: true }
}

export function upgradeCtaTargetFor(
  reason: CampaignEnforcementReason,
): '/billing' | null {
  switch (reason) {
    case 'trial_campaign_limit':
    case 'plus_campaign_limit':
      return '/billing'
    default:
      return null
  }
}
