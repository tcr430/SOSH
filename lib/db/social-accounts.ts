import { captureException } from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Platform, SocialAccountRow, SocialAccountInsert, SocialAccountUpdate } from './types'
import { getErrorMessage } from './utils'

export type SocialAccountPublic = {
  platform: Platform
  platform_username: string
  platform_display_name: string | null
  is_active: boolean
  connected_at: string
  token_expires_at: string | null
}

type SocialAccountWithoutVault = Omit<SocialAccountRow, 'vault_access_token_id' | 'vault_refresh_token_id'>

const SOCIAL_ACCOUNT_PUBLIC_COLUMNS =
  'id, business_id, platform, platform_user_id, platform_username, platform_display_name, token_expires_at, is_active, connected_at, created_at, updated_at' as const

export async function listAllSocialAccounts(
  client: SupabaseClient,
  businessId: string,
  limit = 100,
): Promise<SocialAccountWithoutVault[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq('business_id', businessId)
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountWithoutVault[]) ?? []
}

export async function listActiveSocialAccounts(
  client: SupabaseClient,
  businessId: string,
): Promise<SocialAccountWithoutVault[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq('business_id', businessId)
    .eq('is_active', true)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountWithoutVault[]) ?? []
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
  if (error) throw new Error(getErrorMessage(error))
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
  if (error) throw new Error(getErrorMessage(error))
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
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Social account ${id} not found`)
  return row as SocialAccountRow
}

export async function deactivateSocialAccount(id: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()

  const account = await getSocialAccountById(serviceClient, id)

  const { error } = await serviceClient
    .from('social_accounts')
    .update({
      is_active: false,
      vault_access_token_id: null,
      vault_refresh_token_id: null,
    })
    .eq('id', id)
  if (error) throw new Error(getErrorMessage(error))

  try {
    await serviceClient.rpc('vault_delete_secret', {
      secret_id: account.vault_access_token_id,
    })
  } catch (err) {
    captureException(err, { tags: { operation: 'vault_delete_secret' } })
  }

  if (account.vault_refresh_token_id) {
    try {
      await serviceClient.rpc('vault_delete_secret', {
        secret_id: account.vault_refresh_token_id,
      })
    } catch (err) {
      captureException(err, { tags: { operation: 'vault_delete_secret' } })
    }
  }
}

export async function getActiveByBusinessAndPlatform(
  client: SupabaseClient,
  businessId: string,
  platform: Platform,
): Promise<SocialAccountRow | null> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('platform', platform)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountRow | null) ?? null
}

export async function listByBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = 50,
): Promise<SocialAccountPublic[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select('platform, platform_username, platform_display_name, is_active, connected_at, token_expires_at')
    .eq('business_id', businessId)
    .order('connected_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountPublic[]) ?? []
}
