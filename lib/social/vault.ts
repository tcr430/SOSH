import type { SupabaseClient } from '@supabase/supabase-js'
import { addSeconds } from 'date-fns'
import { SocialProviderError } from './errors'
import { TOKEN_REFRESH_SKEW_SECONDS } from './constants'

interface SocialAccountVaultRow {
  is_active: boolean
  vault_access_token_id: string | null
  vault_refresh_token_id: string | null
  token_expires_at: string | null
}

async function getServiceClient(): Promise<SupabaseClient> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  return createServiceRoleClient()
}

async function querySocialAccountRow(
  client: SupabaseClient,
  socialAccountId: string,
): Promise<SocialAccountVaultRow> {
  const { data, error } = await client
    .from('social_accounts')
    .select('is_active, vault_access_token_id, vault_refresh_token_id, token_expires_at')
    .eq('id', socialAccountId)
    .single()

  if (error || !data) {
    throw new SocialProviderError({
      code: 'TOKEN_REVOKED',
      message: `Social account ${socialAccountId} not found`,
    })
  }

  return data as SocialAccountVaultRow
}

async function queryVaultSecret(client: SupabaseClient, secretId: string): Promise<string> {
  const { data, error } = await client.rpc('get_vault_secret', { secret_id: secretId })

  if (error || data === null || data === undefined) {
    throw new SocialProviderError({
      code: 'TOKEN_REVOKED',
      message: 'Vault secret not found or unreadable',
    })
  }

  return data as string
}

export async function readAccessToken(
  socialAccountId: string,
): Promise<{ token: string; tokenExpiresAt: string | null }> {
  const client = await getServiceClient()
  const account = await querySocialAccountRow(client, socialAccountId)

  if (!account.is_active || !account.vault_access_token_id) {
    throw new SocialProviderError({
      code: 'TOKEN_REVOKED',
      message: `Social account ${socialAccountId} is inactive or has no access token`,
    })
  }

  const token = await queryVaultSecret(client, account.vault_access_token_id)
  return { token, tokenExpiresAt: account.token_expires_at }
}

export async function readRefreshToken(
  socialAccountId: string,
): Promise<{ token: string }> {
  const client = await getServiceClient()
  const account = await querySocialAccountRow(client, socialAccountId)

  if (!account.vault_refresh_token_id) {
    throw new SocialProviderError({
      code: 'TOKEN_REVOKED',
      message: `Social account ${socialAccountId} has no refresh token`,
    })
  }

  const token = await queryVaultSecret(client, account.vault_refresh_token_id)
  return { token }
}

export async function withFreshToken<T>(
  socialAccountId: string,
  refreshFn: (id: string) => Promise<unknown>,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const client = await getServiceClient()
  const account = await querySocialAccountRow(client, socialAccountId)

  if (!account.is_active || !account.vault_access_token_id) {
    throw new SocialProviderError({
      code: 'TOKEN_REVOKED',
      message: `Social account ${socialAccountId} is inactive or disconnected`,
    })
  }

  const needsRefresh =
    account.token_expires_at !== null &&
    new Date(account.token_expires_at) <= addSeconds(new Date(), TOKEN_REFRESH_SKEW_SECONDS)

  if (needsRefresh) {
    await refreshFn(socialAccountId)
  }

  const token = await queryVaultSecret(client, account.vault_access_token_id)
  return fn(token)
}
