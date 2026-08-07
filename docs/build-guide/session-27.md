# Session 27 — Mode 3 Part 1: GitHub signal ingestion (ADR 0020) · Track E

> **Goal:** build the *pipe*, and nothing that exercises judgment. Mode 3 is the signal-driven campaign
> mode: the AI notices something worth talking about, proposes an angle, and a human approves before a
> single word is generated. That whole mode decomposes into six stages (A ingestion → B candidate scoring
> → C triage → D insight cards → E human inbox → F re-entry into Mode 2's brief pipeline). **Session 27
> builds Stages A and B only, and they contain zero LLM calls.** A GitHub App the business installs, a
> watch list of repos, a scheduled poller, and a deterministic scoring/dedup/clustering pass. Session 28
> (`docs/build-guide/session-28.md`, ADR 0021) builds Stages C–F, where every judgment call in the mode
> lives.
>
> **Why the cut falls here.** The seam is not arbitrary and the ADR should say so: everything in Session
> 27 is provable by exact-match assertion against fixtures and live Postgres — a poller either ingested
> the release or it didn't, a dedup key either collides or it doesn't. Everything in Session 28 is
> probabilistic and needs a statistical eval harness that does not yet exist as a category in ADR 0015.
> Mixing them would put the product's least-testable component inside the same review as its most
> testable, and the reviewer would have no way to say which half a red run indicted.
>
> **This is Track E**, the second track of the second programme. Track D (Mode 1 Studio, ADR 0019) closed
> with Session 26-D's correction pass — CI green on PR [#5](https://github.com/tcr430/SOSH/pull/5), head
> `308ff92b`. Tracks A–C (ADR 0016 governed memory / 0017 Mode 2 upgrade / 0018 diff-based learning)
> closed before it. **Mode 3 was deferred by `docs/brainstorm/session-plan-adrs-0016-0018.md` §4 with a
> stated reason — writing its ADR earlier risked staleness "once those foundations exist in their actual
> shipped shape rather than their designed one." That condition is now met for all four foundations, and
> the Reality block below exists to honour it: ADR 0020 is written against the shipped shape, not the
> 2026-07-17 brainstorm's assumptions.**
>
> **Phase gating. §1 (Architect) ran first and alone. It is COMPLETE — do not re-run it:**
> `docs/decisions/0020-mode-3-signal-ingestion.md` is **Accepted (2026-08-04)** with **33 named `SIGNAL-*`
> constraints**, four tables, one signal kind (published releases), and three founder adjudications made
> **before** its body was written (ADR §0.1, mirrored here as **§0.2**). **§1 below is preserved verbatim
> as the prompt that actually produced that ADR** — it is a record, not a live instruction, and it is not
> retroactively edited to match outcomes it could not have known. It did its job precisely by *refusing*
> to decide A-1: it instructed the Architect to escalate, `security-reviewer` found the tenant-confusion
> BLOCKER (ADR §8.2), and the founder ruled. The one place its §0/§0.1 input is now refined by
> adjudication is A-1, and that refinement lives in **§0.2**, where a reader can see who made it. **§2
> (Builder) and §3 (Reviewer) are authored from the accepted ADR's real constraint names**; **§4
> (Correction)** stays a shell until `docs/reviews/session-27-reviewer.md` exists.

---

## Reality check — verified against the live repo, 2026-08-04

Ground the ADR in these. Where the brainstorm and this block disagree, **this block is the current
truth** and the ADR says so.

1. **There is no GitHub anything in this codebase.** No `octokit`, no `@octokit/*`, no `gh` client, no
   `signal_*` migration, no `lib/signals/` or `lib/mining/`. Verified: `grep '"@octokit\|octokit"'
   package.json` → no match; `ls supabase/migrations | grep signal` → no match; `ls lib` → no such
   directory. **Mode 3 is genuinely net-new surface**, exactly as the brainstorm predicted ("largest
   net-new surface, scope down hard"). Nothing here is a retrofit.

2. **The worker pattern is already built, six times over, and must be reused rather than reinvented.**
   `@upstash/qstash@2.11.0` is pinned in `package.json`; `lib/cron/` holds the shared machinery; six
   routes exist under `app/api/cron/` — `publish`, `sync-metrics`, `capture-learning`,
   `drain-email-outbox`, `trial-warnings`, `process-deletions`. The learning worker (`capture-learning`,
   ADR 0018) is the closest structural analogue: scheduled, service-role, per-business fan-out,
   outbox-shaped, one canonical JSON tick log. **Stage A's poller is that pattern with a different
   fetch.** If the ADR proposes new scheduling machinery, it is wrong — flag it.

3. **`social_accounts` + Vault is the token precedent, and it is the wrong precedent here.** CLAUDE.md's
   token rule (Vault only, `vault_access_token_id` on the row, decrypt via service-role) exists for
   long-lived OAuth tokens. **A GitHub App does not have one.** It has a private key (an env secret, one
   per *deployment*, not per tenant) plus a per-tenant *installation id* (not a credential — it is
   useless without the key), from which the poller mints a **~1-hour installation token at call time**.
   Whether Vault applies at all is Q1, and the answer is not obviously yes. **What is certain:
   `SocialProvider` is NOT extended to cover GitHub.** That abstraction is the publishing surface (ADR
   0002); a read-only signal source is not a place SOSH publishes. A `PostizProvider` sibling here would
   be a category error.

4. **The erasure cascade obligation is absolute and this track has a sharper version of it than any
   prior track.** CLAUDE.md: any business-scoped table needs a row in ADR 0010 Amendment 2 §D2.5's
   cascade table plus `purge_business` coverage, or it is a silent GDPR leak. **The sharper version:
   GitHub release notes, commit metadata and PR descriptions contain third-party personal data** —
   contributor names, usernames, and in commit trailers frequently email addresses — belonging to people
   who are not SOSH users and never consented to anything. This is the first time SOSH ingests personal
   data about **non-users** at scale. Q7 is where the ADR confronts it, and "we'll strip it later" is not
   an answer a legal-surface ADR accepts.

5. **`ai_usage` and the cost-recording path already exist** (service-role write, CLAUDE.md's lazy-import
   pattern). Session 27 makes **zero** AI calls, so it writes nothing there — but Session 28's cost
   ceiling will need it, and the ADR should state what Session 27 leaves in place (or deliberately does
   not) for that.

6. ~~**`campaigns.origin` may already carry a `signal_generated` value.**~~ **SETTLED by ADR 0020 §1.4 —
   it does.** The sweep read `supabase/migrations/20260722190000_mode2_brief_and_roles.sql:113-114`:
   `CHECK (origin IN ('manual', 'objective_generated', 'signal_generated'))`. **Stage F costs no
   migration, in Session 27 or Session 28.** Left visible rather than deleted, because the open question
   is what sent the sweep to that file — and the answer removed work rather than adding it.

7. **`lib/config.ts` is the only place an env var may be read** (CLAUDE.md). The GitHub App id, private
   key, and webhook secret (if any) go through it, typed. No `process.env.GITHUB_*` anywhere else.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-08-04)

These are decided. The Architect (E1) **encodes** them in ADR 0020 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**, exactly as an ADR
contradicting CLAUDE.md would.

**Locked (L):**

- **L-1 — Session 27 ships Stages A and B ONLY, and makes ZERO LLM calls.** *In scope:* the GitHub App
  connection + install callback; the per-business **multi-repo watch list**; the scheduled **poller**
  (Stage A) and its raw-signal store; the deterministic **candidate scoring / dedup / clustering** pass
  (Stage B); the connect + watch-list management surface; and every RLS/cascade/retention obligation the
  new tables incur. *Out of scope, explicitly:* **Stage C triage**, **Stage D insight cards**, **Stage E
  the opportunity feed**, **Stage F Mode 2 re-entry** — all Session 28; **any external signal source**
  (news, RSS, competitor social accounts) — a later track; **embeddings and pgvector** (L-6); and **any
  change to Mode 1, Mode 2, or ADR 0018's classifier behaviour.** If a step appears to need any of these,
  **STOP and report**. A single `anthropic.messages.create` reachable from Session 27's code is a scope
  breach, not an optimisation.

- **L-2 — GitHub App, not OAuth App, not PAT.** The business installs a **GitHub App** onto their org or
  selected repos. Rationale to record: fine-grained read-only permissions (contents + metadata only),
  **short-lived installation tokens** minted per call rather than a long-lived user-scoped credential
  sitting in our database, per-installation revocation the customer controls from their own GitHub
  settings, and repo-scoped access that cannot silently widen when a user's personal permissions change.
  Losers: an OAuth App (a long-lived broadly-scoped user token in Vault for a read-only changelog feed —
  a blast radius wildly out of proportion to the value); a pasted PAT (no rotation, worst UX, and the
  token belongs to a person who may leave the company).

- **L-3 — Ingestion is a SCHEDULED POLL. No webhook route is built in Session 27.** The poller reuses the
  existing QStash cron pattern (Reality §2). Rationale to record: no new unauthenticated public ingress,
  no delivery-failure/replay story to design, tolerant of downtime by construction, and latency measured
  in hours is irrelevant to a product whose next step is a human triaging an inbox. **The schema must
  leave a webhook seam** — the raw-signal table's shape must permit a future webhook writer to insert the
  same rows without a migration — but **no route, no signature verification, and no secret is built this
  session**. Losers: webhook-first (buys minutes of latency for a permanent attack surface); webhook +
  poll reconciliation from day one (two writers into one table before either is proven).

- **L-4 — A business watches a LIST of repos, chosen by the user from the installation.** Not one repo,
  not "everything the installation grants." The watch list is the narrowing mechanism the design calls
  both a cost control and a relevance control (intelligence doc §4) — surrendering it makes every later
  scoring decision harder. The Architect decides the table shape and the picker's contract; not whether
  the list exists.

- **L-5 — Signal ingestion is READ-ONLY against GitHub, forever.** SOSH never writes to a customer's repo
  — no issues, no comments, no commits, no releases, no reactions. The App's permission set must be the
  minimum that supports reading the signal kinds Q4 settles, and the ADR states the exact permission
  scopes requested. A permission we do not use is a permission we do not request.

- **L-6 — Stage B is DETERMINISTIC. No embeddings, no pgvector, no LLM.** The brainstorm proposes "cheap
  embeddings + dedup + clustering" for a general multi-source firehose. **With exactly one structured
  source, GitHub supplies stable identity for free** — release ids, tag names, commit SHAs — so dedup is
  an exact key, not a similarity threshold, and clustering is "the commits in this release," not a
  learned grouping. Scoring is a stated arithmetic function of stated inputs. Rationale to record: an
  embedding-based Stage B would add a vector extension, an embedding API call per signal, a similarity
  threshold nobody can justify from one source's data, and a non-deterministic component into the one
  half of Mode 3 that is supposed to be exactly testable. **If the Architect concludes deterministic
  Stage B is genuinely insufficient, it STOPS and flags for founder adjudication** rather than
  introducing embeddings quietly. Loser: embedding-based similarity dedup (deferred to whenever a second,
  unstructured source lands — and named as such).

- **L-7 — An exact-pinned GitHub client dependency is PRE-AUTHORISED.** CLAUDE.md forbids new runtime
  dependencies without founder confirmation; this is that confirmation, for this purpose only. The
  Architect may specify `@octokit/*` (or an equivalent), **pinned to an exact version with no caret** —
  the Session 13.5D/B7 rule (`@upstash/qstash` was pinned for exactly this reason). It must still
  **justify the choice**: which packages specifically (an App-auth package and a REST client are commonly
  separate), what they weigh, whether they run server-only (they must), and it must still consider
  hand-rolled `fetch` against the four or five endpoints actually used and name that as the loser if
  rejected. **This authorisation covers the GitHub client and its App-auth helper and nothing else** —
  any *other* new dependency is still a STOP.

- **L-8 — Plan gating is DEFERRED, but the seam is named and real.** Mode 3 ships ungated in Sessions 27
  and 28. The ADR must nonetheless identify **the single narrowest place** a future entitlement check
  would go (the connect action and the poller's per-business filter are the candidates) and state it as a
  named constraint, so a later pricing session adds one check rather than retrofitting a concept. A seam
  that is described but not locatable in code is not a seam — name the function.

- **L-9 — Third-party personal data is a first-class design problem, not a footnote (see Reality §4).**
  The ADR must state, per signal kind ingested: what personal data it can contain, whether SOSH stores it
  or strips it at ingest, the lawful basis and retention period, how `purge_business` handles it, and
  what a data-subject request from a **non-user contributor** would look like. "It is public data" is not
  a lawful basis and the ADR does not use that phrase. Where the honest answer is "strip it at ingest and
  never store it," that is the preferred answer and the ADR says why.

- **L-10 — Every ingested byte is UNTRUSTED INPUT and is stored as such.** A GitHub release body is
  written by whoever cut the release — frequently a contributor, sometimes a bot, occasionally an
  outsider whose PR was merged. In Session 28 that text becomes input to an LLM **with tool access**.
  Session 27 does not make that call, but it is the session that decides how the text is stored, and it
  must store it in a form that makes the Session 28 guard unavoidable: the ADR states the `[DATA]`-wrap +
  `sanitizeDataField` obligation (ADR 0017 §9) as a constraint **on the reader**, names the field(s) it
  applies to, and states plainly that raw signal text is never concatenated into a prompt by any caller.
  Sanitising at ingest instead of at read is a candidate the ADR must weigh explicitly (it loses fidelity
  for the human reader; it gains one chokepoint) and name the loser.

- **L-11 — Failure isolation and idempotency are contract, not best-effort.** One business's revoked
  installation, rate-limited call, or malformed payload **must not** stall the tick for every other
  business. A release that has been ingested once must never ingest twice, including across a retried
  QStash delivery and a poller that overlaps its own previous run. The ADR states the idempotency key,
  the transition guard (atomic conditional `WHERE`, never read-then-update), and the per-business error
  containment — and names the observable consequence of each failure mode rather than letting it be
  silent (ADR 0018's `learning-report.ts` orphan report is the precedent for "a deliberate skip needs an
  operator-visible counterpart").

- **L-12 — GDPR, tenancy and RLS obligations in full.** Every new business-scoped table: RLS in the
  InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, both `USING` and `WITH
  CHECK` on every UPDATE policy, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2
  §D2.5's cascade table**, and `purge_business` coverage. The poller runs **service-role and bypasses RLS
  entirely** — so every service-role read/write states its explicit `business_id` predicate, and the ADR
  names each one. Service-role is never reachable from a Server Component or Client Component.

- **L-13 — Contract discipline + constitution rules, inherited by every step.** Additive migration with
  an explicit stated backfill; **Zod** on every new Server Action / route input (including the GitHub
  install callback's query params); **atomic** state transitions; every new list query **bounded +
  explicit `ORDER BY`** matching an index; **date-fns** (`formatISO`, never `new Date().toISOString()`);
  **no `any`**; **`console.*` only** as the single canonical structured-JSON tick line the worker
  carve-out permits (CLAUDE.md, Session 25-D NIT-6) — never on the user-facing surface; env only via
  `lib/config.ts`; DB only via `lib/db/`; **`SocialProvider` untouched** (Reality §3); and
  **SHARED-FUNCTION CALLERS** — if this track touches any function that already has callers, enumerate
  **every** caller and state, per caller, which test covers it. Both Session 22 blockers were this exact
  failure.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | What Session 27 ships | **Stages A+B only, zero LLM** | Stages A–D in one session (loads all the AI risk into the first session and leaves the second thin); connection-only (makes Session 28 larger than any session shipped to date) |
| D-2 | GitHub auth | **GitHub App** | OAuth App (long-lived broad user token in Vault for a read-only feed); PAT paste (no rotation, tied to a person who may leave) |
| D-3 | Ingestion trigger | **Scheduled poll, webhook seam only** | webhook-first (permanent public ingress for minutes of latency); dual-writer from day one |
| D-4 | Watch scope | **Multi-repo watch list per business** | single repo (wrong for any monorepo split or separate docs/API repos; widening is a migration + UI change); all installed repos (surrenders the narrowing control that is both a cost and a relevance mechanism) |
| D-5 | Stage B mechanism | **Deterministic — exact keys, stated arithmetic** | embeddings + similarity threshold (a non-deterministic component in the exactly-testable half, a vector extension, and a per-signal API call, all to solve a problem one structured source does not have) |
| D-6 | GitHub client | **exact-pinned dependency pre-authorised; hand-rolled `fetch` still to be argued** | unpinned/caret dependency (13.5D/B7); adopting a client without stating what it costs server-side |
| D-7 | Plan gating | **deferred, seam named in code** | gating now (no entitlement module exists; inventing one here couples Mode 3's release to a pricing decision); no seam at all (a later gate becomes a retrofit across two sessions' surface) |
| D-8 | Abstraction boundary | **new `lib/signals/` module; `SocialProvider` untouched** | extending `SocialProvider` with a read-only source (category error — that interface is the publishing surface, ADR 0002); putting GitHub calls directly in the cron route (violates the module-boundary pattern every other integration follows) |

---

## §0.2 — Founder adjudications (raised by E1 after its eight §0.1 answers, before the ADR body · 2026-08-04)

The §1 gate requires these be on the record here before the Builder starts. All three were ruled on before
ADR 0020's body was written; the ADR encodes them at its own §0.1 and does **not** re-open them. **The
Builder treats them as binding and does not re-litigate any of the three.**

| # | Item | Ruling | Where it lands |
|---|---|---|---|
| **A-1** | GitHub App **user-authorization (OAuth) leg** during installation, adding `GITHUB_APP_CLIENT_ID` + `GITHUB_APP_CLIENT_SECRET` | **Approved.** The only mechanism that closes the tenant-confusion BLOCKER at ADR §8.2 `[sec-BLOCKER-1]`. Founder rationale: *"we need OAuth (just like Vercel and Supabase) — this is the way to go."* | ADR §0.1, §2.4, §8.3; steps **E2.x** covering the callback |
| **A-2** | Evidence Pack entry + Art. 6(1)(f) balancing test + `/privacy` prose for third-party personal data | **Approved as a tracked follow-on, not a blocker on this ADR. Condition, binding: NO LAUNCH until all three land.** | ADR §9.6; `docs/current-phase.md` at close-out |
| **A-3** | Retention reaper for raw signals | **Deferred**, on the ADR 0019 A-2 precedent. **Condition, binding: the 180-day retention figure stays out of every customer-facing surface** — `/privacy`, marketing, in-product copy, support macros — until an executor exists. A retention promise with no reaper is a false statement to a regulator. | ADR §9.5 |

**A-1 is the ruling a Builder is most likely to drift on, in both directions.** Read it precisely:

- **It does NOT weaken L-2, and L-2's loser is still rejected.** Vercel's and Supabase's GitHub
  integrations are both GitHub **Apps** with the user-authorization option enabled — not standalone OAuth
  Apps. The App's **private key remains the only thing that grants repository access**. L-2's named loser
  — a standalone OAuth App holding a long-lived, broadly-scoped user token in Vault for a read-only feed
  — is untouched by this ruling and remains rejected.
- **The user token is an identity check, not a credential.** It is exchanged once at install-callback
  time, used for exactly one call (`GET /user/installations`, ADR §8.3 step 9) to prove the person
  completing the flow can actually administer the installation they are claiming, and then **discarded**
  — never persisted, never cached, never used by the poller (ADR §2.4). `SIGNAL-NO-TOKEN-AT-REST` holds
  unchanged. A Builder who stores that token has broken the adjudication, not implemented it.
- **The drift in the other direction is worse:** a Builder who reads L-2's *"not OAuth App"* literally and
  omits the client id/secret ships the design `security-reviewer` proved exploitable — an attacker binding
  a stranger's installation, polling private-repo release notes into their own dashboard, and squatting
  the row so the real owner is permanently locked out. **Steps 8–9 of ADR §8.3 are not optional
  hardening; they are the security boundary.**

---

## §0.1 — Questions the Architect (E1) must resolve IN the ADR (BINDING)

**E1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (agency
tier per the intelligence doc §5 table, test tier per ADR 0015 §2). The Builder will consume these answers
as binding. Ground every answer in the real seams — let the single `ecc:code-explorer` sweep map them and
cite its `file:line` findings rather than remembering line numbers.

- **Q1 — The credential model: what is stored, where, and what Vault has to do with it (the load-bearing
  question — see Reality §3).** A GitHub App authenticates as a JWT signed with a deployment-level private
  key, exchanged for a **~1-hour installation access token** scoped to one installation. Decide: does the
  **installation id** live on a normal application table column (it is an identifier, useless without the
  key) or in Vault (consistent with the `social_accounts` precedent, but arguably ceremony for a
  non-secret)? Where does the **private key** live (`lib/config.ts`, per L-13 — state the env var name and
  the encoding, since PEM newlines in env vars are a real operational trap)? Are installation tokens
  **cached** for their lifetime or minted per call (state the rate-limit arithmetic that justifies the
  answer)? **And state what disconnect does** — all of: mark the source inactive, stop the poller reading
  it, delete or retain already-ingested signals (a real choice, argue it), and whether SOSH attempts to
  delete the installation via the API or instructs the user to remove it from their GitHub settings.
  CLAUDE.md's three-step disconnect rule for `social_accounts` is the precedent to argue from, not to copy
  blindly.

- **Q2 — The table set and its boundaries.** Candidate shapes to weigh explicitly: a **connection** table
  (one row per business per installation), a **watched-repos** table (L-4), a **raw signals** table (what
  the poller writes, one row per ingested GitHub object), and a **candidates** table (what Stage B
  writes). Are raw signals and scored candidates **one table with a status column** or two? Argue it — one
  table is fewer joins and a simpler cascade; two tables give Stage B its own replayable output and make
  "re-score without re-fetching" free, which matters when Stage B's scoring function is tuned. State the
  full L-12 obligation per table, the indexes each list query needs (bounded + explicit `ORDER BY`,
  L-13), and the **webhook seam** L-3 requires — name the columns a future webhook writer would fill and
  confirm none of them is poller-specific.

- **Q3 — The poller's contract.** Cadence and why (state a number and defend it against GitHub's rate
  limits, which for an App are per-installation, not global). Fan-out shape across businesses — one QStash
  message per tick that loops, or one per business? (ADR 0018's hourly worker is the precedent; say
  whether you follow it and why.) The **idempotency key** (L-11) and where the guard lives — a unique
  index is a stronger claim than an application check, and the ADR should say which it chose. **Failure
  isolation**: what happens on a revoked installation, a 401, a 403 rate limit with a `Retry-After`, a
  502, and a repo deleted out from under the watch list — each with its operator-visible consequence, not
  a silent skip. The single canonical JSON tick log line's exact fields (L-13). Whether the poller uses
  GitHub's `since` / `ETag` conditional requests to avoid re-reading the world every tick (it should —
  state the mechanism and where the cursor is stored).

- **Q4 — What is a signal, concretely, and what payload is retained.** Candidates: **releases** (the
  brainstorm's stated starting point — titled, dated, human-written, and explicitly *published*, which
  makes them the least surprising thing to surface publicly), **tags**, **merged PRs**, **commits**, a
  **`CHANGELOG.md`** file read from the default branch. Decide the set for v1 and defend the exclusions —
  in particular, **argue explicitly against ingesting raw commits**, which are high-volume, low-signal,
  and the richest source of third-party personal data (L-9). For each included kind, state the exact
  fields retained and — per L-9 — the fields **deliberately dropped at ingest**. State the maximum
  retained body size and what truncation does (a truncated release note that silently loses its point is
  worse than a link).

- **Q5 — Stage B: the scoring function, the dedup key, and the clustering rule (L-6).** State the score as
  an actual formula over named inputs (recency, repo weight if any, signal kind, body length as a proxy
  for substance, presence of a human-written body at all — a bot-generated release note is a different
  animal and the ADR should say whether it is scored down or filtered out). State the **dedup key** and
  prove it is stable (a release can be *edited* after publication — does an edit re-ingest, update in
  place, or produce a second candidate?). State the **clustering rule** (the obvious one is "one candidate
  per release, with its commits as supporting detail" — argue it). Then state the **determinism
  requirement as a testable property**: the same input set must always produce the same ordered candidate
  list. Explicitly confirm no embeddings and no LLM (L-6), and name the deferred embedding path.

- **Q6 — Surface, capability gating and multi-tenancy.** Where the connect flow lives (route shape), what
  the install callback does (Zod on its query params, L-13 — and state the CSRF/state-parameter handling,
  since an install callback is an unauthenticated entry point until you prove otherwise). Which existing
  `user_can` capability governs connecting a signal source and editing the watch list — **reuse an
  existing capability if one fits; propose a new one only with an argument**, since a new capability
  touches ADR 0013's DB-enforced model and is not a free addition. State the L-8 plan-gating seam by
  function name. Confirm the connect/disconnect handlers get an **authoritative app-layer `user_can`
  gate** if they run service-role — the 21B precedent for exactly this (CLAUDE.md: RLS is
  defence-in-depth only when the caller bypasses it).

- **Q7 — Third-party personal data, retention, and erasure (L-9, L-12).** Per retained field: does it
  contain personal data, is it stored or stripped, and under what retention. The **contributor identity**
  question is the sharp one — a release's author, a commit's author name and email. State the decision and
  its consequence for the insight cards Session 28 will render (a card that says "shipped by @someone" is
  a different privacy posture from one that says "shipped in v2.4"). State the retention period for raw
  signals and whether a reaper exists in Session 27 or is a named follow-on (ADR 0019's A-2
  deferred-reaper precedent). State the ADR 0010 Amd 2 §D2.5 cascade rows verbatim. **And state whether
  this ADR requires an amendment to ADR 0010's legal surface or a new Evidence Pack entry** — if it does,
  say so plainly and flag it for founder adjudication rather than folding it in.

- **Q8 — Test plan across the tiers, and the Session 28 seam.** Map every `SIGNAL-*` constraint to ADR
  0015 §2's tiers: **Tier 1** (live-Postgres `supabase/__tests__`) for every new table's RLS, cascade,
  `purge_business` coverage, and the idempotency unique index; **Tier 2** (`vitest`, app-layer) for the
  scoring function's determinism, the dedup key's stability across an edited release, the poller's
  failure-isolation branches (each error class as its own case, against fixture responses — **name the
  fixture directory**), the cursor/conditional-request logic, and the Zod guards; **Tier 3**
  (diff-verified, no runtime test **by decision**) enumerated **as such** so "no test" is recorded rather
  than overlooked — the "no LLM call is reachable from Session 27 code" property (L-1) is a strong
  candidate for a source-scan test rather than a runtime one, and ADR 0019's three source scans are the
  precedent for how to write one that cannot vacuously pass. Then: **state explicitly what Session 27
  leaves in place for Session 28** — the exact table/column/function Stage C reads from — so ADR 0021
  builds against a named contract rather than re-deriving one.

Where an E1 answer and this build-guide disagree, **the ADR wins once written** — but E1 must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**, exactly
as an ADR that contradicts CLAUDE.md would.

---

## §1 — Architect session (E1)  ·  (paste into Claude Code · Opus)  ·  ✅ COMPLETE — DO NOT RE-RUN

> **Preserved verbatim as the prompt that produced ADR 0020 (Accepted, 2026-08-04).** Nothing below is
> edited to reflect what the session went on to decide — a prompt rewritten after its run stops being
> evidence of what produced the artefact. Where its input was refined by adjudication, the refinement is
> in **§0.2**, attributed. The three items it correctly escalated rather than decided are A-1/A-2/A-3.

**Role boundary (constitution).** This session produces **`docs/decisions/0020-mode-3-signal-ingestion.md`
ONLY**. No `.ts`, no `.sql`, no `.tsx` — no code of any kind. Any code attempted here is discarded. The
last action is a single confirmation line, then `/exit`. §2/§3/§4 of this build-guide are authored only
after the ADR is Accepted, from its real `SIGNAL-*` constraints.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list in the primer, then **exactly three** advisory reviewers dispatched **once, in a
single parallel batch**, after the draft answers exist. No iterative re-consultation: fold each objection
in, or record why it was rejected, and move on. `ecc:architecture-decision-records` is a skill and is
free; so is `claude-mem`'s `mem-search` for prior-session context — **prefer one `mem-search` over
re-reading a closed session's build guide**. `cost-aware-llm-pipeline` is **not** invoked (Session 27
makes zero AI calls — there is no cost model to optimise). `impeccable` / `taste-skill` are **not** invoked
(the connect + watch-list surface is a form; the design-led session comes after Session 28). Do not add
specialists outside this set.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 27 — Mode 3 Part 1: GitHub signal ingestion, ARCHITECT phase (Track E). You produce ONE artefact:
docs/decisions/0020-mode-3-signal-ingestion.md (status: Accepted). You write NO code — no .ts, no .sql,
no .tsx. If you catch yourself writing a migration, a zod schema body, or a route, stop: that is the
Builder's job (E2), and the constitution requires Architect-attempted code to be discarded.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. Ask it for file:line citations and
   the shape of each seam — nothing else. Do not rely on memory for line numbers.
2. Use the ecc:architecture-decision-records skill for the ADR's structure so 0020 matches 0010-0019.
   (A skill, not an agent — free.) Use claude-mem's mem-search if you need prior-session context; it is
   cheaper than re-reading a closed build guide.
3. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - database-reviewer — on Q2's table set and Q5's dedup key specifically. Ask it to pressure-test:
     one-table-with-status vs separate raw/candidate tables; the idempotency key as a unique index vs an
     application check (including behaviour under a retried QStash delivery and an overlapping poller
     run); the index each bounded+ORDER BY list query needs; the RLS policy form; and the cascade +
     purge_business obligation for every proposed table.
   - security-reviewer — on THREE paths: (1) the GitHub App credential model (Q1) — private key handling
     via lib/config.ts, installation-token lifetime and caching, what a leaked installation id does and
     does not grant, and the disconnect/revocation story; (2) the install CALLBACK as an entry point —
     it is reached from GitHub, not from our own UI, so ask specifically about state/CSRF, replay, and an
     attacker-supplied installation_id being bound to the wrong business (this is a tenant-confusion
     vector and the sharpest security question in the session); (3) untrusted ingested text (L-10) —
     confirm the storage shape makes the Session 28 [DATA]-wrap + sanitizeDataField guard unavoidable
     rather than merely recommended.
   - ecc:type-design-analyzer — on the signal/candidate types ONLY. The requirement: raw, unsanitised
     ingested text must be DISTINGUISHABLE IN THE TYPE SYSTEM from text that is safe to place in a
     prompt, so that Session 28 cannot accidentally concatenate the former. Ask whether the proposed types
     make that mistake unrepresentable, or merely discouraged. A runtime if is not enforcement.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke cost-aware-llm-pipeline — Session 27 makes ZERO AI calls (L-1); there is nothing to cost.
DO NOT invoke impeccable or taste-skill — the connect + watch-list surface is a form, and the design-led
session follows Session 28.

Read now, before anything else:
- docs/build-guide/session-27.md — the Reality block at the top, §0 (Locked L-1..L-13 + the D-1..D-8
  ledger) and §0.1 (the eight questions Q1..Q8 you MUST resolve). This is your binding input.
- docs/brainstorm/campaign-modes-architecture-and-build-plan.md — §1 "Mode 3 — Signal-driven campaigns"
  (Stages A-F; you build A and B) and §2 "Phase D" (the scope-down-hard instruction and the one-signal-
  source start). §1 Modes 1 and 2 are context for what you must NOT build.
- docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md — §2 (content mining and why
  it produces an insight card and NEVER a post directly), §4 (the opportunity feed's narrow-by-design and
  expiry constraints — Session 28's, but they constrain what you must retain), and §5's tiered agency
  table (Stages A and B are Tier 0 — deterministic code, no LLM).
- CLAUDE.md — the DB-access / three-client / RLS + erasure-cascade / atomic-transition / Zod / bounded-
  query / config / no-console rules, the webhook-handler section (context for the seam you are NOT
  building), the token-storage rule (and why a GitHub App is a different case — argue it), and the
  test-execution-integrity section (the three tiers, and SHARED-FUNCTION CALLERS).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 (the three tiers) and §5 (the merge gates).
- docs/decisions/0010-legal-surface.md Amendment 2 §D2.5 (the erasure-cascade table — every new business-
  scoped table needs a row) and its Evidence Pack pointer (Q7 may need one).

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- app/api/cron/capture-learning/route.ts and lib/cron/* — the worker pattern you are reusing: QStash
  verification, service-role acquisition, per-business fan-out, error containment, the canonical tick log
  line. Also app/api/cron/publish/route.ts for the older variant.
- lib/db/social-accounts.ts + app/api/social/[platform]/connect/route.ts + callback/route.ts +
  disconnect/route.ts — the connect/callback/disconnect precedent, its Vault handling, and the 21B
  app-layer user_can gate on service-role route handlers. You are arguing FROM this, not copying it.
- lib/supabase/service.ts (the serverOnly guard) and lib/config.ts (the typed env surface your GitHub App
  key must go through).
- supabase/migrations/20260722190000_mode2_brief_and_roles.sql — REPORT THE ACTUAL VALUES of
  campaigns.origin. Session 28's Stage F depends on whether 'signal_generated' already exists. Do not
  assume.
- supabase/migrations/20260726010000_learning_capture.sql — the outbox-table + trigger-enqueue shape, the
  closest structural precedent to a raw-signal store; and 20260730100000_studio_drafts.sql — the most
  recent new business-scoped table, for the current RLS/cascade house form.
- lib/db/types.ts (the Row/Insert/Update convention and the tenancy-critical exclusion sets) and one
  representative lib/db/*.ts table module for the query-function house style.
- lib/ai/wrap-evidence.ts + lib/ai/parsers.ts — the [DATA] wrap / sanitizeDataField guards L-10 makes
  Session 28's obligation and yours to make unavoidable.
- lib/db/user-can.ts (or wherever canServer lives) + docs/decisions/0013-seats-and-permissions.md's
  capability list — Q6 needs the ACTUAL capability names, not remembered ones.
- package.json — confirm no octokit, and report the exact-pin convention used for @upstash/qstash.

Do NOT write the ADR yet. First OUTPUT your answers to the eight §0.1 questions (Q1 the credential model,
Q2 the table set, Q3 the poller contract, Q4 what a signal is and what payload is retained, Q5 Stage B's
scoring/dedup/clustering, Q6 surface + capability gating, Q7 third-party personal data + retention +
erasure, Q8 the three-tier test plan + the Session 28 seam), EACH with its named loser and its tier
(agency tier per the intelligence doc §5 table, test tier per ADR 0015 §2), AND a one-line note on any
place a §0 Locked decision constrains the answer. Flag explicitly if any answer needs a new user_can
capability, an amendment to a landed ADR, an ADR 0010 legal-surface amendment or Evidence Pack entry, or a
second new dependency beyond L-7's pre-authorisation — those are founder adjudications, not your call.
Then STOP for acknowledgement. Do not begin the ADR body until the eight answers are acknowledged.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 27. Write docs/decisions/0020-mode-3-signal-ingestion.md (Accepted). Ground every
claim in the real repo (cite file:line from the ecc:code-explorer sweep). You have already dispatched your
ONE batch of three advisory reviewers — fold their objections in now, or record why you rejected them. Do
not re-consult them. The ADR MUST contain, at minimum:

1. Context + decision summary: what happens TODAY (SOSH has two creation paths — Mode 2's objective-driven
   generation and Mode 1's Studio — and in BOTH the human must already know what to talk about; nothing in
   the product ever notices that something happened worth saying), why that is the problem Mode 3 solves,
   and the six-stage A-F pipeline with an explicit statement that this ADR builds A and B only and makes
   ZERO LLM calls. Name the losers per §0 D-1..D-8. State that this is Track E, written against the
   SHIPPED shape of the cron/worker layer, the memory layer and the permissions model.

2. The credential model (Q1) — the load-bearing section. GitHub App vs the social_accounts Vault
   precedent, argued not assumed: where the private key lives (lib/config.ts, named env var, PEM encoding
   trap stated), where the installation id lives and why Vault does or does not apply, installation-token
   minting and caching with the rate-limit arithmetic that justifies it, and the FULL disconnect story
   (inactive flag, poller exclusion, retain-or-delete already-ingested signals argued both ways, and
   whether SOSH revokes the installation or instructs the user). Fold in security-reviewer's findings.

3. The schema (Q2, L-12): every table, its columns, its RLS policy in the InitPlan-wrapped form with USING
   and WITH CHECK on UPDATE, its ON DELETE CASCADE from businesses, its ADR 0010 Amd 2 §D2.5 cascade row
   VERBATIM, its purge_business coverage, and the index behind every bounded + ORDER BY list query. State
   the one-table-vs-two decision with its loser. Name the WEBHOOK SEAM columns (L-3) and confirm none is
   poller-specific. Fold in database-reviewer's findings.

4. The poller (Q3, L-3, L-11): cadence with its rate-limit defence, fan-out shape, the idempotency key and
   whether it is enforced by unique index or application check (say which and why), conditional-request /
   cursor mechanism and where the cursor lives, and a FAILURE TABLE — one row per failure class (revoked
   installation, 401, 403 + Retry-After, 5xx, deleted repo, malformed payload), each with its containment
   behaviour and its OPERATOR-VISIBLE consequence. A silent skip with no counterpart is the failure mode
   to name and reject (ADR 0018's orphan report is the precedent). State the canonical JSON tick log
   line's exact fields.

5. What a signal IS (Q4, L-5, L-9): the included kinds for v1 with the exclusions ARGUED — in particular
   argue explicitly against raw commits. Per kind: the exact retained fields, the fields deliberately
   DROPPED at ingest, the maximum body size, and what truncation does. State the exact GitHub App
   permission scopes requested and confirm each one is used (L-5: a permission we do not use is a
   permission we do not request).

6. Stage B (Q5, L-6): the scoring function as an actual formula over named inputs; the dedup key with its
   stability proven against an EDITED release; the clustering rule; and determinism stated as a testable
   property (same input set → same ordered candidate list, always). Confirm NO embeddings, NO pgvector, NO
   LLM, and name the deferred embedding path as the loser with the condition that would revive it.

7. Untrusted input (L-10): state that every ingested body is untrusted, name the fields, state the
   [DATA]-wrap + sanitizeDataField obligation on the READER citing ADR 0017 §9, and state the
   sanitise-at-ingest alternative with its named loser. Then the TYPES: show how raw ingested text is
   distinguishable in the type system from prompt-safe text, so Session 28 cannot concatenate the former
   by accident. A runtime if is not enforcement — say so and say what you chose instead. Fold in
   ecc:type-design-analyzer's findings.

8. Surface + capability gating (Q6): route shapes for connect / install-callback / watch-list management;
   Zod on the callback's query params; the state/CSRF and tenant-binding handling on the callback (an
   attacker-supplied installation_id bound to the wrong business is the vector — name it and close it);
   the user_can capability governing each action, REUSING an existing capability unless you argue for a
   new one; the authoritative app-layer user_can gate on any service-role route handler (21B precedent);
   and the L-8 plan-gating seam NAMED BY FUNCTION.

9. Third-party personal data (Q7, L-9): the per-field table (contains personal data? stored or stripped?
   retention? lawful basis?), the contributor-identity decision and its consequence for Session 28's
   cards, the retention period for raw signals and whether the reaper ships here or is a named follow-on,
   and an explicit statement of whether this needs an ADR 0010 amendment or an Evidence Pack entry —
   flagged for founder adjudication if so. Do not use the phrase "it is public data" as a basis.

10. Module boundary (D-8): lib/signals/ (or your named alternative) as the ONLY place a GitHub client is
    imported, mirroring the /lib/social/ and /lib/ai/ rules in CLAUDE.md. State the rule in the same form
    those are stated in, so it can be added to CLAUDE.md at close-out. Confirm SocialProvider is untouched
    and say why extending it would be a category error.

11. Test plan mapped to the three tiers (ADR 0015 §2), per Q8 — including which Tier-3 diff-verified
    properties are enumerated AS SUCH so "no test" is a recorded decision rather than an oversight. Name
    the fixture directory for GitHub API responses. For "no LLM call is reachable from Session 27 code"
    (L-1), specify a SOURCE SCAN test and — citing ADR 0019's three source scans and their per-root
    vacuity guards — state how it is prevented from passing vacuously on an empty or renamed root. Follow
    SHARED-FUNCTION CALLERS for every existing function this track touches, with a caller table.

12. A constraint table: every named constraint (SIGNAL-*), its agency tier, its test tier, and the test
    that will prove it — this is the Reviewer's checklist. Cover at least: SIGNAL-NO-LLM-IN-STAGE-AB,
    SIGNAL-READ-ONLY-GITHUB, SIGNAL-INGEST-IDEMPOTENT, SIGNAL-FAILURE-ISOLATED,
    SIGNAL-SCORING-DETERMINISTIC, SIGNAL-DEDUP-STABLE-ON-EDIT, SIGNAL-RLS-ISOLATED,
    SIGNAL-CASCADE-COMPLETE, SIGNAL-PURGE-COVERED, SIGNAL-RAW-TEXT-UNTRUSTED,
    SIGNAL-CALLBACK-TENANT-BOUND, SIGNAL-CAPABILITY-GATED, SIGNAL-NO-PROVIDER-COUPLING,
    SIGNAL-CONFIG-ONLY-ENV, and SIGNAL-WATCHLIST-BOUNDED.

13. The Session 28 contract (Q8, final section, and the reason this ADR is split from 0021): state the
    EXACT table, columns and function signature Stage C will read from, so ADR 0021 builds against a named
    contract rather than re-deriving one. Also state what Session 27 deliberately does NOT provide (no
    card, no expiry, no cost ceiling, no origin enum change) so ADR 0021's scope is unambiguous.

14. Explicit "deferred" section: Stages C-F (Session 28, ADR 0021), all external signal sources (news,
    RSS, competitor accounts — a later track), embeddings/pgvector, webhook ingestion, plan gating (L-8,
    with its named seam), the retention reaper if deferred, and anything Q1-Q7 pushed to a follow-on — so
    the boundary is on the record and a future session doesn't build them here by mistake.

Do NOT write code. End with one line: "ADR 0020 written and accepted — <n> SIGNAL-* constraints, <n>
tables, signal kinds <list>, credential model <summary>, poller cadence <interval>, Stage B deterministic
<yes|flagged>, Session 28 reads <table.column>." Then /exit.
```

**Gate:** do not author §2 until `docs/decisions/0020-mode-3-signal-ingestion.md` exists, is Accepted, and
its eight §0.1 answers are on the record. **If any answer required founder adjudication, that adjudication
is recorded as a `§0.2 — Founder adjudications` block appended to this file before the Builder starts** —
exactly as Sessions 22/23/24/25/26 did. Then author §2/§3/§4 below from the accepted ADR's real `SIGNAL-*`
constraints.

---

## §2 — Builder session (E2)  ·  (paste into Claude Code · Sonnet)

Runs **only after ADR 0020 is Accepted** (it is — Accepted 2026-08-04, **33 `SIGNAL-*` constraints**,
four tables, one signal kind). **Twelve steps** (E2.0…E2.11), dependency-ordered, each a self-contained
`/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait for
acknowledgement, then paste E2.0…E2.11 one at a time**, letting each go green + commit before the next.

Hard rules inherited by every step: §0 L-1..L-13, the D-1..D-8 ledger, and §0.2's three founder rulings
(**A-1** the OAuth user-authorization leg **approved and load-bearing**, **A-2** the Evidence Pack /
balancing test / `/privacy` prose **approved as a launch-blocking follow-on**, **A-3** the retention
reaper **deferred with a binding no-customer-facing-claim condition**). **No Stage C, no Stage D insight
card, no Stage E feed, no Stage F re-entry, no external signal source, no embeddings, no pgvector, no
webhook route, no plan gating, no `campaigns.origin` change, no change to Mode 1, Mode 2 or ADR 0018's
classifier, and no new runtime dependency beyond L-7's two exact-pinned Octokit packages.** If a step
appears to need one, **STOP and report** — it contradicts ADR 0020 §14 and §0 L-1. **A single
`anthropic.messages.create` reachable from any file this session writes is a scope breach, not an
optimisation** — it is `SIGNAL-NO-LLM-IN-STAGE-AB`, and E2.10 makes it executable.

**ADR 0020 decisions the Builder transcribes (do NOT re-derive, "improve" or re-litigate — the ADR
resolved every one against a named loser, with three advisory reviewers already folded in as
`[db-*]` / `[sec-*]` / `[type-*]`):**

- **Four tables, not one** (§3.1): `github_connections`, `watched_repos`, `signals` (raw),
  `signal_candidates` (scored). The decisive argument is `database-reviewer`'s, not the draft's:
  **Postgres RLS and GRANT are table-grained, not column-grained**, so a single table permitting the
  workflow's `status` UPDATE necessarily also permits an UPDATE that touches `body`. Two tables let
  `signals` be SELECT-only for `authenticated`. One-table-with-a-status-column is the named loser.
- **`UNIQUE (signal_id)` on `signal_candidates` is mandatory** (§3.4) — it was a `[db-BLOCKER]`. Without
  it `ON CONFLICT (signal_id)` has **no arbiter**, so every re-score silently inserts a duplicate
  candidate and the "re-score without re-fetching" property that justified two tables is gone.
- **`occurred_at` is denormalised onto `signal_candidates`** (§3.4, `[db-MAJOR-C]`). **Postgres cannot
  build a composite index spanning two tables**, so the feed's `score DESC, occurred_at DESC, id ASC`
  cannot be index-satisfied if `occurred_at` lives only on `signals`. Copy it at insert; refresh it on the
  same upsert whenever content changes.
- **`watched_repos.connection_id` and `signals.watched_repo_id` each need their own index** (§3.6,
  `[db-BLOCKER-C]`) — they were bare FKs in the draft, and the only unique index on `watched_repos` leads
  with `business_id`, which does not serve a `connection_id` lookup.
- **No DELETE policy on `watched_repos` for `authenticated`** (§3.5, `[db-MAJOR-D]`). `signals` cascades
  from `watched_repos`, so a user-triggered hard delete would silently annihilate the append-only signal
  history. **Unwatching is `is_active = false`.** Hard deletion is `purge_business`/service-role only.
- **`signals` is one row per `external_id`, mutable in CONTENT ONLY** (§3.3), protected by a narrow
  `BEFORE UPDATE` trigger permitting `title`, `body`, `content_hash`, `body_truncated`, `updated_at` and
  raising on `business_id`, `watched_repo_id`, `external_id`, `created_at`. ⚠️ **It is an UPDATE trigger.
  There is no `BEFORE DELETE` trigger on any of the four tables** — `purge_business` has no EXCEPTION
  block, and a raising `BEFORE DELETE` guard aborts GDPR erasure (`studio_drafts.sql:88-96` is the
  recorded precedent). Adding one is a BLOCKER-grade regression, not a hardening.
- **`installation_id` is a plain `bigint` column, NOT Vault** (§2.3). It grants nothing without the
  deployment private key, which never touches the database. **`github_connections` has no
  `vault_*_token_id` columns and that is correct** — the ADR states this explicitly as a tripwire, so
  transcribe the comment, not just the absence.
- **`GITHUB_APP_PRIVATE_KEY` is base64-encoded and validated at PARSE time**, not at first use (§2.2,
  `[sec-MEDIUM-5]`) — a `.refine()` proving it decodes to `-----BEGIN (RSA )?PRIVATE KEY-----`. Without
  it a mis-pasted key fails at the first tick, up to an hour later, inside a cron whose only output is one
  log line — the exact silent-failure shape L-11 forbids. Raw multi-line PEM is the named loser: every
  variable in `lib/config.ts` is a scalar `z.string()` and there is no PEM precedent anywhere.
- **Tokens are minted per tick and NEVER persisted** (§2.4). Two ephemeral tokens: the installation access
  token (~1h, in-process for that tick) and — A-1 — the **user access token, obtained once at
  install-callback time, used for exactly one call, then discarded**. `SIGNAL-NO-TOKEN-AT-REST`. **A
  Builder who stores the user token has broken the adjudication, not implemented it** (§0.2).
- ⚠️ **Steps 8–9 of ADR §8.3 are the security boundary, not optional hardening** (§8.2, §0.2). Verifying
  the installation *exists* answers **liveness, never authorization** — it cannot distinguish "this is
  mine" from "this exists somewhere". Only `GET /user/installations` under the user token proves the
  person completing the flow can administer the installation they are claiming. Omitting it ships the
  design `security-reviewer` proved exploitable (a stranger's private-repo release notes in the attacker's
  dashboard, plus a squatting DoS via first-write-wins on `UNIQUE (installation_id)`).
- **Idempotency is a UNIQUE INDEX, never an application check** (§4.3, `[db-B-i]`) —
  `UNIQUE (business_id, source, external_id)`, `external_id = 'github:release:{release_id}'`. A
  SELECT-then-INSERT is a textbook TOCTOU race. `23505` is counted as `duplicates`, not an error
  (CLAUDE.md's webhook rule applied to a poller). **The claim (§4.2) and the index are complementary, not
  redundant** — the index alone does not stop two overlapping runs racing to write `releases_etag`.
- **Edit detection is an ETag over page 1 of the releases list, NOT a `since` cursor** (§4.4).
  **GitHub's release object has no reliable `updated_at`**, so "releases newer than X" can never surface
  an edit to an older release. Stated bound, recorded as a decision: **edits beyond the 30 most recent
  releases are not detected**. First-ever poll ingests page 1 only, and only the last 90 days.
- **`last_poll_started_at` and `last_poll_completed_at` are SEPARATE columns** (§3.2,
  `[db-MODERATE-B-iii]`) — one combined `last_polled_at` cannot distinguish a crashed tick from a
  completed one, where the house `FOR UPDATE SKIP LOCKED` precedent self-heals immediately.
- **The watch-list cap (20 active repos) is enforced in the Server Action, not by a trigger** (§3.2). A
  `CHECK` cannot see sibling rows. It is a UX/cost guardrail, **not** a dedup or security boundary, so its
  small TOCTOU window is accepted — unlike §4.3's index, where the race genuinely matters.
- **The scoring formula is §6.1 verbatim**, and **`ageDays` is computed from a `now` value PASSED IN AS A
  PARAMETER**, never read inside the function. That single choice is what makes determinism testable
  rather than asserted. Ties are impossible by construction (`score DESC, occurred_at DESC,
  external_id ASC`). Persist every term in `score_inputs`.
- **Bot-authored releases are scored DOWN (−5), never filtered out** (§6.2) — a release cut by automation
  for a real version is still a real ship; Session 28's human triage is the right place for that judgment.
- **An edit updates in place and re-scores, upserted under
  `ON CONFLICT (signal_id) DO UPDATE … WHERE signal_candidates.status = 'new'`** (§6.4). The guard is
  race-free because the predicate is evaluated under the lock the UPDATE itself acquires. **A re-score can
  never resurrect a candidate a human has dismissed.**
- **TWO brands, both minted from a NON-EXPORTED `unique symbol` key** (§7.3): `UntrustedText` on
  `signals.title`/`signals.body`, minted only by the ingestion parser; `RenderedSignalText`, minted only
  by `wrapSignalForPrompt()`. ⚠️ **Do NOT reuse `RenderedEvidence`** (`lib/ai/wrap-evidence.ts:11`) — the
  guarantee it carries is *"re-fetched and tenant-scoped at render time"*, which is impossible for text
  already in hand. Reusing it bakes a **false provenance claim into a type**.
- **Sink narrowing is the load-bearing half, not the brand** (§7.3, `[type-*]`). Branding makes raw text
  loud; typing every prompt-builder parameter to the safe brand is what stops the path. **State the honest
  limit in the code comment: this is "discouraged", not "unrepresentable"** — `string & brand` is
  assignable to any template-literal hole. Reviewers caught this exact overclaim twice in prior sessions;
  the residual is closed by E2.10's source scans, not by a stronger type.
- **`wrapSignalForPrompt()` lives in `lib/ai/wrap-evidence.ts` and reuses `neutralizeWithSentinels()`**
  (§7.4). ⚠️ **Do NOT write a sixth local `sanitizeDataField`** — five weak copies already exist
  (`brief.ts:13`, `rubric.ts:9`, `post-generation.ts:7`, `post-regeneration.ts:8`,
  `formats/native-generation-prompt.ts:9`) and that is documented accepted debt, **not a pattern to
  extend**. Sanitise at READ, not at ingest — sanitise-at-ingest destroys fidelity for the human reader,
  cannot be re-run when the sanitizer improves, and is bypassed by the edit path (§7.2).
- **Contributor identity is stripped STRUCTURALLY, not by a runtime filter** (§5.3, §9.2) — the fields do
  not exist on the Insert type, so there is no check to forget. `author_is_bot` is a derived boolean and
  is the *only* author-adjacent thing retained. **A Session 28 card can say "shipped in v2.4"; it can
  never say "shipped by @someone", because the data does not exist to render.**
- **Reuse `CAPABILITIES.CONNECT_ACCOUNTS`** (§8.4). **No new capability** — ADR 0013's model is
  DB-enforced, so a new name is a migration plus an ADR 0013 amendment plus an app-layer echo. A new
  `manage_signals` is the named loser.
- **`connectGithubAction` is the L-8 plan-gating seam, by name** (§8.6). It exists in this session; the
  entitlement check does not. Gating in the poller's filter is the named loser (a downgrade would silently
  stop ingesting with no user-visible cause).
- **`@octokit/auth-app` + `@octokit/request`, both EXACT-pinned, no caret** (§10.3) — following
  `@upstash/qstash` (`package.json:39`), `date-fns-tz` (`:45`), `diff` (`:46`), against a house default of
  carets. **L-7 covers these two and nothing else.** Four endpoints total. `@octokit/rest` is rejected
  (hundreds of endpoint definitions for four calls); hand-rolled `fetch` is the argued loser.
- **Body cap 8,000 chars, truncated on a MULTIBYTE-SAFE boundary** (§5.4, `[sec-LOW-9]`), `body_truncated`
  set, `html_url` always retained and always rendered beside a truncated body. ⚠️ **The cap is a cost
  control, not a security control — a complete prompt-injection payload fits comfortably under it.** Do
  not present it as a defence.
- **Retention is 180 days, the reaper is DEFERRED (A-3), and the figure stays OUT of every customer-facing
  surface** (§9.5) — `/privacy`, marketing, in-product copy, support macros. A retention promise with no
  executor is a false statement to a regulator. `SIGNAL-RETENTION-UNCLAIMED` is what keeps this honest.
- **Exactly ONE structured-JSON `console.log` per tick invocation** (§4.6), on
  `lib/learning/orchestrator.ts:393`'s pattern, carrying §4.6's exact field list. **No `console.*`
  anywhere on the user-facing surface** (L-13). `date-fns` `formatISO` throughout.
- **Disconnect is four parts and does NOT call GitHub's uninstall API** (§2.5) — uninstalling is a
  **write** against the customer's account and L-5 is read-only forever. Already-ingested signals are
  **retained**. ⚠️ **The UI copy must tell the truth**: disconnecting in SOSH stops ingestion; full
  revocation means uninstalling the App in GitHub settings. Copy implying otherwise is forbidden by the
  ADR, because `is_active` is genuinely a weaker barrier than deleting a Vault secret (`[sec-HIGH-3]`).

**ECC specialists by step — SIX invocations for the whole Builder phase:**

| Step | Spine | Specialist | Why here — and why nowhere else |
|---|---|---|---|
| E2.0 | — (no code) | `ecc:code-explorer` ×1 | re-ground the ADR's ~40 `file:line` citations in one sweep; a drifted premise invalidates the step that depends on it |
| E2.1 | plan → tdd → verify | `database-reviewer` ×1 **+ the `supabase:supabase-postgres-best-practices` skill (free)** | four tables, seven indexes, two `UNIQUE` arbiters, an UPDATE trigger, four cascade rows — the entire DDL risk of the track is made here or not at all |
| E2.2 | plan → tdd → verify | **none, deliberately** | the `.refine()` is proved by a Tier-2 test that feeds it a truncated key; an advisory read cannot assert it more strongly |
| E2.3 | plan → tdd → verify | **none** — reviewed inside E2.8's single pass | the credential model and the callback are **one** threat model; splitting them across two `security-reviewer` calls is the Session 25 duplication the budget exists to stop |
| E2.4 | plan → tdd → verify | `ecc:type-design-analyzer` ×1 | the two brands + sink narrowing are the type-design core (ADR §7.3) and the place a prior session's overclaim would recur — the one step a type judgement is worth buying |
| E2.5 | plan → tdd → verify | **none, deliberately** | field-dropping is structural (absent from the Insert type), so the proof is a compile error plus a fixture assertion, not an opinion |
| E2.6 | plan → tdd → verify | **none, deliberately** | determinism is proved by same-set-twice **and** a shuffled copy; the upsert race is proved on live Postgres. Both are stronger than a read |
| E2.7 | plan → tdd → verify | **none, deliberately** | every failure class is already a named row in ADR §4.5 with a named operator-visible consequence and its own fixture case |
| E2.8 | plan → tdd → verify | `security-reviewer` ×1, scope = **E2.3 + E2.8 together** | tenant confusion at the install callback is the sharpest risk in the session (`[sec-BLOCKER-1]`), and it is inseparable from the credential model it consumes |
| E2.9 | plan → tdd → verify | **none** — `impeccable` + `taste-skill` skills (free) | a connect form, a repo picker, and four honest states (unavailable repo, revoked/reconnect, awaiting org approval, at-cap). The skills set the bar; the design-led session is still after Session 28 |
| E2.10 | plan → tdd → verify | **none, deliberately** | the four source scans ARE the enforcement; an agent reading them adds nothing a per-root vacuity guard does not already prove |
| E2.11 | verify only | `ecc:pr-test-analyzer` ×1 | does every one of the 33 `SIGNAL-*` constraints actually **execute** in a named CI job and **redden** if broken (ADR 0015's thesis) |

**Not in the step list, deliberately:** no `typescript-reviewer` (`ecc:type-design-analyzer` owns the type
surface — running both is duplication); no `cost-aware-llm-pipeline` (**Session 27 makes zero AI calls** —
there is nothing to cost); no `ecc:silent-failure-hunter` (every silent-skip candidate is a named row in
ADR §4.5 with a named counterpart — that table *is* the silent-failure audit, already done); no
`ecc:code-reviewer` sweep (its scope is the union of the three specialists already spent).

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 27 — Mode 3 Part 1: GitHub signal ingestion, BUILDER phase (Track E). You transcribe ADR 0020
into: one migration (four tables), the lib/config.ts GitHub App env surface, the lib/signals/ client
boundary, the untrusted-text types, the ingest parser, the Stage B scorer, the poller route, the connect +
install-callback flow, the watch-list surface, and the source scans — across twelve steps (E2.0…E2.11).
You are not the designer: ADR 0020 is authoritative, as scoped by session-27.md §0 / §0.1 / §0.2.

ECC BUDGET — SIX subagent invocations for this whole phase, one per named step only (session-27.md §2
table): E2.0 ecc:code-explorer, E2.1 database-reviewer, E2.4 ecc:type-design-analyzer, E2.8
security-reviewer (scope = E2.3 + E2.8 TOGETHER, one pass), E2.11 ecc:pr-test-analyzer. SEVEN steps carry
NO specialist BY DESIGN and each says why — do not add one. Do NOT invoke typescript-reviewer,
cost-aware-llm-pipeline, silent-failure-hunter or code-reviewer anywhere in this phase. Never re-consult
an agent to re-litigate an objection already folded in. Skills (/ecc:plan, /ecc:tdd-workflow,
/ecc:verification-loop, impeccable, taste-skill, supabase:supabase-postgres-best-practices) are free and
do not count against the budget.

Read now, before anything else:
- docs/decisions/0020-mode-3-signal-ingestion.md — the WHOLE ADR. §12's table of 33 SIGNAL-* constraints
  is your acceptance checklist; §11 is the test plan across the three tiers; §13 is the Session 28
  contract you must not break; §14 is the deferred boundary.
- docs/build-guide/session-27.md — the Reality block, §0 (Locked L-1..L-13 + the D-1..D-8 ledger), §0.1
  (the eight resolved questions), §0.2 (the THREE founder rulings — A-1 OAuth leg APPROVED and
  load-bearing, A-2 Evidence Pack a launch-BLOCKING follow-on, A-3 reaper deferred with a binding
  no-customer-facing-claim condition), and §2 (this section: the transcription list, the step list, the
  specialist table) — BINDING scope.
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three tiers. All four tables' RLS, cascade,
  purge coverage, both UNIQUE arbiters, the BEFORE UPDATE trigger and the upsert race are Tier-1
  (supabase/__tests__, LIVE Postgres, db-tests.yml); the scorer, parser, poller failure branches, ETag
  path, Zod guards, callback rejections and the four source scans are Tier-2 (app-tests.yml). "Covered" =
  executed green in CI, never "authored". SHARED-FUNCTION CALLERS: enumerate every caller of a shared
  function and state the covering test PER CALLER before marking any constraint tested.
- docs/decisions/0010-legal-surface.md Amendment 2 §D2.5 — four new cascade rows land in the SAME PR as
  the migration (CLAUDE.md, mandatory). A business-scoped table with no §D2.5 row is a silent GDPR leak.
- docs/decisions/0017-mode-2-upgrade.md §9 — the [DATA]-wrap / sanitizeDataField precedent your read-time
  guard follows, and the reason authorship-time sanitising was rejected there.
- CLAUDE.md — RLS + erasure-cascade rules, the three Supabase client roles, atomic conditional UPDATEs,
  bounded queries with explicit ORDER BY, Zod on all inputs, date-fns, no any, the worker console.*
  carve-out (ONE canonical tick line, and nothing on the user-facing surface), env only via lib/config.ts,
  DB only via lib/db/, the webhook-handler section (23505 = duplicate), and the UI Component patterns
  section (shadcn v4 is Base UI: NO asChild on Button or DropdownMenu primitives; Server Component page +
  Client form split; native <select> for static option sets).

Do NOT write code yet. Confirm these EIGHT grounding facts (a wrong one is a STOP — it means the ADR
drifted against the repo and the step depending on it must not be built until reconciled):
(1) campaigns.origin's CHECK already contains 'signal_generated' at
    supabase/migrations/20260722190000_mode2_brief_and_roles.sql:113-114. Cite it. This is WHY Stage F
    costs no migration in Session 27 OR Session 28, and why no origin change may appear in this diff.
(2) purge_business root-deletes at 20260702120700_purge_business_member_delete.sql:62 and has NO EXCEPTION
    block anywhere in its body; its explicit per-table lines exist only for Vault cleanup (:33-38), legal
    hold (:49-52) and identity deletion (:57). Cite each. This is WHY none of the four new tables gets a
    BEFORE DELETE trigger and WHY purge_business needs no edit.
(3) package.json has NO octokit / @octokit/* dependency, and pins @upstash/qstash (:39), date-fns-tz (:45)
    and diff (:46) EXACTLY while defaulting to carets (@anthropic-ai/sdk :23). Cite all four. L-7
    pre-authorises exactly TWO additions (@octokit/auth-app, @octokit/request); any third is a STOP.
(4) EVERY variable in lib/config.ts's serverSchema is a scalar z.string()-family entry with NO multi-line
    or PEM precedent anywhere in the file; parseServerEnv() fails fast; serverOnly() guards every getter.
    Cite the schema block, the parse function and the guard. This is WHY the private key is base64 with a
    parse-time .refine(), not a raw PEM.
(5) The capability constants are EXACTLY the six at lib/members/capabilities.ts:8-15 (author, reschedule,
    approve, connect_accounts, manage_members, manage_billing), and canServer's signature is at
    lib/members/can-server.ts:12-23. Cite both. This is WHY CONNECT_ACCOUNTS is reused and NO new
    capability is added (a new one is a migration + an ADR 0013 amendment).
(6) neutralizeWithSentinels() is exported at lib/ai/wrap-evidence.ts:117; RenderedEvidence's brand is at
    :11; wrapEvidenceForPrompt takes IDs and RE-FETCHES the rows itself, re-scoping by business_id at
    fetch time. Cite all three. This is WHY RenderedSignalText is a SEPARATE brand and reusing
    RenderedEvidence would bake a false provenance claim into a type. Also confirm the FIVE local
    sanitizeDataField copies still exist (brief.ts, rubric.ts, post-generation.ts, post-regeneration.ts,
    formats/native-generation-prompt.ts) — you are adding NO sixth.
(7) app/api/cron/capture-learning/route.ts verifies QStash under config.server.CRON_TRIGGER === 'qstash'
    with a timingSafeEqual bearer fallback; lib/learning/orchestrator.ts acquires service-role via the
    LAZY await import at :341-342 (inside the orchestrator, NOT the route), loops businesses with a
    per-business try/catch + Sentry.captureException at :354-377, and emits exactly ONE
    console.log(JSON.stringify({ kind: 'learning.tick', ... })) at :393. Cite each. This is the shape you
    reuse; inventing new scheduling machinery is a STOP (Reality §2).
(8) app/api/social/[platform]/callback/route.ts verifies the signed OAuth state, UUID-shape-checks the
    businessId, and re-fetches the business under the ANON RLS client; connect/route.ts and
    disconnect/route.ts each carry an authoritative app-layer user_can gate with the "runs service-role
    and bypasses RLS" comment. Cite the exact lines. You are arguing FROM this shape and ADDING the
    ownership proof it does not need and yours does (ADR §8.3 steps 8-9).
Output the eight findings + "Ready for E2.0." Then stop.
```

### §2b — Builder steps

#### E2.0 — Grounding pass: re-verify every ADR premise against the live repo  ·  no code, no commit

```
BUILDER — Session 27 · E2.0. NO CODE. Run ecc:code-explorer ONCE over the seams below and produce a
premise → file:line → still-true? table. ADR 0020 cites ~40 exact locations; if any has drifted, the step
that depends on it does not get built until the drift is reconciled and recorded here. This is your ONE
code-explorer invocation for the phase — ask for file:line and the shape of each seam, nothing else.

VERIFY these ADR premises specifically (each is load-bearing for a later step):
- §3.5/§3.6's house DDL form: the InitPlan RLS policies at 20260730100000_studio_drafts.sql:71-86, the
  partial-index pattern at :60-62, the generated content_hash at :26, and the NO-BEFORE-DELETE comment
  block at :88-96 with its purge_business reasoning at :94-96. You mirror all four.
- §3.7: purge_business's body (20260702120700:14-72, with :33-38, :49-52, :57, :62) and the ADR 0010 Amd 2
  §D2.5 table's exact bounds, column set and closing note — you insert FOUR rows in that same form.
- §4.1/§4.2: app/api/cron/capture-learning/route.ts's QStash verification block and
  lib/cron/qstash-auth.ts's verifyQStashRequest; lib/learning/orchestrator.ts:341-342 (lazy service-role),
  :354-377 (per-business containment), :393 (the single tick line); and the FOR UPDATE SKIP LOCKED claim
  RPC at 20260726010000_learning_capture.sql:231-246 — the mechanism §4.2 REJECTS for this table, with a
  named revival condition. Confirm you understand which you are building.
- §7.3/§7.4: lib/ai/wrap-evidence.ts — RenderedEvidence (:11), EVIDENCE_MAX_CHARS (:18), neutralize()
  (:83), neutralizeWithSentinels() (:117), and wrapEvidenceForPrompt's re-fetch-by-id signature. Report
  the ACTUAL line for the re-fetch: the ADR cites a range, and the brand argument at §7.3 depends on it
  genuinely re-fetching rather than accepting text.
- §7.3's honesty note: lib/db/social-accounts.ts's Row-type brand assertion and the recorded
  `as` cast the ADR names as caught-only-by-a-human. Confirm both still read as described.
- §8.3/§8.5: app/api/social/[platform]/connect/route.ts's app-layer user_can gate and its comment;
  callback/route.ts's state verification, UUID shape check and anon re-fetch; disconnect/route.ts's
  identical gate. Report the signOAuthState / verifyOAuthState module path and EVERY caller (§11.5's
  SHARED-FUNCTION CALLERS table starts here and you extend it if a third caller exists).
- §8.4: lib/members/capabilities.ts's six constants and the DB CASE in
  20260702120200_user_can.sql — confirm connect_accounts is enforced DB-side, not only echoed.
- §11.3: lib/learning/memory-table-boundary.test.ts's SCAN_ROOTS and its PER-ROOT vacuity guard (the
  Session 26-D MINOR-1 form — expect(files.length).toBeGreaterThan(0) per root, NOT in aggregate). This is
  the exact shape all four of E2.10's scans copy.
- §10.3: package.json's dependency block — confirm no octokit of any kind, and report the exact-pin
  convention verbatim so E2.3 follows it.
- §13.1: confirm lib/db/ has no signals/github module today and lib/signals/ does not exist. Mode 3 must
  be genuinely net-new surface; anything pre-existing here is a drift finding.

OUTPUT: the premise table, any drift found (with the affected step named), and "Ready for E2.1." Do NOT
commit. Then stop.
```

#### E2.1 — Migration: four tables + RLS + indexes + the UPDATE trigger + four §D2.5 rows  ·  ADR §3, §9.4  ·  SIGNAL-RLS-ISOLATED, -CASCADE-COMPLETE, -PURGE-COVERED, -RAW-IMMUTABLE-IDENTITY, -WEBHOOK-SEAM-CLEAN

```
BUILDER — Session 27 · E2.1. Migration + Tier-1 DB tests + the minimal lib/db/types.ts row types ONLY. No
helpers, no client, no route, no UI. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer ONCE and use the supabase:supabase-postgres-best-practices skill (free) WHILE authoring
— the whole DDL risk of this track is made here or not at all.

BUILD — supabase/migrations/<ts>_signal_ingestion.sql, EXACTLY per ADR §3:
- github_connections (§3.2): id, business_id FK CASCADE, installation_id bigint NOT NULL, account_login,
  is_active, connected_by, connected_at, last_poll_started_at, last_poll_completed_at, last_poll_status,
  rate_limited_until, created_at, updated_at. UNIQUE (business_id), UNIQUE (installation_id).
  ⚠️ last_poll_started_at and last_poll_completed_at are SEPARATE columns ([db-MODERATE-B-iii]) — one
  combined stamp cannot distinguish a crashed tick from a completed one.
  ⚠️ NO vault_*_token_id columns, and say so IN A COMMENT citing §2.3: no long-lived credential is ever
  persisted by this design, and that comment is the tripwire if a future change introduces one.
- watched_repos (§3.2): id, business_id FK CASCADE, connection_id FK CASCADE, repo_id bigint (GitHub's
  IMMUTABLE numeric id — a rename must not orphan the row), owner, name, is_active, releases_etag,
  last_polled_at, weight (0..10, DEFAULT 10 — constant in v1, §6.1), added_by, created_at, updated_at.
  UNIQUE (business_id, repo_id).
- signals (§3.3): id, business_id FK CASCADE, watched_repo_id FK CASCADE, source CHECK IN ('github'),
  kind CHECK IN ('release'), external_id, title, body CHECK (length(body) <= 8000), body_truncated,
  html_url, occurred_at, is_prerelease, author_is_bot, ingested_via CHECK IN ('poll','webhook')
  DEFAULT 'poll', content_hash GENERATED over title || body on the studio_drafts.sql:26 precedent,
  created_at, updated_at. UNIQUE (business_id, source, external_id).
  ⚠️ CHECK constraints on source, kind AND length(body) — not just on ingested_via ([db-MINOR]:
  inconsistent enum-hardening on adjacent columns in the same DDL). The length CHECK is defence-in-depth
  behind the app cap: this is explicitly untrusted third-party text.
- signal_candidates (§3.4): id, business_id FK CASCADE, signal_id FK CASCADE, score CHECK (score >= 0),
  score_inputs jsonb, occurred_at, status CHECK IN ('new') — ADR 0021 widens it, you do not —
  created_at, updated_at. ⚠️ UNIQUE (signal_id) — this was a [db-BLOCKER]: without it ON CONFLICT
  (signal_id) has no arbiter and every re-score silently duplicates. ⚠️ occurred_at is DENORMALISED here
  ([db-MAJOR-C]) because Postgres cannot index across two tables and the feed's ORDER BY spans both.
- The BEFORE UPDATE trigger on signals (§3.3): permits title, body, content_hash, body_truncated,
  updated_at; RAISES on business_id, watched_repo_id, external_id, created_at.
  ⚠️ BEFORE **UPDATE** — there is NO BEFORE DELETE trigger on ANY of the four tables, for the reason
  recorded at studio_drafts.sql:88-96: purge_business has no EXCEPTION block and a trigger cannot tell an
  FK-cascade delete from a direct one, so a guard would abort GDPR erasure. Do not add one, in any form.
- RLS ENABLE on all four + policies in the InitPlan form
  `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` copied from
  studio_drafts.sql:71-86, WITH CHECK on every INSERT and UPDATE policy. Per ADR §3.5's table:
  github_connections SELECT only; watched_repos SELECT + INSERT + UPDATE and ⚠️ NO DELETE POLICY
  ([db-MAJOR-D]: signals cascade from watched_repos, so a user hard-delete would annihilate the signal
  history — unwatching is is_active = false); signals SELECT only; signal_candidates SELECT only.
  Pair the absent write policies with an explicit GRANT SELECT … TO authenticated and NO write grant
  ([db-D]) so read-only is enforced at two independent layers, not by the absence of something.
- The seven indexes of §3.6 exactly, including ⚠️ watched_repos (connection_id) and signals
  (watched_repo_id) — both were bare FKs in the draft ([db-BLOCKER-C]) and the only unique index on
  watched_repos leads with business_id, which does not serve a connection_id lookup.
- Backfill: NONE. State it in the migration comment with its reason (L-13 requires the statement).
- docs/decisions/0010-legal-surface.md Amd 2 §D2.5: add the FOUR rows of ADR §3.7 VERBATIM, in the same
  five-column form, before the closing note. Carry the exact "no Vault secret exists to delete" and
  "contributor identity fields are never stored" wording — those clauses are the ADR's argument for why no
  purge_business edit is needed. A business-scoped table with no §D2.5 row is a STOP.
- lib/db/types.ts: Row/Insert/Update types for all four. ⚠️ The Insert type for signals DOES NOT CONTAIN
  author.login / author.id / author.avatar_url / author.html_url / author_association / assets /
  reactions / mentions_count / tarball_url / zipball_url — dropping is STRUCTURAL, not a runtime filter
  (§5.3). business_id is excluded from every Update type (tenancy-critical); content_hash is read-only.
- purge_business is NOT edited (§3.7 — the root DELETE at :62 cascades). Confirm, do not change.

TESTS — supabase/__tests__/signals-schema.test.ts, Tier-1, LIVE Postgres (house style: the service-role
admin client typed any with the adjacent eslint-disable, per CLAUDE.md's named carve-out):
- SIGNAL-RLS-ISOLATED, ⚠️ MIRRORED IN BOTH DIRECTIONS with a real signed-in owner-B session — the Session
  26-D MINOR-2 precedent; a one-directional test misses half the matrix. Per table. Plus the UPDATE WITH
  CHECK tenant-tunnelling attempt on watched_repos, and the ABSENCE of a DELETE policy on watched_repos
  for authenticated.
- ⚠️ SIGNAL-CASCADE-COMPLETE + SIGNAL-PURGE-COVERED: deleting the business COMPLETES WITHOUT ERROR and
  removes rows from all four; purge_business on a business with all four populated COMPLETES WITHOUT ERROR
  and leaves none. Assert SUCCESS, not merely absence — a rows-are-gone assertion inside an
  already-aborting transaction is never reached.
- SIGNAL-INGEST-IDEMPOTENT: 23505 on UNIQUE (business_id, source, external_id).
- SIGNAL-CALLBACK-TENANT-BOUND (the squatting arm): 23505 on UNIQUE (installation_id) across two
  businesses.
- UNIQUE (signal_id) on signal_candidates exists and rejects a second candidate — this proves §3.4's
  upsert arbiter exists at all.
- SIGNAL-RAW-IMMUTABLE-IDENTITY: the BEFORE UPDATE trigger RAISES on external_id and on business_id, and
  PERMITS a body/title/content_hash change.
- SIGNAL-BODY-CAPPED (the DB half): the length(body) CHECK rejects 8001 characters.

VERIFY: apply the migration; npm run test:db over the new suite — Tier-1 proofs must EXECUTE against real
Postgres (a pg_policies read or a mocked client is NOT coverage, ADR 0015 §2) and the suite must report a
NON-ZERO executed count. Feed database-reviewer's findings back in; fix before commit. Do NOT re-consult
it. On commit: "E2.1 complete — four tables (github_connections, watched_repos, signals,
signal_candidates) with InitPlan RLS, no DELETE policy on watched_repos, UNIQUE (signal_id) arbiter,
denormalised occurred_at, both FK indexes, BEFORE UPDATE identity trigger and NO BEFORE DELETE trigger
anywhere, four §D2.5 cascade rows verbatim, purge_business unedited (SIGNAL-RLS-ISOLATED,
-CASCADE-COMPLETE, -PURGE-COVERED, -RAW-IMMUTABLE-IDENTITY, -INGEST-IDEMPOTENT, ADR 0020 §3);
N Tier-1 tests green on live Postgres incl. mirrored both-direction isolation and erasure-SUCCEEDS;
database-reviewer clean." Then stop.
```

#### E2.2 — `lib/config.ts`: the GitHub App env surface + parse-time key validation  ·  ADR §2.2  ·  SIGNAL-CONFIG-ONLY-ENV

```
BUILDER — Session 27 · E2.2. The typed env surface, and nothing else. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. NO specialist BY DESIGN: the property here is proved by a test that feeds the
schema a truncated key and asserts parse failure — strictly stronger than an advisory read.

BUILD — lib/config.ts serverSchema, five new variables (§2.2):
- GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET.
  All scalar z.string() entries, matching every existing variable in the file, all reached through the
  existing serverOnly() getters.
- ⚠️ GITHUB_APP_PRIVATE_KEY is BASE64-ENCODED and carries a .refine() proving it base64-decodes to a
  string matching -----BEGIN (RSA )?PRIVATE KEY-----. Validated AT PARSE TIME, not at first use
  ([sec-MEDIUM-5]): without it a truncated or mis-pasted key fails at the FIRST POLLER TICK, up to an hour
  later, inside a background cron whose only output is one structured log line — exactly the silent
  failure L-11 forbids. This preserves parseServerEnv()'s existing fail-fast contract.
- Raw multi-line PEM is the named LOSER: no multi-line/PEM precedent exists anywhere in the file, and PEM
  newlines in env vars are a well-known operational trap. Deferring the decode into lib/signals/ is the
  other loser (it breaks fail-fast). Record both in a comment.
- .env.local.example: add all five with a comment stating the base64 encoding and how to produce it.
- ⚠️ NO process.env.GITHUB* anywhere else, ever — E2.10 scan #3 enforces it.
- Do NOT add a webhook secret. L-3 builds no webhook route this session, and a secret with no consumer is
  a config surface pretending to be a feature.

TESTS — lib/config.test.ts (or the existing config suite), Tier-2:
- A valid base64-encoded PEM parses.
- A truncated / non-base64 / base64-of-not-a-PEM value FAILS parse with a named error. Three cases.
- The serverOnly guard still throws for these keys when window is defined.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app.
On commit: "E2.2 complete — five GITHUB_APP_* variables typed in lib/config.ts with a parse-time
.refine() rejecting a malformed base64 private key (SIGNAL-CONFIG-ONLY-ENV, ADR §2.2 / [sec-MEDIUM-5]);
raw-PEM and deferred-decode recorded as losers; no webhook secret added (L-3)." Then stop.
```

#### E2.3 — `lib/signals/`: the client boundary, App auth, and the four endpoints  ·  ADR §2.4, §5.4, §10  ·  SIGNAL-NO-TOKEN-AT-REST, -READ-ONLY-GITHUB, -NO-PROVIDER-COUPLING, -POLL-CONDITIONAL

```
BUILDER — Session 27 · E2.3. The one module that may import a GitHub client. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. NO specialist on this step — security-reviewer reads E2.3 and
E2.8 TOGETHER in E2.8's single pass, because the credential model and the callback that consumes it are
one threat model (splitting them is exactly the duplication the budget forbids).

BUILD:
- package.json: add "@octokit/auth-app" and "@octokit/request" — EXACT versions, NO CARET, following
  @upstash/qstash (:39), date-fns-tz (:45) and diff (:46). L-7 pre-authorises THESE TWO and nothing else;
  any third new dependency is a STOP. If the installed latest differs from the ADR's assumption, pin THE
  VERSION YOU ACTUALLY INSTALL and record it in ADR §10.3 — do NOT widen the range.
- lib/signals/index.ts — the ONLY public surface. ⚠️ No code outside lib/signals/ ever imports @octokit/*
  (§10.1, the same sentence shape as CLAUDE.md's /lib/social/ and /lib/ai/ rules). Business logic talks to
  the signal-source interface, never to Octokit.
- ⚠️ lib/config.ts gains FOUR GitHub keys, all REQUIRED, all validated at parse time: the App id, the
  base64 private key, AND the OAuth `client_id` / `client_secret` the install callback's §8.3 step 8 needs.
  The last two are load-bearing and easy to omit — a Builder who reads L-2's "not an OAuth App" as "no
  OAuth leg" simply never adds them, and nothing complains until review. Making them REQUIRED means that
  drift fails at boot, which is where it should fail. See E2.8's A-1 warning: this is the same ruling.
- lib/signals/github-client.ts — App JWT (RS256 over the base64-decoded key from lib/config.ts) →
  POST /app/installations/{id}/access_tokens. ⚠️ Minted PER TICK, held in process memory for that tick,
  NEVER persisted, never written to any table, never cached across ticks (§2.4). Persist-with-expiry is
  the named loser: it reintroduces the long-lived-credential-at-rest problem the App model exists to
  avoid, to save one request per hour per installation.
- The FOUR endpoints, and only these four (§10.3): POST /app/installations/{id}/access_tokens,
  GET /repos/{owner}/{repo}/releases, GET /user/installations, GET /installation/repositories.
  ⚠️ ZERO write methods against api.github.com, on any resource, ever (L-5, SIGNAL-READ-ONLY-GITHUB).
- The releases read is CONDITIONAL: page 1, per_page=30, If-None-Match from watched_repos.releases_etag;
  a 304 short-circuits the repo for the cost of one free request and the ETag is persisted on 200 (§4.4).
  ⚠️ NOT a `since` cursor — GitHub's release object has NO reliable updated_at, so "newer than X" can
  never surface an edit to an older release. That is the whole reason for the ETag mechanism; put it in a
  comment so nobody "optimises" it back.
- Typed error mapping for the §4.5 failure classes: 401 (revoked), 403 + Retry-After (rate limited), 404
  (repo gone), 5xx (transient). Parse Retry-After; do not guess a backoff.
- Server-only, mandatorily. Nothing here may be reachable from a Client Component.
- ⚠️ SocialProvider is NOT touched, not extended, not imported (§10.2). It is the PUBLISHING surface; a
  read-only signal source is a category error there. lib/social/** shows zero diff in this range.

TESTS — lib/signals/github-client.test.ts (Tier-2), against fixtures in lib/signals/__fixtures__/github/
(the directory ADR §11.2 names; follow the lib/ai/__fixtures__/ convention):
- SIGNAL-POLL-CONDITIONAL: If-None-Match is sent when an ETag exists; a 304 short-circuits and does NOT
  parse a body; a 200 persists the new ETag.
- Each error class maps to its typed error, with Retry-After parsed from the 403 fixture.
- SIGNAL-NO-TOKEN-AT-REST (the unit half): the mint path returns a value that no code path writes to a
  client, a table, or a log. Assert by construction — the function returns it, the caller scopes it.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app.
On commit: "E2.3 complete — lib/signals/ boundary with @octokit/auth-app + @octokit/request exact-pinned
(L-7's two pre-authorised additions), per-tick installation tokens never persisted, four read-only
endpoints, ETag-over-page-1 conditional requests with the no-reliable-updated_at rationale recorded
(SIGNAL-NO-TOKEN-AT-REST, -READ-ONLY-GITHUB, -POLL-CONDITIONAL, ADR §2.4/§4.4/§10); SocialProvider
untouched." Then stop.
```

#### E2.4 — The untrusted-text types + `wrapSignalForPrompt` + the `lib/db/` modules  ·  ADR §7, §13.1  ·  SIGNAL-RAW-TEXT-UNTRUSTED, -PROMPT-SINK-NARROWED, -NO-SIXTH-SANITIZER, -BRAND-LIMIT-DEMONSTRATED

```
BUILDER — Session 27 · E2.4. The type surface Session 28's safety rests on. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke ecc:type-design-analyzer ONCE with one question: "can
raw ingested signal text reach a prompt-assembly parameter without passing through wrapSignalForPrompt, by
code that does not cast?" Do not ask it anything a test already answers; do not re-consult it.

BUILD:
- The TWO brands (§7.3), both keyed on a NON-EXPORTED `unique symbol` (the ADR 0019 §8.4 precedent — it
  closes the object-literal forgery path a string-literal brand leaves open and leaves no grep trace):
    UntrustedText      — on signals.title / signals.body, minted ONLY by E2.5's ingestion parser
    RenderedSignalText — minted ONLY by wrapSignalForPrompt()
  ⚠️ Do NOT reuse RenderedEvidence (lib/ai/wrap-evidence.ts:11). The guarantee that brand carries is
  "re-fetched and tenant-scoped at render time" — wrapEvidenceForPrompt takes IDs and re-fetches. Signal
  text is text already in hand; no re-fetch and no tenant re-check is possible. Reusing the name would
  bake a FALSE PROVENANCE CLAIM into a type, which is the exact class of error branding exists to prevent.
- wrapSignalForPrompt() in lib/ai/wrap-evidence.ts, ALONGSIDE wrapEvidenceForPrompt, reusing
  neutralizeWithSentinels() (:117) and a hard length cap. ⚠️ Do NOT write a sixth local sanitizeDataField:
  five weak copies already exist (brief.ts:13, rubric.ts:9, post-generation.ts:7, post-regeneration.ts:8,
  formats/native-generation-prompt.ts:9) and that is documented accepted debt, NOT a pattern to extend
  (lib/studio/guard.ts already forbids a sixth). One module owns prompt safety; two honest provenance
  types live in it.
- ⚠️ THE HONEST LIMIT, in the code comment, not only in the ADR: this is "discouraged", NOT
  "unrepresentable". `string & brand` is assignable to any string parameter and — decisively — to any
  template-literal hole; `` `Context:\n${signal.body}` `` compiles with no error, brand or no brand. A bare
  `as RenderedSignalText` cast remains compile-legal. The residual is closed by E2.10's source scans, not
  by a stronger type. Reviewers caught this exact overclaim TWICE in prior sessions — do not restate the
  guarantee more strongly than §7.3 does.
- lib/db/github-connections.ts, watched-repos.ts, signals.ts, signal-candidates.ts — the ONLY modules that
  touch these four tables. Every list query BOUNDED with an explicit ORDER BY matching an E2.1 index
  EXACTLY (L-13, including the poller's own claim query — a service-role caller gets no exception).
  ⚠️ Query functions RETURN THE BRANDED row type, so the brand originates at the data-access boundary
  rather than being applied ad hoc by callers (§7.4).
- listNewCandidates(client, businessId, limit) in lib/db/signal-candidates.ts — the EXACT signature ADR
  §13.1 promises Session 28. Filter business_id + status = 'new'; ORDER BY score DESC, occurred_at DESC,
  id ASC; default limit 50. Do not rename it later; ADR 0021 builds against this name.
- Service-role functions acquire their own client via the lazy await import pattern and take no client
  parameter (CLAUDE.md); every service-role read/write states an EXPLICIT business_id predicate (§3.5).
  date-fns formatISO for every app-layer timestamp.

TESTS — Tier-2:
- SIGNAL-PROMPT-SINK-NARROWED: an @ts-expect-error compile assertion proving a raw UntrustedText value is
  rejected where RenderedSignalText is required. Verify it genuinely fails to compile by reading it.
- ⚠️ SIGNAL-BRAND-LIMIT-DEMONSTRATED — the anti-overclaim test, DIRECTLY BESIDE the one above. Two cases
  that COMPILE CLEANLY and are asserted to do so: (a) `` `Context:\n${signal.body}` `` in a template hole,
  (b) a bare `as RenderedSignalText` cast. The point is not to test TypeScript; it is to make the honest
  limit an EXECUTED, PASSING assertion rather than a comment describing one. A comment can be quietly
  strengthened by a later session — Sessions 24 and 25 were both caught doing exactly that, and F4 rates
  it a MAJOR, but F4 fires only AFTER the overclaim is already in the tree. This test fires before.
  Name the pair in one describe block so a reader sees the guarantee and its limit together, and put a
  comment on the file saying that is why they are adjacent.
- wrapSignalForPrompt neutralizes a [/DATA] closer and a fence, and applies the cap.
- No sixth sanitizeDataField exists under lib/signals/** or in the new wrap function (assert by scan here;
  E2.10 makes it a standing source scan).
- Each db module: bounded limit applied, ORDER BY matches the index, business_id predicate present.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. Fold type-design-analyzer's objections in
before commit; record any you reject and why.
On commit: "E2.4 complete — UntrustedText / RenderedSignalText on non-exported unique-symbol brands
(RenderedEvidence deliberately NOT reused: its guarantee is re-fetch-and-rescope, which signal text cannot
satisfy), wrapSignalForPrompt in lib/ai/wrap-evidence.ts reusing neutralizeWithSentinels with no sixth
sanitizeDataField, sink narrowing with the discouraged-not-unrepresentable limit stated in-code, four
lib/db/ modules with bounded + index-matching queries and listNewCandidates at §13.1's exact signature
(SIGNAL-RAW-TEXT-UNTRUSTED, -PROMPT-SINK-NARROWED, -NO-SIXTH-SANITIZER, ADR §7/§13)." Then stop.
```

#### E2.5 — The ingest parser: Zod, structural field-dropping, multibyte-safe truncation  ·  ADR §5  ·  SIGNAL-NO-CONTRIBUTOR-IDENTITY, -BODY-CAPPED, -CALLBACK-VALIDATED (payload arm)

```
BUILDER — Session 27 · E2.5. The only place a GitHub payload becomes a SOSH row. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. NO specialist BY DESIGN: field-dropping here is STRUCTURAL —
the fields do not exist on the Insert type — so the proof is a compile error plus a fixture assertion, not
an opinion.

BUILD — lib/signals/parse-release.ts:
- Zod safeParse over the GitHub release object. A parse failure is a per-item skip that CONTINUES the
  repo (§4.5's `malformed` row), never a thrown tick.
- ⚠️ Published releases ONLY, one kind (§5.1). Drafts are never ingested — a draft is by definition not
  published, and L-9's posture is that SOSH surfaces what the customer already chose to make public. No
  tags, no merged PRs, NO COMMITS, no CHANGELOG.md — each exclusion is argued at §5.2 and each is a scope
  breach if it appears.
- RETAINED (§5.3): external_id ('github:release:{release_id}'), repo_id, tag_name, title, body,
  body_truncated, html_url, occurred_at (from published_at), is_prerelease, author_is_bot.
- ⚠️ author_is_bot is a BOOLEAN DERIVED from author.type === 'Bot' at ingest. It is a property of the
  RELEASE, not an identity. It is the only author-adjacent value that survives.
- ⚠️ DROPPED STRUCTURALLY, not filtered: author.login, author.id, author.node_id, author.avatar_url,
  author.html_url, author_association, reactions, assets[] (each asset carries an uploader identity),
  mentions_count, tarball_url, zipball_url. These fields DO NOT EXIST on the Insert type (E2.1), so
  omitting them is not a runtime check that can be forgotten. This is L-9's preferred answer applied
  literally: where the honest answer is "strip at ingest and never store it", that is the answer.
- ⚠️ NO regex-stripping of @-handles from the body (§9.2's named loser): unreliable over prose, and it
  corrupts the very text the human reviewer must read in Session 28's card. The body is retained VERBATIM
  under Art. 6(1)(f), with the balancing test tracked as A-2's launch-blocking follow-on.
- Truncation to 8,000 characters on a MULTIBYTE-SAFE boundary ([sec-LOW-9]) — never mid-UTF-8-sequence.
  Set body_truncated; always retain html_url. ⚠️ Comment that the cap is a COST/payload control, NOT a
  security control: a complete prompt-injection payload fits comfortably under 8,000 characters, and E2.4's
  read-time guard — not this cap — is the defence.
- content_hash is computed by the DB (E2.1's generated column); the parser does not forge one.
- The parser is the ONLY minter of UntrustedText (E2.4).

TESTS — lib/signals/parse-release.test.ts (Tier-2), against lib/signals/__fixtures__/github/:
- release-valid.json → every retained field mapped; ⚠️ assert EVERY dropped field is ABSENT from the
  produced object, field by field (SIGNAL-NO-CONTRIBUTOR-IDENTITY).
- release-bot.json → author_is_bot true, and no author identity retained.
- release-draft.json → not ingested.
- release-oversized-body.json → truncated at the cap, body_truncated true, ⚠️ and the final character is a
  complete code point (construct the fixture so a naive slice would split a surrogate pair).
- malformed-release.json → safeParse fails, one item skipped, the caller continues.
- release-edited.json → same external_id as release-valid.json, different content (E2.6 consumes it).

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app.
On commit: "E2.5 complete — release-only Zod parser; contributor identity dropped STRUCTURALLY (absent
from the Insert type, ten fields asserted absent), author_is_bot derived as a release property,
multibyte-safe truncation at 8,000 with the cap documented as a cost control and not a security control,
body retained verbatim with regex-stripping recorded as the loser (SIGNAL-NO-CONTRIBUTOR-IDENTITY,
-BODY-CAPPED, ADR §5)." Then stop.
```

#### E2.6 — Stage B: the deterministic scorer, dedup, and the guarded upsert  ·  ADR §6  ·  SIGNAL-SCORING-DETERMINISTIC, -DEDUP-STABLE-ON-EDIT, -NO-EMBEDDINGS

```
BUILDER — Session 27 · E2.6. The half of Mode 3 that is supposed to be exactly testable. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. NO specialist BY DESIGN: determinism is proved by same-set-
twice PLUS a shuffled copy, and the upsert race is proved on live Postgres — both strictly stronger than
an advisory read.

BUILD — lib/signals/score.ts:
- ⚠️ The formula EXACTLY as ADR §6.1, integer 0-100:
    score = recency + substance + kindWeight + repoWeight + humanAuthored
    recency       = floor(40 × max(0, 1 − ageDays / 14))
    substance     = floor(30 × clamp(bodyLen / 1200, 0, 1))
    kindWeight    = 15                         // one kind in v1; a TERM, not folded into a base (§6.6)
    repoWeight    = watched_repos.weight       // 0..10, constant 10 in v1
    humanAuthored = author_is_bot ? 0 : 5
- ⚠️ `now` is a PARAMETER, never read inside the function. That single choice is what makes determinism
  testable rather than asserted. A Date.now() inside this function is a defect even though every test
  would still pass on the day it was written.
- Persist every term in score_inputs (jsonb) so a later tuning session can see WHY a candidate scored what
  it did without re-deriving it.
- ⚠️ Bot releases are scored DOWN (−5 via humanAuthored), NEVER filtered out (§6.2) — a release cut by
  automation for a real version is still a real ship, and Session 28's human triage is the right place for
  that judgment. A hard filter on author_is_bot is the named loser.
- Total order: score DESC, occurred_at DESC, external_id ASC. Ties are impossible by construction.
- Clustering: ⚠️ EXACTLY ONE candidate per raw signal (§6.5). With commits excluded there is nothing to
  cluster in v1; "one candidate per release with its commits as supporting detail" presupposes ingesting
  commits, which §5.2 rejects on privacy grounds. Deferred with its revival condition named.
- ⚠️ NO embeddings, NO pgvector, NO similarity threshold, NO LLM anywhere in this file or its imports
  (L-6, D-5). GitHub supplies stable identity for free, so dedup is an EXACT KEY.
- The upsert (§6.4): ON CONFLICT (signal_id) DO UPDATE … WHERE signal_candidates.status = 'new'. The
  guard is race-free because the predicate is evaluated under the lock the UPDATE itself acquires.
  ⚠️ A re-score can NEVER resurrect a candidate a human has dismissed. Refresh the denormalised
  occurred_at on the same statement.
- Edit handling: same external_id + different content_hash → update the signal's content columns in place
  (E2.1's trigger permits exactly those) and re-score. Re-ingesting as a second row and ignoring the edit
  are both named losers (§6.4).

TESTS:
- Tier-2 (lib/signals/score.test.ts): ⚠️ SIGNAL-SCORING-DETERMINISTIC — run the scorer twice over the same
  fixture set AND once over a SHUFFLED copy, asserting an identical ORDERED result all three times. Plus
  each term at its boundaries (age 0 / 14 / 15 days; bodyLen 0 / 1200 / 5000; bot vs human).
- Tier-2: SIGNAL-DEDUP-STABLE-ON-EDIT (the key half) — release-edited.json produces the SAME external_id
  as release-valid.json, proving the numeric release id is stable across a title/body/tag edit.
- ⚠️ Tier-1 (extend supabase/__tests__/signals-*.test.ts, LIVE Postgres): a concurrent re-score against a
  candidate transitioned out of 'new' does NOT resurrect it — the second committer either updates a row
  still 'new' or no-ops. One race proved is not the guard proved; prove this one specifically.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db (non-zero executed count).
On commit: "E2.6 complete — the §6.1 formula verbatim with `now` as a parameter, score_inputs persisted,
bots scored down not filtered, one candidate per signal, exact-key dedup with no embeddings, and the
ON CONFLICT (signal_id) … WHERE status='new' upsert proved on live Postgres to never resurrect a dismissed
candidate (SIGNAL-SCORING-DETERMINISTIC, -DEDUP-STABLE-ON-EDIT, -NO-EMBEDDINGS, ADR §6)." Then stop.
```

#### E2.7 — The poller: route, orchestrator, claim, failure table, tick log  ·  ADR §4  ·  SIGNAL-INGEST-IDEMPOTENT, -FAILURE-ISOLATED, -TICK-OBSERVABLE, -REVOCATION-DETECTED

```
BUILDER — Session 27 · E2.7. Stage A end to end. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. NO specialist BY DESIGN: every failure class is already a named row in ADR §4.5
with a named operator-visible consequence and its own fixture case — that table IS the silent-failure
audit, and it was done in the ADR.

BUILD:
- app/api/cron/signals-poll/route.ts — ⚠️ REUSE the existing shape, invent no scheduling machinery
  (Reality §2): verifyQStashRequest(request) under config.server.CRON_TRIGGER === 'qstash' with the manual
  timingSafeEqual bearer fallback, identical to app/api/cron/capture-learning/route.ts. Service-role is
  acquired INSIDE the orchestrator via the lazy await import (lib/learning/orchestrator.ts:341-342) — the
  newer of the two variants, NOT publish's.
- lib/signals/orchestrator.ts — ⚠️ ONE QStash message per tick that LOOPS businesses, mirroring
  lib/learning/orchestrator.ts:354-377 exactly: per-business try/catch, Sentry.captureException per
  business, failure counter in the tick summary. One business's revoked installation, rate limit or
  malformed payload CANNOT abort the loop for the others (L-11, SIGNAL-FAILURE-ISOLATED). One message per
  business is the named loser.
- HOURLY cadence, matching capture-learning. The rate defence is §2.4's arithmetic: ≤21 calls/hour against
  a 5,000/hour PER-INSTALLATION budget, 304s free. Put the arithmetic in a comment — a cadence with no
  stated defence invites someone to "just make it 15 minutes".
- The claim (§4.2): an ATOMIC conditional UPDATE setting last_poll_started_at = now() WHERE is_active
  AND (last_poll_started_at IS NULL OR last_poll_started_at < now() - interval '50 minutes'), RETURNING
  the claimed rows. Never read-then-update. Bounded, ORDER BY last_poll_started_at ASC NULLS FIRST, with
  an explicit LIMIT matching E2.1's index. ⚠️ Record §4.2's revival condition in a comment: if an
  out-of-band "poll now" or backfill trigger is ever added, this watermark is the wrong mechanism and must
  become the learning_capture.sql:231-246 FOR UPDATE SKIP LOCKED claim.
- ⚠️ Poller exclusion of a disconnected connection is STRUCTURAL, not a branch: the claim query filters
  is_active = true, so a disconnected connection is not skipped by a code path that could be forgotten —
  it is not selected (§2.5).
- Idempotency is E2.1's UNIQUE INDEX. Catch 23505 and count it as `duplicates`, NOT as an error
  (CLAUDE.md's webhook rule applied to a poller). ⚠️ Comment that the index and the claim are
  COMPLEMENTARY, not redundant: the index alone does not stop two overlapping runs racing to write
  releases_etag (§4.3).
- ⚠️ THE FAILURE TABLE — implement ADR §4.5 row for row, each with its OPERATOR-VISIBLE consequence:
  401/revoked → is_active = false + last_poll_status = 'revoked' + `revoked` count + Sentry + the UI
  reconnect state; 403 + Retry-After → set rate_limited_until, skip this tick, NO deactivation,
  `rateLimited` count; 404 → watched_repos.is_active = false with the reason, `notFound` count + the repo
  shown "unavailable"; 5xx → `failed` count, retry next tick, no state change; malformed → skip the item,
  continue the repo, `malformed` count + Sentry ⚠️ WITH THE REPO ID AND NEVER THE BODY (untrusted text
  into logs is its own vector, §7). A silent skip with no counterpart is the failure mode this table
  exists to reject.
- SIGNAL-REVOCATION-DETECTED: a 401 or 404 while minting auto-deactivates, so a customer who uninstalls on
  GitHub's side is reflected in SOSH within one tick, without a webhook (§2.5).
- ⚠️ EXACTLY ONE console.log(JSON.stringify({ kind: 'signals.tick', ...summary })) per invocation
  (lib/learning/orchestrator.ts:393's pattern), carrying §4.6's EXACT field list: kind, tick, triggeredBy,
  durationMs, connectionsClaimed, reposPolled, notModified, signalsIngested, signalsUpdated, duplicates,
  candidatesUpserted, revoked, rateLimited, notFound, malformed, failed. No console.* anywhere else.
- Stage B (E2.6) runs inside the same tick, after ingestion, per business.
- ⚠️ ZERO imports of @/lib/ai/* or @anthropic-ai/sdk in this file or anything under lib/signals/ (L-1).
  E2.10 makes that executable.

TESTS — lib/signals/orchestrator.test.ts (Tier-2), plus a Tier-1 claim test:
- SIGNAL-FAILURE-ISOLATED: a business whose fetch throws does NOT prevent the next business from being
  polled, and the tick summary counts it. Each §4.5 row as ITS OWN case against its named fixture.
- SIGNAL-INGEST-IDEMPOTENT (app half): a retried delivery over the same fixture ingests zero new rows and
  increments `duplicates`; an overlapping run does not double-write.
- SIGNAL-POLL-CONDITIONAL: a 304 increments notModified and performs no writes.
- SIGNAL-REVOCATION-DETECTED: the 401 fixture flips is_active false and sets last_poll_status.
- SIGNAL-TICK-OBSERVABLE: exactly ONE console.log per invocation and ALL §4.6 fields present.
- Tier-1 (LIVE Postgres): the claim's conditional UPDATE under concurrency claims a connection exactly
  once.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db.
On commit: "E2.7 complete — hourly QStash poller reusing capture-learning's verification + lazy
service-role shape, atomic watermark claim (bounded, index-matching, SKIP LOCKED revival condition
recorded), 23505-as-duplicate idempotency complementary to the claim, ADR §4.5's failure table implemented
row for row with an operator-visible consequence each and repo-id-never-body logging, one canonical
signals.tick line with all §4.6 fields (SIGNAL-INGEST-IDEMPOTENT, -FAILURE-ISOLATED, -TICK-OBSERVABLE,
-REVOCATION-DETECTED, ADR §4)." Then stop.
```

#### E2.8 — Connect + install callback: the tenant binding  ·  ADR §8.1–§8.6, §2.5  ·  SIGNAL-CALLBACK-TENANT-BOUND, -CALLBACK-VALIDATED, -CAPABILITY-GATED, -DISCONNECT-DEACTIVATES, -GATING-SEAM-NAMED, -OAUTH-LEG-PRESENT, -USER-TOKEN-UNPERSISTED

```
BUILDER — Session 27 · E2.8. The sharpest security surface in the session. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke security-reviewer ONCE, and give it BOTH E2.3 and E2.8
as ONE scope: "the complete credential + entry-point path — lib/signals/github-client.ts, the connect
action, the install callback, the disconnect action. One question: can an attacker bind an installation
they cannot administer to a business they control, or cause a stranger's private-repo release notes to be
polled into their own dashboard?" Do not ask it anything a test already answers; do not re-consult it.

⚠️ READ §0.2's A-1 ruling FIRST. Two opposite drifts are both failures. Storing the user token breaks the
adjudication. Omitting the client_id/client_secret leg because L-2 says "not OAuth App" ships the design
security-reviewer PROVED exploitable. Steps 8-9 below are the security boundary, not optional hardening.

BUILD — ADR §8.3's ordered flow, all eleven steps:
1.  Zod on installation_id, setup_action, state, code. Unparseable → invalid_request redirect, NO WRITE.
2.  Verify the signed state JWT (the app/api/social/[platform]/callback/route.ts precedent), redirecting
    to invalid_state on failure. Claims: businessId, userId, nonce. 5-minute expiry.
3.  Single-use nonce, NO NEW TABLE: connect initiation sets an httpOnly, SameSite=Lax, 5-minute cookie
    holding the nonce; the callback requires equality with the JWT claim and CLEARS it. Lax is required
    and sufficient — it survives a top-level GET navigation, which is exactly what GitHub's redirect is.
4.  ⚠️ The business comes ONLY from the signed state, NEVER from a query param; UUID-shape checked.
5.  Re-fetch the business under the ANON, RLS-enforced client (getBusinessById), proving the signed-in
    user still has access. The state also binds userId ([sec-MEDIUM-7]) and the callback requires the
    signed-in user to MATCH it.
6.  App-layer canServer(client, business, userId, CAPABILITIES.CONNECT_ACCOUNTS) — the 21B precedent
    verbatim, because this handler WRITES SERVICE-ROLE and RLS is therefore defence-in-depth, not the
    boundary. Copy the "authoritative gate" comment shape from connect/route.ts.
7.  ⚠️ setup_action branch ([sec-HIGH-2]): ONLY 'install' proceeds. 'request' (a non-admin org member
    triggered the install; owner approval pending) WRITES NOTHING and redirects to a distinct "awaiting
    organization approval" screen. Unhandled, this writes a row for access that does not exist.
8.  Exchange `code` for a user access token (POST https://github.com/login/oauth/access_token), IN MEMORY.
9.  ⚠️ THE TENANT BINDING: GET /user/installations with that user token, and bind ONLY if the returned
    installation_id appears in that authenticated user's OWN installation list. Verifying the installation
    EXISTS answers liveness, never authorization — it cannot distinguish "this is mine" from "this exists
    somewhere". A nonce does not close this either: nothing in the request is GitHub-signed, so an
    attacker tampering with installation_id on their own still-valid state defeats it. This step also
    closes the SQUATTING DoS — you cannot squat an installation you cannot administer.
10. ⚠️ DISCARD the user token. Never persisted, never cached, never reused, never used by the poller.
11. Upsert github_connections under UNIQUE (installation_id). A conflict against a DIFFERENT business_id
    is a TYPED, explicit error ("already connected to another workspace"), never a silent rebind.
- Session expired at redirect time → redirect to login with `next` preserving the callback URL; the
  5-minute cookie bounds the window; NOTHING is written. Do not guess a business.
- connectGithubAction in app/[locale]/(dashboard)/settings/signals/actions.ts — mints the signed state +
  nonce cookie and redirects to the install URL. ⚠️ This function is the NAMED L-8 plan-gating seam (§8.6):
  add the comment saying so. No entitlement check ships; the seam must be locatable by name.
- disconnectGithubAction (§2.5): (1) atomic conditional UPDATE SET is_active = false … WHERE is_active =
  true; (2) poller exclusion is structural, already true from E2.7; (3) ⚠️ already-ingested signals are
  RETAINED (delete-on-disconnect is the named loser: surprising data loss, and reconnection would
  re-ingest the world); (4) ⚠️ SOSH does NOT call GitHub's uninstall API — it deep-links to the customer's
  own installation settings, because uninstalling is a WRITE against their account and L-5 is read-only
  forever.
- Watch-list Server Actions (add / remove-by-deactivate / toggle), each gated on CONNECT_ACCOUNTS, each
  Zod-validated, with the 20-active-repo cap enforced IN THE ACTION (SIGNAL-WATCHLIST-BOUNDED) — a CHECK
  cannot see sibling rows, and the small TOCTOU window is accepted because this is a UX/cost guardrail,
  not a security boundary.
- ⚠️ NO new user_can capability (§8.4). CONNECT_ACCOUNTS governs connect, disconnect AND watch-list edits:
  connecting a GitHub App to a business IS connecting an external account to it. A new capability is a
  migration + an ADR 0013 amendment + an app-layer echo. manage_signals is the named loser.

TESTS — Tier-2 (the callback's rejection matrix is the point):
- ⚠️ SIGNAL-CALLBACK-TENANT-BOUND: user-installations-foreign.json → the installation is NOT in the user's
  list → REJECTED, nothing written. This is the [sec-BLOCKER-1] case; write it first and watch it fail.
- SIGNAL-CALLBACK-VALIDATED: missing/invalid state; missing nonce cookie; nonce mismatch; replayed nonce;
  setup_action='request' → writes nothing, distinct screen; signed-out user; userId mismatch against the
  state claim; unparseable installation_id.
- SIGNAL-CAPABILITY-GATED: canServer(CONNECT_ACCOUNTS) denial on connect, disconnect and each watch-list
  action returns the typed forbidden result BEFORE touching the DB layer.
- SIGNAL-DISCONNECT-DEACTIVATES: the atomic transition; signals RETAINED; ⚠️ no uninstall API call is made
  (assert the client is not invoked).
- SIGNAL-WATCHLIST-BOUNDED: the 21st active repo is rejected by the action.
- ⚠️ SIGNAL-USER-TOKEN-UNPERSISTED (A-1, drift direction A): the user token is never passed to any
  persistence function. "Assert by construction" is NOT enough here and was the weak half of this ruling —
  it names no executable check, so a Builder who does persist it fails nothing. Write BOTH: (a) a Tier-2
  assertion that the object handed to the github_connections upsert carries no token-shaped field, and
  (b) E2.10's standing source scan, which survives a Builder who deletes an awkward test.
- ⚠️ SIGNAL-OAUTH-LEG-PRESENT (A-1, drift direction B): the callback module must reference BOTH
  login/oauth/access_token (step 8) and /user/installations (step 9). A Builder who omits the leg produces
  a module where both are simply absent — and an absent test is invisible in review, whereas an absent
  string is greppable. E2.10 scans for it; this is why the two directions get two constraint IDs, not one
  warning read once.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app. Fold security-reviewer's findings in before
commit; fix, do not defer, anything it rates at or above MEDIUM on the callback path.
On commit: "E2.8 complete — ADR §8.3's eleven-step callback with the GET /user/installations ownership
proof (A-1) closing the tenant-confusion BLOCKER and the squatting DoS, single-use nonce cookie + signed
state binding businessId AND userId, setup_action='request' writing nothing, user token discarded after
one call, typed cross-workspace conflict; connectGithubAction named as the L-8 gating seam; disconnect
deactivates atomically and retains signals with no uninstall call; CONNECT_ACCOUNTS reused, no new
capability (SIGNAL-CALLBACK-TENANT-BOUND, -CALLBACK-VALIDATED, -CAPABILITY-GATED, -DISCONNECT-DEACTIVATES,
-GATING-SEAM-NAMED, -WATCHLIST-BOUNDED, ADR §8)." Then stop.
```

#### E2.9 — The surface: connect, repo picker, watch list, and four honest states  ·  ADR §8.1, §2.5, §5.4

```
BUILDER — Session 27 · E2.9. Routing, the repo picker, and i18n. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. NO agent — use the impeccable and taste-skill SKILLS (free) as the quality bar.
Scope them honestly: this is a settings form with four states, not a design-led surface. The design-led
session is still after Session 28; do not redesign the dashboard here.

BUILD — app/[locale]/(dashboard)/settings/signals/:
- Server Component page + Client form split (CLAUDE.md's UI Component patterns). shadcn v4 is Base UI: NO
  asChild on Button or DropdownMenu primitives; buttonVariants() on a <Link> for link-styled buttons;
  native <select> for static option sets.
- Not-connected state: what SOSH will read (published release notes, from repos you choose), what it will
  never do (⚠️ never write to your repos — state it, it is L-5 and it is the customer's first question),
  and the Connect button calling connectGithubAction.
- The repo picker, fed by GET /installation/repositories through lib/signals/ — bounded, with the
  20-active cap surfaced BEFORE the 21st add is rejected (an at-cap state, not an error toast).
- ⚠️ FOUR honest states the ADR requires, none of them optional:
  (a) "Awaiting organization approval" — the setup_action='request' screen (§8.3 step 7). Distinct, with
      what the user must do next.
  (b) Reconnect required — driven by last_poll_status = 'revoked' (§2.5). The customer uninstalled on
      GitHub's side; SOSH found out on the next tick.
  (c) Repo unavailable — watched_repos.is_active = false from a 404 (§4.5). Say the repo was deleted,
      renamed, or removed from the installation; do not say "error".
  (d) Rate limited — rate_limited_until in the future. Ingestion resumes automatically; nothing to do.
- ⚠️ DISCONNECT COPY MUST TELL THE TRUTH (§2.5, [sec-HIGH-3]): disconnecting in SOSH stops ingestion; FULL
  revocation means uninstalling the App in GitHub settings, with a deep link. Copy implying that
  disconnecting revokes access is FORBIDDEN by the ADR — is_active is genuinely a weaker barrier than
  deleting a Vault secret, and the UI is where that honesty is either kept or lost.
- ⚠️ NO retention period appears anywhere on this surface, or in any customer-facing copy (A-3,
  SIGNAL-RETENTION-UNCLAIMED). The reaper does not exist; a stated period would be a false statement to a
  regulator. Do not add "we keep signals for 180 days" to a tooltip, an FAQ, or a settings hint.
- i18n/{en,pt,es}/signals.json, all three locales landing SIMULTANEOUSLY, and ⚠️ REGISTERED in
  i18n/request.ts — an unregistered namespace silently resolves to nothing.
- Body rendering: a truncated body always renders alongside its html_url link (§5.4). ⚠️ Zero
  dangerouslySetInnerHTML — this is third-party-authored markdown and rendering it as HTML is an
  exfiltration/SSRF vector (§7.1).
- ⚠️ NO console.* anywhere on this surface (L-13 — the carve-out is the worker's tick line only).

TESTS — Tier-2:
- Each of the four states renders from its driving column value.
- The disconnect copy contains the "uninstall in GitHub settings" instruction (assert the i18n key is
  present and used — this is a constraint, not a nicety).
- No retention figure appears in any of the three locale files (a string scan over signals.json).
- All three locales have identical key sets; the namespace is registered in i18n/request.ts.
- The at-cap state renders at 20 active repos.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app.
On commit: "E2.9 complete — settings/signals surface with the four honest states (awaiting org approval,
reconnect-required, repo unavailable, rate limited), truthful disconnect copy naming GitHub-side uninstall
as the only full revocation, repo picker with the 20-repo cap surfaced before rejection, no retention
figure in any customer-facing string (A-3), en/pt/es landed together and registered, zero
dangerouslySetInnerHTML (ADR §8.1/§2.5/§5.4)." Then stop.
```

#### E2.10 — The four source scans + the Tier-3 enumeration  ·  ADR §11.3, §11.4  ·  SIGNAL-NO-LLM-IN-STAGE-AB, -NO-PROVIDER-COUPLING, -CONFIG-ONLY-ENV, -PROMPT-SINK-NARROWED

```
BUILDER — Session 27 · E2.10. The session's central claim, made executable. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. NO specialist BY DESIGN: the scans ARE the enforcement, and a
per-root vacuity guard proves more than an agent's opinion of them.

BUILD — four source scans (Tier-2, executable), each following
lib/learning/memory-table-boundary.test.ts's shape:
- ⚠️ THE VACUITY GUARD IS PER ROOT, NOT IN AGGREGATE: expect(files.length).toBeGreaterThan(0) for EACH
  scan root separately. The aggregate form was Session 26-D's MINOR-1 — an empty or renamed root passes
  vacuously while the aggregate check still sees files from another root. A scan that can pass on an empty
  root is the FALSE-GREEN shape ADR 0015 exists to catch, and these four scans are the only enforcement
  three of these constraints have.
1. SIGNAL-NO-LLM-IN-STAGE-AB (L-1): no file under lib/signals/** or the poller route imports @/lib/ai/* or
   @anthropic-ai/sdk. ⚠️ Stated exception so the scan is written CORRECTLY: wrapSignalForPrompt lives in
   lib/ai/ per §7.4 and is SESSION 28's entry point — no Session 27 code path calls it. Assert that too:
   nothing in lib/signals/** or the route references it.
2. SIGNAL-NO-PROVIDER-COUPLING (D-8): @octokit/* is imported in exactly ONE file, and no file outside
   lib/signals/** imports it.
3. SIGNAL-CONFIG-ONLY-ENV: no process.env.GITHUB outside lib/config.ts.
4. SIGNAL-PROMPT-SINK-NARROWED: no `as RenderedSignalText` / `as UntrustedText` / `as unknown as` applied
   to the signal text types outside their single minting module — the ADR 0019 §8.5 pattern, closing the
   residual §7.3 admits the types provably cannot.
- SIGNAL-NO-SIXTH-SANITIZER as a fifth assertion inside scan 1's file or its own: no local
  sanitizeDataField definition under lib/signals/**.
- ⚠️ THE TWO A-1 ASSERTIONS — same shape, same per-root guard, both added HERE because A-1 can be failed
  in two OPPOSITE directions and each needs its own executable check (see E2.8):
  · SIGNAL-USER-TOKEN-UNPERSISTED (direction A — the token gets stored): no token-shaped identifier
    (access_token, user_token, refresh_token) appears in lib/db/github-connections.ts or in the
    github_connections Insert/Update types. The token is legitimately named inside the callback module
    and lib/signals/github-client.ts — scope the scan to the PERSISTENCE layer, or it reddens on correct
    code and the next session deletes it.
  · SIGNAL-OAUTH-LEG-PRESENT (direction B — the leg is never built): the install-callback route
    references BOTH login/oauth/access_token AND /user/installations. This is a scan for PRESENCE, which
    is unusual here — every other scan forbids something. That is deliberate: the failure mode is
    omission, and omission is exactly what a forbidding scan cannot see.
  Both get the same redden-then-revert demonstration as the four below. For the presence scan, the
  demonstration is deleting the call and confirming RED — do it, do not reason about it.

ALSO — enumerate ADR §11.4's SIX Tier-3 diff-verified properties in a committed checklist (docs or a test
comment block), ⚠️ AS DECISIONS rather than omissions, so "no runtime test" is recorded and not
overlooked: SIGNAL-READ-ONLY-GITHUB (permission set is contents:read + metadata:read and no write call
appears in the diff); no campaigns.origin migration; no lib/social/** change; no webhook route;
SIGNAL-NO-EMBEDDINGS (no pgvector, no embedding call); SIGNAL-RETENTION-UNCLAIMED (no customer-facing
surface states a retention period).

TESTS: each scan must be DEMONSTRATED to redden. ⚠️ For each of the four, temporarily introduce the
violation it forbids, confirm the test FAILS, then revert. Record the four demonstrations in the commit
message. A scan asserted to work is not a scan proved to work — this is the ADR 0015 lesson the whole
session rests on.

VERIFY: npx tsc --noEmit --skipLibCheck; npm run test:app.
On commit: "E2.10 complete — four executable source scans (no-LLM-reachable, octokit-in-one-file,
no-process.env.GITHUB-outside-config, no-cast-past-the-brand) each with a PER-ROOT vacuity guard per
Session 26-D MINOR-1, each demonstrated to redden against a temporary violation and reverted; the six
Tier-3 diff-verified properties enumerated AS decisions (SIGNAL-NO-LLM-IN-STAGE-AB, -NO-PROVIDER-COUPLING,
-CONFIG-ONLY-ENV, -PROMPT-SINK-NARROWED, -NO-SIXTH-SANITIZER, ADR §11.3/§11.4)." Then stop.
```

#### E2.11 — Coverage verification + close-out docs  ·  ADR §12, §16  ·  all 33 constraints

```
BUILDER — Session 27 · E2.11. VERIFY ONLY — no new behaviour. Run /ecc:verification-loop. Invoke
ecc:pr-test-analyzer ONCE with one question: "does every one of ADR 0020 §12's 33 SIGNAL-* constraints map
to a test that ACTUALLY EXECUTES in a named CI job and would REDDEN if the property broke?" Give it the
constraint table and the test files; do not ask it to review design.

DO:
- Walk ADR §12's table row by row and produce: constraint → test file:line → executing CI job (db-tests /
  app-tests / Tier-3 diff-verified BY DECISION) → "reddens if broken?". ⚠️ A constraint with a test but no
  executing job is AUTHORED-NOT-EXECUTED; with neither, it is unproven. Both are STOPs at this step, not
  notes for the Reviewer.
- ⚠️ Report the db-tests EXECUTED TEST COUNT and FILE COUNT read directly from the skip-guard's own log
  line, not from the green checkmark (Session 26-D D5 made the test count available; use it). Zero
  executed in any supabase/__tests__ file is a FALSE-GREEN.
- ⚠️ Complete ADR §11.5's SHARED-FUNCTION CALLERS table by re-running git grep on signOAuthState /
  verifyOAuthState. The ADR lists four rows and instructs you to extend it if a third caller exists — do
  the grep, do not inherit the table. A caller with no listed test is AUTHORED-NOT-EXECUTED for that
  caller regardless of the others. Both Session 22 blockers were this exact failure.
- Confirm §11.5's other statement holds: the prompt-assembly caller set for signal text is EMPTY in this
  session (no prompt exists yet), recorded so ADR 0021 knows the table starts empty and must be filled by
  it, not inherited.
- Push the branch, open the PR, and record BOTH run URLs. ⚠️ The tally counts `master` runs only — a
  pull_request-event run does NOT move it (it stood at 0 of 3 after Session 26-D).

CLOSE-OUT DOCS (ADR §16 / this guide's §5):
- docs/decisions/0010-legal-surface.md Amd 2 §D2.5 — confirm E2.1's four rows landed (mandatory).
- CLAUDE.md — add the lib/signals/ module-boundary rule from ADR §10.1, in the SAME sentence shape as the
  /lib/social/ and /lib/ai/ rules.
- docs/current-phase.md — the Session 27 entry, the promotion tally with both run URLs and the skip-guard
  counts read from the log, and ⚠️ A-2's LAUNCH-BLOCKING condition recorded explicitly: no launch until
  the Evidence Pack entry, the Art. 6(1)(f) balancing test and the /privacy prose all land.
- docs/decisions/0020-mode-3-signal-ingestion.md — status/close-out block.
- docs/build-guide/session-28.md — confirm its Reality block matches what Session 27 ACTUALLY shipped,
  BEFORE Session 28's Architect runs; in particular that campaigns.origin needs no migration and that
  §13.1's contract (signal_candidates, listNewCandidates) shipped under those exact names.
- .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md — per the OpenWolf protocol.

On commit: "E2.11 complete — 33 of 33 SIGNAL-* constraints mapped to an executing CI job with reddens-if-
broken stated per row; db-tests <N> files / <M> tests and app-tests <N> files / <M> tests read from the
skip-guard log; SHARED-FUNCTION CALLERS re-grepped and extended; §D2.5 rows, CLAUDE.md lib/signals/ rule,
current-phase entry with A-2's launch-blocking condition, and session-28.md Reality block reconciled."
Then stop.
```

---

## §3 — Reviewer session (E3)  ·  (paste into Claude Code · Opus)

Run only after E2.1–E2.11 are committed. **The Builder range is `<E2.1 sha>^..<E2.11 sha>`** (fill both in
before pasting — a review that does not name its range is not a valid review). The Reviewer is independent
and modifies nothing. It is the **single** review pass for this session; the correction pass (§4) records
its resolutions in the reviewer's own file (**REVIEWER-REPORT APPEND-ONLY**).

**Why this track's review is different from Tracks A–D.** Tracks A–D operated on data the customer gave
SOSH directly. Track E is the first track where **SOSH reaches into a third party's system on the
customer's authority and stores text written by people who are not SOSH users**. Three failure classes
matter more here than anywhere in the product to date:

1. **Binding an installation the connecting user cannot administer.** This is not a theoretical
   escalation: it polls a stranger's org — potentially **private-repo release notes** — into the
   attacker's dashboard, and doubles as a **squatting denial-of-service** that locks the real owner out.
   The pre-A-1 design was exploitable and ADR §8.2 says so plainly. **Only step 9 of §8.3 closes it.** If
   `GET /user/installations` is absent, weakened, or reachable-around, `SIGNAL-CALLBACK-TENANT-BOUND` is a
   slogan.
2. **A silent poller.** A worker that skips a business with no operator-visible counterpart is
   indistinguishable from a working one. ADR §4.5 exists to make every failure class loud; a row
   implemented as a bare `continue` is the defect, and it will never announce itself.
3. **An LLM call reachable from Stage A/B.** The entire justification for splitting ADR 0020 from 0021 is
   that this half is exactly testable. One reachable `anthropic.messages.create` does not just breach
   scope — it invalidates the session split's premise.

Everything else — the RLS, the cascade, the scoring arithmetic — is conventional and is proved or not
proved by tests you can read.

**ECC in this phase — THREE agents, ONE parallel batch, DISJOINT scopes.** Each gets a **named file list
and one question**, and **no two are asked the same thing**:

| Agent | Scope (files) | The one question |
|---|---|---|
| `database-reviewer` | the migration, the four `lib/db/` modules, `supabase/__tests__/signals-*.test.ts` | are all four tables tenant-tunnel-proof and erasure-complete, is the candidate upsert genuinely arbitered and race-free, and does every list query's `ORDER BY` match a real index? |
| `security-reviewer` | `lib/signals/github-client.ts`, the connect action, the install callback, the disconnect action | can an attacker bind an installation they cannot administer, and does any token or untrusted body reach a log, a table, or the client? |
| `ecc:type-design-analyzer` | `lib/ai/wrap-evidence.ts`, the two brands, the `lib/db/` return types, the four scans | can raw signal text reach a prompt-assembly parameter by code that does not cast — and is the in-code claim about that no stronger than §7.3's? |

**Deliberately NOT invoked:** `typescript-reviewer` (its scope is the union of the three above);
`ecc:silent-failure-hunter` (failure isolation is Section D of your own walk, against ADR §4.5's table —
delegating it would return a re-derivation of a table you must read anyway); `ecc:pr-test-analyzer`
(**Section H is a table walk against CI logs, not a code analysis** — Session 25 proved delegating it
produces a re-derivation of what the Reviewer already read); `ecc:code-reviewer`;
`impeccable`/`taste-skill` (the Builder's bar, already applied).

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 27 — Mode 3 Part 1: GitHub signal ingestion (ADR 0020), REVIEWER phase. You are an INDEPENDENT
reviewer: you did NOT write this code and you will not modify any file. Output is a review document only.
This is the ONE review pass for the session — audit thoroughly; there is no re-review to catch what you
miss.

⚠️ PROC-REVIEW-AT-COMMIT (CLAUDE.md / ADR 0015 — a HARD constraint): read EVERY file AT THE STATED COMMIT
RANGE — git diff <E2.1 sha>^..<E2.11 sha>, git show <sha>:<path>, git log --oneline — NEVER at HEAD. Your
report MUST OPEN by naming the exact range you read and stating every citation comes from it. A report
that does not name its range is not a valid review. (The Session 21B false-positive MAJOR came from
reading one file at HEAD.) Per the Session 22-F/NEW-12 exception: reviewed ARTEFACTS are read at the
audited range; any prior findings document you audit against is read at ITS OWN commit, which you must
also name.

ECC BUDGET — THREE agents, ONE parallel batch, disjoint scopes, never re-consulted (session-27.md §3
table): database-reviewer (migration + db modules + Tier-1 suite), security-reviewer (github-client +
connect + callback + disconnect), ecc:type-design-analyzer (the brands + wrapSignalForPrompt + the db
return types + the scans). Give each ONLY its file list and its ONE question. Do NOT invoke
typescript-reviewer, silent-failure-hunter, pr-test-analyzer or code-reviewer — Sections D and H are YOUR
job, in your own context. Do NOT invoke cost-aware-llm-pipeline: this session makes ZERO AI calls, and if
you find one, that is a BLOCKER, not a cost question.

⚠️ SHARED-FUNCTION CALLERS (CLAUDE.md — the root cause of BOTH Session 22 blockers): git grep every caller
and state, PER CALLER, which test file exercises it:
  (a) signOAuthState / verifyOAuthState — the social callback used them first; this track added a second
      caller. ADR §11.5 lists four rows AND instructs the Builder to re-grep — verify the Builder did, and
      re-grep yourself.
  (b) neutralizeWithSentinels — wrapSignalForPrompt is a new caller beside the Studio one.
  (c) getBusinessById / canServer — the install callback is a new caller of both.
  (d) verifyQStashRequest — the poller route is a new caller.
One caller proven is NOT the function proven.

Read now, at that range:
- docs/decisions/0020-mode-3-signal-ingestion.md — §12's 33 SIGNAL-* constraints are your checklist; §11
  is the test plan; the [db-*] / [sec-*] / [type-*] tags throughout mark advisory findings ALREADY folded
  in (verify each actually SHIPPED — a folded-in finding that did not land is a MAJOR, because the ADR
  asserts it as handled and nothing else will catch it); §13 is the Session 28 contract; §14 is the
  deferred boundary.
- docs/build-guide/session-27.md — the Reality block, §0 (L-1..L-13 + D-1..D-8), §0.1 (the eight answers),
  §0.2 (the THREE founder rulings and their BINDING conditions — especially A-1's TWO drift directions and
  A-3's no-customer-facing-claim condition) and §2 (the decisions the Builder was told to TRANSCRIBE).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 — the three tiers and "covered = executed".
- docs/decisions/0010-legal-surface.md Amd 2 §D2.5 — the four rows must be there.
- The full Session 27 diff COMMIT BY COMMIT (E2.1…E2.11) and every test added.

Before reviewing anything, ESTABLISH SIX REALITIES (a wrong answer here voids the review):
(1) EXECUTION. Did this range run in CI? Name the app-tests run and the db-tests run for these SHAs, and
    the db-tests EXECUTED TEST COUNT and FILE COUNT read from the skip-guard's own log line. If either job
    never ran on this range, every constraint it owns is AUTHORED-NOT-EXECUTED — a BLOCKER, not a note.
(2) THE TENANT BINDING. Read the callback end to end. Is GET /user/installations actually called with a
    USER token, and is the bind CONDITIONAL on the installation appearing in THAT user's list? An
    existence check against the App JWT (GET /app/installations/{id}) is NOT this — it proves liveness,
    never authorization. If the ownership proof is absent, bypassable, or applied after the write, that is
    an immediate BLOCKER: it is the exact design ADR §8.2 records as exploitable.
(3) TOKENS AT REST. Is any token — installation or user — written to a table, a cookie, a cache, a log, or
    returned to the client, anywhere in the range? Grep the whole diff. A stored user token breaks founder
    ruling A-1 as surely as omitting the OAuth leg does.
(4) NO LLM. Does ANY file under lib/signals/**, the poller route, or the signals settings surface import
    @/lib/ai/* or @anthropic-ai/sdk, or reach one transitively? Grep, then read the source scan and verify
    its PER-ROOT vacuity guard — an aggregate guard is Session 26-D's MINOR-1 and lets an empty root pass.
    A reachable LLM call is a BLOCKER; a vacuous scan is a FALSE-GREEN and also a BLOCKER, because it is
    the ONLY enforcement this constraint has.
(5) THE DELETE TRIGGER. Is there a BEFORE DELETE trigger on ANY of the four new tables, in any form? If
    yes, immediate BLOCKER: purge_business (20260702120700:62) has NO EXCEPTION block, so the cascade
    aborts and no affected business can be GDPR-erased. Then confirm the Tier-1 tests assert erasure
    SUCCEEDS, not merely that rows are gone — a rows-are-gone assertion inside an already-aborting
    transaction is never reached.
(6) THE ARBITER. Does signal_candidates have UNIQUE (signal_id)? Without it ON CONFLICT (signal_id) has no
    arbiter and every re-score silently duplicates — this was the ADR's own [db-BLOCKER] and it is the
    single easiest thing to drop while transcribing.
Output the six findings + the four caller enumerations + "Ready to review 27 (range: …)." Then wait.
```

### §3b — Reviewer prompt  (paste after acknowledgement)

```
REVIEWER — Session 27. Audit the diff commit-by-commit against ADR 0020. RE-DERIVE the adversarial checks
yourself (write the query, trace the call, construct the hostile request, reason about the outcome) rather
than trust a test's name. Tier every finding BLOCKER / MAJOR / MINOR / NIT. All citations at the stated
range.

SECTION A — SCHEMA, RLS, CASCADE, ERASURE  (SIGNAL-RLS-ISOLATED, -CASCADE-COMPLETE, -PURGE-COVERED,
                                            -RAW-IMMUTABLE-IDENTITY · database-reviewer)
A1. RLS ENABLED on all four + policies in the InitPlan form `business_id = ANY (SELECT unnest(public.
    get_user_business_ids()))`, with WITH CHECK on every INSERT and UPDATE policy. The bare unwrapped form
    evaluates per row — flag it if stamped in from an old template. A missing WITH CHECK is tenant
    tunnelling — BLOCKER. Cross-tenant CRUD denied, EXECUTED on live Postgres, in BOTH DIRECTIONS with a
    real signed-in owner-B session (a one-directional test misses half the matrix — Session 26-D MINOR-2).
A2. ⚠️ NO DELETE policy on watched_repos for authenticated, and the read-only intent is ALSO expressed as
    a GRANT (SELECT only, no write grant) rather than resting on the absence of a policy. A DELETE policy
    here lets a user annihilate the signal history via cascade — MAJOR at minimum.
A3. business_id NOT NULL REFERENCES businesses ON DELETE CASCADE on all four; NO BEFORE DELETE trigger
    (reality 5); purge_business UNEDITED; a business delete and a purge_business call each SUCCEEDING with
    all four tables populated, executed.
A4. The FOUR §D2.5 cascade rows exist, in the five-column form, carrying the ADR's "no Vault secret exists
    to delete" and "contributor identity fields are never stored" clauses. Missing = silent GDPR-erasure
    leak = BLOCKER. Those clauses are the ARGUMENT for needing no purge_business edit — a row without them
    is not the row the ADR specified.
A5. The BEFORE UPDATE trigger on signals raises on business_id / watched_repo_id / external_id /
    created_at and permits title / body / content_hash / body_truncated / updated_at. Read the trigger,
    then read the test that exercises BOTH arms.
A6. Every index of §3.6 exists — in particular watched_repos (connection_id) and signals (watched_repo_id),
    which were bare FKs in the ADR's own draft ([db-BLOCKER-C]) — and EVERY list query's ORDER BY matches
    one EXACTLY, including the poller's claim query (a service-role caller gets no exception from L-13).
A7. ⚠️ occurred_at is denormalised onto signal_candidates and the feed's ORDER BY is genuinely
    index-satisfied. If it was "simplified" back to a join against signals, the feed cannot be indexed at
    all — Postgres cannot build a composite index across two tables — and §13.1's contract to Session 28
    is broken at the performance level.
A8. NOT present: a vault_*_token_id column on github_connections (§2.3 — and is the tripwire comment
    there?); a status value beyond 'new' on signal_candidates (that is ADR 0021's migration); any
    campaigns.origin change; a webhook secret in config.

SECTION B — THE CREDENTIAL MODEL  (SIGNAL-NO-TOKEN-AT-REST, -CONFIG-ONLY-ENV, -READ-ONLY-GITHUB,
                                   -DISCONNECT-DEACTIVATES, -REVOCATION-DETECTED · security-reviewer)
B1. ⚠️ No token at rest (reality 3), re-derived by you: grep the whole diff for every path a token value
    could take — a DB write, a cookie, a cache, a log line, a Sentry extra, a returned value crossing to a
    client component. The installation token is per-tick and in-memory; the user token is used for ONE
    call and discarded.
B2. GITHUB_APP_PRIVATE_KEY is base64 with a PARSE-TIME .refine() that genuinely rejects a malformed key.
    Read the test. Without it, a mis-pasted key fails an hour later inside a cron — [sec-MEDIUM-5], and
    the ADR calls it the silent-failure shape L-11 forbids.
B3. No process.env.GITHUB outside lib/config.ts, proved by a scan with a PER-ROOT vacuity guard.
B4. ZERO write methods against api.github.com anywhere in the range, and the requested permission set is
    exactly contents:read + metadata:read. A permission we do not use is a permission we do not request —
    flag any extra scope in config, docs or the App setup instructions.
B5. Disconnect: atomic conditional UPDATE (never read-then-update); signals RETAINED; poller exclusion is
    STRUCTURAL (the claim query filters is_active, not a skip branch that could be forgotten); and ⚠️ SOSH
    does NOT call an uninstall API — that would be a WRITE against the customer's account against L-5.
B6. ⚠️ The disconnect COPY tells the truth: stopping ingestion is not revocation, and full revocation
    means uninstalling in GitHub settings. [sec-HIGH-3] — is_active is genuinely weaker than deleting a
    Vault secret, the ADR says so, and copy implying otherwise is a finding, not a nit.
B7. SIGNAL-REVOCATION-DETECTED: a 401/404 on mint auto-deactivates and surfaces a reconnect state within
    one tick. Read the fixture test, not the branch.

SECTION C — THE INSTALL CALLBACK  (SIGNAL-CALLBACK-TENANT-BOUND, -CALLBACK-VALIDATED, -CAPABILITY-GATED
                                   · security-reviewer)
C1. ⚠️ THE OWNERSHIP PROOF (reality 2), re-derived by you: construct the attack yourself — start a
    legitimate flow on your own business, obtain a valid signed state, substitute another
    installation_id — and trace it through Zod → state verify → nonce → business re-fetch → user_can →
    setup_action → code exchange → GET /user/installations → upsert. State whether it binds. If it can
    bind on ANY path, BLOCKER.
C2. The business comes ONLY from the signed state, never a query param; the state binds userId as well as
    businessId and the callback requires the signed-in user to match ([sec-MEDIUM-7]).
C3. The nonce cookie is httpOnly, SameSite=Lax, short-lived, single-use and CLEARED. Then state plainly
    why a nonce alone does NOT close C1 — if the Builder treated the nonce as the fix, that
    misunderstanding will recur in Session 28.
C4. ⚠️ setup_action='request' writes NOTHING and reaches a distinct screen ([sec-HIGH-2]). Unhandled, it
    writes a row for access that does not exist. Walk the branch; then check 'update' and any unexpected
    value are also safe.
C5. A cross-workspace UNIQUE (installation_id) conflict is a TYPED explicit error, never a silent rebind,
    and the squatting arm is proved on live Postgres.
C6. An expired session at redirect time writes nothing and redirects to login preserving `next`.
C7. SIGNAL-CAPABILITY-GATED: canServer(CONNECT_ACCOUNTS) on connect, disconnect AND every watch-list
    action, positioned as the AUTHORITATIVE gate (the handler writes service-role, so RLS is
    defence-in-depth only — the 21B precedent). ⚠️ Confirm NO new user_can capability was added: a new one
    is a migration + an ADR 0013 amendment, and §8.4 rejected it.
C8. Every callback query param is Zod-validated before use, and the rejection matrix of §11.2 is executed
    case by case — foreign installation_id, missing/replayed nonce, setup_action='request', signed-out
    user, unparseable input.

SECTION D — THE POLLER  (SIGNAL-INGEST-IDEMPOTENT, -FAILURE-ISOLATED, -POLL-CONDITIONAL, -TICK-OBSERVABLE
                         · YOURS, no agent)
D1. ⚠️ FAILURE ISOLATION, re-derived: make one business's fetch throw and trace whether the loop continues
    for the rest. Then walk ADR §4.5 ROW BY ROW and, for each, name the code path AND the operator-visible
    counterpart. ⚠️ A row implemented as a bare `continue` with no count, no Sentry and no UI state is the
    silent skip the table exists to reject — MAJOR per row, and it will never announce itself in
    production.
D2. Idempotency is the UNIQUE INDEX, not a SELECT-then-INSERT (a textbook TOCTOU). 23505 is counted as
    `duplicates`, not an error. Then confirm the ADR's complementarity claim actually holds in the code:
    the claim (§4.2) is what stops two overlapping runs racing to write releases_etag — the index does not.
D3. The claim is an atomic conditional UPDATE, bounded, with an ORDER BY matching its index, and
    last_poll_started_at / last_poll_completed_at are SEPARATE columns ([db-MODERATE-B-iii]). If they were
    collapsed back into one, a crashed tick is indistinguishable from a completed one.
D4. ⚠️ The ETag mechanism, not a `since` cursor: If-None-Match sent, 304 short-circuits with no body parse
    and no writes, the ETag persisted on 200. Then confirm the 30-most-recent edit-detection bound is
    RECORDED as a decision (§4.4) rather than silently absent.
D5. Exactly ONE console.log per invocation with ALL §4.6 fields. Then grep for console.* anywhere else in
    the range — the carve-out is the worker's single tick line, and the user-facing surface gets none.
D6. ⚠️ Untrusted body text never reaches a log or a Sentry payload. The malformed-payload path logs the
    REPO ID, never the body (§4.5, §7.1). Grep every capture/log call in the range for a body reference.

SECTION E — STAGE B  (SIGNAL-SCORING-DETERMINISTIC, -DEDUP-STABLE-ON-EDIT, -NO-EMBEDDINGS · YOURS)
E1. ⚠️ `now` is a PARAMETER, not read inside the scorer. A Date.now() inside makes determinism
    untestable-in-principle while every test still passes today — read the signature, not the test name.
E2. The formula matches §6.1 term for term, score_inputs persists each term, and the total order is
    score DESC, occurred_at DESC, external_id ASC with ties impossible by construction.
E3. Determinism is tested with a SHUFFLED input copy as well as a repeat run. A repeat-only test does not
    prove order-independence, which is the property that actually matters.
E4. Bot releases are scored DOWN, not filtered out (§6.2). A hard filter is a behaviour change against a
    named loser.
E5. ⚠️ The upsert is ON CONFLICT (signal_id) DO UPDATE … WHERE status = 'new', and the live-Postgres test
    proves a concurrent re-score CANNOT resurrect a dismissed candidate. Read the statement, then read the
    test that exercises the race specifically.
E6. NO embeddings, NO pgvector, NO similarity threshold, NO LLM anywhere in Stage B or its imports —
    including transitively.
E7. Exactly one candidate per signal (§6.5), and the clustering deferral carries its revival condition.

SECTION F — UNTRUSTED TEXT AND THE TYPES  (SIGNAL-RAW-TEXT-UNTRUSTED, -PROMPT-SINK-NARROWED,
                                            -NO-SIXTH-SANITIZER · type-design-analyzer)
F1. Both brands use a NON-EXPORTED unique symbol key. A string-literal or plain-object brand is defeated
    by a literal with no cast and leaves no grep trace — MAJOR.
F2. ⚠️ RenderedEvidence is NOT reused for signal text. If it was, the code now asserts "re-fetched and
    tenant-scoped at render time" about text that was never re-fetched — a false provenance claim baked
    into a type, which is worse than no brand at all.
F3. Sink narrowing exists: prompt-builder parameters accept only the safe brand, never `string`. Branding
    the input alone does not stop the path.
F4. ⚠️ THE HONESTY CHECK. Does any code comment, doc or commit message claim the types make the mistake
    UNREPRESENTABLE? §7.3 says "discouraged, not unrepresentable" — template-literal holes accept any
    string. Sessions 24 and 25 were BOTH caught overclaiming here and ADR 0017 Amendment A.2 is the
    precedent. An overclaim is a MAJOR, because it is what makes the next session skip the scan.
F5. wrapSignalForPrompt lives beside wrapEvidenceForPrompt, reuses neutralizeWithSentinels, and NO sixth
    local sanitizeDataField was added. The five existing copies are unchanged and their tests green.
F6. lib/db/ query functions return the BRANDED row type, so the brand originates at the data-access
    boundary rather than being applied ad hoc by callers (§7.4).
F7. The @ts-expect-error compile assertion exists and genuinely fails to compile. Verify by reading it.

SECTION G — SCOPE, PRIVACY AND PROCESS  (L-1, §0.2, ADR §5.3, §9, §14)
G1. NOTHING out of scope shipped: no Stage C/D/E/F, no insight card table, no expiry policy, no cost
    ceiling, no ai_usage write, no external source, no embeddings, no webhook route or secret, no plan
    gating, no status beyond 'new', no campaigns.origin change, no change to Mode 1/Mode 2/ADR 0018.
G2. ⚠️ CONTRIBUTOR IDENTITY: confirm the ten §5.3 fields are absent from the INSERT TYPE, not merely
    filtered at runtime. Then read the test that asserts each is absent from the parsed object. A runtime
    filter is a check someone can forget; the ADR chose structural absence precisely so they cannot.
G3. ⚠️ A-3's condition: grep every customer-facing string — i18n/{en,pt,es}/signals.json, any marketing or
    legal copy in the range — for a retention period. The reaper does not exist; a stated period is a
    false statement to a regulator. `SIGNAL-RETENTION-UNCLAIMED`.
G4. A-2's launch-blocking condition is RECORDED in docs/current-phase.md — the Evidence Pack entry, the
    Art. 6(1)(f) balancing test and the /privacy prose. Not shipped (correctly), but recorded (mandatory).
G5. The CLAUDE.md lib/signals/ module-boundary rule landed in the same sentence shape as /lib/social/ and
    /lib/ai/, and SocialProvider / lib/social/** show ZERO diff in the range.
G6. Every [db-*], [sec-*] and [type-*] finding the ADR marks as folded in actually SHIPPED. Walk them. An
    "already folded in" finding that did not land is a MAJOR — the ADR asserts it as handled, so nothing
    else will catch it.
G7. One step, one commit: the commits correspond to E2.0…E2.11 with no step's work bleeding into
    another's, and the TYPES (E2.4) precede the PARSER (E2.5) and the PROMPT-ADJACENT work — there must be
    no commit range in which signal text exists unbranded.
G8. No any (outside CLAUDE.md's two carve-outs); service-role never reachable from a Server or Client
    Component; date-fns formatISO throughout; Zod on every action and route input; i18n keys in all three
    locales and the namespace registered.
G9. Did the Builder stay inside its SIX-invocation ECC budget, and is there evidence of an agent
    re-consulted to re-litigate a folded objection? A process NIT if so — the budget is a founder
    instruction, not a suggestion.

SECTION H — CONSTRAINT COVERAGE (the thesis — do this YOURSELF, no agent)
H1. EVERY one of ADR §12's 33 SIGNAL-* constraints maps to a test AND to the CI JOB that executes it
    (Tier-1 → db-tests, Tier-2 → app-tests, Tier-3 → enumerated as diff-verified BY DECISION). A
    constraint with a test but no executing job is a MAJOR; with neither, a BLOCKER.
H2. For each, state whether the test would FAIL if the property broke. ⚠️ Pay special attention to
    anything that can pass VACUOUSLY: all four source scans (PER-ROOT vacuity guard present — the
    aggregate form is Session 26-D's MINOR-1), and the Tier-1 cascade tests (do they assert erasure
    SUCCEEDS, or only that rows are gone?).
H3. Report the db-tests EXECUTED TEST COUNT and FILE COUNT for this range, read from the skip-guard's own
    log line rather than the checkmark, and whether this range counts toward the ADR 0015 three-green
    promotion tally (it does not if it is a pull_request-event run — the rule counts full-green runs on
    master; the tally stood at 0 of 3 after Session 26-D).
H4. Publish the four SHARED-FUNCTION CALLERS tables (signOAuthState/verifyOAuthState,
    neutralizeWithSentinels, getBusinessById/canServer, verifyQStashRequest), stating the covering test
    PER CALLER. Confirm the Builder RE-GREPPED rather than inheriting ADR §11.5's four rows.
H5. The SIX Tier-3 diff-verified properties (ADR §11.4) are each confirmed AS a recorded decision, so "no
    test" is a decision and not an oversight.
H6. ⚠️ §13.1's Session 28 contract shipped under its EXACT names — public.signal_candidates, the
    (business_id, status='new') filter, the score DESC / occurred_at DESC / id ASC order, and
    listNewCandidates(client, businessId, limit) in lib/db/signal-candidates.ts. A renamed function here
    means ADR 0021 builds against a contract that does not exist.

OUTPUT: docs/reviews/session-27-reviewer.md —
- OPEN by naming the commit range read (PROC-REVIEW-AT-COMMIT) and stating every citation is from that
  range, never HEAD. Then the four SHARED-FUNCTION CALLERS tables (H4).
- A table: Section / Check / Status (✅/⚠️/❌) / File:Line / Note.
- Then BLOCKER, MAJOR, MINOR, NIT — each with an exact, actionable fix instruction (the correction pass is
  driven directly off these, one step per finding).
- A coverage section: constraint → test → executing CI job → tier → "reddens if broken?".
- A VERDICT: blockers before merge · deferrable debt · and a plain answer to the five questions this track
  exists to settle: (1) can an attacker bind an installation they cannot administer, or squat one;
  (2) can any token reach rest — a table, a cookie, a cache, a log; (3) can one business's failure stall
  the tick for the others, or can any failure class skip SILENTLY; (4) is ANY LLM call reachable from
  Stage A or B; (5) can a signal row escape tenancy or GDPR erasure. Each answer must cite the executed
  proof — the live-Postgres test, the fixture case, or the source scan — not the prose that claims it.
Do NOT modify code. Do NOT write the correction prompts — those come after this report (§4).
```

---

## §4 — Correction pass (Session 27-D)  ·  (paste into Claude Code · Opus)

**Filled in from `docs/reviews/session-27-reviewer.md`** (Reviewer range **`97bb2b76^..5b5bbb9f`**,
E2.1…E2.11, eleven commits, 60 files, +8961/−3). **Eight steps: D0–D7.** Correction passes are normal, not
failures (constitution). **There is no independent re-review pass this session** (mirroring
23-D/24-D/25-D/26-D): this pass fixes the Reviewer's findings, records its own resolutions in the
reviewer's own file, and the founder adjudicates close-out.

**The Reviewer found NO BLOCKER.** All five questions the track exists to settle answer in the safe
direction on executed proof: an attacker cannot bind or squat an installation they cannot administer
(`callback.test.ts:117` + the live-Postgres 23505 case), no token reaches rest, one business's failure
cannot stall the tick, no LLM call is reachable from Stage A or B even transitively, and no signal row
escapes tenancy or GDPR erasure. **33 of 33 `SIGNAL-*` constraints map to an executing job or to an
enumerated Tier-3 decision.** This pass is therefore *not* a rescue — it closes three MAJORs, seven MINORs
and six NITs, of which exactly one (MAJOR-2) is a genuine `AUTHORED-NOT-EXECUTED` coverage gap.

**Founder direction — every finding is fixed, including the deferred ones.** The Reviewer graded MINOR-1…7
and NIT-1…6 as "deferrable debt"; per founder direction (as in Sessions 23-E, 24-D, 25-D and 26-D) they are
**resolved in this pass anyway**, each with its own resolution row — including the two that are
**declined/argued rather than changed** (NIT-5, and NIT-2's disposition). A finding declined, deferred or
adjudicated the other way still gets a row, because an unexplained gap between findings and resolutions is
what makes the trail unreadable later.

### Founder adjudications A-4, A-5, A-6 (binding · settled before this section was written)

The Reviewer correctly refused to choose for us in three places. All three are ruled here, so no step opens
with an open question. **A-1, A-2 and A-3 (§0.2) are untouched and are NOT reopened by this pass** — in
particular A-2's *"NO LAUNCH until all three land"* remains binding, and A-3 still bars the 180-day figure
from every customer-facing surface.

| # | Item | Ruling | Where it lands |
|---|---|---|---|
| **A-4** | MAJOR-3 — the five `GITHUB_APP_*` variables are unconditionally required at parse time, so every environment lacking them fails to boot | **Condition them, and keep fail-fast in both halves.** Declare all five `.optional()` and add a `superRefine` requiring **all five together** when `NODE_ENV === 'production'` — the exact shape `QSTASH_*` and `RESEND_*` already use (`lib/config.ts:125-140`). **The `.refine()` PEM validation stays attached to the value**, so `[sec-MEDIUM-5]`'s parse-time rejection still fires whenever the variable *is* present, in every environment. **Partial configuration is an error, not a mode**: 1–4 of 5 present must fail parse everywhere, including development. And because §2.2's fail-fast rationale must survive, the *runtime* entry points (`lib/signals/github-client.ts`'s App-auth construction and the install callback's OAuth exchange) must throw a named error when a variable is absent — never `undefined` flowing into `createAppAuth`. | `lib/config.ts`; `lib/config.test.ts`; ADR **§2.2 amendment**; step **D1** |
| **A-5** | MINOR-6 — `rate_limited_until` is written but never read; a rate-limited connection is re-claimed and re-minted on the very next tick | **Make it load-bearing.** Add a `rate_limited_until` predicate to `listConnectionsReadyForPoll` (`is null` OR `< now`), so a connection inside a known-active GitHub rate limit is not claimed at all. The comment at `github-connections.ts:128-134` ("harmless… counted again") is **amended, not deleted** — it becomes the record of what the behaviour *was* and why it changed. Documenting the column as UI-only was the cheaper option and is the **named loser**: retrying inside a rate limit whose expiry we already know is precisely what backoff exists to prevent, and it burns the tick's claim budget on a guaranteed 403. | `lib/db/github-connections.ts`; a Tier-1 case in `supabase/__tests__/signals-schema.test.ts`; ADR **§4.5 amendment**; step **D5** |
| **A-6** | MINOR-3 — three exports with no production caller (`upsertSignal`, `scoreAndSortSignals`, `sortScoredSignals`) | **Split, do not treat as one.** `upsertSignal` is **deleted** with its test — the ingest path uses `insertSignal` and the edit path `updateSignalContent`, and `SIGNAL-INGEST-IDEMPOTENT`'s proof lives at `signals-schema.test.ts:251` / `orchestrator.test.ts:358`, **not** at `signals.test.ts:45` (verify that before deleting, and say so in the appendix). `scoreAndSortSignals` / `sortScoredSignals` are **KEPT and annotated** — they carry `SIGNAL-SCORING-DETERMINISTIC`'s shuffled-copy proof (`score.test.ts:107-122`); deleting them would delete the executed proof of a named constraint, which is a test weakened to reach tidiness. Annotate each with the ADR §13.1 / Session 28 surface that will consume it. | `lib/db/signals.ts`, `lib/db/signals.test.ts`, `lib/signals/score.ts`, `lib/signals/index.ts`; step **D4** |

**Why A-4 is the one a Builder is most likely to get half-right.** Two symmetrical drifts, both wrong.
Making the five simply `.optional()` with no `superRefine` ships a production deployment that boots happily
without a private key and fails an hour later inside a cron whose only output is one log line — **the exact
silent failure ADR §2.2 and L-11 forbid**, and the reason they were made required in the first place.
Leaving them required "because §2.2 says fail fast" keeps every unrelated CI job, preview deployment and
contributor checkout coupled to an opt-in feature no tenant uses — which is what reddened *both* jobs at the
range head and was patched **outside** the audited range at `08a4c1e2` by editing two workflow YAMLs. The
ruling is: **required where it runs, absent where it doesn't, malformed nowhere.**

### What the Reviewer found (summary — `session-27-reviewer.md` is authoritative)

| ID | Tier | One line | Fixed in |
|---|---|---|---|
| — | process | `docs/build-guide/session-27.md` and `docs/reviews/session-27-reviewer.md` are **untracked**; `docs/build-guide/session-26.md` is *still* untracked despite 26-D/D0 (`git log --all -- …/session-26.md` is empty) | **D0** (first, deliberately) |
| MAJOR-3 | MAJOR | Five `GITHUB_APP_*` vars unconditionally required at parse time — any environment lacking them fails to boot; A-4 | **D1** |
| NIT-1 | NIT | `lib/config.ts:114-118` — `Buffer.from(val,'base64')` never throws, so the `try/catch` is unreachable dead code | **D1** |
| MAJOR-2 | MAJOR | `app/api/cron/signals-poll/route.ts` has **zero tests**; the new `verifyQStashRequest` caller is unaudited — the one genuine `AUTHORED-NOT-EXECUTED` gap in the range | **D2** |
| NIT-2 | NIT | `signals-poll/route.ts:63-67` — the `try/catch` around `runSignalsTick` is near-dead (the orchestrator returns a summary rather than throwing); house-consistent, so record it, don't "fix" it | **D2** (annotated, not changed) |
| MINOR-1 | MINOR | `listSignalsForWatchedRepo` orders `occurred_at DESC` with **no `id` tiebreak**, and the comment claims a single-column index serves the sort | **D3** |
| MINOR-2 | MINOR | `listActiveWatchedReposForConnection`'s comment overstates index coverage (`is_active` and the sort are not covered) | **D3** |
| MINOR-3 | MINOR | Three dead exports; and `score.ts:111` sends a reader tracing the edit path to `upsertSignal`, which never runs — the caller is `updateSignalContent`; A-6 | **D4** |
| MINOR-4 | MINOR | Two divergent "total orders" both declared authoritative — `sortScoredSignals` ties on `external_id ASC`, §13.1 and `signal_candidates_feed_idx` on `id ASC` | **D4** |
| NIT-4 | NIT | `parse-release.ts:44-55` — `tag_name` is listed in §5.3 as retained but has no `signals` column; self-documented drift to carry into ADR 0021's scope | **D4** |
| MINOR-5 | MINOR | `skipped_draft` and the 90-day first-poll cutoff `continue` increment **nothing** — a drafts-only repo is indistinguishable from a silent one; ADR-conformant, so §4.6 is wrong too | **D5** |
| MINOR-6 | MINOR | `rate_limited_until` written, never read by the claim query; A-5 | **D5** |
| NIT-3 | NIT | `mintInstallationToken` issues `POST …/access_tokens` — a legitimate non-GET against `api.github.com`; record the exception so a future L-5 scan doesn't read as a contradiction | **D6** |
| NIT-5 | NIT | `lib/db/types.ts:23` — `VaultSecretId` still uses the weaker string-literal brand; **pre-existing, out of range** | **D6** (declined with reason) |
| NIT-6 | NIT | Both sub-agents reported `Read` results carrying appended text advertising out-of-toolset tools and offering cached "observations" in place of source; both correctly disregarded it | **D6** |
| MAJOR-1 | MAJOR | The audited range head **never executed green in CI** — green is at `7b4c94e7`, three commits later; one in-range file is not byte-identical to what CI executed | **D6** + **D7** |
| MINOR-7 | MINOR | A-2's launch-blocking condition was recorded **outside** the audited range (`docs/current-phase.md` at `7b4c94e7`) — content correct, provenance unstated | **D6** |
| — | — | Re-green the corrected range; record both run URLs, the `db-tests` skip-guard file/test counts read from the log, and the promotion tally | **D7** |

### Ordering rationale (state it in the resolution log so it does not read as arbitrary)

1. **D0 runs FIRST**, the 25-D/26-D precedent. D1, D4, D5 and D6 all **amend ADR 0020**, and D6 amends the
   reviewer's own file; amending or citing an untracked document produces no diff and no history. D0 also
   catches a **recurrence**: 26-D/D0 was written to commit `session-26.md` and it never landed. Fixing that
   in the same step is cheap and stops the next reviewer rediscovering it.
2. **MAJOR-3 (D1) precedes everything else that runs code.** It is the reason both jobs reddened at the
   range head. Every later step's `npm run test:app` / `test:db` runs in an environment whose boot
   requirements D1 changes — doing it last would mean every intermediate verification ran against the
   configuration the pass exists to replace.
3. **MAJOR-2 (D2) precedes the MINORs.** This track is judged on *covered = executed*; an unexercised auth
   path on a service-role cron route outranks comment accuracy and dead exports by a wide margin.
4. **The two query steps (D3) precede the semantics steps (D4).** MINOR-1's missing tiebreak is a
   *nondeterminism* defect, not a comment defect; MINOR-4's divergent total order is only *reasoned about*
   correctly once the ordering claims in `lib/db/` are true.
5. **A-5's behaviour change (D5) is grouped with MINOR-5's counters**, because both are "the operator
   cannot see what the poller did" and both amend the same two ADR sections (§4.5, §4.6). One ADR
   amendment, one migration-free commit.
6. **CI runs LAST (D7),** and its job is not merely to re-green: it is to produce the green run **for the
   corrected range**, which is what actually closes MAJOR-1. D6 records the *historical* fact (the range
   head's executing SHA was `7b4c94e7`); D7 makes it moot going forward.

### Where resolutions go (CLAUDE.md — REVIEWER-REPORT APPEND-ONLY, revised Session 23-D)

Directly into `docs/reviews/session-27-reviewer.md`, under a **single appended, attributed**
`## CORRECTION PASS (Session 27-D)` section at the **end** of the file — no separate corrections file. The
reviewer's findings above it are **immutable**: not one character edited, no verdict flipped, no status
column rewritten, no RESOLVED stamped onto a finding, nothing reworded, deleted or reordered. The appendix
opens with its author, date, and the commit range it fixed, references each finding **by ID**, and records
*finding → fix → the test that now proves it → the commit SHA*. **A disputed or declined finding is argued
in the appendix, never erased** — NIT-5 and NIT-2 are both of that class in this pass, and each gets a row
saying so. **Never weaken a test to reach green:** if a correction shows an ADR 0020 constraint is
infeasible, **amend ADR 0020** (as an appended amendment, never an in-place rewrite) and say so.

> **The ordering hazard, identical to 25-D's and 26-D's.** `docs/reviews/session-27-reviewer.md` is itself
> untracked. D0 commits it **exactly as the Reviewer wrote it**, before a single resolution row is
> appended, so the immutable text and the appendix land in *different* commits and the diff proves nothing
> above the appendix was touched. **Do not fold D0 and the first resolution row into one commit.**

> **What D0 commits that is unusual: this section.** `docs/build-guide/session-27.md` enters git with §4
> already authored, because §4 *is* D0's work order. That is deliberate — 26-D/D0 recorded the same thing —
> and it must be stated in D0's commit message rather than left to look like an accident of timing.

**ECC budget for the correction pass: ≤1 subagent per step, and only where the finding itself names one.**
D1 → `security-reviewer` (it raised `[sec-MEDIUM-5]`, and A-4 changes when that fail-fast contract fires).
D5 → `database-reviewer` (A-5 changes the claim query, the one place §4.3's exactly-once claim is enforced).
**D0, D2, D3, D4, D6 and D7 carry none** — a git commit, a route test modelled on an existing sibling,
comment corrections, a dead-export deletion, an ADR amendment and a CI push do not need an advisory read.
Do **not** re-run the three §3 reviewers (`database-reviewer`, `security-reviewer`, `type-design-analyzer`)
to confirm their own findings were fixed; the test that now proves the fix is the confirmation.

**The two highest-risk correction classes in this pass:** a config change that silently makes production
bootable without credentials (D1 — the whole point of A-4 is that the *production* half stays hard), and a
claim-query predicate that changes which connections are polled (D5 — re-derive the concurrency argument
yourself against the new `.or()` chain; `signals-schema.test.ts:326`'s exactly-once proof must still hold,
and it must be *re-run*, not assumed).

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
Session 27-D — Mode 3 Part 1: GitHub signal ingestion (ADR 0020), CORRECTION pass. You are fixing the
findings in docs/reviews/session-27-reviewer.md (reviewed range 97bb2b76^..5b5bbb9f, E2.1…E2.11).
Eight steps, D0…D7, each its own commit.

Read now, before anything else:
- docs/reviews/session-27-reviewer.md — IN FULL. It is your work order AND the file you record resolutions
  in. Append a single `## CORRECTION PASS (Session 27-D)` section at the END; do NOT edit any finding in
  place, do NOT create a separate corrections file (CLAUDE.md REVIEWER-REPORT APPEND-ONLY). A finding you
  DISPUTE or DECLINE is argued in the appendix — never erased, never restated as resolved.
- docs/build-guide/session-27.md §0 (Locked L-1..L-13), §0.2 (founder rulings A-1..A-3 — still binding,
  NOT reopened) and §4 (this section — the step list, adjudications A-4/A-5/A-6, and the ordering
  rationale).
- docs/decisions/0020-mode-3-signal-ingestion.md — §2.2 (the env set and the fail-fast rationale A-4
  amends), §4.3/§4.5/§4.6 (the claim, the failure-class table, the tick log line), §6.3/§6.4 (scoring and
  the guarded upsert), §11.1-§11.5 (the tiers, the four source scans, the Tier-3 enumeration, the
  SHARED-FUNCTION CALLERS tables), §13.1 (the Session 28 feed contract), §14 (the 33 SIGNAL-* constraints).
- docs/decisions/0015-test-execution-and-ci-gates.md §2 and §5 — "covered = executed green in CI, never
  authored", and the merge-gate table. MAJOR-1 and MAJOR-2 are both instances of what that ADR exists to
  catch: one is a range with no green run, the other is a route with no test.

Binding rules for this pass:
- L-1..L-13 still hold. Stages A+B only; ZERO LLM call reachable from either; no webhook route and no
  webhook secret; no Stage C-F; no insight-card table; no expiry policy; no cost ceiling; no ai_usage
  write; no embeddings/pgvector; no plan gating; no status value beyond 'new'; no campaigns.origin change;
  no change to lib/social/**; no new runtime dependency. A fix that seems to need one is a STOP.
- A-4, A-5 and A-6 are ALREADY ADJUDICATED (see §4 above). Do NOT re-litigate them, and do NOT ship half
  of A-4 (optional everywhere, or required everywhere). If D1 turns up evidence that the conditional shape
  breaks something, STOP and report rather than quietly picking one half.
- NEVER weaken a test to reach green, and never delete a test to tidy code. A-6 exists precisely because
  two of the three "dead" exports carry SIGNAL-SCORING-DETERMINISTIC's executed proof.
- Each step: /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. npx tsc --noEmit --skipLibCheck;
  scoped vitest run per CLAUDE.md's invocation notes; npm run test:db for Tier-1. New tests must be shown
  to REDDEN against the pre-fix code (mutate, observe red, revert) — asserted-green is not proof.
- ECC: ≤1 subagent per step, and only where §4 names one — D1 security-reviewer, D5 database-reviewer,
  nothing anywhere else. Do not re-run the three §3 reviewers to confirm their own findings.

Confirm these grounding facts (a wrong one is a STOP):
(1) git status — confirm docs/build-guide/session-27.md and docs/reviews/session-27-reviewer.md are BOTH
    untracked (`??`), and that `git log --all -- docs/build-guide/session-26.md` is EMPTY (26-D/D0's
    commit of that file never landed). That is D0's scope.
(2) lib/config.ts — quote the five GITHUB_APP_* declarations and confirm every one is a bare
    z.string().min(1) inside serverSchema with NO superRefine conditioning, then quote the
    QSTASH_*/RESEND_* superRefine below them. The contrast is MAJOR-3.
(3) `git ls-tree 5b5bbb9f -- app/api/cron/signals-poll` returns exactly one file, route.ts, and every
    other cron route calling verifyQStashRequest has a sibling route.test.ts. That is MAJOR-2.
(4) lib/db/signals.ts — confirm listSignalsForWatchedRepo orders occurred_at DESC with NO trailing
    .order('id'), while listRecentSignalsForBusiness immediately above it DOES carry one. That is MINOR-1.
(5) lib/signals/orchestrator.ts:234 and :235 — confirm `if (parsed.status === 'skipped_draft') continue`
    and the 90-day cutoff `continue` increment nothing, and that SignalsTickSummary (:29-45) has no field
    for either. Then confirm ADR §4.6's field list omits them too — MINOR-5 is a design gap, NOT a Builder
    deviation, and the ADR is amended alongside the code.
(6) lib/db/github-connections.ts — confirm recordGithubConnectionRateLimited writes rate_limited_until and
    that listConnectionsReadyForPoll filters only is_active + last_poll_started_at. That is MINOR-6/A-5.
(7) The CI facts behind MAJOR-1: at 5b5bbb9f both jobs FAILED (app-tests 31116039392, db-tests
    31116038037); green is at 7b4c94e7 (app-tests 31119937068, db-tests 31119937379); the delta
    5b5bbb9f..7b4c94e7 is 4 files, +102/−0, touching NO production source.
Output the sixteen findings (3 MAJOR, 7 MINOR, 6 NIT) + "Ready for D0." Then stop.
```

### §4.1 — Correction steps

#### D0 — audit trail: land the governing documents in git  ·  FIRST, by design  ·  no code

```
CORRECTION — Session 27-D · D0. No .ts, no .sql, no .tsx. This step puts the documents the later steps
amend under version control, so every ADR amendment and every appended resolution row is a diff against a
committed file. Invoke no specialist — this is audit-trail integrity.

The defect: docs/build-guide/session-27.md (the work order eleven commits were built from, and the file
whose §4 you are executing right now) and docs/reviews/session-27-reviewer.md (the report that audits
them) are BOTH untracked. A Tier-3 "recorded decision" that lives only in an untracked file can be edited
with no diff, no history and no review — which is the whole reason ADR 0015 §2 requires Tier-3 properties
be enumerated in a COMMITTED owning document. A RECURRENCE compounds it: docs/build-guide/session-26.md is
also still untracked — 26-D/D0's work order named it explicitly and the commit landed ADR 0019 and
session-26-reviewer.md but not the build guide itself (`git log --all -- docs/build-guide/session-26.md`
is empty). Land all three now.

DO — commit these three files EXACTLY AS THEY STAND, with no edits in this commit:
- docs/build-guide/session-27.md   (it enters git WITH §4 already authored — §4 is this step's own work
                                    order, so it cannot land later. Say so in the commit message.)
- docs/reviews/session-27-reviewer.md
- docs/build-guide/session-26.md    (the 26-D/D0 recurrence, landed unmodified — do NOT edit it, do NOT
                                    append anything to it, and do NOT reopen any Session 26 finding.)
Do NOT append the CORRECTION PASS section to the reviewer report here: it must enter git as the Reviewer
wrote it, so the later diff proves nothing above the appendix was touched. Do NOT amend ADR 0020 here
(that is D1/D4/D5/D6). Do NOT stage .gitignore, docs/current-phase.md or docs/build-guide/session-24.md —
those working-tree modifications are unrelated to this pass; leave them exactly as they are.

VERIFY: git status clean of these three paths; `git show <D0-sha>:docs/reviews/session-27-reviewer.md`
resolves and is byte-identical to the file as the Reviewer left it; the commit contains no
.ts/.sql/.tsx/.json file; `git log --all -- <each path>` is now non-empty.
On commit: "D0 complete — session-27.md, session-27-reviewer.md and session-26.md committed unmodified.
session-27.md lands with its §4 correction pass authored, since §4 is this step's own work order; the
reviewer report lands as written, before any resolution row, so the appendix is provably additive.
session-26.md is a 26-D/D0 recurrence — that step named the file and it never landed." Then stop.
```

#### D1 — MAJOR-3 + NIT-1 + A-4: condition the five `GITHUB_APP_*` vars, keep both halves of fail-fast

```
CORRECTION — Session 27-D · D1. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
security-reviewer ONCE (it raised [sec-MEDIUM-5], and this step changes WHEN that fail-fast contract
fires); no other agent.

THE DEFECT (MAJOR-3), in one sentence: lib/config.ts declares all five GITHUB_APP_* variables as bare
z.string().min(1) inside serverSchema with no superRefine conditioning, and parseServerEnv() runs on first
config.server.* access — so ANY deployment, CI job, preview environment or contributor checkout lacking
all five throws on boot, for an opt-in feature no existing tenant uses. This is not hypothetical: it is
exactly what reddened BOTH jobs at the range head, and it was patched only at 08a4c1e2 — OUTSIDE the
audited range — by adding the vars to two workflow YAMLs, i.e. by making every future workflow carry a
dependency on a feature it does not exercise.

A-4 IS ALREADY ADJUDICATED (§4 above). Ship BOTH halves; half of it is a worse outcome than neither.

BUILD:
1. lib/config.ts — declare all five GITHUB_APP_* entries .optional(). Keep GITHUB_APP_PRIVATE_KEY's
   .refine() ATTACHED TO THE VALUE so it still fires whenever the variable is present, in every
   environment. [sec-MEDIUM-5]'s contract is "a malformed key is rejected at parse time" — that must
   survive this change untouched.
2. Extend the EXISTING superRefine (the one already carrying QSTASH_* and RESEND_*, lib/config.ts:125-140
   — match its shape exactly, do not invent a second mechanism):
   - if process.env.NODE_ENV === 'production' and any of the five is missing → addIssue naming ALL five.
   - PARTIAL CONFIGURATION IS AN ERROR IN EVERY ENVIRONMENT: if at least one of the five is present and at
     least one is absent → addIssue, regardless of NODE_ENV. "1 of 5 set" is a mis-paste, never a mode.
3. NIT-1 — delete the unreachable try/catch at :114-118. Buffer.from(val,'base64') does not throw on
   malformed input (Node silently discards invalid characters), so the catch arm is dead; rejection is
   carried entirely by the PEM regex. Replace it with a one-line comment stating exactly that, so the next
   reader does not "restore the missing error handling".
4. Runtime fail-fast (the half that preserves §2.2's rationale): lib/signals/github-client.ts's App-auth
   construction and the install callback's OAuth exchange must throw a NAMED error when a required value
   is absent — never let `undefined` flow into createAppAuth or into the token exchange body. A missing
   credential must fail loudly at the seam, not produce a confusing 401 from GitHub an hour later.
5. AMEND ADR 0020 §2.2 (append an amendment; never rewrite the original text): record that the five are
   production-required and present-or-all-absent elsewhere, that the PEM refine is unconditional, that the
   runtime seams throw, and name the loser — unconditionally required, which couples every unrelated
   environment to an opt-in feature and was patched outside the audited range at 08a4c1e2.
6. .env.local.example — mark the five as required in production only, keeping the base64 instructions.

VERIFY — new lib/config.test.ts cases, each shown to REDDEN against the pre-D1 schema:
- non-production parse SUCCEEDS with all five absent (this is the case that fails today);
- production parse FAILS with all five absent, and the message names all five;
- partial configuration (exactly one present) FAILS in development AND in production;
- a present-but-malformed key still FAILS in development — [sec-MEDIUM-5] preserved. Keep all three
  existing rejection cases (truncated base64 / non-base64 / valid-base64-non-PEM) passing unchanged.
- Then prove the CI half: confirm the suites pass with the GITHUB_APP_* env entries REMOVED from
  .github/workflows/app-tests.yml and db-tests.yml, and remove them in this commit. If they must stay,
  that is evidence A-4 was implemented wrongly — STOP and report.
- npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db. Address every security-reviewer
  finding before commit.
Append the D1 rows (MAJOR-3 and NIT-1; record A-4 as its own adjudication row).
On commit: "D1 complete — MAJOR-3 closed: the five GITHUB_APP_* variables are .optional() with a
superRefine requiring all five in production and rejecting partial configuration everywhere (A-4), the
PEM .refine() still fires on any present value ([sec-MEDIUM-5] intact), the runtime seams throw a named
error rather than passing undefined into createAppAuth, and 08a4c1e2's workflow env entries are removed as
no longer needed; NIT-1's unreachable base64 try/catch deleted with the reason recorded; ADR §2.2
amended." Then stop.
```

#### D2 — MAJOR-2 + NIT-2: the one real coverage gap — `signals-poll/route.test.ts`

```
CORRECTION — Session 27-D · D2. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. NO specialist
BY DESIGN: the property is proved by a test that exercises the route's auth paths, which is strictly
stronger than an advisory read.

THE DEFECT (MAJOR-2): `git ls-tree 5b5bbb9f -- app/api/cron/signals-poll` returns exactly one file,
route.ts. Every OTHER cron route that calls verifyQStashRequest has a sibling route.test.ts. Unexercised
today: the qstash-mode verification path, the CRON_SECRET timingSafeEqual bearer fallback, the dev
x-cron-dev-trigger bypass, the 405 method guards, and the cron-auth-failure warn line. runSignalsTick is
well covered at lib/signals/orchestrator.test.ts — but that is the ORCHESTRATOR, not the route. This is
exactly the SHARED-FUNCTION CALLERS shape that produced BOTH Session 22 blockers: one caller proven is not
the function proven.

BUILD — app/api/cron/signals-poll/route.test.ts, modelled on app/api/cron/capture-learning/route.test.ts
(read it first and mirror its vi.hoisted mock-control shape; do not invent a new harness). At minimum:
- qstash mode: an unsigned/invalid request → 401, AND runSignalsTick is NOT called (assert the mock's
  call count is 0 — a 401 that still ran the tick is the failure this test exists to catch);
- qstash mode: a valid signed request → 200, tick called exactly once;
- secret mode: wrong bearer → 401, tick not called;
- secret mode: correct bearer → 200;
- secret mode in development: x-cron-dev-trigger: true → 200; and confirm that bypass is NOT available
  when NODE_ENV is production;
- GET is 405 in qstash mode; POST is 405 in secret mode;
- the cron-auth-failure warn line is emitted with route: 'signals-poll' and the QStashAuthError reason —
  and carries NO request body, header value or token.
Then ADD THE ROW to ADR §11.5's verifyQStashRequest caller table naming this test, so the caller table is
true again. While there: the pre-existing app/api/cron/process-deletions/route.ts gap the Reviewer noted is
OUT OF SCOPE — do not fix it here; note it in the appendix as pre-existing and unaddressed.

NIT-2 — do NOT delete the try/catch at :63-67 around runSignalsTick. It is near-dead (the orchestrator
wraps its own body and returns a summary), but it is byte-consistent with capture-learning, and house
consistency across the cron routes is worth more than removing four lines. Add a one-line comment saying
it is defence-in-depth for a throw the orchestrator does not currently produce, so it is not mistaken for
live error handling. Record the disposition in the appendix as ARGUED-NOT-CHANGED.

VERIFY: prove the new suite REDDENS against a mutated route — temporarily invert the qstash auth guard
(let the unsigned request through), observe the 401/never-called cases fail, then REVERT the mutation.
npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D2 rows (MAJOR-2, NIT-2).
On commit: "D2 complete — MAJOR-2 closed: app/api/cron/signals-poll/route.test.ts added, covering both
auth modes, the dev bypass, both 405 guards and the cron-auth-failure line, each asserting runSignalsTick
is not called on rejection; demonstrated to redden against an inverted auth guard and reverted; ADR §11.5's
verifyQStashRequest caller table now names it. NIT-2's near-dead try/catch kept for house consistency with
capture-learning and annotated as such. process-deletions' pre-existing gap noted, not addressed." Then
stop.
```

#### D3 — MINOR-1 + MINOR-2: make the ordering deterministic and the index claims true

```
CORRECTION — Session 27-D · D3. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist:
these are a missing sort key and two comments that overstate what an index covers.

THE DEFECTS:
- MINOR-1: lib/db/signals.ts's listSignalsForWatchedRepo filters (watched_repo_id, business_id), orders
  occurred_at DESC, limit 50 — with NO trailing .order('id'). Every OTHER ordered query in that file
  carries one. Two releases sharing an occurred_at are returned in non-deterministic order, and this is
  the POLLER'S edit-detection read: a non-deterministic 50-row window under a limit can, in principle,
  return a different subset run to run. The comment at :43-44 also claims the query "matches
  signals_watched_repo_id_idx (watched_repo_id) EXACTLY" — that index is single-column and cannot serve
  the sort. Found independently by the Reviewer AND by database-reviewer.
- MINOR-2: lib/db/watched-repos.ts's listActiveWatchedReposForConnection filters
  (connection_id, business_id, is_active), orders id ASC, limit 20. watched_repos_connection_id_idx is
  (connection_id) only — is_active and the sort are not covered. Low practical impact behind the 20-row
  cap; the comment at :48-51 is what is wrong.

BUILD:
1. MINOR-1 — add `.order('id', { ascending: true })` after the occurred_at order. Correct the comment to
   say the index serves the FILTER, not the sort, and that id is the tiebreak that makes the window
   deterministic.
2. MINOR-2 — correct the comment only. Do NOT widen the index: that is a migration, and a new migration in
   a correction pass must be justified by a defect, not by a comment being wrong. State in the comment
   that (connection_id) serves the filter's leading column, that is_active and the id sort are not
   index-covered, and that this is acceptable at the 20-row cap — then name widening to
   (connection_id, is_active, id) as the deferred option, with the ADR section a future session would
   record it under.
3. Re-read the ordering comments on the OTHER queries in both files while you are here. If any other one
   overstates its index match, correct it in this commit and list it in the appendix — a comment audit
   that stops at the two the Reviewer happened to open is how the third one survives.

VERIFY — a Tier-2 case in lib/db/signals.test.ts asserting listSignalsForWatchedRepo issues BOTH order
calls (occurred_at DESC then id ASC), shown to redden against the pre-D3 query builder. Do not assert
against a live DB here; the existing Tier-1 suite owns behaviour, this asserts the query shape.
npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D3 rows (MINOR-1, MINOR-2, plus any additional comment corrected under item 3).
On commit: "D3 complete — MINOR-1 closed: listSignalsForWatchedRepo now carries an id ASC tiebreak, so the
poller's edit-detection window is deterministic under equal occurred_at, and its comment no longer claims a
single-column index serves the sort; MINOR-2 closed by correcting the comment rather than shipping a
migration, with the (connection_id, is_active, id) widening named as the deferred option." Then stop.
```

#### D4 — MINOR-3 + MINOR-4 + NIT-4 + A-6: dead exports, the wrong citation, and two "total orders"

```
CORRECTION — Session 27-D · D4. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist:
this is a deletion, a comment citation, and one ADR sentence about which order is authoritative.

THE DEFECTS:
- MINOR-3: upsertSignal (lib/db/signals.ts:72) has no production caller — only its own test.
  scoreAndSortSignals and sortScoredSignals (lib/signals/score.ts:85-101) likewise: the orchestrator calls
  scoreSignal per-signal and never sorts. Worse, score.ts:111 documents the edit path as "the caller
  re-writes signals' content columns first (lib/db/signals.ts's upsertSignal…)" — the orchestrator
  actually calls updateSignalContent (orchestrator.ts:120). A reader tracing the edit path is sent to a
  function that never runs.
- MINOR-4: sortScoredSignals breaks ties on external_id ASC; the DB feed contract (§13.1) and
  signal_candidates_feed_idx break on id ASC. Both are deterministic; they can order an exact tie
  differently. Currently harmless ONLY because the in-memory sorter is unused — i.e. harmless for a reason
  that expires the moment Session 28 uses it.
- NIT-4: parse-release.ts:44-55 records that tag_name is listed in ADR §5.3 as retained but has no signals
  column to receive it. Self-documented drift.

A-6 IS ALREADY ADJUDICATED (§4 above). Split the three exports; do not treat them as one deletion.

BUILD:
1. BEFORE deleting anything, VERIFY where SIGNAL-INGEST-IDEMPOTENT is actually proved: confirm
   supabase/__tests__/signals-schema.test.ts:251 and lib/signals/orchestrator.test.ts:358 carry it, and
   that lib/db/signals.test.ts:45 is an additional shape assertion, not the constraint's only proof. Quote
   both in the appendix. If that check comes out the other way, STOP — deleting the only executed proof of
   a named constraint is exactly the failure ADR 0015 exists to prevent.
2. Delete upsertSignal (lib/db/signals.ts) and its test case (lib/db/signals.test.ts:45-58). The ingest
   path is insertSignal; the edit path is updateSignalContent. Remove it from any barrel export.
3. KEEP scoreAndSortSignals and sortScoredSignals — score.test.ts:107-122 is SIGNAL-SCORING-DETERMINISTIC's
   shuffled-copy proof and runs through them. Annotate each with the ADR §13.1 / Session 28 surface that
   will consume it, so the next reader does not re-flag them as dead.
4. MINOR-3's citation: correct score.ts:111 to name updateSignalContent (lib/db/signals.ts), the function
   the orchestrator actually calls at orchestrator.ts:120.
5. MINOR-4: state in score.ts, at sortScoredSignals, that it is a SCORING-SIDE utility whose order is NOT
   the feed order, and that ADR §13.1's `ORDER BY score DESC, occurred_at DESC, id ASC` is authoritative
   for anything read from signal_candidates. Add the same sentence to ADR §6.3 as an amendment, so §13.1's
   contract cannot be contradicted by a helper a future session imports by accident.
6. NIT-4: carry the tag_name drift into ADR 0021's scope EXPLICITLY — a line in ADR 0020 §15 (or the
   equivalent deferral section) stating that §5.3 lists tag_name as retained while no signals column
   receives it, and that ADR 0021 decides either the column or the removal. Do NOT add the column here
   (that is a migration, out of scope, and L-1's boundary).

VERIFY: npx tsc --noEmit --skipLibCheck proves item 2 has no remaining importer; npm run test:app;
npm run test:db. Confirm score.test.ts's determinism cases still pass UNCHANGED — if they needed editing,
item 3 was done wrong.
Append the D4 rows (MINOR-3, MINOR-4, NIT-4; record A-6 as its own adjudication row, including the item-1
verification that made the deletion safe).
On commit: "D4 complete — A-6 applied: upsertSignal and its test deleted after confirming
SIGNAL-INGEST-IDEMPOTENT is proved at signals-schema.test.ts:251 and orchestrator.test.ts:358 rather than
there; scoreAndSortSignals/sortScoredSignals KEPT (they carry SIGNAL-SCORING-DETERMINISTIC's shuffled
proof) and annotated as Session 28 entry points; MINOR-3's score.ts:111 citation corrected to
updateSignalContent; MINOR-4 closed by declaring §13.1's id ASC authoritative for the feed and the
in-memory sorter explicitly non-feed (ADR §6.3 amended); NIT-4's tag_name drift carried into ADR 0021's
scope." Then stop.
```

#### D5 — MINOR-5 + MINOR-6 + A-5: make the poller's skips and its backoff visible

```
CORRECTION — Session 27-D · D5. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer ONCE (A-5 changes the claim query, the one place §4.3's exactly-once claim is enforced);
no other agent.

THE DEFECTS:
- MINOR-5: orchestrator.ts:234 (`if (parsed.status === 'skipped_draft') continue`) and :235 (the 90-day
  first-poll cutoff `continue`) increment NOTHING. A repo publishing only drafts is indistinguishable in
  the tick line from a repo publishing nothing, and a first poll that discards 200 old releases reports no
  trace of it. This is ADR-CONFORMANT — §4.6's field list omits both — so it is a design gap, not a Builder
  deviation, and the ADR is corrected alongside the code. Note the consequence the Reviewer flagged:
  SIGNAL-TICK-OBSERVABLE's test (orchestrator.test.ts:138) asserts §4.6's 16 fields and would NOT redden
  for these two, because §4.6 omits them too. Fixing §4.6 is what gives the constraint teeth.
- MINOR-6 / A-5: recordGithubConnectionRateLimited (github-connections.ts:120-145) persists
  rate_limited_until, but listConnectionsReadyForPoll (:45-59) filters only on is_active and
  last_poll_started_at. A rate-limited connection is re-claimed and re-minted on the very next tick,
  guaranteed to 403 again.

A-5 IS ALREADY ADJUDICATED (§4 above): make the column load-bearing. Do NOT ship the documentation-only
option; it is the named loser.

BUILD:
1. SignalsTickSummary (orchestrator.ts:29-45) — add `skippedDraft` and `skippedPreCutoff`. Increment at
   :234 and :235 respectively. They are CONTENT FILTERS, not failure classes: keep them out of `failed`
   and out of §4.5's failure table, and say so in a comment, so a future reader does not read a drafts-only
   repo as an error.
2. AMEND ADR §4.6 (append an amendment; never rewrite): add both field names to the canonical tick-line
   field list, and state that they are content-filter counters distinct from §4.5's failure counters.
3. Extend orchestrator.test.ts:138's field-presence assertion to the new field list, and add two behaviour
   cases: a repo whose releases are all drafts reports skippedDraft > 0 and signalsIngested === 0; a first
   poll with releases older than the 90-day cutoff reports skippedPreCutoff > 0. Both must redden against
   the pre-D5 orchestrator.
4. A-5 — add the rate_limited_until predicate to listConnectionsReadyForPoll: claim only connections whose
   rate_limited_until IS NULL or is in the past. Use the existing formatISO/date-fns convention for the
   comparison value (never new Date().toISOString()). Note this is a SECOND .or() alongside the
   last_poll_started_at one — confirm the two AND together as intended in the emitted PostgREST query, and
   state in the comment which parts of the filter (is_active, and the ordering) the
   github_connections_poll_claim_idx still serves and which it does not. Do not overstate the index match;
   that is exactly MINOR-2's defect.
5. AMEND the comment at github-connections.ts:128-134 rather than deleting it: it currently records the
   re-attempt as "harmless… counted again". Keep that text as the record of the prior behaviour, and add
   why it changed (the 403 is guaranteed, it burns claim budget, and the expiry is already known).
6. AMEND ADR §4.5 recording that rate_limited_until is now a claim predicate, not an informational stamp.
7. Add a Tier-1 case in supabase/__tests__/signals-schema.test.ts: a connection with rate_limited_until in
   the FUTURE is not returned by the claim query; the same connection with it in the past IS. Live
   Postgres, not a mocked client.

VERIFY: re-derive the concurrency argument yourself against the new .or() chain and state it in the
appendix — signals-schema.test.ts:326's exactly-once-under-concurrency proof must still hold, and it must
be RE-RUN (npm run test:db), not assumed. Confirm the new Tier-1 case reddens against the pre-D5 claim
query. npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db. Address every
database-reviewer finding before commit.
Append the D5 rows (MINOR-5, MINOR-6; record A-5 as its own adjudication row).
On commit: "D5 complete — MINOR-5 closed: skippedDraft and skippedPreCutoff added to SignalsTickSummary
and to the canonical tick line, with ADR §4.6's field list amended so SIGNAL-TICK-OBSERVABLE actually
reddens for them, and two behaviour cases added; MINOR-6 closed per A-5: rate_limited_until is now a claim
predicate in listConnectionsReadyForPoll, proved on live Postgres (future → not claimed, past → claimed),
the prior 'harmless' comment kept as the record of what changed, ADR §4.5 amended; exactly-once-under-
concurrency re-run and still green." Then stop.
```

#### D6 — MAJOR-1 + MINOR-7 + NIT-3 + NIT-5 + NIT-6: the provenance record and the arguments

```
CORRECTION — Session 27-D · D6. Documentation and process only — no .ts, no .sql. No specialist.

THE DEFECTS:
- MAJOR-1: at the audited range head (5b5bbb9f) BOTH jobs FAILED (app-tests 31116039392, db-tests
  31116038037). The green runs are at 7b4c94e7, three commits later (app-tests 31119937068, db-tests
  31119937379). The intervening delta is 4 files / +102 / −0 and touches no production source, so the
  constraints are NOT AUTHORED-NOT-EXECUTED — but the audited range itself has no green CI evidence, and
  one file INSIDE the range (lib/signals/github-client.test.ts) is not byte-identical to what CI executed.
  The Reviewer offered two fixes and judged (a) sufficient and cheaper. Do (a) here; D7 makes the whole
  question moot going forward.
- MINOR-7: docs/current-phase.md:67-75 at 7b4c94e7 records A-2's launch-blocking condition correctly and
  completely — but docs/current-phase.md does not appear in 97bb2b76^..5b5bbb9f, so within the audited
  range the mandatory A-2 recording is absent. There is nothing wrong with the CONTENT; the provenance is
  what is unstated, and it resolves together with MAJOR-1.

BUILD:
1. docs/current-phase.md — in the Session 27 entry, state explicitly: the E2.1…E2.11 range is
   97bb2b76^..5b5bbb9f; the SHA whose tree CI actually executed green is 7b4c94e7; enumerate the four
   files in the delta (3a4a5f7a's eslint scope annotation on a pre-existing require() in
   github-client.test.ts, 08a4c1e2's GITHUB_APP_* workflow env vars — since removed by D1 — and 7b4c94e7's
   docs-only change) and state that none is production source. A future reader must not be misled by
   E2.11's commit subject into believing the range head was green.
2. ADR 0020 §11 — the same statement, one paragraph, so the ADR that owns the constraint table also owns
   the fact of which SHA executed it.
3. MINOR-7 — in the same current-phase.md entry, name the SHA at which A-2's condition was recorded
   (7b4c94e7) and that it landed after the range head. The condition itself is unchanged and still
   binding: NO LAUNCH until the Evidence Pack entry, the Art. 6(1)(f) balancing test and the /privacy
   prose all land. Do not restate or weaken it — cite §0.2 A-2.
4. NIT-3 — record in ADR §2.4 (or wherever L-5 "zero writes against api.github.com" is stated) that
   mintInstallationToken issues POST /app/installations/{id}/access_tokens, that this mints a CREDENTIAL
   rather than writing customer content, and that it is therefore the single enumerated exception to a
   naive "no non-GET against api.github.com" scan. A future reviewer scanning for that pattern must find
   the exception already named rather than open it as a finding.
5. NIT-5 — ARGUE, DO NOT CHANGE. lib/db/types.ts:23's VaultSecretId uses the weaker string-literal brand
   (_brand: 'VaultSecretId') that the new UntrustedText comments argue against. It is PRE-EXISTING and
   outside this range. Changing a vault-adjacent type in a correction pass, with no test that would catch
   a regression in the vault path, is a worse trade than leaving it. Record it in the appendix as
   DECLINED-WITH-REASON, and add a line to ADR 0020 §15 flagging it for whichever session next touches
   vault-adjacent types. Do not edit types.ts.
6. NIT-6 (process) — record in .wolf/cerebrum.md (Key Learnings or Do-Not-Repeat, dated) that both the
   database-reviewer and security-reviewer sub-agent sessions received Read results carrying appended text
   advertising tools outside their toolset and offering cached "observations" in place of reading the real
   files, and that both correctly disregarded it and read the source. The rule to write down: a REVIEWER
   agent reads source at the stated commit, never a cached paraphrase — PROC-REVIEW-AT-COMMIT already
   requires it, and this is the mechanism that could quietly erode it. Also note it in the appendix.

VERIFY: no .ts/.sql/.tsx in the diff; every run URL and SHA in the text resolves; the four delta files are
enumerated by name; §0.2 A-2's text is cited, not paraphrased into something weaker.
Append the D6 rows (MAJOR-1, MINOR-7, NIT-3, NIT-5 as DECLINED-WITH-REASON, NIT-6).
On commit: "D6 complete — MAJOR-1 recorded: the E2.1…E2.11 range head 5b5bbb9f never ran green; the
executing SHA is 7b4c94e7 and its 4-file, +102/−0, no-production-source delta is enumerated in
current-phase.md and ADR §11; MINOR-7 resolved by naming the SHA at which A-2's still-binding
launch-blocking condition was recorded; NIT-3's POST /access_tokens named as L-5's single enumerated
exception; NIT-5 DECLINED with reason (pre-existing vault-adjacent brand, flagged in §15 for the session
that next touches it); NIT-6 recorded in .wolf/cerebrum.md." Then stop.
```

#### D7 — re-green the corrected range and close out

```
CORRECTION — Session 27-D · D7. CI and close-out. No specialist.

This step is what actually closes MAJOR-1 going forward: D6 records the historical fact, D7 produces a
green run for the CORRECTED range, including D1's conditional config, D2's new route suite, D5's new
Tier-1 claim case and the two new orchestrator behaviour cases.

DO:
1. Push D0…D6. Run BOTH workflows (app-tests and db-tests) against the D6 head.
2. Read the LOGS, not the checkmarks. Record for db-tests the skip-guard's own line — the file count AND
   the test count it prints — and for app-tests the file/test counts. A suite that executed zero tests is
   a FALSE-GREEN and there is no override for the skip-guard (ADR 0015 §5).
3. Confirm the app-tests run is green WITHOUT any GITHUB_APP_* entry in the workflow env. If it is not,
   A-4 was implemented wrongly in D1 — STOP and report rather than re-adding the vars.
4. docs/current-phase.md — Session 27 entry updated with both run URLs, both file/test counts read from
   the log, and the db-tests PROMOTION TALLY. Note precisely: ADR 0015 §5 counts full-green runs on
   MASTER; these are pull_request-event runs on a branch, so this range contributes NOTHING and the tally
   stands at 0 of 3, unchanged since Session 26-D. Do not round that up.
5. §5 of docs/build-guide/session-27.md — walk the close-out list and confirm each item landed:
   current-phase.md, ADR 0010 §D2.5's four cascade rows, CLAUDE.md's lib/signals/ rule, ADR 0020's
   status/close-out block, the .wolf files, and session-28.md's Reality block still matching what Session
   27 actually shipped AFTER this correction pass (D1's config change and D5's claim-query change are both
   things session-28.md may describe — correct it if so, BEFORE Session 28's Architect runs).
6. Finish the appendix: confirm every one of the sixteen findings (3 MAJOR, 7 MINOR, 6 NIT) has a row, and
   that the three adjudications A-4/A-5/A-6 each have their own. A finding with no row is the gap this
   whole convention exists to prevent — including the declined ones.

VERIFY: both runs green at the D6 head; the skip-guard line quoted verbatim; the promotion tally states
0 of 3 with the reason; the appendix's row count matches the finding count.
On commit: "D7 complete — corrected range executed green in CI; app-tests <url>, db-tests <url>; <N>
files / <M> tests (db-tests, skip-guard's own line), <N> files / <M> tests (app-tests); app-tests green
with NO GITHUB_APP_* entries in the workflow env, proving A-4; MAJOR-1 now moot for the corrected head;
promotion tally unchanged at 0 of 3 (pull_request-event runs on a branch — ADR 0015 §5 counts master runs
only); all sixteen findings and three adjudications carry a resolution row in
docs/reviews/session-27-reviewer.md." Then stop.
```

---

## §5 — Docs to update at close-out (Session 27 done)

- `docs/current-phase.md` — Session 27 entry; the `db-tests` promotion tally with the run URLs and the
  skip-guard's own file/test counts read directly from the log (not the checkmark).
- `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — the cascade row per new table (**mandatory**,
  CLAUDE.md).
- `CLAUDE.md` — the `lib/signals/` module-boundary rule, stated in the same form as the `/lib/social/` and
  `/lib/ai/` rules (per ADR 0020 §10).
- `docs/decisions/0020-mode-3-signal-ingestion.md` — status/close-out block.
- `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — per the OpenWolf protocol.
- `docs/build-guide/session-28.md` — confirm its Reality block still matches what Session 27 actually
  shipped; correct it if not, **before** Session 28's Architect runs.
- `docs/reviews/session-27-reviewer.md` — the single appended `## CORRECTION PASS (Session 27-D)` section,
  with a row per finding (all sixteen, including the declined ones) and per adjudication (A-4, A-5, A-6).
  Written by §4's steps, never by editing a finding in place.
