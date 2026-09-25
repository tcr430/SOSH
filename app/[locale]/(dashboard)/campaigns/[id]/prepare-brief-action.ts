'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getCampaignById } from '@/lib/db/campaigns'
import { prepareBriefForCampaign } from '@/lib/campaigns/prepare-brief'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'

// ADR 0017 §11 / ADR 0027 §2.7 (K2.12) — RETRY the brief pipeline for a campaign left 'draft' because Stage A failed when
// the form was submitted (createCampaignAction reports that as briefReady:false). Without this a failed Stage A is a
// permanent dead end: the campaign exists, has no brief, and generation refuses a draft.
//
// Same pipeline, same request path, same authenticated client as createCampaignAction, so the planner runs here too
// (ruling A-8). The security boundary is unchanged: the campaign is re-checked for ownership and the caller for the
// author capability (ruling A-5, reused); prepareBriefForCampaign / assembleBrief re-check the campaign is a draft
// with no brief, so a double click or a stale page cannot create a second brief.

export type PrepareBriefActionResult =
  | { briefReady: true }
  | { error: 'invalid_input' | 'unauthorized' | 'not_found' | 'forbidden' | 'invalid_campaign_state' | 'failed' }

export async function prepareBriefAction(rawCampaignId: string): Promise<PrepareBriefActionResult> {
  try {
    const parsed = z.string().uuid().safeParse(rawCampaignId)
    if (!parsed.success) return { error: 'invalid_input' }
    const campaignId = parsed.data

    const client = await createClient()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return { error: 'unauthorized' }
    const business = await getBusinessForUser(client, user.id)
    if (!business) return { error: 'unauthorized' }

    const campaign = await getCampaignById(client, campaignId).catch(() => null)
    if (!campaign || campaign.business_id !== business.id) return { error: 'not_found' }

    const memberRow = business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
    const member = resolveMemberContext(business, user.id, memberRow)
    if (!hasCapability(member, CAPABILITIES.AUTHOR)) return { error: 'forbidden' }

    if (campaign.status !== 'draft') return { error: 'invalid_campaign_state' }

    const prepared = await prepareBriefForCampaign(client, campaignId)
    if (!prepared.briefReady) return { error: 'failed' }

    revalidatePath(`/[locale]/campaigns/${campaignId}`, 'page')
    return { briefReady: true }
  } catch {
    return { error: 'failed' }
  }
}
