# Session 18B-3 — Reviewer Report (Parallel TS + Regression)

**Scope:** Six behaviour-preserving type-quality refactors — B18-010, B18-030, B18-041, B18-069, B18-070, B18-071.
**Range reviewed:** `ee83360..70371bf` (9 code commits + triage-close), every changed file read in full.
**Method:** Two lenses (typescript-reviewer + regression/behavioural-equivalence), diff read line-by-line, not commit messages.
**Build state:** `tsc --noEmit --skipLibCheck` clean for SOSH (only the known ECC remotion errors remain). `vitest run lib/db lib/social lib/validation lib/campaigns` → **489 passed / 0 failed**. No test files were added or modified in this range.

## Counts

| Tier | Count |
|---|---|
| **B** (regression / locked-design deviation) | **0** |
| **H** (cast survives / missed site / CLAUDE.md) | **2** |
| **M** | 4 |
| **L** | 2 |

---

## B — Behavioural regressions / locked-design deviations

**None.** The two highest-risk checks pass:

- **R1 (timestamp equivalence) — PASS, explicitly verified.** The triage *description* for B18-041 proposed `date-fns formatISO()`. The Builder correctly **did not** use it — `formatISO(new Date())` emits a **local UTC-offset** string, which would have silently changed every former `.toISOString()` value (UTC `Z`, ms precision) at DB/API boundaries. Instead the Builder added `toUtcIso(d) { return d.toISOString() }` (`lib/utils.ts:8-10`), so the emitted string is **byte-identical** to pre-refactor at all ~8 sites (`cron-health`, `auth-rate-limits`, `ai-usage`, `metrics ×2`, `schedule`, `_health/route`, `campaigns/[id]/page`). This is the right call and matches the agreed wrapper strategy. No boundary regression.
- **R2 (limits not moved) — PASS.** `lib/campaigns/enforcement.ts` now reads `getPlanCapabilities('plus').activeCampaigns ?? Infinity`. `lib/stripe/plan.ts:54` defines `plus.activeCampaigns: 5`, identical to the deleted `PLUS_CAMPAIGN_LIMIT = 5`. The 50-posts cap was not touched. No value reconciled or moved.

---

## H — High

### H1 — B18-030: three `(error as {message}).message` casts survive *inside `lib/db/`* (the item's own scope)
B18-030 is marked **CLOSED** and T2 requires zero survivors, but a tree grep finds the exact anti-pattern still present in-scope, missed because the sweep matched the variable name `error` and these sites alias it:

- `lib/db/businesses.ts:199` — `(fetchError as { message: string }).message`
- `lib/db/posts.ts:135` — `(readError as { message: string }).message`
- `lib/db/posts.ts:397` — `(readError as { message: string }).message`

No behavioural change (they keep the old behaviour), so this is H not B — but the item should not be closed with three in-scope casts left untouched. Replace with `getErrorMessage(...)`.

### H2 — B18-070: the downstream cast the item exists to remove still survives
B18-070's stated deliverable (triage) is *"Define a named union, **removes a downstream cast**."* The union (`PostActionErrorCode`) was added and `PostActionState.error` was narrowed correctly — but the consumer cast is **not** removed:

- `components/posts/RegenerateDialog.tsx:51` — `const key = result.error as 'not_eligible' | 'quota_exceeded' | 'generic' | undefined`

`RegenerateDialog.tsx` is absent from the diff. Two problems:
1. The promised removal did not happen — the item is closed with its deliverable unmet.
2. The retained cast is now **unsound**: `result.error` is `PostActionErrorCode` which includes other `AiErrorCode` values (e.g. `'rate_limited'`, `'rate_limit'` via `return { error: e.code }` at `actions.ts:272`). The cast asserts those are impossible; at runtime they fall through to `t('regenerate.error.generic')`.

R5 note: this generic-fallthrough is **pre-existing** (error was `string` before), so **no regression** — but the fix was not delivered. Recommend narrowing by comparison instead of casting.

*Union integrity (T3) otherwise checks out:* producers are exactly `invalid_input`, `generic`, `not_eligible`, and `e.code: AiErrorCode` (incl. `quota_exceeded`) — every producer is a member; members are reachable.

---

## M — Medium

- **M1 — B18-030 anti-pattern also survives in `lib/ai/metrics.ts:17` and `:39`.** Out of the commit's literal "db" scope, but it is the same `(error as {message}).message` the rule targets, in a file B18-041 already edited this session. Fold into the H1 cleanup.
- **M2 — B18-071 helper does not narrow field-by-field (T4).** `parseAiGenerationMetadata` (`lib/db/utils.ts:12-15`) does an object/null check then `return raw as Partial<AiGenerationMetadata>`. This guarantees the *container* is an object but leaves every field a blind `as` — `regenerationCount` is typed `number` while the runtime value is unvalidated. The "latent-any" concern is only half-discharged. Behaviourally safe; flag as quality debt.
- **M3 — B18-071 changes the null-metadata default at one call site (R6).** `PostCard.tsx` previously did `post.ai_generation_metadata as Partial<…>` with **no** `?? {}`; for `null` metadata `meta` became `null` and `(meta.regenerationCount ?? 0)` would have thrown. The helper now returns `{}`, so the path is safe. This is a behaviour change vs literal pre-refactor output, but a **strict improvement** (latent null-deref fix), and the other call site (`actions.ts`, old `?? {}`) is unchanged. Downgraded from B to M on that reasoning.
- **M4 — No regression tests added.** Two new exported helpers (`getErrorMessage`, `parseAiGenerationMetadata`) and a new error-code union ship with zero direct unit tests; equivalence rests on the existing 489-test suite. For a session whose sole risk is silent behaviour drift, a couple of targeted asserts (esp. `getErrorMessage({message: 42})` → `String()` path, and the null-metadata default) would lock the contract.

---

## L — Low

- **L1 — `getErrorMessage` degenerate-case divergence.** When an error carries no string `message`, old code yielded `new Error(undefined)` → `''`; new code yields `String(error)` (e.g. `"[object Object]"`). Supabase/Postgrest errors always carry a string `.message`, so no real-world divergence — and the narrowing order (`instanceof Error` → `typeof msg === 'string'` guard → `String()`) is exactly correct; `{message: 42}` correctly falls through to `String()`. Improvement, noted only for completeness.
- **L2 — Mixed date convention persists.** The new lint rule bans only `.toISOString()`; `formatISO(new Date())` (local offset) remains in `businesses.ts`, `campaigns.ts`, `posts.ts`. Pre-existing and out of scope, but the codebase now has two UTC/local date idioms side by side — worth a tracking item so the B18-041 intent isn't undercut later.

---

## Verdict

No behavioural regressions and no locked-design deviations (B = 0); the timestamp-equivalence and limit-value checks both pass cleanly, and the Builder's deviation from the triage's `formatISO` wording was the correct one. **However, two of the six items are marked CLOSED without fully delivering:** B18-030 leaves three in-scope error casts (H1) and B18-070's promised downstream-cast removal never happened (H2). Recommend reopening B18-030 and B18-070 for a short correction pass before the close stands; M1–M4 can ride along.

---

## Correction pass — 18B-3D (2026-06-18)

All B/H findings resolved.

| Finding | Resolution |
|---------|-----------|
| **H1** — 3 aliased error casts missed by B18-030 sweep | Pattern-matched sweep: replaced `fetchError`/`readError` aliases in `lib/db/businesses.ts`, `lib/db/posts.ts` (×2), and `(error as {message})` in `lib/ai/metrics.ts` (×2). |
| **H2** — `result.error as '...'` cast in `RegenerateDialog.tsx:51` | Unsound cast removed; replaced with `regenerateErrorKey()` comparison switch — same runtime behaviour, unmatched codes fall through to generic key. |
| **M4** — no unit tests for new helpers | Direct unit tests added for `getErrorMessage` (5 cases) and `parseAiGenerationMetadata` (4 cases) in `lib/db/utils.test.ts`. |
| **M3 (B18-071)** — `PostCard` null-metadata default | Changed `null → {}` (strict improvement; latent null-deref fix). |
| **L2 → B18-089** — `formatISO(new Date())` mixed convention | Filed as new triage item B18-089 (P2); `formatISO` sites in `businesses.ts`/`campaigns.ts`/`posts.ts` deferred to a follow-up sweep. |
