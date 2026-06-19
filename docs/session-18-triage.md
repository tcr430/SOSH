# Session 18 Triage

**Generated:** 2026-06-14
**Phase B time budget:** No limit (stage across multiple Builder sessions)
**Live-mode horizon:** No fixed date → R7 keeps borderline items at P1 (no forced demotion to P2)

**Scope note:** Legal items (counsel ratification, `[LEGAL ENTITY]`, Anthropic DPF, cookie inventory, Svix, DPA PDF) are out of scope by Tiago's instruction — **except deletion infrastructure**, which is retained. Also excluded by instruction: Postiz removal (separate workstream), Stripe live smoke tests (ops), all ADR Phase-2 feature clusters, the `businesses.sql` comment, and the email DNS/SMTP ops cluster.

Inventory IDs trace back to the Step 1 chat list. 64 items tiered below.

---

## P0 — Pre-launch blockers

### ~~B18-012 — hard-delete-cron~~ ✅ COMPLETE (Session 18B-1)
- Source: launch-checklist.md:278 (ADR 0010 A1.4); migration `20260614021500_business_deletion_requests.sql`
- Original tier: launch blocker
- Description: No cron/worker processes `business_deletion_requests`; the table exists (Session 17B) but rows are never hard-deleted after 30 days.
- Reasoning: `/privacy` promises GDPR erasure and the erasure mechanism (a row inserted manually from a `privacy@` request, then purged by this cron) does not exist — a compliance gap backed by live prose.
- Est. Builder time: 150min (route + service-role purge RPC migration + QStash schedule + tests)
- Delivered:
  - `supabase/migrations/20260615200000_deletion_cron_state_machine.sql` — D2.1 schema delta, D2.3 `claim_deletion_requests` RPC, D2.4 `purge_business` RPC
  - `lib/db/deletion-requests.ts` — typed query helpers (claim, transition, purge, ownerId, countRemaining)
  - `lib/deletion/orchestrator.ts` — `runDeletionTick` + `computeBackoff`; Sentry.withMonitor wired
  - `app/api/cron/process-deletions/route.ts` — POST-only QStash route (mirrors drain-email-outbox)
  - `lib/deletion/orchestrator.test.ts` — 14 unit tests (12 tick + 2 backoff); all pass
  - `lib/deletion/__integration__/purge-business.test.ts` — gated integration test
  - `supabase/__tests__/rls-policy-lockdown.test.ts` — RLS/grant lockdown audit (gated)
  - QStash runbook Step 2b added; launch-checklist A1.4 ticked
  - Pre-existing RLS `= ANY` bug fixed in `20260607100000_email_outbox.sql` and `20260614021500_business_deletion_requests.sql`

---

## P1-CHEAP — Pre-launch nice-to-have (≤30min each)

### B18-001 — email-suppressed-errorcode
- Source: backlog.md:13 / current-phase §834 (A4) · Original: pre-launch debt
- Description: `suppressed` missing from `EmailProviderErrorCode` (5 vs ADR 0008 §4's 6).
- Reasoning: ADR-fidelity type gap with no runtime path; add `| 'suppressed'` or amend ADR. — 10min

### B18-002 — email-footer-14px
- Source: backlog.md:14 (E5) · Original: pre-launch debt
- Description: Email footer text is 13px, below the 14px WCAG 1.4.4 minimum.
- Reasoning: One CSS value, accessibility correctness. — 5min

### ~~B18-003 — outbox-atomic-guard~~ ✅ COMPLETE (Session 18B-2)
- Source: backlog.md:15 (L-05) · Original: pre-launch debt
- Description: `transitionEmailOutboxRow` does read-then-update without an atomic `WHERE status=` guard.
- Reasoning: Violates CLAUDE.md atomic-transition convention (R1); safe today via SKIP LOCKED, cheap `.eq('status', expected)` add. — 20min

### B18-004 — marketing-skiptocontent-i18n
- Source: backlog.md:16 / S16 MINOR-1 (L-16-1) · Original: pre-launch debt
- Description: Marketing layout hardcodes "Skip to content" instead of an i18n key.
- Reasoning: Violates CLAUDE.md "i18n from day one" (R1); add 3 locale keys + wire (R5). — 15min

### B18-005 — adr0008-t1-window-drift
- Source: backlog.md:26 (G3) · Original: post-launch
- Description: ADR 0008 §10 T-1 window text contradicts the implemented `[now+1d,now+2d)`.
- Reasoning: Documentation-only reconciliation, code is correct (R5). — 10min

### B18-006 — svixid-pk-adr-drift
- Source: backlog.md:27 (C7) · Original: post-launch
- Description: ADR 0008 §14 schema block doesn't document `svix-id` as the idempotency PK.
- Reasoning: Documentation-only ADR reconciliation (R5). — 10min

### ~~B18-008 — scrub-bare-email~~ ✅ COMPLETE (Session 18B-2)
- Source: backlog.md:29 / S14 J3 · Original: post-launch
- Description: Verify `scrubEvent` catches bare emails in Resend error strings; scrub `err.message` in the drainer if not.
- Reasoning: Potential PII leak to Sentry; cheap verify + small scrub addition, security-adjacent so kept P1. — 25min

### B18-009 — email-templates-any-casts
- Source: backlog.md:30 (K1) · Original: post-launch
- Description: Two `any` casts with eslint-disable in `lib/email/templates/index.ts`.
- Reasoning: Violates no-any (R1) but is a registry escape hatch; cheapest fix is documenting the exception in CLAUDE.md. — 10min

### B18-011 — cron-auth-failure-log
- Source: backlog.md:32 / current-phase §814 (13.5C-log) · Original: post-launch
- Description: Bearer cron-auth-failure path emits no structured warn log (QStash branch does).
- Reasoning: Small parallel `console.warn` in two route Bearer guards, observability parity. — 15min

### B18-026 — oauthauthorizeinput-adr
- Source: current-phase §980 / S3 Rec A · Original: gotcha (doc)
- Description: Document `OAuthAuthorizeInput`'s 2 extra fields in ADR 0002 open follow-ups.
- Reasoning: Documentation-only ADR note (R5). — 10min

### ~~B18-029 — ssrf-extra-ranges~~ ✅ COMPLETE (Session 18B-2 · corrected in 18B-2D)
- Source: current-phase §750 / S5 C-extra-ranges · Original: Session 5D defer
- Description: Add `0.0.0.0/8` and `fe80::/10` to the website-fetcher SSRF blocklist.
- Reasoning: Security defense-in-depth, cheap blocklist additions + tests, no known live exploit. — 25min

### B18-031 — fetch-failed-dead-enum
- Source: current-phase §754 / S5 G-dead-enum · Original: Session 5D defer
- Description: `fetch_failed` error enum value is never produced; remove or wire it.
- Reasoning: Dead-code cleanup, trivial. — 10min

### B18-034 — vault-cleanup-logging
- Source: current-phase §765 / S6 A3 · Original: Session 6D defer
- Description: Silent `vault_delete_secret` failures in the OAuth callback reconnect/compensating-transaction catches lack logging.
- Reasoning: Mirror Session 17B's `captureException` pattern into the callback route catches; partially addressed in 17B for `social-accounts.ts`, callback route likely remains. — 20min

### ~~B18-040 — updatecampaign-atomic-guard~~ ✅ COMPLETE (Session 18B-2)
- Source: current-phase §789 / S8 C6 · Original: Session 8C defer
- Description: `generate.ts` step 10 `updateCampaign` lacks an atomic `WHERE status='draft'` guard.
- Reasoning: Violates CLAUDE.md atomic-transition convention (R1); cheap guard, low live risk (step-3 already verified draft). — 15min

### B18-043 — adr-crossref-drift
- Source: current-phase §819 / S13.5C G1/G2 · Original: Session 13.5C defer
- Description: ADR 0005 A1 ↔ ADR 0006 §12/§13 not cross-referenced after the QStash migration.
- Reasoning: Documentation-only doc pass (R5). — 15min

### B18-045 — checklist-tunable-rows
- Source: current-phase §827 / S13 H1 · Original: Session 13D defer
- Description: Launch-checklist §1 collapses ~14 tunables into one grep row; expand to per-var.
- Reasoning: Documentation-only checklist expansion (R5). — 20min

### B18-046 — explicit-sentry-token
- Source: current-phase §830 / S13 B5 · Original: Session 13D defer
- Description: `withSentryConfig` relies on SDK auto-pickup of `SENTRY_AUTH_TOKEN`; pass it explicitly.
- Reasoning: Small `next.config.ts` change + ADR note. — 15min

### ~~B18-061 — email-homoglyph~~ ✅ COMPLETE (Session 18B-2)
- Source: S4 M-02 · Original: reviewer defer
- Description: Email blocklist bypassable via Unicode homoglyph domains (no NFKC/punycode normalize).
- Reasoning: Cheap `domain.normalize('NFKC')` closes a free-email blocklist bypass; input-validation hardening. — 20min

### ~~B18-062 — safe-redirect-decode~~ ✅ COMPLETE (Session 18B-2)
- Source: S4 L-03 · Original: reviewer defer
- Description: `isSafeRedirect` doesn't URL-decode, so double-encoded paths can slip the open-redirect guard.
- Reasoning: Cheap decode-before-check closes an open-redirect bypass. — 15min

### B18-064 — postcss-cve
- Source: S2 L-08 · Original: reviewer defer
- Description: PostCSS moderate CVE in the Next.js 16.2.4 dependency chain (Next not bumped).
- Reasoning: Verify current severity via `npm audit`; apply override/patch — may escalate if it forces a Next bump. — 20min

### B18-066 — banner-localstorage
- Source: S6 C4 · Original: reviewer defer
- Description: Dashboard no-accounts banner dismissal uses sessionStorage; UX wants localStorage.
- Reasoning: Trivial storage swap, pure UX. — 10min

### B18-067 — trialstate-rls-verify
- Source: S7 B4 · Original: reviewer defer
- Description: Verify `trial_state` SELECT RLS policy lets owners read their row; add warn-log + test.
- Reasoning: Cheap RLS verification — **escalates to P0 if the policy is absent**, because the null-fallback silently bypasses trial enforcement (revenue bug). — 30min

### B18-068 — campaign-date-coltype
- Source: S7 C3 · Original: reviewer defer
- Description: Confirm `start_date`/`end_date` are `date`, not `timestamptz` (TZ off-by-one).
- Reasoning: One-migration verification, no code change unless wrong. — 10min

### B18-069 — poststatus-cast
- Source: S9 R1 · Original: reviewer defer
- Description: Unsound `post.status as …` cast in PostCard.
- Reasoning: Cheap fallback-lookup replaces the cast. — 10min
- **CLOSED — Session 18B-3**

### B18-070 — postaction-error-union
- Source: S9 R2 · Original: reviewer defer
- Description: `PostActionState.error` should be a typed error-code union.
- Reasoning: Define a named union, removes a downstream cast. — 20min
- **CLOSED — Session 18B-3** ✅ (completed in 18B-3D — 18B-3 close was premature; the downstream cast in `RegenerateDialog.tsx:51` was never removed until 18B-3D replaced it with `regenerateErrorKey()` comparison switch)

### B18-071 — aimetadata-parse-helper
- Source: S9 R3 · Original: reviewer defer
- Description: `as Partial<AiGenerationMetadata>` on `Record<string,unknown>` is latent-any; add a narrow parse helper.
- Reasoning: Small helper + 2 call sites; `?? []` guard prevents crashes today. — 20min
- **CLOSED — Session 18B-3**
- M2 note (P2): `parseAiGenerationMetadata` narrows the container (non-null object check) but not individual fields — `regenerationCount` is still an unvalidated cast inside `Partial<AiGenerationMetadata>`. Field-by-field narrowing is quality debt; no runtime bug today because call sites use `?? 0` / `?? []` guards.

### B18-072 — valid-transitions-map
- Source: S9 R4 · Original: reviewer defer
- Description: `VALID_TRANSITIONS` omits unapprove/unskip edges.
- Reasoning: Add 2 edges or a JSDoc clarifying the map only governs generic `updatePost`. — 10min

### B18-073 — posts-double-sort
- Source: S9 R5 · Original: reviewer defer
- Description: Posts sorted server-side then re-sorted in `PostsClient`.
- Reasoning: Remove one redundant sort. — 10min

### B18-074 — revalidatepath-verify
- Source: S9 X2 · Original: reviewer defer
- Description: Verify `revalidatePath` i18n bracket-path behavior holds in Next.js 16.
- Reasoning: Quick behavioral verification of the cache-revalidation path. — 15min

### ~~B18-076 — redacttokens-value-scan~~ ✅ COMPLETE (Session 18B-2 · corrected in 18B-2D)
- Source: S10 C8 · Original: reviewer defer
- Description: `redactTokens` is key-name-based; add value-pattern scanning (Bearer/sk-/hex).
- Reasoning: Add value scan to one redactor + tests, defense-in-depth against token leak to logs. — 25min

### B18-081 — stripe-client-import-eslint
- Source: S11 D5 · Original: reviewer defer
- Description: Add ESLint ban on client value-imports of `@/lib/stripe/{products,checkout}` + `typeof window` guard.
- Reasoning: Cheap ESLint hardening; today only type-imports (erased), no live leak. — 20min

### B18-084 — janitor-monitor-schedule
- Source: S13 E3 · Original: reviewer defer
- Description: `Sentry.withMonitor('janitor-cron')` has no declared schedule → possible "no schedule" Sentry warnings.
- Reasoning: Cheap document-or-remove of the wrap. — 15min

---

## P1-EXPENSIVE — Pre-launch nice-to-have (>30min each)

### B18-010 — plan-capability-sweep
- Source: backlog.md:31 / current-phase §795 / S11 ENF-A (S11A-cap) · Original: post-launch
- Description: Hardcoded plan-limit integers (e.g. `PLUS_CAMPAIGN_LIMIT=5`) should read from `getPlanCapabilities()`.
- Reasoning: Cross-file capability-hardcoding sweep across `lib/`, multiple call sites. — 60min
- **CLOSED — Session 18B-3**

### B18-014 — in-app-delete-account
- Source: launch-checklist.md:280 (A1.4) · Original: launch blocker
- Description: In-app Delete Account flow (Settings, email round-trip, writes to `business_deletion_requests`).
- Reasoning: Launch erasure posture is email-based/manual (ADR 0010 A1), so this is an enhancement, not a blocker; cross-cutting + needs design. — 180min

### B18-025 — middleware-to-proxy
- Source: current-phase §970 / CLAUDE.md file-structure · Original: gotcha
- Description: Rename `middleware.ts` → `proxy.ts` (Next.js 16 deprecation); CLAUDE.md already names `proxy.ts`.
- Reasoning: Violates CLAUDE.md (file-structure already describes the rename) (R1); touches config + launch-checklist §8 grep commands, needs care. — 45min
- **CLOSED — Session 18B-4** ✅ (renamed middleware.ts → proxy.ts; export `middleware` → `proxy`; added `resend-confirmation` to PUBLIC_SEGMENTS; updated launch-checklist §8 grep commands; removed stale gotcha from current-phase.md)

### B18-030 — geterrormessage-helper
- Source: current-phase §752 / S5 H-casts · Original: Session 5D defer
- Description: `(error as {message})` repeated ~15× across `lib/db/`; extract a typed `getErrorMessage(unknown)`.
- Reasoning: Violates unknown-narrowing rule (R1) across ~15 sites; cross-cutting. — 50min
- **CLOSED — Session 18B-3** ✅ (completed in 18B-3D — 18B-3 close was premature; aliased sites `fetchError`/`readError` in `businesses.ts`/`posts.ts` + `lib/ai/metrics.ts` required a pattern-matched follow-up grep)

### B18-041 — toiso-sweep
- Source: current-phase §792 / S8/S5 defer (verified ~8 live sites) · Original: Session 8C defer
- Description: ~8 production `.toISOString()` call sites should use date-fns `formatISO()` (`cron-health.ts`, `auth-rate-limits.ts`, `ai-usage.ts`, `metrics.ts` ×2, `schedule.ts:62`, `_health/route.ts`, `campaigns/[id]/page.tsx:50`).
- Reasoning: Violates CLAUDE.md date-fns rule (R1) across ~8 live sites; cross-file. A `.toISOString()` ban lint rule is R2→P2 until this sweep lands (else CI breaks). — 60min
- **CLOSED — Session 18B-3**

### B18-060 — login-email-oracle
- Source: S4 M-01 · Original: reviewer defer (decision required)
- Description: Login distinguishes registered-unconfirmed vs unregistered email → account-enumeration oracle.
- Reasoning: Security finding entangled with the resend-confirmation UX; needs a product decision before any change. — 45min (incl. decision)
- **CLOSED — Session 18B-4** ✅ (Option 3 — collapse all signInWithPassword failures to generic `errors.login.invalid`; remove unconfirmedEmail from LoginState; replace conditional amber banner with always-rendered resend link on login page; new `/resend-confirmation` route mirrors forgot-password anti-enumeration posture; `'resend-confirmation'` added to AuthAction + RATE_LIMITS + PUBLIC_SEGMENTS)

### ~~B18-075 — publish-metadata-rpc~~ ✅ COMPLETE (Session 18B-2)
- Source: S10 B2 · Original: reviewer defer
- Description: Promote `markPostFailed`/`requeueScheduledPost` metadata-merge to a single-statement RPC.
- Reasoning: Violates atomic-transition convention (R1); fix needs a new RPC migration, low live risk via SKIP LOCKED. — 60min

---

## P2 — Post-launch defer

### B18-007 — locale-snapshot-test
- Source: backlog.md:28 (D3-locale) · Original: post-launch
- Description: Add a test locking the email locale-snapshot invariant against a live `businesses.language` mutation.
- Reasoning: Added-test for a subsystem with adjacent coverage (R3). — defer

### B18-015 — adr0010-a2-amendment
- Source: launch-checklist.md:281 · Original: gated follow-up
- Description: Amendment A2 swapping §13 erasure prose to in-app wording.
- Reasoning: Only applies after the in-app flow (B18-014) ships; email-based prose is correct until then. — defer (depends on B18-014)

### B18-023 — marketing-js-budget
- Source: launch-checklist.md:381 · Original: blocked checklist row
- Description: Verify marketing first-load JS ≤ 90KB gz.
- Reasoning: Blocked on the pre-existing ECC build failure (B18-027); perf budget at zero users is low priority. — defer (blocked)

### B18-024 — marketing-cwv-lab
- Source: launch-checklist.md:382 · Original: blocked checklist row
- Description: LCP/CLS/INP lab check on `/`.
- Reasoning: Blocked on B18-027 build fix + Lighthouse run; not SOSH-actionable now. — defer (blocked)

### B18-027 — build-fails-ecc-remotion
- Source: current-phase §968 · Original: gotcha
- Description: `npm run build` fails on ECC remotion tsc errors.
- Reasoning: Pre-existing ECC tooling issue, explicitly out of SOSH Builder scope (not SOSH code). — defer (external/out of scope)

### B18-028 — ai-fixture-key-promptid
- Source: current-phase §748 / S5 A-fixture-key · Original: Session 5D defer
- Description: Key `lib/ai/__fixtures__/` by `prompt_id` to avoid cross-version collision.
- Reasoning: Only bites when two prompts share a model; not a current bug. — defer

### B18-033 — disconnect-toctou
- Source: current-phase §762 / S6 A3 · Original: Session 6D defer
- Description: `deactivateSocialAccount` read-then-update TOCTOU on concurrent connect/disconnect.
- Reasoning: Low-probability concurrency race, acceptable until scale warrants. — defer

### B18-035 — alertdialog-visual-qc
- Source: current-phase §767 / S6 C2 · Original: Session 6D defer
- Description: Disconnect confirmation dialog never browser-verified across locales/themes.
- Reasoning: Manual visual-QC task with no known defect. — defer

### B18-036 — starter-cap-toctou
- Source: current-phase §772 / S7 B5 · Original: Session 7C defer
- Description: `countActiveCampaigns`+`createCampaign` TOCTOU could slip a 3rd Starter campaign.
- Reasoning: Low-probability concurrent-create race. — defer

### B18-037 — notfound-over-redirect
- Source: current-phase §775 / S7 A3 · Original: Session 7C defer
- Description: Campaign detail uses `redirect()` not `notFound()` on 404/unowned.
- Reasoning: Cosmetic Next.js-convention nicety; RLS already guards, zero functional benefit. — defer

### B18-038 — postgen-schema-refine
- Source: current-phase §783 / S8 B4 · Original: Session 8C defer
- Description: `PostGenerationOutputSchema` doesn't enforce per-platform hashtag/length at parse time.
- Reasoning: Parse-time strictness is hardening; call-site already enforces caps. — defer

### B18-039 — custom-frequency-test
- Source: current-phase §786 / S8 E6 · Original: Session 8C defer
- Description: No test for `frequency='custom'` with unusual `postsPerWeek`.
- Reasoning: Added-test for a branch with adjacent coverage (R3). — defer

### B18-047 — trial-interval-hardcoded
- Source: current-phase §866 / S14 · Original: Session 14 reviewer defer
- Description: `find_trial_expiring_between.sql` hardcodes the 14-day trial length.
- Reasoning: Trial length is a locked strategic decision unlikely to change; parameterization is maintainability-only. — defer

### B18-063 — supabase-gen-types
- Source: S4 M-04 · Original: reviewer defer
- Description: Use generated Supabase row types instead of `as BusinessRow` casts.
- Reasoning: Type-quality refactor, no runtime bug, low benefit. — defer

### B18-065 — getbusinessbyid-rls-type
- Source: S6 A2 · Original: reviewer defer
- Description: `getBusinessById` should require a typed RLS-client wrapper.
- Reasoning: Defense-in-depth type nicety with no live bug. — defer

### B18-077 — migration-hygiene
- Source: S10 W3/W4 · Original: reviewer defer
- Description: Add `IF NOT EXISTS` to ALTER TABLE; document migration apply-ordering coupling.
- Reasoning: Migration-hygiene for future edits, no live defect. — defer

### B18-078 — publish-test-assertions
- Source: S10 G1/G2 · Original: reviewer defer
- Description: Error-code tests don't assert `last_publish_error`/`publish_attempts`.
- Reasoning: Strengthen existing tests on an already-covered subsystem (R3). — defer

### B18-079 — stale-subscription-guard
- Source: S11 B6 / current-phase §512 · Original: Phase-2 accepted risk
- Description: Retried stale `customer.subscription.updated` could overwrite a newer plan (no updated-at guard).
- Reasoning: Documented Phase-2 accepted risk; low-probability out-of-order Stripe event. — defer

### B18-080 — checkout-orphan-customer
- Source: S11 F3 · Original: Phase-2 defer
- Description: Concurrent first-checkout can create two Stripe customers (orphan).
- Reasoning: Low-probability race; Phase-2 idempotency-key fix. — defer

### B18-083 — metrics-catch-discriminate
- Source: S12 · Original: reviewer defer
- Description: Metrics catch block doesn't distinguish infra vs provider errors.
- Reasoning: Error-classification accuracy in a wired-but-inert metrics worker (R4). — defer

### B18-085 — formatISO-local-audit
- Source: S18B-3 reviewer L2 · Original: filed 18B-3D
- Description: `formatISO(new Date())` calls in `businesses.ts`, `campaigns.ts`, `posts.ts` emit LOCAL-offset strings (the same UTC hazard B18-041 fixed, invisible to the `.toISOString()` ban lint rule).
- Reasoning: Tier UNDECIDED pending a probe: **P1** if any site writes a `timestamptz` column or string-compares the value; **P2** if display-only. Do NOT fix until the probe determines tier — just verify call sites and column types first.
- **Do not fix in the next Builder session without running the probe first.**

### B18-086 — signup-email-oracle
- Source: S18B-4 recon · Original: discovered during B18-060 analysis
- Description: `signup/actions.ts` `includes('already registered')` branch returns a distinct field-level `errors.email` key vs the generic `errors._form` on other failures — leaks whether an email address is already registered.
- Reasoning: Same class as B18-060 (account-enumeration oracle); signup flow. Fix: collapse the `already registered` branch into the generic `errors.signup.generic` form error, same indistinguishability principle. — 30min
- **NOT fixed in Session 18B-4 — out of scope. File and tier for next auth session.**

---

## N/A — Stale / superseded / already done

### B18-013 — rate-limit-ttl-cron
- Source: launch-checklist.md:279 (A1.4)
- Reasoning: `pruneStaleAuthRateLimits` is already wired into `runJanitorTick` (Session 13 D16) and `lib/db/auth-rate-limits.ts:7` performs the TTL delete — the purge runs on every publish tick. Only prod-verification remains, not code.

### B18-082 — postmetrics-rls-overgrant
- Source: S12 (database-reviewer flag) / S2 H-2
- Reasoning: The over-grant no longer exists. `post_metrics_insert_own`/`update_own`/`delete_own` were dropped in migration `20260430120016_fix_post_metrics_engagement_rls.sql` and never recreated; migration `20260430120017_fix_rls_function_caching.sql` recreates only `post_metrics_select_own` (SELECT). All writes go through `lib/db/post-metrics.ts` via the service-role client (RLS bypassed). No authenticated write path exists — nothing to drop. A defensive lockdown test is added under ADR 0010 Amendment 2 §D2.10 (`supabase/__tests__/rls-policy-lockdown.test.sql`).

### B18-032 — ai-ratelimit-verify
- Source: current-phase §756 (Session 5D defer)
- Reasoning: Verified live — `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` is defined in `config.ts:38` (default 30) and consumed in `runner.ts:78`. Post-generation landed in Session 8; the limit applies.

### B18-044 — vercel-json-cron-comment
- Source: current-phase §822 (Session 13.5C defer)
- Reasoning: `vercel.json` is `{}` — the crons array was fully removed in Session 13.5B; the commented stanza the item describes does not exist, and the Vercel-cron restore path is intentionally reserved (QStash active; restore runbook documents the future swap). Nothing to remove.

### (review-derived, already resolved — no live ID)
- CLAUDE.md pricing drift "Starter"→"plus" / 50-5 (S11 E1) — current CLAUDE.md already reads Plus/Pro at 50 posts / 5 campaigns.
- Middleware order doc drift (S13 C9) — corrected in Session 13D ("middleware ordering corrected").
- Resend ESLint boundary (S14 A6/K4) + eslint multi-block override regression (S15 H1) — resolved Session 15D (L-01/B-01 consolidation).
- Webhook 23514 storm (S14 C-CHECK), first-post refresh-retry path (S14 I3/I4), backoff exponential cap (S14 F9), drainer poison pill (S15 M1) — resolved 14D/15D.
- Section.tsx matchMedia branch (S16 MINOR-3), `locale_label` unused (S16 NIT-3) — resolved in Session 16.

---

## Closed in correction passes

Items closed during 18B-3D (correction pass on 18B-3 — finishing two items whose deliverables were unmet):

- **H1 / B18-030 follow-up** — Pattern-matched getErrorMessage sweep: replaced aliased casts `(fetchError as {message}).message` in `lib/db/businesses.ts`, `(readError as {message}).message` ×2 in `lib/db/posts.ts`, and `(error as {message}).message` ×2 in `lib/ai/metrics.ts`.
- **H2 / B18-070 follow-up** — Removed unsound `result.error as '...'` cast in `RegenerateDialog.tsx`; replaced with `regenerateErrorKey()` comparison switch (same runtime behaviour).
- **M4** — Added direct unit tests for `getErrorMessage` (5 cases) and `parseAiGenerationMetadata` (4 cases) in `lib/db/utils.test.ts`.
- **M3 / B18-071 observation** — PostCard null-metadata default changed `null → {}` (accepted strict improvement — latent null-deref fix; pre-refactor path would have thrown on `null.regenerationCount`).

Items closed during 18B-2D (observability, test, and doc additions to items already marked complete):

- **M1 / B18-040 follow-up** — Observe `activateCampaign` guard rejection with structured warn log + Sentry breadcrumb in `lib/db/campaigns/generate.ts`.
- **M2 / B18-075 follow-up** — Observe `publishPostComplete` atomic guard rejection with structured warn log at both guard sites in `lib/publishing/orchestrator.ts`.
- **M3 / B18-003 follow-up** — Add zero-row negative test for `transitionEmailOutboxRow` wrong-source-status path in `lib/db/email-outbox.test.ts`.
- **M4** — Document the hex over-redaction trade-off above `VALUE_PATTERNS` in `lib/observability/sentry-scrub.ts`; records the deliberate choice to over-redact rather than narrow the pattern.

---

## Conflicts and dependencies

- **B18-014 (in-app delete) → B18-015 (A2 amendment).** A2 swaps the erasure prose to in-app wording; it must not land until the in-app flow ships, or `/privacy` would describe a flow that doesn't exist.
- **B18-012 (hard-delete cron) ↔ B18-014 (in-app flow).** The cron is the erasure *executor*; the in-app flow is one row-source. At launch the row-source is a manual insert from a `privacy@` email, so the cron (P0) is sufficient without the in-app flow (P1-EXP). Build the cron first.
- **B18-027 (build fix) → B18-023 / B18-024 (perf + CWV).** Both perf gates are blocked until `npm run build` succeeds; since B18-027 is out of SOSH scope, both stay P2/blocked.
- **B18-041 (toISOString sweep) → a `.toISOString()` ban lint rule.** Per R2, the lint rule must follow the call-site sweep, otherwise CI fails on the existing ~8 violations. Do the sweep first; add the rule as a follow-up commit in the same session.
- **B18-025 (middleware → proxy rename) precedes any new middleware logic** and touches the launch-checklist §8 grep commands (`grep middleware.ts`) — update the checklist in the same change to avoid stale audit commands.
- **Batch — atomic-transition family:** B18-003, B18-040, B18-075 all add CLAUDE.md atomic `WHERE`-guard semantics; cheap to do together (075 needs a migration, 003/040 are app-layer).
- **Batch — RLS-posture family:** B18-067 (trial_state SELECT verify) is closed OK (the policy exists and matches the call path) and B18-082 (post_metrics write over-grant) is closed N/A (the write policies were dropped in migration 016). The Phase-A probe resolved both; the only remaining artefact is a single defensive lockdown test bundling both assertions — `supabase/__tests__/rls-policy-lockdown.test.sql` (ADR 0010 Amendment 2 §D2.10) — written by Builder alongside the deletion cron.
- **Batch — type-quality family:** B18-030, B18-063, B18-070, B18-071 share the unknown-narrowing/typed-cast theme.

## Obsolete deferral reasoning

- **B18-013** — deferred "to a backlog session"; reality: `pruneStaleAuthRateLimits` already shipped wired into the janitor in Session 13. → N/A.
- **B18-032** — deferred "verify when Session 6 lands"; reality: post-generation landed in Session 8 and the limit is wired and applied. → N/A.
- **B18-044** — deferred "until QStash is stable"; reality: QStash is the active trigger and `vercel.json` is already `{}`. → N/A.
- **B18-079** — deferred to Phase 2 in Session 11C; still a valid Phase-2 item (stable reasoning, retained as P2).

## Out of scope for Session 18 (candidates for future sessions)

These were noticed but deliberately **not** filed as Session 18 backlog items — Tiago decides whether any become their own session:

- **Fix the ECC remotion build failure** (B18-027) — external tooling, explicitly off-limits to Builder.
- **Postiz removal workstream** (excluded by instruction) — separate migration to direct LinkedIn/X APIs.
- **Stripe live-mode smoke tests A–F** (excluded) — run at the live-flip, not a code change.
- **Email DNS/SMTP provisioning** (excluded) — Resend domain, SPF/DKIM/DMARC, Supabase SMTP relay; ops config.
- **Legal track** (excluded) — counsel ratification, `[LEGAL ENTITY]` substitution, Anthropic DPF, cookie inventory, Svix client-verify, DPA PDF.
- **ADR Phase-2 feature clusters** (excluded) — native providers, streaming runner, cost ceilings, retry-from-failed UI, engagement email, A/B testing, etc.
