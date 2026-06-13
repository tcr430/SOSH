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
| Tunables (`PUBLISH_*`, `METRICS_*`, `AI_*`, `POST_GENERATION_*`) | Defaults from `/lib/config.ts` — set only if overriding | ☐ `vercel env ls production \| grep -E '^(PUBLISH_\|METRICS_\|AI_\|POST_GENERATION_)' \|\| echo none-set` |

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
- [ ] **Both core schedules visible in Upstash console** → QStash → Schedules: publish (`*/10 * * * *`) and sync-metrics (`0 * * * *`), status Active.
- [ ] **Email cron schedules visible** in Upstash console: `drain-email-outbox` (`* * * * *`) and `trial-warnings` (`0 9 * * *`), status Active.
- [ ] **First production tick observed** in Vercel logs with `triggeredBy: 'qstash'`:
  - `/api/cron/publish` — look for `{"kind":"publish-tick","triggeredBy":"qstash",...}` within 10 minutes of deploy.
  - `/api/cron/sync-metrics` — look for `{"kind":"metrics-sync-tick","triggeredBy":"qstash",...}` within the first hour. Expected at launch: `synced=0, skippedNotImplemented=N, errors=0` (ADR 0006 §1 — wired-but-inert is healthy).
  - `/api/cron/drain-email-outbox` — look for `{"kind":"email.drain.tick","triggeredBy":"qstash",...}` within the first minute. Expected on a quiet queue: `claimed=0, sent=0, retried=0, failed=0, suppressed=0`.
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
  grep -rn "process.env.NODE_ENV" app/ lib/ middleware.ts next.config.ts
  ```
  Outside `/lib/config.ts`, every hit is a manual audit. Acceptable callers documented in CLAUDE.md: `next.config.ts` (build-time) and the Sentry init files (runtime, per ADR 0007 §3.1 where the env is read via `config.public.SENTRY_ENVIRONMENT`, which itself defaults from `VERCEL_ENV`, not `NODE_ENV`). Any other hit is a finding.
- [ ] **`process.env.*` outside `/lib/config.ts`.** Acceptable: `next.config.ts` for `SENTRY_AUTH_TOKEN` (ADR 0007 §3.2). All other matches are findings.
  ```
  grep -rn "process\.env\." app/ lib/ middleware.ts next.config.ts | grep -v 'lib/config.ts'
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
- [ ] **AI training opt-in migration.** Add `businesses.ai_training_opt_in BOOLEAN NOT NULL DEFAULT false` (ADR 0010 §4, E7 — Path B). Builder session required.
- [ ] **AI training opt-in UI.** Account settings screen must expose a toggle wired to `businesses.ai_training_opt_in`. No retroactive processing of data collected before opt-in.
- [ ] **Deletion jobs.** E6 found zero scheduled deletion jobs. ADR 0010 §5 retention map commits to specific periods. Builder must implement: (a) hard-delete of businesses + cascade 30 days after deletion request; (b) `auth_rate_limits` TTL purge (buckets older than 30 days). Record implementation session: `<fill>`.
- [ ] **Vault deletion Sentry alert.** E5: vault deletion is best-effort (silent catch). Add `captureException` on vault RPC failure so orphaned vault secrets surface in Sentry.
- [ ] **`/subprocessors` route.** New Next.js route + MDX file at `content/legal/subprocessors.en.mdx`. Builder transcribes ADR 0010 §14. Footer link: "Subprocessors".
- [ ] **Legal MDX `evidenceRef` frontmatter.** Each file in `content/legal/` must carry `evidenceRef: 5f7a2e4` (Evidence Pack commit hash). Future PRs must update this ref if evidence changes.

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

## Cross-reference

This checklist enforces the contracts established in:

- **ADR 0001** §B (RLS spot-check), §C (service-role-only writes), §D (Vault).
- **ADR 0002** §3 (SocialProviderError redaction — refactored to shared `REDACTED_KEYS` per ADR 0007 §3.3).
- **ADR 0005** §12 (cron route auth), §14 (`CRON_SECRET` minimum 32 chars).
- **ADR 0006** §9 (metrics cron route — same auth pattern), §1 (wired-but-inert at launch is healthy).
- **ADR 0007** all sections — this checklist is the operational counterpart of that ADR.
- **Session 11A** (Stripe webhook idempotency).
