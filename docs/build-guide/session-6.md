# Session 6 — Social OAuth Connection

> **Goal:** Users connect their social accounts across all 5 platforms. Postiz infrastructure set up locally and prepared for Hetzner. OAuth backend routes implement ADR 0002 §7 exactly. Connection UI is premium.
> **Time:** 4–6 hours including correction pass
> **Models:** Builder A (Sonnet 4.6) → Builder B (Sonnet 4.6) → Reviewer (Opus 4.7)
> **Plugins:** ECC for backend, Frontend Design auto-activates for UI, claude-mem automatic throughout
> **Session structure:** Two builder sessions (backend then UI), one reviewer, expected correction pass

---

## Why no Architect session

ADR 0002 §7 already designed the full OAuth contract: request shape, validation sequence, vault write sequence with compensation, error-redirect codes, OAUTH_STATE_SECRET rationale. The Builder implements against that spec. No new architecture decisions needed.

---

## Platform strategy (confirmed decisions)

**All 5 platforms get OAuth connection routes and UI:**
LinkedIn, X (Twitter), Instagram, Facebook Pages, Threads

**Only LinkedIn and X actively publish in Phase 1:**
Instagram, Facebook, Threads show as "Connected" with a "Publishing coming soon" badge. Their PostizProvider methods throw `NOT_IMPLEMENTED`. No silent failures.

**Meta OAuth scope strategy:**
Instagram, Facebook, Threads — connect with READ-only scopes now (no App Review required). Publishing scopes (`instagram_content_publish`, `pages_manage_posts`, `threads_content_publish`) added when Meta App Review is approved. Users won't need to reconnect.

---

## Pre-session checklist

- [ ] Session 5 fully complete — all correction passes done
- [ ] Docker Desktop installed and running on your machine
- [ ] ngrok or Cloudflare Tunnel installed (for local OAuth callbacks)
- [ ] Developer accounts created:
  - LinkedIn Developer Portal: https://developer.linkedin.com
  - X Developer Portal: https://developer.x.com
  - Meta for Developers: https://developers.facebook.com
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes
- [ ] claude-mem running — verify at http://localhost:37777
- [ ] `/resume-session` works in a test Claude Code session

---

## Part A — Postiz Infrastructure + OAuth Backend (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer A
4. claude-mem will inject previous session context automatically — review the injected memory block before proceeding
5. Run prompts in order — do NOT `/clear` between them

### Primer A

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0002-social-provider.md (especially §7),
/docs/decisions/0001-database-schema.md (social_accounts table),
/lib/social/index.ts, /lib/social/oauth/state.ts,
/lib/social/vault.ts, /lib/social/platforms/ if it exists,
/lib/supabase/service.ts, /lib/config.ts.
Read /app/[locale]/(dashboard)/onboarding/step-3/page.tsx.

Session 6 Part A — Postiz Infrastructure and OAuth Backend.
Builder role.

Platform strategy (locked — do not deviate):
- All 5 platforms get connection routes: linkedin, twitter,
  instagram, facebook, threads
- linkedin and twitter publish in Phase 1; instagram, facebook,
  threads show "coming soon" but are still connectable now
- Meta (instagram/facebook/threads): READ-only scopes only

ECC workflow:
- /plan before each prompt — waits for confirm before code
- /tdd for all TypeScript
- /verify after each prompt
- /docs postiz when you need to check Postiz API endpoints

Review the injected memory. Confirm what you know about the
SocialProvider abstraction and ADR 0002 §7. Then wait for
Prompt 1.
```

### Prompt A1 — Postiz infrastructure

```
/plan "Set up Postiz for local development and Hetzner production"

Create an infra/ directory at the project root with:

1. infra/docker-compose.yml
   Three services: postiz-db (postgres), postiz-redis (redis),
   postiz-app (ghcr.io/gitroomhq/postiz-app:latest).
   - Named volumes for postgres data and redis data
   - Health checks on db and redis before postiz-app starts
   - All postiz env vars as references to .env file
     (POSTIZ_DATABASE_URL, POSTIZ_REDIS_URL, POSTIZ_JWT_SECRET,
     POSTIZ_BACKEND_INTERNAL_URL, POSTIZ_FRONTEND_URL,
     POSTIZ_API_KEY, POSTIZ_STORAGE_PROVIDER=local)
   - Port mapping: postiz-app 5000:5000

2. infra/.env.example
   All Postiz env vars with placeholder values and clear comments.
   Include a section "Also add these to your SOSH .env.local"
   with POSTIZ_BASE_URL and POSTIZ_API_KEY.

3. infra/caddy/Caddyfile.example
   Caddy reverse proxy config for Hetzner production with
   automatic HTTPS. Placeholder domain.

4. infra/README.md with two sections:
   
   LOCAL SETUP:
   1. cp infra/.env.example infra/.env, fill values
   2. npm run postiz:up
   3. Access Postiz at http://localhost:5000
   4. Create API key in Postiz admin UI
   5. ngrok http 5000 for OAuth callbacks during development
   6. Add POSTIZ_BASE_URL=http://localhost:5000 to .env.local
   7. Add POSTIZ_API_KEY=<from step 4> to .env.local
   
   HETZNER PRODUCTION:
   1. Provision Ubuntu 22.04 VPS (minimum 2GB RAM)
   2. Install Docker and Docker Compose
   3. SCP infra/ to VPS, fill production .env
   4. Configure Caddy with real domain
   5. docker-compose up -d
   6. Update Vercel POSTIZ_BASE_URL to VPS domain
   7. Update OAuth callback URLs in all platform developer portals

5. Add to package.json scripts:
   "postiz:up": "docker-compose -f infra/docker-compose.yml up -d"
   "postiz:down": "docker-compose -f infra/docker-compose.yml down"
   "postiz:logs": "docker-compose -f infra/docker-compose.yml logs -f"

/verify
```

### Prompt A2 — Platform OAuth config

```
/plan "Platform-specific OAuth configuration and scope constants"

Create /lib/social/platforms/config.ts:

Export PLATFORM_CONFIGS as a Record<Platform, PlatformOAuthConfig>
where PlatformOAuthConfig is:
{
  displayName: string
  scopes: readonly string[]
  supportsRefreshToken: boolean
  tokenExpiryDays: number | null
  publishingAvailable: boolean  // false = "coming soon" in UI
}

Values per platform:

linkedin:
  displayName: 'LinkedIn'
  scopes: ['openid', 'profile', 'email', 'w_member_social']
  supportsRefreshToken: false
  tokenExpiryDays: 60
  publishingAvailable: true

twitter:
  displayName: 'X (Twitter)'
  scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
  supportsRefreshToken: true
  tokenExpiryDays: null
  publishingAvailable: true

instagram:
  displayName: 'Instagram'
  scopes: ['instagram_basic', 'pages_show_list']
  // NOTE: instagram_content_publish deferred — requires Meta App Review
  supportsRefreshToken: false
  tokenExpiryDays: 60
  publishingAvailable: false

facebook:
  displayName: 'Facebook'
  scopes: ['pages_show_list', 'pages_read_engagement']
  // NOTE: pages_manage_posts deferred — requires Meta App Review
  supportsRefreshToken: false
  tokenExpiryDays: 60
  publishingAvailable: false

threads:
  displayName: 'Threads'
  scopes: ['threads_basic']
  // NOTE: threads_content_publish deferred
  supportsRefreshToken: false
  tokenExpiryDays: 60
  publishingAvailable: false

Export:
- getPlatformConfig(platform: Platform): PlatformOAuthConfig
- publishingAvailableFor(platform: Platform): boolean
- isPublishingPlatform(platform: Platform): platform is 'linkedin'|'twitter'

Add OAuth client credentials to /lib/config.ts as required
server-only strings:
LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
X_CLIENT_ID, X_CLIENT_SECRET
META_APP_ID, META_APP_SECRET

Also add to .env.local.example.

/verify
```

### Prompt A3 — Connection status helper

```
/tdd "Social account connection status logic"

Create /lib/social/connection-status.ts:

export type ConnectionStatus =
  | 'connected'
  | 'expiring_soon'
  | 'disconnected'
  | 'coming_soon'

export function getConnectionStatus(
  account: SocialAccountRow | undefined | null,
  platform: Platform,
): ConnectionStatus

Logic:
- If !publishingAvailableFor(platform) AND (!account || !account.is_active):
  → 'coming_soon'  
  (platform not yet publishing — show connect button grayed or note)
- If !publishingAvailableFor(platform) AND account?.is_active:
  → 'coming_soon'
  (connected but not publishing yet — badge shows connected handle
   AND "coming soon" for publishing)
- If !account || !account.is_active:
  → 'disconnected'
- If account.token_expires_at and within 7 days:
  → 'expiring_soon'
- else:
  → 'connected'

NOTE: 'coming_soon' platforms ARE connectable — the UI still
shows a Connect button. The status just informs the publishing
capability badge.

Write tests in connection-status.test.ts covering:
- disconnected account → 'disconnected'
- connected account → 'connected'
- token expiring in 5 days → 'expiring_soon'
- token expiring in 8 days → 'connected' (outside window)
- instagram with active account → 'coming_soon'
- instagram without account → 'coming_soon'
- linkedin with active account → 'connected'

/verify
```

### Prompt A4 — OAuth initiation route

```
/plan "OAuth connect route that redirects user to Postiz authorize"

Create /app/api/social/[platform]/connect/route.ts (GET):

1. Parse and validate [platform] — if not in Platform union → 404
2. Get authenticated user via createServerClient()
   If no user → redirect to /[locale]/login
3. Get business via getBusinessByOwner() — if none → 401
4. Generate signed OAuth state JWT via signOAuthState():
   { businessId: business.id, platform, nonce: randomBytes(16) }
5. Build the Postiz OAuth authorization URL:
   Use /docs postiz to verify the exact endpoint.
   Expected: GET {POSTIZ_BASE_URL}/integrations/{platform}/authorize
   Query params:
   - redirect_uri: {APP_URL}/api/social/{platform}/callback
   - scope: PLATFORM_CONFIGS[platform].scopes.join(' ')
   - state: the signed JWT (Postiz should pass this through to callback)
6. Redirect user to that URL

If Postiz is unreachable (fetch to build URL fails or times out):
→ redirect /[locale]/settings/accounts?error=postiz_unavailable

The redirect_uri must match exactly what's registered in each
platform's developer portal AND in Postiz's integration config.

/verify
```

### Prompt A5 — OAuth callback route

```
/plan "OAuth callback route implementing ADR 0002 §7 exactly"

This is the most security-critical route in Session 6.
Use /multi-backend — run parallel agents to verify security
invariants while implementing.

Create /app/api/social/[platform]/callback/route.ts (GET):

Implement the EXACT sequence from ADR 0002 §7. Do not reorder.

STEP 1 — Validate platform (404 if not in Platform union)

STEP 2 — State JWT validation:
const stateParam = searchParams.get('state')
if (!stateParam) → redirect /settings/accounts?error=invalid_state
try {
  const claims = await verifyOAuthState(stateParam)
  // verifyOAuthState throws on bad sig, expired, malformed
  if (claims.platform !== platform) → redirect invalid_state
  if (!isValidUUID(claims.businessId)) → redirect invalid_state
} catch → redirect invalid_state

STEP 3 — Ownership verification using ANON client (NOT service-role):
const supabase = createServerClient()  // anon key, RLS enforced
const business = await getBusinessById(supabase, claims.businessId)
if (!business) → redirect /settings/accounts?error=forbidden
// RLS ensures user can only see their own businesses

STEP 4 — OAuth error from platform:
if (searchParams.get('error')) →
  redirect /settings/accounts?error=oauth_denied&platform={platform}

STEP 5 — Exchange code for tokens:
const code = searchParams.get('code')
const serviceClient = (await import('@/lib/supabase/service')).createServiceRoleClient()
let tokenSet: TokenSet
try {
  tokenSet = await getRegistry().get(platform).exchangeOAuthCode({
    platform, code, redirectUri: `${config.public.APP_URL}/api/social/${platform}/callback`
  })
} catch (e) {
  → redirect ?error=exchange_failed
}

STEP 6 — Vault write sequence (ADR 0002 §7 Step 4):
const placeholderId = crypto.randomUUID()

// a. Create access token vault secret
let vaultAccessId: string
try {
  vaultAccessId = await serviceClient.rpc('vault_create_secret', {
    secret: tokenSet.accessToken,
    name: `sosh_token_${placeholderId}_access`
  })
} catch → redirect ?error=vault_write_failed

// b. Create refresh token vault secret (if exists)
let vaultRefreshId: string | null = null
if (tokenSet.refreshToken) {
  try {
    vaultRefreshId = await serviceClient.rpc('vault_create_secret', {
      secret: tokenSet.refreshToken,
      name: `sosh_token_${placeholderId}_refresh`
    })
  } catch {
    // compensate: delete access token secret
    await serviceClient.rpc('vault_delete_secret', { secret_id: vaultAccessId })
    → redirect ?error=vault_write_failed
  }
}

// c. INSERT social_accounts ON CONFLICT UPDATE, returning prior vault IDs
const { data: upsertResult, error: dbError } = await serviceClient
  .from('social_accounts')
  .upsert({
    id: placeholderId,
    business_id: claims.businessId,
    platform,
    platform_user_id: tokenSet.platformUserId,
    platform_username: tokenSet.platformUsername,
    platform_display_name: tokenSet.platformDisplayName ?? null,
    vault_access_token_id: vaultAccessId,
    vault_refresh_token_id: vaultRefreshId,
    token_expires_at: tokenSet.tokenExpiresAt,
    is_active: true,
    connected_at: formatISO(new Date()),
  }, {
    onConflict: 'business_id,platform,platform_user_id',
    ignoreDuplicates: false,
  })
  .select('id, vault_access_token_id, vault_refresh_token_id')
  .single()

if (dbError) {
  // compensate: delete both vault secrets
  await serviceClient.rpc('vault_delete_secret', { secret_id: vaultAccessId })
  if (vaultRefreshId) await serviceClient.rpc('vault_delete_secret', { secret_id: vaultRefreshId })
  → redirect ?error=db_write_failed
}

// d. If reconnect (row already existed): delete OLD vault secrets
if (upsertResult.id !== placeholderId) {
  // The ON CONFLICT updated an existing row — clean up old secrets
  // upsertResult contains the prior vault IDs from RETURNING
  // Log if cleanup fails but do not fail the request
  if (upsertResult.vault_access_token_id !== vaultAccessId) {
    await serviceClient.rpc('vault_delete_secret', {
      secret_id: upsertResult.vault_access_token_id
    }).catch(console.error)
  }
  if (upsertResult.vault_refresh_token_id && 
      upsertResult.vault_refresh_token_id !== vaultRefreshId) {
    await serviceClient.rpc('vault_delete_secret', {
      secret_id: upsertResult.vault_refresh_token_id
    }).catch(console.error)
  }
}

STEP 7 — Success:
redirect /[locale]/settings/accounts?connected={platform}

Error redirect paths (ADR 0002 §7 Step 6):
?error=invalid_state → JWT invalid, expired, or platform mismatch
?error=forbidden → business not owned by authenticated user
?error=oauth_denied → user rejected OAuth on platform side
?error=exchange_failed → Postiz couldn't exchange the code
?error=vault_write_failed → vault secret creation failed
?error=db_write_failed → social_accounts insert failed

Write /app/api/social/[platform]/callback/callback.test.ts:
- Valid flow: mocked exchangeOAuthCode, vault RPCs, DB upsert
- Missing state param → invalid_state redirect
- Invalid JWT signature → invalid_state redirect
- Expired JWT (mock exp in past) → invalid_state redirect
- Platform mismatch in JWT → invalid_state redirect
- Business not found (RLS returns null) → forbidden redirect
- OAuth error param present → oauth_denied redirect
- exchangeOAuthCode throws → exchange_failed redirect
- vault_create_secret fails on access token → vault_write_failed, no DB write
- vault_create_secret fails on refresh token → vault_write_failed, access secret cleaned up
- DB upsert fails → db_write_failed, both vault secrets cleaned up
- Reconnect: prior vault secrets deleted, new ones stored

/verify
```

### Prompt A6 — Disconnect and accounts routes

```
/plan "Disconnect route and social accounts API"

1. /app/api/social/[platform]/disconnect/route.ts (DELETE):
   - Validate platform (404 if invalid)
   - Get authenticated user
   - Get business via getBusinessByOwner()
   - Get active social_account for this business + platform
     using getActiveByBusinessAndPlatform() from /lib/db/social-accounts.ts
   - If none: 404
   - Call deactivateSocialAccount(serviceClient, account.id)
     (already implemented — sets is_active=false, deletes vault secrets,
     nulls vault ID columns)
   - Return 200 JSON: { success: true }
   - On error: 500 with { error: 'disconnect_failed' }

2. /app/api/social/accounts/route.ts (GET):
   - Get authenticated user
   - Get business
   - Call listByBusiness(supabase, business.id) from /lib/db/social-accounts.ts
   - IMPORTANT: verify listByBusiness selects explicit columns that
     EXCLUDE vault_access_token_id and vault_refresh_token_id
     These must never appear in HTTP responses
   - Return JSON array with:
     platform, platform_username, platform_display_name,
     is_active, connected_at, token_expires_at

3. Update /lib/db/social-accounts.ts if needed:
   - listByBusiness(): confirm it selects explicit columns, not select('*')
   - Add getActiveByBusinessAndPlatform(client, businessId, platform)
     if not already present

/verify
```

### Prompt A7 — Save session

```
/learn-eval

Summarise:
- What was built in Part A
- Any deviations from ADR 0002 §7 and why
- Postiz API endpoints confirmed via /docs
- Any open questions for Part B

/save-session
```

`/exit` Claude Code.

---

## Part B — Social Accounts UI (Sonnet 4.6)

### How to run

1. Fresh `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer B
4. claude-mem injects Part A context automatically
5. Run prompts — do NOT `/clear` between them

### Primer B

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.
Read /lib/social/platforms/config.ts,
/lib/social/connection-status.ts,
/app/api/social/accounts/route.ts.
Read the existing /app/[locale]/(dashboard)/settings/ structure.
Read /components/layout/DashboardShell.tsx.
Read /app/[locale]/(dashboard)/onboarding/step-3/page.tsx.

Session 6 Part B — Social Accounts Connection UI.
Builder role.

The frontend-design plugin is active. It will guide aesthetic
choices automatically when you build UI components.

ECC workflow: /plan, /tdd, /verify as usual.

SŌSH design direction for this session:
Refined minimal — precise typography, confident whitespace,
subtle depth. Quietly premium. Platform cards that feel like
native integrations, not a third-party dashboard.

Platform display strategy for the UI:
- LinkedIn, X: connectable, publishable
- Instagram, Facebook, Threads: connectable (real OAuth),
  but show "Publishing coming soon" badge
- All platforms: show @handle and green dot when connected

After injected memory loads, confirm you understand the
connection status types and platform configs. Wait for Prompt 1.
```

### Prompt B1 — Shared platform connection card component

```
/plan "PlatformConnectionCard shared component"

Create /components/social/PlatformConnectionCard.tsx:
A 'use client' component used by both settings and onboarding.

Props:
{
  platform: Platform
  config: PlatformOAuthConfig
  account: SocialAccountRow | null
  status: ConnectionStatus
  onDisconnect: () => void   // callback after disconnect API call
  variant: 'settings' | 'onboarding'  // slight visual difference
}

The card shows:
- Platform icon (use inline SVG for each — LinkedIn blue, X/Twitter
  black, Instagram gradient, Facebook blue, Threads black)
- Platform display name
- Status indicator dot (green=connected, amber=expiring_soon,
  grey=disconnected, purple=coming_soon)
- If connected or expiring_soon: "@{platform_username}" in muted text
- If expiring_soon: "Reconnect — expires in N days" in amber
- If coming_soon (not connected): "Publishing coming soon" badge
- If coming_soon (connected): "@handle" + "Publishing coming soon" badge

Action button:
- connected/expiring_soon: "Disconnect" (opens confirmation)
- disconnected/coming_soon: "Connect" (links to /api/social/{platform}/connect)

Disconnect confirmation: shadcn AlertDialog component.
"Disconnect {Platform}? You'll need to reconnect to resume publishing."
Confirm → DELETE /api/social/{platform}/disconnect → calls onDisconnect.

The card must look polished — this is the first impression of
SŌSH's product quality after onboarding.

/verify
```

### Prompt B2 — Settings accounts page

```
/plan "Social accounts settings page"

Create /app/[locale]/(dashboard)/settings/accounts/page.tsx:

Server Component that:
1. Fetches GET /api/social/accounts on the server
2. Gets connection status for each platform using getConnectionStatus()
3. Renders a page with:
   - Page title and subtitle (via next-intl)
   - Platform grid (2 cols desktop, 1 col mobile)
   - One PlatformConnectionCard per platform (all 5)
   - Toast notifications for ?connected= and ?error= query params

The page title area should explain WHY connecting matters:
"Connect your social accounts to start publishing AI-crafted
posts directly from SŌSH."

The disconnect confirmation and reconnect flows update the page
via router.refresh() after successful API call.

Create /app/[locale]/(dashboard)/settings/layout.tsx if missing:
Simple layout with a settings sidebar nav:
- Accounts (active)
- Billing (placeholder — Session 11)
- Profile (placeholder)

Add i18n keys to all three locale files:
settings.accounts.title
settings.accounts.subtitle
settings.accounts.connect
settings.accounts.disconnect
settings.accounts.disconnect_confirm_title
settings.accounts.disconnect_confirm_body
settings.accounts.connected_as
settings.accounts.expiring_soon
settings.accounts.coming_soon_badge
settings.accounts.reconnect
settings.accounts.error.invalid_state
settings.accounts.error.forbidden
settings.accounts.error.oauth_denied
settings.accounts.error.exchange_failed
settings.accounts.error.vault_write_failed
settings.accounts.error.db_write_failed
settings.accounts.error.postiz_unavailable
settings.accounts.success.connected

Translate naturally for PT-PT and ES. Not machine-translated.

/verify
```

### Prompt B3 — Onboarding step 3 with real connections

```
/plan "Replace onboarding step-3 placeholder with real connection UI"

Update /app/[locale]/(dashboard)/onboarding/step-3/page.tsx:

Replace the placeholder with real platform connection cards.
This uses the same PlatformConnectionCard component.

The page:
- Headline: "Connect your first social account"
  (sub: "You can add more accounts later from Settings")
- All 5 platform cards using PlatformConnectionCard variant='onboarding'
- In onboarding variant: cards are slightly more compact
- "Continue" button: DISABLED until at least 1 platform has
  is_active=true. Enabled once any platform is connected.
- "Skip for now" link: shows a warning callout 
  "Without a connected account, posts won't be published"
  then allows skip (sets onboarding_completed = true)

After a successful OAuth callback, the user is redirected back
to /onboarding/step-3?connected={platform}. The page should
detect this param and show a success state on that platform's
card. Poll GET /api/social/accounts every 3s (max 60s) to
detect newly connected accounts and enable the Continue button.

Add i18n keys:
onboarding.step3.title
onboarding.step3.subtitle
onboarding.step3.continue
onboarding.step3.skip
onboarding.step3.skip_warning
onboarding.step3.connected_success

/verify
```

### Prompt B4 — Dashboard connection status indicator

```
/plan "Dashboard shell connection status awareness"

Two small additions to the dashboard shell:

1. Update DashboardShell.tsx to accept hasSocialAccounts: boolean.
   When false, show a dismissible banner at the top of the main
   content area (not in the sidebar):
   "Connect a social account to start publishing →"
   Link to /settings/accounts. Dismissible per browser session
   via sessionStorage (not persisted to DB).

2. Add to the sidebar nav "Settings" item: a small amber dot
   indicator when no social accounts are active. The dot
   disappears once any account is connected.

3. Update /app/[locale]/(dashboard)/layout.tsx to:
   - Fetch count of active social accounts for the business
     server-side during layout render
   - Pass hasSocialAccounts to DashboardShell

Keep this lightweight — one DB query, no complexity.

/verify
```

### Prompt B5 — Build and verify

```
Run:
1. npx tsc --noEmit
2. npx vitest run
3. npm run build

If all pass, run:
4. npm run postiz:up
5. npm run dev

Verify:
- http://localhost:5000 shows Postiz (may take 30s first run)
- /settings/accounts shows all 5 platform cards
- LinkedIn "Connect" button generates a redirect URL
  (paste the URL here — it should point to Postiz authorize)
- Onboarding step-3 shows real cards
- Dashboard banner appears (no accounts connected)

/learn-eval
/save-session
```

`/exit` Claude Code.

---

## Part C — Reviewer Session (Opus 4.7)

### Primer C

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0002-social-provider.md (§7 in full).
Read:
  /app/api/social/[platform]/connect/route.ts
  /app/api/social/[platform]/callback/route.ts
  /app/api/social/[platform]/disconnect/route.ts
  /app/api/social/accounts/route.ts
  /lib/social/platforms/config.ts
  /lib/social/connection-status.ts
  /lib/db/social-accounts.ts
  /components/social/PlatformConnectionCard.tsx
  /app/[locale]/(dashboard)/settings/accounts/page.tsx
  /app/[locale]/(dashboard)/onboarding/step-3/page.tsx
  /app/api/social/[platform]/callback/callback.test.ts
  infra/docker-compose.yml

Session 6 Part C — OAuth and Social UI Review.

Run security-reviewer and typescript-reviewer in parallel.
Independent review. Do not modify files.
Acknowledge when you have read everything.
```

### Reviewer Prompt

```
Run security-reviewer and typescript-reviewer in parallel.
Synthesize one structured report.

SECTION A — OAUTH SECURITY (highest priority)

A1. State JWT sequence — exact order matters:
- State param presence checked BEFORE everything else?
- verifyOAuthState() called BEFORE ownership check?
- All three checks run: signature, expiry, platform match?
- Missing state → correct redirect (not 500)?
- businessId validated as UUID format?

A2. Ownership verification — client type:
- getBusinessById() called with ANON client (RLS enforced)?
- NOT called with service-role client (would bypass RLS)?
- What happens if business exists but belongs to another user?
  (Should return null via RLS, → forbidden redirect)

A3. Vault write compensation — ADR 0002 §7 Step 4/5:
- vault_create_secret for access token before DB insert?
- On refresh token vault failure: access token secret deleted?
- On DB insert failure: BOTH vault secrets deleted?
- On reconnect (ON CONFLICT): prior vault secrets deleted?
- Vault cleanup errors logged but don't fail the request?

A4. Token material in HTTP responses:
- GET /api/social/accounts: does the response include
  vault_access_token_id or vault_refresh_token_id?
  (Search the select statement — must be explicit column list)
- Any raw token values in any response body?
- Any vault IDs in error messages or logs?

A5. Open redirect prevention:
- All redirects go to fixed internal paths?
- No user-controlled values in redirect destinations?
- Error redirect codes from a whitelist?

A6. CSRF on DELETE /disconnect:
- Route verifies authenticated session?
- Could a malicious site trigger a disconnect via
  a cross-origin DELETE request?

A7. Scope strategy verification:
- Instagram/Facebook/Threads scopes exclude publish scopes?
  (instagram_content_publish, pages_manage_posts,
   threads_content_publish must NOT be present)
- publishingAvailable: false for all three Meta platforms?

A8. OAuth error edge cases:
- user cancels OAuth on platform → oauth_denied correctly?
- State JWT expired (> 10 min on consent screen) → correct?
- Code already used (replay attack) → Postiz handles this?

SECTION B — TYPESCRIPT AND CONVENTIONS

B1. Platform param validation:
- [platform] validated against Platform type in every route?
- Unrecognised platform → 404 (not 500)?

B2. Service-role usage:
- Vault operations use service-role via lazy import?
- Ownership check uses anon/server client?
- Disconnect uses service-role for vault cleanup?

B3. listByBusiness() excludes vault columns:
- SELECT statement is explicit column list?
- Grep for 'vault' in the HTTP response data path — must be absent

B4. Connection status logic:
- coming_soon platforms still show Connect button?
- expiring_soon threshold is 7 days?
- Tests cover the boundary cases?

B5. Any 'any' types?
B6. All i18n keys present in en/pt/es simultaneously?
B7. formatISO from date-fns for timestamps?
B8. process.env outside config.ts?

SECTION C — UI AND UX

C1. PlatformConnectionCard used by both settings and onboarding?
C2. Disconnect confirmation prevents accidental clicks?
C3. Onboarding step-3 Continue button disabled until connected?
C4. Dashboard banner appears when no accounts connected?
C5. ?connected= and ?error= query params show appropriate feedback?

SECTION D — INFRASTRUCTURE

D1. docker-compose.yml:
- Named volumes for data persistence?
- Health checks prevent early Postiz start?
- No credentials hardcoded (all from .env)?

D2. infra/README.md covers both local and Hetzner?

Report format: markdown table
(Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions.
After that: every ⚠️ with recommendations.

Verdict:
- Blockers before Session 7
- Blockers before first user
- Acceptable to defer
```

### After Part C

```
git add .
git commit -m "Session 6C: Review complete"
git push
```

Paste full report to Claude.ai. Correction pass (6D) if needed.

---

## Part D — Correction Pass (only if reviewer finds issues)

Fresh Sonnet session. Fix listed issues only. Verify. Commit.

```
git add .
git commit -m "Session 6D: Corrections applied, Session 6 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 6 complete.

Infrastructure:
- Postiz running locally: [yes/no — paste docker ps output]
- Postiz UI accessible at http://localhost:5000: [yes/no]

OAuth test:
- LinkedIn Connect redirect URL: [paste the URL]
  (Should point to Postiz authorize endpoint with state param)

UI:
- /settings/accounts loads with 5 platform cards: [yes/no]
- LinkedIn/X show "Connect" button: [yes/no]
- Instagram/Facebook/Threads show "coming soon" badge: [yes/no]
- Onboarding step-3 shows real cards: [yes/no]
- Dashboard banner shows when no accounts connected: [yes/no]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- npm run build: [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 6

**ngrok and OAuth callbacks** — LinkedIn, X, and Meta won't
redirect to localhost. Run `ngrok http 5000` (tunnelling to
Postiz) and use the ngrok HTTPS URL as your callback URL when
registering OAuth apps. Update .env.local: 
`NEXT_PUBLIC_APP_URL=https://your-ngrok-url.ngrok.io`
ngrok free tier generates a new URL on restart — use a fixed
subdomain (ngrok paid) or Cloudflare Tunnel (free, stable URL).

**Postiz OAuth state passthrough** — Postiz may or may not
forward your state JWT to the callback URL. Use `/docs postiz`
to verify. If Postiz strips the state param, you'll need to
store it server-side (short-lived DB row or Redis) before the
redirect and retrieve it in the callback by a different key.
This is a known Postiz behaviour to check early.

**Meta developer setup** — even for READ scopes, you need:
1. A Facebook App in the Meta developer portal
2. Your personal account added as a test user
3. The app in Development mode (not Live)
In Development mode you can test OAuth with your own accounts
without App Review. The connect flow will work for your test
accounts only.

**X OAuth PKCE** — X uses PKCE (Proof Key for Code Exchange)
for OAuth 2.0. Postiz handles this internally. If you see
`invalid_request` from X, confirm Postiz is generating the
code_verifier and code_challenge correctly. The `/docs` command
can pull current X API OAuth 2.0 docs.

**Vault write compensation complexity** — the most error-prone
piece. The callback test file covers all failure paths. If the
compensation tests pass, the implementation is correct. Pay
extra attention to the reconnect case (ON CONFLICT) — the
prior vault secret IDs must be captured from the RETURNING
clause before the upsert overwrites them.

**docker-compose first run** — Postiz's first startup takes
~60 seconds as it initialises the database. The health checks
in docker-compose.yml handle this. If Postiz shows as
unhealthy, wait 90s and check `npm run postiz:logs`.
