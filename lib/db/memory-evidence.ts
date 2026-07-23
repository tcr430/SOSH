import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvidenceMemoryRow } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'

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
export async function getEvidenceMemoryByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<EvidenceMemoryRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await client
    .from('evidence_memory')
    .select('*')
    .in('id', ids)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(getErrorMessage(error))
  return (data as EvidenceMemoryRow[]) ?? []
}
