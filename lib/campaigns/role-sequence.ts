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
