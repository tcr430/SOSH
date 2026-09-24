import { z } from 'zod'

// ADR 0017 §4.1 — the structural-nativeness guarantee. A flat schema with
// optional fields cannot reject "prose where a thread was expected"; a
// discriminatedUnion on the literal `format` tag is matched BEFORE the
// branch body is validated, so a shape mismatch fails deterministically
// (MODE2-FORMAT-FAMILY-STRUCTURAL).

// ADR 0022 §7.1, amended §7.1 (Session 29-D, D6, MINOR-5 / A-11) — the full
// rationale (why .nullish() not .nullable(), why no prompt is updated, the
// §8.2-wins ruling and its revival condition) lives there, not here.
const SCRIPT_BRIEF_MAX_CHARS = 500

// ADR 0026 §4.3 (Session 33, J2.4, founder ruling A-6) — the model's own statement
// of the OPENING type it used, requested inside the EXISTING generation call (no
// new model call). Descriptive only: the model's self-report about its own
// opening is unvalidated, so it is collected and shown but NEVER promoted to a
// pattern (ADR 0026 §4.1) until a kappa >= 0.6 agreement check clears it.
//
// THE ONE PLACE this list is written in TypeScript. The prompt renders it from
// here, and hooktype.test.ts asserts it equals BOTH database twins — the
// post_dimensions.hook_type CHECK and the tagging trigger's CASE sanitiser
// (supabase/migrations/20260919110000_outcome_tables.sql) — so a value added to
// one place and not the others fails a test instead of silently untagging posts.
//
// Additive by construction (the scriptBrief precedent above, ADR 0022 §7.1):
// .nullish() so a payload written before this field still parses and the prompt
// may answer null when no type fits. AI_ORIGINAL_SCHEMA_VERSION is NOT bumped: an
// additive optional key changes no parse, and a bump would make ADR 0018's
// classifier abandon every new signal (ADR 0018 §2.4).
//
// An UNKNOWN value is REJECTED (z.enum), failing the whole output; the runner
// surfaces it as invalid_response and ADR 0017 §4.4's one bounded re-prompt
// handles it. That is ADR 0026 §4.3's stated shape, not an accident.
export const HOOK_TYPES = ['question', 'statistic', 'contrarian', 'story', 'announcement', 'how_to'] as const
export const HookTypeSchema = z.enum(HOOK_TYPES)
export type HookType = z.infer<typeof HookTypeSchema>

export const SinglePostOutputSchema = z.object({
  format: z.literal('single'),
  body: z.string().min(1),
  imageBrief: z.string().nullable(),
  scriptBrief: z.string().max(SCRIPT_BRIEF_MAX_CHARS).nullish(),
  hookType: HookTypeSchema.nullish(),
})

export type SinglePostOutput = z.infer<typeof SinglePostOutputSchema>

// No posts[].order field ([type-2]) — array position IS the order; asking
// the model for an order field adds a failure mode (duplicate/gapped/
// out-of-range) with no upside. Order is derived from the array index after
// parse, in code.
export const ThreadOutputSchema = z.object({
  format: z.literal('thread'),
  posts: z
    .array(
      z.object({
        text: z.string().min(1),
        role: z.enum(['hook', 'body', 'pull_quote', 'close']),
      }),
    )
    .min(3)
    .max(8),
  // imageBrief repeated in BOTH branches ([type-4]) — zod v3 discriminatedUnion
  // has no shared-base merge; declaring it per-branch (rather than factoring
  // out a shared object type) avoids drift as carousel/script branches are
  // added later, each with their own imageBrief semantics.
  imageBrief: z.string().nullable(),
  scriptBrief: z.string().max(SCRIPT_BRIEF_MAX_CHARS).nullish(),
  // ADR 0026 §4.3 — declared per branch like imageBrief/scriptBrief (a zod
  // discriminatedUnion has no shared-base merge). Describes the FIRST post's opening.
  hookType: HookTypeSchema.nullish(),
})

export type ThreadOutput = z.infer<typeof ThreadOutputSchema>

// ADR 0022 §6.1 (Session 29, F1b.7) — the THIRD discriminatedUnion branch.
// slides bounded 3..10 as LITERAL schema bounds (mirroring thread's
// .min(3).max(8)), so safeParse rejects a malformed carousel structurally,
// never by a downstream string check. role is a closed 'cover'|'body'|'cta'
// set. No order field ([type-2], same reasoning as thread) — array position
// IS the order. Each slide carries its OWN imageBrief (a carousel needs a
// distinct image recommendation per slide, unlike single/thread's one post
// = one image) IN ADDITION to the branch-level imageBrief field ([type-4] —
// declared again here, not shared, for the same discriminatedUnion-has-no-
// base-merge reason single/thread each declare their own).
export const CarouselOutputSchema = z.object({
  format: z.literal('carousel'),
  slides: z
    .array(
      z.object({
        text: z.string().min(1),
        role: z.enum(['cover', 'body', 'cta']),
        imageBrief: z.string().nullable(),
      }),
    )
    .min(3)
    .max(10),
  imageBrief: z.string().nullable(),
  // Branch-level only (not per-slide) — a script recommendation describes
  // filming the carousel as a whole short-form video, not one per slide.
  scriptBrief: z.string().max(SCRIPT_BRIEF_MAX_CHARS).nullish(),
  // ADR 0026 §4.3 — branch-level; describes the COVER slide's opening.
  hookType: HookTypeSchema.nullish(),
})

export type CarouselOutput = z.infer<typeof CarouselOutputSchema>

export const NativeOutputSchema = z.discriminatedUnion('format', [
  SinglePostOutputSchema,
  ThreadOutputSchema,
  CarouselOutputSchema,
])

export type NativeOutput = z.infer<typeof NativeOutputSchema>
