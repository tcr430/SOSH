import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { config } from '@/lib/config'
import { getRegistry, verifyOAuthState, isPlatform } from '@/lib/social'
import type { OAuthStateClaims, TokenSet } from '@/lib/social'
import type { VaultSecretId } from '@/lib/db/types'
import { getBusinessById } from '@/lib/db/businesses'
import { formatISO } from 'date-fns'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

function errorRedirect(
  request: NextRequest,
  error: string,
  locale: string,
  extra?: Record<string, string>,
): NextResponse {
  const params = new URLSearchParams({ error, ...extra })
  return NextResponse.redirect(new URL(`/${locale}/settings/accounts?${params}`, request.url))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform: platformParam } = await params
  const searchParams = request.nextUrl.searchParams

  // Step 1 — Validate platform
  if (!isPlatform(platformParam)) {
    return new NextResponse(null, { status: 404 })
  }
  const platform = platformParam

  // locale is unknown until claims are verified — default to 'en' for pre-claim errors
  let locale = 'en'

  // Step 2 — State JWT validation
  const stateParam = searchParams.get('state')
  if (!stateParam) {
    return errorRedirect(request, 'invalid_state', locale)
  }

  let claims: OAuthStateClaims
  try {
    claims = await verifyOAuthState(stateParam)
  } catch {
    return errorRedirect(request, 'invalid_state', locale)
  }

  locale = claims.locale

  if (claims.platform !== platform) {
    return errorRedirect(request, 'invalid_state', locale)
  }
  if (!isValidUUID(claims.businessId)) {
    return errorRedirect(request, 'invalid_state', locale)
  }

  // Step 3 — Ownership verification (anon client, RLS enforced)
  const supabase = await createClient()
  try {
    await getBusinessById(supabase, claims.businessId)
  } catch {
    return errorRedirect(request, 'forbidden', locale)
  }

  // Step 4 — OAuth error from platform
  if (searchParams.get('error')) {
    return errorRedirect(request, 'oauth_denied', locale, { platform })
  }

  // Step 5 — Exchange code for tokens
  const code = searchParams.get('code') ?? ''
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()
  const redirectUri = `${config.server.APP_URL}/api/social/${platform}/callback`

  let tokenSet: TokenSet
  try {
    tokenSet = await getRegistry().get(platform).exchangeOAuthCode({ platform, code, redirectUri })
  } catch {
    return errorRedirect(request, 'exchange_failed', locale)
  }

  // Step 6 — Vault write sequence with explicit compensation on partial failure
  const placeholderId = crypto.randomUUID()

  // 6a — Access token vault secret
  let vaultAccessId: VaultSecretId
  try {
    const { data, error } = await serviceClient.rpc('vault_create_secret', {
      secret: tokenSet.accessToken,
      name: `sosh_token_${placeholderId}_access`,
    })
    if (error || !data) throw new Error('vault_create_secret failed')
    vaultAccessId = data as VaultSecretId
  } catch {
    return errorRedirect(request, 'vault_write_failed', locale)
  }

  // 6b — Refresh token vault secret (compensation: delete access secret on failure)
  let vaultRefreshId: VaultSecretId | null = null
  if (tokenSet.refreshToken) {
    try {
      const { data, error } = await serviceClient.rpc('vault_create_secret', {
        secret: tokenSet.refreshToken,
        name: `sosh_token_${placeholderId}_refresh`,
      })
      if (error || !data) throw new Error('vault_create_secret failed')
      vaultRefreshId = data as VaultSecretId
    } catch {
      try {
        await serviceClient.rpc('vault_delete_secret', { secret_id: vaultAccessId })
      } catch {}
      return errorRedirect(request, 'vault_write_failed', locale)
    }
  }

  // 6c — Fetch existing account for reconnect vault cleanup
  const { data: existingAccount } = await serviceClient
    .from('social_accounts')
    .select('vault_access_token_id, vault_refresh_token_id')
    .eq('business_id', claims.businessId)
    .eq('platform', platform)
    .eq('platform_user_id', tokenSet.platformUserId ?? '')
    .maybeSingle()

  // 6d — Upsert social_accounts (compensation: delete both vault secrets on failure)
  const { data: upsertResult, error: dbError } = await serviceClient
    .from('social_accounts')
    .upsert(
      {
        id: placeholderId,
        business_id: claims.businessId,
        platform,
        platform_user_id: tokenSet.platformUserId ?? '',
        platform_username: tokenSet.platformUsername ?? '',
        platform_display_name: tokenSet.platformDisplayName ?? null,
        vault_access_token_id: vaultAccessId,
        vault_refresh_token_id: vaultRefreshId,
        token_expires_at: tokenSet.tokenExpiresAt,
        is_active: true,
        connected_at: formatISO(new Date()),
      },
      {
        onConflict: 'business_id,platform,platform_user_id',
        ignoreDuplicates: false,
      },
    )
    .select('id')
    .single()

  if (dbError || !upsertResult) {
    try {
      await serviceClient.rpc('vault_delete_secret', { secret_id: vaultAccessId })
    } catch {}
    if (vaultRefreshId) {
      try {
        await serviceClient.rpc('vault_delete_secret', { secret_id: vaultRefreshId })
      } catch {}
    }
    return errorRedirect(request, 'db_write_failed', locale)
  }

  // 6e — Reconnect: delete prior vault secrets (best-effort; orphans swept by future janitor)
  if (existingAccount) {
    const prior = existingAccount as {
      vault_access_token_id: string | null
      vault_refresh_token_id: string | null
    }
    if (prior.vault_access_token_id && prior.vault_access_token_id !== vaultAccessId) {
      try {
        await serviceClient.rpc('vault_delete_secret', { secret_id: prior.vault_access_token_id })
      } catch {}
    }
    if (prior.vault_refresh_token_id && prior.vault_refresh_token_id !== vaultRefreshId) {
      try {
        await serviceClient.rpc('vault_delete_secret', { secret_id: prior.vault_refresh_token_id })
      } catch {}
    }
  }

  // Step 7 — Success
  return NextResponse.redirect(
    new URL(`/${locale}/settings/accounts?connected=${platform}`, request.url),
  )
}
