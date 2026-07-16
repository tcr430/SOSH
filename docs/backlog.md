# SOSH Backlog

Items filed here are known gaps that are safe to defer. Each entry includes the session that filed it and the rationale for deferral.

---

## Pre-launch debt

These items must be resolved before the first paying customer. Ordered by risk.

> **Session 18 cleared all pre-launch debt.** See `docs/session-18-triage.md` for per-item closure evidence.

| ID | File | Description | Closed |
|----|------|-------------|--------|
| ~~A4~~ | `lib/email/errors.ts` | `suppressed` missing from `EmailProviderErrorCode` union (ADR 0008 §4: 6 codes, union had 5). | ✅ 18B-5 (B18-001) |
| ~~E5~~ | `lib/email/templates/_layout.tsx` | Footer text 13 px → 14 px (WCAG 1.4.4); snapshots regenerated. | ✅ 18B-5 + 18B-5D (B18-002) |
| ~~L-05~~ | `lib/email/email-outbox.ts` | Atomic `WHERE status=` guard in `transitionEmailOutboxRow`. | ✅ 18B-2 (B18-003) |
| ~~L-16-1~~ | `app/[locale]/(marketing)/layout.tsx` | Marketing skip-to-content i18n key wired in all 3 locales. | ✅ 18B-5 (B18-004) |

---

## Post-launch / Phase 2

These items are explicitly deferred beyond the first paying customer.

| ID | Area | Description | Filed |
|----|------|-------------|-------|
| G3 | ADR 0008 §10 | T-1 window ADR reconciliation: code uses `[now+1d, now+2d)` ("ends tomorrow"); ADR §10 text says `[now, now+1d)`. Code and tests are internally consistent. Fix: amend ADR §10 to match implementation. | Session 14 Reviewer |
| C7 | ADR 0008 §14 | `email_webhook_events` schema in ADR §14 does not document that `svix-id` is the PK (idempotency anchor), not a payload event id. Reconcile ADR §14 schema block with the shipped migration. | Session 14 Reviewer |
| D3-locale | `lib/email/__tests__/enqueue.test.ts` | Locale-snapshot mutation invariant test missing. Add: enqueue with `locale='pt'`, mutate `businesses.language='es'`, claim row, assert render uses `'pt'`. Locks ADR 0008 §16 snapshot guarantee end-to-end. | Session 14 Reviewer |
| J3 | `lib/observability/sentry-scrub.ts` | Verify `scrubEvent` catches bare email addresses in Resend error message strings (not just key-name based). Resend errors can embed recipient address as a plain string. If not covered, scrub `err.message` before `Sentry.captureException` in the drainer. | Session 14 Reviewer |
| K1 | `lib/email/templates/index.ts` | Two `any` casts (`props`, `React.FC`) with `eslint-disable` comments. Consider a generic `KindEntry<P>` keyed per kind to remove them, or document the exception in CLAUDE.md. | Session 14 Reviewer |
| ~~S11A-cap~~ | `lib/campaigns/enforcement.ts` | `PLUS_CAMPAIGN_LIMIT = 5` hardcoded → read from `getPlanCapabilities()`. Full sweep: grep plan-limit integers across `lib/`. | ✅ 18B-3 (B18-010) |
| 13.5C-log | `app/api/cron/publish/route.ts` | Bearer-side cron-auth-failure does not emit a structured warn log. Add `console.warn(JSON.stringify({ kind: 'cron-auth-failure', route, trigger: 'secret', reason }))` parallel to the QStash branch. | Session 13.5C |
| ~~21C-ci-gap~~ | `.github/workflows/db-tests.yml` | CI runs only `supabase/__tests__` — no job runs the app-layer Vitest suite, so every APV-\*/ROLE-\*/UI-\* test from 21C's approver inbox (and the rest of `lib/`, `app/`) executes locally only. Same covered≠executed trap as 21A, one layer up. | ✅ Session 22 W1 — `app-tests.yml` (required, every push/PR, `tsc`/`eslint`/`vitest run app lib components`) |
| ~~21C-pg-oom~~ | CI infra | CI Postgres OOM / recovery crash (carried over from 21B) makes the DB suite an unreliable merge gate until the stack survives a full run. | ✅ Session 22 W1 — service disables + `config.toml [db.settings]` knobs (verified, not assumed) + skip-guard; `db-tests` promotion (advisory → required) now tracked via the three-green tally in `docs/current-phase.md`, not an open OOM question |
| ~~21C-bulk-platform~~ | `lib/db/posts.ts` (`bulkApproveDraftPosts`) | Add an optional `platform` predicate so bulk approve can honor an active platform filter atomically (single UPDATE), instead of the current 21C/E1 fix (disable bulk while a platform filter is active). Touches a write path shared with the campaigns surface — needs its own review. | ✅ Session 22 W2 (A1) — `bulkApproveDraftPosts(campaignId, platforms?)`, filter-scoped and atomic |
| 21C-pagination | `app/[locale]/(dashboard)/approvals/` | Real cursor pagination/virtualization of the Approvals inbox beyond `APPROVALS_POST_LIMIT` (200). Deferred at launch scale (~50 posts/mo); the 21C/E2 overflow notice, now backed by Session 22 A2's server-side filter-scoped `total`, makes the 200-row truncation honest in the meantime. **Un-defer trigger (sharpened by Session 22 A1.1 `APV-BULK-VISIBLE-ONLY`):** the first business observed with `total > 200` pending drafts. At that point overflow stops being theoretical — `APV-BULK-VISIBLE-ONLY` disables the bulk-approve button whenever the rendered set is incomplete, so a real overflow degrades a live affordance (bulk approve), not just a cosmetic count. Revisit immediately on that signal, not on a calendar date. | Session 21C Reviewer, m1 residual (§4C-c); trigger sharpened Session 22 B6 |
| ~~21C-dead-params~~ | `lib/db/posts.ts` (`listPendingDraftPosts`) | `campaignId`/`platform` params are accepted but never passed by any caller (filtering is client-side in `ApprovalsInbox.tsx`). | ✅ Session 22 W2 (A2) — `listPendingDraftPosts`/`countPendingDraftPosts` honor `campaignId`/`platform` server-side; `page.tsx` passes them from `searchParams` |
| 21B-member-roster | `lib/db/business-members.ts` (`listMembers`) | Any co-member can read the full member roster via the API. This is a **locked ADR 0013 model property**, not a defect — filed for visibility, not for action. | Session 21B/21C Reviewer (§4C-c) |
| 21B-n4 | `app/[locale]/(dashboard)/**` (Server Actions/pages calling `getBusinessForUser`) | Multiple dashboard Server Actions/pages each call `getBusinessForUser(client, userId)` independently within the same request, each issuing its own round-trip query instead of sharing one resolved `business` per request. Correctness is unaffected (the resolver is deterministic and idempotent) — this is a latency/query-count optimization, not a bug. Fix: a request-scoped memo (e.g. React `cache()` around `getBusinessForUser`, or a shared resolution point in the dashboard layout) so repeated calls within one request reuse the first resolution. | ADR 0014 Amendment A0 findings ledger (21B n4) — deferred to backlog at architect time; filed here Session 22 B6 |
| 22-MINOR-5 | `supabase/migrations/` (new, not yet created) | No index covers `lib/db/posts.ts`'s pending-draft count/list predicate `(business_id, status, deleted_at, scheduled_at)`. Existing indexes (`posts_business_id_status_idx (business_id, status)`, `idx_posts_business_scheduled_at (business_id, scheduled_at) WHERE deleted_at IS NULL`) don't cover it. Fine at the 200-row `APPROVALS_POST_LIMIT` cap. Fix (when triggered): `CREATE INDEX ... ON posts (business_id, status, scheduled_at) WHERE deleted_at IS NULL`. **Same un-defer trigger as `21C-pagination` above** — the first business observed with `total > 200` pending drafts (Pro/uncapped-inbox path). Do not create the index before that signal. | Session 22 Reviewer MINOR-5; filed Session 22-D |
| 22-NIT-3 | plugin hygiene (`claude-mem`) | During the Session 22 review, `security-reviewer`'s tool results carried injected text shaped as `<system-reminder>` blocks instructing it to call tools outside its toolset (`get_observations`, `smart_outline`). The agent correctly identified this as untrusted content and ignored it — not a Session 22 code defect. Worth investigating: the `claude-mem` plugin appears to inject instruction-shaped text into subagent tool output, which a less careful agent could follow. | Session 22 Reviewer NIT-3; filed Session 22-D |
