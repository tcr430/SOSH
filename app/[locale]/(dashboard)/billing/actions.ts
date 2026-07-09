'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { createCheckoutSession, createBillingPortalSession, NoBillingCustomerError } from '@/lib/stripe/checkout'
import type { PaidPlan } from '@/lib/stripe/products'

const planSchema = z.enum(['plus', 'pro'])
const localeSchema = z.enum(['en', 'pt', 'es'])

export async function startCheckoutAction(
  locale: string,
  plan: PaidPlan,
): Promise<{ url?: string; error?: 'auth' | 'no_business' | 'unknown' }> {
  if (!planSchema.safeParse(plan).success) return { error: 'unknown' }
  if (!localeSchema.safeParse(locale).success) return { error: 'unknown' }

  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return { error: 'auth' }

    const business = await getBusinessForUser(client, user.id)
    if (!business) return { error: 'no_business' }

    const { url } = await createCheckoutSession({
      businessId: business.id,
      plan,
      successPath: `/${locale}/billing/success`,
      cancelPath: `/${locale}/billing`,
    })

    return { url }
  } catch {
    return { error: 'unknown' }
  }
}

export async function openBillingPortalAction(
  locale: string,
): Promise<{ url?: string; error?: 'auth' | 'no_business' | 'no_customer' }> {
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return { error: 'auth' }

    const business = await getBusinessForUser(client, user.id)
    if (!business) return { error: 'no_business' }

    const { url } = await createBillingPortalSession({
      businessId: business.id,
      returnPath: `/${locale}/billing`,
    })

    return { url }
  } catch (err) {
    if (err instanceof NoBillingCustomerError) return { error: 'no_customer' }
    return { error: 'no_business' }
  }
}
