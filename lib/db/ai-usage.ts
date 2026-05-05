import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiUsageRow, AiUsageInsert } from './types'

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
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error('Failed to record AI usage')
  return row as AiUsageRow
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
  if (error) throw new Error((error as { message: string }).message)
  return (data as AiUsageRow[]) ?? []
}
