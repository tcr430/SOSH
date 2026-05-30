import { headers } from 'next/headers'
import { parseWebhookEvent, dispatchWebhookEvent, WebhookSignatureError } from '@/lib/stripe/webhook'
import { recordBillingEvent, updateBillingEventOutcome } from '@/lib/db/billing-events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request): Promise<Response> {
  const start = Date.now()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')
  // Raw body required: Stripe signs the exact bytes.
  // req.json() would re-serialise and break the signature.
  const rawBody = await req.text()

  let event
  try {
    event = parseWebhookEvent(rawBody, signature)
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.log(
        JSON.stringify({
          kind: 'stripe_webhook',
          eventId: null,
          eventType: null,
          businessId: null,
          outcome: 'error',
          durationMs: Date.now() - start,
          signatureOk: false,
        }),
      )
      return new Response(null, { status: 400 })
    }
    throw err
  }

  // Pre-record with 'error' sentinel FIRST so duplicate
  // deliveries are idempotent regardless of what happens
  // in dispatch. The unique PK violation is the
  // serialisation point.
  const { duplicate } = await recordBillingEvent({
    id: event.id,
    type: event.type,
    businessId: null,
    stripeCustomerId: null,
    payload: event,
    outcome: 'error',
  })

  if (duplicate) {
    console.log(
      JSON.stringify({
        kind: 'stripe_webhook',
        eventId: event.id,
        eventType: event.type,
        businessId: null,
        outcome: 'ignored_duplicate',
        durationMs: Date.now() - start,
        signatureOk: true,
      }),
    )
    return Response.json({ received: true })
  }

  let outcome: string = 'applied'
  let businessId: string | null = null
  try {
    const result = await dispatchWebhookEvent(event)
    outcome = result.outcome
    businessId = result.businessId
    await updateBillingEventOutcome(event.id, result.outcome)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateBillingEventOutcome(event.id, 'error').catch(() => undefined)
    console.log(
      JSON.stringify({
        kind: 'stripe_webhook',
        eventId: event.id,
        eventType: event.type,
        businessId: null,
        outcome: 'error',
        error: message,
        durationMs: Date.now() - start,
        signatureOk: true,
      }),
    )
    return new Response(null, { status: 500 })
  }

  console.log(
    JSON.stringify({
      kind: 'stripe_webhook',
      eventId: event.id,
      eventType: event.type,
      businessId,
      outcome,
      durationMs: Date.now() - start,
      signatureOk: true,
    }),
  )

  return Response.json({ received: true })
}
