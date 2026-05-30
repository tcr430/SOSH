import type Stripe from 'stripe'
import { getStripeClient } from '@/lib/stripe/client'
import { planForPriceId } from '@/lib/stripe/products'
import {
  findBusinessByStripeCustomerId,
  updateBillingFromSubscription,
  clearBillingOnCancellation,
} from '@/lib/db/businesses'
import { recordTrialCardFingerprint } from '@/lib/db/trial-state'
import { config } from '@/lib/config'
import type { BillingEventOutcome } from '@/lib/db/billing-events'

export class WebhookSignatureError extends Error {
  constructor() {
    super('Webhook signature verification failed')
    this.name = 'WebhookSignatureError'
  }
}

export interface WebhookOutcome {
  outcome: BillingEventOutcome
  businessId: string | null
}

export function parseWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event {
  if (!signatureHeader) {
    throw new WebhookSignatureError()
  }

  const stripe = getStripeClient()
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      config.server.STRIPE_WEBHOOK_SECRET,
    )
  } catch {
    throw new WebhookSignatureError()
  }
}

const CANCELLATION_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired'])

export async function dispatchWebhookEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  const stripe = getStripeClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null

    let businessId: string | null = (session.client_reference_id as string | null) ?? null
    if (!businessId && customerId) {
      const biz = await findBusinessByStripeCustomerId(customerId)
      businessId = biz?.id ?? null
    }
    if (!businessId) {
      return { outcome: 'ignored_no_business', businessId: null }
    }

    if (!subscriptionId || !customerId) {
      return { outcome: 'ignored_no_business', businessId }
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const priceId = subscription.items.data[0]?.price.id ?? null
    if (!priceId) {
      return { outcome: 'ignored_unknown_price', businessId }
    }

    const plan = planForPriceId(priceId)
    if (!plan) {
      return { outcome: 'ignored_unknown_price', businessId }
    }

    const updated = await updateBillingFromSubscription({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan,
    })
    if (!updated) {
      return { outcome: 'ignored_no_business', businessId }
    }

    // Non-fatal: record trial card fingerprint if available
    try {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null
      const setupIntentId = typeof session.setup_intent === 'string'
        ? session.setup_intent
        : session.setup_intent?.id ?? null

      let paymentMethodId: string | null = null
      if (paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
        paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id ?? null
      } else if (setupIntentId) {
        const si = await stripe.setupIntents.retrieve(setupIntentId)
        paymentMethodId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null
      }

      if (paymentMethodId) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
        const fingerprint = pm.card?.fingerprint ?? null
        if (fingerprint) {
          await recordTrialCardFingerprint({ businessId, fingerprint })
        }
      }
    } catch {
      // Non-fatal — plan upgrade already applied
    }

    return { outcome: 'applied', businessId }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const priceId = subscription.items.data[0]?.price.id ?? null

    if (CANCELLATION_STATUSES.has(subscription.status)) {
      const updated = await clearBillingOnCancellation({ stripeCustomerId: customerId })
      const businessId = updated?.id ?? null
      return { outcome: updated ? 'applied' : 'ignored_no_business', businessId }
    }

    if (!priceId) {
      return { outcome: 'ignored_unknown_price', businessId: null }
    }
    const plan = planForPriceId(priceId)
    if (!plan) {
      return { outcome: 'ignored_unknown_price', businessId: null }
    }

    const subscriptionId = subscription.id
    // Stripe delivers subscription.updated events in order
    // per customer, but retried events may arrive out of order.
    // Phase 1 accepted risk: a stale retry could overwrite a
    // newer plan. Bounded because Stripe retries are short-lived
    // (< 3 days) and our plans are monotonically upgrading in
    // Phase 1. A Phase 2 fix would compare
    // event.data.object.current_period_start against the
    // business's stripe_current_period_start column (not yet
    // stored). No code change needed today.
    const updated = await updateBillingFromSubscription({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan,
    })
    const businessId = updated?.id ?? null
    return { outcome: updated ? 'applied' : 'ignored_no_business', businessId }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const updated = await clearBillingOnCancellation({ stripeCustomerId: customerId })
    const businessId = updated?.id ?? null
    return { outcome: updated ? 'applied' : 'ignored_no_business', businessId }
  }

  if (event.type === 'invoice.payment_failed') {
    return { outcome: 'applied', businessId: null }
  }

  return { outcome: 'applied', businessId: null }
}
