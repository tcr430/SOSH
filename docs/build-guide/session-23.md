# Session 23 — Governed Memory Foundation (ADR 0016) · Track A

> **Goal:** land the one foundation the whole intelligence-layer redesign sits on — **governed
> memory** — and nothing else. Replace `buildCustomerContext`'s fixed, unscored, dumped-wholesale
> fan-out (`listCampaigns(...,5)`, `listTopPostMetrics(...,10)`, then `JSON.stringify(context)` into
> the first message) with typed, sourced, confidence-scored stores read through a new `lib/memory/`
> boundary that ranks-and-**caps** what enters a prompt instead of including everything relevant.
>
> **This is Track A of a three-track programme** (`docs/brainstorm/session-plan-adrs-0016-0018.md`):
> A = ADR 0016 governed memory (this file); B = ADR 0017 Mode 2 upgrade; C = ADR 0018 diff-based
> learning capture. **B and C both depend on A landing first** — 0017 reads via `lib/memory/`, 0018
> writes into it — so this track ships the *read side + the schema + the governance metadata*, and
> deliberately leaves the *learning/distillation write side* to Track C. Do not build Mode 2, the
> quality rubric, mining, the opportunity feed, or Studio here. See the plan doc §4.
>
> **Near-zero product scope.** No new user-facing capability, no new route, no Stripe, no UI. New
> DB tables + RLS + `lib/memory/*` + one rewire of `lib/ai/context.ts`. After Track A,
> `buildCustomerContext` returns an equal-or-better context assembled through governed retrieval,
> and every existing generation test still passes unchanged.
>
> **Phase gating.** §1 (Architect) runs **first and alone**. Nothing in §2/§3/§4 starts until
> `docs/decisions/0016-governed-memory.md` is written and Accepted — the Builder transcribes the ADR,
> it does not run in parallel with its authoring. §0.1 carries the four questions the Architect (A1)
> must resolve *in the ADR*; the Builder consumes those answers as binding.
>
> **How to use this file:** run §1 to completion, get the ADR accepted, THEN paste each later phase
> into Claude Code in order. **Architect → Opus. Builder → Sonnet. Reviewer → Opus. Correction → Opus.**
> Each phase opens with a **primer** — paste it, wait for acknowledgement, then paste the numbered
> steps one at a time, letting each go green + commit before the next.
>
> **One step, one commit.** Migrations, the `lib/memory/` module, and the `context.ts` rewire are
> separately reviewable commits — a squashed foundation is unauditable, and 21C proved a Reviewer
> cannot verify phase isolation after the fact.
>
> **ECC posture.** Every phase names the specialist agents/skills it uses — not just the
> `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` spine. Specialists are pulled into the
> Builder phase *proactively* (at the point a mistake is made), not only into review. The catalogue is
> large; this guide uses only the handful that map to this track's real risk surface (RLS/tenancy,
> migration correctness, quiet-failure in scoring, prompt-cache cost, test-execution integrity,
> type/contract design). Do not add others.

---

## §0 — Locked decisions (binding input — adjudicated by founder)

**Locked (L):**

- **L-1 — Track A ships governed memory ONLY.** In scope: the memory-record schema + tables + RLS +
  erasure cascade; `lib/memory/` with per-type `retrieveRelevant`; the `buildCustomerContext`
  rewire; the `runner.ts` over-inclusion fix (L-8). **Out of scope, explicitly:** Mode 2's brief
  pipeline, format-family schemas, the quality rubric, content mining, insight cards, the
  opportunity feed, Studio, and the diff-learning *distillation worker* (Track C owns the
  write/learning side). If a step appears to need any of these, **STOP and report**.
- **L-2 — Module boundary `lib/memory/`, one file per memory type.** Sits alongside `lib/ai/`,
  `lib/social/`, `lib/db/`. Each file exposes `retrieveRelevant(businessId, queryContext, limit)`.
  **`lib/memory/*` reads through `lib/db/*` (or owns its own table queries per the ADR's decision —
  see §0.1/Q4); nothing outside `lib/memory/` queries the new memory tables directly**, exactly as
  nothing outside `lib/social/` imports a provider. `buildCustomerContext` becomes a *consumer* of
  `lib/memory/`, not a direct caller of `lib/db/campaigns.ts` / `lib/db/post-metrics.ts` for the
  sections that should be scoped rather than exhaustive.
- **L-3 — Learning / Retrieval / Generation stay three separate things.** Track A builds
  **retrieval** (per-call, cheap, deterministic code, hard-budgeted) and the **stores** it reads.
  **Generation** stays exactly what `runPrompt` already is — no new call mechanics. **Learning**
  (the background, periodic, AI-driven distillation worker) is Track C; Track A may create the
  *columns/tables* learning will later write, but ships no distillation job. Collapsing these three
  back into one call is the anti-pattern this whole redesign exists to kill.
- **L-4 — Retrieval is a scored query, not an LLM decision, and it is HARD-CAPPED.** Rank by
  relevance + confidence + recency; then take a fixed cap — **top-5 evidence, top-3 performance
  patterns, always the core voice rules**. The cap is the discipline missing from
  `buildCustomerContext` today ("include everything relevant" → "prioritise"). The exact caps are
  ADR constants, not magic numbers scattered in code.
- **L-5 — Every memory record carries governance metadata.** source; created_at; last_confirmed_at;
  confidence; sensitivity; public-use permission; scope (brand/campaign/platform/contact);
  expiry/review policy. Performance memory is **probabilistic, not permanent** — the system says
  "technical-comparison posts *appear to* perform well for CTO audiences, based on 3 campaigns," it
  does not assert it as fact after one data point.
- **L-6 — RLS + erasure cascade are mandatory for every new business-scoped table.** Every new
  table: `business_id` FK; RLS enabled; `(SELECT get_user_business_ids())` policy pattern;
  UPDATE policies with BOTH `USING` and `WITH CHECK`; a row in ADR 0010 Amendment 2 §D2.5's cascade
  table AND either `ON DELETE` cascade from `businesses` or explicit handling in `purge_business`.
  A business-scoped table omitted from the cascade is a silent GDPR-erasure leak (constitution).
- **L-7 — Behaviour-equivalence gate on the rewire.** After `buildCustomerContext` is rewired,
  **every existing `lib/ai/context.test.ts` and generation-path test passes unchanged**, or the
  change is wrong. The rewire changes *selection logic*, not the `CustomerContext` contract the
  generation prompts consume. Any change to `CustomerContext`'s shape that ripples into prompts is a
  STOP — raise it, don't absorb it silently.
- **L-8 — Fix the `runner.ts` over-inclusion as part of this track.** `runner.ts:94`
  (`const userContextMsg = JSON.stringify(context)`) dumps the entire context object into the first
  message, on top of the already-templated `buildUserMessage`. The stable, shared slice (platform
  constraints, core voice) should carry the `cache_control: ephemeral` (already set at `runner.ts:90`
  for large system prompts); the per-call *retrieved* slice goes in the uncached user message.
  Capture the prompt-caching benefit the code already half-implements. **This is a refinement of an
  existing mechanism, not a new one** — if it forces a `CustomerContext` contract change, it is
  bounded by L-7.
- **L-9 — Constitution hard rules, inherited by every step.** env only via `lib/config.ts`; DB only
  via `lib/db/` (and now `lib/memory/`); service-role via lazy import, never in a user-facing path;
  timestamps via `date-fns` (`formatISO`, never `new Date().toISOString()`); no `any`, no
  `console.*`; all user-facing strings through i18n (en/pt/es) — though this track adds none;
  atomic transitions via conditional `WHERE`; no unbounded queries (every `retrieveRelevant` takes a
  `limit`, with an explicit `ORDER BY` matching an index).

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | What Track A ships | governed-memory foundation only (read side + schema) | bundling Mode 2 / rubric / mining (each depends on foundations still being built — staleness risk, plan §4) |
| D-2 | Module home | new `lib/memory/`, per-type `retrieveRelevant` | extend `lib/db/` (loses the retrieval/scoring boundary); extend `lib/ai/` (conflates selection with generation) |
| D-3 | Retrieval mechanism | scored + **hard-capped** deterministic query | LLM-decides-what-to-retrieve (cost, latency, quiet failure — Tier-3 where Tier-0/1 suffices) |
| D-4 | Learning write side | **deferred to Track C** | build the distillation worker now (no signal to distill until the diff loop exists) |
| D-5 | Rewire risk | behaviour-equivalence gate (L-7) | free-hand refactor of the load-bearing context builder |

---

## §0.1 — Questions the Architect (A1) must resolve IN the ADR (BINDING)

The strategy docs leave four things open "for the Architect session"
(`campaign-modes-architecture-and-build-plan.md` §3 close; plan doc §4). **A1's ADR must decide each
one explicitly, name the loser, and tier the resulting constraint.** The Builder consumes the ADR's
answers as binding; it does not re-decide them.

- **Q1 — Which of the six memory types get tables in ADR 0016, and which are deferred?**
  The six (intelligence-layer §1): **brand, voice, evidence, audience, performance, relationship**.
  Constraints the ADR must weigh: **voice already exists** (`brand_voices` + `brand_voice_variations`,
  ADR 0011) — governed memory should *read through* it, not duplicate it; **performance** is derivable
  from `post_metrics` today (materialise a scored store, or derive at retrieval?); **relationship**
  feeds the **Phase 2** engagement inbox and has no consumer in Phase 1. The ADR should ship the
  minimum set `buildCustomerContext` can actually consume now (brand / evidence / audience /
  performance, reading voice through the existing tables), and *name* relationship as deferred rather
  than build an unused table. State the decision either way.
- **Q2 — Embeddings now, or deferred?** The doc says "embedding similarity to the objective is
  sufficient, doesn't need to be fancy." But `pgvector` is a real new dependency + migration surface.
  Decide: introduce vector similarity in Track A, **or** start with a cheaper deterministic score
  (recency + confidence + tag/scope match) and defer embeddings behind a named un-defer trigger.
  Retrieval must be *hard-capped* (L-4) either way — the scoring function is what Q2 settles.
- **Q3 — Confidence model + promotion threshold.** The `confidence` field and its enum/scale live in
  this ADR (Track C *writes* against it, but the schema is here). Fix the scale (e.g. 0–1 vs a
  discrete band) and state the "a single data point must not become permanent fact" rule structurally
  — the aggregation threshold that gates promotion is Track C's, but the *column it gates on* is
  A1's. Don't leave Track C to invent the schema retroactively.
- **Q4 — `lib/memory/` ↔ `lib/db/` relationship.** Does `lib/memory/*` call `lib/db/*` for its
  reads (consistent with "DB only via lib/db"), or own its own table queries directly (a parallel
  data-access boundary)? Pick one and justify it against the constitution's "nothing else calls
  Supabase" rule. This determines whether new query functions live in `lib/db/memory-*.ts` or inside
  `lib/memory/*` — a structural decision the Builder must not improvise.

Where an A1 answer and this build-guide disagree, **the ADR wins once written** — but A1 must not
silently contradict a §0 Locked decision; if it needs to, it STOPS and flags it for founder
adjudication, exactly as an ADR that contradicts CLAUDE.md would.

---

## §1 — Architect session (A1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **`docs/decisions/0016-governed-memory.md`
ONLY**. No `.ts`, no `.sql`, no code of any kind. Any code attempted here is discarded. The last
action is a single confirmation line, then `/exit`. **§2 does not start until this ADR is Accepted.**

**ECC in this phase.** The Architect uses read-only intelligence agents to *ground* the ADR in the
real repo before writing a word of it:
- `ecc:code-explorer` — trace the live seams (`buildCustomerContext` fan-out, `runner.ts`
  over-inclusion, the existing RLS + cascade pattern) and return exact `file:line` citations, so the
  ADR is grounded rather than remembered.
- `ecc:architecture-decision-records` (skill) — the ADR house structure (context / decision / losers /
  consequences / constraint table), so 0016 matches 0010–0015 in shape.
- `database-reviewer` (agent, advisory/read-only here) — sanity-check the *proposed* table shapes,
  index-per-ORDER-BY coverage, RLS policy pattern and cascade wiring **as a design**, before it is
  committed to the ADR. It writes no code; it pressure-tests the schema on paper.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 23 — Governed Memory Foundation, ARCHITECT phase. You produce ONE artefact:
docs/decisions/0016-governed-memory.md (status: Accepted). You write NO code — no .ts, no .sql. If
you catch yourself writing a migration or a function body, stop: that is the Builder's job (A2), and
the constitution requires Architect-attempted code to be discarded.

ECC posture for this phase:
- FIRST run ecc:code-explorer over the seams below to produce grounded file:line citations. Do not
  rely on memory for line numbers — cite what the explorer finds.
- Use the ecc:architecture-decision-records skill for the ADR's structure so 0016 matches 0010–0015.
- Consult the database-reviewer agent (read-only, advisory) on your PROPOSED schema: table columns,
  the index-per-ORDER-BY coverage, the (SELECT get_user_business_ids()) RLS pattern, and the cascade
  wiring — pressure-test the design on paper before you write it into the ADR. It writes no code.

Read now, before anything else:
- docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md — §1 (governed memory:
  the six types, the governance metadata, learning/retrieval/generation split, the hard-cap
  discipline) is the primary source. §5 (tiered agency, the learning loop) is context for why Track
  C exists and what Track A must leave alone.
- docs/brainstorm/campaign-modes-architecture-and-build-plan.md — Phase A/B (§2) for how Modes 2/3
  will later consume memory; §3 close for the open questions.
- docs/brainstorm/session-plan-adrs-0016-0018.md — the dependency graph and Track A's exact scope
  (Session A1/A2/A3). You are A1.
- docs/build-guide/session-23.md §0 (Locked) and §0.1 (the four questions you MUST resolve).
- CLAUDE.md — the SocialProvider/AI-layer/DB-access/RLS/erasure-cascade/three-client architecture
  rules the new module boundary and tables must obey.
- The real seams you are governing (let ecc:code-explorer map these, then cite its findings):
  lib/ai/context.ts (buildCustomerContext, the CustomerContext interface, the fixed fan-out),
  lib/ai/runner.ts (JSON.stringify(context), cache_control), lib/db/campaigns.ts,
  lib/db/post-metrics.ts, lib/db/brand-voices.ts, lib/db/voice.ts, supabase/migrations/ (the existing
  RLS + cascade pattern — copy it, do not invent one), docs/decisions/0010-legal-surface.md
  Amendment 2 §D2.5 (the erasure-cascade table you must add to), docs/decisions/0011-voice-model.md
  (so you read voice THROUGH it, not around it).

Do NOT write the ADR yet. First OUTPUT your answers to the four §0.1 questions (Q1 memory-type set,
Q2 embeddings-now-or-deferred, Q3 confidence model, Q4 lib/memory↔lib/db relationship), each with its
named loser, AND a one-line note on any place a §0 Locked decision constrains your answer. Then stop
for acknowledgement. Do not begin the ADR body until the four answers are acknowledged.
```

### §1b — Architect prompt  (paste after the four answers are acknowledged)

```
ARCHITECT — Session 23. Write docs/decisions/0016-governed-memory.md (Accepted). Ground every claim
in the real repo (cite file:line from ecc:code-explorer's map). Run your proposed schema past
database-reviewer (read-only) and fold its objections into the ADR before you finalise. The ADR MUST
contain, at minimum:

1. Context + decision summary: what buildCustomerContext does today (fixed fan-out + JSON.stringify
   dump), why that is the problem, and the retrieval/learning/generation split as the fix. Name the
   losers for each major choice (per §0 D-1..D-5).
2. The memory-record schema: the governance metadata columns from L-5 (source, created_at,
   last_confirmed_at, confidence, sensitivity, public_use_permission, scope, expiry/review), with
   the confidence model from your Q3 answer stated as a concrete column type + scale.
3. The set of tables (your Q1 answer): one section per memory type you are shipping — columns, the
   business_id FK, indexes (every retrieval ORDER BY must match one), and how voice is read THROUGH
   the existing brand_voices/brand_voice_variations tables rather than duplicated. Name relationship
   (and any other type) as deferred, with the reason.
4. RLS + erasure cascade for EVERY new table: the (SELECT get_user_business_ids()) SELECT pattern;
   UPDATE with USING + WITH CHECK; the exact new row(s) for ADR 0010 Amd 2 §D2.5's cascade table; and
   whether each table cascades ON DELETE from businesses or is purged explicitly in purge_business.
   A business-scoped table with no cascade entry is a spec defect — do not ship one.
5. The lib/memory/ module boundary (L-2, your Q4 answer): the per-type retrieveRelevant(businessId,
   queryContext, limit) signature; the scoring function (your Q2 answer — deterministic vs
   embeddings); the HARD CAPS from L-4 as named ADR constants (EVIDENCE_CAP=5, PERFORMANCE_CAP=3,
   core-voice always); the rule that nothing outside lib/memory/ touches the new tables.
6. The buildCustomerContext rewire spec: which sections move from direct lib/db fan-out to
   lib/memory retrieval, which stay as-is, and the behaviour-equivalence gate (L-7) — the
   CustomerContext contract the generation prompts consume must not change shape. If your design
   requires changing it, say so loudly here and mark it a founder-decision, do not assume it.
7. The runner.ts over-inclusion fix (L-8): the cached-stable vs uncached-retrieved split, bounded by
   L-7. State exactly what moves out of the JSON.stringify(context) dump.
8. Test plan mapped to the three tiers (ADR 0015 §2): Tier-1 DB-behaviour for RLS on the new tables
   (supabase/__tests__, live Postgres); Tier-2 app-layer for retrieval scoring/capping logic
   (lib/memory/*.test.ts); any Tier-3 diff-verified property, enumerated as such.
9. A constraint table: every named constraint (MEM-*), its tier, and the test that will prove it —
   this is the Reviewer's checklist. Cover at least: MEM-SCOPED-RETRIEVAL, MEM-HARD-CAP,
   MEM-RLS-ISOLATED, MEM-CASCADE-COMPLETE, MEM-VOICE-THROUGH-EXISTING, MEM-CONTEXT-EQUIVALENT,
   MEM-NO-DIRECT-TABLE-ACCESS.
10. Explicit "deferred to Track B/C" section: what 0017 and 0018 will add, so the boundary is on the
    record and a future session doesn't build the learning worker here by mistake.

Do NOT write code. End with one line: "ADR 0016 written and accepted — <n> MEM-* constraints, <n>
new tables, embeddings <now|deferred>, relationship-memory <shipped|deferred>." Then /exit.
```

**Gate:** do not proceed to §2 until `docs/decisions/0016-governed-memory.md` exists, is Accepted, and
its four §0.1 answers are on the record. If founder review of the ADR surfaces defects, record them as
a `§0.1-style corrections` block appended here before the Builder starts — exactly as Session 22 did.

---

## §2 — Builder session (A2)  ·  (paste into Claude Code · Sonnet)

Runs **only after ADR 0016 is accepted.** Five steps, dependency-ordered, each a self-contained
`/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait
for acknowledgement, then paste B0…B4 one at a time**, letting each go green + commit before the next.

Hard rules inherited by every step: §0 L-9 (constitution) + the behaviour-equivalence gate (L-7).
**No new product capability, no new route, no Stripe, no UI, no learning/distillation worker.** If a
step appears to need one, **STOP and report** — that contradicts ADR 0016's scope and §0 L-1.

**ADR 0016 decisions the Builder transcribes (now concrete — do NOT re-derive or "improve"):**
- **Four new tables:** `brand_memory`, `evidence_memory`, `audience_memory`, `performance_memory`
  (ADR §3). **Voice read THROUGH** existing `brand_voices` / `brand_voice_variations` — **no new voice
  table** (§3.5). `relationship` **deferred** (§3.6).
- **RLS form is the InitPlan-wrapped one:** `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`
  — **NOT** the bare `= ANY (public.get_user_business_ids())` in the *pre-017* `campaigns.sql:42-59`
  (superseded by `20260430120017_fix_rls_function_caching`). This is ADR §4's explicit MUST and CLAUDE.md's
  rule. Getting this wrong is a review blocker.
- **Governance columns (§2), every table:** `confidence numeric(3,2) [0,1]`, `observation_count int`,
  `status text ('candidate'|'active'|'retired')`, `source`, `sensitivity`, `public_use_permission`,
  `scope` + `scope_ref`, `last_confirmed_at`, `expires_at`, `deleted_at`, `created_at`, `updated_at`.
  **Retrieval returns `status='active'` only.**
- **Retrieval index (§3/§5.3), every table:**
  `(business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC) WHERE deleted_at IS NULL AND status = 'active'`.
- **Q4 = reads through `lib/db/memory-*.ts`.** Signature **`retrieveRelevant(client, businessId, queryContext, limit?)`**
  — the explicit `client` param is intended (§5.2); do not "correct" it to the doc's 3-arg sketch.
- **Q2 = embeddings deferred** — deterministic score (confidence + recency + scope-match), no pgvector.
- **Caps (§5.4):** `EVIDENCE_CAP=5`, `PERFORMANCE_CAP=3`, `AUDIENCE_CAP=5`, `BRAND_CAP=5`, core voice
  always. `MEMORY_CANDIDATE_LIMIT=50` bounds the DB scan (separate from the output cap).
- **Only `recentPostPerformance` is wired into `CustomerContext` in Track A** (capped 3, derived from
  `post_metrics`). Evidence/audience/brand retrieval is **built + tested but NOT wired** — 0017 owns that
  (§6.3). Wiring them now is an L-7 contract change → STOP.

**ECC specialists by step (invoked proactively, at the point the mistake is made — not saved for
review):**

| Step | Spine | Specialist pulled in | Why here |
|---|---|---|---|
| B0 | plan → tdd → verify | `database-reviewer` + `supabase:supabase-postgres-best-practices` | RLS/cascade/index correctness at authoring time, not after |
| B1 | plan → tdd → verify | `typescript-reviewer` (light) | typed query-fn shapes, no `any`, bounded + ORDER BY |
| B2 | plan → tdd → verify | `ecc:silent-failure-hunter` | cap-truncation & confidence-ranking are where a quiet wrong-fallback hides |
| B3 | plan → tdd → verify | `ecc:type-design-analyzer` | the CustomerContext contract (L-7) is a type-design invariant |
| B4 | plan → tdd → verify | `ecc:cost-aware-llm-pipeline` | L-8 is literally a prompt-cache cost fix |

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 23 — Governed Memory Foundation, BUILDER phase. You transcribe ADR 0016 into migrations, the
lib/memory/ module, and one rewire of lib/ai/context.ts, across five steps (B0…B4). You are not the
designer: ADR 0016 is authoritative, as scoped by session-23.md §0/§0.1.

Read now, before anything else:
- docs/decisions/0016-governed-memory.md — the whole ADR. Its MEM-* constraint table is half your
  acceptance checklist.
- docs/build-guide/session-23.md §0 (Locked) + §0.1 (the four resolved questions) — BINDING scope.
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three test tiers. RLS tests are Tier-1
  (supabase/__tests__, live Postgres); scoring/capping tests are Tier-2 (lib/memory/*.test.ts).
  "Covered" means "executed green in CI", never "authored".
- CLAUDE.md — RLS/erasure-cascade rules, the three Supabase client roles, the lazy service-role
  import pattern, the bounded-query + explicit-ORDER-BY rules.
- The real seams, at HEAD: lib/ai/context.ts (buildCustomerContext, CustomerContext, the fan-out),
  lib/ai/runner.ts (JSON.stringify(context), cache_control), lib/db/campaigns.ts,
  lib/db/post-metrics.ts, lib/db/voice.ts, lib/db/brand-voices.ts, supabase/migrations/ (copy the
  existing RLS + cascade pattern), lib/ai/context.test.ts (the behaviour-equivalence gate lives here).

ECC posture: run every step through /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop, AND invoke
the step's named specialist (see session-23.md §2 table) at authoring time:
- B0 → database-reviewer + the supabase-postgres-best-practices skill (RLS/cascade/index).
- B2 → ecc:silent-failure-hunter over the scoring/cap code.
- B3 → ecc:type-design-analyzer over the CustomerContext contract.
- B4 → ecc:cost-aware-llm-pipeline over the runner.ts cache split.
Follow CLAUDE.md's tsc/vitest invocation notes exactly (tsc --noEmit --skipLibCheck; scoped vitest run).

Do NOT write code yet. Confirm these grounding facts (a wrong one is a STOP):
(1) buildCustomerContext's current fan-out — every lib/db call it makes and each call's limit; cite
    file:line.
(2) That runner.ts still does JSON.stringify(context) into the first message, and where cache_control
    is set; cite file:line.
(3) The LIVE RLS policy form — confirm it is `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`
    (established by 20260430120017_fix_rls_function_caching; restated in 20260702120100), NOT the bare
    `= ANY (public.get_user_business_ids())` in the pre-017 campaigns.sql:42-59. Cite the migration. Also
    cite the exact ADR 0010 Amd 2 §D2.5 cascade-table rows you must add (0010-legal-surface.md:1049-1073).
(4) Restate ADR 0016's Q1/Q2 answers from the ADR itself: the FOUR new tables (brand/evidence/audience/
    performance), voice read through existing tables, relationship deferred; embeddings deferred
    (deterministic scoring). If the ADR says otherwise, the ADR wins — cite it.
(5) The CustomerContext contract fields the generation prompts consume, and confirm ADR §6: only
    recentPostPerformance changes source (capped 3, derived from post_metrics); evidence/audience/brand
    are built+tested but NOT wired into CustomerContext in Track A. Prove the interface shape is unchanged.
(6) The service-role reality: buildCustomerContext reads via service-role (context.ts:35-37), so
    generation-path tenancy is the explicit business_id filter (the getVariationForBusiness pattern,
    voice.ts:111-112); RLS + Tier-1 tests protect the future authenticated read path (ADR §4).
Output the six findings + "Ready for B0." Then stop.
```

### §2b — Builder steps

#### B0 — Migrations: memory tables + RLS + erasure cascade  ·  ADR 0016 §2–§4  ·  MEM-RLS-ISOLATED, MEM-CASCADE-COMPLETE

```
BUILDER — Session 23 · B0. Migrations + Tier-1 RLS tests only. No lib/memory yet, no context rewire.
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke the database-reviewer agent AND the
supabase:supabase-postgres-best-practices skill WHILE authoring the migration — RLS, cascade and
index mistakes get caught here, not in §3.

BUILD:
- supabase/migrations/<ts>_governed_memory.sql — the FOUR tables from ADR §3: brand_memory,
  evidence_memory, audience_memory, performance_memory. Each: business_id uuid NOT NULL REFERENCES
  public.businesses(id) ON DELETE CASCADE; the full §2 governance block (source, confidence numeric(3,2)
  CHECK 0..1, observation_count int, status text CHECK ('candidate','active','retired'), sensitivity,
  public_use_permission, scope + scope_ref, last_confirmed_at, expires_at, deleted_at, created_at,
  updated_at) PLUS the per-type domain columns (§3.1–§3.4); the set_updated_at BEFORE UPDATE trigger;
  and the retrieval index EXACTLY as §5.3:
    CREATE INDEX <t>_retrieval_idx ON public.<t>
      (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)
      WHERE deleted_at IS NULL AND status = 'active';
  plus a plain <t>_business_id_idx (business_id). RLS enabled; the FOUR policies TO authenticated using
  the InitPlan form `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` (SELECT/INSERT/
  UPDATE-with-USING+WITH-CHECK/DELETE) — copy the POST-017 shape (e.g. brand_voices/post_metrics or
  20260702120400), NOT the pre-017 campaigns.sql body. Text-enum-via-CHECK (no native pg enums — repo
  convention). NO user_can() write-gating in Track A (ADR §4 defers it to the memory UI; record that).
- Same migration: add ONE §D2.5 row per table to ADR 0010 (brand/evidence/audience/performance →
  yes / CASCADE / yes / "none — cascade = erasure"; evidence notes third-party quote PII). NO
  purge_business change — the root DELETE FROM businesses cascades them (ADR §4.1). A table with no
  §D2.5 row is a STOP.
- supabase/__tests__/governed-memory-rls.test.ts — Tier-1, live Postgres: RLS enabled per table;
  cross-tenant SELECT returns zero rows; an authenticated client cannot INSERT/UPDATE a row for a
  business it doesn't belong to (USING + WITH CHECK proven, not assumed); erasure removes the rows.

VERIFY:
- Apply the migration to the live/local DB; run npm run test:db over the new suite. RLS proofs must
  EXECUTE against real Postgres (a pg_policies read or a mocked client is NOT coverage, ADR 0015 §2).
- Feed the database-reviewer's findings back in; fix before commit.
On commit: "B0 complete — governed-memory tables + RLS + cascade (MEM-RLS-ISOLATED,
MEM-CASCADE-COMPLETE); N Tier-1 tests green on live Postgres; database-reviewer clean." Then stop.
```

#### B1 — `lib/db/` query functions for the memory tables  ·  ADR 0016 §5 (Q4)  ·  MEM-NO-DIRECT-TABLE-ACCESS

```
BUILDER — Session 23 · B1. Data-access layer only. ADR Q4 = memory reads go THROUGH lib/db/ (§5.1).
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop; invoke typescript-reviewer on the new query
functions (typed rows, no `any`, bounded + explicit ORDER BY).

BUILD:
- lib/db/memory-brand.ts, memory-evidence.ts, memory-audience.ts, memory-performance.ts — typed
  candidate-query functions, signature (client, businessId, limit = MEMORY_CANDIDATE_LIMIT). Each:
  .eq('business_id', businessId)  // explicit filter — service-role bypasses RLS (ADR §4)
  .eq('status', 'active').is('deleted_at', null)
  .order('confidence', {ascending:false}).order(COALESCE(last_confirmed_at, created_at) DESC)  // matches the B0 index
  .limit(limit)
  — Postgrest can't COALESCE in .order(); use a generated/aliased order or .order('last_confirmed_at',
  {ascending:false, nullsFirst:false}) with created_at tiebreak, OR a view/rpc — pick the form that
  actually uses <t>_retrieval_idx and keeps the NULL-last_confirmed_at row inside the window (ADR §5.3
  note). NO scoring/capping here — this layer returns candidates; ranking is lib/memory's job (B2).
- lib/db/memory-*.test.ts — query-shape (right table, business_id + status='active' + deleted_at null
  filters, limit applied, ORDER BY present and index-matching) AND the NULL-last_confirmed_at ordering
  case ADR §5.3 mandates (a fresh distilled row must still land in the candidate window).

VERIFY: npm run test:app over the new db suites; tsc clean.
On commit: "B1 complete — lib/db memory query functions, index-matched ORDER BY + NULL-ordering test
(MEM-NO-DIRECT-TABLE-ACCESS: nothing outside this layer + lib/memory touches the tables)." Then stop.
```

#### B2 — `lib/memory/` module: scored, capped `retrieveRelevant`  ·  ADR 0016 §5  ·  MEM-SCOPED-RETRIEVAL, MEM-HARD-CAP, MEM-VOICE-THROUGH-EXISTING

```
BUILDER — Session 23 · B2. The retrieval boundary. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. After the scoring/cap code is written, run ecc:silent-failure-hunter over it:
a cap that silently returns fewer than expected, a score that quietly defaults to zero, or a
tie-break that drops the higher-confidence record are exactly the quiet failures that pass a naive
test — hunt them before commit.

BUILD:
- lib/memory/{brand,evidence,audience,performance}.ts, each exposing
  retrieveRelevant(client, businessId, queryContext, limit?) — the explicit `client` param is ADR §5.2
  (caller owns the role; do NOT drop it to the doc's 3-arg sketch). It calls the B1 lib/db candidate
  query, then applies the §5.3 DETERMINISTIC score
    score = w_conf·confidence + w_rec·recencyDecay(last_confirmed_at ?? created_at) + w_scope·scopeMatch(scope/scope_ref, queryContext)
  (weights = MEMORY_SCORE_WEIGHTS constant; NO embeddings — Q2 deferred), then TRUNCATES to the per-type
  cap: EVIDENCE_CAP=5, PERFORMANCE_CAP=3, AUDIENCE_CAP=5, BRAND_CAP=5. Output = min(scored, CAP); the
  `limit` param bounds the DB candidate scan (default MEMORY_CANDIDATE_LIMIT=50), NOT the output. The cap
  is not the caller's choice past the ceiling (L-4).
- lib/memory/performance.ts SPECIAL CASE (ADR §3.4): performance_memory ships EMPTY (Track C fills it).
  In Track A, derive the scored patterns from the EXISTING post_metrics (via lib/db/post-metrics
  listTopPostMetrics), and prefer performance_memory rows if any exist. This is what keeps B3
  behaviour-equivalent. Do NOT build a distillation writer (Track C / L-1 → STOP).
- lib/memory/voice.ts — reads THROUGH existing brand_voices / brand_voice_variations (getBrandVoice,
  getVariationForBusiness), NOT a new store (MEM-VOICE-THROUGH-EXISTING). Core voice rules ALWAYS
  returned (no cap).
- lib/memory/index.ts — the single public entry point (mirrors lib/social/index.ts). Nothing imports
  lib/memory/<type> directly from outside the module.
- lib/memory/*.test.ts — Tier-2: scoring orders candidates by the §5.3 function; the cap TRUNCATES
  (feed >cap → exactly cap returned, highest-scored kept — test must REDDEN if the cap is mutated up);
  candidate/retired/expired rows are EXCLUDED; low-confidence loses to high at equal recency; voice core
  rules always present. These prove MEM-HARD-CAP + MEM-CONFIDENCE-GATED are real, not documented.

VERIFY: npm run test:app; tsc clean. Prove the cap with a >cap fixture, not a comment. Address every
silent-failure-hunter finding before commit.
On commit: "B2 complete — lib/memory retrieveRelevant, scored + hard-capped (MEM-SCOPED-RETRIEVAL,
MEM-HARD-CAP, MEM-VOICE-THROUGH-EXISTING); silent-failure-hunter clean." Then stop.
```

#### B3 — Rewire `buildCustomerContext` through `lib/memory/`  ·  ADR 0016 §6  ·  MEM-CONTEXT-EQUIVALENT

```
BUILDER — Session 23 · B3. The load-bearing rewire. Behaviour-equivalence gate (L-7) is the whole
risk here. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:type-design-analyzer
on the CustomerContext interface before AND after the change — its job is to confirm the contract's
shape (and every field the generation prompts read) is byte-for-byte the same invariant.

BUILD (ADR §6 — ONLY recentPostPerformance moves; everything else stays):
- lib/ai/context.ts — replace ONLY the recentPostPerformance section (listTopPostMetrics(...,10) +
  listPostsByIds, context.ts:43,47-60) with lib/memory/performance.retrieveRelevant, capped at
  PERFORMANCE_CAP=3. LEAVE AS-IS: business (getBusinessById), brandVoice (getBrandVoice + variation
  resolve, context.ts:87-96), recentCampaigns (listCampaigns(...,5) — operational, not a memory type),
  trialState. Do NOT wire evidence/audience/brand memory into CustomerContext — 0017 owns that (§6.3);
  doing so adds contract fields = L-7 STOP.
- The CustomerContext interface (context.ts:13-29) MUST NOT change shape. buildCustomerContext's
  signature stays (businessId, voiceVariationId?) — it acquires its own service-role client internally
  (context.ts:35-37); do NOT add a client param here.

VERIFY (this is the gate):
- Every existing lib/ai/context.test.ts case passes UNCHANGED, with EXACTLY ONE pre-authorised
  exception (ADR §6.2): if a case pins recentPostPerformance count > 3, that assertion encodes the
  pre-cap "dump 10" behaviour L-4 intentionally kills — updating THAT one assertion to ≤3 is allowed
  and is NOT masking a regression. Any OTHER test needing an edit is a behaviour change → STOP and show
  it. Cite the specific case you change and why.
- Add tests: recentPostPerformance length ≤ PERFORMANCE_CAP; core voice still returned; contract shape
  identical. type-design-analyzer confirms the interface invariant held.
On commit: "B3 complete — recentPostPerformance reads through lib/memory (capped 3, post_metrics-derived);
CustomerContext shape unchanged (type-design-analyzer confirmed); one §6.2 count assertion updated, all
other context tests green unchanged (MEM-CONTEXT-EQUIVALENT)." Then stop.
```

#### B4 — `runner.ts` over-inclusion fix  ·  ADR 0016 §7  ·  L-8

```
BUILDER — Session 23 · B4. Prompt-assembly hygiene, bounded by L-7. Run /ecc:plan → /ecc:tdd-workflow
→ /ecc:verification-loop. Invoke ecc:cost-aware-llm-pipeline on the cache split — this step exists to
capture a prompt-cache saving the code already half-implements; that skill validates the
cached-stable vs uncached-retrieved boundary is drawn where the token economics actually pay off.

BUILD (ADR §7):
- lib/ai/runner.ts — DELETE the blanket dump: `const userContextMsg = JSON.stringify(context)`
  (runner.ts:94) and its user text block (runner.ts:101). The context is already available to
  buildSystemPrompt(context) (runner.ts:84, carries cache_control: ephemeral when large, :85-91) and
  buildUserMessage(input, context) (runner.ts:95) — the raw JSON was redundant, uncached over-inclusion.
  Stable slice (business identity, platform constraints, core voice) rides the CACHED system block;
  the per-call retrieved slice (recentPostPerformance) rides the UNCACHED buildUserMessage — it must NOT
  enter the cached prefix (would poison it).
- ESCAPE HATCH (ADR §7): if a specific prompt genuinely relied on a field only present in the raw dump
  (proven by a fixture-output DIFF), add that ONE field explicitly to that prompt's buildUserMessage —
  never re-add whole-object JSON. Do NOT change the CustomerContext contract (L-7).

VERIFY:
- MockAnthropicClient routes by prompt.id (runner.ts:112-114): prove generation output is
  FIXTURE-IDENTICAL after removing the dump (this is what bounds the change to L-7). Add a test asserting
  the retrieved slice is NOT in the cached system block and the stable slice IS. tsc clean; full app
  suite green.
- cost-aware-llm-pipeline confirms the split lands the cache benefit (stable prefix cacheable,
  per-call slice excluded from it).
On commit: "B4 complete — runner.ts context split into cached-stable vs uncached-retrieved (L-8);
cache benefit confirmed; no CustomerContext contract change." Then stop.
```

---

## §3 — Reviewer session (A3)  ·  (paste into Claude Code · Opus)

Run only after B0–B4 are committed. The Reviewer is independent and modifies nothing. It is the
**single** review pass for this session — there is no separate re-review track; the correction pass
(§4) records its own resolutions and the founder adjudicates close-out.

**ECC in this phase.** Invoke, alongside the Reviewer's own reasoning, the specialists whose remit
maps to this track's risk surface:
- `database-reviewer` — RLS/cascade/index correctness on the new tables.
- `security-reviewer` — tenancy isolation, service-role leakage, no raw token/PII in the new stores.
- `typescript-reviewer` — no `any`, contract integrity, the module boundary.
- `ecc:pr-test-analyzer` — whether each MEM-* constraint's test genuinely *executes* and *would fail*
  if the property broke (this session's whole thesis is ADR 0015's "covered = executed", not authored).
- `ecc:type-design-analyzer` — the `confidence` enum/scale and the `CustomerContext` contract as
  designed invariants.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 23 — Governed Memory Foundation, REVIEWER phase. You are an INDEPENDENT reviewer: you did NOT
write this code and you will not modify any file. Output is a review document only. This is the ONE
review pass for the session — audit thoroughly; there is no re-review to catch what you miss.

⚠️ PROC-REVIEW-AT-COMMIT (CLAUDE.md / ADR 0015 §6 — a HARD constraint): read EVERY file AT THE STATED
COMMIT RANGE — git diff <base>..<head>, git show <sha>:<path>, git log --oneline <base>..<head> —
NEVER at HEAD. Your report MUST OPEN by naming the exact commit range you read and stating that every
citation comes from that range. A report that does not name its range is not a valid review.

SHARED-FUNCTION CALLERS (CLAUDE.md): buildCustomerContext is a shared function. git grep its callers
and state, per caller, whether the rewire's behaviour-equivalence holds for it — one caller proven is
not the function proven.

Invoke database-reviewer AND security-reviewer AND typescript-reviewer AND ecc:pr-test-analyzer AND
ecc:type-design-analyzer. Use pr-test-analyzer specifically to judge whether each MEM-* test EXECUTES
and would REDDEN if its property broke — an authored-but-inert test is this session's cardinal sin.

Read now, at that range:
- docs/decisions/0016-governed-memory.md — the MEM-* constraint table is your checklist.
- docs/build-guide/session-23.md §0 (Locked, incl. L-7 equivalence gate + L-8) and §0.1 (the four
  ADR decisions — verify the ADR actually resolved them, and the Builder obeyed them).
- The full Session 23 diff, COMMIT BY COMMIT (B0…B4), and every test added.
- supabase/migrations/<ts>_governed_memory.sql, supabase/__tests__/governed-memory-rls.test.ts,
  lib/db/memory-*.ts, lib/memory/*, lib/ai/context.ts, lib/ai/runner.ts,
  docs/decisions/0010-legal-surface.md Amd 2 §D2.5 (the cascade table — is the new table IN it?).

Before reviewing anything, ESTABLISH RLS + CAP REALITY (this track is about tenancy-isolated,
hard-capped retrieval — a wrong answer here voids the review):
(1) Do the new-table RLS tests EXECUTE against live Postgres (db-tests / supabase/__tests__), or are
    they mocked / pg_policies reads? Point at the run. A mocked RLS test is NOT coverage (ADR 0015 §2).
(2) Is every new business-scoped table in the ADR 0010 Amd 2 §D2.5 cascade table AND cascade-wired?
    Name any table that is not — that is a GDPR-erasure leak.
(3) Is the hard cap PROVEN by a >cap fixture (exactly cap returned, highest-scored kept), or only
    documented? Point at the test.
(4) Does buildCustomerContext's CustomerContext contract still match what the generation prompts
    consume (L-7)? Did any existing context test get EDITED to pass (a silent behaviour change)?
Output the above and "Ready to review 23 (range: <sha>..<sha>)." Then wait.
```

### §3b — Reviewer prompt  (paste after acknowledgement)

```
REVIEWER — Session 23. Audit the diff commit-by-commit against ADR 0016. RE-DERIVE the adversarial
checks yourself (write the query, reason about the outcome) rather than trust a test's name. Tier
every finding BLOCKER / MAJOR / MINOR / NIT. All citations at the stated commit range.

SECTION A — TENANCY ISOLATION  (MEM-RLS-ISOLATED · the BLOCKER-class area · database-reviewer + security-reviewer)
A1. Every new memory table has RLS enabled with (SELECT get_user_business_ids()) SELECT and USING +
    WITH CHECK on UPDATE. Prove a raw authenticated client for business X cannot SELECT, INSERT, or
    UPDATE a row scoped to business Y — EXECUTED against live Postgres, zero rows. A gap is a BLOCKER.
A2. No service-role client leaks into a user-facing read path; lib/memory uses the anon/authenticated
    client for tenant reads, lazy-imports service-role only where the ADR sanctions it. No raw token
    or PII lands in the new stores (security-reviewer).

SECTION B — ERASURE CASCADE  (MEM-CASCADE-COMPLETE)
B1. Every new business-scoped table is in ADR 0010 Amd 2 §D2.5's cascade table AND either ON DELETE
    cascades from businesses or is purged in purge_business. A missing entry is a BLOCKER (silent GDPR
    leak, CLAUDE.md).

SECTION C — RETRIEVAL IS SCOPED AND HARD-CAPPED  (MEM-SCOPED-RETRIEVAL, MEM-HARD-CAP · pr-test-analyzer)
C1. retrieveRelevant returns AT MOST the ADR cap per type (feed >cap candidates → exactly cap out,
    highest-scored retained). If the cap can be exceeded, that is a MAJOR — the cap is the whole
    discipline of this track. Confirm the test REDDENS if the cap is mutated upward (pr-test-analyzer).
C2. Scoring orders by the ADR's function (recency/confidence/scope, or embeddings); low-confidence
    loses to high at equal recency. Every retrieveRelevant takes a limit and has an explicit ORDER BY
    matching a real index — an unbounded query or an implicit order is a MAJOR (CLAUDE.md).
C3. Voice is read THROUGH the existing brand_voices/brand_voice_variations tables, not duplicated
    (MEM-VOICE-THROUGH-EXISTING). A parallel voice store is a MAJOR.

SECTION D — THE REWIRE IS BEHAVIOUR-EQUIVALENT  (MEM-CONTEXT-EQUIVALENT · L-7 · type-design-analyzer)
D1. The CustomerContext interface shape is UNCHANGED. Diff it. Any field added/removed/retyped that
    reaches the generation prompts is a BLOCKER unless the ADR explicitly ratified it as a
    founder-approved contract change.
D2. No existing lib/ai/context.test.ts case was edited to pass. Diff the test file — a loosened or
    rewritten assertion masking a behaviour change is a MAJOR.
D3. Every caller of buildCustomerContext (git grep) still gets an equivalent context. Enumerate them.

SECTION E — MODULE BOUNDARY  (MEM-NO-DIRECT-TABLE-ACCESS · L-2 · typescript-reviewer)
E1. Nothing outside lib/memory/ (and, per ADR Q4, lib/db/memory-*) queries the new tables. grep for
    the table names across app/**, components/**, lib/** — a stray direct query is a MAJOR (it is the
    lib/social boundary violation, applied here).
E2. Consumers import from lib/memory/index.ts, not lib/memory/<type> directly.

SECTION F — SCOPE + PROCESS  (L-1)
F1. NO learning/distillation worker, NO Mode 2 brief pipeline, NO rubric, NO mining, NO new route,
    NO Stripe, NO UI shipped. Any of these is an out-of-scope BLOCKER (Track B/C owns them).
F2. No `any`, no `console.*`; env via lib/config; DB via lib/db/lib/memory; date-fns for timestamps.
F3. The four §0.1 questions are each resolved IN the ADR and obeyed by the Builder.

SECTION G — CONSTRAINT COVERAGE (the thesis · pr-test-analyzer)
G1. EVERY MEM-* constraint maps to a test AND to the CI JOB that executes it (Tier-1 → db-tests,
    Tier-2 → app-tests). A constraint with a test but no executing job is a MAJOR (ADR 0015 §2). For
    each, state whether pr-test-analyzer confirmed the test would fail if the property broke.
G2. State before/after: what buildCustomerContext dumped into a prompt before vs the capped slice now.

OUTPUT: docs/reviews/session-23-reviewer.md —
- OPEN by naming the commit range read (PROC-REVIEW-AT-COMMIT) + the buildCustomerContext caller
  enumeration (SHARED-FUNCTION CALLERS).
- A table: Section / Check / Status (✅/⚠️/❌) / File:Line / Note.
- Then BLOCKER, MAJOR, MINOR, NIT — each with an exact fix instruction.
- A coverage section: constraint → test → executing CI job → tier → "reddens if broken?" (pr-test-analyzer).
- A VERDICT: blockers before merge · deferrable debt · whether governed retrieval is genuinely
  tenancy-isolated + hard-capped + behaviour-equivalent.
Do NOT modify code. Do NOT write the correction prompts — those come after this report (§4).
```

---

## §4 — Correction pass (Session 23-D)  ·  (paste into Claude Code · Opus)

**Filled in from `docs/reviews/session-23-reviewer.md` (Reviewer range `f688fc54^..708fe468`).** Six
steps: **D0–D5**. Correction passes are normal, not failures (constitution). **There is no independent
re-review pass this session** (founder decision): the correction pass fixes the Reviewer's findings,
records its own resolutions, and the founder adjudicates close-out.

**What the Reviewer found (summary — the full text is authoritative):**

| ID | Tier | One line | Fixed in |
|---|---|---|---|
| BLOCKER-1 | BLOCKER | The whole range has never executed in CI — all 8 Tier-1/2 constraints are `AUTHORED-NOT-EXECUTED` | **D5** (last, deliberately) |
| BLOCKER-2 | BLOCKER | ADR 0016 + build guide + `docs/current-phase.md` are untracked; the MEM-* checklist and the §6.2 authorisation exist at no commit | **D0** (first) |
| MAJOR-1 | MAJOR | B4 removes context from 3 of 4 templates; the "fixture-identical" test cannot fail by construction | **D3** |
| MAJOR-2 | MAJOR | `toBeLessThanOrEqual(3)` passes at 0 — the production cap assertion is inert | **D1** |
| MAJOR-3 | MAJOR | `voice.ts` duplicates live voice resolution it was written to replace; 4 of 5 modules have no consumer | **D2** |
| MAJOR-4 | MAJOR | 10→3 narrowing reaches 5 callers of `buildCustomerContext`; 0 have caller-level tests | **D4** |
| MINOR-1..4, NIT-1..3 | deferrable | see §4.4 — MINOR-2 must be recorded as an un-defer trigger before ADR 0018 | **D0** (MINOR-2 doc only) |

**Ordering rationale (a deliberate departure from "BLOCKERs first").** BLOCKER-2 is a commit, so it
leads. BLOCKER-1 is *"push and get both CI jobs green on this exact range"* — which cannot be satisfied
until the range is final. Running it first would green a range that D1–D4 then invalidate. **BLOCKER-1
therefore closes the pass, not opens it.** State this reasoning in the resolution log so the ordering
does not read as a downgrade of a BLOCKER.

**REVIEWER-REPORT IMMUTABILITY — founder-ratified amendment (Session 23-D).** The original rule sent
resolutions to a separate `session-NN-D-corrections.md`. The founder has ratified the house practice
instead: **resolutions live in the reviewer's own report, appended, never overwriting it.** The harm the
rule guards against is *eliminating the reviewer* — findings rewritten or downgraded by the author of
the fix, as 22-D did. Appending is the opposite: the findings stand verbatim and the record shows how
each was corrected.

Binding form, therefore:

- The Reviewer's findings — every BLOCKER/MAJOR/MINOR/NIT block, the tables, the VERDICT — are **read-only
  to 23-D**. Not one word edited, no `RESOLVED` stamped into a finding, no status flipped.
- 23-D appends **one new section at the BOTTOM** of `docs/reviews/session-23-reviewer.md`, headed
  `## Correction pass resolutions (Session 23-D)` and opening with an attribution line naming 23-D as
  its author and stating the findings above are unmodified.
- Cross-reference by ID (`BLOCKER-2 → D0`), never by editing the finding.
- **`docs/reviews/session-23-D-corrections.md` is NOT created.** Any earlier instruction in this guide
  to create it is superseded by this paragraph.
- **D0 amends `CLAUDE.md`'s REVIEWER-REPORT IMMUTABILITY paragraph** to record this ratified form, so
  the next session does not re-litigate it. The rule is not deleted — it is narrowed to what it was
  always for: no in-place edits, no self-authored verdicts on someone else's findings.

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
Session 23-D — Governed Memory Foundation, CORRECTION pass. You are fixing the findings in
docs/reviews/session-23-reviewer.md (range f688fc54^..708fe468). Six steps, D0…D5, each its own commit.

Read now, before anything else:
- docs/reviews/session-23-reviewer.md — IN FULL. It is your work order AND the file your resolutions
  land in. You do NOT edit its findings — not one word, no RESOLVED stamps, no status flips. You APPEND
  a "## Correction pass resolutions (Session 23-D)" section at the BOTTOM. See §4 of the build guide;
  the founder ratified this form. Do NOT create session-23-D-corrections.md.
- docs/build-guide/session-23.md §0 (Locked, esp. L-1 scope, L-7 equivalence gate, L-8) and §4 (this
  section — the step list and the ordering rationale).
- docs/decisions/0016-governed-memory.md — the MEM-* constraint table you are discharging.
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — "covered = executed green in CI, never
  authored". Every fix below exists because something was authored and not executed, or asserted in a
  comment rather than pinned by a test that can fail.

Binding rules for this pass:
- L-1 still holds. No Mode 2, no rubric, no mining, no worker, no route, no UI. A fix that seems to
  need one is a STOP.
- L-7 still holds. CustomerContext's shape does not change. D3 adjudicates what reaches the MODEL,
  which is a different question from the contract's shape — do not conflate them.
- NEVER weaken a test to reach green. If a correction shows an ADR 0016 constraint is infeasible,
  amend the ADR and say so (§4.3).
- Each step: /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop, plus the step's named specialist.
  tsc --noEmit --skipLibCheck; scoped vitest run (CLAUDE.md invocation notes).

Confirm these grounding facts (a wrong one is a STOP):
(1) Which of docs/decisions/0016-governed-memory.md, docs/build-guide/session-23.md,
    docs/current-phase.md, docs/brainstorm/ are currently untracked or modified-uncommitted (git status).
(2) That origin/session-22-d is BEHIND the five Session 23 commits — i.e. f688fc54..708fe468 is unpushed.
(3) The exact assertion at the MAJOR-2 site in lib/ai/context.test.ts, quoted.
(4) That lib/ai/context.ts still resolves brandVoice INLINE and does not call retrieveVoice (MAJOR-3).
(5) The three prompt templates' render sets from the MAJOR-1 table — re-derive them yourself from
    lib/ai/prompts/*.ts rather than trusting the report's table.
Output the five findings + "Ready for D0." Then stop.
```

### §4.1 — Correction steps

#### D0 — BLOCKER-2: commit the governing docs  ·  no code

```
CORRECTION — Session 23-D · D0. Docs only. No .ts, no .sql changes.

BUILD:
- Commit docs/decisions/0016-governed-memory.md, docs/build-guide/session-23.md, and the
  docs/current-phase.md modification as a single `docs(adr): ADR 0016 governed memory + session 23
  build guide` commit.
- History is NOT rewritten (the five build commits are already authored against it). The ADR therefore
  post-dates the code it governs — state that explicitly in docs/reviews/session-23-D-corrections.md,
  as the Reviewer's fix instruction requires. Do not rebase.
- docs/brainstorm/: commit it (it is the source the ADR was derived from and three build-guide sections
  cite it by path). Leaving it untracked is the exact ambiguity that produced BLOCKER-2.
- MINOR-2 (doc-only part): add the `likes: 0 / impressions: 0` placeholder to ADR 0016 §3.4 as a NAMED
  un-defer trigger — "ADR 0018 must not ship on top of this without resolving it", since Track C
  populating performance_memory is what makes the placeholder start reaching real prompts.
- MINOR-1 (doc-only part): record the service-role + single-.eq() dependency in ADR 0016 §4 as a named
  risk. The Tier-2 test half of MINOR-1 is deferred (§4.4).
- APPEND to docs/reviews/session-23-reviewer.md — do NOT create a separate corrections file — a new
  final section:

    ## Correction pass resolutions (Session 23-D)

    *Appended by Session 23-D, author of the fixes below. Every finding above is UNMODIFIED — no
    verdict was edited, downgraded, or stamped RESOLVED in place. This section records how each
    finding was corrected; the Reviewer's assessment stands as written.*

    | Finding | Step | Fix | Test that now proves it | SHA |

  Seed it with the D0 row. Each later step appends its own row. Nothing above this heading is touched.
- Amend CLAUDE.md's REVIEWER-REPORT IMMUTABILITY paragraph to the founder-ratified form: resolutions
  are APPENDED to the reviewer's report in an attributed section; findings are never edited in place
  and never carry self-authored RESOLVED verdicts. Keep the 22-D precedent sentence — it explains what
  the rule prevents. Mirror the same amendment into docs/decisions/0015-test-execution-and-ci-gates.md
  if it restates the rule there.

VERIFY: git log shows the docs commit; git status shows no untracked docs/ paths; git diff confirms
session-23-reviewer.md gained ONLY an appended section (no edits above the new heading) — check this
with `git diff docs/reviews/session-23-reviewer.md` and read every hunk.
On commit: "D0 complete — ADR 0016 + build guide + brainstorm + current-phase committed (BLOCKER-2);
ADR post-dates its code, recorded; MINOR-1/MINOR-2 doc notes added; resolutions section appended to
reviewer report; CLAUDE.md immutability rule narrowed to ratified form." Then stop.
```

#### D1 — MAJOR-2: the production cap assertion that passes at zero

```
CORRECTION — Session 23-D · D1. Smallest fix; do it first among the code changes.
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Re-invoke ecc:silent-failure-hunter (this
IS a silent-failure finding: an assertion that cannot distinguish "capped correctly" from "returned
nothing").

BUILD:
- lib/ai/context.test.ts, case "recentPostPerformance never exceeds PERFORMANCE_CAP (3)…":
  replace `expect(ctx.recentPostPerformance.length).toBeLessThanOrEqual(3)` with
  `expect(ctx.recentPostPerformance).toHaveLength(3)` AND an assertion on the IDENTITY of the retained
  three (post ids, in expected order), so both "never more than cap" and "never silently fewer" redden.
  Mirror lib/memory/scoring.test.ts:158-170, which already does this correctly.
- The Reviewer names the three ways this can silently empty: performance.ts's early
  `if (topMetrics.length === 0) return []`, the metric→post join .filter(), and the
  `platform === null` .filter(). Add one case per path proving a NON-empty result survives it, or that
  the emptying is intentional and pinned.

VERIFY: mutate PERFORMANCE_CAP to 5 locally and confirm the test REDDENS; mutate performance.ts to
return [] and confirm it REDDENS. Revert both. npm run test:app; tsc clean.
On commit: "D1 complete — production cap assertion pins exact length + survivor identity (MAJOR-2);
verified to redden on both cap-up and empty-return mutations." Then stop.
```

#### D2 — MAJOR-3: one voice resolver, not two

```
CORRECTION — Session 23-D · D2. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
ecc:type-design-analyzer (this touches the CustomerContext assembly path — L-7 applies).

The Reviewer offers (a) wire retrieveVoice in, or (b) delete voice.ts, and calls (a) the better call:
it is small, the tests already exist (context.test.ts "voice variation read-through"), and it
discharges MEM-VOICE-THROUGH-EXISTING against the LIVE path rather than an unused one. TAKE (a).

BUILD:
- lib/ai/context.ts — replace the inline brandVoice resolution (the getBrandVoice + variation-resolve
  block) with a call to retrieveVoice from '@/lib/memory' (the BARREL, not '@/lib/memory/voice').
  Delete the inline copy. The variation-override branch that lib/campaigns/generate.ts:83 depends on
  MUST be preserved — that caller is the only one passing voiceVariationId.
- CustomerContext.brandVoice's shape does not change (L-7). If retrieveVoice's return type does not
  already match what context.ts assigned, adapt at the call site — do NOT change the contract.
- lib/memory/index.ts — fix the stale header comment (NIT-3): there is now more than one consumer, and
  retrieveVoice IS wired as of this commit.
- Leave brand.ts / evidence.ts / audience.ts in place with no production consumer. That is defensible
  and ADR-sanctioned (§10 names ADR 0017 as their consumer) — but state it PLAINLY in the resolution
  log rather than shipping it silently, exactly as the Reviewer asks.

VERIFY: the existing voice tests in lib/ai/context.test.ts pass UNCHANGED — that is the proof the
rewire is equivalent. If one needs editing, that is a behaviour change → STOP and show it.
npm run test:app; tsc clean.
On commit: "D2 complete — buildCustomerContext resolves voice through lib/memory; inline duplicate
deleted (MAJOR-3); voice-variation tests green unchanged; index.ts header corrected (NIT-3)." Then stop.
```

#### D3 — MAJOR-1: adjudicate the B4 context loss, replace the inert test

```
CORRECTION — Session 23-D · D3. The one finding with a FOUNDER DECISION in it. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:cost-aware-llm-pipeline (part b changes what
rides the uncached slice) and ecc:pr-test-analyzer (part a is precisely "does this test redden?").

Part (a) — the test. MANDATORY, do this regardless of how (b) is adjudicated:
- DELETE the "generation output is fixture-identical after removing the dump" case. Its own comment
  explains why it cannot fail: MockAnthropicClient routes on _sosh.promptId/model, not on message
  content, so the parsed output is unaffected by the change BY CONSTRUCTION. It would stay green if B4
  had deleted the entire user message.
- Replace it with an assertion over the REQUEST actually sent. For EACH of the three templates
  (post-generation, post-regeneration, brand-voice-inference), assert which CustomerContext fields
  appear in system[0].text + messages[0].content[0].text. This pins the current narrowing as
  intentional and reddens on any future drift. Keep the two GENUINE clauses of MEM-RUNNER-CACHE-SPLIT
  (no JSON dump present; stable/retrieved slices don't cross the cache boundary) — the Reviewer
  confirms both redden properly.

Part (b) — the adjudication. STOP AND ASK THE FOUNDER before implementing. Present:
  post-regeneration currently loses recentCampaigns + recentPostPerformance from the model's view.
  That is the path whose whole job is "produce a better version of this post", and it was adopted
  under a code comment asserting it was "not a behaviour change".
  Option 1 (restore): render recentPostPerformance + recentCampaigns explicitly in
    post-regeneration.ts's buildUserMessage. Restores equivalence; costs uncached tokens on that path.
  Option 2 (accept): record in ADR 0016 §7 that the narrowing is accepted, and WHY.
  Losing trialState from all three is almost certainly desirable either way — say so, don't re-add it.
Implement whichever the founder picks. Do NOT leave this resolved only by a code comment.

VERIFY: the new per-template request assertions redden if a field is dropped from a buildUserMessage.
npm run test:app; tsc clean.
On commit: "D3 complete — inert fixture-identical test replaced with per-template request assertions
(MAJOR-1a); regeneration context loss adjudicated as <restored|accepted-in-ADR-§7> (MAJOR-1b)."
Then stop.
```

#### D4 — MAJOR-4: caller-level equivalence tests

```
CORRECTION — Session 23-D · D4. The SHARED-FUNCTION CALLERS rule (CLAUDE.md) — the exact shape of
Session 22's BLOCKER-1/2, arriving again. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.
Invoke ecc:pr-test-analyzer.

buildCustomerContext has FIVE production callers (Reviewer's table). Zero currently have a test
covering the rewire. One function proven is not five callers proven.

BUILD:
- Add a Tier-2 test per GENERATION caller — MINIMUM lib/campaigns/generate.ts and
  app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts — asserting the ASSEMBLED PROMPT contains
  at most 3 performance entries AND that they are the highest-scoring ones. Not the context object:
  the prompt. That is where the 70% reduction in performance evidence actually lands.
- Cover the remaining three callers (generate-action.ts, infer-brand-voice/actions.ts,
  settings/voice/refine-from-posts-action.ts) at least to the level of "context assembles, contract
  shape intact, no throw" — thinner is acceptable for the non-generation paths, but ZERO is not.
- lib/campaigns/generate.ts is the only caller passing voiceVariationId. After D2 that path now runs
  through retrieveVoice — its test must exercise the variation override specifically.

VERIFY: reproduce the Reviewer's caller enumeration FROM THE TESTS, not from git grep — write the
per-caller → test-file table into the resolution log. A caller with no listed test file is
AUTHORED-NOT-EXECUTED for that caller and must be named as such.
npm run test:app; tsc clean.
On commit: "D4 complete — caller-level equivalence tests for N of 5 buildCustomerContext callers
(MAJOR-4); per-caller test table in the resolution log." Then stop.
```

#### D5 — BLOCKER-1: execute the range in CI  ·  LAST, by design

```
CORRECTION — Session 23-D · D5. No code. This step converts the whole session from AUTHORED to
COVERED. It runs LAST because it must green the FINAL range, including D0–D4.

DO:
- Push the branch (the five B0–B4 commits plus D0–D4) and open the PR.
- Require BOTH app-tests AND db-tests green on this exact range before merge.
- In the db-tests run, OPEN THE LOG and confirm governed-memory-rls.test.ts and
  governed-memory-recency-column.test.ts each report a NON-ZERO executed count. The skip-guard covers
  this, but read it yourself — a suite a flag empties to zero tests is a FALSE-GREEN, not coverage.
- Paste BOTH run URLs into the "Correction pass resolutions (Session 23-D)" section appended to
  docs/reviews/session-23-reviewer.md. Append only — the findings above stay untouched.
- Update the db-tests promotion tally in docs/current-phase.md (currently 0 of 3) with this run's
  outcome. NOTE EXPLICITLY in the log: until it reaches 3/3, db-tests remains ADVISORY — a green run
  here does not yet block a bad merge, and a RED one must be READ BY A HUMAN and classified
  (DB-behaviour regression vs stack OOM), never assumed transient.
- If db-tests is red: classify it before doing anything else. Do not retry hoping for green.

VERIFY: both run URLs recorded; non-zero executed counts confirmed by reading the log; tally updated.
On commit: "D5 complete — range executed green in CI (BLOCKER-1); app-tests <url>, db-tests <url>;
RLS suites confirmed non-zero executed; promotion tally now N of 3." Then stop.
```

### §4.2 — Resolution log

Each correction commit appends to `docs/reviews/session-23-D-corrections.md`: **finding → fix → the
test that now proves it → the commit sha**. This is the audit trail; it is not the Reviewer's report
and does not edit it. Three things the Reviewer specifically asked to see recorded there, which are
easy to lose:

1. **The D0/D5 ordering rationale** — why a BLOCKER ran last.
2. **That ADR 0016 post-dates the code it governs** (D0, since history was not rewritten).
3. **The per-caller → test-file table** from D4, and the plain statement that `brand`/`evidence`/
   `audience` ship with no production consumer by design (ADR §10 → ADR 0017).

### §4.3 — Close-out

After the corrections are green and the resolution log is complete, the founder reviews and updates
the docs (§5). If any correction shows an ADR 0016 constraint is infeasible, **amend the ADR** — never
weaken a test to reach green.

### §4.4 — Explicitly deferred (carried, not dropped)

The Reviewer classes all MINORs and NITs as deferrable debt. Carried forward with owners so they do
not evaporate:

| Item | Disposition |
|---|---|
| MINOR-1 (Tier-2 `.eq('business_id')` assertions per `lib/db/memory-*.ts`) | Deferred to Session 24. The **doc-side** risk note lands in D0. |
| MINOR-2 (`likes: 0` placeholder inverts meaning once Track C populates the store) | **Un-defer trigger recorded in ADR 0016 §3.4 at D0.** ADR 0018 cannot ship on top of it unnoticed. |
| MINOR-3 (`platform: null` rows silently dropped, can under-fill the cap) | Deferred to ADR 0017, which owns the retrieval consumers. |
| MINOR-4 (brand/evidence/audience tests are thin — wrong cap constant would not redden) | Deferred to ADR 0017, when those modules gain real consumers. |
| NIT-1 (squash the two migrations) | **Declined.** Reviewer says do not rewrite history for this. |
| NIT-2 (`let admin: any`) | **Not a defect** — Reviewer records it as compliant with the CLAUDE.md carve-out. No action. |
| NIT-3 (stale `lib/memory/index.ts` header) | Fixed in D2. |

---

## §5 — Docs to update at close-out (Track A done)

Do these at the END of the build session, once B0–B4 (+ any 23-D) are green and reviewed — not
before. Match the pattern the other tracks used:

- **`docs/current-phase.md`** — a new "Session 23 CLOSED — Governed Memory Foundation (ADR 0016)"
  block in *What's done*, mirroring the Session 22 entry's density; and update the status line. Note
  the plan-doc §5 pointer: this was the queued next work stream after Session 22.
- **`docs/decisions/0016-governed-memory.md`** — mark any amendments the correction pass forced
  (e.g. a ratified CustomerContext change), same as ADR 0014 Amendment A / ADR 0011 Rev B.
- **`docs/decisions/0010-legal-surface.md` Amd 2 §D2.5** — confirm the new memory table rows are in
  the cascade table (the migration added them in B0; this is the doc-side confirmation).
- **`docs/brainstorm/session-plan-adrs-0016-0018.md`** — a one-line "Track A landed at <sha>; Tracks
  B (0017) and C (0018) are now unblocked and may run in either order" note, so the next session
  picks up without re-deriving the dependency graph.
- **OpenWolf:** update `.wolf/anatomy.md` with the new `lib/memory/*` files + the migration; append
  the session to `.wolf/memory.md`; add any new convention (e.g. "memory reads go through
  lib/memory/, never direct") to `.wolf/cerebrum.md` Key Learnings.
- **`docs/build-guide/session-24.md`** — when Track B (ADR 0017 Mode 2 upgrade) is scheduled, author
  it the same way this file was, now that `lib/memory/` exists in its real shipped shape.
