# Session 23 — Governed Memory Foundation (ADR 0016) · REVIEWER report

## Scope reviewed (PROC-REVIEW-AT-COMMIT — CLAUDE.md / ADR 0015 §6)

**Commit range read: `f688fc54^..708fe468`** — five commits:

| SHA | Step | Subject |
|---|---|---|
| `f688fc54` | B0 | governed-memory tables + RLS + erasure cascade |
| `8e1c14c2` | B1 | `lib/db` candidate-query layer |
| `cc084d31` | B2 | `lib/memory` scored + hard-capped retrieval boundary |
| `45632d81` | B3 | rewire `recentPostPerformance` through `lib/memory` |
| `708fe468` | B4 | `runner.ts` context split, cached-stable vs uncached-retrieved |

Every citation below comes from that range via `git show <sha>:<path>` and
`git diff f688fc54^..708fe468`. **Nothing was read at HEAD.**

### Declared out-of-range reads (Session 22-F NEW-12 exception)

`docs/decisions/0016-governed-memory.md` and `docs/build-guide/session-23.md` **do not exist at any
commit in the reviewed range** — `git ls-tree 708fe468 -- docs/decisions/` returns `0001`–`0015`
only. Both are untracked working-tree files. The specification this review audits against is
therefore read from the **working tree**, not from git. This is disclosed rather than silent, and is
itself recorded as BLOCKER-2 below: the NEW-12 exception covers a *findings document* written after
its range, not a *governing ADR* that was supposed to be committed before the Builder started.

### SHARED-FUNCTION CALLERS — `buildCustomerContext` (CLAUDE.md)

`git grep buildCustomerContext 708fe468` — **five production call sites**, plus the barrel:

| # | Caller (at `708fe468`) | Does behaviour-equivalence hold? |
|---|---|---|
| 1 | `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts:44` | ⚠️ Inherits 10→3 performance narrowing. `post-generation.ts:153-154` **does** render `recentPostPerformance` — model input materially changes. No caller-level test. |
| 2 | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:268` | ⚠️ Same as #1 (regeneration path). Additionally loses `recentCampaigns` + `recentPostPerformance` from the model's view via B4 — `post-regeneration.ts` renders neither. No caller-level test. |
| 3 | `app/[locale]/(dashboard)/onboarding/infer-brand-voice/actions.ts:27` | ⚠️ `brand-voice-inference.ts` renders `ctx.business.*` only; B4 removes `brandVoice`/`recentCampaigns`/`recentPostPerformance`/`trialState` from the model's view. No caller-level test. |
| 4 | `app/[locale]/(dashboard)/settings/voice/refine-from-posts-action.ts:42` | ⚠️ Same class as #3. No caller-level test. |
| 5 | `lib/campaigns/generate.ts:83` | ⚠️ Only caller passing `voiceVariationId`. Variation resolution is untouched by the rewire (verified in the `context.ts` diff), so voice equivalence holds; performance narrowing still applies. No caller-level test. |
| — | `lib/ai/index.ts:2` (re-export) | n/a |

**Verdict on the rule: not satisfied.** Every equivalence test added in B3 exercises
`buildCustomerContext` directly (`lib/ai/context.test.ts`). **Zero of the five callers has a test
covering the rewire.** One function proven is not five callers proven — the exact shape of Session
22's BLOCKER-1/2.

`lib/memory/` has **one** production consumer: `retrievePerformancePatterns`, imported at
`708fe468:lib/ai/context.ts:8`. `brand.ts`, `evidence.ts`, `audience.ts`, `voice.ts` have **zero**
non-test callers at this range.

---

## Findings table

| § | Check | Status | File:Line (at range) | Note |
|---|---|---|---|---|
| A1 | RLS enabled, `get_user_business_ids()` SELECT, USING+WITH CHECK on UPDATE | ✅ authored | `f688fc54:supabase/migrations/20260719010000_governed_memory.sql` | All 4 tables; InitPlan-wrapped `= ANY (SELECT unnest(...))` post-017 form; 4 policies each; UPDATE carries both clauses. |
| A1 | Cross-tenant SELECT/INSERT/UPDATE denied, **executed live** | ❌ | `f688fc54:supabase/__tests__/governed-memory-rls.test.ts` | Test is genuine Tier-1 (real `pg.Client` + anon `signInWithPassword`), asserts 0 rows / error / row-unchanged / tenant-tunnel-blocked. **Never executed — see BLOCKER-1.** |
| A2 | No service-role leak into user-facing read path | ⚠️ | `708fe468:lib/ai/context.ts:36`, `8e1c14c2:lib/db/memory-*.ts` | The *only* production read path is service-role (`createServiceRoleClient()`), so **RLS is bypassed in production**; tenancy rests on a single `.eq('business_id', businessId)`. ADR §4 sanctions this, but RLS is defense-in-depth here, not the live guard. |
| A2 | No raw token / PII in new stores | ✅ | migration `f688fc54` | No token columns. `evidence_memory` may hold third-party quote PII — correctly annotated and cascade-scoped. |
| B1 | All 4 tables in §D2.5 **and** cascade-wired | ✅ | `f688fc54:docs/decisions/0010-legal-surface.md:1066-1069` | All four `ON DELETE CASCADE` from `businesses`; §D2.5 rows read `CASCADE / yes / none — cascade = erasure`. Doc and DDL agree. **No GDPR leak.** |
| C1 | `>cap → exactly cap, highest-scored kept` | ✅ | `cc084d31:lib/memory/scoring.test.ts:158-170` | 7 candidates → cap 5; asserts `toHaveLength(5)` **and** exact survivor identity/order `['c-7'…'c-3']`. Reddens if cap mutated up. Best-tested surface in the session. |
| C1 | Cap enforced on the *production* path | ⚠️ | `45632d81:lib/ai/context.test.ts` (perf-cap case) | `expect(...).toBeLessThanOrEqual(3)` **passes at 0** — see MAJOR-2. |
| C2 | Scoring orders by ADR function | ✅ | `cc084d31:lib/memory/scoring.ts` | `0.5·conf + 0.3·recencyDecay + 0.2·scopeMatch`, weights named in `constants.ts`. Explicit deterministic tie-break (conf, then recency) rather than relying on sort stability. Throws on non-finite recency rather than scoring 0. |
| C2 | Every query has `limit` + index-matching `ORDER BY` | ✅ | `8e1c14c2:lib/db/memory-*.ts`; `…20260719020000_governed_memory_recency_column.sql` | `.order('confidence',desc).order('recency_at',desc).limit(MEMORY_CANDIDATE_LIMIT=50)` exactly matches `(business_id, confidence DESC, recency_at DESC) WHERE deleted_at IS NULL AND status='active'`. The generated-column migration exists precisely so PostgREST can name the COALESCE — correct call. |
| C3 | Voice read through existing tables | ✅ | `cc084d31:lib/memory/voice.ts` | No `voice_memory` table in either migration. Reads `brand_voices` + `brand_voice_variations`. |
| C3 | No duplicated voice logic | ⚠️ | `cc084d31:lib/memory/voice.ts:12-14` | Self-documented as mirroring `context.ts` "exactly, so B3's rewire can call this instead of duplicating it" — **B3 never called it.** Two sources of truth. See MAJOR-3. |
| D1 | `CustomerContext` shape unchanged | ✅ | `git diff … lib/ai/context.ts` | The `export type CustomerContext` block is untouched by the diff; pinned by a new 5-key assertion test. No field added/removed/retyped. |
| D2 | No existing case edited to pass | ⚠️ ratified | `45632d81:lib/ai/context.test.ts` (`limit=10`→`limit=3`) | Exactly one assertion changed. ADR §6.2 + the constraint table (`MEM-CONTEXT-EQUIVALENT`: *"existing cases green (bar the §6.2 count)"*) pre-authorise it. Legitimate — **but the ratifying ADR is uncommitted** (BLOCKER-2), so the authorisation is unverifiable at any commit. |
| D3 | All callers get equivalent context | ⚠️ | see caller table above | 5 callers, 0 caller-level tests; B4 additionally narrows model-visible input for callers 2–4. |
| E1 | No direct table access outside the boundary | ✅ | `git grep` over `app/ components/ lib/` | Only hits are `lib/db/memory-*`, `lib/memory/*`, `lib/db/types.ts:589` (type defs), and comment/test strings in `lib/ai/context*`. Clean. |
| E2 | Consumers import from `lib/memory/index.ts` | ✅ | `708fe468:lib/ai/context.ts:8` | `import { retrievePerformancePatterns } from '@/lib/memory'` — barrel, not `@/lib/memory/performance`. |
| F1 | No worker / Mode 2 / rubric / mining / route / Stripe / UI | ✅ | full `--name-status` diff | 33 files: 2 migrations, 2 `supabase/__tests__`, `lib/db/memory-*`, `lib/memory/*`, `lib/ai/{context,runner}`, `lib/db/types.ts`, `0010-legal-surface.md`. No `app/`, no `components/`, no route, no worker. L-1 held cleanly. |
| F2 | No `any`, no `console.*`, config/date-fns discipline | ✅ | diff scan | `any` appears only as `let admin: any` in `supabase/__tests__` — the CLAUDE.md carve-out (2), with the required eslint-disable. No `console.*`. `process.env` only inside `supabase/__tests__` (house style; env is exported by `db-tests.yml`). `scoring.ts` uses `differenceInDays` from date-fns. |
| F3 | Four §0.1 questions resolved in ADR **and** obeyed | ✅ | ADR (working tree) §3.1-3.6, §5.2-5.3, §5.1 | **Q1** brand/evidence/audience/performance ship; voice through existing tables; relationship deferred — migration matches exactly. **Q2** embeddings deferred, deterministic conf+recency+scope score — no `pgvector` anywhere in the range. **Q3** confidence `numeric(3,2)` 0–1 + `observation_count >= 1` (the "one data point ≠ fact" rule, structurally). **Q4** reads route through `lib/db/memory-*.ts` — B1 implements precisely this. All four resolved, named, and obeyed. |
| G1 | Every MEM-* → test → executing CI job | ❌ | see coverage section | Wiring correct; **no job has ever run this range.** |

---

## BLOCKER

### BLOCKER-1 — The entire range has never executed in CI. Every MEM-* constraint is `AUTHORED-NOT-EXECUTED`.

`origin/session-22-d` is at `64c466ec` ("close 22-G NEW-13/NEW-14"). **The five Session 23 commits
are unpushed.** `gh run list` shows the most recent runs dated **2026-07-17**, all titled *"Session
22-D: correction pass"* — three days before this range was authored. There is no run to point at for
any commit in `f688fc54^..708fe468`.

ADR 0015 §2, quoted in CLAUDE.md: *"'Covered' = executed green in CI, never 'authored.'"* By that
definition every constraint in this session — including `MEM-RLS-ISOLATED`, the BLOCKER-class tenancy
property — is currently uncovered. A local green run, if the Builder performed one, is explicitly not
coverage under the rule this project adopted precisely to stop that substitution.

The wiring itself is correct and worth stating: `test:db` = `vitest run supabase/__tests__`
(`708fe468:package.json:19`) globs the new files with no registration step;
`db-tests.yml` `pull_request.paths` includes `supabase/**` and `lib/db/**`, both touched; the
skip-guard (`assert-no-empty-suite.mjs`) runs `if: always()`. Nothing needs building — it needs
**running**.

> **Fix:** Push `f688fc54^..708fe468` and open the PR. Require **both** `app-tests` and `db-tests`
> green on this exact range before merge. In the `db-tests` run, confirm from the log that
> `governed-memory-rls.test.ts` and `governed-memory-recency-column.test.ts` each report a non-zero
> executed count (the skip-guard covers this, but read it). Paste the two run URLs into the
> correction report. Additionally, update the `db-tests` promotion tally at
> `708fe468:docs/current-phase.md:44` (currently **0 of 3**) with this run's outcome — note that
> until it reaches 3/3, `db-tests` remains **advisory**, so a green run here does not yet block a bad
> merge and a red one must be read by a human rather than assumed transient.

### BLOCKER-2 — ADR 0016 and the build guide are untracked; the constraint checklist exists at no commit.

`git ls-tree 708fe468 -- docs/decisions/` returns `0001`–`0015`. `docs/decisions/0016-governed-memory.md`,
`docs/build-guide/session-23.md`, and `docs/brainstorm/` are untracked; `docs/current-phase.md` is
modified but uncommitted.

Consequences that are not merely tidiness:

1. Source comments across the range cite `ADR 0016 §2`, `§3.4`, `§5.4`, `§6.2`, `§7` as binding
   authority for decisions a reviewer must check — including the **one pre-authorised test-assertion
   change** (D2). That authorisation is unfalsifiable at any commit.
2. §0 of the build guide requires the ADR be *"written and Accepted"* before the Builder starts, and
   §1 gates all later phases on it. Whether that gate was honoured cannot be established from git.
3. A future reviewer running `git show <sha>:docs/decisions/0016-governed-memory.md` gets nothing.
   The Session 22-F NEW-12 exception permits reading a *findings document* outside its range; it does
   not permit a *governing ADR* to be absent from the range it governs.

> **Fix:** Commit `docs/decisions/0016-governed-memory.md`, `docs/build-guide/session-23.md`, and the
> `docs/current-phase.md` update as a `docs(adr):` commit. Ideally rebase it to sit **before**
> `f688fc54` so the range reads spec-then-implementation; if history is not to be rewritten, commit it
> on top and state in the correction report that the ADR post-dates the code it governs. Also commit
> `docs/brainstorm/` or add it to `.gitignore` — leaving it untracked indefinitely is the ambiguity
> that produced this finding.

---

## MAJOR

### MAJOR-1 — B4 removes context from the model's view for three of four prompt templates, and the test offered as proof cannot fail.

`708fe468:lib/ai/runner.ts` deletes `const userContextMsg = JSON.stringify(context)` and its message
block. The justifying comment claims: *"no prompt template reads a field that isn't already rendered
through one of these two functions."*

That is true of the **template code** and false of the **model's input**. Before B4, all five
`CustomerContext` fields reached the model on every call via the dump. After B4, each prompt receives
only what it explicitly renders. Re-derived per template at `708fe468`:

| Template | Renders | **Lost from model input by B4** |
|---|---|---|
| `prompts/post-generation.ts` | business, brandVoice, recentCampaigns, recentPostPerformance | `trialState` |
| `prompts/post-regeneration.ts` | business (`:41-56`), brandVoice (`:97`) | **`recentCampaigns`, `recentPostPerformance`**, `trialState` |
| `prompts/brand-voice-inference.ts` | business only (`:75-84`) | **`brandVoice`, `recentCampaigns`, `recentPostPerformance`**, `trialState` |

Losing `trialState` is almost certainly desirable. Losing performance and campaign history from the
**regeneration** path — the path whose whole job is "produce a better version of this post" — is a
substantive change to generation behaviour, adopted under a comment asserting it is *"not a behaviour
change."* L-8 explicitly binds this fix under L-7.

The test cited as proof is inert, and its own comment says why:

```
it('generation output is fixture-identical after removing the dump (bounds the change to L-7)')
// MockAnthropicClient-style flows route on _sosh.promptId/model, not on
// message content, so the parsed OUTPUT is unaffected by what rides in
// the request
```

A test whose subject is *unaffected by the change by construction* proves nothing about equivalence.
It would stay green if B4 had deleted the entire user message. `MEM-RUNNER-CACHE-SPLIT`'s third proof
clause ("fixture-identical output") is therefore **not coverage**. Its other two clauses — no JSON
dump present, stable/retrieved slices don't cross the cache boundary — are genuine and do redden.

> **Fix (two parts).** (a) Delete or rewrite the "fixture-identical" case; replace it with an
> assertion over the **request** actually sent per prompt — for each of the three templates, assert
> which `CustomerContext` fields appear in `system[0].text` + `messages[0].content[0].text`, so the
> loss above is pinned as intentional and any future drift reddens. (b) Adjudicate the regeneration
> loss with the founder before merge: either render `recentPostPerformance`/`recentCampaigns`
> explicitly in `post-regeneration.ts`'s `buildUserMessage` (restoring equivalence), or record in ADR
> 0016 §7 that the narrowing is accepted and why. Do not leave it resolved only by a code comment
> asserting no change occurred.

### MAJOR-2 — The production-path cap assertion passes when the value is zero.

`45632d81:lib/ai/context.test.ts`, case *"recentPostPerformance never exceeds PERFORMANCE_CAP (3),
even when the underlying source returns more"*: feeds 6 metrics/posts, then asserts only

```js
expect(ctx.recentPostPerformance.length).toBeLessThanOrEqual(3)
```

`0 <= 3`. The test stays green if the rewire returns an empty array — which is the **most likely**
regression in this design, given `performance.ts` has an early `if (topMetrics.length === 0) return []`,
a `.filter()` that drops metrics with no matching post, and a `.filter()` that drops governed rows
with `platform === null`. Any of those silently emptying the result is invisible to this test.

`scoring.test.ts` proves the cap property rigorously (C1 ✅) — but on `rankAndCap` in isolation, not
on the path `buildCustomerContext` actually takes, which for the fallback branch does **not** go
through `rankAndCap` at all (it uses `.slice(0, PERFORMANCE_CAP)` at `45632d81:lib/memory/performance.ts`).
The production truncation is thus guarded only by the weak assertion.

> **Fix:** Change to `expect(ctx.recentPostPerformance).toHaveLength(3)` and additionally assert the
> identity of the retained three (e.g. the post ids), so both "never more than cap" and "never
> silently fewer" are pinned. Mirror the `scoring.test.ts:158-170` pattern, which already does this
> correctly.

### MAJOR-3 — Four of five `lib/memory` modules have no production consumer, and `voice.ts` duplicates live logic it was written to replace.

At `708fe468`, `lib/memory/index.ts` exports five retrievers. Only `retrievePerformancePatterns` is
imported by anything outside tests. `brand.ts`, `evidence.ts`, `audience.ts` and `voice.ts` are
dead code at this range.

For `brand`/`evidence`/`audience` this is defensible: ADR §10 names ADR 0017 as their consumer, and
shipping the read side ahead of it is Track A's stated purpose. Worth stating plainly in the report,
not silently shipping.

`voice.ts` is different and is the real finding. Its own header (`cc084d31:lib/memory/voice.ts:12-14`)
says it *"mirrors the resolvedBrandVoice logic in lib/ai/context.ts:87-96 exactly, so B3's rewire can
call this instead of duplicating it."* B3 rewired only `recentPostPerformance`;
`708fe468:lib/ai/context.ts` still resolves voice inline. The result is **two implementations of voice
resolution** that must now be kept in step by hand — including the variation-override branch that
caller #5 (`lib/campaigns/generate.ts:83`) depends on. That is the precise failure mode the
`lib/social` boundary rule exists to prevent, and the duplication was introduced by the commit that
documented its own intention to remove it.

> **Fix:** Either (a) complete the intent — have `buildCustomerContext` call `retrieveVoice` from
> `@/lib/memory` and delete the inline resolution, keeping the existing voice-variation tests green
> (they already cover the branch, `context.test.ts` "voice variation read-through"); or (b) delete
> `lib/memory/voice.ts` and its test, and let ADR 0017 introduce it when a consumer exists. **(a) is
> the better call** — it is small, the tests already exist, and it discharges `MEM-VOICE-THROUGH-EXISTING`'s
> Tier-2 clause against the live path rather than an unused one. Do not leave both copies.

### MAJOR-4 — The 10→3 performance narrowing reaches five callers; none is tested.

Covered in the caller table. The count change is ADR-ratified (D2 ✅) and the *cap* is sound
discipline, but "ratified" addresses whether it was allowed, not whether it was verified where it
lands. `post-generation.ts:153-154` renders `recentPostPerformance` into the prompt, so all
generation paths now present the model with at most 3 prior posts instead of up to 10 — a 70%
reduction in performance evidence, unmeasured.

> **Fix:** Add one Tier-2 test per generation caller (minimum: `lib/campaigns/generate.ts` and
> `campaigns/[id]/posts/actions.ts`) asserting the assembled prompt contains at most 3 performance
> entries and that the entries are the highest-scoring ones. Then list, per caller, which test file
> exercises it — the SHARED-FUNCTION CALLERS enumeration this report opens with should be reproducible
> from the tests, not only from `git grep`.

---

## MINOR

### MINOR-1 — Production tenancy rests on one `.eq()`, not on RLS.
`708fe468:lib/ai/context.ts:36` uses `createServiceRoleClient()`, which bypasses RLS; the only guard
on the memory read is `.eq('business_id', businessId)` in `8e1c14c2:lib/db/memory-*.ts`. ADR §4
sanctions this and the migration comment states it explicitly, so it is not a defect — but the
excellent RLS suite proves a property that **no production code path currently exercises**. A dropped
`.eq()` in a future edit would leak cross-tenant memory with every RLS test still green.
> **Fix:** Add a Tier-2 test per `lib/db/memory-*.ts` asserting `.eq('business_id', …)` is present on
> the built query (the existing `lib/db/memory-*.test.ts` mocks already make this cheap). Note the
> service-role/`.eq()` dependency in ADR 0016 §4 as a named risk.

### MINOR-2 — Governed performance rows inject literal `likes: 0, impressions: 0` into prompts.
`45632d81:lib/memory/performance.ts` maps governed rows to `{ likes: 0, impressions: 0 }`, and
`post-generation.ts:153-154` renders those numbers. Once Track C populates `performance_memory`, the
model will read distilled insights annotated *"0 likes, 0 impressions"* — plausibly interpreted as
evidence the pattern performs **badly**, inverting the intent. Self-documented as a placeholder.
> **Fix:** Make the numerics optional on `PerformancePattern` and have `post-generation.ts` omit the
> metrics clause when absent, or carry `observation_count` as the credibility signal instead. At
> minimum, record it as a named un-defer trigger in ADR 0016 §3.4 so ADR 0018 cannot ship on top of it
> unnoticed.

### MINOR-3 — `platform: null` governed rows are silently dropped and can under-fill the cap.
Same file: rows with a null platform are filtered out before ranking. The reasoning (never guess a
platform) is right, but the schema permits `platform IS NULL` deliberately, so a business whose
distilled patterns are all cross-platform gets **zero** performance context with no signal anywhere.
> **Fix:** Either widen `PerformancePattern.platform` to `Platform | null` and let the template render
> "across platforms", or add a test pinning the drop as intentional plus a Sentry breadcrumb when
> candidates were dropped for this reason.

### MINOR-4 — `brand`/`evidence`/`audience` retrieval tests are thin (3 cases each).
Versus 9 for `performance`. `MEM-SCOPED-RETRIEVAL` and `MEM-CONFIDENCE-GATED` lean almost entirely on
`scoring.test.ts` covering the shared `rankAndCap`. That is legitimate reuse, but the per-type modules'
own wiring (right candidate function, right cap constant) is barely pinned — a copy-paste passing
`EVIDENCE_CAP` into `brand.ts` would not redden.
> **Fix:** One test per module asserting the correct cap constant is applied (feed cap+1 candidates,
> assert exact length per type).

---

## NIT

- **NIT-1** — The recency-column migration (`20260719020000`) drops and recreates four indexes created
  minutes earlier in `20260719010000`. Neither has shipped to any environment. Squashing them would
  leave a cleaner permanent record. Low value; do not rewrite history solely for this.
- **NIT-2** — `let admin: any` in both `supabase/__tests__` files is fully compliant with the CLAUDE.md
  carve-out (2) and carries the required eslint-disable. Noted as **compliant**, not as a defect.
- **NIT-3** — `lib/memory/index.ts`'s header comment reads *"consumers (today: nothing — B3 wires
  retrievePerformancePatterns and retrieveVoice into lib/ai/context.ts)"*. Stale in two ways at
  `708fe468`: there is now one consumer, and `retrieveVoice` was never wired (MAJOR-3). Update when
  fixing MAJOR-3.

---

## Constraint coverage (ADR 0016 §9 checklist, re-derived)

"Reddens if broken?" is judged by mutating the property mentally against the assertion text, not by
trusting the test's name.

| Constraint | Tier | Test (at range) | Executing CI job | Ever run? | Reddens if broken? |
|---|---|---|---|---|---|
| **MEM-RLS-ISOLATED** | 1 | `governed-memory-rls.test.ts` — 4 tables × {SELECT 0 rows, INSERT error, UPDATE no-op w/ confidence unchanged, tenant-tunnel business_id unchanged, DELETE row survives} | `db-tests` | ❌ **never** | ✅ yes — real anon clients, real cross-tenant rows; dropping a policy fails it. |
| **MEM-CASCADE-COMPLETE** (T1) | 1 | same file, *"deleting a business cascades its governed-memory rows"* | `db-tests` | ❌ **never** | ✅ yes — asserts 0 rows across all four tables post-delete. |
| **MEM-CASCADE-COMPLETE** (T3) | 3 | §D2.5 rows present, `0010-legal-surface.md:1066-1069` | n/a (diff-verified) | ✅ verified here | n/a — correctly enumerated as Tier-3. |
| **MEM-SCOPED-RETRIEVAL** | 2 | `lib/memory/{brand,evidence,audience,performance}.test.ts` + `scoring.test.ts` (`isEligible`, `scopeMatch`) | `app-tests` | ❌ **never** | ⚠️ partial — strong at `scoring.ts`, thin per-type (MINOR-4). |
| **MEM-HARD-CAP** | 2 | `scoring.test.ts:158-170` (7→5, exact survivors) | `app-tests` | ❌ **never** | ✅ **yes** — mutating the cap upward changes both length and survivor list. The session's strongest test. |
| **MEM-HARD-CAP** (production path) | 2 | `context.test.ts` perf-cap case | `app-tests` | ❌ **never** | ❌ **no** — `toBeLessThanOrEqual(3)` passes at 0 (MAJOR-2). |
| **MEM-CONFIDENCE-GATED** | 2 | `scoring.test.ts:102-123` (candidate/retired/expired excluded, boundary exclusive) | `app-tests` | ❌ **never** | ✅ yes — per-status cases with distinct expectations. |
| **MEM-BOUNDED-QUERY** | 2 | `lib/db/memory-*.test.ts` | `app-tests` | ❌ **never** | ⚠️ partial — `limit`/`order` asserted; `.eq('business_id')` not (MINOR-1). |
| **MEM-VOICE-THROUGH-EXISTING** | 2+3 | T3: no voice-memory migration ✅ (verified). T2: `voice.test.ts` | `app-tests` | ❌ **never** | ⚠️ T2 exercises an **unused** module (MAJOR-3) — green tells you nothing about the live path. |
| **MEM-CONTEXT-EQUIVALENT** | 2 | `context.test.ts` — 5-key shape ✅, existing cases green bar §6.2 ✅, perf ≤ cap ❌ | `app-tests` | ❌ **never** | ⚠️ shape clause reddens; cap clause does not; **caller equivalence untested** (MAJOR-4). |
| **MEM-RUNNER-CACHE-SPLIT** | 2 | `runner.test.ts` — no dump ✅, slices don't cross ✅, fixture-identical ❌ | `app-tests` | ❌ **never** | ⚠️ first two redden genuinely (incl. a good `cache_control` boundary test padded past the threshold); third **cannot fail by construction** (MAJOR-1). |
| **MEM-NO-DIRECT-TABLE-ACCESS** | 3 | grep guard | n/a (diff-verified) | ✅ verified here | n/a — correctly Tier-3; grep is clean. |

**Summary: 10 constraints. 2 Tier-3 verified in this review. 8 Tier-1/Tier-2 constraints have tests
and correctly-wired jobs, and 0 have ever executed.**

---

## G2 — Before / after: what reaches a generation prompt

| | Before (`f688fc54^`) | After (`708fe468`) |
|---|---|---|
| **`recentPostPerformance` source** | `listTopPostMetrics(client, businessId, 10)` → join `listPostsByIds` → map. Unscored, unranked, up to **10** entries, ordered only by whatever the metrics query returned. | `retrievePerformancePatterns(client, businessId, {})`. Prefers `performance_memory` (ships empty ⇒ fallback today); fallback is the same metrics→posts join capped at **`PERFORMANCE_CAP = 3`**, with a defense-in-depth `.slice(0, 3)`. Governed branch scores by `0.5·conf + 0.3·recency + 0.2·scope` and truncates via `rankAndCap`. |
| **Prompt payload per call** | `messages[0].content` = **two** text blocks: `JSON.stringify(context)` (all 5 fields, verbatim, **uncached**) **+** `buildUserMessage(input, context)`. Stable context therefore rode the uncached slice on **every** call. | `messages[0].content` = **one** block: `buildUserMessage(...)`, uncached. Stable content rides `system[0]` with `cache_control: ephemeral` above `CACHE_CONTROL_CHAR_THRESHOLD`. |
| **Net effect on the model's view** | Every prompt saw all 5 context fields regardless of its template. | Each prompt sees only what it renders: `post-generation` loses `trialState`; `post-regeneration` additionally loses `recentCampaigns` + `recentPostPerformance`; `brand-voice-inference` additionally loses `brandVoice`. |
| **Contract** | `CustomerContext` — 5 fields. | `CustomerContext` — **same 5 fields, same types.** Unchanged. |

The token economics are a real win and the cache split is correctly implemented. The unmeasured part
is the third row: less evidence reaches the model on three of four templates, and no test observes it.

---

## VERDICT

**Is governed retrieval tenancy-isolated?** *Designed yes, proven no.* The migration is the strongest
artefact in the session — correct post-017 InitPlan-wrapped policies on all four tables, `USING` +
`WITH CHECK` on every UPDATE, indexes that exactly match the queries written against them, and an RLS
suite that probes real cross-tenant clients including the tenant-tunnelling case. **None of it has
ever executed.** And the sole production read path is service-role, so in the running system RLS is
defense-in-depth behind a single `.eq()`.

**Is it hard-capped?** *Yes at the core, unproven at the edge.* `rankAndCap` is genuinely well-built —
explicit deterministic tie-break, loud failure on bad cap or bad timestamp, defense-in-depth
eligibility filtering — and `scoring.test.ts:158-170` is exactly the >cap fixture the discipline
requires. The production path's own cap assertion is the one that can't fail.

**Is the rewire behaviour-equivalent?** *For `CustomerContext`, yes — the contract is genuinely
untouched, and that is the L-7 clause that mattered most.* For what reaches the model, **no**: B3
narrows performance evidence 10→3 across five untested callers (ratified), and B4 removes context
fields from three of four templates (**not** ratified — asserted in a comment, and the test offered as
proof is structurally incapable of failing).

**Blockers before merge:** BLOCKER-1 (push and get both CI jobs green on this exact range; every
constraint is `AUTHORED-NOT-EXECUTED` until then) and BLOCKER-2 (commit ADR 0016 + the build guide;
the §6.2 authorisation and the whole MEM-* checklist currently exist at no commit). Neither requires
code changes — both are the difference between "written" and "landed", which is the distinction ADR
0015 exists to enforce.

**Should also be fixed in the correction pass:** MAJOR-1 (adjudicate the regeneration context loss;
replace the inert test), MAJOR-2 (one-line assertion tightening), MAJOR-3 (wire `retrieveVoice` in or
delete it — do not ship two voice resolvers), MAJOR-4 (caller-level equivalence tests).

**Deferrable debt:** all MINORs and NITs. MINOR-2 should be recorded as a named un-defer trigger in
ADR 0016 §3.4 before ADR 0018 starts, since Track C populating `performance_memory` is exactly what
makes the `likes: 0` placeholder start reaching real prompts.

**Overall.** The schema, cascade, scoring core, and module boundary are well-executed and disciplined
— L-1 scope was held with no drift, all four §0.1 questions were resolved in the ADR and obeyed, and
the `lib/social`-style boundary is clean under grep. The session's weakness is uniform and singular:
**properties asserted in comments rather than pinned by tests that can fail**, on top of a range that
has never run. That is the same class of gap as Sessions 21C/22, arriving through a different door.

---

*Reviewed by: independent Reviewer session, 2026-07-20. Range `f688fc54^..708fe468`. No files were
modified by this review. Correction prompts are out of scope for this document (§4).*

---
---

## Correction pass resolutions (Session 23-D)

> *Appended by Session 23-D, author of the fixes below.* **Every finding above is UNMODIFIED** — no
> verdict was edited, downgraded, or stamped RESOLVED in place; not one character above this heading
> was changed. This section records how each finding was corrected; **the Reviewer's assessment stands
> as written.** Where this section disputes a finding, it argues the point here and leaves the original
> claim standing.
>
> **Author:** Session 23-D correction pass (Claude Opus 4.8, founder-directed) · **Date:** 2026-07-20
> **Fixing:** the findings above, Reviewer range `f688fc54^..708fe468`
> **Governed by:** CLAUDE.md *REVIEWER-REPORT APPEND-ONLY* · build guide §4.

### Ordering rationale — why a BLOCKER runs last

Steps run **D0 → D1 → D2 → D3 → D4 → D5**, deliberately *not* "BLOCKERs first":

- **BLOCKER-2 leads (D0).** It is a commit of governing docs. Nothing depends on it, and every later
  step cites the ADR it lands.
- **BLOCKER-1 closes (D5).** Its fix instruction is *"push and get both CI jobs green on this exact
  range"* — unsatisfiable until the range is **final**. Running it first would certify a range that
  D1–D4 then invalidate, producing a green run that proves nothing about what ships.

**Not a downgrade of BLOCKER-1.** It is the only order in which its fix is meaningful.

### Resolution table

Every finding above gets a row — including the deferred and declined ones. An unexplained gap between
the findings and the resolutions is what makes the trail unreadable later (§4.2).

| Finding | Step | Fix | Test that now proves it | SHA |
|---|---|---|---|---|
| **BLOCKER-2** — ADR 0016 + build guide + `current-phase.md` + `brainstorm/` untracked; the MEM-* checklist and the §6.2 authorisation exist at no commit | D0 | Committed all four paths, plus this report, as one `docs(adr):` commit. History **not** rewritten — disclosure below. | n/a (docs; Tier-3 diff-verified — `git status` shows no untracked `docs/` paths) | `5edb090d` |
| **MINOR-2** (doc half) — `likes: 0 / impressions: 0` inverts meaning once Track C populates the store | D0, **corrected D3** | Named **un-defer trigger** in ADR 0016 §3.4. **At D3 the finding's premise was found to be factually wrong and the note was corrected** — see the erratum below. Trigger kept, severity downgraded, owner unchanged (ADR 0018), and a second guard added for ADR 0017. | n/a (doc-only; code half deferred) | `5edb090d`, `33afb06e` |
| **MINOR-1** (doc half) — production tenancy rests on one `.eq()`, not RLS | D0 | **Named risk** in ADR 0016 §4. The existing note framed the service-role split as *intended*; this records what it *costs* — a dropped `.eq()` leaks cross-tenant with every RLS test still green. | n/a (doc-only; Tier-2 half deferred to Session 24) | `5edb090d` |
| **MAJOR-2** — `toBeLessThanOrEqual(3)` passes at 0 | D1 | Assertion replaced with **exact length + survivor identity**; one case added per silent-empty path performance.ts has. Identity is pinned via `topContent` (`PerformancePattern` carries no post id). `3` written **literally**, not imported as `PERFORMANCE_CAP` — importing it would make the assertion self-fulfilling and survive a cap mutation. | `lib/ai/context.test.ts` — *"recentPostPerformance is EXACTLY the cap (3) — the top-ranked three, never silently fewer"*, plus 4 path cases. **Redden verified by mutation, not asserted:** `PERFORMANCE_CAP`→5 ⇒ 2 fail; `performance.ts`→`return []` ⇒ 7 fail. Both reverted. | `66e66517` |
| **MAJOR-3** — two voice resolvers; `voice.ts` duplicates live logic it was written to replace | D2 | Took the Reviewer's option (a). `buildCustomerContext` now calls `retrieveVoice` **through the barrel**; the inline copy at `context.ts:78-87` is deleted, along with the three imports only it used. `retrieveVoice` moved **into** the existing `Promise.all`, so the variation fetch is no longer a sequential round-trip after it — same calls, same arguments. `CustomerContext.brandVoice` shape unchanged (`CoreVoiceRules` is structurally identical to `BrandVoiceContext`), so L-7 holds. | `lib/ai/context.test.ts` — **all 9 voice cases pass UNCHANGED** (file byte-identical to D1; that is the equivalence proof). **Live-path dependency proven by mutation:** forcing `retrieveVoice` to return `null` reddens **10** cases, incl. the variation-override and the §3.3 cross-tenant defense. Reverted. | `f17760f3` |
| **MAJOR-1a** — the "fixture-identical" test cannot fail by construction | D3 | **Deleted**, with a tombstone comment recording why it was inert. Replaced by per-template assertions over the **request actually sent**, using the **real** templates (the existing `mockPrompt` echoes `input.text` and never touches the context, so it could not serve). Sentinel values per context field make presence/absence unambiguous. | `lib/ai/runner.test.ts` — 4 new cases, one per template + a no-raw-dump case. **Redden verified by mutation:** suppressing the `recentPostPerformance` render in `post-generation.ts` ⇒ exactly 1 failure. Reverted. | `33afb06e` |
| **MAJOR-1b** — `post-regeneration` lost `recentCampaigns` + `recentPostPerformance` from the model's view | D3 | **Founder-adjudicated: RESTORED.** Both are now rendered explicitly in `post-regeneration.ts`'s `buildUserMessage`, invoking ADR 0016 §7's own escape hatch verbatim. This makes B4's "not a behaviour change" claim **true** and keeps the two post-writing templates comparable. `trialState` (all three) and `brandVoice` on `brand-voice-inference` **accepted as removed** — see §7.1 for why each. Recorded as an **ADR amendment (§7.1)**, not only a code comment. | `lib/ai/runner.test.ts` — *"post-regeneration sends business + brandVoice + recentCampaigns + recentPostPerformance, but NOT trialState"* | `33afb06e` |
| **MAJOR-4** — 10→3 narrowing reaches 5 callers; 0 caller-level tests | D4 | Added caller-level Tier-2 tests for **all 5** callers (the step's minimum was 2). The existing suite for each caller **mocks `buildCustomerContext`** — which is precisely why none covered the rewire; the new files keep `buildCustomerContext` + `runPrompt` **real** and mock only `lib/db` beneath + the Anthropic client above, asserting on the **assembled prompt**, not the context object. | See per-caller table below. **Redden verified:** `PERFORMANCE_CAP`→5 reddens 4 of the 6 generate.ts cases. Reverted. | `beed6010` |
| **BLOCKER-1** — the range has never executed in CI; 8 Tier-1/2 constraints `AUTHORED-NOT-EXECUTED` | D5 | Pushed the full B0–B4 + D0–D4 range to PR #1 (head `f022e08f`). **Both CI jobs `success`:** `app-tests` (tsc+eslint+vitest) and `db-tests` (live-Postgres RLS). The 8 constraints are now **EXECUTED green in CI**, not merely authored. | Both runs recorded in the D5 subsection below. `db-tests` skip-guard confirms all **13** `supabase/__tests__` suites *visible (non-zero executed)* — incl. `governed-memory-rls` + `governed-memory-recency-column`. app-tests [`29860240035`](https://github.com/tcr430/SOSH/actions/runs/29860240035), db-tests [`29860240741`](https://github.com/tcr430/SOSH/actions/runs/29860240741). | `f022e08f` (range head) |
| **MINOR-1** (Tier-2 half) — no test pins `.eq('business_id')` on the built query | — | **Deferred to Session 24**, not fixed here. Doc-side risk note landed at D0. | none — deferred, recorded as a decision | — |
| **MINOR-3** — `platform: null` rows silently dropped, can under-fill the cap | (D1) | **Still deferred to ADR 0017** — no behaviour change. But D1 **pinned the current behaviour**, including the degenerate case the Reviewer implies: when *every* governed row is platform-less the result is `[]` and the `post_metrics` fallback is **not** reconsidered. The deferral is now safe: changing it reddens a test and forces an explicit decision. | `lib/ai/context.test.ts` — *"excludes governed rows with a null platform…"* and *"returns empty when every governed row is platform-less, without falling back to post_metrics"* | `66e66517` |
| **MINOR-4** — brand/evidence/audience tests thin; wrong cap constant would not redden | — | **Deferred to ADR 0017**, when those modules gain real consumers. | none — deferred | — |
| **NIT-1** — squash the two migrations | — | **Declined.** The Reviewer itself says do not rewrite history for this. | n/a | — |
| **NIT-2** — `let admin: any` | — | **No action — not a defect.** The Reviewer records it as compliant with the CLAUDE.md carve-out (2). | n/a | — |
| **NIT-3** — stale `lib/memory/index.ts` header | D2 | Header rewritten: names `lib/ai/context.ts` as the consumer of both `retrievePerformancePatterns` and `retrieveVoice`, and states plainly that brand/evidence/audience are **unwired by design** (ADR §10 → ADR 0017). Also fixed a second stale comment the Reviewer did not flag: `voice.ts`'s header still said it existed so "B3's rewire can call this instead of duplicating it" — now records that it is the sole implementation and warns against reintroducing a copy. | n/a (comments) | `f17760f3` |
| **MAJOR-3, second half** — `brand`/`evidence`/`audience` have no production consumer | D2 | **Not fixed — deliberately left unwired**, per the Reviewer's own assessment that this is defensible. Wiring them into `CustomerContext` would add contract fields = an L-7 STOP, and ADR 0016 §6.3 forbids it in Track A. **Stated plainly rather than shipped silently**, as the Reviewer asked: three of five `lib/memory` modules ship with zero production callers, awaiting ADR 0017. | Tier-2 tests exist per module; no production path exercises them (MINOR-4 notes the tests are thin — deferred to ADR 0017) | `f17760f3` |

---

### D0 — BLOCKER-2, plus the doc halves of MINOR-1 and MINOR-2

#### Disclosure: ADR 0016 post-dates the code it governs

The Reviewer offered two remedies: rebase the ADR to sit before `f688fc54`, or commit on top and
disclose. **History was not rewritten** — the five B0–B4 commits are already authored and cited by SHA
throughout this report, and rebasing would invalidate every one of those citations.

The consequence, unsoftened: **`git show <any-B-sha>:docs/decisions/0016-governed-memory.md` returns
nothing.** Source comments across B0–B4 cite `ADR 0016 §2 / §3.4 / §5.4 / §6.2 / §7` as binding
authority — including the one pre-authorised test-assertion change (`limit=10`→`limit=3` in
`lib/ai/context.test.ts`, ratified by §6.2). **At the commits where those citations were written, the
authority they cite did not exist in git.** From `5edb090d` forward it does. A reader auditing the
B-range in isolation cannot verify the §6.2 authorisation and must read the ADR at D0 or later.

Whether the §1 phase gate (*"ADR written and Accepted before the Builder starts"*) was honoured
**cannot be established from git**, and is not claimed here.

#### What was committed (`5edb090d`)

| Path | Prior state | Note |
|---|---|---|
| `docs/decisions/0016-governed-memory.md` | untracked | The governing ADR. +2 amendments (below). |
| `docs/build-guide/session-23.md` | untracked | §0 Locked, §0.1's four questions, §4's step list. |
| `docs/current-phase.md` | modified | See note — **not** a Session 23 change. |
| `docs/brainstorm/` | untracked | Committed, not gitignored — three build-guide sections cite it **by path** as the ADR's source. |
| `docs/reviews/session-23-reviewer.md` | untracked | **Added beyond D0's literal list** — see below. |

**Two departures from D0's literal instruction, flagged rather than made silently:**

1. **This report was added to the commit.** §4.1's D0 text names four paths and omits the Reviewer's
   own report, which was also untracked. Committing the work order while leaving the report that *is*
   the work order untracked would reproduce BLOCKER-2 in miniature; Session 22-G set the precedent
   (NEW-15, *"track findings docs"*).
2. **`docs/current-phase.md`'s diff is not Session 23 work.** It is a two-line Session 22 prose tidy
   (removing a stale reference to `21C-ci-gap` / `21C-pg-oom`, already closed by Session 22 W1). It
   carries the `db-tests` promotion tally that **D5** will update; the tally is untouched at D0 and
   still reads **0 of 3**.

#### ADR amendments made in this step

1. **§3.4 — un-defer trigger (MINOR-2).** Records that `performance.ts` maps governed rows to literal
   `likes: 0, impressions: 0`, that `post-generation.ts:153-154` renders them verbatim, and that this
   is **inert only while the table ships empty**. ADR 0018 populating `performance_memory` is exactly
   what makes the placeholder reach real prompts, where "0 likes, 0 impressions" plausibly reads as
   evidence the pattern performs *badly* — inverting the store's intent. Two resolution options
   recorded (optional numerics with an omitted metrics clause, or `observation_count` as the
   credibility signal). Owner: ADR 0018.
2. **§4 — named risk (MINOR-1).** §4 already documented the service-role/RLS-bypass split as
   *intended*. That note explains the architecture but never states the **failure mode**, which is what
   MINOR-1 asks for: isolation rests on a single `.eq('business_id', …)` per query, the Tier-1 RLS
   suite proves a property **no production path currently exercises**, and a future edit dropping that
   `.eq()` leaks cross-tenant memory into a generation prompt **with every RLS test still green**.
   Tier-2 mitigation deferred to Session 24 as a recorded decision.

#### Erratum to MAJOR-1 (non-material, raised by the correction pass)

MAJOR-1's heading reads *"three of four prompt templates"*. Re-deriving independently from
`lib/ai/prompts/*.ts`: there are **three** templates — `post-generation.ts`, `post-regeneration.ts`,
`brand-voice-inference.ts` (`types.ts` is type-only). All three lose something, so the accurate
statement is *"all three of three"*.

**The finding stands unaltered and its substance is confirmed.** The per-template render sets were
re-derived from source in this pass and match the Reviewer's table exactly, including that `trialState`
is read by **no** template and that `post-regeneration.ts` renders neither `recentCampaigns` nor
`recentPostPerformance`. Only the count in the prose heading is off by one. Per condition 4 of the
append-only rule, the Reviewer's text is left exactly as written and the correction is argued here.

#### Verification

- `git log` shows `5edb090d`; `git status` shows no untracked `docs/` paths.
- No `.ts` / `.sql` file touched in this step.

---

---

### D3 — MAJOR-1, and a correction to MINOR-2

#### Erratum: MINOR-2's premise is factually wrong (and so was my own D0 note)

**Raised by the correction pass, founder-approved for correction. The finding above is left exactly as
the Reviewer wrote it (append-only condition 1); this is the argument against it.**

MINOR-2 states that `lib/memory/performance.ts` maps governed rows to `likes: 0, impressions: 0` and
that **`post-generation.ts:153-154` renders those numbers**, so once Track C populates
`performance_memory` the model reads insights annotated *"0 likes, 0 impressions"* and infers the
pattern performs badly. **The template does not do this.** The render at that location is:

```js
const perfList = ctx.recentPostPerformance.map(p => `- ${p.topContent}`).join('\n')
```

Only `topContent` reaches the prompt. `grep -n "likes\|impressions" lib/ai/prompts/*.ts` matches
**nothing** outside a test fixture — no template renders either number, in any of the three. **The
prompt-corruption risk as described does not exist, and did not at any commit in the reviewed range.**

**My D0 entry repeated the claim as established fact** ("`post-generation.ts:153-154` renders them
verbatim"), which it is not. That was my error, not the Reviewer's alone: I wrote an ADR amendment on
an unverified premise instead of reading the render. Corrected in ADR 0016 §3.4 at `33afb06e`.

**What survives.** The zeroes remain a **latent type-shape trap**: `PerformancePattern` requires
`number`, so every governed row invents a value it does not have. A future template that adds a
metrics clause — plausible for ADR 0017, which wants richer pattern context — would activate the
inversion silently. So the trigger is **kept and downgraded**, with a second guard added: ADR 0017 must
not add a metrics clause while the placeholder stands.

#### The MAJOR-1 adjudication in one line

`post-regeneration` **restored** (both fields); `trialState` **accepted as removed** from all three;
`brand-voice-inference` losing `brandVoice` **accepted and desirable**. Full reasoning in ADR 0016
§7.1 — the point being that it is resolved by an ADR amendment, not by a code comment asserting no
change occurred, which is how the problem arose.

#### Observation, not fixed (out of scope, L-1)

The fields restored to `post-regeneration` are passed through `sanitizeDataField`, matching that
file's local convention for `[DATA]` content (the control added after the delimiter-injection issue in
Session 9D). **`post-generation.ts` does not sanitise the same fields** — `recentCampaigns[].name`,
`[].objective` and `recentPostPerformance[].topContent` are interpolated raw into `[DATA]` blocks
there. Campaign names and objectives are user-supplied. This is a pre-existing inconsistency in a file
D3 was not asked to change, so it is **recorded rather than fixed**; it belongs to whoever next audits
prompt-injection surface.

---

### D4 — the caller enumeration, reproduced FROM THE TESTS (not `git grep`)

The build guide requires the SHARED-FUNCTION CALLERS table be reproducible from the tests. Each of the
five production callers of `buildCustomerContext`, and the test file that now exercises it through the
**real** rewired path:

| # | Caller | Kind | Test file (real `buildCustomerContext` + `runPrompt`) | What it pins |
|---|---|---|---|---|
| 1 | `lib/campaigns/generate.ts` | generation | `lib/campaigns/generate.context-equivalence.test.ts` (6 cases) | perf capped at 3 in the **prompt**; highest-ranked three; metrics queried at 3 not 10; **voice VARIATION** override → descriptor in prompt (only caller passing `voiceVariationId`); governed-memory preferred over fallback, still capped; no trialState/dump leak |
| 2 | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts` (`regeneratePostAction`) | generation | `…/posts/actions.context-equivalence.test.ts` (5 cases) | perf capped at 3 + highest-ranked; metrics at 3; **recentCampaigns + recentPostPerformance present (D3/MAJOR-1b restore)**; base voice in prompt; no leak |
| 3 | `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts` (`startGenerationAction`) | non-generation | `…/(dashboard)/context-callers.context-equivalence.test.ts` (cases 3.x) | context assembles + reaches success branch (⇒ voice resolved non-null via lib/memory); metrics queried at 3 |
| 4 | `app/[locale]/(dashboard)/onboarding/infer-brand-voice/actions.ts` (`inferBrandVoiceAction`) | non-generation | `…/(dashboard)/context-callers.context-equivalence.test.ts` (cases 4.x) | assembles + no throw; **business only** in prompt (voice NOT leaked into inference), §7.1 narrowing holds |
| 5 | `app/[locale]/(dashboard)/settings/voice/refine-from-posts-action.ts` (`refineFromPostsAction`) | non-generation | `…/(dashboard)/context-callers.context-equivalence.test.ts` (cases 5.x) | assembles + no throw; business only (same template as #4) |

**Zero callers remain `AUTHORED-NOT-EXECUTED` for the rewire.** All five have a listed, executing
test file — the enumeration above is derived from those files, not from `git grep`.

**Why new files rather than extending the existing suites.** Each caller already has a suite
(`generate.test.ts`, `posts/actions.test.ts`, `refine-from-posts-action.test.ts`), and **each mocks
`buildCustomerContext`** — correct for testing the caller's own orchestration, wrong for observing the
rewire. Rather than unpick those mocks (which the orchestration tests depend on), each new
`*.context-equivalence.test.ts` sets up the opposite seam: real context + real runner, mocked `lib/db`
and SDK. The two suites are complementary, not redundant.

### Deferred, carried not dropped (build guide §4.4)

| Item | Disposition |
|---|---|
| MINOR-1 (Tier-2 `.eq('business_id')` assertions per `lib/db/memory-*.ts`) | **Session 24.** Doc-side risk note landed at D0. |
| MINOR-2 (`likes: 0` placeholder) | **Un-defer trigger in ADR 0016 §3.4 at D0.** Owner: ADR 0018. |
| MINOR-3 (`platform: null` rows silently dropped) | **ADR 0017**, which owns the retrieval consumers. |
| MINOR-4 (brand/evidence/audience tests thin) | **ADR 0017**, when those modules gain real consumers. |
| NIT-1 (squash the two migrations) | **Declined** — Reviewer says do not rewrite history for this. |
| NIT-2 (`let admin: any`) | **Not a defect** — compliant with the CLAUDE.md carve-out (2). |
| NIT-3 (stale `lib/memory/index.ts` header) | **D2.** |

### Process note — the rule changed mid-pass, and D0 got it wrong first

Recorded because the git history of this pass is otherwise confusing to a later reader.

D0 initially created a separate `docs/reviews/session-23-D-corrections.md`, per CLAUDE.md's then-current
*REVIEWER-REPORT IMMUTABILITY* rule. The founder rejected the split as unreadable — the problem and its
fix were never visible together — and directed that resolutions live in the Reviewer's own file,
amending CLAUDE.md if needed.

**CLAUDE.md was therefore revised, not overridden.** The rule is now *REVIEWER-REPORT APPEND-ONLY*: the
Reviewer's **findings** stay immutable (condition 1 — no in-place edit, ever), while the **file** is
append-only via one attributed section (condition 2). The property the old rule protected —
**attributable authorship, and findings that cannot be silently mutated** — is fully preserved; only
the file-separation mechanism changed. The Session 22-D failure the rule was written against (RESOLVED
verdicts written *into* finding text) remains a violation under condition 1.

**Two process defects in D0 itself, recorded rather than quietly repaired:**

1. **`5edb090d` committed a build guide the pass had not read.** `docs/build-guide/session-23.md` was
   edited in the working tree between D0's read of it and D0's `git add`. The committed version already
   said *"append to the reviewer report, do NOT create a separate corrections file"* — the opposite of
   the version D0 had read and acted on. D0 staged it without re-reading. **Lesson: re-read a file
   between reading it and committing it if any time has passed** — a stale read produced a commit whose
   own instructions contradict the actions in that same commit.
2. **`docs/reviews/session-23-D-corrections.md` was created and committed at `5edb090d`, then deleted.**
   Its content is folded into this section. It exists in history at exactly one commit; it is not a
   parallel record and must not be resurrected.

Build guide §4, §4.0, D0, D5 and §4.2 now specify this file as the sole destination for resolutions.

### D5 — BLOCKER-1: the range executed green in CI

The whole session moves from **AUTHORED** to **COVERED** here, and only here. D5 ran last so it would
certify the *final* range — the five B0–B4 commits **plus** D0–D4 — not an intermediate one that the
later steps would invalidate.

**What was done.** The full local stack (`f688fc54..f022e08f`, 14 commits) was pushed to
`origin/session-22-d`, updating the existing **PR #1** (retitled to name both sessions —
founder-directed; a new PR was not viable because Session 22 is unmerged and Session 23 is stacked
directly on it). Both required workflows fired on the `pull_request` event — `db-tests`'s path filter
matches `supabase/**` + `lib/db/**`, which B0 (migration) and B1 (candidate-query layer) both touch.

**Both jobs green on head `f022e08f`:**

| Job | Run | Result |
|---|---|---|
| `app-tests` (tsc + eslint + vitest) | https://github.com/tcr430/SOSH/actions/runs/29860240035 | ✅ success |
| `db-tests` (ADR 0013 live-Postgres RLS/migration suite) | https://github.com/tcr430/SOSH/actions/runs/29860240741 | ✅ success |

**Non-zero executed counts — read from the log, not assumed.** D5's instruction is explicit that a
suite a flag empties to zero tests is a FALSE-GREEN, so the two governed-memory suites had to be
confirmed as actually executing. The `db-tests` run's **skip-guard** step printed:

> `skip-guard: 13 file(s) under [supabase/__tests__] all visible, zero failures — green.`

That is a machine-checked non-zero guarantee, and its semantics were read at source:
`scripts/ci/assert-no-empty-suite.mjs:76-77` **hard-fails the job** for any file whose
`assertions.length === 0` (*"ran zero tests — invisible — not covered"*), and `:82` fails if every test
in a file is skipped. `supabase/__tests__` contains **exactly 13** `*.test.ts` files, of which
`governed-memory-rls.test.ts` and `governed-memory-recency-column.test.ts` are two. "13 file(s) … all
visible" therefore means **each of the 13 — both governed-memory suites included — executed ≥1
non-skipped test**; a zero-count in either would have reddened `db-tests`, which was green. (The vitest
JSON reporter writes per-file counts to a runner-local `/tmp/db-results.json` that is not in the log
stdout; the skip-guard is the artefact that reads that JSON and is itself the proof.) The migration log
also shows both `20260719010000_governed_memory.sql` and `20260719020000_governed_memory_recency_column.sql`
applying cleanly on the fresh stack.

**Promotion tally — this run does NOT advance it, and that is correct.** The `CI-DB-SUITE-STABLE`
promotion rule counts **three consecutive full-green runs on `master`** (`docs/current-phase.md`,
ADR 0015 §5) — not runs on a PR branch. This green run is on `session-22-d` via the `pull_request`
event, so it leaves the tally at **0 of 3**. `db-tests` accordingly **remains ADVISORY**: this green run
is a pre-merge signal, it does **not** yet block a bad merge, and a RED `db-tests` here would have to be
**read by a human and classified** (DB-behaviour regression vs stack OOM), never assumed transient. The
tally will only begin to move when this range lands on `master` and the workflow runs there.

**BLOCKER-1 is closed:** the range is no longer `AUTHORED-NOT-EXECUTED` — it is executed green in CI,
with the Tier-1 RLS/cascade suites proven non-empty by the skip-guard.

---

## Correction pass 2 — deferred MINORs & NITs (Session 23-E)

> *Appended by Session 23-E, a second correction pass.* **Every finding above, and the entire Session
> 23-D section, is UNMODIFIED.** The Session 23-D pass deferred all MINORs/NITs (§4.4). This pass
> implemented them anyway, on founder direction — *"implement the Minor and NITs identified in the
> reviewer session as per the suggested fix, regardless of having been identified to defer."* Two of the
> findings turned out to be already-satisfied at the reviewed range; those are recorded as errata, with
> the Reviewer's original claim left standing as written.
>
> **Author:** Session 23-E (Claude Opus 4.8, founder-directed) · **Date:** 2026-07-21
> **Fixing:** MINOR-1..4, NIT-1..3 · **Code commit:** `6149535f` · reviewed artefacts read at that commit.
> **Governed by:** CLAUDE.md *REVIEWER-REPORT APPEND-ONLY*.

### Resolution table (MINORs & NITs)

| Finding | Fix | Test that now proves it | SHA |
|---|---|---|---|
| **MINOR-1** — production tenancy rests on one `.eq('business_id')`, not RLS; a future drop leaks cross-tenant with every RLS test still green | **Done, and the finding's test-side premise was an erratum** (see below). Added a **dedicated, single-purpose** tenancy test per `lib/db/memory-*.ts` asserting `.eq('business_id', …)`, so the guard is pinned by its own named case rather than incidentally inside the omnibus filter test. | `lib/db/memory-{brand,evidence,audience,performance}.test.ts` — *"scopes the read to business_id — the sole tenancy guard on this service-role query (MINOR-1)"* (4 files) | `6149535f` |
| **MINOR-2** — governed rows inject literal `likes: 0, impressions: 0`; a latent type-shape trap (per the D3 erratum, no template renders them today) | **Fixed.** `likes`/`impressions` made **optional** on `PerformancePattern` and `CustomerContext.recentPostPerformance`; the governed branch **omits** them rather than inventing `0`. The `post_metrics` fallback still carries real counts. ADR 0016 §3.4 trigger marked RESOLVED. | `lib/memory/performance.test.ts` — governed result has **no** `likes`/`impressions` keys (`not.toHaveProperty`); `lib/ai/context.test.ts` — governed expectation drops the zeroes | `6149535f` |
| **MINOR-3** — `platform: null` rows silently dropped, under-filling the cap for cross-platform-only businesses | **Fixed via the Reviewer's option (i), extended to render provenance** (founder-chosen). `platform` widened to `Platform \| null`; the governed branch **no longer drops** null-platform rows; both post-writing templates render each example's platform as provenance — `On {platform}: …` / `Across platforms: …` — so the model can calibrate tone across target platforms. | `lib/memory/performance.test.ts` + `lib/ai/context.test.ts` — cross-platform rows KEPT with `platform: null`; `lib/ai/prompts/post-generation.test.ts` — `"On linkedin: …"` and `"Across platforms: …"` render cases | `6149535f` |
| **MINOR-4** — brand/evidence/audience per-type tests thin; a wrong cap constant would not redden | **Suggested fix already present (erratum).** Each module already has a per-type cap test (feed `X_CAP + 3`, assert length `=== X_CAP`) at `lib/memory/{brand,evidence,audience}.test.ts`. The *residual* concern — a **swap** between constants wouldn't redden — is **inherent to `BRAND_CAP === EVIDENCE_CAP === AUDIENCE_CAP === 5`**: no behavioural test can distinguish equal-valued constants. Closing it needs distinct caps (a product decision) or an import-level check. **Left with ADR 0017**, when those modules gain consumers. | existing `brand/evidence/audience.test.ts` cap cases (unchanged) | — |
| **NIT-1** — squash the two migrations | **Declined**, as the Reviewer itself advised. Both migrations are committed **and pushed**; rewriting shared history for a cosmetic record is not worth it. | n/a | — |
| **NIT-2** — `let admin: any` | **No action — not a defect.** Compliant with the CLAUDE.md carve-out (2). | n/a | — |
| **NIT-3** — stale `lib/memory/index.ts` header | **Already fixed at D2** (`f17760f3`) — header names `lib/ai/context.ts` as the consumer of both retrievers and states brand/evidence/audience are unwired by design. | n/a (comment) | `f17760f3` |

### Errata (Reviewer claims left standing, argued here)

Two findings were already satisfied at `708fe468`; per append-only condition 4, the Reviewer's text is
not edited — the correction is argued here.

1. **MINOR-1 constraint-table claim** (line ~313): *"`limit`/`order` asserted; `.eq('business_id')`
   not."* It **was** asserted — `git show 708fe468:lib/db/memory-brand.test.ts` line 38 is
   `expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')`, and the same line exists in all
   four `memory-*.test.ts`. The finding's *risk* is real (a service-role read with RLS bypassed rests on
   one `.eq()`), which is why a dedicated named test was still added; but the specific "not asserted"
   claim is an erratum.
2. **MINOR-4** — the suggested fix (*"one test per module … feed cap+1, assert exact length per type"*)
   already existed as the *"never returns more than X_CAP"* case in each of the three module test files.
   What the finding's deeper wording implies — that a wrong-constant swap should redden — is not
   achievable while the three caps share the value `5`, and is recorded as such rather than papered over
   with a test that cannot fail for the reason it exists (the ADR 0015 anti-pattern).

### Behaviour change recorded (not silent)

MINOR-3's provenance render changes what reaches the model on the **live** `post_metrics` fallback path
(which ships today), not only the dormant governed path: performance snippets now carry an
`On {platform}: ` prefix. This is an information gain, accepted deliberately, and recorded as a
behaviour-change note under ADR 0016 §3.4 (RESOLVED block) so it is not mistaken for a silent drift.

**Verification:** RED confirmed pre-change (7 failing across the 3 behaviour files); GREEN 726 passing
(`lib/memory lib/ai lib/db lib/campaigns` + the two context-equivalence suites); `tsc --noEmit
--skipLibCheck` clean; eslint clean on all touched files.
