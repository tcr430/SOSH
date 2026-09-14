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

// ADR §4.2 (I2.13) — brand offers <= 3 writing examples chosen from the
// existing + staged pool the UI presents; the Zod max(3) is the actual cap
// enforcement point (BACKFILL-WRITE-CAPS), never a client-side courtesy.
export const applyBackfillVoiceSchema = z.discriminatedUnion('accountRole', [
  z.object({
    runId: z.string().uuid(),
    accountRole: z.literal('brand'),
    tone: wordArraySchema,
    keywords: wordArraySchema,
    avoidWords: wordArraySchema,
    writingExamples: z.array(z.string().max(1000)).max(3),
  }),
  z.object({
    runId: z.string().uuid(),
    accountRole: z.literal('founder'),
  }),
])
export type ApplyBackfillVoiceInput = z.infer<typeof applyBackfillVoiceSchema>

export const declineBackfillVoiceSchema = z.object({
  runId: z.string().uuid(),
})
export type DeclineBackfillVoiceInput = z.infer<typeof declineBackfillVoiceSchema>
