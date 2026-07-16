# ADR 0015 — Test-Execution Integrity & CI Gates

- **Status:** Accepted (design). Session 22 W1. Builder transcribes; no code in this document.
- **Date:** 2026-07-12 · **Corrected:** 2026-07-12 (B0 founder-review pass — §3.2b and §4 revised; the
  correction blocks in those sections supersede their pre-correction text). See F2/F3 callouts inline.
- **Corrections (B0):** F2 → §4 (`CI-NO-SWALLOWED-FAILURE`; the `\|\| true` false-green removed).
  F3 → §3.2b (volume-preserving restart + `CI-KNOBS-VERIFIED`; the `stop --no-backup` that wiped the knobs
  removed).
- **Supersedes / amends:** none. **Governs** the meaning of "covered" for every ADR that names a
  constraint (0012, 0013, 0014, and all future ADRs). Where an ADR's coverage table conflicts with the
  taxonomy here, this ADR's §2 tiering wins.
- **Scope:** CI topology, the test-execution contract, merge gates, and the review-at-commit process.
  **Zero product scope** (session-22 L-10): no feature, no schema change, no route, no Stripe.
- **Binding input:** `docs/build-guide/session-22.md` §0 (L-1…L-10, the D-1…D-7 ledger, the findings
  ledger) — adjudicated with the founder, encoded below, **not re-opened**.

---

## §0 — Binding decisions (encoded verbatim in intent, from `session-22.md` §0)

**Locked (L):**

- **L-1** Two workstreams, one session. **W1 = test-execution integrity** (this ADR). **W2 = approvals
  hardening** (ADR 0014 Amendment A). Shared Reviewer, independently committable. **W1 lands first** —
  W2's regression tests are worthless until something executes them.
- **L-2** `db-tests` OOM remedy = **tune + shard**. Reduce the Supabase stack's memory footprint (disable
  every service the suite does not use) and cap the Postgres runtime knobs for a 2-core runner; if a full
  run still OOMs, **shard** the DB suite into two jobs. Losers: bare `postgres` container (the suites sign
  in with real anon-key clients — GoTrue is not optional, **D-1**); a paid larger runner (buys a green
  light without understanding the crash, **D-1**).
- **L-3** App-layer suite gets its **own** workflow (`.github/workflows/app-tests.yml`): `tsc` + `eslint`
  + `vitest run` on every push and PR. Loser: a job inside `db-tests.yml` — the DB stack's flakiness would
  mask the app suite's signal, the exact failure being fixed (**D-2**).
- **L-4** Per-suite integration flags are **deleted**. A DB suite runs iff the DB env is present; a
  **skip-guard meta-test** fails the run if any file under `supabase/__tests__` reports zero executed
  tests. Rationale: the INV-REISSUE-SAME-ROW false-green (21B) was a flag left off. Loser: keep-and-force-ON
  (one env-var typo re-opens the hole silently, **D-3**).
- **L-5** Merge-gate policy is explicit and written down. `app-tests` **required immediately**; `db-tests`
  **required after three consecutive full green runs**, advisory-but-must-be-read until then. Policy lives
  here (§5) and in `CLAUDE.md`. Loser: require `db-tests` immediately (blocks all merges on a known-flaky
  stack, **D-4**).
- **L-9** **PROC-REVIEW-AT-COMMIT** (§6): Reviewers read every file at the stated commit range, never at
  HEAD. Reading at HEAD produced 21B's false-positive M1 (withdrawn by the 21C reviewer,
  `docs/reviews/session-21c-reviewer.md:84`). Written into `CLAUDE.md` and every future Reviewer primer.
- **L-10** Zero product scope. No new capability, no schema change beyond the ADR 0014 A-1 query predicate,
  no Stripe, no new route, no model change.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | OOM remedy | tune `config.toml` + shard if needed | bare-postgres container (no GoTrue → anon-key sign-in tests die); bigger paid runner (hides the bug) |
| D-2 | App-suite CI home | standalone `app-tests.yml` | job inside `db-tests.yml` (DB flake masks app signal) |
| D-3 | Integration flags | delete + skip-guard meta-test | keep-and-force-ON (one typo re-opens the false-green) |
| D-4 | Merge gates | `app-tests` required now; `db-tests` required after 3 consecutive greens | require `db-tests` immediately (blocks all merges on a known-flaky stack) |

*(L-6, L-7, L-8, D-5, D-6, D-7 and the W2 findings ledger are encoded in ADR 0014 Amendment A, not here.)*

---

## §1 — Problem (in evidence, not adjectives)

The project's own rule is stated in ADR 0014 §10: *"'Covered' = **executed green**, never 'authored'."*
Two failure classes currently violate it, each quoted from the 21B/21C reviewers.

### (a) AUTHORED-NOT-EXECUTED — a constraint has a test file, but no CI job runs it

The only workflow in the repo is `.github/workflows/db-tests.yml`, and its sole test command is scoped to
one directory (`.github/workflows/db-tests.yml:163`):

```
npx vitest run supabase/__tests__ --no-file-parallelism --retry=2
```

No job runs `vitest` over the app-layer suite. The 21C reviewer states it directly
(`docs/reviews/session-21c-reviewer.md:72`):

> "**No CI workflow executes them** — the sole workflow (`db-tests.yml`) runs `supabase/__tests__` only
> (same coverage-visibility gap flagged in the 21B review) … the redirect/UX constraints are echoes, and
> the real boundary is CI-covered."

The 21B reviewer's Section I confirms the same shape from the other side — the app-layer constraints are
*"Vitest unit-level"* run locally only (`docs/reviews/session-21b-reviewer.md:101`), and the 21C Process
note adds (`docs/reviews/session-21c-reviewer.md:86`):

> "the app-layer Vitest suite (including all of 21C's inbox tests) is **not wired into any CI job**."

**Concretely authored-not-executed today:** every 21B/21C app-layer constraint — `ROLE-TEAM-ADMIN-GATED`,
`ROLE-APPROVALS-GATED`, `RES-RESOLVER-*`, `RES-LOGIN-MEMBER-NO-LOCKOUT`, `UI-AFFORDANCE-MAP`,
`UI-APPROVE-DISABLED-EDITOR`, `SEAT-METER-COPY`, `SEAT-OVERAGE-CTA-DISTINCT`, and all `APV-*`
(ADR 0014 §10, rows tagged "component tests" / "`lib/**` tests"). Their test files exist and pass locally;
**no push ever runs them.**

### (b) FALSE-GREEN — a suite is wired to CI but silently skipped by an env flag

The precedent is INV-REISSUE-SAME-ROW (21B). The suite existed, was in `supabase/__tests__`, and evaluated
to zero executed tests because `REISSUE_INVITE_INTEGRATION_TEST_ENABLED` was never set in the workflow. The
21B reviewer's pre-review gate records the fix (`docs/reviews/session-21b-reviewer.md:6`):

> "the INV-REISSUE-SAME-ROW **false-green** was closed this session — `REISSUE_INVITE_INTEGRATION_TEST_ENABLED`
> added to `db-tests.yml`; `reissue-invite.test.ts` now **executes green against live Postgres**."

The mechanism survives: **eleven** `*_INTEGRATION_TEST_ENABLED` flags gate `supabase/__tests__`
(`db-tests.yml:134-144`), each read by its own file (e.g. `supabase/__tests__/reissue-invite.test.ts:6`,
`supabase/__tests__/posts-approval-boundary.test.ts:7`). Any one left off re-creates a green suite that
tested nothing — indistinguishable, in the Actions UI, from a suite that ran and passed.

### (c) EXECUTED-AND-PROVING-NOTHING — a suite runs green in CI but its assertion is not attached to the claim

The precedent is the Session 22-D re-review (`docs/reviews/session-22d-reviewer.md`). Two constraints each
had a test file, the file ran in CI, and the run was green — yet neither test could have failed if the
guarded behavior had never shipped:

- `posts-approval-boundary.test.ts` asserted that a hand-built Postgres query respected a `WHERE` clause the
  test itself constructed. It proved Postgres honours `WHERE`, not that `bulkApproveDraftPosts` emits that
  clause. Removing the guard from the real function would not turn this test red.
- `ApprovalsInbox.test.tsx`'s contrast assertions compared rendered output against a **hand-transcribed copy**
  of the CSS custom-property values, not the shipped `app/globals.css` tokens. Editing `globals.css` to a
  non-compliant color would not turn this test red either — only editing the test's transcription would.

Both were fixed the same way (22-D correction pass): call the real function under test and mutate a live
fixture so the assertion tracks the actual guard, or read the token from the shipped source file at test
time instead of a copy of it. This is the same family as the SHARED-FUNCTION CALLERS lesson (`CLAUDE.md`) —
a test verifying the wrong thing, one level down: there, the wrong *caller* was untested; here, the right
caller is tested but the wrong *thing about it* is asserted.

**The rule that closes it (CONS-ATTACHED):** covered = executed **and** attached to the claim. A boundary
test must call the real function/component under test and mutate a live fixture (the actual guard, the
actual source token) so the assertion **fails when the guard is removed** — not a hand-built substitute that
merely resembles it. If deleting the production guard and re-running the test suite doesn't turn it red,
the test is `EXECUTED-AND-PROVING-NOTHING`, regardless of how green it looks in CI.

**All three classes defeat the same rule.** "Covered" must mean *executed green on every push, and the green
outcome is caused by the guard under test.* A test that no job runs, a suite an env flag silently empties,
and a suite that exercises something merely adjacent to the claim, are the same lie told three ways.

---

## §2 — Test taxonomy + the execution contract

Every named constraint in every ADR maps to **exactly one** of three tiers. The tier dictates where the
constraint's proof must live and what "executed" means for it.

### Tier 1 — DB-behaviour (RLS policies, triggers, DEFINER RPCs)

**Home:** `supabase/__tests__/*`, executed against a **live Postgres** in the CI Supabase stack
(`db-tests.yml`). **Hard rule:** a mock Supabase client, or a read of `pg_policies` / `information_schema`
metadata, is **NOT** coverage for this tier. Only a real authenticated (anon-key) client hitting real RLS
and real triggers counts. This is the 21A lesson — a policy that *reads* correct in `pg_policies` can still
deny/allow the wrong rows at runtime. Examples: `RES-BIZ-SELECT-WIDEN`, `SEAT-INVITE-FAILFAST-ECHO`,
`APV-BULK-DB-BOUNDARY` (ADR 0014 A-1), the `enforce_post_transition_capability` boundary
(`supabase/migrations/20260702120300_posts_role_aware_and_status_trigger.sql:38-72`).

### Tier 2 — App-layer (Vitest: server guards, Server Actions, resolvers, components, i18n)

**Home:** `app/**`, `lib/**`, `components/**` `*.test.ts(x)`, executed by `vitest run` in `app-tests.yml`
(§3). **Hard rule:** **runs in CI on every push and PR.** Examples: `RES-RESOLVER-DETERMINISTIC`,
`ROLE-APPROVALS-GATED`, `SEAT-METER-COPY`, `APV-COUNT-CONSISTENT`, `APV-SERVER-FILTER`, `ROLE-TEAM-ECHO`.

### Tier 3 — Diff-verified design constraints (no test, by decision)

Some constraints are properties of *absence* — that a thing was **not** done — and have no runtime
assertion. **Hard rule:** each MUST be **enumerated as such in its owning ADR**, so "no test" is a recorded
decision, never an oversight. Examples: `RES-NO-MIDDLEWARE` (ADR 0014 §2.4 — proven by reading `proxy.ts`
does no business resolution), `SEAT-NO-STRIPE` / `APV-BULK-NO-NEW-DB-OBJECT` (proven by the diff containing
no `supabase/` or `.sql` change), `PROC-REVIEW-AT-COMMIT` (§6 — a process constraint).

### The binding rule (CONS-TIERED)

> Every named constraint in every ADR maps to exactly one tier. A Reviewer's coverage table MUST, for each
> constraint, state **(1) its tier and (2) the CI job that executes its test** (or, for Tier 3, the
> diff-fact that verifies it). A constraint whose "executing job" column is empty for a Tier-1 or Tier-2
> constraint is a defect of the same class this ADR exists to eliminate — it is `AUTHORED-NOT-EXECUTED`. A
> constraint whose test runs green but does not call the real function/component under test, or asserts
> against a hand-copied value instead of the shipped source, is `EXECUTED-AND-PROVING-NOTHING` (§1(c)) — the
> Reviewer must additionally confirm, for Tier-1 and Tier-2 constraints, that removing the production guard
> would turn the test red.

---

## §3 — CI topology (L-2, L-3)

The repo toolchain is **npm** (there is no pnpm lockfile; `db-tests.yml:37-40` runs `npm ci`, and
`actions/setup-node` caches `npm`). All contract blocks below use npm. **Grounding correction to the
brief's "node/pnpm" phrasing:** this repo has no pnpm; the contract uses `npm` to match the committed
`package-lock.json` and the existing `db-tests.yml` (Node 24 / npm 11, `db-tests.yml:32-40`).

### 3.1 `app-tests.yml` — NEW (Tier-2 home; independent of the DB stack)

Two supporting decisions, both grounded in `CLAUDE.md`:

1. **`tsc` must run with `--skipLibCheck`.** `CLAUDE.md` (`/ecc:verification-loop`): *"Always run
   `npx tsc --noEmit --skipLibCheck` (bare `--noEmit` reports ECC remotion skill errors unrelated to
   SOSH)."* The workflow uses the `--skipLibCheck` form.
2. **`vitest run` must be scoped to the SOSH suite, not the whole repo.** `CLAUDE.md`: *"Always run
   `npx vitest run lib/db lib/social lib/validation` (bare `npx vitest run` picks up ECC test files that
   call `process.exit()` and fail)."* Rather than hard-code a partial path list (which would silently drop
   `app/**` and `components/**` tests — the very suites 22 exists to switch on), this ADR fixes the scope
   **once, in `vitest.config.ts`**, via an explicit `include`, so a bare `vitest run` deterministically
   runs the whole SOSH suite and nothing from ECC/plugins. This is a config change, not an inline command.

**`vitest.config.ts` contract (CHANGED — add `include`; keep the existing `exclude`):**

```ts
// vitest.config.ts — scope a bare `vitest run` to SOSH tests only, so CI runs the FULL app suite
// (app + lib + components) WITHOUT picking up ECC/plugin test files that call process.exit()
// (CLAUDE.md /ecc:verification-loop note). The existing exclude of node_modules + lib/db/types.test.ts
// stays. This is the single source of truth for "the app suite" — app-tests.yml runs `vitest run` bare.
include: [
  'app/**/*.test.{ts,tsx}',
  'lib/**/*.test.ts',
  'components/**/*.test.{ts,tsx}',
],
exclude: ['**/node_modules/**', '**/lib/db/types.test.ts'],
```

**`package.json` scripts contract (NEW — single scripted entrypoint; no inline command drift, session-22 B1):**

```jsonc
"scripts": {
  // ... existing ...
  "typecheck": "tsc --noEmit --skipLibCheck",
  "test:app":  "vitest run",            // include-scoped by vitest.config.ts (§3.1)
  "test:db":   "vitest run supabase/__tests__ --no-file-parallelism --retry=2"
}
```

**`.github/workflows/app-tests.yml` contract (NEW):**

```yaml
name: App tests (tsc + eslint + vitest)

# Tier-2 (§2). Runs on EVERY push and PR. MUST NOT start the Supabase stack and MUST NOT depend on
# db-tests — the whole point (L-3 / D-2) is that DB flakiness never masks the app-layer signal.
on:
  push:
    branches: [master]
  pull_request:

jobs:
  app-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'          # matches db-tests.yml:32-34 + package-lock resolution
          cache: 'npm'
      - name: Install dependencies
        run: |
          npm install -g npm@11
          npm ci
      - name: Typecheck
        run: npm run typecheck        # tsc --noEmit --skipLibCheck
      - name: Lint
        run: npm run lint             # eslint (existing package.json script)
      - name: App-layer test suite
        run: npm run test:app         # vitest run, include-scoped to SOSH (§3.1)
```

No test-only secrets are required — the app suite mocks Supabase/Anthropic/Stripe/Resend at the module
boundary (it must, since it never boots the DB stack). Any test that needs a live service belongs in Tier-1
(`supabase/__tests__`), not here.

### 3.2 `db-tests.yml` — REVISED (Tier-1 home; the OOM remedy)

**Root cause on record (do not re-litigate).** The two confirmed OOM contributors are already disabled in
`supabase/config.toml`: **Realtime** (reconnect storm hammering Postgres during recovery,
`config.toml:81-93`) and **analytics/Logflare** (Cainophile logical-replication + Oban polling against a
crashing Postgres, `config.toml:394-407`). The remedy below removes the *remaining* headroom pressure and
makes any future crash legible.

**(a) Services to disable in `config.toml`** — the lever `config.toml` actually provides. Disable every
service the `supabase/__tests__` suites do not use. **Proof obligation on the Builder (B2):** before
flipping each `enabled = false`, `grep supabase/__tests__` for any usage of that service and record the
zero-hit result in the commit (the same discipline the realtime disable used, `config.toml:90-92`).

| Service | Current | Target | Why safe to disable |
|---|---|---|---|
| `[studio]` | `enabled=true` (`config.toml:100`) | **false** | UI console; suites make PostgREST/GoTrue calls, never Studio. |
| `[inbucket]` | `enabled=true` (`config.toml:111`) | **false** | Email capture UI; invite suites assert on the outbox row / RPC, not delivered mail. |
| `[storage]` | `enabled=true` (`config.toml:121`) | **false** *(iff grep-clean)* | Object storage; no `supabase/__tests__` storage usage expected — Builder confirms by grep. |
| `[edge_runtime]` | `enabled=true` (`config.toml:381`) | **false** | Deno edge functions; the suites call Postgres/PostgREST/GoTrue directly, no edge function under test. |
| `[realtime]` | `enabled=false` (`config.toml:93`) | keep false | Already disabled — OOM contributor. |
| `[analytics]` | `enabled=false` (`config.toml:407`) | keep false | Already disabled — OOM contributor. |
| `[api]` | `enabled=true` (`config.toml:8`) | keep **true** | PostgREST — the suites' data plane. Required. |
| `[db]` | (Postgres 17) | keep | The system under test. Required. |
| `[auth]` | `enabled=true` (`config.toml:162`) | keep **true** | GoTrue — the suites sign in with real anon-key clients (D-1). **Never disable.** |

**(b) Postgres runtime knobs — corrected home.** `config.toml`'s `[db]` block exposes only `port`,
`shadow_port`, `major_version`, and `[db.pooler]` (`config.toml:27-48`) — there is **no** `shared_buffers`
/ `work_mem` / `max_connections` field (grep of `config.toml` for these returns nothing). The brief's
"cap … in `config.toml`" is therefore not literally expressible; the knobs must be set where Postgres reads
them. **Decision:** a new CI step applies them via `ALTER SYSTEM` over `$DATABASE_URL` immediately after
`supabase start`, then **restarts the Postgres container without destroying its volume** so the restart-only
params take effect, then **verifies them** before `supabase db reset`.

> **Correction (F3, founder review, 2026-07-12) — supersedes the pre-correction §3.2b restart.** The earlier
> block restarted with `supabase stop --no-backup && supabase start`. `ALTER SYSTEM` writes
> `postgresql.auto.conf` **inside PGDATA**, and `supabase stop --no-backup` **deletes the volume** — so the
> restart-only knobs (`shared_buffers`, `max_connections`) would come back at **defaults** while the job
> reported green: the remedy silently no-ops. Corrected to a **volume-preserving container restart** plus a
> **mandatory verification step** (an unverified memory remedy is worse than none — it reports green while
> doing nothing).

```yaml
# db-tests.yml — NEW step, after "supabase start", before "supabase db reset".
# config.toml cannot hold Postgres memory knobs (it exposes only db.port/shadow_port/major_version/pooler,
# config.toml:27-48), so cap them here where Postgres actually reads them. One rationale per knob — a future
# editor must not raise these back without understanding the 2-core/7GB OOM they prevent.
- name: Cap Postgres memory for a 2-core / 7GB runner
  run: |
    set -euo pipefail
    psql "$DATABASE_URL" <<'SQL'
      -- max_connections: the suites run --no-file-parallelism (db-tests.yml:145) so real concurrency is
      -- low; each backend reserves work_mem per sort/hash node, so fewer allowed backends = a hard ceiling
      -- on the worst-case memory fan-out behind the recovery-mode crash (S427-S430). Restart-only param.
      ALTER SYSTEM SET max_connections = 50;
      -- shared_buffers: default is 128MB; on a 7GB runner shared with GoTrue+PostgREST+Docker, keeping this
      -- modest leaves headroom for the auth-heavy setup (admin.createUser/bcrypt) rather than the OS cache.
      -- Restart-only param.
      ALTER SYSTEM SET shared_buffers = '256MB';
      -- work_mem: per-sort/hash allocation. The RLS-matrix suites do many small scans, not big sorts, so a
      -- low cap prevents a pathological query from ballooning * max_connections. Reloadable.
      ALTER SYSTEM SET work_mem = '8MB';
      -- maintenance_work_mem: db reset re-applies all migrations (index builds); a modest bump keeps resets
      -- fast without competing with the connection pool at test time. Reloadable.
      ALTER SYSTEM SET maintenance_work_mem = '128MB';
    SQL
    # shared_buffers + max_connections are RESTART-only. Restart ONLY the Postgres CONTAINER so the volume
    # (and postgresql.auto.conf, written by ALTER SYSTEM inside PGDATA) SURVIVES. A `supabase stop
    # --no-backup` would DELETE the volume and silently revert the knobs to defaults (F3). `docker restart`
    # stops+starts the same container against the same volume — auto.conf persists and is re-read on boot.
    # Container name is supabase_db_<project_id>; project_id = "SOSH" (config.toml:5). Builder confirms the
    # exact name via `docker ps` (db-tests.yml:174 already enumerates the supabase_* containers).
    docker restart "supabase_db_SOSH"

# MANDATORY verification — the caps must actually be in effect, or the job FAILS and the Builder STOPS.
# An unverified remedy reports green while doing nothing (F3). No `|| true`, no continue-on-error here.
- name: Verify Postgres knobs took effect
  run: |
    set -euo pipefail
    # Re-derive the connection env after the restart (port is stable; DATABASE_URL from the export step).
    vals=$(psql "$DATABASE_URL" -tA -c "SHOW shared_buffers; SHOW max_connections; SHOW work_mem;")
    echo "post-restart knobs: $vals"
    echo "$vals" | grep -qx '256MB' || { echo "::error::shared_buffers did not stick (expected 256MB)"; exit 1; }
    echo "$vals" | grep -qx '50'    || { echo "::error::max_connections did not stick (expected 50)"; exit 1; }
    echo "$vals" | grep -qx '8MB'   || { echo "::error::work_mem did not stick (expected 8MB)"; exit 1; }
```

*(`supabase db reset` runs AFTER this verification. `db reset` re-applies migrations against the existing
volume — it does not recreate the container or wipe `postgresql.auto.conf`, so the verified knobs persist
through it. The Builder confirms the exact container name and, if `docker restart` is unavailable or the
CLI manages the container differently on the runner, uses the equivalent volume-preserving restart it finds
— never a `--no-backup` teardown. If the crash survives **verified** knobs, the trigger is the §3.2c shard
contract — NOT raising the caps back, NOT `continue-on-error`.)*

**(c) Shard contract — if a full run still OOMs.** Split `db-tests` into two jobs along a **read vs write**
seam. Each boots its **own** Supabase stack, halving the concurrent connection/memory pressure on any one
runner. The seam is stated so the split is deterministic, not ad-hoc:

- **`db-tests-read`** — the read/RLS-matrix suites: `get-user-business-ids-matrix`, `user-can-matrix`,
  `campaigns-social-accounts-role-policies`, `rls-matrix`, and the read assertions of `accept-invite-rpc`.
- **`db-tests-write`** — the write/trigger/RPC suites: `seat-cap-enforcement`, `reissue-invite`,
  `ensure-owner-membership`, `posts-approval-boundary` (incl. `APV-BULK-DB-BOUNDARY`, ADR 0014 A-1),
  `members`, `backfill-purge`, `deletion`.

**How a sharded run still proves the whole matrix:** the two jobs' file sets are a **partition** of
`supabase/__tests__` (every file is in exactly one shard; their union is the whole directory). Both jobs run
the §4 skip-guard over *their own* shard, so no file can go invisible in either half. The matrix is "green"
iff **both** shards are green; a red shard fails the check exactly as a red monolith would. The Builder must
assert the partition is total (a listing test: every file under `supabase/__tests__` appears in exactly one
shard's glob) so a newly-added suite can't fall between the two shards unnoticed.

**(d) Flag deletion (§4) and the diagnostic step (§3.3) apply to the single job or both shards identically.**

### 3.3 OOM diagnostic (CI-OOM-DIAGNOSTIC) — make the next crash legible

`db-tests.yml:165-179` already dumps `supabase status`, `docker ps -a`, `free -h`, `dmesg` OOM lines, and
per-container `docker inspect` (`OOMKilled`) + `docker logs --tail 200` on failure. **This ADR formalizes
it and adds persistence:** the failure block MUST also write those dumps to a file and upload them via
`actions/upload-artifact`, so a crash is diagnosable after the runner is gone instead of scrolled off the
live log. "Intermittently red" is not acceptable as a description; a failed run must leave evidence naming
*which* container OOMed and the host memory at the time.

```yaml
# db-tests.yml — augment the existing "on failure" block (db-tests.yml:165-179): tee the same dumps to a
# file and upload it, so the crash is legible post-hoc (CI-OOM-DIAGNOSTIC). Evidence, not vibes.
- name: Upload failure diagnostics
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: db-tests-oom-evidence
    path: /tmp/db-tests-diagnostics.log
    retention-days: 7
```

---

## §4 — Flag abolition + skip-guard (L-4)

**Delete every per-suite flag.** Remove all eleven `*_INTEGRATION_TEST_ENABLED` names
(`db-tests.yml:134-144`) from: the workflow env block, `lib/config.ts` (if referenced), any `.env`
example, and **every test file that reads one** (e.g. `supabase/__tests__/reissue-invite.test.ts:6`,
`.../posts-approval-boundary.test.ts:7`). After deletion, a DB suite's `describe`/`it` blocks run
**unconditionally** whenever the DB env (`DATABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` / keys) is present —
which in `db-tests.yml` it always is (`db-tests.yml:79-84`). The suite's only remaining condition is "is
the DB reachable", never "did someone remember a flag".

**The skip-guard meta-test (CI-NO-SKIPPED-SUITE + CI-NO-SWALLOWED-FAILURE).** A run in which **any** file
under `supabase/__tests__` executes **zero/all-skipped** tests **fails the job**, AND a run in which **any**
DB test genuinely fails **also fails the job**. Mechanism — reporter-driven, no swallowed exit codes:

> **Correction (F2, founder review, 2026-07-12) — supersedes the pre-correction §4.** The earlier contract
> ran `npm run test:db … || true` and then asserted only *emptiness*. The `|| true` swallowed vitest's exit
> code, so a genuinely **failing** DB test exited 0 and the job passed — the skip-guard itself shipped a
> false-green, in the ADR whose thesis is "covered = executed green, never authored". The `|| true` is
> removed; the guard now asserts **both** invariants and re-propagates failure.

```yaml
# db-tests.yml (or each shard) — run vitest with the JSON reporter AND let it surface its own exit code,
# then run the guard which fails on emptiness OR on any failed test. NO `|| true`, NO continue-on-error on
# any gate step (CI-NO-SWALLOWED-FAILURE). The JSON is written regardless of pass/fail because vitest emits
# --outputFile before exiting; the guard is the single authority that fails the job.
- name: DB suite (JSON-reportered)
  run: npm run test:db -- --reporter=json --outputFile=/tmp/db-results.json
- name: Skip-guard — fail if any suite is INVISIBLE or RED
  if: always()   # run even when the previous step already failed, so we always report WHY (empty vs red)
  run: node scripts/ci/assert-no-empty-suite.mjs /tmp/db-results.json
```

```jsonc
// scripts/ci/assert-no-empty-suite.mjs — contract (Builder writes it). Asserts BOTH invariants:
//   (i)  INVISIBILITY — for every testResult whose file is under supabase/__tests__:
//          assertionResults.length === 0                       → FAIL (ran nothing — the false-green shape)
//          assertionResults.every(a => a.status === 'skipped') → FAIL (all-skipped is invisible, not covered)
//        Also FAIL if the JSON lists zero test files at all under supabase/__tests__ (nothing matched glob).
//   (ii) FAILURE — if the JSON reports ANY failed test (numFailedTests > 0, or any assertionResult
//          status === 'failed') → FAIL, naming the failing file(s).
//   Exit non-zero if EITHER invariant is violated. Green requires: every file visible AND zero failures.
```

**Invariant (stated for the Reviewer), corrected: a suite may be RED — and then the job FAILS; it may never
be INVISIBLE.** The pre-correction wording ("a suite may be RED" without "and then the job fails") is what
invited the `|| true`; RED is *permitted to exist* only in the sense that the guard must *detect and report*
it, never pass it. The skip-guard must itself be demonstrated, not asserted (§5, §7): point it at a fixture
with zero tests, confirm the job fails; and confirm a deliberately-failing test also fails the job (not just
an empty one), then revert both.

**General rule (CI-NO-SWALLOWED-FAILURE).** No `|| true`, and no `continue-on-error: true`, on **any** step
that is part of a gate (`app-tests`, `db-tests`, the skip-guard, the knob verification §3.2b). A gate step
that cannot fail the job is not a gate. The only sanctioned non-failing directive is `if: always()` used to
*guarantee a reporting step still runs* after an earlier failure (as above) — it must never be paired with a
swallowed exit code.

**Correction (Session 22-D, MAJOR-1) — the skip-guard extends to `app-tests`, and four suites are opt-in
by decision, not by allowlist.** Session 22's B2 killed the eleven Tier-1 (DB) `*_INTEGRATION_TEST_ENABLED`
flags per this section, but `app-tests` — the job §5 marks **Required — now** — had no skip-guard of its own,
and four Tier-2 suites survived inside its glob, flag-gated and reporting **green while executing nothing**:
the exact false-green shape this ADR exists to eliminate, now inside the one job with no detector for it.

`scripts/ci/assert-no-empty-suite.mjs` is parameterized to accept target directories as CLI args (default
`['supabase/__tests__']`, preserving `db-tests.yml`'s original call unmodified); `app-tests.yml` now runs
`test:app` with `--reporter=json --outputFile` and calls the guard with `app lib components`. It also gained
a **whole-directory-disappeared** check (one of the target dirs matching zero files at all — the shape B2
found in `supabase/__tests__` before this ADR existed), generalized rather than re-derived per job.

An **allowlist** of sanctioned green-skips was considered and rejected: a maintained list of blessed
false-greens rots exactly the way the eleventh Tier-1 flag got left off B1's original sweep. The four suites
are instead made **ABSENT** from `app-tests`' glob — `vitest.config.ts`'s default project excludes
`**/__integration__/**`; `vitest.integration.config.ts` is a separate, developer-run-only project that
includes them. A bare `vitest run` / `npm run test:app` cannot see them; `npm run test:integration` (with the
suite's own env flag set) does. With the four absent, **no allowlist is needed** — nothing remaining inside
`app-tests` may be empty, full stop.

**Per §2 Tier-3 discipline, the four opt-in suites and why each is not executed on every push:**

| Suite | Why opt-in, not required | Fate |
|---|---|---|
| `lib/social/__integration__/postiz-provider.integration.test.ts` | Hits a real, running Postiz instance (OAuth exchange, live publish) — not reproducible in a stock `app-tests` runner. | **Kept, moved to opt-in.** `PostizProvider` is still the shipped `SocialProvider` implementation (`docs/current-phase.md` lists Postiz removal as a future, WIP, not-yet-executed workstream — see "Next up" / launch-checklist §16). Deleting the test would drop coverage-intent for code currently in production. It was already `.skipIf`'d and never executed inside `app-tests` before this change, so moving it doesn't reduce CI-executed coverage — it makes the pre-existing absence honest instead of reporting as a green skip. (Its bodies are `it.todo` placeholders — a separate, pre-existing authoring gap, not something this change introduces or resolves.) Re-evaluate for deletion once the Postiz removal workstream actually lands. |
| `lib/deletion/__integration__/purge-business.test.ts` | Exercises the real `purge_business` RPC against a live Postgres instance with real `auth.admin.createUser` calls — a DB-shaped Tier-1 concern that happens to live under `lib/`, not `app-tests`-compatible. | Opt-in. Run via `DELETION_INTEGRATION_TEST_ENABLED=true npm run test:integration -- lib/deletion`. |
| `lib/email/__integration__/round-trip.test.ts` | Sends a real email through live Resend — real network, real external side effect, would flake/spam on every push. | Opt-in. Run via `EMAIL_INTEGRATION_TEST_ENABLED=true npm run test:integration -- lib/email`. |
| `app/[locale]/(marketing)/__integration__/routes.smoke.test.ts` | Requires a running server (`npm run dev` or a prod serve) reachable over real HTTP — `app-tests` never boots the app. | Opt-in. Run via `ROUTE_SMOKE_TEST_ENABLED=true npm run test:integration -- "app/[locale]/(marketing)"` against a running server. |

Each suite's own `*_INTEGRATION_TEST_ENABLED`/`ROUTE_SMOKE_TEST_ENABLED` flag is **kept** — it still gates
whether the suite performs real network I/O when explicitly run. What changed is *discovery*: these flags no
longer need to protect `app-tests` from ever seeing the file, because the file isn't in `app-tests`' project
at all. This is a different mechanism from the Tier-1 flag abolition above (which deleted flags because the
DB suites run unconditionally in a job that always has a live DB) — these four suites have no such
"unconditionally reachable" environment inside `app-tests`, so unlike Tier-1, opt-in is the correct end state,
not an intermediate one.

---

## §5 — Merge gates (L-5) — "is this mergeable?" answered without reading the rest

| Check | Required? | What a RED means | Who can override |
|---|---|---|---|
| **`app-tests`** (tsc + eslint + vitest) | **Required — now** | The app-layer suite, types, or lint is broken. A real regression in Tier-2 behaviour or type safety. | Repo admin only, with a written reason in the PR. Never routine. |
| **`db-tests`** (Tier-1 live-Postgres) | **Required after 3 consecutive full green runs on `master`** (the promotion rule below). Advisory-**but-must-be-read** until then. | Either a DB-behaviour regression **or** a stack OOM. Until promoted, the reviewer must open the run and distinguish the two (the §3.3 evidence exists precisely for this). | Until promoted: tech lead reads the evidence and decides. After promotion: repo admin only, as `app-tests`. |
| **Skip-guard** (part of `db-tests`) | Required whenever `db-tests` runs | A `supabase/__tests__` file executed zero tests — a false-green (§4). | No override — a fix is mandatory (this is the whole point). |

**Promotion rule for `db-tests` (CI-DB-SUITE-STABLE).** `db-tests` flips from advisory to **required** the
moment it records **three consecutive full green runs on `master`** — where "full green" means the job (or
both shards) ran to completion with no OOM and the skip-guard passed. "Green until it crashed" does not
count. The three-green tally and the promotion date are recorded in `docs/current-phase.md`. Until then,
`db-tests` red does not block merge but **must be read** by the reviewer and dispositioned in the review as
OOM-vs-regression.

**This table is the merge policy of record.** It is duplicated in `CLAUDE.md` (session-22 B6) so it is
enforceable without opening this ADR.

**Enforcement (Session 22-D, GitHub ruleset `master-app-tests`, id `19038239`).** A repository ruleset
targeting `refs/heads/master` exists with `enforcement: active`, `bypass_actors: []`
(`current_user_can_bypass: "never"`), and one `required_status_checks` rule naming `app-tests`. Verified via
`gh api repos/tcr430/SOSH/rules/branches/master` (the rulesets-aware endpoint — the legacy
`branches/master/protection` endpoint 404s regardless, since it only reflects classic branch protection, not
rulesets, and is not evidence of anything here). `db-tests` is deliberately **absent** from this ruleset,
matching the not-yet-promoted state in the table above — adding it is a future ruleset update, not a new
ruleset, once the three-green tally (`docs/current-phase.md`) completes.

---

## §6 — PROC-REVIEW-AT-COMMIT (L-9)

**Constraint.** A Reviewer reads every file **at the stated commit range**, never at HEAD.

**Commands (the only sanctioned way to read code under review):**

```bash
git diff <base>..<head>            # the change under review, as a whole
git show <sha>:<path>              # any single file AS IT WAS at <sha> — never the working tree
git log --oneline <base>..<head>   # the commit boundaries (B3 behaviour vs B5 visual must be distinct)
```

**Motivating incident (why this is a hard constraint, not advice).** In Session 21B a Reviewer read
`components/layout/DashboardShell.tsx` **at HEAD** — which already contained 21C's live `/approvals`
`<Link>` — and raised a MAJOR (M1: "a live link that 404s on 21B-alone"). At the actual 21B commit the entry
was inert, so the finding was false. The 21C reviewer withdrew it explicitly
(`docs/reviews/session-21c-reviewer.md:84`):

> "the 21B report's **M1** … was **incorrect** — it was derived from reading `DashboardShell.tsx` at HEAD,
> which already contained 21C … **21B M1 is withdrawn.**"

**Reporting requirement.** Every Reviewer report MUST **open by naming the exact commit range it read** and
stating that every citation is from that range (e.g. *"Scope reviewed: `c07dafda..9acc0133`; all file:line
citations are `git show <sha>:<path>` at that range, never HEAD."*). A report that does not name its range
is not a valid review. This is written into `CLAUDE.md` and into the Reviewer primer of every future
session doc.

---

## §7 — Named constraints (the Reviewer's acceptance checklist)

Greppable. Each maps to its §2 tier and states how it is proven.

| Constraint | Tier (§2) | Proven by |
|---|---|---|
| **CI-APP-SUITE-EXECUTED** | Tier-2 | `app-tests.yml` runs `npm run test:app` (`vitest run`, include-scoped §3.1) on every push/PR; the Actions run shows the SOSH `app/**` + `lib/**` + `components/**` tests executing. Reviewer compares the workflow's command to the local suite — any test the workflow does not reach is a MAJOR. |
| **CI-DB-SUITE-STABLE** | Tier-1 / process | `db-tests` records three consecutive full green runs (no OOM, skip-guard passed) on `master`; promotion date in `docs/current-phase.md`. "Green until it crashed" fails this. |
| **CI-NO-SKIPPED-SUITE** | process (meta) | The skip-guard (§4) fails the job when a `supabase/__tests__` file runs zero/all-skipped tests — **demonstrated once** against a zero-test fixture, then reverted. |
| **CI-NO-SWALLOWED-FAILURE** | process | No `\|\| true` and no `continue-on-error: true` on any gate step (§4); the skip-guard fails the job on any RED test, not just an empty one — demonstrated once against a deliberately-failing test, then reverted. `if: always()` is allowed only to guarantee a reporting step runs, never paired with a swallowed exit code. |
| **CI-KNOBS-VERIFIED** | process | The §3.2b verification step `SHOW shared_buffers/max_connections/work_mem` reflects the caps after the volume-preserving restart; a mismatch fails the job and the Builder STOPS. Proves the OOM remedy is real, not theatre. |
| **CI-NO-SUITE-FLAGS** | process | `grep -r '_INTEGRATION_TEST_ENABLED'` across workflows, `lib/config.ts`, `.env*`, and `supabase/__tests__` returns **zero** hits. A surviving flag is a MAJOR (the false-green mechanism). |
| **CI-MERGE-GATE** | process | Branch-protection makes `app-tests` a required check now; the §5 policy is duplicated in `CLAUDE.md`; `db-tests` promotion follows the three-green rule. |
| **CI-OOM-DIAGNOSTIC** | process | A failed `db-tests` run uploads the `db-tests-oom-evidence` artifact (§3.3) naming the OOMed container + host memory. A crash with no evidence fails this constraint. |
| **PROC-REVIEW-AT-COMMIT** | Tier-3 (process) | Every Reviewer report opens by naming its commit range and cites via `git show <sha>:<path>`; `CLAUDE.md` carries the rule. Verified by reading the report's opening line and spot-checking a citation against the range. |

---

## §8 — File manifest (design-level; NEW / CHANGED)

**NEW**
- `.github/workflows/app-tests.yml` — Tier-2 CI home (§3.1).
- `scripts/ci/assert-no-empty-suite.mjs` — the skip-guard meta-test (§4).

**CHANGED**
- `.github/workflows/db-tests.yml` — service-disable already lives in `config.toml`; here: add the
  Postgres-knob step (§3.2b), the JSON-reportered run + skip-guard step (§4), the artifact-upload
  diagnostic (§3.3); **delete** the eleven `*_INTEGRATION_TEST_ENABLED` env lines (`:134-144`); shard into
  two jobs **iff** the tune step does not hold (§3.2c).
- `supabase/config.toml` — disable `[studio]`, `[inbucket]`, `[storage]` *(grep-clean)*, `[edge_runtime]`
  (§3.2a), each with a one-line WHY comment matching the existing realtime/analytics precedent
  (`config.toml:81-93`, `:394-407`).
- `vitest.config.ts` — add the `include` that scopes a bare `vitest run` to the SOSH suite (§3.1).
- `package.json` — add `typecheck`, `test:app`, `test:db` scripts (§3.1).
- `supabase/__tests__/*` — remove the `const … = process.env.*_INTEGRATION_TEST_ENABLED` guards and the
  conditional `describe`/skip they drive (§4), so each suite runs unconditionally on a live DB.
- `CLAUDE.md` — the §5 merge-gate table, PROC-REVIEW-AT-COMMIT (§6), and the "covered = executed" rule +
  the §2 three-tier taxonomy pointer (session-22 B6).
- `docs/current-phase.md` — record the CI topology change and the `db-tests` three-green tally.

**Note — no `config.toml` working-tree surprise:** `config.toml` currently carries one uncommitted diff
(`enable_confirmations = false → true`, `[auth.email]`) unrelated to this ADR; the Builder must not
clobber it while editing the service-disable lines.

**Approved L-10 deviations (session-22 manifest addendum, Session 22-D MINOR-4).** L-10 commits the Session
22 range to zero product scope beyond the ADR 0014 A-1 query predicate. One migration landed inside the range
regardless:

| Migration | Commit | Why it's a deviation | Why it's approved |
|---|---|---|---|
| `supabase/migrations/20260715200000_user_can_grant_anon.sql` | B7 (`fe6da7e1`) | Adds an `EXECUTE` grant on `user_can()` to `anon` — a schema/grant change, which L-10 says the range should not contain. | Both `database-reviewer` and `security-reviewer` independently cleared it: `user_can()` returns `false` at `auth.uid() IS NULL` before touching any table (`20260702120200_user_can.sql:15-17`), so the anon `GRANT` creates no oracle and no side effect. It is a genuine CI-correctness fix (RLS policies calling `user_can()` were failing for anon-context checks without it), not scope creep. Recorded here so the deviation is *documented*, not merely discovered by a future reader diffing the migrations folder against L-10's promise. |

---

## §9 — Explicitly NOT in scope (each a decision, per §2 Tier-3 discipline)

- **No e2e / Playwright layer.** Rationale: the failure classes (§1) are *unit/integration tests that
  don't run*, not *missing browser coverage*. A browser tier is a different investment; adding it here
  would dilute the one thesis this session must prove. Deferred to a future ADR if a flow-level regression
  ever escapes Tier-1 + Tier-2.
- **No coverage-percentage gate.** Rationale: a % gate rewards line-hitting, not the *executed-vs-authored*
  distinction this ADR is about; a suite can be 90%-covered and still `AUTHORED-NOT-EXECUTED` in CI. The
  gate we need is "every named constraint maps to an executing job" (§2 CONS-TIERED), which %-coverage does
  not express.
- **No new runner spend.** Rationale: D-1 rejected a paid larger runner (it hides the bug). The remedy is
  tune-then-shard on the free `ubuntu-latest` 2-core; if that genuinely cannot hold the suite, the escape
  hatch is to **amend this ADR** (session-22 §4), not to buy a green light.

---

_End ADR 0015._
