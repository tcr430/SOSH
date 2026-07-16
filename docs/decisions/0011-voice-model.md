# ADR 0011 — Voice Model, Calibration & Variations (Phase 1 MVP)

> **Status:** Accepted — Rev B (Architect, Session 19A; corrected for full cutover, R1–R5).
> **Supersedes:** the old manual brand-voice prose surface (the hand-authored `tone`/voice form and its write path) — **removed**, not parallel-run. See §3.1 and §13.
> **Amends:** ADR 0003 §11 (assessment output schema **and** prompt body — axis-scoring rubric), ADR 0001 §2/§4 (schema additions), **ADR 0004** (one additive voice block in the post-generation prompt that interpolates the descriptor; **output schema and prompt structure otherwise unchanged** — see §4).
> **Scope:** design only. No code, no UI, no migration SQL beyond column/CHECK specs.
>
> **This is a 100% replacement.** The 7-axis vector becomes the *sole* voice mechanism. The deterministic `descriptor` it produces is the *primary* voice instruction the generator reads (§4.3). There is no parallel old path after this session.

---

## 1. Context & problem; the 7 axes

### The problem

Today a business's voice lives only as prose bags on `brand_voices`: `tone text[]`, `keywords text[]`,
`avoid_words text[]`, plus `target_audience` and `unique_value_prop` (ADR 0001 §2, lines 112–129). These
are **hand-authored, lossy, and non-reproducible**:

- There is no single numeric source of truth, so "make it a bit warmer" has no representable meaning.
- Two assessments of the same site can produce different `tone[]` strings with no way to diff them.
- Per-campaign voice shifts ("bolder for the launch") cannot be expressed without free-text drift.
- The Reviewer cannot deterministically verify that a regenerated post used the same voice as before.

### The model

Voice becomes a **7-axis integer vector**, each axis `0–100`, where `0` is the first pole, `100` the
second pole, and `50` neutral. The vector is the **source of truth**. The prose fields ADR 0004 already
reads are **derived** from it by a pure, deterministic translation layer (§4).

| Axis key | 0-pole (low) | 50 (neutral) | 100-pole (high) |
|---|---|---|---|
| `formal_casual` | Formal, polished | Approachable | Casual, conversational |
| `expert_peer` | Authoritative expert | Knowledgeable guide | Peer, side-by-side |
| `serious_playful` | Serious, earnest | Lightly leavened | Playful, witty |
| `reserved_warm` | Reserved, restrained | Cordial | Warm, personable |
| `calm_energetic` | Calm, composed | Steady | Energetic, driving |
| `rational_emotional` | Rational, evidence-led | Balanced | Emotional, evocative |
| `exclusive_inclusive` | Selective, discerning | Welcoming | Inclusive, broad |

The canonical axis order above (top to bottom) is **load-bearing**: the translation layer (§4) and the
descriptor composer iterate in exactly this order so output is reproducible byte-for-byte.

---

## 2. Decisions: locks & adjudications

### Locked product decisions (do **not** re-open)

- **L-1 — Vector is source of truth.** A deterministic translation layer derives the prose voice fields
  from the vector. Prose is never the master copy.
- **L-2 — Assessment seeds, calibration refines.** Website assessment sets the **starting** vector;
  calibration questions refine it. Assessment failure ⇒ neutral (all `50`); the questions then carry it.
- **L-3 — Divergence-proportional deltas.** Per-answer movement is proportional to divergence: confirming
  the current position moves the dot little; contradicting it moves more; bounded so **no single answer
  fully overrides** the AI read.
- **L-4 — Each question targets 2–3 axes**, never all 7.
- **L-5 — Options are positioning statements**, not axis ratings (e.g. *"We're the experts who tell it
  straight"* vs *"We're peers figuring it out alongside you"*).
- **L-6 — Scales render as a labelled track + dot, no numbers.** Stored `0–100`.
- **L-7 — Must-include / cannot-include words appear at the END**, pre-filled and editable. They map to
  `keywords` / `avoid_words`.
- **L-8 — One reusable editor** is used in onboarding step 2 **and** settings. Sliders are read-only
  through the question flow; they unlock **only** at the final step.
- **L-9 — Calibration questions are STATIC.** A curated bank with hand-authored target vectors per option,
  pre-translated EN/PT/ES. No per-user AI generation of questions or option vectors.
- **L-10 — Variations are campaign-level presets** selected via `campaigns.voice_variation_id`;
  `null` = base voice.
- **L-11 — Variation suggestions are deterministic perturbations** of the base, mood-named
  (Bolder / Buttoned-up / Warmer / Sharper / Thought leader), one click to add, then rename + drag.
  Cap **5** (excluding base).
- **L-12 — Signal sources.** Website + up to 3 pasted writing samples now; a connected-account
  "refine from recent posts" step reuses the **same** assessment call. Both count against the trial
  assessment cap.
- **L-13 — Mobile stacks:** questions first, scales sticky/collapsible.

### Adjudicated architect decisions (resolved; full treatment in §10)

- **D-A** — `voice_axes` stored as **jsonb NOT NULL** with a structural DB CHECK + an app-layer Zod guard.
- **D-B** — The 5-variation cap is enforced by an **atomic SQL RPC** `create_voice_variation(...)`.
- **D-C** — Numeric tuning (bands, k-curve, bank vectors) is **STARTER**, not final; tuning is a post-Builder task.
- **D-D** — Refine-from-posts is the **explicit cut-line** (Session 19B B9, independently shippable).
- **D-E** — Module boundary: the **deterministic trio lives under `lib/voice/`**; the assessment prompt
  lives under `lib/ai/prompts/`.

---

## 3. Data model changes

One **additive, forward-only** migration. No data destruction, no column drops, no type changes to
existing columns.

### 3.1 `brand_voices` — add `voice_axes`

| Column | Type | Constraints / default |
|---|---|---|
| `voice_axes` | jsonb | NOT NULL, structural CHECK (below), default neutral object |

**Reclassification (no schema change, a semantics change):** `tone`, `keywords`, `avoid_words` become
**machine-written derived caches**, not hand-authored fields. `tone` is overwritten by the translation
layer (§4) on every save **and is demoted to a display/compatibility cache — it is no longer a generation
input** (R3; the generator now reads the `descriptor`, §4.3). `keywords`/`avoid_words` are written from the
must/cannot word inputs (L-7). `target_audience` and `unique_value_prop` remain assessment-authored prose
(untouched by this ADR).

**Old path removed (R5 — full cutover).** The previous manual brand-voice prose form and its write path are
**deleted** in this session, not left dormant or parallel-run. After Session 19 there is exactly one way to
set a voice: the vector editor (§9). Voice is written only through the vector → translation pipeline. See §13
for the teardown checklist.

**Backfill:** every existing `brand_voices` row is backfilled to the neutral vector — all 7 axes = `50` —
in the same migration. Existing `tone[]` values are left as-is on first deploy; they are re-derived the
next time the voice is saved through the editor. (No destructive overwrite at migration time.)

> **Cutover caveat.** Because the old path is removed (R5), a neutral-backfilled row whose `tone[]` still
> holds old prose is **inconsistent** until the business re-onboards through the vector editor — and the
> editor will show such a business as "all neutral," misrepresenting its real saved voice. This is acceptable
> **only if there are ~zero real businesses** (pre-launch; Stripe not yet live). **Builder gate:** confirm the
> live `brand_voices` count is test/demo data only. If any real voice exists, neutral backfill is wrong — fall
> back to a one-time deterministic reverse-derivation (map existing `tone[]` tags → approximate axis values)
> instead, rather than stranding real voices at neutral.

**Structural CHECK (the column spec — not a full migration script):**

```
CHECK (
  jsonb_typeof(voice_axes) = 'object'
  AND voice_axes ?& array[
    'formal_casual','expert_peer','serious_playful','reserved_warm',
    'calm_energetic','rational_emotional','exclusive_inclusive'
  ]
  AND jsonb_typeof(voice_axes->'formal_casual') = 'number'
  AND (voice_axes->>'formal_casual')::int BETWEEN 0 AND 100
  -- …repeated, identically, for all 7 axis keys…
)
```

`?&` asserts **all 7 keys present**; `jsonb_typeof(... ) = 'number'` rules out string-encoded numbers;
the `::int BETWEEN 0 AND 100` clamps range. This closes jsonb's only real weakness against this schema's
CHECK-everything posture (D-A). The **same CHECK shape** is applied to `brand_voice_variations.voice_axes`.

### 3.2 NEW table `brand_voice_variations`

| Column | Type | Constraints / default |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `business_id` | uuid | NOT NULL, FK → `businesses.id` **ON DELETE CASCADE** |
| `name` | text | NOT NULL |
| `voice_axes` | jsonb | NOT NULL, **same structural CHECK as §3.1** |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` (maintained by the shared `set_updated_at()` trigger, ADR 0001 §F) |

**Constraints / indexes**
- `UNIQUE (business_id, name)` — no two variations share a name within a business.
- Index on `business_id` (RLS path + the variation list query).

**Absolute, not offsets.** Variations store **absolute** vectors. A later edit to the base voice must
**not** retroactively move a variation. The perturbation engine (§8) computes a starting absolute vector
*once*, at suggestion time; from then on the variation is an independent absolute record. (Named loser for
this sub-decision: storing signed offsets from base — rejected because it couples every variation to the
mutable base and silently rewrites approved presets when the base shifts.)

**RLS.** Identical policy shape to `brand_voices` (ADR 0001 §C): `business_id IN (SELECT get_user_business_ids())`
for SELECT/INSERT/UPDATE/DELETE; every UPDATE policy carries both `USING` and `WITH CHECK`. The table is
business-scoped and reachable only via `businesses`, so per the CLAUDE.md **erasure-cascade rule** it is
added to ADR 0010 Amendment 2's cascade table (§D2.5) in this same migration: it cascades from
`businesses ON DELETE`, so it is covered by `purge_business` automatically — **document the row, do not
leave it implicit.**

**Cap of 5** (excluding base) is enforced **only** through the atomic RPC `create_voice_variation` (§3.4,
D-B), never by an app-layer count-before-insert.

### 3.3 `campaigns` — add `voice_variation_id`

| Column | Type | Constraints / default |
|---|---|---|
| `voice_variation_id` | uuid | nullable, FK → `brand_voice_variations.id` **ON DELETE SET NULL** |

`null` = base voice. `ON DELETE SET NULL` means deleting a variation degrades affected campaigns back to
base rather than blocking the delete or cascading campaign loss. `voice_variation_id` is business-scoped
and FK-constrained (no cross-tenant risk), so it is an ordinary updatable field set on campaign
create/edit — it does **not** need to be excluded from the tenancy-safe `CampaignUpdate` surface
(contrast `business_id`, which is, per CLAUDE.md).

### 3.4 Atomic RPC `create_voice_variation` (spec, per D-B)

A `SECURITY DEFINER` function, `REVOKE`d from `public`, `GRANT`ed to `service_role` only. Behavior:

1. `SELECT 1 FROM businesses WHERE id = p_business_id FOR UPDATE` — locks the parent row, serializing
   concurrent variation creates for this business.
2. `SELECT count(*) FROM brand_voice_variations WHERE business_id = p_business_id`.
3. If `count >= 5` → `RAISE` a **typed** error (sentinel SQLSTATE / message
   `voice_variation_cap_reached`).
4. Else `INSERT … RETURNING *`.

Surfaced via `lib/db/voice.ts`, which catches the typed Postgres error using the project's
`isPostgresError` guard (learned skill `postgres-error-type-guard`) and re-throws a typed
`VoiceVariationCapError` for the Server Action layer. This mirrors migration 25's atomic-counter precedent
and the CLAUDE.md "Atomic state transitions" convention.

---

## 4. THE TRANSLATION LAYER ⭐ (the headline)

> **SCOPE GUARANTEE — READ THIS TWICE (Rev B, R1).**
> This session is a **full replacement**, so the generator **must** consume the new voice. The guarantee is
> therefore about *bounding* the change, not avoiding it:
> - **ADR 0004's post-generation prompt gains exactly ONE voice block** that interpolates the deterministic
>   `descriptor` (§4.3). That is the single edit to the prompt.
> - **`PostGenerationOutputSchema` is unchanged.** No new output fields, no second model call, no restructure
>   of the rest of the prompt.
> - **The model reads the `descriptor`, not `tone[]`** (R3). `tone[]` stays written as a display/compat cache
>   but is removed from the prompt's voice inputs.
> - **The raw 7 integers are NOT placed in the prompt.** The descriptor already encodes them; exposing the
>   numbers invites the model to improvise intensities. (Revisit only if a later eval shows prose alone
>   underperforms.)
>
> What the old guarantee was protecting — no schema churn, no second round-trip, no prompt rework — still
> holds. What it must **not** do is leave the vector stranded: a Builder who ships the descriptor into context
> but never interpolates it into the prompt has built a parallel surface, not a replacement. Wiring the one
> voice block **is** the step.

### 4.1 The function

```
// lib/voice/translate.ts  (OUTSIDE lib/ai/ — respects the AI-gateway boundary)
function vectorToVoiceFields(axes: VoiceAxes): {
  tone: string[]        // overwrites brand_voices.tone — the field ADR 0004 already reads
  descriptor: string    // one-line prose, NOT persisted; injected at context-assembly time
}
```

**Pure and deterministic. NOT an AI call.** Justification:

- **Zero per-generation cost.** Every post generation would otherwise pay tokens to re-derive prose that is
  a fixed function of 7 integers. The translation runs in-process, free.
- **Reproducibility.** The Reviewer and the regeneration path require that the same vector always yields the
  same `tone[]` and descriptor. An AI call cannot guarantee that.
- **No hot-path latency or injection surface.** The post-generation flow stays single-call; no second model
  round-trip, no user text entering a second prompt.

### 4.2 Banding mechanism (STARTER values — D-C)

Each axis maps through **3 bands** to (a) an optional `tone` tag and (b) a `descriptor` fragment. Fragments
compose in canonical axis order (§1).

**Starter band thresholds (locked as starter, not final):** `0–30` = low pole · `31–69` = neutral ·
`70–100` = high pole.

| Axis | Low band (0–30) | Neutral (31–69) | High band (70–100) |
|---|---|---|---|
| `formal_casual` | tone `professional` · *"formal and polished"* | *"approachable"* | tone `conversational` · *"casual and conversational"* |
| `expert_peer` | tone `authoritative` · *"speaks with authority"* | *"knowledgeable but accessible"* | tone `collaborative` · *"speaks peer-to-peer"* |
| `serious_playful` | tone `earnest` · *"serious and substantive"* | *"lightly leavened"* | tone `playful` · *"playful and witty"* |
| `reserved_warm` | tone `measured` · *"reserved and restrained"* | *"cordial"* | tone `warm` · *"warm and personable"* |
| `calm_energetic` | tone `calm` · *"calm and composed"* | *"steady"* | tone `energetic` · *"energetic and driving"* |
| `rational_emotional` | tone `analytical` · *"rational and evidence-led"* | *"balances logic and feeling"* | tone `evocative` · *"emotionally resonant"* |
| `exclusive_inclusive` | tone `discerning` · *"selective and discerning"* | *"welcoming"* | tone `inclusive` · *"inclusive and broad"* |

**Composition rules (locked):**
- **`tone[]`** (display/compat cache, R3): collect the tone tag from each **non-neutral** band, in axis
  order, de-duplicated (first occurrence wins). Neutral bands contribute **no** tone tag. This array is
  surfaced in the UI and kept for compatibility; **it is not a generation input.**
- **`descriptor`** (the **primary generation instruction**, R2): composed deterministically from all 7
  axes, but it is a **real deliverable, not a placeholder** — its quality is what steers the model, so it
  must read as natural prose, not a flat enumeration. Requirements the Builder must meet, all while staying
  a pure deterministic function (same vector ⇒ byte-identical descriptor):
  - **Grammatically correct:** article selection (`a`/`an`), no `"A approachable…"` artifacts.
  - **Grouped, not listy:** cluster related axes into readable clauses (e.g. formality + warmth in one
    clause; energy + emotion in another) rather than `"<f1>, <f2>, … and <f7>."` A flat 7-item list is
    explicitly rejected.
  - **Vocabulary reviewed for LLM-steering:** the band→fragment phrases (§4.2 table) are **starter** (D-C)
    and must be reviewed so each fragment actually moves model output, not just describes it.
  - **Deterministic by construction:** fixed axis order (§1), no randomness, no model call.
- **All-neutral edge case (vector = all 50):** `tone[]` → `['balanced']`; `descriptor` =
  `"A balanced, neutral voice with no strong leanings."` Locked so the Reviewer can assert it.

### 4.3 Output routing

- `tone[]` is **persisted** to `brand_voices.tone` on save as a display/compat cache (R3). The
  post-generation prompt **no longer reads it.**
- `descriptor` is **not persisted.** It is computed at context-assembly time in `lib/ai/context.ts`: when
  `buildCustomerContext` loads `brand_voices` (or the campaign's selected variation, §8), it calls
  `vectorToVoiceFields(axes)` and sets `ctx.brandVoice.descriptor`.
- **Consumed this session (R1):** the post-generation prompt's single new voice block interpolates
  `ctx.brandVoice.descriptor`. `target_audience`, `keywords`, `avoid_words`, `unique_value_prop` continue to
  flow into the prompt exactly as today. `PostGenerationOutputSchema` is unchanged. The raw axis integers are
  **not** placed in the prompt — the descriptor is the sole vector-derived voice signal the model sees.

---

## 5. Assessment (amends ADR 0003 §11)

The brand-voice inference prompt (`lib/ai/prompts/brand-voice-inference.ts`, ADR 0003 §11) is extended in
**two** ways: the **output schema** gains `voiceAxes`, and the **prompt body** gains a per-axis scoring
rubric (R4, below). The assessment now **also** returns the starting vector.

**Output schema extension** (additive — existing fields unchanged):

```typescript
const BrandVoiceInferredSchema = z.object({
  tone: z.array(z.string()).min(1).max(5),
  targetAudience: z.string().min(10).max(500),
  keywords: z.array(z.string()).min(3).max(20),
  avoidWords: z.array(z.string()).max(20),
  uniqueValueProp: z.string().min(20).max(500),
  competitors: z.array(z.string()).max(10),
  // NEW — required, all 7 keys, each an integer 0–100:
  voiceAxes: z.object({
    formal_casual:       z.number().int().min(0).max(100),
    expert_peer:         z.number().int().min(0).max(100),
    serious_playful:     z.number().int().min(0).max(100),
    reserved_warm:       z.number().int().min(0).max(100),
    calm_energetic:      z.number().int().min(0).max(100),
    rational_emotional:  z.number().int().min(0).max(100),
    exclusive_inclusive: z.number().int().min(0).max(100),
  }),
})
```

**Prompt-body rubric — REQUIRED (R4).** Adding `voiceAxes` to the output schema is **not sufficient**: the
prompt body must give the model a short **per-axis rubric** so the seed is signal, not noise. For each of
the 7 axes, the prompt includes a one-line anchor describing what the low pole (≈0–20) vs the high pole
(≈80–100) looks like in real site/marketing copy, and instructs the model to score `0–100` from observed
evidence (defaulting to ~50 when a site gives no signal on that axis). Example anchor (Builder writes all 7):
`formal_casual — 0–20: precise, buttoned-up, third-person, no contractions; 80–100: chatty, first/second
person, contractions, casual asides.` Without these anchors the starting dots are unreliable, and the whole
calibration flow (§6) refines from an unreliable base. The anchors are **starter** wording (D-C), tuned later.

**Inputs unchanged** (ADR 0003 §11): website text via `fetchWebsiteText()` (the SSRF-guarded fetcher,
ADR 0003 §12, constraints F-1–F-14) when `business.website` is set, plus **up to 3** pasted writing
samples — the cap of 3 is the binding DB CHECK on `brand_voices.writing_examples`
(`cardinality(writing_examples) <= 3`, ADR 0001 §2 line 124). The "up to 5" prose in ADR 0003 §11 is
**superseded** by that CHECK; the assessment input layer enforces ≤3.

**Trial cap unchanged.** Assessment remains capped at **3 attempts per business** during trial via
`trial_state.brand_voice_inference_attempts` (ADR 0003 §7, §13). Refine-from-posts (§7) is
**assessment-class** and shares this same counter and cap.

**Failure path (L-2).** If the assessment call fails, or `fetchWebsiteText` returns `null` and no samples
were pasted, the starting vector is the **neutral** vector (all `50`). The calibration flow (§6) then
carries the voice from neutral. Assessment failure never blocks onboarding.

---

## 6. Calibration mechanic

`lib/voice/calibration.ts` (D-E) — pure, runnable on client and server, **no AI**. A static bank (L-9) of
**6** questions; each presents 3–4 **positioning-statement** options (L-5); each option carries a
hand-authored **target vector** over the **2–3 axes** that option speaks to (L-4). Axes an option does not
target are absent from its target and receive **no delta**.

### 6.1 The delta rule (STARTER curve — D-C)

For each axis the selected option targets:

```
gap   = target − current                       // signed
k     = clamp(K_MIN + (K_MAX − K_MIN) * (abs(gap) / 100), K_MIN, K_MAX)
next  = round(current + k * gap)               // then clamp 0–100
```

**Starter constants (locked as starter):** `K_MIN = 0.15`, `K_MAX = 0.45`.

This satisfies L-3: `k` rises with divergence, and because `k` never reaches `1`, **no single answer fully
overrides** the AI read — the maximum pull is 45 % of the gap. Confirming the current position (small
`|gap|`) yields both a small `k` and a small gap → the dot barely moves. Contradicting it (large `|gap|`)
yields a larger `k` and a larger gap → a bigger but still bounded move. Untargeted axes are untouched.

### 6.2 The bank — EN copy, verbatim (real deliverable)

> Authored EN copy below is the canonical source; PT/ES are pre-translated from it (L-9). Target vectors
> are **starter** values (D-C). Each option lists only the axes it targets.

**Q1. "How do you want to come across when you share what you know?"** *(targets `formal_casual`, `expert_peer`)*
- **A. "We're the experts who tell it straight."** → `formal_casual: 25`, `expert_peer: 15`
- **B. "We're seasoned pros, but we keep it human."** → `formal_casual: 55`, `expert_peer: 40`
- **C. "We're peers figuring it out alongside you."** → `formal_casual: 80`, `expert_peer: 85`
- **D. "We're the friendly guide who simplifies the hard stuff."** → `formal_casual: 70`, `expert_peer: 65`

**Q2. "What's the energy of your best content?"** *(targets `serious_playful`, `calm_energetic`)*
- **A. "Considered and substantive — no fluff."** → `serious_playful: 20`, `calm_energetic: 30`
- **B. "Upbeat and momentum-building."** → `serious_playful: 60`, `calm_energetic: 85`
- **C. "Witty and a little irreverent."** → `serious_playful: 88`, `calm_energetic: 70`
- **D. "Steady and reassuring."** → `serious_playful: 35`, `calm_energetic: 25`

**Q3. "When you make a point, what carries it?"** *(targets `reserved_warm`, `rational_emotional`)*
- **A. "The evidence. We let the data speak."** → `reserved_warm: 30`, `rational_emotional: 15`
- **B. "The story. We make people feel it."** → `reserved_warm: 80`, `rational_emotional: 85`
- **C. "A bit of both — proof you can feel."** → `reserved_warm: 60`, `rational_emotional: 55`
- **D. "Clear logic, warmly delivered."** → `reserved_warm: 72`, `rational_emotional: 38`

**Q4. "Who are you really talking to?"** *(targets `exclusive_inclusive`, `expert_peer`)*
- **A. "A select few who already get it."** → `exclusive_inclusive: 20`, `expert_peer: 25`
- **B. "Anyone willing to learn — all are welcome."** → `exclusive_inclusive: 88`, `expert_peer: 70`
- **C. "Our specific niche, spoken to directly."** → `exclusive_inclusive: 45`, `expert_peer: 40`
- **D. "A broad audience, met where they are."** → `exclusive_inclusive: 78`, `expert_peer: 60`

**Q5. "Pick the line that sounds most like you."** *(targets `formal_casual`, `reserved_warm`, `serious_playful`)*
- **A. "Here's what the numbers tell us this quarter."** → `formal_casual: 20`, `reserved_warm: 30`, `serious_playful: 25`
- **B. "Okay, this one's a game-changer — hear us out."** → `formal_casual: 82`, `reserved_warm: 75`, `serious_playful: 78`
- **C. "We've been there too. Here's what helped."** → `formal_casual: 68`, `reserved_warm: 82`, `serious_playful: 45`
- **D. "Let's break this down, step by step."** → `formal_casual: 55`, `reserved_warm: 58`, `serious_playful: 40`

**Q6. "How should people feel after reading?"** *(targets `calm_energetic`, `rational_emotional`, `exclusive_inclusive`)*
- **A. "Informed and clear-headed."** → `calm_energetic: 30`, `rational_emotional: 25`, `exclusive_inclusive: 50`
- **B. "Fired up and ready to act."** → `calm_energetic: 88`, `rational_emotional: 70`, `exclusive_inclusive: 65`
- **C. "Seen, and part of something."** → `calm_energetic: 55`, `rational_emotional: 80`, `exclusive_inclusive: 88`
- **D. "Confident they're in expert hands."** → `calm_energetic: 40`, `rational_emotional: 35`, `exclusive_inclusive: 35`

**Coverage check:** all 7 axes appear across the bank — `formal_casual` (Q1,Q5), `expert_peer` (Q1,Q4),
`serious_playful` (Q2,Q5), `reserved_warm` (Q3,Q5), `calm_energetic` (Q2,Q6), `rational_emotional` (Q3,Q6),
`exclusive_inclusive` (Q4,Q6). No question targets more than 3 axes (L-4).

---

## 7. Refine from connected posts (per D-D — the cut-line)

A connected-account step lets the user pull their **recent published posts** and refine the vector from how
they actually write. It **reuses the same assessment call** (§5) — it is not a new model prompt.

- **Read path:** recent posts are fetched through the existing `SocialProvider` read surface
  (`/lib/social/`, ADR 0002) — no new platform integration, no direct platform SDK calls.
- **Feed:** fetched post text is passed as **writing-example-equivalent** input into the same assessment
  prompt that already accepts pasted samples (§5). The cap-3 rule applies to the equivalent-sample count
  fed in a single call.
- **Cap:** counts against the **same** `brand_voice_inference_attempts` trial cap (L-12). It is
  assessment-class.
- **Cut-line (D-D):** this is the **explicitly droppable** unit of Session 19. If built it ships as
  **Session 19B B9** and must be **independently shippable** — the vector model, translation layer,
  calibration, and variations all function fully without it. Document it; do not let it block the core.

---

## 8. Variations & suggestions

`lib/voice/variations.ts` (D-E) — a **deterministic perturbation engine**, no AI.

### 8.1 The five mood presets (STARTER perturbations — D-C)

Each preset applies fixed **signed offsets** to a small cluster of axes, then **clamps to 0–100**. Offsets
are applied to the **base** vector to produce the variation's **absolute** starting vector (§3.2), computed
once at suggestion time.

| Preset | Axis nudges (signed, applied to base then clamped) |
|---|---|
| **Bolder** | `expert_peer −12` (more authoritative), `calm_energetic +18`, `serious_playful +6`, `rational_emotional +8` |
| **Buttoned-up** | `formal_casual −18`, `serious_playful −15`, `calm_energetic −10`, `reserved_warm −8` |
| **Warmer** | `reserved_warm +18`, `rational_emotional +12`, `exclusive_inclusive +12`, `formal_casual +8` |
| **Sharper** | `rational_emotional −15`, `serious_playful −8`, `reserved_warm −10`, `expert_peer −10` |
| **Thought leader** | `expert_peer −15` (authority), `formal_casual −10`, `rational_emotional −8`, `exclusive_inclusive −12` (more selective), `calm_energetic +5` |

The list of suggestions offered is itself deterministic: the engine emits all five (minus any whose name
already exists for the business). Suggestions are **proposals** — nothing is written until the user clicks.

### 8.2 Lifecycle

- **One-click add** → calls `create_voice_variation` (§3.4 RPC) with the computed absolute vector and the
  mood name → inserts a `brand_voice_variations` row. The **cap of 5 is enforced inside that RPC**, not in
  app code (D-B). A cap hit surfaces as the typed `VoiceVariationCapError`.
- **Rename + drag** → ordinary `UPDATE name` on the row (subject to `UNIQUE(business_id, name)`).
- **Campaign selection** → the voice dropdown on campaign create/edit sets
  `campaigns.voice_variation_id`; `null` = base (L-10). At generation time, context assembly (§4.3) loads
  the selected variation's `voice_axes` instead of the base when `voice_variation_id` is set.

---

## 9. Reusable editor surface (L-8)

One component, two mounts (onboarding step 2 + settings). **Behavioral spec only — no JSX in this ADR.**

- **Two-pane layout.** Left pane: the calibration questions (§6) in sequence, then the must-include /
  cannot-include word inputs (L-7) at the **end**, pre-filled and editable, mapping to
  `keywords` / `avoid_words`. Right pane: the **7-axis track** (labelled track + dot per axis, **no
  numbers** — L-6).
- **AI-read line.** Atop the calibration panel sits the assessment's one-line read of the site —
  *"Here's the voice we read from your site"* — populated from the assessment (§5), shown before the user
  answers anything.
- **Read-only until the final step (L-8).** Through the question flow the sliders are **display-only**;
  each answer animates the dots but the user cannot drag. Dragging unlocks **only** at the final step, for
  manual fine-tuning before save. On save: `vectorToVoiceFields` (§4) runs and writes `tone[]`; the word
  inputs write `keywords`/`avoid_words`; `voice_axes` is persisted.
- **Mobile (L-13).** Panes stack: **questions first**, the 7-axis scales become a **sticky/collapsible**
  summary so the user always sees the dots move without the track dominating the viewport.

---

## 10. Resolved decisions (Options Considered + named loser)

### D-A — `voice_axes` as jsonb (not 7 smallint columns)

- **Chosen:** one `jsonb NOT NULL` column with a structural CHECK (all 7 keys, each int 0–100) **plus** an
  app-layer Zod guard in `lib/db/voice.ts`. Same shape in `brand_voices` and `brand_voice_variations`.
- **Named loser: 7 `smallint` columns.** Gets per-axis range CHECKs for free, but: 14 duplicated column
  definitions across two tables; the object must be reconstructed on every read; and per-axis queryability
  is a feature we never use (YAGNI). The vector is **always** read and written as a unit — exactly the
  `text[]` bag pattern this schema already uses for `tone`/`keywords`/`avoid_words` (ADR 0001 §2). Named
  keys rule out a bare `smallint[]` (positional fragility). The structural CHECK closes jsonb's only real
  weakness — missing/mistyped keys — keeping us consistent with the schema's CHECK-everything posture.

### D-B — 5-variation cap via atomic RPC (not app-layer count)

- **Chosen:** `create_voice_variation(...)` RPC that `SELECT … FOR UPDATE`s the parent `businesses` row,
  counts, and inserts-or-raises a typed error (§3.4). Mirrors migration 25's atomic-counter precedent and
  the CLAUDE.md "Atomic state transitions" convention.
- **Named loser: app-layer count-before-insert.** TOCTOU race — two concurrent inserts each count 4 and
  both insert → 6 variations, cap silently breached.
- **Second loser: plain `BEFORE INSERT` trigger.** Needs its own advisory/row locking to be race-safe and
  produces fuzzier, harder-to-map errors than an explicit RPC with a sentinel SQLSTATE.

### D-C — STARTER tuning, not final

- **Chosen:** the band thresholds (§4.2), the k-curve constants (§6.1), and the question-bank target
  vectors + perturbation offsets (§6.2, §8.1) are all **starter** values. Numeric tuning against real
  output is a **post-Builder** task.
- **Named loser: present these as final, calibrated numbers.** Rejected — we have no output telemetry yet;
  freezing the numbers would invite premature precision and make later tuning look like a regression rather
  than the intended next step.

### D-D — refine-from-posts is the cut-line

- **Chosen:** build refine-from-posts as an **independently shippable** unit (Session 19B B9). The core
  voice model ships and is fully usable without it.
- **Named loser: fold refine into the core onboarding flow.** Rejected — it depends on a connected account
  and the `SocialProvider` read path, coupling core voice delivery to social-connection readiness and
  enlarging the critical path for no core benefit.

### D-E — module boundary

- **Chosen:** the **deterministic trio** — `lib/voice/translate.ts`, `lib/voice/calibration.ts`,
  `lib/voice/variations.ts` — lives **outside** `lib/ai/`. The **assessment prompt** lives under
  `lib/ai/prompts/`. Honors the CLAUDE.md AI-gateway boundary: only AI calls live under `lib/ai/`; pure
  deterministic logic does not.
- **Named loser: put the translation/calibration logic under `lib/ai/`** because it concerns "voice."
  Rejected — none of the trio calls Anthropic; placing them under `lib/ai/` would blur the boundary the
  codebase enforces with the no-direct-SDK rule and invite future AI calls to leak into deterministic code.

---

## 11. Consequences

- **Generator consumes the new voice (R1).** ADR 0004's **output schema is unchanged** and its prompt is
  unchanged except for **one additive voice block** that interpolates the descriptor (§4.3). The model reads
  the descriptor, not `tone[]` (R3); no second model call, no raw integers in the prompt. This is the point
  of a full replacement — the voice the user builds actually reaches generation.
- **One voice mechanism (R5).** The old manual prose form and write path are removed; there is no parallel
  surface. All voice flows vector → translation → descriptor.
- **Cost profile.** Calibration, translation, and variation suggestion are **free** (pure, in-process).
  **Only** assessment and refine-from-posts hit the Anthropic API, and both are bounded by the existing
  3-attempt trial cap (ADR 0003 §7/§13). No new recurring per-generation cost is introduced.
- **Reversibility.** The migration is **additive and forward-only** (new column, new table, new nullable
  FK). Rollback is a column/table drop; no existing data is destroyed (existing `tone[]` left intact;
  vectors backfilled to neutral).
- **Phase 2 versioning hook.** `brand_voices` remains single-row per business (versioning deferred, ADR
  0001 §2). When voice versioning lands, `voice_axes` snapshots are the natural unit to version — far
  cleaner to diff than prose. `brand_voice_variations` already demonstrates the absolute-vector pattern a
  version history would reuse.

---

## 12. Evidence (repo-grounded)

Every grounding fact this ADR depends on, cited to file + section/line:

| Fact | Source |
|---|---|
| `brand_voices` carries `tone text[]`, `keywords text[]`, `avoid_words text[]`, `target_audience`, `unique_value_prop`, `competitors`, `inferred_from_url` | `docs/decisions/0001-database-schema.md` §2, lines **112–129** |
| `writing_examples` hard-capped at 3 by DB CHECK (`cardinality(writing_examples) <= 3`); AI layer may rely on it | `docs/decisions/0001-database-schema.md` §2, line **124** (note line 137) |
| `campaigns` has no voice column today (name/objective/special_instructions/platforms/frequency/posts_per_week/dates/status/counters/soft-delete) | `docs/decisions/0001-database-schema.md` §4, lines **174–207** |
| Post-generation prompt reads brand voice (`tone`, `target_audience`, `keywords`, `avoid_words`, `unique_value_prop`) off `ctx.brandVoice` | `docs/decisions/0004-post-generation.md`, line **169** |
| Brand-voice inference prompt, inputs, output schema; the superseded "up to 5" prose | `docs/decisions/0003-ai-layer.md` §11, lines **297–334** |
| SSRF-guarded `fetchWebsiteText()` (constraints F-1–F-14) used by assessment | `docs/decisions/0003-ai-layer.md` §12, lines **338–375** |
| Trial assessment cap = `trial_state.brand_voice_inference_attempts`, 3 per business; cap constant in `config.ts` | `docs/decisions/0003-ai-layer.md` §7 (line **195**), §13 (lines **377–383**) |
| AI-gateway import boundary; lib/db one-file-per-table; atomic state transitions; erasure-cascade rule | `CLAUDE.md` — "The AI layer", "Database access", "Atomic state transitions", "Multi-tenancy via RLS" |
| Atomic-counter RPC precedent (`increment_brand_voice_attempts`) | migration 25 (ADR 0003 §13; current-phase.md Session 5B) |

---

## 13. Old-path teardown (R5 — full cutover)

This session **removes** the legacy brand-voice surface; it does not deprecate-in-place. The Builder must, in
the same session:

- **Delete** the manual brand-voice prose form (the hand-authored `tone`/voice editing UI) and its Server
  Action / write path. After this, `brand_voices.tone` is written **only** by the translation layer.
- **Remove** any code path that treats `tone[]` (or other prose fields) as a *generation input*; the prompt's
  voice block reads the descriptor (§4.3). Grep the generation path for `brandVoice.tone` usage and excise it.
- **Route** every voice write — onboarding and settings — through the single vector editor (§9).
- **Confirm** (gate) the live `brand_voices` table holds only test/demo rows before the neutral backfill ships
  (§3.1 cutover caveat). If real voice data exists, switch to reverse-derivation instead of neutral backfill.
- **Reviewer assertion:** no remaining code reads `brand_voices.tone` as a generation input; no second voice
  editor exists; a generated post reflects the descriptor for the active voice/variation.

This teardown is its own Builder workstream (Phase B gains a row, e.g. **B0 — old-path teardown**, sequenced
so the new pipeline lands before the old one is cut, not after, to avoid a voice-less window).

---

## Rev B changelog (R1–R5)

- **R1** — Scope guarantee flipped (§4 box, §4.3, §11): the generator **consumes** the descriptor via one
  additive prompt voice block. Output schema still unchanged; no second model call; no raw integers in prompt.
- **R2** — Descriptor composer promoted to a real deliverable (§4.2): deterministic but grammatical, grouped
  (not a flat 7-item list), vocabulary reviewed for LLM-steering.
- **R3** — `descriptor` is the **primary** generation instruction; `tone[]` demoted to display/compat cache,
  removed from generation inputs (§3.1, §4.2, §4.3).
- **R4** — Assessment prompt gains a **per-axis scoring rubric** in the prompt body, not just the schema field
  (§5).
- **R5** — Old manual prose path **removed**, not parallel-run (§3.1, §13); single voice mechanism.

*End of ADR 0011 (Rev B).*
