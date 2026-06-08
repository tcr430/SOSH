import type { Stripe } from '@/lib/stripe/webhook'
import { config } from '@/lib/config'
import { enqueueEmail } from '@/lib/email/enqueue'

function planLabel(plan: string): string {
  if (plan === 'pro') return 'Pro'
  return 'Plus'
}

export async function enqueueWelcomeToPlan(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session
  const businessId = session.client_reference_id
  if (!businessId) return

  const recipient = session.customer_email?.toLowerCase() ?? ''
  if (!recipient) return

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { getBusinessById } = await import('@/lib/db/businesses')
  const business = await getBusinessById(client, businessId)

  const appUrl = config.server.APP_URL

  await enqueueEmail({
    business_id: business.id,
    kind: 'welcome-to-plan',
    recipient,
    locale: business.language,
    props: {
      businessName: business.name,
      planName: planLabel(business.plan),
      dashboardUrl: `${appUrl}/${business.language}/campaigns`,
    },
    dedupe_token: event.id,
  })
}

export async function enqueuePaymentFailedCourtesy(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : (invoice.customer as Stripe.Customer | null)?.id ?? null
  if (!customerId) return

  const { findBusinessByStripeCustomerId } = await import('@/lib/db/businesses')
  const business = await findBusinessByStripeCustomerId(customerId)
  if (!business) return

  const recipient = (invoice.customer_email ?? '').toLowerCase()
  if (!recipient) return

  const appUrl = config.server.APP_URL

  await enqueueEmail({
    business_id: business.id,
    kind: 'payment-failed-courtesy',
    recipient,
    locale: business.language,
    props: {
      businessName: business.name,
      billingPortalUrl: `${appUrl}/${business.language}/billing`,
    },
    dedupe_token: event.id,
  })
}
