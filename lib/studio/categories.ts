import { z } from 'zod'
import { RubricOutputSchema } from '@/lib/ai/prompts/rubric'

// ADR 0019 §7 — the suggestion category, DERIVED from RubricOutputSchema's
// keys, not duplicated as a literal list (§7.1's designed invariant,
// rubric.ts:23: "adding, renaming, or removing a dimension changes the
// contract both callers depend on" — under that invariant, this is the
// THIRD caller made visible to whoever changes the set, alongside
// generate.ts:263 and brief.ts:170). `redundancy` and `platformNativeness`
// are properties of a whole draft, not a span (§7.2) — excluded here, not
// discarded: each may surface as at most one draft-level observation
// elsewhere, never as a span category.
//
// Shared by lib/studio/verify.ts (the citation verifier's ClaimedSuggestion/
// RenderedSuggestion) and lib/ai/prompts/studio-suggestion.ts (the output
// schema's category field) — a genuine shared concern, given its own module
// rather than defined once and re-exported from whichever file happened to
// need it first.
export const StudioSpanCategorySchema = RubricOutputSchema.shape.dimensions
  .keyof()
  .exclude(['redundancy', 'platformNativeness'])
export type StudioSpanCategory = z.infer<typeof StudioSpanCategorySchema>
