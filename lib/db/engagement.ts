import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EngagementInboxRow,
  EngagementInboxInsert,
  EngagementInboxUpdate,
  EngagementStatus,
} from './types'

export async function listEngagementItems(
  client: SupabaseClient,
  businessId: string,
  status?: EngagementStatus,
  limit = 50,
  offset = 0,
): Promise<EngagementInboxRow[]> {
  let query = client
    .from('engagement_inbox')
    .select('*')
    .eq('business_id', businessId)

  if (status !== undefined) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
    .order('received_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1)
  if (error) throw new Error((error as { message: string }).message)
  return (data as EngagementInboxRow[]) ?? []
}

export async function createEngagementItem(
  data: EngagementInboxInsert,
): Promise<EngagementInboxRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data: row, error } = await client
    .from('engagement_inbox')
    .insert(data)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error('Failed to create engagement item')
  return row as EngagementInboxRow
}

export async function updateEngagementItem(
  id: string,
  data: EngagementInboxUpdate,
): Promise<EngagementInboxRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data: row, error } = await client
    .from('engagement_inbox')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Engagement item ${id} not found`)
  return row as EngagementInboxRow
}
