'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { acknowledgeRetrospective, getCampaignRetrospective } from '@/lib/db/campaign-retrospectives'
import { buildRetrospectivePattern } from '@/lib/outcomes/retrospective-text'

// ADR 0026 §8.4 (Session 33 J2.11, L-6) — the human-confirmed write-back. Nothing reaches memory until a member
// acknowledges a completed retrospective here.
//
//   * The acting user is taken from supabase.auth.getUser() on the anon server client — NEVER from form data. A
//     `userId` field in the form is ignored. The RPC re-checks that user against business_members (active,
//     non-viewer) and raises 42501 otherwise, so a viewer is refused by the database, not just by this file.
//   * The pattern text embeds member-editable text (campaign name, hypothesis): it is built from the closed
//     template and neutralised by acknowledgeRetrospective (neutralizeWithSentinels) before it can reach
//     performance_memory.

const acknowledgeSchema = z.object({
  campaignId: z.uuid(),
  note: z.string().trim().max(500).optional(),
})

export type AcknowledgeRetrospectiveError =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'forbidden'
  | 'already_acknowledged'
  | 'generic'

export type AcknowledgeRetrospectiveState =
  | { status: 'idle' }
  | { status: 'acknowledged' }
  | { status: 'error'; error: AcknowledgeRetrospectiveError }

// The RPC raises 42501 with this wording for a non-member, a revoked member, and a viewer.
function isForbidden(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /non-viewer member|42501|permission denied/i.test(message)
}

export async function acknowledgeRetrospectiveAction(
  _prevState: AcknowledgeRetrospectiveState,
  formData: FormData,
): Promise<AcknowledgeRetrospectiveState> {
  try {
    const noteRaw = formData.get('note')
    const parsed = acknowledgeSchema.safeParse({
      campaignId: formData.get('campaignId'),
      note: typeof noteRaw === 'string' && noteRaw.trim() !== '' ? noteRaw : undefined,
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const client = await createClient()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return { status: 'error', error: 'unauthorized' }

    const business = await getBusinessForUser(client, user.id)
    if (!business) return { status: 'error', error: 'unauthorized' }

    // Ownership is re-checked here, never trusted from the form: the campaign must belong to the user's business.
    const campaign = await getCampaignById(client, parsed.data.campaignId)
    if (!campaign || campaign.business_id !== business.id) return { status: 'error', error: 'not_found' }

    const retro = await getCampaignRetrospective(business.id, parsed.data.campaignId)
    if (!retro) return { status: 'error', error: 'not_found' }
    if (retro.status === 'acknowledged') return { status: 'error', error: 'already_acknowledged' }

    let acknowledged
    try {
      acknowledged = await acknowledgeRetrospective({
        businessId: business.id,
        campaignId: parsed.data.campaignId,
        userId: user.id,
        patternText: buildRetrospectivePattern(retro, campaign.name),
        note: parsed.data.note ?? null,
      })
    } catch (err) {
      if (isForbidden(err)) return { status: 'error', error: 'forbidden' }
      throw err
    }
    if (acknowledged === null) return { status: 'error', error: 'already_acknowledged' }

    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}`, 'page')
    return { status: 'acknowledged' }
  } catch {
    // TODO(logger): log the swallowed error once the project logger lands (CLAUDE.md — 'we'll add this later').
    return { status: 'error', error: 'generic' }
  }
}
