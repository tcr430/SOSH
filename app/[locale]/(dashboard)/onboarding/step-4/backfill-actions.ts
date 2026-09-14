'use server'

// ADR 0025 §4.2/§6.4/§6.5/§9.4/§10.3 (Session 32 I2.13) — the founder's
// ratify/discard/retry/apply-voice/decline-voice decisions over a backfill
// run, as Server Actions over the RPCs from I2.5/I2.6/I2.13. Every action
// derives its user id from supabase.auth.getUser() on the anon SERVER
// client — NEVER from form data — matching every other onboarding action in
// this folder.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMemberForUser } from '@/lib/db/business-members'
import {
  getBackfillRunById,
  ratifyBackfillRun,
  discardBackfillRun,
  resumeBackfillRun,
  transitionBackfillVoiceStatus,
} from '@/lib/db/backfill-runs'
import { getSocialAccountById } from '@/lib/db/social-accounts'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { addVariation, VoiceVariationCapError } from '@/lib/db/voice'
import type { VoiceAxes } from '@/lib/validation/voice'
import {
  ratifyBackfillRunSchema,
  discardBackfillRunSchema,
  retryBackfillRunSchema,
  applyBackfillVoiceSchema,
  declineBackfillVoiceSchema,
} from '@/lib/validation/backfill'
import type { SocialBackfillRunRow } from '@/lib/db/types'

export type BackfillActionError =
  | 'validation'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'no_op'
  | 'generic'

export type BackfillActionResult =
  | { ok: true; run: SocialBackfillRunRow }
  | { ok: false; error: BackfillActionError }

// ADR §9.4 — the same approver/is_admin gate ratify_backfill_run enforces
// server-side, replicated here for the actions (apply/decline voice) that
// never call that RPC. Membership is read via the caller's own anon/RLS
// client — never service-role — so this can never be spoofed by a business
// id the caller doesn't belong to.
async function requireApproverOrAdmin(
  runId: string,
): Promise<
  | { ok: true; userId: string; run: SocialBackfillRunRow }
  | { ok: false; error: BackfillActionError }
> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  const run = await getBackfillRunById(runId)
  if (!run) return { ok: false, error: 'not_found' }

  const member = await getMemberForUser(client, run.business_id, user.id)
  if (!member || !(member.role === 'approver' || member.is_admin)) {
    return { ok: false, error: 'forbidden' }
  }

  return { ok: true, userId: user.id, run }
}

// ADR §6.4 — discard/retry accept any active member, not just approver/admin
// (discard_backfill_run's own p_user_id guard has the same shape).
async function requireActiveMember(
  runId: string,
): Promise<
  | { ok: true; userId: string; run: SocialBackfillRunRow }
  | { ok: false; error: BackfillActionError }
> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'unauthenticated' }

  const run = await getBackfillRunById(runId)
  if (!run) return { ok: false, error: 'not_found' }

  const member = await getMemberForUser(client, run.business_id, user.id)
  if (!member) return { ok: false, error: 'forbidden' }

  return { ok: true, userId: user.id, run }
}

export async function ratifyBackfillRunAction(input: unknown): Promise<BackfillActionResult> {
  const parsed = ratifyBackfillRunSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }

  const auth = await requireApproverOrAdmin(parsed.data.runId)
  if (!auth.ok) return auth

  const run = await ratifyBackfillRun(
    auth.userId,
    parsed.data.runId,
    parsed.data.acceptedIds,
    parsed.data.rejectedIds,
    parsed.data.accountRole,
  )
  if (!run) return { ok: false, error: 'no_op' }

  revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
  return { ok: true, run }
}

export async function discardBackfillRunAction(input: unknown): Promise<BackfillActionResult> {
  const parsed = discardBackfillRunSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }

  const auth = await requireActiveMember(parsed.data.runId)
  if (!auth.ok) return auth

  const run = await discardBackfillRun(parsed.data.runId, auth.userId)
  if (!run) return { ok: false, error: 'no_op' }

  revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
  return { ok: true, run }
}

// ADR §6.5 — resumes on the SAME run row (resume_backfill_run), never a new
// run — a fresh run would re-extract everything under a new import_run_id
// and double the memory.
export async function retryBackfillRunAction(input: unknown): Promise<BackfillActionResult> {
  const parsed = retryBackfillRunSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }

  const auth = await requireActiveMember(parsed.data.runId)
  if (!auth.ok) return auth

  const run = await resumeBackfillRun(parsed.data.runId)
  if (!run) return { ok: false, error: 'no_op' }

  revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
  return { ok: true, run }
}

export async function applyBackfillVoiceAction(input: unknown): Promise<BackfillActionResult> {
  const parsed = applyBackfillVoiceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }

  const auth = await requireApproverOrAdmin(parsed.data.runId)
  if (!auth.ok) return auth

  const { run } = auth
  const stagedVoice = (run.staged_voice ?? {}) as { voice_axes?: VoiceAxes }
  if (!stagedVoice.voice_axes) return { ok: false, error: 'no_op' }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()
  const account = await getSocialAccountById(serviceClient, run.social_account_id)

  try {
    let appliedTo: string
    if (parsed.data.accountRole === 'brand') {
      await upsertBrandVoice(serviceClient, {
        business_id: run.business_id,
        voice_axes: stagedVoice.voice_axes,
        tone: parsed.data.tone,
        keywords: parsed.data.keywords,
        avoid_words: parsed.data.avoidWords,
        writing_examples: parsed.data.writingExamples,
      })
      appliedTo = 'brand_voices'
    } else {
      const name = account.platform_display_name ?? account.platform_username
      const variation = await addVariation({
        businessId: run.business_id,
        name,
        voiceAxes: stagedVoice.voice_axes,
      })
      appliedTo = variation.id
    }

    const updated = await transitionBackfillVoiceStatus(
      parsed.data.runId,
      ['pending', 'refused_cap', 'failed'],
      'applied',
      appliedTo,
    )
    if (!updated) return { ok: false, error: 'no_op' }

    revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
    return { ok: true, run: updated }
  } catch (err) {
    const nextStatus = err instanceof VoiceVariationCapError ? 'refused_cap' : 'failed'
    const updated = await transitionBackfillVoiceStatus(parsed.data.runId, ['pending'], nextStatus)
    if (!updated) return { ok: false, error: 'no_op' }
    return { ok: true, run: updated }
  }
}

export async function declineBackfillVoiceAction(input: unknown): Promise<BackfillActionResult> {
  const parsed = declineBackfillVoiceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }

  const auth = await requireApproverOrAdmin(parsed.data.runId)
  if (!auth.ok) return auth

  const run = await transitionBackfillVoiceStatus(
    parsed.data.runId,
    ['pending', 'refused_cap', 'failed'],
    'declined',
  )
  if (!run) return { ok: false, error: 'no_op' }

  revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
  return { ok: true, run }
}
