# Session 15 — Transactional Email: drain worker + Resend integration test

> **Goal:** Land the last missing piece of the email surface — the every-minute drainer that turns `email_outbox.pending` rows into actual Resend sends, with deterministic Mock-driven flow tests and one real-network round-trip against Resend test addresses gated on `EMAIL_INTEGRATION_TEST_ENABLED`. After this, the email pipeline runs end-to-end in production with no manual steps.
> **Time:** 3–4 hours including correction pass
> **Models:** Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction
> **Plugins:** ECC throughout (`/everything-claude-code:plan` → `:tdd` → `:verify`), claude-mem automatic. No `impeccable-design-and-taste` — this session has no UI surface.
> **Session structure:** No Architect — ADR 0008 §6–§9 + Amendment 1 already lock every contested decision. Builder runs against locked sections. Reviewer prompt is held back until Builder commits.

---

## Why no Architect

Session 14D produced ADR 0008 plus Amendment 1. The drainer status machine (§6), claim query under `FOR UPDATE SKIP LOCKED` on a partial index (§7), tick budget and per-row flow (§9), Retry-After honouring (Amendment 1 A9), and retry-storm elimination (Amendment 1 D3) are all locked. The Builder invents nothing in this session — it implements the locked spec and writes the test pyramid §16 mandates.

`lib/email/resend-provider.ts` is already complete as of 14D — error mapping, Retry-After parsing, idempotency-key wiring, tag conversion. The Builder does **not** touch it.

---

## What this session builds and what it doesn't

**Builds:**

- `lib/email/orchestrator.ts` — `runDrainTick()`: claim → per-row send → status transition (orchestrator/route separation per ADR 0005)
- `app/api/cron/drain-email-outbox/route.ts` — QStash dual-mode auth (reuse Session 13.5 helper), `Sentry.withMonitor(slug='drain-email-outbox')`, delegates to orchestrator, emits the canonical `email.drain.tick` log line
- Integration tests (Mock-driven, deterministic):
  - Claim under contention (two concurrent ticks don't double-claim)
  - Transient error → row returns to `pending` with `next_attempt_at` honouring exponential backoff
  - Transient error with Retry-After → `next_attempt_at` uses the header value (Amendment 1 A9)
  - Terminal error (`invalid_recipient`, `template_render_failed`) → row goes straight to `failed`
  - Attempts exhausted → `failed` with last error captured
  - Drain-time suppression check — if recipient appears in `email_suppressions` between enqueue and drain, row marked `suppressed`, no Resend call
  - Tick-budget exhaustion leaves backlog for next tick (no infinite loop, no over-claim)
  - Retry-storm guard (Amendment 1 D3): claim query excludes rows in `sending` state past `EMAIL_SENDING_STUCK_MINUTES`
- One real-network round-trip integration test under `EMAIL_INTEGRATION_TEST_ENABLED`, hitting `delivered@resend.dev`, asserting `providerMessageId` returned and visible in Resend dashboard
- Verification that `sdkResponse.headers` actually surfaces on the pinned Resend SDK version (a single test that asserts the header is present on a real rate-limit response, or a documented note if the pinned version doesn't expose it — in which case the Builder writes a small follow-up note in the ADR)
- Update to `.env.local.example` for `EMAIL_INTEGRATION_TEST_ENABLED`
- Pre-launch smoke checklist row applied to `docs/launch-checklist.md`

**Does not build:**

- `lib/email/resend-provider.ts` — complete as of 14D
- `MockEmailProvider`, registry, types, errors — complete as of 14D
- `email_outbox` / `email_suppressions` / `email_webhook_events` migrations — applied
- React Email templates, i18n copy — complete
- `/api/cron/trial-warnings`, `/api/webhooks/resend`, Stripe webhook enqueue tail, publishing worker enqueue — complete
- Supabase Auth SMTP relay — complete (dashboard config)

---

## Pre-session checklist

- [ ] `current-phase.md` reflects Session 14D complete
- [ ] `npx tsc --noEmit --skipLibCheck` clean; full SOSH test suite green
- [ ] `lib/email/resend-provider.ts` matches the committed 14D version (no local diff)
- [ ] Resend account has at least one test API key suitable for `EMAIL_INTEGRATION_TEST_ENABLED` runs
- [ ] claude-mem running

---

## Part A — Builder Session (Sonnet 4.6)

### How to run

1. `claude` → `/model` → **Claude Sonnet 4.6**
2. Paste Primer
3. Paste Builder Prompt
4. Builder runs `/everything-claude-code:plan` → present plan → approve → `/everything-claude-code:tdd` → `/everything-claude-code:verify`
5. Commit
6. Type confirmation line and `/exit`
7. **STOP.** Hold the Reviewer prompt until Builder commits.

### Primer

```
/resume-session

Read /CLAUDE.md, /docs/current-phase.md, /AGENTS.md.

Read /docs/decisions/0008-transactional-email.md — focus on
§4 (provider interface), §6 (status machine), §7 (claim query),
§9 (drainer cron), §16 (testing strategy), §17 (observability),
and Amendment 1 (retry storm + Retry-After).

Read /docs/decisions/0005-publishing-worker.md §12 + Amendment 1
for the QStash dual-mode trigger pattern. The drainer route reuses
the same helper — do not reimplement.

Read /lib/email/resend-provider.ts. This file is COMPLETE as of
Session 14D. You do not modify it. You consume EmailProvider via
the registry only.

Read /lib/email/mock-provider.ts to understand the failure-
injection surface for the drainer flow tests.

Read one existing cron route end-to-end as the structural template:
/app/api/cron/publish-tick/route.ts and its orchestrator at
/lib/publishing/orchestrator.ts. The drainer mirrors this
shape — route is thin, orchestrator owns the tick logic, log
line is emitted from the orchestrator.

That's the full primer. For anything else — Sentry monitor
wrapping, REDACTED_KEYS, lib/config.ts shape, formatISO
convention — read the relevant ADR or file IN-PLACE when you
reach the section that needs it. Cross-reference by section
number; do not restate.
```

### Builder Prompt

```
You are the Builder for SOSH Session 15 — drain-email-outbox
worker + Resend integration test.

DELIVERABLES:
- /lib/email/orchestrator.ts (new) — runDrainTick()
- /app/api/cron/drain-email-outbox/route.ts (new) — thin route
- /lib/email/__tests__/orchestrator.test.ts (new) — Mock-driven
  flow tests covering every branch in ADR 0008 §6 and Amendment 1
- /lib/email/__integration__/round-trip.test.ts (new) — gated on
  EMAIL_INTEGRATION_TEST_ENABLED; sends to delivered@resend.dev
  and asserts providerMessageId returned
- /.env.local.example — add EMAIL_INTEGRATION_TEST_ENABLED
- /docs/launch-checklist.md — add the smoke-test row for the
  drainer cron (one row, matching existing table format)

WORKFLOW:
1. /everything-claude-code:plan — produce the plan. Wait for
   explicit approval before /tdd.
2. /everything-claude-code:tdd — red → green → refactor per
   the test list in the plan.
3. /everything-claude-code:verify — full lint, typecheck, and
   the scoped vitest invocation per CLAUDE.md known-gotchas.

LOCKED CONSTRAINTS (do not re-litigate):

- The status machine, claim query, tick-budget semantics, and
  per-row flow are FROZEN at ADR 0008 §6, §7, §9. You implement
  them; you do not redesign them.
- Retry-After honouring is FROZEN at Amendment 1 A9. The Resend
  provider already parses the header into EmailProviderError;
  your job in the orchestrator is to read err.retryAfterSeconds
  (if present) when computing next_attempt_at, falling through
  to exponential backoff otherwise.
- Retry-storm guard is FROZEN at Amendment 1 D3. The claim
  query MUST exclude rows in `sending` state newer than
  EMAIL_SENDING_STUCK_MINUTES — only stuck rows past that
  threshold are eligible for re-claim.
- The route is THIN. All tick logic lives in
  lib/email/orchestrator.ts. The route handles QStash dual-mode
  auth, wraps the call in Sentry.withMonitor(slug=
  'drain-email-outbox'), and returns the orchestrator's summary.
- The canonical log line is emitted ONCE from the orchestrator,
  not the route — matching the convention in publish-tick,
  janitor-cron, and metrics-sync-tick (CLAUDE.md Session 13.5
  Key Decisions).
- QStash dual-mode auth: reuse the existing helper from
  Session 13.5 Amendment 1. Do not reimplement signature
  verification or the dev-bypass branch.

INTEGRATION TEST POSTURE:

- Flow tests (orchestrator.test.ts) use MockEmailProvider with
  failure injection. They are deterministic, run in default CI,
  and cover every branch in §6 and Amendment 1. This is where
  coverage lives.
- The real-network test (round-trip.test.ts) is a single
  end-to-end sanity check: enqueue a row, run the drainer
  against the real Resend client with EMAIL_PROVIDER=resend,
  assert delivered@resend.dev returns a providerMessageId,
  assert the row transitions to `sent`. Gated on
  EMAIL_INTEGRATION_TEST_ENABLED (mirrors
  POSTIZ_INTEGRATION_TEST_ENABLED from Session 3). OFF by
  default in CI.

VERIFICATION TASK (sdkResponse.headers):

The provider implementation reads sdkResponse.headers in
mapResendError. Confirm on the pinned Resend SDK version that
sdkResponse.headers is actually populated on a 429 response.
Two acceptable outcomes:
  (a) headers populated → the integration test asserts it
      indirectly by mocking a 429 path; no further action.
  (b) headers undefined on real responses → document in
      /docs/decisions/0008-transactional-email.md as
      Amendment 2 (a one-paragraph follow-up note flagging
      the SDK limitation; no design change), and the
      orchestrator falls through to exponential backoff
      unconditionally for now.

Either outcome is acceptable. The point is the Builder
verifies and documents — silence is not.

BUILDER BOUNDARY:

- Do not modify /lib/email/resend-provider.ts,
  /lib/email/types.ts, /lib/email/errors.ts,
  /lib/email/mock-provider.ts, or /lib/email/registry.ts.
- Do not modify any existing migration or any other cron route.
- Do not bump the Resend SDK version. Exact-pin from 14D stands.
- Do not invent new EmailKinds or status values.
- Do not add new env vars beyond EMAIL_INTEGRATION_TEST_ENABLED.
- If you find yourself wanting to change a §6 status transition
  or §7 claim-query shape, stop and output: "Stopping — ADR
  conflict at §<n>. Surfacing for human adjudication."

When all tests pass and /verify is clean, output exactly:
"Session 15 Builder complete. Awaiting Reviewer."
Then stop. Do not suggest next steps.
```

---

## Part B — Reviewer Session

**Held back.** Drafted after Builder commit. Anticipated review surface below.

---

## Anti-patterns to flag during review (drafted now while context is fresh)

- **Builder modifies `resend-provider.ts`.** Out of scope; complete as of 14D.
- **Route emits the canonical log line instead of the orchestrator.** Violates the Session 13.5 convention.
- **Claim query missing the `sending`-state stuck-row filter.** Retry-storm guard from Amendment 1 D3.
- **Backoff computed without checking `err.retryAfterSeconds` first.** Amendment 1 A9 violated.
- **Tick budget enforced by `LIMIT` only, with no `ORDER BY`.** CLAUDE.md unbounded-query rule.
- **Real Resend test address called in default CI.** Must be gated on `EMAIL_INTEGRATION_TEST_ENABLED`.
- **`process.env.EMAIL_INTEGRATION_TEST_ENABLED` read directly.** All env reads via `/lib/config.ts`.
- **Orchestrator throws instead of returning a summary on partial failure.** A tick that processes 10 rows where 2 fail is still a successful tick; the failures live in the row state, not the tick outcome.
- **Sentry.withMonitor slug mismatched between cron schedule and route.** Slug is `drain-email-outbox` exactly.
- **`formatISO` not used for `next_attempt_at` writes.** CLAUDE.md timestamp convention.
- **Recipient address appearing in a Sentry event.** ADR 0007 §3.3 scrubber must catch it; verify with a test.
- **No test for the `EMAIL_SENDING_STUCK_MINUTES` boundary.** Off-by-one on the stuck-row reclaim is exactly the failure mode Amendment 1 D3 was added to prevent.
- **MockEmailProvider failure injection bypassed via a custom test double.** Use the canonical mock — that's why it has failure injection.
- **Atomic conditional state transition missing `WHERE` guard.** Two concurrent ticks must not both transition the same row from `sending` → `sent`.

---

## What this unlocks

After Session 15, the entire transactional email surface runs end-to-end with no manual steps. Trial-warning crons enqueue, the Stripe webhook tail enqueues, the publish worker enqueues, the drainer sends, the Resend webhook suppresses bounces. Phase 1 email is launch-ready.

Remaining pre-launch gaps: landing page, legal pages, engineering-debt cleanup, knowledge corpus ingestion, UI review pass.
