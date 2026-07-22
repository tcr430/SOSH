# Session 18B-5 — Reviewer Report

**Reviewer lens:** per-item conformance, behaviour-preservation, scope discipline, and soundness of the Step 0 VERIFY conclusions.
**Method:** read the diff (`da8c26e..HEAD`, 5 commits: `eb912a7`, `61ad436`, `9c05706`, `3bd4059`, `1cfa9f1`) and the triage — **not** the commit messages. Independently ran `tsc`, `eslint`, `vitest`, and re-derived every verify conclusion from migrations / source.

> **Note on scope source:** there is no `session-18.md` in the repo (only `session-18-triage.md`). The "21 items / locked design choices" required-reading doc does not exist as a file, so item scope is inferred from the triage P1-CHEAP set + the IDs named in this Reviewer brief. Findings that depend on that inference are flagged.

## Counts

| Tier | Count |
|---|---|
| **B (block)** | 3 |
| **H (high)** | 3 |
| **M (medium)** | 3 |
| **L (low)** | 3 |

**Verification gate status (independently run):**
- `npx tsc --noEmit --skipLibCheck` → **green for SOSH** (only the known ECC `remotion` errors, out of scope).
- `npx vitest run lib/db lib/social lib/validation lib/ai lib/email` → **RED: 15 failed / 820 passed** (all 15 in `lib/email` snapshots — see B1).
- `npm run lint` (`eslint`) → **RED: net-new errors from this batch** in `lib/db/utils.ts` (B2) and the 4 `STRIPE_CLIENT_INTERNALS_BAN` sites (B3). (Pre-existing, unrelated errors also exist in `app/[locale]/error.tsx`, `app/global-error.tsx`, and a marketing `<a>`-to-`/` — not introduced by 18B-5.)

The CLAUDE.md-prescribed *narrow* loop (`npx vitest run lib/db lib/social lib/validation`) passes — but this batch edited `lib/email/templates/_layout.tsx` and `eslint.config.mjs`, so the narrow command was insufficient and masked all three blockers.

---

## B — Block before merge

### B1 · B18-002 — footer 14px change left 15 email snapshot tests RED
`lib/email/templates/_layout.tsx` footer `fontSize` was changed `13px → 14px` (correct per WCAG 1.4.4 — the change itself is right). But the committed snapshots still expect `13px`; they were **not** regenerated. `npx vitest run` now fails:

```
Snapshots  15 failed
Test Files  5 failed | 50 passed | 2 skipped
      Tests 15 failed | 820 passed
```

Diff of a failing snapshot: `font-size:13px` (expected) vs `font-size:14px` (received) in the footer `<p>` blocks. Every email-template snapshot inherits `EmailLayout`, so all 15 break.
**Fix:** regenerate with `vitest -u` and commit the snapshots (after eyeballing the diff is footer-only). The test suite is the primary CI gate in CLAUDE.md; it is red.

### B2 · B18-085 — duplicate `toUtcIso` re-trips the ban it lives under; breaks `npm run lint`
The sanctioned UTC wrapper already exists: `lib/utils.ts:8` `toUtcIso(d: Date)` carries the **only** `eslint-disable-next-line no-restricted-properties`, and the ban's own message says *"Use toUtcIso() from `@/lib/utils`."*

18B-5 instead created a **second** `toUtcIso` in `lib/db/utils.ts:4` (`date: Date = new Date()`) with a raw `.toISOString()` and **no** disable, and pointed the db files at `./utils`:

```
lib/db/utils.ts:4:10  error  'toISOString' is restricted from being used. Use toUtcIso() from '@/lib/utils' …  no-restricted-properties
```

Two defects: (1) `npm run lint` errors on `lib/db/utils.ts:4`; (2) DRY — a duplicate of the sanctioned util the lint message explicitly names.
**Fix:** delete the `lib/db/utils.ts` copy; `import { toUtcIso } from '@/lib/utils'` in `businesses.ts` / `campaigns.ts` / `posts.ts` (pass `new Date()` explicitly).

### B3 · B18-081 — STRIPE_CLIENT_INTERNALS_BAN bans legitimate type-only imports + a Server Action; misses its locked design
The new pattern ban has **no `allowTypeImports: true`** and is **not client-scoped**. It fires on 4 production sites that are exactly the *sanctioned* usage:

```
lib/db/businesses.ts:3                                 import type { PaidPlan }          ← type-only, should be allowed
app/[locale]/(dashboard)/billing/PricingCards.tsx:11   import type { PaidPlan }          ← type-only, should be allowed
app/[locale]/(dashboard)/billing/actions.ts:7          import type { PaidPlan }          ← type-only, should be allowed
app/[locale]/(dashboard)/billing/actions.ts:6          import { createCheckoutSession }  ← legit Server Action value-import
```

The rule's message tells callers to *"Use type-only imports or pass pricing data via Server Actions"* — yet it bans both. It also does not match the locked design (S11 D5: ban **client** value-imports + a `typeof window` guard; neither the client scoping nor the guard is present). Result: 4 net-new `npm run lint` errors on correct code.
**Fix:** add `allowTypeImports: true` to the pattern, and scope the value-import ban to client modules (or exempt `lib/db/**` + the billing Server Action), per the S11 D5 intent.

---

## H — High

### H1 · Triage closure status + verify conclusions never recorded
`docs/session-18-triage.md` contains **zero** references to "18B-5" and **no** closure markers / "Delivered" notes / verify conclusions for any item in this batch (grep: `NO 18B-5 REFERENCES IN TRIAGE`). Required-reading #2 ("confirm every one of the 21 items has a closure status, and that escalations were filed as new rows with evidence") fails outright. The verify items in particular have **no recorded evidence**:
- **B18-064 (postcss CVE)** — no `npm audit` conclusion, no `overrides` entry in `package.json`, no doc note. The verify was either not done or not evidenced — *"trust me, it's fine" is an H.*
- **B18-067 (trial_state RLS), B18-068 (date coltype), B18-074 (revalidatePath)** — conclusions exist only in this Reviewer's independent re-derivation, not in any committed artefact.

(Commit `3bd4059` is even titled `fix(triage): …` but touches **no** triage file — see L1.)

### H2 · B18-005 / B18-006 / B18-043 — no deliverable in the diff
The brief's D1 names `005/006/043` as expected ADR/checklist edits for this batch. The 18B-5 diff touches only `docs/decisions/0002-social-provider.md` and `docs/launch-checklist.md` — **none** of ADR 0008 (005/006) or ADR 0005/0006 (043) changed.
On independent read, ADR 0008 already reads `[now+1d, now+2d)` for T-1 (line 423) and already documents `id text PRIMARY KEY -- svix delivery id (idempotency anchor)` (line 508) — so 005/006 may be pre-satisfied and belong in the triage N/A section *with evidence*; 043 (0005↔0006 cross-ref) is unverified. Either way the batch left them undelivered **and** unmarked.

### H3 · B18-002 shipped without running its matching test suite (process)
Distinct from B1's CI-red symptom: the footer change is a `lib/email` edit, yet the batch was validated only against the narrow `lib/db lib/social lib/validation` command, so the snapshot break was never observed before commit. Any `lib/email` / `components` edit must run the matching suite (`vitest -u` + review) before close.

---

## M — Medium

- **M1 · B18-009 carve-out wording is inaccurate (D1).** CLAUDE.md states the registry *"uses `as unknown as` casts"*, but `lib/email/templates/index.ts:31-34` uses `props: any` / `React.FC<any>` with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` — there is **no** `as unknown as` in the file. The carve-out's intent is right; the mechanism it names is wrong and will confuse a future reader who greps for it.
- **M2 · Scope/commit hygiene (S1).** `CLAUDE.md` did **not** exist in git at `da8c26e`; the entire 301-line constitution was first committed inside the B18-009 "carve-out" commit (`61ad436`). The actual deliverable is one line. Tracking the constitution is fine, but bundling 300 unrelated lines under a one-line-doc item obscures review.
- **M3 · B18-085 sweep is partial and now inconsistent.** Only `businesses/campaigns/posts` were switched to UTC. ~15 other `formatISO(new Date())` sites that write `timestamptz` remain (`lib/social/postiz-provider.ts`, `lib/email/orchestrator.ts`, `lib/deletion/orchestrator.ts`, `app/api/social/[platform]/callback/route.ts:150`, `lib/campaigns/generate.ts` ×11, `posts/actions.ts:282`). Functionally these are **not** bugs (Postgres `timestamptz` honours the local offset, so the stored instant is correct — the "hazard" framing is overstated for DB writes), but the codebase now carries two date-write conventions. Pick one and finish the sweep, or document why the 3 were special.

---

## L — Low

- **L1 · `3bd4059` mislabeled** `fix(triage)` — it changes no triage file (only code).
- **L2 · B18-084 de-indent.** Removing the `Sentry.withMonitor` wrapper in `lib/publishing/orchestrator.ts` left the body at its previous (closure) indentation. Compiles; cosmetic.
- **L3 · Confirm no orphaned import.** After B18-084, verify `Sentry` is still referenced in `orchestrator.ts` (it appears to be, via the M2 breadcrumbs from 18B-2D — eslint raised no unused-import warning, so likely fine).

---

## Items independently re-verified as SOUND ✓

- **B18-068 (V1)** — `supabase/migrations/20260430120009_campaigns.sql:21-22`: `start_date date NOT NULL`, `end_date date` — **`date`, not `timestamptz`**. Verify conclusion correct; no TZ off-by-one.
- **B18-073 (B1)** — `page.tsx:36` already sorts server-side `[...rawPosts].sort((a,b)=>a.scheduled_at.localeCompare(b.scheduled_at))` (ascending, no tiebreak) — identical key/direction to the removed `PostsClient` sort; `.filter()` preserves order. Display order unchanged.
- **B18-031 (B1)** — `fetch_failed` removed cleanly from `AiErrorCode` + its test. The remaining `fetch_failed` literals in `app/api/social/accounts/route.ts:22` and its test are an unrelated JSON error string, not a consumer of the AI enum. No dangling branch.
- **B18-034 (V1)** — all 5 silent `} catch {}` in the OAuth callback route are now `} catch (e) { Sentry.captureException(e) }`; grep confirms **no** remaining `catch {}`. These are the callback-route catches 17B left silent (17B handled `social-accounts.ts`); no double-instrumentation.
- **B18-072 (C1)** — JSDoc on `VALID_TRANSITIONS` is accurate: `unapprovePost` (posts.ts:177, guard `.eq('status','approved')`) and `unskipPost` (posts.ts:212, guard `.eq('status','skipped')`) exist and bypass the map with their own atomic WHERE guards.
- **B18-066 (B1)** — `sessionStorage → localStorage` swap keeps the `useEffect` (empty-deps) client-only read; SSR renders the `false` default, effect updates post-mount — hydration-safe, no mismatch.
- **B18-004 (I1)** — `accessibility.skip_to_content` present and resolving in en (`Skip to content`) / pt (`Saltar para o conteúdo`) / es (`Saltar al contenido`); layout made `async` and wired via `getTranslations('marketing')`. No orphan.
- **B18-001** — `'suppressed'` added to `EmailProviderErrorCode` (additive, matches ADR 0008 §4's 6 codes).
- **B18-046 (X1)** — `authToken: process.env.SENTRY_AUTH_TOKEN` in `next.config.ts` is the sanctioned `process.env` exception (alongside existing `SENTRY_ORG`/`SENTRY_PROJECT`/`CI`); not a config-boundary violation.
- **B18-026 (D1)** — ADR 0002 open-follow-up note matches the real `OAuthAuthorizeInput` field drift (2 extra fields).
- **B18-045 (D1)** — per-var checklist rows match `/lib/config.ts` schema names/defaults.

---

## Bottom line

The cleanups that were *implemented* are mostly correct and behaviour-preserving (sort, fetch_failed, callback catches, banner storage, i18n, date coltype all verified sound). **But three of this batch's own changes break a standard verification gate** — `vitest` (B1) and `lint` ×2 (B2, B3) — and the two lint blockers are tooling items (B18-081, B18-085) whose entire purpose was to harden the build, yet they ship red on legitimate code while one (B18-081) also misses its locked design. Combined with the triage never being updated (H1) and three ADR items showing no deliverable (H2), the batch is **not closeable as-is**. Recommend a short correction pass: regenerate email snapshots, collapse the duplicate `toUtcIso`, add `allowTypeImports`/client-scope to the Stripe ban, then backfill triage closure + verify evidence.

**Review file:** `docs/session-18b5-review.md`

---

## Correction pass — 18B-5D (2026-06-20)

All three B-blockers resolved. Session 18 closed.

| Finding | Resolution |
|---------|-----------|
| **B1** — 15 email snapshots red | `npx vitest run lib/email -u` run; all 5 snapshot files updated (footer 13px→14px diff only). Commit `a31423b`. |
| **B2** — Duplicate `toUtcIso` in `lib/db/utils.ts` | Removed; `businesses.ts`, `campaigns.ts`, `posts.ts` now import canonical `toUtcIso` from `@/lib/utils`. Commit `1fd98c5`. |
| **B3** — `STRIPE_CLIENT_INTERNALS_BAN` too broad | `allowTypeImports: true` added; billing Server Action exception block added; `typeof window` guard added to `lib/stripe/checkout.ts`. Commit `77e2e34`. |
| **H1** — Triage never updated | B18-001/002/009/031/045/072/073/081/084/085 closed; B18-005/006/043 N/A-verified; B18-064 evidence recorded; B18-089 filed. Commit `dab1791`. |
| **M1 (B18-009)** — CLAUDE.md carve-out wording | Corrected to describe `eslint-disable-next-line` comments, not `as unknown as` casts. Commit `90fc652`. |
| **H2** — B18-005/006/043 no deliverable | Verified N/A: ADR 0008 already reads `[now+1d,now+2d)` (005); svix-id is PK in migration (006); QStash callback URL pattern correct (043). |

CI final state: `npx tsc --noEmit --skipLibCheck` → 0 errors; scoped vitest → **1071 passed / 0 failed**.
