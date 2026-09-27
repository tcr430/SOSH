import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  ratifyInterviewRound,
  writeInterviewCandidates,
  type RatifyInterviewRoundResult,
  type WriteInterviewCandidatesResult,
} from '@/lib/db/memory-interview'

export type { RatifyInterviewRoundResult, WriteInterviewCandidatesResult }
import { listBrandInterviewCandidates } from '@/lib/db/memory-brand'
import { listAudienceInterviewCandidates } from '@/lib/db/memory-audience'
import { listEvidenceInterviewCandidates } from '@/lib/db/memory-evidence'
import type { AudienceMemoryRow, BrandMemoryRow, EvidenceMemoryRow } from '@/lib/db/types'
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

// ─── Ratification (ADR 0029 §8.5) ─────────────────────────────────────────────────────────────────────────────────────────
// The governed entry point for ACTIVATING interview candidates, one human decision per candidate. There is NO accept-all here
// or anywhere: the schema demands a decision object for every candidate and ratify_interview_round raises unless every
// candidate of the round is decided exactly once. A REJECT is a strict object with no room for an edit or a replace target; an
// ACCEPT may carry a brand/audience text edit (≤ 280), a re-selected category/kind within its type's enum, and a replace
// target. No governance value has a field, and z.strictObject rejects a smuggled one.
//
// OWED BY THE CALLER (M2.9), not done here: the edited text must be re-run through the §4.7 performance-claim filter — the
// per-locale lexicon lives with the extraction (M2.8) — and `userId` must come from supabase.auth.getUser(), never a form.

const refSchema = z.strictObject({ type: z.enum(['brand', 'audience', 'evidence']), id: z.string().uuid() })

const decisionSchema = z
  .discriminatedUnion('decision', [
    z.strictObject({ type: z.enum(['brand', 'audience', 'evidence']), id: z.string().uuid(), decision: z.literal('reject') }),
    z.strictObject({
      type: z.enum(['brand', 'audience', 'evidence']),
      id: z.string().uuid(),
      decision: z.literal('accept'),
      text: z.string().trim().min(1).max(INTERVIEW_RECORD_TEXT_MAX_CHARS).optional(),
      category: z.string().min(1).optional(),
      replaces: refSchema.optional(),
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.decision !== 'accept') return
    if (d.category !== undefined && !(CATEGORY_BY_TYPE[d.type] as readonly string[]).includes(d.category)) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: `category "${d.category}" is not in the ${d.type} enum` })
    }
    // Evidence stays VERBATIM (ADR 0029 §4.3, §8.4): accept or reject, never an edit of its text.
    if (d.type === 'evidence' && d.text !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'evidence records cannot be edited' })
    }
  })

const ratifyInputSchema = z
  .strictObject({
    userId: z.string().uuid(),
    roundId: z.string().uuid(),
    decisions: z.array(decisionSchema).min(1).max(INTERVIEW_MAX_ITEMS_PER_ROUND),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>()
    const replaced = new Set<string>()
    for (const d of input.decisions) {
      const key = `${d.type}:${d.id}`
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['decisions'], message: `candidate ${d.id} is decided more than once` })
      seen.add(key)
      if (d.decision === 'accept' && d.replaces) {
        const target = `${d.replaces.type}:${d.replaces.id}`
        if (replaced.has(target)) ctx.addIssue({ code: 'custom', path: ['decisions'], message: `replace target ${d.replaces.id} is used more than once` })
        replaced.add(target)
      }
    }
  })

export type RatifyInterviewCandidatesInput = z.input<typeof ratifyInputSchema>

// Ratifies a round: every candidate accepted or rejected, per item. Returns the RPC's typed result (`ratified` with its
// counters, `not_awaiting` for a round that is not awaiting ratification — a no-op that wrote nothing — or `not_found`); a
// ZodError for input that fails the strict schema (nothing is sent); a FounderInterviewRpcError (42501) for a caller who is
// not an approver or admin of the round's business, or (22023) for a decision set the database rejects.
export type InterviewCandidatesByType = { brand: BrandMemoryRow[]; audience: AudienceMemoryRow[]; evidence: EvidenceMemoryRow[] }

// ADR 0029 §8.4/§9.5 (Session 35 M2.9) — the ratification READ: one round's still-'candidate',
// source='interview' rows across the three memory tables, grouped by type for the ratification UI. MEM-NO-
// DIRECT-TABLE-ACCESS: the /interview page and its Server Actions call THIS, never lib/db/memory-*.ts
// directly. `answerIds` is the round's OWN answer ids (from listAnswersForRound), never client input; each
// underlying read is independently bounded (24 per table, §9.5) and re-checks source/status itself rather
// than trusting the caller.
export async function listInterviewCandidatesForRound(client: SupabaseClient, answerIds: string[]): Promise<InterviewCandidatesByType> {
  const [brand, audience, evidence] = await Promise.all([
    listBrandInterviewCandidates(client, answerIds),
    listAudienceInterviewCandidates(client, answerIds),
    listEvidenceInterviewCandidates(client, answerIds),
  ])
  return { brand, audience, evidence }
}

export async function ratifyInterviewCandidates(input: RatifyInterviewCandidatesInput): Promise<RatifyInterviewRoundResult> {
  const parsed = ratifyInputSchema.parse(input)
  return ratifyInterviewRound({
    userId: parsed.userId,
    roundId: parsed.roundId,
    decisions: parsed.decisions.map((d) =>
      d.decision === 'reject'
        ? { type: d.type, id: d.id, decision: 'reject' as const }
        : {
            type: d.type,
            id: d.id,
            decision: 'accept' as const,
            ...(d.text !== undefined ? { text: d.text } : {}),
            ...(d.category !== undefined ? { category: d.category } : {}),
            ...(d.replaces !== undefined ? { replaces: { type: d.replaces.type, id: d.replaces.id } } : {}),
          },
    ),
  })
}
