import { z } from 'zod'

// ADR 0026 §8.1 / ADR 0017 Amendment C (Session 33 J2.10, ruling A-1) — a falsifiable hypothesis and structured
// success criteria in the brief. ONE schema, shared by Stage A's output validation (lib/ai/prompts/brief.ts) and
// the brief-review Server Action, so what the model may propose and what a human may edit are the same thing.
//
// The criteria are drawn ONLY from what the outcome loop measures — engagement against the brand's own usual:
// a WIN RATE (share of posts beating the baseline) or a MEDIAN LIFT (exp of the median log_lift). Out-of-range
// values are REJECTED, never clamped.

export const HYPOTHESIS_MAX_CHARS = 300
export const WIN_RATE_TARGET = { min: 0.5, max: 0.95 } as const
export const MEDIAN_LIFT_TARGET = { min: 1.0, max: 3.0 } as const
export const EVALUATION_WINDOW_DAYS = { min: 7, max: 60 } as const

export const HypothesisSchema = z.string().trim().min(1).max(HYPOTHESIS_MAX_CHARS)

export const SuccessCriteriaSchema = z
  .object({
    metric: z.enum(['win_rate', 'median_lift']),
    target: z.number().finite(),
    evaluationWindowDays: z.number().int().min(EVALUATION_WINDOW_DAYS.min).max(EVALUATION_WINDOW_DAYS.max),
  })
  .superRefine((value, ctx) => {
    const range = value.metric === 'win_rate' ? WIN_RATE_TARGET : MEDIAN_LIFT_TARGET
    if (value.target < range.min || value.target > range.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: `target for ${value.metric} must be within [${range.min}, ${range.max}]`,
      })
    }
  })

export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>

// Both or neither: a hypothesis with no criteria cannot be evaluated, and criteria with no hypothesis have
// nothing to test. A brief frozen BEFORE the amendment has neither and is valid (it is not backfilled; the
// retrospective uses an implicit hypothesis for it — J2.11).
export const HypothesisFieldsSchema = z
  .object({
    hypothesis: HypothesisSchema.optional(),
    successCriteria: SuccessCriteriaSchema.optional(),
  })
  .refine((v) => (v.hypothesis === undefined) === (v.successCriteria === undefined), {
    message: 'hypothesis and successCriteria must be provided together',
  })
