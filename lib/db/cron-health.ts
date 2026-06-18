import type { SupabaseClient } from '@supabase/supabase-js'
import { toUtcIso } from '@/lib/utils'

export async function markCronSeen(client: SupabaseClient, slug: string): Promise<void> {
  await client.from('cron_health').upsert(
    { cron_slug: slug, last_seen_at: toUtcIso(new Date()) },
    { onConflict: 'cron_slug' },
  )
}

export async function getCronLastSeen(client: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await client
    .from('cron_health')
    .select('last_seen_at')
    .eq('cron_slug', slug)
    .maybeSingle()
  return data?.last_seen_at ?? null
}
