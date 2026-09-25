import { z } from 'zod'

// ADR 0027 §5.9 (Session 34 K2.8) — THE SHARED ROLE-SEQUENCE SCHEMA, extracted out of lib/ai/prompts/brief.ts
// (an AI-OUTPUT schema) into a neutral module BOTH the brief prompt and the apply path import. The Amendment E
// pattern (lib/outcomes/hypothesis.ts): what the model may propose and what a ratified apply may produce are one
// schema, so a fix applied to one import path cannot be missing from the other.
//
// THE DEFECT THIS CLOSES ([cr-MAJOR-1]). The entry schema validated `order` as an int >= 0 with NO uniqueness on
// the array. checkRoleCoverage (consistency.ts) is SET-BASED and cannot see a duplicate: two entries with order 3
// both generate, both push order 3, missingOrders is empty, ok: true. Then generate.ts's
// `roleSequence.find((r) => r.order === g.order)?.angle` takes THE FIRST match, so the second post's
// ai_generation_metadata.rationale — and the post_ai_originals row derived from it — records the WRONG ENTRY'S
// ANGLE. Silent, permanent, and it corrupts ADR 0018's learning-capture ground truth. A `substitute`/`reorder`
// proposal is the first thing that could produce a duplicate. THE REFINE BELOW IS THE SAFETY NET; do NOT lean on
// checkRoleCoverage for it ([cr-MAJOR-2]: ADR 0017 §5.2's "index-positional, on role" description of that
// function is wrong — it checks neither).
//
// Contiguity is deliberately NOT required: generate.ts groups and schedules by PLATFORM and zips
// entriesForPlatform[i] to dates[i] (the index within the filtered array, never the order VALUE), and `order` is
// not persisted (PostInsert carries no order column), so a gap is invisible and rejecting one would refuse
// briefs that already exist. The apply RPC re-derives `order` from array position, so what it produces is
// contiguous anyway.

export const ROLE_SEQUENCE_ROLES = [
  'anchor_thesis',
  'founder_perspective',
  'customer_proof',
  'objection_response',
  'conversation_starter',
  'follow_up',
] as const

export const ROLE_SEQUENCE_PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const

export const ROLE_SEQUENCE_ENTRY_SCHEMA = z.object({
  order: z.number().int().min(0),
  role: z.enum(ROLE_SEQUENCE_ROLES),
  platform: z.enum(ROLE_SEQUENCE_PLATFORMS),
  angle: z.string().min(1),
})

// The orders that appear more than once, ascending. Pure; exported so a caller can NAME the offender in an error.
export function findDuplicateOrders(entries: ReadonlyArray<{ order: number }>): number[] {
  const seen = new Set<number>()
  const dupes = new Set<number>()
  for (const e of entries) {
    if (seen.has(e.order)) dupes.add(e.order)
    seen.add(e.order)
  }
  return [...dupes].sort((a, b) => a - b)
}

export const RoleSequenceSchema = z
  .array(ROLE_SEQUENCE_ENTRY_SCHEMA)
  .min(1)
  .refine((entries) => findDuplicateOrders(entries).length === 0, {
    message: 'roleSequence entries must have unique `order` values',
  })

export type RoleSequence = z.infer<typeof RoleSequenceSchema>

// The apply path's validator: EVERY ratified apply routes its resulting roleSequence through here
// (lib/campaigns/apply-proposals.ts). Same schema object as the prompt's, not a copy.
export function validateRoleSequence(value: unknown): { ok: true; roleSequence: RoleSequence } | { ok: false; message: string } {
  const parsed = RoleSequenceSchema.safeParse(value)
  if (parsed.success) return { ok: true, roleSequence: parsed.data }
  return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') }
}

// ─── ratified-proposal placement (Session 34-D D5, MAJOR-1 / MINOR-8; AGENCY-REORDER-RATIFIED-EXACT) ─────────
//
// The PURE REFERENCE for what apply_brief_proposals (supabase/migrations/20260924100000_...sql) writes. The RPC
// and this function implement ONE rule, and a Tier-1 test (supabase/__tests__/plan-proposals-ratify.test.ts)
// asserts they agree for every combination it sends. THE RULE, the sentence the human ratifies ("move the post
// at targetOrder to proposedOrder"):
//   proposedOrder is the entry's 0-based position in the RESULTING sequence — after every accepted drop is
//   removed — and every entry that is not the target of an accepted reorder keeps its original relative order
//   and fills the remaining positions, in order.
// Composition: targetOrder always names an entry by its ORIGINAL `order`; drop removes; substitute changes only
// the role; a reorder PINS its entry to its slot; the un-pinned survivors fill the open slots left to right.
// A combination the sentence cannot satisfy is REFUSED, never reinterpreted (see PlacementRefusal). Pure and
// independent of the order the proposals are listed in.
export interface RatifiedProposal {
  kind: 'drop' | 'substitute' | 'reorder' | 'request_evidence'
  targetOrder: number
  proposedRole?: string | null
  proposedOrder?: number | null
}

export type PlacementRefusal =
  | { outcome: 'empty_sequence' }
  | { outcome: 'conflicting_reorders' | 'invalid_reorder_target'; targetOrder: number }

export type PlacementResult = { ok: true; roleSequence: RoleSequence } | ({ ok: false } & PlacementRefusal)

export function placeRatifiedProposals(entries: RoleSequence, proposals: readonly RatifiedProposal[]): PlacementResult {
  const survivors = entries
    .map((entry, pos) => ({ entry, pos }))
    .filter(({ entry }) => !proposals.some((p) => p.kind === 'drop' && p.targetOrder === entry.order))
    .map(({ entry, pos }) => {
      const substitute = proposals.find((p) => p.kind === 'substitute' && p.targetOrder === entry.order)
      const reorder = proposals.find((p) => p.kind === 'reorder' && p.targetOrder === entry.order)
      return {
        entry,
        pos,
        role: (substitute?.proposedRole ?? entry.role) as RoleSequence[number]['role'],
        pin: reorder?.proposedOrder ?? null,
      }
    })

  if (survivors.length === 0) return { ok: false, outcome: 'empty_sequence' }

  const pinned = survivors.filter((s) => s.pin !== null)
  for (const s of pinned) {
    if (pinned.filter((o) => o.pin === s.pin).length > 1) {
      return { ok: false, outcome: 'conflicting_reorders', targetOrder: s.entry.order }
    }
  }
  for (const s of pinned) {
    if ((s.pin as number) >= survivors.length) {
      return { ok: false, outcome: 'invalid_reorder_target', targetOrder: s.entry.order }
    }
  }

  const pinnedSlots = new Set(pinned.map((s) => s.pin as number))
  const free = survivors.filter((s) => s.pin === null).sort((a, b) => a.entry.order - b.entry.order || a.pos - b.pos)
  const result: RoleSequence = new Array(survivors.length)
  for (const s of pinned) result[s.pin as number] = { order: s.pin as number, role: s.role, platform: s.entry.platform, angle: s.entry.angle }
  let next = 0
  for (const s of free) {
    while (pinnedSlots.has(next)) next += 1
    result[next] = { order: next, role: s.role, platform: s.entry.platform, angle: s.entry.angle }
    next += 1
  }
  return { ok: true, roleSequence: result }
}
