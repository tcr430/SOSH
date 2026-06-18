import type { SupabaseClient } from '@supabase/supabase-js'
import { toUtcIso } from '@/lib/utils'

export async function pruneStaleAuthRateLimits(client: SupabaseClient): Promise<number> {
  const { count } = await client
    .from('auth_rate_limits')
    .delete({ count: 'exact' })
    .lt('updated_at', toUtcIso(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  return count ?? 0
}
