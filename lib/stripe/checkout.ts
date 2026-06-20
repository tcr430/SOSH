if (typeof window !== 'undefined') {
  throw new Error(
    'lib/stripe/checkout.ts was imported in browser code. ' +
      'Checkout session creation must only run server-side.',
  )
}

import { getStripeClient } from '@/lib/stripe/client'
import { PLAN_TO_PRICE_ID } from '@/lib/stripe/products'
import { getBusinessById, setStripeCustomerId } from '@/lib/db/businesses'
import { config } from '@/lib/config'
import type { PaidPlan } from '@/lib/stripe/products'

export class NoBillingCustomerError extends Error {
  constructor(businessId: string) {
    super(`Business ${businessId} has no Stripe customer ID. Connect a payment method first.`)
    this.name = 'NoBillingCustomerError'
  }
}

export async function createCheckoutSession(input: {
  businessId: string
  plan: PaidPlan
  successPath: string
  cancelPath: string
}): Promise<{ url: string }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const business = await getBusinessById(client, input.businessId)

  const stripe = getStripeClient()

  let customerId = business.stripe_customer_id
  if (customerId === null) {
    const { data, error } = await client.auth.admin.getUserById(business.owner_id)
    if (error || !data.user) {
      throw new Error(`Could not fetch owner email for business ${input.businessId}`)
    }
    const customer = await stripe.customers.create({
      email: data.user.email,
      metadata: { business_id: business.id },
    })
    customerId = customer.id
    await setStripeCustomerId({ businessId: business.id, stripeCustomerId: customerId })
  }

  const appUrl = config.public.APP_URL
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: PLAN_TO_PRICE_ID[input.plan], quantity: 1 }],
    success_url: appUrl + input.successPath + '?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: appUrl + input.cancelPath,
    // client_reference_id lets the webhook resolve the business
    // even if the customer lookup races with account creation.
    client_reference_id: business.id,
    // No trial_period_days — our 14-day trial is product-level
    // (gated by trial_state), not billing-level. Stripe bills
    // from day one of the paid subscription.
    subscription_data: {
      metadata: { business_id: business.id },
    },
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
  })

  if (!session.url) {
    throw new Error('Stripe checkout session URL is null — unexpected for subscription mode')
  }

  return { url: session.url }
}

export async function createBillingPortalSession(input: {
  businessId: string
  returnPath: string
}): Promise<{ url: string }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const business = await getBusinessById(client, input.businessId)

  if (!business.stripe_customer_id) {
    throw new NoBillingCustomerError(business.id)
  }

  const stripe = getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripe_customer_id,
    return_url: config.public.APP_URL + input.returnPath,
  })

  return { url: session.url }
}
