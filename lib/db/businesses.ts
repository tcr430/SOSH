import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow, BusinessInsert, BusinessUpdate, Plan } from './types'
import type { PaidPlan } from '@/lib/stripe/products'
import { getErrorMessage } from './utils'
import { toUtcIso } from '@/lib/utils'
import { parseISO } from 'date-fns'

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

export async function getBusinessForUser(
  client: SupabaseClient,
  userId: string,
  preferredBusinessId?: string,
): Promise<BusinessRow | null> {
  const { data, error } = await client
    .from('businesses')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(50)
  if (error) throw new Error(getErrorMessage(error))

  const businesses = (data as BusinessRow[] | null) ?? []
  if (businesses.length === 0) return null

  if (preferredBusinessId) {
    const preferred = businesses.find((b) => b.id === preferredBusinessId)
    if (preferred) return preferred
  }

  const owned = businesses.find((b) => b.owner_id === userId)
  if (owned) return owned

  return businesses[0]
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

// Keyset page of live business ids for the service-role workers (ADR 0026 J2.8: the outcome tick visits one
// business per iteration). Ordered on the primary key; bounded.
export async function listBusinessIdsPage(afterId: string | null, limit = 100): Promise<string[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  let query = client.from('businesses').select('id').is('deleted_at', null)
  if (afterId !== null) query = query.gt('id', afterId)
  const { data, error } = await query.order('id', { ascending: true }).limit(Math.min(Math.max(limit, 1), 500))
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).map((r) => r.id as string)
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

// ── Report eligibility (ADR 0031 §5.2; founder ruling O-2, Session 37 O2.7) ────────────────────────────────────
// No single liveness predicate existed (the 14-day trial arithmetic was inline in two pages, and
// clearBillingOnCancellation resets plan to 'trial' and nulls stripe_subscription_id), so it is written ONCE here.
//
//   * a LIVE TRIAL is plan = 'trial' AND trial_started_at set AND under TRIAL_LENGTH_DAYS old: a business whose trial
//     clock never started gets no report and no stub;
//   * a LIVE PAID business has a non-null stripe_subscription_id. An unknown plan string on a live business is live and
//     is served the basic tier by hasAdvancedAnalytics (fail closed), never "no report".
// Pure: the clock is an argument.
export const TRIAL_LENGTH_DAYS = 14

export function isLiveForReports(
  business: { plan: unknown; stripe_subscription_id: string | null; trial_started_at: string | null },
  now: string,
): boolean {
  if (business.plan === 'trial') {
    if (business.trial_started_at === null) return false
    const started = parseISO(business.trial_started_at).getTime()
    const at = parseISO(now).getTime()
    if (!Number.isFinite(started) || !Number.isFinite(at)) throw new Error('isLiveForReports: non-finite timestamp')
    return at < started + TRIAL_LENGTH_DAYS * 86_400_000
  }
  return business.stripe_subscription_id !== null && business.stripe_subscription_id !== ''
}

// The worker's read of one business (service-role, no client parameter): the row the loaders and the generator need.
export async function getBusinessByIdForWorker(businessId: string): Promise<BusinessRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.from('businesses').select('*').eq('id', businessId).is('deleted_at', null).single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error('Business ' + businessId + ' not found')
  return data as BusinessRow
}

export async function getTrialStartedAtForWorker(businessId: string): Promise<{ business_id: string; trial_started_at: string | null } | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.from('trial_state').select('business_id, trial_started_at').eq('business_id', businessId).maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as { business_id: string; trial_started_at: string | null } | null) ?? null
}
