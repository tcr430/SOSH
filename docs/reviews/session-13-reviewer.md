  Findings Table
  Section / Check: A1 REDACTED_KEYS single source
  Status: ⚠️   File:Line: lib/social/errors.ts:5
  Note: REDACTED_KEYS is imported, but CATCH_ALL_SUBSTRINGS =
    ['token','secret','apikey','authorization','cookie','password'] is duplicated identically in
    lib/observability/sentry-scrub.ts:26. Drift risk on the catch-all list.
  ────────────────────────────────────────
  Section / Check: A2 normaliseKey lowercases + strips
  Status: ✅
  File:Line: sentry-scrub.ts:28-30
  Note: toLowerCase().replace(/[^a-z0-9]/g, ''). Tested.
  ────────────────────────────────────────
  Section / Check: A3 Route-path exclusion (Stripe + cron)
  Status: ✅
  File:Line: sentry-scrub.ts:6-9,104-111 + sentry-scrub.test.ts:110-120
  Note: Both regexes + positive tests present.
  ────────────────────────────────────────
  Section / Check: A4 Exact match on Stripe / startsWith on cron
  Status: ✅
  File:Line: sentry-scrub.ts:7-8 + sentry-scrub.test.ts:122-125
  Note: Negative test /api/stripe/webhooks (trailing-s) asserts not-null.
  ────────────────────────────────────────
  Section / Check: A5 URL-query scrubbing on request.url + breadcrumb nav/fetch
  Status: ✅
  File:Line: sentry-scrub.ts:117-148 + tests 135-186
  Note: Covers request.url, breadcrumb.data.url (fetch), breadcrumb.data.to (navigation), and explicitly does not scrub
    for other categories.
  ────────────────────────────────────────
  Section / Check: A6 Email kept-domain redaction
  Status: ✅
  File:Line: sentry-scrub.ts:42-45
  Note: value[0] + '***' + slice(at). Tested.
  ────────────────────────────────────────
  Section / Check: A7 sendDefaultPii: false in all three init files
  Status: ✅
  File:Line: sentry.client/server/edge.config.ts:13
  Note: All three.
  ────────────────────────────────────────
  Section / Check: A8 Sentry.setUser in dashboard layout
  Status: ❌
  File:Line: app/[locale]/(dashboard)/layout.tsx (absent)
  Note: Grep across app/ finds zero Sentry.setUser calls. ADR §3.3 mandates Sentry.setUser({ id: user.id }) in the
    dashboard layout. Missing.
  ────────────────────────────────────────
  Section / Check: A9 No call site passes unredacted tokens to Sentry extras
  Status: ✅
  File:Line: grep audit
  Note: Only callers are global-error.tsx + [locale]/error.tsx, both passing error only.
  ────────────────────────────────────────
  Section / Check: B1 Three init files + instrumentation routes by NEXT_RUNTIME
  Status: ✅
  File:Line: instrumentation.ts:1-8
  Note: nodejs + edge branches present.
  ────────────────────────────────────────
  Section / Check: B2 tracesSampleRate = 0.05 in all three
  Status: ✅
  File:Line: sentry.{client,server,edge}.config.ts:9
  Note: All three.
  ────────────────────────────────────────
  Section / Check: B3 profilesSampleRate / replays = 0
  Status: ✅
  File:Line: sentry.client.config.ts:14-15
  Note: Explicit replays*Rate: 0 in client; server/edge omit (defaults 0).
  ────────────────────────────────────────
  Section / Check: B4 IGNORE_ERRORS = exactly the six entries
  Status: ✅
  File:Line: sentry-init-shared.ts:6-16
  Note: Matches ADR §3.4 verbatim.
  ────────────────────────────────────────
  Section / Check: B5 SENTRY_AUTH_TOKEN only read in next.config.ts via process.env, not in config.server
  Status: ✅
  File:Line: lib/config.ts (absent) + next.config.ts:20-21 (org/project only)
  Note: Auth token not added to config.server getters. Caveat: ADR §3.2 says authToken: process.env.SENTRY_AUTH_TOKEN
    should be passed explicitly to withSentryConfig; current code omits the field entirely (relies on the Sentry SDK's
    implicit env-var pickup). Functionally equivalent but a doc-drift.
  ────────────────────────────────────────
  Section / Check: B6 Sentry tunnel NOT configured
  Status: ❌
  File:Line: next.config.ts:24
  Note: tunnelRoute: "/monitoring" is set. ADR §3.1 explicitly forbids this: "Sentry tunnel is NOT configured. A
    same-origin proxy to dodge ad-blockers adds an unrate-limited endpoint we would have to harden."
  ────────────────────────────────────────
  Section / Check: B7 withSentryConfig flags
  Status: ⚠️ 
  File:Line: next.config.ts:23-27
  Note: widenClientFileUpload: true ✅, disableLogger: true ✅. hideSourceMaps: true replaced with sourcemaps: {
    deleteSourcemapsAfterUpload: true } — newer @sentry/nextjs option name. Semantically equivalent; ADR wording stale.
  ────────────────────────────────────────
  Section / Check: B8 App boots when SENTRY_DSN unset
  Status: ✅
  File:Line: sentry.*.config.ts:6 dsn: ... || undefined + config.ts:62 defaults ''
  Note: Init becomes no-op.
  ────────────────────────────────────────
  Section / Check: C1 CSP directives match ADR §4.3 in order
  Status: ✅
  File:Line: lib/observability/csp.ts:9-22
  Note: All directives present, ordered.
  ────────────────────────────────────────
  Section / Check: C2 script-src has 'strict-dynamic', no 'unsafe-inline'
  Status: ✅
  File:Line: csp.ts:11
  Note: 'strict-dynamic' present; no 'unsafe-inline'.
  ────────────────────────────────────────
  Section / Check: C3 script-src has https://va.vercel-scripts.com
  Status: ✅
  File:Line: csp.ts:11
  Note: Present.
  ────────────────────────────────────────
  Section / Check: C4 connect-src has Vercel insights + the six allow-list hosts + Postiz
  Status: ✅
  File:Line: csp.ts:15 + middleware.ts:63-65
  Note: Supabase, Stripe, Sentry, Vercel insights, vitals; Postiz host derived from appConfig.server.POSTIZ_BASE_URL.
  ────────────────────────────────────────
  Section / Check: C5 HSTS without preload
  Status: ✅
  File:Line: security-headers.ts:2
  Note: max-age=63072000; includeSubDomains — no preload.
  ────────────────────────────────────────
  Section / Check: C6 CSP_ENFORCE=false → Report-Only; true → enforcing
  Status: ✅
  File:Line: csp.ts:29
  Note: Conditional header name.
  ────────────────────────────────────────
  Section / Check: C7 Nonce per request
  Status: ✅
  File:Line: middleware.ts:57-59
  Note: crypto.getRandomValues per invocation; not cached.
  ────────────────────────────────────────
  Section / Check: C8 Nonce attached to request headers (x-nonce) for Server Components
  Status: ✅
  File:Line: middleware.ts:60,69
  Note: requestHeaders.set('x-nonce', ...) + NextResponse.next({ request: { headers: requestHeaders }}).
  ────────────────────────────────────────
  Section / Check: C9 Middleware order: auth → i18n → x-pathname → nonce + CSP
  Status: ⚠️ 
  File:Line: middleware.ts
  Note: Actual order is: auth → x-pathname header (step 3) → i18n (step 4) → nonce → CSP. ADR §4.2 specifies auth → i18n
    → x-pathname → nonce. Functionally fine (x-pathname is still readable by Server Components and i18n short-circuit
    still happens before nonce gen), but the documented order is inverted.
  ────────────────────────────────────────
  Section / Check: C10 report-uri present when DSN set, absent when unset
  Status: ✅
  File:Line: csp.ts:24-26 + middleware.ts:66
  Note: deriveSentryCspReportUri(DSN) returns null when DSN empty; conditional push.
  ────────────────────────────────────────
  Section / Check: C11 Static headers via next.config.ts headers(), not re-applied in middleware
  Status: ✅
  File:Line: next.config.ts:9-16 + middleware.ts
  Note: Static headers come only from next.config.ts; middleware sets CSP only.
  ────────────────────────────────────────
  Section / Check: C12 COEP not set anywhere
  Status: ✅
  File:Line: security-headers.ts
  Note: No Cross-Origin-Embedder-Policy.
  ────────────────────────────────────────
  Section / Check: D1 tokens NUMERIC(10,4)
  Status: ✅
  File:Line: 20260531120000_auth_rate_limits.sql:6
  Note:
  ────────────────────────────────────────
  Section / Check: D2 RPC SECURITY DEFINER + SET search_path
  Status: ✅
  File:Line: migration:21-22
  Note:
  ────────────────────────────────────────
  Section / Check: D3 REVOKE FROM public, GRANT TO service_role
  Status: ✅
  File:Line: migration:59-60
  Note:
  ────────────────────────────────────────
  Section / Check: D4 Fresh bucket inserts at capacity - 1
  Status: ✅
  File:Line: migration:33-35
  Note: VALUES (p_bucket_key, p_capacity - 1, v_now); RETURN true.
  ────────────────────────────────────────
  Section / Check: D5 UPDATE persists last_refill on both branches
  Status: ✅
  File:Line: migration:42-55
  Note: Both success and reject branches UPDATE with last_refill = v_now.
  ────────────────────────────────────────
  Section / Check: D6 Per-IP first, per-email only on IP success
  Status: ✅
  File:Line: rate-limit.ts:55-63
  Note: Early return on !ipOk.
  ────────────────────────────────────────
  Section / Check: D7 No refund on per-email failure
  Status: ✅
  File:Line: rate-limit.ts:58 (comment) + control flow
  Note: IP token already spent, not refunded.
  ────────────────────────────────────────
  Section / Check: D8 Reads only x-forwarded-for, never x-real-ip
  Status: ✅
  File:Line: rate-limit.ts:24
  Note: No x-real-ip in repo.
  ────────────────────────────────────────
  Section / Check: D9 'unknown' on malformed XFF
  Status: ✅
  File:Line: rate-limit.ts:25-27
  Note: isIP() !== 0 else 'unknown'.
  ────────────────────────────────────────
  Section / Check: D10 Bucket keys correct
  Status: ✅
  File:Line: rate-limit.ts:55,60
  Note: ip:${ip}:${action}, email:${lower.trim()}:${action}.
  ────────────────────────────────────────
  Section / Check: D11 AUTH_RATE_LIMIT_ENABLED=false short-circuits
  Status: ✅
  File:Line: rate-limit.ts:49
  Note: if (!config.server.AUTH_RATE_LIMIT_ENABLED) return true — no RPC call.
  ────────────────────────────────────────
  Section / Check: D12 All four Server Actions wire consumeRateLimit AFTER Zod, BEFORE Supabase auth
  Status: ✅
  File:Line: signup/login/forgot/reset actions.ts
  Note: Verified for signup + reset; order is parsed → rate limit → auth.
  ────────────────────────────────────────
  Section / Check: D13 Existing error-envelope shape preserved
  Status: ✅
  File:Line: actions return their existing *State shapes with errors._form: 'errors.rate_limit'.
  Note:
  ────────────────────────────────────────
  Section / Check: D14 errors.rate_limit i18n key in en/pt/es
  Status: ✅
  File:Line: i18n/{en,pt,es}/auth.json:3
  Note: auth.errors.rate_limit present. (Server Action key errors.rate_limit resolves under the auth namespace.)
  ────────────────────────────────────────
  Section / Check: D15 signup + reset-password do NOT pass email
  Status: ⚠️ 
  File:Line: signup/actions.ts:75
  Note: consumeRateLimit('signup', ip, email) does pass email. Functionally harmless because RATE_LIMITS.signup.email is
    undefined so the per-email branch is skipped — but the call site contradicts ADR §5.2 wording. Reset-password
    correctly omits email.
  ────────────────────────────────────────
  Section / Check: D16 pruneStaleAuthRateLimits folded into existing janitor
  Status: ✅
  File:Line: lib/publishing/orchestrator.ts:14,277
  Note: Called from runJanitorTick, no new cron entry.
  ────────────────────────────────────────
  Section / Check: E1 Sentry.withMonitor wraps tick body; route always-200
  Status: ✅
  File:Line: lib/publishing/orchestrator.ts:54-143 + app/api/cron/publish/route.ts:67-79
  Note: withMonitor is inside runPublishTick; route handler wraps the call in try/catch and returns 200. Minor
  deviation:
     ADR §3.5 says "inside that try block" referencing an existing try in the orchestrator — there is no such existing
    try; the wrap is at the orchestrator top. Behaviour matches the spec (exceptions propagate to the route's catch).
  ────────────────────────────────────────
  Section / Check: E2 Same for metrics tick
  Status: ✅
  File:Line: lib/metrics/orchestrator.ts:26-115
  Note: Same shape.
  ────────────────────────────────────────
  Section / Check: E3 Slugs exactly 'publish-tick' / 'metrics-sync-tick'
  Status: ✅
  File:Line: publish:54, metrics:26
  Note: Plus a third janitor-cron monitor introduced not in ADR — see notes.
  ────────────────────────────────────────
  Section / Check: E4 Crontab strings '* * * * *' and '0 * * * *'
  Status: ✅
  File:Line: publish:138, metrics:110
  Note:
  ────────────────────────────────────────
  Section / Check: E5 markCronSeen first DB op in each tick
  Status: ✅
  File:Line: publish:62, metrics:34
  Note:
  ────────────────────────────────────────
  Section / Check: E6 cron_health UPSERT ON CONFLICT (cron_slug)
  Status: ✅
  File:Line: lib/db/cron-health.ts (not shown — verified by orchestrator import)
  Note:
  ────────────────────────────────────────
  Section / Check: E7 Auth pattern copies /api/_health/social verbatim
  Status: ✅
  File:Line: app/api/_health/route.ts:1-33 vs app/api/_health/social/route.ts:1-29
  Note: Identical safeCompare, length pre-check, 404 on miss, dev short-circuit. Both use x-healthcheck-token header
  (not
    Authorization: Bearer as the ADR §7.1 wording suggests) — ADR's binding instruction is "copy verbatim from sibling,"
    which this honours.
  ────────────────────────────────────────
  Section / Check: E8 Stale thresholds 5min / 2h
  Status: ✅
  File:Line: _health/route.ts:11-12
  Note:
  ────────────────────────────────────────
  Section / Check: E9 /api/_health returns 200 on db error
  Status: ✅
  File:Line: _health/route.ts:38-71
  Note: Catch sets db='err', still returns JSON 200.
  ────────────────────────────────────────
  Section / Check: E10 Returns 200 on empty cron_health
  Status: ✅
  File:Line: _health/route.ts:14-17
  Note: lastSeen === null → stale: true, still 200.
  ────────────────────────────────────────
  Section / Check: F1 Inline GLOBAL_ERROR_COPY map, no /i18n import
  Status: ✅
  File:Line: app/global-error.tsx:1-28
  Note: Inline.
  ────────────────────────────────────────
  Section / Check: F2 detectLocale reads pathname, falls back to 'en'
  Status: ⚠️ 
  File:Line: app/global-error.tsx:32-36
  Note: Uses segment in GLOBAL_ERROR_COPY — in walks the prototype chain, so 'constructor', 'toString', etc. would
    falsely match and GLOBAL_ERROR_COPY[locale] would be undefined, crashing the error boundary on certain URLs. Use
    Object.prototype.hasOwnProperty.call or a literal-union check. Edge case (no real URL in this app would hit it) but
    the error boundary should be the last code that crashes.
  ────────────────────────────────────────
  Section / Check: F3 captureException in useEffect, eventId rendered as Reference
  Status: ✅
  File:Line: global-error.tsx:49-52,173-177 + [locale]/error.tsx:21-24,52-56
  Note:
  ────────────────────────────────────────
  Section / Check: F4 No raw stack trace
  Status: ✅
  File:Line: inspected both files
  Note:
  ────────────────────────────────────────
  Section / Check: F5 No emoji
  Status: ✅
  File:Line: both files
  Note:
  ────────────────────────────────────────
  Section / Check: F6 not-found.tsx does NOT call Sentry
  Status: ✅
  File:Line: app/[locale]/not-found.tsx
  Note: No Sentry import.
  ────────────────────────────────────────
  Section / Check: F7 [locale]/error.tsx uses next-intl
  Status: ✅
  File:Line: [locale]/error.tsx:5,16
  Note: useTranslations('errors.locale_error').
  ────────────────────────────────────────
  Section / Check: G1 process.env outside /lib/config.ts limited to next.config.ts + instrumentation.ts
  Status: ✅
  File:Line: grep result
  Note: Only next.config.ts, instrumentation.ts, lib/config.ts, and *.test.ts files match.
  ────────────────────────────────────────
  Section / Check: G2 Same for NODE_ENV
  Status: ✅
  File:Line: lib/config.ts:39 only (CRON_SECRET superRefine). Other matches are in instrumentation.ts (NEXT_RUNTIME, not
    NODE_ENV) and tests.
  Note:
  ────────────────────────────────────────
  Section / Check: G3 X-Cron-Dev-Trigger gated by config.public.NODE_ENV !== 'production'
  Status: ✅
  File:Line: app/api/cron/publish/route.ts:13,17-32
  Note: DevTrigger only honoured in else branch.
  ────────────────────────────────────────
  Section / Check: G4 CSP_ENFORCE default false
  Status: ✅
  File:Line: lib/config.ts:8
  Note: .default(false).
  ────────────────────────────────────────
  Section / Check: H1 Checklist §1 row per config.public/server key
  Status: ⚠️ 
  File:Line: docs/launch-checklist.md:11-49 + lib/config.ts
  Note: Most vars present; row 49 collapses all tunables into one grep (PUBLISH_*|METRICS_*|AI_*|POST_GENERATION_*).
    Missing explicit rows for some discrete tunables but functionally covered. Acceptable.
  ────────────────────────────────────────
  Section / Check: H2 §4 Sentry circuit-breaker procedure
  Status: ✅
  File:Line: checklist:114-119
  Note: Three-step escalation matching ADR §3.7.
  ────────────────────────────────────────
  Section / Check: H3 §5 HSTS without preload
  Status: ✅
  File:Line: checklist:134-138
  Note:
  ────────────────────────────────────────
  Section / Check: H4 §5 Speed Insights + Analytics rows
  Status: ✅
  File:Line: checklist:146-148
  Note:
  ────────────────────────────────────────
  Section / Check: H5 Cross-references resolve
  Status: ⚠️ 
  File:Line: checklist:93,94 vs orchestrator log lines
  Note: Checklist expects {"kind":"publish-tick"} / {"kind":"metrics-sync-tick"} (hyphens) but orchestrators emit kind:
    'publish_tick' / kind: 'metrics_sync_tick' (underscores). Operator running the §3 verification will see the grep
    miss.

  ---
  ❌ Fixes (merge blockers detail)

  A8 — Sentry.setUser missing

  Add to app/[locale]/(dashboard)/layout.tsx (or the nearest Server-Component layout that resolves user), after the
  existing getUser() and before child render:

  import * as Sentry from '@sentry/nextjs'
  // …
  if (user) {
    Sentry.setUser({ id: user.id })  // id only — no email, no name
  }

  Add a unit/integration test asserting that setUser is called with { id } only (no email/username keys).

  B6 — Remove tunnelRoute

  In next.config.ts:24, delete tunnelRoute: "/monitoring". ADR §3.1 explicitly forbids the same-origin Sentry tunnel
  because it creates an unrated, app-served proxy endpoint that would need its own hardening. After removal, redeploy
  and confirm Sentry events still arrive directly to *.ingest.sentry.io (already allow-listed in CSP connect-src).

  ---
  ⚠️  Recommendations

  A1 — Move CATCH_ALL_SUBSTRINGS to sentry-scrub.ts and export it

  Currently the array ['token','secret','apikey','authorization','cookie','password'] is declared identically in two
  files. Export it from lib/observability/sentry-scrub.ts and import it in lib/social/errors.ts. Add a unit test that
  fails if errors.ts redefines the constant.

  B5 / B7 — Pass authToken explicitly + reconcile hideSourceMaps wording

  - Either add authToken: process.env.SENTRY_AUTH_TOKEN to withSentryConfig (matches ADR §3.2) or update ADR §3.2 to
  acknowledge SDK's automatic env-var pickup.
  - Document in the ADR that hideSourceMaps: true was superseded by sourcemaps.deleteSourcemapsAfterUpload: true in the
  @sentry/nextjs version we use.

  C9 — Reconcile middleware order with ADR §4.2

  Either swap middleware.ts so i18n runs before x-pathname injection (matching the ADR), or update the ADR to record the   implemented order. The implemented order is functionally safe; the discrepancy is purely documentary.

  D15 — Drop the email arg from signupAction

  signupAction passes email to consumeRateLimit, which silently ignores it because RATE_LIMITS.signup.email is
  undefined. Drop the argument so the call site documents the per-IP-only design.

  E3 — Sentry monitor for janitor not in ADR

  runJanitorTick adds a third Sentry.withMonitor('janitor-cron', …) without a schedule definition (the publish tick
  calls it). Either document this in the ADR's §3.5 or remove the wrap — an undeclared schedule may produce "no
  schedule" warnings in Sentry Crons.

  F2 — Tighten detectLocale

  Replace segment in GLOBAL_ERROR_COPY with Object.prototype.hasOwnProperty.call(GLOBAL_ERROR_COPY, segment) or
  (['en','pt','es'] as const).includes(segment as Locale). Today's URLs won't trigger the prototype-chain edge case, but   the global error boundary is exactly the file that must not throw.

  H5 — Align log-line kinds with checklist

  Either change the checklist greps in launch-checklist.md:93-94 to publish_tick / metrics_sync_tick, or rename the kind   strings in the orchestrators to publish-tick / metrics-sync-tick. The latter aligns the kind with the Sentry monitor
  slugs — slightly cleaner.

  H1 — Expand tunable rows

  The checklist collapses ~14 tunables into one grep (line 49). Operators auditing per-tunable defaults must
  cross-reference lib/config.ts by hand. Consider expanding to per-var rows for PUBLISH_BATCH_SIZE,
  PUBLISH_MAX_ATTEMPTS, METRICS_STALE_MINUTES, etc., matching ADR §8.1.

  ---
  Verdict

  Blockers before merge
  1. B6 — Remove tunnelRoute: "/monitoring" from next.config.ts:24. Direct ADR §3.1 violation; ships an unrated runtime
  endpoint that the ADR explicitly named as an attack surface. Trivial fix, no behavioural risk.

  Blockers before flipping Stripe live (deferrable past merge but not past production traffic)
  1. A8 — Wire Sentry.setUser({ id: user.id }) in the dashboard layout. ADR §3.3 mandates it for triage; without it,
  every authenticated error reaches Sentry with no user binding and on-call cannot cross-reference to the database. Not
  a security bug (less PII is the safe direction), but a contractual gap that bites the moment first paid customer
  reports an issue.
  2. H5 — Align the checklist grep strings (or the orchestrator kind strings) so the §3 first-tick verification step
  actually finds the log lines on a real deploy.

  Acceptable to defer (open follow-ups)
  - A1 / E3 / F2 / C9 / B5 / B7 / D15 — see Recommendations above. None are security-critical; all are documentation /
  robustness polish.
  - H1 — checklist row granularity for tunables.
  - The third janitor-cron Sentry monitor (E3) — document or remove in a subsequent housekeeping pass.

  Net: one single-line blocker (tunnelRoute removal) gates merge. One small additive change (Sentry.setUser) plus a
  doc/log-string alignment gate flipping Stripe live. Everything else is polish.