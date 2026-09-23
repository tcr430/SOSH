import type { CampaignBriefContent } from '@/lib/db/types'
import type { ThreadOutput } from '@/lib/ai/prompts/formats/schemas'

// ADR 0017 §8 — the deterministic consistency pass (Tier 0, free). Two of
// the three shipped checks; nativeness is the rubric's platformNativeness
// dimension (already available via B2.2, scored per-post in generate.ts's
// hook loop / consistency call site, not duplicated here). Cross-set
// redundancy was DEFERRED behind MODE2-REDUNDANCY-UNDEFER (ADR §8 item 4,
// session-24 B2.6's STOP note); ADR 0027 §5.8 (Session 34 K2.8) un-defers it
// and discharges it in two halves — the planner's judgment over the PROPOSED
// set (half a, K2.7's reason strings) and checkSetRedundancy below over the
// GENERATED set (half b).

export interface RoleCoverageResult {
  ok: boolean
  missingOrders: number[]
}

// [type-6] — positional cross-check against the frozen brief's roleSequence.
// Each generated post is tagged with the `order` of the roleSequence entry
// it was generated FROM (assigned before generation, not discovered after —
// see generate.ts), so "coverage" here means every entry that was SUPPOSED
// to produce a post actually did. A pure function, independently testable
// with a deliberately incomplete `generated` set regardless of whether
// generate.ts's own control flow can currently produce that state.
// Session 24-D (MINOR-5 correction) — both params widened to ReadonlyArray:
// this function only ever reads via .map(), never mutates, so the caller's
// FrozenBrief.content.roleSequence being deep-readonly (generate.ts:303) is
// a genuine, correctly-surfaced consumer change, not something to cast
// around — it strictly widens acceptance (still takes a plain mutable array
// too), doesn't narrow it.
export function checkRoleCoverage(
  generated: ReadonlyArray<{ order: number }>,
  expected: ReadonlyArray<CampaignBriefContent['roleSequence'][number]>,
): RoleCoverageResult {
  const generatedOrders = new Set(generated.map((g) => g.order))
  const missingOrders = expected.map((e) => e.order).filter((order) => !generatedOrders.has(order))
  return { ok: missingOrders.length === 0, missingOrders }
}

export interface LinkPlacementResult {
  ok: boolean
  violations: string[]
}

const URL_PATTERN = /https?:\/\/|www\./i

// ADR §8 item 2 — CTA/outbound links never in tweet 1 (suppresses X reach);
// a link belongs in the final tweet or an explicit follow-up reply. Applies
// only to thread-format outputs — there is no "tweet 1" concept for a
// single-post family.
export function checkLinkPlacement(threads: ThreadOutput[]): LinkPlacementResult {
  const violations: string[] = []
  threads.forEach((thread, threadIdx) => {
    const firstPost = thread.posts[0]
    if (firstPost && URL_PATTERN.test(firstPost.text)) {
      violations.push(`thread[${threadIdx}] posts[0] ("${firstPost.text.slice(0, 40)}...") contains a link`)
    }
  })
  return { ok: violations.length === 0, violations }
}

// ─── ADR 0027 §5.8 half (b) — MODE2-REDUNDANCY-UNDEFER (Session 34 K2.8, founder ruling A-3) ────────────────
//
// A DETERMINISTIC, ZERO-LLM, STRUCTURAL check over the GENERATED set: two posts are flagged as redundant when
// ALL of these hold —
//   1. they cite the SAME evidence ids (compared as sets, order-insensitive);
//   2. they carry the same `role`;
//   3. they carry the same `proofType` (2 and 3 are the ADR 0026 dimension tuple);
//   4. their text overlaps at or above REDUNDANCY_OVERLAP_THRESHOLD (Jaccard over content words).
// Relaxing ANY of the four widens the flag set; each is pinned by its own test.
//
// FLAGGED, NEVER BLOCKED, NEVER EDITED: the result is advisory data for the approval gate. The function takes
// ReadonlyArrays, returns fresh objects, and mutates nothing it is given.
//
// EXPLICITLY NOT AUTHORISED: an embeddings-based similarity check. pre-launch-scope.md §12.6 unblocks similarity
// inside lib/memory/ but sequences it after Session 32 and does NOT schedule it into Sessions 31-34. If you reach
// for embeddings here, STOP — that is a separate, scheduled piece of work.
//
// RESIDUAL, recorded in the source (ADR 0027 §5.8): this is STRUCTURAL, NOT SEMANTIC. Two posts arguing the
// same thing in different words, or from different evidence, pass it. REVIVAL CONDITION: measured edit-distance
// or manual-review data showing semantic redundancy surviving both halves.
//
// KNOWN LIMIT OF TODAY'S INPUTS (found while building K2.8): generate.ts gives EVERY post of a campaign the same
// pinnedEvidenceIds, and proof_type is derived by the DB trigger AFTER insert from the same campaign-level
// pinned evidence — so within one campaign conditions 1 and the proofType half of 2 are equal for all posts, and
// the check discriminates on `role` + overlap. It becomes sharper the day a post cites per-post evidence; the
// signature already takes it. Do not "fix" this by inventing a per-post proof type here.

// Jaccard over content-word sets. 0.6 = at least three fifths of the union of content words is shared: high
// enough that two posts on the same role and topic but with different specifics do not trip it, low enough that
// a near-paraphrase does. A TUNABLE, not a law — revisit against measured data (the residual above).
export const REDUNDANCY_OVERLAP_THRESHOLD = 0.6

// Words shorter than this carry no claim ("the", "and", "our"); dropping them is the whole stop-word list.
const REDUNDANCY_MIN_WORD_CHARS = 4

export interface RedundancyCandidate {
  order: number
  role: string
  // ADR 0026 dimension. null = not known at generation time (see the limit above); two nulls are equal.
  proofType: string | null
  citedEvidenceIds: ReadonlyArray<string>
  text: string
}

export interface RedundancyFlag {
  // The two candidates' `order` values, in input order.
  orders: [number, number]
  overlap: number
}

export interface SetRedundancyResult {
  // false when at least one pair is flagged. Advisory: no caller may treat this as a gate.
  ok: boolean
  flags: RedundancyFlag[]
}

function contentWords(text: string): Set<string> {
  const words = text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return new Set(words.filter((w) => Array.from(w).length >= REDUNDANCY_MIN_WORD_CHARS))
}

export function lexicalOverlap(a: string, b: string): number {
  const wa = contentWords(a)
  const wb = contentWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return shared / (wa.size + wb.size - shared)
}

function sameIdSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const id of sa) if (!sb.has(id)) return false
  return true
}

export function checkSetRedundancy(posts: ReadonlyArray<RedundancyCandidate>): SetRedundancyResult {
  const flags: RedundancyFlag[] = []
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      const a = posts[i]
      const b = posts[j]
      if (!sameIdSet(a.citedEvidenceIds, b.citedEvidenceIds)) continue
      if (a.role !== b.role || a.proofType !== b.proofType) continue
      const overlap = lexicalOverlap(a.text, b.text)
      if (overlap >= REDUNDANCY_OVERLAP_THRESHOLD) flags.push({ orders: [a.order, b.order], overlap })
    }
  }
  return { ok: flags.length === 0, flags }
}
