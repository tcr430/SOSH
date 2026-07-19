import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvidenceMemoryRow } from '@/lib/db/types'
import { listEvidenceMemoryCandidates } from '@/lib/db/memory-evidence'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap, type MemoryQueryContext } from './scoring'
import { EVIDENCE_CAP } from './constants'

// ADR 0016 §5.1/§5.2 — the retrieval boundary for evidence_memory. Candidate
// fetch is B1's job (lib/db/memory-evidence.ts); this scores + hard-caps.
// `limit` bounds the DB candidate scan (default MEMORY_CANDIDATE_LIMIT), NOT
// the output — the output is always ≤ EVIDENCE_CAP (L-4).
export async function retrieveRelevant(
  client: SupabaseClient,
  businessId: string,
  queryContext: MemoryQueryContext,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<EvidenceMemoryRow[]> {
  const candidates = await listEvidenceMemoryCandidates(client, businessId, limit)
  return rankAndCap(candidates, queryContext, EVIDENCE_CAP)
}
