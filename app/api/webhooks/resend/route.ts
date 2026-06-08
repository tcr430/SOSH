import { Webhook } from 'svix'
import { config } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ResendPayload = {
  type: string
  data: {
    email_id: string
    to: string[]
    [key: string]: unknown
  }
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const svixId = req.headers.get('svix-id') ?? ''
  const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
  const svixSignature = req.headers.get('svix-signature') ?? ''

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Bad signature', { status: 400 })
  }

  const wh = new Webhook(config.server.RESEND_WEBHOOK_SECRET)
  let payload: ResendPayload
  try {
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendPayload
  } catch {
    return new Response('Bad signature', { status: 400 })
  }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { recordWebhookEvent } = await import('@/lib/db/email-webhook-events')
  const result = await recordWebhookEvent(client, {
    id: svixId,
    event_type: payload.type,
    payload,
  })

  if (!result.inserted) {
    console.log(JSON.stringify({ kind: 'email.webhook', type: result.normalised_event_type, deduped: true, suppressedWritten: false }))
    return new Response('OK', { status: 200 })
  }

  let suppressedWritten = false

  if (payload.type === 'email.bounced' || payload.type === 'email.complained') {
    const recipient = (payload.data.to[0] ?? '').toLowerCase()
    if (recipient) {
      const { upsertSuppression } = await import('@/lib/db/email-suppressions')
      await upsertSuppression(client, {
        email: recipient,
        reason: payload.type === 'email.bounced' ? 'bounce' : 'complaint',
        source_event_id: svixId,
      })
      suppressedWritten = true
    }
  }

  console.log(JSON.stringify({ kind: 'email.webhook', type: result.normalised_event_type, deduped: false, suppressedWritten }))
  return new Response('OK', { status: 200 })
}
