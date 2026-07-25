# Session 24 — Mode 2 Upgrade (ADR 0017) · Track B

> **Goal:** turn today's one-shot "objective → finished posts" generator into a **reviewable,
> strategy-first, structurally-native** pipeline — **without** becoming a second codebase. Insert a
> first-class, human-reviewable **BRIEF** (narrative + proof plan + post-role sequence) *before* any
> post copy exists; guarantee platform-native output through **format-family schemas** instead of
> prompting for it; and finally *consume* the `evidence`/`audience`/`brand` governed-memory modules
> Track A shipped but left unwired. Nothing else.
>
> **This is Track B of a three-track programme** (`docs/brainstorm/session-plan-adrs-0016-0018.md`):
> A = ADR 0016 governed memory (**landed** — Session 23, merged on `session-22-d`); B = ADR 0017 Mode 2
> upgrade (**this file**); C = ADR 0018 diff-based learning capture. **B depends on A having landed** —
> the brief reads scored, capped memory through `lib/memory/`, which now exists in its real shipped
> shape (`retrieveEvidenceMemory` / `retrieveAudienceMemory` / `retrieveBrandMemory` are built +
> Tier-2 tested but have **no production consumer yet** — ADR 0016 §10 names *this* ADR as their
> consumer). B does **not** depend on C. **Do not build** Mode 1 (Studio), Mode 3 (signal-driven /
> mining / insight cards / opportunity feed), the diff-learning capture, carousel/script format
> families, image generation, the "skip-review fast path", or the numbered-vs-unnumbered thread
> preference (all deferred — see §0 L-1 and the plan doc §4).
>
> **Product scope is real this time** (unlike Track A's near-zero surface): a new intermediate artifact
> (the brief), a new campaign checkpoint state ("brief awaiting approval"), `origin`/`role` schema
> additions, a reused quality rubric, discriminated output schemas, and — *if Q6 resolves it into this
> track* — a net-new brief-review UI. That is why this guide carries more open questions than Track A:
> the strategy docs deliberately left several Mode 2 shape decisions "for the Architect session".
>
> **Phase gating.** §1 (Architect) runs **first and alone**. Nothing in §2/§3/§4 starts until
> `docs/decisions/0017-mode-2-upgrade.md` is written and Accepted — the Builder transcribes the ADR, it
> does not run in parallel with its authoring. §0.1 carries the questions the Architect (B1) **must**
> resolve *in the ADR*; the Builder consumes those answers as binding. **§2/§3/§4 are intentionally
> placeholders in this file** — they are authored the same way Track A's were, but only *after* ADR 0017
> is finished and founder-approved, so they can be pinned to the ADR's real, named constraints
> (`MODE2-*`) rather than guessed ahead of it.
>
> **How to use this file:** run §1 to completion, get ADR 0017 accepted, come back and fill §2–§4 from
> the accepted ADR (exactly as Session 23 filled its correction pass from its reviewer report), THEN
> paste each later phase into Claude Code in order. **Architect → Opus. Builder → Sonnet. Reviewer →
> Opus. Correction → Opus.** Each phase opens with a **primer** — paste it, wait for acknowledgement,
> then paste the numbered steps one at a time, letting each go green + commit before the next.
>
> **One step, one commit.** The schema migration, the brief pipeline, the format-family split, the
> rubric, the hook loop, the consistency pass, and any UI are separately reviewable commits — a
> squashed feature this size is unauditable, and 21C proved a Reviewer cannot verify phase isolation
> after the fact.
>
> **ECC posture.** Every phase names the specialist agents/skills it uses — not just the
> `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` spine. Specialists are pulled into the
> Builder phase *proactively* (at the point a mistake is made), not only into review. This track's real
> risk surface: schema/migration + backfill correctness, prompt-injection through pinned evidence,
> type-design of the discriminated format-family schemas and the frozen-brief contract, cost/latency of
> the added stages, test-execution integrity, and — for any UI — **`impeccable` + `taste-skill`** on the
> brief-review surface (a net-new, high-touch screen that is the whole product differentiator, not a
> generic form). Do not add specialists outside this surface.

---

## §0 — Locked decisions (binding input — from the strategy docs; adjudicated by founder)

These are already decided in `campaign-modes-architecture-and-build-plan.md` and
`intelligence-layer-memory-mining-rubric-opportunity-feed.md`. The Architect (B1) **encodes** them in
ADR 0017 and names their losers; it does **not** re-open them. Where a Locked decision and this guide
disagree, the guide is wrong — flag it. Where the ADR needs to contradict a Locked decision, it STOPS
and flags for founder adjudication (exactly as an ADR contradicting CLAUDE.md would).

**Locked (L):**

- **L-1 — Track B ships the Mode 2 upgrade ONLY.** *In scope:* `origin` on campaigns; `role` enum on
  posts; the **BRIEF** as a first-class, human-reviewable artifact + its schema + its state machine;
  the **brief critique gate**; the **quality rubric** (built once in `lib/ai/`, reused by the critique
  gate and the consistency pass); **format-family output schemas** (single-post + thread **only**); the
  **frozen-brief → N-independent-per-platform-calls** generation; the **hook-refinement Tier-2 loop**;
  the **deterministic post-generation consistency pass** (role-coverage, link-placement,
  platform-nativeness); and **wiring `evidence`/`audience`/`brand` memory** (Track A shipped these
  unwired — ADR 0016 §10) into brief assembly. *Out of scope, explicitly:* Mode 1 Studio; Mode 3
  signal-driven / mining / insight cards / opportunity feed; the **diff-learning capture** (Track C);
  **carousel/script** format families; **image generation**; the **skip-review fast path**; the
  **numbered-vs-unnumbered** thread learned preference (Track C). If a step appears to need any of
  these, **STOP and report** — it contradicts ADR 0017's scope.

- **L-2 — The brief is generated BEFORE any post copy, and is human-reviewable.** narrative + proof
  plan + post-role sequence — *not posts*. It is the reviewable strategy checkpoint that turns "AI wrote
  my posts" into "AI proposed a strategy I can shape", and it is the mechanism that guarantees
  cross-platform coherence rather than hoping for it. Making the brief a first-class artifact *before*
  generation spends tokens on copy is the entire point of the upgrade — do not collapse it back into a
  one-shot generate.

- **L-3 — Coherence comes from a FROZEN brief, not per-platform re-derivation.** The brief pins
  specific evidence citations and assigns each post its role **once**; every platform call receives that
  **same frozen object**, never a fresh derivation from the raw objective. Platform generation
  *renders* the pinned argument into a native shape — it does not re-argue it. **N independent
  per-platform calls** from the frozen brief (each fails + retries independently), **not** one joint
  call returning all platforms at once (a joint call couples failure and complicates per-platform token
  budgets/parallelism). This is the existing idempotent/partial-failure-tolerant reliability principle,
  applied here.

- **L-4 — "Native" is a STRUCTURAL guarantee via format-family schemas, not a prompt request.** One
  **discriminated zod schema per content *shape* (format family)**, not per literal platform:
  - *single-post* → `{ body, imageBrief?: string | null }`
  - *thread* → `{ posts: [{ text, order, role: 'hook'|'body'|'pull_quote'|'close' }], imageBrief? }`

  `safeParse` rejects prose where a thread schema is expected, and the call **re-prompts** (bounded) —
  the guarantee is structural validation, not prompt wording. **Carousel** (Instagram) and **Script**
  (Phase 2 TikTok/Shorts) are **deferred** until those platforms are prioritized; adding one later is
  one new family, not a re-architecture. `imageBrief` is a structured **recommendation** field ("this
  needs an image showing X"), **not** image generation — consistent with the no-image-at-launch rule.

- **L-5 — Post ROLES are an explicit field assigned at the brief stage.** The campaign post-role
  vocabulary: **anchor thesis / founder perspective / customer proof / objection response /
  conversation starter / follow-up (retrospective)**. This gives the campaign a narrative *arc* instead
  of N independently-generated posts sharing an objective, and lets portfolio analytics later say "this
  campaign is four announcements and no proof." **This is a DIFFERENT enum from the thread-internal
  per-tweet role** (`hook | body | pull_quote | close`, L-4) — keep the two vocabularies separate; do
  not conflate a campaign post's role with a tweet's role inside a thread.

- **L-6 — The quality rubric is built ONCE and reused, never three times.** A self-contained addition
  to `lib/ai/` that scores a draft against fixed dimensions — specificity, originality, evidence
  sufficiency, audience relevance, platform-nativeness, brand-voice alignment, opening strength, CTA
  fit, unsupported-claims risk, redundancy — and produces **active critique** ("too weak for a
  campaign: no novel claim; here are three questions that would make it publishable"), not a passive
  score. Track B consumes it in **two** places: the brief critique gate (Stage B) and the
  post-generation consistency pass's platform-nativeness score. Mode 1's later suggestion categories
  reuse the *same* rubric — do not fork it.

- **L-7 — The tiered agency model is binding (agency scales with judgment-under-uncertainty).**
  - *Tier 0 (deterministic code, no LLM):* platform constraints, hashtag counts, **link placement**,
    scheduling time, **role-coverage check**, **thread-length guardrails**.
  - *Tier 1 (single-shot, pre-retrieved/capped context in):* **brief assembly**, native post
    generation, brief critique, cross-set redundancy check.
  - *Tier 2 (bounded critique → regenerate once):* **hook refinement** (single-post openers *and*
    thread `posts[0]`).
  - *Tier 3 (agentic tool loop):* **none in Track B.** Mode 3's signal triage is the *only* Tier-3 in
    the entire product, and it is deferred. Over-applying agency is a quality regression, not an
    upgrade — cost compounds, latency breaks the instant feel, failures get quieter, and the
    human-approval gate caps the marginal value of more upstream autonomy.

- **L-8 — Thread mechanics (X + Threads) are fixed by the strategy doc.** thread-vs-single-tweet is
  decided **at generation time by content volume** (Tier-0 guardrail: **min ~3 tweets** to justify a
  thread at all — below that force single-tweet; **max ~7–8 tweets** — drop-off beyond that), *not*
  dictated top-down by the brief. The **hook tweet must stand alone** (only part visible pre-expansion —
  reuse the L-7 Tier-2 hook loop on `posts[0]`). **Per-tweet `role` tag** enables structural validation
  (`posts[0].role === 'hook'`, last is `close`, ≥1 `pull_quote`). **Link placement is a deterministic
  Tier-0 rule**: outbound/CTA links **never** in tweet 1 (suppresses X reach) — final tweet or explicit
  follow-up reply. **Threads (the Meta app) shares the thread family shape but a different
  `PLATFORM_CONSTRAINTS` entry** (no X link-penalty, more conversational, less numbered-listicle). A
  thread is **the native rendering of one scheduled post in the role sequence — not "the campaign's X
  content"**; a campaign's X presence is still multiple scheduled posts, each of which independently
  resolves to a single tweet or a thread by its own content volume.

- **L-9 — Pinned evidence is a prompt-injection surface and MUST be guarded like `special_instructions`.**
  Brief-pinned evidence citations flow into downstream generation prompts. They are wrapped in `[DATA]`
  tags and passed through `sanitizeDataField` (or an equivalent guard), exactly as
  `special_instructions` is today (`lib/ai/prompts/post-generation.ts:6,87,121-125`). Governed-memory
  evidence text is customer-authored/third-party quote material — treat it as **data, never as
  instructions**. This is the specific security concern the plan doc's Reviewer step (B3) names.

- **L-10 — Contract discipline + constitution rules, inherited by every step.** `origin`/`role` are
  **additive** migrations with a safe, explicit **backfill** (Q2/Q3). Wiring `evidence`/`audience`/
  `brand` memory into brief assembly is a **sanctioned** context extension (ADR 0016 §6.3/§10 deferred
  it here) — but it lands in the **brief** path, and **every existing generation-path test must still
  pass** or the change is wrong; a change that ripples the `CustomerContext` *shape* consumed by the
  existing `postGenerationPrompt` is a STOP unless the ADR ratifies it. Plus: **Zod** on all new Server
  Action / route inputs; **i18n** (en/pt/es simultaneously) for every user-facing brief-review string;
  **atomic** state transitions (conditional `WHERE`) for the brief/campaign checkpoint status; every
  new list query **bounded + explicit `ORDER BY`** matching an index; **date-fns** (`formatISO`, never
  `new Date().toISOString()`); **no `any`**, **no `console.*`**; env only via `lib/config.ts`; DB only
  via `lib/db/` (+ `lib/memory/`); service-role via lazy import, never in a user-facing read path; a new
  business-scoped table (if Q1 chooses one) triggers the **full RLS + erasure-cascade** obligation
  (§D2.5 row + cascade wiring) — a business-scoped table with no cascade entry is a silent GDPR leak.

- **L-11 — The skip-review fast path is DEFERRED (locked out-of-scope).** "Skip review, generate
  directly" for repeat users is **not** built in Track B. Phase A's own risk note: don't build it before
  the edit-distance data (Track C's diff loop) justifies it. Adding it now is an L-1 STOP.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | What Track B ships | Mode 2 upgrade only | bundling Mode 1 / Mode 3 / mining / diff-capture (each depends on foundations still being built — staleness risk, plan §4) |
| D-2 | Cross-platform coherence | **frozen brief** + **N independent per-platform calls** | per-platform re-derivation from raw objective (drift — different evidence, redundant framing); one **joint** call for all platforms (couples failure, complicates per-platform token budgets + parallelism) |
| D-3 | Native output | **format-family discriminated zod schemas** | the current single flat `{content, hashtags}` schema (cannot structurally represent a thread/carousel); prompting-for-nativeness (a request, not a guarantee) |
| D-4 | Quality rubric | **built once in `lib/ai/`, shared** across critique gate + consistency pass (+ later Mode 1) | three separate rubric implementations (drift, triple maintenance + cost) |
| D-5 | Agency ceiling | **Tier-2 max** in Track B (hook refinement) | agentic loops for generation/brief (cost/latency/testability regressions; human gate caps marginal value) |
| D-6 | Format families shipped | **single-post + thread** | carousel + script now (Instagram carousel / TikTok script — those platforms not prioritized at launch; designing their schemas now risks staleness) |
| D-7 | Skip-review fast path | **deferred** | shipping it before edit-distance data exists (Phase A risk note) |

---

## §0.1 — Questions the Architect (B1) must resolve IN the ADR (BINDING)

The strategy docs leave these open "for the Architect session"
(`campaign-modes-architecture-and-build-plan.md` §3 close; plan doc §2 Track B). **B1's ADR must decide
each one explicitly, name the loser, and tier the resulting constraint** (Tier 0/1/2 per L-7, and the
test tier per ADR 0015 §2). The Builder consumes the ADR's answers as binding; it does not re-decide
them. Ground every answer in the real seams (let `ecc:code-explorer` map them — §1).

- **Q1 — Brief persistence, versioning, and state machine.** Is the brief a **new business-scoped
  table** (`campaign_briefs` — then it needs `business_id` FK + RLS in the InitPlan-wrapped form + a
  §D2.5 cascade row, per L-10) or a **JSONB column on `campaigns`**? Is it **versioned** (human edits
  create revisions, feeding Track C's diff loop later) or mutable-in-place with a status? What is its
  **state machine** (e.g. `draft → critiqued → approved → generated`) and how does it gate generation?
  Weigh: a table is heavier but gives per-brief RLS, revision history, and a clean home for the pinned
  evidence set; a JSONB column is lighter but couples brief lifecycle to the campaign row and offers no
  revision trail. State the decision and the loser; if a table, spec it fully (columns, indexes, RLS,
  cascade) to Track A's B0 standard.

- **Q2 — The `role` field: placement, mapping, and backfill.** Is `role` a column on **`posts`** (text
  + `CHECK` — repo convention, no native pg enums, see `PostStatus`/`CampaignStatus`)? How does the
  brief's assigned **role-sequence** map onto each post's `role` at insert time in
  `generatePostsForCampaign`? Confirm the two role vocabularies (campaign post-role, L-5, vs
  thread-internal tweet-role, L-4) stay **separate** — where does the tweet-role live (inside the thread
  format-family JSON, *not* on `posts`)? Backfill: existing `posts` rows → `role` NULL, or a default?
  `PostUpdate` currently excludes tenancy-critical fields (`lib/db/types.ts:293`) — does `role` belong
  in the mutable set or is it write-once at generation?

- **Q3 — `origin` values + backfill + forward-compat.** The strategy doc's set is `manual` /
  `objective_generated` / `signal_generated`. Track B only *produces* `objective_generated`;
  `signal_generated` is Mode 3 (deferred). Do you **ship the full enum now** (forward-compat, one
  migration) or add `signal_generated` when Mode 3 lands? What do **existing** campaigns backfill to —
  `manual` (they predate objective-driven generation as a *tracked* origin) or `objective_generated`
  (they were, in fact, objective-generated)? This backfill choice has analytics consequences — state
  it.

- **Q4 — Format-family schema architecture + the schema-mismatch retry.** Confirm the launch
  **platform → family** mapping: *single-post* ← LinkedIn, Facebook, Threads-as-standalone; *thread* ←
  X (twitter), Threads-as-thread. Is the family chosen **per-platform deterministically** (a Tier-0
  lookup, extending `PLATFORM_CONSTRAINTS`) or by the model? Where do the discriminated schemas live
  (new `lib/ai/prompts/formats/` vs inline in the generation prompt)? Critically: the runner today
  retries only on **429/5xx** (`runner.ts:39-53`) — a `safeParseOrAiError` failure **throws
  `invalid_response`, it does not re-prompt** (`runner.ts:146-155`). L-4's "schema rejects → the call
  retries" is therefore **new machinery** — decide *where* it lives (a bounded re-prompt inside a new
  generation wrapper, not in the generic runner) and its retry ceiling. Name the loser.

- **Q5 — Rubric output contract + critique-gate hard/soft gating.** Fix the rubric's **output shape**
  (per-dimension score + active-critique text + an overall pass/fail?) and its home
  (`lib/ai/rubric.ts`? a new prompt in `lib/ai/prompts/`?). Is the brief critique gate a **HARD** gate
  (a brief below threshold **blocks** generation and returns the critique to the human) or **SOFT** (an
  advisory score the human can override)? What is the threshold, and is it an ADR constant (like the
  memory caps) rather than a scattered magic number? Does the **same** rubric power the post-generation
  platform-nativeness score, or only its nativeness dimension? Name the loser.

- **Q6 — Brief-review UI scope in THIS track.** Does Track B ship the human **brief-review/edit UI**
  (Mode 2 Stage C) and the **per-post review** surface (Stage G), or does it ship the *pipeline +
  schema + Server Actions* and leave the UI to a scoped follow-on session? The plan doc §2 Phase A does
  **not** list UI explicitly, so this is a genuine founder call with real scope weight. **If UI is in
  scope, it is where `impeccable` + `taste-skill` apply** — the brief-review is the screen where "AI
  proposed a strategy I can shape" becomes tangible; it is the differentiator, not a generic form, and
  must be designed to that bar (shadcn v4 / Base UI patterns per CLAUDE.md, Server Component page +
  Client form split, i18n en/pt/es). State the decision; if deferred, name the follow-on and what
  minimal surface (if any) is needed to exercise the pipeline end-to-end this track.

- **Q7 — Orchestration: where the brief stages live + the `generate.ts` rewrite.** Today
  `generatePostsForCampaign` (`lib/campaigns/generate.ts`) runs objective → `buildCustomerContext` →
  per-platform `runPrompt` → batch insert, gated by an **atomic `activateCampaign` guard on
  `status='draft'`** and the `post_generation_sessions` machinery. Mode 2 inserts Stages A–F *ahead of*
  insert. Does the orchestrator gain the brief stages **inline**, or does a **new `lib/campaigns/brief.ts`**
  own Stages A–C (assemble → critique → await-approval) with `generate.ts` consuming a **frozen,
  approved** brief for Stages D–F? How does the campaign now **pause** at "brief awaiting approval" and
  resume on approval — a new campaign/brief status transitioned atomically (L-10)? Preserve the existing
  idempotency guards (`already_generated`, the draft guard). Name the loser.

- **Q8 — Consistency-pass composition + its cost.** The post-generation consistency pass has three
  parts: **role-coverage** (Tier 0, free — did every assigned role get fulfilled), **redundancy/
  contradiction** across the generated set (Tier 1 — one LLM call over the whole set), and a
  **platform-nativeness** score (folded into the rubric, L-6). The strategy doc flags the cross-set
  redundancy call as *"revisit only if the consistency-check step proves to catch drift often enough to
  be a real cost."* Decide: ship **role-coverage + nativeness** now and **defer** the cross-set
  redundancy LLM call (behind a named un-defer trigger), or ship all three. This is a direct cost/
  latency decision — state it and its trigger.

Where a B1 answer and this build-guide disagree, **the ADR wins once written** — but B1 must not
silently contradict a §0 Locked decision; if it needs to, it STOPS and flags for founder adjudication,
exactly as an ADR that contradicts CLAUDE.md would.

---

## §1 — Architect session (B1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **`docs/decisions/0017-mode-2-upgrade.md`
ONLY**. No `.ts`, no `.sql`, no `.tsx` — no code of any kind. Any code attempted here is discarded. The
last action is a single confirmation line, then `/exit`. **§2 does not start until this ADR is
Accepted** — and §2/§3/§4 of *this build-guide* are authored only after that, from the ADR's real
`MODE2-*` constraints.

**ECC in this phase.** The Architect uses read-only intelligence agents to *ground* the ADR in the real
repo before writing a word of it:
- `ecc:code-explorer` — trace the live seams (the `generatePostsForCampaign` per-platform loop, the
  flat `PostGenerationOutputSchema`, `PLATFORM_CONSTRAINTS`, the `[DATA]`/`sanitizeDataField` guard, the
  runner's 429/5xx-only retry, the `lib/memory/` public surface, the campaigns/posts schema) and return
  exact `file:line` citations, so the ADR is grounded rather than remembered.
- `ecc:architecture-decision-records` (skill) — the ADR house structure (context / decision / losers /
  consequences / constraint table), so 0017 matches 0010–0016 in shape.
- `database-reviewer` (agent, advisory/read-only here) — pressure-test the *proposed* schema (the
  `origin`/`role` additions, the brief table-or-column decision, any new table's RLS + index +
  cascade, the backfill) **as a design**, on paper, before it enters the ADR. Writes no code.
- `security-reviewer` (agent, advisory/read-only here) — pressure-test the **brief-pinning →
  generation** data path specifically (L-9): can pinned evidence citations become an injection vector
  the way `special_instructions` is guarded against? Confirm the `[DATA]`/sanitize discipline extends to
  every new place evidence text enters a prompt.
- `ecc:type-design-analyzer` (agent, advisory/read-only here) — the discriminated **format-family**
  schemas and the **frozen-brief** contract are the type-design core of this track; sanity-check them as
  designed invariants before committing them to the ADR.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 24 — Mode 2 Upgrade, ARCHITECT phase. You produce ONE artefact:
docs/decisions/0017-mode-2-upgrade.md (status: Accepted). You write NO code — no .ts, no .sql, no .tsx.
If you catch yourself writing a migration, a zod schema body, or a React component, stop: that is the
Builder's job (B2), and the constitution requires Architect-attempted code to be discarded.

ECC posture for this phase:
- FIRST run ecc:code-explorer over the seams below to produce grounded file:line citations. Do not
  rely on memory for line numbers — cite what the explorer finds.
- Use the ecc:architecture-decision-records skill for the ADR's structure so 0017 matches 0010–0016.
- Consult database-reviewer (read-only, advisory) on your PROPOSED schema: origin/role additions, the
  brief table-vs-column decision + any new table's RLS/index/cascade, and the backfill.
- Consult security-reviewer (read-only, advisory) on the brief-pinning → generation data path (L-9):
  pinned evidence citations must be [DATA]-guarded + sanitized exactly like special_instructions.
- Consult ecc:type-design-analyzer (read-only, advisory) on the discriminated format-family schemas
  and the frozen-brief contract.
All four write NO code; they pressure-test the design on paper.

Read now, before anything else:
- docs/brainstorm/campaign-modes-architecture-and-build-plan.md — §1 "Mode 2 — Objective-driven
  generation (upgraded)" (the A–I pipeline, the brief, format families, the frozen-brief coherence
  mechanism, the X/Threads thread mechanics) and §2 "Phase A" are the PRIMARY source for this ADR.
  §1 Mode 1/Mode 3 are context for what you must NOT build.
- docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md — §3 (the quality
  rubric — reused, not built three times) and §5 (the tiered agency model — what earns Tier 2 and why
  nothing here earns Tier 3).
- docs/brainstorm/session-plan-adrs-0016-0018.md — the dependency graph and Track B's exact scope
  (Session B1/B2/B3). You are B1.
- docs/build-guide/session-24.md §0 (Locked L-1..L-11) and §0.1 (the questions Q1..Q8 you MUST resolve).
- docs/decisions/0016-governed-memory.md — the MEM-* constraints and, critically, §6.3/§10: the
  evidence/audience/brand memory modules are BUILT + Tier-2 tested but UNWIRED, with THIS ADR named as
  their consumer. Read lib/memory/index.ts (the public surface: retrieveEvidenceMemory /
  retrieveAudienceMemory / retrieveBrandMemory / retrievePerformancePatterns / retrieveVoice;
  signature retrieveRelevant(client, businessId, queryContext, limit?)).
- CLAUDE.md — the AI-layer/DB-access/RLS/erasure-cascade/three-client/atomic-transition/Zod/i18n rules,
  and the shadcn v4 / Base UI + onboarding-step-page patterns (relevant if Q6 puts UI in scope).
- The real seams you are upgrading (let ecc:code-explorer map these, then cite its findings):
  lib/campaigns/generate.ts (the 12-step objective→per-platform→insert orchestrator, the atomic
  activateCampaign draft-guard, the post_generation_sessions machinery);
  lib/ai/prompts/post-generation.ts (the FLAT PostGenerationOutputSchema {content,hashtags,scheduledAt,
  rationale}, PLATFORM_CONSTRAINTS, sanitizeDataField, the [DATA] guard, twitter's prose "thread up to
  5" note); lib/ai/prompts/types.ts (the Prompt<TInput,TOutput> interface); lib/ai/runner.ts (the
  429/5xx-ONLY callWithRetry; safeParseOrAiError throws invalid_response and does NOT re-prompt);
  lib/ai/context.ts (CustomerContext); lib/db/types.ts (CampaignRow/PostRow — NO origin, NO role;
  PostStatus/CampaignStatus; the *Update tenancy exclusions); supabase/migrations/ (the existing
  additive-migration + RLS + cascade pattern — copy it); docs/decisions/0010-legal-surface.md Amd 2
  §D2.5 (the erasure-cascade table, if Q1 adds a brief table).

Do NOT write the ADR yet. First OUTPUT your answers to the eight §0.1 questions (Q1 brief persistence/
versioning/state-machine, Q2 role placement+mapping+backfill, Q3 origin values+backfill+forward-compat,
Q4 format-family architecture + the schema-mismatch retry home, Q5 rubric contract + hard/soft gate,
Q6 brief-review UI in-scope-or-deferred, Q7 orchestration home + generate.ts rewrite, Q8
consistency-pass composition + cost), EACH with its named loser and its tier (L-7 agency tier + ADR
0015 test tier), AND a one-line note on any place a §0 Locked decision constrains the answer. Then stop
for acknowledgement. Do not begin the ADR body until the eight answers are acknowledged.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 24. Write docs/decisions/0017-mode-2-upgrade.md (Accepted). Ground every claim in
the real repo (cite file:line from ecc:code-explorer's map). Run your proposed schema past
database-reviewer, the brief-pinning path past security-reviewer, and the format-family + frozen-brief
types past ecc:type-design-analyzer (all read-only) and fold their objections into the ADR before you
finalise. The ADR MUST contain, at minimum:

1. Context + decision summary: what generatePostsForCampaign does TODAY (objective →
   buildCustomerContext → per-platform runPrompt on ONE flat schema → batch insert, no brief, no roles,
   no format families, no rubric, no hook loop, no consistency pass) — cite it — why one-shot
   "objective → finished posts" is the problem (indistinguishable from a competitor's magic button;
   no reviewable strategy; nativeness only prompted-for, not guaranteed), and the brief-first +
   format-family + frozen-brief design as the fix. Name the losers per §0 D-1..D-7.

2. The BRIEF (Q1): its schema (narrative, proof plan, the pinned evidence-citation set, the post-role
   sequence per L-5), its persistence (table vs JSONB — decided, loser named; if a table, full columns
   + business_id FK + InitPlan-form RLS + retrieval index + the ADR 0010 Amd 2 §D2.5 cascade row), its
   versioning, and its STATE MACHINE with the atomic transition that gates generation (L-10).

3. origin + role schema (Q2, Q3): the additive migration for campaigns.origin and posts.role
   (text + CHECK, repo convention), the exact enum members, the backfill for existing rows, and the
   forward-compat decision for signal_generated. State whether role is write-once or mutable
   (PostUpdate exclusion set). Keep the campaign post-role (L-5) and the thread tweet-role (L-4)
   vocabularies explicitly separate and say where each lives.

4. Format-family output schemas (L-4, Q4): the discriminated zod schemas for single-post
   { body, imageBrief? } and thread { posts:[{text,order,role}], imageBrief? } — carousel/script named
   as DEFERRED (D-6). The deterministic platform → family mapping (extend PLATFORM_CONSTRAINTS). The
   schema-mismatch RE-PROMPT: where it lives (NOT the generic runner — that retries only 429/5xx and
   does not re-prompt on parse failure; cite runner.ts), its bounded ceiling, and how it differs from
   the existing retry. imageBrief is a recommendation field, not image generation — state it.

5. The frozen-brief generation (L-3, Q7): the brief is pinned once and each of N per-platform calls
   receives the SAME frozen object; N independent calls (fail/retry independently), not one joint call
   (loser named). Show how evidence/audience/brand memory (ADR 0016 §10, UNWIRED today) is retrieved
   through lib/memory/ INTO the brief assembly — this ADR is their designated consumer. State the L-10
   gate: the existing postGenerationPrompt path's CustomerContext shape must not silently change; any
   ratified extension is called out as a founder-approved contract change.

6. The quality rubric (L-6, Q5): its dimensions, its OUTPUT contract (per-dimension score + active
   critique + overall pass/fail), its home, and the brief critique gate's HARD-vs-SOFT gating +
   threshold (an ADR constant). State that the SAME rubric powers the post-generation nativeness score.
   This is Tier 1; the gate's block/allow is Tier 0 on the score.

7. The hook-refinement Tier-2 loop (L-7): generate → score opener against the rubric → regenerate ONCE
   if below threshold, applied to single-post openers AND thread posts[0] (L-8 hook-standalone). Bounded
   (one regeneration). No Tier 3 anywhere in this track — say so.

8. The deterministic consistency pass (L-7, L-8, Q8): role-coverage check (Tier 0), link-placement
   rule (Tier 0 — CTA links never in tweet 1; final tweet or follow-up reply), platform-nativeness
   score (rubric), and the cross-set redundancy/contradiction check (Tier 1) — decided as shipped or
   deferred behind a named un-defer trigger (Q8), with the cost rationale.

9. Prompt-injection guard (L-9): every new place brief-pinned evidence enters a generation prompt is
   [DATA]-wrapped + sanitizeDataField'd, exactly as special_instructions is (cite the existing guard).
   Fold in security-reviewer's findings.

10. Brief-review UI (Q6): in-scope or deferred, decided. If in scope: the Server Component page + Client
    form split, the Server Actions (Zod-validated), i18n en/pt/es, shadcn v4 / Base UI patterns, and a
    note that impeccable + taste-skill govern its visual bar (it is the differentiator surface). If
    deferred: name the follow-on and the minimal surface needed to exercise the pipeline this track.

11. Orchestration (Q7): where Stages A–F live (brief.ts vs inline in generate.ts), how the campaign
    pauses at "brief awaiting approval" and resumes atomically, and how the existing idempotency guards
    (already_generated, the draft guard) are preserved. Cite generate.ts.

12. Test plan mapped to the three tiers (ADR 0015 §2): Tier-1 DB-behaviour for RLS on any new brief
    table + the origin/role migration behaviour (supabase/__tests__, live Postgres); Tier-2 app-layer
    for the format-family schema validation (reject prose where thread expected), the frozen-brief
    coherence (same object to every platform call), the rubric/critique gate, the hook loop, the
    role-coverage + link-placement Tier-0 rules, and the fixture-based generation equivalence for the
    UNCHANGED existing path (L-10); any Tier-3 diff-verified property enumerated as such. Follow the
    SHARED-FUNCTION CALLERS rule for anything touching buildCustomerContext / generatePostsForCampaign.

13. A constraint table: every named constraint (MODE2-*), its agency tier (L-7), its test tier (ADR
    0015), and the test that will prove it — this is the Reviewer's checklist. Cover at least:
    MODE2-BRIEF-BEFORE-COPY, MODE2-BRIEF-FROZEN, MODE2-FORMAT-FAMILY-STRUCTURAL, MODE2-NATIVE-RETRY,
    MODE2-ROLE-COVERAGE, MODE2-LINK-PLACEMENT, MODE2-THREAD-GUARDRAILS, MODE2-HOOK-STANDALONE,
    MODE2-RUBRIC-SHARED, MODE2-CRITIQUE-GATE, MODE2-EVIDENCE-DATA-GUARDED, MODE2-MEMORY-WIRED,
    MODE2-CONTEXT-EQUIVALENT (existing path), MODE2-ORIGIN-ROLE-BACKFILL, and (if Q1 = table)
    MODE2-BRIEF-RLS-ISOLATED + MODE2-BRIEF-CASCADE-COMPLETE.

14. Explicit "deferred to later tracks/phases" section: Mode 1 Studio, Mode 3 (mining/insight cards/
    opportunity feed), Track C diff-learning, carousel/script families, image generation, the
    skip-review fast path, and the numbered-vs-unnumbered thread preference — so the boundary is on the
    record and a future session doesn't build them here by mistake.

Do NOT write code. End with one line: "ADR 0017 written and accepted — <n> MODE2-* constraints, brief
as <table|column>, format families <single-post+thread>, brief-review UI <in-scope|deferred>, cross-set
redundancy <shipped|deferred>." Then /exit.
```

**Gate:** do not proceed to §2 until `docs/decisions/0017-mode-2-upgrade.md` exists, is Accepted, and
its eight §0.1 answers are on the record. If founder review of the ADR surfaces defects, record them as
a `§0.1-style corrections` block appended here before the Builder starts — exactly as Sessions 22/23
did. **Then author §2/§3/§4 below from the accepted ADR's real `MODE2-*` constraints.**

---

## §2 — Builder session (B2)  ·  (paste into Claude Code · Sonnet)

Runs **only after ADR 0017 is accepted** (it is — status Accepted, 2026-07-22). Eight steps,
dependency-ordered, each a self-contained `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop`
cycle. **Paste the primer (§2a) first, wait for acknowledgement, then paste B2.0…B2.7 one at a time**,
letting each go green + commit before the next.

Hard rules inherited by every step: §0 L-1..L-11 (constitution + scope) + the L-10
behaviour-equivalence gate (`MODE2-CONTEXT-EQUIVALENT`). **No Mode 1, no Mode 3, no diff-learning
worker, no carousel/script family, no image generation, no skip-review fast path, no high-touch
brief-review UI / per-post Studio diff** (that is Session 24-UI, ADR §10). If a step appears to need
one, **STOP and report** — it contradicts ADR 0017's scope (§9, §15) and §0 L-1.

**ADR 0017 decisions the Builder transcribes (now concrete — do NOT re-derive, "improve", or
re-litigate; the ADR resolved every one of these against a named loser):**
- **New table `campaign_briefs`** (ADR §2.1): 1:1 with campaigns via **`UNIQUE(campaign_id)`** (a bare
  FK does *not* enforce 1:1 — `[db-MAJOR-1]`); **`business_id` cascades from `businesses`**, never from
  `campaign_id`; `content jsonb` typed as `CampaignBriefContent` (§2.2), **never**
  `Record<string,unknown>`; the partial retrieval index `(business_id, status) WHERE deleted_at IS NULL`;
  **no separate `(campaign_id)` index** (the UNIQUE is the lookup index).
- **RLS is the InitPlan form copied verbatim** from `20260719010000_governed_memory.sql:60-77`
  (`business_id = ANY (SELECT unnest(public.get_user_business_ids()))`) — SELECT/INSERT/UPDATE-with-both-
  USING-and-WITH-CHECK/DELETE. Getting this wrong is a review blocker.
- **`campaign_briefs` gets one ADR 0010 Amd 2 §D2.5 cascade row** in the same migration (cascades from
  `businesses` ON DELETE — cascade *is* erasure). A business-scoped table with no §D2.5 row is a STOP.
- **`campaigns.origin`** (ADR §3.1): `text CHECK IN ('manual','objective_generated','signal_generated')`,
  **full enum now**; backfill existing → `objective_generated`; then **DROP the default** and make
  `origin` **required on `CampaignInsert`** so Mode 1/3 rows can't silently mislabel (`[db-MAJOR-3]`).
- **`posts.role`** (ADR §3.2): `text CHECK IN ('anchor_thesis','founder_perspective','customer_proof',
  'objection_response','conversation_starter','follow_up')` **NULLABLE**; backfill existing → **NULL**;
  **write-once**, enforced at BOTH layers — added to `PostUpdate`'s `Omit` set **and** a `BEFORE UPDATE`
  trigger rejecting `NEW.role IS DISTINCT FROM OLD.role AND OLD.role IS NOT NULL` (`[db-MAJOR-2]`; the
  service-role orchestrator writes outside `PostUpdate` and bypasses RLS, so app-layer exclusion alone
  is insufficient). The **thread tweet-role** (`hook|body|pull_quote|close`) lives **inside the thread
  format-family JSON**, never on `posts.role` — the two vocabularies never touch.
- **`campaigns.status` gains `awaiting_brief`** (ADR §11); CHECK changes use `ADD CONSTRAINT … NOT VALID`
  then `VALIDATE CONSTRAINT` (low-lock, `[db-MINOR-1]`), never a naive in-place drop/add.
- **Format families** (ADR §4): `z.discriminatedUnion('format', …)` `single` + `thread` in
  **`lib/ai/prompts/formats/`**; **no `posts[].order`** field (derive from array index, `[type-2]`);
  `imageBrief` repeated per branch (`[type-4]`); structural bounds (`thread.posts` `.min(3).max(8)`) in
  the schema, **policy** (`posts[0]=hook`, last=`close`, ≥1 `pull_quote`) in a **separate Tier-0
  validator** returning a distinguishable `AiError` code (`[type-3]`).
- **Re-prompt lives in a NEW wrapper `lib/ai/generate-native.ts`, NOT the runner** (ADR §4.4): a
  **per-family Prompt factory** `createNativeGenerationPrompt(family)` returns a concretely-typed
  `Prompt`, the wrapper selects it via the Tier-0 platform→family map and calls the **unchanged**
  `runPrompt`; **ceiling = 1 re-prompt (2 attempts total)**; no third `prompt.id` branch in `runner.ts`,
  no `z.ZodType<unknown>`+cast.
- **`FrozenBrief`** (ADR §5.2): a **branded, deeply-readonly** type from exactly one factory, PLUS the
  DB `frozen_at IS NULL` trigger — freezing is enforced at both layers because a TS `readonly` alone is
  defeated by a `JSON.parse(JSON.stringify())` round-trip or a cast.
- **Memory wired into brief assembly ONLY** (ADR §5.1): `retrieveEvidenceMemory`/`retrieveAudienceMemory`/
  `retrieveBrandMemory` (`lib/memory/index.ts`) feed the **brief**; the existing `postGenerationPrompt`
  `CustomerContext` shape is **NOT touched** — per-platform generation reads the *frozen brief*, not
  fresh memory. Changing `CustomerContext`'s shape is an L-10 STOP.
- **Rubric** (ADR §6): one `Prompt` in **`lib/ai/prompts/rubric.ts`**, ten dimensions, output
  `{ dimensions:{<d>:{score,note}}, overall, critique[], verdict }`; **HARD** gate at
  `BRIEF_QUALITY_THRESHOLD` (an exported ADR constant, sibling to `lib/memory/constants.ts`); the SAME
  rubric powers the §8 nativeness score — **no forked scorer**.
- **Evidence guard `wrapEvidenceForPrompt()`** (ADR §9): a SINGLE shared choke point applied **at render
  time, never authorship time**; citation-by-id (re-fetch + `status='active'` check at render);
  `[DATA]`-wrap + **hard length cap (truncate)** + neutralize `[/DATA]` closers, triple-backtick fences,
  and leading `{`/`[`. Every prompt-builder that renders brief evidence — assembly, the N native calls,
  AND the rubric call — applies it independently (ADR §12 caller table).
- **Consistency pass** (ADR §8): ship role-coverage (Tier 0, positional cross-check vs the frozen
  brief's `roleSequence`, `[type-6]`) + link-placement (Tier 0) + nativeness (rubric); **DEFER** the
  cross-set redundancy LLM call behind `MODE2-REDUNDANCY-UNDEFER`. Building it now is a STOP.
- **Orchestration** (ADR §11): **new `lib/campaigns/brief.ts`** owns Stages A–C; `generate.ts` consumes
  the frozen approved brief for D–F; the existing final guard flips `.eq('status','draft')` →
  `.eq('status','awaiting_brief')` (`generate.ts:210`); the `already_generated` guard + session
  machinery are preserved. The migration must **assert zero live `draft` campaigns** and handle any it
  finds (`MODE2-ACTIVATE-GUARD-MIGRATED`, `[db-BLOCKER-1]`).

**ECC specialists by step (invoked proactively, at the point the mistake is made — not saved for
review):**

| Step | Spine | Specialist pulled in | Why here |
|---|---|---|---|
| B2.0 | plan → tdd → verify | `database-reviewer` + `supabase:supabase-postgres-best-practices` | RLS/cascade/CHECK-NOT-VALID/triggers/stuck-row at authoring time |
| B2.1 | plan → tdd → verify | `typescript-reviewer` | typed `CampaignBriefContent`, atomic transition helpers, no `any` |
| B2.2 | plan → tdd → verify | `ecc:type-design-analyzer` | the rubric output contract as a designed invariant (shared by two consumers) |
| B2.3 | plan → tdd → verify | `security-reviewer` | the evidence guard is the L-9 injection choke point — render-time, capped, single-source |
| B2.4 | plan → tdd → verify | `ecc:type-design-analyzer` + `ecc:silent-failure-hunter` | the discriminated union + the per-family factory + a re-prompt that must fire *exactly once* |
| B2.5 | plan → tdd → verify | `security-reviewer` + `ecc:cost-aware-llm-pipeline` | Stage A–C: memory-wired assembly, the HARD gate, and the evidence render path; token economics of assembly + rubric |
| B2.6 | plan → tdd → verify | `typescript-reviewer` + `ecc:cost-aware-llm-pipeline` | the `generate.ts` rewire is the L-10 equivalence gate + the SHARED-FUNCTION CALLERS surface; hook loop is a per-call cost |
| B2.7 | plan → tdd → verify | `ecc:react-review` | minimal Server-Action-backed surface; **NOT** `impeccable`/`taste-skill` — those are Session 24-UI (ADR §10) |

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 24 — Mode 2 Upgrade, BUILDER phase. You transcribe ADR 0017 into a schema migration, the brief
data layer, the rubric, the format-family + native-generation machinery, the brief pipeline (Stages
A–C), the generate.ts rewire (Stages D–F), and a minimal brief-review surface — across eight steps
(B2.0…B2.7). You are not the designer: ADR 0017 is authoritative, as scoped by session-24.md §0/§0.1.

Read now, before anything else:
- docs/decisions/0017-mode-2-upgrade.md — the WHOLE ADR. Its §13 MODE2-* constraint table is half your
  acceptance checklist; §12 is the test plan; §14 lists the advisory findings already folded in (do NOT
  re-open them).
- docs/build-guide/session-24.md §0 (Locked L-1..L-11) + §0.1 (the eight resolved questions) + §2 (this
  section — the concrete decisions list above, the step list, the specialist table) — BINDING scope.
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three tiers. RLS/trigger/CHECK/cascade
  tests are Tier-1 (supabase/__tests__, live Postgres, db-tests.yml); schema-validation / rubric / hook
  / pipeline tests are Tier-2 (lib/**, app/** *.test.ts, app-tests.yml). "Covered" = executed green in
  CI, never "authored". SHARED-FUNCTION CALLERS: enumerate every caller of a shared function and state
  the test per caller before marking its constraint tested.
- CLAUDE.md — RLS/erasure-cascade rules, the three Supabase client roles + lazy service-role import, the
  atomic-conditional-UPDATE pattern, bounded-query + explicit-ORDER-BY, Zod on all inputs, i18n en/pt/es,
  date-fns, no any / no console.*, the shadcn v4 / Base UI + Server-Component-page/Client-form patterns.
- The real seams, at HEAD: lib/campaigns/generate.ts (the 12-step orchestrator, the activateCampaign
  draft-guard at :210, the already_generated guard at :63-71); lib/ai/prompts/post-generation.ts (the
  flat PostGenerationOutputSchema, PLATFORM_CONSTRAINTS, sanitizeDataField + the [DATA] guard at
  :6,87,121-125); lib/ai/prompts/types.ts (Prompt<TInput,TOutput> — one outputSchema per Prompt);
  lib/ai/runner.ts (429/5xx-only callWithRetry :39-53; safeParseOrAiError throws invalid_response, does
  NOT re-prompt :146-155); lib/ai/context.ts (CustomerContext — DO NOT change its shape);
  lib/memory/index.ts (retrieveEvidenceMemory/retrieveAudienceMemory/retrieveBrandMemory, unwired
  today); lib/db/types.ts (CampaignRow/PostRow — no origin, no role; PostStatus/CampaignStatus; the
  *Update Omit sets at :293); supabase/migrations/20260719010000_governed_memory.sql (copy its RLS +
  cascade + index + trigger shape); docs/decisions/0010-legal-surface.md Amd 2 §D2.5 (the cascade table).

ECC posture: run every step through /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop, AND invoke
the step's named specialist (session-24.md §2 table) at authoring time. Follow CLAUDE.md's tsc/vitest
invocation notes exactly (tsc --noEmit --skipLibCheck; scoped vitest run; npm run test:db for Tier-1).

Do NOT write code yet. Confirm these grounding facts (a wrong one is a STOP):
(1) generate.ts's final atomic guard is `.eq('status','draft')` at :210, and the already_generated guard
    is at :63-71; cite them. These are what B2.6 migrates + preserves.
(2) The LIVE RLS form to copy is `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`
    (governed_memory.sql:60-77), NOT the bare pre-017 form. Cite it. Also cite the §D2.5 cascade rows to
    append (0010-legal-surface.md).
(3) runner.ts retries only 429/5xx and does NOT re-prompt on parse failure (:39-53, :146-155) — so the
    format re-prompt is NEW machinery in lib/ai/generate-native.ts, and the runner is untouched (ADR §4.4).
(4) CustomerContext's current shape (lib/ai/context.ts) and that ADR §5.1 forbids changing it — memory
    wires into the BRIEF path only. Prove the interface is unchanged after B2.5/B2.6.
(5) lib/memory/index.ts exports retrieveEvidenceMemory/retrieveAudienceMemory/retrieveBrandMemory with
    signature retrieveRelevant(client, businessId, queryContext, limit?), unwired today (ADR 0016 §10).
(6) posts is written by the service-role orchestrator OUTSIDE the PostUpdate type — so role write-once
    needs the DB trigger, not just the Omit (ADR §3.2 / [db-MAJOR-2]).
Output the six findings + "Ready for B2.0." Then stop.
```

### §2b — Builder steps

#### B2.0 — Migration: `campaign_briefs` + `origin`/`role`/`awaiting_brief` + RLS + cascade + triggers  ·  ADR §2–§3, §11  ·  MODE2-BRIEF-RLS-ISOLATED, MODE2-BRIEF-CASCADE-COMPLETE, MODE2-BRIEF-FROZEN-GUARD, MODE2-ROLE-WRITE-ONCE, MODE2-ORIGIN-ROLE-BACKFILL, MODE2-BRIEF-STATE-ATOMIC (DB), MODE2-ACTIVATE-GUARD-MIGRATED

```
BUILDER — Session 24 · B2.0. Migration + Tier-1 DB tests + the minimal lib/db/types.ts column additions
ONLY. No lib/campaigns/brief.ts, no rubric, no generate.ts rewire yet. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke database-reviewer AND the
supabase:supabase-postgres-best-practices skill WHILE authoring — RLS, cascade, CHECK-NOT-VALID,
trigger, and stuck-row mistakes get caught here, not in review.

BUILD:
- supabase/migrations/<ts>_mode2_brief_and_roles.sql:
  * campaign_briefs table EXACTLY per ADR §2.1: id uuid PK; business_id uuid NOT NULL REFERENCES
    public.businesses(id) ON DELETE CASCADE; campaign_id uuid NOT NULL REFERENCES public.campaigns(id)
    ON DELETE CASCADE UNIQUE; content jsonb NOT NULL; status text NOT NULL CHECK (status IN
    ('draft','critiqued','approved','generated')); version int NOT NULL DEFAULT 1 CHECK (version >= 1);
    overall_score numeric CHECK (overall_score >= 0 AND overall_score <= 100); critique jsonb;
    frozen_at timestamptz; deleted_at timestamptz; created_at/updated_at timestamptz NOT NULL DEFAULT now().
    Partial index (business_id, status) WHERE deleted_at IS NULL. NO separate (campaign_id) index (the
    UNIQUE is it). set_updated_at() BEFORE UPDATE trigger.
  * RLS: ENABLE, then the FOUR policies TO authenticated in the InitPlan form
    `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` (SELECT / INSERT WITH CHECK /
    UPDATE USING+WITH CHECK / DELETE), copied from governed_memory.sql:60-77.
  * frozen_at guard trigger: BEFORE UPDATE — reject a content change when OLD.frozen_at IS NOT NULL
    (ADR §2.4/§5.2). Human edits only in draft/critiqued.
  * campaigns.origin: ADD COLUMN text DEFAULT 'objective_generated' (metadata backfill), then DROP the
    default, then ADD CONSTRAINT ... CHECK (origin IN (...)) NOT VALID; VALIDATE CONSTRAINT. Existing rows
    → objective_generated (ADR §3.1 / [db-MAJOR-3]).
  * posts.role: ADD COLUMN text NULL; ADD CONSTRAINT CHECK (role IN (six values)) NOT VALID; VALIDATE.
    Existing rows stay NULL. role write-once BEFORE UPDATE trigger: reject NEW.role IS DISTINCT FROM
    OLD.role AND OLD.role IS NOT NULL (ADR §3.2 / [db-MAJOR-2]).
  * campaigns.status: extend the CHECK to add 'awaiting_brief' via NOT VALID/VALIDATE (ADR §11 / [db-MINOR-1]).
  * MODE2-ACTIVATE-GUARD-MIGRATED ([db-BLOCKER-1]): assert zero live campaigns in 'draft' (pre-launch,
    expected 0); if any exist, handle per ADR §11 (backfill a draft brief / route through the new path).
    Do NOT assume zero — prove it in the migration.
  * §D2.5: add ONE cascade row for campaign_briefs to ADR 0010 (yes / CASCADE from businesses / yes /
    "none — cascade = erasure"). A table with no §D2.5 row is a STOP.
- lib/db/types.ts: CampaignRow.origin (union of the three), PostRow.role (union|null), CampaignStatus
  += 'awaiting_brief'; CampaignInsert.origin REQUIRED (no ?); PostUpdate Omit set gains 'role'
  (:293). CampaignBriefRow + CampaignBriefContent types land in B2.1 unless needed to type the tests here.
- supabase/__tests__/mode2-brief-rls.test.ts + mode2-role-origin.test.ts — Tier-1, live Postgres:
  cross-tenant SELECT/INSERT/UPDATE/DELETE on campaign_briefs denied (USING + WITH CHECK proven, not
  assumed); business delete purges briefs; frozen_at trigger rejects a content UPDATE once frozen; role
  write-once trigger rejects a role change when OLD.role IS NOT NULL; origin/role/awaiting_brief CHECK +
  backfill behaviour; business_id = campaigns.business_id consistency on insert.

VERIFY: apply the migration to the live/local DB; npm run test:db over the new suites. RLS/trigger
proofs must EXECUTE against real Postgres (a pg_policies read or a mocked client is NOT coverage, ADR
0015 §2). Feed database-reviewer's findings back in; fix before commit.
On commit: "B2.0 complete — campaign_briefs + origin/role/awaiting_brief migration, RLS + cascade +
frozen/role-write-once triggers + stuck-row assert (MODE2-BRIEF-RLS-ISOLATED, -CASCADE-COMPLETE,
-FROZEN-GUARD, -ROLE-WRITE-ONCE, -ORIGIN-ROLE-BACKFILL, -ACTIVATE-GUARD-MIGRATED); N Tier-1 tests green
on live Postgres; database-reviewer clean." Then stop.
```

#### B2.1 — `lib/db/campaign-briefs.ts`: typed brief data layer + atomic state machine  ·  ADR §2.2, §2.4  ·  MODE2-BRIEF-STATE-ATOMIC (app), MODE2-BRIEF-BEFORE-COPY

```
BUILDER — Session 24 · B2.1. Data-access + state-machine helpers only. No AI calls, no orchestration.
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop; invoke typescript-reviewer on the new types
+ query functions (typed rows, no `any`, bounded + explicit ORDER BY, atomic transitions).

BUILD:
- lib/db/types.ts (or a colocated types file per repo convention): CampaignBriefRow, CampaignBriefInsert,
  CampaignBriefUpdate (Omit the immutable set), and the CampaignBriefContent shape from ADR §2.2:
  narrative: string; proofPlan: string; pinnedEvidence: { evidenceMemoryId: string; note?: string }[];
  roleSequence: { order: number; role: CampaignPostRole; platform: Platform; angle: string }[].
  CampaignPostRole = union of the six §3.2 values. content is TYPED as CampaignBriefContent, never
  Record<string,unknown> ([db-NIT-1]).
- lib/db/campaign-briefs.ts: typed functions — getBriefByCampaign(client, campaignId) (uses the UNIQUE
  index); createBrief(client, ...) setting business_id FROM the campaign row (not caller-supplied,
  [db-MAJOR-1] consistency); the FOUR atomic transition helpers, each a conditional UPDATE guarded on
  the expected current status (mirror activateCampaign): draft→critiqued, critiqued→approved (sets
  frozen_at = formatISO(new Date())), critiqued→draft (human revise, version++, frozen_at stays NULL),
  approved→generated. NO business logic here — the HARD gate (score check) lives in B2.5; these helpers
  just perform the guarded transition and report success/failure.
- lib/db/campaign-briefs.test.ts — Tier-2: each transition succeeds only from its expected status and is
  a no-op (returns false / null) from any other (atomicity proven at the query-shape level); version
  bumps on revise; frozen_at is set on approve; business_id is taken from the campaign, not the arg;
  ORDER BY / bounded where applicable.

VERIFY: npm run test:app over the new db suite; tsc clean.
On commit: "B2.1 complete — lib/db/campaign-briefs typed data layer + four atomic transition helpers
(MODE2-BRIEF-STATE-ATOMIC app half); CampaignBriefContent typed, business_id sourced from campaign."
Then stop.
```

#### B2.2 — The quality rubric  ·  ADR §6  ·  MODE2-RUBRIC-SHARED, MODE2-CRITIQUE-GATE (schema half)

```
BUILDER — Session 24 · B2.2. The shared rubric prompt. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke ecc:type-design-analyzer on the output contract — it is consumed by TWO
callers (the brief critique gate AND the §8 nativeness score), so its shape is a designed invariant, not
a local convenience.

BUILD:
- lib/ai/prompts/rubric.ts: a Prompt<RubricInput, RubricOutput> (id 'rubric', an appropriate modelKey —
  cheap tier is fine per L-7 Tier-1). RubricOutput zod schema EXACTLY per ADR §6.2:
  { dimensions: Record<the ten dimension keys, { score: number 0..100, note: string }>, overall: number
  0..100, critique: string[] (ACTIVE — questions/actions that would make it publishable, L-6),
  verdict: 'pass' | 'fail' }. All TEN dimensions present (specificity, originality, evidenceSufficiency,
  audienceRelevance, platformNativeness, brandVoiceAlignment, openingStrength, ctaFit,
  unsupportedClaimsRisk, redundancy). Export BRIEF_QUALITY_THRESHOLD as a named constant (sibling to
  lib/memory/constants.ts) — NOT a scattered magic number.
- This step ships the rubric PROMPT + schema + threshold constant only. The HARD gate that CONSUMES the
  threshold to block critiqued→approved is wired in B2.5; here, only prove the schema + threshold exist
  and parse.
- lib/ai/prompts/rubric.test.ts — Tier-2: RubricOutput accepts a well-formed payload and rejects a
  passive-score-only one (critique[] required, verdict required, all ten dimensions required); the
  threshold constant has the intended value and is imported (not re-declared) by any later consumer.

VERIFY: npm run test:app; tsc clean.
On commit: "B2.2 complete — shared quality rubric (lib/ai/prompts/rubric.ts), ten-dimension active-
critique output contract + BRIEF_QUALITY_THRESHOLD constant (MODE2-RUBRIC-SHARED); single instance,
type-design-analyzer confirmed." Then stop.
```

#### B2.3 — Evidence guard choke point `wrapEvidenceForPrompt()`  ·  ADR §9  ·  MODE2-EVIDENCE-DATA-GUARDED

```
BUILDER — Session 24 · B2.3. The L-9 injection choke point — a single shared helper every evidence-
rendering prompt calls. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
security-reviewer over it: this is the ONE place brief-pinned (customer/third-party-authored) evidence
becomes prompt text, and the whole point is that it is guarded IDENTICALLY at every call site.

BUILD:
- lib/ai/wrap-evidence.ts (or colocated with the prompts): wrapEvidenceForPrompt(client, evidenceIds) —
  per ADR §9:
  * CITATION-BY-ID: takes evidence ids, RE-FETCHES the rows (via lib/db, service-role-appropriate),
    and includes ONLY rows with status = 'active' (closes the freeze→generate staleness gap, [db-NIT-2]).
  * RENDER-TIME guard, never authorship-time ([sec-HIGH-2]): the function IS the render step; there is no
    path that skips guarding because a field was AI-generated or previously sanitized.
  * [DATA]-wrap + sanitizeDataField (neutralize [/DATA] closers) + hard LENGTH CAP (truncate, not warn,
    [sec-HIGH-1]) + neutralize triple-backtick fences and leading {/[ that could induce output-schema
    confusion in a safeParse world.
- lib/ai/wrap-evidence.test.ts — Tier-2: inject evidence containing [/DATA], a ```-fence, a leading {,
  and over-cap length → assert the closer is neutralized, the fence/brace defused, the output truncated
  to the cap, and a retired (status != 'active') id is dropped. This is the test ADR §12's caller table
  points every render caller at.

VERIFY: npm run test:app; tsc clean. Address every security-reviewer finding before commit.
On commit: "B2.3 complete — wrapEvidenceForPrompt render-time evidence guard: citation-by-id + active-
status + [DATA]-wrap + length cap + fence/brace neutralize (MODE2-EVIDENCE-DATA-GUARDED single choke
point); security-reviewer clean." Then stop.
```

#### B2.4 — Format families + policy validator + native-generation wrapper (re-prompt)  ·  ADR §4  ·  MODE2-FORMAT-FAMILY-STRUCTURAL, MODE2-THREAD-GUARDRAILS, MODE2-NATIVE-RETRY

```
BUILDER — Session 24 · B2.4. The structural-nativeness guarantee. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke ecc:type-design-analyzer on the discriminated union + the per-family
Prompt factory, AND ecc:silent-failure-hunter on the re-prompt (a retry that fires zero times, or twice,
or swallows the policy-fail code, is exactly the quiet failure a naive test passes).

BUILD:
- lib/ai/prompts/formats/ — the z.discriminatedUnion('format', [...]) with two branches (ADR §4.1):
  single { format:'single', body: z.string().min(1), imageBrief: z.string().nullable() } and
  thread { format:'thread', posts: z.array({ text: z.string().min(1), role: z.enum(['hook','body',
  'pull_quote','close']) }).min(3).max(8), imageBrief: z.string().nullable() }. NO posts[].order field
  (derive from index, [type-2]); imageBrief declared in BOTH branches ([type-4]).
- The Tier-0 POLICY validator (separate from the schema, [type-3]): after safeParse succeeds on a
  thread, assert posts[0].role==='hook', last==='close', ≥1 'pull_quote' — returning a DISTINGUISHABLE
  AiError code from a shape/parse failure, so the re-prompt can send a targeted correction.
- The Tier-0 platform→family map (ADR §4.3), extending PLATFORM_CONSTRAINTS: linkedin/facebook→single;
  twitter/threads→single-or-thread by content-volume guardrail (<3 tweets' worth→single, 3..8→thread);
  threads gets its OWN PLATFORM_CONSTRAINTS entry (no X link-penalty, more conversational).
- createNativeGenerationPrompt(family) — the per-family Prompt FACTORY ([type-1]) returning a
  concretely-typed Prompt<NativeGenInput, SinglePostOutput | ThreadOutput> (each branch concretely
  typed, NOT z.ZodType<unknown>+cast). It renders pinned evidence via wrapEvidenceForPrompt (B2.3).
- lib/ai/generate-native.ts — the WRAPPER (NOT the runner, ADR §4.4): does the platform→family lookup,
  selects the factory-built Prompt, calls the UNCHANGED runPrompt; on invalid_response OR a policy fail,
  re-invokes runPrompt ONCE with an appended targeted corrective instruction (ceiling = 1 re-prompt / 2
  attempts total); a second failure surfaces invalid_response unchanged. runner.ts is NOT edited — no
  third prompt.id branch, no re-prompt logic in the generic runner.
- Tests — Tier-2: safeParse REJECTS prose where a thread is expected (MODE2-FORMAT-FAMILY-STRUCTURAL);
  thread length <3 and >8 rejected; the policy validator distinguishes shape-fail from sequence-fail
  (MODE2-THREAD-GUARDRAILS); the wrapper re-prompts EXACTLY once then surfaces invalid_response, and
  runPrompt is called at most twice (MODE2-NATIVE-RETRY — the test must REDDEN if the ceiling is mutated
  to 0 or 2). Use the MockAnthropicClient fixture routing pattern (runner.ts:112-118).

VERIFY: npm run test:app; tsc clean. Prove the re-prompt count with a fixture, not a comment. Address
every silent-failure-hunter finding before commit.
On commit: "B2.4 complete — format-family discriminated schemas + Tier-0 policy validator + per-family
Prompt factory + generate-native.ts bounded re-prompt (MODE2-FORMAT-FAMILY-STRUCTURAL, -THREAD-
GUARDRAILS, -NATIVE-RETRY); runner untouched; type-design-analyzer + silent-failure-hunter clean." Then stop.
```

#### B2.5 — Brief pipeline `lib/campaigns/brief.ts`: Stages A–C (memory-wired assembly + HARD critique gate + freeze)  ·  ADR §5.1, §6.3, §11  ·  MODE2-MEMORY-WIRED, MODE2-CRITIQUE-GATE, MODE2-BRIEF-BEFORE-COPY, MODE2-BRIEF-FROZEN (contract)

```
BUILDER — Session 24 · B2.5. The brief pipeline — assemble → critique → freeze-on-approve. Run
/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke security-reviewer (the assembly + rubric
calls both render pinned evidence — both go through wrapEvidenceForPrompt, ADR §12 caller table) AND
ecc:cost-aware-llm-pipeline (assembly + rubric are the added per-campaign token cost this checkpoint
introduces).

BUILD:
- lib/ai/prompts/brief.ts — a Prompt for Stage A brief ASSEMBLY: input = campaign objective/platforms +
  retrieved memory; output = CampaignBriefContent (narrative, proofPlan, pinnedEvidence id-set,
  roleSequence). Renders any evidence through wrapEvidenceForPrompt (B2.3).
- lib/campaigns/brief.ts — Stages A–C orchestration:
  * Stage A (assemble): retrieve evidence/audience/brand memory via lib/memory/ (retrieveEvidenceMemory
    /retrieveAudienceMemory/retrieveBrandMemory, signature (client, businessId, queryContext, limit?)),
    run the assembly prompt, persist a campaign_briefs row in 'draft' (business_id from the campaign),
    and atomically move campaigns.status draft→awaiting_brief.
    ⚠️ MEMORY WIRES INTO THE BRIEF ONLY. Do NOT touch CustomerContext (lib/ai/context.ts) — its shape is
    frozen (L-10 / ADR §5.1). If a step seems to need a CustomerContext field, STOP.
  * Stage B (critique gate): run the rubric (B2.2) over the brief; persist overall_score + critique;
    atomically move draft→critiqued. The HARD gate: critiqued→approved is ALLOWED only when
    overall >= BRIEF_QUALITY_THRESHOLD; below it, the transition is refused and the critique is returned
    (MODE2-CRITIQUE-GATE). Approval sets frozen_at (via the B2.1 helper).
  * The FrozenBrief factory (ADR §5.2): the ONE function producing the branded, deeply-readonly
    FrozenBrief from an approved row — a plain Brief cannot be passed where a FrozenBrief is required.
- lib/campaigns/brief.test.ts — Tier-2: memory retrieval feeds the assembly prompt input
  (MODE2-MEMORY-WIRED); a below-threshold brief is BLOCKED from approval and returns the critique, an
  at/above-threshold one is allowed (MODE2-CRITIQUE-GATE — test reddens if the comparison flips); no
  posts row exists until generation (MODE2-BRIEF-BEFORE-COPY); the FrozenBrief factory is the only
  producer and its output is readonly; evidence in both the assembly and rubric calls is [DATA]-guarded.

VERIFY: npm run test:app; tsc clean. Prove CustomerContext's shape is unchanged (diff the interface).
Address security-reviewer + cost-aware findings before commit.
On commit: "B2.5 complete — lib/campaigns/brief.ts Stages A–C: memory-wired assembly + HARD critique
gate + FrozenBrief freeze (MODE2-MEMORY-WIRED, -CRITIQUE-GATE, -BRIEF-BEFORE-COPY); CustomerContext
untouched; evidence guarded at every render." Then stop.
```

#### B2.6 — `generate.ts` rewire: frozen-brief → N native calls (Stages D–F) + hook loop + consistency pass  ·  ADR §5, §7, §8, §11  ·  MODE2-BRIEF-FROZEN, MODE2-CONTEXT-EQUIVALENT, MODE2-HOOK-STANDALONE, MODE2-ROLE-COVERAGE, MODE2-LINK-PLACEMENT

```
BUILDER — Session 24 · B2.6. The load-bearing rewire — the L-10 equivalence gate AND the SHARED-FUNCTION
CALLERS surface live here. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
typescript-reviewer (the generate.ts contract + the frozen-brief threading) AND ecc:cost-aware-llm-
pipeline (the hook Tier-2 loop is a bounded extra call — confirm it is bounded to one regeneration).

BUILD (ADR §5, §7, §8, §11 — Stages D–F):
- lib/campaigns/generate.ts — consume a FROZEN, APPROVED brief:
  * Gate generation on the atomic campaign_briefs approved→generated transition (B2.1); the final
    activateCampaign guard flips .eq('status','draft') → .eq('status','awaiting_brief') (:210). PRESERVE
    the already_generated guard (:63-71) and the session machinery unchanged.
  * For each platform: pick the format family (B2.4 Tier-0 map), call generate-native.ts with the SAME
    FROZEN brief object instance passed to EVERY per-platform call (MODE2-BRIEF-FROZEN — N independent
    calls, not one joint call, ADR §5).
  * Map each generated post to its brief-assigned role (roleSequence, §3.2) on the PostInsert; role is
    write-once (the trigger from B2.0 enforces it).
- Hook Tier-2 loop (ADR §7): generate → score the opener (single-post body first line / thread posts[0])
  against the rubric → regenerate ONCE if below threshold. Bounded to one regeneration. This is the ONLY
  Tier-2; NO Tier-3.
- Consistency pass (ADR §8) — role-coverage (Tier 0): positionally cross-check each generated post's
  role against the frozen brief's roleSequence ([type-6]) — every assigned role fulfilled. Link-placement
  (Tier 0): CTA/outbound links NEVER in tweet 1 (final tweet or follow-up). Nativeness = the rubric's
  platformNativeness dimension (already available via B2.2). DEFER cross-set redundancy behind
  MODE2-REDUNDANCY-UNDEFER — do NOT build it (STOP if tempted).
- lib/ai/context.ts — NOT edited. CustomerContext shape unchanged (L-10 / ADR §5.1).

VERIFY (the gates):
- MODE2-CONTEXT-EQUIVALENT: a fixture-based test proves the existing postGenerationPrompt path's
  CustomerContext + output are byte-identical (the existing lib/campaigns/generate.context-equivalence
  .test.ts pattern). Any existing context/generation test needing an edit is a behaviour change → STOP
  and show it.
- SHARED-FUNCTION CALLERS: git grep every caller of generatePostsForCampaign AND buildCustomerContext;
  write the per-caller → test-file table; a caller with no test is AUTHORED-NOT-EXECUTED for that caller.
- Add Tier-2 tests: same frozen object reaches every per-platform call; hook regenerates exactly once on
  a below-threshold opener (single + thread posts[0]); role-coverage reddens if a role is unfulfilled;
  link-placement reddens on a tweet-1 link. npm run test:app; tsc clean.
On commit: "B2.6 complete — generate.ts consumes the frozen approved brief, N native per-platform calls,
hook Tier-2 loop, role-coverage + link-placement pass, guard migrated to awaiting_brief (MODE2-BRIEF-
FROZEN, -HOOK-STANDALONE, -ROLE-COVERAGE, -LINK-PLACEMENT); CustomerContext byte-identical (MODE2-
CONTEXT-EQUIVALENT); per-caller test table recorded." Then stop.
```

#### B2.7 — Minimal brief-review surface: page + Zod Server Actions  ·  ADR §10  ·  drives MODE2-BRIEF-STATE-ATOMIC end-to-end

```
BUILDER — Session 24 · B2.7. The MINIMAL functional brief-review surface — enough to drive the state
machine and exercise the approval gate at the app layer. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke ecc:react-review. ⚠️ This is the MINIMAL surface (ADR §10): plain shadcn
v4 / Base UI. Do NOT apply impeccable/taste-skill and do NOT build the high-touch brief-edit or per-post
Studio diff — that is Session 24-UI. Attempting it here is an L-1 STOP.

BUILD (ADR §10):
- A Server Component page (Server-Component-page + Client-form split per CLAUDE.md) rendering the brief
  (narrative, proofPlan, roleSequence, latest critique + score) for a campaign in awaiting_brief.
- Server Actions (Zod-validated input, per CLAUDE.md — Server Actions for mutations, not POST routes):
  approveBrief / rejectBrief(reject = revise back to draft, version++) / editBrief — each calling the
  B2.1 atomic transition helpers and, for approve, the B2.5 HARD gate (a below-threshold brief cannot be
  approved from the UI either). i18n: add keys to en/pt/es SIMULTANEOUSLY; no hardcoded strings.
- A thin Client form owning the approve/reject/edit interactions (useActionState per CLAUDE.md).
- Tests — Tier-2: the Server Actions validate input with Zod and reject malformed payloads; approve is
  refused below threshold and succeeds above (the gate holds at the app layer, not just in brief.ts);
  reject bumps version and returns to draft; i18n keys exist in all three locales.

VERIFY: npm run test:app; tsc clean. react-review clean.
On commit: "B2.7 complete — minimal brief-review surface: Server Component page + Zod Server Actions
(approve/reject/edit) over the atomic transitions, i18n en/pt/es (ADR §10 minimal scope); high-touch UI
deferred to Session 24-UI." Then stop.
```

**Builder close-out.** After B2.7 is green + committed, the range is ready for the Reviewer (§3). Do NOT
push/PR-green here — that is the Reviewer's range to read and, per the ADR 0015 promotion tally, the
correction pass's last step (mirroring Session 23-D's D5). The db-tests suite for B2.0's Tier-1 tests
must show a NON-ZERO executed count (skip-guard), read by a human, before it counts toward promotion.

---

## §3 — Reviewer session (B3)  ·  *(PLACEHOLDER — author after ADR 0017 is Accepted)*

> **Do not fill this in yet.** Author it as Session 23 §3 was — an independent Opus review pass that
> modifies nothing, opens by naming the exact commit range it read (**PROC-REVIEW-AT-COMMIT** — read at
> the range, never at HEAD), and applies the **SHARED-FUNCTION CALLERS** rule to `buildCustomerContext`
> *and* `generatePostsForCampaign`. It is the single review pass for the session.
>
> **Anticipated ECC posture** (confirm against the accepted ADR): `database-reviewer` (origin/role
> migration + backfill + any brief-table RLS/cascade); `security-reviewer` (the brief-pinning →
> generation injection path, L-9 — this track's headline security concern, per plan doc B3);
> `typescript-reviewer` (the discriminated format-family + frozen-brief contracts, no `any`);
> `ecc:type-design-analyzer` (format-family + frozen-brief as designed invariants);
> `ecc:pr-test-analyzer` (does each `MODE2-*` test actually *execute* and *redden* if the property
> broke — the ADR 0015 "covered = executed" thesis); and — if Q6 shipped UI — `ecc:react-review` +
> `impeccable` for the brief-review surface.
>
> **Anticipated review sections** (rename to the ADR's `MODE2-*`): brief-before-copy + frozen-brief
> coherence; format-family structural validation + the schema-mismatch retry; role-coverage +
> link-placement + thread guardrails; the shared rubric + critique gate; the evidence-injection guard;
> memory wired into the brief; the existing-path behaviour-equivalence gate (L-10); origin/role
> migration + backfill + (if table) brief RLS + cascade; scope + process (L-1 out-of-scope items not
> shipped); constraint coverage mapped to the executing CI job (Tier-1 → db-tests, Tier-2 → app-tests).
> Output: `docs/reviews/session-24-reviewer.md`.

---

## §4 — Correction pass (Session 24-D)  ·  *(PLACEHOLDER — fill from the reviewer report)*

> **Do not fill this in yet.** Fill it from `docs/reviews/session-24-reviewer.md` exactly as Session 23
> §4 was filled from its reviewer report — a step per finding (D0, D1, …), each its own commit, ordered
> by the same deliberate logic (a "push + get CI green on the final range" BLOCKER runs **last**, not
> first, so it greens the range D0–D(n-1) actually produce).
>
> **Binding rules for the pass** (as in Session 23-D): resolutions go **into
> `docs/reviews/session-24-reviewer.md`** under a single appended, attributed
> `## CORRECTION PASS (Session 24-D)` section — **REVIEWER-REPORT APPEND-ONLY** (CLAUDE.md): the
> reviewer's findings are immutable and never edited in place; the appendix references each finding by
> ID and records *finding → fix → the test that now proves it → the commit SHA*; a disputed finding is
> argued in the appendix, never erased. **Never weaken a test to reach green** — if a correction shows a
> `MODE2-*` constraint is infeasible, **amend ADR 0017** and say so. Correction passes are normal, not
> failures (constitution).

---

## §5 — Docs to update at close-out (Track B done)

Do these at the END, once §2–§4 are green and reviewed — not before. Match the pattern the other tracks
used:

- **`docs/current-phase.md`** — a "Session 24 CLOSED — Mode 2 Upgrade (ADR 0017)" block in *What's
  done*, mirroring the Session 23 entry's density; update the status line; and roll the db-tests
  promotion tally forward with this session's CI runs.
- **`docs/decisions/0017-mode-2-upgrade.md`** — mark any amendments the correction pass forced (e.g. a
  ratified `CustomerContext` extension, or a `MODE2-*` constraint amended as infeasible), same as ADR
  0014 Amendment A / ADR 0011 Rev B.
- **`docs/decisions/0016-governed-memory.md`** — a note that §10's deferred `evidence`/`audience`/
  `brand` consumers are now wired (by 0017), so the "unwired by design" state in `lib/memory/index.ts`
  is closed out.
- **`docs/decisions/0010-legal-surface.md` Amd 2 §D2.5** — if Q1 shipped a `campaign_briefs` table,
  confirm its cascade row is in the table (the migration added it in B2.0; this is the doc-side
  confirmation).
- **`docs/brainstorm/session-plan-adrs-0016-0018.md`** — a one-line "Track B landed at `<sha>`; Track C
  (0018 diff-learning) is now the remaining queued work" note, so the next session picks up without
  re-deriving the dependency graph.
- **OpenWolf:** update `.wolf/anatomy.md` with the new brief/format-family/rubric files + the migration;
  append the session to `.wolf/memory.md`; add any new convention (e.g. "native output is a
  format-family schema, never a prompt request"; "brief-pinned evidence is always `[DATA]`-guarded") to
  `.wolf/cerebrum.md` Key Learnings.
- **`docs/build-guide/session-25.md`** — when Track C (ADR 0018 diff-based learning capture) is
  scheduled, author it the same way, now that the brief pipeline + `ai_original` snapshot point exist in
  their real shipped shape.
