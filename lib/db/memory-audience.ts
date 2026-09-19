import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceMemoryRow, AudienceMemoryImportInsert } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'

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
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches audience_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AudienceMemoryRow[]) ?? []
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
export async function importAudienceMemory(insert: AudienceMemoryImportInsert): Promise<AudienceMemoryRow[]> {
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
