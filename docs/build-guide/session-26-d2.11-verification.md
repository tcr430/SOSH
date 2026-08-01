# Session 26 · D2.11 — Close-out verification (ADR 0019, Track D)

Range verified: `de425283..a4b632a1` (D2.1 through D2.10, this branch). All commands and
`git diff`/`git show` citations below are against that range.

## 1. Baseline checks

- `npx tsc --noEmit --skipLibCheck` — clean, zero errors.
- `npm run test:app` — 176/176 files, 2477/2477 tests green (two independent full runs during this
  step, both fully green; a single unrelated flaky timeout on `PostsClient.test.tsx` was observed and
  cleared in an EARLIER D2.10 run, confirmed by standalone re-run — see D2.10's own commit history).
- `npm run test:db` — **could not be executed locally this session**: the Docker daemon is unreachable
  from this sandboxed shell (`failed to inspect container health: ... the docker client must be run with
  elevated privileges`, confirmed via both `npx supabase status` and a direct `docker info`/`docker ps`,
  the latter reporting `docker: command not found`). This is an environment limitation, not a code
  issue. Per this step's own final instruction, the authoritative Tier-1 execution is the CI run
  triggered by pushing this range — see §5 for the run URL and executed count.

## 2. Two verification-integrity fixes made during this step

`ecc:pr-test-analyzer` (invoked once, scope: all 21 `STUDIO-*` constraints' tests, specifically hunting
for vacuous-pass risk) surfaced two real gaps, both fixed in this range rather than deferred to Review:

1. **`lib/learning/memory-table-boundary.test.ts`'s vacuity guard was aggregate-only.**
   `expect(files.length).toBeGreaterThan(0)` summed across all three `SCAN_ROOTS`
   (`lib/learning/**`, the capture-learning cron route, `lib/studio/**`). Since `lib/learning/**` alone
   is always non-empty, the guard could never independently prove the `lib/studio/**` root — the one
   `STUDIO-MEMORY-THROUGH-BOUNDARY` actually depends on — contributed any files at all. A mistyped or
   relocated studio path would silently stop being scanned while this test kept passing. **Fixed**: each
   root is now asserted non-empty individually before the combined scan runs.
2. **`lib/studio/verify.test.ts` scan 1's `CAST_PATTERN` didn't cover `GovernedPerformancePattern`.**
   The scan already caught `as VerifiedMemorySource`/`as RenderedSuggestion` casts outside `verify.ts`,
   but `STUDIO-CITATION-GOVERNED-ONLY`'s structural-inadmissibility claim rests on a THIRD type
   (`GovernedPerformancePattern`, `lib/memory/performance.ts`) that the scan never named. **Fixed**:
   `as GovernedPerformancePattern` / `as unknown as GovernedPerformancePattern` added to the pattern.
   This is defense-in-depth, not the sole guarantee — see the constraint table below for the real
   runtime proof this backs up.

Both fixes re-verified green: `npx vitest run lib/learning/memory-table-boundary.test.ts
lib/studio/verify.test.ts` → 20/20 passing, and the full `npm run test:app` re-run above already
includes them.

**One finding investigated and closed as a non-issue**: `ecc:pr-test-analyzer` initially flagged
`STUDIO-CITATION-GOVERNED-ONLY` as compile-time-only (a `@ts-expect-error` block in `verify.test.ts`
with no runtime construct-and-reject case), because its search was scoped to `verify.test.ts`. Reading
`lib/memory/performance.test.ts:295-304` directly shows a REAL runtime test: `retrieveStudioPerformancePatterns`
is exercised with an empty `performance_memory` mock and asserted to (a) return `[]` and (b)
`expect(postMetricsDb.listTopPostMetrics).not.toHaveBeenCalled()` — i.e. it proves the function never
even reaches for the fallback data source, not just that it doesn't return fallback-shaped rows. This
REDDENS on any future fallback-branch regression regardless of the compile check. The constraint has
both a compile-time proof (this type cannot be constructed) and a behavioural proof (this function
never takes the fallback path) — not vacuous.

## 3. Constraint table — all 21 `STUDIO-*` constraints (ADR §14)

| Constraint | Test file | Tier | Executing CI job | Reddens if broken? |
|---|---|---|---|---|
| `STUDIO-NO-MODEL-OFFSETS` | `lib/ai/prompts/studio-suggestion.ts` (schema inspection) | Tier 3 | none (decision) | n/a — confirmed by inspection, §4 below |
| `STUDIO-DIFF-DETERMINISTIC` | `lib/studio/diff.test.ts` | Tier 2 | `app-tests.yml` | Yes — committed corpus + repeated-invocation equality |
| `STUDIO-MARKER-FORGERY-SAFE` | `lib/studio/markers.test.ts` | Tier 2 | `app-tests.yml` | Yes — pure-ASCII confused-deputy case asserts non-render |
| `STUDIO-DRAFT-DATA-GUARDED` | `lib/studio/guard.test.ts` | Tier 2 | `app-tests.yml` | Yes — order-of-operations + variation-selector cases |
| `STUDIO-CITATION-VERIFIED` | `lib/studio/verify.test.ts` | Tier 2 | `app-tests.yml` | Yes — real claim/reject/demote cases against constructed data |
| `STUDIO-CITATION-UNFABRICABLE` | `lib/studio/verify.test.ts` (`@ts-expect-error` + 3 source scans) | Tier 2 | `app-tests.yml` | Yes — all 3 scans assert non-empty file set before asserting zero offenders |
| `STUDIO-CITATION-GOVERNED-ONLY` | `lib/studio/verify.test.ts` (compile) + `lib/memory/performance.test.ts:295-304` (runtime) | Tier 2 | `app-tests.yml` | Yes — see §2's non-issue writeup |
| `STUDIO-RUBRIC-DIMENSIONS-FIXED` | `lib/studio/categories.test.ts` | Tier 2 | `app-tests.yml` | Yes — asserts derived enum equals the 10 rubric keys minus exactly 2 |
| `STUDIO-ONE-CALL-PER-CLICK` | `app/[locale]/(dashboard)/studio/actions.test.ts` | Tier 2 | `app-tests.yml` | Yes — `toHaveBeenCalledTimes(1)` |
| `STUDIO-TIER-1-CEILING` | n/a (schema/call-path inspection) | Tier 3 | none (decision) | n/a — confirmed by inspection, §4 below |
| `STUDIO-MEMORY-THROUGH-BOUNDARY` | `lib/learning/memory-table-boundary.test.ts` | Tier 2 | `app-tests.yml` | Yes, now with the per-root guard (§2 fix 1) |
| `STUDIO-MODE2-FLOW-UNCHANGED` | Tier 3 (no diff) + `campaigns/new/actions.test.ts` (unchanged, still green) | Tier 3 + Tier 2 | none / `app-tests.yml` | n/a for the diff claim (§4); Yes for the Tier-2 half |
| `STUDIO-MODE3-NOT-ROUTABLE` | Tier 3 (no route file) + `create/page.test.tsx` | Tier 3 + Tier 2 | none / `app-tests.yml` | Yes — asserts disabled `<button>`, no `href`, reason-stating `aria-label` |
| `STUDIO-STALE-SUGGESTION-GUARDED` | `supabase/__tests__/studio-drafts.test.ts` | **Tier 1** | `db-tests.yml` | Yes by design (both races asserted); **not locally executed this session — see §1** |
| `STUDIO-LEARNING-REUSED` | `studio-drafts.test.ts` (negative form) + `memory-table-boundary.test.ts` | Tier 1 + Tier 2 | `db-tests.yml` / `app-tests.yml` | Yes; Tier-1 half not locally executed this session |
| `STUDIO-RLS-ISOLATED` | `supabase/__tests__/studio-drafts.test.ts` | **Tier 1** | `db-tests.yml` | Yes by design; not locally executed this session |
| `STUDIO-CASCADE-COMPLETE` | `supabase/__tests__/studio-drafts.test.ts` | **Tier 1** | `db-tests.yml` | Yes by design; not locally executed this session |
| `STUDIO-CACHE-PREFIX-STABLE` | `lib/ai/prompts/studio-suggestion.test.ts` | Tier 2 | `app-tests.yml` | Yes — bidirectional containment + system-prompt identity check |
| `STUDIO-TRUNCATION-DISTINGUISHED` | `lib/ai/runner.test.ts` + `actions.test.ts` | Tier 2 | `app-tests.yml` | Yes — distinct error code asserted before the parse step |
| `STUDIO-NO-MODEL-TEXT-IN-LOGS` | `actions.test.ts` (message never returned) + Tier 3 (no `console.*`) | Tier 2 + Tier 3 | `app-tests.yml` / none | Yes for the tested half; §4 for the scan half |
| `STUDIO-RUNNER-DEFAULT-PRESERVED` | `lib/ai/runner.test.ts:654-690` | Tier 2 | `app-tests.yml` | Yes — enumerates exactly 8 real prompt objects + a positive override proof |

**21/21 constraints mapped.** Every Tier-2 row above is currently executing green in `app-tests.yml`
(confirmed by the two full `test:app` runs in §1). Every Tier-1 row is asserted to redden by design
(read directly from `supabase/__tests__/studio-drafts.test.ts`) but was not re-executed against live
Postgres in this local session — §5 records the CI run that does.

## 4. Tier-3 diff-verified properties (ADR §13.3) — confirmed by inspection, recorded as decisions

1. **`STUDIO-MODE2-FLOW-UNCHANGED`** — `git diff de425283..a4b632a1 -- "app/[locale]/(dashboard)/campaigns/new/page.tsx" ".../CampaignForm.tsx" ".../actions.ts"` returns empty. Confirmed.
2. **`STUDIO-MODE3-NOT-ROUTABLE`** — no file matching `*signal*` exists anywhere under `app/[locale]/(dashboard)/`; no route directory for a Mode-3 surface exists. Confirmed.
3. **`STUDIO-TIER-1-CEILING`** — `grep` over `lib/studio/**`, the Studio routes, and `lib/ai/prompts/studio-suggestion.ts` for `tool_use`/`tools:`/retry-on-parse constructs finds none; the only loops present (`lib/studio/diff.ts`, `markers.ts`, `verify.ts`, `actions.ts`) are ordinary array iteration, never a repeated model call. `suggestStudioSuggestions` calls `runPrompt` exactly once (also proved at Tier 2, `STUDIO-ONE-CALL-PER-CLICK`). Confirmed.
4. **`STUDIO-NO-MODEL-OFFSETS`** — `lib/ai/prompts/studio-suggestion.ts`'s `StudioSuggestionOutputSchema` has no offset/position field; the marker syntax is the only span-location mechanism (`lib/studio/markers.ts`). Confirmed.
5. **No new dependency other than `diff`, no caret** — `git diff de425283..a4b632a1 -- package.json` shows exactly one new dependency line: `"diff": "9.0.0"` (no caret, exact pin). Confirmed.
6. **No `console.*`, no `dangerouslySetInnerHTML`, no HTML-returning diff API** in `lib/studio/**` or the Studio routes/components — `grep -rn` for all three patterns across `lib/studio`, `app/[locale]/(dashboard)/studio`, `components/studio` returns matches only inside comments (documenting the prohibition itself, e.g. `DiffView.tsx`'s own header comment), never live code. Confirmed.

## 5. `posts` unmodified (ADR §2.7)

`git diff de425283..a4b632a1 -- supabase/migrations/*posts* lib/db/posts.ts` — empty.
`git diff de425283..a4b632a1 -- lib/db/types.ts` shows `PostUpdate`'s own definition line unchanged;
the only diff in that file is new content appended AFTER it (the `studio_drafts` section). Confirmed:
`posts` is untouched anywhere in the range.

## 6. SHARED-FUNCTION CALLERS tables (ADR §13.4)

### `runPrompt` — one row per existing prompt object (verified against `lib/ai/runner.test.ts:654-690`)

| Prompt object | Sets `maxTokens`? | Call site(s) |
|---|---|---|
| `postGenerationPrompt` | No (resolves to 4096) | Exported via `lib/ai/index.ts`; no active runtime call site found in this range (superseded by the native-format-family prompts below) — still defensively covered by the runner test |
| `postRegenerationPrompt` | No | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:299` |
| `rubricPrompt` | No | `lib/campaigns/brief.ts:170`; `lib/campaigns/generate.ts:263` |
| `briefAssemblyPrompt` | No | `lib/campaigns/brief.ts:113` |
| `learningSummarizerPrompt` | No | `lib/learning/summarize.ts:141` |
| `brandVoiceInferencePrompt` | No | `onboarding/infer-brand-voice/actions.ts:28`; `settings/voice/refine-from-posts-action.ts:43` |
| `createNativeGenerationPrompt('single')` | No | `lib/ai/generate-native.ts` (×2 call sites, initial + correction retry) |
| `createNativeGenerationPrompt('thread')` | No | `lib/ai/generate-native.ts` (×2 call sites, initial + correction retry) |
| `studioSuggestionPrompt` | **Yes** (`STUDIO_SUGGEST_MAX_TOKENS = 8192`) | `app/[locale]/(dashboard)/studio/actions.ts:105` — the only prompt in the repo that sets it |

`STUDIO-RUNNER-DEFAULT-PRESERVED` proves all 8 non-Studio objects above resolve to exactly 4096 via
`??`, and a separate positive-override test proves the `??` branch is live code, not dead.

### `neutralize` / `wrapEvidenceForPrompt`

| Function | Change | Callers | Covered by |
|---|---|---|---|
| `neutralize` (`lib/ai/wrap-evidence.ts:83`) | Unchanged | `lib/campaigns/brief.ts` (×3 sites), `lib/ai/prompts/learning-summarizer.ts` (×2), `lib/ai/prompts/post-generation.ts`, `lib/ai/prompts/post-regeneration.ts`, `lib/campaigns/generate.ts` | Existing tests for each caller — unchanged |
| `neutralizeWithSentinels` (new sibling, `:117`) | New export | `lib/studio/guard.ts` only | `lib/studio/guard.test.ts` |
| `wrapEvidenceForPrompt` (`:171`) | Unchanged | `lib/ai/generate-native.ts`; `lib/campaigns/brief.ts` (×2 sites); **new**: `app/[locale]/(dashboard)/studio/actions.ts:96` | Existing wrap-evidence tests (unchanged) + `actions.test.ts` for the new caller |

### `retrievePerformancePatterns` / `retrieveRelevant`

| Function | Callers | Covered by |
|---|---|---|
| `retrievePerformancePatterns` (`lib/memory/performance.ts:45`, aka `retrieveRelevant`) | `lib/ai/context.ts:59` (`buildCustomerContext`) — transitively `lib/campaigns/brief.ts`, `lib/campaigns/generate.ts`, `lib/learning/summarize.ts` | `lib/campaigns/generate.context-equivalence.test.ts` + existing `performance.test.ts` — unchanged shape for existing callers (MEM-CONTEXT-EQUIVALENT) |
| `retrieveRelevant` (audience/brand/evidence variants — `lib/memory/{audience,brand,evidence}.ts:12`) | `lib/campaigns/brief.ts:94` (evidence) and existing memory-barrel callers | Existing tests — unchanged |
| `retrieveStudioPerformancePatterns` (new, `lib/memory/performance.ts:134`, governed-only) | **New**: `app/[locale]/(dashboard)/studio/actions.ts:92` only | `lib/memory/performance.test.ts:270-325` — mints rows, never falls back, routes only through the active-filtered reader |
| `retrieveEvidenceMemory` | `lib/campaigns/brief.ts:94`; **new**: `app/[locale]/(dashboard)/studio/actions.ts:93` | Existing tests + `actions.test.ts` for the new caller |

### The five `posts` functions Studio does NOT call

| Function | Studio calls it? | Existing callers (unaffected) | Covered by |
|---|---|---|---|
| `createPosts` (`lib/db/posts.ts:288`) | No | `lib/campaigns/generate.ts:380` | `lib/db/posts.test.ts`, `lib/campaigns/generate.test.ts` — unchanged |
| `updatePostContent` (`:473`) | No | `campaigns/[id]/posts/actions.ts:195`; `calendar/actions.ts:254` | `lib/db/posts.test.ts` — unchanged |
| `updatePostContentAndMetadata` (`:497`) | No | `campaigns/[id]/posts/actions.ts:371` | `lib/db/posts.test.ts` — unchanged |
| `approvePost` (`:320`) | No | `campaigns/[id]/posts/actions.ts:97`; `calendar/actions.ts:280` | `lib/db/posts.test.ts`; `supabase/__tests__/posts-approval-boundary.test.ts` — unchanged |
| `bulkApproveDraftPosts` (`:526`) | No | `campaigns/[id]/posts/actions.ts:221` | `lib/db/posts.test.ts`; `posts.bulk-approve-url-budget.test.ts`; `supabase/__tests__/posts-approval-boundary.test.ts` — unchanged |

Verified via `grep -rn "createPosts\|updatePostContent\|approvePost\|bulkApproveDraftPosts"` over
`lib/studio/**` and the Studio routes: zero matches. `lib/studio/memory-table-boundary.test.ts`'s scan
also structurally forbids the adjacent memory-table shortcut this same discipline protects against.

## 7. CI execution

Pending push — see the D2.11 commit message for the recorded `app-tests`/`db-tests` run URLs and the
`db-tests` executed count (skip-guard).
