function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    'message' in e && typeof (e as { message: unknown }).message === 'string'
  )
}

export type BillingEventOutcome =
  | 'applied'
  | 'ignored_unknown_price'
  | 'ignored_no_business'
  | 'ignored_duplicate'
  | 'error'

export interface RecordedBillingEvent {
  id: string
  type: string
  business_id: string | null
  processed_outcome: BillingEventOutcome
}

export async function recordBillingEvent(input: {
  id: string
  type: string
  businessId: string | null
  stripeCustomerId: string | null
  payload: unknown
  outcome: BillingEventOutcome
}): Promise<{ duplicate: boolean }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { error } = await client.from('billing_events').insert({
    id: input.id,
    type: input.type,
    business_id: input.businessId,
    stripe_customer_id: input.stripeCustomerId,
    payload: input.payload as Record<string, unknown>,
    processed_outcome: input.outcome,
  })

  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { duplicate: true }
    }
    throw new Error(isPostgresError(error) ? error.message : 'Database error')
  }

  return { duplicate: false }
}

export async function updateBillingEventOutcome(
  id: string,
  outcome: BillingEventOutcome,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('billing_events')
    .update({ processed_outcome: outcome })
    .eq('id', id)
  if (error) throw new Error(isPostgresError(error) ? error.message : 'Database error')
}
