import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostMetricsRow, PostMetricsInsert } from './types'

export async function upsertPostMetrics(
  data: PostMetricsInsert,
): Promise<PostMetricsRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data: row, error } = await client
    .from('post_metrics')
    .upsert(data, { onConflict: 'post_id' })
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error('Failed to upsert post metrics')
  return row as PostMetricsRow
}

export async function getPostMetricsByPostId(
  client: SupabaseClient,
  postId: string,
): Promise<PostMetricsRow | null> {
  const { data, error } = await client
    .from('post_metrics')
    .select('*')
    .eq('post_id', postId)
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
  return (data as PostMetricsRow | null) ?? null
}

export async function listTopPostMetrics(
  client: SupabaseClient,
  businessId: string,
  limit = 10,
): Promise<PostMetricsRow[]> {
  const { data, error } = await client
    .from('post_metrics')
    .select('*')
    .eq('business_id', businessId)
    .order('likes', { ascending: false })
    .limit(limit)
  if (error) throw new Error((error as { message: string }).message)
  return (data as PostMetricsRow[]) ?? []
}

export async function listStalePostMetrics(
  client: SupabaseClient,
  beforeDate: string,
  limit = 100,
): Promise<PostMetricsRow[]> {
  const { data, error } = await client
    .from('post_metrics')
    .select('*')
    .lt('last_synced_at', beforeDate)
    .limit(limit)
  if (error) throw new Error((error as { message: string }).message)
  return (data as PostMetricsRow[]) ?? []
}
