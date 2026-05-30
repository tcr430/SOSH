'use server'

import { z } from 'zod'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { listPostsByCampaign } from '@/lib/db/posts'
import { buildCustomerContext } from '@/lib/ai/context'
import { createGenerationSession, getGenerationSession } from '@/lib/db/post-generation-sessions'
import { generatePostsForCampaign } from '@/lib/campaigns/generate'
import type { GenerationSessionStatus } from '@/lib/db/types'

async function getAuthContext() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessByOwner(client, user.id)
  if (!business) return null
  return { client, business }
}

export async function startGenerationAction(
  rawCampaignId: string,
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const parsed = z.string().uuid().safeParse(rawCampaignId)
    if (!parsed.success) return { error: 'invalid_campaign_state' }
    const campaignId = parsed.data

    const ctx = await getAuthContext()
    if (!ctx) return { error: 'unauthorized' }

    const campaign = await getCampaignById(ctx.client, campaignId)
    if (!campaign || campaign.business_id !== ctx.business.id) {
      return { error: 'invalid_campaign_state' }
    }
    if (campaign.status !== 'draft' || campaign.total_posts_planned <= 0) {
      return { error: 'invalid_campaign_state' }
    }

    const customerCtx = await buildCustomerContext(ctx.business.id)
    if (!customerCtx.brandVoice) {
      return { error: 'invalid_campaign_state' }
    }
    if (
      customerCtx.trialState !== null &&
      customerCtx.trialState.postsRemaining < campaign.total_posts_planned
    ) {
      return { error: 'quota_exceeded' }
    }

    const existingPosts = await listPostsByCampaign(ctx.client, campaignId)
    if (existingPosts.length > 0) {
      return { error: 'already_generated' }
    }

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()
    const session = await createGenerationSession(serviceClient, {
      business_id: ctx.business.id,
      campaign_id: campaignId,
      status: 'pending',
      posts_planned: campaign.total_posts_planned,
    })

    const { id: sessionId, business_id: businessId } = session
    after(() => generatePostsForCampaign(campaignId, businessId, sessionId))

    return { sessionId: session.id }
  } catch {
    return { error: 'generic' }
  }
}

export async function getGenerationSessionAction(
  rawSessionId: string,
): Promise<{
  status: GenerationSessionStatus
  postsCreated: number
  postsPlanned: number
  errorCode: string | null
} | { error: string }> {
  try {
    const parsed = z.string().uuid().safeParse(rawSessionId)
    if (!parsed.success) return { error: 'not_found' }
    const sessionId = parsed.data

    const ctx = await getAuthContext()
    if (!ctx) return { error: 'unauthorized' }

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()
    const session = await getGenerationSession(serviceClient, sessionId)

    if (!session || session.business_id !== ctx.business.id) {
      return { error: 'not_found' }
    }

    return {
      status: session.status,
      postsCreated: session.posts_created,
      postsPlanned: session.posts_planned,
      errorCode: session.error_code,
    }
  } catch {
    return { error: 'generic' }
  }
}
