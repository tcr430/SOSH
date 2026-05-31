import type { SupabaseClient } from '@supabase/supabase-js'

export async function pruneStaleAuthRateLimits(client: SupabaseClient): Promise<number> {
  const { count } = await client
    .from('auth_rate_limits')
    .delete({ count: 'exact' })
    .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  return count ?? 0
}
