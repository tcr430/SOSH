# ADR 0031 — Analytics and the monthly report: the Accountability surface

- **Status:** Accepted. It becomes Accepted when the founder rules A-3…A-7 (§0.1); until then O2 does not start.
- **Date:** 2026-10-04 (revised the same day after an Architect-side consistency review; changes listed in §16)
- **Track:** O (Session 37). Architect agent O1. This document is design only: **no `.ts`, `.sql`, `.tsx`, email
  template or prompt template was produced by this session.** The shapes below are the contract the Builder (O2)
  implements.
- **Binding input:** `docs/build-guide/session-37.md`. That means:
  - the Reality block (13 items);
  - §0 (Locked L-1…L-9, with **L-6′** revising L-6, and the D-1…D-7 ledger with **D-5′**);
  - §0.1 (Q1…Q8);
  - §0.2: founder rulings **A-1 (confirmed)** and **A-2 (revised to L-6′)**, 2026-10-04; and **A-3…A-7, which this
    ADR raises and which are awaiting the founder** (§0.1 below).
- **Supersedes nothing.** It amends ADR 0026 (§14), ADR 0010 Amendment 2 §D2.5 (one row) and ADR 0014's email-kind
  list (one kind).

**Prerequisites, verified before any other work:**

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| 1 | Session 36 / ADR 0030 **CLOSED and MERGED** | ✅ | `git log origin/master`: `87161b2a Merge pull request #16` and `2df055a6 Merge pull request #18`, both ancestors of `origin/master` |
| 2 | A-1 (⚑ L-5/D-4) and A-2 (⚑ L-6/D-5) ruled in §0.2 | ✅ after the founder ruled mid-session | A-1 was **confirmed**. A-2 was **revised**: a charting library **and** a server PDF renderer are permitted (L-6′/D-5′). Both are recorded in `session-37.md` §0.2 with the originals left visible |
| 3 | *(soft)* No production OAuth app is registered, so **no real tenant has a single metric** | ⚠ **open** | `docs/current-phase.md`; §1.3 |
| 4 | *(soft)* `S34-E2E-UNVERIFIED` / `S36-UX-UNVERIFIED-IN-BROWSER` | ⚠ **open** | `docs/backlog.md`; §1.3 |

**Grounding.** One `ecc:code-explorer` sweep ran over the §1a closed file list. Then **exactly three** advisory
reviewers ran, dispatched once in a single parallel batch. All three were read-only and none was re-consulted:

| Agent | Scope | Cited below as |
|---|---|---|
| `ecc:database-reviewer` | Q1(f), Q4(b), Q7, the table/RLS/cascade obligations | `[db-N]` |
| `ecc:security-reviewer` | Q2, Q4(d), Q5, Q7 | `[sec-N]` |
| `ecc:mle-reviewer` | Q1(c)–(e), Q6 | `[mle-N]` |

Their dispositions are in §15.

**Skills and audits not used.**
- `impeccable` (the optional read-only audit), `mem-search`, `cost-aware-llm-pipeline` and `dataviz` were **not
  invoked**. The sweep and the binding docs were sufficient, and Q5 chose no model, so no cost modelling was needed.
- `taste-skill`, `ui-ux-pro-max` and `emil-design-eng` were not invoked, by rule. §10 specifies UX; the Builder
  designs it.

---

## §0 — The eight resolved questions (on the record)

| Q | Decision | Named loser | Tier |
|---|---|---|---|
| **Q1** metric model | Aggregates come only from **`post_outcomes`** (frozen at day 7); `post_metrics` supplies a single post's raw "so far" counts only. X headline = **median per-post rate, with n and range**. LinkedIn shows **activity + an unavailable state**, never a number. Period = **calendar month in `businesses.timezone`**. No new RPC; one new `posts` index | `post_metrics` as aggregate source; mean of rates; ratio of sums (deferred); a blended score; LinkedIn hidden or estimated | 2 (aggregation) + 1 (isolation) |
| **Q2** Plus/Pro split ⚑ | Gate = **`hasAdvancedAnalytics(plan: unknown)`** beside `getPlanCapabilities` (`lib/stripe/plan.ts`), fail-closed; Pro reads never executed for basic. **Recommendation** for basic/advanced lists and C-2 copy (§3), awaiting founder | a UI-only gate; fetch-then-hide | 2 |
| **Q3** IA | `/analytics` (portfolio, default), `/analytics/posts`, `/analytics/reports[/period]`, a PDF route; campaign level **links** to the shipped `/campaigns/[id]`; account slicing via existing `posts.social_account_id` | extending or replacing the campaign view; platform-only grouping | 2 (incl. scans) |
| **Q4** report | **Immutable snapshot** in `analytics_reports`, UNIQUE(business, month); hourly QStash `generate-reports`, due at local day 10 of M+1, previous month only; new EmailKind `monthly-report` to active admins; PDF renders the same component | a live page per month; emailing an empty month; a second PDF component tree | 1 + 2 |
| **Q5** narrative | **No model at launch.** Closed templates; REPORT-OUTPUT-ESCAPING across three sinks | an LLM narrative (fifth budget purpose, fidelity risk on a board document) | 2 (incl. scans) |
| **Q6** thin data | Show-a-number floor **n = 5**; compare floor **n = 10 per side**; four literal states; closed sentence templates; a regex copy lint in en/pt/es | one floor for both; free-text sentences | 2 |
| **Q7** tenancy & cost | Authenticated, `.eq('business_id')`-bounded, indexed, limited reads; worker reads via business-binding wrappers with abort-on-mismatch; recipients server-side; **whole-repo** northstar scan | trusting RLS alone (array trap); a skip-on-mismatch assembler | 1 + 2 (incl. scans) |
| **Q8** UX & tests | Specified in §10; this session **fixes** the inherited 320 px shell overflow and `nav.team`; no Tier E; real-browser checks are recorded manual QA, never counted as COVERED | deferring the shell fix while adding a table-heavy page | 1 + 2 + manual QA |

### §0.1 — Founder adjudications this ADR raises (A-3…A-7), **awaiting the founder**

These are O1's recommendations. **O2 does not start until each one is ruled in `session-37.md` §0.2.**

| # | Question | O1 recommendation | Where |
|---|---|---|---|
| **A-3** | The specific packages under L-6′ | `@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/group` (charts); `puppeteer-core` + `@sparticuz/chromium` (PDF), **subject to the O2 feasibility spike in §5.5** | §5.5 |
| **A-4** | The Plus/Pro analytics split and the **C-2 copy** (always flagged) | §3.1–§3.4 as written | §3 |
| **A-5** | A stored report's Pro sections after a downgrade | Render only while the **current** plan allows them | §3.3 |
| **A-6** | `businesses.report_email` (admins / all_members / off), a small admin write path; plus a **counsel question** on whether the email needs an unsubscribe link | Adopt the column; send the counsel question with the next counsel batch | §5.4 |
| **A-7** | Launch ordering: `generate-reports` is created **after** `extract-outcomes`; plus a Vercel Firewall rate rule on the PDF route | Three launch-checklist rows, ordered | §5.2, §5.5 |

"A-3…A-7" are this session's founder adjudications. The **SECURITY DEFINER audit gate** inherited from ADR 0030
(its launch item was also numbered A-8 there) is called **the DEFINER audit gate** in this ADR, to keep the two
numbering schemes apart.

Nothing in this ADR needs any of the following:
- a metrics history table or any collection change;
- a new platform read scope;
- a fifth `ai_budget_daily` purpose;
- a recipient who is not a business member;
- a change to ADR 0026's normalisation, baseline, floor or promotion;
- a new memory writer;
- a new table without a cascade row;
- an edit to the pricing page or to `CLAUDE.md`.

---

## §1 — Context and the decision, stated plainly

### 1.1 The structural facts

1. **`post_metrics` is latest-only and freezes near day 7.**
   - One row per post, UNIQUE(`post_id`), upserted in place (`20260430120011_post_metrics.sql:3-4, 13`).
   - Sync runs at day 1, 3 and 7 and stops at `METRICS_MAX_AGE_DAYS` = 9 (`20260919100000_metrics_sync_cadence.sql:4-16`).
   - **No post has a curve. A month is an aggregation of frozen per-post values grouped by `published_at`.**
2. **LinkedIn reads no metrics. Only X does.**
   - `PLATFORM_CONFIGS.linkedin.metricsReadAvailable = false` (`lib/social/platforms/config.ts:30`); `twitter` is `true` (`:38`).
   - The capability is exported as `metricsReadAvailableFor` (`lib/social/index.ts:32`).
   - **Plus is LinkedIn + X, so at launch half of Plus's platforms produce no engagement analytics.**
3. **X is a rate and LinkedIn is a count** (ADR 0026 §6.2).
   - `lib/outcomes/normalise.ts:45-57` never coerces NULL to 0, and rejects `impressions === 0` (`:57`).
4. **Session 33's frozen tables are the analysable source.**
   - `post_outcomes`: write-once, indexed `(business_id, platform, published_at DESC)` (`20260919110000_outcome_tables.sql:97`).
   - `post_dimensions`: AI posts only (`:14-17`).
   - `campaign_retrospectives`: indexed `(business_id, acknowledged_at DESC)` (`:127`).
   - All three have SELECT-only RLS in the InitPlan form, with writes REVOKEd (`:139-154`).
5. **Human-written posts carry no dimensions.**
   - There is no authorship column on `posts`; the only marker is a `post_ai_originals` row.
6. **A post's connected account is already recorded.**
   - `posts.social_account_id uuid NULL REFERENCES social_accounts ON DELETE SET NULL` (`20260904100000_posts_social_account_id.sql:21-23`).
   - `post_metrics`, `post_outcomes` and `post_dimensions` have no account column; they reach it through `post_id`.
7. **The plan seam already carries the analytics bit.**
   - `PlanCapabilities.advancedAnalytics` (`lib/stripe/plan.ts:18`): trial `false` (`:51`), plus `false` (`:62`), pro and agency `true` (`:38`).
   - `getPlanCapabilities(plan)` is a bare index (`:78-80`), so an unknown plan returns `undefined`.
8. **The period has a timezone source and a dependency already installed.**
   - `businesses.timezone text NOT NULL DEFAULT 'UTC'` (`20260430120003_businesses.sql:22`).
   - `businesses.language` is `en|pt|es`.
   - `date-fns-tz` 3.2.0 is in `package.json:47`.
   - `business_members` has **no** locale column (`lib/db/types.ts:1149-1162`).
9. **Email is an outbox.**
   - `EmailKind` has six values (`lib/email/types.ts:1-7`).
   - The kind CHECK `email_outbox_kind_check` was last rebuilt by drop-and-re-add (`20260709120000_email_outbox_team_invite_kind.sql:3-9`).
   - Dedupe is `UNIQUE (business_id, kind, coalesce(dedupe_token,''))` (`20260607100000_email_outbox.sql:27-28`).
   - The drain sends `row.recipient` / `row.locale` as stored at enqueue (`lib/email/orchestrator.ts:60, 69, 86`).
10. **The nav already carries a disabled `analytics` entry.**
    - `COMING_SOON_NAV` (`components/layout/DashboardShell.tsx:50-53`).
    - `nav.team` is missing from `i18n/en/common.json:6-20`, which is QA-MINOR-UI (1).
11. **The northstar is fenced only at the SQL level today.**
    - `get_learning_cycles_northstar` is SECURITY DEFINER and granted to `service_role` only (`20260919140000_outcome_rpcs.sql:404-451`).
    - Its TS wrapper `getLearningCyclesNorthstar` is exported (`lib/db/campaign-retrospectives.ts:114`), with one consumer, `scripts/northstar-report.ts:9,15`.
    - `lib/outcomes/__tests__/no-cross-business.test.ts:133-137, 216-220` pins the SQL function, not the TS importers (`[sec-7]`).

### 1.2 The decision, in one paragraph

Jemip shows founders **two kinds of accountability**:
- **Output:** what Jemip published for them, by month, platform, account and campaign. This exists on every platform today, because it comes from Jemip's own `posts` rows.
- **Outcome:** engagement, measured at day 7. This exists today **on X only**.

The design rules:
- Every outcome number comes from the frozen `post_outcomes` table and is computed per platform and per basis.
- Every number is shown with its n, and a number is shown at all only above a floor.
- No sentence implies causation, direction of travel or prediction.
- Comparisons are drawn only where both sides have enough posts, and never as a delta.

A monthly report freezes the month's numbers into an immutable snapshot on local day 10 of the following month, and
emails a summary to the business's admins. It carries no model-written prose. The surface writes nothing to the
measurement tables, makes no platform call and adds no memory writer.

### 1.3 What cannot be proven before real tenants

- No production OAuth app exists, so every number in this design is exercised on **seeded data only**.
- **Its empty state is the launch state (L-4).**
- The generation path and the last session's UI have not been exercised end to end by a real user in a real browser (`S34-E2E-UNVERIFIED`, `S36-UX-UNVERIFIED-IN-BROWSER`).
- §12.5 states what therefore stays unproven.

### 1.4 Decision ledger (build guide §0 D-1…D-7, as encoded)

| # | Encoded as | Section |
|---|---|---|
| D-1 frozen day-7 measurement | `post_outcomes` for every aggregate; `post_metrics` only for one post's "so far" counts | §2.1 |
| D-2 never across basis | per-platform computation; pooling forbidden by test (`ANALYTICS-BASIS-NEVER-MIXED`) | §2.3 |
| D-3 four states | empty / immature / unavailable / thin, literal copy in three locales | §8.2 |
| D-4 members only (A-1 ✅) | active admin members, resolved server-side | §5.4, §9.4 |
| D-5′ rendering (A-2 revised) | visx SVG in Server Components; Chromium renders the same component to PDF; packages pending A-3 | §5.5 |
| D-6 account slicing | `posts.social_account_id`, NULL as its own bucket | §4.4 |
| D-7 northstar | whole-repo executable fence | §9.6 |

---

## §2 — The metric model (Q1, L-2, L-3) — the load-bearing section

### 2.1 Source per number, and what a post shows by age

| Number | Source | Why |
|---|---|---|
| Any aggregate, comparison, badge, breakdown, trend | **`post_outcomes`** (write-once, day-7, basis-aware) | Compares posts at the same age (ADR 0026 §6.1) |
| One post's raw likes / comments / shares / impressions before maturity | `post_metrics`, labelled **"so far, as of {last_synced_at}"** | A fact about one post, never compared |
| Publishing activity (posts published, campaigns completed) | `posts` (status `published`, `deleted_at IS NULL`), `campaign_retrospectives` | Jemip's own artefacts; basis-free counts |

| Post age (in the business timezone) | Post row shows | Enters aggregates? |
|---|---|---|
| Day 0, no metrics row | "Measuring" | no |
| Day 2 (day-1 sync done) | raw counts "so far, as of {date}" + "Final on {published_at + 7d}" | **no**: counted as *not final yet* |
| Day 7+, outcome row present | final value; badge *above your usual* / *below your usual* / *no baseline yet* | yes |
| Day 9+, no outcome row | "Not measured", with the reason (no data returned / a field was missing / zero impressions; derived per §2.5) | **no**: counted as *excluded* |
| LinkedIn, any age | "LinkedIn doesn't share engagement data with Jemip." | no |

**Loser:** `post_metrics` as the aggregate source. It mixes post ages, which is exactly the bias ADR 0026 froze
outcomes to remove.

### 2.2 LinkedIn, stated plainly

`metricsReadAvailableFor('linkedin')` is `false`, so the surface shows **no LinkedIn engagement number, no zero, no
empty chart and no "coming soon"**. Every LinkedIn surface carries:
- the **unavailable** state (§8.2), read from the capability and never derived from a platform name
  (`ANALYTICS-UNAVAILABLE-FROM-CAPABILITY`);
- the **publishing-activity** half: posts published per month, per account and per campaign, and the campaigns that
  completed.

**What a LinkedIn-only Plus customer sees on launch day:**
- the **empty** state, until Jemip publishes for them;
- after that, activity counts, plus "LinkedIn doesn't share engagement data with Jemip, so we show your publishing activity there instead."

That is honest, it is not alarming, and it never implies that data is on its way.

**Losers:**
- hiding LinkedIn, which reads as a bug or a silent omission;
- estimating LinkedIn engagement, which is invented data;
- "Metrics coming soon", which makes a promise no one can date. The shipped campaign page says "…available for
  {platform} yet" (`outcome` namespace). This ADR **leaves that shipped copy alone** and does not reuse it; see §14.

### 2.3 Aggregation: period, basis, and the X number

**Period.** A post belongs to the **calendar month in `businesses.timezone`** that contains its `published_at`,
converted with `date-fns-tz`. Period boundaries are computed with date-fns, never with string slicing.

**Losers:**
- **the viewing member's timezone.** Two members would see different months, and an immutable snapshot cannot be per-viewer.
- **UTC.** A post at 00:30 Lisbon summer time on 1 April is 23:30 UTC on 31 March, so UTC files it in March,
  the wrong month. (The reverse holds west of UTC: 21:30 São Paulo time on 31 March is 00:30 UTC on 1 April.)

**Basis.**
- **No sum, mean, median or count of wins crosses `metric_basis`**, and in practice none crosses platforms.
- The only cross-platform totals are **activity counts**.
- "Wins of n" is computed and rendered **per platform**. Pooling it is forbidden by a Tier-2 test, not by convention (`[mle-3]`).
- ADR 0026 §6.3 makes `beat_baseline` comparable *as a win/loss*, but the baselines differ: a 90-day median against
  the last 20, with LinkedIn's growth bias. Re-decide when LinkedIn metrics land (§14).

**The X headline: the median of per-post engagement rates, labelled "typical post", always with n and the range
(min–max at n < 10, IQR at n ≥ 10).**
- It matches ADR 0026's median baseline.
- It is robust at small n.
- It answers the founder's real question: *what did a typical post do?*
- **Mean of rates loses**, because a handful of posts with tiny impression counts and extreme rates dominate it.
- **Ratio of sums** (Σengagements ÷ Σimpressions) **is deferred, not shipped**. It answers a different question
  (impression-weighted), and two "overall rates" that disagree read as an error in a board document (`[mle-2]`).
  It goes to the backlog as `S37-RATIO-OF-SUMS`.

**Month against month.**
- Two months are shown **side by side, each with its own n and range**, for example "2.4% (14 posts) · 1.9% (11 posts)".
- **No delta, no arrow, no colour, no percentage change.**
- The comparison is suppressed unless **both** months have n ≥ 5 (`[mle-1]`).
- No sentence states a direction.

**Rate formatting.**
- One decimal place, or two when the value is below 1%.
- A measured **0%** (impressions > 0, no engagement) is a real value and renders as `0.0%`.
- A **NULL** is never rendered as a number (`[mle-10]`).

### 2.4 Baseline and lift: what may honestly be claimed

| Field | On a customer surface | Why |
|---|---|---|
| `beat_baseline` | **Yes**: a per-post badge, and "{wins} of {n} posts beat your usual engagement" **for the selected period only** | Win/loss is robust at small n (ADR 0026 §6.3) |
| `log_lift` | **Never** | Any rendering is a multiplier, which ADR 0026 §10.3 prohibits. ADR 0026 calls it descriptive only |
| `baseline_source='import_seed'` | Disclosed: "Compared against the history you imported." Counted in methodology | ADR 0026 §9 |

- **"Usual" is defined next to every win count:** "Usual = your median over the previous 90 days on X, or the history
  you imported."
- **Every win count also carries this sentence:** "'Usual' updates as you post, so this is not a measure of overall progress."
- **Win share is never charted as a trend and never compared month to month** (`[mle-5]`). If quality improves
  steadily, the win share sits near 50% by construction.
- **The trend is carried by the median rate**, an absolute quantity.
- The n of a win count counts only rows where `beat_baseline IS NOT NULL`, and is shown separately from the median's n.

### 2.5 Exclusions, counted and shown

Excluded posts are not random. Posts with null fields or zero impressions are likely to be the weaker ones, so the
median would be biased upward if they vanished silently (`[mle-7]`).

Every outcome block therefore shows:

> "{measured} of {published} posts measured. {k} not included: no data returned ({a}), a field was missing ({b}),
> zero impressions ({c}), not final yet ({d})."

A zero count is omitted from the sentence. The reasons are a closed typed union, derived read-only:
- *not final yet*: the post is younger than maturity plus grace (day 9) and has no `post_outcomes` row;
- for a post past day 9 with no `post_outcomes` row, the reason is recovered by passing its `post_metrics` row
  through the **existing** `eligibleValue` (`lib/outcomes/normalise.ts`), the same function that decided not to
  write the outcome:
  - no `post_metrics` row → *no data returned*;
  - `{ ok: false, reason: 'null_field' }` → *a field was missing*;
  - `{ ok: false, reason: 'zero_impressions' }` → *zero impressions*;
  - `{ ok: true }` yet no outcome row → *no data returned* (the extractor has not written it; counted, never hidden).

`post_outcomes` stores no exclusion reason, so this is the only way to name one without a collection change. The
counts are persisted in the report payload. **No new collection is needed.** `eligibleValue` is called, not copied,
so the analytics surface cannot disagree with the extractor about why a post was excluded.

### 2.6 Coverage of dimension breakdowns (Pro)

| Dimension | Source | Population | Shown? |
|---|---|---|---|
| `role`, `format`, `origin_mode` | `post_dimensions` via `post_outcomes.ai_original_id` | **AI-written posts only** | yes |
| `length_band`, `cta_present` | `post_outcomes` (measured from the published artefact) | **all measured posts** | yes |
| `hook_type` | `post_dimensions`, only where `post_outcomes.hook_survived = true` | AI posts whose opening survived the edit | **live Pro page only**, n ≥ 10 per value, labelled "as classified by the AI when writing, not independently checked". **Not in the report** (`[mle-6]`) |
| `proof_type` | — | — | **Deferred**: confounded with campaign identity (`S33-PROOF-TYPE`) |
| `hook_survived` itself | — | — | not a breakdown; used only as the `hook_type` filter |

- **The metric per dimension value is win share:** "{wins} of {n} beat your usual", the Wilson interval at n ≥ 10
  (§8.1), counts only below. It is a per-period description and is **never trended** (§2.4). The median rate is not
  shown per value: win share is already relative to the brand's own baseline, so a breakdown never compares raw
  rates across posts with very different reach.
- Every breakdown's **title carries its population tag**, "AI-written posts only" or "All measured posts", and its
  coverage line: "Covers {k} of {n} measured posts. Posts written outside Jemip's generator aren't classified."
- This **closes ADR 0026 §VI.2's ownership** of `hook_type`'s descriptive display, and leaves `proof_type` deferred
  with a named trigger (§14).

### 2.7 No new SQL aggregate. Plain bounded selects, TypeScript aggregation

- Volume at 12 months × 2 platforms × 60 posts/month: **≤ 1,440 published posts per business per year (≤ 120 per
  month), of which only the X half (≤ 720) have outcome rows**, because LinkedIn reads no metrics.
- **Pro has no post cap, so 60/month is a sizing assumption, not a bound.** No aggregate may be computed over a
  silently truncated read (`ANALYTICS-NO-SILENT-TRUNCATION`):
  - every aggregate read pages with a keyset on its `ORDER BY` columns (`published_at DESC` plus the row key as a
    tie-breaker: `id` on `posts`, `post_id` on `post_outcomes`) at its page size (§9.1) until exhausted;
  - a hard ceiling of **5,000 rows per read** stops a runaway; hitting it renders that section's **error** state
    (and fails that business's report, which the next tick retries), never a number computed over part of the data;
  - a Tier-2 test pages a fixture across two pages and asserts the median equals the unpaged median, and asserts the
    ceiling produces the error state.
- Aggregation (medians, ranges, win counts, exclusions, coverage) lives in **pure functions under `lib/analytics/`**,
  testable with literal numbers in Tier 2.
- Reads go through new **authenticated** functions added to the existing per-table files: `lib/db/posts.ts`,
  `post-outcomes.ts`, `post-metrics.ts` and `campaign-retrospectives.ts`.
  - Today every business-wide outcome reader in `post-outcomes.ts` is service-role, and `listCampaignRetrospectives`
    is service-role (`lib/db/campaign-retrospectives.ts:90`).
- **All reads behind one view are bounded by the same `outcomes_through` instant**, so three separate selects cannot
  disagree with one another (`[db-1]`).
- **One new index** (`[db-1]`): `posts (business_id, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL`.
  - No current posts index covers `published_at` (`20260430120010_posts.sql:48-49`; the others are `(business_id, created_at DESC)` and the publishing-queue partial).
  - Every query that should use it repeats both predicates literally and orders `published_at DESC`.
- **Loser:** a SQL aggregate RPC. It would add a new SECURITY DEFINER audit surface, it is harder to test, and nothing
  about the volume justifies it.

---

## §3 — The Plus / Pro split (Q2) — **recommendation, awaiting founder ruling A-4 and A-5**

### 3.1 The gate

- **`hasAdvancedAnalytics(plan: unknown): boolean`**, added beside `getPlanCapabilities` in `lib/stripe/plan.ts`. It
  returns `true` only when the plan is a known key **and** its `advancedAnalytics` is `true`.
- An unknown plan, `null` or `'enterprise'` returns `false`; today `getPlanCapabilities` returns `undefined` for an
  unknown key (`[sec-4]`).
- **Server-side only.** The portfolio loader, the report generator and the PDF route each read the plan from the
  business row and call it.
- **Pro reads are never executed for a basic business.** Not fetched and then hidden: the payload handed to the page
  is cut down to the allowed tier on the server, and no client island ever receives a full snapshot payload.
- **A report's `tier` is set from the plan the worker reads**, never from a payload or any input.
- **The scattered `plan === 'trial' | 'plus' | 'pro'` checks are left as they are** (13 sites, inventoried by the
  sweep). Consolidating them is scope creep; that is recorded in §14.
- **Loser:** a UI-only gate, or one that fetches everything and hides the Pro sections.

### 3.2 Basic and advanced, as literal lists

**Basic analytics (Plus, and trial):**
1. **Post level.** Every published post with platform, account, campaign, state (§2.1), "so far" counts, the final
   value and its badge.
2. **Campaign level.** The shipped campaign learning view at `/campaigns/[id]`, unchanged.
3. **Portfolio, for the selected month and the month before it.**
   - Posts published, by platform × account.
   - Campaigns active and completed.
   - The X median engagement rate with n and range.
   - X wins of n.
   - Exclusions.
   - The LinkedIn unavailable state.
4. **The monthly report,** basic sections (§5.3).

**Advanced analytics (Pro, agency).** Everything in basic, plus:
1. **A 12-month trend on the live page** (the report carries 6 months, §5.3, so a forwarded document stays one
   readable page per section). Posts published per month, and the X median per month with its n, drawn as a strip of post
   dots. Months below the floor are gaps.
2. **Breakdowns** by `role`, `format`, `origin_mode`, `length_band` and `cta_present`, each with its population and
   coverage. The metric per value is **win share** ("k of n beat your usual"), never a rate (§2.6, §10.3).
   `hook_type` is on the live page only (§2.6).
3. **Observed outcome patterns across the brand,** via `lib/memory` (`listOutcomePatterns`), with n and campaigns.
4. **Retrospective verdicts across campaigns,** each linking to its campaign.
5. **Account against account,** within one platform and one basis.
6. **The report's Pro sections** (§5.3).

### 3.3 Trial, agency, unknown, downgrade

- **Trial:** basic. This matches the existing capability (`plan.ts:51`). The Pro sections show the honest gated
  state, which is a demonstration, not a dark pattern.
- **Agency:** advanced. It mirrors Pro, as `plan.ts` does.
- **Unknown plan:** basic (fail closed).
- **Downgrade ⚑ (A-5).** A stored report is immutable, and its payload keeps every section it was generated with.
  **O1 recommends rendering the Pro sections only while the current plan allows them.**
  - That keeps one gate everywhere and lets a re-upgrade restore them.
  - The email already sent cannot be recalled, and is not pretended otherwise.
  - The alternative, keeping them visible forever, is simpler and also defensible; it is the founder's call.

### 3.4 The honest claim, and the C-2 copy recommendation (A-4, to be adopted or revised by the founder)

**What the pricing copy may truthfully claim at launch:** both tiers have engagement analytics **on X only**. On
LinkedIn they have publishing activity.

Separately, and **not decided here**: Pro's "all platforms" is ahead of the product too. Only LinkedIn and X publish today.

| | Plus line | Pro line | Footnote |
|---|---|---|---|
| **en** | Basic analytics and a monthly report* | Advanced analytics: 12-month trends, results by format and post role, and a fuller monthly report* | *Engagement metrics are currently available for X. For LinkedIn we report your publishing activity; LinkedIn doesn't share engagement data with Jemip. |
| **pt** | Análises básicas e relatório mensal* | Análises avançadas: tendências de 12 meses, resultados por formato e papel da publicação, e um relatório mensal mais completo* | *As métricas de interação estão disponíveis para o X. No LinkedIn mostramos a sua atividade de publicação; o LinkedIn não partilha dados de interação com o Jemip. |
| **es** | Analítica básica e informe mensual* | Analítica avanzada: tendencias de 12 meses, resultados por formato y función de la publicación, y un informe mensual más completo* | *Las métricas de interacción están disponibles para X. En LinkedIn mostramos tu actividad de publicación; LinkedIn no comparte datos de interacción con Jemip. |

The footnote is undated on purpose ("doesn't", not "doesn't yet"), matching §2.2 and §8.2: nothing on the surface or
the pricing page implies LinkedIn data is on its way.

**O2 does not edit the pricing page or `CLAUDE.md`.** The founder applies C-2 (L-1).

---

## §4 — Information architecture (Q3)

### 4.1 Routes

| Route | Level | Notes |
|---|---|---|
| `/[locale]/analytics` | **portfolio (default landing)** | selected month in the business timezone; defaults to the current month, with the maturity note |
| `/[locale]/analytics/posts` | post | filters: month, platform, account, campaign. GET search params, Zod-validated; native `<select>` |
| `/[locale]/analytics/reports` | report list | newest first, bounded; also hosts the admin-only **report email** setting (A-6, §5.4), rendered read-only for non-admins |
| `/[locale]/analytics/reports/[period]` | one report | `[period]` Zod `^\d{4}-(0[1-9]|1[0-2])$`; printable |
| `GET /api/analytics/reports/[id]/pdf` | PDF | a route handler, because a file response cannot be a Server Action; `[id]` Zod uuid |

The business on every route is the **server-side active business**, never a URL param or search param. A report id
belonging to another of the user's businesses returns **404** (`[sec-1]`).

### 4.2 The campaign level links to the shipped view, and never duplicates it

- `loadCampaignLearningView` (`lib/outcomes/campaign-view.ts:137`, one caller at `campaigns/[id]/page.tsx:73`) stays
  **the single campaign learning surface**.
- The portfolio's campaign table shows only:
  - activity counts;
  - the retrospective **verdict and n**, read from `campaign_retrospectives` and worded with the **same i18n keys**
    as `RetrospectiveCard`.
- Each row **links** to `/campaigns/[id]`.
- Nothing on the new surface recomputes a campaign verdict or a campaign-scoped pattern
  (`ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE`).
- **Losers:**
  - **extending** the campaign page with plan-gated analytics, which would couple a reviewed page to the gate;
  - **replacing** it, which would regress a reviewed surface.

### 4.3 The portfolio: grouping and default view

- **Reading order:**
  1. the month picker;
  2. **activity** (output);
  3. **X results** (or the platform's state);
  4. **campaigns**;
  5. the Pro sections: trend, breakdowns, patterns, retrospectives.
- **Grouping keys:** period, then platform, then account, then campaign. Pro adds dimensions (§2.6).
- **Outcome patterns** appear only in the Pro "Observed patterns" section, read via `lib/memory` and never from the
  table (`MEM-NO-DIRECT-TABLE-ACCESS`), each with n and campaigns (L-3).
- **Retrospective verdicts** appear outside their campaign only as a Pro list linking back to it.

### 4.4 Account slicing (L-7)

- `posts.social_account_id` exists today, so **no step is needed and T1-E is not pre-built**.
- Outcomes and metrics reach the account through their `post_id` → `posts` join. The label is
  `social_accounts.platform_display_name ?? platform_username`.
- **NULL is its own bucket:** "Account not recorded or since removed". `social_account_id` is NULL both for posts
  that never recorded an account and for posts whose account row was deleted (`ON DELETE SET NULL`), and the two
  cannot be told apart, so the label covers both. A disconnected account (`is_active = false`) keeps its row and its
  label. It is **never** resolved to the platform's default account the
  way the metrics worker does (`lib/metrics/orchestrator.ts:67`). Defaulting would misattribute posts once Session 38
  gives a business two LinkedIn accounts.
- **Loser:** platform-only grouping.

### 4.5 Navigation

- Promote the existing `analytics` entry (BarChart2) from `COMING_SOON_NAV` into `ACTIVE_NAV`, directly after
  `campaigns`, for every plan.
- `inbox` stays "coming soon".
- **This session also adds the missing `nav.team` key** in en/pt/es (QA-MINOR-UI (1)), since it edits the same arrays.

---

## §5 — The monthly report (Q4)

### 5.1 An immutable snapshot (`REPORT-SNAPSHOT-IMMUTABLE`)

New business-scoped table **`analytics_reports`** (`[db-2]`):

| Column | Shape |
|---|---|
| `id` | uuid PK |
| `business_id` | uuid NOT NULL REFERENCES businesses ON DELETE CASCADE |
| `period_month` | date NOT NULL, CHECK it is the first of its month |
| `tier` | text NOT NULL CHECK IN ('basic','advanced') |
| `schema_version` | int NOT NULL |
| `payload` | jsonb NOT NULL: aggregates, template keys and their params, exclusion counts, cited `post_id`s; **no post text** |
| `outcomes_through` | timestamptz NOT NULL: the instant every read was bounded by |
| `generated_at` | timestamptz NOT NULL |

- **UNIQUE (business_id, period_month)** is the idempotency point, and doubles as the index the due check uses.
- **Write-once:** a BEFORE UPDATE trigger that **reuses the existing `public.reject_outcome_table_update()`**
  (`20260919110000_outcome_tables.sql:158-166`; it raises with `TG_TABLE_NAME`, so it is table-agnostic). No new
  trigger function is created, which is what keeps §11's "no new function" true. There is no BEFORE DELETE, so
  cascade and purge work.
- **Cited posts are not copied.** Their values are re-read from the write-once `post_outcomes`, so they are stable. A
  deleted or erased post renders "Post removed".
- **Loser: a live page per month.** The March report a founder forwarded would say something different in June after
  late outcomes and deletions. A board cannot reconcile that.

### 5.2 When it is generated (`REPORT-ONE-PER-PERIOD`)

- **Trigger:** a QStash schedule **`generate-reports`, hourly at `20 * * * *`**, calling `app/api/cron/generate-reports`.
  - It uses the same dual QStash/secret auth as the other cron routes.
  - It is wrapped in a Sentry monitor.
  - It emits one canonical structured log line.
- **Due rule:** a business is due when **both** hold, and it has no report for M:
  1. its local date (`businesses.timezone`) is **on or after day 10 of month M+1**; and
  2. `now()` is **at or after 06:00 UTC on day 10 of M+1** (the UTC pre-filter, below).
  - Day 10 works because the last day's posts mature at day 7 and get 2 days' grace (day 9), and `extract-outcomes`
    runs daily at 04:00 UTC.
  - Condition 2 matters for timezones ahead of UTC. In `Pacific/Auckland`, local day 10 starts around 11:00 UTC on
    day 9, before the day-9 grace has run out for a post published late on local day 31. Requiring 06:00 UTC on day
    10 guarantees that the 04:00 UTC `extract-outcomes` run of day 10 has finished for every timezone. West of UTC,
    condition 1 is the later of the two and governs.
  - **Only M−1 is ever generated.** Older gaps are never back-filled, and there is no report for months before
    Session 37 ships (`[db-2]`).
  - **Consequence, stated:** if the worker is down from day 10 to the end of M+1, month M is never generated and the
    list has a gap. The Sentry monitor on `generate-reports` is what catches this; a gap is an operational incident,
    not a designed state. §5.6's "no gaps" holds only while the schedule runs.
- **Bounded per tick:** ≤ 25 businesses. Candidates are paged by `id` with a cursor (`listBusinessIdsPage`, `ORDER BY id`).
  - The UTC pre-filter (condition 2) gates the whole tick, then the timezone check (condition 1) runs in TypeScript,
    then an anti-join probe on the unique key.
  - Re-reading not-yet-due businesses each hour is accepted at launch scale and is stated here (`[db-2]`).
- **Who is eligible (ruled in the 2026-10-04 ADR review: active plans only):**
  - a business **on a live trial or a live paid subscription**, whatever it published in M;
  - the plan decides the tier through `hasAdvancedAnalytics`; an **unknown plan on a live business gets a basic
    report** (fail closed, §3.3), never no report;
  - a **cancelled or lapsed** business gets no report;
  - a live business that published nothing in M gets the **stub** (§5.6), with no email.
  - The Builder uses the liveness signal the billing code already relies on (the `businesses` subscription columns
    and `trial_state`). If no single predicate exists, the Builder writes it once in `lib/db/businesses.ts`, tests it
    for trial-live, trial-expired, paid-active and cancelled, and reports that it had to.
- **Idempotency.** `INSERT … ON CONFLICT (business_id, period_month) DO NOTHING`, as a **direct service-role insert**
  through `lib/db/analytics-reports.ts`, with the lazy-import pattern.
  - **No RPC, so no new SECURITY DEFINER function** (`[db-4]`).
  - The email is enqueued **only if the insert returned a row**, and the outbox dedupe token then carries idempotency
    a second time.
  - Two overlapping ticks are harmless: the loser's insert returns nothing.
- **Late outcomes.** A post measured after `outcomes_through` is not in that report, and the report says so: "Posts
  measured after {date} are not included."
- **Launch-checklist rows (A-7):** two rows in `docs/launch-checklist.md`'s QStash list.
  1. `extract-outcomes` created (existing row).
  2. **`generate-reports` (`20 * * * *`) created, together with its Sentry monitor, *after* row 1.**
  - Without row 1 no X outcome ever exists, and every report is activity-only.
  - A third row, not ordered against these two, covers the PDF route's firewall rule (§5.5).

### 5.3 Sections, in order

| # | Section | Contents | Tier |
|---|---|---|---|
| 1 | Header | business, month, "measured as of {outcomes_through}", generated date | both |
| 2 | Summary | closed template sentences (§8.4) from the payload | both |
| 3 | Publishing activity | posts by platform × account; campaigns active and completed | both |
| 4 | X results | median rate (typical post) with n and range; wins of n with "usual" defined; exclusions | both |
| 5 | Three X posts by engagement rate | the three measured X posts with the highest **day-7 rate** (`post_outcomes.value`, ties broken by `published_at DESC`), each with its rate, its above/below-usual badge and the caveat "A post seen by few people can have a high rate."; titled by the closed key, never "top" or "best". Drawn only when the month's X n ≥ 5 (§8.1). Ranking from `post_outcomes` keeps D-1: no number on this report comes from `post_metrics` (`[mle-8]`, disposition revised in §15) | both |
| 6 | LinkedIn | activity plus the unavailable state | both |
| 7 | Campaign results | retrospectives completed in the month: verdict, n, interval, link | both |
| 8 | Trend | 6 months (the live Pro page shows 12, §3.2): activity, plus X median per month with n; gaps below the floor | **Pro** |
| 9 | What we observed | breakdowns as win share (§2.6; no `hook_type`), population and coverage; floors per §8.1 | **Pro** |
| 10 | Observed patterns | via `lib/memory`, each with n and campaigns | **Pro** |
| 11 | How to read this | closed methodology keys, each tested for presence (`[mle-11]`): the median definition; 7-day maturity; exclusions and why; the "usual" definition and the drift sentence; display floor vs learning floor; X only; breakdowns are descriptive and overlapping; "This measures engagement, not signups or revenue." | both |

### 5.4 Delivery (`REPORT-MEMBERS-ONLY`)

- **In-app** at `/analytics/reports/[period]`, and listed at `/analytics/reports`.
- **Email:** a new `EmailKind` **`monthly-report`**, carrying a summary (header and summary sentences) and a link.
  **No attachment.**
  - Kind CHECK: drop and re-add `email_outbox_kind_check` with the **six existing kinds copied from
    `20260709120000_…:3-9`** plus `monthly-report`.
  - Template: a registry entry in `lib/email/templates/index.ts` (the `team-invite` precedent).
  - The `EmailKind` union is updated in both `lib/email/types.ts` and `lib/db/types.ts:79-85`.
- **Recipients:** active members (`status = 'active'`, `user_id IS NOT NULL`) of **this** business who are admins
  (`is_admin = true`, the owner included).
  - They are resolved server-side by a new service-role function in `lib/db/business-members.ts`. Today there is none:
    `listMembers` is authenticated and returns every status (`[sec-3]`).
  - The address comes from the member row and nowhere else: never from the payload, an action argument or a
    free-text column.
  - **Active status is re-checked immediately before enqueue.**
  - The drain's existing suppression check stays (`lib/email/orchestrator.ts`).
- **Dedupe token:** `report:{YYYY-MM}:{business_members.id}`. It uses the immutable member id, never the email, so
  no PII sits in the index (`[db-3]`). A member added after the run does not receive that month's report; that is
  the intended behaviour.
- **Opt-out (A-6 ⚑):** `businesses.report_email text NOT NULL DEFAULT 'admins' CHECK IN ('admins','all_members','off')`.
  - It is written by one Server Action that:
    - takes the business id from the active-business context;
    - re-checks admin status server-side;
    - validates a Zod enum;
    - does a conditional UPDATE keyed on the business id.
  - `'off'` stops **only the email**: never generation, never the in-app report.
  - `'all_members'` widens delivery to every active member (`[db-5]`, `[sec-3]`).
  - The Builder confirms that the `businesses` UPDATE policy has USING and WITH CHECK and decides whether a non-admin
    could write the column through PostgREST. If it could, a trigger restricts it.
  - **Counsel question (A-6):** does a monthly report need a per-recipient unsubscribe link? Flagged for the next
    counsel batch and the email launch checklist.
- **Locale:** `businesses.language` (`members` have no locale column).
- **Loser:** an arbitrary "send to my board" address (A-1, L-5).

### 5.5 Rendering: charts and PDF (L-6′, packages pending **A-3**)

- **Charts:** `@visx/scale`, `@visx/shape`, `@visx/axis` and `@visx/group`, rendered as plain SVG inside **Server
  Components**. No client JavaScript, and the output is identical on screen, in print and in the PDF.
  - **Loser: Recharts.** It is client-only (a `ResizeObserver` and a `'use client'` boundary on every chart) and does
    not render server-side.
- **PDF:** `puppeteer-core` + `@sparticuz/chromium` on the Node runtime.
  - The route renders **the same report body component** with the stored payload: `renderToStaticMarkup`, with the
    compiled Tailwind CSS and fonts inlined, then `page.setContent`, then `page.pdf`.
  - **One component and one source of truth.**
  - Generated on demand and **never stored**, so there is no storage object to purge.
  - **Loser: `@react-pdf/renderer`.** A second component tree is precisely the drift D-5 warned about, and fonts would
    have to be registered three times over.
- **Chromium hardening (`[sec-5]`, constraint `REPORT-PDF-ISOLATED`):**
  - `setJavaScriptEnabled(false)` before content;
  - request interception that **aborts every request** except the document;
  - a CSP meta of `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`;
  - `setContent` only: no `goto`, no `file://`, no cookies, no auth headers;
  - a fresh browser context per request, closed in `finally`;
  - a hard timeout and concurrency 1;
  - auth, the active-business binding and the plan check, all **before** Chromium launches.
- **Abuse bound (ruled in the 2026-10-04 ADR review: no new rate-limit primitive).** The repo has no general
  per-user limiter (the only ones are the AI runner's per-business cap and the login bucket), and none is built here.
  The bound is:
  - concurrency 1 per function instance and the hard timeout (above), so one request cannot hold Chromium open;
  - only an authenticated member of the report's business reaches the launch, so the cost lands on a known tenant;
  - a **Vercel Firewall rate rule** on `/api/analytics/reports/*/pdf`, added as a launch-checklist row (§5.2, A-7)
    and verified in the dashboard, not in CI.
  - **Accepted residual risk:** a signed-in member can still cause repeated renders inside the firewall's
    allowance. Recorded in `docs/backlog.md` as `S37-PDF-RATE-LIMIT`; un-defer if render cost or abuse is observed.
- **O2's first step is a feasibility spike, before any report UI is built.** Two things are unverified:
  1. rendering the report body to static HTML inside a Next 16 route handler. React's server renderer cannot await
     async Server Components, and next-intl's `getTranslations` is async;
  2. whether `@visx/axis` (through `@visx/text`) renders in a Server Component without client-only hooks.

  The design that removes both risks, and which the spike confirms or refutes: the report body is a **synchronous
  component** that takes the fully built view model **and** the resolved message strings as props. The page and the
  PDF route both resolve data and messages first, then render the same component. If (2) fails, axes are drawn with
  plain SVG `<text>` inside the same component and `@visx/axis` is dropped from A-3. If (1) fails in a way this
  design cannot avoid, O2 stops and reports to the founder; it does not fall back to `page.goto`, which §5.5 forbids.
- **Print:** a print stylesheet on the report page covers "Print" from the browser with the same component.

### 5.6 The empty month

- **Nothing published in M** (a live business, §5.2): a **stub report** is stored ("Nothing was published in
  {month}"), so the history has no gaps while the schedule runs, and **no email is sent**, so the product never
  mails a monthly nag.
- **A month with LinkedIn posts only is not empty.** It gets activity, the LinkedIn state and the email.
- **Losers:**
  - emailing the empty note: it is noise, and a deliverability risk;
  - storing nothing: gaps in the list look like a bug (L-4).

---

## §6 — The narrative (Q5): **no model at launch**

- **Decision.** The report carries **closed templated sentences only** (§8.4), rendered from the payload in en/pt/es.
- **What is lost:** synthesised, agency-style commentary.
- **Why that loss is acceptable at launch:**
  - one hallucinated figure in a document forwarded to a board is the worst failure this surface can have;
  - the data at launch is thin, so a model would mostly restate numbers;
  - a model would need a **fifth `ai_budget_daily` purpose**, which ADR 0029 A-4 already declined once and which is a
    founder call;
  - it would add an injection surface over post text, campaign names and hypotheses.
- **Constraints that do not apply.** No Claude call is made, so `CustomerContext` is not triggered, and
  `REPORT-NUMBERS-FIDELITY` and `REPORT-COST-CEILING` are **not applicable**. They are recorded for the follow-on.
  `REPORT-FALLBACK` is satisfied trivially: the templated report is the only path, so there is never a half-written report.
- **What is left to defend is output encoding (`REPORT-OUTPUT-ESCAPING`, `[sec-6]`).** Customer- and model-authored
  strings reach **three sinks**:
  1. **the page:** React escaping, no `dangerouslySetInnerHTML`;
  2. **the email:** the HTML and the **subject**, with CR/LF stripped from header-bound values such as a campaign name;
  3. **the PDF HTML.**
  - i18n interpolation never uses a raw-HTML mode.
  - A hostile-string test covers all three sinks.
- **Un-defer trigger (`S37-NARRATIVE`):** real tenants with ≥ 3 matured months. Then a follow-on ADR:
  - Haiku 4.5 through `lib/ai/` with a `CustomerContext`;
  - input is the payload only;
  - a deterministic figure-set check that fails closed;
  - the templated report as the fallback.

---

## §7 — Memory: read, never written

Analytics reads memory through `lib/memory` and **writes none** (L-1). `S36-WRITER-RESCHEDULE`'s trigger ("T1-B
shows a timing signal worth learning") is **not** satisfied by this ADR. No timing view is built.

---

## §8 — Honesty in thin data (Q6)

### 8.1 Floors

| Floor | n | Applies to | Below the floor |
|---|---|---|---|
| **Show a number** (`ANALYTICS-DISPLAY-FLOOR`) | **5** (= `OUTCOME_PROVISIONAL_N` = `OUTCOME_RETRO_MIN_N`, the number customers already meet on the campaign page) | a median, a range, a "k of n" | the **thin** state (§8.2), one key everywhere. No mark is drawn |
| **Compare two values** | **10 per side** | a breakdown bar, an account-vs-account row, a month-vs-month pair beyond side-by-side text | **counts only** ("4 of 5"), labelled *provisional*; no bar, no percentage |
| `hook_type` value | 10 | live Pro page only | hidden |

- **Intervals:** Wilson intervals appear only on Pro breakdowns at n ≥ 10, in plain language: "likely between 25% and
  80% of posts". **Never "95% confidence".**
- **Why 5 is not ADR 0026's floor.** Promotion (10 posts, 3 campaigns, Wilson) decides what Jemip **learns and uses
  in writing**. Display decides what is **described**. The methodology section says so: "Jemip only learns a pattern
  from at least 10 posts across 3 campaigns; numbers shown here are descriptions, not lessons." **ADR 0026 is unchanged.**
- **Gaps:** a month below the floor in a trend renders as a gap. Points are never joined across it, and nothing is
  interpolated (`[mle-12]`).

### 8.2 The four states, literally

| State | en | pt | es |
|---|---|---|---|
| **Empty** (nothing published) | Nothing published yet. Results appear here after Jemip publishes your first post. | Ainda não há publicações. Os resultados aparecem aqui depois de o Jemip publicar a sua primeira publicação. | Aún no hay publicaciones. Los resultados aparecerán aquí cuando Jemip publique tu primera publicación. |
| **Immature** (published, under 7 days) | Measuring. Engagement is final 7 days after a post goes out. Final for {count} posts on {date}. | A medir. A interação fica final 7 dias depois de cada publicação. Final para {count} publicações a {date}. | Midiendo. La interacción es definitiva 7 días después de publicar. Definitiva para {count} publicaciones el {date}. |
| **Unavailable** (capability false) | {platform} doesn't share engagement data with Jemip, so we show your publishing activity there instead. | O {platform} não partilha dados de interação com o Jemip, por isso mostramos a sua atividade de publicação. | {platform} no comparte datos de interacción con Jemip, así que mostramos tu actividad de publicación. |
| **Thin** (below the floor) | {n} measured posts so far. A typical rate appears from 5. | {n} publicações medidas até agora. A taxa típica aparece a partir de 5. | {n} publicaciones medidas hasta ahora. La tasa típica aparece a partir de 5. |

The thin copy names what appears at 5 (a typical rate), not "comparisons": comparisons need 10 per side (§8.1), and
below that they render as counts with their own *provisional* label.

Plus **loading** (a skeleton with an accessible "Loading results" label) and **error** ("We couldn't load your
results." with a link labelled "Reload"). The error copy carries no imperative, so it passes the §8.4 lint
unexempted. Every state is distinct, rendered and tested (`ANALYTICS-FOUR-STATES`).

### 8.3 Disclosures

- **LinkedIn count (dormant at launch, required and tested):** wherever a LinkedIn engagement count is ever shown,
  ADR 0026 §10.2's sentence appears **verbatim**: *"LinkedIn results compare engagement counts, which also rise as
  your audience grows."* (`ANALYTICS-LINKEDIN-DISCLOSED`).
- **Coverage:** the population tag and "Covers {k} of {n}" line (§2.6).
- **Seeded baseline:** "Compared against the history you imported."
- **Engagement only:** "This measures engagement, not signups or revenue." (ADR 0026 §10.3; no UTM or conversion data exists).

### 8.4 Sentence patterns (`ANALYTICS-NO-CAUSAL-COPY`), enforced by a Tier-2 lint

**Allowed: a closed set of templates.** Every user-visible analytics or report sentence is one of these, or a state
or methodology key:
- "{n} posts measured. Typical engagement rate: {r} (range {lo}–{hi})."
- "{wins} of {n} posts beat your usual engagement."
- Breakdown (win share, §2.6): "Posts with {value}: {wins} of {n} beat your usual. Posts with {other}: {wins2} of {n2}. This describes past posts, not the reason for their results."
- "{month}: {r} ({n} posts) · {month2}: {r2} ({n2} posts)."
- The thin state (§8.2).
- Activity: "{count} posts published on {platform} ({account})." and "{count} posts published, {prev} the month before."
- Report section 5's caveat: "A post seen by few people can have a high rate."

**Structural rules, enforced by the template schema as well as by regex:**
- every rate or percentage token sits next to its "({n} posts)";
- every comparison carries **both** n values;
- every breakdown carries its population tag.

**Forbidden classes**, matched case-insensitively over the analytics and report namespaces of all three locale files,
and over the rendered report output (`[mle-9]`):

| Class | en | pt | es |
|---|---|---|---|
| Causal | causes, drives, led to, results in, because, due to, thanks to, boost, improved, increased, lifted, impact, effect, works, proves, shows that | causa, provoca, gera, leva a, resulta em, porque, devido a, graças a, melhorou, impulsiona, funciona | causa, provoca, genera, lleva a, resulta en, porque, debido a, gracias a, mejoró, impulsa, funciona |
| Directive | should, try, use more, post more, we recommend, consider | deve, experimente, use mais, publique mais, recomendamos | debería, prueba, usa más, publica más, recomendamos |
| Superlative | best, top, winning, strongest, worst | melhor, top, mais forte, pior | mejor, top, más fuerte, peor |
| Prediction | will, expect, likely to, forecast, going to | vai, irá, esperamos, prevê | va a, esperamos, prevé |
| Multiplier | ADR 0026 §10.3's pattern, plus "times as" | §10.3 forms | §10.3 forms |
| Significance delta | significant, surge, jump, spike, drop, grew, fell, up/down N% | significativo, disparou, caiu, subiu N% | significativo, se disparó, cayó, subió N% |

- **Matching is whole-word** (Unicode-aware word boundaries, so "top" does not match "stop" and "vai" does not match
  "vaidade"), case-insensitive, and applied after interpolation placeholders are stripped.
- **Exemption:** "likely between" in the interval template only. It is tagged as an exempt key, so the exemption is
  explicit. No other key is exempt; every template above, every state and every methodology key passes unexempted,
  and a test asserts exactly that.
- **Known false-positive risk, handled by key, not by loosening the class:** es "prueba" also means *proof*. No
  analytics key uses it; if one ever must, it is added as a second named exemption.
- The lint is **proven red on a planted string per class.**
- "Top 3 X posts" from the pre-review draft is exactly what it catches.

---

## §9 — Tenancy, security, query cost and the northstar fence (Q7)

### 9.1 Every new read

All user-facing reads use the **authenticated** client.
- `businessId` comes from the server-side active-business resolver, **never** from params or search params
  (`ANALYTICS-AUTHENTICATED-READS`, `ANALYTICS-TENANT-BOUNDED`).
- Every row below applies `.eq('business_id', businessId)`, because `get_user_business_ids()` returns an **array**,
  so RLS alone does not separate a user's two businesses (Reality §12).

| Read | Filter | Index | ORDER BY | Limit | Rows at 12 mo × 2 platforms × 60/mo |
|---|---|---|---|---|---|
| Published posts in the month | `business_id`, `status='published'`, `deleted_at IS NULL`, `published_at` range | **new** `posts (business_id, published_at DESC) WHERE …` | `published_at DESC, id DESC` | 500 per page, keyset-paged (§2.7) | ≤ 120 |
| Activity trend (Pro) | as above, per month | same | — (`count: 'exact', head: true`) | 12 queries | 0 rows returned; 12 counts |
| Outcomes in the month | `business_id`, `platform`, `published_at` range, `measured_at <= outcomes_through` | `(business_id, platform, published_at DESC)` | `published_at DESC, post_id DESC` | 500 per page, keyset-paged (§2.7) | ≤ 60 per platform |
| Outcomes trend (Pro) | as above, 12 months | same | `published_at DESC, post_id DESC` | **1,000 per page** (PostgREST default max rows), keyset-paged (§2.7) | ≤ 720 (X) |
| Raw metrics, "so far" | `business_id`, `post_id IN (≤ 120 ids)` | UNIQUE(`post_id`) | `post_id` | 120 | ≤ 120 |
| Dimensions (Pro) | `business_id`, `ai_original_id IN (…)`, chunked ≤ 200 | PK | `ai_original_id` | 200 per chunk | ≤ 720 |
| Retrospectives completed in the month | `business_id`, `completed_at` range | `business_id` scan (≤ 1 row per campaign; stated, no new index) | `completed_at DESC` | 100 | ≤ #campaigns |
| Report by period / id | `business_id`, `period_month` **or** `id` | UNIQUE(business_id, period_month) / PK | — | 1 | 1 |
| Report list | `business_id` | same unique index | `period_month DESC` | 24 | ≤ 12/yr |
| Patterns (Pro) | via `lib/memory` (`listOutcomePatterns`) | existing | existing | existing | ≤ cap |
| Social account labels | `business_id`, `id IN (…)` | PK | `id` | 20 | ≤ accounts |

### 9.2 `listTopPostMetrics`: left alone, not reused (L-2)

- It sorts by `likes DESC` across both bases (`lib/db/post-metrics.ts:33-46`). Its sole caller,
  `lib/memory/performance.ts:74-77`, feeds memory.
- The analytics surface **does not call it**, and its behaviour and its memory caller **do not change**.
- Its cross-basis sort is recorded as backlog row **`S37-TOP-METRICS-BASIS`**, owned by memory.
- Its other test references (`lib/ai/context.test.ts`, three `*.context-equivalence.test.ts` files,
  `lib/memory/performance.test.ts`) stay green, unmodified (§12.2).

### 9.3 The report worker cannot mix tenants (`REPORT-RLS-ISOLATED`, `[sec-2]`)

- The worker runs as service-role with RLS bypassed, so the `business_id` filter is the **only** boundary.
- Every worker read goes through a **business-binding wrapper**: `lib/db` functions that take `businessId` and apply
  `.eq` themselves. No caller-supplied query builder exists.
- **Every selected shape includes `business_id`.** The assembler checks every row against the loop's `businessId`,
  and **one mismatch throws and aborts that business's report**. It does not skip the row.
- **Cited post ids are drawn only from rows already verified,** and are re-read with the same binding.
- The inserted row's `business_id` and `tier` come from the loop variable and the plan read, never from the payload.
- `lib/outcomes/__tests__/no-cross-business.test.ts`'s recording client is extended to the new wrappers. A Tier-1 test
  seeds A and B, runs the worker for A, and asserts that no B id appears anywhere in A's payload.

### 9.4 Recipients are resolved server-side only (`REPORT-MEMBERS-ONLY`)

- No Server Action, route or payload accepts an address (§5.4).
- A source scan (§12.3) asserts that the enqueue call's recipient is sourced only from the recipients function.

### 9.5 Plan gate on the server path (`ANALYTICS-PLAN-GATE-SERVER`)

The gate is enforced on the server path (§3.1) and tested at the loader, the generator and the PDF route.

### 9.6 The northstar fence (`ANALYTICS-NORTHSTAR-FENCED`, `[sec-7]`)

- A vitest source scan over **the whole repository** (`*.ts`, `*.tsx`, `*.mjs`), not only `app/` and `components/`.
- It matches `getLearningCyclesNorthstar`, `get_learning_cycles_northstar` and `.rpc('get_learning_cycles_northstar'`.
- **Allowlist:** exactly `lib/db/campaign-retrospectives.ts` (the definition), `scripts/northstar-report.ts`, their
  tests, and `supabase/migrations/**`.
- It is **proven red** on a planted import under `app/` and under `lib/email/`.

---

## §10 — The UX contract the Builder is held to (Q8): specified, not designed

### 10.1 Information hierarchy, per level

- **Portfolio:**
  1. month picker (native `<select>`, GET form, works without JS);
  2. **activity**;
  3. **X results** or the platform state;
  4. campaigns table;
  5. Pro sections, or their gated state.
- **Post level:** filter bar, then a table: date, platform, account, campaign, state, value or "so far" counts, badge.
- **Campaign level:** the shipped page, untouched.
- **Report page:**
  1. header with "measured as of";
  2. summary;
  3. sections in §5.3 order;
  4. "How to read this";
  5. actions: Print, and Download PDF.

### 10.2 States

- Every section renders **one** of: empty, immature, unavailable, thin (§8.2), loading, error, or populated.
- A Pro section on a basic plan renders the **gated** state: "Available on Pro: {one line on what it shows}."
  - No blurred or fake numbers, no countdown, no modal.
  - A plain link to billing.

### 10.3 Chart contract

| Question | Mark | Axes | Text alternative |
|---|---|---|---|
| Posts published per month | vertical bars | month × count | sibling table; each bar's count is also printed as a label |
| X typical rate over time (Pro) | strip of post dots per month with a median tick; gaps below the floor | month × rate | sibling table (month, median, range, n) |
| Breakdown (Pro, n ≥ 10 per side) | horizontal bars of win share with a range whisker and an n label | share 0–100% | sibling table (value, k of n, range) |
| Below 10 per side | **no chart**; counts in text | — | — |

- **No number exists only as a shape.** Every chart has a real `<table>`, visually hidden or visible, and an
  `aria-describedby` summary sentence drawn from the closed templates.
- **Colour is never the sole carrier:** the above/below-usual badges carry text and an icon.
- The palette must reach AA contrast in light and dark modes.
- Server Components only; no chart needs a client island.

### 10.4 Responsive behaviour, and the inherited shell

- **Tables:** full at 1280 px; secondary columns (campaign, raw counts) hidden behind a "details" disclosure at 640 px;
  rows stacked into labelled cards at 320 px.
- **Charts:** full width, height capped, axis labels abbreviated at 320 px, the table always present.
- **This session fixes the inherited 320 px shell overflow** (`QA-MINOR-UI` (2): `scrollWidth` 367 at 320 px). Adding
  a table-heavy surface to a shell that already overflows would make it worse.
- **It also fixes `nav.team`** (`QA-MINOR-UI` (1)).
- **How each half is proven** (ADR 0015 has no "browser" tier, so the two halves are kept apart):
  - **Tier 2, executed in CI:** `nav.team` exists in en/pt/es (i18n parity); every chart renders a sibling `<table>`
    and an `aria-describedby` summary; no meaning is carried by colour alone (badge text and icon present).
  - **Manual QA, recorded and never counted as COVERED:** real-browser checks at 1280, 640 and 320 px, with the
    measured `scrollWidth` written into the Builder's report. Until that record exists, the property is
    **UNPROVEN** (§12.5), as `S36-UX-UNVERIFIED-IN-BROWSER` was.

### 10.5 Print

- The report page has a print stylesheet: no nav, no actions, A4/Letter margins, page breaks before sections 8 and 11,
  and charts kept with their tables.
- The PDF route uses the **same** component and CSS (§5.5).

### 10.6 Implementation rules

- Server Components by default.
- **Client islands only for:**
  - the report-email setting form (`useActionState`);
  - the route-segment `error.tsx` boundary behind the **error** state, which Next.js requires to be a Client
    Component. It renders the §8.2 error copy and a "Reload" control (`reset()`), and receives no data.

  The month and filter pickers are GET forms with no JavaScript.
- Zod on every Server Action and on every route param and search param.
- shadcn v4 / Base UI: **no `asChild`** on `Button` or `DropdownMenu`; use `buttonVariants()` on `<Link>`.
- Native `<select>` for static options.
- **Tailwind only.**
- i18n keys added to en, pt and es **simultaneously**, including the email template and its subject.
- WCAG 2.2 AA:
  - the keyboard reaches every control;
  - visible focus;
  - charts are not focus traps;
  - `prefers-reduced-motion` is respected, with no animation by default;
  - targets ≥ 24 px.
- Every list query is bounded and ordered on an index (§9.1).

### 10.7 Which design skill the Builder runs against which part (naming them, not running them)

| Skill | Against |
|---|---|
| `impeccable` | §10.1, §10.2 and §8.2: hierarchy, every state, UX copy, accessibility, responsive behaviour at 1280/640/320 |
| `taste-skill` | the report page's direction (§5.3, §10.5), so a forwarded report reads as a considered document, not a dashboard dump |
| `ui-ux-pro-max` | the chart palette and type scale (§10.3), AA in both themes |
| `emil-design-eng` | the final polish pass on the built surface |

---

## §11 — GDPR and tenancy (L-8)

**One new table, `analytics_reports`, and no other.**

| Obligation | How it is met |
|---|---|
| Business-scoped | `business_id` NOT NULL |
| RLS | Enabled. **One** policy: `SELECT TO authenticated USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))`, the InitPlan form copied from `20260919110000_outcome_tables.sql:139-141`. **No UPDATE policy exists, so no USING/WITH CHECK pair is needed**; stated so the pattern check doesn't flag it. Any member role, viewer included, may read their business's report; that is intended under A-1 |
| Grants | `REVOKE ALL … FROM anon`; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM authenticated` (`[db-2]`) |
| Writes | the service-role worker only (direct insert); write-once BEFORE UPDATE trigger |
| Cascade | `business_id … ON DELETE CASCADE` |
| `purge_business` | **No edit.** It relies on the root `DELETE FROM public.businesses` (`20260702120700_purge_business_member_delete.sql:62`). A Tier-1 cascade-and-purge test seeds a report row |
| DEFINER audit gate (ADR 0030's A-8 item) | **No new function.** The write-once trigger reuses `reject_outcome_table_update()` (§5.1). The migration header states this. If the Builder finds it needs a helper, it is `SECURITY INVOKER`, or DEFINER with `REVOKE ALL FROM PUBLIC, anon, authenticated` and `GRANT … TO service_role`, added to the audit list (the `f5461c58` proacl-NULL lesson) |

**ADR 0010 Amendment 2 §D2.5 row**, added **verbatim in the same commit as the migration**, after the
`founder_interview_answers` row:

```
| analytics_reports | yes (business_id) | CASCADE | yes | none — cascade = erasure (stored monthly report snapshot: aggregates, template-sentence keys and params, exclusion counts and cited post ids of the customer's own posts; no post text; write-once, no authenticated write; ADR 0031) |
```

**Other schema changes, none of which is a new table:**
- **`businesses.report_email`** (A-6), a new column on an already-cascaded table. No new §D2.5 row; a dated note
  under the existing `businesses` row (the Session 30.5 N2.4 precedent).
- **The `posts` partial index** (§2.7).
- **The `email_outbox_kind_check` widening** (§5.4).
- **Recommended in the same migration, declared in its header and not bundled silently** (`[db-3]`): move
  `email_outbox_select_own` (`20260607100000_email_outbox.sql:43-45`) to the InitPlan form. The new kind adds rows to
  a table whose policy still uses the per-row form.

---

## §12 — Test plan across the tiers (Q8), and measurement

### 12.1 Tier 1 — live Postgres (`supabase/__tests__/`, `db-tests.yml`)

1. `analytics_reports` RLS:
   - a member of A reads A's report (**positive control**);
   - **a user in A and B** querying with A's id gets no B row;
   - anon reads nothing.
2. Write-once: an UPDATE raises, service-role included. A DELETE through the cascade succeeds.
3. UNIQUE(business_id, period_month): a second insert is a no-op under ON CONFLICT DO NOTHING.
4. CHECK constraints: `period_month` must be the first of the month; `tier`.
5. Grants: authenticated INSERT/UPDATE/DELETE/TRUNCATE are denied.
6. Cascade plus `purge_business`: a seeded report is gone.
7. `email_outbox_kind_check` accepts `monthly-report` and still accepts all six prior kinds; dedupe uniqueness on the token.
8. The DEFINER audit gate returns the same count as before (no new function), and `analytics_reports`'s
   BEFORE UPDATE trigger calls `reject_outcome_table_update`.
9. Worker isolation: seed A and B, run generation for A, and assert that no B `post_id` or business id appears in A's payload.
10. If A-6 is adopted: `businesses.report_email` CHECK; a non-admin member cannot change it (via the policy or the trigger).

Every seed uses explicit statuses (`status='published'`, `active`), so a default cannot make a test vacuously green
(cerebrum, Session 34 K1).

### 12.2 Tier 2 — vitest (`app-tests.yml`)

**Aggregation, with literal expected numbers:**
- **NULL never zero:** a post with null impressions is excluded and counted, not 0%.
- **A real 0.0%** renders differently from NULL.
- **Mixed basis never summed:** an X rate and a LinkedIn count produce two separate results, and the pooled-wins
  function does not exist and cannot be called.
- **X impressions = 0** is excluded with reason *zero impressions*; a null field with *a field was missing*; no
  `post_metrics` row with *no data returned* (each via the real `eligibleValue`, §2.5).
- **An immature post (day 2)** appears with "so far" counts and is absent from the median.
- **The median and range** of a 7-post fixture.
- **No silent truncation:** a fixture paged across two pages gives the unpaged median; the 5,000-row ceiling renders
  the error state (`ANALYTICS-NO-SILENT-TRUNCATION`).
- **Report section 5:** ranks by `post_outcomes.value`, is absent at n < 5, and its view model has no
  `post_metrics` field.
- **A timezone period boundary, both directions:**
  - `2026-03-31T23:30Z` with `Europe/Lisbon` (UTC+1 from 29 March) is local 00:30 on 1 April → **April**;
  - `2026-04-01T00:30Z` with `America/Sao_Paulo` (UTC−3, no DST) is local 21:30 on 31 March → **March**;
  - the same two instants with `UTC` land in March and April respectively, proving the timezone is applied.
- **Exclusion counts.**

**Floors and states:**
- **Floors:** n = 4 renders thin; n = 5 renders a number; 5 vs 5 renders counts only; 10 vs 10 renders bars.
- **Gate:** `hasAdvancedAnalytics` for trial, plus, pro, agency, `'enterprise'` and `null`. The basic-plan loader
  payload has **no** Pro keys, and the Pro reads are **not called** (a recording client). The same holds for the
  generator and the PDF route.
- **The four states, plus loading, error and gated,** each rendered with the expected i18n key.
- **Tenant binding:** a user in A and B with A active, requesting B's report id or period, gets 404.
- **Due rule:** day 9 local is not due; day 10 local is due; `Pacific/Auckland` at local day 10 but before 06:00 UTC
  on day 10 is **not** due; M−2 is never generated; an empty month produces a stub and no enqueue; enqueue happens
  only when the insert returned a row.
- **Eligibility:** a live trial and a live paid business get a report; a cancelled or lapsed one does not; an
  unknown plan on a live business gets a **basic** report.
- **Recipients:**
  - invited, revoked and non-admin members are excluded;
  - `all_members` widens delivery;
  - `off` enqueues nothing but still generates;
  - the dedupe token uses the member id.

**Copy and output:**
- **Copy lint (§8.4):** over the analytics and report namespaces in en/pt/es and the rendered report, proven red on
  one planted string per class; every non-exempt key passes; "stop" does not trip "top".
- **Escaping:** a campaign name `"<script>…</script>\r\nBcc: x@y"` renders inert on the page, in the email body, in
  the email subject (CR/LF stripped) and in the PDF HTML.
- **PDF isolation:** a payload containing `<img src="http://169.254.169.254/">` and `<script>` produces **zero
  outbound requests** and no script execution, with the interception asserted.
- **i18n parity:** every new key exists in en, pt and es (`ANALYTICS-I18N-COMPLETE`).

**SHARED-FUNCTION CALLERS** (CLAUDE.md), each named with the test that covers it:

| Function | Caller | Test |
|---|---|---|
| `loadCampaignLearningView` | `campaigns/[id]/page.tsx:73` (unchanged) | existing `campaign-view.load.test.ts`; Tier-1 `outcome-campaign-view-rls.test.ts`. No new caller is added (asserted by a scan) |
| `unavailableMetricsPlatforms` | `campaign-view.ts:157` (unchanged) | existing `campaign-view.test.ts:81-111`. The new surface does **not** call it; the scan asserts this |
| `metricsReadAvailableFor` | `campaign-view.ts:130` (existing) + **new**: the analytics loader and the report assembler | existing `campaign-view.test.ts:112`; **new** tests that flip the capability with an injected function and assert the unavailable state on both new callers |
| `listTopPostMetrics` | `lib/memory/performance.ts:77` (unchanged) | existing `performance.test.ts` plus the three `*.context-equivalence` tests, unmodified; a source scan (§12.3) asserts no new caller |
| `getPlanCapabilities` | `enforcement.ts:25`, `members/seats.ts:18`, `billing/page.tsx:38-39` (unchanged) | existing tests; `hasAdvancedAnalytics` gets its own |
| `eligibleValue` | `lib/outcomes/normalise.ts:171`, inside the outcome normaliser (existing) + **new**: the exclusion-reason derivation (§2.5) | existing `normalise` tests, unmodified; **new** exclusion-reason tests call the real function, never a copy |
| `reject_outcome_table_update()` (SQL) | `post_dimensions`, `post_outcomes` triggers (existing) + **new**: `analytics_reports` | existing Tier-1 write-once tests; **new** Tier-1 #2 and #8 |

### 12.3 Properties of absence, as executable source scans (each proven red on a planted violation)

**Tier note.** ADR 0015 defines Tier 3 as diff-verified with **no** runtime test. Every item below is instead a
vitest source scan executed by `app-tests.yml`, in the `lib/signals/source-scans.test.ts` precedent, so by ADR 0015's
wording each is **Tier 2**. They are listed apart because they assert an absence. §13 marks them "2 (scan)"; none
relies on diff review alone.

1. **No platform API call:** `lib/analytics/**`, `lib/reports/**`, `app/[locale]/(dashboard)/analytics/**` and the new
   API route import nothing from `lib/social` except `metricsReadAvailableFor`.
2. **No write to measurement tables:** no `.insert`, `.update`, `.upsert` or `.delete` against `post_metrics`,
   `post_outcomes`, `post_dimensions` or `campaign_retrospectives` in those paths (`ANALYTICS-READ-ONLY`).
3. **No northstar import** (§9.6).
4. **No recipient from input** (§9.4).
5. **No model:** no `lib/ai`, `@anthropic-ai/sdk` or `dangerouslySetInnerHTML` in those paths.
6. **Dependencies:** `package.json`'s diff adds **only** the packages ruled in A-3 (`ANALYTICS-NO-NEW-DEPENDENCY`
   becomes "no dependency beyond A-3").
7. **No memory writer:** no `lib/memory` write function is imported in those paths.

### 12.4 Tier E

**None.** No judgment-quality property here needs Tier E.

### 12.5 Measurement: what seeded data can show, and what it cannot

**Seeded data can show:**
- every state renders, in three locales, at three widths;
- every number matches its fixture;
- the gate holds;
- the report is idempotent, immutable, tenant-isolated and delivered only to admins;
- the PDF matches the page;
- nothing is written or fetched that should not be.

**It cannot show, and these are reported as UNPROVEN until real tenants exist:**
- that a founder finds the report worth forwarding;
- that the medians are stable enough month to month at real volume to be read without over-interpretation;
- that the display floors are the right size for real posting cadences;
- that day 10 is late enough for real X sync latency;
- that the shell and the new pages hold at 320 px in a real browser, until the Builder records the measured
  `scrollWidth` (§10.4, constraint #35).

The Reviewer must record each as UNPROVEN, not as COVERED. **Un-defer:** the first three real tenants with two
generated reports each; review against these four questions then (`S37-REAL-TENANT-REVIEW`).

---

## §13 — Constraint table — the Reviewer's checklist

| # | Constraint | Tier | Proven by | Relies on / extends |
|---|---|---|---|---|
| 1 | `ANALYTICS-READ-ONLY` | 2 (scan) | scan 12.3 #2; also #1 (no platform call) | ADR 0026 `OUTCOME-WRITE-PROTECTED` (relied on) |
| 2 | `ANALYTICS-NULL-NEVER-ZERO` | 2 | NULL and 0.0% fixtures | `OUTCOME-ELIGIBLE-FIELDS-ONLY` (extended to display) |
| 3 | `ANALYTICS-BASIS-NEVER-MIXED` | 2 | mixed-basis fixture; per-platform wins | ADR 0026 §6.2 |
| 4 | `ANALYTICS-LINKEDIN-DISCLOSED` | 2 | a LinkedIn count fixture renders the verbatim sentence | ADR 0026 §10.2 (extended) |
| 5 | `ANALYTICS-UNAVAILABLE-FROM-CAPABILITY` | 2 | injected-capability tests on both new callers | `metricsReadAvailableFor` |
| 6 | `ANALYTICS-FOUR-STATES` | 2 | state render tests | — |
| 7 | `ANALYTICS-DISPLAY-FLOOR` | 2 | n = 4/5/9/10 fixtures | `OUTCOME_PROVISIONAL_N` (reused, not changed) |
| 8 | `ANALYTICS-N-SHOWN` | 2 | template schema: every rate has an n; lint | ADR 0016 honesty rule |
| 9 | `ANALYTICS-NO-CAUSAL-COPY` | 2 | the §8.4 lint, red on planted strings | ADR 0026 §10.3 (extended to new namespaces) |
| 10 | `ANALYTICS-NO-DELTA` | 2 | no delta, arrow or % change rendered for month pairs; win share never trended | — |
| 11 | `ANALYTICS-EXCLUSIONS-SHOWN` | 2 | exclusion-count fixture | — |
| 12 | `ANALYTICS-COVERAGE-DISCLOSED` | 2 | population tag and coverage line on every breakdown; `hook_type` filtered by `hook_survived` and n ≥ 10, absent from the report | ADR 0026 §VI.2 (closes its display ownership) |
| 13 | `ANALYTICS-NO-LOG-LIFT` | 2 + 2 (scan) | no `log_lift` field in any view model; scan | ADR 0026 §6.3 |
| 14 | `ANALYTICS-PLAN-GATE-SERVER` | 2 | gate tests at the loader, the generator and the PDF route; recording client | `lib/stripe/plan.ts` |
| 15 | `ANALYTICS-ACCOUNT-SLICEABLE` | 2 | grouping by `social_account_id`; NULL bucket not resolved to a default | — |
| 16 | `ANALYTICS-AUTHENTICATED-READS` | 2 + 2 (scan) | the user-facing loaders use the authenticated client; scan for the service import in analytics pages | Reality §5 |
| 17 | `ANALYTICS-TENANT-BOUNDED` | 1 + 2 | Tier-1 two-business arm; Tier-2 cross-business 404 | ADR 0030 §7.3 pattern |
| 18 | `ANALYTICS-BOUNDED-INDEXED` | 2 | each new lib/db reader asserts limit + order (recording client); index exists (Tier 1) | — |
| 19 | `ANALYTICS-NORTHSTAR-FENCED` | 2 (scan) | whole-repo scan, red on a planted import | `OUTCOME-NORTHSTAR-COMPUTABLE` (relied on) |
| 20 | `ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE` | 2 + 2 (scan) | no second caller of retrospective verdict logic; shared i18n keys; scan | ADR 0026 §10.1 |
| 21 | `REPORT-SNAPSHOT-IMMUTABLE` | 1 | write-once trigger test; the trigger reuses `reject_outcome_table_update()` | — |
| 22 | `REPORT-ONE-PER-PERIOD` | 1 + 2 | UNIQUE and ON CONFLICT; due-rule tests; enqueue only on insert | — |
| 23 | `REPORT-MEMBERS-ONLY` | 2 + 2 (scan) | recipient tests; scan for recipient from input | A-1 |
| 24 | `REPORT-NUMBERS-FIDELITY` | n/a | no model (§6) | recorded for `S37-NARRATIVE` |
| 25 | `REPORT-FALLBACK` | 2 | templated report is the only path; empty-month stub | — |
| 26 | `REPORT-COST-CEILING` | n/a | no model (§6) | recorded for `S37-NARRATIVE` |
| 27 | `REPORT-RLS-ISOLATED` | 1 + 2 | Tier-1 worker isolation; Tier-2 abort-on-mismatch | — |
| 28 | `REPORT-CASCADE-COMPLETE` | 1 | cascade and purge test; §D2.5 row present in the same commit | ADR 0010 A2 |
| 29 | `REPORT-OUTPUT-ESCAPING` | 2 | hostile string across three sinks | — |
| 30 | `REPORT-PDF-ISOLATED` | 2 | zero outbound requests, JS off, timeout; auth, business binding and plan gate run before launch. The firewall rule is a launch-checklist row, not CI | — |
| 31 | `REPORT-METHODOLOGY-PRESENT` | 2 | every §5.3 #11 key present in every generated report | — |
| 32 | `ANALYTICS-NO-NEW-DEPENDENCY` (as "only A-3") | 2 (scan) | `package.json` diff scan | L-6′ |
| 33 | `ANALYTICS-I18N-COMPLETE` | 2 | key parity en/pt/es, including the email | — |
| 34 | `ANALYTICS-A11Y-FLOOR` | 2 | table alternative and `aria-describedby` summary for every chart; no colour-only meaning (§10.4) | — |
| 35 | `ANALYTICS-SHELL-320` | 2 + manual QA | **CI:** `nav.team` in three locales. **Manual, recorded, UNPROVEN until recorded:** shell `scrollWidth` ≤ 320 at 320 px, and the 1280/640/320 layouts, in a real browser (§10.4) | QA-MINOR-UI |
| 36 | `ANALYTICS-NO-SILENT-TRUNCATION` | 2 | two-page fixture equals unpaged median; ceiling renders error (§2.7) | — |
| 37 | `ANALYTICS-EXCLUSION-REASON-FROM-NORMALISER` | 2 | exclusion reasons come from the real `eligibleValue` (§2.5) | `lib/outcomes/normalise.ts` |
| 38 | `ANALYTICS-NO-MEMORY-WRITER` | 2 (scan) | scan §12.3 #7 | L-1, `MEM-NO-DIRECT-TABLE-ACCESS` |
| 39 | `REPORT-NO-MODEL` | 2 (scan) | scan §12.3 #5 | §6 |
| 40 | `REPORT-ELIGIBLE-LIVE-ONLY` | 2 | eligibility tests: live trial/paid yes, lapsed no, unknown plan basic (§5.2) | §3.3 |
| 41 | `REPORT-EMAIL-KIND-WIDENED` | 1 | Tier-1 #7: new kind accepted, six prior kinds still accepted | ADR 0014 |
| 42 | `REPORT-EMAIL-SETTING-ADMIN-ONLY` (if A-6 is adopted) | 1 + 2 | Tier-1 #10; Server Action admin re-check | A-6 |

**Count: 42 constraints.** 40 have a CI-executed test (#42 only if A-6 is adopted; #35 only for its `nav.team`
half, its browser half staying UNPROVEN until the Builder records the measurement); 2 (#24, #26) are not applicable
while there is no model.

---

## §14 — Deferred (owning session named) and amendments

| Item | Owner | Un-defer trigger (`docs/backlog.md` row) |
|---|---|---|
| LinkedIn engagement metrics (`r_member_social_feed` / `r_member_postAnalytics`) | **Session 38** OAuth scope review (T1-E), then a LinkedIn amendment to ADR 0028 | LinkedIn grants the restricted permission (`S33-LINKEDIN-RATE`) |
| Pooled wins across platforms | follow-on to the above | LinkedIn metrics land; re-decide cross-basis win pooling |
| Metrics history / per-post curves | — | A founder ruling to change collection (L-2); none planned |
| Ratio-of-sums "overall rate" (`S37-RATIO-OF-SUMS`) | analytics follow-on | ≥ 3 real tenants with ≥ 3 matured months, and a demonstrated founder need |
| Model-written narrative (`S37-NARRATIVE`) | analytics follow-on ADR | as §6 |
| Content portfolio (mix) view | `docs/ideas.md` §3, `OPEN` | its own ruling |
| `proof_type` descriptive display | analytics follow-on | per-post evidence citation (`S33-PROOF-TYPE`) |
| `hook_type` in the board report | analytics follow-on | `S33-HOOK-KAPPA` clears (κ ≥ 0.6 on ≥ 30 posts) |
| Cross-brand benchmarks | — | never without a founder ruling and counsel (cross-tenant data) |
| UTM and conversion ingestion | unowned post-launch | a founder ruling. **Correction:** `docs/backlog.md:146` names T1-B as the owner; L-1 excludes it, so the row is corrected at close-out |
| Follower-normalised LinkedIn numbers | follows LinkedIn metrics | a follower-count fetch exists |
| Prediction / growth simulation | **never** (`ideas.md` §3 `PARKED`) | — |
| `listTopPostMetrics` cross-basis sort (`S37-TOP-METRICS-BASIS`) | memory | the next session that touches `retrievePerformancePatterns` |
| Consolidating the 13 scattered plan checks (`S37-PLAN-CHECKS`) | billing | the next session that touches plan enforcement |
| Plus caps mismatch (`S37-PLUS-CAPS`): `plan.ts` has 50 posts / 5 campaigns, `CLAUDE.md` says 250 / 25 | founder (pricing) | C-2 adjudication |
| "Metrics aren't available for {platform} yet" on the shipped campaign page | campaign view | align with §8.2's undated wording when the campaign page is next touched |
| Real-tenant review of report usefulness and stability (`S37-REAL-TENANT-REVIEW`) | operator | §12.5 |
| Unsubscribe link for `monthly-report` (A-6 counsel) | counsel | next counsel batch |
| Per-user rate limit on the PDF route (`S37-PDF-RATE-LIMIT`) | analytics follow-on | render cost or abuse observed beyond the firewall rule (§5.5) |

**Amendments made by this ADR:**
- **ADR 0026 §VI.2:** `hook_type`'s descriptive display is **owned and specified here** (§2.6). `proof_type` stays
  deferred with a trigger. A dated note is appended to ADR 0026 by the Builder. Nothing in ADR 0026's normalisation,
  baseline, floor or promotion changes.
- **ADR 0010 Amendment 2 §D2.5:** one row (§11), plus a dated note on `businesses.report_email`.
- **ADR 0014 (email kinds):** one kind, `monthly-report`, recorded by a dated note.
- **`docs/launch-checklist.md`:** the `generate-reports` schedule row, ordered after `extract-outcomes`, and the PDF
  route's Vercel Firewall rate rule (A-7).

---

## §15 — Advisory findings: disposition

| Finding | Severity | Disposition |
|---|---|---|
| `[mle-1]` month-over-month needs an n-aware rule | MAJOR | **Adopted:** side by side with n and range, no delta, both n ≥ 5 (§2.3) |
| `[mle-2]` ratio of sums next to the median confuses | MAJOR | **Adopted:** deferred (§2.3, §14) |
| `[mle-3]` wins pooled across platforms | MAJOR | **Adopted:** per platform, a test forbids pooling (§2.3) |
| `[mle-4]` n = 5 only for descriptions; compare at 10 | MAJOR | **Adopted:** two floors (§8.1) |
| `[mle-5]` baseline drift; win share not a trend | MAJOR | **Adopted** (§2.4) |
| `[mle-6]` coverage, population tags, `hook_type` | MAJOR | **Adopted:** tags in titles; `hook_type` n ≥ 10, "not independently checked", not in the report (§2.6) |
| `[mle-7]` exclusions counted and shown | MAJOR | **Adopted** (§2.5) |
| `[mle-8]` "top 3 by rate" | MAJOR | **Partly adopted, revised in the 2026-10-04 review.** The first disposition ranked by raw engagement count, but `post_outcomes` stores no counts, so that ranking would have come from `post_metrics` and broken D-1. Now: ranked by the day-7 rate from `post_outcomes`, never titled "top", drawn only at n ≥ 5, each post with its badge and the caveat "A post seen by few people can have a high rate." The finding's core risk (small-reach posts dominating a rate ranking) is **disclosed, not removed** (§5.3) |
| `[mle-9]` copy lint too thin | MINOR | **Adopted:** closed templates and class regexes (§8.4) |
| `[mle-10]` rate formatting; 0% vs NULL | MINOR | **Adopted** (§2.3) |
| `[mle-11]` methodology content | MINOR | **Adopted** (§5.3 #11, constraint 31) |
| `[mle-12]` trend gaps | NIT | **Adopted** (§8.1) |
| `[db-1]` incomplete read table; retrospectives index; IN chunking; max_rows | MAJOR | **Adopted:** §9.1 filled in; retrospectives scan stated; 1,000-row cap; shared `outcomes_through` |
| `[db-2]` `analytics_reports` CHECKs, write-once, direct insert, due-predicate cost, M−1 only, enqueue-on-insert | MAJOR | **Adopted** (§5.1, §5.2) |
| `[db-3]` kind widening copied from file; member-id token; `email_outbox` InitPlan | MAJOR / MINOR | **Adopted**; the InitPlan fix is recommended and declared, not bundled silently (§11) |
| `[db-4]` RLS form, positive control, §D2.5 row, purge, A-8 | MAJOR | **Adopted** verbatim (§11, §12.1) |
| `[db-5]` `report_email` shape and policy check | MINOR | **Adopted**, with a founder flag (A-6) |
| `[db-6]` tick ordering; index readers | NIT | **Adopted:** cursor by id (§5.2) |
| `[sec-1]` URL selectors not bound to the active business | MAJOR | **Adopted:** active-business resolver, Zod, 404 (§4.1) |
| `[sec-2]` assertion insufficient for worker | MAJOR | **Adopted:** binding wrappers, `business_id` in every shape, abort (§9.3) |
| `[sec-3]` recipient resolution | MAJOR | **Adopted** (§5.4) |
| `[sec-4]` `getPlanCapabilities` crashes on an unknown plan; "no new function" reversed; downgrade | MAJOR | **Adopted:** `hasAdvancedAnalytics`; downgrade raised as A-5 |
| `[sec-5]` Chromium hardening and DoS | MAJOR | **Adopted** (§5.5) |
| `[sec-6]` three output sinks | MINOR | **Adopted:** `REPORT-OUTPUT-ESCAPING` |
| `[sec-7]` whole-repo northstar scan | MINOR | **Adopted** (§9.6) |
| `[sec-8]` record the `listTopPostMetrics` backlog row | NIT | **Adopted:** `S37-TOP-METRICS-BASIS` |

**Rejected: none.** The pre-review draft's "no new function" for the gate and its ratio-of-sums Pro secondary were
both withdrawn on review. This is recorded here rather than erased.

---

## §16 — Revision log: the 2026-10-04 consistency review

The review was made on the working-tree file, before the ADR was first committed. Four points were ruled in the
review: section 5 ranks by rate; breakdowns show win share; the PDF route uses no new rate-limit primitive; reports
go to live businesses only. The other changes are corrections.

| Change | Sections |
|---|---|
| Status set to Proposed until A-3…A-7 are ruled | header |
| Report section 5 ranks by `post_outcomes.value`; no report number comes from `post_metrics`; `[mle-8]` disposition revised | §5.3, §12.2, §15 |
| Exclusion reasons unified as one typed union, derived by calling `eligibleValue` | §2.1, §2.5, §12.2, §13 #37 |
| §8.2/§8.4 copy that failed its own lint fixed ("will", "Try", "show that"); orphan "{n} more posts" exemption removed; whole-word matching | §8.2, §8.4 |
| One thin-state string; it names the typical rate, not "comparisons" | §8.1, §8.2 |
| "Browser" tier removed; manual QA kept apart from CI coverage; scans labelled Tier 2 per ADR 0015 | §10.4, §12.3, §12.5, §13 |
| Wrong Lisbon example corrected; timezone fixtures in both directions | §2.3, §12.2 |
| Eligibility: live businesses only; unknown plan → basic; stub vs. eligibility contradiction removed | §5.2, §5.6, §12.2, §13 #40 |
| Due rule gains a 06:00 UTC day-10 floor for timezones ahead of UTC; the "no gaps" limit stated | §5.2 |
| Write-once trigger reuses `reject_outcome_table_update()`, so "no new function" holds | §5.1, §11, §12.1 |
| Keyset paging and a hard ceiling replace silent read limits (Pro has no post cap) | §2.7, §9.1, §13 #36 |
| PDF: Next 16 / visx feasibility spike as O2's first step; firewall rule instead of an unbuilt limiter | §5.5, §14 |
| Breakdowns show win share; the §8.4 template matches §10.3 | §2.6, §3.2, §5.3, §8.4 |
| C-2 footnote undated ("doesn't", not "doesn't yet") | §3.4 |
| `error.tsx` named as the second client island | §10.6 |
| The report-email setting has a place (`/analytics/reports`) | §4.1 |
| NULL account label covers deleted accounts | §4.4 |
| 12-month live trend vs 6-month report trend stated | §3.2, §5.3 |
| Volume figure corrected (outcome rows are X only) | §2.7 |
| Missing constraint IDs added (#36–#42); count 35 → 42 | §13 |
| ADR 0030's "A-8" audit gate renamed "the DEFINER audit gate" here | §0.1, §11, §12.1 |

---

## Builder verification (O2)

> Appended by the Builder (O2). Nothing above this heading is edited. BASE = `0da603b4a` (master after PR #19 and PR #18), branch `session-37-adr-0031`. Dates are 2026-10-04.

### V.1 — O2.0 premise table, drift and decisions

| # | Premise | Evidence | Still true? |
|---|---|---|---|
| 1 | Active-business resolver | `getBusinessForUser(client, userId)` at `lib/db/businesses.ts:22`; the layout (`layout.tsx:33`) and every dashboard page and API route call it. No caller passes `preferredBusinessId`. | Yes. It means "earliest-created owned business, else the first visible one". |
| 2 | One business-liveness predicate | None exists. `clearBillingOnCancellation` (`businesses.ts:167`) sets `plan='trial'` and nulls `stripe_subscription_id`. The 14-day trial arithmetic is inline in `layout.tsx:61` and `billing/page.tsx:34` only. | **No.** O2.7 writes the predicate once in `lib/db/businesses.ts` (ADR §5.2 anticipated this). |
| 3 | `businesses` UPDATE policy | `20260430120017:25-27`: `USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`, identical in the live database. | Partly. Both clauses exist and only the OWNER can write `businesses`, so a non-admin member cannot write `report_email`. **No restricting trigger is needed**, so there is no exception to "no new SQL function". |
| 4 | `reject_outcome_table_update` | `20260919110000:158-166`: SECURITY INVOKER, `TG_TABLE_NAME`, EXECUTE held by `postgres` only (REVOKE at `20260919150000:97`). | Yes. Its message still reads "ADR 0026 … OUTCOME-DIMENSIONS-WRITE-ONCE", so tests assert `TG_TABLE_NAME` plus "immutable", not the constraint name. |
| 5 | The six email kinds | `20260709120000:3-9`, `lib/db/types.ts:79-85` and `lib/email/types.ts:1-7` carry the same six. | Yes. Two duplicate unions must both be widened. |
| 6 | Shell overflow and `nav.team` | Reproduced. Overflowing element: `DashboardShell.tsx:207`, `<div className="flex flex-1 flex-col">`, which has no `min-w-0`; the header (`:209`) stretches with it. `nav.team` is still missing in en, pt and es. | Yes, but the backlog text ("independent of any page content") is wrong: the overflow depends on the page. Measured `scrollWidth` at 320 px: `/pt/opportunities` 359, `/pt/calendar` 575, `/pt/settings/team` 744; clean (305 = `clientWidth`) on campaigns, billing, create. Acceptance for #35 is `scrollWidth <= clientWidth`. |
| 7 | Baselines | V.2. | n/a |
| 8 | QA defects | `QA-LOCALE-HEADER-DROPPED` and `QA-REAL-API-SOSH-FIELD` are fixed by `2f2b33676` (in master via PR #18). `/pt/login` renders "Bem-vindo de volta" in a real browser. | Yes. The pt browser pass in O2.11 can be real. |

**Findings and rulings (founder, 2026-10-04):**

1. **`proxy.ts` redirects every `/api/*` request.** Its matcher has never excluded `/api`, so next-intl 307-redirects `/api/x` to `/{locale}/api/x`, which 404s, authenticated or not (reproduced on both a QA dev server and the spike server; `curl -X POST` to a cron route also gets the 307). The new cron route (O2.7/O2.8) and the PDF route (O2.9) would be unreachable, and the existing cron, billing and social routes are very likely affected. Production was not probed. **Ruling: fix it in Session 37, as its own tracked commit before O2.7.** It closes no ADR 0031 constraint; it is recorded here as a prerequisite, not as scope creep (the build guide's "a step that closes no constraint does not exist" is waived for it by this ruling).
2. **A-3 loses `@visx/axis`** (V.3). **Ruling: dropped.** The shared report component draws its axes as plain SVG `<text>`. The O2.1 dependency scan allows exactly `@visx/scale`, `@visx/shape`, `@visx/group`, `puppeteer-core` and `@sparticuz/chromium`.
3. **Live-trial definition (O2.7).** **Ruling:** a live trial is `plan = 'trial'` AND `trial_started_at` set AND under 14 days old. A business whose trial clock never started gets **no report and no stub**. A live paid business is a paid plan with a non-null `stripe_subscription_id`.
4. **`report_email` writer (O2.8).** **Ruling: owner-only through RLS, using the authenticated client.** The ADR's "admin" wording (§5.4) is narrowed to "owner", because the `businesses` UPDATE policy is owner-only. No service-role use is added. Constraint #42's admin re-check becomes an owner check.
5. Not a drift: `.env.local` points at the HOSTED Supabase project; every local QA run overrode the Supabase variables from `npx supabase status -o env` (cerebrum).

### V.2 — Baselines (BASE `0da603b4a`)

- **DEFINER audit gate** (SECURITY DEFINER functions executable by `anon` or `authenticated`): **3** on the local database, equal to the allow-list in `supabase/__tests__/security-definer-client-exec-allowlist.test.ts` (`accept_invite(uuid,uuid)`, `get_user_business_ids()`, `user_can(uuid,text)`). D12's "6" predates `20261004100000` and `20261004110000`. The local database is long-lived; a fresh `db reset` is the stronger check and is repeated in O2.2.
- **Tests, all green** (CI dummy env): `campaign-view.load` 3, `campaign-view` 11, `performance` 18, `generate.context-equivalence` 7, `context-callers.context-equivalence` 6, `actions.context-equivalence` 5, `no-cross-business` 33. Total 83.
- **A-3 packages** (`npm ls`): absent.
- `npm run lint`: 0 errors, 113 pre-existing warnings.

### V.3 — The PDF / visx spike (a scratch worktree, deleted; nothing committed)

| Check | Result |
|---|---|
| (c) The same component in a Server Component page | Works: 4 bars and axis ticks rendered; a hostile `<script>` in the title stayed inert text. |
| (b) `react-dom/server` in a Next 16 route handler | A **static** `import … from 'react-dom/server'` (and `react-dom/server.node`) fails to compile under Turbopack (the route graph aliases it to `server.react-server.js`). `await import('react-dom/server')` compiles. |
| (b) packages | `@tailwindcss/postcss`, `lightningcss`, `@sparticuz/chromium` and `puppeteer-core` need `serverExternalPackages`. |
| `@visx/axis` server-side | **Fails** under `renderToStaticMarkup` in the route handler: `Cannot read properties of null (reading 'useMemo')`. Cause: `@visx/text`'s `useText` hook (used by `@visx/axis` for tick labels); the route's components run on the react-server React copy while `react-dom/server` sets the dispatcher on the other. `@visx/scale`, `@visx/shape` (Bar, Group) have no hooks and work in both contexts. Plain SVG `<text>` axes also work. |
| CSS inlinable | Yes. A request-time `@tailwindcss/postcss` compile produced 150,305 bytes in 63-282 ms and was inlined into the HTML. A build-time compile may suit better; that is O2.9's design choice. |
| Timing and size | Cold 1.2 s (CSS 282 ms, Chrome launch 443 ms, PDF 376 ms), warm 0.8 s; PDFs 45-46 KB. Local Windows Chrome, not Vercel's Linux Chromium. |
| Sealing | With the CSP removed, interception aborted exactly 1 request (a hostile `<img>`); with JavaScript disabled the hostile `<script>`'s fetch never ran; the server counted 0 pings in every run. With the CSP present, the `<img>` never reached the interceptor. Each layer holds on its own. |
| Not proven | `@sparticuz/chromium` on Vercel's Linux runtime and its cold start: **UNPROVEN** until a preview deploy. |

Verdict: (b) is achievable with the synchronous-component design, an `await import('react-dom/server')`, `serverExternalPackages`, and no hook-using component in the shared tree (hence no `@visx/axis`). It is not a "stop and report" failure of the design; the `@visx/axis` loss is the founder-visible A-3 change ruled in V.1 item 2.

### V.4 — O2.1: the absence scans and the fixture

`lib/analytics/source-scans.test.ts` (39 tests + 1 todo) and `lib/analytics/__fixtures__/portfolio.ts`.

- **Closed here (Tier 2, scan):** #1 `ANALYTICS-READ-ONLY` (arm a: lib/social import; arm b: writes to the four measurement tables, the write RPC and the four named lib/db writers, plus a completeness test over those lib/db files), #19 `ANALYTICS-NORTHSTAR-FENCED` (whole repository; allowlist pinned to six exact files plus `supabase/migrations/**`), #32 `ANALYTICS-NO-NEW-DEPENDENCY` (literal baseline plus the five A-3 packages), #38 `ANALYTICS-NO-MEMORY-WRITER` (names derived from `MEMORY_WRITERS` and the exports of its sole-caller modules under `lib/memory/`), #39 `REPORT-NO-MODEL`.
- **Scan halves authored (constraint closes in the named step):** #13 (O2.3), #16 (O2.4), #20 (O2.5; whole-repo, three functions), #23 (O2.8).
- **Roots:** a tripwire test (`EXPECTED_PENDING`) lists the roots that have no production file yet; the step that creates a root must remove it from the list in the same commit, which is what turns every scan on for it. O2.12 empties the list (an `it.todo` records this).
- **Decision recorded by the Builder (not an architectural choice):** the recipients function that scan #23 names is **`resolveReportRecipients`** in `lib/db/business-members.ts`. The ADR required one service-role function without naming it; the name is fixed here so the scan and O2.8 cannot disagree.
- **Fixture:** two businesses sharing one user (A Europe/Lisbon, B America/Sao_Paulo); every row carries an explicit status; B holds an active row of every kind; `EXPECTED` is hand-computed literals (March: median 0.031, range 0 to 0.064, n 7 of 10, wins 4 of 6, exclusions 1/1/1/0; February n 5; January n 4). LinkedIn rows carry count-basis outcomes on purpose. `campaign_retrospectives` rows are deferred to O2.7, their first consumer.
- **Redden transcript (real-tree arms, planted in the real roots, then reverted):** with one violation planted per scan (`lib/analytics/_plant_*`, `components/analytics/`, `lib/reports/`, `app/_plant_northstar.ts`, `lib/email/_plant_northstar.ts`, a `package.json` dependency), 11 tests went red: the tripwire and all 10 real-tree arms. The offenders named included `app/_plant_northstar.ts` and `lib/email/_plant_northstar.ts` (both northstar plants), `dependencies: left-pad`, `lib/analytics/_plant_social.ts: imports @/lib/social (getRegistry)`, `lib/analytics/_plant_memory.ts: uses the memory writer recordInterviewCandidates`, `lib/analytics/_plant_model.tsx: imports @anthropic-ai/sdk`, `lib/analytics/_plant_loglift.ts: names log_lift`, and `components/analytics/_plant_service.tsx: imports @/lib/supabase/service`. After the revert the file was green.
- **Verification:** `npm run typecheck` clean; `npm run lint` 0 errors (113 pre-existing warnings); `npm run test:app` with the CI dummy env: 385 files, 5,926 passed, 1 todo. `test:db` not run (no DB behaviour touched).

### V.5 — O2.2: the schema, the Tier-1 tests, and the database review

(The build guide says to record the review as "V.4"; V.4 is O2.1's, so this continues the numbering.)

**Shipped:** `supabase/migrations/20261004120000_analytics_reports.sql`; four Tier-1 files (`analytics-reports-seed|rls|constraints|purge.test.ts`, 40 tests); `lib/analytics/__fixtures__/seed-live.ts`; the §D2.5 row and a dated note in ADR 0010 Amendment 2; `lib/db/__tests__/d2.5-analytics-reports-row.test.ts` (Tier 2, the row-presence half of #28 plus a scan that the migration creates no function); `ReportEmailSetting` and an optional `BusinessRow.report_email` in `lib/db/types.ts`.

**Closed (Tier 1):** #21 `REPORT-SNAPSHOT-IMMUTABLE`, #28 `REPORT-CASCADE-COMPLETE`, #41 `REPORT-EMAIL-KIND-WIDENED`. **Tier-1 halves authored:** #17 (the two-business arm), #22 (UNIQUE and ON CONFLICT), #27 (the worker-isolation seed: the fixture loads into live Postgres and the tagging-trigger-derived `post_dimensions` equal the fixture's), #42 (`report_email`, owner-only per O-3).

**Decisions recorded (not architectural choices):**

1. **The TypeScript `EmailKind` unions are NOT widened in O2.2** (founder, 2026-10-04, answering a Builder question). `TEMPLATES` is `Record<EmailKind, KindEntry>`, so widening the unions here breaks typecheck until the `monthly-report` template exists (O2.8). O2.2 widens only the DB CHECK (proved by Tier 1); `lib/email/types.ts` and `lib/db/types.ts` gain `'monthly-report'` in O2.8, in the commit that adds the template. This deviates from the O2.2 step text; nothing enqueues the kind before O2.8.
2. **No `report_email` trigger and no new SQL function**, per V.1 premise 3 and ruling O-3. Tier 1 proves an admin member and a viewer each update zero rows and the value is unchanged.
3. **The fixture changed to match the tagging trigger:** `post_dimensions.origin_mode` is the CAMPAIGN's origin, so each fixture campaign now carries an `origin` and an AI post's origin follows its campaign (a third campaign, "A manual", was added). The seed test asserts the trigger-derived dimensions equal the fixture's, so the Tier-1 and Tier-2 suites cannot read different numbers.
4. `report_email` is optional on the `BusinessRow` type for the reason `interview_snoozed_until` is: unrelated fixtures build a full row.

**Redden transcript (each applied to the local database, the four files run, then restored; baseline back to 40 passed):**

| Mutation | Tests that went red |
|---|---|
| drop the write-once trigger | UPDATE raises for the service role; UPDATE raises for the table owner; the trigger catalogue (3) |
| `GRANT UPDATE` to `authenticated` | the 42501 write test; the privilege matrix (2) |
| remove `team-invite` from the kind CHECK | the six-prior-kinds test; the exactly-seven-kinds test (2) |
| open the SELECT policy (`USING (true)`) | positive control, cross-tenant reads, B-only user, the policy-shape test (4) |
| add a BEFORE DELETE guard | `purge_business must SUCCEED` and the plain-DELETE cascade test (checked in isolation; in the combined run the guard also broke cleanup) |
| drop the posts index / loosen its predicate (drop `deleted_at IS NULL`) | the index-definition test and the plan test (2 each) |
| drop the `period_month` CHECK; drop UNIQUE; drop the `report_email` CHECK | 1; 2; 1 |

**Database review (ECC budget 2 of 4; `ecc:database-reviewer`, read-only, files and `git diff` only).** Verdict: no BLOCKER or MAJOR. Against §5.1, §5.4, §9.1 and §11 no policy, grant, CHECK, index, cascade or trigger is wrong or missing; the posts index matches the queries' predicates literally; the migration creates no function, so the DEFINER audit gate does not move; every §12.1 item 1-8 and 10 has a real Tier-1 assertion (item 9 is O2.7's).

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | MINOR | The "query uses the new index" assertion is planner- and statistics-dependent; the negative half is deterministic. | **Adopted, and corrected by experiment.** The reviewer proposed `ANALYZE`; the Builder tried it and it made the test fail consistently (with real statistics on a tiny table the planner prefers `posts_business_id_status_idx` plus a sort). The test now drops the three competing `business_id` indexes inside a transaction it rolls back, so the new index is used if and only if the query's predicates imply its WHERE clause. Stable over three runs; red when the predicate is loosened. |
| 2 | NIT | The index omits `id`, so the `ORDER BY published_at DESC, id DESC` keyset page does an incremental sort on ties. | **Declined.** The ADR specifies `(business_id, published_at DESC)`; 500 rows per page makes it harmless. Revisit only if the plan shows a sort cost. |
| 3 | NIT | The REVOKEs leave `REFERENCES` and `TRIGGER` on `authenticated`. | **Declined.** Identical to the `20260919110000:152-154` precedent; not reachable through PostgREST. |
| 4 | NIT | The reused trigger's message names ADR 0026. | **Acknowledged.** Unavoidable under the reuse ruling; tests assert `analytics_reports rows are immutable`. |
| 5 | NIT | The Tier-1 DEFINER-count assertion duplicates the standing allow-list test. | **Kept.** The step asks for the V.2 count; a legitimate fourth allow-listed function would redden both on purpose. |

**Verification (in the required order):** `npm run typecheck` clean; `npm run lint` 0 errors (113 pre-existing warnings); `npm run test:app` (CI dummy env) 386 files, 5,934 passed, 1 todo; `npm run test:db` on a FRESH `supabase db reset` (129 migrations applied through the real pipeline): 120 files, 1,358 passed, 0 failed, no empty or skipped file.

### V.6 — O2.3: the pure aggregation

**Shipped (no I/O, no clock, no client; every function is pure):** `lib/analytics/` `constants.ts`, `period.ts`, `rates.ts`, `floors.ts`, `wins.ts`, `exclusions.ts`, `breakdowns.ts`, `view-model.ts`, plus `types.ts` (the input shapes; not in the step's file list, added so the shapes have one home). Seven test files under `lib/analytics/__tests__/` (131 tests) and one test-side adapter, `lib/analytics/__fixtures__/adapters.ts`, that maps the portfolio fixture's rows into the input shape and does no arithmetic. `lib/analytics` left `EXPECTED_PENDING` in `source-scans.test.ts` in the same commit, so every O2.1 scan now walks it.

**Closed (Tier 2):** #2 `ANALYTICS-NULL-NEVER-ZERO`, #3 `ANALYTICS-BASIS-NEVER-MIXED`, #7 `ANALYTICS-DISPLAY-FLOOR`, #10 `ANALYTICS-NO-DELTA`, #11 `ANALYTICS-EXCLUSIONS-SHOWN`, #13 `ANALYTICS-NO-LOG-LIFT` (the O2.1 scan half now has real files to walk, plus the type test and a deep-key test), #37 `ANALYTICS-EXCLUSION-REASON-FROM-NORMALISER` (a spy that keeps the real `eligibleValue` running and asserts its exact arguments, plus a source check that `exclusions.ts` holds no copy of its rules).

**Every expected number is a literal hand-computed from the O2.1 fixture** (March, business A, X: median 0.031, range 0 to 0.064, 7 measured of 10 published, exclusions 1/1/1/0, wins 4 of 6, role/format/origin/length/CTA win counts, coverage 5 of 7; February n = 5; January n = 4 renders thin; the Lisbon and Sao Paulo boundary posts file into April and March). The Wilson literals were computed independently (5 of 10: 0.2366 to 0.7634; 8 of 10: 0.4902 to 0.9433; 9 of 12: 0.4677 to 0.9111).

**Decisions recorded (Builder choices inside the ADR, none architectural):**

1. **The IQR is the linear-interpolation (R-7) interquartile range.** The ADR says "IQR from n = 10" without naming a method; 1 to 10 gives 3.25 to 7.75. Pinned by literals so a change of method is a visible test change.
2. **"Day 9" is `published_at` plus 9 x 86,400,000 ms**, so the boundary does not move with the machine's timezone (`subDays` is a local-calendar operation). The edge is tested to the millisecond.
3. **`unsupported_platform` from `eligibleValue` is counted as "no data returned".** The ADR's closed union has four reasons and no fifth; a post is never dropped from the count.
4. **`post_outcomes.length_band` and `cta_present` are nullable in the table** (typecheck found it; the first draft typed them as never null). A NULL is unclassified: it is in the coverage `n`, in no bucket, and never "false".
5. **Bars need two or more values and 10 on every one of them.** One thin value makes the whole dimension counts only and provisional; the Wilson interval appears only in the bars case. A value with no baselined post (`of` = 0) is not shown as "0 of 0".
6. **`winsOf` and `winShareBreakdown` throw on a set that spans platforms or bases** (house style: a malformed input fails loudly). `wins.ts` exports exactly two functions and `breakdowns.ts` exactly one; both lists are asserted, so a pooling or per-period function cannot be added silently.
7. **`platformMonthView` is the one composition the surface and the report both read.** For a count basis (LinkedIn) it returns `typical: null` and `basis: 'count'`: a count is never described as a rate. The "unavailable by capability" state is NOT decided here; the callers read `metricsReadAvailableFor` (O2.4 and O2.10).
8. **View models carry template keys and params, never sentences.** The key names are fixed in `view-model.ts` (`analytics.typical`, `analytics.wins`, `analytics.state.thin`, `analytics.monthPair`, `analytics.monthPair.suppressed`, `analytics.exclusions`, `analytics.exclusions.{noDataReturned,fieldMissing,zeroImpressions,notFinal}`, `analytics.disclosure.{usual,usualUpdates,importSeed}`, `analytics.population.{aiOnly,allMeasured}`, `analytics.coverage`, `analytics.breakdown.row`, `analytics.interval`). **They are not in the locale files yet: O2.10 creates exactly these in en, pt and es** (hand-off; the key-parity test lands there).

**Redden transcript (each mutation applied, `lib/analytics` run, then restored byte-identical to a backup; baseline back to 170 passed):**

| Mutation | Tests that went red |
|---|---|
| a NULL `beat_baseline` coerced to a loss (the skip removed) | 4: the 4-of-6 literal, NULL-is-not-a-loss, the 6-against-7 test, the per-platform result |
| `formatRate(NULL)` returns `"0.0%"` | 1: NULL is no number |
| aggregate across platform and basis (one key) | 5: two results, no pooled group, same platform two bases, ordering, business B |
| mean instead of median | 8: the March, February, boundary and extreme-rate literals, the platform result, the typical and pair view models, the end-to-end view |
| a `delta` field on the month pair | 2 at runtime (the deep-key scan, the exact-keys test) and a `tsc` error (`delta` does not exist in `MonthPairView`) |
| `logLift` added to a view model and to the input type | 3 at runtime (the O2.1 scan #13 REAL TREE, the deep-key test, the type test) and two `tsc` errors (unused `@ts-expect-error`, unknown property) |
| a copy of `eligibleValue`'s logic instead of the call | 2: the call-arguments spy and the no-copy source check |

(The first attempt at the basis-pooling and NULL-coercion mutations did not apply or did not go red in the combined loop, so both were re-run alone with the mutated line printed first; the table is from the confirmed runs.)

**Verification (in the required order):** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 pre-existing warnings, none from `lib/analytics`); `npm run test:app` with the CI dummy env: 393 files, 6,065 passed, 1 todo (O2.2 was 386 and 5,934). `test:db` not run: no migration or DB behaviour touched. No ECC budget is allotted to O2.3.

### V.7 — O2.4: bounded, authenticated reads

**Shipped:** `lib/db/keyset-pager.ts` (`readAllPages`, `ReadCeilingExceeded`, `READ_CEILING` = 5,000, `keysetFilterDesc`); `lib/db/analytics-reports.ts` (`getReportByPeriod`, `getReportById`, `listReports`) and the `AnalyticsReportRow` type; and, appended to the existing per-table files, `listPublishedPostsInRange` and `countPublishedPostsInRange` (`posts.ts`), `listMonthOutcomes`, `listTrendOutcomes` and `listDimensionsForAnalytics` (`post-outcomes.ts`), `listMetricsForPosts` (`post-metrics.ts`), `listCompletedRetrospectivesInRange` (`campaign-retrospectives.ts`), `listAccountLabels` (`social-accounts.ts`). Every one takes `(client, businessId, ...)` and applies `.eq('business_id', businessId)` itself; none acquires the service-role client (the Tier-2 test mocks the factory to throw). `listTopPostMetrics`, `listCampaignRetrospectives` and every existing service-role reader are untouched, and nothing calls `listCampaignRetrospectives`.

**Closed:** #16 `ANALYTICS-AUTHENTICATED-READS` (Tier 2 recording client + the O2.1 scan half + Tier 1), #18 `ANALYTICS-BOUNDED-INDEXED` (Tier 2 + Tier 1 EXPLAIN), #36 `ANALYTICS-NO-SILENT-TRUNCATION` (Tier 2: a two-page median equals the unpaged median, 5,001 rows throw; plus Tier 1: a page size of 1, 2, 3 and 5 returns exactly what 500 returns, so the keyset `or()` filter is proven against real PostgREST).

**Decisions recorded (Builder choices inside the ADR, none architectural):**

1. **The ceiling is detected by asking for one row past it.** Each page requests `min(pageSize, ceiling + 1 - rows)`, so the database is never asked for more than 5,001 rows in total, exactly 5,000 rows return in full, and 5,001 throw. The throw is the only way out: there is no code path that returns a partial list.
2. **The cursor is a quoted PostgREST `or()`:** `published_at.lt."T",and(published_at.eq."T",id.lt."I")`, with `post_id` as the outcomes tie-breaker. Quoting keeps a timestamp's colons and sign out of the filter syntax; a double quote in a value is escaped.
3. **Explicit column lists, never `*`, wherever a sensitive or forbidden column exists:** `log_lift` is not selected from `post_outcomes`, `median_log_lift` not from `campaign_retrospectives`, no token or vault column from `social_accounts`, and no post text from `posts`. Every selected shape carries `business_id` (§9.3).
4. **A head count that comes back NULL throws** rather than reading as 0 (NULL is never zero).
5. **Id-list reads are chunked** (dimensions 200, metrics 120, labels 20), de-duplicated first, and each chunk carries its own business filter. The retrospectives read keeps the ADR's `completed_at DESC` exactly (no extra tie-break).
6. **`lib/outcomes/__tests__/no-cross-business.test.ts` is extended** with the four new readers that live in the modules it already enumerates (ADR §9.3); its completeness check turned red on them until they were added, which is the check working. The other new readers are covered by `lib/db/__tests__/analytics-reads.test.ts`, whose last test asserts that each of the eleven binds its business and that every query's select is followed by its business filter before the next select.
7. **Tier 1 runs the real readers through an authenticated client whose user OWNS BOTH businesses** (A and B), so only the explicit filter separates them. B's post, snapshot, report and account ids asked for under A return nothing, though RLS lets the owner read them.
8. **EXPLAIN uses the O2.2 technique:** the other business-id indexes are dropped inside a rolled-back transaction with `enable_seqscan` off, so the named index is used if and only if the reader's predicates imply its definition. The posts read names `posts_business_published_idx`; the month's outcomes read names `post_outcomes_business_platform_published_idx`.
9. **Environment note (not code):** `npx supabase status` fails on this machine with `EUNKNOWN uv_spawn`, so the local anon and service keys were minted (HS256, the GoTrue JWT secret read from the running auth container) for the Tier-1 runs. CI is unaffected.

**Redden transcript (each mutation applied with the changed line printed, the tests run, then restored byte-identical to a backup):**

| Mutation | Tests that went red |
|---|---|
| drop `.eq('business_id')` from `listPublishedPostsInRange` | Tier 2: 3 (the row-by-row filter test, the page-two test, the eleven-readers test). Tier 1: 3 (A's 13 posts, B's positive control, the metrics isolation test) |
| drop the `post_id` tie-breaker from the outcomes reader | Tier 2: 2 (the row-by-row test, the tie-breaker test) |
| raise the ceiling to 500,000 | Tier 2: 3 (the ceiling constant, 5,001 throws, never more than ceiling + 1 requested) |
| plant `components/analytics/Plant.tsx` importing `lib/supabase/service` | the O2.1 scan #16 REAL TREE, and the root tripwire (the root is no longer empty) |

(The first Tier-1 run of the first mutation was inconclusive: it ran with an abbreviated dummy environment and the suite failed in setup with every test skipped. It was re-run with the CI dummy values after a green baseline of 16, and the table is from that run.)

**Verification (in the required order):** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 pre-existing warnings, none from these files); `npm run test:app` with the CI dummy env: 395 files, 6,109 passed, 1 todo (O2.3 was 393 and 6,065); `npm run test:db` against the local stack (migrations of O2.2, not freshly reset because O2.4 adds no migration, no grant and no function): 121 files, 1,374 passed (O2.2 was 120 and 1,358). No ECC budget is allotted to O2.4.

### V.8 — O2.5: the plan gate and the loaders

**Shipped:** `hasAdvancedAnalytics(plan: unknown): boolean` in `lib/stripe/plan.ts` beside `getPlanCapabilities` (which is unchanged); `lib/analytics/load.ts` (`loadPortfolio(client, businessId, month, deps?)` and `loadPosts(client, businessId, filters, deps?)`); `utcIso` exported from `period.ts`. Tests: `lib/analytics/__tests__/load.test.ts` (40) and 17 added to `lib/stripe/plan.test.ts`.

**Closed (Tier 2):** #15 `ANALYTICS-ACCOUNT-SLICEABLE`, #20 `ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE` (the loaders never call `loadCampaignLearningView` or `unavailableMetricsPlatforms`: the O2.1 scan half walks `lib/analytics` and stays green). **Loader arms authored:** #5 (the capability decides the state, by injection) and #14 (the plan gate: a basic business never runs a Pro reader).

**The gate.** `hasAdvancedAnalytics` is true only for an own property of the capability table whose `advancedAnalytics` is true. `null`, `undefined`, `42`, `''`, `'PRO'`, `'enterprise'`, `{}`, `['pro']` and the inherited keys `constructor`, `__proto__` and `toString` are all false (a plain `CAPABILITIES[plan]` would have resolved the inherited ones). The loaders read the plan from the business row (`getBusinessById(client, businessId)`), never from the caller, and `assemble` is the one place a model is built: a basic model is cut down to the allowed tier on the server, and `BasicPortfolio` and `AdvancedPortfolio` form a union on `tier`, so a Pro key on a basic model does not compile (a `@ts-expect-error` test pins it).

**Decisions recorded (Builder choices inside the ADR, none architectural):**

1. **The Pro set is exactly:** the 12-month trend, the breakdowns (and `hook_type`, on the live page), the patterns, the retrospective verdicts across campaigns, and account against account. For a basic business none of these readers is called: `listTrendOutcomes`, `listDimensionsForAnalytics`, `countPublishedPostsInRange`, the patterns retrieval and the 12-month retrospective read. Tested by argument-recording fakes that assert each reader's calls are empty, and by the exact key list of the basic model.
2. **Patterns come through `@/lib/memory` (`retrieveOutcomePatterns`), injected as a dependency.** The guide names `listOutcomePatterns`, which is a `lib/db` reader the barrel does not export; the barrel's reader is the sanctioned route (MEM-NO-DIRECT-TABLE-ACCESS). It takes the business id and filters on it itself.
3. **A platform section exists for each platform the month has posts on.** `unavailable` carries only the publishing count and issues no outcome or metrics read; `immature` means every post is "not final yet" and none is measured; `measured` otherwise (a thin typical is the view model's own state). The empty state is the page's (`activity.total` is 0); an `error` state is a `ReadCeilingExceeded` on that platform's outcomes. A platform with posts only in the PREVIOUS month has no section.
4. **One outcomes read covers the month and the one before** (`published_at` in [previous start, month end)) and is bucketed by `monthOf`, so the month pair costs no second query. Only the current month's unmeasured posts get a metrics read, for the exclusion reasons.
5. **A snapshot whose dimensions are partly NULL is unclassified** (no `dimensions`), never a made-up bucket.
6. **The 12-month trend** is 12 head counts plus one outcomes read per measured RATE platform, drawn only for platforms present in the selected month (a business whose only X posts are older than the month has no X series there). A month below the floor is a thin point, never a zero.
7. **Account against account** is per platform and RATE basis; `comparison` is `bars` only with two or more accounts and 10 on every one, otherwise `counts`. An account row whose label cannot be read falls back to the "not recorded" key (it cannot be told from a removed account).
8. **`loadPosts` carries a `tier`** (read from the same plan) though post level is basic content: its rows are `unavailable` (capability false), `measuring`, `so_far` (raw counts, `finalOn` = `published_at` + 7 days in UTC), `final` (a rate token or a count, with `above`, `below` or `no_baseline`), or `not_measured` with the closed reason. Filters (platform, account with `none` for the NULL bucket, campaign) are applied after one bounded read.
9. **The campaign table** is activity plus the verdict and n worded with RetrospectiveCard's keys (`outcome.retrospective.verdict_supported`, `.verdict_not_supported`, `.inconclusive`, `.posts_beat`), each row linking to `/campaigns/[id]`; `inconclusive` states only its n, as the card does.

**Shared-function callers (re-run unmodified, counts against V.2):** `campaign-view.load.test.ts` 3 passed (V.2: 3), `campaign-view.test.ts` 11 passed (V.2: 11). `no-cross-business.test.ts` is now 37 (V.2: 33 plus the four readers O2.4 added). `loadCampaignLearningView`'s callers are unchanged: `campaigns/[id]/page.tsx` only.

**Redden transcript (each mutation applied with the changed line printed, tests run, restored byte-identical to a backup):**

| Mutation | Tests that went red |
|---|---|
| `hasAdvancedAnalytics` returns true for an unknown plan | 12 of the 12 unknown-plan gate tests, and the loader's unknown-plan tests |
| fetch the Pro data (dimensions) for a basic business, then drop it | 6: the basic-keys test and the five unknown-plan loader tests (the recording fakes saw the Pro reader called) |
| resolve the NULL account to the first known account | 2: the activity test and the NULL-bucket test |
| a `loadCampaignLearningView` call under `lib/analytics` | the O2.1 scan #20 REAL TREE |

**Verification (in the required order):** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 pre-existing warnings, none from these files); `npm run test:app` with the CI dummy env: 396 files, 6,166 passed, 1 todo (O2.4 was 395 and 6,109). `test:db` not run: no migration, grant or DB behaviour touched. No ECC budget is allotted to O2.5.

### V.9 — O2.6: the live surfaces, the nav and the shell fix

**Shipped:** `app/[locale]/(dashboard)/analytics/page.tsx` (portfolio), `analytics/posts/page.tsx`, one `loading.tsx` and one `error.tsx` (the segment's only Client Component; it renders the 8.2 error copy and a "Reload" control calling `reset()` and never reads the error object); `components/analytics/{shared,charts,PortfolioView,PostsView}.tsx` (synchronous Server Components: the translator is a prop, so every state renders to static markup under test); `lib/analytics/search-params.ts` (Zod on `month`, `platform`, `account`, `campaign`; an invalid value falls back, a business id in the query is not a recognised key) and `format.ts`; `i18n/{en,pt,es}/analytics.json`, registered in `i18n/request.ts`; `nav.team` in the three `common.json` files; the nav change in `DashboardShell.tsx` (`analytics` moved from `COMING_SOON_NAV` to `ACTIVE_NAV` directly after `campaigns`, `inbox` stays coming soon); and the shell fix (`min-w-0` on the main flex column, premise 6). The charts use the three A-3' packages, `@visx/scale`, `@visx/shape` and `@visx/group` (`^4.0.0`, the only dependencies added; scan #32 stays green); axes are plain SVG `<text>`. The design skills did not run (O2.10).

**Closed (Tier 2):** #4 `ANALYTICS-LINKEDIN-DISCLOSED`, #6 `ANALYTICS-FOUR-STATES`, #12 `ANALYTICS-COVERAGE-DISCLOSED`, #34 `ANALYTICS-A11Y-FLOOR`. **Authored:** #35's CI half (`nav.team` in three locales, and the nav order). The root tripwire in `source-scans.test.ts` now lists only `lib/reports`, `app/api/analytics`, `app/api/cron/generate-reports` and the email template as pending.

**What the tests prove (executed in CI):** each of empty, immature, unavailable, thin, loading, error, gated and populated renders its expected key AND its en literal; the LinkedIn sentence renders VERBATIM wherever a count is shown (a count fixture and a capability flip), is absent when LinkedIn is unavailable, and pt and es carry their own; every breakdown carries its population tag and its "Covers k of n" line, below 10 per side is counts with "Provisional" and no bar, and `hook_type` is absent until a value reaches 10; every chart is a `<figure>` with a real `<table>` and an `aria-describedby` that resolves to a summary filled from a closed template; the badge carries text and an icon; no figure holds a focusable element; no `⟦missing⟧` key renders in any of the three locales; the three locale files have identical keys and ICU placeholders and every key the view models emit resolves.

**Decisions recorded (Builder choices inside the ADR, none architectural):**

1. **Two view-model keys were renamed because a JSON object cannot be both a string and a parent:** `analytics.monthPair.suppressed` is now `analytics.monthPairSuppressed`, and `analytics.exclusions` is now `analytics.exclusions.summary` (V.6 item 8 listed the old names; the three locale files use the new ones).
2. **Copy beyond the ADR's literal list was authored by the Builder and is not counsel- or founder-reviewed:** the pt and es translations of the §8.2 states and of the LinkedIn sentence (ADR 0026 §10.2 gives English only), the `monthPairSuppressed` line, the Pro gated one-liners, the value labels (format, origin, length, call to action, opening) and the pattern-evidence line. The O2.10 copy lint (§8.4) runs over all of it.
3. **The loader gained two things the charts need:** `finalOn` on an immature platform section (the date in "Final for {count} posts on {date}") and, per trend point, the month's dots and numeric median and range (drawn only for a month that reaches the floor). The breakdown view model rows gained `share` and `bar` (numeric, for the bar and its whisker; the text carries the same figures as k of n).
4. **The breakdowns render under their own Pro heading, not inside the platform block**, so the order is exactly §10.1 (activity, results, campaigns, then trend, breakdowns, patterns, retrospectives, accounts). A basic business sees five gated one-liners and no chart, blur, number or dialog.
5. **The responsive table recipe is Tailwind-only:** full columns from `lg`, secondary columns (status, published; account, campaign) hidden below `lg` behind a `<details>` between 640 and 1024, and stacked labelled cards below 640 (`max-sm:` variants with `data-label`).
6. **The hidden chart tables sit in a clipped `<div class="sr-only">`.** A bare `<table class="sr-only">` ignored `overflow: hidden` and stretched the page (below). A Tier-2 assertion now pins the wrapper.

**Manual QA, recorded (UNPROVEN in the ADR 0015 sense: a browser run is never counted as COVERED).** Local stack seeded with the O2.1 fixture (`seed-live`), dev server against it (the Supabase variables overridden), signed in as the fixture owner (business A, Europe/Lisbon, Pro) in a Playwright-driven Chromium; the fixture was removed afterwards (0 users, 0 businesses). `scrollWidth` against `clientWidth` of the document element (clientWidth is 15 px under the viewport on this machine because of the scrollbar):

| Page | 1280 px | 640 px | 320 px |
|---|---|---|---|
| `/en/analytics?month=2026-03` (Pro) | 1265 / 1265 | 625 / 625 | **505 / 305 before the fix**, 305 / 305 after |
| `/en/analytics/posts?month=2026-03` | 1265 / 1265 | 625 / 625 | 305 / 305 |
| `/en/analytics?month=2026-03`, plan set to Plus | 1265 / 1265 | not measured | not measured |

At 320 px the campaign rows computed to `display: block` (stacked cards) and the chart SVG was 225 px wide; at 640 px the secondary table column computed to `display: none`. The Pro page showed the literal fixture numbers end to end (13 posts published, 5 the month before; X "7 posts measured. Typical engagement rate: 3.1% (range 0.0%–6.4%)", "4 of 6 posts beat your usual engagement", "7 of 10 posts measured. 3 not included: no data returned (1), a field was missing (1), zero impressions (1)", the NULL account bucket labelled "Account not recorded or since removed"). On Plus, five "Available on Pro:" sections and no figure. The posts page showed 13 rows with the badge text beside each rate, and the LinkedIn sentence of unavailability once. The browser console carried the same React hydration warning (a `className` on the root layout) on the untouched login page, so it is pre-existing and not from these surfaces. **Not checked:** dark-mode contrast (O2.10), a keyboard walk, pt and es in the browser, real print, `loading.tsx` and `error.tsx` rendered by Next (both are covered only by Tier-2 renders), and a viewport between 640 and 1024 beyond the computed styles above. `scrollWidth <= clientWidth` at 320 px therefore holds on the two pages measured, in one browser, and remains recorded rather than covered.

**Redden transcript (each applied with the changed line printed, tests run, restored byte-identical to a backup):**

| Mutation | Tests that went red |
|---|---|
| remove `state.thin` from the en file | 5: key parity, the emitted-keys test, the ADR 8.2 literals, the thin-state render, and the en no-missing-key render |
| paraphrase the LinkedIn sentence in the en file | 3: the verbatim assertion in the parity file, the portfolio render, the posts-table render |
| drop the first chart's `<table>` | 2: the every-figure-has-a-table test and the no-number-only-as-a-shape test |
| delete `nav.team` in the es file | 2: `nav.team` exists in three locales, and every nav key has a label in all three |

(The first attempt at the last mutation did not apply because the file is CRLF, and its re-run without the CI dummy environment failed at import; the table is from the confirmed run, after a green baseline of 11.)

**Verification (in the required order):** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 pre-existing warnings, none from these files); `npm run test:app` with the CI dummy env: 399 files, 6,228 passed, 1 todo (O2.5 was 396 and 6,166). `test:db` not run: no migration, grant or DB behaviour touched. No ECC budget is allotted to O2.6 (react-reviewer runs at the end of O2.10).

### V.10 — O2.7: the report assembler and generator

**Shipped:** `lib/reports/{constants,due,isolation,assemble,generate}.ts`; `lib/db/analytics-worker-reads.ts` (the worker's readers); in the existing per-table files, `insertAnalyticsReport` and `analyticsReportExistsForWorker` (`analytics-reports.ts`, service-role, lazy import, NO client parameter) and `isLiveForReports`, `getBusinessByIdForWorker`, `getTrialStartedAtForWorker` and `TRIAL_LENGTH_DAYS` (`businesses.ts`). `lib/analytics/load.ts` was refactored onto an injectable `Readers` object (`loadPortfolioWith`; `loadPortfolio` and `loadPosts` keep their signatures and bind the caller's authenticated client), and the dimensions and account-label readers now select and return `business_id`. Tests: 5 files under `lib/reports/__tests__`, `lib/db/__tests__/report-liveness.test.ts`, a fixture-driven fake in `lib/reports/__fixtures__/readers.ts`, and the Tier-1 `supabase/__tests__/report-generation.test.ts` (7). No migration, no SQL function: the SECURITY DEFINER audit gate inside `test:db` stays at 3.

**Closed:** #5 `ANALYTICS-UNAVAILABLE-FROM-CAPABILITY` (the assembler arm: flipping the capability by injection moves LinkedIn out of section 6 into the results as a count basis, and flipping it off for everything empties the results and section 5), #22 `REPORT-ONE-PER-PERIOD` (Tier 2: a second run returns `exists`, two overlapping runs give one `inserted = true`; Tier 1 on the live stack), #25 `REPORT-FALLBACK` (an unknown plan on a live business gets the basic report, never none), #27 `REPORT-RLS-ISOLATED` (Tier 2: every worker reader throws on one planted foreign row, and the generator inserts nothing; Tier 1: no B post, business, campaign or account id appears in A's stored payload, with A's own ids as the positive control), #31 `REPORT-METHODOLOGY-PRESENT` (all eight keys in every generated payload, the stub included), #40 `REPORT-ELIGIBLE-LIVE-ONLY`.

**Decisions recorded (Builder choices inside the ADR, none architectural):**

1. **One aggregation, two readers.** The assembler calls `loadPortfolioWith` over the VERIFIED service-role readers, so the report can never disagree with the live page about what a number is. It asks for a 6-month trend and no `hook_type`. The page binds the authenticated client; the worker binds `analyticsWorkerReaders()` (the same bodies, a service-role client acquired lazily inside `lib/db`) wrapped by `verifiedReaders`, which compares every returned row's `business_id` with the loop's and also refuses a call made with another id.
2. **The UTC condition is evaluated per business, not once for the tick.** ADR §5.2 says it "gates the tick"; a tick-wide "UTC day >= 10" would hold back a west-of-UTC business on UTC days 1 to 9 of a month whose local month is still the previous one. The same rule applied against each business's own M+1 is stricter where it matters and never later than the tick-wide form.
3. **`outcomes_through` and `generated_at` are the instant of generation**, set once and passed to every read. A later tick therefore says a later "measured as of"; the late-outcomes key carries the same instant.
4. **Eligibility is the O-2 ruling, written once:** a live trial is `plan = 'trial'`, a started clock and under 14 days (a never-started clock gets no report and no stub); a live paid business has a non-null subscription id; an unknown plan with a subscription is live and basic. `clearBillingOnCancellation` leaves `plan = 'trial'` and a null subscription, so a cancelled business is live only if its trial clock is still inside 14 days: an accepted edge.
5. **Section 5 is per RATE platform with at least 5 measured posts, ranked by `post_outcomes.value` DESC, ties by `published_at` DESC, then post id.** A count basis is never ranked and nothing is pooled. It is named `ratedPosts` (keys `analytics.report.ratedPosts.title` and `.caveat`), not `topPosts`: the title is by the closed key, and no identifier on this path says "top" or "best". Each cited post is exactly `{ postId, rate, badge }`.
6. **A read over its ceiling FAILS that business's report** (activity, posts, campaigns, a platform's outcomes, the trend or the patterns): nothing is stored and the next tick retries. A Pro section is absent from a basic payload (no key), not empty.
7. **The tick** pages candidates by id (100 a page, scan cap 2,000) and generates at most 25 per tick; an error counts toward that cap so a failing business cannot starve the others, is captured (Sentry) with its business id, and never fails the tick. It returns the ids whose NON-stub report was inserted: O2.8 enqueues their email. A stub is inserted and listed in no email.
8. **The `analytics.report.*` keys** (`header`, `stub`, `ratedPosts.title`, `ratedPosts.caveat`, `lateOutcomes`, `methodology.{median, maturity, exclusions, usual, floors, xOnly, descriptive, engagementOnly}`) are fixed in `lib/reports/constants.ts` and are not in the locale files yet: O2.8 writes the copy in en, pt and es.

**Redden transcript (each applied with the changed line printed, tests run, restored byte-identical to a backup):**

| Mutation | Tests that went red |
|---|---|
| skip a mismatched row instead of throwing | 6: the throw-on-one-foreign-row test, the missing-business_id test, every-reader-throws, the assembler and generator planted-row tests, the tick capture test |
| take the tier from the payload (advanced regardless of the plan) | 6: live trial basic, unknown plan basic (generator and assembler), the stored-tier test, Plus basic, trial basic |
| generate M-2 (`previousPeriod` twice) | 9 or more: every due-rule test with a period, the M-2 test, the generator's March and stub tests |
| drop the UTC condition | 4: Lisbon midnight on day 10, Auckland, Sao Paulo, and the generator's Auckland test |
| rank section 5 by recency instead of the day-7 value | 1: the ranking unit test (the fixture's top three are also in date order, so the end-to-end literal does not catch it; the unit test with ties and a count row does) |

**Verification (in the required order):** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 pre-existing warnings, none from these files); `npm run test:app` with the CI dummy env: 404 files, 6,304 passed, 1 todo (O2.6 was 399 and 6,228); `npm run test:db` against the local stack: 122 files, 1,381 passed (O2.4 was 121 and 1,374; not freshly reset because O2.7 adds no migration, grant or function). No ECC budget is allotted to O2.7 (security-reviewer runs at the end of O2.9).

### V.11 — O2.7b: `/api` no longer goes through locale routing (O-1)

**Closes no ADR 0031 constraint.** It is a prerequisite of O2.8 (the cron route) and O2.9 (the PDF route); the "a step that closes no constraint does not exist" rule is waived for it by founder ruling O-1.

**Defect (read from the code, V.1 item 1):** `proxy.ts` matched `/api/*` and ran `handleI18n`; with `localePrefix: "always"` next-intl answers `/api/x` with a 307 to `/en/api/x`, which does not exist. The login guard was never involved (its regex needs a two-letter first segment).

**Fix:** after `updateSession`, a request whose path is `/api` or starts with `/api/` returns the session response directly. The session refresh still runs, so cookie-authenticated routes (the PDF route, any `/api/analytics/*`) keep their refreshed cookies. Locale routing, the login guard, `x-pathname`, the nonce and the CSP are skipped: they are properties of rendered HTML pages. Each route owns its own authentication. The matcher is unchanged on purpose: excluding `/api` there would also drop the session refresh.

**Tests (Tier 2, `lib/i18n/proxy-api.test.ts`, 11):** five `/api` paths are not redirected and never reach next-intl (the mocked handler redirects like the real one); the session is refreshed once and its cookie is on the response; no CSP header and no nonce on an API response; `/apix/foo` and `/en/api/foo` are NOT treated as the API; and the page behaviour is unchanged (a bare path still locale-redirects, an unauthenticated dashboard path still goes to login). Mutation: disabling the branch turns 5 red; restored byte-identical, 11 green.

**UNPROVEN, not COVERED:** a real HTTP request to a running server returning the route's own status instead of a 307 has not been made. The unit tests prove what `proxy()` returns; they do not prove Next.js applies it in front of a route handler. This is the real-request proof ADR 0015 asks for and it is owed (the first `curl -i` of `/api/cron/generate-reports` against a dev server). Production reachability of the existing cron, webhook and OAuth routes before this fix is also unverified, and is a launch-checklist fact to check on a preview deploy.

**Verification run:** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint proxy.ts lib/i18n/proxy-api.test.ts` clean; `npx vitest run lib/i18n/proxy-api.test.ts lib/i18n/proxy-locale.test.ts` green. The full `npm run test:app` was NOT re-run for this commit: the CI dummy env was not available in this session, so suites that load config fail at import and prove nothing.

### V.12 — O2.8: the report pages, the email, the recipients, the setting and the cron route

**Closes:** #8 ANALYTICS-N-SHOWN, #9 ANALYTICS-NO-CAUSAL-COPY, #17 ANALYTICS-TENANT-BOUNDED (Tier-2 half; the Tier-1 half is O2.4/O2.7), #23 REPORT-MEMBERS-ONLY (Tier 2 + scan), #42 REPORT-EMAIL-SETTING-ADMIN-ONLY (narrowed to OWNER by ruling O-3).

**Built.**
- `resolveReportRecipients(businessId, setting)` in `lib/db/business-members.ts` (service-role, lazy import, no client parameter): ONE business, status `active`, `user_id` not null; `admins` is the admins (owner included), `all_members` widens, `off` and any unrecognised value return nobody without a query. Selects `id, email` only; ordered by `created_at`, limited to 200.
- `lib/reports/deliver.ts`: enqueues one `monthly-report` per resolved member; recipient read off the member row; dedupe token `report:{YYYY-MM}:{member id}`; resolver called immediately before the enqueue; one failing member is captured and the rest proceed. The email carries the stored summary sentences rendered through the report's own closed templates in `businesses.language`: no figure of its own, no attachment.
- `lib/reports/job.ts` and `app/api/cron/generate-reports/route.ts`: the tick, then delivery for exactly the reports the tick INSERTED and that are not stubs (`ReportTickSummary.insertedReports`, additive beside `insertedBusinessIds`); Sentry monitor `generate-reports` (`20 * * * *`); the dual QStash/bearer auth copied from extract-outcomes; ONE `report.tick` line of counts only (a throwing job logs `null` counters and `errors: 1`, never a fabricated 0).
- `monthly-report` kind: the template, registry entry, `email.json` in en/pt/es, the `EmailKind` unions widened in `lib/email/types.ts` and `lib/db/types.ts` (founder ruling); the subject is built from a template key with CR, LF and line separators stripped from every interpolated value.
- The pages `/analytics/reports` (newest first, at most 24) and `/analytics/reports/[period]` (Zod period; the business is the session business; another business's period, an unknown period and a payload schema this build does not read are all `notFound()`); the synchronous `ReportBody` (the ONE component O2.9's PDF reuses); a print stylesheet (page breaks before the trend and the methodology, no nav, no actions: `print:hidden` on the shell sidebar and top bar).
- The report-email setting: `setReportEmailAction` (reads only `setting`; the business from `getBusinessForUser`; owner re-checked; `updateBusiness` on the authenticated client) and its `useActionState` form, the second client island. Non-owners read the value in words.
- `analytics.report.*` copy in en, pt and es, including the eight methodology keys; a link from `/analytics` to the list; the launch-checklist row and the log-line check for `generate-reports` (A-7), ordered after extract-outcomes.

**Decisions and adaptations (Builder).**
- `ReportBody` takes `{ t, locale, timezone, payload, proAllowed }`, not the guide's `{ viewModel, messages }`: the codebase passes a translator function, and `proAllowed` is the CURRENT plan's gate (A-5), never the payload tier. A stored Pro report on a plan that no longer allows Pro shows the plain "Available on Pro" line; a basic report on a Pro plan says it was generated before the plan included the section and invents no number.
- Scan #23 fixes the literal shape `const x = await resolveReportRecipients(` / `for (const member of x)` / `recipient: member.email`, so the delivery module calls the resolver directly and its tests `vi.mock` the modules; the delivery lives in `lib/reports` (a scanned root) on purpose.
- The copy lint (`lib/analytics/copy-lint.test.ts`) holds the six §8.4 classes in three locales, whole-word and Unicode-aware, over the message files, the email strings, the RENDERED `ReportBody` of six fixture cases in each locale (Pro, downgraded, basic on Pro, basic on basic, February, the stub) and the rendered email. TWO named exemptions: the key `interval` ("likely between"), and, for the rendered check only, `outcome.role.customer_proof` (es "Prueba de cliente": the false positive §8.4 predicted; the class is not loosened and a test proves the exemption live and that "prueba" elsewhere is still caught). The n-rule exempts `posts.value.rate` (one post, n = 1).
- The guide's redden step "plant boost in pt" was a wrong instruction: "boost" is an English term in the class table. The lint was proven red with "melhorou" (pt) and "will" (en) instead.
- `lib/interview/__tests__/source-scans.test.ts` pinned `EmailKind` to six; it now pins the six plus `monthly-report`, so any further kind still fails (the interview adds none).

**Redden transcript (each applied with the changed line printed, the owning test run, restored byte-identical):**

| Mutation | Result |
|---|---|
| read the report by the URL period in place of the session business | 4 red (reports-pages) |
| recipient taken from the business id, not the resolver | the scan #23 real-tree test red |
| plant "melhorou" in pt / "will" in en | copy-lint red on `causal` / `prediction` |
| drop the owner re-check from the action | 1 red (actions) |
| ignore `proAllowed` in the body | 2 red (report-body) |
| drop the `status = active` filter | 3 red (recipients) |
| dedupe token by email in place of the member id | 1 red (deliver) |

**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 warnings, none new); `npm run test:app` with the CI dummy env: 414 files, 6,469 passed, 1 todo. **`npm run test:db` was NOT run:** the local Supabase stack was not running this session and there is no migration since O2.2. O2.8 adds no Tier-1 test; the Tier-1 halves of #17 and #42 are O2.2, O2.4 and O2.7's.

**UNPROVEN, not COVERED:** the report pages and the setting form have not been seen in a real browser (1280/640/320, dark mode, keyboard, real print), and the email has not been rendered through the real request config (see the finding below). The `/api` real-request proof (V.11) is still owed.

**FINDING, NOT FIXED (outside O2.8, affects every email kind):** `i18n/request.ts` does not load `email.json` or `invite.json`, so `renderTemplate` (`getTranslations({ namespace: 'email' })`) would resolve no messages in a running server and return raw keys (`email.team_invite.subject`). Confirmed at the library level (`createTranslator` with a missing namespace returns the key plus `MISSING_MESSAGE`); not confirmed in a running server. The email tests build their own dictionary and cannot see it. This is a launch-checklist candidate and is raised to the founder; the monthly-report email inherits it.

### V.13 — O2.9: the security review (ECC budget invocation 3 of 4)

(The build guide says to record this as "V.5"; V.5 is O2.2's, so it continues the numbering.)

**Scope read by `ecc:security-reviewer` (read-only, one dispatch):** `git diff cb0f96e72..HEAD` (O2.7b and O2.8) and the uncommitted O2.9 files directly (`lib/reports/pdf*.ts`, the PDF route, the `next.config.ts` diff), plus `isolation.ts`, `generate.ts`, `job.ts`, `deliver.ts`, `analytics-reports.ts`, `resolveReportRecipients`, the `monthly-report` template, the cron route, the reports pages, the setting action, `ReportBody`, `ReportEmailForm` and `proxy.ts`. It did not read `assemble.ts`, `analytics-worker-reads.ts` or the ADR text, and it ran nothing.

**Its question:** can any path mix two tenants, take a recipient or business from input, reach Chromium before auth, fetch anything from inside Chromium, or emit an unescaped customer string into the page, the email or the PDF? **Answer: nothing found in categories 1 to 5 and 8** (tenant mixing; recipient or business from input; Chromium before auth, business and plan; Chromium fetch or script; unescaped output; non-owner setting change and unauthenticated cron). The report-id enumeration question: a foreign and an unknown id take the same path and the same 404, no timing difference seen; 401 after the uuid check reveals nothing. `proxy.ts`'s `/api` early return keeps the session refresh and skips only locale routing, the login redirect and the CSP, which are for HTML pages.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | MEDIUM, CONFIRMED | `lib/reports/pdf.ts`: a timeout that fires DURING `launch()` closes nothing (the browser is still null); when the launch later resolves the work carries on, its `finally` closes only the context, and an orphan Chromium runs beside the next render, breaking concurrency 1. | **FIXED.** A `settled` flag set in the outer `finally`; a launch that resolves after it is closed at once and the work throws. Test: a launch released after the deadline logs `browser:close` and never `context:new` or `setContent`. Mutation (remove the guard) turns it red. |
| 2 | LOW, CONFIRMED | No per-user rate limit: one member can hold all three slots (1 running + 2 waiting) of an instance for up to 25 s each; the HTML build and CSS compile ran before the queue. | **PARTLY FIXED:** the route now asks `pdfQueueFull()` BEFORE building the document or compiling CSS and answers 503 + `Retry-After` (test asserts `buildReportHtml` was not called; mutation red). The per-user limit stays the accepted residual risk `S37-PDF-RATE-LIMIT` (backlog) plus the Vercel Firewall rule (launch-checklist). |
| 3 | LOW, CONFIRMED | `TenantMismatchError` names both business ids; the report job sends business ids to Sentry (`extra`). Ids only, never content or addresses; the throw path is the leak path. | **ACCEPTED, recorded here:** the ids are what makes a leak debuggable. No content, address or token is ever in them. |
| 4 | LOW, PLAUSIBLE | The PDF route captures a render error to Sentry; Sentry's request data carries the URL, which holds the report id; a protocol error that echoes page content is possible. | **ACCEPTED, tracked:** the capture is tagged and carries no report data from our side (test pins it). Scrubbing `event.request.url` for this route is the follow-up if Sentry shows echoed content. |
| 5 | LOW, PLAUSIBLE | `resolveReportRecipients` reads `business_members.email`, the member row's own copy, which could be stale after an account email change. Never from input: a correctness risk, not an injection one. | **OPEN, to confirm:** whether that column is kept in sync with `auth.users` on an email change. Filed for the next touch of the members flow; not changed here. |
| 6 | INFO, CONFIRMED, not exploitable | `oneLine` stripped CR, LF, LS and PS only. The subject interpolates only our own month label and Resend is called over JSON. | **FIXED anyway** (cheap): every C0 control, DEL, NEL, LS and PS are stripped; test and mutation. |

**Also noted by the reviewer:** `getBusinessForUser` binds a multi-business user to ONE business (the codebase-wide convention), so there is no cross-tenant risk but also no switcher in these routes; and `/api` responses no longer get the CSP, which matters only for an API route that returns HTML (none in scope does).

### V.14 — O2.9: the PDF route and the Chromium hardening

**Closes (Tier 2):** #14 ANALYTICS-PLAN-GATE-SERVER (third arm: the PDF), #29 REPORT-OUTPUT-ESCAPING, #30 REPORT-PDF-ISOLATED.

**Built.**
- `GET /api/analytics/reports/[id]/pdf` (Node runtime). The order IS the argument: uuid (404), authenticate (401), the session business (404), the report by (that business, the id) (another business's id is the same 404 as an unknown one), the schema version and period (404), the CURRENT plan (A-5), the queue check (503), the document, and only then Chromium. No path, query, header or cookie is ever handed to the browser; the response is the bytes with `attachment`, `private, no-store`, `nosniff`, and nothing is stored.
- `lib/reports/pdf.ts`: the sealed render behind an injected launcher: a FRESH context closed in `finally`; JavaScript disabled before any content; request interception on and EVERY request aborted (no allow-list, not even the document or a `data:` URL); `setContent` only; a 25 s hard timeout over the whole render including the launch, which also kills the browser; concurrency 1 per instance with at most 2 waiting (a fourth is refused, `PdfBusyError`).
- `lib/reports/pdf-html.ts` and `pdf-css.ts`: the SAME `ReportBody`, rendered with `renderToStaticMarkup` (`await import`, per V.3), into a document with the CSP meta (the ADR text verbatim), a whitelisted `lang`, an escaped `<title>` and one inline `<style>`. The stylesheet is compiled per request with `tailwindcss`' own `compile()` (a declared dependency; no PostCSS, no new package beyond ruling A-3') for ONLY the classes in the rendered markup, from tailwind's theme, preflight and utilities plus the `@theme inline` and `:root` blocks of `app/globals.css`, so a token changed for the page changes the PDF. Only those four files can be read by the compiler (`loadStylesheet` refuses anything else, `loadModule` always throws), candidate classes with markup characters are dropped, and output containing a closing tag is refused.
- `lib/reports/pdf-launch.ts`: the only place Chromium launches. `launchChromium` uses the bundled binary and takes no environment or request input; `launcherFor(path)` exists for a developer or a script and the route never calls it.
- `puppeteer-core` ^25 and `@sparticuz/chromium` ^153 (the two ruling A-3' packages; scan #32 passes); `next.config.ts` marks both server-external and traces the files the route reads with `fs` (tailwind's CSS, `globals.css`, the Chromium archives).
- The plan gate on the PDF path: the route renders the STORED payload and recomputes nothing (the `loadPortfolio` and `loadPortfolioWith` spies are never called), and a plan without Pro (a downgrade, or an unknown plan, failing closed) gets the plain "Available on Pro" lines and none of the Pro content.
- `docs/launch-checklist.md`: the Vercel Firewall rate-rule row for the PDF route (A-7, not ordered against the cron rows) and the preview-deploy check; `docs/backlog.md`: `S37-PDF-RATE-LIMIT` with its un-defer trigger.

**A finding of the real-browser spike that changed the design (record, not an ADR change).** The shared report tree contained two client-boundary modules, `lucide-react` (the result badge icons) and `next/link`. Under `react-dom/server` inside a route handler they are client references and cannot be invoked: the first run failed with "Attempted to call the default export of lucide-react Icon.mjs from the server". vitest renders do not expose this; only a real `next dev` and a real request did. Fix, keeping ONE component: the badge icons are inline SVGs of lucide's arrow-up, arrow-down and minus geometry, and `ReportBody`, `CampaignsSection` and `GatedSection` take an optional `plain` flag (default false: the live pages render as before) that renders links as plain text, which is also the right thing in a forwarded document. The PDF passes `plain: true`.

**Real-browser transcript (a temporary scratch route in a real `next dev`, local Windows Chrome via `launcherFor`; deleted, never committed).** Clean report: 36.9 KB of HTML with the inline stylesheet, a 79 KB PDF starting `%PDF-`, 0 blocked requests. Hostile RAW markup injected after React's escaping (an `<img>`, a `<link rel=stylesheet>` and a `<script>` that calls `fetch`) against a listening server: WITH the CSP, 0 requests reached even the interceptor; WITHOUT the CSP, the interceptor aborted exactly the image and the link and the script never ran (JavaScript off); the server counted 0 hits in every run. Each layer holds on its own. A screenshot of the same HTML showed the tokens, tables, badges and SVG charts rendering as on the page.

**Redden transcript (each applied with the changed line printed, the owning test run, restored byte-identical):**

| Mutation | Result |
|---|---|
| launch Chromium before authentication (the guide's "launch before the plan check") | 11 red (route) |
| let a non-http request through the interception (the guide's "allow one image request") | 1 red (pdf) |
| remove the CR/LF strip | 2 red (template) |
| remove the late-launch guard | 1 red (pdf) |
| remove the early queue-full refusal | 3 red (route) after the test was made discriminating: the first version stayed green because `renderPdf` refuses with the same 503, so the test now asserts `buildReportHtml` was not called |
| remove the CSP meta | 1 red (escaping) |
| leave JavaScript enabled | 1 red (pdf) |

**Found by a test during the build (fixed):** the CSS compiler was first cached at module level. Tailwind's `build()` is incremental and remembers every candidate, so one refused candidate would have poisoned every later render and classes would have leaked between requests. It now compiles fresh per request and caches only the input text; a regression test asserts one request's classes are absent from the next.

**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 warnings, none new); `npm run test:app` with the CI dummy env: 417 files, 6,526 passed, 1 todo; the O2.1 scans now cover `app/api/analytics` and the PDF modules (`EXPECTED_PENDING` is empty). `npm run test:db` was NOT run (no DB behaviour touched; no migration since O2.2).

**UNPROVEN, not COVERED:** `@sparticuz/chromium` on Vercel's Linux runtime (cold start, memory, the traced files) until a preview deploy; the Vercel Firewall rule (dashboard, never CI); the report pages, the setting form and the PDF as seen in a browser at 1280/640/320, dark mode and keyboard (O2.11); real print fidelity of the PDF over multiple pages (the screenshot showed one tall page; page breaks rely on `break-before: page` in the stylesheet); the `/api` real-request proof (V.11) and the email namespace finding (V.12) remain open.

### V.15 — O2.10: the design pass

**Closes (Tier 2):** #33 `ANALYTICS-I18N-COMPLETE`: key parity en, pt and es across the analytics namespace (the report namespace included), the monthly-report email strings and the nav. The design pass added ONE key, `analytics.report.actions.pdf` ("Download PDF", "Transferir PDF", "Descargar PDF"), to all three locales in the same change; `lib/i18n/analytics-parity.test.ts` (identical keys and ICU placeholders) and the §8.4 copy lint were re-run green over the final tree, and the worst-case tests render every surface in all three locales with no missing key. The design-quality floor (focus, targets, hierarchy, print, worst-case data) is proven in MARKUP only; the layout half is UNPROVEN until O2.11.

Five skills ran in the guide's order, each against its named part of §10. Every suggestion that needed something the ADR forbids was overruled.

| Skill | Against | What changed | Overruled or declined |
|---|---|---|---|
| `/taste-skill` | §5.3, §10.5: the report as a document | Larger month heading and a quiet meta line; summary set at reading size in a 65ch measure; a hairline above every section and one step larger section headings (arbitrary variants scoped to the report article, so the live pages are untouched); generous rhythm; headings kept with their content in print; the methodology set as a muted footnote. Tailwind and existing tokens only. | The skill is for landing pages: its hero, bento, motion, marquee and image rules were not applicable and not applied. |
| `/impeccable` | §10.1, §10.2, §8.2, §10.6 | A full-contrast focus indicator (`FOCUS`) on every control; the "Details" disclosure made a 24 px target; **the report page's Download PDF action** (§10.1) added as a plain `<a download>` to the route, from the loaded row's own id, outside `ReportBody` and `print:hidden`, with the copy in en, pt and es. | **Print** is NOT built as a button: `window.print()` needs a client island and §10.6 allows exactly two. The browser's own print works with the print stylesheet. A recorded deviation from §10.1. The skill's "update to v4.5.0" prompt was not acted on. |
| `/ui-ux-pro-max` | §10.3: chart palette, type scale | **Measured** WCAG contrast from the oklch tokens in both themes (marks 4.5 to 19, 7.6 to 16; `muted-foreground` text 4.53 light, 7.63 dark): the palette PASSES and was not changed. The faint light axis baseline (`border`, 1.21) now uses `muted-foreground` (4.53); the smallest chart labels went from 9 and 10 to 11 and 12 units. | No new colours, fonts or palette. Making the sr-only chart tables visible below 640 px (the real fix for the illegible labels at 320) needs real-browser layout verification; an earlier sr-only table overflow was exactly the 320 px regression, so it is deferred to O2.11 as a MEASURED finding: at 320 px the 640-unit SVG renders at about 0.45 scale (labels about 5 px); the table is the text alternative and no number exists only as a shape. |
| `/emil-design-eng` | the final polish | A hover state and an instant pressed state (`active:opacity-80`) on every button and the Download PDF link; `disabled:cursor-not-allowed`; `hover:text-foreground` on the disclosure; print: rows and charts kept whole and sub-headings kept with their content. | No transition, no scale-on-press, no entrance animation: §10.6 says no animation by default, and the constraint set allowed only gated colour or opacity changes. |
| `/break-ui` | worst-case data | Run as Tier-2 vitest (`components/analytics/worst-case.test.tsx`, 33 tests), NOT as a demo toggle (no demo surface in product code). Real components and the real en, pt and es translators over the real loader's portfolio with the customer-supplied values replaced: a 120-character campaign name, a 60+ character unbreakable handle, one-letter, Japanese, Arabic and emoji names, null names and labels, 1,000,000 and 0 counts, zero posts, 1,000 posts rows. | Fixed what it exposed (below). |

**What `/break-ui` exposed, and the fix (Tailwind and attributes only):** table cells holding customer strings could not shrink or break (`TABLE.cell` is now `min-w-0 wrap-anywhere`); activity lines, pattern text and the report header line likewise (`wrap-anywhere`); an empty campaigns list rendered a table with a header and nothing under it (the section is now omitted); customer names had no direction (`dir="auto"` on campaign and account names); a filter `<select>` sized itself to its longest option, which is a customer name (`max-w-full`).

**A real PDF bug the work found (fixed):** React writes `&` in an attribute as `&amp;`, and `extractClasses` fed Tailwind the raw text, so every arbitrary-variant class (`[&_section]:border-t`, `print:[&_tr]:break-inside-avoid`) was a candidate that matched nothing and its rule silently vanished from the PDF only (the browser decodes the entity, so the page looked right). `extractClasses` now decodes `&amp;`; tests assert the decoded tokens and that the compiled PDF stylesheet really contains the section hairline and the print break rules.

**Redden transcript (each applied, the owning test run, restored byte-identical):** cells that cannot shrink: 4 red; the empty campaigns table back: 1 red; `dir="auto"` removed: 1 red; the entity not decoded: 2 red; the select unbounded: 1 red; the Download PDF link built from the URL period: 2 red; the button focus style removed: red after the first version stayed green (the portfolio render holds no button; the test now renders the month picker).

**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npx eslint .` 0 errors (113 warnings, none new); `npm run test:app` with the CI dummy env: 419 files, 6,568 passed, 1 todo. `test:db` was NOT run (the local stack is down; no migration since O2.2).

**UNPROVEN, not COVERED (all of it is O2.11):** the real layout at 1280, 640 and 320 px (the markup tests prove a string CAN shrink and wrap, not that every box fits), 200% zoom, dark mode, RTL, the keyboard walk, the visual focus ring, print fidelity over several pages, and the PDF as a document. The new `listReportIndex` jsonb-path select (`stub:payload->>stub`) is proven against a fake builder only, not against a live PostgREST.

### V.16 — O2.10: the React review (ECC budget invocation 4 of 4)

**Scope read by `ecc:react-reviewer` (read-only, one dispatch):** the working-tree files of `app/[locale]/(dashboard)/analytics/**` (error, reports page, `[period]` page, actions), `components/analytics/**` (ReportEmailForm, charts, shared, ReportBody, PortfolioView, key lines of PostsView), the head of `lib/reports/pdf-html.ts` and the PDF route by grep. It did not read the committed range, `git diff`, `analytics/page.tsx`, `posts/page.tsx`, `loading.tsx` or most of PostsView.

**Its question:** is any component a Client Component that need not be; does any receive more data than it renders; is any chart a focus trap or colour-only; does anything break the Base UI rules (`asChild`) or the Server Component default? **Answer: nothing found** in any of those; no hook in the shared report tree (so nothing that would break `renderToStaticMarkup` in the PDF route); only `ReportEmailForm` and `error.tsx` are `use client`; the form's props are the Server Action, a three-value union and strings only; `useActionState` is correct; the form's label, description and live region are right; all three `Link` call sites in the report tree are guarded by `!plain`; `dir="auto"` and `wrap-anywhere` are valid; the Download PDF anchor takes its id from the loaded row.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | LOW, CONFIRMED | `reports/page.tsx` called `listReports` (`select('*')`), loading the full payload of up to 24 reports for a page that reads one flag. Server-only over-fetch; nothing reaches a client island. | **FIXED:** a new `listReportIndex` selects `id, period_month, stub:payload->>stub` (same filter, order and bound), so the payload never leaves the database. Unit-tested against a fake builder; **UNPROVEN against a live PostgREST** (a Tier-1 read test would prove the alias and the text-to-boolean mapping). |
| 2 | LOW, CONFIRMED | The "Saved." message in the report-email form is not cleared when the owner edits the select afterwards. | **ACCEPTED:** clearing it needs a third piece of client state in the island for one live-region message; the next save or error replaces it. |
| 3 | LOW, CONFIRMED benign | `key={line.key + i}` (summary list) and `key={i}` (chart dots) on lists derived from an immutable stored payload. | **LEFT:** no state can attach to the wrong item. |
| 4 | LOW, PLAUSIBLE | `months[0]` and `points[0]` in the chart components throw on an empty array; the invariant (a fixed-length loop) lives in the loader. | **LEFT:** guarding it would duplicate the loader's invariant; revisit if the window ever becomes configurable. |

### V.17 — O2.11: real-browser verification (the build guide's "V.7"; V.7 is taken)

**Recorded, never counted as COVERED.** Chromium (Playwright) against `next dev -p 3100` (Turbopack) on Windows 11, backed by the local Supabase stack (db, rest, auth, kong; all 129 migrations applied), the O2.1 fixture seeded with `seedPortfolio`. Business A is Pro (Lisbon, `en`), business B is Plus (São Paulo, `pt`). Both locales were driven at every width, so the pt pass is real (premise 8: `QA-LOCALE-HEADER-DROPPED` is fixed by `2f2b33676`). Screenshots are under `docs/reviews/assets/session-37/` (26 files).

**Setup facts a reader needs.**

- The fixture businesses were made *eligible* for a report on the local database only: `trial_state.trial_started_at` set, a dummy unique `stripe_subscription_id` on each business. Reports for 2026-03 were then generated with `generateReportForBusiness(id, FIXTURE_NOW)` (A: `advanced`, B: `basic`). None of this is in a migration or a fixture file.
- The UI cannot reach business B: `getBusinessForUser(client, user.id)` is called with no preferred business, so it returns the first owned business by `created_at, id`. B was reached by moving B's `created_at` earlier on the local database for the Plus pass and moving it back. There is no active-business selector today (open item, not an analytics defect).
- `document.documentElement.scrollWidth` reads the viewport width minus the 15 px vertical scrollbar on any page that scrolls, so a value of 1265, 625 or 305 means "no horizontal overflow, page scrolls vertically" and 1280, 640 or 320 means the page fits without scrolling.

**`scrollWidth` table.** Identical in `en` and `pt`; every cell is at or below its viewport. Business A: 54 page × width × locale cells, then 48 re-measured after the fixes below. Business B: 42 cells, 28 of them (320 and 640) repeated after the fixes.

| Page | 1280 | 640 | 320 |
|---|---|---|---|
| `/analytics?month=2026-03` populated (A: all sections; B: gated, LinkedIn unavailable) | 1265 | 625 | 305 |
| `/analytics?month=2026-04` immature (A) | 1265 | 625 | 305 |
| `/analytics?month=2026-01` thin (A) | 1265 | 625 | 305 |
| `/analytics?month=2026-02` (A, B) | 1265 / 1280 | 625 / 640 | 305 / 320 |
| `/analytics?month=2026-10` empty (A, B) | 1280 | 640 | 320 |
| `/analytics/posts?month=2026-03&platform=linkedin` filtered (A, B) | 1280 | 640 | 305 |
| `/analytics/posts?month=2026-03` (A, B) | 1265 / 1280 | 625 / 640 | 305 |
| `/analytics/reports` (A, B) | 1280 | 640 | 320 |
| `/analytics/reports/2026-03` (A, B) | 1265 | 625 | 305 |
| Error boundary, `/analytics` and `/analytics/posts` (A) | 1280 | n/a | 320 |
| Dark (`.dark` on `<html>`), `/analytics?month=2026-03` (A) | 1265 | n/a | 305 |
| Print media, `/analytics/reports/2026-03` at 794 px (A4) | 779 | n/a | n/a |

**Result for constraint #35 (ANALYTICS-SHELL-320, manual half): no 320 px `scrollWidth` exceeds 320, on any page, in either locale, in either plan, in dark mode or in the error state. #35 is closed.** This measures the document. It does not see content clipped by `overflow: hidden`, which is why the screenshots were read as well (see the findings).

**States seen at least once.** Populated (A), immature (A, 2026-04), thin (A, 2026-01, and per account in A), empty (A and B, 2026-10), unavailable (LinkedIn, A and B), gated (B: every Pro section renders the "Available on Pro" line with a link), error (below), report (A advanced, B basic).

**Error** was forced two ways. Stopping the PostgREST container gives the app-wide "Something went wrong" page, because the dashboard layout fails before the analytics segment does; that is the shell's boundary, not ours. Revoking `SELECT` on `post_outcomes` from `authenticated` (restored afterwards; grants verified identical) fails only the analytics reads and renders `analytics/error.tsx` inside the shell: "We couldn't load your results." with a Reload button, in `en` and `pt`, HTTP 200, no table name, no database wording, no overflow at 320.

**Keyboard.** Tab order on `/analytics`, the report and the reports index, at 1280. Every stop inside `<main>` has a visible 2 px focus ring: *See every post*, *Monthly reports*, the month picker, *Show*, the three campaign links; *Back to monthly reports*, *Download PDF*; the report-email select and *Save*; the report link. At 640 the details disclosure opens and closes with Enter (ring 2 px). **Not covered by the ring: the dashboard sidebar links and the user-menu button show no outline** (outside ADR 0031; see the observations).

**Print.** With print media emulated at A4 width the sidebar, nav, form and PDF link are hidden and the report fits (779 px). The browser's own `page.pdf` of the page is a valid `%PDF-` of 4 pages. Rows, charts and sub-headings stay whole in the screenshot.

**Defects found, and what was done.**

| # | Defect | Disposition |
|---|---|---|
| D1 | At 320 px the stacked-card label (`::before` of `TABLE.cell`) shrank to a few characters and broke mid-word: "Veredic / to" (pt campaign card), "Re / su / lts" and "Acc / ount" (A, Account by account). Cause: the cell's `wrap-anywhere` is inherited by its `::before` flex item, whose min-content is one character. | **FIXED** in `components/analytics/shared.tsx`: `max-sm:before:shrink-0 max-sm:before:max-w-[45%] max-sm:before:wrap-break-word`. Test: `worst-case.test.tsx` (the class set, and that the two utilities compile to real CSS). Reddened by removing `shrink-0`. Re-measured: labels render whole (Veredicto 63 px, Campaign 66 px), `scrollWidth` unchanged. |
| D2 | Counted strings carried a bare `{count}`: "1 publicações no LinkedIn", "1 campanhas ativas, 1 concluídas", "1 posts published on X". | **FIXED** for `activity.line`, `activity.total`, `activity.campaigns`, `exclusions.summary` and the engagement count, in `en`, `pt`, `es`, as ICU plurals (pt has an explicit `=0` branch, because `Intl` treats 0 as "one" in Portuguese and "0 publicação" is wrong in pt-PT). Test: `lib/i18n/analytics-parity.test.ts` renders the real messages through `createTranslator` at 0, 1 and 2 in all three locales and checks no raw ICU survives. Reddened by restoring the bare `{count}` in pt. Every real consumer already uses next-intl's `getTranslations`, so the page, the stored report summary, the email and the PDF all render plurals. |
| D3 | The posts-table Result cell put the rate and the badge in one row beside the label; at 320 px the badge wrapped to four lines in a ~70 px column. | **FIXED** in `PostsView.tsx` (`max-sm:flex-col max-sm:items-end max-sm:gap-1 max-sm:text-right`). **No test**: the change is a layout class and the worst-case suite has no assertion that can tell it from its absence; verified by screenshot (`fix_posts-result-cell_pt_320.png`). |
| D4 | `state.immature` and `state.thin` still print "1 measured posts so far" and "Final for 1 posts" at a count of 1. | **NOT FIXED, by design.** They are the §8.2 literals, pinned verbatim by `analytics-parity.test.ts`; editing locked copy is an ADR amendment, not a Builder change. Proposed amendment: ICU plurals on those two keys. |
| D5 | **Observed patterns** renders the generic empty-state literal "Nothing published yet. Results appear here after Jemip publishes your first post." on a month with 13 published posts, because the section reuses `state.empty` when no pattern qualifies. The sentence is false there. | **NOT FIXED**, same reason (§8.2 literal), and it needs a founder decision on the wording. Visible in `A_en_1280_portfolio-populated-2026-03.png` and the print render. |

**Observations, outside ADR 0031, not changed.**

- A hydration warning on every full page load in dev: `<body className="min-h-full flex flex-col">` differs between server HTML and client, in the root layout. The live DOM has the class and `display: flex`, so there is no visible effect; a dev-only React message, plus a dev-only `eval()`/CSP console error, both also present on `/en/login`.
- The dashboard sidebar links and the user-menu button have no visible focus indicator (above).
- The 12-month trend chart labels are about 5 px at 320 px (the known item; the sr-only chart table is not shown at that width).
- No active-business selector, so a multi-business owner always lands on the oldest business.

**What is NOT proven by this step.**

- **The PDF route has not rendered a PDF in a served request.** `GET /api/analytics/reports/<id>/pdf` returned 500 here. Cause, confirmed by calling `launchChromium` directly: `Failed to launch the browser process: spawn C:\Users\tiago\AppData\Local\Temp\chromium ENOENT`. `@sparticuz/chromium` is a Linux binary, so the production launch path cannot run on this machine, and there is deliberately no environment override (V.14). The first-page screenshot of the downloaded PDF that the guide asks for was therefore not taken. What stands is the O2.9 real-browser spike (V.14) and the print render above. The Vercel preview (cold start, memory, traced files) stays the open launch-checklist row.
- **200% zoom** was not run as a zoom; it is the same layout as the next width down (1280 at 200% is the 640 layout, 640 at 200% is the 320 layout), both measured.
- **RTL** was not run; `dir="auto"` is on customer strings and is asserted in the worst-case tests only.
- **Real data volumes.** The fixture is 30-odd posts; a business with thousands of posts was not loaded.

**Commit scope.** `shared.tsx`, `PostsView.tsx`, the three `analytics.json` files, two test files, this entry and the screenshots.
