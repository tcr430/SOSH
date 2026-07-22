# Session 10 — Scheduler and Publisher

> **Goal:** The publishing worker. A Vercel Cron job ticks every minute, claims approved posts whose `scheduled_at` is due, calls `provider.publish()` through the SocialProvider abstraction, and transitions row state. Per-post retry budget, token-expiry refresh, rate-limit re-queue, dead-letter on terminal failure. Same cron also janitors stale `post_generation_sessions` rows (deferred from Session 8). When this session lands, a campaign goes end-to-end: create → generate → review → approve → published, without a human after the approval click.
> **Time:** 5–7 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction (Sonnet 4.6)
> **Plugins:** ECC throughout, claude-mem automatic, frontend-design skill active for the campaign-detail publishing-status surface
> **Session structure:** Three separate Claude Code sessions with `/exit` between each. Plus an expected correction pass (Session 10D) after the reviewer surfaces issues.

---

## Why three sessions remain mandatory here

Session 3 (SocialProvider) and Session 8 (post generation) both produced 8–10 reviewer findings that single-session work would have shipped. The publishing worker is the same level of consequential and arguably higher-blast-radius: a bug here publishes the wrong content, double-publishes (duplicate posts visible to the user's audience), publishes to the wrong tenant's social account, or leaks rate-limit traffic that gets our app suspended from a platform. The error-handling matrix alone (seven `SocialProviderError` codes × four status outcomes × token-refresh interactions) is too dense to wing in a Builder session.

Three sessions, mandatory pause after Architect.

---

## What this session builds and what it doesn't

**Builds:**
- ADR 0005 — Publishing Worker architecture (Architect output, no code)
- Migration (timestamp-based) — `posts.publish_attempts`, `posts.last_publish_attempt_at`, `posts.last_publish_error`; SECURITY DEFINER `claim_posts_for_publishing` RPC
- `/lib/db/posts.ts` additions — `claimPostsForPublishing`, `markPostPublished`, `markPostFailed`, `requeueScheduledPost` (with `incrementAttempts` flag), `reapStuckScheduledPosts` (with STUCK_TERMINAL path), `incrementPublishedCountForCampaign`
- `/lib/db/post-generation-sessions.ts` addition — `recoverStuckGenerationSessions` (janitor)
- `/lib/publishing/orchestrator.ts` — `runPublishTick` + `runJanitorTick`: claim → publish → handle each error code → transition state → write audit trail
- `/app/api/cron/publish/route.ts` — Vercel Cron entry point (GET handler, CRON_SECRET-gated)
- `vercel.json` — single cron schedule registration (`* * * * *` on Pro, `*/5 * * * *` on Hobby)
- `CRON_SECRET` config + a local-dev manual-trigger header
- Small UI updates on `/campaigns/[id]` and `/campaigns/[id]/posts` — "next publish" hint, "publishing now" pulse, post-card status tiles for `scheduled` / `published` / `failed`
- i18n keys for the new statuses (EN/PT/ES)

**Defers:**
- Metrics worker (separate cron, separate session — Session 11 or later)
- Engagement worker
- Dead-letter inspection UI (a post in `failed` state is visible on the posts page; a dedicated "retry failed posts" admin tool is Phase 2)
- Native per-platform providers (Postiz only, per ADR 0002)
- Distributed advisory lock on token refresh (accepted tech debt per ADR 0002 §8)
- Per-business per-platform fair-share queueing (FIFO `scheduled_at` order is acceptable for Phase 1 volume)

---

## Pre-session checklist

- [ ] Session 9 fully complete — Session 9D corrections applied, 488/488 tests passing
- [ ] At least one campaign exists with *approved* posts on **LinkedIn or X** (Instagram/Facebook/Threads posts will be claim-skipped per ADR 0002 §5)
- [ ] Postiz is reachable from your machine (`curl -fsS $POSTIZ_BASE_URL/health` returns 2xx) **OR** `SOCIAL_PROVIDER_MODE=mock` is set so the worker uses MockProvider
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/campaigns lib/ai lib/db lib/social` passes
- [ ] `claude-mem` running at http://localhost:37777
- [ ] Vercel project linked (`vercel link`), and you know whether you're on Hobby or Pro (changes the cron cadence — see §3 of the ADR)
- [ ] You skimmed [Vercel Cron docs](https://vercel.com/docs/cron-jobs) for 10 min — what you're integrating with

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
Read /docs/decisions/0001-database-schema.md §B.5 (posts table,
status machine, indexes), §E (indexes catalogue).
Read /docs/decisions/0002-social-provider.md in full
(especially §3 error taxonomy, §5 PostizProvider, §8 token refresh,
§9 singleton factory; "Out of scope" notes the publishing worker
is THIS session).
Read /docs/decisions/0004-post-generation.md §15 (deferred
generation-session janitor — folded into this cron).

Skim /lib/social/index.ts, /lib/social/types.ts,
/lib/social/postiz-provider.ts, /lib/social/errors.ts,
/lib/db/posts.ts (note the existing listPostsDue helper from
Session 9D), /lib/db/post-generation-sessions.ts,
/lib/db/campaigns.ts, /lib/social/platforms/config.ts
(note publishingAvailableFor — Phase 1 = linkedin + twitter only).

Session 10 Part A — Publishing Worker Architecture. Architect role.

ARCHITECT BOUNDARY (strict, learned from Sessions 2 and 3):
- Your only output is /docs/decisions/0005-publishing-worker.md
- No SQL files. No TypeScript files. No vercel.json. No env
  changes. No code beyond TypeScript signatures inside the
  markdown document.
- Your last action is a single confirmation line. Then I /exit.
- Do not attempt to "kick off" the Builder.

Use the architect ECC agent mindset:
1. List your key design decisions and any ambiguities
2. Wait for me to approve / override / clarify
3. Only then write the document
4. Call out any reversals of earlier decisions explicitly so
   they don't get buried in the ADR (e.g. if you propose using
   columns rather than ai_generation_metadata jsonb for retry
   tracking, flag this prominently as it diverges from how
   Session 8 stored generation metadata)

Acknowledge, list your planned decisions, wait for my approval.
```

### Decision list — confirm these before approving

The Architect will surface its own list. The points below are the ones you must see addressed and the answers you should expect. If the Architect proposes something materially different, push back before paste-approving.

| # | Question | Expected answer |
|---|---|---|
| 1 | Cron cadence | `* * * * *` (every minute) on Pro; `*/5 * * * *` on Hobby. Configurable via `vercel.json`. Pick the highest cadence the plan allows so `scheduled_at` precision is honoured. |
| 2 | Claim atomicity | SECURITY DEFINER `claim_posts_for_publishing(p_now, p_limit)` RPC with inner `FOR UPDATE SKIP LOCKED` subquery. Outer `WHERE status='approved'` guard is the atomic lock. In migration, `REVOKE ALL FROM public; GRANT EXECUTE TO service_role`. |
| 3 | Per-invocation budget | `PUBLISH_BATCH_SIZE = 25` env-driven default. |
| 4 | Function maxDuration | `60` seconds (Pro) / `30` (Hobby). Asserted in the route handler config. |
| 5 | Retry tracking | Three new columns: `publish_attempts INT NOT NULL DEFAULT 0`, `last_publish_attempt_at TIMESTAMPTZ NULL` (doubles as claim timestamp — no separate `claimed_at`), `last_publish_error TEXT NULL` (free-form: error codes + synthetic codes like `STUCK_REAPED`). |
| 6 | Max attempts | `PUBLISH_MAX_ATTEMPTS = 5`. Terminal `failed` on exhaustion. Reaper also honours this ceiling (STUCK_TERMINAL path). |
| 7 | Backoff | NETWORK: `base * 2^(publish_attempts) * (1 ± 25% jitter)`, base = `PUBLISH_RETRY_BACKOFF_SECONDS` (60s). `RATE_LIMITED` uses `retryAfterSeconds` verbatim (no jitter). `TOKEN_EXPIRED` → in-tick refresh+retry (no requeue, no attempt increment). `TOKEN_REVOKED`, `PLATFORM_REJECTED`, `BAD_REQUEST`, `NOT_CONFIGURED`, `UNKNOWN` → terminal `failed`. |
| 8 | Token-expired flow | Worker catches `TOKEN_EXPIRED`, calls `provider.refreshAccessToken({ socialAccountId })`, then retries publish once same tick. Per-tick `Set<string>` loop guard prevents re-refresh of the same account. Second failure → terminal `failed` with code `TOKEN_REVOKED`. `publish_attempts` never incremented on TOKEN_EXPIRED paths. |
| 9 | Status transitions | `approved → scheduled` on claim; `scheduled → published` on success; `scheduled → failed` on terminal; `scheduled → approved` (bumped `scheduled_at`) on RATE_LIMITED/NETWORK retry; `scheduled → approved` (STUCK_REAPED) or `scheduled → failed` (STUCK_TERMINAL) by reaper. |
| 10 | Stuck-scheduled recovery | `reapStuckScheduledPosts` — two statements per tick: (1) rows with `last_publish_attempt_at` stale AND attempts < MAX → back to `approved`, `publish_attempts + 1`, `last_publish_error = 'STUCK_REAPED'`; (2) same stale condition AND attempts >= MAX → terminal `failed` with `STUCK_TERMINAL`. Runs BEFORE claim. |
| 11 | Idempotency on partial success | NO short-circuit guard. Accepted tech debt: crash between `provider.publish()` success and DB write may produce a duplicate. Bounded by `PUBLISH_STUCK_MINUTES = 10` being well above p99 latency. Documented in ADR §16. |
| 16 | Janitor — stuck `generating` | Same cron route, Phase A.1. `post_generation_sessions WHERE status='generating' AND started_at < now() - POST_GENERATION_SESSION_STALE_MINUTES` → `failed`, `error_code='timeout'`. Default **15 minutes** (not 10). |
| 17 | Observability | One `console.log(JSON.stringify({ kind: 'publish_tick', ...summary }))` per tick. Per-post error details written to `ai_generation_metadata.publish_error` (sanitised via `redactTokens`). No per-post logging. |
| 18 | Test strategy | MockProvider with FailureConfig. Every error code has a dedicated test. Refresh-loop guard tested (two posts, same socialAccountId, both throw TOKEN_EXPIRED). STUCK_TERMINAL path tested. Platform gate tested. |
| 19 | Module location | `/lib/publishing/orchestrator.ts` (exports `runPublishTick` + `runJanitorTick`). No `/lib/workers/` directory. Route handler calls `reapStuckScheduledPosts` directly (Phase A.2) and passes `reaped` count to `runPublishTick` via `opts.reaped`. |
| 20 | Service-role pattern | Workers use the service-role client (CLAUDE.md explicitly lists "the publishing worker" as authorised). Lazy import per CLAUDE.md pattern. RLS is bypassed because the cron is not a user request — but the claim query still filters by status/platform so it never touches another tenant's drafts. |

### Architect Prompt (after you approve the decision list)

> **Note:** Paste this only after you've confirmed the Architect's D1–D15 plan against the decision table above. This prompt is the lock-in: it approves D1–D15 with specific overrides on Q1–Q6 and one consequential override on D5 (TOKEN_EXPIRED).

```
Approved to write /docs/decisions/0005-publishing-worker.md.

Your D1–D15 plan is accepted with the following locked answers
to Q1–Q6 and overrides below. Do not re-open any of these in
the ADR — write them in as decisions, not options.

Q1 — Columns over jsonb. Confirmed. Surface as REVERSAL 1.
Q2 — `failed` stays terminal. Confirmed. Surface as REVERSAL 2
     (the ADR 0001 §B.5 diagram annotation "(re-queue back to
     scheduled)" was speculative; lib/db/posts.ts is the source
     of truth). User-triggered "retry from failed" is Phase 2 —
     list in open follow-ups.
Q3 — Stay `scheduled` on function timeout; rely on reaper.
     Document the 10-minute observable-latency consequence in
     the accepted-tech-debt section.
Q4 — Same cron route, two phases.
Q5 — /app/api/cron/publish/route.ts (no underscore prefix).
Q6 — Default to `* * * * *` with maxDuration = 60 (Pro).
     Document the Hobby fallback (`*/5 * * * *`, maxDuration = 30)
     in the vercel.json section as a one-line conditional.

OVERRIDE on D5 — TOKEN_EXPIRED uses in-tick refresh+retry,
NOT a requeue. ADR 0002 §8's withFreshToken does PROACTIVE
refresh (5-min skew window), not reactive retry-on-401.
ADR 0002 §5 explicitly states the worker owns the
refresh-and-retry on TOKEN_EXPIRED. Spec it as:

  1. Catch TOKEN_EXPIRED in publishOne
  2. Maintain a per-tick Set<string> of socialAccountIds that
     have been refreshed this tick (loop guard)
  3. If this account is not yet in the Set:
     - await provider.refreshAccessToken({ socialAccountId })
     - Add socialAccountId to the Set
     - Retry provider.publish(input) ONCE, same tick
     - publish_attempts is NOT incremented (refresh is a
       precondition fix, not a publish failure)
  4. If retry still throws TOKEN_EXPIRED:
     terminal failed, last_publish_error = 'TOKEN_REVOKED',
     ai_generation_metadata.publish_error.reason = 'refresh_failed'
  5. If TOKEN_EXPIRED arrives on a row whose account is already
     in the Set (loop guard hit):
     terminal failed, reason = 'refresh_loop'

A 60-second requeue is observable user latency for no benefit;
refresh + retry costs sub-second and gets the post published
immediately.

ADDITIONAL OVERRIDES on D5 and elsewhere:

- NETWORK backoff includes ± 25% jitter:
  newScheduledAt = now + base * 2^(attempts) * (1 + (random()*0.5 - 0.25))
  with base = PUBLISH_RETRY_BACKOFF_SECONDS (60). Prevents
  thundering-herd if a platform outage hits multiple businesses
  at the same scheduled minute.

- PUBLISH_MAX_ATTEMPTS = 5 (not 3). Spans ~15 minutes total
  with the 60s base, more lenient on transient platform issues.

- Drop the cross-tick "platform_post_id short-circuit"
  entirely. On reflection it provides no real protection
  against the crash-between-publish-and-DB-write scenario —
  the platformPostId is in memory at crash time, never
  persisted. Your D9 framing (accepted tech debt, bounded by
  PUBLISH_STUCK_MINUTES well above p99 latency) is the honest
  position. Do NOT spec a shortCircuitAlreadyPublished helper.

- Dev-trigger bypass: the cron route accepts
  X-Cron-Dev-Trigger: true when NODE_ENV !== 'production'
  (no CRON_SECRET required in dev). Production MUST NOT honour
  this header. Spec in the cron route contract.

ADDITIONAL OPEN FOLLOW-UP to add at the bottom:

- PostizProvider's PublishResult.platformPostId extraction
  depends on the Postiz adapter and the platform response
  shape (LinkedIn URN vs X tweet ID vs Postiz internal post
  ID). If it ends up as an opaque Postiz internal ID rather
  than the actual platform-side ID, the "open on platform"
  UI link breaks and any future native-provider replacement
  loses the audit trail. This is a PostizProvider contract
  requirement (Session 3/6 surface), not a worker concern —
  but Session 6's integration must be re-verified before the
  first production cron tick. Flag as a pre-production check.

- Defer the partial index (status, last_publish_attempt_at)
  WHERE status='scheduled' until in-flight `scheduled` row
  count exceeds ~1000. Note in open follow-ups.

────────────────────────────────────────────────────────────

The ADR must contain, in this order:

1. REVERSALS SECTION (top, prominent)
   - REVERSAL 1: Retry tracking columns over jsonb
   - REVERSAL 2: `failed` stays terminal vs ADR 0001 §B.5
     diagram annotation
   - REVERSAL 3: posts.scheduled_at is now mutable — the
     worker bumps it on RATE_LIMITED and NETWORK retry.
     Future sessions must NOT treat scheduled_at as immutable.

2. CONTRACT BOUNDARIES
   - Surface: cron route → orchestrator → /lib/social/ + /lib/db/
   - Worker MAY NOT: write content (no transforms), call
     /lib/ai/, touch vault directly, use the anon client.

3. STATUS MACHINE
   Full diagram with every edge labelled (actor, trigger).
   Cover: approved → scheduled (claim); scheduled → published
   (publish OK or refresh+retry OK); scheduled → approved
   (RATE_LIMITED or NETWORK with attempts < MAX, scheduled_at
   bumped); scheduled → failed (any terminal); scheduled →
   approved (reaper, last_publish_attempt_at stale).

4. CLAIM QUERY
   Full SQL from your D7 (UPDATE…RETURNING with FOR UPDATE
   SKIP LOCKED subquery) wrapped in a SECURITY DEFINER
   function granted to service_role only. Confirm the existing
   partial index from ADR 0001 §E covers the claim path
   (per your D15 — yes, no new index needed for claim).

5. ERROR MATRIX
   Table with one row per SocialProviderErrorCode (all 8 from
   ADR 0002 §3). Columns: cause / in-tick action / next-tick
   state / publish_attempts change / user-visible signal.
   TOKEN_EXPIRED row follows the in-tick refresh+retry spec
   above, NOT a requeue.

6. RETRY POLICY
   - PUBLISH_MAX_ATTEMPTS = 5
   - NETWORK backoff: 60 * 2^(attempts) * (1 + (random()*0.5 - 0.25))
   - RATE_LIMITED: verbatim retryAfterSeconds, attempts NOT
     incremented (platform-induced)
   - TOKEN_EXPIRED: in-tick refresh+retry, attempts NOT
     incremented
   - The single attempt-counter increment site (only on
     NETWORK with attempts < MAX, and on terminal failure
     mark — be explicit about which path increments)

7. IDEMPOTENCY MODEL
   - In-tick: atomic claim via FOR UPDATE SKIP LOCKED
     eliminates concurrent claims
   - Cross-tick: NO short-circuit guard. Accepted Phase 1
     tech debt: a worker that crashes between platform call
     success and DB write may produce a duplicate post on
     reaper retry. Bounded by PUBLISH_STUCK_MINUTES = 10
     being well above p99 publish latency.
   - Refresh races: ADR 0002 §8 accepted tech debt —
     restate.

8. RECOVERY PATHS
   - Stuck `scheduled` reaper (last_publish_attempt_at older
     than PUBLISH_STUCK_MINUTES → revert to approved, one
     retry consumed)
   - Stuck `generating` janitor (ADR 0004 §15 deferral —
     post_generation_sessions where status='generating' AND
     started_at < now() - POST_GENERATION_SESSION_STALE_MINUTES
     → failed, error_code='timeout')
   Both run as Phase A of every tick, before the claim query.

9. SCHEMA CHANGES — migration <next available, confirm by
   reading /supabase/migrations/; likely 030>
   ALTER TABLE posts ADD COLUMN:
     publish_attempts int NOT NULL DEFAULT 0
     last_publish_attempt_at timestamptz NULL
     last_publish_error text NULL
   CHECK constraints (defensive):
     publish_attempts >= 0
     publish_attempts <= 10  -- 5 is runtime limit, 10 is hard ceiling
   (No claimed_at column — last_publish_attempt_at doubles as
   the claim timestamp since claim sets it.)
   SECURITY DEFINER function claim_posts_for_publishing(
     p_now timestamptz, p_limit int
   ) RETURNING SETOF posts — the full claim SQL from §4.
   REVOKE ALL FROM public; GRANT EXECUTE TO service_role.
   No RLS policy changes (service-role bypasses).
   No new index for claim (D15); the stuck-reaper index is
   deferred per open follow-up.

10. WORKER ORCHESTRATOR API (TypeScript signatures, in code
    blocks — no .ts files):

    runPublishTick(opts?: { now?: Date; batchSize?: number }):
      Promise<PublishTickSummary>

    runJanitorTick(opts?: { now?: Date }):
      Promise<JanitorTickSummary>

    PublishTickSummary: tick (ISO), durationMs, claimed,
      published, failed, retried, refreshed, reaped.

    JanitorTickSummary: tick, durationMs,
      stuckGenerationSessionsReaped.

11. /lib/db/posts.ts ADDITIONS — signatures only:
    - claimPostsForPublishing(client, limit): Promise<PostRow[]>
      (calls the SECURITY DEFINER function via rpc)
    - markPostPublished(client, postId, { platformPostId,
      platformUrl, publishedAt }): Promise<PostRow>
    - markPostFailed(client, postId, { errorCode, errorDetails }):
      Promise<PostRow>
    - requeueScheduledPost(client, postId, { newScheduledAt,
      errorCode, errorDetails, incrementAttempts: boolean }):
      Promise<PostRow>
    - reapStuckScheduledPosts(client, { now, stuckMinutes }):
      Promise<number>
    - incrementPublishedCountForCampaign(client, campaignId):
      Promise<void>
    All writes use service-role via lazy import. All state
    transitions are atomic conditional UPDATEs with
    .eq('status', '<expected>').

12. CRON ROUTE CONTRACT — /app/api/cron/publish/route.ts
    Method: GET. Vercel Cron sends Authorization: Bearer
    ${CRON_SECRET}. Compare with crypto.timingSafeEqual after
    a length pre-check.
    Dev bypass: X-Cron-Dev-Trigger: true when
    NODE_ENV !== 'production'. Production must NEVER honour
    this header.
    Phase A: runJanitorTick + reapStuckScheduledPosts.
    Phase B: runPublishTick.
    Response: 200 always (cron log is observability), body:
      { tick, janitor: JanitorTickSummary, publish: PublishTickSummary }
    maxDuration = 60 (Pro) or 30 (Hobby).
    401 body MUST NOT distinguish "wrong secret" from
    "missing header" — generic "Unauthorized" only.

13. VERCEL.JSON CONTRACT
    {
      "crons": [
        { "path": "/api/cron/publish", "schedule": "* * * * *" }
      ]
    }
    Hobby fallback: schedule "*/5 * * * *". One line of
    user-facing guidance, not a branching decision in code.

14. CONFIGURATION — new vars in /lib/config.ts:
    - CRON_SECRET (server, required in production; min 32 chars
      validated at boot; optional in dev)
    - PUBLISH_BATCH_SIZE (default 25)
    - PUBLISH_MAX_ATTEMPTS (default 5)
    - PUBLISH_RETRY_BACKOFF_SECONDS (default 60)
    - PUBLISH_STUCK_MINUTES (default 10)
    - POST_GENERATION_SESSION_STALE_MINUTES (default 15)

15. TESTING STRATEGY
    - MockProvider with FailureConfig per error code
    - Each error code has a dedicated test
    - TOKEN_EXPIRED → refresh → success: assert
      summary.refreshed === 1, publish_attempts unchanged
    - TOKEN_EXPIRED → refresh → TOKEN_EXPIRED: assert terminal
      failed with reason 'refresh_failed'
    - Refresh loop guard: two posts for same socialAccountId
      both throwing TOKEN_EXPIRED — second one hits
      'refresh_loop'
    - NETWORK backoff jitter: assert newScheduledAt within
      jitter window
    - RATE_LIMITED: verbatim retryAfterSeconds, attempts
      NOT incremented
    - Reaper-before-claim ordering: stuck scheduled row +
      fresh approved row, both end up published in one tick
    - Platform gate: approved instagram post is NOT in
      claim results
    - Route handler: 401 on missing/wrong secret, timing-safe
      compare, dev bypass works in non-prod, dev bypass
      REJECTED in prod
    - Janitor: stuck `generating` (>15 min) → flipped to
      failed; fresh `generating` (<15 min) → untouched

16. ACCEPTED TECH DEBT
    - Crash-between-publish-and-DB-write may duplicate (D9)
    - Refresh race (ADR 0002 §8)
    - Function-timeout overflow: rows stay `scheduled`,
      reclaimed by reaper after PUBLISH_STUCK_MINUTES — 10 min
      observable latency in the worst case

17. OUT OF SCOPE
    - Metrics worker (separate cron, future session)
    - Engagement worker
    - Dead-letter / "Retry from failed" UI (Phase 2)
    - Platform-side idempotency keys (Postiz extension)
    - Per-business fairness queue
    - Distributed advisory lock on refresh
    - Sentry / structured logger

18. OPEN FOLLOW-UPS for future ADRs
    - User-triggered "retry from failed" action (Phase 2)
    - Native LinkedIn / X providers replacing Postiz
    - PostizProvider.publish must return the actual
      platform-side ID in PublishResult.platformPostId, not
      a Postiz internal ID — verify Session 6 integration
      before first production cron tick
    - Partial index (status, last_publish_attempt_at)
      WHERE status='scheduled' once in-flight count exceeds ~1000
    - Thread-of-tweets representation if structured threads
      land (ADR 0004 §16 follow-up)

────────────────────────────────────────────────────────────

CRITICAL — ARCHITECT BOUNDARY:
- Do NOT create any .ts files
- Do NOT create any .sql files
- Do NOT touch vercel.json
- Do NOT run any commands
- Do NOT install any packages
- TypeScript signatures appear as code blocks INSIDE the
  markdown only
- If you find yourself about to create a file or run a
  command, stop and output only: "Stopping — architect boundary."

After saving the markdown, write exactly one line:
"ADR 0005 complete. Architect session done."
Then stop. Do nothing else. Do not suggest next steps.
```

### After Part A

- [ ] `/docs/decisions/0005-publishing-worker.md` exists
- [ ] **Three** reversals at the top: columns-over-jsonb, `failed` terminal, `scheduled_at` mutable
- [ ] Complete status-machine diagram with every edge labelled
- [ ] Claim query SQL uses SECURITY DEFINER + `FOR UPDATE SKIP LOCKED` with REVOKE/GRANT
- [ ] Error matrix covers all 8 codes — confirm `BAD_REQUEST`/`NOT_CONFIGURED` naming matches ADR 0002 §3
- [ ] TOKEN_EXPIRED row shows in-tick refresh+retry (NOT requeue), with per-tick Set loop guard
- [ ] Retry policy names the two and only two increment sites (NETWORK requeue + reaper)
- [ ] No `claimed_at` column — `last_publish_attempt_at` doubles as claim timestamp
- [ ] No `shortCircuitAlreadyPublished` helper specced
- [ ] Idempotency model explicitly drops the short-circuit with rationale
- [ ] Reaper has STUCK_TERMINAL path for max-attempt rows (not just bounce-to-approved)
- [ ] Recovery covers stuck-`generating` janitor
- [ ] Migration SQL complete (timestamp filename, Builder picks it; SECURITY DEFINER fn included)
- [ ] Worker API shows `/lib/publishing/orchestrator.ts` path
- [ ] CRON route contract documents auth, dev bypass, reaped-count plumbing into summary
- [ ] vercel.json contract specified (Pro vs Hobby cadence)
- [ ] All 6 config vars listed (`PUBLISH_BATCH_SIZE` not `PUBLISH_MAX_POSTS_PER_TICK`)
- [ ] Architect did NOT write any `.ts`, `.sql`, or `vercel.json` files
- [ ] Architect's final line was the confirmation phrase

```
git add docs/decisions/0005-publishing-worker.md
git commit -m "Session 10A: Publishing worker design"
git push
```

**→ Paste the ADR to Claude.ai. Mandatory pause. Do NOT start Part B without sign-off.**

---

## Part B — Builder Session (Sonnet 4.6)

> Wait for Claude.ai to confirm the ADR before starting.

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0005-publishing-worker.md.

The ADR is your single source of truth. It overrides anything
in this primer or earlier discussion.

Read /docs/decisions/0001-database-schema.md §B.5 (posts table,
indexes) and §E (full indexes catalogue).
Read /docs/decisions/0002-social-provider.md §3 (error taxonomy)
and §8 (token refresh lifecycle).

Read /lib/social/index.ts (the only public surface — see
CLAUDE.md no-deep-imports rule), /lib/social/types.ts,
/lib/social/errors.ts, /lib/social/postiz-provider.ts,
/lib/social/mock-provider.ts (your test double),
/lib/social/platforms/config.ts (publishingAvailableFor).

Read /lib/db/posts.ts (note the existing listPostsDue helper
from Session 9D — you may consolidate or supersede it),
/lib/db/post-generation-sessions.ts, /lib/db/campaigns.ts,
/lib/db/types.ts.

Read /lib/supabase/service.ts (createServiceRoleClient pattern
and the serverOnly() guard), /lib/config.ts.

Skim /supabase/migrations/ — confirm the next available
migration number (Session 8 used 026–029).

Session 10 Part B — Publishing Worker Implementation. Builder role.

ECC workflow (use the prefix /everything-claude-code: not /ecc:):
- /everything-claude-code:plan before each prompt
- /everything-claude-code:tdd for all TypeScript
- /everything-claude-code:verify after each prompt — do not
  proceed if it fails

Patterns from CLAUDE.md to follow strictly:
- /lib/social/index.ts is the ONLY import surface for social
  code. No import of postiz-provider or mock-provider from
  /lib/publishing/ — only getRegistry() and the SocialProviderError
  type from /lib/social/index.ts.
- Service-role via lazy import (await import('@/lib/supabase/service'))
- /lib/db/ only — never direct Supabase in workers or routes
- formatISO from date-fns for ALL timestamp writes
- No process.env outside /lib/config.ts
- No console.* except the single structured summary line per tick
  (the ADR explicitly authorises this; everything else logs
  through sanitised metadata writes)
- No `any` types — use `unknown` and narrow
- All status transitions use atomic conditional UPDATE
  (eq('status', '<expected>')) per the atomic-state-transitions
  rule in CLAUDE.md

Confirm:
1. You've read ADR 0005 in full
2. The list of files you'll create/modify in this session
3. The migration number you'll use
4. That you understand the worker imports SocialProvider through
   getRegistry() and never reaches into PostizProvider directly

Wait for Prompt 1.
```

### Prompt B1 — Migration

```
/everything-claude-code:plan "Apply schema changes from ADR 0005 §9"

ADR 0005 §9 is the source of truth. Read it before writing SQL.

Three columns to add to posts (NOT four — no claimed_at column;
last_publish_attempt_at doubles as the claim timestamp):
  publish_attempts        INT         NOT NULL DEFAULT 0
  last_publish_attempt_at TIMESTAMPTZ NULL
  last_publish_error      TEXT        NULL

CHECK constraints:
  publish_attempts >= 0
  publish_attempts <= 10  -- runtime limit is 5; 10 is the hard ceiling

No claimed_at column. No index added in this migration (the reaper
index is deferred per ADR 0005 §18). The existing partial index on
(status, scheduled_at) WHERE status='approved' already covers the
claim query per ADR 0005 §4.

The migration also includes the SECURITY DEFINER claim function
(ADR 0005 §4 — it lives in the migration, not in application code):

  CREATE OR REPLACE FUNCTION public.claim_posts_for_publishing(
    p_now   timestamptz,
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

Create the migration file with a timestamp-based name matching the
project convention (read /supabase/migrations/ to get the latest
timestamp prefix and increment by one second).

Run: npm run db:migrate

Update /lib/db/types.ts:
  Extend PostRow with the three new columns.
  PostInsert counterparts are optional (defaults handle them).

/everything-claude-code:verify
```

### Prompt B2 — /lib/db/posts.ts additions

```
/everything-claude-code:tdd "Publishing worker DB helpers"

ADR 0005 §11 is the contract. Implement exactly these six helpers
in /lib/db/posts.ts. No claimed_at column exists — everything uses
last_publish_attempt_at. No shortCircuitAlreadyPublished (dropped
per ADR 0005 §7).

1. claimPostsForPublishing(client, limit: number): Promise<PostRow[]>

   Calls the SECURITY DEFINER RPC from the migration via client.rpc(
     'claim_posts_for_publishing',
     { p_now: formatISO(new Date()), p_limit: limit }
   ).
   Returns rows already transitioned to status='scheduled' with
   last_publish_attempt_at set. No SQL in application code — all
   logic lives in the DB function.

2. markPostPublished(client, postId, payload: {
     platformPostId: string
     platformUrl: string | null
     publishedAt: Date
   }): Promise<PostRow>

   Atomic UPDATE WHERE status='scheduled'. On zero rows updated,
   throw — the caller treats this as "row moved under us".
   Clears last_publish_error. Does NOT increment publish_attempts.

3. markPostFailed(client, postId, payload: {
     errorCode: string          // free-form text per ADR 0005 §9 note
     errorDetails: unknown      // sanitised; written to
                                // ai_generation_metadata.publish_error
   }): Promise<PostRow>

   Atomic UPDATE WHERE status='scheduled'.
   Does NOT increment publish_attempts — freezes it at current value.
   Writes last_publish_error = errorCode.
   Merges errorDetails into ai_generation_metadata via jsonb_build_object.

4. requeueScheduledPost(client, postId, payload: {
     newScheduledAt: Date
     errorCode: string
     errorDetails: unknown
     incrementAttempts: boolean  // true for NETWORK; false for RATE_LIMITED
   }): Promise<PostRow>

   Atomic UPDATE WHERE status='scheduled'.
   status: scheduled → approved.
   scheduled_at = newScheduledAt.
   last_publish_error = errorCode.
   publish_attempts += 1 ONLY when incrementAttempts === true.
   Merges errorDetails into ai_generation_metadata.publish_error.
   This single function handles both RATE_LIMITED (incrementAttempts:
   false) and NETWORK (incrementAttempts: true) requeues per ADR §5.

5. reapStuckScheduledPosts(client, opts: {
     now: Date
     stuckMinutes: number
   }): Promise<number>

   Executes TWO atomic statements (ADR 0005 §8 Phase A.2):

   Statement 1 — bounce-to-approved (attempts < MAX):
     UPDATE posts
     SET status = 'approved',
         publish_attempts = publish_attempts + 1,
         last_publish_error = 'STUCK_REAPED'
     WHERE status = 'scheduled'
       AND last_publish_attempt_at < $now - ($stuckMinutes * interval '1 minute')
       AND publish_attempts + 1 < PUBLISH_MAX_ATTEMPTS  -- read from config
       AND deleted_at IS NULL

   Statement 2 — terminal failed (attempts >= MAX):
     UPDATE posts
     SET status = 'failed',
         last_publish_error = 'STUCK_TERMINAL'
     WHERE status = 'scheduled'
       AND last_publish_attempt_at < $now - ($stuckMinutes * interval '1 minute')
       AND publish_attempts + 1 >= PUBLISH_MAX_ATTEMPTS
       AND deleted_at IS NULL

   Returns the total rows touched (sum of both statement counts).
   PUBLISH_MAX_ATTEMPTS is read from config (not hardcoded).

6. incrementPublishedCountForCampaign(client, campaignId):
   Promise<void>

   Read /docs/decisions/0001-database-schema.md §B.4 for the exact
   column name on the campaigns table (may be published_post_count
   or total_posts_published — use whatever ADR 0001 specifies, NOT
   a guess). Atomic increment: SET col = col + 1 WHERE id = campaignId.

Write tests in /lib/db/posts.publishing.test.ts. Coverage:
- claimPostsForPublishing calls the RPC with correct params
- markPostPublished throws on zero rows updated
- markPostPublished does NOT increment publish_attempts
- markPostFailed does NOT increment publish_attempts, freezes it
- requeueScheduledPost with incrementAttempts=true → publish_attempts++
- requeueScheduledPost with incrementAttempts=false → publish_attempts unchanged
- reapStuckScheduledPosts: stale row with attempts < MAX → approved + STUCK_REAPED
- reapStuckScheduledPosts: stale row with attempts == MAX → failed + STUCK_TERMINAL
- reapStuckScheduledPosts: fresh scheduled row → untouched
- reapStuckScheduledPosts: returns sum of both statement counts

Run: npx vitest run lib/db/posts.publishing
Then: npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

### Prompt B3 — /lib/db/post-generation-sessions.ts janitor

```
/everything-claude-code:tdd "Stale generation-session janitor"

ADR 0005 §8 Phase A.1. Add to /lib/db/post-generation-sessions.ts:

  recoverStuckGenerationSessions(client, opts: {
    now: Date
    staleMinutes: number  // default 15 per ADR 0005 §14
  }): Promise<number>  // count flipped

  UPDATE post_generation_sessions
  SET status = 'failed',
      error_code = 'timeout',
      finished_at = $now       -- confirm this is the correct column
                               -- name by reading the table definition;
                               -- ADR 0005 §8 uses finished_at
  WHERE status = 'generating'
    AND started_at IS NOT NULL
    AND started_at < ($now - $staleMinutes * interval '1 minute')
  RETURNING id

Tests in /lib/db/post-generation-sessions.test.ts:
- Stale `generating` row (>15 min) → flipped to 'failed',
  error_code='timeout', finished_at set
- Recent `generating` row (<15 min) → untouched
- `pending` row → untouched
- `complete` / `failed` rows → untouched

/everything-claude-code:verify
```

### Prompt B4 — Worker orchestrator

```
/everything-claude-code:tdd "Publishing worker orchestrator"

ADR 0005 §10 specifies the module path as /lib/publishing/orchestrator.ts
(not /lib/workers/). Create that file.

The orchestrator imports SOLELY from:
  /lib/social/index.ts        (getRegistry, SocialProviderError,
                               and the error-code type)
  /lib/db/posts.ts            (the 6 helpers from B2)
  /lib/db/post-generation-sessions.ts  (recoverStuckGenerationSessions)
  /lib/db/social-accounts.ts  (getSocialAccountByBusinessAndPlatform —
                               worker needs socialAccountId from
                               businessId + platform; if this helper
                               doesn't exist, add it in that file)
  /lib/config.ts
  date-fns (addSeconds, formatISO)

NO import of postiz-provider, mock-provider, vault, or any
/lib/social/ internal file.

There is NO separate /lib/workers/janitor.ts. runJanitorTick is
exported from this same file.

────────────────────────────────

EXPORTS — match ADR 0005 §10 exactly:

  export interface PublishTickSummary {
    tick: string        // ISO timestamp at tick start
    durationMs: number
    claimed: number     // rows transitioned approved → scheduled
    published: number   // rows transitioned scheduled → published
    failed: number      // rows transitioned scheduled → failed
    retried: number     // rows requeued (NETWORK + RATE_LIMITED combined)
    refreshed: number   // distinct socialAccountIds refreshed (Set.size)
    reaped: number      // rows touched by reapStuckScheduledPosts
                        // (passed in via opts — see route handler note below)
  }

  export interface JanitorTickSummary {
    tick: string
    durationMs: number
    stuckGenerationSessionsReaped: number
  }

  export async function runPublishTick(opts?: {
    now?: Date
    batchSize?: number
    reaped?: number      // pre-computed by route handler from
                         // reapStuckScheduledPosts call — folded into summary
  }): Promise<PublishTickSummary>

  export async function runJanitorTick(opts?: {
    now?: Date
  }): Promise<JanitorTickSummary>

────────────────────────────────

runPublishTick IMPLEMENTATION:

  STEP 1 — Read config: PUBLISH_BATCH_SIZE, PUBLISH_MAX_ATTEMPTS,
           PUBLISH_RETRY_BACKOFF_SECONDS.
           Capture `now = opts?.now ?? new Date()`.
           Lazy-import service-role client once.

  STEP 2 — Claim. claimPostsForPublishing(client, batchSize).
           summary.claimed = posts.length.
           summary.reaped = opts?.reaped ?? 0.
           If empty, emit summary and return.

  STEP 3 — Per-post loop (sequential, not concurrent).
           For each post, call publishOne(post).

  publishOne(post):

    1. Look up socialAccountId via getSocialAccountByBusinessAndPlatform(
         client, post.business_id, post.platform).
       If null or inactive: markPostFailed(client, post.id, {
         errorCode: 'TOKEN_REVOKED',
         errorDetails: { reason: 'account_disconnected' }
       }). summary.failed++. Return.

    2. Build PublishInput from post.content, post.hashtags,
       post.media_urls.

    3. registry = getRegistry(). provider = registry.get(post.platform).

    4. try { result = await provider.publish(input) }
       catch (err) {
         if (err instanceof SocialProviderError) → handle per matrix
         else rethrow (non-SocialProviderError aborts this post
                       but does NOT abort the tick — catch at the
                       per-post loop level and log + continue)
       }

    5. On success: markPostPublished(client, post.id, {
         platformPostId: result.platformPostId,
         platformUrl: result.platformUrl ?? null,
         publishedAt: now
       }).
       incrementPublishedCountForCampaign(client, post.campaign_id).
       summary.published++. Return.

    6. On SocialProviderError — branch by err.code. Use the exact
       code strings from ADR 0002 §3 as imported from
       /lib/social/index.ts. The codes as named in ADR 0005 §5
       error matrix are:
         TOKEN_EXPIRED, TOKEN_REVOKED, RATE_LIMITED,
         PLATFORM_REJECTED, NETWORK, BAD_REQUEST,
         NOT_CONFIGURED, UNKNOWN
       (Confirm these match the imported type — if ADR 0002 used
       different names, the imported type wins. Do NOT hardcode
       strings that differ from the enum.)

       case TOKEN_EXPIRED:
         Per-tick Set<string> `refreshedThisTick` tracks socialAccountIds.
         If NOT in set:
           await provider.refreshAccessToken({ socialAccountId })
           refreshedThisTick.add(socialAccountId); summary.refreshed++
           try { result = await provider.publish(input) }
           catch (e2) {
             // Any error after refresh → terminal failed
             markPostFailed(client, post.id, {
               errorCode: 'TOKEN_REVOKED',
               errorDetails: redactTokens({ reason: 'refresh_failed',
                               originalCode: e2 instanceof SocialProviderError
                                             ? e2.code : 'UNKNOWN' })
             }); summary.failed++; return
           }
           // Refresh+retry succeeded
           markPostPublished(...); summary.published++; return
         Else (already refreshed this tick — loop guard):
           markPostFailed(client, post.id, {
             errorCode: 'TOKEN_REVOKED',
             errorDetails: { reason: 'refresh_loop' }
           }); summary.failed++; return
         publish_attempts is NEVER incremented on TOKEN_EXPIRED paths.

       case RATE_LIMITED:
         newScheduledAt = addSeconds(now, err.retryAfterSeconds ?? 60)
         requeueScheduledPost(client, post.id, {
           newScheduledAt,
           errorCode: 'RATE_LIMITED',
           errorDetails: redactTokens({ retryAfterSeconds: err.retryAfterSeconds }),
           incrementAttempts: false    // platform-induced; not a retry budget event
         }); summary.retried++; return

       case NETWORK:
         if (post.publish_attempts + 1 >= PUBLISH_MAX_ATTEMPTS):
           markPostFailed(client, post.id, {
             errorCode: 'NETWORK',
             errorDetails: redactTokens({ attempts: post.publish_attempts + 1 })
           }); summary.failed++; return
         const base = PUBLISH_RETRY_BACKOFF_SECONDS
         const expo = base * (2 ** post.publish_attempts)
         const jitter = expo * (Math.random() * 0.5 - 0.25)  // ± 25%
         const newScheduledAt = addSeconds(now, Math.round(expo + jitter))
         requeueScheduledPost(client, post.id, {
           newScheduledAt,
           errorCode: 'NETWORK',
           errorDetails: redactTokens({ attempts: post.publish_attempts + 1 }),
           incrementAttempts: true
         }); summary.retried++; return

       case TOKEN_REVOKED:
       case PLATFORM_REJECTED:
       case BAD_REQUEST:
       case NOT_CONFIGURED:
       case UNKNOWN:
         markPostFailed(client, post.id, {
           errorCode: err.code,
           errorDetails: redactTokens(err.details ?? {})
         }); summary.failed++; return

  STEP 4 — Emit one structured log line:
    console.log(JSON.stringify({ kind: 'publish_tick', ...summary }))
    return summary

────────────────────────────────

runJanitorTick IMPLEMENTATION:

  Lazy-import service-role client.
  Call recoverStuckGenerationSessions(client, {
    now,
    staleMinutes: POST_GENERATION_SESSION_STALE_MINUTES  // from config
  }).
  Emit: console.log(JSON.stringify({ kind: 'janitor_tick', ...summary }))
  Return JanitorTickSummary.

────────────────────────────────

redactTokens helper (local to this module):

  function redactTokens(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
        /token|secret|authorization|cookie/i.test(k)
          ? [k, '[REDACTED]']
          : [k, redactTokens(v)]
      )
    )
  }

────────────────────────────────

Tests in /lib/publishing/orchestrator.test.ts. MockProvider with
FailureConfig. Each error code gets a dedicated test. Coverage:

  - Empty claim → all-zero summary, no provider calls
  - Successful publish → state transition, campaign counter incremented
  - TOKEN_EXPIRED → refresh → success: refreshed=1, published=1,
    publish_attempts unchanged
  - TOKEN_EXPIRED → refresh → TOKEN_EXPIRED: failed with
    reason='refresh_failed', publish_attempts unchanged
  - TOKEN_EXPIRED refresh-loop guard: two posts same socialAccountId,
    both throw TOKEN_EXPIRED on first publish — second hits loop guard,
    summary.refreshed === 1
  - RATE_LIMITED: requeueScheduledPost called with incrementAttempts=false,
    scheduled_at = now + retryAfterSeconds
  - NETWORK (attempts < MAX): requeueScheduledPost with incrementAttempts=true,
    newScheduledAt within jitter window
  - NETWORK (attempts + 1 == MAX): markPostFailed, publish_attempts frozen
  - TOKEN_REVOKED: terminal failed
  - PLATFORM_REJECTED: terminal failed
  - BAD_REQUEST: terminal failed
  - NOT_CONFIGURED: terminal failed
  - UNKNOWN: terminal failed
  - Sequential: one NETWORK-failing post does not abort subsequent posts
  - account_disconnected: markPostFailed 'TOKEN_REVOKED', account_disconnected reason

Run:
  npx vitest run lib/publishing lib/db
  npx tsc --noEmit --skipLibCheck

/everything-claude-code:verify
```

/everything-claude-code:verify
```

### Prompt B5 — Cron route handler

```
/everything-claude-code:tdd "Cron route handler with CRON_SECRET
auth and dev bypass"

Create /app/api/cron/publish/route.ts.

Add to /lib/config.ts (ADR 0005 §14 — use these exact names):
  CRON_SECRET                          server, required prod, min 32 chars
  PUBLISH_BATCH_SIZE                   default 25
  PUBLISH_MAX_ATTEMPTS                 default 5
  PUBLISH_RETRY_BACKOFF_SECONDS        default 60
  PUBLISH_STUCK_MINUTES                default 10
  POST_GENERATION_SESSION_STALE_MINUTES  default 15

Update .env.local.example with placeholders for all six.

Route file — match ADR 0005 §12 exactly:

  import { NextRequest, NextResponse } from 'next/server'
  import { timingSafeEqual } from 'node:crypto'
  import { formatISO } from 'date-fns'
  import { config } from '@/lib/config'
  import { runPublishTick, runJanitorTick } from '@/lib/publishing/orchestrator'
  import { reapStuckScheduledPosts } from '@/lib/db/posts'

  export const dynamic = 'force-dynamic'
  export const maxDuration = 60   // Pro. Hobby: change to 30.

  export async function GET(request: NextRequest): Promise<NextResponse> {
    // ── Auth ──────────────────────────────────────────────────
    const isProd = process.env.NODE_ENV === 'production'
    const authHeader = request.headers.get('authorization') ?? ''
    const devTrigger = request.headers.get('x-cron-dev-trigger') === 'true'

    let authorised = false
    if (isProd) {
      const expected = `Bearer ${config.server.CRON_SECRET}`
      const a = Buffer.from(authHeader)
      const b = Buffer.from(expected)
      if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
    } else {
      const secret = config.server.CRON_SECRET ?? ''
      if (secret) {
        const expected = `Bearer ${secret}`
        const a = Buffer.from(authHeader)
        const b = Buffer.from(expected)
        if (a.length === b.length && timingSafeEqual(a, b)) authorised = true
      }
      if (devTrigger) authorised = true
    }

    if (!authorised) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // ── Phase A (janitor + reaper before claim) ───────────────
    const now = new Date()
    const tick = formatISO(now)

    // Import service-role client for direct reaper call
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()

    let janitor, reaped = 0
    try {
      janitor = await runJanitorTick({ now })
    } catch (err) {
      janitor = {
        tick, durationMs: 0,
        stuckGenerationSessionsReaped: 0,
        error: err instanceof Error ? err.message : 'unknown',
      }
    }

    try {
      reaped = await reapStuckScheduledPosts(client, {
        now,
        stuckMinutes: config.server.PUBLISH_STUCK_MINUTES,
      })
    } catch (err) {
      console.error('reaper error', err instanceof Error ? err.message : err)
    }

    // ── Phase B (publish) ─────────────────────────────────────
    let publish
    try {
      publish = await runPublishTick({ now, batchSize: config.server.PUBLISH_BATCH_SIZE, reaped })
    } catch (err) {
      publish = {
        tick, durationMs: 0,
        claimed: 0, published: 0, failed: 0, retried: 0,
        refreshed: 0, reaped,
        error: err instanceof Error ? err.message : 'unknown',
      }
    }

    // Always 200 — non-2xx triggers Vercel retry which we don't want
    return NextResponse.json({ tick, janitor, publish })
  }

Tests in /app/api/cron/publish/route.test.ts:
  - Missing Authorization → 401, generic 'Unauthorized' body
  - Wrong secret (same length) → 401 (timingSafeEqual reached)
  - Wrong-length secret → 401 (length pre-check, timingSafeEqual not reached)
  - Correct Authorization → 200 with janitor + publish summaries
  - Dev: X-Cron-Dev-Trigger without secret → 200
  - Prod: X-Cron-Dev-Trigger without secret → 401 (header ignored)
  - runPublishTick throws → 200 with error field (never 500)
  - runJanitorTick throws → 200 with error field in janitor
  - reaped count from reapStuckScheduledPosts is present in publish summary

/everything-claude-code:verify
```

### Prompt B6 — vercel.json + cron registration

```
/everything-claude-code:plan "Register the cron in vercel.json"

Create /vercel.json at the repo root:

  {
    "crons": [
      {
        "path": "/api/cron/publish",
        "schedule": "* * * * *"
      }
    ]
  }

Pro plan: every minute. Hobby plan: change schedule to
"*/5 * * * *" and also change route maxDuration to 30.

If /vercel.json already exists (e.g. from rewrites or headers),
merge the "crons" key in rather than replacing the file.

Verify by running:
  vercel env ls          # confirm CRON_SECRET is present in
                         # production AND preview environments
                         # (Vercel needs both)
  vercel inspect         # confirm cron entry registered

If CRON_SECRET is missing from Vercel, add it:
  vercel env add CRON_SECRET production
  vercel env add CRON_SECRET preview

For local development, generate one and add to .env.local:
  openssl rand -base64 48

Update /docs/build-guide/runbooks/cron-secret-rotation.md
(create the directory if needed) with the rotation procedure.

/everything-claude-code:verify
```

### Prompt B7 — UI updates (frontend-design active)

```
/everything-claude-code:plan "Publishing status UI surfaces"

The frontend-design skill is active. Aesthetic guidance from
Session 9: editorial / workspace minimal. Status communicated
through subtle colour, not heavy badges. Restrained emerald
for `published`, amber for `failed`, indigo pulse for
`scheduled` (claimed, in-flight).

Three small surfaces in this session — all additive, no
existing card layout changes:

A. /components/posts/PostCard.tsx — extend the status pill
   to cover three new states:
     scheduled   → indigo dot + "Publishing…"   with a subtle
                   animated pulse on the dot (Tailwind
                   animate-pulse, no framer-motion)
     published   → emerald dot + "Published" + a small external-
                   link icon that opens platform_post.url in a
                   new tab when present (rel="noopener noreferrer")
     failed      → amber dot + "Failed" + the last_publish_error_code
                   surfaced as a localised label (e.g.
                   t(`posts.error.${errorCode}`) — fall back to
                   posts.error.generic). Hovering the pill
                   reveals last_publish_error_at as a tooltip.
   Existing `draft`/`approved`/`skipped` pills unchanged.

   The "Approve" / "Skip" / "Edit" buttons in PostCard MUST
   become disabled (visually + functionally) when the row is
   in scheduled/published/failed states. A failed post is a
   terminal state for Phase 1 — no "retry" button (deferred to
   Phase 2 per ADR §16). Show a single "Why did this fail?"
   tooltip with localised error explanation.

B. /app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx —
   the non-draft variant currently shows "published/total".
   Extend with:
     - "Next post: in 2h 14m" (computed from
       min(scheduled_at) WHERE status IN ('approved','scheduled'))
     - If any failed posts exist: a small amber row
       "{N} posts failed to publish — open the review queue"
       → linking to /campaigns/{id}/posts with ?filter=failed
   A new filter pill on PostsClient handles the failed filter.

C. /app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx —
   add a `failed` filter pill alongside the existing
   approved/skipped pills (count badge included). Same FilterPill
   component, no architectural change.

i18n additions in posts.json (EN/PT/ES, identical key sets,
real translations not placeholders):
  card.status.scheduled, card.status.published, card.status.failed
  card.action.openOnPlatform
  card.tooltip.failedAt
  filter.failed
  error.token_expired         "Account session expired"
  error.token_revoked         "Account disconnected — reconnect"
  error.rate_limited          "Platform rate-limited the post"
  error.platform_rejected     "Platform rejected the post"
  error.network               "Network error — will retry"
  error.not_implemented       "Publishing not yet available for this platform"
  error.provider_not_configured  "Publishing service not configured"
  error.unknown               "Unknown error"
  error.generic               "Couldn't publish"
campaigns.detail.nextPost      "Next post: {in}"
campaigns.detail.failedBanner  "{count} post failed to publish"
campaigns.detail.failedBanner_plural  "{count} posts failed to publish"
campaigns.detail.openFailed    "Open the review queue"

Run final verification:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/db lib/social lib/publishing app

If tests fail or tsc errors appear: fix before stopping.
Report the final counts.

/everything-claude-code:verify
```

### Prompt B8 — Save session memory

```
/learn-eval

Summarise:
- What was built in Session 10B
- Any deviations from ADR 0005 and why (none expected — flag
  anything that diverged)
- The PUBLISH_MAX_* values you chose (should be ADR defaults
  unless overridden)
- Any open questions for the Reviewer (e.g. you considered
  but did not implement X)
- Confirm: no .ts file outside /lib/publishing/ imports from
  /lib/social/ internals (only /lib/social/index.ts)

/save-session
```

`/exit` Claude Code.

### After Part B

```
git add .
git commit -m "Session 10B: Publishing worker implementation"
git push
```

**Run a manual smoke test before the Reviewer session:**

1. Approve at least one LinkedIn or X post with a `scheduled_at` already in the past
2. Hit the local cron endpoint:
   ```
   curl -X GET http://localhost:3000/api/cron/publish \
     -H "X-Cron-Dev-Trigger: true"
   ```
3. Confirm response JSON shows `publish.claimed >= 1` and `publish.published >= 1`
4. Reload `/campaigns/{id}/posts` — the post card now shows the emerald `Published` pill
5. Click the external-link icon — it opens the platform URL (or the Postiz preview URL, depending on provider mode)
6. Confirm `campaigns.total_posts_published` incremented in Supabase
7. **Failure path:** approve another post, then in Supabase manually flip `social_accounts.is_active = false` for that platform, then hit the cron again. Confirm the post transitions to `failed` with `last_publish_error_code = 'TOKEN_REVOKED'`.

If any step fails, paste the response JSON and the failing post row to Claude.ai before moving to the Reviewer.

---

## Part C — Reviewer Session (Opus 4.7)

### How to run

1. `/exit` from builder session
2. `claude` in a fresh terminal
3. `/model` → **Claude Opus 4.7**
4. Paste Reviewer Primer
5. Paste Reviewer Prompt

### Reviewer Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0001-database-schema.md §B.5,
/docs/decisions/0002-social-provider.md §3 and §8,
/docs/decisions/0005-publishing-worker.md (the contract).

Read all Session 10B output:
  /supabase/migrations/<timestamp>_publishing_worker.sql
  /lib/db/posts.ts (additions only)
  /lib/db/posts.publishing.test.ts
  /lib/db/post-generation-sessions.ts (additions only)
  /lib/db/post-generation-sessions.test.ts
  /lib/publishing/orchestrator.ts
  /lib/publishing/orchestrator.test.ts
  /app/api/cron/publish/route.ts
  /app/api/cron/publish/route.test.ts
  /vercel.json
  /lib/config.ts (additions only)
  /components/posts/PostCard.tsx (extended status pill)
  /app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx (additions)
  /app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx (failed filter)
  All three locale posts.json + campaigns.json files (additions).

Session 10 Part C — Reviewer. Use security-reviewer,
typescript-reviewer, AND database-reviewer agents in parallel.

You are auditing the publishing worker — the surface that
will, in production, talk to LinkedIn and X on behalf of real
businesses. A bug here can: publish to the wrong tenant, double-
publish, leak token material in logs, exhaust platform rate
budgets, or leave posts in stuck states.

Report format: markdown table
(Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions.
After that: every ⚠️ with recommendations.
Verdict: blockers before Session 11 / blockers before first
production cron run / acceptable to defer.

Acknowledge and list your planned checks. Then run them.
```

### Reviewer Prompt

```
Audit Session 10B against these checks:

SECTION A — CRON AUTHENTICATION

A1. Authorization header comparison uses crypto.timingSafeEqual
    (not === or .startsWith)?
A2. Buffer-length pre-check before timingSafeEqual call?
    (timingSafeEqual throws on length mismatch — a try/catch
    would also work but the length pre-check is cleaner.)
A3. Production path REJECTS the X-Cron-Dev-Trigger header
    entirely (not just "in addition to bearer")?
A4. CRON_SECRET min-length validation at boot in production?
A5. Route handler returns 401 (not 403, not 404) on auth
    failure — but the response body MUST NOT include any
    information about why (no "wrong secret" vs "missing header"
    leak)?
A6. config.server.CRON_SECRET is never read from process.env
    directly outside /lib/config.ts?

SECTION B — IDEMPOTENCY & STATE MACHINE

B1. claim_posts_for_publishing is a SECURITY DEFINER function
    in the migration, with REVOKE ALL FROM public and
    GRANT EXECUTE TO service_role?
B2. Every state transition uses an atomic conditional UPDATE
    (.eq('status', '<expected>')) per CLAUDE.md?
B3. reapStuckScheduledPosts runs BEFORE claimPostsForPublishing
    in every tick (route handler ordering)?
    (If claim runs first, stuck rows in `scheduled` are
    invisible to the recovery scan.)
B4. markPostPublished writes platform_post_id and the status
    transition in a SINGLE UPDATE?
B5. reapStuckScheduledPosts has TWO statements: bounce-to-approved
    for attempts < MAX, and terminal-failed (STUCK_TERMINAL) for
    attempts >= MAX? Rows at MAX must not be left stuck forever.
B6. The stuck-scheduled threshold (PUBLISH_STUCK_MINUTES = 10 min)
    is strictly LONGER than maxDuration (60s)? A shorter window
    risks recovering a row that's still actively being processed.
B7. last_publish_attempt_at is cleared or updated on every
    transition out of `scheduled`? (markPostPublished,
    markPostFailed, requeueScheduledPost all need to handle it.)

SECTION C — ERROR MATRIX FIDELITY

C1. All 8 error codes from ADR 0002 §3 have an explicit case
    in publishOne? Verify the exact code strings match the
    SocialProviderErrorCode type imported from /lib/social/index.ts.
    ADR 0005 §5 names them: TOKEN_EXPIRED, TOKEN_REVOKED,
    RATE_LIMITED, PLATFORM_REJECTED, NETWORK, BAD_REQUEST,
    NOT_CONFIGURED, UNKNOWN. If ADR 0002 §3 uses different names,
    the imported type wins — flag any mismatch.
C2. TOKEN_EXPIRED triggers exactly ONE refresh per
    socialAccountId per tick? (A per-tick Set<string> is the
    pattern — if absent, a misbehaving Postiz could chain
    refreshes infinitely.)
C3. The refresh path does NOT increment publish_attempts?
    (Refresh is not a publish failure; it's a precondition fix.)
C4. After successful refresh, the publish is retried ONCE,
    same tick, no requeue?
C5. RATE_LIMITED uses retryAfterSeconds verbatim (not a
    backoff override)? incrementAttempts=false passed to
    requeueScheduledPost?
C6. NETWORK backoff formula matches ADR 0005 §6 exactly?
    base * 2^(publish_attempts) ± 25% jitter, where
    publish_attempts is the PRE-increment value?
    incrementAttempts=true passed to requeueScheduledPost?
C7. NOT_CONFIGURED (or equivalent terminal code) is treated
    as terminal? (Retrying is pointless — config doesn't fix
    itself between ticks.)
C8. err.details is passed through redactTokens BEFORE being
    written to ai_generation_metadata, regardless of whether
    SocialProviderError already redacted on construction?

SECTION D — DATA INTEGRITY & TENANCY

D1. The worker uses service-role for DB writes (legitimate per
    CLAUDE.md), but the claim query has explicit business-
    irrelevant filters (status, platform, scheduled_at,
    deleted_at) — confirm there is NO path where service-role
    is used in a way that could affect another tenant's posts
    incorrectly?
D2. campaigns.total_posts_published increment is atomic
    (single UPDATE), not read-modify-write?
D3. Posts marked `failed` retain enough context (errorCode,
    errorAt, details in metadata) for a future "retry from
    failed" Phase 2 feature?
D4. Migration CHECK constraints are correct? publish_attempts
    non-negative (>= 0) and ceiling (<= 10). No nullability-paired
    constraint needed (last_publish_attempt_at and last_publish_error
    are independently nullable per ADR 0005 §9).
D5. No raw token material can reach the worker's structured
    log line (only summary counts)?

SECTION E — IMPORT SURFACE & ABSTRACTION

E1. Searching the codebase: no import of
    @/lib/social/postiz-provider, @/lib/social/mock-provider,
    @/lib/social/vault, @/lib/social/errors (anywhere outside
    /lib/social/)? The worker must ONLY import from
    @/lib/social. Each violation is a CLAUDE.md breach.
E2. /lib/publishing/ imports only from /lib/social, /lib/db,
    /lib/supabase/service (via lazy import — not directly),
    /lib/config, date-fns?
E3. The cron route is the ONLY caller of runPublishTick and
    runJanitorTick? (Tests are a permitted second caller.)

SECTION F — UI & i18n

F1. PostCard disables Approve/Skip/Edit buttons on
    scheduled/published/failed states?
F2. The published external-link uses rel="noopener noreferrer"
    and target="_blank"?
F3. All three locale files contain identical key sets for the
    new error.* keys?
F4. The "Next post: in 2h 14m" computation handles the
    null-scheduled_at case gracefully (no scheduled or
    approved posts → hide the line, don't show "in NaN")?
F5. The failed-banner pluralisation works in all three locales
    (the _plural key pattern is wired into the i18n config)?

SECTION G — TESTS

G1. Each error code branch has a dedicated test that uses
    MockProvider with FailureConfig?
G2. The refresh-then-success path is tested? (Mock the publish
    to throw TOKEN_EXPIRED on first call and succeed on second;
    assert summary.refreshed === 1, summary.published === 1,
    publish_attempts unchanged.)
G3. The refresh-then-fail path is tested? (Both publishes
    throw TOKEN_EXPIRED; assert terminal `failed` with
    'refresh_failed' details.)
G4. The recovery-before-claim ordering is tested? (Insert a
    stale `scheduled` row + a fresh `approved` row, run tick,
    assert both end up `published`.)
G5. The platform gate is tested? (An approved Instagram post
    is NOT in claim results.)
G6. The idempotency short-circuit is tested?

SECTION H — CONVENTIONS

H1. formatISO from date-fns for every timestamp write?
H2. No process.env outside /lib/config.ts?
H3. No console.* except the one structured summary line per
    tick (and the parallel one in the janitor)?
H4. No `any` types?
H5. Comments explain non-obvious decisions (the refresh-tracking
    Set, the recovery-before-claim ordering, the
    short-circuit-before-publish guard)?

Final Verdict section listing:
- Blockers before Session 11
- Blockers before first production cron run
- Tech debt acceptable to defer to a future ADR
```

### After Part C

```
git add .
git commit -m "Session 10C: Publishing worker review complete"
git push
```

`/exit` Claude Code.

**Paste the full report to Claude.ai.** Severity gets evaluated and correction prompts for Session 10D follow if needed.

---

## Part D — Correction Pass (only if reviewer finds blockers)

> Skip if the reviewer reports zero ❌ and only minor ⚠️.

Fresh Sonnet 4.6 session. Fix every ❌ item. Do not change anything the reviewer marked ✅ or deferred as ⚠️.

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0005-publishing-worker.md.
Read the Session 10C reviewer report (provided below).
Fix all ❌ blockers. List what you'll change before touching any file.

[paste reviewer report here]

Fix only the listed ❌ items. After each fix run:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/db lib/social lib/publishing app

Report: which fixes applied, final tsc + vitest status.
```

```
git add .
git commit -m "Session 10D: Corrections applied, Session 10 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 10 complete.

ADR decisions confirmed:
- Cron cadence: [* * * * * or */5 * * * *]
- PUBLISH_BATCH_SIZE: [number]
- PUBLISH_MAX_ATTEMPTS: [number]
- Migration number: [030 or other]
- Provider mode used in smoke test: [postiz / mock]

Live smoke test results:
- Posts approved before tick: [N]
- /api/cron/publish dev trigger response: [paste publish summary]
- Posts published: [N] (assertion: matches publish.published)
- campaigns.total_posts_published before/after: [N → N+published]
- Manual TOKEN_REVOKED test (disconnected account):
    expected last_publish_error_code: TOKEN_REVOKED
    actual: [paste]
- Manual RATE_LIMITED simulation (if possible):
    expected: requeue with scheduled_at = now + retryAfterSeconds
    actual: [paste]
- Stuck-scheduled recovery: [verified yes/no — how?]
- Stale generation-session janitor:
    [yes/no — manually inserted a >10min generating row?]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- vercel inspect shows cron: [yes/no]
- CRON_SECRET present in Vercel envs (preview + prod): [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

First production tick (if cron has fired since deploy):
- Vercel cron log timestamp: [ISO]
- Summary returned: [paste]
- Any unexpected behaviour: [yes/no — what?]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 10

**Cron only fires on the production branch by default.** Vercel preview deployments don't fire crons unless you configure them per-environment. If you're testing on a preview URL, use the `X-Cron-Dev-Trigger` header instead of waiting for a tick that will never come.

**CRON_SECRET in `.env.local` is enough for local but not preview.** When you push a PR, Vercel creates a preview deployment with its own env vars. If `CRON_SECRET` is unset in the preview environment and you try to hit `/api/cron/publish` with the production secret, it'll 401. Add `CRON_SECRET` to **all three** Vercel environments (development, preview, production).

**`FOR UPDATE SKIP LOCKED` requires Postgres, not the PostgREST API.** Supabase exposes Postgres but you can't express `FOR UPDATE SKIP LOCKED` directly through the JS client's `.update()` chain. You need a SECURITY DEFINER function called via `client.rpc('claim_due_posts', ...)`. ADR §4 covers this; if the Builder tries to express the claim through the chainable API, it won't be atomic. Push back.

**`addSeconds` from date-fns returns a Date, not an ISO string.** The DB helpers expect Date objects (their internal `formatISO` call converts). Mixing strings and Date objects through the call chain is a common Sonnet error — if `tsc` complains, check the helper signature.

**The frontend `Published` pill rendering before the tick has run.** On a fresh dev environment, you may have to wait up to one minute for the cron to fire after approval — or use the dev trigger. UX confusion is worth a brief loading hint: PostCard already supports an "in flight" optimistic state for `scheduled` — confirm it animates properly.

**Postiz's "platform_post_id" naming.** Postiz returns the platform-side ID under a key that depends on the integration adapter (sometimes `posts[0].releaseURL`, sometimes `posts[0].id`). PostizProvider's `publish` (built in Session 3) is supposed to normalise this into `PublishResult.platformPostId`. If `markPostPublished` writes `null` or an opaque Postiz internal ID instead of the actual LinkedIn URN or X tweet ID, your idempotency short-circuit and your "open on platform" link both break. Verify against the live Postiz integration before the production cron fires.

**`scheduled_at` is now mutable.** Anything in the codebase that read `scheduled_at` and treated it as a stable AI-scheduled timestamp now needs to know the worker may push it forward on retry. The reviewer should flag any UI surface that displays `scheduled_at` as "when this will publish" without acknowledging it may shift on rate-limit. The Session 9 posts list date-divider does display `scheduled_at`; confirm the divider regroups posts correctly after a retry bump.

**Stuck `scheduled` rows pre-deploy.** If you smoke-tested locally and crashed mid-publish, you may have `scheduled` rows in your dev database with stale `last_publish_attempt_at` timestamps. The first production cron tick will recover them — visible in `publish.reaped`. Not a bug; expected behaviour. Worth noting in your test report.

**Architect tries to build.** If it happens (it did in Sessions 2 and 3), stop immediately, paste `Stop. Architect role only. Confirm and exit.`, then `/exit` and start fresh Builder. Any `.ts` or `.sql` the Architect produced must be deleted before the Builder runs.

---

## What this unlocks

After Session 10:
- A SOSH campaign goes end-to-end without human intervention after the approval click.
- The state machine (`draft → approved → scheduled → published`) is fully wired with retry, recovery, and observability.
- The stale-generation-session sweep (deferred from Session 8) is live.
- The CRON_SECRET pattern is established and reusable for the metrics worker (Session 11) and the engagement worker (Phase 2).
- Phase 1 MVP is functionally complete except for billing (Stripe webhook), the analytics dashboard, and email notifications — each of which now has a clear pattern to follow.

The next session opens with a campaign that has published posts and a `total_posts_published` counter ticking upward in production.
