import { z } from 'zod'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import type {
  SocialProvider,
  OAuthAuthorizeInput,
  ExchangeCodeInput,
  TokenSet,
  PublishInput,
  PublishResult,
  FetchMetricsInput,
  PostMetrics,
  FetchEngagementInput,
  EngagementItem,
  RefreshAccessTokenInput,
  RevokeAccessTokenInput,
} from './types'
import { SocialProviderError } from './errors'
import { withFreshToken, readRefreshToken } from './vault'
import { generatePkceVerifier, generatePkceChallenge, setPkceVerifierCookie, readAndClearPkceVerifierCookie } from './oauth/pkce'
import { mapHttpStatusToErrorCode, boundRetryAfterSeconds } from './error-mapping'

// ADR 0028 §3.2/§4.2 (N2.8). Corrected in Session 30.5-D (BLOCKER-1):
// X_AUTHORIZE_URL and X_TOKEN_URL previously cited N2.1 items 1/3/4/6/7,
// none of which record an X authorize or token URL (item 1 is LinkedIn's
// endpoints; item 4 records only X's token-endpoint auth method). Both are
// now sourced in docs/reviews/session-30-5-platform-verification.md
// Appendix A (items 10/11, read 2026-09-05, docs.x.com). X_TWEETS_URL
// remains sourced by N2.1 item 6.
const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token'
// X_USERINFO_URL: sourced in Appendix A item 14 (read 2026-09-05) — moved
// out of a code-comment-only citation per MINOR-1.
const X_USERINFO_URL = 'https://api.x.com/2/users/me'
const X_TWEETS_URL = 'https://api.x.com/2/tweets' // N2.1 item 6
// N2.1 (finding 3) confirmed only that a revocation endpoint is REFERENCED
// from X's OAuth 2.0 overview page — not its exact request shape for a
// user-context (authorization_code+PKCE) confidential client. A follow-up
// read of the API reference this step found the endpoint documented with
// OAuth 1.0a authentication, which does not fit SOSH's OAuth2 flow. This
// RFC 7009-shaped path is the standards-compliant best guess, not a
// confirmed URL — revocation stays best-effort and NEVER THROWS regardless
// (SOCIAL-REVOKE-NEVER-BLOCKS), so an imperfect guess here cannot break
// disconnect or purge_business. Flagged for the same empirical check N2.1
// already recommends once real credentials exist (ADR 0028 §14.1).
const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke'
const X_TEXT_MAX_LENGTH = 280 // verified N2.1 item 6

const XTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

const XUserSchema = z.object({
  data: z.object({ id: z.string(), username: z.string() }),
})

const XTweetCreateSchema = z.object({
  data: z.object({ id: z.string() }),
})

function basicAuthHeader(): string {
  // N2.1 finding 4: X confidential clients (SOSH holds X_CLIENT_SECRET)
  // authenticate via HTTP Basic — base64(client_id:client_secret) — unlike
  // LinkedIn, which puts both in the body.
  const raw = `${config.server.X_CLIENT_ID}:${config.server.X_CLIENT_SECRET}`
  return `Basic ${Buffer.from(raw).toString('base64')}`
}

function buildTweetText(content: string, hashtags: readonly string[]): string {
  if (hashtags.length === 0) return content
  const tags = hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')
  return `${content} ${tags}`
}

export class TwitterProvider implements SocialProvider {
  readonly platform = 'twitter' as const

  // PKCE is MANDATORY for X (verified N2.1). Generation and cookie-setting
  // happen HERE, inside the provider — ADR 0028 §2.6's own reasoning: moving
  // this into the shared connect route would leak platform knowledge into
  // the one layer that must stay platform-agnostic.
  async getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): Promise<string> {
    const verifier = generatePkceVerifier()
    const challenge = await generatePkceChallenge(verifier)
    await setPkceVerifierCookie(verifier)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.server.X_CLIENT_ID,
      redirect_uri: input.redirectUri,
      scope: input.scopes.join(' '),
      state: input.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    return `${X_AUTHORIZE_URL}?${params}`
  }

  async exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet> {
    // Cleared unconditionally, whether the exchange that follows succeeds
    // or fails (ADR 0028 §2.3).
    const verifier = await readAndClearPkceVerifierCookie()
    if (!verifier) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'exchangeOAuthCode: missing PKCE verifier cookie',
        platform: 'twitter',
      })
    }

    let resp: Response
    try {
      resp = await fetch(X_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: verifier,
        }),
      })
    } catch (err) {
      throw new SocialProviderError({
        code: 'NETWORK',
        message: 'exchangeOAuthCode: network error',
        platform: 'twitter',
        details: { cause: String(err) },
      })
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: `exchangeOAuthCode: X returned ${resp.status}`,
        platform: 'twitter',
        details: { platform_message: body },
      })
    }

    const rawBody = await resp.json()
    let parsed: z.infer<typeof XTokenResponseSchema>
    try {
      parsed = XTokenResponseSchema.parse(rawBody)
    } catch (e) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'X returned an unexpected token response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }

    const identity = await this.fetchIdentity(parsed.access_token)

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      // SOCIAL-X-EXPIRY-FROM-RESPONSE: the authoritative expiry is THIS
      // response's expires_in, never PLATFORM_CONFIGS.twitter.tokenExpirySeconds.
      tokenExpiresAt: formatISO(new Date(Date.now() + parsed.expires_in * 1000)),
      scopesGranted: parsed.scope ? parsed.scope.split(' ') : [],
      platformUserId: identity.id,
      platformUsername: identity.username,
      platformDisplayName: null,
    }
  }

  private async fetchIdentity(accessToken: string): Promise<{ id: string; username: string }> {
    let resp: Response
    try {
      resp = await fetch(X_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
    } catch (err) {
      throw new SocialProviderError({
        code: 'NETWORK',
        message: 'fetchIdentity: network error',
        platform: 'twitter',
        details: { cause: String(err) },
      })
    }

    if (!resp.ok) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: `fetchIdentity: X returned ${resp.status}`,
        platform: 'twitter',
      })
    }

    const rawBody = await resp.json()
    try {
      return XUserSchema.parse(rawBody).data
    } catch (e) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'X returned an unexpected userinfo response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    // MEDIA GUARD (A-3, ADR §3.4) — before ANY network call.
    if (input.mediaUrls.length > 0) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'publish: X media publishing is deferred (30.5-MEDIA-UPLOAD)',
        platform: 'twitter',
        details: { reason: 'media_deferred', mediaCount: input.mediaUrls.length },
      })
    }

    const text = buildTweetText(input.content, input.hashtags)
    if (text.length > X_TEXT_MAX_LENGTH) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: `publish: text exceeds X's ${X_TEXT_MAX_LENGTH}-character limit`,
        platform: 'twitter',
        details: { length: text.length, limit: X_TEXT_MAX_LENGTH },
      })
    }

    return withFreshToken(
      input.socialAccountId,
      (id) => this.refreshAccessToken({ socialAccountId: id }),
      async (token) => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const { data: account } = await client
          .from('social_accounts')
          .select('platform_username')
          .eq('id', input.socialAccountId)
          .single()

        let resp: Response
        try {
          resp = await fetch(X_TWEETS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
          })
        } catch (err) {
          throw new SocialProviderError({
            code: 'NETWORK',
            message: 'publish: network error',
            platform: 'twitter',
            details: { cause: String(err) },
          })
        }

        return this.handlePublishResponse(resp, account?.platform_username ?? null)
      },
    )
  }

  private async handlePublishResponse(resp: Response, username: string | null): Promise<PublishResult> {
    if (resp.status === 429) {
      // N2.1 finding 7: X signals limits via x-rate-limit-* headers, never
      // Retry-After. reset is a Unix epoch SECONDS timestamp.
      const reset = Number(resp.headers.get('x-rate-limit-reset') ?? '0')
      const retryAfter = reset > 0 ? Math.max(reset - Math.floor(Date.now() / 1000), 0) : 60
      throw new SocialProviderError({
        code: 'RATE_LIMITED',
        message: 'publish: rate limited by X',
        platform: 'twitter',
        retryAfterSeconds: boundRetryAfterSeconds(retryAfter),
      })
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw new SocialProviderError({
        code: mapHttpStatusToErrorCode(resp.status),
        message: `publish: X returned ${resp.status}`,
        platform: 'twitter',
        details: { platform_message: body },
      })
    }

    const rawBody = await resp.json()
    let parsed: z.infer<typeof XTweetCreateSchema>
    try {
      parsed = XTweetCreateSchema.parse(rawBody)
    } catch (e) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'X returned an unexpected tweet-creation response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }

    // PublishResult.url is constructed from the authenticated username and
    // the returned id ONLY when both are available, else null — do NOT
    // fabricate a permalink. The /2/tweets response does not document a
    // permalink field (N2.1 item 6); {username}/status/{id} is external
    // convention, not a documented API guarantee.
    return {
      platformPostId: parsed.data.id,
      publishedAt: formatISO(new Date()),
      url: username ? `https://x.com/${username}/status/${parsed.data.id}` : null,
    }
  }

  async fetchPostMetrics(_input: FetchMetricsInput): Promise<PostMetrics | null> {
    throw new SocialProviderError({
      code: 'NOT_IMPLEMENTED',
      message: 'TwitterProvider.fetchPostMetrics is not implemented yet',
      platform: 'twitter',
      details: { method: 'fetchPostMetrics' },
    })
  }

  async fetchEngagement(_input: FetchEngagementInput): Promise<EngagementItem[]> {
    throw new SocialProviderError({
      code: 'NOT_IMPLEMENTED',
      message: 'TwitterProvider.fetchEngagement is not implemented yet',
      platform: 'twitter',
      details: { method: 'fetchEngagement' },
    })
  }

  // REFRESH WITH ROTATION (ADR 0028 §4.2): both the access token AND the
  // refresh token are updated IN PLACE via public.vault_update_secret (N2.3),
  // then token_expires_at is bumped. NEVER delete-then-create —
  // social_accounts.vault_access_token_id/vault_refresh_token_id stay
  // STABLE across a refresh. EVERY vault_update_secret call site checks
  // error (D-alpha was survivable only because the result was discarded).
  //
  // A-4 / 30.5-X-REFRESH-ROTATION: the concurrent-refresh race ADR 0002 §8
  // accepts is materially worse under rotation (a consumed refresh token
  // can invalidate the whole chain). Accepted for MVP per that filing —
  // the pg_advisory_xact_lock remedy is DEFERRED and deliberately NOT
  // implemented here; adding it would widen this session.
  async refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet> {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()

    const { data: account, error: accountError } = await client
      .from('social_accounts')
      .select('vault_access_token_id, vault_refresh_token_id')
      .eq('id', input.socialAccountId)
      .single()

    if (accountError || !account) {
      throw new SocialProviderError({
        code: 'TOKEN_REVOKED',
        message: `refreshAccessToken: social account ${input.socialAccountId} not found`,
        platform: 'twitter',
      })
    }

    if (!account.vault_refresh_token_id) {
      throw new SocialProviderError({
        code: 'TOKEN_REVOKED',
        message: 'refreshAccessToken: no refresh token on file',
        platform: 'twitter',
      })
    }

    const { token: refreshToken } = await readRefreshToken(input.socialAccountId)

    let resp: Response
    try {
      resp = await fetch(X_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      })
    } catch (err) {
      throw new SocialProviderError({
        code: 'NETWORK',
        message: 'refreshAccessToken: network error',
        platform: 'twitter',
        details: { cause: String(err) },
      })
    }

    if (resp.status === 400 || resp.status === 401) {
      throw new SocialProviderError({
        code: 'TOKEN_REVOKED',
        message: 'refreshAccessToken: X rejected the refresh token',
        platform: 'twitter',
      })
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: `refreshAccessToken: X returned ${resp.status}`,
        platform: 'twitter',
        details: { platform_message: body },
      })
    }

    const rawBody = await resp.json()
    let parsed: z.infer<typeof XTokenResponseSchema>
    try {
      parsed = XTokenResponseSchema.parse(rawBody)
    } catch (e) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'X returned an unexpected refresh response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }

    const newExpiry = formatISO(new Date(Date.now() + parsed.expires_in * 1000))

    // SOCIAL-VAULT-UPDATE-CHECKED: every call site asserts on error.
    const { error: accessUpdateError } = await client.rpc('vault_update_secret', {
      secret_id: account.vault_access_token_id,
      new_secret: parsed.access_token,
    })
    if (accessUpdateError) {
      throw new SocialProviderError({
        code: 'UNKNOWN',
        message: 'refreshAccessToken: failed to update access token in Vault',
        platform: 'twitter',
        details: { cause: accessUpdateError.message },
      })
    }

    if (parsed.refresh_token) {
      const { error: refreshUpdateError } = await client.rpc('vault_update_secret', {
        secret_id: account.vault_refresh_token_id,
        new_secret: parsed.refresh_token,
      })
      if (refreshUpdateError) {
        throw new SocialProviderError({
          code: 'UNKNOWN',
          message: 'refreshAccessToken: failed to update refresh token in Vault',
          platform: 'twitter',
          details: { cause: refreshUpdateError.message },
        })
      }
    }

    const { error: bumpError } = await client
      .from('social_accounts')
      .update({ token_expires_at: newExpiry, updated_at: formatISO(new Date()) })
      .eq('id', input.socialAccountId)
    if (bumpError) {
      throw new SocialProviderError({
        code: 'UNKNOWN',
        message: 'refreshAccessToken: failed to bump token_expires_at',
        platform: 'twitter',
        details: { cause: bumpError.message },
      })
    }

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      tokenExpiresAt: newExpiry,
      scopesGranted: parsed.scope ? parsed.scope.split(' ') : [],
    }
  }

  // SOCIAL-REVOKE-NEVER-BLOCKS: best-effort, NEVER THROWS. Returns early
  // when there is no vault id; swallows network and non-ok failures.
  async revokeAccessToken(input: RevokeAccessTokenInput): Promise<void> {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()

    const { data: account } = await client
      .from('social_accounts')
      .select('vault_access_token_id')
      .eq('id', input.socialAccountId)
      .single()

    if (!account?.vault_access_token_id) return

    const { data: token } = await client.rpc('get_vault_secret', {
      secret_id: account.vault_access_token_id,
    })

    if (!token) return

    try {
      await fetch(X_REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
      })
    } catch {
      // Best-effort: network failure on revoke is discarded. Caller still
      // runs local cleanup via deactivateSocialAccount.
    }
  }
}
