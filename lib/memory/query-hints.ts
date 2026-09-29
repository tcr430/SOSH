import { z } from 'zod'

// ADR 0030 §3.2 (Session 36 L2.7, founder ruling A-7) — the ONE definition of what a MODEL may put in a memory query.
//
// The model-facing tools (lib/campaigns/planner/tools.ts and lib/signals/triage/tools.ts) used to each declare their own
// { objective, platform, audience } schema. Two of those three fields were never read by any scoring term, and a duplicated schema is two
// things to keep in step. Both tools now import THESE two exports, so the dependency runs one way only (tools -> lib/memory), and the type
// `ModelQueryHints` is DERIVED from the schema rather than declared beside it.
//
// `platform` is the only discriminator doing any work: scopeMatch compares it against a scope='platform' row's scope_ref. `campaignId` and
// `confidenceFloor` narrow scope, so they are CALLER-ONLY (RetrieveScope in ./scoring) and appear in no model-facing schema. `z.strictObject`
// REFUSES any other key — a model that still sends `objective` gets a parse error (surfaced as a retryable tool error), never a silent strip.

export const memoryQueryHintsSchema = z.strictObject({
  platform: z.string().optional(),
})

export type ModelQueryHints = z.infer<typeof memoryQueryHintsSchema>

/** The JSON Schema the model sees for every memory tool. Its property keys equal the Zod schema's keys (tested). */
export const MEMORY_QUERY_HINTS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    platform: { type: 'string' },
  } satisfies Record<keyof ModelQueryHints, unknown>,
}
