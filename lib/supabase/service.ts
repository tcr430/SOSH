import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '@/lib/config'

let _client: SupabaseClient | undefined

export function createServiceRoleClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      config.public.SUPABASE_URL,
      config.server.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )
  }
  return _client
}
