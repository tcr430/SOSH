import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceMemoryRow, AudienceMemoryImportInsert, InterviewConflictTargetRow } from './types'
import { INTERVIEW_CANDIDATES_LIMIT_PER_TABLE, INTERVIEW_CONFLICT_TARGETS_LIMIT, INTERVIEW_THINNESS_ROW_LIMIT } from '@/lib/interview/constants'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'
import type { WithWriterConfidence } from '@/lib/memory'

// ADR 0016 §5.1 (Q4) — candidate query only. No scoring, no capping; that is
// lib/memory/audience.ts's job (B2). business_id is filtered explicitly
// because the generation path reads via service-role, which bypasses RLS
// (ADR §4).
export async function listAudienceMemoryCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<AudienceMemoryRow[]> {
  const { data, error } = await client
    .from('audience_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    // ADR 0030 §6.8 (Session 36 L2.6) — dismissal rows are EXCLUDED FROM THIS SHARED READ, IN THE QUERY and BEFORE the LIMIT, exactly as
    // listPerformanceMemoryCandidates excludes 'outcome' (memory-performance.ts). A post-fetch filter would let up to `limit` dismissal
    // rows crowd real audience facts out of the window. They state which WATCHED SOURCES a business keeps rejecting, a triage fact, not
    // something a brief, plan or post should argue from; their one reader is listSourceDismissalCandidates below.
    // Readers that inherit this: retrieveAudienceMemory (brief, planner tools, Studio) and readInterviewConflictContext.
    .neq('source', 'dismissal')
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches audience_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[]) ?? []
}

// ADR 0030 §6.8 (Session 36 L2.6) — the ONE dedicated reader of source='dismissal' audience rows. Same business_id / status / deleted_at /
// ORDER BY / LIMIT shape as the shared read, on audience_memory_retrieval_idx. It is reached only through retrieveSourceDismissals in
// lib/memory/dismissal.ts (scan-enforced), and its one consumer is triage's list_audience_notes tool (L2.9). NO seventh copy of any
// sanitiser: these statements were built in SQL from a template and a regex-checked identifier (ADR §6.3), and every read path neutralises
// and quotes them anyway (ADR §7.2).
export async function listSourceDismissalCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<AudienceMemoryRow[]> {
  const { data, error } = await client
    .from('audience_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('source', 'dismissal')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[]) ?? []
}

// ADR 0030 §6.5 (Session 36 L2.6) — the ONLY writer of source='dismissal' audience_memory rows, over recompute_dismissal_audience_signal
// (20260929140000). service-role, LAZILY imported, NO client parameter (so a caller cannot hand it an authenticated client and trigger
// silent permission failures). Its input is the CARD ID and nothing else, Zod-validated as a UUID BEFORE any client is created: there is
// no field a governance value (source, status, confidence, business_id, decision_key, statement) could travel in, and the RPC computes all
// of them in SQL from rows it reads itself (SUBSTRATE-GOVERNANCE-NOT-SUPPLIED, W8). Callers: ONLY lib/memory/dismissal.ts
// (scan-enforced). Returns the RPC's outcome text; it never swallows an error, because whether a failure is non-fatal is the caller's call.
const CARD_ID_SCHEMA = z.string().uuid()

export async function recomputeDismissalAudienceSignal(cardId: string): Promise<string> {
  const p_card_id = CARD_ID_SCHEMA.parse(cardId)
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('recompute_dismissal_audience_signal', { p_card_id })
  if (error) throw new Error(getErrorMessage(error))
  return data as string
}

// ADR 0025 §9.4 (Session 32 I2.7) — the ONLY writer that produces
// source='import' audience_memory rows, over import_audience_memory
// (20260913140000/150000_*.sql). service-role, lazy-imported, no client
// parameter. Callers: ONLY lib/memory/import.ts (MEM-NO-DIRECT-TABLE-ACCESS;
// enforced by lib/memory/import.test.ts's source scan).
//
// BACKFILL-SENTINEL-GUARDED — neutralizeWithSentinels() applied to
// `statement` HERE, the sole choke point, mirroring memory-evidence.ts's
// importEvidenceMemory and the MEM-PATTERN-SENTINEL-GUARDED precedent.
// Governance columns are fixed inside the RPC — this type has no field for
// them.
export async function importAudienceMemory(
  // ADR 0030 §2.2 [type-4] — `confidence` is a WriterConfidence<'import'> (importConfidence(), band (0, 0.60]); value unchanged.
  insert: WithWriterConfidence<AudienceMemoryImportInsert, 'import'>,
): Promise<AudienceMemoryRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('import_audience_memory', {
    p_business_id: insert.business_id,
    p_import_run_id: insert.import_run_id,
    p_import_source_post_ids: insert.import_source_post_ids,
    p_segment: insert.segment,
    p_kind: insert.kind,
    p_statement: neutralizeWithSentinels(insert.statement),
    p_scope: insert.scope,
    p_scope_ref: insert.scope_ref,
    p_confidence: insert.confidence,
    p_last_confirmed_at: insert.last_confirmed_at,
    p_expires_at: insert.expires_at,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[]) ?? []
}

// ADR 0025 §10.3 (Session 32 I2.14) — see listEvidenceCandidatesForRun's
// comment in memory-evidence.ts for the run-scoping rationale.
export async function listAudienceCandidatesForRun(
  client: SupabaseClient,
  runId: string,
): Promise<AudienceMemoryRow[]> {
  const { data, error } = await client
    .from('audience_memory')
    .select('*')
    .eq('import_run_id', runId)
    .eq('source', 'import')
    .eq('status', 'candidate')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .limit(25)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[]) ?? []
}

// ADR 0029 §3.2 (Session 35 M2.7) — the THINNESS read: one business's ACTIVE, undeleted, unexpired audience_memory rows, from
// EVERY source, reduced to the columns the pure thinness function reads. Business-scoped and bounded (limit 500 =
// INTERVIEW_THINNESS_ROW_LIMIT, §9.5). The per-slot grouping happens in TypeScript over this one business's rows: the
// audience_memory_retrieval_idx partial index covers business_id + status = 'active' but NOT kind, so this is an ACCEPTED
// SCAN within one business, not claimed index coverage [db-NIT-3]. ORDER BY matches the retrieval index. Reached only
// through lib/memory/interview-coverage.ts (MEM-NO-DIRECT-TABLE-ACCESS). `nowIso` is a parameter — no hidden clock.
export type AudienceSlotRow = Pick<AudienceMemoryRow, 'kind' | 'status' | 'recency_at' | 'expires_at' | 'deleted_at'>

export async function listAudienceSlotRows(
  client: SupabaseClient,
  businessId: string,
  nowIso: string,
  limit: number = INTERVIEW_THINNESS_ROW_LIMIT,
): Promise<AudienceSlotRow[]> {
  const { data, error } = await client
    .from('audience_memory')
    .select('kind, status, recency_at, expires_at, deleted_at')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceSlotRow[] | null) ?? []
}

// ADR 0029 §8.4/§9.5 (Session 35 M2.9) — the ratification read, audience half. See
// listBrandInterviewCandidates (memory-brand.ts) for the shape and the ORDER BY rationale.
export async function listAudienceInterviewCandidates(
  client: SupabaseClient,
  answerIds: string[],
  limit = INTERVIEW_CANDIDATES_LIMIT_PER_TABLE,
): Promise<AudienceMemoryRow[]> {
  if (answerIds.length === 0) return []
  const { data, error } = await client
    .from('audience_memory')
    .select('*')
    .in('interview_answer_id', answerIds)
    .eq('source', 'interview')
    .eq('status', 'candidate')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[] | null) ?? []
}

// ADR 0029 §4.5/§8.4 (Session 35-D D5, MAJOR-3) — the ratify view's conflict-target read: the id, display text, status and
// source of the audience_memory rows a candidate's `interview_conflict_ids` name. The ids come from the candidates the SAME call
// just read (never from client input), and the caller's own client applies RLS, so another tenant's row is simply not
// returned. Soft-deleted rows are excluded. Bounded by INTERVIEW_CONFLICT_TARGETS_LIMIT; ORDER BY id (the primary key). It
// only ever feeds a DISPLAY hint: ratify_interview_round re-verifies a replace target (active, source = 'interview', same
// business) in SQL.
export async function listAudienceConflictTargets(
  client: SupabaseClient,
  ids: string[],
  limit = INTERVIEW_CONFLICT_TARGETS_LIMIT,
): Promise<InterviewConflictTargetRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await client
    .from('audience_memory')
    .select('id, statement, status, source')
    .in('id', ids)
    .is('deleted_at', null)
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as Array<{ id: string; statement: string; status: InterviewConflictTargetRow['status']; source: InterviewConflictTargetRow['source'] }> | null) ?? []).map((r) => ({
    id: r.id,
    text: r.statement,
    status: r.status,
    source: r.source,
  }))
}
