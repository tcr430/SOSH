'use server'

// ADR 0025 §4.2/§6.4/§6.5/§9.4/§10.3 (Session 32 I2.13) — the founder's
// ratify/discard/retry/apply-voice/decline-voice decisions over a backfill
// run, as Server Actions over the RPCs from I2.5/I2.6/I2.13. Every action
// derives its user id from supabase.auth.getUser() on the anon SERVER
// client — NEVER from form data — matching every other onboarding action in
// this folder.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import {
  getBackfillRunById,
  getBackfillRunsForBusiness,
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

// ADR §10.2 (Session 32 I2.14) — the panel's own bounded poll while a run is
// queued/fetching/extracting. RLS-scoped (the caller's anon client), never
// service-role: this is a plain member-facing read, same boundary as
// getBackfillRunsForBusiness itself.
export async function getBackfillRunsAction(): Promise<SocialBackfillRunRow[]> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return []

  const business = await getBusinessForUser(client, user.id)
  if (!business) return []

  return getBackfillRunsForBusiness(client, business.id)
}

// ADR §10.3 (Session 32 I2.14) — step-2 backfill mode's own read: the run's
// staged voice, scoped to the caller's own business via the member SELECT
// policy (never service-role). Returns null for a run that doesn't exist or
// belongs to a different business — never distinguishes the two, so this
// can't be used to probe which run ids exist.
export async function getBackfillRunForReviewAction(
  runId: string,
): Promise<SocialBackfillRunRow | null> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null

  const business = await getBusinessForUser(client, user.id)
  if (!business) return null

  const run = await getBackfillRunById(runId)
  if (!run || run.business_id !== business.id) return null

  return run
}

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

  const auth = await requireApproverOrAdmin(parsed.data.runId)
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

  const auth = await requireApproverOrAdmin(parsed.data.runId)
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
  // MAJOR-1/MINOR-10 (Session 32-D, D8) — voice applies ONLY to a ratified
  // run, ONLY to the role the founder declared AT ratification
  // (run.account_role — never a client-supplied field, which the Zod
  // schema above no longer even accepts). ADR §4.2/§10.3's ordering:
  // ratify first, voice after, role fixed.
  if (run.status !== 'ratified' || run.account_role == null) return { ok: false, error: 'no_op' }

  // Field-name fix (found while implementing D8): BrandVoiceOutput's model
  // field is `voiceAxes` (lib/ai/prompts/brand-voice-inference.ts), spread
  // verbatim into staged_voice by runVoiceSynthesisPass — this read a
  // snake_case `voice_axes` key that stage_backfill_voice never wrote,
  // so apply/decline could never find a real run's axes at all.
  const stagedVoice = (run.staged_voice ?? {}) as { voiceAxes?: VoiceAxes }
  if (!stagedVoice.voiceAxes) return { ok: false, error: 'no_op' }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()
  const account = await getSocialAccountById(serviceClient, run.social_account_id)

  try {
    let appliedTo: string
    if (run.account_role === 'brand') {
      await upsertBrandVoice(serviceClient, {
        business_id: run.business_id,
        voice_axes: stagedVoice.voiceAxes,
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
        voiceAxes: stagedVoice.voiceAxes,
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

  // MAJOR-1 (Session 32-D, D8) — same ratified/role-declared gate as apply.
  if (auth.run.status !== 'ratified' || auth.run.account_role == null) return { ok: false, error: 'no_op' }

  const run = await transitionBackfillVoiceStatus(
    parsed.data.runId,
    ['pending', 'refused_cap', 'failed'],
    'declined',
  )
  if (!run) return { ok: false, error: 'no_op' }

  revalidatePath('/[locale]/(dashboard)/onboarding/step-4', 'page')
  return { ok: true, run }
}
