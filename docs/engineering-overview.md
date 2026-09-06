# Jemip — Engineering Overview

> **For a developer onboarding to the codebase.** How a request actually moves through the system, and
> how the intelligence layer works. **Replaces `docs/SOSH-APP-OVERVIEW.md`** (retired 2026-09-03 — it had
> gone stale to Session 13D and duplicated four other documents).
>
> **This document holds only what nothing else owns.** It deliberately does *not* repeat:
>
> | Looking for | Read instead |
> |---|---|
> | Architecture rules, conventions, locked decisions, plan tiers | `CLAUDE.md` — the single source of truth |
> | Why we're building this | `docs/product-vision.md` |
> | What exists today vs. what's promised | `docs/product-status.md` |
> | What must ship before launch | `docs/pre-launch-scope.md` |
> | Per-decision reasoning and constraints | `docs/decisions/` (ADRs 0001–0023) |
>
> **Staleness contract:** this file describes *mechanisms*, which change slowly, not *status*, which changes
> weekly. If you find it describing something that no longer exists, fix it here — do not add a parallel
> document. Verified against the source at Session 30 (2026-09-03). **Naming:** the product is Jemip; the
> codebase still says SOSH.

---

## 1. The end-to-end flow

There are **three ways a campaign starts**, and they converge on the same pipeline.

```
                     ┌─ Mode 1: STUDIO ────────────────────────┐
                     │  User writes a draft/idea in /studio     │
                     │  AI develops it, suggests, verifies      │
                     │  → promoteDraftToCampaign()              │
                     ├─ Mode 2: OBJECTIVE ─────────────────────┤
   [ User ] ─────────┤  User states an objective in /create     ├──┐
                     │                                          │  │
                     ├─ Mode 3: SIGNAL ────────────────────────┤  │
                     │  Cron polls GitHub releases + RSS feeds  │  │
                     │  → deterministic dedup + scoring (no LLM)│  │
                     │  → bounded agentic triage (tool loop)    │  │
                     │  → insight cards in /opportunities       │  │
                     │  → human approves a card                 │  │
                     └──────────────────────────────────────────┘  │
                                                                    │
                          ┌─────────────────────────────────────────┘
                          ▼
              STAGE A — assembleBrief()
              objective + audience + narrative + evidence + roleSequence
                          │
                          ▼
              STAGE B — critique gate (lib/campaigns/brief.ts)
              full 10-dimension rubric vs BRIEF_QUALITY_THRESHOLD
              below threshold → brief is not accepted
                          │
                          ▼
              BRIEF FROZEN  (deep-readonly roleSequence; positional contract)
                          │
                          ▼
              GENERATION — one call per platform per role
              format families (single post / thread); scheduling is deterministic
              openingStrength below threshold → ONE regeneration, no re-score
                          │
                          ▼
              CONSISTENCY — checkRoleCoverage + checkLinkPlacement (Tier 0, free)
                          │
                          ▼
              APPROVALS  (/approvals) — human approves, edits, or rejects
              ▲                    │
              │                    ▼
              │         CALENDAR (/calendar) → publish worker (cron, native LinkedIn/X)
              │                    │
              │                    ▼
              │         METRICS worker (cron) → post_metrics
              │
              └── LEARNING: the diff between the AI original and the approved
                  version is captured, classified, and promoted into memory
```

**Two things about this diagram are load-bearing:**

- **Approval is the only path to publication.** There is no branch that bypasses it, at any plan tier.
- **The learning arrow closes back on memory, not on metrics.** Today the system learns from *editing
  behaviour* (pre-publication taste), not from *published results*. Closing the outcome loop is Session 33.

---

## 2. The layer map

`lib/` — one line each. The rules governing each live in `CLAUDE.md`; this is orientation only.

| Module | What it owns |
|---|---|
| `ai/` | **Every** Anthropic SDK call. `runner.ts` (single-shot), `tool-runner.ts` (bounded agentic loop), `context.ts`, `models.ts`, `parsers.ts`, `wrap-evidence.ts` (injection guards), `prompts/` (nine families) |
| `memory/` | Governed retrieval: scoring, recency decay, caps, eligibility. Reads through `db/memory-*`, never raw tables |
| `signals/` | Signal sources (GitHub releases, RSS/Atom), dedup, deterministic scoring, `triage/` (the tool loop, card generation, verification, shortlist allocation) |
| `campaigns/` | `brief.ts` (assembly + critique gate + freeze), `generate.ts`, `consistency.ts`, `promote.ts`, `schedule.ts`, `enforcement.ts` |
| `studio/` | Mode 1 drafting and `verify.ts` (the verify-then-cite pattern) |
| `learning/` | The ADR 0018 loop: classify → summarize → promote into `performance_memory` |
| `social/` | Provider abstraction, OAuth state, vault token reads. **Native LinkedIn/X providers** (Session 30.5, ADR 0028) — production OAuth apps not yet registered |
| `publishing/` | `orchestrator.ts` — publish tick + janitor tick, the error matrix, backoff |
| `metrics/` | `orchestrator.ts` — metrics sync tick. Writes `post_metrics` and **nothing else** |
| `db/` | One file per table, ~37 of them. The only place Supabase is called |
| `supabase/` | Four client factories. Mixing them is a security bug — see `CLAUDE.md` |
| `email/`, `stripe/`, `calendar/`, `members/`, `voice/`, `deletion/`, `cron/`, `observability/`, `validation/`, `config.ts` | Transactional email, billing, calendar, seats, voice variations, GDPR erasure, cron auth, Sentry scrubbing, Zod schemas, typed env |

**Dashboard routes:** `approvals`, `billing`, `calendar`, `campaigns`, `create`, `onboarding`,
`opportunities`, `settings`, `studio`. **There is no `analytics` route and no `inbox` route** — both are
promised in pricing and unbuilt (`docs/product-status.md`).

**Cron workers:** `publish`, `sync-metrics`, `signals-poll`, `signals-triage`, `capture-learning`,
`drain-email-outbox`, `process-deletions`, `trial-warnings`.

---

## 3. The intelligence layer

This is the part worth understanding properly. It is what makes Jemip more than a scheduler.

### 3.1 Two entry points, and only two

Everything that touches a model goes through `lib/ai/`:

- **`runPrompt()`** (`runner.ts`) — single-shot, typed in and out. Its step order is not resequenceable:
  **trial-cap check → rate-limit check → message assembly (with prompt caching above a character
  threshold) → SDK call with one retry on 429/5xx only → parse → cost → `ai_usage` row.**
  A capped trial customer never reaches Anthropic; a rejected call writes no usage row because no cost was
  incurred; a *failed* call does, because it burned tokens.
- **`runToolLoop()`** (`tool-runner.ts`) — the bounded agentic loop. Its design choice is the interesting
  one: the module *"has no opinion on what a tool does, only on how many times and how long it may run."*
  Capability and governance are separated. Every bound is a named constant (max tool calls, turns,
  cumulative input/output tokens, wall clock, retry budget, plus a per-request timeout that deliberately
  does **not** retry — retrying a slow provider spends more wall clock on the same pathology).

Currently only Stage C triage uses the tool loop. **Generation cannot** — that is Session 34.

### 3.2 Nothing runs context-free

Every call carries a `CustomerContext`: business, brand voice, recent campaigns, recent post performance,
trial state. The performance and voice slices resolve through **governed memory** — scored and capped —
not a raw DB fan-out.

This is the difference between the product and a wrapper. The model is never asked to write "a LinkedIn
post"; it is asked to write *this brand's* post, with that brand's accumulated history in the prompt.

### 3.3 Governed memory

Four typed stores — brand, evidence, audience, performance — each record carrying source, confidence,
`recency_at` (30-day exponential half-life), `expires_at`, status and scope. Voice reads through the
existing brand-voice tables by design; `relationship_memory` is specified but parked.

Retrieval ranks by confidence × recency × scope match and truncates to a per-type cap. A prompt receives
at most ~18 memory records, and today the four types are retrieved **independently** — cross-type queries
are a known gap.

**Current asymmetry worth knowing on day one: many readers, one writer.** Eight modules read memory; only
`learning/orchestrator.ts` writes it.

### 3.4 Prompt-injection defence, enforced by types

The part of the codebase most worth copying elsewhere. Untrusted text — customer evidence, ingested RSS
article bodies, tool results — **cannot reach a prompt as a plain string**. It must pass through
`neutralize` / `neutralizeWithSentinels` in `wrap-evidence.ts` and comes out as a **branded type**
(`RenderedEvidence`, `RenderedSignalText`), each capped at 2000 characters.

Because the brand originates at the data-access boundary, **an unbranded string reaching a prompt is a
compile error, not a review comment.** Raw text is stored raw and guarded at read, deliberately: sanitising
at ingest destroys fidelity for the human reader and cannot be re-run when the sanitiser improves.

There are five historical duplicate `sanitizeDataField` implementations. They are documented accepted debt,
**not a pattern to extend** — `lib/studio/guard.ts` already forbids a sixth.

### 3.5 The critique gate

Briefs are scored against a **fixed ten-dimension rubric** (specificity, originality, evidence sufficiency,
audience relevance, platform nativeness, brand-voice alignment, opening strength, CTA fit, unsupported-claims
risk, redundancy) before they are frozen. Adding, renaming or removing a dimension is a breaking change for
every caller — the rubric is shared by Mode 2's brief gate, Mode 1's Studio suggestions, and Mode 3's card
scoring.

Posts get a lighter gate: one dimension (`openingStrength`), one regeneration, no re-score. Widening this
is Session 31.

### 3.6 The learning loop

On `draft → approved`, a trigger enqueues an edit signal. A Tier-0 heuristic classifier (no LLM, 12 signal
kinds) splits corrections from preferences; a Tier-1 Haiku summariser distils patterns behind a two-gate
floor; promotion into `performance_memory` is atomic. The AI's original is snapshotted write-once in
`post_ai_originals`, so the diff is always recoverable.

**This is the most defensible thing in the codebase** — it is a labelled corpus of exactly the judgment the
product needs, collected as a by-product of normal use.

### 3.7 Cost

Three models pinned in `models.ts` with their cent-per-Mtok rates and a dated pricing source: Opus 4.7,
Sonnet 4.6, Haiku 4.5. Cache reads bill at 10% of input. **Switching a prompt's model requires bumping that
prompt's `version` in the same commit.** Every call writes an `ai_usage` row; the bounded loop accounts cost
on every outcome including failure, because a failed loop still burned tokens.

---

## 4. What is deliberately not intelligent

Understanding where the model is *not* involved matters as much as where it is.

- **Scheduling is a pure function.** Hardcoded optimal slots per platform, converted from the business's
  timezone. Dates are fixed before generation runs; the model echoes them back, it does not choose them.
- **Stage B signal scoring has no LLM at all.** Deterministic dedup and scoring only — a deliberate ruling
  (ADR 0020), re-affirmed in ADR 0023. Embeddings remain deferred.
- **Approval is human-only.** No confidence score, no auto-approval threshold, no classifier. A product
  decision, not a technical limitation.
- **Publishing is a state machine.** A fixed error matrix with deterministic retry and jittered backoff.
- **Metrics collection is mechanical.** It fetches numbers and stores them. It draws no conclusions —
  which is precisely the gap Session 33 closes.
- **Token refresh is conditional logic**, not judgment.

---

## 5. Where to look when

| You need to | Start at |
|---|---|
| Understand why a rule exists | the ADR that made it (`docs/decisions/`), not the code |
| Add anything AI-touching | `lib/ai/` — there is no second door |
| Add a DB query | `lib/db/<table>.ts`, then expose it upward |
| Add a signal source | `lib/signals/` behind the source interface; a source scan enforces the boundary |
| Change a prompt | bump its `version` in the same commit; check the fixtures |
| Understand a session's decisions | `docs/build-guide/session-NN.md` §0, then its ADR |
| Know what's actually shipped | `docs/product-status.md` — never infer capability from this file |
