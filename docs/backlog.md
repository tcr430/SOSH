# Jemip Backlog

Known gaps that are **committed but deferred**. Every entry names the session that filed it and the reason
for deferral; where a deferral has a condition attached, the **un-defer trigger** is named explicitly.

**What this is not:**
- **Not `docs/pre-launch-scope.md`** — that is *scope* (features to add). This is *debt* (things missing or
  imperfect in what already exists).
- **Not `docs/ideas.md`** — that is uncommitted possibility. Everything here is agreed work, just not now.
- **Not `docs/current-phase.md`** — that is live development state.

> **Reconciled 2026-09-03.** `docs/session-18-triage.md` (456 lines, 64 items, 2026-06-14) has been folded
> into this file and **deleted**. Its P0 and P1 tiers were fully closed by Session 18; its P2 tier and its
> "out of scope" list are carried below with their original IDs (`B18-*`) so historical references still
> resolve. Its `N/A — stale/superseded` items (B18-013, B18-032, B18-044, B18-082) were verified closed and
> are **not** carried forward as open work.

---

## 1. Pre-launch debt (open)

Must be resolved before the first paying customer.

| ID | Area | Description | Filed |
|----|------|-------------|-------|
| **B18-089** | ~15 sites across `lib/` | `formatISO(new Date())` writes **local-offset** strings to `timestamptz` columns; the `.toISOString()` ESLint ban does not catch `formatISO`. Postgres normalises `timestamptz` so live risk is low, but CLAUDE.md mandates `toUtcIso()`. **Do not fix piecemeal — one full sweep.** ~45min | 18B-5D |
| **B18-086** | `app/[locale]/(auth)/signup/actions.ts` | Account-enumeration oracle: the `already registered` branch returns a field-level `errors.email` key where every other failure returns generic `errors._form`. Collapse into the generic form error (same fix shape as the closed login oracle B18-060). ~30min | 18B-4 |
| **B18-064** | `postcss` (transitive) | XSS CVE in the Next.js dependency chain. **Blocked** on a Next.js bump — no direct remediation. Re-check on each Next upgrade. | 18B-5D |
| **13.5C-log** | `app/api/cron/publish/route.ts` | Bearer-side cron-auth failure emits no structured warn log; the QStash branch does. Add the parallel `console.warn(JSON.stringify({ kind: 'cron-auth-failure', … }))`. | Session 13.5C |
| **B18-023** | marketing bundle | Verify first-load JS ≤ 90 KB gz. **Blocked on B18-027.** | launch-checklist §11 |
| **B18-024** | marketing CWV | LCP/CLS/INP lab check on `/`. **Blocked on B18-027.** | launch-checklist §11 |

**Also pre-launch, tracked elsewhere — not duplicated here:** the legal gates (counsel ratification →
`[LEGAL ENTITY]` substitution, Anthropic DPF, cookie inventory, Svix client-verify) live in
`launch-checklist.md` §9; the Postiz→native migration lives in §16; the `db-tests` promotion tally lives in
`current-phase.md`.

---

## 2. Deferred with a named un-defer trigger

**The highest-value section in this file.** Each of these has an explicit condition; none should be
actioned before its trigger fires, and each *must* be actioned when it does.

| ID | Item | Un-defer trigger |
|----|------|------------------|
| **21C-pagination** | Real cursor pagination for the Approvals inbox beyond `APPROVALS_POST_LIMIT` (200) | **The first business observed with `total > 200` pending drafts.** `APV-BULK-VISIBLE-ONLY` disables bulk approve whenever the rendered set is incomplete, so overflow degrades a live affordance, not just a count. Act on the signal, not a date. |
| **22-MINOR-5** | Index covering `(business_id, status, scheduled_at) WHERE deleted_at IS NULL` for the pending-draft predicate | **Same trigger as `21C-pagination`.** Do not create the index before it. |
| **25D-MINOR-11** | `post-generation.ts:179` / `post-regeneration.ts:147` neutralise `topContent` but do not truncate it | **The first writer that puts a synthesized, unbounded value into `performance_memory.pattern`** must enforce a length bound at write time before it can reach these render sites. Session 33's outcome extractor is a candidate. |
| **22E-integration-discovery** | Four `__integration__` suites are discovered by no CI job | **First launch-blocking dependency on a real-network path, or first Postiz/Resend defect reaching staging.** Deliberate 22-D trade (absent-and-honest beats present-and-lying); `purge_business` retains Tier-1 coverage via `db-tests`. |
| **22D-skipguard-file-floor** | Skip-guard misses a single required suite silently dropping out of collection | **A rename or glob change that alters the collected-file count.** Fix: assert a floor on collected files, or pin a manifest of required suites by name. |
| **24D-NIT-4-logger** | Three brief Server Actions swallow throws with `catch { return generic }`, marked `// TODO(logger)` | **When a project logger lands.** Same class as `BriefReviewForm.tsx:126`'s `key={i}`. |
| **`MODE2-REDUNDANCY-UNDEFER`** | Cross-set redundancy — *"these two posts make the same argument"* (ADR 0017 §8 item 4) | **Session 34 Q4 must answer this explicitly** — un-defer it there or leave it deferred, but not silently. It is a question about the *set*, so the campaign planner is its natural home. |
| **`EMBEDDINGS_UNDEFER_THRESHOLD`** | `audience_memory` embedding retrieval (ADR 0016 §5.3) | **200 active `audience_memory` rows.** Distinct from `SIGNAL-NO-EMBEDDINGS` — do not conflate the two (Session 29-D D11 corrected exactly this confusion). |
| **`SIGNAL-NO-EMBEDDINGS`** | Embeddings in Mode 3 Stage B scoring — **re-affirmed**, not retired (ADR 0023 §4.1) | ADR 0020 §6.5's condition (a second *unstructured* source) appears met by RSS — but it was written about **Stage B scoring**. Retrieval/exemplar use is a *different* use needing its own ruling. |
| **`30.5-X-REFRESH-ROTATION`** | X rotates its refresh token on every refresh, which makes ADR 0002 §8's *accepted* concurrent-refresh race worse than the race §8 actually reasoned about. §8 assumed the loser wastes one retry ("some platforms accept both refreshes; last write wins; no user impact"). Under rotation both callers read the same refresh token R; caller 1 consumes R for R'; caller 2 then presents an already-consumed R and is hard-rejected — and where a platform treats refresh-token reuse as a theft signal, it can invalidate the whole chain and **disconnect the account**, forcing the user to reconnect. Same race, materially worse consequence. Remedy already named by ADR 0002 §8: a Postgres advisory lock `pg_advisory_xact_lock(hashtext('refresh:' || $1))` inside `refreshAccessToken`. | **The first observed rotation-related disconnect, OR any X refresh error whose body indicates refresh-token reuse.** Founder ruling 2026-09-03 (Session 30.5 adjudication D): accepted for MVP — traffic is scheduled, low-volume, one business per account, so genuine concurrency is rare — but filed here because it is expected to bite later. **Do not treat ADR 0002 §8's "accepted" as covering this case**: §8 accepted a wasted retry, not an account disconnect. NOTE: independent of, and blocked by, the missing `public.vault_update_secret` (Session 30.5 adjudication B) — until that migration lands the rotated token is never persisted at all. |
| **`30.5-MEDIA-UPLOAD`** | Native media upload for LinkedIn and X. Both platforms require a **two-call** publish for media (upload bytes → asset id → reference the id in the post), which introduces a failure mode *between* the calls — an uploaded asset with no post — that ADR 0005's one-attempt-per-post status machine has no state for. `PublishInput.mediaUrls` exists but is documented "empty in Phase 1 (text-only)" and has no producer today. Session 30.5 therefore ships a **guard, not a capability**: a post with non-empty `mediaUrls` fails `PLATFORM_REJECTED` rather than silently publishing text-only, because shipping a different post than the user approved is the worst outcome for a human-in-the-loop product. | **Founder ruling 2026-09-03 (Session 30.5 adjudication C): a dedicated media-integration session owns this.** Un-defer when that session runs, or earlier if image generation (pre-launch per CLAUDE.md) lands a producer that populates `mediaUrls` — at which point the guard starts rejecting real posts and the upload path becomes launch-blocking. |
| **B18-015** | ADR 0010 Amendment A2 — swap §13 erasure prose to in-app wording | **Depends on B18-014** (in-app Delete Account flow). Must not land first, or `/privacy` describes a flow that does not exist. |

---

## 3. Post-launch / deferred (no trigger)

Ordered loosely by likely value.

| ID | Area | Description | Filed |
|----|------|-------------|-------|
| B18-014 | GDPR | In-app Delete Account flow. At launch the row-source for erasure is a manual insert from a `privacy@` email; the hard-delete cron (the executor) already ships. | Session 18 |
| B18-079 | `lib/stripe/webhook.ts` | Retried stale `customer.subscription.updated` could overwrite a newer plan — no `updated_at` guard. Documented accepted risk. | Session 11C |
| B18-080 | `lib/stripe/checkout.ts` | Concurrent first-checkout can create two Stripe customers (orphan). Phase-2 idempotency-key fix. | Session 11 F3 |
| B18-033 | `lib/db/social-accounts.ts` | `deactivateSocialAccount` read-then-update TOCTOU on concurrent connect/disconnect. | Session 6D |
| B18-036 | `lib/campaigns/enforcement.ts` | `countActiveCampaigns` + `createCampaign` TOCTOU could slip an extra campaign past the plan cap. | Session 7C |
| G3 | ADR 0008 §10 | T-1 window reconciliation: code uses `[now+1d, now+2d)`; ADR text says `[now, now+1d)`. Code and tests internally consistent — amend the ADR. | Session 14 Reviewer |
| C7 | ADR 0008 §14 | ADR schema block does not document that `svix-id` is the PK (idempotency anchor). Reconcile with the shipped migration. | Session 14 Reviewer |
| D3-locale / B18-007 | `lib/email/__tests__/enqueue.test.ts` | Missing test locking the locale-snapshot invariant against a live `businesses.language` mutation. | Session 14 Reviewer |
| J3 | `lib/observability/sentry-scrub.ts` | Verify `scrubEvent` catches bare email addresses inside Resend error message strings, not only key-name matches. | Session 14 Reviewer |
| B18-087 | signup + resend-confirmation | `emailRedirectTo` omitted, so confirmation links resolve to the Supabase Site URL rather than `APP_URL` — correct in prod, wrong in preview. **Fix both entry points together** or create an asymmetry. | 18B-4D |
| B18-083 | `lib/metrics/orchestrator.ts` | Catch block does not distinguish infra vs provider errors. | Session 12 |
| B18-078 | publish tests | Error-code tests do not assert `last_publish_error` / `publish_attempts`. | Session 10 |
| B18-038 | `lib/ai/prompts/post-generation.ts` | `PostGenerationOutputSchema` does not enforce per-platform hashtag/length at parse time; call sites do. | Session 8C |
| B18-039 | `lib/campaigns/schedule.ts` tests | No test for `frequency='custom'` with unusual `postsPerWeek`. | Session 8C |
| B18-028 | `lib/ai/__fixtures__/` | Key fixtures by `prompt_id` to avoid cross-version collision. Only bites when two prompts share a model. | Session 5D |
| B18-063 | `lib/db/` | Use generated Supabase row types instead of `as BusinessRow` casts. | Session 4 |
| B18-065 | `lib/db/businesses.ts` | `getBusinessById` should require a typed RLS-client wrapper (defence in depth). | Session 6 |
| B18-077 | `supabase/migrations/` | Migration hygiene: `IF NOT EXISTS` on ALTER TABLE; document apply-ordering coupling. | Session 10 |
| B18-047 | `find_trial_expiring_between.sql` | Hardcodes the 14-day trial length. Maintainability only — trial length is a locked decision. | Session 14 |
| B18-037 | campaign detail | Uses `redirect()` rather than `notFound()` on 404/unowned. Cosmetic; RLS already guards. | Session 7C |
| B18-035 | disconnect dialog | Never browser-verified across locales/themes. Manual visual QC, no known defect. | Session 6D |
| K1 | `lib/email/templates/index.ts` | Two `any` casts with `eslint-disable`. **Partially resolved** — CLAUDE.md now documents this as one of two accepted `any` carve-outs. Remaining option: a generic `KindEntry<P>` to remove them. | Session 14 Reviewer |
| SSRF-ranges | `lib/ai/website-fetcher.ts` | `0.0.0.0/8` and `fe80::/10` not yet in the blocklist. Low practical risk. | Session 5D |
| fetch_failed | error enum | Dead `fetch_failed` value in an error enum. | Session 5D |
| 21B-n4 | dashboard Server Actions | Multiple call sites each call `getBusinessForUser` independently per request. Latency/query-count only — correctness unaffected. Fix: request-scoped memo (React `cache()`). | ADR 0014 A0 |

---

## 4. Filed for visibility — no action intended

| ID | Item | Why it is here |
|----|------|----------------|
| **21B-member-roster** | Any co-member can read the full member roster via the API | A **locked ADR 0013 model property**, not a defect. Recorded so a future reviewer does not re-report it as a finding. |
| **22-NIT-3** | The `claude-mem` plugin appears to inject `<system-reminder>`-shaped text into subagent tool output | Not a Jemip code defect — `security-reviewer` correctly ignored it. Worth watching: a less careful agent could follow it. |

---

## 5. External / out of scope

Not ours to fix, but they block things that are.

| ID | Item | Impact |
|----|------|--------|
| **B18-027** | `npm run build` fails on ECC Remotion `tsc` errors | **Blocks B18-023 and B18-024** (the perf/CWV gates). Pre-existing ECC tooling issue, explicitly off-limits to a Builder session. Use `npm run dev` for local validation. |
| — | Email DNS/SMTP provisioning (Resend domain, SPF/DKIM/DMARC, Supabase SMTP relay) | Ops configuration, not code. |
| — | Stripe live-mode smoke tests A–F | Run at the live-flip, not as a code change. |

---

## 6. Closed — retained for audit

Struck-through IDs resolve historical references. Full closure evidence for the `B18-*` series was in
`session-18-triage.md`, now deleted; the correction-pass commits remain the authoritative record.

| ID | Description | Closed |
|----|-------------|--------|
| ~~A4~~ | `suppressed` missing from `EmailProviderErrorCode` union | 18B-5 (B18-001) |
| ~~E5~~ | Email footer 13 px → 14 px (WCAG 1.4.4) | 18B-5 + 18B-5D (B18-002) |
| ~~L-05~~ | Atomic `WHERE status=` guard in `transitionEmailOutboxRow` | 18B-2 (B18-003) |
| ~~L-16-1~~ | Marketing skip-to-content i18n key in all 3 locales | 18B-5 (B18-004) |
| ~~S11A-cap~~ | `PLUS_CAMPAIGN_LIMIT` hardcoded → `getPlanCapabilities()` | 18B-3 (B18-010) |
| ~~21C-ci-gap~~ | No CI job ran the app-layer Vitest suite | Session 22 W1 — `app-tests.yml` |
| ~~21C-pg-oom~~ | CI Postgres OOM made the DB suite an unreliable gate | Session 22 W1 |
| ~~21C-bulk-platform~~ | Bulk approve could not honour a platform filter atomically | Session 22 W2 (A1) |
| ~~21C-dead-params~~ | `campaignId`/`platform` accepted but never passed | Session 22 W2 (A2) |
| ~~B18-085~~ | `formatISO` local-offset audit | Partial — 18B-5D; remainder is **B18-089** above |
| ~~B18-013~~ | `auth_rate_limits` TTL purge | N/A — already wired into `runJanitorTick` (Session 13 D16) |
| ~~B18-032~~ | AI rate-limit verification | N/A — wired and applied since Session 8 |
| ~~B18-044~~ | `vercel.json` cron comment | N/A — `vercel.json` is `{}`; QStash is the active trigger |
| ~~B18-082~~ | `post_metrics` RLS write over-grant | N/A — write policies dropped in migration `…016`; lockdown test added |
| ~~B18-030 / B18-070 / B18-071~~ | Error-cast cleanup, unsound cast in `RegenerateDialog`, PostCard null-metadata | 18B-3D correction pass |

---

## How an item leaves this file

1. **Fixed** — struck through in §6 with the closing session named.
2. **Trigger fired** — moves from §2 into §1, then gets scheduled.
3. **Superseded** — deleted with a one-line note saying what replaced it.
4. **Escalated to scope** — if it turns out to be a feature rather than debt, it moves to
   `pre-launch-scope.md` and is deleted here.
