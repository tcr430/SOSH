# Session Plan — ADRs 0016–0018 (Governed Memory & Mode 2 Upgrade)

> Execution plan for `campaign-modes-architecture-and-build-plan.md` and
> `intelligence-layer-memory-mining-rubric-opportunity-feed.md`, following the
> constitution's Architect → Builder → Reviewer pattern (separate sessions, correction
> passes as needed — normal, not a failure signal). Scoped to Phases A and B of the
> build plan only: the Mode 2 upgrade and the diff-based learning capture. Mode 1
> (Studio) and Mode 3 (signal-driven) are deliberately excluded — see §4.

---

## 1. Dependency graph

```
ADR 0016 (governed memory foundation)
    │
    ├──> ADR 0017 (Mode 2 upgrade)            — reads via lib/memory/
    │
    └──> ADR 0018 (diff-based learning capture) — writes into lib/memory/
```

0017 and 0018 do not depend on each other. 0018 needs only the `posts` table (a
snapshot column, plus the existing atomic state-transition guard) — it does not need
0017's format-family schemas. Both, however, depend on 0016 landing first, since 0017's
brief assembly needs scoped retrieval to exist, and 0018 needs somewhere governed to
write learnings.

Sequential execution (0016 → 0017 → 0018) is recommended, consistent with this
project's observed one-branch-at-a-time session convention. Once 0016 has shipped and
been reviewed, 0017 and 0018 could run in either order, or loosely in parallel on
separate branches, if the pace of work justifies it — noted as an option, not the
default plan below.

---

## 2. Session-by-session plan

### Track A — ADR 0016: Governed memory foundation

- **Session A1 (Architect).** Produce ADR 0016 only — no code. Covers: the `lib/memory/`
  module boundary (one file per memory type: brand, voice, evidence, audience,
  performance, relationship); the retrieval/learning/generation separation; the
  memory-record schema (source, confidence, sensitivity, scope, expiry — per the
  intelligence-layer document §1); migration shape for new memory tables, including
  their RLS policies and their entry in the erasure-cascade table (constitution
  requirement — every business-scoped table needs both). Ends with the ADR document and
  a single confirmation line.
- **Session A2 (Builder).** Implement ADR 0016: migrations (tables + RLS + cascade
  entry), `lib/memory/*.ts` retrieval functions (`retrieveRelevant(businessId,
  queryContext, limit)` per type), rewire `buildCustomerContext` in `lib/ai/context.ts`
  to call into `lib/memory/*` instead of the current fixed fan-out queries for the
  sections that should be scoped rather than exhaustive. Tests: Tier-1 (app-layer) for
  retrieval scoring/capping logic, Tier-1 (DB-behaviour) for RLS on the new tables.
- **Session A3 (Reviewer).** Review at the exact commit range (per PROC-REVIEW-AT-COMMIT)
  — `database-reviewer` for RLS/migration correctness, `typescript-reviewer` for the
  new module boundary, `security-reviewer` for the new tables' tenancy isolation.
- **Session A3-D (correction pass, if the Reviewer surfaces blockers/majors).**

### Track B — ADR 0017: Mode 2 upgrade *(depends on Track A landing)*

- **Session B1 (Architect).** Produce ADR 0017 only. Covers: the campaign `origin` field
  and post `role` enum; the brief artifact schema and its critique gate; the
  format-family output schemas (single-post and thread first — carousel/script deferred
  to when those platforms are actually prioritized); the hook-refinement Tier-2 loop;
  the deterministic post-generation consistency pass (role-coverage check, link
  placement rule). Names which existing files it touches (`lib/ai/context.ts`,
  `lib/ai/prompts/post-generation.ts`, `lib/ai/runner.ts`, the campaigns/posts schema).
- **Session B2 (Builder).** Implement ADR 0017: schema migration (`origin`, `role`),
  new brief-generation prompt + critique-gate prompt in `lib/ai/prompts/`, split
  `postGenerationPrompt`'s output into format-family schemas, hook-refinement loop,
  deterministic consistency pass. Tests per the existing fixture-based pattern in
  `lib/ai/__fixtures__/`.
- **Session B3 (Reviewer).** `typescript-reviewer` and `database-reviewer` for the
  schema change; a security pass on the brief-pinning mechanism specifically (make sure
  pinned evidence citations can't be used as a prompt-injection vector the way
  `special_instructions` already is guarded via `[DATA]` tags and `sanitizeDataField`).
- **Session B3-D (correction pass, if needed).**

### Track C — ADR 0018: Diff-based learning capture *(depends on Track A landing; independent of Track B)*

- **Session C1 (Architect).** Produce ADR 0018 only. Covers: the `ai_original` snapshot
  column (or history table) and where it's set; the async worker design (matching the
  existing publishing/metrics worker pattern); heuristic-first classification rules
  (word-list matches against `avoid_words`, length/hashtag/CTA deltas); the
  correction-vs-preference tagging rule; the confidence-aggregation threshold that gates
  promotion into memory (a single diff must not change future generation).
- **Session C2 (Builder).** Implement ADR 0018: migration for the snapshot field, the
  async diff-and-classify worker, the periodic batch LLM summarization job, the
  write-back into `lib/memory/performance.ts` / `lib/memory/voice.ts`.
- **Session C3 (Reviewer).** `database-reviewer` for the async worker's data path,
  `typescript-reviewer`, and a check that the correction/preference split is actually
  enforced (not just documented) before anything writes into voice memory.
- **Session C3-D (correction pass, if needed).**

---

## 3. Session count

- **Minimum**: 9 sessions (3 tracks × Architect + Builder + Reviewer), assuming every
  Reviewer pass comes back clean.
- **Realistic**: 9–12+, once correction passes are counted — per the constitution,
  correction passes are normal, not failures, and every foundational piece built so far
  in this project has needed at least one.

---

## 4. Deliberately deferred (not in this plan)

- **Mode 1 (Studio)** and **Mode 3 (signal-driven campaigns)** do not get ADRs yet.
  Both explicitly reuse mechanisms Tracks A–C are still building (the rubric, the brief
  pipeline, the diff-capture pipeline) — writing their ADRs now risks staleness once
  those foundations exist in their actual shipped shape rather than their designed one.
  Resume ADR work for these once Tracks A–C have landed and been reviewed.
- **Media generation** (`media-generation-editor-phase-2-brainstorm.md`) is explicitly
  Phase 2 and out of this plan entirely.

---

## 5. Where this fits relative to current work

The active branch (`session-22-*`) is closing out ADR 0015's test-execution-integrity
findings. This session plan is the next queued work stream — worth a line in
`docs/current-phase.md` once Session 22's work lands, so a future session picks up
Track A without re-deriving this plan from the strategy docs.

**Update (Session 24-D, 2026-07-25):** Track B (ADR 0017, Mode 2 upgrade) landed — B2.0–B2.7 built,
Session 24 reviewed, Session 24-D correction pass (D0–D7) closed every finding including BLOCKER-1:
PR [#2](https://github.com/tcr430/SOSH/pull/2) ran both `app-tests` and `db-tests` green
(`docs/current-phase.md`, 2026-07-25 entry). Track B's range SHA (D7, the correction-pass close-out commit) is `93454d94`.
Track C (ADR 0018, diff-based learning capture) is the remaining queued work from this plan — not yet
started.
