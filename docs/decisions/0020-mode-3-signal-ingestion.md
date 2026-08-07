# ADR 0020 — Mode 3 Part 1: GitHub Signal Ingestion (Stages A + B)

- **Status:** Accepted. Session 27 / Track E (E1 Architect phase). Builder (E2) transcribes; no code in this
  document.
- **Date:** 2026-08-04
- **Supersedes / amends:** none. **Extends** ADR 0017 (Mode 2 brief pipeline — Stage F re-enters it) and
  ADR 0018 (the cron/worker pattern reused here). **Governed by** ADR 0015 (test-execution tiers) and
  ADR 0010 Amendment 2 (erasure cascade). **Does not touch** ADR 0002 (`SocialProvider`).
- **Scope:** Mode 3 **Stages A (ingestion) and B (deterministic candidate scoring) only**. A GitHub App the
  business installs, a per-business multi-repo watch list, an hourly scheduled poller, a raw-signal store,
  and a deterministic scoring/dedup pass. **Zero LLM calls.** Stages C–F are ADR 0021 / Session 28.
- **Binding input:** `docs/build-guide/session-27.md` §0 (L-1…L-13, the D-1…D-8 ledger) and §0.1
  (Q1…Q8) — adjudicated with the founder on 2026-08-04, encoded below, **not re-opened**.
- **Grounding:** every repo claim in this document is cited `file:line` from a single `ecc:code-explorer`
  sweep run at the head of Session 27 (branch `session-22-d`, head `5c8c0aa5`). Three advisory reviewers
  (`database-reviewer`, `security-reviewer`, `ecc:type-design-analyzer`) were dispatched **once**, in one
  parallel batch, after draft answers existed; their objections are folded in below and attributed inline
  as `[db-*]`, `[sec-*]`, `[type-*]`. They were not re-consulted.

---

## §0 — Binding decisions

**Locked (L-1…L-13)** are encoded verbatim in intent from `session-27.md` §0 and are not restated here in
full. The load-bearing ones and where this ADR discharges them:

| Locked | Discharged in |
|---|---|
| L-1 Stages A+B only, zero LLM | §1.3, §11.3 (`SIGNAL-NO-LLM-IN-STAGE-AB` source scan), §14 |
| L-2 GitHub App, not OAuth App, not PAT | §2.1, §0.1 (A-1) |
| L-3 Scheduled poll; webhook **seam** only, no route | §3.4, §4.1 |
| L-4 Multi-repo watch list per business | §3.2 |
| L-5 Read-only against GitHub, forever | §5.4, §12 (`SIGNAL-READ-ONLY-GITHUB`) |
| L-6 Stage B deterministic — no embeddings, no pgvector, no LLM | §6 |
| L-7 One exact-pinned GitHub client dependency pre-authorised | §10.3 |
| L-8 Plan gating deferred, seam named in code | §8.6 |
| L-9 Third-party personal data is first-class | §9 |
| L-10 Every ingested byte untrusted | §7 |
| L-11 Failure isolation + idempotency are contract | §4.3, §4.5 |
| L-12 RLS / cascade / purge obligations in full | §3.5, §3.6, §9.4 |
| L-13 Contract discipline (Zod, atomic, bounded, date-fns, config, no-console) | throughout; §12 |

**Adjudicated decision ledger (D-1…D-8)** is carried from `session-27.md` §0 unchanged. Each named loser is
argued at its own section: D-1 §1.3, D-2 §2.1, D-3 §3.4, D-4 §3.2, D-5 §6.5, D-6 §10.3, D-7 §8.6, D-8 §10.

### §0.1 — Founder adjudications (2026-08-04)

Three questions were escalated during E1 rather than decided by the Architect. All three were adjudicated
before this document was written.

- **A-1 — GitHub App user-authorization leg: APPROVED.** The App enables *"Request user authorization
  (OAuth) during installation"*, adding `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`. This is the
  **only** mechanism that closes the tenant-confusion BLOCKER at §8.2 `[sec-BLOCKER-1]`. Founder rationale:
  *"we need OAuth (just like Vercel and Supabase) — this is the way to go."*

  **This does not weaken L-2, and the distinction matters enough to state precisely.** Vercel's and
  Supabase's GitHub integrations are both GitHub **Apps** with the user-authorization option enabled. The
  OAuth leg proves **who is installing** — an identity check, consumed once at bind time and discarded
  (§2.4). The App's own private key remains the only thing that grants repository access. L-2's named loser,
  a **standalone OAuth App** holding a long-lived, broadly-scoped user token in Vault for a read-only feed,
  remains rejected and is not what was approved here.

- **A-2 — Evidence Pack entry for third-party personal data: APPROVED as a tracked follow-on, not a
  blocker on this ADR.** Condition, binding: **no launch** until the Evidence Pack entry, the Art. 6(1)(f)
  balancing test, and the `/privacy` prose all land. Recorded at §9.6 and in `docs/current-phase.md` at
  close-out.

- **A-3 — Retention reaper: DEFERRED**, on the ADR 0019 A-2 precedent. Condition, binding: **the 180-day
  retention figure stays out of every customer-facing surface** — `/privacy`, marketing, in-product copy,
  support macros — until an executor exists. A retention promise with no reaper is a false statement to a
  regulator. Recorded at §9.5.

---

## §1 — Context and decision summary

### 1.1 What happens today

SOSH has exactly two content-creation paths, and **in both, the human must already know what to talk
about**:

- **Mode 2 — objective-driven generation** (ADR 0017): the user types an objective; the brief pipeline
  turns it into a campaign brief, then posts.
- **Mode 1 — Studio** (ADR 0019): the user writes a draft; the model suggests improvements against
  governed memory.

Nothing in the product ever **notices that something happened worth saying**. A customer can ship the
biggest release of their year and SOSH will sit silent until a human opens a form and describes it. That
gap is what Mode 3 exists to close, and it is a different kind of feature from the other two — it is the
only place the product initiates.

### 1.2 The six-stage pipeline

```
A. Ingestion            (Tier 0, scheduled)  — watch list only, narrow by design   ← THIS ADR
B. Candidate scoring    (Tier 0)             — deterministic score / dedup         ← THIS ADR
C. Triage               (Tier 3, agentic)    — bounded tool loop, campaign-worthy? ← ADR 0021
D. Insight card         (Tier 1)             — observation, angles, confidence     ← ADR 0021
E. Human insight inbox                       — approve / dismiss / save            ← ADR 0021
F. Approved card seeds Mode 2 Stage A        — re-entry, no new machinery          ← ADR 0021
```

Agency tiers are from `docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md` §5.
**Stages A and B are Tier 0 throughout: deterministic code, no LLM.** Mining *never* produces a post
directly — it produces an insight card, and a human triages it (§2 of that document). That principle is
Session 28's to implement, but it constrains what Session 27 must retain, and §13 states the contract.

### 1.3 What this ADR decides (D-1)

**Stages A and B only, and zero LLM calls.** In scope: the GitHub App connection and install callback, the
per-business multi-repo watch list, the hourly poller and its raw-signal store, the deterministic
scoring/dedup pass, the connect + watch-list surface, and every RLS/cascade/retention obligation the new
tables incur.

*Losers.* **Stages A–D in one session** — loads all of the mode's AI risk into the first session and leaves
the second thin. **Connection-only** — makes Session 28 larger than any session shipped to date.

**Why the cut falls exactly here, stated so a reviewer can check it:** everything in this ADR is provable
by exact-match assertion against fixtures and live Postgres — a poller either ingested the release or it
did not; a dedup key either collides or it does not. Everything in ADR 0021 is probabilistic and needs a
statistical eval harness that **does not yet exist as a category in ADR 0015**. Mixing them would put the
product's least-testable component inside the same review as its most testable, and a red run would not
tell the reviewer which half was indicted.

### 1.4 Written against the shipped shape

`docs/brainstorm/session-plan-adrs-0016-0018.md` §4 deferred Mode 3's ADR specifically so it would be
written against the foundations' *shipped* shape rather than their designed one. That condition is now met
(Tracks A–D closed; Track D at `308ff92b`). Two places where the shipped shape differs from the
2026-07-17 brainstorm's assumptions, and this ADR follows the shipped shape:

1. The brainstorm proposes **"cheap embeddings + dedup + clustering"** for Stage B. With exactly one
   structured source that is wrong — see §6.5.
2. The brainstorm lists **GitHub releases / changelog / analytics thresholds** as the ingestion set. This
   ADR narrows v1 to **releases alone** — see §5.2.

**And one fact that removes work rather than adding it:** `campaigns.origin` **already carries
`'signal_generated'`**. Verified, not assumed —
`supabase/migrations/20260722190000_mode2_brief_and_roles.sql:113-114`:

```sql
ADD CONSTRAINT campaigns_origin_check
  CHECK (origin IN ('manual', 'objective_generated', 'signal_generated'))
```

Reality §6's open question is settled: **Stage F costs no migration**, in Session 27 or in Session 28.

---

## §2 — The credential model (Q1)

This is the load-bearing section. CLAUDE.md's token rule — Vault only, `vault_access_token_id` on the row,
decrypt via service-role — exists for **long-lived OAuth tokens**. A GitHub App does not have one. The
rule is therefore argued from, not copied.

### 2.1 GitHub App, and why the `social_accounts` precedent does not transfer (D-2)

| | `social_accounts` (ADR 0002) | GitHub App (this ADR) |
|---|---|---|
| Credential | Long-lived OAuth access + refresh token, **per tenant** | Private key, **per deployment** |
| Where it lives | Supabase Vault, id on the row | `lib/config.ts` env, never in the DB |
| Per-tenant datum | The tokens themselves | An **installation id** — an identifier, not a credential |
| Call-time credential | The stored token | A **~1-hour installation token**, minted per tick, never stored |
| Revocation | Delete the Vault secret — credential becomes physically unusable | Customer uninstalls in *their* GitHub settings |

*Losers (L-2).* **OAuth App** — a long-lived, broadly-scoped user token sitting in Vault for a read-only
changelog feed: a blast radius wildly out of proportion to the value. **Pasted PAT** — no rotation, worst
UX, and the token belongs to a person who may leave the company. A-1's user-authorization leg is neither of
these: it is an identity check consumed once at install time, never a stored credential (§0.1).

### 2.2 The private key

`GITHUB_APP_PRIVATE_KEY`, **base64-encoded**, through `lib/config.ts` (L-13). Base64 because every existing
variable in that file is a scalar `z.string()` (`lib/config.ts:5-107`) and the file contains **no multi-line
or PEM precedent anywhere** — a raw PEM would be the single variable whose shape the house pattern cannot
carry, and PEM newlines in env vars are a well-known operational trap.

**Validated at parse time, not at first use** `[sec-MEDIUM-5]`. The `serverSchema` entry carries a
`.refine()` proving the value base64-decodes to a string matching `-----BEGIN (RSA )?PRIVATE KEY-----`.
Without it, a truncated or mis-pasted key fails at the *first poller tick*, up to an hour later, inside a
background cron whose only output is one structured log line — the exact silent-failure shape L-11 forbids.
This preserves `parseServerEnv()`'s fail-fast contract (`lib/config.ts:141-208`).

The full env set, all through `lib/config.ts`, all `serverOnly()`-guarded getters (`lib/config.ts:212-220`):
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`. **No `process.env.GITHUB*` appears anywhere else** — enforced by a source scan
(§11.3).

*Loser:* raw multi-line PEM (no precedent, newline trap); deferring decode/validation into `lib/signals/`
(breaks fail-fast).

> **Amendment (Session 27-D / A-4, MAJOR-3) — the four load-bearing credentials are conditionally
> required, not unconditionally.** The original text above described `GITHUB_APP_ID`,
> `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` as bare
> `z.string().min(1)` — unconditionally required at parse time, in every environment. That coupled every
> unrelated CI job, preview deployment and contributor checkout to an opt-in feature no tenant uses, and it
> is exactly what reddened both Session 27 CI jobs at the audited range head (`5b5bbb9f`); the fix landed
> only outside that range (`08a4c1e2`), by pasting dummy values into two workflow YAMLs.
>
> The four are now `.optional()` in `lib/config.ts`'s `serverSchema`, with a `superRefine` (the same shape
> `QSTASH_*`/`RESEND_*` already use) that: (1) requires all four together when `NODE_ENV=production`; (2)
> rejects any **partial** set — some present, some absent — in **every** environment, including
> development, since 1-of-4 is always a mis-paste, never a supported mode. `GITHUB_APP_SLUG` is **not**
> part of this co-required set — it remains independently optional via its own `default('')`, unchanged,
> because it is cosmetic (a human-facing install URL) and never a security boundary.
>
> The PEM `.refine()` on `GITHUB_APP_PRIVATE_KEY` stays attached to the value and fires unconditionally
> whenever it is present, in every environment — `[sec-MEDIUM-5]`'s fail-fast contract is unchanged by this
> amendment.
>
> **Runtime half.** Because the type system no longer guarantees these four are `string` (they are now
> `string | undefined`), `lib/signals/github-client.ts`'s `getAppAuth()` and `exchangeUserCode()` call a
> `requireGithubAppConfig()` guard that throws a named `GithubAppNotConfiguredError` if a value is absent,
> rather than letting `undefined` flow into `createAppAuth` or the OAuth exchange body. This is deliberately
> **not** a `GithubClientError` variant — it is a deployment misconfiguration, not a GitHub-side failure —
> so it is unclassified by §4.5 and propagates to the orchestrator's generic per-connection catch, counted
> as `failed` and reported to Sentry, which is "fail loudly at the seam" rather than a confusing GitHub-side
> 401 an hour later.
>
> *Named loser, unconditionally required (the prior shape):* fails fast everywhere, correctly, for the
> environments that need it — but couples every environment to an opt-in feature, which is a worse trade
> than the conditional shape above.

### 2.3 The installation id — a plain column, not Vault

`github_connections.installation_id bigint NOT NULL`. **Not Vault.**

The argument: an installation id **grants nothing on its own**. It is useless without the deployment private
key, which lives in env and never touches the database. It is an identifier of the same class as
`stripe_customer_id`, which is already a plain column. Vault would be decrypted on every single tick —
buying no confidentiality — while adding a `vault_delete_secret` obligation to the erasure path, which is
precisely the class of GDPR footgun ADR 0010 §D2.5 exists to track.

`security-reviewer` confirmed this directly: *"Deployment-scoped private key rather than per-tenant Vault
entry is the correct model — GitHub Apps are inherently single-key-per-deployment, so this isn't the same
problem Vault solves for per-tenant OAuth tokens."*

**Stated explicitly, per `[db-MODERATE]`: `github_connections` has no `vault_*_token_id` columns, and that
is correct, because no long-lived credential is ever persisted by this design.** If a future change
introduces one, that table is missing its Vault columns and this line is the tripwire.

*Loser:* Vault-for-consistency with `social_accounts` — ceremony for a non-secret, at the cost of an
erasure-path step.

### 2.4 Token minting and caching

**Minted per tick, per installation, held in process memory for the duration of that tick, never
persisted.** Two tokens are involved and both are ephemeral:

1. **Installation access token** (~1h): minted from a short-lived App JWT (RS256 over the private key) via
   `POST /app/installations/{id}/access_tokens`, used for that installation's reads, discarded.
2. **User access token** (A-1, §8.3): obtained **once**, at install-callback time only, used for exactly one
   call — `GET /user/installations` — to prove installation ownership, then discarded. It is never written
   to the database, never cached, and never used by the poller. **This is why A-1 does not reintroduce the
   OAuth-App problem L-2 rejected:** there is no long-lived user token, because there is no stored user
   token at all.

**Rate arithmetic that justifies per-tick minting.** A GitHub App installation has 5,000 REST requests/hour,
counted **per installation**, not globally. One tick per installation = 1 token mint + at most 20 conditional
GETs (one per watched repo, capped at §3.2) ≈ **0.4% of the hourly budget**, and conditional requests that
return `304 Not Modified` do not count against the limit at all. Caching a token across ticks would save one
request per hour per installation and would require persisting a live credential — trading the entire
rationale for choosing a GitHub App (L-2) for a rounding error.

*Loser:* persist-the-token-with-expiry (in Vault, since it would then genuinely be a secret) — reintroduces
the long-lived-credential-at-rest problem the App model was chosen to avoid.

Noted for scale `[sec-LOW-8]`: App-level (as opposed to installation-level) limits apply to the JWT used for
minting. At hourly cadence this is not reachable at any tenant count this product will see before a later
scaling review, but the ADR records the ceiling rather than discovering it in production.

### 2.5 Disconnect — the full story, and an honest asymmetry

Four parts, all required:

1. **Mark inactive** — atomic conditional UPDATE, `SET is_active = false … WHERE id = ? AND is_active = true`
   (L-11: never read-then-update).
2. **Poller exclusion is structural, not a branch** — the poller's claim query filters `is_active = true`,
   so a disconnected connection is not skipped by a code path that could be forgotten; it is not selected.
3. **Already-ingested signals are RETAINED.** They are the customer's own product history, may already back
   a Session 28 candidate, and — critically — contributor identity was never stored (§5.3), so retention
   carries no third-party identity data. Erasure is a *different* question with a different mechanism
   (§9.4). *Loser:* delete-on-disconnect — surprising data loss, and it makes reconnection re-ingest the
   world.
4. **SOSH does NOT call the uninstall API.** It deep-links the user to their own GitHub installation
   settings. Uninstalling is a **write against the customer's account**, and L-5 says read-only forever;
   the App's permission set does not include anything that could perform it.

**The asymmetry, stated rather than papered over** `[sec-HIGH-3]`. CLAUDE.md's three-step disconnect
contract ends with *delete the Vault secret*, and that step is load-bearing: it makes the credential
physically unusable even if `is_active` were flipped back by a bug, a backup restore, or a DB-level
compromise. **Here there is no secret to delete, so `is_active` is the only barrier — and flipping it back
resumes access with no re-consent.** That is weaker, and the ADR says so. Mitigations, both required:

- **GitHub-side state is authoritative.** Any 401 or 404 while minting an installation token auto-sets
  `is_active = false`, sets `last_poll_status = 'revoked'`, and surfaces a reconnect state in the UI. A
  customer who uninstalls on GitHub's side is reflected in SOSH within one tick, without a webhook.
- **UI copy tells the truth:** disconnecting in SOSH stops ingestion; *full* revocation means uninstalling
  the App in GitHub settings. The ADR forbids copy that implies otherwise.

### 2.6 Constraints

`SIGNAL-CONFIG-ONLY-ENV`, `SIGNAL-NO-TOKEN-AT-REST`, `SIGNAL-DISCONNECT-DEACTIVATES`,
`SIGNAL-REVOCATION-DETECTED`. Agency Tier 0. Test tiers: §11.

---

## §3 — The schema (Q2, L-12)

### 3.1 The one-table-vs-two decision

**Two tables: `signals` (raw) and `signal_candidates` (scored).**

I proposed this on the grounds that raw signals hold untrusted text while candidates are mutable workflow
rows. `database-reviewer` endorsed it and supplied the stronger argument, which is now the ADR's primary
one: **Postgres RLS and GRANT are table-grained, not column-grained.** A single table permitting the
workflow's `status` UPDATE necessarily also permits an UPDATE that touches `body`. Two tables let `signals`
be SELECT-only for `authenticated` and unwritable outside service-role — cheaper to reason about than
defending individual columns, and column privileges are not the house pattern anywhere in the cited
migrations.

*Loser:* **one table with a status column** — one fewer join, one fewer cascade row, one fewer RLS policy
set; rejected because it makes untrusted text workflow-mutable and makes re-scoring destructive of the raw
evidence. The join is a single indexed FK lookup and is not a real cost against that.

### 3.2 `github_connections` and `watched_repos`

**`github_connections`** — one per business. Columns: `id`, `business_id` (FK CASCADE), `installation_id`
(bigint), `account_login`, `is_active`, `connected_by`, `connected_at`, `last_poll_started_at`,
`last_poll_completed_at`, `last_poll_status`, `rate_limited_until`, `created_at`, `updated_at`.
`UNIQUE (business_id)`, `UNIQUE (installation_id)`.

`last_poll_started_at` and `last_poll_completed_at` are **separate columns** `[db-MODERATE-B-iii]`. My first
draft used one `last_polled_at` as both the claim stamp and the success signal; a crash mid-tick would then
stamp the claim and block re-claim for the full window, where the house precedent
(`learning_capture.sql:231-246`, `FOR UPDATE SKIP LOCKED`) self-heals immediately because the lock dies with
the connection. Splitting them makes a crashed tick distinguishable from a completed one.

**`watched_repos`** (L-4, D-4) — `id`, `business_id` (FK CASCADE), `connection_id` (FK CASCADE), `repo_id`
(bigint — GitHub's **immutable numeric id**, so a repo rename does not orphan the row), `owner`, `name`,
`is_active`, `releases_etag`, `last_polled_at`, `added_by`, `created_at`, `updated_at`.
`UNIQUE (business_id, repo_id)`.

*D-4 losers.* **Single repo** — wrong for any monorepo split or separate docs/API repos, and widening later
is a migration plus a UI change. **All installed repos** — surrenders the narrowing control that is
simultaneously a cost control and a relevance control (intelligence doc §4), and makes every later scoring
decision harder.

**Watch-list cap: 20 active repos per business, enforced in the Server Action** (`SIGNAL-WATCHLIST-BOUNDED`).
A `CHECK` constraint cannot see sibling rows, so the declarative option does not exist; the alternatives are
a `BEFORE INSERT` trigger or an app-layer count. This is a UX and cost guardrail, **not** a dedup or security
boundary — unlike the idempotency key at §4.3, where a race genuinely matters — so the small TOCTOU window
under concurrent adds is acceptable. *Loser:* a `BEFORE INSERT` trigger (safe with respect to
`purge_business`, since it is not a `BEFORE DELETE` trigger — but unwarranted for a guardrail).

### 3.3 `signals` — the raw store

Columns: `id`, `business_id` (FK CASCADE), `watched_repo_id` (FK CASCADE), `source` (`CHECK IN ('github')`),
`kind` (`CHECK IN ('release')`), `external_id`, `title`, `body` (`CHECK (length(body) <= 8000)`),
`body_truncated`, `html_url`, `occurred_at`, `is_prerelease`, `author_is_bot`,
`ingested_via` (`CHECK IN ('poll','webhook') DEFAULT 'poll'`), `content_hash`, `created_at`, `updated_at`.

`content_hash` is a generated column on the `studio_drafts` precedent
(`20260730100000_studio_drafts.sql:26`), computed over `title || body`, and is what makes edit-detection an
exact comparison rather than a diff.

`CHECK` constraints on `source`, `kind`, `score` and `length(body)` are adopted from `[db-MINOR]`: the draft
had a `CHECK` on `ingested_via` but not on its neighbours in the same DDL, and inconsistent enum-hardening on
adjacent columns is worth fixing while the table is new. The `length(body)` check is defence-in-depth behind
the application-level cap — this is explicitly untrusted third-party text, and an app-layer bug should not be
able to write unbounded content.

**Mutability, corrected.** My draft claimed `signals` was write-once *and* that an edited release must
re-score. `database-reviewer` correctly identified these as contradictory: a release's id is immutable, so an
edit is the **same row**. Resolved at §4.4 — `signals` is **one row per `external_id`, mutable in content
only**, protected by a narrow `BEFORE UPDATE` trigger that permits `title`, `body`, `content_hash`,
`body_truncated`, `updated_at` to change and raises on any change to `business_id`, `watched_repo_id`,
`external_id`, `created_at`. It is an UPDATE trigger, so it has **no interaction with `purge_business`** —
unlike the `BEFORE DELETE` shape explicitly forbidden at `studio_drafts.sql:88-96`.

### 3.4 `signal_candidates` — Stage B's output, and the webhook seam

Columns: `id`, `business_id` (FK CASCADE), `signal_id` (FK CASCADE), `score` (`CHECK (score >= 0)`),
`score_inputs` (jsonb), `occurred_at`, `status` (`CHECK IN ('new')` in this ADR — ADR 0021 widens it),
`created_at`, `updated_at`. **`UNIQUE (signal_id)`.**

**`UNIQUE (signal_id)` was a `[db-BLOCKER]`** and is the single most important correction in this section.
"One candidate per signal" was stated as English intent, not as a constraint. Without the unique index,
`ON CONFLICT (signal_id)` has **no arbiter**, so every re-score silently inserts a duplicate candidate row —
which would have broken the exact "re-score without re-fetching" property that justified two tables in §3.1.

**`occurred_at` is denormalised onto `signal_candidates`** `[db-MAJOR-C]`. The feed orders by
`score DESC, occurred_at DESC, id ASC`, and `occurred_at` originally lived only on `signals`. **Postgres
cannot build a composite index spanning two tables**, so that ORDER BY could not be index-satisfied as
drafted — every feed query would sort or nested-loop, defeating the point. It is copied at insert and
refreshed on the same upsert whenever the signal's content changes.

**The webhook seam (L-3, D-3).** `signals.ingested_via` distinguishes writers, and **no column on `signals`
is poller-specific** — the cursor (`releases_etag`, `last_polled_at`) lives on `watched_repos`, not on the
signal row. That is the property that makes the seam real rather than decorative: a future webhook writer
fills every `signals` column without touching a cursor, and needs no migration. **No route, no signature
verification, and no webhook secret is built this session.**

*D-3 losers.* **Webhook-first** — buys minutes of latency for a permanent unauthenticated public ingress, in
a product whose next step is a human triaging an inbox. **Webhook + poll reconciliation from day one** — two
writers into one table before either is proven.

### 3.5 RLS policies

Every policy in the InitPlan-wrapped house form, verbatim from
`20260730100000_studio_drafts.sql:71-86`:

```
USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
```

with a matching `WITH CHECK` on every INSERT and UPDATE policy.

| Table | `authenticated` policies | Rationale |
|---|---|---|
| `github_connections` | SELECT only | The poller writes as service-role; connect/disconnect are gated at the app layer (§8.5) |
| `watched_repos` | SELECT, INSERT, UPDATE — **no DELETE** | See below |
| `signals` | SELECT only | Written exclusively by service-role |
| `signal_candidates` | SELECT only in this ADR | ADR 0021 adds the triage UPDATE policy |

**No DELETE policy on `watched_repos`** `[db-MAJOR-D]`. `signals.watched_repo_id` cascades from
`watched_repos`; a user-triggered hard delete would therefore destroy every historical signal for that repo —
silently annihilating the append-only log this design exists to keep. **Unwatching is `is_active = false`.**
Hard deletion is reserved to `purge_business` and service-role.

Absence of a policy is deny-by-default under RLS, which is the correct expression of read-only. Per
`[db-D]` this is paired with an explicit `GRANT SELECT … TO authenticated` and no write grant, so the intent
is enforced at two independent layers rather than resting on the absence of something.

**The poller runs service-role and bypasses RLS entirely** (L-12). Every service-role read and write in
`lib/signals/` and `lib/db/` therefore states an explicit `business_id` predicate; §11.1 names the Tier-1
test for each. Service-role is never reachable from a Server Component or Client Component
(`lib/supabase/service.ts:6-20`; the `serverOnly()` guard at `lib/config.ts:212-220`).

### 3.6 Indexes

| Query | Index |
|---|---|
| Candidate feed (bounded, `ORDER BY score DESC, occurred_at DESC, id ASC`) | `signal_candidates (business_id, score DESC, occurred_at DESC, id ASC) WHERE status = 'new'` — partial, on the `studio_drafts.sql:60-62` pattern |
| Recent signals for a business | `signals (business_id, occurred_at DESC, id)` |
| Poller claim (bounded, `ORDER BY last_poll_started_at ASC NULLS FIRST`) | `github_connections (is_active, last_poll_started_at)` |
| Watched repos for a connection | `watched_repos (connection_id)` |
| Signals for a watched repo | `signals (watched_repo_id)` |
| Idempotency | `UNIQUE (business_id, source, external_id)` on `signals` |
| Candidate arbiter | `UNIQUE (signal_id)` on `signal_candidates` |

The two FK indexes were **`[db-BLOCKER-C]`** — `watched_repos.connection_id` and `signals.watched_repo_id`
were both bare foreign keys in the draft. The only unique index on `watched_repos` leads with `business_id`
and does not serve a `connection_id` lookup.

The poller's own claim query is bounded with an explicit `ORDER BY` and `LIMIT` — a poller query is still a
list query, and L-13 admits no exception for service-role callers.

### 3.7 ADR 0010 Amendment 2 §D2.5 — cascade rows, verbatim

To be added in the same PR as the migration (CLAUDE.md, mandatory):

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| github_connections | yes (business_id) | CASCADE | yes | none — cascade = erasure (holds an installation id, not a credential; no Vault secret exists to delete, ADR 0020 §2.3) |
| watched_repos | yes (business_id) | CASCADE | yes | none — cascade = erasure (holds repo owner/name chosen by the customer) |
| signals | yes (business_id) | CASCADE | yes | none — cascade = erasure (holds third-party-authored release text; contributor identity fields are never stored, ADR 0020 §5.3) |
| signal_candidates | yes (business_id + signal_id) | CASCADE (both) | yes | none — cascade = erasure |

**No `purge_business` edit is required** for any of the four. Confirmed against the function's current
definition (`20260702120700_purge_business_member_delete.sql:14-72`): it carries explicit lines only for
tables needing Vault cleanup (`social_accounts`, `:33-38`), legal-hold redaction (`billing_events`,
`:49-52`), or belt-and-braces identity deletion (`business_members`, `:57`). None of the four has that
shape, so the root `DELETE FROM public.businesses` at `:62` and its cascade suffice — exactly as
`studio_drafts` records at `studio_drafts.sql:94-96`.

**Double-cascade paths are not a problem** `[db-E]`: `signal_candidates` reaches `businesses` via both
`business_id` and `signal_id → signals → business_id`, and `watched_repos` via both `business_id` and
`connection_id → github_connections → business_id`. These are diamond-shaped convergent paths, not cycles;
Postgres deletes each row once regardless of how many FK paths lead to it in the same statement.

### 3.8 Constraints

`SIGNAL-RLS-ISOLATED`, `SIGNAL-CASCADE-COMPLETE`, `SIGNAL-PURGE-COVERED`, `SIGNAL-WATCHLIST-BOUNDED`,
`SIGNAL-WEBHOOK-SEAM-CLEAN`, `SIGNAL-RAW-IMMUTABLE-IDENTITY`.

---

## §4 — The poller (Q3, L-3, L-11)

### 4.1 Cadence and fan-out

**Hourly**, matching `capture-learning` (ADR 0018). Rate-limit defence at §2.4: ≤21 calls/hour against a
5,000/hour per-installation budget, with 304s free.

**One QStash message per tick that loops businesses**, mirroring `lib/learning/orchestrator.ts:354-377`
exactly: a per-business `try`/`catch`, `Sentry.captureException` per business, and a failure counter in the
tick summary. One business's revoked installation, rate limit, or malformed payload **cannot** abort the
loop for the others (L-11). *Loser:* one QStash message per business — a fan-out enqueuer is a second moving
part, and the operator log fragments across N invocations for no gain, since idempotency is handled by the
unique index either way.

The route reuses the existing shape without inventing scheduling machinery (Reality §2):
`verifyQStashRequest(request)` from `lib/cron/qstash-auth.ts:27`, called under
`config.server.CRON_TRIGGER === 'qstash'`, with the manual `timingSafeEqual` bearer fallback — identical to
`app/api/cron/capture-learning/route.ts:11-48`. Service-role is acquired **inside the orchestrator** via the
lazy `await import('@/lib/supabase/service')` pattern (`lib/learning/orchestrator.ts:341-342`), not in the
route — following the newer of the two variants, not `publish`'s (`app/api/cron/publish/route.ts:59-60`).

### 4.2 The claim

Atomic conditional UPDATE, never read-then-update (L-11):

> claim a connection by setting `last_poll_started_at = now()` where the connection is active **and**
> (`last_poll_started_at IS NULL` **or** `last_poll_started_at < now() - interval '50 minutes'`), returning
> the claimed rows.

Bounded, with `ORDER BY last_poll_started_at ASC NULLS FIRST` and an explicit `LIMIT` (§3.6).

*Loser:* a `FOR UPDATE SKIP LOCKED` claim RPC on the `learning_capture.sql:231-246` pattern — genuinely
stronger (it self-heals the instant a crashed connection drops its lock, where the timestamp watermark
stalls for up to 50 minutes). Rejected for this table because at hourly cadence a stalled claim self-heals
by the next natural tick, and the RPC adds a `SECURITY DEFINER` surface for a table with one row per
business. **Recorded as the revival condition** `[db-MODERATE]`: if an out-of-band trigger is ever added —
"poll now", or a backfill — this watermark is the wrong mechanism and must become the SKIP LOCKED claim.

### 4.3 Idempotency — a unique index, not an application check

**Key:** `UNIQUE (business_id, source, external_id)` on `signals`, where
`external_id = 'github:release:{release_id}'`.

**Why the index and not an application check** `[db-B-i]`: a SELECT-then-INSERT is a textbook TOCTOU race —
two concurrent transactions both pass the check before either commits. The index is the arbiter.

- **Retried QStash delivery:** the second delivery's insert hits `23505` and is counted as `duplicates`, not
  an error — CLAUDE.md's webhook-handler rule ("detect duplicates via `23505`") applied to a poller.
- **A tick overlapping its own previous run:** same protection for `signals`. But the index alone does **not**
  stop two overlapping runs from both calling the GitHub API for the same repo (wasted quota) and racing to
  write `releases_etag` (lost update — the staler value can win). **That is why §4.2's claim exists**, and
  the ADR states the two mechanisms as complementary rather than redundant.

### 4.4 Conditional requests, the cursor, and edit detection

**The poller fetches page 1 of the releases list (`per_page=30`) under an `If-None-Match` ETag stored on
`watched_repos.releases_etag`.** A `304` means nothing changed — including edits — and the repo is skipped
for the cost of one free request.

This resolves the design hole `database-reviewer` found underneath my draft: I had required "an edit must
re-score" while proposing a `last_release_seen_at` cursor, and **GitHub's release object has no reliable
`updated_at`** — so a cursor of "releases newer than X" can never surface an edit to an older release. The
ETag-over-page-1 mechanism gives edit detection for free within a bounded window, and the window is the
honest limit:

- On a `200`, all returned releases are diffed against the DB by `external_id` and `content_hash`.
- New `external_id` → insert. Same `external_id`, different `content_hash` → **update in place** (§3.3's
  trigger permits exactly those columns) and re-score (§6.4).
- **Stated bound, recorded as a decision and not an oversight: edits to releases older than the 30 most
  recent are not detected.** Revival condition: a customer whose release cadence exceeds 30 per hour, which
  no B2B SaaS in the ICP approaches.
- **First-ever poll** ingests only that first page, and only releases published within the last 90 days, so
  a new connection does not fill the Session 28 feed with years of ancient releases.

### 4.5 Failure table — every row has an operator-visible consequence

A silent skip with no counterpart is the failure mode this table exists to reject. The precedent is
ADR 0018's orphan report: a deliberate skip needs an operator-visible counterpart.

| Failure class | Containment | Operator-visible consequence |
|---|---|---|
| Revoked installation / 401 on mint | Set `is_active = false`, `last_poll_status = 'revoked'`; skip business | `revoked` in the tick line + Sentry + **user-facing reconnect state** in the UI (§2.5) |
| 403 rate limit + `Retry-After` | Set `rate_limited_until`; skip business this tick; **no deactivation** | `rateLimited` count in the tick line |
| 404 — repo deleted or moved out of the installation | Set `watched_repos.is_active = false`, record the reason | `notFound` count + the repo shown as **"unavailable"** in the watch list |
| 5xx from GitHub | Count, retry next tick, no state change | `failed` count in the tick line |
| Malformed payload | Zod `safeParse` failure; skip that item, continue the repo | `malformed` count + Sentry **with the repo id, never the body** — untrusted text into logs is its own vector (§7) |
| `setup_action = 'request'` | Handled at the callback, never reaches the poller (§8.3) | A distinct "awaiting organization approval" screen |

### 4.6 The canonical tick log line

Exactly **one** structured-JSON `console.log` per invocation, per CLAUDE.md's worker carve-out (Session 25-D
NIT-6), on the `lib/learning/orchestrator.ts:393` pattern:

```
console.log(JSON.stringify({ kind: 'signals.tick', ...summary }))
```

Fields: `kind`, `tick`, `triggeredBy`, `durationMs`, `connectionsClaimed`, `reposPolled`, `notModified`,
`signalsIngested`, `signalsUpdated`, `duplicates`, `candidatesUpserted`, `revoked`, `rateLimited`,
`notFound`, `malformed`, `failed`. No `console.*` anywhere on the user-facing surface (L-13). All timestamps
via `date-fns` `formatISO`, never `new Date().toISOString()`.

### 4.7 Constraints

`SIGNAL-INGEST-IDEMPOTENT`, `SIGNAL-FAILURE-ISOLATED`, `SIGNAL-POLL-CONDITIONAL`, `SIGNAL-TICK-OBSERVABLE`.

---

## §5 — What a signal is (Q4, L-5, L-9)

### 5.1 v1 ingests published GitHub releases. One kind.

Drafts are never ingested — a draft release is by definition not published, and L-9's posture is that SOSH
surfaces what the customer has already chosen to make public.

### 5.2 Exclusions, argued

- **Raw commits — argued explicitly, per Q4's requirement.** High-volume, low-signal, and **every commit
  payload carries an author name and email**. Ingesting commits would make SOSH a processor of contributor
  email addresses at scale, for people who are not SOSH users and never consented to anything — the sharpest
  version of the L-9 problem — and it would buy nothing, because the release note *is* the human's own
  summary of those commits, which is precisely the artefact the mining pipeline wants. Rejected on both
  privacy and signal-quality grounds independently.
- **Tags** — a tag with no release has no human-written body and therefore no substance to score (§6.1). It
  is the same event, observed worse.
- **Merged PRs** — high volume, internal-facing titles, and the second-richest source of third-party personal
  data after commits.
- **`CHANGELOG.md` from the default branch** — has **no stable per-entry identity**, so dedup degrades from
  an exact key into a similarity problem, which L-6 forbids outright. Deferred with that condition named:
  it becomes viable only alongside whatever mechanism makes similarity dedup acceptable.

### 5.3 Retained and dropped fields

**Retained:** `external_id`, `repo_id`, `tag_name`, `title`, `body`, `body_truncated`, `html_url`,
`occurred_at` (from `published_at`), `is_prerelease`, `author_is_bot`.

`author_is_bot` is a **boolean derived** from `author.type === 'Bot'` at ingest. It is a property of the
release, not an identity.

**Deliberately dropped at ingest — the fields do not exist on the Insert type, so omitting them is not a
runtime filter that can be forgotten:** `author.login`, `author.id`, `author.node_id`, `author.avatar_url`,
`author.html_url`, `author_association`, `reactions`, `assets[]` (each asset carries an uploader identity),
`mentions_count`, `tarball_url`, `zipball_url`.

This is L-9's preferred answer — *"where the honest answer is strip it at ingest and never store it, that is
the preferred answer"* — applied literally to contributor identity. §9 handles the one field where it could
not be applied.

### 5.4 Body size, truncation, and permission scopes

**Maximum retained body: 8,000 characters**, enforced in the application and again by a `CHECK` (§3.3), and
truncated on a **multibyte-safe boundary** `[sec-LOW-9]` — never mid-UTF-8-sequence.

**Truncation never silently loses the point.** `body_truncated` is set, `html_url` is always retained, and
every surface that renders a truncated body renders a link to the full release. A truncated release note
that quietly drops its own conclusion is worse than a link, and the ADR forbids that outcome.

Noted, so the cap is not mistaken for a security control `[sec-LOW-9]`: 8,000 characters is a cost and
payload-size control. **A complete prompt-injection payload fits comfortably under it.** The cap is not a
substitute for §7's guard and this ADR does not present it as one.

**GitHub App permission scopes requested — exactly two, both used (L-5):**

| Scope | Access | Used for |
|---|---|---|
| `contents` | **read** | The releases API lives under repository contents |
| `metadata` | **read** | Mandatory for every GitHub App |

No `issues`, no `pull_requests`, no `members`, no `administration`, and **no write access of any kind, on any
resource, ever**. A permission we do not use is a permission we do not request. The App additionally requests
the user-authorization leg (A-1) for identity at install time only (§8.3) — that is an OAuth identity scope,
not a repository permission, and it grants no repository access of its own.

### 5.5 Constraints

`SIGNAL-READ-ONLY-GITHUB`, `SIGNAL-NO-CONTRIBUTOR-IDENTITY`, `SIGNAL-BODY-CAPPED`.

---

## §6 — Stage B: scoring, dedup, clustering (Q5, L-6)

### 6.1 The scoring function, as an actual formula

Integer, 0–100, over named inputs:

```
score = recency + substance + kindWeight + repoWeight + humanAuthored

recency       = floor(40 × max(0, 1 − ageDays / 14))       // 0..40
substance     = floor(30 × clamp(bodyLen / 1200, 0, 1))    // 0..30
kindWeight    = 15                                          // one kind in v1 (§6.6)
repoWeight    = watched_repos.weight                        // 0..10, constant 10 in v1
humanAuthored = author_is_bot ? 0 : 5                       // 0 or 5
```

`ageDays` is computed from a `now` value **passed in as a parameter**, never read inside the function. That
single choice is what makes §6.3's determinism testable rather than merely asserted.

`score_inputs` persists each term, so a later tuning session can see *why* a candidate scored what it did
without re-deriving it.

### 6.2 Bot-authored releases are scored down, not filtered out

A release cut by a release-automation bot for a real version is still a real ship. Filtering it discards the
signal entirely; scoring it down (−5) ranks it below a human-written note while leaving Session 28's human
triage — the right place for that judgment — able to see it. *Loser:* a hard filter on `author_is_bot`.

### 6.3 Determinism as a testable property

> **The same input set must always produce the same ordered candidate list.**

Ties are impossible by construction: the total order is `score DESC, occurred_at DESC, external_id ASC`, and
`external_id` is unique per business. The Tier-2 test runs the scorer twice over the same fixture set and
once more over a shuffled copy of it, asserting an identical ordered result all three times
(`SIGNAL-SCORING-DETERMINISTIC`).

> **Amendment (Session 27-D / D4, MINOR-4) — this total order is scoring-side, not the feed order.**
> `sortScoredSignals`/`scoreAndSortSignals` (`lib/signals/score.ts`) break ties on `external_id ASC`. §13.1's
> `ORDER BY score DESC, occurred_at DESC, id ASC` (`signal_candidates_feed_idx`) is the **authoritative**
> order for anything read from `signal_candidates` — it breaks ties on `id`, not `external_id`. Both orders
> are individually deterministic, but they can order an exact tie differently, so they are **not
> interchangeable**: `sortScoredSignals` is a scoring-side utility for producing a deterministic order over
> an in-memory batch before persistence (and the vehicle for `SIGNAL-SCORING-DETERMINISTIC`'s executed
> proof), not a substitute for §13.1's contract on the read path. A future session must not import it for
> anything that renders to a user as feed order.

### 6.4 The dedup key, and its stability across an edited release

**Key:** `(business_id, 'github', external_id)`, `external_id = 'github:release:{release_id}'`.

**Stability proof:** GitHub's numeric release id is immutable across edits to the title, the body, and even
the tag. An edit is therefore the *same* key, by construction, not by convention.

**What an edit does** (three options, one chosen):

1. ~~Re-ingest as a second row~~ — produces duplicate candidates for one release, which is exactly the
   inbox clutter intelligence doc §4 warns against. **Loser.**
2. ~~Ignore the edit~~ — the candidate's score reflects content that no longer exists; a release whose notes
   were fleshed out after publication stays scored as a stub. **Loser.**
3. **Update in place and re-score. Chosen.** The raw row's content columns are updated under §3.3's
   `BEFORE UPDATE` trigger; the candidate is upserted via
   `ON CONFLICT (signal_id) DO UPDATE … WHERE signal_candidates.status = 'new'`.

**The `WHERE status = 'new'` guard is race-free**, confirmed by `database-reviewer`: the predicate is
evaluated against the row under the lock the UPDATE itself acquires, so a concurrent human triage transition
and a concurrent re-score cannot both win — the second to commit either updates a row still `'new'` or
no-ops. This mirrors CLAUDE.md's atomic-transition pattern. **A re-score can never resurrect a candidate a
human has already dismissed** (`SIGNAL-DEDUP-STABLE-ON-EDIT`).

### 6.5 Clustering, and no embeddings (D-5)

**Clustering rule: candidate cardinality is exactly one per raw signal.** With commits excluded (§5.2) there
is nothing to cluster in v1 — "one candidate per release, with its commits as supporting detail" presupposes
ingesting commits, which §5.2 rejects on privacy grounds. The rule is stated as one-to-one, and clustering is
deferred with its revival condition named: a second signal kind whose members belong to one release.

**Confirmed: no embeddings, no pgvector, no LLM, anywhere in Stage B.** The brainstorm's "cheap embeddings +
dedup + clustering" is designed for a general multi-source firehose. With exactly one structured source,
**GitHub supplies stable identity for free** — release ids — so dedup is an exact key and not a similarity
threshold.

*Loser: embedding-based similarity dedup.* It would add a vector extension, an embedding API call per
signal, a similarity threshold nobody can justify from one source's data, and a **non-deterministic component
inside the one half of Mode 3 that is supposed to be exactly testable** — undermining §1.3's entire rationale
for the session split. **Revival condition, named:** a second, *unstructured* signal source (news, RSS,
competitor social) with no stable per-item identity.

L-6 required the Architect to STOP and flag if deterministic Stage B were genuinely insufficient. **It is
sufficient**, and no founder adjudication is triggered on this point.

### 6.6 A note on `kindWeight`

`kindWeight` is a constant in v1 because there is one kind. It is written as a term rather than folded into
the base so that adding a second kind is a table of weights rather than a re-derivation of the formula. It is
recorded here as a deliberate placeholder, not a free variable someone should tune.

### 6.7 Constraints

`SIGNAL-SCORING-DETERMINISTIC`, `SIGNAL-DEDUP-STABLE-ON-EDIT`, `SIGNAL-NO-EMBEDDINGS`.

---

## §7 — Untrusted ingested text (L-10)

### 7.1 The threat, named concretely

A GitHub release body is written by whoever cut the release — frequently a contributor, sometimes a bot,
occasionally an outsider whose PR was merged. **In Session 28 that text becomes input to an LLM with tool
access.** Session 27 does not make that call, but it is the session that decides how the text is stored, and
it must store it in a form that makes the Session 28 guard **unavoidable rather than recommended**.

`security-reviewer` named the concrete scenarios, recorded here so a future reader does not have to imagine
them: direct instruction override embedded in release notes aimed at a later tool-using agent; fake
`[/DATA]` closer injection, exactly the gap the sentinel approach exists to close; markdown/image-link
exfiltration or SSRF if bodies are ever rendered to humans without a sanitizing pipeline; tool-call syntax
smuggling if a later agent echoes reasoning traces; and the general **indirect, multi-hop** pattern — *the
attacker never touches SOSH at all, they merely merge a release on a watched repo.*

**The untrusted fields are exactly two: `signals.title` and `signals.body`.** Every other retained column is
a derived scalar, an identifier, or a URL.

### 7.2 Guard at read, not at ingest — and the loser argued

**Sanitising at read is chosen**, consistent with ADR 0017 §9's explicit precedent
(`0017-mode-2-upgrade.md:453-457`), which chose render-time guarding on the reasoning that authorship-time
sanitising is bypassed by any later edit.

*Loser: sanitise-at-ingest.* It gains one chokepoint and a single stored-safe representation. It loses on
three counts, all decisive here: (1) it **destroys fidelity for the human reader**, and the human reading the
release note in Session 28's card is the entire point of the mode; (2) it **cannot be re-run** when the
sanitizer improves, because the original is gone — and this repo has already improved its sanitizer once
(`neutralize` → `neutralizeWithSentinels`, `lib/ai/wrap-evidence.ts:83-92`, `:117-131`); (3) it is
**bypassed by the edit path** at §4.4 the same way ADR 0017 identified for human edits. Recorded, argued,
rejected.

### 7.3 The types — what is enforced, and what is not

This is where `ecc:type-design-analyzer` changed the design in two places.

**Change 1 — a distinct output brand, not a reuse of `RenderedEvidence`.** My draft reused
`RenderedEvidence` (`lib/ai/wrap-evidence.ts:11`). That is wrong: the guarantee that brand actually carries
is *"re-fetched, tenant-scoped at render time"* — `wrapEvidenceForPrompt` takes **IDs**, re-fetches the rows
itself, and re-scopes by `business_id` at fetch time (`:165-179`). Signal text is **text already in hand**;
no re-fetch and no tenant re-check is possible against a row the function never queries. Reusing the name
would bake a **false provenance claim into a type**, which is the same class of error branding exists to
prevent, moved one level up. So:

```
UntrustedText      — brand on signals.title / signals.body, minted only by the ingestion parser
RenderedSignalText — minted only by wrapSignalForPrompt(), in lib/ai/wrap-evidence.ts
```

Both use a **non-exported `unique symbol` brand key**, on the ADR 0019 §8.4 precedent, which closes the
object-literal forgery path a string-literal brand leaves open and leaves no grep trace.

**Change 2 — sink narrowing is the load-bearing half.** Branding the input makes raw text *loud*; it does
**not** by itself stop the injection path. What stops it at a known call site is typing every prompt-builder
parameter to accept only the safe brand — never `string`. Per SHARED-FUNCTION CALLERS, §11.5's caller table
enumerates every prompt-assembly function that could receive signal text. Both are done; neither is
redundant; if only one were possible it would have to be the sink narrowing.

**And the honest limit, stated plainly rather than overclaimed.** Reviewers caught exactly this overclaim
twice in prior sessions (ADR 0019 §8.4 records both), so:

> **This is "discouraged", not "unrepresentable".** `string & brand` is assignable to any `string` parameter
> and — decisively — **to any template-literal hole**. `` `Context:\n${signal.body}` `` compiles with no
> error, brand or no brand. A bare `as RenderedSignalText` cast likewise remains compile-legal; this repo has
> a recorded instance of exactly that shape at `lib/db/social-accounts.ts:94`, caught only by a human
> reviewer.

That residual is closed by **executable source scans, not by a stronger type** — the same mechanism and the
same reasoning ADR 0019 §8.5 adopted after the founder refused the `#private`-field class (A-4). §11.3 names
the scans and their per-root vacuity guards.

**One further honesty note** `[type-a]`: because the brand sits on the hand-written Row type and Supabase
returns plain JSON, the brand is a **label of known origin** ("this value came from `signals.body`,
third-party-authored"), asserted once by the layer that genuinely knows the provenance — not a verified fact.
That is the same status every Row field in this repo already has (`lib/db/social-accounts.ts:88`). It
introduces no new unsoundness, and the ADR claims nothing more. The brand is also **erased by RSC
serialization**; since both the poller and Session 28's prompt assembly are server-side this does not bite,
but it is stated so no reader assumes otherwise.

*Loser: an object container `{ readonly raw: string }` for the input side.* It would make an accidental leak
**inert** (`"[object Object]"`) rather than live — genuine harm reduction. Rejected because it does **not**
achieve unrepresentability either (template-literal holes accept any expression type regardless of container
shape), while forcing an explicit `.raw` at every legitimate read site: ingestion, hashing, diagnostics, and
the human-facing render. Buying inertness at that price, for a gap the source scans already close, is not the
trade this repo has chosen elsewhere. Note for the record: ADR 0019 A-4 refused a `#private`-field **class**
specifically because it cannot cross the RSC boundary; a plain readonly object is not a class and that
reasoning does not automatically transfer — so this is rejected **on its own merits above**, not by appeal to
A-4.

### 7.4 One chokepoint, not a sixth sanitizer

`security-reviewer` `[sec-MEDIUM-6]` and the sweep agree on a live hazard: **five duplicated local
`sanitizeDataField` implementations already exist** — `lib/ai/prompts/brief.ts:13`, `rubric.ts:9`,
`post-generation.ts:7`, `post-regeneration.ts:8`, `formats/native-generation-prompt.ts:9` — each only
replacing the literal `[/DATA]` closer, none type-enforced. That is documented accepted debt
(`[sec-LOW-3]`, ADR 0018 §15), **not a pattern to extend**. `lib/studio/guard.ts:11` already forbids a sixth
copy.

**This ADR does not write a seventh.** `wrapSignalForPrompt()` lives in `lib/ai/wrap-evidence.ts` alongside
`wrapEvidenceForPrompt()`, reusing `neutralizeWithSentinels()` (`:117-131`) and the same hard length cap —
one module owning prompt-safety, two honest provenance types.

Additionally, per L-13 and CLAUDE.md's `/lib/db/` rule, the query functions in `lib/db/signals.ts` return the
branded row type rather than a plain generated `string`, so the brand originates at the data-access boundary
rather than being applied ad hoc by callers.

### 7.5 Constraints

`SIGNAL-RAW-TEXT-UNTRUSTED`, `SIGNAL-PROMPT-SINK-NARROWED`, `SIGNAL-NO-SIXTH-SANITIZER`.

---

## §8 — Surface, capability gating, multi-tenancy (Q6)

### 8.1 Routes and actions

| Surface | Shape | Notes |
|---|---|---|
| Connect initiation | Server Action → redirect to GitHub's install URL | Mints the signed state + sets the nonce cookie (§8.3) |
| Install callback | `GET /api/signals/github/callback` | Zod on **every** query param (L-13); the security-critical path (§8.3) |
| Watch-list management | Server Actions (add / remove / toggle) | i18n en/pt/es, added simultaneously to all three locale files |
| Disconnect | Server Action | §2.5 |

### 8.2 The tenant-confusion vector, named

`security-reviewer` returned a **BLOCKER** against my draft, and it is correct. My draft bound the business
from the signed state JWT, re-fetched under the anon RLS client, gated on `user_can`, verified the
installation existed via `GET /app/installations/{id}` with the App JWT, and relied on a
`UNIQUE (installation_id)` index. The attack:

> GitHub's install callback is a plain `GET` whose `installation_id` is a **bare, globally sequential,
> GitHub-unsigned integer** — unlike an OAuth `code`, it is not a one-time secret redeemable only
> server-to-server. An attacker starts a legitimate connect flow on **their own** business, obtaining a valid
> signed state, then hand-crafts the callback substituting **any other** `installation_id`. Every check
> passes: the signature verifies, the RLS re-fetch succeeds (it is their own business), `user_can` passes,
> and the existence check succeeds because the target installation genuinely exists on GitHub. **It just
> isn't theirs.**

Two consequences, both serious: SOSH begins polling a stranger's org — potentially including **private-repo
release notes** — into the attacker's dashboard; and because the unique index is first-write-wins, this
doubles as a **squatting denial-of-service**, permanently locking the real owner out until support
intervenes.

**Verifying the installation exists answers *liveness*, never *authorization*.** It cannot distinguish "this
is mine" from "this exists somewhere." That distinction is the actual security boundary, and the draft had
nothing providing it.

**A nonce alone does not close this.** A single-use nonce stops replay of a *captured* URL, but nothing in
the request is GitHub-signed, so an attacker tampering with `installation_id` on their own as-yet-unused,
still-valid state defeats it entirely. This is why A-1 was escalated rather than decided by the Architect.

### 8.3 The closing mechanism (A-1)

The App enables **"Request user authorization (OAuth) during installation"**, so the callback also carries an
exchangeable `code`. The full ordered flow:

1. **Zod** parses `installation_id`, `setup_action`, `state`, `code`. Anything unparseable → `invalid_request`
   redirect, no write.
2. **Verify the signed state JWT** — mirroring `app/api/social/[platform]/callback/route.ts:52`, redirecting
   to `invalid_state` on failure (`:53-55`). Claims carry `businessId`, `userId`, and a `nonce`, with a
   5-minute expiry.
3. **Single-use nonce, no new table.** Connect initiation sets an `httpOnly`, `SameSite=Lax`, 5-minute cookie
   holding the nonce; the callback requires it to equal the JWT's `nonce` and clears it. `Lax` is required
   and sufficient — it survives a top-level GET navigation, which is exactly what GitHub's redirect is. This
   is defence-in-depth against replay and against a GET that mutates.
4. **The business comes only from the signed state, never from a query param**, and its `businessId` is
   UUID-shape checked before use (`callback/route.ts:11-16`, `:62-64`).
5. **Re-fetch the business under the ANON, RLS-enforced client** (`getBusinessById`,
   `callback/route.ts:67-69`) — proving the currently signed-in user still has access. The state also binds
   `userId` `[sec-MEDIUM-7]`, and the callback requires the signed-in user to match it.
6. **App-layer `user_can` gate** — §8.5.
7. **`setup_action` branch** `[sec-HIGH-2]`. Only `'install'` proceeds. `'request'` (a non-admin org member
   triggered the install; owner approval is pending) **writes nothing** and redirects to a distinct
   *"awaiting organization approval"* screen. Unhandled, this would either write a row for access that does
   not exist or throw against the existence check.
8. **Exchange `code` for a user access token** (`POST https://github.com/login/oauth/access_token`), in
   memory only.
9. **THE TENANT BINDING:** call `GET /user/installations` with that user token and **bind only if the
   returned `installation_id` appears in that authenticated user's own installation list.** This is what the
   draft lacked — it proves the person completing the flow can actually administer the installation they are
   claiming.
10. **Discard the user token.** It is never persisted, never cached, never reused (§2.4).
11. **Upsert** `github_connections` under `UNIQUE (installation_id)`. A conflict against a **different**
    `business_id` is a typed, explicit error ("this installation is already connected to another workspace"),
    never a silent rebind.

Step 9 also closes the squatting DoS: an attacker cannot bind an installation they cannot administer, so they
cannot squat one.

**If the session has expired** by the time GitHub redirects back, the callback cannot complete step 5 and
must not guess: it redirects to login with a `next` parameter preserving the callback URL, and the nonce
cookie's 5-minute lifetime bounds the window. Nothing is written.

### 8.3.1 Residual risk, recorded not silently accepted (security-reviewer, E2.8 pass)

`security-reviewer`'s combined E2.3+E2.8 pass confirmed §8.2's BLOCKER is closed — an attacker cannot bind an
installation they cannot administer — but found a narrower **MEDIUM**: the OAuth `code` (step 8) is never
cryptographically bound to the `state`/nonce that requested it. GitHub's redirect delivers both in the same
query string only because, in the legitimate flow, one browser performed both the connect action and the
GitHub install. Nothing stops a request from pairing an attacker's own valid `state` (their own business,
their own nonce) with a **different, leaked** `code` belonging to a victim GitHub user — if such a `code`
were ever captured (infra/proxy access logs persisting full query strings, a compromised victim machine).
Steps 2–7 all pass (the attacker's own session is genuinely valid), step 8 exchanges the victim's leaked
code, step 9 finds a real match against the victim's own installation list, and the write proceeds — binding
the victim's installation to the attacker's business. This is the OAuth "authorization code injection" class
(RFC 9700), normally closed with PKCE; GitHub's App-install `code` mechanism does not offer an equivalent
binding primitive at this step.

**Accepted as a documented residual risk, not fixed by a redesign**, for three reasons: (1) it requires a
genuine `code` leak as precondition — codes are high-entropy, single-use, short-lived, and this route itself
never re-exposes `code` anywhere (no client render, no redirect echoing it, no log statement containing it);
(2) the realistic leak channels are outside this app's own code (platform/CDN access logs, a compromised
endpoint), not a gap in the flow SOSH controls; (3) closing it structurally would require restructuring the
GitHub App install/OAuth split in a way GitHub's flow does not cleanly support, disproportionate to the
precondition's likelihood.

**Mitigation, not a code change:** confirm the hosting platform (Vercel) and anything in front of it does not
persist full query strings for `GET /api/signals/github/callback` in a durable log, or scrub `code`/`state`
before they reach a log sink SOSH does not fully control. Recorded here as an operational follow-up, not a
blocker to this session.

### 8.4 Capability gating — reusing an existing capability

**`CAPABILITIES.CONNECT_ACCOUNTS`** (`'connect_accounts'`) governs connect, disconnect, **and** watch-list
edits. The real capability names, read not remembered (`lib/members/capabilities.ts:8-15`): `author`,
`reschedule`, `approve`, `connect_accounts`, `manage_members`, `manage_billing`.

**The argument for reuse rather than a new capability:** connecting a GitHub App to a business *is* connecting
an external account to that business — the semantics match exactly. Editing the watch list is scoping that
same connection, not a distinct authority. And the cost of a new capability is not free: ADR 0013's model is
**DB-enforced** (`supabase/migrations/20260702120200_user_can.sql:35-43`), so a new name is a migration plus
an ADR 0013 amendment plus a matching update to the app-layer echo. **No new capability is proposed and no
founder adjudication is triggered on this point.** *Loser:* a new `manage_signals` capability.

### 8.5 The authoritative app-layer gate (21B precedent)

Wherever a handler runs service-role, the gate is at the app layer, following the precedent verbatim
(`app/api/social/[platform]/connect/route.ts:39-45`, and the identical shape at `disconnect/route.ts:33-36`):

> *"Authoritative gate (ADR 0014 §7): the write in `.../callback/route.ts` runs service-role and bypasses
> RLS, so this app-layer `user_can` check is the real boundary."*

The install callback writes service-role. RLS is therefore defence-in-depth there, **not** the boundary, and
the `canServer(client, business, userId, CAPABILITIES.CONNECT_ACCOUNTS)` call
(`lib/members/can-server.ts:12-23`) is what actually gates it.

### 8.6 The L-8 plan-gating seam, named by function (D-7)

**`connectGithubAction`**, in `app/[locale]/(dashboard)/settings/signals/actions.ts`. A future entitlement
check goes there and nowhere else.

Why that function and not the poller: gating at connect time is the narrowest single place, and it
**grandfathers existing connections on downgrade** — which is the correct commercial behaviour. *Loser:*
`listActiveGithubConnections()` in `lib/db/github-connections.ts`, the poller's per-business filter — gating
there means a plan downgrade silently stops ingesting with no user-visible cause, an invisible failure of
exactly the kind §4.5 exists to prevent.

*D-7's own losers, recorded:* gating **now** (no entitlement module exists; inventing one here couples Mode
3's release to a pricing decision) and **no seam at all** (a later gate becomes a retrofit across two
sessions' surface). A seam that is described but not locatable in code is not a seam — hence the function
name.

### 8.7 Constraints

`SIGNAL-CALLBACK-TENANT-BOUND`, `SIGNAL-CALLBACK-VALIDATED`, `SIGNAL-CAPABILITY-GATED`,
`SIGNAL-GATING-SEAM-NAMED`.

---

## §9 — Third-party personal data, retention, erasure (Q7, L-9, L-12)

This is the first time SOSH ingests personal data about **non-users** at scale. The phrase *"it is public
data"* is not used in this document, and is not a lawful basis.

### 9.1 Per-field disposition

| Field | Contains personal data? | Stored or stripped | Basis / note |
|---|---|---|---|
| `author.login` / `id` / `avatar_url` / `html_url` | **Yes** — direct identifier | **STRIPPED at ingest** | Absent from the Insert type entirely (§5.3) |
| `author_association` | Yes — relationship datum | **STRIPPED** | Same |
| `assets[]` (uploader identity) | Yes | **STRIPPED** | Same |
| `reactions` | Aggregate, but reaction-adjacent | **STRIPPED** | No product use |
| `author_is_bot` | **No** — derived boolean | Stored | A property of the release, not a person |
| `title` | Rarely | Stored | §9.2 |
| `body` | **Possibly** — @-handles, occasionally names in credits | **Stored verbatim** | §9.2 — the residual, argued |
| `tag_name`, `html_url`, `occurred_at`, `repo_id`, `is_prerelease` | No | Stored | Non-personal identifiers/metadata |

### 9.2 The contributor-identity decision, and the residual

**Contributor identity is never stored** — and enforced *structurally* rather than by a runtime filter: the
fields do not exist on the Insert type, so there is no check to forget.

**The residual is the body**, and this ADR does not paper over it. A release body can contain @-handles and
occasionally names in a credits line. It is retained **verbatim**, on this footing: it is the customer's own
published announcement about their own product, on their own repository, and SOSH is the **processor** of it
— the identical posture already established for `posts`, `studio_drafts` and `evidence_memory` in
ADR 0010 §D2.5. **Lawful basis: legitimate interest, Art. 6(1)(f), with the balancing test written out in the
Evidence Pack entry (A-2).**

*Loser: regex-stripping handles from the body at ingest.* It is unreliable over prose (a handle, a Markdown
mention and an email are not cleanly separable by pattern), and it corrupts the very text the human reviewer
must read in Session 28's card — the same fidelity argument as §7.2, applied to a different sanitizer.

### 9.3 The consequence for Session 28's cards, stated as a contract

**A card can say "shipped in v2.4". It can never say "shipped by @someone".**

This costs Session 28 nothing to honour, because **the data does not exist to render**. A card that named a
contributor would be a materially different privacy posture, and this ADR forecloses it at the schema level
rather than by asking ADR 0021 to remember.

### 9.4 Erasure

The four §D2.5 cascade rows are at §3.7, verbatim, to land in the same PR as the migration. No
`purge_business` edit is required (§3.7).

**Retain-on-disconnect and retain-on-business-deletion are different questions and are not conflated**
`[sec-HIGH-4]`. Disconnect retains (§2.5). **Business deletion purges, completely, by cascade.**

**A data-subject request from a non-user contributor** is answered as follows: SOSH stores no identity field
for them, so there is nothing to erase in the general case. If their name appears inside a specific release
body, the remedy is deletion of that `signals` row (and its cascading candidate), and the named mechanism is
a service-role deletion by `external_id` — recorded here so the answer exists before the request does.

### 9.5 Retention (A-3)

**180 days** for `signals` and `signal_candidates`.

**The reaper is DEFERRED** to a named follow-on, on the ADR 0019 A-2 precedent (`studio_drafts` ships with no
reaper). The founder condition is binding and is restated here because it is the part that matters:

> **The 180-day figure stays out of every customer-facing surface — `/privacy`, marketing, in-product copy,
> support macros — until an executor exists.** A retention promise with no executor is a false statement to a
> regulator, and is worse than having no stated period.

Until the reaper ships, the *operative* retention is "until the business is erased", exactly as
`studio_drafts` records at ADR 0010 §D2.5. `SIGNAL-RETENTION-UNCLAIMED` (§12) is the constraint that keeps
this honest.

### 9.6 Legal surface (A-2)

**This ADR requires an ADR 0010 Amendment 2 §D2.5 update** — four cascade rows, mandatory and mechanical
(§3.7), not an adjudication.

**It also constitutes a new processing activity**: SOSH ingesting third-party-authored text about people who
are not its users. Per A-2 this is an **approved, tracked follow-on** rather than a blocker on this ADR,
with a binding launch condition:

> **No launch** until (a) the Evidence Pack entry lands, (b) the Art. 6(1)(f) balancing test is recorded, and
> (c) the `/privacy` prose covers signal ingestion.

Recorded in `docs/current-phase.md` at close-out. CLAUDE.md's rule that legal MDX must not drift from the
Evidence Pack applies: the `/privacy` change bumps `evidenceRef`.

### 9.7 Constraints

`SIGNAL-NO-CONTRIBUTOR-IDENTITY`, `SIGNAL-CASCADE-COMPLETE`, `SIGNAL-PURGE-COVERED`,
`SIGNAL-RETENTION-UNCLAIMED`.

---

## §10 — Module boundary (D-8)

### 10.1 The rule, stated in the form CLAUDE.md states its siblings

> **No code outside `/lib/signals/` ever imports a GitHub client package.** All consumers import from
> `/lib/signals/index.ts`. Business logic talks to the signal-source interface, never to Octokit.

This is deliberately the same sentence shape as CLAUDE.md's existing `/lib/social/` and `/lib/ai/` rules, so
it can be added to CLAUDE.md verbatim at close-out (§16). It is enforced by a source scan (§11.3), not by
convention.

`lib/signals/` did not previously exist — confirmed by the sweep. Mode 3 is genuinely net-new surface, not a
retrofit.

### 10.2 `SocialProvider` is untouched, and extending it would be a category error

**`SocialProvider` (ADR 0002) is the publishing surface.** It exists to abstract *where SOSH writes posts*.
A read-only signal source is not a place SOSH publishes; it is a place SOSH *reads*. Adding a
`GitHubProvider` sibling to `PostizProvider` would put a method on that interface that no publishing consumer
can call and that would never be implemented by any real publishing target — the interface would then
describe two unrelated things, and every future implementer would have to answer "what does `publish` mean
for GitHub?" with "it throws."

*Losers (D-8).* **Extending `SocialProvider`** — the category error above. **Putting GitHub calls directly in
the cron route** — violates the module-boundary pattern every other integration in this codebase follows.

`SIGNAL-NO-PROVIDER-COUPLING` is verified by the diff containing **no change to `lib/social/**`** (§11.4,
Tier 3).

### 10.3 The dependency (L-7, D-6)

**Chosen: `@octokit/auth-app` + `@octokit/request`, both exact-pinned, no caret.**

- **Why two packages:** App authentication (JWT minting, installation-token exchange, token caching
  semantics) and HTTP are genuinely separate concerns in Octokit's design, and taking `@octokit/rest`
  instead would pull the entire REST surface — hundreds of endpoint definitions — to call four endpoints.
  `@octokit/request` is the thin layer.
- **Endpoints actually used — four:** `POST /app/installations/{id}/access_tokens`,
  `GET /repos/{owner}/{repo}/releases`, `GET /user/installations`, `GET /installation/repositories` (the repo
  picker).
- **Server-only, mandatorily.** Both are imported exclusively under `lib/signals/`, which is server-side; the
  source scan at §11.3 proves no client bundle can reach them.
- **Exact pins, per the Session 13.5D/B7 rule.** The house convention is carets by default
  (`"@anthropic-ai/sdk": "^0.91.1"`, `package.json:23`) with exact pins as the deliberate exception —
  currently exactly three: `"@upstash/qstash": "2.11.0"` (`package.json:39`), `date-fns-tz` (`:45`), `diff`
  (`:46`). These two join that list. No `octokit` dependency exists today (confirmed by direct read of
  `package.json:22-80`, not by grep-absence).

*Loser: hand-rolled `fetch` + `node:crypto`.* Genuinely viable — `node:crypto` signs RS256 natively, and four
endpoints is roughly 150 lines. Rejected because the non-obvious parts are not the HTTP: installation-token
exchange semantics, `Retry-After` and rate-limit header parsing, conditional-request/ETag handling, and
GitHub's error-shape conventions are exactly where a hand-roll accumulates quiet bugs, and §4.5 makes each of
those a **contractual** behaviour rather than a nicety. Recorded as the named loser with its rationale, per
L-7's requirement to argue rather than assume.

**L-7's authorisation covers the GitHub client and its App-auth helper and nothing else.** No other new
dependency is introduced by this ADR. Any further one is a STOP.

**Session 27-E2.3 note:** versions actually installed, exact-pinned per the above —
`@octokit/auth-app@8.3.0`, `@octokit/request@10.0.13` (latest at install time; no ADR-assumed version
existed to differ from). `package.json:31-32`.

---

## §11 — Test plan across the three tiers (Q8, ADR 0015 §2)

"Covered" = **executed green in CI**, never "authored" (ADR 0015 §1).

### 11.1 Tier 1 — live Postgres (`supabase/__tests__/signals-*.test.ts`, `db-tests.yml`)

Per ADR 0015 §2, a mocked client or a `pg_policies` read is **not** coverage for this tier.

| Test | Proves |
|---|---|
| RLS isolation per table, **mirrored in both directions** with a real signed-in owner-B session | `SIGNAL-RLS-ISOLATED` — the mirrored form is the session-26-D MINOR-2 precedent; a one-directional test misses half the matrix |
| UPDATE `WITH CHECK` tenant-tunnelling attempt on `watched_repos` | `SIGNAL-RLS-ISOLATED` |
| Absence of a DELETE policy on `watched_repos` for `authenticated` | §3.5 — the signal-history-destruction path |
| Cascade from `businesses` for all four tables | `SIGNAL-CASCADE-COMPLETE` |
| `purge_business` leaves zero rows in all four | `SIGNAL-PURGE-COVERED` |
| `23505` on `UNIQUE (business_id, source, external_id)` | `SIGNAL-INGEST-IDEMPOTENT` |
| `23505` on `UNIQUE (installation_id)` across two businesses | `SIGNAL-CALLBACK-TENANT-BOUND` (the squatting arm) |
| `UNIQUE (signal_id)` on `signal_candidates` | §3.4's blocker — proves the upsert arbiter exists |
| Concurrent re-score vs. triage transition against the `WHERE status='new'` guard | `SIGNAL-DEDUP-STABLE-ON-EDIT` |
| The `BEFORE UPDATE` trigger raising on `external_id` / `business_id` mutation, permitting `body` | `SIGNAL-RAW-IMMUTABLE-IDENTITY` |
| The connection-claim conditional UPDATE under concurrency | §4.2 |

### 11.2 Tier 2 — app layer (`vitest`, `app-tests.yml`, every push and PR)

Fixture directory, named as Q8 requires: **`lib/signals/__fixtures__/github/`**, following the existing
`lib/ai/__fixtures__/` convention. Files: `release-valid.json`, `release-edited.json`, `release-bot.json`,
`release-oversized-body.json`, `release-draft.json`, `401-revoked.json`, `403-rate-limited.json`,
`404-repo-gone.json`, `500.json`, `malformed-release.json`, `304-not-modified.json` (headers),
`user-installations.json`, `user-installations-foreign.json`.

Covered: the scoring function's determinism (same set twice **and** a shuffled copy → identical ordered
result); dedup stability across an edited release; **each failure class from §4.5 as its own case**; the
ETag/`304` path and cursor storage; every Zod guard; the callback's tenant-binding rejection cases
(foreign `installation_id`, absent nonce, `setup_action='request'`, signed-out user); the `canServer` gate;
the watch-list cap; multibyte-safe truncation; and the `lib/config.ts` `.refine()` rejecting a malformed
private key.

### 11.3 Four source scans (Tier 2, executable — with per-root vacuity guards)

Each scan carries the vacuity guard from `lib/learning/memory-table-boundary.test.ts` and ADR 0019 §8.5 —
`expect(files.length).toBeGreaterThan(0)` **per root, not in aggregate** (the aggregate form was Session
26-D's MINOR-1: an empty root passes vacuously while the aggregate check still sees files from another root).
A scan that passes on an empty or renamed root is the FALSE-GREEN shape ADR 0015 exists to catch.

1. **`SIGNAL-NO-LLM-IN-STAGE-AB` (L-1).** No file under `lib/signals/**` or the poller route imports
   `@/lib/ai/*` or `@anthropic-ai/sdk`. A single reachable `anthropic.messages.create` is a scope breach.
   *(Exception, stated so the scan is written correctly: `wrapSignalForPrompt` lives in `lib/ai/` per §7.4
   and is Session 28's entry point, not Session 27's — no Session 27 code path calls it.)*
2. **`SIGNAL-NO-PROVIDER-COUPLING` / D-8.** `@octokit/*` is imported in exactly one file, and no file outside
   `lib/signals/**` imports it.
3. **`SIGNAL-CONFIG-ONLY-ENV`.** No `process.env.GITHUB` outside `lib/config.ts`.
4. **`SIGNAL-PROMPT-SINK-NARROWED`.** No `as RenderedSignalText` / `as UntrustedText` / `as unknown as`
   applied to the signal text types outside their single minting module — the ADR 0019 §8.5 pattern, closing
   the residual §7.3 states the types provably cannot.

### 11.4 Tier 3 — diff-verified, enumerated **as such**

Recorded so "no test" is a decision, not an oversight (ADR 0015 §2):

- **`SIGNAL-READ-ONLY-GITHUB`** — the requested App permission set is `contents: read` + `metadata: read`
  (§5.4), and the diff contains no write-method call against `api.github.com`.
- **No `campaigns.origin` migration** — `'signal_generated'` already exists
  (`20260722190000_mode2_brief_and_roles.sql:114`); the diff contains no change to that constraint.
- **No `lib/social/**` change** — `SocialProvider` untouched (§10.2).
- **No webhook route** (L-3) — the diff contains no route under `app/api/signals/**` other than the callback
  and the cron poller.
- **`SIGNAL-NO-EMBEDDINGS`** — no pgvector extension, no embedding call in the diff.
- **`SIGNAL-RETENTION-UNCLAIMED`** (A-3) — no customer-facing surface states a retention period.

### 11.5 SHARED-FUNCTION CALLERS

**E2.11 close-out correction:** this section originally claimed the track touches one existing shared
function — `signOAuthState`/`verifyOAuthState` (`app/api/social/[platform]/callback/route.ts:52`) — with
`connectGithubAction` and the GitHub callback route as two new callers of it. A `git grep` re-run at E2.11
(per this section's own instruction, "the Builder re-runs `git grep` ... and extends the table if a third
caller exists") found **zero** calls to `signOAuthState`/`verifyOAuthState` from any Session 27 file. The
premise was wrong, not merely stale: Session 27 built two **separate, non-shared** functions —
`signGithubConnectState`/`verifyGithubConnectState` in `lib/signals/state.ts` — that intentionally mirror
`signOAuthState`/`verifyOAuthState`'s shape (same `jose` HS256 mechanism, same `OAUTH_STATE_SECRET`) without
calling into them, per `lib/signals/state.ts:1-3`'s own header comment ("mirroring `lib/social/oauth/
state.ts`'s shape... no new secret invented for a second, structurally identical mechanism"). This is a
correct, deliberate design choice (the GitHub flow's claims and expiry genuinely differ, §8.3), not a
Session 27 defect — but §11.5's original text mis-described it as reuse. No Session 22-shaped risk exists
here (no function is actually shared, so there is no second caller of a shared function to miss); the
table below records the two **real**, verified callers of Session 27's own two functions instead.

| Function | Caller | Test covering that caller |
|---|---|---|
| `signGithubConnectState` (`lib/signals/state.ts`) | `connectGithubAction` (`app/[locale]/(dashboard)/settings/signals/actions.ts:67`) | `app/[locale]/(dashboard)/settings/signals/actions.test.ts` |
| `verifyGithubConnectState` (`lib/signals/state.ts`) | the GitHub install callback (`app/api/signals/github/callback/route.ts:74`) | `app/api/signals/github/callback/callback.test.ts` |

For completeness, `signOAuthState`/`verifyOAuthState` themselves remain exactly as they were before Session
27 — one caller pair each, both pre-existing and unchanged (`app/api/social/[platform]/connect/route.ts:52`
and `app/api/social/[platform]/callback/route.ts:52`), covered by their existing, unchanged tests. Session
27 added zero callers to that pair.

Additionally, §7.3's sink narrowing requires enumerating **every** prompt-assembly function that could
receive signal text. In Session 27 that set is **empty** (no prompt exists yet) — recorded explicitly so
ADR 0021 knows the table starts empty and must be filled by it, not inherited.

**[Session 27-D · D2, MAJOR-2] `verifyQStashRequest` (`lib/cron/qstash-auth.ts`) caller table.** Session 27
added a new caller — `app/api/cron/signals-poll/route.ts` — to a function every other cron route already
called. The Session 27 Reviewer found this new caller had **zero** test coverage
(`git ls-tree 5b5bbb9f -- app/api/cron/signals-poll` returned only `route.ts`), the exact
SHARED-FUNCTION CALLERS shape (CLAUDE.md) that produced both Session 22 blockers. Closed at D2:

| Caller | Test covering that caller |
|---|---|
| `api/cron/capture-learning/route.ts:13` | `capture-learning/route.test.ts` |
| `api/cron/drain-email-outbox/route.ts:14` | `__tests__/route.test.ts` |
| `api/cron/publish/route.ts:15` | `publish/route.test.ts` |
| `api/cron/sync-metrics/route.ts:14` | `sync-metrics/route.test.ts` |
| `api/cron/trial-warnings/route.ts:14` | `__tests__/route.test.ts` |
| `api/cron/process-deletions/route.ts:14` | **none** — pre-existing gap, predates Session 27, out of this ADR's scope |
| `api/cron/signals-poll/route.ts:16` | **`app/api/cron/signals-poll/route.test.ts`** (Session 27-D · D2) |

`process-deletions`' gap is unaddressed here deliberately — it predates Session 27 and fixing it is a
separate, unrelated change.

---

## §12 — Constraint table (the Reviewer's acceptance checklist)

Agency tier per intelligence doc §5; test tier per ADR 0015 §2. **Every constraint in this ADR is agency
Tier 0** — deterministic code, no LLM — which is itself the session's central claim.

| Constraint | Agency | Test tier | Proven by |
|---|---|---|---|
| `SIGNAL-NO-LLM-IN-STAGE-AB` | 0 | 2 (source scan) | §11.3 #1, with per-root vacuity guard |
| `SIGNAL-READ-ONLY-GITHUB` | 0 | **3** (diff) | §11.4 — permission set + no write call in diff |
| `SIGNAL-INGEST-IDEMPOTENT` | 0 | 1 | `23505` on `(business_id, source, external_id)`; retry + overlap cases |
| `SIGNAL-FAILURE-ISOLATED` | 0 | 2 | Each §4.5 row as its own fixture case; loop continues after a failing business |
| `SIGNAL-SCORING-DETERMINISTIC` | 0 | 2 | Same set twice + shuffled → identical ordered list |
| `SIGNAL-DEDUP-STABLE-ON-EDIT` | 0 | 1 + 2 | Edited-release fixture; guarded upsert race on live PG |
| `SIGNAL-RLS-ISOLATED` | 0 | 1 | Mirrored both-direction isolation per table |
| `SIGNAL-CASCADE-COMPLETE` | 0 | 1 | Cascade from `businesses` for all four |
| `SIGNAL-PURGE-COVERED` | 0 | 1 | `purge_business` leaves zero rows |
| `SIGNAL-RAW-TEXT-UNTRUSTED` | 0 | 2 | Brand minting (`lib/signals/parse-release.test.ts`'s `expectTypeOf`/`@ts-expect-error` pair, added E2.11) + `wrapSignalForPrompt` chokepoint tests |
| `SIGNAL-PROMPT-SINK-NARROWED` | 0 | 2 | `@ts-expect-error` compile test + §11.3 #4 |
| `SIGNAL-NO-SIXTH-SANITIZER` | 0 | 2 (source scan) | No new local `sanitizeDataField` under `lib/signals/**` |
| `SIGNAL-CALLBACK-TENANT-BOUND` | 0 | 1 + 2 | Foreign-`installation_id` rejection; `UNIQUE (installation_id)` |
| `SIGNAL-CALLBACK-VALIDATED` | 0 | 2 | Zod rejection cases incl. `setup_action='request'`, missing nonce |
| `SIGNAL-CAPABILITY-GATED` | 0 | 2 | `canServer(CONNECT_ACCOUNTS)` on connect / disconnect / watch-list |
| `SIGNAL-NO-PROVIDER-COUPLING` | 0 | 3 (diff) + 2 (scan) | No `lib/social/**` change; Octokit in one file |
| `SIGNAL-CONFIG-ONLY-ENV` | 0 | 2 (source scan) | No `process.env.GITHUB` outside `lib/config.ts` |
| `SIGNAL-WATCHLIST-BOUNDED` | 0 | 2 | 21st repo rejected by the Server Action |
| `SIGNAL-NO-TOKEN-AT-REST` | 0 | 2 (source scan) | No token column in the migration (`lib/signals/source-scans.test.ts`, added E2.11) + no persistence call (`lib/signals/token-boundary.test.ts`'s `SIGNAL-USER-TOKEN-UNPERSISTED` scan proves the code-level half) |
| `SIGNAL-USER-TOKEN-UNPERSISTED` | 0 | 2 (source scan) | A-1 drift **A**: no token-shaped field in `lib/db/github-connections.ts` or the Insert type |
| `SIGNAL-OAUTH-LEG-PRESENT` | 0 | 2 (source scan) | A-1 drift **B**: the callback references both `login/oauth/access_token` and `/user/installations` |
| `SIGNAL-BRAND-LIMIT-DEMONSTRATED` | 0 | 2 | §7.3's limit as a passing test: a template hole and a bare cast both compile |
| `SIGNAL-DISCONNECT-DEACTIVATES` | 0 | 1 | Atomic `is_active` transition — `supabase/__tests__/signals-schema.test.ts`'s concurrent-disconnect-race case (added E2.11; a Tier-2 mocked test existed but was not the claimed Tier-1 live-Postgres proof) |
| `SIGNAL-REVOCATION-DETECTED` | 0 | 2 | 401/404 fixture auto-deactivates |
| `SIGNAL-POLL-CONDITIONAL` | 0 | 2 | ETag sent; `304` short-circuits; cursor persisted |
| `SIGNAL-TICK-OBSERVABLE` | 0 | 2 | Exactly one `console.log`; all §4.6 fields present |
| `SIGNAL-BODY-CAPPED` | 0 | 1 + 2 | `CHECK` constraint; multibyte-safe truncation |
| `SIGNAL-NO-CONTRIBUTOR-IDENTITY` | 0 | 2 | Parser drops every §5.3 field; Insert type lacks them |
| `SIGNAL-RAW-IMMUTABLE-IDENTITY` | 0 | 1 | `BEFORE UPDATE` trigger raises on identity-column change |
| `SIGNAL-NO-EMBEDDINGS` | 0 | 3 (diff) | No pgvector, no embedding call in the diff |
| `SIGNAL-GATING-SEAM-NAMED` | 0 | 2 (corrected from "3 (diff)" at E2.11 — better-proven than originally claimed) | `connectGithubAction` exists and is the single named seam, with an executed test asserting it (`app/[locale]/(dashboard)/settings/signals/actions.test.ts`'s "the L-8 gating seam" describe block), not merely a diff read |
| `SIGNAL-WEBHOOK-SEAM-CLEAN` | 0 | 2 (source scan; corrected from "3 (diff)" at E2.11 — this diff property was never enumerated in §11.4 as required) | No poller-specific column on `signals` beyond the writer-agnostic `ingested_via` seam (`lib/signals/source-scans.test.ts`, added E2.11) |
| `SIGNAL-RETENTION-UNCLAIMED` | 0 | 3 (diff) | No customer-facing surface states a retention period (A-3) |

---

## §13 — The Session 28 contract (and why this ADR is split from 0021)

### 13.1 What Stage C reads, by name

```
Table:    public.signal_candidates
Filter:   business_id = $1 AND status = 'new'
Order:    score DESC, occurred_at DESC, id ASC     (index-satisfied, §3.6)
Bound:    explicit limit, default 50
Function: listNewCandidates(client, businessId, limit)   in lib/db/signal-candidates.ts
Join:     signals (title, body, html_url, occurred_at, tag_name, author_is_bot)
```

**Signal text reaches a prompt only through `wrapSignalForPrompt(): RenderedSignalText`** (§7.3). ADR 0021
must type every prompt-assembly parameter to that brand, and must fill §11.5's currently-empty caller table.

`campaigns.origin = 'signal_generated'` **already exists** (§1.4) — Stage F needs no migration.

### 13.2 What Session 27 deliberately does NOT provide

So ADR 0021's scope is unambiguous: **no insight card** (no table, no generation, no schema); **no expiry or
decay policy** (intelligence doc §4 requires one — it is ADR 0021's, and it constrains nothing here beyond
what §9.5 retains); **no cost ceiling** and **no `ai_usage` write** (Session 27 makes zero AI calls, so it
writes nothing there — the existing service-role path via CLAUDE.md's lazy-import pattern is left untouched
and available); **no triage status beyond `'new'`** (the `CHECK` widens in ADR 0021's migration); **no
`campaigns.origin` change**; **no eval harness** (ADR 0015 has no category for statistical pass rates — ADR
0021 must add one, and that is a large part of why the split exists).

---

## §14 — Explicitly deferred (each a decision, per ADR 0015 §2 Tier-3 discipline)

- **Stages C–F** — ADR 0021 / Session 28. The seam is §13.
- **All external signal sources** — news, RSS, competitor social accounts. A later track. The intelligence
  doc's "market-responsive" and "evergreen strategic" opportunity types (§2) are untouched; v1 is
  **company-originated only**, per the brainstorm's Phase D instruction.
- **Embeddings / pgvector** — §6.5, with its revival condition (a second, unstructured source).
- **Webhook ingestion** — L-3. The schema seam exists (§3.4); no route, no signature verification, no secret.
- **Clustering** — §6.5; revived by a second signal kind belonging to one release.
- **Additional signal kinds** — tags, merged PRs, commits, `CHANGELOG.md`; each argued at §5.2. Commits are
  deferred **on privacy grounds** and that rationale must be re-argued, not merely revisited, before they
  land.
- **Edit detection beyond the 30 most recent releases** — §4.4, bounded and stated.
- **Plan gating** — L-8/D-7, seam at `connectGithubAction` (§8.6).
- **The retention reaper** — A-3, with its binding no-customer-facing-claim condition (§9.5).
- **A `FOR UPDATE SKIP LOCKED` claim RPC** — §4.2, revived if an out-of-band "poll now" or backfill trigger
  is added.
- **Per-repo `weight` tuning** — the column exists and is constant 10 in v1 (§6.1).
- **`tag_name` retention (Session 27-D / D4, NIT-4)** — §5.3 lists `tag_name` as retained, but no
  `signals.tag_name` column exists to receive it (`lib/signals/parse-release.ts:44-55` self-documents this
  drift; `lib/db/signal-candidates.ts:19-28` already documents the matching gap against §13.1's join list).
  `parseRelease` has the raw value in hand (`release.tag_name`) but nowhere on `SignalInsert` to put it.
  ADR 0021 decides either the column (a migration) or dropping the retention claim from §5.3 — not decided
  here, since either choice is out of this ADR's L-1 boundary.
- **A significance floor — named explicitly so ADR 0021 inherits it as a decision, not an assumption.**
  Stage B is a **ranker, not a gate**: every ingested release becomes exactly one candidate (§6.5), bots are
  scored down rather than filtered (§6.2), and `listNewCandidates` applies no minimum score (§13.1). Nothing
  in Session 27 guarantees that only *significant* updates reach a human — the filters that do exist are
  upstream and structural (only published releases, §5.1) and downstream and human (Session 28's triage).
  Two properties of §6.1 make this worth stating rather than assuming. First, the score band is narrow and
  recency-dominated: a fresh empty release scores `40+0+15+10+5 = 70`, a substantive ten-day-old one
  `11+30+15+10+5 = 71`, and the theoretical floor is 25 — so a content-free patch bump ranks essentially
  level with a real ship. Second, **`substance` measures body length, which proxies effort, not
  consequence**; forty auto-generated dependency-bump lines score a full 30/30. Deliberately NOT fixed here:
  a floor is a tuning constant with no production data behind it, and putting one in Stage B would trade
  away the exact-testability §1.3 splits the sessions to protect. Because `score_inputs` persists every term
  (§6.1), **Stage C can apply a floor later with no re-ingestion** — the door is open at zero cost. ADR 0021
  should decide it there, with data.
- **The Evidence Pack entry / balancing test / `/privacy` prose** — A-2, tracked follow-on, **blocking
  launch** (§9.6).

---

## §15 — Consequences

**Positive.** SOSH gains the ability to *notice*, which neither existing mode has. The pipe is built from
already-reviewed parts — the cron/QStash pattern (ADR 0018), the signed-state callback (ADR 0002/0014), the
RLS and cascade house form (ADR 0010/0019) — so the genuinely new surface is small: one client boundary, four
tables, one arithmetic function. Every claim in Stages A and B is exact-match testable, which is what makes
Session 28's probabilistic half reviewable in isolation.

**Negative.** Four new tables and their full L-12 obligation. A new external dependency on GitHub's API
availability and rate limits. A credential model that is *deliberately different* from the one precedent in
the codebase, which is a thing every future reader must be told rather than left to infer — hence §2.1's
table. And an accepted asymmetry: `is_active` is not as strong a revocation boundary as deleting a Vault
secret (§2.5).

**Risks, each with its mitigation.** *Tenant confusion at the install callback* — the sharpest risk in the
session; mitigated by A-1's ownership proof (§8.3), and the ADR is explicit that the pre-A-1 design was
exploitable. *Prompt injection via release bodies* — mitigated by the read-time chokepoint and sink narrowing
(§7), with the residual honestly scoped to source scans. *Third-party personal data* — mitigated by
structural stripping (§5.3, §9.2), with the body residual argued and the legal follow-on tracked as
launch-blocking (A-2). *Silent poller failure* — mitigated by §4.5's failure table, where every class has an
operator-visible counterpart.

---

## §16 — Docs to update at close-out

- `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — the four cascade rows at §3.7 (**mandatory**).
- `CLAUDE.md` — the `lib/signals/` module-boundary rule at §10.1, in the same form as the `/lib/social/` and
  `/lib/ai/` rules.
- `docs/current-phase.md` — the Session 27 entry, the `db-tests` promotion tally (**`master` runs only**),
  and the A-2 launch-blocking condition.
- `docs/build-guide/session-27.md` — a `§0.2 — Founder adjudications` block recording A-1, A-2, A-3.
- `docs/build-guide/session-28.md` — confirm its Reality block matches what Session 27 shipped, **before**
  Session 28's Architect runs; in particular that `campaigns.origin` needs no migration (§1.4).

---

_End ADR 0020._
