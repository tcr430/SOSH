# Session 13.5 — QStash Cron Trigger Swap (Hobby-tier bridge)

> **Goal:** Unblock production deployment on Vercel Hobby by swapping the trigger source for both crons (`/api/cron/publish`, `/api/cron/sync-metrics`) from **Vercel Cron** to **Upstash QStash**. Route handlers and orchestrators do **not** move — only the doorbell does. Vercel Cron remains the *reserved* trigger: every config artefact (`vercel.json` `crons` array, `CRON_SECRET` env var, the route's Bearer auth path) is preserved so the day we upgrade to Pro, the flip is one PR (delete two QStash env vars, uncomment `vercel.json` crons). ADR 0005 §12 and ADR 0006 §9 get a short **amendment section** documenting the dual-trigger reality.
> **Time:** ~half a session (2–3 hours including correction pass). Smaller than usual because no schema change, no new module, no UI.
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction (Sonnet 4.6)
> **Plugins:** ECC throughout, claude-mem automatic. No design skill — there is no UI surface.
> **Session structure:** Three Claude Code sessions with `/exit` between each. Architect output is **amendments to two existing ADRs**, not a new one.

---

## Why this is a three-mind session even though it's small

On the surface this looks like "swap one cron provider for another, copy the SDK quickstart." Two facts make it not.

**First**, route auth is currently a single-mode `CRON_SECRET` `timingSafeEqual` (ADR 0005 §12). QStash authenticates by **signature verification** over the *request body* using `Upstash-Signature` — a different shape (asymmetric JWT-ish, key rotation via `QSTASH_NEXT_SIGNING_KEY`). The naïve options — "rip out Bearer, replace with signature" or "stack both unconditionally" — each have a failure mode: the first makes the future Vercel Cron flip a route edit (which we explicitly do not want); the second leaks the dev-bypass path under QStash (signature missing → falls through to Bearer → header bypass possible in misconfigured envs). The right shape is **a single auth function that picks one mode based on a config flag**, with the dev-bypass header preserved exactly as today.

**Second**, this is the first ADR amendment in the project — every prior reversal has been a fresh ADR. The convention has to be set here: short amendment block appended to the existing ADR, dated, status `Accepted`, scoped to the trigger source only. ADR 0005 §12 and ADR 0006 §9 should *reference* the amendment, not be rewritten. Future readers must be able to read the original §12/§9 and see "trigger source: see Amendment 1 (2026-XX)" without hunting.

Both are reversal-class decisions in miniature. Architect first, then Builder.

---

## What this session builds and what it doesn't

**Builds:**
- ADR 0005 — Amendment 1 (Trigger Source). Appended block at the end of `/docs/decisions/0005-publishing-worker.md`. Documents QStash as current trigger, Vercel Cron as reserved, the dual-auth rule, and the rollback procedure.
- ADR 0006 — Amendment 1 (Trigger Source). Mirror block on `/docs/decisions/0006-metrics-worker.md`, references 0005's amendment rather than restating it.
- `/lib/cron/qstash-auth.ts` — QStash-only helper exporting `verifyQStashRequest(request: NextRequest): Promise<void>`. Module-level `Receiver` singleton constructed from both signing keys. Throws on any failure; routes catch and return `401 Unauthorized` with no reason leaked to the response body. **Bearer auth is NOT extracted** — it stays inline in the route's `else` branch, byte-identical to today's ADR 0005 §12 code. (D6 trade-off: lower review risk, lexical separation visible at the route level.)
- `/app/api/cron/publish/route.ts` and `/app/api/cron/sync-metrics/route.ts` — minimal diff: the existing handler body is wrapped in `else { … }` verbatim, and a new `if (config.server.CRON_TRIGGER === 'qstash') { … }` branch is added above it. Split `GET` and `POST` handlers in the same `route.ts`: `GET` runs only when `CRON_TRIGGER === 'secret'` (else 405); `POST` runs only when `CRON_TRIGGER === 'qstash'` (else 405). Both delegate to the same inner orchestration function. Orchestrator calls, response shape, `maxDuration`, Sentry `withMonitor` wrappers (Session 13) all stay verbatim.
- `/lib/config.ts` additions — `CRON_TRIGGER: 'qstash' | 'secret'` (default `'secret'`), `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (both required when `CRON_TRIGGER='qstash'` AND `NODE_ENV='production'` via Zod `superRefine`). `CRON_SECRET` stays required-in-production unchanged.
- `vercel.json` — the `crons` array is **removed entirely** in the production deploy where `CRON_TRIGGER='qstash'`. The reserved JSON block (full crons array, both routes, original schedules) lives verbatim in `docs/build-guide/runbooks/vercel-cron-restore.md`, ready to paste back on the future Pro-tier flip.
- `docs/build-guide/runbooks/qstash-setup.md` — operational runbook (provision QStash, create both schedules, copy signing keys to Vercel env, smoke test, two-key rotation procedure). **Names QStash console's "Run now" button as the manual on-call re-trigger path** — there is no `CRON_SECRET` fallback in QStash mode (rejected by decision E).
- `docs/build-guide/runbooks/vercel-cron-restore.md` — the reverse runbook for the future Pro-tier flip: set `CRON_TRIGGER='secret'`, remove the two `QSTASH_*_SIGNING_KEY` env vars, paste the reserved JSON block back into `vercel.json`, redeploy. Zero code change.
- `docs/launch-checklist.md` updates — §3 (Cron) gets a "Trigger source" sub-header with two parallel sections: "QStash (active at launch)" and "Vercel Cron (reserved)". `CRON_SECRET` row stays in the active section because preview/dev still need it.
- Tests for `/lib/cron/qstash-auth.ts` — every failure path (missing signature, invalid signature, wrong-method routing). **One required Reviewer-pinned test** lives here: `CRON_TRIGGER='qstash'` + `NODE_ENV='development'` + `X-Cron-Dev-Trigger: true` + no signature → **401**, not dev-bypass. This is the lexical-unreachability property under test.

**Defers (explicit non-goals):**
- Migrating any other workload to QStash. This session is *only* about the two existing crons. Queue-style background work (e.g. future email retries) is its own future decision.
- Implementing QStash's at-least-once delivery semantics in the orchestrators. Both ticks are already idempotent (publish via `FOR UPDATE SKIP LOCKED`, metrics via re-upsert); QStash's retry behaviour is compatible with both. We document this in the amendment and move on — no orchestrator changes.
- Sentry Cron Monitor changes. The monitor wraps the orchestrator call, not the trigger, so it keeps working unchanged. The amendment notes this explicitly.
- A "pause the cron from the dashboard" admin feature. QStash supports it natively; document the URL in the runbook and move on.
- Replacing `CRON_SECRET` with anything. It stays required-in-production and becomes the auth mode when QStash env vars are absent. Removing it would couple this session to the Vercel-Cron rollback.

---

## Pre-session checklist

- [ ] Session 13 (Launch Hardening) fully complete — `current-phase.md` shows "Session 13D complete"
- [ ] Upstash account created (free tier), QStash console accessible
- [ ] Production Vercel project URL known (the QStash schedule will POST to it)
- [ ] You can confirm QStash free tier limits cover the expected cadence (`* * * * *` for publish + `0 * * * *` for metrics — at time of writing, free tier allows this; sanity check the pricing page)
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/db lib/social lib/campaigns lib/ai lib/publishing lib/stripe lib/metrics` passes (full suite green)
- [ ] `claude-mem` running at http://localhost:37777
- [ ] You re-skimmed ADR 0005 §12 (auth contract, dev-bypass rule), ADR 0006 §9 (delta-from-0005 contract), and the two cron route files — the diff this session produces should be tiny

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

Read /docs/decisions/0005-publishing-worker.md §12 (cron route
contract) and §13 (vercel.json contract) IN FULL.
Read /docs/decisions/0006-metrics-worker.md §9 (cron route — delta
from 0005 §12) and §10 (vercel.json) IN FULL.
Read /docs/decisions/0007-launch-hardening.md the Sentry Cron
Monitor section — confirm the monitor wraps the ORCHESTRATOR call,
not the trigger, so it survives a trigger swap.

Read /app/api/cron/publish/route.ts and
/app/api/cron/sync-metrics/route.ts — pay attention to the inline
auth block and the dev-bypass header handling. These are the only
files that will change beyond config + new module + docs.
Read vercel.json — note the current crons array.
Read /lib/config.ts — note the CRON_SECRET shape and the
production-required Zod refine.

Read the QStash docs at
https://upstash.com/docs/qstash/features/signatures
and
https://upstash.com/docs/qstash/sdks/ts/overview
(at minimum: how Receiver.verify works, the two-key rotation
pattern, what arrives in Upstash-Signature, whether the SDK
verifies against the raw request body).

Session 13.5 Part A — QStash Trigger Swap Architecture.
Architect role.

ARCHITECT BOUNDARY (strict, learned from Sessions 2, 3, 10, 12):
- Your only outputs are amendment blocks appended to:
    /docs/decisions/0005-publishing-worker.md
    /docs/decisions/0006-metrics-worker.md
- No new ADR file. No SQL. No TypeScript files. No vercel.json
  edits. No env changes. No code beyond TypeScript signatures
  inside the markdown.
- Both amendments must be SHORT — the 0006 amendment references
  the 0005 amendment instead of restating it (same pattern as
  ADR 0006 §9 referencing ADR 0005 §12).
- Your last action is a single confirmation line. Then I /exit.
- Do not attempt to "kick off" the Builder.

Use the architect ECC agent mindset:
1. List your key design decisions and any ambiguities
2. Wait for me to approve / override / clarify
3. Only then write the amendment blocks
4. Call out explicitly the ONE decision that gives this swap its
   non-trivial shape: how the route picks between QStash signature
   verification and CRON_SECRET Bearer auth WITHOUT making the
   dev-bypass header (Session 13 launch posture) reachable under
   QStash mode.

Acknowledge, list your planned decisions, wait for my approval.
```

### Decision list — confirm these before approving

The Architect surfaces its own list. Push back before paste-approving if the Architect proposes something materially different.

| # | Question | Expected answer |
|---|---|---|
| 1 | New ADR or amendment? | **Amendment.** No new ADR. ADR 0005 §12 and ADR 0006 §9 each gain a dated "Amendment 1 — Trigger Source" section at the end of the file, status `Accepted`. Sets the project convention for future amendments. |
| 2 | Auth mode selection rule (D1) | **Hard env-driven branch on `CRON_TRIGGER`**, not header-presence. `if (config.server.CRON_TRIGGER === 'qstash')` → QStash signature verification is the *only* accepted auth, route accepts `POST` only. `else` → existing `CRON_SECRET` Bearer + dev-bypass logic verbatim, route accepts `GET` only. Header-presence selection (Upstash-Signature presence → QStash) is **rejected** because it lets an attacker downgrade by omitting the header. |
| 3 | Lexical unreachability of dev-bypass in QStash mode | **Load-bearing.** Under `CRON_TRIGGER='qstash'`, the `X-Cron-Dev-Trigger` header is never consulted — not "guarded by an if", but *lexically unreachable* in the QStash branch. Even with `NODE_ENV='development'` + the header + no signature, the request 401s. A required Reviewer-pinned test enforces this. |
| 4 | Where does the auth live? (D6) | A new `/lib/cron/qstash-auth.ts` exports `verifyQStashRequest(request): Promise<void>` with a module-level `Receiver` singleton. **Bearer auth stays inline in the route's `else` branch — it is NOT extracted.** Trade-off: lower review risk (existing working code is wrapped, not rewritten), lexical separation of branches visible at the route level, Pro-tier flip is "delete the `if` branch" not "change function semantics". |
| 5 | QStash signature library | `@upstash/qstash` (`Receiver` class), version-pinned (no `^`). Use `verify({ signature, body, url })` where `body` is the raw text body and `url` is reconstructed from `request.url` (NextRequest gives the absolute URL). |
| 6 | Method handling (D3) | **Split `GET` and `POST` handlers** in the same `route.ts`. `GET` runs only when `CRON_TRIGGER === 'secret'` (else `405`); `POST` runs only when `CRON_TRIGGER === 'qstash'` (else `405`). Both delegate to the same inner orchestration function; only the auth differs. Mismatched method returns `405`, not `401`, so the contract is clear. |
| 7 | Raw body for signature verification (D4) | QStash signs `url + rawBody`. The POST handler awaits `request.text()` exactly once, before any parse, inside `verifyQStashRequest`. Body content is irrelevant to the orchestrator and is never parsed. |
| 8 | Key rotation (D5) | Both `QSTASH_CURRENT_SIGNING_KEY` AND `QSTASH_NEXT_SIGNING_KEY` are **required** when `CRON_TRIGGER='qstash'` in production (Zod `superRefine`). When no rotation is mid-flight, set NEXT equal to CURRENT so the verify path always has both. `Receiver` is constructed once at module load with both keys. |
| 9 | Cutover style (D2) | **Hard flip per environment, no dual mode.** Production sets `CRON_TRIGGER='qstash'` AND removes the `crons` array from `vercel.json` in the **same deploy**. Preview/dev stay on `secret`. No transitional window — the orchestrator's atomic claim could absorb double-fires, but it's needless waste and preview env smoke tests give the same safety. |
| 10 | What happens to `vercel.json` `crons`? (D9) | **Removed entirely** in the `CRON_TRIGGER='qstash'` deploy. Hobby will fail-deploy with the current schedules anyway. The reserved entries live in `docs/build-guide/runbooks/vercel-cron-restore.md` as a copy-paste-ready JSON block. |
| 11 | Manual on-call re-trigger in QStash mode (E) | The QStash console's **"Run now"** button on the schedule. **No `CRON_SECRET` fallback.** Mixing fallbacks is exactly the smell the lexical-unreachability property eliminates. Named explicitly in `qstash-setup.md`. |
| 12 | Operational artefacts | Two new runbooks: `qstash-setup.md` (provision + deploy + rotation + "Run now" for manual ops), `vercel-cron-restore.md` (Pro-tier flip back). `launch-checklist.md` §3 gets a "Trigger source" header with active/reserved sub-sections. |
| 13 | At-least-once delivery (D8) | QStash retries on non-2xx. The orchestrator's atomic claim (ADR 0005 §4, §7) already makes duplicate ticks safe. Amendment owes no new mechanism. **No orchestrator change.** |
| 14 | Sentry Cron Monitor compatibility (D7) | `Sentry.withMonitor()` wraps the orchestrator call inside the route, not the auth or trigger. Schedule values in `/lib/publishing/orchestrator.ts` and `/lib/metrics/orchestrator.ts` are unchanged; QStash is configured to fire at the same cadence. Confirmed in pre-read of ADR 0007 §3.5. |
| 15 | Config var shape (D5) | New `CRON_TRIGGER: 'qstash' \| 'secret'` enum (default `'secret'`). New `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`, both required-when-`CRON_TRIGGER='qstash'`-in-prod via `superRefine`. `CRON_SECRET` stays required-in-production regardless (preview/dev still need it). |
| 16 | Observability deltas | Per-tick structured log line gains `triggeredBy: config.server.CRON_TRIGGER` (`publish-tick` + `metrics-sync-tick`). Auth-failure warn line added to the QStash branch matching the existing Bearer-side warn — `{ kind: 'cron-auth-failure', route, trigger: 'qstash', reason }`. The `reason` is for logs only; the 401 body is the literal `"Unauthorized"` and MUST NOT leak the reason. |
| 17 | Redaction posture (D10) | Builder follow-up: add `Upstash-Signature` header value, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY` to the REDACTED_KEYS allow-list (ADR 0007 §3.3 — `lib/observability/sentry-scrub.ts`). |
| 18 | Reversal check | **No prior decisions reversed.** Extends ADR 0005 §12 and ADR 0006 §9. The original auth rule (Bearer + dev-bypass) remains operative under `CRON_TRIGGER='secret'`. Removing `CRON_SECRET` is explicitly out of scope. |

### Architect Prompt (after you approve the decision list)

> **Note:** Paste only after confirming the Architect's plan against the table above. This prompt locks the answers in as decisions, not options.

```
Approved to amend /docs/decisions/0005-publishing-worker.md and
/docs/decisions/0006-metrics-worker.md.

Your D1–D10 plan and A–F defaults are accepted as-is, with the
deltas and additions below. Do not re-open any of these in the
amendments — write them as decisions.

AMENDMENT PATTERN (sets project convention):
  Each ADR gains a final section titled exactly:
    "## Amendment 1 — Trigger Source (2026-XX-XX)"
  With sub-headers:
    Status: Accepted
    Date: <today>
    Scope: trigger source only (auth path, route method,
           vercel.json crons entry); orchestrator behaviour,
           response shape, Sentry monitor, cron_health unchanged
    Reversed by: (empty)
  Body stays tight. 0006's amendment is THREE paragraphs max and
  references "ADR 0005 Amendment 1" for shared rules — mirrors
  how ADR 0006 §9 references ADR 0005 §12 today.

HEADLINE DECISION (state it at the top of the 0005 amendment):
TRIGGER SOURCE IS A HARD ENV-DRIVEN BRANCH (D1, D2).
  - New env: CRON_TRIGGER: 'qstash' | 'secret', default 'secret'.
  - The route picks its auth path by HARD BRANCH on
    config.server.CRON_TRIGGER. Not by Upstash-Signature
    presence, not by Authorization header presence, not by
    feature flag.
  - Header-presence selection is REJECTED because an attacker
    could downgrade to the weaker path by omitting headers. Say
    this in plain words in the amendment so a future "refactor"
    doesn't reintroduce it.
  - LEXICAL UNREACHABILITY is the property:
      if (config.server.CRON_TRIGGER === 'qstash') {
        // QStash branch — Receiver.verify only. The Bearer path
        // and X-Cron-Dev-Trigger header are not consulted here,
        // not even guarded — they are lexically unreachable.
      } else {
        // Existing branch verbatim — Bearer CRON_SECRET, with
        // X-Cron-Dev-Trigger honoured only when
        // NODE_ENV !== 'production'. Unchanged from ADR 0005 §12.
      }
  - Per-environment hard cutover (D2): production flips to
    'qstash' AND removes the crons array from vercel.json in
    the SAME deploy. Preview/dev stay on 'secret'. No
    transitional dual-mode (the orchestrator's atomic claim
    could absorb double-fires, but it's needless waste and the
    preview smoke test already covers the safety question).

ROUTE DIFF MINIMALITY (the working code is untouched):
  The amendments must state explicitly that the route changes
  are:
    1. Wrap the existing Bearer + dev-bypass block in `else { … }`
       verbatim — DO NOT rewrite it, DO NOT extract it.
    2. Add `if (config.server.CRON_TRIGGER === 'qstash') { … }`
       above it, calling verifyQStashRequest(request).
    3. Add ONE field to the tick's structured log line (see below).
    4. Add ONE structured warn line on auth failure in the
       QStash branch (mirrors the existing Bearer-side warn —
       see below).
  Nothing else moves. The Reviewer should not see a diff that
  touches the orchestrator call, the Sentry.withMonitor wrapper,
  the always-200 contract, maxDuration, or the existing Bearer
  byte-for-byte logic. Call this out in the amendment so the
  Reviewer can use it as the diff-minimality test.

METHOD ASYMMETRY (D3):
  Route exports SPLIT GET and POST handlers in the same route.ts:
    - export async function GET(request) — runs only when
      CRON_TRIGGER === 'secret' (else 405).
    - export async function POST(request) — runs only when
      CRON_TRIGGER === 'qstash' (else 405).
    - Both delegate to the same inner orchestration function;
      only the auth differs.
  Document the asymmetry in the amendment. Manual on-call
  triggering of a QStash-mode prod route is done via the QStash
  console's "Run now" button on the schedule — name this
  explicitly in the amendment and in qstash-setup.md.
  EXPLICITLY REJECTED (D-E): no CRON_SECRET fallback in the
  QStash branch. Mixing fallbacks is exactly the smell the
  lexical-unreachability property eliminates.

QSTASH-ONLY HELPER (D6):
  /lib/cron/qstash-auth.ts exports:

    export async function verifyQStashRequest(
      request: NextRequest
    ): Promise<void>

  Construct Receiver as a module-level singleton from
  config.server.QSTASH_CURRENT_SIGNING_KEY and
  QSTASH_NEXT_SIGNING_KEY. Reads raw body via request.text()
  (D4 — once, before any parse). Reconstructs the full URL from
  request.url (NextRequest gives the absolute URL). Throws a
  typed error on any failure. Routes catch and return 401 with
  the literal body "Unauthorized" — never expose the reason.

  Bearer auth is NOT extracted. It stays inline in the `else`
  branch of each route, byte-identical to today. This is a
  deliberate choice (D6 trade-off):
    - Lower review risk: existing working code is touched only
      to wrap it in `else { … }`.
    - Lexical separation of branches is visible at the route
      level — a reader sees the QStash branch and the Bearer
      branch side by side without chasing through a helper.
    - When CRON_TRIGGER flips back to 'secret' on Pro tier, the
      Bearer path is reached by deleting the `if` branch, not
      by changing function semantics.
  State this trade-off in the amendment so the Reviewer doesn't
  flag the "asymmetric extraction" as a smell.

CONFIG (D5):
  /lib/config.ts gains:
    CRON_TRIGGER                 'qstash' | 'secret', default 'secret'
    QSTASH_CURRENT_SIGNING_KEY   required when CRON_TRIGGER='qstash'
    QSTASH_NEXT_SIGNING_KEY      required when CRON_TRIGGER='qstash'
                                 (set equal to CURRENT when no rotation
                                  in flight — verify path always has both)
  Zod superRefine: if CRON_TRIGGER === 'qstash' AND
  NODE_ENV === 'production', both QSTASH_*_SIGNING_KEY must be
  non-empty. Same shape as the existing prod-required CRON_SECRET
  refine.
  CRON_SECRET remains required-in-production regardless of
  CRON_TRIGGER, because preview/dev environments stay on 'secret'
  and need it. Removing CRON_SECRET is OUT OF SCOPE for this
  amendment.

OBSERVABILITY (the two log-line additions — load-bearing):
  1. Per-tick structured log line gains ONE new field:
       triggeredBy: config.server.CRON_TRIGGER
     Applied to BOTH publish-tick and metrics-sync-tick. This
     is what lets the post-Pro-flip operator confirm the
     rollback worked by tailing logs, not by guessing.
  2. Auth-failure warn line in BOTH branches with a `reason`
     field. The Bearer branch already does this today (do not
     change). The QStash branch matches it:
       console.warn(JSON.stringify({
         kind: 'cron-auth-failure',
         route: 'publish' | 'sync-metrics',
         trigger: 'qstash',
         reason: '<qstash-missing-signature | qstash-invalid-signature |
                   qstash-requires-post | qstash-config-missing>',
       }))
     The 401 response body is the literal string "Unauthorized"
     — the reason field is for the log only and MUST NOT be
     leaked to the client. Pin a test on body equality.
  3. NO other console.* additions. The signing-key material
     and the Upstash-Signature value never appear in any log,
     anywhere.

VERCEL.JSON (D9):
  Remove the `crons` array in the production deploy where
  CRON_TRIGGER='qstash'. State this as a single-sentence delta to
  ADR 0005 §13 in the amendment:
    "When CRON_TRIGGER=qstash in the target environment, the
     corresponding crons entry is removed from vercel.json for
     that deploy."
  The reserved JSON block (full crons array, both routes, original
  schedules) lives verbatim in
  docs/build-guide/runbooks/vercel-cron-restore.md — ready to
  paste back when Pro lands. Name this file in the amendment.

AT-LEAST-ONCE + SENTRY (D7, D8 — one sentence each):
  - At-least-once delivery: QStash retries on non-2xx; the
    orchestrator's atomic claim (ADR 0005 §4, §7) already makes
    duplicate ticks safe. The amendment owes no new mechanism.
  - Sentry Cron Monitor (ADR 0007 §3.5) wraps the orchestrator
    call, not the route or the trigger. Schedule values in
    /lib/publishing/orchestrator.ts and /lib/metrics/orchestrator.ts
    are unchanged; the monitor reflects the cadence we expect, and
    QStash is configured to fire at the same cadence. Confirmed
    in the pre-read.

REDACTION (D10):
  Builder follow-up note in the amendment, not a new ADR section:
  add `Upstash-Signature` (header value, a JWS — non-secret but
  noise in breadcrumbs), `QSTASH_CURRENT_SIGNING_KEY`, and
  `QSTASH_NEXT_SIGNING_KEY` to the REDACTED_KEYS allow-list
  (ADR 0007 §3.3 — the lib/observability/sentry-scrub.ts source
  of truth).

RUNBOOKS (filenames fixed; Architect outlines, Builder fills):
  docs/build-guide/runbooks/qstash-setup.md — provision + deploy,
    INCLUDING: manual on-call re-trigger is the QStash console's
    "Run now" button on the schedule. There is no curl-with-Bearer
    equivalent in qstash mode (rejected by D-E).
  docs/build-guide/runbooks/vercel-cron-restore.md — the future
    Pro-tier flip: set CRON_TRIGGER='secret', remove the two
    QSTASH_*_SIGNING_KEY env vars, paste the reserved JSON block
    back into vercel.json, redeploy. Zero code change.

LAUNCH CHECKLIST UPDATE (named here, written by Builder):
  docs/launch-checklist.md §3 (Cron) gains a "Trigger source"
  sub-header with two parallel sections: "QStash (active at
  launch)" and "Vercel Cron (reserved)". The CRON_SECRET row
  stays in the active section because preview/dev still need it.

────────────────────────────────────────────────────────────

REVIEWER PIN (state this in the amendment as a required test):
  A test must assert that in CRON_TRIGGER='qstash' mode, with
  NODE_ENV='development', a request carrying X-Cron-Dev-Trigger:
  true and NO Upstash-Signature returns 401 — NOT dev-bypass.
  This is the lexical-unreachability property under test. It is
  the single most likely silent regression if someone later
  "consolidates" the two branches into a unified verifier.

────────────────────────────────────────────────────────────

Each amendment must contain, in this order:

ADR 0005 Amendment 1 — Trigger Source:
  1. Status / Date / Scope / Reversed-by header
  2. Headline decision: hard env-driven branch on CRON_TRIGGER;
     lexical unreachability of dev-bypass under QStash mode;
     header-presence selection explicitly rejected with reason
  3. Route diff minimality contract — what changes, what does
     NOT (use it as the Reviewer's diff-minimality reference)
  4. The /lib/cron/qstash-auth.ts contract (signature only,
     TypeScript signatures NOT implementation); Bearer stays
     inline in the route's `else` branch with the D6 trade-off
     note
  5. Method asymmetry (GET = Bearer mode, POST = QStash mode,
     split handlers in the same route.ts, 405 on mismatch);
     manual-ops path is QStash console "Run now", explicitly
     not a CRON_SECRET fallback
  6. Observability deltas: triggeredBy in tick log,
     cron-auth-failure warn line in QStash branch matching
     Bearer side, no other console.* changes, REDACTED_KEYS
     additions
  7. vercel.json delta (one sentence; crons removed when
     CRON_TRIGGER=qstash; reserved block in
     vercel-cron-restore.md)
  8. Config additions (CRON_TRIGGER enum default 'secret';
     QSTASH_*_SIGNING_KEY required-when-qstash-in-prod refine)
  9. At-least-once + Sentry compatibility (one sentence each;
     no orchestrator change; monitor cadence unchanged)
  10. Required-test pin: the dev-bypass-in-QStash-mode 401 test
  11. Rollback procedure (cross-reference
      vercel-cron-restore.md)
  12. Out of scope (other workloads, queue-style work, dropping
      CRON_SECRET, dual-mode operation, header-presence
      selection)
  13. Open follow-up: re-enable Vercel Cron on Pro tier — one
      env var flip + one vercel.json edit; no code change

ADR 0006 Amendment 1 — Trigger Source:
  1. Status / Date / Scope / Reversed-by header
  2. "All trigger-source changes are governed by ADR 0005
     Amendment 1. This amendment lists only the metrics-worker
     specific deltas."
  3. vercel.json delta is symmetric — the /api/cron/sync-metrics
     entry is also removed in the qstash deploy, restored from
     vercel-cron-restore.md on the Pro flip. Cadence
     '0 * * * *' is preserved in both modes.
  4. Confirm: no Phase A/B split (ADR 0006 §9 already states
     this) → the body QStash POSTs is irrelevant; orchestrator
     ignores it.

Confirm with one line, then /exit.
```

### After Part A

```
git add docs/decisions/0005-publishing-worker.md docs/decisions/0006-metrics-worker.md
git commit -m "Session 13.5A: ADR 0005/0006 Amendment 1 — trigger source"
git push
```

`/exit` Claude Code. **Paste the amendment text to Claude.ai for review before Part B.** If the amendment contradicts the locked decisions above, stop and re-prompt the Architect.

---

## Part B — Builder Session (Sonnet 4.6)

> Wait for Claude.ai to confirm the amendments before starting.

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.

Read /docs/decisions/0005-publishing-worker.md §12, §13, and
Amendment 1 (the new section).
Read /docs/decisions/0006-metrics-worker.md §9, §10, and
Amendment 1.
Read /docs/decisions/0007-launch-hardening.md the Sentry Cron
Monitor section — your route changes must not break it.

The amendments are your single source of truth. They override
anything in this primer or earlier discussion.

Read /app/api/cron/publish/route.ts and
/app/api/cron/sync-metrics/route.ts IN FULL. Your changes
to these are minimal: wrap the existing handler body in an
`else { … }` branch BYTE-IDENTICALLY (do not rewrite the
existing Bearer/dev-bypass logic), add a new
`if (config.server.CRON_TRIGGER === 'qstash') { … }` branch
above it, split into separate GET and POST exports per the
amendment's method asymmetry, add `triggeredBy:
config.server.CRON_TRIGGER` to the structured tick log line,
add a `cron-auth-failure` warn line in the QStash branch
matching the existing Bearer-side warn. Nothing else.
Read /lib/config.ts — note where CRON_SECRET lives and how the
production refine works. You're adding CRON_TRIGGER (enum,
default 'secret') and QSTASH_CURRENT_SIGNING_KEY /
QSTASH_NEXT_SIGNING_KEY (required-when-CRON_TRIGGER='qstash'-
in-production via superRefine).
Read vercel.json — you will remove the crons array.
Read docs/launch-checklist.md §3 — you will restructure it under
a "Trigger source" sub-header.
Read /lib/observability/sentry-scrub.ts (ADR 0007 §3.3) — you
will add three keys to REDACTED_KEYS.

Session 13.5 Part B — QStash trigger swap implementation.
Builder role.

ECC workflow (prefix /everything-claude-code: not /ecc:):
- /everything-claude-code:plan before each prompt
- /everything-claude-code:tdd for TypeScript with logic branches
- /everything-claude-code:verify after each prompt — do not
  proceed if it fails

Patterns from CLAUDE.md to follow strictly:
- No process.env outside /lib/config.ts
- No `any`, and only the authorised console.* lines: the existing
  cron-tick `console.log` and the existing Bearer-side
  `cron-auth-failure` warn (already present per ADR 0005 §12).
  The QStash-branch warn this session adds is the MATCHING pair
  to that existing line, not a third surface.
- formatISO() for all timestamp writes
- All strings through next-intl where they reach a user; auth
  failure responses are an exception (generic literal "Unauthorized"
  per ADR 0005 §12 — pin a unit test on the body equality)

Tools you'll need:
  npm install @upstash/qstash

Acknowledge, then I'll send prompts one at a time.
```

### Prompt B1 — Config additions

```
/everything-claude-code:plan "Add CRON_TRIGGER enum + the two
QSTASH signing keys to /lib/config.ts with a superRefine that
enforces both keys present when CRON_TRIGGER='qstash' in
production"

Add to the server-side Zod schema:

  CRON_TRIGGER:
    z.enum(['qstash', 'secret']).default('secret')

  QSTASH_CURRENT_SIGNING_KEY:
    z.string().min(1).optional()

  QSTASH_NEXT_SIGNING_KEY:
    z.string().min(1).optional()

Add a superRefine (same shape as the existing CRON_SECRET prod
gate):
  - if data.CRON_TRIGGER === 'qstash' AND
       data.NODE_ENV === 'production' AND
       (!data.QSTASH_CURRENT_SIGNING_KEY ||
        !data.QSTASH_NEXT_SIGNING_KEY):
    → ctx.addIssue with a clear message naming BOTH vars.

CRON_SECRET stays required-in-production unchanged — do not
touch its refine. Removing CRON_SECRET is out of scope.

Tests in /lib/__tests__/config.test.ts (or wherever existing
config tests live):
- CRON_TRIGGER unset → defaults to 'secret', valid
- CRON_TRIGGER='secret', NODE_ENV='production', no QSTASH keys
  → valid (Bearer mode)
- CRON_TRIGGER='qstash', NODE_ENV='production', both QSTASH
  keys present → valid
- CRON_TRIGGER='qstash', NODE_ENV='production', only CURRENT
  → ZodError naming both vars
- CRON_TRIGGER='qstash', NODE_ENV='production', only NEXT
  → ZodError naming both vars
- CRON_TRIGGER='qstash', NODE_ENV='production', neither
  → ZodError naming both vars
- CRON_TRIGGER='qstash', NODE_ENV='development', no QSTASH keys
  → valid (dev/preview can be qstash without prod-level
  enforcement; the route's verifyQStashRequest will still 401
  on missing signature, so this is a soft local-dev affordance,
  not a production hole)

/everything-claude-code:verify
```

### Prompt B2 — /lib/cron/qstash-auth.ts

```
/everything-claude-code:tdd "QStash signature verification helper"

Create /lib/cron/qstash-auth.ts per ADR 0005 Amendment 1.

This is QStash-ONLY. Bearer auth is NOT touched and stays inline
in the routes' `else` branch (D6 trade-off — see amendment).

Export:
  export class QStashAuthError extends Error {
    constructor(public readonly reason: string) {
      super('Unauthorized')
      this.name = 'QStashAuthError'
    }
  }

  export async function verifyQStashRequest(
    request: NextRequest
  ): Promise<void>

Implementation:

  // Module-level singleton (D6). Constructed lazily on first call
  // so test mocks of @upstash/qstash and config can take effect.
  let receiver: Receiver | null = null
  function getReceiver(): Receiver {
    if (receiver) return receiver
    const current = config.server.QSTASH_CURRENT_SIGNING_KEY
    const next = config.server.QSTASH_NEXT_SIGNING_KEY
    if (!current || !next) {
      throw new QStashAuthError('qstash-config-missing')
    }
    receiver = new Receiver({
      currentSigningKey: current,
      nextSigningKey: next,
    })
    return receiver
  }

  export async function verifyQStashRequest(
    request: NextRequest
  ): Promise<void> {
    if (request.method !== 'POST') {
      throw new QStashAuthError('qstash-requires-post')
    }
    const signature = request.headers.get('upstash-signature')
    if (!signature) {
      throw new QStashAuthError('qstash-missing-signature')
    }
    // Raw body — must be read once, before any parse (D4).
    const body = await request.text()
    try {
      await getReceiver().verify({
        signature,
        body,
        url: request.url,
      })
    } catch {
      throw new QStashAuthError('qstash-invalid-signature')
    }
  }

CRITICAL:
- DO NOT consult X-Cron-Dev-Trigger here. Dev-bypass is NOT a
  concept in the QStash branch — it is lexically unreachable
  by design (amendment headline). A test pins this.
- DO NOT read CRON_SECRET here. Bearer is a separate branch in
  the route, not a fallback within QStash.
- DO NOT log signing-key material or the Upstash-Signature value.
  The route's `cron-auth-failure` warn line logs only the
  `reason` field.

Import surface: @upstash/qstash (Receiver), @/lib/config,
next/server (NextRequest). Nothing else.

Tests in /lib/cron/__tests__/qstash-auth.test.ts — mock
@upstash/qstash via vi.mock with a Receiver factory whose
verify() resolves on happy path and throws on sad. Cover:

- valid POST + valid signature → resolves (no throw)
- GET request → QStashAuthError('qstash-requires-post')
- PUT/DELETE/PATCH → QStashAuthError('qstash-requires-post')
- POST with no Upstash-Signature header
  → QStashAuthError('qstash-missing-signature')
- POST with invalid signature (Receiver.verify throws)
  → QStashAuthError('qstash-invalid-signature')
- Config missing CURRENT key
  → QStashAuthError('qstash-config-missing')
- Config missing NEXT key
  → QStashAuthError('qstash-config-missing')
- Error.message is the literal "Unauthorized" in EVERY thrown
  case (pin with strict equality assert) — the reason field is
  internal and never reaches the response body.

/everything-claude-code:verify
```

### Prompt B3 — Wire the two routes

```
/everything-claude-code:plan "Hard branch on CRON_TRIGGER in
both cron routes; wrap existing handler body in else verbatim;
add new if branch for QStash; split GET/POST exports"

Edit /app/api/cron/publish/route.ts.

The CRITICAL diff-minimality property (amendment §3): the
existing Bearer + dev-bypass + Sentry-wrapped orchestrator body
is wrapped in `else { … }` BYTE-IDENTICALLY. Do not touch its
internals. The route only gains a sibling `if` branch above it,
plus the GET/POST split and one log-line field.

Shape:

    async function publishTick(request: NextRequest) {
      if (config.server.CRON_TRIGGER === 'qstash') {
        // QStash branch — lexically separate from Bearer.
        // X-Cron-Dev-Trigger is NOT consulted here.
        try {
          await verifyQStashRequest(request)
        } catch (e) {
          console.warn(JSON.stringify({
            kind: 'cron-auth-failure',
            route: 'publish',
            trigger: 'qstash',
            reason: e instanceof QStashAuthError ? e.reason : 'unknown',
          }))
          return new Response('Unauthorized', { status: 401 })
        }
      } else {
        // Existing Bearer + dev-bypass logic — BYTE-IDENTICAL to
        // pre-Session-13.5 code. Includes the existing
        // cron-auth-failure warn line on Bearer failures.
        // <existing inline auth block, unchanged>
      }

      // Existing tick body BELOW this point is UNCHANGED except
      // for the structured log line, which gains ONE field:
      //
      //   triggeredBy: config.server.CRON_TRIGGER
      //
      // Sentry.withMonitor wrapper, orchestrator call, always-200
      // contract, return shape — all UNCHANGED.

      const summary = await Sentry.withMonitor('publish-tick',
        () => runPublishTick({ /* unchanged */ }))

      console.log(JSON.stringify({
        kind: 'publish-tick',
        triggeredBy: config.server.CRON_TRIGGER,
        ...summary,
      }))

      // existing 200 response, unchanged
    }

    // Method asymmetry (amendment §5): split exports, 405 on mismatch.
    export async function GET(request: NextRequest) {
      if (config.server.CRON_TRIGGER === 'qstash') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      return publishTick(request)
    }
    export async function POST(request: NextRequest) {
      if (config.server.CRON_TRIGGER !== 'qstash') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      return publishTick(request)
    }

    export const maxDuration = 60  // unchanged

Edit /app/api/cron/sync-metrics/route.ts:
- Identical pattern. Inner function named `metricsSyncTick`.
- Log line: `kind: 'metrics-sync-tick', triggeredBy: config.server.CRON_TRIGGER`.
- The cron-auth-failure warn uses `route: 'sync-metrics'`.
- Sentry monitor slug unchanged.
- Always-200 contract on internal exception unchanged.

Add three keys to /lib/observability/sentry-scrub.ts
REDACTED_KEYS allow-list (ADR 0007 §3.3):
  'upstash-signature'             (header value, JWS — noise)
  'QSTASH_CURRENT_SIGNING_KEY'    (secret)
  'QSTASH_NEXT_SIGNING_KEY'       (secret)

Tests for both routes (extend existing test files; do NOT delete
the existing Bearer-mode tests — they cover the `else` branch
which is still reachable when CRON_TRIGGER='secret'):

Existing tests (preserved, may need `CRON_TRIGGER='secret'`
explicit in test env setup):
- Bearer happy path with GET → 200 + triggeredBy: 'secret' in log
- Dev-bypass header in development (CRON_TRIGGER='secret') → 200
- Dev-bypass header in production (CRON_TRIGGER='secret') → 401
- Missing Authorization → 401
- Wrong CRON_SECRET → 401

New tests under CRON_TRIGGER='qstash' (mock the Receiver):
- POST + valid signature → 200 + triggeredBy: 'qstash' in log
- POST + invalid signature → 401 + cron-auth-failure warn with
  reason='qstash-invalid-signature'
- POST + missing Upstash-Signature → 401 + reason=
  'qstash-missing-signature'
- GET → 405 Method Not Allowed
- POST under CRON_TRIGGER='secret' → 405 Method Not Allowed

REVIEWER-PINNED REQUIRED TEST (amendment §10):
- CRON_TRIGGER='qstash', NODE_ENV='development',
  X-Cron-Dev-Trigger: true, no Upstash-Signature, POST request
  → 401 (NOT dev-bypass, NOT 200, NOT 405).
  This is the lexical-unreachability property. The test MUST be
  named explicitly and pin the status to 401 and the warn line's
  reason to 'qstash-missing-signature' (the dev-bypass header is
  not consulted, so missing signature is what fails first).

Do NOT change the orchestrator calls, response shape, error
handling, Sentry wrapping, or maxDuration. The diff per route is
the new `if (CRON_TRIGGER === 'qstash')` branch + the `else`
wrap + the GET/POST split + the `triggeredBy` log field.
Anything else is a Reviewer finding.

/everything-claude-code:verify
```

### Prompt B4 — vercel.json + runbooks + launch-checklist

```
/everything-claude-code:plan "Remove vercel.json crons; write
qstash-setup + vercel-cron-restore runbooks; restructure
launch-checklist §3 under a Trigger source header"

1. vercel.json — remove the `crons` array entirely. If it was the
   only top-level key, leave an empty object `{}` (or just delete
   the file if no other content; double-check `next.config.ts`,
   ignore-build-step settings, etc. — only delete keys, not other
   config).

2. docs/build-guide/runbooks/qstash-setup.md — operational runbook:
   - Prerequisites: Upstash account, production Vercel URL
   - Step 1: Create QStash schedule for publish route
     - Destination URL: https://<prod-domain>/api/cron/publish
     - Method: POST
     - Cron: * * * * *
     - Retries: 3 (default)
     - Body: empty
   - Step 2: Create QStash schedule for metrics route
     - Destination URL: https://<prod-domain>/api/cron/sync-metrics
     - Method: POST
     - Cron: 0 * * * *
     - Retries: 3
     - Body: empty
   - Step 3: Set production env vars (in this order, single deploy):
     - `CRON_TRIGGER=qstash`
     - `QSTASH_CURRENT_SIGNING_KEY` (copy from QStash console →
       Settings → Signing keys)
     - `QSTASH_NEXT_SIGNING_KEY` (same value as CURRENT when no
       rotation is mid-flight; both vars MUST be set or boot fails
       per the Zod superRefine)
     - Remove the `crons` array from `vercel.json` in the same
       commit that flips `CRON_TRIGGER` (D2 — hard cutover; both
       triggers firing simultaneously is needless duplication).
     - Redeploy.
   - Step 4: Smoke test
     - In Vercel logs, look for the structured publish-tick
       within 60 seconds with `triggeredBy: 'qstash'`.
     - In Vercel logs, look for the metrics-sync-tick within
       the first hour with `triggeredBy: 'qstash'` (Phase 1:
       synced=0, skippedNotImplemented=N).
   - Step 5: Pause/resume + manual on-call re-trigger reference —
     pause/resume from the QStash console schedule view; **manual
     re-trigger uses the "Run now" button on the schedule** (this
     is the ONLY supported manual-ops path in QStash mode — there
     is no CRON_SECRET fallback, see amendment §5)
   - Step 6: Key rotation procedure — both keys rotate via
     console; the Receiver singleton accepts CURRENT or NEXT, so
     rotation is: set NEXT to the new key, redeploy, wait for the
     window in which both old + new are accepted by upstream, then
     set CURRENT to the new key and NEXT back to equal CURRENT,
     redeploy. Zero downtime.
   - Step 7: Alerting — link the QStash failure alerting docs;
     Sentry Cron Monitor (ADR 0007) is the primary alert path
     for missed ticks regardless of trigger source

3. docs/build-guide/runbooks/vercel-cron-restore.md — the reverse
   runbook for the day we upgrade to Vercel Pro:
   - Step 1: Disable both QStash schedules in the QStash console
     (do NOT delete; pause is reversible)
   - Step 2: Set CRON_TRIGGER='secret' (or remove the var
     entirely — default is 'secret') AND remove
     QSTASH_CURRENT_SIGNING_KEY + QSTASH_NEXT_SIGNING_KEY from
     Vercel production env
   - Step 3: Restore the crons array in vercel.json — exact JSON
     block below (paste verbatim):

     "crons": [
       { "path": "/api/cron/publish",      "schedule": "* * * * *" },
       { "path": "/api/cron/sync-metrics", "schedule": "0 * * * *" }
     ]

   - Step 4: Redeploy. The route hard-branches on CRON_TRIGGER;
     with 'secret' selected, the existing inline Bearer +
     dev-bypass logic runs unchanged. Zero code change required.
   - Step 5: Smoke test — look for `triggeredBy: 'secret'` in
     the next tick's structured log, AND confirm the publish
     route now answers GET (not POST — the method asymmetry
     flipped with the trigger)
   - Step 6: After 24h of stable operation, delete the paused
     QStash schedules

4. docs/launch-checklist.md §3 — restructure under a single
   "Trigger source" sub-header with two parallel sections:
   "QStash (active at launch)" — checklist items mirroring
     qstash-setup.md (env vars set; schedules visible in QStash
     console; first tick observed with triggeredBy='qstash';
     cron_health rows present)
   "Vercel Cron (reserved)" — one row pointing to
     vercel-cron-restore.md, noting it's not active at launch
   Keep the existing CRON_SECRET row in the active section
   (Bearer is the fallback mode; the secret must still be set
   so the dev-bypass tests and the local-dev curl path work).

/everything-claude-code:verify
```

### After Part B

```
git add .
git commit -m "Session 13.5B: QStash cron trigger implementation + runbooks"
git push
```

`/exit` Claude Code.

**Live smoke test before Part C** (do this BEFORE running the reviewer — otherwise the reviewer can't confirm `triggeredBy` is correct):
1. In a Vercel preview env, set `CRON_TRIGGER=qstash` and both `QSTASH_*_SIGNING_KEY` vars.
2. Deploy.
3. From the QStash console, create a one-off schedule pointing at the preview's `/api/cron/publish` (or hit the schedule's "Run now").
4. Confirm the Vercel logs show one `publish-tick` line with `triggeredBy: 'qstash'`, no `cron-auth-failure` lines.
5. In a second preview env with `CRON_TRIGGER=secret` (or unset) and no QSTASH vars, `curl -H 'Authorization: Bearer $CRON_SECRET' https://<preview>/api/cron/publish` (GET) — confirm `triggeredBy: 'secret'`.
6. Same `CRON_TRIGGER=secret` env, `curl -X POST -H 'Authorization: Bearer $CRON_SECRET' https://<preview>/api/cron/publish` → expect `405 Method Not Allowed` (method asymmetry).
7. `CRON_TRIGGER=qstash` env, `curl -X POST https://<preview>/api/cron/publish` with no Upstash-Signature → expect `401 Unauthorized` (no reason leaked in body).
8. **Lexical-unreachability smoke** (the reviewer pin in shell form): `CRON_TRIGGER=qstash` env, `curl -X POST -H 'X-Cron-Dev-Trigger: true' https://<preview>/api/cron/publish` with no signature → expect `401 Unauthorized`, and the warn line's reason should be `qstash-missing-signature`, NOT a dev-bypass succeeding.

---

## Part C — Reviewer Session (Opus 4.7)

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.
Read /docs/decisions/0005-publishing-worker.md §12, §13, Amendment 1.
Read /docs/decisions/0006-metrics-worker.md §9, §10, Amendment 1.
Read /docs/decisions/0007-launch-hardening.md the Sentry Cron
Monitor section AND §3.3 (REDACTED_KEYS).

Read /lib/cron/qstash-auth.ts and its tests.
Read /app/api/cron/publish/route.ts and
/app/api/cron/sync-metrics/route.ts and their tests.
Read /lib/config.ts (CRON_TRIGGER enum + the QSTASH superRefine).
Read /lib/observability/sentry-scrub.ts (REDACTED_KEYS).
Read vercel.json (confirm crons removed).
Read docs/build-guide/runbooks/qstash-setup.md and
docs/build-guide/runbooks/vercel-cron-restore.md.
Read docs/launch-checklist.md §3.

Session 13.5 Part C — security & correctness review. Reviewer
role. Opus 4.7. Audit only; no edits.

Produce a structured report:

SECTION A — HARD-BRANCH SELECTION & LEXICAL UNREACHABILITY
A1. Each route picks its auth path by a HARD branch on
    `config.server.CRON_TRIGGER === 'qstash'`, NOT by
    Upstash-Signature header presence, Authorization header
    presence, or any other request-derived signal? (Header-presence
    selection enables downgrade attacks; amendment §2 rejects it.)
A2. In the `if (CRON_TRIGGER === 'qstash')` branch, is the
    X-Cron-Dev-Trigger header LEXICALLY UNREACHABLE — i.e. neither
    /lib/cron/qstash-auth.ts NOR the route's qstash branch contains
    any reference to that header? grep both files: zero hits in
    qstash-auth.ts, and any hit in route.ts must be inside the
    `else` branch.
A3. The reviewer-pinned test exists and asserts that
    `CRON_TRIGGER='qstash'` + `NODE_ENV='development'` +
    `X-Cron-Dev-Trigger: true` + missing signature returns 401
    with reason='qstash-missing-signature' (NOT dev-bypass,
    NOT 200, NOT 405)?
A4. NODE_ENV is read only via config — no process.env outside
    /lib/config.ts in any new code?
A5. CRON_TRIGGER's Zod schema is the enum `['qstash', 'secret']`
    with default 'secret', and the superRefine fires only when
    CRON_TRIGGER='qstash' AND NODE_ENV='production' AND either
    QSTASH_*_SIGNING_KEY is missing?

SECTION B — QSTASH SIGNATURE VERIFICATION
B1. Receiver is constructed with BOTH current and next signing
    keys (zero-downtime rotation supported)?
B2. Receiver is a module-level singleton (lazy-constructed once),
    not rebuilt per request?
B3. verify() is called with the RAW body — request.text()
    called once, before any parse, inside verifyQStashRequest?
B4. The url parameter to verify() is request.url (absolute on
    NextRequest), not a reconstruction from headers?
B5. POST is enforced inside verifyQStashRequest (in addition to
    the route's GET/POST split)? Defence in depth.
B6. Every failure path throws QStashAuthError with a `reason`
    field; Error.message is the literal "Unauthorized" in EVERY
    case (test asserts strict equality)?
B7. @upstash/qstash is version-pinned (no `^` or `~`)?
B8. /lib/cron/qstash-auth.ts contains NO reference to
    CRON_SECRET, X-Cron-Dev-Trigger, or Bearer logic? (Lexical
    separation — D6.)

SECTION C — BEARER BRANCH PRESERVATION (the `else` block)
C1. The existing ADR 0005 §12 auth logic in the route's `else`
    branch is BYTE-IDENTICAL to pre-Session-13.5 (modulo
    surrounding indentation from the new `else { … }` wrap)?
    Compare via `git log -p` against the pre-session commit and
    confirm no semantic change inside the block.
C2. CRON_SECRET remains required-in-production (its Zod refine
    untouched)?
C3. The existing "dev-bypass header in production returns 401"
    test is alive and routed through the `else` branch under
    CRON_TRIGGER='secret' — not deleted, not weakened?
C4. The existing Bearer-side cron-auth-failure warn line is
    preserved and unchanged?

SECTION D — METHOD ASYMMETRY
D1. Both routes export distinct `GET` and `POST` functions
    (not one handler aliased to both)? Each guards with a 405
    when called under the wrong CRON_TRIGGER?
D2. GET under CRON_TRIGGER='qstash' returns 405 (Method Not
    Allowed), NOT 401?
D3. POST under CRON_TRIGGER='secret' returns 405, NOT 401?
    (The contract: wrong-method is `405`, wrong-auth is `401`.)
D4. Sentry Cron Monitor wraps the orchestrator call inside
    publishTick/metricsSyncTick — both GET and POST routes
    reach the same wrapped orchestrator?

SECTION E — ROUTE DIFF MINIMALITY (amendment §3)
E1. The ONLY changes inside both route files are:
    (a) existing handler body wrapped in `else { … }` verbatim,
    (b) new `if (config.server.CRON_TRIGGER === 'qstash') { … }`
        branch above the else, calling verifyQStashRequest +
        catching to a 401 with a `cron-auth-failure` warn line,
    (c) split GET/POST exports each guarding their CRON_TRIGGER
        value with a 405,
    (d) `triggeredBy: config.server.CRON_TRIGGER` field added to
        the existing tick log line.
    Confirm via `git diff` — any other change inside the route
    files is a Reviewer finding.
E2. Orchestrator calls (runPublishTick, runMetricsTick) are
    unchanged in signature and call site?
E3. maxDuration unchanged on both routes?
E4. Always-200 contract on internal orchestrator exception is
    unchanged?
E5. No orchestrator file (/lib/publishing/orchestrator.ts,
    /lib/metrics/orchestrator.ts) has any diff in this session?

SECTION F — VERCEL.JSON & ROLLBACK READINESS
F1. vercel.json `crons` array removed entirely (not modified to
    daily — fully removed)?
F2. vercel-cron-restore.md contains the EXACT JSON block needed
    to restore (verbatim paste, both routes, original schedules
    `* * * * *` and `0 * * * *`)?
F3. The rollback procedure is code-change-free? Setting
    CRON_TRIGGER='secret' + removing QSTASH_* env vars +
    pasting the crons block back into vercel.json reaches the
    `else` branch automatically?
F4. qstash-setup.md covers two-key rotation (set NEXT to new key,
    redeploy, then promote NEXT to CURRENT, redeploy)?
F5. qstash-setup.md names the QStash console "Run now" button
    as the manual on-call re-trigger path AND states explicitly
    that there is no CRON_SECRET fallback in QStash mode?

SECTION G — IDEMPOTENCY & AT-LEAST-ONCE
G1. The 0005 amendment names the FOR UPDATE SKIP LOCKED claim
    (ADR 0005 §4, §7) as the idempotency guarantee that makes
    QStash retries safe?
G2. The 0006 amendment confirms metrics re-upserts are
    idempotent under QStash retries?
G3. Neither amendment introduces any orchestrator change? (The
    orchestrator files in /lib/publishing/ and /lib/metrics/
    should have ZERO diff in this session — confirms E5.)

SECTION H — OBSERVABILITY & REDACTION
H1. The structured tick log line includes
    `triggeredBy: config.server.CRON_TRIGGER` (literal field name
    `triggeredBy`, value `'qstash'` or `'secret'`) on BOTH
    publish-tick and metrics-sync-tick?
H2. The QStash-branch `cron-auth-failure` warn line is the
    MATCHING pair to the existing Bearer-side warn (same `kind`,
    same shape, with `trigger: 'qstash'` added)? It logs only
    the `reason` field — never the signature value, signing keys,
    or any header values verbatim?
H3. The 401 response body is the literal string "Unauthorized"
    on every auth failure path? No leak of the `reason` into
    the response body? (Pin a test on body equality.)
H4. /lib/observability/sentry-scrub.ts REDACTED_KEYS gained:
    'upstash-signature', 'QSTASH_CURRENT_SIGNING_KEY',
    'QSTASH_NEXT_SIGNING_KEY'?
H5. Sentry Cron Monitor check-ins fire on every successful tick
    under both CRON_TRIGGER values (the monitor wraps the
    orchestrator call — confirm no regression by reading the
    route diff and the orchestrator files)?
H6. cron_health row writes (Session 13) still happen on each
    successful tick under both modes?

SECTION I — CONVENTIONS
I1. No process.env outside /lib/config.ts in any new code?
I2. No `any` in new code?
I3. Only the existing authorised console.* surfaces are used:
    the per-tick structured log line and the cron-auth-failure
    warn (one Bearer, one QStash). No third console.* added?
I4. formatISO for any new timestamp writes (likely zero in this
    session, but check)?
I5. Launch checklist §3 references both runbooks under the
    "Trigger source" sub-header?

Final Verdict section listing:
- Blockers before deploying to production (must observe
  `triggeredBy: 'qstash'` in the first prod tick)
- Blockers before the future Vercel Cron flip (rollback
  runbook completeness — Pro-tier flip must be code-change-free)
- Tech debt acceptable to defer
```

### After Part C

```
git add .
git commit -m "Session 13.5C: QStash trigger swap review"
git push
```

`/exit` Claude Code. **Paste the full report to Claude.ai.** Severity is evaluated and a Session 13.5D correction prompt follows if there are any ❌.

---

## Part D — Correction Pass (only if reviewer finds blockers)

> Skip if the reviewer reports zero ❌ and only minor ⚠️.

Fresh Sonnet 4.6 session. Fix every ❌. Do not change anything marked ✅ or deferred as ⚠️.

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0005-publishing-worker.md (especially Amendment 1),
/docs/decisions/0006-metrics-worker.md (especially Amendment 1).
Read the Session 13.5C reviewer report (below).
Fix all ❌ blockers. List what you'll change before touching a file.

[paste reviewer report here]

Fix only the listed ❌ items. After each fix run:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/cron lib/config lib/observability app/api/cron

Report: which fixes applied, final tsc + vitest status.
```

```
git add .
git commit -m "Session 13.5D: corrections applied, Session 13.5 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 13.5 complete.

Amendments locked:
- ADR 0005 §12 Amendment 1 — Trigger Source: [committed]
- ADR 0006 §9 Amendment 1 — Trigger Source: [committed]

Implementation:
- /lib/cron/qstash-auth.ts: [LOC, test count]
- /app/api/cron/publish/route.ts diff: [lines added / removed]
  Bearer `else` branch is byte-identical to pre-session: [yes/no]
- /app/api/cron/sync-metrics/route.ts diff: [lines added / removed]
  Bearer `else` branch is byte-identical to pre-session: [yes/no]
- /lib/config.ts: CRON_TRIGGER enum (default 'secret') +
  QSTASH_CURRENT_SIGNING_KEY + QSTASH_NEXT_SIGNING_KEY added
  with superRefine (required when CRON_TRIGGER='qstash' in prod)
- /lib/observability/sentry-scrub.ts: 3 keys added to REDACTED_KEYS
- vercel.json: crons array removed
- @upstash/qstash version pinned: [version]
- Orchestrator files (lib/publishing, lib/metrics) untouched: [yes/no]

Runbooks:
- docs/build-guide/runbooks/qstash-setup.md: [committed]
- docs/build-guide/runbooks/vercel-cron-restore.md: [committed]
- docs/launch-checklist.md §3 restructured under "Trigger source":
  [committed]

Live smoke test — QStash mode
(preview env: CRON_TRIGGER='qstash', both QSTASH_* set):
- /api/cron/publish first POST tick `triggeredBy`: [qstash / ???]
- /api/cron/sync-metrics first POST tick `triggeredBy`: [qstash / ???]
- Sentry Cron Monitor check-ins under QStash: [present / missing]
- cron_health rows after first tick: [present / missing]
- GET /api/cron/publish under qstash: [405 / wrong]

Live smoke test — Secret mode
(second preview: CRON_TRIGGER='secret' or unset, no QSTASH_*):
- GET with `Authorization: Bearer $CRON_SECRET`:
  [200 + triggeredBy: 'secret' / wrong]
- GET without auth header: [401 with body "Unauthorized" / leak]
- POST with valid Bearer: [405 / wrong]

Live smoke test — failure modes (CRON_TRIGGER='qstash'):
- POST + missing Upstash-Signature: [401, no reason leaked / wrong]
- POST + invalid signature: [401, no reason leaked / wrong]
- Dev-bypass header in production env: [401 — must still reject]

Live smoke test — LEXICAL UNREACHABILITY (the load-bearing pin):
- CRON_TRIGGER='qstash', NODE_ENV='development',
  POST + X-Cron-Dev-Trigger: true + no signature
  → [401 with reason='qstash-missing-signature' / WRONG if anything
     else, including 200]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- vercel inspect shows NO crons (active trigger is QStash): [yes/no]
- Production Vercel env has CRON_TRIGGER='qstash' + both QSTASH_*
  keys + CRON_SECRET (still required, preview/dev use it): [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 13.5

**Lexical unreachability is load-bearing — don't refactor it away.** The QStash branch and the Bearer branch live in separate `if`/`else` arms by design. Future "consolidate the cron auth" PRs will be tempted to merge them into a unified verifier that checks both paths. That re-introduces exactly the downgrade attack the hard env-driven branch was chosen to prevent: an attacker omits `Upstash-Signature` to fall into the weaker path, or sends `X-Cron-Dev-Trigger: true` in QStash mode hoping to short-circuit. The reviewer-pinned test (`CRON_TRIGGER='qstash'` + `NODE_ENV='development'` + dev-bypass header + no signature → 401) catches this; if anyone weakens the test to "skip in QStash mode", that's the regression. Decline the cleanup.

**Raw body or nothing.** Next.js App Router lets you call `request.json()` or `request.text()` — but only one of them, and only once. QStash signs the raw body. If anything between the network and `Receiver.verify()` parses or transforms the body, the signature fails. `verifyQStashRequest` calls `request.text()` exactly once internally; the route never touches the body. Do not add a `request.json()` upstream "just in case" — it consumes the stream and the signature check breaks.

**Method asymmetry will trip a casual reader.** Under `CRON_TRIGGER='qstash'`, a `GET /api/cron/publish` returns **`405`**, not `401`. The contract: wrong-method is `405`, wrong-auth is `401`. An operator reaching for the dev curl during an incident sees `405` and immediately knows the route is in qstash mode (use the QStash console "Run now" button instead). If you collapse `405` into `401`, that diagnostic signal dies — and the runbook can no longer say "if you see 405, you're hitting the wrong method for the active trigger."

**Sentry Cron Monitor is wrapped around the orchestrator, not the route.** If the Builder pulls the `withMonitor` wrapper "for cleanup" while editing the route, monitor check-ins stop and the Session 13 alerting silently dies. Reviewer's H5 and D4 exist to catch this. The diff per route must be tiny — wrap the existing body in `else`, add the `if (CRON_TRIGGER === 'qstash')` arm above, split GET/POST, add one log field. Anything else is suspicious.

**The route's `else` branch must be byte-identical to pre-session.** This is the D6 trade-off in operational form: the working Bearer code is untouched. If the Builder "improves" the existing block while it's already touching the file — even something innocuous like extracting a helper or reformatting — the Reviewer's C1 flags it. Wrap, don't rewrite.

**QStash key rotation is not optional.** Setting only `QSTASH_CURRENT_SIGNING_KEY` and leaving `QSTASH_NEXT_SIGNING_KEY` blank "for now" fails boot in production (the Zod `superRefine` rejects it). When no rotation is in flight, set NEXT equal to CURRENT — the `Receiver` accepts either, and you preserve the option to rotate without redeploying-to-fix-config. If a future operator gets a "both QSTASH_*_SIGNING_KEY required when CRON_TRIGGER=qstash" error at boot, that's the refine doing its job.

**vercel.json with a crons array on Hobby will fail-deploy with a generic error** — it doesn't say "Hobby plans only support daily crons" plainly. Removing the array entirely (the chosen path) avoids the failure mode and keeps the cadence honest in the runbook. Don't be tempted to soften the schedules to daily; the cadence is part of the orchestrator contract (ADR 0005 §13, ADR 0006 §10).

**Manual ops in QStash mode is the console's "Run now" button — there is no curl-with-Bearer equivalent.** Decision E rejected the fallback explicitly. If an on-call engineer reaches for `curl -H 'Authorization: Bearer …'` during an incident, they'll see `405` (wrong method) or `401` (qstash mode rejects Bearer). The fix is documented in `qstash-setup.md` Step 5: open the QStash console, find the schedule, click Run now. The lack of a fallback is the feature.

**The "amendment, not new ADR" convention is decided here.** A future trigger swap (Phase 2 worker queue migration, for example) might be tempted to amend ADR 0005 §12 a second time. That's fine, but the next amendment must be numbered "Amendment 2" and reference Amendment 1 — and a new ADR should only be opened if the change reverses Amendment 1 rather than extending it. State this lineage rule in the 0005 amendment so the convention is enforceable.

**Architect tries to build.** If it happens, stop immediately: `Stop. Architect role only. Confirm and exit.`, then `/exit` and start a fresh Builder. Any `.ts` the Architect produced must be deleted before the Builder runs.

---

## What this unlocks

After Session 13.5:
- Production deployment on Vercel Hobby is unblocked. Both crons fire on their original cadence (`* * * * *` publish, `0 * * * *` metrics), via QStash, with signature-verified POSTs into unchanged route bodies and unchanged orchestrators.
- The future Vercel Pro flip is a zero-code-change operation: set `CRON_TRIGGER='secret'`, remove the two `QSTASH_*_SIGNING_KEY` env vars, paste the JSON block from `vercel-cron-restore.md` into `vercel.json`, redeploy. The Bearer `else` branch — preserved byte-for-byte from before this session — takes over automatically.
- The project gains its first ADR amendment, setting the convention for future scope-limited changes that extend rather than reverse prior decisions.
- Trigger-source is now observable per-tick (`triggeredBy: 'qstash' | 'secret'` in the structured tick log line), so the post-Pro-flip operator can verify the swap landed by tailing logs, not by guessing.
- Sentry Cron Monitor alerting (Session 13) survives unchanged — the same alert path catches missed ticks whether the doorbell is QStash or Vercel.

The next session can open Resend (Session 14) on a deployable production stack, with the cron triggers no longer a launch blocker.
