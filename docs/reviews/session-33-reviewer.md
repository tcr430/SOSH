# Session 33 · Track J — Reviewer report (J3)

**Scope reviewed: `75cae307..879737c7`; all citations are `git show <sha>:<path>` at that range, never HEAD.**

Documents audited *against*, named at their own commits (Session 22-F, NEW-12):

- **ADR 0026** §§0–16 read at **`75cae307`** — the docs-only commit that put it into git, so the Section 2
  precondition holds: `docs/decisions/0026-outcome-loop.md` and `docs/build-guide/session-33.md` both entered
  git at `75cae307`, before any Builder commit. ADR 0026's **§V appendix** (constraint→CI map, Tier-3
  re-verification, Tier E, deviations) is itself an artefact *inside* the range and is read at **`879737c7`**.
- **`docs/build-guide/session-33.md`** read at **`75cae307`** (unchanged in the range; last touched at
  `0c79d118`, before BASE).
- ADR 0015 §2 / Amendment B, ADR 0018, ADR 0010 Amendment 2 §D2.5 and CLAUDE.md read at `879737c7`.

The working tree at review time equals `879737c7` (`git diff HEAD --stat` shows only `supabase/.temp/cli-latest`),
so the local test runs below are runs at the audited head.

---

## 0. What I ran, and what it showed

| Check | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | 0 errors, 110 warnings (all pre-existing `no-unused-vars` / unused-disable) |
| `npm run test:app` (with the `app-tests.yml` env block) | 307 files, 4322 tests; 1 failure — `lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts`, which **passes in isolation**, is unchanged since `0c79d118` (before BASE), is disclosed in the J2.12 and J2.13 commit bodies as a known pre-existing order-dependent flake, and is **green in CI at head**. Not attributed to this range. |
| `npm run test:db` against a live local Postgres at head | **184 suites / 674 tests, 0 failed, 0 empty**; 17 outcome-related files, 222 tests |
| `npx tsx scripts/check-adr0018-unchanged.ts` | `OK — lib/learning/ and 8 ADR 0018 migrations are identical to 75cae307`, exit 0 |
| Raw `git diff 75cae307..879737c7 -- lib/learning/ <the 8 ADR 0018 migrations>` | **empty** — not one line, not an added `export` |
| Reddening that guard (an older base where `lib/learning` differs) | exit 1, names `lib/learning/classify.test.ts`; a missing base exits 2, never 0 |
| Tier-3 suites re-run by me (6, 7, 16, 28, 29, 30, 31, 34) | 7 files / 102 tests, all green |
| Copy lint reddened in **en, pt and es** against the real locale files | 0 real violations per locale; a planted `2× more` plus a locale-specific causal verb is caught in each of the three |
| **Mutation of each promotion gate** (live DB, RPC body swapped, suite re-run, restored) | see §4 — every gate independently load-bearing |
| **Mutation of each demotion gate** | see §5 — every gate independently load-bearing |
| `pg_constraint` at head | exactly **one** `source` CHECK and **one** `dimension` CHECK; no stale narrow CHECK survived |
| CI runs at head `879737c7` (`pull_request` event) | app-tests `35509193435` ✅, db-tests `35509193408` ✅, eval `35509193581` ✅ |

**db-tests skip-guard line, verbatim from the log of run `35509193408` at `879737c7`:**

```
skip-guard: 79 file(s) under [supabase/__tests__] all visible, zero failures — green. (674/674 tests passed)
```

**app-tests skip-guard line, verbatim from run `35509193435` at `879737c7`:**

```
skip-guard: 304 file(s) under [app, lib, components] all visible, zero failures — green. (4322/4322 tests passed)
```

db-tests is **green**, so there is no regression-versus-stack-failure question to adjudicate. `SIGSEGV`,
`signal 11`, `OOMKilled=true` and `out of memory` appear **zero** times in the db-tests log. Both runs are
`pull_request` events and therefore **do not move the db-tests promotion tally** (ADR 0015 §5; the tally is
`master`-gated).

`879737c7` is **docs-only** relative to `eebe96da` (`docs/decisions/0026-outcome-loop.md`, +55/−36), so ADR
0026 §V.6's decision to cite the `eebe96da` runs is conservative and true; the head's own runs are green too.

---

## 1. The metrics input and cadence (ADR §3; ruling A-3; ADR 0028 Amendment A)

**Verified.** ADR 0028 Amendment A (appended at `c787e633`) carries a seven-row verification log with a vendor
URL and an exact finding **per field read**, an explicit "no live call was made", and an A.5 "Not verified /
not run" section recording that the **live X smoke has NOT YET RUN** — which is correct, not a defect. The
unresolved `retweet_count` vs `repost_count` conflict (A.2 #4; `api.x.com/2/openapi.json` returned HTTP 402) is
handled with an accepting alias and flagged for deletion at the first smoke.
`git diff 75cae307..879737c7 -- lib/social/platforms/` is **empty**: **no scope was added.**

`TwitterProvider.fetchPostMetrics` (`lib/social/twitter-provider.ts:433-480`) reads one endpoint, maps each
verified field with `?? null`, and hard-codes `clicks: null` and `reach: null`. **No `?? 0` anywhere.**
`LinkedInProvider.fetchPostMetrics` still throws `NOT_IMPLEMENTED` with a cited reason (`r_member_social_feed`
is "granted to select developers only") and a `details.reason` — **compliant** per the primer: no scope was
added and no LinkedIn impression, reach, save or click is read.

Cadence: `supabase/migrations/20260919100000_metrics_sync_cadence.sql` replaces the body in place (same
signature; `p_stale_before` deliberately ignored), the predicate is exactly ADR §3.2's three stages with
`last_synced_at IS NULL` counting as before every stage, and `METRICS_MAX_AGE_DAYS` defaults to **9** via
`lib/config.ts:66` — never `process.env` directly. `supabase/__tests__/metrics-sync-cadence.test.ts` (10 tests,
Tier 1) covers day 1/3/7 **and the gaps between them**, and proves a far-future `p_stale_before` no longer
re-selects a post.

Findings rooted here: **MAJOR-2**, **MINOR-7**.

---

## 2. The dimension taxonomy (ADR §4; L-4, A-6)

**Verified.** `post_dimensions` is keyed on `ai_original_id` and written by an `AFTER INSERT` trigger on
`post_ai_originals` (`20260919110000_outcome_tables.sql`), `SECURITY DEFINER` with a pinned `search_path`,
every enum sanitised through a `CASE … IN (…)` so an out-of-vocabulary value becomes NULL rather than aborting
generation, `ON CONFLICT (ai_original_id) DO NOTHING`, and **no `EXCEPTION` block** — exactly ADR §4.2.
`20260919150000_outcome_review_fixes.sql` closes the one enum the original missed (`proof_type`, previously
written raw from `evidence_memory.kind`) by **forward migration**, never by editing a committed file.

`BEFORE UPDATE` write-once triggers exist on `post_dimensions` and `post_outcomes`; **no `BEFORE DELETE`
trigger exists on any of the three new tables** — `BEFORE DELETE` appears nowhere in the three migrations — so
`purge_business` cannot be aborted (ADR 0018 `[db-BLOCKER-1]`).

**OUTCOME-TAG-ALL-CALLERS.** The trigger attaches to the artefact, so `generatePostsForCampaign`, the
regenerate action and Studio promote need no enumeration; the Tier-1 proof is a **raw `INSERT INTO
post_ai_originals` issued by no application code** (`supabase/__tests__/outcome-tagging-trigger.test.ts`, 19
tests, green in CI at head). This is the correct structural answer to the Session 22 pattern and I accept it.

The history copy (`20260919120000`) writes **only** `role`, `format` and `origin_mode`; `hook_type` and
`proof_type` stay NULL; every join is business-scoped; it is idempotent on the PK. Imports are never touched
(they have no `post_ai_originals` row). `hookType` is `.nullish()` on all three output schemas and
`AI_ORIGINAL_SCHEMA_VERSION` is not bumped.

Findings: **MINOR-6** (an ADR finding).

---

## 3. The writers to `performance_memory` (ADR §5; D-4, A-2)

**Verified, and the strongest part of the build.**

- Both namespace CHECKs exist and are the only ones of their kind. Queried at head:
  `performance_memory_outcome_key_namespace_check` = `source <> 'outcome' OR pattern_key LIKE 'outcome:%'`;
  `performance_memory_distilled_key_namespace_check` = `source <> 'distilled' OR pattern_key IS NULL OR
  pattern_key NOT LIKE 'outcome:%'`.
- **No stale CHECK survived.** `pg_constraint` at head returns exactly **one** `source` CHECK
  (`manual, distilled, import, outcome`) and exactly **one** `dimension` CHECK
  (`topic, hook, format, proof_type, role, origin_mode, length_band, cta, hypothesis`). The
  find-by-definition plus `RAISE unless exactly one` idiom in `20260919130000` did what it claims.
- **The distilled index is byte-identical to before.** Live `pg_indexes`:
  `performance_memory_distilled_pattern_key_uq … WHERE ((source = 'distilled') AND (deleted_at IS NULL))`,
  matching `20260726020000_performance_memory_pattern_key.sql:26-28` — which the ADR-0018 guard proves is
  byte-identical to BASE. The sibling `performance_memory_outcome_pattern_key_uq` differs only in its
  `source = 'outcome'` predicate, so `ON CONFLICT` inference stays disjoint.
- `upsert_outcome_performance_pattern` takes **no stats parameters** (`p_business_id, p_dimension, p_value,
  p_platform, p_direction, p_pattern_text`); passing `p_outcome_n` is rejected by the signature, and a Tier-1
  case asserts it. `public.wilson_bounds` is the **one copy** of the formula — the Wilson expression appears
  exactly once across every migration in the range, in `20260919140000_outcome_rpcs.sql`, and
  `outcome_cell_stats`, `promote`, `demote` and `acknowledge` all call it. No TypeScript re-implements the
  gate: `lib/outcomes/constants.ts` is transcription only, and `lib/db/campaign-retrospectives.wilsonBounds` is
  a thin RPC wrapper.
- Cross-writer isolation is tested in **both** directions, and `promote_performance_pattern` is proven unable
  to promote an outcome row (`outcome-promotion-floor.test.ts` case 6;
  `performance-memory-outcome-schema.test.ts`, 53 tests).
- **SHARED-FUNCTION CALLERS**, checked by `git grep` at the range rather than taken on trust:

  | Function | Production callers at `879737c7` | Covering test |
  |---|---|---|
  | `listPerformanceMemoryCandidates` | `lib/memory/performance.ts:51` (→ `lib/ai/context.ts`) and `:140` (`retrieveStudioPerformancePatterns` → `studio/actions.ts:13`) — **still two** | `lib/memory/outcome-separation.test.ts` exercises **both paths by name** against a client that applies the filters, plus the shared reader itself |
  | `upsertDistilledPerformancePattern` | `lib/learning/promote.ts:119`, `lib/learning/summarize.ts:185` — **unchanged, no new caller, no new parameter** | existing `promote.test.ts`, `summarize.test.ts` |
  | `importPerformanceMemory` | `lib/memory/import.ts:144` only — unchanged | existing, source-scan enforced |
  | `listOutcomePatterns` (new) | `lib/memory/outcomes.ts:29,49`; `lib/outcomes/campaign-view.ts:129,130` | `lib/memory/outcomes.test.ts`, `lib/outcomes/__tests__/campaign-view.test.ts` |
  | `upsertOutcomePattern` / `promote` / `demote` (new) | `lib/outcomes/orchestrator.ts:107,119,121` only | Tier-1 RPC suites plus `lib/outcomes/__tests__/orchestrator.test.ts` |
  | `acknowledgeRetrospective` (new) | `retrospective-actions.ts:76` only | Tier-1 `outcome-retrospective-rpc.test.ts` plus `retrospective-actions.test.ts` |
  | `list_posts_for_metrics_sync` | `lib/db/posts.ts` → `lib/metrics/orchestrator.ts:37` only — unchanged | `lib/db/posts.metrics.test.ts`, `lib/metrics/orchestrator.test.ts`, Tier-1 cadence suite |
  | ADR 0018's `hasCta` | new importer `lib/outcomes/measured.ts:1` — **imported; `lib/learning/diff.ts` unmodified, no `export` added** | `lib/outcomes/__tests__/measured-dimensions.test.ts` |

  **No caller is left without a listed test.** No existing writer gained a caller or a parameter (ADR §5.6).
- **Forgeability.** `performance_memory_insert_own` now carries `AND source = 'manual'`; the `BEFORE UPDATE`
  trigger's three branches are each covered by a Tier-1 test executed as the **authenticated role against live
  Postgres** — not a `pg_policies` read. `20260919160000_outcome_delete_guard.sql` additionally removes the
  member DELETE path for outcome rows. `git grep` at the range finds **no `app/**` code writing
  `performance_memory` with an authenticated client**; the only writers are the service-role wrappers in
  `lib/db/memory-performance.ts`.

Findings: **MINOR-3**.

---

## 4. Normalisation, the floor, confidence, retrieval and render (ADR §6; L-2, L-3)

### 4.1 The floor — I mutated it myself

I swapped the body of `public.promote_outcome_pattern` in the live local database, re-ran
`supabase/__tests__/outcome-promotion-floor.test.ts`, restored, and confirmed green again. **Each of ADR
§12.1's six cases is independently load-bearing, and the failures land exactly where the ADR predicts:**

| Mutation | Tests that failed |
|---|---|
| campaign gate removed (`s_n >= 10 AND s_low > 0.5`) | **only** case (2) "9/10 with 2 campaigns" |
| bound weakened (`s_low > 0.4`) | **only** case (3) "8/10, bound 0.490" |
| `k` dropped (`s_campaigns >= 3 AND s_low > 0.5`) | case (4) "9/9 fails only on k", plus (5) and the `n = 5` provisional case, which also depend on `k` |
| floor read from the **stored row** (`pm.outcome_n >= 10 AND pm.outcome_distinct_campaigns >= 3 AND pm.interval_low > 0.5`) | **only** case (5) "forged `outcome_n` still does not promote" |
| restored | 17/17 green |

The cases call the **RPC over seeded `post_outcomes` / `post_dimensions` rows**
(`supabase/__helpers__/outcome-fixtures.ts`), not a mocked RPC. `OUTCOME-MIN-N-ENFORCED` and
`OUTCOME-RECOMPUTE-NOT-TRUST` are genuinely proven.

The "below" direction is implemented as a **direction-matching win count** with the same `s_low > 0.5` gate
rather than `s_high < 0.5`. That is algebraically the ADR's rule (`low(k,n) = 1 − high(n−k,n)`), the deviation
is documented in the migration header, and a Tier-1 mirror test pins the identity against `wilson_bounds`
itself. Accepted.

### 4.2 Eligibility, baseline and the literal zero

`lib/outcomes/normalise.ts` is pure and clock-free. `eligibleValue` requires **every** eligible field to be a
finite non-negative number and otherwise returns a typed `{ok:false, reason:'null_field', field}` — there is no
`?? 0` and no `|| 0` in the normaliser, in either `fetchPostMetrics`, or in the render. An X post with
`impressions === 0` is **excluded**, not divided. LinkedIn never reads `impressions`; X never reads `reach`.

`MINOR-2`'s lines are intact: `lib/memory/performance.ts`'s governed `.map(record => ({…}))` carries neither
`likes` nor `impressions`, both stay optional on the type, and the scan half asserts the block exists rather
than passing vacuously when it cannot find it.

### 4.3 Retrieval and render

`listPerformanceMemoryCandidates` carries `.neq('source', 'outcome')` at `lib/db/memory-performance.ts:38` —
one choke point, both call paths tested by name. `retrieveOutcomePatterns` filters `dimension !== 'hypothesis'`
and caps at `OUTCOME_CAP = 3` among outcome rows only; `retrieveHypothesisResults` is the **only** reader of
hypothesis rows and is called **only** from `lib/campaigns/brief.ts:99` (Stage A). **Hypothesis rows cannot
reach per-post generation** — I traced both `buildCustomerContext` and `withPostQueryContext`, which obtain
outcomes exclusively through `retrieveOutcomePatterns`.

The observed-outcomes block renders at **all three** sites — `post-generation.ts:189`,
`post-regeneration.ts:153` and **`formats/native-generation-prompt.ts:138`** (the live Mode-2 generator) —
through one shared renderer that puts `wins`, `n` and `campaigns` on **every** line and routes the sentence
through `neutralize()`. The "Top-Performing Post Snippets" block is untouched and never receives an outcome row.

---

## 5. Decay, re-confirmation and contradiction (ADR §7)

I mutated `public.demote_outcome_pattern` the same way:

| Mutation | Tests that failed |
|---|---|
| fast trigger removed (`s_low <= 0.5` only) | **only** "4 of the last 5 contrary demotes even though the WINDOW still passes" |
| window bound removed (fast trigger only) | the window-bound test, the concurrency test, the all-aged-out test and the re-promotion test — four, none of them the fast-trigger test |
| fast trigger loosened to `>= 3` | **only** "3 of the last 5 contrary does NOT demote" |
| restored | 10/10 green |

So the two triggers are separately proven. The "4-of-5" fixture is seeded so that the window bound demonstrably
still passes — the test asserts `s_low > 0.5` and `{s_l5_n: 5, s_l5_against: 4}` read from `outcome_cell_stats`
directly — and the window-bound fixture is seeded so the newest five are wins. Ordering is by
`published_at DESC, post_id DESC` inside a `ROW_NUMBER()` subquery, **not** by `id` and **not** by
`created_at`. Concurrency: two parallel demotes produce exactly one transition and one `contradicted_at`; the
180-day exclusion is tested with seeded `published_at`; demotion recomputes its own inputs through the shared
`outcome_cell_stats`. Hysteresis is as specified.

---

## 6. The retrospective, the brief and the north-star (ADR §8; L-6, A-1)

`HypothesisSchema` / `SuccessCriteriaSchema` (`lib/outcomes/hypothesis.ts`) are **exactly** ADR §8.1's ranges —
hypothesis ≤ 300 chars, `win_rate` ∈ [0.5, 0.95], `median_lift` ∈ [1.0, 3.0], `evaluationWindowDays` an integer
∈ [7, 60], out-of-range **rejected, never clamped**, both-or-neither. One schema serves Stage A and the
brief-review action. `git diff --name-only 75cae307..879737c7 -- supabase/__tests__/` contains **no**
brief or freeze-guard file: the existing `MODE2-BRIEF-FROZEN-GUARD` Tier-1 test runs **unmodified**. Both
fields are optional, so briefs frozen before the amendment still parse and fall back to the labelled implicit
hypothesis.

`acknowledgeRetrospectiveAction` takes the acting user from `(await createClient()).auth.getUser()` —
**`retrospective-actions.ts:62-65`** — never from form data; the Zod schema accepts only `campaignId` and
`note`. The RPC independently re-checks `business_members` for an `active`, non-`viewer` member and raises
`42501`, so **a viewer is refused by the database**. The Tier-1 suite proves: a non-member refused, a viewer
refused, exactly one `performance_memory` row written, a second call a no-op, and `inconclusive` writing none.

`acknowledge_campaign_retrospective`'s fourth parameter `p_pattern_text` is the recorded way ADR §8.4's
TS-side `neutralizeWithSentinels` applies, and the optional fifth `p_note` is recorded in the migration header.
I checked the substance the primer asked for: **the RPC still derives every statistic itself** — it re-reads
`v_row.n` / `v_row.wins` from the retrospective row it just locked, recomputes the interval through
`wilson_bounds`, computes confidence with the §6.4 shrink, and derives `metric_basis` and `baseline_seeded`
from `post_outcomes` for that campaign. Nothing statistical comes from the caller.

`get_learning_cycles_northstar` counts **only** retrospectives with `verdict IN ('supported','not_supported')`
**and** `acknowledged_at IS NOT NULL` **and** an `EXISTS` on the matching `outcome:hypothesis:<campaign_id>`
row with `deleted_at IS NULL` — the four-fixture Tier-1 test (`outcome-northstar.test.ts`, 5 tests) is green.
It is the **one** function that reads across businesses, by design, and returns counts only; it is allowlisted
**by name with its reason** in the Tier-3 cross-business scan.

Findings: **MINOR-1**.

---

## 7. Provenance and the seed (ADR §9; L-5, A-4)

The seed is read from `social_backfill_runs.summary` (`lib/db/post-outcomes.ts:169-187`), never from a
`source='import'` `performance_memory` row — `git grep "'import'"` across `lib/outcomes/`,
`lib/db/post-outcomes.ts`, `lib/db/campaign-retrospectives.ts` and `lib/memory/outcomes.ts` returns **nothing**
outside the Tier-3 scan's own allowlist string. The basis vocabulary is mapped by the reader
(`impressions → rate`, `raw → count`, anything else → `null`) and then **enforced again at use**: `baseline()`
accepts a seed only when `platform === 'twitter' && basis === 'rate' && seed.basis === 'rate'`, so a
count-basis seed is refused for a rate-basis post (`OUTCOME-SEED-BASIS-MATCH`, Tier-2 tested). The row is
stamped `baseline_source = 'import_seed'` and propagated to the pattern by
`coalesce(bool_or(baseline_source = 'import_seed'), false)` inside `outcome_cell_stats`, surfacing as
`baseline_seeded` and as the "Compared against the history you imported" line on every seeded row.

Findings: **NIT-3**.

---

## 8. The UX contract and attribution honesty (ADR §10; L-7, A-5)

**Every ADR §10.2 state is rendered and tested**, in all three locales
(`app/[locale]/(dashboard)/campaigns/[id]/outcome-surfaces.test.tsx`, 24 tests): retrospective not-due (with
the date, and a second line while posts are unpublished), inconclusive `{n} of 5`, supported / not supported
with hypothesis, verdict, "{wins} of {n} posts beat your usual engagement", interval-with-its-n, per-role table
and the implicit label, acknowledged (who, when, note), metrics-unavailable per platform; and observed:
none-yet, provisional `{n} of 10`, live (n **and** campaigns), contradicted (paused on the date), and
not-enough-variety. The LinkedIn count-basis disclosure is on **every** LinkedIn row and the seeded disclosure
on **every** seeded row. The honesty line "This measures engagement on {platform}, not signups or revenue." is
unconditional. There is **no business attribution and no UTM** — `git grep` for `utm_*` in production
TypeScript hits only the pre-existing `lib/signals/rss-orchestrator.ts` RSS URL handling, exactly as ADR §10.3
predicted.

The surfaces are on the **campaign detail page only** — `page.tsx:66,146-156`, gated on
`campaign.status !== 'draft'` — **not on the approval gate**, and there is **no `/analytics` route**
(`find app -ipath "*analytics*"` is empty). `RetrospectiveCard` and `ObservedOutcomesList` are Server
Components; `AcknowledgeForm` is the only `'use client'` file and uses `useActionState`. **No `asChild` on
`Button` or on any `DropdownMenu` primitive** — the submit control is a native `<button>` with
`cn(buttonVariants({size:'sm'}))`. Tailwind only, no new colour token. i18n parity (keys *and* placeholders) is
asserted by `lib/i18n/outcome-parity.test.ts`, and the namespace is wired in `i18n/request.ts` for all three
locales.

**The copy lint**, which I reddened myself: it covers the **outcome namespace of all three locale files**, the
**rendered template output** for every (platform × dimension × value × direction × stored/counted)
combination, **and** the prompt block. Against the real files it finds zero violations in en/pt/es; with a
planted `2× more` and a locale-appropriate causal verb it flags both, in each of the three. It also bans bare
percentages without `{n}`, superlatives, and em/en dashes.

**What `taste-skill` and `impeccable` changed** — per the `c03fa2e2` commit body, which I read and checked
against the diff. `taste-skill` contributed framing only: verdict-first, the post count beside every rate,
disclosures quiet underneath, no badges/dots/decoration/em-dashes, one radius scale, no accent added; it
"changed nothing structural". `impeccable` fixed two P2s — member-authored text (hypothesis, note) overflowing
the card at narrow widths (`break-words`, visible at `RetrospectiveCard.tsx:60,110`) and a missing visible
focus ring on the note textarea (`AcknowledgeForm.tsx:32`) — and recorded one P3 as left. **Neither skill added
a state, dropped a disclosure, or introduced ADR §10.3 framing**: I verified every §10.2 row still has a
rendering site and a test, and the copy lint is green over the rendered output. **The contract is intact.**

Findings: **MAJOR-1**, **MINOR-5**.

---

## 9. GDPR and tenancy (ADR §11; L-8)

Three business-scoped tables, each with `business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE
CASCADE`, RLS enabled, **one SELECT policy each** in the InitPlan form
`business_id = ANY (SELECT unnest(public.get_user_business_ids()))`, and **no authenticated INSERT / UPDATE /
DELETE policy at all** — plus a belt-and-braces `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM authenticated`.
`supabase/__tests__/outcome-tables-rls.test.ts` (24 tests) proves cross-tenant SELECT denial on all three and
the absence of any authenticated write path; `outcome-tables-purge.test.ts` holds rows in **all three** tables
and asserts the business delete **succeeds**.

**The three §D2.5 rows are verbatim** — I diffed `docs/decisions/0010-legal-surface.md` against ADR 0026 §11
line by line and they match — **and they landed in the same commit as the migration**: both
`docs/decisions/0010-legal-surface.md` and `supabase/migrations/20260919110000_outcome_tables.sql` have exactly
one commit in the range, `e0ca8cab`. `lib/db/__tests__/d2.5-outcome-rows.test.ts` additionally pins them as a
Tier-3 scan and reddens on a changed table name.

Findings: **MAJOR-1** — the SELECT policies above are never exercised by the only production reader.

---

## 10. The test plan (ADR §12) and the count

Every one of the **34 non-E** constraints maps to a tier, a named test artefact and an executing CI job in ADR
0026 §V.2, and I checked the tier arithmetic myself: **Tier-1 rows = 18** (2, 3, 4, 5, 13, 14, 18, 19, 20, 21,
22, 23, 24, 25, 26, 32, 33, 34), **Tier-2 rows = 20** (1, 2, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 21, 22, 23,
24, 25, 27, 30, 32), **Tier-3 rows = 8** (6, 7, 16, 28, 29, 30, 31, 34). They overlap, as the ADR says. All 34
have every executing job green at `eebe96da` **and** at head `879737c7`.

**I re-ran the Tier-3 set myself at head and reddened each:**

| # | How I reddened it |
|---|---|
| 6 `NO-RETRO-TAGGING` | detector unit-tested against six planted TS write shapes and a planted migration INSERT; the allowlist is asserted **exactly**, not as a subset, so a stale entry fails too |
| 7 `DESCRIPTIVE-ONLY` | detector flags a planted `outcome:hook:…` key, a `dimension: 'proof_type'` literal and an `upsertOutcomePattern` naming `hook_type`; additionally enforced **in SQL** by `performance_memory_outcome_dimension_check` and a `RAISE` in `outcome_cell_stats` |
| 16 `NO-ZERO-METRICS` | detector flags a planted `likes: 0` / `impressions: 0` in the governed map, and reports "block not found" rather than passing vacuously |
| 28 `DETERMINISTIC-NO-LLM` | detector flags six import shapes (`@anthropic-ai/sdk`, `@/lib/ai/*`, relative `../ai/*`, dynamic `import()`, `require`), ignores comments, and asserts the scanned file set is non-empty |
| 29 `ADR0018-UNCHANGED` | ran the script (exit 0), ran the raw `git diff` (empty), and reddened the script against an older base (exit 1, names the offender); a missing base exits 2 |
| 30 `NO-CROSS-BUSINESS` | wrapper half asserts filters on a **recording client** (not source text) for 17 named calls and fails on any un-enumerated export; SQL-body half scans the RPC bodies, with `get_learning_cycles_northstar` allowlisted by name and reason |
| 31 `NO-EXTRA-WRITER` | extractor parses `VALUES` and `INSERT … SELECT`, flags a planted `'manual2'` **and** a non-literal source, and asserts exact set equality `{distilled, import, outcome}` over ≥ 4 real inserts |
| 34 `CASCADE-COMPLETE` | the §D2.5 row scan fails on a changed table name; the Tier-1 half asserts the purge **succeeds** with rows present |

**Tier E is correctly framed.** ADR 0026 §V.4 records `OUTCOME-PREDICTION-ACCURACY` as
*"MEASURED - NOT YET RUN; earliest ~T0 + 150 days; T0 undefined today"*, states plainly that nothing was run
and nothing is claimed, carries the per-arm floor `n ≥ 15`, and carries the label **"association, not
validation"** together with both reasons: the promoted pattern enters the prompt so the non-matching arm is a
self-selected residual, and patterns are promoted because they ran hot so reversion is expected. **No number is
reported anywhere as COVERED or as causal.** Correct.

Findings: **MINOR-4**.

---

## 11. The worker, config and amendments (ADR §14)

`app/api/cron/extract-outcomes/route.ts` is its own route with its own orchestrator — never folded into
`sync-metrics` or `lib/learning`. Dual-mode QStash/bearer auth copied from `capture-learning`, timing-safe
comparison, 405 on the wrong verb for the configured trigger. **The canonical tick line's key set is exactly
ADR §14's sixteen keys**, picked by name (`kind, triggeredBy, tick, durationMs, candidates, matured,
outcomesWritten, skippedNoMetrics, skippedNoBaseline, skippedIneligibleField, cellsRecomputed,
candidatesUpserted, promoted, demoted, retrospectivesCompleted, errors`) — **no content and no business id**.
The two `console.warn` auth-failure lines match `capture-learning`'s established shape exactly and are within
the CLAUDE.md carve-out as practised.

`Sentry.withMonitor('extract-outcomes', …, {schedule: {type:'crontab', value:'0 4 * * *'}})`; one business per
iteration with no captured `business_id`; per-item `try/catch` at business, post and cell level. A replayed
tick changes nothing — `insertPostOutcome` is `ON CONFLICT DO NOTHING`, the due-list excludes posts that
already have an outcome, and upsert/promote/demote are recomputes — proven by Tier-1
`outcome-tick-idempotent.test.ts` and Tier-2 `orchestrator.test.ts`. `OUTCOME_BATCH_SIZE` (200) and
`METRICS_MAX_AGE_DAYS` (9) go through `lib/config.ts` only; the statistical constants are code in
`lib/outcomes/constants.ts` with SQL twins documented at each RPC, **never env** — `constants.test.ts` parses
ADR §6.4's own block and fails on drift. A runbook row exists (`docs/build-guide/runbooks/qstash-setup.md`
Step 2d) and Step 7's alert list names `extract-outcomes`.

**Amendments, all present and additive:** ADR 0016 Amendment **D**, ADR 0017 Amendment **E**, an ADR 0018 note,
ADR 0024 §17, an ADR 0025 §5.4 correction note, ADR 0028 Amendment A, and the ADR 0010 Amendment 2 §D2.5 rows.
Each cites ADR 0026. **No migration was edited after its commit** — `git log --follow` per file returns exactly
one commit for each of the seven. **No new dependency**: `package.json` and the lockfile are unchanged in the
range. The database-reviewer and security-reviewer findings were fixed by **forward migration**
(`20260919150000`, `20260919160000`) and recorded in the J2.6 and J2.11 commit bodies.

Findings: **MINOR-2**, **NIT-1**, **NIT-2**.

---

## 12. Scope (L-1)

Nothing on L-1's out-of-scope list shipped. No experimentation or holdout code, no UTM tagging, no conversion
ingestion, no analytics route, no cross-type retrieval (outcome rows are excluded from the shared ranking by
the shared reader itself), **no additional memory writer** beyond this session's one — the Tier-3 source-value
scan proves the set is exactly `{distilled, import, outcome}` — no comment mining, no embeddings, no new OAuth
scope, and **no model call in the extractor**: `lib/outcomes/**` and the cron route import nothing from
`lib/ai` or `@anthropic-ai`, scan-proven and reddened. `lib/learning/` is byte-identical to BASE.

---

# Findings

No BLOCKER. Two MAJOR, seven MINOR, three NIT.

---

### MAJOR-1 — The campaign detail page reads every outcome table with the **service-role** client, so the three new tables' SELECT RLS policies are never exercised in production

**Where (at `75cae307..879737c7`):**
`app/[locale]/(dashboard)/campaigns/[id]/page.tsx:66` calls
`loadCampaignLearningView(business.id, id, campaign.platforms)`.
`lib/outcomes/campaign-view.ts:125-130` fans that out to six readers, and **every one of them acquires its own
service-role client**: `lib/db/campaign-retrospectives.ts:71-72` (`getCampaignRetrospective`), `:179-180`
(`listCampaignPostStates`), `:220-221` (`getFrozenBriefContent`), `listCampaignOutcomeCellSources`, and
`lib/db/memory-performance.ts:391-392` (`listOutcomePatterns`, called twice).

**What is wrong.** CLAUDE.md's three-client table states that `/lib/supabase/service.ts` is for "AI layer,
webhook handlers, vault writes, scheduler" and is "never imported into a Server Component or Client Component",
and enumerates the permitted uses (`ai_usage` writes, `trial_state` writes, vault RPCs, the publishing worker,
the metrics worker, the Stripe webhook). Build-guide §0 **L-9** is blunter: *"service-role never in a
user-facing read path."* A campaign detail page is a user-facing read path. `createServiceRoleClient()`
bypasses RLS entirely, so the `post_dimensions` / `post_outcomes` / `campaign_retrospectives` SELECT policies
written in `20260919110000` — the ones constraint 33 `OUTCOME-RLS-ISOLATED` proves correct with 24 Tier-1
tests — are **never evaluated by the only production code that reads those tables**.

**This is not the house pattern.** I checked the two candidate precedents at BASE and both refute it:
`app/[locale]/(dashboard)/opportunities/page.tsx:48-50` passes the **anon** client into
`listPendingCardsForBusiness(client, …)`, and `app/[locale]/(dashboard)/settings/signals/page.tsx:47-50` passes
it into `listWatchedFeedsForBusiness(client, …)` and `listRecentSignalsForBusiness(client, …)`. Inside
`lib/db`, the established split is: **page reads take a `client` parameter; writes and worker reads
self-acquire service-role** — `lib/db/insight-cards.ts:67,91,110` take a client, `:148,187,210` self-acquire.
Session 33's new readers are the first page reads that self-acquire. `listOutcomePatterns` also departs from
its own sibling `listPerformanceMemoryCandidates(client, businessId, limit)` in the very same file.

**Why it matters.** Tenancy on this surface now rests on a single argument — the `businessId` derived from
`getBusinessForUser(client, user.id)` — with no database-level second line. That is precisely the defence L-8
and the RLS work exist to provide. `OUTCOME-RLS-ISOLATED` is green in CI and protects nothing in production.

**Failure scenario.** A future refactor that resolves the business id from a route parameter, a cached value or
a member-switching flow rather than from the session — or any caller that passes a campaign id belonging to
another tenant alongside a stale business id — returns another tenant's retrospective, hypothesis text and
per-post outcome measurements, and no database policy stops it. Today the argument is session-derived and every
query filters on it (`OUTCOME-NO-CROSS-BUSINESS` proves the filter is always applied), which is why this is
MAJOR and not BLOCKER: there is no demonstrated leak, only the removal of the layer that would catch one.

**What would prove it fixed.** Either (a) the six readers used by `loadCampaignLearningView` take a
`client: SupabaseClient` parameter and the page passes the authenticated anon client, with a Tier-1 test
proving that a member of business B gets **zero rows** for a campaign of business A through that exact path —
the RLS policy doing the work, not the argument; or (b) a founder-level decision to keep service-role here,
recorded as an amendment to CLAUDE.md's three-client table **and** to build-guide L-9, with ADR 0026 §10.4
stating it and the reason RLS is not the guard on this surface. What is not acceptable is the current silent
divergence between the binding rule and the code.

---

### MAJOR-2 — Making `fetchPostMetrics` real turned a previously-dead error branch live, and that branch records **no** diagnostic; a real X failure is then laundered into the outcome loop's benign `skippedNoMetrics`

**Where (at the range):** `lib/metrics/orchestrator.ts:99-106`

```ts
    } catch (e) {
      if (e instanceof SocialProviderError && e.code === 'NOT_IMPLEMENTED') {
        unsupportedPlatforms.add(post.platform)
        summary.skippedNotImplemented++
      } else {
        summary.errors++          // e is never bound, never logged, never captured
      }
    }
```

and the receiving end at `lib/outcomes/orchestrator.ts:139`
(`summary.skippedNoMetrics += due.length - ready.length`).

**Why this is a Session 33 finding even though the line is unchanged.**
`git diff 75cae307..879737c7 -- lib/metrics/orchestrator.ts` is empty — but before J2.1 (`c787e633`) **both**
providers' `fetchPostMetrics` threw `NOT_IMPLEMENTED` (ADR 0026 §1.2 item 1), so the `else` branch was
unreachable for the only two platforms the worker syncs. J2.1 made it the live path for every X token expiry,
revocation, rate limit, network error and response-shape mismatch (`twitter-provider.ts:459-465` throws
`UNKNOWN` on a Zod failure). This session turned a dead branch into the primary failure path and did not give
it an observer, while every comparable handler the same session wrote *does* have one —
`lib/outcomes/orchestrator.ts:125-127, 202-205, 244-258` all pair the counter with
`Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: … } })`.

**Failure scenario.** An X refresh token is revoked. Every hourly tick logs `errors: N` in `metrics-sync-tick`
with no platform, no post id, no message and nothing in Sentry. `post_metrics` stops being written. Seven days
later those posts reach `listPostsDueForOutcome` with no day-7 sync, and the daily `outcome.tick` counts them
as **`skippedNoMetrics`** — the counter ADR §6.1 defines as the benign "a post whose day-7 sync never arrived".
After `CANDIDATE_LOOKBACK_DAYS = 30` (`lib/outcomes/orchestrator.ts:45`) they leave the candidate scan and are
**never frozen**. An ongoing auth outage is indistinguishable, in both tick lines, from a quiet week — on the
one input the whole session exists to consume.

**What would prove it fixed.** The `else` branch captures the error with the platform and post id as tags — the
shape is already established in `lib/outcomes/orchestrator.ts` — and a Tier-2 test in
`lib/metrics/orchestrator.test.ts` asserts that a non-`NOT_IMPLEMENTED` `SocialProviderError` produces a Sentry
capture as well as the `errors` increment. Ideally the outcome tick also separates "no metrics row ever
written" from "metrics written but older than day 7", so the two are not one counter.

---

### MINOR-1 — The retrospective phase is the only handler in the tick that swallows its error without capturing it

**Where:** `lib/outcomes/retrospective.ts:147-149`

```ts
    } catch {
      result.errors += 1
    }
```

The caller (`lib/outcomes/orchestrator.ts:253-254`) folds `retro.errors` into `summary.errors` without
capturing either. Everything inside the `try` is therefore invisible: `listCampaignPostStates`,
`getFrozenBriefContent`, the `wilsonBounds` RPC, `insertCampaignRetrospective`, and the deliberate
`throw new Error('retrospective: non-finite published_at')` at `retrospective.ts:57`.

**Why it matters.** Every other per-item handler this session wrote pairs the counter with a Sentry capture and
a `phase` tag; this one does not, and it is the phase whose failure is least visible from outside — a campaign
that fails evaluation simply stays in `listCampaignsAwaitingRetrospective` and looks exactly like "not due yet".

**Failure scenario.** A migration renames or drops `wilson_bounds`. Every retrospective in every business
fails, `retrospectivesCompleted` stays 0, `errors` rises by the number of due campaigns, and nothing anywhere
names the RPC. The north-star stays at zero and the cause is unrecoverable from the logs.

**What would prove it fixed.** `catch (err) { result.errors += 1; Sentry.captureException(err, { tags: { cron:
'extract-outcomes', phase: 'retrospective-campaign' } }) }`, with a Tier-2 test asserting the capture on a
throwing reader.

---

### MINOR-2 — The cron route's catch fabricates a zeroed summary and logs it as fact

**Where:** `app/api/cron/extract-outcomes/route.ts:60-67`

A bare `catch` — no binding, no capture — replaces the real summary with
`candidates: 0, matured: 0, outcomesWritten: 0, … errors: 1`, and the route then emits that as the canonical
`outcome.tick` line and returns **200**.

**Why it matters.** `runOutcomeTick` already absorbs almost everything, so the only throws that reach here are
the catastrophic ones: a `config.server.*` `serverOnly()` failure, a module-load failure, a
`Sentry.withMonitor` failure. Those are exactly the cases that most need a reason, and they get none. Worse,
the zeros are not "unknown" — the line **asserts** that nothing was due and nothing was written, when work may
well have completed before the throw. The one operator-visible artefact of a misconfigured deployment reads as
a quiet, empty day.

**Failure scenario.** `OUTCOME_BATCH_SIZE` is set to a non-numeric value in production. Every nightly tick logs
`{"kind":"outcome.tick", …, "candidates":0, "outcomesWritten":0, "errors":1}` and returns 200; the Sentry cron
monitor sees a successful check-in; nobody learns that the outcome loop has never run.

**What would prove it fixed.** Bind the error, `Sentry.captureException` it, and emit the line with the
counters the tick actually reached — or an explicit `unknown` marker — rather than fabricated zeros, with a
Tier-2 test asserting that a throwing `runOutcomeTick` produces a capture and does not report `candidates: 0`
as a fact.

---

### MINOR-3 — A member may rewrite an outcome row's `pattern` text in the same UPDATE that retires or soft-deletes it

**Where:** `supabase/migrations/20260919130000_performance_memory_outcome_schema.sql:224-247`

Branch B guards `pattern_key` and `dimension`. Branch A (`:230`) allows the update outright when
`NEW.status = 'retired' OR NEW.deleted_at IS NOT NULL`. Branch C (`:234-245`) then guards only the eight stats
columns. **`pattern` is in no branch.** So `UPDATE … SET status = 'retired', pattern = '<anything>'` succeeds
for an `authenticated` member on an outcome row, as does
`SET deleted_at = now(), status = 'active', pattern = '<anything>'`.

**Why it is MINOR and not worse.** Neither resulting row can reach a prompt: `listOutcomePatterns`
(`lib/db/memory-performance.ts:396-400`) filters `.eq('status', status)` **and** `.is('deleted_at', null)`, and
the campaign surface reads only `active` and `candidate`; the rendered text additionally passes through
`neutralize()`. Nor can the row be resurrected — clearing `deleted_at` while `status <> 'retired'` is rejected
by branch A, which `performance-memory-outcome-schema.test.ts:405` proves. The damage is confined to the
integrity of the stored record of what the system observed.

**Why it is still a finding.** ADR §12.1 lists *"UPDATE of an outcome row's `outcome_n`/`pattern`/`source`
rejected"* as a Tier-1 obligation. The suite covers `pattern` **alone** (`:386`, rejected by branch A) and
`retire + outcome_n` (`:413`, rejected by branch C) — but never `retire + pattern`, which is the one
combination that passes. The constraint reads as proven while the gap is untested in either direction.

**Failure scenario.** A member retires an outcome pattern and simultaneously rewrites its sentence to something
the system never observed. The row survives as the audit record of a measurement that did not happen, and a
future session that un-retires outcome rows — or a T1-B analytics reader that reports on retired patterns —
serves it as fact.

**What would prove it fixed.** `pattern` (and `platform`, `scope`, `scope_ref`) added to branch C's immutable
tuple for outcome rows, plus a Tier-1 case asserting that `{status: 'retired', pattern: 'forged'}` is rejected
while `{status: 'retired'}` alone still succeeds.

---

### MINOR-4 — The constraint→CI map names `app-tests` as the executing job for constraint 29, but CI executes only its detector, not the property

**Where:** `docs/decisions/0026-outcome-loop.md` §V.2 row 29 (read at `879737c7`), against
`scripts/check-adr0018-unchanged.ts:1-6` (read at the same commit).

The script's own header says it plainly: *"a recorded Tier-3 command, **NOT part of app-tests**: it needs the
BASE commit in git history, which a shallow CI checkout does not guarantee."* What `app-tests` actually runs is
`lib/outcomes/__tests__/adr0018-guard.test.ts` — the pure decision logic over synthetic path lists — plus the
unmodified `lib/learning` suite. The property *"`lib/learning/` and the eight ADR 0018 migrations are identical
to BASE"* is verified only by a human running the command.

**Why it matters.** This is exactly the `AUTHORED-NOT-EXECUTED` distinction ADR 0015 §2 exists to name. A
reader of the map concludes that CI would catch an ADR 0018 change; it would not —
`adr0018-guard.test.ts` passes unchanged whatever `lib/learning/` contains.

**This is a labelling defect, not a coverage hole:** ADR §12.3 explicitly makes constraint 29 a recorded Tier-3
*command*, which ADR 0015 permits, and **I ran it at head (exit 0), ran the raw `git diff` (empty), and proved
it reddens.** The property holds.

**What would prove it fixed.** The map's "Executing CI job" cell for row 29 reads *"none — recorded Tier-3
command, re-run per session (see V.3); `app-tests` runs the detector's unit tests and the unmodified
`lib/learning` suite only"*; or the workflow gains a `fetch-depth: 0` checkout step that runs the script, and
the cell becomes true.

---

### MINOR-5 — `unavailablePlatforms` hard-codes platform capability outside `/lib/social/`

**Where:** `lib/outcomes/campaign-view.ts:139`

```ts
    unavailablePlatforms: platforms.filter((p) => p === 'linkedin' && !measured.has(p)),
```

**Why it matters.** "Which platforms can return metrics" is `/lib/social/`'s knowledge; CLAUDE.md's
native-provider rule exists so that consumers talk to the abstraction rather than re-deriving provider facts.
The ADR §10.2 "metrics unavailable" state is a *provider* state, and here it is a string literal in a view
builder.

**Failure scenario.** LinkedIn grants `r_member_social_feed` and `LinkedInProvider.fetchPostMetrics` is
implemented. Every campaign detail page keeps printing "Metrics aren't available for LinkedIn yet." until
someone remembers this line — and the `!measured.has(p)` half means a brand-new LinkedIn campaign with no
frozen outcomes yet shows the same message even once metrics work, indefinitely.

**What would prove it fixed.** The unavailable set derives from the provider registry or `PLATFORM_CONFIGS`
capability rather than a literal, with a Tier-2 test that flips the capability and asserts the disclosure
disappears.

---

### MINOR-6 *(ADR finding — ADR 0026 is internally inconsistent, and the Builder took the safe reading)*

**Where:** ADR 0026 §4.1 and §4.4 versus §10.2 (all read at `75cae307`).

§4.1 says of `hook_type`: *"it is **collected … and shown**, never promoted"*, and §4.4 says *"A `hook_type`
whose opening did not survive the human edit is **excluded even from descriptive display**"* — both presuppose
a display surface. **§10.2's state table, which the ADR presents as exhaustive ("every one rendered and
tested"), contains no row for `hook_type` or `proof_type`.** The two obligations cannot both be met.

**What the Builder did.** Followed §10.2: nothing displays either dimension. `git grep` at head confirms
`hook_type` has no reader in `lib/` or `app/` outside comments and the constants file, and `hook_survived` is
**written and never read** — `lib/outcomes/measured.ts:52` computes it, `lib/outcomes/orchestrator.ts:189`
stores it, `lib/db/types.ts:1642` declares it, and there is no consumer.

**Why it matters.** The safer reading was chosen — nothing unvalidated is shown — but it was chosen silently:
ADR 0026 §V.5's "Deviations and decisions recorded during the build" lists three items and not this one. A
future session reading §4.1 will look for the display surface and find dead columns instead.

**What would prove it fixed.** Either §V.5, or a §4.1 amendment, records that descriptive display is deferred
and that `hook_survived` is stored for that future surface, naming its owner; or the surface ships and §10.2
gains its rows. Either way the ADR's two halves should agree.

---

### MINOR-7 — X's `return null` conflates "post deleted" with "this account can no longer read `public_metrics`", and the call site turns both into a benign skip

**Where:** `lib/social/twitter-provider.ts:467` (`if (!pm) return null`) and `lib/metrics/orchestrator.ts:81-84`
(`if (result === null) { summary.skippedNoData++; continue }`).

The method's own comment claims only the deleted-post reading. `public_metrics` is also absent when the token
or app tier stops returning the field — which ADR 0028 Amendment A A.5 concedes is unverified: *"the standard
partial-error shape — **not** confirmed against X's docs"*.

**Failure scenario.** X changes the entitlement. Every post returns `null` forever; `skippedNoData` climbs,
`errors` stays 0, Sentry is silent, no `post_metrics` row is ever written, and the outcome tick again records
`skippedNoMetrics`. Total, permanent loss of the only working metrics input is indistinguishable from "these
particular tweets were deleted".

**What would prove it fixed.** The live smoke recorded in A.5 confirms X's actual deleted-post response and the
two cases are distinguished — for example a present `errors[]` block becomes a captured `SocialProviderError`
while a truly absent resource stays `null` — with a Tier-2 test per shape. Until the smoke runs this cannot be
resolved from documentation, and saying so is the honest position.

---

### NIT-1 — ADR 0026's header still points at amendment letters that do not exist

`docs/decisions/0026-outcome-loop.md:9,12` (at `879737c7`) still read "**ADR 0016** — Amendment C" and
"**ADR 0017** — Amendment C". They landed as ADR 0016 **Amendment D** and ADR 0017 **Amendment E**. The
discrepancy **is** recorded — at §V.5 (`:1059-1060`) and in a note at the head of each target amendment — but
not in the header list a reader meets first. Fixed by updating the two header lines to "C → landed as D / E,
see §V.5".

### NIT-2 — The ECC budget cannot be fully audited from the range

Two invocations are declared in commit bodies: `ECC BUDGET 2 of 3 - ecc:database-reviewer` (`d7cbda3d`) and
`ECC BUDGET 3 of 3 - ecc:security-reviewer` (`fb28e6c6`). **No commit body contains "1 of 3"** or names a third
agent. The budget was therefore not exceeded (≤ 3 declared, 2 attributable), so this is process hygiene rather
than a defect: the first invocation should be named in a commit body like the other two, or the numbering
corrected to "1 of 3 / 2 of 3". `taste-skill` and `impeccable` are skills and are free.

### NIT-3 — `getEngagementSeed` does not filter the backfill run by status

`lib/db/post-outcomes.ts:172-179` takes the newest `social_backfill_runs` row for the business and platform by
`created_at DESC` with no predicate on the run's status. A failed or partially-completed run whose `summary`
already carries an `engagementBaseline` would seed a brand's X baseline. The basis guard
(`OUTCOME-SEED-BASIS-MATCH`) still applies and the row is stamped `import_seed`, so the seed is labelled and
disclosed — hence NIT. Adding `.eq('status', 'completed')` (or whatever ADR 0025's terminal state is) and a
Tier-2 case would close it.

---

## What I could NOT verify, and why

Stated plainly rather than guessed:

- **A live X metrics response.** No live call was made in this session and none was made in the build (ADR 0028
  Amendment A A.5). The `retweet_count` / `repost_count` conflict (A.2 #4) therefore remains unresolved from
  source — `api.x.com/2/openapi.json` returns HTTP 402 — and X's actual deleted-post shape is unconfirmed. This
  is the root of MINOR-7 and it cannot be closed by reading.
- **LinkedIn's readability under current scopes beyond the recorded citation.** I verified that no scope was
  added and that the cited pages say `r_member_social_feed` is restricted; I did not and could not test whether
  LinkedIn would in fact serve counts.
- **That the production cron actually runs daily.** ADR §12.3 records this as not deterministically testable by
  decision; the Sentry monitor is the control, and neither the QStash schedule nor the Sentry monitor exists in
  production yet (`docs/current-phase.md`).
- **Any predictive value of a promoted pattern.** Tier E has not run and cannot until roughly T0 + 150 days;
  T0 is undefined because no production OAuth app is registered. The pattern layer is empty in production.
- **The db-tests per-test retry counts.** The workflow runs with `--retry=2` and the skip-guard reports "zero
  failures"; the JSON artifact that would show whether any test passed only on a retry was not inspected, in CI
  or locally. "Zero failures" is the skip-guard's own statement, as ADR 0026 §V.6 already concedes.
- **Whether `app-tests` at head is green on a cold, first-attempt local run.** It is green in CI (4322/4322),
  and the one local failure (`corpus-v2-schema`) passes in isolation, is unchanged since before BASE, and is
  disclosed in two commit bodies as reproducing identically on the clean BASE. I did not bisect the
  interference.

---

Session 33 review complete - 12 findings (0 BLOCKER, 2 MAJOR, 7 MINOR, 3 NIT) over range 75cae307..879737c7; 34/34 non-E OUTCOME-* constraints verified executed green in CI (Tier-1 rows 18/18, Tier-2 rows 20/20, Tier-3 rows 8/8 re-verified); Tier E recorded not run.

---

## CORRECTION PASS (Session 33-D)

**Author:** Session 33-D correction pass · **Date:** 2026-09-20 · **Range fixed:** `879737c7..<D9-sha>`
**Reviewed head:** `879737c7` — the head the Reviewer read; only this pass's §4 and the report itself landed
after it, at D0 (`37aba2d4`).
**Founder adjudications consumed:** none — A-1…A-6 stand; MAJOR-1 option (b) was available and not taken
(build-guide §4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

### MAJOR-1 — the campaign page reads the outcome tables through the caller's client

- **Finding:** MAJOR-1.
- **Rule restored:** CLAUDE.md's three-client table ("`/lib/supabase/service.ts` … AI layer, webhook handlers,
  vault writes, scheduler — never imported into a Server Component or Client Component") and build-guide §0 L-9,
  verbatim: "**service-role never in a user-facing read path**". Option (b) (keep service-role and argue that the
  `businessId` filter suffices) was available and **not taken**; no founder ruling was needed or invented.
- **Fix:** `lib/db/campaign-retrospectives.ts` (`getCampaignRetrospective`, `listCampaignPostStates`,
  `getFrozenBriefContent`, `listCampaignOutcomeCellSources`) and `lib/db/memory-performance.ts`
  (`listOutcomePatterns`) now take `client: SupabaseClient` first; `lib/outcomes/campaign-view.ts`
  `loadCampaignLearningView(client, …)` threads it to all six calls; `campaigns/[id]/page.tsx` passes the
  authenticated anon client it already had. The generation and worker callers keep service-role through **separate
  named functions over the same query body**: `listOutcomePatternsForGeneration` (`lib/memory/outcomes.ts`, both
  retrievers), `listCampaignPostStatesForWorker` and `getFrozenBriefContentForWorker` (`lib/outcomes/retrospective.ts`).
  There is no optional client that defaults to service-role.
- **One call site beyond the six, stated openly:** `retrospective-actions.ts` also called
  `getCampaignRetrospective`, a user-facing Server Action that already held the session client. Leaving it on a
  service-role sibling would have needed a fifth named function for a read the user's own policy can serve, so it
  now passes the session client. Its ownership re-check (`getCampaignById(client, …)` then the `business_id`
  comparison) is unchanged and runs first; `acknowledgeRetrospective`'s write stays service-role because the three
  tables grant `authenticated` no write privilege.
- **Proof:**
  - NEW Tier-1 `supabase/__tests__/outcome-campaign-view-rls.test.ts` — positive control as a member of A
    (`:73`, both tests), then as an authenticated member of B handed A's business and campaign ids: zero rows from
    `campaign_retrospectives` (`:95`), `post_outcomes` (`:99`), `post_dimensions` (second hop issued directly with
    A's real ids, `:105-111`, since a non-leaking first hop never reaches it), `posts` (`:115`), `campaign_briefs`
    (`:116`), `performance_memory` active and candidate (`:120-121`), and the composed
    `loadCampaignLearningView` (`:124-129`).
  - Tier-2 `lib/outcomes/__tests__/no-cross-business.test.ts` — the recording client is now handed to the page
    readers (`:34`, `:59-69`) and the three new siblings are entries in `CALLS`, so the completeness check covers
    them; the enumerated list was **updated to the new names, not widened**.
  - `lib/db/campaign-retrospectives.test.ts:73-` — a page reader queries through the client it is handed
    (service-role acquired 0 times), and each `ForWorker` sibling acquires it and runs the same body.
  - `supabase/__tests__/outcome-wrappers.test.ts:30` — pins the shapes: `listOutcomePatternsForGeneration.length`
    is 1, `listOutcomePatterns.length` is 2.
  - `app/[locale]/(dashboard)/campaigns/[id]/retrospective-actions.test.ts:80` — the retrospective is read through
    the session client. The file's other tests changed only in that the session stub now serves the row (`:53-67`);
    no expectation was loosened.
- **Reddening:** in one reader at a time, the passed client was replaced with
  `(await import('@/lib/supabase/service')).createServiceRoleClient()`; each went RED naming its table, and the file
  was restored from a byte copy (`cmp` clean) before the next.

  | Reader swapped to service-role | RED, verbatim |
  |---|---|
  | `getCampaignRetrospective` | `campaign_retrospectives leaked across tenants: expected { …(18) } to be null` (and the composed view) |
  | `listOutcomePatterns` | `performance_memory (active) leaked across tenants: expected [ { …(30) } ] to deeply equal []` |
  | `listCampaignPostStates` | `posts leaked across tenants: expected [ { …(4) }, … ] to deeply equal []` (and the composed view's `dueAt`) |
  | `getFrozenBriefContent` | `campaign_briefs leaked across tenants: expected { hypothesis: 'Proof posts win' } to be null` |
  | `listCampaignOutcomeCellSources` | `post_outcomes leaked across tenants: expected [ Array(4) ] to deeply equal []` |

  Not mutated: the `post_dimensions` assertion (the reader cannot reach it under a non-leaking first hop, so the
  test queries it directly; a swap in `listCampaignOutcomeCellSources` leaks `post_outcomes` first) and the
  `retrospective-actions.ts` one-line change (its test asserts the session stub was queried; it was not
  separately reddened).
- **`security-reviewer` (once, after the plan, before the commit):** no BLOCKER, MAJOR or MINOR. It confirmed
  the six tables each carry a member-scoped `FOR SELECT TO authenticated` policy with no role or column
  restriction, so a legitimate member is neither emptied nor over-served. Two NITs, **reported and not actioned**
  (out of this pass's scope, L-1): (1) `listOutcomesForCampaign`, `listCampaignRetrospectives` and
  `listCampaignsAwaitingRetrospective` are still service-role without a `ForWorker` name — their only non-test caller
  is the worker; (2) it checked the migrations for `GRANT`/`REVOKE` but not column-level grants, which the
  positive control would expose.
- **Loop at this state:** `tsc` clean; `lint` 0 errors (110 pre-existing warnings); `test:app` 4327 of 4328, the one
  failure being `lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts`, the named pre-existing order-dependent
  flake, which passes in isolation (5/5); `test:db` 80 files / 681 tests green; `check-adr0018-unchanged.ts` exit 0.
- **Commit:** D1 — SHA recorded at D9 close-out (a commit cannot name itself).
- **What I did NOT touch:** the `.eq('business_id', …)` filters and the source / status / `deleted_at` predicates
  (OUTCOME-NO-CROSS-BUSINESS); the enumerated export list was updated, not widened.
