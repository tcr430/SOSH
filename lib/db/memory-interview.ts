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
}

// The yield counters (ADR 0029 §10.5) for items dropped BEFORE this call: only the extraction knows them.
export type InterviewYieldCounters = {
  proposed: number
  droppedUngrounded: number
  droppedPerformanceClaim: number
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
      })),
      counters: {
        proposed: args.counters.proposed,
        droppedUngrounded: args.counters.droppedUngrounded,
        droppedPerformanceClaim: args.counters.droppedPerformanceClaim,
      },
    },
  })
}
