# Session 24 — Mode 2 Upgrade (ADR 0017) — Independent Reviewer Report

**Scope reviewed:** `git diff 6fcd1ad2^..3f67bcc9` — the eight Session 24 commits B2.0…B2.7
(`6fcd1ad2`, `19f63dbe`, `f50228a9`, `f0512b99`, `2c4c71a3`, `bc3b2d4b`, `07939de5`, `3f67bcc9`).
**Every citation in this report is taken at that commit range** — via `git show <sha>:<path>`,
`git diff 6fcd1ad2^..3f67bcc9`, and `git grep <sha>`. HEAD is `3f67bcc9` (the range head), so on-disk
files equal `git show 3f67bcc9:<path>`; the only working-tree modification is
`docs/build-guide/session-24.md` (the build guide being appended to), which is not a reviewed artefact.
**No file was read at HEAD-beyond-range and no code was modified by this review** (PROC-REVIEW-AT-COMMIT,
CLAUDE.md / ADR 0015 §6).

Specialists invoked (corroboration; every finding below was independently re-derived by the reviewer):
`database-reviewer`, `security-reviewer`, `typescript-reviewer`, `type-design-analyzer`,
`silent-failure-hunter`, `pr-test-analyzer`, `react-reviewer`.

---

## SHARED-FUNCTION CALLERS (CLAUDE.md — root cause of both Session 22 blockers)

### (a) `generatePostsForCampaign` — 1 production caller

| Caller | Test file(s) exercising it after the change |
|---|---|
| `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts:70` (`after(() => …)`) | `lib/campaigns/generate.test.ts`, `lib/campaigns/generate.context-equivalence.test.ts`, `app/[locale]/(dashboard)/context-callers.context-equivalence.test.ts` |

### (b) `buildCustomerContext` — 6 production callers (L-10 equivalence gate)

| Caller | Test file(s) | Covered? |
|---|---|---|
| `campaigns/[id]/generate-action.ts:44` | `context-callers.context-equivalence.test.ts` | ✅ |
| `campaigns/[id]/posts/actions.ts:268` | `posts/actions.test.ts`, `posts/actions.context-equivalence.test.ts` | ✅ |
| `onboarding/infer-brand-voice/actions.ts:27` | `context.test.ts` (contract) only — no dedicated caller test | ⚠️ pre-existing, unchanged by this range |
| `settings/voice/refine-from-posts-action.ts:42` | `refine-from-posts-action.test.ts` | ✅ |
| `lib/campaigns/brief.ts:94` & `:131` (new B2.5 consumer) | `lib/campaigns/brief.test.ts`, `generate.context-equivalence.test.ts` | ✅ |
| `lib/campaigns/generate.ts:165` | `generate.test.ts`, `generate.context-equivalence.test.ts` | ✅ (but the flagship byte-identity test is inert — MINOR-1) |

`lib/ai/context.ts` (the function body) is **byte-identical across the range** (`git diff 6fcd1ad2^..3f67bcc9 -- lib/ai/context.ts` is empty).

### (c) B2.1 atomic transition helpers (`lib/db/campaign-briefs.ts`) — reached on BOTH paths

Helpers: `submitBriefForCritique`, `approveBrief`, `reviseBrief`, `markBriefGenerated` (+ `getBriefByCampaign`, `createBrief`).

| Caller path | Helpers used | Test file(s) |
|---|---|---|
| `lib/campaigns/brief.ts` (imports full set, L8–13) | `submitBriefForCritique`, `approveBrief` (via the gate) | `brief.test.ts`, `campaign-briefs.test.ts` |
| B2.7 `campaigns/[id]/brief/actions.ts` (imports `getBriefByCampaign, reviseBrief`, L8) | `reviseBrief` direct; `approveBrief` **only** via `approveBriefIfQualified` | `brief/actions.test.ts`, `campaign-briefs.test.ts` |
| `lib/campaigns/generate.ts` (L11) | `getBriefByCampaign`, `markBriefGenerated` | `generate.test.ts`, `generate.context-equivalence.test.ts` |

**Key safety property (verified):** the UI approve path cannot bypass the HARD gate because `actions.ts`
never imports the raw atomic `approveBrief`; it calls `approveBriefIfQualified` (brief.ts:168), the sole
gate, which is the only code that reaches `approveBrief`.

---

## Four Realities

**(1) EXECUTION — ❌ BLOCKER-1.** The range is **unpushed** (`git branch -r --contains 3f67bcc9` → none)
and **has zero CI runs** (`gh run list --commit <sha>` = 0 for all eight SHAs). Neither `app-tests` nor
`db-tests` has run this range. Per ADR 0015 §2 ("covered = executed green in CI, never authored"), every
MODE2-\* constraint — Tier-1 and Tier-2 alike — is currently `AUTHORED-NOT-EXECUTED`. **db-tests executed
test count for this range = 0** (the skip-guard has not run); this range therefore contributes **nothing**
to the ADR 0015 three-green promotion tally. This is a procedural merge gate, not a code defect: the local
run is green (see below), but certification requires CI. Fix in BLOCKER-1.

**(2) DOUBLE ENFORCEMENT — ✅ both halves present, both authored at their own tier.**
- *Role write-once:* DB `enforce_post_role_write_once()` + `trg_enforce_post_role_write_once`
  (migration L147–159) **and** app `PostUpdate = Partial<Omit<PostRow, …|'role'>>` (types.ts:320). Tests:
  `mode2-role-origin.test.ts` (Tier-1, live PG) + `types.test.ts` (Tier-2, tsc).
- *Brief freeze:* DB `enforce_campaign_brief_frozen()` + `trg_enforce_campaign_brief_frozen`
  (migration L80–92) **and** app branded `FrozenBrief` + sole producer `freezeBrief` (brief.ts:23–50).
  Tests: `mode2-brief-rls.test.ts` (Tier-1) + `brief.test.ts` (Tier-2).
  Caveat: the TS brand is convention-strength, not nominal (MINOR-5); the DB trigger is the real backstop,
  which is exactly why the ADR chose two layers. Nothing here is single-layer.

**(3) THE GATE AT TWO LAYERS — ✅ single choke point, both paths converge.** `approveBriefIfQualified`
(brief.ts:168) enforces `overallScore < BRIEF_QUALITY_THRESHOLD` **in code before any DB write**
(brief.ts:177–180). The B2.7 `approveBriefAction` does **not** re-implement the gate — it calls the same
function (actions.ts:83) and returns `gate_refused` on `!result.approved` (actions.ts:84–85).
- lib path test: `brief.test.ts:276` — *"AT threshold (exactly 70): allowed — reddens if `>=` flips to
  `>`"*, paired with the 69-refused case → genuine boundary test.
- app path test: `brief/actions.test.ts` — the `gate_refused` branch. Both proven.

**(4) CONTRACT STABILITY — ✅ context.ts byte-identical; one authorized behaviour change; one deviation.**
`lib/ai/context.ts` unchanged (empty diff). `context.test.ts` edited **additively** (mock fixtures gained
the new `origin`/`role` columns; a new compile-time `_CustomerContextShapeUnchanged` shape-lock added) — no
existing assertion loosened. `generate.context-equivalence.test.ts` was rewritten, but for an
**ADR-ratified** reason: Mode 2's native-generation prompt structurally no longer renders
`recentPostPerformance`/`recentCampaigns` (L-10 — memory wires into the BRIEF, not the per-platform
generation path), so byte-identity is now asserted by calling `buildCustomerContext` directly rather than
by grepping a prompt that no longer contains that data. That is a correct update, **not** a loosening — but
the dedicated named byte-identity test is inert (MINOR-1).
> **Deviation (not a defect):** `lib/ai/runner.ts` **was changed** in B2.6 (`07939de5`), though the review
> brief expected it "UNCHANGED". The change is a trial-counter correctness fix (`isPostGeneration` now also
> matches `native-generation-single|-thread`; new `isScoringOnly` skips the rubric call). It is bounded,
> tested (`runner.test.ts:345-353`), and does not add prompt-id/re-prompt logic to the generic runner. B2.4's
> "runner untouched" claim was true at B2.4, not at range end. Accepted as correct (see C4); flagged for
> transparency.

---

## Findings table

| § | Check | Status | File:Line | Note |
|---|---|---|---|---|
| — | CI executed this range | ❌ | — | Unpushed, 0 runs — **BLOCKER-1** |
| A1 | RLS enabled + 4 policies, UPDATE USING+WITH CHECK | ✅ | migration:57–74 | InitPlan form, matches governed-memory convention |
| A2 | business_id cascades from businesses; UNIQUE(campaign_id); partial idx; no redundant idx | ✅ | migration:28,44,49–51 | business_id sourced from campaign (campaign-briefs.ts:36) |
| A3 | ADR 0010 §D2.5 cascade row present | ✅ | 0010-legal-surface.md:1070 | `campaign_briefs \| CASCADE \| … (ADR 0017 §2.5)` |
| A4 | frozen + role triggers, live-PG tested | ✅ | migration:80–92,147–159 | `mode2-brief-rls.test.ts`, `mode2-role-origin.test.ts` |
| A5 | origin 3-value+backfill+DEFAULT dropped; role nullable 6-value | ✅ | migration:106–145 | CampaignInsert.origin required, supplied at new/actions.ts:135 |
| A6 | NOT VALID / VALIDATE low-lock everywhere | ✅ | migration:112–118,136–145,170–179 | status DROP IF EXISTS then re-add (the taken MINOR) |
| A7 | stuck-draft assert proves zero, not assumes | ✅ | migration:190–207 | RAISE EXCEPTION on nonzero |
| B1 | no posts before approved brief | ✅ | generate.ts:93,117–137 | entry guard `awaiting_brief`; atomic `markBriefGenerated` claim |
| B2 | 4 transitions are conditional UPDATEs | ✅ | campaign-briefs.ts:60,77,100,119 | reviseBrief also version-guarded |
| B3 | revise bumps version, frozen_at NULL; approve sets frozen_at via formatISO | ✅ | campaign-briefs.ts | date-fns throughout |
| C1 | one FrozenBrief instance → N calls | ✅ | generate.ts:148,234 | never re-fetched mid-run |
| C2 | CustomerContext shape unchanged; memory not in per-platform path | ✅ | context.ts (empty diff) | generate.ts/generate-native.ts import no lib/memory |
| C3 | no pre-existing test loosened to pass | ✅ | context.test.ts, generate.context-equivalence.test.ts | additive/ADR-ratified; but see MINOR-1 |
| C4 | trial counter not double-counted | ✅ | generate.ts:376; runner.ts:35–43 | rubric = scoring-only; native = batch-once; see MINOR-2 |
| D1 | union discriminates on 'format'; thread 3..8; no ZodType<unknown> | ✅ | schemas.ts:41–44 | concretely typed both branches |
| D2 | policy validator separate, distinguishable AiError code | ✅ | policy.ts:15–32; errors.ts | `policy_violation` ≠ `invalid_response` |
| D3 | re-prompt fires exactly once (2 attempts) | ✅ | generate-native.ts:44–69 | `generate-native.test.ts:111–129` "THE CEILING" |
| D4 | runner.ts has no re-prompt / 3rd branch | ⚠️ | runner.ts (32-line diff) | changed for trial-counter fix only — see Reality 4 deviation |
| D5 | platform→family deterministic; threads own constraints; no `order` field | ✅ | platform-map.ts, schemas.ts | index-derived order |
| E1 | one rubric powers gate + nativeness | ✅ | rubric.ts | no second scorer |
| E2 | BRIEF_QUALITY_THRESHOLD named+imported | ✅ | rubric.ts:4; brief.ts:4; generate.ts:5 | single constant |
| E3 | gate HARD both layers; critique returned | ✅ | brief.ts:178; actions.ts:83 | critique surfaced on page (MINOR-4 on state shape) |
| E4 | hook loop regenerates ≤ once, Tier-2, no Tier-3 | ✅ | generate.ts:250–263 | opener rescored, single regen |
| F1 | wrapEvidenceForPrompt single choke point, every caller | ✅ | brief.ts:90,127; generate-native.ts:95 | all three §12 callers routed |
| F2 | citation-by-id re-fetch, active-only | ✅ | memory-evidence.ts:35–49 | staleness gap closed |
| F3 | neutralize [/DATA]/unicode/fence/brace + truncate | ✅ | wrap-evidence.ts:59–112 | hostile-string tests, not impl-reading |
| H4 | tenant isolation on evidence render | ❌ | memory-evidence.ts:35–49 | no business_id scope — **MAJOR-1** |
| G1 | role-coverage reddens on unfulfilled role | ⚠️ | consistency.ts:23–30 | vacuous on empty set, unreachable via orchestrator — MINOR-6 |
| G2 | link-placement reddens on tweet-1 link | ✅ | consistency.ts:37–52 | `consistency.test.ts:54–63` |
| G3 | evidence/audience/brand memory wired into assembly | ✅ | brief.ts:76–103 | reaches assembly prompt input |
| G4 | cross-set redundancy NOT built | ✅ | consistency.ts:4–9 | correctly deferred behind MODE2-REDUNDANCY-UNDEFER |
| H1 | Server/Client split; no asChild; buttonVariants | ✅ | page.tsx, BriefReviewForm.tsx | correct |
| H1b | stale edit-state on cross-campaign nav (missing key) | ❌ | page.tsx:40; BriefReviewForm.tsx:37–38 | **MAJOR-2** |
| H2 | every action Zod-validates (UUID) before processing | ✅ | actions.ts:52,96–99,146–151 | Server Actions, not POST routes |
| H3 | i18n keys in en+pt+es | ✅ | i18n/{en,pt,es}/common.json (+26 each) | symmetric; 3 unused keys (NIT-1) |
| H4b | brief page/action ownership check | ✅ | page.tsx:30; actions.ts:37–45 | service-role only after ownership check |
| I1 | nothing out of scope shipped | ✅ | (whole diff) | no Studio/Mode3/carousel/image-gen/skip-review |
| I2 | no any/console; config; db-layer; date-fns; bounded queries | ✅ | — | swallowed catches match pre-existing convention (NIT-4) |
| I4 | one step, one commit (B2.0…B2.7) | ✅ | git log | clean mapping |
| J1–J4 | constraints → tests → CI job | ⚠️ | — | authored+globbed+locally-green, but **not yet CI-executed** (BLOCKER-1) |

---

## BLOCKER

### BLOCKER-1 — The range has never executed in CI; no constraint is yet "covered"
**Where:** whole range (unpushed; 0 runs on all 8 SHAs). **Reality 1.**
Per ADR 0015 §2, "covered = executed green in CI." Both `app-tests` and `db-tests` trigger only on
`push:master` / `pull_request` (`.github/workflows/*.yml:5–14`), and this branch has neither. Locally the
app-tier is green (pr-test-analyzer ran the 16 Tier-2 files: **209 tests pass**), and the Tier-1 suites are
correctly globbed by `db-tests` (`supabase/__tests__/**`), but **db-tests executed-test-count for this
range = 0**, so nothing is certified and the range adds nothing to the three-green promotion tally.
**Fix (one step):** push the branch / open the PR; confirm `app-tests` is green (tsc + eslint + vitest +
skip-guard) **and** `db-tests` is green with a **non-zero** executed count (skip-guard passing on
`mode2-brief-rls` + `mode2-role-origin`); record both run IDs and the db-tests executed count in
`docs/current-phase.md`. Until then every MODE2-\* constraint is `AUTHORED-NOT-EXECUTED`.

---

## MAJOR

### MAJOR-1 — `getEvidenceMemoryByIds` renders evidence with no tenant scope (citation-by-id boundary not enforced)
**Where:** `lib/db/memory-evidence.ts:35–49`; enabling gaps at `lib/ai/prompts/brief.ts:22–25` and
`lib/campaigns/brief.ts:87–108`.
`getEvidenceMemoryByIds` filters `.in('id', ids).eq('status','active').is('deleted_at', null)` with **no
`business_id` filter**, and is called with a **service-role client** (RLS bypassed) on the generation and
critique paths (`wrap-evidence.ts:128–135` → `brief.ts:127`, `generate-native.ts:95`). Its own sibling
`listEvidenceMemoryCandidates` scopes by `business_id` and comments (memory-evidence.ts:7–9) that
service-role reads on the generation path **must** filter business_id explicitly because RLS is bypassed —
`getEvidenceMemoryByIds` contradicts that rule. The code comment (wrap-evidence.ts:124–127) asserts "the
pinned id set itself is the trust boundary," but that boundary is not enforced: `PINNED_EVIDENCE_SCHEMA`
validates only `evidenceMemoryId: z.string().min(1)` with no membership check against the candidate set the
model was shown, and `createBrief` persists whatever the model returned, unchecked. Any UUID frozen into a
brief is then rendered with only a `status='active'` filter, across tenants.

**Severity judgement (re-derived):** the `security-reviewer` rated this a **BLOCKER**. I rate it **MAJOR**,
and I want the disagreement on the record. Practical cross-tenant *leakage* requires a real foreign
evidence UUID: ids are `gen_random_uuid()` (122-bit, unguessable), and the assembly model only ever sees
its own business's candidate ids (`brief.ts:87`, from `retrieveEvidenceMemory(client, business_id, …)`), so
under normal operation and even under evidence-content injection the model has no foreign id to emit. That
makes real exploitation implausible — hence not BLOCKER. But it is a genuine defect: it violates the
codebase's explicit "service-role queries scope by business_id" invariant, contradicts the sibling
function's own comment, and the "citation-by-id boundary" the ADR leans on is asserted, not enforced.
**Reasonable reviewers could hold this at BLOCKER given SOSH's zero-tolerance tenancy posture; either way
it must be fixed before merge.**
**Fix:** add a `businessId` parameter to `getEvidenceMemoryByIds` and filter `.eq('business_id', businessId)`
(mirroring `listEvidenceMemoryCandidates`); thread the campaign's `business_id` through `wrapEvidenceForPrompt`
and its three callers. Optionally also reject, in `assembleBrief`/`CampaignBriefContentSchema`, any
`pinnedEvidence` id not in the candidate set shown to the model — closing the gap at the point untrusted
model output is first accepted. Add a cross-tenant test (a foreign id must render nothing) to
`memory-evidence.test.ts` / `wrap-evidence.test.ts`.

### MAJOR-2 — Brief review form seeds edit state from props without `key`; cross-campaign navigation can silently overwrite a brief with stale text
**Where:** `app/[locale]/(dashboard)/campaigns/[id]/brief/page.tsx:40`;
`BriefReviewForm.tsx:37–38`.
`<BriefReviewForm campaignId={id} brief={brief} />` is rendered with no `key`, and the edit textareas are
seeded via `useState(brief.content.narrative)` / `useState(brief.content.proofPlan)` — mount-only. On a
client-side navigation between two campaigns' `/brief` pages (same route segment `[id]/brief`, different
id), React reuses the component instance: the read-only display re-renders from props (shows the new
brief), but the edit textareas keep the **previous** campaign's narrative/proofPlan while the hidden
`campaignId` input now points at the **new** campaign. Submitting "edit" (`editBriefAction`) would persist
the old campaign's text onto the new campaign's brief — silent cross-campaign data corruption.
**Fix:** pass `key={id}` (or `key={brief.id}`) on `BriefReviewForm` in `page.tsx` so the component remounts
and re-seeds local edit state when the campaign changes.

---

## MINOR

### MINOR-1 — Inert flagship equivalence test (MODE2-CONTEXT-EQUIVALENT)
`lib/campaigns/generate.context-equivalence.test.ts:274–279` — the test named *"calls buildCustomerContext
with the exact same args as before B2.6"* has **zero `expect()` calls**; it invokes
`generatePostsForCampaign` and returns. It would pass on an args regression. The equivalence property is
still covered by the sibling variation-descriptor test (:281) and the direct `buildCustomerContext(...)`
cap-at-3 test (:308), so the constraint is not uncovered overall — but its dedicated named proof is
vacuous. **Fix:** assert the actual call, e.g. spy `buildCustomerContext`'s args = `(BUSINESS_ID, VARIATION_ID)`.

### MINOR-2 — C4 double-count scenario not asserted end-to-end
`generate.test.ts` proves 7 native calls occur when one post regenerates (:357–376) and separately asserts
`incrementPostsGeneratedBy(BUSINESS_ID, 6)` only in the **no-regeneration** path (:455–458), where
native-call count and post count coincide (6 = 6). No test ties the regeneration scenario to the correct
increment value (6, not 7). The code is correct (`generate.ts:376` uses `inserted.length`), but the exact
double-count the ADR worries about is not directly caught. **Fix:** in the regeneration test, add
`expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6)`.

### MINOR-3 — Contradictory comments on the trial-counter fix (doc-rot)
`lib/ai/generate-native.ts:82–88` still says the double-count "will" happen and is "Flagged for B2.6 to
resolve; not addressed here," but B2.6 (this range) resolved it in `lib/ai/runner.ts:13–21`. The two
comments now contradict. **Fix:** update the generate-native.ts comment to point at the runner.ts fix so a
future session doesn't reintroduce the bug believing it's open.

### MINOR-4 — `gate_refused` action state drops the critique field
`approveBriefIfQualified` returns `critique` on refusal (brief.ts:179), but `ApproveBriefState.gate_refused`
carries only `overallScore` (actions.ts:64,85). It is not user-visible loss today because
`BriefReviewForm.tsx:82–95` renders `brief.critique` unconditionally in the `critiqued` state; but the drop
means no test can assert critique survives a refusal, and if that render block ever regresses this becomes a
real swallow. **Fix:** thread `critique` through the `gate_refused` variant (or add a test asserting the
unconditional render).

### MINOR-5 — `FrozenBrief` brand is convention-strength, and its `content` type is shallower than the runtime freeze
`lib/campaigns/brief.ts:23–29,43–49`. `_brand: 'FrozenBrief'` is a string-literal tag (like the existing
`VaultSecretId`/`RenderedEvidence` pattern), so a single-step `as FrozenBrief` from any close-enough shape
is legal — the "cannot construct without `freezeBrief`" comment overstates what TS enforces (the DB
`frozen_at` trigger is the real backstop, by ADR design). *Mitigant confirmed:* `git grep` (typescript-reviewer)
shows `freezeBrief` (brief.ts:49) is the **only** `FrozenBrief`-producing site tree-wide and `generate.ts:148`
the only consumer, so the "sole producer" claim holds today. Separately, `content: Readonly<CampaignBriefContent>`
is shallow: `pinnedEvidence`/`roleSequence` stay typed-mutable, so TS permits `.push()` that the runtime
`Object.freeze` (deepFreezeContent) actually throws on — the type under-states the (stronger) runtime
guarantee. Neither ships bad data (runtime is stricter than the type; the DB trigger guards persistence),
which is why this is MINOR not MAJOR. **Fix (optional):** type the field with `ReadonlyArray<Readonly<…>>`
(or a `DeepReadonly` mapped type) and soften the "cannot" wording to match reality.

### MINOR-6 — `checkRoleCoverage` passes vacuously on an empty set (unreachable, but a latent trap)
`lib/campaigns/consistency.ts:23–30` returns `ok:true` for empty `expected`. In the current orchestrator
this is unreachable — `generate.ts:150–159` fails with `invalid_campaign_state` before the check when
`roleSequence.length === 0`, and generated items are assigned deterministically so a per-post failure
short-circuits earlier (generate.ts:235–243). So only the pure-function unit test exercises the reddening
branch; no integration test drives `generated.length < roleSequence.length` through the real orchestrator.
A future "continue on per-post error" refactor would silently lose this safety net. **Fix (defensive):** add
an orchestrator-level test that injects a missing order and asserts `consistency_check_failed`.

### MINOR-7 — Hook opener-rescoring uses the weaker local guard
`lib/campaigns/generate.ts:253–258` passes `extractOpener(output)` into `rubricPrompt` relying on
`rubric.ts`'s local `sanitizeDataField` (literal `[/DATA]` only), not the exported `neutralize()` (NFKC +
Cf-strip + fence/brace) that B2.5's own comment (wrap-evidence.ts:73–82) says all reused AI-generated text
should get. The opener descends from already-neutralized evidence, so exploitation is unlikely, but the
guard strength is inconsistent with the stated posture. **Fix:** wrap the opener with `neutralize()` before
scoring.

### MINOR-8 — Superfluous cast masks future schema/DB drift
`lib/campaigns/brief.ts:105` — `content as CampaignBriefContent` is unnecessary: `content` is already typed
`CampaignBriefContentOutput`, structurally identical to `CampaignBriefContent`, so TS accepts the assignment
without the cast. The bare `as` would silently paper over a future divergence between
`CampaignBriefContentSchema` (zod) and the DB type rather than surfacing a compile error. **Fix:** remove the
cast so drift is caught at compile time.

---

## NIT

- **NIT-1** — Unused i18n keys `approved_success` / `rejected_success` / `saved_success`
  (`i18n/en/common.json` and mirrors): defined but never rendered (the form only `router.refresh()`es).
  Present in all three locales, so no parity break — remove or wire a success toast.
- **NIT-2** — `getCritiqueLines(brief.critique)` is called twice per render (`BriefReviewForm.tsx:87,89`);
  hoist to a single `const`.
- **NIT-3** — `CampaignPostRole = PostRole` (`types.ts:690`) is a bare alias; harmless and well-commented,
  but arguably unnecessary indirection.
- **NIT-4** — The three brief Server Actions `catch { return { status: 'error', error: 'generic' } }`
  (actions.ts:89–91,139–141,195–197) with no logging — an unexpected throw is invisible in production. This
  matches the pre-existing `generate-action.ts` convention (repo has no logger yet per CLAUDE.md), so it is
  not a regression; track for when the logger lands. `key={i}` on the critique `<ul>`
  (BriefReviewForm.tsx:90) is low-risk (immutable server-derived list, never reordered) but the same class.

---

## Constraint coverage (ADR §13 — eighteen MODE2-\*)

| Constraint | Test | CI job | Tier | Reddens if broken? |
|---|---|---|---|---|
| MODE2-BRIEF-RLS-ISOLATED | mode2-brief-rls.test.ts | db-tests | 1 | ✅ authored — **not yet CI-executed (BLOCKER-1)** |
| MODE2-BRIEF-CASCADE-COMPLETE | mode2-brief-rls.test.ts + 0010 §D2.5 row | db-tests | 1 | ✅ (same caveat) |
| MODE2-BRIEF-FROZEN-GUARD | mode2-brief-rls.test.ts:237 | db-tests | 1 | ✅ (same caveat) |
| MODE2-ROLE-WRITE-ONCE | mode2-role-origin.test.ts:163 | db-tests | 1 | ✅ (same caveat) |
| MODE2-ORIGIN-ROLE-BACKFILL | mode2-role-origin.test.ts:83 | db-tests | 1 | ✅ (same caveat) |
| MODE2-ACTIVATE-GUARD-MIGRATED | migration DO-block (diff-verified) + generate.ts:93 | db-tests / Tier-3 | 1/3 | ✅ migration fails loudly on nonzero |
| MODE2-BRIEF-STATE-ATOMIC | campaign-briefs.test.ts | app-tests | 2 | ✅ (local green) |
| MODE2-BRIEF-BEFORE-COPY | brief.test.ts, prompts/brief.test.ts | app-tests | 2 | ✅ |
| MODE2-MEMORY-WIRED | brief.test.ts | app-tests | 2 | ✅ |
| MODE2-CRITIQUE-GATE | brief.test.ts:276 (>= boundary) | app-tests | 2 | ✅ |
| MODE2-CRITIQUE-GATE-APP-LAYER | brief/actions.test.ts | app-tests | 2 | ✅ |
| MODE2-BRIEF-REVIEW-SURFACE | brief/actions.test.ts | app-tests | 2 | ✅ |
| MODE2-RUBRIC-SHARED | rubric.test.ts | app-tests | 2 | ✅ |
| MODE2-EVIDENCE-DATA-GUARDED | wrap-evidence.test.ts | app-tests | 2 | ✅ (isolation gap is MAJOR-1, separate axis) |
| MODE2-FORMAT-FAMILY-STRUCTURAL | formats/*.test.ts | app-tests | 2 | ✅ |
| MODE2-THREAD-GUARDRAILS | schemas.test.ts, policy.test.ts | app-tests | 2 | ✅ |
| MODE2-NATIVE-RETRY | generate-native.test.ts:111 | app-tests | 2 | ✅ "THE CEILING" |
| MODE2-BRIEF-FROZEN | generate.test.ts | app-tests | 2 | ✅ |
| MODE2-HOOK-STANDALONE | generate.test.ts | app-tests | 2 | ✅ |
| MODE2-ROLE-COVERAGE | consistency.test.ts | app-tests | 2 | ✅ (MINOR-6 caveat) |
| MODE2-LINK-PLACEMENT | consistency.test.ts:54 | app-tests | 2 | ✅ |
| MODE2-CONTEXT-EQUIVALENT | generate.context-equivalence.test.ts, context-callers…, context.test.ts | app-tests | 2 | ⚠️ covered, but flagship named test inert (MINOR-1) |

Types-only constraints on `campaign_briefs`/`PostUpdate` live in `lib/db/types.test.ts`, which is
**excluded from vitest by design** and verified by the `npm run typecheck` step of `app-tests` (tsc). This
is legitimate Tier-2-by-tsc, not a vitest gap — but it should be named as tsc-verified in the ADR constraint
table rather than implied as vitest coverage.

---

## VERDICT

**Blockers before merge:**
1. **BLOCKER-1 — execute the range in CI.** Push / open the PR; `app-tests` green and `db-tests` green with
   a **non-zero** executed count (skip-guard passing). Until then, "covered" cannot be claimed for any
   constraint. This is the cardinal ADR 0015 gate and it is currently unmet.
2. **MAJOR-1 — tenant-scope `getEvidenceMemoryByIds`.** I tier it MAJOR (unguessable-UUID precondition makes
   real leakage implausible), but it violates SOSH's "service-role queries scope by business_id" invariant
   and the sibling function's own contract; the security-reviewer rated it BLOCKER. Fix before merge either
   way — the change is one parameter and one `.eq`.
3. **MAJOR-2 — add `key` to `BriefReviewForm`.** Silent cross-campaign brief overwrite on client-side
   navigation; one-line fix.

**Deferrable debt (not merge-gating):** MINOR-1..8 (inert flagship equivalence test; C4 end-to-end
assertion; contradictory trial-counter comments; `gate_refused` critique field; FrozenBrief brand/readonly
precision; role-coverage empty-set trap; hook opener guard strength; superfluous cast) and NIT-1..4.
Recommend clearing MINOR-1, MINOR-2 and MINOR-3 in the same correction pass since they are cheap and touch
the test/doc integrity this track is judged on.

**The three questions this track exists to settle:**
1. **Is the brief genuinely generated BEFORE any copy, and human-gated?** — **Yes.** `generatePostsForCampaign`
   refuses unless `campaign.status === 'awaiting_brief'` AND a brief with `status === 'approved'` exists, and
   claims it atomically (`markBriefGenerated`) before freezing (generate.ts:93,117–148). Approval is a HARD
   `overall >= BRIEF_QUALITY_THRESHOLD` gate reachable only through `approveBriefIfQualified`, from both the
   library and the B2.7 Server Action. No route from objective → posts bypasses `brief.ts`.
2. **Is nativeness genuinely STRUCTURAL, not prompted-for?** — **Yes.** The platform→format-family map is a
   deterministic Tier-0 lookup (`platform-map.ts`), outputs are a zod discriminated union on `'format'`
   with thread length bounded 3..8 and no model-supplied `order`, and cross-element thread rules are a
   separate Tier-0 policy validator throwing a distinguishable `policy_violation` that drives a bounded
   (exactly-once) re-prompt. Structure is enforced by parse + policy, not by asking the model nicely.
3. **Is brief-pinned evidence genuinely DATA at every render?** — **Yes for the injection axis**, with a
   **tenancy caveat.** `wrapEvidenceForPrompt` is the single render-time choke point at all three §12
   callers; it NFKC-normalizes, strips Unicode Cf, neutralizes `[/DATA]`/fences/leading braces, hard-caps
   with truncation, and re-fetches active-only rows by id — all proven by hostile-string tests. The gap
   (MAJOR-1) is orthogonal: the evidence is DATA, but the by-id fetch is not tenant-scoped.

**Bottom line:** the architecture is sound and the eighteen constraints are authored with genuine,
would-redden tests — but **nothing is certified until BLOCKER-1 runs green in CI**, and MAJOR-1/MAJOR-2
should be fixed in the correction pass before merge.

*(Reviewer note: this report is append-only and immutable per CLAUDE.md "REVIEWER-REPORT APPEND-ONLY";
a correction pass records resolutions in a `## CORRECTION PASS (Session 24-D)` section appended below,
never by editing the findings above.)*

---

## CORRECTION PASS (Session 24-D)

**Author:** Session 24-D (Claude Code, Sonnet 5). **Started:** 2026-07-24. Fixes recorded here resolve
findings in the report above; nothing above this section is edited — see CLAUDE.md
REVIEWER-REPORT APPEND-ONLY. Each row cites: finding → fix → the test that now proves it → commit SHA.

| Finding | Fix | Test | SHA |
|---|---|---|---|
| **MAJOR-2** — stale edit-state on cross-campaign navigation (missing `key`), page.tsx:40; BriefReviewForm.tsx:37–38 | Added `key={brief.id}` to `<BriefReviewForm>` in `app/[locale]/(dashboard)/campaigns/[id]/brief/page.tsx`. `brief.id` changing forces React to unmount/remount the client component, re-running the `useState(brief.content.narrative)` / `useState(brief.content.proofPlan)` initializers with fresh values — the idiomatic "reset state via key" pattern, not a `useEffect`-sync (which would cause a visible render-then-reset flash). `ecc:react-reviewer` confirmed this is the correct fix, traced `reviseBrief`/`critiqueBrief` and found no edge case where a within-mount reject/edit/re-critique cycle changes `brief.id` while leaving stale local state inconsistent with the row (same-row `UPDATE`, not a new row), and confirmed no other issues in the two files. | New `app/[locale]/(dashboard)/campaigns/[id]/brief/page.test.tsx` (2 tests): asserts the un-rendered `<BriefReviewForm>` element carries `key === brief.id` and `props.campaignId`/`props.brief` match the fetched values, and that the key changes across two calls with different `brief.id`s (the revise/new-brief-row scenario). Follows the existing `app/[locale]/(dashboard)/approvals/page.test.tsx` precedent for reading props off a Server Component's un-rendered element tree (no RTL/jsdom in this repo — `vitest.config.ts` runs `environment: 'node'`). `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/ lib/ components/` — 2115/2115 passed (153 files), including the 2 new tests. | `a07c3ef3` |
| **MAJOR-1** — `getEvidenceMemoryByIds` renders evidence with no tenant scope (citation-by-id boundary asserted, not enforced); MAJOR/BLOCKER severity split (Reviewer: MAJOR, `security-reviewer`: BLOCKER) is now moot — fixed to the stricter standard, without editing either original verdict | Two-part fix, both halves the finding's own "Fix" line called for. **(a) Enforce the boundary:** `getEvidenceMemoryByIds` (`lib/db/memory-evidence.ts`) now takes a required `businessId` param and filters `.eq('business_id', businessId)`, mirroring `listEvidenceMemoryCandidates`; `wrapEvidenceForPrompt` (`lib/ai/wrap-evidence.ts`) threads it through to all three §12 callers — `brief.ts:90` (assembleBrief, `campaign.business_id`), `brief.ts:127→140` (critiqueBrief, `brief.business_id`), `generate-native.ts:95→96` (via a new `businessId` field on `GenerateNativeContentInput`, sourced from `generate.ts`'s function-scoped `businessId` through its `genInput()` closure). **(b) Close the acceptance gap ("optionally" in the original finding, done anyway):** `assembleBrief` now filters the model's returned `pinnedEvidence` to only ids present in `evidenceCandidates` (the ids actually shown to the model) before `createBrief` persists it — an out-of-set id is rejected at the point untrusted model output is first accepted, not just at render time. `security-reviewer` (re-run) confirmed: `brief.business_id` cannot diverge from the owning campaign's `business_id` (`createBrief` derives it server-side from `getCampaignById`, never caller-supplied, and no update path in `campaign-briefs.ts` ever mutates it — traced via `CampaignBriefUpdate`'s field `Omit` in `lib/db/types.ts`); no other service-role `evidence_memory` reader was missed (grepped the tree — `listEvidenceMemoryCandidates` was already scoped, `getEvidenceMemoryByIds` is now the only other reader and is fixed); `businessId` is never attacker-influenceable in this chain (always DB-derived, and `generatePostsForCampaign` additionally cross-checks its `businessId` param against `campaign.business_id` and throws on mismatch); one non-blocking note — the acceptance-gap filter drops silently with no logging, flagged as a future signal worth keeping once the project's logger infra exists (CLAUDE.md: "we'll add this later"), not actioned now. `database-reviewer` confirmed: filter-order in the query chain doesn't affect the generated SQL or plan (Postgres AND-collapses WHERE predicates regardless of `.eq`/`.in` call order); no index covers `(business_id, id)` but none is needed at this cardinality (a handful of pinned ids per brief, PK index on `id` suffices); the empty-`ids` early-return in both functions is intact and unaffected; the per-row `Promise.all` N+1 pattern in `assembleBrief`'s `evidenceCandidates` build is pre-existing (this fix only appends `businessId` to an already-existing one-row-at-a-time call), not worsened — flagged as a possible future NIT (batch into one `getEvidenceMemoryByIds(client, businessId, allIds)` call), out of this fix's scope. | `lib/db/memory-evidence.test.ts`: new dedicated tenancy test (`scopes the read to business_id`) mirroring `listEvidenceMemoryCandidates`'s own pinned tenancy test, plus a foreign-id-renders-nothing test; manually verified to REDDEN when `.eq('business_id', businessId)` is removed from the implementation (reverted after confirming). `lib/ai/wrap-evidence.test.ts`: matching dedicated tenancy test plus a foreign-id-renders-nothing test, proving the param threads all the way through the shared choke point. `lib/ai/generate-native.test.ts`: new test asserting `businessId` reaches `wrapEvidenceForPrompt` unchanged from `GenerateNativeContentInput`. `lib/campaigns/brief.test.ts`: updated the two existing `wrapEvidenceForPrompt` call assertions to include `businessId`; new test asserting a pinnedEvidence id outside the candidate set is stripped before `createBrief` is called (the acceptance-gap close). `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/ lib/ components/` — 2121/2121 passed (153 files). | `fc3bb063` |
| **MINOR-1** — flagship `MODE2-CONTEXT-EQUIVALENT` test ("calls buildCustomerContext with the exact same args as before B2.6", `generate.context-equivalence.test.ts:274–279`) has ZERO `expect()` calls | `vi.spyOn(contextModule, 'buildCustomerContext')` — calls through to the REAL implementation (this file deliberately keeps it unmocked, per the file's own header note), only records invocations — then asserts `expect(spy).toHaveBeenCalledWith(BUSINESS_ID, VARIATION_ID)` and `toHaveBeenCalledTimes(1)`, pinning the pre-B2.6 call shape the test's own name promises. | Same test, now with real assertions. Manually verified to REDDEN: mutated `generate.ts:165`'s call to `buildCustomerContext(businessId, null)`, confirmed the args assertion failed, reverted (`git diff --stat` empty afterward). `pr-test-analyzer` independently re-ran the same mutation and confirmed reddening, and confirmed no other reachable call site inside `generatePostsForCampaign`'s path calls `buildCustomerContext` (the two `brief.ts` call sites are unreached because `getBriefByCampaign` is mocked to return an already-approved brief). `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/ lib/ components/` — 2122/2122 passed. | `98480c0c` |
| **MINOR-2** — regeneration scenario (`generate.test.ts`, hook Tier-2 loop, 7 native calls) never pinned the trial-counter increment against a double-count risk (increment-by-native-call-count vs. increment-by-posts-created) | Added `expect(incrementPostsGeneratedBy).toHaveBeenCalledWith(BUSINESS_ID, 6)` to the existing "regenerates EXACTLY ONCE..." test, right after its existing `toHaveBeenCalledTimes(7)` assertion on `generateNativeContent` — pinning that the increment tracks `postsCreated` (`= inserted.length`, `generate.ts:355/377`, 6 — one row per roleSequence entry) and NOT the native-call count (7, which would double-count the one regenerated post). | Same test, extended. Manually verified to REDDEN: hardcoded `generate.ts:377`'s increment call to a literal `7`, confirmed both the new assertion AND a pre-existing, unrelated "increments trial counter by postsCreated" test in the success-path describe block both failed, reverted (`git diff --stat` empty afterward). `pr-test-analyzer` independently re-ran the same mutation and confirmed reddening. `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/ lib/ components/` — 2122/2122 passed. | `98480c0c` |
| **MINOR-6** — `checkRoleCoverage` (`lib/campaigns/consistency.ts`) passes vacuously (`ok: true`) on an empty `expected` array; no test proved the check catches a REAL coverage gap through the actual orchestrator, only that the pure function is logically self-consistent in isolation | Per the correction-pass instruction's explicit constraint: checked `generate.ts:150–159` first — it already returns early with `error_code: 'invalid_campaign_state'` on `frozenBrief.content.roleSequence.length === 0`, BEFORE the generation loop or `checkRoleCoverage` is ever reached, so the empty-`expected`-vacuous-pass shape is unreachable from the real orchestrator today. Per instruction, the pure function was left UNCHANGED (defense-in-depth, not dead weight) and a new **orchestrator-level** test was added instead, pinning the check's actually-reachable failure mode: a `roleSequence` entry citing a platform outside `CANONICAL_PLATFORM_ORDER` (`'pinterest' as never`) is silently never iterated by the STEP 7 generation loop (`activePlatforms` is built by filtering `CANONICAL_PLATFORM_ORDER` against `roleSequence`), producing a `generated` array one entry short — `checkRoleCoverage` catches it and the run aborts with `consistency_check_failed`, `createPosts` never called. | New test in `generate.test.ts`'s "consistency pass wiring (ADR §8)" describe block. Manually verified to REDDEN: short-circuited `generate.ts:302`'s gate with `if (false && (!roleCoverage.ok \|\| !linkPlacement.ok))`, confirmed both the new test AND the pre-existing tweet-1-link-violation test in the same block failed (`createPosts` got called when it shouldn't), reverted (`git diff --stat` empty afterward). `pr-test-analyzer` independently re-ran the same mutation, confirmed reddening, and separately confirmed the `'pinterest'` scenario is genuinely unreachable through the validated LLM-output path (`ROLE_SEQUENCE_ENTRY_SCHEMA`'s zod enum in `lib/ai/prompts/brief.ts` and `lib/db/types.ts`'s `Platform` union both cover only the 5 canonical platforms) — reachable only via raw-SQL/migration-drift JSONB corruption (no DB CHECK constraint enforces the enum), which the test's own comment already frames honestly as a "future refactor safety net," not a normal-operation case. **Dissent recorded, not actioned:** `silent-failure-hunter` separately argued `checkRoleCoverage` should be hardened to return `ok: false` (or throw) on empty `expected` regardless of any single caller's behavior, since the function's own doc comment claims caller-independence ("independently testable... regardless of whether generate.ts's own control flow can currently produce that state") and a future second call site without generate.ts's upstream guard would silently inherit the vacuous pass. This is a legitimate future-proofing argument, but the correction-pass instruction explicitly pre-empted it: "if [the upstream guard] does [fail first], note the empty-set branch is defence-in-depth and leave it, but pin the reachable failure" — which is what was done. Left for a future session to weigh, not silently dropped. `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/ lib/ components/` — 2122/2122 passed. | `98480c0c` |
