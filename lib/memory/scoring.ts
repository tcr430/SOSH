import { differenceInDays } from 'date-fns'
import type { MemoryScope, MemoryStatus } from '@/lib/db/types'
import { MEMORY_SCORE_WEIGHTS } from './constants'
import type { ModelQueryHints } from './query-hints'

// ADR 0016 §5.2 — the task shape already known at generation time.
//
// ADR 0030 §3 (Session 36 L2.7, founder ruling A-7) NARROWS this. ADR 0024 §5.1 had added `role` and `campaignId`, and `role` was "threaded through
// even though no MemoryScope value maps to it yet"; `objective` and `audience` were the same: NO scoring term read any of the three. A field with
// no consuming term is removed (SUBSTRATE-QUERY-FIELD-CONSUMED), and ADR 0024 §5.1 is amended by name.
//
//   ModelQueryHints  what a MODEL may set — { platform } — derived from the ONE schema in ./query-hints.
//   RetrieveScope    CALLER-ONLY fields that narrow scope: `campaignId` (makes the 'campaign' scope-match branch below do real work) and
//                    `confidenceFloor` (an inclusive eligibility filter on STORED confidence, consumed by rankAndCap). Neither is in any
//                    model-facing schema.
//   MemoryQueryContext = ModelQueryHints & RetrieveScope, what the per-type retrieve* take.
//   MemoryTask / BundleRequest exist only for the cross-type bundle (L2.8): `task` is never seen by retrieve*, scoreRecord or rankAndCap.
export type RetrieveScope = {
  campaignId?: string
  confidenceFloor?: number
}

export type MemoryQueryContext = ModelQueryHints & RetrieveScope

export type MemoryTask = 'brief' | 'post' | 'plan' | 'triage'

export type BundleRequest = {
  task: MemoryTask
  hints?: ModelQueryHints
  scope?: RetrieveScope
}

type Scorable = {
  confidence: number
  recency_at: string
  scope: MemoryScope
  scope_ref: string | null
  status: MemoryStatus
  expires_at: string | null
}

// Exponential decay, halving every 30 days. 1.0 at zero age, 0.5 at 30 days,
// asymptotically approaching 0 — never negative, never silently NaN (a
// non-finite input throws rather than scoring as 0, so a bad recency_at
// value fails loudly instead of quietly sinking a record to the bottom).
const RECENCY_HALF_LIFE_DAYS = 30

export function recencyDecay(recencyAt: string, now: Date): number {
  const ageDays = differenceInDays(now, new Date(recencyAt))
  if (!Number.isFinite(ageDays)) {
    throw new Error(`recencyDecay: invalid recency_at "${recencyAt}"`)
  }
  return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS)
}

// scope/scope_ref governance-scope match against the per-call queryContext.
// 'brand' and 'contact' scopes carry no queryContext-comparable scope_ref —
// they are broadly relevant by construction, not a "no match" default.
// 'platform' and 'campaign' scopes DO have a comparable field; an unset
// scope_ref on those is a partial (not full, not zero) match — a record
// scoped to "some platform, unspecified" is more relevant than an outright
// mismatch but less certain than an exact one.
//
// ADR 0024 §5.1 (Session 31, H2.11) — the 'campaign' branch now compares
// against `queryContext.campaignId`, not `.objective`. A campaign's
// scope_ref is the campaign's id (the natural key for "specific to one
// campaign"), never its free-text objective; comparing against `.objective`
// was dead code in production — no caller ever supplied a campaignId, and
// an objective STRING was never a stand-in for a campaign's identity.
export function scopeMatch(
  record: Pick<Scorable, 'scope' | 'scope_ref'>,
  queryContext: MemoryQueryContext,
): number {
  switch (record.scope) {
    case 'brand':
      return 1
    case 'contact':
      return 0.5
    case 'platform':
      if (!record.scope_ref) return 0.5
      return record.scope_ref === queryContext.platform ? 1 : 0
    case 'campaign':
      if (!record.scope_ref) return 0.5
      return record.scope_ref === queryContext.campaignId ? 1 : 0
  }
}

export function scoreRecord(record: Scorable, queryContext: MemoryQueryContext, now: Date): number {
  return (
    MEMORY_SCORE_WEIGHTS.conf * record.confidence +
    MEMORY_SCORE_WEIGHTS.rec * recencyDecay(record.recency_at, now) +
    MEMORY_SCORE_WEIGHTS.scope * scopeMatch(record, queryContext)
  )
}

// Defense-in-depth (ADR §5.3): the B1 lib/db/memory-*.ts candidate query
// already filters status='active' and deleted_at IS NULL, but this layer
// does not blindly trust that upstream filter — a 'candidate'/'retired' row
// or an expired one is excluded here too, so retrieveRelevant is correct
// even if fed candidates from a source that didn't already filter them.
export function isEligible(record: Pick<Scorable, 'status' | 'expires_at'>, now: Date): boolean {
  if (record.status !== 'active') return false
  if (record.expires_at !== null && new Date(record.expires_at).getTime() <= now.getTime()) return false
  return true
}

// Score, rank, and hard-cap TRUNCATE (MEM-HARD-CAP). Tie-break is explicit
// and deterministic — never left to Array.sort's stability alone — so a
// higher-confidence record can never be silently dropped in favour of an
// equal-scoring lower-confidence one: ties break on confidence, then on
// recency. `cap` is the per-type ceiling (ADR §5.4); it is not adjustable
// by the caller.
export function rankAndCap<T extends Scorable>(
  candidates: T[],
  queryContext: MemoryQueryContext,
  cap: number,
  now: Date = new Date(),
): T[] {
  // The cap is a hard ceiling, never the caller's choice (L-4) — but that
  // rule only holds if a bad cap value fails loudly. `.slice(0, cap)` would
  // otherwise silently return [] for cap=0/NaN or silently drop the LAST
  // N highest-ranked survivors for a negative cap, with no error either way.
  if (!Number.isInteger(cap) || cap < 0) {
    throw new Error(`rankAndCap: cap must be a non-negative integer, got ${cap}`)
  }
  // ADR 0030 §3.2 (Session 36 L2.7) — `confidenceFloor` is CALLER-ONLY and an INCLUSIVE eligibility filter on STORED confidence: a row is eligible
  // iff confidence >= floor, so a row exactly AT the floor is admitted. It must be a finite number in [0, 1]; anything else THROWS, in the same
  // shape as the cap check above and recencyDecay's non-finite throw — a bad floor must fail loudly, not silently admit or exclude everything.
  // Its consumer is the cross-type bundle (L2.8), which sets it per task so a slot freed by an empty type never goes to filler below the floor.
  const floor = queryContext.confidenceFloor
  if (floor !== undefined && (!Number.isFinite(floor) || floor < 0 || floor > 1)) {
    throw new Error(`rankAndCap: confidenceFloor must be a finite number in [0, 1], got ${floor}`)
  }
  return candidates
    .filter(record => isEligible(record, now))
    .filter(record => floor === undefined || record.confidence >= floor)
    .map(record => ({ record, score: scoreRecord(record, queryContext, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.record.confidence - a.record.confidence ||
        new Date(b.record.recency_at).getTime() - new Date(a.record.recency_at).getTime(),
    )
    .slice(0, cap)
    .map(scored => scored.record)
}
