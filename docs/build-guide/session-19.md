# Session 19 — Voice Model, Calibration & Variations

> **Goal:** Ship the voice-model overhaul — lock the 7-axis voice vector as source of truth, the deterministic translation layer that feeds the generator, the AI-set-then-calibrated onboarding flow, and campaign-selectable variations — then transcribe it to code as a **full replacement** of the old brand-voice surface.
> **Models:** Architect = Opus (Part A, produces the ADR). Builder = Sonnet (Part B). Reviewer = Opus (Part C, held back).
> **Plugins / commands:** `claude-mem` throughout. Part A: ECC `/everything-claude-code:plan` only (design doc — no `:tdd-workflow`/`:verification-loop`). Part B: `/everything-claude-code:plan` → `:tdd-workflow` → `:verification-loop`; `impeccable-design-and-taste` postures are embedded in the BP6 prompt body (it is not CC-stack-compatible, so not invoked).
> **Phases:** A — Architect → ADR 0011 (produced, then corrected to **Rev B** via R1–R5). B — Builder → nine `plan / tdd-workflow / verification-loop` prompts (in this file). C — Reviewer (Opus) → tiered findings report. D — Correction pass. Each phase boundary needs explicit confirmation; `/exit` between phases.
> **Source of truth for Part B:** `docs/decisions/0011-voice-model.md` **Rev B**.

---

## Why an ADR before the Builder

Voice is moving from unstructured prose (`tone text[]`, `target_audience`, …; ADR 0001 §2) to a **7-axis numeric vector as source of truth**, with a deterministic translation layer, a calibration flow, and campaign-level variations. Three things can break badly if the Builder invents them: (1) the vector→prompt seam (get it wrong and either the generator changes or output quality regresses), (2) the divergence-proportional delta mechanic (get it wrong and the calibration feels either cosmetic or like it overrides the AI read), (3) the schema shape for variations and their campaign selection. ADR 0011 locks all three so the Builder transcribes and invents nothing.

The single highest-leverage outcome, settled in **Rev B**: the deterministic `descriptor` the vector produces becomes the generator's voice input via **exactly one additive voice block** in the ADR 0004 prompt — the output schema is untouched, `tone[]` is demoted to a display/compat cache, and the raw integers never enter the prompt. Bounded change, not zero change — and not a parallel surface.

---

## What this session produces

- **ADR 0011 Rev B** — `docs/decisions/0011-voice-model.md` (Part A).
- The full voice-model transcription (Part B): schema + RPC, the deterministic translate / calibration / variations modules, the assessment rubric, the editor, campaign wiring, and the old-path teardown. Cut-line: refine-from-posts (BP9).

## What this session does **not** produce

- No Reviewer *run* — Part C contains the Reviewer prompt, but the audit itself executes against the Builder commit (Opus, fresh session).
- No final tuning of band thresholds, the `k` divergence curve, or the per-option / perturbation target vectors — starter values ship; numeric tuning is post-Builder (D-C).
- No brand-voice **versioning** (Phase 2). The variations table is a hook for it, not an implementation.

---

## §0 — Architect-level decisions (ADJUDICATED — encoded in the prompt)

The locked UX decisions (L-1…L-13) and these five Architect-level decisions are all settled. Encoded in the Architect Prompt as resolved; the Architect documents each with Options Considered + named loser, but does not re-open.

- **D-A — `voice_axes` storage → `jsonb`, NOT NULL, with a DB CHECK validating all 7 keys present and each integer `0–100`, plus the app-layer Zod guard at `lib/db/voice.ts`.** Reasoning: the vector is always read and written as a *unit* (assessment, calibration, translation, variations never touch one axis), so the house pattern for related-values-as-a-bag — `tone text[]`, `keywords text[]` — points at unit storage, not 7 exploded columns. Named keys (`formal_casual`, not an index) rule out a bare `smallint[]`. The one real weakness of jsonb — no DB-enforced invariant, against a schema that CHECKs *everything* — is closed by the structural CHECK, so we keep unit storage **and** the database guarantee. Same column shape in `brand_voices` and `brand_voice_variations`. *Named loser:* 7 `smallint` columns — gives per-axis CHECK for free but duplicates 14 column defs across two tables, reconstructs an object on every read, and buys per-axis queryability that no Phase 1 flow uses (YAGNI).
- **D-B — 5-variation cap → atomic SQL function (RPC) `create_voice_variation(...)` that locks the parent `businesses` row, counts, and inserts-or-raises a typed error; surfaced through `lib/db/voice.ts`.** Reasoning: this mirrors the precedent already set in migration 25 (the brand-voice attempt counters became "single client.rpc() calls to atomic SQL functions") and the enforced convention "atomic state transitions using conditional WHERE guards." App-layer count-before-insert has a TOCTOU race (two concurrent inserts each count 4, both insert → 6); the atomic RPC is race-safe under the row lock and gives clean error semantics. *Named loser:* plain `BEFORE INSERT` trigger — workable but needs its own locking to be race-safe and yields fuzzier error surfacing than a named RPC; the RPC matches existing house precedent.
- **D-C — tuning constants → lock STARTER values** (bands `0–30 / 31–69 / 70–100`, a bounded `k` curve, question-bank copy + per-option target vectors); numeric tuning happens post-Builder against generated-output quality. *Accepted.*
- **D-D — refine-from-posts → build as the explicit cut-line** (Session 19B B9, independently shippable). *Accepted.*
- **D-E — module boundary → deterministic trio (translate / calibrate / variations) under `lib/voice/`** outside the AI gateway; assessment prompt under `lib/ai/prompts/`. *Accepted.*

---

## Locked UX decisions (encoded in the prompt — do not re-open)

| # | Lock |
|---|---|
| L-1 | Vector is **source of truth**; translation layer derives prose voice fields from it. |
| L-2 | Website assessment sets the **starting** vector; questions refine. Assessment failure ⇒ neutral (all `50`), questions carry the load. |
| L-3 | Per-answer deltas are **divergence-proportional**: confirming moves little, contradicting moves more; bounded so no single answer overrides the AI read. |
| L-4 | Each question targets **2–3 axes**, not all 7. |
| L-5 | Options are **positioning statements**, not axis ratings. |
| L-6 | Scales render as a **labelled track + dot, no numbers**. |
| L-7 | Must/cannot words appear **at the end**, pre-filled, editable (→ `keywords` / `avoid_words`). |
| L-8 | One **reusable editor** (onboarding step 2 + settings); sliders read-only through the flow, **unlock only at the final step**. |
| L-9 | Calibration questions are **static** (curated bank, hand-authored target vectors, pre-translated EN/PT/ES). No per-user AI generation of questions or vectors. |
| L-10 | Variations are **campaign-level presets**: `campaigns.voice_variation_id`; null = base. |
| L-11 | Variation suggestions are **deterministic perturbations** of the base (mood-named: Bolder / Buttoned-up / Warmer / Sharper / Thought leader), one click to add, then rename + drag. Cap **5** (excluding base). |
| L-12 | Signal sources: website + pasted samples now; connected-account "refine from recent posts" reuses the same assessment call. Both count against the trial assessment cap. |
| L-13 | Mobile stacks: questions first, scales as sticky collapsible summary. |

---

## Pre-session checklist

- [ ] `current-phase.md` reflects Session 18 closed (18B-5D clean).
- [ ] `session-18.md` committed to `docs/sessions/` (B18-088) so the Architect can read locked priors directly rather than infer.
- [x] §0 D-A…D-E adjudicated (encoded in the prompt below).
- [ ] Architect has read: `CLAUDE.md`, `0001-database-schema.md` §2/§4, `0003-ai-layer.md` §11–§13, `0004-post-generation.md` (brand-voice consumption), `current-phase.md`.

---

## Part A — Architect Session (Opus 4.7)

### How to run — one stop

1. New Claude Code chat, Opus 4.7, claude-mem on.
2. Paste the **Primer**; Architect confirms it has read the files and restates the grounding facts.
3. Paste the **Architect Prompt**. Architect runs `/everything-claude-code:plan` first, presents the ADR section scaffold, and **waits for your approval**.
4. Architect writes `docs/decisions/0011-voice-model.md` in one pass.
5. **STOP.** Do not draft the Builder prompt in this session. Read ADR 0011 end-to-end against the red-flag list below. Expect 1–2 redirect cycles on the translation seam and the delta rule.

### Primer

```
You are the Architect for SŌSH Session 19 — the Voice Model.

Read before anything else and confirm:
- CLAUDE.md (architectural conventions — lib/config, lib/db, AI gateway
  boundary, no process.env outside config, date-fns formatISO, LIMIT/ORDER BY)
- docs/decisions/0001-database-schema.md — §2 brand_voices, §4 campaigns
- docs/decisions/0003-ai-layer.md — §11 brand-voice inference, §12 SSRF
  fetcher, §13 trial cap (brand_voice_inference_attempts, cap 3)
- docs/decisions/0004-post-generation.md — how the post-generation prompt
  consumes brand voice from ctx.brandVoice
- docs/sessions/session-18.md, docs/current-phase.md

Restate these grounding facts back to me before proceeding:
1. brand_voices already has tone text[], keywords text[], avoid_words text[],
   unique_value_prop (0001 §2). ADR 0004 reads tone/target_audience/keywords/
   avoid_words/unique_value_prop off ctx.brandVoice.
2. writing_examples is capped at 3 by a DB CHECK (cardinality <= 3), 0001 §2.
   The "5" in 0003 §11 prose is superseded by the binding CHECK.
3. campaigns has no voice column today (0001 §4).
4. Trial assessment cap is brand_voice_inference_attempts, 3 per business
   (0003 §13).

Confirm you have read these and are ready for the Architect Prompt.
```

### Architect Prompt

```
ARCHITECT — SESSION 19 — ADR 0011: VOICE MODEL, CALIBRATION & VARIATIONS

Produce ONE markdown file: docs/decisions/0011-voice-model.md.
No code, no migration SQL beyond column specs, no UI. Design doc only.

Run /everything-claude-code:plan first: present the ADR section scaffold,
wait for my approval, THEN write.

=== THE MODEL ===
Voice becomes a 7-axis integer vector (0–100), source of truth. Axes
(0 = first pole, 100 = second pole, 50 = neutral):
  formal_casual, expert_peer, serious_playful, reserved_warm,
  calm_energetic, rational_emotional, exclusive_inclusive

=== LOCKED DECISIONS (do NOT re-open; document as locks) ===
L-1  Vector is source of truth; a deterministic translation layer derives
     the prose voice fields from it.
L-2  Website assessment sets the STARTING vector; calibration questions
     refine. Assessment failure => neutral (all 50); questions carry it.
L-3  Per-answer deltas are divergence-proportional: confirming the current
     position moves the dot little, contradicting moves more; bounded so no
     single answer fully overrides the AI read.
L-4  Each question targets 2–3 axes, not all 7.
L-5  Options are positioning statements ("We're the experts who tell it
     straight" vs "We're peers figuring it out alongside you"), not axis
     ratings.
L-6  Scales render as labelled track + dot, no numbers. Store 0–100.
L-7  Must-include / cannot-include words appear at the END, pre-filled,
     editable. They map to keywords / avoid_words.
L-8  One reusable editor used in onboarding step 2 AND settings. Sliders are
     read-only through the question flow; unlock ONLY at the final step.
L-9  Calibration questions are STATIC: curated bank, hand-authored target
     vectors per option, pre-translated EN/PT/ES. No per-user AI generation
     of questions or option vectors.
L-10 Variations are campaign-level presets selected via
     campaigns.voice_variation_id; null = base voice.
L-11 Variation SUGGESTIONS are deterministic perturbations of the base,
     mood-named (Bolder / Buttoned-up / Warmer / Sharper / Thought leader),
     one click to add, then rename + drag. Cap 5 (excluding base).
L-12 Signal: website + up to 3 pasted writing samples now; a connected-
     account "refine from recent posts" step reuses the SAME assessment
     call. Both count against the trial assessment cap.
L-13 Mobile stacks: questions first, scales sticky/collapsible.

=== ARCHITECT-LEVEL DECISIONS (ADJUDICATED — document with Options Considered
    + named loser, do NOT re-open) ===
D-A  voice_axes storage = jsonb, NOT NULL, with a DB CHECK that asserts all 7
     keys are present and each is an integer 0–100, PLUS the app-layer Zod
     guard at lib/db/voice.ts. Same column shape in brand_voices AND
     brand_voice_variations. Named loser: 7 smallint columns (per-axis CHECK
     for free, but 14 duplicated defs, object reconstruction on every read,
     unused per-axis queryability — YAGNI). Rationale to capture: the vector
     is always read/written as a unit, matching the text[] bag pattern; named
     keys rule out a bare smallint[]; the structural CHECK closes jsonb's only
     real weakness against this schema's CHECK-everything posture.
D-B  5-variation cap = atomic SQL function (RPC) create_voice_variation(...)
     that locks the parent businesses row, counts existing variations, and
     inserts-or-raises a TYPED error; surfaced via lib/db/voice.ts. This
     mirrors migration 25's atomic-counter precedent and the "atomic state
     transitions" convention. Named loser: app-layer count-before-insert
     (TOCTOU race: two concurrent inserts each count 4 → 6). Second loser:
     plain BEFORE INSERT trigger (needs its own locking; fuzzier errors).
D-C  Lock STARTER tuning values (bands 0–30/31–69/70–100, bounded k curve,
     question bank copy + per-option target vectors). Numeric tuning is a
     post-Builder task. Document as starter, not final.
D-D  refine-from-posts = build as the explicit cut-line (Session 19B B9,
     independently shippable).
D-E  module boundary = deterministic trio under lib/voice/; assessment prompt
     under lib/ai/prompts/.

=== REQUIRED ADR SECTIONS ===
1. Context & problem; the 7 axes table.
2. Locked decisions (L-1…L-13) + the adjudicated D-A…D-E.
3. Data model changes:
   - brand_voices: add voice_axes jsonb NOT NULL (per D-A: structural CHECK +
     Zod guard). Existing tone/keywords/avoid_words become MACHINE-WRITTEN
     derived caches, not hand-authored. Backfill existing rows to neutral 50s.
   - NEW brand_voice_variations table: id, business_id (FK CASCADE), name,
     voice_axes, timestamps. UNIQUE(business_id, name). RLS = brand_voices.
     Variations store ABSOLUTE vectors, not offsets (a later base edit must
     NOT retroactively move variations). Cap 5 enforced via the atomic RPC
     create_voice_variation (per D-B), not app-layer count.
   - campaigns: add voice_variation_id uuid nullable FK -> 
     brand_voice_variations ON DELETE SET NULL. Null = base.
   - One additive forward-only migration; no data destruction.
4. THE TRANSLATION LAYER (headline). A PURE, DETERMINISTIC function
   vectorToVoiceFields(axes) -> { tone: string[], descriptor: string }.
   - Deterministic, NOT an AI call. Justify: zero per-generation cost,
     reproducibility for Reviewer + regeneration, no latency/injection on the
     hot path.
   - Banding mechanism: each axis -> 3 bands -> tone tags + descriptor
     fragment; fragments compose. Lock STARTER thresholds + wording.
   - Output routing: writes tone[] (the field ADR 0004 already reads). The
     descriptor reaches the generator via a derived, non-persisted field added
     to CustomerContext assembly in lib/ai/context.ts.
   - STATE EXPLICITLY: ADR 0004's prompt template and output schema are
     UNCHANGED. The only generator-side edit is context assembly. This scope
     guarantee is the point of the whole session — make it loud.
5. Assessment (amend 0003 §11): extend the inference output schema with
   voiceAxes (all 7 keys, int 0–100, required). Inputs unchanged (website
   text via fetchWebsiteText + up to 3 pasted samples — respect the cap-3
   CHECK). Trial cap unchanged; refine is assessment-class and shares it.
   Failure path per L-2.
6. Calibration mechanic: lib/voice/calibration.ts (per D-E), client/server
   pure, no AI. Static bank of 5–6 questions, each 3–4 options carrying a
   hand-authored target vector over its 2–3 axes. Delta rule:
   next = round(current + k*(target-current)), k rising with |target-current|,
   bounded. Lock starter bank copy (EN verbatim) + starter option vectors.
7. Refine from connected posts (per D-D): pull recent posts via the existing
   SocialProvider read path; feed as writing-example-equivalent text into the
   SAME assessment call; same cap. If built, it is the cut-line — must be
   independently shippable.
8. Variations & suggestions: lib/voice/variations.ts deterministic perturbation
   engine; the five mood presets with which axis-clusters each one nudges and
   in which direction; clamp 0–100; one-click add -> brand_voice_variations
   row (via the create_voice_variation RPC) -> rename + drag; cap 5 enforced
   in that RPC. Campaign selection via the voice dropdown on campaign
   create/edit.
9. Reusable editor surface (L-8): two-pane (left questions then must/cannot
   words; right 7-axis track), read-only until final step then draggable;
   onboarding step 2 + settings; mobile per L-13; AI-written "here's the voice
   we read from your site" line atop the calibration panel.
10. Open decisions (D-A…D-E) restated as resolved with rationale + named loser.
11. Consequences: generator untouched; cost profile (calibration/translation/
    variations free; only assessment+refine hit the API under the cap);
    reversibility (additive migration); Phase 2 versioning hook.
12. Evidence (repo-grounded): cite file + section/line for every grounding
    fact (0001 §2 lines 112–129 + 124; 0001 §4; 0004 line 169; 0003 §11–§13).

=== HARD RULES ===
- For every contested decision, give Options Considered + the named loser
  and why.
- The calibration bank copy and option positioning statements are a real
  deliverable: write the EN copy verbatim in §6, do not gesture at it.
- Respect the AI-gateway import boundary (CLAUDE.md): the deterministic trio
  is OUTSIDE lib/ai/.
- Do NOT modify ADR 0004's prompt or output schema. If you find yourself
  wanting to, stop and flag it — that's a design smell, not a step.
- After writing the ADR: STOP. Do NOT draft a Builder prompt. Do NOT start
  Session 19B.

ARCHITECT END
```

### What to push back on (red-flag list for your ADR read)

Before drafting Builder prompts, read ADR 0011 cover to cover with these in mind. Any of the following bounces the ADR back:

- **The translation layer is specced as an AI call.** It must be deterministic (L-1, §4). An LLM in the vector→prose path reintroduces cost, latency, and non-reproducibility on the hot path.
- **ADR 0004 gets touched.** If the ADR proposes any change to the post-generation prompt or output schema, that's the smell — the whole design exists to avoid it. Only context assembly changes.
- **The delta rule is a fixed step.** If §6 makes every answer move axes by a constant amount, calibration is cosmetic. It must be divergence-proportional and bounded (L-3).
- **Variations stored as offsets from base.** They must be absolute vectors (§3) or a later base edit silently rewrites every variation.
- **The 5-variation cap is enforced app-side (count-then-insert).** That's a TOCTOU race; the ADR must enforce it in the atomic `create_voice_variation` RPC under a business-row lock (D-B). Same for `voice_axes` — a structural DB CHECK must back the Zod guard, not replace it (D-A).
- **Questions affect all 7 axes.** Incoherent jitter; correlated axes drift apart. 2–3 axes per question (L-4).
- **Calibration copy is gestured at, not written.** §6 must contain the EN question/option copy verbatim — it's the engagement surface and a real deliverable.
- **The refine step is entangled with the base flow.** It must be the severable cut-line (D-D), not load-bearing.
- **writing_examples cap drifts back to 5.** The binding DB CHECK is 3 (0001 line 124).

---

## Part B — Builder (Sonnet)

> Transcribes ADR 0011 **Rev B** into code. The Architect already produced and ratified the ADR (Part A); Part B turns it into code, including the **full removal** of the old brand-voice surface. Nine paste-ready prompts, each a `plan → tdd-workflow → verification-loop` unit.

> **Commands.** Every BP uses `/everything-claude-code:plan`, then `/everything-claude-code:tdd-workflow`, then `/everything-claude-code:verification-loop`. `:plan` scaffolds and waits for explicit approval; `:tdd-workflow` drives red → green → refactor against the BP's TDD test list; `:verification-loop` runs lint, typecheck, and the scoped vitest invocation until clean.

### Before Part B

- [ ] ADR 0011 **Rev B** ratified and committed to `docs/decisions/`.
- [ ] This guide committed to `docs/sessions/` before the Reviewer runs (avoids the recurring process gap).
- [ ] Confirm the live `brand_voices` table holds **test/demo rows only** (gates the neutral backfill — BP1 / ADR §3.1 cutover caveat). If real voice data exists, BP1's backfill switches to reverse-derivation.
- [ ] `current-phase.md` shows Session 19A (ADR) closed.

### Run order & session hygiene

Linear with one hard gate. Dependencies: BP1 is foundation; BP2–BP5 depend on BP1's types/RPC; BP6 depends on BP2/BP3/BP4/BP5; BP7 depends on BP2/BP5; **BP8 (cutover) must run only after BP1–BP7 verify green** (ADR §13 — new pipeline lands before the old one is cut, no voice-less window); BP9 is the droppable cut-line.

- **Do NOT `/clear` mid-workstream.** Finish `plan → tdd-workflow → verification-loop` for a prompt before moving on.
- **`/exit` and start a fresh Claude Code session between groups:** {BP1–BP5 backend/deterministic} · {BP6–BP7 UI} · {BP8 cutover} · {BP9 refine}. Keeps context clean per group.
- Each prompt ends by printing its sentinel line, then stopping. Confirm green before pasting the next.

---

### Builder Primer

> Paste once at the start of the first Builder session; the Builder restates the invariants, then waits for BP1. Each BP names the docs to (re-)read at that stage.

```
You are the Builder for SOSH Session 19, Part B (Sonnet). You transcribe
ADR 0011 Rev B into code; you do not redesign it.

Read before starting and confirm:
- CLAUDE.md — conventions (env only via lib/config; DB only via lib/db;
  service-role client via lazy import; date-fns formatISO for timestamp
  writes; no unbounded queries; no any; no console.*; all AI SDK calls
  only through /lib/ai/runner.ts; all strings through next-intl).
- docs/decisions/0011-voice-model.md — Rev B, in full (this is the spec).
- docs/sessions/session-19.md — Part B (this file): run order, the nine BP
  prompts, and the per-BP "Read first" list. Read the stage docs named in
  each BP before that BP's /plan.

Restate these invariants back to me before BP1:
1. The 7-axis vector is the source of truth. The deterministic descriptor
   it produces is the PRIMARY voice instruction the generator reads, via
   exactly ONE additive voice block in the ADR 0004 prompt. The ADR 0004
   OUTPUT SCHEMA is unchanged. The raw integers never enter the prompt.
2. tone[] is a written display/compat cache — NOT a generation input.
3. Storage is jsonb + a structural CHECK (all 7 keys, each int 0–100),
   backed by a Zod guard. Not 7 columns.
4. The 5-variation cap is enforced ONLY in the atomic create_voice_variation
   RPC (FOR UPDATE on businesses). No app-layer count. Variations store
   ABSOLUTE vectors, never offsets.
5. translate / calibration / variations are pure, deterministic, and live
   OUTSIDE lib/ai/. Calibration questions are static; assessment is the only
   AI call and is capped (cap 3), with ≤3 writing examples.
6. The old manual brand-voice path is REMOVED (BP8) — but only AFTER the new
   pipeline (BP1–BP7) is green. No voice-less window.

Workflow per BP: /everything-claude-code:plan (wait for approval) →
/everything-claude-code:tdd-workflow → /everything-claude-code:verification-loop.
Confirm the invariants, then wait for BP1. Do not start coding from the
primer alone.
```

---

### BP1 — Schema, RPC & validation foundation (ADR §3, B1+B2)

**Read first (this stage):** ADR 0011 Rev B **§3 (§3.1–§3.4)**; ADR 0001 **§2** (brand_voices) and **§4** (campaigns); ADR 0010 **Amendment 2 §D2.5** (purge cascade); CLAUDE.md (lib/config, lib/db, lazy service-role import, `formatISO`, no-unbounded-query).

```
You are the Builder for SOSH Session 19B — voice schema, the
create_voice_variation RPC, and the VoiceAxes validation guard.

DELIVERABLES:
- One new forward-only migration adding:
  - brand_voices.voice_axes jsonb NOT NULL, default neutral object
    (all 7 axes = 50), with the structural CHECK from ADR 0011 Rev B
    §3.1 (object; all 7 keys present via ?&; each value jsonb 'number'
    and ::int BETWEEN 0 AND 100).
  - brand_voice_variations table per §3.2 (id, business_id FK CASCADE,
    name, voice_axes jsonb + SAME CHECK, created_at, updated_at via the
    shared set_updated_at() trigger). UNIQUE(business_id, name). Index
    on business_id. RLS identical in shape to brand_voices (§3.2:
    business_id IN (SELECT get_user_business_ids()); UPDATE policy has
    both USING and WITH CHECK).
  - campaigns.voice_variation_id uuid NULL, FK -> brand_voice_variations
    ON DELETE SET NULL (§3.3).
  - create_voice_variation(...) RPC per §3.4: SECURITY DEFINER, REVOKE
    from public, GRANT to service_role; SELECT ... FOR UPDATE on the
    parent businesses row; count; RAISE typed error
    (SQLSTATE/message 'voice_variation_cap_reached') if count >= 5;
    else INSERT ... RETURNING *.
  - Backfill: every existing brand_voices row -> neutral vector. Do NOT
    overwrite existing tone[] at migration time.
- Add brand_voice_variations to the purge_business cascade table in
  ADR 0010 Amendment 2 §D2.5 (§3.2) — DOCUMENT the row in this migration.
- lib/validation/voice.ts — Zod guard for the 7-key VoiceAxes object
  (each int 0–100); exported VoiceAxes type. Neutral constant (all 50).
- lib/db/voice.ts — createVoiceVariation() calling the RPC, catching the
  typed Postgres error via the project's isPostgresError guard and
  re-throwing a typed VoiceVariationCapError (§3.4).
- Tests (see TDD list).

WORKFLOW:
1. /everything-claude-code:plan — present the plan; wait for explicit
   approval before /tdd-workflow.
2. /everything-claude-code:tdd-workflow — red → green → refactor.
3. /everything-claude-code:verification-loop — lint, typecheck, scoped vitest.

TDD TEST LIST:
- CHECK rejects: missing key, string-encoded number, value 101, value -1.
- CHECK accepts a full valid neutral object.
- Zod guard mirrors the CHECK (same accept/reject set).
- create_voice_variation: inserts up to 5; the 6th raises the typed cap
  error; concurrent-insert path serialized by FOR UPDATE (assert count
  never exceeds 5).
- VoiceVariationCapError surfaces from lib/db/voice.ts on cap hit.

LOCKED CONSTRAINTS (do not re-litigate — ADR 0011 Rev B):
- jsonb + structural CHECK is the chosen storage (D-A). Do NOT use 7
  smallint columns.
- Cap is enforced ONLY in the RPC (D-B). No app-layer count-before-insert.
- Variations store ABSOLUTE vectors (§3.2). No offset columns.
- All DB access via lib/db/; service-role client via lazy import only;
  timestamps via date-fns formatISO; no unbounded queries (CLAUDE.md).

BUILDER BOUNDARY:
- Do not touch brand_voices' existing columns (tone/keywords/etc.) in
  this migration beyond adding voice_axes + backfill.
- Do not write the translation layer, calibration, or any UI here.
- If the live brand_voices table contains real (non-test) voice rows,
  STOP and output: "Stopping — real voice data present; backfill
  strategy needs adjudication (ADR §3.1 reverse-derivation)."
- If you find yourself wanting to change a §3 spec, stop and output:
  "Stopping — ADR conflict at §<n>. Surfacing for human adjudication."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP1 complete. Awaiting next prompt." Then stop.
```

---

### BP2 — Translation layer + generator wiring (ADR §4, R1/R2/R3, B3)

**Read first (this stage):** ADR 0011 Rev B **§4** — the scope box, **§4.2** (composition), **§4.3** (routing); ADR 0004 (brand-voice consumption + the prompt builder you add the one voice block to); CLAUDE.md AI-gateway import boundary.

```
You are the Builder for SOSH Session 19B — the deterministic translation
layer and its single wiring into the post-generation prompt.

DELIVERABLES:
- lib/voice/translate.ts — pure function vectorToVoiceFields(axes:
  VoiceAxes): { tone: string[]; descriptor: string }. OUTSIDE lib/ai/
  (D-E, AI-gateway boundary). No AI call, no randomness.
- Banding + composition per ADR §4.2 (Rev B):
  - tone[]: non-neutral band tags, axis order, de-duplicated. This is a
    DISPLAY/COMPAT cache (R3) — see boundary.
  - descriptor: the PRIMARY generation instruction (R2). Deterministic
    but PROPERLY COMPOSED: correct articles (a/an — never "A approachable"),
    related axes GROUPED into readable clauses (NOT a flat 7-item list),
    fixed axis order so output is byte-identical per vector.
  - all-neutral case locked: tone ['balanced']; descriptor "A balanced,
    neutral voice with no strong leanings."
- lib/ai/context.ts — buildCustomerContext computes vectorToVoiceFields
  for the active voice (base, or the campaign's selected variation when
  BP7 lands) and sets ctx.brandVoice.descriptor (not persisted).
- ADR 0004 prompt — add EXACTLY ONE voice block interpolating
  ctx.brandVoice.descriptor (R1). Remove tone[] from the prompt's voice
  inputs (R3). PostGenerationOutputSchema UNCHANGED. Do NOT place the raw
  axis integers in the prompt.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Determinism: same vector ⇒ byte-identical tone[] and descriptor (snapshot).
- Article correctness across vowel/consonant leading fragments.
- Grouped composition: descriptor is not a flat "f1, f2, …, and f7" list
  (assert clause structure / separator pattern).
- All-neutral snapshot.
- Generation context: descriptor present on ctx.brandVoice; prompt no
  longer reads brand_voices.tone (grep-style assertion in a unit test or
  a prompt-builder snapshot showing the descriptor block, no tone block).

LOCKED CONSTRAINTS (ADR 0011 Rev B):
- The descriptor is the sole vector-derived voice signal the model sees
  (R1/R3). One prompt block, output schema untouched, no second model
  call, no integers in prompt.
- translate.ts stays pure and outside lib/ai/ (D-E). All AI SDK calls
  remain behind lib/ai/runner.ts (CLAUDE.md).

BUILDER BOUNDARY:
- Do not change PostGenerationOutputSchema or restructure the rest of the
  ADR 0004 prompt — one additive voice block only.
- Do not delete the brand_voices.tone column or its writes (it remains a
  compat cache); only remove it as a GENERATION input.
- If consuming the descriptor seems to require an output-schema change,
  STOP and output: "Stopping — R1 boundary breach. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP2 complete. Awaiting next prompt." Then stop.
```

---

### BP3 — Assessment extension: schema + per-axis rubric (ADR §5, R4, B4)

**Read first (this stage):** ADR 0011 Rev B **§5**; ADR 0003 **§11** (inference prompt), **§12** (SSRF fetcher), **§13** (trial cap).

```
You are the Builder for SOSH Session 19B — extend the brand-voice
assessment to emit the starting vector, with a per-axis scoring rubric.

DELIVERABLES:
- lib/ai/prompts/brand-voice-inference.ts (ADR 0003 §11) extended:
  - Output schema gains voiceAxes (7 keys, z.number().int().min(0).max(100),
    all required) — additive; existing fields unchanged (ADR §5).
  - Prompt BODY gains a per-axis scoring rubric (R4): for each of the 7
    axes, a one-line anchor (low pole ≈0–20 vs high pole ≈80–100 in real
    site/marketing copy), instructing 0–100 scoring from evidence with a
    ~50 default when the site gives no signal. Starter wording (D-C).
- Fixture/golden update for the extended output.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Extended schema parses a full valid object incl. voiceAxes; rejects
  out-of-range / missing axis.
- Prompt body contains all 7 axis anchors (assertion over the rendered
  prompt).
- Trial cap path unchanged: assessment still counts against
  brand_voice_inference_attempts (cap 3); no new counter.
- Input cap: at most 3 writing samples fed (binding DB CHECK), per §5.

LOCKED CONSTRAINTS (ADR 0011 Rev B / 0003):
- Inputs unchanged: website via fetchWebsiteText (SSRF guards) + ≤3
  samples. "Up to 5" prose is superseded by the cap-3 CHECK (§5).
- Failure path: assessment failure ⇒ neutral vector (all 50); never
  blocks onboarding (L-2).
- All AI calls via lib/ai/runner.ts; prompt lives under lib/ai/prompts/.

BUILDER BOUNDARY:
- Do not change the trial cap value or the fetcher.
- Do not add the rubric as a separate model call — it is prompt-body text.
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP3 complete. Awaiting next prompt." Then stop.
```

---

### BP4 — Calibration engine (ADR §6, L-3/L-4/L-9, B5)

**Read first (this stage):** ADR 0011 Rev B **§6**, including the **§6.2 question bank** table; locks **L-3/L-4/L-9**.

```
You are the Builder for SOSH Session 19B — the static calibration bank
and the divergence-proportional delta engine.

DELIVERABLES:
- lib/voice/calibration.ts — pure, client+server, NO AI (D-E):
  - The 6-question bank transcribed VERBATIM from ADR §6.2 (EN canonical;
    leave PT/ES keys wired to the i18n layer, do not invent translations
    here). Each option carries its hand-authored target vector over the
    2–3 axes it targets, exactly as in the ADR.
  - applyAnswer(current, option): for each targeted axis,
    gap = target - current; k = clamp(0.15 + 0.30*(|gap|/100), 0.15, 0.45);
    next = clamp(round(current + k*gap), 0, 100). Untargeted axes unchanged.
    (Starter constants K_MIN 0.15 / K_MAX 0.45 — D-C.)

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Delta is divergence-proportional and bounded: max pull ≤ 0.45*gap; a
  confirming answer (small |gap|) barely moves; a contradicting answer
  (large |gap|) moves more but never reaches the target (no full override —
  L-3).
- Untargeted axes are untouched by an answer.
- Determinism: same (current, option) ⇒ same next.
- Coverage assertion: all 7 axes are targeted across the bank; no
  question targets > 3 axes (L-4).
- Bank integrity: option target vectors match the ADR table (guards
  against transcription drift).

LOCKED CONSTRAINTS (ADR 0011 Rev B):
- Static bank, hand-authored vectors (L-9). No per-user AI generation.
- Numbers are STARTER (D-C) — implement as named constants so tuning is a
  one-file change later.

BUILDER BOUNDARY:
- Do not build UI here (BP6 consumes this module).
- Do not alter the k-curve shape from the ADR; only the constants are
  tunable and they stay named.
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP4 complete. Awaiting next prompt." Then stop.
```

---

### BP5 — Variations engine + persistence (ADR §8, L-11, B7-core)

**Read first (this stage):** ADR 0011 Rev B **§8.1** (the five presets), **§3.2** (absolute vectors), **§3.4** (the `create_voice_variation` RPC).

```
You are the Builder for SOSH Session 19B — the deterministic variation
suggestion engine and its persistence path.

DELIVERABLES:
- lib/voice/variations.ts — pure, NO AI (D-E):
  - suggestVariations(base): the 5 mood presets from ADR §8.1 (Bolder /
    Buttoned-up / Warmer / Sharper / Thought leader) as fixed signed
    offsets applied to base, then clamp 0–100, producing ABSOLUTE vectors
    (§3.2). Omit any preset whose name already exists for the business.
    Suggestions are proposals — nothing persists until the user adds one.
- lib/db/voice.ts — addVariation(...) routes through the
  create_voice_variation RPC from BP1 (cap enforced there), renameVariation
  (UPDATE name, subject to UNIQUE), listVariations, updateVariationAxes.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Each preset applies the ADR §8.1 offsets, clamped, as an absolute vector.
- Determinism: same base ⇒ same suggestion set.
- Name-collision presets are omitted.
- addVariation surfaces VoiceVariationCapError on the 6th (delegates to
  the RPC — no app-layer count).
- Editing the base later does NOT move existing variations (absolute).

LOCKED CONSTRAINTS (ADR 0011 Rev B):
- Cap 5 enforced in the RPC (D-B); engine never counts.
- Absolute vectors only (§3.2). Offsets are computed once, at suggest time.
- Offsets are STARTER (D-C) — named constants.

BUILDER BOUNDARY:
- No UI here (BP6/BP7 consume this).
- Do not reintroduce app-layer cap logic.
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP5 complete. Awaiting next prompt." Then stop.
```

> **Group gate:** BP1–BP5 should all be green before starting the UI group. `/exit`, fresh session for BP6.

---

### BP6 — Voice editor surface (ADR §9, L-6/L-8/L-13, B6)

**Read first (this stage):** ADR 0011 Rev B **§9** and **§6** (the calibration module this consumes); locks **L-6/L-7/L-8/L-13**; CLAUDE.md i18n (next-intl) + shadcn/ui conventions.

```
You are the Builder for SOSH Session 19B — the reusable two-pane voice
editor, used in onboarding step 2 AND settings.

DESIGN POSTURE (impeccable-design-and-taste, embedded — not a CC plugin):
- Quiet, professional, confident. Generous whitespace, restrained motion.
- The per-answer dot movement is animated but understated (this is a B2B
  tool, not a quiz game): a smooth ease, the 2–3 affected axes briefly
  emphasised, no bounce/confetti. Serious-but-engaging.
- shadcn/ui + the motion package (Framer Motion v11) per stack.

DELIVERABLES (behavioral spec from ADR §9 — no business logic re-impl):
- One reusable editor component, two mounts (onboarding step 2; settings).
- Left pane: the §6 calibration questions in sequence (consume
  lib/voice/calibration.ts — do NOT reimplement the delta), then the
  must-include / cannot-include word inputs at the END (L-7), pre-filled
  from assessment, writing to keywords/avoid_words on save.
- Right pane: the 7-axis track — labelled poles + a dot per axis, NO
  numbers (L-6). Read-only through the question flow; sliders unlock ONLY
  at the final step for manual fine-tune (L-8).
- AI-read line atop the calibration panel ("Here's the voice we read from
  your site"), from the assessment (§5), shown before any answer.
- On save: call vectorToVoiceFields (BP2) to write tone[]; write
  keywords/avoid_words; persist voice_axes.
- Mobile (L-13): panes stack, questions first, scales sticky/collapsible.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.
(UI: tests cover the behavioral contract — state machine, read-only→unlock
transition, save payload — not pixel snapshots.)

TDD / TEST LIST:
- Sliders are non-interactive until the final step; interactive after.
- Answering a question calls applyAnswer and moves only targeted dots.
- Save payload writes voice_axes + derived tone[] + keyword fields.
- Mobile stacking renders questions-first with the collapsible summary.

LOCKED CONSTRAINTS:
- Consume BP2/BP4/BP5 modules; do NOT duplicate delta/translation/variation
  logic in the component.
- No numbers on the track (L-6). No drag before the final step (L-8).

BUILDER BOUNDARY:
- Do not remove the OLD voice form yet — that is BP8 (cutover ordering,
  ADR §13). Build the new editor alongside it for now.
- Do not wire campaign selection here (BP7).
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP6 complete. Awaiting next prompt." Then stop.
```

---

### BP7 — Campaign voice selection + generation path (ADR §8.2/§4.3, L-10, B8)

**Read first (this stage):** ADR 0011 Rev B **§8.2**, **§4.3**, **§3.3** (the FK + `ON DELETE SET NULL`); ADR 0004 context assembly.

```
You are the Builder for SOSH Session 19B — campaign-level variation
selection and its read-through to generation.

DELIVERABLES:
- Variation management UI (in the editor/settings surface): list the
  business's variations, accept a suggested preset (one click ->
  addVariation), rename, drag to fine-tune. Cap 5 surfaced gracefully via
  VoiceVariationCapError (no silent failure).
- Campaign create/edit: a voice dropdown (Base + named variations) setting
  campaigns.voice_variation_id; null = base (L-10).
- Generation read-through (§4.3 / §8.2): context assembly loads the
  selected variation's voice_axes when voice_variation_id is set, else the
  base; runs vectorToVoiceFields; the descriptor flows to the prompt block
  from BP2.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Campaign with voice_variation_id set ⇒ context uses the variation's
  vector; null ⇒ base.
- A generated post reflects the selected variation's descriptor (assert
  the descriptor in the assembled prompt differs base vs variation).
- Cap-hit on add surfaces the typed error to the UI layer.
- voice_variation_id is an ordinary updatable CampaignUpdate field (§3.3)
  — not excluded like business_id.

LOCKED CONSTRAINTS (ADR 0011 Rev B):
- Selection is per-campaign via the FK (L-10). No per-platform/per-post
  voice in Phase 1.
- ON DELETE SET NULL: deleting a variation reverts dependent campaigns to
  base (§3.3) — assert this.

BUILDER BOUNDARY:
- Do not add voice signals beyond the descriptor to the prompt.
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP7 complete. Awaiting next prompt." Then stop.
```

> **HARD GATE:** Do not start BP8 until BP1–BP7 are all green. BP8 removes the old path; cutting it before the new pipeline is proven creates a voice-less window (ADR §13). `/exit`, fresh session for BP8.

---

### BP8 — Old-path teardown / cutover (ADR §13, R5, B0)

**Read first (this stage):** ADR 0011 Rev B **§13**, **§3.1** (cutover caveat), **§4.3**; then grep the repo for `brand_voices.tone` / the old voice form before removing anything.

```
You are the Builder for SOSH Session 19B — remove the legacy brand-voice
surface. The new pipeline (BP1–BP7) is in place and green.

DELIVERABLES:
- DELETE the manual brand-voice prose form (the hand-authored tone/voice
  editing UI) and its Server Action / write path. After this,
  brand_voices.tone is written ONLY by the translation layer (BP2).
- REMOVE every code path treating tone[] (or other prose fields) as a
  GENERATION input. Grep the generation path for brandVoice.tone and
  excise; the prompt's voice block reads the descriptor (BP2).
- ROUTE all voice writes (onboarding + settings) through the single vector
  editor (BP6). No second voice editor remains.
- Remove now-dead imports/types/tests tied to the old form.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD / VERIFICATION:
- Grep assertion: no code reads brand_voices.tone as a generation input.
- Only one voice-editing entry point exists (route/component inventory).
- A post still generates correctly through the new path post-teardown.
- No dangling references to the removed Server Action.

LOCKED CONSTRAINTS (ADR 0011 Rev B §13):
- Full cutover: the old path is REMOVED, not deprecated-in-place.
- tone[] remains a written display/compat cache — do NOT drop the column
  or its translation-layer write; only remove its old hand-authored writer
  and its generation-input role.

BUILDER BOUNDARY:
- Do not touch the calibration/translation/variation modules (frozen from
  BP2/BP4/BP5).
- If removing the old path would leave any voice surface unable to write a
  vector, STOP and output: "Stopping — teardown would orphan a write path.
  Surfacing." (No voice-less window.)

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP8 complete. Cutover done. Awaiting Reviewer." Then stop.
```

---

### BP9 — Refine from connected posts (ADR §7, D-D, CUT-LINE) — OPTIONAL

**Read first (this stage):** ADR 0011 Rev B **§7**; ADR 0002 (the existing SocialProvider read path); ADR 0003 **§11/§13** (assessment reuse + the shared trial cap).

> **Droppable.** The voice model is fully usable without this. Build only if the session has room; otherwise it parks as a fast-follow (ADR §7). `/exit`, fresh session.

```
You are the Builder for SOSH Session 19B — the optional refine-from-posts
step. This is the cut-line; it must be independently shippable.

DELIVERABLES:
- A connected-account "refine using your recent posts" action: fetch
  recent published posts via the EXISTING SocialProvider read surface
  (/lib/social/, ADR 0002) — no new platform integration, no direct SDK.
- Feed fetched post text as writing-example-equivalent input into the SAME
  assessment call (BP3 / §5). Cap-3 applies to the equivalent-sample count
  per call.
- Re-run assessment ⇒ updated starting vector; counts against the SAME
  brand_voice_inference_attempts trial cap (L-12).

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Refine reuses the assessment prompt (no new model prompt).
- Refine decrements/charges the same trial cap; blocked when exhausted.
- Works only for connected accounts; no-op/clear message otherwise.

LOCKED CONSTRAINTS (ADR 0011 Rev B §7):
- Reuses §5 assessment; not a new prompt. Reuses the existing
  SocialProvider read path; no new integration.
- Independently shippable — nothing in BP1–BP8 depends on it.

BUILDER BOUNDARY:
- Do not add a new model prompt or a new trial counter.
- ADR conflict ⇒ "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /everything-claude-code:verification-loop is clean, output exactly:
"19B-BP9 complete (cut-line). Awaiting Reviewer." Then stop.
```

---

### After the Builder

- Do **not** start the Reviewer in the same Claude Code session. `/exit` and start a fresh session for the **Part C** Reviewer pass (Opus).
- Update `current-phase.md` to reflect 19B complete (note whether BP9 shipped or parked).
- **Part C** below is the Reviewer pass — paste it in a fresh Opus session to audit the Builder's diff against ADR 0011 Rev B. Findings drive **Part D**.

---

## Part C — Reviewer (Opus)

> Runs after the Builder commits. Audits the diff against ADR 0011 Rev B section by section, produces a tiered findings report, and runs the ECC reviewer agents. The Reviewer writes no code and does not redesign.

### How to run

1. Fresh terminal — `/exit` from the Builder session first.
2. `claude` → `/model` → **Claude Opus**.
3. Plugins: `claude-mem` only. `impeccable-design-and-taste` is **off** (the Reviewer audits taste; it does not apply it).
4. Paste the **Primer**; the Reviewer confirms it has read ADR 0011 Rev B and walked the diff.
5. Paste the **Reviewer Prompt**. It writes a tiered report to `/docs/reviews/0011-voice-model-review.md` and runs the three ECC reviewer agents, folding their findings in.
6. You classify any disputed findings, then either ship to the **Part D** correction pass or accept and close the cycle.

### Primer

```
/resume-session

Read /CLAUDE.md and /docs/current-phase.md.

Read /docs/decisions/0011-voice-model.md — Rev B, END TO END.
This is the contract you audit against.

Read the adjacent ADRs this session touches: 0001 §2/§4
(schema), 0003 §11–§13 (assessment, SSRF, trial cap), 0004
(post-generation prompt + output schema), 0002 (SocialProvider
read path, for BP9), and 0010 Amendment 2 §D2.5 (purge cascade).

Walk the Builder's Session 19 diff from ADR §3 outward — every
file created or modified is in scope: the migration, lib/voice/*,
lib/validation/voice.ts, lib/db/voice.ts, lib/ai/context.ts and
the ADR 0004 prompt builder, lib/ai/prompts/brand-voice-
inference.ts, the editor + campaign UI, and whatever BP8 removed.

You are the Reviewer. Output is ONE markdown findings report,
tiered: BLOCKER (must fix before merge), MAJOR (should fix before
launch), MINOR (would improve), NIT (preference). You write NO
code. You do NOT redesign — the design is locked in ADR 0011
Rev B; disagreement with a decision is a follow-up ADR amendment,
not a finding. For each finding: name the ADR section or CLAUDE.md
convention it violates, quote the offending code/string briefly,
state the expected behavior. No essays.
```

### Reviewer Prompt

```
You are the Reviewer for SOSH Session 19 — Voice Model.

DELIVERABLE: a markdown findings report at
/docs/reviews/0011-voice-model-review.md (create the dir if
missing). Tiered BLOCKER / MAJOR / MINOR / NIT. End with a
one-line verdict: "Ready to ship" / "Ship after correction pass"
/ "Re-architect".

AUDIT AGAINST ADR 0011 REV B, AREA BY AREA. State what you
checked and what you found. A clean area ⇒ say "Clean" and move
on — no padding.

§3.1 brand_voices + storage (D-A).
 - voice_axes is jsonb NOT NULL with the structural CHECK (all 7
   keys present; each value an int 0–100). Missing/weaker CHECK ⇒
   BLOCKER. 7 smallint columns instead of jsonb ⇒ BLOCKER (D-A).
 - lib/validation/voice.ts Zod guard mirrors the CHECK and gates
   EVERY write. An unguarded voice_axes write ⇒ MAJOR.
 - tone[] is written by translation only. If any hand-authored
   writer to tone[] survives ⇒ BLOCKER (that is the old path —
   R5/§13).

§3.2 brand_voice_variations.
 - Stores ABSOLUTE vectors: editing the base does NOT move
   existing variations. Offsets ⇒ BLOCKER.
 - UNIQUE(business_id, name); index on business_id; RLS shape
   identical to brand_voices (business_id IN (SELECT
   get_user_business_ids()); UPDATE has USING + WITH CHECK). Any
   cross-business read/write ⇒ BLOCKER (security).
 - Row added to the purge_business cascade (ADR 0010 Amd 2
   §D2.5). Missing ⇒ MAJOR (GDPR erasure leak).

§3.3 campaigns.voice_variation_id.
 - Nullable FK, ON DELETE SET NULL: deleting a variation reverts
   dependent campaigns to base (null), never blocks the delete or
   removes the campaign. Wrong on-delete ⇒ BLOCKER.
 - The field is tenant-scoped on the campaign update surface; a
   campaign that can point at another business's variation ⇒
   BLOCKER (tenancy).

§3.4 create_voice_variation RPC (D-B).
 - The cap of 5 is enforced ONLY here. Any app-layer
   count-before-insert ⇒ BLOCKER (TOCTOU race — the named loser).
 - SELECT ... FOR UPDATE on the parent businesses row; count;
   RAISE typed error on >= 5. No FOR UPDATE ⇒ BLOCKER (race).
 - SECURITY DEFINER with a PINNED search_path; REVOKE from
   public, GRANT to service_role. Unpinned search_path ⇒ BLOCKER.
 - lib/db/voice.ts re-throws a typed VoiceVariationCapError.

§4 translation layer (R1/R2/R3 — the spine).
 - lib/voice/translate.ts is PURE and OUTSIDE lib/ai/. If it
   imports the AI runner or anything under lib/ai/ ⇒ BLOCKER
   (D-E). No model call, no randomness.
 - Determinism: a snapshot test proves same vector ⇒ byte-
   identical tone[] and descriptor. Missing/failing ⇒ MAJOR.
 - R1: the ADR 0004 prompt gains EXACTLY ONE voice block
   interpolating ctx.brandVoice.descriptor. Two+ blocks, or the
   descriptor never interpolated ⇒ BLOCKER.
 - PostGenerationOutputSchema is UNCHANGED. Any added/removed
   output field ⇒ BLOCKER.
 - R3: the prompt no longer reads brand_voices.tone as a voice
   input. Grep the generation path for brandVoice.tone used as a
   prompt input — expected 0. Anything > 0 ⇒ BLOCKER.
 - Raw axis integers do NOT appear in the prompt ⇒ else MAJOR.
 - R2: descriptor reads as grouped clauses, not a flat
   "f1, f2, … and f7" list, with correct articles (no "A
   approachable"). Flat list ⇒ MAJOR; article bug ⇒ NIT. The
   all-neutral case matches the ADR-locked string.

§5 assessment (R4).
 - voiceAxes added to the OUTPUT schema, additive; existing
   fields unchanged.
 - The prompt BODY carries a per-axis scoring anchor for all 7
   axes. Schema field but no rubric ⇒ MAJOR (noisy seeds — the
   whole calibration refines from this).
 - Trial cap unchanged: assessment still counts against
   brand_voice_inference_attempts (cap 3); no new counter. Cap
   regression ⇒ BLOCKER.
 - At most 3 writing examples are fed (binding CHECK). A path
   feeding 5 ⇒ MAJOR.
 - Assessment failure ⇒ neutral vector, never blocks onboarding
   (L-2). A hard-fail path ⇒ MAJOR.

§6 calibration (L-3/L-4/L-9).
 - Delta is divergence-proportional and bounded:
   k = clamp(0.15 + 0.30·|gap|/100, 0.15, 0.45); a confirming
   answer barely moves, a contradicting one moves more but never
   reaches target (no full override). Fixed-step or unbounded ⇒
   BLOCKER (mechanic broken — L-3).
 - Untargeted axes untouched per answer.
 - Static bank, hand-authored vectors (L-9). Option target
   vectors match the ADR §6.2 table exactly — drift ⇒ MAJOR.
   Coverage: all 7 axes targeted; no question targets > 3 axes
   (L-4) ⇒ else MAJOR.
 - The module makes no API call.

§7 refine (cut-line). If BP9 was parked, mark N/A.
 - Reuses the SAME assessment call — no new model prompt, no new
   trial counter; shares the cap. A second prompt or counter ⇒
   MAJOR.
 - Uses the existing SocialProvider read path; no new platform
   integration / direct SDK ⇒ else MAJOR.
 - Nothing in BP1–BP8 depends on it (severable).

§8 variations.
 - suggestVariations is deterministic; the 5 presets apply the
   ADR §8.1 offsets, clamped 0–100, as ABSOLUTE vectors; name-
   collision presets omitted; nothing persists until the user
   adds one.
 - Campaign selection: a post generated under a campaign with
   voice_variation_id set reflects that variation's descriptor;
   null ⇒ base. Prove base vs variation differ in the assembled
   prompt. No difference ⇒ BLOCKER.

§9 editor (L-6/L-7/L-8/L-13).
 - Sliders read-only through the question flow; unlock ONLY at
   the final step (L-8). Draggable earlier ⇒ MAJOR.
 - No numbers on the track (L-6). Numbers shown ⇒ MAJOR.
 - Must/cannot words at the END, pre-filled, writing
   keywords/avoid_words (L-7).
 - Mobile stacks, questions first, scales sticky/collapsible
   (L-13).
 - The component consumes lib/voice/* — it does NOT duplicate the
   delta, translation, or variation logic. Duplication ⇒ MAJOR.

§13 cutover (R5 — the headline integrity check).
 - The old manual brand-voice prose form and its write path are
   GONE. Two voice editors, or a dead old form in the tree ⇒
   BLOCKER.
 - Exactly one voice-write entry point (route/component
   inventory).
 - Nothing reads brand_voices.tone as a generation input
   (re-confirm from §4).
 - No voice-less window: the new pipeline was in place before the
   old one was removed (BP8 ran last).

CROSS-CUTTING — run the ECC reviewer agents and fold their
findings into the report:
 - /everything-claude-code:typescript-reviewer — no any; shared
   VoiceAxes type; no console.* in committed code; formatISO for
   timestamp writes; the variation-list query is bounded.
 - /everything-claude-code:security-reviewer — RLS on
   brand_voice_variations; RPC SECURITY DEFINER hardening;
   campaign-FK tenancy; the refine path's tenant + SSRF posture.
 - /everything-claude-code:cost-aware-llm-pipeline — assessment
   is the ONLY AI call; translate / calibration / variations make
   ZERO API calls; the trial cap covers assessment + refine; no
   per-generation translation model call.

Close with the verdict line.
```

## Part D — Correction pass (from the 19C findings)

> **Model:** Builder = **Sonnet**. **Plugins:** `claude-mem` + `/everything-claude-code:plan` → `:tdd-workflow` → `:verification-loop`. The tenancy prompt (19D-1) additionally re-runs `/everything-claude-code:security-reviewer`; the UI prompt (19D-4) embeds `impeccable-design-and-taste` postures in its body.
>
> Verdict from 19C: **Ship after correction pass.** The spine conforms; this pass clears 1 BLOCKER, 2 MAJORs, and 5 MINORs — **all addressed, none deferred**. Surgical fixes only: a finding that would require new design is an ADR 0011 amendment, not a correction (this applies to 19D-5).
>
> **Environment:** the 19C review could not run `tsc`/`vitest` (no `node_modules`). Run `npm install` before the first prompt, and let every `:verification-loop` actually execute the scoped suite.

**Findings → prompt map**

| Prompt | Findings | Tier |
|---|---|---|
| 19D-1 | #1 campaign `voice_variation_id` tenancy | BLOCKER |
| 19D-2 | #2 base-voice writes skip the Zod guard (silent swallow) · #4 duplicated axis schema | MAJOR · MINOR |
| 19D-3 | #5 `SETOF`→row cast · #8 `listVariations` no `limit` · #8 `console.error` | MINOR |
| 19D-4 | #6 variation actions miss `revalidatePath` · #7 L-13 mobile not sticky/collapsible | MINOR |
| 19D-5 | #3 refine reads local `posts`, not the SocialProvider read path | MAJOR (severable) |

Run in order; 19D-1 first (BLOCKER). Don't `/clear` mid-prompt. After 19D-5, re-review only the touched surfaces, then close the cycle.

---

### 19D-1 — Campaign variation tenancy (BLOCKER #1)

**Read first:** 19C report §3.3; ADR 0011 Rev B §3.3 + §8.2; ADR 0004 context assembly; CLAUDE.md tenancy + service-role rules.

```
You are the Builder for SOSH Session 19, correction pass 19D-1 (Sonnet).
Fix the §3.3 BLOCKER: a campaign's voice_variation_id is trusted from the
client as a bare UUID and later resolved under service-role, so a crafted
request can point a campaign at ANOTHER business's variation and steer its
generation with that tenant's voice_axes.

DELIVERABLES (two layers — write-time validation AND defense-in-depth read):
- Write-time: in createCampaignAction (campaigns/new/actions.ts:43,123),
  when voiceVariationId is present, confirm it belongs to the acting
  business BEFORE writing — resolve via the RLS-scoped (auth) client, e.g.
  getVariationById(authClient, id) returning null cross-tenant, or a
  listVariations(authClient, business.id) membership check; reject with a
  typed error (e.g. invalid_voice_variation) otherwise. validation/campaign.ts
  keeps the UUID shape; ownership is an action-layer check. Apply the SAME
  guard to any campaign-edit path that can set voice_variation_id.
- Read-time (defense in depth): in buildCustomerContext (lib/ai/context.ts:91)
  the service-role getVariationById has no business filter. Pass the campaign's
  business_id and filter the variation fetch by it (or fetch via a
  getVariationForBusiness(serviceClient, id, businessId)); if it doesn't match,
  fall back to the base voice rather than loading a foreign vector.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow →
:verification-loop. After verify, re-run /everything-claude-code:security-reviewer
on the campaign + context paths and fold any finding in.

TDD TEST LIST:
- createCampaignAction REJECTS a voiceVariationId owned by another business
  (typed error, no INSERT); ACCEPTS the acting business's own variation.
- buildCustomerContext does NOT load a variation whose business_id != the
  campaign's business_id — it resolves to base/neutral instead.
- Same rejection holds on the edit path if one exists.

CONSTRAINTS / BOUNDARY:
- No schema change; this is an authorization fix at the action + context layer.
- Do not broaden scope to other campaign fields.
- If closing the read-time hole cleanly requires an ADR-level change, STOP and
  output: "Stopping — §3.3 fix needs an ADR decision. Surfacing." Otherwise
  implement both layers.

When tests pass and /everything-claude-code:verification-loop is clean, output:
"19D-1 complete — §3.3 BLOCKER closed. Awaiting next." Then stop.
```

---

### 19D-2 — Base-voice write validation + shared axis guard (MAJOR #2, MINOR #4)

**Read first:** 19C report §3.1 (the two findings); ADR 0011 Rev B §3.1 + §10 (D-A); CLAUDE.md "Zod for all input validation before processing."

```
You are the Builder for SOSH Session 19, correction pass 19D-2 (Sonnet).
Fix two §3.1 findings: base-voice writes bypass the shared Zod guard (and one
swallows the throw silently), and the variation actions duplicate the axis
schema locally.

DELIVERABLES:
- lib/validation/voice.ts: expose the canonical guard plus a FormData-safe
  variant — voiceAxesSchema (int 0–100 ×7) and voiceAxesCoerceSchema
  (z.coerce.number()… for string FormData) — from ONE place.
- saveVoiceAxesAction (onboarding step-2/actions.ts:22) and saveBaseVoiceAction
  (settings/voice/actions.ts:61): call voiceAxesSchema.parse(payload.voiceAxes)
  and validate tone / keywords / avoidWords BEFORE upsertBrandVoice. Remove the
  silent `catch {}` in saveBaseVoiceAction — surface a typed validation error
  to the caller instead of returning a successful-looking no-op.
- settings/voice/actions.ts:34: delete the local voiceAxesSchema redefinition;
  import voiceAxesCoerceSchema from lib/validation/voice.ts.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- An out-of-range / malformed voiceAxes payload causes both actions to RETURN a
  validation error — assert it is NOT a silent success/no-op.
- The FormData path parses via the shared voiceAxesCoerceSchema (string "55" →
  55) and rejects "200".
- No local axis schema remains in settings/voice/actions.ts (grep).

CONSTRAINTS / BOUNDARY:
- Don't change the on-disk shape or the DB CHECK; this is app-layer guarding.
- Keep tone/keywords/avoidWords validation consistent with existing schemas.

When tests pass and /everything-claude-code:verification-loop is clean, output:
"19D-2 complete — base-voice guard + shared schema. Awaiting next." Then stop.
```

---

### 19D-3 — Data-layer & logging hygiene (MINOR #5, #8)

**Read first:** 19C report §3.4, x-cut TypeScript; ADR 0011 Rev B §3.4; CLAUDE.md (no `console.*` in committed code; list queries carry a `limit`).

```
You are the Builder for SOSH Session 19, correction pass 19D-3 (Sonnet).
Three small hygiene fixes in the data + assessment layer.

DELIVERABLES:
- lib/db/voice.ts:47 — create_voice_variation RETURNS SETOF, so PostgREST
  returns an array. Change `return data as BrandVoiceVariationRow` to
  `return (data as BrandVoiceVariationRow[])[0]` (do NOT alter the RPC/migration).
- lib/db/voice.ts:71–82 — listVariations has ORDER BY but no limit. Add an
  explicit `.limit(...)` using the variation-cap constant (the same value the
  RPC enforces), per the CLAUDE.md bounded-query rule.
- infer-brand-voice/actions.ts:51 — replace `console.error('[inferBrandVoice]…')`
  with the project's structured logging convention (the canonical JSON log line
  / logger), or remove it. Do NOT touch generate.ts:214 — that console.log is
  pre-existing (Session 18 B18-040), out of scope for Session 19.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- createVoiceVariation returns a single row OBJECT with `.id`/`.name` (not an
  array) — a consumer reading `.id` works.
- listVariations issues a bounded query (limit present).
- No `console.error`/`console.log` remains in infer-brand-voice/actions.ts (grep/lint).

CONSTRAINTS / BOUNDARY:
- No behavioral change beyond these three; no migration.

When tests pass and /everything-claude-code:verification-loop is clean, output:
"19D-3 complete — data-layer + logging hygiene. Awaiting next." Then stop.
```

---

### 19D-4 — UI: variation list revalidation + mobile sticky track (MINOR #6, #7)

**Read first:** 19C report §8/UI and §9; ADR 0011 Rev B §9 (L-13); Next.js `revalidatePath` conventions used elsewhere in the repo.

```
You are the Builder for SOSH Session 19, correction pass 19D-4 (Sonnet).
Two UI corrections.

DESIGN POSTURE (impeccable-design-and-taste, embedded — not a CC plugin):
the mobile track summary is quiet and understated — a slim sticky bar that
shows the current axis positions and expands to the full track on tap. No
flashy motion; this is a B2B settings surface.

DELIVERABLES:
- #6 — the variation add / rename / delete actions (settings/voice/actions.ts)
  do not refresh the list. Add revalidatePath for the settings voice route
  after each successful mutation so the list updates without a manual reload.
- #7 — L-13: on mobile the 7-axis track stacks but is a plain block. Make the
  track column sticky and collapsible on mobile per L-13 (VoiceEditor.tsx:121 /
  AxisTrack wrapper): a sticky summary that the user can expand/collapse;
  questions remain first. Desktop two-pane layout is unchanged.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.
(UI: tests assert the behavioral contract, not pixels.)

TDD / TEST LIST:
- Each variation mutation action calls revalidatePath for the voice settings route.
- The mobile layout renders the sticky/collapsible track wrapper with a
  toggle; questions render before it; desktop layout unaffected.

CONSTRAINTS / BOUNDARY:
- Do not touch the calibration/translation/variation logic (frozen).
- Don't restyle the desktop editor; scope is the mobile affordance + revalidation.

When tests pass and /everything-claude-code:verification-loop is clean, output:
"19D-4 complete — list revalidation + mobile sticky track. Awaiting next." Then stop.
```

---

### 19D-5 — Refine read path (MAJOR #3, severable) — may bounce to an ADR amendment

**Read first:** 19C report §7; ADR 0011 Rev B §7; ADR 0002 (SocialProvider read surface, `/lib/social/`).

```
You are the Builder for SOSH Session 19, correction pass 19D-5 (Sonnet).
Fix the §7 MAJOR: refine reads SOSH's own local `posts` table
(refine-from-posts-action.ts:38, listRecentPublishedPostTexts), which is
circular and misses the user's externally-authored writing. ADR §7 specifies
fetching recent posts through the existing SocialProvider read surface
(/lib/social/, ADR 0002).

DELIVERABLES:
- Replace the local-posts read with a fetch through the SocialProvider read
  surface for the connected account(s), feeding that external post text as the
  writing-example-equivalent input to the SAME assessment call. Keep the cap,
  the ≤3 sample bound, the shared trial counter, and the connected-account
  gating intact.

WORKFLOW: /everything-claude-code:plan (approve) → :tdd-workflow → :verification-loop.

TDD TEST LIST:
- Refine fetches via the SocialProvider read path, not the local posts table.
- Same assessment prompt + shared trial cap; no new counter; ≤3 samples.
- Still severable: nothing in BP1–BP8 imports it.

CONSTRAINTS / BOUNDARY:
- No new platform SDK / integration beyond the existing SocialProvider read API.
- **STOP CONDITION (do not silently substitute):** if the SocialProvider exposes
  NO recent-posts read for connected accounts, do NOT keep the local-posts read.
  STOP and output: "Stopping — §7 read path needs an ADR 0011 amendment: the
  SocialProvider has no external recent-posts read; reading local published
  posts is a deliberate scope reduction to ratify, not a silent default."
  (Tiago then decides: add the read, or amend the ADR.)

When tests pass and /everything-claude-code:verification-loop is clean, output:
"19D-5 complete — refine on SocialProvider read path. Awaiting close." Then stop.
```

---

### Closing the cycle

- Mark each finding resolved in `/docs/reviews/0011-voice-model-review.md` (or a `…-19D.md` addendum).
- Re-review only the touched surfaces; if 19D-5 bounced to a STOP, resolve the ADR-amendment decision before closing.
- Then proceed to Verification.

## Verification

> Run after the correction pass (the 19C review could not execute these — no `node_modules` in its tree):
>
> 1. `npm install`
> 2. `npx tsc --noEmit --skipLibCheck`
> 3. `npx vitest run lib/voice lib/db lib/ai lib/validation app` — translation snapshots, calibration deltas, cap enforcement, the new 19D guards (tenancy rejection, base-voice validation, SETOF→row, bounded list).
> 4. `npm run build`
> 5. Manual walkthrough: assess → calibrate → finalize → add/name variations → select a variation on a campaign → generate (confirm base vs variation differ); attempt a cross-tenant `voice_variation_id` and confirm rejection.

---

## What this unlocks

A structured, low-drag voice surface that **fully replaces** the old brand-voice form, with the generator steered by the deterministic descriptor, plus the campaign-level variation primitive that seats the deferred Phase 2 "brand voice versioning." Remaining pre-launch sequence after Session 19: the Reviewer pass (Part C) and any correction pass (Part D), then back to the launch line — Postiz removal, legal ratification, Stripe live-mode flip.
