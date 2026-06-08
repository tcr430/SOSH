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

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.opened',
  'email.clicked',
])

export async function recordWebhookEvent(
  client: SupabaseClient,
  input: {
    id: string
    event_type: string
    payload: unknown
  },
): Promise<{ inserted: boolean; normalised_event_type: string }> {
  const normalised = KNOWN_EVENT_TYPES.has(input.event_type) ? input.event_type : 'other'

  const { error } = await client
    .from('email_webhook_events')
    .insert({
      id: input.id,
      event_type: normalised,
      payload: input.payload as Record<string, unknown>,
    })

  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { inserted: false, normalised_event_type: normalised }
    }
    throw dbError(error)
  }

  return { inserted: true, normalised_event_type: normalised }
}
