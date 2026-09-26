// ADR 0016 §5.1 (MEM-NO-DIRECT-TABLE-ACCESS) — the single public entry
// point, mirroring lib/social/index.ts. Nothing outside lib/memory/ imports
// lib/memory/<type> directly; consumers import from here.
//
// Production consumers today: lib/ai/context.ts, which imports
// retrievePerformancePatterns (B3) and retrieveVoice (Session 23-D · D2).
//
// retrieveBrandMemory / retrieveEvidenceMemory / retrieveAudienceMemory ARE
// consumed in production (ADR 0029 §1.5 corrected the earlier "no production
// consumer yet" note, which had gone stale): lib/campaigns/brief.ts reads all
// three when it assembles a brief, and retrieveEvidenceMemory is also read by
// app/[locale]/(dashboard)/approvals/{page.tsx,claim-actions.ts} and
// studio/actions.ts. Their reads return ACTIVE rows only, which is why
// ratification (ADR 0029 §8.5) is what makes a founder's answer reach a prompt.
//
// recordInterviewCandidates and ratifyInterviewCandidates (ADR 0029 §2.3, §8.5) are the two WRITES
// exported here: the governed entry points that turn grounded interview answers into CANDIDATE
// records, and that let an approver activate or reject them, one decision per candidate.
// recordInterviewCandidates activates nothing; ratifyInterviewCandidates has no accept-all.

export { retrieveRelevant as retrieveBrandMemory } from './brand'
export { retrieveRelevant as retrieveEvidenceMemory } from './evidence'
export { retrieveRelevant as retrieveAudienceMemory } from './audience'
export {
  retrieveRelevant as retrievePerformancePatterns,
  retrieveStudioPerformancePatterns,
  type PerformancePattern,
  type GovernedPerformancePattern,
} from './performance'
export { retrieveOutcomePatterns, retrieveHypothesisResults, type OutcomeObservation } from './outcomes'
export { retrieveVoice, type CoreVoiceRules } from './voice'
export {
  recordInterviewCandidates,
  ratifyInterviewCandidates,
  type RecordInterviewCandidatesInput,
  type RatifyInterviewCandidatesInput,
} from './interview'
export { readInterviewSlotRows } from './interview-coverage'
export { readInterviewConflictContext, type InterviewConflictRecord } from './interview-conflicts'

export type { MemoryQueryContext } from './scoring'
export { BRAND_CAP, EVIDENCE_CAP, AUDIENCE_CAP, PERFORMANCE_CAP, MEMORY_SCORE_WEIGHTS } from './constants'
