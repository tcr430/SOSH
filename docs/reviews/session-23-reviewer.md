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
