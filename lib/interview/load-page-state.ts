import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAnswersForRound, listInterviewCooldownRows } from '@/lib/db/founder-interview-answers'
import { getLatestInterviewRound } from '@/lib/db/founder-interview-rounds'
import { listInterviewCandidatesForRound } from '@/lib/memory/interview'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { INTERVIEW_COOLDOWN_ROW_CAP } from './constants'
import { canAuthorInterview, canRatifyInterview, computeInterviewPageState, INTERVIEW_TERMINAL_STATUSES, isInterviewCardState, type InterviewPageState } from './page-state'
import type { MemberCapabilityContext } from '@/lib/members/capabilities'
import { computeSlotThinness } from './thinness'

// ADR 0029 §8.1 (Session 35 M2.10) — the ONE place that gathers what computeInterviewPageState needs and calls
// it. Three call sites share this: the /interview page, the dashboard card, and the layout's nav badge — each
// is its own Server Component render, so each calls this independently (no cross-request cache); the reads
// inside are bounded and cheap (§9.5), and only the ones the CURRENT round status actually needs are made:
// answers only for an 'open' round, candidates only for 'awaiting_ratification' AND a ratifier, the thinness/
// cooldown selection inputs only when there is no non-terminal round to show instead (computeInterviewPageState
// never reaches selectQuestions() otherwise).
//
// Session 35-D D7 (Reviewer MINOR-9): the dashboard layout (the nav badge), the campaigns card and the /interview page each
// called this independently, so ONE request could read up to 3 x 500 memory rows plus the cooldown rows several times. It is now
// memoised PER REQUEST with React's cache(), keyed on PRIMITIVES only (business id, snooze instant, ratifier flag): the layout,
// the card and the page of one request share ONE load. The call sites' signatures are unchanged.
//   - The first caller's `client` does the reads. Every client in a request is the same user's session-scoped anon client, so
//     RLS gives each the same rows; a client is deliberately NOT part of the key (it is an object, so it never matches).
//   - cache() memoises for the duration of one server render/request only. A Server Action's revalidatePath, or the panel's
//     router.refresh() polling, is a NEW request and reads fresh state.
//   - The promise is shared, so a rejection is shared too: within a request every caller sees the same failure, not a retry storm.
const requestSlot = cache((businessId: string, snoozedUntil: string | null, isRatifier: boolean) => ({
  key: `${businessId}|${snoozedUntil ?? ''}|${isRatifier}`,
  promise: null as Promise<InterviewPageState> | null,
}))

export function loadInterviewPageState(
  client: SupabaseClient,
  business: { id: string; interview_snoozed_until?: string | null },
  isRatifier: boolean,
): Promise<InterviewPageState> {
  const slot = requestSlot(business.id, business.interview_snoozed_until ?? null, isRatifier)
  slot.promise ??= loadInterviewPageStateUncached(client, business, isRatifier)
  return slot.promise
}

async function loadInterviewPageStateUncached(
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

// ADR 0029 §5.5 (Session 35-D D7, MINOR-2) — the dashboard layout's nav badge: the same role rule as the card (authors: due /
// open; ratifiers: awaiting ratification), and a member with NEITHER role (a viewer) skips the load entirely. Extracted from the
// layout so the rule is executed by a test rather than living untested inside an async Server Component; the load it calls is
// request-cached, so the card and the /interview page of the same request share it.
export async function loadInterviewBadge(
  client: SupabaseClient,
  business: { id: string; interview_snoozed_until?: string | null },
  member: MemberCapabilityContext,
): Promise<boolean> {
  if (!canAuthorInterview(member) && !canRatifyInterview(member)) return false
  return isInterviewCardState(await loadInterviewPageState(client, business, canRatifyInterview(member)), member)
}
