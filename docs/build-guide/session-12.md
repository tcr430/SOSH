# Session 12 — Metrics Worker

> **Goal:** The post-performance analytics worker. A second Vercel Cron job, on its own schedule, finds *published* posts whose metrics are stale (or never synced), calls `provider.fetchPostMetrics()` through the SocialProvider abstraction, and upserts the result into `post_metrics` in place. This is the read-side mirror of the publishing worker: it never mutates `posts`, never publishes, never calls `/lib/ai/`. When it lands, every published post accrues a `likes / comments / shares / impressions / …` row that the dashboard (a later session) reads. Deferred from Session 10 per ADR 0005 §17.
> **Time:** 3–4 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction (Sonnet 4.6)
> **Plugins:** ECC throughout, claude-mem automatic. No frontend-design skill this session — there is no UI surface (the analytics dashboard is its own future session; this session only fills the table it will read).
> **Session structure:** Three separate Claude Code sessions with `/exit` between each, plus an expected correction pass (Session 12D).

---

## Why this is still a three-mind session (despite looking small)

On the surface the metrics worker is "the publishing worker, but read-only" — and structurally that's true. The cron auth, the SECURITY DEFINER claim/select pattern, the orchestrator-tick shape, the `vercel.json` registration, the service-role lazy import: all of it is a near-copy of ADR 0005. If that were the whole story this would be a single Builder session.

It isn't, because of one fact that the publishing worker never had to confront:

**`PostizProvider.fetchPostMetrics` throws `NOT_IMPLEMENTED` in Phase 1** (ADR 0002 §6, §"Out of scope"; confirmed against `/lib/social/postiz-provider.ts`). The only implementation that returns real numbers is `MockProvider`. A naïve worker that treats `fetchPostMetrics` like `publish` will mark every real LinkedIn/X post as a *failure* the moment it ships to production with `SOCIAL_PROVIDER_MODE=postiz`.

So the architecturally-significant question this session exists to answer is: **how does a production worker behave when the capability it depends on is a stub that throws?** The answer is not "fail the row" and not "silently swallow everything." It's a deliberate, ADR-pinned `NOT_IMPLEMENTED` → *skip-without-penalty* path, distinct from the `TOKEN_REVOKED`/`NETWORK`/etc. error matrix, plus a clean switch so that the day a native provider (or a Postiz adapter) implements metrics, the worker starts doing real work with **zero worker changes**. Getting that boundary wrong means either a flood of false "failed" states or a worker that hides genuine errors. That's a reversal-class decision, and reversal-class decisions get an ADR and a reviewer.

Three sessions, mandatory pause after Architect. New ADR: **0006 — Metrics Worker**.

---

## What this session builds and what it doesn't

**Builds:**
- ADR 0006 — Metrics Worker architecture (Architect output, no code)
- Migration (timestamp-based) — a SECURITY DEFINER `select_posts_for_metrics_sync(p_now, p_stale_before, p_limit)` RPC that returns published posts due for a metrics sync (join `posts` → `post_metrics`, left-join so never-synced posts are included). No new columns on `posts`; no new columns on `post_metrics` (the table from ADR 0001 §6 already has every column).
- `/lib/db/post-metrics.ts` additions — `selectPostsForMetricsSync` (RPC wrapper) and `upsertPostMetrics` (the `ON CONFLICT (post_id) DO UPDATE` writer). Confirm whether `upsertPostMetrics` already exists from Session 2D and extend rather than duplicate.
- `/lib/metrics/orchestrator.ts` — `runMetricsTick`: select due posts → for each, `getRegistry().fetchPostMetrics(...)` → map → upsert; handle the `NOT_IMPLEMENTED` skip path and the real error matrix; accumulate a `MetricsTickSummary`.
- `/app/api/cron/metrics/route.ts` — second Vercel Cron entry point (GET handler, **reuses `CRON_SECRET`**, same dev-bypass header rules as the publish route).
- `vercel.json` — add a **second** cron entry alongside the existing publish cron.
- Config additions in `/lib/config.ts` — `METRICS_BATCH_SIZE`, `METRICS_STALE_MINUTES`, `METRICS_MAX_AGE_DAYS` (stop syncing posts older than N days — analytics ages out), reuse `CRON_SECRET`.
- Tests against `MockProvider` for every branch, including the `NOT_IMPLEMENTED` skip path.

**Defers:**
- Any UI / dashboard. The analytics dashboard that reads `post_metrics` is a separate future session. This session leaves the table populated and verifiable via SQL only.
- `post_metrics_history` (time-series snapshots). ADR 0001 §6 is explicit: Phase 1 is upsert-in-place. Trend charts are a future ADR.
- Native per-platform metrics providers. Postiz `fetchPostMetrics` stays a `NOT_IMPLEMENTED` stub; this session is built to *tolerate* that, not to fix it. Re-implementing `PostizProvider.fetchPostMetrics` is its own follow-up.
- Engagement ingestion (`fetchEngagement` → `engagement_inbox`). Different worker, different table, Phase 3.
- Rate-limit-aware metric polling budgets per platform. FIFO-by-staleness is fine at Phase 1 volume.
- Backfill of posts published before this worker existed — they'll be picked up naturally on the first tick because their `post_metrics` row is absent (left-join makes never-synced posts due immediately).

---

## Pre-session checklist

- [ ] Session 11 fully complete — Session 11 corrections applied, full SOSH suite green
- [ ] Session 10 publishing worker is live or smoke-tested — you need at least one row in `posts` with `status='published'` and a non-null `platform_post_id` for the metrics worker to have anything to select. If you have none, publish one via the dev trigger first (or seed a `published` row with a `platform_post_id` and a linked active `social_account`).
- [ ] `CRON_SECRET` already set in all three Vercel environments (established Session 10) — this session reuses it, no new secret
- [ ] Decide the provider mode for the smoke test: `SOCIAL_PROVIDER_MODE=mock` returns real (zeroed) metrics and exercises the upsert path; `postiz` exercises the `NOT_IMPLEMENTED` skip path. **You will want to test both** — they're the two halves of this session.
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/db lib/social lib/publishing` passes
- [ ] `claude-mem` running at http://localhost:37777
- [ ] You re-skimmed ADR 0005 §4 (claim RPC), §10 (orchestrator API), §12 (cron route contract) — this session mirrors all three. ADR 0006 should *reference* them rather than restate them.

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Opus 4.7**
3. Paste Primer
4. List planned decisions, wait for approval
5. Paste Architect Prompt
6. **Type one confirmation line and `/exit`** — the Architect's last action

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.

Read /docs/decisions/0005-publishing-worker.md IN FULL — this is
your template. The metrics worker is the read-side mirror of the
publishing worker. Reuse its patterns by reference; do not restate
its content in ADR 0006.

Read /docs/decisions/0001-database-schema.md §6 (post_metrics
table — note: every metric column is nullable, null means "platform
does not expose this metric", 0 is a real value; UNIQUE on post_id;
last_synced_at index; upsert-in-place, NO history table in Phase 1).

Read /docs/decisions/0002-social-provider.md §3 (error taxonomy),
the "Metrics shapes" section (FetchMetricsInput, PostMetrics — every
field nullable + fetchedAt ISO string), §6 / "Out of scope"
(fetchPostMetrics is a NOT_IMPLEMENTED stub in PostizProvider),
and the MockProvider synthetic-response table (fetchPostMetrics
returns all-zero metrics).

Skim /lib/social/index.ts, /lib/social/types.ts,
/lib/social/postiz-provider.ts (confirm fetchPostMetrics throws),
/lib/social/mock-provider.ts (confirm it returns zeros),
/lib/social/errors.ts (the SocialProviderError codes).
Skim /lib/db/post-metrics.ts (note whether upsertPostMetrics
already exists from Session 2D), /lib/db/posts.ts,
/lib/supabase/service.ts, /lib/config.ts.
Skim /app/api/cron/publish/route.ts and
/lib/publishing/orchestrator.ts (your structural templates).
Skim vercel.json (you are ADDING a second cron, not replacing).

Session 12 Part A — Metrics Worker Architecture. Architect role.

ARCHITECT BOUNDARY (strict, learned from Sessions 2, 3, 10):
- Your only output is /docs/decisions/0006-metrics-worker.md
- No SQL files. No TypeScript files. No vercel.json edits. No env
  changes. No code beyond TypeScript signatures inside the markdown.
- Your last action is a single confirmation line. Then I /exit.
- Do not attempt to "kick off" the Builder.

Use the architect ECC agent mindset:
1. List your key design decisions and any ambiguities
2. Wait for me to approve / override / clarify
3. Only then write the document
4. Call out explicitly the ONE decision that makes this its own ADR
   rather than a footnote to 0005: how the worker handles
   fetchPostMetrics throwing NOT_IMPLEMENTED in production. Frame it
   as a first-class outcome class, not an error.

Acknowledge, list your planned decisions, wait for my approval.
```

### Decision list — confirm these before approving

The Architect surfaces its own list. These are the points you must see addressed and the answers you should expect. Push back before paste-approving if the Architect proposes something materially different.

| # | Question | Expected answer |
|---|---|---|
| 1 | Cron cadence | **Not** every minute — metrics don't move that fast and platform rate limits punish over-polling. `*/15 * * * *` (every 15 min) on Pro, `0 * * * *` (hourly) on Hobby. Configurable via `vercel.json`. |
| 2 | Selection atomicity | Metrics sync is **idempotent and read-mostly** — there is no "claim" in the publishing sense (no status flip, no double-publish risk). Use a SECURITY DEFINER `select_posts_for_metrics_sync` RPC that **selects** (no `FOR UPDATE SKIP LOCKED` needed; a duplicate sync just re-upserts the same numbers). `REVOKE ALL FROM public; GRANT EXECUTE TO service_role`. |
| 3 | Due-row predicate | `posts.status = 'published'` AND `posts.platform_post_id IS NOT NULL` AND `posts.deleted_at IS NULL` AND platform in the metrics-capable allow-list AND (`post_metrics.last_synced_at IS NULL` **OR** `post_metrics.last_synced_at < p_stale_before`) AND `posts.published_at > now() - METRICS_MAX_AGE_DAYS`. Left-join `post_metrics` so never-synced posts are due immediately. `ORDER BY post_metrics.last_synced_at NULLS FIRST` (freshest-starved first). |
| 4 | Per-tick budget | `METRICS_BATCH_SIZE = 50` env-driven default (read-only calls are cheaper than publishes; a larger batch is fine). |
| 5 | Function maxDuration | `60` (Pro) / `30` (Hobby), same as publish route. |
| 6 | The NOT_IMPLEMENTED outcome (**the reason this is its own ADR**) | A `NOT_IMPLEMENTED` thrown by `fetchPostMetrics` is **`skipped`, not `failed`**. The worker does **not** write a `post_metrics` row, does **not** touch `last_synced_at` (so the post stays "due" and re-tries for free when the capability lands), and increments `summary.skippedNotImplemented`. This is the expected steady-state in Phase 1 with Postiz. Surface as the ADR's headline decision. |
| 7 | Real error matrix | `TOKEN_EXPIRED` → in-tick refresh + retry once (same `Set<string>` loop-guard pattern as ADR 0005 §6); on second `TOKEN_EXPIRED` → count as `failed`, no penalty column to write (there is none on `post_metrics`), record under `summary.failed`. `TOKEN_REVOKED` / `NETWORK` / `RATE_LIMITED` / `UNKNOWN` → **skip this tick, do not write `last_synced_at`** (so it's retried next tick), count under `summary.failed` (or `summary.deferred` for `RATE_LIMITED`). No backoff columns, no terminal state — metrics are best-effort and a missed sync self-heals next tick. |
| 8 | `null` vs `0` fidelity | The mapper writes platform-absent metrics as `NULL`, not `0`. `PostMetrics.likes === null` → column stays `NULL`; `=== 0` → column is `0`. This is the ADR 0001 §6 / ADR 0002 metrics-shapes invariant. A reviewer check pins it. |
| 9 | Upsert semantics | `INSERT … ON CONFLICT (post_id) DO UPDATE SET <metrics>, last_synced_at = now(), updated_at = now()`. `business_id` taken from the `posts` row (denormalised per ADR 0001 §"Denormalisation"), not trusted from any client. Single statement, atomic. |
| 10 | Metrics-capable platform allow-list | At launch the list is **empty in practice** because Postiz throws `NOT_IMPLEMENTED` for all platforms — but the predicate filter should mirror the publishing allow-list (`linkedin`, `twitter`) so that the day a provider implements metrics, the worker is already scoped correctly. Document that the allow-list is a *claim-side* filter and the `NOT_IMPLEMENTED` skip is the *provider-side* reality; both exist on purpose (defence in depth). |
| 11 | Module location | `/lib/metrics/orchestrator.ts` (exports `runMetricsTick`). No `/lib/workers/` directory (consistent with `/lib/publishing/`). |
| 12 | Cron route | `/app/api/cron/metrics/route.ts`. Reuses `CRON_SECRET` (no new secret), same `crypto.timingSafeEqual` + length pre-check + dev-bypass-header rules as the publish route. Same "always 200, errors in body" contract. |
| 13 | Service-role pattern | Worker uses service-role via lazy import (CLAUDE.md authorises "the metrics worker" explicitly). RLS bypassed because it's not a user request; the select RPC's own predicate keeps it scoped to published posts only. |
| 14 | Observability | One structured `console.log(JSON.stringify({ kind: 'metrics_tick', ...summary }))` per tick — the single authorised `console.*` per the publishing-worker precedent. No per-post logging. No token material in the line. |
| 15 | Reversal check | Confirm there are **no reversals** of prior ADRs. (Unlike ADR 0005, the metrics worker mutates only `post_metrics` and respects every existing invariant. If the Architect finds itself wanting to reverse something — e.g. making `post_metrics.last_synced_at` mean something new — that's a flag to stop and raise it explicitly.) |

### Architect Prompt (after you approve the decision list)

> **Note:** Paste only after confirming the Architect's plan against the table above. This prompt locks the answers in as decisions, not options.

```
Approved to write /docs/decisions/0006-metrics-worker.md.

Your plan is accepted with the following locked answers. Do not
re-open any of these in the ADR — write them as decisions.

HEADLINE DECISION (the reason 0006 exists, put it at the very top):
NOT_IMPLEMENTED is an OUTCOME CLASS, not an error.
  - fetchPostMetrics throwing NOT_IMPLEMENTED → the row is SKIPPED.
  - Do NOT write a post_metrics row.
  - Do NOT update last_synced_at (the post must stay "due" so it
    self-heals for free the day a provider implements metrics).
  - Increment summary.skippedNotImplemented.
  - This is the EXPECTED steady state in Phase 1 with PostizProvider.
    A production tick where every post is skippedNotImplemented is a
    HEALTHY tick, not a degraded one. Say this in the ADR in plain
    words so a future reader doesn't "fix" it.

NO "CLAIM", JUST "SELECT". Metrics sync is idempotent: a duplicate
sync re-upserts identical numbers. No status flip, no double-write
hazard, so NO FOR UPDATE SKIP LOCKED. The RPC is a plain
SECURITY DEFINER SELECT with REVOKE ALL FROM public /
GRANT EXECUTE TO service_role. Contrast this explicitly with
ADR 0005 §4's claim (which needed locking because publishing is
not idempotent). One sentence of contrast is enough.

DUE PREDICATE (ADR 0006 §"Selection query"):
  status='published'
  AND platform_post_id IS NOT NULL
  AND deleted_at IS NULL
  AND platform IN ('linkedin','twitter')   -- mirrors publish allow-list
  AND published_at > p_now - (METRICS_MAX_AGE_DAYS * INTERVAL '1 day')
  AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p_stale_before)
  LEFT JOIN post_metrics pm ON pm.post_id = posts.id
  ORDER BY pm.last_synced_at NULLS FIRST, posts.published_at ASC
  LIMIT p_limit

NULL vs ZERO IS LOAD-BEARING. The mapper writes
PostMetrics.likes === null  -> column NULL
PostMetrics.likes === 0     -> column 0
Never coalesce null to 0. ADR 0001 §6 + ADR 0002 metrics-shapes.
Pin a reviewer check and a test on this.

UPSERT is INSERT ... ON CONFLICT (post_id) DO UPDATE, single atomic
statement, last_synced_at = now(), updated_at = now(),
business_id sourced from the posts row (denormalised), never trusted
from elsewhere.

ERROR MATRIX (metrics are best-effort; nothing is terminal):
  NOT_IMPLEMENTED -> skip, no last_synced_at write, summary.skippedNotImplemented++
  TOKEN_EXPIRED   -> in-tick refresh + retry ONCE (per-tick Set<string>
                     loop guard, same as ADR 0005 §6); refresh does not
                     count as failure; second TOKEN_EXPIRED -> summary.failed++,
                     no last_synced_at write (retried next tick)
  RATE_LIMITED    -> skip this tick, no last_synced_at write,
                     summary.deferred++ (retried next tick; metrics polling
                     is not time-critical so we don't honour retryAfter
                     precisely — next tick is soon enough)
  TOKEN_REVOKED / NETWORK / BAD_REQUEST / NOT_CONFIGURED / UNKNOWN
                  -> skip this tick, no last_synced_at write, summary.failed++
  In EVERY non-success outcome, NO post_metrics row is written and
  last_synced_at is left untouched, so the row is naturally retried.
  There is no attempts counter and no terminal failed state — a post
  that can never be synced simply ages out via METRICS_MAX_AGE_DAYS.

CRON: /app/api/cron/metrics/route.ts. Reuse CRON_SECRET (no new
secret). Same auth contract as /app/api/cron/publish (timingSafeEqual
+ length pre-check + dev-bypass header honoured only when
NODE_ENV !== 'production'). Always 200; internal exception caught,
logged, returned in the body with metrics: null.

VERCEL.JSON: ADD a second crons entry. Do not remove or modify the
publish entry. Pro: { "path": "/api/cron/metrics", "schedule": "*/15 * * * *" }.
Document the Hobby fallback ("0 * * * *", maxDuration = 30) as a
one-line note, same style as ADR 0005 §13.

CONFIG: METRICS_BATCH_SIZE (default 50), METRICS_STALE_MINUTES
(default 360 = re-sync a post's metrics at most every 6 hours),
METRICS_MAX_AGE_DAYS (default 90 = stop syncing posts older than
90 days). All optional with defaults; no new required env var.

MODULE: /lib/metrics/orchestrator.ts exporting runMetricsTick.
DB helpers go in /lib/db/post-metrics.ts. Confirm in the ADR whether
upsertPostMetrics already exists from Session 2D; if so, the Builder
extends/verifies it rather than creating a duplicate.

────────────────────────────────────────────────────────────

The ADR must contain, in this order:

1. HEADLINE DECISION — NOT_IMPLEMENTED is an outcome class (skip,
   not fail; healthy steady state in Phase 1). Prominent, at the top.
2. RELATIONSHIP TO ADR 0005 — one short section: what is mirrored
   (cron auth, route contract, orchestrator shape, service-role
   pattern, summary-line observability) and what is DIFFERENT
   (select not claim; no locking; no status mutation; no retry
   columns; no terminal state; read-side only). Reference 0005 by
   section number; do not restate it.
3. CONTRACT BOUNDARIES — the worker MAY NOT: write or mutate `posts`
   (any column); call /lib/ai/; touch vault directly; use the anon
   client; write any table other than post_metrics.
4. SELECTION QUERY — the SECURITY DEFINER select RPC, full SQL,
   with the grant/revoke.
5. OUTCOME MATRIX — the table above, every SocialProviderErrorCode
   mapped to {success, skipped, deferred, failed} and "writes
   last_synced_at? y/n" (only success writes it).
6. METRIC MAPPING — PostMetrics -> post_metrics columns, the
   null-vs-zero rule stated explicitly.
7. TOKEN_EXPIRED refresh+retry — reference ADR 0005 §6, note the one
   difference (no publish_attempts to leave unincremented; there is
   simply no counter).
8. SCHEMA CHANGES — "RPC only; no table or column changes." State
   that post_metrics from ADR 0001 §6 is already complete and the
   (last_synced_at) index already covers the selection ORDER BY.
9. ORCHESTRATOR API — runMetricsTick signature + MetricsTickSummary
   interface (TypeScript signatures only).
10. /lib/db/post-metrics.ts ADDITIONS — selectPostsForMetricsSync,
    upsertPostMetrics signatures.
11. CRON ROUTE CONTRACT — reference ADR 0005 §12; state only the
    deltas (path, cadence, summary shape).
12. VERCEL.JSON CONTRACT — the additive second entry.
13. CONFIGURATION — the three new optional vars.
14. TESTING STRATEGY — MockProvider matrix incl. the
    NOT_IMPLEMENTED skip path, null-vs-zero fidelity, refresh+retry,
    re-sync staleness window, MAX_AGE_DAYS exclusion, never-synced
    (left-join) inclusion, route auth (incl. dev-bypass-in-prod 401).
15. ACCEPTED TECH DEBT — best-effort sync (a permanently failing
    post ages out, never alerts); no per-platform rate budget; no
    retryAfter honoured precisely on RATE_LIMITED.
16. OUT OF SCOPE — dashboard UI; post_metrics_history; native
    metrics providers; engagement ingestion; backfill tooling.
17. OPEN FOLLOW-UPS — implement PostizProvider.fetchPostMetrics
    (the day this lands, the worker starts producing real data with
    zero worker changes — call this out as the payoff); a
    summary.failed alerting threshold once a logger exists; a
    post_metrics_history table when trend charts are needed.

Confirm with one line, then /exit.
```

---

## Part B — Builder Session (Sonnet 4.6)

> Wait for Claude.ai to confirm the ADR before starting.

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0006-metrics-worker.md.

The ADR is your single source of truth. It overrides anything in
this primer or earlier discussion.

Read /docs/decisions/0005-publishing-worker.md §4 (claim RPC shape
— yours is a SELECT, not a claiming UPDATE; copy the SECURITY
DEFINER + grant/revoke structure, drop the FOR UPDATE SKIP LOCKED),
§10 (orchestrator API shape), §12 (cron route contract — yours
reuses CRON_SECRET and is near-identical).
Read /docs/decisions/0001-database-schema.md §6 (post_metrics:
nullable metrics, UNIQUE post_id, last_synced_at index).
Read /docs/decisions/0002-social-provider.md §3 (error taxonomy),
the metrics-shapes section (PostMetrics, every field nullable),
and confirm PostizProvider.fetchPostMetrics throws NOT_IMPLEMENTED.

Read /lib/social/index.ts (the ONLY public surface — CLAUDE.md
no-deep-imports rule), /lib/social/types.ts, /lib/social/errors.ts,
/lib/social/mock-provider.ts (your test double — note it returns
all-zero metrics), /lib/social/platforms/config.ts.
Read /lib/db/post-metrics.ts (CONFIRM whether upsertPostMetrics
already exists from Session 2D — extend, do not duplicate),
/lib/db/posts.ts, /lib/db/types.ts.
Read /lib/supabase/service.ts (createServiceRoleClient + serverOnly
guard), /lib/config.ts.
Read /app/api/cron/publish/route.ts and
/lib/publishing/orchestrator.ts as your structural templates.
Read vercel.json — you are ADDING a second crons entry, leaving the
publish entry untouched.

Skim /supabase/migrations/ — confirm the next available timestamp
prefix (Session 10 added the publishing-worker migration; increment
from the latest).

Session 12 Part B — Metrics Worker Implementation. Builder role.

ECC workflow (prefix /everything-claude-code: not /ecc:):
- /everything-claude-code:plan before each prompt
- /everything-claude-code:tdd for all TypeScript
- /everything-claude-code:verify after each prompt — do not proceed
  if it fails

Patterns from CLAUDE.md to follow strictly:
- /lib/social/index.ts is the ONLY import surface for social code.
  No import of postiz-provider or mock-provider from /lib/metrics/ —
  only getRegistry() and SocialProviderError from /lib/social/index.ts.
- Service-role via lazy import (await import('@/lib/supabase/service')).
- /lib/db/ only — never direct Supabase in workers or routes.
- formatISO from date-fns for ALL timestamp writes.
- No process.env outside /lib/config.ts.
- No console.* except the single structured summary line per tick
  (the ADR authorises exactly one).
- No `any` — use `unknown` and narrow.
- NULL vs 0 in metric columns is load-bearing — never coalesce a
  null PostMetrics field to 0 (ADR 0006 §"Metric mapping").

Confirm:
1. You've read ADR 0006 in full.
2. The list of files you'll create/modify.
3. The migration timestamp you'll use.
4. Whether upsertPostMetrics already exists (extend vs create).
5. That the worker reaches the provider ONLY via getRegistry(), and
   that a NOT_IMPLEMENTED throw is a SKIP (no row written, no
   last_synced_at update), not a failure.

Wait for Prompt 1.
```

### Prompt B1 — Migration (select RPC, no columns)

```
/everything-claude-code:plan "Apply ADR 0006 §"Schema changes": metrics-sync select RPC"

ADR 0006 is the source of truth. Read its Selection Query section
before writing SQL.

NO table changes. NO column changes. post_metrics (ADR 0001 §6) is
already complete and the (last_synced_at) index already exists.
This migration adds ONE SECURITY DEFINER function and its grants.

  CREATE OR REPLACE FUNCTION public.select_posts_for_metrics_sync(
    p_now          timestamptz,
    p_stale_before timestamptz,
    p_limit        int
  )
  RETURNS SETOF public.posts
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT p.*
      FROM public.posts AS p
      LEFT JOIN public.post_metrics AS pm ON pm.post_id = p.id
     WHERE p.status = 'published'
       AND p.platform_post_id IS NOT NULL
       AND p.deleted_at IS NULL
       AND p.platform IN ('linkedin', 'twitter')
       AND p.published_at > p_now - INTERVAL '90 days'  -- see note
       AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p_stale_before)
     ORDER BY pm.last_synced_at ASC NULLS FIRST, p.published_at ASC
     LIMIT p_limit;
  $$;

  REVOKE ALL ON FUNCTION public.select_posts_for_metrics_sync(timestamptz, timestamptz, int) FROM public;
  GRANT EXECUTE ON FUNCTION public.select_posts_for_metrics_sync(timestamptz, timestamptz, int) TO service_role;

NOTE on the 90-day literal: ADR 0006 §Configuration sets
METRICS_MAX_AGE_DAYS default 90. The cutoff is applied in SQL here.
If the ADR specifies passing max-age as a parameter instead of a
literal, follow the ADR — add a p_max_age_days int param and compute
the interval as (p_max_age_days * INTERVAL '1 day'). Match the ADR
exactly; if the ADR is silent, parameterize it (cleaner than a magic
literal). Re-read the ADR and pick the parameterized form unless it
says otherwise.

This is a plain SELECT, NOT a claim — no FOR UPDATE SKIP LOCKED, no
UPDATE. Metrics sync is idempotent (re-syncing re-upserts identical
numbers), so no locking is needed. This is the deliberate contrast
with ADR 0005 §4. Add a one-line SQL comment saying so.

Create the migration file with a timestamp-based name (read
/supabase/migrations/ for the latest prefix, increment by one second).

Run: npm run db:migrate

No /lib/db/types.ts changes are required for posts (no new columns).
Confirm PostMetricsRow / PostMetricsInsert types already exist from
Session 2D; if PostMetricsInsert is missing any of the nullable
metric fields, fix it.

/everything-claude-code:verify
```

### Prompt B2 — /lib/db/post-metrics.ts additions

```
/everything-claude-code:tdd "Metrics worker DB helpers"

ADR 0006 §"/lib/db/post-metrics.ts additions" is the contract.
First CONFIRM what already exists in /lib/db/post-metrics.ts from
Session 2D. Extend; do not duplicate.

1. selectPostsForMetricsSync(
     client: ServiceRoleClient,
     opts: { now: Date; staleBefore: Date; limit: number; maxAgeDays?: number }
   ): Promise<PostRow[]>

   Wraps client.rpc('select_posts_for_metrics_sync', { ... }) with
   formatISO-serialized timestamps. Returns published posts due for
   a metrics sync. Read-only; no mutation.

2. upsertPostMetrics(
     client: ServiceRoleClient,
     payload: {
       postId: string
       businessId: string
       metrics: {
         likes: number | null
         comments: number | null
         shares: number | null
         saves: number | null
         clicks: number | null
         reach: number | null
         impressions: number | null
       }
       syncedAt: Date
     }
   ): Promise<PostMetricsRow>

   Single atomic INSERT ... ON CONFLICT (post_id) DO UPDATE.
   Sets every metric column from payload.metrics VERBATIM — a null
   stays null, a 0 stays 0. NEVER coalesce null -> 0 (ADR 0006).
   Sets last_synced_at = syncedAt, updated_at = now().
   business_id comes from payload (sourced by the orchestrator from
   the posts row), never inferred.
   If it already exists from Session 2D, verify it honours the
   null-vs-zero rule and the ON CONFLICT target is (post_id); fix if not.

Both are service-role helpers. Per CLAUDE.md, the orchestrator does
the lazy import once and passes `client` down; these take `client`
as a parameter.

Tests (MockProvider not needed here — these are pure DB helpers):
- upsert inserts a fresh row, then upsert again updates it in place
  (one row, last_synced_at advanced).
- null metric fields persist as NULL; 0 fields persist as 0
  (round-trip read asserts the distinction).
- selectPostsForMetricsSync excludes non-published, soft-deleted,
  null-platform_post_id, and over-age posts; includes never-synced
  (no post_metrics row) posts.

/everything-claude-code:verify
```

### Prompt B3 — /lib/metrics/orchestrator.ts

```
/everything-claude-code:tdd "Metrics worker orchestrator"

ADR 0006 §"Orchestrator API" and §"Outcome matrix" are the contract.

Create /lib/metrics/orchestrator.ts exporting:

  export interface MetricsTickSummary {
    tick: string                  // ISO at tick start
    durationMs: number
    selected: number              // rows returned by the select RPC
    synced: number                // post_metrics rows upserted (success)
    skippedNotImplemented: number // provider threw NOT_IMPLEMENTED
    deferred: number              // RATE_LIMITED — retried next tick
    failed: number                // any other error — retried next tick
    refreshed: number             // distinct socialAccountIds refreshed
  }

  export function runMetricsTick(opts?: {
    now?: Date
    batchSize?: number
  }): Promise<MetricsTickSummary>

Behaviour:
- Lazy-import the service-role client ONCE at the top; pass it down.
- staleBefore = now - METRICS_STALE_MINUTES.
- selected = selectPostsForMetricsSync(client, { now, staleBefore,
    limit: batchSize ?? config.server.METRICS_BATCH_SIZE,
    maxAgeDays: config.server.METRICS_MAX_AGE_DAYS }).
- For each post, a local syncOne(post) that:
  - resolves provider via getRegistry() (NEVER import a provider
    directly),
  - calls provider.fetchPostMetrics({ socialAccountId, platformPostId }),
    where socialAccountId comes from the post's linked social account
    and platformPostId = post.platform_post_id,
  - on a PostMetrics result: upsertPostMetrics(client, {... mapped ...,
    businessId: post.business_id, syncedAt: now }); summary.synced++.
    Map every field verbatim — null stays null, 0 stays 0.
  - on a null return from fetchPostMetrics (ADR 0002: "platform has
    not yet exposed metrics for this post"): treat as
    skippedNotImplemented-equivalent — do NOT write a row, do NOT
    update last_synced_at; increment summary.skippedNotImplemented.
    (Distinguish in a comment from the thrown NOT_IMPLEMENTED case;
    both skip, both leave the row due.)
- Error handling via the ADR outcome matrix:
  - catch SocialProviderError; switch on err.code:
    - NOT_IMPLEMENTED -> summary.skippedNotImplemented++, no write.
    - TOKEN_EXPIRED -> if socialAccountId not in refreshedThisTick:
        await provider.refreshAccessToken({ socialAccountId }),
        add to the Set, retry fetchPostMetrics ONCE same tick.
        Success -> upsert + summary.synced++ (+ summary.refreshed is
        the Set size at tick end). Second TOKEN_EXPIRED or loop-guard
        hit -> summary.failed++, no write.
    - RATE_LIMITED -> summary.deferred++, no write.
    - TOKEN_REVOKED / NETWORK / BAD_REQUEST / NOT_CONFIGURED / UNKNOWN
        -> summary.failed++, no write.
  - In EVERY non-success outcome: no post_metrics row, no
    last_synced_at touch. The row is naturally retried next tick.
    There is NO attempts counter and NO terminal state.
- One structured line at the end:
  console.log(JSON.stringify({ kind: 'metrics_tick', ...summary })).
  No per-post logging. No token material.

Import surface for /lib/metrics/: ONLY @/lib/social (getRegistry,
SocialProviderError), @/lib/db/post-metrics, @/lib/db/posts (if you
need the social-account join helper — prefer adding/using a
/lib/db function over a raw query), @/lib/supabase/service (lazy),
@/lib/config, date-fns.

Tests with MockProvider + FailureConfig — one per outcome:
- success: mock returns {likes:5, comments:0, shares:null, ...};
  assert one upserted row, likes=5, comments=0, shares=NULL (the
  null-vs-zero round trip), summary.synced===1.
- NOT_IMPLEMENTED: mock throws NOT_IMPLEMENTED; assert NO row written,
  last_synced_at untouched, summary.skippedNotImplemented===1, and
  the SAME post is returned by a second selectPostsForMetricsSync
  (proves it stayed due).
- TOKEN_EXPIRED -> refresh -> success: assert summary.refreshed===1,
  summary.synced===1, one upsert.
- TOKEN_EXPIRED -> refresh -> TOKEN_EXPIRED: assert summary.failed===1,
  no row, refreshed===1.
- TOKEN_EXPIRED refresh-loop guard: two posts, same socialAccountId,
  both throw TOKEN_EXPIRED first call; refreshed===1 (not 2).
- RATE_LIMITED: summary.deferred===1, no row.
- NETWORK / TOKEN_REVOKED / UNKNOWN: summary.failed++, no row.
- batch limit honoured (selected <= batchSize).

/everything-claude-code:verify
```

### Prompt B4 — Cron route + vercel.json + config

```
/everything-claude-code:plan "Metrics cron route, vercel.json entry, config"

ADR 0006 §"Cron route contract" and §"vercel.json contract".
Mirror /app/api/cron/publish/route.ts closely.

1. /app/api/cron/metrics/route.ts — GET handler:
   - export const maxDuration = 60  (30 on Hobby — match the publish
     route's value).
   - Auth: reuse CRON_SECRET. Bearer compare via crypto.timingSafeEqual
     AFTER a Buffer-length pre-check. Single generic 401 body for every
     auth-fail path (missing / wrong / wrong-length) — no information leak.
   - Dev bypass: X-Cron-Dev-Trigger: true honoured ONLY when
     config.public.NODE_ENV !== 'production'. Production ignores it.
   - now = single new Date() at the top.
   - Call runMetricsTick({ now }). Wrap in try/catch.
   - Always return 200. On success: { tick, metrics: <summary> }.
     On internal throw: catch, log, return 200 with
     { tick, metrics: null, error: <message> } (Vercel must not retry).
   - No process.env reads (config only). No CRON_SECRET in any log.

2. vercel.json — ADD a second crons entry; DO NOT touch the publish one:
   {
     "crons": [
       { "path": "/api/cron/publish",  "schedule": "* * * * *" },
       { "path": "/api/cron/metrics",  "schedule": "*/15 * * * *" }
     ]
   }
   Add a one-line README/comment note for the Hobby fallback:
   metrics "0 * * * *" + maxDuration 30 (same style as ADR 0005 §13).

3. /lib/config.ts — add to the server schema (all optional, defaults):
   METRICS_BATCH_SIZE      default 50
   METRICS_STALE_MINUTES   default 360   (6h re-sync window)
   METRICS_MAX_AGE_DAYS    default 90
   No new required env var. CRON_SECRET is reused (already present).

Route handler tests (mirror the publish route's auth tests):
- Missing Authorization -> 401, generic body.
- Wrong secret -> 401, identical body (timingSafeEqual reached).
- Wrong-length secret -> 401 via the length pre-check (timingSafeEqual
  not invoked).
- Dev bypass header, NODE_ENV !== production -> 200, runMetricsTick ran.
- Dev bypass header, NODE_ENV === production -> 401 (header ignored).
- runMetricsTick throws -> 200 with metrics: null and an error field.

/everything-claude-code:verify
```

### After Part B

```
git add .
git commit -m "Session 12B: Metrics worker implementation"
git push
```

`/exit` Claude Code. **Confirm with Claude.ai before starting the Reviewer.**

---

## Part C — Reviewer Session (Opus 4.7)

### How to run

1. Fresh `claude` session
2. `/model` → **Claude Opus 4.7**
3. Paste the Reviewer Prompt
4. Paste the full report back here

### Reviewer Prompt

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0006-metrics-worker.md,
/docs/decisions/0005-publishing-worker.md §4 §12 (the templates),
/docs/decisions/0001-database-schema.md §6,
/docs/decisions/0002-social-provider.md §3 + metrics-shapes.

Run typescript-reviewer and security-reviewer in parallel over the
Session 12B diff. Audit against these checks.

SECTION A — CRON AUTHENTICATION (mirror of the publish route)
A1. Authorization compared with crypto.timingSafeEqual (not === /
    .startsWith)?
A2. Buffer-length pre-check before timingSafeEqual?
A3. Production REJECTS X-Cron-Dev-Trigger entirely (only honoured
    when NODE_ENV !== 'production')?
A4. CRON_SECRET reused (no second secret invented), read via
    config.server only — never process.env outside /lib/config.ts?
A5. 401 body identical for missing / wrong / wrong-length — no leak?

SECTION B — IDEMPOTENCY & THE "SELECT NOT CLAIM" DECISION
B1. The RPC is a plain SECURITY DEFINER SELECT with no
    FOR UPDATE SKIP LOCKED and no UPDATE? (Metrics sync is
    idempotent; locking would be wrong here — confirm the ADR's
    contrast with 0005 §4 is honoured.)
B2. REVOKE ALL FROM public + GRANT EXECUTE TO service_role on the RPC?
B3. upsertPostMetrics is a single atomic INSERT ... ON CONFLICT
    (post_id) DO UPDATE — no read-modify-write?
B4. A duplicate/concurrent tick re-upserting the same post produces
    one row with identical numbers (no dup rows, no error)? UNIQUE
    on post_id enforced?
B5. last_synced_at is written ONLY on the success path? Every
    non-success outcome (skip / defer / fail / refresh-fail) leaves
    last_synced_at untouched so the row stays due?

SECTION C — THE NOT_IMPLEMENTED OUTCOME (the headline decision)
C1. A thrown NOT_IMPLEMENTED increments summary.skippedNotImplemented
    and writes NOTHING (no post_metrics row, no last_synced_at)?
C2. A null return from fetchPostMetrics is handled the same way
    (skip, no write) and is distinguished in a comment from the
    thrown case?
C3. Is it unmistakable in the code/comments that an all-skipped tick
    is HEALTHY in Phase 1 (Postiz stub), not an error condition?
    (A future maintainer must not "fix" the skip into a failure.)
C4. The worker reaches fetchPostMetrics ONLY via getRegistry() — no
    direct import of postiz-provider / mock-provider in /lib/metrics/?

SECTION D — ERROR MATRIX FIDELITY
D1. All 8 SocialProviderErrorCode values have an explicit branch?
    Exact strings match the type imported from /lib/social/index.ts.
D2. TOKEN_EXPIRED -> one refresh per socialAccountId per tick (a
    per-tick Set<string> loop guard), retry ONCE, no requeue?
D3. RATE_LIMITED -> summary.deferred (not failed), no write?
D4. TOKEN_REVOKED / NETWORK / BAD_REQUEST / NOT_CONFIGURED / UNKNOWN
    -> summary.failed, no write, no terminal state (retried next tick)?
D5. There is NO attempts counter and NO terminal failed state on
    metrics rows (a permanently-failing post ages out via
    METRICS_MAX_AGE_DAYS — confirm that's the only stop condition)?

SECTION E — NULL vs ZERO FIDELITY (load-bearing)
E1. The mapper writes PostMetrics.x === null as NULL and === 0 as 0,
    NEVER coalescing null -> 0 (no `?? 0`, no `|| 0` on metric fields)?
E2. A test round-trips a mixed payload (some null, some 0, some >0)
    and asserts the DB preserves the distinction?
E3. PostMetricsInsert / PostMetricsRow types allow number | null on
    every metric column?

SECTION F — DATA INTEGRITY & TENANCY
F1. business_id on the upsert is sourced from the posts row, never
    trusted from a client or inferred? (Denormalised per ADR 0001.)
F2. The select RPC predicate excludes non-published, soft-deleted,
    null-platform_post_id, non-allow-list-platform, and over-age posts?
F3. Never-synced posts (no post_metrics row, left-join) ARE included
    and selected first (NULLS FIRST)?
F4. No raw token material can reach the structured log line (only
    summary counts)?
F5. The worker mutates ONLY post_metrics — it never writes any column
    of posts, campaigns, or anything else? (grep the diff.)

SECTION G — IMPORT SURFACE & ABSTRACTION
G1. /lib/metrics/ imports only from @/lib/social (index),
    @/lib/db/*, @/lib/supabase/service (lazy), @/lib/config, date-fns?
G2. No deep import of @/lib/social/postiz-provider,
    /mock-provider, /vault, /errors anywhere outside /lib/social/?
G3. The cron route is the only non-test caller of runMetricsTick?

SECTION H — TESTS
H1. Dedicated MockProvider+FailureConfig test per outcome
    (success / NOT_IMPLEMENTED / RATE_LIMITED / TOKEN_EXPIRED-refresh-
    success / TOKEN_EXPIRED-refresh-fail / refresh-loop-guard /
    NETWORK / TOKEN_REVOKED / UNKNOWN)?
H2. NOT_IMPLEMENTED test asserts the post stays DUE (re-selected on a
    second call)?
H3. Staleness window test (a freshly-synced post within
    METRICS_STALE_MINUTES is NOT re-selected)?
H4. MAX_AGE_DAYS exclusion test (an old published post is not selected)?
H5. Route auth suite incl. dev-bypass-in-production -> 401?

SECTION I — CONVENTIONS
I1. formatISO for every timestamp write?
I2. No process.env outside /lib/config.ts?
I3. Exactly one console.* (the structured summary), nowhere else?
I4. No `any`?
I5. vercel.json keeps BOTH cron entries (publish untouched)?

Final Verdict section listing:
- Blockers before Session 13
- Blockers before the first production metrics tick
- Tech debt acceptable to defer to a future ADR
```

### After Part C

```
git add .
git commit -m "Session 12C: Metrics worker review complete"
git push
```

`/exit` Claude Code. **Paste the full report to Claude.ai.** Severity is evaluated and a Session 12D correction prompt follows if there are any ❌.

---

## Part D — Correction Pass (only if reviewer finds blockers)

> Skip if the reviewer reports zero ❌ and only minor ⚠️.

Fresh Sonnet 4.6 session. Fix every ❌. Do not change anything marked ✅ or deferred as ⚠️.

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0006-metrics-worker.md.
Read the Session 12C reviewer report (below).
Fix all ❌ blockers. List what you'll change before touching a file.

[paste reviewer report here]

Fix only the listed ❌ items. After each fix run:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/db lib/social lib/metrics app

Report: which fixes applied, final tsc + vitest status.
```

```
git add .
git commit -m "Session 12D: Corrections applied, Session 12 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 12 complete.

ADR decisions confirmed:
- Cron cadence: [*/15 * * * * or 0 * * * *]
- METRICS_BATCH_SIZE / STALE_MINUTES / MAX_AGE_DAYS: [values]
- Migration number: [next prefix]
- upsertPostMetrics: [pre-existing from 2D / newly created]
- max-age applied as: [SQL literal / RPC parameter]

Live smoke test — MOCK mode (SOCIAL_PROVIDER_MODE=mock):
- Published posts eligible before tick: [N]
- /api/cron/metrics dev trigger response: [paste metrics summary]
- post_metrics rows after: [N] (assertion: matches summary.synced)
- null-vs-zero spot check: [paste one row — confirm a null column
  stayed NULL and a 0 column stayed 0]
- Second tick within STALE_MINUTES: selected===0? [yes/no]

Live smoke test — POSTIZ mode (SOCIAL_PROVIDER_MODE=postiz):
- /api/cron/metrics dev trigger response: [paste summary]
- Expected: summary.skippedNotImplemented === selected,
  summary.synced === 0, NO post_metrics rows written,
  last_synced_at on those posts unchanged.
- Actual: [paste] — confirm an all-skipped tick is reported as
  HEALTHY (no errors, no failed count).

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- vercel inspect shows BOTH crons (publish + metrics): [yes/no]
- CRON_SECRET still present in all envs (reused, not duplicated): [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 12

**Postiz mode will look "broken" and isn't.** The first time you run the metrics cron with `SOCIAL_PROVIDER_MODE=postiz`, every selected post comes back `skippedNotImplemented` and zero rows are written. That is the designed, healthy Phase 1 behaviour — `PostizProvider.fetchPostMetrics` throws `NOT_IMPLEMENTED` on purpose (ADR 0002). Run the mock-mode smoke test to see real upserts. Don't "fix" the skip into a write.

**Nothing to sync because nothing is published.** The select RPC requires `status='published'` AND a non-null `platform_post_id`. On a fresh dev DB with no completed publish cycle, `selected` is 0 and the tick is a valid no-op. Publish one post first (Session 10 dev trigger) or seed a `published` row with a `platform_post_id` and a linked active `social_account`.

**`null` coalesced to `0` is the silent data bug of this session.** A `likes ?? 0` or `|| 0` anywhere in the mapper destroys the "platform doesn't expose this metric" signal that the future dashboard depends on (ADR 0001 §6 says the UI must distinguish missing from zero). It will pass a casual eye and a careless test. The reviewer's Section E and a mixed-payload round-trip test exist specifically to catch it.

**Two crons, one secret.** This session adds a second `vercel.json` entry and a second route, but reuses `CRON_SECRET`. Don't invent `METRICS_CRON_SECRET`. If you accidentally leave only one entry in `vercel.json` (overwriting instead of appending), the publish cron silently stops — verify `vercel inspect` shows **both** after deploy.

**Don't reach for a claim/lock.** The publishing worker's `FOR UPDATE SKIP LOCKED` is muscle memory by now, but it's wrong here: metrics sync is idempotent (re-syncing writes the same numbers), so two overlapping ticks just upsert twice harmlessly. Adding locking adds contention for no benefit. ADR 0006 calls this out; if the Builder copies the publish claim verbatim, push back.

**`last_synced_at` is the only thing that makes a post "not due."** Because there's no status flip and no attempts counter, the *sole* mechanism keeping a post out of the next select is a fresh `last_synced_at` inside the staleness window. That's exactly why every non-success path must leave it untouched (so failures self-heal) and only success writes it. Get this backwards and either failures never retry or successes re-sync every tick.

**Architect tries to build.** If it happens, stop immediately: `Stop. Architect role only. Confirm and exit.`, then `/exit` and start a fresh Builder. Any `.ts`/`.sql` the Architect produced must be deleted before the Builder runs.

---

## What this unlocks

After Session 12:
- Every published post accrues a `post_metrics` row on a schedule, upserted in place — the data layer the analytics dashboard (a future session) will read is now being populated.
- The CRON_SECRET + cron-route + orchestrator pattern is proven a **second** time, on a read-side worker, confirming it generalises beyond publishing — the engagement worker (Phase 3) now has two precedents.
- The "capability stub that throws" pattern has a clean, ADR-pinned answer (`NOT_IMPLEMENTED` → skip-without-penalty), so the day `PostizProvider.fetchPostMetrics` (or a native provider) is implemented, the metrics worker starts producing real numbers with **zero worker changes** — that's the payoff and it's the single open follow-up worth tracking.
- Phase 1 MVP's worker surface is complete: publish (write-side) and metrics (read-side) both live. What remains for Phase 1 is the analytics dashboard UI, email notifications, and final pre-launch hardening — none of which are architecturally novel.

The next session opens with `post_metrics` rows quietly accumulating and a clear path to the customer-facing analytics view.
