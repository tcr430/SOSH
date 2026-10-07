# Session 37 — Track O — Reviewer report (O3)

**Scope reviewed: `0da603b4a..cea74d843`; all citations are `git show <sha>:<path>` at that range, never HEAD.**
(`cea74d843` is the tip of `session-37-adr-0031` and of `origin/session-37-adr-0031`; 14 non-merge commits, O2.1 `10f5f534a` … O2.12 `cea74d843`.
Every file was read from a detached worktree checked out at `cea74d843` or with `git show cea74d843:<path>` / `git diff 0da603b4a..cea74d843`.)

**ADR 0031 read at `0da603b4a` (sections 0–16, the audited text); its appended "Builder verification (O2)" section (V.1–V.20) read at `cea74d843`, where it was written. Build guide `docs/build-guide/session-37.md` read at `0da603b4a` (§0, §0.2 A-1…A-7, §2, §2a, §2b) and at `cea74d843` (the §0.2 amendment A-3′, O-1, O-2, O-3 and the O2.7b row, added inside the range by `10f5f534a` and `986633c78`). ADR 0026, ADR 0010 A2 §D2.5, ADR 0014 and ADR 0015 §2 read at `cea74d843`.**

Author: Session 37 Reviewer (O3), 2026-10-05. Nothing in the repository was modified; scratch work ran in a detached worktree at `cea74d843` and was reverted (`git status` clean after every plant).

---

## 0. Precondition, and how this review was run

**Precondition: met.** At `0da603b4a` the ADR reads `Status: Accepted` and §0.2 records A-1…A-7 as ruled (A-3…A-7 "CONFIRMED"); `0da603b4a` is the merge of PR #19 into `master`, and the branch was cut from it. Two residues of the Proposed stage survive in the ADR text at base: the status line says "Accepted. It becomes Accepted when the founder rules A-3…A-7" (header, line 3), and §0.1 and §3's headings still say "awaiting the founder" (lines 58, 335). That is NIT-1 (ADR text), not a gate failure.

**What I ran myself, at `cea74d843`:**

| Check | Result |
|---|---|
| `npm run typecheck` (CI dummy env) | clean |
| `npm run lint` | 0 errors, 113 warnings (the baseline) |
| `npm run test:app` (`vitest run app/ lib/ components/ scripts/eval/`) | 420 files, 6,594 passed |
| `npm run test:db` (local stack, 129 migrations, `DATABASE_URL` set) | 121/122 files, 1,380/1,381. The one failure is `supabase/__tests__/plan-proposals-current-version-read.test.ts` (ADR 0027 `EXPLAIN` index choice), the same unexplained local failure V.18 records; the branch does not touch that table. All six analytics Tier-1 files pass. |
| CI `app-tests` at `cea74d843` (run 37343927608, `pull_request`) | success; log: `skip-guard: 417 file(s) under [app, lib, components] all visible, zero failures — green. (6594/6594 tests passed)` |
| CI `db-tests` at `cea74d843` (run 37343927865, `pull_request`) | success; log: `skip-guard: 122 file(s) under [supabase/__tests__] all visible, zero failures — green. (1381/1381 tests passed)`; grep for SIGSEGV / signal 11 / OOMKilled / out of memory: none. **Not a stack failure; green.** These are `pull_request` runs and do not move the promotion tally. |
| Catalogue queries on the local DB (V.2 baseline compared) | §9 below: policy, grants, CHECKs, UNIQUE, trigger function, index and predicate all as ADR §5.1/§11; DEFINER audit gate = **3** (`accept_invite`, `get_user_business_ids`, `user_can`), equal to V.2 |
| Every source scan reddened in the detector's own vocabulary | §10 below: all 10 REAL-TREE arms red with one plant each, green after revert |
| Tier-1 two-business generation with a planted cross-tenant row | red (5 of 7 tests, `TenantMismatchError`), green after revert |
| PDF isolation in a **real** Chromium, hostile markup injected after escaping | 0 server hits, script never ran; with one request let through: 1 hit, red |
| Read ceiling lowered below the fixture (`READ_CEILING = 10`) | 7 tests red, all constant/pager pins (MINOR-11) |
| Browser pass (Playwright, `next dev` on the local stack, fixture seeded, March reports generated with the real loader deps) | §8 below; one 320 px overflow found (MAJOR-6) |

**ECC budget for this review: two invocations, both dispatched once, both returned nothing.** `ecc:pr-test-analyzer` and `ecc:silent-failure-hunter` were each dispatched once, read-only, at the range; both terminated on an API rate limit (HTTP 429) before producing any output. They were not re-dispatched (each was to run ONCE). **No finding below relies on either agent**; their two questions were answered by hand (MAJOR-5, MINOR-8, MINOR-11 and MINOR-12 are the silent-failure and test-strength results). This is a gap in independence, stated plainly.

---

## 1. The metric model (§2; L-2, L-3, D-1, D-2) — with the hand re-derivation

**Re-derived by hand from `lib/analytics/__fixtures__/portfolio.ts` at `cea74d843`**, then compared with (a) the stored payload of a March report generated against the live local stack with the real loader dependencies and (b) the rendered `/en/analytics/reports/2026-03` and `/en/analytics?month=2026-03`.

| Quantity | By hand | Payload | Rendered |
|---|---|---|---|
| A, March (Europe/Lisbon), X rates | `(l+c+s)/1000`: 0, .018, .025, .031, .040, .047, .064 (a_x01…a_x07) | — | — |
| X median, n = 7 (odd → 4th value) | **0.031 → "3.1%"** | `rate: "3.1%"`, `n: 7` | "7 posts measured. Typical engagement rate: 3.1% (range 0.0%–6.4%)." |
| Range, n < 10 → min–max | **0.0%–6.4%** (a measured 0 renders `0.0%`) | `lo "0.0%"`, `hi "6.4%"`, `rangeKind "minmax"` | as above |
| Wins: beat true a_x03–a_x06, false a_x01–a_x02, NULL a_x07 | **4 of 6** (NULL out of n) | `wins 4, n 6` | "4 of 6 posts beat your usual engagement." + the usual / drift / import-seed lines |
| Exclusions: 10 X published (draft, failed, deleted excluded); a_x08 comments NULL, a_x09 impressions 0, a_x10 no metrics row; a_x10 + 9 d < generation instant → not "not final" | **7 of 10; no data 1, field missing 1, zero impressions 1, not final 0 (omitted)** | `measured 7, published 10, notIncluded 3`, three reasons | "7 of 10 posts measured. 3 not included: no data returned (1), a field was missing (1), zero impressions (1)." |
| February n = 5: .022 .028 .030 .036 .044 | 3.0%, 2.2%–4.4% | equal | equal |
| January n = 4 (floor) | thin, no number | trend point `thin/n4` | "Not enough measured posts" |
| Month pair Feb (5) · Mar (7) | shown, both ≥ 5 | `state "pair"` | "February 2026: 3.0% (5 posts) · March 2026: 3.1% (7 posts)." |
| Month pair with one side below 5 (B: Feb 0 · Mar 2) | suppressed | `monthPairSuppressed` | suppressed sentence |
| Activity A March | 10 X + 3 LinkedIn = 13; prev = Feb 5; X 9 on the A account + 1 NULL bucket | equal | equal, NULL labelled "Account not recorded or since removed" |
| Section 5 by day-7 rate | a_x07 .064, a_x06 .047, a_x05 .040 | 6.4% / 4.7% / 4.0%, badges no-baseline / above / above | equal, with the caveat |
| Breakdowns (AI posts a_x02–a_x06; length/CTA all 7; NULL beat out of n) | role 2/2, 2/2, 0/1; format single 3/4, thread 1/1; origin manual 0/1, objective 3/3, signal 1/1; length short 0/2, medium 3/3, long 1/1; CTA true 3/3, false 1/3; coverage 5 of 7 and 7 of 7 | equal | equal |
| Timezone boundaries | 2026-03-31T23:30Z Lisbon → April; 2026-04-01T00:30Z São Paulo → March | B March X n = 2 (incl. the boundary post) | B: "2 de 2 publicações medidas" |

**Verdict on the numbers: they match, everywhere I could see them.** The n = 9 / 10 floor cases are not in the fixture; I verified them by reading `lib/analytics/floors.ts:11-26` and `breakdowns.ts:70` (`>= 10` on every value, two or more values) at the range, not by a run.

**Source per number.** No aggregate, badge or report figure reads `post_metrics`: it is read only by `listMetricsForPosts` (`lib/db/post-metrics.ts`, appended) for unmeasured posts' exclusion reason and the post table's "so far" counts (`lib/analytics/load.ts:447-449, 543-544`). Nothing sums, means or pools across `metric_basis` (`rates.ts:85-111`, `wins.ts:19-31` and `view-model.ts:184-185` all throw on a mixed set). NULL is never 0 (`rates.ts:59-63`, `wins.ts:25`, the posts head count throws on NULL). `log_lift` is not selected (`post-outcomes.ts` `OUTCOME_ANALYTICS_COLUMNS`) and appears in no view model or payload (payload key list checked).

Findings in this section: **MAJOR-8, MAJOR-9, MAJOR-10, MINOR-6.**

### MAJOR-8 — The thin key, reused for a win count, mislabels its n *(ADR finding + Builder)*
- **What:** `winsView` renders the thin state with `params: { n: w.of }` (`lib/analytics/view-model.ts:80`), and the one thin key reads "{n} measured posts so far. A typical rate appears from 5." The wins slot therefore prints the number of posts **with a baseline** as "measured posts". Seen in the browser for business B (pt, page and report): "2 de 2 publicações medidas." and, two lines above it, "1 publicações medidas até agora." — one set described as 2 measured and as 1 measured.
- **Why it matters:** a number that is not what it claims (item 1), on a board document. The root is ADR §8.1's "the thin state (§8.2), one key everywhere", which did not consider a wins n that differs from the measured n; the Builder applied it to a count it does not describe.
- **Proven fixed by:** an ADR ruling on the wins-below-floor copy, and a render test of B's March in en/pt/es asserting no line states a measured count different from the exclusions line.

### MAJOR-9 — At n ≥ 10 the IQR is printed as "range" *(ADR finding)*
- **What:** ADR §2.3 makes the range min–max below 10 and the IQR from 10; §8.4's one template is "(range {lo}–{hi})". `TypicalLine` drops `rangeKind` (`components/analytics/PortfolioView.tsx:32-36`), no key distinguishes the two, and the methodology `median` key does not mention the switch.
- **Why:** from the first healthy month (n ≥ 10) a board reader reads the middle 50% as the full spread. The fixture never reaches n = 10 in a month, so no test or browser pass shows it.
- **Proven fixed by:** an ADR amendment giving the IQR its own wording, and a render test at n = 10 asserting it.

### MAJOR-10 — Activity campaign counts are computed over a silently truncated read
- **What:** `loadPortfolioWith` reads `r.listCampaigns(businessId)` (`lib/analytics/load.ts:246`), the existing `listCampaigns` with a default `limit = 100`, `ORDER BY created_at DESC`, not keyset-paged (`lib/db/campaigns.ts:6-19`). "N active campaigns, M completed" is computed over that page (`load.ts:273-276`) and stored in every report payload; campaign names in the campaign table come from it too (`load.ts:307`). This read is not in ADR §9.1's table, and the worker binds the same `listCampaigns` with service-role (`lib/db/analytics-worker-reads.ts:24`), `select('*')`.
- **Why:** ADR §2.7 / #36: "No aggregate may be computed over a silently truncated read." Pro has unlimited campaigns; past 100 the stored count undercounts and older campaigns render as "Open campaign". It also counts *current* statuses, not the selected month's (§3.2).
- **Proven fixed by:** a bounded, column-listed, paged (or head-count) campaign read behind the 5,000 ceiling, added to §9.1, and a test with 101 campaigns asserting the stored count.

### MINOR-6 — Breakdown "k of n" rows render below the display floor *(ADR ambiguity)*
- **What:** `winShareBreakdown` shows every value with `of ≥ 1` (`lib/analytics/breakdowns.ts:67-83`). The stored report says "Posts with Founder perspective: 0 of 1 beat your usual. (Provisional)".
- **Why:** ADR §8.1's display floor (5) applies to "a median, a range, a 'k of n'"; its compare row says below 10 "counts only ('4 of 5')"; §2.6 says "counts only below [10]". The ADR does not say whether a breakdown value under 5 is thin or a count; the Builder resolved it silently (V.6 item 5 records only the bars rule).
- **Proven fixed by:** a founder/ADR ruling, then literal tests at n = 4 and n = 5 per value.

---

## 2. The Plus / Pro split and the gate (§3; A-4, A-5)

- `hasAdvancedAnalytics(plan: unknown)` (`lib/stripe/plan.ts:124-127`): string check plus own-property check; false for `'enterprise'`, `null`, `undefined`, numbers and inherited keys (read; `plan.test.ts` green in CI).
- **Pro reads not called for basic:** at the loader the Pro block follows `if (!advanced) return` (`load.ts:323`) and dimensions are read only `if (advanced)` (`load.ts:438`); the recording-fake test asserts each Pro reader is **not** called (`lib/analytics/__tests__/load.test.ts:427`). The generator reuses the same loader. The PDF route renders the stored payload and calls no reader. A-5 is applied at render on the page (`reports/[period]/page.tsx:59`) and in the PDF (`pdf/route.ts:58`), never from the payload tier; the page arm is tested (`reports-pages.test.tsx:143-150`, including an unknown plan). Browser: business B (Plus) shows five "Disponível no Pro: …" lines, no number, blur or modal; its stored report has no Pro key.
- The report's `tier` comes from `hasAdvancedAnalytics(business.plan)` read by the worker (`assemble.ts:141`, `generate.ts:65`), never from input.

No finding against the gate.

---

## 3. Information architecture (§4; L-7)

Routes, Zod period/uuid, the server-side business (`getBusinessForUser`) on every route, the campaign table linking to `/campaigns/[id]`, `loadCampaignLearningView` gaining no caller, the NULL account bucket never defaulted, and the nav change all match §4. Browser: A's real report id requested while B is the active business → **404**; anonymous → **401**; malformed id → **404**. This also proves the O-1 `/api` fix on a real request, which V.11 recorded as owed.

No finding here (MINOR-3 is in §4).

---

## 4. The monthly report (§5; A-1, A-3, A-6, A-7)

The snapshot table, UNIQUE, write-once trigger, direct `upsert … ignoreDuplicates` insert (`lib/db/analytics-reports.ts:85-94`), enqueue only for inserted non-stub reports (`generate.ts:128-135`, `job.ts:38`), the due rule (`lib/reports/due.ts`), M−1 only, eligibility (`isLiveForReports`, ruling O-2), the stub with no email, the dedupe token `report:{YYYY-MM}:{member id}` (`deliver.ts:68`), the subject C0/LS/PS strip (`monthly-report.tsx:21-29`), the PDF hardening (§7) and the five A-3′ packages all match. Findings:

### MAJOR-5 — The hourly tick can silently never reach some businesses
- **What:** `runReportTick` starts its cursor at `null` every tick (`lib/reports/generate.ts:102`) and stops scanning at `REPORT_SCAN_CAP = 2000` (`constants.ts:17`, `generate.ts:104`). Every scanned business counts, including not-due and ineligible ones, so from the 2,001st business by id onward **no business is ever visited**, and `capped` stays `false` (it is set only when generation attempts reach 25, `generate.ts:109-111`). The `report.tick` line and the Sentry monitor both look healthy. Second path: errors count as attempts (`generate.ts:140`) and a failing business is retried next tick, so 25 persistently failing businesses with low ids consume every tick and starve the rest.
- **Why:** §5.2 treats a missing month as an operational incident "the Sentry monitor catches". Here it is invisible. Latent at launch scale, permanent once reached.
- **Proven fixed by:** a tick test with 2,100 candidate ids where only the last is due (generated within a bounded number of ticks, or a reported capped/skipped state that alerts), and a test with 25 failing low ids followed by one due business.

### MINOR-3 — Report section 7 omits the retrospective interval
§5.3 row 7: "verdict, n, interval, link". The report reuses the portfolio campaign table (`assemble.ts:196`, `load.ts:168-178`), which carries verdict and n only. Proven fixed by: the interval in the payload and a render test, or an ADR note that section 7 is the portfolio table.

### MINOR-4 — Cited posts are copied, and a removed post never shows "Post removed"
§5.1: "Cited posts are not copied. Their values are re-read from `post_outcomes` … A deleted or erased post renders 'Post removed'." The payload stores `{ postId, rate, badge }` (`assemble.ts:182`) and `ReportBody` renders the stored rate (`ReportBody.tsx:62-90`); nothing re-reads or renders "Post removed", and the three rows carry nothing a reader could use to identify the post. V.10 does not record this as a deviation. Proven fixed by: an ADR note accepting the copy (the value is write-once anyway), or the re-read plus a test with a deleted cited post.

### MINOR-8 — A delivery failure after a successful insert is never retried *(ADR finding)*
If `deliverMonthlyReport` throws (`job.ts:46-49`) or one `enqueueEmail` fails (`deliver.ts:73-76`), the report is stored, the next tick returns `exists` (`generate.ts:58`), and that month's email is never sent; it is captured to Sentry only. This follows from §5.2's "enqueue only if the insert returned a row", which has no retry path. Proven fixed by: an ADR decision (accept and record, or a retry keyed on the dedupe token) and a test.

**Recipients (item 5).** No Server Action, route or payload accepts an address: `setReportEmailAction` parses only `setting` (`reports/actions.ts:20-24`); recipients come from `resolveReportRecipients` (`business-members.ts`, appended): one business, `status = 'active'`, `user_id IS NOT NULL`, `is_admin` for `admins`, widened for `all_members`, nobody and no query for `off`. The fixture covers an invited admin, a revoked admin and an active non-admin separately. `off` still generates. The kind CHECK at the range carries all six prior kinds plus `monthly-report` (queried).

---

## 5. No narrative (§6)

No `lib/ai`, `@anthropic-ai/sdk` or `dangerouslySetInnerHTML` in any root (scan #39 green, reddened by me). #24 and #26 not applicable. The one leak of non-template prose into the report is MAJOR-2 (§6).

---

## 6. Honesty in thin data (§8): floors, states, disclosures, the copy lint and my own read

**Lint.** `lib/analytics/copy-lint.test.ts` ran green in my `test:app` and in CI. Exemptions: the `interval` key ("likely between", the one class exemption); `outcome.role.customer_proof` for the es "prueba" false positive (sanctioned by §8.4's last bullet); `posts.value.rate` for the n-rule only (one post). The LinkedIn sentence is ADR 0026 §10.2 verbatim (`disclosure.linkedinCount`, compared with `0026-outcome-loop.md` at the range). The en §8.2 states and §8.4 templates are the ADR literals.

**My read of every analytics, report and email string in en, pt and es.** I read all of them. pt and es are translations of en, not looser rewrites, and none of them implies cause, direction, a recommendation or a forecast. The defects lie in what the components put on the page:

### MAJOR-1 — "Nothing published yet" is printed under Observed patterns in a month with posts
- **What:** `PatternsSection` renders `analytics.state.empty` when no pattern qualifies (`components/analytics/PortfolioView.tsx:290-291`), and `ReportBody` reuses it in the stored report and the PDF (`ReportBody.tsx:132-133`). Seen in my browser pass: A's March report (13 posts published) says "Observed patterns — Nothing published yet. Results appear here after Jemip publishes your first post."
- **Why:** a false sentence in the board document. At launch no business has a promoted pattern (promotion needs 10 posts across 3 campaigns), so **every Pro report and every Pro portfolio page** carries it. V.17 D5 found it and left it to the founder as "locked copy", but nothing required reusing that key: ADR §10.2 has no "nothing qualifies" state, and the Builder chose the one state that is false here. Partly an ADR gap.
- **Proven fixed by:** a render test of a Pro report and page with posts and zero patterns asserting `state.empty` is absent, with the copy chosen by ADR amendment or the founder.

### MAJOR-2 — Observed patterns print memory's English sentence raw, in every locale, outside the closed templates
- **What:** `PatternsSection` renders `{p.pattern}` (`PortfolioView.tsx:296`), the stored `performance_memory.pattern` produced by `renderOutcomePattern` (`lib/outcomes/template.ts:50-62`). It is English only, e.g. "On X, question hooks beat this brand's usual engagement in 7 of 10 posts (3 campaigns)." It reaches the live page, the stored payload (`assemble.ts:210`) and the PDF, in pt and es too.
- **Why:** it breaks i18n en/pt/es (L-9) and §8.4 ("every user-visible analytics or report sentence is one of these"). The tests cannot see it: every test injects a made-up pattern ("Posts with a question opening beat your usual.", `load.test.ts:98`, `copy-lint.test.ts:257`) instead of `renderOutcomePattern`'s real output, so the lint and parity checks never meet the real sentence. Its own embedded counts also duplicate the `patternEvidence` line beside it.
- **Proven fixed by:** patterns rendered from their dimension, value and direction through analytics keys in all three locales, and the copy lint run over `renderOutcomePattern`'s real output.

### MAJOR-7 — The summary and the email state a win count without "usual", and a typical rate without its platform
- **What:** the summary lines are `activity.total` followed by `analytics.typical` and `analytics.wins` per rate platform (`assemble.ts:186-189`), with neither the disclosure keys nor the platform. The email renders exactly these lines (`deliver.ts:49-51`, `monthly-report.tsx:40-44`). Rendered: "13 posts published, 5 the month before. 7 posts measured. Typical engagement rate: 3.1% … 4 of 6 posts beat your usual engagement." There are 3 LinkedIn posts in the 13, and nothing says "on X".
- **Why:** ADR §2.4: "'Usual' is defined next to every win count" and "Every win count also carries" the drift sentence. Section 4 of the page does this; the email, a standalone sink sent to inboxes, does not, and "7 posts measured" reads as 7 of the 13.
- **Proven fixed by:** rendered-email and summary-section tests asserting the usual definition and the drift sentence beside every win count, and the platform named on every rate line.

### MINOR-1 — The report's 6-month trend is headed "12-month trend"
`ReportBody` reuses `TrendSection` (`ReportBody.tsx:107`), whose heading is `analytics.section.trend` = "12-month trend"; the payload holds 6 months (`REPORT_TREND_MONTHS = 6`). Proven fixed by: a report-specific heading and a test.

### MINOR-2 — "Posts written outside Jemip's generator aren't classified" under breakdowns that classify every post
The `coverage` key appends that clause to every breakdown, including `length_band` and `cta_present`, whose population is all measured posts ("Covers 7 of 7 … aren't classified"). §2.6 specifies one line per breakdown without distinguishing the populations (partly ADR). Proven fixed by: a population-specific coverage line and a render test.

### MINOR-5 — The methodology omits the learning-floor sentence
§8.1: "The methodology section says so: 'Jemip only learns a pattern from at least 10 posts across 3 campaigns; numbers shown here are descriptions, not lessons.'" §5.3 #11 lists "display floor vs learning floor". `report.methodology.floors` states only the display floors, and #31's test checks key presence, not content. Proven fixed by: the sentence in en/pt/es and a content test.

### MINOR-9 — One concept, inconsistent terms in pt and es
pt uses "interação" in the §8.2 literals and disclosures but "envolvimento" in `report.ratedPosts.*`, `report.section.unavailable`, `report.methodology.median|xOnly|engagementOnly` and the email's `supporting`; one pt report says both "Isto mede a interação" and "Isto mede envolvimento". The es email says "Mide el engagement" against "interacción" everywhere else. The Builder disclosed this copy as unreviewed (V.9 item 2). Proven fixed by: one term per locale, held by a parity test.

---

## 7. Tenancy, security, query cost and the northstar fence (§9): the worker, the two-business arm, Chromium

**Worker (item 2).** Every loader read goes through `verifiedReaders` (`lib/reports/isolation.ts:29-59`): the call argument must be the loop's id and every returned row's `business_id` must match. One mismatch throws `TenantMismatchError`, which aborts that business; the tick captures it and continues (`generate.ts:138-142`). The inserted `business_id` and `tier` come from the loop and the plan read. **I reran the Tier-1 generation test with `.eq('business_id')` removed from the worker's outcomes reader:** 5 of 7 tests went red with `TenantMismatchError` ("listMonthOutcomes returned a row for business …02 inside the run for …01"), and all were green after the revert. The patterns read is the exception:

### MAJOR-4 — The worker's patterns read is not isolation-verified, and no Tier-1 test executes it
- **What:** `retrievePatterns` is a loader dependency rather than one of the `Readers` (`load.ts:51, 61, 350`), so `verifiedReaders` never wraps it. `OutcomeObservation` carries no `business_id`, so it could not be checked anyway, and its rows go into `payload.patterns` (`assemble.ts:210`). The Tier-1 generation test stubs it (`supabase/__tests__/report-generation.test.ts`, `loaderDeps = { retrievePatterns: async () => [] }`), as do `generate.test.ts:12` and `assemble.test.ts:20`.
- **Why:** build-guide rule 5 / §9.3: "Every worker read goes through a business-binding wrapper … every selected shape includes business_id … the assembler checks every row." The underlying query is bound by `.eq('business_id')` (`lib/db/memory-performance.ts:409`), so I found no leak, but the designed guarantee is absent for this read and no Tier-1 test runs the real path.
- **Proven fixed by:** a patterns read whose shape includes `business_id`, verified like the others, and a Tier-1 test with a business-B pattern row that goes red.

### MAJOR-3 — The live Pro page reads patterns with the service-role client
- **What:** the page's default `retrievePatterns` is `retrieveOutcomePatterns` (`load.ts:12, 61`), which calls `listOutcomePatternsForGeneration`, which calls `createServiceRoleClient()` (`lib/db/memory-performance.ts:424-430`). So `/analytics` for a Pro business makes a service-role read in a user-facing path.
- **Why:** ADR §9.1 "All user-facing reads use the authenticated client"; L-8; build-guide rule 13 ("never in a page"); constraint #16. Scan #16 checks only direct imports of `lib/supabase/service` in the page roots, so it stays green over a real violation: the scan is weaker than the constraint. V.8 item 2 recorded choosing `retrieveOutcomePatterns` over the ADR's `listOutcomePatterns` (which takes a client) but not that it is service-role. The business id is the session business and the query is bound, so this is not a cross-tenant leak.
- **Proven fixed by:** an authenticated patterns reader in `lib/memory` taking the caller's client, and a loader test through the default dependencies with the service factory mocked to throw (the `analytics-reads.test.ts` technique).

**Business from input, or RLS trusted alone (item 3).** Every route, loader and action takes the business from `getBusinessForUser` (V.1 premise 1), and every new reader applies `.eq('business_id')` (read at the range; Tier-2 and Tier-1 `analytics-reads.test.ts` green). Another business's report id or period returns 404 before any launch (browser and `route.test.ts`).

**Chromium (item 6), against §5.5's list.**
- JavaScript disabled before content (`pdf.ts:87`).
- Interception on and every request aborted, with no allow-list (`pdf.ts:88-93`).
- The CSP meta, verbatim (`pdf-html.ts:17, 48`).
- `setContent` only: no `goto`, `file://`, cookie or header (`pdf.ts:94`).
- A fresh context closed in `finally`, including on the error path (`pdf.ts:97-99`); the browser closed in the outer `finally` (`pdf.ts:113-120`).
- A 25 s timeout that covers the launch (`pdf.ts:102-109`).
- Concurrency 1 with at most two waiting (`pdf.ts:124-141`).
- Auth, the business, the report read by (business, id), the schema version, the current plan and the queue check all run before launch (`route.ts:42-74`).

**My real-browser rerun.** Local Chrome via `launcherFor`, rendering the stored A payload, with hostile markup injected after React's escaping: an `<img src=http://169.254.169.254/…>`, an `<img>` and a `<link>` pointing at a listening server, and a `<script>fetch(…)>`.
- With the CSP: 0 requests reached the interceptor, a valid `%PDF-` of 80,712 B, **0 server hits**.
- Without the CSP: the interceptor blocked 3 requests, 0 server hits, and the script never ran.
- **With one image request let through: 1 server hit, and the check went red.**

Not proven: `@sparticuz/chromium` on Vercel's Linux runtime, which stays a launch-checklist row.

**Northstar fence:** scan #19 walks the whole repository; plants under `app/` and `lib/email/` were both named (§10).

---

## 8. The UX contract (§10), the browser pass, and what each design skill changed

**Browser pass.** Chromium via Playwright against `next dev` serving `cea74d843`, on the local stack, with the fixture seeded and the March reports generated with the real loader dependencies (all removed afterwards).
- **Pages:** `/analytics` for 2026-03 (populated), 2026-04 (immature), 2026-01 (thin) and 2026-10 (empty); `/analytics/posts`, all and LinkedIn-filtered; `/analytics/reports`; `/analytics/reports/2026-03`.
- **Variants:** en and pt; 1280, 640 and 320 px; business A (Pro) and business B (Plus, gated).
- **Method:** measured after streaming completed. An early measurement catches the "Loading results" skeleton instead of the page.

| | 1280 | 640 | 320 |
|---|---|---|---|
| `document.documentElement` `scrollWidth/clientWidth`, every page, en and pt | ≤ viewport (1265/1265 or 1280/1280) | ≤ viewport | ≤ viewport (305/305 or 320/320), **equal to V.17** |
| `<main>` (`overflow: auto`) `scrollWidth/clientWidth` | within | within | **`/analytics/posts` (both URLs): 338/305 en, 367/305 pt**; every other page within |

### MAJOR-6 — #35's manual half is not reproduced: the posts page overflows at 320 px inside the shell
- **What:** the dashboard shell scrolls inside `<main class="flex-1 overflow-auto p-6">`, so overflow inside `<main>` never reaches `document.documentElement.scrollWidth`, the only measure V.17 recorded. At 320 px, `/en/analytics/posts` and `/pt/analytics/posts` scroll horizontally inside `<main>` by 33 px (en) and 62 px (pt). The cause is the account filter `<select>`, which sizes to its longest option ("Account not recorded or since removed" / "Conta não registada ou entretanto removida") and is 327 px wide in pt. The O2.10 break-ui fix `max-w-full` (V.15) does not constrain it in a real browser, because its flex-column parent has no width bound.
- **Why:** V.17 and V.18 row 35 declare "#35 is closed" on a measure that cannot see this overflow. There is an ADR side too: §10.4's acceptance ("shell `scrollWidth` ≤ 320") names a measure that is not enough for a shell with an inner scroller.
- **Proven fixed by:** a recorded re-measure, at 320 px in en, pt and es, of every element with `overflow-x: auto|scroll` and `scrollWidth > clientWidth`, and the filter bar actually width-bounded.

**States I saw at least once:** populated, immature, thin, empty, unavailable (LinkedIn, A and B), gated (B), and a stored report (A advanced, B basic). I did not force the error state (V.17 did; not reproduced).

**Keyboard only, at 1280 and 640.** Every stop shows a 2 px solid outline: the month picker, Show, the campaign links, the 640 px "Details" disclosure (it opens with Enter), Back, Download PDF, the report-email select, and Save.

**Rest of the §10 contract:**
- Every chart has a sibling `<table>` and an `aria-describedby` target: the markup tests are green, and the rendered report shows both tables.
- Colour is never the sole carrier: badge text is present.
- No `asChild` anywhere in the range.
- The only client islands are `ReportEmailForm.tsx` and `analytics/error.tsx`.
- Native `<select>` throughout, and no animation.

**What each design skill changed.** The `266f67456` body summarises; V.15's table is the per-skill record:

| Skill | Changed | Touched the §10 contract? |
|---|---|---|
| taste-skill | report rhythm, hairlines, heading sizes scoped to the report article, print keep-with-next | no |
| impeccable | full-contrast focus on every control; the 24 px disclosure target; the **Download PDF** action added (§10.1 requires it); Print **not** built as a button | yes, as a recorded deviation: §10.1 lists Print while §10.6 allows two islands (NIT-2, an ADR internal conflict) |
| ui-ux-pro-max | measured contrast (palette unchanged); axis baseline and smallest labels raised | no |
| emil-design-eng | hover and instant pressed states, `disabled:cursor-not-allowed`, print keep-whole | no (no transition or animation) |
| break-ui | 33 Tier-2 worst-case tests; `min-w-0 wrap-anywhere`, `dir="auto"`, the empty campaigns table omitted, `max-w-full` on selects | no number, floor, template or split changed. Its `max-w-full` fix does not hold in a real browser (MAJOR-6) |

**No skill change altered a number, a floor, a template or the Server/Client split.**

### NIT-3 — Some targets are under 24 px
Standalone links render 18–20 px tall ("See every post", the campaign links) against §10.6's "targets ≥ 24 px". WCAG 2.5.8's spacing exception may cover them.

---

## 9. GDPR and tenancy (§11; L-8)

**Queried on the local database at the range:**
- RLS is enabled on `analytics_reports`.
- One policy, `analytics_reports_select_own`: `SELECT TO authenticated USING (business_id IN (SELECT unnest(get_user_business_ids())))`.
- Grants: `authenticated` has REFERENCES, SELECT and TRIGGER only; **anon has nothing**.
- CHECKs: `EXTRACT(day FROM period_month) = 1` and `tier IN ('basic','advanced')`.
- `UNIQUE (business_id, period_month)`, and the foreign key is `ON DELETE CASCADE`.
- Trigger `trg_analytics_reports_write_once` calls `reject_outcome_table_update()`, which is SECURITY INVOKER with EXECUTE held by `postgres` only.
- Index `posts_business_published_idx (business_id, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL`.
- `email_outbox_select_own` is in the InitPlan form, and `businesses_report_email_check` is present.
- DEFINER audit gate: 3, equal to V.2.

**The migration creates no SQL function**, so the "one declared SECURITY INVOKER exception" was not used, consistent with V.1 premise 3. The §D2.5 row is verbatim and sits in the migration's commit: `git show --stat 470445b0b` shows the migration and `0010-legal-surface.md` together. `git log --follow` on the migration shows one commit; it was never edited. V.4's findings were dispositioned: the index test was made deterministic, and the rest were declined or acknowledged with reasons.

### MINOR-7 — The snapshot stores personal data that the §D2.5 row does not describe *(ADR finding)*
The payload stores the business name, campaign names, account labels (`platform_display_name ?? platform_username`, which once Session 38's founder profiles exist is a natural person's handle) and, on Pro, memory pattern text (`assemble.ts:143, 196, 210`; `load.ts:184`). The §D2.5 row, verbatim from ADR §11, describes "aggregates, template-sentence keys and params, exclusion counts and cited post ids … no post text". The table is write-once even for service-role, so a person's handle in a stored report can be rectified or erased only by erasing the whole business. Proven fixed by: an ADR §11 amendment stating what params hold and the rectification path (or storing ids and resolving labels at render), with the §D2.5 row corrected in the same commit.

---

## 10. The test plan (§12–§13): tiers, CI jobs, reddening, scans, SHARED-FUNCTION CALLERS

**Scans, re-run and reddened by me at `cea74d843`.** One plant per scan, each in that detector's own vocabulary:
- `lib/reports/_plant_social.ts`: imports `getRegistry` from `@/lib/social`.
- `lib/analytics/_plant_write.ts`: `.from('post_outcomes').update(...)`.
- `components/analytics/_plant_loglift.ts`: `row.log_lift`.
- `components/analytics/_plant_service.tsx`: imports `@/lib/supabase/service`.
- `app/_plant_northstar.ts` and `lib/email/_plant_northstar.ts`: import `getLearningCyclesNorthstar`.
- `lib/analytics/_plant_campaignview.ts`: imports `loadCampaignLearningView`.
- `lib/reports/_plant_recipient.ts`: `recipient: payload.email`.
- `lib/reports/_plant_memory.ts`: imports `promotePerformancePattern`, taken from the `MEMORY_WRITERS` registry.
- `lib/reports/_plant_model.ts`: imports `@anthropic-ai/sdk`.
- `package.json`: `left-pad` added.

**Result: 10 failed, 30 passed (40).** The failures are exactly the REAL-TREE arms of #1a, #1b, #19 (naming both `app/_plant_northstar.ts` and `lib/email/_plant_northstar.ts`), #32, #38, #39, #13, #16, #20 and #23. After `git clean` and the revert, all 40 pass. No root is pending: `EXPECTED_PENDING` is `[]` and every root has files. **Caveat:** scan #16 stays green over MAJOR-3, because it sees direct imports only.

**`package.json` against base:** exactly `@sparticuz/chromium`, `@visx/group`, `@visx/scale`, `@visx/shape` and `puppeteer-core` (A-3′), and nothing else.

**SHARED-FUNCTION CALLERS, `git grep` at `cea74d843`, production code:**

| Function | Caller (file:line) | Test that exercises that caller | vs ADR 12.2 / V.2 |
|---|---|---|---|
| `loadCampaignLearningView` | `campaigns/[id]/page.tsx:73` | `campaign-view.load.test.ts` (3, = V.2); Tier-1 `outcome-campaign-view-rls.test.ts` | no new caller |
| `unavailableMetricsPlatforms` | `lib/outcomes/campaign-view.ts:157` | `campaign-view.test.ts` (11, = V.2) | no new caller |
| `metricsReadAvailableFor` | `campaign-view.ts:130` | `campaign-view.test.ts` | existing |
| | `lib/analytics/load.ts:59` (default dependency; the assembler reaches it through `loadPortfolioWith`) | `load.test.ts` (injected); `assemble.test.ts:131-144` | one call site, two consumers (V.18 says so) |
| `listTopPostMetrics` | `lib/memory/performance.ts:77` | `performance.test.ts` (18) and the three context-equivalence tests (7/6/5), unmodified | no new caller; behaviour unchanged |
| `getPlanCapabilities` | `billing/page.tsx:38-39`, `campaigns/enforcement.ts:25`, `members/seats.ts:18`, `plan.ts:97` | existing tests | unchanged |
| `hasAdvancedAnalytics` (new) | `load.ts:238, 518`; `pdf/route.ts:58`; **`reports/[period]/page.tsx:59`** | `plan.test.ts`, `load.test.ts`, `route.test.ts`; `reports-pages.test.tsx:143-150` | V.18's table omits the page caller (MINOR-12) |
| `eligibleValue` | `normalise.ts:171`; `lib/analytics/exclusions.ts:35` | `normalise.test.ts` (unmodified); `exclusions.test.ts` (a spy over the real function) | exactly one new caller |
| `reject_outcome_table_update()` | the `post_dimensions` and `post_outcomes` triggers; `20261004120000:47` | Tier-1 `analytics-reports-constraints.test.ts` | one new trigger |
| `retrieveOutcomePatterns` (not in 12.2) | `lib/ai/context.ts:95, 194` (existing); **`lib/analytics/load.ts:61` (new)** | **no** test executes the new caller's real binding: every loader, assembler, generator and Tier-1 test injects a fake | **AUTHORED-NOT-EXECUTED for that caller** (MINOR-12) |

V.2 baseline counts at the range: 3 / 11 / 18 / 7 / 6 / 5, unchanged; `no-cross-business` is 37 (33 plus the four new readers). No drop.

### MINOR-11 — The ceiling's "error, never a number" is proven by constant pins, not by the fixture through the real pager
With `READ_CEILING = 10`, below the fixture's 18 posts in A's two-month window, only `keyset-pager.test.ts` (3) and `lib/db/__tests__/analytics-reads.test.ts` (4) went red, and both pin the constant or the page arithmetic. Every loader, report and page test uses fake readers that bypass `readAllPages`, so no test drives a real over-ceiling read into the section's error state. Each half is tested (the pager throws; the loader maps the throw), but not their composition. Proven fixed by: a loader test over the real pager with a lowered ceiling, asserting the error state and that no report is stored.

### MINOR-12 — SHARED-FUNCTION CALLERS table incomplete
V.18 omits `hasAdvancedAnalytics`'s page caller (which is tested) and `retrieveOutcomePatterns`'s new caller (whose real binding no test executes; see MAJOR-3 and MAJOR-4).

### MINOR-10 — Redden transcripts and per-skill records are not in the commit bodies *(process)*
Build guide §2a: "WITH THE TRANSCRIPT PASTED INTO THE COMMIT BODY"; O2.10: "RECORD IN THE COMMIT BODY, per skill". The O2.7 body (`cb0f96e72`) has no transcript; the others summarise and point to V.n; the O2.10 body (`266f67456`) is a summary, with the per-skill table only in V.15. The evidence exists, appended in the same commits, and I re-reddened every scan myself, so nothing is left unproven, but the rule was not followed.

**Constraint → CI.** Every file V.18 (e) names sits under `app/`, `lib/` or `components/` (run by app-tests) or under `supabase/__tests__/` (run by db-tests). Both jobs ran green at `cea74d843` with the skip-guard lines quoted in §0, so **all 40 executable constraints were executed green in CI at this head**.

Executed is not the same as holding:
- #16 is green over MAJOR-3.
- #27's Tier-1 arm never executes the patterns read (MAJOR-4).
- #35's manual half is not reproduced (MAJOR-6).
- #36's composition is untested (MINOR-11).

Tier E: none declared, correctly.

---

## 11. Scope and documents

**L-1 scope.** The range ships none of the excluded items:
- no history table, collection change or new platform read scope;
- no LinkedIn estimate, model or budget purpose;
- no memory writer (scan #38);
- no outside recipient, cross-brand number or UTM;
- no change to ADR 0026's rules (its only diff is the dated §VI.2 note);
- no pricing-page or `CLAUDE.md` edit (neither is in the range's diff).

`24a2d0042` (loading the `email` and `invite` namespaces) closes no constraint and carries no founder waiver like O-1's. It fixes a pre-existing defect that affected every email kind, this one included. Recorded, not a finding.

**Documents in the commit of their change** (`git log` per file):

| Document | Commit | Step |
|---|---|---|
| §D2.5 row and the businesses note | `470445b0b` | O2.2 |
| `generate-reports` schedule row | `4f0e00bc0` | O2.8 |
| firewall row and `S37-PDF-RATE-LIMIT` | `4fe2bf8ad` | O2.9 |
| ADR 0026 and ADR 0014 notes, backlog rows | `1a70685ea` | O2.12 |

None lagged its change.

**ECC budget (Builder): four, within budget.**
1. `code-explorer` (O2.0, ADR grounding).
2. `database-reviewer` (V.5, "2 of 4").
3. `security-reviewer` (V.13, "3 of 4").
4. `react-reviewer` (V.16, "4 of 4").

**Measurement statement (`docs/current-phase.md`, V.19).** It says plainly what is not proven: the PDF in a served request, a real send, the firewall rule and the schedule, real-tenant usefulness, stability, floors, day-10 latency, es in a browser, zoom and RTL. No sentence claims a founder benefits. `docs/product-status.md` likewise says "not yet reviewed or used by a real customer".

### NIT-1 — ADR 0031's header and two headings still read as Proposed *(ADR text)*
At `0da603b4a`, line 3 says "Accepted. It becomes Accepted when …", §0.1 says "awaiting the founder", and §3 says "awaiting founder ruling A-4 and A-5". Separately, `current-phase.md` at `cea74d843` says O3/O4 remain "before ADR 0031 can be marked Accepted", though it already is.

### NIT-2 — §10.1 asks for a Print action that §10.6's two-island rule forbids *(ADR internal conflict)*
The Builder recorded the deviation (V.15); the ADR should resolve it.

### NIT-4 — Plural defects in the §8.2 literals
"1 measured posts so far" and "Final for 1 posts" (pt "1 publicações"). This is V.17 D4: locked copy, filed as `S37-STATE-LITERALS`.

### NIT-5 — Copy nits
- `patternEvidence` "{campaigns} campaigns" has no singular form.
- The pt and es `report.stub` ("Não foi publicada nenhuma publicação" / "No se publicó ninguna publicación") repeat the noun.
- `product-status.md`'s "LinkedIn as counts" reads like engagement counts.

### NIT-6 — `resolveReportRecipients` truncates at 200 members without paging or a signal
`lib/db/business-members.ts` (`REPORT_RECIPIENT_MAX = 200`). Unreachable at today's seat caps.

### NIT-7 — Chromium runs without a sandbox, unrecorded
`launcherFor` passes `--no-sandbox`, and `@sparticuz/chromium`'s args disable the sandbox as well. With JavaScript off, interception and the CSP, this is accepted practice on serverless runtimes, but §5.5's list does not mention it. It should be recorded.

---

## What I could NOT verify, and why

- **That a founder finds the report worth forwarding, that medians are stable at real volume, that the floors suit real cadences, and that day 10 is late enough for real X sync latency.** No real tenant exists (ADR §12.5). **UNPROVEN.**
- **`@sparticuz/chromium` on Vercel's Linux runtime** (cold start, memory, traced files). There was no preview deploy; my real-Chromium run used local Chrome through `launcherFor`, not the production launcher.
- **A real email send**, and the email as delivered (Resend, inbox rendering, the subject in all three locales).
- **The error state in a browser** (V.17 forced it by revoking a grant; I did not reproduce it), **es in a browser**, dark mode, print, 200% zoom and RTL. I did not drive these.
- **The n = 9 / 10 floor cases end to end.** The fixture has none; I verified them only by reading `floors.ts` and `breakdowns.ts` and by the green Tier-2 tests.
- **Independent test-strength and silent-failure analysis by the two ECC agents.** Both hit an API rate limit and returned nothing (§0).

---

Session 37 review complete - 29 findings (0 BLOCKER, 10 MAJOR, 12 MINOR, 7 NIT) over range 0da603b4a..cea74d843; 40/40 executable ANALYTICS-*/REPORT-* constraints verified executed green in CI (#24, #26 not applicable; #35 manual half not reproduced); numbers re-derived by hand match; Tier E: none declared, correctly.



## CORRECTION PASS (Session 37-D)

**Author:** Session 37-D correction pass · **Date:** 2026-10-06 · **Range fixed:** `cea74d843..<D12-sha>` (D12 records the head)
**Reviewed head:** `cea74d843`, the head the Reviewer read. Only this pass's section 4 and the report itself landed after it, at D0 (`7c487b807`).
**Founder adjudications consumed:** "include all items identified" (founder, 2026-10-05); A-8 = a; A-9 = a; A-10 = a; A-11 = a; A-12 = a; A-13 = a; A-14 = a; A-15 = a. A-1..A-7, A-3', O-1..O-3 stand.
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

Every row below cites its finding by ID. The *Commit* field names the step; the SHA is the commit that introduces the row (`git log --format=%h -S"### D1 " -- docs/reviews/session-37-reviewer.md`), and D12 copies the SHAs into the close-out table.

### D1 — MAJOR-3, MAJOR-4, and MINOR-12's new caller

**Caller table, taken with `git grep` before any change (production files in `app/` and `lib/`; tests listed separately).**

| Function | Production callers before D1 | Production callers after D1 | Test that exercises each caller after D1 |
|---|---|---|---|
| `retrieveOutcomePatterns` | `lib/ai/context.ts:95` (`buildCustomerContext`), `:194` (`withPostQueryContext`); **`lib/analytics/load.ts:61` (the page and the worker)** | `lib/ai/context.ts:95, 194` only | `lib/ai/context.test.ts:733-765` (via the mocked `listOutcomePatternsForGeneration`); `lib/memory/outcomes.test.ts` (new test pins the five output keys); the 7 + 6 + 5 context-equivalence tests are byte-unchanged and green |
| `retrieveHypothesisResults` | `lib/campaigns/brief.ts:98` | unchanged | `lib/campaigns/brief.test.ts:39` (mocked), `lib/memory/outcomes.test.ts:38-59` (real) |
| `listOutcomePatternsForGeneration` | `lib/memory/outcomes.ts` (both retrievers) | unchanged | `supabase/__tests__/outcome-wrappers.test.ts:42-98` (Tier 1, real); `lib/memory/outcomes.test.ts` |
| `listOutcomePatterns` (client-taking) | `lib/outcomes/campaign-view.ts:148-149` (the campaign page) | the same, **plus `lib/analytics/load.ts:615` (page) and `lib/db/analytics-worker-reads.ts:43` (worker, service-role client)** | campaign page: `lib/outcomes/__tests__/campaign-view.load.test.ts:19` (mocked) and `supabase/__tests__/outcome-campaign-view-rls.test.ts:79-121` (Tier 1); page binding: `lib/analytics/__tests__/load.test.ts:340`; worker binding: `lib/db/analytics-worker-reads.test.ts` (Tier 2) and `supabase/__tests__/report-generation.test.ts:94, 100` (Tier 1, real database) |
| `selectOutcomePatterns` (new, pure) | none | `retrieveOutcomePatterns`, the page (`load.ts:615`), the worker (`analytics-worker-reads.ts:46`) | `lib/memory/outcomes.test.ts:96` (four tests), and each caller above |
| `Readers.listPatterns` (new member) | none | `loadPortfolioWith` (`load.ts:353`), through `authenticatedReaders` (`:615`) and `analyticsWorkerReaders` (`:43`) wrapped by `verifiedReaders` (`isolation.ts:59`) | `isolation.test.ts:40, 50, 77, 92`; `assemble.test.ts:127` (a basic business never calls it); `load.test.ts:340, 347`; `report-generation.test.ts:94, 100` |

`lib/analytics/load.ts` no longer imports `retrieveOutcomePatterns`, and `LoaderDeps` no longer has `retrievePatterns`. `hasAdvancedAnalytics`'s callers are not touched in D1 (MINOR-12's full table is D11's).

| Field | MAJOR-3 | MAJOR-4 |
|---|---|---|
| **Finding** | MAJOR-3 | MAJOR-4 |
| **Fix** | `lib/analytics/load.ts:615`: the page's `listPatterns` binds the **authenticated** `listOutcomePatterns(client, …)` and runs the pure `selectOutcomePatterns` (`lib/memory/outcomes.ts`); the default `retrievePatterns` dependency and its import are gone. Scan #16 gains a derived second arm. | `Readers.listPatterns` (`load.ts:598`) is bound for the worker at `lib/db/analytics-worker-reads.ts:43-46` and wrapped by `verifiedReaders` (`lib/reports/isolation.ts:59`); rows carry `business_id`. The binding also asserts ownership on the **raw** rows before the selection (see the security-reviewer's LOW below). |
| **Proof** | `lib/analytics/__tests__/load.test.ts:340` (authenticated client by identity, `{ status: 'active' }`, factory not called) and `:347` (the Pro portfolio and posts load with `@/lib/supabase/service` throwing and counting, through the **default** readers, with the real `listOutcomePatternsForGeneration` left in place); `lib/analytics/source-scans.test.ts:661-698` (arm 2: derivation non-vacuous in both files at `:665`, negative control, planted positive and negative, real tree at `:692`). | `supabase/__tests__/report-generation.test.ts:94` (the real binding, no stub: A's stored patterns are A's row and carry no `B-LEAK-CANARY`) and `:100` (the same read with its business filter dropped returns B's row, and `verifiedReaders` refuses it with `TenantMismatchError`; no January report is stored); `lib/reports/__tests__/isolation.test.ts:50, 77, 92`; `lib/db/analytics-worker-reads.test.ts` (a foreign row the selection would drop still throws). |
| **Reddening** | **(1)** `authenticatedReaders.listPatterns` re-pointed at `listOutcomePatternsForGeneration(id, …)` (import added): `load.test.ts` 20 failed, including `:340` and `:347`, and the scan's `REAL TREE: no analytics, report or page root imports a service-role memory export` RED. **(3)** `lib/analytics/_plant.ts` = `import { retrieveOutcomePatterns } from '@/lib/memory'`: arm 2 RED (`lib/analytics/_plant.ts: imports retrieveOutcomePatterns from @/lib/memory, which acquires the service-role client`). | **(2)** `.eq('business_id', businessId)` removed from `listOutcomePatterns` (the shared query body the worker binds): `report-generation.test.ts` 5 of 9 RED with `TenantMismatchError`, including `:94` and "once it has a live subscription, business A (Pro) gets its March report". **(4)** `assertOwned(businessId, rows, 'listPatterns (raw rows)')` removed from the worker binding: `analytics-worker-reads.test.ts` 2 of 3 RED. Every mutated file was restored from a byte-exact snapshot (`cmp` identical) and `_plant.ts` deleted. |
| **Commit** | D1 | D1 |

**Test-plumbing changes (not assertion changes), recorded because section 4 lists the only permitted assertion edits.** Nine test files injected the stub as `loaderDeps: { retrievePatterns }` and now inject the same observation through `fixtureReaders({ patterns })`, because the dependency no longer exists: `app/api/analytics/reports/[id]/pdf/route.test.ts`, `components/analytics/report-body.test.tsx`, `components/analytics/worst-case.test.tsx` (4 sites), `lib/analytics/copy-lint.test.ts`, `lib/reports/__tests__/{assemble,escaping,generate}.test.ts`, and `supabase/__tests__/report-generation.test.ts` (the Tier-1 file now runs the real binding). `lib/analytics/__tests__/load.test.ts` fakes `listOutcomePatterns` in place of `retrievePatterns`. Where a stub could have weakened an assertion it was checked: `assemble.test.ts`'s `expect(p.patterns).toEqual(patterns)` is **byte-identical** (the const stays observation-only and the reader rows are built from it as `patternRows`), and the basic-business test now spies `listPatterns` on the reader and still asserts it is never called. `load.test.ts`'s "every reader gets the caller's client and business" loop lost its `retrievePatterns` special case because `listOutcomePatterns` takes `(client, businessId, …)` like every other fake, so the general assertion now covers it.

**security-reviewer (dispatched once, read-only, after the code was green).** Dispositions, each point:

| Point | Disposition |
|---|---|
| **Q1, PARTIAL**: no *call* path from the analytics surface reaches `createServiceRoleClient`, but the *import* graph still does, through lazy `import()`s inside functions that are never called; arm 2 is a name-level guard, not proof of unreachability | **Argued, not changed.** The constraint (ADR §9.1, L-8, #16) is that a user-facing *read* never acquires the service-role client. A lazy `import()` that is never invoked acquires nothing, and removing every module that contains one from the page's import graph would forbid the whole `lib/db` layer, which CLAUDE.md's lazy-import pattern requires. The guard that proves the property at runtime is `load.test.ts:347` (the factory throws and counts, through the default readers). Arm 2's name-level scope is stated in its comment and test titles; a transitive import-graph walk was the loser in section 4's engineering table ("a new tool for one finding"). |
| **Q2, YES** (fails closed on a wrong call id, a foreign row, a null `business_id`, an empty result; nothing in `lib/reports` or the cron route reads patterns outside `verifiedReaders`) | Confirmed; no action. |
| **Q2, LOW**: ownership was checked after the eligibility filter and the cap, so a foreign row the selection drops would never raise the alarm | **Fixed here.** `analytics-worker-reads.ts:45` asserts ownership on the raw rows before `selectOutcomePatterns`; `lib/db/analytics-worker-reads.test.ts` proves a foreign expired, candidate, hypothesis or no-counts row still throws; mutation (4). |
| **Q3, YES**: `retrieveOutcomePatterns` is byte-identical in filter, `rankAndCap` arguments, `now` semantics and output keys; `lib/ai` callers receive only the five keys | Confirmed; the five-key output is now pinned by `outcomes.test.ts`. |
| **LOW**: the worker binding in `lib/db` imports `@/lib/memory/outcomes` (and `@/lib/reports/isolation` for `assertOwned`), the reverse of "`/lib/memory` calls `/lib/db`" | **Argued.** Both imports are pure code with no database access, and neither module imports `lib/db/analytics-worker-reads`, so there is no cycle (`isolation.ts` imports only a *type* from `lib/analytics/load`). Section 4 fixes the worker binding as "the same function with its service-role client, inside `verifiedReaders`" with the selection shared; there is no other place for the worker's bound read to live. |
| **INFO**: `pattern_key` is carried through `Readers` and dropped at `load.ts:353`; `listOutcomePatterns` selects `*` but only mapped fields leave the loader; page-side tenancy rests on the RLS SELECT policy plus `.eq('business_id')` | Confirmed, no action. `pattern_key` stays on the row for D6, which renders patterns from the cell. The RLS policy is exercised by `outcome-campaign-view-rls.test.ts:79-121` (Tier 1), green on the local stack. |

**What I did NOT touch (D1):** `retrieveOutcomePatterns`'s output (pinned, not changed); the context-equivalence tests (7/6/5) and `performance.test.ts` (18), which are byte-unchanged and green; `listOutcomePatternsForGeneration`; `payload.patterns` (still the five-key observation, so the stored shape and the schema version are unchanged; D2 and D6 own any change to it).

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors (115 warnings, the pre-existing ones; the two D1 introduced were fixed); `npm run test:app` with `app-tests.yml`'s env block: 421 files, 6609 tests passed (6594 at `cea74d843`); `npm run test:db` against the LOCAL stack (`127.0.0.1:54321/54322`): 1382 passed, 1 failed. The one failure is `plan-proposals-current-version-read.test.ts` EXPLAIN, the pre-existing local failure of V.18 / Reviewer §0, reported and not fixed. `.env.local` was never loaded.

### MINOR-12 (partial; D11 carries the rest)

**Finding:** MINOR-12. **Fix (D1's share):** the new binding's callers and the test file:line for each are in the table above (`Readers.listPatterns`, `selectOutcomePatterns`, `listOutcomePatterns`). The unexecuted caller the Reviewer named is now executed: the real worker binding of the patterns read by Tier 1 (`report-generation.test.ts:94, 100`) and the page binding by `load.test.ts:340, 347`. `hasAdvancedAnalytics`'s page caller (`app/[locale]/(dashboard)/analytics/reports/[period]/page.tsx:59`) and the amended V.18 table are D11's. **Proof:** as above. **Reddening:** mutations (1) to (4) above. **Commit:** D1 (partial), D11 (complete).

### D2 — MINOR-7 (ruling A-12(a))

**A-12 consumed:** *(a) No: store ids and resolve labels at render*, ruled by the founder 2026-10-05 ("Assume the recommendations"). The §D2.5 row ("aggregates, template-sentence keys and params, exclusion counts and cited post ids … no post text") is therefore **true as written** and is not amended.

| Field | MINOR-7 |
|---|---|
| **Finding** | MINOR-7 |
| **Fix** | `lib/reports/assemble.ts`: the stored payload carries `campaignId` and `accountId` where it carried names and labels, and no business name (`header.params` is `{ month, measuredAsOf, generatedOn }`; `activity.rows` are `{ platform, accountId, count }`; `campaigns` rows have no `name`; `patterns` are the parsed cell `{ platform, dimension, value, direction, basis, wins, n, campaigns }` with no sentence). `REPORT_SCHEMA_VERSION` is **2**, bumped once here (`lib/reports/constants.ts`). Labels resolve at read time by `resolveReportLabels` (`lib/analytics/labels.ts`) over two bounded readers by (business, ids): the new `listCampaignNamesByIds` (`lib/db/campaigns.ts`, chunked by 20, live campaigns only) and the existing `listAccountLabels`, both with the caller's authenticated client. The page (`reports/[period]/page.tsx`) and the PDF route (`pdf/route.ts`, before `buildReportHtml` and before Chromium launches) call it and pass `businessName` and `labels` to `ReportBody`, which hydrates the shared sections (`hydrateActivity`, `hydrateCampaigns`). A missing campaign renders the existing "Open campaign" fallback and a missing account `analytics.account.unrecorded`. The email is not stored and keeps its live business name. |
| **Proof** | **JSON walk:** `lib/reports/__tests__/payload-no-names.test.tsx:42` (readers that mark every business name, campaign name, account label, handle and pattern sentence with `SECRET-`: no string leaf and no substring of the stored payload contains it, and none of the fixture's own unmarked names either), the positive control at `:53` (the ids and the cell ARE there), the basic tier at `:64`, an unparseable key dropped at `:71`. **Render, deleted campaign and removed account:** `payload-no-names.test.tsx:96` (fallback texts present, names absent) and `:107` (no label at all, no `NaN` or `undefined`). **Resolver, foreign id:** `lib/analytics/__tests__/labels.test.ts:56` (a leaky database returns B's row for B's id; it resolves to nothing). **PDF route:** `app/api/analytics/reports/[id]/pdf/route.test.ts:163` (the order records `labels:campaigns` and `labels:accounts` between `report` and `launch`, so the resolver runs before Chromium) and `:166` (resolved for the SESSION business, and a payload citing B's campaign id renders `analytics.campaignTable.open` and never `B active`). **Page:** `reports-pages.test.tsx:126` (the resolver is called with `(client, 'biz-a', ['c1'])`, and `ReportBody` receives `businessName` and `labels`). **Db reader:** `lib/db/campaigns-names.test.ts:12` (business filter, soft-delete filter), `:24` (chunks 20/20/5, bounded `limit`). |
| **Reddening** | **(1)** `campaign.name` put back into the payload (`assemble.ts` `campaigns: portfolio.campaigns.data`): `payload-no-names.test.tsx` 3 of 9 RED (the JSON walk, the positive control, the basic tier). **(2)** the account label put back (`rows: portfolio.activity.data.rows`): the same three RED. **(3)** `business: business.name` put back in `header.params`: the same three RED. **(4)** the resolver's own business check dropped from the campaigns read (`labels.ts`, `campaigns.filter((c) => c.name)`): `labels.test.ts:56` RED and `route.test.ts:166` RED. **(5)** `.eq('business_id', businessId)` dropped from `listCampaignNamesByIds`: `campaigns-names.test.ts:12` RED. Each file was restored from a byte-exact snapshot (`cmp` identical). |
| **Commit** | D2 |

**Why no back-compat renderer.** PR #20 is unmerged and nothing was ever generated at version 1 in production, so there is no stored report a version-1 reader would have to display. A reader that meets a version it does not read keeps its existing behaviour: not found (`page.tsx`, `route.ts`), asserted for versions 1 and 3 in `reports-pages.test.tsx` and `route.test.ts`.

**Real-Chromium isolation, rerun against the D2 document** (the Reviewer's §7 procedure: local Chrome through `launcherFor`, hostile business name, campaign names and account labels, and markup injected after React's escaping: an `<img>` at `169.254.169.254`, an `<img>`, a `<link>` and a `<script>fetch(…)` at a listening local server). **With the CSP: a valid `%PDF-` of 81,906 bytes, 0 intercepted requests, 0 server hits.** With the CSP meta removed (the control): 3 intercepted requests, still **0 server hits**, so the interceptor holds even without the CSP. (An ad-hoc script, as the Reviewer's was; it is not committed.)

**Assertions that changed, each quoted with its old text** (section 4 permits the id-for-name changes; the row marked ‡ is a D6-category assertion that D2's payload change forced early, argued below):

| File | Old assertion | New assertion |
|---|---|---|
| `lib/reports/__tests__/assemble.test.ts:30` | `schemaVersion: 1` | `schemaVersion: 2` |
| `lib/reports/__tests__/assemble.test.ts:31` | `header` params `{ business: 'Fixture A (Lisbon)', month: '2026-03', measuredAsOf: NOW, generatedOn: NOW }` | `{ month: '2026-03', measuredAsOf: NOW, generatedOn: NOW }` |
| `lib/reports/__tests__/assemble.test.ts:84` (was :83) | `expect(p.patterns).toEqual(patterns)` with `patterns = [{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }]` | the same expression, with `patterns = [{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }]` (the stored cell) |
| `lib/reports/__tests__/generate.test.ts:104` | `schema_version: 1` | `schema_version: 2` |
| `supabase/__tests__/report-generation.test.ts:77` | `schema_version: 1` | `schema_version: 2` |
| `supabase/__tests__/report-generation.test.ts:99` (D1's own, was :96-97) | `expect(payload.patterns.map((p) => p.pattern)).toEqual([A_PATTERN])` and `.not.toContain('B-LEAK-CANARY')` | `expect(payload.patterns).toEqual([{ platform: 'twitter', dimension: 'format', value: 'question', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }])`; B's seeded cell now differs by key and counts; and `not.toContain('Stored English sentence')` |
| `app/[locale]/(dashboard)/analytics/reports/reports-pages.test.tsx` | `schema_version: 1`, `schemaVersion: 1`, header `params: { business: 'Acme', … }`, and the unreadable version `schema_version: 2` | `2`, `2`, params without `business`, and the unreadable versions `3` and `1` |
| `app/api/analytics/reports/[id]/pdf/route.test.ts` | `schema_version: 1`; unreadable version `row({ schema_version: 2 })`; `expect(order).toEqual(['client', 'getUser', 'business', 'report', 'launch', 'setContent'])` | `2`; `3` and `1`; `['client', 'getUser', 'business', 'report', 'labels:campaigns', 'labels:accounts', 'launch', 'setContent']` |
| `lib/analytics/__tests__/load.test.ts:198, 342` | `toEqual([{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }])` | the same plus `cell: { platform: 'twitter', dimension: 'format', value: 'question', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }` (the live page still prints the row's sentence; D6 owns that) |
| `lib/reports/__tests__/escaping.test.tsx` | the hostile string was injected into the payload (`header.params.business`, `campaigns[0].name`, `activity.rows[0].label`), and the test was titled "…campaign name, account label and pattern text are escaped text, never markup" | the hostile string enters where names now enter (`businessName`, and `labels` for every campaign and account id); the title drops "pattern text", which can no longer exist in a payload. Every `noLiveMarkup` and `&lt;script&gt;` assertion is unchanged. |
| `components/analytics/worst-case.test.tsx` | the worst names were put into the payload (`header.params.business`, `campaigns[i].name`, `activity.rows[i].label`) | the same strings arrive as `businessName` and `labels` (`worstLabels(p)`); every "no `NaN`, `undefined` or raw key" assertion is unchanged |
| ‡ `components/analytics/report-body.test.tsx:94, 105` | `not.toContain('Posts with a question opening beat your usual.')` (gated) and `toContain('Posts with a question opening beat your usual.')` (restored) | the same two assertions over `'On X, thread posts beat your usual engagement.'` |

‡ **Argued.** The old sentence was an English string a test injected into a stub, which the real pipeline never produced (the blind spot MAJOR-2 names). With the payload now holding a cell, that sentence cannot reach the report at all, so the old negative assertion would pass vacuously and the old positive one would fail. D2 therefore had to render a stored cell, and it does so with the **existing** `outcome.observed.*` keys that the campaign page already translates in en/pt/es (`provisional_line`, `verb_above`, `verb_below` and their `_count` forms, `subject.<dimension>.<value>`), without adding a key or a template. D6 still owns everything the MAJOR-2 and MAJOR-1 rows name: the dedicated analytics templates, the one-Sentry-message rule for an unparseable key (D2 only drops it from the payload, `payload-no-names.test.tsx:71`), the lint corpus built from the real vocabulary, and `analytics.state.noPatternYet`.

**Shared-function callers (D2).** `loadPortfolioWith` keeps its callers (the page, the PDF route through the stored payload, the assembler); `Portfolio.patterns` rows now carry `cell` (`load.test.ts:198, 342`, `analytics-surfaces.test.tsx`). `ReportBody` has two production callers, both updated: `reports/[period]/page.tsx` (`reports-pages.test.tsx:126`) and `lib/reports/pdf-html.ts`, reached from `pdf/route.ts` (`route.test.ts:163, 166`; `escaping.test.tsx`). `parsePatternKey` (new, `lib/outcomes/pattern-key.ts`) has two callers: `lib/outcomes/campaign-view.ts` (its existing tests are green and unchanged) and `lib/analytics/load.ts` (`payload-no-names.test.tsx:53, 71`).

**What I did NOT touch (D2):** no back-compat renderer (the reason is above); the email's live labels are not stored (`deliver.ts` still passes `business.name`); `listCampaigns` and its other callers; `renderOutcomePattern` and `performance_memory.pattern`; the live page's pattern sentence; the §D2.5 row.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors, no warning in a D2 file; `npm run test:app` with `app-tests.yml`'s env block: 424 files, 6633 tests passed; `npm run test:db` against the LOCAL stack: 1382 passed, 1 failed, the same pre-existing `plan-proposals-current-version-read` EXPLAIN failure (V.18, Reviewer §0), reported and not fixed.

### D3 — MAJOR-10 (ruling A-14(a))

**A-14 consumed:** *(a) Make it true of the month, from reads the loader already makes*, ruled by the founder 2026-10-05 ("Assume the recommendations"). The loser (b), head counts of current statuses labelled "now", and (c), the old wording over head counts, are not built. The truncated-read half of MAJOR-10 is a FIX under every branch; the wording half is closed by (a).

| Field | MAJOR-10 |
|---|---|
| **Finding** | MAJOR-10 |
| **Fix** | `lib/db/campaigns.ts`: new `listCampaignsByIds(client, businessId, ids)` returning exactly `id, business_id, name, status`, with `.eq('business_id')`, `.is('deleted_at', null)`, chunks of 20 and a per-chunk `.limit(20)`; no page of the business's campaigns is read. `lib/analytics/load.ts`: `Readers.listCampaigns` is gone, `Readers.listCampaignsByIds` replaces it. `loadPortfolioWith` no longer reads campaigns up front; it reads the retrospectives, then the posts, and asks for names and statuses only for the ids that appear in the month's posts and retrospectives. The Pro retrospectives list (a multi-month window) asks by id for its own campaign ids. `loadPosts` asks by id for the filtered posts' campaigns. `activity.campaigns` is now `{ withPosts: <distinct campaign_id of the month's published posts>, retrospectivesCompleted: monthRetros.length }`. `lib/db/analytics-worker-reads.ts` binds `listCampaignsByIds` to the service-role client and `lib/reports/isolation.ts` verifies its rows (`rows(id, 'listCampaignsByIds', ...)`). The key `analytics.activity.campaigns` keeps its name and takes the A-14(a) sentence in en/pt/es (params `withPosts`, `retrospectivesCompleted`). |
| **Proof** | `lib/analytics/__tests__/load.test.ts`: *101+ campaigns, the oldest carrying the month* (100 fillers newer than the fixture campaigns, so a 100-row page holds none of the campaigns that carry the month): the stored counts and every campaign-table name equal the few-campaign result; *read by id only* (`listCampaigns` never called, `listCampaignsByIds` called with the caller's client, the loop's business and a non-empty id list); *loadPosts names a campaign beyond the page*. The tenancy loop now asserts `listCampaigns` is never called. `lib/db/campaigns-by-ids.test.ts` (new): business filter, soft-delete filter, columns, chunking by 20, de-duplication, no read for no ids, error propagation. Tier-1: `supabase/__tests__/analytics-reads.test.ts` gains the `listCampaignsByIds` arm (A's campaigns with exactly four columns, B's id asked for under A returns nothing). Wording: `lib/i18n/analytics-parity.test.ts` renders the sentence in en/pt/es at 0, 1 and 2. |
| **Reddening** | The page binding of `listCampaignsByIds` was re-pointed at the 100-row `listCampaigns` (`authenticatedReaders`, filtering the page by id): `load.test.ts` 4 of 45 RED (the 101-campaign test, the by-id-only test, the loadPosts test, the tenancy loop). Restored with `cp`; `cmp` against the pre-mutation copy identical. |
| **Commit** | D3 |

**Assertions that changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `load.test.ts:149-153` | title `'... 5 the month before, 2 active and 1 completed campaign'`; `expect(a.campaigns).toEqual({ active: 2, completed: 1 })` | title `'... posts from N campaigns and M retrospectives completed in the month (A-14(a))'`; `toEqual({ withPosts: 3, retrospectivesCompleted: 2 })` (the fixture's three campaigns carry March posts; `RETROS` r1 and r2 are both completed in March) |
| `assemble.test.ts:38` | title `'section 3, activity: ... 2 active and 1 completed campaign'`; `toEqual({ active: 2, completed: 1 })` | `... posts from 3 campaigns and 1 retrospective completed in the month`; `toEqual({ withPosts: 3, retrospectivesCompleted: 1 })` (the report fixture's `RETROS` holds one March retrospective) |
| `analytics-parity.test.ts` `activity.campaigns` | `'1 active campaign, 1 completed.'`, `'2 active campaigns, 0 completed.'`, `'1 campanha ativa, 1 concluída.'`, `'0 campanhas ativas, 2 concluídas.'`, `'1 campaña activa, 1 completada.'`, `'2 campañas activas, 2 completadas.'` | the six A-14(a) sentences, e.g. `'Posts came from 1 campaign. 1 campaign completed its retrospective this month.'` |
| `analytics-surfaces.test.tsx`, `worst-case.test.tsx`, `labels.test.ts`, `reports-pages.test.tsx` | `campaigns: { active: 2, completed: 1 }`, `{ active: 10_000, completed: 1 }`, `{ active: 0, completed: 0 }`, `{ active: 1, completed: 0 }` | the same values under `withPosts` / `retrospectivesCompleted` (shape only) |

**Shared-function callers (D3).** `Readers.listCampaigns` had three bindings, all updated: `authenticatedReaders` (`load.test.ts`), `analyticsWorkerReaders` (Tier-1 `report-generation.test.ts`, which runs the real worker path) and `verifiedReaders` (`isolation.test.ts:66, 76, 89`, which plants a foreign row and expects `TenantMismatchError`), plus the `fixtureReaders` fake (`readers.ts:44`). `listCampaigns` itself is unchanged and keeps its other callers: `lib/ai/context.ts`, `lib/campaigns/planner/tools.ts`, `lib/signals/triage/tools.ts` and the approvals, campaigns and analytics/posts pages. The analytics/posts page (`analytics/posts/page.tsx:42`) still reads `listCampaigns` for its campaign FILTER list; that is a selector, not an aggregate or a name lookup for a row, and it is outside this finding; I name it so the founder can rule on it at D12.

**Storage note.** The stored `activity.campaigns` shape changed inside `REPORT_SCHEMA_VERSION = 2`, the version D2 introduced. PR #20 is unmerged and no version-2 report exists outside the local stack, so no second bump is needed (the same reasoning as D2's "why no back-compat renderer").

**For D11.** ADR 0031 §9.1's read table gains `listCampaignsByIds` (column-listed, business-bound, chunked, verified in the worker), and §3.2's campaign line takes the A-14(a) wording.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors; `npm run test:app` with `app-tests.yml`'s env block: 425 files, 6640 tests passed; `npm run test:db` against the LOCAL stack: 1383 passed, 1 failed, the same pre-existing `plan-proposals-current-version-read` EXPLAIN failure (V.18, Reviewer §0), reported and not fixed.

### D4 — MAJOR-5, MINOR-8 (ruling A-13(a)), NIT-6

**A-13 consumed:** *(a) Yes, bounded and idempotent*, ruled by the founder 2026-10-05 ("Assume the recommendations"). MINOR-8 is therefore a FIX in this commit, not a D4b. **Verified first, as the step requires:** `email_outbox_dedupe_uq` (`20260607100000_email_outbox.sql:27`) is `CREATE UNIQUE INDEX ... ON public.email_outbox (business_id, kind, coalesce(dedupe_token, ''))`, and `lib/email/enqueue.ts` writes `dedupe_token` from the `report:{YYYY-MM}:{member id}` token `deliver.ts` passes; the Tier-1 arm below inserts a duplicate token and gets `23505`.

| Field | MAJOR-5 | MINOR-8 | NIT-6 |
|---|---|---|---|
| **Finding** | MAJOR-5 | MINOR-8 | NIT-6 |
| **Fix** | `lib/reports/generate.ts`: `reportScanOffset(now)` (first 32 hex digits of `sha256(<tick hour, UTC ISO>)` as a uuid); `scanOrder` yields ids above the offset, then ids at or below it (disjoint ranges, so one visit each, an id equal to the offset included). Three bounds, checked with a business in hand: generation (`maxPerTick`), errors (`REPORT_ERROR_CAP` = 25, new, tripped by the 26th error) and scan (`REPORT_SCAN_CAP`); `capped` is exact and `reason` is `generation_cap`, `error_cap` or `scan_cap`. Errors no longer spend the generation budget. `route.ts`: a capped tick sends `Sentry.captureCheckIn({ monitorSlug: 'generate-reports', status: 'error' })`; the canonical `report.tick` line gains `reason` and `redelivered`. | `generate.ts`: on `exists`, one extra read (`getReportForRedeliveryForWorker`: `generated_at`, `stub`, `summary`); a non-stub report generated under `REPORT_REDELIVERY_HOURS` (72) ago is returned as a `redeliver` candidate. `deliver.ts` `redeliverMonthlyReport`: resolve recipients, one head count of `report:{YYYY-MM}:` rows (`countMonthlyReportEmailsForWorker`), and only if the outbox has fewer rows than recipients run `deliverMonthlyReport` again (the unique index no-ops every member already queued). `job.ts` runs it after the first deliveries; a throw is captured into `emails.errors`. Never for a stub, never for `off` (no recipients resolve, so the count read is not even made). | `resolveReportRecipients`: reads `REPORT_RECIPIENT_MAX + 1`, orders `(created_at, id)`, returns the first 200, and on overflow sends ONE `Sentry.captureMessage` carrying the business id. |
| **Proof** | `generate.test.ts`: 2,100 ids spread over the uuid space with only the last due: every tick before the exact tick the offsets reach it reports `capped`, `reason: 'scan_cap'`, `scanned: 2000`, and the business is generated at the tick the test computes independently from the offsets; 25 failing ids then one due business: generated in the FIRST tick with `errors: 25`; 26+ failures end the tick `error_cap`; an offset equal to an existing id visits all 7 ids once in wrap order; offsets above the last and below the first id each visit everything once. `route.test.ts`: a capped summary sends the `error` check-in; an uncapped one, and a job that threw, send none. | `generate.test.ts`: 10 h and 71 h ago are candidates; 72 h and 73 h are not; a stub and a missing report are not. `job.test.ts`: each candidate is passed to `redeliver`, only a non-null result is counted, a throw is captured and the next still runs, and a first delivery that throws is followed by a later tick that enqueues the one missing member. `deliver.test.ts`: no delivery when the outbox is full; short outbox delivers and the queued member is `deduped`; `off` does nothing and does not count. Tier-1 `report-generation.test.ts`: the real redelivery read, the per-business/kind/month count, and the duplicate-token `23505`. | `report-recipients.test.ts`: 201 members -> 200 returned in order and exactly one capture naming the business; exactly 200 -> no capture. |
| **Reddening** | `scanOffset` fixed at zero (the cursor never wraps): the 2,100-candidate test RED. Errors added to `attempts`: the 25-failing-ids test and the error-cap test RED. | The 72 h bound removed (`< 1e15`): the 71/72/73 hour test RED. | The overflow capture disabled (`if (false)`): the 201-member test RED. |
| **Commit** | D4 | D4 | D4 |

Each mutation was applied alone and the file restored with `cp`, `cmp` identical.

**Two readings I chose, argued.** (1) **`REPORT_ERROR_CAP` ends the tick on the 26th error, not the 25th.** Section 4 asks both for "its own cap of 25" and for "25 failing low ids followed by one due business -> the due business is generated in the FIRST tick"; a cap that fired on the 25th error would leave the 26th id unvisited and fail the second requirement, so the cap tolerates 25 errors and stops on the next one. (2) **The 72 h bound reads `analytics_reports.generated_at`, not `created_at`.** Section 4 and A-13 say `created_at`; the table has no such column (`20261004120000_analytics_reports.sql:27-39`: `generated_at` is the report's own timestamp, written from the tick's `now`), so `generated_at` is the same instant.

**silent-failure-hunter (once, over `lib/reports/**`, the cron route, the recipients function and the three new db reads), dispositioned.** No blocker.

| Point | Disposition |
|---|---|
| **M1** (MAJOR): a failing redelivery read throws inside the tick's try/catch, counts in `errors`, spends `REPORT_ERROR_CAP` and starves the due businesses behind it | **FIXED.** The read is wrapped in `generateReportForBusiness`; a failure returns `exists` with a `redeliveryReadError`, the tick captures it and counts it in a new `redeliveryReadErrors` counter, never in `errors`. Test: 30 businesses whose redelivery read throws -> `errors: 0`, `redeliveryReadErrors: 30`, `capped: false`; reddened by re-throwing (RED), restored. The hunter's second suggestion, folding `generated_at` into the existence probe so the extra read is not made all month, is **not done**: it changes the probe every existing test stubs, and the extra read is one single-row query per existing report per tick, inside the same `REPORT_SCAN_CAP` bound the probe already has. Recorded for the founder at D12 if the scan cost matters. |
| **M2** (MAJOR, borderline): `stub === true` and `summary ?? []` turn a missing flag or summary into "not a stub, empty email" | **FIXED.** The read throws when `stub` is not a boolean, or when `summary` is not an array or is empty for a non-stub report; the throw takes the M1 path (captured, own counter). Tier-1 test inserts two malformed reports and expects both to reject. |
| **m1** (MINOR): count against count, so an ex-member's row can pad the outbox count and hide a failed enqueue for a new member | **ARGUED, not changed.** A-13(a) as ruled compares the number of queued rows with the number of resolved recipients, and reads ONE outbox count. Comparing member ids would need the tokens, not a head count. The case needs a member to leave and another to join inside 72 h of the report. Named so it is a decision. |
| **m2** (MINOR): the second check-in is separate from `withMonitor`'s, and `failureIssueThreshold: 2` means alternating capped and uncapped ticks never alert; a month-start backlog over 25 fires it too | **ARGUED, not changed.** Section 4 says the route reports a capped tick with status `error`. The moving offset does make capped/uncapped alternation possible; the threshold is an operations setting (`launch-checklist.md`), not a D4 code change. Both effects are noted for D11 and the launch checklist. |
| **m3** (MINOR): only the first bound hit is recorded as `reason` | **ARGUED, not changed.** `capped` is true either way; the precedence (generation, errors, scan) is fixed. |
| **N1** (NIT): outbox rows in `failed`/`dead` status count toward the redelivery count | **ARGUED.** The outbox owns its own retries; redelivery fills in MISSING rows, not failed sends. |
| Points 1, 3 and 4 of the question | (1) a suppressed member DOES have an outbox row (`enqueue.ts` inserts it with status `suppressed`), so the count includes it and nothing loops. (3) a job that threw already sent `withMonitor`'s error check-in. (4) a `listBusinessIds` failure rejects the tick loudly (error check-in, `errors: 1`); the reports inserted on earlier pages are re-sent by the redelivery window on the next hour, which holds for 72 h. |

**Assertions that changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `generate.test.ts` "at most maxPerTick" | `toMatchObject({ inserted: 1, capped: true })` | `... capped: true, reason: 'generation_cap' }` |
| `supabase/__tests__/report-generation.test.ts` "#22: a SECOND run inserts nothing" | `expect(again).toEqual({ status: 'exists', inserted: false })` | `toMatchObject({ status: 'exists', inserted: false, redeliver: { businessId: BUSINESS_A_ID, period: '2026-03' } })` (inside 72 h a second run now also returns a candidate; the outbox decides whether anything is sent, and `inserted: false` still means no second row) |
| `report-recipients.test.ts` | `expect(calls.limit).toBe(REPORT_RECIPIENT_MAX)`; `expect(calls.order).toBe('created_at')` | `toBe(REPORT_RECIPIENT_MAX + 1)`; `toBe('created_at,id')` |
| `route.test.ts` | `LINE_KEYS` without `reason`, `redelivered`; `expect(counters).toHaveLength(12)` | both keys added; `toHaveLength(14)` |
| `job.test.ts` `tickSummary` | no `reason`, `redeliverReports`, `redeliveryReadErrors` | the three fields added (type shape only) |

**Shared-function callers (D4).** `runReportTick`: `runReportJob` (`job.test.ts` with an injected tick) and the live Tier-1 `report-generation.test.ts` path through `generateReportForBusiness`. `generateReportForBusiness`: the tick, and the Tier-1 test directly. `resolveReportRecipients`: `deliverMonthlyReport` and the new `redeliverMonthlyReport` (`deliver.test.ts` mocks it; `report-recipients.test.ts` covers the function; scan #23 in `lib/analytics/source-scans.test.ts` still passes). `deliverMonthlyReport` is unchanged in behaviour and has the same callers plus `redeliverMonthlyReport`.

**What I did NOT touch (D4):** the due rule, the generation of a report, the email template, the stub month, no migration (the index and the `monthly-report` kind already exist).

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors; `npm run test:app` with `app-tests.yml`'s env block: 425 files, 6663 tests passed; `npm run test:db` against the LOCAL stack: 1386 passed, 1 failed, the same pre-existing `plan-proposals-current-version-read` EXPLAIN failure (V.18, Reviewer §0), reported and not fixed.

### D5 — MINOR-11

| Field | MINOR-11 |
|---|---|
| **Finding** | MINOR-11 |
| **Fix** | The ceiling is injectable end to end and the default is unchanged. `lib/analytics/load.ts`: `LoaderDeps.readCeiling` (default `READ_CEILING`), a new `ReadOptions { ceiling? }`, and the three paged `Readers` members (`listPublishedPostsInRange`, `listMonthOutcomes`, `listTrendOutcomes`) take it as a trailing optional argument that the loader passes from `d.readCeiling` at every call site (the portfolio's posts read, the month and trend outcome reads through `measurePlatform`, and `loadPosts`). `lib/db/posts.ts` and `lib/db/post-outcomes.ts` hand it to `readAllPages` (which already accepted `ceiling`; "production never lowers it" still holds, nothing in production passes one). `analyticsWorkerReaders` and `verifiedReaders` forward it unchanged. |
| **Proof** | New `lib/analytics/__tests__/read-ceiling.test.ts`. Its readers run the REAL `readAllPages` (page size 5) over an in-memory paged source holding the O2.1 fixture's 18 published posts in A's two-month window (13 in March, 5 in February). **Loader:** at the default ceiling the section is a number (13 published, 5 the month before); at ceiling 18 it is still a number and at 17 it is `{ status: 'error', reason: 'ceiling' }` (the boundary); at ceiling 10 `activity`, `platforms` and `campaigns` are all the error state and the serialised view model contains none of `"total"`, `"previousTotal"`, `"rows"`, `"withPosts"`, `"retrospectivesCompleted"`, `"published"`. **Generator:** at the default ceiling the report is stored; at ceiling 10 through `runReportTick` no `analytics_reports` row is inserted, the tick records `errors: 1, inserted: 0`, and the captured error is the "exceeded its ceiling" refusal (D4's error cap counts it). The pager's own refusal is asserted to be the typed `ReadCeilingExceeded`. |
| **Reddening** | `readAllPages` made to return the rows read so far at the ceiling instead of throwing (`if (rows.length > ceiling) return rows.slice(0, ceiling)`): the four composition tests (17, 10, the generator at 10, the typed error) RED, and the two existing constant-pin tests in `keyset-pager.test.ts` also RED, as they should. They are unchanged. Restored with `cp`; `cmp` identical and `git diff --stat -- lib/db/keyset-pager.ts` empty. |
| **Commit** | D5 |

**What the old tests could not see.** `keyset-pager.test.ts` (3) and `lib/db/__tests__/analytics-reads.test.ts` (4) went red at `READ_CEILING = 10` because they pin the constant and the page arithmetic. Every loader, report and page test uses fake readers that bypass `readAllPages`, so "an error, never a number" (#36) was proven in halves. The new file is the composition: pager, reader, loader, section, report.

**Shared-function callers (D5).** `Readers.listPublishedPostsInRange`, `listMonthOutcomes` and `listTrendOutcomes` have four bindings, all forwarding the new argument: `authenticatedReaders` (the pages; `load.test.ts`, `read-ceiling.test.ts`), `analyticsWorkerReaders` (Tier-1 `report-generation.test.ts`, the real worker path), `verifiedReaders` (`isolation.test.ts`) and the `fixtureReaders` fake, which ignores it. The db functions' other callers pass no `ceiling` and behave exactly as before.

**What I did NOT touch (D5):** the value of `READ_CEILING`, the pager's arithmetic, `countPublishedPostsInRange` (a head count, not paged) and the dimension, metric and label reads (chunked by id, bounded by their inputs).

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors; `npm run test:app` with `app-tests.yml`'s env block: 426 files, 6669 tests passed; `npm run test:db` against the LOCAL stack: 1386 passed, 1 failed, the same pre-existing `plan-proposals-current-version-read` EXPLAIN failure (V.18, Reviewer §0), reported and not fixed.

### D6 — MAJOR-2, MAJOR-1 (ruling A-8(a))

**A-8 consumed:** *(a) A new §8.2 state, `analytics.state.noPatternYet`*, ruled by the founder 2026-10-05 ("Assume the recommendations"). The en text is the ruled literal, verbatim: *"No pattern has enough evidence yet. Jemip only learns a pattern from at least 10 posts across 3 campaigns."* The pt and es renderings (translated naturally, as the ruling says): pt *"Ainda nenhum padrão tem evidência suficiente. O Jemip só aprende um padrão a partir de, pelo menos, 10 publicações em 3 campanhas."*; es *"Todavía ningún patrón tiene evidencia suficiente. Jemip solo aprende un patrón a partir de al menos 10 publicaciones en 3 campañas."*

| Field | MAJOR-2 | MAJOR-1 |
|---|---|---|
| **Finding** | MAJOR-2 | MAJOR-1 |
| **Fix** | A pattern is now only its **cell**: `PatternObservation` is `PatternCell` (`platform, dimension, value, direction, basis, wins, n, campaigns`), and the stored English sentence no longer leaves `lib/memory`. `lib/analytics/load.ts`: `patternCellOf` parses the key with the shared `parsePatternKey` (D2) and also refuses a cell the templates have no words for (a platform, dimension or value outside the new `OUTCOME_PATTERN_VOCABULARY`, exported from `lib/outcomes/template.ts` and built from the same tables `renderOutcomePattern` uses). A row whose key does not parse is **dropped, never rendered from `pattern`**, and ONE `Sentry.captureMessage` per load carries the count and the business id (no key text). `PatternsSection` composes the sentence in the reader's locale from four new templates `analytics.pattern.{above,below,above_count,below_count}` (one per direction x basis), the platform name key and the `outcome.observed.subject.*` keys the campaign page already translates. The evidence (wins of n, campaigns) is inside the sentence, stated once: the separate `analytics.patternEvidence` line and key are removed from all three locales. The report path (`ReportBody`) now feeds the stored cells straight to the same component; `assemble.ts` stores `adv.patterns.data` as is. | `PatternsSection` (page and `ReportBody`) renders `analytics.state.noPatternYet` when no pattern qualifies. The section is reached only for a month that HAS posts (a month with none shows `analytics.state.empty` for the whole page, and a stub month renders no sections), so `state.empty` is never shown under *Observed patterns*. |
| **Proof** | `components/analytics/patterns.test.tsx` (new), over the REAL cell of a REAL row (`pattern_key` set, the English sentence memory stores next to it, taken from `renderOutcomePattern` itself): in en, pt and es the page section and the stored report each contain the localized sentence and **none** of `renderOutcomePattern`'s output; the control asserts that sentence is English and is not any locale's rendering; the evidence appears once; a LinkedIn count-basis cell uses the count template. `load.test.ts`: a malformed key and an out-of-vocabulary cell are dropped with one message carrying `{ businessId, dropped: 2 }` and no stored sentence anywhere in the view model; a `sideways` direction is dropped (its own case: the memory selection caps at three rows); no drop means no message. **The lint and the parity test now meet the real vocabulary:** `copy-lint.test.ts` (e) renders all 2 platforms x 18 values x 2 directions x 2 bases = 144 cells per locale through the new keys: none trips any of the six classes, none prints a raw key or ICU, every sentence has its win count next to its n. `analytics-parity.test.ts` renders the same corpus through the real ICU formatter (next-intl). | `patterns.test.tsx`: in all three locales the page section and the report of March (13 posts, zero patterns) contain `noPatternYet` and not `analytics.state.empty`, the en text is asserted to be the ruled literal, and `analytics-parity.test.ts` asserts the key exists in all three locales. |
| **Reddening** | The English sentence rendered again (the section built from `renderOutcomePattern(cell)`, i.e. the old behaviour): 8 of 16 in `patterns.test.tsx` RED (page and report, en, pt and es; the evidence-once test; the count-basis test). | `noPatternYet` replaced by `state.empty` in `PatternsSection`: 6 of the 116 RED (page and report, en, pt, es). Both restored with `cp`; `cmp` identical. |
| **Commit** | D6 | D6 |

**A finding the real vocabulary produced.** The corpus found that the one subject the six-class lint trips on is the **es customer-proof subject**: `outcome.observed.subject.role.customer_proof` is *"publicaciones de prueba de cliente"* and *"prueba"* is the lint's es directive word (it also means "proof"). This is the same known false positive as `RENDERED_EXEMPT_KEYS` (`outcome.role.customer_proof`, ADR 0031 §8.4), which the report-body lint already removes by its rendered text. The corpus applies the **same** treatment to that one subject and **a test asserts it is the only one**: of every real cell, exactly `es:role.customer_proof` trips a class without it. The class is not loosened and no copy was changed (the subject text is shared with the campaign page, ADR 0026).

**Fixtures that were not real.** The test data used pattern key `outcome:format:question:above:twitter`. `question` is not a value of `format` (the vocabulary is `single`, `thread`, `carousel`; `question` is a **hook type**), so the fixture described a pattern the product cannot produce. That is MAJOR-2's blind spot in key form: the lint never met a real cell because the data never held one. Every fixture now uses `outcome:format:thread:above:twitter`, and the loader refuses a cell outside the vocabulary.

**A slip of mine, caught and repaired before commit.** A regex I used to rewrite the pattern assertions in `load.test.ts` deleted about 190 lines of unrelated tests from that file (about 23 tests). `npm run lint` showed the symptom (new unused-variable warnings, 117 instead of 113), I read the diff, restored the file from HEAD and reapplied only the intended edits. The commit's diff of `load.test.ts` is 38 insertions and 3 deletions, and `test:app` ran 6698 tests, not the 6675 the damaged file had produced.

**Assertions that changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `load.test.ts` fixture row | `pattern: 'Posts with a question opening beat your usual.'`, `pattern_key: 'outcome:format:question:above:twitter'` | `pattern: 'On X, thread posts beat this brand\'s usual engagement.'` (what the template produces), `pattern_key: 'outcome:format:thread:above:twitter'` |
| `load.test.ts` (the pattern read through the authenticated client; and the Pro portfolio still loads) | `expect(ok(p.patterns)).toEqual([{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3, cell: { platform: 'twitter', dimension: 'format', value: 'question', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 } }])` (twice) | `toEqual([{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }])` |
| `analytics-surfaces.test.tsx:94` | `data: [{ platform: 'twitter', pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3, cell: null }]` | the same row as a cell (`dimension: 'format', value: 'thread', direction: 'above', basis: 'rate'`) |
| `app/api/analytics/reports/[id]/pdf/route.test.ts:201` | `expect(setContentHtml).not.toContain('Posts with a question opening beat your usual.')` | `not.toContain('On X, thread posts beat this brand\'s usual engagement.')` |
| `report-body.test.tsx:94, 105` (D2's minimal render) | `not.toContain('On X, thread posts beat your usual engagement.')` / `toContain(...)` | the new sentence, which states the evidence once: `'On X, thread posts beat your usual engagement in 7 of 10 posts (3 campaigns).'` |
| `report-body.test.tsx:95` | `expect(body).not.toContain('Based on 10 posts across 3 campaigns.')` | unchanged (the key is gone, the assertion stays true) |
| `supabase/__tests__/report-generation.test.ts` | `A_KEY = 'outcome:format:question:above:twitter'`; `payload.patterns` `toEqual([{ ..., value: 'question', ... }])` | `thread` in both |
| `isolation.test.ts` | `PATTERN_A` `pattern_key: 'outcome:format:question:above:twitter'` | `thread` |

**Shared-function callers (D6).** `PatternsSection`: the live page (`PortfolioView`, `analytics-surfaces.test.tsx`) and `ReportBody` (`report-body.test.tsx`, `patterns.test.tsx`, the lint (c) rendered check, the PDF through `pdf-html.ts`). `patternCellOf`: the loader only (`load.test.ts`). `Portfolio.patterns` consumers: `assemble.ts` (`assemble.test.ts`, `payload-no-names.test.tsx`), the page and the report. `renderOutcomePattern` and `performance_memory.pattern` are untouched; generation still reads the English sentence (D1's V.2 baseline tests are unchanged and green).

**What I did NOT touch (D6):** the stored `pattern` column, `retrieveOutcomePatterns` and the three context-equivalence tests, the campaign page's own pattern rendering, no migration.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors, 113 warnings (unchanged); `npm run test:app` with `app-tests.yml`'s env block: 427 files, 6698 tests passed; `npm run test:db` against the LOCAL stack: 1386 passed, 1 failed, the same pre-existing `plan-proposals-current-version-read` EXPLAIN failure (V.18, Reviewer §0), reported and not fixed.

### D7 — MAJOR-8 (A-9), MAJOR-9 (A-10), MINOR-6 (A-11)

**Rulings consumed**, each *(a)*, each ruled by the founder 2026-10-05 ("Assume the recommendations"):
- **A-9(a)**: the wins slot below its floor has its own thin key, `analytics.state.thinWins`, whose n is the baseline count and names it. Ruled en: *"{n, plural, one {# post} other {# posts}} had a usual to compare against. A win count appears from 5."*
- **A-10(a)**: two templates chosen by `rangeKind`; from 10 the spread is *"(middle half of posts {lo}–{hi})"*; the methodology `median` key gains *"Below 10 posts the range is lowest to highest; from 10 it is the middle half of posts."*
- **A-11(a)**: a breakdown value with fewer than 5 posts is thin: `analytics.breakdown.thinValue`, *"Fewer than 5 posts"*, with no k and no n.

| Field | MAJOR-8 | MAJOR-9 | MINOR-6 |
|---|---|---|---|
| **Finding** | MAJOR-8 | MAJOR-9 | MINOR-6 |
| **Fix** | `lib/analytics/view-model.ts`: `winsView` returns `key: 'analytics.state.thinWins'` with `params: { n: w.of }` (the baseline count) below the floor; the shared `analytics.state.thin` stays for the typical line, whose n IS the measured count. New key in en, pt, es. The en text is the ruled literal; pt *"Publicações com um habitual para comparar: {n}. A contagem de vitórias aparece a partir de 5."*, es *"Publicaciones con un habitual para comparar: {n}. El recuento de victorias aparece a partir de 5."* (no plural form, so the same string is right at 0, 1 and 2 in a language whose plural rules differ). | `typicalView` chooses `analytics.typical` (range) or the new `analytics.typicalIqr` from the `rangeKind` it already computes. `TypicalLine`, the report and the email already render `view.key`, so every surface follows with no component change. pt *"(metade central das publicações {lo}–{hi})"*, es *"(mitad central de las publicaciones {lo}–{hi})"*. The methodology `median` sentence is extended in all three locales. | `breakdownView` splits the values at the display floor: rows with `of >= 5` stay as they were; values below it go to a new `thinValues: string[]`, carrying only the name. No k, n, share or bound is computed for them, so none can be printed. `BreakdownBlock` (page and report) prints `{value}: {analytics.breakdown.thinValue}` for each, and the "describes past posts" note shows when there is any row or thin value. |
| **Proof** | `view-model.test.ts`: B (March, Sao Paulo, real fixture records): 2 measured posts and 1 with a usual -> the exclusions line says 2 measured, the typical line is thin with n = 2, the wins line is `thinWins` with n = 1 and its en, pt and es literals do not contain "measured" or "medid-"; the three renderings are asserted verbatim. | `view-model.test.ts`: **n = 9** -> key `analytics.typical`, literal *"9 posts measured. Typical engagement rate: 5.0% (range 1.0%–9.0%)."*; **n = 10** -> `analytics.typicalIqr`, literal en, pt and es sentences (*"... (middle half of posts 3.0%–7.0%)"*); no IQR sentence in any locale contains the word range/intervalo/rango; the methodology sentence is asserted per locale. The expected figures are hand-computed from the input, not recomputed by the code under test. | `view-model.test.ts`: **n = 4** -> `thinValues`, `rows` empty, the serialised view has no `"wins"`, `"share"` or `"of"`; **n = 5** -> a row with `params: { wins: 3, n: 5 }`; both sides of the floor in one breakdown. `analytics-surfaces.test.tsx`: the rendered page reads *"Anchor thesis: Fewer than 5 posts"* for 4 posts and *"Posts with Follow-up: 3 of 5 beat your usual."* for 5, and contains no *"1 of 4"*. All new keys are inside the copy lint's corpus (a) and the parity test's emitted-key list. |
| **Reddening** | `winsView` put back on the shared thin key: 2 RED (the wins-thin test and B's). | `rangeKind` dropped (one template for every n): 2 RED (the n = 10 literal and the no-"range" test). | The breakdown floored at 1 instead of the display floor: 4 RED (n = 4, both-sides, and the two rendered-page tests). Each restored with `cp`; `cmp` identical. |
| **Commit** | D7 | D7 | D7 |

**Copy assertions changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `view-model.test.ts` "below 5 it is THIN and shows no k of n" | `toMatchObject({ state: 'thin', key: 'analytics.state.thin', params: { n: 4 } })` | `key: 'analytics.state.thinWins'` (the "no wins" assertion is unchanged) |
| `view-model.test.ts` `breakdownView` "rows carry wins, n and a provisional flag" | one value `wins: 2, of: 2` expected as a row `params: { wins: 2, n: 2 }, share: 1` | the value is `wins: 3, of: 6` -> `params: { wins: 3, n: 6 }, share: 0.5`, and the expected object gains `thinValues: []` (a 2-post value is now thin, so the old input could not stay a row) |
| `analytics-surfaces.test.tsx` "below 10 per side the values are COUNTS" | `expect(t).toContain('Posts with Founder perspective: 0 of 1 beat your usual.')` and `expect(t).toContain('Provisional')` | `toContain('Founder perspective: Fewer than 5 posts')`, `not.toContain('0 of 1')`, `not.toContain('Provisional')` (the fixture's only value has 1 post) |
| `analytics-surfaces.test.tsx` hook-type rows object | no `thinValues` | `thinValues: []` (type shape) |
| `analytics-surfaces.test.tsx` accounts fixture | `wins: { state: 'thin', key: 'analytics.state.thin', params: { n: 4 } }` | `key: 'analytics.state.thinWins'` |
| `analytics-parity.test.ts` EMITTED | `'typical', 'wins', 'state.thin', ...` | adds `'typicalIqr'`, `'state.thinWins'`, `'breakdown.thinValue'` |

The Reviewer's own proof of MAJOR-8, quoted from the finding, was B's pt page saying *"2 de 2 publicações medidas"* and *"1 publicações medidas até agora"* for one set; the wins slot now says *"Publicações com um habitual para comparar: 1."* and never the word *medidas*.

**Two lint findings the new copy raised, fixed in the copy.** (1) The first pt methodology wording used *"o intervalo vai do mais baixo ..."*; *"vai"* is the lint's pt prediction word, so the sentence was reworded to *"o intervalo é do valor mais baixo ao mais alto"*. (2) The wins thin text avoids an ICU plural in pt and es, because pt's plural rule counts 0 as "one" and the test translator does not parse the `=0` form the rest of the pt file uses.

**Shared-function callers (D7).** `typicalView`: `platformMonthView`, `monthPairView`, the account comparison and the report (`typicalLines` stores `view.key`, so the email and the stored summary carry `typicalIqr` from 10): `view-model.test.ts`, `analytics-surfaces.test.tsx`, `assemble.test.ts` and `report-body.test.tsx` (all green, unchanged). `winsView`: `platformMonthView`, the account comparison. `breakdownView`: `platformMonthView` -> `BreakdownBlock` on the page and in `ReportBody`; `WinShareBars` (`charts.tsx`) reads `rows` only and `presentation: 'bars'` requires every value at the compare floor (10), so it never meets a thin value. The stored report payload's `observed` breakdowns gain `thinValues` inside `REPORT_SCHEMA_VERSION = 2` (unreleased, as in D2 and D3).

**What I did NOT touch (D7):** the floors themselves, the Wilson interval, the month pair, `analytics.state.thin` for the typical line, no migration.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors, 113 warnings (unchanged); `npm run test:app` with `app-tests.yml`'s env block: 427 files, 6708 tests passed; `npm run test:db` against the LOCAL stack: **1387 passed, 0 failed**. The `plan-proposals-current-version-read` EXPLAIN test that failed in D1 to D6 passed on this run (122 of 122 files). I did not change anything it reads, so I treat it as environment-dependent (it is the Reviewer §0 / V.18 item), not as fixed.

### D8 — MAJOR-7, MINOR-1, MINOR-3, MINOR-4

No ruling is needed (section 4 engineering ledger).

| Field | MAJOR-7 | MINOR-1 | MINOR-3 | MINOR-4 |
|---|---|---|---|---|
| **Finding** | MAJOR-7 | MINOR-1 | MINOR-3 | MINOR-4 |
| **Fix** | `lib/reports/assemble.ts`: the summary is the activity line, then each rate platform under its own name: a `heading` line whose key is the existing platform-name key, then its typical line, its win line, and the win line's `disclosureKeys` as lines (the usual definition, the drift sentence, and the import note when the baseline was seeded). A platform with nothing to show adds no heading. `SummaryLine` gains `heading?: boolean`. `deliver.ts` prints a heading with a colon and `REPORT_EMAIL_MAX_LINES` rises from 8 to 16 (the template schema's `.max(8)` to `.max(16)`), because a cap of 8 would have truncated the disclosures that now travel with each count. `ReportBody` renders a heading line bold. | `ReportBody` passes the new key `analytics.report.section.trend6` to `TrendSection` (new optional `titleKey`, default unchanged for the live page), to the "not in this report" fallback and to the gated Pro line, so no 12-month heading appears anywhere in a report. en "6-month trend", pt "Tendência de 6 meses", es "Tendencia de 6 meses". | `RetroView` gains `interval` (`analytics.interval`, whole-percent `lo`/`hi`) when `interval_low` and `interval_high` are both non-null; an inconclusive retrospective has none. `RetroCell` and `CampaignsSection` take an opt-in `showInterval`, which only `ReportBody` sets: the live page's table is unchanged, as the ledger says ("page table unchanged unless it already shows one"). | New `listCitedPostsByIds(client, businessId, ids)` in `lib/db/posts.ts` (`id, business_id, platform, published_at, campaign_id`, business-bound, soft-deleted excluded, chunked by 20). `resolveReportLabels` reads the report's cited post ids with the other labels (`ReportLabels.posts`), so the page and the PDF route resolve them before Chromium. `ReportBody` renders, beside each rated post, "{platform}, {date}" as a link to the analytics posts view of that post's campaign (`?month=&platform=&campaign=`), plain text in the PDF, or `analytics.report.post.removed` ("Post removed" / "Publicação removida" / "Publicación eliminada") when the post is gone. Stored values are untouched. |
| **Proof** | `assemble.test.ts`: the key sequence for A's March is exactly `activity.total, platform.twitter, typical, wins, disclosure.usual, disclosure.usualUpdates, disclosure.importSeed`, with the heading flagged; every `analytics.wins` line is immediately followed by the usual definition and the drift sentence. `report-d8.test.tsx`: the delivered email lines (through the real `deliverMonthlyReport` and the real message files) are, in en, pt and es, `"{Platform}:"`, then the lines, then the three disclosure sentences verbatim from the locale file, 7 lines; the rendered email body orders heading, win count, definition and drift sentence; 14 lines are all kept; the report page shows the same order. | `report-d8.test.tsx`: in en, pt and es the report contains the 6-month heading and not the 12-month one; the gated heading on a plan without Pro too; the three literals asserted. | `report-d8.test.tsx`: the report contains "likely between 40% and 85% of posts" after the "8 of 12" share; the same rows rendered without the opt-in contain no interval. `load.test.ts`: the supported retrospective's `retro` carries `interval: { key: 'analytics.interval', params: { lo: '40%', hi: '85%' } }` and the inconclusive one `interval: null`. | `labels.test.ts`: the resolver reads the cited ids by (business, ids) with the caller's client; a foreign business's post and a removed post are absent; ids are listed once each. `report-d8.test.tsx`: a resolved report has a link per cited post to its campaign's posts view and no "Post removed"; with no resolved posts the page says "Post removed" three times in en, pt and es and keeps the stored rate; the PDF HTML (plain) says it three times for a gone post and has no link for a resolved one. The PDF route and the report page tests record the new `labels:posts` read before the launch. Tier-1 `analytics-reads.test.ts`: A's posts come back with exactly five columns and B's ids asked under A return nothing. |
| **Reddening** | The disclosure keys dropped from the summary and the email: 7 RED (the key sequence, the win-line test, en/pt/es delivery, the rendered email, the cap). | `analytics.section.trend` reused: 4 RED (en, pt, es, gated). | The interval dropped: 2 RED (the report test and `load.test.ts`). | The resolver skipped for posts: 2 RED (the resolver test and the PDF route's order test). Each restored with `cp`; `cmp` identical. |
| **Commit** | D8 | D8 | D8 | D8 |

**Assertions changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `assemble.test.ts` | `expect(s.map((l) => l.key)).toEqual(['analytics.activity.total', 'analytics.typical', 'analytics.wins'])` | the seven-key sequence above |
| `load.test.ts` (campaign table) | `expect(completed.retro).toEqual({ verdict: ..., beat: ... })` and `expect(active.retro).toEqual({ verdict: { key: 'outcome.retrospective.inconclusive', params: { n: 3 } }, beat: null })` | both gain `interval` (`{ key: 'analytics.interval', params: { lo: '40%', hi: '85%' } }` and `null`) |
| `labels.test.ts` | `labelIdsOf` `toEqual({ campaignIds, accountIds })`; `resolveReportLabels` `toEqual({ campaigns, accounts })` | both gain `postIds: []` / `posts: {}` |
| `monthly-report.test.tsx` | `['more than eight summary lines', { summaryLines: Array.from({ length: 9 }, ...) }]` | `more than sixteen summary lines`, 17 lines |
| `pdf/route.test.ts` | `expect(order).toEqual([..., 'labels:campaigns', 'labels:accounts', 'launch', 'setContent'])` | `'labels:posts'` inserted before `'launch'` |
| `reports-pages.test.tsx` | `expect(body.props.labels).toEqual({ campaigns: { c1: 'Name of c1' }, accounts: { acc1: 'user_acc1' } })` | gains `posts: {}` |
| Fixtures and fakes | `ReportLabels` without `posts`; `RetroView` without `interval`; `FIXTURE_LABELS_A` | `posts: {}` (A's real published posts in `FIXTURE_LABELS_A`), `interval: null` (type shape) |

**Decisions to flag (all inside what section 4 allows):**
1. **`REPORT_EMAIL_MAX_LINES` 8 to 16.** The ledger did not name the cap, but with a heading and three disclosure lines per platform a cap of 8 truncates the sentences MAJOR-7 exists to keep beside the count. One rate platform today gives 7 lines, so this changes nothing visible now.
2. **The per-post link goes to the analytics posts view filtered by the post's campaign**, not to the post itself: the product has no per-post analytics page, and `?campaign=` is an existing filter (`parsePostFilters`). The ledger says "a link"; this is the narrowest true one.
3. **`ReportLabels.posts` is required**, not optional, so a caller that forgets to resolve it fails to compile (the report page and the PDF route both go through `resolveReportLabels` and need no change).
4. **The stored payload shape changes inside `REPORT_SCHEMA_VERSION = 2`** (`summary[].heading`, `campaigns[].retro.interval`), unreleased, as in D2 to D7.

**Shared-function callers (D8).** `SummaryLine` and `payload.summary`: `ReportBody` (`report-body.test.tsx`, `report-d8.test.tsx`), `deliverMonthlyReport` (`deliver.test.ts`, `report-d8.test.tsx`), the lint (c) and (d) rendered checks, `assemble.test.ts`. `retroView`: the campaign table and the Pro retrospectives list (`load.test.ts`). `RetroCell`/`CampaignsSection`: the live page (unchanged output), `ReportBody`. `TrendSection`: the live page (default title) and `ReportBody`. `resolveReportLabels`: the report page and the PDF route (`reports-pages.test.tsx`, `route.test.ts`, `labels.test.ts`).

**What I did NOT touch (D8):** the fixed 11-section order, the stub month, the live page's own trend and campaign table, the email template body beyond the schema cap, no migration.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors, 113 warnings (unchanged); `npm run test:app` with `app-tests.yml`'s env block: 428 files, 6729 tests passed; `npm run test:db` against the LOCAL stack: 122 files, 1388 tests, 0 failed.

### D9 — MINOR-2, MINOR-5, MINOR-9, NIT-4 (ruling A-15), NIT-5

**A-15 consumed:** *(a) Yes: every §8.2 literal with a count becomes `{n, plural, one {…} other {…}}`, the `other` branch byte-identical to today's ADR literal*, ruled by the founder 2026-10-05 ("Assume the recommendations"). `S37-STATE-LITERALS` in `docs/backlog.md` carries the appended "Closed by 37-D D9" pointer.

| Field | MINOR-2 | MINOR-5 | MINOR-9 | NIT-4 | NIT-5 |
|---|---|---|---|---|---|
| **Finding** | MINOR-2 | MINOR-5 | MINOR-9 | NIT-4 | NIT-5 |
| **Fix** | `analytics.coverage` becomes two keys, chosen by the breakdown's population in `breakdownView`: `coverage.generated` (AI-written dimensions: keeps "Posts written outside Jemip's generator aren't classified") and `coverage.all` (length and CTA: "Covers {k} of {n} measured posts."). en, pt, es. | `report.methodology.floors` gains the ADR 8.1 sentence: en verbatim *"Jemip only learns a pattern from at least 10 posts across 3 campaigns; numbers shown here are descriptions, not lessons."*; pt *"O Jemip só aprende um padrão a partir de, pelo menos, 10 publicações em 3 campanhas; os números mostrados aqui são descrições, não lições."*; es *"Jemip solo aprende un patrón a partir de al menos 10 publicaciones en 3 campañas; los números que se muestran aquí son descripciones, no lecciones."* | pt analytics and email use **"interação"** (the term the 8.2 literals and disclosures already used), with the gender agreement the change needs ("a sua interação habitual", "da sua interação habitual", "taxa de interação", "dados de interação", "Mede a interação"); es email *"Mide la interacción"* instead of *"Mide el engagement"*. | `analytics.state.immature` and `analytics.state.thin` carry ICU plurals in all three locales; pt spells out `=0` (CLDR counts 0 as "one" in pt, which would print "0 publicação"). The en `other` branch is the ADR literal. `lib/i18n/__test-utils__/translator.ts` (test-only) learns the optional `=0` branch. | `patternEvidence` was removed in D6 (the evidence is inside the pattern sentence, with its own campaigns plural), so that nit no longer exists. pt and es `report.stub` name the noun once: *"Não foi feita nenhuma publicação em {month}…"*, *"No se hizo ninguna publicación en {month}…"*. `docs/product-status.md`: "LinkedIn as counts" now reads "LinkedIn shown as post counts (publishing activity, not engagement)". |
| **Proof** | `analytics-surfaces.test.tsx`: every breakdown block is tagged and covered; AI-only blocks keep the "aren't classified" sentence, the length and CTA blocks show "Covers k of n measured posts." and do NOT contain "aren't classified". `view-model.test.ts`: `length_band` and `cta_present` carry `coverage.all`, `role` carries `coverage.generated`. `copy-hygiene.test.ts`: `coverage.all` mentions no generator or Jemip in any locale. | `copy-hygiene.test.ts`: the en sentence is asserted verbatim; in each locale `floors` contains 10, 3 and the description-not-lesson clause. | `copy-hygiene.test.ts`: no leaf of pt analytics or pt email matches `/envolvimento/i`; no leaf of es analytics or es email matches `/engagement/i`. The copy lint (a) and (c), unchanged, stay green over every new string. | `copy-hygiene.test.ts` through next-intl's real formatter: en n = 4 and 0 render the ADR literal exactly, n = 1 reads "1 measured post so far" and "Final for 1 post"; pt n = 1 "1 publicação medida", n = 0 "0 publicações medidas", n = 3 "3 publicações"; es n = 1 "1 publicación medida", n = 2 "2 publicaciones". `analytics-parity.test.ts` pins the new en raw strings. | `copy-hygiene.test.ts`: the pt and es stub sentences are asserted verbatim and contain the noun once. |
| **Reddening** | The old single coverage key on every population: 2 RED (the report breakdowns test, the rendered "Covers k of n" test). | (covered by the content test; not separately mutated) | "envolvimento" put back in one pt key (`ratedPosts.row`): 1 RED (the pt parity assertion). | The plural dropped from `thin`: 3 RED (the n = 1 test, the pinned raw string, the rendered THIN state). Each restored with `cp`; `cmp` identical. | n/a |
| **Commit** | D9 | D9 | D9 | D9 | D9 |

**Assertions changed, each quoted with its old text:**

| Where | Old | New |
|---|---|---|
| `analytics-surfaces.test.tsx` THIN state | `toContain('1 measured posts so far. A typical rate appears from 5.')` | `toContain('1 measured post so far. A typical rate appears from 5.')` |
| `analytics-surfaces.test.tsx` coverage | `toMatch(/Covers \d+ of \d+ measured posts\. Posts written outside Jemip's generator aren't classified\./)` for EVERY block | the same for AI-only blocks; `toMatch(/Covers \d+ of \d+ measured posts\./)` and `not.toContain("aren't classified")` for the others |
| `view-model.test.ts`, `load.test.ts`, the hook-type rows object | `coverage: { key: 'analytics.coverage', ... }` | `'analytics.coverage.generated'` (and `'analytics.coverage.all'` asserted for `length_band` and `cta_present`) |
| `analytics-parity.test.ts` EMITTED | `'coverage'` | `'coverage.generated', 'coverage.all'` |
| `analytics-parity.test.ts` the eight 8.2 literals | `E['state.immature']` = `'... Final for {count} posts on {date}.'`; `E['state.thin']` = `'{n} measured posts so far. A typical rate appears from 5.'` | the plural forms (`{count, plural, one {# post} other {# posts}}`, `{n, plural, one {# measured post} other {# measured posts}} so far.`); the rendered `other` branch is asserted byte for byte in `copy-hygiene.test.ts` |

**Scope decisions, argued:**
1. **"envolvimento" is left in `outcome.json` and `common.json`.** MINOR-9 names analytics, the report and the email; the campaign page and the older surfaces use the outcome namespace (ADR 0026). The D6 pattern templates, which I wrote in `analytics.json` and which had copied "envolvimento" from there, now say "interação", so a Portuguese reader meets two terms only across the two surfaces (the live campaign page and the analytics pages). I recorded that rather than rewriting ADR 0026's copy in this pass.
2. **The es "engagement" in `marketing.json`** ("Engagement inbox") is a product feature name in the marketing namespace and is untouched.
3. **NIT-5's `patternEvidence` is closed by D6, not D9**: the key was removed there, so there is nothing left to pluralise.

**Shared-function callers (D9).** `breakdownView`: `platformMonthView` (page and report) -> `BreakdownBlock` -> `view.coverage.key` (rendered generically, so the new keys need no component change). `analytics.state.thin` and `.immature`: `view-model.ts` (`typicalView`, the platform state), the live page and the report. The test translator's new `=0` branch is used by every rendered-copy test (`report-d8`, `patterns`, the lint's rendered checks).

**What I did NOT touch (D9):** the floors' values, the Wilson interval, `outcome.json`/`common.json`, no migration.

**Loop at this step.** `npm run typecheck` clean; `npm run lint` 0 errors, 113 warnings (unchanged); `npm run test:app` with `app-tests.yml`'s env block: 429 files, 6742 tests passed; `npm run test:db` against the LOCAL stack: 122 files, 1388 tests, 0 failed.
