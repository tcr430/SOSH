# ADR 0005 — Publishing Worker

**Status:** Accepted
**Date:** 2026-05-24
**Supersedes/Amends:** ADR 0001 §B.5 (status machine annotation), ADR 0004 §15 (generation-session janitor — now co-located here)
**Related:** ADR 0001 (schema), ADR 0002 (SocialProvider), ADR 0004 (post-generation)

---

## Reversals (read first)

Three deviations from prior ADRs are introduced here. Future sessions must treat the new positions as canonical and must not re-open them without an amending ADR.

### REVERSAL 1 — Retry-tracking columns over `ai_generation_metadata` jsonb

Session 8 (post-generation) established the convention of storing per-row operational metadata inside the `ai_generation_metadata` jsonb column. This ADR reverses that convention for publish-retry state.

The columns added in §9 (`publish_attempts`, `last_publish_attempt_at`, `last_publish_error`) are first-class because every one of them must be:
- atomically incrementable / mutable under `FOR UPDATE SKIP LOCKED`,
- queryable from indexes (the reaper queries on `last_publish_attempt_at`; future ops dashboards query on `publish_attempts`),
- visible to the human reviewer who opens a `failed` row in the UI without parsing jsonb.

Long-form sanitised platform error text (stack-ish detail, Postiz response body excerpt) still goes into `ai_generation_metadata.publish_error` as a free-form payload. The discriminator and counter live in real columns.

### REVERSAL 2 — `failed` is terminal

ADR 0001 §B.5's status-machine diagram contains the annotation `failed → scheduled (re-queue back to scheduled)`. That annotation was speculative. The source of truth is `lib/db/posts.ts` — `VALID_TRANSITIONS` does **not** include `failed → scheduled`, and this ADR makes that the canonical position.

`failed` is terminal for the worker. Any retry of a failed post is a user-triggered Phase 2 feature ("Retry from failed"); it is listed in Open Follow-ups, not implemented now. All worker-internal retries happen **before** the row reaches `failed` (the row sits in `scheduled` or is bounced back to `approved`).

### REVERSAL 3 — `posts.scheduled_at` is mutable

Prior ADRs treated `scheduled_at` as set-once at approval time. This ADR makes `scheduled_at` mutable by the worker on `RATE_LIMITED` and `NETWORK` retries (the row is requeued to `approved` with a future `scheduled_at` computed from backoff + jitter, or from the platform-provided `retryAfterSeconds`).

Future sessions, UI surfaces, and audit log designs must not assume `scheduled_at` is immutable.

---

## 1. Context & goal

The publishing worker is the first SOSH writer that drives `posts` rows from `approved` through `scheduled` to `published`/`failed`. It runs on Vercel Cron, finds approved posts whose `scheduled_at <= now()`, and calls `SocialProvider.publish(...)` via `getRegistry()` from `/lib/social`. It is also the first piece of SOSH outside test code that exercises the full token-refresh + vault-read + error-taxonomy paths laid out in ADR 0002 §3, §5, §8.

The same cron tick also runs the deferred generation-session janitor specified in ADR 0004 §15 — one cron route, two phases. Co-locating the janitor avoids a second Vercel cron schedule for a workload that runs at the same cadence and shares no other concerns with publishing.

---

## 2. Contract boundaries

**Surface (one direction only):**

```
Vercel Cron ─► GET /app/api/cron/publish/route.ts
                  │  (auth gate, header parsing, response shaping)
                  ▼
              orchestrator (runJanitorTick → reapStuckScheduledPosts → runPublishTick)
                  │
                  ├─► /lib/db/posts.ts          (claim, mark, requeue, reap — all service-role)
                  ├─► /lib/db/post-generation-sessions.ts  (janitor)
                  └─► /lib/social (getRegistry → provider.publish, provider.refreshAccessToken)
                          │
                          └─► PostizProvider (Phase 1) — vault read, HTTP, error mapping
```

**The worker MAY NOT:**
- write or transform post `content` / `hashtags` (no content mutation under any code path),
- import from `/lib/ai/` (no AI calls on the publish path),
- touch `vault.*` directly (vault reads happen exclusively inside `/lib/social/`),
- use the anon Supabase client (worker is service-role throughout; per CLAUDE.md "Three client roles").

The cron route handler may not contain orchestration logic — it is auth + Phase A call + Phase B call + response. All real work lives in the orchestrator functions exposed from a new module (see §10 for the orchestrator API).

---

## 3. Status machine

Worker-visible edges only. Pre-worker edges (`draft → approved` etc.) are unchanged from ADR 0001 §B.5.

```
                       ┌────────────────────────────────────────────────────────────┐
                       │                                                            │
                       │                                       reaper                │
                       │                       (last_publish_attempt_at stale,      │
                       │                        publish_attempts < MAX)             │
                       │                                                            │
                       ▼                                                            │
                 ┌───────────┐    claim (worker, atomic UPDATE)              ┌──────────────┐
   approved ───► │ approved  │ ───────────────────────────────────────────► │  scheduled   │
                 │ (queued)  │                                              │  (claimed)   │
                 └───────────┘ ◄──────────────┐ ◄────────────────────────── └──────────────┘
                       ▲                       │                                    │
                       │                       │                                    │
                       │           ┌───────────┴───────────┐                        │
                       │           │                       │                        │
                       │     requeue (RATE_LIMITED)   requeue (NETWORK,             │
                       │     worker; scheduled_at      attempts++ < MAX)            │
                       │     bumped verbatim by         worker; scheduled_at        │
                       │     retryAfterSeconds;         bumped by backoff+jitter    │
                       │     attempts NOT incremented                               │
                       │                                                            │
                       │                                                            ▼
                       │                                                    ┌──────────────┐
                       │                                                    │  published   │
                       │                                                    │ (terminal)   │
                       │                                                    └──────────────┘
                       │                                                            │
                       │                              publish OK                    │
                       │                              (or refresh+retry OK,         │
                       │                               attempts unchanged)          │
                       │                                                            │
                       │                                                            ▼
                       │                                                    ┌──────────────┐
                       │                                                    │   failed     │
                       │                                                    │ (terminal —  │
                       │                                                    │  REVERSAL 2) │
                       │                                                    └──────────────┘
                       │                                                       ▲       ▲
                       │                                                       │       │
                       │                                                       │       │
                       │           ┌───────────────────────────────────────────┘       │
                       │           │   TOKEN_REVOKED / PLATFORM_REJECTED /             │
                       │           │   UNKNOWN / attempts == MAX on NETWORK            │
                       │           │   refresh_failed / refresh_loop                   │
                       │           │   (worker; terminal)                              │
                       │           └───────────────────────────────────────────────────┘
```

**Edge catalogue (actor, trigger, side-effects):**

| From | To | Actor | Trigger | Side-effects |
|---|---|---|---|---|
| approved | scheduled | worker (Phase B claim) | row's `scheduled_at <= now()`, platform in allow-list | `last_publish_attempt_at = now()`; `publish_attempts` unchanged at claim time |
| scheduled | published | worker | `provider.publish` OK, or refresh+retry OK | `platform_post_id`, `platform_url`, `published_at` written; `incrementPublishedCountForCampaign` called |
| scheduled | approved | worker | `RATE_LIMITED` | `scheduled_at = now() + retryAfterSeconds`; `last_publish_error = 'RATE_LIMITED'`; `publish_attempts` **unchanged** |
| scheduled | approved | worker | `NETWORK` and `publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS` | `scheduled_at = now() + 60 * 2^attempts * (1 + jitter)`; `publish_attempts += 1`; `last_publish_error = 'NETWORK'` |
| scheduled | approved | reaper (Phase A) | `last_publish_attempt_at < now() - PUBLISH_STUCK_MINUTES` AND `publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS` | `publish_attempts += 1`; `last_publish_error = 'STUCK_REAPED'` |
| scheduled | failed | worker | `TOKEN_REVOKED`, `PLATFORM_REJECTED`, `UNKNOWN`, or `NETWORK` with `publish_attempts + 1 == PUBLISH_MAX_ATTEMPTS`, or refresh-loop / refresh-failed | `last_publish_error = <code>`; `ai_generation_metadata.publish_error = { reason, details, attempts }` |

No worker edge resurrects a `failed` row. No worker edge writes `content` / `hashtags`. Every edge is an atomic conditional `UPDATE … WHERE id = $id AND status = '<expected>'`.

---

## 4. Claim query

The claim is executed via a `SECURITY DEFINER` RPC, not a raw `UPDATE` from the application. The RPC owns the SQL contract — application code only calls `claimPostsForPublishing(client, limit)`. This makes the claim auditable, locks the `SKIP LOCKED` semantics in the database (not in the application), and lets `REVOKE ALL FROM public; GRANT EXECUTE TO service_role` enforce the access boundary in one place.

```sql
CREATE OR REPLACE FUNCTION public.claim_posts_for_publishing(
  p_now timestamptz,
  p_limit int
)
RETURNS SETOF public.posts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.posts AS p
     SET status = 'scheduled',
         last_publish_attempt_at = p_now
    FROM (
      SELECT id
        FROM public.posts
       WHERE status = 'approved'
         AND scheduled_at <= p_now
         AND platform IN ('linkedin', 'twitter')
         AND deleted_at IS NULL
       ORDER BY scheduled_at ASC
       LIMIT p_limit
       FOR UPDATE SKIP LOCKED
    ) AS due
   WHERE p.id = due.id
     AND p.status = 'approved'      -- defensive guard against TOCTOU
  RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) TO service_role;
```

**Index coverage (per D15 / no new index required at this point):** the existing partial index `(status, scheduled_at) WHERE status = 'approved'` from ADR 0001 §E covers the inner `SELECT` of the claim. The `platform IN (...)` filter is a small post-index predicate — acceptable at Phase 1 volume. A new index on `(status, last_publish_attempt_at) WHERE status = 'scheduled'` for the reaper is deferred (see §18).

The outer `UPDATE` writes `last_publish_attempt_at = p_now`; this column doubles as the claim timestamp. We do **not** introduce a separate `claimed_at` — one column, two readings (claim and "last publish action") avoids drift.

---

## 5. Error matrix

> **Superseded by Amendment 2 (2026-09-04) — this matrix names two codes that do not exist (`BAD_REQUEST`, `NOT_CONFIGURED`) and omits two that do (`NOT_IMPLEMENTED`, `PROVIDER_NOT_CONFIGURED`). The table below is left as originally written; see Amendment 2 for the corrected matrix and evidence.**

Every error path through `provider.publish(...)` corresponds to exactly one row below. The eight codes are the ADR 0002 §3 taxonomy.

| `SocialProviderErrorCode` | Cause | In-tick action | Next-tick state | `publish_attempts` change | User-visible signal |
|---|---|---|---|---|---|
| `TOKEN_EXPIRED` | Provider claims access token expired or 401-ish equivalent slipped past proactive refresh skew | **In-tick refresh+retry** (see §6) — `provider.refreshAccessToken({ socialAccountId })`, add to per-tick `Set<string>` loop guard, retry `provider.publish(input)` once same tick | published (on retry OK), or failed (on retry TOKEN_EXPIRED → `refresh_failed`), or scheduled (on retry NETWORK — falls into NETWORK row below) | **0** — refresh is a precondition fix, not a publish failure | None on success; `last_publish_error = 'TOKEN_REVOKED'`, `publish_error.reason = 'refresh_failed'` on terminal |
| `TOKEN_REVOKED` | Refresh token rejected / account disconnected at platform | Mark failed | failed | 0 (terminal mark is not a retry budget event) | `last_publish_error = 'TOKEN_REVOKED'`; UI: "Reconnect account" |
| `PLATFORM_REJECTED` | Platform-side validation refused the post (length, banned content, duplicate, etc.) | Mark failed | failed | 0 | `last_publish_error = 'PLATFORM_REJECTED'`; UI: "Edit and re-approve" |
| `RATE_LIMITED` | Platform rate limit; `retryAfterSeconds` provided by the provider | Requeue: `scheduled_at = now() + retryAfterSeconds` (verbatim, no jitter); status `scheduled → approved` | approved (with future `scheduled_at`) | **0** — platform-induced, does not consume retry budget | `last_publish_error = 'RATE_LIMITED'`; transient |
| `NETWORK` | TCP/TLS error, DNS, timeout, transient platform 5xx | If `publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS`: requeue with backoff+jitter, `publish_attempts += 1`. Else: mark failed | approved (with future `scheduled_at`) or failed | **+1** on requeue path; 0 on terminal mark | `last_publish_error = 'NETWORK'`; transient until terminal |
| `BAD_REQUEST` | Input validation that the provider rejected before the platform was contacted (input shape problem the worker can't fix) | Mark failed | failed | 0 | `last_publish_error = 'BAD_REQUEST'`; UI: developer-visible (should be impossible for an `approved` post) |
| `NOT_CONFIGURED` | Worker received a row whose platform has no provider wired up (defence-in-depth — should not happen because of the `platform IN (...)` allow-list at claim) | Mark failed | failed | 0 | `last_publish_error = 'NOT_CONFIGURED'`; surfaces a config bug |
| `UNKNOWN` | Anything the provider couldn't classify into the above | Mark failed | failed | 0 | `last_publish_error = 'UNKNOWN'`; investigate via `publish_error.details` |

**Note on TOKEN_EXPIRED:** ADR 0002 §8's `withFreshToken` performs *proactive* refresh inside a 5-minute skew window before each `publish()` call. ADR 0002 §5 explicitly assigns the *reactive* refresh-on-401 path to the **worker** (not the provider). The in-tick refresh+retry policy in §6 is that worker-owned path. A 60-second requeue on TOKEN_EXPIRED would be observable user latency for no benefit; refresh + same-tick retry costs sub-second and ships the post immediately.

---

## 6. Retry policy

**Constants** (defaults; see §14 for env-var overrides):
- `PUBLISH_MAX_ATTEMPTS = 5` — hard ceiling on `publish_attempts` for the worker-internal retry loop. The 5-attempt × 60-second base × exponential backoff window spans ~15 minutes total before terminal `failed`.
- `PUBLISH_RETRY_BACKOFF_SECONDS = 60` — base for the NETWORK exponential backoff.

**The single attempt-counter increment site.** `publish_attempts` is incremented in exactly two paths and nowhere else:
1. **NETWORK requeue** when `publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS` (the row is bouncing back to `approved` for another worker attempt).
2. **Reaper requeue** in Phase A when a `scheduled` row exceeded `PUBLISH_STUCK_MINUTES` and `publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS`.

Terminal `failed` marks **do not** increment `publish_attempts` (they freeze it where it is). `RATE_LIMITED` requeue and `TOKEN_EXPIRED` refresh+retry **do not** increment (neither is a worker-fault retry).

**NETWORK backoff with jitter (± 25%):**

```
newScheduledAt = now + PUBLISH_RETRY_BACKOFF_SECONDS
                       * 2 ^ (publish_attempts)   -- pre-increment value
                       * (1 + (random() * 0.5 - 0.25))
```

The jitter is symmetric ± 25% of the deterministic backoff. It prevents a thundering herd if a platform-wide outage strikes several businesses with posts scheduled for the same minute.

**TOKEN_EXPIRED in-tick refresh+retry (the worker-owned path from ADR 0002 §5):**

`publishOne` (the inner per-row function inside `runPublishTick`) owns:

1. Catch `TOKEN_EXPIRED` thrown by `provider.publish(input)`.
2. Maintain a per-tick `Set<string>` of `socialAccountId`s that have been refreshed this tick (`refreshedThisTick`).
3. If `socialAccountId` is **not** yet in `refreshedThisTick`:
   - `await provider.refreshAccessToken({ socialAccountId })`
   - add `socialAccountId` to `refreshedThisTick`
   - retry `provider.publish(input)` **exactly once**, same tick
   - `publish_attempts` is **not** incremented (refresh is a precondition fix, not a publish failure)
4. If the retry **still throws `TOKEN_EXPIRED`**: terminal `failed`, `last_publish_error = 'TOKEN_REVOKED'`, `ai_generation_metadata.publish_error.reason = 'refresh_failed'`.
5. If `TOKEN_EXPIRED` arrives on a row whose `socialAccountId` is **already in `refreshedThisTick`** (loop guard hit — another row for the same account triggered refresh earlier this tick and this one is still bad): terminal `failed`, `reason = 'refresh_loop'`.

If the retried `publish(input)` throws something *other* than `TOKEN_EXPIRED` (e.g. NETWORK), the result is processed by the normal error matrix — i.e. the row may be requeued with backoff. The refresh consumed no retry budget; the subsequent NETWORK does.

**RATE_LIMITED requeue:** `scheduled_at = now() + retryAfterSeconds` verbatim, no jitter. The platform told us when to come back; respect it.

---

## 7. Idempotency model

**In-tick — solved by the database.** The atomic claim via `FOR UPDATE SKIP LOCKED` (§4) eliminates concurrent claims of the same row. Two concurrent worker invocations cannot both claim post X; the second sees post X locked and skips it. The outer `UPDATE` re-asserts `status = 'approved'` as a defence-in-depth TOCTOU guard.

**Cross-tick — accepted Phase 1 tech debt, NO short-circuit guard.** A worker process that crashes between `provider.publish()` returning success and `markPostPublished` writing the DB row will leave the row in `scheduled`. After `PUBLISH_STUCK_MINUTES`, the reaper bounces it to `approved`, and a subsequent tick will publish a duplicate post on the platform.

We do **not** spec a `shortCircuitAlreadyPublished` helper. The mitigation that was discussed (querying the platform with a pre-publish "do you already have a post with content hash X?") provides no real protection in the failure mode that actually matters — at the moment of crash, the `platformPostId` is in memory and has never been persisted, so a cross-tick lookup has nothing to look up. Native platform idempotency keys (where supported) are the correct long-term fix and are listed in Open Follow-ups.

Bounding is the honest position: `PUBLISH_STUCK_MINUTES = 10` is well above the p99 latency of a successful publish call, so the window in which a crash actually produces a duplicate is small relative to the recovery window of a real platform outage.

**Refresh races.** ADR 0002 §8 accepts that two concurrent worker invocations (rare on a single-region Vercel deploy with `* * * * *` cadence, but not impossible) may both decide to refresh the same socialAccount in their proactive-refresh window. Database `UPDATE` ordering means one wins and writes the newer vault secret; the loser's write is overwritten. This is preserved verbatim by this ADR — no distributed advisory lock is introduced.

---

## 8. Recovery paths

**Phase A runs before the claim query, every tick.** The orchestrator runs Phase A unconditionally; Phase B runs after. Both can return zero work and still emit a valid summary.

**Phase A.1 — Stuck `generating` janitor (ADR 0004 §15 deferral, now co-located):**

```
UPDATE post_generation_sessions
   SET status = 'failed',
       error_code = 'timeout',
       finished_at = now()
 WHERE status = 'generating'
   AND started_at < now() - (POST_GENERATION_SESSION_STALE_MINUTES * INTERVAL '1 minute')
```

Exposed as `runJanitorTick({ now })` in `/lib/db/post-generation-sessions.ts` (signature in §10). Default `POST_GENERATION_SESSION_STALE_MINUTES = 15`.

**Phase A.2 — Stuck `scheduled` reaper:**

```
UPDATE posts
   SET status = 'approved',
       publish_attempts = publish_attempts + 1,
       last_publish_error = 'STUCK_REAPED'
 WHERE status = 'scheduled'
   AND last_publish_attempt_at < now() - (PUBLISH_STUCK_MINUTES * INTERVAL '1 minute')
   AND publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS
   AND deleted_at IS NULL
```

Rows where `publish_attempts + 1 >= PUBLISH_MAX_ATTEMPTS` are **not** reaped here — they are bounced to `failed` by a sibling statement in the same `reapStuckScheduledPosts` call so the worker doesn't leave them stuck forever:

```
UPDATE posts
   SET status = 'failed',
       last_publish_error = 'STUCK_TERMINAL'
 WHERE status = 'scheduled'
   AND last_publish_attempt_at < now() - (PUBLISH_STUCK_MINUTES * INTERVAL '1 minute')
   AND publish_attempts + 1 >= PUBLISH_MAX_ATTEMPTS
   AND deleted_at IS NULL
```

Exposed as `reapStuckScheduledPosts(client, { now, stuckMinutes })` in `/lib/db/posts.ts` (signature in §11). Returns `number` of rows touched (sum of both UPDATEs).

**Ordering invariant:** Phase A.1 (janitor) and Phase A.2 (reaper) **must** complete before Phase B (claim) starts. The reaper bouncing a stuck row to `approved` makes it eligible for the same-tick claim — a worker that published a single message and then crashed 11 minutes ago can be reclaimed and republished in the very next tick. This is explicitly desirable (it's the recovery path) and is what the §15 test `Reaper-before-claim ordering` pins down.

---

## 9. Schema changes

Single migration file. Confirmed next available filename by reading `/supabase/migrations/`: latest is `20260522200000_post_generation_sessions.sql`, so this ADR's migration is the next chronological file (Builder picks the timestamp).

```sql
-- Migration: publishing worker retry-tracking columns + claim RPC

ALTER TABLE public.posts
  ADD COLUMN publish_attempts        int          NOT NULL DEFAULT 0,
  ADD COLUMN last_publish_attempt_at timestamptz  NULL,
  ADD COLUMN last_publish_error      text         NULL;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_publish_attempts_nonnegative
    CHECK (publish_attempts >= 0),
  ADD CONSTRAINT posts_publish_attempts_ceiling
    CHECK (publish_attempts <= 10);
-- 5 is the runtime PUBLISH_MAX_ATTEMPTS; 10 is a hard defensive ceiling
-- so a misconfigured env can't run a row away to infinity.

CREATE OR REPLACE FUNCTION public.claim_posts_for_publishing(
  p_now timestamptz,
  p_limit int
)
RETURNS SETOF public.posts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.posts AS p
     SET status = 'scheduled',
         last_publish_attempt_at = p_now
    FROM (
      SELECT id
        FROM public.posts
       WHERE status = 'approved'
         AND scheduled_at <= p_now
         AND platform IN ('linkedin', 'twitter')
         AND deleted_at IS NULL
       ORDER BY scheduled_at ASC
       LIMIT p_limit
       FOR UPDATE SKIP LOCKED
    ) AS due
   WHERE p.id = due.id
     AND p.status = 'approved'
  RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) TO service_role;
```

**Notes:**
- No `claimed_at` column. `last_publish_attempt_at` is set by the claim RPC and reset on every subsequent worker action; the reaper reads it as "last time the worker touched this row".
- No RLS policy changes — service-role bypasses RLS, and the `posts` policies established in ADR 0001 already exclude `service_role` paths.
- No new index for the claim path (D15) — the existing partial `(status, scheduled_at) WHERE status='approved'` from ADR 0001 §E covers it.
- The reaper index `(status, last_publish_attempt_at) WHERE status='scheduled'` is **deferred** — see §18 Open Follow-ups. At Phase 1 volume the sequential scan over the (small) set of in-flight `scheduled` rows is cheaper than the index write amplification on every claim/publish.
- `last_publish_error` is `text` (not an enum) intentionally — the worker writes both `SocialProviderErrorCode` values (`'TOKEN_REVOKED'`, `'NETWORK'`, …) and worker-synthesised codes (`'STUCK_REAPED'`, `'STUCK_TERMINAL'`). Free-form `text` keeps the worker decoupled from the social-error enum.

---

## 10. Worker orchestrator API

TypeScript signatures only. Builder will create the actual file; this section pins the contract.

```ts
// /lib/publishing/orchestrator.ts (new file — Builder)

export interface PublishTickSummary {
  tick: string                          // ISO timestamp at tick start
  durationMs: number
  claimed: number                       // rows transitioned approved → scheduled this tick
  published: number                     // rows transitioned scheduled → published this tick
  failed: number                        // rows transitioned scheduled → failed this tick
  retried: number                       // rows transitioned scheduled → approved this tick
                                        //   (NETWORK + RATE_LIMITED requeues combined)
  refreshed: number                     // count of distinct socialAccountIds refreshed this tick
                                        //   (size of refreshedThisTick Set at tick end)
  reaped: number                        // rows touched by Phase A.2 reaper
                                        //   (both reaped-to-approved and STUCK_TERMINAL)
}

export interface JanitorTickSummary {
  tick: string
  durationMs: number
  stuckGenerationSessionsReaped: number
}

export function runPublishTick(opts?: {
  now?: Date
  batchSize?: number
}): Promise<PublishTickSummary>

export function runJanitorTick(opts?: {
  now?: Date
}): Promise<JanitorTickSummary>
```

`runPublishTick` is the entire Phase B. It calls `claimPostsForPublishing`, iterates with a local `publishOne` (which owns the per-row error matrix from §5 and the TOKEN_EXPIRED loop guard from §6), and accumulates counters.

`runJanitorTick` is Phase A.1 only — the generation-session janitor. Phase A.2 (the stuck-`scheduled` reaper) is called by the route handler directly via `reapStuckScheduledPosts` (§11) and its count is folded into `PublishTickSummary.reaped`. Two phases, two summaries, one response envelope.

Neither function reads `CRON_SECRET` or any header. Auth is the route handler's concern.

---

## 11. `/lib/db/posts.ts` additions

Signatures only. Each function is a thin wrapper around a single atomic SQL statement; the orchestrator owns sequencing.

```ts
// New service-role helpers in /lib/db/posts.ts

export function claimPostsForPublishing(
  client: ServiceRoleClient,
  limit: number
): Promise<PostRow[]>
// Calls the SECURITY DEFINER RPC from §4. Returns the rows already in
// status='scheduled' with last_publish_attempt_at = now().

export function markPostPublished(
  client: ServiceRoleClient,
  postId: string,
  payload: {
    platformPostId: string
    platformUrl: string | null
    publishedAt: Date
  }
): Promise<PostRow>
// Atomic: .eq('status', 'scheduled'). Throws if no row updated.

export function markPostFailed(
  client: ServiceRoleClient,
  postId: string,
  payload: {
    errorCode: string           // free-form text, see §9
    errorDetails: unknown       // serialised into ai_generation_metadata.publish_error
  }
): Promise<PostRow>
// Atomic: .eq('status', 'scheduled'). publish_attempts unchanged.

export function requeueScheduledPost(
  client: ServiceRoleClient,
  postId: string,
  payload: {
    newScheduledAt: Date
    errorCode: string
    errorDetails: unknown
    incrementAttempts: boolean
  }
): Promise<PostRow>
// Atomic: .eq('status', 'scheduled'). Bumps scheduled_at, writes error,
// conditionally increments publish_attempts (true for NETWORK, false for
// RATE_LIMITED). Status: scheduled → approved.

export function reapStuckScheduledPosts(
  client: ServiceRoleClient,
  opts: { now: Date; stuckMinutes: number }
): Promise<number>
// Executes both UPDATEs from §8 (Phase A.2): bounce-to-approved and
// terminal-failed. Returns total rows touched.

export function incrementPublishedCountForCampaign(
  client: ServiceRoleClient,
  campaignId: string
): Promise<void>
// Increments campaigns.published_post_count (or equivalent denormalised
// counter). Called from markPostPublished's caller (orchestrator), not
// from markPostPublished itself, so the campaign counter update sits
// outside the post status transition (separate concern, separate atomic
// operation).
```

**Conventions reinforced:**
- All writes use service-role via the **lazy-import pattern** from CLAUDE.md ("Three Supabase client roles"). The functions take a `client` parameter so the orchestrator can `await import('@/lib/supabase/service')` once at the top and pass the client down (avoids re-importing in every helper).
- Every state-transitioning function has `.eq('status', '<expected>')` in its `WHERE` clause. No read-then-update sequences. If the update returns zero rows, the caller treats it as "the row moved under us" and logs without retrying.
- None of these functions call `/lib/social/`, `/lib/ai/`, or vault directly.

---

## 12. Cron route contract

`/app/api/cron/publish/route.ts`. Builder creates the file; this section pins the externally observable behaviour.

**Method:** `GET`. Vercel Cron always issues `GET`.

**Authentication:**
```
Authorization: Bearer <CRON_SECRET>
```
Compared with `crypto.timingSafeEqual` after a length pre-check (timing-safe compare throws on mismatched lengths; the pre-check returns `401` for the length-mismatch case so the timing-safe path never sees it).

**Dev bypass:**
```
X-Cron-Dev-Trigger: true
```
Honoured **only when `process.env.NODE_ENV !== 'production'`**. In production the header is ignored — the auth path runs as if it were absent. The Builder must add a unit test pinning "dev bypass header in production environment returns 401".

**Phases:**
- Phase A — `runJanitorTick({ now })` then `reapStuckScheduledPosts(client, { now, stuckMinutes: PUBLISH_STUCK_MINUTES })`.
- Phase B — `runPublishTick({ now, batchSize: PUBLISH_BATCH_SIZE })`.

`now` is a single `new Date()` captured at the top of the handler and threaded through both phases — every comparison in the tick uses the same instant.

**Response:** Status `200` always (cron logs are the observability surface; non-200 would just make Vercel retry, which we don't want here). Body:

```json
{
  "tick": "2026-05-24T18:30:00.000Z",
  "janitor": {
    "tick": "2026-05-24T18:30:00.000Z",
    "durationMs": 12,
    "stuckGenerationSessionsReaped": 0
  },
  "publish": {
    "tick": "2026-05-24T18:30:00.000Z",
    "durationMs": 1843,
    "claimed": 3,
    "published": 2,
    "failed": 0,
    "retried": 1,
    "refreshed": 1,
    "reaped": 0
  }
}
```

**`maxDuration = 60`** on Pro (default), `30` on Hobby (see §13).

**401 response body:** the literal string `Unauthorized` (or `{ "error": "Unauthorized" }` if the Builder prefers JSON consistency). It MUST NOT distinguish "missing header" from "wrong secret" from "wrong format" — a single message for every auth-fail path.

**No retries on internal exception.** If `runPublishTick` throws, the handler catches, logs, and returns `200` with `publish: null` and a top-level `error` field. The next tick will pick up where this one left off (rows are atomic).

---

## 13. vercel.json contract

```json
{
  "crons": [
    { "path": "/api/cron/publish", "schedule": "* * * * *" }
  ]
}
```

**Hobby fallback (one-line guidance in the deploy README, NOT a conditional in code):**
> On Hobby plans, change `schedule` to `"*/5 * * * *"` and set `maxDuration = 30` on the route. This widens worst-case publish latency to ~5 minutes but stays within the Hobby cron and function-duration ceiling.

There is no branching logic in the route or the orchestrator based on plan tier. The plan choice is a one-line config change at deploy time.

---

## 14. Configuration

New entries in `/lib/config.ts` (typed access, no `process.env.*` outside that file — CLAUDE.md convention):

| Var | Default | Required | Notes |
|---|---|---|---|
| `CRON_SECRET` | — | **Yes in production** | Validated at boot: minimum 32 chars. Optional in `NODE_ENV !== 'production'` (dev bypass header is the local trigger). |
| `PUBLISH_BATCH_SIZE` | `25` | No | Per-tick claim limit. |
| `PUBLISH_MAX_ATTEMPTS` | `5` | No | Worker-internal retry ceiling. Database CHECK constraint allows up to 10 (defensive). |
| `PUBLISH_RETRY_BACKOFF_SECONDS` | `60` | No | Base for NETWORK exponential backoff. |
| `PUBLISH_STUCK_MINUTES` | `10` | No | Reaper threshold for stuck `scheduled` rows. |
| `POST_GENERATION_SESSION_STALE_MINUTES` | `15` | No | Janitor threshold for stuck `generating` rows. (Already specced in ADR 0004 §B.6; surfaced here too because the cron consumes it.) |

Boot-time validation lives in `/lib/config.ts`'s existing schema (Zod). Missing `CRON_SECRET` in production fails fast at module init — the route handler never sees a request without a configured secret.

---

## 15. Testing strategy

All worker tests use `MockProvider` (registered in `/lib/social/` for tests) with a `FailureConfig` per error code. No live Postiz hits in CI. No real Anthropic calls (the worker never calls `/lib/ai/`, so this is naturally satisfied).

**Per-error-code unit tests (one each):**

| Test | Asserts |
|---|---|
| `TOKEN_EXPIRED → refresh → success` | `summary.refreshed === 1`; row ends in `published`; `publish_attempts` unchanged from pre-tick value |
| `TOKEN_EXPIRED → refresh → TOKEN_EXPIRED` | Row ends in `failed`; `last_publish_error === 'TOKEN_REVOKED'`; `ai_generation_metadata.publish_error.reason === 'refresh_failed'`; `publish_attempts` unchanged |
| `TOKEN_EXPIRED refresh-loop guard` | Two posts for the same `socialAccountId`, MockProvider throws TOKEN_EXPIRED on first publish for both. First triggers refresh + retry. Second hits the loop guard → `failed` with `reason === 'refresh_loop'`. Assert `refreshed === 1` (not 2). |
| `TOKEN_REVOKED` | Row → `failed`; `last_publish_error === 'TOKEN_REVOKED'`; `publish_attempts` unchanged |
| `PLATFORM_REJECTED` | Row → `failed`; `last_publish_error === 'PLATFORM_REJECTED'` |
| `RATE_LIMITED` | Row → `approved`; `scheduled_at` advanced by exactly `retryAfterSeconds` (verbatim); `publish_attempts` **unchanged** |
| `NETWORK with attempts < MAX` | Row → `approved`; `publish_attempts += 1`; `scheduled_at` advanced; bracket the bumped `scheduled_at` within the jitter window `[base * 2^prev * 0.75, base * 2^prev * 1.25]` |
| `NETWORK with attempts + 1 == MAX` | Row → `failed`; `publish_attempts` unchanged on terminal mark (frozen at pre-tick value, since terminal is not a retry) |
| `BAD_REQUEST`, `NOT_CONFIGURED`, `UNKNOWN` | Row → `failed` with the corresponding `last_publish_error` |

**Ordering & reaper tests:**

| Test | Asserts |
|---|---|
| `Reaper-before-claim ordering` | Seed: one `scheduled` row with `last_publish_attempt_at = now() - 11 minutes` AND one fresh `approved` row with `scheduled_at = now()`. Run a single tick. Both rows end in `published`. Asserts Phase A reaped first and Phase B picked up *both* rows. |
| `Reaper at MAX attempts → STUCK_TERMINAL` | Stuck `scheduled` with `publish_attempts = MAX - 1`. After reap: row in `failed` with `last_publish_error === 'STUCK_TERMINAL'`. |
| `Platform allow-list at claim` | Seed: `approved` instagram post with `scheduled_at = now()`. Run tick. `claimed === 0` for that row; row stays `approved`. |
| `Atomic claim under concurrent ticks` | Two `runPublishTick` calls started concurrently against the same fixture. Each row is claimed by exactly one tick. No duplicate publishes. |

**Route handler tests:**

| Test | Asserts |
|---|---|
| `Missing Authorization → 401` | Body matches the single generic "Unauthorized" string |
| `Wrong secret → 401` | Same body as missing; `crypto.timingSafeEqual` was reached |
| `Wrong-length secret short-circuits before timing-safe compare` | Length pre-check returns 401 without invoking timingSafeEqual |
| `Dev bypass header in non-prod → 200` | Phase A + Phase B run; no `CRON_SECRET` required in env |
| `Dev bypass header in production → 401` | Header is ignored; auth path runs normally |
| `Internal exception in runPublishTick → 200 with error field` | Vercel does not retry on non-2xx, so the handler swallows |

**Janitor tests:**

| Test | Asserts |
|---|---|
| `Stuck generating session → failed with timeout` | `generating` row with `started_at = now() - 16 minutes` → status `failed`, `error_code === 'timeout'` |
| `Fresh generating session untouched` | `generating` row with `started_at = now() - 1 minute` stays `generating` |

All assertions on `publish_attempts`, `last_publish_attempt_at`, and `last_publish_error` are made against the database row after the tick, not against the orchestrator's in-memory state.

---

## 16. Accepted tech debt

These are explicit, conscious deferrals — not "we forgot." Future ADRs should consume them or argue them away with new evidence, not silently work around them.

- **D9 — Crash-between-publish-and-DB-write may duplicate a post on the platform.** Bounded by `PUBLISH_STUCK_MINUTES = 10` being well above p99 publish latency. Native platform idempotency keys (where supported) are the long-term fix.
- **ADR 0002 §8 — Refresh race.** Two concurrent workers may both decide to refresh the same `socialAccountId`. Database `UPDATE` ordering settles it; the loser's write is overwritten. No distributed lock.
- **Function-timeout overflow.** When `runPublishTick` exceeds `maxDuration = 60s`, the in-flight per-row publishes that hadn't reached `markPostPublished` / `markPostFailed` / `requeueScheduledPost` leave those rows in `scheduled`. They are not proactively reverted. The reaper picks them up after `PUBLISH_STUCK_MINUTES` — **worst-case observable user latency on a function-timeout overflow is ~10 minutes**. This is the trade for not specing an `AbortSignal`-based revert (which would itself race the platform calls already in flight).

---

## 17. Out of scope

Explicit non-goals for this ADR and Session 10. Listing them here so a Reviewer doesn't flag their absence.

- **Metrics worker.** A separate cron route, future session, future ADR.
- **Engagement worker** (reply automation). Phase 3+.
- **Dead-letter queue / "Retry from failed" UI.** Phase 2 — see Open Follow-ups.
- **Platform-side idempotency keys.** Requires Postiz extension and/or native provider work. See Open Follow-ups.
- **Per-business fairness queue.** The current claim is global FIFO by `scheduled_at`. A heavy publisher cannot starve a light one because rows are bounded by `scheduled_at` (the time the user / scheduler chose). Acceptable for Phase 1.
- **Distributed advisory lock on refresh.** Sequel to the refresh-race tech debt.
- **Sentry / structured logger.** The "proper logger to be added later" gotcha from CLAUDE.md still applies. JSON cron response + Vercel function logs are the entire observability surface for Phase 1.

---

## 18. Open follow-ups

For future ADRs / sessions. Each is one or two sentences so future agents can decide whether to expand.

- **User-triggered "Retry from failed" action (Phase 2).** UI affordance + a dedicated server action that does the `failed → scheduled` (or `failed → approved`) transition the worker is forbidden from doing. Belongs in the post-review UI session.
- **Native LinkedIn / X providers replacing Postiz.** When this happens, the per-platform error mapping inside the new providers must continue to throw the ADR 0002 §3 `SocialProviderErrorCode` taxonomy unchanged so this worker keeps working with zero changes.
- **PostizProvider `PublishResult.platformPostId` audit.** Before the first production cron tick, verify that `PostizProvider.publish` returns the actual platform-side ID (LinkedIn URN, X tweet ID) in `PublishResult.platformPostId`, **not** a Postiz internal post ID. If it returns the Postiz ID, the "open on platform" UI link breaks and any future native-provider replacement loses the audit trail. This is a PostizProvider contract requirement (Session 3/6 surface), not a worker concern — but flag it as a pre-production check. Re-verify Session 6 integration before flipping the cron on in production.
- **Partial index `(status, last_publish_attempt_at) WHERE status = 'scheduled'`.** Deferred until the in-flight `scheduled` row count exceeds ~1000. At Phase 1 volume the seq scan on the small "in-flight" set is cheaper than the index write amplification on every claim and publish.
- **Thread-of-tweets representation** if structured X threads land (ADR 0004 §16 follow-up). A thread is currently modelled as N independent `posts` rows; if a future ADR introduces a single thread row with N children, the claim, publish, and platform-error mapping all need re-spec.

---

## Amendment 1 — Trigger Source (2026-06-04)

**Status:** Accepted
**Date:** 2026-06-04
**Scope:** trigger source only — auth path, route method, and `vercel.json` `crons` entry. Orchestrator behaviour (`runPublishTick`, atomic claim, idempotency, requeue ladder, reaper), response shape (always-200 + JSON outcome), Sentry `withMonitor` wrapping, `cron_health` row writes, and `maxDuration` are **unchanged**.
**Reversed by:** _(none)_

### 1. Headline decision — hard env-driven branch

Trigger source is selected by a **hard branch on `config.server.CRON_TRIGGER`** (enum `'qstash' | 'secret'`, default `'secret'`). Not by `Upstash-Signature` header presence. Not by `Authorization` header presence. Not by feature flag, not by request shape.

**Lexical unreachability is the load-bearing property:**

```
if (config.server.CRON_TRIGGER === 'qstash') {
  // QStash branch — Receiver.verify only. The Bearer path and the
  // X-Cron-Dev-Trigger dev-bypass header are not consulted here,
  // not even guarded — they are lexically unreachable.
} else {
  // Existing branch verbatim — Bearer CRON_SECRET with
  // X-Cron-Dev-Trigger honoured only when NODE_ENV !== 'production'.
  // Unchanged from §12.
}
```

**Header-presence selection is explicitly rejected.** An attacker who knows both auth paths exist could downgrade to the weaker one by omitting the QStash signature header. Future "let's just check which headers are present and dispatch" refactors reintroduce that downgrade attack; the env-driven branch eliminates it by construction.

**Per-environment hard cutover (no dual-mode).** Production flips to `CRON_TRIGGER=qstash` **and** removes the corresponding `crons` entry from `vercel.json` in the **same deploy**. Preview and development environments stay on `'secret'`. The orchestrator's atomic claim (§4, §7) could absorb double-fires from a dual-mode period, but it is needless invocation waste, and the preview-environment smoke test already covers the safety question end-to-end.

### 2. Route diff minimality contract (Reviewer's diff test)

The route change is mechanically four edits and nothing else. The Reviewer should use this as the diff-minimality test on the Builder PR.

1. Wrap the existing Bearer + dev-bypass block in `else { … }` **verbatim** — do not rewrite it, do not extract it, do not re-order checks inside it.
2. Add `if (config.server.CRON_TRIGGER === 'qstash') { … }` above the `else`, calling `verifyQStashRequest(request)` (see §4).
3. Add the single `triggeredBy` field to the existing tick structured log line (see §6).
4. Add one structured `console.warn` line on auth failure inside the QStash branch (see §6), mirroring the Bearer side's existing warn.

The diff **must not** touch: the orchestrator invocation, the `Sentry.withMonitor` wrapper, the always-200 response contract, `maxDuration`, `cron_health` writes, the Bearer byte-for-byte verification logic, or the dev-bypass conditional inside the Bearer branch.

### 3. QStash-only helper — `/lib/cron/qstash-auth.ts`

A single new module exports one function. TypeScript signature only — Builder owns the body.

```ts
export async function verifyQStashRequest(
  request: NextRequest,
): Promise<void>
```

Contract:

- Constructs an Upstash `Receiver` as a **module-level singleton** from `config.server.QSTASH_CURRENT_SIGNING_KEY` and `config.server.QSTASH_NEXT_SIGNING_KEY`. Both keys are passed on every verify (the Receiver rotates internally).
- Reads the raw body via `await request.text()` **once**, before any JSON parse — orchestrator does not need the body, so the helper may discard it, but the read must precede signature verification (D4).
- Reconstructs the full URL from `request.url` (NextRequest exposes the absolute URL).
- Throws a typed error on any failure: missing signature, invalid signature, wrong method (POST required), missing config.
- The route catches and returns **`401`** with the literal response body `"Unauthorized"`. The thrown reason is for the structured warn line only — it must not appear in the response body.

**Bearer auth is NOT extracted.** It stays inline in each route's `else` branch, byte-identical to today. This is a deliberate D6 trade-off, recorded here so the Reviewer does not flag the asymmetric extraction as a code smell:

- **Lower review risk.** The working Bearer code is touched only to wrap it in `else { … }` — no logical changes, easy line-by-line diff against `master`.
- **Lexical separation of the two auth paths is visible at the route level.** A reader sees both branches side by side without chasing through a shared helper that has to "decide which path it is."
- **Pro-tier rollback is a deletion.** When `CRON_TRIGGER` flips back to `'secret'`, the Bearer path is reached by deleting the `if` branch, not by changing function semantics inside a helper.

### 4. Method asymmetry — split `GET` / `POST` in the same `route.ts`

Each cron route exports **two** handlers in the same file:

- `export async function GET(request)` — body runs only when `CRON_TRIGGER === 'secret'`. When `CRON_TRIGGER === 'qstash'`, return `405`.
- `export async function POST(request)` — body runs only when `CRON_TRIGGER === 'qstash'`. When `CRON_TRIGGER === 'secret'`, return `405`.

Both delegate to the **same** inner orchestration function (the existing `runPublishTick` invocation + JSON response). Only the auth differs. The 405 short-circuit is a one-liner before the auth branch.

Manual on-call re-trigger in QStash-mode production is the QStash console's **"Run now"** button on the schedule. There is intentionally **no `curl` with `CRON_SECRET`** path in QStash mode — see §12 Out of scope. Document this in `docs/build-guide/runbooks/qstash-setup.md`.

### 5. Observability deltas

Two log-line changes. No other `console.*` is added.

**5.1 Tick structured log gains one field.**

The existing per-tick JSON log line (`kind: 'publish-tick'`) gains one additional field:

```
triggeredBy: config.server.CRON_TRIGGER
```

Applied symmetrically in the metrics worker (`kind: 'metrics-sync-tick'`) by ADR 0006 Amendment 1. This is what lets the post-Pro-flip operator confirm the rollback worked by tailing logs, not by guessing from cadence.

**5.2 Auth-failure warn line in the QStash branch.**

Mirrors the Bearer branch's existing warn structure. The Bearer-side warn line is **unchanged** by this amendment. The QStash branch's warn:

```
console.warn(JSON.stringify({
  kind: 'cron-auth-failure',
  route: 'publish',
  trigger: 'qstash',
  reason: '<qstash-missing-signature | qstash-invalid-signature | qstash-requires-post | qstash-config-missing>',
}))
```

The `reason` field is **for the log only**. The 401 response body is the literal string `"Unauthorized"`. A test must pin response-body equality so a future "let's surface the reason" refactor doesn't leak it.

**5.3 Sentry breadcrumb / scrubber additions (ADR 0007 §3.3, `lib/observability/sentry-scrub.ts`).**

Add to `REDACTED_KEYS`:

- `Upstash-Signature` — header value is a JWS, technically non-secret, but breadcrumb noise.
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

No signing-key material and no `Upstash-Signature` header value ever appears in any application log, anywhere.

### 6. `vercel.json` delta (single sentence to §13)

When `CRON_TRIGGER=qstash` in the target environment, the corresponding `crons` entry is **removed** from `vercel.json` for that deploy. The reserved JSON block (full `crons` array, both routes, original schedules `* * * * *` and `0 * * * *`) lives verbatim in `docs/build-guide/runbooks/vercel-cron-restore.md`, ready to paste back when the Pro tier lands.

### 7. Config additions — `/lib/config.ts`

Three new typed env vars, accessed only via `config.server.*`:

| Env var | Type | Default | Required when |
|---|---|---|---|
| `CRON_TRIGGER` | `'qstash' \| 'secret'` | `'secret'` | always (defaulted) |
| `QSTASH_CURRENT_SIGNING_KEY` | `string` | — | `CRON_TRIGGER === 'qstash'` |
| `QSTASH_NEXT_SIGNING_KEY` | `string` | — | `CRON_TRIGGER === 'qstash'` |

The two `QSTASH_*_SIGNING_KEY` values are set **equal** when no rotation is in flight — the verify path always passes both to `Receiver`. Distinct values appear only during an Upstash rotation window.

Zod `superRefine`: when `CRON_TRIGGER === 'qstash'` **and** `NODE_ENV === 'production'`, both signing keys must be non-empty. Same shape as the existing prod-required `CRON_SECRET` refine.

**`CRON_SECRET` remains required-in-production regardless of `CRON_TRIGGER`,** because preview and development environments stay on `'secret'` and need it. Removing `CRON_SECRET` is **out of scope** for this amendment.

### 8. At-least-once + Sentry compatibility

- **At-least-once delivery.** QStash retries on non-2xx. The orchestrator's atomic claim (§4) and per-row idempotency (§7) already make duplicate ticks safe. This amendment owes **no new mechanism**.
- **Sentry Cron Monitor (ADR 0007 §3.5)** wraps the orchestrator call, not the route and not the trigger. Schedule values in `/lib/publishing/orchestrator.ts` and `/lib/metrics/orchestrator.ts` are **unchanged**; QStash is configured to fire at the same cadence the monitor expects.

### 9. Required tests

The Builder owns the implementation tests for the QStash auth helper (valid signature → pass; bad signature → throw; missing config → throw; non-POST method → throw). The following two tests are **pinned by this ADR** and the Reviewer must verify both exist:

1. **Dev-bypass-in-QStash-mode 401.** With `CRON_TRIGGER='qstash'` and `NODE_ENV='development'`, a request carrying `X-Cron-Dev-Trigger: true` and **no** `Upstash-Signature` returns **401** — not dev-bypass. This is the lexical-unreachability property under test. It is the single most likely silent regression if someone later "consolidates" the two branches into a unified verifier.
2. **401 body equality.** The QStash-branch 401 response body equals the literal string `"Unauthorized"`. The structured warn `reason` field must not appear in the response body. Pin `.toBe('Unauthorized')`, not `.toContain('Unauthorized')`.

### 10. Rollback procedure

See `docs/build-guide/runbooks/vercel-cron-restore.md`. Summary: set `CRON_TRIGGER='secret'` in the target environment, remove the two `QSTASH_*_SIGNING_KEY` env vars, paste the reserved JSON block back into `vercel.json`, redeploy. **Zero code change.**

### 11. Out of scope

- **Other workloads on QStash.** This amendment covers the two cron triggers (`publish`, `sync-metrics`). Any future queue-style work (engagement worker, webhook fan-out) gets its own ADR.
- **Dropping `CRON_SECRET`.** Preview/dev keep using it; production still validates the env at boot.
- **Dual-mode operation.** No transitional window where both Vercel Cron and QStash fire.
- **Header-presence-based trigger selection.** See §1 — explicitly rejected as a downgrade vector.
- **`CRON_SECRET` fallback inside the QStash branch.** Manual re-trigger goes through the QStash console.
- **Extracting Bearer into a shared helper.** Deliberately kept inline (§3 trade-off).

### 12. Open follow-up — Pro tier re-enable

When SOSH reaches the Vercel Pro tier, restore Vercel Cron as the trigger source. The change is:

1. Set `CRON_TRIGGER=secret` in production env vars.
2. Restore the reserved `crons` block in `vercel.json` (from `vercel-cron-restore.md`).
3. Remove `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` from production env vars.
4. Redeploy.

No application code changes. The `else` branch handles all of it.

### 13. Companion runbooks and checklist updates

Builder produces (Architect names them here):

- **`docs/build-guide/runbooks/qstash-setup.md`** — Upstash project + schedule provision, env var population, deploy ordering, smoke test, and the "manual re-trigger = QStash console Run now" note (no curl-with-Bearer in qstash mode).
- **`docs/build-guide/runbooks/vercel-cron-restore.md`** — reserved `vercel.json` `crons` block + the Pro-tier flip procedure (§10).
- **`docs/launch-checklist.md` §3 (Cron)** — gains a "Trigger source" sub-header with two parallel sections: **"QStash (active at launch)"** and **"Vercel Cron (reserved)"**. The `CRON_SECRET` row stays in the active section because preview/dev still need it.

---

## Amendment 2 — Error Matrix Correction (2026-09-04)

**Status:** Accepted
**Date:** 2026-09-04
**Scope:** §5's error matrix PROSE only. No code changes — `publishing/orchestrator.ts:208-305` already handles the real eight-code union correctly; this amendment corrects the documentation to match the implementation, not the other way around.
**Reversed by:** _(none)_

### 1. What was wrong

§5's matrix names `BAD_REQUEST` and `NOT_CONFIGURED` — neither exists on `SocialProviderErrorCode` (`lib/social/types.ts:7-15`) — and omits `NOT_IMPLEMENTED` and `PROVIDER_NOT_CONFIGURED`, both of which do. Both counts land on eight, which is how the error survived review (ADR 0028 §7.1 names this finding; Session 30.5's N2.1 platform-verification pass is what surfaced it, though it is a documentation-fact check, not a vendor-endpoint one).

### 2. The real union, evidence-cited

The eight codes are exactly `lib/social/types.ts:7-15`: `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `RATE_LIMITED`, `PLATFORM_REJECTED`, `NETWORK`, `NOT_IMPLEMENTED`, `PROVIDER_NOT_CONFIGURED`, `UNKNOWN`. `publishing/orchestrator.ts:301-305`'s terminal `switch` case already lists `TOKEN_REVOKED`, `PLATFORM_REJECTED`, `NOT_IMPLEMENTED`, `PROVIDER_NOT_CONFIGURED`, `UNKNOWN` together, calling `markPostFailed` with `errorCode: err.code`. The implementation was always correct; §5's table just described a different, nonexistent union. `BAD_REQUEST` and `NOT_CONFIGURED` were grepped repo-wide (`lib/`, `app/`) and found nowhere outside this ADR's own prose — no test, migration, or UI copy ever referenced either string, so nothing besides this document needs correcting.

### 3. Corrected matrix

| `SocialProviderErrorCode` | Cause | In-tick action | Next-tick state | `publish_attempts` change | User-visible signal |
|---|---|---|---|---|---|
| `TOKEN_EXPIRED` | Provider claims access token expired or 401-ish equivalent slipped past proactive refresh skew | In-tick refresh+retry (§6) | published, failed, or scheduled | 0 | `last_publish_error = 'TOKEN_REVOKED'` on terminal (unchanged from §5) |
| `TOKEN_REVOKED` | Refresh token rejected / account disconnected at platform | Mark failed | failed | 0 | `last_publish_error = 'TOKEN_REVOKED'`; UI: "Reconnect account" |
| `PLATFORM_REJECTED` | Platform-side validation refused the post (length, banned content, duplicate, malformed URN, etc.) | Mark failed | failed | 0 | `last_publish_error = 'PLATFORM_REJECTED'`; UI: "Edit and re-approve" |
| `RATE_LIMITED` | Platform rate limit; `retryAfterSeconds` provided by the provider | Requeue at `now() + retryAfterSeconds` | approved (future `scheduled_at`) | 0 | `last_publish_error = 'RATE_LIMITED'`; transient |
| `NETWORK` | TCP/TLS error, DNS, timeout, transient platform 5xx, or a documented-retryable 409 conflict (ADR 0028 §7.2) | Backoff+jitter requeue, or terminal at max | approved or failed | +1 on requeue, 0 on terminal | `last_publish_error = 'NETWORK'`; transient until terminal |
| `NOT_IMPLEMENTED` | Provider has not implemented the called method for this platform (e.g. `fetchPostMetrics` pre-native, media publish pre-N2.7/N2.8) | Mark failed | failed | 0 | `last_publish_error = 'NOT_IMPLEMENTED'`; surfaces a capability gap, not a transient failure |
| `PROVIDER_NOT_CONFIGURED` | Worker received a row whose platform has no provider registered (ADR 0028 §8.2: the registry is overrides-only post-Postiz-removal — a missing secret darks exactly that platform, not the whole worker) | Mark failed | failed | 0 | `last_publish_error = 'PROVIDER_NOT_CONFIGURED'`; surfaces a config bug |
| `UNKNOWN` | Anything the provider couldn't classify into the above | Mark failed | failed | 0 | `last_publish_error = 'UNKNOWN'`; investigate via `publish_error.details` |

`BAD_REQUEST` and `NOT_CONFIGURED` are removed — they never existed on the union.

### 4. Why here, not deferred

Founder ruling (build-guide §0.2, A-7): *"if we just make an amendment to an old adr it won't get fixed."* The Architect's own recommendation was to defer this correction to a documentation-only follow-up session; the founder overruled it specifically to close the amendment while the reasoning is fresh, rather than let it join a backlog. Both positions are recorded here for the record, not just the outcome.
