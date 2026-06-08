import { formatISO, subMinutes } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailOutboxRow, EmailOutboxStatus, EmailKind, Language } from './types'

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

// Legal status transitions per ADR 0008 §5 status machine.
const LEGAL_TRANSITIONS: Readonly<Record<EmailOutboxStatus, readonly EmailOutboxStatus[]>> = {
  pending:    ['sending'],
  sending:    ['sent', 'failed', 'pending', 'suppressed'],
  sent:       [],
  failed:     [],
  suppressed: [],
}

export async function insertEmailOutboxRow(
  client: SupabaseClient,
  input: {
    business_id: string
    kind: EmailKind
    recipient: string
    locale: Language
    props: Record<string, unknown>
    dedupe_token?: string | null
    status: 'pending' | 'suppressed'
  },
): Promise<{ inserted: boolean; row: EmailOutboxRow | null }> {
  const { data, error } = await client
    .from('email_outbox')
    .insert({
      business_id: input.business_id,
      kind: input.kind,
      recipient: input.recipient,
      locale: input.locale,
      props: input.props,
      dedupe_token: input.dedupe_token ?? null,
      status: input.status,
    })
    .select()
    .single()

  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { inserted: false, row: null }
    }
    throw dbError(error)
  }

  return { inserted: true, row: data as EmailOutboxRow }
}

export async function claimEmailOutboxBatch(
  client: SupabaseClient,
  batchSize: number,
): Promise<EmailOutboxRow[]> {
  const { data, error } = await client.rpc('claim_email_outbox', { batch_size: batchSize })
  if (error) throw dbError(error)
  return (data ?? []) as EmailOutboxRow[]
}

export async function transitionEmailOutboxRow(
  client: SupabaseClient,
  rowId: string,
  next: {
    status: EmailOutboxStatus
    attempts?: number
    next_attempt_at?: string | null
    last_error?: string | null
    provider_message_id?: string | null
    sent_at?: string | null
  },
): Promise<EmailOutboxRow | null> {
  const { data: current, error: fetchError } = await client
    .from('email_outbox')
    .select('status')
    .eq('id', rowId)
    .single()

  if (fetchError) throw dbError(fetchError)
  if (!current) return null

  const currentStatus = (current as { status: EmailOutboxStatus }).status
  const allowed = LEGAL_TRANSITIONS[currentStatus]

  if (!allowed.includes(next.status)) {
    throw new Error(`Illegal email_outbox transition: ${currentStatus} → ${next.status}`)
  }

  const update: Record<string, unknown> = { status: next.status }
  if (next.attempts !== undefined) update.attempts = next.attempts
  if (next.next_attempt_at !== undefined) update.next_attempt_at = next.next_attempt_at
  if (next.last_error !== undefined) update.last_error = next.last_error
  if (next.provider_message_id !== undefined) update.provider_message_id = next.provider_message_id
  if (next.sent_at !== undefined) update.sent_at = next.sent_at

  const { data, error } = await client
    .from('email_outbox')
    .update(update)
    .eq('id', rowId)
    .select()
    .single()

  if (error) throw dbError(error)
  return (data as EmailOutboxRow) ?? null
}

export async function reapStuckSendingRows(
  client: SupabaseClient,
  stuckMinutes: number,
  now?: Date,
): Promise<number> {
  const base = now ?? new Date()
  const cutoff = formatISO(subMinutes(base, stuckMinutes))
  const { data, error } = await client
    .from('email_outbox')
    .update({ status: 'pending', next_attempt_at: formatISO(base) })
    .eq('status', 'sending')
    .lt('updated_at', cutoff)
    .select()

  if (error) throw dbError(error)
  return Array.isArray(data) ? data.length : 0
}
