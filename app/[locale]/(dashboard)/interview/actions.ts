'use server'

// ADR 0029 §2.5, §5.3, §5.4, §8.4-§8.6, §9.5 (Session 35 M2.9) — the founder interview's Server Actions.
// Every action derives its user id from supabase.auth.getUser() on the anon SERVER client — NEVER from
// client-supplied input — matching every other action in this app (the step-4/backfill-actions.ts
// precedent). Zod validates every client-supplied field first (lib/validation/interview.ts); no schema
// there, and no argument object built here, ever carries a governance field. The service-role RPCs
// (lib/db/founder-interview-*.ts, lib/memory/interview.ts) are the real enforcement — these pre-checks are
// UX/defence-in-depth, except where noted (retryExtraction).

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { CAPABILITIES, hasCapability, resolveMemberContext } from '@/lib/members/capabilities'
import {
  createInterviewRound,
  FounderInterviewRpcError,
  getInterviewRoundById,
  skipInterviewRound,
  snoozeInterview,
  submitInterviewRound,
} from '@/lib/db/founder-interview-rounds'
import { listInterviewCooldownRows, saveInterviewAnswer, skipInterviewAnswer } from '@/lib/db/founder-interview-answers'
import type {
  CreateInterviewRoundResult,
  SaveInterviewAnswerResult,
  SkipInterviewAnswerResult,
  SkipInterviewRoundResult,
  SnoozeInterviewResult,
  SubmitInterviewRoundResult,
} from '@/lib/db/types'
import { ratifyInterviewCandidates, type RatifyInterviewRoundResult } from '@/lib/memory/interview'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { computeSlotThinness } from '@/lib/interview/thinness'
import { selectQuestions } from '@/lib/interview/select'
import { INTERVIEW_BANK, INTERVIEW_BANK_SIZE, INTERVIEW_BANK_VERSION } from '@/lib/interview/bank'
import { extractInterviewRound } from '@/lib/interview/extract'
import { mentionsPerformanceClaim } from '@/lib/interview/lexicon'
import {
  ratifyInterviewRoundSchema,
  roundIdSchema,
  saveInterviewAnswerSchema,
  skipInterviewAnswerSchema,
  type RatifyInterviewRoundInput,
} from '@/lib/validation/interview'

export type InterviewActionError = 'unauthenticated' | 'not_found' | 'forbidden' | 'validation' | 'performance_claim' | 'generic'
type ActionResult<T> = { ok: true; result: T } | { ok: false; error: InterviewActionError }

const INTERVIEW_PAGE = '/[locale]/(dashboard)/interview'

async function getAuthedUserId(client: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: { user } } = await client.auth.getUser()
  return user?.id ?? null
}

/** Author-level = editor or approver, owner resolves as approver (ADR 0029 §2.5). UX pre-check only. */
async function requireAuthor(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; error: InterviewActionError }> {
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }
  const business = await getBusinessForUser(client, userId)
  if (!business) return { ok: false, error: 'not_found' }
  const member = await getMemberForUser(client, business.id, userId)
  const ctx = resolveMemberContext(business, userId, member)
  if (!hasCapability(ctx, CAPABILITIES.AUTHOR)) return { ok: false, error: 'forbidden' }
  return { ok: true, userId, businessId: business.id }
}

async function runRpc<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, result: await fn() }
  } catch (err) {
    if (err instanceof FounderInterviewRpcError) {
      if (err.code === '42501') return { ok: false, error: 'forbidden' }
      if (err.code === '22023') return { ok: false, error: 'validation' }
    }
    throw err
  }
}

// §5.1 — Start: the business's own selection, computed HERE (never client-supplied), then handed to the
// create RPC. `nothing_thin` is a local sentinel (the selection yielded < 5 questions) — the ADR's "nothing
// thin" card state (§8.2), never reaching create_interview_round at all.
export type StartInterviewRoundOutcome = CreateInterviewRoundResult | { outcome: 'nothing_thin' }

export async function startInterviewRoundAction(): Promise<ActionResult<StartInterviewRoundOutcome>> {
  const client = await createClient()
  const auth = await requireAuthor(client)
  if (!auth.ok) return auth

  const now = new Date()
  const [rows, cooldowns] = await Promise.all([
    readInterviewSlotRows(client, auth.businessId, now),
    listInterviewCooldownRows(client, auth.businessId, INTERVIEW_BANK_SIZE),
  ])
  const thinness = computeSlotThinness(rows, now)
  const selected = selectQuestions({ thinness, cooldowns, now, bank: INTERVIEW_BANK })
  if (selected.length === 0) return { ok: true, result: { outcome: 'nothing_thin' } }

  const result = await runRpc(() =>
    createInterviewRound({
      userId: auth.userId,
      businessId: auth.businessId,
      questions: selected.map((q) => ({ questionKey: q.questionKey, slotType: q.type, slotCategory: q.slot, bankVersion: INTERVIEW_BANK_VERSION })),
    }),
  )
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

export async function saveInterviewAnswerAction(input: unknown): Promise<ActionResult<SaveInterviewAnswerResult>> {
  const parsed = saveInterviewAnswerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const result = await runRpc(() => saveInterviewAnswer({ userId, answerId: parsed.data.answerId, text: parsed.data.text }))
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

export async function skipInterviewQuestionAction(input: unknown): Promise<ActionResult<SkipInterviewAnswerResult>> {
  const parsed = skipInterviewAnswerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const result = await runRpc(() => skipInterviewAnswer({ userId, answerId: parsed.data.answerId }))
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

export async function skipInterviewRoundAction(input: unknown): Promise<ActionResult<SkipInterviewRoundResult>> {
  const parsed = roundIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const result = await runRpc(() => skipInterviewRound({ userId, roundId: parsed.data.roundId }))
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

// §5.3 — Submit hands the round to the M2.8 orchestrator via after() (best-effort; the 10-minute re-claim
// and the sweep's 7-day failed transition are the safety net, §5.3). The kick-off is safe without its own
// membership check: it only ever fires for the roundId THIS call just authorised via submit_interview_round
// (which derives business_id from the round and checks author-level membership itself).
export async function submitInterviewRoundAction(input: unknown): Promise<ActionResult<SubmitInterviewRoundResult>> {
  const parsed = roundIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const result = await runRpc(() => submitInterviewRound({ userId, roundId: parsed.data.roundId }))
  if (result.ok && result.result.outcome === 'ok') {
    const roundId = result.result.roundId
    after(() => {
      void extractInterviewRound(roundId)
    })
  }
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

// claim_interview_extraction takes NO user id and checks NO membership (ADR 0029 §7.2 — it is meant to be
// entered only by a caller that already authorised the round, i.e. submit's own kick-off above). This action
// is a DIRECT client trigger, so unlike submit it MUST check membership itself before firing the after() —
// this is the real security boundary here, not defence in depth.
export async function retryInterviewExtractionAction(input: unknown): Promise<ActionResult<{ outcome: 'retrying' | 'not_open' }>> {
  const parsed = roundIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const round = await getInterviewRoundById(client, parsed.data.roundId)
  if (!round) return { ok: false, error: 'not_found' }
  const member = await getMemberForUser(client, round.business_id, userId)
  if (!member || !(member.role === 'editor' || member.role === 'approver')) return { ok: false, error: 'forbidden' }
  if (round.status !== 'extraction_failed') return { ok: true, result: { outcome: 'not_open' } }

  after(() => {
    void extractInterviewRound(round.id)
  })
  revalidatePath(INTERVIEW_PAGE, 'page')
  return { ok: true, result: { outcome: 'retrying' } }
}

export async function snoozeInterviewAction(): Promise<ActionResult<SnoozeInterviewResult>> {
  const client = await createClient()
  const auth = await requireAuthor(client)
  if (!auth.ok) return auth

  const result = await runRpc(() => snoozeInterview({ userId: auth.userId, businessId: auth.businessId }))
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}

// §8.4/§8.5 — Ratify: role approver OR is_admin (ADR §2.5's recorded difference from hasCapability(APPROVE),
// which admits role === 'approver' only — mirrors ratify_backfill_run's own predicate, copied, not reused).
// A brand/audience EDIT is re-run through the §4.7 D-4 filter HERE (owed by the caller per lib/memory/
// interview.ts's own comment): a match rejects the WHOLE call before the RPC runs, since ratify has no
// partial-accept semantics — every candidate is decided in one atomic transaction.
export async function ratifyInterviewRoundAction(input: unknown): Promise<ActionResult<RatifyInterviewRoundResult>> {
  const parsed = ratifyInterviewRoundSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const { roundId, decisions }: RatifyInterviewRoundInput = parsed.data

  const client = await createClient()
  const userId = await getAuthedUserId(client)
  if (!userId) return { ok: false, error: 'unauthenticated' }

  const round = await getInterviewRoundById(client, roundId)
  if (!round) return { ok: false, error: 'not_found' }
  const member = await getMemberForUser(client, round.business_id, userId)
  if (!member || !(member.role === 'approver' || member.is_admin)) return { ok: false, error: 'forbidden' }

  for (const d of decisions) {
    if (d.decision === 'accept' && d.type !== 'evidence' && d.text !== undefined && mentionsPerformanceClaim(d.text)) {
      return { ok: false, error: 'performance_claim' }
    }
  }

  const result = await runRpc(() => ratifyInterviewCandidates({ userId, roundId, decisions }))
  if (result.ok) revalidatePath(INTERVIEW_PAGE, 'page')
  return result
}
