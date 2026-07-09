'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import {
  pauseCampaign,
  resumeCampaign,
  softDeleteCampaignGuarded,
} from '@/lib/db/campaigns'

export type CampaignActionState = {
  success?: boolean
  error?: 'invalid_id' | 'not_found' | 'invalid_state' | 'delete_active_error' | 'generic'
}

const campaignIdSchema = z.object({ campaignId: z.string().uuid() })

async function getAuthContext() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessForUser(client, user.id)
  if (!business) return null
  return { client, business }
}

export async function pauseCampaignAction(
  campaignId: string,
): Promise<CampaignActionState> {
  const parsed = campaignIdSchema.safeParse({ campaignId })
  if (!parsed.success) return { error: 'invalid_id' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await pauseCampaign(ctx.client, campaignId)
    if (!row) return { error: 'invalid_state' }

    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

export async function resumeCampaignAction(
  campaignId: string,
): Promise<CampaignActionState> {
  const parsed = campaignIdSchema.safeParse({ campaignId })
  if (!parsed.success) return { error: 'invalid_id' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const row = await resumeCampaign(ctx.client, campaignId)
    if (!row) return { error: 'invalid_state' }

    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

export async function deleteCampaignAction(
  campaignId: string,
): Promise<CampaignActionState> {
  const parsed = campaignIdSchema.safeParse({ campaignId })
  if (!parsed.success) return { error: 'invalid_id' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { error: 'generic' }

    const deleted = await softDeleteCampaignGuarded(ctx.client, campaignId)
    if (!deleted) return { error: 'delete_active_error' }

    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}
