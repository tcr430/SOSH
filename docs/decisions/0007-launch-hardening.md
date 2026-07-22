# ADR 0007 — Launch Hardening

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** 1 — MVP (last pre-launch foundation)
**Related:** ADR 0001 §B (schema conventions, service-role-only writes, RLS pattern), ADR 0002 §3 (SocialProviderError taxonomy and recursive redaction — Session 3D fix 4), ADR 0005 §12 (cron route auth, dev-bypass posture, always-200), ADR 0006 §9 (metrics cron route — same auth pattern)

---

## 1. Headline decision

Session 13 ships **three coupled surfaces** — Sentry observability, transport-security headers + CSP, and the rate-limit / health-check / error-boundary trio — under a single binding constraint: **every observable signal that leaves the runtime must be project-aware about token / vault / Stripe / cron-secret material before it reaches a third party**. The three surfaces ship as **one session** because they share the scrubbing primitive specified in §3.3 (`/lib/observability/sentry-scrub.ts` with a single `REDACTED_KEYS` set that the existing `SocialProviderError` redactor — ADR 0002 §3, Session 3D fix 4 — is refactored to import) and the env-var surface specified in §8 (a single additive expansion of `/lib/config.ts`). Splitting them across multiple sessions would either duplicate the redaction list (drift inevitable) or land a half-configured Sentry that captures unredacted vault IDs the moment a webhook throws — neither is acceptable on the deploy that turns Stripe live.

---

## 2. Scope boundaries

### Builds

- `/lib/observability/sentry-scrub.ts` — single source of truth for `REDACTED_KEYS` and `scrubEvent(event)`.
- `instrumentation.ts` (Next.js 16 entrypoint) + `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.
- `withSentryConfig` wrapping `next.config.ts`; source-map upload at build time.
- `Sentry.withMonitor` wrapping `runPublishTick` and `runMetricsSyncTick` inside the orchestrators (not the route handlers).
- `/lib/observability/csp.ts` — CSP policy builder; nonce input, directive output.
- `next.config.ts` `headers()` — static security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP).
- `middleware.ts` — nonce generation + CSP header (Report-Only at launch) injection slotted after `x-pathname` and i18n routing.
- `/lib/auth/rate-limit.ts` — token-bucket consumer (per-IP and per-email).
- `auth_rate_limits` table + `consume_rate_limit_token` SECURITY DEFINER RPC migration.
- Rate-limit wiring into the four auth Server Actions (signup, login, forgot-password, reset-password).
- `cron_health` table + UPSERT on tick start in both orchestrators.
- `/api/_health/route.ts` — top-level health endpoint (token-gated).
- `app/global-error.tsx`, `app/[locale]/error.tsx`, `app/[locale]/not-found.tsx`.
- `pruneStaleAuthRateLimits(client)` folded into the existing publish-cron janitor (Phase A.1, ADR 0005 §8).
- `SocialProviderError` recursive redactor refactored to import the shared `REDACTED_KEYS` set (Builder migration item).
- `@vercel/speed-insights` + `@vercel/analytics` installed and mounted in `app/[locale]/layout.tsx` (Server Component); no DSN, no config beyond defaults.
- CSP allow-list extended to permit both (§4.3).

### Defers

- Sentry Replay (sample rate stays 0 at launch).
- Sentry profiling.
- SRI on third-party scripts (only `js.stripe.com` at launch).
- HSTS preload-list submission (manual, out-of-band).
- CSP `Content-Security-Policy` enforcement — launches as `Content-Security-Policy-Report-Only`; flipped via `CSP_ENFORCE=true` after the 24h-quiet criterion in §9.
- Upstash / Redis-backed rate limiter — single-region Supabase is the launch position.
- Per-business Sentry tags (PII review).
- Restricting `img-src https:` to a specific Supabase Storage origin.

---

## 3. Observability — Sentry

### 3.1. Init topology

Next.js 16's instrumentation pattern. Three init files; `instrumentation.ts` is the entrypoint that loads the right one per runtime.

| File | Runtime |
|---|---|
| `sentry.client.config.ts` | Browser bundle |
| `sentry.server.config.ts` | Node.js runtime (routes, Server Actions, orchestrators) |
| `sentry.edge.config.ts` | Edge runtime (middleware.ts only) |

Each file passes the same shape to `Sentry.init(...)`:

```ts
{
  dsn: config.public.SENTRY_DSN,                 // optional — see §8
  environment: config.public.SENTRY_ENVIRONMENT, // defaults at config-build time to VERCEL_ENV
  release: config.public.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.05,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  ignoreErrors: IGNORE_ERRORS,                   // §3.4
  integrations: [/* defaults; no Replay */],
  sendDefaultPii: false,                         // §3.3 IP scrubbing
}
```

**No `profilesSampleRate`. `replaysSessionSampleRate = 0`. `replaysOnErrorSampleRate = 0`.** Errors-only at launch.

**`tracesSampleRate: 0.05`** — justified: we want distributed-trace context for cross-runtime errors (Server Action → orchestrator → provider) on a small, statistically meaningful sample. We are not running flame-graph performance analysis; 5% is enough to reconstruct cause chains when an error fires inside a sampled trace. Raise post-launch only if triage demands it.

**Tunnel option.** Sentry `tunnel` is **NOT** configured. A same-origin proxy to dodge ad-blockers adds an unrate-limited endpoint we would have to harden; B2B SaaS users are not the audience where ad-blocker blackout is a material risk. Revisit if client-side event volume reads as anomalously low post-launch.

**Config build-time defaulting** — `config.public.SENTRY_ENVIRONMENT` resolves to `process.env.VERCEL_ENV` (`'production'` | `'preview'` | `'development'`) **at config parse time, inside `/lib/config.ts`**. No file outside `/lib/config.ts` reads `process.env` directly (CLAUDE.md convention).

### 3.2. Source-map upload

`withSentryConfig` wraps `next.config.ts`:

```ts
export default withSentryConfig(nextConfig, {
  org: config.server.SENTRY_ORG,
  project: config.server.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,   // build-time ONLY — see below
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
})
```

- **`SENTRY_AUTH_TOKEN` is a Vercel build-time env var; it MUST NOT be read at runtime.** It is set in Vercel → Settings → Environment Variables with scope = Build. `config.server.SENTRY_AUTH_TOKEN` is intentionally **not** added to `/lib/config.ts`; the only reader is `next.config.ts` during the build step. (NOTE: `@sentry/nextjs` 8.x+ also auto-picks `SENTRY_AUTH_TOKEN` from env when the field is omitted; the explicit pass-through in the config snippet above is kept for call-site clarity.)
- `widenClientFileUpload: true` — uploads chunks that Sentry would otherwise skip (Next.js's split chunks).
- `hideSourceMaps: true` — uploads maps for symbolication but strips them from public bundles so we don't ship source to the browser.
- `disableLogger: true` — Sentry's own logger spams build output. We get nothing from it; remove the noise.

### 3.3. Scrubbing — the project-specific part

**This is the reason this ADR exists, not the wizard.**

Single source of truth: `/lib/observability/sentry-scrub.ts`. It exports:

```ts
export const REDACTED_KEYS: ReadonlySet<string>     // lowercase key names
export function scrubEvent(event: Sentry.Event): Sentry.Event | null
```

`SocialProviderError`'s existing recursive redaction (ADR 0002 §3, Session 3D fix 4) is **refactored** to `import { REDACTED_KEYS } from '@/lib/observability/sentry-scrub'`. **Two lists cannot exist.** This refactor is a Builder task line item, not Architect work; the contract is "the redactor uses the shared set; behaviour for the existing test cases is unchanged."

**`REDACTED_KEYS` minimum (lowercase, exact match after key normalisation):**

```
access_token, refresh_token, accesstoken, refreshtoken,
vault_access_token_id, vault_refresh_token_id,
stripe_secret_key, stripe_webhook_secret,
cron_secret, oauth_state_secret, healthcheck_token,
sentry_auth_token, sentry_dsn,
authorization, cookie, set-cookie,
password, password_confirmation, new_password,
token, secret, api_key                                // catch-alls — last
```

The matcher lowercases the key and strips non-alphanumeric characters before comparing, so `Access-Token`, `accessToken`, and `access_token` all hit `accesstoken`. The catch-alls (`token`, `secret`, `api_key`) are last because they trigger on substring intent; the explicit entries above are kept for self-documenting intent in code review.

**URL-query scrubbing.** `event.request.url` and every breadcrumb with `category === 'navigation' || category === 'fetch'` have their URLs rewritten by this regex:

```
/([?&](?:token|code|state)=)[^&#]+/gi  →  '$1[Filtered]'
```

`?token=`, `?code=`, `?state=` are the OAuth callback surface (ADR 0002 §7) and the password-reset surface. They cannot reach Sentry.

**Route-path exclusion.** `scrubEvent` inspects `event.request.url`; if the pathname matches `/^\/api\/stripe\/webhook$/` or `/^\/api\/cron\//`, the event is dropped (`scrubEvent` returns `null`). The Stripe webhook body contains customer email, amount, and Stripe customer/subscription IDs; the cron routes carry `CRON_SECRET` in the `Authorization` header which is already redacted but the path exclusion is defence in depth. Errors thrown **within** those handlers are still captured server-side via explicit `Sentry.captureException` calls in the handler itself (which provide a clean event, not a transaction reconstruction); only auto-instrumented transaction events for those paths are dropped.

**User context.** `sendDefaultPii: false` at init does **not** prevent the app from explicitly attaching user context. The dashboard layout (Server Component) calls `Sentry.setUser({ id: user.id })` — **id only**, no email, no display name. The UUID is not PII in isolation; the cross-reference to identity lives in the database, not in Sentry. Calls happen in `app/[locale]/(dashboard)/layout.tsx` after the existing `getUser()` resolution, before child rendering.

**Email scrubbing.** Any string value matching `/^[^@\s]+@[^@\s]+\.[^@\s]+$/` has its local part redacted: `user@example.com → u***@example.com` (first letter kept; rest replaced with `***`). Applied recursively to all string leaves in `event.user`, `event.contexts`, `event.tags`, `event.extra`, and breadcrumb `data`. **Domain visibility is intentional** — support debugging frequently needs "is this a Google Workspace user or a self-hosted MX?" and the domain is not identifying for a B2B SaaS customer's individual end-user.

**IP scrubbing.** `sendDefaultPii: false` at init. Sentry still resolves country/region from the request via its ingest layer; we do not persist the IP itself. No further client-side stripping needed.

### 3.4. Ignore list

```ts
export const IGNORE_ERRORS = [
  // Browser noise — well-documented false positives:
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured with value: <anonymous>',
  'fb_xd_fragment',

  // Next.js control flow — NOT errors:
  'NEXT_REDIRECT',
  'NEXT_HTTP_ERROR_FALLBACK;404',
]
```

`NEXT_REDIRECT` and `NEXT_HTTP_ERROR_FALLBACK;404` are how Next.js implements `redirect()` and `notFound()` — they are thrown sentinels caught by the framework's request handler. They never represent a fault; capturing them turns every successful redirect into a Sentry event.

### 3.5. Cron monitors

Wrap **the orchestrator functions, not the route handlers**. The route handler's always-200 contract (ADR 0005 §12, ADR 0006 §9) stays untouched; the orchestrator's existing try/catch already swallows to a structured log line. The Sentry wrap goes **inside that try block** so monitor check-ins are recorded for both success and failure paths; exceptions propagate to the wrap (which signals "failed check-in" to Sentry), are re-caught by the orchestrator's existing handler, and the route still returns 200.

```ts
// /lib/publishing/orchestrator.ts
await Sentry.withMonitor(
  'publish-tick',
  async () => { /* existing tick body */ },
  {
    schedule: { type: 'crontab', value: '* * * * *' },
    checkinMargin: 2,
    maxRuntime: 1,            // minutes
    failureIssueThreshold: 3,
    recoveryThreshold: 1,
  }
)

// /lib/metrics/orchestrator.ts
await Sentry.withMonitor(
  'metrics-sync-tick',
  async () => { /* existing tick body */ },
  {
    schedule: { type: 'crontab', value: '0 * * * *' },
    checkinMargin: 5,
    maxRuntime: 1,
    failureIssueThreshold: 3,
    recoveryThreshold: 1,
  }
)

// /lib/publishing/orchestrator.ts — janitor (runs alongside publish tick)
await Sentry.withMonitor(
  'janitor-cron',
  async () => { /* janitor body */ },
  {
    schedule: { type: 'crontab', value: '* * * * *' },
    checkinMargin: 2,
    maxRuntime: 1,
    failureIssueThreshold: 5,  // janitor failures are less critical than tick failures
    recoveryThreshold: 1,
  }
)
```

`failureIssueThreshold: 3` on tick monitors — one missed check-in happens (Vercel cold start, scheduler hiccup); three in a row is a pattern that warrants paging. `recoveryThreshold: 1` — one successful tick resolves the issue. `failureIssueThreshold: 5` on the janitor — janitor cleanup runs alongside the publish tick but is its own observability surface; a janitor failure that doesn't manifest as a publish-tick failure is a real visibility gap, hence the third monitor. The higher threshold reflects that a missed janitor run is not immediately user-impacting.

### 3.6. What Sentry does NOT do here

- **Does not replace** the structured one-line `console.log(JSON.stringify({ kind, ...summary }))` per tick (ADR 0005 §17, ADR 0006 §10). Both stay; the cron summary line is queryable in Vercel logs and is the authoritative tick record.
- **Does not store AI usage events.** `ai_usage` (ADR 0001 §B.9) is the store. Sentry would duplicate at higher cost with worse query semantics.
- **Does not store webhook events.** `billing_events` (Session 11A) is the store. Only exceptions thrown by the webhook dispatcher reach Sentry.
- **Does not get the Stripe webhook raw body.** Sentry's default integrations do not capture POST bodies; the §3.3 route-path exclusion is the contractual backstop. The signed payload (Stripe's secret-derived signature in the header, PII in the body) never leaves the runtime.

### 3.7. Free-tier budget posture

Sentry free tier provides ~5K errors/month and ~10K performance units/month. At `tracesSampleRate = 0.05` performance is fine; **errors are the constraint**. A single noisy bug can exhaust the quota in a day.

The posture is: **do NOT add programmatic rate limiting inside the app** — it would suppress events we want to see. Instead, the launch checklist (`/docs/launch-checklist.md` §4) owns a manual circuit-breaker procedure. Three escalating actions, each a deliberate deploy:

1. Identify the dominant issue group; if a single group accounts for >50% of events, add it to `IGNORE_ERRORS` (§3.4) and redeploy.
2. If multiple groups dominate, set `tracesSampleRate = 0` and redeploy (errors-only mode).
3. If still over budget, set `SENTRY_DSN` to empty in prod env and redeploy (kill switch); accept blindness for the rest of the billing month while the underlying bug is fixed.

None of these are silent; each is an intentional change captured in the deploy log.

---

## 4. Transport security — headers

### 4.1. Where the headers live

Two surfaces:

**(a) `next.config.ts` `headers()`** — static headers applied to all responses: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP. No per-request data, no recomputation per request.

**(b) `middleware.ts`** — CSP only, because the nonce is per-request. Launches as `Content-Security-Policy-Report-Only` (NOT enforcing) for the first 7 days. Toggle is `config.server.CSP_ENFORCE` (default `false`; flip to `true` after the report-uri stream has been empty for 24 consecutive hours — criterion in §9).

**Justify the split:** nonces require per-request randomness, which `next.config.ts` `headers()` cannot produce (it is evaluated once at build/route-config time). Everything else is static; computing it per request in middleware would waste cycles on every navigation.

### 4.2. Nonce generation and propagation

```ts
// In middleware.ts, after auth + i18n + x-pathname:
const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
// Length: 22 characters after replacement.
```

The nonce is:
1. Written to the response as `Content-Security-Policy[-Report-Only]: ... 'nonce-{nonce}' ...`.
2. Injected onto the **request** headers as `x-nonce: {nonce}` so Server Components can read `headers().get('x-nonce')` and attach it to inline `<script>` / `<style>` tags they emit.

**Order in `middleware.ts` (existing steps preserved verbatim, new steps appended):**

1. Auth redirect (existing).
2. `x-pathname` injection (existing).
3. i18n locale resolution (existing — next-intl).
4. **NEW: nonce generation.**
5. **NEW: CSP injection (Report-Only at launch).**

**Justify the ordering:** Any i18n-issued redirect short-circuits before step 4, so 30x responses never carry a CSP header — correct behaviour. `x-pathname` is injected on the request before i18n so Server Components downstream of the locale segment can read pathname-derived metadata. Static headers (HSTS, X-Frame-Options, etc.) are applied via `next.config.ts` `headers()` and do NOT pass through middleware.

### 4.3. CSP allow-list (the value-add of this ADR)

The launch policy. Builder copies these directives verbatim into `/lib/observability/csp.ts` (a builder function `buildCsp(nonce: string, reportUri: string): string`). Cited justifications stay in the comments next to each source.

```
default-src 'self'

script-src 'self' 'nonce-{nonce}' 'strict-dynamic'
           https://js.stripe.com
           https://va.vercel-scripts.com
```
- `'strict-dynamic'` lets Next.js's nonced hydration scripts load their dependent chunks without re-listing every internal URL. The `https://js.stripe.com` and `https://va.vercel-scripts.com` entries are a **fallback** for browsers that do not implement `'strict-dynamic'` (per CSP3 semantics, browsers that **do** implement it ignore host-source entries in `script-src` when `'strict-dynamic'` is present). The Stripe.js and Vercel scripts are nonced server-side; their dynamically loaded sub-resources inherit trust via `'strict-dynamic'` on modern browsers, and via the explicit hosts on legacy ones. Both paths are intentional.
- No `'unsafe-inline'` fallback. Older browsers without `'strict-dynamic'` support get blocked, which is the correct posture for a B2B product.
- `js.stripe.com` (Stripe.js) and `va.vercel-scripts.com` (Vercel Speed Insights + Analytics) are the only external script sources at launch.

```
style-src 'self' 'unsafe-inline'
```
- Tailwind v4 emits CSS-in-JS at runtime in development and inlines critical CSS in production. `'unsafe-inline'` on `style-src` is the documented Tailwind posture. **Trade-off:** style injection is a smaller attack surface than script injection (no JS execution, no data exfiltration via inline styles in modern browsers); we accept it. Revisit when Tailwind ships nonce support (§11).

```
img-src 'self' data: blob: https:
```
- `https:` blanket for user-uploaded brand assets at launch. Tighten to the specific Supabase Storage bucket origin once the CDN host is finalised (§11).

```
font-src 'self'
```

```
connect-src 'self'
            https://*.supabase.co
            wss://*.supabase.co
            https://api.stripe.com
            https://*.sentry.io
            https://*.ingest.sentry.io
            https://*.vercel-insights.com
            https://vitals.vercel-insights.com
            {POSTIZ_BASE_URL host only — extracted at config time}
```
- Postiz: pin to the configured host (URL parse → `host`). **Do NOT wildcard `*.postiz`** — Postiz is a self-hosted dependency; the host is known at config time.
- Vercel Speed Insights and Analytics beacon to `*.vercel-insights.com` / `vitals.vercel-insights.com`. Both are first-party-to-Vercel; no other CDN trust is implied.

```
frame-src https://js.stripe.com
          https://hooks.stripe.com
          https://checkout.stripe.com
```

```
frame-ancestors 'none'
```
- Defence in depth with `X-Frame-Options: DENY`. CSP `frame-ancestors` is the modern equivalent and supersedes XFO on browsers that respect it. Both are set deliberately.

```
form-action 'self' https://checkout.stripe.com
base-uri 'self'
object-src 'none'
upgrade-insecure-requests
report-uri {Sentry CSP report endpoint, derived from DSN}
```

**Reporting endpoint choice.** Uses `report-uri` only, **not** `report-to`. `report-to` requires a separate `Report-To` header with an endpoint group; Sentry's CSP endpoint accepts `report-uri`-style POSTs and that is sufficient. Revisit if a future browser baseline drops `report-uri` support.

**Explicit non-inclusions:**
- **NO `'unsafe-eval'`** anywhere.
- **NO `'unsafe-inline'`** on `script-src`.
- **NO `'self'`** on `frame-src` — we never embed ourselves in iframes.

### 4.4. Other headers (static, `next.config.ts`)

```
Strict-Transport-Security:    max-age=63072000; includeSubDomains
X-Content-Type-Options:       nosniff
X-Frame-Options:              DENY
Referrer-Policy:              strict-origin-when-cross-origin
Permissions-Policy:           camera=(), microphone=(), geolocation=(),
                              interest-cohort=(),
                              payment=(self "https://checkout.stripe.com"),
                              fullscreen=(self)
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Resource-Policy: same-site
```

- **HSTS:** 2 years, `includeSubDomains`. **`preload` deliberately absent.** Removing `preload` is reversible; adding it commits the apex domain and every subdomain to HTTPS-only effectively forever. Submission to the HSTS preload list is an explicit post-launch decision (§11), not a default.
- **COOP `same-origin`** + **CORP `same-site`**: CORP `same-site` permits our own subdomains (status pages, future marketing subdomains) to embed or fetch our resources cross-origin within the eTLD+1. `same-origin` would block legitimate same-site embedding. This has **no relationship** to Stripe.js postMessage, which CORP does not govern; Stripe.js works under any CORP value because the message channel is window-to-window, not response-to-document.
- **COEP is deliberately NOT set** — preserves Stripe Checkout iframe compatibility (see §10).

---

## 5. Rate limiting

### 5.1. Scope

Exactly four Server Actions:

1. `signupAction` (`/app/[locale]/(auth)/signup/actions.ts`)
2. `loginAction` (`/app/[locale]/(auth)/login/actions.ts`)
3. `forgotPasswordAction` (`/app/[locale]/(auth)/forgot-password/actions.ts`)
4. `resetPasswordAction` (`/app/[locale]/(auth)/reset-password/actions.ts`)

**Not rate-limited at the app layer:**
- Stripe webhook (`/api/stripe/webhook`) — Stripe rate-limits its own webhook deliveries.
- Cron routes (`/api/cron/publish`, `/api/cron/sync-metrics`) — auth-gated by `CRON_SECRET`.
- All other dashboard Server Actions — authenticated sessions, separate threat model.

### 5.2. Algorithm — token bucket

**Token bucket, not sliding window.** Justified: token bucket allows a small burst (humans typo passwords; we want them to retry without rage-clicking the limiter into a wall), which a sliding-window counter punishes harshly.

**Per-IP bucket:**

| Action | Capacity | Refill |
|---|---|---|
| signup | 5 | 5 / min |
| login | 10 | 10 / min |
| forgot-password | 5 | 5 / min |
| reset-password | 5 | 5 / min |

**Per-email bucket** (login + forgot only):

| Action | Capacity | Refill |
|---|---|---|
| login | 5 | 5 / 15 min |
| forgot-password | 3 | 3 / 15 min |

- **Signup is not per-email-keyed** because the email is created by the request; an attacker enumerating emails would key on candidate addresses, generating buckets on miss — pointless. Per-IP is sufficient.
- **Reset-password is not per-email-keyed** because the reset code is single-use and bound by Supabase Auth's own TTL; a per-email bucket would be a no-op against the same threat.

**Combined rule:** a request **consumes from both buckets it has** (per-IP + per-email where applicable). **Either being empty rejects.**

**Partial-failure policy (explicit):** the per-IP bucket is consumed first, then per-email. If per-IP returns `false`, per-email is **not** consulted (no token spent). If per-IP succeeds and per-email returns `false`, the per-IP token **is** already spent and is **not** refunded; the attacker pays for the rejected attempt. This marginal defender advantage is intentional and avoids a two-phase commit on the RPC.

### 5.3. Storage — `auth_rate_limits` Supabase table

Slotted into ADR 0001 §B alphabetically (between `ai_usage` and `brand_voices`). Mirrors `trial_state`'s service-role-only-write shape:

```sql
CREATE TABLE auth_rate_limits (
  bucket_key   TEXT PRIMARY KEY,         -- 'ip:1.2.3.4:login'
                                         -- or 'email:lower(addr):login'
  tokens       NUMERIC(10, 4) NOT NULL,  -- fixed scale; REAL drifts over many cycles
  last_refill  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- `tokens NUMERIC(10, 4)`: REAL is a 4-byte float and accumulates drift over
-- many refill cycles; a bucket reading 0.99999... when it should be 1.0
-- produces a spurious reject. NUMERIC with fixed scale eliminates the drift.

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies. Service-role bypasses RLS; no other role has access.
```

- **Access:** service-role only, via the lazy-import pattern (CLAUDE.md "Three Supabase client roles"). The four Server Actions call a `/lib/auth/rate-limit.ts` helper which acquires its own service-role client.
- **RLS enabled, NO policies.** Same posture as `ai_usage` / `trial_state` (ADR 0001 §C, "Service-role-only writes"). Enforced by omission.

**Read-modify-write via SECURITY DEFINER RPC:**

```sql
CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(
  p_bucket_key            text,
  p_capacity              numeric,
  p_refill_per_second     numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row auth_rate_limits;
  v_refill numeric;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM auth_rate_limits WHERE bucket_key = p_bucket_key
    FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO auth_rate_limits (bucket_key, tokens, last_refill)
    VALUES (p_bucket_key, p_capacity - 1, v_now);
    RETURN true;
  END IF;

  v_refill := EXTRACT(EPOCH FROM (v_now - v_row.last_refill)) * p_refill_per_second;
  v_row.tokens := LEAST(p_capacity, v_row.tokens + v_refill);

  IF v_row.tokens >= 1 THEN
    UPDATE auth_rate_limits
       SET tokens = v_row.tokens - 1,
           last_refill = v_now,
           updated_at = v_now
     WHERE bucket_key = p_bucket_key;
    RETURN true;
  ELSE
    UPDATE auth_rate_limits
       SET tokens = v_row.tokens,
           last_refill = v_now,
           updated_at = v_now
     WHERE bucket_key = p_bucket_key;
    RETURN false;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) TO service_role;
```

**Janitor — folded into the publish cron's existing Phase A.1 (ADR 0005 §8):**

```ts
export function pruneStaleAuthRateLimits(client: ServiceRoleClient): Promise<number>
// DELETE FROM auth_rate_limits WHERE updated_at < now() - INTERVAL '1 day'
// Returns rows deleted. Called once per publish-cron tick after the
// generation-session janitor.
```

The publish cron already runs every minute and already owns a janitor phase; folding this in costs one extra DELETE per minute (cheap; full table scan on a small table, indexed by PK). No new cron entry.

### 5.4. IP resolution

Read `x-forwarded-for`. Take the **leftmost** entry. Validate as a syntactic IPv4 or IPv6 address. **Invalid** → bucket key `ip:unknown:{action}` — shared across all unparseable requests.

**Acceptable trade-off:** an attacker who can spoof IPs to invalid values lands on a single shared bucket with a tighter combined limit, not a looser one — pessimistic-by-default. Real users behind misconfigured proxies that produce malformed XFF land in the same shared bucket; the limits are generous enough that genuine signup traffic from one malformed-proxy network still completes within capacity.

**Never trust `x-real-ip` in serverless.** Vercel sets it from `x-forwarded-for` with looser parsing; reading both buys nothing and risks reading attacker-controlled data through a less-vetted path.

### 5.5. Response on limit

The Server Action returns the same generic error envelope it already returns for validation failures, with the i18n key `errors.rate_limit`. **Never differentiate** "wrong password rate limit" from "wrong email rate limit" — identical to the generic 401 rationale in ADR 0005 §12. The enumeration leak is the threat; the user-visible message is the same regardless of which bucket emptied.

**No `Retry-After` header.** Server Actions don't return HTTP responses — they return a state object that the form re-renders. The error message is enough; we don't surface "try again in 47 seconds" because (a) we can't reliably project it across both buckets, and (b) it primarily helps the attacker time their next batch.

---

## 6. Error boundaries

### 6.1. Three files

| File | Purpose |
|---|---|
| `app/global-error.tsx` | Multi-locale fallback for crashes that take the root layout down. Cannot use `next-intl` (the i18n provider may itself have crashed), so the file declares a top-level constant `GLOBAL_ERROR_COPY = { en: { title, body, retry, home, reference }, pt: { ... }, es: { ... } } as const`. The component derives locale from `window.location.pathname` (first segment), falling back to `'en'` if the segment is not a known locale key. Translations are inline (no `next-intl`, no import from `/i18n`) so a totally crashed app still renders correctly. Wraps `Sentry.captureException(error)` in `useEffect`. Single `Try again` button calling the `reset` prop. |
| `app/[locale]/error.tsx` | Localised; same Sentry wiring; uses `next-intl` translations. Recoverable via `reset`. |
| `app/[locale]/not-found.tsx` | Localised; **no Sentry capture** — 404 is not an error. |

### 6.2. Design

The visual is driven by the `impeccable-design-and-taste` skill. The Architect names the requirements:

- Tone matches the dashboard aesthetic — not a generic "uh oh" page.
- **No emoji.**
- **No raw stack traces** visible to the user.
- The Sentry event ID returned by `captureException` is displayed in muted text so support can correlate. Copy: `Reference: {id}`.
- Single primary action: `Try again` (reset). Single secondary action: link back to `/` (or the user's locale home).
- **Locale-aware copy** via the inline map in §6.1; never ship English on a `/pt` or `/es` URL even when the root layout has crashed.

### 6.3. What is not an error

- `NEXT_REDIRECT` sentinel (from `redirect()`) — control flow; ignored via §3.4.
- `NEXT_HTTP_ERROR_FALLBACK;404` sentinel (from `notFound()`) — control flow; ignored via §3.4.
- 404s rendered through `not-found.tsx` — the file exists so the framework has a localised UI to render. It does not call Sentry.

---

## 7. Health check

### 7.1. `/api/_health/route.ts` (top-level, new)

`GET`. `HEALTHCHECK_TOKEN`-gated via `Authorization: Bearer <token>`, `crypto.timingSafeEqual` with a length pre-check. **Copy the auth pattern from `/api/_health/social/route.ts` verbatim — do not deviate.** (`safeCompare` helper, length-equal pre-check, 404 on token misconfigured, 404 on auth fail. Dev short-circuit via `config.public.NODE_ENV === 'development'` allowed, identical to the sibling route.)

**Response (always 200, JSON):**

```json
{
  "ts": "2026-06-10T14:00:00.000Z",
  "db": "ok",
  "cron": {
    "publish":     { "lastSeen": "2026-06-10T13:59:30.000Z", "stale": false },
    "metricsSync": { "lastSeen": "2026-06-10T13:00:00.000Z", "stale": false }
  },
  "sentry": { "dsnConfigured": true }
}
```

- **`db` check:** `SELECT 1` via service-role client with a 2-second timeout. On throw or timeout, `db: 'err'`. The endpoint still returns 200; the consuming uptime tool reads the JSON.
- **`lastSeen` source:** `cron_health` table (schema below).
- **`sentry.dsnConfigured`:** boolean derived from `Boolean(config.public.SENTRY_DSN)`. No outbound network call.
- **Stale thresholds:** publish `lastSeen` older than 5 minutes → `stale: true`. Metrics `lastSeen` older than 2 hours → `stale: true`.

**`cron_health` schema:**

```sql
CREATE TABLE cron_health (
  cron_slug    TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cron_health ENABLE ROW LEVEL SECURITY;
-- No policies. Service-role only.
```

**Each cron orchestrator (publish, metrics) UPSERTs its own row at the START of the tick:**

```sql
INSERT INTO cron_health (cron_slug, last_seen_at) VALUES ($1, now())
  ON CONFLICT (cron_slug) DO UPDATE SET last_seen_at = now();
```

Slugs: `'publish'`, `'metrics-sync'`.

**Justify `cron_health` over "read last log line":** Vercel logs are not queryable from a request handler. Vercel's log API exists but adding a runtime dependency on it for a health check is the wrong direction (extra failure mode, extra auth, extra latency). One row, two writes per hour, one read per healthcheck — trivial.

### 7.2. Relationship to Sentry cron monitors

The two are **independent and intentionally redundant**. Sentry Cron Monitors (§3.5) fire if the cron stops checking in with Sentry. `/api/_health` is a pull-based check consumed by Uptime Robot / status-page tooling. **The bus factor of Sentry going down is non-zero**; an independent health path means a Sentry outage does not blind us to cron health.

---

## 8. Configuration

### 8.1. New env vars — `/lib/config.ts` additions

| Var | Public/Server | Required in prod | Notes |
|---|---|---|---|
| `SENTRY_DSN` | public | **No** (degraded mode OK if absent) | If absent, `Sentry.init` is a no-op and the app still boots. Useful for local dev and self-host distributions. |
| `SENTRY_ENVIRONMENT` | public | No | Default: `process.env.VERCEL_ENV` at config parse time. |
| `SENTRY_ORG` | server | No (only `next.config.ts` reads it) | Source-map upload. |
| `SENTRY_PROJECT` | server | No (only `next.config.ts` reads it) | Source-map upload. |
| `SENTRY_AUTH_TOKEN` | — | **Build-time only — NEVER read at runtime** | Set in Vercel build env. NOT added to `/lib/config.ts` getters. |
| `VERCEL_GIT_COMMIT_SHA` | public | No (provided by Vercel) | Release tag. |
| `CSP_ENFORCE` | server | No | Default `false` (Report-Only). Flip to `true` post-launch per §4.1 criterion. |
| `AUTH_RATE_LIMIT_ENABLED` | server | No | Default `true`. Escape hatch — flip to `false` only to debug a limiter-induced outage. |

**No new REQUIRED env var.** The full hardening posture degrades gracefully when `SENTRY_DSN` is absent — Sentry init returns a no-op, the rest of the surface (CSP, headers, rate limit, health, error boundaries) works unchanged.

`SENTRY_AUTH_TOKEN` is **deliberately omitted** from the `config.server` getters: the only reader is `next.config.ts` at build time, where it reads `process.env.SENTRY_AUTH_TOKEN` directly. This is the one place outside `/lib/config.ts` that touches `process.env` and is justified by the build-time-only contract.

---

## 9. Accepted tech debt

- **Rate limiter is single-region Supabase-backed.** Multi-region Vercel deploy is incompatible without a shared store with regional locality (Supabase is one DB in one region; cross-region writes go through that region). Document Upstash (or Redis-on-Vercel-Marketplace) migration as the path; see §11.
- **CSP launches in Report-Only mode for 7 days.** The runbook (`/docs/launch-checklist.md` §5) names the criterion for flipping `CSP_ENFORCE=true`: 24 consecutive hours with zero CSP report-uri events. If reports keep arriving, fix the source (typically a third-party script we haven't enumerated); do not flip enforcement to silence the report stream.
- **Email scrubbing keeps the domain.** Justified in §3.3 (support debugging needs domain visibility). Revisit if a low-N tenant's domain becomes identifying — e.g. a single customer on a unique vanity domain.
- **HSTS `preload` directive deliberately NOT set at launch.** Re-add and submit only after 90 days of stable HTTPS posture across all subdomains, including any marketing or status subdomains added post-launch. Adding `preload` commits the apex and every subdomain to HTTPS-only effectively forever; the launch posture is intentionally reversible.
- **`'unsafe-inline'` on `style-src` is a documented Tailwind trade-off.** Smaller attack surface than script injection; tighten when Tailwind ships nonce support.
- **`SocialProviderError` redactor refactor.** The shared `REDACTED_KEYS` import is a Builder task; until landed, two lists exist transiently within the session. Reviewer verifies the merge before session close.

---

## 10. Out of scope

Matches the session preamble "Defers" list verbatim.

- Sentry Replay (sample rate stays 0 at launch).
- Sentry profiling.
- SRI on third-party scripts other than `js.stripe.com` and `va.vercel-scripts.com` (no others at launch).
- HSTS `preload` directive — deliberately omitted at launch (§4.4, §9); revisit in §11.
- **Cross-Origin-Embedder-Policy (COEP)** — deliberately unset to preserve Stripe Checkout iframe compatibility.
- **Sentry-side error-message translation** — Sentry issues remain in English; only the user-facing copy in `global-error.tsx` / `error.tsx` is localised.
- CSP `Content-Security-Policy` **enforcement** — launches as Report-Only.
- Upstash / Redis-backed rate limiter — single-region Supabase is the launch position.
- Per-business Sentry tags (PII review).
- Restricting `img-src https:` to a specific Supabase Storage origin.
- Domain-based email scrubbing escalation (low-N tenant case).
- Replacing the structured cron log line with Sentry-only observability.
- Per-route Sentry sampling overrides (`tracesSampler`); the global 0.05 is fine at launch.

---

## 11. Open follow-ups

- **Restrict `img-src https:` → specific Supabase Storage origin** once the brand-asset CDN host is finalised. Currently blanket-`https:` because the bucket host isn't pinned in any one place; resolve when the bucket is created in prod.
- **Submit domain to the HSTS preload list** — post-launch, after 90 days with HTTPS posture stable across every subdomain (including any marketing or status subdomains added post-launch). Add the `preload` directive to the HSTS header in the **same deploy** as submission via https://hstspreload.org.
- **Migrate rate limiter to Upstash** (or equivalent shared store) if multi-region deploy lands, or if login QPS makes the `auth_rate_limits` row hot enough to surface in `pg_stat_statements`.
- **SRI on third-party scripts** other than `js.stripe.com` — none exist at launch; named here so future adds remember.
- **`replaysOnErrorSampleRate > 0`** when the Sentry plan supports Replay and masking config is verified to never capture vault token UI surfaces.
- **Per-business Sentry tags** (`business_id`, `plan`) — needs PII review; defer until triage actually needs it. Today the event ID + Reference UX in §6.2 plus support's database access is enough.
- **`tracesSampler` per-route overrides** if the global 0.05 hides a meaningful failure surface.
- **CSP `script-src` nonce on Tailwind** — when upstream support lands, drop `'unsafe-inline'` from `style-src`.
- **`SocialProviderError.toJSON()`** — ADR 0002 open follow-up; if revisited, route the output through `scrubEvent`'s string-leaf scrubber (URL + email rules) so debug dumps don't bypass the shared redactor.

---

## 12. Architect end

The Architect role ends here. No code is authored in this session. The Builder session reads this ADR plus the launch-checklist skeleton, then implements the surfaces in the order Sentry init → scrubber → CSP/headers → rate limiter → health check → error boundaries. The order is chosen so the scrubber lands before the first event can fire, and the rate limiter lands before the first signup smoke test.
