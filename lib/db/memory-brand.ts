import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandMemoryRow } from './types'
import { INTERVIEW_CANDIDATES_LIMIT_PER_TABLE, INTERVIEW_THINNESS_ROW_LIMIT } from '@/lib/interview/constants'
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

// ADR 0029 §3.2 (Session 35 M2.7) — the THINNESS read: one business's ACTIVE, undeleted, unexpired brand_memory rows, from
// EVERY source, reduced to the columns the pure thinness function reads. Business-scoped and bounded (limit 500 =
// INTERVIEW_THINNESS_ROW_LIMIT, §9.5). The per-slot grouping happens in TypeScript over this one business's rows: the
// brand_memory_retrieval_idx partial index covers business_id + status = 'active' but NOT category, so this is an ACCEPTED
// SCAN within one business, not claimed index coverage [db-NIT-3]. ORDER BY matches the retrieval index. Reached only
// through lib/memory/interview-coverage.ts (MEM-NO-DIRECT-TABLE-ACCESS). `nowIso` is a parameter — no hidden clock.
export type BrandSlotRow = Pick<BrandMemoryRow, 'category' | 'status' | 'recency_at' | 'expires_at' | 'deleted_at'>

export async function listBrandSlotRows(
  client: SupabaseClient,
  businessId: string,
  nowIso: string,
  limit: number = INTERVIEW_THINNESS_ROW_LIMIT,
): Promise<BrandSlotRow[]> {
  const { data, error } = await client
    .from('brand_memory')
    .select('category, status, recency_at, expires_at, deleted_at')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('confidence', { ascending: false })
    .order('recency_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as BrandSlotRow[] | null) ?? []
}

// ADR 0029 §8.4/§9.5 (Session 35 M2.9) — the ratification read: one round's brand candidates, via the
// `brand_memory_interview_answer_id_idx` (interview_answer_id IN ...), scoped a second time by
// source = 'interview' and status = 'candidate' (the writer's own invariant, re-checked, not trusted).
// Bounded (limit 24 = INTERVIEW_CANDIDATES_LIMIT_PER_TABLE — a round never proposes more). ORDER BY
// created_at: the index covers the equality filter, not this table's sort key, so this is an accepted
// scan within one round's candidates (at most 24 rows), the same trade-off as [db-NIT-3] elsewhere in this
// file. The caller's client (RLS applies); `answerIds` comes from the round's OWN answers
// (listAnswersForRound), never from client input directly.
export async function listBrandInterviewCandidates(
  client: SupabaseClient,
  answerIds: string[],
  limit = INTERVIEW_CANDIDATES_LIMIT_PER_TABLE,
): Promise<BrandMemoryRow[]> {
  if (answerIds.length === 0) return []
  const { data, error } = await client
    .from('brand_memory')
    .select('*')
    .in('interview_answer_id', answerIds)
    .eq('source', 'interview')
    .eq('status', 'candidate')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as BrandMemoryRow[] | null) ?? []
}
