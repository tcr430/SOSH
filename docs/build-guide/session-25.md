# Session 25 — Diff-Based Learning Capture (ADR 0018) · Track C

> **Goal:** close the loop. Today every AI-authored draft the human rewrites throws that rewrite away —
> the edit is the single highest-signal thing a customer produces, and SOSH currently learns nothing from
> it. Track C snapshots the AI's own output at generation time (`ai_original`), diffs it against the
> human-approved final version at the existing atomic approval transition, classifies the difference
> **heuristic-first**, and — only after a pattern repeats — promotes a confidence-scored statement into
> the governed memory Track A built. Nothing else.
>
> **This is Track C of a three-track programme** (`docs/brainstorm/session-plan-adrs-0016-0018.md`):
> A = ADR 0016 governed memory (**landed** — Session 23, incl. 23-D/23-E); B = ADR 0017 Mode 2 upgrade
> (**landed** — Session 24, incl. the 24-D correction pass, close-out SHA `93454d94`); C = ADR 0018
> diff-based learning capture (**this file**). **C depends on A having landed** — `performance_memory`
> exists, ships **empty**, and ADR 0016 §3.4 names it *"Track C's write target"*; ADR 0016 §10 names ADR
> 0018 as **the WRITER** and puts the promotion threshold (`candidate → active` on `observation_count` /
> `confidence`) squarely in this ADR's ownership. C does **not** depend on B — but B has landed anyway,
> which materially changes C's design surface (see the Reality block below). **Do not build** Mode 1
> (Studio), Mode 3 (signal-driven / mining / insight cards / opportunity feed), `relationship_memory`,
> embeddings, the skip-review fast path, or any change to generation *behaviour* (all deferred — see §0
> L-1 and the plan doc §4).
>
> **Reality check — what changed under this track while it waited (ground the ADR in this, not in the
> 2026-07-17 strategy doc's assumptions):**
> 1. **AI output is no longer a flat string.** ADR 0017 shipped discriminated **format-family** schemas
>    (`single-post` `{ body, imageBrief? }`, `thread` `{ posts:[{text,order,role}], imageBrief? }`), while
>    `posts.content` is still one `text` column. "Snapshot the AI original" is therefore a real design
>    question, not a column add (§0.1 Q1).
> 2. **Evidence is pinned by id.** ADR 0017's frozen brief pins an evidence-citation set, hardened at
>    24-D/MAJOR-1 to a `business_id`-enforced citation-by-id boundary. That gives Track C something the
>    strategy doc could not assume: a **checkable** definition of "the human removed a claim that was
>    never in the evidence set" — i.e. a *correction* (§0.1 Q4).
> 3. **The brief is itself human-edited and versioned** (`campaign_briefs`, ADR 0017 §2.1–§2.3). That is a
>    second, arguably higher-signal diff source than post copy. In or out of Track C? (§0.1 Q2.)
> 4. **`PerformancePattern`'s `likes`/`impressions` are already optional** (Session 23-E, `6149535f`) —
>    ADR 0016 §3.4's un-defer trigger, which explicitly bound ADR 0018 (*"must not ship a
>    `performance_memory` writer without resolving the placeholder"*), is **discharged**. The ADR must
>    confirm this and must not resurrect the `0/0` inversion (§0.1 Q5).
>
> **Phase gating.** §1 (Architect) runs **first and alone**. Nothing in §2/§3/§4 starts until
> `docs/decisions/0018-diff-based-learning-capture.md` is written and Accepted — the Builder transcribes
> the ADR, it does not run in parallel with its authoring. §0.1 carries the questions the Architect (C1)
> **must** resolve *in the ADR*; the Builder consumes those answers as binding. **§2/§3/§4 are
> intentionally placeholders in this file** — they are authored the same way Tracks A and B authored
> theirs, but only *after* ADR 0018 is finished and founder-approved, so they can be pinned to the ADR's
> real, named constraints (`LEARN-*`) rather than guessed ahead of it.
>
> **How to use this file:** run §1 to completion, get ADR 0018 accepted, come back and fill §2–§4 from the
> accepted ADR, THEN paste each later phase into Claude Code in order. **Architect → Opus. Builder →
> Sonnet. Reviewer → Opus. Correction → Opus.** Each phase opens with a **primer** — paste it, wait for
> acknowledgement, then paste the numbered steps one at a time, letting each go green + commit before the
> next.
>
> **One step, one commit.** The snapshot migration, the capture hook, the heuristic classifier, the batch
> summarizer, the promotion job, the cron route, and any surface are separately reviewable commits.
>
> **ECC posture.** Every phase names its specialist agents/skills, not just the
> `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` spine. This track's real risk surface:
> **silent confidence inflation** (a diff counted twice is a correctness bug that quietly teaches the
> model a lie), **corrupting voice memory** by conflating a hallucination fix with a taste preference,
> **PII/GDPR** (the snapshot and the diff record are customer content and third-party quote material —
> they need cascade rows or they are a silent erasure leak), **prompt injection** (human-edited copy
> becomes LLM *input* in the batch summarizer — a first for this codebase), and **cost** (an LLM call per
> post would be the wrong architecture at any scale). Hence `cost-aware-llm-pipeline` and
> `silent-failure-hunter` are first-class here, not afterthoughts. Do not add specialists outside this
> surface.

---

## §0 — Locked decisions (binding input — from the strategy docs; adjudicated by founder)

These are already decided in `campaign-modes-architecture-and-build-plan.md` (§1 Mode-2 stage I, §2
Phase B) and `intelligence-layer-memory-mining-rubric-opportunity-feed.md` (§1, §5 "the learning loop").
The Architect (C1) **encodes** them in ADR 0018 and names their losers; it does **not** re-open them.
Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR needs to
contradict a Locked decision, it STOPS and flags for founder adjudication (exactly as an ADR
contradicting CLAUDE.md would).

**Locked (L):**

- **L-1 — Track C ships the diff-based learning capture ONLY.** *In scope:* the **`ai_original`
  snapshot** and where it is set; the **capture hook** at the existing atomic approval transition; the
  **heuristic-first classifier**; the **correction-vs-preference** split; the **periodic batch LLM
  summarization**; the **confidence-aggregation promotion threshold** that gates `candidate → active`;
  and the **write-back into governed memory** (`performance_memory` — ADR 0016 §3.4 — and whatever Q6
  decides for voice-directed signal). **Amended by §0.2/A-2 — also in scope:** routing the three
  unguarded `recentPostPerformance.topContent` render sites through the shared `neutralize()`
  (`LEARN-PATTERN-RENDER-GUARDED`), because this track converts that latent hole into the automated,
  at-scale write path. *Out of scope, explicitly:* Mode 1 Studio; Mode 3 (signal-driven /
  mining / insight cards / opportunity feed); `relationship_memory` (ADR 0016 §3.6); embeddings (ADR 0016
  §5.3's un-defer trigger is not this track's); the **skip-review fast path** (ADR 0017 L-11 — Track C
  produces the *evidence* that would later justify it, and still does not build it); and **any change to
  generation behaviour**. If a step appears to need any of these, **STOP and report**.

- **L-2 — The AI's own output is snapshotted at generation time, kept SEPARATE from the mutable field
  the human edits freely.** The snapshot is written once, by the generating path, and is **never**
  overwritten by a human edit. If the snapshot can be clobbered, the entire ground truth of this track is
  gone — this is the load-bearing invariant of ADR 0018.

- **L-3 — The diff is taken at the approval/publish state transition — the existing atomic guard — not
  on every edit.** The final approved version is ground truth. Per the intelligence doc §5: a user can
  "accept" a suggestion and then still quietly rewrite it, so an accept/reject log alone misses the real
  signal; the diff against the *final approved* version subsumes it.

- **L-4 — The pipeline is MODE-AGNOSTIC by construction.** It keys off "an AI-authored draft that a human
  approved", never off `campaigns.origin`. Because of that, every editing surface in the product —
  Studio (Mode 1), campaign review, the approvals inbox, a future quick-edit surface — feeds the same
  loop for free. Build it once; it pays for all three modes (companion doc §5.6, Phase B).

- **L-5 — Heuristic-first classification; LLM second, batched, never per-post.** Word-list matches
  against `avoid_words`, length delta, hashtag delta, CTA presence/absence — **Tier 0, no LLM call**.
  Higher-level pattern statements ("this business shortens AI-generated LinkedIn hooks by ~20% on
  average") come from **periodic batch** summarization over accumulated signals — *not* one call per
  approved post. An LLM call per post is the wrong architecture at any scale and is an L-1 STOP.

- **L-6 — Correction vs. preference is distinguished from day one, and ENFORCED, not merely
  documented.** An edit that fixes a hallucinated fact is an **evidence/grounding** signal; an edit that
  changes tone is a **taste** signal. Conflating them teaches voice memory the wrong lesson and corrupts
  it permanently — the corruption is silent and compounding. The plan doc's Track C Reviewer step names
  this specifically: *"a check that the correction/preference split is actually enforced (not just
  documented) before anything writes into voice memory."* Design it so a correction-tagged signal is
  **structurally incapable** of reaching a voice-directed write, not merely branched around by an `if`.

- **L-7 — Aggregate before promoting. A single diff must not change future generation.** A pattern must
  repeat across N posts/campaigns before it moves from "observed once" to "used to steer generation".
  ADR 0016 §2 already ships the columns this gates on — `status` (`candidate` → never retrieved →
  `active`), `observation_count`, `confidence` (`numeric(3,2)`) — and ADR 0016 §10 assigns the
  **threshold itself** to this ADR. Retrieval already returns `active` only, so the gate is
  **structural**, not a convention.

- **L-8 — The worker copies the existing worker pattern exactly; no new infrastructure is invented.**
  The repo has four live examples (`runPublishTick` / `runJanitorTick` `lib/publishing/orchestrator.ts:65,317`,
  `runMetricsSyncTick`, `runEmailDrainTick`, `runDeletionTick`): lazy `createServiceRoleClient` import,
  `Sentry.withMonitor`, **one** canonical `console.log(JSON.stringify({ kind, triggeredBy, ...summary }))`
  line per tick, bounded batch claim, an explicit failure taxonomy (transient retry vs permanent
  abandon), tunables in `lib/config.ts`, and a POST-only QStash dual-mode cron route under
  `app/api/cron/` (`app/api/cron/publish/route.ts:13,99,106`) with a runbook row. Deviating from this
  pattern is a finding, not a choice.

- **L-9 — Writes go THROUGH governed memory, never around it.** `performance_memory` is the designated
  write target (ADR 0016 §3.4), written with `source = 'distilled'` and `status = 'candidate'`. **Voice
  has no table** — ADR 0016 §3.5 `MEM-VOICE-THROUGH-EXISTING` creates none, deliberately, and reads
  through `brand_voices` / `brand_voice_variations` (ADR 0011). Silently mutating those user-owned rows
  from an inferred preference is a change to the customer's own data without their consent; treat any
  design that does so as a STOP pending founder adjudication (§0.1 Q6). Table access stays inside
  `lib/db/memory-*` + `lib/memory/*` (`MEM-NO-DIRECT-TABLE-ACCESS`).

- **L-10 — Agency ceiling for this track is Tier 1.** Tier 0 (deterministic heuristics, deltas,
  thresholds, promotion arithmetic) + Tier 1 (one batched summarization call per business per period).
  **No Tier 2, no Tier 3.** Mode 3's signal triage remains the only Tier-3 in the entire product, and it
  is deferred. The learning loop is background, cheap, and boring on purpose.

- **L-11 — GDPR and PII obligations are not optional here.** The `ai_original` snapshot is customer
  content; the diff record may contain third-party quote material identical to what `evidence_memory`
  holds (ADR 0016 §3.2's sensitivity note). Any new business-scoped table gets the **full** obligation —
  RLS in the InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `ON DELETE
  CASCADE` from `businesses`, **and** a row in ADR 0010 Amendment 2 §D2.5's cascade table plus
  `purge_business` coverage. A business-scoped table omitted from the cascade table is a silent
  GDPR-erasure leak (CLAUDE.md). If the snapshot lands as a column on `posts`, say explicitly that it
  inherits `posts`' existing cascade and cite it.

- **L-12 — Contract discipline + constitution rules, inherited by every step.** Additive migration with
  an explicit backfill (existing rows → NULL, stated); **Zod** on every new Server Action / route input;
  **atomic** state transitions (conditional `WHERE`, never read-then-update); every new list query
  **bounded + explicit `ORDER BY`** matching an index; **date-fns** (`formatISO`, never
  `new Date().toISOString()`); **no `any`**, **no `console.*`** outside the one canonical tick log;
  env only via `lib/config.ts`; DB only via `lib/db/` (+ `lib/memory/`); service-role via lazy import,
  never in a user-facing read path; **i18n en/pt/es simultaneously** for any user-facing string; and —
  **critically for this track** — the **SHARED-FUNCTION CALLERS** rule (CLAUDE.md): the capture hook
  attaches to `approvePost` (`lib/db/posts.ts:320`) and/or `bulkApproveDraftPosts`
  (`lib/db/posts.ts:526`), each of which has **multiple callers**. Both Session 22 blockers were the same
  root cause — a constraint verified against one of two callers of exactly this function across three
  consecutive sessions. Enumerate every caller, per caller, with its test file.

- **L-13 — No new runtime dependency without explicit founder confirmation.** There is **no diff library
  in `package.json` today** (verified). CLAUDE.md forbids adding dependencies without confirming. If Q3
  concludes one is needed, it is pinned to an **exact** version, no caret — the Session 13.5D/B7 rule
  (`@upstash/qstash` was pinned for exactly this reason).

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | What Track C ships | diff-based learning capture only | bundling Mode 1 / Mode 3 / mining / the skip-review fast path (each depends on foundations not yet built, or on *this* track's data to justify it — plan §4) |
| D-2 | The learning signal | **diff of AI-original → human-approved final** | an explicit accept/reject log per suggestion (misses the silent rewrite after an "accept" — intelligence doc §5.2); explicit thumbs-up/down UI (asks the user to do work they already did by editing) |
| D-3 | Classification | **heuristic-first (Tier 0)**, batch LLM second | an LLM classification call per approved post (cost scales with usage, latency on the approval path, quieter failures) |
| D-4 | Promotion into memory | **aggregate-then-promote** via `observation_count`/`confidence`/`status` (ADR 0016 §2) | writing an `active` memory row from a single diff (one data point asserted as fact — the exact failure ADR 0016 L-5 exists to prevent) |
| D-5 | Signal typing | **correction vs preference split, structurally enforced** | one undifferentiated "edit" signal (teaches voice memory that a hallucination fix is a style preference — silent, compounding corruption) |
| D-6 | Worker shape | **copy the existing tick/orchestrator + QStash cron pattern** | a bespoke queue, a DB trigger doing the **classification / LLM / promotion** work inline, or a Vercel-Cron-only path (the repo migrated off it — ADR 0005 Amd 1). *Sharpened by §0.2/A-1: an `AFTER UPDATE` trigger that only ENQUEUES an outbox row is sanctioned by Q2(b) and is not a D-6 loser — see `LEARN-TRIGGER-ENQUEUE-ONLY`.* |
| D-7 | Agency ceiling | **Tier 1 max** (batched summarization) | an agent that decides what to learn (cost compounds, testability degrades to statistical, failures get quiet — intelligence doc §5) |

---

## §0.1 — Questions the Architect (C1) must resolve IN the ADR (BINDING)

The strategy docs leave these open "for the Architect session" (companion doc §3 close: *"exact
confidence-threshold numbers for memory promotion"*; plan doc §2 Track C). **C1's ADR must decide each
one explicitly, name the loser, and tier the resulting constraint** (Tier 0/1 per L-10, and the test tier
per ADR 0015 §2). The Builder consumes the ADR's answers as binding; it does not re-decide them. Ground
every answer in the real seams (let `ecc:code-explorer` map them — §1).

- **Q1 — `ai_original`: placement, SHAPE, write-once enforcement, backfill.** Column on **`posts`** vs a
  separate **history/snapshot table**? And *what* is snapshotted — now that ADR 0017 produces
  **structured** format-family output (`single-post` / `thread` discriminated schemas) while
  `posts.content` remains a single `text` column: the rendered string, the structured payload as JSONB,
  or both? A string-only snapshot cannot tell you the human collapsed a 5-tweet thread to 3; a JSONB
  payload makes the heuristics richer but couples the snapshot to ADR 0017's schema version — say how
  that is versioned. **Write-once must be enforced in the DB, not by convention** — ADR 0017 shipped
  exactly this precedent twice (`MODE2-ROLE-WRITE-ONCE`, `MODE2-BRIEF-FROZEN-GUARD`: reject the UPDATE in
  a trigger); L-2 is at least as load-bearing. Backfill for existing rows (NULL — state it). And the
  `PostUpdate` exclusion set (`lib/db/types.ts:320` already excludes `role` for precisely this reason).

- **Q2 — The capture trigger point, its callers, and whether the BRIEF diff is in scope.** Where does
  capture attach? `approvePost` (`lib/db/posts.ts:320`; callers `calendar/actions.ts:280`,
  `campaigns/[id]/posts/actions.ts:94`) and `bulkApproveDraftPosts` (`lib/db/posts.ts:526`; callers
  `campaigns/[id]/posts/actions.ts:218` and the approvals-inbox action) — **enumerate every caller and
  state, per caller, that it is covered** (L-12 / SHARED-FUNCTION CALLERS; Session 22's twin blockers
  were this exact function pair). Decide the mechanism: **(a) inline** in the transition (couples the
  user's approve latency — and its failure modes — to the capture), **(b) an outbox row** written in the
  same transition and drained by the worker (the repo's established pattern — `email_outbox`), or
  **(c) a worker re-scan** of approved posts on a staleness predicate (simplest, needs a cursor/claim and
  risks double-counting — see Q7). Also decide: does **publish** capture too, or approval only (the
  strategy doc says "approval/publish")? And: ADR 0017 shipped a **human-editable, versioned brief**
  (`campaign_briefs`, §2.3) — brief edits are a *strategy-level* signal arguably richer than copy edits.
  In scope for Track C, or named as a follow-on? Name the loser either way.

- **Q3 — The diff algorithm and the dependency question (L-13).** There is no diff library in
  `package.json`. Decide: an exact-pinned dependency (`diff`, `diff-match-patch`, …) or an in-repo
  deterministic implementation. Pressure-test the premise first: the L-5 heuristics need **deltas**
  (length, hashtag count, avoid-word hits, CTA presence, thread-length change), not a rendered patch —
  does a full text diff actually earn a dependency *in this track*, or only in Mode 1 Studio (Phase C),
  where the visual left/right diff **is** the product? State the determinism requirement either way (the
  same input pair must always produce the same classification — it feeds a confidence counter). Name the
  loser.

- **Q4 — The classification taxonomy, and how the correction/preference split is ENFORCED (L-6).**
  Enumerate the signal kinds the heuristics emit (avoid-word removal, length delta, hashtag delta, CTA
  added/removed, thread shortened/lengthened, link moved, …). Fix the **rule** that decides
  correction-vs-preference — and note the new lever ADR 0017 handed you: the frozen brief pins evidence
  **by id** with a `business_id`-enforced boundary (0017 Amendment A.1), so "the human deleted a claim
  that cites no pinned evidence" is a **checkable** correction signal rather than a guess. Then state the
  **structural** enforcement: how is a correction-tagged signal made *incapable* of reaching a
  voice-directed write — a discriminated union whose voice-write function only accepts the preference
  variant, a separate table, a type-level brand? A runtime `if` is not enforcement. This is the finding
  the Reviewer is explicitly told to hunt for.

- **Q5 — The memory write contract, the promotion THRESHOLD, and decay.** What exactly is written into
  `performance_memory` (`dimension` ∈ topic/hook/format/proof_type, `pattern`, `platform`, plus ADR 0016
  §2's governance block) with `source='distilled'`, `status='candidate'`. Then the number the companion
  doc explicitly left to you: **what `observation_count` / `confidence` promotes `candidate → active`**,
  and is it a named ADR constant (like `BRIEF_QUALITY_THRESHOLD` and the memory caps) rather than a
  scattered magic number? Is promotion the same worker or a separate step? Does an unreinforced pattern
  **decay** (`last_confirmed_at`, `expires_at` — both already exist and retrieval already excludes
  expired rows), and does a *contradicting* diff reduce confidence or only fail to raise it? Finally:
  **confirm ADR 0016 §3.4's un-defer trigger is discharged** — Session 23-E made `likes`/`impressions`
  optional on `PerformancePattern` — and state that the distilled writer **omits** them and carries
  `observation_count` as the credibility signal, never inventing `0`.

- **Q6 — Voice learning when there is deliberately no voice table (L-9, `MEM-VOICE-THROUGH-EXISTING`).**
  The strategy doc's own first test case is voice-shaped: *"if users consistently strip thread numbering,
  that's an unambiguous diff signal that should update voice memory over time."* But ADR 0016 §3.5 ships
  **no** `voice_memory` table and reads voice **through** `brand_voices` / `brand_voice_variations`. So
  where does a preference signal land? Weigh at least: **(a)** a `performance_memory` row with
  `dimension='hook'|'format'` (zero schema change, user's voice rows untouched, but "voice" learning
  lives under a "performance" label); **(b)** a **human-reviewable suggestion** surface that *proposes* an
  `avoid_words` addition the user approves (consistent with human-in-the-loop, needs UI — see Q8);
  **(c)** an **amendment to ADR 0016** adding a voice-directed governed store (honest, but amends a
  landed ADR — flag it as such and get founder ratification, do not do it silently). **Auto-mutating
  `brand_voices` from an inference is a STOP** unless the founder ratifies it explicitly. Decide, name
  the loser, and say which ADRs the decision amends.

- **Q7 — Worker topology, schedule, cost ceiling, and IDEMPOTENCY.** Which existing tick is copied
  (publish / metrics / deletion / email-drain — all four are live references)? Batch claim mechanism
  (`FOR UPDATE SKIP LOCKED`, as `claim_deletion_requests`?), batch size + cadence as `lib/config.ts`
  tunables (name them, with defaults, matching the `*_BATCH_SIZE` / `*_MAX_ATTEMPTS` /
  `*_BACKOFF_*` convention at `lib/config.ts:28-64`), the **summarization cadence** (per business per
  period, per L-5) and its **per-business cost ceiling**, and the **model tier** (CLAUDE.md's stack line
  puts Haiku 4.5 on classification — justify whatever you pick). Failure taxonomy (transient retry vs
  permanent abandon, as `lib/deletion/orchestrator.ts`). And the one that is a genuine correctness bug
  rather than a nicety: **idempotency** — a diff counted twice silently inflates `observation_count` and
  promotes a pattern that was observed once. State the mechanism (a unique constraint? a processed-at
  marker? an atomic claim?) and how a test proves a replayed tick changes nothing.

- **Q8 — Surfacing scope: does Track C ship ANY user-facing surface?** The plan doc's Phase B lists no
  UI, but the intelligence doc's stated moat is *"explainable suggestions sourced to that memory, not
  generic LLM judgment"* — memory nobody can see is memory nobody trusts, and Q6 option (b) *requires* a
  surface. Decide: pipeline-only, a read-only "what SOSH has learned" panel, or the approve-a-suggestion
  flow. **If any UI: it is i18n en/pt/es simultaneously, Server Component page + Client form split,
  shadcn v4 / Base UI per CLAUDE.md, and `impeccable` + `taste-skill` govern its bar.** **If none:** name
  the follow-on session **and** state how a founder verifies in production that the loop is actually
  learning (a script? a query? the tick log line?) — a pipeline whose only output is invisible rows is
  unverifiable, and this track's whole value is that it compounds silently.

Where a C1 answer and this build-guide disagree, **the ADR wins once written** — but C1 must not
silently contradict a §0 Locked decision; if it needs to, it STOPS and flags for founder adjudication,
exactly as an ADR that contradicts CLAUDE.md would.

---

## §0.2 — Founder adjudications (raised by C1 after its eight §0.1 answers, before the ADR body)

C1 surfaced three calls that touch a §0 Locked decision or a landed ADR and correctly stopped for
adjudication rather than proceeding. **All three are ADJUDICATED IN FAVOUR, with the conditions below.**
The ADR is written against this section; the Reviewer (C3) audits the ADR against it.

### A-1 — The enqueue trigger is within Q2(b) and does NOT contradict D-6 (CONFIRMED)

**Ruling.** D-6's loser is a trigger *doing the work*. An `AFTER UPDATE` trigger whose entire body is
"INSERT one outbox row" is the **enqueue**, which Q2(b) explicitly sanctions, and the repo already has
this exact pattern (`ensure_owner_membership`, AFTER INSERT DEFINER, 21A-D/D1). Not a contradiction; no
STOP.

**The rationale is stronger than "permitted", and the ADR must record it as such:**
1. **L-3 makes it near-mandatory.** Capture must be atomic with the transition. Supabase JS has no
   client-side transaction, so an app-code enqueue means a crash/timeout between the UPDATE returning and
   the INSERT landing **silently drops the signal forever** — exactly the quiet-failure class this track
   exists to eliminate.
2. **It structurally dissolves the SHARED-FUNCTION CALLERS risk (L-12).** A trigger on the row transition
   covers every caller of `approvePost` / `bulkApproveDraftPosts` — present *and* future, including ones
   a later session adds without reading this guide. App-code enqueue must be wired and tested per caller,
   which is the precise failure mode behind both Session 22 blockers.

**Conditions (all binding on the ADR):**
- **D-6's loser wording is sharpened** to "a DB trigger doing the **classification / LLM / promotion**
  work inline" — the enqueue is explicitly carved out.
- **New constraint `LEARN-TRIGGER-ENQUEUE-ONLY`** (Tier 0, test Tier 1): the trigger body may **only**
  INSERT the outbox row (ids + status). **No** diffing, no text processing, no network, no writes to any
  memory table. This is the bright line that stops a future session growing work into the trigger.
- **`WHEN` clause scoped to the one transition** (not any UPDATE), matching the atomic-guard discipline.
- **DEFINER posture stated**, following the `ensure_owner_membership` precedent (the outbox table is
  business-scoped with RLS; an invoker-rights INSERT from the trigger will not behave as assumed).
- **Per-row firing under bulk approve stated**: `bulkApproveDraftPosts` can transition up to
  `APPROVALS_POST_LIMIT` rows in one statement → that many outbox inserts in one statement. Fine, but on
  the record.
- **Unapprove → re-approve re-fires the trigger.** Fold this into the Q7 idempotency/dedupe design; it is
  a real duplicate-signal path, not a hypothetical.

### A-2 — `LEARN-PATTERN-RENDER-GUARDED` is IN SCOPE for Track C; L-1 is amended (CONFIRMED)

**Ruling.** security-reviewer HIGH-2 is closed **in this track**, not spun out. Two facts settle it:

1. **`neutralize()` was exported for precisely this reuse.** Its own header (`lib/ai/wrap-evidence.ts:73-82`,
   B2.5 security-reviewer correction pass) states it is exported so callers rendering other
   DB-stored/AI-generated text reuse *this same* Unicode-hardened guard instead of a local ASCII-only
   `sanitizeDataField`, and names the defect as *"an inconsistency in the threat model, not a justified
   design choice."* That reasoning covers `recentPostPerformance.topContent` verbatim. This **completes an
   existing choke point**; it does not open new design ground.
2. **It cannot break `MODE2-CONTEXT-EQUIVALENT`.** `neutralize()` (`wrap-evidence.ts:83-92`) is
   **byte-identity-preserving on benign input** — it alters text only when it contains invisible format
   characters, `[/DATA]`, triple backticks, or a leading `{`/`[`. Benign fixtures render byte-identically,
   so ADR 0017's equivalence tests stay green with **no** ratified output change and no founder
   adjudication on a behaviour delta. (Contrast Session 23-E's `On {platform}:` prefix, which *was* a
   recorded live-path change.) The work really is small.

**Why it is not deferrable.** Today `performance_memory` ships empty with no writer, so the unguarded
render is reachable only by an actor who can already insert into the customer's own tables. ADR 0018
ships the writer and makes the rendered string **derived from human-edited post copy, refreshed weekly,
at scale, with no human reading it before it enters a live prompt**. The threat model changes materially
*because of this track*. "Record the risk as accepted" would mean accepting a risk this ADR creates —
the wrong disposition. **When a feature converts a latent vulnerability into a reachable one, closing it
is part of that feature.**

**Conditions (all binding on the ADR):**
- **L-1's in-scope list is amended** to name this explicitly. An unrecorded widening is exactly what L-1
  exists to prevent, so it is recorded, not absorbed.
- **Bounded to exactly three call sites + the shared helper**: `lib/ai/prompts/post-generation.ts:158`,
  `lib/ai/prompts/formats/native-generation-prompt.ts:158-163`, and
  `lib/ai/prompts/post-regeneration.ts:139` (which today applies only the weaker local
  `sanitizeDataField`). **No opportunistic sweep** of other prompt fields — anything else found is a
  separate finding, filed, not fixed here.
- **Ordered EARLY in the Builder** — with, or before, the writer step. There must be **no commit range in
  which the distillation writer is live and the render guard is not**.
- **One sub-decision the ADR must make explicitly:** bare `neutralize()` vs. the full `[DATA]`-wrap +
  length cap (`guard()`-style). Weigh: the `[DATA]` framing is what tells the model "data, not
  instructions", and a cap is also a **cost control** (a hostile 50 KB "pattern" would otherwise consume
  the prompt budget). Decide per call site against what the surrounding template already frames.
- **SHARED-FUNCTION CALLERS now applies to `neutralize()` itself** — it gains three callers; enumerate
  them with their test files, same as any other shared function.

### A-3 — `performance_memory.pattern_key` ships as ADR 0016 Amendment B (CONFIRMED)

**Ruling.** Posture is correct: additive column + partial UNIQUE index on a landed ADR's table, recorded
as an amendment. Same posture as ADR 0017's cascade-row amendment.

**Conditions (all binding on the ADR):**
- **The amendment lives in ADR 0016** (`## Amendment B`, appended; §3.4's original text untouched —
  append-only, as Amendment A was). **ADR 0018 cites it**, not the reverse. The **migration ships in
  Track C**.
- **`pattern_key`'s derivation is specified exactly and must be deterministic.** This is the load-bearing
  detail, because both failure directions are **silent**: fragmentation (two semantically-identical
  patterns keying differently) means `observation_count` never reaches threshold and **nothing ever
  promotes** — the feature appears to work and learns nothing; collision (two distinct patterns keying
  the same) **inflates confidence on a merge** and promotes something observed once. State the derivation
  and the test that proves determinism.
- **The partial UNIQUE's predicate is stated, and the `ON CONFLICT` target must match it inferrably** —
  `ON CONFLICT (…) WHERE <same predicate>`. A bare `ON CONFLICT (cols)` does **not** resolve to a partial
  index; `database-reviewer` confirms this on the proposed DDL.
- **One line confirming RLS + erasure cascade are unaffected** (additive column on an already-cascaded
  table; the four §D2.5 rows stand).

---

## §1 — Architect session (C1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces
**`docs/decisions/0018-diff-based-learning-capture.md` ONLY**. No `.ts`, no `.sql`, no `.tsx` — no code
of any kind. Any code attempted here is discarded. The last action is a single confirmation line, then
`/exit`. **§2 does not start until this ADR is Accepted** — and §2/§3/§4 of *this build-guide* are
authored only after that, from the ADR's real `LEARN-*` constraints.

**ECC in this phase.** The Architect uses read-only intelligence agents to *ground* the ADR in the real
repo before writing a word of it:

- `ecc:code-explorer` — trace the live seams (`approvePost` / `bulkApproveDraftPosts` and **every**
  caller; `updatePostContent` / `updatePostContentAndMetadata`; `createPosts` and where `generate.ts`
  would write the snapshot; the four existing tick orchestrators + their QStash routes; `lib/memory/`'s
  public surface and `lib/db/memory-*`; `campaign_briefs`' versioning) and return exact `file:line`
  citations, so the ADR is grounded rather than remembered.
- `ecc:architecture-decision-records` (skill) — the ADR house structure (context / decision / losers /
  consequences / constraint table), so 0018 matches 0010–0017 in shape.
- `database-reviewer` (agent, advisory/read-only here) — pressure-test the *proposed* schema on paper:
  the snapshot's placement and write-once trigger, any new signal/outbox table's RLS + indexes + cascade,
  the claim mechanism, the backfill, and the promotion UPDATE's atomicity.
- `security-reviewer` (agent, advisory/read-only here) — two specific paths: **(1) GDPR/PII** — the
  snapshot and diff records are customer content and may carry third-party quote material (ADR 0016
  §3.2); confirm the cascade + `purge_business` obligation is complete (L-11). **(2) Prompt injection** —
  the batch summarizer feeds **human-edited copy** into an LLM, which is a *new* direction of data flow
  for this codebase; confirm it is `[DATA]`-wrapped + `sanitizeDataField`'d exactly as ADR 0017 L-9
  requires of pinned evidence.
- `ecc:type-design-analyzer` (agent, advisory/read-only here) — the **correction-vs-preference split**
  (L-6/Q4) is the type-design core of this track: sanity-check that the proposed types make an invalid
  write *unrepresentable*, rather than merely branched around.
- `cost-aware-llm-pipeline` (skill/agent, advisory) — the batch summarization cadence, model tier, and
  per-business cost ceiling (Q7). This is precisely its remit (CLAUDE.md agent table) and the one place
  this track can quietly become expensive.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 25 — Diff-Based Learning Capture, ARCHITECT phase. You produce ONE artefact:
docs/decisions/0018-diff-based-learning-capture.md (status: Accepted). You write NO code — no .ts, no
.sql, no .tsx. If you catch yourself writing a migration, a zod schema body, or a worker function, stop:
that is the Builder's job (C2), and the constitution requires Architect-attempted code to be discarded.

ECC posture for this phase:
- FIRST run ecc:code-explorer over the seams below to produce grounded file:line citations. Do not rely
  on memory for line numbers — cite what the explorer finds.
- Use the ecc:architecture-decision-records skill for the ADR's structure so 0018 matches 0010-0017.
- Consult database-reviewer (read-only, advisory) on your PROPOSED schema: the ai_original snapshot's
  placement + its write-once DB trigger, any new signal/outbox table's RLS + indexes + cascade, the
  claim mechanism, the backfill, and the promotion UPDATE's atomicity.
- Consult security-reviewer (read-only, advisory) on TWO paths: (1) GDPR/PII — snapshots and diff
  records are customer content and may carry third-party quote material (ADR 0016 §3.2); the cascade +
  purge_business obligation must be complete. (2) Prompt injection — the batch summarizer feeds
  HUMAN-EDITED COPY into an LLM, a new direction of data flow here; it must be [DATA]-wrapped +
  sanitizeDataField'd exactly as ADR 0017 L-9 requires of pinned evidence.
- Consult ecc:type-design-analyzer (read-only, advisory) on the correction-vs-preference split: the
  types must make a correction-signal → voice-write UNREPRESENTABLE, not merely branched around.
- Consult cost-aware-llm-pipeline (advisory) on the batch summarization cadence, model tier, and
  per-business cost ceiling.
All of them write NO code; they pressure-test the design on paper.

Read now, before anything else:
- docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md — §5 "The learning loop"
  (the six numbered steps: snapshot → diff at the approval transition → heuristic-first classify →
  correction-vs-preference → aggregate before promoting → mode-agnostic by construction) and §1 (the
  governance metadata every memory record carries). This is the PRIMARY source for this ADR.
- docs/brainstorm/campaign-modes-architecture-and-build-plan.md — §2 "Phase B" (the four bullets that
  scope this track) and §1 Mode 2 stage I. §1 Mode 1/Mode 3 are context for what you must NOT build.
- docs/brainstorm/session-plan-adrs-0016-0018.md — the dependency graph and Track C's exact scope
  (Session C1/C2/C3). You are C1.
- docs/build-guide/session-25.md §0 (Locked L-1..L-13) and §0.1 (the questions Q1..Q8 you MUST resolve).
- docs/decisions/0016-governed-memory.md — §2 (the governance column block: source/confidence/
  observation_count/status/sensitivity/scope/last_confirmed_at/expires_at — these are the columns YOUR
  threshold gates on), §3.4 (performance_memory, named as "Track C's write target", ships EMPTY, plus the
  un-defer trigger and its Session 23-E RESOLVED note), §3.5 (MEM-VOICE-THROUGH-EXISTING — there is
  deliberately NO voice_memory table), §4 (the RLS + cascade pattern to copy), §5 (the lib/memory/
  boundary and MEM-NO-DIRECT-TABLE-ACCESS), and §10 (which names ADR 0018 as THE WRITER and assigns the
  promotion threshold to you).
- docs/decisions/0017-mode-2-upgrade.md — §2 (campaign_briefs: versioned, human-editable, the frozen
  brief), §3.2 (posts.role + MODE2-ROLE-WRITE-ONCE — the DB-trigger precedent for write-once), §4 (the
  format-family discriminated schemas — what "the AI's output" actually IS now), §9 (the [DATA]/
  sanitize evidence guard), and Amendment A.1 (the business_id-enforced citation-by-id boundary — the
  lever that makes "correction" checkable).
- CLAUDE.md — the AI-layer / DB-access / three-client / RLS + erasure-cascade / atomic-transition / Zod /
  i18n / bounded-query rules, the test-execution-integrity section (the three tiers,
  PROC-REVIEW-AT-COMMIT, and SHARED-FUNCTION CALLERS — which bites hard here), and the webhook/worker
  conventions.
- The real seams you are extending (let ecc:code-explorer map these, then cite its findings):
  lib/db/posts.ts (approvePost:320 and bulkApproveDraftPosts:526 — the atomic approval transitions and
  ALL their callers; updatePostContent:473 / updatePostContentAndMetadata:497 — where the human's edit
  lands; createPosts:288 — where a snapshot would be written); lib/campaigns/generate.ts (the
  orchestrator that authors the content); lib/publishing/orchestrator.ts:65,317 +
  lib/metrics/orchestrator.ts + lib/deletion/orchestrator.ts + lib/email/orchestrator.ts (the four tick
  patterns to copy: lazy service-role import, Sentry.withMonitor, ONE canonical JSON log line with
  triggeredBy, bounded claim, failure taxonomy); app/api/cron/publish/route.ts:13,99,106 (the QStash
  dual-mode route shape) and docs/runbooks/qstash-setup.md; lib/config.ts:28-64 (the tunable naming
  convention); lib/memory/index.ts + lib/db/memory-*.ts (the write path you must go THROUGH);
  lib/db/types.ts:320 (the PostUpdate exclusion set); docs/decisions/0010-legal-surface.md Amd 2 §D2.5
  (the erasure-cascade table — any new business-scoped table needs a row).

Do NOT write the ADR yet. First OUTPUT your answers to the eight §0.1 questions (Q1 ai_original
placement/shape/write-once/backfill, Q2 capture trigger + its enumerated callers + brief-diff scope,
Q3 diff algorithm + the dependency question, Q4 classification taxonomy + how the correction/preference
split is STRUCTURALLY enforced, Q5 memory write contract + the promotion threshold + decay, Q6 voice
learning without a voice table, Q7 worker topology/schedule/cost ceiling/idempotency, Q8 surfacing
scope), EACH with its named loser and its tier (L-10 agency tier + ADR 0015 test tier), AND a one-line
note on any place a §0 Locked decision constrains the answer. Then stop for acknowledgement. Do not
begin the ADR body until the eight answers are acknowledged.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 25. Write docs/decisions/0018-diff-based-learning-capture.md (Accepted). Ground
every claim in the real repo (cite file:line from ecc:code-explorer's map). Run your proposed schema past
database-reviewer, the PII/cascade and summarizer-injection paths past security-reviewer, the
correction/preference types past ecc:type-design-analyzer, and the summarization cadence/model/ceiling
past cost-aware-llm-pipeline (all read-only) and fold their objections into the ADR before you finalise.
The ADR MUST contain, at minimum:

1. Context + decision summary: what happens TODAY when a human edits an AI draft (updatePostContent
   overwrites posts.content in place; approvePost/bulkApproveDraftPosts flip status atomically; nothing
   is recorded, nothing is learned — cite it), why that is the problem (the edit is the highest-signal
   artefact a customer produces and it is discarded; memory can only ever be manually curated), and the
   snapshot → diff-at-approval → heuristic-classify → aggregate → promote design as the fix. Name the
   losers per §0 D-1..D-7.

2. The ai_original snapshot (Q1): placement (posts column vs snapshot table — decided, loser named), its
   SHAPE given ADR 0017's format-family structured output vs the flat posts.content text column, how the
   shape is versioned against future format families, the DB-level write-once enforcement (follow the
   MODE2-ROLE-WRITE-ONCE / MODE2-BRIEF-FROZEN-GUARD trigger precedent — cite 0017 §3.2), the backfill for
   existing rows, and the PostUpdate exclusion. State L-2 as the load-bearing invariant it is.

3. The capture hook (Q2): the exact transition(s) it attaches to, the mechanism (inline vs outbox vs
   re-scan — decided, loser named), approval-only vs approval+publish, and — mandatory — the ENUMERATED
   CALLER TABLE for approvePost and bulkApproveDraftPosts, one row per caller, stating which test file
   will cover each (CLAUDE.md SHARED-FUNCTION CALLERS; both Session 22 blockers were this exact function
   pair verified against only one of two callers). State whether campaign_briefs edits are captured too,
   or named as a follow-on.

4. The diff + heuristic classifier (Q3, Q4, L-5): the algorithm and the dependency decision (exact-pinned
   or in-repo — L-13), the determinism requirement, and the full signal taxonomy the Tier-0 heuristics
   emit (avoid-word removal, length delta, hashtag delta, CTA presence, thread-length change, link
   movement, …) with the exact rule for each. NO LLM call on this path.

5. Correction vs preference (Q4, L-6) — the section the Reviewer will read hardest: the rule that
   classifies an edit as a grounding correction (including the ADR 0017 lever: a deleted claim citing no
   pinned evidence id is checkable, not guessed — cite Amendment A.1), and the STRUCTURAL enforcement
   that makes a correction-tagged signal incapable of reaching a voice-directed write. Show the types.
   A runtime if is not enforcement — say so explicitly and say what you chose instead.

6. The batch summarization (L-5, L-10, Q7): what it summarizes, its cadence (per business per period,
   never per post), its model tier and per-business cost ceiling, its [DATA]-wrapped + sanitized input
   handling (human-edited copy entering an LLM is a NEW data-flow direction here — cite 0017 §9's guard),
   and its bounded output contract. Tier 1. No Tier 2, no Tier 3 anywhere in this track — say so.

7. The memory write + promotion (Q5, L-7, L-9): the exact performance_memory row shape written with
   source='distilled', status='candidate'; the PROMOTION THRESHOLD as a named ADR constant (the number
   the strategy docs left to you), what it gates on (observation_count / confidence — ADR 0016 §2), the
   atomic UPDATE that performs it, decay/contradiction handling (last_confirmed_at / expires_at), and the
   explicit confirmation that ADR 0016 §3.4's un-defer trigger is DISCHARGED (Session 23-E) — the
   distilled writer omits likes/impressions and carries observation_count as the credibility signal.
   Everything goes THROUGH lib/db/memory-* + lib/memory/ (MEM-NO-DIRECT-TABLE-ACCESS).

8. Voice learning without a voice table (Q6, L-9): the decision, its loser, and — if it amends ADR 0016
   or ADR 0011 — that fact stated plainly with the amendment named. Auto-mutating the user's brand_voices
   rows from an inference is a STOP unless the founder ratified it; if you propose it, say so in those
   words and mark it as requiring adjudication.

9. Worker topology (Q7, L-8): which existing tick it copies and where it deviates (deviations are
   findings, not choices), the claim mechanism, the config tunables with names + defaults matching the
   lib/config.ts convention, the failure taxonomy, the Sentry.withMonitor + single canonical JSON tick
   log, the QStash POST route + schedule + runbook row, and — critically — the IDEMPOTENCY mechanism
   that makes a replayed tick change nothing (a double-counted diff silently inflates confidence and
   promotes a pattern observed once).

10. GDPR + PII (L-11): every new business-scoped table's RLS (InitPlan-wrapped form), its ON DELETE
    CASCADE, its ADR 0010 Amd 2 §D2.5 cascade row, and purge_business coverage. If the snapshot is a
    posts column, state that it inherits posts' cascade and cite it. Fold in security-reviewer's findings.

11. Surfacing (Q8): pipeline-only / read-only panel / approve-a-suggestion — decided. If any UI: Server
    Component page + Client form split, Zod-validated Server Actions, i18n en/pt/es, shadcn v4 / Base UI,
    and a note that impeccable + taste-skill govern its bar. If none: the follow-on session named, AND
    how a founder verifies in production that the loop is learning.

12. Test plan mapped to the three tiers (ADR 0015 §2): Tier-1 DB-behaviour (supabase/__tests__, live
    Postgres) for the write-once trigger, any new table's RLS + cascade, the atomic promotion UPDATE, and
    the idempotency constraint; Tier-2 app-layer for the diff/heuristic classifier, the
    correction/preference split, the threshold arithmetic, the worker's tick outcomes (incl. a replayed
    tick), and the enumerated approval callers; any Tier-3 diff-verified property enumerated AS SUCH so
    "no test" is a recorded decision. Follow SHARED-FUNCTION CALLERS for everything touching
    approvePost / bulkApproveDraftPosts / createPosts.

13. A constraint table: every named constraint (LEARN-*), its agency tier (L-10), its test tier (ADR
    0015), and the test that will prove it — this is the Reviewer's checklist. Cover at least:
    LEARN-SNAPSHOT-WRITE-ONCE, LEARN-SNAPSHOT-SEPARATE, LEARN-CAPTURE-AT-TRANSITION,
    LEARN-CAPTURE-ALL-CALLERS, LEARN-HEURISTIC-FIRST (no LLM on the per-post path),
    LEARN-CORRECTION-PREFERENCE-ENFORCED, LEARN-NO-SINGLE-DIFF-PROMOTION, LEARN-PROMOTION-THRESHOLD,
    LEARN-TICK-IDEMPOTENT, LEARN-MEMORY-THROUGH-BOUNDARY, LEARN-SUMMARY-DATA-GUARDED,
    LEARN-MODE-AGNOSTIC, LEARN-VOICE-NOT-AUTO-MUTATED, and (if a new table) LEARN-RLS-ISOLATED +
    LEARN-CASCADE-COMPLETE.

14. Explicit "deferred to later tracks/phases" section: Mode 1 Studio, Mode 3 (mining / insight cards /
    opportunity feed), relationship_memory, embeddings, the skip-review fast path (name that THIS track
    produces the edit-distance evidence that would later justify it, and still does not build it), and
    anything Q2/Q6/Q8 pushed to a follow-on — so the boundary is on the record and a future session
    doesn't build them here by mistake.

Do NOT write code. End with one line: "ADR 0018 written and accepted — <n> LEARN-* constraints, snapshot
as <column|table>, capture via <inline|outbox|rescan>, promotion threshold <value>, voice learning
<option>, surface <shipped|deferred>." Then /exit.
```

**Gate:** do not proceed to §2 until `docs/decisions/0018-diff-based-learning-capture.md` exists, is
Accepted, and its eight §0.1 answers are on the record. If founder review of the ADR surfaces defects,
record them as a `§0.1-style corrections` block appended here before the Builder starts — exactly as
Sessions 22/23/24 did. **Then author §2/§3/§4 below from the accepted ADR's real `LEARN-*` constraints.**

---

## §2 — Builder session (C2)  ·  (paste into Claude Code · Sonnet)

Runs **only after ADR 0018 is accepted** (it is — status Accepted, 2026-07-25). **Ten steps**
(C2.0…C2.9), dependency-ordered, each a self-contained `/ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait for acknowledgement, then paste
C2.0…C2.9 one at a time**, letting each go green + commit before the next.

Hard rules inherited by every step: §0 L-1..L-13 + §0.2's three founder adjudications (A-1 the
enqueue-only trigger, A-2 the render guard in scope, A-3 `pattern_key` as ADR 0016 Amendment B).
**No Mode 1 Studio, no Mode 3 / mining / insight cards, no `relationship_memory`, no embeddings, no
skip-review fast path, no brief-edit capture, no voice table, no `brand_voices` mutation, no user-facing
surface, no new runtime dependency, and no change to generation behaviour.** If a step appears to need
one, **STOP and report** — it contradicts ADR 0018 §15 and §0 L-1.

**ADR 0018 decisions the Builder transcribes (do NOT re-derive, "improve", or re-litigate — the ADR
resolved every one against a named loser, and §14 lists 28 advisory findings already folded in):**

- **`post_ai_originals`** (ADR §2.2–§2.3): a **new table**, not a `posts` column — append-only, one row
  per AI-authorship event, `UNIQUE (post_id, revision)`, carrying **both** `payload jsonb` (the
  `SinglePostOutput | ThreadOutput` verbatim) **and** `rendered_content text` (what `joinContent()`
  produced). `business_id` cascades from **`businesses`**, never through `campaign_id`. `schema_version`
  written from `AI_ORIGINAL_SCHEMA_VERSION = 1`. **No backfill — the table ships empty**; a
  snapshot-less post is **skipped and counted**, never errored. **`PostUpdate` is NOT changed** (§2.6).
- **Write-once is `BEFORE UPDATE` ONLY — never `BEFORE DELETE`** (ADR §2.5, `[db-BLOCKER-1]` /
  `[sec-HIGH-1]`). A `BEFORE DELETE` `RAISE` fires on FK-cascade deletes identically to direct ones and
  would abort `purge_business`, making **every business that ever generated a post un-erasable**.
  App-layer immutability comes from **no authenticated DELETE policy** (the `email_outbox` posture).
  Adding a DELETE guard here is a BLOCKER-grade regression, not a hardening.
- **`post_edit_signals`** (ADR §3.3): the outbox. `ai_original_id` is **`NOT NULL`**, and the enqueue
  trigger carries an explicit *"no latest snapshot → RETURN without enqueuing"* branch (`[db-MAJOR-1]` —
  without both, either the approve transaction hard-fails or the dedup contract dissolves on NULLs).
  `UNIQUE (post_id, ai_original_id)`; the three index shapes in §3.3 **verbatim**.
- **The enqueue trigger is enqueue-ONLY** (`LEARN-TRIGGER-ENQUEUE-ONLY`, §0.2/A-1): `AFTER UPDATE` on
  `posts`, one INSERT of ids + frozen `NEW.content` / `NEW.hashtags`, **no diffing, no text processing,
  no network, no memory writes**. The transition guard lives **in the function body**
  (`IF OLD.status='draft' AND NEW.status='approved'`), not in a `WHEN` clause (`[sec-LOW-2]`), matching
  `20260702120300_posts_role_aware_and_status_trigger.sql:70-72`. `SECURITY DEFINER`, per the
  `ensure_owner_membership` precedent.
- **`pattern_key` is ADR 0016 Amendment B** (§7.2, §0.2/A-3): one additive column on
  `performance_memory` + `CHECK (source <> 'distilled' OR pattern_key IS NOT NULL)` (`[db-MAJOR-2]` —
  without it, NULL keys never dedupe and stay frozen at their initial counts forever) + the partial
  UNIQUE `(business_id, dimension, coalesce(platform,''), pattern_key) WHERE source='distilled' AND
  deleted_at IS NULL`. **Every `ON CONFLICT` must repeat that predicate** — a bare `ON CONFLICT (cols)`
  does not resolve to a partial index. The **amendment text is appended to ADR 0016**, append-only;
  ADR 0018 cites it, not the reverse.
- **`LEARN-VOICE-WRITE-TRIGGER` is the actual enforcement of the correction/preference split**
  (§5.3, `[type-4]`): a trigger on `performance_memory` that, for any `source='distilled'` write with
  `dimension IN ('format','hook')`, joins back to the contributing `post_edit_signals` and `RAISE`s if
  **any** carries `class <> 'preference'`. A service-role `if` that re-derives the class is **theatre** —
  the ADR says so in those words. Do not ship the `if` instead.
- **No diff library** (§4.1, L-13): in-repo deterministic deltas; sentence-level set difference for claim
  removal. Adding `diff` / `diff-match-patch` is a **STOP**, not a judgement call.
- **The classifier returns a PARTITIONED result**, never a flat `Signal[]` (§5.3): `{ preferences,
  corrections, inconclusive }`, three interfaces with a `readonly _class` literal (the **primary**
  discriminant) plus disjoint `Kind` vocabularies (the documented **fallback**). No index signature on
  any of the three; no field widened to `string`. Eleven signal kinds, exact rules in §4.2.
- **`LEARN-CORRECTION-REQUIRES-BRIEF`** (§5.2): the `unsourced_claim_removed` check **only runs when a
  frozen brief with a non-empty `pinnedEvidence` set exists**. Without that guard, a post with no brief
  makes "no evidence supports this claim" trivially true for every claim and the system floods itself
  with false corrections. **Absence of evidence is not evidence of hallucination.**
- **Promotion is three gates, all of which must hold** (§7.3): `observation_count ≥ 5` **AND**
  `confidence ≥ 0.70` **AND** `COUNT(DISTINCT campaign_id) ≥ 2`. `confidence = min(0.95, net/(net+2))`,
  `net = observations − contradictions`. `K = 2` deliberately (K = 3 makes `MIN_OBSERVATIONS`
  unreachable and the constant a lie). One atomic conditional `UPDATE`; demotion below
  `LEARN_DEMOTION_NET = 3` carries the **same** `.eq('status','active')` guard (`[db-MINOR-3]`).
- **`observation_count` is RECOMPUTED from the signal rows, never incremented** (§9.6). This is the
  single most important line in the worker: an increment can be replayed, a recompute cannot. Any
  `+ 1` on a count in this track is a correctness bug.
- **Worker copies `runEmailDrainTick`** (§9.1) — lazy service-role import, `Sentry.withMonitor` (slug
  `capture-learning`), **one** canonical `console.log(JSON.stringify({ kind: 'learning.tick', … }))`,
  `claim_post_edit_signals` RPC with `FOR UPDATE SKIP LOCKED`, the transient/permanent taxonomy from
  `lib/deletion/orchestrator.ts:20-34`. **Do not copy `runJanitorTick`'s missing `withMonitor` wrap** —
  the ADR names that gap explicitly so it is not silently inherited.
- **Summarization is gated by a two-gate floor** (§6.2): `≥ 20` new signals **AND** `≥ 7` days since the
  last summary → at most weekly per business, frequently never. Haiku 4.5, single fixed tier (the named
  `[cost-1]` deviation from the routing pattern), `≤ 12000` input tokens (**truncate, not warn**),
  `≤ 8` calls per business per month counted from `ai_usage`. **One business per LLM call**, every query
  explicitly `business_id`-filtered (§10.3) — the service-role client bypasses RLS, so the query *is* the
  boundary.
- **The three render sites are guarded EARLY** (§10.4, §0.2/A-2): `post-generation.ts:158`,
  `formats/native-generation-prompt.ts:158-163`, `post-regeneration.ts:139` route `topContent` through
  the shared `neutralize()`. **Bounded to exactly those three + the shared helper** — no opportunistic
  sweep, and **no** consolidation of the five duplicated `sanitizeDataField` copies (`[sec-LOW-3]`,
  declined as out of scope).
- **Pipeline-only** (§11): no route under `app/[locale]/(dashboard)`, **no new i18n keys**. Production
  verifiability comes from the tick log, `scripts/learning-report.ts`, and the Sentry monitor.

**ECC specialists by step (invoked proactively, at the point the mistake is made — not saved for
review):**

| Step | Spine | Specialist pulled in | Why here |
|---|---|---|---|
| C2.0 | — (no code) | `ecc:code-explorer` | re-ground every ADR premise; a drifted `file:line` invalidates the step that depends on it |
| C2.1 | plan → tdd → verify | `security-reviewer` | the render guard is the §10.4 injection close-out; it must land before the writer exists |
| C2.2 | plan → tdd → verify | `database-reviewer` + `supabase:supabase-postgres-best-practices` | two new tables, three triggers, an RPC, RLS, cascade — the `[db-BLOCKER-1]` class of mistake is made here or not at all |
| C2.3 | plan → tdd → verify | `database-reviewer` | the partial UNIQUE + `ON CONFLICT` predicate match, and the voice-write trigger that *is* the L-6 enforcement |
| C2.4 | plan → tdd → verify | `typescript-reviewer` + `ecc:silent-failure-hunter` | the L-2 snapshot write; a silently-skipped snapshot loses ground truth forever |
| C2.5 | plan → tdd → verify | `ecc:type-design-analyzer` + `typescript-reviewer` | the partitioned return is the type-design core of the track (§5.3) |
| C2.6 | plan → tdd → verify | `database-reviewer` + `ecc:silent-failure-hunter` | recompute-not-increment, the atomic promotion/demotion, `pattern_key` determinism |
| C2.7 | plan → tdd → verify | `ecc:cost-aware-llm-pipeline` + `security-reviewer` | the only LLM call in the track: cadence, ceiling, and human-edited copy entering a prompt |
| C2.8 | plan → tdd → verify | `ecc:code-reviewer` + `ecc:silent-failure-hunter` | the tick + cron route; a swallowed error here loses the signal and nobody finds out |
| C2.9 | verify only | `ecc:pr-test-analyzer` | does every `LEARN-*` test actually execute in a named CI job and redden if broken |

**Not in the step list, deliberately:** the placeholder's "C2.8 surface" step is **gone** — Q8 resolved
**pipeline-only** (ADR §11), so a UI step here would be an L-1 scope breach. `impeccable` / `taste-skill`
are **not** invoked anywhere in this track.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 25 — Diff-Based Learning Capture, BUILDER phase. You transcribe ADR 0018 into: the render guard,
two schema migrations, the snapshot writer, the Tier-0 classifier, the memory writer + promotion job,
the Tier-1 batch summarizer, and the tick orchestrator + cron route — across ten steps (C2.0…C2.9). You
are not the designer: ADR 0018 is authoritative, as scoped by session-25.md §0 / §0.1 / §0.2.

Read now, before anything else:
- docs/decisions/0018-diff-based-learning-capture.md — the WHOLE ADR. Its §13 table of 21 LEARN-*
  constraints is half your acceptance checklist; §12 is the test plan mapped to the three tiers; §14
  lists 28 advisory findings ALREADY folded in (do NOT re-open them); §15 is the deferred boundary.
- docs/build-guide/session-25.md §0 (Locked L-1..L-13) + §0.1 (the eight resolved questions) + §0.2 (the
  three founder adjudications — A-1 enqueue-only trigger, A-2 render guard IN SCOPE, A-3 pattern_key as
  ADR 0016 Amendment B) + §2 (this section: the concrete decisions list above, the step list, the
  specialist table) — BINDING scope.
- docs/decisions/0016-governed-memory.md — §2 (the governance column block your threshold gates on),
  §3.4 (performance_memory — you are writing its FIRST writer), §3.5 (MEM-VOICE-THROUGH-EXISTING — there
  is NO voice table and you do not create one), §4 (the RLS + cascade pattern), §5 (the lib/memory/
  boundary, MEM-NO-DIRECT-TABLE-ACCESS), §10 (the deferral you are closing).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three tiers. Triggers / RLS / cascade /
  the claim RPC / the atomic promotion are Tier-1 (supabase/__tests__, LIVE Postgres, db-tests.yml); the
  classifier / threshold arithmetic / tick outcomes / render guard are Tier-2 (lib/**, app/**,
  app-tests.yml). "Covered" = executed green in CI, never "authored". SHARED-FUNCTION CALLERS:
  enumerate every caller of a shared function and state the covering test PER CALLER before marking any
  constraint tested.
- CLAUDE.md — RLS + erasure-cascade rules, the three Supabase client roles + lazy service-role import,
  atomic conditional UPDATEs, bounded queries with explicit ORDER BY, Zod on all inputs, date-fns, no
  any / no console.* outside the one canonical tick log, env only via lib/config.ts.
- The real seams, at HEAD: lib/campaigns/generate.ts (joinContent :50-55, GeneratedItem.output :57-65,
  createPosts call :362); lib/db/posts.ts (createPosts :288-298, approvePost :320-340, updatePostContent
  :473-489, updatePostContentAndMetadata :497-517, bulkApproveDraftPosts :526-544 — returns a COUNT
  only); lib/email/orchestrator.ts (the tick you copy) + supabase/migrations/20260607100000_email_outbox
  .sql (the outbox + claim RPC + no-DELETE-policy posture); lib/deletion/orchestrator.ts:20-34 (the
  failure taxonomy); app/api/cron/publish/route.ts:13,99,106 (the dual-mode route); lib/config.ts:28-64
  (the tunable naming convention); lib/ai/wrap-evidence.ts:83-111 (neutralize()); lib/memory/index.ts +
  lib/db/memory-*.ts (the boundary you write THROUGH); docs/decisions/0010-legal-surface.md Amd 2 §D2.5.

ECC posture: run every step through /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop, AND invoke
the step's named specialist (session-25.md §2 table) at authoring time. Follow CLAUDE.md's tsc/vitest
invocation notes exactly (tsc --noEmit --skipLibCheck; scoped vitest run; npm run test:db for Tier-1).

Do NOT write code yet. Confirm these grounding facts (a wrong one is a STOP — it means the ADR drifted
against the repo and the step depending on it must not be built until reconciled):
(1) purge_business root-deletes at 20260702120700_purge_business_member_delete.sql:62 and has NO
    EXCEPTION block in its body. Cite both. This is WHY the write-once trigger is BEFORE UPDATE only.
(2) bulkApproveDraftPosts returns a COUNT, not ids (lib/db/posts.ts:543) — cite it. This is why capture
    is a trigger, not inline.
(3) updatePostContent's guard is .in('status', ['draft','approved']) (lib/db/posts.ts:482) — cite it.
    This is why the trigger FREEZES human_content into the outbox row instead of the worker re-reading
    posts.content at claim time.
(4) neutralize() exists and is exported at lib/ai/wrap-evidence.ts:83-111, and topContent is rendered
    UNGUARDED at lib/ai/prompts/post-generation.ts:158 and formats/native-generation-prompt.ts:158-163,
    and weakly at post-regeneration.ts:139. Cite all four.
(5) lib/db/memory-*.ts contains NO writer function today, and performance_memory ships EMPTY
    (20260719010000_governed_memory.sql:197-203). Cite it.
(6) PerformancePattern's likes/impressions are OPTIONAL (lib/memory/performance.ts:11-23, Session 23-E
    6149535f) — so the distilled writer OMITS them and never invents 0.
(7) package.json has NO diff library (dependencies :22-79). Cite it. Adding one is a STOP.
Output the seven findings + "Ready for C2.0." Then stop.
```

### §2b — Builder steps

#### C2.0 — Grounding pass: re-verify every ADR premise against the live repo  ·  no code, no commit

```
BUILDER — Session 25 · C2.0. NO CODE. Run ecc:code-explorer over the seams below and produce a
premise → file:line → still-true? table. ADR 0018 cites ~40 exact locations; if any has drifted, the
step that depends on it does not get built until the drift is reconciled and recorded here.

VERIFY these ADR premises specifically (each one is load-bearing for a later step):
- §2.6 the snapshot write point: generate.ts:362 createPosts call site, GeneratedItem.output :57-65
  (field at :62), joinContent :50-55 — and the regenerate path regeneratePostAction
  (campaigns/[id]/posts/actions.ts:320) → updatePostContentAndMetadata (posts.ts:497-517).
- §3.4 the SIX caller rows: approvePostAction (posts/actions.ts:94), approvePostFromCalendarAction
  (calendar/actions.ts:280), bulkApprovePostsAction (posts/actions.ts:218), PostsClient.tsx:133,
  ApprovalsInbox.tsx:123, generatePostsForCampaign (generate.ts:362). git grep each — an ADR row that
  no longer resolves is drift, and a caller the ADR does NOT list is a SHARED-FUNCTION CALLERS gap you
  must report before building.
- §9.1 the runEmailDrainTick elements (lib/email/orchestrator.ts:32,46,49-50,55,146-152) and the claim
  RPC shape (20260607100000_email_outbox.sql:49-64), plus the no-authenticated-DELETE-policy posture
  (:41-43).
- §10.1 the InitPlan RLS form `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` at
  20260719010000_governed_memory.sql:232-257 — this is the form you copy; the bare
  `= ANY (public.get_user_business_ids())` form is SUPERSEDED and evaluates once PER ROW ([db-NIT-1]).
- §5.2 CampaignBriefContent.pinnedEvidence[].evidenceMemoryId and getEvidenceMemoryByIds' business_id
  filter (ADR 0017 Amendment A.1) — the lever the correction rule depends on.
- §7.1 the performance_memory column list (20260719010000_governed_memory.sql:205-231) and its partial
  retrieval index (:232-234) — retrieval returns `active` only.

OUTPUT: the premise table, any drift found (with the affected step named), and "Ready for C2.1." Do NOT
commit. Then stop.
```

#### C2.1 — `LEARN-PATTERN-RENDER-GUARDED`: three render sites through the shared `neutralize()`  ·  ADR §10.4, §0.2/A-2

```
BUILDER — Session 25 · C2.1. FIRST, and deliberately so: §0.2/A-2 requires that there be NO commit range
in which the distillation writer is live and the render guard is not. This is a small, self-contained
security close-out that must precede every other step. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke security-reviewer WHILE authoring.

BUILD (ADR §10.4 — bounded to EXACTLY these three sites + the shared helper):
- lib/ai/prompts/post-generation.ts:158 — route p.topContent through the shared neutralize()
  (lib/ai/wrap-evidence.ts:83-111). It is currently placed inside a [DATA] fence with NO sanitization,
  while a NEIGHBOURING field in the same template gets sanitizeDataField (:169).
- lib/ai/prompts/formats/native-generation-prompt.ts:158-163 — same, currently unguarded.
- lib/ai/prompts/post-regeneration.ts:139 — currently the WEAK local sanitizeDataField; upgrade to the
  shared neutralize().
- Decide PER CALL SITE, explicitly (ADR §10.4 requires the decision, not a default): bare neutralize()
  vs the full [DATA]-wrap + length cap. Weigh what the surrounding template already frames and that a
  cap is also a COST control — a hostile 50KB "pattern" would otherwise eat the prompt budget. State
  your choice and its reason in the commit message.

DO NOT:
- Sweep any other prompt field (ADR §10.4: anything else found is a separate finding, FILED not fixed).
- Consolidate the five duplicated sanitizeDataField copies ([sec-LOW-3], declined as out of scope).
- Change any output for input that was already benign — neutralize() is byte-identity-preserving on
  benign input (§0.2/A-2), so ADR 0017's MODE2-CONTEXT-EQUIVALENT fixtures must stay green UNTOUCHED.

TESTS (Tier-2): for EACH of the three sites, a hostile pattern string bearing a [/DATA] closer, a
triple-backtick fence, an invisible Cf character and a leading `{` is neutralised in the rendered
prompt; and a benign pattern renders BYTE-IDENTICALLY to before. SHARED-FUNCTION CALLERS applies to
neutralize() itself now — it gains three callers; publish the per-caller → test-file table.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app (incl. the existing MODE2-CONTEXT-EQUIVALENT
suites — any edit needed there is a behaviour change → STOP and show it). security-reviewer clean.
On commit: "C2.1 complete — recentPostPerformance.topContent routed through the shared neutralize() at
all three render sites (LEARN-PATTERN-RENDER-GUARDED, ADR 0018 §10.4 / [sec-HIGH-2]); <bare|wrapped+cap>
per site, rationale recorded; MODE2-CONTEXT-EQUIVALENT untouched and green; neutralize() caller table
published." Then stop.
```

#### C2.2 — Migration A: `post_ai_originals` + `post_edit_signals` + triggers + claim RPC + RLS + cascade  ·  ADR §2, §3, §9.3, §10  ·  LEARN-SNAPSHOT-SEPARATE, -SNAPSHOT-WRITE-ONCE, -CAPTURE-AT-TRANSITION, -CAPTURE-ALL-CALLERS, -MODE-AGNOSTIC, -TRIGGER-ENQUEUE-ONLY, -RLS-ISOLATED, -CASCADE-COMPLETE

```
BUILDER — Session 25 · C2.2. Migration + Tier-1 DB tests + the minimal lib/db/types.ts row types ONLY.
No classifier, no worker, no writer yet. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.
Invoke database-reviewer AND the supabase:supabase-postgres-best-practices skill WHILE authoring — the
[db-BLOCKER-1] class of mistake is made here or not at all.

BUILD — supabase/migrations/<ts>_learning_capture.sql:
- post_ai_originals EXACTLY per ADR §2.3: id uuid PK; business_id uuid NOT NULL REFERENCES
  public.businesses(id) ON DELETE CASCADE; post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE
  CASCADE; campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE; revision int
  NOT NULL DEFAULT 1 CHECK (revision >= 1); generation_kind text NOT NULL CHECK IN
  ('initial','regeneration'); format text NOT NULL CHECK IN ('single','thread'); payload jsonb NOT NULL;
  rendered_content text NOT NULL; hashtags text[] NOT NULL DEFAULT '{}'; schema_version int NOT NULL;
  created_at timestamptz NOT NULL DEFAULT now(). UNIQUE (post_id, revision). NO updated_at and NO
  set_updated_at() trigger — the row is immutable, so an updated_at column would be a lie.
- ⚠️ WRITE-ONCE TRIGGER: BEFORE UPDATE **ONLY**, rejecting ANY update unconditionally. **NEVER add OR
  DELETE.** [db-BLOCKER-1]/[sec-HIGH-1]: a child BEFORE DELETE trigger fires on FK-cascade deletes
  identically to direct ones; purge_business (…_purge_business_member_delete.sql:62) has NO EXCEPTION
  block, so the cascade would abort GDPR erasure for every business that ever generated a post. There is
  no way to distinguish a cascade DELETE from a direct one inside the trigger — do not try.
- post_edit_signals EXACTLY per ADR §3.3, with ai_original_id uuid **NOT NULL** REFERENCES
  post_ai_originals(id) ON DELETE CASCADE; human_content text NOT NULL; human_hashtags text[] NOT NULL
  DEFAULT '{}'; approved_at timestamptz NOT NULL; status text NOT NULL DEFAULT 'pending' CHECK IN
  ('pending','processing','processed','failed','abandoned'); attempts/next_attempt_at/last_error/
  processed_at; class text CHECK (class IS NULL OR class IN ('preference','correction','inconclusive'));
  pattern_key text; signals jsonb; created_at/updated_at (+ the shared set_updated_at trigger).
  UNIQUE (post_id, ai_original_id).
- Indexes per §3.3 VERBATIM: claimable partial (next_attempt_at) WHERE status='pending'; the covering
  partial (business_id, pattern_key) INCLUDE (campaign_id) WHERE status='processed'; explicit FK indexes
  on ai_original_id and campaign_id (NEITHER is implied by the UNIQUE, which leads on post_id); plain
  business_id + campaign_id indexes on post_ai_originals.
- ⚠️ ENQUEUE TRIGGER (LEARN-TRIGGER-ENQUEUE-ONLY): AFTER UPDATE ON posts FOR EACH ROW, SECURITY DEFINER.
  Body = the transition guard `IF OLD.status='draft' AND NEW.status='approved' THEN` ([sec-LOW-2] — in
  the BODY, not a WHEN clause), then SELECT the latest post_ai_originals revision; **if none, RETURN
  without enqueuing** ([db-MAJOR-1] — a snapshot-less or manual-origin post must NOT fail the approve);
  else INSERT ONE row copying NEW.content + NEW.hashtags, ON CONFLICT (post_id, ai_original_id) DO
  UPDATE … WHERE post_edit_signals.status = 'pending'. NOTHING ELSE. No diffing, no text processing, no
  network, no memory writes. That is the bright line (§0.2/A-1).
- RLS on BOTH tables: ENABLE, then the four policies TO authenticated in the InitPlan form
  `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` copied from governed_memory.sql
  :232-257 — SELECT / INSERT WITH CHECK / UPDATE with BOTH USING and WITH CHECK / DELETE. ⚠️ The bare
  `= ANY (public.get_user_business_ids())` form is SUPERSEDED and evaluates per row ([db-NIT-1]).
  **EXCEPTION: post_ai_originals gets NO authenticated DELETE policy** — that is the app-layer half of
  write-once (§2.5, the email_outbox posture at 20260607100000_email_outbox.sql:41-43).
- claim_post_edit_signals(p_batch_size int) — copy claim_email_outbox (…email_outbox.sql:49-64) in
  shape: FOR UPDATE SKIP LOCKED, pending→processing, bounded, ORDER BY next_attempt_at against the
  claimable index. SECURITY DEFINER; REVOKE ALL FROM public; GRANT EXECUTE TO service_role.
- Comment the multi-parent cascade (business_id + post_id + campaign_id) as INTENTIONAL defense in
  depth ([db-NIT-2]).
- docs/decisions/0010-legal-surface.md Amd 2 §D2.5: add TWO rows (post_ai_originals, post_edit_signals),
  ANNOTATED as holding customer / third-party quote content ([sec-MEDIUM-1]) exactly as evidence_memory's
  row is (:1067). A business-scoped table with no §D2.5 row is a STOP.
- lib/db/types.ts: PostAiOriginalRow/Insert + PostEditSignalRow/Insert. **PostUpdate is NOT changed**
  (ADR §2.6 — stated explicitly so no speculative Omit is added).

TESTS — supabase/__tests__/learning-capture-*.test.ts, Tier-1, LIVE Postgres:
- Any UPDATE on post_ai_originals is rejected by the trigger (LEARN-SNAPSHOT-WRITE-ONCE).
- ⚠️ ERASURE **SUCCEEDS**: deleting a business that has rows in BOTH tables COMPLETES WITHOUT ERROR and
  purges them. Assert SUCCESS, not merely absence — the [db-BLOCKER-1] failure mode was erasure DENIAL,
  and a rows-are-gone assertion inside an already-aborting transaction is never reached.
- RLS on both tables: cross-tenant SELECT/INSERT/UPDATE/DELETE denied, USING **and** WITH CHECK proven.
- ⚠️ The capture trigger fires on a RAW `UPDATE posts SET status='approved'` issued from NO application
  code — this is the proof of LEARN-CAPTURE-ALL-CALLERS and LEARN-MODE-AGNOSTIC. Also: it does NOT fire
  on other posts UPDATEs (schedule change, publish counter); and it SKIPS a snapshot-less post WITHOUT
  failing the UPDATE.
- UNIQUE (post_id, ai_original_id) rejects a duplicate; re-approval REFRESHES a 'pending' row and leaves
  a 'processed' row untouched (LEARN-TICK-IDEMPOTENT layer 1). Cover unapprove→re-approve explicitly
  (§0.2/A-1 names it as a real duplicate-signal path).
- claim_post_edit_signals returns DISJOINT sets under concurrent calls.
- A bulk approve of N rows in ONE statement produces N outbox rows (§0.2/A-1's per-row firing).

VERIFY: apply the migration; npm run test:db over the new suites — Tier-1 proofs must EXECUTE against
real Postgres (a pg_policies read or a mocked client is NOT coverage, ADR 0015 §2) and the suite must
report a NON-ZERO executed count. Feed database-reviewer's findings back in; fix before commit.
On commit: "C2.2 complete — post_ai_originals + post_edit_signals, BEFORE-UPDATE-only write-once trigger
(NO delete guard — [db-BLOCKER-1]), enqueue-only AFTER UPDATE capture trigger, claim RPC, InitPlan RLS,
two §D2.5 cascade rows (LEARN-SNAPSHOT-SEPARATE, -SNAPSHOT-WRITE-ONCE, -CAPTURE-AT-TRANSITION,
-CAPTURE-ALL-CALLERS, -MODE-AGNOSTIC, -TRIGGER-ENQUEUE-ONLY, -RLS-ISOLATED, -CASCADE-COMPLETE); N Tier-1
tests green on live Postgres incl. erasure-SUCCEEDS; database-reviewer clean." Then stop.
```

#### C2.3 — Migration B: `performance_memory.pattern_key` (ADR 0016 Amendment B) + `LEARN-VOICE-WRITE-TRIGGER`  ·  ADR §7.2, §5.3

```
BUILDER — Session 25 · C2.3. The second migration + the ADR 0016 amendment text. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke database-reviewer WHILE authoring — the partial
UNIQUE / ON CONFLICT predicate match is the exact thing it catches and prose does not.

BUILD — supabase/migrations/<ts>_performance_memory_pattern_key.sql:
- ALTER TABLE performance_memory ADD COLUMN pattern_key text.
- ADD CONSTRAINT CHECK (source <> 'distilled' OR pattern_key IS NOT NULL) ([db-MAJOR-2]: without it,
  Postgres never dedupes on NULL, distilled rows accumulate one per tick, and because §9.6's recompute
  is scoped BY pattern_key they stay frozen at their initial counts forever — the feature appears to
  work and learns nothing). Existing rows are all source<>'distilled' (the table ships EMPTY), so the
  CHECK is satisfiable immediately — but state that in the migration rather than assuming it.
- CREATE UNIQUE INDEX … ON performance_memory (business_id, dimension, coalesce(platform,''),
  pattern_key) WHERE source = 'distilled' AND deleted_at IS NULL. coalesce(platform,'') is the
  ESTABLISHED idiom here (email_outbox_dedupe_uq, …email_outbox.sql:27-28) — do NOT introduce
  NULLS NOT DISTINCT as a second idiom ([db-Q5]).
- ⚠️ LEARN-VOICE-WRITE-TRIGGER (§5.3 / [type-4] — this trigger IS the L-6 enforcement; a service-role
  `if` that re-derives the class is theatre and the ADR says so in those words): a trigger on
  performance_memory that, for any INSERT or UPDATE with source='distilled' AND dimension IN
  ('format','hook'), joins back to the contributing post_edit_signals rows and RAISEs if ANY carries
  class <> 'preference'. It must hold regardless of which code path issues the write — a future
  promotion job, a manual backfill script, or an ad-hoc query.
- docs/decisions/0016-governed-memory.md: APPEND `## Amendment B` (append-only, as Amendment A was —
  §3.4's original text is NOT edited) recording the pattern_key column, the CHECK, the partial UNIQUE,
  and one line confirming RLS + erasure cascade are UNAFFECTED (additive column on an already-cascaded
  table; the four §D2.5 rows stand). ADR 0018 cites this amendment; the amendment does not cite back.

TESTS — Tier-1, live Postgres:
- A distilled INSERT with NULL pattern_key is REJECTED by the CHECK; a manual (source='manual') row with
  NULL pattern_key is ACCEPTED.
- Two distilled rows with the same (business_id, dimension, coalesce(platform,''), pattern_key) collide;
  a soft-deleted row does not block a new one (the predicate includes deleted_at IS NULL); a manual row
  with the same tuple does NOT collide (the predicate is source='distilled').
- LEARN-VOICE-WRITE-TRIGGER: a dimension='format' distilled write sourced from a class='correction'
  signal is REJECTED BY THE DB; the same write from a class='preference' signal succeeds; a
  dimension='topic' correction-derived write succeeds (only format/hook are voice-directed).

VERIFY: npm run test:db; the suites report a non-zero executed count. database-reviewer clean.
On commit: "C2.3 complete — performance_memory.pattern_key + CHECK + partial UNIQUE (ADR 0016 Amendment
B appended, append-only) and LEARN-VOICE-WRITE-TRIGGER rejecting correction-sourced voice-directed
writes at the DB; N Tier-1 tests green." Then stop.
```

#### C2.4 — The snapshot write at generation time  ·  ADR §2.6  ·  L-2, LEARN-SNAPSHOT-SEPARATE (app half)

```
BUILDER — Session 25 · C2.4. The L-2 invariant's write side. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke typescript-reviewer AND ecc:silent-failure-hunter — a snapshot that
silently fails to write loses the ground truth of this entire track, permanently and invisibly.

BUILD (ADR §2.6):
- lib/db/post-ai-originals.ts: typed insert (and a getLatestRevision helper) — bounded, explicit
  ORDER BY revision DESC matching UNIQUE (post_id, revision). Through lib/db/ only; no direct Supabase
  call anywhere else.
- lib/campaigns/generate.ts: alongside createPosts (:362), write ONE post_ai_originals row per created
  post from the STRUCTURED GeneratedItem.output (:57-65, field at :62) — payload = the SinglePostOutput
  | ThreadOutput VERBATIM, rendered_content = exactly what joinContent() (:50-55) produced and what
  landed in posts.content, hashtags frozen, format = the family discriminant, generation_kind='initial',
  revision=1, schema_version = AI_ORIGINAL_SCHEMA_VERSION. createPosts returns the full PostRow[]
  (posts.ts:293-295), so post_ids are available WITHOUT a re-query.
- The regenerate path (regeneratePostAction → updatePostContentAndMetadata, posts.ts:497-517): write
  revision + 1 with generation_kind='regeneration'. ⚠️ [db-MINOR-1]: computing the next revision
  client-side races under concurrent regenerations, so catch Postgres 23505 and retry — the same
  duplicate-detection convention CLAUDE.md's Webhook Handlers section establishes. A 23505 here is SAFE
  (the constraint rejected a write, nothing corrupted) but must not surface as an unexplained error.
- AI_ORIGINAL_SCHEMA_VERSION = 1 as an exported named constant (sibling to lib/memory/constants.ts) —
  never an inline literal.
- DO NOT touch PostUpdate's Omit set (ADR §2.6 — the exclusion is unnecessary for a separate table and a
  speculative one is a finding).

TESTS (Tier-2):
- The snapshot's rendered_content is byte-identical to what lands in posts.content for both format
  families; payload round-trips the discriminated union (a thread's posts[] survives, which is the whole
  reason the payload exists — §2.3).
- Regeneration writes revision 2 with generation_kind='regeneration' and leaves revision 1 intact; a
  simulated 23505 is retried, not surfaced.
- SHARED-FUNCTION CALLERS: git grep createPosts and generatePostsForCampaign; publish the per-caller →
  test-file table. A caller with no listed test is AUTHORED-NOT-EXECUTED for that caller.
- The snapshot write failing does NOT silently succeed (silent-failure-hunter): assert the error path.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. typescript-reviewer clean.
On commit: "C2.4 complete — post_ai_originals written at generation time from the structured output
(payload + rendered_content + hashtags frozen), revision+1 on regenerate with a 23505 retry
([db-MINOR-1]); AI_ORIGINAL_SCHEMA_VERSION=1; PostUpdate untouched; createPosts/generatePostsForCampaign
caller table published." Then stop.
```

#### C2.5 — `lib/learning/classify.ts`: the deterministic diff + the eleven-kind Tier-0 classifier + the correction/preference split  ·  ADR §4, §5  ·  LEARN-HEURISTIC-FIRST, -CLASSIFY-DETERMINISTIC, -CORRECTION-REQUIRES-BRIEF, -CORRECTION-PREFERENCE-ENFORCED

```
BUILDER — Session 25 · C2.5. The type-design core of the track — the section the Reviewer is explicitly
told to read hardest. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
ecc:type-design-analyzer AND typescript-reviewer WHILE authoring.

BUILD (ADR §4, §5):
- lib/learning/diff.ts — IN-REPO deterministic deltas per §4.1. ⚠️ NO diff library. Adding `diff` /
  `diff-match-patch` is an L-13 STOP, not a judgement call: length delta is .length on two frozen
  strings; hashtag delta is a set difference; thread length uses the FIXED '\n\n---\n\n' delimiter from
  generate.ts:50-55 (a contract, not a guess); claim removal is a sentence-level set difference (split
  on .!? + newline, normalise, subtract).
- lib/learning/classify.ts — classify(aiOriginal, humanFinal, voiceRules, pinnedEvidence) as a PURE
  function: no clock, no randomness, no network, NO LLM, no dependence on row order. Its output
  increments a confidence counter, so nondeterminism would make observation_count a random variable and
  every promotion unreproducible.
- The ELEVEN kinds with §4.2's exact rules: avoid_word_removed, length_delta (|Δ| ≥
  LEARN_LENGTH_DELTA_MIN_PCT = 0.15), hashtag_delta, cta_added/cta_removed, thread_shortened/
  thread_lengthened, link_moved, numbering_stripped, unsourced_claim_removed (correction),
  evidence_cited_claim_removed + avoid_word_added (inconclusive).
- ⚠️ THE PARTITIONED RETURN (§5.3) — `{ readonly preferences: readonly PreferenceSignal[]; readonly
  corrections: readonly CorrectionSignal[]; readonly inconclusive: readonly InconclusiveSignal[] }`.
  There must be NO `Signal[]` type anywhere in the codebase — the footgun L-6 names is a flat list
  someone forgets to filter, and it is structurally gone only if there is nothing to filter. `_class` is
  the PRIMARY discriminant; the disjoint Kind vocabularies are the documented FALLBACK ([type-2]). No
  index signature on any of the three interfaces; no field widened to `string`. Plain interfaces with a
  literal tag — house style; a #private-field class is REJECTED and the rejection is recorded ([type-3]).
- ⚠️ LEARN-CORRECTION-REQUIRES-BRIEF (§5.2): the unsourced_claim_removed check runs ONLY when a frozen
  brief with a NON-EMPTY pinnedEvidence set exists for the campaign. Without that guard every claim on a
  brief-less post is trivially "unsupported" and the system floods itself with false corrections.
  Absence of evidence is not evidence of hallucination — posts with no brief emit `inconclusive`, NEVER
  `correction`. Read the pinned set via getEvidenceMemoryByIds(businessId, ids), business_id-scoped per
  ADR 0017 Amendment A.1.
- avoid_words is read through lib/memory/voice.ts retrieveVoice (:22-37) — NEVER a direct brand_voices
  query (MEM-NO-DIRECT-TABLE-ACCESS).
- ⚠️ THE REHYDRATION CHOKE POINT ([type-5]): the function that reads persisted signal rows back into
  PreferenceSignal / CorrectionSignal shapes is the SECOND choke point and carries a runtime Zod
  .literal() guard. Name it as such in a header comment (mirroring wrapEvidenceForPrompt's
  "single shared choke point" comment at lib/ai/wrap-evidence.ts:114-131). Without a guard there,
  nothing else in §5.3 reaches the promotion path.
- Do NOT write "unrepresentable" anywhere. §5.3 is explicit: plain TS cannot make it unrepresentable,
  `as unknown as` defeats any encoding, and this codebase already walked back that exact overclaim in
  ADR 0017 Amendment A.2. Say what the layer does and does not close.

TESTS (Tier-2):
- A case table across ALL eleven kinds, each asserting the kind AND the partition it lands in.
- DETERMINISM: the same golden fixture pair evaluated TWICE yields byte-identical output.
- LEARN-HEURISTIC-FIRST: no LLM client is constructed on this path (assert it, don't claim it).
- LEARN-CORRECTION-REQUIRES-BRIEF: no brief → inconclusive; empty pinned set → inconclusive; a removed
  claim citing a pinned id → evidence_cited_claim_removed, not correction.
- ⚠️ A @ts-expect-error COMPILE-TIME assertion that passing result.corrections to the voice-directed
  writer's parameter DOES NOT COMPILE (the lib/db/types.test.ts convention at :91,95,116,138-143). This
  converts "a reviewer must notice someone widened kind to string" into "CI goes red".
- The rehydration guard rejects a row whose class does not match its kind vocabulary.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. type-design-analyzer + typescript-reviewer
clean.
On commit: "C2.5 complete — in-repo deterministic diff (no dependency, L-13) + eleven-kind Tier-0
classifier as a pure function; partitioned {preferences|corrections|inconclusive} return with no
Signal[] type; correction rule gated on a non-empty pinned-evidence set; rehydration choke point with a
Zod .literal() guard; @ts-expect-error compile assertion green (LEARN-HEURISTIC-FIRST,
-CLASSIFY-DETERMINISTIC, -CORRECTION-REQUIRES-BRIEF, -CORRECTION-PREFERENCE-ENFORCED TS half)." Then stop.
```

#### C2.6 — The memory writer + `pattern_key` derivation + promotion / demotion / decay  ·  ADR §7  ·  LEARN-MEMORY-THROUGH-BOUNDARY, -PROMOTION-THRESHOLD, -NO-SINGLE-DIFF-PROMOTION, -VOICE-NOT-AUTO-MUTATED

```
BUILDER — Session 25 · C2.6. performance_memory's FIRST writer (lib/db/memory-*.ts has none today) plus
the promotion arithmetic. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer AND ecc:silent-failure-hunter.

BUILD (ADR §7):
- lib/learning/pattern-key.ts — the deterministic slug from signal KIND + DIRECTION + PLATFORM, NEVER
  from the prose (prose varies; the phenomenon does not). ⚠️ This is the load-bearing detail of the
  whole track because BOTH failure directions are silent: fragmentation means observation_count never
  reaches threshold and NOTHING EVER PROMOTES while the feature appears to work; collision inflates
  confidence on a merge and promotes something observed once. A pure function with a determinism test.
- lib/db/memory-performance.ts — the distilled upsert: source='distilled', status='candidate',
  sensitivity='internal', public_use_permission=false, dimension per §7.1, scope/scope_ref per §7.1,
  pattern_key set. ⚠️ OMIT likes and impressions entirely — they are OPTIONAL on PerformancePattern
  since Session 23-E (6149535f) and observation_count is the credibility signal. Never invent 0.
  ⚠️ The ON CONFLICT target must REPEAT the partial index predicate — `ON CONFLICT (business_id,
  dimension, coalesce(platform,''), pattern_key) WHERE source='distilled' AND deleted_at IS NULL`. A
  bare ON CONFLICT (cols) does NOT resolve to a partial index.
- lib/learning/promote.ts — the constants as exported named values (§7.3), never scattered literals:
  LEARN_PROMOTION_MIN_OBSERVATIONS=5, LEARN_PROMOTION_MIN_CONFIDENCE=0.70,
  LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS=2, LEARN_CONFIDENCE_K=2, LEARN_CONFIDENCE_CEILING=0.95,
  LEARN_DEMOTION_NET=3, LEARN_PATTERN_TTL_DAYS=90.
  * ⚠️ observation_count is RECOMPUTED — COUNT(*) FROM post_edit_signals WHERE business_id=$1 AND
    pattern_key=$2 AND status='processed' — NEVER incremented (§9.6). An increment can be replayed; a
    recompute cannot. Any `+ 1` on a count in this track is a correctness bug.
  * confidence = min(0.95, net/(net+2)), net = observations − contradictions, 0 when net <= 0. At
    exactly 5 clean observations this is 0.714 — just clearing 0.70, so BOTH gates bind and neither is
    dead code. Do NOT "tidy" K to 3; that makes MIN_OBSERVATIONS unreachable and the constant a lie.
  * Promotion: ONE atomic conditional UPDATE guarded on status='candidate' AND observation_count>=5 AND
    confidence>=0.70 AND the distinct-campaign subquery >= 2. Read-then-update anywhere is a MAJOR.
  * Demotion: an active row whose net < 3 goes back to 'candidate' — NEVER deleted — with the SAME
    explicit .eq('status','active') guard ([db-MINOR-3]).
  * Decay: expires_at = last_confirmed_at + 90 days, refreshed on each reinforcing observation. No
    deletion job — ADR 0016 §2's retrieval already excludes expired rows.
- Everything through lib/db/memory-performance.ts + lib/memory/ (MEM-NO-DIRECT-TABLE-ACCESS). Bounded
  queries with an explicit index-matching ORDER BY and .is('deleted_at', null). date-fns formatISO.
- ⚠️ NOTHING writes to brand_voices or brand_voice_variations. Auto-mutating the user's own voice rows
  from an inference is an L-9 STOP the ADR explicitly does not propose (§8).

TESTS (Tier-2 unless noted):
- pattern_key determinism: the same phenomenon from two different prose statements keys IDENTICALLY;
  two distinct phenomena key DIFFERENTLY. Both directions, because both failures are silent.
- Threshold arithmetic at the boundary: 4 observations does NOT promote; 5 within ONE campaign does NOT
  promote; 5 across TWO campaigns DOES; a contradiction lowers confidence; net<3 demotes an active row.
- LEARN-NO-SINGLE-DIFF-PROMOTION: one diff never yields an active row; retrieval returns active only.
- The write omits likes/impressions and goes through the boundary (grep half of
  LEARN-MEMORY-THROUGH-BOUNDARY).
- No write path touches brand_voices / brand_voice_variations (LEARN-VOICE-NOT-AUTO-MUTATED).
- Tier-1 (add to supabase/__tests__): the promotion UPDATE promotes EXACTLY ONCE under concurrency;
  demotion likewise.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db for the concurrency suite.
database-reviewer clean.
On commit: "C2.6 complete — first performance_memory distilled writer (likes/impressions omitted,
observation_count RECOMPUTED not incremented), deterministic pattern_key, atomic promotion at
5 / 0.70 / 2 distinct campaigns + contradiction-aware confidence + demotion + 90-day decay
(LEARN-PROMOTION-THRESHOLD, -NO-SINGLE-DIFF-PROMOTION, -MEMORY-THROUGH-BOUNDARY,
-VOICE-NOT-AUTO-MUTATED); brand_voices untouched." Then stop.
```

#### C2.7 — `lib/learning/summarize.ts`: the Tier-1 batch summarizer  ·  ADR §6  ·  LEARN-SUMMARY-DATA-GUARDED

```
BUILDER — Session 25 · C2.7. The ONLY LLM call in this track. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke ecc:cost-aware-llm-pipeline AND security-reviewer WHILE authoring —
human-edited copy entering an LLM prompt is a NEW data-flow direction for this codebase.

BUILD (ADR §6):
- A Prompt in lib/ai/prompts/ + lib/learning/summarize.ts. Model: Haiku 4.5 (claude-haiku-4-5-20251001),
  a SINGLE fixed tier with no escalation — the named [cost-1] deviation from the routing pattern,
  because Tier-0 pre-aggregation caps the input by construction so an escalation threshold would be dead
  code. Record the deviation in the commit message; deviations are findings, not choices.
- ⚠️ THE TWO-GATE FLOOR (§6.2), both required: >= LEARNING_SUMMARY_MIN_SIGNALS (20) newly-processed
  signals since the last summary AND >= LEARNING_SUMMARY_MIN_INTERVAL_DAYS (7) elapsed. At most WEEKLY
  per business, frequently never. An LLM call per approved post is an L-1 STOP.
- Ceilings: LEARNING_SUMMARY_MAX_INPUT_TOKENS = 12000 — TRUNCATE, not warn (the posture ADR 0017 §9
  [sec-HIGH-1] adopted); LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS = 8, counted from the existing
  ai_usage table (service-role write per CLAUDE.md). The stable system prompt carries cache_control
  ephemeral (runner.ts:85-91 already applies it over 4096 chars).
- ⚠️ INPUT GUARD (LEARN-SUMMARY-DATA-GUARDED): human-edited excerpts go through the SHARED neutralize()
  (lib/ai/wrap-evidence.ts:83-111) at RENDER time — never authorship time (a later human edit re-enters
  the field after any one-time sanitize, so authorship-time sanitization is a bypass). NOT the weak local
  sanitizeDataField. Plus a HARD length cap before the model sees anything — append-only escaping is not
  a substitute for a shape cap.
- ⚠️ ONE BUSINESS PER CALL (§10.3): the worker runs service-role and BYPASSES RLS, so the query is the
  only boundary. Every input query filters explicitly on business_id; the output write takes business_id
  from THE SAME per-iteration variable the input was read with — never a shared or captured variable
  that could carry the previous iteration's value (the classic loop-capture leak, and the exact bug
  class Session 24-D's MAJOR-1 closed).
- Bounded output (§6.4): a Zod schema — at most LEARNING_SUMMARY_MAX_STATEMENTS (5) statements, each
  <= 200 chars, each carrying a dimension from ADR 0016 §3.4's fixed vocabulary. Parsed via
  safeParseOrAiError; a parse failure surfaces invalid_response and is retried per §9.4 — it NEVER falls
  through to an unvalidated write. Summarizer output gets NO shortcut into active: it writes `candidate`
  rows subject to the same threshold as Tier-0 statements.
- ⚠️ The bounded schema and render-time neutralisation are ORTHOGONAL controls ([sec-MEDIUM-3]) — 200
  chars is ample room for a short imperative, and the string re-enters generation prompts via
  performance_memory.pattern (which C2.1 guards). Do not conflate them or drop either.
- Tier 1 ONLY. No critique/regenerate loop, no agentic tool loop — no Tier 2 and no Tier 3 anywhere.

TESTS (Tier-2): each gate INDEPENDENTLY suppresses the call (19 signals + 8 days → no call; 25 signals
+ 3 days → no call; both pass → one call); the monthly ceiling blocks the call; input is
neutralize()-wrapped and truncated at the cap; the output schema rejects an over-long statement and an
over-count response; one business's input strictly cannot produce another business's write (§10.3) —
proven end-to-end, not by a unit test of the query builder.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. cost-aware-llm-pipeline + security-reviewer
clean.
On commit: "C2.7 complete — Tier-1 batch summarizer, Haiku 4.5 single fixed tier ([cost-1] deviation
recorded), two-gate floor (20 signals AND 7 days), 12k-token truncate + 8 calls/business/month ceiling,
neutralize()-guarded input at render time, bounded 5x200 Zod output writing candidate rows only
(LEARN-SUMMARY-DATA-GUARDED); per-business scoping proven end-to-end." Then stop.
```

#### C2.8 — `runLearningTick` + the QStash cron route + config tunables + runbook row  ·  ADR §9  ·  LEARN-TICK-IDEMPOTENT

```
BUILDER — Session 25 · C2.8. The worker that ties C2.5–C2.7 together. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:code-reviewer AND ecc:silent-failure-hunter — a
capture that fails silently loses the signal forever and nobody finds out.

BUILD (ADR §9 — copy runEmailDrainTick, lib/email/orchestrator.ts:32):
- lib/learning/orchestrator.ts exporting runLearningTick({ triggeredBy }): lazy createServiceRoleClient
  import (:49-50); Sentry.withMonitor (:46, options :132-138) with monitor slug 'capture-learning';
  claim via the C2.2 claim_post_edit_signals RPC (:55 shape); the atomic status re-guard on every
  transition (lib/db/email-outbox.ts:110 pattern, .eq('status', currentStatus)).
  ⚠️ Do NOT copy runJanitorTick (lib/publishing/orchestrator.ts:317) — it has NO withMonitor wrap,
  unlike runPublishTick (:71). The ADR names that gap explicitly so a Builder copying the nearest
  janitor-shaped code does not silently inherit it. This tick IS wrapped.
- Failure taxonomy (§9.4, copying lib/deletion/orchestrator.ts:20-34): TRANSIENT (Anthropic 429/5xx/
  network, Postgres 40001) → status='failed' with exponential backoff + jitter, retried to
  LEARNING_MAX_ATTEMPTS then 'abandoned'. PERMANENT (Postgres 23xxx, an UNKNOWN schema_version on the
  snapshot, a missing snapshot row) → 'abandoned' immediately, no retry. ⚠️ NO error on this path is
  swallowed: every terminal outcome writes last_error and increments a counter that appears in the log.
  ⚠️ An unknown schema_version REFUSES to diff and abandons (§2.4) — best-effort parsing a shape you do
  not understand emits wrong signals into a confidence counter, which is the failure mode this track
  exists to avoid. Refusing loudly is correct; guessing quietly is not.
- lib/config.ts tunables matching the :28-64 convention (never process.env directly):
  LEARNING_BATCH_SIZE=50, LEARNING_MAX_ATTEMPTS=5, LEARNING_RETRY_BACKOFF_SECONDS=300,
  LEARNING_SUMMARY_MIN_SIGNALS=20, LEARNING_SUMMARY_MIN_INTERVAL_DAYS=7,
  LEARNING_SUMMARY_MAX_INPUT_TOKENS=12000, LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS=8.
- ⚠️ EXACTLY ONE console.log on this path (CLAUDE.md forbids console.* outside the canonical tick log):
  console.log(JSON.stringify({ kind:'learning.tick', triggeredBy, tick, durationMs, claimed, classified,
  signalsEmitted, skippedNoSnapshot, patternsUpserted, promoted, demoted, summarized, failed,
  abandoned })). This log line is one of the three ways a founder verifies the loop in production
  (§11) — it is a deliverable, not debug output. All app-layer timestamps via date-fns formatISO.
- app/api/cron/capture-learning/route.ts — copy app/api/cron/publish/route.ts VERBATIM in shape: QStash
  signature verification (:13-24), the bearer-secret fallback with timingSafeEqual (:32-36), the
  non-prod x-cron-dev-trigger header (:45), GET 405 when CRON_TRIGGER==='qstash' (:99-104), POST 405
  otherwise (:106-111). Zod-validated input. Schedule HOURLY (0 * * * *), matching runMetricsSyncTick.
- docs/runbooks/qstash-setup.md — the new tick's schedule row (as the deletion cron's Step 2b was).
- scripts/learning-report.ts (the /scripts one-off convention) — per business: signals by class, the top
  pattern_keys with observation_count / confidence / status, and how many reached active. This is
  founder-verifiability #2 (§11), not optional polish.

TESTS (Tier-2): the tick's claimed/classified/skippedNoSnapshot/failed/abandoned counters; the
transient-vs-permanent branch; an unknown schema_version → permanent abandon (NOT a best-effort parse);
⚠️ A REPLAYED TICK — run it twice over one fixture and assert EVERY second-run counter is zero and
EVERY performance_memory row is byte-identical (LEARN-TICK-IDEMPOTENT layer 3, the one that matters);
the route's dual-mode auth (405s both directions, signature failure, dev-trigger header).

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. code-reviewer + silent-failure-hunter clean.
On commit: "C2.8 complete — runLearningTick copying runEmailDrainTick (withMonitor 'capture-learning',
lazy service-role, claim RPC, transient/permanent taxonomy, one canonical learning.tick log line),
hourly QStash dual-mode route + runbook row + scripts/learning-report.ts; replayed-tick test proves
LEARN-TICK-IDEMPOTENT (recompute, not increment)." Then stop.
```

#### C2.9 — Close-out verification + the caller tables + push the range so CI executes it

```
BUILDER — Session 25 · C2.9. No new features. Verification, the SHARED-FUNCTION CALLERS tables, and
getting the range EXECUTED in CI. Invoke ecc:pr-test-analyzer.

DO:
- npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db (the Tier-1 suites must report a
  NON-ZERO executed count — a suite a flag silently empties to zero tests is a FALSE-GREEN, ADR 0015).
- Publish the consolidated SHARED-FUNCTION CALLERS tables for approvePost, bulkApproveDraftPosts,
  createPosts AND neutralize() — one row per caller, with the test file that exercises it. A caller with
  no listed test is AUTHORED-NOT-EXECUTED for that caller even if another caller is fully covered. Both
  Session 22 blockers were exactly this, on exactly this function pair.
- Walk ADR §13's 21 LEARN-* constraints and produce constraint → test file → executing CI job → tier.
  Use ecc:pr-test-analyzer to judge whether each test would REDDEN if its property broke. Anything
  unmapped is reported now, not discovered in review.
- Confirm the Tier-3 (diff-verified) properties hold by inspection and record each AS a decision (ADR
  §12): the two §D2.5 rows exist; no *_voice_memory migration; NO new dependency in package.json; no
  Tier-2/Tier-3 agentic loop anywhere; NO route under app/[locale]/(dashboard) and NO new i18n keys; no
  campaign_brief_revisions table; the two new tables + performance_memory are queried only inside
  lib/db/ + lib/memory/.
- Push the branch and open the PR so app-tests AND db-tests EXECUTE this range. Record both run URLs and
  the db-tests executed count — "covered" means executed green in CI, never authored.

On commit: "C2.9 complete — full range verified: tsc clean, test:app green, test:db green with N
executed (skip-guard); 21/21 LEARN-* constraints mapped to test + executing CI job; four
SHARED-FUNCTION CALLERS tables published; seven Tier-3 diff-verified properties confirmed as recorded
decisions; app-tests <url>, db-tests <url>." Then stop.
```

**Builder close-out.** After C2.9 the range is ready for the Reviewer (§3). Per the ADR 0015 promotion
tally, a `pull_request`-event run does **not** count toward the three-green-on-`master` rule — record the
runs, do not claim promotion. The `db-tests` executed count must be read by a human before it counts.

---

## §3 — Reviewer session (C3)  ·  (paste into Claude Code · Opus)

Run only after C2.1–C2.9 are committed. **The Builder range is `<C2.1 sha>^..<C2.9 sha>`** (fill both in
before pasting — a review that does not name its range is not a valid review). The Reviewer is
independent and modifies nothing. It is the **single** review pass for this session; the correction pass
(§4) records its resolutions in the reviewer's own file (**REVIEWER-REPORT APPEND-ONLY**).

**Why this track's review is harder than Tracks A and B.** Track A shipped a foundation with no writer;
Track B shipped a pipeline whose failures are loud. Track C ships a loop whose failures are **silent by
construction**: a fragmented `pattern_key` means nothing ever promotes while every test passes and every
log line looks healthy; a double-counted diff promotes a pattern observed once; a mislabelled correction
corrupts voice memory compoundingly with nothing going red; a `BEFORE DELETE` guard added "for safety"
makes GDPR erasure impossible for every business that ever generated a post. **Every headline risk in
this track is invisible at runtime.** The review's job is to find the ones a green CI cannot.

**ECC in this phase** — the plan doc (`session-plan §2`, Session C3) names three passes; this track's
risk surface adds three more:
- `database-reviewer` — **the plan doc's named pass**: the async worker's data path. The claim RPC, the
  atomic promotion/demotion, the recompute, the partial UNIQUE / `ON CONFLICT` predicate match, RLS,
  cascade, and the `BEFORE UPDATE`-only trigger scope.
- `typescript-reviewer` — **the plan doc's named pass**: the `lib/learning/` module boundary, the
  partitioned return, no `any`, the rehydration guard.
- **The plan doc's third, explicitly-worded pass**: *"a check that the correction/preference split is
  actually enforced (not just documented) before anything writes into voice memory."* Run it with
  `ecc:type-design-analyzer` **and** by reading the DB trigger — the ADR is explicit that the TS layer
  alone is **not** enforcement and that a service-role `if` would be theatre.
- `security-reviewer` — the GDPR/cascade path, the three render sites, and the summarizer's
  human-edited-copy-into-an-LLM direction (new for this codebase).
- `ecc:silent-failure-hunter` — the capture path, the snapshot write, the unknown-`schema_version`
  branch, and any Tier-0 check that could pass vacuously.
- `ecc:pr-test-analyzer` — does each `LEARN-*` test genuinely **execute** in a named CI job and
  **redden** if the property broke (the ADR 0015 "covered = executed, never authored" thesis).

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 25 — Diff-Based Learning Capture (ADR 0018), REVIEWER phase. You are an INDEPENDENT reviewer:
you did NOT write this code and you will not modify any file. Output is a review document only. This is
the ONE review pass for the session — audit thoroughly; there is no re-review to catch what you miss.

⚠️ PROC-REVIEW-AT-COMMIT (CLAUDE.md / ADR 0015 — a HARD constraint): read EVERY file AT THE STATED
COMMIT RANGE — git diff <C2.1 sha>^..<C2.9 sha>, git show <sha>:<path>, git log --oneline — NEVER at
HEAD. Your report MUST OPEN by naming the exact range you read and stating every citation comes from it.
A report that does not name its range is not a valid review. (The Session 21B false-positive MAJOR came
from reading one file at HEAD.) Per the Session 22-F/NEW-12 exception: reviewed ARTEFACTS are read at
the audited range; any prior findings document you audit against is read at ITS OWN commit, which you
must also name.

⚠️ SHARED-FUNCTION CALLERS (CLAUDE.md — the root cause of BOTH Session 22 blockers, on THIS EXACT
function pair): git grep every caller of each and state, PER CALLER, which test file exercises it:
  (a) approvePost and bulkApproveDraftPosts — the capture transitions (ADR §3.4 lists SIX rows),
  (b) createPosts — the snapshot write point,
  (c) neutralize() — it GAINED three callers in C2.1.
One caller proven is NOT the function proven. Also verify the ADR's own caller table is still complete —
a caller that exists in the range but not in ADR §3.4 is a finding.

Invoke database-reviewer AND typescript-reviewer AND ecc:type-design-analyzer AND security-reviewer AND
ecc:silent-failure-hunter AND ecc:pr-test-analyzer.

Read now, at that range:
- docs/decisions/0018-diff-based-learning-capture.md — §13's 21 LEARN-* constraints are your checklist;
  §12 is the test plan; §14 lists 28 advisory findings already folded in (verify each disposition
  actually SHIPPED — an "Adopted" finding that did not land is a MAJOR); §15 is the deferred boundary.
- docs/build-guide/session-25.md §0 (L-1..L-13) + §0.1 (the eight answers) + §0.2 (the three founder
  adjudications and their BINDING conditions) + §2 (the concrete decisions the Builder was told to
  transcribe, NOT re-derive).
- docs/decisions/0016-governed-memory.md — incl. the newly appended Amendment B (is it append-only? was
  §3.4's original text edited? an in-place edit is a process violation).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three tiers and "covered = executed".
- The full Session 25 diff COMMIT BY COMMIT (C2.1…C2.9) and every test added.
- supabase/migrations/<ts>_learning_capture.sql + <ts>_performance_memory_pattern_key.sql;
  supabase/__tests__/learning-*.test.ts; lib/learning/*; lib/db/post-ai-originals.ts;
  lib/db/memory-performance.ts; lib/campaigns/generate.ts; lib/ai/prompts/post-generation.ts +
  formats/native-generation-prompt.ts + post-regeneration.ts; app/api/cron/capture-learning/route.ts;
  lib/config.ts; docs/decisions/0010-legal-surface.md Amd 2 §D2.5; docs/runbooks/qstash-setup.md.

Before reviewing anything, ESTABLISH FIVE REALITIES (a wrong answer here voids the review):
(1) EXECUTION. Did this range run in CI? Name the app-tests run and the db-tests run for these SHAs, and
    the db-tests EXECUTED TEST COUNT (non-zero — the skip-guard). If either job never ran on this range,
    every constraint it owns is AUTHORED-NOT-EXECUTED and that is a BLOCKER, not a note.
(2) ERASURE. Read the write-once trigger's definition. Is it BEFORE UPDATE **ONLY**? If it carries OR
    DELETE in any form, that is an immediate BLOCKER: purge_business (…:62, no EXCEPTION block) aborts
    on the cascade and NO business that ever generated a post can be GDPR-erased. Then confirm the
    Tier-1 test asserts erasure SUCCEEDS, not merely that rows are gone — a rows-are-gone assertion
    inside an already-aborting transaction is never reached.
(3) ORDERING. Does the render guard (C2.1) precede the distillation writer (C2.6) in commit order? §0.2/
    A-2 requires NO commit range in which the writer is live and the guard is not. Check the actual log.
(4) THE TRIGGER'S BODY. Read the enqueue trigger. Does it do ANYTHING beyond one INSERT of ids + frozen
    content? Any diffing, text processing, network call or memory write is a LEARN-TRIGGER-ENQUEUE-ONLY
    violation and a D-6 contradiction (§0.2/A-1).
(5) INCREMENT vs RECOMPUTE. grep the range for any increment of observation_count. §9.6 requires it be
    RECOMPUTED from post_edit_signals. A single `+ 1` is a silent confidence-inflation bug — MAJOR at
    minimum.
Output the five findings + the three caller enumerations + "Ready to review 25 (range: …)." Then wait.
```

### §3b — Reviewer prompt  (paste after acknowledgement)

```
REVIEWER — Session 25. Audit the diff commit-by-commit against ADR 0018. RE-DERIVE the adversarial
checks yourself (write the query, trace the call, reason about the outcome) rather than trust a test's
name. Tier every finding BLOCKER / MAJOR / MINOR / NIT. All citations at the stated commit range.

SECTION A — SCHEMA, RLS, CASCADE, ERASURE  (LEARN-RLS-ISOLATED, -CASCADE-COMPLETE, -SNAPSHOT-SEPARATE
                                            · database-reviewer + security-reviewer)
A1. Both new tables have RLS ENABLED and the four policies in the InitPlan form `business_id = ANY
    (SELECT unnest(public.get_user_business_ids()))` — SELECT / INSERT WITH CHECK / UPDATE with BOTH
    USING and WITH CHECK / DELETE. The bare `= ANY (public.get_user_business_ids())` form is SUPERSEDED
    ([db-NIT-1]) and evaluates per row — flag it if it was stamped in from an old template. Prove
    cross-tenant CRUD is denied EXECUTED against live Postgres; a missing WITH CHECK is tenant
    tunnelling — BLOCKER.
A2. post_ai_originals has NO authenticated DELETE policy (the app-layer half of write-once, §2.5).
A3. business_id cascades from businesses on BOTH tables (never derived through a join); post_id and
    campaign_id FKs exist; the multi-parent cascade is documented as intentional ([db-NIT-2]).
A4. BOTH tables have their ADR 0010 Amd 2 §D2.5 row, ANNOTATED as holding customer / third-party quote
    content ([sec-MEDIUM-1]). Missing = silent GDPR-erasure leak = BLOCKER. Confirm a business delete
    actually SUCCEEDS and purges both, executed.
A5. Indexes per §3.3: the claimable partial, the covering (business_id, pattern_key) INCLUDE
    (campaign_id) WHERE status='processed', and the EXPLICIT FK indexes on ai_original_id and
    campaign_id (neither implied by a UNIQUE leading on post_id). A missing covering index makes the
    §9.6 recompute a seq scan that degrades silently with volume.
A6. post_ai_originals has UNIQUE (post_id, revision), no updated_at, no set_updated_at trigger, and
    schema_version written from the named constant.

SECTION B — THE WRITE-ONCE + CAPTURE TRIGGERS  (LEARN-SNAPSHOT-WRITE-ONCE, -CAPTURE-AT-TRANSITION,
                                                -TRIGGER-ENQUEUE-ONLY, -MODE-AGNOSTIC)
B1. ⚠️ The write-once trigger is BEFORE UPDATE **ONLY**. Any DELETE guard is a BLOCKER (§2.5) — say so
    in those terms and cite purge_business's missing EXCEPTION block. Prove an UPDATE is rejected and a
    cascade DELETE SUCCEEDS.
B2. The enqueue trigger's transition guard is in the FUNCTION BODY, not a WHEN clause ([sec-LOW-2]).
    Prove it does NOT fire on other posts UPDATEs — a schedule change or publish-counter bump enqueuing
    a duplicate row with stale content is a MAJOR.
B3. ai_original_id is NOT NULL and the trigger has an explicit no-snapshot skip branch ([db-MAJOR-1]).
    Prove approving a snapshot-less or manual-origin post SUCCEEDS and enqueues nothing. A not-null
    violation here is a production outage on the core approval flow, not a corner case.
B4. The trigger body does ONE INSERT and nothing else — no diffing, no text processing, no network, no
    memory write (LEARN-TRIGGER-ENQUEUE-ONLY / §0.2 A-1). Read it line by line.
B5. It COPIES NEW.content / NEW.hashtags into the row rather than leaving the worker to re-read
    posts.content. If the worker re-reads at claim time, that is a TOCTOU MAJOR — updatePostContent's
    guard is .in('status',['draft','approved']) (posts.ts:482), so a post CAN be edited after approval
    and the worker would diff a version the human never approved.
B6. ⚠️ LEARN-CAPTURE-ALL-CALLERS: is there a Tier-1 test issuing a RAW `UPDATE posts SET
    status='approved'` from NO application code? That test is the ADR's proof that every present and
    future caller is covered by construction. Without it the claim is asserted, not proven — MAJOR.
    Then still walk ADR §3.4's six caller rows, one by one, and name the covering test for each.
B7. Unapprove → re-approve: prove it refreshes a 'pending' row and leaves a 'processed' row untouched
    (§0.2/A-1 named this as a real duplicate path, not a hypothetical).

SECTION C — THE SNAPSHOT (L-2, the load-bearing invariant)  (· typescript-reviewer + silent-failure-hunter)
C1. The snapshot carries BOTH payload (the structured union verbatim) and rendered_content, and
    rendered_content is byte-identical to what landed in posts.content. A payload-only or string-only
    snapshot silently loses either the thread-shortening signal or the ability to diff at all.
C2. The regenerate path writes revision+1 with generation_kind='regeneration'. If it does NOT, the AI's
    own rewrite is attributed to the human — the exact silent confidence-inflation this table shape
    exists to prevent (§2.2). Is the 23505 catch-and-retry present ([db-MINOR-1])?
C3. No backfill; snapshot-less posts are skipped AND COUNTED (skippedNoSnapshot), never errored, never
    fabricated.
C4. PostUpdate is UNCHANGED (§2.6) — a speculative Omit added "for symmetry" is a finding.
C5. silent-failure-hunter: can the snapshot write fail without anyone knowing? Trace the error path.

SECTION D — DIFF + CLASSIFIER  (LEARN-HEURISTIC-FIRST, -CLASSIFY-DETERMINISTIC · typescript-reviewer)
D1. NO diff library in package.json (L-13). Any addition is an out-of-scope BLOCKER.
D2. classify() is PURE — no clock, no randomness, no network, no LLM, no row-order dependence. Prove no
    LLM client is constructed on this path. An LLM call per post is an L-1 STOP.
D3. Determinism is TESTED (same fixture pair twice → byte-identical), not asserted. Its output feeds a
    confidence counter; nondeterminism makes every promotion unreproducible.
D4. All eleven §4.2 kinds implemented with the ADR's exact rules, each landing in the right partition.
    The thread delimiter matches generate.ts:50-55 — a guessed delimiter silently mis-detects every
    thread edit.

SECTION E — CORRECTION vs PREFERENCE  (the plan doc's NAMED review pass · type-design-analyzer)
E1. ⚠️ Is the split ACTUALLY ENFORCED, not merely documented? The plan doc names this check verbatim.
    Answer at BOTH layers or the answer is no:
    (a) TS: is there a partitioned return? Does a `Signal[]` type exist ANYWHERE (it must not)? Is
        `_class` a literal, never widened to string? Any index signature on the three interfaces?
    (b) DB: does LEARN-VOICE-WRITE-TRIGGER exist on performance_memory and RAISE for a distilled
        format/hook write sourced from a class<>'preference' signal? If the Builder shipped a
        service-role `if` instead, that is the theatre [type-4] rejected — MAJOR.
E2. The @ts-expect-error compile assertion exists and genuinely fails to compile when corrections are
    passed to the voice writer. Verify by reading it, not by its name.
E3. The rehydration choke point is NAMED as such and carries a runtime Zod .literal() guard ([type-5]).
    Without it, the DB round-trip re-types everything as whatever the read function declares — the hole
    §5.3 admits is real.
E4. LEARN-CORRECTION-REQUIRES-BRIEF: does the correction rule run ONLY against a non-empty pinned set?
    A post with no brief MUST yield inconclusive. If that guard is missing, every brief-less post floods
    false corrections into the exact signal the split exists to protect — BLOCKER.
E5. Does the ADR's own honesty survive? §5.3/§5.4 explicitly refuse the word "unrepresentable" and state
    what the layer does NOT close. Flag any code comment or doc that overclaims — ADR 0017 Amendment A.2
    is the precedent for why.

SECTION F — MEMORY WRITE + PROMOTION  (LEARN-PROMOTION-THRESHOLD, -NO-SINGLE-DIFF-PROMOTION,
                                       -MEMORY-THROUGH-BOUNDARY, -VOICE-NOT-AUTO-MUTATED · database-reviewer)
F1. ⚠️ observation_count is RECOMPUTED from post_edit_signals, never incremented (§9.6). grep the range.
    A single `+ 1` silently inflates confidence and promotes a pattern observed once — MAJOR at minimum.
F2. pattern_key is derived from kind+direction+platform, NEVER from prose, and its determinism is
    tested in BOTH directions (identical phenomena key the same; distinct phenomena key differently).
    Fragmentation means NOTHING EVER PROMOTES while everything looks healthy; collision promotes on a
    merge. Both are silent — this is the highest-value check in the section.
F3. The CHECK (source <> 'distilled' OR pattern_key IS NOT NULL) exists ([db-MAJOR-2]) and the partial
    UNIQUE's predicate is REPEATED at every ON CONFLICT. A bare ON CONFLICT (cols) does not resolve to a
    partial index — verify each upsert site, not just one.
F4. All THREE promotion gates hold (5 / 0.70 / 2 distinct campaigns) in ONE atomic conditional UPDATE.
    Read-then-update anywhere is a MAJOR. The distinct-campaign gate is what makes L-7 real — five
    observations in one campaign is one editing session, not a pattern.
F5. K=2 and the 0.714-at-5 interaction are intact and boundary-tested. If someone "tidied" K to 3,
    MIN_OBSERVATIONS became unreachable and the constant is a lie.
F6. Demotion carries the same explicit .eq('status','active') guard ([db-MINOR-3]); a demoted row is
    NEVER deleted; decay is expires_at-based with no new job.
F7. The distilled write OMITS likes/impressions (ADR 0016 §3.4's un-defer trigger, discharged by
    23-E) — a 0 anywhere is the resurrected inversion.
F8. Everything goes through lib/db/memory-performance.ts + lib/memory/. grep for direct table access to
    performance_memory, post_ai_originals or post_edit_signals outside lib/db/ + lib/memory/.
F9. NOTHING writes to brand_voices / brand_voice_variations. An inferred mutation of the user's own
    voice rows is an L-9 STOP the ADR explicitly did not propose — BLOCKER if present.

SECTION G — THE SUMMARIZER  (LEARN-SUMMARY-DATA-GUARDED · security-reviewer + cost)
G1. BOTH gates (20 signals AND 7 days) are required and each independently suppresses the call. A single
    gate, or an OR, turns "at most weekly" into something else entirely.
G2. Input goes through the SHARED neutralize() at RENDER time (not the weak local sanitizeDataField, not
    at authorship time) AND is hard-capped by length. Prove with a hostile fixture, not by reading.
G3. ONE business per call; every input query explicitly business_id-filtered; the output write takes
    business_id from the SAME per-iteration variable (§10.3). Trace the loop for a capture leak — the
    service-role client bypasses RLS, so the query is the ONLY boundary. Proven end-to-end, not by a
    unit test of the query builder.
G4. The bounded output schema (5 × 200 chars, fixed dimension vocabulary) is enforced via
    safeParseOrAiError and NEVER falls through to an unvalidated write. Confirm it is not conflated with
    render-time neutralisation ([sec-MEDIUM-3]) — they are orthogonal and both are required.
G5. Summarizer output writes `candidate` rows only — no shortcut into active.
G6. Tier 1 ONLY: no critique/regenerate loop, no agentic tool loop anywhere in the range. The monthly
    ceiling is enforced against ai_usage, not just documented.

SECTION H — WORKER, ROUTE, IDEMPOTENCY  (LEARN-TICK-IDEMPOTENT · silent-failure-hunter + code-reviewer)
H1. Sentry.withMonitor IS applied (slug capture-learning) — the ADR names runJanitorTick's missing wrap
    specifically so it is not inherited. Check it was not.
H2. EXACTLY ONE console.log on the path, with the §9.5 field set. Any additional console.* is a
    CLAUDE.md violation; a missing counter makes founder verification (§11) impossible.
H3. ⚠️ The replayed-tick test: run twice over one fixture, every second-run counter zero, every
    performance_memory row byte-identical. If this test does not exist, LEARN-TICK-IDEMPOTENT is
    AUTHORED-NOT-EXECUTED and the track's headline correctness property is unproven — BLOCKER.
H4. The claim RPC is SECURITY DEFINER with REVOKE ALL FROM public + GRANT TO service_role, uses FOR
    UPDATE SKIP LOCKED, and returns disjoint sets under concurrency (Tier-1, executed).
H5. Failure taxonomy: transient retries with backoff to LEARNING_MAX_ATTEMPTS then abandons; permanent
    abandons immediately. An unknown schema_version REFUSES to diff (§2.4) — if it best-effort parses,
    that is a MAJOR: wrong signals entering a confidence counter is the failure this track exists to
    avoid. NO error is swallowed; every terminal outcome writes last_error and bumps a counter.
H6. The cron route mirrors publish/route.ts: QStash verification, timingSafeEqual bearer fallback,
    dev-trigger header, GET/POST 405s both directions, Zod-validated input. Runbook row added.
H7. Config via lib/config.ts only (no process.env), names matching the :28-64 convention; date-fns
    formatISO for every app-layer timestamp.

SECTION I — SCOPE + PROCESS  (L-1, §0.2, §15)
I1. NOTHING out of scope shipped: no Mode 1 Studio, no Mode 3 / mining / insight cards, no
    relationship_memory, no embeddings, no skip-review fast path, no campaign_brief_revisions, no voice
    table, no user-facing route, NO new i18n keys, no new dependency. Any of these is an out-of-scope
    BLOCKER.
I2. The render-guard expansion stayed BOUNDED to the three §10.4 sites + the shared helper. An
    opportunistic sweep of other prompt fields, or a sanitizeDataField consolidation ([sec-LOW-3],
    declined), is scope creep — flag it even though it "improves" things.
I3. ADR 0016 Amendment B is APPEND-ONLY — §3.4's original text untouched. An in-place edit is a process
    violation of the same class the REVIEWER-REPORT rule exists to prevent.
I4. Every §14 disposition marked "Adopted" actually SHIPPED. Walk all 28. An adopted finding that did
    not land is a MAJOR — the ADR asserts it as already handled, so nothing else will catch it.
I5. No `any` (outside CLAUDE.md's two carve-outs); no console.* outside the one tick log; service-role
    lazy-imported and never in a user-facing read path; every new list query bounded with an explicit
    ORDER BY matching an index.
I6. One step, one commit: the commits correspond to C2.1…C2.9 with no step's work bleeding into
    another's, and C2.1 (the render guard) precedes C2.6 (the writer).

SECTION J — CONSTRAINT COVERAGE (the thesis · pr-test-analyzer)
J1. EVERY one of ADR §13's 21 LEARN-* constraints maps to a test AND to the CI JOB that executes it
    (Tier-1 → db-tests, Tier-2 → app-tests, Tier-3 → enumerated as diff-verified BY DECISION). A
    constraint with a test but no executing job is a MAJOR; with neither, a BLOCKER.
J2. For each, state whether pr-test-analyzer confirmed the test would FAIL if the property broke. Pay
    special attention to any Tier-0 check that could pass VACUOUSLY on an empty set.
J3. Report the db-tests EXECUTED TEST COUNT for this range (skip-guard: zero executed = FALSE-GREEN) and
    whether this range counts toward the ADR 0015 three-green db-tests promotion tally (it does not if
    it is a pull_request-event run — the rule counts full-green runs on master).
J4. Apply SHARED-FUNCTION CALLERS: publish the per-caller → test-file tables for approvePost,
    bulkApproveDraftPosts, createPosts and neutralize(). A caller with no listed test is
    AUTHORED-NOT-EXECUTED for that caller even if another is fully covered.
J5. The seven Tier-3 diff-verified properties (§12) are each confirmed AS a recorded decision, so "no
    test" is a decision and not an oversight.

OUTPUT: docs/reviews/session-25-reviewer.md —
- OPEN by naming the commit range read (PROC-REVIEW-AT-COMMIT) and stating every citation is from that
  range, never HEAD. Then the four SHARED-FUNCTION CALLERS tables (J4).
- A table: Section / Check / Status (✅/⚠️/❌) / File:Line / Note.
- Then BLOCKER, MAJOR, MINOR, NIT — each with an exact, actionable fix instruction (the correction pass
  is driven directly off these, one step per finding).
- A coverage section: constraint → test → executing CI job → tier → "reddens if broken?".
- A VERDICT: blockers before merge · deferrable debt · and a plain answer to the four questions this
  track exists to settle: (1) can the AI's original ever be clobbered by a human edit; (2) can a diff be
  counted twice; (3) can a correction-tagged signal reach a voice-directed write; (4) can a single diff
  change future generation. Each answer must cite the DB-level proof, not the TS-level one.
Do NOT modify code. Do NOT write the correction prompts — those come after this report (§4).
```

---

## §4 — Correction pass (Session 25-D)  ·  (paste into Claude Code · Opus)

**Filled in from `docs/reviews/session-25-reviewer.md` (Reviewer range `717263d2..d7cee4a5`, i.e.
`be5779e1^..d7cee4a5`, C2.1…C2.9).** Nine steps: **D0–D8**. Correction passes are normal, not failures
(constitution). **There is no independent re-review pass this session** (mirroring 23-D and 24-D): this
pass fixes the Reviewer's findings, records its own resolutions in the reviewer's own file, and the
founder adjudicates close-out.

**The Reviewer found NO BLOCKER.** It states the range can merge as it stands, and explicitly cleared the
four highest-risk candidates (no `OR DELETE` on the write-once trigger, GDPR erasure provably succeeds, no
`brand_voices` write, no out-of-scope table/route/dependency/i18n key). This pass is therefore not a
rescue — it closes six MAJORs and the MINOR/NIT tail, and lands the spec in git.

**Founder direction — every finding is fixed, including MINORs and NITs.** The Reviewer graded
MINOR-1..11 and NIT-1..7 as deferrable debt; per founder direction (as in Sessions 23-E and 24-D) they are
**resolved in this pass anyway**, each with its own resolution row — a finding declined or adjudicated the
other way still gets a row, because an unexplained gap between findings and resolutions is what makes the
trail unreadable later.

**Founder adjudication on MAJOR-1 + MAJOR-2 (binding — settled before this section was written).** The
Reviewer's own verdict is that these are **one problem**: `pattern_key` is simultaneously the aggregation
key, the promotion join key, and the voice-guard join key, and "a session that fixes either in isolation
will activate the other." The founder's call is **(a) record + narrow**, not (b) make the summarizer
promotable:

- **Summarizer rows are permanently candidate-only.** That is now an *intended* property, not an
  accident of the campaign gate — stated in ADR §6.1, in `summarize.ts`, and enumerated in ADR §12's
  Tier-3 list. The promotion gates stop being described as if they applied to `summarize:`-keyed rows.
- **`LEARN-VOICE-WRITE-TRIGGER`'s live scope is re-stated to what it actually guards** (other write
  paths — manual backfill, future jobs, ad-hoc queries — not the Track-C pipeline, which cannot produce a
  row the `EXISTS` matches), and the summarizer half is closed outright by a `class` filter at the source.
- **Rationale:** option (b) would make live the exact path MAJOR-1's leak sits on, in a correction pass,
  under no merge pressure, for a Tier-1 feature whose only reader is itself today. The safety property
  ("no correction-derived text reaches a generation prompt") holds either way; (a) makes the *stated*
  mechanism match the *actual* one, which is precisely what the Reviewer said was missing.

**What the Reviewer found (summary — the full text in `session-25-reviewer.md` is authoritative):**

| ID | Tier | One line | Fixed in |
|---|---|---|---|
| MAJOR-5 | MAJOR | ADR 0018 and `session-25.md` are **untracked**; nine commits implement a spec that is not in git, and four committed documents already cite it | **D0** (first, deliberately) |
| MAJOR-1 | MAJOR | `LEARN-VOICE-WRITE-TRIGGER` is structurally unreachable from both shipped writers; its `RAISE` text asserts an invariant the pipeline does not maintain; `listRecentHumanEditExcerpts` has **no `class` filter** | **D1** |
| MAJOR-2 | MAJOR | The whole C2.7 summarizer is write-only — a `summarize:` key matches zero `post_edit_signals`, so the campaign gate is `0 >= 2` forever and its output can never reach `active` | **D1** |
| MAJOR-3 | MAJOR | A failed snapshot write after `createPosts` leaves live, approvable draft posts permanently outside the learning loop, with no per-post attribution and no way to find orphans | **D2** |
| MAJOR-4 | MAJOR | The test named `LEARN-TICK-IDEMPOTENT` does not exercise it — the second claim is *given* an empty batch, so it proves a tautology and would not redden on an increment | **D3** |
| MAJOR-6 | MAJOR | No test claims rows for two businesses in one tick — the only tenancy boundary that is **not** RLS is asserted by code-reading, and `[sec-Q2]`'s test obligation is half-discharged | **D3** |
| MINOR-2 | MINOR | Tier-2 halves of `LEARN-MEMORY-THROUGH-BOUNDARY` and `LEARN-VOICE-NOT-AUTO-MUTATED` are **unmapped** (2 of 21 constraints) | **D3** |
| MINOR-10 | MINOR | The promotion confidence gate is never isolated in a boundary test | **D3** |
| MINOR-7 | MINOR | Two unbounded, unordered queries in `scripts/learning-report.ts` | **D2** |
| MINOR-3 | MINOR | `raceLost` and `abandoned`/`skippedNoSnapshot` double-count one lost race — the canonical tick line over-reports terminal outcomes | **D4** |
| MINOR-4 | MINOR | `summarizeFailed` collapses LLM failure, Zod parse failure, and DB write failure into one untagged counter | **D4** |
| NIT-4 | NIT | `summary.failed` means "retrying" and sits beside `abandoned`/`promoted` — anyone alerting on `failed > 0` pages on every ordinary retry | **D4** |
| MINOR-5 | MINOR | `status='failed'` is a legal transition target the claim RPC never reclaims — the guarantee lives in orchestrator behaviour, not in the schema | **D5** |
| MINOR-6 | MINOR | `expires_at` is written on every upsert and read by nothing — a 90-day-stale `active` pattern still reaches generation | **D5** |
| MINOR-8 | MINOR | Demotion's threshold is caller-supplied arithmetic; `[db-MINOR-3]`'s "same rigor as promotion" is not literally achieved | **D5** |
| MINOR-1 | MINOR | `rehydrateSignals()` has no production caller, and `PostEditSignalRow.signals` is loose enough that a future reader can cast around it | **D6** |
| MINOR-9 | MINOR | ADR §3.4's caller table carries three stale line numbers and one **false citation** — the table whose purpose is to be trusted at face value | **D6** |
| MINOR-11 | MINOR | The two `topContent` render sites carry no length cap; safe today, unsafe when a third writer appears | **D6** |
| NIT-1 | NIT | "eleven kinds" is twelve, in five places | **D6** |
| NIT-2 | NIT | ADR §10.4 cites a third render site that renders nothing | **D6** |
| NIT-3 | NIT | `computeSummaryPatternKey`'s 32-bit hash bound is unrecorded | **D6** |
| NIT-5 | NIT | §14 says 28 findings; the table has 27 rows | **D6** |
| NIT-6 | NIT | CLAUDE.md's "no console.log" reads as absolute with no carve-out for the house structured-JSON pattern this range follows exactly | **D6** |
| NIT-7 | NIT | `getLatestRevision` / `getPostAiOriginalById` carry no `business_id` filter — no exploitable path, but they do not self-enforce tenancy | **D6** |

**Ordering rationale (state it in the resolution log so it does not read as arbitrary).**

1. **MAJOR-5 runs FIRST**, not last. Every other step edits or cites ADR 0018; doing them against an
   untracked spec would repeat the exact defect. D0 puts the spec under version control so D1–D8's ADR
   amendments are *diffs against a committed document* rather than edits to a file git has never seen.
2. **MAJOR-1 and MAJOR-2 run together in D1**, per the Reviewer's explicit instruction that they are one
   problem and that fixing either alone activates the other.
3. **The test-integrity step (D3) precedes the hygiene steps.** MAJOR-4, MAJOR-6 and MINOR-2 are all
   "a named property has no test that reddens" — this track is judged on *covered = executed*, so they
   outrank counter cosmetics.
4. **CI runs LAST (D8)**, exactly as 24-D's D7 did: it must green the **final** range including D0–D7.
   Unlike Session 24 there is no open BLOCKER waiting on it — the range already has a green pair at
   `d7cee4a5` — so D8's job is to re-green the *corrected* range and move the promotion tally, not to
   convert the session from AUTHORED to COVERED.

**Where resolutions go (CLAUDE.md — REVIEWER-REPORT APPEND-ONLY, revised Session 23-D).** Directly into
`docs/reviews/session-25-reviewer.md`, under a **single appended, attributed**
`## CORRECTION PASS (Session 25-D)` section at the **end** of the file — no separate corrections file. The
reviewer's findings above it are **immutable**: not one character edited, no verdict flipped, no status
column rewritten, no RESOLVED stamped onto a finding, nothing reworded, deleted or reordered. The appendix
references each finding **by ID** and records *finding → fix → the test that now proves it → the commit
SHA*. A **disputed** finding is argued in the appendix, never erased. **Never weaken a test to reach
green** — if a correction shows an ADR 0018 constraint is infeasible, **amend ADR 0018** and say so.

> **Note the ordering hazard this pass carries and 24-D did not.** `docs/reviews/session-25-reviewer.md`
> is itself untracked at the reviewed range (MAJOR-5 covers ADR 0018 and the build guide; the report is in
> the same state). D0 commits it **as the Reviewer wrote it**, before a single resolution row is appended,
> so the immutable text and the appended appendix land in *different* commits and the diff proves nothing
> above the appendix was touched. Do not fold D0 and the first resolution row into one commit.

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
Session 25-D — Diff-Based Learning Capture (ADR 0018), CORRECTION pass. You are fixing the findings in
docs/reviews/session-25-reviewer.md (range 717263d2..d7cee4a5 = be5779e1^..d7cee4a5, C2.1…C2.9).
Nine steps, D0…D8, each its own commit.

Read now, before anything else:
- docs/reviews/session-25-reviewer.md — IN FULL. It is your work order AND the file you record
  resolutions in. Append a single `## CORRECTION PASS (Session 25-D)` section at the END; do NOT edit any
  finding in place, do NOT create a separate corrections file (CLAUDE.md REVIEWER-REPORT APPEND-ONLY).
- docs/build-guide/session-25.md §0 (Locked L-1..L-13, esp. L-1 no per-post LLM, L-6 correction/preference
  split, L-7 no single-diff promotion, L-9 no auto voice mutation, L-13 no new dependency) and §4 (this
  section — the step list, the MAJOR-1/MAJOR-2 founder adjudication, and the ordering rationale).
- docs/decisions/0018-diff-based-learning-capture.md — the 21 LEARN-* constraint table (§13), §12's
  Tier-3 diff-verified list, §5.3/§5.4 (the correction/preference split), §6.1 (summarizer output),
  §7.1/§7.4 (decay, demotion), §9.4 (the retry path), §3.4 (the caller table), §14 (the disposition table).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — "covered = executed green in CI, never
  authored." MAJOR-4 and MINOR-2 are both instances of the failure that ADR exists to catch.

Binding rules for this pass:
- L-1 still holds. No LLM call on the per-post classify path. No Mode 1, no Mode 3, no mining, no insight
  cards, no relationship_memory, no embeddings, no skip-review path, no brief-diff capture, no voice
  suggestion surface, no user-facing route, no new i18n key, no new dependency. A fix that seems to need
  one is a STOP.
- L-9 still holds absolutely. Nothing in this pass may write brand_voices or brand_voice_variations.
- The MAJOR-1/MAJOR-2 resolution is ALREADY ADJUDICATED (see §4 above): summarizer rows are permanently
  candidate-only, recorded as intended; the voice trigger's stated scope is narrowed to match what it
  actually guards. Do NOT implement the "make summarizer rows promotable" branch. If D1 turns up evidence
  that (a) is wrong, STOP and report rather than switching to (b) mid-pass.
- NEVER weaken a test to reach green. If a correction shows an ADR 0018 constraint is infeasible, amend
  the ADR (recorded as an amendment) and say so.
- Each step: /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop, plus the step's named specialist.
  tsc --noEmit --skipLibCheck; scoped vitest run (CLAUDE.md invocation notes); npm run test:db for Tier-1.

Confirm these grounding facts (a wrong one is a STOP):
(1) git status — confirm docs/decisions/0018-diff-based-learning-capture.md, docs/build-guide/session-25.md
    and docs/reviews/session-25-reviewer.md are ALL still untracked (`??`), and that
    `git cat-file -e d7cee4a5:docs/decisions/0018-diff-based-learning-capture.md` fails. This is MAJOR-5.
(2) lib/learning/orchestrator.ts:107-123 (canonicalize) — quote it and confirm pattern_key is set ONLY
    when rowClass === 'preference', so every row with a non-NULL pattern_key is preference-classed by
    construction and the voice trigger's EXISTS is unsatisfiable on the Tier-0 path. MAJOR-1 half one.
(3) lib/db/post-edit-signals.ts:63-73 (listRecentHumanEditExcerpts) — confirm it filters on business_id
    and status='processed' with NO class filter, so correction- and inconclusive-classed human copy feeds
    the summarizer. MAJOR-1 half two.
(4) supabase/migrations/20260726030000_performance_memory_promotion.sql:118-127 — confirm the campaign
    gate counts post_edit_signals rows matching p_pattern_key, and that summarize.ts:64-71 namespaces its
    key `summarize:<dimension>:<hash>` which by construction matches none of them. That is 0 >= 2, always
    false. MAJOR-2.
(5) lib/learning/orchestrator.test.ts:449-475 — confirm the "replayed tick" test stubs
    mockClaimPostEditSignals with .mockResolvedValueOnce([signalRow]).mockResolvedValueOnce([]), i.e. the
    second tick is GIVEN an empty batch. MAJOR-4.
(6) lib/learning/orchestrator.test.ts — confirm only one business id ('biz-1') appears anywhere in it.
    MAJOR-6.
Output the six findings + "Ready for D0." Then stop.
```

### §4.1 — Correction steps

#### D0 — MAJOR-5: land the spec in git  ·  FIRST, by design  ·  no code

```
CORRECTION — Session 25-D · D0. No .ts, no .sql, no .tsx. This step puts the specification the previous
nine commits implement under version control, so every later step's ADR amendment is a diff against a
committed document. Invoke no build specialist — this is audit-trail integrity.

The defect (MAJOR-5): nine commits implement ADR 0018, cite it by section in dozens of code comments, and
are verified against its 21 named constraints — and the ADR was never committed. ADR 0016 Amendment B
(committed, d5fafa72) cites ADR 0018 §7.2/§5.3; docs/decisions/0010-legal-surface.md:1071-1072 (committed)
cites ADR 0018 §2.3/§3.3. Committed documents referencing an uncommitted one. No reviewer, now or later,
can do a PROC-REVIEW-AT-COMMIT read of the document the range is measured against.

DO — commit these three files EXACTLY AS THEY STAND, with no edits in this commit:
- docs/decisions/0018-diff-based-learning-capture.md
- docs/build-guide/session-25.md
- docs/reviews/session-25-reviewer.md
Do NOT fix NIT-1's "eleven kinds", NIT-5's 28-vs-27, or MINOR-9's stale citations here — those are D6, as
DIFFS against this commit. Do NOT append the CORRECTION PASS section here either: the reviewer report must
enter git as the Reviewer wrote it, so the later diff proves nothing above the appendix was touched.

VERIFY: git status clean of these three paths; `git show <D0-sha>:docs/decisions/0018-diff-based-learning-capture.md`
resolves; the commit contains no .ts/.sql/.tsx/.json file.
On commit: "D0 complete — ADR 0018, session-25.md and session-25-reviewer.md committed unmodified
(MAJOR-5). Authored before C2.1 and landed retroactively: the ordering is on the record here, and four
already-committed documents (ADR 0016 Amd B, ADR 0010 §D2.5) have cited ADR 0018 since d5fafa72." Then stop.
```

#### D1 — MAJOR-1 + MAJOR-2: close the summarizer leak, record the candidate-only property, narrow the trigger's claim

```
CORRECTION — Session 25-D · D1. The coupled pair — the Reviewer's explicit instruction is that MAJOR-1 and
MAJOR-2 are ONE problem and a session fixing either alone activates the other. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke database-reviewer (trigger + RPC semantics),
security-reviewer (this is the correction/preference boundary — the reason L-6 exists) AND
ecc:type-design-analyzer (the stated-vs-actual invariant gap is exactly its brief).

The founder resolution is ALREADY SETTLED: (a) record + narrow. Do NOT make summarizer rows promotable.

BUILD — three parts, one commit:

1. CLOSE THE LEAK (MAJOR-1, the half that is a real code defect).
   lib/db/post-edit-signals.ts:63-73 — add .eq('class','preference') to listRecentHumanEditExcerpts, so
   correction- and inconclusive-classed human copy never enters the summarizer at all. Today it filters
   only business_id + status='processed'. This is the smallest change that closes the summarizer half
   outright, and it is the ONLY behavioural code change in D1.

2. RECORD THE CANDIDATE-ONLY PROPERTY (MAJOR-2) — no code-behaviour change, but three places must stop
   describing a path that does not exist:
   - ADR §6.1 — amend (append, ADR 0016 Amendment B style; do not rewrite the original text): summarizer
     output is PERMANENTLY candidate-only. Not "gets no shortcut into active" — no path whatsoever,
     because promote_performance_pattern's campaign gate counts post_edit_signals rows matching
     p_pattern_key and a `summarize:`-namespaced key matches zero by construction. State that this is
     INTENDED, and that summarizer rows are read back only by listDistilledPatternsForSummary.
   - lib/learning/summarize.ts:145-155 — the comment there reasons about confidence 0.333 < 0.70 and
     observation_count 1 < 5 (both gates a repeat observation would eventually clear) and does not notice
     the campaign gate makes the question moot forever. Rewrite it to say so.
   - ADR §12 — add the candidate-only property to the Tier-3 diff-verified list, so "no runtime test" is a
     recorded decision rather than an oversight (ADR 0015 §2).

3. NARROW THE TRIGGER'S CLAIM (MAJOR-1, the half that is an overclaim).
   supabase/migrations/20260726020000_performance_memory_pattern_key.sql:96-113 — the RAISE text says the
   row "must be sourced entirely from preference-class signals", which is false for exactly the rows it
   polices. Do NOT alter the trigger's logic. In a NEW forward migration (never edit an applied one),
   replace the message and the surrounding comment so they state what the guard actually guarantees: it
   rejects a distilled format/hook write whose (business_id, pattern_key) is shared by a non-preference
   signal row — a shape the Track-C pipeline cannot produce (canonicalize() emits pattern_key only for
   preference rows; summarize keys are namespaced), so its LIVE scope is OTHER write paths: manual
   backfill, future jobs, ad-hoc queries. Amend ADR §5.3 to match, and add a Tier-3 entry recording that
   scope.

VERIFY:
- Tier-2: a test that listRecentHumanEditExcerpts passes class='preference' to the query builder, and that
  a correction-classed row is absent from its result. Confirm it REDDENS with the .eq removed.
- Tier-1 (the Reviewer's fix #3, and the point of the whole step): in
  performance-memory-pattern-key.test.ts, write a post_edit_signals row with class='correction' AND a
  non-NULL pattern_key, then attempt the matching source='distilled', dimension='hook' write and assert
  the RAISE. This proves the trigger fires when handed such a row — while the ADR now records that the
  pipeline cannot produce one. Both facts on the record, neither implied.
- npm run test:app; npm run test:db; tsc clean. Address every database-reviewer / security-reviewer /
  type-design-analyzer finding before commit.
Append D1 rows (two findings, one commit) — and record in the appendix that MAJOR-2 was resolved as
option (a) with the founder's reasoning, NOT declined.
On commit: "D1 complete — listRecentHumanEditExcerpts filters class='preference' so correction copy never
reaches the summarizer (MAJOR-1); summarizer output recorded as permanently candidate-only in ADR §6.1 +
§12 Tier-3 + summarize.ts (MAJOR-2, founder option (a)); LEARN-VOICE-WRITE-TRIGGER's RAISE text and ADR
§5.3 narrowed to the scope it actually guards; Tier-1 test proves the trigger fires on a correction-classed
row with a non-NULL pattern_key." Then stop.
```

#### D2 — MAJOR-3 + MINOR-7: make snapshot-less posts findable

```
CORRECTION — Session 25-D · D2. Observability for the one state this track's thesis cannot afford to lose
silently. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:silent-failure-hunter
(it raised MAJOR-3 as a BLOCKER; the Reviewer regraded it MAJOR — read both arguments) AND
database-reviewer (the orphan query and the two unbounded ones).

The defect (MAJOR-3): createPosts commits N rows in one call; the snapshot writes are a SECOND round trip.
If one fails, Promise.all rejects, the outer catch marks the SESSION failed — but the posts are already
committed, are not rolled back, and Promise.all does not even report which ids succeeded. They stay live
status='draft', render and approve exactly like healthy posts, and the trigger's
`IF v_origin_id IS NOT NULL THEN … END IF` has NO ELSE — no log, no counter, no row. There is no backfill
(Q1: "ships empty"), and scripts/learning-report.ts aggregates post_edit_signals and performance_memory
without ever diffing posts against post_ai_originals, so the one founder-facing tool cannot see it either.

BUILD — the Reviewer offered (a) one transaction, (b) allSettled + mark, (c) an orphan query, and named
(c) as the recommended minimum. Do (c), and do it properly:
- scripts/learning-report.ts — add an ORPHAN section: posts with deleted_at IS NULL and no matching
  post_ai_originals row, per business, with a count and a bounded sample of ids. This gives
  [db-MAJOR-1]'s deliberate silent skip the operator-visible counterpart it currently lacks.
- Do NOT implement (a) or (b) in this pass — a transaction boundary change across createPosts is a
  behaviour change to the generation path, out of scope for a correction pass, and (b) changes failure
  semantics. Record BOTH as named alternatives in the resolution row with the reason they were not taken,
  so the choice is legible rather than silent.
- MINOR-7 (same file, same commit) — scripts/learning-report.ts:26-32 and :66-71 have no limit and no
  explicit ORDER BY, against CLAUDE.md's two list-query rules. Add a bounded limit and an ORDER BY
  matching an existing index to both, and to the new orphan query. Do NOT add a scripts/ carve-out to
  CLAUDE.md — the rules are cheaper to obey than to weaken.

VERIFY: a Tier-1 test that the orphan query returns zero on a healthy fixture (post + snapshot) and
non-zero on a seeded orphan (post inserted with no post_ai_originals row). Confirm it REDDENS if the
join condition is inverted. npm run test:db; npm run test:app; tsc clean.
Append D2 rows (two findings; MAJOR-3's row must name (a)/(b) as considered-and-deferred, with the
silent-failure-hunter BLOCKER vs Reviewer MAJOR severity split argued in the appendix, neither original
finding edited).
On commit: "D2 complete — learning-report.ts reports snapshot-orphan posts per business, Tier-1 tested in
both directions (MAJOR-3, fix (c); (a) transaction and (b) allSettled recorded as deferred alternatives);
its three queries now bounded with explicit ORDER BY (MINOR-7)." Then stop.
```

#### D3 — MAJOR-4, MAJOR-6, MINOR-2, MINOR-10: the test-integrity step

```
CORRECTION — Session 25-D · D3. This track is judged on "covered = executed" (ADR 0015 §2), so a
constraint's NAME sitting over an assertion that cannot fail is the cardinal sin — and two of this
session's 21 constraints have no Tier-2 test at all. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Invoke ecc:pr-test-analyzer (every fix here is precisely "does this test redden?")
AND security-reviewer (MAJOR-6 is the only tenancy boundary in the range that is NOT RLS).

BUILD:

- MAJOR-4 — lib/learning/orchestrator.test.ts:449-475. The test named "replayed tick
  (LEARN-TICK-IDEMPOTENT)" stubs mockClaimPostEditSignals .mockResolvedValueOnce([signalRow])
  .mockResolvedValueOnce([]) — the second tick is GIVEN an empty batch, so it proves "an empty claim batch
  is a no-op", presupposes the replay claims nothing, and would not redden if the orchestrator were
  changed to increment. The Reviewer offered (a) rename + re-map, (b) a real replay, and prefers (b).
  DO (b): return the SAME signalRow from BOTH claims and assert recomputeAndUpsertPattern receives an
  IDENTICAL (not cumulative) observation_count on both invocations. Keep the empty-batch case too, renamed
  to what it actually proves. Confirm the new test REDDENS if recompute is mutated to increment.

- MAJOR-6 — add a Tier-2 test to orchestrator.test.ts that claims TWO rows for TWO DISTINCT businesses in
  a single tick and asserts: (a) each recomputeAndUpsertPattern call carries its own row's business_id;
  (b) summarizeBusinessLearning is called once per business with the matching id; (c) neither business's
  human_content appears in the other's call arguments. runLearningTick runs entirely under a service-role
  client — RLS is BYPASSED — so the business_id threaded through each call is the whole boundary, and
  today only 'biz-1' appears anywhere in that file. This must redden on any future closure-capture or
  shared-variable refactor (the bug class Session 24-D's MAJOR-1 closed elsewhere). ADR §14 lists
  [sec-Q2] as "Adopted, WITH A TEST OBLIGATION" — this discharges the outstanding half.

- MINOR-2 — the Tier-2 halves of LEARN-MEMORY-THROUGH-BOUNDARY and LEARN-VOICE-NOT-AUTO-MUTATED are
  UNMAPPED: promote.test.ts and orchestrator.test.ts mock lib/db/memory-performance.ts's exports, so a
  direct .from('performance_memory') added to lib/learning/ would pass silently, as would a
  .from('brand_voices'). Write ONE source-scan test over lib/learning/** (and
  app/api/cron/capture-learning/**) asserting no .from('performance_memory'|'post_ai_originals'|
  'post_edit_signals') and no .from('brand_voice…') outside lib/db/. The pattern exists at
  lib/db/businesses.caller-migration.test.ts and classify.test.ts already uses the technique for
  LEARN-HEURISTIC-FIRST. Then update ADR §13 so constraints #14 and #17 name this test and the app-tests
  job — 21 of 21 mapped, no "unmapped" cell left in the table.

- MINOR-10 — promote.test.ts crosses the 4-vs-5 observation and 1-vs-2 campaign boundaries with other
  inputs fixed, but the confidence gate is exercised only indirectly through two computeConfidence outputs
  that also vary the contradiction count. Add the direct pair:
  meetsPromotionThreshold({observations:5, campaigns:2, confidence:0.69}) → false and 0.70 → true.

VERIFY: for EACH of the four, apply the named mutation locally, confirm RED, revert — and say so in the
resolution row. npm run test:app; tsc clean. Append D3 rows (four findings, one commit).
On commit: "D3 complete — LEARN-TICK-IDEMPOTENT is a real replay asserting a recomputed (not cumulative)
observation_count, empty-batch case renamed to what it proves (MAJOR-4); two-business single-tick test
closes [sec-Q2]'s test obligation on the one non-RLS tenancy boundary (MAJOR-6); source-scan test maps the
Tier-2 halves of LEARN-MEMORY-THROUGH-BOUNDARY and LEARN-VOICE-NOT-AUTO-MUTATED — ADR §13 now 21 of 21
(MINOR-2); confidence gate boundary-isolated at 0.69/0.70 (MINOR-10). All four verified to redden on
mutation." Then stop.
```

#### D4 — MINOR-3, MINOR-4, NIT-4: make the canonical tick line tell the truth

```
CORRECTION — Session 25-D · D4. §11's whole posture is founder-verifiability from ONE log line — a line
that over-reports terminal outcomes and collapses three distinct causes into one counter does not deliver
it. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:silent-failure-hunter (all
three findings are failure-taxonomy defects).

BUILD:
- MINOR-3 — lib/learning/orchestrator.ts:151-160, :173-181, :255-267. abandonRow calls guardedTransition,
  which increments raceLost and returns false on a lost race — but every caller then increments abandoned
  (or skippedNoSnapshot) UNCONDITIONALLY, so one lost race bumps two counters and claims an abandonment
  that did not happen. Branch on guardedTransition's boolean return before bumping the terminal counter.
- MINOR-4 — orchestrator.ts:326-336. summarizeFailed collapses an LLM call failure, a Zod output-parse
  failure (AiError carries .code), and a DB write failure in the upsert loop into one counter with an
  untagged Sentry capture. An operator watching it spike cannot tell an Anthropic outage (transient,
  self-resolving) from a prompt/schema regression (needs a code fix). Tag the Sentry capture with
  `err instanceof AiError ? err.code : 'unknown'` and include that code in the JSON log line.
- NIT-4 — orchestrator.ts:277. summary.failed means "retrying", and sits beside abandoned/promoted/demoted
  in the same object, so anyone alerting on failed > 0 pages on every ordinary transient retry. Rename it
  to `retrying`. If the rename touches the asserted field set in orchestrator.test.ts:481-510, update the
  assertion — that test asserts the FULL §9.5 field set and must keep doing so. Update ADR §9.5's field
  list in the same commit so the doc and the line do not drift.

VERIFY: a Tier-2 test that a lost race increments raceLost and NOT abandoned (confirm it reddens with the
branch removed); a test that an AiError-caused summarize failure carries its .code into the log line; the
existing exactly-one-log-line + full-field-set assertion still passes with `retrying`. npm run test:app;
tsc clean. Append D4 rows (three findings).
On commit: "D4 complete — lost races no longer double-count as abandonments (MINOR-3); summarizeFailed
carries the AiError code in Sentry and in the tick line (MINOR-4); summary.failed renamed to retrying with
ADR §9.5's field list updated (NIT-4)." Then stop.
```

#### D5 — MINOR-5, MINOR-6, MINOR-8: three places where the schema does not enforce what the prose promises

```
CORRECTION — Session 25-D · D5. Each of these is a guarantee that currently lives in caller behaviour
rather than in the database. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer (all three are schema/RPC semantics). Any schema change is a NEW forward migration —
never edit an applied one.

BUILD:
- MINOR-5 — lib/db/post-edit-signals.ts:88-110; 20260726010000_learning_capture.sql:234-246.
  claim_post_edit_signals claims only status='pending' — unlike its sibling claim_deletion_requests it has
  no `OR (status='failed' AND attempts < max)` clause — while ADR §9.4's prose describes a retry path
  THROUGH 'failed'. The orchestrator routes around this by sending transient failures back to 'pending',
  which is safe AS CURRENTLY WIRED, but 'failed' stays a legal transition target, so any future writer
  parking a row there strands it forever. Choose ONE and state which: (i) remove 'failed' from
  LEGAL_TRANSITIONS' reachable targets and amend ADR §9.4's prose to match the schema as applied — PREFER
  THIS, it makes the schema and the doc agree and removes the trap rather than servicing it; or (ii) add
  the reclaim clause in a forward migration. Do not do both.
- MINOR-6 — 20260726030000_performance_memory_promotion.sql:61 writes expires_at = now() + 90 days on
  every upsert, and NOTHING reads it: neither listPerformanceMemoryCandidates (memory-performance.ts:11-27)
  nor listDistilledPatternsForSummary (:49-67) filters on it. ADR §7.1's "decay via expires_at with no new
  job" is satisfied literally while the decay does nothing — a 90-day-stale active pattern still reaches
  generation. Add `.or('expires_at.is.null,expires_at.gt.now()')` to listPerformanceMemoryCandidates (the
  generation-time reader). Leave listDistilledPatternsForSummary unfiltered — the summarizer deliberately
  reads its own history back — and say so in a comment.
- MINOR-8 — 20260726030000…sql:157-166 guards demotion on p_net < 3, where p_net is computed in TypeScript
  (promote.ts:135) and passed in: promotion's gates are all evaluated from stored columns and genuinely
  atomic, demotion's trusts the caller's arithmetic. [db-MINOR-3]'s "same rigor as promotion" is not
  literally achieved. Prefer the real fix: recompute the contradiction count INSIDE the function via a
  correlated subquery on the contradicting pattern_key (the TS side already computes that key at
  pattern-key.ts and can pass the KEY instead of the NET). If that proves infeasible, record the asymmetry
  explicitly in ADR §7.4 as a deliberate deviation — but do not leave [db-MINOR-3] reading as achieved.

VERIFY: Tier-1 for whichever of MINOR-5/MINOR-8 changes DB behaviour; Tier-2 for the expires_at filter (an
expired active row is NOT returned by listPerformanceMemoryCandidates; a null-expires_at row IS — confirm
the first reddens with the filter removed). npm run test:db; npm run test:app; tsc clean.
Append D5 rows (three findings; each row must name which option was taken and why).
On commit: "D5 complete — 'failed' <removed from reachable targets | made reclaimable> with ADR §9.4
aligned (MINOR-5); expires_at now filters the generation-time read, summarizer read deliberately exempt
(MINOR-6); demotion threshold <recomputed in-function | asymmetry recorded in ADR §7.4> (MINOR-8)." Then
stop.
```

#### D6 — MINOR-1, MINOR-9, MINOR-11 + NIT-1, NIT-2, NIT-3, NIT-5, NIT-6, NIT-7: the truth-in-documentation pass

```
CORRECTION — Session 25-D · D6. Nine findings, all of the form "a document, comment or count says
something the code does not". Run /ecc:plan → /ecc:verification-loop (little TDD surface here). Invoke
ecc:comment-analyzer (this is comment/doc accuracy at scale) AND typescript-reviewer (MINOR-1's cast hole).
These land as DIFFS against D0's commit — that is why D0 ran first.

BUILD:
- MINOR-1 — rehydrateSignals() (lib/learning/rehydrate.ts) has NO production caller; git grep matches only
  the file and its test. It is correct, well-built and tested in a vacuum. Worse, PostEditSignalRow.signals
  is typed Record<string, unknown> | null (lib/db/types.ts:839), so a future reader can write
  `row.signals as unknown as ClassifyResult` with zero compiler complaint — "MUST route through
  rehydrateSignals()" is a comment, not a constraint. Add a Tier-3 entry to ADR §12 recording that no
  production reader exists yet and that rehydrateSignals is the MANDATORY entry point when one is added,
  so the next reviewer has a named check instead of rediscovering it by grep. (Do NOT invent a production
  caller to justify it — that would be scope creep into a reader Track C deliberately does not ship.)
- MINOR-9 — ADR §3.4's caller table cites actions.ts:94 (actual :97), actions.ts:218 (actual :221),
  generate.ts:362 (actual :380), and lists actions.context-equivalence.test.ts as covering
  bulkApprovePostsAction, which it DOES NOT (that file's only describe is regeneratePostAction; the match
  is a vi.fn() mock declaration at :53). Correct all four. This is the table whose entire purpose is to be
  trusted at face value by the next reviewer — a false citation in it is the exact thing SHARED-FUNCTION
  CALLERS exists to stop. Re-derive each line number at the CURRENT sha, not at d7cee4a5, and say which.
- MINOR-11 — lib/ai/prompts/post-generation.ts:179 and post-regeneration.ts:147 route topContent through
  neutralize() (correct) but neither truncates, unlike wrapEvidenceForPrompt's EVIDENCE_MAX_CHARS and the
  summarizer's token budget. Both live writers are bounded today (Tier-0's renderPatternStatement is a
  fixed template; the summarizer is capped at 200 chars by Zod), so do NOT add a cap now — record it as a
  tracked follow-up row in ADR §15 (and backlog.md) stating the trigger condition: the FIRST writer that
  puts a synthesized, unbounded value into performance_memory.pattern must enforce its own length bound at
  write time. The point is that it stops being re-litigated each session.
- NIT-1 — "eleven kinds" is TWELVE (classify.ts:41-53 = 9 preference + 1 correction + 2 inconclusive). Fix
  the count in all five places: ADR §0/Q4, §4.3, §12, §13, and orchestrator.ts:62's comment (which also
  conflates the total with PreferenceKind's 9 — say 9 preference kinds there, not eleven, not twelve).
- NIT-2 — ADR §10.4 cites formats/native-generation-prompt.ts as a third topContent render site; it
  renders no topContent at all. Fix the ADR citation to the two real sites. Do NOT rewrite be5779e1's
  commit message — history stands; note in the resolution row that the commit message inherited the ADR's
  stale citation and the work itself was correct and complete.
- NIT-3 — summarize.ts:64-71's computeSummaryPatternKey uses a 32-bit hash. At 5 statements × 8
  calls/month/business the collision probability is negligible and a collision merges two statements onto
  one row rather than corrupting anything. Add a comment recording that the bound was considered, with the
  arithmetic.
- NIT-5 — ADR §14's prose says 28 findings; the table has 27 rows. Recount and fix the prose (or add the
  missing row if one is genuinely absent — check against the source review before assuming the prose is
  the error).
- NIT-6 — CLAUDE.md says "No console.log in committed code" with no carve-out, while this range follows
  the established house structured-JSON pattern exactly (lib/email/orchestrator.ts:146,
  api/cron/publish/route.ts:18,50). Add ONE sentence to CLAUDE.md's Code conventions legitimising a single
  canonical structured-JSON line on a worker/route path until a logger lands, so this stops being re-raised
  every review. Do NOT introduce a logger — out of scope.
- NIT-7 — lib/db/post-ai-originals.ts:24-33 (getLatestRevision) and :38-49 (getPostAiOriginalById) carry no
  business_id filter. The Reviewer confirmed NO exploitable path (the id is service-role-sourced from a
  trusted post_edit_signals row; getLatestRevision runs under an RLS-scoped ctx.client). Add a comment at
  each stating explicitly that tenancy is enforced by the CALLER'S CLIENT, not by the function, so a future
  caller does not assume otherwise. Do not add a parameter — that would be an unmotivated signature change
  on a path with no defect.

VERIFY: npm run test:app; tsc clean; every changed line number re-derived and correct at the current sha.
comment-analyzer clean. Append D6 rows (nine findings, one commit).
On commit: "D6 complete — ADR §3.4's four citations corrected incl. one false test citation (MINOR-9);
rehydrateSignals recorded as the mandatory future entry point in §12 Tier-3 (MINOR-1); topContent length
cap recorded as a triggered follow-up in ADR §15 (MINOR-11); eleven→twelve kinds fixed in five places
(NIT-1); §10.4's phantom third render site removed (NIT-2); hash bound commented (NIT-3); §14 recount
(NIT-5); CLAUDE.md structured-log carve-out (NIT-6); caller-enforced-tenancy comments (NIT-7)." Then stop.
```

#### D7 — Docs close-out + finalise the reviewer CORRECTION PASS section  ·  no code

```
CORRECTION — Session 25-D · D7. Docs + resolution log only. No .ts, no .sql, no .tsx. Run it AFTER D0–D6
are committed and BEFORE D8 (D8 adds the CI run URLs on top of what you write here). Invoke no build
specialist — this is documentation integrity.

DO — finalise docs/reviews/session-25-reviewer.md:
- The single appended `## CORRECTION PASS (Session 25-D)` section must be complete and attributed: it
  opens with its author, the date, and the range it fixed (717263d2..d7cee4a5, plus the D0–D6 shas).
  Everything above it is the Reviewer's, untouched; everything below is this pass. A reader must be able to
  tell, from any line, which of the two wrote it (CLAUDE.md condition 2). Prove it: `git diff D0..HEAD --
  docs/reviews/session-25-reviewer.md` must show ADDITIONS ONLY, with no deletion or modification above the
  appendix heading. Paste that confirmation into the section.
- Confirm a resolution ROW exists for EVERY finding — MAJOR-1..6, MINOR-1..11, NIT-1..7 (24 rows) — in a
  `| Finding | Step | Fix | Test that now proves it | SHA |` table.
- Record the six things easy to lose:
  1. The D0–D8 ordering rationale — why MAJOR-5 ran FIRST (every later step edits the spec it commits) and
     why CI runs LAST (it must green the corrected range).
  2. The MAJOR-1 + MAJOR-2 founder adjudication — option (a) record + narrow, with the reasoning: option
     (b) would have made live the exact path MAJOR-1's leak sits on. MAJOR-2 was RESOLVED, not declined.
  3. The MAJOR-3 severity split — silent-failure-hunter graded it BLOCKER, the Reviewer regraded it MAJOR
     — and that fixes (a) transaction and (b) allSettled were considered and deferred, with the reason.
     Argued in the appendix; neither original finding edited.
  4. The Reviewer's CORRECTION TO THE C2.9 REPORT (its §5): "192 tests executed, confirmed directly from
     the CI log" is not supportable — test:db runs with --reporter=json --outputFile, which suppresses the
     human summary, and the skip-guard prints a FILE count, not a test count. 192 is the local figure. The
     per-file non-zero guarantee holds; the integer does not come from CI. Record this so the number is not
     re-cited as CI-sourced. (Do NOT edit docs/reviews/session-25-c2.9-verification.md's text — same
     append-only posture; note the correction in this appendix.)
  5. The four SHARED-FUNCTION CALLERS tables the Reviewer published (approvePost, bulkApproveDraftPosts,
     createPosts, neutralize) stay valid after D1–D3 — note any caller whose coverage this pass changed
     (D1 touches listRecentHumanEditExcerpts; D3 adds orchestrator callers).
  6. ADR §13 is now 21 of 21 mapped (MINOR-2 closed the two unmapped Tier-2 halves) — state the before/after
     explicitly, since "19 of 21" is the number the Reviewer's table records.

DO — update the §5 close-out docs (everything that does not need CI):
- docs/decisions/0018-diff-based-learning-capture.md — consolidate the amendments D1/D5/D6 made (§5.3
  trigger scope, §6.1 candidate-only, §7.4 demotion asymmetry if taken, §9.4 'failed', §12 Tier-3
  additions, §13 constraint remapping, §15 tracked follow-up). Amendments APPEND (ADR 0016 Amendment B
  style); the original text is not rewritten.
- docs/decisions/0016-governed-memory.md — §3.4 (performance_memory no longer ships empty — its writer
  exists) and §10 (the "ADR 0018 — the WRITER" deferral is now closed), as an APPENDED amendment.
- docs/decisions/0010-legal-surface.md Amd 2 §D2.5 — confirm the two cascade rows are present and
  annotated (A4 verified them; this is the doc-side confirmation).
- docs/current-phase.md — the "Session 25 CLOSED" block, at Session 23/24 density. Leave the CI/tally lines
  marked "pending D8".
- docs/brainstorm/session-plan-adrs-0016-0018.md — "Track C landed at <D8 sha>; all three tracks of the
  0016–0018 programme are now closed", plus the pointer to Mode 1 (Studio) and Mode 3, deferred until
  Tracks A–C had landed in their shipped shape — a condition now met. Mark the sha pending-D8.
- docs/build-guide/runbooks/qstash-setup.md — confirm the hourly capture-learning row (H6 verified it);
  docs/launch-checklist.md only if a gate row applies.
- OpenWolf: .wolf/anatomy.md (the snapshot/classifier/summarizer/worker files + the three migrations +
  scripts/learning-report.ts); append the session to .wolf/memory.md; add to .wolf/cerebrum.md Key
  Learnings — "the AI-original snapshot is write-once at the DB level, and the write-once trigger is
  BEFORE UPDATE ONLY because a BEFORE DELETE guard would abort GDPR erasure for every business that ever
  generated a post"; "a correction signal cannot reach a voice-directed write — but as of 25-D the
  mechanism that guarantees it is the class filter at the source, not the trigger, and the ADR says so";
  "summarizer output is permanently candidate-only, by decision".
- backlog.md — the MINOR-11 length-cap follow-up if not already there.

VERIFY: git status shows no untracked docs; the reviewer report has exactly one appended, attributed
correction section with a row per finding; the additions-only diff confirmed and pasted.
On commit: "D7 complete — CORRECTION PASS (Session 25-D) section finalised in the reviewer report (24 rows;
ordering, MAJOR-1/2 adjudication, MAJOR-3 severity split, the C2.9 192-tests correction, and 19→21 of 21
constraint mapping recorded; additions-only diff confirmed); ADR 0018/0016/0010 + current-phase +
brainstorm + OpenWolf close-out docs updated (CI URLs and shas pending D8)." Then stop.
```

#### D8 — Execute the corrected range in CI  ·  LAST, by design  ·  no code

```
CORRECTION — Session 25-D · D8. No code. Unlike Session 24-D's D7 there is no open BLOCKER here: the
Reviewer confirmed app-tests 30301920945 and db-tests 30301920885 both green at d7cee4a5, the range head,
with all 20 Tier-1 files visible and non-empty. This step re-greens the CORRECTED range (D0–D7) and moves
the promotion tally.

DO:
- Push the branch and open/update the PR. Require BOTH app-tests AND db-tests green on the FINAL sha.
- OPEN THE db-tests LOG and read it yourself. Confirm every supabase/__tests__ file reports a non-zero
  executed count — including the files D1/D2/D5 touched (performance-memory-pattern-key.test.ts, the new
  orphan test, and any Tier-1 added for MINOR-5/MINOR-8). The skip-guard covers this
  (scripts/ci/assert-no-empty-suite.mjs enforces ≥1 non-skipped assertionResult per file AND fails on any
  status:'failed'), but a suite a flag empties to zero tests is a FALSE-GREEN, not coverage.
- Do NOT restate a test COUNT as CI-sourced. The Reviewer's correction to the C2.9 report stands: test:db
  runs with --reporter=json --outputFile, so the human summary is suppressed and the skip-guard prints a
  FILE count. Report the file count from CI and label any test count as locally derived.
- Paste BOTH run URLs and the db-tests file count into the CORRECTION PASS section of
  docs/reviews/session-25-reviewer.md and into docs/current-phase.md. Backfill the D8 sha into every row
  D7 marked pending (current-phase, brainstorm, the resolution table).
- Update the db-tests promotion tally in docs/current-phase.md. IT STOOD AT 0 OF 3 after Session 24-D, and
  the Reviewer confirmed this range does NOT count: both runs were pull_request-event runs on
  session-22-d, and ADR 0015 §5's rule counts full-green db-tests runs ON MASTER. A pull_request run here
  does not advance the tally either — state that explicitly rather than incrementing. Until 3/3 on master,
  db-tests remains ADVISORY-but-must-be-read: a green run does not yet block a bad merge, and a RED one
  must be READ BY A HUMAN and classified (DB-behaviour regression vs stack OOM), never assumed transient.
- If db-tests is red: classify it before doing anything else. Do not retry hoping for green.

VERIFY: both run URLs recorded; non-zero per-file execution confirmed by reading the log; tally line states
the master-only rule and whether it moved; every CORRECTION PASS row now has a SHA.
On commit: "D8 complete — corrected range executed green in CI; app-tests <url>, db-tests <url>; all
supabase/__tests__ files confirmed non-zero executed by reading the log; promotion tally unchanged at N of 3
(pull_request-event run on a branch — ADR 0015 §5 counts master runs only)." Then stop.
```

### §4.2 — Resolution log

Every correction commit appends a row to the `## CORRECTION PASS (Session 25-D)` section of
`docs/reviews/session-25-reviewer.md`: **finding → step → fix → the test that now proves it → the commit
sha**. Twenty-four rows — MAJOR-1..6, MINOR-1..11, NIT-1..7 — with no gaps, because a finding that was
declined, deferred, or adjudicated the other way still gets a row with its argument. Six things flagged
specifically, easy to lose, and MUST be recorded (D7):

1. **The D0–D8 ordering rationale** — MAJOR-5 first (every later step edits the spec it commits), CI last
   (it greens the corrected range).
2. **The MAJOR-1 + MAJOR-2 founder adjudication** — option (a), with the reasoning that (b) would have
   made live the exact path MAJOR-1's leak sits on. MAJOR-2 was resolved, not declined.
3. **The MAJOR-3 severity split** (silent-failure-hunter BLOCKER vs Reviewer MAJOR) and the two deferred
   alternatives (a)/(b) — argued in the appendix, neither original finding edited.
4. **The Reviewer's correction to the C2.9 report** — "192 tests confirmed directly from the CI log" is
   not supportable; the per-file non-zero guarantee holds, the integer is local.
5. **The four SHARED-FUNCTION CALLERS tables** stay valid after this pass — note any caller whose
   coverage D1/D3 changed.
6. **ADR §13 moves from 19 of 21 to 21 of 21 mapped** — state the before/after, since 19 is the number
   the Reviewer's table records.

### §4.3 — Close-out

After the corrections are green and the resolution log is complete, the founder reviews and the §5 docs are
finalised (D7 wrote most of them; D8 backfilled the CI URLs and the shas). If any correction showed an ADR
0018 constraint infeasible, the ADR was amended (never a test weakened to reach green). Correction passes
are normal, not failures (constitution) — and this one opens on a Reviewer verdict of **no blockers**, on
what that report calls the most carefully built range in the project to date.

---

## §5 — Docs to update at close-out (Track C done — and the programme with it)

Do these at the END, once §2–§4 are green and reviewed — not before. Match the pattern Tracks A and B
used:

- **`docs/current-phase.md`** — a "Session 25 CLOSED — Diff-Based Learning Capture (ADR 0018)" block in
  *What's done*, mirroring the Session 23/24 entries' density; update the status line; and roll the
  `db-tests` promotion tally forward with this session's CI runs (it stood at **0 of 3** after Session
  24-D — every run so far has been a `pull_request`-event run on a branch, and the rule counts full-green
  runs **on `master`**).
- **`docs/decisions/0018-diff-based-learning-capture.md`** — record any amendment the correction pass
  forced, same as ADR 0017 Amendment A / ADR 0014 Amendment A.
- **`docs/decisions/0016-governed-memory.md`** — §3.4 (`performance_memory` no longer ships empty — its
  writer exists) and §10 (the "ADR 0018 — the WRITER" deferral is now closed), as an **amendment**, not
  an in-place rewrite of the original text.
- **`docs/decisions/0010-legal-surface.md` Amd 2 §D2.5** — the cascade row(s) for any new table
  (the migration adds them; this is the doc-side confirmation). If the snapshot landed as a `posts`
  column, note explicitly that it inherits `posts`' existing cascade.
- **`docs/decisions/0011-*` / `0017-*`** — only if Q6 or Q2 amended them (a voice-directed store, or
  brief-diff capture).
- **`docs/brainstorm/session-plan-adrs-0016-0018.md`** — a one-line "Track C landed at `<sha>`; **all
  three tracks of the 0016–0018 programme are now closed**" note, and the pointer to what the plan doc §4
  says comes next: **Mode 1 (Studio)** and **Mode 3 (signal-driven)** ADRs, which were deliberately
  deferred *until Tracks A–C had landed in their shipped shape* — that condition is now met.
- **`docs/runbooks/qstash-setup.md`** — the new tick's schedule row (as the deletion cron's Step 2b was
  added), and `docs/launch-checklist.md` if a gate row applies.
- **OpenWolf:** update `.wolf/anatomy.md` with the new snapshot/classifier/worker files + the migration;
  append the session to `.wolf/memory.md`; add the new conventions to `.wolf/cerebrum.md` Key Learnings
  (e.g. *"the AI-original snapshot is write-once at the DB level — a human edit must never clobber it"*;
  *"a correction signal can never reach a voice-directed write — it is structurally excluded, not
  branched around"*; *"one LLM call per approved post is the wrong architecture — summarization is
  batched, per business, per period"*).
- **`docs/build-guide/session-26.md`** — when Mode 1 (Studio) or Mode 3 is scheduled, author it the same
  way, now that governed memory, the brief pipeline, and the diff-capture loop all exist in their real
  shipped shape.
