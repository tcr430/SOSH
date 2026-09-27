import { z } from 'zod'
import { INTERVIEW_ANSWER_MAX_CHARS, INTERVIEW_MAX_ITEMS_PER_ROUND, INTERVIEW_RECORD_TEXT_MAX_CHARS } from '@/lib/interview/constants'

// ADR 0029 §2.5/§8.6 (Session 35 M2.9) — every Server Action over the founder interview is Zod-validated
// here first (round id, answer id, answer text <= 2000, decision arrays bounded at 24, the category/kind
// enums, edited text <= 280). NO schema below has a governance field (confidence, status, source,
// sensitivity, public_use_permission, scope, expires_at, observation_count) — the RPCs and lib/memory/
// interview.ts's own strict schema are the real enforcement (§6.1); this is the first, cheapest gate.

export const saveInterviewAnswerSchema = z.object({
  answerId: z.string().uuid(),
  text: z.string().trim().min(1).max(INTERVIEW_ANSWER_MAX_CHARS),
})
export type SaveInterviewAnswerInput = z.infer<typeof saveInterviewAnswerSchema>

export const skipInterviewAnswerSchema = z.object({ answerId: z.string().uuid() })
export type SkipInterviewAnswerInput = z.infer<typeof skipInterviewAnswerSchema>

export const roundIdSchema = z.object({ roundId: z.string().uuid() })
export type RoundIdInput = z.infer<typeof roundIdSchema>

const ratifyDecisionSchema = z
  .discriminatedUnion('decision', [
    z.strictObject({ type: z.enum(['brand', 'audience', 'evidence']), id: z.string().uuid(), decision: z.literal('reject') }),
    z.strictObject({
      type: z.enum(['brand', 'audience', 'evidence']),
      id: z.string().uuid(),
      decision: z.literal('accept'),
      text: z.string().trim().min(1).max(INTERVIEW_RECORD_TEXT_MAX_CHARS).optional(),
      category: z.string().min(1).optional(),
      replaces: z.strictObject({ type: z.enum(['brand', 'audience', 'evidence']), id: z.string().uuid() }).optional(),
    }),
  ])
  .superRefine((d, ctx) => {
    // §4.3/§8.4: evidence is verbatim — accept or reject only, never an edit of its text.
    if (d.decision === 'accept' && d.type === 'evidence' && d.text !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'evidence records cannot be edited' })
    }
  })

export const ratifyInterviewRoundSchema = z.object({
  roundId: z.string().uuid(),
  decisions: z.array(ratifyDecisionSchema).min(1).max(INTERVIEW_MAX_ITEMS_PER_ROUND),
})
export type RatifyInterviewRoundInput = z.infer<typeof ratifyInterviewRoundSchema>
