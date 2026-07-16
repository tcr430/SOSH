# Session 13 — Launch Hardening

> **Goal:** Production-ready posture in three movements. (1) **Observability:** `@sentry/nextjs` wired across server / client / edge with PII-and-token-aware scrubbing, source-map upload, release tagging, and Sentry Cron Monitors on the two cron routes. (2) **Transport security:** strict CSP with per-request nonces, HSTS, frame/MIME/referrer/permissions headers, all injected via `middleware.ts` (per-request nonces can't live in `next.config.ts`). (3) **Ops hygiene:** rate limiting on the four public auth Server Actions, Sentry-wired error boundaries, an expanded health check, and a committed `docs/launch-checklist.md` runbook so the pre-flight steps stop living in someone's head.
> **Time:** 5–7 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction (Sonnet 4.6)
> **Plugins:** ECC throughout, claude-mem automatic, `impeccable-design-and-taste` available for the error-page surfaces (`global-error.tsx`, `error.tsx`, `not-found.tsx`)
> **Session structure:** Architect runs first and stops. The Builder and Reviewer prompts in this file are intentionally **stubs** — they are filled in only after ADR 0007 is reviewed, to avoid burning tokens redoing Builder work when the ADR comes back different than expected.

---

## Why an Architect session for what looks like "wiring"

The wiring is well-trodden — `@sentry/nextjs init`, `next.config.ts headers()`, a rate-limit table. The *decisions* are not:

- **CSP allow-list** is a tenant-by-tenant judgement call. Get it wrong on the strict side and the dashboard breaks for paying customers on first deploy. Get it wrong on the loose side and the strict-CSP posture is theatre.
- **Per-request nonces** force the CSP into `middleware.ts`, which already does auth + i18n + `x-pathname` injection. Order matters; Server Components need the nonce on a request header that survives the chain.
- **PII scrubbing in `beforeSend`** has to extend the existing `SocialProviderError` recursive-redaction list (Session 3D, fix 4) — not duplicate it, not contradict it. The allow-list of redacted keys is project-specific and worth a single source of truth.
- **Rate-limit storage** at launch is one decision (Supabase-backed table vs in-memory vs Upstash). The wrong default ages badly — a Map in a serverless function is per-instance, useless for distributed limits, but adding Upstash now is yak-shaving when no one is logging in yet.
- **What goes in the launch checklist** is a forcing function for naming every other small decision that hasn't been written down (Stripe live-mode flip ordering, dev-bypass header sweep, PITR retention, abuse contact). These belong in a committed runbook, not in a Slack message during the deploy.

ADR 0007 nails those decisions so the Builder has nothing to invent.

---

## What this session builds and what it doesn't

**Builds:**

- ADR 0007 — Launch Hardening (Architect output, no code)
- `docs/launch-checklist.md` — committed pre-flight runbook (Architect drafts skeleton; Builder fills concrete env-var rows)
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (Next.js 16's `instrumentation.ts` pattern routes to them) — DSN-gated, errors-only at launch, 5% trace sample, project-specific scrubber
- `lib/observability/sentry-scrub.ts` — single source of truth for the redaction allow-list; consumed by `beforeSend` and reusable from anywhere that needs to scrub before logging
- `lib/observability/csp.ts` — `buildCsp(nonce)` returns the policy string; pure function, unit-tested
- `lib/observability/security-headers.ts` — header bundle (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, CORP)
- `middleware.ts` updates — nonce generation, CSP injection (Report-Only at launch), security-header injection, ordered after auth + i18n
- `lib/auth/rate-limit.ts` + migration — token-bucket rate limiter backed by a new `auth_rate_limits` table; per-IP and per-email keys; consumed by signup / login / forgot-password / reset-password Server Actions
- `app/global-error.tsx`, `app/[locale]/error.tsx`, `app/[locale]/not-found.tsx` — locale-aware, designed via the `impeccable-design-and-taste` skill, wired to `Sentry.captureException`
- `app/api/_health/route.ts` — top-level health check (db ping + last-cron-seen for both crons + sentry-dsn-configured boolean), HEALTHCHECK_TOKEN gated, `crypto.timingSafeEqual`
- `lib/config.ts` additions — `SENTRY_DSN` (optional), `SENTRY_AUTH_TOKEN` (build-time, source-map upload), `SENTRY_ENVIRONMENT` (defaults to `VERCEL_ENV`), `VERCEL_GIT_COMMIT_SHA` (release tag, public, read-only)
- `next.config.ts` — `withSentryConfig` wrapper (source-map upload), static `headers()` for the non-nonce-bearing routes (`/api/*`, static assets) where applicable
- Sentry Cron Monitor wiring in `/app/api/cron/publish/route.ts` and `/app/api/cron/sync-metrics/route.ts` — `Sentry.withMonitor()` wrap, no behaviour change to the routes' existing always-200 contract

**Defers (explicit non-goals, named so we don't argue about them mid-Builder):**

- **Email / Resend transactional flow** — Session 14. The `impeccable-design-and-taste` skill earns its keep there.
- **Sentry Performance / Profiling** — errors-only at launch; tracing sample is 5% solely so distributed-trace context exists for the rare error that spans cron → DB → provider. No flame graphs.
- **Upstash / Redis rate limiting** — `auth_rate_limits` Supabase table is sufficient at single-region Phase 1 volume. Accepted tech debt; revisit when login QPS makes a row-per-attempt log hot.
- **WAF / Cloudflare bot management** — Vercel's edge protection is the launch posture.
- **Plan-limit / capability-hardcoding sweep** (Session 11A known issues) — separate refactor session.
- **`middleware.ts` → `proxy.ts` rename** (Next.js 16 deprecation) — separate cleanup pass.
- **Status page / Statuspage / BetterStack** — checklist names the URL slot but provisioning is out of scope.
- **Legal pages (Terms, Privacy, DPA)** — checklist names them as a non-engineering blocker; copy is out of scope.
- **`error_log` table or app-level error storage** — Sentry is the store; no shadow log.
- **Sub-Resource Integrity on the Stripe.js script tag** — Stripe explicitly tells you not to (the script is versioned by them); checklist documents this so a reviewer doesn't "fix" it.
- **`global-error.tsx` i18n** — single-locale English-only fallback. The locale segment may have failed to load by the time `global-error.tsx` fires. The `[locale]/error.tsx` boundary is the localised one.

---

## Pre-session checklist

- [ ] Session 12 fully complete — metrics worker live, current-phase.md reflects "Session 12D complete"
- [ ] Sentry account created (free tier), project provisioned, DSN copied, **auth token for source-map upload generated**
- [ ] You can confirm Sentry Cron Monitors are on the free tier (they are at time of writing — verify in the Sentry pricing page before Architect)
- [ ] `VERCEL_GIT_COMMIT_SHA` is exposed by Vercel automatically — sanity check by running `vercel env pull` and grepping
- [ ] Decide single-region or multi-region Vercel deployment **now** — affects whether the Supabase-backed rate limiter is acceptable. ADR will assume single-region (`fra1` per existing config).
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/db lib/social lib/campaigns lib/ai lib/publishing lib/stripe lib/metrics` passes (full suite green)
- [ ] claude-mem running at http://localhost:37777
- [ ] You've skimmed the [Next.js 16 CSP-with-nonce docs](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy) for 10 min — the middleware pattern is the reference

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Opus 4.7**
3. Paste Primer
4. Architect lists planned ADR sections; **wait for your approval**
5. Paste Architect Prompt
6. Architect writes ADR 0007 + the launch-checklist skeleton
7. **Type one confirmation line and `/exit`** — the Architect's last action
8. **STOP. Do not start the Builder yet.** Read the ADR end-to-end. Push back in a fresh chat with me before proceeding to Part B.

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.

Read /docs/decisions/0001-database-schema.md §B (auth_rate_limits
will be a new table — slot it in §B alphabetically; mirror the
trial_state shape for service-role + TTL semantics).

Read /docs/decisions/0002-social-provider.md §3 (error taxonomy
and SocialProviderError recursive redaction — Session 3D fix 4;
your Sentry beforeSend EXTENDS this allow-list, does not duplicate
or contradict it).

Read /docs/decisions/0005-publishing-worker.md §12 (cron route
auth pattern — timingSafeEqual, length pre-check, dev-bypass
header honoured only when NODE_ENV !== 'production', single
generic 401 body. The two crons stay as-is; you wrap them with
Sentry.withMonitor, you do not modify the auth.)

Read /docs/decisions/0006-metrics-worker.md §9 (same cron pattern,
no Phase A/B split, always-200).

Read /middleware.ts (current chain: auth redirect, i18n locale,
x-pathname injection — your nonce + CSP + security headers slot
in at a precise place).

Read /lib/config.ts (typed env-var surface — your new SENTRY_*
vars and VERCEL_GIT_COMMIT_SHA go here, mirroring the existing
shape: public.* for client-safe, server.* for server-only,
optional vs required-in-production distinguished).

Read /app/api/_health/social/route.ts (existing pattern for
HEALTHCHECK_TOKEN-gated routes with timingSafeEqual — the top-
level /api/_health/route.ts follows it).

Read /app/[locale]/(auth)/signup/actions.ts, login/actions.ts,
forgot-password/actions.ts, reset-password/actions.ts — the four
surfaces that consume the new rate limiter.

Read /package.json — confirm Next.js 16, @sentry/nextjs is NOT
yet installed.

DO NOT WRITE CODE. You are the Architect. Your output is ONE ADR
markdown file (/docs/decisions/0007-launch-hardening.md) and ONE
runbook markdown file skeleton (/docs/launch-checklist.md). No
.ts, no .sql, no .tsx, no next.config.ts edits.
```

### Architect Prompt

```
You are the Architect for SOSH Session 13 — Launch Hardening.

DELIVERABLE 1: /docs/decisions/0007-launch-hardening.md
DELIVERABLE 2: /docs/launch-checklist.md (runbook skeleton)

Match the voice, density, and section conventions of ADR 0005
(publishing worker) and ADR 0006 (metrics worker). Cross-reference
prior ADRs by section number rather than restating their content.
Keep §1 to a single headline decision.

ADR 0007 sections (use these exact headings, in this order):

1. HEADLINE DECISION — one paragraph. The headline is that
   Session 13 ships THREE coupled surfaces that share one
   constraint: every observable signal must be project-aware
   about token / vault / Stripe / cron-secret material before
   it leaves the runtime. State the constraint, name the three
   surfaces (Sentry / CSP+headers / rate-limit+health+errors),
   and assert that they ship as one session because they share
   the scrubbing primitive (§4) and the env-var surface (§11).

2. SCOPE BOUNDARIES — bulleted in / out lists. Match the
   "Builds / Defers" lists in the session preamble. Restate
   them so the ADR stands alone.

3. OBSERVABILITY — SENTRY

   3.1. INIT TOPOLOGY
        Next.js 16 instrumentation.ts pattern. Three init files
        (client/server/edge). Each receives DSN, environment,
        release, tracesSampleRate, integrations, beforeSend,
        beforeSendTransaction, ignoreErrors. Specify the exact
        values:
        - environment: config.public.SENTRY_ENVIRONMENT
          (defaults to process.env.VERCEL_ENV at config-build
          time; never read process.env at runtime outside config)
        - release: config.public.VERCEL_GIT_COMMIT_SHA
        - tracesSampleRate: 0.05 (justify: distributed-trace
          context for cross-runtime errors, not flame graphs)
        - errors-only at launch — no profilesSampleRate, no
          replaysSessionSampleRate, replaysOnErrorSampleRate = 0

   3.2. SOURCE-MAP UPLOAD
        withSentryConfig wraps next.config.ts. SENTRY_AUTH_TOKEN
        is a Vercel build-time env var, NEVER read at runtime.
        widenClientFileUpload: true. hideSourceMaps: true.
        disableLogger: true (Sentry's own logger spams build
        output).

   3.3. SCRUBBING — THE PROJECT-SPECIFIC PART (the reason this
        ADR exists, not the wizard)
        Single source of truth at /lib/observability/sentry-scrub.ts
        exporting REDACTED_KEYS (a Set<string>, lowercase) and
        scrubEvent(event). The Sentry beforeSend calls scrubEvent;
        SocialProviderError's existing recursive redaction
        (ADR 0002, Session 3D fix 4) is REFACTORED to import the
        same REDACTED_KEYS set (so the two cannot drift). Name
        the migration: a Builder-task line item, not Architect
        work.

        REDACTED_KEYS minimum:
        - access_token, refresh_token, accesstoken, refreshtoken
        - vault_access_token_id, vault_refresh_token_id
        - stripe_secret_key, stripe_webhook_secret
        - cron_secret, oauth_state_secret, healthcheck_token
        - sentry_auth_token, sentry_dsn (in case it ends up
          in a captured request body)
        - authorization, cookie, set-cookie
        - password, password_confirmation, new_password
        - token, secret, api_key (catch-alls — last)

        URL-query scrubbing: redact ?token=, ?code=, ?state=
        values to '[Filtered]' on event.request.url AND on
        every breadcrumb whose category is 'navigation' or
        'fetch'. Specify the regex.

        Email scrubbing: keep the domain, redact the local part
        (user@example.com → u***@example.com). Justify: support
        debugging needs domain visibility; user identity does
        not need to be in Sentry.

        IP scrubbing: SET sendDefaultPii: false at init. Sentry
        will still resolve country/region from the request; we
        do not store the IP.

   3.4. IGNORE LIST
        ignoreErrors patterns: standard browser noise (ResizeObserver
        loop limit exceeded, Non-Error promise rejection captured
        with value: <anonymous>, fb_xd_fragment), Next.js redirect
        sentinel (NEXT_REDIRECT), Next.js not-found sentinel
        (NEXT_HTTP_ERROR_FALLBACK;404). Justify each — the redirect
        and not-found sentinels are how Next.js implements control
        flow, they are NOT errors.

   3.5. CRON MONITORS
        Wrap runPublishTick and runMetricsSyncTick (the orchestrator
        functions, NOT the route handlers — keeps the always-200
        cron contract from ADR 0005 §12 and 0006 §9 untouched) in
        Sentry.withMonitor(slug, fn, { schedule }).
        - slug: 'publish-tick' and 'metrics-sync-tick'
        - schedule: { type: 'crontab', value: '* * * * *' } and
          { type: 'crontab', value: '0 * * * *' }
        - checkinMargin: 2 (publish), 5 (metrics)
        - maxRuntime: 1 (publish, in minutes), 1 (metrics)
        - failureIssueThreshold: 3 (one miss happens; three is a
          pattern)
        - recoveryThreshold: 1

        Document that the wrap MUST be inside the orchestrator
        and MUST NOT swallow exceptions differently than today —
        Sentry monitor errors are signalled by the wrap throwing,
        but the route's existing try/catch already swallows to
        always-200. The wrap goes inside the try block so monitor
        check-ins are recorded for both success and failure paths.

   3.6. WHAT SENTRY DOES NOT DO HERE
        - Does not replace the structured one-line JSON.stringify
          log per tick (ADR 0005 §17, ADR 0006 §10). Both stay.
        - Does not store AI usage events (ai_usage table is the
          store; Sentry would duplicate).
        - Does not store webhook events (billing_events is the
          store; only EXCEPTIONS from webhook handling reach
          Sentry).
        - Does not get the Stripe webhook raw body. Verify
          Sentry's auto-instrumentation does not capture
          request bodies on POST /api/stripe/webhook — explicit
          tracePropagationTargets exclusion if needed.

4. TRANSPORT SECURITY — HEADERS

   4.1. WHERE THE HEADERS LIVE
        Two surfaces:
        (a) next.config.ts headers() — static headers applied
            to ALL responses (HSTS, X-Content-Type-Options,
            X-Frame-Options, Referrer-Policy, Permissions-Policy,
            COOP, CORP). These don't need per-request data.
        (b) middleware.ts — CSP only (per-request nonce). The
            middleware writes Content-Security-Policy-Report-Only
            at launch (NOT Content-Security-Policy) for the first
            7 days; toggle is via a config flag CSP_ENFORCE
            (default false; flip to true after the report-uri
            stream is empty for 24h).

        Justify the split: nonces require per-request randomness,
        which next.config.ts headers() cannot produce; everything
        else is static and belongs in next.config to avoid
        recomputing per request.

   4.2. NONCE GENERATION AND PROPAGATION
        crypto.randomUUID() in middleware.ts, base64-encoded
        (replace +/= → -_) to be CSP-safe. Length: 22 chars
        after replacement. The nonce is written to the response
        as `Content-Security-Policy[-Report-Only]: ... 'nonce-{nonce}' ...`
        AND injected as a request header `x-nonce` so Server
        Components can read it via `headers().get('x-nonce')` and
        attach it to inline <script> / <style> tags they emit.

        Order in middleware.ts:
        1) auth redirect (existing)
        2) i18n locale (existing — next-intl middleware)
        3) x-pathname injection (existing)
        4) NEW: nonce generation
        5) NEW: CSP + security-headers injection
        Justify: nonce comes AFTER i18n so any next-intl-driven
        redirect skips CSP (redirects don't need it). The
        injection step writes to the OUTGOING response after
        any earlier middleware has decided not to short-circuit.

   4.3. CSP ALLOW-LIST (the value-add of this ADR)
        Specify every directive. For each, justify each source.
        Below is the launch policy; the Builder copies these
        values verbatim into /lib/observability/csp.ts.

        default-src 'self'
        script-src 'self' 'nonce-{nonce}' 'strict-dynamic'
          https://js.stripe.com
          (strict-dynamic lets Next.js's hydration scripts —
          which are nonced — load their own children without
          re-listing every CDN. No 'unsafe-inline' fallback;
          older browsers without strict-dynamic support get
          blocked, which is the correct posture for B2B.)
        style-src 'self' 'unsafe-inline'
          (Tailwind v4 emits CSS-in-JS at runtime in development
          and inlines critical CSS in production. 'unsafe-inline'
          on style-src is the documented Tailwind posture. Note
          the trade-off in the ADR — style injection is a smaller
          attack surface than script injection.)
        img-src 'self' data: blob: https:
          (https: for user-uploaded brand assets; tighten to
          specific Supabase Storage bucket origin post-launch
          — name as open follow-up.)
        font-src 'self'
        connect-src 'self'
          https://*.supabase.co
          wss://*.supabase.co
          https://api.stripe.com
          https://*.sentry.io
          https://*.ingest.sentry.io
          {POSTIZ_BASE_URL host only — built at config time}
          (Do NOT wildcard *.postiz; pin to the configured host.)
        frame-src https://js.stripe.com
          https://hooks.stripe.com
          https://checkout.stripe.com
        frame-ancestors 'none'
          (Defence in depth with X-Frame-Options DENY; CSP
          frame-ancestors is the modern equivalent. Both are
          set deliberately.)
        form-action 'self' https://checkout.stripe.com
        base-uri 'self'
        object-src 'none'
        upgrade-insecure-requests
        report-uri {Sentry CSP report endpoint, derived from DSN}

        Document explicitly: NO 'unsafe-eval'. NO 'unsafe-inline'
        on script-src. NO 'self' on frame-src (we never embed
        ourselves in iframes).

   4.4. OTHER HEADERS (static, next.config.ts)
        Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
          (2y, preload-list eligible — name "submit to HSTS preload
          list" as a checklist item, NOT a code change)
        X-Content-Type-Options: nosniff
        X-Frame-Options: DENY
        Referrer-Policy: strict-origin-when-cross-origin
        Permissions-Policy: camera=(), microphone=(), geolocation=(),
          interest-cohort=(), payment=(self "https://checkout.stripe.com"),
          fullscreen=(self)
        Cross-Origin-Opener-Policy: same-origin
        Cross-Origin-Resource-Policy: same-site
          (same-origin breaks Stripe.js postMessage; same-site
          is the correct posture and is documented.)

5. RATE LIMITING

   5.1. SCOPE — exactly four Server Actions:
        signup, login, forgot-password, reset-password.
        Webhook routes (Stripe, cron) are NOT rate-limited at
        the app layer — Stripe rate-limits its own webhook
        deliveries; cron is auth-gated.

   5.2. ALGORITHM — token bucket, not sliding window.
        Justify: token bucket allows a small burst (humans
        typo passwords; we want them to retry without rage-
        clicking the limiter into a wall), which sliding
        window punishes harshly.

        Per-IP bucket:
          signup:  capacity 5, refill 5/min
          login:   capacity 10, refill 10/min
          forgot:  capacity 5, refill 5/min
          reset:   capacity 5, refill 5/min

        Per-email bucket (login + forgot only; signup creates
        the email so it can't be keyed on it pre-create; reset
        is single-use token so per-email rate-limit is a no-op):
          login:   capacity 5, refill 5/15min
          forgot:  capacity 3, refill 3/15min

        Combined rule: a request consumes from BOTH buckets;
        either being empty rejects.

   5.3. STORAGE — auth_rate_limits Supabase table.
        Schema (Architect specifies; Builder writes migration):

        CREATE TABLE auth_rate_limits (
          bucket_key   TEXT PRIMARY KEY,  -- 'ip:1.2.3.4:login'
                                          -- or 'email:lower(addr):login'
          tokens       REAL NOT NULL,
          last_refill  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        Access: service-role only (lazy import pattern per
        CLAUDE.md). RLS: enabled, NO policies — service-role
        bypasses. No anon access path.

        Read-modify-write via SECURITY DEFINER function
        consume_rate_limit_token(p_bucket_key, p_capacity,
        p_refill_per_second) RETURNING boolean (true if
        consumed, false if rejected). The function:
        - INSERTs the row at full capacity if missing
        - Refills based on (now() - last_refill) * refill_rate,
          capped at capacity
        - Decrements by 1 if tokens >= 1, returns true
        - Returns false otherwise
        - Updates last_refill and updated_at in the SAME row.

        Janitor: a NEW partial cleanup is folded into the
        publish cron (it already runs janitor). Sweep rows
        where updated_at < now() - interval '1 day'. Name
        the helper: pruneStaleAuthRateLimits(client).

   5.4. IP RESOLUTION
        Read x-forwarded-for, take the LEFTMOST entry, validate
        as an IP (ipv4 or ipv6) — invalid → 'unknown' bucket
        which is shared (acceptable; an attacker who can spoof
        IPs to invalid values gets a tighter limit, not a looser
        one). NEVER trust x-real-ip in serverless (it's set by
        Vercel from x-forwarded-for; same data, looser parsing).

   5.5. RESPONSE ON LIMIT
        Same generic error envelope the auth Server Actions
        already return; user-facing copy in i18n: 'errors.rate_limit'.
        NEVER differentiate "wrong password rate limit" from
        "wrong email rate limit" — same enumeration leak
        rationale as ADR 0005 §12 generic 401.

        No Retry-After header (Server Actions don't return
        HTTP responses; the form re-renders with the error).

6. ERROR BOUNDARIES

   6.1. THREE FILES
        - app/global-error.tsx — single-locale English fallback;
          rendered when the root layout crashes (so locale segment
          may have failed). Wraps Sentry.captureException in
          useEffect. Minimal, accessible, recoverable (a single
          "Try again" button calling the reset prop).
        - app/[locale]/error.tsx — localised; same Sentry wiring;
          uses next-intl translations.
        - app/[locale]/not-found.tsx — localised; no Sentry capture
          (404 is not an error).

   6.2. DESIGN
        impeccable-design-and-taste skill drives the visual; the
        Architect names the requirement:
        - Tone matches the dashboard aesthetic, not a generic
          "uh oh" page
        - No emoji
        - No raw stack traces visible to the user
        - The Sentry event ID (event.eventId after captureException)
          IS displayed in muted text so support can correlate; copy:
          "Reference: {id}"

   6.3. WHAT IS NOT AN ERROR
        Redirects (NEXT_REDIRECT sentinel) and 404s pass through
        without Sentry capture (see §3.4 ignoreErrors). The
        not-found.tsx file exists so the framework has a
        localised UI to render; it does not log.

7. HEALTH CHECK

   7.1. /api/_health/route.ts (top-level, new)
        GET. HEALTHCHECK_TOKEN-gated via Authorization: Bearer,
        crypto.timingSafeEqual + length pre-check (copy the
        pattern from /api/_health/social/route.ts verbatim —
        do not deviate).

        Response (always 200, JSON):
        {
          ts: <ISO>,
          db: 'ok' | 'err',
          cron: {
            publish:      { lastSeen: <ISO|null>, stale: boolean },
            metricsSync:  { lastSeen: <ISO|null>, stale: boolean }
          },
          sentry: { dsnConfigured: boolean }
        }

        db check: `select 1` via service-role client; on throw
        within 2s, db = 'err'.
        lastSeen source: a new tiny table `cron_health` (Architect
        specifies schema; Builder writes migration):

        CREATE TABLE cron_health (
          cron_slug    TEXT PRIMARY KEY,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        Each cron orchestrator (publish, metrics) UPSERTs its
        own row at the START of the tick. Stale threshold:
        publish > 5 min, metrics > 2 h.

        Justify cron_health over "read last log line": logs
        are not queryable from a request handler. Vercel's
        log API exists but adding a dependency on it for a
        health check is the wrong direction.

   7.2. RELATIONSHIP TO SENTRY CRON MONITORS
        The two are independent and intentionally redundant.
        Sentry Cron Monitors fire if the cron stops checking in;
        /api/_health is a pull-based check used by Uptime
        Robot / status page tooling. The bus factor of
        Sentry-going-down is non-zero.

8. CONFIGURATION

   8.1. NEW ENV VARS — /lib/config.ts additions:

        | Var                       | Public/Server | Required in prod | Notes |
        |---|---|---|---|
        | SENTRY_DSN                | public        | No (degraded mode OK if absent) | If absent, init returns no-op; app still boots. |
        | SENTRY_ENVIRONMENT        | public        | No | Default: VERCEL_ENV. |
        | SENTRY_AUTH_TOKEN         | server        | Build-time only — NEVER read at runtime | Source-map upload. |
        | VERCEL_GIT_COMMIT_SHA     | public        | No (provided by Vercel) | Release tag. |
        | CSP_ENFORCE               | server        | No | Default false (Report-Only). Flip to true post-launch. |
        | AUTH_RATE_LIMIT_ENABLED   | server        | No | Default true. Escape hatch only. |

        NO new REQUIRED var. The full hardening posture degrades
        gracefully if Sentry's DSN is missing — useful for local
        dev and self-host distributions.

9. ACCEPTED TECH DEBT

   - Rate limiter is single-region Supabase-backed. Multi-region
     deploy is incompatible without a shared store; document
     Upstash migration as the path.
   - CSP launches in Report-Only mode for 7 days. The runbook
     names the 24h-quiet criterion for flipping CSP_ENFORCE=true.
   - email scrubbing keeps the domain. Justified above; revisit
     if domain becomes identifying for low-N tenants.
   - HSTS preload list submission is a manual step out-of-band.
   - 'unsafe-inline' on style-src is a documented Tailwind
     trade-off; tighten when Tailwind ships nonce support.

10. OUT OF SCOPE — bulleted, matching the session preamble
    "Defers" list verbatim.

11. OPEN FOLLOW-UPS

    - Restrict img-src https: → specific Supabase Storage origin
      once the brand-asset CDN host is known.
    - Submit domain to the HSTS preload list (post-launch, after
      48h with the header set).
    - Migrate rate limiter to Upstash if multi-region deploy
      lands or if login QPS makes the auth_rate_limits row hot.
    - SRI on third-party scripts other than js.stripe.com (none
      exist at launch; named here so future adds remember).
    - replaysOnErrorSampleRate > 0 when Sentry plan supports it
      / when masking config is verified for vault token UI.
    - Per-business Sentry tags (business_id, plan) — needs PII
      review; defer until clearly needed for triage.

DELIVERABLE 2 — /docs/launch-checklist.md SKELETON

Sections (exact headings):

1. Environment variables — table of every var in /lib/config.ts,
   with: name, where to get the value, present-in-Vercel
   verification command (`vercel env ls production | grep VAR`).
   Skeleton only — Builder fills the rows by reading config.ts.

2. Database
   - Migrations applied through latest (`npm run db:migrate:status`
     equivalent or manual `select max(version) from
     supabase_migrations`).
   - PITR enabled in Supabase dashboard (Pro plan).
   - RLS spot-check: every table in /docs/decisions/0001-database-schema.md
     §B has RLS enabled (paste the verification query).

3. Cron
   - vercel.json contains both /api/cron/publish and
     /api/cron/sync-metrics entries.
   - CRON_SECRET set in production env, ≥32 chars (config.ts
     enforces this at boot — verify boot does not error in the
     deploy log).
   - First production tick of each cron observed in Vercel logs
     (smoke test).

4. Sentry
   - DSN in production env.
   - SENTRY_AUTH_TOKEN in production BUILD env (Vercel
     dashboard → Settings → Environment Variables → Build).
   - First release tagged (visible in Sentry → Releases).
   - First error captured intentionally (a /api/_test-sentry
     route deleted before merge, or one-off via Sentry CLI).
   - Cron monitors visible in Sentry → Crons.

5. Security headers
   - `curl -sI https://{prod}/ | grep -i 'strict-transport'`
     and 4 sibling commands for each static header.
   - CSP Report-Only smoke test: load the dashboard, open
     browser devtools console, confirm no CSP violations.
   - CSP nonce smoke test: view-source on a Server-rendered
     page, confirm `nonce="..."` is present on Next.js's
     hydration scripts and the nonce is non-empty.
   - Schedule the CSP_ENFORCE flip (Day 7 reminder).

6. Stripe live-mode flip — explicit ORDERED steps:
   1) Create Products + Prices in live mode in Stripe dashboard.
   2) Set STRIPE_SECRET_KEY (sk_live_…) in production env.
   3) Set STRIPE_PUBLISHABLE_KEY (pk_live_…) in production env.
   4) Create webhook endpoint in live mode → STRIPE_WEBHOOK_SECRET.
   5) Copy live Price IDs into env (or wherever they live —
      verify against lib/stripe/products.ts).
   6) Deploy.
   7) Test charge with a real €1 product (refund immediately).

7. Auth and rate limit
   - SUPABASE_SERVICE_ROLE_KEY rotated within the last 90 days
     (paste rotation procedure).
   - First signup smoke: complete, lands on /onboarding.
   - Rate-limit smoke: `for i in $(seq 1 10); do curl ... signup; done`
     confirms a 429-equivalent on the 6th.

8. Dev-bypass header sweep
   - `grep -rn "X-Cron-Dev-Trigger" app/ lib/` — every match
     gated by NODE_ENV !== 'production'.
   - `grep -rn "process.env.NODE_ENV" app/ lib/` outside
     /lib/config.ts → manual audit; flagged in CLAUDE.md.

9. Legal and ops slots (NOT ENGINEERING — named here so they
   aren't forgotten)
   - Privacy policy live at /privacy
   - Terms of service live at /terms
   - DPA template available on request
   - Status page URL configured (slot only)
   - Abuse contact email live (slot only; abuse@{domain})
   - Support email live (slot only)

10. Rollback procedure
    - Vercel "Promote previous deployment" path.
    - Migration rollback policy: forward-only (per CLAUDE.md);
      data fixes via new migrations, never down().
    - CRON_SECRET rotation procedure (env update + redeploy;
      cron resumes on next tick).

12. ARCHITECT END

When you have written both files, do not output any further
content. Type exactly:

  ADR 0007 and launch-checklist skeleton written. No code
  authored. Builder may proceed in a fresh session.

Then /exit.
```

---

## Part B — Builder Session (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer
4. claude-mem injects previous session context — review before Prompt B1
5. Run prompts B1 through B8 **in order** — do NOT `/clear` between them
6. The `impeccable-design-and-taste` skill auto-activates on Prompt B7 (error pages); confirm it engaged by checking the response intro
7. At the end, run the final verification block and report back

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.

Read /docs/decisions/0007-launch-hardening.md in full — it
is the spec for this session. Sections of particular density:
§3.3 (scrubber), §4.3 (CSP allow-list), §5.3 (rate-limit RPC),
§6.1–6.2 (error boundaries — note the multi-locale inline map
on global-error.tsx).

Read /docs/launch-checklist.md skeleton — you fill it in
during Prompt B8.

Read /docs/decisions/0002-social-provider.md §3 and
/lib/social/errors.ts — your B1 scrubber refactor replaces the
existing recursive redaction regex without changing its
externally observable behaviour on existing tests.

Read /middleware.ts — your B3 nonce + CSP injection slots in
after the existing x-pathname step. Preserve the existing
ordering (auth → i18n → x-pathname → NEW).

Read /lib/config.ts — your env-var additions follow the
existing public/server split. NEVER read process.env outside
this file (one documented exception: SENTRY_AUTH_TOKEN in
next.config.ts, build-time only — see ADR 0007 §3.2).

Read /lib/publishing/orchestrator.ts and
/lib/metrics/orchestrator.ts — your B2 Sentry.withMonitor wrap
goes INSIDE the existing try block; your B6 cron_health UPSERT
goes at the START of each tick.

Read /app/[locale]/(auth)/{signup,login,forgot-password,reset-password}/
actions.ts — your B5 rate-limit calls slot in after auth
checks, before any DB work.

Read /app/api/_health/social/route.ts — your B6 /api/_health
route copies its auth pattern verbatim (safeCompare, length
pre-check, identical 404 posture).

Do NOT modify ADR 0005 or 0006 cron route contracts. The
always-200 posture and the auth pattern are settled. The
Sentry wrap is purely additive INSIDE the orchestrator try
block; the route handler does not change.

Implementation order (locked, per ADR 0007 §12):
B1 scrubber → B2 Sentry init → B3 CSP+headers+middleware →
B4 rate-limit table+helper → B5 rate-limit Server Action wiring
→ B6 cron_health + /api/_health + Sentry cron monitors →
B7 error boundaries → B8 launch-checklist fill-in.

Rationale: the scrubber lands before any event can fire (B1
before B2). The rate limiter helper is testable in isolation
(B4) before the Server Actions consume it (B5). cron_health
and the /api/_health endpoint ship with the Sentry cron-monitor
wrap (B6) so both observability paths land together.
```

### Prompt B1 — Scrubber + SocialProviderError refactor

```
/everything-claude-code:tdd "Sentry scrubber single source of
truth and SocialProviderError redactor refactor"

Create /lib/observability/sentry-scrub.ts.

Exports (per ADR 0007 §3.3):

  export const REDACTED_KEYS: ReadonlySet<string>
  export function normaliseKey(key: string): string
  export function scrubEvent<E extends { request?: any; breadcrumbs?: any[]; user?: any; contexts?: any; tags?: any; extra?: any }>(event: E): E | null
  export function scrubString(value: string): string
  export function isEmailLike(value: string): boolean

REDACTED_KEYS (lowercase, post-normalisation — strip every
non-alphanumeric character, lowercase the result):

  accesstoken, refreshtoken,
  vaultaccesstokenid, vaultrefreshtokenid,
  stripesecretkey, stripewebhooksecret,
  cronsecret, oauthstatesecret, healthchecktoken,
  sentryauthtoken, sentrydsn,
  authorization, cookie, setcookie,
  password, passwordconfirmation, newpassword,
  token, secret, apikey

normaliseKey: lowercase, then replace /[^a-z0-9]/g with ''.
Matching is normaliseKey(input) ∈ REDACTED_KEYS.

scrubEvent contract (per ADR 0007 §3.3 and §3.6):
  1. Route-path exclusion — if event.request?.url is a string
     and its pathname matches /^\/api\/stripe\/webhook$/ or
     starts with /^\/api\/cron\//, return null (drop the event).
  2. URL-query scrubbing — on event.request.url and on every
     breadcrumb.data.url / breadcrumb.data.to whose breadcrumb
     category is 'navigation' or 'fetch', apply
     /([?&](?:token|code|state)=)[^&#]+/gi → '$1[Filtered]'.
  3. Recursive key-redaction — walk event.request.headers,
     event.request.data, event.extra, event.contexts, event.tags,
     event.user, and breadcrumb.data; replace any value whose
     KEY normalises to a REDACTED_KEYS member with '[Filtered]'.
  4. Email-leaf scrubbing — for every string leaf in event.user,
     event.contexts, event.tags, event.extra, and breadcrumb.data,
     if isEmailLike(value), redact local part:
     'user@example.com' → 'u***@example.com'
     (first char + '***' + '@' + domain).

scrubString applies steps 2 + 4 to a free-string input — exposed
so SocialProviderError.toJSON() (open follow-up in ADR 0002) can
reuse it without depending on Sentry's Event type.

isEmailLike: /^[^@\s]+@[^@\s]+\.[^@\s]+$/

Tests in /lib/observability/sentry-scrub.test.ts:
  - REDACTED_KEYS hits Access-Token, accessToken, access_token,
    ACCESS.TOKEN (every case-and-separator permutation)
  - Nested object: { meta: { access_token: 'abc' } } → meta.access_token = '[Filtered]'
  - URL scrub: 'https://x.com/cb?code=AAA&state=BBB&keep=1'
    → 'https://x.com/cb?code=[Filtered]&state=[Filtered]&keep=1'
  - Route-path exclusion: event with url '/api/stripe/webhook'
    → scrubEvent returns null
  - Route-path exclusion: '/api/cron/publish' → null
  - Route-path exclusion: '/api/cron/sync-metrics' → null
  - Route-path miss: '/api/stripe/webhooks' (note 's') → NOT dropped
  - Email scrub: 'user@example.com' → 'u***@example.com'
  - Email scrub: 'a@b.co' → 'a***@b.co'
  - Email leaves domain visible
  - Catch-all 'token' hits MY_AUTH_TOKEN_VALUE; explicit
    'access_token' still hits its specific entry
  - Breadcrumb URL scrubbed when category === 'fetch'
  - Breadcrumb without category not scrubbed
  - Non-event input shapes (missing request, missing user)
    return unmodified copies

Then refactor /lib/social/errors.ts:
  - The existing recursive-redaction helper (currently uses
    a local regex /token|secret|authorization|cookie/i)
    imports { REDACTED_KEYS, normaliseKey } from
    '@/lib/observability/sentry-scrub' and uses the shared
    matcher instead.
  - Behaviour on EXISTING tests must remain identical or
    stricter — net effect: more keys redacted, none unredacted
    that were previously redacted.
  - Confirm by running:
      npx vitest run lib/social/errors lib/observability
    All previously-passing tests must still pass.

Run:
  npx vitest run lib/observability lib/social
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B2 — Sentry SDK install and init

```
/everything-claude-code:tdd "Sentry SDK install, init files,
instrumentation.ts entrypoint, withSentryConfig source maps"

Step 1: install @sentry/nextjs.

  npm install @sentry/nextjs@latest --save

Verify package.json picks up a 8.x or 9.x version (Next.js 16
compatible). Do NOT run `npx @sentry/wizard` — we configure
manually per ADR 0007 §3.1.

Step 2: add env vars to /lib/config.ts. Follow existing
public/server split (ADR 0007 §8.1):

  config.public:
    SENTRY_DSN              optional string
    SENTRY_ENVIRONMENT      optional string, default at parse
                            time to process.env.VERCEL_ENV ?? 'development'
    VERCEL_GIT_COMMIT_SHA   optional string

  config.server:
    SENTRY_ORG              optional string
    SENTRY_PROJECT          optional string
    CSP_ENFORCE             optional boolean, default false
    AUTH_RATE_LIMIT_ENABLED optional boolean, default true

  SENTRY_AUTH_TOKEN is INTENTIONALLY NOT in config — read
  directly from process.env in next.config.ts only.

Update .env.local.example with placeholders + comments.

Step 3: create three init files at REPO ROOT (Next.js 16
convention):

  /sentry.client.config.ts
  /sentry.server.config.ts
  /sentry.edge.config.ts

Each calls Sentry.init with the shape in ADR 0007 §3.1:

  import * as Sentry from '@sentry/nextjs'
  import { config } from '@/lib/config'
  import { scrubEvent } from '@/lib/observability/sentry-scrub'
  import { IGNORE_ERRORS } from '@/lib/observability/sentry-ignore'

  Sentry.init({
    dsn: config.public.SENTRY_DSN,
    environment: config.public.SENTRY_ENVIRONMENT,
    release: config.public.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.05,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    ignoreErrors: IGNORE_ERRORS,
    sendDefaultPii: false,
  })

If SENTRY_DSN is empty/undefined, Sentry.init is a no-op by
design — do NOT add an `if (dsn)` guard; the SDK handles it.

Step 4: create /lib/observability/sentry-ignore.ts:

  export const IGNORE_ERRORS = [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured with value: <anonymous>',
    'fb_xd_fragment',
    'NEXT_REDIRECT',
    'NEXT_HTTP_ERROR_FALLBACK;404',
  ]

Step 5: create /instrumentation.ts at repo root (Next.js 16
entrypoint per ADR 0007 §3.1):

  export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }
    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  }

  export { captureRequestError as onRequestError } from '@sentry/nextjs'

This is the one place outside /lib/config.ts that reads
process.env directly — documented exception (Next.js
runtime-detection convention; not a config value).

Step 6: wrap next.config.ts with withSentryConfig. Read
process.env.SENTRY_AUTH_TOKEN directly (build-time only,
per ADR 0007 §3.2):

  import { withSentryConfig } from '@sentry/nextjs'
  import { config } from '@/lib/config'

  const nextConfig = { /* existing config */ }

  export default withSentryConfig(nextConfig, {
    org: config.server.SENTRY_ORG,
    project: config.server.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    widenClientFileUpload: true,
    hideSourceMaps: true,
    disableLogger: true,
    silent: !process.env.CI,
  })

Step 7: add user context (ADR 0007 §3.3 setUser paragraph).
In /app/[locale]/(dashboard)/layout.tsx, after the existing
getUser() resolution and BEFORE child rendering:

  import * as Sentry from '@sentry/nextjs'
  // ...
  Sentry.setUser({ id: user.id })

id only. No email. No display name.

Tests in /lib/observability/sentry-ignore.test.ts:
  - IGNORE_ERRORS contains 'NEXT_REDIRECT'
  - IGNORE_ERRORS contains 'NEXT_HTTP_ERROR_FALLBACK;404'
  - Array length is 6 (regression guard against silent additions)

Run:
  npx vitest run lib/observability
  npx tsc --noEmit --skipLibCheck

Verify build does not break:
  npm run build 2>&1 | tail -50
  (Pre-existing ECC failure is acceptable per CLAUDE.md;
  no NEW errors should appear from Sentry wiring.)

/everything-claude-code:verify
```

### Prompt B3 — CSP, security headers, middleware, Vercel Speed Insights/Analytics

```
/everything-claude-code:tdd "CSP builder, static security headers,
middleware nonce injection, Vercel Speed Insights and Analytics"

Step 1: install Vercel Speed Insights and Analytics (in-scope
per ADR 0007 §2 update A1):

  npm install @vercel/speed-insights @vercel/analytics

Mount in /app/[locale]/layout.tsx (Server Component) as the
last children of <body>, before the closing tag:

  import { SpeedInsights } from '@vercel/speed-insights/next'
  import { Analytics } from '@vercel/analytics/next'
  // ...
  <SpeedInsights />
  <Analytics />

No DSN, no config. Defaults only.

Step 2: create /lib/observability/csp.ts. Pure function — no
side effects, no env reads (env reads happen in middleware).

  export function buildCsp(nonce: string, reportUri: string | null, enforce: boolean): { headerName: string; headerValue: string }

headerName is 'Content-Security-Policy' when enforce === true,
'Content-Security-Policy-Report-Only' when false.

headerValue is the directives in ADR 0007 §4.3 verbatim, with
`'nonce-{nonce}'` substituted and the report-uri directive
included only when reportUri is non-null.

Build the policy as a single line with semicolon separators.

Directives in order (exact spelling, copy from ADR §4.3 — do
NOT improvise):

  default-src 'self';
  script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' https://js.stripe.com https://va.vercel-scripts.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com https://vitals.vercel-insights.com {POSTIZ_HOST};
  frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com;
  frame-ancestors 'none';
  form-action 'self' https://checkout.stripe.com;
  base-uri 'self';
  object-src 'none';
  upgrade-insecure-requests;
  report-uri {reportUri}

{POSTIZ_HOST} is the host portion of config.server.POSTIZ_BASE_URL.
If POSTIZ_BASE_URL is unset, omit the entry (do NOT emit an
empty allow). buildCsp takes the host as a parameter — the
caller (middleware) extracts it.

Step 3: create /lib/observability/sentry-csp-report-uri.ts:

  export function deriveSentryCspReportUri(dsn: string | undefined): string | null

Parses the DSN format
https://{publicKey}@{host}/{projectId} and returns
https://{host}/api/{projectId}/security/?sentry_key={publicKey}.
Returns null if dsn is empty or malformed.

Step 4: create /lib/observability/security-headers.ts.

  export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options',    value: 'nosniff' },
    { key: 'X-Frame-Options',           value: 'DENY' },
    { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(self "https://checkout.stripe.com"), fullscreen=(self)' },
    { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  ]

CRITICAL: HSTS value does NOT include `preload` (per ADR 0007
§4.4 D1 update). The `preload` directive is deliberately
omitted. Do not "fix" this — see ADR 0007 §9 tech debt.

Step 5: register STATIC_SECURITY_HEADERS in next.config.ts via
the headers() async function:

  async headers() {
    return [{
      source: '/:path*',
      headers: STATIC_SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
    }]
  }

Step 6: update /middleware.ts. Preserve existing ordering
(auth → i18n → x-pathname). Append the new nonce + CSP step.

CRITICAL: setting a header on the INCOMING request so Server
Components can read it via headers().get('x-nonce') requires
the NextResponse.next({ request: { headers: requestHeaders } })
pattern. The existing middleware already uses NextResponse.next
for x-pathname — extend the same requestHeaders bag.

  import { buildCsp } from '@/lib/observability/csp'
  import { STATIC_SECURITY_HEADERS } from '@/lib/observability/security-headers'
  import { deriveSentryCspReportUri } from '@/lib/observability/sentry-csp-report-uri'
  import { config } from '@/lib/config'

  // ... after x-pathname injection, before returning the response:

  const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = Buffer.from(nonceBytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  // Length: 22 chars after replacement.

  requestHeaders.set('x-nonce', nonce)

  const postizHost = (() => {
    try { return new URL(config.server.POSTIZ_BASE_URL).host } catch { return undefined }
  })()
  const reportUri = deriveSentryCspReportUri(config.public.SENTRY_DSN)
  const { headerName, headerValue } = buildCsp(
    nonce,
    reportUri,
    config.server.CSP_ENFORCE,
    postizHost
  )

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(headerName, headerValue)
  return response

NOTE: STATIC_SECURITY_HEADERS are applied via next.config
headers() (Step 5); middleware does NOT re-set them. The CSP
is the only header middleware writes.

NOTE: do not generate a nonce if an earlier middleware step
(auth redirect, i18n redirect) has already short-circuited
with a redirect — those returns happen BEFORE this block.

Step 7: Server Components that emit inline scripts read the
nonce via:

  import { headers } from 'next/headers'
  const nonce = (await headers()).get('x-nonce') ?? undefined
  // pass to <script nonce={nonce}> or <Script nonce={nonce}>

Next.js's hydration scripts pick up the nonce automatically
when it is on the request header AND propagated via the
NextResponse.next({request:{headers}}) pattern.

Tests in /lib/observability/csp.test.ts:
  - buildCsp(nonce, uri, true)  → headerName 'Content-Security-Policy'
  - buildCsp(nonce, uri, false) → headerName 'Content-Security-Policy-Report-Only'
  - script-src contains exactly: 'self', 'nonce-{nonce}',
    'strict-dynamic', https://js.stripe.com,
    https://va.vercel-scripts.com — no more, no less
  - connect-src contains the seven required Vercel/Supabase/
    Stripe/Sentry entries
  - connect-src includes {POSTIZ_HOST} when provided
  - connect-src OMITS the Postiz entry when host param undefined
  - report-uri directive present when reportUri non-null;
    absent when null
  - No 'unsafe-eval' anywhere in headerValue
  - No 'unsafe-inline' in script-src (regex assertion)
  - upgrade-insecure-requests present

Tests in /lib/observability/sentry-csp-report-uri.test.ts:
  - Valid DSN → expected URL shape
  - Empty/undefined DSN → null
  - Malformed DSN ('not-a-url') → null

Tests in /lib/observability/security-headers.test.ts:
  - HSTS value EXACTLY 'max-age=63072000; includeSubDomains'
    (regression guard against `preload` re-introduction)
  - All seven headers present

Run:
  npx vitest run lib/observability
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B4 — Rate limit table, RPC, helper

```
/everything-claude-code:tdd "auth_rate_limits table, consume_rate_limit_token RPC, lib/auth/rate-limit.ts helper"

Step 1: migration. Pick the next sequential migration filename
in supabase/migrations/ (read the directory; do NOT guess the
number).

  CREATE TABLE auth_rate_limits (
    bucket_key   TEXT PRIMARY KEY,
    tokens       NUMERIC(10, 4) NOT NULL,
    last_refill  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
  -- No policies; service-role bypasses.

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
    SELECT * INTO v_row FROM auth_rate_limits
      WHERE bucket_key = p_bucket_key FOR UPDATE;

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

CRITICAL: tokens column is NUMERIC(10,4), NOT REAL — per ADR
0007 §5.3 (drift correction). The RPC signature uses numeric.

Step 2: create /lib/auth/rate-limit.ts.

  type AuthAction = 'signup' | 'login' | 'forgot-password' | 'reset-password'

  export const RATE_LIMITS: Record<AuthAction, { ip: { capacity: number; refillPerSecond: number }; email?: { capacity: number; refillPerSecond: number } }> = {
    'signup':         { ip: { capacity: 5,  refillPerSecond: 5 / 60 } },
    'login':          { ip: { capacity: 10, refillPerSecond: 10 / 60 }, email: { capacity: 5, refillPerSecond: 5 / (15 * 60) } },
    'forgot-password':{ ip: { capacity: 5,  refillPerSecond: 5 / 60 }, email: { capacity: 3, refillPerSecond: 3 / (15 * 60) } },
    'reset-password': { ip: { capacity: 5,  refillPerSecond: 5 / 60 } },
  }

  export function resolveIp(headers: Headers): string
  export function isValidIp(value: string): boolean
  export async function consumeRateLimit(action: AuthAction, ip: string, email?: string): Promise<boolean>

resolveIp:
  - read header 'x-forwarded-for'
  - take the LEFTMOST entry (split on comma, trim)
  - if isValidIp returns true → return that entry
  - else → return 'unknown'
  - NEVER read x-real-ip (per ADR 0007 §5.4)

isValidIp: accept syntactic IPv4 (regex) or IPv6 (use net.isIP
from 'node:net' if available, else a strict regex).

consumeRateLimit (per ADR 0007 §5.2 E4 update — both buckets
consumed sequentially, no rollback on per-email failure):

  if (config.server.AUTH_RATE_LIMIT_ENABLED === false) return true

  const cfg = RATE_LIMITS[action]
  const client = await import('@/lib/supabase/service').then(m => m.getServiceClient())

  // Per-IP first.
  const ipKey = `ip:${ip}:${action}`
  const ipOk = await rpcConsume(client, ipKey, cfg.ip.capacity, cfg.ip.refillPerSecond)
  if (!ipOk) return false

  // Per-email second, only if configured for this action AND email provided.
  if (cfg.email && email) {
    const emailKey = `email:${email.toLowerCase().trim()}:${action}`
    const emailOk = await rpcConsume(client, emailKey, cfg.email.capacity, cfg.email.refillPerSecond)
    if (!emailOk) return false
    // NB: per ADR 0007 §5.2 update E4 — per-IP token already spent,
    // intentionally NOT refunded. Marginal defender advantage.
  }

  return true

rpcConsume is a thin wrapper:
  client.rpc('consume_rate_limit_token', {
    p_bucket_key: key,
    p_capacity: capacity,
    p_refill_per_second: refillPerSecond,
  }) → .data: boolean

Step 3: create /lib/db/auth-rate-limits.ts with
pruneStaleAuthRateLimits(client) (per ADR 0007 §5.3 janitor):

  export async function pruneStaleAuthRateLimits(client: ServiceRoleClient): Promise<number> {
    const { count } = await client
      .from('auth_rate_limits')
      .delete({ count: 'exact' })
      .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    return count ?? 0
  }

Step 4: wire pruneStaleAuthRateLimits into the publish-cron
Phase A.1 janitor in /lib/publishing/orchestrator.ts —
runJanitorTick. Add ONE line that calls it; add the count to
the JanitorTickSummary (new field: authRateLimitsPruned). Do
not change the existing janitor's other behaviour.

Step 5: i18n. Add to all three locale files (/i18n/en|pt|es/auth.json):
  "errors": { "rate_limit": "Too many attempts. Please wait a moment and try again." }
  (PT/ES — translate naturally. Match the existing tone of
  errors in the same file.)

Tests in /lib/auth/rate-limit.test.ts (use a test-DB or a
Supabase mock — match the existing pattern in lib/db tests):
  - First call to a fresh bucket returns true (tokens -1)
  - Capacity-th call returns true; capacity+1-th returns false
  - After refill window passes, call returns true again
  - Per-IP fails → per-email NOT consulted (assert RPC called once)
  - Per-IP succeeds + per-email fails → returns false; per-IP
    token IS consumed (assert two RPC calls, neither refunded)
  - resolveIp('x-forwarded-for: 1.2.3.4, 5.6.7.8') → '1.2.3.4'
  - resolveIp(missing header) → 'unknown'
  - resolveIp(malformed entry) → 'unknown'
  - isValidIp covers IPv4 + IPv6 + rejection cases
  - AUTH_RATE_LIMIT_ENABLED=false → consume returns true,
    no RPC call

Tests in /lib/db/auth-rate-limits.test.ts:
  - Inserts 3 rows, sets updated_at to 25h ago for 2 of them,
    prune returns 2

Run:
  npm run db:migrate
  npx vitest run lib/auth lib/db/auth-rate-limits
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B5 — Rate-limit Server Action wiring

```
/everything-claude-code:tdd "Integrate consumeRateLimit into
the four auth Server Actions"

Files:
  /app/[locale]/(auth)/signup/actions.ts
  /app/[locale]/(auth)/login/actions.ts
  /app/[locale]/(auth)/forgot-password/actions.ts
  /app/[locale]/(auth)/reset-password/actions.ts

In each, BEFORE any Supabase auth call or DB work, AFTER the
existing input validation (Zod parse):

  import { headers } from 'next/headers'
  import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'

  const ip = resolveIp(await headers())
  const email = /* parsed email from validated input, or undefined */
  const allowed = await consumeRateLimit('<action>', ip, email)
  if (!allowed) {
    return { errors: { _form: 'errors.rate_limit' } }   // shape MUST match each action's existing error envelope
  }

Action-to-email mapping (per ADR 0007 §5.2):
  signup           → email passed (per-IP only fires; per-email config absent — no-op for email branch)
  login            → email passed
  forgot-password  → email passed
  reset-password   → email NOT passed (per ADR §5.2 — single-use token, per-email is no-op)

CRITICAL: each action has its own state shape (Step1State vs
Step2State pattern from Session 4). Use the existing error
envelope; do NOT introduce a new return type. The i18n key
'errors.rate_limit' is rendered identically to any other
top-level form error (the existing Form components already
handle the _form error key — confirm by reading Step1Form /
LoginForm).

Tests — extend each action's existing test file:
  - When consumeRateLimit returns false, the action returns
    its existing error-envelope shape with _form: 'errors.rate_limit'
  - The action does NOT call Supabase auth when rate-limited
    (assert via mock)
  - When consumeRateLimit returns true, behaviour is unchanged

Reviewer audit hook: the four actions share the same pattern.
Inconsistency between them is a red flag. The login action has
ONE additional concern — the email may not be lower-cased yet
in the user's input; consumeRateLimit lower-cases the bucket
key internally, so passing the raw input is correct.

Run:
  npx vitest run app/[locale]/\(auth\)
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B6 — cron_health, /api/_health route, Sentry cron monitors

```
/everything-claude-code:tdd "cron_health table, orchestrator
UPSERTs at tick start, /api/_health route, Sentry.withMonitor
wraps on the two orchestrators"

Step 1: migration. Next sequential filename in
supabase/migrations/.

  CREATE TABLE cron_health (
    cron_slug    TEXT PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE cron_health ENABLE ROW LEVEL SECURITY;
  -- No policies; service-role only.

Step 2: /lib/db/cron-health.ts:

  export async function markCronSeen(client: ServiceRoleClient, slug: string): Promise<void> {
    await client.from('cron_health').upsert(
      { cron_slug: slug, last_seen_at: new Date().toISOString() },
      { onConflict: 'cron_slug' }
    )
  }

  export async function getCronLastSeen(client: ServiceRoleClient, slug: string): Promise<string | null> {
    const { data } = await client.from('cron_health')
      .select('last_seen_at').eq('cron_slug', slug).maybeSingle()
    return data?.last_seen_at ?? null
  }

Step 3: in /lib/publishing/orchestrator.ts — at the START of
runPublishTick (FIRST thing inside the function body, before
any other work):

  await markCronSeen(client, 'publish')

Same for /lib/metrics/orchestrator.ts runMetricsSyncTick:

  await markCronSeen(client, 'metrics-sync')

The UPSERT runs once per tick; if it throws, the tick aborts
(and Sentry captures via §3.5 wrap — see Step 4).

Step 4: wrap each orchestrator's tick body with
Sentry.withMonitor (per ADR 0007 §3.5). The wrap goes INSIDE
the existing try block, AROUND the existing tick body:

  // /lib/publishing/orchestrator.ts
  export async function runPublishTick(opts: ...): Promise<PublishTickSummary> {
    const startedAt = new Date()
    let summary: PublishTickSummary = { /* zero values */ }
    try {
      await Sentry.withMonitor(
        'publish-tick',
        async () => {
          // EXISTING tick body — markCronSeen + claim + iterate + transition
        },
        {
          schedule: { type: 'crontab', value: '* * * * *' },
          checkinMargin: 2,
          maxRuntime: 1,
          failureIssueThreshold: 3,
          recoveryThreshold: 1,
        }
      )
    } catch (err) {
      // EXISTING swallow-and-log
    }
    return summary
  }

Same for metrics:
  slug: 'metrics-sync-tick'
  schedule: { type: 'crontab', value: '0 * * * *' }
  checkinMargin: 5
  maxRuntime: 1
  failureIssueThreshold: 3
  recoveryThreshold: 1

CRITICAL — DO NOT MODIFY:
  - The route handlers in /app/api/cron/publish/route.ts and
    /app/api/cron/sync-metrics/route.ts. Their always-200
    contract (ADR 0005 §12, 0006 §9) is settled. The Sentry
    wrap is purely additive INSIDE the orchestrator.
  - The orchestrator's existing try/catch and structured log
    line. Sentry is purely additive — both observability paths
    coexist.

Step 5: /app/api/_health/route.ts. Copy the auth pattern from
/app/api/_health/social/route.ts verbatim (safeCompare helper,
length pre-check, identical 404 posture, dev short-circuit via
config.public.NODE_ENV === 'development').

Response shape per ADR 0007 §7.1:

  {
    ts: <ISO>,
    db: 'ok' | 'err',
    cron: {
      publish:      { lastSeen: string | null, stale: boolean },
      metricsSync:  { lastSeen: string | null, stale: boolean }
    },
    sentry: { dsnConfigured: boolean }
  }

  - db: run `client.from('cron_health').select('cron_slug').limit(1)`
    inside a Promise.race against a 2s timeout. On throw OR
    timeout, db = 'err' (still return 200; consumer reads JSON).
  - lastSeen: getCronLastSeen for each slug
  - stale: publish > 5 min ago, metrics > 2 h ago
  - sentry.dsnConfigured: Boolean(config.public.SENTRY_DSN)

Always 200. Even on db: 'err'. Even on cron_health empty
(first deploy lastSeen is null; stale is true; that is correct
behaviour, not a bug).

Tests in /app/api/_health/__tests__/route.test.ts:
  - No Authorization header → 404 (NOT 401 — match the social
    health route posture)
  - Wrong token → 404
  - Correct token + healthy state → 200 with all four keys
  - Correct token + empty cron_health → 200, lastSeen: null,
    stale: true
  - Correct token + db throws → 200, db: 'err'

Tests in /lib/db/cron-health.test.ts:
  - markCronSeen inserts if missing, updates if present
  - getCronLastSeen returns null when row absent

Tests in /lib/publishing/orchestrator.test.ts and
/lib/metrics/orchestrator.test.ts — extend existing:
  - markCronSeen is called on EVERY tick, BEFORE any other DB
    op (verify via mock call order)
  - Sentry.withMonitor wraps the body (verify via mock)
  - Wrap arguments match the ADR §3.5 spec exactly (slug,
    schedule, checkinMargin, maxRuntime, failureIssueThreshold,
    recoveryThreshold)

Run:
  npm run db:migrate
  npx vitest run lib/publishing lib/metrics lib/db/cron-health app/api/_health
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B7 — Error boundaries (impeccable-design-and-taste skill)

```
/everything-claude-code:tdd "Three error boundary files —
global-error.tsx with inline locale map, [locale]/error.tsx
with next-intl, [locale]/not-found.tsx; design via
impeccable-design-and-taste skill"

The impeccable-design-and-taste skill should auto-activate on
this prompt. Confirm in your response preamble that it engaged;
if it did not, stop and ask the user.

Per ADR 0007 §6 — three files, three different runtime
postures.

File 1: /app/global-error.tsx (Client Component — Next.js
requires this). Falls back when the root layout itself dies.
Per ADR 0007 §6.1 (B update) — MULTI-LOCALE via inline map,
NOT next-intl (next-intl may have crashed).

  'use client'
  import { useEffect } from 'react'
  import * as Sentry from '@sentry/nextjs'

  const GLOBAL_ERROR_COPY = {
    en: { title: 'Something went wrong', body: '...', retry: 'Try again', home: 'Go home', reference: 'Reference' },
    pt: { title: 'Algo correu mal',       body: '...', retry: 'Tentar novamente', home: 'Ir para o início', reference: 'Referência' },
    es: { title: 'Algo salió mal',        body: '...', retry: 'Intentar de nuevo', home: 'Ir al inicio',  reference: 'Referencia' },
  } as const

  type Locale = keyof typeof GLOBAL_ERROR_COPY

  function detectLocale(): Locale {
    if (typeof window === 'undefined') return 'en'
    const segment = window.location.pathname.split('/')[1]
    return segment in GLOBAL_ERROR_COPY ? segment as Locale : 'en'
  }

  export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const locale = detectLocale()
    const copy = GLOBAL_ERROR_COPY[locale]
    const [eventId, setEventId] = useState<string | undefined>()

    useEffect(() => {
      const id = Sentry.captureException(error)
      setEventId(id)
    }, [error])

    return (
      <html lang={locale}>
        <body>
          {/* impeccable-design-and-taste skill renders the actual layout */}
          {/* requirements: no emoji, no stack trace, Reference: {id} in muted */}
        </body>
      </html>
    )
  }

File 2: /app/[locale]/error.tsx (Client Component). Localised
via next-intl (the locale segment is alive by definition if
this file renders).

  'use client'
  import { useEffect, useState } from 'react'
  import { useTranslations } from 'next-intl'
  import * as Sentry from '@sentry/nextjs'

  export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const t = useTranslations('errors.locale_error')
    const [eventId, setEventId] = useState<string | undefined>()
    useEffect(() => {
      setEventId(Sentry.captureException(error))
    }, [error])
    // impeccable-design-and-taste skill renders the layout
  }

Add to /i18n/en|pt|es/errors.json (create namespace if absent):
  "locale_error": {
    "title": "...",
    "body": "...",
    "retry": "Try again",
    "home": "Go home",
    "reference": "Reference"
  }

File 3: /app/[locale]/not-found.tsx (Server Component).
Localised. NO Sentry capture (404 is not an error per ADR
0007 §6.3).

  import { getTranslations } from 'next-intl/server'

  export default async function LocaleNotFound() {
    const t = await getTranslations('errors.not_found')
    // impeccable-design-and-taste skill renders the layout
  }

Add to /i18n/en|pt|es/errors.json:
  "not_found": {
    "title": "...",
    "body": "...",
    "home": "Go home"
  }

Design requirements (impeccable-design-and-taste skill enforces;
named here for explicit acknowledgement):
  - Tone matches the dashboard aesthetic — same typography,
    same spacing scale, same colour palette.
  - NO emoji.
  - NO raw stack traces ever visible to the user.
  - On global-error and locale-error: 'Reference: {eventId}'
    in muted text (small, low contrast — for support
    correlation, not for the user to act on).
  - Primary action: 'Try again' (reset). Secondary action:
    link to '/' or '/{locale}'.
  - On not-found: no Reference (no Sentry event), one action:
    'Go home'.

Tests in app/__tests__/global-error.test.tsx and
app/[locale]/__tests__/error.test.tsx:
  - global-error renders without crashing when given a fake
    Error
  - global-error detects locale 'pt' when window.location is
    /pt/something
  - global-error falls back to 'en' for unknown segment
  - locale-error wraps Sentry.captureException once on mount
    (verify via mock)
  - not-found does NOT call Sentry.captureException (negative
    assertion)

Run:
  npx vitest run app
  npx tsc --noEmit --skipLibCheck
  npm run dev   # smoke: visit /en/__definitely_not_a_route__
                # verify locale not-found renders, no Sentry event

/everything-claude-code:verify
```

### Prompt B8 — Launch checklist fill-in

```
/everything-claude-code:tdd "Launch checklist concrete rows"

Open /docs/launch-checklist.md. The Architect left the env-var
table with `<fill>` placeholders and the rest of the sections
as skeleton bullets.

For section 1 (Environment variables) ONLY: read /lib/config.ts.
Every key in `config.public` and `config.server` that is
present in the schema must appear as a row in the table. For
each row, the `<fill>` cells become the exact verification
command:

  ☐ `vercel env ls production | grep -q '^{VAR_NAME}' && echo present || echo MISSING`

Rows whose value is well-known (e.g. NEXT_PUBLIC_APP_URL is
the production domain) get a concrete `Where to get the value`
update; sensitive ones (auth tokens, keys) keep the existing
text. Do NOT add rows that are not in config.ts; do NOT delete
rows that are in config.ts but unused (that's a separate
audit).

For sections 2–10: the skeleton bullets stand. Where a row
references "see ADR 0007 §X.Y", verify the cross-reference
points at the right section in the now-revised ADR.

Update section 4 (Sentry) — confirm the circuit-breaker
checkbox is present (per ADR 0007 §3.7 / Architect update C2).
If absent, add it.

Update section 5 (Security headers) — confirm the HSTS
verification command expects the value WITHOUT `preload` (per
the D update). If it still says "verify preload", correct it.

Update section 5 (Speed Insights and Analytics smoke tests)
— add per Architect update A3 if not present.

Add to section 8 (Dev-bypass header sweep) a check for the
new Sentry route-path exclusion (ADR 0007 §3.3 update E5):

  ☐ Verify scrubEvent route-path exclusion is exercised — a
    synthetic Sentry event with request.url '/api/stripe/webhook'
    is dropped (unit test must exist; no production call needed).

Do NOT touch sections 9 (legal) or 10 (rollback) — those are
correct as the Architect wrote them.

Run:
  # No tests; this is a docs prompt.
  # Verify the file is well-formed Markdown:
  npx markdownlint docs/launch-checklist.md || true

/everything-claude-code:verify
```

### Final verification

```
After B8 completes, run the full verification block:

  npm run db:migrate                                  # all new migrations applied
  npx tsc --noEmit --skipLibCheck                     # clean
  npx vitest run lib/observability lib/auth lib/db    # green
  npx vitest run lib/publishing lib/metrics           # green (no orchestrator regressions)
  npx vitest run lib/social                           # green (errors.ts refactor)
  npx vitest run app                                  # green (error boundaries, /api/_health)
  npx vitest run                                      # full suite (scope-aware per CLAUDE.md)

Update /docs/current-phase.md — add a "Session 13B complete"
line under "What's done", listing the surfaces shipped.

Type the report-back block and /exit.
```

### Report back

```
Session 13B — Builder complete.

Files created:
  /lib/observability/sentry-scrub.ts
  /lib/observability/sentry-ignore.ts
  /lib/observability/sentry-csp-report-uri.ts
  /lib/observability/csp.ts
  /lib/observability/security-headers.ts
  /lib/auth/rate-limit.ts
  /lib/db/auth-rate-limits.ts
  /lib/db/cron-health.ts
  /sentry.client.config.ts
  /sentry.server.config.ts
  /sentry.edge.config.ts
  /instrumentation.ts
  /app/global-error.tsx
  /app/[locale]/error.tsx
  /app/[locale]/not-found.tsx
  /app/api/_health/route.ts
  supabase/migrations/<N>_auth_rate_limits.sql
  supabase/migrations/<N+1>_cron_health.sql

Files modified:
  /lib/config.ts                       (Sentry, CSP, rate-limit env vars)
  /lib/social/errors.ts                (refactor to shared REDACTED_KEYS)
  /middleware.ts                       (nonce + CSP injection)
  /next.config.ts                      (withSentryConfig + headers())
  /lib/publishing/orchestrator.ts      (markCronSeen + Sentry.withMonitor)
  /lib/metrics/orchestrator.ts         (markCronSeen + Sentry.withMonitor)
  /app/[locale]/layout.tsx             (SpeedInsights + Analytics)
  /app/[locale]/(dashboard)/layout.tsx (Sentry.setUser id only)
  /app/[locale]/(auth)/signup/actions.ts        (consumeRateLimit)
  /app/[locale]/(auth)/login/actions.ts         (consumeRateLimit)
  /app/[locale]/(auth)/forgot-password/actions.ts (consumeRateLimit)
  /app/[locale]/(auth)/reset-password/actions.ts  (consumeRateLimit)
  /i18n/{en,pt,es}/auth.json           (errors.rate_limit)
  /i18n/{en,pt,es}/errors.json         (locale_error, not_found)
  /docs/launch-checklist.md            (env-var rows, HSTS no-preload,
                                        Speed Insights/Analytics smoke,
                                        scrubEvent exclusion check)
  /docs/current-phase.md               (Session 13B complete line)

Test status: <N>/<N> passing.
tsc: clean.
Build: smoke-tested with `npm run dev` — homepage renders, no
new console errors, CSP Report-Only header present, x-nonce
visible on rendered page sources.
```

---

## Part C — Reviewer Session (Opus 4.7)

### How to run

1. `/clear` after Builder
2. `claude` in a fresh session
3. `/model` → **Claude Opus 4.7**
4. Paste Primer
5. Paste Reviewer Prompt
6. Reviewer outputs a markdown audit table + verdict
7. Hand the verdict back to the user; do not let the Reviewer attempt fixes

### Primer

```
/resume-session

You are the Reviewer for Session 13. Read /docs/decisions/0007-launch-hardening.md
end-to-end before anything else — it is the spec you are
auditing against.

Read CLAUDE.md (architecture principles, three-client-roles
posture, copyright + safety rules).
Read /docs/current-phase.md — the Session 13B complete line
identifies which files the Builder touched.
Read /docs/launch-checklist.md — the operational counterpart;
checklist items reference ADR sections, audit consistency.

Read every file the Builder created or modified per the
Session 13B report-back. Match the actual code against the
ADR section it cites.

Do NOT propose alternative architectures. Audit against the
ADR. Findings of the form "I'd have done it differently" are
out of scope; findings of the form "this contradicts the ADR"
or "this is a security/correctness bug in the implementation"
are in scope.

Output format:
  - Markdown table — one row per check, columns:
    Section / Check / Status (✅/❌/⚠️) / File:Line / Note
  - After the table, every ❌ with exact fix instructions
  - After that, every ⚠️ with recommendations
  - Verdict block (last paragraph): three categories
      Blockers before merge
      Blockers before flipping Stripe live (deferrable)
      Acceptable to defer (open follow-ups)

Acknowledge and list your planned checks. Then run them.
```

### Reviewer Prompt

```
Audit Session 13B against these checks.

SECTION A — SCRUBBER AND PII

A1.  REDACTED_KEYS is a single source of truth (/lib/observability/sentry-scrub.ts)
     AND /lib/social/errors.ts imports the same set?
     (Two lists is a finding — drift is inevitable.)
A2.  normaliseKey strips non-alphanumeric AND lowercases?
     (If only lowercase, 'Access-Token' misses 'accesstoken'.)
A3.  scrubEvent route-path exclusion drops events for
     '/api/stripe/webhook' and any path under '/api/cron/'?
     Test exists for both?
A4.  Route-path exclusion is a STARTSWITH for /api/cron/ but
     EXACT MATCH for /api/stripe/webhook? (Trailing slash on
     cron means /api/stripe/webhooks does NOT get dropped —
     verify negative case.)
A5.  URL-query scrubbing handles ?token, ?code, ?state on
     event.request.url AND on breadcrumb URLs (category
     'navigation' or 'fetch')?
A6.  Email scrubbing keeps the domain and redacts everything
     of the local part after the first character?
A7.  sendDefaultPii: false set in all three Sentry init files?
A8.  Sentry.setUser called in /app/[locale]/(dashboard)/layout.tsx
     with id ONLY — no email, no name?
A9.  No call site for Sentry.captureMessage or captureException
     passes an unredacted token in event extras? (grep audit.)

SECTION B — SENTRY INIT

B1.  Three init files exist at repo root (client/server/edge),
     instrumentation.ts routes to them by NEXT_RUNTIME?
B2.  tracesSampleRate is exactly 0.05 in all three files?
B3.  profilesSampleRate, replaysSessionSampleRate,
     replaysOnErrorSampleRate are all unset OR 0?
B4.  IGNORE_ERRORS contains exactly the 6 entries in ADR §3.4?
B5.  SENTRY_AUTH_TOKEN read ONLY in next.config.ts via
     process.env directly — NOT added to config.server getters?
B6.  Sentry tunnel option is NOT configured?
B7.  withSentryConfig has hideSourceMaps: true,
     widenClientFileUpload: true, disableLogger: true?
B8.  If SENTRY_DSN is unset, app boots without throwing?
     (Verify by setting empty string locally and running
     `npm run dev`.)

SECTION C — CSP AND HEADERS

C1.  buildCsp output exactly matches ADR §4.3 directive list,
     in order, with no typos?
C2.  script-src contains 'strict-dynamic' AND no 'unsafe-inline'?
     (regex assertion in tests)
C3.  script-src contains https://va.vercel-scripts.com
     (Speed Insights / Analytics)?
C4.  connect-src contains both Vercel insights hosts AND the
     six Supabase/Stripe/Sentry hosts AND POSTIZ_HOST (if
     configured)?
C5.  HSTS value is 'max-age=63072000; includeSubDomains' —
     NO `preload` token? (Test exists.)
C6.  CSP_ENFORCE=false produces 'Content-Security-Policy-Report-Only',
     CSP_ENFORCE=true produces 'Content-Security-Policy'?
C7.  Nonce is per-request — never cached, never reused across
     requests?
C8.  Nonce attached to incoming request headers via
     NextResponse.next({ request: { headers: requestHeaders } })?
     (Without this, Server Components reading headers()
     won't see x-nonce.)
C9.  Middleware order preserved: auth → i18n → x-pathname →
     nonce + CSP?
C10. report-uri directive present when SENTRY_DSN is set,
     absent when not?
C11. STATIC_SECURITY_HEADERS registered via next.config.ts
     headers(), NOT re-applied in middleware?
C12. COEP is NOT set anywhere (deliberate, per ADR §4.4
     update — Stripe iframe compatibility)?

SECTION D — RATE LIMITER

D1.  auth_rate_limits.tokens column type is NUMERIC(10, 4),
     NOT REAL?
D2.  consume_rate_limit_token RPC is SECURITY DEFINER with
     SET search_path = public, pg_temp?
D3.  REVOKE ALL FROM public, GRANT EXECUTE TO service_role?
D4.  RPC handles fresh bucket (NOT FOUND) by inserting at
     p_capacity - 1 (immediate consumption, no double-spend)?
D5.  Refilled tokens UPDATE persists on BOTH success and reject
     branches? (Otherwise rejected calls don't reset
     last_refill and the next call double-counts refill.)
D6.  consumeRateLimit consumes per-IP FIRST, then per-email?
     If per-IP fails, per-email NOT consulted?
D7.  Per-IP token NOT refunded when per-email subsequently
     fails (per ADR §5.2 E4 update — intentional)?
D8.  resolveIp reads only x-forwarded-for, NEVER x-real-ip?
D9.  resolveIp returns 'unknown' on malformed XFF entries?
D10. Bucket keys are 'ip:{addr}:{action}' and
     'email:{lower(addr)}:{action}' — never the raw email?
D11. AUTH_RATE_LIMIT_ENABLED=false short-circuits to true
     without an RPC call?
D12. All four Server Actions wire consumeRateLimit AFTER Zod
     validation, BEFORE Supabase auth?
D13. The four actions return their EXISTING error-envelope
     shape (Step1State / LoginState / etc.) — no new return
     types introduced?
D14. i18n key 'errors.rate_limit' present in EN/PT/ES?
D15. signup and reset-password do NOT pass email to
     consumeRateLimit (per ADR §5.2)?
D16. pruneStaleAuthRateLimits folded into the publish-cron
     janitor (not a new cron entry)?

SECTION E — CRON MONITORS AND HEALTH

E1.  Sentry.withMonitor wraps the body of runPublishTick
     INSIDE the existing try block? Always-200 contract on
     the route handler unchanged?
E2.  Same for runMetricsSyncTick?
E3.  Monitor slugs are exactly 'publish-tick' and 'metrics-sync-tick'?
E4.  Schedule values are crontab strings, '* * * * *' and
     '0 * * * *'?
E5.  markCronSeen called as the FIRST DB operation in each
     tick body? (If a later step throws, cron_health still
     reflects "we tried.")
E6.  cron_health UPSERT uses ON CONFLICT (cron_slug) DO UPDATE?
E7.  /api/_health auth pattern copies /api/_health/social
     verbatim — safeCompare, length pre-check, 404 on miss?
E8.  Stale thresholds: publish > 5 min, metrics > 2 h?
E9.  /api/_health returns 200 even on db: 'err'?
E10. /api/_health returns 200 even when cron_health is empty
     (first deploy)?

SECTION F — ERROR BOUNDARIES

F1.  /app/global-error.tsx has the inline GLOBAL_ERROR_COPY
     map (en/pt/es) — does NOT import from /i18n?
F2.  detectLocale reads window.location.pathname, falls back
     to 'en'?
F3.  Sentry.captureException called in useEffect, eventId
     stored and rendered as 'Reference: {id}'?
F4.  No raw stack trace rendered in any of the three files?
F5.  No emoji in any of the three files?
F6.  /app/[locale]/not-found.tsx does NOT call Sentry?
F7.  /app/[locale]/error.tsx uses useTranslations from
     next-intl?

SECTION G — DEV BYPASS AND CONFIG

G1.  process.env outside /lib/config.ts limited to:
       - /next.config.ts (SENTRY_AUTH_TOKEN, build-time only)
       - /instrumentation.ts (NEXT_RUNTIME, framework convention)
     Any other matches are findings.
G2.  process.env.NODE_ENV outside /lib/config.ts limited to
     the same two files?
G3.  X-Cron-Dev-Trigger remains gated by config.public.NODE_ENV
     !== 'production' in the existing cron routes (not modified
     this session, but regression-check)?
G4.  CSP_ENFORCE default is false (Report-Only at launch)?

SECTION H — CHECKLIST CONSISTENCY

H1.  /docs/launch-checklist.md §1 table contains a row for
     every key in config.public AND config.server?
H2.  /docs/launch-checklist.md §4 contains the Sentry
     circuit-breaker procedure (per ADR §3.7)?
H3.  /docs/launch-checklist.md §5 HSTS verification expects
     value WITHOUT `preload`?
H4.  /docs/launch-checklist.md §5 contains Speed Insights and
     Analytics smoke-test rows?
H5.  Every cross-reference 'see ADR 0007 §X.Y' actually points
     at a section that exists in the now-revised ADR?

VERDICT

After running every check, output three lists:
  Blockers before merge — must be fixed before this PR lands.
  Blockers before flipping Stripe live — can merge but cannot
    deploy to paid production until resolved (e.g. an
    unredacted token in an error path, a CSP directive that
    breaks Stripe.js, a rate-limit RPC that grants on error).
  Acceptable to defer — open follow-ups, doc gaps, test
    additions that don't block launch.

Be specific. A finding that says "CSP might break Stripe" is
not actionable. A finding that says "script-src omits
https://*.vercel-scripts.com so Speed Insights fails to load —
ADR §4.3 line 4" is actionable.
```

---

## Part D — Correction Pass (only if Reviewer finds blockers)

Same shape as Sessions 10D and 11C.

1. `/clear` after Reviewer
2. `claude`, `/model` → **Claude Sonnet 4.6**
3. Primer: re-read ADR 0007 and the Reviewer findings; do NOT re-architect; apply each blocker fix as a small, targeted change with a corresponding test
4. Group fixes by file when possible (one edit per file, not one per finding)
5. After each fix, re-run the scoped vitest path for that surface
6. After all blockers, run the full verification block from B8
7. Update /docs/current-phase.md — add "Session 13D complete — N blockers resolved" with the list of finding IDs from the Reviewer table
8. Report back with the same shape as B8

Defer any ⚠️ Reviewer finding labelled "acceptable to defer" — open a backlog note in `current-phase.md` "Known issues" section; do not fix this pass.

If the Reviewer finds zero blockers (rare but possible), skip 13D entirely and update current-phase.md with "Session 13C reviewer pass — no blockers; ⚠️ items added to backlog."

---

## Common gotchas in Session 13

- **Architect tries to ship config files.** Output is ADR + checklist skeleton only. If you see `sentry.client.config.ts` in the Architect's output, stop and restart.
- **Architect or Builder wants to add Performance / Replay.** Errors-only at launch is deliberate (ADR §3.1). Push back; revisit only if §3.7's circuit-breaker procedure fires.
- **CSP enforced from day one.** Will break something — the question is what. Report-Only for 7 days is non-negotiable (ADR §4.1, §9).
- **CSP nonce on the response only.** Setting `Content-Security-Policy: ... 'nonce-X'` without ALSO injecting `x-nonce` onto the request via `NextResponse.next({ request: { headers } })` means Server Components don't see the nonce and emit unnonced scripts that CSP then blocks. Both writes required.
- **`'strict-dynamic'` + host allow-list.** In CSP3 browsers that honour `strict-dynamic`, host-source allow-lists in `script-src` are ignored. The `https://js.stripe.com` and `https://va.vercel-scripts.com` entries serve as fallbacks for older browsers; the live trust propagates through the nonced parent script. Don't be alarmed if Report-Only doesn't fire on Stripe sub-scripts; that's correct behaviour.
- **HSTS `preload`.** Deliberately omitted (ADR §4.4 D-update). Re-adding it commits the apex AND every subdomain to HTTPS-only effectively forever. Submission to the preload list is a separate, deliberate post-launch decision.
- **Email/Resend creeps back in.** Session 14. If Builder drafts an email-template scrubbing branch or a Resend webhook handler in this session, that's the signal to push back.
- **Builder tries to fold `middleware.ts` → `proxy.ts`.** Separate cleanup pass. Out of scope.
- **Reviewer tries to refactor the cron auth.** It's already correct per ADR 0005 §12 and 0006 §9. The Sentry wrap goes inside the orchestrator, not around the route's auth check.
- **Rate-limit table called `rate_limits` instead of `auth_rate_limits`.** The prefix is deliberate — future rate-limit surfaces (webhook, AI generation per-business) will live in different tables to keep the bucket keyspace separate.
- **`tokens` column as `REAL` instead of `NUMERIC(10,4)`.** Floating-point drift produces spurious rejects over time. The ADR locked NUMERIC (§5.3 E-update) — don't "simplify" it back.
- **`global-error.tsx` uses next-intl.** It cannot. If the root layout died, next-intl's provider may be unmounted. The inline locale map (ADR §6.1 B-update) is the only safe path.
- **Sentry `setUser` with email.** ADR §3.3 update — id only, never email. If Builder sets `email: user.email`, that's a finding.
- **`/api/_health` returns 4xx on unhealthy state.** Always 200. The consumer reads the JSON. A 4xx makes uptime tools mark us down on a Sentry hiccup, which is the wrong signal.
- **Speed Insights or Analytics blocked by CSP in Report-Only.** If the report-uri stream lights up with `va.vercel-scripts.com` or `*.vercel-insights.com` violations, the script-src or connect-src entries in `buildCsp` are missing or typo'd. Check Builder output against ADR §4.3 line by line.

---

## What this unlocks

After Session 13:
- Every production error has a Sentry event with a release tag, environment, and zero leaked tokens.
- Every cron tick is monitored independently by Sentry and by the pull-based health check.
- The dashboard ships with a strict CSP (Report-Only for the first week, then enforced) — the bar for a B2B SaaS landing page.
- Auth surfaces are rate-limited per-IP and per-email; credential-stuffing has friction, brute-force has a wall.
- A committed `docs/launch-checklist.md` makes the deploy reproducible — no Slack archaeology to find "the steps we did last time."
- Phase 1 is launch-eligible. The remaining gap is email notifications (Session 14) and content (legal pages, status page provisioning).

The next session opens with the launch checklist green except for the email rows.
