# Session 19 — Voice Model: Reviewer Findings

> Auditor: Reviewer (Session 19C). Contract: **ADR 0011 Rev B**, audited area by area.
> Adjacent ADRs consulted: 0001 §2/§4, 0003 §11–§13, 0004 §5/§6, 0002 (BP9 read path), 0010 Amd 2 §D2.5.
> Scope: the full Session 19 diff (migration, `lib/voice/*`, `lib/validation/voice.ts`, `lib/db/voice.ts`,
> `lib/ai/context.ts`, the ADR 0004 prompt, `brand-voice-inference.ts`, editor + campaign UI, BP8 teardown, BP9 refine).

**Tier legend:** BLOCKER (fix before merge) · MAJOR (fix before launch) · MINOR (would improve) · NIT (preference).

---

## §3.1 brand_voices + storage (D-A)

- `voice_axes jsonb NOT NULL`, full structural CHECK — `?&` asserts all 7 keys, each `jsonb_typeof = 'number'`,
  each `::int BETWEEN 0 AND 100` (migration lines 16–39). Same CHECK shape on the variation table. **Matches D-A.**
- Single jsonb column, not 7 smallint columns. **Matches D-A.**
- `lib/validation/voice.ts` exports `voiceAxesSchema` (int 0–100 ×7) + `NEUTRAL_VOICE_AXES`, shared `VoiceAxes` type
  re-exported from `lib/db/types.ts`. Type is shared everywhere. **Clean.**
- Neutral backfill via column DEFAULT; cutover gate documented as a SQL comment (lines 3–7). **Clean.**

**✅ FIXED (19D-2) — base-voice writes are now gated by the shared Zod guard.**
`voicePayloadSchema` (axes + tone + keywords + avoidWords) added to `lib/validation/voice.ts`; `saveBaseVoiceAction` validates via `voicePayloadSchema.safeParse` and returns `{ error: 'validation' }` instead of silently swallowing. `saveVoiceAxesAction` validates via `voiceAxesCoerceSchema`. Silent `catch {}` replaced with structured error return.

**✅ FIXED (19D-2) — variation write actions now import the shared coerce guard.**
`voiceAxesCoerceSchema` exported from `lib/validation/voice.ts`; `settings/voice/actions.ts` imports it and uses it in `parseVoiceAxes`; local duplicate removed.

---

## §3.2 brand_voice_variations

- Stores **absolute** vectors. `suggestVariations` computes `applyOffsets(base, …)` once at suggestion time
  (`lib/voice/variations.ts:35,57`); no offset is persisted, no recompute against a mutable base. **Matches §3.2 (no offsets).**
- `UNIQUE (business_id, name)` (migration line 76); index on `business_id` (line 79); `set_updated_at` trigger (line 82).
- RLS enabled; SELECT/INSERT/UPDATE/DELETE policies use `business_id = ANY (public.get_user_business_ids())`; the UPDATE
  policy carries **both** `USING` and `WITH CHECK` (lines 88–103). This is byte-identical to the established
  `brand_voices` policy shape (verified against `20260430120005_brand_voices.sql`) — the `= ANY(func())` form is the
  project-wide convention, not a deviation. **Clean — no cross-tenant read/write.**
- Cascade row documented in the migration header per ADR 0010 Amd 2 §D2.5; table cascades `business_id ON DELETE CASCADE`
  so `purge_business` covers it automatically. **Matches the erasure-cascade rule.**

Clean.

---

## §3.3 campaigns.voice_variation_id

- `uuid … REFERENCES brand_voice_variations(id) ON DELETE SET NULL`, nullable (migration lines 107–109). Deleting a
  variation degrades dependent campaigns to base, never blocks/cascades. **Correct on-delete.**

**✅ FIXED (19D-1) — `voice_variation_id` is now tenant-validated at both write and read time.**
`getVariationForBusiness(client, id, businessId)` added to `lib/db/voice.ts` (explicit `business_id` filter, safe for service-role). `createCampaignAction` calls it before INSERT via the RLS client — rejects cross-tenant UUID. `buildCustomerContext` calls `getVariationForBusiness(serviceClient, voiceVariationId, businessId)` — cross-tenant returns null and degrades to base voice. Tests cover the cross-tenant rejection path.

---

## §3.4 create_voice_variation RPC (D-B)

- Cap of 5 enforced **only** inside the RPC; no app-layer count-before-insert anywhere (`addVariation` →
  `createVoiceVariation` → `client.rpc`, `lib/db/voice.ts:26–48`). **No TOCTOU race.**
- `PERFORM 1 FROM public.businesses WHERE id = p_business_id FOR UPDATE` (migration line 133) serialises concurrent
  creates; counts; `RAISE EXCEPTION 'voice_variation_cap_reached'` on `>= 5`; else `INSERT … RETURNING`. **Race-safe.**
- `SECURITY DEFINER`, `SET search_path = public, pg_temp` (**pinned**), `REVOKE … FROM public`, `GRANT … TO service_role`
  (lines 126–127, 150–151). **Hardening correct.**
- `lib/db/voice.ts:41` catches via `isPostgresError` + message match and re-throws typed `VoiceVariationCapError`;
  `addVariationAction` maps it to `variation_cap_reached`. **Matches D-B.**

**✅ FIXED (19D-3) — `createVoiceVariation` unwraps the SETOF array.**
`return (data as BrandVoiceVariationRow[])[0]`. Test mocks updated to return arrays; scalar `.id`/`.name` access asserted.

---

## §4 Translation layer (R1/R2/R3 — the spine)

- `lib/voice/translate.ts` imports only the `VoiceAxes` **type** from `lib/validation/voice` — **nothing from `lib/ai/`**,
  no model call, no randomness. **Matches D-E; pure.**
- Bands `≤30 / 31–69 / ≥70` (line 58–62) match §4.2 starter thresholds; band→tone/fragment table matches §4.2 verbatim.
- Determinism proven: `translate.test.ts:35` asserts same vector ⇒ byte-identical `descriptor`; all-low/all-high
  snapshot tests (lines 87, 96). **Determinism test present.**
- **R1:** exactly **one** voice block in the post-generation prompt (`post-generation.ts:131–141`), interpolating
  `ctx.brandVoice.descriptor`. `target_audience`/`keywords`/`avoid_words`/`unique_value_prop` still flow as before.
  **One block, descriptor interpolated.**
- `PostGenerationOutputSchema` unchanged — `content`, `hashtags`, `scheduledAt`, `rationale` only
  (`post-generation.ts:29–38`). **Unchanged.**
- **R3:** grep of `lib/ai` + `lib/campaigns` for `.tone` as a prompt input returns **0**. The voice block uses
  `descriptor`, not `tone[]`. **R3 satisfied.**
- Raw axis integers never reach the prompt — only the descriptor string. **Satisfied.**
- **R2:** descriptor is grouped into 3 clauses (register / stance+reach / energy+emotion), not a flat 7-item list;
  articles handled (`article()` + capitalised `An`/`A`, lines 64, 98). All-neutral path returns the ADR-locked
  `tone:['balanced']` and `"A balanced, neutral voice with no strong leanings."` (lines 73–75; asserted at
  `translate.test.ts:27`). **R2 satisfied.**

Clean.

---

## §5 Assessment (R4)

- `voiceAxes` added to `BrandVoiceInferredSchema` (7 ints 0–100) **additively**; all existing fields unchanged
  (`brand-voice-inference.ts:5–23`). **Additive.**
- Prompt **body** carries a per-axis scoring rubric for **all 7** axes with low/high anchors and a "default ~50 on no
  signal" instruction (lines 62–71). **R4 satisfied — seeds are signal, not noise.**
- Trial cap unchanged: both assessment entry points (`inferBrandVoiceAction`, `refineFromPostsAction`) call
  `runPrompt(brandVoiceInferencePrompt, …)`, so the cap-3 enforcement keyed on prompt id `brand-voice-inference`
  is shared; **no new counter.** **No cap regression.**
- ≤3 writing examples: onboarding feeds `[]`; refine feeds `MAX_SAMPLE_POSTS = 3`; the DB CHECK on
  `writing_examples` is the binding ceiling. **No path feeds 5.**
- Failure ⇒ neutral: on inference failure `Step2Form` still renders the editor with `NEUTRAL_VOICE_AXES`
  (`Step2Form.tsx:129`); onboarding is never blocked. **L-2 satisfied.**

Clean.

---

## §6 Calibration (L-3/L-4/L-9)

- Delta rule (`calibration.ts:33–47`): `gap = target − current`; `k = clamp(0.15 + 0.30·|gap|/100, 0.15, 0.45)`;
  `next = clamp(round(current + k·gap), 0, 100)`. Divergence-proportional, bounded, `k` never reaches 1 ⇒ no single
  answer fully overrides. **Matches §6.1 / L-3 exactly.**
- Untargeted axes untouched — only `option.target` keys are updated, spread over `current` (line 46). **Satisfied.**
- Static bank of 6 questions, hand-authored vectors. Every option target vector cross-checked against ADR §6.2 —
  **all 24 options match exactly** (Q1–Q6). Coverage: all 7 axes targeted; no question targets >3 axes
  (`targetsAxes` arrays). **L-4/L-9 satisfied.**
- No API call in the module. **Clean.**

Clean.

---

## §7 Refine from connected posts (cut-line, BP9)

- Reuses the **same** assessment call (`brandVoiceInferencePrompt`) — no new prompt; no new counter; quota maps to
  `trial_cap_reached`. **Shares the cap.**
- Gated on `accounts.length === 0` and `postTexts.length === 0`. Severable: nothing in BP1–BP8 imports it.

**⛔ STOPPED (19D-5) — needs ADR decision before proceeding.**
`SocialProvider` interface has no `fetchRecentPosts` method (only OAuth, publish, fetchPostMetrics single-post, fetchEngagement comments/DMs). Per the session STOP CONDITION, the local-posts read was not substituted silently. Decision required: (A) add `fetchRecentPosts` to `SocialProvider` + implement in `PostizProvider`/`MockProvider` (ADR 0002 amendment), or (B) amend ADR 0011 §7 to ratify the local-posts read as deliberate scope reduction. Current `refineFromPostsAction` unchanged pending this decision.

---

## §8 Variations & suggestions

- `suggestVariations` is deterministic; the 5 presets apply the §8.1 offsets verbatim (cross-checked all five:
  Bolder / Buttoned-up / Warmer / Sharper / Thought leader), clamped 0–100, as **absolute** vectors; name-collision
  presets filtered out; nothing persists until the user clicks (`variations.ts:7–58`). **Matches §8.1.**
- Campaign selection: when `voice_variation_id` is set, `buildCustomerContext` swaps in the variation's `voice_axes`
  and **recomputes the descriptor** (`context.ts:90–95`); `null` ⇒ base. Base vs variation therefore produce a
  different `Voice:` line in the assembled prompt. **Differ as required.**

**✅ FIXED (19D-4) — variation mutation actions now call `revalidatePath('/[locale]/settings/voice', 'page')` after each successful add/rename/updateAxes/delete.** 4 tests added to `settings/voice/actions.test.ts`.

Clean (the cross-tenant exposure of this swap is filed as the §3.3 BLOCKER, not here).

---

## §9 Editor (L-6/L-7/L-8/L-13)

- **L-8:** sliders read-only through the question flow — `AxisTrack` renders the `<input type=range>` only when
  `!locked` (`AxisTrack.tsx:30`); `VoiceEditor.handleAxisChange` early-returns while locked; the state machine
  `manuallyAdjustAxes` **throws** if `isLocked` (`editor-state.ts:47`). Unlocks only at the final step. **Satisfied.**
- **L-6:** track shows pole labels only, no numbers (`AxisTrack.tsx:44–48`). **Satisfied.**
- **L-7:** must/cannot word inputs render only in the final step, after the questions, pre-fillable, writing
  `keywords`/`avoid_words` (`VoiceEditor.tsx:155–176`). **Satisfied.**
- One reusable editor mounted in both onboarding step-2 and settings; it consumes `lib/voice/*` (calibration,
  editor-state, translate) and does **not** re-implement delta/translation/variation logic. **No duplication.**

**✅ FIXED (19D-4) — L-13 mobile sticky/collapsible track implemented.**
Right pane is `sticky bottom-0 z-10 bg-background border-t` on mobile; `lg:static lg:border-0` on desktop. Toggle button (`lg:hidden`) with chevron; tracks hidden by default on mobile (`hidden lg:block`), expanded on tap. i18n keys `tracks_toggle_show`/`tracks_toggle_hide` added in EN/PT/ES. I18n contract test suite added (`components/voice/VoiceEditor.test.ts`).

---

## §13 Cutover (R5 — integrity check)

- The old onboarding tone-pills/voice prose form is **gone** — `Step2Form.tsx` now delegates entirely to `<VoiceEditor>`;
  the old `saveStep2Action` is removed (step-2 `actions.ts` exposes only `saveVoiceAxesAction` + `getBrandVoiceAction`).
- Exactly one voice editor component (`components/voice/VoiceEditor.tsx`), two mounts. No second editor in the tree.
- Every `upsertBrandVoice` caller writes `tone` **only** from translation (`payload.tone` via `buildSavePayload`) or from
  assessment output (`result.tone`); the signup path writes an empty row (neutral DEFAULT). **No hand-authored `tone` writer survives.**
- No generation path reads `brand_voices.tone` (re-confirmed from §4 — grep returns 0).
- Sequencing: the new pipeline (BP1–BP7) landed before the BP8 teardown; no voice-less window.

Clean.

---

## Cross-cutting (lenses applied inline — TypeScript / Security / Cost)

**TypeScript**
- Shared `VoiceAxes` type used throughout; no `any` introduced in the voice surface.
- `formatISO` used for timestamp writes in the generation path; `created_at`/`updated_at` are DB-defaulted.
- ✅ **FIXED (19D-3)** — `listVariations` now calls `.limit(VOICE_VARIATION_CAP)` (exported constant = 5 from `lib/validation/voice.ts`). Test added.
- ✅ **FIXED (19D-3)** — `console.error` in `inferBrandVoiceAction` removed. `generate.ts:214` pre-existing, out of scope.

**Security**
- RLS on `brand_voice_variations` is correct and tenant-scoped; UPDATE has `USING` + `WITH CHECK`.
- RPC `SECURITY DEFINER` is hardened (pinned `search_path`, REVOKE public / GRANT service_role).
- **The one real security finding is the §3.3 BLOCKER** — campaign `voice_variation_id` accepts an unvalidated
  cross-tenant UUID, resolved later under service-role.
- Refine path: SSRF posture unchanged (`websiteText: null`; no fetch); reads tenant-scoped local posts via the RLS client.

**Cost**
- Assessment (`brand-voice-inference`, Opus 4.7) is the **only** AI call in the voice surface.
- `translate` / `calibration` / `variations` make **zero** API calls (pure, in-process) — verified by import graph.
- No per-generation translation model call: the descriptor is computed in-process at context assembly.
- Trial cap covers assessment **and** refine via the shared prompt-id counter. **Cost profile matches §11.**

---

## Verification gap (environment, not code)

`node_modules` is absent in this working tree — **`tsc` and `vitest` could not be run**. The determinism/snapshot tests
and the calibration/translation suites are present and well-shaped, but the Builder's "tsc clean / suite green" claims
**could not be independently reproduced this session**. Re-run `npx tsc --noEmit --skipLibCheck` and
`npx vitest run lib/voice lib/db lib/ai lib/validation` after `npm install` before merge.

---

## Findings summary

| # | Tier | Area | Finding | Status |
|---|------|------|---------|--------|
| 1 | **BLOCKER** | §3.3 | Campaign `voice_variation_id` not tenant-validated at write; resolved under service-role → cross-tenant variation use | ✅ Fixed (19D-1) |
| 2 | MAJOR | §3.1 | Base-voice writes skip the shared Zod guard on `voice_axes` (one swallows the error silently) | ✅ Fixed (19D-2) |
| 3 | MAJOR | §7 (BP9) | Refine reads local `posts` table, not the SocialProvider read surface (severable from core) | ⛔ Stopped (19D-5) — needs ADR decision |
| 4 | MINOR | §3.1 | Variation actions duplicate the axis schema locally instead of importing the shared guard | ✅ Fixed (19D-2) |
| 5 | MINOR | §3.4 | `createVoiceVariation` casts `SETOF` array → single row (latent) | ✅ Fixed (19D-3) |
| 6 | MINOR | §8/UI | Variation add/rename/delete actions lack `revalidatePath` — list stale until reload | ✅ Fixed (19D-4) |
| 7 | MINOR | §9 | L-13 mobile: tracks stack questions-first but are not sticky/collapsible | ✅ Fixed (19D-4) |
| 8 | MINOR | x-cut | `console.error` in `inferBrandVoiceAction`; `listVariations` missing explicit `limit` | ✅ Fixed (19D-3) |

The spine is sound: schema + CHECK (D-A), absolute variations, atomic capped RPC (D-B), pure deterministic trio (D-E),
the single descriptor voice block (R1/R2/R3), the R4 rubric, the calibration mechanic (L-3), and the full old-path
teardown (R5) all conform to ADR 0011 Rev B. One tenancy BLOCKER and two MAJORs stand between this and launch.

---

**Verdict: 7/8 findings resolved. Core (BP1–BP8) is merge-ready. BP9 (§7 read path) deferred pending ADR decision on `SocialProvider.fetchRecentPosts` vs ADR 0011 §7 amendment.**
