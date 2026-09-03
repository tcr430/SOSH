# Session 32 — Social read path and cold-start memory backfill (ADR 0025 + ADR 0002 Amendment A) · Track I

> **Goal:** stop memory starting empty. Resolve open decision **19D-5** by adding a **read path** to
> `SocialProvider`, then use it to backfill a new customer's governed memory from **their own** published
> posts and aggregate metrics at onboarding — voice from their real writing rather than their website
> prose, performance from what actually happened, audience from their own recurring language, and evidence
> from claims they have **already published** (and therefore already cleared for public use).
>
> **This session exists because of a measured failure, not a hunch.** Session 30's live run scored
> market-responsive **recall 0/24**, and every refusal cited absent audience/brand memory under the
> corpus's universal `stubMemory: {}` condition (`docs/current-phase.md`, ADR 0023 §2.8). Cold-start
> emptiness is the only measured failure the project has.
>
> **What this session does NOT ship, explicitly:** comment or reply mining of any kind (third-party
> personal data — see L-2 and R3); `relationship_memory` (ADR 0016 parked it); reading any account the
> customer does not own; embeddings, similarity retrieval or exemplar *selection* (a later session — the
> backfill supplies the corpus those will need, and stops there); the outcome-learning loop (Session 33);
> memory-driven opportunity cards; and any change to generation behaviour.
>
> **Prerequisite, absolute.** Session 32 does not begin until **founder rulings R1, R3 and R4 are recorded
> in §0** (they are pre-filled below as the brainstorm doc's recommendations and are **not yet
> adjudicated**), and until Session 31 has closed. Session 31 changes what a generation call receives;
> this session changes what is in the store it receives it from. Landing them together would make a
> quality regression unattributable to either.
>
> **Reframed 2026-09-03 — the Postiz migration now runs BEFORE this session, and that changes real
> content below. Read this before acting on Reality §3, Q2, D-2 or §2's ordering.**
> `docs/build-guide/session-30-5.md` (**Track N, ADR 0028**) ships native LinkedIn and X providers and
> deletes Postiz outright, ahead of Session 31. **This session was written against the opposite
> assumption** — that the broker would still be live and that surviving its eventual removal was a risk to
> design around. Four consequences, none of which rewrite the text below (this repo appends, it does not
> overwrite):
>
> 1. **Q2 — *"Surviving the Postiz removal"* (§0.1) is largely dissolved, not answered.** By the time this
>    session's Architect runs, `PostizProvider` does not exist. Q2 is re-scoped to a **narrower and
>    better** question: *given the native providers ADR 0028 shipped, what can each platform's API
>    actually serve as a read path, and what does the read contract owe the shape ADR 0028 chose?* The
>    failure mode Q2 named — *"a contract that quietly encodes Postiz's response shape"* — is now
>    **structurally impossible**, which is the whole reason for the reordering.
> 2. **The amendment letter moves: this session's read path is `ADR 0002 Amendment B`, not A.** Session
>    30.5 takes Amendment A (it supersedes ADR 0002 §5 and §4's single-default assumption). Update the
>    title line and every internal reference at the Architect gate.
> 3. **Reality §1's 19D-5 option 1 is restated.** `docs/current-phase.md`'s wording — *"implement in
>    `PostizProvider` + `MockProvider` … requires ADR 0002 amendment + new Postiz API call"* — is quoted
>    verbatim below and stays quoted, but the work it describes is now *implement in `LinkedInProvider`,
>    `TwitterProvider` and `MockProvider`*. Session 30.5's §5 re-points the `current-phase.md` entry.
> 4. **§2's ordering note and D-2 read `PostizProvider` where they now mean the native providers**, and
>    the "dies with the Postiz removal workstream" rationale in D-2 is now a *past* event rather than a
>    pending one. D-2's **decision is unchanged and its loser is unchanged** — the read contract still
>    lives on the abstraction at `lib/social/index.ts`, and ADR 0028's `SOCIAL-PROVIDER-BOUNDARY` scan
>    enforces it more strictly than before.
>
> **The prerequisite is extended accordingly: this session does not begin until Session 30.5 and Session
> 31 have both closed.** Nothing else moves — the measured 0/24 that motivates this session, R1/R3/R4, and
> the memory-type extraction questions are all untouched.

---

## Reality check — to be re-verified against the live repo before the Architect runs

> Read at `b297a4a8`. **If any item has changed, correct this file before the Architect runs.**

1. **`fetchRecentPosts` does not exist anywhere in `lib/` — verified by grep.** There is **no social read
   path at all**. `SocialProvider` (ADR 0002) is publish-and-status only. This is exactly open decision
   **19D-5**, unresolved since Session 19 and carried in `docs/current-phase.md` under "What's next" as a
   voice-model refinement question. **This session reframes and answers it** (L-4).

2. **The 19D-5 options, verbatim from `docs/current-phase.md`:** (1) *"Add `fetchRecentPosts` to
   `SocialProvider` — implement in `PostizProvider` + `MockProvider`, wire into `refineFromPostsAction`.
   Requires ADR 0002 amendment + new Postiz API call."* (2) *"Amend ADR 0011 §7 — ratify 'refine reads
   local published posts from SOSH DB' as deliberate scope reduction."* L-4 selects option 1; the ADR
   records option 2 as the named loser and states why its value changed.

3. **Postiz is on a removal path.** `docs/current-phase.md` "Next up" item 1 is the *"Postiz removal
   workstream (launch-checklist §16): migrate `lib/social/` to direct LinkedIn/X APIs."* Q2 must state how
   a new provider method survives that migration — this is the strongest argument for putting the read
   contract on the **abstraction** rather than reaching for a Postiz call at the call site.

4. **The `SocialProvider` boundary is scan-enforced.** CLAUDE.md: *"No code outside `/lib/social/` ever
   imports `postiz-provider` or `mock-provider` directly."* A backfill importer living outside
   `lib/social/` and calling Postiz would break a constraint the repo already tests for.

5. **Tokens live in Supabase Vault, never raw.** `social_accounts` holds only `vault_access_token_id` /
   `vault_refresh_token_id`; `/lib/social/` reads decrypted values through the service-role client from
   `vault.decrypted_secrets`. A historical read uses that same path — Q6 confirms it and confirms no new
   token surface is created.

6. **Onboarding infers voice from the website today.**
   `app/[locale]/(dashboard)/onboarding/infer-brand-voice` + `lib/ai/prompts/brand-voice-inference.ts` +
   `lib/ai/website-fetcher.ts`. There is already a **founder ratification step** for the inferred voice —
   L-6 reuses it rather than inventing a second approval surface.

7. **`performance_memory` is effectively empty in production.** `lib/memory/performance.ts`'s own comment:
   *"today, this always takes the fallback branch"* — retrieval falls back to raw `post_metrics`. Its only
   writer is `lib/learning/*` (the edit-signal pipeline). Q4 must state what a **backfilled** performance
   record is, and how it differs from a *learned* one — this session writes the store for the first time
   from a non-edit source.

8. **`relationship_memory` was deliberately parked** (ADR 0016, Phase-2 engagement-inbox scope) and
   **voice has no dedicated table** — it reads through `brand_voices` / `brand_voice_variations` via
   `retrieveVoice` (`MEM-VOICE-THROUGH-EXISTING`, ADR 0016 §3.5). A backfill must write through the
   existing stores, not invent a `voice_memory`.

9. **Memory records already carry the governance fields a backfill needs:** source, `confidence`,
   `recency_at` (30-day half-life), `expires_at`, `status`, `scope` / `scope_ref`
   (`lib/memory/scoring.ts`). L-3's provenance requirement should extend this model rather than parallel
   it.

10. **The trial clock starts on first social-account connection** (CLAUDE.md, locked strategic decision) —
    which is precisely the moment a backfill would run. R4/L-7 is about that collision.

11. **Counsel blockers exist for ingested third-party content** (ADR 0020 §9.6; ADR 0023 — article
    licensing, a fresh Art. 6(1)(f) balancing test, the `/privacy` prose extension and its `evidenceRef`
    bump). **Those cover ingested feeds, not a customer's own account history.** Q7 states which of them
    apply here, which do not, and what is genuinely new — it must not assume coverage.

12. **`ai_usage` + the per-business daily cost ceiling exist** (`SIGNAL3-COST-CEILING-ATOMIC`). A backfill
    is a one-time burst over up to hundreds of posts — Q5 states its ceiling and whether it shares the
    daily cap or gets its own bounded budget.

---

## §0 — Locked decisions (binding input)

> ⚠️ **FOUNDER SIGN-OFF REQUIRED BEFORE §1 RUNS.** `L-2`, `L-4` and `L-7` encode rulings **R3, R1 and R4**
> from `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` §14 that **have not yet been
> adjudicated**. They are pre-filled with that document's recommendation so the Architect has a complete
> binding input. **Confirm or amend each before the Architect (I1) starts.** An unconfirmed L is not a
> Locked decision.

> **ADDED 2026-09-03 — a new binding input, `L-11`, from the founder ruling in
> `docs/pre-launch-scope.md` §12.2.** Founder/personal profiles were promoted to **Tier 1 (T1-E)**. That
> changes this session's central contract: **the read path is ACCOUNT-shaped, not ORGANISATION-shaped.**
> For a founder-led B2B company the highest-value corpus is the founder's personal LinkedIn/X history,
> not the company page's — and a `fetchRecentPosts` designed only around an org page would have to be
> re-cut the moment T1-E ships. Q1's signature, bounds and per-platform honesty table must therefore be
> answered **per connected account**, and Q3's voice extraction must state how a founder-voice corpus and
> a brand-voice corpus stay separate rather than being averaged into one voice — which is precisely what
> ADR 0011's voice variations exist to prevent. **This does NOT pull T1-E's connect-flow into Session 32**;
> it only requires that nothing here forecloses it.

These are decided. The Architect (I1) **encodes** them in ADR 0025 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**.

**Locked (L):**

- **L-1 — Session 32 ships a read path and a backfill, and nothing that consumes them.** *In scope:* the
  `SocialProvider` read contract + **ADR 0002 Amendment A**; implementations in `PostizProvider` and
  `MockProvider`; the backfill extractors writing voice, performance, audience and evidence memory; the
  onboarding surface; provenance marking; and the ceilings. *Out of scope, explicitly:* **comment/reply
  mining** (L-2); **`relationship_memory`**; **reading any account the customer does not own**;
  **embeddings, similarity retrieval, and exemplar selection** — the backfill supplies a corpus and stops
  there (**note 2026-09-03:** those are now *un-blocked* per `docs/pre-launch-scope.md` §12.6, which makes
  supplying the corpus more load-bearing, not less — the fence here is unchanged); **the outcome-learning
  loop** (Session 33); **memory-driven cards**; **any change to generation behaviour or to
  `CustomerContext`'s shape**; **image generation**; **autonomous anything**. If a step appears to need
  any of these, **STOP and report**.

- **L-2 — Own posts and aggregate metrics ONLY. No comments, no replies, no commenter identities.**
  *(Encodes R3.)* Reading the customer's own published content is the strongest legal position available —
  their data, their accounts, their controller relationship. Comment mining processes the personal data of
  people who never signed up and edges into the `relationship_memory` ADR 0016 deliberately parked. Loser:
  a richer audience yield from comments — real value, deferred to counsel rather than taken. The ADR
  states the comment path as **deferred with a named condition**, not as impossible.

- **L-3 — Backfilled memory is PERMANENTLY distinguishable from earned memory.** Every record this session
  writes carries a provenance marker that survives promotion, decay and re-confirmation. Loser: merging
  the two — after which no one can ever say whether a pattern came from observed behaviour inside SOSH or
  from an import, which poisons every downstream claim including Session 33's outcome patterns and the
  eval harness's own numbers.

- **L-4 — 19D-5 is resolved as option 1: `fetchRecentPosts` joins `SocialProvider`, with an ADR 0002
  amendment as a named deliverable.** *(Encodes R1.)* Loser: option 2 (amend ADR 0011 §7 to read only
  local SOSH posts) — defensible when the only consumer was voice refinement over posts SOSH itself
  published, but a customer who has just connected an account has **zero** local posts, so option 2 makes
  the backfill return nothing on exactly the day it matters. The ADR records that the decision's value
  changed rather than that the earlier reasoning was wrong.

- **L-5 — No new token surface. Historical reads go through the existing Vault path.** `/lib/social/`
  reads decrypted values via the service-role client (Reality §5). No raw token reaches an application
  table, a log line, or a TypeScript type. Scope changes required for historical reads, if any, are named
  in the ADR per platform.

- **L-6 — Inferred voice is ratified by the founder through the EXISTING onboarding step, and exemplars
  are performance-weighted.** A backfill teaches whatever it is fed; a corpus of mediocre posts teaches
  mediocrity. Loser: importing everything unweighted and unratified (fast, and it silently sets the
  quality ceiling for that customer forever).

- **L-7 — The backfill runs BEFORE the trial clock starts.** *(Encodes R4 — and it touches the locked
  strategic decision "trial clock starts on first social account connection", so the ADR must state the
  interaction explicitly rather than quietly re-timing it.)* Loser: running it after the clock starts —
  the customer spends trial days waiting for their own history to import, on precisely the day the product
  is supposed to feel warm. If the ADR finds this unimplementable without changing the clock rule itself,
  it **STOPS and flags for founder adjudication**.

- **L-8 — Deterministic first; a model only where judgment is required.** Counts, timing, frequency,
  format distribution and engagement baselines are arithmetic. Voice and audience synthesis need a model,
  **once**, over a performance-filtered subset. This is ADR 0020's Stage B posture applied to import, and
  it is what keeps a one-time burst affordable.

- **L-9 — GDPR, tenancy and RLS obligations in full.** Every new business-scoped table: RLS in the
  InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and**
  `WITH CHECK` on every UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2
  §D2.5's cascade table**, and `purge_business` coverage. **Additionally:** imported post text is the
  customer's own published content, but it may quote third parties — the ADR states what may be retained,
  for how long, and how it is purged.

- **L-11 — The read path is account-shaped, not organisation-shaped.** *(Added 2026-09-03; encodes
  `docs/pre-launch-scope.md` §12.2 / T1-E.)* `fetchRecentPosts` is defined over a **connected account**,
  and a business may connect both a company page and a founder's personal profile. The backfill keeps the
  two corpora **separate and separately attributed** through the whole pipeline — extraction, voice
  synthesis, provenance marking and the ratification step — so a founder voice and a brand voice never
  average into one. Loser: an org-shaped contract, which is simpler today and has to be re-cut the moment
  T1-E ships, taking every extractor and every provenance row with it.

- **L-10 — Contract discipline + constitution rules, inherited by every step.** No code outside
  `/lib/social/` imports a provider directly (Reality §4); DB only via `lib/db/` + `lib/memory/`; Anthropic
  SDK only via `lib/ai/`; **Zod** on every Server Action and route input; **atomic** state transitions;
  every list query **bounded + explicit `ORDER BY`**; **date-fns**; **no `any`**; env only via
  `lib/config.ts`; **i18n en/pt/es simultaneously**; and **SHARED-FUNCTION CALLERS** for every existing
  function touched — `retrieveVoice`, the `lib/db/memory-*` writers and the onboarding actions all have
  callers, and both Session 22 blockers were this exact failure.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | 19D-5 | **option 1 — read path on `SocialProvider`** | option 2, local-posts-only (returns nothing for a newly connected account, i.e. fails on the only day the backfill matters) |
| D-2 | Where the read contract lives | **the abstraction, `lib/social/index.ts`** | a Postiz call at the call site (breaks the scan-enforced boundary and dies with the Postiz removal workstream) |
| D-3 | Data scope | **own posts + aggregate metrics** | comments/replies (third-party personal data, un-ruled by counsel, edges into parked `relationship_memory`) |
| D-4 | Backfill provenance | **permanently marked** | merged with earned memory (destroys attribution for every downstream claim, including Session 33's) |
| D-5 | Voice corpus selection | **performance-weighted + founder-ratified via the existing step** | import-everything (sets that customer's quality ceiling silently and forever) |
| D-6 | Timing | **before the trial clock starts** | after (burns trial days importing their own history) |
| D-7 | Compute posture | **deterministic first, one model pass on a filtered subset** | a model pass per post (a one-time burst that scales with account history, with no quality justification for the arithmetic parts) |

---

## §0.1 — Questions the Architect (I1) must resolve IN the ADR (BINDING)

**I1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (ADR 0015
§2). Ground every answer in the real seams — let the single `ecc:code-explorer` sweep map them and cite
`file:line`.

- **Q1 — The `SocialProvider` read contract (the load-bearing question).** The method signature, its
  return type, its **bounds** (how many posts, how far back, page size, and the hard ceiling), its error
  taxonomy, and its behaviour on a platform that cannot serve history. Which platforms can actually serve
  it **today through Postiz**, stated honestly per platform — LinkedIn organisation posts, X, Instagram,
  Facebook Pages, Threads — and what happens for those that cannot. Then **ADR 0002 Amendment A** in the
  house amendment form (follow ADR 0014 Amendment A / ADR 0010 Amendment 2), stating that the abstraction
  gains a read capability, what `MockProvider` must return for tests to be meaningful, and that no
  consumer outside `/lib/social/` learns which provider served it.

  **Q1b — outbound activity: can it be read at all? (added 2026-09-03; `docs/ideas.md` §2.7.)** The same
  honest per-platform table must also answer, **for each platform, today, through Postiz and after the
  native migration**: can we read (a) the **comments the customer themselves wrote** on other people's
  posts, and (b) the posts **they reacted to**? These are the third leg of cold start and **no session
  covers them** — Session 32 reads what they *published*, and L-2 excludes comments *on* their posts. A
  comment they wrote is unpolished authored content and is plausibly a better voice corpus than their
  edited posts; what they reacted to is near-pure `audience_memory` input.

  **This question is feasibility-only and does NOT widen L-1.** Nothing outbound is read, extracted or
  stored in this session; `BACKFILL-NO-COMMENT-READ` stands unchanged and its scan must still pass. The
  ADR records **one row per platform: served / not served / unknown**, with the API surface named — the
  expected answer on LinkedIn is *not served*, and recording that is the point. **If it later ships**, the
  ADR must also state the data-scope split that keeps it on L-2's side of the line: their own words and
  **derived** topic labels are retainable; **the third-party post the action attaches to is not**, and an
  extractor that stores the target content has become the deferred comment-mining path and inherits its
  counsel condition. T1-D (the founder interview) is the fallback that reaches the same material by
  asking rather than reading.

- **Q2 — Surviving the Postiz removal (Reality §3).** State how the read contract holds when
  `lib/social/` migrates to direct LinkedIn/X APIs: which parts of the contract are provider-neutral,
  which are Postiz-shaped and will need re-implementation, and what the migration owes this session.
  A contract that quietly encodes Postiz's response shape is the failure mode — name it.

- **Q3 — What is extracted, per memory type (L-8).** For **voice**: what is written, through which
  existing store (Reality §8 — there is no `voice_memory`), and how the performance weighting selects the
  corpus. For **performance**: what a backfilled record *is* (Reality §7) and how it differs from a
  learned one. For **audience**: what can be derived from own-posts-only, given L-2 removes the richest
  source — be honest if the yield is thin. For **evidence**: the claim-extraction contract, and the
  argument that already-published claims carry a **permission** status that unpublished ones do not.
  For each: deterministic or model-derived, and the confidence assigned.

- **Q4 — Provenance, confidence and decay for imported records (L-3).** The marker's shape and where it
  lives. Its interaction with `recency_at`'s 30-day half-life — **an imported post from 2024 is old, but
  the *fact that it performed well* may not be**; say which timestamp governs. The initial `confidence` for
  each type and its justification. Whether imported records may ever be *promoted* to earned status, and
  if not, what happens when a learned pattern later confirms an imported one. State how Session 33's
  outcome loop will distinguish them.

- **Q5 — Ceilings, cost and failure (L-8, Reality §12).** The per-backfill hard ceiling in posts and in
  cents, with the arithmetic against `lib/ai/models.ts`'s rates. Whether it shares the existing per-business
  daily cap or holds a separate one-time budget — argue it. What happens on partial failure: a backfill
  that imported 60 of 200 posts must be resumable or explicitly discardable, and a half-imported memory
  that looks complete is the failure mode. Where it runs (a cron worker? an inline onboarding action? —
  latency and the L-7 timing both bear on this).

- **Q6 — Token scope and the Vault path (L-5, Reality §5).** Confirm historical reads use the existing
  decrypted-secret path with no new token surface. State per platform whether historical read requires a
  **broader OAuth scope** than publishing does — if it does, that changes the connect flow and is a
  founder-visible product change, so flag it rather than absorbing it.

- **Q7 — Legal posture, stated as what is genuinely new (Reality §11, L-2, L-9).** Which existing counsel
  blockers apply here and which do not — do **not** assume ADR 0020 §9.6 / ADR 0023's rulings cover a
  customer's own account history, and do not assume they fail to. What is retained from an imported post,
  for how long, and how `purge_business` reaches it. The third parties who may appear *inside* the
  customer's own posts (quoted people, named customers) and what that means for evidence memory's
  permission field. End with an explicit list of **what still needs counsel before this ships**, if
  anything.

- **Q8 — Test plan across the tiers, and the honest measurement.** **Tier 1** (live Postgres) for any new
  table's RLS, cascade and `purge_business`, and for the provenance marker surviving a promotion cycle.
  **Tier 2** for the provider contract against `MockProvider`, the extractors, the bounds, the
  partial-failure/resume path, the performance weighting, and the ratification gate. **Tier 3** for the
  properties of absence — no comment/reply read anywhere in the diff, no direct provider import outside
  `lib/social/`, no `relationship_memory` table, no raw token in any type — enumerated as such.
  **And the measurement this session is judged on:** memory rows at end of onboarding versus today's
  near-zero, and the protocol for re-running the Session 30 corpus with **populated** stub memory (the
  attempt recorded in `docs/current-phase.md` as D9's `eval:live-triage-populated` is the precedent —
  cite what it found and what it could not establish). State plainly that a corpus improvement is
  `MEASURED`, never `COVERED` (ADR 0015 Amendment B).

Where an I1 answer and this build-guide disagree, **the ADR wins once written** — but I1 must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **AWAITING THE ARCHITECT — this section is the Builder's gate; I2 does not start without it.**
>
> Recorded here in the Sessions 22–30 form, **before** §2 is authored:
> `| # | Question | Decision | Where encoded |`, rows `A-1 … A-n`.
>
> **Most likely escalations:** Q6's broader-OAuth-scope finding (a connect-flow change is founder-visible);
> Q7's residual counsel list; Q1's per-platform honesty (if only one platform can serve history today, the
> session's value proposition narrows and that is a founder call, not an Architect one); and any conflict
> between L-7 and the locked trial-clock rule.
>
> Where an adjudication goes **against** I1's recommendation, the recommendation is **preserved in the ADR
> and the reasoning recorded here** — nothing is rewritten in place. A revised ruling gets a prime
> (`A-3` → `A-3′`) with both visible.
>
> Closes by naming any constraints the adjudications added and restating ADR 0025's total count.

---

## §1 — Architect session (I1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **two documents and no code**:
`docs/decisions/0025-social-read-path-and-backfill.md` (Accepted) and **ADR 0002 Amendment A** appended to
`docs/decisions/0002-social-provider.md`. No `.ts`, no `.sql`, no `.tsx`. Any code attempted here is
discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list, then **exactly three** advisory reviewers dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation.
`ecc:architecture-decision-records` and `claude-mem`'s `mem-search` are skills and are free; so is
`ecc:cost-aware-llm-pipeline` — ⚠️ **it is a SKILL in this install, not an agent** (the Session 28 error).
`impeccable` / `taste-skill` are **not** invoked — I1 specifies the onboarding UX contract; the Builder
runs them against it.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 32 — Social read path and cold-start memory backfill. ARCHITECT phase (Track I). You produce TWO
artefacts and NO code:
  (a) docs/decisions/0025-social-read-path-and-backfill.md (status: Accepted)
  (b) ADR 0002 Amendment A, appended to docs/decisions/0002-social-provider.md
No .ts, no .sql, no .tsx. If you catch yourself writing a provider method body, a migration, or an
extractor, stop: that is the Builder's job (I2), and the constitution requires Architect-attempted code to
be discarded.

PREREQUISITES — verify before anything else, and STOP if either fails.
(1) Section 0 of docs/build-guide/session-32.md carries a FOUNDER SIGN-OFF warning: L-2, L-4 and L-7
    encode rulings R3, R1 and R4 that may not yet be adjudicated. Confirm they have been signed off. If
    they have not, STOP and say which are outstanding — an unconfirmed L is not a Locked decision and you
    must not encode it as one.
(2) Session 31 (Track H, ADR 0024) must have closed.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. file:line citations and the shape of
   each seam — nothing else.
2. Skills are free and do not consume the budget: ecc:architecture-decision-records for ADR structure and
   for the amendment form (follow ADR 0014 Amendment A and ADR 0010 Amendment 2); claude-mem's mem-search
   for prior-session context; ecc:cost-aware-llm-pipeline as a SKILL for Q5's arithmetic.
3. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - security-reviewer — on Q6 and Q7. Whether a historical read needs a broader OAuth scope than
     publishing (per platform), whether the Vault path is genuinely reused with no new token surface, what
     imported post text may retain about third parties quoted inside a customer's own posts, and whether
     the existing ADR 0020 section 9.6 / ADR 0023 counsel blockers actually cover this or whether
     something new is required. Ask it to say which of those two it is, explicitly.
   - database-reviewer — on Q3, Q4 and Q5. The provenance marker's shape and whether it survives promotion
     and decay; the write volume of a one-time import of up to hundreds of posts across four memory types;
     the index and cascade obligations; and whether a partial import can be made resumable without leaving
     a half-filled memory that looks complete.
   - ecc:architect — on Q1 and Q2. Whether the proposed read contract is genuinely provider-neutral or
     quietly Postiz-shaped, and what the pending Postiz removal workstream (launch-checklist section 16)
     owes this session. Ask specifically what breaks when lib/social/ moves to direct LinkedIn/X APIs.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke impeccable or taste-skill — you SPECIFY the onboarding UX contract; I2 runs them against it.

Read now, before anything else:
- docs/build-guide/session-32.md — the Reality block, section 0 (Locked L-1..L-10 + the D-1..D-7 ledger,
  INCLUDING the sign-off warning) and section 0.1 (Q1..Q8). This is your binding input.
- docs/brainstorm/ai-quality-track-ideas-and-build-path.md — Part II, especially section 12 (the backfill,
  its four gating facts) and section 14 (the dependency chain and rulings R1-R4). Section 11 is Session 33
  and section 10 is Session 34: both belong in your deferred list, not this ADR.
- docs/decisions/0002-social-provider.md — ALL of it. You are amending it.
- docs/decisions/0011-voice-model.md — section 7 / BP9 and the open 19D-5 decision this session resolves.
  Read the ORIGINAL reasoning for option 2 so your ADR can say the decision's VALUE changed rather than
  that the reasoning was wrong.
- docs/decisions/0016-governed-memory.md — the four memory types, the governance fields, MEM-VOICE-THROUGH-
  EXISTING (there is NO voice_memory table), MEM-NO-DIRECT-TABLE-ACCESS, and the PARKED relationship_memory.
- docs/decisions/0020-mode-3-signal-ingestion.md section 9 and docs/decisions/0023-market-responsive-
  signal-source.md — the third-party-content counsel posture. Q7 must say which of it applies here and
  which does not. Do NOT assume either way.
- docs/current-phase.md — the Session 30 entry (the measured 0/24 and its stubMemory hypothesis, and D9's
  eval:live-triage-populated attempt), the 19D-5 open decision, and the Postiz removal workstream.
- CLAUDE.md — the SocialProvider boundary rule, token storage in Vault, the three-client rule, the
  RLS/erasure-cascade obligation, Zod, i18n, bounded queries, and SHARED-FUNCTION CALLERS.

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/social/index.ts + the SocialProvider interface + postiz-provider + mock-provider — the exact shape
  you are amending, and what MockProvider would have to fabricate for a read test to mean anything.
- lib/social/ token handling and the vault read path (service-role, vault.decrypted_secrets).
- lib/db/social-accounts.ts — the vault id columns and the disconnect path (all three steps).
- lib/memory/*.ts + lib/db/memory-*.ts — the four types' write surfaces, the governance fields, and
  retrieveVoice's read-through to brand_voices / brand_voice_variations.
- lib/memory/performance.ts — the fallback branch and its comment; lib/learning/promote.ts + summarize.ts
  — the ONLY existing writer of performance_memory, so you can say how a backfilled record differs.
- app/[locale]/(dashboard)/onboarding/ — all four steps, actions.ts, and infer-brand-voice; plus
  lib/ai/prompts/brand-voice-inference.ts and lib/ai/website-fetcher.ts. REPORT the existing founder
  ratification step for inferred voice — L-6 reuses it.
- lib/db/trial-state.ts and wherever the trial clock starts on first social connection — L-7 depends on
  this being precisely located.
- app/api/cron/ — the worker pattern, if the backfill runs as one.

Do NOT write either document yet. First OUTPUT your answers to the eight section-0.1 questions (Q1 the
read contract + ADR 0002 amendment, Q2 surviving the Postiz removal, Q3 what is extracted per memory type,
Q4 provenance/confidence/decay, Q5 ceilings/cost/failure, Q6 token scope, Q7 legal posture, Q8 test plan
and measurement), EACH with its named loser and its ADR 0015 tier, AND a one-line note on any place a
section-0 Locked decision constrains the answer. Flag explicitly if any answer needs: a broader OAuth
scope than publishing (a connect-flow change), new counsel work, a change to the trial-clock rule, a new
dependency, or a narrowing of the session's value because a platform cannot serve history — those are
founder adjudications, not your call. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 32. Write BOTH documents. Ground every claim in the real repo (cite file:line from the
ecc:code-explorer sweep). You have already dispatched your ONE batch of three advisory reviewers — fold
their objections in now, or record why you rejected them. Do not re-consult them.

=== DOCUMENT A: docs/decisions/0025-social-read-path-and-backfill.md (Accepted) ===

1. Context + decision summary. Open with the MEASURED fact, not a hunch: Session 30's live run scored
   market_responsive recall 0/24 and every refusal cited absent memory under a universal stubMemory {}
   condition — and state, as ADR 0023 section 2.8 does, that this is a HYPOTHESIS the model's own text
   suggests, not a confirmed cause, because the zero-memory condition was never isolated. Then the fix.
   Name the losers per section 0's D-1..D-7 ledger.

2. The read contract (Q1) — the load-bearing section. Signature, return type, bounds as NUMBERS, error
   taxonomy, per-platform honesty about what Postiz can actually serve TODAY, and the behaviour where it
   cannot. State what MockProvider returns and why a read test against it is meaningful rather than
   circular.

3. Surviving the Postiz removal (Q2). Which parts of the contract are provider-neutral, which are
   Postiz-shaped, and what launch-checklist section 16's migration owes this session. Name "a contract
   that quietly encodes Postiz's response shape" as the failure mode you are designing against. Fold in
   ecc:architect's findings.

4. Extraction per memory type (Q3, L-8). Voice (through the EXISTING stores — there is no voice_memory),
   performance (and how a backfilled record differs from a learned one), audience (be honest about the
   thin yield once L-2 removes comments), evidence (and the permission argument for already-published
   claims). Per type: deterministic or model-derived, the confidence assigned, and the caps.

5. Provenance, confidence and decay (Q4, L-3). The marker, where it lives, and how it survives promotion
   and decay. Which timestamp governs recency for an imported record — the post's date or the import's —
   argued, because a 2024 post is old but its performance may not be. Whether imported records can ever be
   promoted to earned, and what happens when a learned pattern later confirms one. State explicitly how
   Session 33's outcome loop will distinguish them. Fold in database-reviewer's findings.

6. Ceilings, cost and failure (Q5). The per-backfill hard ceiling in posts and cents with arithmetic.
   Shared daily cap or separate one-time budget, argued. The partial-failure path — resumable or
   explicitly discardable — with "a half-imported memory that looks complete" named as the failure mode.
   Where it runs, and how that satisfies L-7's before-the-clock timing.

7. Token scope and the Vault path (Q6, L-5). Confirm no new token surface. State per platform whether
   historical read needs a broader OAuth scope than publishing — and if it does, say plainly that this
   changes the connect flow and is a founder-visible product change. Fold in security-reviewer's findings.

8. Legal posture (Q7, L-9). Which existing counsel blockers apply and which do not, stated as a decision
   rather than an assumption. What is retained from an imported post, for how long, and how purge_business
   reaches it. Third parties quoted inside the customer's own posts, and what that means for evidence
   memory's permission field. End with an explicit list of what still needs counsel before this ships.

9. GDPR + tenancy (L-9). Any new business-scoped table: RLS in the InitPlan-wrapped form with USING and
   WITH CHECK on UPDATE, ON DELETE CASCADE from businesses, the ADR 0010 Amendment 2 section D2.5 cascade
   row VERBATIM, and purge_business coverage. If no new table, say so explicitly (the Session 28-D D7
   precedent).

10. The onboarding UX contract the Builder is held to — you SPECIFY it, you do not design it: where the
    backfill sits relative to the four existing steps and the trial clock (L-7); every state (not started,
    running with progress, partial, complete, failed, unsupported platform); the founder ratification step
    for inferred voice REUSED not duplicated (L-6); what the customer is shown about what was imported —
    the "here is what we learned from your last N posts" moment is the product's first real payoff and the
    ADR specifies its information hierarchy; Server Component page + Client interaction split; Zod on
    every Server Action; shadcn v4 / Base UI with NO asChild on Button or DropdownMenu primitives;
    Tailwind only; i18n en/pt/es simultaneously.

11. Test plan across the tiers (Q8): Tier 1, Tier 2, Tier 3 enumerated as properties of ABSENCE (no
    comment/reply read anywhere in the diff; no direct provider import outside lib/social/; no
    relationship_memory table; no raw token in any type), and the measurement protocol — memory rows at
    end of onboarding versus today's near-zero, plus the re-run of the Session 30 corpus with POPULATED
    stub memory, citing what D9's eval:live-triage-populated attempt found and what it could NOT
    establish. State that a corpus improvement is MEASURED, never COVERED (ADR 0015 Amendment B).

12. A constraint table: every BACKFILL-* constraint, its tier, and the test that proves it — the
    Reviewer's checklist. Cover at least: BACKFILL-PROVIDER-BOUNDED, BACKFILL-OWN-POSTS-ONLY,
    BACKFILL-NO-COMMENT-READ, BACKFILL-PROVENANCE-MARKED, BACKFILL-PROVENANCE-SURVIVES-PROMOTION,
    BACKFILL-VOICE-RATIFIED, BACKFILL-PERFORMANCE-WEIGHTED, BACKFILL-COST-CEILINGED,
    BACKFILL-RESUMABLE-OR-DISCARDED, BACKFILL-VAULT-PATH-REUSED, BACKFILL-NO-RAW-TOKEN,
    BACKFILL-BEFORE-TRIAL-CLOCK, BACKFILL-RLS-ISOLATED, BACKFILL-CASCADE-COMPLETE,
    BACKFILL-PURGE-COVERED, BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL.

13. Explicit "deferred" section with the owning session named for each: comment/reply mining (with its
    counsel condition), relationship_memory, embeddings and exemplar SELECTION, the outcome loop (Session
    33), memory write expansion and cross-type retrieval (Session 34), memory-driven cards, and anything
    Q1-Q7 pushed to a follow-on.

=== DOCUMENT B: ADR 0002 Amendment A (append to docs/decisions/0002-social-provider.md) ===

Follow the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form. It must contain:
 (a) Why the amendment exists: SocialProvider was publish-and-status only, and 19D-5 has been open since
     Session 19. State that this amendment RESOLVES it, and name option 2 as the loser with the reason its
     value changed.
 (b) The read capability added to the interface, and the obligation it places on EVERY implementation
     including MockProvider.
 (c) Confirmation that the boundary rule is unchanged — no consumer outside lib/social/ learns which
     provider served a read.
 (d) What the Postiz removal workstream inherits from this amendment.
 (e) A statement that no existing SocialProvider behaviour is changed by this amendment.

Do NOT write code. End with one line: "ADR 0025 written and accepted — <n> BACKFILL-* constraints,
19D-5 resolved as option <n>, platforms serving history <list>, per-backfill ceiling <posts>/<cents>,
provenance marker <name>, backfill runs <before|after> trial clock, ADR 0002 Amendment A adds <method>."
Then /exit.
```

**Gate:** do not author §2 until **both** documents exist, ADR 0025 is Accepted, ADR 0002 Amendment A is
appended, and the eight §0.1 answers are on the record — **and** any founder adjudication is recorded in
§0.2. Then author §2/§3 below from the accepted ADR's real `BACKFILL-*` constraint names.

---

## §2 — Builder session (I2)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0025 is Accepted, ADR 0002 Amendment A is appended, and §0.2 exists
> (or is recorded as "no adjudications required").** Builder steps are written from the ADR's *real*
> constraint names; written earlier they cite constraints that do not exist yet.
>
> **Will contain:** **§2a** a Builder primer (pasted first, ends by stopping for acknowledgement) carrying
> the §0 Locked list, the §0.2 adjudications, the ADR decisions I2 **transcribes rather than re-derives**
> (the read contract's bounds, the per-type extraction rules, the provenance marker, the ceilings), the
> scope tripwires below, and the verification loop (`npx tsc --noEmit --skipLibCheck` +
> `npx vitest run lib/db lib/social lib/validation` plus this session's paths — never bare
> `npx vitest run`). Then **§2b**, one paste block per step, each a self-contained
> `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle naming the constraints it closes and the
> test proving each.
>
> **Ordering, and its rationale:**
>
> 1. **`I2.0` grounding pass** — re-verify every ADR premise, no code, no commit. Reality §1
>    (`fetchRecentPosts` absent) and Reality §7 (`performance_memory` always taking the fallback branch)
>    are the two most consequential if they have drifted.
> 2. **Boundary scans BEFORE the code that could violate them** — the ADR 0023 G1b.2 precedent. The
>    "no provider import outside `lib/social/`" and "no comment/reply read" scans land first, so the
>    session cannot introduce the violation it is meant to prevent.
> 3. **The provider contract + `MockProvider`**, then `PostizProvider` — a read test that means something
>    requires the mock to be honest first.
> 4. **The provenance marker and its migration before any extractor**, because a record written without it
>    can never be retro-marked correctly (L-3), and a half-marked store is worse than an unmarked one.
> 5. **Extractors one memory type per step**, deterministic types before model-derived ones.
> 6. **The ceilings and the partial-failure/resume path as their own step** — the branch most likely to be
>    left untested.
> 7. **The onboarding surface and the reused ratification step**, then the Tier-3 enumeration, then
>    coverage verification and close-out.
>
> **Scope tripwires as executable scans, not review comments:** `BACKFILL-NO-COMMENT-READ` (no comment,
> reply or commenter field anywhere in the diff); `BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL`;
> `BACKFILL-NO-RAW-TOKEN` (no token string in any type or log); a scan proving **no `relationship_memory`
> table or type was created**; and a scan proving **no generation path changed** (L-1).

---

## §3 — Reviewer session (I3)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0025 is Accepted, alongside §2.** The checklist *is* the ADR's
> constraint table; only the commit range is filled in at run time, by the Reviewer itself.
>
> **Will contain:** **§3a** a Reviewer primer (ends by stopping for acknowledgement), then **§3b** the
> Reviewer prompt.
>
> **Binding process rules the section must carry:**
>
> - **`PROC-REVIEW-AT-COMMIT`** — read every file **at the stated commit range**, never at HEAD, and
>   **open the report by naming the exact range**. A report that does not name its range is not a valid
>   review (Session 21B's false-positive MAJOR came from reading at HEAD).
> - **`SHARED-FUNCTION CALLERS`** — `retrieveVoice`, the `lib/db/memory-*` writers, the onboarding actions
>   and every `SocialProvider` consumer have multiple callers. `git grep` them and list, per caller, which
>   test exercises it; a caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller.
> - **The coverage-count rule** — verify each constraint is **executed green in CI at the head it is dated
>   to**; do not accept a claimed total (Session 28's false "29/29").
> - **Tier-E language** — any corpus re-run number is `MEASURED`, never `COVERED`, and the per-source split
>   is preserved; a blended figure remains prohibited (ADR 0023 §2.7).
>
> **The findings this session is most likely to produce:** a provenance marker that does not survive a
> promotion cycle; a resume path with no test that can fail; an extractor that reads a comment field
> incidentally; and a per-platform capability claim in the ADR that the shipped `PostizProvider` cannot
> actually honour.

---

## §4 — Correction pass (Session 32-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after I3 has run and `docs/reviews/session-32-reviewer.md` exists.** A
> correction pass responds to findings; inventing them ahead of time produces a fictional resolution log.
>
> **Will contain:** founder adjudications arising from the review → *"What the Reviewer found (summary —
> `docs/reviews/session-32-reviewer.md` is authoritative)"* → ordering rationale → where resolutions go →
> **§4.0** primer → **§4.1** steps (`D0 … Dn`, one paste block each) → **§4.2** resolution log → **§4.3**
> close-out. **`D0` is always the audit-trail step** — land the governing documents in git first.
>
> **Where resolutions go — `REVIEWER-REPORT APPEND-ONLY` (CLAUDE.md, revised Session 23-D). All four
> conditions bind:** (1) **no in-place edit, ever** — not one character of the Reviewer's text changes;
> (2) **one appended, attributed `## CORRECTION PASS (Session 32-D)` section** at the end of the
> reviewer's own file, opening with author, date and the commit range fixed, so a reader can tell from any
> line which of the two wrote it; (3) **findings referenced by ID, never restated as resolved** — record
> *finding → fix → the test that now proves it → the commit SHA*; (4) **a disputed or withdrawn finding is
> argued in the appendix, not erased**. The Session 22-D failure (RESOLVED verdicts written *into* the
> reviewer's findings) remains prohibited under condition 1.

---

## §5 — Docs to update at close-out (Track I done)

- [ ] `docs/decisions/0025-social-read-path-and-backfill.md` — Accepted, final constraint table, real
      post-correction counts verified executed green in CI at the head they are dated to.
- [ ] `docs/decisions/0002-social-provider.md` — Amendment A appended.
- [ ] `docs/decisions/0011-voice-model.md` — 19D-5 recorded as **resolved**, with option 2 preserved as the
      named loser and the reason its value changed.
- [ ] `docs/current-phase.md` — Session 32 entry; **remove 19D-5 from the open-decisions list**; the
      `db-tests` tally with its event type stated; the populated-memory corpus re-run reported per source,
      never blended, with its `MEASURED` framing.
- [ ] `docs/launch-checklist.md` §16 — note what the Postiz removal workstream inherits from Amendment A.
- [ ] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — cascade row(s) for any new table, or an
      explicit no-new-row note.
- [ ] `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` — §12 marked shipped; §14's R1/R3/R4
      marked adjudicated with their rulings; the dependency chain updated.
- [ ] `docs/backlog.md` — comment mining with its counsel condition; anything else I1 deferred, each with
      an un-defer trigger.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md`.
- [ ] `docs/reviews/session-32-reviewer.md` — exists, names its commit range, carries one appended
      correction-pass section.

**Next:** `docs/build-guide/session-33.md` — Track J, the outcome loop (ADR 0026): dimension tagging at
generation, pattern extraction from real metrics into `performance_memory`, and the campaign retrospective
that finally closes the loop the north-star metric is named after.
