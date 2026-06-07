import { isEmailSuppressed } from '@/lib/db/email-suppressions'
import { insertEmailOutboxRow } from '@/lib/db/email-outbox'
import type { EmailKind, EmailLocale } from './types'

export interface EnqueueEmailInput {
  business_id: string
  kind: EmailKind
  recipient: string
  locale: EmailLocale
  props: Record<string, unknown>
  dedupe_token?: string | null
}

export interface EnqueueEmailResult {
  outcome: 'enqueued' | 'deduped' | 'suppressed'
  row_id: string | null
}

export async function enqueueEmail(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const recipient = input.recipient.toLowerCase().trim()

  const suppressed = await isEmailSuppressed(client, recipient)

  const { inserted, row } = await insertEmailOutboxRow(client, {
    business_id: input.business_id,
    kind: input.kind,
    recipient,
    locale: input.locale,
    props: input.props,
    dedupe_token: input.dedupe_token ?? null,
    status: suppressed ? 'suppressed' : 'pending',
  })

  const outcome: EnqueueEmailResult['outcome'] =
    !inserted ? 'deduped' : suppressed ? 'suppressed' : 'enqueued'

  // Canonical structured log — ADR 0008 §17
  console.log(
    JSON.stringify({
      kind: 'email.enqueue',
      email_kind: input.kind,
      business_id: input.business_id,
      locale: input.locale,
      outcome,
    }),
  )

  return { outcome, row_id: row?.id ?? null }
}
