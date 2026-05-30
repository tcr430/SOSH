import Stripe from 'stripe'
import { config } from '@/lib/config'

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/stripe/client.ts was imported in browser code. ' +
      'Stripe server SDK must not be bundled client-side.',
  )
}

let _stripe: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(config.server.STRIPE_SECRET_KEY)
  }
  return _stripe
}
