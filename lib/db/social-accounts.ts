import { captureException } from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Platform, SocialAccountRow, SocialAccountInsert, SocialAccountUpdate } from './types'
import { getErrorMessage } from './utils'

export type SocialAccountPublic = {
  id: string
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

// ADR 0028 §5.3 (N2.5) — getActiveByBusinessAndPlatform is REPLACED, not
// patched: it used .maybeSingle() and threw when two active rows matched,
// which the dual-identity model (a founder profile + a business page, or two
// X connections) makes a real, reachable state. A by-id resolver serves the
// publish path (a specific, named identity); a list-returning resolver
// serves callers that legitimately want every identity.

export async function getActiveById(
  client: SupabaseClient,
  id: string,
): Promise<SocialAccountRow | null> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountRow | null) ?? null
}

export async function listActiveByBusinessAndPlatform(
  client: SupabaseClient,
  businessId: string,
  platform: Platform,
  limit = 10,
): Promise<SocialAccountRow[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('platform', platform)
    .eq('is_active', true)
    .order('connected_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountRow[]) ?? []
}

export type AccountResolution =
  | { outcome: 'resolved'; account: SocialAccountRow }
  | { outcome: 'none' }
  | { outcome: 'ambiguous' }

// The shared resolver behind ADR 0028 §5.3's resolution order, used by both
// the publishing and metrics orchestrators: posts.social_account_id when
// set; otherwise the business's default account for that platform (exactly
// one active row); otherwise failure. A PINNED identity that is gone,
// inactive, or belongs to a DIFFERENT business or platform resolves to
// 'none', never 'ambiguous' and never a silent substitution of a different
// identity — publishing (or syncing metrics for) the wrong identity is
// worse than not doing so at all. SOCIAL-PINNED-ACCOUNT-TENANT-CHECKED
// (Session 30.5-D, D2, MAJOR-2): getActiveById filters only on id +
// is_active, and both production callers pass a service-role client that
// bypasses RLS — this function is the only guard point, so it must check
// business_id and platform itself rather than trust the caller or RLS.
export async function resolvePublishAccount(
  client: SupabaseClient,
  businessId: string,
  platform: Platform,
  pinnedAccountId: string | null,
): Promise<AccountResolution> {
  if (pinnedAccountId) {
    const account = await getActiveById(client, pinnedAccountId)
    if (!account || account.business_id !== businessId || account.platform !== platform) {
      return { outcome: 'none' }
    }
    return { outcome: 'resolved', account }
  }
  const candidates = await listActiveByBusinessAndPlatform(client, businessId, platform)
  if (candidates.length === 0) return { outcome: 'none' }
  if (candidates.length > 1) return { outcome: 'ambiguous' }
  return { outcome: 'resolved', account: candidates[0] }
}

export async function listByBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = 50,
): Promise<SocialAccountPublic[]> {
  const { data, error } = await client
    .from('social_accounts')
    .select('id, platform, platform_username, platform_display_name, is_active, connected_at, token_expires_at')
    .eq('business_id', businessId)
    .order('connected_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialAccountPublic[]) ?? []
}
