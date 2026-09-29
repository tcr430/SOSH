// ADR 0016 §5.1 (MEM-NO-DIRECT-TABLE-ACCESS) — the single public entry
// point, mirroring lib/social/index.ts. Nothing outside lib/memory/ imports
// lib/memory/<type> directly; consumers import from here.
//
// Production consumers of the retrieve* exports (ADR 0030 §3.4 has the per-call-site table):
// lib/ai/context.ts, lib/ai/prompts/studio-suggestion.ts, lib/campaigns/brief.ts, lib/campaigns/generate.ts,
// lib/campaigns/planner/tools.ts, lib/interview/extract.ts, lib/signals/triage/tools.ts, lib/studio/verify.ts,
// app/[locale]/(dashboard)/approvals/{page.tsx,claim-actions.ts} and studio/actions.ts. Their reads return
// ACTIVE rows only, which is why ratification (ADR 0029 §8.5) is what makes a founder's answer reach a prompt.
//
// recordInterviewCandidates and ratifyInterviewCandidates (ADR 0029 §2.3, §8.5) are the two WRITES
// exported here: the governed entry points that turn grounded interview answers into CANDIDATE
// records, and that let an approver activate or reject them, one decision per candidate.
// recordInterviewCandidates activates nothing; ratifyInterviewCandidates has no accept-all.

export { retrieveRelevant as retrieveBrandMemory } from './brand'
export { retrieveRelevant as retrieveEvidenceMemory, hasActiveEvidence } from './evidence'
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
  listInterviewCandidatesForRound,
  type RecordInterviewCandidatesInput,
  type RatifyInterviewCandidatesInput,
  type InterviewCandidatesByType,
  type RatifyInterviewRoundResult,
} from './interview'
export { readInterviewSlotRows } from './interview-coverage'
export { readInterviewConflictContext, type InterviewConflictRecord } from './interview-conflicts'
// ADR 0030 §6 (Session 36 L2.6) — the dismissal writer's entry point and its ONE reader. retrieveSourceDismissals is for triage's
// list_audience_notes tool ONLY (scan-enforced); dismissal rows are excluded from every other audience read.
export { recomputeDismissalSignal, retrieveSourceDismissals } from './dismissal'

export {
  MEMORY_WRITERS,
  MEMORY_TABLES,
  WRITER_IDS,
  SOURCES_BY_TABLE,
  RPC_INSERT_TABLES,
  importConfidence,
  distilledConfidence,
  type WriterConfidence,
  type WithWriterConfidence,
  type MemoryTable,
  type SourceValue,
  type WriterGate,
  type WriterId,
  type WriterSpec,
} from './writers'

// ADR 0030 §5 (Session 36 L2.8) — the cross-type bundle. The rows are opaque (a module-private WeakMap); the only way to text is
// renderMemoryBundleForPrompt, which returns RenderedMemory. Nothing outside lib/memory imports ./bundle directly (scan-enforced).
export {
  MEMORY_TASK_BUDGET,
  retrieveMemoryBundle,
  renderMemoryBundleForPrompt,
  type MemoryBundle,
  type RenderedMemory,
  type RenderedMemoryBundle,
} from './bundle'

export type { MemoryQueryContext, RetrieveScope, MemoryTask, BundleRequest } from './scoring'
// ADR 0030 §3.2 (Session 36 L2.7) — the ONE model-facing query schema; the planner and triage tools import these, never their own.
export { memoryQueryHintsSchema, MEMORY_QUERY_HINTS_JSON_SCHEMA, type ModelQueryHints } from './query-hints'
export { BRAND_CAP, EVIDENCE_CAP, AUDIENCE_CAP, PERFORMANCE_CAP, SOURCE_DISMISSAL_CAP, MEMORY_SCORE_WEIGHTS } from './constants'
