import { INTERVIEW_EXTRACTION_STALE_MINUTES } from './constants'

// ADR 0029 §5.3 (Session 35-D D6, Reviewer MAJOR-2) — when is a submitted / extracting round STALE, i.e. its extraction was
// probably lost (the after() callback never ran or never finished)? One PURE rule, shared by the retry Server Action's gate and
// the page state, so the screen never offers Retry the action would refuse, and the action never fires a pointless call.
//
// It mirrors claim_interview_extraction (20260925120000), whose accepted statuses are:
//   'submitted'                                          -- a round whose after() never claimed it
//   'extraction_failed'                                  -- a failed attempt (retryable at once; NOT judged here)
//   'extracting' AND claimed_at < now() - interval '10 minutes'   -- a claim that went quiet (STRICT less-than)
// The claim clock is claimed_at, or submitted_at for a round that was never claimed. A missing clock is NOT stale: the SQL's
// comparison against NULL is not true either, and an unknown age must not offer a retry the RPC would refuse.
//
// THIS IS NEVER THE GUARD. The claim RPC re-evaluates all of it atomically in one conditional UPDATE, so a client with a wrong
// clock, or a race with the original extraction finishing, is refused there with a typed outcome. This function only decides
// whether to show Retry and whether to bother calling.

export type ExtractionClockRound = {
  status: string
  claimed_at: string | null
  submitted_at: string | null
}

export function isExtractionStale(round: ExtractionClockRound, now: Date): boolean {
  const clock = round.status === 'extracting' ? round.claimed_at : round.status === 'submitted' ? round.submitted_at : null
  if (clock === null) return false
  const ms = Date.parse(clock)
  if (!Number.isFinite(ms)) return false
  return ms < now.getTime() - INTERVIEW_EXTRACTION_STALE_MINUTES * 60 * 1000
}
