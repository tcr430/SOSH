import type { SupabaseClient } from '@supabase/supabase-js'

function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    'message' in e && typeof (e as { message: unknown }).message === 'string'
  )
}

function dbError(e: unknown): Error {
  return new Error(isPostgresError(e) ? e.message : 'Database error')
}

export async function recordWebhookEvent(
  client: SupabaseClient,
  input: {
    id: string
    event_type: string
    payload: unknown
  },
): Promise<{ inserted: boolean }> {
  const { error } = await client
    .from('email_webhook_events')
    .insert({
      id: input.id,
      event_type: input.event_type,
      payload: input.payload as Record<string, unknown>,
    })

  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { inserted: false }
    }
    throw dbError(error)
  }

  return { inserted: true }
}
