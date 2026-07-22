import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandMemoryRow } from '@/lib/db/types'
import { listBrandMemoryCandidates } from '@/lib/db/memory-brand'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap, type MemoryQueryContext } from './scoring'
import { BRAND_CAP } from './constants'

// ADR 0016 §5.1/§5.2 — the retrieval boundary for brand_memory. Candidate
// fetch is B1's job (lib/db/memory-brand.ts); this scores + hard-caps.
// `limit` bounds the DB candidate scan (default MEMORY_CANDIDATE_LIMIT), NOT
// the output — the output is always ≤ BRAND_CAP (L-4).
export async function retrieveRelevant(
  client: SupabaseClient,
  businessId: string,
  queryContext: MemoryQueryContext,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<BrandMemoryRow[]> {
  const candidates = await listBrandMemoryCandidates(client, businessId, limit)
  return rankAndCap(candidates, queryContext, BRAND_CAP)
}
