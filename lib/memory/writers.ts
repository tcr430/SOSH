import type { MemoryScope } from '@/lib/db/types'

// ADR 0030 §2.1 — the writer registry. `source` stays a per-table named CHECK; this literal is the TS mirror the
// scans (lib/memory/substrate-scans.test.ts) and the Tier-1 drift test read, so a new source value fails to
// compile until it is registered here. It is a REGISTRY, not a write path: nothing here calls a database, and
// no governance value (confidence, status, sensitivity) is ever read from it at write time (L-3).
//
// 'manual' is a RETIRED, WRITERLESS source: it stays in the four CHECKs for history, and after ADR 0030 §2.4
// nothing can write it (no rpcNames, no wrappers, no soleCallerModule).
//
// The dismissal entry (ADR 0030 §6) is NOT here: it lands with its RPC in L2.5.

export const MEMORY_TABLES = ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'] as const
export type MemoryTable = (typeof MEMORY_TABLES)[number]

export type WriterGate = 'human_ratification' | 'min_n'

export type WriterSpec = {
  /** Tables the writer's RPCs write to. Empty for the retired, writerless 'manual' source. */
  readonly tables: readonly MemoryTable[]
  /** Tables whose `<table>_source_check` admits this value (history included). */
  readonly checkTables: readonly MemoryTable[]
  /** Every SQL function this writer owns (ADR 0030 §2.2 W1–W9 apply to each). */
  readonly rpcNames: readonly string[]
  /** The exported `lib/db/memory-*.ts` functions that call those RPCs (scan arms 1 and 2). */
  readonly wrappers: readonly string[]
  /** The one module (an exact file, or a directory when it ends in '/') allowed to import the wrappers. */
  readonly soleCallerModule: string | null
  readonly gate: WriterGate | null
  /** Per-table confidence ceiling enforced by a SQL CHECK (ADR 0030 §4.1). Absent = no ceiling. */
  readonly confidenceCeiling: Readonly<Partial<Record<MemoryTable, number>>>
  /** The sources this writer may retire: its own only (ADR 0030 §4.2). */
  readonly mayRetire: readonly string[]
  /** The closed set of `scope` values the writer emits (ADR 0030 §2.1, [type-2]). */
  readonly scopes: readonly MemoryScope[]
}

export const MEMORY_WRITERS = {
  manual: {
    tables: [],
    checkTables: ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'],
    rpcNames: [],
    wrappers: [],
    soleCallerModule: null,
    gate: null,
    confidenceCeiling: {},
    mayRetire: [],
    scopes: [],
  },
  distilled: {
    tables: ['performance_memory'],
    checkTables: ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'],
    rpcNames: ['upsert_distilled_performance_pattern', 'promote_performance_pattern', 'demote_performance_pattern'],
    wrappers: ['upsertDistilledPerformancePattern', 'promotePerformancePattern', 'demotePerformancePattern'],
    // Two files call the wrappers today (promote.ts and summarize.ts), so the sole caller is the module directory.
    soleCallerModule: 'lib/learning/',
    gate: 'min_n',
    confidenceCeiling: { performance_memory: 0.95 },
    mayRetire: ['distilled'],
    scopes: ['brand', 'platform'],
  },
  import: {
    tables: ['evidence_memory', 'audience_memory', 'performance_memory'],
    checkTables: ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'],
    rpcNames: ['import_evidence_memory', 'import_audience_memory', 'import_performance_memory'],
    wrappers: ['importEvidenceMemory', 'importAudienceMemory', 'importPerformanceMemory'],
    soleCallerModule: 'lib/memory/import.ts',
    gate: 'human_ratification',
    confidenceCeiling: { evidence_memory: 0.6, audience_memory: 0.6, performance_memory: 0.6 },
    mayRetire: ['import'],
    scopes: ['platform'],
  },
  outcome: {
    tables: ['performance_memory'],
    checkTables: ['performance_memory'],
    rpcNames: [
      'upsert_outcome_performance_pattern',
      'promote_outcome_pattern',
      'demote_outcome_pattern',
      'acknowledge_campaign_retrospective',
    ],
    wrappers: ['upsertOutcomePattern', 'promoteOutcomePattern', 'demoteOutcomePattern'],
    soleCallerModule: 'lib/outcomes/orchestrator.ts',
    gate: 'min_n',
    // No ceiling: the retrospective formula can exceed 0.95 (ADR 0030 §4.1).
    confidenceCeiling: {},
    mayRetire: ['outcome'],
    // 'campaign' is the hypothesis row acknowledge_campaign_retrospective writes (20260919140000:376-381).
    scopes: ['platform', 'campaign'],
  },
  interview: {
    tables: ['brand_memory', 'evidence_memory', 'audience_memory'],
    checkTables: ['brand_memory', 'evidence_memory', 'audience_memory'],
    rpcNames: ['write_interview_candidates', 'ratify_interview_round'],
    wrappers: ['writeInterviewCandidates', 'ratifyInterviewRound'],
    soleCallerModule: 'lib/memory/interview.ts',
    gate: 'human_ratification',
    confidenceCeiling: { brand_memory: 0.6, evidence_memory: 0.6, audience_memory: 0.6 },
    mayRetire: ['interview'],
    scopes: ['brand'],
  },
  // ADR 0030 §6 — the ONE decision-derived writer (L-6): card dismissal reasons -> audience_memory. A recompute-in-place writer
  // (W7, W9), deterministic (L-7). The SQL half was registered in L2.5; the TS half (wrapper + sole caller) lands here in L2.6.
  // listSourceDismissalCandidates is the reader, not a writer, so it is not a wrapper.
  dismissal: {
    tables: ['audience_memory'],
    checkTables: ['audience_memory'],
    rpcNames: ['recompute_dismissal_audience_signal'],
    wrappers: ['recomputeDismissalAudienceSignal'],
    soleCallerModule: 'lib/memory/dismissal.ts',
    gate: 'min_n',
    confidenceCeiling: { audience_memory: 0.5 },
    mayRetire: ['dismissal'],
    scopes: ['brand'],
  },
} as const satisfies Record<string, WriterSpec>

// ─── WriterConfidence (ADR 0030 §2.2, [type-4]) ─────────────────────────────────────────────────────────────────────
//
// For the two writers whose confidence is legitimately COMPUTED IN TS and forwarded (import, distilled), the wrapper's
// `confidence` parameter is a branded type that only a per-writer constructor below can make, and each constructor THROWS
// outside that writer's band. This is a FIRST line, not the guarantee: the SQL ceiling CHECK (20260929120000) is what
// enforces the band, and this ADR does not claim a governance field is unrepresentable for these two writers. What the brand
// buys is that a bare `number` (a model-derived value, a mistyped constant) no longer type-checks at the wrapper.
//
// The constructors forward the value UNCHANGED (`toBe` in the tests): threading them through the wrappers changes no value
// any writer sends (L-2).
declare const writerConfidenceBrand: unique symbol
export type WriterConfidence<W extends 'import' | 'distilled'> = number & { readonly [writerConfidenceBrand]: W }

/** A wrapper input whose `confidence` must be a minted WriterConfidence, every other field unchanged. */
export type WithWriterConfidence<T extends { confidence: number }, W extends 'import' | 'distilled'> = Omit<T, 'confidence'> & {
  confidence: WriterConfidence<W>
}

const IMPORT_CONFIDENCE_CEILING = MEMORY_WRITERS.import.confidenceCeiling.evidence_memory
const DISTILLED_CONFIDENCE_CEILING = MEMORY_WRITERS.distilled.confidenceCeiling.performance_memory

/** import band (0, 0.60]: every shipped import confidence is positive (audience 0.3, evidence 0.5, performance 0.6*n/(n+5)). */
export function importConfidence(value: number): WriterConfidence<'import'> {
  if (!Number.isFinite(value) || value <= 0 || value > IMPORT_CONFIDENCE_CEILING) {
    throw new Error(`importConfidence: ${value} is outside (0, ${IMPORT_CONFIDENCE_CEILING}]`)
  }
  return value as WriterConfidence<'import'>
}

/**
 * distilled band [0, 0.95]. Unlike import, 0 is IN the band: computeConfidence (lib/learning/promote.ts) returns 0 when
 * contradictions >= observations and that 0 is forwarded today, so throwing on it would change the writer (L-2).
 */
export function distilledConfidence(value: number): WriterConfidence<'distilled'> {
  if (!Number.isFinite(value) || value < 0 || value > DISTILLED_CONFIDENCE_CEILING) {
    throw new Error(`distilledConfidence: ${value} is outside [0, ${DISTILLED_CONFIDENCE_CEILING}]`)
  }
  return value as WriterConfidence<'distilled'>
}

export type WriterId = keyof typeof MEMORY_WRITERS
/** A `source` column value. Registered writers and source values are the same set. */
export type SourceValue = WriterId

export const WRITER_IDS = Object.keys(MEMORY_WRITERS) as WriterId[]

/** The tables each RPC INSERTs into (Scan arm 4 compares the evidence entries to ADR 0027's allow-list). */
export const RPC_INSERT_TABLES: Readonly<Record<string, readonly MemoryTable[]>> = {
  upsert_distilled_performance_pattern: ['performance_memory'],
  promote_performance_pattern: [],
  demote_performance_pattern: [],
  import_evidence_memory: ['evidence_memory'],
  import_audience_memory: ['audience_memory'],
  import_performance_memory: ['performance_memory'],
  upsert_outcome_performance_pattern: ['performance_memory'],
  promote_outcome_pattern: [],
  demote_outcome_pattern: [],
  acknowledge_campaign_retrospective: ['performance_memory'],
  write_interview_candidates: ['brand_memory', 'evidence_memory', 'audience_memory'],
  ratify_interview_round: [],
  recompute_dismissal_audience_signal: ['audience_memory'],
}

/** The `source` values each table's named CHECK admits, derived from the registry. */
const sourcesFor = (table: MemoryTable): readonly SourceValue[] =>
  WRITER_IDS.filter((id) => (MEMORY_WRITERS[id].checkTables as readonly MemoryTable[]).includes(table))

// Spelled out per table so a fifth governed store fails to compile until it is listed here.
export const SOURCES_BY_TABLE: Readonly<Record<MemoryTable, readonly SourceValue[]>> = {
  brand_memory: sourcesFor('brand_memory'),
  evidence_memory: sourcesFor('evidence_memory'),
  audience_memory: sourcesFor('audience_memory'),
  performance_memory: sourcesFor('performance_memory'),
}
