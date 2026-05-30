import { config } from '@/lib/config'

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/stripe/products.ts was imported in browser code. ' +
      'Stripe price IDs must not be bundled client-side.',
  )
}

export type PaidPlan = 'plus' | 'pro'

export const PLAN_TO_PRICE_ID: Record<PaidPlan, string> = {
  plus: config.server.STRIPE_PRICE_ID_PLUS,
  pro: config.server.STRIPE_PRICE_ID_PRO,
}

export const PRICE_ID_TO_PLAN: Record<string, PaidPlan> = Object.fromEntries(
  Object.entries(PLAN_TO_PRICE_ID).map(([plan, priceId]) => [priceId, plan as PaidPlan]),
)

export function planForPriceId(priceId: string): PaidPlan | null {
  return PRICE_ID_TO_PLAN[priceId] ?? null
}
