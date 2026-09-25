import { z } from 'zod'
import { writeInterviewCandidates, type WriteInterviewCandidatesResult } from '@/lib/db/memory-interview'
import {
  INTERVIEW_EVIDENCE_TEXT_MAX_CHARS,
  INTERVIEW_MAX_ITEMS_PER_ANSWER,
  INTERVIEW_MAX_ITEMS_PER_ROUND,
  INTERVIEW_RECORD_TEXT_MAX_CHARS,
  INTERVIEW_SPAN_MAX_CHARS,
} from '@/lib/interview/constants'

// ADR 0029 §2.3 (Session 35 M2.5) — the governed entry point for interview records. lib/memory/interview.ts is the ONLY
// caller of lib/db/memory-interview.ts (MEM-NO-DIRECT-TABLE-ACCESS + INTERVIEW-WRITER-SOLE-CALLER: the source scan in
// lib/memory/import.test.ts forbids the writer's name everywhere else, dynamic imports included). Everything that turns a
// founder's answer into memory goes through here.
//
// WHAT THIS LAYER ADDS. It is the last TypeScript gate before the database, and it is STRICT: the input is parsed with
// z.strictObject at every level, so a field the schema does not name — confidence, status, source,
// public_use_permission, sensitivity, scope, expires_at, a business id, anything — is REJECTED, not ignored (ADR 0029
// §6.1: no governance field is model- or form-supplied). The bounds the SQL will enforce again (≤ 3 items per answer,
// ≤ 24 per round, text ≤ 280 / 500, span ≤ 500, evidence text = its span) are checked here first, so a violation is a
// clear ZodError at the boundary instead of a 22023 from the database.
//
// It writes CANDIDATES ONLY. Nothing here can activate a record: activation is ratify_interview_round (M2.6), per item,
// by a human. And nothing here touches campaigns, cards, briefs or seeds: an answer becomes memory and nothing else
// (D-5, INTERVIEW-NO-UNATTENDED-ACTION).

const CATEGORY_BY_TYPE = {
  brand: ['positioning', 'capability', 'pricing', 'competitor', 'other'],
  audience: ['problem', 'objection', 'question', 'trigger', 'other'],
  evidence: ['quote', 'case_study', 'usage_data', 'other'],
} as const

const itemSchema = z
  .strictObject({
    answerId: z.string().uuid(),
    type: z.enum(['brand', 'audience', 'evidence']),
    category: z.string().min(1),
    text: z.string().trim().min(1),
    span: z.string().trim().min(1).max(INTERVIEW_SPAN_MAX_CHARS),
  })
  .superRefine((item, ctx) => {
    if (!(CATEGORY_BY_TYPE[item.type] as readonly string[]).includes(item.category)) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: `category "${item.category}" is not in the ${item.type} enum` })
    }
    const max = item.type === 'evidence' ? INTERVIEW_EVIDENCE_TEXT_MAX_CHARS : INTERVIEW_RECORD_TEXT_MAX_CHARS
    if (item.text.length > max) {
      ctx.addIssue({ code: 'too_big', origin: 'string', maximum: max, inclusive: true, path: ['text'], message: `${item.type} text is at most ${max} characters` })
    }
    // Evidence is VERBATIM (ADR 0029 §4.3): its text is its span.
    if (item.type === 'evidence' && item.text !== item.span) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: "an evidence item's text must equal its span" })
    }
  })

const inputSchema = z
  .strictObject({
    roundId: z.string().uuid(),
    items: z.array(itemSchema).max(INTERVIEW_MAX_ITEMS_PER_ROUND),
    counters: z.strictObject({
      proposed: z.number().int().min(0),
      droppedUngrounded: z.number().int().min(0),
      droppedPerformanceClaim: z.number().int().min(0),
    }),
  })
  .superRefine((input, ctx) => {
    const perAnswer = new Map<string, number>()
    for (const item of input.items) perAnswer.set(item.answerId, (perAnswer.get(item.answerId) ?? 0) + 1)
    for (const [answerId, n] of perAnswer) {
      if (n > INTERVIEW_MAX_ITEMS_PER_ANSWER) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: `at most ${INTERVIEW_MAX_ITEMS_PER_ANSWER} items per answer (answer ${answerId} has ${n})` })
      }
    }
    if (input.counters.proposed < input.items.length) {
      ctx.addIssue({ code: 'custom', path: ['counters', 'proposed'], message: 'proposed cannot be below the number of items written' })
    }
  })

export type RecordInterviewCandidatesInput = z.input<typeof inputSchema>

// Records the round's GROUNDED candidates. The input comes from the extraction step (M2.8), which holds model output, so
// it is validated at RUNTIME with the strict schema above even though its type is narrow: a cast that smuggles a key past
// the compiler is still rejected here. Returns the writer's typed result (`written` with `awaiting_ratification` or
// `no_records`, `not_extracting`, `not_found`); a ZodError is thrown for input that fails the schema, and nothing is
// written.
export async function recordInterviewCandidates(input: RecordInterviewCandidatesInput): Promise<WriteInterviewCandidatesResult> {
  const parsed = inputSchema.parse(input)
  return writeInterviewCandidates({
    roundId: parsed.roundId,
    items: parsed.items.map((item) => ({ answerId: item.answerId, type: item.type, category: item.category, text: item.text, span: item.span })),
    counters: parsed.counters,
  })
}
