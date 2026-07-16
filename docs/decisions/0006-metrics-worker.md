# ADR 0006 — Metrics Worker

**Status:** Accepted
**Date:** 2026-05-28
**Related:** ADR 0001 §6 (`post_metrics` schema), ADR 0002 §3 (error taxonomy) + metrics shapes + §6 (`fetchPostMetrics` stub), ADR 0005 (publishing worker — the write-side mirror of this worker)

The metrics worker is the read-side mirror of the publishing worker (ADR 0005). It runs on Vercel Cron, finds `published` posts whose platform metrics are stale or never-synced, calls `SocialProvider.fetchPostMetrics(...)` via `getRegistry()`, and upserts the result into `post_metrics`. This ADR reuses ADR 0005's patterns by reference and does **not** restate them.

---

## 1. Headline decision — `NOT_IMPLEMENTED` is a first-class outcome, not an error

This is why ADR 0006 exists as its own document rather than a footnote to ADR 0005.

In Phase 1, `PostizProvider.fetchPostMetrics` throws `SocialProviderError` with code `NOT_IMPLEMENTED` on **every** call (confirmed at `lib/social/postiz-provider.ts:169`). Postiz is the only production provider. Therefore, in production, the metrics worker can fetch nothing — yet it ships fully implemented, scheduled, and tested.

`NOT_IMPLEMENTED` is modelled as a **first-class outcome class**, never as a failure:

- It is counted as `skippedNotImplemented` in the tick summary — **never** as `errors`.
- It triggers the **per-platform tick short-circuit** (named mechanism): the first `NOT_IMPLEMENTED` thrown for a given platform marks that platform `unsupported` for the remainder of the tick. Every subsequent candidate on that platform is counted `skippedNotImplemented` **without** another provider call. So `N` stale posts across `P` platforms produce at most `P` throwing probes per tick, not `N`.
- It produces no log spam, no retry, and no post mutation.

**The wired-but-inert asymmetry.** ADR 0005's publishing worker does real work in Phase 1 — it drives posts to `published`. ADR 0006's metrics worker is **wired-but-inert in Phase 1 production**: every tick runs, queries candidates, probes once per platform, and short-circuits to all-`skippedNotImplemented`. This is the inverse premise, and it is the entire reason for a separate ADR.

> **A tick that returns `skippedNotImplemented` for every candidate is HEALTHY, not degraded.** A future maintainer must not "fix" an all-skipped tick. It becomes live — with **zero worker changes** — the moment a native provider implements `fetchPostMetrics` (see §15).

---

## 2. Relationship to ADR 0005

**Mirrored (reused verbatim by reference — see the cited sections, not restated here):**

- Cron route auth: `CRON_SECRET` with `timingSafeEqual` + length pre-check, dev-bypass header honoured only when `NODE_ENV !== 'production'` (ADR 0005 §12).
- Route contract shape: auth → single orchestrator call → response; route holds no orchestration logic (ADR 0005 §2, §12).
- Always-`200` response (non-2xx only makes Vercel retry, which we don't want) (ADR 0005 §12).
- Service-role access throughout via the lazy `await import('@/lib/supabase/service')` pattern (ADR 0005 §11, CLAUDE.md "Three client roles").
- One structured `console.log(JSON.stringify({ kind, ...summary }))` line per tick as the entire observability surface (ADR 0005 §17).

**Deliberately dropped (the read-side simplification):**

| ADR 0005 mechanism | Why it has no analogue here |
|---|---|
| Atomic claim RPC + `FOR UPDATE SKIP LOCKED` (§4) | The worker never transitions a row. Two ticks syncing the same post is harmless — `upsertPostMetrics` is idempotent on `post_id`. No lock needed. |
| Status machine / state transitions (§3) | The worker mutates only `post_metrics`. `posts.status` is never touched. |
| Retry-tracking columns (`publish_attempts`, …) (§9, REVERSAL 1) | No attempts counter. A failed sync leaves the row stale; staleness *is* the retry signal. |
| Backoff + jitter, requeue, mutable `scheduled_at` (§6, REVERSAL 3) | No requeue. Stale-based selection re-picks the post next tick automatically. |
| Terminal `failed` state (REVERSAL 2) | There is **no terminal state**. Every non-success is transient by construction. |
| In-tick token refresh + retry (§6) | Dropped per A2 below — a read-worker refreshing tokens races the publishing worker (ADR 0002 §8) for no benefit. |

Net effect: no migration, no new columns, no RPC, no state machine. The worker is a query, a loop, and an upsert.

---

## 3. Contract boundaries

The worker **MAY NOT**:

- mutate `posts` — **any** column, under any code path (the post is already `published`; its lifecycle is owned by the user and the publishing worker);
- write **any** table other than `post_metrics`;
- import from `/lib/ai/` (no AI calls on the metrics path);
- touch `vault.*` directly (vault reads happen exclusively inside `/lib/social/`, the same as ADR 0005);
- use the anon Supabase client (service-role throughout, per CLAUDE.md "Three client roles").

The route handler holds no orchestration logic — it is auth + one orchestrator call + response.

---

## 4. Candidate selection

A plain `/lib/db/` service-role helper, `listPostsForMetricsSync` (§8). **No `SECURITY DEFINER` RPC** — ADR 0005 needed an RPC only to own the `FOR UPDATE SKIP LOCKED` claim semantics in the database; there is no locking analogue here, and service-role already bypasses RLS for the read.

**Predicate** (a `published` post is a candidate when all hold):

- `status = 'published'`
- `platform_post_id IS NOT NULL` (defence-in-depth; a published post should always have one)
- `deleted_at IS NULL`
- `platform IN ('linkedin', 'twitter')` — the Phase 1 publish allow-list (ADR 0005 §4); other platforms are never published, so never have metrics to sync
- `published_at > now() - (METRICS_MAX_AGE_DAYS * INTERVAL '1 day')` — stop syncing posts older than the launch window
- **stale or never-synced**: the row's `post_metrics.last_synced_at IS NULL` (never synced — no metrics row exists yet) **OR** `last_synced_at < now() - (METRICS_STALE_MINUTES * INTERVAL '1 minute')`

**Ordering:** `ORDER BY last_synced_at NULLS FIRST` — never-synced posts are prioritised over merely-stale ones. `LIMIT` = batch size.

> The `posts → post_metrics` **left join** (required so never-synced posts, which have no `post_metrics` row, are still returned) may be awkward to express through the PostgREST query chain. If so, the Builder may introduce a plain (**NON-`SECURITY DEFINER`**) database view or RPC *solely* to express the join. The default and preferred form is the plain helper; a view is a fallback for join ergonomics only, not a security boundary.

The existing `post_metrics (last_synced_at)` index (ADR 0001 §6) covers the staleness ordering. No new index now (§13 / §15 — deferred).

---

## 5. Outcome matrix

Every candidate resolves to exactly one outcome. **Only `synced` writes `last_synced_at`.** Every non-`synced` outcome leaves the post stale, so it self-heals on a later tick — there is no attempts counter and no terminal state.

| Trigger | Outcome | Provider call made? | Upsert? | Writes `last_synced_at`? | Counter |
|---|---|---|---|---|---|
| `fetchPostMetrics` returns a `PostMetrics` object | success | yes | yes | **yes** | `synced` |
| `fetchPostMetrics` returns `null` (platform hasn't exposed metrics yet) | no data | yes | **no** (don't write an empty row) | no | `skippedNoData` |
| throws `NOT_IMPLEMENTED` | platform unsupported (D0) | first per platform only; rest short-circuited | no | no | `skippedNotImplemented` |
| no active social account for `(business_id, platform)` | no account | no | no | no | `skippedNoAccount` |
| throws `TOKEN_REVOKED` | skipped (never mutate an already-published post) | yes | no | no | `errors` |
| throws `TOKEN_EXPIRED` | skipped (A2 — no refresh, no retry) | yes | no | no | `errors` |
| throws `RATE_LIMITED` / `NETWORK` / `PLATFORM_REJECTED` / `PROVIDER_NOT_CONFIGURED` / `UNKNOWN` | error; log + move on; no requeue | yes | no | no | `errors` |

Notes:

- `TOKEN_REVOKED` and `TOKEN_EXPIRED` are counted as `errors` (a transient sync miss), **not** `failed` — there is no `failed` state for metrics. The worker never touches the `posts` row regardless.
- All `errors`-class outcomes are best-effort: the post stays stale and is retried next tick. A permanently failing post simply ages out past `METRICS_MAX_AGE_DAYS` and drops out of the candidate set (§13).

---

## 6. Metric mapping

`PostMetrics` (ADR 0002 metrics shapes) → `PostMetricsInsert` (`lib/db/types.ts`), field-by-field, with the **null-vs-zero rule** as a hard invariant:

- `PostMetrics.x === null` → column `NULL` ("platform does not expose this metric").
- `PostMetrics.x === 0` → column `0` (a real value — e.g. a post with zero likes).
- **Never coalesce.** No `?? 0`, no `|| 0`, no `Number(x)` that turns `null` into `0`. The distinction is load-bearing: the future analytics dashboard must distinguish "not exposed" from "zero" (ADR 0001 §6, ADR 0002 metrics shapes).

`last_synced_at = fetchedAt` (the provider's `PostMetrics.fetchedAt` ISO string). `post_id` and `business_id` come from the candidate post row. Upsert is `ON CONFLICT (post_id) DO UPDATE` (the `UNIQUE(post_id)` constraint, ADR 0001 §6).

This rule is pinned as an explicit reviewer check **and** a mixed-payload round-trip test (§12), not merely a mapping convention.

---

## 7. Orchestrator API

TypeScript signatures only. Builder writes the file. New module `/lib/metrics/orchestrator.ts` (mirrors `/lib/publishing/orchestrator.ts`).

```ts
// /lib/metrics/orchestrator.ts (new file — Builder)

export interface MetricsSyncTickSummary {
  tick: string                    // ISO timestamp at tick start
  durationMs: number
  candidates: number              // rows returned by listPostsForMetricsSync
  synced: number                  // upserts written (last_synced_at advanced)
  skippedNotImplemented: number   // D0 — incl. short-circuited rows
  skippedNoData: number           // provider returned null
  skippedNoAccount: number        // no active social account for (business, platform)
  errors: number                  // all SocialProviderError codes except NOT_IMPLEMENTED
}

export function runMetricsSyncTick(opts?: {
  now?: Date
  batchSize?: number
}): Promise<MetricsSyncTickSummary>
```

`runMetricsSyncTick` claims its own service-role client (lazy import), calls `listPostsForMetricsSync`, iterates a local `syncOne` that owns the §5 outcome matrix and the D0 per-platform short-circuit (a `Set<Platform>` of platforms marked `unsupported` this tick), accumulates the counters, and emits one summary log line. There is **no `refreshed` field** (A2).

---

## 8. `/lib/db` additions

```ts
// New service-role read helper in /lib/db/posts.ts

export function listPostsForMetricsSync(
  client: ServiceRoleClient,
  opts: {
    now: Date
    staleMinutes: number
    maxAgeDays: number
    limit: number
  }
): Promise<PostRow[]>
// Returns published posts due for a metrics sync per the §4 predicate.
// Left-joins post_metrics so never-synced posts are included.
// ORDER BY last_synced_at NULLS FIRST. Read-only; takes the caller's client.
```

`upsertPostMetrics` **already exists** from Session 2D (`lib/db/post-metrics.ts:4`): `upsertPostMetrics(data: PostMetricsInsert): Promise<PostMetricsRow>`, `onConflict: 'post_id'`. The Builder **verifies and reuses** it — it does not create a new function. Per the existing convention it keeps its **no-`client` signature** (acquires its own service-role client internally); only the read helper (`listPostsForMetricsSync`) takes the orchestrator's client. This minor asymmetry already exists in the codebase (`listStalePostMetrics` takes a client; `upsertPostMetrics` does not) and is preserved intentionally.

`socialAccountId` resolution mirrors the publishing worker: `getActiveByBusinessAndPlatform(client, post.business_id, post.platform)`; a missing/inactive account → `skippedNoAccount`. `platformPostId` comes from `post.platform_post_id`.

---

## 9. Cron route contract

`/app/api/cron/sync-metrics/route.ts`. Builder creates it. The contract is **identical to ADR 0005 §12** except for the deltas below — refer to §12, do not restate.

**Deltas from ADR 0005 §12:**

- **Method/auth:** unchanged — `GET`, `CRON_SECRET` `timingSafeEqual` + length pre-check, dev-bypass header (`X-Cron-Dev-Trigger: true`) honoured only when `NODE_ENV !== 'production'`, single generic `Unauthorized` 401 body.
- **Phases:** there is no Phase A / Phase B split. One call: `runMetricsSyncTick({ now, batchSize: METRICS_SYNC_BATCH_SIZE })`.
- **Response body:** `{ tick, metrics: <MetricsSyncTickSummary> }`. Always `200`; on internal throw, catch and return `200` with `metrics: null` + a top-level `error` field (same swallow-and-log policy as ADR 0005 §12).
- **`maxDuration = 60`** on Pro (`30` on Hobby — §10).

The route is auth + one orchestrator call + response. No logic.

---

## 10. `vercel.json`

Append a second cron entry (additively — **do not** touch the existing publish entry):

```json
{
  "crons": [
    { "path": "/api/cron/publish",      "schedule": "* * * * *" },
    { "path": "/api/cron/sync-metrics", "schedule": "0 * * * *" }
  ]
}
```

Hourly (`0 * * * *`) is deliberate. Wiring exercised end-to-end from day one is the point; at hourly cadence the wired-but-inert cost (§1) is negligible — one candidate query plus, thanks to the D0 short-circuit, at most one throwing probe per platform per tick.

**Hobby fallback (one-line deploy-README guidance, NOT code — ADR 0005 §13 style):**
> On Hobby plans, keep `"0 * * * *"` and set `maxDuration = 30` on the route.

---

## 11. Configuration

Three new **optional** entries in `/lib/config.ts` (typed access; no `process.env.*` outside that file). No new **required** env var — `CRON_SECRET` is reused from ADR 0005 §14.

| Var | Default | Required | Notes |
|---|---|---|---|
| `METRICS_SYNC_BATCH_SIZE` | `50` | No | Per-tick candidate limit. |
| `METRICS_STALE_MINUTES` | `360` | No | A synced post is re-synced once its metrics are older than this (6h). |
| `METRICS_MAX_AGE_DAYS` | `90` | No | Posts published longer ago than this are no longer synced (deliberate launch value; tune down later). |

---

## 12. Testing strategy

All tests use `MockProvider` (ADR 0002 §6). No live Postiz, no real network.

**Outcome-matrix unit tests (one per row of §5):**

| Test | Asserts |
|---|---|
| Success path | `MockProvider` default zeros → `post_metrics` row upserted; `synced === 1`; `last_synced_at` advanced |
| `NOT_IMPLEMENTED` skip | `MockProvider({ errorCode: 'NOT_IMPLEMENTED' })` → `skippedNotImplemented` incremented; no upsert; post stays stale |
| **Per-platform short-circuit** | Seed **N posts on the same platform**, provider throws `NOT_IMPLEMENTED`. Assert **exactly ONE** `fetchPostMetrics` call (via `mock.calls.fetchPostMetrics`) for all N; `skippedNotImplemented === N` |
| `null`-return skip | provider returns `null` → `skippedNoData`; **no** `post_metrics` row written (assert absence) |
| `skippedNoAccount` | published post whose `(business, platform)` has no active account → `skippedNoAccount`; no provider call |
| `TOKEN_EXPIRED` / `TOKEN_REVOKED` | counted under `errors`; post unchanged; **no** refresh call made (assert `mock.calls.refreshAccessToken` empty — A2) |
| `RATE_LIMITED` / `NETWORK` / `PLATFORM_REJECTED` / `UNKNOWN` | `errors` incremented; no upsert; no requeue |

**Null-vs-zero round trip (load-bearing — D12):** drive `MockProvider` with a **mixed payload** (e.g. `likes: 5, comments: 0, shares: null`), run a tick, read the row back, assert `likes === 5`, `comments === 0`, **`shares === null`**. Explicitly assert no `?? 0` coalescing occurred.

**Candidate selection tests:**

| Test | Asserts |
|---|---|
| Never-synced inclusion | `published` post with **no** `post_metrics` row is returned (left join works), ordered first |
| Staleness window exclusion | post synced `< METRICS_STALE_MINUTES` ago is **excluded** |
| Staleness inclusion | post synced `> METRICS_STALE_MINUTES` ago is **included** |
| `MAX_AGE_DAYS` exclusion | post `published_at` older than `METRICS_MAX_AGE_DAYS` is **excluded** even if never synced |
| Allow-list / status | non-`published` rows, instagram/facebook/threads rows, and `deleted_at` rows are excluded |

**Route handler tests (reuse ADR 0005 §15 route cases):** missing / wrong / wrong-length secret → `401`; dev-bypass header in non-prod → `200`; **dev-bypass header in production → `401`**; internal throw → `200` with `error` field.

---

## 13. Accepted tech debt

Explicit, conscious deferrals — not oversights.

- **Wired-but-inert in Phase 1 production.** Every production tick is all-`skippedNotImplemented` until a native provider implements `fetchPostMetrics`. This is healthy (§1), not degraded.
- **Best-effort sync, no alerting.** A post that fails to sync (any `errors`-class outcome) simply stays stale and retries next tick. A permanently failing post ages out past `METRICS_MAX_AGE_DAYS` with no alert. Acceptable until a logger/alerting surface exists (§15).
- **No per-platform rate budget.** The worker makes one `fetchPostMetrics` call per candidate (bounded by `METRICS_SYNC_BATCH_SIZE`). No token-bucket / fairness logic. Fine at Phase 1 volume; revisit when a native provider with real rate limits lands.
- **Deferred index.** `(published_at) WHERE status = 'published'` is not created (§15). At Phase 1 volume a seq scan over the small `published` set is cheaper than write amplification on every publish.

---

## 14. Out of scope

- Analytics dashboard UI that reads `post_metrics`.
- `post_metrics_history` (time-series snapshots) — ADR 0001 §6 chose upsert-in-place for Phase 1.
- Native per-platform metrics providers (the implementations of `fetchPostMetrics`).
- Engagement ingestion (`fetchEngagement` — a separate worker, a future ADR).
- Backfill tooling for posts that aged out past `METRICS_MAX_AGE_DAYS`.

---

## 15. Open follow-ups

- **Implement `PostizProvider.fetchPostMetrics` (or a native provider's).** The payoff: this worker goes live with **zero worker changes** — the candidate query, outcome matrix, mapper, route, and cron are all already in place. Only the provider method changes.
- **`(published_at) WHERE status = 'published'` partial index.** Add when the `published` row count makes the candidate-query seq scan measurable.
- **`skippedNotImplemented`-vs-`errors` alerting threshold.** Once a structured logger/Sentry exists, alert when `errors` rises while `skippedNotImplemented` is expected to be the dominant outcome — distinguishes "provider not yet built" (healthy) from "provider built but breaking" (degraded).
- **`post_metrics_history`** when trend charts (beyond "current vs last sync") are needed.

---

## Amendment 1 — Trigger Source (2026-06-04)

**Status:** Accepted
**Date:** 2026-06-04
**Scope:** trigger source only — auth path, route method, and `vercel.json` `crons` entry for `/api/cron/sync-metrics`. Orchestrator behaviour (`runMetricsSyncTick`, candidate selection, null-vs-zero contract, outcome matrix, allow-list, `cron_health` writes), response shape, Sentry `withMonitor` wrapping, and `maxDuration` are **unchanged**.
**Reversed by:** _(none)_

All trigger-source rules — hard env-driven branch on `config.server.CRON_TRIGGER`, lexical unreachability of dev-bypass under QStash mode, route diff minimality, the `/lib/cron/qstash-auth.ts` helper contract, split `GET` (`'secret'`) / `POST` (`'qstash'`) handlers with 405 on the wrong-mode method, `CRON_SECRET` retained for preview/dev, `REDACTED_KEYS` additions, required tests, and rollback procedure — are **governed by ADR 0005 Amendment 1**. This amendment lists only the metrics-worker-specific deltas; it does not restate the shared rules. Mirrors how §9 of this ADR references ADR 0005 §12.

**Metrics-worker-specific deltas.** (1) The `vercel.json` change is symmetric to ADR 0005 Amendment 1 §6 — when `CRON_TRIGGER=qstash` in the target environment, the `/api/cron/sync-metrics` entry is removed from `vercel.json` for that deploy, and restored from `docs/build-guide/runbooks/vercel-cron-restore.md` on the Pro-tier flip. The cadence `0 * * * *` is **preserved** in both modes (Vercel Cron schedule and QStash schedule fire identically). (2) The per-tick structured log (`kind: 'metrics-sync-tick'`) gains the `triggeredBy: config.server.CRON_TRIGGER` field. The QStash-branch `cron-auth-failure` warn uses `route: 'sync-metrics'`, `trigger: 'qstash'`; everything else in §5.2 of ADR 0005 Amendment 1 applies verbatim.

**No Phase A/B split — body QStash POSTs is irrelevant.** ADR 0006 §9 already states that the route ignores its request body in Phase 1 (no per-platform body schema, no replay-of-failed-candidates surface). QStash's POST body is therefore inert from the orchestrator's perspective: `verifyQStashRequest` reads the raw body once for signature verification (ADR 0005 Amendment 1 §3) and discards it; `runMetricsSyncTick` continues to drive candidate selection entirely from `posts` and `post_metrics`. No Phase A/B body-schema split is introduced or implied.
