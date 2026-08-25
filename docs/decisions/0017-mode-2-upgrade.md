# ADR 0017 — Mode 2 Upgrade (brief-first, format-native, frozen-brief generation)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Track:** B (of the ADR 0016→0017→0018 intelligence-layer programme; `docs/brainstorm/session-plan-adrs-0016-0018.md`). Depends on Track A (ADR 0016) having landed — the brief reads scored/capped memory through `lib/memory/`.
- **Supersedes / amends:** none superseded. Amends ADR 0010 Amendment 2 §D2.5 (cascade table) by row-addition (`campaign_briefs`). Closes out ADR 0016 §6.3/§10 — this ADR is the designated consumer of `retrieveEvidenceMemory` / `retrieveAudienceMemory` / `retrieveBrandMemory`, unwired by design in Track A.
- **Source design docs:** `docs/brainstorm/campaign-modes-architecture-and-build-plan.md` §1 "Mode 2 (upgraded)" + §2 "Phase A" (primary); `docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md` §3 (rubric) + §5 (tiered agency); build guide `docs/build-guide/session-24.md` §0 (Locked L-1..L-11) + §0.1 (the eight questions this ADR resolves).
- **Advisory passes folded in (read-only, no code):** `database-reviewer` (schema/RLS/cascade/backfill), `security-reviewer` (brief-pinning injection path, L-9), `ecc:type-design-analyzer` (format-family + frozen-brief contracts). Their material findings are cited inline (`[db-*]`, `[sec-*]`, `[type-*]`) and consolidated in §14.
- **Scope discipline:** this ADR ships the **Mode 2 upgrade only** — the brief artifact + its critique gate, `origin`/`role` schema, format-family output schemas (single-post + thread), the frozen-brief → N-per-platform generation, the hook Tier-2 loop, the deterministic consistency pass, and the wiring of `evidence`/`audience`/`brand` memory into brief assembly. **Not** Mode 1 Studio, Mode 3 signal/mining/insight cards, Track C diff-learning, carousel/script families, image generation, the skip-review fast path, or the numbered-vs-unnumbered thread preference (§15).

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

Each answer names its loser, its agency tier (L-7), and its test tier (ADR 0015 §2). The Builder consumes these as binding.

| Q | Decision | Loser | Agency / Test tier |
|---|---|---|---|
| **Q1** brief persistence | New table **`campaign_briefs`** (1:1, `UNIQUE(campaign_id)`), mutable-in-place with `version`; SM `draft→critiqued→approved→generated`; `frozen_at` set on approval | JSONB column on `campaigns` (no per-brief RLS, no pinned-evidence home, no revision trail); a revisions child-table now (Track-C pre-build) | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q2** `role` | `posts.role text CHECK` (L-5 vocab), NULL backfill, **write-once via DB trigger** + `PostUpdate` exclusion; tweet-role (L-4) lives in the thread JSON | default old rows to a role (fabricates arc); role in mutable set | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q3** `origin` | `campaigns.origin text CHECK`, **full enum now** (`manual`/`objective_generated`/`signal_generated`), backfill existing → `objective_generated`, required on `CampaignInsert` | second migration for `signal_generated` later; backfill to `manual` (understates adoption) | Tier 0 / Tier 1 (DB) |
| **Q4** format families | `z.discriminatedUnion('format', …)` single-post + thread, in `lib/ai/prompts/formats/`; deterministic Tier-0 platform→family map; **re-prompt in a new generation wrapper**, ceiling 1, via a **per-family Prompt factory** (runner unchanged) | one flat optional-field schema; model-chosen family; re-prompt inside the generic runner | Tier 0 (schema) + Tier 1 (re-prompt) / Tier 2 |
| **Q5** rubric | `Prompt` in `lib/ai/prompts/rubric.ts`, per-dimension `{score,note}` + `critique[]` + `verdict`; **HARD** gate at `BRIEF_QUALITY_THRESHOLD` (ADR constant); same rubric powers nativeness | passive score; SOFT gate; a forked nativeness scorer | Tier 1 (call) + Tier 0 (gate) / Tier 2 |
| **Q6** brief-review UI | **Ship pipeline + schema + Zod Server Actions + a minimal functional brief-review surface**; defer high-touch brief-edit + per-post Studio diff to **Session 24-UI** | full high-touch UI in Track B (design coupled to schema review); no surface (gate un-exercisable) | Tier 0/1 / Tier 2 |
| **Q7** orchestration | New **`lib/campaigns/brief.ts`** owns Stages A–C; `generate.ts` consumes the frozen approved brief for D–F; campaign pauses at `awaiting_brief`, atomic transitions gate generation | inline all stages in `generate.ts` (unreviewable mega-function) | Tier 0 (orch) + Tier 1 (stages) / Tier 1 (DB) + Tier 2 |
| **Q8** consistency pass | Ship role-coverage (Tier 0) + link-placement (Tier 0) + nativeness (rubric); **defer** cross-set redundancy LLM call behind `MODE2-REDUNDANCY-UNDEFER` | ship all three now (unproven per-campaign whole-set call, largely pre-empted by pinning) | Tier 0 + Tier 1 / Tier 2 |

---

## 1. Context + decision summary

### 1.1 What `generatePostsForCampaign` does today

`generatePostsForCampaign` (`lib/campaigns/generate.ts:29-247`) is a 12-step service-role orchestrator:

```
STEP 3   load + validate campaign; idempotency guards:
           campaign.status !== 'draft'         → already active   (generate.ts:54)
           existingPosts.length > 0            → already_generated (generate.ts:63-71)
STEP 4   buildCustomerContext(businessId, voice_variation_id)     (generate.ts:83)
STEP 6   compute per-platform schedules (canonical order)         (generate.ts:106-128)
STEP 7   for each platform: runPrompt(postGenerationPrompt, ctx, input)  (generate.ts:138-174)
STEP 8-9 build PostInsert rows → single batch createPosts          (generate.ts:177-207)
STEP 10  activateCampaign(client, campaignId, postsCreated)
           — ATOMIC guard .eq('status','draft')                    (generate.ts:210)
STEP 11-12 increment trial counter; mark session complete
```

Each platform call runs `postGenerationPrompt` against **one flat schema** —
`PostGenerationOutputSchema = { posts: [{ content, hashtags, scheduledAt, rationale }] }`
(`lib/ai/prompts/post-generation.ts:29-40`). There is **no brief, no post roles, no format families,
no rubric, no hook loop, no consistency pass**. "Native" is only *prompted for* — the twitter entry
carries a prose note "single tweet < 260 chars OR thread up to 5 tweets … return as one string with
`\n\n---\n\n` separating tweets" (`post-generation.ts:48-51`); nothing structurally guarantees a thread
is a thread. The runner retries only 429/5xx (`runner.ts:39-53`) and **throws `invalid_response`
without re-prompting** on a `safeParse` failure (`runner.ts:146-155`).

### 1.2 Why one-shot "objective → finished posts" is the problem

1. **Indistinguishable from a competitor's magic button.** Objective goes straight to finished copy;
   there is no reviewable strategy the user can shape — the exact "AI wrote my posts" experience the
   product means to replace with "AI proposed a strategy I can shape" (L-2).
2. **Coherence is hoped for, not guaranteed.** Each per-platform call re-derives its argument from the
   raw objective, so a LinkedIn post and an X thread drift — different evidence, redundant framing, no
   sense they are two moves in one argument.
3. **Nativeness is a prompt request, not a structural property.** The flat schema cannot represent a
   thread as anything but a delimiter-joined string; a carousel is unrepresentable. `safeParse` cannot
   reject prose-where-a-thread-was-expected, because both are just `content: string`.
4. **No narrative arc.** N posts share an objective but carry no role, so portfolio analytics cannot
   say "this campaign is four announcements and no proof" (L-5).

### 1.3 The fix (and its losers — D-1..D-7)

Insert a first-class, human-reviewable **brief** *before* any copy exists (D-1: Mode 2 upgrade only,
not Mode 1/3/mining/diff-capture). Guarantee nativeness with **format-family discriminated schemas**
(D-3, over a flat schema; D-6 single-post + thread only, carousel/script deferred). Achieve coherence
by **freezing the brief** and issuing **N independent per-platform calls** from it (D-2, over
per-platform re-derivation *and* over one joint all-platforms call). Score with **one shared rubric**
(D-4). Cap agency at **Tier 2** (D-5, hook refinement; no agentic loop). Defer the **skip-review fast
path** (D-7).

---

## 2. The BRIEF (Q1)

### 2.1 Schema — `campaign_briefs` (new business-scoped table)

A brief is a **new table**, not a JSONB column on `campaigns`. Rationale: it needs per-brief RLS, a
clean home for the pinned evidence-citation set, a `version` trail, and a `frozen_at` freeze point
(§5, `[type-5]`). A JSONB column couples the brief lifecycle to the campaign row and offers none of
these. **Loser: JSONB column.**

Columns (spec'd to Track A's B0 standard, incorporating `[db-*]`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `business_id` | `uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` | cascade parent — the erasure + RLS anchor (`[db-MAJOR-1]`: keep `businesses` as parent, never `campaign_id`) |
| `campaign_id` | `uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE`, **`UNIQUE`** | `UNIQUE(campaign_id)` enforces 1:1 (`[db-MAJOR-1]` — a bare FK does not); this is also the by-campaign lookup index, so **no separate `(campaign_id)` index** |
| `content` | `jsonb NOT NULL` | typed `CampaignBriefContent` (`[db-NIT-1]`, §2.2) — never `Record<string,unknown>` |
| `status` | `text NOT NULL CHECK (status IN ('draft','critiqued','approved','generated'))` | §2.4 state machine |
| `version` | `int NOT NULL DEFAULT 1 CHECK (version >= 1)` | bumped on each human-approved edit (`[db-MINOR-4]`) |
| `overall_score` | `numeric CHECK (overall_score >= 0 AND overall_score <= 100)` | latest critique score (`[db-MINOR-4]`) |
| `critique` | `jsonb` | latest critique payload (§6.2) |
| `frozen_at` | `timestamptz` | set at `approved`; NULL means editable (§5, `[type-5]`) |
| `deleted_at` | `timestamptz` | soft-delete convention |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` via the shared `set_updated_at()` `BEFORE UPDATE` trigger (`[db-NIT-4]`) |

Indexes: `UNIQUE(campaign_id)`; a **partial** retrieval index `(business_id, status) WHERE deleted_at
IS NULL` matching the governed-memory convention (`[db-MINOR-2]`).

Tenant-consistency note (`[db-MAJOR-1]`): nothing at the DB level enforces
`campaign_briefs.business_id = campaigns.business_id`. This is the *same* inherited denormalization
`posts` already carries; the `lib/db/` insert helper sets `business_id` from the campaign row, and a
Tier-1 test asserts they match. Recorded, not newly introduced.

Critique-history decision (`[db-MINOR-3]`): `overall_score`/`critique` are kept **latest-only** on the
brief row for Track B. Per-round critique history is **deferred to Track C** (which owns the diff loop
and will choose the `campaign_brief_revisions` shape). Stated decision, not a default.

### 2.2 `CampaignBriefContent` (the JSONB shape)

A named type (`[db-NIT-1]`), the type-design core alongside the format families:

- `narrative: string` — the campaign's argument.
- `proofPlan: string` — how the argument is substantiated.
- `pinnedEvidence: { evidenceMemoryId: string; note?: string }[]` — **citation-by-id, not inlined
  text** (`[sec-MEDIUM-1]`, `[db-NIT-2]`; §9). Evidence bytes are re-fetched and guarded at render
  time, so the frozen brief carries ids, not quote text.
- `roleSequence: { order: number; role: CampaignPostRole; platform: Platform; angle: string }[]` — the
  per-post role assignment, pinned once (L-5). This is the sequence generation must honour (§5, Finding
  6 cross-check).

### 2.3 Versioning

Mutable-in-place with a monotonic `version` int bumped on each human-approved edit while
`frozen_at IS NULL`. **Loser: a `campaign_brief_revisions` child table now** — unused machinery for a
Track-C consumer that does not yet exist (L-1 scope creep).

### 2.4 State machine (the generation gate)

```
draft ──(critique gate, §6)──► critiqued ──(human approve, HARD gate pass)──► approved ──(generate)──► generated
  ▲                                  │
  └──────(human edit / revise)───────┘   (version++, frozen_at stays NULL)
```

- Every transition is an **atomic conditional UPDATE** (`.eq('status', <expected>)`), matching
  `activateCampaign` (`[db-NIT-3]` — all four transitions guarded, not just the two headline ones).
- `critiqued → approved` is blocked by the **HARD** critique gate (§6) when `overall_score <
  BRIEF_QUALITY_THRESHOLD`.
- On `approved`, `frozen_at` is set; a `BEFORE UPDATE` trigger rejects any `content` change once
  `frozen_at IS NOT NULL` (§5, `[type-5]`). Human edits are only possible in `draft`/`critiqued`.
- `approved → generated` is the atomic gate that guarantees a single generation from one approved
  brief (`[db-MAJOR-1]`/idempotency).

Agency tier 0 (deterministic persistence + transitions). Test tier: Tier-1 DB-behaviour
(`MODE2-BRIEF-RLS-ISOLATED`, `MODE2-BRIEF-CASCADE-COMPLETE`, `MODE2-BRIEF-STATE-ATOMIC`,
`MODE2-BRIEF-FROZEN-GUARD`), Tier-2 for the SM helpers.

### 2.5 RLS + erasure cascade

Four policies in the `get_user_business_ids()` form copied verbatim from
`supabase/migrations/20260719010000_governed_memory.sql:60-77` (SELECT/INSERT/UPDATE-with-both-
USING-and-WITH-CHECK/DELETE), `ENABLE ROW LEVEL SECURITY`, the `set_updated_at()` trigger, and a
**§D2.5 cascade-table row** added in the same migration (`campaign_briefs` cascades from `businesses`
ON DELETE — cascade *is* erasure). A business-scoped table without the cascade row is a silent GDPR
leak (L-10).

---

## 3. `origin` + `role` schema (Q2, Q3)

Both are **additive** `text` + `CHECK` columns (repo convention — no native pg enums, see
`PostStatus`/`CampaignStatus`, `lib/db/types.ts:33-34`).

### 3.1 `campaigns.origin` (Q3)

`origin text CHECK (origin IN ('manual','objective_generated','signal_generated'))`. **Full enum
shipped now** (forward-compat, one migration; an unused CHECK value costs nothing). Track B only
*produces* `objective_generated`; `manual` (Mode 1) and `signal_generated` (Mode 3) are **reserved**,
the same posture as the unimplemented `agency` plan value (`lib/db/types.ts:29`). **Loser: a second
migration when Mode 3 lands.**

Backfill: existing campaigns → `objective_generated` (they *were* objective-generated — the honest
attribution). **Loser: `manual`** (understates objective-generation adoption; misrepresents history).
**Analytics consequence (stated):** portfolio/origin analytics counts all historical campaigns as
objective-generated from day one.

Default hygiene (`[db-MAJOR-3]`): the `ADD COLUMN … DEFAULT 'objective_generated'` performs the
metadata-only backfill, then the migration **drops the default** and `origin` is made **required on
`CampaignInsert`** so every future call site states it explicitly — otherwise Mode 1/3 rows would
silently mislabel as `objective_generated`.

### 3.2 `posts.role` (Q2)

`role text CHECK (role IN ('anchor_thesis','founder_perspective','customer_proof','objection_response',
'conversation_starter','follow_up'))` **NULLABLE**. This is the **campaign post-role** vocabulary
(L-5) — distinct from the **thread-internal tweet-role** (`hook|body|pull_quote|close`, L-4), which
lives **inside the thread format-family JSON**, never on `posts.role`. The two vocabularies never
touch.

- **Mapping:** the brief's `roleSequence` (§2.2) assigns one role per planned post; in
  `generatePostsForCampaign` each `PostInsert` (`generate.ts:192-201`) carries its brief-assigned role.
- **Backfill:** existing rows → `NULL` (they predate roles; no honest role to assert). **Loser: a
  default role** (fabricates an arc L-5 exists to measure).
- **Write-once, enforced at the DB (`[db-MAJOR-2]`):** `role` is assigned at generation and excluded
  from `PostUpdate` (added to the `Omit` set, `lib/db/types.ts:293`) **and** protected by a
  `BEFORE UPDATE` trigger rejecting `NEW.role IS DISTINCT FROM OLD.role AND OLD.role IS NOT NULL`.
  App-layer exclusion alone is insufficient because the service-role orchestrator writes outside the
  `PostUpdate` type and bypasses RLS; `role` is the join key between the approved `roleSequence` and
  the generated rows, so a silent mutation breaks role-coverage analytics with no audit trail.
  **Loser: `role` in the mutable set / app-layer-only enforcement.**

CHECK-migration mechanics (`[db-MINOR-1]`): the new `campaigns.status` value (`awaiting_brief`, §11)
and the `origin`/`role` CHECKs are added with `ADD CONSTRAINT … NOT VALID` then a separate
`VALIDATE CONSTRAINT`, the low-lock pattern, rather than a naive in-place drop/add that holds
`ACCESS EXCLUSIVE` through a full validation scan.

Agency tier 0. Test tier: Tier-1 DB-behaviour (CHECK + backfill + write-once trigger) →
`MODE2-ORIGIN-ROLE-BACKFILL`, `MODE2-ROLE-WRITE-ONCE`; Tier-2 for the brief-role→`posts.role` mapping.

---

## 4. Format-family output schemas (L-4, Q4)

### 4.1 The discriminated union

Two `z.discriminatedUnion('format', …)` branches (`[type-4]` confirms this is the right encoding — the
literal tag is matched before the branch is validated, giving a precise "prose where thread expected"
rejection), living in a **new `lib/ai/prompts/formats/`** module, not inline in the generation prompt:

- **single-post** — `{ format: 'single', body: string (min 1), imageBrief: string | null }`
- **thread** — `{ format: 'thread', posts: { text: string; role: 'hook'|'body'|'pull_quote'|'close' }[],
  imageBrief: string | null }`

Two adopted type-design refinements:

- **No `posts[].order` field (`[type-2]`).** Array position *is* the order; asking the model for an
  `order` field adds a failure mode (duplicate/gapped/out-of-range) with no upside. `order` is derived
  from the array index in code after parse.
- **`imageBrief` repeated per branch (`[type-4]` caveat).** zod v3 `discriminatedUnion` has no shared
  base merge; the field is declared in both branches (or via a shared `.extend()` per branch) to avoid
  drift as carousel/script are added later.

`imageBrief` is a structured **recommendation** ("this needs an image showing X"), **not** image
generation — consistent with the no-image-at-launch rule. **Carousel/Script are DEFERRED** (D-6);
adding one later is one new union branch + one `PLATFORM_CONSTRAINTS` entry, not a re-architecture.

**Loser: one flat schema with optional fields** — structurally cannot reject prose-where-thread-
expected, which is the entire L-4 guarantee (D-3).

### 4.2 Structural vs policy validation split (`[type-3]`)

- **Structural bounds in the zod schema:** thread length `3 ≤ posts.length ≤ 8` (L-8 guardrail) via
  `.min(3).max(8)`. Pure shape, always-on, same failure channel as parsing.
- **Policy in a separate Tier-0 validator** run immediately after `safeParse` succeeds:
  `posts[0].role === 'hook'`, last role `=== 'close'`, `≥ 1 pull_quote`. Kept out of the schema so the
  policy can vary per platform later without touching the type-safety-critical parse file, and so a
  policy failure and a JSON-shape failure produce **distinguishable `AiError` codes**, letting the
  bounded re-prompt (§4.4) send a *targeted* correction ("your close was in slot 2; move it last")
  rather than a generic retry.

### 4.3 Deterministic platform → family mapping

A **Tier-0 lookup** extending `PLATFORM_CONSTRAINTS` (`post-generation.ts:42-64`), never model-chosen
(**loser: model chooses family** — nondeterministic, unverifiable):

| Platform | Eligible family | Selection rule |
|---|---|---|
| linkedin, facebook | single-post | fixed |
| twitter | single-post **or** thread | Tier-0 content-volume guardrail: `< 3` tweets' worth → single; `3..8` → thread (L-8) |
| threads | single-post **or** thread | same volume rule, **separate `PLATFORM_CONSTRAINTS` entry** (no X link-penalty, more conversational, less numbered-listicle — L-8) |

A thread is the **native rendering of one scheduled post in the role sequence**, not "the campaign's X
content" (L-8): a campaign's X presence is still multiple scheduled posts, each independently resolving
to single-tweet or thread by its own content volume.

### 4.4 The schema-mismatch re-prompt (new machinery)

L-4's "schema rejects → the call retries" is **new machinery** — the generic runner retries only
429/5xx (`runner.ts:39-53`) and does **not** re-prompt on parse failure (`runner.ts:146-155`). It lives
in a **new generation wrapper** (`lib/ai/generate-native.ts`, called from Stage D), **not** the runner:

- Per `[type-1]`, the `Prompt<TInput,TOutput>` contract (`lib/ai/prompts/types.ts:5-12`) binds **one
  `outputSchema` per Prompt object**; a per-call variable schema would break it. Resolution: a
  **per-family Prompt factory** `createNativeGenerationPrompt(family)` returning a concretely-typed
  `Prompt<NativeGenInput, SinglePostOutput>` or `Prompt<NativeGenInput, ThreadOutput>`. The wrapper
  does the Tier-0 platform→family lookup (§4.3), selects the matching `Prompt`, and calls the
  **unchanged** `runPrompt`. The runner stays ignorant of format families — **no third `prompt.id`
  branch** is added alongside `isPostGeneration`/`isBrandVoice` (`runner.ts:17-25`), and **no
  `z.ZodType<unknown>` + cast** (the `any`-adjacent escape hatch CLAUDE.md restricts to two named
  carve-outs, neither of which is this).
- On `invalid_response` (from `safeParseOrAiError`) **or** a Tier-0 policy failure (§4.2), the wrapper
  re-invokes `runPrompt` with an appended targeted corrective instruction. **Ceiling = 1 re-prompt
  (2 attempts total)**, matching the existing single-retry economics; a second failure surfaces
  `invalid_response` unchanged. **Loser: teaching `runner.ts` to re-prompt** — pollutes the generic
  runner shared by brand-voice + regeneration and couples every prompt to format-family concerns.

Agency: schema = Tier 0 (structural validation); the bounded re-prompt = Tier-1 boundary (deterministic
parse/policy-fail retry, *not* Tier-2 critique). Test tier: Tier-2 app-layer →
`MODE2-FORMAT-FAMILY-STRUCTURAL`, `MODE2-NATIVE-RETRY`, `MODE2-THREAD-GUARDRAILS`.

---

## 5. Frozen-brief generation (L-3, Q7) + memory wiring (ADR 0016 §10)

The brief is assembled once (Stage A), critiqued (B), human-approved (C) — then **frozen**. Each of
**N independent per-platform calls** (Stage D) receives the **same frozen object**. Platform generation
*renders* the pinned argument into a native shape; it does not re-argue it.

- **N independent calls, not one joint call (D-2).** Each fails/retries independently (§4.4),
  consistent with the existing partial-failure-tolerant reliability principle. **Loser: one joint call
  returning all platforms** — couples failure (one schema failure blocks the batch) and complicates
  per-platform token budgets/parallelism.

### 5.1 Memory wired into brief assembly — and *only* there

Stage A retrieves `evidence`/`audience`/`brand` memory through `lib/memory/`
(`retrieveEvidenceMemory` / `retrieveAudienceMemory` / `retrieveBrandMemory`, `lib/memory/index.ts:15-17`;
signature `retrieveRelevant(client, businessId, queryContext, limit?)`) **into the brief** — this ADR
is their designated consumer (ADR 0016 §6.3/§10). The retrieved evidence becomes the brief's
`pinnedEvidence` **id set** (§2.2).

**The L-10 gate — `MODE2-CONTEXT-EQUIVALENT`.** The newly-wired memory enters the **brief-assembly
path only**. The existing `postGenerationPrompt` path's `CustomerContext` (`lib/ai/context.ts`) shape
is **not touched** — per-platform generation reads the *frozen brief*, not fresh memory. This is the
clean resolution of ADR 0016 §6.3's warning that consuming evidence/audience/brand "requires new
contract fields, which ripple into prompts": those fields land on the **brief contract**, a new
surface, not on `CustomerContext`. A fixture-based equivalence test proves the existing generation path
produces identical output. Any change to the `CustomerContext` shape consumed by `postGenerationPrompt`
would be a **STOP** requiring founder ratification (L-10) — this ADR ratifies none.

### 5.2 The frozen-brief contract (`[type-5]`, `[type-6]`)

Freezing is enforced at **two layers**, because a fix at only one is incomplete:

- **Type layer — a branded, deeply-readonly `FrozenBrief`** produced by exactly one factory, mirroring
  the project's "the function that constructs a privileged value owns its construction" pattern (the
  lazy service-role import). A caller cannot pass a plain `Brief` where a `FrozenBrief` is required.
- **DB layer — the `frozen_at IS NULL` guard** (§2.4): a `BEFORE UPDATE` trigger rejects `content`
  changes once frozen. This is what actually stops a concurrent business-profile/brief edit from
  mutating the brief mid-batch across the N per-platform calls — a TS `readonly` cannot (a
  `JSON.parse(JSON.stringify())` round-trip or a cast defeats it).
- **Role cross-check (`[type-6]`):** the Tier-0 role-coverage validator (§8) takes the frozen brief's
  `roleSequence` as input and checks each generated post's `role[i] === frozenBrief.roleSequence[i]`,
  rather than independently re-deriving "is this a legal sequence." Two checks that each pass in
  isolation but disagree with each other is the bug class this eliminates.

Agency tier 0 (freeze) + Tier 1 (per-platform generation). Test tier: Tier-1 DB (frozen guard) +
Tier-2 (`MODE2-BRIEF-FROZEN` — same object to every call; `MODE2-MEMORY-WIRED`;
`MODE2-CONTEXT-EQUIVALENT`).

---

## 6. The quality rubric (L-6, Q5)

### 6.1 Home + dimensions

A `Prompt<RubricInput, RubricOutput>` in a **new `lib/ai/prompts/rubric.ts`** (L-6: self-contained
addition to `lib/ai/`). Ten fixed dimensions: specificity, originality, evidence-sufficiency,
audience-relevance, platform-nativeness, brand-voice-alignment, opening-strength, CTA-fit,
unsupported-claims-risk, redundancy.

### 6.2 Output contract

```
{
  dimensions: { <dimension>: { score: number (0–100), note: string } }  // all ten
  overall: number (0–100)
  critique: string[]     // ACTIVE — "three questions that would make it publishable" (L-6)
  verdict: 'pass' | 'fail'
}
```

**Loser: a passive numeric score only** — L-6 explicitly demands active critique, not
"polished mediocrity the human notices is weak after the fact."

### 6.3 The critique gate — HARD

The brief critique gate (Stage B) is a **HARD** gate: a brief with `overall < BRIEF_QUALITY_THRESHOLD`
**blocks** the `critiqued → approved` transition and returns the critique to the human. **Loser: a SOFT
advisory gate** — defeats the "cheap checkpoint prevents wasted generation" purpose (L-2); a gate the
human can wave through spends exactly the copy tokens the brief exists to save.

`BRIEF_QUALITY_THRESHOLD` is an **ADR constant** (a `lib/ai/prompts/rubric.ts` export, sibling to the
memory caps in `lib/memory/constants.ts`), never a scattered magic number.

### 6.4 Shared with the nativeness score

The **same** rubric prompt powers the post-generation platform-nativeness score (§8), consumed for its
`platformNativeness` dimension specifically. **Loser: a forked nativeness-only scorer** (drift, triple
maintenance — D-4). Mode 1's later suggestion categories reuse this same rubric (§15).

Agency: rubric call = Tier 1; the threshold block/allow on the score = Tier 0. Test tier: Tier-2 →
`MODE2-RUBRIC-SHARED`, `MODE2-CRITIQUE-GATE`.

---

## 7. The hook-refinement Tier-2 loop (L-7, L-8)

`generate → score the opener against the rubric → regenerate ONCE if below threshold`. Applied to
**single-post openers** (`body`'s first line) **and thread `posts[0]`** — the hook tweet must stand
alone, being the only part visible pre-expansion (L-8). Bounded to **one** regeneration.

This is the **only Tier-2** in Track B. **No Tier 3 anywhere in this track** — Mode 3's signal triage
is the sole Tier-3 in the entire product and is deferred (L-7). Over-applying agency is a quality
regression: cost compounds, latency breaks the instant feel, failures get quieter, and the
human-approval gate caps the marginal value of more upstream autonomy.

Agency tier 2. Test tier: Tier-2 → `MODE2-HOOK-STANDALONE`.

---

## 8. The deterministic consistency pass (L-7, L-8, Q8)

Four parts, three shipped now:

1. **Role-coverage (Tier 0, free) — shipped.** Every role in the frozen brief's `roleSequence` is
   fulfilled by a generated post, cross-checked positionally against the frozen brief (§5.2,
   `[type-6]`). → `MODE2-ROLE-COVERAGE`.
2. **Link-placement (Tier 0, free) — shipped.** CTA/outbound links **never** in tweet 1 (suppresses X
   reach); a link belongs in the final tweet or an explicit follow-up reply (L-8). Deterministic rule
   over the thread structure. → `MODE2-LINK-PLACEMENT`.
3. **Platform-nativeness (Tier 1, rubric) — shipped.** The shared rubric's `platformNativeness`
   dimension (§6.4), catching reformatted-not-native output before a human sees it.
4. **Cross-set redundancy / contradiction (Tier 1, one LLM call over the whole set) — DEFERRED**
   behind a named trigger.

**Q8 decision:** ship 1–3 now; defer 4. **Loser: shipping all three LLM parts now** — the cross-set
redundancy call is an extra per-campaign whole-set LLM call whose value the strategy doc itself flags
as unproven ("revisit only if the consistency-check step proves to catch drift often enough to be a
real cost"), and frozen-brief pinning already suppresses most cross-platform drift, so its marginal
catch rate is likely low at launch.

**`MODE2-REDUNDANCY-UNDEFER` (the named trigger):** ship the cross-set redundancy call once Track C's
edit-distance / manual-review data shows cross-set redundancy surviving the frozen brief in more than a
stated fraction of campaigns — i.e. when observed redundancy that pinning failed to prevent justifies
the per-campaign call.

Agency: role-coverage + link-placement = Tier 0; nativeness = Tier 1; deferred redundancy = Tier 1.
Test tier: Tier-2 for the deterministic rules.

---

## 9. Prompt-injection guard (L-9) — folding in `security-reviewer`

Brief-pinned evidence is customer/third-party-authored quote material (`evidence_memory.content`). It
is **data, never instructions**. Every new place it enters a prompt is `[DATA]`-wrapped + sanitized,
exactly as `special_instructions` is today (`post-generation.ts:6,87,121-125`). The advisory pass
raised four load-bearing refinements, all adopted:

- **`MODE2-EVIDENCE-DATA-GUARDED` — guard at render time, not authorship time (`[sec-HIGH-2]`).** The
  guard is applied where the frozen brief is **rendered into a prompt**, never where the field was
  authored. Authorship-time sanitization is a bypass: a later human edit re-enters the field after the
  one-time sanitize ran. There is **no code path that skips sanitize because a field was
  AI-generated** — a human-edited brief field is at least as untrusted as `special_instructions`.
- **Citation-by-id → single choke point (`[sec-MEDIUM-1]`, adopted in §2.2).** The frozen brief stores
  `evidenceMemoryId`, not inlined text. A single shared helper — `wrapEvidenceForPrompt()` — re-fetches
  and guards evidence at each render, collapsing the guard to one choke point instead of re-applying it
  across the assembly prompt + N platform prompts. A sanitize fix then propagates automatically. The
  time-of-check/use gap (evidence retired between freeze and generation) is **closed** by checking the
  row is `status = 'active'` at render (this also resolves `[db-NIT-2]` staleness). **This is exactly
  the SHARED-FUNCTION CALLERS concern** (CLAUDE.md): §12 enumerates every prompt-builder that renders
  brief content and the test that proves each guards.
- **Stronger-than-closer sanitization + hard cap (`[sec-HIGH-1]`).** `sanitizeDataField` only
  neutralizes `[/DATA]` closers; evidence is longer-form and may contain markdown/JSON that induces
  output-schema confusion in a `safeParse` world. `wrapEvidenceForPrompt()` additionally **hard-caps
  evidence length** (truncate, not warn) before it enters the brief, and neutralizes triple-backtick
  fences / leading `{`/`[`. Append-only escaping is not a substitute for the length/shape cap.
- **The rubric/critique call is an enumerated caller (`[sec-MEDIUM-2]`).** The rubric LLM call (§6)
  also sees brief content and is a *second* evidence-consuming prompt — arguably higher severity since
  its output influences the human-in-the-loop approval decision. It is listed in §12's caller table
  and independently applies the guard; it is **not** covered "for free" by guarding generation.
- **Sentinel degrades safely (`[sec-LOW-1]`, documented as accepted).** A literal `[/DATA]` in
  evidence over-fences into the next DATA section (data→data), never escapes into instruction space —
  the correct failure direction. A bare opening `[DATA]` in evidence is not neutralized but only nests
  more data. Recorded as accepted, not overlooked.

Agency tier 0 (deterministic guarding). Test tier: Tier-2 → `MODE2-EVIDENCE-DATA-GUARDED`.

---

## 10. Brief-review UI (Q6)

**Decision:** Track B ships the **pipeline + schema + Zod-validated Server Actions + a minimal
functional brief-review surface** — enough to drive the state machine and prove the approval gate
end-to-end. The **high-touch brief-review/edit UI and the per-post Studio diff (Stage G)** are
**deferred to a scoped follow-on, Session 24-UI**.

- **Minimal surface (in scope):** a Server Component page + Client form split (CLAUDE.md), i18n
  en/pt/es, Server Actions validated with Zod, exposing approve / reject / edit-brief. Plain shadcn v4
  / Base UI; **not** given the `impeccable` + `taste-skill` treatment.
- **Deferred to Session 24-UI:** the high-touch brief-review/edit surface and per-post diff view — the
  differentiator screen where "AI proposed a strategy I can shape" becomes tangible. It earns its own
  design-led session (`impeccable` + `taste-skill`), not a rushed corner of a migration-heavy Builder
  track.
- **Losers:** *(a)* full high-touch UI in Track B — couples a large design surface to schema/RLS
  correctness in one review (the phase-isolation risk 21C surfaced); *(b)* no surface at all — leaves
  the approval gate un-exercisable at the app layer.
- **Minimal surface needed to exercise the pipeline this track:** the approve/reject/edit Server
  Actions and their atomic transitions (§2.4) — the Tier-2 tests drive these directly; the UI is a thin
  shell over them.

L-1 note: L-1 scopes Track B as "pipeline + schema + Server Actions"; the plan doc §2 Phase A lists no
UI, so this is a genuine founder call — ratified here toward *minimal-now, high-touch-deferred*.

---

## 11. Orchestration (Q7) — where the stages live

**Decision:** a **new `lib/campaigns/brief.ts`** owns **Stages A–C** (assemble → critique →
await-approval, including the §5.1 memory retrieval and §9 evidence pinning). **`generate.ts`**
(`generatePostsForCampaign`) is rewired to consume a **frozen, approved** brief for **Stages D–F**.
**Loser: inlining all stages into `generate.ts`** — one unreviewable mega-function coupling brief
lifecycle to generation, against one-step-one-commit.

Pause / resume (atomic, L-10):

- `campaigns.status` gains one value: **`awaiting_brief`** (CHECK extended via NOT VALID/VALIDATE, §3.2).
- On brief assembly: atomic `campaigns.status: draft → awaiting_brief`.
- Generation (Stage D) is gated on the atomic `campaign_briefs.status: approved → generated` (§2.4).
- The existing final `activateCampaign` guard (`generate.ts:210`, today `.eq('status','draft')`)
  changes to `.eq('status','awaiting_brief')` — still one atomic guard, still idempotent.
- The `already_generated` existing-posts guard (`generate.ts:63-71`) and the session machinery are
  preserved unchanged.

**`MODE2-ACTIVATE-GUARD-MIGRATED` (the `[db-BLOCKER-1]` stuck-row hazard).** Changing the guard from
`draft` to `awaiting_brief` is **behavioral, not additive**: any campaign already in `draft` at deploy
(created under the old flow, never routed through brief assembly) would fail the new guard forever.
Track B is **pre-launch** (Phase 1 MVP), so the expected in-flight count is zero — but the migration is
required to *prove* it and handle it, not assume it. Resolution: the deploy migration (a) asserts zero
live `draft` campaigns exist, and if any do, (b) either backfills them a `draft` brief in
`awaiting_brief` state or transitions them through the new path; the Builder confirms the count at
cutover. This is a named migration obligation, not left implicit.

Agency: Tier 0 orchestration/transitions; the stages are Tier 1. Test tier: Tier-1 DB (atomic
transitions) + Tier-2 (orchestration, idempotency preserved). **SHARED-FUNCTION CALLERS** (§12) applies
to `generatePostsForCampaign` and `buildCustomerContext`.

---

## 12. Test plan mapped to the three tiers (ADR 0015 §2)

**Tier 1 — DB-behaviour (`supabase/__tests__/*`, live Postgres, `db-tests.yml`):**

- `campaign_briefs` RLS: cross-tenant SELECT/INSERT/UPDATE/DELETE denied (`MODE2-BRIEF-RLS-ISOLATED`).
- Cascade: business delete purges briefs; §D2.5 row present (`MODE2-BRIEF-CASCADE-COMPLETE`).
- `frozen_at` trigger: `content` UPDATE rejected once frozen (`MODE2-BRIEF-FROZEN-GUARD`).
- `role` write-once trigger: `role` UPDATE rejected when `OLD.role IS NOT NULL` (`MODE2-ROLE-WRITE-ONCE`).
- `origin`/`role`/`status` CHECK + backfill behaviour (`MODE2-ORIGIN-ROLE-BACKFILL`).
- All four brief transitions atomic-guarded (`MODE2-BRIEF-STATE-ATOMIC`).
- `business_id = campaigns.business_id` consistency on insert.

**Tier 2 — app-layer (`app/**`, `lib/**` `*.test.ts`, `app-tests.yml` every push/PR):**

- Format-family: `safeParse` rejects prose where thread expected; thread bounds 3..8; policy validator
  distinguishes shape-fail from sequence-fail (`MODE2-FORMAT-FAMILY-STRUCTURAL`, `MODE2-THREAD-GUARDRAILS`).
- Re-prompt wrapper: fires exactly once on parse/policy fail, then surfaces `invalid_response`
  (`MODE2-NATIVE-RETRY`).
- Frozen brief: the **same** object instance reaches every per-platform call (`MODE2-BRIEF-FROZEN`).
- Memory: `evidence`/`audience`/`brand` retrieved into brief assembly via `lib/memory/`
  (`MODE2-MEMORY-WIRED`).
- **Existing-path equivalence (L-10):** fixture-based — `postGenerationPrompt`'s `CustomerContext` and
  output are unchanged (`MODE2-CONTEXT-EQUIVALENT`).
- Rubric output schema; HARD gate blocks below / allows above threshold (`MODE2-RUBRIC-SHARED`,
  `MODE2-CRITIQUE-GATE`).
- Hook loop: regenerate-once on a below-threshold opener, single-post + thread `posts[0]`
  (`MODE2-HOOK-STANDALONE`).
- Role-coverage + positional cross-check; link-placement rule (`MODE2-ROLE-COVERAGE`,
  `MODE2-LINK-PLACEMENT`).
- **Evidence guard — the enumerated caller table** (`MODE2-EVIDENCE-DATA-GUARDED`, SHARED-FUNCTION
  CALLERS):

  | Prompt-builder rendering brief evidence | Guard applied? | Proving test |
  |---|---|---|
  | brief-assembly (Stage A) | yes — `wrapEvidenceForPrompt()` | assembly test injects `[/DATA]` + JSON-shaped evidence |
  | native generation ×N (Stage D) | yes — same helper at render | per-platform render test |
  | rubric / critique (Stage B) | yes — same helper | rubric render test (`[sec-MEDIUM-2]`) |

- **SHARED-FUNCTION CALLERS for `generatePostsForCampaign` + `buildCustomerContext`:** enumerate every
  caller and state the test per caller (the Builder `git grep`s both before marking any shared-function
  constraint tested).

**Tier 3 — diff-verified (properties of absence, enumerated as such):**

- No new migration outside the additive `origin`/`role`/`campaign_briefs`/`awaiting_brief` set.
- No Tier-3 agentic loop introduced (L-7).
- `campaign_briefs` §D2.5 cascade row present (diff check, paired with the Tier-1 purge test).

---

## 13. Constraint table (the Reviewer's checklist)

| Constraint | Agency tier | Test tier | Test that proves it |
|---|---|---|---|
| **MODE2-BRIEF-BEFORE-COPY** | 1 | 2 | brief exists in `draft`/`critiqued`/`approved` with zero `posts` rows until `approved→generated` |
| **MODE2-BRIEF-FROZEN** | 0+1 | 2 | same frozen object instance passed to every per-platform call |
| **MODE2-BRIEF-FROZEN-GUARD** | 0 | 1 | `content` UPDATE rejected once `frozen_at` set (DB trigger) |
| **MODE2-FORMAT-FAMILY-STRUCTURAL** | 0 | 2 | `safeParse` rejects prose where thread schema expected |
| **MODE2-NATIVE-RETRY** | 1 | 2 | wrapper re-prompts once on parse/policy fail, then surfaces `invalid_response`; runner untouched |
| **MODE2-THREAD-GUARDRAILS** | 0 | 2 | thread length 3..8; `posts[0]`=hook, last=close, ≥1 pull_quote (policy validator) |
| **MODE2-ROLE-COVERAGE** | 0 | 2 | every `roleSequence` role fulfilled; positional cross-check vs frozen brief |
| **MODE2-LINK-PLACEMENT** | 0 | 2 | CTA/outbound link never in tweet 1 |
| **MODE2-HOOK-STANDALONE** | 2 | 2 | below-threshold opener regenerated once, single-post + thread `posts[0]` |
| **MODE2-RUBRIC-SHARED** | 1 | 2 | one rubric powers critique gate + nativeness; no fork |
| **MODE2-CRITIQUE-GATE** | 1+0 | 2 | HARD — below `BRIEF_QUALITY_THRESHOLD` blocks `critiqued→approved`, returns critique |
| **MODE2-EVIDENCE-DATA-GUARDED** | 0 | 2 | every enumerated caller `[DATA]`-wraps + caps + sanitizes at render (§12 table) |
| **MODE2-MEMORY-WIRED** | 1 | 2 | evidence/audience/brand retrieved into brief assembly via `lib/memory/` |
| **MODE2-CONTEXT-EQUIVALENT** | 1 | 2 | existing `postGenerationPrompt` `CustomerContext` + output byte-identical (L-10) |
| **MODE2-ORIGIN-ROLE-BACKFILL** | 0 | 1 | `origin`/`role`/`awaiting_brief` CHECK + backfill (`objective_generated` / NULL) |
| **MODE2-ROLE-WRITE-ONCE** | 0 | 1 | `role` UPDATE rejected when `OLD.role IS NOT NULL` (DB trigger) |
| **MODE2-BRIEF-STATE-ATOMIC** | 0 | 1 | all four brief transitions via conditional `WHERE` |
| **MODE2-ACTIVATE-GUARD-MIGRATED** | 0 | 1+3 | no `draft` campaign stranded by the guard change; migration asserts/handles |
| **MODE2-BRIEF-RLS-ISOLATED** | 0 | 1 | cross-tenant CRUD denied on `campaign_briefs`, live PG |
| **MODE2-BRIEF-CASCADE-COMPLETE** | 0 | 1+3 | business delete purges briefs; §D2.5 row present |
| **MODE2-REDUNDANCY-UNDEFER** | 1 | 3 | deferred by decision — un-defer trigger recorded, no runtime test now |

---

## 14. Consolidated advisory findings (disposition)

| Finding | Source | Disposition |
|---|---|---|
| BLOCKER-1 activate-guard stuck rows | db | Adopted → `MODE2-ACTIVATE-GUARD-MIGRATED` (§11) |
| MAJOR-1 `UNIQUE(campaign_id)`, drop redundant index, keep `businesses` cascade parent | db | Adopted (§2.1) |
| MAJOR-2 `role` write-once needs DB trigger | db | Adopted → `MODE2-ROLE-WRITE-ONCE` (§3.2) |
| MAJOR-3 drop `origin` default post-backfill; required on Insert | db | Adopted (§3.1) |
| MINOR-1 CHECK via NOT VALID / VALIDATE | db | Adopted (§3.2) |
| MINOR-2 partial index `WHERE deleted_at IS NULL` | db | Adopted (§2.1) |
| MINOR-3 critique-history in-place overwrite | db | Adopted as stated decision — latest-only now, revisions in Track C (§2.1) |
| MINOR-4 bound `overall_score`; `version` default/CHECK | db | Adopted (§2.1) |
| NIT-1 named `CampaignBriefContent` | db | Adopted (§2.2) |
| NIT-2 pinned-citation staleness | db | Adopted via citation-by-id + active-status check at render (§9) |
| NIT-3/4 all transitions guarded; `updated_at` trigger | db | Adopted (§2.1, §2.4) |
| HIGH-1 evidence guard undersized (length/shape) | sec | Adopted (§9) |
| HIGH-2 guard at render, not authorship; human edits | sec | Adopted (§9) |
| MEDIUM-1 citation-by-id single choke point | sec | Adopted (§2.2, §9) |
| MEDIUM-2 rubric call is a separate guarded caller | sec | Adopted (§9, §12 table) |
| LOW-1 sentinel degrades safely | sec | Documented as accepted (§9) |
| Finding 1 per-family Prompt factory, runner unchanged | type | Adopted (§4.4) |
| Finding 2 drop `posts[].order`, derive from index | type | Adopted (§4.1) |
| Finding 3 split structural (zod) vs policy (validator) | type | Adopted (§4.2) |
| Finding 4 `discriminatedUnion` right; repeat `imageBrief` | type | Adopted (§4.1) |
| Finding 5 branded `FrozenBrief` + DB `frozen_at` guard | type | Adopted (§5.2) |
| Finding 6 role cross-check vs frozen brief | type | Adopted (§5.2, §8) |

---

## 15. Deferred to later tracks / phases (boundary on the record)

Explicitly **NOT** built in Track B — a future session must not build these here by mistake (L-1):

- **Mode 1 Studio** (inline-marker suggestions, deterministic diff renderer, left/right UI) — reuses
  this ADR's rubric + brief pipeline; its own phase.
- **Mode 3** (signal ingestion, candidate scoring, the Tier-3 triage loop, insight cards, opportunity
  feed) — the only Tier-3 in the product, deferred.
- **Track C diff-learning capture** (`ai_original` snapshot, async diff-and-classify worker,
  correction-vs-preference tagging, confidence-gated memory promotion) — independent of Track B; ADR
  0018.
- **Carousel + script format families** (D-6) — added when Instagram carousel / TikTok-Shorts are
  prioritized; one new union branch each.
- **Image generation** — Phase 2; `imageBrief` is a recommendation field only.
- **The skip-review fast path** (D-7, L-11) — needs the edit-distance data Track C produces; an L-1
  STOP if attempted now.
- **The numbered-vs-unnumbered thread preference** — a learned preference, Track C's diff loop owns it.
- **Cross-set redundancy LLM call** — deferred behind `MODE2-REDUNDANCY-UNDEFER` (§8).
- **High-touch brief-review UI + per-post Studio diff** — Session 24-UI (§10).

---

ADR 0017 written and accepted — 21 MODE2-* constraints, brief as **table** (`campaign_briefs`), format
families **single-post + thread**, brief-review UI **minimal-in-scope / high-touch-deferred**, cross-set
redundancy **deferred** (behind `MODE2-REDUNDANCY-UNDEFER`).

---

## Amendment A — Session 24-D correction pass (2026-07-24)

**Author:** Session 24-D (Claude Code, Sonnet 5). **Scope:** two clarifying corrections surfaced by the
Session 24 independent review (`docs/reviews/session-24-reviewer.md`, MAJOR-1 and MINOR-5). No section of
the original ADR body is rewritten; both are additive.

### A.1 — §9/§12 citation-by-id boundary: hardened from "asserted" to "business_id-enforced" (MAJOR-1)

§9's `MODE2-EVIDENCE-DATA-GUARDED` and §12's caller table describe the citation-by-id boundary
(`wrapEvidenceForPrompt()` re-fetching evidence by pinned id at render time) as the guard against a stale
or cross-tenant row reaching a prompt. As originally shipped (B2.3–B2.6), the underlying fetch
(`getEvidenceMemoryByIds`, `lib/db/memory-evidence.ts`) filtered by id + `status='active'` only — **no
`business_id` filter** — while running under a service-role client (RLS bypassed) on the generation and
critique paths. The boundary was real in practice (ids are unguessable `gen_random_uuid()`s and the
assembly model only ever sees its own tenant's candidate ids), but it was **asserted, not enforced**: a
code comment claimed "the pinned id set itself is the trust boundary" without a query-level guarantee
behind it.

**Effect on ADR prose:** §9 and §12's caller table should be read as now also stating: `wrapEvidenceForPrompt()`
requires a `businessId` argument and threads it into `getEvidenceMemoryByIds`, which filters
`.eq('business_id', businessId)` — the same rule `lib/db/memory-evidence.ts`'s sibling function
(`listEvidenceMemoryCandidates`) already followed. Defense in depth, not a replacement: citation-by-id
AND business_id scoping, both present at the render-time choke point. Additionally, `assembleBrief` now
rejects any `pinnedEvidence` id the model returns that was not in the candidate set it was actually shown,
before persistence — closing the acceptance-time gap alongside the render-time one.

**Evidence:** Session 24-D correction pass D1 (`fc3bb063`); `security-reviewer` and `database-reviewer`
both re-ran clean against the hardened query. `docs/reviews/session-24-reviewer.md`'s CORRECTION PASS
section, MAJOR-1 row.

### A.2 — §5.2 `FrozenBrief` type: comment softened, `content` now deep-readonly (MINOR-5)

§5.2 states "A caller cannot pass a plain `Brief` where a `FrozenBrief` is required" — this overstates
what the `_brand: 'FrozenBrief'` string-literal tag actually enforces at the type level (the same
convention-strength brand pattern as `VaultSecretId`/`RenderedEvidence` elsewhere in this codebase; a
single-step `{...} as FrozenBrief` from a close-enough shape is legal TypeScript). §5.2's own next sentence
already correctly identifies the DB-layer `frozen_at` guard trigger as the real backstop — this amendment
just removes the type-layer overclaim that sat alongside it. Separately, `content` was typed shallowly
(`Readonly<CampaignBriefContent>`), so its arrays (`pinnedEvidence`/`roleSequence`) stayed typed-mutable —
TypeScript would have permitted a `.push()` that `deepFreezeContent`'s `Object.freeze()` calls already
threw on at runtime.

**Effect on ADR prose:** §5.2's "Type layer" bullet should be read as: `FrozenBrief` is produced by exactly
one function today (`freezeBrief`, confirmed via `git grep`), and its `content` field is now genuinely
deep-readonly (a local `DeepReadonly<T>` mapped type), matching what the runtime freeze already
guaranteed — but the brand itself remains convention-strength, not nominal; the DB trigger is, and was
always meant to be, the actual enforcement layer. One real consumer changed as a result:
`checkRoleCoverage` (`lib/campaigns/consistency.ts`, §8) had its `expected` parameter widened from a
mutable array type to `ReadonlyArray<...>` — a strict widening (still accepts the old mutable-array
callers), not a behavior change, since the function only ever reads via `.map()`.

**Evidence:** Session 24-D correction pass D4 (`f9797d4c`); `type-design-analyzer` confirmed the retype is
sound and the softened comment now matches both code and this ADR. `docs/reviews/session-24-reviewer.md`'s
CORRECTION PASS section, MINOR-5 row.

---

## Amendment B — `campaigns.origin` gains a fourth value (2026-08-21)

**Author:** Session 29 Track F Architect (F1a). **Amending ADR:** `0022-promote-to-campaign-and-format-families.md`.
**Authority:** build guide `docs/build-guide/session-29.md` §0.2 ruling **A-2**, adjudicated by the founder
2026-08-21. **Form:** ADR 0014 Amendment A / ADR 0010 Amendment 2 house form.

**Everything above this line is unchanged**, including Amendment A. This amendment is **additive**: one value
on one CHECK. No decision in the original ADR is rewritten or retracted.

### B.1 — The change

`campaigns.origin`'s CHECK, defined by §3.1 and shipped at
`supabase/migrations/20260722190000_mode2_brief_and_roles.sql:112-115` as
`CHECK (origin IN ('manual', 'objective_generated', 'signal_generated'))`, widens to admit a fourth value,
**`'studio_promoted'`** — the provenance of a campaign created by Mode 1 Studio's promote-to-campaign step
(ADR 0022 §2.3).

**Additive, and no backfill.** Widening a CHECK cannot invalidate an existing row; every extant row carries one
of the three original values and satisfies the wider constraint. The column's DEFAULT was added at `:107` and
**deliberately dropped** at `:109-110`, so every insert already states `origin` explicitly and no default
changes. `NOT VALID` then `VALIDATE CONSTRAINT` as a separate statement, matching the sequencing this
migration already uses at `:112-118`.

### B.2 — Why this amendment is needed when Stage F needed none

Worth recording, because the two cases look alike and are not. §3.1 shipped the `origin` enum
**forward-compatibly**, and ADR 0021 §6.2 was able to state — verified, not assumed — that *"`'signal_generated'`
already exists. Stage F costs no migration."*

**Promote has no such luck.** There is no studio-shaped value in the set, so Track F1 is the first consumer
since §3.1 that genuinely requires the enum to grow. That is the whole of this amendment.

### B.3 — The loser

**Reusing `'manual'`.** Mechanically free and semantically corrosive: it would make a promoted campaign
indistinguishable from a hand-typed one in `listCampaigns` (`lib/db/campaigns.ts:11-19`), in any future
provenance analysis, and — most damagingly — in the learning loop, whose value rests on knowing where a piece
of content came from. `origin` is the one column whose purpose *is* provenance; writing a false value into it
is not a shortcut but a defect.

### B.4 — What this amendment does NOT change

- **No change to `campaigns.status`**, whose CHECK remains `('draft','awaiting_brief','active','paused','completed')`
  (`:175`). A promoted campaign lands `'draft'` by column default and passes `assembleBrief`'s
  `status !== 'draft'` guard (`lib/campaigns/brief.ts:84-86`) exactly as a signal-seeded one does.
- **No change to `role`**, to `campaign_briefs`, to the frozen-brief model, or to the brief critique/HARD gate.
- **No change to Mode 2's generation behaviour** — Session 29 L-1 forbids it, and ADR 0022 §8 makes that
  testable rather than asserted.
- **No change to the format-family union, the platform map or the per-family Prompt factory** by *this*
  amendment. Carousel extends all three; that is ADR 0022 §6, and it deliberately leaves §4's existing rows
  byte-identical (ADR 0022 §6.3).
- **No new §D2.5 cascade row** — `campaigns` is already covered.

**Evidence:** ADR 0022 §2.3 and §13.2; `docs/build-guide/session-29.md` §0.2 ruling A-2. Builder commits
pending at the time this amendment was written.

---

## Amendment C — §15's D-6 deferral, partially closed by ADR 0022 (2026-08-25, Session 29-D, D11)

**Author:** Session 29-D (Claude Code, Sonnet 5), the Track F correction pass's close-out step.
**Authority:** ADR 0022 §6 (carousel), §7 (script), and its own §6.3/§7.1 amendments (Session 29-D, D6).
**Everything above this line is unchanged**, including Amendments A and B. This amendment records §15's D-6
line's current status; it does not restate or re-argue ADR 0022's own reasoning.

§15 states *"**Carousel + script format families** (D-6) — added when Instagram carousel / TikTok-Shorts
are prioritized; one new union branch each."* That line is **not rewritten** — it is superseded, in part,
by what actually shipped:

- **Carousel is CLOSED as a format family.** ADR 0022 §6 adds the third `FormatFamily` union branch,
  `CarouselOutputSchema`, `validateCarouselPolicy`, and the platform-map extension — all shipped and
  tested (`CAROUSEL-SCHEMA-STRUCTURAL`, `CAROUSEL-POLICY-SEQUENCE`). **Not fully closed**: ADR 0022 §6.3's
  amendment (Session 29-D, D6) records that the SOURCING half — a brief field or other Tier-0 signal that
  ever sets `carouselRequested` to `true` for a real campaign — was never built, deferred behind
  re-opening §8's frozen Mode 2 prompt fixtures (ADR 0022 §15 item 9 carries the revival condition).
  **Do not read this as "carousel closed"** — the family exists and is reachable in principle; nothing
  produces the input that reaches it yet.
- **Script is RE-DEFERRED as a format family — it did not become one.** ADR 0022 §7 ships `scriptBrief` as
  a bounded **recommendation field** (`imageBrief`'s footing, never published), explicitly rejecting the
  format-family shape L-9 forbids (ADR 0022 §7.1's original text, and its Session 29-D D6 amendment). §15's
  D-6 line's premise — that script would eventually become a union branch — is superseded: what shipped
  instead is a schema-and-render-ready field that no production prompt populates, with its own revival
  condition (ADR 0022 §15 item 10) shared with carousel's.
- **The skip-review fast path (L-11) is unaffected** — confirmed not touched by ADR 0022 or its
  correction pass; §15's original deferral for it stands exactly as written.

**Net effect on this ADR's own D-6 line:** carousel — mostly closed (family shipped, sourcing deferred);
script — its original framing (eventual format family) does not happen; a recommendation field ships
instead, which is a different shape than D-6 anticipated, not merely a delayed version of it.
