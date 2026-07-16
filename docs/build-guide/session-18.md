# Session 18 — Backlog Triage & Cleanup

> **Goal:** Sweep every accumulated backlog item across `docs/backlog.md`, the session-N review/correction notes, `docs/launch-checklist.md`, `current-phase.md`, and the ADR follow-ups; produce a single triaged inventory; have Tiago adjudicate scope; then execute the approved subset across a series of small Builder sessions.
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7).
> **Plugins:** `claude-mem` (context resumption) and ECC `/ecc:plan` / `tdd-workflow` / `verification-loop` as appropriate per phase. No `impeccable-design-and-taste` — this session is engineering debt, not UI surfaces.
> **Live-mode horizon:** No fixed date. Time budget for Phase B: no limit (stage across multiple Builder sessions).
> **Hard contract:** The Phase A Architect produces a triaged inventory only. No code in Phase A. Builder prompts are drafted *after* Tiago reviews each Phase A output and locks the scope.

---

## Why this session exists

Backlog items have accumulated across at least six surfaces over the last fifteen sessions:

1. `docs/backlog.md` — the explicit deferral list
2. Session review/correction notes embedded in past session-N.md files in `docs/reviews`
3. `docs/launch-checklist.md` — pre-launch blocker rows added across sessions
4. `current-phase.md` "Known gotchas"
5. ADR open-follow-up sections
6. Loose TODO/FIXME/XXX comments in the codebase

No single human can keep all of that in working memory. The risk is that something ships with a quiet correctness hole because it sat on a list nobody re-read, or that something *blocks launch* and only gets noticed the day Stripe is flipped to live mode. The remedy is one Architect pass that surfaces every item in one place, tiers them, and forces explicit adjudication.

---

## Staging plan (post-triage)

After Phase A triage adjudication, work splits into a small read-only RLS probe and five mini-sessions. Each mini-session has its own Architect → Builder → Reviewer cycle where warranted, or just Builder where the design is locked.

| Session | Focus | Items | Est. |
|---|---|---|---|
| **Pre-probe** | RLS verification (read-only) | B18-067, B18-082 | ~15min |
| **18B-1** ✅ | P0 hard-delete cron + RLS lockdown test | B18-012 (+ B18-082 N/A closure + B18-067 lockdown) | done |
| **18B-2** ▶ | Atomic-transition + small security batch | B18-003, -008, -029, -040, -061, -062, -075, -076 | ~3h |
| **18B-3** | Type-quality cross-cutting sweeps | B18-010, -030, -041 (+lint rule follow-up), -069, -070, -071 | ~3.5h |
| **18B-4** | Auth oracle + middleware rename | B18-060 (Option 3), B18-025 | ~2h |
| **18B-5** | Docs + tiny cleanups | Remaining ~20 P1-CHEAP items | ~3h |

Each mini-session resolves its dependency batch from the triage's conflicts-and-dependencies section before the next one starts. Reviewer findings from each mini-session feed back into the triage as P2 items or trigger a small correction pass (18B-Nd shape).

---

## §0 — Required inputs from Tiago (gathered in chat before Phase A)

Two inputs:

1. **Time budget for Phase B**: *No limit*. Stage across multiple Builder sessions.
2. **Live-mode target date**: *No fixed date*. R7 in the triage prompt keeps borderline P1 items at P1 instead of forcing demotion.

---

## §1 — Risks this session is designed against

- **Drive-by scope expansion.** The reviewer cycle has historically generated more items than each correction pass closes; without periodic triage the backlog grows unbounded. Phase A's job is *also* to mark stale items N/A — closing the backlog is as valuable as closing code.
- **Hidden P0 items.** A "gotcha" in `current-phase.md` or a "follow-up" line in an ADR that was never formally tiered might actually be a launch blocker. The triage forces every item into the same tier system regardless of where it was originally written.
- **Conflicting deferrals.** Two items where closing one invalidates the other's "deferred" reasoning. Surfacing these in one document is the only way to spot them.
- **Builder runs ahead.** Without the mandatory stop after each Architect pass, Builder would pick its own subset and Tiago would lose adjudication. The stops are load-bearing safeguards.

---

# Phase A — Architect (triage only)

## Phase A prompt

Paste into a fresh Claude Code Opus 4.7 session.

```text
================================================================
SESSION 18 PHASE A — BACKLOG TRIAGE (ARCHITECT)
================================================================

You are the Architect for SŌSH. This phase produces ONE
deliverable: a triaged backlog inventory. You will NOT write
code, NOT modify migrations, NOT touch ADRs, NOT edit any file
except the new triage file you create. If you find yourself
about to edit anything else, STOP.

Read these files first, in this order. Do not skim — every item
matters.

1. CLAUDE.md — the architectural conventions you must respect
   when tiering (e.g. anything violating CLAUDE.md is at least P1)
2. docs/current-phase.md — full file, including "Known gotchas"
3. docs/backlog.md — the explicit deferral list
4. docs/launch-checklist.md — every row, including completed ones
   (you need to spot rows that say "pending" but are actually done)
5. docs/decisions/ — every ADR file. Look specifically for:
   - sections titled "Open follow-ups", "Deferred", "Future work"
   - Amendment blocks that left items pending
   - any line beginning with "TODO:" or "FOLLOW-UP:" inside an ADR
6. Every file under docs/sessions/ or named session-*.md (wherever
   they live in this repo). Look for:
   - "Deferred" findings in reviewer audits
   - "Backlog" items added during correction passes
   - "Known issues" / "Gotchas" / "Follow-ups" sections
7. The codebase, grep'd for: TODO, FIXME, XXX, HACK, @deprecated,
   "for now", "temporary", "revisit". Scope the grep to:
   app/ lib/ supabase/ scripts/ — exclude node_modules, .next,
   .claude, plugins. Each hit is a candidate item.

Time budget for Phase B (Builder) is: no limit (stage across
multiple Builder sessions).

Live-mode target horizon: no fixed date.

================================================================
STEP 1 — Inventory pass (no tiering yet)
================================================================

Produce a flat list of every backlog candidate found. For each:

  - id: a short slug, e.g. "B18-001-toiso-eslint-rule"
  - source: where you found it (file:line, or session-N §X, or
    ADR-000N §Y, or grep hit with file:line)
  - one-sentence description in YOUR words (not a copy-paste of
    the source — the source might be terse or wrong)
  - original tier if one exists (B/H/M/L, "gotcha", "deferred",
    "follow-up", "TODO comment", or "none")

Report this list back to Tiago in chat as a numbered list BEFORE
moving to Step 2. Tiago may add items or remove false-positives
(e.g. a TODO comment that's actually documentation).

WAIT for Tiago's confirmation before Step 2.

================================================================
STEP 2 — Triage pass
================================================================

For each item from the confirmed Step 1 list, assign a new tier:

  - P0 — Pre-launch blocker. Cannot flip Stripe live mode without
    this. Examples of what qualifies:
      * correctness bug that affects paying customers
      * security hole (RLS gap, leaked PII, auth bypass)
      * legal/compliance gap (claim in /privacy not backed by code)
      * payment-flow bug
      * data-loss risk in any worker
      * anything that breaks if a real user signs up tomorrow

  - P1 — Pre-launch nice-to-have. Should ship if cheap. Estimate:
      * CHEAP: ≤30 min Builder time, isolated, low blast radius
      * EXPENSIVE: >30 min, cross-cutting, or needs design work

  - P2 — Post-launch defer. Reasons that justify P2:
      * needs production data to design correctly
      * cost outweighs benefit at zero users
      * superseded by upcoming Phase 2 work
      * out of scope (not actually a backlog item, but a feature)

  - N/A — Stale. One of:
      * already done in a later session (cite the session/commit)
      * superseded by a different decision (cite the ADR amendment)
      * no longer applicable (dependency removed, etc.)

Tiering rules — apply ALL of them, in order:

  R1. If the item violates CLAUDE.md, minimum tier is P1.
  R2. If the item is a `.toISOString()` ban or similar codebase-
      wide lint rule, tier P1-CHEAP only if zero existing
      violations remain; otherwise P2 (fixing call sites is the
      expensive part, not the rule).
  R3. If the item is "add an integration test for X," tier P2
      unless X is a launch-blocker subsystem with no test coverage
      at all (in which case P0).
  R4. If the item is a metrics/virality/recommendation feature,
      tier P2 (per the memory'd principle: cannot be built well
      pre-launch).
  R5. If the item is a documentation-only change (rename a file,
      update a comment), tier P1-CHEAP.
  R6. If two items conflict or one depends on the other, surface
      this explicitly in §3 below.
  R7. If the time-to-launch is "this week," push borderline P1
      items to P2. If "no fixed date," keep them P1.

For each tier assignment, write ONE sentence of reasoning. Not a
paragraph. One sentence. If you can't justify the tier in one
sentence, the tier is probably wrong.

================================================================
STEP 3 — Conflicts and dependencies
================================================================

In a final section of the triage file:

  - List every pair (or chain) of items where order matters.
  - List every item whose original deferral reasoning is now
    obsolete.
  - List every "while I'm here" temptation you noticed but did
    NOT include as a backlog item. These get their own micro-
    section titled "Out of scope for Session 18" — Tiago decides
    whether any become future sessions.

================================================================
STEP 4 — Write the triage file
================================================================

Create `docs/session-18-triage.md` with the structure:

  # Session 18 Triage
  **Generated:** <ISO date>
  **Phase B time budget:** <60/90/120 or "no limit"> min
  **Live-mode horizon:** <as stated by Tiago>

  ## P0 — Pre-launch blockers
  ### B18-XXX — <slug>
  - Source: <file:line or session-N §X>
  - Original tier: <original>
  - Description: <one sentence>
  - Reasoning: <one sentence justifying P0>
  - Est. Builder time: <Xmin>

  ## P1-CHEAP — Pre-launch nice-to-have (≤30min each)
  ## P1-EXPENSIVE — Pre-launch nice-to-have (>30min each)
  ## P2 — Post-launch defer
  ## N/A — Stale / superseded / already done
  ## Conflicts and dependencies
  ## Obsolete deferral reasoning
  ## Out of scope for Session 18 (candidates for future sessions)

================================================================
STEP 5 — Report and STOP
================================================================

Post in chat:
  - Counts per tier
  - The P0 list with one-line summaries
  - The P1-CHEAP list with one-line summaries and time estimates
  - Any item where you genuinely cannot decide the tier (asks
    Tiago to adjudicate)

Then STOP. Do NOT draft a Builder prompt. Do NOT start
implementing. Tiago will review the triage file end-to-end,
override tiers in chat, and then a Builder prompt will be drafted
from the locked scope.

================================================================
Hard rules — what you must NOT do in Phase A
================================================================

- Do NOT edit any file except docs/session-18-triage.md.
- Do NOT run pnpm install, pnpm build, migrations, or any
  mutating command. Read-only operations only.
- Do NOT decide for Tiago. Surface, tier, recommend, but do not
  silently exclude any item from the triage file.
- Do NOT pad the triage.
- Do NOT start writing prose for ADRs, /privacy, /terms, marketing
  copy, or anything else. Those are not backlog cleanup work.

Confirm you've read this prompt and you're ready to begin Step 1.
```

## Phase A output

`docs/session-18-triage.md` — 64 items tiered. Counts: 1 P0, 30 P1-CHEAP, 7 P1-EXPENSIVE, 22 P2, 4 N/A. Conflicts/dependencies surfaced for atomic-transition family, RLS-posture family, type-quality family, plus the toISOString sweep→lint-rule ordering and the middleware→proxy rename.

## Phase A adjudication

Three decisions locked in chat after reading the triage:

1. **B18-014 (in-app delete account) → P2** (post-launch). Launch posture stays email-based per ADR 0010 A1. B18-015 (A2 amendment to /privacy prose) stays P2, blocked on B18-014.
2. **B18-060 (login email-enumeration oracle) → Option 3**: close the oracle by making login return one generic "invalid credentials" message regardless of state, plus a dedicated `/resend-confirmation` route that always returns "if that email exists, we've resent" (industry-standard pattern; matches the existing `/forgot-password` anti-enumeration posture). Re-priced to ~75min (new route + 3 locale files + `auth_rate_limits` wiring + Supabase `resend()`). Stays P1-EXP.
3. **B18-067 / B18-082** → run a small read-only pre-probe Architect pass before Session 18B-1 to verify whether either escalates to P0.

Triage file also updated mid-session: B18-082 moved from P1-CHEAP to N/A after the pre-probe verified the over-grant policies were dropped in migration 016 and never recreated. The defensive RLS lockdown test bundling B18-082 + B18-067 was folded into Session 18B-1's Builder scope.

---

# Pre-probe — RLS verification (Architect, read-only)

## Pre-probe prompt

Paste into a fresh Opus 4.7 Claude Code session.

```text
================================================================
SESSION 18 — RLS PRE-PROBE (ARCHITECT, READ-ONLY)
================================================================

You are the Architect for SŌSH. This is a small read-only probe
to answer two yes/no questions before Session 18B-1 is scoped.

Do NOT edit any file. Do NOT run migrations. Do NOT modify the
triage file. Read-only operations only (grep, cat, ls, git log,
git blame, sql file inspection are fine; supabase CLI status
read-only commands are fine).

================================================================
Probe 1 — B18-067: trial_state SELECT RLS policy
================================================================

Question: Can a business owner read their own row in `trial_state`
under RLS, and does the policy exist at all?

Steps:

1. Find every migration in `supabase/migrations/` that touches
   `trial_state` (CREATE TABLE, ALTER POLICY, CREATE POLICY,
   DROP POLICY). List them in chronological order with the
   relevant DDL excerpt.

2. From the cumulative migration sequence, determine:
   - Does `trial_state` have RLS enabled?
   - Is there a SELECT policy named anything like
     `trial_state_select_own` (or similar) that grants
     `auth.uid() = owner_user_id` (or whatever the join key is)?
   - If a policy exists, what is its exact USING clause?

3. Grep `lib/db/trial-state.ts` (or equivalent) for the
   SELECT call path. Determine whether the call uses:
   - the anon/RLS client (subject to the policy), or
   - the service-role client (bypasses RLS).

4. If the call uses the RLS client AND no matching SELECT policy
   exists, the trial counter read silently returns null, which
   the calling code's null-fallback then treats as "trial OK" —
   silent bypass. This is the P0 escalation case.

Report verdict as ONE of:
  - VERDICT-067-OK: policy exists and matches the call path
  - VERDICT-067-P0: policy missing or mismatched; null-fallback
    bypasses trial enforcement
  - VERDICT-067-UNCLEAR: cite what you couldn't determine and
    what Tiago needs to check live

================================================================
Probe 2 — B18-082: post_metrics insert/update RLS over-grant
================================================================

Question: Do the `post_metrics_insert_own` and
`post_metrics_update_own` RLS policies grant writes to any
authenticated row owner via a path that crosses tenant
boundaries, or are they limited to self-falsification?

Steps:

1. Find every migration touching `post_metrics` policies.
   Quote the exact USING and WITH CHECK clauses for both the
   INSERT and UPDATE policies as they exist after the most
   recent migration.

2. Trace the join: a row in `post_metrics` belongs to a `post`,
   which belongs to a `campaign`, which belongs to a `business`,
   which is owned by an `auth.users.id`. Confirm the policy
   correctly chains all the way to `auth.uid() = business.owner_user_id`
   (or whatever the chain is), AND that the policy does NOT
   accidentally allow writes to a metrics row whose post's
   campaign's business is owned by someone else.

3. Grep `lib/metrics/` and `app/api/cron/sync-metrics/` (or
   equivalent) for the write call path. Is the write done with
   service-role client (bypasses RLS, RLS is then irrelevant)
   or with an RLS-bound client?

4. Decide the live risk:
   - If writes are service-role only AND the RLS policy is a
     paranoia layer, the over-grant is theoretical and stays P1.
   - If any write path uses an RLS-bound client AND the policy
     chain has a gap, the over-grant is live and escalates P0.

Report verdict as ONE of:
  - VERDICT-082-OK: writes are service-role; RLS is paranoia layer
  - VERDICT-082-P1: RLS-bound write path exists but no cross-tenant
    gap; the over-grant is self-falsification only (keep P1)
  - VERDICT-082-P0: RLS-bound write path exists AND the policy
    chain allows cross-tenant writes
  - VERDICT-082-UNCLEAR: cite what you couldn't determine

================================================================
Report
================================================================

Post in chat:
  - The two verdicts (067 and 082)
  - For each, the migration filename + line range that contains
    the policy you inspected
  - For each, the call-site file:line that does the read/write
  - If either is P0, a one-paragraph description of the minimal
    fix (a migration + which call sites need to be touched)
  - If either is UNCLEAR, the specific thing Tiago needs to check
    against the live Supabase DB

Then STOP. Do not draft a fix. Do not modify any file.
```

## Pre-probe verdicts

- **VERDICT-067-OK** — `trial_state_select_own` policy exists in migration `20260430120007_trial_state.sql:28-34` (recreated with a subquery wrapper in `…120017_fix_rls_function_caching.sql:80-84` for plan caching). RLS-bound call site at `app/[locale]/(dashboard)/campaigns/new/actions.ts:69,92` reads the policy-protected row correctly. Null path is the legitimate "trial hasn't started" case, not an RLS denial. No P0 escalation.
- **VERDICT-082-OK / closeable as N/A** — `post_metrics_insert_own` / `_update_own` / `_delete_own` were **dropped** in `…120016_fix_post_metrics_engagement_rls.sql:8-10` and never recreated. Current cumulative schema has only `post_metrics_select_own`. Writes go through `lib/db/post-metrics.ts` via `createServiceRoleClient()` (RLS bypassed). No authenticated write path exists — the over-grant the backlog item describes is gone. Re-tier B18-082 from P1-CHEAP to N/A; add a defensive RLS lockdown test to Session 18B-1's scope so a future migration can't silently re-introduce a write policy.

Optional belt-and-suspenders before 18B-1: run `\d+ public.trial_state` and `\d+ public.post_metrics` in the Supabase SQL editor. Expected: exactly one SELECT policy on each table, zero write policies.

---

# Session 18B-1 — P0 hard-delete cron + RLS lockdown test

**Scope:** B18-012 (hard-delete cron, the only P0 in the triage) + B18-082 N/A closure with a defensive RLS lockdown test that also covers B18-067.
**Pattern:** Architect-first sub-pattern. The cron is the most consequential item in the triage — it's the GDPR erasure executor, the thing `/privacy` promises exists. Three different ways to break it badly (cascade order, vault step, eligibility predicate). So an Architect mini-pass locks the design as ADR 0010 Amendment 2, Tiago adjudicates, then Builder runs against the locked Amendment, then Reviewer audits.

## Phase A — Architect (cron design → ADR 0010 Amendment 2)

### Phase A prompt

Paste into a fresh Opus 4.7 Claude Code session.

```text
================================================================
SESSION 18B-1 PHASE A — HARD-DELETE CRON DESIGN (ARCHITECT)
================================================================

You are the Architect for SŌSH. This phase produces ONE
deliverable: an Amendment 2 block appended to
`docs/decisions/0010-legal-surface.md`, locking the design of
the hard-delete cron that ADR 0010 A1.4 already promises.

You will NOT write the route, the orchestrator, the migration,
or any test. Builder will, in 18B-1 Phase B, against your locked
Amendment. If you find yourself about to edit anything other
than `docs/decisions/0010-legal-surface.md` and
`docs/session-18-triage.md` (for B18-082 closure), STOP.

================================================================
Required reading, in this order
================================================================

1. CLAUDE.md — architectural conventions
2. docs/decisions/0010-legal-surface.md — the existing ADR you
   are amending (§13 erasure prose, A1.4, business_deletion_requests schema)
3. docs/decisions/0008-transactional-email.md — the cron pattern
   you are mirroring (orchestrator → thin-route, status machine + Amendment 1
   retry, SKIP LOCKED, canonical log shape)
4. docs/decisions/0005-publishing-worker.md including Amendment 1
   — CRON_TRIGGER hard-branch + thin-route convention
5. supabase/migrations/20260614021500_business_deletion_requests.sql
6. supabase/migrations/ in full — for the cascade audit (Step 3)
7. lib/social/vault.ts — vault_delete_secret RPC shape
8. lib/email/orchestrator.ts — canonical orchestrator shape to mirror
9. app/api/cron/drain-email-outbox/route.ts — canonical thin-route shape to mirror

================================================================
STEP 1 — Confirm table schema and surface gaps
================================================================

Read `business_deletion_requests` and report: columns, indexes,
RLS policies, foreign keys. If the schema is missing anything
you'll need (no `last_error`, no `attempts` counter, no
`processed_at`, no status enum value for "failed"), propose the
migration delta as a fenced SQL block. Tiago adjudicates the
delta before you write the Amendment. WAIT.

================================================================
STEP 2 — Status machine
================================================================

Mirror ADR 0008 §6. Propose: status set, legal transitions,
WHERE guards. Each transition is a single UPDATE with both PK
match AND status match in the WHERE clause.

Eligibility predicate for a tick claim:
  - status = 'pending'
  - deletion_requested_at <= now() - INTERVAL '30 days'
    (config'd constant, not literal)
  - OR status = 'failed' AND attempts < max_attempts AND
    next_attempt_at <= now() (mirror ADR 0008 A1)

Propose the exact claim query SQL using SKIP LOCKED, and the
exact WHERE guards for each transition.

================================================================
STEP 3 — Cascade audit (LOAD-BEARING)
================================================================

For every table in the cumulative schema, determine:
  (a) Is the table business-scoped?
  (b) Is there ON DELETE CASCADE from `businesses` to it?
  (c) If yes-and-cascading: nothing needed.
  (d) If yes-but-not-cascading: RPC must DELETE explicitly.
  (e) If it touches vault: special-case. The FK is
      `social_accounts.secret_id → vault.secrets.id`, NOT the
      other direction. Deleting the social_account does NOT
      delete the vault secret. RPC must call
      `vault_delete_secret(secret_id)` per social_account BEFORE
      deleting the social_account row.

Produce a table: | Table | Business-scoped? | Cascades? | Action |
Fill in EVERY business-scoped table.

Two decisions to surface to Tiago in Step 1 chat:
  D1. Audit-trail retention. Some tables should survive purge
      for legal/audit reasons (e.g. billing_events for tax,
      business_deletion_requests itself). Recommend a list.
  D2. PII redaction on retained rows. Propose a redaction pass
      that nulls PII columns on retained rows.

================================================================
STEP 4 — Purge RPC contract
================================================================

Specify the SQL function (SECURITY DEFINER, search_path locked,
service-role only). Single implicit transaction. Returns jsonb
summary: rows deleted per table, vault secrets deleted count,
redacted-rows count.

Order: vault secrets first (one call per social_account), then
explicit non-cascading deletes in dependency order, then
DELETE FROM businesses (cascades the rest).

================================================================
STEP 5 — Orchestrator and route shape
================================================================

Specify:
  - lib/deletion/orchestrator.ts → runDeletionTick(): Promise<TickResult>
  - Three canonical JSON log lines: deletion-tick-start /
    deletion-row-processed / deletion-tick-end
  - Config additions to lib/config.ts: DELETION_RETENTION_DAYS=30,
    DELETION_MAX_ATTEMPTS=5, DELETION_RETRY_BACKOFF_BASE_MINUTES=60
  - app/api/cron/process-deletions/route.ts mirroring drain-email-outbox
    (CRON_TRIGGER hard-branch, QStash signature verification, 405 in
    secret branch)

QStash schedule: daily, 03:00 UTC (no contention with publishing
= 5min, metrics = hourly, email = 1min). Tiago confirms.

================================================================
STEP 6 — Tests Builder will write
================================================================

Specify, do NOT write:
  - lib/deletion/orchestrator.test.ts (mock-driven, mirror email orchestrator)
  - lib/deletion/__integration__/purge-business.test.ts (gated on
    DELETION_INTEGRATION_TEST_ENABLED)
  - supabase/__tests__/post-metrics-rls.test.sql (B18-082 closure):
    assert post_metrics has exactly one policy post_metrics_select_own
    (SELECT) and zero INSERT/UPDATE/DELETE policies for authenticated.

================================================================
STEP 7 — Write the Amendment
================================================================

Append to docs/decisions/0010-legal-surface.md:
  ## Amendment 2 — Hard-Delete Cron (YYYY-MM-DD)
  ### Status / Context / Decision / Consequences / CLAUDE.md addition

Every claim must trace to existing ADR 0010, the cascade audit,
or a Tiago-chat decision.

================================================================
STEP 8 — Report and STOP
================================================================

Post:
  - Step 1 schema gaps + proposed migration delta
  - Step 3 D1 audit-retention list + D2 redaction list
  - Step 3 cascade table (full)
  - Step 5 schedule confirmation (03:00 UTC OK?)
  - Step 6 optional B18-067 defensive test decision
  - Confirmation that the Amendment has been written

Then STOP.

================================================================
Hard rules
================================================================

- Do NOT modify any file except
  docs/decisions/0010-legal-surface.md (append Amendment 2),
  CLAUDE.md (one rule add), and optionally
  docs/session-18-triage.md (B18-082 closure).
- Do NOT write any SQL migration file, orchestrator, route,
  test, or new lib/ file.
- Do NOT skip the cascade audit, even if tedious.
- Do NOT propose a new architecture; mirror the existing pattern.

Confirm you've read the prompt and the listed files, then begin Step 1.
```

### Phase A adjudication

The Architect surfaced **D3** (`auth.users` identity row), which was not in the prompt — a real gap. Erasure that leaves the email and name in `auth.users` is not erasure.

Locked decisions:

1. **GAP 1 FK fix → DROP FK.** `business_deletion_requests.business_id` retained as bare uuid NOT NULL. The audit row's purpose at rest is to be a record keyed on a `business_id` that no longer exists; preserving referential integrity to a deleted parent is the wrong semantic. SET NULL would erase *which* business was purged.
2. **Migration delta** (state-machine columns, FK drop, claimable-status index, updated_at trigger) → approved as-is.
3. **D1 retention list** → `billing_events` (tax/audit, 10-year retention) and `business_deletion_requests` (erasure-audit proof) only.
4. **D2 redaction** → on `billing_events`, null `stripe_customer_id` and replace `payload` with `{redacted:true, type}`. PK `id` retained (opaque pseudonymous Stripe event ref).
5. **D3 (`auth.users` deletion) → in scope.** Orchestrator calls `supabase.auth.admin.deleteUser(owner_id)` AFTER `purge_business` returns success, guarded by `SELECT EXISTS(SELECT 1 FROM businesses WHERE owner_id = $1 LIMIT 1)`. If owner still has another business, skip and log `auth_user_deleted: false`. RPC made idempotent against "business already deleted" via `IF NOT EXISTS(...) THEN RETURN jsonb_build_object('already_purged', true)`.
6. **Schedule** → daily 03:00 UTC via QStash (no contention with publishing/metrics/email/janitor).
7. **B18-067 defensive test** → include. Same SQL test file as B18-082 lockdown. Rename to `supabase/__tests__/rls-policy-lockdown.test.sql` to cover both tables.
8. **B18-082 triage closure** → in same turn as Amendment 2, citing migration 016.
9. **Failure-class taxonomy added to Amendment** → transient (retry: SQLSTATE 55P03 / 40P01 / 40001, network errors), permanent (abandon immediately: 23502 / 23514 and other unrecoverable constraint violations), success-equivalent (RPC `{already_purged:true}` → mark completed, attempt the auth delete).

Architect produced Amendment 2 with all decisions encoded across §D2.1–§D2.10, plus the CLAUDE.md cascade-review rule: *"Any migration that adds a business-scoped table (or any table reachable only via a `business`) must, in the same PR, add a row to ADR 0010 Amendment 2's cascade table (§D2.5) and ensure the table either cascades from `businesses` ON DELETE or is explicitly purged/retained in `purge_business`."*

## Phase B — Builder

### Phase B prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-1 PHASE B — HARD-DELETE CRON (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-1. The Architect locked
the design in ADR 0010 Amendment 2 (sections D2.1 through D2.10).
Your job is to implement it character-faithful to the Amendment.

You will NOT redesign anything. If you find yourself wanting to
change a status name, a log field, a config key, the schedule
time, the cascade table, the failure taxonomy, the retention list,
or any other locked decision — STOP and surface it. The Amendment
is the spec; Builder is transcription + glue.

If you discover a genuine impossibility (a constraint the Amendment
specifies cannot be enforced as written), STOP, post the conflict,
and wait for Tiago. Do not silently drop or improvise.

================================================================
Required reading, in this order
================================================================

1. CLAUDE.md
2. docs/decisions/0010-legal-surface.md — end-to-end, with close
   attention to Amendment 2 (§D2.1 through §D2.10). This is your spec.
3. docs/decisions/0008-transactional-email.md including Amendment 1
4. docs/decisions/0005-publishing-worker.md Amendment 1
5. lib/email/orchestrator.ts — verbatim pattern to mirror
6. app/api/cron/drain-email-outbox/route.ts — verbatim pattern to mirror
7. lib/email/orchestrator.test.ts — test style to mirror
8. lib/social/vault.ts — vault_delete_secret invocation today
9. supabase/migrations/20260614021500_business_deletion_requests.sql
10. lib/config.ts
11. docs/launch-checklist.md — §17-F-11 and A1.4 F-1 are what you'll update

Confirm in chat that you've read these and understand:
- the ADR 0008 split (RPC owns purge mechanics; orchestrator
  owns state transitions)
- the failure-class taxonomy (D2.8)
- the auth.users deletion ordering (D2.7)

Time budget: ~150 min. If you blow 60 min on any single step, STOP.

================================================================
STEP 1 — Migration
================================================================

Create supabase/migrations/<next-UTC-timestamp>_deletion_cron_state_machine.sql
containing, in this exact order:

1. The four D2.1 ALTER TABLE / CREATE INDEX / CREATE TRIGGER statements verbatim.
2. The claim_deletion_requests(int,int,int) function from D2.3 verbatim.
3. The purge_business(uuid) function from D2.4 verbatim (including
   the {already_purged:true} short-circuit).
4. REVOKE/GRANT for both functions.

DO NOT add anything beyond D2.1, D2.3, D2.4.

Run `npm run db:migrate`. Verify:
  \d+ public.business_deletion_requests
  \df+ public.claim_deletion_requests
  \df+ public.purge_business
Confirm vault_delete_secret(uuid) exists and is service-role callable.

Commit: "feat(deletion): state-machine columns + claim/purge RPCs (ADR 0010 A2 §D2.1/2.3/2.4)"

================================================================
STEP 2 — Config
================================================================

Add to lib/config.ts under config.server:
  DELETION_RETENTION_DAYS: number = 30
  DELETION_MAX_ATTEMPTS: number = 5
  DELETION_RETRY_BACKOFF_BASE_MINUTES: number = 60

Mirror the existing email-drain config keys' shape exactly.
Add to .env.local.example with comments.

Commit: "feat(config): deletion cron tunables (ADR 0010 A2 §D2.9)"

================================================================
STEP 3 — Orchestrator
================================================================

Create lib/deletion/orchestrator.ts mirroring lib/email/orchestrator.ts.

Required exports:
  export type DeletionTickSummary = {
    claimed: number; purged: number; retried: number;
    abandoned: number; durationMs: number;
  };
  export async function runDeletionTick(opts: {
    triggeredBy: 'qstash' | 'secret';
  }): Promise<DeletionTickSummary>;

For each claimed row, in a per-row try/catch:
  a. Read owner_id from businesses WHERE id = row.business_id BEFORE
     calling purge (the auth delete needs it after the business is gone).
  b. Call purge_business(row.business_id).
  c. If RPC returns {already_purged:true}: treat as success-equivalent,
     proceed to (d).
  d. D2.7 multi-business guard: count remaining businesses for owner_id.
     If zero, call supabase.auth.admin.deleteUser(owner_id). Record
     auth_user_deleted: true/false for the log line.
  e. Transition processing → completed atomically (WHERE id = $1 AND
     status = 'processing'), set purged_at = now().

On error: classify per D2.8.
  - Permanent (23502, 23514): processing → abandoned, Sentry.captureException
    with class metadata.
  - Transient or generic: if attempts+1 >= max, transition to abandoned +
    Sentry. Else: failed, attempts++, next_attempt_at = now() + computeBackoff,
    set last_error.

computeBackoff: mirror lib/email/orchestrator.ts exactly, but in MINUTES,
using DELETION_RETRY_BACKOFF_BASE_MINUTES. Cap at 24h.

Three canonical JSON log lines (D2.9):
  - deletion.tick.start: { kind, triggeredBy, claimed }
  - deletion.row.processed: { kind, request_id, business_id, outcome,
    attempts, vault_secrets_deleted, billing_events_redacted,
    auth_user_deleted }
  - deletion.tick.end: { kind, triggeredBy, ...summary }
No fields beyond what D2.9 specifies. No PII in any log line.

CRITICAL: every state transition is a single UPDATE with WHERE id AND
WHERE status (CLAUDE.md atomic-transition rule).

Commit: "feat(deletion): runDeletionTick orchestrator (ADR 0010 A2 §D2.7/2.8/2.9)"

================================================================
STEP 4 — Cron route
================================================================

Create app/api/cron/process-deletions/route.ts as a structural mirror of
app/api/cron/drain-email-outbox/route.ts.

- force-dynamic, runtime='nodejs', maxDuration=60
- Read config.server.CRON_TRIGGER
- If 'qstash': POST handler, QStash signature verify, call
  runDeletionTick({ triggeredBy: 'qstash' }). GET → 405.
- If 'secret': same Bearer-token guard the drain route uses. POST → 405.
- Return { ok: true, ...summary } on success.
- On error: structured-log, return 500.

Do NOT emit tick log lines from the route — orchestrator owns those.

Commit: "feat(deletion): /api/cron/process-deletions route (ADR 0010 A2 §D2.9)"

================================================================
STEP 5 — Tests
================================================================

a. lib/deletion/orchestrator.test.ts (mock-driven). Cover:
   - eligible pending → purged (with and without multi-business guard tripping)
   - requested_at = now() - 29 days → not claimed
   - verified_at IS NULL → not claimed (forge defense)
   - RPC returns {already_purged:true} → completed
   - RPC throws transient (55P03) → failed + attempts++ + next_attempt_at
   - RPC throws permanent (23502) → abandoned immediately + Sentry
   - failed past next_attempt_at → re-claimed
   - attempts == max after transient → abandoned + Sentry
   - SKIP LOCKED no double-claim
   - log lines: exact field set, no PII

b. lib/deletion/__integration__/purge-business.test.ts (gated on
   DELETION_INTEGRATION_TEST_ENABLED).
   Seed full business graph + vault secrets → run tick → assert:
   - Zero rows for that business_id across all purged tables
   - Vault secrets gone (direct vault.secrets query)
   - billing_events retained with business_id=NULL, stripe_customer_id=NULL,
     payload={redacted:true,type:...}
   - business_deletion_requests retained status='completed'
   - auth.users row for the owner is GONE (and the multi-business
     case: row survives)

c. supabase/__tests__/rls-policy-lockdown.test.sql (D2.10 bundles B18-082
   + B18-067):
   - post_metrics: exactly one policy post_metrics_select_own (SELECT to
     authenticated); zero INSERT/UPDATE/DELETE policies for authenticated.
   - trial_state: exactly one policy trial_state_select_own (SELECT only).

If SOSH doesn't have a SQL test harness, surface in chat — fallback is a
vitest test querying pg_policies via service-role client.

Commit: "test(deletion): orchestrator unit + purge integration + RLS lockdown (ADR 0010 A2 §D2.10)"

================================================================
STEP 6 — QStash schedule
================================================================

Daily 03:00 UTC. Schedule name: process-deletions-daily-0300z. Retries: 0.

If scripts/qstash-*.ts or docs/runbooks/qstash-*.md exists, add the entry.
If not, surface in chat — do NOT make up infrastructure.

Append to docs/launch-checklist.md §17-F-11 noting the schedule and A2.

Commit: "chore(deletion): qstash schedule + launch-checklist update (ADR 0010 A2 §D2.9)"

================================================================
STEP 7 — Launch-checklist, current-phase, triage
================================================================

- launch-checklist.md §17-F-11: shipped, reference ADR 0010 A2.
- launch-checklist.md A1.4 F-1: resolved by A2.
- current-phase.md: status → "Session 18B-1 Builder complete". Add
  Session 18B-1 block. Under Key Decisions: paragraph summarizing
  D2.7 auth-delete ordering + D2.8 failure taxonomy.
- session-18-triage.md: B18-012 marked ✅ shipped, cite migration.

Commit: "docs: close B18-012 (hard-delete cron) per ADR 0010 A2"

================================================================
STEP 8 — Verify
================================================================

Run /everything-claude-code:verify. Must check:
- tsc clean
- lint clean (no console.*, any, process.env outside lib/config.ts)
- Scoped vitest passes (per current-phase.md path list, adding lib/deletion)
- supabase db reset && npm run db:migrate re-applies all migrations cleanly
- Route smoke: POST with correct CRON_TRIGGER auth → 200; wrong-method → 405
- Integration test GATED OFF in CI as expected

If any check fails, STOP and surface.

================================================================
Hard rules
================================================================

- Do NOT edit ADR 0010. Amendment is locked.
- Do NOT add columns/indexes/triggers/grants beyond D2.1.
- Do NOT change status names, log field names, config key names, or
  schedule.
- Do NOT add console.*, any, or process.env outside lib/config.ts.
- Do NOT introduce a new mocking library, structured logger, SQL test
  harness, or Sentry helper. Reuse what email-drain uses.
- Do NOT implement in-app Delete Account (B18-014 is P2).
- Do NOT silently catch errors anywhere.
- Do NOT commit before the migration applies cleanly.

Confirm reading, report your reading of the existing email orchestrator
(file:line ranges of mirrored functions), then begin Step 1.
```

## Phase C — Reviewer

### Phase C prompt

Paste into a fresh Opus 4.7 Claude Code session, ideally clean (not the Builder session).

```text
================================================================
SESSION 18B-1 PHASE C — REVIEWER (PARALLEL TS + SECURITY)
================================================================

You are the Reviewer for SŌSH Session 18B-1. The Builder
implemented ADR 0010 Amendment 2 — the hard-delete cron that
executes GDPR Art. 17 erasure. You will run two parallel review
lenses (typescript-reviewer and security-reviewer), then
synthesize findings into one report with B/H/M/L tiering. You
will NOT modify any code. Correction is a separate pass.

This review is high-stakes. The subsystem under review is the
mechanism that turns a /privacy promise into reality. A finding
you miss here is one that surfaces in a regulator complaint or
an enterprise security questionnaire. Be paranoid; over-flag
rather than under-flag.

================================================================
Required reading
================================================================

1. docs/decisions/0010-legal-surface.md, full file, with special
   attention to Amendment 2 (§D2.1–§D2.10).
2. CLAUDE.md, in full.
3. docs/decisions/0008-transactional-email.md including Amendment 1
4. docs/decisions/0005-publishing-worker.md Amendment 1
5. The Builder's diff for Session 18B-1. Find via:
     git log --since="<date>" --pretty=oneline
   Read every changed file in full.
6. lib/email/orchestrator.ts and app/api/cron/drain-email-outbox/route.ts
7. The new migration file, line by line.
8. supabase/migrations/20260614021500_business_deletion_requests.sql

================================================================
LENS 1 — typescript-reviewer
================================================================

T1. no any, no console.*, no process.env outside lib/config.ts.
T2. SDK calls through gateway abstractions; service-role client via lazy import.
T3. Timestamps via date-fns formatISO, never .toISOString().
T4. Atomic state transitions: every UPDATE has both WHERE id AND WHERE status.
T5. Three canonical log lines fire exactly once each with exactly D2.9 fields, no PII.
T6. DeletionTickSummary shape matches D2.9 exactly.
T7. Per-row try/catch: one failure does not poison the whole tick.
T8. Thin route: no business logic, just trigger/auth + orchestrator call.
T9. Sentry.withMonitor('process-deletions', …) wraps the whole tick.
T10. computeBackoff uses MINUTES, capped at 24h. Verify against email-drain.
T11. Three config keys match D2.9 names/defaults; Zod schema consistent.
T12. Migration file: no extras beyond D2.1/2.3/2.4. Monotonic-UTC filename.
T13. Tests match D2.10. Integration gated. RLS test covers BOTH tables.
T14. No unbounded queries.
T15. Error handling discriminates SQLSTATEs (data-driven, not string-match on message).

================================================================
LENS 2 — security-reviewer (load-bearing)
================================================================

S1. **Cascade completeness.** Re-derive business-scoped table list from migrations
    (not D2.5); verify each cascades or is handled.
S2. **Vault completeness.** Both vault_access_token_id and vault_refresh_token_id
    deleted per social_account. UNION ALL correctness on NULL columns.
S3. **auth.users deletion.** owner_id read BEFORE purge_business. Multi-business
    guard correct (EXISTS not COUNT). Auth-delete failure doesn't lose the purge.
S4. **Verification gate.** claim_deletion_requests filters verified_at IS NOT NULL
    in SQL itself, not orchestrator. Forged unverified row CANNOT be claimed
    even bypassing orchestrator.
S5. **Privilege escalation.** Both new functions SECURITY DEFINER, search_path
    locked to `public, pg_temp` (not `public, $user, pg_temp`), REVOKE FROM public
    + GRANT TO service_role only.
S6. **PII in logs.** Walk every log line, Sentry capture, error message.
    No email, name, owner_id. business_id is fine post-deletion. last_error may
    embed values from Postgres CHECK violations — flag.
S7. **PII in scrubbed billing_events.** D2.6 nulls stripe_customer_id and
    replaces payload. Verify Builder did exactly that, nothing more. Check no
    email/name column was added to billing_events since Phase A.
S8. **TOCTOU on multi-business guard.** Between EXISTS check and admin.deleteUser,
    could the same owner sign up for a new business? Flag and document.
S9. **vault_delete_secret idempotency.** Twice-called same secret_id — does it
    error? If yes, the whole purge rolls back; attempts ratchets despite
    secret-actually-gone.
S10. **Race between claim and purge.** Mid-purge crash → vault gone, business
     remains. Re-claim re-runs RPC on already-deleted secret IDs. S9 outcome
     decides safety.
S11. **QStash signature verification** — same posture as drain-email-outbox.
S12. **Bearer-token entropy** — timing-safe compare; no early-return length leak.
S13. **Migration safety under concurrent load.** ALTER TABLE with NOT NULL +
     default — verify Postgres version supports metadata-only path.
S14. **RLS lockdown test scope.** Test ITSELF needs privileges to query
     pg_policies. Verify it runs under service-role; otherwise passes for the
     wrong reason.
S15. **Integration test cleanup.** afterEach/afterAll cleanup, or test isolation,
     so a failed run doesn't leave partial rows.
S16. **`{already_purged:true}` short-circuit edge.** RPC called with never-existed
     business_id — orchestrator captured owner_id BEFORE? Might be NULL; auth
     delete becomes deleteUser(undefined). What happens?

================================================================
SYNTHESIS
================================================================

Reconcile overlapping findings, write docs/session-18b1-review.md with
B/H/M/L sections.

Tiering: be aggressive on S2/S3/S4/S5 family — anything that MIGHT cause silent
erasure failure goes to B by default; downgrade only with explicit reasoning.

Report in chat: counts per tier, full B and H lists, path to review file.
Then STOP.

================================================================
Hard rules
================================================================

- Do NOT modify any code, test, migration, or ADR.
- Do NOT modify the triage file.
- ONLY new file: docs/session-18b1-review.md.
- Do NOT downgrade a security finding without one explicit sentence of reasoning.
- Do NOT accept the Builder's commit message as evidence — read the diff.
- Do NOT skip a check because "email orchestrator does the same thing" —
  that's a finding too.

Confirm reading and Builder-commit identification, then begin Lens 1.
```

### Adjudication

After Reviewer reports:
- B findings → 18B-1D correction pass (small Builder, same shape as prior 14D/15D)
- H findings disagreed with → override in chat with explicit technical reasoning
- M/L → add to `docs/session-18-triage.md` as P2

If zero B findings, skip 18B-1D and move directly to Session 18B-2.

---

# Session 18B-2 — Atomic-transition + small security batch

**Status:** ✅ Complete. 18B-2D correction pass applied (M1–M4). B18-003/008/029/040/061/062/075/076 shipped.

**Scope (items from triage):**
- B18-003 — outbox-atomic-guard
- B18-008 — scrub-bare-email
- B18-029 — ssrf-extra-ranges
- B18-040 — updatecampaign-atomic-guard
- B18-061 — email-homoglyph (NFKC normalize)
- B18-062 — safe-redirect-decode
- B18-075 — publish-metadata-rpc (single-statement RPC; needs a new migration)
- B18-076 — redacttokens-value-scan

**Est:** ~3h.

**Pattern:** Builder-led, no full Architect pass. Seven of the eight items mirror existing well-established patterns (atomic-guard `WHERE id AND WHERE status`, SSRF allow-list, redaction helper, URL canonicalization) with locked design choices specified inline below. The eighth — B18-075 — is the only genuine design surface (a new RPC + migration); the Builder handles it via a Step 0 design check in chat before implementation, rather than a separate Architect phase. If Step 0 surfaces anything non-trivial, Tiago promotes B18-075 to its own mini-Architect pass.

## Locked design choices

These are the decisions Builder will not improvise on. Specified here so the Builder prompt can reference them rather than re-derive:

1. **B18-061 (email-homoglyph) → NFKC + lowercase, NOT full punycode/IDN.** For B2B with work-email domains on the Latin alphabet, NFKC normalization catches the practical homoglyph cases (Cyrillic 'а' vs Latin 'a', fullwidth, ligatures) at a fraction of the cost. Full punycode→ASCII is deferred to P2 if an actual IDN-based attack ever surfaces. Apply at email canonicalization (the point used for uniqueness lookup at signup and login); store the normalized form, compare against it.
2. **B18-029 (ssrf-extra-ranges) → add exactly these CIDR ranges to the SSRF block-list:** link-local `169.254.0.0/16`, CGNAT `100.64.0.0/10`, Class E `240.0.0.0/4`, broadcast `255.255.255.255/32`, TEST-NET-1/2/3 `192.0.2.0/24` + `198.51.100.0/24` + `203.0.113.0/24`, benchmark `198.18.0.0/15`, IPv6 ULA `fc00::/7`, IPv6 link-local `fe80::/10`, IPv6 documentation `2001:db8::/32`. The existing RFC1918 + loopback blocks stay. One unit test per range asserting the block.
3. **B18-062 (safe-redirect-decode) → recursive `decodeURIComponent` bounded at depth 3, then validate.** A single decode pass is bypassable by double-encoding (`%25%32%66` → `%2f` → `/`). Three iterations catches realistic abuse without becoming a DoS surface; if iteration 3 still differs from iteration 2, reject the URL outright. Validate the *decoded* form against the host/path allow-list.
4. **B18-076 (redacttokens-value-scan) → value-scan via regex set, bounded depth 5.** Patterns: email (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}`), JWT (`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), Stripe keys (`sk_(live|test)_[A-Za-z0-9]{24,}`), generic bearer-ish hex (`[a-f0-9]{32,}`). Applied in the same redactor used by the existing `REDACTED_KEYS` key pass. Depth 5 prevents pathological object traversal cost.
5. **B18-008 (scrub-bare-email) → folds into B18-076's value-scan**, BUT Builder must first grep to identify the specific leak point (probably a Sentry `beforeSend` path, or a log line that bypasses the redactor). The redactor extension closes the class; the grep confirms there's no separate code path that needs an explicit fix.
6. **B18-003 / B18-040 (atomic guards) → mirror the email-outbox / deletion-cron pattern exactly.** Every status UPDATE has `WHERE id = $1 AND WHERE status = '<source>'` in the same statement. No read-then-update anywhere in the email outbox transitions or in `updateCampaign`.
7. **B18-075 (publish-metadata-rpc) → design check first, no improvisation.** Builder reports the current publish-success update path (file:line ranges, the columns updated, the order) and proposes a single-statement RPC that consolidates them. Waits for chat confirmation before writing the migration.

## Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-2 — ATOMIC-TRANSITION + SMALL SECURITY BATCH (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-2. Eight items from
the Session 18 triage, locked design choices specified in
session-18.md §"Session 18B-2 — Locked design choices."

You will NOT redesign anything except B18-075, where Step 0
asks you to report findings and WAIT for Tiago's confirmation
before implementation. If you find yourself wanting to deviate
from a locked design choice for any other item, STOP and surface.

Time budget: ~3 hours total. If any single step blows 45 min,
STOP and report.

================================================================
Required reading
================================================================

1. CLAUDE.md — especially: atomic conditional state transitions,
   REDACTED_KEYS pattern, no console.*, no any, no process.env
   outside lib/config.ts.
2. docs/session-18.md §"Session 18B-2 — Locked design choices" —
   your spec for every item except B18-075.
3. docs/session-18-triage.md — find each item's row, read its
   "Source" line, follow it to the underlying code.
4. lib/email/orchestrator.ts — the atomic-guard pattern you are
   mirroring for B18-003.
5. lib/deletion/orchestrator.ts (from 18B-1) — the same pattern,
   freshly reviewed.
6. lib/security/safe-redirect.ts (or wherever the safe-redirect
   helper lives) — for B18-062.
7. lib/security/ssrf.ts (or wherever the SSRF allow-list lives)
   — for B18-029.
8. lib/observability/redact.ts (or wherever REDACTED_KEYS lives)
   — for B18-076 and B18-008.
9. lib/auth/ + lib/db/users.ts (or signup/login paths) — for
   B18-061's canonicalization touchpoint.
10. lib/db/campaigns.ts — for B18-040.
11. The publishing worker (lib/publishing/ + the post-success
    update path) — for B18-075 Step 0.

Confirm in chat what you've read and report:
- the file:line where each item lives
- which existing pattern you'll mirror for each
- one sentence per item on what the change looks like

WAIT for Tiago's greenlight before Step 0.

================================================================
STEP 0 — B18-075 design check (DO NOT WRITE CODE YET)
================================================================

Open the post-publish-success update path. Identify:
  - Which file:lines update the post row after a successful
    publish (status, social_post_id, published_at, anything else)
  - Whether those updates are currently one UPDATE, multiple
    UPDATEs, or scattered across functions
  - Whether the current shape has an atomic-guard hole
    (status changes that aren't WHERE status = '<source>')

Propose:
  - The exact RPC signature: `publish_complete(p_post_id uuid,
    p_social_post_id text, p_published_at timestamptz, ...)
    RETURNS jsonb` — adjust columns to what's actually updated
  - The exact RPC body: single UPDATE with WHERE id AND
    WHERE status = 'publishing', returning updated row or
    jsonb summary
  - REVOKE/GRANT (service-role only, SECURITY DEFINER,
    search_path = public, pg_temp)
  - Which call sites get rewritten to call the RPC instead of
    direct table updates

Report in chat, then STOP. Do NOT write the migration, the RPC,
or rewrite any call site until Tiago confirms.

================================================================
STEP 1 — B18-075 implementation (after Step 0 greenlit)
================================================================

a. Create supabase/migrations/<next-UTC-timestamp>_publish_complete_rpc.sql
   with the RPC + REVOKE/GRANT exactly as confirmed in Step 0.
b. Run `npm run db:migrate`. Verify the RPC exists with the
   correct signature.
c. Rewrite the identified call sites to call the RPC. Delete
   the now-dead direct-update code.
d. Update any test that mocks the old update path to mock the
   new RPC call.

Commit: "feat(publishing): atomic publish_complete RPC (B18-075)"

================================================================
STEP 2 — B18-003 outbox-atomic-guard
================================================================

In lib/email/orchestrator.ts (and any helper it calls in lib/db/
that does an email_outbox status UPDATE), audit every status
transition. Each must be a single UPDATE with both:
  WHERE id = $1 AND status = '<source>'

If any UPDATE lacks the status guard, add it. If any UPDATE is
preceded by a SELECT to "check current status," collapse them
into a single UPDATE.

Tests: each fixed transition gets a test where the row is in
a wrong source status — the UPDATE must affect zero rows, and
the orchestrator must handle "zero affected" as a no-op (not
an error).

Commit: "fix(email): atomic guards on email_outbox transitions (B18-003)"

================================================================
STEP 3 — B18-040 updatecampaign-atomic-guard
================================================================

In lib/db/campaigns.ts (or equivalent), find updateCampaign and
any related state-mutating helpers. Apply the same atomic-guard
treatment as Step 2. Tests in the same style.

Commit: "fix(campaigns): atomic guards on updateCampaign (B18-040)"

================================================================
STEP 4 — B18-029 ssrf-extra-ranges
================================================================

Add the ten CIDR ranges from §"Locked design choices" item 2
to the SSRF block-list. Order them after the existing RFC1918 +
loopback entries; group with a comment "Additional reserved
ranges (B18-029 / RFC 6890, RFC 5737, RFC 2544, RFC 4193)."

One unit test per range, asserting that a representative IP
in the range is blocked. Use IPs at the middle of the range,
not the network or broadcast address.

Commit: "feat(security): expand SSRF block-list to RFC 6890 ranges (B18-029)"

================================================================
STEP 5 — B18-062 safe-redirect-decode
================================================================

Wrap the existing safe-redirect validation: BEFORE checking the
URL against the allow-list, recursively decodeURIComponent up
to 3 iterations, stopping when the decoded string equals the
input (idempotent). If iteration 3 still differs from iteration
2, REJECT the URL outright (treat as untrusted, redirect to the
default safe path).

Validate the FINAL decoded form, not the original input. Tests:
  - Plain URL → passes through unchanged → validated
  - Single-encoded `%2f%2fattacker.com` → decoded → blocked
  - Double-encoded `%25%32%66...` → decoded twice → blocked
  - Triple-encoded malicious URL → decoded thrice → still
    different from previous iteration → rejected
  - Idempotent ASCII URL → no infinite loop

Commit: "fix(security): recursive decode before safe-redirect validation (B18-062)"

================================================================
STEP 6 — B18-061 email-homoglyph
================================================================

Find the email canonicalization helper (the one called at signup
and login before the uniqueness lookup). Apply:
  email.normalize('NFKC').toLowerCase().trim()
BEFORE comparing or storing.

If the helper doesn't exist yet, create it at lib/auth/email.ts
exporting `canonicalizeEmail(input: string): string`. Wire it
into signup, login, password-reset, resend-confirmation — every
path that takes an email from user input.

Tests:
  - Plain ASCII email → unchanged (modulo lowercase)
  - Cyrillic 'а' vs Latin 'a' → normalize to the same form
    (caveat: NFKC does NOT collapse these; this test exists
    to DOCUMENT the limitation. NFKC catches fullwidth,
    ligatures, compatibility forms; it does not catch
    cross-script lookalikes.)
  - Fullwidth 'ＡＢＣ@example.com' → 'abc@example.com'
  - Trailing/leading whitespace → stripped
  - Mixed case → lowercased

NOTE: if your test reveals NFKC does not catch Cyrillic-а, that
is the documented limitation. Do NOT add cross-script blocking
or punycode in this session — that's a P2 escalation per the
locked design choice.

Commit: "feat(auth): NFKC email canonicalization (B18-061)"

================================================================
STEP 7 — B18-076 redacttokens-value-scan
================================================================

Extend the existing redactor (the one that uses REDACTED_KEYS)
with a value-scan pass:
  - After the key-based redaction, walk the object recursively
    (bounded depth = 5)
  - For each string value, apply the regex set from §"Locked
    design choices" item 4
  - Replace matches with '[REDACTED]' in-place

Performance: skip recursion into arrays > 100 elements (return
`['[ARRAY_TRUNCATED]']`); skip into objects with > 50 keys.

Tests:
  - Email value at depth 2 → redacted
  - JWT value at depth 4 → redacted
  - Stripe sk_live_… → redacted
  - Long hex string (32+ chars) → redacted
  - Same key + non-matching value → untouched
  - Cycle (a.b = a) → handled without stack overflow
  - Depth-6 nesting → not traversed past 5

Commit: "feat(observability): value-scan pass in token redactor (B18-076)"

================================================================
STEP 8 — B18-008 scrub-bare-email (grep first, fix conditionally)
================================================================

Grep the codebase for places where an email address could leak
to Sentry, structured logs, or any external output. Targets:
  - Sentry.captureException / .captureMessage calls — does any
    pass user data without going through the redactor first?
  - Direct error throw paths where the error message includes
    a user-supplied email
  - Any structured log line that includes an email field

Report findings in chat. For each finding, decide:
  - Goes through the redactor (now extended in Step 7) → covered,
    nothing to do
  - Bypasses the redactor → needs an explicit code fix

If everything is covered by the Step 7 extension, this item
closes with a docs commit only:
  "docs(triage): close B18-008, covered by B18-076 value-scan"
Otherwise, write the explicit fixes and commit per-leak.

Commit: per finding, OR the docs-only closure.

================================================================
STEP 9 — Triage + launch-checklist + current-phase updates
================================================================

Mark in `docs/session-18-triage.md` (✅ shipped per item):
  B18-003, B18-008, B18-029, B18-040, B18-061, B18-062, B18-075, B18-076

`docs/launch-checklist.md`: any row referencing these items —
close.

`docs/current-phase.md`:
  - status → "Session 18B-2 Builder complete"
  - Add 18B-2 block under "What's done"
  - One sentence under "Key Decisions": "B18-061 chose NFKC over
    punycode; cross-script lookalike defense is a documented
    P2 escalation."

Commit: "docs: close B18-003/008/029/040/061/062/075/076"

================================================================
STEP 10 — Verify
================================================================

Run /everything-claude-code:verify:
  - tsc clean
  - lint clean
  - scoped vitest passes (per current-phase.md path list)
  - supabase db reset && npm run db:migrate clean
  - For B18-075 specifically: a smoke run of the publishing
    worker against a seeded post — assert post.status =
    'published' and social_post_id set, via the RPC.

If any check fails, STOP and surface.

================================================================
Hard rules
================================================================

- Do NOT deviate from the locked design choices in §"Locked
  design choices" — escalate, don't improvise.
- Do NOT write the B18-075 migration or RPC until Step 0 is
  greenlit.
- Do NOT add cross-script Unicode blocking or punycode in
  B18-061 — locked.
- Do NOT add console.*, any, or process.env outside lib/config.ts.
- Do NOT silently catch errors anywhere.
- Do NOT bundle items into one commit — one commit per item
  (or per leak in Step 8) so Reviewer can audit cleanly.

Confirm reading, then begin the required-reading report.
```

## Reviewer prompt

Paste into a fresh Opus 4.7 Claude Code session after Builder closes.

```text
================================================================
SESSION 18B-2 PHASE C — REVIEWER (PARALLEL TS + SECURITY)
================================================================

You are the Reviewer for SŌSH Session 18B-2. The Builder shipped
eight items from the Session 18 triage covering atomic state
transitions, SSRF hardening, URL decoding, email canonicalization,
and observability redaction. Lower-stakes than 18B-1 (no GDPR
erasure surface), but security-correctness still matters.

Run two parallel lenses, synthesize, no code changes.

================================================================
Required reading
================================================================

1. docs/session-18.md §"Session 18B-2" — the locked design
   choices. Any deviation is a finding.
2. docs/session-18-triage.md — confirm Builder marked items closed.
3. CLAUDE.md.
4. The Builder's diff for 18B-2. Find via:
     git log --since="<date>" --pretty=oneline
   Read every changed file in full.
5. lib/email/orchestrator.ts and lib/deletion/orchestrator.ts —
   the patterns 18B-2's atomic guards mirror.

================================================================
LENS 1 — typescript-reviewer
================================================================

T1. CLAUDE.md baseline: no any, no console.*, no process.env
    outside lib/config.ts, atomic transitions, timestamps via
    formatISO, three canonical log lines per subsystem if any
    new subsystem was added.
T2. B18-075 RPC: SECURITY DEFINER, search_path = public, pg_temp
    (not $user), REVOKE FROM public + GRANT TO service_role,
    single-statement body, WHERE id AND WHERE status guard,
    matches what Step 0 reported in chat (verify against the
    chat transcript / docs/session-18.md).
T3. B18-003/B18-040: every status UPDATE has both WHERE id AND
    WHERE status in the same statement. No read-then-update
    anywhere. Tests cover the wrong-source-status case.
T4. B18-062: recursive decode is bounded (max 3 iterations);
    rejects if depth-3 still differs from depth-2; validates
    the decoded form, not the input. No infinite-loop surface.
T5. B18-076: depth bound of 5 enforced; array/object size limits
    enforced; cycle handling present; matches replaced in-place
    without mutating the caller's object reference (or
    deliberately mutating — flag the choice).
T6. B18-061: canonicalizeEmail applied at EVERY email-input
    surface (signup, login, password-reset, resend-confirmation,
    anywhere a uniqueness lookup runs). One missed surface =
    a finding.
T7. Tests: each item has tests matching the spec. Negative
    tests included (wrong status, malformed URL, etc.).

================================================================
LENS 2 — security-reviewer
================================================================

S1. B18-029: all ten CIDR ranges present, none missing,
    no typos in addresses. IPv6 ranges actually checked
    (not silently skipped when the address parses as IPv6).
    The order of the block-list doesn't matter, but verify
    no allow-rule short-circuits before the block hits.
S2. B18-062 decode depth: malicious triple-encoded URLs
    actually rejected, not silently passed through after
    iteration 3. Test fixture includes at least one URL
    that requires all three iterations to expose the attack.
S3. B18-061 NFKC limitation documented in test and in code
    comments — a future reader must understand that Cyrillic
    homoglyphs slip through. If anyone added punycode
    silently, that's a deviation finding.
S4. B18-076 redactor: regex set covers email, JWT, Stripe,
    long hex. Verify regexes don't false-positive on
    common non-sensitive strings (UUIDs are not Stripe keys;
    base64-encoded 32-char strings aren't JWTs without dots).
    Verify the redactor is actually called in Sentry beforeSend
    and structured logger paths — not just exported.
S5. B18-008: Builder's grep findings — every leak point either
    flows through the extended redactor, OR has its own fix.
    No leak path silently un-addressed.
S6. B18-075 RPC: SECURITY DEFINER with WHERE status guard is
    the load-bearing safety property. A post in 'failed' or
    'cancelled' status MUST NOT be transitioned to 'published'
    by this RPC. Verify the test covers this.
S7. B18-003/B18-040: a row in a wrong source status hitting
    the UPDATE results in zero affected rows, AND the calling
    code treats zero-affected as a no-op (logs and continues),
    NOT as a silent success (which would let a stuck row
    stay stuck without notice). Flag if the orchestrator
    treats zero-affected as success.
S8. New RPC's PG version compatibility — if SOSH targets PG14
    and the RPC uses a PG15+ feature, that's a finding.

================================================================
SYNTHESIS
================================================================

Write docs/session-18b2-review.md with B/H/M/L sections.

Tiering:
- B: any deviation from the locked design choices, OR a security
  finding that could cause a live correctness or auth bypass.
- H: CLAUDE.md violation, missed atomic guard, missed leak
  point, test coverage gap on a security path.
- M / L: usual nitpicks.

Report counts, full B and H lists, path to review file. STOP.

Hard rules: as 18B-1 Phase C. Read the diff, do not trust
commit messages, do not modify any code.
```

### Adjudication

After Reviewer reports:
- B → 18B-2D correction pass (same shape as prior Nd correction passes)
- H disagreed with → override in chat with explicit technical reasoning
- M/L → add to `docs/session-18-triage.md` as P2

If zero B findings, skip 18B-2D and move to 18B-3.

---

# Session 18B-3 — Type-quality cross-cutting sweeps

**Status:** ✅ Complete. 18B-3D correction pass applied (H1 getErrorMessage pattern-sweep, H2 RegenerateDialog cast, M4 tests). B18-010/030/041/069/070/071 shipped. B18-085 partial (L2) filed as B18-089.

**Scope (items from triage):**
- B18-010 — plan-capability-sweep (hardcoded plan-limit integers → `getPlanCapabilities()`)
- B18-030 — getErrorMessage helper (extract typed unknown-narrowing; ~15 `(error as {message})` sites in `lib/db/`)
- B18-041 — toISOString sweep (~8 live sites → date-fns) **+ follow-up commit adding the lint rule** (R2 ordering: sweep first, rule second)
- B18-069 — poststatus-cast removal (unsound `post.status as …` in PostCard)
- B18-070 — postaction-error-union (`PostActionState.error` → typed error-code union)
- B18-071 — aimetadata-parse-helper (`as Partial<AiGenerationMetadata>` → narrow parse helper)

**Est:** ~3.5h.

**Pattern:** Builder-led, no full Architect pass. Five of the six items are behaviour-preserving type-quality refactors against well-established CLAUDE.md conventions (unknown-narrowing, no latent-any, date-fns timestamps), with locked design choices specified inline below. The sixth — B18-041 — is the only one with a genuine semantic risk surface (see Locked design choice 3), so the Builder handles it via a **Step 0 design-check in chat before any replacement**, the same gating shape 18B-2 used for the B18-075 RPC. If Step 0 surfaces any site where `formatISO()` is not a clean drop-in, Tiago adjudicates that site before the sweep proceeds.

**The cardinal rule for this session:** every item except the lint rule is a *refactor*, not a behaviour change. The output of every touched call site must be byte-identical to today (same string, same number, same error text, same default). The one thing that makes a refactor dangerous is a "no-op" that quietly isn't one. The Reviewer's second lens exists entirely to catch that.

## Locked design choices

These are the decisions Builder will not improvise on. Specified here so the Builder prompt can reference them rather than re-derive:

1. **B18-030 (getErrorMessage) → one shared helper, behaviour-preserving narrowing.** Add `getErrorMessage(error: unknown): string` to the canonical util location (confirm in Step report — likely `lib/utils/errors.ts` or wherever existing shared helpers live; do NOT create a new top-level dir if one exists). Narrowing order, exactly: `error instanceof Error` → `error.message`; else a plain object with a `string`-typed `message` property (guard with `typeof`) → that message; else `String(error)`. No new fallback text, no swallowing — whatever string each of the ~15 call sites surfaces today must be the string it surfaces after. Replace every `(error as {message: string}).message` / `(error as Error).message` / `(error as any).message` site in `lib/db/` (and anywhere else the grep finds the same anti-pattern) with the helper. This closes the CLAUDE.md unknown-narrowing violation (R1) across all sites in one helper.

2. **B18-010 (plan-capability-sweep) → single source of truth, zero value changes.** `getPlanCapabilities(plan)` (confirm exact name + signature in Step report) is the only place plan limits are defined. The sweep replaces hardcoded limit *literals* (e.g. `PLUS_CAMPAIGN_LIMIT = 5`, post-count literals) with reads from the capability function. **It does not change a single limit value.** Plus stays 50 posts / 5 campaigns; Pro stays whatever the function currently returns. If the Builder finds a hardcoded literal whose value *disagrees* with `getPlanCapabilities()`, that is a finding to surface in chat — NOT a value to "fix" silently in either direction (a mismatch is a latent bug, and which side is correct is a strategic call, not a refactor). Behaviour after the sweep is identical to today unless a mismatch is found and Tiago adjudicates it.

3. **B18-041 (toISOString sweep) → Step 0 design-check, NOT a blind find-and-replace.** This is the trap: `d.toISOString()` returns UTC with a `Z` suffix and millisecond precision (`2026-06-18T12:00:00.000Z`); date-fns `formatISO(d)` defaults to **local timezone offset** and **drops milliseconds** (`2026-06-18T13:00:00+01:00`). These are not interchangeable. For each of the ~8 sites (`cron-health.ts`, `auth-rate-limits.ts`, `ai-usage.ts`, `metrics.ts` ×2, `schedule.ts:62`, `_health/route.ts`, `campaigns/[id]/page.tsx:50`) the Builder reports in Step 0: what the resulting string is used for (DB column write / log field / API response / string comparison / display), and proposes the exact date-fns call that preserves the *current* wire format. The default expectation is a **UTC, Z-suffixed, millisecond-preserving** replacement — i.e. `formatISO` is likely the wrong primitive for most sites; a UTC formatter (`date-fns-tz formatInTimeZone(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'XXX'")`, or whatever CLAUDE.md's date-fns convention actually blesses) is the safe default. Any site where Builder believes a lossy/local replacement is genuinely correct must be called out explicitly for Tiago to confirm. **No replacement is written until Step 0 is greenlit.**

4. **B18-041 lint rule (R2 ordering, non-negotiable) → separate follow-up commit, after every call site is swept.** The rule cannot land before the sweep or CI breaks on the existing sites. Implement as ESLint `no-restricted-properties` banning `.toISOString()` across `app/` and `lib/` (exclude `*.test.ts`/`*.test.tsx` and `scripts/`). Message points at the date-fns convention. If Step 0 identified a site where `.toISOString()` is the deliberate, correct choice, that single site carries an `// eslint-disable-next-line no-restricted-properties` with a one-line justification comment — documented, not silent.

5. **B18-069 (poststatus-cast) → remove the cast, lookup with safe default.** Replace `post.status as <SomeType>` in PostCard with either (a) outright removal if `post.status` is already typed off the DB row (preferred), or (b) a lookup against the existing status union/map with the same fallback the component renders today for an unrecognised status. Unknown status must render exactly what it renders now — no new visual, no throw.

6. **B18-070 (postaction-error-union) → name the union, enumerate exactly today's codes.** Define a named union type (e.g. `PostActionErrorCode`) and change `PostActionState.error?: string` to `error?: PostActionErrorCode`. The union members are exactly the error codes the post Server Actions produce today — no codes added, none dropped. This removes the downstream cast at the consuming site. The i18n key mapping for each code stays as-is; if the union surfaces a code with no locale key, that's a finding to report, not a key to invent.

7. **B18-071 (aimetadata-parse-helper) → narrow parse helper, preserve the `?? []` guard.** Add `parseAiGenerationMetadata(raw: Record<string, unknown> | null): Partial<AiGenerationMetadata>` (confirm return shape against the two call sites). It narrows field-by-field rather than asserting the whole shape with `as`. The existing `?? []` (and any other default) guard that prevents crashes today must be reproduced inside the helper so the two call sites get identical defaults. Two call sites updated to use the helper; no behaviour change.

## Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-3 — TYPE-QUALITY CROSS-CUTTING SWEEPS (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-3. Six items from the
Session 18 triage, locked design choices specified in
session-18.md §"Session 18B-3 — Locked design choices."

Five items are behaviour-preserving refactors. ONE (B18-041)
has a real semantic trap and is gated behind a Step 0 design
check where you report findings and WAIT for Tiago's
confirmation before writing any replacement.

The cardinal rule: except where a locked choice explicitly says
otherwise, every touched call site must produce byte-identical
output to today — same string, same number, same error text,
same default. A refactor that quietly changes runtime behaviour
is a failure, not a win. If you find yourself wanting to "improve"
a value, a default, or an error message while you're in there,
STOP and surface it — that's scope creep and it hides regressions.

Time budget: ~3.5 hours total. If any single step blows 45 min,
STOP and report.

================================================================
Required reading
================================================================

1. CLAUDE.md — especially: no any, unknown-narrowing rule,
   date-fns timestamp convention (the EXACT helper it blesses —
   this decides B18-041), no console.*, no process.env outside
   lib/config.ts.
2. docs/session-18.md §"Session 18B-3 — Locked design choices" —
   your spec for every item.
3. docs/session-18-triage.md — find each item's row, read its
   "Source" line, follow it to the underlying code.
4. lib/db/ — grep for the `(error as {message})` / `(error as
   Error).message` / `(error as any).message` family for B18-030;
   count and list every hit.
5. The plan-capability module (grep `getPlanCapabilities`) and
   every hardcoded plan-limit literal (grep for the limit values
   and any `*_LIMIT` constant) for B18-010.
6. The ~8 toISOString sites for B18-041: cron-health.ts,
   auth-rate-limits.ts, ai-usage.ts, metrics.ts (×2),
   schedule.ts:62, _health/route.ts, campaigns/[id]/page.tsx:50.
   Grep `.toISOString()` across app/ and lib/ to confirm the
   list is complete — the triage says ~8, verify it's not more.
7. The PostCard component for B18-069 (grep `status as`).
8. The post Server Actions + PostActionState type for B18-070.
9. The two AiGenerationMetadata parse sites for B18-071
   (grep `as Partial<AiGenerationMetadata>`).

Confirm in chat what you've read and report:
- For B18-030: the exact count and file:line of every
  `(error as …).message` site, and the canonical util location
  you'll add getErrorMessage to.
- For B18-010: the exact name/signature of the capability
  function, every hardcoded limit literal (file:line + value),
  and whether any literal DISAGREES with the function's value.
- For B18-041: the complete list of toISOString sites (confirm
  ~8 vs actual), and what CLAUDE.md's date-fns convention
  actually mandates for a UTC ISO string.
- For B18-069/070/071: the file:line of each cast and one
  sentence on the replacement.

WAIT for Tiago's greenlight before Step 0.

================================================================
STEP 0 — B18-041 design check (DO NOT WRITE CODE YET)
================================================================

This is the one item that can silently break a wire format.
For EACH toISOString site, report a row:

  | file:line | current call | string is used for | proposed replacement |

"used for" must be one of: DB column write / structured log
field / API or health-route response / string comparison /
human display. This determines whether millisecond precision
and the Z-suffix matter.

Default proposal for every site: a UTC, Z-suffixed,
millisecond-preserving formatter — i.e. whatever CLAUDE.md's
date-fns convention blesses for that (likely date-fns-tz
formatInTimeZone(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'XXX'")
or the project's existing wrapper). Plain formatISO(d) is
LOCAL-offset and drops milliseconds — only propose it for a
site where you can prove local-offset, second-precision output
is what's wanted, and call that out explicitly.

If any site already imports a project date helper, prefer that
over a raw date-fns call.

Report the table in chat, then STOP. Do NOT touch any file
until Tiago confirms the per-site replacements.

================================================================
STEP 1 — B18-041 sweep (after Step 0 greenlit)
================================================================

Apply the confirmed replacement at each site. Where a site
crosses a DB or API boundary, add (or extend) a test asserting
the output string matches the pre-sweep format exactly (a
literal expected string or a regex pinning Z-suffix + ms).

Commit: "refactor(dates): replace toISOString with date-fns at 8 sites (B18-041)"

================================================================
STEP 2 — B18-041 lint rule (R2 ordering: ONLY after Step 1)
================================================================

Add ESLint no-restricted-properties banning `.toISOString()`
across app/ and lib/. Exclude *.test.ts(x) and scripts/.
Message: point at the date-fns convention. If Step 0 found a
site where toISOString is the deliberate correct choice, add a
single eslint-disable-next-line with a one-line justification.

Run `npx eslint app lib --max-warnings 0` (or the project's
lint script) — it MUST be clean. If it's not, a call site was
missed in Step 1; fix the site, do NOT weaken the rule.

Commit: "chore(lint): ban .toISOString() in favour of date-fns (B18-041 follow-up)"

================================================================
STEP 3 — B18-030 getErrorMessage helper
================================================================

Add getErrorMessage(error: unknown): string to the canonical
util location confirmed in the read report. Narrowing order
per Locked choice 1: instanceof Error → .message; plain object
with typeof message === 'string' → that; else String(error).
No new fallback text.

Replace every site from your read-report list. Add a unit test
for the helper covering: Error instance, {message:string}
object, string-only message guard rejection (a {message: 42}
object falls through to String), and a non-error primitive.

Commit: "refactor(errors): typed getErrorMessage helper across lib/db (B18-030)"

================================================================
STEP 4 — B18-010 plan-capability-sweep
================================================================

Replace every hardcoded plan-limit literal with a read from the
capability function. ZERO value changes — Plus stays 50 posts /
5 campaigns, Pro unchanged. If your read report flagged a literal
that disagrees with the function, do NOT touch that one yet —
it's already surfaced for Tiago; leave it and note it in the
commit body as deferred pending adjudication.

Add/extend a test asserting the enforcement sites read the same
numbers they enforced before (lock the values so a future
function edit can't silently move a limit).

Commit: "refactor(plans): read limits from getPlanCapabilities (B18-010)"

================================================================
STEP 5 — B18-069 poststatus-cast
================================================================

Remove the `post.status as …` cast in PostCard per Locked
choice 5 — outright if the row type already carries it, else a
lookup with today's fallback. Unknown status renders exactly
what it renders now.

Commit: "refactor(posts): remove unsound status cast in PostCard (B18-069)"

================================================================
STEP 6 — B18-070 postaction-error-union
================================================================

Define the named PostActionErrorCode union (exactly today's
codes — enumerate, don't invent), retype PostActionState.error,
remove the downstream cast. If a produced code has no i18n key,
report it — do not invent a key.

Commit: "refactor(posts): typed PostActionErrorCode union (B18-070)"

================================================================
STEP 7 — B18-071 aimetadata-parse-helper
================================================================

Add parseAiGenerationMetadata per Locked choice 7. Reproduce
the existing `?? []` (and any other) default INSIDE the helper
so both call sites get identical defaults. Wire the two sites.
Add a test: well-formed record → parsed; missing fields →
the same defaults the call sites used today; null → handled.

Commit: "refactor(ai): narrow parse helper for AiGenerationMetadata (B18-071)"

================================================================
STEP 8 — Triage + current-phase updates
================================================================

Mark in docs/session-18-triage.md (✅ shipped per item):
  B18-010, B18-030, B18-041, B18-069, B18-070, B18-071

docs/current-phase.md:
  - status → "Session 18B-3 Builder complete"
  - Add an 18B-3 block under "What's done"
  - One sentence under "Key Decisions": "B18-041 swept
    toISOString → date-fns UTC formatter (Z-suffix + ms
    preserved); .toISOString() now ESLint-banned in app/ + lib/."

Commit: "docs: close B18-010/030/041/069/070/071"

================================================================
STEP 9 — Verify
================================================================

Run /everything-claude-code:verify, or manually:
  - npx tsc --noEmit --skipLibCheck   (clean)
  - lint clean, including the new toISOString rule
  - scoped vitest (per current-phase.md gotchas):
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics \
        app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
  - grep app/ lib/ for `.toISOString()` → only the documented
    eslint-disabled site(s), if any, may remain.

Do NOT run `npm run build` (pre-existing ECC remotion failure;
it's a known gotcha, not your regression). Do NOT run bare
`npx vitest` (picks up ECC tests that call process.exit()).

If any check fails, STOP and surface.

================================================================
Hard rules
================================================================

- Do NOT change any limit value, default, error string, or
  wire format. Every item is a refactor — surface, don't "fix",
  any value mismatch you find.
- Do NOT write any B18-041 replacement until Step 0 is greenlit.
- Do NOT land the lint rule before the sweep (R2 ordering).
- Do NOT weaken the lint rule to make CI pass — fix the missed
  call site instead.
- Do NOT add console.*, any, or process.env outside lib/config.ts.
- Do NOT silently catch errors anywhere.
- Do NOT bundle items into one commit — one commit per item
  (B18-041 is two: sweep, then rule) so Reviewer can audit cleanly.

Confirm reading, then begin the required-reading report.
```

## Reviewer prompt

Paste into a fresh Opus 4.7 Claude Code session after Builder closes.

```text
================================================================
SESSION 18B-3 PHASE C — REVIEWER (PARALLEL TS + REGRESSION)
================================================================

You are the Reviewer for SŌSH Session 18B-3. The Builder shipped
six type-quality refactors from the Session 18 triage. There is
NO new feature surface here — every change claims to be
behaviour-preserving. Your job is to verify that claim. A
refactor that quietly changes runtime output is the single
failure mode this session can produce, and it's invisible in a
green test suite if the tests were written against the new
behaviour. Read the diff, not the commit messages.

Run two parallel lenses, synthesize, no code changes.

================================================================
Required reading
================================================================

1. docs/session-18.md §"Session 18B-3 — Locked design choices" —
   any deviation is a finding.
2. docs/session-18-triage.md — confirm Builder marked items closed.
3. CLAUDE.md — unknown-narrowing rule, date-fns convention,
   no-any.
4. The Builder's diff for 18B-3. Find via:
     git log --since="<date>" --pretty=oneline
   Read every changed file in full, including tests.
5. The Step 0 design-check table the Builder posted in chat for
   B18-041 (the per-site usage + agreed replacement). You are
   verifying the diff matches what was agreed, site by site.

================================================================
LENS 1 — typescript-reviewer
================================================================

T1. CLAUDE.md baseline: no new any, no console.*, no process.env
    outside lib/config.ts.
T2. B18-030: getErrorMessage narrowing order is exactly
    instanceof Error → object-with-string-message → String().
    A {message: 42} object must NOT be treated as having a
    message (the typeof guard is load-bearing). EVERY
    `(error as …).message` site in the read report is replaced —
    grep the final tree to confirm zero survivors.
T3. B18-070: PostActionErrorCode union members equal exactly the
    codes the actions produce — no member with no producer, no
    producer with no member. The downstream cast is gone.
T4. B18-071: parseAiGenerationMetadata narrows field-by-field,
    not one whole-object `as`. The `?? []` (and any other)
    default lives INSIDE the helper and matches what BOTH call
    sites did before. No latent-any survives.
T5. B18-069: the cast is gone, not just relocated. Unknown
    status path still resolves to the prior fallback.
T6. B18-010: limits read from the capability function at every
    former-literal site; grep for the old literal values to
    confirm none remain hardcoded in enforcement paths.
T7. B18-041 lint rule: no-restricted-properties actually fires
    on `.toISOString()` (not just declared); excludes tests +
    scripts; any eslint-disable carries a justification comment.
T8. Tests added this session assert the PRE-refactor output, not
    a convenient post-refactor value. A test that was written to
    match whatever the new code happens to emit proves nothing —
    flag any test whose expected value looks reverse-engineered
    from the implementation.

================================================================
LENS 2 — regression-reviewer (behavioural-equivalence)
================================================================

This lens assumes every refactor is guilty until proven a no-op.

R1. B18-041 — THE LOAD-BEARING CHECK. For each of the ~8 sites,
    compare the EXACT string the old `.toISOString()` produced
    against the new helper's output:
      - UTC vs local offset: old was always UTC 'Z'. If the new
        call is plain formatISO() (local offset), that is a
        Brrr finding for any site whose string hits a DB column,
        an API response, or a string comparison.
      - Millisecond precision: old kept .SSS. If the new output
        drops ms and the value is compared as a string or stored
        where precision matters, that's a finding.
      - For a DB timestamptz column the DB may normalise either
        form, so a local-offset write MIGHT be harmless — but
        only verify, never assume. Check the column type.
    Cross-reference each site against the Step 0 table: did the
    Builder implement what was agreed, or quietly substitute?
R2. B18-010 — confirm NO limit value moved. Plus = 50 posts /
    5 campaigns, Pro unchanged. If the Builder "reconciled" a
    literal that disagreed with the function instead of deferring
    it, that's a finding regardless of which value won — the
    decision was Tiago's to make.
R3. B18-030 — for at least three representative call sites, trace
    that the error string surfaced to the user / log / Sentry is
    identical to pre-refactor. The helper must not, e.g., turn a
    Postgres error's `.message` into `String(error)` (which on
    some error objects yields "[object Object]").
R4. B18-069 — the unknown-status render path is unchanged. If
    the prior code defaulted to a specific badge/label, the new
    lookup defaults to the SAME one.
R5. B18-070 — no error code that the UI previously rendered an
    i18n string for has been dropped or renamed in a way that
    breaks the key lookup.
R6. B18-071 — feed the helper a metadata record missing the
    fields the call sites read; confirm the defaults match what
    the old `as Partial<…>` + `?? []` produced. A changed default
    is a silent behaviour change.
R7. Scope discipline: flag ANY change in the diff that isn't one
    of the six items — a "while I was in there" edit to a value,
    a message, or unrelated logic. Those are out-of-scope
    regressions even if they look like improvements.

================================================================
SYNTHESIS
================================================================

Write docs/session-18b3-review.md with B/H/M/L sections.

Tiering:
- B: any deviation from a locked design choice, OR any
  behavioural change vs pre-refactor output (a moved limit, a
  changed timestamp format at a boundary, a changed error string,
  a changed default).
- H: CLAUDE.md violation, a surviving cast/any the item was
  meant to remove, a test that asserts post-refactor behaviour
  instead of pre-refactor, a missed call site.
- M / L: usual nitpicks.

Be aggressive on R1 (timestamp equivalence) — anything that
MIGHT change a stored or compared timestamp format goes to B by
default; downgrade only with explicit reasoning about why the
boundary tolerates it.

Report counts, full B and H lists, path to review file. STOP.

Hard rules: as 18B-2 Phase C. Read the diff, do not trust commit
messages, do not modify any code, only new file is
docs/session-18b3-review.md.
```

### Adjudication

After Reviewer reports:
- B → 18B-3D correction pass (same shape as prior Nd correction passes)
- H disagreed with → override in chat with explicit technical reasoning
- M/L → add to `docs/session-18-triage.md` as P2

If zero B findings, skip 18B-3D and move to 18B-4.

**Likely correction-pass trigger:** B18-041. If Step 0 wasn't disciplined about UTC + millisecond preservation, the regression lens will surface a boundary mismatch. That's the expected risk for this session and the reason B18-041 is gated and reviewed harder than the other five.

## 18B-3D — Correction pass

**Status:** Triggered. Reviewer returned **B 0 / H 2 / M 4 / L 2** (`docs/session-18b3-review.md`). Both load-bearing checks passed — R1 timestamp equivalence (Builder correctly used a `toUtcIso(d) → d.toISOString()` wrapper, byte-identical at all 8 sites, *not* the triage's `formatISO` wording) and R2 limit values unmoved. No design failure.

**Why a pass despite B 0:** the two H findings are *"item marked CLOSED without its stated deliverable."* That corrupts the triage audit trail and is the silent-incompletion failure mode this methodology exists to catch — it earns the same correction pass a B would. The `If zero B findings, skip 18B-3D` heuristic is overridden here with that reasoning.

**Adjudication:**
- **H1** (3 in-scope `(error as {message}).message` casts survive in `lib/db/` — `businesses.ts:199`, `posts.ts:135`, `posts.ts:397`) → **fix.** Root cause: the B18-030 sweep matched the variable name `error`, not the *pattern*; these sites alias it (`fetchError`, `readError`). The sweep method, not just the sites, is the defect.
- **M1** (same anti-pattern in `lib/ai/metrics.ts:17,39`) → **fold into H1.** Same rule target; file already touched this session.
- **H2** (B18-070's promised downstream-cast removal never happened — `components/posts/RegenerateDialog.tsx:51`) → **fix.** Worse than a missed deliverable: the union widening made the surviving cast *unsound* (it asserts away now-reachable `AiErrorCode` members like `rate_limited`). Keep behaviour identical — generic fallthrough for unmatched codes stays; no new i18n keys.
- **M4** (no tests — Builder Steps 3 & 7 specced them and skipped them) → **fix.** Cheap, locks the exact contract this session is risky about; also captures L1.
- **M2** (helper container-checks then whole-shape `as` instead of field-by-field per Locked choice 7) → **optional.** Partial-delivery of B18-071's spec; include only if Tiago wants the item fully discharged. Marked optional in Step 3 below.
- **M3** (PostCard null-metadata default `null`→`{}`) → **accept as a strict improvement** (fixes a latent null-deref); document, no code.
- **L1** → captured by the M4 tests.
- **L2** (`formatISO(new Date())` local-offset strings survive in `businesses.ts` / `campaigns.ts` / `posts.ts`, invisible to the new `.toISOString()` lint rule) → **file a new triage item.** Same UTC-vs-local hazard B18-041 just fixed, via a different primitive. Needs a 2-min probe: P1 if any site crosses a `timestamptz` write or string comparison, P2 if display-only.

### 18B-3D Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-3D — CORRECTION PASS (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-3D, a scoped correction
pass on 18B-3. The Reviewer (docs/session-18b3-review.md) found
two items marked CLOSED without their deliverable met. You are
finishing those two items, adding the tests that were specced
and skipped, and filing one new triage item. Nothing else.

Every fix here is behaviour-preserving. Same strings, same
defaults, same fallthrough. If you find yourself changing what a
user sees or what gets stored, STOP — that's out of scope.

================================================================
Required reading
================================================================

1. docs/session-18b3-review.md — H1, H2, M1, M4, L2 in full.
2. docs/session-18.md §"Session 18B-3 — Locked design choices"
   (esp. choice 1 getErrorMessage narrowing, choice 6 the union).
3. lib/utils.ts (getErrorMessage) and the PostActionErrorCode
   union definition — your existing tools, do not redefine them.

================================================================
STEP 1 — H1 + M1: finish the getErrorMessage sweep (PATTERN, not name)
================================================================

The 18B-3 sweep matched the variable name `error` and missed
aliased sites. Do NOT repeat that. Grep the PATTERN, any
identifier:
  - `as\s*\{\s*message`
  - `as Error\s*\)\s*\.message`
  - `as\s*\{[^}]*message[^}]*\}\s*\)\?\.message`

Replace every hit with getErrorMessage(...). Known survivors:
  - lib/db/businesses.ts:199   (fetchError)
  - lib/db/posts.ts:135        (readError)
  - lib/db/posts.ts:397        (readError)
  - lib/ai/metrics.ts:17
  - lib/ai/metrics.ts:39

After replacing, re-grep the WHOLE tree (app/ lib/) for the same
patterns and confirm zero survivors outside *.test.ts. Report
the final grep output in chat.

Commit: "refactor(errors): finish getErrorMessage sweep, pattern-matched (B18-030 follow-up)"

================================================================
STEP 2 — H2: remove the unsound cast in RegenerateDialog
================================================================

components/posts/RegenerateDialog.tsx:51 currently does:
  const key = result.error as 'not_eligible' | 'quota_exceeded'
            | 'generic' | undefined

result.error is now PostActionErrorCode (wider — includes
AiErrorCode members the cast asserts away). Remove the cast.
Narrow by COMPARISON against the codes that have a specific
i18n key; everything else falls through to the generic key —
exactly today's runtime behaviour. Sketch:

  function regenerateErrorKey(code: PostActionErrorCode | undefined) {
    switch (code) {
      case 'not_eligible':   return 'regenerate.error.not_eligible'
      case 'quota_exceeded': return 'regenerate.error.quota_exceeded'
      default:               return 'regenerate.error.generic'
    }
  }

Use the ACTUAL key names already in the locale files — confirm
them, don't invent. Do NOT add keys for the now-reachable codes
(rate_limited etc.); that's a separate P2 UX item, not this pass.
No cast may remain.

Commit: "refactor(posts): remove unsound error cast in RegenerateDialog (B18-070 follow-up)"

================================================================
STEP 3 — M2 [OPTIONAL — only if Tiago greenlit in chat]
================================================================

If greenlit: make parseAiGenerationMetadata (lib/db/utils.ts)
narrow FIELD-BY-FIELD per Locked choice 7, instead of
`return raw as Partial<AiGenerationMetadata>`. Read each known
field with a typeof guard; coerce/skip mismatches; preserve the
exact defaults both call sites used (incl. the `?? []` / `?? {}`
guards). Behaviour-identical to today for all well-formed input.

If NOT greenlit: skip this step entirely.

Commit (if done): "refactor(ai): narrow AiGenerationMetadata field-by-field (B18-071 follow-up)"

================================================================
STEP 4 — M4: the tests Steps 3 & 7 specced
================================================================

Add direct unit tests (these were specced in 18B-3 and skipped):

getErrorMessage:
  - Error instance              → .message
  - { message: 'x' }            → 'x'
  - { message: 42 }             → String() path (typeof guard
                                  must reject the non-string)
  - a bare string / number      → String()

parseAiGenerationMetadata:
  - null                        → the call-site default ({} or
                                  {} -> regenerationCount ?? 0 safe)
  - record missing fields       → same defaults as pre-refactor
  - well-formed record          → parsed values intact

Place in the existing test files next to each helper. Run them.

Commit: "test(18b3): lock getErrorMessage + parseAiGenerationMetadata contracts (M4)"

================================================================
STEP 5 — Docs + triage
================================================================

docs/session-18-triage.md:
  - B18-030, B18-070 → now genuinely ✅ shipped (note "completed
    in 18B-3D" — the 18B-3 close was premature).
  - B18-071 → ✅ if Step 3 ran; else leave the 18B-3 close and
    add an M2 note as P2.
  - NEW item B18-085 — formatISO-local-audit: `formatISO(new Date())`
    in businesses.ts / campaigns.ts / posts.ts emits LOCAL-offset
    strings (same UTC hazard B18-041 fixed, invisible to the new
    lint rule). Tier UNDECIDED pending a probe: P1 if any site
    writes a timestamptz column or string-compares the value;
    P2 if display-only. Do NOT fix it in this pass — just file it.
  - Record M3: PostCard null-metadata default changed null→{}
    (accepted strict improvement, latent null-deref fix).

docs/current-phase.md:
  - status → "Session 18B-3 complete (18B-3D correction applied)"
  - One line under Key Decisions: "B18-030 sweep is pattern-
    matched, not variable-name-matched; aliased error vars
    (fetchError, readError) are covered."

Commit: "docs: close B18-030/070 in 18B-3D, file B18-085, record M3"

================================================================
STEP 6 — Verify
================================================================

  - npx tsc --noEmit --skipLibCheck   (clean)
  - lint clean (incl. the .toISOString() rule)
  - scoped vitest incl. the new tests:
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics \
        app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
  - re-grep app/ lib/ for `as { message` / `as Error).message`
    → zero survivors outside tests.

Do NOT run `npm run build` (known ECC failure). Do NOT run bare
vitest.

================================================================
Hard rules
================================================================

- Behaviour-preserving only. No user-visible change, no stored-
  value change, no new i18n keys.
- Step 3 (M2) runs ONLY if explicitly greenlit.
- Do NOT fix B18-085 here — file it, probe decides its tier.
- Grep the PATTERN, never a variable name — that was H1's root cause.
- One commit per step. Confirm reading, then begin Step 1.
```

**Adjudication (post-18B-3D):** zero B expected. If the re-grep in Step 1/Step 6 still shows survivors, the sweep is still pattern-incomplete → re-run, do not close. Once green, B18-030/B18-070 close for real, B18-085 carries the only new open thread (resolve its tier with the probe), and 18B-3 is done — move to 18B-4.

---

# Session 18B-4 — Auth oracle + middleware rename

**Status:** ✅ Complete. 18B-4D documentation + dead-key pass applied (M1 locale keys, L1 orphaned i18n). B18-060 (login oracle closed via Option 3 + /resend-confirmation) and B18-025 (middleware → proxy.ts rename) shipped.

**Scope (items from triage):**
- B18-060 — login-email-enumeration oracle → **Option 3** (locked in Phase A adjudication): collapse all login failures to one generic message + a dedicated `/resend-confirmation` route mirroring `/forgot-password`'s anti-enumeration posture, rate-limited via `auth_rate_limits`, using Supabase `resend()`, with 3 locale files.
- B18-025 — `middleware.ts` → `proxy.ts` rename (Next.js 16 deprecation; CLAUDE.md file-structure already names `proxy.ts`, so the code violates its own constitution — R1). Touches `launch-checklist.md §8` grep commands.

**Est:** ~2h.

**Pattern:** Builder-led, no Architect pass — but **both items are gated behind a Step 0 recon**, because both sit on load-bearing surfaces where a wrong assumption is invisible until production. B18-060 is the only triage item that needed a product decision, and that decision (Option 3) is already locked; Step 0 confirms the *current* auth behaviour the fix must collapse, not re-open the decision. B18-025 looks like a rename but rides under every single request (auth redirect + i18n + `x-pathname`); Step 0 confirms the exact Next.js 16 convention before anything moves.

**The two cardinal rules for this session:**
1. **B18-060 is the opposite of behaviour-preserving — it is *deliberately* removing an information leak.** The thing that must stay identical is the *observable surface across states*: an attacker probing "does this email have an account?" must get the same response — same body, same status, same shape — whether the email is unregistered, registered-wrong-password, or registered-unconfirmed. Legitimate UX (an unconfirmed user getting unstuck) is served by an *unconditional* affordance, never a conditional one. A conditionally-rendered "resend" link reintroduces the exact oracle we're closing.
2. **B18-025 is strictly behaviour-preserving.** Same matcher, same redirects, same locale detection, same header injection, byte-identical request handling. A rename that subtly changes routing breaks auth on every route at once.

## Locked design choices

### B18-060 — login oracle (Option 3)

1. **Login collapses ALL auth failures to ONE generic key.** Map every `signInWithPassword` failure — Supabase's `invalid_credentials`, `email_not_confirmed`, and any other auth error — to a single generic key (e.g. `errors.login.invalid_credentials`, "Email or password is incorrect"). No branch, no status-code difference, no field-level hint reveals which state produced the failure. Step 0 confirms the exact error codes/messages this project's Supabase version returns so none slip through unmapped.
2. **An unconditional "Resend confirmation email" affordance on the login page**, linking to `/resend-confirmation`. Always rendered — never gated on "we detected your email is unconfirmed" (that gate *is* the oracle). The legitimate unconfirmed user finds it because it's always there, same as a "Forgot password?" link.
3. **New `/resend-confirmation` route mirrors `/forgot-password` EXACTLY.** Same Server Action shape, same always-identical response ("If an account exists for that email and needs confirmation, we've sent a new link."), same `auth_rate_limits` consumption, same URL-from-`config.server.APP_URL` (never request headers — the H-01 posture). Do not invent a new pattern; copy the proven one and swap `resetPasswordForEmail` for `resend`.
4. **Canonicalize the email via the existing `canonicalizeEmail` helper (B18-061) before any lookup or resend** — so the resend path keys on the same canonical form login/signup use. Inconsistent canonicalization is its own subtle oracle.
5. **Rate-limit BEFORE the resend, keyed on canonicalized email + IP**, consuming the existing `auth_rate_limits` helper exactly as forgot-password does. On limit-exceeded, return a generic "too many requests, try again later" — this does NOT leak existence (it's keyed on the *attempt*, not on whether the account exists).
6. **Use `supabase.auth.resend({ type: 'signup', email })`** for the actual re-send (Step 0 confirms the exact type string and signature for this version). Normalize/swallow Supabase's response so no provider error detail (e.g. "user already confirmed", "user not found") reaches the client — the client always sees the single generic success.
7. **3 locale files (EN/PT/ES), i18n from day one** (CLAUDE.md R1): the resend page copy, the login "resend confirmation" link label, and the generic responses. No hardcoded English.
8. **Residual timing oracle is an accepted, documented risk.** Supabase owns the auth timing (password hashing happens server-side only for existing users), so a determined attacker may still glean signal from response latency — exactly as the existing forgot-password flow already does. Do NOT attempt app-layer constant-time auth; note the residual risk in a code comment + ADR/triage so it's a known accepted limitation, not a silent one.
9. **Signup-side enumeration is OUT OF SCOPE — check and report, do not fix here.** Supabase may return a distinguishable response when signing up with an already-registered email; that's a *separate* oracle from the login one Option 3 scoped. The Builder greps the signup path, reports whether the vector exists, and files it as a new triage item if so. It does NOT get fixed in 18B-4 (scope discipline — same posture as B18-085 in 18B-3D).

### B18-025 — middleware → proxy rename

10. **Verify the exact Next.js 16 `proxy` convention FIRST — do not assume a pure rename.** Confirm against the installed Next.js version: the file name (`proxy.ts`), the export name (is the function still `middleware`, or is it `proxy`?), the config/`matcher` export shape, and whether any request/response API changed. If anything beyond a file-rename-plus-export-rename is required, report it before touching the file.
11. **Behaviour-preserving, byte-identical request handling:** same `config.matcher`, same auth-redirect logic, same i18n locale detection, same `x-pathname` header injection. The dashboard layout reads `x-pathname` — if that header stops being set, the onboarding guard silently breaks. This is the highest-risk line in the file.
12. **Single commit includes everything that references the old name:** the rename + export change, CLAUDE.md reconciliation (confirm it already says `proxy.ts` and nothing else still says `middleware.ts`), `launch-checklist.md §8` grep-command updates (`grep middleware.ts` → `grep proxy.ts`), and any `current-phase.md` references (incl. removing the "middleware.ts deprecation" gotcha once resolved). Stale audit commands are unacceptable — the whole point is the file-structure now matches its constitution.

## Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-4 — AUTH ORACLE + MIDDLEWARE RENAME (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-4. Two items from the
Session 18 triage, locked design choices in session-18.md
§"Session 18B-4 — Locked design choices."

This is a SECURITY session. B18-060 removes an account-
enumeration oracle from login. The property that matters is
INDISTINGUISHABILITY ACROSS STATES: an attacker probing whether
an email has an account must receive the identical response —
body, status, shape, and (as far as the app controls) timing —
whether the email is unregistered, registered with a wrong
password, or registered but unconfirmed. If any of your changes
let those three cases be told apart, the fix has failed.

B18-025 is the opposite: a behaviour-PRESERVING rename that
rides under every request. Same matcher, same redirects, same
locale detection, same x-pathname injection.

Both items are gated behind a Step 0 recon. Do not write code
until each Step 0 is greenlit.

Time budget: ~2 hours. If any single step blows 45 min, STOP
and report.

================================================================
Required reading
================================================================

1. CLAUDE.md — file-structure section (it already names
   proxy.ts), i18n-from-day-one, no console.*/any/process.env
   outside lib/config.ts, the auth-route conventions.
2. session-18.md §"Session 18B-4 — Locked design choices".
3. session-18-triage.md — B18-060 and B18-025 rows.
4. The login Server Action (app/[locale]/(auth)/login/...) —
   every branch that produces a user-facing error, and the
   exact Supabase signInWithPassword error codes/messages it
   currently distinguishes.
5. The forgot-password Server Action + page — THIS IS YOUR
   TEMPLATE for /resend-confirmation. Read its anti-enumeration
   response shape, its auth_rate_limits consumption, and its
   APP_URL usage.
6. lib/db/auth-rate-limits.ts — the rate-limit helper you'll
   reuse.
7. The canonicalizeEmail helper (from B18-061) — the exact
   import path and signature.
8. middleware.ts — auth redirect + i18n locale detection +
   x-pathname injection + config.matcher. The whole file.
9. launch-checklist.md §8 — the grep commands that name
   middleware.ts.
10. The signup Server Action — for the Step 0 enumeration CHECK
    (report only, no fix).

Confirm in chat what you've read, then STOP for the two Step 0
reports below before writing any code.

================================================================
STEP 0a — B18-025 Next.js 16 proxy convention (RECON, no code)
================================================================

Report:
  - Installed Next.js version (from package.json + lockfile).
  - The exact proxy convention for that version: file name,
    export name (still `middleware`? or `proxy`?), the
    config/matcher export, any changed request/response API.
    Cite the source (Next docs for that version, or the type
    defs in node_modules/next).
  - Whether this is a pure rename+export-swap, or requires API
    changes. If the latter, enumerate them.

If pure rename+export-swap: say so and you may proceed to Step 1
after greenlight. If anything more: WAIT for explicit direction.

================================================================
STEP 0b — B18-060 auth recon (RECON, no code)
================================================================

Report:
  - Every branch in the login action that surfaces a different
    message/behaviour by auth state. Quote the exact Supabase
    error codes/messages it switches on (invalid_credentials,
    email_not_confirmed, others?).
  - The forgot-password action's anti-enumeration response shape
    (the exact generic message, the rate-limit call, the APP_URL
    usage) — confirm it's the template you'll mirror.
  - The exact resend signature for this Supabase version
    (supabase.auth.resend({ type: ?, email })) — confirm the
    `type` string ('signup' vs 'email_change' etc.).
  - SIGNUP ENUMERATION CHECK: does the signup action return a
    distinguishable response for an already-registered email?
    Report yes/no + the evidence. Do NOT fix it — this is a
    report only; if present, you'll file it as a new triage
    item in Step 6.

WAIT for greenlight before Step 1.

================================================================
STEP 1 — B18-025 middleware → proxy rename (after 0a greenlit)
================================================================

Rename middleware.ts → proxy.ts; apply the export change Step 0a
identified (if any). Preserve EXACTLY: config.matcher, the auth-
redirect logic, the i18n locale detection, the x-pathname
injection. Update any import that referenced the old module.

Then, IN THE SAME COMMIT:
  - CLAUDE.md: confirm it already says proxy.ts; fix any lingering
    middleware.ts reference.
  - launch-checklist.md §8: grep middleware.ts → grep proxy.ts.
  - current-phase.md: update references; remove the "middleware.ts
    deprecation warning" gotcha (now resolved).

Verify: dev server boots with NO middleware deprecation warning;
smoke the three paths — (a) unauthenticated request → login
redirect, (b) authenticated dashboard loads, (c) locale detection
still resolves. The x-pathname header MUST still be present on a
dashboard request (the onboarding guard depends on it).

Commit: "refactor(routing): rename middleware.ts to proxy.ts for Next 16 (B18-025)"

================================================================
STEP 2 — B18-060 close the login oracle (after 0b greenlit)
================================================================

In the login action, collapse EVERY signInWithPassword failure
to ONE generic outcome: same message key
(errors.login.invalid_credentials or the existing generic key),
same status, same shape — for unregistered, wrong-password, and
unconfirmed alike. Remove every branch that switched on the
Supabase error code to render a distinct message. Map unknown
auth errors to the same generic key (never leak a raw provider
message).

Commit: "fix(auth): collapse login errors to remove enumeration oracle (B18-060)"

================================================================
STEP 3 — B18-060 the unconditional resend affordance
================================================================

Add an ALWAYS-RENDERED "Resend confirmation email" link on the
login page, pointing to /resend-confirmation. It is NOT gated on
any detected state — it renders for everyone, every time, the
same way "Forgot password?" does. (A conditional render
reintroduces the oracle — do not do it.)

Commit: "feat(auth): unconditional resend-confirmation link on login (B18-060)"

================================================================
STEP 4 — B18-060 the /resend-confirmation route
================================================================

Create /resend-confirmation by mirroring /forgot-password
exactly. Differences from the template:
  - canonicalizeEmail(email) before anything (per locked choice 4).
  - Rate-limit via auth_rate_limits keyed on canonical email + IP,
    BEFORE the resend (mirror forgot-password's rate-limit call).
  - supabase.auth.resend({ type: '<confirmed-in-0b>', email }).
  - The response is ALWAYS the identical generic message,
    regardless of whether the email exists, is unconfirmed, is
    already confirmed, or doesn't exist. Normalize Supabase's
    response so no provider detail leaks.
  - On rate-limit exceeded: a generic "too many requests" — does
    not leak existence.
  - Any URL built from config.server.APP_URL, never headers.

Add a code comment at the auth-failure normalization point AND
at the resend point documenting the accepted residual timing
oracle (per locked choice 8): Supabase owns auth timing; app-
layer constant-time is out of scope; this matches forgot-password.

Commit: "feat(auth): /resend-confirmation route, anti-enumeration (B18-060)"

================================================================
STEP 5 — B18-060 locale files
================================================================

Add EN/PT/ES keys for: the resend page (heading, body, email
field, submit, the generic success message, the generic rate-
limit message) and the login "Resend confirmation email" link
label. No hardcoded English anywhere in Steps 2–4.

Commit: "i18n(auth): resend-confirmation copy in en/pt/es (B18-060)"

================================================================
STEP 6 — Docs + triage
================================================================

session-18-triage.md:
  - B18-060, B18-025 → ✅ shipped.
  - If Step 0b found a signup enumeration vector: file NEW item
    B18-086 — signup-enumeration-oracle, tier P1-EXP (security,
    same class as B18-060 but signup-side; needs the same Option-3
    treatment on the signup path). Cite the evidence from 0b.

current-phase.md:
  - status → "Session 18B-4 Builder complete".
  - Remove the middleware.ts deprecation gotcha (done in Step 1).
  - Key Decisions line: "Login is anti-enumeration (one generic
    error across all states); unconfirmed users self-serve via an
    unconditional /resend-confirmation link mirroring forgot-
    password. Residual timing oracle accepted (Supabase owns auth
    timing), matching forgot-password."

Commit: "docs: close B18-060/025, record auth anti-enumeration posture"

================================================================
STEP 7 — Verify
================================================================

  - npx tsc --noEmit --skipLibCheck   (clean)
  - lint clean
  - scoped vitest (per current-phase.md gotchas):
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics \
        app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
  - Manual oracle smoke (the load-bearing check): hit login with
    (a) an unregistered email, (b) a registered email + wrong
    password, (c) a registered-unconfirmed email. All three MUST
    return the identical body + status. Record the three
    responses in chat to prove indistinguishability.
  - Manual resend smoke: /resend-confirmation with a real
    unconfirmed email and a junk email — identical response.

Do NOT run `npm run build` (known ECC failure). Do NOT run bare
vitest.

================================================================
Hard rules
================================================================

- B18-060: indistinguishability across states is the whole point.
  No conditional rendering, no state-specific message, no status-
  code difference. If unsure whether something leaks, it leaks —
  surface it.
- B18-025: behaviour-preserving. x-pathname MUST survive the
  rename; the onboarding guard depends on it.
- Do NOT fix signup enumeration here — report and file only.
- Do NOT invent a new resend pattern — mirror forgot-password.
- Do NOT leak a raw Supabase error message to any client.
- Do NOT add console.*, any, or process.env outside lib/config.ts.
- One commit per step. Confirm reading, then give the Step 0
  reports.
```

## Reviewer prompt

Paste into a fresh Opus 4.7 Claude Code session after Builder closes.

```text
================================================================
SESSION 18B-4 PHASE C — REVIEWER (PARALLEL SECURITY + TS)
================================================================

You are the Reviewer for SŌSH Session 18B-4. The Builder closed
an account-enumeration oracle on login (B18-060) and renamed
middleware.ts → proxy.ts (B18-025). The security lens is load-
bearing — an oracle that survives the "fix" is a B finding.
Read the diff, not the commit messages.

Run two parallel lenses, synthesize, no code changes.

================================================================
Required reading
================================================================

1. session-18.md §"Session 18B-4 — Locked design choices" — any
   deviation is a finding.
2. session-18-triage.md — confirm closures; check whether a
   B18-086 signup item was filed (and whether it should have been).
3. CLAUDE.md.
4. The Builder's diff for 18B-4. Find via:
     git log --since="<date>" --pretty=oneline
   Read every changed file in full, including locale JSON.
5. The forgot-password action — the template B18-060's resend
   route claims to mirror. Compare them side by side.
6. The Step 0a/0b recon the Builder posted in chat.

================================================================
LENS 1 — security-reviewer (LOAD-BEARING)
================================================================

This lens assumes the oracle survives until proven closed.

S1. LOGIN INDISTINGUISHABILITY. Walk every path out of the login
    action for three inputs: unregistered email, registered+wrong-
    password, registered+unconfirmed. They MUST emit the identical
    message key, HTTP status, and response shape. ANY divergence
    (a different key, a different status, an extra field, a
    different redirect) is a B. Verify unknown/unmapped Supabase
    errors also collapse to the generic key — a future Supabase
    error code must not leak through a default branch.
S2. NO RAW PROVIDER MESSAGE leaks to the client anywhere in the
    login or resend paths. Grep for any place a Supabase
    error.message could reach a user-facing string.
S3. RESEND INDISTINGUISHABILITY. /resend-confirmation returns the
    identical response for: real unconfirmed email, real confirmed
    email, nonexistent email. The Supabase resend() response is
    normalized — "user already confirmed" / "user not found" must
    NOT change the client-visible outcome.
S4. CONDITIONAL-RENDER CHECK. The login "resend confirmation" link
    is unconditional. If it renders based on any detected state,
    that reintroduces the oracle — B finding.
S5. RATE-LIMIT DOESN'T LEAK. The auth_rate_limits keying is on the
    attempt (email+IP), and the limit-exceeded response is generic.
    A rate-limit response that differs by whether the account
    exists is a leak.
S6. CANONICALIZATION CONSISTENCY. The resend path canonicalizes
    email the same way login/signup do (B18-061 helper). A
    mismatch is a subtle oracle and a correctness bug.
S7. URL SOURCE. Any URL in the resend path comes from
    config.server.APP_URL, never request headers (the H-01
    posture). A header-derived URL is a B.
S8. RESIDUAL TIMING ORACLE is documented (code comment + triage/
    ADR), not silently ignored. Confirm the Builder didn't try a
    half-baked app-layer constant-time hack that gives false
    assurance.
S9. SIGNUP ENUMERATION. Confirm the Builder actually performed the
    Step 0b signup check and either (a) filed B18-086 with
    evidence, or (b) demonstrated the vector doesn't exist. A
    silent skip is an H.

================================================================
LENS 2 — typescript-reviewer / regression (middleware rename)
================================================================

R1. PROXY RENAME BEHAVIOUR. config.matcher is byte-identical. The
    auth-redirect logic, i18n locale detection, and x-pathname
    injection are unchanged. THE x-pathname HEADER MUST STILL BE
    SET — trace it through to the dashboard layout's onboarding
    guard; if it's gone, the guard silently breaks (H at least,
    B if it changes a redirect). Confirm the export name matches
    what Step 0a said the Next version requires.
R2. NO STALE REFERENCES. Grep the whole tree for `middleware.ts`
    — zero survivors outside historical session notes. CLAUDE.md,
    launch-checklist §8, current-phase all updated in the SAME
    commit as the rename.
R3. CLAUDE.md BASELINE on all new code: no any, no console.*, no
    process.env outside lib/config.ts.
R4. I18N COMPLETENESS. Every new string has EN/PT/ES keys; no
    hardcoded English in the login/resend changes. No orphan key
    (referenced but missing in one locale).
R5. SCOPE DISCIPLINE. Flag any change not part of B18-060/B18-025
    — especially any signup-path edit (that was report-only).

================================================================
SYNTHESIS
================================================================

Write docs/session-18b4-review.md with B/H/M/L sections.

Tiering:
- B: any surviving enumeration vector (login or resend), any
  raw-provider-message leak, a header-derived URL, a behaviour
  change in the proxy rename (esp. lost x-pathname), or a
  conditional resend link.
- H: CLAUDE.md violation, stale middleware.ts reference, missing
  locale key, skipped signup-enumeration check.
- M / L: usual nitpicks.

Be aggressive on S1/S3/S4 — anything that MIGHT let the three
login states or the resend states be told apart goes to B by
default; downgrade only with explicit reasoning.

Report counts, full B and H lists, path to review file. STOP.

Hard rules: as 18B-1 Phase C. Read the diff, do not trust commit
messages, do not modify any code, only new file is
docs/session-18b4-review.md.
```

### Adjudication

After Reviewer reports:
- B → 18B-4D correction pass (same shape as prior Nd passes)
- H disagreed with → override in chat with explicit technical reasoning
- M/L → add to `docs/session-18-triage.md` as P2

If zero B findings, skip 18B-4D and move to 18B-5.

**Likely correction-pass trigger:** B18-060 S1/S3 — a state that still tells itself apart (a stray status-code difference, an unmapped Supabase error falling through a default branch, or a resend response that varies by account existence). The enumeration property is binary: it either holds across all three states or it doesn't, and the manual oracle smoke in Step 7 is the proof. The likely *new* open thread out of this session is **B18-086** (signup-side enumeration) if Step 0b finds it — scoped out deliberately, filed for its own session.

## 18B-4D — Correction pass

**Status:** Triggered (elective). Reviewer returned **B 0 / H 0 / M 1 / L 3** (`docs/session-18b4-review.md`) — a PASS. The oracle is genuinely closed on both login and resend, the proxy rename is behaviour-preserving, and B18-086 (signup enumeration) was checked and filed with evidence, not skipped. The `skip 18B-4D if zero B` heuristic is overridden by choice to clear the tail now, because M1 is a missed *locked* deliverable and L1 is this session's own orphaned debt — cheap to close before they calcify. **This is a documentation + dead-key pass: zero behavioural change, unlike 18B-3D.**

**Adjudication:**
- **M1** (residual login timing oracle undocumented) → **fix.** Locked design choice 8 required the residual to be recorded (code comment + triage note); the Builder correctly avoided a fake constant-time hack but skipped the note. Completing the deliverable, not adding scope.
- **L1** (orphaned i18n keys `login.resend_confirmation`, `errors.login.confirm_email` in all 3 locales) → **fix.** Orphaned *by this session's* banner removal; clean the footprint here.
- **L2** (resend `emailRedirectTo` implicit) → **file, do NOT patch.** It is consistent with signup (a resend-confirmation email *is* a signup-confirmation email and should land where signup confirmations land). A one-sided pin to `APP_URL` would remove the resend↔forgot-password gap but open a worse resend↔signup gap. The real decision — pin `APP_URL` on the signup-confirmation flow for preview/staging env-parity — must cover signup + resend *together*, and signup is out of scope this session. Filed as B18-087 (P2).
- **L3** (cosmetic whitespace realign in `rate-limit.ts`) → **accept, no action.** Already shipped, harmless, in-scope.

### 18B-4D Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-4D — CORRECTION PASS (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-4D, a small
documentation + cleanup pass on 18B-4. The Reviewer
(docs/session-18b4-review.md) returned a PASS (B 0 / H 0). There
is NO behavioural change in this pass — you are recording a known
residual, deleting dead i18n keys, and filing one triage item.

If you find yourself changing what a user sees, what gets stored,
or any auth/redirect behaviour, STOP — that is out of scope.

================================================================
Required reading
================================================================

1. docs/session-18b4-review.md — M1, L1, L2 in full.
2. login/actions.ts — the generic-error return (the M1 comment site).
3. The B18-060 closure note in session-18-triage.md.

================================================================
STEP 1 — M1: document the residual timing oracle
================================================================

The response-SHAPE oracle is closed. A residual TIMING oracle
remains at the GoTrue layer (signInWithPassword may return faster
for a nonexistent user than for a registered-user-wrong-password,
depending on GoTrue's dummy-hash behaviour). It is an accepted
limitation — Supabase owns auth timing; app-layer constant-time
is explicitly out of scope and would give false assurance.

Record it in two places, no behaviour change:
  - A one-line comment at the generic-error return in
    login/actions.ts (the single `if (error)` collapse point):
    e.g. "Residual: response shape is uniform across states, but
    GoTrue may still leak existence via timing. Accepted —
    Supabase owns auth timing; no app-layer constant-time. Matches
    forgot-password. (B18-060)"
  - A sentence appended to the B18-060 closure note in
    session-18-triage.md to the same effect.

Commit: "docs(auth): record accepted residual timing oracle on login (B18-060)"

================================================================
STEP 2 — L1: remove orphaned i18n keys
================================================================

`login.resend_confirmation` and `errors.login.confirm_email` were
used ONLY by the removed amber banner. FIRST grep the whole tree
(*.ts/*.tsx) to confirm zero references to each key. If a grep
shows ANY reference, STOP and report — do not delete a live key.

If confirmed dead: remove both keys from all three locale files
(en, pt, es). Re-grep to confirm zero references remain and that
no OTHER key was accidentally touched.

Commit: "chore(i18n): remove orphaned login keys after banner removal (B18-060 L1)"

================================================================
STEP 3 — L2: file the triage item (NO code change)
================================================================

Add to session-18-triage.md:
  NEW item B18-087 — confirmation-redirect-env-parity, P2.
  The signup-confirmation flow (both entry points: signup AND
  resend-confirmation) omits emailRedirectTo, so confirmation
  links resolve to the Supabase-dashboard Site URL rather than
  config.server.APP_URL. Correct and consistent in production
  (Site URL == APP_URL), but in preview/staging the link points
  at the configured Site URL, not the preview deployment. If
  multi-environment confirmation links ever matter, pin
  emailRedirectTo from APP_URL on BOTH signup and resend together
  (one-sided would create a signup↔resend asymmetry). Not a
  security issue, not a prod-correctness issue.

Do NOT touch resend-confirmation/actions.ts or signup/actions.ts
in this pass.

Commit: "docs: file B18-087 confirmation-redirect env-parity (P2)"

================================================================
STEP 4 — Docs
================================================================

current-phase.md:
  - status → "Session 18B-4 complete (18B-4D cleanup applied)".
  - Key Decisions: append to the existing anti-enumeration line:
    "Residual GoTrue timing oracle documented + accepted."

Commit: "docs: close 18B-4D"

================================================================
STEP 5 — Verify
================================================================

  - npx tsc --noEmit --skipLibCheck   (clean)
  - lint clean
  - scoped vitest (per current-phase.md gotchas):
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics \
        app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
  - grep confirms both orphaned keys are gone from all 3 locales
    and referenced nowhere; no other key changed.

Do NOT run `npm run build` (known ECC failure). Do NOT run bare
vitest.

================================================================
Hard rules
================================================================

- Zero behavioural change. Documentation + dead-key deletion only.
- Do NOT touch emailRedirectTo / the resend or signup actions —
  L2 is filed, not fixed.
- Delete a key ONLY after a grep proves it's dead.
- One commit per step. Confirm reading, then begin Step 1.
```

**Adjudication (post-18B-4D):** no Reviewer pass needed — this is documentation + verified-dead-key deletion with a grep gate. Spot-check the diff is comment/JSON/markdown only (no logic touched). Once green, 18B-4 closes; open threads carried forward are **B18-086** (signup enumeration, P1-EXP, own session) and **B18-087** (confirmation-redirect env-parity, P2).

---

# Session 18B-5 — Docs + tiny cleanups

**Status:** ✅ Complete. 18B-5D correction pass applied (B1 email snapshots, B2 duplicate toUtcIso, B3 Stripe ban allowTypeImports + billing exception). All P1-CHEAP items cleared. Session 18 fully closed: CI green, vitest 1071 pass / 0 fail, lint clean.

**Scope (21 items from triage):**

*Verify-first (can escalate out of the batch):*
- B18-064 postcss-cve — `npm audit` severity; apply override/patch if it doesn't force a Next bump, else escalate
- B18-068 campaign-date-coltype — confirm `start_date`/`end_date` are `date` not `timestamptz`; migration only if wrong
- B18-074 revalidatepath-verify — confirm i18n bracket-path revalidation holds in Next 16
- B18-034 vault-cleanup-logging — verify what 17B already covered; fix only the still-silent callback-route catches
- B18-085 formatISO-local-audit *(carried from 18B-3D)* — probe whether `formatISO(new Date())` in `businesses.ts`/`campaigns.ts`/`posts.ts` crosses a boundary; tier + fix or defer

*Docs / ADR reconciliation (no code):*
- B18-005 adr0008-t1-window-drift · B18-006 svixid-pk-adr-drift · B18-026 oauthauthorizeinput-adr · B18-043 adr-crossref-drift · B18-045 checklist-tunable-rows · B18-009 email-templates-any-casts (document the exception in CLAUDE.md)

*Small code cleanups:*
- B18-001 email-suppressed-errorcode · B18-002 email-footer-14px · B18-004 marketing-skiptocontent-i18n · B18-011 cron-auth-failure-log · B18-031 fetch-failed-dead-enum · B18-066 banner-localstorage · B18-072 valid-transitions-map · B18-073 posts-double-sort

*Tooling / config:*
- B18-046 explicit-sentry-token · B18-081 stripe-client-import-eslint · B18-084 janitor-monitor-schedule

**Est:** ~4.5h realistic (the triage's per-item sum is ~275min; with switching, commits, closes, and the verify phase it's a two-sitting session, not 3h). **Recommend splitting across two sittings** if energy/context budget is tight: 5-0 (verify) + docs in one, code + tooling + closes in the other. Single session is fine if you'd rather keep it atomic.

**Pattern:** Builder-led, no Architect pass — but with a **Step 0 verification gate** (four verify items + the B18-085 probe can each pull work *out* of the batch into their own item) and a **focused single-lens Reviewer pass** at the end. The stub framed this as "no review needed"; that's overruled. 18B-3 was also "trivial refactors" and shipped two H findings — trivial × 21 is exactly where a silent regression hides in a green suite. The review is correctness + scope + "are the verify conclusions sound," not the full parallel-lens treatment.

**The three cardinal rules for this session:**
1. **A verify item that turns out to need a migration or a Next bump LEAVES the batch.** It becomes its own filed item; it does not balloon this session mid-stream. That's what Step 0 is for.
2. **Code cleanups are behaviour-preserving** unless the item is explicitly a fix (B18-002 footer size, B18-001 type member). Display order, stored values, error strings, render output — unchanged. B18-073 (remove a redundant sort) is the trap: the surviving sort must produce the identical order.
3. **Docs reconciliations make the docs match the CODE, never the reverse.** Every drift item here (B18-005/006/026/043) has the same note: the code is correct, the doc drifted. Do not "fix" working code to match a stale ADR.

## Locked design choices

Trivial items (B18-002 13px→14px, B18-004 three locale keys, B18-005/006/026/043/045 doc reconciliations, B18-011 parallel warn log, B18-066 storage swap, B18-081 ESLint ban) execute exactly per their triage description and need no further decision. The decision- or risk-bearing items:

1. **B18-064 (postcss CVE) → Step 0 gate, escalate on Next bump.** Run `npm audit`. If a `pnpm.overrides`/patch pins a fixed postcss without bumping Next.js → apply it (cheap, in-batch). If the only fix is a Next.js version bump → STOP, file it as its own micro-session (a Next bump touches routing, build, the proxy rename — not batch material). Report the audit output in Step 0 either way.
2. **B18-068 (campaign date coltype) → verify-only, escalate if wrong.** Confirm in the migration history that `start_date`/`end_date` are `date`. If they are → no code, close as verified. If they're `timestamptz` → that's a TZ-correctness bug needing a migration + a data-backfill consideration; STOP and file it separately, do not attempt the migration inside this batch.
3. **B18-074 (revalidatePath) → verify-only.** Confirm `revalidatePath` with the `/[locale]/...` bracket path actually invalidates the cache in Next 16 (the dynamic-segment behaviour changed across versions). If it works → document the confirmation in the relevant code comment/ADR and close. If it's broken → that's a live cache-staleness bug; report it, fix in-batch only if the fix is a one-liner, else file separately.
4. **B18-085 (formatISO local audit) → Step 0 probe, tier then act.** For each `formatISO(new Date())` site in `businesses.ts`/`campaigns.ts`/`posts.ts`: report what the string is used for. If any crosses a `timestamptz` write or a string comparison → it's the same UTC-vs-local hazard B18-041 fixed → fix it with `toUtcIso` in-batch and extend the `.toISOString()` lint rule's intent (or add a sibling rule) to catch `formatISO(new Date())`. If all are display-only → defer as P2, note in triage. Decide the tier from evidence, don't guess.
5. **B18-034 (vault cleanup logging) → fix only what's still silent.** 17B already added `captureException` to `social-accounts.ts`. Verify which catches remain silent — the triage says the OAuth callback route's reconnect/compensating-transaction catches "likely remain." Mirror the existing 17B pattern into exactly those, no more. Don't re-instrument what 17B already covered.
6. **B18-001 (suppressed errorcode) → add the type member, not amend the ADR.** ADR 0008 §4 documents 6 codes; the union has 5. The ADR is the design intent and `suppressed` is a real Resend event class — add `| 'suppressed'` so the type matches the ADR. (Only amend the ADR down to 5 if Builder confirms `suppressed` is genuinely unreachable and never will be produced — report that finding before choosing.)
7. **B18-009 (email-templates any casts) → document the exception, keep the casts.** The two `any` casts are a legitimate template-registry escape hatch. Cheapest correct fix is a named carve-out in CLAUDE.md's no-any rule citing the specific file + pattern, leaving the `eslint-disable` in place. Do NOT contort the registry types to remove the casts.
8. **B18-031 (fetch_failed dead enum) → remove only after confirming zero producers AND zero consumers.** Grep both. If a consumer branch handles `fetch_failed`, removing the producer-less value would leave dead handling — report it; the safe removal is value + its dead handler together. If anything looks like it *should* produce it, that's a latent bug → report, don't silently delete.
9. **B18-072 (valid-transitions map) → JSDoc unless the edges are real.** The reasoning is that the map only governs generic `updatePost`, and unapprove/unskip route through dedicated actions. Confirm that: if unapprove/unskip do NOT pass through this map, add a JSDoc documenting the map's scope (the fix). If they DO pass through it and are wrongly rejected, add the two edges (that's a latent bug fix). Report which before acting.
10. **B18-073 (posts double-sort) → remove the client re-sort, prove order unchanged.** The server query already sorts; `PostsClient` re-sorts. Remove the client sort and confirm the server `ORDER BY` produces the identical order the client was imposing (same keys, same direction, same tiebreak). If they differ, the "redundant" sort wasn't redundant — report rather than change displayed order.
11. **B18-084 (janitor monitor schedule) → remove the wrap if the janitor has no independent schedule.** The janitor piggybacks on the publish tick (it's wired into `runJanitorTick`, not a standalone cron), so `Sentry.withMonitor('janitor-cron')` declaring no schedule is correct-but-warning-y. Confirm the cadence: if it has no independent schedule, remove the `withMonitor` wrap (the publish-cron monitor already covers the tick) rather than inventing a fake schedule. If it does run independently, declare the real schedule.
12. **B18-046 (explicit sentry token) → use the project's `next.config.ts` env convention.** Pass `SENTRY_AUTH_TOKEN` explicitly to `withSentryConfig`. `next.config.ts` is build-time config, typically exempt from the `process.env`-only-in-`lib/config.ts` rule — confirm the existing convention in that file and follow it; don't introduce a new env-access pattern.

## Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-5 — DOCS + TINY CLEANUPS (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-5, the FINAL mini-session
of the Session 18 triage. 21 items, locked design choices in
session-18.md §"Session 18B-5 — Locked design choices."

This is a batch, but it is NOT "just run 21 tickets." Three rules
govern everything:
  1. A verify item that needs a migration or a Next bump LEAVES
     the batch — file it, don't balloon this session.
  2. Code cleanups are behaviour-preserving (same order, same
     stored value, same render) unless the item is explicitly a
     fix.
  3. Docs reconciliations make docs match CODE, never the reverse.

Time budget: ~4.5h. This is a two-sitting session — if you pass
~2.5h, finish the current phase, commit, and report a clean
stopping point rather than rushing the tail.

================================================================
Required reading
================================================================

1. CLAUDE.md — no-any (+ where exceptions are documented), i18n-
   from-day-one, no console.* / process.env outside lib/config.ts
   (and the next.config.ts convention), atomic-transition rule.
2. session-18.md §"Session 18B-5 — Locked design choices" — your
   spec for every decision-bearing item.
3. session-18-triage.md — the P1-CHEAP section; each item's row +
   Source line. This is also where you record closures.
4. For each verify item, the underlying code/migration (Step 0
   lists them).

Confirm what you've read, then go straight to Step 0.

================================================================
STEP 0 — VERIFICATION GATE (report, no cleanup yet)
================================================================

Run all of these and report findings in ONE chat message. Several
can pull work OUT of this batch — decide that here, before any
cleanup commit.

  a. B18-064: `npm audit` (or pnpm). Report the postcss advisory +
     severity. Can it be pinned via overrides/patch WITHOUT bumping
     Next.js? yes → in-batch; no (needs Next bump) → file as own
     micro-session.
  b. B18-068: grep the migrations for campaigns.start_date /
     end_date column type. `date` → verified, no code. `timestamptz`
     → file separately (migration + TZ correctness), do NOT migrate
     here.
  c. B18-074: how is revalidatePath called with the locale bracket
     path, and does Next 16 invalidate it? Report works / broken.
  d. B18-034: which vault-delete catches did 17B already
     instrument (social-accounts.ts) and which remain silent
     (OAuth callback route)? List the still-silent sites.
  e. B18-085: each formatISO(new Date()) site in businesses.ts /
     campaigns.ts / posts.ts — what is the string used for (DB
     timestamptz write / string compare / display)? Boundary-
     crossing → in-batch fix; display-only → defer P2.
  f. B18-031: grep producers AND consumers of the `fetch_failed`
     enum value. Report both counts.
  g. B18-072: do unapprove/unskip actions route through
     VALID_TRANSITIONS, or through dedicated actions that bypass
     it? Report which.
  h. B18-084: does the janitor run on an independent schedule, or
     only on the publish tick via runJanitorTick? Report.

For each item that escalates out (064-needs-bump, 068-wrong-type,
074-broken, 085-boundary-and-nontrivial): say so explicitly and
note it'll be filed in Step 4, not fixed here.

WAIT for Tiago's greenlight before any cleanup.

================================================================
STEP 1 — Docs / ADR reconciliation (no code; group by file OK)
================================================================

Code is the source of truth for all of these — make the docs
match it:
  - B18-005: ADR 0008 §10 T-1 window text → match implemented
    [now+1d, now+2d).
  - B18-006: ADR 0008 §14 → document svix-id as the idempotency PK.
  - B18-026: ADR 0002 open-follow-ups → note OAuthAuthorizeInput's
    2 extra fields.
  - B18-043: cross-reference ADR 0005 A1 ↔ ADR 0006 §12/§13 after
    the QStash migration.
  - B18-045: launch-checklist §1 → expand the ~14-tunable grep row
    to per-var.
  - B18-009: add a named no-any carve-out to CLAUDE.md for the
    lib/email/templates/index.ts registry casts; leave the casts +
    eslint-disable in place.

Commits: one per item, OR group same-file ADR edits into logical
commits (e.g. both ADR 0008 edits together). Reference the item
IDs in each message.

================================================================
STEP 2 — Small code cleanups
================================================================

  - B18-001: add `| 'suppressed'` to EmailProviderErrorCode (per
    locked choice 6 — report first only if you find it's truly
    unreachable).
  - B18-002: email footer 13px → 14px.
  - B18-004: replace hardcoded "Skip to content" with an i18n key
    + en/pt/es entries; wire it.
  - B18-011: add the parallel structured `console.warn` to the
    Bearer cron-auth-failure path in both route guards (match the
    QStash branch's shape).
  - B18-031: remove `fetch_failed` per locked choice 8 (value +
    any dead handler together; only if Step 0 confirmed no live
    producer/consumer).
  - B18-066: banner dismissal sessionStorage → localStorage; keep
    the existing client-only/SSR guard.
  - B18-072: per Step 0 — JSDoc the map's scope, OR add the
    unapprove/unskip edges if they really route through it.
  - B18-073: remove the redundant PostsClient sort; confirm the
    server ORDER BY yields the identical order (locked choice 10).
  - B18-034: mirror 17B's captureException into the still-silent
    callback-route catches from Step 0(d) — those only.
  - B18-074: if Step 0(c) said "works", add the confirming code
    comment/ADR note and close. If "broken", handle per locked
    choice 3.
  - B18-085: if Step 0(e) found a boundary-crossing site, fix it
    with toUtcIso and add/extend the lint rule to catch
    formatISO(new Date()); else skip (deferred in Step 4).

One commit per item. Behaviour-preserving except B18-001/002/004
(explicit fixes/additions).

================================================================
STEP 3 — Tooling / config
================================================================

  - B18-046: pass SENTRY_AUTH_TOKEN explicitly to withSentryConfig
    via the existing next.config.ts env convention (locked 12) +
    the ADR note.
  - B18-081: ESLint ban on client value-imports of
    @/lib/stripe/{products,checkout} + a `typeof window` guard;
    confirm it doesn't fire on the existing type-imports.
  - B18-084: remove the Sentry.withMonitor('janitor-cron') wrap if
    Step 0(h) confirmed no independent schedule; else declare the
    real schedule (locked 11).
  - B18-064: apply the override/patch from Step 0(a) IF it doesn't
    need a Next bump.

One commit per item.

================================================================
STEP 4 — Closes, escalations, and the after-session checklist
================================================================

session-18-triage.md — for EVERY item: ✅ shipped / ✅ verified-no-
change / ⏭ deferred-P2 / ➡ escalated-to-own-item. File any
escalations from Step 0 as new rows (e.g. B18-064-bump,
B18-068-migration, B18-085-deferred) with the evidence.

Run the after-session checklist at the foot of session-18.md:
  - Remove every closed item from its original source
    (backlog.md, launch-checklist.md, current-phase.md gotchas,
    ADR follow-ups).
  - Confirm no triage P0 remains open.
  - backlog.md reflects only the post-Session-18 P2 list, in
    priority order.
  - current-phase.md "Known gotchas" has only still-true ones
    (the middleware gotcha is already gone from 18B-4).
  - Note the one P1 that remains open BY DESIGN: B18-014 (in-app
    delete) is a deferred enhancement, not a blocker — launch
    erasure is email-based per ADR 0010 A1. And B18-086 (signup
    enumeration) is its own future security session. Neither is a
    18B-5 miss.

current-phase.md status → "Session 18 complete (18B-1 → 18B-5);
all P1 closed except deferred-by-design B18-014/B18-086."

Commits: "docs: close 18B-5 items + triage" and a separate
"docs: post-Session-18 backlog + gotcha cleanup".

================================================================
STEP 5 — Verify
================================================================

  - npx tsc --noEmit --skipLibCheck   (clean)
  - lint clean (incl. the new B18-081 rule and any B18-085 rule)
  - scoped vitest (per current-phase.md gotchas):
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics \
        app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
  - i18n: every new key (B18-004, any B18-085) resolves in en/pt/es.

Do NOT run `npm run build` (known ECC failure). Do NOT run bare
vitest.

================================================================
Hard rules
================================================================

- Escalate, don't balloon: a verify item needing a migration or a
  Next bump is filed, not done here.
- Behaviour-preserving cleanups: B18-073 order, B18-031 removal,
  B18-034 logging must not change any observable output/order.
- Docs match code, never the reverse.
- Do NOT remove fetch_failed if a live consumer handles it.
- Do NOT touch B18-014 or B18-086 — deferred by design.
- One commit per item (same-file ADR edits may group).
- Confirm reading, then give the Step 0 report.
```

## Reviewer prompt

Paste into a fresh Opus 4.7 Claude Code session after Builder closes. Single focused lens — this batch has no one load-bearing change, but 21 small diffs need a conformance + scope sweep.

```text
================================================================
SESSION 18B-5 PHASE C — REVIEWER (FOCUSED SINGLE LENS)
================================================================

You are the Reviewer for SŌSH Session 18B-5, the final batch of
Session 18. 21 small items. No single load-bearing change, so one
focused lens: per-item conformance, behaviour-preservation, scope
discipline, and — critically — whether the Step 0 VERIFY
conclusions are actually sound. A wrong "verified, no change" is
the most dangerous output of a batch like this, because it closes
an item that was never checked. Read the diff and the Step 0
report, not the commit messages.

================================================================
Required reading
================================================================

1. session-18.md §"Session 18B-5 — Locked design choices".
2. session-18-triage.md — confirm every one of the 21 items has a
   closure status, and that escalations were filed as new rows
   with evidence.
3. The Builder's Step 0 report (in chat) — you are re-checking its
   verify conclusions.
4. The Builder's diff for 18B-5. Read every changed file.

================================================================
Checks
================================================================

V1. VERIFY CONCLUSIONS (highest priority).
   - B18-064: does the audit output actually support the chosen
     path? If "no Next bump needed", confirm the override pins a
     fixed postcss and CI/lint still pass. If escalated, confirm
     it's filed.
   - B18-068: independently confirm the column type from the
     migration. A "verified date" that's actually timestamptz is
     a B.
   - B18-074: is the works/broken conclusion evidenced, or
     asserted? If "works", is there a real basis (test, doc, Next
     16 behaviour)? 
   - B18-085: for each formatISO(new Date()) site, is the boundary
     classification correct? A display-only call mis-classified as
     "safe to defer" when it actually feeds a timestamptz write is
     a B.
   - B18-034: are the newly-instrumented catches exactly the ones
     17B left silent — no double-instrumentation, none missed?

C1. CONFORMANCE: each of the 21 matches its locked choice / triage
    description. Spot every decision item (001 added-not-amended,
    009 documented-not-contorted, 031 removed-cleanly, 072
    jsdoc-vs-edges, 073 sort, 084 wrap-removed-or-scheduled,
    046 env-convention).

B1. BEHAVIOUR-PRESERVATION on the cleanups:
   - B18-073: the surviving server sort produces the IDENTICAL
     order (keys, direction, tiebreak) the client sort imposed. A
     changed display order is a B.
   - B18-031: removing fetch_failed left no consumer branch
     dangling; nothing now falls through a missing case.
   - B18-034: logging added, no control-flow change in the catch.
   - B18-066: localStorage swap keeps the SSR/client guard; no
     hydration error.

S1. SCOPE: every changed file maps to one of the 21 items. Flag
    any "while I was in there" edit. Confirm B18-014 and B18-086
    were NOT touched.

D1. DOCS-MATCH-CODE: the ADR/checklist edits (005/006/026/043/045)
    describe what the code actually does — no doc now asserting a
    behaviour the code doesn't have.

I1. i18n: B18-004 (and any B18-085) keys present + resolving in all
    three locales; no orphan.

X1. CLAUDE.md baseline on all touched code: no new any (009's are
    the documented exception), no console.* beyond the intended
    B18-011 warn, no process.env outside lib/config.ts except the
    sanctioned next.config.ts use (046).

================================================================
SYNTHESIS
================================================================

Write docs/session-18b5-review.md with B/H/M/L sections.

Tiering:
- B: a wrong verify conclusion (esp. 068 type / 085 boundary), a
  changed display order (073), a dangling consumer (031), a
  behaviour change in a "preserving" cleanup, or a doc now
  asserting false behaviour.
- H: an item closed without its deliverable, a missed escalation
  filing, a CLAUDE.md violation, a missing locale key.
- M / L: usual.

Be aggressive on V1 — a verify item is only closed if its evidence
holds; "trust me, it's fine" is an H.

Report counts, full B and H lists, path to review file. STOP.

Hard rules: read the diff + the Step 0 report, do not trust commit
messages, do not modify code, only new file is
docs/session-18b5-review.md.
```

### Adjudication

After Reviewer reports:
- B → 18B-5D correction pass (same shape as prior Nd passes)
- H disagreed with → override in chat with explicit technical reasoning
- M/L → add to `docs/session-18-triage.md` as P2

If zero B findings, 18B-5 closes and **Session 18 is complete** — run the After-session checklist below in full.

**Likely correction-pass trigger:** a Step 0 verify conclusion that doesn't hold under V1 — most plausibly B18-068 (a `timestamptz` mis-read as `date`) or B18-085 (a boundary-crossing `formatISO` mis-classified as display-only). Those are the two that close an item as "no change" while actually carrying a latent TZ bug. The likely *new* threads out of this session are escalations, not regressions: B18-064 if it forces a Next bump, B18-068 if the coltype is wrong, B18-085 if it needs its own fix — each filed, not crammed in.

**Post-Session-18 state:** every P1 triage item closed except two deferred *by design* — B18-014 (in-app delete; launch erasure is email-based per ADR 0010 A1) and B18-086 (signup enumeration; its own security session). The remaining pre-launch work is the set known from the start: legal counsel ratification, the Postiz-removal workstream, email DNS/SMTP ops, and the Stripe live-mode flip.

## 18B-5D — Correction pass

**Status:** Triggered (mandatory). Reviewer returned **B 3 / H 3 / M 3 / L 3** (`docs/session-18b5-review.md`). The batch is **not closeable as-is**: three of its own changes break a standard CI gate (`vitest` red, `lint` red ×2), the triage was never updated, and three ADR items show no deliverable. The implemented cleanups that *did* land are mostly sound (068 coltype, 073 sort order, 031 enum, 034 callback catches, 072 JSDoc, 066 hydration, 004 i18n, 001, 046, 026, 045 all independently re-verified) — the failures concentrate in the two tooling items, the snapshot regen, and the skipped close-out step.

**Two things I got wrong, conceded up front:**
- **The verify command in the 18B-5 Builder prompt (Step 5) omitted `lib/email`** even though the batch edits email templates — so it structurally could not catch B1. That's a defect in the prompt, not just execution. **Methodology fix:** the scoped vitest path list in `current-phase.md` is a *floor*; every session must append the paths it actually touches. The corrected verify below includes `lib/email`.
- **The B18-085 "UTC hazard" framing was overstated.** For a `timestamptz` *write*, Postgres normalizes the offset to the correct instant, so `formatISO(new Date())` is **not a bug** there. The real risk is narrow (string comparison; non-`timestamptz` columns). B18-085 is re-tiered to P2 consistency debt; the 3 converted sites stay (toUtcIso is the target convention), the full sweep is filed, not crammed in.

**Prerequisite (strongly recommended before the 18B-5D review):** commit `session-18.md` into the repo (e.g. `docs/sessions/`). The Reviewer could not read the locked design choices — it inferred them from the triage and flagged B3 as inference-dependent. This has degraded three reviews running. (`CLAUDE.md` is now tracked but was bundled into the B18-009 commit — M2.)

**Adjudication:**

| Finding | Call | Action |
|---|---|---|
| **B1** footer snapshots red | Agree | Regenerate, eyeball footer-only, commit |
| **B2** duplicate `toUtcIso` | Agree | Delete the `lib/db/utils.ts` copy; import canonical `@/lib/utils` |
| **B3** Stripe ban too broad + misses S11 D5 | Agree | `allowTypeImports`, client-scope, add the `typeof window` guard |
| **H1** triage/verify evidence never recorded | Agree | Backfill all closures; **actually run** the B18-064 `npm audit` |
| **H2** 005/006/043 no deliverable | Agree | Verify 005/006 pre-satisfied → N/A-with-line-evidence; resolve 043 |
| **H3** wrong verify command (prompt defect) | Agree, own it | Fix verify scope + methodology note |
| **M1** carve-out names wrong mechanism | Agree | `as unknown as` → `props: any`/`React.FC<any>` |
| **M2** CLAUDE.md bundled into 009 commit | Accept | Note; ties to the docs-in-repo thread |
| **M3** partial sweep, hazard overstated | Agree (re-tier) | Keep 3, file full sweep as P2 (B18-089) |
| **L1** mislabeled commit | Note | Superseded by the real triage update |
| **L2** B18-084 de-indent | Fix | Re-indent the orphaned body |
| **L3** orphaned Sentry import? | Verify | Confirm `Sentry` still referenced |

### 18B-5D Builder prompt

Paste into a fresh Sonnet 4.6 Claude Code session.

```text
================================================================
SESSION 18B-5D — CORRECTION PASS (BUILDER)
================================================================

You are the Builder for SŌSH Session 18B-5D. The 18B-5 Reviewer
(docs/session-18b5-review.md) found the batch not closeable: three
of its own changes break CI (vitest red, lint red ×2), the triage
was never updated, and three ADR items show no deliverable.

This pass makes the build GREEN, records the evidence that was
skipped, and closes Session 18 properly. The cleanups that already
landed and were re-verified sound are NOT to be re-touched.

DO NOT close anything until BOTH `npm run lint` AND the FULL vitest
command in Step 7 are green. "Narrow loop passes" is what masked
these blockers the first time.

================================================================
Required reading
================================================================

1. docs/session-18b5-review.md — all 12 findings.
2. session-18.md §"Session 18B-5 — Locked design choices" (esp.
   choice 12 / B18-081 = S11 D5: client-scoped value-import ban +
   typeof window guard; choice 4 / B18-085 = single toUtcIso).
   If session-18.md is not in the tree, STOP and ask Tiago to
   commit it — B3 depends on the locked design and must not be
   guessed.
3. lib/utils.ts — the CANONICAL toUtcIso (the one with the single
   sanctioned eslint-disable).
4. eslint.config.mjs — the STRIPE_CLIENT_INTERNALS_BAN rule.

================================================================
STEP 1 — B2: collapse the duplicate toUtcIso
================================================================

lib/db/utils.ts defines a SECOND toUtcIso with a raw .toISOString()
and no eslint-disable — it re-trips the very ban it lives under.
Delete that function (delete the whole file only if toUtcIso was
its sole export; otherwise remove just the function). In
businesses.ts / campaigns.ts / posts.ts:
  import { toUtcIso } from '@/lib/utils'
and pass new Date() explicitly (canonical signature has no default).
Re-grep: exactly ONE toUtcIso definition remains, in lib/utils.ts.

Commit: "refactor(dates): collapse duplicate toUtcIso into @/lib/utils (B18-085 / B2)"

================================================================
STEP 2 — B3: fix the Stripe import ban to match S11 D5
================================================================

The ban currently fires on legitimate type-only imports and a
billing Server Action, and never implemented the locked design.
Two parts:
  (a) Lint rule: add `allowTypeImports: true` so `import type
      { PaidPlan }` passes, AND scope the VALUE-import ban to
      client modules only (or exempt lib/db/** + the billing
      Server Action app/[locale]/(dashboard)/billing/actions.ts).
      The 4 flagged sites must all pass:
        - lib/db/businesses.ts:3                 (type-only)
        - billing/PricingCards.tsx:11            (type-only)
        - billing/actions.ts:7                   (type-only)
        - billing/actions.ts:6 createCheckoutSession (server value)
  (b) Runtime guard: add the S11 D5 `typeof window !== 'undefined'`
      throw at the top of lib/stripe/products.ts and
      lib/stripe/checkout.ts (the backstop the lint rule names).

Run `npm run lint` — these 4 sites must be clean (pre-existing
unrelated errors in error.tsx/global-error.tsx/marketing <a> are
NOT yours; do not fix them here).

Commit: "fix(lint): scope Stripe internals ban to client value-imports + window guard (B18-081 / B3)"

================================================================
STEP 3 — B1: regenerate the email snapshots
================================================================

The footer 13px→14px change (correct, WCAG 1.4.4) left 15 EmailLayout
snapshots expecting 13px. Run the email suite with update, then
EYEBALL the diff to confirm it is footer-only (font-size:13px →
14px and nothing else):
  npx vitest run lib/email -u
  git diff --stat   # confirm only snapshot files changed
Commit the regenerated snapshots.

Commit: "test(email): regenerate footer snapshots after 14px fix (B18-002 / B1)"

================================================================
STEP 4 — L2/L3: tidy the B18-084 removal
================================================================

In lib/publishing/orchestrator.ts, re-indent the body that was left
at closure indentation after the withMonitor wrapper was removed.
Confirm `Sentry` is still imported AND still referenced (the 18B-2D
breadcrumbs use it); if the import is now unused, remove it.

Commit: "style(publishing): re-indent after withMonitor removal (B18-084 / L2)"

================================================================
STEP 5 — H1: run + record the B18-064 verify (CVE — do it for real)
================================================================

This was never evidenced. Run it now:
  npm audit            (or pnpm audit)
Record the postcss advisory + severity. Then per locked choice 1:
  - If a pnpm.overrides / patch pins a fixed postcss WITHOUT a
    Next.js bump → apply it, re-run audit to confirm resolved,
    commit.
  - If the only fix needs a Next.js bump → DO NOT bump here; file
    B18-064 as its own micro-session row in the triage with the
    audit output as evidence.
Either way the audit output goes into the triage closure note.

Commit: "fix(deps): pin postcss override per npm audit (B18-064)"   # if applied
  (or fold the escalation into the Step 6 triage commit if not)

================================================================
STEP 6 — H2 + M1: ADR items + carve-out wording
================================================================

H2 — verify each against the actual ADR text:
  - B18-005: ADR 0008 §10 — Reviewer found it already reads
    [now+1d, now+2d) (≈line 423). If so → mark N/A-already-correct
    in triage WITH the line cite. If not → make the edit.
  - B18-006: ADR 0008 §14 — Reviewer found svix-id already
    documented as the idempotency PK (≈line 508). Same: N/A-with-
    cite or edit.
  - B18-043: ADR 0005 A1 ↔ 0006 §12/§13 cross-ref — UNVERIFIED.
    Check; add the cross-reference if missing, else N/A-with-cite.

M1 — fix the B18-009 carve-out in CLAUDE.md: it says the registry
uses `as unknown as` casts, but lib/email/templates/index.ts:31-34
actually uses `props: any` / `React.FC<any>` with a
`@typescript-eslint/no-explicit-any` disable. Correct the wording
to name the real mechanism.

Commit: "docs: resolve ADR drift 005/006/043 + fix 009 carve-out wording (H2/M1)"

================================================================
STEP 7 — H1 close-out: triage + after-session checklist (the skipped step)
================================================================

session-18-triage.md — the batch added ZERO closure markers. Add,
for EVERY 18B-5 item, one of: ✅ shipped / ✅ verified-no-change /
N/A-already-correct (with cite) / ➡ escalated. Include the verify
EVIDENCE inline:
  - 068 → date (migration 20260430120009_campaigns.sql:21-22)
  - 073 → server sort identical (page.tsx:36), client sort removed
  - 031 → AiErrorCode value+test removed; route.ts:22 literal is
    an unrelated JSON string
  - 034 → 5 callback catches instrumented (17B covered
    social-accounts.ts)
  - 072 → JSDoc; unapprove/unskip bypass via own guards
  - 064 → audit result from Step 5
  - 005/006 → N/A-with-cite (or edit) from Step 6
  - 043 → from Step 6
  - 085 → 3 sites on toUtcIso; full sweep deferred (see B18-089)
  - file NEW B18-089 — date-write-convention-unify, P2: ~15
    formatISO(new Date()) timestamptz-write sites remain
    (postiz-provider, email/orchestrator, deletion/orchestrator,
    social callback:150, campaigns/generate ×11, posts/actions:282).
    NOT bugs (Postgres normalizes the instant); consistency debt.
    Unify on toUtcIso + add a formatISO(new Date()) lint rule.

Then run the After-session checklist at the foot of session-18.md:
  - Remove every closed item from backlog.md / launch-checklist.md
    / current-phase.md gotchas / ADR follow-ups.
  - backlog.md = post-Session-18 P2 list, priority order.
  - current-phase.md "Known gotchas" = only still-true ones.
  - Confirm the two P1s open BY DESIGN are recorded as such:
    B18-014 (in-app delete, email-based erasure per ADR 0010 A1)
    and B18-086 (signup enumeration, own session). Plus the new
    P2s: B18-087, B18-089, and B18-085-as-folded.

current-phase.md status → "Session 18 complete (18B-1 → 18B-5 +
correction passes); all P1 closed except deferred-by-design
B18-014 / B18-086."

Commit: "docs: close 18B-5 in triage, run after-session checklist, file B18-089"

================================================================
STEP 8 — Verify (FULL — the floor plus what this batch touched)
================================================================

  - npx tsc --noEmit --skipLibCheck   (clean)
  - npm run lint                       (clean for the 4 Stripe sites
    + lib/db/utils.ts; pre-existing unrelated errors may remain)
  - vitest — the scoped floor PLUS lib/email (the path B1 lived in):
      npx vitest run lib/db lib/social lib/campaigns lib/ai \
        lib/observability lib/publishing lib/metrics lib/email \
        lib/validation app/global-error "app/[locale]/(dashboard)" \
        "app/[locale]/(auth)"
    Must be GREEN (820+ pass, 0 fail).
  - npm audit shows the postcss advisory resolved (or the
    escalation is filed).

Do NOT run `npm run build` (known ECC failure). Do NOT close on a
narrow-loop pass.

================================================================
Hard rules
================================================================

- Green CI is the close condition: full vitest (incl lib/email) +
  lint both clean. A narrow pass is not a pass.
- Exactly ONE toUtcIso, in lib/utils.ts.
- The Stripe ban must pass type-only imports + the server action,
  and the runtime guard must exist.
- B18-064 is a CVE: run the audit, record the evidence, never
  close it unevidenced.
- Do NOT re-touch the re-verified-sound cleanups (068/073/031/034/
  072/066/004/001/046/026/045).
- Do NOT do the 15-site B18-085 sweep here — it's P2 (B18-089).
- One commit per step. Confirm reading, then begin Step 1.
```

### 18B-5D Reviewer prompt

A short confirmatory pass — this correction is mostly objectively gated (CI red→green), but B3's locked-design conformance and the verify-evidence backfill need eyes.

```text
================================================================
SESSION 18B-5D PHASE C — REVIEWER (CONFIRMATORY)
================================================================

Confirm the 18B-5 blockers are cleared without new regressions.
Read the diff + run the gates yourself.

G1. FULL vitest (the Step 8 command INCLUDING lib/email) is green,
    0 failures. Re-run it; do not trust the report.
G2. `npm run lint` is clean at all 4 Stripe sites AND lib/db/
    utils.ts. The pre-existing error.tsx/global-error/marketing
    errors may remain (confirm they pre-date this batch).
G3. B2: exactly one toUtcIso (lib/utils.ts); the 3 db files import
    it; no second definition anywhere.
G4. B3 conformance to S11 D5: allowTypeImports present; the value-
    import ban is client-scoped (or lib/db + billing-action
    exempt); the typeof window guard exists in products.ts AND
    checkout.ts. Verify the ban STILL fires on an actual client
    value-import (it must still do its job, not be neutered).
G5. B1: the snapshot diff is footer-only (13→14px); no other
    template markup changed under -u.
G6. H1 evidence: B18-064 audit output is recorded and the advisory
    is resolved or escalated-with-evidence. Every 18B-5 item now
    has a triage closure marker.
G7. H2: 005/006 are either edited or marked N/A with a real line
    cite; 043 resolved. Spot-check one cite against the ADR.
G8. Scope: no re-touch of the re-verified-sound cleanups; no new
    out-of-scope edits.

Tier: B = any gate still red, a neutered Stripe ban (passes
everything = useless), or a falsely-closed verify item. H = missing
evidence / missing closure marker. Write
docs/session-18b5d-review.md. STOP.
```

**Adjudication (post-18B-5D):** zero B is the close condition — both gates green, one `toUtcIso`, the Stripe ban scoped-but-still-effective, B18-064 evidenced. Once green, **Session 18 is complete.** New P2 threads carried out: B18-087 (confirmation-redirect parity), B18-089 (date-write-convention unify). Deferred by design: B18-014, B18-086. And the standing process item: get `session-18.md` into the repo so reviews stop running blind.

---

# After-session checklist

After each mini-session's Phase C closes (and any Nd correction passes):

- [ ] Every item closed in that mini-session is removed from its original source file (backlog.md, launch-checklist.md, current-phase.md gotchas, ADR follow-up).
- [ ] `docs/session-18-triage.md` updated with closure status per item (✅ shipped / ⏭ deferred to P2 / 🚫 rejected). The triage file is the audit trail across all five mini-sessions.
- [ ] No item that was P0 in the triage remains open. If something P0 had to be punted mid-Builder, escalate to Tiago — do not silently move P0 → P2.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` all green; scoped vitest green per the SOSH path list in `current-phase.md`.

After Session 18B-5 closes:

- [ ] `docs/backlog.md` reflects only the post-Session-18 P2 list, in priority order.
- [ ] `current-phase.md` "Known gotchas" section has only the still-true ones.
- [ ] Launch-checklist is measurably shorter; the only remaining pre-launch work should be the items known from the start: legal counsel ratification, Postiz removal workstream, email DNS/SMTP ops, Stripe live-mode flip. Anything else surfaced during 18B-1 through 18B-5 is a Session 18 win — better caught now than the morning of the flip.
