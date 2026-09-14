# ADR 0025 — Social read path and cold-start memory backfill

**Status:** Accepted
**Date:** 2026-09-12
**Phase:** 1 — Pre-launch
**Session:** 32 (Track I, agent I1)
**Scope:** A read capability on the `SocialProvider` abstraction (`fetchRecentPosts`, ADR 0002 Amendment B);
its X implementation (served), its LinkedIn implementation (built, **not served**), and `MockProvider`'s; a
background backfill that imports a newly connected account's own original posts and aggregate metrics into
governed memory as permanently-marked, founder-ratified candidates; the onboarding contract that shows the
founder what was learned; and the ceilings, provenance, tenancy and legal posture that make it safe.

**Binding input:** `docs/build-guide/session-32.md` §0 (L-1…L-11, with **L-7′** superseding L-7), §0.1
(Q1…Q8) and §0.2 (founder adjudications **A-1…A-6**). Grounding: one `ecc:code-explorer` sweep and three
advisory reviews (security, database, architect), all folded in below; where an objection was rejected, the
reason is stated at the point it applies.

This document is design-only. No `.ts`, `.sql` or `.tsx` was produced by the Architect session; the shapes
below are the contract the Builder (I2) implements.

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

| Q | Resolution | Named loser(s) | Tier |
|---|---|---|---|
| Q1 | An **eighth method** `fetchRecentPosts` on the flat `SocialProvider` interface + a static `historicalReadAvailable` flag (A-2). Account-shaped, cursor-paged, refuses out-of-range input, original authored posts only. **Served: X. Built but not served: LinkedIn (A-1).** No provider: Instagram, Facebook, Threads. Metrics per platform (A-3) | a separate `HistoricalPostReader` interface (§2.1); an org-shaped contract (L-11); clamping out-of-range page sizes (§2.3); local SOSH posts as the LinkedIn mitigation (A-1) | 2 (+1 for the identity lock) |
| Q1b | Outbound activity is a **feasibility table only** — nothing outbound is read. X own replies: served; X likes: needs `like.read`; LinkedIn/Instagram/Facebook: not served; Threads own replies: served per docs, no provider | reading outbound activity now (widens L-1) | 3 (absence) |
| Q2 | Postiz is already gone (ADR 0028). Re-scoped: the contract is written in platform-neutral vocabulary and **the failure mode is now "a contract that quietly encodes X's response shape"**, designed against in §3 | a contract mirroring X API v2 fields (`public_metrics`, `pagination_token`) | 2 |
| Q3 | Deterministic stats and `format` patterns first; **three** model passes total (voice synthesis, insights, evidence); voice **staged**, applied only at ratification; evidence always `public_use_permission = false` | a model pass per post (D-7); reusing the `brand-voice-inference` prompt (§4.2); writing voice straight into `brand_voices` (§4.2) | 1 + 2 |
| Q4 | Marker = **`source = 'import'` bound to a non-null `import_run_id`**, immutable by trigger; recency governed by the **source post's date**; imported rows are never promoted to earned | an `origin` column parallel to `source` (§5.1); stamping import time (§5.3); promotion to earned (§5.4) | 1 + 2 |
| Q5 | Ceiling **200 posts / 24 months / 50¢ per run** (realistic ≈21¢); separate `backfill_cents` budget purpose + per-run cumulative spend; two-phase staging → claim queue; runs immediately after connect under **L-7′**'s latency ceiling | sharing the daily generation cap (§6.3); inline onboarding action (§6.5); a single-pass importer with no staging (§6.4) | 1 + 2 |
| Q6 | Vault path reused unchanged. **X: no scope change.** **LinkedIn: needs `r_member_social`** — founder-visible, adjudicated A-1 (not served). Security fix: `social_accounts` identity columns locked against `authenticated` UPDATE; token identity verified against the row | absorbing a LinkedIn scope change silently; trusting `platform_user_id` as written | 1 + 2 |
| Q7 | Lawful basis **covered by ADR 0020 §9.2 (processor, customer's own material) conditional on verified ownership**; ADR 0023 §7.2's break does not apply. New and owed: Evidence Pack entry, `/privacy` prose, `evidenceRef` bump, §D2.5 rows. Counsel list in §8.6 | assuming 0020/0023 cover it without argument; assuming they fail to | 1 + 3 |
| Q8 | 56 constraints: 16 Tier 1, 34 Tier 2, 5 Tier 3, 1 Tier E. The populated-memory corpus re-run is **MEASURED, never COVERED** | treating D9's 11/24 as proof this session works (§11.4) | 1 + 2 + 3 + E |

**Escalation flags raised by these answers, and their disposition:**

| Flag | Raised by | Disposition |
|---|---|---|
| A platform cannot serve history (value narrows) | Q1 | **Adjudicated A-1.** LinkedIn cold start is **not solved** by this session. |
| Broader OAuth scope than publishing | Q6 | **LinkedIn only; adjudicated A-1** (not served, so no connect-flow change ships). X: none. |
| New counsel work | Q7 | **Adjudicated A-5, A-6**; residual list §8.6. |
| Change to the trial-clock rule | Q5 | **None.** L-7′ holds; the trigger is untouched (§6.6). |
| New dependency | — | **None.** |

**Two interpretation notes the founder should see (neither contradicts a Locked decision):**

1. **L-6 "the EXISTING onboarding step".** The existing voice ratification step is onboarding **step-2**, and
   account connection is **step-3** (`step-3/page.tsx:11`, `Step3Client.tsx:157-167`). The existing step
   therefore runs **before** any imported data can exist — the same zero-width-window finding that produced
   L-7′. This ADR encodes L-6 as **re-entering step-2 in backfill mode** with the same `VoiceEditor` component
   (§10.3), not as a second voice editor. If the founder reads L-6 as "voice ratification must happen before
   connect", it cannot be met and needs adjudication.
2. **Which account is "brand" and which is "founder" (L-11)** cannot be derived for X: `platform_user_id` is a
   bare numeric id (`twitter-provider.ts:183`), and ADR 0028 rejected an account-type column. The founder
   **declares it once, at ratification** (§10.3), and it is recorded on the run row — not on
   `social_accounts`.

---

## 1. Context and decision summary

### 1.1 The measured failure

Session 30's live run scored **market_responsive recall 0/24**, and every `no_card` reason cited absent
audience/brand/campaign memory under the corpus's universal `stubMemory: {}` condition
(`docs/current-phase.md`, Session 30 entry). **As ADR 0023 §2.8 states, that was a hypothesis the model's own
text suggested, not a confirmed cause**, because the zero-memory condition had not been isolated.

Session 30-D's D9 then ran **one** out-of-band re-run with populated stub memory
(`npm run eval:live-triage-populated`): **recall 0/24 → 11/24**, precision 11/11, $0.66
(`docs/current-phase.md:243-252`). That moves the hypothesis from *untested* to **partially supported**:
populated memory recovers real recall, **and** memory is not the sole driver — 13 of 24 genuinely relevant
examples still scored `no_card`. It was one run, with hand-authored stub memory, on one prompt/model pair.

Cold-start emptiness is the only measured failure the project has. Today brand, evidence and audience memory
have **no writer at all**, and performance memory's only writers are the edit-learning loop
(`lib/db/memory-performance.ts:123-143`, callers `lib/learning/promote.ts:119`, `summarize.ts:185`).

### 1.2 The decision

Add a read path to the abstraction and use it once per newly connected account to import that account's own
original posts from the last 24 months (at most 200). Compute what is arithmetic deterministically; spend
three bounded model passes on voice, insights and evidence. Write everything as **candidate** memory
permanently marked as imported and bound to its run. Show the founder what was learned; nothing becomes
active, and no voice is changed, until the founder ratifies it.

### 1.3 The ledger (build-guide §0, restated with this ADR's encoding)

| # | Decision | Chosen | Loser | Encoded |
|---|---|---|---|---|
| D-1 | 19D-5 | option 1 — read path on `SocialProvider` | option 2, local SOSH posts only: a newly connected account has zero local posts, so it returns nothing on the only day the backfill matters. **The value of option 2 changed; its original reasoning (voice refinement over posts SOSH itself published, ADR 0011 §7) was sound for the consumer it had.** | §2, Amendment B |
| D-2 | Where the contract lives | the abstraction, `lib/social/index.ts` | a platform call at the call site (breaks `SOCIAL-PROVIDER-BOUNDARY`, `eslint-internals-ban.test.ts:53-75`) | §2, §3 |
| D-3 | Data scope | own original posts + aggregate metrics | comments/replies, commenter identities (third-party personal data; parked `relationship_memory`) | §2.4, §8 |
| D-4 | Provenance | permanently marked | merged with earned memory | §5 |
| D-5 | Voice corpus | performance-weighted + founder-ratified | import everything, unratified | §4.2, §10 |
| D-6′ | Timing | **immediately after connect, latency-bounded, clock untouched (L-7′)** | the three L-7′ losers (clock at completion; variable-length trial; moving the trigger) | §6.6 |
| D-7 | Compute | deterministic first, three model passes on filtered subsets | a model pass per post | §4, §6.2 |

---

## 2. The read contract (Q1) — the load-bearing section

### 2.1 Shape: an eighth method plus a static flag (A-2)

`SocialProvider` (`lib/social/types.ts:120-145`) gains:

- **`readonly historicalReadAvailable: boolean`** — a static, per-implementation fact. `TwitterProvider`:
  `true`. `LinkedInProvider`: `false` (A-1). `MockProvider`: `true`.
- **`fetchRecentPosts(input: FetchRecentPostsInput): Promise<RecentPostsPage>`**.

**Flag-consistency is part of the contract, not a convention.** Flag `false` ⇒ `fetchRecentPosts` throws
`SocialProviderError('NOT_IMPLEMENTED')` **with zero `fetch` calls**. Flag `true` ⇒ it never throws
`NOT_IMPLEMENTED`. The flag is necessary, not sufficient: an account on a served platform may still lack a
scope, which surfaces as a thrown error (§2.5), never as a flag.

**Loser: a separate optional `HistoricalPostReader` interface.** It is type-enforced, but it introduces a
pattern the abstraction does not have, a second registry map, and a capability probe at every call site. The
flat interface already carries the precedent: `fetchPostMetrics` and `fetchEngagement` throw
`NOT_IMPLEMENTED` on both native providers (`linkedin-provider.ts:306-322`, `twitter-provider.ts:329-345`).

### 2.2 Types (named in platform-neutral vocabulary — see §3)

**`FetchRecentPostsInput`**
- `platform: Platform` — added so the shared contract suite and `MockProvider` (registered for all five
  platforms, `registry.ts:44-54`) can serve any platform. Precedent: `OAuthAuthorizeInput.platform`
  (`types.ts:21-34`, ADR 0002 Amendment A §A.3).
- `socialAccountId: string` — **the contract is account-shaped (L-11)**. There is no business- or
  organisation-level read.
- `pageSize: number` — must satisfy `RECENT_POSTS_PAGE_SIZE_MIN = 5 ≤ pageSize ≤ RECENT_POSTS_PAGE_SIZE_MAX
  = 100`. Both bounds are servable by every implemented platform (X `max_results` is 5–100).
- `cursor: string | null` — `null` for the first page; otherwise exactly a `nextCursor` this method returned
  for **the same `socialAccountId`**. The provider enforces the account binding (§2.6); it cannot see a run, so
  "one cursor per run" is an orchestrator discipline (cursors are held in memory for one tick and never
  persisted, §6.4), not a provider guarantee.
- `notBefore: string | null` — an ISO timestamp **hint**. A provider may use it to stop early; it is not a
  guarantee. The orchestrator enforces the lookback on `publishedAt` itself.

**`RecentPostsPage`**
- `posts: readonly RecentPost[]` — possibly empty **even when `nextCursor` is non-null** (a page whose items
  were all filtered out is legitimate).
- `nextCursor: string | null` — `null` means the platform has no further page.

**`RecentPost`**
- `platformPostId: string`
- `publishedAt: string` — ISO, validated finite by the provider before return.
- `content: string` — **plain text**: markup stripped, entities decoded, whitespace collapsed, links and
  mentions kept as their visible text; truncated at `RECENT_POST_CONTENT_MAX_CHARS = 3000`.
- `url: string | null` — the post's public permalink.
- `format: 'text' | 'image' | 'video' | 'link' | 'multi' | 'other'` — derived from attachment *types* only.
- `metrics: PostMetrics | null` — **`null` means "not included in this read — fetch separately"**, never
  "the platform does not expose it" (A-3; the ADR 0002 Amendment A §A.3 `null` ambiguity is not re-imported).

**No account type, author identity, referenced post, mention target, media URL or engagement actor appears on
any of these types.** Identity-bearing expansions are excluded *structurally*: there is no field to put them
in. **Loser:** carrying `accountType` on `RecentPost` — the account is already named by the input, and memory
has no account scope to receive it (§5.2).

### 2.3 Bounds, as numbers

| Bound | Value | Owner | Behaviour past it |
|---|---|---|---|
| Page size | 5–100 | provider | **refused**: throws `RangeError` before any I/O |
| Content per post | 3,000 chars | provider | truncated |
| Posts accepted per run | `BACKFILL_MAX_POSTS = 200` | orchestrator | fetch stops |
| Lookback | `BACKFILL_LOOKBACK_MONTHS = 24` (A-4, both account types) | orchestrator | older posts discarded; fetch stops when a whole page is older |
| Pages per run | `BACKFILL_MAX_PAGES = 5` (500 raw posts) | orchestrator | fetch stops — the non-terminating-cursor guard |
| Platform reads per run | `BACKFILL_MAX_PLATFORM_READS = 500`, recorded on the run row | orchestrator | fetch stops |
| Per-request timeout | `SOCIAL_READ_TIMEOUT_MS = 10_000` | provider | `NETWORK` |
| `Retry-After` honoured | `SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS = 900` | provider | `retryAfterSeconds` capped; **the provider never sleeps** |

**Refuse, don't clamp.** An out-of-range `pageSize` is a caller bug; clamping silently changes what the caller
asked for. `RangeError` rather than a `SocialProviderError`, because none of the eight codes
(`types.ts:7-15`) describes a caller bug, and ADR 0028 §7 settled that no new code is added.
**Losers:** clamping; `PLATFORM_REJECTED` (misattributes a local bug to the platform and invites retry logic
to treat it as data).

X's own timeline ceiling (~3,200 most recent posts) is far above `BACKFILL_MAX_POSTS` and does not bind.

### 2.4 "Original authored post" — defined in the abstraction

A `RecentPost` is a post **authored by the connected account itself** that is **not** a reply, **not** a
repost/retweet, and **not** a quote post. Quotes are excluded because their own text is context-less without
the referenced post, and the referenced post is third-party content that is never fetched.

- **X:** `GET /2/users/:id/tweets` with **`exclude=replies,retweets`**; quote posts are dropped by the
  provider using the non-expanded `referenced_tweets[].type` field; **`referenced_tweets.id` is never
  requested as an expansion**; `liking_users`, `retweeted_by` and quote-author endpoints are never called.
- **LinkedIn (built, not served):** the Posts API author finder over the connected member URN, keeping only
  original shares (no reshares, no comments). **UNVERIFIED against the live API** (A-1).

### 2.5 Error taxonomy (the existing eight codes; reads get their own mapping)

`mapHttpStatusToErrorCode` (`error-mapping.ts:13-28`) states it covers **publish only** (`:6-8`) and is not
reused. Each read implementation maps:

| Condition | Code | Orchestrator reaction |
|---|---|---|
| Flag false | `NOT_IMPLEMENTED` | run → `unsupported`, zero reads |
| `pageSize` out of range (§2.3) | `RangeError` (not a `SocialProviderError`) | run → `failed` with `error_code = 'caller_bug'`, **not resumable**, reported to Sentry — a constant is wrong, and retrying cannot fix it |
| 401 / token refresh failed | `TOKEN_EXPIRED` / `TOKEN_REVOKED` | run → `failed` (resumable after reconnect) |
| 403 missing scope | `TOKEN_REVOKED`, `details.reason = 'scope_missing'` | run → `failed`; UI says a reconnect is needed |
| 403 content/account restriction, 404 suspended/protected | `PLATFORM_REJECTED`, `details.reason` | run → `failed` |
| Cursor not from this account/run, or unparseable | `PLATFORM_REJECTED`, `details.reason = 'cursor_invalid'` | run → `failed` |
| Token identity ≠ `platform_user_id` | `PLATFORM_REJECTED`, `details.reason = 'identity_mismatch'` | run → `failed`, **fail closed** |
| 429 | `RATE_LIMITED`, `retryAfterSeconds` ≤ 900 | tick defers the run; not a failure |
| Timeout, 5xx | `NETWORK` | next tick retries |
| Response fails Zod parsing | `UNKNOWN` | run → `failed` |

**`details` never carries post content, cursors or tokens** — only a `reason` code and numeric fields.
`errors.ts:44` redacts by key only, so this is an obligation on the constructor call sites, and it is tested.

### 2.6 Implementation obligations (every implementation)

1. **The cursor is opaque and bound to its account.** The implementation encodes `socialAccountId` inside the
   cursor it returns and rejects a cursor whose binding differs. Cursor lifetime is one run; cursors are never
   persisted (§6.4) and never logged. The existing `FetchEngagementInput.sinceCursor` (`types.ts:103`) is a
   different, unconsumed idiom and is **not** claimed as precedent.
2. **Pages may overlap.** The orchestrator de-duplicates on `platformPostId`; the implementation need not.
3. **Token refresh mid-pagination** goes through `withFreshToken` (`vault.ts:85-110`) per page, never a token
   held across pages.
4. **Identity verification (X).** On the first page (`cursor === null`) the implementation calls
   `GET /2/users/me` and compares the id with the row's `platform_user_id`; a mismatch fails closed (§7.3).
5. **Every response is Zod-parsed** before any field is read.
6. **Post text is untrusted input** — data to the model and to the database, never an instruction and never a
   URL to follow (§8.5).
7. **No sleep and no retry loop inside the provider.** Retry belongs to the orchestrator's tick cadence.

### 2.7 Per-platform honesty table (A-1)

| Platform | Provider | `historicalReadAvailable` | Scope needed vs granted today | Metrics (A-3) | Served? |
|---|---|---|---|---|---|
| **X** (founder or company) | `TwitterProvider` | **true** | `tweet.read`, `users.read`, `offline.access` — **already granted** (`platforms/config.ts:29`) | **inline**: `public_metrics` → `likes`=like_count, `comments`=reply_count, `shares`=retweet_count+quote_count, `saves`=bookmark_count, `impressions`=impression_count; `clicks`/`reach` = `null`. `non_public_metrics` is **not requested** (30-day window only) | **Served** — subject to the paid-tier quota verification in §6.7 |
| **LinkedIn** (member) | `LinkedInProvider` | **false** | needs **`r_member_social`**; granted `openid, profile, email, w_member_social` (`config.ts:22`) — review-gated behind a legal entity that does not exist (ADR 0028 §2.5, A-8) | **separate**: posts return `metrics: null`; the orchestrator calls `fetchPostMetrics`, which **still throws `NOT_IMPLEMENTED`** (`linkedin-provider.ts:306-313`) and is not changed here (Amendment B §B.5) — so LinkedIn posts would carry no metrics | **Not served.** Built against the docs, **UNVERIFIED**, re-verified when the scope is approved |
| **LinkedIn** (company page) | — | — | `r_organization_social` via the Community Management API; **company pages cannot be connected today** (`linkedin-provider.ts:147` writes only `urn:li:person:`) | — | **Not served**; nothing here forecloses it |
| Instagram | none (`registry.ts:67-71`) | — | — | — | **Not served** |
| Facebook Pages | none | — | — | — | **Not served** |
| Threads | none | — | — | — | **Not served** |

**Plainly: LinkedIn cold start is not solved by this session.** For a founder-led B2B company whose history
lives on LinkedIn, the backfill yields nothing until `r_member_social` is approved. The LinkedIn data-export
upload is **not scoped** and remains a named future option (§13).

**Loser (A-1):** feeding the extractors from Jemip-published local posts as a LinkedIn mitigation — zero
posts on day one (D-1's option 2 in substance), and it collapses earned and imported provenance (D-4).

### 2.8 Q1b — outbound activity (feasibility only; nothing is read)

`BACKFILL-NO-COMMENT-READ` stands and its scan must pass. **Every row below is advisory-reviewer knowledge,
not verified against live APIs, and must be re-verified before any session builds on it.**

| Platform | (a) Comments the customer wrote on others' posts | (b) Posts the customer reacted to | API surface |
|---|---|---|---|
| X | **Served** — own replies are posts; `GET /2/users/:id/tweets` without `exclude=replies` | **Served with a scope change** — `GET /2/users/:id/liked_tweets` needs `like.read` (not granted) | X API v2 |
| LinkedIn | **Not served** | **Not served** | no member-app surface |
| Instagram | **Not served** | **Not served** | Graph API exposes comments on own media only |
| Facebook Pages | **Not served** | **Not served** | — |
| Threads | **Served per docs** (`threads_read_replies`) — no provider exists | **Unknown** | Threads API |

**If this later ships**, the data-scope split is binding: the customer's own words and **derived** topic
labels are retainable; **the third-party post the action attaches to is not**. An extractor that stores
target content has become the deferred comment-mining path and inherits its counsel condition (§13). T1-D
(the founder interview) reaches the same material by asking rather than reading.

### 2.9 What `MockProvider` returns, and why a read test against it is not circular

Today `MockProvider` is non-deterministic (`crypto.randomUUID()`, `mock-provider.ts:72-74`), and its only
list-returning read returns `[]` unconditionally (`:126`) — no fixture demonstrates a non-empty page, a
cursor round-trip, or a filter. A contract test against that proves nothing.

`MockProvider.fetchRecentPosts` serves **deterministic, seeded fixture accounts** keyed by `socialAccountId`
and records every call in `calls.fetchRecentPosts`. Required fixtures:

| Fixture | Proves |
|---|---|
| `empty` — zero posts | run completes with zero writes and a truthful "nothing to learn" state |
| `standard` — 230 posts over 30 months, mixed formats, metrics inline | the 200 ceiling and the 24-month lookback both bind |
| `zero-post-page` — a page with no posts and a non-null cursor | the orchestrator does not treat an empty page as the end |
| `non-terminating` — every page returns a cursor | `BACKFILL_MAX_PAGES` stops it |
| `mixed-types` — replies, reposts and quotes interleaved | the §2.4 filter (the mock applies the same definition) |
| `fail-on-page-N` — throws a configured code on page 3, via `maybeThrow` (`:61-70`) | resume from staging (§6.4) |
| `metrics-separate` — `metrics: null` on every post | the A-3 separate-fetch branch |
| `over-long` — content above 3,000 chars | truncation |
| `two-accounts` — a founder and a company account on one business | L-11 separation end to end |
| cross-account cursor — a cursor from account A presented for B | `cursor_invalid` |

**Why this is meaningful:** the *orchestrator, extractors, ceilings and write discipline* are the system under
test, and they consume the mock exactly as they consume a real provider. The mock does not grade its own
output — the assertions are on staging rows, memory rows and run state. The real providers' parsing and
filtering are proven separately against **recorded fixtures** (ADR 0002 Amendment A §A.8), never the network.
`SOCIAL-MOCK-MODE-OFFLINE` (`provider-contract.test.ts:145-183`) is extended to `fetchRecentPosts`.

---

## 3. Contract neutrality (Q2, re-scoped)

Postiz no longer exists (ADR 0028; `no-postiz.test.ts`), so the failure mode Q2 named — a contract that
quietly encodes Postiz's response shape — is structurally impossible. **Its successor is live: a contract that
quietly encodes X's response shape**, because X is the only platform that serves this read today and the
first implementation always shapes the interface.

| Contract element | Neutral or platform-shaped | Why |
|---|---|---|
| `cursor: string \| null`, opaque | neutral | X `pagination_token` and LinkedIn `start`/`count` both fit inside an opaque string |
| `pageSize` 5–100 | neutral by construction | the range is servable by every implemented platform |
| `notBefore` as a hint | neutral | X supports `start_time`; LinkedIn does not; a guarantee would be X-shaped |
| `metrics: PostMetrics \| null` with "fetch separately" | neutral | A-3's whole point; an always-inline contract is unfillable on LinkedIn |
| `PostMetrics` field mapping | neutral | reuses ADR 0002 §3's type; X's `quote_count` is folded into `shares` inside the provider |
| `format` enum | neutral | derived from attachment types; no platform media object leaks |
| `content` plain text | neutral | X entity markup and LinkedIn's text format are normalised inside the provider |
| Identity verification on page 1 | **platform-specific, behind the interface** | X exposes `/2/users/me`; LinkedIn's equivalent is the OIDC `sub`; neither leaks |

**Named rejected shape:** `RecentPost` carrying `public_metrics`, `referenced_tweets`, `edit_history_tweet_ids`
or `pagination_token`. **What future providers owe this session:** every future provider (Meta family,
LinkedIn organisation) implements the same method or declares `historicalReadAvailable: false`; none widens
the types above without an amendment to ADR 0002.

`SOCIAL_INTERNALS_BAN` must be confirmed to fire for a probe placed under the new `lib/backfill/` directory
(the architect reviewer flagged this as unchecked); if the probe in `eslint-internals-ban.test.ts` does not
cover it, the Builder adds a second probe.

---

## 4. Extraction per memory type (Q3, L-8)

### 4.1 The pipeline

1. **Fetch** into staging (§6.4). Deterministic.
2. **Compute account statistics** — cadence, weekday/hour distribution, format distribution, length
   distribution, and the **engagement baseline** (median of `(likes + comments + shares) / impressions` where
   `impressions` is non-null; otherwise median raw engagement). Stored on the run row as `summary` for the
   "what we learned" screen only — cadence and timing are **not** memory (no `performance_memory` dimension
   holds them, `types.ts:1173`).
3. **Performance weighting** — each post gets `lift = engagement / baseline`. The **weighted subset** is the
   top 30 posts by lift. If no post in the run has metrics (the LinkedIn case), the subset is the 30 most
   recent and the run records `weighting = 'unweighted_no_metrics'`, which the ratification screen states.
4. **Three model passes**, all through `lib/ai/` with `CustomerContext`, each input wrapped `[DATA]…[/DATA]`:
   voice synthesis (Sonnet, top 20 of the subset), insights (Sonnet, the 30-post subset), evidence (Haiku,
   all staged posts in batches of 20).
5. **Write** candidate memory through `lib/memory/` → `lib/db/memory-*` import writers.

### 4.2 Voice — staged, then applied at ratification

**What:** a synthesised `VoiceAxes` + `tone` + `keywords` + `avoid_words`, plus up to
`BACKFILL_VOICE_EXAMPLES = 3` writing examples (the highest-lift posts, verbatim, ≤ 1,000 chars each). **3, not
more**, because `brand_voices.writing_examples` carries `CHECK (cardinality(writing_examples) <= 3)`
(`20260430120005_brand_voices.sql:15`); this session does not widen that CHECK. When the founder's existing
voice already has examples, the ratification editor shows both sets and the founder chooses which ≤ 3 are kept —
the apply step never concatenates past the cap.
**Model-derived**, one Sonnet call, new prompt id `backfill-voice-synthesis`, reusing
`BrandVoiceInferredSchema` (`lib/ai/prompts/brand-voice-inference.ts:15-23`) as its output schema.

**Where it goes — nowhere, until ratification.** `brand_voices` has no governance fields, and
`upsertBrandVoice` (`lib/db/brand-voices.ts:18-30`) overwrites on `business_id` and is visible to generation
immediately. The synthesised voice is **staged** on the run row (`staged_voice`). At ratification (§10.3):

- **Account declared `brand`:** applied to `brand_voices` (`voice_axes`, `tone`, `keywords`, `avoid_words`,
  `writing_examples`) through the existing `upsertBrandVoice` path, after the founder edits it in
  `VoiceEditor`.
- **Account declared `founder`:** applied as a **new `brand_voice_variations` row** named after the account's
  display name — the ADR 0011 mechanism that exists precisely so two voices do not average into one (L-11).
  **A variation stores `name` and `voice_axes` only** (`20260623210000_voice_axes.sql:47-77`) — it has no
  `tone`, `keywords`, `avoid_words` or `writing_examples` column. So **a founder voice is applied as axes only**,
  and the synthesised tone, keywords, avoid-words and examples for a founder account are **not persisted**.
  The ratification screen states this plainly ("your personal voice is saved as tone sliders; example posts are
  kept for your company voice only"). This is accepted as a known narrowing of L-11 rather than hidden: the two
  voices still never average, but the founder voice is less rich than the brand voice. **Loser:** widening
  `brand_voice_variations` in this session — it changes an ADR 0011 store that generation already reads, which
  L-1 fences out. Widening is deferred (§13).
- **Variation cap reached** (5 per business, `voice_variation_cap_reached`, `20260623210000_voice_axes.sql:140`):
  the voice part is **refused with an explicit state** and **stays retryable** — the founder may delete a
  variation and apply again, because `staged_voice` is kept until voice application succeeds (ordering below).
  The non-voice memory is still ratifiable. No automatic eviction.

**Ordering — memory ratification and voice application are two steps, and the staged voice outlives the first.**
`ratify_backfill_run` (§9.4) activates/retires memory rows and records `account_role`, but **does not touch
`staged_voice`**. The voice is applied afterwards by its own Server Action, which on success sets
`voice_status = 'applied'`, `voice_applied_to`, `voice_applied_at` **and nulls `staged_voice` in the same
conditional UPDATE** (`WHERE voice_status IN ('pending','refused_cap','failed')`). On failure it records
`voice_status = 'refused_cap'` or `'failed'` and leaves `staged_voice` intact, so a retry has something to apply.
`staged_voice` is otherwise nulled only by discard, by the founder choosing "don't use this voice"
(`voice_status = 'declined'`), or by the staging TTL sweep (§8.3). **Loser:** nulling `staged_voice` inside the
ratify RPC — it makes any voice-application failure unrecoverable, which contradicts the retry promised above.

**Voice provenance** lives on the run row (`voice_applied_to`, `voice_applied_at`), not in the voice stores.
This is a **stated exception** to L-3's "every record carries the marker": `MEM-VOICE-THROUGH-EXISTING` forbids
a voice store, and the existing ones carry no governance fields (`types.ts:141-155,179-186`). The absence of a
provenance column on `brand_voices` is Tier 3; the run row is Tier-1 covered.

**Losers:** reusing the `brand-voice-inference` prompt — its id is classified `isBrandVoice`
(`runner.ts:33`), so it would be **refused** once the trial's brand-voice attempts are spent (`:95-96`), would
**consume** one on success (`:283-284`), and runs on Opus at 1500/7500 ¢/MTok (`models.ts:5-9`); writing voice
straight into `brand_voices` (unratified, overwrites founder input, no provenance).

### 4.3 Performance — what a backfilled record is

A backfilled performance record is a **probabilistic claim about the account's past**, not a learned rule
about the customer's editing behaviour:

| | Learned (`lib/learning/*`) | Imported (this ADR) |
|---|---|---|
| Evidence | edit signals inside SOSH | published posts outside SOSH, with metrics |
| `source` | `'distilled'` (fixed in SQL, `20260726030000…sql:59`) | `'import'`, fixed in the import RPC |
| `pattern_key` | namespaced key | `NULL` (declared intent, `types.ts:1179-1185`) |
| Promotion | `promote_performance_pattern` (n≥5, conf≥0.70, ≥2 campaigns) | **never** — ratification activates it; never promoted to earned (§5.4) |
| Confidence | `min(0.95, net/(net+2))` | `0.6 × n/(n+5)`, ceiling **0.6** |
| Expiry | now + 90 days | **newest backing post's `publishedAt` + 12 months**; not written if already expired |

**Why imported patterns expire.** With `expires_at = NULL` an imported claim would outlive every learned one
(which lapse 90 days after distillation), inverting the posture that imported evidence is the weaker kind. The
12-month horizon is anchored to the **source** date (consistent with §5.3 and with evidence `usage_data`, §4.5),
not to the import, so a pattern whose newest supporting post is already a year old never enters memory. It is
longer than the learned 90 days because the learned window restarts on every re-distillation and the imported
one never does. **Losers:** `NULL` (outlives earned memory); import time + 90 days (stamps age-old evidence as
fresh — the §5.3 argument).

- **`format` patterns — deterministic.** A format with **n ≥ 5** backing posts whose median lift ≥ 1.25.
- **`topic` / `hook` / `proof_type` patterns — model-derived** in the insights pass. The model proposes a
  pattern **and its backing post ids**; the orchestrator discards ids not in the run, recomputes n and median
  lift from staging itself, and drops any pattern with n < 5 or lift < 1.25. **The model never supplies n or
  confidence.**
- Cap: `BACKFILL_PERFORMANCE_CAP = 15` rows per account. A partial UNIQUE index covers imported rows:
  `(business_id, dimension, coalesce(platform,''), md5(lower(pattern)), import_run_id) WHERE source =
  'import' AND deleted_at IS NULL`.
- `trg_performance_memory_voice_write_guard` fires only for `source = 'distilled'` (`20260726020000:90`); it
  is **intended not to fire** for imports, whose voice interaction is governed by ratification. Stated so
  nobody "fixes" it.

### 4.4 Audience — honestly thin

With comments excluded (L-2), audience yield comes only from how the customer **addresses** their audience:
the problems they name, objections they pre-empt, questions they pose. **Model-derived** in the insights pass;
each statement must cite ≥ 2 backing posts; confidence `0.3` flat (thin evidence, self-reported framing);
`kind` ∈ problem/objection/question/trigger; cap **25 per account**. Expect single-digit rows for most
accounts. This is shown to the founder as "how you talk to your audience", not "what your audience says".

### 4.5 Evidence — claims already published, permission still false

**Model-derived** (Haiku, batched, fail-closed on invalid output). Extracts `usage_data`, `case_study` and
`quote` items. **Verify-then-cite:** `content` must be a verbatim substring of the staged post (after the same
normalisation), ≤ 500 chars; items that fail are dropped. `source_url` = the post permalink. Cap **40 per
account**. Confidence `0.5`.

**The permission argument, as adjudicated (A-6):** a claim the customer already published is cleared *by the
customer* for public use, but **a quote inside it belongs to a third party whose permission the customer may
never have held**, and the extractor cannot reliably tell a first-party statistic from a third-party
testimonial. **Every imported evidence row is written with `public_use_permission = false`, fixed inside the
import RPC.** The founder may enable one only through a confirmation that they hold the quoted person's
permission; **that confirmation copy is counsel-gated** (§8.6). **Loser:** a first-party / third-party split
at extraction (disputed by the security reviewer; unreliable, and a wrong `true` republishes a stranger's
words).

`usage_data` rows get `expires_at = publishedAt + 12 months`; rows already expired at import are not written.

### 4.6 Brand — deliberately omitted

Brand memory holds **approved stable facts** (positioning, pricing, competitors). A post is not an approval of
a positioning statement, and a two-year-old pricing claim is actively harmful. No brand row is written.

---

## 5. Provenance, confidence and decay (Q4, L-3)

### 5.1 The marker

**`source = 'import'` AND `import_run_id` NOT NULL**, on all four `*_memory` tables:

- `import_run_id uuid NULL REFERENCES social_backfill_runs(id) ON DELETE NO ACTION`, indexed.
- `CHECK ((source = 'import') = (import_run_id IS NOT NULL))` — an import row cannot lose its run, and no
  other source can claim one. No existing row violates it (`'import'` has no writer today).
- `import_source_post_ids text[] NULL` with `CHECK ((source = 'import') = (import_source_post_ids IS NOT
  NULL))` — the platform post ids backing the row, so it is removable per source post (A-5).
- **A `BEFORE UPDATE` trigger** rejects any change to `source`, `import_run_id` or `import_source_post_ids`.
  `source` is otherwise mutable today through the authenticated INSERT/UPDATE policies
  (`governed_memory.sql:66-73`) — the database reviewer's dispute, accepted.

**Why `ON DELETE NO ACTION`, not `RESTRICT` or `CASCADE`:** runs are never deleted except by the business
cascade, which removes the memory rows in the same statement; `NO ACTION` is checked at statement end and
permits that, whereas `RESTRICT` is checked immediately and would fail the cascade. `CASCADE` would let a run
deletion silently erase memory the founder ratified.

**Stated consequence:** because `social_backfill_runs.social_account_id` cascades from `social_accounts`, a
hard `DELETE` of a single `social_accounts` row whose run has import memory **fails** on this key. That is
acceptable today — the only hard delete in the repo is `purge_business`'s root `DELETE FROM public.businesses`
(`20260702120700_purge_business_member_delete.sql:62`), and disconnect is a soft deactivate (§6.8). Any future
per-account hard delete must first remove or re-home that account's import memory; it is not a silent failure,
it is a loud one, which is the intended direction.

**Loser:** an `origin` column parallel to `source` — `'import'` already exists in `MemorySource`
(`types.ts:1121`), and a second marker invites the two to disagree.

### 5.2 Account discriminator (L-11)

`import_run_id` **is** the account discriminator: a run belongs to exactly one `social_account_id` and carries
the founder-declared `account_role`. Manual and distilled rows have `NULL` and are business-level. **No account
column is added to memory**, and **retrieval is unchanged** (L-1: no change to `CustomerContext`). Separation is
enforced where L-11 requires it — extraction, voice synthesis, marking and ratification — and retrieval-time
use of the discriminator is a later decision (§13).

### 5.3 Which timestamp governs recency

`recency_at` is a STORED generated column, `COALESCE(last_confirmed_at, created_at)` (`types.ts:1126-1130`).
The import writer sets **`last_confirmed_at` to the source date**: the post's `publishedAt` for evidence and
audience, and the **newest backing post** for performance. Dates are validated finite before the write,
because `recencyDecay` throws on a non-finite age (`scoring.ts:36-38`).

**Argued:** a 2024 post is old; *the fact that it performed well* may not be — but nothing in an import can
tell which. Recency carries weight 0.3 (`constants.ts:8-12`), so a two-year-old imported row loses at most 0.3
and still competes on confidence and scope. Stamping import time would make every imported claim look freshly
observed on day one and outrank genuinely recent earned memory. **Ratification does not touch
`last_confirmed_at`**: a founder saying "keep this" is not a re-observation.

**Losers:** import time as the recency source; `now()` at ratification.

### 5.4 Promotion, confirmation, and Session 33

- **Imported records are never promoted to earned.** Ratification flips `candidate → active`; it does not
  change `source`, and the trigger forbids anyone else doing so.
- **When a learned pattern later confirms an imported one**, the learned row is written independently with
  `source = 'distilled'`. `upsert_distilled_performance_pattern`'s conflict target is
  `WHERE source = 'distilled'` (`20260726030000…sql:63-70`), so it can never overwrite an import row. The two
  coexist, each with its own evidence.
- **Known consequence, deferred to Session 33:** an imported and a distilled row expressing the same pattern
  can take two of the three `PERFORMANCE_CAP` slots.
- **How Session 33 distinguishes them:** `source = 'import' AND import_run_id IS NOT NULL` identifies every
  imported row permanently; its outcome loop reads `source = 'distilled'` only, as
  `listDistilledPatternsForSummary` already does (`memory-performance.ts:90`).

### 5.5 Initial confidence per type

| Type | Confidence | Justification |
|---|---|---|
| performance (`format`, deterministic) | `0.6 × n/(n+5)`; 5 posts → 0.30, 20 → 0.48, ceiling 0.6 | arithmetic over real outcomes, but past, off-platform and uncontrolled |
| performance (model-proposed, recomputed) | same formula | the model proposes; n is computed by us |
| audience | 0.3 | self-framing, not audience speech |
| evidence | 0.5 | verbatim and cited, but permission unverified |
| voice | n/a — no confidence field | ratified or not applied |

All are below `LEARN_PROMOTION_MIN_CONFIDENCE = 0.7` (`promote.ts:15-21`), so an imported pattern can never
look as certain as a promoted learned one.

---

## 6. Ceilings, cost and failure (Q5)

### 6.1 Hard ceiling

**200 posts, 24 months, 5 pages, 500 platform reads and 50¢ per run.**

### 6.2 Arithmetic (rates from `lib/ai/models.ts:4-20`: Sonnet 300/1500, Haiku 100/500 ¢/MTok)

Assumes ~250 tokens per post after the 1,000-char extraction truncation.

| Pass | Model | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Voice synthesis | Sonnet 4.6 | 20 posts × 250 + 3k prompt = 8k | 1.5k | 8k×300/1M + 1.5k×1500/1M = 2.40 + 2.25 = **4.65¢** |
| Insights | Sonnet 4.6 | 30 × 250 + 2k = 9.5k | 4k | 2.85 + 6.00 = **8.85¢** |
| Evidence | Haiku 4.5 | 200 × 250 + 10 × 1.5k = 65k | 15k | 6.50 + 0.75 = **7.25¢** |
| **Total** | | | | **≈ 20.75¢**; up to ~33¢ with per-call integer ceiling rounding (`calculateCostCents` ceils; 12 calls) |

**The 50¢ ceiling** is ~2.4× realistic and ~1.5× the rounded worst case. A run whose next call would cross it
stops extracting and moves to `awaiting_ratification` with what it has, marked `partial` (§6.4).

### 6.3 Separate budget, not the shared daily cap

A backfill is a one-time burst on the customer's first day — the same day they create their first campaign.
Charging it to the daily generation or triage cap would starve the product on exactly the day it must feel
warm. It gets:

- a new `ai_budget_daily.purpose` value **`backfill_cents`**. The existing CHECK is inline and
  Postgres-named (`20260909110000_ai_budget_daily_rename.sql:58-59`, added on the already-renamed table, so its
  name is `ai_budget_daily_purpose_check`). The migration **must not** rely on `DROP CONSTRAINT IF EXISTS` with a
  guessed name — a wrong guess silently no-ops, leaves the old CHECK in place alongside the new one, and every
  `backfill_cents` write is rejected. Instead it looks the constraint up in `pg_constraint` (`conrelid =
  'public.ai_budget_daily'::regclass`, `contype = 'c'`, definition referencing `purpose`), **raises if it does not
  find exactly one**, drops it by that name, and re-adds it **explicitly named** `ai_budget_daily_purpose_check`
  with the three values; per-business daily ceiling `BACKFILL_DAILY_CENTS = 150`
  (three runs);
- **per-run cumulative `spend_cents`** on the run row, reserved atomically before each call by a conditional
  UPDATE (`spend_cents + estimate <= ceiling_cents`), in the `SIGNAL3-COST-CEILING-ATOMIC` idiom;
- every call recorded in `ai_usage` as usual.

**Trial caps are untouched.** The runner refuses a non-brand-voice prompt when `postsRemaining <= 0`
(`runner.ts:98-99`) and increments `posts_generated_count` on success (`:286`). Backfill prompt ids are
classified like scoring-only calls: **they neither check nor increment either trial counter.** An import is
not a generated post. Precedent: the summariser's exemption (`summarize.ts:161-163`).

**Loser:** sharing the daily cap.

### 6.4 Resumable in two phases — and the named failure mode

**The failure mode designed against: a half-imported memory that looks complete.**

- **Phase 1 — fetch into staging.** `social_backfill_posts` keyed `UNIQUE (social_account_id,
  platform_post_id)`, `ON CONFLICT DO NOTHING`. A failure mid-fetch leaves the rows already staged; the next
  tick restarts from `cursor = null` and de-duplicates. **No cursor is persisted.** Fetch stops at any §2.3
  bound.
- **Phase 2 — extract via a claim queue.** Staged rows carry `extraction_status` (`pending → claimed →
  extracted | skipped | failed`), claimed by a `SECURITY DEFINER` RPC with `FOR UPDATE SKIP LOCKED` — the
  `claim_post_edit_signals` idiom (`lib/learning/orchestrator.ts:352-355`). Completed model passes are recorded
  on the run row; a re-delivered tick does not repeat a completed pass.
- **Memory writes are idempotent per run, not just per pass.** `passes_done` is updated *after* a pass's writes,
  so a crash between the two re-runs the pass. Every import writer therefore inserts `ON CONFLICT DO NOTHING`
  against a partial UNIQUE index scoped to the run:
  - `evidence_memory (import_run_id, kind, md5(content)) WHERE source = 'import'`
  - `audience_memory (import_run_id, kind, md5(lower(statement))) WHERE source = 'import'`
  - `performance_memory` — the §4.3 index, which already includes `import_run_id`.

  A re-run pass may call the model again (cost is reserved again and bounded by the 50¢ ceiling), but it cannot
  duplicate memory. Model output is not deterministic, so a re-run can add a *differently worded* row; the
  per-account caps (§4.3–§4.5) are checked against rows already written for the run, so the total stays capped.
- **Nothing is active until ratification.** Every import row lands `status = 'candidate'`; retrieval returns
  active rows only (`scoring.ts:87-91`). **A half-imported memory therefore cannot look complete to any
  consumer**: until the founder ratifies, it is invisible to generation; when ratified, the screen says
  `partial` with the real counts.
- **Explicitly discardable.** The founder can discard a run in any non-terminal state; discard retires its
  candidates and purges its staging rows in one transaction.

**Run states:** `queued → fetching → extracting → awaiting_ratification → ratified`, plus `unsupported`,
`failed` and `discarded`. `partial` is a boolean on `awaiting_ratification`/`ratified`, not a state.

**Losers:** a single-pass importer with no staging (a crash loses fetched work, and a retry double-writes
memory); persisting the cursor (an opaque platform token in a table, useless after its short lifetime).

### 6.5 Where it runs

- **Enqueue:** the OAuth callback (`app/api/social/[platform]/callback/route.ts`), after the account row is
  written, inserts a `queued` run **only if the account has no run other than `discarded` ones** (a `failed` run
  blocks a new insert — it is resumed, not replaced), then fires one tick best-effort through `after()` (the
  `saveStep1Action` precedent, `step-1/actions.ts:53-55`). A reconnect reuses the same `social_accounts` row —
  the callback upserts on `(business_id, platform, platform_user_id)` (`callback/route.ts:135-155`) — so a
  reconnect never creates a second account and cannot bypass this rule.
- **Resume means the same run row.** A resumable `failed` run moves `failed → queued` by an atomic conditional
  UPDATE (`WHERE status = 'failed' AND error_code <> 'caller_bug'`), triggered by the reconnect callback (for
  token/scope failures) or the founder's retry button. It keeps its `id`, so staging, `spend_cents`,
  `passes_done` and every memory row already written stay attached to it. **Loser:** a fresh run per retry — it
  re-extracts everything under a new `import_run_id`, which the run-scoped idempotency indexes (§6.4) cannot
  de-duplicate, and doubles the memory.
- **Safety net:** a new QStash-triggered route `app/api/cron/backfill/route.ts` in the `sync-metrics` pattern
  (dual-mode auth, `maxDuration = 60`, one canonical structured-JSON log line, `Sentry.withMonitor`), every
  minute. Each tick does bounded work — one run's fetch phase **or** one model pass / claim batch — and sweeps
  stalled runs and expired staging.
- The orchestrator lives in **`lib/backfill/`**, importing `lib/social` only via `index.ts`, memory only via
  `lib/memory/`, and AI only via `lib/ai/`.

**Loser:** an inline onboarding Server Action — model passes exceed a request's lifetime, and a closed tab
would kill the import.

### 6.6 Timing (L-7′) — the clock is untouched

The trial clock starts in `AFTER INSERT ON social_accounts`
(`20260430120008_social_accounts_trial_trigger.sql:9-38`). The backfill starts **after** that insert by
construction. **No migration in this session touches that trigger, `trial_state`, or
`find_trial_expiring_between`.** The trigger fires once per business, so a second account connected later
raises no clock question.

**Latency ceiling:** `queued → awaiting_ratification` within **`BACKFILL_LATENCY_TARGET_MINUTES = 10`** for a
full 200-post run; a run with no progress for **`BACKFILL_STALL_MINUTES = 30`** is marked `failed`
(resumable). Onboarding stays usable throughout (§10). The 10-minute target is verified operationally after
launch (§6.7); the stall transition is Tier-2 tested.

### 6.7 Operational obligations (launch checklist, not code)

- A QStash schedule for `/api/cron/backfill`, every minute.
- **X paid-tier read quota verified** against `BACKFILL_MAX_PLATFORM_READS` × expected connects per month. The
  monthly post-read cap is shared across all customers; the per-run `platform_posts_read` column is the ledger
  to sum.
- The 10-minute latency target observed on the first real connects.

### 6.8 Disconnect

Disconnecting an account (`deactivateSocialAccount`, `social-accounts.ts:92-125`) moves any non-terminal run
for it to `discarded` and purges its staging rows. Already-ratified memory stays (the founder ratified it);
removal is by deletion or business purge.

---

## 7. Token scope and the Vault path (Q6, L-5)

### 7.1 No new token surface

Reads use `withFreshToken` (`vault.ts:85-110`) → `get_vault_secret` (`:38-49`) exactly as publish does
(`twitter-provider.ts:244-277`). No new function reads a secret; no new type carries one.

**L-5 is reworded, because as written it was already false:** `TokenSet.accessToken`/`refreshToken`
(`types.ts:43-44`) are raw tokens in a barrel-exported type (`index.ts:7`). The accurate form: **no raw token
appears in any persisted row type, and no type crossing `lib/social/` carries one other than `TokenSet`, the
transient OAuth exchange type** — consumed only by the callback route (`callback/route.ts:84,98,113`) and
produced by `exchangeOAuthCode` and `TwitterProvider.refreshAccessToken` (`:481-486`). This session adds no
producer or consumer of `TokenSet`.

### 7.2 Scope per platform

| Platform | Needed for history | Granted today | Change |
|---|---|---|---|
| X | `tweet.read`, `users.read` (+ `offline.access`) | same (`config.ts:29`) | **none** |
| LinkedIn member | `r_member_social` | no read scope (`config.ts:22`) | **needed — founder-visible — adjudicated A-1: not served, so no connect-flow change ships** |
| LinkedIn organisation | `r_organization_social` | — | out of scope (ADR 0028 A-8) |

### 7.3 Identity lock (security reviewer HIGH, accepted)

`social_accounts_update_own` (`20260430120017_fix_rls_function_caching.sql:69-72`) lets `authenticated` UPDATE
any column, and `SocialAccountUpdate` (`types.ts:233-236`) admits the vault ids. **Rewriting
`platform_user_id` would make the backfill import a third party's timeline.** Two defences, both required:

1. **Replace the table-level UPDATE grant with a column allowlist.** A column-level `REVOKE UPDATE (…)` is
   **ineffective here**: `authenticated` holds a table-level `UPDATE` on every public table
   (`20260707190000_service_role_table_grants.sql:28`), and Postgres does not subtract a column revoke from a
   table-level grant. The migration therefore does `REVOKE UPDATE ON public.social_accounts FROM authenticated`
   (and `anon`), then `GRANT UPDATE (<allowlisted columns>) ON public.social_accounts TO authenticated`. The
   allowlist is **every column except** `id`, `business_id`, `platform`, `platform_user_id`,
   `vault_access_token_id`, `vault_refresh_token_id`, `is_active`, `token_expires_at`, `scopes_granted` and
   `connected_at`; the Builder enumerates it from the live table definition, and it is recorded in the
   migration header. A column added later is **not** updatable by `authenticated` until it is added to the
   allowlist — fail-closed. The default privileges at `20260707190000:32` are unaffected (they govern future
   tables, not this one). Those columns are also removed from `SocialAccountUpdate`. Writes to them go through service-role functions, which the callback, refresh and
   disconnect paths already use. **SHARED-FUNCTION CALLERS:** the Builder `git grep`s every caller of
   `updateSocialAccount` (`social-accounts.ts:76-90`) and states per caller which client it passes; any
   authenticated-client caller writing a locked column is re-pointed, with its test named.
2. **Token identity verification** on every run's first page (§2.6, obligation 4).

### 7.4 `scopes_granted`

Add `social_accounts.scopes_granted text[] NULL`, written by the callback (`TokenSet.scopesGranted`,
`types.ts:46`) and by `TwitterProvider.refreshAccessToken` (`:470,485`). `NULL` or `[]` means **unknown** (both
providers can return `[]`, `linkedin-provider.ts:146`, `twitter-provider.ts:182`). It is **advisory**: the
platform's 403 is authoritative. It exists so the future LinkedIn flag flip can tell which connected accounts
must reconnect. It is not secret, and it is outside the `authenticated` UPDATE allowlist (§7.3) so it cannot be
forged.

---

## 8. Legal posture (Q7, L-9)

### 8.1 Which existing positions apply — decided, not assumed

- **ADR 0020 §9.2 (Jemip as processor over the customer's own material): APPLIES**, conditional on
  **verified ownership** — which is why §7.3's identity lock and §2.6's identity verification are legal
  preconditions, not hardening. The customer is the controller of their own published posts; importing them to
  serve that customer is within the processor instruction.
- **ADR 0023 §7.2's break (third-party articles, fresh Art. 6(1)(f) balancing): DOES NOT APPLY** — nothing
  third-party is ingested as a source.
- **Aggregate metrics** are a deliberate, narrow difference from ADR 0020 §9.1: counts only; identity-bearing
  expansions are never stored, and the types have no field for them.

### 8.2 Genuinely new, and owed before this ships

1. An **Evidence Pack entry** in `docs/evidence/0010-legal-evidence.md` describing the import.
2. **`/privacy` prose** covering the import of the customer's own posts and metrics, and the retention below.
3. The **`evidenceRef` bump** on the touched `content/legal/*.mdx`.
4. **Two §D2.5 rows** (§9.2).

### 8.3 Retention

| Data | Where | Retained until |
|---|---|---|
| Staged post text, metrics, permalink | `social_backfill_posts` | ratification, discard, disconnect, or **`BACKFILL_STAGING_TTL_DAYS = 30`** after the run left `extracting` — whichever comes first |
| Evidence excerpt (≤ 500 chars) | `evidence_memory` | founder deletion, per-post removal, `usage_data` expiry, or business purge |
| Audience / performance statements | `*_memory` | founder deletion, per-post removal, or business purge |
| Up to 3 writing examples | `brand_voices.writing_examples` (brand accounts only, after voice application) | founder edit or business purge |
| Account statistics, counts | `social_backfill_runs` | business purge |
| Staged voice (may hold ≤ 3 verbatim excerpts) | `social_backfill_runs.staged_voice` | successful voice application, founder declining it, discard, or **`BACKFILL_STAGING_TTL_DAYS = 30`** after ratification — whichever comes first |

`purge_business` reaches all of it through `ON DELETE CASCADE` from `businesses` (§9).

### 8.4 Third parties inside the customer's own posts

Quoted people and named customers may appear in post text. Consequences: staging is short-lived (§8.3);
evidence always lands `public_use_permission = false` (A-6); evidence excerpts are verbatim and cited, so the
founder can see exactly whose words they are. **Per-source-post removal** (`import_source_post_ids`, §5.1)
deletes evidence and audience rows backed by a removed post and retires performance rows whose backing set
included it — the mechanism a deletion-sync obligation needs (A-5). Wiring platform deletion notices to it is
counsel's call.

**Imported content never feeds cross-customer learning.** Every read is business-scoped by RLS; no aggregate
across businesses is computed or stored.

### 8.5 Injection and SSRF

- Every imported string passes **`neutralizeWithSentinels`** at the **write choke point of each import
  writer** (the `MEM-PATTERN-SENTINEL-GUARDED` precedent, `memory-performance.ts:127`), not at the call site.
  A stored injection that reaches every future generation is HIGH.
- Post text enters prompts wrapped `[DATA]…[/DATA]`.
- **No URL in post text or media is ever fetched.** `lib/backfill/` does not import `lib/ai/website-fetcher.ts`
  and makes no `fetch` of its own.

### 8.6 What still needs counsel before this ships

1. The Evidence Pack entry and the processor posture for importing the customer's own account history.
2. **Founder personal accounts:** purpose limitation and possible Art. 9 special-category content in a
   person's two-year history. The lookback is 24 months (A-4), rows land as candidates, and nothing is used
   without human confirmation — counsel confirms that is sufficient.
3. **X Developer Agreement (A-5):** deletion-sync obligations, stored content used as AI context, and the paid
   tier's terms. Tracked as a `launch-checklist.md` item.
4. **The testimonial-permission confirmation copy (A-6)**, in all three locales.
5. LinkedIn: nothing new until `r_member_social` is pursued; the legal-entity gate (ADR 0028 A-8) is already
   named.

---

## 9. GDPR and tenancy (L-9)

### 9.1 New tables

**`social_backfill_runs`** — `id`, `business_id → businesses ON DELETE CASCADE`, `social_account_id →
social_accounts ON DELETE CASCADE`, `platform`, `status`, `partial`, `account_role ('brand'|'founder') NULL`,
`weighting`, `posts_fetched`, `posts_extracted`, `platform_posts_read`, `spend_cents`, `ceiling_cents`,
`passes_done`, `summary jsonb`, `staged_voice jsonb NULL`, `voice_status ('pending'|'applied'|'refused_cap'|
'failed'|'declined') NULL`, `voice_applied_to`, `voice_applied_at`, `error_code`, `created_at`, `updated_at`,
`started_at`, `completed_at`, `ratified_at`.
- Partial UNIQUE `(social_account_id) WHERE status <> 'discarded'` — at most one live run per account, and a
  `failed` run occupies the slot (it is resumed in place, §6.5). `BACKFILL_MAX_RUNS_PER_ACCOUNT = 3` in total
  (i.e. at most two discards), checked at enqueue.
- Partial claim index `(status, updated_at) WHERE status IN ('queued','fetching','extracting')`; indexes on
  both FKs.
- RLS: **SELECT** for members (`business_id = ANY (SELECT unnest(public.get_user_business_ids()))`) so the
  onboarding page can show progress; **no INSERT/UPDATE/DELETE policy for `authenticated`**. Writes are
  service-role.

**`social_backfill_posts`** — `id`, `business_id → businesses ON DELETE CASCADE`, `run_id →
social_backfill_runs ON DELETE CASCADE`, `social_account_id`, `platform_post_id`, `published_at`, `content`,
`url`, `format`, `metrics jsonb NULL`, `lift numeric NULL`, `extraction_status`, `claimed_at`, `created_at`.
- `UNIQUE (social_account_id, platform_post_id)`; claim index `(run_id, extraction_status, published_at)`.
- RLS enabled with **no policy for `authenticated` at all** (deny by default). Service-role only.

Every policy that exists uses the InitPlan-wrapped form. Neither table has an UPDATE policy, so the `USING` +
`WITH CHECK` rule has nothing to apply to.

### 9.2 ADR 0010 Amendment 2 §D2.5 rows (verbatim, added in the Builder's migration PR)

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| social_backfill_runs | yes (business_id + social_account_id) | CASCADE (both) | yes | none — cascade = erasure (holds `staged_voice`, which may include verbatim post excerpts, and account statistics; ADR 0025 §9.1) |
| social_backfill_posts | yes (business_id + run_id) | CASCADE (both) | yes | none — cascade = erasure (holds the customer's own imported post text, which may quote third parties; short-lived by design, ADR 0025 §8.3) |

### 9.3 Existing tables changed

- `brand_memory`, `evidence_memory`, `audience_memory`, `performance_memory`: `import_run_id`,
  `import_source_post_ids`, two CHECKs, the immutability trigger, and the run-scoped import UNIQUE indexes on
  performance, evidence and audience (§4.3, §6.4). Their existing §D2.5 rows are unchanged.
- `social_accounts`: `scopes_granted`, and the table-level UPDATE grant replaced by a column allowlist (§7.3).
  Existing row unchanged.
- `ai_budget_daily`: purpose CHECK looked up, dropped and re-created explicitly named, with `backfill_cents` (§6.3).

### 9.4 Import writers and the ratify RPC

- Import writers for evidence, audience and performance are `SECURITY DEFINER` RPCs granted to `service_role`
  only, **fixing `source = 'import'`, `status = 'candidate'`, `sensitivity = 'internal'` and — for evidence —
  `public_use_permission = false` in SQL** (the `upsert_distilled_performance_pattern` precedent). Their
  TypeScript wrappers live in `lib/db/memory-{evidence,audience,performance}.ts` and are called **only** from
  `lib/memory/` (`MEM-NO-DIRECT-TABLE-ACCESS`).
- **`ratify_backfill_run(p_user_id, p_run_id, p_accepted_ids, p_rejected_ids, p_account_role)`** — one plpgsql
  `SECURITY DEFINER` function, `service_role` only. **The acting user is an explicit parameter**, because under
  the service-role client `auth.uid()` is `NULL` — which is exactly why `user_can` returns `false` for a
  service caller (`20260702120200_user_can.sql:15-16`) and cannot be reused here. The Server Action obtains
  `p_user_id` from the **server-verified session** (`supabase.auth.getUser()` on the anon server client, never a
  form field), and the RPC checks it directly against `business_members` (`user_id = p_user_id`,
  `business_id` = the run's business, `status = 'active'`, and a role able to approve content — `approver` or
  `is_admin`), raising otherwise. `p_user_id` is trusted only because `EXECUTE` is granted to `service_role`
  alone; that grant is part of the constraint. In one transaction it flips accepted rows `candidate → active`
  and rejected rows `→ retired`, **filtering `source = 'import' AND import_run_id = p_run_id`** (without that
  filter it would activate stuck `summarize:` candidates, `summarize.ts:193-211`); records `account_role`,
  `ratified_at` and `voice_status = 'pending'` (when a voice is staged); and deletes the run's staging rows.
  **It does not touch `staged_voice`** — voice application is the separate, retryable step in §4.2.
  **Loser:** granting it to `authenticated` and relying on `auth.uid()` — it would let any member call it
  directly with arbitrary id arrays, and the id filtering would then be the only defence.
- **`apply_backfill_voice`** is a Server Action, not an RPC: it validates with Zod, re-uses the same membership
  check, calls the existing voice writers (`upsertBrandVoice` or the `create_voice_variation` path), and then
  performs the conditional run-row UPDATE in §4.2.

---

## 10. Onboarding UX contract (specified, not designed)

### 10.1 Where it sits

`step-1` (business) → `step-2` (website voice, unchanged) → `step-3` (connect; **clock starts; backfill
enqueued**) → **`step-4`** → campaigns. Step-4 today is the completion page: a heading and a form posting to
`completeOnboardingAction` (`step-4/page.tsx:15-31`). **It stays the completion page.** The "What we learned"
panel (§10.4) is **added above** the existing completion CTA; `completeOnboardingAction` and its behaviour are
unchanged, and it completes onboarding whether or not the run is ratified. When no served account was connected,
step-4 renders exactly as today plus the "not started" state line. Onboarding never blocks on the backfill: the
completion CTA on step-4 is always enabled. If the run is not ready when the founder leaves, a
dismissible dashboard banner links back to the review page until the run is ratified, discarded or expires.

### 10.2 States (every one is rendered and tested)

| State | Shown |
|---|---|
| not started (no served account connected) | why nothing is importing, and which platforms can |
| `queued` / `fetching` / `extracting` | progress with real counts (posts found, posts analysed), and "you can keep going" |
| `awaiting_ratification`, complete | the learned summary (§10.4) and the review controls |
| `awaiting_ratification`, `partial` | the same, with the real count and the reason it stopped |
| `failed` | the reason in plain language (reconnect needed / platform refused / timed out), and a retry when resumable |
| `unsupported` | **for LinkedIn, stated honestly** — "we can't read your LinkedIn history yet" — with nothing implying it is loading |
| nothing to learn (zero posts) | stated, not an empty list |
| `ratified` / `discarded` | a confirmation, and no further prompt |

### 10.3 Ratification — reusing the existing step (L-6)

- **Account role first.** For each run, the founder declares "this is my company" or "this is me" (L-11). This
  is required before voice can be applied.
- **Voice:** "Review voice" re-enters **`step-2` in backfill mode** (`?run=<id>`). The Server Component page
  loads the staged voice; the existing `VoiceEditor` (`Step2Form.tsx:150-157`) renders it pre-filled; saving
  calls `apply_backfill_voice` (§9.4), which applies it per §4.2. For a `founder` account the editor shows only
  the axes, with the one-line explanation from §4.2; for a `brand` account it shows the ≤ 3-example chooser.
  A refused or failed application shows its state and a retry; "Don't use this voice" sets `declined`. The website-inference path is unchanged when no `run`
  parameter is present. `hasInferredContent` / `inferred_from_url` are **not** reused as a ratification signal,
  because they cannot distinguish inferred from ratified voice.
- **Memory items:** on step-4, grouped by type, each with its backing-post count and an excerpt link;
  accept/reject per item, with "accept all" per group. Evidence items show permission as `off`; enabling
  permission is **not** offered in this session (the A-6 copy is counsel-gated).
- **Discard** is available in every non-terminal state.
- **Skipping onboarding ratifies nothing** (`skipOnboardingAction` bypasses step-2 today,
  `onboarding/actions.ts:12-14`); the run waits for the banner path or the TTL.

### 10.4 The "what we learned from your last N posts" information hierarchy

1. The headline: *N posts from <account>, <date range>*, and whether they were performance-weighted.
2. The voice summary (descriptor + the three strongest axes), with "Review voice".
3. What performed: up to three patterns, each rendered **with its observation count** ("based on 7 posts"),
   never as an instruction.
4. How you talk to your audience: up to five statements.
5. Proof you've published: the evidence count with excerpts, permission off.
6. Cadence and format mix (from `summary`) — context, not memory.

### 10.5 Implementation rules

Server Component pages with Client Component interaction; Zod on every new Server Action (run id, item-id
arrays bounded by the run's caps, the `account_role` enum); atomic state transitions; shadcn v4 / Base UI with
**no `asChild` on Button or DropdownMenu primitives** (`buttonVariants()` on `<Link>`); Tailwind only; every
string in en/pt/es simultaneously. The Builder runs `/impeccable` and `/taste-skill` against this contract.

---

## 11. Test plan and measurement (Q8)

### 11.1 Tier 1 — live Postgres (`supabase/__tests__/`, `db-tests.yml`)

RLS on both new tables (member SELECT on runs, cross-tenant denial, zero access to staging); cascade from
`businesses`; `purge_business` coverage; the provenance CHECKs, the immutability trigger and survival through
ratification; the ratify RPC's filter and atomicity; the claim RPC under concurrency; once-per-account; the
atomic spend reservation; the budget purpose CHECK; the import RPCs' fixed fields; per-post removal; and the
`social_accounts` column lock.

### 11.2 Tier 2 — vitest (`app-tests.yml`)

The contract suite over Mock, LinkedIn and Twitter with the flag-consistency assertion (**the seven-method
assertion at `provider-contract.test.ts:81-89` becomes eight, as authorised by A-2**); `SOCIAL-NO-READ-PATH`
(`no-read-path.test.ts:29-43`) **inverted** to assert that the read method exists inside `lib/social/`
implementations and is consumed only via the barrel; recorded-fixture tests for X (the request carries
`exclude=replies,retweets`, no `referenced_tweets` expansion, quotes dropped, identity check) and for LinkedIn
(not-served path only — **no coverage is claimed for the LinkedIn read body**); the orchestrator against every
§2.9 fixture; extractors, weighting, confidence and caps; the trial-cap exemption; UX states; i18n parity; and
the source scans.

### 11.3 Tier 3 — properties of absence (diff-verified, no runtime test by decision)

No new type carries a raw token; no migration touches the trial trigger, `trial_state` or
`find_trial_expiring_between`; no `relationship_memory` table; no change to `CustomerContext`'s shape or to
any generation prompt; no cross-business aggregate.

### 11.4 Tier E — the measurement this session is judged on (MEASURED, never COVERED)

1. **Memory rows at end of onboarding.** For X-connected test accounts: active imported rows per type after
   ratification, against today's baseline of zero brand/evidence/audience rows. Reported, not asserted.
2. **Corpus re-run with populated memory.** Re-run the Session 30 corpus with stub memory **built from a real
   backfill output** rather than hand-authored stubs, and compare against D9's 11/24.
   - **What D9 found:** recall 0/24 → 11/24 with populated hand-authored stubs; precision 11/11; $0.66.
   - **What D9 could not establish:** that *realistic* memory helps (its stubs were written to be relevant);
     that the effect survives a second run; or that the remaining 13/24 are memory-related at all.
   - **This protocol can establish only the first.** Backfill-built stubs that recover recall near 11/24
     support imported memory as useful triage context; stubs that do not say the hand-authored stubs
     overstated it. Neither result is a pass/fail gate on this session's code.
   - The run is out-of-band, its artefact is evidence, and **`corpus.v2.json` is not modified** (Session 30-D
     A-1's ban on ad hoc live runs as cassette sources).

### 11.5 SHARED-FUNCTION CALLERS the Builder must enumerate

| Function touched | Known callers | Obligation |
|---|---|---|
| `upsertBrandVoice` | `infer-brand-voice/actions.ts:36-46`, `step-2/actions.ts:30-36`, + the new ratify action | existing two unchanged; new caller tested |
| Runner trial classification (`runner.ts:33-60,95-99,281-287`) | every `runPrompt` caller | backfill ids exempt; existing ids' behaviour unchanged, tested |
| `updateSocialAccount` | Builder greps | per caller: which client, which columns |
| `TwitterProvider.refreshAccessToken` | `withFreshToken` call sites in the provider | writes `scopes_granted`; refresh tests extended |
| Callback route | onboarding and settings connect | enqueue tested on both entry paths |
| `deactivateSocialAccount` | disconnect route (`:80`) | run cancellation tested |
| `ai_budget_daily` purpose CHECK | triage and generation budget writers | existing purposes still accepted, Tier 1 |

---

## 12. Constraint table (the Reviewer's checklist)

**Rename, recorded:** the build guide's `BACKFILL-BEFORE-TRIAL-CLOCK` is encoded as
**`BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED`**, because L-7′ superseded L-7 and the original name asserts a
property the build guide's own §0 sign-off block found unimplementable.

| # | Constraint | Tier | Proof |
|---|---|---|---|
| 1 | `BACKFILL-READ-ON-ABSTRACTION` — `fetchRecentPosts` and its types exported via `lib/social/index.ts`; contract suite asserts eight methods; `SOCIAL-NO-READ-PATH` inverted | 2 | `provider-contract.test.ts`, `no-read-path.test.ts` |
| 2 | `BACKFILL-READ-FLAG-CONSISTENT` — flag false ⇒ `NOT_IMPLEMENTED` with zero fetch; flag true ⇒ never `NOT_IMPLEMENTED` | 2 | `provider-contract.test.ts` |
| 3 | `BACKFILL-PROVIDER-BOUNDED` — page size 5–100 refused with `RangeError` before I/O; content ≤ 3,000 chars | 2 | contract suite |
| 4 | `BACKFILL-CURSOR-ACCOUNT-BOUND` — a cross-account or foreign cursor ⇒ `cursor_invalid` | 2 | mock + X fixture tests |
| 5 | `BACKFILL-OWN-POSTS-ONLY` — replies, reposts and quotes never returned; the X request carries `exclude=replies,retweets` and no `referenced_tweets` expansion | 2 | X fixture test, mock `mixed-types` |
| 6 | `BACKFILL-IDENTITY-VERIFIED` — the first page verifies token identity = `platform_user_id`, fail closed | 2 | X fixture test |
| 7 | `BACKFILL-NO-COMMENT-READ` — no `fetchEngagement`, `liking_users`, `retweeted_by`, `liked_tweets` or comment endpoint referenced from `lib/backfill/` or the read path | 2 | source scan |
| 8 | `BACKFILL-PROVIDER-NEVER-SLEEPS` — 10s per-request timeout; `retryAfterSeconds` ≤ 900; no sleep or retry loop | 2 | fixture tests + scan |
| 9 | `BACKFILL-ERROR-DETAILS-CONTENT-FREE` — no content, cursor or token in `SocialProviderError.details` or the tick log | 2 | fixture tests |
| 10 | `BACKFILL-MOCK-FIXTURES-MEANINGFUL` — the deterministic seeded fixtures of §2.9; mock mode stays offline | 2 | `SOCIAL-MOCK-MODE-OFFLINE`, extended |
| 11 | `BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL` — the ESLint ban fires for a probe under `lib/backfill/` | 2 | `eslint-internals-ban.test.ts` |
| 12 | `BACKFILL-VAULT-PATH-REUSED` — reads use `withFreshToken`; no new `get_vault_secret` call site | 2 | scan + provider tests |
| 13 | `BACKFILL-NO-RAW-TOKEN` — no new type or row type carries a token (L-5 as reworded) | 3 | diff |
| 14 | `BACKFILL-SOCIAL-ACCOUNT-IDENTITY-LOCKED` — `authenticated` holds no table-level UPDATE on `social_accounts`; an UPDATE of `platform_user_id`, the vault ids, `is_active`, `token_expires_at`, `scopes_granted`, `business_id`, `platform` or `connected_at` as `authenticated` fails with a privilege error, while an allowlisted column still updates | 1 | `supabase/__tests__` (asserts the actual UPDATE is refused, not a `pg_policies`/grant read) |
| 15 | `BACKFILL-SCOPES-PERSISTED` — the callback and X refresh write `scopes_granted`; `[]`/NULL treated as unknown | 2 | callback + refresh tests |
| 16 | `BACKFILL-RUN-BOUNDED` — 200 posts, 24 months, 5 pages, dedupe on `platformPostId` | 2 | orchestrator tests |
| 17 | `BACKFILL-X-READ-BOUNDED` — `platform_posts_read` ≤ 500 per run | 2 | orchestrator tests |
| 18 | `BACKFILL-ONCE-PER-ACCOUNT` — partial UNIQUE `WHERE status <> 'discarded'` (a `failed` run blocks a second live run); ≤ 3 runs per account; resume is `failed → queued` on the same row | 1 | `supabase/__tests__` |
| 19 | `BACKFILL-CLAIM-ATOMIC` — concurrent claims never return the same staging row | 1 | `supabase/__tests__` |
| 20 | `BACKFILL-RESUMABLE-OR-DISCARDED` — failure on page N resumes from staging without duplicate memory; discard retires candidates and purges staging | 2 | orchestrator tests |
| 21 | `BACKFILL-NOTHING-ACTIVE-BEFORE-RATIFY` — import rows land `candidate`; no path writes `active` except the ratify RPC | 1 | `supabase/__tests__` |
| 22 | `BACKFILL-COST-CEILINGED` — the atomic per-run reservation refuses a call that would cross 50¢ | 1 | `supabase/__tests__` |
| 23 | `BACKFILL-BUDGET-PURPOSE` — the CHECK accepts `backfill_cents` and the existing purposes, and rejects unknown ones | 1 | `supabase/__tests__` |
| 24 | `BACKFILL-TRIAL-CAPS-UNTOUCHED` — backfill prompts are neither refused by nor increment trial counters | 2 | `runner.test.ts` |
| 25 | `BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED` — no migration touches the trial trigger, `trial_state` or `find_trial_expiring_between` | 3 | diff |
| 26 | `BACKFILL-LATENCY-BOUNDED` — enqueued on connect with a tick fired; 30-minute stall ⇒ `failed` | 2 | callback + sweep tests |
| 27 | `BACKFILL-DISCONNECT-CANCELS` — disconnect discards a non-terminal run and purges staging | 2 | disconnect tests |
| 28 | `BACKFILL-STAGING-PURGED` — staging is gone at ratify, discard, disconnect or the 30-day TTL | 2 | sweep + action tests |
| 29 | `BACKFILL-UNSUPPORTED-PLATFORM-HONEST` — a LinkedIn run ⇒ `unsupported` with zero reads | 2 | orchestrator tests |
| 30 | `BACKFILL-DETERMINISTIC-FIRST` — stats and `format` patterns computed without a model; exactly three model passes per run | 2 | orchestrator tests |
| 31 | `BACKFILL-PERFORMANCE-WEIGHTED` — voice and insight inputs are the top-lift subset; no-metrics runs marked `unweighted_no_metrics` | 2 | extractor tests |
| 32 | `BACKFILL-CONFIDENCE-CAPPED` — imports ≤ 0.6 by formula; performance n ≥ 5 and lift ≥ 1.25 recomputed, never model-supplied | 2 | extractor tests |
| 33 | `BACKFILL-EVIDENCE-VERBATIM` — evidence content is a verified substring ≤ 500 chars | 2 | extractor tests |
| 34 | `BACKFILL-EVIDENCE-NOT-PUBLIC` — the import RPC fixes `public_use_permission = false` | 1 | `supabase/__tests__` |
| 35 | `BACKFILL-SENTINEL-GUARDED` — every import writer neutralises at its choke point | 2 | `lib/db/memory-*.test.ts` |
| 36 | `BACKFILL-WRITE-CAPS` — evidence ≤ 40, audience ≤ 25, performance ≤ 15, voice examples ≤ 3 per account (never concatenated past `brand_voices`' cardinality CHECK); a founder voice is written as axes only; imported performance rows carry `expires_at` = newest backing post + 12 months | 2 | extractor + action tests |
| 37 | `BACKFILL-NO-URL-FETCH` — `lib/backfill/` imports no fetcher and calls no `fetch` | 2 | source scan |
| 38 | `BACKFILL-PROVENANCE-MARKED` — `source='import'` ⇔ `import_run_id` and `import_source_post_ids` non-null, on all four tables | 1 | `supabase/__tests__` |
| 39 | `BACKFILL-PROVENANCE-IMMUTABLE` — the trigger rejects changing `source`, `import_run_id` or `import_source_post_ids` | 1 | `supabase/__tests__` |
| 40 | `BACKFILL-PROVENANCE-SURVIVES-PROMOTION` — the marker is unchanged through ratify, retire, and a colliding distilled upsert | 1 | `supabase/__tests__` |
| 41 | `BACKFILL-SOURCE-DATED` — `last_confirmed_at` = source date; non-finite dates rejected before write; ratify does not touch it | 2 | writer tests |
| 42 | `BACKFILL-ACCOUNTS-SEPARATE` — extraction, voice synthesis and ratification never mix runs; founder voice → variation, brand voice → `brand_voices` | 2 | `two-accounts` fixture |
| 43 | `BACKFILL-PER-POST-REMOVABLE` — removing a platform post id deletes/retires exactly the rows backed by it | 1 | `supabase/__tests__` |
| 44 | `BACKFILL-VOICE-RATIFIED` — staged voice never reaches `brand_voices`/variations without the ratify action; skipping ratifies nothing | 2 | action tests |
| 45 | `BACKFILL-RATIFY-ATOMIC` — one transaction; filters `source='import' AND import_run_id`; `p_user_id` checked against `business_members` (a non-member and a `viewer` are refused); `EXECUTE` granted to `service_role` only; `staged_voice` untouched | 1 | `supabase/__tests__` |
| 46 | `BACKFILL-VOICE-RETRYABLE` — at 5 variations (or any apply failure) the voice part is refused with its `voice_status`, `staged_voice` survives, and a retry after deleting a variation succeeds; other items still ratify | 2 | action tests |
| 47 | `BACKFILL-RLS-ISOLATED` — member SELECT on runs only; no authenticated access to staging; cross-tenant access denied | 1 | `supabase/__tests__` |
| 48 | `BACKFILL-CASCADE-COMPLETE` — both tables cascade from `businesses`; the §D2.5 rows are present | 1 | `supabase/__tests__` |
| 49 | `BACKFILL-PURGE-COVERED` — `purge_business` leaves no run, staging or import memory row | 1 | `supabase/__tests__` |
| 50 | `BACKFILL-NO-RELATIONSHIP-MEMORY` — no such table or writer | 3 | diff |
| 51 | `BACKFILL-NO-GENERATION-CHANGE` — `CustomerContext` shape and generation prompts unchanged | 3 | diff |
| 52 | `BACKFILL-NO-CROSS-CUSTOMER-LEARNING` — no cross-business aggregate of imported content | 3 | diff |
| 53 | `BACKFILL-UX-STATES` — every §10.2 state renders | 2 | component tests |
| 54 | `BACKFILL-I18N-PARITY` — every new key exists in en/pt/es | 2 | i18n parity test |
| 55 | `BACKFILL-POPULATED-MEMORY-EVAL` — §11.4, **MEASURED, never COVERED** | E | out-of-band run artefact |
| 56 | `BACKFILL-IMPORT-IDEMPOTENT` — re-running a pass for the same run inserts no duplicate evidence, audience or performance row (run-scoped partial UNIQUE indexes + `ON CONFLICT DO NOTHING`) | 1 | `supabase/__tests__` |

**Total: 56 constraints — Tier 1: 16 · Tier 2: 34 · Tier 3: 5 · Tier E: 1.**

---

## 13. Deferred

| Item | Owner | Condition |
|---|---|---|
| Comment and reply mining | unassigned | **counsel ruling** on third-party personal data (L-2, D-3) |
| Outbound activity (own comments, reactions) | unassigned | the §2.8 split is binding; re-verify every row |
| `relationship_memory` | engagement inbox (T1-A) | ADR 0016's park lifted |
| LinkedIn member read served | when `r_member_social` is approved | re-verify the implementation; flip the flag; reconnect flow via `scopes_granted` |
| LinkedIn `fetchPostMetrics` | Session 33 or the LinkedIn gate, whichever comes first | changes the metrics worker's behaviour, so not here (Amendment B §B.5) |
| LinkedIn organisation read | ADR 0028 A-8 gate | Community Management API |
| LinkedIn data-export upload | unscoped | named future option (A-1) |
| Meta family read | no provider | a provider exists |
| Deletion-sync wiring | launch checklist | counsel (A-5) |
| Evidence permission-enablement UI | follow-on | counsel-approved copy (A-6) |
| Embeddings | ADR 0016 §5.3 trigger | 200 active evidence + audience rows; the import caps keep a single account below it (the drift at `docs/backlog.md:59` is corrected at close-out) |
| Exemplar **selection** from the voice corpus | later session | the corpus is supplied here |
| Richer founder voice (`tone`, `keywords`, `avoid_words`, examples on `brand_voice_variations`) | T1-E founder-profile work | an ADR 0011 amendment; until then a founder voice is axes only (§4.2) |
| More than 3 writing examples | unassigned | a deliberate change to `brand_voices`' cardinality CHECK |
| Outcome loop; imported/distilled duplicate slots | **Session 33** | §5.4 |
| Memory write expansion; cross-type retrieval; retrieval-time account scoping | **Session 34** | §5.2 |
| Memory-driven opportunity cards | later | — |
| X refresh-rotation race | `30.5-X-REFRESH-ROTATION` | unchanged |

_End ADR 0025._

---

## 14. Builder verification (I2.15)

**Scope reviewed:** `4f3e7129..9359a708` (BASE = the commit immediately before I2.1; HEAD = I2.14). All
commands below were run against this exact range. Sections 0-13 above are unedited (this section is
purely additive, per this step's own instruction).

### 14.1 Tier 3 — diff-verified, no runtime test by decision

For each, the exact command, its output at HEAD, and a demonstration that it catches a planted violation
(planted on the working tree against BASE, shown, then reverted — never committed).

**BACKFILL-NO-RAW-TOKEN (13).**
```
git diff 4f3e7129..HEAD -- lib/ | grep -inE '^\+.*(token|secret|refresh|access_?token)'
```
Every hit at HEAD is inside a test file, a mock, an error-code string (`TOKEN_EXPIRED`/`TOKEN_REVOKED`),
or a pre-existing column (`token_expires_at`, already in `SocialAccountRow` before this session) — no
new `type`/`interface`/row type carries a raw token field, and no new producer or consumer of `TokenSet`
was added. One local parameter, `fetchTimelinePage(token: string, …)`, holds an already-decrypted token
transiently in memory for a single request — the same shape the pre-existing `withFreshToken` pattern
already uses elsewhere in this provider, not a new storage or transport path.
Violation demonstration: appended `export interface TestViolation { access_token: string }` to
`lib/db/backfill-runs.ts`, then ran `git diff 4f3e7129 -- lib/db/backfill-runs.ts | grep -inE
'^\+.*(access_?token|refresh_?token|secret)\s*:'` — hit confirmed (`+export interface TestViolation {
access_token: string }`). Reverted (file diff-clean afterward).

**BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED (25).**
```
git diff 4f3e7129..HEAD -- supabase/migrations/ | grep -inE 'trial_state|find_trial_expiring_between|trigger.*trial'
```
One hit, a *comment* in `20260913120000_social_accounts_identity_lock.sql`: *"The trial trigger
(20260430120008_social_accounts_trial_trigger.sql) is untouched."* — prose stating non-interference, not
a reference that touches the trigger, the function, `trial_state`, or `find_trial_expiring_between`.
Violation demonstration: appended `-- UPDATE trial_state SET x = 1;` to a migration file in this range,
re-ran the grep, confirmed the hit, reverted.

**BACKFILL-NO-RELATIONSHIP-MEMORY (50).**
```
git diff 4f3e7129..HEAD | grep -inE 'relationship_memory'
```
Zero hits. Violation demonstration: appended `-- relationship_memory placeholder` to a migration file in
this range, re-ran the grep, confirmed the hit, reverted.

**BACKFILL-NO-GENERATION-CHANGE (51).**
```
git diff 4f3e7129..HEAD --stat -- lib/ai/
```
`lib/ai/context.ts` and `lib/ai/wrap-evidence.ts` do not appear in the stat at all (zero lines changed —
`CustomerContext`'s shape and its builder are untouched). The files that DO appear are: three new prompt
files (`backfill-evidence.ts`, `backfill-insights.ts`, `backfill-voice-synthesis.ts` — new files, not
edits to an existing prompt), `frozen-table.ts` (+29, the three new backfill prompt-id rows), `runner.ts`
(+25/-4, classification only), and test files for all of the above. No existing prompt file other than
the frozen table and runner classification changed.
Violation demonstration: appended `// planted change` to `lib/ai/context.ts`, re-ran the stat command,
confirmed `lib/ai/context.ts | 1 +` appeared, reverted.

**BACKFILL-NO-CROSS-CUSTOMER-LEARNING (52).**
```
git diff 4f3e7129..HEAD -- supabase/migrations/ | grep -inE 'CREATE (OR REPLACE )?(VIEW|FUNCTION)' | grep -viE 'business_id|p_business_id'
```
Zero hits — every new function in the range takes `p_business_id`, `p_run_id` (itself business-owned,
with the I2.6 review-fixes migration's explicit `p_business_id` vs. the run's own `business_id`
consistency guard on every import RPC), or no business-scoped argument at all because it operates on a
single named row (`p_run_id uuid` alone, e.g. `resume_backfill_run`). No new VIEW was added in this
range at all. No aggregate across businesses is computed or stored anywhere in `lib/backfill/` or the new
migrations (manually verified against every RPC body in the I2.5/I2.6/I2.13 migrations, not just the
grep signature check).
Violation demonstration: appended `CREATE VIEW public.test_cross_business_view AS SELECT pattern FROM
public.performance_memory;` to a migration file in this range, re-ran the grep, confirmed the hit (the
new view's signature has no `business_id`/`p_business_id` token), reverted.

### 14.2 The constraint → CI map

All 56 rows. The tier/proof columns are transcribed from §12's table (unedited). **The "executed green
in CI at `<sha>`" column is left EMPTY** — per this step's own instruction, it may only be filled in
after the pushed HEAD's CI runs have been opened and read, which has not happened yet (see §14.4).

| # | Constraint | Tier | Test file / diff command / protocol | Step | Commit | CI job | Executed green in CI at `<sha>` |
|---|---|---|---|---|---|---|---|
| 1 | BACKFILL-READ-ON-ABSTRACTION | 2 | `provider-contract.test.ts`, `no-read-path.test.ts` | I2.2 | `f39f3394` | app-tests | — |
| 2 | BACKFILL-READ-FLAG-CONSISTENT | 2 | `provider-contract.test.ts` | I2.2 | `f39f3394` | app-tests | — |
| 3 | BACKFILL-PROVIDER-BOUNDED | 2 | contract suite | I2.2 | `f39f3394` | app-tests | — |
| 4 | BACKFILL-CURSOR-ACCOUNT-BOUND | 2 | mock + X fixture tests | I2.3 | `0b92f079` | app-tests | — |
| 5 | BACKFILL-OWN-POSTS-ONLY | 2 | X fixture test, mock `mixed-types` | I2.3 | `0b92f079` | app-tests | — |
| 6 | BACKFILL-IDENTITY-VERIFIED | 2 | X fixture test | I2.3 | `0b92f079` | app-tests | — |
| 7 | BACKFILL-NO-COMMENT-READ | 2 | source scan | I2.1 | `fd2d59ea` | app-tests | — |
| 8 | BACKFILL-PROVIDER-NEVER-SLEEPS | 2 | fixture tests + scan | I2.3 | `0b92f079` | app-tests | — |
| 9 | BACKFILL-ERROR-DETAILS-CONTENT-FREE | 2 | fixture tests | I2.9 | `8e5b0177` | app-tests | — |
| 10 | BACKFILL-MOCK-FIXTURES-MEANINGFUL | 2 | `SOCIAL-MOCK-MODE-OFFLINE`, extended | I2.2 | `f39f3394` | app-tests | — |
| 11 | BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL | 2 | `eslint-internals-ban.test.ts` | I2.1 | `fd2d59ea` | app-tests | — |
| 12 | BACKFILL-VAULT-PATH-REUSED | 2 | scan + provider tests | I2.3 | `0b92f079` | app-tests | — |
| 13 | BACKFILL-NO-RAW-TOKEN | 3 | diff (§14.1) | I2.15 | `70773e87` | none-by-decision | — |
| 14 | BACKFILL-SOCIAL-ACCOUNT-IDENTITY-LOCKED | 1 | `supabase/__tests__` | I2.4 | `828e5c53` | db-tests | — |
| 15 | BACKFILL-SCOPES-PERSISTED | 2 | callback + refresh tests | I2.4 | `828e5c53` | app-tests | — |
| 16 | BACKFILL-RUN-BOUNDED | 2 | orchestrator tests | I2.8 | `5fd62d85` | app-tests | — |
| 17 | BACKFILL-X-READ-BOUNDED | 2 | orchestrator tests | I2.8 | `5fd62d85` | app-tests | — |
| 18 | BACKFILL-ONCE-PER-ACCOUNT | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 19 | BACKFILL-CLAIM-ATOMIC | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 20 | BACKFILL-RESUMABLE-OR-DISCARDED | 2 | orchestrator tests | I2.13 | `f6539e19` | app-tests | — |
| 21 | BACKFILL-NOTHING-ACTIVE-BEFORE-RATIFY | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 22 | BACKFILL-COST-CEILINGED | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 23 | BACKFILL-BUDGET-PURPOSE | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 24 | BACKFILL-TRIAL-CAPS-UNTOUCHED | 2 | `runner.test.ts` | I2.11 | `bbd7b0a9` | app-tests | — |
| 25 | BACKFILL-AFTER-CONNECT-CLOCK-UNTOUCHED | 3 | diff (§14.1) | I2.15 | `70773e87` | none-by-decision | — |
| 26 | BACKFILL-LATENCY-BOUNDED | 2 | callback + sweep tests | I2.9 | `8e5b0177` | app-tests | — |
| 27 | BACKFILL-DISCONNECT-CANCELS | 2 | disconnect tests | I2.9 | `8e5b0177` | app-tests | — |
| 28 | BACKFILL-STAGING-PURGED | 2 | sweep + action tests | I2.13 | `f6539e19` | app-tests | — |
| 29 | BACKFILL-UNSUPPORTED-PLATFORM-HONEST | 2 | orchestrator tests | I2.8 | `5fd62d85` | app-tests | — |
| 30 | BACKFILL-DETERMINISTIC-FIRST | 2 | orchestrator tests | I2.11 | `bbd7b0a9` | app-tests | — |
| 31 | BACKFILL-PERFORMANCE-WEIGHTED | 2 | extractor tests | I2.10 | `84574b13` | app-tests | — |
| 32 | BACKFILL-CONFIDENCE-CAPPED | 2 | extractor tests | I2.10 | `84574b13` | app-tests | — |
| 33 | BACKFILL-EVIDENCE-VERBATIM | 2 | extractor tests | I2.12 | `6e9eb91f` | app-tests | — |
| 34 | BACKFILL-EVIDENCE-NOT-PUBLIC | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 35 | BACKFILL-SENTINEL-GUARDED | 2 | `lib/db/memory-*.test.ts` | I2.7 | `b1a45f54` | app-tests | — |
| 36 | BACKFILL-WRITE-CAPS | 2 | extractor + action tests | I2.13 | `f6539e19` | app-tests | — |
| 37 | BACKFILL-NO-URL-FETCH | 2 | source scan | I2.1 | `fd2d59ea` | app-tests | — |
| 38 | BACKFILL-PROVENANCE-MARKED | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 39 | BACKFILL-PROVENANCE-IMMUTABLE | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 40 | BACKFILL-PROVENANCE-SURVIVES-PROMOTION | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 41 | BACKFILL-SOURCE-DATED | 2 | writer tests | I2.7 | `b1a45f54` | app-tests | — |
| 42 | BACKFILL-ACCOUNTS-SEPARATE | 2 | `two-accounts` fixture | I2.13 | `f6539e19` | app-tests | — |
| 43 | BACKFILL-PER-POST-REMOVABLE | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 44 | BACKFILL-VOICE-RATIFIED | 2 | action tests | I2.13 | `f6539e19` | app-tests | — |
| 45 | BACKFILL-RATIFY-ATOMIC | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 46 | BACKFILL-VOICE-RETRYABLE | 2 | action tests | I2.13 | `f6539e19` | app-tests | — |
| 47 | BACKFILL-RLS-ISOLATED | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 48 | BACKFILL-CASCADE-COMPLETE | 1 | `supabase/__tests__` | I2.5 | `9db35d8e` | db-tests | — |
| 49 | BACKFILL-PURGE-COVERED | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |
| 50 | BACKFILL-NO-RELATIONSHIP-MEMORY | 3 | diff (§14.1) | I2.15 | `70773e87` | none-by-decision | — |
| 51 | BACKFILL-NO-GENERATION-CHANGE | 3 | diff (§14.1) | I2.15 | `70773e87` | none-by-decision | — |
| 52 | BACKFILL-NO-CROSS-CUSTOMER-LEARNING | 3 | diff (§14.1) | I2.15 | `70773e87` | none-by-decision | — |
| 53 | BACKFILL-UX-STATES | 2 | `BackfillPanel.test.tsx` | I2.14 | `9359a708` | app-tests | — |
| 54 | BACKFILL-I18N-PARITY | 2 | `lib/i18n/backfill-parity.test.ts` | I2.14 | `9359a708` | app-tests | — |
| 55 | BACKFILL-POPULATED-MEMORY-EVAL | E | out-of-band run artefact (§14.3) | I2.15 | `70773e87` | out-of-band | MEASURED — NOT YET RUN |
| 56 | BACKFILL-IMPORT-IDEMPOTENT | 1 | `supabase/__tests__` | I2.6 | `893e8b67` | db-tests | — |

**Total: 56 constraints — Tier 1: 16 · Tier 2: 34 · Tier 3: 5 · Tier E: 1.** No total is claimed as
"executed green in CI" — every cell in that column is empty pending §14.4.

**db-tests skip-guard.** Not yet read — requires the same opened CI run as §14.4. Recorded here as an
explicit gap, not silently skipped: whoever opens the db-tests run must record the skip-guard's file and
test counts in this cell before the Tier-1 row above can be marked green.

### 14.3 Tier E — BACKFILL-POPULATED-MEMORY-EVAL (55)

Recorded as a runnable, founder-triggered protocol. **Not run. Do not run without the founder's explicit
go-ahead** (real spend, a real X account).

1. Connect a real X account the founder owns (a test/founder-personal account, not a customer's).
2. Let the backfill run to `awaiting_ratification`; ratify some non-trivial subset of what it finds (the
   founder's own judgment call — this protocol does not prescribe accept/reject choices).
3. Build stub memory for the Session 30 eval corpus **from that real, ratified output** — not
   hand-authored stubs, the difference D9 could not establish (§11.4).
4. Re-run the Session 30 corpus (`corpus.v2.json`, **unmodified** — this protocol does not touch it) with
   the real-backfill-built stub memory in place.
5. Compare recall/precision against D9's baseline: **recall 0/24 → 11/24 with hand-authored stubs;
   precision 11/11; $0.66.**
6. **Neither outcome is a pass/fail gate on this session's code.** This session's constraints (1-54, 56)
   are proven independently by their own tests; this protocol measures something ADR §11.4 explicitly
   says D9 could not establish (that *realistic*, not hand-written-to-be-relevant, memory helps) — a
   product/quality question, not a correctness one.

**Expected cost:** one backfill run (≤ 50¢ per the run's own `ceiling_cents`) plus one corpus re-run at
Haiku/Sonnet triage rates — the same order of magnitude as D9's $0.66, not materially more.

### 14.4 What remains before this appendix is complete

The following require pushing this branch and reading the resulting CI runs — **not done as part of this
Builder session**, flagged here rather than fabricated:

- Every `<sha>` in the "Commit" column of §14.2 is a real, already-made commit on this branch; the
  **"executed green in CI at `<sha>`"** column requires opening the app-tests (and, once promoted,
  db-tests) run for the pushed HEAD and reading its result — not inferring it from a local `vitest run`.
- The db-tests skip-guard line (file + test counts) must be read from that same opened run's log.
- §14.2's `I2.15` rows now carry their real commit SHA, `70773e87` — filled in as a small follow-up
  commit once it existed, never by amending the I2.15 commit itself.

Once the CI runs exist and are read, this section (§14.4) is superseded by filling in §14.2's still-empty
"executed green in CI" column — never by editing this prose in place (this file's own §14 is
additive-only by the same convention as `docs/evidence/0010-legal-evidence.md`'s amendments).

**Session 32 Builder complete — range `4f3e7129..9359a708`, 15 steps (I2.1-I2.15), 51/55 non-E
constraints closed by a passing test or a diff-verified check that has been run locally and shown to
catch a planted violation (Tier 1 16/16, Tier 2 34/34, Tier 3 5/5 diff-verified locally) — 0/55 yet
confirmed "executed green in CI" because no run has been opened and read (§14.4), Tier E recorded not
run, LinkedIn read built not served.**
