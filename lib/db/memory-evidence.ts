import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvidenceMemoryRow, EvidenceMemoryImportInsert } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'

// ADR 0016 §5.1 (Q4) — candidate query only. No scoring, no capping; that is
// lib/memory/evidence.ts's job (B2). business_id is filtered explicitly
// because the generation path reads via service-role, which bypasses RLS
// (ADR §4).
export async function listEvidenceMemoryCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<EvidenceMemoryRow[]> {
  const { data, error } = await client
    .from('evidence_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches evidence_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as EvidenceMemoryRow[]) ?? []
}

// ADR 0017 §9 [db-NIT-2] — the citation-by-id re-fetch that closes the
// freeze→generate staleness gap: a brief pins evidence ids at assembly time,
// but a row can retire between then and generation. Bounded by the caller's
// id array (not MEMORY_CANDIDATE_LIMIT — there is no separate scan to cap),
// filtered to status='active' so a retired id is silently dropped, never
// rendered. This IS the guard, not a bug — lib/ai/wrap-evidence.ts is the
// sole caller.
// Session 24-D (MAJOR-1 correction) — business_id is filtered explicitly,
// same rule as listEvidenceMemoryCandidates above and the same reason: this
// runs under a service-role client on the generation/critique paths, which
// BYPASSES RLS. The citation-by-id boundary (a caller only ever passes ids
// it itself pinned) is real, but was asserted, not enforced — this filter
// is the enforcement, defense in depth alongside it, not a replacement for it.
export async function getEvidenceMemoryByIds(
  client: SupabaseClient,
  businessId: string,
  ids: string[],
): Promise<EvidenceMemoryRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await client
    .from('evidence_memory')
    .select('*')
    .eq('business_id', businessId)
    .in('id', ids)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(getErrorMessage(error))
  return (data as EvidenceMemoryRow[]) ?? []
}

// ADR 0025 §9.4 (Session 32 I2.7) — the ONLY writer that produces
// source='import' evidence_memory rows, over import_evidence_memory
// (20260913140000/150000_*.sql). service-role, lazy-imported, no client
// parameter — matches lib/db/generation-budget.ts's shape. Callers: ONLY
// lib/memory/import.ts (MEM-NO-DIRECT-TABLE-ACCESS; enforced by
// lib/memory/import.test.ts's source scan).
//
// BACKFILL-SENTINEL-GUARDED — neutralizeWithSentinels() (the SAME function
// memory-performance.ts's upsertDistilledPerformancePattern already uses,
// not a second copy) is applied to `content` HERE, at the sole choke point
// this table's import path funnels through, not at the caller — mirrors
// the MEM-PATTERN-SENTINEL-GUARDED precedent exactly. Governance columns
// (source, status, sensitivity, public_use_permission) are fixed inside the
// RPC — this type has no field for them, so they cannot be passed wrong.
export async function importEvidenceMemory(insert: EvidenceMemoryImportInsert): Promise<EvidenceMemoryRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('import_evidence_memory', {
    p_business_id: insert.business_id,
    p_import_run_id: insert.import_run_id,
    p_import_source_post_ids: insert.import_source_post_ids,
    p_kind: insert.kind,
    p_content: neutralizeWithSentinels(insert.content),
    p_source_url: insert.source_url,
    p_scope: insert.scope,
    p_scope_ref: insert.scope_ref,
    p_confidence: insert.confidence,
    p_last_confirmed_at: insert.last_confirmed_at,
    p_expires_at: insert.expires_at,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as EvidenceMemoryRow[]) ?? []
}
