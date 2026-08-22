'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import {
  pauseCampaign,
  resumeCampaign,
  softDeleteCampaignGuarded,
} from '@/lib/db/campaigns'
import { clearCampaignReferenceOnCards } from '@/lib/db/insight-cards'
import { clearPromotedCampaignReferenceOnDrafts } from '@/lib/db/studio-drafts'

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

    // database-reviewer (Session 28-D, D7 follow-up, MINOR-1): a soft
    // delete never fires insight_cards.campaign_id's ON DELETE SET NULL
    // (that only triggers on a real row DELETE, e.g. the business-purge
    // cascade) — without this, an "approved and in flight" card would keep
    // linking to a now-unreachable, soft-deleted campaign. Own try/catch:
    // a cleanup failure must not turn an already-successful delete into a
    // returned error.
    try {
      await clearCampaignReferenceOnCards(campaignId)
    } catch (cleanupErr: unknown) {
      console.error('campaigns/actions: clearCampaignReferenceOnCards failed after delete', campaignId, cleanupErr)
    }

    // ADR 0022 §12.1 — the identical D7 bug, reintroduced fresh for
    // studio_drafts.promoted_campaign_id: this soft-delete UPDATE never
    // fires that column's ON DELETE SET NULL. Own try/catch for the same
    // reason as clearCampaignReferenceOnCards above.
    try {
      await clearPromotedCampaignReferenceOnDrafts(ctx.client, ctx.business.id, campaignId)
    } catch (cleanupErr: unknown) {
      console.error('campaigns/actions: clearPromotedCampaignReferenceOnDrafts failed after delete', campaignId, cleanupErr)
    }

    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}
