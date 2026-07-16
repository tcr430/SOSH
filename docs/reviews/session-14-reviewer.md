  Session 14B Reviewer Audit — ADR 0008 Transactional Email
  Section / Check: A1 EmailProvider/SendEmailInput/Result shape
  Status: ✅  File:Line: lib/email/types.ts:14-30
  Note: Exact match to ADR §4.
  ────────────────────────────────────────
  Section / Check: A2 EmailKind = exactly 5 values
  Status: ✅
  File:Line: lib/email/types.ts:1-6
  Note: No extras/missing.
  ────────────────────────────────────────
  Section / Check: A3 REDACTED_KEYS reference equality + test
  Status: ✅
  File:Line: lib/email/errors.ts:1-3, __tests__/errors.test.ts:6-9
  Note: expect(emailRedactedKeys).toBe(REDACTED_KEYS) passes.
  ────────────────────────────────────────
  Section / Check: A4 ErrorCode has all 6 codes inc. suppressed
  Status: ❌
  File:Line: lib/email/errors.ts:5-10
  Note: Only 5 — suppressed omitted.
  ────────────────────────────────────────
  Section / Check: A5 Registry mirrors social (cached singleton + reset)
  Status: ✅
  File:Line: lib/email/registry.ts:6-19
  Note: _resetEmailProviderForTests.
  ────────────────────────────────────────
  Section / Check: A6 ESLint resend boundary rule
  Status: ❌
  File:Line: eslint.config.mjs (all)
  Note: No rule banning resend outside resend-provider.ts. ADR §4 mandate absent.
  ────────────────────────────────────────
  Section / Check: A7 index.ts hides provider impls
  Status: ✅
  File:Line: lib/email/index.ts:1-4
  Note: Only registry getter + types.
  ────────────────────────────────────────
  Section / Check: A8 Idempotency-Key header == row id
  Status: ✅
  File:Line: resend-provider.ts:62, orchestrator.ts:91
  Note: Passed as 2nd-arg { idempotencyKey }.
  ────────────────────────────────────────
  Section / Check: A9 429→rate_limit with retryAfterSeconds
  Status: ⚠️ 
  File:Line: resend-provider.ts:21-34
  Note: 429 maps to provider_rate_limit but retryAfterSeconds is never extracted from the Retry-After header.
  ────────────────────────────────────────
  Section / Check: A10 Mock failure injection per code
  Status: ✅
  File:Line: mock-provider.ts:22-24
  Note: failNextSend.
  ────────────────────────────────────────
  Section / Check: B1 email_outbox migration exact
  Status: ✅
  File:Line: …_email_outbox.sql:2-37
  Note: All columns/checks/indexes present.
  ────────────────────────────────────────
  Section / Check: B2 dedupe_uq = (biz, kind, coalesce(token,''))
  Status: ✅
  File:Line: …_email_outbox.sql:27-28
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: B3 partial index predicate == claim WHERE
  Status: ✅
  File:Line: …_email_outbox.sql:31-33
  Note: WHERE status='pending'.
  ────────────────────────────────────────
  Section / Check: B4 status machine matches ADR D8
  Status: ✅
  File:Line: lib/db/email-outbox.ts:18-24
  Note: All edges present, no extras.
  ────────────────────────────────────────
  Section / Check: B5 transition enforces legality, throws illegal
  Status: ✅
  File:Line: lib/db/email-outbox.ts:95-97
  Note: Terminals empty → sent→pending throws.
  ────────────────────────────────────────
  Section / Check: B6 RLS: SELECT-own only, no auth writes
  Status: ✅
  File:Line: …_email_outbox.sql:39-45
  Note: Service-role-only writes.
  ────────────────────────────────────────
  Section / Check: B7 claim RPC SECURITY DEFINER + REVOKE/GRANT + search_path
  Status: ✅
  File:Line: …_email_outbox.sql:49-67
  Note: SET search_path = public, pg_temp.
  ────────────────────────────────────────
  Section / Check: B8 claim = UPDATE…IN(SELECT FOR UPDATE SKIP LOCKED)
  Status: ✅
  File:Line: …_email_outbox.sql:54-63
  Note: Race-safe.
  ────────────────────────────────────────
  Section / Check: B9 reapStuckSendingRows folded into janitor
  Status: ✅
  File:Line: lib/db/email-outbox.ts:117, publishing/orchestrator.ts:297
  Note: In runJanitorTick, not a new cron.
  ────────────────────────────────────────
  Section / Check: C1 suppressions PK=email, reason CHECK
  Status: ✅
  File:Line: …_email_suppressions.sql:3-5
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: C2 no authenticated RLS policy
  Status: ✅
  File:Line: …_email_suppressions.sql:10-13
  Note: Service-role only.
  ────────────────────────────────────────
  Section / Check: C3 isEmailSuppressed lowercases
  Status: ✅
  File:Line: lib/db/email-suppressions.ts:23
  Note: .eq('email', email.toLowerCase()).
  ────────────────────────────────────────
  Section / Check: C4 upsert idempotent
  Status: ✅
  File:Line: lib/db/email-suppressions.ts:46-51
  Note: 23505→{inserted:false} (equiv to ON CONFLICT DO NOTHING).
  ────────────────────────────────────────
  Section / Check: C5 enqueue suppressed → direct suppressed row
  Status: ✅
  File:Line: lib/email/enqueue.ts:33
  Note: Never pending. Test at enqueue.test:66.
  ────────────────────────────────────────
  Section / Check: C6 drain re-check → suppressed, no send
  Status: ✅
  File:Line: orchestrator.ts:60-64
  Note: Verified by orchestrator.test:120.
  ────────────────────────────────────────
  Section / Check: C7 webhook_events PK = Resend event id
  Status: ⚠️ 
  File:Line: route.ts:43-47
  Note: Uses svix-id as PK (stable across retries — acceptable equivalent), not payload event id.
  ────────────────────────────────────────
  Section / Check: C8 signature verify → 400
  Status: ✅
  File:Line: webhooks/resend/route.ts:23-37
  Note: Missing/bad → 400.
  ────────────────────────────────────────
  Section / Check: C9 event dedupe → 200, no second write
  Status: ✅
  File:Line: route.ts:49-52, email-webhook-events.ts:32-34
  Note: 23505→inserted:false→200.
  ────────────────────────────────────────
  Section / Check: C10 bounce/complaint write; others no-op 200
  Status: ⚠️ 
  File:Line: route.ts:56-70
  Note: Bounce/complaint handled; but unmodeled types crash (see ❌ below).
  ────────────────────────────────────────
  Section / Check: C (CHECK) event_type CHECK vs raw payload.type
  Status: ❌
  File:Line: …_email_webhook_events.sql:5-10, email-webhook-events.ts:24-29
  Note: event_type: payload.type inserted raw; email.sent/email.delivery_delayed/email.failed are not in the CHECK set
    and not mapped to 'other' → 23514 (not 23505) → unhandled → 500 → Resend retry storm. The 'other' bucket is dead
    code.
  ────────────────────────────────────────
  Section / Check: D1 locale col CHECK en/pt/es NOT NULL
  Status: ✅
  File:Line: …_email_outbox.sql:10-11
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: D2 snapshot at enqueue; drain reads row.locale
  Status: ✅
  File:Line: enqueue.ts:31, orchestrator.ts:69
  Note: Drain never reads businesses.language.
  ────────────────────────────────────────
  Section / Check: D3 mutate-language invariant test
  Status: ⚠️ 
  File:Line: __tests__/enqueue.test.ts:96-106
  Note: Only asserts locale is forwarded; full "mutate then render old locale" test absent. Architecture is sound.
  ────────────────────────────────────────
  Section / Check: D4 Zod validate before render → render_failed
  Status: ✅
  File:Line: render.tsx:19-26
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: D5 render twice (html + plainText:true)
  Status: ✅
  File:Line: render.tsx:38-41
  Note: Not regex-stripped.
  ────────────────────────────────────────
  Section / Check: D6 every (kind,locale) renders
  Status: ✅
  File:Line: templates/__tests__/cross-kind.test.ts
  Note: 5×3 coverage present.
  ────────────────────────────────────────
  Section / Check: D7 subjects < 60 chars all locales
  Status: ✅
  File:Line: i18n/*/email.json
  Note: Longest ~42 chars.
  ────────────────────────────────────────
  Section / Check: D8 full i18n, no TODO/English-in-PT-ES
  Status: ✅
  File:Line: i18n/pt|es/email.json
  Note: Properly localised.
  ────────────────────────────────────────
  Section / Check: D9 getTranslations (not useTranslations)
  Status: ✅
  File:Line: render.tsx:28
  Note: Server API.
  ────────────────────────────────────────
  Section / Check: E1 logo alt="SŌSH"
  Status: ✅
  File:Line: _layout.tsx:81
  Note: Meaningful.
  ────────────────────────────────────────
  Section / Check: E2 CTA is <Button> (semantic <a>)
  Status: ✅
  File:Line: trial-warning-t3.tsx:39
  Note: Not div/table.
  ────────────────────────────────────────
  Section / Check: E3 color-scheme meta tags
  Status: ✅
  File:Line: _layout.tsx:47-48
  Note: Both present.
  ────────────────────────────────────────
  Section / Check: E4 explicit bg + text colour on wrapper
  Status: ✅
  File:Line: _layout.tsx:53-66
  Note: Body + Container both set.
  ────────────────────────────────────────
  Section / Check: E5 body font ≥ 14px throughout
  Status: ⚠️ 
  File:Line: _layout.tsx:97,106
  Note: Footer text is 13px (< 14px). Body/CTA OK.
  ────────────────────────────────────────
  Section / Check: E6 max-width 600px
  Status: ✅
  File:Line: _layout.tsx:66
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: E7 descriptive link text
  Status: ✅
  File:Line: i18n/en/email.json
  Note: "Choose your plan" etc.
  ────────────────────────────────────────
  Section / Check: E8 single CTA
  Status: ✅
  File:Line: templates
  Note: One Button each.
  ────────────────────────────────────────
  Section / Check: E9 plain-text non-empty, not tag-stripped
  Status: ✅
  File:Line: render.tsx:39-41
  Note: react-email plainText from same i18n copy (satisfies §8b in spirit).
  ────────────────────────────────────────
  Section / Check: F1 hard-branch on CRON_TRIGGER
  Status: ✅
  File:Line: drain…/route.ts:12,59,66
  Note: No header heuristic.
  ────────────────────────────────────────
  Section / Check: F2 qstash: POST+sig→200, GET→405
  Status: ✅
  File:Line: route.ts:58-69
  Note: Verified route.test.
  ────────────────────────────────────────
  Section / Check: F3 secret: GET+Bearer→200, POST→405
  Status: ✅
  File:Line: route.ts:32-50,65-67
  Note: timingSafeEqual.
  ────────────────────────────────────────
  Section / Check: F4 dev-bypass only non-prod
  Status: ✅
  File:Line: route.ts:37-46
  Note: Test: prod→401.
  ────────────────────────────────────────
  Section / Check: F5 always 200 happy path; orchestrator swallows
  Status: ✅
  File:Line: route.ts:54-55, orchestrator.ts:140-142
  Note: Outer try/catch.
  ────────────────────────────────────────
  Section / Check: F6 withMonitor exact options
  Status: ✅
  File:Line: orchestrator.ts:46-138
  Note: slug/schedule/margins all match.
  ────────────────────────────────────────
  Section / Check: F7 order: re-check→render→send→transition
  Status: ✅
  File:Line: orchestrator.ts:60-99
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: F8 Idempotency-Key == row.id (mock capture)
  Status: ✅
  File:Line: orchestrator.test.ts:204-211
  Note: Asserted.
  ────────────────────────────────────────
  Section / Check: F9 backoff base·2^(n-1) ±25%, cap 1h OR retryAfter
  Status: ⚠️ 
  File:Line: orchestrator.ts:22-30
  Note: Formula + jitter correct; cap at 3600 applied only to the retryAfter branch — exponential branch is uncapped
    (safe under defaults: max ~480s at attempt 4).
  ────────────────────────────────────────
  Section / Check: F10 exhausted transient → terminal failed
  Status: ✅
  File:Line: orchestrator.ts:104,118-127
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: F11 template_render_failed terminal
  Status: ✅
  File:Line: orchestrator.ts:71-79
  Note: No retry.
  ────────────────────────────────────────
  Section / Check: F12 one email.drain.tick per tick
  Status: ✅
  File:Line: orchestrator.ts:146-152
  Note: All fields + triggeredBy.
  ────────────────────────────────────────
  Section / Check: F13 Sentry only on terminal/exhausted, not transients
  Status: ✅
  File:Line: orchestrator.ts:76,124
  Note: Retried branch never captures.
  ────────────────────────────────────────
  Section / Check: G1 dual-mode auth (== F1–F4)
  Status: ✅
  File:Line: trial-warnings/route.ts
  Note: Identical pattern.
  ────────────────────────────────────────
  Section / Check: G2 schedule 0 9 * * * UTC
  Status: ✅
  File:Line: triggers/trial-warnings.ts:83
  Note: Test asserts.
  ────────────────────────────────────────
  Section / Check: G3 T-3=[+2d,+3d); T-1=[now,+1d)
  Status: ⚠️ 
  File:Line: triggers/trial-warnings.ts:36-62
  Note: T-3 ✅. T-1 uses [now+1d, now+2d), contradicting ADR literal [now, now+1d). Impl is internally consistent and
    matches "ends tomorrow" copy; test pins the impl window. ADR text needs reconciliation.
  ────────────────────────────────────────
  Section / Check: G4 plan='trial' in SQL
  Status: ✅
  File:Line: …find_trial_expiring_between.sql:29
  Note: WHERE b.plan='trial'.
  ────────────────────────────────────────
  Section / Check: G5 deleted_at IS NULL in SQL
  Status: ✅
  File:Line: …find_trial_expiring_between.sql:30
  Note: Present.
  ────────────────────────────────────────
  Section / Check: G6 same-day double-run → deduped
  Status: ✅
  File:Line: triggers/trial-warnings.ts:55-56, test:100
  Note: outcome='deduped' counted.
  ────────────────────────────────────────
  Section / Check: G7 withMonitor slug+schedule+margin 5
  Status: ✅
  File:Line: triggers/trial-warnings.ts:82-88
  Note: Match.
  ────────────────────────────────────────
  Section / Check: H1 enqueue via after()
  Status: ✅
  File:Line: stripe/webhook/route.ts:78,86
  Note: Not synchronous.
  ────────────────────────────────────────
  Section / Check: H2 200 before after() runs
  Status: ✅
  File:Line: route.ts:78-93,124
  Note: Detached.
  ────────────────────────────────────────
  Section / Check: H3 enqueue failure → Sentry tags, response unchanged
  Status: ✅
  File:Line: route.ts:81-83,89-91
  Note: {email_kind, stripe_event_id}.
  ────────────────────────────────────────
  Section / Check: H4 dispatch logic unchanged
  Status: ✅
  File:Line: route.ts
  Note: after() block added post-dispatch only.
  ────────────────────────────────────────
  Section / Check: H5 dedupe_token == event.id
  Status: ✅
  File:Line: triggers/stripe.ts:35,64
  Note: Both kinds.
  ────────────────────────────────────────
  Section / Check: H6 replay → deduped, no 2nd email
  Status: ✅
  File:Line: unique constraint
  Note: 23505 path.
  ────────────────────────────────────────
  Section / Check: I1 total_posts_published int NOT NULL DEFAULT 0
  Status: ✅
  File:Line: …_businesses_total_posts_published.sql:3-4
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: I2 increment RPC SECURITY DEFINER, RETURNING post-incr
  Status: ✅
  File:Line: same:8-20
  Note: REVOKE/GRANT present.
  ────────────────────────────────────────
  Section / Check: I3 RPC once per publish, after status commit
  Status: ❌
  File:Line: publishing/orchestrator.ts:129 vs 214-219
  Note: Called on happy path only — missing from the TOKEN_EXPIRED refresh-retry success path, which still calls
    incrementPublishedCountForCampaign but not the business counter. Contradicts ADR §12 ("both sites").
  ────────────────────────────────────────
  Section / Check: I4 enqueue gated on RETURNING===1
  Status: ⚠️ 
  File:Line: orchestrator.ts:130
  Note: Correct where present — but unreachable on refresh-retry path (see I3).
  ────────────────────────────────────────
  Section / Check: I5 enqueue inside after()
  Status: ✅
  File:Line: orchestrator.ts:132-138
  Note: Failure doesn't fail tick.
  ────────────────────────────────────────
  Section / Check: I6 (biz, kind) unique = 2nd-layer backstop
  Status: ✅
  File:Line: dedupe_uq + dedupe_token=null
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: J1 three canonical log lines, shapes
  Status: ✅
  File:Line: enqueue/orchestrator/webhook
  Note: email.enqueue uses outcome (richer than deduped:bool, per check).
  ────────────────────────────────────────
  Section / Check: J2 Sentry errors only
  Status: ✅
  File:Line: orchestrator
  Note: Transients not captured.
  ────────────────────────────────────────
  Section / Check: J3 recipient never reaches Sentry unredacted
  Status: ⚠️ 
  File:Line: orchestrator:76,124
  Note: Email code attaches no recipient to Sentry; relies on ADR 0007 beforeSend scrubber. Residual risk: provider
  error
     message could embed an address (REDACTED_KEYS is key-based, won't catch a bare address in a string).
  ────────────────────────────────────────
  Section / Check: J4 monitor slugs match §17
  Status: ✅
  File:Line: drain + trial-warnings
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: K1 no any in lib/email
  Status: ⚠️ 
  File:Line: templates/index.ts:31-34
  Note: Two any (props, React.FC) with eslint-disable — registry heterogeneity escape hatch.
  ────────────────────────────────────────
  Section / Check: K2 no process.env outside config.ts
  Status: ✅
  File:Line: —
  Note: All via config.server.*.
  ────────────────────────────────────────
  Section / Check: K3 no console.* beyond canonical
  Status: ⚠️ 
  File:Line: trial-warnings.ts:96
  Note: Extra trial_warnings.tick line (consistent with publish-tick convention, not enumerated in §17). Also benign
    console.warn auth-failure + console.error in publish loop.
  ────────────────────────────────────────
  Section / Check: K4 no direct resend import (ESLint passes)
  Status: ❌
  File:Line: —
  Note: No ESLint rule exists (see A6); boundary respected only by convention.
  ────────────────────────────────────────
  Section / Check: K5 DB writes via lib/db
  Status: ✅
  File:Line: all surfaces
  Note: No raw Supabase in routes/orchestrators.
  ────────────────────────────────────────
  Section / Check: K6 service-role via lazy import
  Status: ✅
  File:Line: enqueue:20, orchestrator:49, triggers, webhook
  Note: await import('@/lib/supabase/service').
  ────────────────────────────────────────
  Section / Check: K7 timestamps via formatISO
  Status: ✅
  File:Line: orchestrator:97,114, email-outbox:123,126
  Note: Correct.
  ────────────────────────────────────────
  Section / Check: K8 migrations forward-only
  Status: ✅
  File:Line: all 4 migrations
  Note: No down().
  ────────────────────────────────────────
  Section / Check: K9 EmailProvider/Kind/Locale from index
  Status: ✅
  File:Line: index.ts:2
  Note: Exported; provider impls hidden.
  ────────────────────────────────────────
  Section / Check: K10 i18n all three locales per kind
  Status: ✅
  File:Line: i18n/*/email.json
  Note: Complete.
  ────────────────────────────────────────
  Section / Check: K11 .env.local.example updated
  Status: ❌
  File:Line: .env.local.example:61
  Note: Only RESEND_API_KEY. Missing RESEND_WEBHOOK_SECRET, EMAIL_PROVIDER, EMAIL_FROM, EMAIL_REPLY_TO + 4 tunables.
  ────────────────────────────────────────
  Section / Check: L1 §19 rows present, correct sections
  Status: ✅
  File:Line: launch-checklist.md:253-294 + §1/§3
  Note: Env→§1, QStash→§3, rest→§9 subsection.
  ────────────────────────────────────────
  Section / Check: L2 no duplicate rows
  Status: ✅
  File:Line: —
  Note: SPF/DKIM/DMARC + env vars appear once.
  ────────────────────────────────────────
  Section / Check: L3 env rows use grep -q pattern
  Status: ✅
  File:Line: launch-checklist.md:35-40
  Note: Consistent.
  ────────────────────────────────────────
  Section / Check: L4 smoke tests concrete
  Status: ✅
  File:Line: launch-checklist.md:281-294
  Note: Per-kind + bounce.
  ────────────────────────────────────────
  Section / Check: §13 No Supabase Auth webhook intercept added
  Status: ✅
  File:Line: —
  Note: Config-only; no code. Correct.
  ────────────────────────────────────────
  Section / Check: §5 transition atomicity
  Status: ⚠️ 
  File:Line: email-outbox.ts:83-114
  Note: read-then-update (not WHERE-guarded UPDATE). Safe because SKIP-LOCKED claim makes the tick the sole owner of a
    sending row.
  ────────────────────────────────────────
  Section / Check: §15 config defaults match ADR
  Status: ⚠️ 
  File:Line: config.ts:31
  Note: EMAIL_SENDING_STUCK_MINUTES default 15, ADR §15 says 10.

  ---
  ❌ Findings — exact fixes

  A6 / K4 — Missing ESLint resend boundary rule

  ADR §4 mandates the resend package be importable only in lib/email/resend-provider.ts. No such rule exists in
  eslint.config.mjs.

  Fix — add a fourth block to the array in eslint.config.mjs (mirror the stripe block at lines 67-84):
  // Ban direct 'resend' import outside lib/email/resend-provider.ts.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["lib/email/resend-provider.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "resend",
          message: "Import from '@/lib/email' instead. The Resend SDK is confined to lib/email/resend-provider.ts (ADR
  0008 §4).",
        }],
      }],
    },
  },
  Add a fixture test that a forbidden import { Resend } from 'resend' outside the provider fails lint (per the
  eslint-no-restricted-imports-exact-package learned skill).

  C (CHECK) — Resend webhook 500-storm on unmodeled event types

  event_type: payload.type is inserted raw; types Resend actually sends that are absent from the CHECK (email.sent,
  email.delivery_delayed, email.failed) raise 23514, which recordWebhookEvent does not catch → 500 → infinite Resend
  retries. The 'other' bucket in the CHECK is never used.

  Fix — normalise before insert in lib/db/email-webhook-events.ts:
  const KNOWN = new Set(['email.bounced','email.complained','email.delivered','email.opened','email.clicked'])
  // ...
  event_type: KNOWN.has(input.event_type) ? input.event_type : 'other',
  (Keep dispatch in the route keyed on the original payload.type so bounce/complaint still resolve.) Add a test:
  payload.type='email.delivery_delayed' → recorded as 'other', returns 200, no suppression write.

  A4 — EmailProviderErrorCode missing suppressed

  ADR §4 lists six codes. Fix — add | 'suppressed' to the union in lib/email/errors.ts:5-10 for ADR fidelity (or amend
  ADR §4 to five, since suppression is modeled as an outbox status, not a provider error — recommend the code-side add
  for the smaller diff).

  I3 / I4 — First-post detection absent from the token-refresh-retry path

  ADR §12 explicitly requires the business-counter increment + first-post enqueue at both publish sites.
  publishing/orchestrator.ts only added it to the happy path (:129); the TOKEN_EXPIRED refresh-retry success branch
  (:214-219) increments the campaign counter but not the business counter, so a business whose first-ever publish lands
  via refresh-retry never increments total_posts_published and never gets first-post-published. The counter then
  mis-fires 0→1 on a later (non-first) post.

  Fix — after markPostPublished/incrementPublishedCountForCampaign at :219, mirror the happy-path block:
  const newCount = await incrementBusinessPublishedCount(client, post.business_id)
  if (newCount === 1) {
    const business = await getBusinessById(client, post.business_id)
    after(async () => {
      try { await enqueueFirstPostPublished({ business, post, postUrl: retryResult.url ?? null }) }
      catch (err) { Sentry.captureException(err, { tags: { email_kind: 'first-post-published', business_id:
  post.business_id } }) }
    })
  }
  Extract the duplicated block into a local helper to avoid drift. Add a test: first publish succeeds only after
  refresh-retry → counter→1, enqueue fired once.

  K11 — .env.local.example incomplete

  Only RESEND_API_KEY present. Fix — append the remaining eight vars with placeholder values and one-line comments:
  RESEND_WEBHOOK_SECRET=whsec_your-resend-webhook-signing-secret
  EMAIL_PROVIDER=mock            # 'resend' in prod; 'mock' for local/tests
  EMAIL_FROM=hello@mail.sosh.app
  EMAIL_REPLY_TO=support@sosh.app
  # Optional tunables (defaults in lib/config.ts):
  # EMAIL_DRAIN_BATCH_SIZE=50
  # EMAIL_MAX_ATTEMPTS=5
  # EMAIL_RETRY_BACKOFF_SECONDS=60
  # EMAIL_SENDING_STUCK_MINUTES=10

  ---
  ⚠️  Findings — recommendations

  - A9 — Extract Retry-After from the Resend 429 response in mapResendError and pass it as the 4th EmailProviderError
  arg, so computeBackoff honours provider guidance. Currently retryAfterSeconds is always undefined on the rate-limit
  path; the exponential fallback is used unconditionally.
  - F9 — Cap the exponential branch: return Math.min(Math.round(jitter), 3600). Harmless at default EMAIL_MAX_ATTEMPTS=5  (max ~480s) but the ADR states "capped at 1 hour"; a config bump removes the cap.
  - §15 / config — Set EMAIL_SENDING_STUCK_MINUTES default to 10 to match ADR §15 (currently 15), or amend the ADR.
  - G3 — Reconcile T-1: implementation uses [now+1d, now+2d); ADR §10 says [now, now+1d). The impl is defensible
  (adjacent to T-3, matches "ends tomorrow" copy) — recommend amending ADR §10 to the implemented windows rather than
  changing code, and updating the §16 test description.
  - C7 / §14 schema — Document that svix-id is the idempotency anchor (not a payload event id) and that the table stores  event_type+payload jsonb rather than the ADR's type+email. Reconcile ADR §14's schema block with the shipped
  migration.
  - J3 — Confirm the ADR 0007 beforeSend scrubber redacts bare email addresses in error message strings (REDACTED_KEYS
  is key-name based). If not, scrub err.message before Sentry.captureException in the drainer, since Resend error text
  can embed the recipient.
  - E5 — Bump footer text from 13px to 14px to honour §8b's "no fixed typography below 14px".
  - K1 — The two any in templates/index.ts are a registry escape hatch; consider a generic KindEntry<P> keyed per kind
  to remove them, or document the exception in CLAUDE.md.
  - D3 — Add the literal §16 invariant test (enqueue pt, mutate businesses.language='es', claim, assert render uses pt)
  to lock the snapshot guarantee end-to-end.
  - §5 transition — Consider the CLAUDE.md atomic WHERE-guard pattern for transitionEmailOutboxRow (e.g. .eq('status',
  expectedCurrent)) to harden against any future non-claimed transition; currently safe via SKIP-LOCKED ownership.

  ---
  Verdict

  Blockers before merge
  - A6/K4 — ESLint resend boundary missing. Cheap, ADR-§4-mandated mechanical guard; add now with a fixture test.
  - I3/I4 — First-post increment+enqueue missing from the token-refresh-retry path. Real correctness bug in the
  already-live publishing worker (counter drift today; mis-fired milestone email once Session 15 lands). Contradicts ADR  §12's explicit "both sites."

  Blockers before flipping Stripe/Resend live (deferrable)
  - C (CHECK) — event_type CHECK + raw payload.type insert → 23514 → 500 retry storm for
  email.sent/email.delivery_delayed/email.failed. Must fix before the Resend webhook is registered and any
  non-bounce/complaint event is subscribed.
  - A9 — 429 Retry-After ignored; fix before live to avoid hammering Resend during rate limits.
  §12's explicit "both sites."

  Blockers before flipping Stripe/Resend live (deferrable)
  - C (CHECK) — event_type CHECK + raw payload.type insert → 23514 → 500 retry storm for
  email.sent/email.delivery_delayed/email.failed. Must fix before the Resend webhook is registered and any
  non-bounce/complaint event is subscribed.
  - A9 — 429 Retry-After ignored; fix before live to avoid hammering Resend during rate limits.
  - K11 — .env.local.example missing 8/9 email vars; complete before the first engineer provisions prod from it.

  Acceptable to defer (open follow-ups)
  - A4 (suppressed code), G3 (T-1 window — recommend ADR amendment, not code change), C7/§14 (schema drift doc
  reconcile), §15 (stuck-minutes default 15 vs 10), F9 (exponential cap), E5 (13px footer), K1 (any escape hatch), D3
  (full invariant test), J3 (verify beforeSend scrubs bare addresses), §5 (atomic transition guard), and the hardcoded
  14-day interval in find_trial_expiring_between.sql.

  Net: the outbox/drainer/dedupe/locale-snapshot/idempotency core is faithful to the ADR and well-tested. The two merge
  blockers are a missing mechanical guard and a copy-paste omission on a secondary publish path; both are small,
  surgical fixes. The webhook CHECK constraint is the highest-severity correctness issue but is dormant until the Resend  webhook goes live.