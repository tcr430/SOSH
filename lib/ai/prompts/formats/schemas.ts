import { z } from 'zod'

// ADR 0017 §4.1 — the structural-nativeness guarantee. A flat schema with
// optional fields cannot reject "prose where a thread was expected"; a
// discriminatedUnion on the literal `format` tag is matched BEFORE the
// branch body is validated, so a shape mismatch fails deterministically
// (MODE2-FORMAT-FAMILY-STRUCTURAL).

export const SinglePostOutputSchema = z.object({
  format: z.literal('single'),
  body: z.string().min(1),
  imageBrief: z.string().nullable(),
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
})

export type ThreadOutput = z.infer<typeof ThreadOutputSchema>

export const NativeOutputSchema = z.discriminatedUnion('format', [
  SinglePostOutputSchema,
  ThreadOutputSchema,
])

export type NativeOutput = z.infer<typeof NativeOutputSchema>
