# Session 31 — Track H (ADR 0024, Generation quality core) — Reviewer report (H3)

**Scope reviewed: `05baf1d2..55b421ad`** (13 commits, H2.1 `bdcabf50` → H2.13 `55b421ad`). All citations of
source, tests, migrations and i18n are `git show <sha>:<path>` / `git diff 05baf1d2..55b421ad` at that
range, **never at HEAD**.

**Documents audited *against*, read at their own commits — stated separately, per Session 22-F NEW-12:**

| Document | Where I read it | Note |
|---|---|---|
| `docs/decisions/0024-generation-quality-core.md` | **working tree only — the file is UNTRACKED (`git status`: `??`) and exists at no commit** | see BLOCKER-2 |
| `docs/build-guide/session-31.md` | **working tree only** — last commit `0c79d118`, with **1,490 uncommitted added lines** (`git diff --stat`) covering §0.2, §2b and §3 | see BLOCKER-2 |
| `docs/decisions/0017-mode-2-upgrade.md` | `55b421ad` (Amendment D landed inside the range, at commit `55b421ad`); pre-amendment text at `05baf1d2` | — |
| `docs/decisions/0015-test-execution-and-ci-gates.md` §2 + Amendment B | `55b421ad` | unchanged in range |
| `docs/decisions/0010-legal-surface.md` §D2.5 | `55b421ad` (edited in range) | — |
| `docs/decisions/0022-promote-to-campaign-and-format-families.md` §11.3 | `55b421ad` | unchanged in range — see MAJOR-3 |
| `CLAUDE.md` test-execution-integrity section | `55b421ad` | unchanged in range |

**Verification I ran myself, not the Builder's report:**

- `npx tsc --noEmit --skipLibCheck` — **clean**.
- `npm run lint` — **0 errors**, 105 pre-existing warnings.
- `npm run test:app` with a bare shell — **3 files fail at import** (`lib/config.test.ts`,
  `lib/campaigns/generate.test.ts`, `lib/signals/orchestrator.test.ts`) on `lib/config.ts:271`'s
  `publicSchema.parse()`. Re-run with the exact env block `app-tests.yml` supplies:
  **257 files / 3621 tests, all passing.** An environment difference, not a defect.
- `npm run test:db` — **42 files failed, 1 test failed, 356 skipped**, every failure at
  `lib/config.ts:271` / `lib/supabase/service.ts:2`. This is a **stack/environment failure** (no local
  Supabase stack on this machine, no credentials exported), **not a DB-behaviour regression**, and it is a
  *different* failure from the known supautils SIGSEGV. I deliberately did **not** run `test:db` with
  `.env.local` loaded: those suites `createUser` / `insertBusiness` / `delete` against
  `phdqfrrkbvuuklvbigoh.supabase.co`, the **live linked project**, and `db-tests.yml` states it "never
  touches the linked remote Supabase project".
- **Live-project read-only SQL** (in place of the Tier-1 suite I would not run): `ai_budget_daily` exists,
  `signal_triage_budget` is gone, `ai_budget_daily_business_id_purpose_day_key UNIQUE (business_id,
  purpose, day)` exists, `reserve_ai_budget` / `reconcile_ai_budget` exist as `SECURITY DEFINER`,
  `reserve_triage_budget` / `reconcile_triage_budget` are gone, and all four score columns exist on
  `post_ai_originals`. Both migrations **are applied**.
- `git grep` of all five shared functions and their callers, at the range.
- CI: `gh run list --branch session-30-5-adr-0028` — see BLOCKER-1.

---

## Findings

### BLOCKER-1 — 0 of 29 constraints are executed green in CI; the branch was never pushed

**What is wrong.** `git rev-parse origin/session-30-5-adr-0028` = `05baf1d2`; `git rev-list --count
origin/session-30-5-adr-0028..55b421ad` = **13**. The newest CI runs on this branch are `pull_request`
runs dated **2026-09-06**, at or before `05baf1d2` — every run predates H2.1. **No `app-tests` run, no
`db-tests` run and no skip-guard line exists for any commit in this range.** I could not read a skip-guard
file/test count from a log because there is no log to read.

Under ADR 0015 and CLAUDE.md, *"covered" = executed green in CI, never "authored."* All 29 rows are
therefore `AUTHORED-NOT-EXECUTED` at the stated head, including the 18 Tier-2 rows that need only a push.

**Why it matters.** This is the exact tier of claim Session 28 shipped falsely and 28-D spent three
correction steps undoing. **The Builder did not make that mistake** — `docs/current-phase.md` at
`55b421ad` states it in its own words: *"0/29 are CI-executed-green, because CI has not run."* That is
compliance, and it is why this is a session-state blocker rather than an integrity finding.

**What would prove it fixed.** Push the range; an `app-tests` run **green at `55b421ad`** with a non-zero
skip-guard file/test count read from the log and cited by run URL. The four Tier-1 rows
(`QUAL-COST-CEILING-EXTENDED`, `QUAL-BUDGET-PURPOSE-ISOLATED`, `QUAL-PRO-DAILY-POST-CAP`,
`QUAL-SCORE-ERASURE`) stay uncovered until `db-tests` itself is green — the promotion tally is at **0/3
consecutive green `master` push runs**, and `pull_request` runs never move it.

---

### BLOCKER-2 — the ADR the whole session is built against exists at no commit

**What is wrong.** `docs/decisions/0024-generation-quality-core.md` is `??` in `git status` — **untracked,
never committed**, at `55b421ad` or anywhere in history (`git log --all -- <path>` is empty).
`docs/build-guide/session-31.md` is `M` with **1,490 uncommitted added lines** against its only commit
`0c79d118` — which is where §0.2's founder adjudications, §2b's fourteen Builder steps and §3's Reviewer
prompt live.

ADR 0024 §15 **MINOR-4** states the opposite in writing: *"Status `Accepted` while untracked and
unregistered → Registered in `docs/current-phase.md`; the ADR and its two companion doc edits are
committed together."* The `current-phase.md` registration landed; the ADR did not.

**Why it matters.** Thirteen commit messages, four migrations, ~3,500 lines of source and every one of the
29 constraint names cite `ADR 0024 §N` as their authority. At the range, that authority is a file on one
machine. PROC-REVIEW-AT-COMMIT is unsatisfiable for any future reader of this range, and A-1/A-2/A-3/A-4 —
four founder rulings, one of which contradicts a Locked pricing decision — are unrecoverable from git.

**What would prove it fixed.** Both files committed, with the ADR's `Scope reviewed` line and §15 left
byte-unchanged, and this report's range line amended in the correction-pass appendix to name the ADR's own
commit.

---

### MAJOR-1 — `temperature` is never asserted to reach the SDK, in either direction

**What is wrong.** `git show 55b421ad:lib/ai/runner.ts:167-168`:

```
...(prompt.temperature !== undefined ? { temperature: prompt.temperature } : {}),
```

`git grep -n temperature 55b421ad -- lib app components` returns **five** production hits (the factory
constant, its three uses, and this spread) and **four** test hits — all four in
`prompt-properties.frozen-table.test.ts` (which asserts the *prompt object's field*) and
`runner.test.ts:759-784` (the "declares BOTH" disjointness check, which reads prompt objects, never
`mockCreate.mock.calls`). **No test anywhere asserts that `temperature: 1.0` appears in the SDK params for
a native-generation prompt, or that the key is absent for a prompt that declares nothing.**

Contrast the sibling properties, both of which *are* covered at the SDK-params level:
`runner.test.ts:703-715` (maxTokens 4096 / override) and `runner.test.ts:799-812` (thinking sent and
omitted).

**Failure scenario.** Delete `runner.ts:167`. Every test in the repo stays green. Production silently
returns to provider-default sampling, N=3 draws three near-identical strings, the judge becomes decorative,
and the session's cost doubles for no quality effect — with `QUAL-SAMPLING-VERSIONED`,
`QUAL-SAMPLING-DEFAULT-PRESERVED` and `QUAL-N-CANDIDATE-COUNT` all still passing.

**Why it matters.** ADR §11 constraint 10 says `QUAL-SAMPLING-DEFAULT-PRESERVED` proves *"a prompt
declaring nothing produces byte-identical SDK params"* — half of that is unproven. And temperature 1.0 is,
in the ADR's own words (§2.4), *"the candidate-diversity lever; without it N=3 returns three near-identical
strings and the judge is decorative."* The single most load-bearing value in the session has no
end-to-end test.

**What would prove it fixed.** A `runner.test.ts` case in the shape of the thinking one: a prompt with
`temperature: 1.0` produces `mockCreate.mock.calls[0][0].temperature === 1.0`, and `mockPrompt` produces
params with **no** `temperature` key (`expect(callArgs).not.toHaveProperty('temperature')`).

---

### MAJOR-2 — the "runtime enumeration" of prompts is a hand-maintained import list, in both scans

**What is wrong.** `lib/ai/prompts/prompt-properties.frozen-table.test.ts:137-150`:

```
function collectPrompts(): Array<Prompt<unknown, unknown>> {
  return [ brandVoiceInferencePrompt, briefAssemblyPrompt, learningSummarizerPrompt,
           postGenerationPrompt, postRegenerationPrompt, rubricPrompt, studioSuggestionPrompt,
           createNativeGenerationPrompt('single'), createNativeGenerationPrompt('thread'),
           createNativeGenerationPrompt('carousel') ] as ...
}
```

`lib/scope-scans.test.ts`'s `QUAL-NO-NEW-AI-SURFACE` case (added at `55b421ad`) repeats the identical
ten-import list and asserts `new Set(ids).size === 10`. Neither walks `lib/ai/prompts/` on disk, and
neither derives the factory's families from the factory's own type.

The ADR asserts the opposite, twice, and makes it the *reason* for the design choice — §3.2: *"The scan
enumerates prompts by walking the exported `Prompt` objects plus the factory's three families, so **a new
prompt or a new family with no row fails**, which is the whole point of choosing a runtime scan over a
diff check."* The test file's own header comment repeats the claim verbatim.

**Failure scenario.** Add `lib/ai/prompts/foo.ts` exporting `fooPrompt` with `temperature: 0.3` and no
frozen row. `collectPrompts()` does not import it, `prompts` has length 10, every per-id assertion passes,
and `QUAL-NO-NEW-AI-SURFACE` passes too — an eleventh prompt family with unversioned sampling ships green,
which is precisely the state both constraints exist to make impossible. A fourth
`createNativeGenerationPrompt` family behaves identically.

This also invalidates the recorded reddening demonstration for `QUAL-NO-NEW-AI-SURFACE`
(`scope-scans.test.ts`'s comment: *"temporarily added an 11th entry to `collectPromptIds()`'s import
list"*) — adding an entry to the list is not the failure mode; adding a prompt **without** touching the
list is.

**Related, raised as an ADR observation rather than a separate finding:** even for the ten known ids, the
frozen table does not enforce "bump `version` in the same commit". Editing `temperature: 1.0 → 0.8` in the
factory *and* editing the table row to `0.8`, without touching `version`, passes. The table makes the
change **visible in a diff**, which is the `platform-map.frozen-table` precedent's real property — but
§3.2's sentence *"Changing any of those four without bumping that prompt's `version` in the same commit
fails the test"* over-claims what any frozen table can do.

**What would prove it fixed.** `collectPrompts()` derived from a filesystem walk of `lib/ai/prompts/**`
that imports each module and collects every export structurally satisfying `Prompt` (an `id`, a `version`,
a `modelKey`, an `outputSchema`), plus the factory driven off its own family union — with the
eleventh-prompt case demonstrated to redden.

---

### MAJOR-3 — an ADR 0022 constraint was retired in code with no ADR 0022 amendment

**What is wrong.** `git diff 05baf1d2..55b421ad -- lib/scope-scans.test.ts` **deletes** the entire
`MODE2-RUNNER-UNTOUCHED` describe block — the SHA-256 content pin on `lib/ai/runner.ts` and the "no fourth
`is*` predicate" assertion — replacing it with a comment explaining the retirement. The deletion is
correct on the merits: ADR 0024 §3.1/§6.4/§7 legitimately modify `runner.ts`.

But `MODE2-RUNNER-UNTOUCHED` is **ADR 0022's** constraint, not ADR 0017's. At `55b421ad`,
`docs/decisions/0022-promote-to-campaign-and-format-families.md:911` still reads:

```
| `RUNNER-UNMODIFIED` | 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`,
  `MODE2-RUNNER-UNTOUCHED`) | `lib/ai/runner.ts`'s content hash changes, or a fourth `is*(promptId)`
  predicate joins the three pre-existing ones. |
```

and `:927` lists it under "executable". `git diff --name-only 05baf1d2..55b421ad -- docs/decisions/`
returns only `0010-legal-surface.md` and `0017-mode-2-upgrade.md`. **ADR 0022 got no amendment.**
ADR 0024 §0's "Amends" list names ADR 0017 §7, `MODE2-HOOK-STANDALONE`, ADR 0021 §3.3/§3.4 and ADR 0018
§2.3 — **not ADR 0022** — so the retirement is also unauthorised by the ADR.

**Why it matters.** ADR 0022 §11.3 now names a test file that no longer contains the test. That is a false
green of exactly the shape ADR 0024 §4.4 was written to avoid for `MODE2-HOOK-STANDALONE` — *"quietly
leaving it green in the ADR 0017 table would be a false green."* The cited precedent
(`POSTS-DDL-UNMODIFIED`) was retired with a dedicated doc commit, `b6580b84` *"N2.13-D1: retire
POSTS-DDL-UNMODIFIED, superseded by ADR 0028's own posts DDL"*; this one was retired in a code comment
inside a source commit.

**What would prove it fixed.** An appended amendment on `docs/decisions/0022-...md` marking
`RUNNER-UNMODIFIED` **retired, superseded by ADR 0024 §3.1/§6.4**, naming the commit that deleted the
scan (`bdcabf50`), and stating what still guards the "no fourth `is*` predicate" half — which
`runner.test.ts:865` (`QUAL-TRIAL-UNIT-PER-POST`'s exact-skip-set case) does in fact still cover, and
which the amendment should say.

---

### MAJOR-4 — `withPostQueryContext` discards the campaign-level query context; `campaignId` reaches no prompt (ADR finding, §5.2b)

**What is wrong.** At `55b421ad`, `lib/campaigns/generate.ts:211-214` builds the campaign-level context:

```
const queryContext: MemoryQueryContext = { objective, audience, campaignId }
const ctx = await buildCustomerContext(businessId, campaign.voice_variation_id, queryContext)
```

then, for **every** entry (`generate.ts:322`):

```
const postCtx = await withPostQueryContext(ctx, { platform: entry.platform, role: entry.role })
```

and `lib/ai/context.ts:161-171` re-runs `retrievePerformancePatterns(client, ctx.business.id,
{ platform, role })` and **replaces** `recentPostPerformance` wholesale. `postCtx` — not `ctx` — is what
reaches `generateNativeContent` (`:331`) and the judge (`:373`). `ctx.recentPostPerformance` is consumed
nowhere else: `ctx` is otherwise read only for `.brandVoice`, `.trialState` and `.business.timezone`.

So the campaign-level retrieval is computed and thrown away once per generation, and **`campaignId` never
influences any prompt's context on the product's main generation path.** `lib/memory/scoring.ts:56-70`'s
`scopeMatch` is the only consumer of `campaignId`, and it is never called with one from production.

Compounding it: `scopeMatch` has **no `role` branch at all** — `scoring.ts`'s own added comment says so
(*"threaded through even though no MemoryScope value maps to it yet"*). So per-post conditioning reduces to
**`platform` alone**, and the two fields §5.1 added contribute, between them, nothing to ranking on the
generation path.

`QUAL-QUERY-CONDITIONED` does assert a real ranking difference — but its two ranking cases
(`lib/memory/performance.test.ts:259-286`) call `retrieveRelevant(client, 'biz-1', { campaignId })`
**directly**, bypassing the seam where the field is dropped. The plumbing case in `lib/ai/context.test.ts`
proves the third parameter reaches `retrievePerformancePatterns` — from `buildCustomerContext`, the call
whose result is discarded.

**This is an ADR finding, not a Builder finding.** §5.2b specifies the signature as
`withPostQueryContext(ctx, { platform, role })`; the Builder implemented it exactly. The defect is that
§5.2b's narrow signature silently un-does §5.1's stated purpose for `campaignId` — *"makes the existing
0.2 scope-match weight do work it currently cannot."* **It is a sixth defect in an ADR that already
carries five self-corrections**, and of the same class as §15's BLOCKER-2: a design that reads correct in
isolation and is wrong once the two halves are composed.

**What would prove it fixed.** Either (a) `withPostQueryContext` merges rather than replaces —
`{ ...campaignQueryContext, platform, role }`, threaded from the call site — with a `generate.test.ts`
case asserting `campaignId` survives to `retrievePerformancePatterns`; or (b) the ADR records explicitly,
with a reason, that per-post conditioning deliberately narrows to `platform` and that `campaignId`/`role`
are inert on this path. Either is acceptable; an ADR that claims one while the code does the other is not.

---

### MAJOR-5 — the recreated budget RPCs are EXECUTE-able by `anon` and `authenticated` on the live project

**What is wrong.** `supabase/migrations/20260909110000_ai_budget_daily_rename.sql` drops and recreates both
RPCs and issues, for each:

```
REVOKE ALL ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) TO service_role;
```

with a comment asserting *"a recreated SECURITY DEFINER function with no REVOKE is a privilege
escalation."* Read from the live linked project:

```
reserve_ai_budget    prosecdef=t  acl: postgres=X | anon=X | authenticated=X | service_role=X
reconcile_ai_budget  prosecdef=t  acl: postgres=X | anon=X | authenticated=X | service_role=X
```

Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE on new functions to `anon` and `authenticated`
**by name**. `REVOKE … FROM public` does not touch a named grant, so the REVOKE the ADR relies on is a
no-op against exactly the two roles that matter. `vault_delete_secret` on the same project shows the
correct end state (`postgres=X | service_role=X`), so the repo already knows how to do this.

**Failure scenario.** Any signed-in customer calls PostgREST `POST /rest/v1/rpc/reserve_ai_budget` with
`{p_business_id: <another tenant's uuid>, p_purpose: 'generation_posts', p_units: 15, p_cap: 15}`. The
function is `SECURITY DEFINER` with no caller check, and `ai_budget_daily` has no RLS policy at all, so the
row is written and that tenant's Pro daily post cap is exhausted for the UTC day. `reconcile_ai_budget`
lets them zero a competitor's counter instead.

**Scoping this honestly — it is NOT a Session 31 regression.** The superseded
`reserve_triage_budget` / `reconcile_triage_budget` used the identical `REVOKE … FROM public` pattern
(`20260807110000_mode3_triage_state.sql:154,189`), and `purge_business`, `upsert_signal_candidate` and
`get_user_business_ids` all carry the same `anon=X | authenticated=X` ACL today. This is a **pre-existing,
repo-wide** defect that the range inherited. It is reported here because this range (a) recreated both
functions, (b) attached a **customer-facing quota** to one of them, and (c) wrote a comment claiming the
re-issued REVOKE closes an escalation it does not close.

**What would prove it fixed.** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;` on both, a
re-read of `proacl` showing `postgres=X | service_role=X` only, and a Tier-1 case asserting an
`authenticated` client's `rpc('reserve_ai_budget', …)` is denied. The repo-wide sweep (`purge_business`
first) belongs in its own tracked piece of work, not in a Session 31 correction pass.

---

### MINOR-1 — reserved generation units leak when a mid-campaign reservation is refused

**What is wrong.** `generate.ts:305-320` reserves **one unit per entry, inside the entry loop**, and
`generate.ts:498` inserts the posts **after** the loop completes. `releaseGenerationPost` is called on
exactly one path: the 0-of-N hard fail (`generate.ts:344-347`). When entry *k*'s `reserveGenerationPost`
returns `null`, the function writes `error_code: 'daily_quota_exceeded'` and returns `postsCreated: 0` —
leaving the *k−1* units already reserved for entries the customer never received.

**Failure scenario.** A Pro business with 5 of 15 units left generates a 12-entry campaign. Entries 1–5
generate; entry 6's reservation is refused; the session fails with `postsCreated: 0`; 5 daily post units
are consumed and no post exists.

**Why it matters.** ADR §7.5a defines two outcomes — hard fail releases, success keeps. The mid-loop
denial is a third case it does not name, and `supabase/__tests__/ai-budget-generation-posts.test.ts` does
not cover it either.

**What would prove it fixed.** Either release every unit reserved so far on the `daily_quota_exceeded`
return, or reserve for the whole `roleSequence` up front in one call (`p_units = totalPosts`) — plus a
`generate.test.ts` case asserting `releaseGenerationPost` is called once per already-reserved entry when
entry 2 of 3 is refused.

---

### MINOR-2 — `QUAL-CONTEXT-CALLERS-UNCHANGED` is not asserted per call site

**What is wrong.** `git grep -n 'buildCustomerContext(' 55b421ad -- lib app` returns exactly **ten**
production call sites across **nine** files, with `lib/campaigns/brief.ts` holding two (`:111`, `:160`) —
the ADR §5.4 count is correct, and exactly one (`generate.ts:214`) passes a `queryContext`. Verified by
grep at the range, not from the ADR.

But the constraint's stated shape is *"asserts, **per call site**, that the arguments and the resulting
`CustomerContext` are unchanged for the nine."* Only call site 1 has an argument assertion
(`generate.context-equivalence.test.ts:291-298`, edited in range):

| # | Call site | Test that covers it | Asserts the args? |
|---|---|---|---|
| 1 | `lib/campaigns/generate.ts:214` | `generate.context-equivalence.test.ts:291` | **yes** — the one that passes a context |
| 2 | `lib/campaigns/brief.ts:111` (Stage A) | `lib/campaigns/brief.test.ts` | no — not distinguished from #3 |
| 3 | `lib/campaigns/brief.ts:160` (Stage B) | `lib/campaigns/brief.test.ts` | no — not distinguished from #2 |
| 4 | `lib/learning/summarize.ts:156` | `lib/learning/summarize.test.ts` | no |
| 5 | `lib/signals/triage/orchestrator.ts:125` | `lib/signals/triage/orchestrator.test.ts` | no |
| 6 | `…/campaigns/[id]/generate-action.ts:44` | `context-callers.context-equivalence.test.ts:188` ("caller 3") | no — exercises the real builder |
| 7 | `…/campaigns/[id]/posts/actions.ts:282` | `posts/actions.test.ts` | no |
| 8 | `…/onboarding/infer-brand-voice/actions.ts:27` | `context-callers.…test.ts:205` ("caller 4") | no |
| 9 | `…/settings/voice/refine-from-posts-action.ts:42` | `context-callers.…test.ts:223` ("caller 5") | no |
| 10 | `…/studio/actions.ts:133` | `studio/actions.test.ts` | no |

**Why it matters.** The property *does* hold — `git diff --name-only 05baf1d2..55b421ad` shows **none** of
those nine files changed, and the third parameter defaults to `{}` — so this is not a false green. But it
is proven by absence-of-diff, a Tier-3 argument, for a constraint the ADR tiers as 2. And `brief.ts`'s two
sites being covered by one undifferentiated file is the per-*file* accounting §5.4 itself warns is
*"exactly how the Session 22 blockers were missed."*

**What would prove it fixed.** A spy-on-args case per row above, or an explicit appendix note re-tiering
the nine as Tier 3 (diff-verified: "no caller file changed") with `brief.ts`'s two sites enumerated
individually.

---

### MINOR-3 — H2.3's cassette-queue helper is used by nothing except its own test

**What is wrong.** `git grep -n 'enqueueCassettes\|drainCassetteQueue' 55b421ad -- lib app components`
returns hits in **`lib/ai/__test-utils__/cassette-queue.ts` and `cassette-queue.test.ts` only**. The tests
that needed distinct payloads — `generate.test.ts`'s argmax, tie-break, partial-failure and
below-threshold cases — get them from `vi.mocked(runPrompt).mockResolvedValueOnce(...)` and
`vi.mocked(generateNativeContent).mockResolvedValueOnce(...)` chains instead, because that file mocks
`@/lib/ai/runner` and `@/lib/ai/generate-native` wholesale (`generate.test.ts:42-49`).

**Why it matters — and what it is not.** The property ADR §4.5(2) demanded **is met**: the argmax case
uses three distinct `overall` values (60/95/80) and asserts the winner is 95; the tie case uses three
distinct candidate bodies (`makeSingleOutput(100|101|102)`) plus a deliberate 90/90/70 tie and asserts the
inserted content is candidate 0's. **These do not pass on a 3-way tie.** So this is *not* the false green
the ADR feared. What is wrong is narrower: the named prerequisite deliverable — including
`drainCassetteQueue`'s loud-failure teardown — guards a queue no Session 31 test touches, so the
global-FIFO poisoning risk at `lib/ai/client.ts:38-41,:55-56` remains unexercised and unguarded for every
other file.

**What would prove it fixed.** Either a recorded decision that H2.3 is superseded by the `vi.mock` route
(helper kept as available infrastructure), or `drainCassetteQueue()` wired into a global `afterEach` in
the vitest setup so it actually protects every file.

---

### MINOR-4 — A-4's expectation-setting copy was neither shipped nor recorded as already-satisfied

**What is wrong.** ADR §3.4 and build-guide §0.2 A-4 state the obligation in the same words: *"The Builder
owes a progress state that sets the expectation"* / *"a spinner with no copy is not the contract."*
`brief-assembly`'s `thinking: 4000` landed at H2.2 (`8ac97dfc`), adding the +8–15s. The only brief progress
string in the repo is `i18n/en/common.json:229` — *"The brief is still being assembled and critiqued.
Check back shortly."* — **unchanged in the range**, written before the latency existed.
`git diff 05baf1d2..55b421ad -- i18n/` shows no brief-progress addition in any of the three locales.

**Why it matters.** A-4 is one of four founder rulings and the only one whose deliverable is purely UX. It
is not in `docs/backlog.md` as deferred, so it risks being lost between "the ADR said the Builder owed it"
and "no one recorded whether it shipped."

**What would prove it fixed.** Either the copy in en/pt/es on the brief surface, or a line in the
correction appendix stating the existing string is judged sufficient for +8–15s, with the founder's
agreement or a backlog item.

---

### MINOR-5 — ADR 0017 Amendment D's five mapped-forward cases do not name their test files

**What is wrong.** `docs/decisions/0017-mode-2-upgrade.md` at `55b421ad` carries Amendment D with exactly
**21** rows — verified independently: `git show 55b421ad:… | grep -o "MODE2-[A-Z0-9-]*" | sort -u` returns
21 distinct names, matching the table one-for-one. `MODE2-HOOK-STANDALONE` is marked **"NO — deliberately
retired"** with its reason on the record, so no retired constraint is left green in ADR 0017's table. That
half is right.

The five-case mapping table, however, gives only a target *constraint name* per row
(`QUAL-JUDGE-RUBRIC-UNFORKED`, `QUAL-BELOW-THRESHOLD-SURFACED`, …) and **no test file**. Every other row of
the 21-row table names a file; these five do not.

**Why it matters.** A retired constraint's cases are only "mapped forward" if a reader can open the file
that now runs them. Without a file, the mapping is a rename. (The files do exist —
`lib/campaigns/generate.test.ts:665-820` and `lib/ai/prompts/rubric.test.ts` — which is why this is MINOR.)

**What would prove it fixed.** A `file:line` in each of the five rows.

---

### MINOR-6 — the new status colours are raw Tailwind palette, not tokens, with no contrast assertion

**What is wrong.** `components/posts/PostJudgmentBadge.tsx` (new at `03eebcb8`) renders the two new status
states with literal palette classes: `bg-amber-100 … text-amber-800 dark:bg-amber-950/40
dark:text-amber-300` and `bg-emerald-100 … text-emerald-800 dark:bg-emerald-950/40
dark:text-emerald-300`. No `globals.css` token is added, and no test reads the shipped token file to
assert contrast in either theme.

**Why it matters.** ADR §8.5 binds the Builder to the repo's design contract, and the amber state is the
one carrying a *behavioural* consequence (exclusion from bulk approve), so its legibility in both themes
is functional, not cosmetic.

**Scoping it honestly:** this is house-consistent — `ApprovalsInbox.tsx`'s pre-existing bulk button is
`bg-emerald-700 hover:bg-emerald-600 text-white`, also raw palette — so it is a continuation, not a
regression.

**What would prove it fixed.** Two `--status-*` token pairs in `globals.css`, used by the badge, plus a
test that reads the shipped token file and asserts a WCAG AA ratio under both `:root` and
`[data-theme="dark"]`.

---

### MINOR-7 — §D2.5 carries the rename but no explicit "no new row required" record for the score columns

**What is wrong.** `docs/decisions/0010-legal-surface.md` §D2.5 at `55b421ad` correctly renames the row and
annotates it: *"ai_budget_daily … renamed from signal_triage_budget, ADR 0024 §7.5b, Session 31 H2.8 —
same row, same FK, same cascade, purpose column added carries no personal data."* That half is right, and
`purge_business` is cascade-driven (`20260702120700_purge_business_member_delete.sql:59-61` — a root
`DELETE FROM public.businesses`, no table named), so the rename is safe by construction with no function
edit owed.

What is missing is the **second** obligation: L-10 / ADR §9's explicit-statement branch, on the Session
28-D D7 precedent, calls for the *"no new business-scoped table required"* record — covering the
`post_ai_originals` column addition — to live in §D2.5's own document. It lives in ADR 0024 §9 (untracked,
see BLOCKER-2) and in the migration header comment, not in the cascade table.

**What would prove it fixed.** One line under §D2.5's table recording that Session 31 introduced no new
business-scoped table, that `post_ai_originals` gained four columns needing no new row (the ADR 0022
`studio_drafts` precedent), and that `QUAL-SCORE-ERASURE` proves erasure reaches them.

---

### MINOR-8 — the Tier-1 backfill case ADR §10.1 names does not exist

**What is wrong.** ADR §10.1 requires, under `QUAL-COST-CEILING-EXTENDED`, *"one proving existing rows
backfilled to `purpose='triage_cents'` with their `reserved_units` value intact."*
`supabase/__tests__/signals3-triage-state.test.ts` at `55b421ad` has a "NO `signal_triage_budget` table or
RPC survives the rename" case (`:263`) and a "purpose has no default" case (`:274`) — **no backfill case**.

**Why it matters, and why it is MINOR.** The case is not writable against `db-tests`' fresh-migrate stack:
there are no pre-rename rows to backfill. The migration's `ADD COLUMN purpose text NOT NULL DEFAULT
'triage_cents'` followed by `ALTER COLUMN purpose DROP DEFAULT` makes the backfill structurally
guaranteed, and the live project's rows did migrate. So the property holds — the *record* is what is
missing, and ADR 0015 §2 is explicit that "no runtime test" must be an enumerated decision, never a gap.
**The same remedy is owed to `QUAL-NO-SECOND-BUDGET-TABLE`**, which is the one Tier-3 row with no recorded
statement anywhere in code (it is covered only by the "no `signal_triage_budget` survives" Tier-1 case,
which is a different property).

**What would prove it fixed.** The backfill half re-tiered to Tier 3 in ADR §10.1/§11 with its
untestability stated, or a fixture-seeded Tier-1 case; and a one-line Tier-3 record for
`QUAL-NO-SECOND-BUDGET-TABLE` alongside the other six.

---

### NIT-1 — dead `openingStrength` residue survives `QUAL-HOOK-RETRY-REMOVED`'s own grep

`generate.ts:529-530` still carries an unreachable branch — `previousContent` is hard-coded `null` at
`:460`, so the ternary's true arm can never run — containing the string
`rejectionNote: 'weak opener (openingStrength below threshold)'`. The constraint's recorded verification
(`generate.test.ts:822-828`) greps for `extractOpener\|openingStrength.score <`, which does not match it.
The retry itself **is** genuinely gone: no second `generateNativeContent` call, no threshold comparison,
no `regenerationCount` mutation anywhere in the file.

### NIT-2 — `role` is inert

`MemoryQueryContext.role` is added, threaded and present in `scoring.test.ts:56`'s fixture, but
`scopeMatch` (`scoring.ts:56-70`) has no `role` branch, so it changes no ranking anywhere. Folded into
MAJOR-4's remedy.

### NIT-3 — old constraint names survive the table rename

Read live: `ai_budget_daily` still carries `signal_triage_budget_pkey`,
`signal_triage_budget_business_id_fkey` and `signal_triage_budget_reserved_cents_check`. Cosmetic — the
Tier-1 "no `signal_triage_budget` object survives" case probes the table and the RPCs only, and Postgres
carries constraint names through a `RENAME`.

### NIT-4 — two new `as any` outside CLAUDE.md's named carve-outs

`lib/memory/performance.test.ts` (`const client = {} as any`, eslint-disabled, two new instances in the
range). CLAUDE.md names exactly two `any`-adjacent loci: `lib/email/templates/index.ts` and
`supabase/__tests__/*.test.ts`. This is an app-layer `lib/**` test file. `npm run lint` is 0 errors.

### NIT-5 — `app-tests.yml`'s env comment is now stale

The comment reads *"two files import the REAL `lib/config.ts` unmocked (`lib/config.test.ts` …;
`lib/signals/orchestrator.test.ts` …)"*. As of this range there are **three** —
`lib/campaigns/generate.test.ts` now transitively imports `lib/config.ts` via `lib/campaigns/generate.ts`,
which is what my bare-shell run surfaced. CI still passes (the env block is step-scoped), which is why this
is a NIT and not a finding against the job.

---

## What I verified as CORRECT — organised by ADR section

### §2 — the N-candidate contract (L-3, D-2)

- **N = 3, declared once.** `generate.ts:48` `const N_CANDIDATES = 3`, used at `:331` only.
- **Concurrency bounded to N.** `Promise.allSettled(Array.from({length: N_CANDIDATES}, …))` inside the
  awaited entry loop — the fan-out width *is* the bound, and posts stay sequential across the loop.
  Asserted at `generate.test.ts:666,808`.
- **Three outcomes, all three tested.** Hard fail (`generate.test.ts:717`); **unscored** — the one most
  likely to be missing, and it is present and correct (`:734`: `postsCreated === 1`, `overall_score` null,
  `dimension_scores` null, `candidate_count` 3, `cleared_quality_threshold` **null, not a defaulted
  false**); and partial failure with argmax over the two survivors (`:753`, asserting `runPrompt` was
  called twice, not three times).
- **Argmax and tie-breaking.** `generate.ts:441-445` reduces over `scored`, which is built in ascending
  candidate index, so a tie can never satisfy `c.index < best.index` — lowest index wins. Both halves are
  tested with genuinely distinct payloads (see MINOR-3): distinct scores for the argmax, distinct bodies
  plus a deliberate tie for the tie-break.
- **All-N-below-threshold does not fail, regenerate or escalate.** `generate.test.ts:781` asserts
  `postsCreated === 1`, `overall_score === 65`, `cleared_quality_threshold === false`, and that
  `updateGenerationSessionStatus` was **never** called with `status: 'failed'`. No Opus reference exists
  anywhere in the range.
- **The retry is GONE, not dormant.** `git grep` of `generate.ts` at `55b421ad` finds no `extractOpener`,
  no threshold comparison, no second `generateNativeContent`, and `regenerationCount`/`previousContent`
  hard-coded `0`/`null` at `:459-460`. Only NIT-1's dead branch remains.
- **The judge is the existing `rubricPrompt`, unforked.** `lib/ai/prompts/rubric.ts` is **not in the
  diff**: ten dimensions, `RubricOutputSchema` byte-unchanged, `rubric.ts:21-24`'s invariant comment
  intact. Per SHARED-FUNCTION CALLERS, four callers, each with a test:

  | Caller | Mode | Test that exercises it |
  |---|---|---|
  | `lib/campaigns/brief.ts:170` | `'brief'` | `lib/campaigns/brief.test.ts` |
  | `lib/campaigns/generate.ts:374` (**the judge**) | `'post'` | `generate.test.ts:594-663` |
  | `lib/signals/triage/card.ts:226` | `'card'` | the triage card suite |
  | the prompt object itself | — | `rubric.test.ts:116-190` |

  No multiplexed 3-output call exists, so the schema `lib/studio/categories.ts` derives from is untouched.
- **Every candidate is `neutralize()`'d before the judge**, and the assertion is content-based, not
  call-count-based: `generate.test.ts:640-653` feeds an injection payload and asserts the rubric input is
  defused — dropping the `neutralize()` call reddens it.
- **The judge scores `joinContent(output)`, not `extractOpener(output)`.** `generate.ts:376`
  `content: neutralize(joinContent(output))`; `generate.test.ts:602,621-638` asserts the whole body,
  including the thread-join case.
- **Losing candidate content is nowhere persisted.** No `post_candidates` table in either migration; only
  `winningOutput`/`winningScore` reach `generated` (`generate.ts:453-464`); `AiGenerationMetadata`
  (`:520-543`) carries no candidate array or rejected-draft field.

### §3 / §3.3a — sampling and thinking as versioned properties (L-2, D-3)

- **`brief-assembly` declares `thinking: 4000` AND `maxTokens: 12_000` in the same declaration at
  `version: 2`** — `lib/ai/prompts/brief.ts:71-84`, both fields, one commit (`8ac97dfc`). §3.3a's BLOCKER
  is closed; asserted directly at `runner.test.ts:726`.
- **No prompt declares both `temperature` and `thinking`**, asserted over all ten ids at
  `runner.test.ts:759-786`; adding the pair to any one of them reddens it.
- **A `thinking` block followed by a `text` block parses** (`runner.test.ts:788`), and a thinking budget is
  sent in SDK form and **omitted entirely when unset** (`:799`).
- **The frozen table has exactly TEN rows**, one per prompt id. `formats/policy.ts` and
  `formats/schemas.ts` correctly get **no** row; `native-generation-{single,thread,carousel}` correctly get
  **three** despite `temperature` being declared once inside the factory
  (`native-generation-prompt.ts:133-137`). §15 MAJOR-2's 12-row draft is corrected. It reddens
  independently on `modelKey`, `temperature`, `thinking`, `maxTokens` and `useToolOutput` — but see
  MAJOR-2 for what it does **not** catch.
- **Native generation deliberately gets no thinking budget**, recorded as a decision, not an omission.

### §4 — fixtures

- **ZERO fixtures moved.** `git diff --name-only 05baf1d2..55b421ad -- lib/ai/__fixtures__` is **empty**.
  This is the correct outcome: L-5's premise is false for this harness, and `MockAnthropicClient`
  (`lib/ai/client.ts:49-88`) routes only on `params.model`, `_sosh.promptId` and
  `_sosh.input.targetPlatform` — I re-read it and confirm temperature/thinking never touch routing.
  **No finding is raised for the migration not happening**, and none was warranted for a re-record either.
- **The post-generation orphan audit is recorded, not acted on.** All five fixtures still present
  (asserted by the `QUAL-MODE2-FIXTURES-MIGRATED` scan); removal deferred to
  `31-DEAD-POST-GENERATION-PROMPT` in `docs/backlog.md`, to land in one diff with the prompt and
  `client.ts:61-67`'s routing branch. Correct per the ADR.

### §5 — task-conditioned retrieval

Correct except MAJOR-4 / MINOR-2 / NIT-2. Specifically verified:

- **`withPostQueryContext` re-runs `retrievePerformancePatterns` ONLY.** `context.ts:161-171` — brand,
  evidence, audience and voice are not re-read; asserted at `context.test.ts` ("does not re-read
  brand/evidence/audience/voice or campaigns").
- **`QUAL-SERVICE-ROLE-UNWIDENED` holds.** No `client` parameter on either function; the only
  `createServiceRoleClient()` call sites in the diff are both inside `lib/ai/context.ts`, via the
  lazy-import pattern; asserted at `context.test.ts:686`.
- **`retrieveVoice`** — two callers (`context.ts:57`, `lib/learning/orchestrator.ts:240`), neither changed,
  neither passed new fields; `MEM-VOICE-THROUGH-EXISTING` intact, covered by `context.test.ts:394-438` and
  the learning-orchestrator suite.
- **`retrievePerformancePatterns`** — callers per §5.5, unchanged shape; `lib/signals/triage/tools.ts`
  still deliberately not a caller.
- **Caps unchanged.** `lib/memory/constants.ts` is **not in the diff**: `BRAND_CAP 5`, `EVIDENCE_CAP 5`,
  `AUDIENCE_CAP 5`, `PERFORMANCE_CAP 3` all stand.
- **No `lib/memory/` write path added** (L-1) — and it is now an executable scan in
  `lib/scope-scans.test.ts` ("no `lib/memory/*.ts` calls `.insert`/`.update`/`.upsert`/`.rpc`").

### §6 — structured output (L-7, D-5)

- **The parse path learned `tool_use` in the SAME commit as the first migrated prompt.** `62afe1dd`
  contains both `lib/ai/runner.ts` and `lib/ai/prompts/learning-summarizer.ts`. **There is no intermediate
  commit** where a prompt declares a tool against a text-only parser — the ordering hazard §4.5(1) names
  never existed. `runner.ts:224` finds the `tool_use` block unconditionally, before branching.
- **Exactly ONE prompt migrated.** `useToolOutput: true` appears once in the repo
  (`learning-summarizer.ts:93`); the frozen table records `useToolOutput: undefined` for the other nine.
- **`extractJsonBlock` present AND exercised.** `parsers.test.ts:6-45` exercises it directly; `runner.ts`'s
  else-branch (`safeParseOrAiError(prompt.outputSchema, rawText)`) still serves the other nine ids;
  `tool-runner.ts:445` still parses its text decision. `QUAL-PARSER-RETAINED`'s scan asserts all three, not
  merely presence.
- **Zod retained behind the tool schema.** `input_schema: z.toJSONSchema(prompt.outputSchema)` — one schema
  object per prompt, no hand-written second schema. `parseToolInputOrAiError` (`parsers.ts:81-97`) still
  runs `schema.safeParse` and throws the **identical** `AiError('invalid_response')` shape, so no caller
  can distinguish the paths. `TOutput` still infers off `prompt.outputSchema`.
- **All three malformed paths tested** (`runner.test.ts:954,966,979`): no tool block; bad `input`; and
  mixed text+tool with the `tool_use` block winning and the mixed case logging.

### §7 — cost, trial caps and rate limits at N (L-6, L-9, A-1, A-2)

- **Guard ordering unchanged** — `QUAL-GUARD-ORDER-PRESERVED` at `runner.test.ts:822` (trial cap, then
  rate limit, then SDK call); the reservation sits outside and above `runPrompt`, in `generate.ts`.
- **The trial-unit negative obligation was honoured exactly.** `runner.ts:217`'s two skip predicates are
  **unnarrowed**, the orchestrator still batch-increments once per inserted post, and the Builder added
  **no new mechanism** — which is the correct reading of §7.2. `QUAL-TRIAL-UNIT-PER-POST` is a pure
  regression test: `runner.test.ts:865` asserts the skip set is exactly
  `{native-generation-single, native-generation-thread, post-generation, rubric}`, no more and no less;
  `generate.test.ts:795` asserts 18 candidate generations produce one
  `incrementPostsGeneratedBy(BUSINESS_ID, 6)`, not 18.
- **Rate limit raised 30 → 100 in `lib/config.ts:37`**, not via `process.env`; `AI_PRO_DAILY_POST_CAP = 15`
  likewise, with a `config.server` getter, read at `generate.ts:307` as
  `config.server.AI_PRO_DAILY_POST_CAP`.
- **The reservation reserves POSTS, not cents; ONE unit; BEFORE the fan-out.**
  `lib/db/generation-budget.ts:22-38` — `p_purpose: 'generation_posts'`, `p_units: 1`, `p_cap: capPosts`.
  `generate.ts:305-320` sits above `:329`'s `Promise.allSettled`. Asserted at `generate.test.ts:838` (one
  call, `(BUSINESS_ID, 15)`, with three generations still issued). Release-on-hard-fail via
  `reconcile_ai_budget(…, 1, 0)` asserted at `:874`, and *not* released on success at `:881`.
- **Plus and trial take NO `generation_posts` reservation** — asserted separately at
  `generate.test.ts:851,858`. The unruled pricing change did not happen.
- **A denied reservation uses a distinct error code**, `daily_quota_exceeded`, not the trial cap's
  `quota_exceeded` (`generate.ts:311`, asserted at `generate.test.ts:864`), with distinct copy carrying the
  `00:00 UTC` reset hour in all three locales.
- **The budget migration is right on all four counts the ADR flags.** `UNIQUE (business_id, purpose, day)`
  landed and the old `(business_id, day)` key is dropped (verified live); both RPCs **`DROP FUNCTION`**'d
  and recreated with a re-issued REVOKE/GRANT pair (MAJOR-5 covers why the REVOKE is insufficient);
  backfill via `ADD COLUMN … DEFAULT 'triage_cents'` then `DROP DEFAULT`; trigger renamed with the table;
  **no** `signal_triage_budget` table or RPC survives (verified live and at
  `signals3-triage-state.test.ts:263`).
- **`QUAL-BUDGET-PURPOSE-ISOLATED` is genuinely BIDIRECTIONAL** — `signals3-triage-state.test.ts:289`
  (a capped `triage_cents` row does not deny a `generation_posts` reservation) **and** `:311` (the other
  direction, explicitly labelled as such). A one-directional test would have passed on a shared counter
  half the time; this one cannot.

### §8 — the UX contract (A-3, A-4)

- **Scores live on `post_ai_originals` as COLUMNS**, written **with** the row at `generate.ts:568-579`'s
  `createPostAiOriginal` insert — never `UPDATE`d onto it, so the write-once `BEFORE UPDATE` trigger
  (`learning_capture.sql:67-68`) is respected by construction. `AI_ORIGINAL_SCHEMA_VERSION` bumped 1 → 2
  in the same migration step.
- **Nothing was written to `posts.ai_generation_metadata`** — the metadata literal at
  `generate.ts:520-543` carries no score field, and `post-ai-originals.test.ts` has an explicit negative
  case ("createPostAiOriginal never targets the posts table — only post_ai_originals").
- **`QUAL-SCORE-ERASURE` is a real live-Postgres case**, not a structural argument from `ON DELETE
  CASCADE`: `supabase/__tests__/post-ai-original-scores-erasure.test.ts` writes a row carrying all four new
  columns, reads them back (`overall_score` 82, `candidate_count` 3, `cleared_quality_threshold` true,
  `dimension_scores` deep-equal), runs `purge_business`, and asserts zero rows.
- **All four states render**, with the unscored one explicitly stated rather than badge-absent
  (`PostJudgmentBadge.tsx:38-42`; `resolvePostJudgment` maps `cleared_quality_threshold: null` →
  `'judging-failed'`, never a defaulted `false`). Tested in both surfaces (`ApprovalsInbox.test.tsx`,
  `PostCard.test.tsx`), including the no-original-row case.
- **Bulk-approve exclusion is covered PER CALLER — the Session 22 shape did not recur.**
  `bulkApproveDraftPosts` (`lib/db/posts.ts:594`) has exactly two callers via `bulkApprovePostsAction`,
  found by `git grep` at the range, not from the ADR:

  | Caller | Exclusion site | Test that exercises it | Says why? |
  |---|---|---|---|
  | `app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx:250,302` | `approvableRows` / `excludedRows` | `ApprovalsInbox.test.tsx` — "bulk approve excludes below-threshold ids from the Server Action call", plus the every-post-excluded case | **yes** — asserts `bulk.excludedNotice` renders (`:808`) |
  | `app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx:128,252` | `approvableDraftIds` / `excludedDrafts` | `PostsClient.test.tsx` — exclusion, notice shown, notice not shown, all-excluded, no-original-row | **yes** — `bulkApproveExcludedNotice` |

  Both surfaces **say why** they left drafts behind, per A-3, and neither skips silently. *Residual note,
  not a finding:* `bulkApproveDraftPosts` itself still carries no quality predicate — ADR §8.4 chose
  caller-side enforcement deliberately — so a future third caller inherits nothing.
- **i18n landed in en, pt and es simultaneously.** Programmatic key-parity check across `approvals.json`,
  `posts.json` and `common.json`: **zero missing, zero extra** in either pt or es. The score badge, the
  amber below-threshold copy, the bulk-approve explanation, the unscored notice and the
  `daily_quota_exceeded` string with its `00:00 UTC` reset are all present in all three.
- **No `asChild` on `Button` or any `DropdownMenu` primitive** anywhere in the changed `.tsx` files
  (grep returns nothing). **No raw `.toISOString()`** in any changed non-test source. The new page query
  goes through `lib/db/post-ai-originals.ts`'s existing RPC-backed helper with an empty-input guard.

### §9 — GDPR and tenancy (L-10)

- **No new business-scoped table.** Both migrations are `ALTER TABLE` only; `QUAL-NO-SECOND-BUDGET-TABLE`
  holds by inspection of both files.
- **The §D2.5 row moved with the table**, annotated (MINOR-7 covers what is still missing).
- `purge_business` needs no edit — it is cascade-driven with no table named in its body.

### §10 — the test plan and the honest record

- **Tier counts match the ADR**: 4 Tier 1, 18 Tier 2, 7 Tier 3, **0 Tier E**. I checked specifically for a
  quietly-added Tier-E row (ADR 0015 Amendment B(b)) — **there is none**, and none of the seven Tier-3 rows
  is a disguised quality claim.
- **The eval harness was not run and not claimed.** `eval-triage.yml`'s path filter matches no Session 31
  file; `docs/current-phase.md` cites this as a *reason the session cannot measure*, and reports no green
  from it.
- **The before/after record is honest, and MEASURED-never-COVERED.** `docs/current-phase.md` at `55b421ad`
  gives a factual mechanism table (1→3 candidates, 2→6 provider calls, ≈4.9¢→≈10¢ recorded) and then
  states in four numbered points that the session **cannot prove the posts are better**, including the
  bootstrap-ceiling caveat. **No quality improvement is claimed anywhere in the range.** That is
  compliance, and I raise no finding.
- **The interim instrumentation states both halves in the log line itself** (`generate.ts:434-446`:
  `note: 'proves the judge discriminates candidates; does NOT prove discrimination tracks real post
  quality'`), so the number cannot be misread later. Logged, not gated, not a constraint.
- **Tier-3 enumeration**: six of seven are recorded as decisions — three as executable scans in
  `lib/scope-scans.test.ts` (`QUAL-NO-NEW-AI-SURFACE`, `QUAL-PARSER-RETAINED`,
  `QUAL-MODE2-FIXTURES-MIGRATED`), `QUAL-SERVICE-ROLE-UNWIDENED` as a runtime case at
  `context.test.ts:686`, and `QUAL-HOOK-RETRY-REMOVED` / `QUAL-RUBRIC-UNCHANGED` as named diff-verified
  comments at `generate.test.ts:822-834`. The seventh is MINOR-8's second half.

### §11 — L-1 scope: nothing out-of-scope shipped

`git diff 05baf1d2..55b421ad | grep -iE '^\+.*(embedding|pgvector|cosine|similarity|exemplar|image_gen|generateImage|planner)'`
returns **empty**. Confirmed absent: voice exemplars; similarity/embedding retrieval; tools for the
generator (`lib/ai/tool-runner.ts` is untouched apart from being *read* by a scan); claim verification; the
campaign planner; any `lib/memory/` write path (now an executable scan); cross-type retrieval; any cap
change (`lib/memory/constants.ts` not in the diff); image generation; and any new AI surface — the only
`page.tsx` touched is `campaigns/[id]/posts/page.tsx`, which adds a data prop, and the only route-level
change is an error-code string in `GeneratePostsButton.tsx`.

---

## What I could NOT verify, and why

1. **Any CI result for this range.** No run exists (BLOCKER-1). I therefore could not read a `db-tests`
   skip-guard line, could not distinguish a DB-behaviour regression from the supautils SIGSEGV *for this
   range*, and could not confirm a single one of the 29 rows as executed-green. The last four `db-tests`
   failures on this branch (2026-09-05/06, all `pull_request`, all at or before `05baf1d2`) are the
   **known stack failure**, per the workflow's own pinned-CLI comment and `05baf1d2`'s commit message.
2. **Tier-1 execution.** I did not run `supabase/__tests__` against the live linked project — those suites
   create and delete real users and businesses, and `db-tests.yml` states it never touches the linked
   remote. I substituted read-only SQL, which confirms both migrations are applied and correctly shaped,
   but **that is schema verification, not behaviour verification**: concurrency, the UTC day boundary,
   release-on-hard-fail and purpose isolation remain unexecuted here.
3. **Reddening demonstrations.** I modify nothing, so I did not mutate source to make a scan go red. I
   verified reddening **by reading the assertions**. Two of the three H2.13 claims are sound by inspection
   (`QUAL-PARSER-RETAINED` — removing the export breaks the import; `QUAL-MODE2-FIXTURES-MIGRATED` —
   deleting a fixture fails `existsSync`). The third, `QUAL-NO-NEW-AI-SURFACE`, is **not** — see MAJOR-2.
4. **H2.0's grounding pass.** No code, no commit, by design — no artefact exists at the range to audit.
5. **Whether `/impeccable` and `/taste-skill` were invoked at H2.12** against ADR §8.5, as the §2b step
   table requires. No artefact records it either way.

---

## Findings index

| ID | Severity | One line |
|---|---|---|
| BLOCKER-1 | BLOCKER | Branch unpushed; 0/29 constraints executed green in CI at `55b421ad` |
| BLOCKER-2 | BLOCKER | ADR 0024 is untracked; the build guide has 1,490 uncommitted lines |
| MAJOR-1 | MAJOR | `temperature` is never asserted to reach — or be omitted from — the SDK params |
| MAJOR-2 | MAJOR | Both "runtime" prompt scans are hand-maintained import lists; an 11th prompt passes green |
| MAJOR-3 | MAJOR | ADR 0022's `RUNNER-UNMODIFIED` scan deleted with no ADR 0022 amendment — a false green |
| MAJOR-4 | MAJOR (**ADR finding**, §5.2b) | `withPostQueryContext` discards the campaign query context; `campaignId` reaches no prompt |
| MAJOR-5 | MAJOR (**security**, pre-existing class) | Both recreated `SECURITY DEFINER` budget RPCs are EXECUTE-able by `anon`/`authenticated` |
| MINOR-1 | MINOR | Reserved generation units leak on a mid-campaign `daily_quota_exceeded` |
| MINOR-2 | MINOR | `QUAL-CONTEXT-CALLERS-UNCHANGED` not asserted per call site; `brief.ts`'s two sites undistinguished |
| MINOR-3 | MINOR | H2.3's cassette-queue helper is consumed only by its own test |
| MINOR-4 | MINOR | A-4's expectation-setting copy neither shipped nor recorded as satisfied |
| MINOR-5 | MINOR | ADR 0017 Amendment D's five mapped-forward cases name no test file |
| MINOR-6 | MINOR | New status colours are raw palette, not tokens; no both-themes contrast assertion |
| MINOR-7 | MINOR | §D2.5 lacks the explicit "no new business-scoped table required" record |
| MINOR-8 | MINOR | The Tier-1 backfill case ADR §10.1 names does not exist and is not recorded as a decision |
| NIT-1 | NIT | Dead `openingStrength` residue at `generate.ts:529-530` |
| NIT-2 | NIT | `MemoryQueryContext.role` is inert — `scopeMatch` has no role branch |
| NIT-3 | NIT | `signal_triage_budget_*` constraint names survive on `ai_budget_daily` |
| NIT-4 | NIT | Two new `as any` in `lib/memory/performance.test.ts`, outside CLAUDE.md's carve-outs |
| NIT-5 | NIT | `app-tests.yml`'s "two files" env comment is now three |

**Still open, and NOT Builder defects** (reported as status, per the Reviewer brief):
`31-A1-PRICING-COPY` — the A-1 pricing-copy change is a founder task, correctly out of scope for H2 and
recorded in `docs/backlog.md`. `31-DEAD-POST-GENERATION-PROMPT` — deliberately deferred; the prompt, its
five fixtures and `client.ts:61-67`'s routing branch belong in one later diff.

---

Session 31 review complete — 20 findings (2 BLOCKER, 5 MAJOR, 8 MINOR, 5 NIT) over range 05baf1d2..55b421ad; 0/29 QUAL-* constraints verified executed green in CI.

---

## CORRECTION PASS (Session 31-D)

**Author:** Session 31-D correction pass · **Date:** 2026-09-10 · **Range fixed:** `55b421ad..<D10-sha>`
**Reviewed head:** `55b421ad` — the head the Reviewer read; nothing had landed after it when D0 ran.
**ADR 0024's own commit:** `5e0f6b09` — the Reviewer's range line could not name it, the ADR having existed
at no commit when the report was written (BLOCKER-2). This statement is the correction; the range line above
it is the Reviewer's and is unedited.
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

### D1 — MAJOR-2

| Field | |
|---|---|
| **Finding** | MAJOR-2 |
| **Fix** | `lib/ai/prompts/collect-prompts.ts` (new) walks `lib/ai/prompts/**` on disk and imports every module, collecting every export that structurally satisfies `Prompt` (`id`/`version`/`modelKey`/`outputSchema`/`buildSystemPrompt`/`buildUserMessage`) — never a hand-written id list. The native-generation factory's three families are driven off its own new runtime array, `NATIVE_GENERATION_FAMILIES` (`lib/ai/prompts/formats/native-generation-prompt.ts`), rather than a literal duplicated in the collector. The frozen table itself moved out of the test file into `lib/ai/prompts/frozen-table.ts` so both scans read the same data instead of one owning it and the other hand-counting "10". `lib/ai/prompts/prompt-properties.frozen-table.test.ts` now calls `collectPrompts()` via top-level `await`. `lib/scope-scans.test.ts`'s `QUAL-NO-NEW-AI-SURFACE` case now calls the same `collectPrompts()` and asserts a **bijection** against `FROZEN_TABLE` (every enumerated id has a row, every row has an enumerated id) instead of `new Set(ids).size === 10`. |
| **Proof** | `lib/ai/prompts/prompt-properties.frozen-table.test.ts` — "has exactly ten live prompt ids, matching the frozen table one-for-one" and the per-id `it()` loop; `lib/scope-scans.test.ts:195` — "every enumerated prompt id has a frozen-table row, and every frozen-table row has an enumerated id — no eleventh (new prompt family)". |
| **Reddening** | Two mutations, both performed and reverted. **(1)** Added a temporary file `lib/ai/prompts/__d1-mutation-scratch.ts` exporting a `Prompt`-shaped object (`id: 'd1-mutation-scratch'`) with no frozen-table row and **no edit to any import list anywhere**. Ran both test files: `prompt-properties.frozen-table.test.ts` failed 2 tests ("has exactly ten..." — 11 ≠ 10 — and the new per-id row for `d1-mutation-scratch` — "no frozen-table row"); `scope-scans.test.ts` failed 1 test ("enumerated prompt id \"d1-mutation-scratch\" has no frozen-table row"). Deleted the file; confirmed `git status --porcelain` showed nothing for that path; re-ran both files — 19/19 green. **(2)** Temporarily changed `NATIVE_GENERATION_FAMILIES` in `lib/ai/prompts/formats/native-generation-prompt.ts` to `['single', 'thread', 'carousel', 'd1-mutation-quad' as FormatFamily]` — a fourth family with no frozen-table row and no `createNativeGenerationPrompt` switch case. Ran both test files: both failed with `Error: Unhandled case: "d1-mutation-quad"` thrown from `assertNever` (`lib/utils.ts:22`), via `createNativeGenerationPrompt` → `collectPrompts`. Restored the array to its original three-element literal; confirmed `git diff --stat -- lib/ai/prompts/formats/native-generation-prompt.ts` showed only the 11-line D1 addition (the `NATIVE_GENERATION_FAMILIES` const + its comment), no residue; re-ran `npx tsc --noEmit --skipLibCheck` (clean) and both test files (19/19 green). Also ran the full `test:app` suite (app/ lib/ components/ scripts/eval/) under both a bare shell (`env -i`) and app-tests.yml's CI env block: 3620/3621 passing both times, the one failure (`lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts`) reproduced identically at the pre-D1 `5e0f6b09` HEAD run in isolation and in isolation post-D1 — a pre-existing, order-dependent flake unrelated to this change, not introduced by it. No prompt file imports `lib/config.ts` at module scope (`git grep`-verified before building the walk), so the import-time hazard the Reviewer's bare-shell run hit elsewhere did not recur here — confirmed by the bare-shell run above. |
| **Commit** | `6db40659` |

**Observation routed to D9 (not a finding, no ID):** ADR 0024 §3.2's sentence *"Changing any of those four without bumping that prompt's version in the same commit fails the test"* over-claims what the frozen table can prove — editing `temperature` `1.0` → `0.8` in the factory AND editing the table row to `0.8` in the same commit, without touching `version`, still passes. The table makes a version-less change *visible in a diff* (the `platform-map.frozen-table.test.ts` precedent's real property); it cannot enforce commit-authorship intent. D9 corrects the ADR sentence.

**What this step did NOT touch:** `runner.ts` (D2's job — `temperature` reaching the SDK is untested by this step), the frozen table's actual values (unchanged, still ten rows, still the values H2.2 declared), and `formats/policy.ts`/`formats/schemas.ts` (confirmed to contribute nothing to the walk, as the Reviewer already found).

### D2 — MAJOR-1

| Field | |
|---|---|
| **Finding** | MAJOR-1 |
| **Fix** | `lib/ai/runner.test.ts` gains a new `describe('QUAL-SAMPLING-DEFAULT-PRESERVED — temperature at the SDK params level (D2/MAJOR-1)')` block, in the shape of the existing thinking pair (:799-808): one test asserts that a REAL native-generation prompt (`createNativeGenerationPrompt('single')`, not a synthetic prompt with a copied id) produces `mockCreate.mock.calls[0][0].temperature === 1.0`; the other asserts that `mockPrompt` (declares nothing) produces SDK params with **no `temperature` key at all** (`.not.toHaveProperty('temperature')`, not `toBeUndefined()`). No production file touched. |
| **Proof** | `lib/ai/runner.test.ts` — "a native-generation prompt (temperature: 1.0) sends temperature 1.0 at the SDK params level" and "a prompt declaring no temperature sends NO temperature key at all — not undefined, absent". |
| **Reddening** | Two mutations to `lib/ai/runner.ts:171` (`...(prompt.temperature !== undefined ? { temperature: prompt.temperature } : {})`), both performed and reverted. **(a)** Deleted the spread entirely (replaced with a comment). Ran `runner.test.ts`: the native-generation case went RED (`expected undefined to be 1`); the no-temperature case stayed GREEN (no key either way — a deleted spread and an absent-declaration prompt are indistinguishable, which is exactly why mutation (b) is also required). Restored the original conditional spread; `git diff --stat -- lib/ai/runner.ts` empty. **(b)** Changed the spread to an unconditional `temperature: prompt.temperature,`. Ran `runner.test.ts`: the no-temperature case went RED (`expected {...} to not have property "temperature"` — the key now present as `undefined`); the native-generation case stayed GREEN (`1.0` still arrives). Restored the original conditional spread; `git diff --stat -- lib/ai/runner.ts` empty. Together the two mutations prove the assertion pair is about the KEY's presence, not just the value. Re-ran the full `runner.test.ts` suite after final restore: 57/57 green, including :703-715, :759-786 (disjointness check, byte-unchanged), :799-812 unmodified. `npx tsc --noEmit --skipLibCheck` clean. Full `test:app` suite (app/ lib/ components/ scripts/eval/) under the CI env block: 257/257 files, 3623/3623 tests green (the D1 appendix's pre-existing `corpus-v2-schema.test.ts` flake did not recur this run). |
| **Commit** | `f3940352` |

**What this step did NOT touch:** `runner.ts` itself (no production change — the constraint was already correctly implemented; only its test coverage was missing), the frozen table, and the maxTokens/thinking pairs immediately above the new block (unchanged, re-verified green).

### D3 — MAJOR-3

| Field | |
|---|---|
| **Finding** | MAJOR-3 |
| **Fix** | Doc-only. `docs/decisions/0022-promote-to-campaign-and-format-families.md` §21 (new, additive — §11.3 and §20.1/§20.2 are unedited) records `RUNNER-UNMODIFIED`'s retirement: names the deleting commit (`bdcabf50`), states why the retirement is correct (ADR 0024 §3.1/§6.4/§7 is a later, properly adjudicated ADR whose stated purpose is to modify `runner.ts`, the exact file the scan pinned), and names what still guards the surviving half of the original two-part constraint — `lib/ai/runner.test.ts`'s `QUAL-TRIAL-UNIT-PER-POST` case, which exercises the same four-id skip set (`native-generation-single`, `native-generation-thread`, `post-generation`, `rubric`) the deleted "no fourth `is*` predicate" assertion gated, plus a control id proving the set isn't silently widened. No code file touched by this step. |
| **Proof** | `docs/decisions/0022-promote-to-campaign-and-format-families.md` §21, present in the working tree; §11.3's row and §20's restatements confirmed byte-unchanged (`git diff` scoped to this file shows only an appended section, no deletions or edits above it). |
| **Reddening** | N/A — this is a documentation fix closing a missing-amendment finding, not a code-behind-a-test constraint; there is no source assertion to mutate and revert. Verified instead by re-reading §11.3, §20.1 and §20.2 in the edited file and diffing against the pre-edit version to confirm zero bytes changed above the new §21, and by re-confirming `bdcabf50`'s diff (`git show bdcabf50 -- lib/scope-scans.test.ts`) still shows the `MODE2-RUNNER-UNTOUCHED` deletion this section describes. |
| **Commit** | `0655dbaf` |

**What this step did NOT touch:** ADR 0024 §0's "Amends" list (still silent on ADR 0022 — the Reviewer's "unauthorised by the ADR" observation is about that ADR, not this one, and is not this finding's fix target); `lib/scope-scans.test.ts` (no test added or restored — `RUNNER-UNMODIFIED`'s content-hash half is gone for good, by design, per §21's own reasoning); `runner.ts` and `runner.test.ts` (D2's job, already closed).

### D4 — MAJOR-4

| Field | |
|---|---|
| **Finding** | MAJOR-4 |
| **Fix** | Option (a) from the Reviewer's own two acceptable fixes: `withPostQueryContext` (`lib/ai/context.ts`) now MERGES onto the caller's `MemoryQueryContext` instead of replacing it — its second parameter widens from `{ platform: Platform; role: string }` to `MemoryQueryContext & { platform: Platform; role: string }`, and the object is passed to `retrievePerformancePatterns` as-is (no more hand-picking two fields out of it). `lib/campaigns/generate.ts`'s call site (`:297`, STEP 7) now spreads STEP 4's own `queryContext` (`{ objective, audience, campaignId }`) into the call: `withPostQueryContext(ctx, { ...queryContext, platform: entry.platform, role: entry.role })`. `campaignId` (and `objective`/`audience`) now reach `retrievePerformancePatterns` on every per-post call, closing the seam where STEP 4's campaign-level retrieval was computed and thrown away. No change to `scopeMatch` or `MemoryQueryContext`'s shape — both already correct; the defect was purely the seam dropping fields on the way through. |
| **Proof** | `lib/ai/context.test.ts` — new case "MAJOR-4 fix: campaignId spread into postContext reaches retrievePerformancePatterns and changes ranking", mirroring `QUAL-QUERY-CONDITIONED`'s own proof shape (a real ranking difference between two governed rows, not just "the argument was accepted") but through `withPostQueryContext` specifically. `lib/campaigns/generate.test.ts` — the existing per-post wiring test updated to assert the full merged object (`objective`, `campaignId`, `platform`, `role`) reaches each call instead of `{platform, role}` alone, plus a new case ("MAJOR-4: campaignId … reaches withPostQueryContext for every entry") asserting `campaignId` is present on every one of the six per-entry calls. |
| **Reddening** | `git stash push -- lib/ai/context.ts lib/campaigns/generate.ts` (reverting exactly the two production files this step touches, nothing else), then ran `lib/ai/context.test.ts` and `lib/campaigns/generate.test.ts` under the app-tests.yml CI env block: 3 failures — the new `lib/ai/context.test.ts` case (assertion not reached the same way, mock returning platform/role-only queries), the updated `generate.test.ts` wiring assertion (diff showed `campaignId`/`objective` present in the new expectation but absent from the actual pre-fix call — `{platform: 'linkedin', role: 'objection_response'}` etc.), and the new `generate.test.ts` MAJOR-4 case (`expected undefined to be 'campaign-1'`). `git stash pop` restored the fix; re-ran both files plus `generate.context-equivalence.test.ts` and the full `lib/memory` suite (CI env block): 9 files, 160/160 green. `npx tsc --noEmit --skipLibCheck`: clean. |
| **Commit** | `f70bd204` |

**What this step did NOT touch:** `scopeMatch` (`lib/memory/scoring.ts`) — unchanged; `role` still has no `MemoryScope` branch, exactly as the Reviewer's "compounding it" paragraph notes, and this step does not attempt to fix that (out of MAJOR-4's own scope, which is about `campaignId` reaching the seam at all — the Reviewer's finding did not ask for a `role` scope branch, and inventing one would be a new, un-adjudicated memory-scope decision); `buildCustomerContext`'s own STEP-4-level call (unchanged — it already received `campaignId` correctly, per the Reviewer's own read); `MemoryQueryContext`'s declared shape (`lib/memory/scoring.ts`) — unchanged, all fields already optional, which is exactly what makes this an additive, non-breaking widening of `withPostQueryContext`'s second parameter.

### D5 — MAJOR-5

| Field | |
|---|---|
| **Finding** | MAJOR-5 |
| **Fix** | New migration `supabase/migrations/20260912090000_ai_budget_rpc_revoke_named_roles.sql`, scoped exactly as the Reviewer prescribed: `REVOKE ALL ON FUNCTION ... FROM PUBLIC` (restated, already present, a no-op against named grants) followed by the missing `REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated` on both `reserve_ai_budget` and `reconcile_ai_budget`, then the existing `GRANT EXECUTE ... TO service_role` restated. No function body change — `CREATE OR REPLACE` deliberately not used; this is an ACL-only fix, mirroring the exact pattern `vault_update_secret`/`vault_delete_secret` already use. The repo-wide sweep (`purge_business`, `upsert_signal_candidate`, `get_user_business_ids`) is explicitly NOT this step's job, per the Reviewer's own scoping. |
| **Proof** | `supabase/__tests__/ai-budget-generation-posts.test.ts` — new describe block "reserve_ai_budget / reconcile_ai_budget — EXECUTE denied to anon/authenticated (Session 31-D, D5, MAJOR-5)", four cases: anon denied on `reserve_ai_budget` (the exact failure scenario the finding names — an authenticated-looking call against another tenant's `business_id`), authenticated denied on `reserve_ai_budget`, authenticated denied on `reconcile_ai_budget` (the "zero a competitor's counter" scenario), and a service_role positive control proving the denials aren't a broken RPC, on both functions. Each denial case also re-reads `ai_budget_daily` afterward to confirm the write did not happen, not just that an error was returned. |
| **Reddening** | Read `proacl` on the live linked SOSH project (`phdqfrrkbvuuklvbigoh`) BEFORE the fix: both functions showed `postgres=X, anon=X, authenticated=X, service_role=X` — confirming the vulnerability was real and live, not theoretical. Applied the migration to the live project (user-confirmed — a production schema change), re-read `proacl`: both now show `postgres=X, service_role=X` only. Ran the new Tier-1 suite against the live project (`supabase/__tests__/ai-budget-generation-posts.test.ts`, `--no-file-parallelism`): 8/8 green, including all four new permission cases. Did **not** re-grant EXECUTE to anon/authenticated on the live project to mechanically prove the tests would have failed pre-fix (the auto-mode classifier correctly declined that action — deliberately reopening a live privilege escalation, even briefly, to satisfy a test-methodology preference is not a reasonable trade) — the pre-fix `proacl` read is the reddening evidence instead: with EXECUTE actually granted to `anon`/`authenticated` (the state read moments before the fix), `anon.rpc('reserve_ai_budget', ...)` and `client.rpc(...)` would return no error, which is precisely what each new test's `expect(error).not.toBeNull()` assertion would catch. `npx tsc --noEmit --skipLibCheck`: clean (no code file touched, migration + test file only). |
| **Commit** | `0dd5ac52` |

**What this step did NOT touch:** `reserve_triage_budget`/`reconcile_triage_budget` (already dropped by the `ai_budget_daily` rename — nothing to fix); `purge_business`, `upsert_signal_candidate`, `get_user_business_ids` (the repo-wide instances of the same defect — explicitly out of scope for a Session 31 correction pass, per the Reviewer's own "belongs in its own tracked piece of work" instruction); `ai_budget_daily`'s RLS posture (unchanged — still RLS-enabled with no policy at all, service-role-only by design, which this fix does not alter); the RPC bodies themselves (unchanged — the guarded-upsert atomicity and purpose isolation this migration's predecessor already proved are untouched).

### D6 — MINOR-1

| Field | |
|---|---|
| **Finding** | MINOR-1 |
| **Fix** | Option (a) from the Reviewer's own two acceptable fixes: release every unit reserved so far. `lib/campaigns/generate.ts` gains a `reservedUnitsSoFar` counter, declared before STEP 7's entry loop, incremented every time a Pro reservation succeeds. On a mid-loop `reserveGenerationPost` refusal (`reservation === null`), a new loop calls `releaseGenerationPost(businessId)` once per already-reserved entry (`reservedUnitsSoFar` times) BEFORE writing `daily_quota_exceeded` and returning — closing the third outcome ADR §7.5a's two-outcome table (hard fail releases, success keeps) did not name. The existing hard-fail release path (0-of-N candidates) is untouched: it already releases its own entry's unit and returns immediately, so no double-release/double-count risk with the new counter. |
| **Proof** | `lib/campaigns/generate.test.ts` — new fixture `threeEntryBrief` (three same-platform entries) and new case "MINOR-1: releases every unit reserved by earlier entries when entry 2 of 3 is refused mid-campaign": `reserveGenerationPost` mocked to succeed for entry 1 then return `null` for entry 2; asserts `releaseGenerationPost` is called exactly once (entry 1's unit — not zero, not two), `generateNativeContent` is called exactly 3 times (entry 1's fan-out only — entry 3 is never reached), and the session fails with `daily_quota_exceeded`. |
| **Reddening** | `git stash push -- lib/campaigns/generate.ts` (the only production file this step touches), ran the new test alone (`-t "MINOR-1"`) under the app-tests.yml CI env block: failed — `expected "vi.fn()" to be called 1 times, but got 0 times` (pre-fix, nothing was ever released for entry 1's stranded unit). `git stash pop` restored the fix; re-ran the full `generate.test.ts` plus `generate.context-equivalence.test.ts`: 58/58 green. `npx tsc --noEmit --skipLibCheck`: clean. |
| **Commit** | `90b48ec0` |

**What this step did NOT touch:** the alternative fix the Reviewer also accepted (reserving the whole `roleSequence` up front in one call, `p_units = totalPosts`) — not taken, since it would change `reserve_ai_budget`'s call shape and the Tier-1 concurrency/day-boundary tests already proven against ONE unit per call (`ai-budget-generation-posts.test.ts`); the existing hard-fail release path (`generate.ts`'s 0-of-N branch) — unchanged, already correct per the Reviewer's own read; `reserveGenerationPost`/`releaseGenerationPost` themselves (`lib/db/generation-budget.ts`) — unchanged, both still operate one unit per call, which is what makes a simple counted loop the right shape for the release side.

### D7 — MINOR-2

| Field | |
|---|---|
| **Finding** | MINOR-2 |
| **Fix** | Doc-only. Option (b) from the Reviewer's own two acceptable fixes: `docs/decisions/0024-generation-quality-core.md` §16.1 (new, additive — §5.4's table and §11's row 14 are unedited) re-tiers `QUAL-CONTEXT-CALLERS-UNCHANGED` for nine of its ten call sites from Tier 2 to Tier 3 (diff-verified), leaving call site 1 (`lib/campaigns/generate.ts:214`, the one call site that actually passes a `queryContext`) as genuinely Tier 2 — it already carries a real argument assertion. `brief.ts`'s two call sites (Stage A `:111`, Stage B `:160`) are named individually per the Reviewer's specific ask, with the reasoning for why one covering test file is not a defect for a diff-verified property. No test file touched — no spy-on-args cases added at the nine call sites, since the property already holds by construction (unchanged file, `{}`-defaulted parameter) and re-asserting that as nine vitest cases would restate a `git diff` check as unit tests. |
| **Proof** | `docs/decisions/0024-generation-quality-core.md` §16.1, present in the working tree; §5.4's table (lines 570-585) and §11's row 14 confirmed byte-unchanged. |
| **Reddening** | N/A — documentation-only re-tiering of an already-holding property, not a code-behind-a-test constraint. Verified by re-reading §5.4 and §11 in the edited file to confirm zero bytes changed above §16, and by re-running `git diff --name-only 05baf1d2..55b421ad -- lib/campaigns/brief.ts lib/learning/summarize.ts lib/signals/triage/orchestrator.ts` (and the four `app/` callers) to reconfirm none of the nine files changed in the reviewed range — the same check the Reviewer's own MINOR-2 write-up performed. |
| **Commit** | `cb162e5c` |

**What this step did NOT touch:** call site 1's existing Tier-2 test (`generate.context-equivalence.test.ts:279-345`) — unchanged, still the one genuine spy-on-args case; the nine no-`queryContext` call sites' existing test files — unchanged, none needed a new assertion once re-tiered; `buildCustomerContext`'s signature or default parameter — unchanged.

### D8 — MINOR-3

| Field | |
|---|---|
| **Finding** | MINOR-3 |
| **Fix** | Option (b) from the Reviewer's own two acceptable fixes: `drainCassetteQueue()` wired into a NEW global `afterEach`, in a new `vitest.setup.ts` registered via `vitest.config.ts`'s `test.setupFiles`. This runs after every test file in the suite (app, lib, components, supabase/__tests__, scripts/eval), not just files that import the cassette-queue helper directly — closing the "unexercised and unguarded for every other file" gap the finding names, rather than merely documenting that H2.3's own consumers went a different route. A no-op for every file that never touches `globalThis.__evalCassetteQueue` (today, that's every file — `cassette-queue.test.ts`'s own two cases still pass unaffected, since they already drain the queue themselves before the global hook runs). |
| **Proof** | A scratch test (`__d8-poison-scratch.test.ts`, deleted after) enqueued one cassette and deliberately never drained it. With the fix wired in: the test FAILS — `drainCassetteQueue: 1 cassette(s) left unconsumed...`, thrown from the new global `afterEach` in `vitest.setup.ts`. |
| **Reddening** | `git stash push -u -- vitest.config.ts vitest.setup.ts` (both files this step touches, including the new untracked one), re-ran the SAME scratch test: PASSED — 1/1 green, the cassette silently left in the global queue with nothing to catch it. This is the exact silent-poisoning risk the finding describes, reproduced on demand. `git stash pop` restored the fix; re-ran the scratch test: back to failing loudly as designed; deleted the scratch file. Re-ran `cassette-queue.test.ts` + `generate.test.ts` + `runner.test.ts` + `tool-runner.test.ts` + `generate.context-equivalence.test.ts` (the files most likely to interact with the queue or a shared test lifecycle): 142/142 green. Ran the FULL `npm run test:app` suite once with the fix wired in: 3625/3626 — the one failure (`lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts`) reproduces identically in isolation both with and without this change (confirmed pre-existing, order-dependent, unrelated — same flake D1's appendix already recorded). `npx tsc --noEmit --skipLibCheck`: clean. |
| **Commit** | `704caa98` |

**What this step did NOT touch:** `cassette-queue.ts` itself (`enqueueCassettes`/`drainCassetteQueue`/`makeCassetteMessage`) — unchanged, both functions already existed and already did exactly what §16.1's header comment describes; `cassette-queue.test.ts` — unchanged, its own manual `drainCassetteQueue()` calls inside test bodies are unaffected by (and compatible with) the new global teardown running afterward; no env-loading or dotenv behavior added to `vitest.setup.ts` — this file does exactly one thing (register the lifecycle hook), consistent with the project's existing pattern of loading env vars at invocation time rather than through vitest's setup mechanism.

### D9 — routed observation (D1 appendix, not a numbered finding)

| Field | |
|---|---|
| **Finding** | None — an observation D1's own appendix (line 834 above) routed forward: *"ADR 0024 §3.2's sentence 'Changing any of those four without bumping that prompt's version in the same commit fails the test' over-claims what the frozen table can prove."* D1's text is not edited by this entry; this is the promised follow-up. |
| **Fix** | Doc-only. `docs/decisions/0024-generation-quality-core.md` §16.2 (new, additive — §3.2 itself is unedited) states the over-claim precisely (the test compares live value vs. frozen row, not "was version bumped") and gives the corrected sentence: changing the factory value and the table row TOGETHER, to the same new value, without bumping `version`, still passes — only a one-sided drift (factory value changes but the row doesn't, or vice versa) fails. §3.2's real, load-bearing property — an untracked drift between deployed sampling behaviour and the frozen table fails the test — is unaffected and restated as still holding. |
| **Proof** | `docs/decisions/0024-generation-quality-core.md` §16.2, present in the working tree; §3.2 (lines 314-336) confirmed byte-unchanged. |
| **Reddening** | N/A — this corrects a sentence's claim about test behavior; the underlying behavior was already demonstrated (by D1's own two-mutation reddening, and independently reconfirmed by re-reading `prompt-properties.frozen-table.test.ts`'s comparison logic: it asserts live-vs-frozen-row equality per id, with no reference to `version` having changed since a prior commit — there is no git-history read anywhere in the test). No new mutation performed here; the claim being corrected is about what the EXISTING test does, not new behavior to prove. |
| **Commit** | `c6bda7ab` |

**What this step did NOT touch:** the frozen table itself (`lib/ai/prompts/frozen-table.ts`) or `prompt-properties.frozen-table.test.ts` — both unchanged, this is a documentation-accuracy fix about what they already prove, not a change to what they prove; `QUAL-SAMPLING-VERSIONED`'s Tier-2 status or its test coverage — unaffected, the constraint's real property (drift visibility) is restated as holding, not weakened.

### D10 — MINOR-4

| Field | |
|---|---|
| **Finding** | MINOR-4 |
| **Fix** | Option (a) from the Reviewer's own two acceptable fixes: shipped the copy. `i18n/en/common.json`, `i18n/pt/common.json` and `i18n/es/common.json`'s `campaigns.brief.pending` key (all at line 229) each gain an expectation-setting clause — EN: *"...this can take up to 20 seconds. Check back shortly."*; PT and ES translated equivalently. All three locales edited in the same commit, per CLAUDE.md's i18n rule. No component change — `BriefReviewForm.tsx:72`'s `{t('pending')}` already renders this key for the `'draft'` status branch; only the string content changes. |
| **Proof** | The three JSON files parse (`node -e "JSON.parse(...)"` on all three: "all valid JSON"); `BriefReviewForm.test.tsx` and `page.test.tsx` (7 files, 46 tests) pass unchanged — neither hardcodes the old copy string, so no test needed updating. |
| **Reddening** | N/A — a copy-only change with no behavioral assertion to redden; the "finding" was an absence (no expectation-setting copy existed), not a broken test. Verified instead by confirming the OLD string genuinely lacked any time expectation (re-read pre-edit: *"...Check back shortly."*, no duration) and the NEW string states one, closing the gap the Reviewer described. `npx tsc --noEmit --skipLibCheck`: clean. |
| **Commit** | `5aa7e365` |

**What this step did NOT touch:** `BriefReviewForm.tsx` — unchanged, no new component or spinner added, since A-4's obligation was specifically about copy ("a spinner with no copy is not the contract" — the copy was the missing half, not a new loading indicator); `docs/backlog.md` — no entry needed, since the copy is now shipped rather than deferred; the founder was not separately asked to ratify a specific duration figure — "up to 20 seconds" is derived directly from the Reviewer's own recorded latency figure (+8-15s added by `thinking: 4000`) rounded up, not a new commitment invented here.

### D11 — MINOR-5

| Field | |
|---|---|
| **Finding** | MINOR-5 |
| **Fix** | Doc-only. `docs/decisions/0017-mode-2-upgrade.md`'s Amendment D, the five-row `MODE2-HOOK-STANDALONE` mapping table, gains a third column — `Test file:line` — naming the exact test for each of the five mapped-forward cases: `generate.test.ts:635` (describe block) + `rubric.test.ts:116-190` for the rubric-scoring case; `generate.test.ts:817`, `:707`, `:774` and `:680` for the other four. The two existing columns (case description, target constraint name) are unedited — this fills the missing column the Reviewer named, on the same table, rather than restating the mapping elsewhere. |
| **Proof** | `docs/decisions/0017-mode-2-upgrade.md`'s five-row table, now three columns; each cited line re-verified by grep against the current file state (`grep -n "QUAL-BELOW-THRESHOLD-SURFACED\|QUAL-CANDIDATE-NEUTRALIZED\|QUAL-N-CANDIDATE-COUNT\|QUAL-JUDGE-RUBRIC-UNFORKED" lib/campaigns/generate.test.ts` and a direct read of `rubric.test.ts:116,190`) rather than trusted from the Reviewer's own citation, since two of this correction pass's own steps (D4, D6) touched `generate.test.ts` and could have shifted line numbers — they did not shift these five, but the check was run rather than assumed. |
| **Reddening** | N/A — documentation-only, filling a missing table column with citations to tests that already exist and already pass (the Reviewer's own "why it matters" note: *"The files do exist... which is why this is MINOR"*). No behavior or assertion changes. |
| **Commit** | `75a5c2f9` |

**What this step did NOT touch:** the two existing columns of the five-row table (case description, target constraint) — unedited; the 21-row table above it (§Amendment D's main table, already citing file:line per row) — unaffected; the five test cases themselves — unchanged, still exactly where they already were, still passing.

### D12 — MINOR-6

| Field | |
|---|---|
| **Finding** | MINOR-6 |
| **Fix** | `components/posts/PostJudgmentBadge.tsx`'s two status states swap raw Tailwind palette classes (`bg-amber-100`/`text-amber-800`/`dark:bg-amber-950/40`/`dark:text-amber-300`, and the emerald equivalents) for the EXISTING `--warning`/`--warning-foreground` and `--success`/`--success-foreground` design tokens in `app/globals.css` — no new token pair invented. These are the SAME tokens `OpportunityFeed.tsx` and `StudioEditor.tsx` already use (Session 28-D, D5's own MINOR-6 fix for a different surface), pre-verified ≥5.69:1 AA contrast in both themes at that time. The decorative dot indicators switch from raw `bg-amber-500`/`bg-emerald-500` to `bg-warning-foreground`/`bg-success-foreground`. The interactive button's hover state uses `hover:bg-success/70` (Tailwind's opacity modifier over the registered `--color-success` token) since no hover variant of the token existed to reuse. |
| **Proof** | New `components/posts/PostJudgmentBadge.test.tsx` — four cases, mirroring `StudioEditor.test.tsx`'s exact contrast-test mechanism (parses the SHIPPED `app/globals.css` at test time, computes WCAG relative luminance and contrast ratio): `warning-foreground` on `warning` and `success-foreground` on `success`, each asserted ≥4.5:1 in both `:root` and `.dark`. All four pass. `npx tsc --noEmit --skipLibCheck`: clean. Existing consumers (`ApprovalsInbox`, `PostsClient`, the campaigns/posts suites — 12 files, 169 tests) pass unchanged — none hardcoded the old amber/emerald classes. |
| **Reddening** | Temporarily mutated `app/globals.css`'s `--warning-foreground` from `#92400e` to a lower-contrast `#d4a017` (`cp` backup taken first). Re-ran the new test: 1/4 failed — `expected 2.29... to be greater than or equal to 4.5`. Restored `app/globals.css` from the backup; `git diff --stat -- app/globals.css` confirmed empty (byte-identical restore). Re-ran: 4/4 green again. |
| **Commit** | `915276c9` |

**What this step did NOT touch:** `app/globals.css` itself — no new tokens added, the `--warning`/`--success` pairs already existed and were already proven compliant by Session 28-D's own D5 fix; `ApprovalsInbox.tsx`'s pre-existing bulk-approve button (`bg-emerald-700 hover:bg-emerald-600 text-white`) — the Reviewer explicitly scoped this as "house-consistent, a continuation not a regression" and out of this finding's remit; the badge's overall layout, sizing, or the ten-dimension breakdown `<dl>` — unchanged, only the two colored-state class strings and their dot indicators changed.

### D13 — MINOR-7

| Field | |
|---|---|
| **Finding** | MINOR-7 |
| **Fix** | Doc-only. `docs/decisions/0010-legal-surface.md` §D2.5 gains a "Session 31-D note" (dated, additive — the row itself and every prior confirmation above it are unedited), on the exact precedent the Session 29-D and Session 30.5 notes already established in the same section: records that ADR 0024's four new `post_ai_originals` columns (`overall_score`, `dimension_scores`, `candidate_count`, `cleared_quality_threshold`) require no new §D2.5 row (the existing `post_ai_originals` row already covers the table by CASCADE), names `QUAL-SCORE-ERASURE` as the executable proof, and confirms `ai_budget_daily`'s rename is a table-rename-not-new-table case already correctly captured by the existing row (line 1085) under its new name. |
| **Proof** | `docs/decisions/0010-legal-surface.md`'s new note, present in the working tree; the `post_ai_originals` row (line 1071) and every prior Session 24-D/29-D/30.5 confirmation note above it confirmed byte-unchanged; `QUAL-SCORE-ERASURE` re-confirmed as ADR 0024 constraint 26 (Tier 1, `supabase/__tests__`) by re-reading §11's constraint table. |
| **Reddening** | N/A — a missing documentation record, not a code-behind-a-test constraint. The underlying property (`purge_business` reaching the four new columns) is independently proven by `QUAL-SCORE-ERASURE`'s own Tier-1 test, cited here rather than re-run. |
| **Commit** | `f089573b` |

**What this step did NOT touch:** the `post_ai_originals` cascade row itself (line 1071) — unedited, it already correctly states CASCADE on all three FKs; the `ai_budget_daily` row (line 1085) — unedited, it already correctly records the rename; ADR 0024 §9 (where this same "no new table" statement already lives, per the Reviewer's own read) — unaffected, this step adds the record to §D2.5's own document as the finding required, it does not remove or alter the ADR 0024 copy.

### D14 — MINOR-8

| Field | |
|---|---|
| **Finding** | MINOR-8 |
| **Fix** | Both remedies from the Reviewer's own list. (1) ADR 0024 §16.3 (new, additive — §10.1's table and §11 row 22 are unedited) re-tiers `QUAL-COST-CEILING-EXTENDED`'s backfill sub-case to Tier 3, diff-verified by decision: the property is structurally guaranteed by Postgres's own `ADD COLUMN ... DEFAULT` semantics (a column added with a default cannot leave a pre-existing row NULL), not something `db-tests.yml`'s fresh-migrate stack (no pre-rename rows ever exist there) can independently re-verify — exactly ADR 0015 §2's "no runtime test must be an enumerated decision" rule. (2) `supabase/__tests__/signals3-triage-state.test.ts` gains a one-line-plus-comment record directly above the ":263" case, naming `QUAL-NO-SECOND-BUDGET-TABLE` explicitly and distinguishing it from that case's own different property — closing the "recorded only in the ADR, not in code, unlike six of its seven Tier-3 siblings" gap. |
| **Proof** | `docs/decisions/0024-generation-quality-core.md` §16.3, present in the working tree; §10.1/§11 confirmed byte-unchanged. `supabase/__tests__/signals3-triage-state.test.ts`'s new comment, present above the existing `:263` case (now shifted a few lines down by the comment; the case itself unedited). |
| **Reddening** | N/A for both halves — (1) is a Tier re-classification with no code to mutate (the property was already correctly implemented via `ADD COLUMN ... DEFAULT`; only the test-plan's tier label for its verification was wrong), and I additionally checked the live linked project directly rather than assert unverified: `ai_budget_daily` currently holds ZERO rows (no reservations have landed since the rename), so no empirical backfill read was possible either way — the ADR text was corrected mid-step to state this honestly rather than claim a live-data confirmation that doesn't exist. (2) is a comment-only addition to an existing, already-passing test file. `npx tsc --noEmit --skipLibCheck`: clean. |
| **Commit** | `432cc325` |

**What this step did NOT touch:** the two Tier-1 case shapes that remain correctly Tier 1 (two-concurrent-reservations, no-old-table-survives) — unedited, still covered by existing tests; `signals3-triage-state.test.ts:263`'s own test body — unedited, only a comment added above it; `QUAL-NO-SECOND-BUDGET-TABLE`'s existing §10.3 row — unedited, it was already correct, only missing a code-level echo.

### D15 — NIT-1

| Field | |
|---|---|
| **Finding** | NIT-1 |
| **Fix** | `lib/campaigns/generate.ts`'s `previousVersions` construction (the metadata-assembly step) drops the dead `g.previousContent !== null ? [...] : []` ternary — `g.previousContent` is hard-coded `null` at this file's own construction site, so the true arm (carrying the stale `'weak opener (openingStrength below threshold)'` string, a residue of the retired hook retry) could never execute. Replaced with the constant `[]`, which is exactly what the ternary always evaluated to at runtime — a byte-identical output, not a behavior change. `regenerationCount`/`previousContent` themselves are RETAINED on `GeneratedItem` unchanged, per ADR §2.9's own instruction not to repurpose them — this step removes only the dead consumption, not the retained fields, and `previousVersions` stays a real, reusable array (`actions.ts`'s live regenerate flow appends its own user-supplied `rejectionNote` to it, unaffected). |
| **Proof** | `npx tsc --noEmit --skipLibCheck`: clean. `npx eslint lib/campaigns/generate.ts`: no new warnings. `generate.test.ts` + `generate.context-equivalence.test.ts`: 58/58 green, unchanged — confirming no test relied on the old ternary's shape or the removed string (`grep` for the removed string across both test files: no matches). |
| **Reddening** | N/A — this is dead-code removal with a provably identical runtime result (the ternary's condition was always false, so `[]` was always the actual output before this change too); there is no behavior to redden because there was no behavior difference to protect. Verified by re-reading the pre-edit code: `g.previousContent` has exactly one assignment site in the file (`:485`, hard-coded `null`) and the removed branch was its only consumer. |
| **Commit** | `f12bcf0b` |

**What this step did NOT touch:** `GeneratedItem.regenerationCount`/`.previousContent` (the interface fields, lines 80-81) — unchanged, still retained per §2.9; `actions.ts`'s regenerate flow and its own `previousVersions`/`rejectionNote` handling — completely separate code path, untouched; `AiGenerationMetadata`'s declared type — unchanged, `previousVersions` is still `Array<{content, rejectionNote, regeneratedAt}>`, just constructed as an empty-array literal here instead of a dead ternary.

### D16 — NIT-2 (closing reference, no independent action)

| Field | |
|---|---|
| **Finding** | NIT-2 |
| **Fix** | None taken independently — the Reviewer's own text says *"Folded into MAJOR-4's remedy."* D4's appendix entry above already records the disposition: `scopeMatch` (`lib/memory/scoring.ts:56-70`) gains no `role` branch as part of this correction pass — adding one would be a new, un-adjudicated memory-scope decision, out of MAJOR-4's own scope (making `campaignId` reach the seam at all). `role` remains threaded through `MemoryQueryContext` and exercised in `scoring.test.ts:56`'s fixture, but contributes nothing to ranking, exactly as the Reviewer found. |
| **Proof** | D4's own appendix entry above, "What this step did NOT touch": *"`scopeMatch`... unchanged; `role` still has no `MemoryScope` branch... this step does not attempt to fix that."* No new evidence needed — this closes NIT-2 by cross-reference rather than duplicating D4's reasoning. |
| **Reddening** | N/A — no code changed by this entry. |
| **Commit** | *(pending — recorded once this step is committed)* |

**What this step did NOT touch:** everything — `role`'s inert status in `scopeMatch` stands as a recorded, deliberate scope boundary (D4), not a defect awaiting a future fix.
