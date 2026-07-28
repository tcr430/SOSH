# Launch Checklist

**Status:** Skeleton — Builder fills the per-row details by reading the cited source files.
**Owner:** Last engineer to merge before flipping Stripe live.
**Related:** ADR 0007 (Launch Hardening).

This document is the pre-launch runbook. Every section is a gate — do not flip Stripe live until every box passes. Each section names *what to verify* and *how to verify it*; the Builder session writes the actual command output / row content where marked `<fill>`.

---

## 1. Environment variables

Source of truth: `/lib/config.ts` (server + public schemas). The Builder copies every var in those two schemas into the table below.

Verification command (per row): `vercel env ls production | grep <VAR>`

| Var | Where to get the value | Verified in prod |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys | ☐ `vercel env ls production \| grep -q '^ANTHROPIC_API_KEY' && echo present \|\| echo MISSING` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role | ☐ `vercel env ls production \| grep -q '^SUPABASE_SERVICE_ROLE_KEY' && echo present \|\| echo MISSING` |
| `DATABASE_URL` | Supabase Dashboard → Project Settings → Database → Connection string (URI, transaction pooler) | ☐ `vercel env ls production \| grep -q '^DATABASE_URL' && echo present \|\| echo MISSING` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL | ☐ `vercel env ls production \| grep -q '^NEXT_PUBLIC_SUPABASE_URL' && echo present \|\| echo MISSING` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon | ☐ `vercel env ls production \| grep -q '^NEXT_PUBLIC_SUPABASE_ANON_KEY' && echo present \|\| echo MISSING` |
| `NEXT_PUBLIC_APP_URL` | Production domain (e.g. `https://sosh.app`) | ☐ `vercel env ls production \| grep -q '^NEXT_PUBLIC_APP_URL' && echo present \|\| echo MISSING` |
| `OAUTH_STATE_SECRET` | Generated once: `openssl rand -base64 48` (≥ 32 chars) | ☐ `vercel env ls production \| grep -q '^OAUTH_STATE_SECRET' && echo present \|\| echo MISSING` |
| `HEALTHCHECK_TOKEN` | Generated once: `openssl rand -base64 32` | ☐ `vercel env ls production \| grep -q '^HEALTHCHECK_TOKEN' && echo present \|\| echo MISSING` |
| `CRON_SECRET` | Generated once: `openssl rand -base64 48` (≥ 32 chars in prod — config enforces) | ☐ `vercel env ls production \| grep -q '^CRON_SECRET' && echo present \|\| echo MISSING` |
| `POSTIZ_BASE_URL` | Self-hosted Postiz URL (Hetzner) | ☐ `vercel env ls production \| grep -q '^POSTIZ_BASE_URL' && echo present \|\| echo MISSING` |
| `POSTIZ_API_KEY` | Postiz admin UI → API Keys | ☐ `vercel env ls production \| grep -q '^POSTIZ_API_KEY' && echo present \|\| echo MISSING` |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys (**live mode**) | ☐ `vercel env ls production \| grep -q '^STRIPE_SECRET_KEY' && echo present \|\| echo MISSING` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → endpoint → Signing secret (**live mode**) | ☐ `vercel env ls production \| grep -q '^STRIPE_WEBHOOK_SECRET' && echo present \|\| echo MISSING` |
| `STRIPE_PRICE_ID_PLUS` | Stripe Dashboard → Products → Plus → Price ID (**live mode**) | ☐ `vercel env ls production \| grep -q '^STRIPE_PRICE_ID_PLUS' && echo present \|\| echo MISSING` |
| `STRIPE_PRICE_ID_PRO` | Stripe Dashboard → Products → Pro → Price ID (**live mode**) | ☐ `vercel env ls production \| grep -q '^STRIPE_PRICE_ID_PRO' && echo present \|\| echo MISSING` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API Keys (**live mode**, `pk_live_…`) | ☐ `vercel env ls production \| grep -q '^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' && echo present \|\| echo MISSING` |
| `RESEND_API_KEY` | Resend Dashboard → API Keys | ☐ `vercel env ls production \| grep -q '^RESEND_API_KEY' && echo present \|\| echo MISSING` |
| `RESEND_WEBHOOK_SECRET` | Resend Dashboard → Webhooks → endpoint → Signing secret | ☐ `vercel env ls production \| grep -q '^RESEND_WEBHOOK_SECRET' && echo present \|\| echo MISSING` |
| `EMAIL_PROVIDER` | `resend` (production) | ☐ `vercel env ls production \| grep -q '^EMAIL_PROVIDER' && echo present \|\| echo MISSING` |
| `EMAIL_FROM` | `hello@mail.sosh.app` | ☐ `vercel env ls production \| grep -q '^EMAIL_FROM' && echo present \|\| echo MISSING` |
| `EMAIL_REPLY_TO` | `support@sosh.app` | ☐ `vercel env ls production \| grep -q '^EMAIL_REPLY_TO' && echo present \|\| echo MISSING` |
| Email tunables (`EMAIL_DRAIN_BATCH_SIZE`, `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BACKOFF_SECONDS`, `EMAIL_SENDING_STUCK_MINUTES`) | Defaults from `/lib/config.ts` — set only if overriding | ☐ `vercel env ls production \| grep -E '^EMAIL_' \|\| echo none-set` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → sosh → Client Keys (DSN) | ☐ `vercel env ls production \| grep -q '^NEXT_PUBLIC_SENTRY_DSN' && echo present \|\| echo MISSING` |
| `SENTRY_ENVIRONMENT` | `production` (or omit — defaults to `VERCEL_ENV`) | ☐ `vercel env ls production \| grep -q '^SENTRY_ENVIRONMENT' && echo present \|\| echo MISSING` |
| `SENTRY_ORG` | Sentry → Settings → org slug | ☐ `vercel env ls production \| grep -q '^SENTRY_ORG' && echo present \|\| echo MISSING` |
| `SENTRY_PROJECT` | Sentry → Settings → project slug | ☐ `vercel env ls production \| grep -q '^SENTRY_PROJECT' && echo present \|\| echo MISSING` |
| `SENTRY_AUTH_TOKEN` | Sentry → User Settings → Auth Tokens (scopes: project:releases, org:read). **BUILD scope only — must NOT be set as Runtime.** | ☐ `vercel env ls production \| grep -q '^SENTRY_AUTH_TOKEN' && echo present \|\| echo MISSING` — confirm scope column shows **Build**, not Runtime |
| `VERCEL_GIT_COMMIT_SHA` | Auto-provided by Vercel | ☐ (auto) |
| `CSP_ENFORCE` | `false` at launch; flip to `true` after §5 24h-quiet criterion | ☐ `vercel env ls production \| grep -q '^CSP_ENFORCE' && echo present \|\| echo MISSING` |
| `AUTH_RATE_LIMIT_ENABLED` | `true` | ☐ `vercel env ls production \| grep -q '^AUTH_RATE_LIMIT_ENABLED' && echo present \|\| echo MISSING` |
| `AI_PROVIDER` | `anthropic` | ☐ `vercel env ls production \| grep -q '^AI_PROVIDER' && echo present \|\| echo MISSING` |
| `SOCIAL_PROVIDER_MODE` | unset (defaults to Postiz when `POSTIZ_BASE_URL` is set) | ☐ `vercel env ls production \| grep -q '^SOCIAL_PROVIDER_MODE' && echo present \|\| echo MISSING` |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn Developer Portal → app | ☐ `vercel env ls production \| grep -q '^LINKEDIN_CLIENT_ID' && echo present \|\| echo MISSING` / `vercel env ls production \| grep -q '^LINKEDIN_CLIENT_SECRET' && echo present \|\| echo MISSING` |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X Developer Portal → app | ☐ `vercel env ls production \| grep -q '^X_CLIENT_ID' && echo present \|\| echo MISSING` / `vercel env ls production \| grep -q '^X_CLIENT_SECRET' && echo present \|\| echo MISSING` |
| `META_APP_ID` / `META_APP_SECRET` | Meta for Developers → app | ☐ `vercel env ls production \| grep -q '^META_APP_ID' && echo present \|\| echo MISSING` / `vercel env ls production \| grep -q '^META_APP_SECRET' && echo present \|\| echo MISSING` |
| `PUBLISH_MAX_ATTEMPTS` | Default `5` — set only if overriding | ☐ `vercel env ls production \| grep '^PUBLISH_MAX_ATTEMPTS' \|\| echo 'not set (default 5)'` |
| `PUBLISH_BATCH_SIZE` | Default `25` — set only if overriding | ☐ `vercel env ls production \| grep '^PUBLISH_BATCH_SIZE' \|\| echo 'not set (default 25)'` |
| `PUBLISH_RETRY_BACKOFF_SECONDS` | Default `60` — set only if overriding | ☐ `vercel env ls production \| grep '^PUBLISH_RETRY_BACKOFF_SECONDS' \|\| echo 'not set (default 60)'` |
| `PUBLISH_STUCK_MINUTES` | Default `10` — set only if overriding | ☐ `vercel env ls production \| grep '^PUBLISH_STUCK_MINUTES' \|\| echo 'not set (default 10)'` |
| `METRICS_SYNC_BATCH_SIZE` | Default `50` — set only if overriding | ☐ `vercel env ls production \| grep '^METRICS_SYNC_BATCH_SIZE' \|\| echo 'not set (default 50)'` |
| `METRICS_STALE_MINUTES` | Default `360` — set only if overriding | ☐ `vercel env ls production \| grep '^METRICS_STALE_MINUTES' \|\| echo 'not set (default 360)'` |
| `METRICS_MAX_AGE_DAYS` | Default `90` — set only if overriding | ☐ `vercel env ls production \| grep '^METRICS_MAX_AGE_DAYS' \|\| echo 'not set (default 90)'` |
| `AI_RATE_LIMIT_BRAND_VOICE_PER_MIN` | Default `10` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_RATE_LIMIT_BRAND_VOICE_PER_MIN' \|\| echo 'not set (default 10)'` |
| `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` | Default `30` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_RATE_LIMIT_POST_GENERATION_PER_MIN' \|\| echo 'not set (default 30)'` |
| `AI_TRIAL_BRAND_VOICE_ATTEMPTS` | Default `3` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_TRIAL_BRAND_VOICE_ATTEMPTS' \|\| echo 'not set (default 3)'` |
| `AI_TRIAL_POST_CAP` | Default `50` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_TRIAL_POST_CAP' \|\| echo 'not set (default 50)'` |
| `AI_TRIAL_CAMPAIGN_CAP` | Default `1` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_TRIAL_CAMPAIGN_CAP' \|\| echo 'not set (default 1)'` |
| `AI_WEBSITE_FETCH_TIMEOUT_MS` | Default `5000` — set only if overriding | ☐ `vercel env ls production \| grep '^AI_WEBSITE_FETCH_TIMEOUT_MS' \|\| echo 'not set (default 5000)'` |
| `AI_WEBSITE_FETCH_MAX_BYTES` | Default `512000` (512 KB) — set only if overriding | ☐ `vercel env ls production \| grep '^AI_WEBSITE_FETCH_MAX_BYTES' \|\| echo 'not set (default 512000)'` |
| `POST_GENERATION_POLL_MAX_SECONDS` | Default `120` — set only if overriding | ☐ `vercel env ls production \| grep '^POST_GENERATION_POLL_MAX_SECONDS' \|\| echo 'not set (default 120)'` |
| `POST_GENERATION_SESSION_STALE_MINUTES` | Default `15` — set only if overriding | ☐ `vercel env ls production \| grep '^POST_GENERATION_SESSION_STALE_MINUTES' \|\| echo 'not set (default 15)'` |

> Builder note: regenerate this table by walking `serverSchema` + `publicSchema` in `/lib/config.ts`. Any var present in the schema but absent here is a gap; any var here that is absent from the schema is a stale entry to remove.

---

## 2. Database

- [ ] **Migrations applied through latest.** Run from a workstation with `DATABASE_URL` set:
  ```
  psql "$DATABASE_URL" -c "select max(version) from supabase_migrations.schema_migrations;"
  ```
  Expected: matches the highest-numbered file in `/supabase/migrations/`.
- [ ] **PITR enabled.** Supabase Dashboard → Database → Backups → Point in Time Recovery toggled on (requires Pro plan).
- [ ] **RLS spot-check** — every table named in ADR 0001 §B has RLS enabled. Verification query:
  ```sql
  SELECT n.nspname, c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN (
       'businesses', 'brand_voices', 'social_accounts', 'campaigns',
       'posts', 'post_metrics', 'engagement_inbox', 'trial_state', 'ai_usage',
       'billing_events', 'post_generation_sessions',
       'auth_rate_limits', 'cron_health'
     )
   ORDER BY c.relname;
  ```
  Expected: every row's `relrowsecurity = t`.
- [ ] **Service-role-only tables have RLS enabled with no policies for `authenticated`:** `ai_usage`, `trial_state`, `auth_rate_limits`, `cron_health`, `billing_events` (writes only — read policy may exist).
- [ ] **Vault extension enabled.** Verify `select extname from pg_extension where extname = 'supabase_vault';` returns one row.

---

## 3. Cron

### Trigger source

#### QStash (active at launch)

Setup runbook: `docs/build-guide/runbooks/qstash-setup.md`

- [ ] **`CRON_TRIGGER=qstash` set in production env.**
  ```
  vercel env ls production | grep CRON_TRIGGER
  ```
- [ ] **`QSTASH_CURRENT_SIGNING_KEY` set in production env.**
  ```
  vercel env ls production | grep QSTASH_CURRENT_SIGNING_KEY
  ```
- [ ] **`QSTASH_NEXT_SIGNING_KEY` set in production env.** (Both keys required — Zod superRefine rejects boot if either is absent when `CRON_TRIGGER=qstash`.)
  ```
  vercel env ls production | grep QSTASH_NEXT_SIGNING_KEY
  ```
- [ ] **`CRON_SECRET` set in production env, ≥ 32 characters.** Required even in QStash mode — Bearer auth remains the fallback for local-dev curl paths and the dev-bypass tests. `/lib/config.ts` rejects shorter values at boot in production.
  ```
  vercel env ls production | grep CRON_SECRET
  ```
- [ ] **Core schedules visible in Upstash console** → QStash → Schedules, all status Active:
  - publish (`*/10 * * * *`)
  - sync-metrics (`0 * * * *`)
  - process-deletions (`0 3 * * *`, retries=0 — see `docs/build-guide/runbooks/qstash-setup.md` Step 2b)
  - capture-learning (`0 * * * *`, ADR 0018 §9.2 — see `docs/build-guide/runbooks/qstash-setup.md` Step 2c)
- [ ] **Email cron schedules visible** in Upstash console: `drain-email-outbox` (`* * * * *`) and `trial-warnings` (`0 9 * * *`), status Active.
- [ ] **First production tick observed** in Vercel logs with `triggeredBy: 'qstash'`:
  - `/api/cron/publish` — look for `{"kind":"publish-tick","triggeredBy":"qstash",...}` within 10 minutes of deploy.
  - `/api/cron/sync-metrics` — look for `{"kind":"metrics-sync-tick","triggeredBy":"qstash",...}` within the first hour. Expected at launch: `synced=0, skippedNotImplemented=N, errors=0` (ADR 0006 §1 — wired-but-inert is healthy).
  - `/api/cron/drain-email-outbox` — look for `{"kind":"email.drain.tick","triggeredBy":"qstash",...}` within the first minute. Expected on a quiet queue: `claimed=0, sent=0, retried=0, failed=0, suppressed=0`.
  - `/api/cron/process-deletions` — look for `{"kind":"deletion.tick.end","triggeredBy":"qstash",...}` at 03:00 UTC. Expected at launch: `claimed=0, purged=0, retried=0, abandoned=0`.
  - `/api/cron/capture-learning` — look for `{"kind":"learning.tick","triggeredBy":"qstash",...}` within the first hour. Expected on a quiet queue: `claimed=0, classified=0, patternsUpserted=0, summarized=0, abandoned=0, retrying=0`.
- [ ] **Drain-email-outbox smoke test.** Manually insert a row into `email_outbox` (`status='pending'`, `next_attempt_at=now()`, `recipient` = a real address you control, `kind='trial-warning-t3'`). Wait up to 90 seconds for the next cron tick. Confirm `status='sent'` and `provider_message_id IS NOT NULL`:
  ```sql
  select id, status, provider_message_id, sent_at
  from email_outbox
  where recipient = '<your-test-address>'
  order by created_at desc
  limit 1;
  ```
- [ ] **`cron_health` rows present** after first tick:
  ```sql
  select * from cron_health;
  ```
  Expected: two rows (`publish`, `metrics-sync`) with recent `last_seen_at`.

#### Vercel Cron (reserved — not active at launch)

Restore runbook: `docs/build-guide/runbooks/vercel-cron-restore.md`

Not configured at launch (Vercel Hobby plan). When the project upgrades to Vercel Pro, follow the restore runbook to swap back to Vercel Cron as the trigger source.

---

## 4. Sentry

- [ ] **DSN in production env** (`SENTRY_DSN`, public scope).
- [ ] **`SENTRY_AUTH_TOKEN` in production BUILD env only.** Vercel dashboard → Settings → Environment Variables → set the variable with **Build** environment scope checked, NOT Runtime. Runtime exposure is a security finding.
- [ ] **First release tagged.** Sentry → Releases shows a release matching `VERCEL_GIT_COMMIT_SHA` for the first prod deploy, with source maps uploaded.
- [ ] **First error captured intentionally.** One of:
  - A throwaway `/api/_test-sentry` route that throws, then DELETED before merging the release commit, OR
  - One-off via Sentry CLI: `npx sentry-cli send-event -m "launch smoke test"`.
  Verify the event appears in Sentry → Issues; verify the source map symbolicates to a file in `/app/api/_test-sentry/route.ts` (or equivalent), not a minified chunk.
- [ ] **Cron monitors visible** in Sentry → Crons: `publish-tick` and `metrics-sync-tick` with a green check-in within the expected window.
- [ ] **Scrub smoke test.** Trigger a Sentry event from a handler that has a vault-token-shaped payload in scope (synthetic — do NOT use a real token). Verify the event in Sentry shows `[Filtered]` for any key matching `REDACTED_KEYS` (ADR 0007 §3.3).
- [ ] **Circuit-breaker procedure documented.** If Sentry reports >1K events in 24h, take ONE of these actions in order:
  1. Identify the dominant issue group; if a single group accounts for >50% of events, add it to `IGNORE_ERRORS` (ADR 0007 §3.4) and redeploy.
  2. If multiple groups dominate, set `tracesSampleRate = 0` in the relevant Sentry config files and redeploy (errors-only mode).
  3. If still over budget, set `SENTRY_DSN` to empty string in prod env and redeploy (kill switch); accept blindness for the rest of the billing month while the underlying bug is fixed.

  None of these are silent; each is a deliberate deploy.

---

## 5. Security headers

- [ ] Static headers present on the homepage. Run from a workstation:
  ```
  curl -sI https://<prod-domain>/ | grep -i 'strict-transport'
  curl -sI https://<prod-domain>/ | grep -i 'x-content-type-options'
  curl -sI https://<prod-domain>/ | grep -i 'x-frame-options'
  curl -sI https://<prod-domain>/ | grep -i 'referrer-policy'
  curl -sI https://<prod-domain>/ | grep -i 'permissions-policy'
  ```
  Each must return a non-empty line matching the value in ADR 0007 §4.4.
- [ ] **HSTS header confirms ABSENCE of `preload`** (deliberate per ADR 0007 §4.4):
  ```
  curl -sI https://<prod-domain>/ | grep -i 'strict-transport'
  ```
  Expected: `max-age=63072000; includeSubDomains` (no `preload` token).
- [ ] **CSP Report-Only smoke test.** Load the dashboard in a logged-in browser, open devtools → Console. Confirm **zero** `Content Security Policy ... refused` warnings AND zero red-text `Refused to ...` messages. If any appear, fix the source before flipping `CSP_ENFORCE`.
- [ ] **CSP nonce smoke test.** View-source on a Server-rendered page (e.g. `/en/login`). Confirm Next.js hydration `<script>` tags carry `nonce="..."`, and the nonce value is non-empty and 22 characters (ADR 0007 §4.2). Repeat in an Incognito tab — the nonce must be different.
- [ ] **`Content-Security-Policy-Report-Only` header present** on the same response, **NOT** `Content-Security-Policy`:
  ```
  curl -sI https://<prod-domain>/en/login | grep -i 'content-security-policy'
  ```
- [ ] **Schedule the CSP_ENFORCE flip — Day 7 reminder.** Criterion: 24 consecutive hours with zero events on the CSP report-uri stream in Sentry. When met, set `CSP_ENFORCE=true` in prod env and redeploy.
- [ ] **Speed Insights events visible** in the Vercel dashboard within 10 minutes of first production page load.
- [ ] **Analytics events visible** in the Vercel dashboard within 10 minutes of first production page load.
- [ ] **Neither integration produces a CSP report-uri event** (allow-list in ADR 0007 §4.3 is correct).

---

## 6. Stripe live-mode flip

**Ordered steps. Do not reorder.**

1. [ ] Create **Products + Prices** in **live mode** in the Stripe dashboard (one product per plan: Plus, Pro; one recurring monthly Price each).
2. [ ] Set `STRIPE_SECRET_KEY` to the **live** key (`sk_live_…`) in production env.
3. [ ] Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the **live** publishable key (`pk_live_…`) in production env.
4. [ ] Create **webhook endpoint** in Stripe → Webhooks (live mode), pointing at `https://<prod-domain>/api/stripe/webhook`. Subscribe to the events `lib/stripe/webhook.ts` handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. [ ] Copy **live Price IDs** into env: `STRIPE_PRICE_ID_PLUS`, `STRIPE_PRICE_ID_PRO`. Verify they match the Products created in step 1 by reading `lib/stripe/products.ts` and confirming the lookup map resolves both `plus` and `pro`.
6. [ ] **Deploy** (Vercel triggers a fresh build with the new env vars baked in).
7. [ ] **Test charge with a real €1 product**, then **refund immediately** via the Stripe dashboard. Verify the `billing_events` row is recorded with `processed_outcome = 'applied'` and the business's `plan` updates correctly.

---

## 7. Auth and rate limit

- [ ] **`SUPABASE_SERVICE_ROLE_KEY` rotated within the last 90 days.** Rotation procedure: Supabase Dashboard → Settings → API → Reset service_role key → copy → update Vercel env var → redeploy → verify cron tick succeeds with the new key.
- [ ] **First signup smoke.** Create a fresh account with a work-domain email. Verify: signup succeeds → lands on `/{locale}/onboarding` → first onboarding step renders.
- [ ] **Rate-limit smoke.** From a single IP, hit signup 10 times in 30 seconds:
  ```
  for i in $(seq 1 10); do
    curl -X POST https://<prod-domain>/en/signup \
         -F "name=Test $i" -F "email=test+$i@example.com" \
         -F "password=password123ABC" -F "company=Test" -F "locale=en" \
         -o /dev/null -s -w "%{http_code}\n"
  done
  ```
  Expected: the **6th** request lands on the per-IP signup cap (5/min). Verify the response renders the `errors.rate_limit` form state (HTML inspection of the response body).
- [ ] **Per-email rate-limit smoke** (login). From a single IP, hit login 6 times with the same email + wrong password. Expected: the **6th** rejects via the per-email bucket (capacity 5 / 15 min).
- [ ] **`auth_rate_limits` table populated** post-smoke:
  ```sql
  select bucket_key, tokens, last_refill from auth_rate_limits order by last_refill desc limit 10;
  ```

---

## 8. Dev-bypass header sweep

- [ ] **No production code path honours `X-Cron-Dev-Trigger` when `NODE_ENV === 'production'`.**
  ```
  grep -rn "X-Cron-Dev-Trigger" app/ lib/
  ```
  Every match must be inside an `if (NODE_ENV !== 'production')` guard (or in a test file).
- [ ] **`process.env.NODE_ENV` is only read inside `/lib/config.ts`.**
  ```
  grep -rn "process.env.NODE_ENV" app/ lib/ proxy.ts next.config.ts
  ```
  Outside `/lib/config.ts`, every hit is a manual audit. Acceptable callers documented in CLAUDE.md: `next.config.ts` (build-time) and the Sentry init files (runtime, per ADR 0007 §3.1 where the env is read via `config.public.SENTRY_ENVIRONMENT`, which itself defaults from `VERCEL_ENV`, not `NODE_ENV`). Any other hit is a finding.
- [ ] **`process.env.*` outside `/lib/config.ts`.** Acceptable: `next.config.ts` for `SENTRY_AUTH_TOKEN` (ADR 0007 §3.2). All other matches are findings.
  ```
  grep -rn "process\.env\." app/ lib/ proxy.ts next.config.ts | grep -v 'lib/config.ts'
  ```
- [ ] **Sentry scrubEvent route-path exclusion verified** (ADR 0007 §3.3 update E5). A synthetic Sentry event with `request.url` set to `'/api/stripe/webhook'` is dropped by `scrubEvent`. Unit test must exist; no production call needed.
  ```
  grep -rn "scrubEvent\|stripe.*webhook\|route.*exclusion" lib/
  ```
  Confirm the relevant unit test covers this assertion and passes.

---

## 9. Legal and ops slots

**Not engineering — named here so they are not forgotten.**

- [ ] **Privacy policy** live at `/privacy` (or `/{locale}/privacy`).
- [ ] **Terms of service** live at `/terms` (or `/{locale}/terms`).
- [ ] **Subprocessors page** live at `/subprocessors` (ADR 0010 §14 — new route, Builder session required).
- [ ] **DPA available on request** — `privacy@sosh.app` receives and responds. No public URL; reference in Privacy Policy footer.
- [ ] **Status page URL** configured (slot only — record where it lives once chosen).
- [ ] **Abuse contact email** live: `abuse@sosh.app` — receives mail.
- [ ] **Support email** live: `support@sosh.app` — receives mail.
- [ ] **Security contact** live: `security@sosh.app` (or `.well-known/security.txt`).
- [ ] **Privacy contact** live: `privacy@sosh.app` — receives GDPR data-subject requests and DPA requests.
- [ ] **Legal contact** live: `legal@sosh.app` — receives DPA signed-copy requests (may alias to `privacy@sosh.app`).

### ADR 0010 — Legal surface (gated items)

These items are required by ADR 0010 and are not yet in the codebase. Each blocks the Stripe live-mode flip.

- [ ] **Counsel ratification gate.** A lawyer must review the ADR 0010 prose before it ships in `content/legal/`. Redlines come back as a correction PR. Blocks §6 (Stripe live-mode flip). Record sign-off date here: `<fill>`.
- [x] **`/subprocessors` route.** `content/legal/subprocessors.en.mdx` transcribed (ADR 0010 §14 + A1 deltas). Route live at `app/[locale]/(marketing)/subprocessors/page.tsx`. Footer link "Subprocessors" added (Session 17B).
- [x] **Legal MDX transcription.** `content/legal/terms.en.mdx` and `content/legal/privacy.en.mdx` transcribed from ADR 0010 §12/§13 with all A1 deltas applied. `evidenceRef: 5f7a2e4` set in all three files (Session 17B).
- [x] **Vault deletion Sentry alert.** Silent `catch {}` blocks in `lib/db/social-accounts.ts` replaced with `captureException(err, { tags: { operation: 'vault_delete_secret' } })` (Session 17B). (A1.4/T11)

**From A1.2 (Path A — no AI training at launch):**
- [ ] Confirmed: no `ai_training_opt_in` column exists in production schema (no migration required at launch). (A1.2)

**From A1.4 / T4 (deletion infrastructure — launch blockers):**
- [x] 30-day hard-delete cron for `business_deletion_requests` deployed and executing on schedule in production. Migration `20260615200000_deletion_cron_state_machine.sql` applied (Session 18B-1). Orchestrator at `lib/deletion/orchestrator.ts`, route at `app/api/cron/process-deletions/route.ts`, QStash schedule `0 3 * * *` (retries=0). (A2/D2.9)
- [ ] `auth_rate_limits` TTL purge cron deployed and executing on schedule in production. (Pending — backlog session.)
- [ ] In-app Delete Account flow (Settings → Delete Account) shipped, with email-verification round-trip, writing into `business_deletion_requests`. (Pending — backlog session.)
- [ ] Amendment A2 to ADR 0010 swapping §13 §9 Erasure prose from email-based to in-app-based wording, applied after the in-app flow is live.

**From A1.7 (Anthropic DPF):**
- [ ] Anthropic PBC's current EU-US DPF certification verified at dataprivacyframework.gov within 30 days of go-live.

**From A1.10 (Cookie inventory):**
- [ ] Cookie inventory inspection: confirmed only `sb-<ref>-auth-token` is set in staging; no banner needed. [VERIFY V10, V11, V12]

**From A1.11 (Svix — client-verify mode):**
- [ ] Svix SDK configured in client-verify mode only; `SVIX_CLIENT_VERIFY=true` (or equivalent SDK flag) confirmed in production environment.

**From §16 (entity gate):**
- [ ] All `[LEGAL ENTITY]` placeholders in `content/legal/*.mdx` replaced with the actual incorporated legal entity name after counsel ratification.

### Transactional Email (ADR 0008)

#### DNS / sender authentication (mail.sosh.app)

- [ ] Resend domain `mail.sosh.app` added and verified
- [ ] SPF record published for `mail.sosh.app`
- [ ] DKIM record(s) published for `mail.sosh.app`
- [ ] DMARC policy published for the root domain
- [ ] `From: hello@mail.sosh.app` and `Reply-To: support@sosh.app` confirmed in a live send

#### Supabase Auth SMTP relay

- [ ] Supabase Auth custom SMTP configured to Resend (host, port, credential)
- [ ] Auth sender set to `hello@mail.sosh.app`
- [ ] Auth templates re-styled on-brand (confirm-signup, password-reset, change-email)
- [ ] NOTE: auth emails are EN-only at launch (accepted wart — ADR 0008 §13)

#### Resend webhook

- [ ] Resend webhook endpoint registered → `/api/webhooks/resend`
- [ ] `RESEND_WEBHOOK_SECRET` set in Vercel env (production)
- [ ] Signature verification confirmed (invalid signature → 400)

#### Data preconditions

- [ ] `email_suppressions` table empty pre-launch (no stale suppressions)
- [ ] `businesses.total_posts_published` column present (migration applied)

#### Smoke tests — product email (6)

- [ ] `trial-warning-t3` renders + sends (sandbox), visible in Resend dashboard
- [ ] `trial-warning-t1` renders + sends
- [ ] `welcome-to-plan` renders + sends
- [ ] `payment-failed-courtesy` renders + sends
- [ ] `first-post-published` renders + sends
- [ ] Bounce simulation propagates to `email_suppressions`

#### Smoke tests — auth email (3)

- [ ] Signup-confirm relays via Resend SMTP and arrives
- [ ] Password-reset relays and arrives
- [ ] Change-email relays and arrives

---

## 10. Rollback procedure

- [ ] **Vercel "Promote previous deployment".** Vercel Dashboard → Deployments → select the last known-good deployment → `…` menu → Promote to Production. Effective within ~30 seconds.
- [ ] **Migration rollback policy: forward-only** (CLAUDE.md). No `down()` migrations. Data fixes are new migrations. Schema-breaking rollbacks require manual coordination.
- [ ] **`CRON_SECRET` rotation procedure:**
  1. Generate new secret: `openssl rand -base64 48`.
  2. Update `CRON_SECRET` in Vercel production env.
  3. Trigger redeploy (or wait for next git push).
  4. Verify next cron tick succeeds (Vercel logs).
  5. Old secret is invalid as soon as the new deploy is live — Vercel Cron uses the env from the active deployment.
- [ ] **`SUPABASE_SERVICE_ROLE_KEY` compromise procedure:** Supabase Dashboard → Settings → API → Reset service_role key (this is the same operation as routine rotation; speed differs). Update Vercel env, redeploy, monitor for the first successful cron tick. Audit `pg_stat_activity` and Supabase Logs for any pre-rotation queries that look unfamiliar.
- [ ] **`STRIPE_WEBHOOK_SECRET` compromise procedure:** Stripe Dashboard → Webhooks → endpoint → Roll signing secret → update Vercel env → redeploy. Stripe automatically signs with the new secret on next event; old signature rejected by `parseWebhookEvent` (Session 11A).
- [ ] **Sentry DSN compromise procedure:** DSN is public-ish (it ships in the client bundle); compromise is low-impact. Rotate via Sentry → Client Keys → New DSN → swap env → redeploy. Old DSN keeps working until disabled, so no blackout window.

---

## 11. Landing page (ADR 0009)

### Routes & infrastructure
- [x] `/` (homepage) returns 200 and its HTML contains the hero phrase "makes sure your market does"
- [x] `/pricing` returns 200 and renders both plan prices (€99 and €199) sourced from getPlanCapabilities
- [x] `/terms` returns 200 (MDX wrapper + stub paragraph "Last updated: TBD")
- [x] `/privacy` returns 200 (MDX wrapper + stub paragraph "Last updated: TBD")
- [x] OG image route `/og` returns a PNG for `/` (route=home)
- [x] `sitemap.ts` covers all marketing routes (/, /pricing, /terms, /privacy) across en/pt/es
- [x] `robots.txt` allows `/` and references the sitemap
- [x] Locale switcher present in the footer (EN/PT/ES)

### Content & i18n
- [x] `marketing` namespace registered in i18n/request.ts; placeholder `marketing.hero.*` removed from common.json (all locales)
- [x] EN copy matches ADR 0009 §6 verbatim (no Builder-invented strings)
- [x] PT/ES marketing.json present with EN fallback values + `_todo` sentinel; PT/ES routes render in EN without missing-key errors
- [x] No customer logos, testimonials, screenshots, stock photos, or raster images on any route (L5)

### Pricing integrity
- [x] PricingCards renders feature rows from getPlanCapabilities via pricingFeatureRows (no duplicated constant in components/marketing/)
- [x] Same <PricingCards /> renders on `/` and `/pricing` with no prop drift
- [x] Plus = 50 posts / 5 campaigns / LinkedIn + X / basic analytics; Pro = unlimited / unlimited / all 5 channels / advanced / inbox

### Motion, perf, a11y
- [x] All marketing motion lives in the `prefers-reduced-motion: no-preference` block in globals.css (ADR 0009 §17 A1); reduced-motion renders sections instantly in place and anchor links jump instantly
- [ ] First-load JS for marketing routes ≤ 90 KB gz; zero client animation libraries (`motion` removed per ADR 0009 §17 A1) <!-- BLOCKED: npm run build fails at TS check on pre-existing ECC Remotion error; Turbopack compilation succeeds but route table not printed; verify when ECC issue resolved -->
- [ ] LCP < 1.8s, CLS < 0.05, INP < 200ms on `/` (lab check pre-launch) <!-- BLOCKED: requires successful production build + Lighthouse run -->
- [x] Single <h1>, semantic landmarks, skip-to-content link, focus rings continuous with ADR 0007 §B7
- [x] Vercel Analytics only; no cookie-consent banner (no third-party cookies/pixels added)

### Tests
- [x] Route smoke test green (5 routes 200; hero phrase + price strings present; legal links resolve)
- [x] PricingCards unit test green (reads getPlanCapabilities, renders both plans)

## 12. Content Calendar (ADR 0012)

> **Context:** ADR 0012 Rev B (month-grid content calendar — drag-to-reschedule, business-tz aware). Shipped across Sessions 20B (build) → 20C (review) → 20D-1–20D-5 (correction passes). See `docs/current-phase.md` Session 20 entry for the full build log.

- [x] Data layer: `listPostsForCalendar`, `reschedulePost`, `reschedulePostsBatch` (atomic RPC, SECURITY INVOKER, RLS-gated) in `lib/db/posts.ts`.
- [x] Month-grid UI: `CalendarView`, `MonthGrid`, `DayCell`, `CampaignDayBox`, `PostDayPanel`, `PostRow` — split-pane layout, dnd-kit drag-to-reschedule with full keyboard parity (dedicated drag-handle button, not shadowed by the box's own Enter/Space).
- [x] Business-timezone correctness: `getTodayKeyInTz`, `toUtcIso()` sweep (no raw `.toISOString()`), off-UTC DST test coverage.
- [x] Accessibility: WCAG AA 8-hue CVD-safe campaign palette, localized aria-labels (no raw ISO dates exposed to AT), Edit action gated to `draft`/`approved` only.
- [x] Observability: id-only JSON log lines (`reschedule_post`, `reschedule_group`, `reschedule_rejected{reason}`) + id-only `Sentry.captureException` tags — no content/PII.
- [x] Hardening: `approvePost` belt-and-suspenders `business_id` predicate (calendar caller only; other callers unaffected); `buildPlatformPostUrl` URL-injection fix (`encodeURIComponent`).
- [x] i18n: `calendar.json` complete in en/pt/es.
- [ ] **Deferred — stays parked:** single-post creation from the calendar toolbar ("New post"). Currently an inline coming-soon message gated by the `CREATE_POST_DISABLED` constant in `CalendarToolbar.tsx`. Not a launch blocker — posts are created via the existing campaign-generation flow; calendar-native single-post authoring is a future-phase enhancement.

## 13. Seats & Permissions (ADR 0013)

> **Context:** ADR 0013 Rev B (two-axis role×capability model, DB-enforced seat cap) — Session 21A (build) → 21A-D (correction pass). ADR 0014 (Flow & Surface, built on 0013) — Session 21B (resolver, invite flow, `/settings/team`, capability retrofit, overage UX) → 21C (approver inbox), each through its own review + correction pass. Session 21 (21A + 21B + 21C) is CLOSED. See `docs/current-phase.md` Session 21 entry for the full build log.

- [x] Multi-seat backend: `business_members` table, `get_user_business_ids()` widened to owner ∪ active members, `user_can(business_id, capability)` DEFINER helper, role-aware write policies on `posts`/`campaigns`/`social_accounts`.
- [x] Seat cap DB-enforced: `plan_max_seats()` + `enforce_seat_cap` BEFORE INSERT trigger — the real boundary, not the app-layer echo.
- [x] Owner membership provisioning: M7 one-time backfill (pre-existing businesses) **plus** the go-forward `ensure_owner_membership` AFTER INSERT DEFINER trigger (M9, 21A-D/MAJOR-1) — every business created from here on auto-provisions its owner's `business_members` row; without M9 the count would have silently drifted for every new business.
- [x] Invite/accept: `accept_invite` DEFINER RPC — email-match, DB-side 7-day expiry, double-membership pre-check.
- [x] GDPR erasure: `purge_business` explicit `business_members` delete (belt-and-suspenders over cascade).
- [x] Test coverage: read-blast-radius matrix (businesses/posts/campaigns/social_accounts/post_metrics × 6 actors), RLS USING/WITH CHECK-per-command audit, invited-row visibility, third-party accept_invite replay, authenticated-admin seat-cap path, status CHECK enum lockdown.
- [x] Invite email flow: `team-invite` `EmailKind` through the existing Resend outbox, `/invite/accept?token=` route (signed-token verify → `accept_invite` RPC), sign-up email pre-filled + locked to the invited address, anti-enumeration accept copy. ADR 0014 §3–§4 (Session 21B).
- [x] `/settings/team` UI: member list, invite form, role change (inline confirm), soft revoke/remove (explicit dialog), seat meter (Normal / Unlimited / At-cap / Overage-locked states with distinct CTAs), invite resend/re-issue. ADR 0014 §5 (Session 21B).
- [x] Approver quick-approve inbox: `/approvals`, role-gated to approver + admin, single + batch approve wired to the existing `approvePostAction`/`bulkApprovePostsAction`/`skipPostAction`, reject/skip, campaign + platform filters, WCAG-AA Skip-label contrast, overflow honesty signal past the 200-row cap. ADR 0014 §9 (Session 21C, through the E1–E3 correction pass).

## 14. Test-execution integrity & CI gates (ADR 0015)

> **Context:** ADR 0015 (Session 22 W1) closed the covered≠executed gap: the app-layer Vitest suite had no CI job, and eleven per-suite integration-test flags could silently empty `supabase/__tests__` to zero tests while still reporting green. Rows below are ticked only against what the committed workflow/config files actually do — not against aspiration. See `docs/current-phase.md` Session 22 entry for the db-tests three-green tally.

- [x] `app-tests.yml`: standalone workflow, runs on every push to `master` and every PR, independent of the Supabase stack (`tsc --skipLibCheck` → `eslint` → `vitest run app/ lib/ components/`).
- [x] `db-tests.yml`: `supabase/config.toml` disables `[studio]`, `[inbucket]`, `[storage]`, `[edge_runtime]` (grep-clean against `supabase/__tests__` usage).
- [x] `db-tests.yml`: Postgres memory knobs (`shared_buffers=256MB`, `max_connections=50`, `work_mem=8MB`) set via `config.toml`'s `[db.settings]` and explicitly verified (`SHOW ...`) before `supabase db reset` — the job fails and stops if a knob didn't stick.
- [x] `db-tests.yml`: all eleven `*_INTEGRATION_TEST_ENABLED` per-suite flags deleted; every `supabase/__tests__` suite runs unconditionally whenever the DB env is present.
- [x] `db-tests.yml`: skip-guard (`scripts/ci/assert-no-empty-suite.mjs`) fails the job on an invisible (zero/all-skipped) suite OR any genuinely red test; no `|| true` / `continue-on-error` on any gate step.
- [x] `db-tests.yml`: OOM failure diagnostics (`supabase status`, `docker inspect`/`logs`, `free -h`, `dmesg`) persisted via `actions/upload-artifact` on failure, not just scrolled off the live log.
- [x] `vitest.config.ts`: explicit `include` scopes a bare `vitest run` to `app/**`, `lib/**`, `components/**`, `supabase/__tests__/**` — the single source of truth for "the SOSH suite."
- [x] `package.json`: `typecheck` / `test:app` / `test:db` are the only sanctioned entrypoints (no inline command drift between local dev and CI).
- [x] `ROLE-TEAM-ECHO`: Tier-2 regression test (`settings/team/actions.test.ts`) asserts all four team actions return the typed `errors.forbidden` denial when `canServer` is false, before any DB call; Tier-1 (`user-can-matrix.test.ts`) independently proves `manage_members` resolves `false` for every non-admin role — the echo is not the boundary.
- [ ] `app-tests` configured as a **required** branch-protection check on `master` (workflow exists and runs; GitHub branch-protection settings are not committed config and were not verified from the repo).
- [ ] `db-tests` promoted from advisory to required — gated on **3 consecutive full-green runs** (`CI-DB-SUITE-STABLE`); tally is **0/3** as of Session 22 close (`docs/current-phase.md`).

## 16. Postiz removal

> **Context:** ADR 0010 Amendment A1 (2026-06-13) committed to removing Postiz in favour of direct LinkedIn and X API integrations. These rows track complete removal — a half-removal leaves dead code that future audits read as "we use Postiz."

- [ ] `lib/social/postiz-provider.ts` deleted from the repo.
- [ ] `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` removed from `lib/config.ts`, `.env.local.example`, and Vercel/Supabase production env vars.
- [ ] `lib/social/registry.ts` confirmed to route exclusively to the direct LinkedIn and X providers; no Postiz code path reachable.
- [ ] ESLint `no-restricted-imports` rule for `postiz-provider` removed (rule is moot once the file is gone).
- [ ] Integration test `POSTIZ_INTEGRATION_TEST_ENABLED` gate and any associated tests removed (`lib/social/__integration__/postiz-provider.integration.test.ts`, `lib/social/__tests__/postiz-provider.test.ts`).
- [ ] `current-phase.md` and `CLAUDE.md` references to Postiz archived to "Historical decisions" or removed.
- [ ] `grep -r postiz` against the repo returns no matches outside `/docs/decisions/` historical ADRs.

---

## Cross-reference

This checklist enforces the contracts established in:

- **ADR 0001** §B (RLS spot-check), §C (service-role-only writes), §D (Vault).
- **ADR 0002** §3 (SocialProviderError redaction — refactored to shared `REDACTED_KEYS` per ADR 0007 §3.3).
- **ADR 0005** §12 (cron route auth), §14 (`CRON_SECRET` minimum 32 chars).
- **ADR 0006** §9 (metrics cron route — same auth pattern), §1 (wired-but-inert at launch is healthy).
- **ADR 0007** all sections — this checklist is the operational counterpart of that ADR.
- **Session 11A** (Stripe webhook idempotency).
