import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialAccountRow, SocialAccountInsert, SocialAccountUpdate } from './types'

export async function listAllSocialAccounts(
  client: SupabaseClient,
  businessId: string,
  limit = 100,
): Promise<SocialAccountRow[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('business_id', businessId)
    .limit(limit)
  if (error) throw new Error((error as { message: string }).message)
  return (data as SocialAccountRow[]) ?? []
}

export async function listActiveSocialAccounts(
  client: SupabaseClient,
  businessId: string,
): Promise<SocialAccountRow[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
  if (error) throw new Error((error as { message: string }).message)
  return (data as SocialAccountRow[]) ?? []
}

export async function getSocialAccountById(
  client: SupabaseClient,
  id: string,
): Promise<SocialAccountRow> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!data) throw new Error(`Social account ${id} not found`)
  return data as SocialAccountRow
}

export async function createSocialAccount(
  client: SupabaseClient,
  data: SocialAccountInsert,
): Promise<SocialAccountRow> {
  const { data: row, error } = await client
    .from('social_accounts')
    .insert(data)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error('Failed to create social account')
  return row as SocialAccountRow
}

export async function updateSocialAccount(
  client: SupabaseClient,
  id: string,
  data: SocialAccountUpdate,
): Promise<SocialAccountRow> {
  const { data: row, error } = await client
    .from('social_accounts')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Social account ${id} not found`)
  return row as SocialAccountRow
}

export async function deactivateSocialAccount(id: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()

  const account = await getSocialAccountById(serviceClient, id)

  const { error } = await serviceClient
    .from('social_accounts')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error((error as { message: string }).message)

  const { error: accessError } = await serviceClient.rpc('vault.delete_secret', {
    secret_id: account.vault_access_token_id,
  })
  if (accessError) throw new Error((accessError as { message: string }).message)

  if (account.vault_refresh_token_id) {
    const { error: refreshError } = await serviceClient.rpc('vault.delete_secret', {
      secret_id: account.vault_refresh_token_id,
    })
    if (refreshError) throw new Error((refreshError as { message: string }).message)
  }
}
