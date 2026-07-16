Session 11C — Stripe Billing Review (consolidated)
  Findings table

  Section: A1
  Check: Raw req.text(), no req.json() before verify
  Status: ✅
  File:Line: route.ts:13-17
  Fix: —
  ────────────────────────────────────────
  Section: A2
  Check: stripe.webhooks.constructEvent (no hand-rolled HMAC)
  Status: ✅
  File:Line: webhook.ts:35
  Fix: —
  ────────────────────────────────────────
  Section: A3
  Check: Secret via config.server
  Status: ✅
  File:Line: webhook.ts:38
  Fix: —
  ────────────────────────────────────────
  Section: A4
  Check: Sig failure → 400, null body, no reason leak
  Status: ✅
  File:Line: route.ts:31
  Fix: —
  ────────────────────────────────────────
  Section: A5
  Check: runtime = 'nodejs'
  Status: ✅
  File:Line: route.ts:6
  Fix: —
  ────────────────────────────────────────
  Section: A6
  Check: maxDuration explicit (30)
  Status: ✅
  File:Line: route.ts:7
  Fix: —
  ────────────────────────────────────────
  Section: A7
  Check: client_reference_id closed loop (our code sets it, Stripe signs it); customer looked up by index
  Status: ✅
  File:Line: checkout.ts:47 ↔ webhook.ts:55-59
  Fix: —
  ────────────────────────────────────────
  Section: A8
  Check: No tolerance override (SDK 300s default)
  Status: ✅
  File:Line: webhook.ts:35
  Fix: —
  ────────────────────────────────────────
  Section: B1
  Check: event.id is TEXT PK; reinsert → unique violation
  Status: ✅
  File:Line: migration:1-2; billing-events.ts
  Fix: —
  ────────────────────────────────────────
  Section: B2
  Check: Placeholder row written before dispatch (serialization point)
  Status: ✅
  File:Line: route.ts:36-63
  Fix: —
  ────────────────────────────────────────
  Section: B3
  Check: Duplicate preserves original outcome (early 200)
  Status: ✅
  File:Line: route.ts:45-58
  Fix: —
  ────────────────────────────────────────
  Section: B4
  Check: Duplicate → 200 (not 409)
  Status: ✅
  File:Line: route.ts:57
  Fix: —
  ────────────────────────────────────────
  Section: B5
  Check: Crash between record & dispatch
  Status: ⚠️ 
  File:Line: route.ts:42
  Fix: Pre-recorded outcome:'applied' masks crashed events; use 'error' sentinel
  ────────────────────────────────────────
  Section: B6
  Check: Event-ordering / stale price overwrite
  Status: ⚠️ 
  File:Line: webhook.ts:79,140
  Fix: checkout.completed re-retrieves live sub (safe); stale subscription.updated could overwrite — add updated-at guard or document
  ────────────────────────────────────────
  Section: C1
  Check: Service-role via lazy import
  Status: ✅
  File:Line: billing-events.ts, businesses.ts (all await import('@/lib/supabase/service'))
  Fix: —
  ────────────────────────────────────────
  Section: C2
  Check: Route doesn't import anon client
  Status: ✅
  File:Line: route.ts:1-4
  Fix: —
  ────────────────────────────────────────
  Section: C3
  Check: Billing actions use anon client + RLS for ownership
  Status: ✅
  File:Line: actions.ts:13,37
  Fix: —
  ────────────────────────────────────────
  Section: C4
  Check: RLS: SELECT scoped, no authenticated write policy
  Status: ✅
  File:Line: migration:28-34
  Fix: —
  ────────────────────────────────────────
  Section: C5
  Check: setStripeCustomerId blocks customer-ID change
  Status: ✅ (index is the real guard)
  File:Line: businesses.ts
  Fix: Read-then-throw is diagnostic; partial unique index (migration 019) is the atomic guarantee — add comment
  ────────────────────────────────────────
  Section: C6
  Check: Atomic conditional UPDATE (customer_id + deleted_at)
  Status: ✅
  File:Line: businesses.ts
  Fix: —
  ────────────────────────────────────────
  Section: C7
  Check: Migration adds no new index; relies on existing unique partial index
  Status: ✅
  File:Line: migration 019:11-13
  Fix: —
  ────────────────────────────────────────
  Section: D1
  Check: No raw payload in logs — structured summary only
  Status: ✅
  File:Line: route.ts:20-95
  Fix: —
  ────────────────────────────────────────
  Section: D2
  Check: payload jsonb not returned by any anon-callable helper
  Status: ✅
  File:Line: billing-events.ts (only record/update; no SELECT of payload)
  Fix: —
  ────────────────────────────────────────
  Section: D3
  Check: session_id param opaque; success page uses auth session
  Status: ✅
  File:Line: success/page.tsx
  Fix: —
  ────────────────────────────────────────
  Section: D4
  Check: Action errors map to generic keys, no Stripe detail
  Status: ✅
  File:Line: actions.ts:28-29,50-52
  Fix: —
  ────────────────────────────────────────
  Section: D5
  Check: Client imports of /lib/stripe/*
  Status: ⚠️ 
  File:Line: PricingCards.tsx:9,11
  Fix: import type only → erased, no runtime leak today; add typeof window guard to products.ts and/or extend ESLint to ban value-imports
  ────────────────────────────────────────
  Section: E1
  Check: plan values vs CLAUDE.md (50/5 vs 30/2)
  Status: ⚠️  (doc drift, not code bug)
  File:Line: plan.ts:43,53,54
  Fix: Code reflects 2026-05-27 decision; update CLAUDE.md to plus=50 posts/5 campaigns, not the code
  ────────────────────────────────────────
  Section: E1
  Check: trial 50 posts / 1 lifetime campaign; plus platforms = LinkedIn+X; pro = all 5, unlimited
  Status: ✅
  File:Line: plan.ts:40-64
  Fix: —
  ────────────────────────────────────────
  Section: E1
  Check: Enum naming plus vs CLAUDE.md "Starter"
  Status: ⚠️ 
  File:Line: products.ts, CLAUDE.md
  Fix: CLAUDE.md pricing section stale — rename to plus
  ────────────────────────────────────────
  Section: E2
  Check: PLAN_TO_PRICE_ID bijective, no orphans
  Status: ✅
  File:Line: products.ts:5-12
  Fix: —
  ────────────────────────────────────────
  Section: E3
  Check: planForPriceId returns null → ignored_unknown_price
  Status: ✅
  File:Line: products.ts:15; webhook.ts:75,135
  Fix: —
  ────────────────────────────────────────
  Section: E4
  Check: Cancellation → plan='trial'; enforcement reads live business.plan
  Status: ✅
  File:Line: businesses.ts:148; enforcement.ts
  Fix: —
  ────────────────────────────────────────
  Section: F1
  Check: client_reference_id = business.id
  Status: ✅
  File:Line: checkout.ts:47
  Fix: —
  ────────────────────────────────────────
  Section: F2
  Check: subscription_data.metadata.business_id set
  Status: ✅
  File:Line: checkout.ts:48-50
  Fix: —
  ────────────────────────────────────────
  Section: F3
  Check: Concurrent first-checkout → 2 customers
  Status: ⚠️ 
  File:Line: checkout.ts:26-38
  Fix: Phase-1 acceptable; one setStripeCustomerId throws, leaving an orphan Stripe customer — defer to Phase 2
  ────────────────────────────────────────
  Section: F4
  Check: cancel_url on our origin (APP_URL)
  Status: ✅
  File:Line: checkout.ts:46
  Fix: —
  ────────────────────────────────────────
  Section: F5
  Check: automatic_tax enabled (EU VAT)
  Status: ✅
  File:Line: checkout.ts:51
  Fix: —
  ────────────────────────────────────────
  Section: F6
  Check: No trial_period_days — trial lives in app
  Status: ✅
  File:Line: checkout.ts:41-53
  Fix: —
  ────────────────────────────────────────
  Section: G1
  Check: Success page polls session-scoped API, not Stripe
  Status: ✅
  File:Line: success/page.tsx; session-status/route.ts
  Fix: —
  ────────────────────────────────────────
  Section: G2
  Check: Bounded poll (~15s) + fallback
  Status: ✅
  File:Line: success/page.tsx (10×1500ms)
  Fix: —
  ────────────────────────────────────────
  Section: G3
  Check: Upgrade CTA respects auth (anon → not Stripe)
  Status: ✅
  File:Line: actions.ts:15,39
  Fix: —
  ────────────────────────────────────────
  Section: G4
  Check: "Manage billing" hidden when no stripe_customer_id
  Status: ⚠️ 
  File:Line: billing/page.tsx
  Fix: Shown on plan!=='trial' without null-check; fails closed (no_customer) but should be hidden via hasStripeCustomer prop
  ────────────────────────────────────────
  Section: G5
  Check: All billing text in EN/PT/ES, real translations
  Status: ✅
  File:Line: i18n/{en,pt,es}/billing.json
  Fix: —
  ────────────────────────────────────────
  Section: H1
  Check: No any; only unknown = payload
  Status: ✅
  File:Line: —
  Fix: —
  ────────────────────────────────────────
  Section: H1
  Check: event as unknown as Record<…> at call site
  Status: ⚠️ 
  File:Line: route.ts:41
  Fix: Redundant — payload param is unknown; drop the cast
  ────────────────────────────────────────
  Section: H1
  Check: (error as {code?}) narrowing in DB layer
  Status: ⚠️ 
  File:Line: billing-events.ts:36,39,55
  Fix: Use error.message ?? 'Database error'; guard missing message
  ────────────────────────────────────────
  Section: H2
  Check: event.type discriminator; minimal as on data.object
  Status: ✅
  File:Line: webhook.ts:50,120,149,157
  Fix: —
  ────────────────────────────────────────
  Section: H2
  Check: Redundant casts in fingerprint block
  Status: ⚠️ 
  File:Line: webhook.ts:95,103
  Fix: typeof === 'string' guard already narrows; drop both casts
  ────────────────────────────────────────
  Section: H3
  Check: formatISO, no raw toISOString() in new code
  Status: ✅
  File:Line: —
  Fix: —
  ────────────────────────────────────────
  Section: H4
  Check: No process.env outside config.ts
  Status: ✅
  File:Line: (scripts/tests excepted)
  Fix: —
  ────────────────────────────────────────
  Section: H5
  Check: One structured log per code-path
  Status: ✅ (spirit met)
  File:Line: route.ts:20,46,70,85
  Fix: 4 call sites, but exactly one line per event path — acceptable
  ────────────────────────────────────────
  Section: H6
  Check: ESLint no-restricted-imports 'stripe', paths, excludes lib/stripe + tests
  Status: ✅
  File:Line: eslint.config.mjs:67-84
  Fix: —
  ────────────────────────────────────────
  Section: H7
  Check: WHY comments (raw body, dual id, pre-record, no Stripe trial)
  Status: ⚠️ 
  File:Line: route.ts:36; checkout.ts:47
  Fix: Add 4 one-line WHY comments
  ────────────────────────────────────────
  Section: —
  Check: BillingEventOutcome union ↔ SQL CHECK exact match
  Status: ✅
  File:Line: billing-events.ts:1-6 ↔ migration:10-16
  Fix: —
  ────────────────────────────────────────
  Section: —
  Check: Zod on startCheckoutAction inputs
  Status: ⚠️ 
  File:Line: actions.ts:8-11
  Fix: plan is compile-time PaidPlan only; runtime unvalidated. Fails closed today (invalid → undefined price → caught → unknown). Add
    z.enum(['plus','pro']) + locale validation as hardening
  ────────────────────────────────────────
  Section: —
  Check: ENF-A: PLUS_CAMPAIGN_LIMIT=5 hardcoded vs getPlanCapabilities
  Status: ⚠️ 
  File:Line: enforcement.ts
  Fix: Value matches capabilities (no bug today); already tracked in Session 11A backlog — route through
    getPlanCapabilities('plus').activeCampaigns
  ────────────────────────────────────────
  Section: —
  Check: Test: fingerprint try/catch swallow
  Status: ⚠️ 
  File:Line: webhook.test.ts
  Fix: No test asserting fingerprint failure still returns applied; add one
  ────────────────────────────────────────
  Section: —
  Check: Build: tsc --noEmit --skipLibCheck
  Status: ✅
  File:Line: clean (SOSH)
  Fix: —
  ────────────────────────────────────────
  Section: —
  Check: Tests: vitest run lib/stripe lib/db app/api/stripe
  Status: ✅
  File:Line: 17 files / 235 passing
  Fix: —

  ❌ Hard failures

  None. After verification, every item the reviewers initially marked ❌ is either (a) intended behavior conflicting with stale docs (E1), (b)
  fails-closed and so a hardening item not a vulnerability (Zod, G4, D5), or (c) pre-existing tracked backlog (ENF-A). The webhook trust boundary
  — signature, idempotency, replay, RLS, service-role isolation, PII handling — is sound.

  ⚠️  Recommendations

  Decision/doc (do first — resolves the apparent E1 "blocker"):
  1. Update CLAUDE.md pricing section: plus plan = 50 posts/mo, 5 active campaigns (per 2026-05-27 decision), and rename "Starter"→"plus"
  throughout. The code is correct; the constitution is stale. Confirm 50/5 is the live commercial decision before flipping live mode.

  Before shipping billing UI:
  2. G4 — hide "Manage billing" when !business.stripe_customer_id (pass hasStripeCustomer prop) — billing/page.tsx.
  3. Zod on startCheckoutAction — z.enum(['plus','pro']) for plan, validate locale against supported locales — actions.ts:8.
  4. D5 — add typeof window !== 'undefined' throw guard to products.ts (mirror client.ts) and/or extend ESLint to ban value-imports of
  @/lib/stripe/{products,checkout} from client code.

  Before flipping Stripe to live mode:
  5. B5 — pre-record with outcome:'error' (sentinel) and overwrite on success, so a crash between record and dispatch is visible in the audit log
  — route.ts:42.
  6. B6 — add a subscription_updated_at guard (or a documented comment) so a retried stale customer.subscription.updated can't overwrite a newer
  plan — webhook.ts:140.

  Defer (tech debt, acceptable for Phase 1):
  7. F3 — concurrent first-checkout orphan-customer race → Stripe idempotency key / lookup-before-create in Phase 2.
  8. C5 — comment that the partial unique index (migration 019) is the real atomicity guard.
  9. ENF-A — fold PLUS_CAMPAIGN_LIMIT into getPlanCapabilities() (already on the 11A backlog cross-file sweep).
  10. Minor TS cleanups: drop redundant casts (route.ts:41; webhook.ts:95,103), harden error narrowing (billing-events.ts:36-55), add
  fingerprint-failure test, add 4 WHY comments.

  Verdict

  - Blockers before flipping to live mode: Confirm the 50/5 plan values are the live commercial decision and update CLAUDE.md (#1). Apply B5 (#5)
  and B6 (#6) so the audit log and plan state are trustworthy under crashes/retries. Everything else security-critical is already correct.
  - Blockers before shipping billing UI: G4 (#2) and Zod hardening (#3); D5 guard (#4) recommended same pass.
  - Acceptable to defer: F3, C5 comment, ENF-A consolidation, and the minor TS/comment/test cleanups (#7–#10).

  Net: the security spine of the webhook (signature → pre-record → dispatch → outcome, with 23505 replay protection and service-role isolation)
  passes. No hard code blockers — the headline "plan mismatch" is a documentation drift, and the remaining items are hardening and audit-trail
  accuracy. Want me to apply the pre-live fixes (CLAUDE.md update, B5, B6) and the UI-shipping fixes (G4, Zod, D5) as a 11D correction pass?