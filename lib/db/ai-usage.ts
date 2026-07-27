import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiUsageRow, AiUsageInsert } from './types'
import { toUtcIso } from '@/lib/utils'
import { getErrorMessage } from './utils'

export async function recordAiUsage(
  data: AiUsageInsert,
): Promise<AiUsageRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data: row, error } = await client
    .from('ai_usage')
    .insert(data)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error('Failed to record AI usage')
  return row as AiUsageRow
}

export async function countRecentCalls(
  client: SupabaseClient,
  businessId: string,
  windowSeconds: number,
  promptId: string,
): Promise<number> {
  const since = toUtcIso(new Date(Date.now() - windowSeconds * 1000))
  const { count, error } = await client
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('prompt_id', promptId)
    .gte('created_at', since)
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

// ADR 0018 §6.2 — the cadence gate's "since its last summary" reference
// point, and §6.2's monthly ceiling both count FROM this existing table
// rather than a new tracking column — one less piece of state to keep in
// sync. Returns null when no successful call has ever been recorded (first
// summarization for this business), which callers must treat as "the
// interval gate is trivially satisfied" (ADR §6.2: nothing to wait for
// yet), never as an error.
export async function getLastSuccessfulCallAt(
  client: SupabaseClient,
  businessId: string,
  promptId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('ai_usage')
    .select('created_at')
    .eq('business_id', businessId)
    .eq('prompt_id', promptId)
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as { created_at: string } | null)?.created_at ?? null
}

export async function listAiUsageByBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = 100,
): Promise<AiUsageRow[]> {
  const { data, error } = await client
    .from('ai_usage')
    .select('*')
    .eq('business_id', businessId)
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as AiUsageRow[]) ?? []
}
