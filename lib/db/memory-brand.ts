import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandMemoryRow } from './types'
import { getErrorMessage } from './utils'
import { MEMORY_CANDIDATE_LIMIT } from './memory-constants'

// ADR 0016 §5.1 (Q4) — candidate query only. No scoring, no capping; that is
// lib/memory/brand.ts's job (B2). business_id is filtered explicitly because
// the generation path reads via service-role, which bypasses RLS (ADR §4).
export async function listBrandMemoryCandidates(
  client: SupabaseClient,
  businessId: string,
  limit = MEMORY_CANDIDATE_LIMIT,
): Promise<BrandMemoryRow[]> {
  const { data, error } = await client
    .from('brand_memory')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false }) // = COALESCE(last_confirmed_at, created_at), matches brand_memory_retrieval_idx
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as BrandMemoryRow[]) ?? []
}
