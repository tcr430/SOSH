import type { SupabaseClient } from '@supabase/supabase-js'
import type { FounderInterviewAnswerRow, SaveInterviewAnswerResult, SkipInterviewAnswerResult } from './types'
import { INTERVIEW_ANSWERS_LIMIT } from '@/lib/interview/constants'
import { callInterviewRpc } from './founder-interview-rounds'
import { getErrorMessage } from './utils'

// ADR 0029 §5.8, §9.2 (Session 35 M2.4) — the founder_interview_answers data layer. ONE file per table.
//
// Same two kinds of function as founder-interview-rounds.ts (read that file's header for the reasoning):
//  1. RPC WRAPPERS (save / skip) — service-role by LAZY import, no `client` parameter, `userId` from
//     supabase.auth.getUser() and never a form field. save_interview_answer and skip_interview_answer derive the
//     business from the ANSWER they look up; a caller cannot name a business at all, so no wrapper here has a
//     businessId parameter.
//  2. MEMBER-FACING READS — the CALLER'S client (RLS applies), bounded, ordered on an index.
//
// The answer text is founder personal data (§6.3): it is redacted 30 days after its round closes, and these reads
// return it as-is (NULL once redacted). Nothing here logs it.

// §9.2 — ONE conditional UPDATE, guarded on the round being 'open'. `not_open` is a VALUE (a round that was submitted
// on another tab); an authorisation failure throws a FounderInterviewRpcError with code 42501.
export async function saveInterviewAnswer(args: { userId: string; answerId: string; text: string }): Promise<SaveInterviewAnswerResult> {
  return callInterviewRpc<SaveInterviewAnswerResult>('save_interview_answer', {
    p_user_id: args.userId,
    p_answer_id: args.answerId,
    p_text: args.text,
  })
}

// §5.8 — "Skip this question". Drops any text saved earlier and stamps the cooldown clock.
export async function skipInterviewAnswer(args: { userId: string; answerId: string }): Promise<SkipInterviewAnswerResult> {
  return callInterviewRpc<SkipInterviewAnswerResult>('skip_interview_answer', {
    p_user_id: args.userId,
    p_answer_id: args.answerId,
  })
}

// §9.5 — the answers of ONE round, in question order. BOUNDED (limit 8 — a round never holds more) and ordered by
// `position`, which is founder_interview_answers_round_position_uq (round_id, position). The caller's client.
export async function listAnswersForRound(
  client: SupabaseClient,
  roundId: string,
  limit = INTERVIEW_ANSWERS_LIMIT,
): Promise<FounderInterviewAnswerRow[]> {
  const { data, error } = await client
    .from('founder_interview_answers')
    .select('*')
    .eq('round_id', roundId)
    .order('position', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as FounderInterviewAnswerRow[] | null) ?? []
}

export type InterviewCooldownRow = Pick<FounderInterviewAnswerRow, 'question_key' | 'status' | 'answered_at'>

// §3.3 / §9.5 — the COOLDOWN LOOKUP: every question this business has ANSWERED or SKIPPED, so the pure selection (M2.7)
// can leave out a key answered in the last 180 days or skipped in the last 60. `answered_at` is the cooldown clock for
// both (see skip_interview_answer). ORDER BY (question_key ASC, answered_at DESC) is exactly the column order of
// founder_interview_answers_cooldown_idx (business_id, question_key, answered_at DESC) once business_id is fixed.
//
// `limit` has NO default on purpose: §9.5 fixes it at the BANK SIZE, which M2.7 authors, so the caller passes it. It is
// still a required, explicit bound — an unbounded read is unrepresentable. The caller's client.
export async function listInterviewCooldownRows(client: SupabaseClient, businessId: string, limit: number): Promise<InterviewCooldownRow[]> {
  const { data, error } = await client
    .from('founder_interview_answers')
    .select('question_key, status, answered_at')
    .eq('business_id', businessId)
    .in('status', ['answered', 'skipped'])
    .not('answered_at', 'is', null)
    .order('question_key', { ascending: true })
    .order('answered_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as InterviewCooldownRow[] | null) ?? []
}
