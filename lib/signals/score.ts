// ADR 0020 §6 — Stage B's deterministic scorer. Zero LLM calls, zero
// embeddings (§6.5 / SIGNAL-NO-EMBEDDINGS): GitHub supplies stable release
// identity for free, so dedup is an exact key, never a similarity threshold.

import type { SignalCandidateInsert, SignalCandidateRow } from '@/lib/db/types'
import { upsertSignalCandidate } from '@/lib/db/signal-candidates'

// §6.6 — a named TERM, not folded into a base value: v1 has one signal
// kind, but writing it this way means adding a second kind later is a table
// of weights, not a re-derivation of the formula. Recorded as a deliberate
// placeholder, not a free variable to tune.
const KIND_WEIGHT = 15

const RECENCY_WINDOW_DAYS = 14
const RECENCY_MAX = 40
const SUBSTANCE_TARGET_CHARS = 1200
const SUBSTANCE_MAX = 30
const MS_PER_DAY = 1000 * 60 * 60 * 24

// ADR 0023 §5.1.1 (Session 30 G1b.6) — §6.6's own precedent applied a
// second time: humanAuthored becomes table-driven by kind, exactly the way
// KIND_WEIGHT was already written as a named term rather than folded into
// the base formula, anticipating this. 'release' keeps its original
// isBot-gated bonus; 'article' is a CONSTANT 0 — there is no reliable
// bot-authorship signal for third-party news prose (unlike a GitHub
// release's author.type), and author_is_bot stays false on every rss row
// regardless (see the comment on ScorableSignal.kind below for why setting
// it true is rejected).
const HUMAN_AUTHORED_BONUS: Record<'release' | 'article', number> = {
  release: 5,
  article: 0,
}

export interface ScoreInputs {
  recency: number
  substance: number
  kindWeight: number
  repoWeight: number
  humanAuthored: number
}

export interface ScorableSignal {
  externalId: string
  occurredAt: string
  bodyLen: number
  isBot: boolean
  // watched_repos.weight, 0..10, constant 10 in v1 (§6.1) — passed in by the
  // caller, never read from a table by this file: this module has no DB
  // dependency of its own for the pure scoring half.
  repoWeight: number
  // ADR 0023 §5.1.1 (Session 30 G1b.6) — selects the HUMAN_AUTHORED_BONUS
  // row. 'article' rows (rss) MUST keep isBot=false regardless of this
  // field's value — author_is_bot is a named deterministic input to Stage
  // D's sensitivity rule (ADR 0021 §4.4) and is joined for exactly that
  // purpose (lib/db/signal-candidates.ts:41). Setting it true to force
  // humanAuthored to zero locally would corrupt a SHARED column for a
  // local scoring effect — precisely the coupling ADR 0020 §6.3's
  // determinism guarantee exists to prevent. kind is the correct, isolated
  // lever for this; isBot is not.
  kind: 'release' | 'article'
}

export interface ScoredSignal extends ScorableSignal {
  score: number
  scoreInputs: ScoreInputs
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// ADR §6.1 — the formula, verbatim:
//   score = recency + substance + kindWeight + repoWeight + humanAuthored
//   recency       = floor(40 × max(0, 1 − ageDays / 14))
//   substance     = floor(30 × clamp(bodyLen / 1200, 0, 1))
//   kindWeight    = 15 — FIXED for both kinds (ADR 0023 §5.1.1: do not
//                   tune it per kind; it is inert by construction, since
//                   github and rss are scored and ranked within their own
//                   reserved shortlist slots — G1b.7 — so a constant
//                   shared across kinds cancels out of every comparison
//                   actually made)
//   repoWeight    = watched_repos.weight / watched_feeds.weight, same 0..10
//                   range for both sources
//   humanAuthored = HUMAN_AUTHORED_BONUS[kind], gated by isBot for
//                   'release' only — see HUMAN_AUTHORED_BONUS above
//
// Ceilings (ADR §5.1.1): 100 for release (40+30+15+10+5), 95 for article
// (40+30+15+10+0) — a 5-point gap that is DELIBERATE and PERMANENT. An
// article can never outrank an otherwise-identical human-cut release.
// score.test.ts asserts this explicitly.
//
// `now` is a PARAMETER, never read inside this function — a `Date.now()`
// call here would make the same fixture score differently depending on
// when the test runs, silently defeating §6.3's determinism guarantee even
// though every test would still pass on the day it was written.
export function scoreSignal(input: ScorableSignal, now: Date): ScoredSignal {
  const occurredMs = new Date(input.occurredAt).getTime()
  const ageDays = (now.getTime() - occurredMs) / MS_PER_DAY

  const recency = Math.floor(RECENCY_MAX * Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS))
  const substance = Math.floor(SUBSTANCE_MAX * clamp01(input.bodyLen / SUBSTANCE_TARGET_CHARS))
  const kindWeight = KIND_WEIGHT
  const repoWeight = input.repoWeight
  // §6.2 / ADR 0023 §5.1.1 — bots are scored DOWN, never filtered out: a
  // release cut by automation for a real version is still a real ship.
  // humanAuthored is the only term that distinguishes a bot release, and
  // it never zeroes the total score by itself. For 'article', isBot is
  // never consulted at all — the bonus is a flat 0 regardless of its
  // value, per HUMAN_AUTHORED_BONUS.article above.
  const humanAuthored = input.kind === 'release' ? (input.isBot ? 0 : HUMAN_AUTHORED_BONUS.release) : HUMAN_AUTHORED_BONUS.article

  const scoreInputs: ScoreInputs = { recency, substance, kindWeight, repoWeight, humanAuthored }
  const score = recency + substance + kindWeight + repoWeight + humanAuthored

  return { ...input, score, scoreInputs }
}

// ADR §6.3 — the total order that makes ties impossible BY CONSTRUCTION:
// score DESC, occurred_at DESC, external_id ASC. external_id is unique per
// business (the signals UNIQUE(business_id, source, external_id) arbiter),
// so this ordering never needs a fourth tiebreaker.
//
// [Session 27-D · D4, MINOR-4] This is a SCORING-SIDE utility — its order is
// NOT the feed order. §13.1's `ORDER BY score DESC, occurred_at DESC, id ASC`
// (signal_candidates_feed_idx) is authoritative for anything read from
// signal_candidates; that contract breaks ties on `id`, this one on
// `external_id` — both deterministic, but they can order an exact tie
// differently. Currently harmless only because no production caller reads
// this function's output as a feed (see the "Session 28 entry point" note
// below) — do not import this for anything that renders to a user as feed
// order.
//
// [Session 27-D · D4, A-6] KEPT, not dead: no production caller today outside
// scoreAndSortSignals (below), which is itself the ADR 0021 / Session 28
// entry point named there. This function is the total-order building block
// that SIGNAL-SCORING-DETERMINISTIC's shuffled-copy proof (score.test.ts:
// 107-122) exercises directly.
export function sortScoredSignals(signals: ScoredSignal[]): ScoredSignal[] {
  return [...signals].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const occurredDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    if (occurredDiff !== 0) return occurredDiff
    if (a.externalId < b.externalId) return -1
    if (a.externalId > b.externalId) return 1
    return 0
  })
}

// §6.3 — SIGNAL-SCORING-DETERMINISTIC's shuffled-copy proof runs through
// this function (score.test.ts:107-122): score every input against the SAME
// `now`, then apply the total order above. The same input set, in any input
// order, always produces the same OUTPUT order.
//
// [Session 27-D · D4, A-6] KEPT, not dead: this has no production caller
// today — the orchestrator calls scoreSignal per-signal and never sorts in
// memory (the DB does the ordering, per §13.1) — but it is the executed
// proof of SIGNAL-SCORING-DETERMINISTIC and the entry point ADR 0021 /
// Session 28 is expected to consume for any in-memory batch-scoring path
// that needs a deterministic order before persistence. Deleting it would
// delete that constraint's only proof.
export function scoreAndSortSignals(inputs: ScorableSignal[], now: Date): ScoredSignal[] {
  return sortScoredSignals(inputs.map((input) => scoreSignal(input, now)))
}

// §6.4 — the write half of Stage B: persists a scored signal through the
// guarded upsert (ON CONFLICT (signal_id) DO UPDATE ... WHERE status =
// 'new', lib/db/signal-candidates.ts / the upsert_signal_candidate RPC).
// A `null` return is the guard's no-op signal — the candidate exists but was
// already dismissed — never an error and never a reason to retry.
//
// Edit handling (§6.4): when a poller tick re-ingests a release whose
// content_hash changed, the caller re-writes signals' content columns
// first (lib/db/signals.ts's updateSignalContent, permitted by E2.1's
// identity trigger — [Session 27-D · D4, MINOR-3] this citation previously
// named upsertSignal, a function the orchestrator never calls; see
// orchestrator.ts:134 for the actual call site) and calls this function
// again with the freshly-scored result — same signal_id, so the SAME
// candidate row is updated in place, never a second row (§6.4's chosen
// option; re-ingesting as a second row or ignoring the edit are both named
// losers).
export async function upsertScoredCandidate(
  businessId: string,
  signalId: string,
  scored: ScoredSignal,
): Promise<SignalCandidateRow | null> {
  const insert: SignalCandidateInsert = {
    business_id: businessId,
    signal_id: signalId,
    score: scored.score,
    // score_inputs is a fixed-shape ScoreInputs, but SignalCandidateInsert's
    // column type is the open Record<string, unknown> every jsonb column
    // uses (lib/db/types.ts's own convention) — a named interface has no
    // index signature, so it needs an explicit widening here, not a defect.
    score_inputs: scored.scoreInputs as unknown as Record<string, unknown>,
    occurred_at: scored.occurredAt,
  }
  return upsertSignalCandidate(insert)
}
