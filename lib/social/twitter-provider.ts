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
import { generatePkceVerifier, generatePkceChallenge } from './oauth/pkce-crypto'
import { mapHttpStatusToErrorCode, finiteRetryAfterSeconds } from './error-mapping'
import {
  assertRecentPostsPageSize,
  RECENT_POST_CONTENT_MAX_CHARS,
  SOCIAL_READ_TIMEOUT_MS,
  SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS,
} from './constants'
import type { FetchRecentPostsInput, RecentPostsPage, RecentPost } from './types'

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
// ADR 0025 §2.1/§7.3 (I2.3). Same Users lookup family as X_USERINFO_URL
// (docs.x.com) — GET /2/users/:id/tweets is the documented timeline
// endpoint for "tweets authored by this user".
const X_USER_TWEETS_BASE_URL = 'https://api.x.com/2/users'
// ADR §2.2 — the exact field set the ADR authorizes, nothing more: no
// `expansions` requesting referenced_tweets.id, author_id, or any user
// object (§2.4/§2.6 obligation 6 — this is the read path's own scope
// discipline, distinct from publish's).
// Session 32-D, D10 (NIT-3): `entities` cannot be narrowed to `entities.urls`
// — X's tweet.fields only selects whole objects — and the parser needs the
// urls span to decode t.co links. So `entities.mentions` does transit, and is
// dropped at XTweetEntitiesSchema (which declares urls only, so zod strips
// the rest) before any RecentPost is built. Exposure recorded for D11's ADR
// amendment; no expansion is requested to widen it.
const X_TIMELINE_TWEET_FIELDS = 'id,created_at,text,public_metrics,attachments,referenced_tweets,entities'
// ADR 0026 §3.1 / ADR 0028 Amendment A (J2.1). ONE field, public_metrics: it
// needs no scope beyond the tweet.read already granted. non_public_metrics and
// organic_metrics (owner + user-context + 30 days, docs.x.com/x-api/
// fundamentals/metrics, read 2026-09-19) are deliberately NOT requested —
// clicks stays null and never enters the outcome metric (ADR 0026 §6.2).
const X_TWEET_METRICS_FIELDS = 'public_metrics'
// Session 30.5-D, D3: the bound stated for the disconnect route's revoke
// call, per the correction pass's own instruction not to block or slow
// disconnect on a network timeout. 5s is a deliberately short budget for a
// best-effort, never-throws call sitting inside a user-facing DELETE route.
const REVOKE_TIMEOUT_MS = 5000

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

// ADR §2.2/§2.4 — the read path's own response shapes, separate from the
// publish schemas above. entities.urls carries the t.co-shortened-link spans
// so plain-text reconstruction can replace them with their visible text
// (ADR: "links and mentions kept as their visible text").
const XTweetEntitiesSchema = z
  .object({
    urls: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          url: z.string(),
          expanded_url: z.string().optional(),
          display_url: z.string().optional(),
        }),
      )
      .optional(),
  })
  .optional()

const XTweetSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  text: z.string(),
  public_metrics: z
    .object({
      like_count: z.number(),
      reply_count: z.number(),
      retweet_count: z.number(),
      quote_count: z.number(),
      bookmark_count: z.number().optional(),
      impression_count: z.number().optional(),
    })
    .optional(),
  attachments: z.object({ media_keys: z.array(z.string()).optional() }).optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
  entities: XTweetEntitiesSchema,
})

// ADR 0026 §3.1 (J2.1) — GET /2/tweets/:id. Every count is optional: an
// absent field is NULL in PostMetrics, never 0 (ADR 0026 rule 6).
// repost_count is accepted beside retweet_count because X's own pages
// disagree on the name (ADR 0028 Amendment A records the conflict); `data`
// is optional because X answers a deleted post with 200 + `errors`.
const XTweetMetricsSchema = z.object({
  data: z
    .object({
      id: z.string().optional(),
      public_metrics: z
        .object({
          like_count: z.number().optional(),
          reply_count: z.number().optional(),
          retweet_count: z.number().optional(),
          repost_count: z.number().optional(),
          quote_count: z.number().optional(),
          bookmark_count: z.number().optional(),
          impression_count: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

const XTweetsListSchema = z.object({
  data: z.array(XTweetSchema).optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
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
  // ADR 0025 §2.1, §2.7 — X's historical read IS served, subject to §6.7's
  // operational quota check (launch-checklist, not code).
  readonly historicalReadAvailable = true

  // PKCE is MANDATORY for X (verified N2.1). Generation and cookie-setting
  // happen HERE, inside the provider — ADR 0028 §2.6's own reasoning: moving
  // this into the shared connect route would leak platform knowledge into
  // the one layer that must stay platform-agnostic.
  async getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): Promise<string> {
    // Lazy import (Vercel build fix, 2026-09-06): ./oauth/pkce's top-level
    // `next/headers` import makes it unsafe to import statically anywhere
    // reachable from a Client Component. This method only ever runs
    // server-side (the connect route handler), so the dynamic import is
    // never bundled into client code.
    const { setPkceVerifierCookie } = await import('./oauth/pkce')
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
    // Lazy import — see getOAuthAuthorizeUrl above for why.
    const { readAndClearPkceVerifierCookie } = await import('./oauth/pkce')
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
        retryAfterSeconds: finiteRetryAfterSeconds(retryAfter),
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

  // ADR 0026 §3.1 / ADR 0028 Amendment A (J2.1, founder ruling A-3): ONE read
  // per call, GET /2/tweets/:id?tweet.fields=public_metrics, bearer from
  // withFreshToken. No sleep, no retry loop — cadence belongs to the
  // orchestrator (a 429 is one request, then RATE_LIMITED). Returns null when
  // nothing was measured (deleted post, no public_metrics) so the orchestrator
  // writes no row and the post stays due. reach and clicks are ALWAYS null.
  async fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null> {
    return withFreshToken(
      input.socialAccountId,
      (id) => this.refreshAccessToken({ socialAccountId: id }),
      async (token) => {
        const params = new URLSearchParams({ 'tweet.fields': X_TWEET_METRICS_FIELDS })

        let resp: Response
        try {
          resp = await fetch(`${X_TWEETS_URL}/${encodeURIComponent(input.platformPostId)}?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(SOCIAL_READ_TIMEOUT_MS),
          })
        } catch (err) {
          throw this.mapReadNetworkError(err, 'fetchPostMetrics')
        }

        if (!resp.ok) throw await this.mapReadErrorResponse(resp, 'fetchPostMetrics')

        const rawBody = await resp.json()
        let parsed: z.infer<typeof XTweetMetricsSchema>
        try {
          parsed = XTweetMetricsSchema.parse(rawBody)
        } catch (e) {
          throw new SocialProviderError({
            code: 'UNKNOWN',
            message: 'fetchPostMetrics: X returned an unexpected metrics response shape',
            platform: 'twitter',
            details: { zodError: e instanceof Error ? e.message : String(e) },
          })
        }

        const pm = parsed.data?.public_metrics
        if (!pm) return null

        const reposts = pm.retweet_count ?? pm.repost_count
        return {
          likes: pm.like_count ?? null,
          comments: pm.reply_count ?? null,
          shares: reposts !== undefined && pm.quote_count !== undefined ? reposts + pm.quote_count : null,
          saves: pm.bookmark_count ?? null,
          impressions: pm.impression_count ?? null,
          clicks: null,
          reach: null,
          fetchedAt: formatISO(new Date()),
        }
      },
    )
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
      .update({
        token_expires_at: newExpiry,
        updated_at: formatISO(new Date()),
        // ADR 0025 §7.4 — persisted on refresh too, not just at connect.
        // Session 32-D, D10 (NIT-5): omitted entirely when X sends no
        // `scope`, so a known value is never overwritten with "unknown".
        ...(parsed.scope ? { scopes_granted: parsed.scope.split(' ') } : {}),
      })
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
  // when there is no vault id; swallows network and non-ok failures. Bound
  // per Session 30.5-D D3's own instruction: a try/catch alone discards a
  // THROWN error but not a HUNG request — disconnect must never wait
  // indefinitely on this call, so the fetch carries an explicit timeout.
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
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      })
    } catch {
      // Best-effort: network failure, non-ok status, or the REVOKE_TIMEOUT_MS
      // bound above firing (AbortSignal.timeout throws a TimeoutError, which
      // this catch also discards) are all treated the same way — the caller
      // still runs local cleanup via deactivateSocialAccount regardless.
    }
  }

  // ADR 0025 §2.1/§2.6/§7.3 (I2.3). withFreshToken PER PAGE (obligation 3) —
  // never a token held across pages. Identity verification (obligation 4)
  // runs only on the first page (cursor === null): GET /2/users/me and
  // compare to the row's platform_user_id, fail closed. No new
  // get_vault_secret call site — this reuses vault.ts's existing wrapper,
  // exactly like publish does.
  async fetchRecentPosts(input: FetchRecentPostsInput): Promise<RecentPostsPage> {
    assertRecentPostsPageSize(input.pageSize)

    // Cursor is validated (opaque, account-bound) BEFORE any I/O, same
    // discipline as the page-size guard above — a foreign or unparseable
    // cursor is a caller-visible PLATFORM_REJECTED, not a wasted round trip.
    const paginationToken =
      input.cursor === null ? null : this.decodeReadCursor(input.cursor, input.socialAccountId)

    return withFreshToken(
      input.socialAccountId,
      (id) => this.refreshAccessToken({ socialAccountId: id }),
      async (token) => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const { data: account, error } = await client
          .from('social_accounts')
          .select('platform_user_id, platform_username')
          .eq('id', input.socialAccountId)
          .single()

        if (error || !account) {
          throw new SocialProviderError({
            code: 'TOKEN_REVOKED',
            message: `fetchRecentPosts: social account ${input.socialAccountId} not found`,
            platform: 'twitter',
          })
        }

        const accountId = account.platform_user_id as string
        const accountUsername = account.platform_username as string | null

        if (input.cursor === null) {
          await this.verifyReadIdentity(token, accountId)
        }

        return this.fetchTimelinePage(token, accountId, accountUsername, input, paginationToken)
      },
    )
  }

  // ADR §2.6 obligation 4 — the token's own identity must match the
  // connected account BEFORE the timeline is ever called. Uses the SAME
  // X_USERINFO_URL exchangeOAuthCode already calls — no new endpoint.
  private async verifyReadIdentity(token: string, expectedAccountId: string): Promise<void> {
    let resp: Response
    try {
      resp = await fetch(X_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(SOCIAL_READ_TIMEOUT_MS),
      })
    } catch (err) {
      throw this.mapReadNetworkError(err)
    }

    if (!resp.ok) throw await this.mapReadErrorResponse(resp)

    const rawBody = await resp.json()
    let parsed: z.infer<typeof XUserSchema>
    try {
      parsed = XUserSchema.parse(rawBody)
    } catch (e) {
      throw new SocialProviderError({
        code: 'UNKNOWN',
        message: 'fetchRecentPosts: X returned an unexpected identity response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }

    if (parsed.data.id !== expectedAccountId) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'fetchRecentPosts: token identity does not match the connected account',
        platform: 'twitter',
        details: { reason: 'identity_mismatch' },
      })
    }
  }

  private async fetchTimelinePage(
    token: string,
    accountId: string,
    accountUsername: string | null,
    input: FetchRecentPostsInput,
    paginationToken: string | null,
  ): Promise<RecentPostsPage> {
    const params = new URLSearchParams({
      exclude: 'replies,retweets',
      max_results: String(input.pageSize),
      'tweet.fields': X_TIMELINE_TWEET_FIELDS,
    })
    if (paginationToken) params.set('pagination_token', paginationToken)
    if (input.notBefore) params.set('start_time', input.notBefore)

    let resp: Response
    try {
      resp = await fetch(`${X_USER_TWEETS_BASE_URL}/${accountId}/tweets?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(SOCIAL_READ_TIMEOUT_MS),
      })
    } catch (err) {
      throw this.mapReadNetworkError(err)
    }

    if (!resp.ok) throw await this.mapReadErrorResponse(resp)

    const rawBody = await resp.json()
    let parsed: z.infer<typeof XTweetsListSchema>
    try {
      parsed = XTweetsListSchema.parse(rawBody)
    } catch (e) {
      throw new SocialProviderError({
        code: 'UNKNOWN',
        message: 'fetchRecentPosts: X returned an unexpected tweets response shape',
        platform: 'twitter',
        details: { zodError: e instanceof Error ? e.message : String(e) },
      })
    }

    const posts: RecentPost[] = []
    for (const tweet of parsed.data ?? []) {
      // ADR §2.4 — exclude=replies,retweets already drops those two types;
      // a quote tweet still appears in this endpoint and must be dropped
      // here, using the NON-EXPANDED referenced_tweets[].type field only
      // (no referenced_tweets.id expansion is ever requested).
      if (tweet.referenced_tweets?.some((rt) => rt.type === 'quoted')) continue

      const publishedDate = new Date(tweet.created_at)
      if (!Number.isFinite(publishedDate.getTime())) {
        throw new SocialProviderError({
          code: 'UNKNOWN',
          message: 'fetchRecentPosts: X returned a non-finite created_at',
          platform: 'twitter',
        })
      }

      posts.push({
        platformPostId: tweet.id,
        publishedAt: formatISO(publishedDate),
        content: buildXPlainTextContent(tweet.text, tweet.entities),
        url: accountUsername ? `https://x.com/${accountUsername}/status/${tweet.id}` : null,
        format: deriveXFormat(tweet.attachments),
        metrics: tweet.public_metrics
          ? {
              likes: tweet.public_metrics.like_count,
              comments: tweet.public_metrics.reply_count,
              shares: tweet.public_metrics.retweet_count + tweet.public_metrics.quote_count,
              saves: tweet.public_metrics.bookmark_count ?? null,
              impressions: tweet.public_metrics.impression_count ?? null,
              clicks: null,
              reach: null,
              fetchedAt: formatISO(new Date()),
            }
          : null,
      })
    }

    const nextCursor = parsed.meta?.next_token ? encodeReadCursor(input.socialAccountId, parsed.meta.next_token) : null
    return { posts, nextCursor }
  }

  // Opaque, account-bound (ADR §2.6 obligation 1 / §12 constraint 4): a
  // cursor minted for a different socialAccountId, or one that fails to
  // parse, is rejected — never logged, never included in error details
  // beyond the reason code.
  private decodeReadCursor(cursor: string, expectedAccountId: string): string {
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'fetchRecentPosts: cursor is unparseable',
        platform: 'twitter',
        details: { reason: 'cursor_invalid' },
      })
    }
    const obj = parsed as { sa?: unknown; pt?: unknown }
    if (typeof obj.sa !== 'string' || typeof obj.pt !== 'string' || obj.sa !== expectedAccountId) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'fetchRecentPosts: cursor was not minted for this account',
        platform: 'twitter',
        details: { reason: 'cursor_invalid' },
      })
    }
    return obj.pt
  }

  // Read-specific error map (ADR §2.5) — separate from mapHttpStatusToErrorCode
  // (error-mapping.ts), which states it covers publish only. `details` never
  // carries the response body — a reason code and numbers only.
  private async mapReadErrorResponse(resp: Response, operation = 'fetchRecentPosts'): Promise<SocialProviderError> {
    if (resp.status === 401) {
      return new SocialProviderError({
        code: 'TOKEN_EXPIRED',
        message: `${operation}: X returned ${resp.status}`,
        platform: 'twitter',
      })
    }
    if (resp.status === 403) {
      const body = await resp.json().catch(() => ({}))
      const scopeMissing = /scope/i.test(JSON.stringify(body))
      return new SocialProviderError({
        code: 'TOKEN_REVOKED',
        message: `${operation}: X returned ${resp.status}`,
        platform: 'twitter',
        details: { reason: scopeMissing ? 'scope_missing' : 'forbidden' },
      })
    }
    if (resp.status === 404) {
      return new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: `${operation}: X returned ${resp.status}`,
        platform: 'twitter',
        details: { reason: 'not_found' },
      })
    }
    if (resp.status === 429) {
      const raw = Number(resp.headers.get('Retry-After') ?? '60')
      const guarded = finiteRetryAfterSeconds(raw, 60)
      return new SocialProviderError({
        code: 'RATE_LIMITED',
        message: `${operation}: rate limited by X`,
        platform: 'twitter',
        retryAfterSeconds: Math.min(guarded, SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS),
      })
    }
    if (resp.status >= 500) {
      return new SocialProviderError({
        code: 'NETWORK',
        message: `${operation}: X returned ${resp.status}`,
        platform: 'twitter',
      })
    }
    return new SocialProviderError({
      code: 'PLATFORM_REJECTED',
      message: `${operation}: X returned ${resp.status}`,
      platform: 'twitter',
      details: { reason: 'unexpected_status', status: resp.status },
    })
  }

  // NO sleep, NO retry loop (ADR §2.6 obligation 7 / §12 constraint 8) — a
  // hung request is bounded by SOCIAL_READ_TIMEOUT_MS (AbortSignal.timeout)
  // and mapped straight to NETWORK; retry belongs to the orchestrator's tick
  // cadence, never to the provider.
  private mapReadNetworkError(err: unknown, operation = 'fetchRecentPosts'): SocialProviderError {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return new SocialProviderError({
      code: 'NETWORK',
      message: isTimeout ? `${operation}: request timed out` : `${operation}: network error`,
      platform: 'twitter',
    })
  }
}

// Opaque cursor encoding — base64url of a small JSON envelope binding the
// pagination_token to the socialAccountId it was minted for. Never logged
// (ADR §2.6 obligation 1); lifetime is one run (never persisted, §6.4).
function encodeReadCursor(socialAccountId: string, paginationToken: string): string {
  return Buffer.from(JSON.stringify({ sa: socialAccountId, pt: paginationToken })).toString('base64url')
}

// ADR §2.2 — plain text: entities decoded (t.co links replaced by their
// visible display text), whitespace collapsed, truncated at
// RECENT_POST_CONTENT_MAX_CHARS. Mentions need no special handling — X's
// `text` field already carries @mentions as plain, visible text.
function buildXPlainTextContent(text: string, entities: z.infer<typeof XTweetEntitiesSchema>): string {
  const urls = entities?.urls ?? []
  let result = text
  // Replace right-to-left by start index so earlier spans' indices stay valid.
  for (const url of [...urls].sort((a, b) => b.start - a.start)) {
    const visible = url.display_url ?? url.expanded_url ?? url.url
    result = result.slice(0, url.start) + visible + result.slice(url.end)
  }
  result = result.replace(/\s+/g, ' ').trim()
  return result.length > RECENT_POST_CONTENT_MAX_CHARS ? result.slice(0, RECENT_POST_CONTENT_MAX_CHARS) : result
}

// ADR §2.2 — "derived from attachment TYPES only". X's media_key format
// documents the leading segment as a type discriminator (1 = photo, 2 =
// video, 3 = animated_gif) — read directly from the key string itself, so
// no `expansions=attachments.media_keys` media-object lookup (and the
// media.fields/user data it would pull in) is ever requested.
function deriveXFormat(attachments: { media_keys?: string[] } | undefined): RecentPost['format'] {
  const mediaKeys = attachments?.media_keys ?? []
  if (mediaKeys.length === 0) return 'text'
  if (mediaKeys.length > 1) return 'multi'
  const typeDigit = mediaKeys[0]!.split('_')[0]
  if (typeDigit === '1') return 'image'
  if (typeDigit === '2' || typeDigit === '3') return 'video'
  return 'other'
}
