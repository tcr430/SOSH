# Session 30 — Mode 3's second signal source: market-responsive ingestion (ADR 0023) · Track G

> **Goal:** close the last buildable gap in `docs/brainstorm/plan-vs-implemented-gap-analysis.md` — Mode 3
> ingests exactly one signal kind from exactly one source (GitHub releases, company-originated), while the
> intelligence-layer doc §2 names three opportunity types. Track G builds the **second source**:
> market-responsive (competitor / news monitoring).
>
> **This is not "one more poller."** Track G is the session where four separate deferrals, each recorded
> against a different revival condition, all come due at once — and the Architect's real job is to rule on
> each one honestly rather than let a new poller drag them along unexamined:
>
> 1. **ADR 0020 §6.5 — embeddings / pgvector in Stage B**, deferred with the revival condition *"a second,
>    unstructured source."* Track G **is** that source. The condition is met **by construction**, so the
>    ruling cannot be dodged. Note that `SIGNAL-NO-EMBEDDINGS` is a **Tier-3 diff-verified** constraint —
>    un-deferring means retiring a Tier-3 constraint, which ADR 0015 §2 requires be a recorded decision.
> 2. **ADR 0020 §14 — clustering**, deferred with a *different* condition: *"revived by a second signal
>    kind belonging to one release."* A news source is a second **source**, not a second kind belonging to
>    one release. **That condition is NOT met.** The ADR must say so rather than reviving clustering by
>    association.
> 3. **The brainstorm's standing constraint on triage** — Mode 3's triage *"should not be scaled to
>    multiple signal sources until that harness exists."* The harness now exists (Tier E, ADR 0015
>    Amendment B). But its only result to date is a documented **bootstrap ceiling** — precision 1.000,
>    recall 1.000, dismissMatch 1.000 against **hand-authored cassettes scored against their own
>    hand-assigned labels**. **The founder has ruled this does NOT satisfy the constraint** (§0 L-11,
>    2026-08-21) — and that the correct response is to fix the corpus and bound the allocation, not to
>    block the source. §0.1 Q1 therefore asks *how*, with four numbers, not *whether*.
> 4. **ADR 0020 L-8 / §8.6 — plan gating**, whose seam is `connectGithubAction`. A second source is the
>    moment that seam either gets used or gets a second copy.
>
> **And the security shape is genuinely different from ADR 0020's.** A GitHub release body is
> attacker-*influenceable* — a merged PR is enough to write one, but it arrives from an authenticated app
> the customer installed, about a repo the customer chose. News and competitor content is
> **attacker-authored, from a source the customer did not vet, at a volume the attacker controls**, and it
> enters a model **with tool access** (ADR 0021's Stage C loop). ADR 0020 §7's guarantees are the floor
> here, not the ceiling.
>
> **Prerequisite, absolute.** Session 30 does not begin until **Session 29 (ADR 0022, Track F) has closed**
> — Builder, Reviewer and correction pass — and its work is green on `master`. Track G shares no code with
> Track F, but it shares the Stage C triage loop's cost budget and the `signals` schema, and stacking two
> unreviewed sessions is what produced the `master` divergence Session 29 Step 0 exists to undo.

---

## Reality check — to be re-verified against the live repo before the Architect runs

Stated at the shape found at `66262711` (Session 28-D close-out), i.e. **before** Session 29. **Re-verify
at Session 29's merged head**, since Track F touches `lib/ai/prompts/formats/` and `campaigns.origin` —
neither of which Track G reads, but the tree will have moved.

1. **Mode 3 today is one source, one signal kind, four tables, 33 `SIGNAL-*` constraints** (ADR 0020 §12).
   The whole ingestion half was designed against a single well-structured source. **Track G is the first
   multi-source shape the schema has ever carried**, and the ADR should expect to find assumptions that
   were free with one source and are not free with two.
2. **The signals boundary is enforced by an executable source scan, not by convention.**
   `lib/signals/source-scans.test.ts` implements ADR 0020 §11.3's four scans, each with a **per-root
   vacuity guard** (*"an empty or renamed root must fail loudly, not pass vacuously — that is the
   FALSE-GREEN shape ADR 0015 exists to catch"*), and its header records that each scan was
   **demonstrated to redden** before being reverted. **Track G's new client must land behind the same
   boundary and the scans must be extended to know about it** — a scan that only knows about Octokit
   passes vacuously for a second client, which is precisely the failure its own vacuity guards were built
   to catch.
3. **`SIGNAL-NO-SIXTH-SANITIZER` is real, scoped, and easy to break.**
   `lib/signals/no-sixth-sanitizer.test.ts` records that **five** weak local `sanitizeDataField` copies
   already exist (`brief.ts:13`, `rubric.ts:9`, `post-generation.ts:7`, `post-regeneration.ts:8`,
   `formats/native-generation-prompt.ts:9`) as *"documented accepted debt (ADR 0018 §15), not a pattern to
   extend."* Track G routes ingested text through the existing `wrapSignalForPrompt`. **A sixth copy for
   "news-shaped text" breaks a standing constraint** — if the existing wrapper is genuinely wrong for this
   content, that is an ADR 0020 §7 amendment, flagged, not a quiet new function.
4. **Stage B is deterministic by ruling** — ADR 0020 L-6 / §6.5 / D-5: no pgvector, no embeddings, no LLM
   anywhere in Stage B, proven by `SIGNAL-SCORING-DETERMINISTIC`, `SIGNAL-DEDUP-STABLE-ON-EDIT` and the
   Tier-3 `SIGNAL-NO-EMBEDDINGS` (*"no pgvector extension, no embedding call in the diff"*). §6.5's
   revival condition is **a second, unstructured source**.
5. **The scorer is tuned for releases.** ADR 0020 §6 scores with `weight` constant at 10 in v1 (§6.1,
   per-repo tuning deferred). Whether that scoring function is meaningful for a news item — or whether a
   second source needs its own scoring with its own arithmetic — is an open design question, **not an
   inherited answer**.
6. **The triage shortlist is 5 and the wall clock is 45 s** (ADR 0021 §2.4 / §3.1.1, founder ruling E-2:
   `TRIAGE_MAX_WALL_CLOCK_MS = 45000`, shortlist stays at 5, and **the worker holds a deadline**,
   re-checking remaining wall-clock before claiming each candidate). `5 × 45 s = 225 s` against a 300 s
   worker budget. **A second source competing for the same five slots is a starvation problem**: if news
   candidates outscore releases (or vice versa) one source silently stops producing cards. The ADR must
   say which source wins, and why, or state the allocation rule.
7. **The cost ceiling is a reservation ledger, not an aggregate** — `signal_triage_budget
   (business_id, day)`, reserved **before** the call in one guarded upsert (`[db-BLOCKER-1]`, ADR 0021
   §3.2/§3.3). Doubling candidate volume against a fixed daily cap means the cap binds sooner. Whether
   that is correct behaviour or a starvation bug is a decision, not an implementation detail.
8. **Third-party personal data was ruled on for GitHub, not for news.** ADR 0020 §9 (Q7, L-9, L-12)
   settled retention and erasure for release-author data. **A news article is a different problem**: named
   journalists, quoted individuals, photo credits, and content under copyright rather than a permissive
   repo licence. **ADR 0023 does not inherit §9's ruling — it makes its own**, and says explicitly which
   parts of §9 carry over and which do not.
9. **The plan-gating seam is one function.** `SIGNAL-GATING-SEAM-NAMED` was corrected at E2.11 from
   "3 (diff)" to "2" — *"`connectGithubAction` exists and is the single named seam, with an executed test
   asserting it"* (`app/[locale]/(dashboard)/settings/signals/actions.test.ts`'s "the L-8 gating seam"
   describe block). A second source either **uses that seam** or **creates a second one**. Creating a
   second one silently is how a named seam stops being a seam.
10. **`settings/signals/` is the shipped configuration surface** and the precedent Track G's UI extends —
    not a new design. Whatever a "watched competitor / feed" is, it is configured there, in the shape a
    watched repo already is.
11. **The eval harness's corpus is versioned and its result is a number a reviewer can cite** (ADR 0015
    Amendment B(c), the Session 26-D H3 precedent). Today: `corpusVersion=1`, `executed=40/40`. **If Track
    G changes what triage sees, the corpus must change with it** — a corpus that contains no news
    cassettes cannot evaluate news triage, and a green harness over a stale corpus is a FALSE-GREEN
    wearing a number.
12. **Track F is closed and does not overlap.** No change to `lib/ai/prompts/formats/`, to promote, or to
    `campaigns.origin` in this session. If a step appears to need one, that is an ADR 0022 amendment and it
    is **flagged, not made**.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-08-21)

These are decided. The Architect (G1a) **encodes** them in ADR 0023 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**, exactly as an ADR
contradicting CLAUDE.md would.

**Locked (L):**

- **L-1 — Session 30 ships ONE new signal source and nothing else.** *In scope:* the source's client
  behind the `/lib/signals/` boundary; its schema (new kind, new table or new source dimension — Q2
  decides); its ingestion worker; its scoring and dedup; its configuration surface in `settings/signals/`;
  its GDPR and retention ruling; the eval-corpus extension that makes its triage reviewable; and the four
  deferral rulings named in the goal block. *Out of scope, explicitly:* **a third source**; **evergreen-
  strategic opportunity types**; **webhook ingestion** (ADR 0020 L-3 — still deferred, the schema seam
  exists and stays unused); **additional GitHub signal kinds** (tags, merged PRs, commits — commits remain
  deferred **on privacy grounds**, and ADR 0020 §14 requires that rationale be *re-argued, not merely
  revisited*, before they land); **any change to Stage C's loop bounds, tool inventory or card schema**;
  **any change to Track F's work**; and **image generation**. If a step appears to need any of these,
  **STOP and report.**

- **L-2 — The four deferrals are RULED ON, each on its own condition, in this ADR.** Embeddings
  (§0.1 Q3), clustering (Q3), the triage-scaling constraint (Q1 — **already ruled by the founder at
  L-11**; the ADR encodes it and supplies its numbers), and plan gating (Q7). **Each is answered against
  the condition its own ADR recorded** — not against a general sense that the product has matured. An ADR
  that revives clustering because it revived embeddings, or that treats "the harness is green" as "the
  harness has proven itself," has failed this Locked decision.

- **L-3 — The feed still proposes and never posts, and every gate stays.** CLAUDE.md's human-in-the-loop
  rule and ADR 0021 L-2 are unchanged by a second source. A market-responsive card passes the same three
  human gates a company-originated one does. **There is no configuration, flag, plan tier or "power user"
  setting that skips any of them**, and no argument from timeliness ("news is time-sensitive") may be used
  to introduce one. State this as a named constraint with a test.

- **L-4 — Ingested text from this source is attacker-AUTHORED, and the ADR treats it that way.** ADR 0020
  §7's guarantees are the **floor**: every ingested field `[DATA]`-wrapped through the **existing**
  `wrapSignalForPrompt`, no sixth sanitizer (Reality §3), tool results treated as untrusted, no tool
  mutating state. **On top of that**, the ADR states what is new: the customer did not choose this
  publisher the way they chose a repo; volume is attacker-controllable; and a worst-case walkthrough is
  written out in full — *"an article whose body is an instruction to the model — what actually happens?"*
  If the honest answer is *"the model might emit a card that looks legitimate,"* the design changes before
  the ADR is Accepted.

- **L-5 — The new client lives behind `/lib/signals/` and the source scans are EXTENDED, with their
  vacuity guards intact.** No code outside `/lib/signals/` imports the new client. `source-scans.test.ts`
  gains the new pattern **and** a per-root vacuity guard for it, and — following ADR 0020 §11.3's own
  discipline — **each new scan is demonstrated to redden** against a deliberately introduced violation
  before being reverted, with the transcript in the commit message. A scan that has never been seen to
  fail is not evidence.

- **L-6 — The eval corpus grows with the source, or the source does not ship.** The brainstorm's standing
  constraint (goal block, item 3) is about triage quality under a *new* input distribution. Extending the
  source without extending the corpus produces a green harness that has evaluated nothing relevant —
  a FALSE-GREEN with a number attached, which is worse than no number. The ADR states: how many new
  cassettes, where their labels come from, and how `corpusVersion` increments. **Per-source threshold
  reporting is no longer an open question — L-11 makes it mandatory.**

- **L-7 — Legal and ToS are a first-class section, not a footnote.** The ADR names the source's terms,
  whether ingestion is licensed / API-permitted / robots-permitted, what is stored versus fetched on
  demand, and what a card may **quote** versus **summarize**. Copyright is a real constraint on a product
  that renders third-party text to paying customers, and `content/legal/*.mdx` is locked against the
  Evidence Pack — if anything here touches a customer-facing legal claim, that is an Evidence Pack
  question and it is **flagged**, per CLAUDE.md's legal-pages rule.

- **L-8 — GDPR, tenancy and RLS in full, with an INDEPENDENT personal-data ruling.** Every new
  business-scoped table: RLS in the InitPlan-wrapped
  `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and** `WITH CHECK` on every
  UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2 §D2.5's cascade table**,
  and `purge_business` coverage. **And the §9 question is answered fresh** (Reality §8) — named
  journalists and quoted individuals are not release authors, and the ADR states which parts of ADR 0020
  §9 carry over and which do not, rather than inheriting silently.

- **L-9 — Failure isolation and idempotency are contract, per ADR 0020 L-11.** One failing source, feed or
  publisher must not stop the others; the ingestion transition is an **atomic conditional UPDATE**, never
  read-then-update; re-ingesting the same item is a no-op, and an **edited** item behaves per
  `SIGNAL-DEDUP-STABLE-ON-EDIT` (and, if it is already in flight, per ADR 0021 A-4′: *terminal states
  refuse; non-terminal states restart*). A background worker whose only output is one structured log line
  is the silent-failure shape ADR 0020 L-11 forbids — say what is observable.

- **L-10 — Contract discipline + constitution rules, inherited by every step.** Additive migration with an
  explicit stated backfill; **Zod** on every Server Action and route input; every list query **bounded +
  explicit `ORDER BY`** matching an index; **date-fns** (`toUtcIso()`, never raw `.toISOString()`); **no
  `any`**; **no `console.*`** except the single canonical structured tick line the worker carve-out
  permits; env only via `lib/config.ts`; Anthropic SDK only via `lib/ai/`; DB only via `lib/db/` +
  `lib/memory/`; service-role never in a user-facing read path; **i18n en/pt/es simultaneously**; shadcn v4
  / Base UI with **no `asChild`** on `Button` or `DropdownMenu` primitives; and **SHARED-FUNCTION CALLERS**
  for every existing function this session touches — enumerate every caller, state which test covers each.

- **L-11 — The bootstrap ceiling does NOT satisfy the triage-scaling constraint (founder ruling,
  2026-08-21). Track G ships anyway, with three mitigations, and graduates on real labels.** The
  brainstorm's constraint is about triage quality under a **new input distribution**. A corpus whose
  prompt, cassettes and labels share a single author measures **self-consistency**, not judgment quality —
  and a suite that has never been observed to fail has not been shown *capable* of failing. A 1.000 across
  every metric is weak evidence about the triage and strong evidence about the corpus. **The ruling is
  "not satisfied" — and it binds the ALLOCATION, not the source.** Three mitigations are Locked:

  1. **The corpus is demonstrated discriminative.** This repo already holds exactly this standard for
     source scans — ADR 0020 §11.3 requires each to be *demonstrated to redden* against a deliberately
     introduced violation, with transcripts in the commit message. It was simply never applied to the
     eval corpus. **The harness must be shown to redden against a deliberately degraded triage prompt**,
     transcript recorded. If it still scores 1.000 against a sabotaged prompt, the corpus measures nothing
     and **its number may not be cited as evidence again** — not in this ADR and not in a later one.
  2. **Thresholds are reported PER SOURCE, never as a mixed aggregate.** Forty good GitHub cassettes will
     comfortably mask ten bad news ones, and an aggregate is precisely the shape that hides it.
  3. **The new source ships with a MINORITY shortlist allocation** — it may not take the majority of Stage
     C's five slots — so a triage regression on the new distribution cannot starve the source that already
     works. The number is the Architect's (Q4), stated with its arithmetic.

  **The graduation condition is a count of REAL production dismissal labels, not more hand-authored
  cassettes.** ADR 0021 L-7 built the structured dismissal-reason enum for exactly this purpose — its own
  stated rationale is that it is *"the only source of ground-truth labels the eval harness can get."*
  Authoring more cassettes yourself reproduces the ceiling at a larger size, which is the trap the current
  number already represents. The Architect states the label count and the arithmetic behind it.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | Session split | **Its own ADR 0023 and its own session, separate from ADR 0022** | folding it into ADR 0022 — buries a ruling that retires a Tier-3 constraint inside a document about promote buttons and discriminated unions |
| D-2 | Number of new sources | **exactly one** | two or more at once (each doubles the untrusted-input surface and the triage volume before either has been observed under real traffic) |
| D-3 | The four deferrals | **each ruled on against ITS OWN recorded condition** | ruling on them as a group (clustering's condition — "a second signal kind belonging to one release" — is genuinely not met by a news source, and grouping hides that) |
| D-4 | Sanitization | **the existing `wrapSignalForPrompt`, no sixth copy** | a news-specific sanitizer (breaks `SIGNAL-NO-SIXTH-SANITIZER`; if the wrapper is wrong, that is an ADR 0020 §7 amendment, flagged) |
| D-5 | Eval corpus | **extended with this source's cassettes, versioned, before the source is considered shipped** | shipping the source against the existing corpus (a green harness that has evaluated nothing relevant — a FALSE-GREEN with a number attached) |
| D-6 | Personal-data ruling | **made fresh for this source** | inheriting ADR 0020 §9 (release authors and quoted journalists are not the same data subject problem) |
| D-7 | Source scans | **extended, with per-root vacuity guards, each demonstrated to redden** | extending the pattern list without a vacuity guard (passes vacuously for the new root — the exact FALSE-GREEN ADR 0020 §11.3 built its guards against) |
| D-8 | The triage-scaling constraint | **ruled NOT satisfied; ship with a demonstrated-discriminative corpus, per-source thresholds and a minority shortlist allocation; graduate on real dismissal labels** | treating the 1.000 bootstrap ceiling as sufficient (it measures self-consistency, and a suite never seen to fail has not been shown able to fail); **blocking Track G outright** (the constraint is about allocation risk, and a bounded allocation carries it); growing the corpus with more self-authored cassettes (reproduces the ceiling at a larger size — the trap, not the fix) |

---

## §0.1 — Questions the Architect (G1a) must resolve IN the ADR (BINDING)

**G1a's ADR must decide each one explicitly, name the loser, and tier the resulting constraint.** The
Builder consumes these answers as binding. Ground every answer in the real seams — let the single
`ecc:code-explorer` sweep map them and cite `file:line` rather than remembering.

- **Q1 — Encode L-11, and supply its four numbers (the load-bearing question, L-2, L-6).** **Whether** the
  bootstrap ceiling satisfies the constraint is **ruled** (L-11: it does not). Do not re-litigate it —
  encode it, with the reasoning, so a reader sees why a 1.000 was treated as a weakness rather than a
  result. Then decide the four numbers L-11 leaves open, each with arithmetic:

  1. **The degraded-prompt sabotage** — what "deliberately degraded" concretely means for the triage
     prompt (a removed instruction? an inverted rubric dimension?), and what score would count as the
     harness *reddening*. State the transcript requirement.
  2. **The minority allocation** — how many of Stage C's five slots the new source may take, and what
     enforces it (Q4 owns the mechanism; Q1 owns the ceiling).
  3. **The graduation label count** — how many real production dismissal labels (ADR 0021 L-7's enum)
     before the allocation cap lifts, and the arithmetic for why that count is enough to be evidence.
  4. **The per-source thresholds** — the literal numbers per source, and what a RED means for each.

  **And state the consequence honestly:** until graduation, `SIGNAL3-TRIAGE-QUALITY` is MEASURED for the
  new source at a *lower confidence* than for the old one, and `docs/current-phase.md` must say so in
  those words rather than reporting one blended number. Write this section first; it gates the rest.

- **Q2 — What a market-responsive signal IS, concretely, and where it lives in the schema.** Name **one**
  source with a real API, a real rate limit, a real auth story and a real SSRF surface — the discipline ADR
  0020 applied to the GitHub App. Then: is this a new `signals.kind` on the existing table, a new
  dimension (`source`) alongside `kind`, or a new table? Argue it against ADR 0020 §3's four-table shape
  and against the `signal_candidates` contract at §13.1 that Stage C reads **and that this session must
  not silently change** (if it must change, that is an ADR 0020/0021 amendment, flagged). State the
  ingestion cadence, the bound on items per tick, and the dedup key.

- **Q3 — Embeddings and clustering: rule on each, separately (L-2, D-3).** **Embeddings** — ADR 0020 §6.5's
  condition (*a second, unstructured source*) is met by this session. Decide un-defer or re-affirm.
  If re-affirming, state the reason in §6.5's own terms — the original argument was cost-and-complexity
  per candidate, not an absence of sources — and give the re-affirmation a **new, sharper revival
  condition** (a measured dedup miss-rate on live multi-source traffic beats a source count). If
  un-deferring, state that `SIGNAL-NO-EMBEDDINGS` (Tier 3) is **retired**, per ADR 0015 §2's requirement
  that a Tier-3 decision be recorded, plus the pgvector migration, the embedding call site, the per-
  candidate cost, and how it survives Stage B's *no LLM* rule. **Clustering** — ADR 0020 §14's condition is
  *"a second signal kind belonging to one release,"* which a news source does **not** satisfy. Say so
  explicitly and leave it deferred, so a future reader does not read Q3's embeddings answer as covering
  both.

- **Q4 — Scoring, dedup and the shortlist starvation problem (Reality §5, §6, §7).** Does ADR 0020 §6's
  deterministic scorer generalize to this source, or does it need its own function with its own arithmetic?
  How are two sources' scores made **comparable** — because they are ranked into one shortlist of five.
  Then the allocation rule: with two sources competing for five slots and a 45 s per-candidate wall clock
  under a 300 s worker budget, **which source wins, and what stops the loser from silently producing
  nothing?** **L-11 constrains this answer: the new source takes a MINORITY of the five slots, so pure
  score order is no longer available** — it would let a high-scoring news flood take all five. Choose the
  mechanism that enforces the cap (per-source quota, round-robin with a cap, or score order *within* a
  reserved split) and state what happens to the slots when one source has nothing to offer — a cap that
  wastes a slot on an empty source is its own bug. And state the effect on `signal_triage_budget`'s daily
  cap:
  doubled volume means the cap binds sooner, so say whether that is correct or a bug.

- **Q5 — Prompt injection, end to end, for attacker-AUTHORED text (L-4).** Every ingested field through the
  **existing** `wrapSignalForPrompt` (no sixth sanitizer, Reality §3, D-4). Tool results treated as
  untrusted. Confirmation no tool mutates state. The render-side escaping posture. **And the worst-case
  walkthrough written out in full**: an article whose body instructs the model, traced stage by stage,
  with the point where it dies named. Plus the two things that are new versus ADR 0020 and must be
  addressed on their own: the customer did not vet the publisher, and **volume is attacker-controllable**
  (publish 500 articles and the shortlist is yours) — say what bounds that.

- **Q6 — GDPR, retention, erasure and copyright (L-7, L-8, D-6).** Which parts of ADR 0020 §9 carry over
  and which do not, stated item by item. What personal data a news item contains, and the lawful basis for
  holding it. Retention period and the reaper question (ADR 0020 A-3 deferred a reaper with a **binding
  no-customer-facing-claim condition** at §9.5 — say whether that condition still holds). What a card may
  **quote** versus **summarize**, and the ToS/licensing position of the chosen source. Anything touching a
  customer-facing legal claim is an Evidence Pack question — **flag it, do not write it.**

- **Q7 — Plan gating and the configuration surface (L-8's seam, Reality §9, §10).** `connectGithubAction`
  is the single named gating seam and `SIGNAL-GATING-SEAM-NAMED` has an executed test asserting it. Does
  this source use that seam, extend it, or need a second? **If a second, say why one seam cannot serve
  both, because a "single named seam" that becomes two named seams has quietly stopped being the thing the
  constraint asserts.** Then the config surface in `settings/signals/`: what a watched competitor or feed
  is, its bounds (how many per business), its validation (Zod, and the SSRF surface of a
  user-supplied URL — this is sharper than a repo name), and its i18n keys in en/pt/es.

- **Q8 — Test plan across the tiers, plus the corpus (L-5, L-6, D-5, D-7).** **Tier 1** (live Postgres) for
  the new table/column's RLS, cascade, `purge_business`, the atomic ingestion transition under concurrency,
  and the dedup-on-edit behaviour. **Tier 2** (vitest) for the client behind the boundary, the scoring
  function, the shortlist allocation rule, the injection guards, the SSRF validation, and the Server
  Action's Zod contract. **Tier 3** enumerated **as such**. **The extended source scans** with their
  per-root vacuity guards, each demonstrated to redden (D-7). **And Tier E**: how many cassettes, their
  labels' provenance, the `corpusVersion` bump, **the per-source thresholds (L-11 settles that they are
  per-source, not global — Q8 supplies the numbers)**, and **the corpus's own redden demonstration against
  a degraded triage prompt**, recorded like a source scan's. Plus an explicit statement of **which
  constraints the harness does NOT cover**, so a green harness is never read as blanket coverage. Name the
  fixture directories. State what is honestly untestable and why.

Where a G1a answer and this build-guide disagree, **the ADR wins once written** — but G1a must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **PLACEHOLDER — written after §1 runs, before the Builder starts.**
>
> **Q1's substance is already ruled** (§0 L-11, 2026-08-21) and is not an escalation — the Architect
> encodes it and supplies its four numbers. The likeliest escalations are now **Q3** (retiring the Tier-3
> `SIGNAL-NO-EMBEDDINGS`), **Q6's copyright/ToS position** if the chosen source's terms are anything other
> than clearly permissive, and **Q1's numbers** if the Architect argues the minority cap makes the source
> too weak to be worth shipping — which is a product call, not a technical one.
>
> Recorded here as a `## §0.2 — Founder adjudications (YYYY-MM-DD)` block **before** §2 is authored, in the
> table form Sessions 22–28 used: `| # | Question | Decision | Where encoded |`, with `A-n` ids, and with
> the Architect's original recommendation preserved rather than rewritten where a ruling went against it.
>
> **This section is the Builder's gate.** G1b does not start until it exists or is explicitly recorded as
> "no adjudications required."

---

## §1 — Architect session (G1a)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **one document and no code**:
`docs/decisions/0023-market-responsive-signal-source.md` (Accepted), **plus** whichever amendments its own
rulings require — at minimum an amendment note on ADR 0020 §6.5 recording the embeddings ruling either way
(Q3), and on §14 recording that clustering's condition is **not** met. No `.ts`, no `.sql`, no `.tsx`. Any
code attempted here is discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list, then **exactly three** advisory reviewers dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation.

**Skills are free and do not count against the budget** — `ecc:architecture-decision-records` for
structure, `claude-mem`'s `mem-search` for prior-session context (**prefer one `mem-search` over re-reading
a closed session's build guide**), and **`ecc:cost-aware-llm-pipeline` for Q4's arithmetic**. ⚠️ **Note,
carried forward from Session 28's own correction:** `cost-aware-llm-pipeline` is a **skill** in this
install, not an agent — Session 28's guide listed it among its four "advisory reviewers" and the phase was
not executable as written. Do not repeat that; invoke it as a skill.

**`impeccable` and `taste-skill` are NOT invoked in this phase.** Track G's only surface is an extension of
the shipped `settings/signals/` configuration page — the Architect **specifies** its contract (Q7) and the
Builder builds it, invoking `taste-skill` for the build and `impeccable` for the review pass against that
contract. There is no new design language here and no reason to open one.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 30 — Mode 3's second signal source: market-responsive ingestion. ARCHITECT phase (Track G). You
produce ONE ADR and NO code:
  docs/decisions/0023-market-responsive-signal-source.md (status: Accepted)
plus the amendment notes your own rulings require on docs/decisions/0020-mode-3-signal-ingestion.md
(§6.5 embeddings — either way; §14 clustering — recording that ITS condition is not met).
No .ts, no .sql, no .tsx. If you catch yourself writing a migration, a zod schema body, a client wrapper or
a component, stop: that is the Builder's job (G1b), and the constitution requires Architect-attempted code
to be discarded.

PREREQUISITES — verify before anything else, in this order.
1. Session 29 (ADR 0022, Track F) has CLOSED — Builder, Reviewer and correction pass — and its work is
   green on master. If it has not, STOP and say so.
2. ADRs 0020 and 0021 are Accepted and Sessions 27 and 28 have closed. You consume the signal_candidates
   contract ADR 0020 §13.1 states and the Stage C loop ADR 0021 §2 defines. If either is missing, STOP —
   do not invent the contract.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. Ask it for file:line citations and
   the shape of each seam — nothing else.
2. Skills are free: use ecc:architecture-decision-records for structure so 0023 matches 0016-0022; use
   claude-mem's mem-search for prior-session context; and use ecc:cost-aware-llm-pipeline for Q4's
   arithmetic. NOTE: cost-aware-llm-pipeline is a SKILL in this install, not an agent — Session 28's guide
   listed it as an agent and its phase was not executable as written. Do not repeat that error.
3. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - security-reviewer — the primary pass this session. On Q5 and Q7: ATTACKER-AUTHORED text reaching a
     TOOL-USING model. Unlike ADR 0020's GitHub releases (attacker-INFLUENCEABLE, from an app the customer
     installed, about a repo the customer chose), this content is authored by parties the customer never
     vetted, at a volume the attacker controls. Ask specifically: whether the EXISTING wrapSignalForPrompt
     is sufficient for this content or whether ADR 0020 §7 needs amending (a sixth sanitizer is NOT an
     option — SIGNAL-NO-SIXTH-SANITIZER); whether tool results are treated as untrusted; whether any tool
     can mutate state; the SSRF surface of a USER-SUPPLIED feed URL (sharper than a repo name); what
     bounds an attacker publishing 500 items to own the shortlist; and the worst-case walkthrough of an
     article whose body instructs the model.
   - database-reviewer — on Q2 and Q4: whether this belongs as a new signals.kind, a new source dimension,
     or a new table, argued against ADR 0020 §3's four-table shape and §13.1's signal_candidates contract
     that Stage C reads; the atomic ingestion transition and dedup-on-edit under concurrency; the index
     behind any new bounded+ORDER BY query; the full RLS / §D2.5-cascade / purge_business obligation; and
     the retention/reaper question ADR 0020 A-3 deferred with a binding no-customer-facing-claim condition
     at §9.5.
   - ecc:pr-test-analyzer — on Q1 and Q8 ONLY. NOTE: the founder has ALREADY ruled that the bootstrap
     ceiling does not satisfy the triage-scaling constraint (§0 L-11), so do NOT ask this agent whether it
     does. Ask it to pressure-test the MITIGATION: (a) is "demonstrated to redden against a deliberately
     degraded triage prompt" a real test of corpus discriminative power, or can a corpus pass that and
     still be uninformative — and what degradation would be the honest one to apply? (b) what count of
     real production dismissal labels (ADR 0021 L-7's enum) would actually constitute evidence about a new
     input distribution, and how should selection bias be handled given that a dismissal label only exists
     for cards a human bothered to dismiss? (c) do per-source thresholds introduce their own problem at
     small n — a 10-cassette news slice is noisy, and a noisy required gate is worse than no gate (ADR
     0015 Amendment B's own standard). Ask for numbers and failure modes, not principles.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke impeccable or taste-skill — you SPECIFY the settings-surface contract (Q7); the Builder
builds it and runs those skills against your contract.

Read now, before anything else:
- docs/build-guide/session-30.md — the Reality block, §0 (Locked L-1..L-10 + the D-1..D-7 ledger) and §0.1
  (the eight questions Q1..Q8 you MUST resolve). This is your binding input.
- docs/decisions/0020-mode-3-signal-ingestion.md — ALL of it. Especially §6.5 VERBATIM (the embeddings
  rejection AND its revival condition), §14 VERBATIM (the deferred list, and note that clustering's
  condition is DIFFERENT from embeddings' — "a second signal kind belonging to one release"), §7 (untrusted
  ingested text), §9 (third-party personal data — which you do NOT inherit wholesale), §13.1 (the
  signal_candidates contract Stage C reads), §8.6 (the L-8 plan-gating seam), and §11.3 (the four source
  scans and their per-root vacuity guards).
- docs/decisions/0021-mode-3-triage-and-opportunity-feed.md — §2.4/§3.1.1 (the bounds, the 45 s wall clock,
  the shortlist of 5, the worker deadline), §3.2/§3.3 (the reservation-ledger cost ceiling), §10.4
  (SIGNAL3-TRIAGE-QUALITY, Tier E), and §15 (the bootstrap-ceiling framing you must NOT overstate).
- docs/decisions/0015-test-execution-and-ci-gates.md — §2 (the three tiers plus Amendment B's Tier E, which
  you tier constraints against; note that retiring a Tier-3 constraint must be a RECORDED decision) and §5.
- docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md §2 (the three opportunity
  types — market-responsive is the one you are building) and docs/brainstorm/campaign-modes-architecture-
  and-build-plan.md §2 Phase D, INCLUDING the sentence that triage "should not be scaled to multiple signal
  sources until that harness exists" — that is Q1's binding text; quote it.
- CLAUDE.md — the signal-source-layer rule (no code outside /lib/signals/ imports a signal client), the
  AI-layer / DB-access / three-client / RLS + erasure-cascade / atomic-transition / Zod / i18n /
  bounded-query rules, "we don't auto-publish without user approval", the legal-pages rule (Evidence Pack
  drift is a counsel-grade failure mode), and the test-execution-integrity section.

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/signals/index.ts, github-client.ts, orchestrator.ts, score.ts, parse-release.ts, state.ts — the
  shape a second source must fit, and WHICH of these are source-specific vs source-generic. Report that
  split honestly; it decides Q2.
- lib/signals/source-scans.test.ts and lib/signals/no-sixth-sanitizer.test.ts — the four scans, their
  per-root vacuity guards, and the five documented weak sanitizer copies. Report the EXACT pattern each
  scan matches, because L-5 requires extending them without breaking their guards.
- lib/signals/token-boundary.test.ts and wherever wrapSignalForPrompt is defined — the [DATA] wrap Q5
  reuses. Report its exact signature and what it does NOT protect against.
- The four ADR 0020 migrations — every table, column, constraint, index and RLS policy. Report
  signals.kind's CHECK values verbatim.
- lib/db/signal-candidates.ts — listNewCandidates and the §13.1 join list, including the is_prerelease
  join and the documented tag_name gap.
- lib/signals/triage/** and lib/ai/tool-runner.ts — the loop's bounds as literal constants, the shortlist
  of 5, and the worker deadline. You are NOT changing these; you are reporting what a second source's
  volume does to them.
- Wherever signal_triage_budget is read and reserved — Q4's cap-binds-sooner question.
- app/[locale]/(dashboard)/settings/signals/** including actions.test.ts's "the L-8 gating seam" describe
  block — Q7's seam and the config surface you extend.
- The eval harness: its corpus fixtures, its runner, and the workflow that reports eval-reported /
  eval-threshold. Report corpusVersion's current value and how a bump is expressed.

Do NOT write the ADR yet. First OUTPUT your answers to the eight §0.1 questions (Q1 encode L-11's ruling
and supply its FOUR NUMBERS — WRITE THIS ONE FIRST, it gates the session, and do NOT re-argue whether the
bootstrap ceiling suffices; Q2 what a market-responsive signal is and where it lives; Q3 embeddings and
clustering ruled on SEPARATELY; Q4 scoring, comparability and the shortlist allocation UNDER L-11's
minority cap; Q5 injection for attacker-authored text; Q6 GDPR/retention/copyright; Q7 plan gating and the
config surface; Q8 the test plan plus the corpus), EACH with its named loser and its ADR 0015 tier, AND a
one-line note on any place a §0 Locked decision constrains the answer. Flag explicitly if any answer needs
a founder ruling — Q3 is the likeliest, Q6's copyright position a possible second, and Q1's numbers a
third IF you conclude the minority cap makes the source too weak to be worth shipping (a product call, not
yours) — or a new dependency, a new user_can capability, a change to ADR 0020's schema, or a change to ADR
0021's loop. Those are founder adjudications, not your call. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 30. Write the ADR and its amendment notes. Ground every claim in the real repo (cite
file:line from the ecc:code-explorer sweep). You have already dispatched your ONE batch of three advisory
reviewers — fold their objections in now, or record why you rejected them. Do not re-consult them.

=== docs/decisions/0023-market-responsive-signal-source.md (Accepted) ===

1. Context + decision summary: Mode 3 ships one source and one signal kind; the intelligence doc names
   three opportunity types; this ADR builds the second. State up front that FOUR separate deferrals come
   due here (embeddings §6.5, clustering §14, the triage-scaling constraint, plan gating L-8), that each
   has a DIFFERENT recorded condition, and that each is ruled on against its own. Name the losers per §0
   D-1..D-7.

2. Q1 FIRST, as its own section, because it gates everything. Quote the brainstorm's constraint verbatim.
   State the harness's actual result AND its bootstrap-ceiling framing without softening either. Then
   ENCODE the founder's ruling (§0 L-11): the ceiling does NOT satisfy the constraint, because a corpus
   whose prompt, cassettes and labels share one author measures self-consistency, and a suite never
   observed to fail has not been shown able to fail — so a 1.000 is evidence about the CORPUS, not the
   triage. Then give the four numbers: the degraded-prompt sabotage and what counts as reddening; the
   minority slot cap; the graduation count of real ADR 0021 L-7 dismissal labels with its arithmetic; and
   the per-source thresholds. State the honest consequence: until graduation, SIGNAL3-TRIAGE-QUALITY is
   MEASURED at LOWER CONFIDENCE for the new source than the old, and current-phase.md says that in those
   words rather than publishing one blended number. Note the precedent you are applying — ADR 0020 §11.3
   already requires every source scan to be demonstrated to redden; this extends the same standard to the
   eval corpus, which it was never applied to. Fold in ecc:pr-test-analyzer's pressure-test, including its
   answer on small-n noise in per-source thresholds.

3. The source (Q2): the named source, its API, rate limits, auth, and SSRF surface — with ADR 0020's
   GitHub-App discipline applied. The schema decision (new kind / new source dimension / new table) argued
   against §3's four-table shape and §13.1's contract, with an EXPLICIT statement of whether
   signal_candidates' contract changes (if it does, that is an ADR 0020/0021 amendment — flag it, do not
   make it). Ingestion cadence, per-tick bound, dedup key. Fold in database-reviewer.

4. Q3 as TWO sub-sections, never one: (a) EMBEDDINGS — §6.5's condition is met by this session; rule
   un-defer or re-affirm; if re-affirming, argue it in §6.5's own terms and give a NEW sharper revival
   condition; if un-deferring, state explicitly that the Tier-3 SIGNAL-NO-EMBEDDINGS is RETIRED (a recorded
   decision per ADR 0015 §2), plus the pgvector migration, the call site, the per-candidate cost, and how
   it survives Stage B's no-LLM rule. (b) CLUSTERING — §14's condition is "a second signal kind belonging
   to one release," which this source does NOT satisfy. Say so and leave it deferred.

5. Scoring, comparability and starvation (Q4): does §6's scorer generalize or does this source need its
   own; how two sources' scores are made comparable when they rank into ONE shortlist of five; the
   allocation rule (round-robin / per-source quota / pure score order with starvation named and accepted);
   and the effect on signal_triage_budget's daily cap. Fold in the cost skill's arithmetic — numbers, not
   principles.

6. Prompt injection end to end (Q5, L-4) — the section security-reviewer will be read hardest against.
   Per-field [DATA]-wrap through the EXISTING wrapSignalForPrompt (no sixth sanitizer — cite
   SIGNAL-NO-SIXTH-SANITIZER and the five documented copies); tool results untrusted; no tool mutates
   state; render-side posture; the SSRF validation of a user-supplied URL; what bounds an attacker who
   publishes 500 items; and the WORST-CASE WALKTHROUGH written out in full, with the point where it dies
   named. If it does not die, change the design before accepting this ADR.

7. GDPR, retention, erasure, copyright and ToS (Q6, L-7, L-8): which parts of ADR 0020 §9 carry over and
   which do not, ITEM BY ITEM; the personal data a news item carries and the lawful basis; retention and
   the reaper (with ADR 0020 A-3's binding no-customer-facing-claim condition at §9.5 re-checked); what a
   card may QUOTE vs SUMMARIZE; the source's ToS/licensing position. Full L-8 obligation: RLS in the
   InitPlan-wrapped form with USING and WITH CHECK on UPDATE, ON DELETE CASCADE, the ADR 0010 Amd 2 §D2.5
   cascade row VERBATIM, purge_business coverage. Anything touching a customer-facing legal claim is an
   Evidence Pack question — FLAG it, do not write it.

8. Plan gating and the config surface (Q7): does this use connectGithubAction's seam, extend it, or need a
   second — and if a second, why one cannot serve both, given that SIGNAL-GATING-SEAM-NAMED asserts a
   SINGLE named seam. Then the settings/signals/ extension you SPECIFY (you do not design it): what a
   watched competitor/feed is, its per-business bound, its Zod validation including the SSRF surface, every
   state, the accessibility floor, Server Component + Client split, shadcn v4 / Base UI with NO asChild on
   Button or DropdownMenu primitives, Tailwind only, i18n en/pt/es simultaneously, and status colour on
   globals.css tokens with a both-themes contrast assertion (the OpportunityFeed precedent, Session 28-D
   D5). Note that the Builder runs taste-skill and impeccable against THIS contract.

9. Failure isolation and idempotency (L-9): one failing feed must not stop the others; the atomic
   conditional ingestion transition; re-ingest is a no-op; edited items per SIGNAL-DEDUP-STABLE-ON-EDIT
   and, if already in flight, per ADR 0021 A-4' (terminal states refuse; non-terminal states restart); and
   what is OBSERVABLE when a source fails — a worker whose only output is one structured log line is the
   silent-failure shape ADR 0020 L-11 forbids.

10. Test plan across the tiers plus the corpus (Q8): Tier 1 (live Postgres) for RLS, cascade,
    purge_business, the atomic ingestion transition under concurrency and dedup-on-edit; Tier 2 (vitest)
    for the client behind the boundary, scoring, the allocation rule, the injection guards, SSRF
    validation and the Zod contract; Tier 3 enumerated AS SUCH; the EXTENDED source scans with per-root
    vacuity guards, EACH demonstrated to redden with its transcript in the commit message; and Tier E —
    cassette count, label provenance, the corpusVersion bump, and global-vs-per-source thresholds. State
    explicitly which constraints the harness does NOT cover. Name the fixture directories. State what is
    honestly untestable and why.

11. A constraint table: every named constraint (SIGNAL-MR-*), its test tier, and the test that will prove
    it — the Reviewer's checklist. Cover at least: SIGNAL-MR-CLIENT-BOUNDED, SIGNAL-MR-SCANS-EXTENDED,
    SIGNAL-MR-NO-SIXTH-SANITIZER, SIGNAL-MR-INJECTION-GUARDED, SIGNAL-MR-SSRF-VALIDATED,
    SIGNAL-MR-INGEST-ATOMIC, SIGNAL-MR-DEDUP-STABLE, SIGNAL-MR-SHORTLIST-ALLOCATION,
    SIGNAL-MR-BUDGET-BOUNDED, SIGNAL-MR-RLS-ISOLATED, SIGNAL-MR-CASCADE-COMPLETE,
    SIGNAL-MR-NEVER-AUTONOMOUS, SIGNAL-MR-CORPUS-EXTENDED, and SIGNAL-MR-GATING-SEAM.

12. Explicit "deferred" section with revival conditions: a third source; evergreen-strategic opportunity
    types; webhook ingestion (ADR 0020 L-3, seam unused); additional GitHub kinds (commits still deferred
    ON PRIVACY GROUNDS, and §14 requires that rationale be RE-ARGUED, not merely revisited); clustering
    (its own condition, unmet); and — if Q3 re-affirmed — embeddings, under its NEW condition.

=== AMENDMENT NOTES on docs/decisions/0020-mode-3-signal-ingestion.md ===

Following the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form, append notes recording: (a) the §6.5
embeddings ruling, whichever way it went, with the date, this session, and the new revival condition if
re-affirmed; and (b) that §14's clustering condition was examined and is NOT met by a second source, so
clustering remains deferred. Append; do not rewrite §6.5 or §14 in place.

Do NOT write code. End with one line: "ADR 0023 written and accepted — <n> SIGNAL-MR-* constraints, source
<name>, schema <new kind|new dimension|new table>, embeddings <un-deferred|re-affirmed>, clustering
deferred, shortlist allocation <rule> capped at <n> of 5, corpusVersion <n> -> <n+1>, corpus redden-demo
<described>, graduation at <n> real dismissal labels." Then /exit.
```

**Gate:** do not author §2 until ADR 0023 is Accepted, the ADR 0020 amendment notes are appended, and the
eight §0.1 answers are on the record. **If any answer required founder adjudication — Q1 and Q3 are the
likeliest — that adjudication is recorded as the `§0.2 — Founder adjudications` block above before the
Builder starts.** Then author **§2 and §3** below from the accepted ADR's real `SIGNAL-MR-*` constraints.
**§4 stays a placeholder** until the Reviewer has run and its findings document exists.

---

## §2 — Builder session (G1b)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0023 is Accepted and the ADR 0020 amendment notes are appended.**
>
> Do not write this section speculatively. When the ADR is accepted, this section is filled in as:
>
> - **§2a — Builder primer** (paste first, wait for acknowledgement): role; the ECC budget for the Builder
>   phase; the binding §0 Locked list and the §0.2 adjudications; the ADR's constraint table as the
>   definition of done; the verification loop (`npx tsc --noEmit --skipLibCheck`, `npm run test:app`,
>   `npm run test:db`, plus the eval-harness entrypoint); and the commit discipline.
> - **§2b — Builder steps** `G1b.0 … G1b.n`, one paste each, each a self-contained
>   `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle, each ending green and committed.
> - **Ordering:** schema and the boundary-scan extension **first** — the scans must be able to catch a
>   violation before there is code to violate them. Then the client, ingestion, scoring, the config
>   surface, and **the eval-corpus extension last but BEFORE the source is considered shipped** (L-6, D-5).
>   Its whole justification is that a new input distribution cannot be reviewed without it.
> - **Design skills belong HERE, not in §1.** The `settings/signals/` extension is built with
>   **`taste-skill`** and reviewed with **`impeccable`**, both against the ADR §8 UX contract — not against
>   their own taste. No colour outside `globals.css` tokens; any new status band ships with a both-themes
>   contrast assertion reading the shipped token file.
> - Each step names **the ADR constraints it closes** and **the test that proves each**, per ADR 0015's
>   "covered = executed green in CI" rule. A step that closes no constraint should not exist.
> - **Three scope tripwires specific to this session**, written as executable scans rather than review
>   comments: a signal client imported outside `/lib/signals/**` breaks `SIGNAL-MR-CLIENT-BOUNDED`; a sixth
>   `sanitizeDataField` copy anywhere breaks `SIGNAL-MR-NO-SIXTH-SANITIZER`; and a source scan added
>   without its per-root vacuity guard breaks `SIGNAL-MR-SCANS-EXTENDED` (D-7) — **and every new scan is
>   demonstrated to redden before being reverted, with the transcript in the commit message**, per ADR
>   0020 §11.3's own discipline.

---

## §3 — Reviewer session (G1c)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0023 is Accepted, alongside §2.** The reviewer's checklist *is* the
> ADR's constraint table, so this section can be written before the Builder runs; only the commit range is
> filled in at run time, by the Reviewer itself.
>
> When filled in, this section follows the Sessions 26–28 form:
>
> - **§3a — Reviewer primer** (paste first, wait for acknowledgement) and **§3b — Reviewer prompt**.
> - **`PROC-REVIEW-AT-COMMIT` is absolute.** The report **opens by naming the exact commit range it read**
>   (e.g. *"Scope reviewed: `<base>..<head>`; all citations are `git show <sha>:<path>` at that range,
>   never HEAD."*). A report that does not name its range is not a valid review.
> - **Three things this reviewer checks that a normal review would not:** (1) that each extended source
>   scan **actually reddens** — the commit-message transcripts are claims, and a scan that has never failed
>   is not evidence; (2) that the eval corpus grew and `corpusVersion` bumped, and that the reported number
>   is **per-source** if the ADR required it, because a mixed aggregate can hide a per-source regression;
>   (3) that `signal_candidates`' §13.1 contract is genuinely unchanged, or that the change was flagged as
>   an ADR 0020/0021 amendment rather than made quietly.
> - **`SHARED-FUNCTION CALLERS`** for every existing signals function the new source touches — per caller,
>   which test file exercises it; a caller with no listed test is `AUTHORED-NOT-EXECUTED` **even if another
>   caller is fully covered**.
> - Findings are written to `docs/reviews/session-30-reviewer.md`, with severities (BLOCKER / MAJOR /
>   MINOR / NIT) and stable ids the correction pass cites.
> - The reviewer independently verifies that every constraint claimed COVERED is **executed green in CI at
>   the stated head** — not merely authored.

---

## §4 — Correction pass (Session 30-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after the Reviewer has actually run and
> `docs/reviews/session-30-reviewer.md` exists.** A correction pass is a response to findings; there is
> nothing to order, prioritise or resolve until they exist, and drafting it earlier produces a fictional
> resolution log.
>
> When filled in, this section follows the Sessions 26–28 form: a summary of what the reviewer found (with
> `docs/reviews/session-30-reviewer.md` named as authoritative), the ordering rationale, the correction
> primer, the numbered correction steps `D0…Dn`, a resolution log, and a close-out step that pushes the
> corrected range and runs CI green at that head.
>
> **`REVIEWER-REPORT APPEND-ONLY` governs where resolutions go, and all four conditions are load-bearing:**
>
> 1. **No in-place edit, ever** — not one character of the reviewer's text changes.
> 2. **One appended, attributed section** — a single `## CORRECTION PASS (Session 30-D)` at the **end** of
>    the reviewer's own file, opening with its author, date and the commit range it fixed.
> 3. **Findings are referenced, never restated as resolved** — cite by id, and record *finding → fix → the
>    test that now proves it → the commit SHA*.
> 4. **A disputed or withdrawn finding is argued, not erased.**
>
> The Session 22-D failure (RESOLVED verdicts written *into* the reviewer's finding text) remains
> prohibited. Note the Session 22-F / NEW-12 exception: the **findings document** is read at **its own**
> commit, which the report must name; the **reviewed artefacts** are read at the audited range.

---

## §5 — Docs to update at close-out (Track G done)

- [ ] `docs/current-phase.md` — the Session 30 entry closing Track G; the `db-tests` promotion tally with
      run URLs and the skip-guard's file/test counts **quoted verbatim from the log line**; and the eval
      result recorded **as a number** per ADR 0015 Amendment B(c) — **per source, never blended** (L-11),
      with the new source explicitly stated to be MEASURED at **lower confidence** than the old until its
      graduation label count is reached, and the corpus's redden demonstration cited.
- [ ] `docs/decisions/0023-market-responsive-signal-source.md` — status / close-out block, amended by the
      correction pass if it changed anything the ADR asserts.
- [ ] `docs/decisions/0020-mode-3-signal-ingestion.md` — the appended amendment notes recording the §6.5
      embeddings ruling and the §14 clustering finding. **Appended, never rewritten in place.**
- [ ] `docs/decisions/0015-test-execution-and-ci-gates.md` — **only if** Q3 un-deferred embeddings, in
      which case the Tier-3 `SIGNAL-NO-EMBEDDINGS` retirement is recorded as the decision ADR 0015 §2
      requires. If embeddings were re-affirmed, **no change** — say so explicitly rather than leaving it
      ambiguous.
- [ ] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — a cascade row for any new business-scoped
      table, or an explicit note that the change was a column on an already-covered table (the Session
      28-D D7 precedent).
- [ ] `docs/evidence/0010-legal-evidence.md` / `content/legal/*.mdx` — **only if** Q6 surfaced a
      customer-facing legal claim. Per CLAUDE.md, drift between code reality and legal prose is a
      counsel-grade failure mode: either confirm `evidenceRef` still matches, or bump it. **Do not
      substitute `[LEGAL ENTITY]` placeholders** — that is gated on counsel ratification.
- [ ] `docs/brainstorm/plan-vs-implemented-gap-analysis.md` — refreshed or superseded. Market-responsive is
      now built; **evergreen-strategic is not**, and remains the one intelligence-doc opportunity type with
      no session behind it.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — updated per the OpenWolf protocol.
- [ ] **Next:** with Tracks F and G closed, the remaining gap-analysis items are all condition-blocked —
      `relationship_memory` (needs the Phase-2 engagement inbox), evergreen-strategic opportunity types,
      the skip-review fast path (ADR 0017 L-11), and Phase-2 media generation. **None is a drift; each is a
      recorded deferral with a named condition.** The next session is a product decision, not a gap-fill.
