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

export const SinglePostOutputSchema = z.object({
  format: z.literal('single'),
  body: z.string().min(1),
  imageBrief: z.string().nullable(),
  scriptBrief: z.string().max(SCRIPT_BRIEF_MAX_CHARS).nullish(),
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
})

export type CarouselOutput = z.infer<typeof CarouselOutputSchema>

export const NativeOutputSchema = z.discriminatedUnion('format', [
  SinglePostOutputSchema,
  ThreadOutputSchema,
  CarouselOutputSchema,
])

export type NativeOutput = z.infer<typeof NativeOutputSchema>
