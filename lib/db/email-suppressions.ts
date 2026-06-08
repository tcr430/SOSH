import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailSuppressionReason } from './types'

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

export async function isEmailSuppressed(
  client: SupabaseClient,
  email: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('email_suppressions')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (error) throw dbError(error)
  return data !== null
}

export async function upsertSuppression(
  client: SupabaseClient,
  input: {
    email: string
    reason: EmailSuppressionReason
    source_event_id?: string | null
  },
): Promise<{ inserted: boolean }> {
  const { error } = await client
    .from('email_suppressions')
    .insert({
      email: input.email.toLowerCase(),
      reason: input.reason,
      source_event_id: input.source_event_id ?? null,
    })

  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { inserted: false }
    }
    throw dbError(error)
  }

  return { inserted: true }
}
