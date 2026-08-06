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
const HUMAN_AUTHORED_BONUS = 5
const MS_PER_DAY = 1000 * 60 * 60 * 24

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
//   kindWeight    = 15
//   repoWeight    = watched_repos.weight
//   humanAuthored = author_is_bot ? 0 : 5
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
  // §6.2 — bots are scored DOWN, never filtered out: a release cut by
  // automation for a real version is still a real ship. humanAuthored is
  // the only term that distinguishes a bot release, and it never zeroes
  // the total score by itself.
  const humanAuthored = input.isBot ? 0 : HUMAN_AUTHORED_BONUS

  const scoreInputs: ScoreInputs = { recency, substance, kindWeight, repoWeight, humanAuthored }
  const score = recency + substance + kindWeight + repoWeight + humanAuthored

  return { ...input, score, scoreInputs }
}

// ADR §6.3 — the total order that makes ties impossible BY CONSTRUCTION:
// score DESC, occurred_at DESC, external_id ASC. external_id is unique per
// business (the signals UNIQUE(business_id, source, external_id) arbiter),
// so this ordering never needs a fourth tiebreaker.
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

// §6.3 — SIGNAL-SCORING-DETERMINISTIC's production entry point: score every
// input against the SAME `now`, then apply the total order above. The same
// input set, in any input order, always produces the same OUTPUT order.
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
// first (lib/db/signals.ts's upsertSignal, permitted by E2.1's identity
// trigger) and calls this function again with the freshly-scored result —
// same signal_id, so the SAME candidate row is updated in place, never a
// second row (§6.4's chosen option; re-ingesting as a second row or
// ignoring the edit are both named losers).
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
