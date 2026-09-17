import { z } from 'zod'
import { wordArraySchema } from './voice'

// ADR 0025 §6.4/§9.4/§10.3 (Session 32 I2.13). Caps mirror the write caps
// closed in I2.10-I2.12: evidence <= 40, audience <= 25, performance <= 15
// per run — an accepted/rejected array can never legitimately exceed the
// sum, 80. This is a defense-in-depth ceiling at the Zod boundary; the RPC
// itself only ever touches rows that actually belong to the run and are
// still 'candidate'.
const MAX_CANDIDATE_IDS = 80

const uuidArray = z.array(z.string().uuid()).max(MAX_CANDIDATE_IDS)

export const ratifyBackfillRunSchema = z.object({
  runId: z.string().uuid(),
  acceptedIds: uuidArray,
  rejectedIds: uuidArray,
  accountRole: z.enum(['brand', 'founder']),
})
export type RatifyBackfillRunInput = z.infer<typeof ratifyBackfillRunSchema>

export const discardBackfillRunSchema = z.object({
  runId: z.string().uuid(),
})
export type DiscardBackfillRunInput = z.infer<typeof discardBackfillRunSchema>

export const retryBackfillRunSchema = z.object({
  runId: z.string().uuid(),
})
export type RetryBackfillRunInput = z.infer<typeof retryBackfillRunSchema>

// ADR §4.2/§10.3 (I2.13, corrected Session 32-D D8 MAJOR-1) — the account
// role that decides brand vs. founder routing is READ FROM THE RUN
// (run.account_role, recorded at ratification) — never accepted from the
// client. Accepting it here would let a client resend a different role
// than the one the founder declared at ratification (ADR 4.2/10.3's
// ordering: role is fixed at ratify, voice only applies after). The brand
// fields are simply optional — the action ignores them entirely on a
// founder-role run. writingExamples' Zod max(3) is the actual cap
// enforcement point (BACKFILL-WRITE-CAPS), never a client-side courtesy.
// .strict() — an accountRole field on the wire is REJECTED, not silently
// stripped: fail closed on a client that still thinks it gets to declare
// the role, rather than quietly ignoring a signal that used to matter.
export const applyBackfillVoiceSchema = z
  .object({
    runId: z.string().uuid(),
    tone: wordArraySchema.default([]),
    keywords: wordArraySchema.default([]),
    avoidWords: wordArraySchema.default([]),
    writingExamples: z.array(z.string().max(1000)).max(3).default([]),
  })
  .strict()
export type ApplyBackfillVoiceInput = z.infer<typeof applyBackfillVoiceSchema>

export const declineBackfillVoiceSchema = z.object({
  runId: z.string().uuid(),
})
export type DeclineBackfillVoiceInput = z.infer<typeof declineBackfillVoiceSchema>
