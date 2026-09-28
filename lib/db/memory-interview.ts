import type { FounderInterviewRoundStatus } from './types'
import type { InterviewMemoryType } from '@/lib/interview/constants'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'
import { callInterviewRpc } from './founder-interview-rounds'

// ADR 0029 §2.3 (Session 35 M2.5) — the ONLY TypeScript path onto write_interview_candidates, the ONLY SQL path that
// produces source = 'interview' rows in the brand, evidence and audience memory stores. Callers: ONLY
// lib/memory/interview.ts (MEM-NO-DIRECT-TABLE-ACCESS; INTERVIEW-WRITER-SOLE-CALLER is enforced by the source scan in
// lib/memory/import.test.ts, which forbids the exported name below everywhere else, dynamic imports included).
//
// SERVICE-ROLE by lazy import and NO `client` parameter — it reaches the service-role client through the shared
// callInterviewRpc helper (founder-interview-rounds.ts), so this file never imports it, statically or otherwise.
//
// THE RAW-vs-STORED INVARIANT (ADR 0029 §2.3, binding). The RPC receives BOTH forms of every text and span:
//   - `text` and `span` are the RAW values. SQL CONTAINMENT (the raw span must be an exact substring of the RAW stored
//     answer) is checked against these;
//   - `storedText` and `storedSpan` are the SAME strings after neutralizeWithSentinels() — the function
//     memory-evidence.ts:82 already applies at ITS write choke point, IMPORTED from lib/ai/wrap-evidence.ts, not copied.
//     THESE are what the database STORES.
// Neutralising alters text (NFKC, stripped format characters, a zero-width space, "[/DATA]" rewritten), so checking
// containment on the neutralised span would fail every span that contains such a character, and storing the raw text
// would defeat the write-time guard against prompt injection through a stored record. Either shape is a finding.
//
// NO GOVERNANCE FIELD EXISTS in this file's types, and every payload below is built by picking named keys, never by
// spreading an input object: a caller that smuggles `confidence`, `status`, `source`, `public_use_permission`, a
// business id... cannot get it across, even by a cast. The SQL ignores such keys too (belt and braces).

export type InterviewCandidateItem = {
  answerId: string
  type: InterviewMemoryType
  category: string
  text: string
  span: string
  // Session 35-D D5 (MAJOR-3): the two COMPUTED markers the extraction derives per record (ADR 0029 §4.4 the hedge flag, §4.5
  // conflict ids already intersected with the ids that were SENT). Neither is governance. The SQL persists them and re-verifies
  // every conflict id (a live row of the SAME table and business) before storing it. Optional: absent = false / none.
  hedgeFlagged?: boolean
  conflictIds?: readonly string[]
}

// The yield counters (ADR 0029 §10.5) for items dropped BEFORE this call: only the extraction knows them.
export type InterviewYieldCounters = {
  proposed: number
  droppedUngrounded: number
  droppedPerformanceClaim: number
  // Session 35-D D5 (NIT-2): answers beyond the per-answer cap that were not written. Optional: absent = 0.
  droppedCap?: number
}

export type WriteInterviewCandidatesResult =
  | {
      outcome: 'written'
      status: 'awaiting_ratification' | 'no_records'
      inserted: number
      candidates: { brand: number; audience: number; evidence: number }
    }
  | { outcome: 'not_found' }
  | { outcome: 'not_extracting'; status: FounderInterviewRoundStatus }

// One decision per candidate (ADR 0029 §8.5). A REJECT carries nothing else; an ACCEPT may carry an edit of a brand/audience
// text, a re-selected category/kind, and a replace target. There is NO field for status, confidence, source, sensitivity,
// public_use_permission, scope or expiry: the RPC fixes or recomputes every one of them, and the type cannot carry them.
export type InterviewDecision =
  | { type: InterviewMemoryType; id: string; decision: 'reject' }
  | {
      type: InterviewMemoryType
      id: string
      decision: 'accept'
      text?: string
      category?: string
      replaces?: { type: InterviewMemoryType; id: string }
    }

export type RatifyInterviewRoundResult =
  | { outcome: 'ratified'; accepted: number; rejected: number; edited: number; replaced: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_awaiting'; status: FounderInterviewRoundStatus }

// The ONLY path that activates an interview candidate — per item, by an approver or admin (ADR 0029 §8.5). Same rules as the
// writer above: service-role through callInterviewRpc, no `client`, and every payload built by picking named keys.
//
// `userId` MUST come from supabase.auth.getUser() on the anon server client — NEVER a form field; ratify_interview_round
// trusts it only because EXECUTE is granted to service_role alone and re-checks approver-or-admin membership itself
// (a non-member raises 42501, surfaced here as a FounderInterviewRpcError carrying that code).
//
// An EDITED text is neutralised HERE (neutralizeWithSentinels, the same single choke point the writer uses) before it is
// stored as the record's statement: the founder's typed text reaches every future prompt, so it gets the same write-time guard
// as the model's. The model's ORIGINAL survives untouched in interview_extracted_text.
export async function ratifyInterviewRound(args: { userId: string; roundId: string; decisions: InterviewDecision[] }): Promise<RatifyInterviewRoundResult> {
  return callInterviewRpc<RatifyInterviewRoundResult>('ratify_interview_round', {
    p_user_id: args.userId,
    p_round_id: args.roundId,
    p_decisions: args.decisions.map((d) => {
      if (d.decision === 'reject') return { type: d.type, id: d.id, decision: 'reject' }
      return {
        type: d.type,
        id: d.id,
        decision: 'accept',
        ...(d.text !== undefined ? { text: neutralizeWithSentinels(d.text) } : {}),
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.replaces !== undefined ? { replaces: { type: d.replaces.type, id: d.replaces.id } } : {}),
      }
    }),
  })
}

// Writes the round's grounded candidates in ONE transaction and flips the round: `awaiting_ratification`, or
// `no_records` when it holds no candidate at all. A round that is not `extracting` writes NOTHING (`not_extracting`).
// A validation failure inside the RPC (22023) surfaces as a thrown FounderInterviewRpcError — the TypeScript layer
// drops and counts ungrounded items first, so reaching it means a defect or a tampered call.
export async function writeInterviewCandidates(args: {
  roundId: string
  items: InterviewCandidateItem[]
  counters: InterviewYieldCounters
}): Promise<WriteInterviewCandidatesResult> {
  return callInterviewRpc<WriteInterviewCandidatesResult>('write_interview_candidates', {
    p_round_id: args.roundId,
    p_items: {
      items: args.items.map((item) => ({
        answerId: item.answerId,
        type: item.type,
        category: item.category,
        // RAW: what SQL containment reads
        text: item.text,
        span: item.span,
        // NEUTRALISED: what is stored
        storedText: neutralizeWithSentinels(item.text),
        storedSpan: neutralizeWithSentinels(item.span),
        // COMPUTED markers (D5, MAJOR-3), picked by name like every other key. The SQL re-verifies each conflict id.
        hedgeFlagged: item.hedgeFlagged ?? false,
        conflictIds: [...(item.conflictIds ?? [])],
      })),
      counters: {
        proposed: args.counters.proposed,
        droppedUngrounded: args.counters.droppedUngrounded,
        droppedPerformanceClaim: args.counters.droppedPerformanceClaim,
        droppedCap: args.counters.droppedCap ?? 0,
      },
    },
  })
}
