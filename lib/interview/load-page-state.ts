import type { SupabaseClient } from '@supabase/supabase-js'
import { listAnswersForRound, listInterviewCooldownRows } from '@/lib/db/founder-interview-answers'
import { getLatestInterviewRound } from '@/lib/db/founder-interview-rounds'
import { listInterviewCandidatesForRound } from '@/lib/memory/interview'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { INTERVIEW_COOLDOWN_ROW_CAP } from './constants'
import { computeInterviewPageState, INTERVIEW_TERMINAL_STATUSES, type InterviewPageState } from './page-state'
import { computeSlotThinness } from './thinness'

// ADR 0029 §8.1 (Session 35 M2.10) — the ONE place that gathers what computeInterviewPageState needs and calls
// it. Three call sites share this: the /interview page, the dashboard card, and the layout's nav badge — each
// is its own Server Component render, so each calls this independently (no cross-request cache); the reads
// inside are bounded and cheap (§9.5), and only the ones the CURRENT round status actually needs are made:
// answers only for an 'open' round, candidates only for 'awaiting_ratification' AND a ratifier, the thinness/
// cooldown selection inputs only when there is no non-terminal round to show instead (computeInterviewPageState
// never reaches selectQuestions() otherwise).
export async function loadInterviewPageState(
  client: SupabaseClient,
  business: { id: string; interview_snoozed_until?: string | null },
  isRatifier: boolean,
): Promise<InterviewPageState> {
  const now = new Date()
  const round = await getLatestInterviewRound(client, business.id)

  let answers: Awaited<ReturnType<typeof listAnswersForRound>> = []
  if (round?.status === 'open' || round?.status === 'awaiting_ratification') {
    answers = await listAnswersForRound(client, round.id)
  }

  const candidates =
    round?.status === 'awaiting_ratification' && isRatifier ? await listInterviewCandidatesForRound(client, answers.map((a) => a.id)) : null

  const needsSelection = round === null || INTERVIEW_TERMINAL_STATUSES.has(round.status)
  const [slotRows, cooldownRows] = needsSelection
    ? await Promise.all([readInterviewSlotRows(client, business.id, now), listInterviewCooldownRows(client, business.id, now, INTERVIEW_COOLDOWN_ROW_CAP)])
    : [[], []]

  return computeInterviewPageState({
    round,
    now,
    thinness: computeSlotThinness(slotRows, now),
    cooldowns: cooldownRows,
    snoozedUntil: business.interview_snoozed_until ?? null,
    answers,
    isRatifier,
    candidates,
  })
}
