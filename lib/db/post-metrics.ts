import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostMetricsRow, PostMetricsInsert } from './types'
import { getErrorMessage } from './utils'

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
  if (error) throw new Error(getErrorMessage(error))
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
  if (error) throw new Error(getErrorMessage(error))
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
  if (error) throw new Error(getErrorMessage(error))
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
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostMetricsRow[]) ?? []
}

// ── Analytics read (ADR 0031 §9.1 row 5; Session 37 O2.4) ─────────────────────────────────────────────────────
// The raw "so far" counts of ONE post, never an aggregate source and never compared (ADR 0031 §2.1). AUTHENTICATED,
// business-bound, on UNIQUE (post_id), 120 ids a chunk. Left alone: listTopPostMetrics (ADR 0031 §9.2).

export type MetricsForAnalytics = Pick<PostMetricsRow, 'post_id' | 'business_id' | 'likes' | 'comments' | 'shares' | 'impressions' | 'last_synced_at'>

const METRICS_CHUNK = 120

export async function listMetricsForPosts(
  client: SupabaseClient,
  businessId: string,
  postIds: readonly string[],
): Promise<MetricsForAnalytics[]> {
  const ids = [...new Set(postIds)]
  const out: MetricsForAnalytics[] = []
  for (let i = 0; i < ids.length; i += METRICS_CHUNK) {
    const { data, error } = await client
      .from('post_metrics')
      .select('post_id, business_id, likes, comments, shares, impressions, last_synced_at')
      .eq('business_id', businessId)
      .in('post_id', ids.slice(i, i + METRICS_CHUNK))
      .order('post_id', { ascending: true })
      .limit(METRICS_CHUNK)
    if (error) throw new Error(getErrorMessage(error))
    out.push(...((data ?? []) as MetricsForAnalytics[]))
  }
  return out
}
