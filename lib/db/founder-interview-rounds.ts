import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClaimInterviewExtractionResult,
  CreateInterviewRoundResult,
  FounderInterviewQuestionInput,
  FounderInterviewRoundRow,
  ReconcileInterviewSpendResult,
  SkipInterviewRoundResult,
  SnoozeInterviewResult,
  SubmitInterviewRoundResult,
  SweepInterviewDataResult,
} from './types'
import { INTERVIEW_ROUNDS_LIMIT } from '@/lib/interview/constants'
import { getErrorMessage } from './utils'

// ADR 0029 §5, §7.2, §9 (Session 35 M2.4) — the founder_interview_rounds data layer. ONE file per table.
//
// TWO kinds of function, deliberately different:
//
//  1. RPC WRAPPERS (create / submit / skip / snooze / claim / reconcile). Every write to this table is a
//     SERVICE-ROLE SECURITY DEFINER RPC (the table has no authenticated write grant and no write policy — §9.2), so
//     these take NO `client` parameter and acquire the service-role client themselves by LAZY import: the service-role
//     client never reaches a bundle that does not need it, and a caller can never pass an authenticated client and
//     trigger a silent permission failure (CLAUDE.md "Database access").
//
//     `userId` MUST come from `supabase.auth.getUser()` on the anon server client — NEVER a form field. Every one of
//     these RPCs trusts p_user_id only because EXECUTE is granted to service_role alone (ADR 0029 §2.5). No wrapper
//     here takes, or forwards, a governance value: the argument objects below are the whole of what crosses.
//
//     A typed outcome is a VALUE (`too_soon`, `not_open`, `ceiling`...). An AUTHORISATION failure is not: the RPC raises
//     42501 and the wrapper throws a FounderInterviewRpcError carrying that code, so a caller can never mistake "not
//     allowed" for a result.
//
//  2. MEMBER-FACING READS. They take the CALLER'S client so RLS applies (the table has a member-scoped SELECT policy
//     and no other), and every list is BOUNDED with an explicit ORDER BY that matches an index. A worker that must read
//     a round under service-role gets a SEPARATELY NAMED function (M2.8), never an optional client defaulting to it.

export class FounderInterviewRpcError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'FounderInterviewRpcError'
    this.code = code
  }
}

// The ONE place the interview data layer reaches the service-role client (lazy import, so it never reaches a bundle that does
// not need it). founder-interview-answers.ts and memory-interview.ts go through this, never through their own import — a
// source scan in founder-interview-answers.test.ts holds them to it. Shared, not exported from the barrel.
export async function getInterviewServiceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  return createServiceRoleClient()
}

// Shared with founder-interview-answers.ts (the answer RPCs are the same shape). Not exported from the barrel.
export async function callInterviewRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const client = await getInterviewServiceClient()
  const { data, error } = await client.rpc(fn, args)
  if (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined
    throw new FounderInterviewRpcError(getErrorMessage(error), code)
  }
  return data as T
}

// §5.1 — Start. `questions` are the 5..8 the pure selection (M2.7) chose. The RPC verifies userId's author-level
// membership of businessId FIRST, re-checks the 30-day rule, and returns `too_soon` / `round_open` as values.
export async function createInterviewRound(args: {
  userId: string
  businessId: string
  questions: FounderInterviewQuestionInput[]
}): Promise<CreateInterviewRoundResult> {
  return callInterviewRpc<CreateInterviewRoundResult>('create_interview_round', {
    p_user_id: args.userId,
    p_business_id: args.businessId,
    p_questions: args.questions,
  })
}

// §5.2 — open -> submitted (requires at least one answered question: `no_answers` otherwise).
export async function submitInterviewRound(args: { userId: string; roundId: string }): Promise<SubmitInterviewRoundResult> {
  return callInterviewRpc<SubmitInterviewRoundResult>('submit_interview_round', {
    p_user_id: args.userId,
    p_round_id: args.roundId,
  })
}

// §5.8 — "Skip this round": open -> skipped; its pending questions take the 60-day cooldown.
export async function skipInterviewRound(args: { userId: string; roundId: string }): Promise<SkipInterviewRoundResult> {
  return callInterviewRpc<SkipInterviewRoundResult>('skip_interview_round', {
    p_user_id: args.userId,
    p_round_id: args.roundId,
  })
}

// §5.8 — "Not now": hide the card for 7 days. Takes the business id (the businesses row IS the row written); the RPC
// verifies userId's membership of it first.
export async function snoozeInterview(args: { userId: string; businessId: string }): Promise<SnoozeInterviewResult> {
  return callInterviewRpc<SnoozeInterviewResult>('snooze_interview', {
    p_user_id: args.userId,
    p_business_id: args.businessId,
  })
}

// §7.2 — THE RESERVATION. One conditional UPDATE on the existing round row: `claimed`, or a TYPED refusal
// (`not_claimable` | `attempts` | `ceiling` | `not_found`) — never a bare null. No user id: it is called by the
// extraction orchestrator under service-role, and the RPC derives the business from the round.
export async function claimInterviewExtraction(args: { roundId: string }): Promise<ClaimInterviewExtractionResult> {
  return callInterviewRpc<ClaimInterviewExtractionResult>('claim_interview_extraction', { p_round_id: args.roundId })
}

// §7.2 — replace the reserved 10 cents with the ACTUAL ai_usage cost on EVERY outcome, failure included. A failure
// MUST carry an error code and a success MUST NOT (the RPC raises 22023 otherwise — the type below makes the wrong
// combination unrepresentable here first). `attempt` is the number the claim returned: a late reconcile from a superseded
// attempt matches nothing (not_extracting). ORDER CONTRACT: reconcile a success BEFORE write_interview_candidates — the writer
// moves the round out of 'extracting', after which reconcile is not_extracting.
export async function reconcileInterviewSpend(
  args:
    | { roundId: string; attempt: number; actualCents: number; outcome: 'succeeded' }
    | { roundId: string; attempt: number; actualCents: number; outcome: 'failed'; errorCode: string },
): Promise<ReconcileInterviewSpendResult> {
  return callInterviewRpc<ReconcileInterviewSpendResult>('reconcile_interview_spend', {
    p_round_id: args.roundId,
    p_actual_cents: args.actualCents,
    p_outcome: args.outcome,
    p_error_code: args.outcome === 'failed' ? args.errorCode : null,
    p_attempt: args.attempt,
  })
}

// §5.4 / §6.3 — ONE run of the daily retention sweep: stuck rounds -> failed, expiry, redaction of answer text and grounding
// spans 30 days after a round closes, deletion of a retired candidate 30 days after retirement. Service-role, no arguments,
// no user id and no business id: it is not tied to any member. Bounded per run inside the RPC (500 rows a step), so it is
// safe to call on every cron tick. The cron route (M2.9) is its sole caller.
export async function sweepInterviewData(): Promise<SweepInterviewDataResult> {
  return callInterviewRpc<SweepInterviewDataResult>('sweep_interview_data', {})
}

// §9.5 — a business's rounds, NEWEST FIRST, for the round list and the due computation (§5.1). BOUNDED (limit 12) and
// ordered by created_at DESC on founder_interview_rounds_business_created_idx (business_id, created_at DESC). The
// caller's client, so RLS scopes it to the member's businesses.
export async function listInterviewRoundsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = INTERVIEW_ROUNDS_LIMIT,
): Promise<FounderInterviewRoundRow[]> {
  const { data, error } = await client
    .from('founder_interview_rounds')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as FounderInterviewRoundRow[] | null) ?? []
}

// §8.1 — "the current round" the /interview page and the dashboard card render: the business's MOST RECENT round, in any
// status (a just-ratified or just-skipped round still owns the screen for its confirmation). The one-open-round
// partial UNIQUE (M2.3) guarantees there is at most one NON-terminal round, so "most recent" is never ambiguous about
// which round is live. A limit-1 read of the same indexed, ordered list above.
export async function getLatestInterviewRound(client: SupabaseClient, businessId: string): Promise<FounderInterviewRoundRow | null> {
  const rows = await listInterviewRoundsForBusiness(client, businessId, 1)
  return rows[0] ?? null
}
