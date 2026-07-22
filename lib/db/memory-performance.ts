import type { SupabaseClient } from '@supabase/supabase-js'
import type { PerformanceMemoryRow } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'

// ADR 0016 §5.1 (Q4) — candidate query only. No scoring, no capping; that is
// lib/memory/performance.ts's job (B2), which also prefers this table's
// rows over the post_metrics-derived fallback once Track C populates it
// (ADR §3.4). business_id is filtered explicitly because the generation
// path reads via service-role, which bypasses RLS (ADR §4).
export async function listPerformanceMemoryCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<PerformanceMemoryRow[]> {
  const { data, error } = await client
    .from('performance_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches performance_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PerformanceMemoryRow[]) ?? []
}
