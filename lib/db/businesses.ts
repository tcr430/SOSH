import { formatISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow, BusinessInsert, BusinessUpdate, Plan } from './types'

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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Business ${id} not found`)
  return row as BusinessRow
}

export async function softDeleteBusiness(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('businesses')
    .update({ deleted_at: formatISO(new Date()) })
    .eq('id', id)
  if (error) throw new Error((error as { message: string }).message)
}
