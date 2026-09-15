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

> ### ✅ FOUNDER SIGN-OFF RECORDED — 2026-09-12 (I1 prerequisite gate, before the Architect proceeded)
>
> The warning above is left **exactly as written** (this repo appends, it does not overwrite). All three
> rulings are now adjudicated, and the fourth row settles the amendment-letter contradiction between §1/L-1
> and the 2026-09-03 reframe block. Two were confirmed as pre-filled; **one was amended**, and its
> pre-filled form is preserved below rather than rewritten.
>
> | # | Ruling | Founder decision | Effect on §0 |
> |---|---|---|---|
> | **R1** | 19D-5 — where the read path lives | **Option 1 as pre-filled** — `fetchRecentPosts` joins `SocialProvider`, with an ADR 0002 amendment as a named deliverable | **L-4 CONFIRMED**, D-1 unchanged |
> | **R3** | Comment mining vs. own-posts-only | **Own posts + aggregate metrics only, as pre-filled** — comments deferred to counsel with a named condition | **L-2 CONFIRMED**, D-3 unchanged |
> | **R4** | Backfill vs. the trial clock | **AMENDED — see `L-7′` below.** "Before the clock" was ruled unavailable on the evidence; the clock rule is untouched and the backfill is bound to a latency budget instead | **L-7 SUPERSEDED by L-7′**, D-6 restated |
> | **—** | Amendment letter for this session's read path | **Amendment B**, per the reframe block's own instruction (Session 30.5 took A) | §1/L-1's "Amendment A" is **wrong**; every reference reads **B** |
>
> **L-7′ — the backfill runs immediately AFTER the connect, bound to a stated latency ceiling, with the
> trial-clock rule untouched.** *(Supersedes L-7. Encodes R4′.)*
>
> **Why L-7 as pre-filled could not be encoded.** It is not a timing preference that was overruled — it is
> unimplementable as literally written, and L-7's own escape hatch ("if the ADR finds this unimplementable
> without changing the clock rule itself, it **STOPS and flags for founder adjudication**") is what fired.
> The clock is a **database trigger on the connect itself**:
> `supabase/migrations/20260430120008_social_accounts_trial_trigger.sql:9-38` —
> `AFTER INSERT ON public.social_accounts FOR EACH ROW`, `SECURITY DEFINER`, setting
> `trial_started_at = now()` for the business's first account and guarded `AND trial_started_at IS NULL`
> ("idempotent: never restart the clock"). The migration's own header states why it is in the DB and not in
> app code: *"the trial clock is billing-relevant and must not be skippable."* The backfill needs an OAuth
> token in Vault to read history from; that token exists only once the `social_accounts` row is inserted;
> the clock starts `AFTER INSERT` of that same row. **The window in which an account exists to read from but
> the clock has not started is of zero width** — a strict ordering, not a race. D-6's "before / after"
> framing was therefore a false dichotomy.
>
> **What R4 was actually protecting, and how L-7′ preserves it.** The intent was that a customer must not
> spend trial *days* waiting for their own history to import. L-7′ delivers that as a **latency guarantee
> rather than a re-timed clock**: the backfill starts immediately after the connect, runs in the background,
> onboarding remains usable throughout, and the ADR states a hard latency ceiling (minutes, not days) plus a
> visible progress state — specified in Q5 and tested under Q8. The concern is reduced to immateriality
> rather than eliminated, and that trade is the ruling.
>
> **Losers, named.** (a) Setting `trial_started_at` to backfill *completion* — gives literal "before the
> clock" semantics, but a stalled import becomes an unbounded free trial, which the trigger's own
> non-skippable rationale forbids. (b) Extending the 14 days by the measured import duration — honest and
> non-exploitable if capped, but makes the trial variable-length and drags in `find_trial_expiring_between`
> plus both billing surfaces (`app/[locale]/(dashboard)/billing/page.tsx:31-55`,
> `app/[locale]/(dashboard)/layout.tsx:46-49`) for a few minutes' gain. (c) Moving the clock trigger to a
> later event (first campaign, first post) — a genuine amendment to the locked strategic decision with
> pricing- and trial-copy consequences, and its own decision to take deliberately, never a Session 32
> side-effect.
>
> **Two consequences the ADR must carry.** (1) **No locked strategic decision is amended by Session 32** —
> "trial clock starts on first social account connection" stands verbatim, and the trigger is not touched;
> the ADR states the *interaction* explicitly, as L-7 originally required. (2) The trigger fires **once per
> business**, so under **L-11** a founder profile connected *after* the company page raises no clock question
> at all — only the very first connect does. Voice inference from the website
> (`lib/ai/website-fetcher.ts`, `lib/ai/prompts/brand-voice-inference.ts`, Reality §6) already runs genuinely
> pre-connection and is unaffected; the social read path is specifically the part that structurally cannot.

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

> ### ✅ FOUNDER ADJUDICATIONS RECORDED — 2026-09-12 (I1, after the three advisory reviews, before ADR text)
>
> The placeholder above is left exactly as written. Rows are recorded before ADR 0025 exists; the "Where
> encoded" column names the section each will land in, and the constraint count is stated at ADR close.
>
> | # | Question | Decision | Where encoded |
> |---|---|---|---|
> | **A-1** | Q1 — only X can serve history today; LinkedIn's member read scope (`r_member_social`) is review-gated behind a legal entity that does not exist; Meta/Threads have no provider | **Build both X and LinkedIn read implementations.** X is served. LinkedIn is implemented against LinkedIn's documented API but ships **not served** (`historicalReadAvailable: false`) until the scope is approved. The LinkedIn implementation is **UNVERIFIED against the live API** and must be re-verified when the gate opens; no coverage is claimed from it beyond the contract suite's not-served path. *Interpretation note: "build both" was read as X + a gated LinkedIn API read (the founder's "LinkedIn won't be functional for now"), not the LinkedIn data-export upload, which is **not scoped** and stays a named future option. The ADR states plainly that LinkedIn cold start is not solved by this session.* **Loser:** feeding the extractors from Jemip-published local posts as a LinkedIn mitigation (zero posts on day one = D-1's option 2 in substance; also collapses earned/imported provenance, D-4). | ADR 0025 §Q1 per-platform table; ADR 0002 Amendment B |
> | **A-2** | Q1 — read capability shape | **Eighth method on the flat `SocialProvider` interface**, gated by a static `historicalReadAvailable` flag, with a **mandatory flag-consistency assertion** in the shared contract suite (flag false ⇒ throws `NOT_IMPLEMENTED` with zero fetch calls; flag true ⇒ never throws `NOT_IMPLEMENTED`). The edit to `provider-contract.test.ts`'s seven-method assertion is explicitly authorised. **Loser:** a separate optional `HistoricalPostReader` interface (type-enforced, but a new pattern and a second registry map). | ADR 0002 Amendment B; ADR 0025 §Q8 |
> | **A-3** | Q1/Q2 — where imported post metrics come from | **Per platform.** X returns metrics inline on each `RecentPost` (one call, no extra reads against the shared 3M cap); LinkedIn returns posts without metrics and the orchestrator fetches them via `fetchPostMetrics`. The contract therefore defines `RecentPost.metrics: PostMetrics \| null` where `null` means **"not included in this read — fetch separately"**, never "platform does not expose it" (the Amendment A §A.3 ambiguity must not be re-imported). **Losers:** metrics always separate (uniform, but ~1 extra read per imported post on X); metrics always inline (X-shaped, unfillable on LinkedIn). | ADR 0002 Amendment B; ADR 0025 §Q3/§Q5 |
> | **A-4** | Q7 — lookback for founder (personal) and company accounts | **24 months, both account types**, alongside the post ceiling. | ADR 0025 §Q5 bounds; §Q7 |
> | **A-5** | Q7 — X Developer Agreement (deletion sync; stored content as AI context) | **Deferred to counsel as a launch-checklist item.** The ADR builds so both are satisfiable: imported memory is removable per source post, and no imported content feeds cross-customer learning. | ADR 0025 §Q7 counsel list; `launch-checklist.md` |
> | **A-6** | Q7 — republishing third-party quotes found in imported posts | **Every imported evidence row lands `public_use_permission = false`.** A founder may enable one only through a confirmation that they hold the quoted person's permission; **counsel approves that confirmation copy.** | ADR 0025 §Q3/§Q7; i18n copy gated on counsel |
>
> **Closing (2026-09-12, I1, after both documents were written).** Final locations: A-1 → ADR 0025 §2.7 and
> Amendment B §B.3; A-2 → ADR 0025 §2.1 and Amendment B §B.2–B.3; A-3 → ADR 0025 §2.2/§2.7 and Amendment B
> §B.2; A-4 → ADR 0025 §2.3; A-5 → ADR 0025 §8.4/§8.6; A-6 → ADR 0025 §4.5/§8.6. **Constraints the
> adjudications added:** `BACKFILL-READ-FLAG-CONSISTENT` (A-2), `BACKFILL-UNSUPPORTED-PLATFORM-HONEST` (A-1),
> `BACKFILL-PER-POST-REMOVABLE` and `BACKFILL-NO-CROSS-CUSTOMER-LEARNING` (A-5), `BACKFILL-EVIDENCE-NOT-PUBLIC`
> (A-6), and the 24-month bound inside `BACKFILL-RUN-BOUNDED` (A-4). **One rename:** `BACKFILL-BEFORE-TRIAL-CLOCK`
> is encoded as `BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED` (L-7′). **ADR 0025 total: 56 constraints — Tier 1: 16 ·
> Tier 2: 34 · Tier 3: 5 · Tier E: 1** (55 at first draft; `BACKFILL-IMPORT-IDEMPOTENT` added by the pre-Builder
> review fixes, 2026-09-13). Two interpretation notes for the founder are recorded in ADR 0025 §0
> (L-6 re-enters step-2 in backfill mode; the founder declares each account's brand/founder role at
> ratification). Neither contradicts a Locked decision.

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

**✅ AUTHORED 2026-09-13 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Gate satisfied: `docs/decisions/0025-social-read-path-and-backfill.md`
is **Accepted**, carrying **56 `BACKFILL-*` constraints (16 Tier 1 · 34 Tier 2 · 5 Tier 3 · 1 Tier E)**;
ADR 0002 **Amendment B** is appended; `§0.2` records **A-1 … A-6** with its closing block.

**Audit-trail precondition — before `I2.0` is pasted.** At authoring time ADR 0025 is **untracked** and
`session-32.md` / `0002-social-provider.md` carry uncommitted edits. The three governing documents are
committed **first, as their own docs-only commit**, and its SHA is the `base` the Reviewer reads against.
A Builder range whose governing ADR is not in git cannot be reviewed under `PROC-REVIEW-AT-COMMIT`.

**Five places where the ADR overrode the placeholder above, stated first because a Builder reading only the
placeholder would build the wrong session:**

1. **There is no `PostizProvider`, and the amendment is B.** The placeholder's step 3 reads
   *"then `PostizProvider`"*; per the 2026-09-03 reframe and ADR 0028 the implementations are
   **`TwitterProvider` (served)**, **`LinkedInProvider` (built, not served, UNVERIFIED — A-1)** and
   `MockProvider`. No step mentions Postiz except `no-postiz.test.ts`, which must stay green.
2. **A security migration precedes the provenance migration.** The placeholder put provenance first. ADR
   §7.3/§8.1 make the `social_accounts` identity lock a **legal precondition** — the processor posture is
   conditional on verified ownership, and without the lock a member can rewrite `platform_user_id` and import
   a stranger's timeline. It lands in `I2.4`, before any table the backfill writes.
3. **The placeholder's "scan proving no generation path changed" and "no `relationship_memory`" are Tier 3
   by the ADR** (`BACKFILL-NO-GENERATION-CHANGE`, `BACKFILL-NO-RELATIONSHIP-MEMORY`, §11.3) — diff-verified,
   **no runtime test by decision**. They are recorded in `I2.15` as exact `git diff` commands, each
   demonstrated to catch a temporary violation. Writing a vitest for them is not wrong, but claiming it as
   the Tier-3 proof is (ADR 0015 §2).
4. **`BACKFILL-BEFORE-TRIAL-CLOCK` does not exist.** It is `BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED` (L-7′,
   ADR §12 rename). The backfill runs immediately **after** connect; no migration touches the trial trigger.
5. **Voice ratification re-enters `step-2` in backfill mode, and step-4 stays the completion page** (ADR §0
   interpretation note 1, §10.1/§10.3). The placeholder's "reused ratification step" is not a new editor and
   not a new step.

**The ADR decisions I2 TRANSCRIBES rather than re-derives.** Every one carries a named loser in ADR 0025; a
Builder that changes one has re-opened an adjudicated decision.

| Decision | Value | ADR |
|---|---|---|
| Interface shape | **eighth method** `fetchRecentPosts` + static `historicalReadAvailable` on the flat `SocialProvider` | §2.1, B.2 |
| Flags as shipped | Twitter **true** · LinkedIn **false** · Mock **true** | §2.7, B.3 |
| Page size | **5–100, refused with `RangeError` before I/O — never clamped** | §2.3 |
| Content per post | **3,000 chars**, plain text, truncated | §2.2 |
| Run bounds | **200 posts · 24 months · 5 pages · 500 platform reads · 50¢** | §2.3, §6.1 |
| Timeout / Retry-After | **10,000 ms · capped at 900 s · provider never sleeps** | §2.3 |
| `metrics: null` | **"not included — fetch separately"**, never "not exposed" | A-3, §2.2 |
| Original post | **not a reply, not a repost, not a quote**; X `exclude=replies,retweets`, no `referenced_tweets` expansion | §2.4 |
| Provenance marker | **`source='import'` ⇔ `import_run_id` NOT NULL ⇔ `import_source_post_ids` NOT NULL**, immutable by trigger, FK `ON DELETE NO ACTION` | §5.1 |
| Recency | **`last_confirmed_at` = source post date** (newest backing post for performance); ratify never touches it | §5.3 |
| Confidence | performance **`0.6 × n/(n+5)`** (≤ 0.6) · audience **0.3** · evidence **0.5** | §5.5 |
| Performance gate | **n ≥ 5 and median lift ≥ 1.25, recomputed by us; the model never supplies n or confidence** | §4.3 |
| Performance expiry | **newest backing post + 12 months**; not written if already expired | §4.3 |
| Weighted subset | **top 30 by lift**; no metrics ⇒ **30 most recent**, `weighting='unweighted_no_metrics'` | §4.1 |
| Model passes | **exactly three**: voice (Sonnet, top 20), insights (Sonnet, 30), evidence (Haiku, batches of 20) | §4.1, §6.2 |
| Write caps per account | evidence **40** · audience **25** · performance **15** · voice examples **3** | §4.2–§4.5 |
| Evidence | **verbatim substring ≤ 500 chars; `public_use_permission = false` fixed in SQL** | §4.5, A-6 |
| Brand memory | **none written** | §4.6 |
| Voice | **staged on the run row; applied only by `apply_backfill_voice`**; brand ⇒ `brand_voices`; founder ⇒ a variation, **axes only** | §4.2 |
| Budget | new purpose **`backfill_cents`**, `BACKFILL_DAILY_CENTS = 150`, per-run `spend_cents` reserved atomically; **trial counters neither checked nor incremented** | §6.3 |
| Where it runs | enqueue in the OAuth callback + `after()` tick; **`/api/cron/backfill` every minute**; orchestrator in **`lib/backfill/`** | §6.5 |
| Latency / stall | **10-minute target** (operational) · **30-minute stall ⇒ `failed`** (tested) | §6.6 |
| Staging TTL | **30 days** | §8.3 |
| Once per account | partial UNIQUE `WHERE status <> 'discarded'`; **≤ 3 runs**; resume = `failed → queued` **on the same row** | §6.5, §9.1 |
| Ratify | `ratify_backfill_run(p_user_id, …)` **service_role-only**, `p_user_id` from the server-verified session, checked against `business_members` | §9.4 |

**Ordering, restated as binding.** Each position is forced by something that breaks under the alternative.

1. **`I2.0` grounds and ships nothing.** ADR 0025 cites ~120 `file:line` locations written against a tree
   that Session 31's correction pass (D1–D20) was still moving. The two most consequential premises: the
   authenticated table-level UPDATE grant on `social_accounts` (§7.3 — if it has changed, the column-revoke
   design changes shape) and the `ai_budget_daily` purpose CHECK's **real** name (a later migration,
   `20260912100000_ai_budget_daily_constraint_names.sql`, post-dates the ADR's cited `20260909110000`).
2. **Boundary scans before the code they fence (`I2.1`)** — the ADR 0023 G1b.2 precedent. `lib/backfill/`
   is created in this step with its constants file, so the scans have a real, non-empty target and cannot
   pass vacuously.
3. **The contract and an honest mock (`I2.2`) before any real implementation (`I2.3`).** Both native
   providers ship a `false`-flag stub in `I2.2` so the tree compiles; **`I2.3` flips Twitter to `true`** and
   adds an assertion that pins the §B.3 as-shipped table, so a stub left `false` cannot survive to review.
4. **The identity lock (`I2.4`) before any backfill table.** Legal precondition (§8.1), not hardening.
5. **Runs and staging (`I2.5`) before provenance (`I2.6`)** — the memory FK references
   `social_backfill_runs(id)`.
6. **Provenance (`I2.6`) before any writer (`I2.7`)** — a row written without the marker can never be
   retro-marked correctly (L-3).
7. **Fetch (`I2.8`) → enqueue/cron/sweeps (`I2.9`) → deterministic extraction (`I2.10`) → model passes
   (`I2.11`, `I2.12`)** — deterministic before model-derived (L-8), and evidence separated from voice/insights
   because it is the only Haiku batch loop and the only verify-then-cite path.
8. **Ratify / discard / apply-voice (`I2.13`) before the surface (`I2.14`)** — the surface renders states
   those actions create.
9. **Tier-3 enumeration, the constraint→CI map, and the owed legal/doc items (`I2.15`) last.**

**Scope tripwires — executable, not prose:**

- **`BACKFILL-NO-COMMENT-READ`** (Tier 2 source scan, `I2.1`) — no `fetchEngagement`, `liking_users`,
  `retweeted_by`, `liked_tweets`, `quote_tweets` or comment endpoint referenced from `lib/backfill/**` or any
  `fetchRecentPosts` body.
- **`BACKFILL-NO-URL-FETCH`** (Tier 2 source scan, `I2.1`) — `lib/backfill/**` imports no
  `website-fetcher` and calls no `fetch`.
- **`BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL`** (Tier 2, `I2.1`) — `eslint-internals-ban.test.ts` fires
  for a probe placed under `lib/backfill/` (ADR §3 last paragraph: add a second probe if the existing one does
  not cover it).
- **Tier 3, diff-verified (`I2.15`):** no trial trigger / `trial_state` / `find_trial_expiring_between`
  change; no `relationship_memory`; no `CustomerContext` or generation-prompt change; no new token-bearing type;
  no cross-business aggregate.
- **L-1 out-of-scope, STOP-and-report:** comment/reply mining, embeddings or exemplar *selection*, the outcome
  loop, memory-driven cards, any retrieval change, LinkedIn `fetchPostMetrics`, widening
  `brand_voice_variations` or the `writing_examples` CHECK, the evidence permission-enablement UI (A-6 copy is
  counsel-gated).

**Each scan is demonstrated to REDDEN against a temporary violation and then reverted.** A scan that has
never failed is a comment with a test runner attached.

**Definition of done for every step:** `npm run typecheck` clean; `npm run test:app` green;
`npm run test:db` green where the step touches DB behaviour; each named constraint **demonstrated to redden
against the pre-fix code and then reverted**; one commit per step whose subject names the step id and the
constraints it closes. **Never bare `npx vitest run`** — it picks up ECC test files that call
`process.exit()`.

**ECC budget for the Builder phase — three subagent invocations, total.** This session has sixteen steps
and it is tempting to put a reviewer on each; **don't** — each spawn starts cold and re-reads what the
Builder already has in context, and the Reviewer (`I3`) exists for exactly that audit.
- **One `ecc:code-explorer`** in `I2.0`, over that step's closed file list and no other.
- **One `ecc:security-reviewer`** at the end of `I2.4`, scoped to the **`I2.3` + `I2.4` diffs together** —
  the provider read path (identity verification, `details` redaction, untrusted text, token handling) and the
  `social_accounts` privilege lock are the session's two attack surfaces, and they share one threat: importing
  an account the customer does not own.
- **One `ecc:database-reviewer`** at the end of `I2.6`, **before `I2.6` is committed**, over the three
  migration files of `I2.4`, `I2.5` and `I2.6`. Findings against an already-committed migration are fixed by a
  **forward migration inside `I2.6`**, never by editing a committed file.
- **No reviewer per step, no re-consultation, no subagent for the repetitive per-type extractor or i18n
  work** — those are pattern repetition inside one context, which is the cheapest place to do them.

**Skills are free and do not count:** `/ecc:plan` → `/ecc:tdd-workflow` → `/ecc:verification-loop` on every
code step; `supabase:supabase-postgres-best-practices` while authoring `I2.4`–`I2.6`;
`ecc:cost-aware-llm-pipeline` (a **skill**, not an agent — the Session 28 error) in `I2.11` for the reservation
estimate; **`taste-skill` then `impeccable` in `I2.14` only**, against ADR 0025 §10 — `taste-skill` first
because the "what we learned" panel is a *new* surface that needs a point of view (it is the product's first
real payoff, §10.4), then `impeccable` to audit every §10.2 state, accessibility, responsive behaviour and copy
against the contract. Neither may add a state, reorder §10.4's hierarchy, or offer evidence permission.

**Cost note, so it is not discovered mid-run.** The in-session model passes run against the mock client and
cost nothing. **`BACKFILL-POPULATED-MEMORY-EVAL` (Tier E) is NOT run by the Builder** — it is an out-of-band,
founder-triggered live run (§11.4) with real spend; `I2.15` records its protocol and marks it
`MEASURED — not yet run`. `eval-triage.yml` gates on triage paths; if no Session 32 file matches its filter it
exits `applicable: false`, and **reporting that green is reporting nothing**.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 32 Track I - BUILDER phase (I2). You implement ADR 0025 and ADR 0002 Amendment B. You write code;
you do NOT make architectural decisions. Every decision you need has already been made and carries a named
loser. If you find yourself choosing between two designs, STOP and report - that is an ADR gap, not your
call.

PRECONDITION: git status must show docs/decisions/0025-social-read-path-and-backfill.md,
docs/decisions/0002-social-provider.md and docs/build-guide/session-32.md COMMITTED and clean. If any is
untracked or modified, STOP - the Reviewer cannot read an ADR that is not in git. Record that commit's SHA
as BASE in your acknowledgement.

READ FIRST, in this order:
- docs/decisions/0025-social-read-path-and-backfill.md - ALL of it. Section 12 (56 constraints) is your
  checklist. Sections 2, 4, 5, 6, 7 and 9 are the ones you will transcribe numbers from.
- docs/decisions/0002-social-provider.md - Amendment A (native providers) and Amendment B (the read path).
- docs/build-guide/session-32.md - the goal block INCLUDING the 2026-09-03 reframe, Section 0 (L-1..L-11
  with L-7 SUPERSEDED BY L-7'), and Section 0.2 (A-1..A-6). SECTION 0.2 IS YOUR GATE.
- docs/decisions/0016-governed-memory.md - the four stores, MEM-NO-DIRECT-TABLE-ACCESS,
  MEM-VOICE-THROUGH-EXISTING, and why relationship_memory is parked.
- docs/decisions/0015-test-execution-and-ci-gates.md - Section 2 (tiers) and Amendment B (Tier E).
- docs/decisions/0010-legal-surface.md Amendment 2 Section D2.5 - you add two rows.
- CLAUDE.md - the SocialProvider boundary, Vault token storage, the three Supabase clients, RLS and the
  erasure cascade, atomic transitions, Zod, i18n, bounded queries, UI Component patterns, test-execution
  integrity, and the Legal pages section.

BINDING RULES YOU WILL BE REVIEWED AGAINST:

1. TRANSCRIBE, DO NOT RE-DERIVE. Page size 5..100 REFUSED with RangeError before I/O, never clamped.
   200 posts, 24 months, 5 pages, 500 platform reads, 50 cents per run. 10000 ms timeout, Retry-After capped
   at 900 s, the provider never sleeps. Confidence: performance 0.6*n/(n+5), audience 0.3, evidence 0.5.
   Performance needs n >= 5 AND median lift >= 1.25, recomputed by you from staging - the model never
   supplies n or confidence. Caps per account: evidence 40, audience 25, performance 15, voice examples 3.
   Exactly THREE model passes. Every one of these lives as a named constant in lib/backfill/constants.ts
   (or lib/social/ for the provider-owned bounds) with a comment citing its ADR section.

2. POSTIZ IS GONE; THE AMENDMENT IS B. Implementations are TwitterProvider (historicalReadAvailable TRUE),
   LinkedInProvider (FALSE - built against LinkedIn's docs, UNVERIFIED, NOT SERVED, A-1) and MockProvider
   (TRUE). You claim NO coverage for the LinkedIn read body beyond its not-served path. Do not implement
   LinkedIn fetchPostMetrics - it still throws NOT_IMPLEMENTED (Amendment B Section B.5).

3. OWN ORIGINAL POSTS AND AGGREGATE COUNTS ONLY (L-2). No reply, repost or quote is returned. No comment,
   liker, reposter, quote author, referenced post, mention target or media URL is requested, typed, stored
   or logged. RecentPost has no field for any of them - do not add one. If a step appears to need one, STOP.

4. THE CONTRACT IS ACCOUNT-SHAPED (L-11). fetchRecentPosts takes socialAccountId. A founder account and a
   company account on one business NEVER mix: separate runs, separate extraction, separate voice synthesis,
   separate ratification. A founder voice becomes a brand_voice_variations row, AXES ONLY; a brand voice goes
   to brand_voices. The founder DECLARES the role at ratification; it lives on the run row, never on
   social_accounts.

5. PROVENANCE IS PERMANENT (L-3). source='import' iff import_run_id NOT NULL iff import_source_post_ids NOT
   NULL, on all four *_memory tables, enforced by CHECKs and a BEFORE UPDATE trigger that rejects any change
   to the three columns. Imported rows are NEVER promoted to earned. last_confirmed_at is the SOURCE post
   date; ratification never touches it.

6. NOTHING IS ACTIVE BEFORE RATIFICATION. Every import row lands status='candidate'. The ONLY path to
   'active' is ratify_backfill_run. Staged voice never reaches brand_voices or a variation except through
   apply_backfill_voice. Skipping onboarding ratifies nothing.

7. THE IDENTITY LOCK IS A LEGAL PRECONDITION (ADR 7.3, 8.1). A column-level REVOKE does NOT work here:
   authenticated holds a TABLE-level UPDATE (20260707190000_service_role_table_grants.sql:28). REVOKE UPDATE
   ON the table, then GRANT UPDATE (allowlist) - the allowlist enumerated from the LIVE table definition and
   recorded in the migration header. Plus X token identity verified against platform_user_id on every
   run's first page, fail closed.

8. THE TRIAL CLOCK IS UNTOUCHED (L-7'). No migration touches the social_accounts trial trigger,
   trial_state, or find_trial_expiring_between. The backfill runs AFTER connect. Backfill prompt ids neither
   check nor increment either trial counter - an import is not a generated post.

9. NO LOOKUP BY GUESSED NAME. The ai_budget_daily purpose CHECK is found in pg_constraint by its
   definition, the migration RAISES unless exactly one matches, drops it by that name, and re-adds it
   EXPLICITLY NAMED ai_budget_daily_purpose_check with every existing purpose plus backfill_cents. A guessed
   DROP CONSTRAINT IF EXISTS silently no-ops and every backfill write is rejected.

10. POST TEXT IS UNTRUSTED. neutralizeWithSentinels at the WRITE CHOKE POINT of each import writer, not at
    the call site. [DATA]...[/DATA] around post text in every prompt. No URL in post text is ever fetched.
    SocialProviderError.details and the tick log carry reason codes and numbers only - never content,
    cursors or tokens.

11. SERVICE-ROLE DISCIPLINE. Import writers, the claim RPC, the spend reservation, ratify and discard are
    SECURITY DEFINER, EXECUTE granted to service_role ONLY, with an explicit REVOKE from PUBLIC, anon and
    authenticated. ratify's p_user_id comes from supabase.auth.getUser() on the anon server client - never a
    form field - and is checked against business_members. lib/db functions that use service-role acquire
    their own client via the lazy-import pattern and take no client parameter.

12. GDPR. Two new business-scoped tables, both ON DELETE CASCADE from businesses, both with the ADR 9.2 rows
    added VERBATIM to ADR 0010 Amendment 2 Section D2.5 IN THE SAME COMMIT as the migration. purge_business
    is proven by a live-Postgres case, not argued from the FK.

13. SHARED-FUNCTION CALLERS. Before marking ANY constraint on a shared function tested, git grep its callers
    and state PER CALLER which test exercises it. ADR 11.5 lists seven: upsertBrandVoice, the runner trial
    classification, updateSocialAccount, TwitterProvider.refreshAccessToken, the OAuth callback route (TWO
    entry paths - onboarding and settings), deactivateSocialAccount, and the ai_budget_daily purpose CHECK's
    existing writers. A caller with no listed test is AUTHORED-NOT-EXECUTED for that caller. Both Session 22
    blockers were this.

14. CONTRACT DISCIPLINE: DB only via lib/db/ and lib/memory/ (no *_memory table read or written outside
    lib/db/memory-*); lib/social only via lib/social/index.ts; Anthropic only via lib/ai/ with
    CustomerContext; Zod on every route and Server Action input; atomic conditional UPDATEs; every list query
    bounded with an explicit ORDER BY matching an index; date-fns and formatISO(); no `any`; no console.*
    except the ONE canonical structured-JSON line in the cron route; env only via lib/config.ts; i18n
    en/pt/es in the same commit; shadcn v4 / Base UI with NO asChild on Button or DropdownMenu primitives.

15. LEGAL PROSE. /privacy prose and the evidenceRef bump are owed (ADR 8.2) and land in I2.15 as a
    counsel-ready draft. [LEGAL ENTITY] placeholders are NOT substituted. The evidence permission-enablement
    UI is NOT built - its copy is counsel-gated (A-6).

ECC BUDGET FOR THIS PHASE: THREE subagent invocations, total. One ecc:code-explorer in I2.0. One
ecc:security-reviewer at the end of I2.4 over the I2.3 + I2.4 diffs. One ecc:database-reviewer at the end of
I2.6, before it commits, over the I2.4, I2.5 and I2.6 migrations. No reviewer per step, no re-consultation,
no subagent for repetitive extractor or i18n work. Skills are free: /ecc:plan, /ecc:tdd-workflow,
/ecc:verification-loop every code step; supabase:supabase-postgres-best-practices for I2.4-I2.6;
ecc:cost-aware-llm-pipeline (a SKILL) in I2.11; taste-skill then impeccable in I2.14 ONLY, against ADR 0025
Section 10.

DO NOT RUN any live eval or any live platform call. BACKFILL-POPULATED-MEMORY-EVAL is out-of-band and
founder-triggered; you record its protocol in I2.15 and mark it not yet run.

VERIFICATION, every step: npm run typecheck ; npm run test:app ; npm run test:db where the step touches DB
behaviour. NEVER bare `npx vitest run`. If test:db fails, distinguish a DB-behaviour regression from the
known supautils SIGSEGV in the local Postgres stack (Session 31-D D20) and say which. Each named constraint
must be DEMONSTRATED TO REDDEN against the pre-fix code and then reverted. One commit per step, subject naming
the step id and the constraints it closes.

Acknowledge in ONE line: the BASE SHA, confirmation you have read ADR 0025 Sections 2, 4-7, 9, 10 and 12 and
Amendment B, and that you understand rule 1 (transcribe) and rule 6 (nothing active before ratification).
Then STOP and wait for I2.0.
```

### §2b — Builder steps

Each step is one paste, one commit. **A step that closes no ADR constraint does not exist** — `I2.0` is the
one deliberate exception (premise risk). **All 56 constraints are closed by exactly one step**; verify the
mapping before claiming completion, and **do not claim a count until it is executed green in CI at the head
it is dated to** (Session 28's false *"29/29"*).

| Step | What it ships | Constraints closed (ADR §12 #) | Tier |
|---|---|---|---|
| **I2.0** | **Grounding — no code, no commit.** | — | — |
| **I2.1** | `lib/backfill/constants.ts` + the three boundary scans, each reddened | `NO-COMMENT-READ` (7), `NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL` (11), `NO-URL-FETCH` (37) | 2 |
| **I2.2** | Types + interface + flag; `MockProvider` fixtures; contract suite 7→8; `SOCIAL-NO-READ-PATH` inverted; both native providers stubbed `false` | `READ-ON-ABSTRACTION` (1), `READ-FLAG-CONSISTENT` (2), `PROVIDER-BOUNDED` (3), `MOCK-FIXTURES-MEANINGFUL` (10) | 2 |
| **I2.3** | `TwitterProvider.fetchRecentPosts` (flag → `true`) on recorded fixtures; `LinkedInProvider` body built, flag stays `false` | `CURSOR-ACCOUNT-BOUND` (4), `OWN-POSTS-ONLY` (5), `IDENTITY-VERIFIED` (6), `PROVIDER-NEVER-SLEEPS` (8), `VAULT-PATH-REUSED` (12) | 2 |
| **I2.4** | Migration 1 — `social_accounts` UPDATE allowlist + `scopes_granted`; callback + X refresh write it · **security-reviewer** | `SOCIAL-ACCOUNT-IDENTITY-LOCKED` (14), `SCOPES-PERSISTED` (15) | **1** + 2 |
| **I2.5** | Migration 2 — `social_backfill_runs`, `social_backfill_posts`, RLS, claim RPC, spend reservation, `backfill_cents` purpose, discard RPC, §D2.5 rows | `ONCE-PER-ACCOUNT` (18), `CLAIM-ATOMIC` (19), `COST-CEILINGED` (22), `BUDGET-PURPOSE` (23), `RLS-ISOLATED` (47), `CASCADE-COMPLETE` (48) | **1** |
| **I2.6** | Migration 3 — provenance on four memory tables, trigger, run-scoped import indexes, import RPCs, `ratify_backfill_run`, per-post removal · **database-reviewer** | `NOTHING-ACTIVE-BEFORE-RATIFY` (21), `EVIDENCE-NOT-PUBLIC` (34), `PROVENANCE-MARKED` (38), `PROVENANCE-IMMUTABLE` (39), `PROVENANCE-SURVIVES-PROMOTION` (40), `PER-POST-REMOVABLE` (43), `RATIFY-ATOMIC` (45), `PURGE-COVERED` (49), `IMPORT-IDEMPOTENT` (56) | **1** |
| **I2.7** | `lib/db/` wrappers + `lib/memory/` import writers, sentinel-guarded, source-dated | `SENTINEL-GUARDED` (35), `SOURCE-DATED` (41) | 2 |
| **I2.8** | Orchestrator fetch phase → staging, bounds, dedupe, unsupported path | `RUN-BOUNDED` (16), `X-READ-BOUNDED` (17), `UNSUPPORTED-PLATFORM-HONEST` (29) | 2 |
| **I2.9** | Enqueue in callback + `after()` tick; `/api/cron/backfill`; stall + TTL sweeps; disconnect cancels | `ERROR-DETAILS-CONTENT-FREE` (9), `LATENCY-BOUNDED` (26), `DISCONNECT-CANCELS` (27) | 2 |
| **I2.10** | Deterministic stats, lift, weighted subset, `format` patterns | `PERFORMANCE-WEIGHTED` (31), `CONFIDENCE-CAPPED` (32) | 2 |
| **I2.11** | Voice + insights passes; runner trial exemption; per-call reservation | `TRIAL-CAPS-UNTOUCHED` (24), `DETERMINISTIC-FIRST` (30) | 2 |
| **I2.12** | Evidence pass (Haiku, batched, verify-then-cite) | `EVIDENCE-VERBATIM` (33) | 2 |
| **I2.13** | Ratify / discard / apply-voice Server Actions; resume on the same row | `RESUMABLE-OR-DISCARDED` (20), `STAGING-PURGED` (28), `WRITE-CAPS` (36), `ACCOUNTS-SEPARATE` (42), `VOICE-RATIFIED` (44), `VOICE-RETRYABLE` (46) | 2 |
| **I2.14** | Onboarding surface — step-4 panel, step-2 backfill mode, banner · **taste-skill → impeccable** | `UX-STATES` (53), `I18N-PARITY` (54) | 2 |
| **I2.15** | Tier-3 diffs, constraint→CI map, Tier-E protocol, legal/doc owed items | `NO-RAW-TOKEN` (13), `AFTER-CONNECT-CLOCK-UNTOUCHED` (25), `NO-RELATIONSHIP-MEMORY` (50), `NO-GENERATION-CHANGE` (51), `NO-CROSS-CUSTOMER-LEARNING` (52), `POPULATED-MEMORY-EVAL` (55) | 3 + E |

**Tally: 3 + 4 + 5 + 2 + 6 + 9 + 2 + 3 + 3 + 2 + 2 + 1 + 6 + 2 + 6 = 56.** Tier 1: 14, 18, 19, 21, 22, 23, 34,
38, 39, 40, 43, 45, 47, 48, 49, 56 = **16**. Tier 3: 13, 25, 50, 51, 52 = **5**. Tier E: 55 = **1**.
(`BACKFILL-` prefix dropped in the table for width; every commit subject and test title uses the full name.)

The sixteen pastes follow, one per step.

#### I2.0 — Grounding pass: re-verify every ADR premise  ·  no code, no commit

```
BUILDER - Session 32 - I2.0. NO CODE, NO COMMIT. Produce a premise -> file:line -> still-true? table before
anything is built. ADR 0025 cites ~120 locations and was written while Session 31-D was still moving the
tree. If a premise has drifted, the step that depends on it is NOT built until the drift is reconciled and
recorded here.

Invoke ecc:code-explorer ONCE over exactly this closed file list and no other:
  lib/social/types.ts, index.ts, registry.ts, vault.ts, errors.ts, error-mapping.ts, mock-provider.ts,
  twitter-provider.ts, linkedin-provider.ts, platforms/config.ts
  lib/social/__tests__/provider-contract.test.ts, no-read-path.test.ts, eslint-internals-ban.test.ts,
  mock-provider.test.ts, twitter-provider.test.ts
  app/api/social/[platform]/callback/route.ts, app/api/social/[platform]/disconnect/route.ts,
  app/api/cron/sync-metrics/route.ts
  lib/db/social-accounts.ts, lib/db/brand-voices.ts, lib/db/memory-performance.ts, lib/db/memory-evidence.ts,
  lib/db/memory-audience.ts, lib/db/generation-budget.ts, lib/db/signal-triage-budget.ts
  lib/memory/scoring.ts, lib/memory/constants.ts, lib/memory/types.ts (or wherever MemorySource lives)
  lib/learning/orchestrator.ts, lib/learning/summarize.ts, lib/learning/promote.ts
  lib/ai/runner.ts, lib/ai/models.ts, lib/ai/prompts/brand-voice-inference.ts
  app/[locale]/(dashboard)/onboarding/actions.ts, step-1/actions.ts, step-2/page.tsx, step-2/Step2Form.tsx,
  step-2/actions.ts, step-3/page.tsx, step-3/Step3Client.tsx, step-4/page.tsx
  supabase/migrations/20260430120008_social_accounts_trial_trigger.sql,
  20260430120005_brand_voices.sql, 20260430120017_fix_rls_function_caching.sql,
  20260623210000_voice_axes.sql, 20260707190000_service_role_table_grants.sql,
  20260702120200_user_can.sql, 20260702120700_purge_business_member_delete.sql,
  the governed_memory migration, 20260726020000*, 20260726030000*,
  20260909110000_ai_budget_daily_rename.sql, 20260912090000_ai_budget_rpc_revoke_named_roles.sql,
  20260912100000_ai_budget_daily_constraint_names.sql
Ask it ONE question: "for each file, what does it currently do with provider reads, tokens, social_accounts
grants, memory provenance, trial counters, the daily budget purpose, and onboarding voice - with line
numbers?" Do not ask it to propose changes.

VERIFY THESE PREMISES SPECIFICALLY. Each is load-bearing for a named later step.

1. NO READ PATH. git grep fetchRecentPosts and historicalReadAvailable across the WHOLE repo: zero hits
   outside docs/. no-read-path.test.ts:29-43 asserts absence (I2.2 inverts it).
   provider-contract.test.ts:81-89 asserts SEVEN methods; :145-183 is SOCIAL-MOCK-MODE-OFFLINE.
2. THE INTERFACE AND ERRORS. SocialProvider at types.ts:120-145; the EIGHT SocialProviderError codes at
   types.ts:7-15; error-mapping.ts:6-8 says publish-only; errors.ts:44 redacts by KEY only.
3. THE MOCK IS NON-DETERMINISTIC TODAY. mock-provider.ts:72-74 crypto.randomUUID(); :126 returns [];
   maybeThrow at :61-70. registry.ts:44-54 registers Mock for all five platforms; :67-71 no Meta provider.
4. THE VAULT PATH. withFreshToken vault.ts:85-110 -> get_vault_secret :38-49; twitter-provider.ts:244-277
   uses it for publish. List every get_vault_secret call site - I2.3's scan asserts the count does not grow.
5. SCOPES. platforms/config.ts:29 X scopes include tweet.read, users.read, offline.access; :22 LinkedIn has
   no read scope. twitter-provider.ts:183 platform_user_id is numeric; linkedin-provider.ts:147 person URN.
6. THE GRANT THAT MAKES A COLUMN REVOKE USELESS. 20260707190000_service_role_table_grants.sql:28 grants
   table-level UPDATE to authenticated. social_accounts_update_own at
   20260430120017_fix_rls_function_caching.sql:69-72. SocialAccountUpdate at types.ts:233-236. git grep
   updateSocialAccount (social-accounts.ts:76-90) and publish a caller table: caller, client passed,
   columns written. IF ANY authenticated-client caller writes a column the ADR 7.3 allowlist excludes,
   name it - I2.4 re-points it. Dump the LIVE social_accounts column list for the allowlist.
7. THE BUDGET CHECK'S REAL NAME. The ADR cites 20260909110000_ai_budget_daily_rename.sql:58-59, but
   20260912100000_ai_budget_daily_constraint_names.sql post-dates it. Read both and state the purpose
   CHECK's CURRENT name and its CURRENT value list. Write (do not run in a migration yet) the pg_constraint
   lookup I2.5 will use and confirm against the local DB that it returns EXACTLY ONE row. List every writer
   of ai_budget_daily by purpose (generation-budget.ts, signal-triage-budget.ts, their tests).
8. THE TRIAL CLOCK. 20260430120008_social_accounts_trial_trigger.sql:9-38 AFTER INSERT, SECURITY DEFINER,
   guarded trial_started_at IS NULL. Record the trigger, function and trial_state objects by name - I2.15's
   Tier-3 diff checks nothing touches them.
9. RUNNER TRIAL CLASSIFICATION. runner.ts:33-60 (isBrandVoice etc.), :95-99 (refusals), :281-287
   (increments). The summariser exemption summarize.ts:161-163. State the exact predicate I2.11 extends and
   list every existing prompt id each predicate matches today.
10. MEMORY PROVENANCE PREMISES. MemorySource includes 'import' (types.ts:1121) with NO writer today (grep
    for any row or literal writing source 'import'). recency_at generated from last_confirmed_at/created_at
    (types.ts:1126-1130). upsert_distilled_performance_pattern conflict target WHERE source='distilled'
    (20260726030000*:63-70). trg_performance_memory_voice_write_guard fires only for 'distilled'
    (20260726020000*:90). recencyDecay throws on non-finite (scoring.ts:36-38); retrieval returns active only
    (scoring.ts:87-91). neutralizeWithSentinels at memory-performance.ts:127. Authenticated INSERT/UPDATE
    policies on the memory tables (governed_memory.sql:66-73) - confirm source is currently mutable.
11. VOICE STORES. brand_voices CHECK cardinality(writing_examples) <= 3 (20260430120005:15);
    upsertBrandVoice overwrites on business_id (brand-voices.ts:18-30); brand_voice_variations stores name
    and voice_axes ONLY (20260623210000:47-77); voice_variation_cap_reached at :140 (cap 5). git grep
    upsertBrandVoice callers (ADR 11.5: infer-brand-voice/actions.ts:36-46, step-2/actions.ts:30-36).
12. THE ENTRY POINTS. callback/route.ts:135-155 upserts on (business_id, platform, platform_user_id);
    :84,98,113 consume TokenSet. after() precedent step-1/actions.ts:53-55. deactivateSocialAccount
    social-accounts.ts:92-125 and its caller disconnect/route.ts:80. sync-metrics route: dual-mode auth,
    maxDuration, the canonical log line, Sentry.withMonitor - record each with a line number. How does the
    callback know whether it was entered from onboarding step-3 or from settings? Both paths must be tested
    in I2.9.
13. ONBOARDING. step-3/page.tsx:11 and Step3Client.tsx:157-167 (connect); step-4/page.tsx:15-31 (heading +
    completeOnboardingAction form); Step2Form.tsx:150-157 (VoiceEditor); skipOnboardingAction
    onboarding/actions.ts:12-14.
14. THE CLAIM IDIOM AND PURGE. claim_post_edit_signals / FOR UPDATE SKIP LOCKED at
    lib/learning/orchestrator.ts:352-355; purge_business root DELETE at
    20260702120700_purge_business_member_delete.sql:62; user_can returns false under service role
    (20260702120200_user_can.sql:15-16).
15. THE ESLINT PROBE. eslint-internals-ban.test.ts:53-75 - does any probe path fall under a directory
    pattern that would cover lib/backfill/? Answer yes/no with the glob. I2.1 adds a probe if no.
16. THE EVAL FILTER. Read .github/workflows/eval-triage.yml's path filter verbatim and state whether
    lib/backfill/** or lib/social/** matches it.

OUTPUT: the premise table; caller tables for updateSocialAccount, upsertBrandVoice, the runner trial
predicates, get_vault_secret, and the ai_budget_daily writers; the live social_accounts column list with the
proposed UPDATE allowlist; the budget CHECK's current name and the lookup query's row count; and an explicit
list of any DRIFTED premise with the step it affects. No code. No commit. Then STOP.
```

#### I2.1 — `lib/backfill/` constants and the three boundary scans  ·  before the code they fence

```
BUILDER - Session 32 - I2.1. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the lib/backfill/ directory with its constants, and the scans that fence it - BEFORE any code exists
that could violate them (the ADR 0023 G1b.2 precedent).

1. lib/backfill/constants.ts - transcribe, each with a one-line comment citing its ADR 0025 section:
   BACKFILL_MAX_POSTS = 200, BACKFILL_LOOKBACK_MONTHS = 24, BACKFILL_MAX_PAGES = 5,
   BACKFILL_MAX_PLATFORM_READS = 500, BACKFILL_RUN_CEILING_CENTS = 50, BACKFILL_DAILY_CENTS = 150,
   BACKFILL_WEIGHTED_SUBSET = 30, BACKFILL_VOICE_INPUT_POSTS = 20, BACKFILL_EVIDENCE_BATCH = 20,
   BACKFILL_EXTRACTION_TRUNCATE_CHARS = 1000, BACKFILL_VOICE_EXAMPLES = 3, BACKFILL_VOICE_EXAMPLE_MAX_CHARS
   = 1000, BACKFILL_EVIDENCE_CAP = 40, BACKFILL_AUDIENCE_CAP = 25, BACKFILL_PERFORMANCE_CAP = 15,
   BACKFILL_EVIDENCE_MAX_CHARS = 500, BACKFILL_PATTERN_MIN_N = 5, BACKFILL_PATTERN_MIN_LIFT = 1.25,
   BACKFILL_CONFIDENCE_CEILING = 0.6, BACKFILL_AUDIENCE_CONFIDENCE = 0.3, BACKFILL_EVIDENCE_CONFIDENCE = 0.5,
   BACKFILL_AUDIENCE_MIN_BACKING = 2, BACKFILL_EXPIRY_MONTHS = 12, BACKFILL_MAX_RUNS_PER_ACCOUNT = 3,
   BACKFILL_LATENCY_TARGET_MINUTES = 10, BACKFILL_STALL_MINUTES = 30, BACKFILL_STAGING_TTL_DAYS = 30.
   Provider-owned bounds (RECENT_POSTS_PAGE_SIZE_MIN/MAX, RECENT_POST_CONTENT_MAX_CHARS,
   SOCIAL_READ_TIMEOUT_MS, SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS) belong to lib/social/ and land in I2.2 -
   NOT here, because lib/backfill must not own a provider contract.
   A Tier-2 frozen test pins every value, so a later "tweak" reddens.

2. lib/backfill/__tests__/source-scans.test.ts (on the lib/signals/source-scans.test.ts precedent):
   - BACKFILL-NO-COMMENT-READ: no occurrence of fetchEngagement, liking_users, retweeted_by, liked_tweets,
     quote_tweets, /replies, conversation_id, or a LinkedIn socialActions/comments path in lib/backfill/**,
     AND none inside the fetchRecentPosts implementation bodies in lib/social/*-provider.ts (extract the
     method body; do not ban those words from the whole provider file, which legitimately has
     fetchEngagement). Until I2.2 lands the bodies, that half asserts the method is absent OR clean.
   - BACKFILL-NO-URL-FETCH: lib/backfill/** imports nothing matching website-fetcher and contains no
     `fetch(` call and no import of undici/node-fetch/axios.
   - NON-VACUOUS GUARD: each scan asserts it read >= 1 file. A scan over an empty glob is a false green.

3. BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL: per your I2.0 answer 15, if no existing probe in
   lib/social/__tests__/eslint-internals-ban.test.ts covers lib/backfill/, add a second probe placed under
   lib/backfill/ importing a provider file directly, and assert SOCIAL_INTERNALS_BAN fires.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- BACKFILL-NO-COMMENT-READ (7, Tier 2) - source-scans.test.ts. Redden: add `liking_users` to a temp file in
  lib/backfill/. Revert.
- BACKFILL-NO-URL-FETCH (37, Tier 2) - source-scans.test.ts. Redden: a temp `await fetch('x')` and a temp
  website-fetcher import, separately. Revert both.
- BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL (11, Tier 2) - eslint-internals-ban.test.ts. Redden: remove
  lib/backfill from the ban's scope in a scratch config. Revert.

DO NOT: write any orchestrator, type or provider code. Commit: "I2.1 BACKFILL-NO-COMMENT-READ
BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL BACKFILL-NO-URL-FETCH".
```

#### I2.2 — The read contract, an honest `MockProvider`, and the eight-method suite

```
BUILDER - Session 32 - I2.2. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the Amendment B contract on the abstraction, and a mock that makes a read test mean something.

1. lib/social/types.ts - add to SocialProvider (types.ts:120-145): `readonly historicalReadAvailable:
   boolean` and `fetchRecentPosts(input: FetchRecentPostsInput): Promise<RecentPostsPage>`. Add the three
   types EXACTLY as ADR 0025 Section 2.2: FetchRecentPostsInput { platform, socialAccountId, pageSize,
   cursor: string | null, notBefore: string | null }; RecentPostsPage { posts: readonly RecentPost[],
   nextCursor: string | null }; RecentPost { platformPostId, publishedAt, content, url: string | null,
   format: 'text'|'image'|'video'|'link'|'multi'|'other', metrics: PostMetrics | null }. NOTHING ELSE on
   RecentPost - no account type, author, referenced post, mention, media URL or actor (Section 2.2 last
   paragraph). Doc-comment metrics: null as "not included in this read - fetch separately", never "not
   exposed" (A-3).
   Provider-owned constants in lib/social/: RECENT_POSTS_PAGE_SIZE_MIN = 5, RECENT_POSTS_PAGE_SIZE_MAX = 100,
   RECENT_POST_CONTENT_MAX_CHARS = 3000, SOCIAL_READ_TIMEOUT_MS = 10_000,
   SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS = 900. Export the types and constants via lib/social/index.ts.
   A shared `assertRecentPostsPageSize(pageSize)` throws RangeError BEFORE any I/O - used by every
   implementation, so "refuse, don't clamp" has one home.

2. lib/social/mock-provider.ts - historicalReadAvailable = true. fetchRecentPosts serves DETERMINISTIC,
   SEEDED fixture accounts keyed by socialAccountId, and records every call in calls.fetchRecentPosts. The
   ten fixtures of ADR Section 2.9, by exactly these ids: empty, standard (230 posts over 30 months, mixed
   formats, metrics inline), zero-post-page, non-terminating, mixed-types (replies, reposts and quotes
   interleaved - the mock applies the Section 2.4 filter itself), fail-on-page-N (throws a configured code on
   page 3 via maybeThrow), metrics-separate, over-long, two-accounts (founder + company on one business),
   and the cross-account cursor case. Cursors encode socialAccountId; a foreign cursor throws
   PLATFORM_REJECTED details.reason='cursor_invalid'. No crypto.randomUUID() in the read path. Mock mode
   stays offline.

3. lib/social/twitter-provider.ts AND linkedin-provider.ts - TEMPORARY STUB, both: historicalReadAvailable =
   false; fetchRecentPosts throws SocialProviderError('NOT_IMPLEMENTED') with zero fetch calls. I2.3 flips
   Twitter to true and implements both bodies. Put a `// I2.3` marker on the Twitter stub so the Reviewer can
   check it was removed.

4. lib/social/__tests__/provider-contract.test.ts - the seven-method assertion at :81-89 becomes EIGHT
   (authorised by A-2). Add the FLAG-CONSISTENCY assertion over every registered implementation: flag false
   => fetchRecentPosts rejects NOT_IMPLEMENTED and a spied global fetch was called ZERO times; flag true =>
   across every mock fixture, it NEVER rejects NOT_IMPLEMENTED. Page size 4 and 101 => RangeError with zero
   fetch calls, on every implementation. Extend SOCIAL-MOCK-MODE-OFFLINE (:145-183) to fetchRecentPosts.

5. lib/social/__tests__/no-read-path.test.ts - INVERT, do not delete (Amendment B Section B.4): assert
   fetchRecentPosts exists on each implementation in lib/social/, and that no file outside lib/social/
   imports a *-provider module to reach it (consumers use the barrel). Keep the file name and its
   SOCIAL-NO-READ-PATH id so history is traceable; update its header comment to cite Amendment B.

6. lib/social/__tests__/mock-provider.test.ts - one case per fixture: standard yields > 200 posts across
   pages with dates spanning 30 months; content over 3000 chars is truncated to exactly 3000;
   mixed-types never returns a reply/repost/quote; the same seed gives byte-identical pages twice.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- BACKFILL-READ-ON-ABSTRACTION (1, Tier 2) - provider-contract.test.ts (eight methods) + no-read-path.test.ts
  (inverted). Redden: remove the barrel export. Revert.
- BACKFILL-READ-FLAG-CONSISTENT (2, Tier 2) - provider-contract.test.ts. Redden: set Mock's flag false while
  it still serves; then make the LinkedIn stub call fetch before throwing. Revert both.
- BACKFILL-PROVIDER-BOUNDED (3, Tier 2) - contract suite (RangeError before I/O, 3000-char truncation).
  Redden: clamp instead of throw. Revert.
- BACKFILL-MOCK-FIXTURES-MEANINGFUL (10, Tier 2) - mock-provider.test.ts + extended
  SOCIAL-MOCK-MODE-OFFLINE. Redden: reintroduce randomUUID in a post id. Revert.

DO NOT: implement the X or LinkedIn body; add a field to RecentPost; add a SocialProviderError code (ADR 0028
Section 7 settled eight). Commit: "I2.2 BACKFILL-READ-ON-ABSTRACTION BACKFILL-READ-FLAG-CONSISTENT
BACKFILL-PROVIDER-BOUNDED BACKFILL-MOCK-FIXTURES-MEANINGFUL".
```

#### I2.3 — `TwitterProvider` read (served) and `LinkedInProvider` read (built, not served)

```
BUILDER - Session 32 - I2.3. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the X read on recorded fixtures, the LinkedIn body behind a false flag, and the pin on the as-shipped
flag table. NO network in any test - recorded fixtures only (ADR 0002 Amendment A Section A.8).

1. TwitterProvider.fetchRecentPosts - historicalReadAvailable = TRUE; remove the I2.2 stub marker.
   - Per page: assertRecentPostsPageSize; then withFreshToken (vault.ts:85-110) PER PAGE - never a token held
     across pages. No new get_vault_secret call site.
   - Page 1 only (cursor === null): GET /2/users/me and compare data.id with the row's platform_user_id;
     mismatch => PLATFORM_REJECTED details.reason='identity_mismatch', fail closed, no timeline call.
   - GET /2/users/:id/tweets with exclude=replies,retweets, max_results=pageSize, pagination_token from the
     DECODED cursor, start_time from notBefore when non-null (a hint), tweet.fields limited to id,
     created_at, text, public_metrics, attachments, referenced_tweets, entities. NO `expansions` parameter
     requesting referenced_tweets.id, author_id, or any user object. Drop items whose non-expanded
     referenced_tweets[].type is 'quoted'.
   - Map public_metrics: likes=like_count, comments=reply_count, shares=retweet_count+quote_count,
     saves=bookmark_count, impressions=impression_count, clicks=null, reach=null. Never request
     non_public_metrics.
   - content: plain text, entities decoded, whitespace collapsed, links/mentions kept as visible text,
     truncated at 3000. format from attachment TYPES only. publishedAt validated finite.
   - Cursor: opaque, encodes socialAccountId + pagination_token; a cursor for another account or unparseable
     => PLATFORM_REJECTED details.reason='cursor_invalid'. Never logged.
   - Zod-parse every response before reading a field; parse failure => UNKNOWN.
   - A read-specific error map (NOT error-mapping.ts, which is publish-only): 401/refresh fail =>
     TOKEN_EXPIRED/TOKEN_REVOKED; 403 scope => TOKEN_REVOKED details.reason='scope_missing'; 403 restriction
     / 404 => PLATFORM_REJECTED with reason; 429 => RATE_LIMITED retryAfterSeconds = min(Retry-After, 900);
     timeout (AbortSignal at 10000 ms) / 5xx => NETWORK. NO sleep, NO retry loop.
   - details carries a reason code and numbers ONLY.

2. LinkedInProvider.fetchRecentPosts - historicalReadAvailable STAYS FALSE. Write the body against LinkedIn's
   documented Posts API author finder over the member URN, original shares only, metrics: null - behind the
   flag check, so the method throws NOT_IMPLEMENTED with zero fetch calls BEFORE reaching it. Head the body
   with a comment: "UNVERIFIED against the live API - ADR 0025 A-1. Re-verify when r_member_social is
   approved. No test covers this body." Do NOT write a fixture test claiming it works. Do NOT touch
   fetchPostMetrics.

3. lib/social/__tests__/twitter-provider.test.ts - recorded-fixture cases, spying on fetch:
   - the timeline request URL carries exclude=replies,retweets and NO expansions param;
   - a page containing a quote is returned without it;
   - page 1 calls /2/users/me first; identity mismatch fails closed with ZERO timeline calls;
   - page 2 does not call /2/users/me again, and withFreshToken is invoked once per page;
   - a cross-account cursor => cursor_invalid; a garbage cursor => cursor_invalid;
   - 429 with Retry-After: 5000 => retryAfterSeconds 900 and the promise resolves/rejects without any timer
     (fake timers: assert no setTimeout scheduled by the provider);
   - a hung response aborts at 10000 ms => NETWORK;
   - for EVERY thrown error in the file, JSON.stringify(err.details) contains none of: the fixture post
     text, the cursor string, the access token.
4. provider-contract.test.ts - PIN THE AS-SHIPPED TABLE (Amendment B Section B.3): Twitter true, LinkedIn
   false, Mock true. This is what stops the I2.2 stub surviving.
5. A scan: get_vault_secret call-site count equals the I2.0 count.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- BACKFILL-CURSOR-ACCOUNT-BOUND (4, Tier 2) - mock fixture test (I2.2) + X fixture test. Redden: stop encoding
  the account in the X cursor. Revert.
- BACKFILL-OWN-POSTS-ONLY (5, Tier 2) - X fixture test + mock mixed-types. Redden: drop exclude=retweets; then
  stop dropping quotes. Revert both.
- BACKFILL-IDENTITY-VERIFIED (6, Tier 2) - X fixture test. Redden: skip the /users/me comparison. Revert.
- BACKFILL-PROVIDER-NEVER-SLEEPS (8, Tier 2) - X fixture tests (timeout, cap, no timer) + a scan that the
  fetchRecentPosts bodies contain no setTimeout/sleep/while-retry. Redden: add a 1ms sleep. Revert.
- BACKFILL-VAULT-PATH-REUSED (12, Tier 2) - the per-page withFreshToken spy + the call-site count scan.
  Redden: read the token once outside the page loop. Revert.
(BACKFILL-ERROR-DETAILS-CONTENT-FREE is proven here for the provider but CLOSES in I2.9 with the tick log.)

Commit: "I2.3 BACKFILL-CURSOR-ACCOUNT-BOUND BACKFILL-OWN-POSTS-ONLY BACKFILL-IDENTITY-VERIFIED
BACKFILL-PROVIDER-NEVER-SLEEPS BACKFILL-VAULT-PATH-REUSED".
```

#### I2.4 — Migration 1: the `social_accounts` identity lock and `scopes_granted`  ·  security review

```
BUILDER - Session 32 - I2.4. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use the
supabase:supabase-postgres-best-practices skill while authoring the SQL.

SHIP: the legal precondition for importing anything (ADR 0025 Sections 7.3, 7.4, 8.1).

1. supabase/migrations/<timestamp>_social_accounts_identity_lock.sql:
   - ALTER TABLE public.social_accounts ADD COLUMN scopes_granted text[] NULL.
   - REVOKE UPDATE ON public.social_accounts FROM authenticated, anon.
   - GRANT UPDATE (<allowlist>) ON public.social_accounts TO authenticated - the allowlist is EVERY column
     EXCEPT id, business_id, platform, platform_user_id, vault_access_token_id, vault_refresh_token_id,
     is_active, token_expires_at, scopes_granted, connected_at. Enumerated from the LIVE definition you
     dumped in I2.0 and RECORDED IN THE MIGRATION HEADER with the reason a column-level REVOKE would not
     work (20260707190000:28).
   - Do NOT touch the trial trigger. Do NOT touch default privileges.
2. lib/social/types.ts - remove the locked columns from SocialAccountUpdate (types.ts:233-236).
3. Per your I2.0 updateSocialAccount caller table: re-point any authenticated-client caller that wrote a
   locked column to an existing service-role function (the callback, refresh and disconnect paths already
   use one). Name each re-pointed caller and its test in the commit body.
4. Persist scopes: the callback route writes TokenSet.scopesGranted; TwitterProvider.refreshAccessToken
   (:470,485) writes it on refresh. [] and NULL both mean UNKNOWN - add a helper that says so, and never
   treat [] as "no scopes".

TESTS:
- supabase/__tests__/social-accounts-identity-lock.test.ts (Tier 1, live Postgres): as an AUTHENTICATED
  member, an UPDATE of each locked column (platform_user_id, both vault ids, is_active, token_expires_at,
  scopes_granted, business_id, platform, connected_at) FAILS WITH A PRIVILEGE ERROR (42501) - one case per
  column; an UPDATE of one allowlisted column SUCCEEDS. Assert the actual UPDATE outcome, never a
  pg_policies or information_schema read.
- callback route test: scopes_granted written on both the onboarding and the settings entry paths.
- twitter-provider.test.ts refresh case: scopes_granted persisted; [] recorded as unknown.

CONSTRAINTS CLOSED:
- BACKFILL-SOCIAL-ACCOUNT-IDENTITY-LOCKED (14, Tier 1). Redden: comment out the REVOKE and re-run - the
  platform_user_id case must go green-to-red. Revert.
- BACKFILL-SCOPES-PERSISTED (15, Tier 2). Redden: drop the refresh write. Revert.

THEN - ECC BUDGET INVOCATION 2 of 3: dispatch ecc:security-reviewer ONCE, read-only, over `git diff` of the
I2.3 commit and this step's staged changes together. Ask it: (a) can any path import a timeline for an
account the business does not own - via platform_user_id, a cursor, a token for a different identity, or a
locked column reachable through another grant or a SECURITY DEFINER function? (b) can post content, a cursor
or a token reach SocialProviderError.details, a log, or Sentry? (c) is the allowlist fail-closed for a column
added later? Fold findings in before committing, or record in the commit body why one was rejected. Do not
re-consult.

Commit: "I2.4 BACKFILL-SOCIAL-ACCOUNT-IDENTITY-LOCKED BACKFILL-SCOPES-PERSISTED".
```

#### I2.5 — Migration 2: runs, staging, claim, spend, budget purpose, discard, §D2.5 rows

```
BUILDER - Session 32 - I2.5. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices.

SHIP: the two business-scoped tables of ADR 0025 Section 9.1 and the RPCs that operate on them.

1. supabase/migrations/<timestamp>_social_backfill_runs_and_posts.sql:
   - social_backfill_runs with EXACTLY the Section 9.1 columns; status CHECK over queued, fetching,
     extracting, awaiting_ratification, ratified, unsupported, failed, discarded; account_role CHECK
     ('brand','founder') NULL; voice_status CHECK ('pending','applied','refused_cap','failed','declined')
     NULL; business_id and social_account_id FKs ON DELETE CASCADE; ceiling_cents default 50.
   - Partial UNIQUE (social_account_id) WHERE status <> 'discarded'. Partial claim index (status,
     updated_at) WHERE status IN ('queued','fetching','extracting'). Indexes on both FKs.
   - social_backfill_posts with the Section 9.1 columns; extraction_status CHECK (pending, claimed,
     extracted, skipped, failed); UNIQUE (social_account_id, platform_post_id); claim index (run_id,
     extraction_status, published_at); FKs ON DELETE CASCADE.
   - RLS ENABLED on both. runs: ONE SELECT policy for members in the InitPlan form
     business_id = ANY (SELECT unnest(public.get_user_business_ids())). NO insert/update/delete policy.
     posts: NO policy at all.
   - claim_backfill_posts(p_run_id, p_limit) SECURITY DEFINER, FOR UPDATE SKIP LOCKED, pending -> claimed,
     bounded limit, ORDER BY published_at.
   - reserve_backfill_spend(p_run_id, p_estimate_cents) - one conditional UPDATE
     spend_cents = spend_cents + p_estimate WHERE id = p_run_id AND spend_cents + p_estimate <= ceiling_cents,
     returning whether it reserved (the SIGNAL3-COST-CEILING-ATOMIC idiom); reconcile on actual cost.
   - enqueue_backfill_run(p_business_id, p_social_account_id, p_platform) - inserts queued ONLY IF the account
     has no non-discarded run AND fewer than 3 runs total; returns the run or null. Atomic, no read-then-write.
   - resume_backfill_run(p_run_id) - failed -> queued WHERE status='failed' AND error_code <> 'caller_bug',
     same row.
   - discard_backfill_run(p_run_id, p_user_id) - ADR 6.4 requires discard to retire candidates and purge
     staging "in one transaction"; the only house mechanism for that is a SECURITY DEFINER function. Same
     grant and membership shape as ratify (Section 9.4): p_user_id checked against business_members when
     non-null; NULL permitted only for the disconnect/system path. Any non-terminal state -> discarded, staging
     deleted, staged_voice nulled. (Candidate retirement is added in I2.6 when the memory columns exist -
     create the function here and CREATE OR REPLACE it there.) Record in the commit body that this function
     transcribes Section 6.4's "one transaction" and is not a new decision.
   - Every function: SECURITY DEFINER, SET search_path, REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT
     EXECUTE TO service_role.
   - ai_budget_daily purpose CHECK: the pg_constraint lookup from I2.0 in a DO block that RAISES unless
     exactly one row matches; drop it by the found name; re-add NAMED ai_budget_daily_purpose_check with every
     CURRENT purpose plus 'backfill_cents'.
2. docs/decisions/0010-legal-surface.md Amendment 2 Section D2.5 - add the TWO rows from ADR 0025 Section 9.2
   VERBATIM, in this commit.
3. lib/db/backfill-runs.ts and lib/db/backfill-posts.ts - typed wrappers, service-role via the lazy-import
   pattern, no client parameter; every list function bounded with an explicit ORDER BY matching an index.
   A member-facing getBackfillRunsForBusiness(client, businessId) for the onboarding page uses the anon
   server client and RLS.

TESTS (supabase/__tests__/, live Postgres):
- backfill-runs-rls.test.ts: a member SELECTs own runs; another tenant sees zero; an authenticated INSERT,
  UPDATE and DELETE on runs are all refused; ANY authenticated access to posts returns zero rows / is refused.
- backfill-cascade.test.ts: delete a business => zero runs and zero staging rows remain; assert the two
  Section D2.5 rows exist in ADR 0010 by a vitest file-read in lib/ (Tier-2 companion), not by the SQL test.
- backfill-once-per-account.test.ts: second enqueue while queued/failed returns null; after a discard a new
  run is allowed; the 4th run is refused; resume keeps the same id; caller_bug is not resumable.
- backfill-claim.test.ts: two concurrent claims over the same run never return an overlapping row.
- backfill-spend.test.ts: reservations totalling 50 succeed; the next 1-cent reservation is refused; two
  concurrent 30-cent reservations - exactly one succeeds.
- ai-budget-purpose.test.ts: backfill_cents accepted; triage_cents and generation_posts still accepted (the
  existing writers - name them); 'bogus' rejected; the constraint is named ai_budget_daily_purpose_check.

CONSTRAINTS CLOSED:
- BACKFILL-ONCE-PER-ACCOUNT (18, Tier 1). Redden: drop the partial UNIQUE. Revert.
- BACKFILL-CLAIM-ATOMIC (19, Tier 1). Redden: remove SKIP LOCKED / FOR UPDATE. Revert.
- BACKFILL-COST-CEILINGED (22, Tier 1). Redden: read-then-update. Revert.
- BACKFILL-BUDGET-PURPOSE (23, Tier 1). Redden: omit backfill_cents. Revert.
- BACKFILL-RLS-ISOLATED (47, Tier 1). Redden: add a permissive posts SELECT policy. Revert.
- BACKFILL-CASCADE-COMPLETE (48, Tier 1). Redden: ON DELETE SET NULL on run_id. Revert.

Commit: "I2.5 BACKFILL-ONCE-PER-ACCOUNT BACKFILL-CLAIM-ATOMIC BACKFILL-COST-CEILINGED BACKFILL-BUDGET-PURPOSE
BACKFILL-RLS-ISOLATED BACKFILL-CASCADE-COMPLETE".
```

#### I2.6 — Migration 3: provenance, import RPCs, ratify, per-post removal  ·  database review

```
BUILDER - Session 32 - I2.6. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices.

SHIP: the L-3 marker on all four memory tables, and the only SQL paths that write or activate import rows.

1. supabase/migrations/<timestamp>_memory_import_provenance.sql - on brand_memory, evidence_memory,
   audience_memory, performance_memory:
   - import_run_id uuid NULL REFERENCES social_backfill_runs(id) ON DELETE NO ACTION, indexed. The migration
     header states WHY NO ACTION and not RESTRICT or CASCADE (ADR 5.1) and the stated consequence for a
     per-account hard delete.
   - import_source_post_ids text[] NULL.
   - CHECK ((source = 'import') = (import_run_id IS NOT NULL)) and CHECK ((source = 'import') =
     (import_source_post_ids IS NOT NULL)).
   - A BEFORE UPDATE trigger rejecting any change to source, import_run_id or import_source_post_ids.
   - Run-scoped partial UNIQUE indexes: evidence (import_run_id, kind, md5(content)) WHERE source='import';
     audience (import_run_id, kind, md5(lower(statement))) WHERE source='import'; performance (business_id,
     dimension, coalesce(platform,''), md5(lower(pattern)), import_run_id) WHERE source='import' AND
     deleted_at IS NULL.
2. Import writer RPCs - import_evidence_memory, import_audience_memory, import_performance_memory - SECURITY
   DEFINER, service_role only, FIXING source='import', status='candidate', sensitivity='internal', and for
   evidence public_use_permission=false IN SQL (callers cannot pass them); INSERT ... ON CONFLICT DO NOTHING
   against the indexes above; last_confirmed_at and expires_at taken from parameters and rejected if not
   finite. Precedent: upsert_distilled_performance_pattern.
3. ratify_backfill_run(p_user_id, p_run_id, p_accepted_ids, p_rejected_ids, p_account_role) - exactly ADR
   Section 9.4: membership check on business_members (user_id = p_user_id, the run's business,
   status='active', role approver OR is_admin) else RAISE; in one transaction flip accepted candidate ->
   active and rejected -> retired FILTERED BY source='import' AND import_run_id = p_run_id; record
   account_role, ratified_at, voice_status='pending' when staged_voice is non-null; delete the run's staging
   rows; status -> ratified WHERE status='awaiting_ratification'. DOES NOT TOUCH staged_voice. Does not touch
   last_confirmed_at. service_role only.
4. CREATE OR REPLACE discard_backfill_run to also retire the run's candidate import rows.
5. remove_import_source_post(p_business_id, p_platform_post_id) - deletes evidence and audience rows whose
   import_source_post_ids contains it, retires performance rows whose backing set includes it. service_role
   only.

TESTS (supabase/__tests__/, live Postgres):
- memory-import-provenance.test.ts: on EACH of the four tables, source='import' with NULL run id fails, a
  run id with source='manual' fails, NULL post ids with 'import' fails; the trigger rejects changing each of
  the three columns (a service-role UPDATE too).
- memory-import-promotion.test.ts: an import performance row survives ratify (still 'import', same run),
  retire, and a colliding upsert_distilled_performance_pattern for the same pattern - which creates a
  SEPARATE distilled row and leaves the import row byte-identical on the three columns.
- memory-import-rpcs.test.ts: callers cannot set status, source or public_use_permission - evidence lands
  false even when the wrapper is handed true; re-running the same import inserts zero new rows on all three.
- ratify-backfill-run.test.ts: a non-member and a 'viewer' are refused; an approver succeeds; a stuck
  summarize: candidate with no run id in the same business is NOT activated; an import row from a DIFFERENT
  run passed in p_accepted_ids is NOT activated; staged_voice unchanged; staging gone; authenticated
  EXECUTE refused.
- nothing-active-before-ratify.test.ts: every import RPC produces candidate; the only transition to active
  for an import row is ratify (attempt the others).
- per-post-removal.test.ts: exactly the rows backed by the removed post are deleted/retired, none other.
- purge-backfill.test.ts: purge_business over a business holding a run, staging and ACTIVE import rows on
  all four tables leaves ZERO of each - the NO ACTION FK must not block it.

CONSTRAINTS CLOSED (all Tier 1): BACKFILL-NOTHING-ACTIVE-BEFORE-RATIFY (21), BACKFILL-EVIDENCE-NOT-PUBLIC
(34), BACKFILL-PROVENANCE-MARKED (38), BACKFILL-PROVENANCE-IMMUTABLE (39),
BACKFILL-PROVENANCE-SURVIVES-PROMOTION (40), BACKFILL-PER-POST-REMOVABLE (43), BACKFILL-RATIFY-ATOMIC (45),
BACKFILL-PURGE-COVERED (49), BACKFILL-IMPORT-IDEMPOTENT (56). Redden each against its own violation (drop the
CHECK, drop the trigger, remove the run filter from ratify, remove ON CONFLICT, set the FK to RESTRICT for the
purge case). Revert all.

THEN - ECC BUDGET INVOCATION 3 of 3, BEFORE THIS STEP COMMITS: dispatch ecc:database-reviewer ONCE, read-only,
over the three migration files of I2.4, I2.5 and I2.6. Ask it: the grants (a REVOKE missing on any
SECURITY DEFINER function is a privilege escalation); index coverage for every claim, sweep and list query;
whether ON DELETE NO ACTION permits the purge cascade in one statement; whether the purpose-CHECK DO block
can silently no-op; lock ordering between claim, ratify and discard; and RLS InitPlan form. A finding against
I2.4 or I2.5 is fixed by a FORWARD MIGRATION in this step - never by editing a committed migration. Do not
re-consult.

Commit: "I2.6 BACKFILL-NOTHING-ACTIVE-BEFORE-RATIFY BACKFILL-EVIDENCE-NOT-PUBLIC BACKFILL-PROVENANCE-MARKED
BACKFILL-PROVENANCE-IMMUTABLE BACKFILL-PROVENANCE-SURVIVES-PROMOTION BACKFILL-PER-POST-REMOVABLE
BACKFILL-RATIFY-ATOMIC BACKFILL-PURGE-COVERED BACKFILL-IMPORT-IDEMPOTENT".
```

#### I2.7 — Import writers through `lib/db/` and `lib/memory/`

```
BUILDER - Session 32 - I2.7. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the TypeScript write path for imported memory, governed and guarded at its choke point.

1. lib/db/memory-evidence.ts, memory-audience.ts, memory-performance.ts - one import wrapper each
   (importEvidenceMemory, importAudienceMemory, importPerformanceMemory) calling the I2.6 RPCs, service-role
   via the lazy-import pattern, no client parameter. EACH WRAPPER calls neutralizeWithSentinels on every
   imported string field BEFORE the RPC - the MEM-PATTERN-SENTINEL-GUARDED precedent at
   memory-performance.ts:127. Neutralisation at the call site does NOT count.
2. lib/memory/ - an import module (e.g. lib/memory/import.ts) that is the ONLY caller of those wrappers
   (MEM-NO-DIRECT-TABLE-ACCESS). It takes source dates as ISO strings, validates them finite with date-fns
   (a non-finite date throws BEFORE the write - recencyDecay would throw later), sets last_confirmed_at to the
   source date (the newest backing post for performance), and computes expires_at = source + 12 months for
   performance and usage_data evidence, SKIPPING rows already expired.
3. Types: the wrapper inputs have no status, source, sensitivity or public_use_permission field - they cannot
   be passed.

TESTS:
- lib/db/memory-*.test.ts: each wrapper, given a string carrying the sentinel-injection fixture used by the
  existing MEM-PATTERN-SENTINEL-GUARDED test, sends the neutralised form to the RPC. One case per wrapper.
- lib/memory/import.test.ts: last_confirmed_at equals the post date, not now; performance uses the newest of
  its backing posts; NaN / 'not-a-date' throws with zero RPC calls; an already-expired performance or
  usage_data row is not written; a source-scan that no file outside lib/memory/ imports the three import
  wrappers.

CONSTRAINTS CLOSED:
- BACKFILL-SENTINEL-GUARDED (35, Tier 2). Redden: move neutralisation to the lib/memory caller. Revert.
- BACKFILL-SOURCE-DATED (41, Tier 2). Redden: use formatISO(new Date()). Revert.
(The "ratify does not touch last_confirmed_at" half is already Tier-1 proven in I2.6's promotion test; cite
it in the commit body.)

Commit: "I2.7 BACKFILL-SENTINEL-GUARDED BACKFILL-SOURCE-DATED".
```

#### I2.8 — Orchestrator fetch phase into staging

```
BUILDER - Session 32 - I2.8. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: lib/backfill/orchestrator.ts - the fetch phase only. Imports: lib/social via index.ts ONLY; lib/db
backfill wrappers; constants. No lib/ai import yet.

1. fetchPhase(runId) does BOUNDED work for one tick:
   - provider = registry lookup by the run's platform. If !provider.historicalReadAvailable: run ->
     'unsupported' with ZERO fetchRecentPosts calls and ZERO platform reads recorded.
   - Loop pages from cursor = null (cursors held in memory for this tick, NEVER persisted), pageSize 100,
     notBefore = now - 24 months as a hint. Stop at the FIRST of: 200 accepted posts; 5 pages;
     platform_posts_read reaching 500; nextCursor null; a whole page older than the lookback.
   - Enforce the lookback on publishedAt yourself - discard older posts; do not trust notBefore.
   - An EMPTY page with a non-null cursor is NOT the end.
   - Stage via INSERT ... ON CONFLICT (social_account_id, platform_post_id) DO NOTHING; dedupe on
     platformPostId; record posts_fetched and platform_posts_read on the run row with atomic updates.
   - Transition fetching -> extracting when done, by conditional UPDATE.
   - Error reactions EXACTLY per ADR Section 2.5's table: NOT_IMPLEMENTED -> unsupported; RangeError ->
     failed error_code='caller_bug' (not resumable, Sentry); TOKEN_* -> failed (resumable); PLATFORM_REJECTED
     -> failed; RATE_LIMITED -> defer, NOT failed; NETWORK -> leave for next tick; UNKNOWN -> failed.
     Already-staged rows are kept on every path.

TESTS - lib/backfill/__tests__/fetch-phase.test.ts, against MockProvider fixtures, asserting on STAGING ROWS
AND RUN STATE (mock the lib/db wrappers with an in-memory store, or use the existing db test double pattern):
- standard: exactly 200 staged, none older than 24 months, platform_posts_read recorded.
- non-terminating: stops at 5 pages.
- a fixture configured to exceed 500 reads before 200 posts: stops at 500.
- zero-post-page: continues past the empty page.
- empty: extracting with zero staged (the "nothing to learn" path is shown in I2.14).
- overlapping pages: no duplicate staging rows.
- fail-on-page-N with TOKEN_EXPIRED: failed, pages 1-2 still staged; a second run of fetchPhase after resume
  stages no duplicates.
- RATE_LIMITED: run not failed.
- a LinkedIn-platform run: unsupported, calls.fetchRecentPosts empty.

CONSTRAINTS CLOSED:
- BACKFILL-RUN-BOUNDED (16, Tier 2). Redden: raise the page bound to 6 in the loop (not the constant).
  Revert.
- BACKFILL-X-READ-BOUNDED (17, Tier 2). Redden: stop counting reads. Revert.
- BACKFILL-UNSUPPORTED-PLATFORM-HONEST (29, Tier 2). Redden: call fetchRecentPosts before the flag check.
  Revert.

Commit: "I2.8 BACKFILL-RUN-BOUNDED BACKFILL-X-READ-BOUNDED BACKFILL-UNSUPPORTED-PLATFORM-HONEST".
```

#### I2.9 — Enqueue on connect, the cron tick, sweeps, and disconnect

```
BUILDER - Session 32 - I2.9. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: how a run starts, advances, stalls and stops (ADR 0025 Sections 6.5, 6.6, 6.8).

1. app/api/social/[platform]/callback/route.ts - after the account row is written: enqueue_backfill_run;
   if the account already has a resumable failed run, resume_backfill_run instead (reconnect path); then fire
   ONE tick best-effort through after() (the step-1/actions.ts:53-55 precedent). Enqueue failure must NOT
   fail the OAuth callback - it is logged via Sentry and the cron picks up the slack.
2. app/api/cron/backfill/route.ts - the sync-metrics pattern, line for line: dual-mode auth, maxDuration =
   60, Sentry.withMonitor, and ONE canonical structured-JSON console.log per invocation. Each tick does ONE
   unit of bounded work: one run's fetch phase OR one extraction unit (wired in I2.10-I2.12 - leave the
   dispatch point with a typed exhaustive switch). Then sweeps: a run in queued/fetching/extracting with no
   progress (updated_at) for 30 minutes -> failed (resumable); staging rows 30 days after their run left
   extracting are deleted; staged_voice 30 days after ratification is nulled.
   THE LOG LINE carries run counts, state transitions, reason codes and durations ONLY - never content,
   cursors, tokens, handles or post ids.
3. lib/db/social-accounts.ts deactivateSocialAccount - after the existing three disconnect steps, call
   discard_backfill_run(run, <session user>) for any non-terminal run on that account. Already-ratified
   memory stays.
4. Schedule: do NOT create a QStash schedule in code; add the every-minute schedule to the I2.15 launch
   checklist list.

TESTS:
- callback route tests - enqueue on BOTH entry paths (onboarding step-3 and settings, per your I2.0 answer
  12); a reconnect with a failed run resumes the same id instead of inserting; enqueue throwing still
  returns the normal callback redirect.
- app/api/cron/backfill/route.test.ts - auth refusal; one unit per tick; a 31-minute stalled run -> failed;
  a 29-minute run untouched; the TTL sweep; and the LOG + DETAILS CONTENT CHECK: drive a tick through a
  fixture that throws every Section 2.5 error and assert the captured console.log line and every
  SocialProviderError.details / Sentry extra contain none of the fixture post text, the cursor, the token,
  or a platform_post_id.
- disconnect tests: a fetching run -> discarded, staging gone; a ratified run untouched.
- SHARED-FUNCTION CALLERS: deactivateSocialAccount and the callback route - list every caller and its test
  in the commit body.

CONSTRAINTS CLOSED:
- BACKFILL-ERROR-DETAILS-CONTENT-FREE (9, Tier 2) - closes here, with the provider half proven in I2.3.
  Redden: log the cursor. Revert.
- BACKFILL-LATENCY-BOUNDED (26, Tier 2). Redden: set the stall window to 300 minutes in the sweep. Revert.
- BACKFILL-DISCONNECT-CANCELS (27, Tier 2). Redden: skip the discard call. Revert.

Commit: "I2.9 BACKFILL-ERROR-DETAILS-CONTENT-FREE BACKFILL-LATENCY-BOUNDED BACKFILL-DISCONNECT-CANCELS".
```

#### I2.10 — Deterministic extraction: statistics, lift, the weighted subset, `format` patterns

```
BUILDER - Session 32 - I2.10. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: everything ADR 0025 Section 4.1 steps 2-3 and Section 4.3's format patterns calls arithmetic. NO model
call in this step (L-8).

1. lib/backfill/stats.ts - cadence, weekday/hour distribution, format distribution, length distribution, and
   the engagement baseline: median of (likes + comments + shares) / impressions over posts where impressions
   is non-null; otherwise median raw (likes + comments + shares). Written to the run row's summary jsonb ONLY
   - cadence and timing are NOT memory.
2. lib/backfill/weighting.ts - lift = engagement / baseline per staged post (stored on
   social_backfill_posts.lift); the weighted subset is the top 30 by lift, ties broken by newer publishedAt.
   If NO post in the run has metrics: the 30 most recent, and the run records
   weighting='unweighted_no_metrics'.
3. lib/backfill/patterns/format.ts - a format with n >= 5 backing posts and median lift >= 1.25 becomes a
   performance candidate: dimension 'format', confidence 0.6 * n / (n + 5), import_source_post_ids = the
   backing ids, last_confirmed_at = newest backing post, expires_at = that + 12 months, written through the
   I2.7 lib/memory import module. A shared `importedConfidence(n)` helper is the ONLY place the formula
   lives - I2.11 reuses it.

TESTS - lib/backfill/__tests__/weighting.test.ts and patterns.test.ts:
- a 40-post fixture with known metrics: the subset is exactly the known top 30 ids.
- metrics-separate fixture (all null): subset = 30 most recent, weighting='unweighted_no_metrics'.
- baseline switches correctly between the impressions and raw forms.
- importedConfidence(5) = 0.30, (20) = 0.48, (10000) < 0.6 and never above it.
- a format with n=4 and lift 3.0 is NOT written; n=5 and lift 1.24 is NOT written; n=5 and lift 1.25 IS.
- a model client spy records ZERO calls across the whole step.

CONSTRAINTS CLOSED:
- BACKFILL-PERFORMANCE-WEIGHTED (31, Tier 2). Redden: take the 30 most recent even with metrics. Revert.
- BACKFILL-CONFIDENCE-CAPPED (32, Tier 2) - closes here for the formula and the n/lift gate; I2.11 must reuse
  importedConfidence and the same gate for model-proposed patterns and its test cites this one. Redden:
  confidence n/(n+5). Revert.

Commit: "I2.10 BACKFILL-PERFORMANCE-WEIGHTED BACKFILL-CONFIDENCE-CAPPED".
```

#### I2.11 — Model passes 1 and 2: voice synthesis and insights

```
BUILDER - Session 32 - I2.11. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use the
ecc:cost-aware-llm-pipeline SKILL for the per-call reservation estimate.

SHIP: two of the three model passes, through lib/ai/ with CustomerContext, inside the separate budget, and
exempt from the trial counters.

1. lib/ai/prompts/backfill-voice-synthesis.ts - NEW prompt id 'backfill-voice-synthesis', Sonnet 4.6, output
   schema = the EXISTING BrandVoiceInferredSchema (brand-voice-inference.ts:15-23) reused by import, not
   copied. Input: the top 20 of the weighted subset, each truncated to 1000 chars and wrapped [DATA]...[/DATA].
   Output is STAGED on social_backfill_runs.staged_voice with up to 3 examples = the highest-lift posts
   verbatim (<= 1000 chars each). It writes NOTHING to brand_voices or brand_voice_variations.
   DO NOT reuse brand-voice-inference: its id is isBrandVoice-classified (runner.ts:33) - refused after the
   trial's attempts, consumes one, and runs on Opus (ADR 4.2 loser).
2. lib/ai/prompts/backfill-insights.ts - NEW id 'backfill-insights', Sonnet 4.6, input the 30-post subset.
   Output: proposed topic / hook / proof_type patterns EACH WITH backing post ids, and audience statements
   (kind in problem/objection/question/trigger) each with backing post ids. The orchestrator DISCARDS ids not
   in the run, RECOMPUTES n and median lift from staging, drops patterns failing n >= 5 / lift >= 1.25 and
   audience statements with < 2 backing posts, then writes: performance via importedConfidence(n) (I2.10),
   audience at confidence 0.3. The model NEVER supplies n or confidence - the schema has no field for them.
3. If the lib/ai prompt registry has a frozen properties table (Session 31 H2.1's
   prompt-properties.frozen-table.test.ts), add rows for BOTH new ids - a new prompt with no row must redden
   that test, and that is correct.
4. lib/ai/runner.ts - classify both new ids (and I2.12's evidence id, declared now) so they NEITHER check nor
   increment either trial counter - the summarize.ts:161-163 precedent. SHARED-FUNCTION CALLERS: every
   runPrompt caller's classification must be unchanged; list the existing ids per predicate before and after.
5. lib/backfill/extract.ts - before EACH call: reserve_backfill_spend(run, estimate) (estimate from
   lib/ai/models.ts rates, ceil); refused => stop extracting, run -> awaiting_ratification with partial=true
   and the reason recorded. After the call: reconcile to actual. Also reserve against ai_budget_daily purpose
   'backfill_cents' with the 150 daily cap. Record each completed pass in passes_done AFTER its writes.

TESTS:
- lib/ai/runner.test.ts: with postsRemaining = 0 and brand-voice attempts spent, the three backfill ids still
  run; after success neither posts_generated_count nor the brand-voice counter moved; every pre-existing id's
  classification is byte-identical to the I2.0 table.
- lib/backfill/__tests__/extract.test.ts (mock client, sequenced payloads):
  - a model proposing a pattern with 3 fabricated ids + 4 real ones => n recomputed as 4 => not written;
  - a model output carrying a confidence field is rejected by the schema;
  - voice output lands in staged_voice and a brand_voices writer spy records ZERO calls;
  - the reservation refusing on the second call => partial=true, awaiting_ratification, insights not written;
  - a full run issues EXACTLY three passes' worth of prompt ids (voice once, insights once, evidence batches)
    and the stats/format step made zero model calls.

CONSTRAINTS CLOSED:
- BACKFILL-TRIAL-CAPS-UNTOUCHED (24, Tier 2). Redden: leave the voice id unclassified. Revert.
- BACKFILL-DETERMINISTIC-FIRST (30, Tier 2). Redden: add a second insights call. Revert.

Commit: "I2.11 BACKFILL-TRIAL-CAPS-UNTOUCHED BACKFILL-DETERMINISTIC-FIRST".
```

#### I2.12 — Model pass 3: evidence, verify-then-cite

```
BUILDER - Session 32 - I2.12. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the only Haiku batch loop and the only path that stores verbatim third-party-adjacent text.

1. lib/ai/prompts/backfill-evidence.ts - id 'backfill-evidence' (classified in I2.11), Haiku 4.5, batches of
   20 staged posts via the claim RPC (claim_backfill_posts, pending -> claimed -> extracted | skipped |
   failed). Extracts usage_data, case_study, quote items, each with its source post id. FAIL CLOSED on
   invalid output: the batch's posts are marked failed, nothing is written from it.
2. Verify-then-cite in lib/backfill/evidence.ts: normalise the staged post content with the SAME
   normalisation the provider applied; the item's content must be a verbatim substring of it and <= 500
   chars, else DROPPED. source_url = the post permalink. confidence 0.5. usage_data expires_at = post date +
   12 months, skipped if already expired. public_use_permission is NOT a parameter (fixed false in SQL, I2.6).
3. Cap 40 per account, checked against rows ALREADY WRITTEN FOR THE RUN (so a re-run pass cannot exceed it).
4. Reserve spend per batch exactly as I2.11.

TESTS - lib/backfill/__tests__/evidence.test.ts:
- an item that paraphrases the post is dropped; an item that is a verbatim substring is kept; a 501-char
  verbatim item is dropped;
- an item citing a post id outside the batch is dropped;
- invalid JSON for a batch => those posts 'failed', zero rows written, the run continues with the next batch;
- 45 valid items => 40 written; a simulated re-run of the pass after 40 => zero more;
- a prompt-injection string in post text reaches the model inside [DATA]...[/DATA] and the stored excerpt is
  neutralised (cites I2.7's guard).

CONSTRAINT CLOSED:
- BACKFILL-EVIDENCE-VERBATIM (33, Tier 2). Redden: accept items by fuzzy includes on lowercase. Revert.

Commit: "I2.12 BACKFILL-EVIDENCE-VERBATIM".
```

#### I2.13 — Ratify, discard, apply voice, and resume on the same row

```
BUILDER - Session 32 - I2.13. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the founder's decisions, as Server Actions, over the RPCs from I2.5/I2.6 (ADR 0025 Sections 4.2, 6.4,
6.5, 9.4, 10.3).

1. app/[locale]/(dashboard)/onboarding/backfill/actions.ts (or colocated with step-4 - follow the onboarding
   folder convention you found in I2.0):
   - ratifyBackfillRunAction - Zod: run uuid; accepted/rejected id arrays each bounded by the run's caps
     (<= 40 + 25 + 15); account_role enum brand|founder REQUIRED. p_user_id from supabase.auth.getUser() on
     the anon SERVER client - never from the form. Calls ratify_backfill_run through lib/db.
   - discardBackfillRunAction - same user derivation; discard_backfill_run.
   - retryBackfillRunAction - resume_backfill_run on the SAME row (never a new run).
   - applyBackfillVoiceAction - Zod; same membership check; requires account_role set.
       brand   => the EXISTING upsertBrandVoice path with voice_axes, tone, keywords, avoid_words, and
                  writing_examples = the founder's chosen <= 3 (existing examples and staged examples offered
                  together; NEVER concatenated past 3 - the 20260430120005:15 CHECK).
       founder => the existing create_voice_variation path, name = the account display name, AXES ONLY.
                  tone, keywords, avoid_words and examples for a founder account are NOT persisted.
       Success => ONE conditional UPDATE: voice_status='applied', voice_applied_to, voice_applied_at,
                  staged_voice = NULL, WHERE voice_status IN ('pending','refused_cap','failed').
       voice_variation_cap_reached => voice_status='refused_cap', staged_voice KEPT.
       Any other failure => voice_status='failed', staged_voice KEPT.
   - declineBackfillVoiceAction - voice_status='declined', staged_voice nulled, conditional.
2. lib/backfill/ - extraction and ratification NEVER mix runs: every read of staging or import rows is keyed
   by run id; the two-accounts fixture proves it end to end.

TESTS:
- actions tests:
  - ratify without account_role is rejected by Zod; an accepted id array of 81 is rejected;
  - a forged p_user_id in form data is ignored (the RPC receives the session user);
  - brand apply writes brand_voices once, with <= 3 examples even when existing(3) + staged(3) are offered;
  - founder apply creates one variation with axes only - assert tone/keywords/examples absent from every
    write;
  - at 5 variations: refused_cap, staged_voice intact, memory items still ratified; delete one variation,
    retry succeeds and nulls staged_voice;
  - a thrown upsert => 'failed', staged_voice intact;
  - skipOnboardingAction leaves the run awaiting_ratification with zero voice writes and zero active rows.
- lib/backfill/__tests__/two-accounts.test.ts: founder + company runs on one business - staging, extraction
  inputs, staged voices and ratify calls never contain the other run's post ids; founder => variation, brand
  => brand_voices.
- lib/backfill/__tests__/resume.test.ts: fail-on-page-N through fetch AND through a mid-extraction crash
  (passes_done not yet updated) => resume on the same run id, re-run pass, ZERO duplicate memory rows, caps
  still hold; discard retires every candidate and deletes staging.
- staging lifecycle: staging gone after ratify, discard, disconnect (I2.9) and the TTL sweep (I2.9) - one
  assertion file listing all four.
- SHARED-FUNCTION CALLERS upsertBrandVoice: infer-brand-voice/actions.ts, step-2/actions.ts, and the new
  action - each with its test, and the existing two unchanged.

CONSTRAINTS CLOSED:
- BACKFILL-RESUMABLE-OR-DISCARDED (20, Tier 2). Redden: retry inserts a new run. Revert.
- BACKFILL-STAGING-PURGED (28, Tier 2). Redden: skip staging delete on discard. Revert.
- BACKFILL-WRITE-CAPS (36, Tier 2) - closes here (evidence/audience/performance caps from I2.10-I2.12 cited;
  voice-example cap and founder-axes-only proven here). Redden: concatenate examples. Revert.
- BACKFILL-ACCOUNTS-SEPARATE (42, Tier 2). Redden: key a staging read by business instead of run. Revert.
- BACKFILL-VOICE-RATIFIED (44, Tier 2). Redden: apply the staged voice inside ratify. Revert.
- BACKFILL-VOICE-RETRYABLE (46, Tier 2). Redden: null staged_voice on refused_cap. Revert.

Commit: "I2.13 BACKFILL-RESUMABLE-OR-DISCARDED BACKFILL-STAGING-PURGED BACKFILL-WRITE-CAPS
BACKFILL-ACCOUNTS-SEPARATE BACKFILL-VOICE-RATIFIED BACKFILL-VOICE-RETRYABLE".
```

#### I2.14 — The onboarding surface  ·  `taste-skill` then `impeccable`, against ADR 0025 §10

```
BUILDER - Session 32 - I2.14. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the "what we learned" moment, every state, and voice review through the existing step-2 - the UX
contract of ADR 0025 Section 10, which you IMPLEMENT and do not re-specify.

ORDER INSIDE THIS STEP:
(a) Build the structure first, contract-faithful and unstyled beyond house defaults:
    - step-4/page.tsx stays the completion page. ADD a "What we learned" panel ABOVE the existing
      completeOnboardingAction form. completeOnboardingAction is untouched and its CTA is ALWAYS enabled.
      Server Component page reads runs via the member SELECT (RLS) and passes plain data to a Client
      Component that owns accept/reject/accept-all-per-group/discard/retry and polls progress while
      queued/fetching/extracting (bounded interval, stops on a terminal state).
    - Information hierarchy EXACTLY Section 10.4, in order: (1) headline - N posts from <account>, <date
      range>, weighted or not; (2) voice summary - descriptor + three strongest axes + "Review voice";
      (3) what performed - up to three patterns each WITH ITS OBSERVATION COUNT ("based on 7 posts"), never
      phrased as an instruction; (4) how you talk to your audience - up to five statements; (5) proof you've
      published - count + excerpts, permission shown OFF, no toggle; (6) cadence and format mix - context.
    - Account role declaration ("this is my company" / "this is me") before voice can be applied.
    - Every Section 10.2 state: not started (why, and which platforms can); queued/fetching/extracting with
      real counts and "you can keep going"; awaiting_ratification complete; awaiting_ratification partial
      with the real count and stop reason; failed with plain-language reason and retry when resumable;
      unsupported - for LinkedIn, "we can't read your LinkedIn history yet", with NOTHING implying loading;
      nothing to learn; ratified/discarded confirmation.
    - step-2 backfill mode: ?run=<id> loads staged_voice in the Server Component and pre-fills the EXISTING
      VoiceEditor (Step2Form.tsx:150-157); saving calls applyBackfillVoiceAction. founder => axes only plus
      the one-line explanation; brand => the <= 3 example chooser. Refused/failed shows state + retry;
      "Don't use this voice" declines. With no run param, step-2 is byte-for-byte the website path.
      hasInferredContent / inferred_from_url are NOT used as a ratification signal.
    - A dismissible dashboard banner linking back while a run awaits ratification.
    - i18n: every string in messages en, pt and es in THIS commit. No hardcoded English.
(b) Invoke /taste-skill on the "What we learned" panel ONLY. Brief it: B2B SaaS founder, first real payoff
    moment, must feel earned and specific rather than a generic stats card; must respect the fixed Section
    10.4 order, shadcn v4 / Base UI, Tailwind only, existing design tokens in globals.css, both themes. Take
    its direction; reject anything that adds a state, reorders the hierarchy, renders a pattern as an
    instruction, or offers evidence permission.
(c) Invoke /impeccable to audit and polish ALL the surfaces from (a): hierarchy, cognitive load in the
    accept/reject groups, empty/error/partial states, UX copy in all three locales (Portuguese and Spanish
    strings run longer - check wrapping), keyboard and screen-reader paths for accept/reject and the progress
    region (aria-live polite), focus management after ratify/discard, responsive at ~400px, contrast in both
    themes. Any new colour is a globals.css token with a both-themes contrast assertion that reads the shipped
    token file. Optionally capture before/after with `openwolf designqc --routes` for the onboarding routes.
(d) Re-run the tests from (a) after (b) and (c); design passes must not change behaviour.

Rules: no asChild on Button or DropdownMenu primitives (buttonVariants() on <Link>); native <select> for
static options; Zod already on every action (I2.13); no console.*; date-fns for the date range.

TESTS:
- component tests, one per Section 10.2 state, each asserting the state's distinguishing copy key and
  controls - including: unsupported renders no spinner/progress element; partial renders the real count; the
  completion CTA is enabled in every state; evidence renders no permission control; each pattern line renders
  its observation count.
- step-2 backfill-mode test: founder shows no examples chooser; no run param renders the unchanged website
  path.
- i18n parity test: every key under the new namespaces exists in en, pt and es (and no key exists in only
  one).

CONSTRAINTS CLOSED:
- BACKFILL-UX-STATES (53, Tier 2). Redden: render a spinner for unsupported. Revert.
- BACKFILL-I18N-PARITY (54, Tier 2). Redden: delete one pt key. Revert.

Commit: "I2.14 BACKFILL-UX-STATES BACKFILL-I18N-PARITY" - and list in the body what taste-skill and impeccable
changed and anything of theirs you rejected, with the reason.
```

#### I2.15 — Tier-3 diffs, the constraint→CI map, the Tier-E protocol, and the owed items

```
BUILDER - Session 32 - I2.15. NO new behaviour. Evidence and records.

1. TIER 3 - diff-verified, NO runtime test by decision (ADR 0015 Section 2; ADR 0025 Section 11.3). For each,
   record in docs/decisions/0025-social-read-path-and-backfill.md a new appended "Builder verification
   (I2.15)" section - DO NOT edit Sections 0-13 - with the EXACT command, its output at HEAD, and a
   demonstration that it catches a temporary violation (make it, run, show the hit, revert):
   - BACKFILL-NO-RAW-TOKEN (13): git diff BASE..HEAD over lib/ for any new type/interface or row type with
     a field matching token|secret|refresh|access_?token other than the pre-existing TokenSet; and no new
     producer or consumer of TokenSet.
   - BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED (25): git diff BASE..HEAD -- supabase/migrations/ contains no
     reference to the trial trigger, its function, trial_state, or find_trial_expiring_between (names from
     I2.0 answer 8).
   - BACKFILL-NO-RELATIONSHIP-MEMORY (50): no relationship_memory table, type, or writer anywhere in the
     range.
   - BACKFILL-NO-GENERATION-CHANGE (51): git diff BASE..HEAD shows no change to the CustomerContext type, to
     lib/ai/context.ts's returned shape, or to any existing prompt file other than runner classification and
     the frozen-table rows for the three new backfill ids.
   - BACKFILL-NO-CROSS-CUSTOMER-LEARNING (52): no query, view, RPC or job in the range reads imported rows
     without a business_id predicate / RLS, and no aggregate across businesses is stored.

2. THE CONSTRAINT -> CI MAP. In the same appended section: all 56 rows - constraint, tier, the test file
   (or diff command, or protocol), the step and commit SHA that closed it, and the CI job that executes it
   (app-tests / db-tests / none-by-decision / out-of-band). Leave the "executed green in CI at <sha>" column
   EMPTY until the runs for the pushed head have been OPENED and read - then fill it with the run ids. Read
   the db-tests skip-guard line from the log and record its file and test counts. DO NOT write a total until
   every cell is filled from a run you opened.

3. TIER E - BACKFILL-POPULATED-MEMORY-EVAL (55). Record the Section 11.4 protocol as a runnable,
   founder-triggered procedure: build stub memory from a real X backfill output (a test account the founder
   owns), re-run the Session 30 corpus with it, compare to D9's 11/24. Mark it "MEASURED - NOT YET RUN" with
   its expected cost. Do NOT run it. Do NOT modify corpus.v2.json. State that neither outcome is a pass/fail
   gate on this session's code.

4. OWED ITEMS (ADR 0025 Section 8.2, 6.7):
   - docs/evidence/0010-legal-evidence.md - an Evidence Pack entry describing the import (what is read, what
     is retained and for how long per Section 8.3, the identity lock, per-post removal, no cross-customer
     use).
   - content/legal privacy MDX - counsel-ready prose covering the import of the customer's own posts and
     metrics and the retention; bump evidenceRef to the Evidence Pack commit. DO NOT substitute [LEGAL
     ENTITY]. Flag the prose as awaiting counsel per ADR 0025 Section 8.6.
   - docs/launch-checklist.md - the every-minute QStash schedule for /api/cron/backfill; X paid-tier read
     quota verified against 500 reads per run x expected connects; the 10-minute latency target observed on
     first real connects; the Section 8.6 counsel list (X Developer Agreement, founder-account purpose
     limitation, testimonial-permission copy).

Commit: "I2.15 BACKFILL-NO-RAW-TOKEN BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED BACKFILL-NO-RELATIONSHIP-MEMORY
BACKFILL-NO-GENERATION-CHANGE BACKFILL-NO-CROSS-CUSTOMER-LEARNING BACKFILL-POPULATED-MEMORY-EVAL".

End with one line: "Session 32 Builder complete - range BASE..HEAD, 16 steps, <n>/55 non-E constraints
executed green in CI at <sha> (Tier 1 <a>/16, Tier 2 <b>/34, Tier 3 <c>/5 diff-verified), Tier E recorded not
run, LinkedIn read built not served." Then STOP.
```

**Gate:** `§3` below was authored alongside this section and may be pasted as soon as `I2.15` has pushed
and its CI runs have been read. `§4` is authored **only after** the Reviewer has run.

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

**✅ AUTHORED 2026-09-13 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Authored **alongside §2**, per its own gate. **Only the
commit range is filled in at run time, by the Reviewer itself.**

**One correction to the placeholder, carried into the primer.** Its fourth predicted finding — *"a
per-platform capability claim in the ADR that the shipped `PostizProvider` cannot actually honour"* — was
written before ADR 0028 removed Postiz. It **inverts into two sharper traps**: (a) the `I2.2` temporary
`false` stub on `TwitterProvider` surviving to the Builder's head, so the only served platform silently serves
nothing while every mock-backed test stays green; and (b) coverage **claimed** for the `LinkedInProvider`
read body, which A-1 says is UNVERIFIED and has no test by design. The other three predictions stand and are
sharpened below.

**ECC budget for this phase — zero subagent invocations.** The Reviewer reads the diff itself. A
constraint-table walk against CI logs is not code analysis, and delegating it to cold-starting subagents
re-derives what the Reviewer has already read — the most expensive shape available on this plan. Skills
are free; `supabase:supabase-postgres-best-practices` is useful for the three migrations and is the only one
worth loading. **`impeccable` may be run read-only as an audit of the `I2.14` surfaces** against ADR 0025 §10
(the one read-only design-skill use the constitution permits outside a Builder); its output is evidence for
findings, never a patch.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 32 Track I - REVIEWER phase (I3). You are independent. You MODIFY NOTHING: no source, no tests, no
migration, no ADR, no build guide. Your single output is docs/reviews/session-32-reviewer.md. This is the ONE
review pass for this session.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE - git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR in Session
21B. Your report MUST OPEN with:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.
Exception (Session 22-F, NEW-12): documents you audit AGAINST are named at their own commits, SEPARATELY:
  "ADR 0025 and ADR 0002 Amendment B read at <sha>; build guide read at <sha>; reviewed artefacts read at
   <base>..<head>."
<base> is the docs-only commit that put ADR 0025 into git (Section 2 precondition). If ADR 0025 was not in
git at <base>, that is your first finding.

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0025-social-read-path-and-backfill.md - ALL of it; Section 12's 56 constraints are the
  checklist. Section 0's two interpretation notes are rulings, not open questions.
- docs/decisions/0002-social-provider.md Amendment B.
- docs/build-guide/session-32.md: Section 0 (L-1..L-11, L-7 superseded by L-7'), Section 0.2 (A-1..A-6),
  and Section 2b's step table (which step closes which constraint).
- docs/decisions/0015-test-execution-and-ci-gates.md Section 2 and Amendment B; docs/decisions/0016.
- CLAUDE.md: test-execution integrity, the SocialProvider boundary, Vault, three clients, RLS and the erasure
  cascade, Legal pages.

KNOWN AND NOT FINDINGS AGAINST THE BUILDER:
- LinkedIn cold start is NOT solved (A-1). LinkedIn historicalReadAvailable=false and a LinkedIn run ending
  'unsupported' is compliance.
- The LinkedIn read body has NO test by design. A finding is warranted only if coverage is CLAIMED for it.
- A founder voice persisted as axes only is a recorded narrowing (ADR 4.2), not a defect.
- No evidence permission toggle exists (A-6 copy is counsel-gated).
- BACKFILL-POPULATED-MEMORY-EVAL not run is correct - it is out-of-band. A finding is warranted if a number is
  reported as COVERED, or blended, or if corpus.v2.json was modified.
- The 10-minute latency target is operational (ADR 6.7); only the 30-minute stall transition is tested.
- discard_backfill_run as a SECURITY DEFINER function transcribes ADR 6.4's "one transaction"; judge its
  grant and membership check, not its existence.

THE TEN THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. THE ONLY SERVED PLATFORM SERVES NOTHING. I2.2 stubbed TwitterProvider with historicalReadAvailable=false;
   I2.3 was to flip it. At <head>: git show the file and confirm TRUE, the stub marker gone, and the
   provider-contract as-shipped pin (Twitter true, LinkedIn false, Mock true) present AND reddening if the
   Twitter flag is set false. Every orchestrator test uses MockProvider, so this failure is invisible to the
   whole Tier-2 suite. BLOCKER if wrong.

2. IMPORTING AN ACCOUNT THE CUSTOMER DOES NOT OWN. Three independent defences, check all three:
   (a) the social_accounts lock - the migration REVOKEs the TABLE-level UPDATE and GRANTs a column allowlist;
       a COLUMN-level REVOKE alone is ineffective against 20260707190000:28's table grant and is a BLOCKER.
       The Tier-1 test must attempt the UPDATE as authenticated and see 42501, per locked column - a
       pg_policies or information_schema read is not the test. Check no other SECURITY DEFINER function
       or authenticated-client updateSocialAccount caller can still write a locked column.
   (b) X identity verification on page 1 only, fail closed, ZERO timeline calls on mismatch.
   (c) cursors bound to socialAccountId.
   ADR 8.1 makes these LEGAL preconditions for the processor posture.

3. A PROVENANCE MARKER THAT DOES NOT SURVIVE. On ALL FOUR memory tables (brand_memory included even though no
   brand rows are imported): both biconditional CHECKs, the BEFORE UPDATE trigger on all three columns
   (including against service-role UPDATE), FK ON DELETE NO ACTION (RESTRICT breaks purge; CASCADE lets a run
   delete erase ratified memory). The survives-promotion test must include the COLLIDING distilled upsert and
   assert the import row is unchanged. Confirm ratify does not touch source or last_confirmed_at.

4. A RESUME PATH WITH NO TEST THAT CAN FAIL. BACKFILL-RESUMABLE-OR-DISCARDED and BACKFILL-IMPORT-IDEMPOTENT
   need: failure mid-FETCH and a crash mid-EXTRACTION between writes and passes_done, then resume on the SAME
   run id, and an assertion of ZERO duplicate memory rows. A test that resumes a run that never wrote memory
   proves nothing. Confirm retry is failed -> queued on the same row and that a caller_bug run is not
   resumable. Confirm the Tier-1 idempotency test re-invokes the import RPC, not just the TS wrapper.

5. AN EXTRACTOR THAT READS A COMMENT FIELD INCIDENTALLY. Run the I2.1 scans yourself at <head> and redden
   each. Then read the X request: exclude=replies,retweets, NO expansions, quotes dropped via the
   non-expanded referenced_tweets[].type, never non_public_metrics. Confirm RecentPost has NO field beyond the
   six in ADR 2.2 - a stray author_id or referenced id is an L-2 breach even if unused. Confirm the scan
   guards against an empty glob.

6. RATIFY THAT TRUSTS THE WRONG THING. ratify_backfill_run: EXECUTE to service_role ONLY (REVOKE from PUBLIC,
   anon, authenticated - verify with an authenticated EXECUTE attempt, Tier 1); p_user_id sourced from
   supabase.auth.getUser() in the action, NEVER from form data (find the action and show the line); membership
   checked against business_members with status active and approver/is_admin (a viewer refused, tested); the
   update filtered by source='import' AND import_run_id = p_run_id (a stuck summarize: candidate and an import
   row from ANOTHER run both left untouched, tested); staged_voice untouched.

7. VOICE THAT REACHES GENERATION UNRATIFIED OR UNRECOVERABLY. No write to brand_voices or
   brand_voice_variations outside applyBackfillVoiceAction (git grep the writers at the range). The success
   UPDATE nulls staged_voice in the SAME conditional UPDATE; refused_cap and failed KEEP it; the retry after
   deleting a variation succeeds (tested). Brand examples never exceed 3; founder writes axes only. The new
   voice prompt is NOT brand-voice-inference (which would consume trial attempts and run Opus).

8. MONEY AND TRIAL COUNTERS. reserve_backfill_spend is ONE conditional UPDATE, with a concurrent Tier-1 test
   where exactly one of two over-ceiling reservations wins. The purpose CHECK migration looks the constraint
   up by definition and RAISES unless exactly one matches - a DROP CONSTRAINT IF EXISTS with a guessed name is
   a MAJOR (silent no-op). Existing purposes still accepted, tested against their real writers. The three
   backfill prompt ids neither check nor increment trial counters, and EVERY pre-existing prompt id's
   classification is unchanged - list them.

9. GDPR ERASURE. Both new tables ON DELETE CASCADE from businesses; the two ADR 9.2 rows present VERBATIM in
   ADR 0010 Amendment 2 Section D2.5, landed in the same commit as the migration; purge_business proven by a
   live-Postgres case holding ACTIVE import rows on all four memory tables. staging has NO authenticated
   policy at all; runs has member SELECT only.

10. A COUNT THAT IS NOT EXECUTED GREEN. OPEN THE CI RUNS for <head>. 56 constraints: 16 Tier 1 (db-tests),
    34 Tier 2 (app-tests), 5 Tier 3 (diff commands - re-run each yourself and redden each), 1 Tier E
    (recorded, not run). Read the db-tests skip-guard line FROM THE LOG and record the file and test counts.
    If db-tests is RED, open the run and distinguish a DB-behaviour regression from the known supautils
    SIGSEGV in the local Postgres stack (Session 31-D D20); say which, never report one as the other.
    pull_request runs never move the promotion tally.

ALSO VERIFY, and do not take the Builder's word for any of it:
- SHARED-FUNCTION CALLERS, per caller with its test, AT THE RANGE: upsertBrandVoice (three callers now),
  runPrompt's trial classification (every id), updateSocialAccount (every caller and its client),
  TwitterProvider.refreshAccessToken, the OAuth callback (onboarding AND settings entry), 
  deactivateSocialAccount, and the ai_budget_daily purpose writers. A caller with no test is
  AUTHORED-NOT-EXECUTED for that caller.
- Bounds are REFUSED not clamped (RangeError before I/O); the provider never sleeps (fake timers); Retry-After
  capped at 900; 10 s timeout; withFreshToken per page; no new get_vault_secret call site.
- SocialProviderError.details, the cron log line and Sentry extras contain no post text, cursor, token or
  platform post id - tested by string search over captured output, not by reading the constructor.
- The run bounds bind in tests: 200 posts, 24 months (on publishedAt, not trusting notBefore), 5 pages, 500
  reads; an empty page with a cursor is not the end; dedupe on platformPostId.
- Performance n and lift RECOMPUTED from staging; fabricated backing ids discarded; confidence formula
  0.6*n/(n+5) in one helper; audience >= 2 backing posts at 0.3; evidence a verbatim substring <= 500 chars at
  0.5; caps 40/25/15 checked against rows already written for the run; expires_at from the source date.
- neutralizeWithSentinels at each import writer's choke point in lib/db, not the caller; post text wrapped
  [DATA]...[/DATA]; lib/backfill has no fetch and no website-fetcher import.
- MEM-NO-DIRECT-TABLE-ACCESS: no *_memory access outside lib/db/memory-*; the import wrappers imported only
  from lib/memory/.
- The UX: step-4 still the completion page with its CTA enabled in every state; the Section 10.4 hierarchy in
  order; patterns rendered with observation counts, never as instructions; unsupported shows nothing that
  implies loading; step-2 without ?run is unchanged; i18n en/pt/es parity; no asChild on Button or
  DropdownMenu; any new colour is a token with a both-themes contrast test reading the shipped token file.
  Record what taste-skill and impeccable changed per the I2.14 commit body, and whether anything they did
  broke the contract.
- The Tier-3 five: no change to the trial trigger / trial_state / find_trial_expiring_between; no
  relationship_memory; no CustomerContext or existing generation-prompt change beyond runner classification
  and frozen-table rows; no new token-bearing type; no cross-business aggregate.
- L-1 scope: no comment mining, embeddings, exemplar selection, outcome loop, retrieval change, LinkedIn
  fetchPostMetrics, widening of brand_voice_variations or the writing_examples CHECK.
- Legal: /privacy prose and evidenceRef bump present, [LEGAL ENTITY] NOT substituted, the Evidence Pack entry
  present, and the launch-checklist items (QStash schedule, X quota, latency observation, counsel list).
- Migrations: no committed migration was edited after commit (git log --follow per migration file); any
  database-reviewer finding was fixed by a forward migration.
- ECC budget: at most three Builder subagent invocations, per the commit bodies. Note if exceeded; it is a
  process finding, not a code defect.

Acknowledge in ONE line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 32 Track I Builder range and write docs/reviews/session-32-reviewer.md.

Open with the range line (PROC-REVIEW-AT-COMMIT), and name SEPARATELY the commits at which you read ADR 0025,
ADR 0002 Amendment B, and docs/build-guide/session-32.md.

Organise findings by ADR 0025's own sections so the correction pass can cite them:
  1. The read contract and Amendment B: interface, flags as shipped, types, bounds, error taxonomy, cursor
     binding, identity verification, own-posts-only, the mock fixtures (Section 2; A-1, A-2, A-3; L-2, L-11)
  2. Contract neutrality: nothing X-shaped on the types (Section 3)
  3. Extraction per memory type: weighting, the three passes, recomputed n, confidence, caps, evidence
     verify-then-cite, voice staging, no brand rows (Section 4; L-6, L-8)
  4. Provenance, recency and promotion (Section 5; L-3)
  5. Ceilings, cost, resumability, where it runs, the stall sweep, disconnect (Section 6; L-7')
  6. Token scope, the Vault path, the identity lock, scopes_granted (Section 7; L-5)
  7. Legal posture: owed items, retention, third parties, injection and SSRF (Section 8)
  8. GDPR and tenancy: the two tables, RLS, D2.5 rows, import and ratify RPCs, purge (Section 9; L-9)
  9. The UX contract, including what taste-skill and impeccable changed (Section 10)
 10. The test plan: every constraint's tier, its executing CI job, whether it REDDENS if the property breaks,
     the Tier-3 five as recorded diff commands, and Tier E framed MEASURED (Section 11)
 11. SHARED-FUNCTION CALLERS, per caller with its test - the seven of ADR Section 11.5
 12. Scope: L-1's out-of-scope list not shipped

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) the correction pass
will cite. For each: what is wrong, file:line AT THE RANGE, why it matters, and what would prove it fixed. Do
not propose patches - you write no code.

Where you believe ADR 0025 ITSELF is wrong rather than the implementation, say so and mark it an ADR finding,
not a Builder finding. The ADR already absorbed a pre-Builder review round (BACKFILL-IMPORT-IDEMPOTENT, the
purpose-CHECK lookup, the column-allowlist grant, staged_voice outliving ratify); a further defect is entirely
possible and you should say so if you find one.

Run the verification yourself rather than trusting the Builder's report:
  npm run typecheck ; npm run test:app ; npm run test:db
  the I2.1 source scans and the eslint probe, each reddened
  the five Tier-3 diff commands from the ADR's appended Builder verification section, each re-run at <head>
  and each reddened
  git grep for the seven shared functions and their callers
Open the CI runs for <head> and read the db-tests skip-guard line from the log. If db-tests is red,
distinguish a DB-behaviour regression from the known supautils SIGSEGV and say which.

State plainly anything you could NOT verify and why - a live X API response shape, the LinkedIn body, and the
10-minute latency target are all unverifiable in this session, and saying so is worth more than a confident
guess. Do not pad the report.

End with one line: "Session 32 review complete - <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni> NIT)
over range <base>..<head>; <c>/55 non-E BACKFILL-* constraints verified executed green in CI (Tier 1 <a>/16,
Tier 2 <t>/34, Tier 3 <d>/5 diff-verified); Tier E recorded not run." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and
`docs/reviews/session-32-reviewer.md` exists. A correction pass is a response to findings; inventing them
ahead of time produces a fictional resolution log.

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

**✅ AUTHORED 2026-09-15 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.**

**Filled in from `docs/reviews/session-32-reviewer.md`** (Reviewer range **`4f3e7129..3914a31c`**, 16 commits
`I2.1` `fd2d59ea` … `I2.15` follow-up `3914a31c`, on branch `session-30-5-adr-0028`). **Thirteen steps:
D0–D12.** Correction passes are normal, not failures (constitution). **There is no independent re-review pass
this session** (mirroring 23-D…31-D): this pass fixes the Reviewer's findings, records its own resolutions in
the Reviewer's own file, and the founder adjudicates close-out.

**Reviewer's tally: 3 BLOCKER, 12 MAJOR, 10 MINOR, 6 NIT — 31 findings.** Every one appears **exactly once**
in the disposition table below. **Three are ADR findings** (MINOR-8, MINOR-9, MINOR-10), where the Reviewer
judged ADR 0025 itself wrong or silent. Each of those closes with an **appended** ADR 0025 amendment as well as
code.

> **No finding is deferred by this guide.** There is no deferral column and no `docs/backlog.md` row for any
> finding. A step that cannot close its finding **REPORTS and STOPS**; only a founder ruling can move a
> finding out of this pass. This is the guide's posture, not a founder instruction — if the founder issues
> one (as for 31-D), record it here verbatim beside this note.

**The three BLOCKERs are three different failures, and only one is a code defect.**
- **BLOCKER-3 is the product failure.** `posts_extracted` has no writer anywhere in the range, and
  `BackfillPanel.tsx:255` gates the review surface on it being non-zero. Every real run reaches the founder as
  *"nothing to learn"*. **Nothing an import writes can become active through the product**, so Tier E's own
  measurement is structurally zero.
- **BLOCKER-2 is a gate failure the Builder could not see.** `npm run lint` exits 1 on two range-introduced
  errors, while the Builder's verification loop ran vitest only.
- **BLOCKER-1 is the session-state failure.** The branch was never pushed, so **0 of 56 constraints are
  executed green in CI**. The Builder disclosed this honestly in ADR 0025 §14.4. It closes **last** (D12),
  because a push before the corrections would produce green runs for a range this pass is about to invalidate.

---

### Founder adjudications — **two required, both PENDING; each is the named step's gate**

A-1…A-6 (§0.2) stand untouched and are **not** reopened. Two remedies are not engineering decisions, because
they change a recorded ruling or a legal-retention posture. Each is recorded below with the recommendation
and its named loser, **awaiting the founder**. The step it gates does not run until the Decision cell is
filled.

| # | Question | Recommendation (not a ruling) | Loser | Decision | Gates |
|---|---|---|---|---|---|
| **A-7** | MINOR-6: step-2 ships a second voice-review surface (`BackfillVoiceReview.tsx`), contradicting ADR 0025 §0 interpretation note 1 (*"the same `VoiceEditor` component … not … a second voice editor"*). Reuse `VoiceEditor`, or accept the second surface? | **Reuse `VoiceEditor`**, with an axes-only founder mode and the ≤ 3-example brand chooser. The ruling exists so exactly one voice editor has to be kept consistent. | Keeping `BackfillVoiceReview`: cheaper now, but the two editors drift, and the ruling becomes a dead letter recorded only in a commit body | _pending_ | **D9** |
| **A-8** | MINOR-9 (ADR finding): what retention governs **candidate** memory of a run that is never ratified or discarded? ADR §8.3 has no row, and today such rows persist forever. | **Retire at `BACKFILL_STAGING_TTL_DAYS = 30` after `completed_at`**, then delete retired import candidates 30 days later. This matches the horizon already accepted for staged post text. | (a) Keep forever: contradicts §8.4's "staging is short-lived" intent for third-party-adjacent excerpts. (b) Delete at 30 days with no retire step: loses the ratify/discard distinction in the audit trail. | _pending_ | **D3** |

**Engineering decisions this pass takes without a ruling, with the reason:**

| Finding | Remedy chosen | Why no ruling is needed |
|---|---|---|
| **MAJOR-8** | Correct `/privacy` and the Evidence Pack **to match the code and ADR §4.5** (only `usage_data` expires), not the code to the prose | §4.5 is the ruled text. The prose change bumps `evidenceRef`, keeps the counsel flag and leaves `[LEGAL ENTITY]` untouched. |
| **MINOR-4** | Discard requires `approver` or `is_admin`, the same gate as ratify | Discard is irreversible for every candidate, and §9.4 already gates the other founder decisions on a run this way. This aligns rather than invents. |
| **MINOR-8** | Revoke table-level INSERT and DELETE on `social_accounts` from `authenticated`, **only if D3's caller grep finds no authenticated INSERT/DELETE path** | §8.1 names the lock as a legal precondition, so closing the bypass restores intent. If an authenticated writer exists, **STOP** — that needs a ruling. |
| **MINOR-10** | Voice is applied **only to a `ratified` run, using `run.account_role`**; "Review voice" is not offered before ratify | §4.2 and §10.3 already say this; the amendment removes §10.4's contradicting placement. |
| **NIT-1** | **Recorded closure, no code** | `20260913130000` is committed and applied. Its DO block has already executed and fails loud on ambiguity, and no forward migration can alter it. |

---

### What the Reviewer found — disposition of all 31 findings (`session-32-reviewer.md` is authoritative)

| ID | Tier | One line | Disposition | Step |
|---|---|---|---|---|
| **BLOCKER-2** | **BLOCKER** | `npm run lint` exits 1: `BackfillBanner.tsx:20`, `linkedin-provider.ts:74` | FIX | **D1** |
| **MAJOR-6** | MAJOR | The NO-COMMENT-READ provider scan sees only `fetchRecentPosts`'s body; a helper plant stays green | FIX | **D2** |
| **NIT-6** | NIT | A missing `fetchRecentPosts` passes the scan | FIX | **D2** |
| **MAJOR-2** | MAJOR | Ratify activates memory and purges staging before its status guard | FIX (migration) | **D3** |
| **MAJOR-5** | MAJOR | Performance (15) and audience (25) caps unenforced; readers hide overflow | FIX (migration) | **D3** |
| **MINOR-3** | MINOR | Import RPCs don't require an `extracting` run | FIX (migration) | **D3** |
| **MINOR-4** | MINOR | A viewer can discard | FIX (migration + action; ADR at D11) | **D3** |
| **MINOR-8** | MINOR (**ADR**, §7.3) | The lock covers UPDATE only | FIX (migration; ADR at D11) | **D3** |
| **MINOR-9** | MINOR (**ADR**, §8.3) | No retention for unratified candidates | FIX per **A-8** (migration; ADR at D11) | **D3** |
| **NIT-4** | NIT | The lock test omits `id` | FIX | **D3** |
| **BLOCKER-3** | **BLOCKER** | `posts_extracted` never written; ratification unreachable | FIX (writer at D3, surface at D4) | **D4** |
| **MAJOR-3** | MAJOR | Fetch bounds reset per call | FIX | **D5** |
| **NIT-2** | NIT | `.neq` excludes NULL-code failed runs | FIX | **D5** |
| **MAJOR-11** | MAJOR | Any evidence error fails the batch; `partial: false` | FIX | **D6** |
| **MINOR-1** | MINOR | Thrown pass leaks its reservation | FIX | **D6** |
| **MINOR-2** | MINOR | Reconcile cross-reads usage rows | FIX | **D6** |
| **MAJOR-4** | MAJOR | No resume-with-memory duplicate test | FIX (Tier 1) | **D7** |
| **MAJOR-10** | MAJOR | STAGING-PURGED rests on a regex over SQL | FIX (Tier 1) | **D7** |
| **MAJOR-1** | MAJOR | Voice applied pre-ratify, to a form-chosen role | FIX | **D8** |
| **MAJOR-9** | MAJOR | ACCOUNTS-SEPARATE unproven | FIX (end-to-end test) | **D8** |
| **MINOR-10** | MINOR (**ADR**, §9.4/§10.4) | Ratify/voice ordering ambiguous | FIX (code at D8; ADR at D11) | **D8** |
| **MAJOR-12** | MAJOR | §10.4 hierarchy incomplete; date range empty | FIX | **D9** |
| **MINOR-6** | MINOR | Second voice editor vs ADR §0 note 1 | FIX per **A-7** | **D9** |
| **MINOR-5** | MINOR | Pre-existing prompt ids not asserted | FIX | **D10** |
| **MINOR-7** | MINOR | Stale "THREE files" CI comment | FIX | **D10** |
| **NIT-3** | NIT | Fields requested in transit | FIX | **D10** |
| **NIT-5** | NIT | Refresh erases known scopes | FIX | **D10** |
| **MAJOR-7** | MAJOR | Tier-3 #52 "Zero hits" false; #50 self-hits | FIX (ADR §15, appended) | **D11** |
| **MAJOR-8** | MAJOR | `/privacy` and Evidence Pack contradict the code | FIX (prose; `evidenceRef` bump) | **D11** |
| **NIT-1** | NIT | Purpose lookup lacks a namespace | RECORDED CLOSURE | **D11** |
| **BLOCKER-1** | **BLOCKER** | No CI run for the range | FIX | **D12** |

**Count check, re-run at D12:** 31 rows, 31 distinct IDs, every ID from the Reviewer's index exactly once. If
it fails, the pass is not closed.

---

### Ordering rationale

1. **D0 first.** The reviewer report is untracked, and it must enter git exactly as written so the appendix
   diff proves itself additive. ADR 0025 is already tracked, so there is no untracked ADR to land.
2. **D1 (BLOCKER-2) is the first code step**, because lint is part of the required gate and every later
   step's loop includes `npm run lint`.
3. **D2 (scan false-green) precedes every behavioural step.** This pass's proof standard is "the new test
   reddens", and D2 is the finding that the L-2 boundary scan cannot redden. D5 and D6 edit the paths it
   fences.
4. **D3 is the only migration, and it runs alone** (the 31-D D5 precedent). A second migration mid-pass makes
   earlier `test:db` runs meaningless. It is gated on A-8, and it precedes D4–D8, which test against its
   guards.
5. **D4 (BLOCKER-3) directly after D3.** Until the panel reaches the ratifiable state, no later voice, UX or
   two-account test exercises the real founder path.
6. **D5 before D6, and D6 before D7.** D7's resume test exercises both the cumulative bounds (D5) and the
   failed-pass state (D6); writing it first would pin pre-fix behaviour.
7. **D7 groups the two Tier-1 test-truth findings**: both need live Postgres, and both assert on every change
   before them.
8. **D8 before D9.** D8 decides when voice may be applied and to which store; D9 redesigns the surface around
   that gate.
9. **D9 is the only step that may invoke `/impeccable`** (Builder-phase design against ADR §10), and it is
   gated on A-7.
10. **D10 is residue**: nothing in it changes behaviour a constraint asserts.
11. **D11 is documentation truth, after every code step**, because every amendment cites the test that now
    proves it.
12. **D12 pushes last**, producing green runs for the corrected range.

---

### Where resolutions go (CLAUDE.md — `REVIEWER-REPORT APPEND-ONLY`, revised Session 23-D)

Resolutions go **into `docs/reviews/session-32-reviewer.md`**, under one appended, attributed
`## CORRECTION PASS (Session 32-D)` section at the end; there is no separate corrections file.

**The Reviewer's text is immutable:**
- Not one character is edited.
- No verdict is flipped, and no `RESOLVED` is stamped.
- This includes every "Verified" block, the "Could not verify" list, the Tier-3 table and the 31-row index.

**The appendix itself:**
- It references findings **by ID** and records *finding → fix → proving test → SHA*.
- A disputed finding is argued in the appendix, never erased.

**Never weaken a test to reach green.** Amend ADR 0025 (appended) if a constraint proves infeasible.

**ADR 0025 §14 is itself append-only** (its own §14.4), so MAJOR-7's correction is a new §15, never an edit to
§14.1. **Do not fold D0 and the first resolution row into one commit.**

**ECC budget: ≤ 1 subagent per step, and only where the finding names one.**
- **D3** → `security-reviewer` **and** `database-reviewer`, the single step permitted two: grants on a
  legal-precondition table, `SECURITY DEFINER` guards and a retention sweep.
- **D9** → `/impeccable`.
- **All other steps carry none.** Do not re-run the I2.4/I2.6 reviewers; the proving test is the
  confirmation.

**The highest-risk classes:**
- **(a) D3.** An over-wide REVOKE silently breaks OAuth connect. A count-then-insert cap reintroduces the race
  it closes, so use `import_evidence_memory`'s in-INSERT `< 40` shape.
- **(b) D4.** `posts_extracted` must count posts processed, never posts staged.
- **(c) D5.** Cumulative bounds must not strand a run that deferred on a 429 before reading anything.
- **(d) D8.** Gating on `ratified` must not break retry from `refused_cap`/`failed` on a ratified run.

Each ends by re-running the full existing suite for its files and confirming no previously-green assertion
changed.

---

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
You are the Session 32-D correction pass (Track I, ADR 0025 + ADR 0002 Amendment B). You fix the findings in
docs/reviews/session-32-reviewer.md - you do not re-review, and you do not re-litigate the Reviewer's
verdicts. Acknowledge these ten rules, then stop and wait for D0.

1. THE REVIEWER'S TEXT IS IMMUTABLE. Resolutions go in ONE appended, attributed
   "## CORRECTION PASS (Session 32-D)" section at the END of docs/reviews/session-32-reviewer.md, opening with
   author, date and the commit range fixed. Not one character above it changes. A disputed finding is argued
   in the appendix, never erased.
2. ONE STEP, ONE COMMIT, THEN STOP. Each step's commit message is given; use it.
3. EVERY FIX IS PROVED BY MUTATION. Break the fix, watch the new test go RED, restore, confirm
   `git diff --stat` is empty. Record the exact mutation in the appendix.
4. NEVER WEAKEN A TEST TO REACH GREEN. Amend ADR 0025 as an APPENDED section if a constraint is infeasible.
   ADR 0025 section 14 is append-only: correct it with a new section.
5. ALL 31 FINDINGS ARE ACCOUNTED FOR; NOTHING IS DEFERRED BY THIS GUIDE. A finding you cannot close, you
   REPORT and STOP. No docs/backlog.md row for any finding.
6. A-1..A-6 ARE RULED. A-7 AND A-8 ARE PENDING: D3 waits for A-8's Decision cell, D9 for A-7's. If a cell
   reads "pending" at its step, STOP. Never invent a ruling.
7. ONE MIGRATION, AT D3 ONLY. Never edit a committed migration. If another step appears to need SQL, STOP.
8. EVERY STEP'S LOOP: npx tsc --noEmit --skipLibCheck; npm run lint; npm run test:app with app-tests.yml's
   env block (five files fail at collection without it - env, not behaviour); and for D3/D4/D7/D8,
   npm run test:db against a running local Supabase stack. If the stack cannot start, STOP - a Tier-1 change
   is never committed unexecuted.
9. DO NOT PUSH BEFORE D12.
10. SCOPE IS THE FINDINGS. L-1 binds: no comment mining, embeddings, exemplar selection, outcome loop,
    retrieval or CustomerContext change, LinkedIn fetchPostMetrics, brand_voice_variations or writing_examples
    widening, relationship_memory, or new dependency. LinkedIn stays historicalReadAvailable=false.
```

---

### §4.1 — Correction steps

#### D0 — land the governing documents in git  ·  FIRST, by design  ·  no code

```
CORRECTION - Session 32-D · D0. No .ts/.tsx/.sql. No specialist.

THE STATE: docs/reviews/session-32-reviewer.md is UNTRACKED; docs/build-guide/session-32.md's committed
version predates this section 4 (this pass's work order). ADR 0025 is already tracked (4f3e7129; section 14
at 70773e87).

DO - commit exactly these two paths, AS THEY STAND:
- docs/reviews/session-32-reviewer.md  (EXACTLY as the Reviewer left it)
- docs/build-guide/session-32.md       (with section 4 authored - say so in the commit message)
Do NOT append the CORRECTION PASS section. Do NOT stage any code file; report any present and leave it.

VERIFY: `git show <D0-sha>:docs/reviews/session-32-reviewer.md` byte-identical to the working tree and
containing no "CORRECTION PASS"; `git show <D0-sha>:docs/build-guide/session-32.md | grep -c "### §4.1"`
non-zero; no code file in the commit.
On commit: "D0 - Session 32-D audit trail: the Reviewer's report enters git exactly as written (range
4f3e7129..3914a31c, 31 findings) before any resolution row, so the appendix is provably additive;
session-32.md lands with section 4 authored, since section 4 is this pass's work order." Then stop.
```

#### D1 — BLOCKER-2: the two lint errors

```
CORRECTION - Session 32-D · D1. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (BLOCKER-2): `npm run lint` exits 1 at 3914a31c with two range-introduced errors, so the REQUIRED
app-tests gate is red:
- components/onboarding/BackfillBanner.tsx:20 (9359a708): setDismissed(...) synchronously inside useEffect.
- lib/social/linkedin-provider.ts:74 (0b92f079): new Date(v).toISOString() - no-restricted-properties.

BUILD:
1. BackfillBanner: read the dismissed flag without a synchronous setState in an effect (e.g.
   useSyncExternalStore over localStorage, or an SSR-safe lazy initialiser). Keep: hidden until known,
   try/catch around storage, per-run key, no hydration mismatch.
2. linkedin-provider.ts:74: use toUtcIso() from '@/lib/utils'. The LinkedIn read stays NOT SERVED; claim no
   coverage for its body.
3. Leave the 107 warnings; they are not findings.

VERIFY: reintroduce each original line -> lint exits 1 naming that rule; restore; `git diff --stat` empty.
npm run lint exit 0; layout.test.tsx unchanged green; tsc; test:app (CI env).
Append the appendix opening block (section 4.2) and the BLOCKER-2 row.
On commit: "D1 - BLOCKER-2 closed: BackfillBanner no longer sets state synchronously in an effect and
LinkedInProvider uses toUtcIso(); npm run lint exits 0. Each original line reintroduced and shown to fail
lint." Then stop.
```

#### D2 — MAJOR-6 + NIT-6: make the L-2 boundary scan able to fail

```
CORRECTION - Session 32-D · D2. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist BY
DESIGN: the proof is a planted endpoint turning the scan RED.

THE DEFECT (MAJOR-6): lib/backfill/__tests__/source-scans.test.ts:107 extracts only fetchRecentPosts's own
body. Every X URL and fetch lives in private helpers (fetchTimelinePage, verifyReadIdentity). The Reviewer
planted 'https://api.x.com/2/tweets/1/liking_users' in fetchTimelinePage in a sandbox copy: 3/3 stayed green.
NIT-6: `if (body === null) continue` (:108) silently passes a renamed method.

BUILD:
1. Scan the READ PATH: fetchRecentPosts plus every private method it transitively calls, OR the whole
   provider file with only the separately declared fetchEngagement and fetchPostMetrics bodies excised. Pick
   whichever cannot silently shrink; state which.
2. NIT-6: fetchRecentPosts must exist in both provider files; missing is RED.
3. The lib/backfill/** half, BACKFILL-NO-URL-FETCH and the empty-glob guards stay unchanged in meaning.

VERIFY - one plant at a time on the working tree, restoring after each:
P1 (THE FINDING) liking_users URL in fetchTimelinePage -> RED; P2 in fetchRecentPosts -> RED; P3 fetch( in
lib/backfill/orchestrator.ts -> RED; P4 website-fetcher import in lib/backfill/extract.ts -> RED; P5
'fetchEngagement' in lib/backfill -> RED; rename fetchRecentPosts -> RED. After each, `git diff --stat` empty.
Paste the transcript into the appendix. tsc; lint; test:app (CI env).
Append the MAJOR-6 and NIT-6 rows.
On commit: "D2 - MAJOR-6 and NIT-6 closed: BACKFILL-NO-COMMENT-READ scans the whole read path including
private helpers, and a missing fetchRecentPosts is RED. The Reviewer's P1 plant, previously green, now
fails." Then stop.
```

#### D3 — the SQL: MAJOR-2, MAJOR-5, MINOR-3, MINOR-4, MINOR-8, MINOR-9, NIT-4, BLOCKER-3's writer  ·  THE ONLY MIGRATION

```
CORRECTION - Session 32-D · D3. GATE: A-8's Decision cell must be filled; if "pending", STOP.
/ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. Invoke security-reviewer AND database-reviewer
ONCE EACH, in parallel, after the migration and tests are drafted and before commit. Fix what they raise in
THIS uncommitted migration and record it.

ONE forward migration: supabase/migrations/<timestamp>_backfill_correction_pass.sql. Never edit
20260913120000..20260914060000. Each item gets a Tier-1 test in supabase/__tests__/.

1. MAJOR-2 - ratify_backfill_run (20260913150000:205-272) runs six memory UPDATEs (:239-257) and the staging
   DELETE (:259) before its only status guard (:268-269).
   BUILD: status check immediately after the FOR UPDATE lock; a run not 'awaiting_ratification' returns zero
   rows and touches NOTHING. Grants, membership check, source/import_run_id filter and staged_voice unchanged.
   TEST: ratify an 'extracting' run holding candidates -> zero status changes, staging count unchanged, zero
   rows returned. Existing ratify-backfill-run.test.ts unchanged green.
2. MAJOR-5 - import_audience_memory / import_performance_memory have no per-run cap (only evidence has
   `< 40`, 20260914050000:77-80).
   BUILD: the same in-INSERT shape, audience < 25, performance < 15, over rows already written for the run.
   TEST: 26 distinct audience and 16 distinct performance imports -> exactly 25 and 15 rows.
3. MINOR-3 - import RPCs don't check run status.
   BUILD: each writes zero rows unless the run is 'extracting'. TEST: discard, then each import -> zero rows.
4. MINOR-4 - discard accepts any active member (20260913150000:295-305).
   BUILD: non-null p_user_id requires status='active' AND (role='approver' OR is_admin); the NULL system path
   (deactivateSocialAccount) unchanged. In app/[locale]/(dashboard)/onboarding/step-4/backfill-actions.ts,
   discard and retry use requireApproverOrAdmin; delete requireActiveMember if unused.
   TEST: viewer discard raises; approver succeeds; NULL system discard succeeds.
5. MINOR-8 - authenticated holds table-level INSERT/DELETE on social_accounts.
   FIRST `git grep` every INSERT and DELETE of social_accounts across app/, lib/, supabase/migrations/ and
   list each with its client. If ANY uses an authenticated client, STOP AND REPORT.
   BUILD (only if none): REVOKE INSERT, DELETE ON public.social_accounts FROM authenticated, anon.
   TEST: signed-in owner INSERT and DELETE -> both 42501; the service-role callback upsert still succeeds.
6. MINOR-9 per A-8 - build EXACTLY the recorded decision. If it matches the recommendation: a service_role
   sweep (house grant shape) retiring import candidates of 'awaiting_ratification' runs whose completed_at
   is older than p_ttl_days, and deleting retired import candidates past the second horizon; wire it into
   runBackfillTick beside the existing sweeps. TEST: back-dated run -> retired; a ratified run's active rows
   untouched.
7. NIT-4 - add the `id` case to social-accounts-identity-lock.test.ts, expecting 42501.
8. BLOCKER-3's WRITER - nothing sets posts_extracted.
   BUILD: resolve_backfill_posts (same signature) increments the run's posts_extracted by rows it moves to
   'extracted' or 'skipped' - posts PROCESSED, never staged. State the definition in the migration header.
   TEST: claim 5, resolve 3 extracted + 2 skipped -> 5; re-resolving the same ids does not double-count.

VERIFY: npm run test:db green including every pre-existing Tier-1 file. For items 1-8, revert that hunk,
confirm its test RED, restore. tsc; lint; test:app (CI env).
Append rows for MAJOR-2, MAJOR-5, MINOR-3, MINOR-4, MINOR-8, MINOR-9, NIT-4, and a partial note for
BLOCKER-3 (closure at D4). Record the INSERT/DELETE grep verbatim and both reviewers' findings.
On commit: "D3 - the Session 32-D migration: ratify refuses non-awaiting runs before touching memory
(MAJOR-2); audience <25 / performance <15 in-INSERT (MAJOR-5); import RPCs require an extracting run
(MINOR-3); discard requires approver/admin (MINOR-4); authenticated INSERT/DELETE on social_accounts revoked
after a caller grep found none (MINOR-8); unratified candidates retired per A-8 (MINOR-9); lock test covers
id (NIT-4); resolve_backfill_posts maintains posts_extracted (BLOCKER-3 writer). Each hunk reverted and shown
RED." Then stop.
```

#### D4 — BLOCKER-3: make the founder's review surface reachable

```
CORRECTION - Session 32-D · D4. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (BLOCKER-3): app/[locale]/(dashboard)/onboarding/step-4/BackfillPanel.tsx:255 renders "nothing to
learn" when `run.posts_extracted === 0 || totalCandidates === 0`. No writer set posts_extracted at 3914a31c
(D3 added one), so every real run showed no candidates, no role declaration and no ratify button; :204, :271
and :281 showed 0. BackfillPanel.test.tsx:161/:210 passed only because fixtures hand-set the column.

BUILD:
1. Nothing-to-learn means zero candidates in all three groups AND no staged voice - never a counter alone.
2. progress/headline/partial copy reads posts_extracted as D3 defined it; if lib/backfill/extract.ts needs a
   call change for D3's writer to fire, make it here.
3. A test with NO hand-set posts_extracted: drive the MockProvider 'standard' fixture through fetchPhase and
   runExtractionUnit (mocked runPrompt, valid output) to awaiting_ratification, render the panel from that
   run and its candidates, and assert the ratify control and role fieldset are present. The 'empty' fixture
   still renders nothing-to-learn.
4. Remove posts_extracted from existing fixtures where it masked the defect; keep it only where a test is
   about the count copy - state which, per fixture.

VERIFY: restore the original condition -> the real-path test RED; stub D3's increment out -> the count-copy
test RED; restore; `git diff --stat` empty. test:db; tsc; lint; test:app (CI env).
Append the BLOCKER-3 row (D3 and D4 SHAs).
On commit: "D4 - BLOCKER-3 closed: the step-4 panel reaches the ratifiable state for a real run -
nothing-to-learn means no candidates and no staged voice, and counts read D3's posts_extracted. Proved by
driving the standard fixture through fetch and extraction with no hand-set counter." Then stop.
```

#### D5 — MAJOR-3 + NIT-2: bound the run, not the call

```
CORRECTION - Session 32-D · D5. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (MAJOR-3): lib/backfill/orchestrator.ts:111-117 keeps postsStaged, platformPostsRead and page
local to ONE fetchPhase call, restarting at cursor=null. A RATE_LIMITED/NETWORK deferral (:62-65), a resume
and a reconnect-triggered resume each re-enter with fresh counters: platform_posts_read passes 500 on the row
and staged rows can pass 200 (stage_backfill_posts counts only new inserts). Every fetch-phase test was a
single call (fetch-phase.test.ts:187, :204).
NIT-2: lib/db/backfill-runs.ts:316 `.neq('error_code','caller_bug')` excludes NULL-code failed runs.

BUILD:
1. fetchPhase seeds from the run's cumulative platform_posts_read and its existing staged count, stopping at
   500 reads and 200 staged. Pages stay a per-call non-terminating-cursor guard (comment why).
2. A run already at 500 cumulative reads moves to 'extracting' without calling the provider.
3. NIT-2: match error_code IS NULL or not 'caller_bug'.

VERIFY: new tests - three consecutive calls each deferred after 2 full pages -> cumulative reads <= 500 and
provider calls stop; a run with 150 staged stages at most 50 more; a resumed run at 500 makes zero provider
calls; a NULL-code failed run is resumable, caller_bug is not. Revert to per-call counters -> RED; revert
NIT-2 -> RED; restore; `git diff --stat` empty. Existing fetch-phase cases unchanged green. tsc; lint;
test:app (CI env).
Append the MAJOR-3 and NIT-2 rows.
On commit: "D5 - MAJOR-3 and NIT-2 closed: fetchPhase bounds reads (500) and staged posts (200) against the
run's cumulative totals across deferrals, resumes and reconnects; resumable lookup includes NULL codes.
Proved by a three-deferral test RED against per-call counters." Then stop.
```

#### D6 — MAJOR-11 + MINOR-1 + MINOR-2: a failed pass never looks complete, and never leaks spend

```
CORRECTION - Session 32-D · D6. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECTS:
- MAJOR-11: lib/backfill/extract.ts:205-215's bare catch treats every runPrompt throw as invalid output,
  permanently fails up to 20 claimed posts, and :187-189 finalises partial:false regardless - ADR 6.4's
  "half-imported memory that looks complete". ADR 4.5 fails closed on INVALID OUTPUT only.
- MINOR-1: :129/:164 reserve before runPrompt; a throw skips reconcile, the next tick re-reserves, and the
  updated_at bump hides the run from the stall sweep, draining the 50c run and 150c daily budgets.
- MINOR-2: reconcileSpend reads getMostRecentUsageCostCents(business_id, promptId) (:85), not run-scoped.

BUILD:
1. MAJOR-11: distinguish the runner's output-validation AiError (check lib/ai/runner.ts for its code) from
   everything else. Validation -> batch 'failed' as today. Anything else -> posts return to a retryable state
   and the reservation reconciles to zero. If a retryable state needs SQL, STOP - SQL was D3's. The final
   transition sets partial=true with a reason whenever any staged post is 'failed'.
2. MINOR-1: every reservation is reconciled on every exit path (try/finally), actual = 0 when no call
   completed - voice and insights included.
3. MINOR-2: take the call's own cost from lib/ai (widen runPrompt's return or add a lib/ai helper; no SDK call
   outside lib/ai); delete the most-recent-row lookup from extract.ts.

VERIFY: new tests - a network error on an evidence batch leaves posts retryable and spend unchanged; a
schema-validation failure still fails the batch; any failed post finalises partial=true; a throwing voice pass
reconciles run and daily budgets to 0; two concurrent runs on one business reconcile their own cost. Restore
the bare catch -> RED; remove the finally -> RED; restore; `git diff --stat` empty. Existing extract.test.ts
and runner.test.ts cases unchanged green. tsc; lint; test:app (CI env).
Append the MAJOR-11, MINOR-1 and MINOR-2 rows.
On commit: "D6 - MAJOR-11, MINOR-1, MINOR-2 closed: only output-validation failures fail an evidence batch;
transient errors release the batch and reservation; any failed post marks the run partial; every reservation
reconciles on every exit path against the call's own cost." Then stop.
```

#### D7 — MAJOR-4 + MAJOR-10: the two tests that could not fail

```
CORRECTION - Session 32-D · D7. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.
Requires the local Supabase stack (rule 8).

THE DEFECTS:
- MAJOR-4: no test writes memory, crashes between a pass's writes and increment_backfill_passes_done,
  resumes the SAME run id and counts memory rows. fetch-phase.test.ts:274 checks staging against mocks; the
  Tier-1 RPC test only ignores byte-identical re-inserts.
- MAJOR-10: lib/backfill/__tests__/staging-lifecycle.test.ts:13-58 regex-matches DELETE text in SQL. Only
  ratify's purge executes (ratify-backfill-run.test.ts:158); discard, both TTL sweeps and disconnect do not.

BUILD:
1. supabase/__tests__/backfill-resume.test.ts (Tier 1; real RPCs; mock provider and runPrompt only):
   a. fail on page 3, resume the same run id, complete -> staged rows unique, run id unchanged;
   b. let insights write, throw BEFORE increment_backfill_passes_done, resume, re-run returns DIFFERENTLY
      WORDED output -> audience <= 25, performance <= 15, zero exact duplicates, passes_done advances once;
   c. caller_bug not resumable; retry is failed -> queued on the same row.
2. supabase/__tests__/backfill-staging-purge.test.ts (Tier 1): discard purges staging; both TTL sweeps with
   back-dated completed_at / ratified_at purge staging and null staged_voice while a fresh run is untouched;
   deactivateSocialAccount through the real discard RPC purges staging.
3. Delete staging-lifecycle.test.ts, or reduce it to a pointer comment - a regex over SQL must not stand as
   coverage. Say which.

VERIFY: remove D3's audience cap -> 1b RED; drop discard's DELETE in a scratch migration applied only locally
-> discard case RED; revert, `supabase db reset`, restore; `git diff --stat` empty. test:db green including
the skip-guard; tsc; lint; test:app (CI env).
Append the MAJOR-4 and MAJOR-10 rows.
On commit: "D7 - MAJOR-4 and MAJOR-10 closed: a Tier-1 resume test crashes extraction between writes and
passes_done, resumes with differently worded output, and proves no duplicate or over-cap memory; staging
purge is executed for discard, both TTL sweeps and disconnect; the SQL regex no longer stands as coverage."
Then stop.
```

#### D8 — MAJOR-1 + MAJOR-9 + MINOR-10 (code): voice only after ratify, only to the ratified role

```
CORRECTION - Session 32-D · D8. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECTS:
- MAJOR-1: stage_backfill_voice sets voice_status='pending' during extraction (20260914040000:60);
  applyBackfillVoiceAction (backfill-actions.ts:189-231) checks neither run.status==='ratified' nor
  run.account_role and branches on the form's accountRole (:206). "Review voice" sits in the pre-ratify view
  (BackfillPanel.tsx:286-296); step-2/page.tsx:25-43 renders review for any status;
  BackfillVoiceReview.tsx:48 defaults an editable role to 'founder'.
- MAJOR-9: BACKFILL-ACCOUNTS-SEPARATE's only test is mock-provider.test.ts:262.
- MINOR-10 (code): ADR 4.2/10.3 order voice after ratify with the role declared.

BUILD:
1. Apply and decline refuse unless run.status === 'ratified' and run.account_role is non-null; route ONLY by
   run.account_role; the Zod schema no longer accepts accountRole from the client (brand keeps tone,
   keywords, avoidWords, writingExamples max 3). Retry from refused_cap/failed on a ratified run still works.
2. "Review voice" only for a ratified run with voice_status pending/refused_cap/failed. Step-2 renders review
   only for such a run; any other ?run falls through to Step2Form. The role is shown, not editable.
3. MAJOR-9: an end-to-end test over TWO_ACCOUNTS_FOUNDER and TWO_ACCOUNTS_COMPANY on ONE business: fetch ->
   extract -> ratify (founder / brand) -> apply voice. Assert every memory row's import_run_id belongs to its
   own account's run; ratifying A changes no row of B; founder -> exactly one brand_voice_variations row,
   axes only; brand -> brand_voices, no variation; no staged_voice crosses runs. Tier 1 with real RPCs
   (preferred), or say why not.

VERIFY: new action tests - apply on 'awaiting_ratification' refused with no voice writer called; client
accountRole rejected at Zod; a ratified founder run never calls upsertBrandVoice. Remove the status check ->
RED; route by a client field -> two-accounts routing RED; restore; `git diff --stat` empty. Existing
cap/retry/decline tests unchanged green. test:db; tsc; lint; test:app (CI env).
Append the MAJOR-1, MAJOR-9 and MINOR-10 (code) rows.
On commit: "D8 - MAJOR-1 and MAJOR-9 closed, MINOR-10 code half: voice applies only to a ratified run and only
to the role recorded at ratification, and Review voice appears only after ratify; an end-to-end two-account
test proves corpora, candidates and voices never mix." Then stop.
```

#### D9 — MAJOR-12 + MINOR-6: the §10.4 hierarchy, on the editor A-7 rules on  ·  the ONE step that may invoke /impeccable

```
CORRECTION - Session 32-D · D9. GATE: A-7's Decision cell must be filled; if "pending", STOP.
/ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. Invoke /impeccable ONCE against ADR 0025 section 10.
taste-skill stays declined (I2.14's recorded reason).

THE DEFECTS:
- MAJOR-12: BackfillPanel.tsx:286-296 shows the voice summary as title + link only (10.4 item 2 needs the
  descriptor and three strongest axes); item 6 (cadence and format mix) is absent; the headline reads
  summary.date_range (:264, :273), which lib/backfill/stats.ts never writes.
- MINOR-6: step-2 ships BackfillVoiceReview.tsx instead of VoiceEditor, against ADR 0025 section 0 note 1.

BUILD:
1. All six 10.4 items, in order: headline with N posts, account and a REAL date range (derive from staged
   data or add a range to BackfillStatsSummary - never read a field nothing writes); voice descriptor + three
   strongest axes; up to three patterns with "based on N posts", never phrased as instructions; up to five
   audience statements; evidence count with excerpts, permission off; cadence and format mix. New strings in
   en/pt/es; parity test green.
2. MINOR-6 per A-7: REUSE -> step-2 ?run renders VoiceEditor (axes-only founder mode, <=3-example brand
   chooser) against D8's gated actions, BackfillVoiceReview.tsx deleted; KEEP -> record the ruling reference.
3. No asChild on Button/DropdownMenu; buttonVariants() on Link; Tailwind only; existing tokens only - a new
   token needs a both-themes contrast test reading the shipped token file.

VERIFY: component tests from a summary produced by calling computeBackfillStats (not a hand-written
fixture): six items in DOM order, date range non-empty, patterns carry counts; step-2 renders the A-7 editor
for a ratified run and Step2Form otherwise. Reintroduce the date_range lookup -> RED; drop item 6 -> RED;
restore. Every 10.2 state test unchanged green. tsc; lint; test:app (CI env).
Append the MAJOR-12 and MINOR-6 rows, and what /impeccable changed, file by file.
On commit: "D9 - MAJOR-12 and MINOR-6 closed: step-4 renders all six section 10.4 items in order from the
summary stats.ts actually writes, with a real date range and cadence/format mix; step-2 voice review follows
A-7. /impeccable run against ADR 0025 section 10." Then stop.
```

#### D10 — MINOR-5 + MINOR-7 + NIT-3 + NIT-5: the residue

```
CORRECTION - Session 32-D · D10. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECTS:
- MINOR-5: lib/ai/runner.test.ts:980-1000 checks four fixture prompts plus brand-voice and a synthetic id.
  The ten ids at 4f3e7129: brand-voice-inference, brief-assembly, learning-summarizer, post-generation,
  post-regeneration, rubric, studio-suggestion, native-generation-single, native-generation-thread,
  native-generation-carousel.
- MINOR-7: .github/workflows/app-tests.yml:31 says "THREE files"; fetch-phase.test.ts and tick.test.ts also
  import the real lib/config.ts.
- NIT-3: lib/social/twitter-provider.ts:63 requests entities and referenced_tweets; entities.mentions brings
  third-party ids/handles in transit.
- NIT-5: twitter-provider.ts:537 writes scopes_granted: [] when refresh omits scope (pinned at
  twitter-provider.test.ts:319).

BUILD:
1. MINOR-5: a table-driven case over all ten real prompt objects asserting Step-1 refusal and Step-8
   increment per id, under an exhausted trial context and a paid context. No production change.
2. MINOR-7: both files mock '@/lib/config'; correct the yml comment to the true count.
3. NIT-3: request only what the parser reads; referenced_tweets stays (ADR 2.4 quote-dropping). If urls cannot
   be had without mentions, keep entities and record the decision for D11. No expansion.
4. NIT-5: omit scopes_granted from the refresh UPDATE when scope is absent; update :319 to assert the prior
   value survives.

VERIFY: change brief-assembly's classification locally -> its row RED; unmock config -> fails without env;
write [] again -> RED; restore each; `git diff --stat` empty. fetch-phase and tick tests pass in a bare shell.
The :404 request test still asserts exclude=replies,retweets and no expansions. tsc; lint; test:app (CI env).
Append the four rows and "did NOT touch: classification logic; no new CLAUDE.md carve-out".
On commit: "D10 - MINOR-5, MINOR-7, NIT-3, NIT-5 closed: classification asserted for all ten pre-existing
prompt ids; backfill tests mock config and the CI comment is true; the X read requests only what the parser
needs; a scope-less refresh no longer erases known scopes." Then stop.
```

#### D11 — documentation truth: MAJOR-7, MAJOR-8, NIT-1, and the ADR amendments for MINOR-4/-8/-9/-10  ·  no code

```
CORRECTION - Session 32-D · D11. No .ts/.tsx/.sql. No specialist. Every statement cites the test
(file:line) that now proves it at D3..D10's SHAs.

THE DEFECTS:
- MAJOR-7: ADR 0025 section 14.1 (:1149 at 3914a31c) claims "Zero hits" for the NO-CROSS-CUSTOMER-LEARNING
  command; at the range it prints 33 signature lines and cannot see function bodies. The #50 command now
  matches section 14.1's own prose (:1127, :1129).
- MAJOR-8: content/legal/privacy.en.mdx:114 says quoted excerpts last "up to 12 months"; quote/case_study
  rows get expires_at NULL (lib/memory/import.ts:66-70). Evidence Pack A3 :745 (expiry), :748 (caps, enforced
  only since D3), :749 (no indefinite candidates, true only since D3/A-8), and "5 pages / 500 reads per run"
  (true only since D5).
- NIT-1: 20260913130000:310/:321 look up the purpose CHECK by relname without a namespace.

DO:
1. ADR 0025 - append "## 15. Correction pass verification (Session 32-D)"; never edit sections 0-14:
   a. MAJOR-7: corrected Tier-3 commands, each true at this head with a planted-violation demonstration. #52
      inspects function/VIEW BODIES for any SELECT over a *_memory or backfill table with no business_id
      predicate; #50 excludes docs/decisions/0025-*. State that section 14.1's "Zero hits" was wrong and that
      the property itself held on manual reading.
   b. MINOR-8: the lock covers INSERT and DELETE, citing D3's grep and test.
   c. MINOR-9: the unratified-candidate retention rule verbatim per A-8, with a new section 8.3 row.
   d. MINOR-10: voice review/application require a ratified run and use run.account_role; section 10.4's
      "Review voice" placement superseded. MINOR-4: discard requires approver/admin.
   e. NIT-1: recorded closure - a committed, applied migration whose DO block already executed; ambiguity
      raises; no forward migration can alter an executed lookup.
   f. Section 11.5's upsertBrandVoice row corrected to the six callers the Reviewer enumerated.
   g. Do NOT fill section 14.2's CI column - that is D12's, from the logs.
2. MAJOR-8 - privacy.en.mdx: the retention row says what the code does (usage_data excerpts expire 12 months
   after the source post; other excerpts remain until deleted or removed per post; unreviewed candidates are
   retired per A-8). Keep the AWAITING COUNSEL REVIEW comment. Do NOT substitute [LEGAL ENTITY].
   docs/evidence/0010-legal-evidence.md: append Amendment A3.1 correcting A3's statements, citing D3/D5 tests -
   never edit A3. Bump evidenceRef to the commit carrying A3.1 (a two-commit follow-up is acceptable, as I2.15
   did - state it).

VERIFY: `git diff <D10-sha>..HEAD` on ADR 0025 and the Evidence Pack shows additions only below section 14 and
below A3; `grep -c "LEGAL ENTITY" content/legal/privacy.en.mdx` unchanged; each corrected Tier-3 command
re-run with output and planted violation pasted into section 15; d2.5-backfill-rows.test.ts green.
Append the MAJOR-7, MAJOR-8 and NIT-1 rows, and the ADR half of MINOR-4, MINOR-8, MINOR-9, MINOR-10.
On commit: "D11 - MAJOR-7, MAJOR-8 closed, NIT-1 recorded: ADR 0025 section 15 records true, body-aware Tier-3
commands and corrects section 14.1's 'Zero hits'; amendments for the identity lock, unratified-candidate
retention (A-8), voice/discard ordering and roles; /privacy and Evidence Pack A3.1 say what the code does,
evidenceRef bumped, [LEGAL ENTITY] untouched." Then stop.
```

---

### §4.2 — Resolution log (the appendix's required shape)

The appendix in `docs/reviews/session-32-reviewer.md` is written **incrementally, one block per step**. D1
opens it, D2…D11 append, and D12 closes it. It is never assembled from memory at the end.

**Opening block (written at D1):**

```
## CORRECTION PASS (Session 32-D)

**Author:** Session 32-D correction pass · **Date:** <YYYY-MM-DD> · **Range fixed:** `3914a31c..<D12-sha>`
**Reviewed head:** `3914a31c` — the head the Reviewer read; only this pass's section 4 landed after it, at D0
(`<D0-sha>`).
**Founder adjudications consumed:** A-7 = <decision>, A-8 = <decision> (build-guide section 4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**
```

**Per-finding row shape.** All five fields; a row missing one is not complete:

| Field | What it must say |
|---|---|
| **Finding** | The ID, and nothing restated from the Reviewer's text |
| **Fix** | What changed, in one sentence, naming the file |
| **Proof** | The test file **and line**, never "covered by the suite" |
| **Reddening** | The exact mutation, and the clean tree confirmed afterwards |
| **Commit** | The step's SHA(s) |

**Rows that are not ordinary fixes:**
- **NIT-1** is the only **recorded closure**. It states why no code change can express the fix and names the
  §15 paragraph.
- **BLOCKER-3** carries two SHAs (the D3 writer, the D4 surface) and D3's definition of `posts_extracted`.
- **MINOR-4, MINOR-8, MINOR-9, MINOR-10** each carry a code SHA and an ADR SHA, citing their §15 sub-item.
- **MINOR-6 and MINOR-9** quote the adjudication they executed (A-7, A-8).

**Every step appends a "what I did NOT touch" line** where it had a tempting adjacent target:
- D1: the 107 warnings.
- D3: no LinkedIn scope or flag change, no allowlist widening.
- D5: no persisted cursor (ADR §6.4's named loser).
- D6: no retry loop in the provider.
- D9: `taste-skill` not run.
- D10: no classification change.
- D11: `[LEGAL ENTITY]` not substituted, and §14.2's CI column left for D12.

---

### §4.3 — Close-out

#### D12 — BLOCKER-1: push the corrected range, run CI green, close Track I

```
CORRECTION - Session 32-D · D12. No specialist. This step produces green runs FOR THE CORRECTED RANGE, which
turns 55 AUTHORED-NOT-EXECUTED rows into executed-green rows and makes D11's citations true.

THE DEFECT (BLOCKER-1): at 3914a31c the branch was 17 commits ahead of origin/session-30-5-adr-0028
(7202da89) and had NEVER been pushed; `gh run list --commit` returned nothing for any range commit; no
app-tests run, no db-tests run, no skip-guard line. The Builder did NOT misreport this (ADR 0025 14.4).

DO:
1. Push D0..D11; run every required workflow to green at the corrected head:
   - app-tests (tsc + eslint + vitest) - REQUIRED; lint must be green.
   - db-tests INCLUDING THE SKIP-GUARD. If red, OPEN THE RUN and distinguish a DB-behaviour regression from a
     stack OOM / the known supautils SIGSEGV (Session 31-D D20), quoting the deciding log line.
2. Record FROM THE LOGS: app-tests URL and counts; db-tests URL and the skip-guard's file and test counts
   QUOTED VERBATIM; per-row "executed green in CI at <sha>" for ADR 0025's constraint table - as a section 15
   table if section 14's append-only wording forbids filling 14.2, saying which. Tier 1 stays uncovered unless
   db-tests ITSELF is green; Tier 3 cites D11's corrected commands; Tier E (#55) stays MEASURED - NOT YET RUN.
3. db-tests PROMOTION TALLY: pull_request runs never move it; only consecutive green master PUSH runs do.
   Record it in docs/current-phase.md with each run's event type.
4. docs/current-phase.md - Session 32 close-out entry: this pass and its range; real post-correction counts at
   the head they are dated to, never claimed; the tally; LinkedIn cold start NOT solved (A-1); Tier E NOT RUN
   and now performable through the product. No quality or memory-yield claim: MEASURED, never COVERED.
5. Section 5 of docs/build-guide/session-32.md - tick with evidence, stating per item whether it applied.
   Correct section 5's stale "Amendment A" references to Amendment B (section 0's sign-off ruled B) in an
   appended note, not in place.
6. THE APPENDIX CLOSING BLOCK: all 31 findings by ID -> disposition -> proving test -> SHA(s); re-run the
   count check (31 rows, 31 distinct IDs) - if it fails, the pass is not closed. Name the recorded closure
   (NIT-1), the adjudicated executions (MINOR-6/A-7, MINOR-9/A-8) and the four code+ADR closures. Answer the
   Reviewer's "could NOT verify" list: CI results (cite); Tier-1 execution (what db-tests ran); live X shape,
   LinkedIn body, 10-minute latency (still unverifiable - say so); ECC reviewer output (D3's recorded;
   I2.4/I2.6's still summarised only). State which Reviewer "Verified" entries have since changed - WITHOUT
   editing them.
7. .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md; log every bug from this pass to .wolf/buglog.json.

VERIFY: `git diff <D0-sha>..<D12-sha> -- docs/reviews/session-32-reviewer.md` shows additions BELOW the
appendix marker and NOTHING ELSE. Required workflows green at the corrected head, or their red explained from
the log with evidence in the appendix.
On commit: "D12 - BLOCKER-1 closed: Builder range plus D0..D11 pushed; app-tests green at <sha> (<URL>);
db-tests <state> (<URL>, skip-guard <n> files / <n> tests quoted from the log); BACKFILL-* rows executed green
recorded per tier at the head they are dated to; db-tests tally per run with event type. The 32-D appendix
records all 31 findings - NIT-1 the single recorded closure, MINOR-6/MINOR-9 per A-7/A-8 - and the diff proves
nothing above the appendix changed. LinkedIn cold start not solved; Tier E not run. Session 32 Track I closed."
Then stop.
```

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
