import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceMemoryRow } from '@/lib/db/types'
import { listAudienceMemoryCandidates } from '@/lib/db/memory-audience'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap, type MemoryQueryContext } from './scoring'
import { AUDIENCE_CAP } from './constants'

// ADR 0016 §5.1/§5.2 — the retrieval boundary for audience_memory. Candidate
// fetch is B1's job (lib/db/memory-audience.ts); this scores + hard-caps.
// `limit` bounds the DB candidate scan (default MEMORY_CANDIDATE_LIMIT), NOT
// the output — the output is always ≤ AUDIENCE_CAP (L-4).
export async function retrieveRelevant(
  client: SupabaseClient,
  businessId: string,
  queryContext: MemoryQueryContext,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<AudienceMemoryRow[]> {
  const candidates = await listAudienceMemoryCandidates(client, businessId, limit)
  return rankAndCap(candidates, queryContext, AUDIENCE_CAP)
}
