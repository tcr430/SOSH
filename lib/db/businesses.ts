import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow, BusinessInsert, BusinessUpdate, Plan } from './types'
import type { PaidPlan } from '@/lib/stripe/products'
import { getErrorMessage } from './utils'
import { toUtcIso } from '@/lib/utils'

export async function getBusinessById(
  client: SupabaseClient,
  id: string,
): Promise<BusinessRow> {
  const { data, error } = await client
    .from('businesses')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Business ${id} not found`)
  return data as BusinessRow
}

export async function getBusinessByOwner(
  client: SupabaseClient,
  ownerId: string,
): Promise<BusinessRow | null> {
  const { data, error } = await client
    .from('businesses')
    .select('*')
    .eq('owner_id', ownerId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessRow | null) ?? null
}

export async function createBusiness(
  client: SupabaseClient,
  data: BusinessInsert,
): Promise<BusinessRow> {
  const { data: row, error } = await client
    .from('businesses')
    .insert(data)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error('Failed to create business')
  return row as BusinessRow
}

export async function updateBusiness(
  client: SupabaseClient,
  id: string,
  data: BusinessUpdate,
): Promise<BusinessRow> {
  const { data: row, error } = await client
    .from('businesses')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Business ${id} not found`)
  return row as BusinessRow
}

export async function updateBusinessPlan(
  id: string,
  fields: { plan?: Plan; stripe_customer_id?: string | null; stripe_subscription_id?: string | null },
): Promise<BusinessRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data: row, error } = await client
    .from('businesses')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Business ${id} not found`)
  return row as BusinessRow
}

export async function completeOnboarding(businessId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('businesses')
    .update({ onboarding_completed: true })
    .eq('id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}

export async function softDeleteBusiness(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('businesses')
    .update({ deleted_at: toUtcIso(new Date()) })
    .eq('id', id)
  if (error) throw new Error(getErrorMessage(error))
}

export async function findBusinessByStripeCustomerId(
  stripeCustomerId: string,
): Promise<BusinessRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('businesses')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessRow | null) ?? null
}

export async function updateBillingFromSubscription(input: {
  stripeCustomerId: string
  stripeSubscriptionId: string
  plan: PaidPlan
}): Promise<BusinessRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('businesses')
    .update({
      plan: input.plan,
      stripe_subscription_id: input.stripeSubscriptionId,
      updated_at: toUtcIso(new Date()),
    })
    .eq('stripe_customer_id', input.stripeCustomerId)
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessRow | null) ?? null
}

export async function clearBillingOnCancellation(input: {
  stripeCustomerId: string
}): Promise<BusinessRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('businesses')
    .update({
      plan: 'trial' as Plan,
      stripe_subscription_id: null,
      updated_at: toUtcIso(new Date()),
    })
    .eq('stripe_customer_id', input.stripeCustomerId)
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessRow | null) ?? null
}

export async function incrementBusinessPublishedCount(
  client: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { data, error } = await client.rpc('increment_business_published_count', {
    p_business_id: businessId,
  })
  if (error) throw new Error(getErrorMessage(error))
  return data as number
}

export async function setStripeCustomerId(input: {
  businessId: string
  stripeCustomerId: string
}): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { data, error } = await client
    .from('businesses')
    .update({ stripe_customer_id: input.stripeCustomerId })
    .eq('id', input.businessId)
    .or(`stripe_customer_id.is.null,stripe_customer_id.eq.${input.stripeCustomerId}`)
    .is('deleted_at', null)
    .select()
    .maybeSingle()

  if (error) throw new Error(getErrorMessage(error))

  if (data === null) {
    // No rows matched — check whether the business exists with a different customer ID
    const { data: existing, error: fetchError } = await client
      .from('businesses')
      .select('stripe_customer_id')
      .eq('id', input.businessId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchError) throw new Error(getErrorMessage(fetchError))

    const existingId = (existing as { stripe_customer_id: string | null } | null)?.stripe_customer_id
    if (existing !== null && existingId !== null && existingId !== input.stripeCustomerId) {
      throw new Error(
        `Business ${input.businessId} already has Stripe customer ${existingId}; refusing to overwrite with ${input.stripeCustomerId}`,
      )
    }
  }
}
