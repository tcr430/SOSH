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
