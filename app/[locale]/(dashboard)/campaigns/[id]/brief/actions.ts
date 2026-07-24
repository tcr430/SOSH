'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign, reviseBrief } from '@/lib/db/campaign-briefs'
import { approveBriefIfQualified } from '@/lib/campaigns/brief'
import type { CampaignRow, CampaignBriefRow } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

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

type LoadResult =
  | { ok: true; serviceClient: SupabaseClient; campaign: CampaignRow; brief: CampaignBriefRow }
  | { ok: false; error: 'unauthorized' | 'not_found' }

// Every action re-checks campaign ownership itself (never trusts a
// client-supplied businessId) — matches the established getAuthContext +
// getCampaignById + business_id match pattern (generate-action.ts). Explicit
// ok: boolean discriminant (not "property presence") — more robust narrowing
// than an `'error' in loaded` check on an inferred async-function return type.
async function loadOwnedCampaignAndBrief(campaignId: string): Promise<LoadResult> {
  const ctx = await getAuthContext()
  if (!ctx) return { ok: false, error: 'unauthorized' }

  const campaign = await getCampaignById(ctx.client, campaignId)
  if (!campaign || campaign.business_id !== ctx.business.id) {
    return { ok: false, error: 'not_found' }
  }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()
  const brief = await getBriefByCampaign(serviceClient, campaignId)
  if (!brief) return { ok: false, error: 'not_found' }

  return { ok: true, serviceClient, campaign, brief }
}

// ─── approve ─────────────────────────────────────────────────────────────

const approveSchema = z.object({ campaignId: z.uuid() })

export type ApproveBriefError =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_brief_state'
  | 'generic'

export type ApproveBriefState =
  | { status: 'idle' }
  | { status: 'approved' }
  | { status: 'gate_refused'; overallScore: number; critique: Record<string, unknown> | null }
  | { status: 'error'; error: ApproveBriefError }

export async function approveBriefAction(
  _prevState: ApproveBriefState,
  formData: FormData,
): Promise<ApproveBriefState> {
  try {
    const parsed = approveSchema.safeParse({ campaignId: formData.get('campaignId') })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadOwnedCampaignAndBrief(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }
    if (loaded.brief.status !== 'critiqued') return { status: 'error', error: 'invalid_brief_state' }

    // The HARD gate (ADR §6.3, MODE2-CRITIQUE-GATE) — enforced here at the
    // app layer via the SAME B2.5 function the orchestration path uses, not
    // re-implemented. A below-threshold brief cannot be approved from the UI
    // any more than it can be approved programmatically.
    const result = await approveBriefIfQualified(parsed.data.campaignId)
    if (!result.approved) {
      return { status: 'gate_refused', overallScore: result.overallScore, critique: result.critique }
    }
    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
    return { status: 'approved' }
  } catch {
    return { status: 'error', error: 'generic' }
  }
}

// ─── reject (revise, unchanged content) ────────────────────────────────────

const rejectSchema = z.object({
  campaignId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(1),
})

export type RejectBriefError =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_brief_state'
  | 'concurrent_edit'
  | 'generic'

export type RejectBriefState =
  | { status: 'idle' }
  | { status: 'rejected' }
  | { status: 'error'; error: RejectBriefError }

export async function rejectBriefAction(
  _prevState: RejectBriefState,
  formData: FormData,
): Promise<RejectBriefState> {
  try {
    const parsed = rejectSchema.safeParse({
      campaignId: formData.get('campaignId'),
      expectedVersion: formData.get('expectedVersion'),
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadOwnedCampaignAndBrief(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }
    if (loaded.brief.status !== 'critiqued') return { status: 'error', error: 'invalid_brief_state' }

    const updated = await reviseBrief(
      loaded.serviceClient,
      loaded.brief.id,
      parsed.data.expectedVersion,
      loaded.brief.content, // unchanged — reject just sends it back for reconsideration
    )
    if (!updated) return { status: 'error', error: 'concurrent_edit' }

    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
    return { status: 'rejected' }
  } catch {
    return { status: 'error', error: 'generic' }
  }
}

// ─── edit (revise with new narrative/proofPlan) ────────────────────────────

const editSchema = z.object({
  campaignId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(1),
  narrative: z.string().trim().min(1).max(2000),
  proofPlan: z.string().trim().min(1).max(2000),
})

export type EditBriefError =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_brief_state'
  | 'concurrent_edit'
  | 'generic'

export type EditBriefState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; error: EditBriefError }

export async function editBriefAction(
  _prevState: EditBriefState,
  formData: FormData,
): Promise<EditBriefState> {
  try {
    const parsed = editSchema.safeParse({
      campaignId: formData.get('campaignId'),
      expectedVersion: formData.get('expectedVersion'),
      narrative: formData.get('narrative'),
      proofPlan: formData.get('proofPlan'),
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadOwnedCampaignAndBrief(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }
    if (loaded.brief.status !== 'critiqued') return { status: 'error', error: 'invalid_brief_state' }

    // pinnedEvidence/roleSequence are NOT editable in this minimal surface
    // (ADR §10) — only narrative/proofPlan change; the rest of content carries
    // through unchanged.
    const updated = await reviseBrief(loaded.serviceClient, loaded.brief.id, parsed.data.expectedVersion, {
      ...loaded.brief.content,
      narrative: parsed.data.narrative,
      proofPlan: parsed.data.proofPlan,
    })
    if (!updated) return { status: 'error', error: 'concurrent_edit' }

    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
    return { status: 'saved' }
  } catch {
    return { status: 'error', error: 'generic' }
  }
}
