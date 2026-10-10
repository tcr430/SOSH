# ADR 0032 — Founder and personal profiles: the founder identity made first-class

- **Status:** Accepted (2026-10-10). The six adjudications this ADR raised (A-4…A-9, §0.2) were ruled the same day by
  the founder's instruction *"write the adr following recommendations"*: **every recommendation below was taken as
  written**. They are recorded as recommendations adopted on that instruction, not as six independent sign-offs (the
  Session 35-D D4 precedent, cerebrum 2026-09-28).
- **Date:** 2026-10-10
- **Track:** P (Session 38). Architect P1. **Design only: no `.ts`, `.sql`, `.tsx`, email template or prompt template was
  produced by this session.** Every shape below is a contract for the Builder (P2), stated in prose.
- **Binding input:** `docs/build-guide/session-38.md`. That means:
  - the Reality block (13 items);
  - §0 (Locked L-1…L-10, the D-1…D-8 ledger);
  - §0.1 (Q1…Q8);
  - §0.2: founder rulings **A-1** (L-5/D-4), **A-2** (L-6/D-5) and **A-3** (L-8/D-6), all **Approved** before P1 ran, and
    **A-4…A-9** (raised here, ruled per recommendation).
- **Amends:**
  - ADR 0011 §3.2, §3.4, §8.2 and L-10 (§4 below);
  - ADR 0025 §4.2, §5.2, §10.3 and §13 (§4, §7);
  - ADR 0028 §5.3, §9.4, §14 and §16 items 9 and 11 (§2, §8, §12);
  - ADR 0013 §5.1 (the posts transition trigger) and §5.4 (§6);
  - ADR 0031 §14 (the LinkedIn-metrics row);
  - ADR 0010 Amendment 2 §D2.5 (one new row).
- **Supersedes nothing.**
- **Amended** the same day by **Amendment R (§18)**, the P1 review. It revises A-8 to A-8′, raises A-10 (pending a
  ruling, and gating Migration A), and brings the constraint total to 54. Where §18 and an earlier section disagree,
  §18 wins.
- **Amended** again the same day by **Amendment A-10 (§19)**: A-10 was approved as (b) + (c), adding the founder
  delegation toggle and the "Personal" label. The constraint total becomes 56.

**Prerequisites, verified before any other work:**

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| 1 | Session 37 / ADR 0031 CLOSED and MERGED | ✅ | `git log origin/master`: `841b3b082 Merge pull request #20` on top of `ae481d295` (the 37-D close) |
| 2 | A-1, A-2, A-3 ruled in §0.2 | ✅ | `session-38.md` §0.2: all three **Approved** |
| 3 | *(soft)* No production OAuth app registered with LinkedIn or X, so **no real founder has connected anything** | ⚠ **open** | `docs/current-phase.md`; `launch-checklist.md` §16a; §1.4 below |
| 4 | *(soft)* `S34-E2E-UNVERIFIED` / `S36-UX-UNVERIFIED-IN-BROWSER` | ⚠ **open** | `docs/backlog.md`; §1.4 below |

**Grounding.** One `ecc:code-explorer` sweep ran over the §1a closed file list. It is cited as `file:line` throughout.
Then **exactly three** advisory reviewers ran, dispatched once in a single parallel batch, all read-only, none
re-consulted:

| Agent | Scope | Cited as |
|---|---|---|
| `ecc:security-reviewer` | Q1(c), Q3, Q4 | `[sec-N]` |
| `ecc:database-reviewer` | Q1(a)–(c), Q2(a)/(c)/(d), Q3(a)/(c)/(e)/(f) | `[db-N]` |
| `ecc:type-design-analyzer` | Q1(b)–(d), Q2(b)–(c) | `[type-N]` |

Their dispositions are in §15.

**Vendor verification.** Q6 was verified directly against LinkedIn (Microsoft Learn) and X documentation on 2026-10-10
(§9). **Skills and audits not used:** the optional `impeccable` audit, `mem-search`, `supabase-postgres-best-practices`
and `cost-aware-llm-pipeline`. The sweep plus `[db-*]` covered the Postgres questions, and the widened voice does not
grow the prompt (§4.7). `taste-skill`, `ui-ux-pro-max` and `emil-design-eng` were not invoked, by rule.

---

## 0. The eight resolved questions (on the record)

| Q | Decision | Loser | Tier | § |
|---|---|---|---|---|
| Q1(a) | Role on **`social_accounts.account_role`** (`brand` \| `founder`, NOT NULL, no default), declared at connect | the role on the backfill run only; a role derived from the URN | 1 + 2 | 3.1 |
| Q1(b) | Targeting on **both**: `campaign_targets` (one identity per platform per campaign) is the default; `posts.social_account_id` is the authority | several identities per platform in one campaign; targeting on posts only; `uuid[]` on campaigns | 1 + 2 | 3.2 |
| Q1(c) | A **composite FK** on `posts` (the DB boundary on every path); pins at creation (service-role); **one** update setter, the DEFINER RPC `pin_post_account`; the connect sweep inside the connect RPC | relying on `PostUpdate`'s TS exclusion; a resolver fallback | 1 + 2 | 3.3 |
| Q1(d) | Single-account business is **auto-pinned at creation** | NULL plus the resolver's single-row branch | 1 + 2 | 3.4 |
| Q1(e) | Existing unpinned posts **frozen in the connect transaction**; founder-identity attaches only to drafts | publish-time pinning (D-2) | 1 | 3.5 |
| Q2 | `social_accounts.voice_variation_id` binding; founder voice **wins** over the campaign variation; variation gains `keywords`/`avoid_words`/`writing_examples` (no `tone`); per-field merge **inside `retrieveVoice`** | a founder voice table; campaign-wins; "add everything" | 1 + 2 + 3 | 4 |
| Q3 | `connected_by` from the **verified session**, bound to the signed state plus a cookie nonce; atomic connect RPC refuses takeover; DB backstop on member removal; ordered erasure | an admin connecting on the founder's behalf; app-only departure handling | 1 + 2 | 5 |
| Q4 | **Founder-only approval (A-4)**, enforced in the posts trigger on every entry into `approved`/`scheduled`; the pre-existing approval-gate hole **closed (A-6)** | any approver (today); delegation | 1 + 2 | 6 |
| Q5 | **No account dimension in memory**; the leak is stated and accepted (A-9) | an `account` `MemoryScope` now | 3 | 7 |
| Q6 | **No scope change.** Founder metrics share the A-8 legal-entity gate | requesting any new scope | 3 | 9 |
| Q7 | Plus = brand **and** founder on LinkedIn and X (**A-5**); one brand and one founder per platform, universal (**A-7**) | two identities; per-plan account caps | 1 | 10 |
| Q8 | UX contract (§11); tests across three tiers; no Tier E | — | — | 11, 12 |

---

## 1. Context and decision summary

### 1.1 The structural facts

1. **The dual-identity model shipped in ADR 0028 (A-6), and this ADR reuses it rather than rebuilding it.**
   - `UNIQUE (business_id, platform, platform_user_id)` (`20260430120006_social_accounts.sql:26`) admits two rows per
     platform.
   - `posts.social_account_id` is a nullable FK with `ON DELETE SET NULL` (`20260904100000_posts_social_account_id.sql:21-23`).
   - `resolvePublishAccount` (`lib/db/social-accounts.ts:203-220`) takes the pinned account, else the single active row,
     and otherwise fails. Its callers are `lib/publishing/orchestrator.ts:107` and `lib/metrics/orchestrator.ts:67`, both
     service-role.
   - The accounts surface already lists two identities per platform (`AccountsClient.tsx:105-118`).
2. **Nothing writes `posts.social_account_id`.**
   - The generation insert row (`lib/campaigns/generate.ts:637-647`) omits it.
   - `PostUpdate` excludes it (`lib/db/types.ts:384`).
   - A whole-repo grep finds only readers.
   - So **a second account on a platform fails every unpinned post as `account_ambiguous`**
     (`lib/publishing/orchestrator.ts:109-116`), behind copy that points to a picker that does not exist
     (`components/posts/PostCard.tsx:205-208`, `i18n/en/posts.json:67`).
3. **Campaigns are platform-shaped.** `CampaignRow.platforms: Platform[]` (`types.ts:265-284`) has no account reference.
   Generation loops platforms × role-sequence entries (`generate.ts:278-282`) into one batch insert (`:651`).
4. **Every LinkedIn connection is already a person.**
   - The scopes are `openid profile email w_member_social` (`lib/social/platforms/config.ts:26`), and the identity is
     `urn:li:person:{sub}` (`linkedin-provider.ts:183`).
   - The Company Page stays `coming_soon` behind ADR 0028 A-8 / A-9′.
   - **So at launch the founder identity is the only LinkedIn identity that works.**
   - A person URN does not prove *founder*.
5. **The brand/founder role exists only on `social_backfill_runs.account_role`** (`20260913130000:24`). It is set at
   ratification (`20260915120000_backfill_correction_pass.sql:86`) and never on the connection.
6. **The founder voice is axes only, and it is bound to campaigns.**
   - `brand_voice_variations` holds `name` and `voice_axes` (`20260623210000:47-78`).
   - `retrieveVoice` replaces only the axes (`lib/memory/voice.ts:22-37`).
   - The backfill founder branch writes axes only (`backfill-actions.ts:205-213`).
7. **No connecting member is recorded.**
   - `social_accounts` has no user column.
   - The OAuth state carries `{businessId, platform, nonce, locale}` (`lib/social/oauth/state.ts:7-12`), and the nonce is
     **never stored or compared**.
   - The callback re-checks neither the session user nor `user_can` (`callback/route.ts:67-73`).
   - Its service-role upsert (`:137-163`) overwrites tokens on conflict, and its payload carries `id: placeholderId`.
8. **No production OAuth app exists.** No real founder has connected anything (§1.4).

### 1.2 What ships

- A persisted, closed brand/founder role on the connection.
- Campaign-level identity targeting.
- A DB-enforced pin on every new post.
- One dedicated re-pin path.
- The connecting member recorded unforgeably.
- Founder-only approval, and the pre-existing approval-gate hole closed with it.
- The founder voice widened through the existing variation table and resolved by `retrieveVoice` alone.
- The departing-founder path, enforced in the database.
- A verified, dated scope table.
- The accounts, campaign, post and voice UI in en/pt/es.

### 1.3 Losers, per the §0 ledger

| # | Chosen | Loser |
|---|---|---|
| D-1 | reuse ADR 0028's dual identity | a `founder_profiles` table; a personal workspace per founder |
| D-2 | remove the cause (unpinned posts); resolver unchanged | a resolver fallback; publish-time auto-pinning |
| D-3 | widened `brand_voice_variations` | a founder voice table; axes only |
| D-4 | the person connects, bound to their session | an admin on their behalf; no record |
| D-5 | at most one founder per platform | unlimited |
| D-6 | no review-gated scope | requesting `r_member_social` / `r_member_postAnalytics` now |
| D-7 | approval unchanged or tighter (tighter: A-4) | auto-approval |
| D-8 | Company Page stays `coming_soon` | org posting here |

### 1.4 Designed and tested without a real platform

No production OAuth app is registered with LinkedIn or X (`launch-checklist.md` §16a), so every behaviour below is
designed against mocks (`SOCIAL_PROVIDER_MODE=mock`) and seeded data. `S34-E2E-UNVERIFIED` and
`S36-UX-UNVERIFIED-IN-BROWSER` remain open. §12.4 names what only a real credential can prove and the ADR 0028 §14
Stage-1 row this session adds. §9's scope table is an **input** to production app registration.

### 1.5 A pre-existing defect this ADR closes (A-6)

The security and database reviewers independently found that **the approval gate can be bypassed today** (`[sec-1]`,
`[db-3]`). The Architect confirmed it against the migrations, and it is logged as bug-1948.

- **By INSERT:** `posts_insert_own` checks only `author` (`20260702120300:11-16`), and `posts` has no INSERT trigger. An
  editor with a session can therefore INSERT a post that is already `approved`.
- **By UPDATE:** the transition trigger gates only `NEW.status = 'approved'` (`:53-56`). An editor can UPDATE
  `draft → scheduled`. `reap_stuck_scheduled_posts` then moves `scheduled → approved`
  (`20260525100000_publishing_worker_helpers.sql:30-33`), and `claim_posts_for_publishing` publishes `approved` rows
  (`20260524230000_publishing_worker.sql:27-41`).

Founder-only approval sits on the same trigger, so it would be hollow while this hole is open. It is outside T1-E's
written scope, so it was escalated, and the founder ruled to close it here (**A-6**). §6.1 is the fix.

---

## 2. What happens to a second account, before and after

**Today.** A business connects a second X account. Both rows are active.
- Every X post is unpinned, so `resolvePublishAccount` returns `ambiguous`.
- The worker fails each post `TOKEN_REVOKED` / `reason: 'account_ambiguous'`.
- The metrics worker skips them (`lib/metrics/orchestrator.ts:68-71`).
- Analytics puts every one in the NULL bucket (`lib/analytics/load.ts:46, 301-303`).
- The post card tells the user to pick from a picker that does not exist.

**After this session.**
- Every new post is created **pinned**.
- Connecting the second account first freezes every existing unpinned live post onto the identity it would have resolved
  to an instant earlier, **inside the connect transaction** (§3.5).
- The database refuses to approve an unpinned post on any platform that has an active account.
- `resolvePublishAccount` is **byte-for-byte unchanged**, and its ambiguous branch remains as a fail-closed backstop for
  legacy rows only.

---

## 3. Account identity and targeting (Q1, L-3) — the load-bearing section

### 3.1 The role (Q1(a))

- **Column:** `social_accounts.account_role text NOT NULL` with a named CHECK in (`'brand'`, `'founder'`) and **no default**.
  A writer that forgets it fails loudly.
- **Declared, never derived.**
  - The connecting member chooses it on the connect step, as a required field validated by a Zod enum. It travels inside
    the signed OAuth state (§5.1), and the connect RPC writes it (§5.3).
  - It is **never** inferred from the URN (Reality §4). `isOrganizationAuthorUrn` (`linkedin-provider.ts:94-96`) keeps
    answering a different question: person or page.
  - **Loser:** a URN-derived role. A marketing lead's personal profile is also `urn:li:person`.
- **Why a column, against ADR 0028 §5.1.**
  - §5.1 rejected a `platform_account_type` column because the URN already carries **person vs organization**.
  - **Brand vs founder** is a different axis, and nothing carries it.
  - On X it is not derivable at all: `platform_user_id` is a bare numeric id (`twitter-provider.ts:288-290`, ADR 0025
    interpretation note 2).
- **Legacy rows** `[db-1]`.
  - In one migration: add the column nullable, backfill **every** existing row to `'brand'`, then set NOT NULL.
  - A founder-ratified backfill run is a dev artefact, D-γ forces re-authorisation anyway, and inferring `founder` would
    violate §5.1's CHECK (no `connected_by` source).
  - A **pre-flight** step raises, naming the business, if any `(business_id, platform)` holds more than one active row.
    §5.6's index would otherwise fail, and that is a human decision, not a migration's.
  - The Builder checks the hosted database before applying.
- **Who may change it.** Only the account's connecting member, through one service-role path (lib/db function plus a
  Zod-validated Server Action). It is refused if the account has **any non-draft pinned post**, published history
  included `[db-6]`. Relabelling would rewrite analytics attribution and retroactively change who must have approved.
  - An admin cannot declare someone else's account `founder`: the role is the connector's statement about their own
    account.
  - A mis-click is corrected the same way, while only drafts exist.
- **The single source of truth for the union** `[type-3]`. `ACCOUNT_ROLES = ['brand','founder']` as a const tuple, the
  derived `AccountRole` type and its Zod enum are exported from one module under `lib/social/` (re-exported by
  `lib/social/index.ts`), and every other site imports from it:
  - the state claims parser;
  - the connect route's Zod;
  - `SocialAccountRow.account_role`;
  - the ratify wrapper (today an inline literal at `lib/db/backfill-runs.ts:374`);
  - `lib/validation/backfill.ts:18`;
  - the UI.

  A parity test pins the tuple to the migration's CHECK. `SocialAccountPublic` becomes discriminated on role, and logic
  that gates on founder (approval display, disconnect authority) takes the narrowed founder type, never a string
  comparison.
- **`social_backfill_runs.account_role` is kept** as a historical snapshot (ADR 0025 §5.2's discriminator).
  - Ratification **stops asking**: the BackfillPanel radio (`BackfillPanel.tsx:181-186, 422-438`) becomes a read-only
    display of the account's role.
  - The Server Action passes the account's role, read server-side.
  - `ratify_backfill_run` raises if `p_account_role` differs from the run's account's role.
  - **Losers:** dropping the column (erases history); keeping the radio (two sources that can disagree).

### 3.2 Where targeting lives (Q1(b))

**Both, with one precedence rule.**

- **Campaign: a new table `campaign_targets`.**
  - Columns: `campaign_id`, `business_id`, `platform`, `social_account_id` (NOT NULL), `created_at`, `updated_at`.
  - Primary key `(campaign_id, platform)`: **one identity per platform per campaign**.
  - Composite FK `(campaign_id, business_id)` → `campaigns(id, business_id)`, ON DELETE CASCADE. This needs a new
    `UNIQUE (id, business_id)` on `campaigns` `[db-8]`.
  - Composite FK `(social_account_id, business_id, platform)` → `social_accounts(id, business_id, platform)`, ON DELETE
    CASCADE. This needs `UNIQUE (id, business_id, platform)` on `social_accounts`.
  - `business_id` → `businesses` ON DELETE CASCADE.
  - Indexes on `social_account_id` and `business_id`.
  - RLS and cascade: §13.
- **What the FK cannot express,** enforced at the write path and by the target plan (§3.6):
  - the platform must be in `campaigns.platforms`;
  - the target account must be active.
- **`campaigns.platforms` is unchanged.** The brief, planner and `lib/campaigns/enforcement.ts` keep using it.
- **Post:** `posts.social_account_id` is **the authority once set**.
  - The campaign target is only the default copied at creation.
  - Changing a campaign target later **does not move existing posts**. Each was decided, and some were approved.
- **What "one row per (campaign, platform)" (`20260430120010_posts.sql:3`) becomes:** "one row per (campaign, platform,
  role-sequence entry), all pinned to that campaign's single identity for the platform". The header comment is
  corrected in the migration.
- **Brand X and founder X at once** is two campaigns. The post count per campaign is unchanged.
- **Losers:**
  - several identities per platform in one campaign: doubles generation and mixes two voices and two approvers inside
    one campaign;
  - targeting on posts only: the decision deferred into forty pickers;
  - `campaigns.target_account_ids uuid[]`: no FK, so tenancy would rest on a trigger.

### 3.3 The setters of `posts.social_account_id` (Q1(c), L-9, Reality §13)

**The boundary is in the database, on every path.**

- **The composite FK.**
  - `posts (social_account_id, business_id, platform)` → `social_accounts (id, business_id, platform)` with
    `ON DELETE SET NULL (social_account_id)`, the column-list form available on Postgres 17 (`supabase/config.toml`
    `major_version = 17`, `[db-7]`).
  - It **replaces** `posts_social_account_id_fkey`, and the new constraint is named.
  - MATCH SIMPLE lets NULL through, as intended.
  - The existing partial index `posts_social_account_id_idx` serves the SET NULL scan.
  - **This makes business B's account on business A's post, and a wrong-platform pin, unrepresentable**, whether the
    write comes from service-role, a DEFINER function or a raw client.
  - The array trap (`get_user_business_ids()` returns both of a two-business user's businesses) cannot reach it, because
    the FK compares the post's own `business_id`.
- **At creation, the only INSERT pins.**
  - `generate.ts` and `promote.ts` set `social_account_id` from the target plan (§3.6) through the service-role client.
  - The insert type no longer admits a free-form optional `social_account_id` `[type-1]`. `createPosts` accepts a base
    insert plus an `identity` that is either a **pinned identity** (a branded value carrying account id, business id and
    platform, constructible only by the target-plan resolver) or **no account yet** (constructible only by a helper that
    has just observed zero active accounts on that business and platform).
  - A bare `null` does not compile.
  - The brand on the identity is a compile-time aid; the FK stays the enforcement.
  - The Builder confirms `promote.ts`'s client (the sweep could not). If it is authenticated, it is routed through
    service-role or the RPC, because a raw authenticated pin is refused (below).
- **The one dedicated UPDATE setter: `pin_post_account(p_post_id, p_account_id)`.**
  - SECURITY DEFINER, `SET search_path = public, pg_temp`, REVOKE from public and anon, GRANT EXECUTE to
    `authenticated` only `[sec-3]`.
  - It locks the post row `FOR UPDATE`.
  - It requires `user_can(post.business_id, 'author')`. `auth.uid()` is still set inside a DEFINER function.
  - It requires `post.status = 'draft'` and `deleted_at IS NULL`.
  - It requires the account to be active and of the post's business and platform. The FK re-asserts the latter two.
  - Wrapped by `lib/db/posts.ts` `pinPostAccount`, called by a Zod-validated Server Action from the identity picker
    (§11.3).
  - **Losers:**
    - an authenticated lib/db update that relies on `PostUpdate` omitting the column. `authenticated` holds table-level
      UPDATE on `posts` (`20260913120000` header; `[db-4]`), so the TS exclusion is not a boundary;
    - a service-role setter called from a Server Action (service-role in the user path).
- **The connect sweep.** A bulk pin inside the connect RPC, specified in §3.5.
- **Trigger rules on `posts`, new or extended** (§6.1 is the full trigger contract).
  - **Scope:** they apply to a *raw client write*, defined as `current_user IN ('authenticated','anon')`. Not
    `auth.uid()`: a DEFINER body runs as its owner, PostgREST sets the role per request, FK referential actions run as
    the table owner, and service-role is neither `[sec-3]` `[db-4]`.
  - **(i)** A raw client may not set `social_account_id` on INSERT, and may not change it on UPDATE. Only service-role,
    the connect RPC and `pin_post_account` may.
  - **(ii)** `social_account_id` may change only while `OLD.status = NEW.status = 'draft'`, for raw-client and RPC
    callers. FK-driven SET NULL is exempt by the `current_user` scope `[db-4]`.
  - **(iii)** Any entry into `approved` or `scheduled` requires a non-NULL pin to an **active** account, unless the
    business has **no** active account on that platform. The zero-account case is allowed as today; a pin to a
    disconnected account is not `[db-4]`.
  - The Builder audits every existing DEFINER function that writes `posts` against these rules and names each in the
    report: `claim_posts_for_publishing`, `publish_post_complete`, `reap_stuck_scheduled_posts`,
    `reschedule_posts_batch` (INVOKER), the learning writers `[sec-3]`.

### 3.4 The single-account business (Q1(d))

- **Auto-pinned at creation.** The target plan fills the campaign target with the sole active account when a campaign is
  created or first generated, and every post is created pinned to it.
- **Why not leave NULL:**
  - NULL defers the identity decision to publish time;
  - it turns `ambiguous` the moment a second account is connected;
  - it keeps ADR 0031's NULL bucket (§4.4) growing with posts that *did* have an identity.
- **L-3 is intact.** The pin is set before approval and is shown to the approver as text. It is the same fact the
  resolver would have used, decided earlier, not a fallback.
- **Zero accounts on a platform:** the post is created **no account yet** (NULL), approval is allowed as today, and the
  first connect sweeps it.

### 3.5 Existing unpinned posts when an account is connected (Q1(e))

**The sweep runs inside `upsert_social_account_connection` (§5.3), in the same transaction, under the same
`pg_advisory_xact_lock` on `(business_id, platform)`** `[sec-8]` `[db-5]`. There is no window in which a publish tick
sees two active rows and an unpinned post.

**Let `prior` be the single active account on that business and platform immediately before this connect, or none.**

| Unpinned post status | `prior` is brand | `prior` is founder | no `prior` |
|---|---|---|---|
| `draft` | pin to `prior` | pin to `prior` (founder approval is still required) | pin to the new account |
| `approved` / `scheduled` | pin to `prior` | **revert to `draft`** (a founder identity is never attached after someone else approved) | new account brand: pin; new account founder: revert to `draft` |
| `failed`, `published`, `skipped` | untouched | untouched | untouched |

- A reconnect of the same row (no new identity) sweeps nothing.
- Posts failed as `account_ambiguous` stay failed. The user regenerates or re-creates them; no new transition is added.
- **Loser:** publish-time pinning (D-2). The decision would be made after approval.

### 3.6 The target plan: generation consumes a total map (Q1(b)/(d), `[type-2]`)

- **One resolver**, `resolveCampaignTargets(campaign, activeAccounts, targetRows)`, under `lib/campaigns/`.
- It returns a result:
  - **ok:** a read-only plan keyed by **every** platform in `campaign.platforms`. Each entry is either *pinned*
    (pinned identity plus role) or *unconnected* (zero active accounts). No `undefined` is possible.
  - **error:** one of `missing_target` (two active accounts and no target), `target_inactive`, or
    `target_platform_mismatch`.
- The single-account auto-fill lives **inside** the resolver, so no caller can skip it.
- `generate.ts` accepts only the plan, never raw rows or a nullable map lookup.
- `missing_target` refuses generation with a typed error the campaign surface renders as the target picker. Service-role
  generation never guesses.
- `promote.ts` uses the same resolver.
- `campaign_targets.platform`, `campaigns.platforms` and the plan key all use the one `Platform` union, pinned to the DB
  CHECK by a parity test `[type-7]`.

### 3.7 The read side: what a post's identity means

- A total function `postIdentityOf(row)` decodes `PostRow.social_account_id: string | null` (the truthful DB type, which
  stays) into a closed union `[type-1]`:
  - `pinned { socialAccountId }`
  - `unpinned`: one member covering both legacy rows and pins nulled by a hard delete of the account, which only
    `purge_business` performs. The two cannot be told apart without a marker column, which is **not** added. Analytics
    already labels this bucket honestly (ADR 0031 §4.4).
- UI and voice consumers branch on the union, never on a raw null test.

### 3.8 The callers table (Q1(f), SHARED-FUNCTION CALLERS)

ADR 0028 §5.3 recorded the three resolver-side callers as *"`AUTHORED-NOT-EXECUTED` for two-identity behaviour"*. Each
gets a two-identity test here.

| Function | Production caller (`file:line`) | Client | Two-identity test the Builder adds |
|---|---|---|---|
| `resolvePublishAccount` | `lib/publishing/orchestrator.ts:107` | service-role | brand-pinned and founder-pinned posts on one platform publish through their own accounts; an unpinned legacy post with two active accounts still fails `account_ambiguous` |
| | `lib/metrics/orchestrator.ts:67` | service-role | metrics fetched with each post's pinned account; unpinned and ambiguous is skipped |
| `listActiveByBusinessAndPlatform` | resolver `lib/db/social-accounts.ts:216` | caller's | covered by the two rows above |
| | `app/api/social/[platform]/disconnect/route.ts:57` | authenticated | two identities without `accountId` → 409; founder authority (§5.5) |
| `getActiveById` | resolver `:210` | caller's | pinned founder vs pinned brand |
| | `disconnect/route.ts:52` | authenticated | founder row: connector allowed, admin allowed, other approver refused |
| `createPosts` | `lib/campaigns/generate.ts:651` | service-role | a campaign with founder-LinkedIn + brand-X targets creates rows pinned per platform; `missing_target` refuses |
| | `lib/campaigns/promote.ts:116` | Builder confirms | promoted post pinned from the plan |
| `pinPostAccount` (new) → `pin_post_account` | picker Server Action | authenticated → DEFINER | draft re-pin allowed; approved refused; other business's account refused (FK) |
| connect sweep (new, in the connect RPC) | `callback/route.ts` via the RPC | service-role | every cell of §3.5's table |
| `approvePost` | `posts/actions.ts:105`, `calendar/actions.ts:289` | authenticated | unpinned on a two-identity platform refused; founder post refused for a non-founder approver |
| `bulkApproveDraftPosts` | `posts/actions.ts:232` ← `ApprovalsInbox.tsx:160`, `PostsClient.tsx:144` | authenticated | §6.4 |
| `buildCustomerContext` (12 callers) / `retrieveVoice` (2 callers) | §4.6 | service-role | §4.6 |

---

## 4. The founder voice (Q2, L-4): ADR 0011 amended

### 4.1 Binding (Q2(a)) — amends ADR 0011 §3.2 and L-10

- **Column:** `social_accounts.voice_variation_id uuid NULL`, with composite FK `(voice_variation_id, business_id)` →
  `brand_voice_variations (id, business_id)`, `ON DELETE SET NULL (voice_variation_id)`. This needs a new
  `UNIQUE (id, business_id)` on `brand_voice_variations` `[db-9]`.
- A named CHECK requires `voice_variation_id IS NULL OR account_role = 'founder'`. Brand accounts are voiced by the
  campaign, as today.
- **One variation may serve the founder's LinkedIn and X.**
- The column stays **outside** the authenticated UPDATE allowlist (§5.2). It is set by a service-role lib/db function
  behind a Zod-validated Server Action that the account's connecting member or an admin may call.
- **Create-and-bind is one RPC** (§4.5), so a failed bind never leaves an orphan variation consuming a cap slot `[db-11]`.
- **On disconnect** (soft) the binding is kept, so reconnecting restores the voice. **On departure:** §5.7.
- **Deleting a bound variation** turns the account into the cold fallback (§4.6). The delete dialog warns which account
  it voices.
- ADR 0011 **L-10** ("variations are campaign-level presets") is amended to: *"campaign-level presets, and the bound
  voice of a founder account."*
- **Loser:** `social_account_id` on the variation. One voice could not then serve two platforms, and the founder's voice
  would be duplicated.

### 4.2 Precedence (Q2(b))

| Post's pinned account | Voice used |
|---|---|
| founder, with a bound variation | **the founder's bound variation**; `campaigns.voice_variation_id` is **ignored** for that platform's posts, and the campaign surface says so |
| founder, no bound variation | base voice, source `founder_cold_fallback` (§4.6) |
| brand | the campaign's variation if set, else base (unchanged) |
| unpinned / no account yet | the campaign's variation if set, else base (unchanged) |

**Loser:** the campaign wins. A campaign mood preset would publish under the founder's name in a brand voice, which is
the averaging L-4 and ADR 0025 L-11 forbid.

### 4.3 The widening (Q2(c)) — amends ADR 0011 §3.2

`brand_voice_variations` gains three nullable columns:

| Column | Type | Constraint | NULL means |
|---|---|---|---|
| `keywords` | `text[] NULL` | — | inherit from the brand |
| `avoid_words` | `text[] NULL` | — | inherit (but see the union rule below) |
| `writing_examples` | `text[] NULL` | named CHECK `writing_examples IS NULL OR cardinality(writing_examples) <= 3`, matching `brand_voices` (`20260430120005:15`) | inherit from the brand |

- An empty array means **explicitly none**, which is distinct from NULL.
- Element count and length bounds beyond the examples cap are enforced at the Zod boundary, matching how `brand_voices`
  is handled (it has no DB CHECK on those arrays).
- **No `tone` column.** ADR 0011 R3 demoted `tone` to a derived display cache that is no longer a generation input; the
  generator reads the descriptor derived from `voice_axes`. Storing one per variation would persist a value nothing reads.
  - **Loser:** widening with `tone`, which ADR 0025 §13's deferral row literally named. Recorded as overtaken by ADR 0011
    R3.
- `target_audience`, `unique_value_prop` and `competitors` are business facts, not voice. They are not added.

### 4.4 The merge rule, inside `retrieveVoice` only (L-4, `[type-4]`)

| Field | Rule when the resolved target is a founder variation |
|---|---|
| `voice_axes` → descriptor | **replace** (unchanged from today) |
| `writing_examples` | **replace** when non-NULL; NULL inherits |
| `keywords` | **replace** when non-NULL; NULL inherits |
| `avoid_words` | **union** with the brand's, de-duplicated: words the company never wants still apply on the founder account |
| `target_audience`, `unique_value_prop`, `competitors` | **inherit** from the brand |
| `tone` | not exposed (display-only, ADR 0011 R3) |

A campaign variation (brand accounts) keeps today's behaviour: axes replace, everything else from the brand.

- **The returned type is a new resolved-voice type that is not a row**, so a caller cannot read the raw base fields and
  re-merge. It holds:
  - axes, descriptor, keywords, avoid-words, writing examples, target audience, value proposition, competitors;
  - `source`.
- `source` is a closed const tuple: `'base' | 'campaign_variation' | 'founder_variation' | 'founder_cold_fallback'`. It
  is set in `lib/memory/voice.ts` where the merge happens, never by a caller.
- NULL versus empty is decoded at the DB boundary into an inherit-or-replace override per field, so a
  `variation.keywords || base` slip cannot inherit on an empty array.
- The per-field rule is one table-driven, exhaustive function.
- `getVariationForBusiness` and any raw variation reader are confined to `lib/memory/`, enforced by a source scan in the
  existing `source-scans` style.
- **Losers:** "add" for every field (brand examples leak into first-person writing); "replace" for every field (drops the
  brand-safety avoid list).

### 4.5 The cap and the RPC (Q2(d)) — amends ADR 0011 §3.4

- A founder variation **counts against the cap of 5**. It is a row; one founder voice typically serves both platforms.
  **Loser:** a cap-exempt discriminator column.
- `create_voice_variation` is widened to take the three new fields and an optional `p_bind_social_account_id`. With that
  argument it binds the new row in the same transaction, after checking the account is a founder account of the same
  business.
- **The old `(uuid, text, jsonb)` signature is dropped explicitly**, because a new parameter list creates an overload that
  `CREATE OR REPLACE` would leave callable `[db-11]`.
- The new signature carries the full audit block (§13.4): pinned `search_path`, REVOKE from public, anon and
  authenticated, GRANT EXECUTE to `service_role` only.
- The Server Action caller verifies membership, because the function trusts `p_business_id`, as today.
- Rename, axes and field updates and delete stay direct table writes, now under hardened RLS (§13.2).

### 4.6 The backfill founder branch, the cold founder, and the callers (Q2(e)–(g))

**Backfill (amends ADR 0025 §4.2).**
- The founder branch of the apply Server Action (`backfill-actions.ts:205-213`) writes axes, `keywords`, `avoid_words` and
  up to 3 `writing_examples`. No tone.
- It writes them to the run's account's **bound variation** if one exists (update), otherwise it creates and binds one
  through §4.5's RPC.
- The `transition_backfill_voice_status` contract is unchanged.
- The ratification screen's line *"your personal voice is saved as tone sliders…"* is replaced by copy stating what is
  now kept.
- **Previously ratified founder runs cannot be revisited.** Their synthesised tone, keywords and examples were never
  persisted: `staged_voice` is nulled in the same conditional UPDATE that records `applied` (ADR 0025 §4.2, ordering).
  The founder edits their variation in `VoiceEditor` instead.

**The cold founder (Q2(f)).** A founder account with no bound variation does **not** block generation.
- It writes in the base voice with `source = 'founder_cold_fallback'`, recorded in `ai_generation_metadata`.
- The post card and the campaign target picker show *"Written in your company voice. Set up your personal voice"*, linking
  to `VoiceEditor` in founder mode, seeded from the "Thought leader" preset or from backfill.
- **Losers:** blocking generation (stops a trial on day one); a silent fallback.

**`CustomerContext` and its callers (Q2(g), `[type-5]`).**
- `retrieveVoice` and `buildCustomerContext` take a **required** voice target, with no default and no optional marker,
  so the compiler forces every site to choose. It is a closed union:
  - `base`;
  - `campaign { variationId }`;
  - `post { identity, campaignVariationId | null }`, where the retriever reads the account's role itself, so a caller
    cannot misreport it.
- **One constructor** builds the post-scoped target from a post and its campaign. Regenerate and learning therefore
  cannot diverge from generation.
- `CustomerContext.brandVoice` becomes the resolved-voice type of §4.4.

| Caller | Target after this ADR |
|---|---|
| `lib/campaigns/generate.ts:206` | one context per **distinct** target in the plan (a post target per pinned identity) |
| `campaigns/[id]/posts/actions.ts:282` (regenerate) | the post's target. **Fixes** today's dropped campaign variation |
| `lib/learning/orchestrator.ts:240` (`retrieveVoice` direct) | the edited post's target |
| `lib/campaigns/brief.ts:102,152`; `lib/campaigns/planner/orchestrator.ts:104` | `campaign` (no post exists yet) |
| `lib/backfill/extract.ts:114`, `lib/learning/summarize.ts:157`, `lib/interview/extract.ts:257`, `lib/signals/triage/orchestrator.ts:125`, `studio/actions.ts:133`, `settings/voice/refine-from-posts-action.ts:42`, `onboarding/infer-brand-voice/actions.ts:27`, `campaigns/[id]/generate-action.ts:53` | `base` (explicitly; today's behaviour) |

### 4.7 Prompt size

Founder examples and keywords **replace** the brand's rather than add to them. Only `avoid_words` grows, by union, and
it is short. No material prompt-size change, so no cost model.

---

## 5. Ownership (Q3, L-5, L-6, L-7)

### 5.1 The connecting member, unforgeable (Q3(a), `[sec-4]`)

**Column:** `social_accounts.connected_by uuid NULL`, REFERENCES `auth.users(id)` ON DELETE SET NULL, with a named CHECK
`account_role <> 'founder' OR is_active = false OR connected_by IS NOT NULL`.
- Brand rows also record their connector, for audit.
- Why `auth.users` and not `business_members`: membership is soft-revoked and per business, the partial unique indexes on
  `business_members` cannot be an FK target, and the identity outlives a membership.

**How it travels.**
1. **Connect** (`connect/route.ts`) requires `user_can(business,'connect_accounts')` (as today), and the role field
   validated by the shared enum (§3.1). It signs
   `{ businessId, platform, nonce, locale, userId: <session user>, role }`.
2. It sets the nonce in an **httpOnly, Secure, SameSite=Lax** cookie, path-scoped to `/api/social`, with a 10-minute TTL.
   Lax is correct because the callback is a top-level GET.
3. **Callback**, before the code exchange and before any vault write, requires all of:
   - a valid JWT;
   - the cookie nonce equal to the claim nonce (the cookie is deleted on use);
   - `auth.getUser().id` equal to `claims.userId`;
   - `user_can(claims.businessId,'connect_accounts')` re-checked. This is missing today; `get_user_business_ids()` is an
     array, so the per-business check is mandatory;
   - a state carrying `userId` and `role`. **Old-format states are rejected.**
4. `connected_by` is the **verified session user**, passed to the service-role RPC (§5.3). It is never taken from client
   input. The RPC re-verifies that user's active membership and connect rights itself, because `user_can` reads
   `auth.uid()`, which is NULL under service-role `[db-5]`.

**The honest limit, stated rather than over-claimed.** This binds the account to a **member's authenticated session**. It
cannot prove which human typed the platform password. An admin who knows a founder's X password and declares it their own
`founder` row would be recorded as its founder. Nothing in OAuth can tell the difference, and the ADR does not claim to.

**Loser:** an admin connecting on the founder's behalf. That is the credential sharing §12.2 excludes, A-1.

### 5.2 Outside the authenticated UPDATE allowlist (Q3(a))

- `account_role`, `connected_by` and `voice_variation_id` are **not** added to `20260913120000:58-65`'s allowlist, which
  stays `(platform_username, platform_display_name, created_at, updated_at)`. They are fail-closed by construction.
- `SocialAccountUpdate` (`types.ts:257-259`) is unchanged.
- Writes go through the connect RPC (§5.3), the role-change path (§3.1) and the binding path (§4.1), all service-role.

### 5.3 Reconnect and the connect RPC (Q3(c), `[sec-5]`, `[db-5]`)

The callback's client-side upsert (`callback/route.ts:137-163`) is replaced by one service-role SECURITY DEFINER RPC,
`upsert_social_account_connection`, which does everything in one transaction.

1. `pg_advisory_xact_lock` on `(business_id, platform)`. Disconnect takes the same lock.
2. `SELECT … FOR UPDATE` the row matching `(business_id, platform, platform_user_id)`. **Not**
   `INSERT … ON CONFLICT`: a hit on §5.6's partial index would raise unhandled, and the conflict target cannot express
   the ownership rule.
3. Decide:

   | Existing row | Session user | Outcome |
   |---|---|---|
   | none | — | INSERT with the declared role and `connected_by` = session user |
   | founder, `connected_by` IS NOT DISTINCT FROM the session user | same | refresh tokens, reactivate; **role unchanged** (role in the state ignored) |
   | founder, connector is a **different, still-active member** | other | **refused** `reconnect_owned_by_other`; nothing written |
   | founder, **inactive** row whose connector is NULL or no longer an active member | any connect-capable member | treated as a **fresh declaration**: the declared role and `connected_by` = session user are written. This closes the deadlock `[sec-5]` found |
   | brand | any connect-capable member | refresh tokens, reactivate; `connected_by` = session user (the current grantor); role unchanged |

4. **Vault secrets are created inside the RPC** through the existing vault wrapper functions. A refusal or failure
   therefore rolls everything back, and nothing orphans. The prior secret ids are read under the row lock and deleted in
   the same transaction, after the row points at the new ones. This removes the concurrent-reconnect race in which one
   callback deletes the other's new secrets.
5. **The UPDATE branch never writes `id`.** This closes the primary-key rewrite the sweep observed in today's upsert
   payload, which would break once pins reference the row `[sec-5]` `[db-5]`.
6. Unique violations from §5.6's index are translated to typed `founder_exists` / `brand_exists` outcomes.
7. Run §3.5's sweep.
8. Return the account id and the outcome. The callback maps outcomes to its existing error-redirect convention, gaining
   `reconnect_owned_by_other`, `founder_exists`, `brand_exists` and `invalid_state` (cookie or user mismatch).

- Grants: `service_role` only. It takes the user id as a parameter, so exposing it to `authenticated` would forge
  `connected_by` `[sec-5]`.
- **Trial trigger:** AFTER INSERT only (`20260430120008:9-38`), and it counts rows of any platform and any state. A
  founder-first connect starts the trial; the update branch does not re-fire it. Concurrent first connects are harmless:
  the update is idempotent on `trial_started_at IS NULL` `[db-5]`.

### 5.4 Capability (Q3(b))

- **Unchanged:** `connect_accounts` (approver or admin, `20260702120200:38`), founder self-connect included. A founder who
  is an `editor` is promoted to `approver` first, which founder-only approval (§6.2) needs anyway.
- **Loser:** a new `connect_own_account` capability for editors. It widens the founder-ruled ADR 0013 matrix, and the
  editor still could not approve their own posts.

### 5.5 Disconnect authority (Q3(d), L-7)

- **Founder row:** its connecting member **or** an admin. The admin must be able to stop a compromised or departed
  founder's account. An approver who is neither is refused.
- **Brand row:** `connect_accounts`, as today (`disconnect/route.ts:33-39`).
- The route's founder check uses the narrowed founder type (§3.1).
- The three GDPR steps (`deactivateSocialAccount`, `lib/db/social-accounts.ts:92-145`) are unchanged, and disconnect
  takes §5.3's advisory lock.
- **Order** `[sec-7]`: deactivate the row, then revert pinned approved/scheduled founder posts (§5.7), then delete the
  secrets.

### 5.6 One founder per platform (Q3(f), L-6) and one brand per platform (A-7)

- **One named partial unique index:** `(business_id, platform, account_role) WHERE is_active`. It enforces **at most one
  active founder and at most one active brand account per platform per business**. A single index subsumes a
  founder-only index `[db-6]`.
- The existing `UNIQUE (business_id, platform, platform_user_id)` (which includes inactive rows) is compatible.
  Reactivation through §5.3 surfaces a breach as a typed error.
- **Not enforced: "the same person is founder on every platform."** The single-founder-person trigger was dropped on
  `[db-6]`'s advice: nothing depends on it, because founder-only approval is per account. Two different people as
  founder on LinkedIn and X remains representable. That is recorded as an accepted residual, not a feature (§16 row 4).

### 5.7 The departing founder (Q3(e), A-8)

**Member removal is enforced in the database** `[sec-7]` `[db-2]`. A trigger on `business_members`, AFTER UPDATE when
`status` becomes `revoked` and AFTER DELETE, does two things in the same transaction:
- sets `is_active = false` on every founder-role `social_accounts` row in that business whose `connected_by` is that user;
- reverts that account's pinned `approved` and `scheduled` posts to `draft`, through a conditional UPDATE
  `WHERE status IN ('approved','scheduled')`.

`revokeMemberAction` then completes the three GDPR steps for those accounts (it nulls the vault ids and deletes the
secrets). It does not null them first; the trigger keeps the vault ids so the action can read them.

- **Residue:** an inactive founder row that still has vault ids is detectable by one query. That query becomes a
  `launch-checklist.md` ops row (§16.1). The row cannot publish meanwhile, because the resolver re-reads `is_active`.
- **Already claimed or publishing posts** cannot be reverted, because the claim is atomic. They publish **at most once**
  under the founder's earlier approval. The window is one worker tick, and it is **accepted and stated** `[sec-7]`.
- **The voice.** The bound variation's `writing_examples` (the founder's own posts, verbatim) are cleared by the action.
  The axes and keywords are kept as a business preset. Whether a business may keep a departed founder's examples at all
  is a **counsel item** (§10.4).
- **Brand accounts the leaver connected** stay active. They are business assets, and their `connected_by` is kept for
  audit.
- **Demotion below approver** leaves the founder's connection intact, but their posts become unapprovable (§6.2) until
  they are re-promoted or an admin disconnects. That is documented as the escape, not a bypass `[sec-6]`.

**Deleting a user (`auth.users`).**
- `business_members.user_id` cascades. That fires the trigger above, but the order of referential actions within one
  delete is not guaranteed.
- **The erasure mechanism is therefore one service-role function**: disconnect every founder row the user connected,
  across all their businesses, then delete the user through the Auth admin API.
- The named CHECK of §5.1 turns any **out-of-order** deletion (an active founder row whose `connected_by` would be
  SET NULL) into a loud, named `check_violation`. It is the safety net, not the mechanism `[db-2]`.
- **Loser:** a trigger on `auth.users` `[sec-7]`. Supabase discourages triggers on the `auth` schema, and the owner
  erasure flow (ADR 0010 D2.7) is already an ordered routine.
- The in-app member self-erasure flow is still pending (`launch-checklist.md` §9), so the function is its contract.

**GDPR position (for counsel, §10.4).**
- The founder's personal profile metadata, tokens and imported posts are the founder's personal data, processed for the
  business (controller), with Jemip as processor.
- **Already-published posts stay**, as the business's published record (`ON DELETE SET NULL` already protects history).
  Removing them from the platform is the founder's own action on their own account.

---

## 6. Approval (Q4, L-2, A-4, A-6)

### 6.1 The trigger contract after this ADR — amends ADR 0013 §5.1

`enforce_post_transition_capability` is extended, and a **new BEFORE INSERT trigger** is added. For a raw client write
(`current_user IN ('authenticated','anon')`), with the service path exempt as today:

| Write | Requirement |
|---|---|
| **INSERT** | `status IN ('draft','skipped')` and `social_account_id IS NULL` (A-6, `[sec-1]` `[sec-2]` `[db-3]`) |
| UPDATE: status changes **into `approved` or `scheduled`** from any other status | `user_can(business,'approve')`; **and** §3.3 rule (iii) (an active pin, unless the platform has no active account); **and**, if the pinned account is founder-role, `auth.uid()` IS NOT DISTINCT FROM `account.connected_by` with `connected_by` NOT NULL (A-4) |
| UPDATE: any other status change | `user_can(business,'author')` (unchanged) |
| UPDATE: `social_account_id` changes | refused for a raw client (§3.3 (i)); for `pin_post_account`, only while `OLD.status = NEW.status = 'draft'` (§3.3 (ii)) |

- The `approved → scheduled` move made by `claim_posts_for_publishing` is service-role and exempt.
- The UI never moves a post to `scheduled`. The Builder verifies this for `calendar/actions.ts` and covers it with a
  trigger test regardless `[sec-6]`.
- The founder lookup reads `social_accounts` inside the INVOKER trigger: `social_accounts_select_own` lets any member read
  `connected_by` `[db-4]`. `SET search_path` is pinned.
- **This closes bug-1948.** `RLS-POST-APPROVE-DB` (ADR 0013) is re-stated as: *nothing publishes without a fresh
  approver transition into `approved` or `scheduled`, on any client path.*

### 6.2 Founder-only approval (A-4)

**Ruled per recommendation.** Approving a post pinned to a founder-role account requires **both**:
- that the caller **is** that account's connecting member;
- that the caller holds `approve`.

- No approver, owner or admin may approve another person's founder post. The owner's `user_can` override grants `approve`
  but not identity, so **this is intended strictness, stated** `[sec-6]`.
- A NULL `connected_by` means **nobody** can approve it.
- **Unapprove (`approved → draft`) stays `author`.** `[sec-6]` proposed restricting it. **Rejected:** unapproving can never
  cause a publish, and an approver must be able to pull a founder post back as a brake. The founder sees the post return
  to their waiting list (§6.5).
- **Alternatives, preserved:**
  - **(b)** any approver, as today. A tighter rule was preferred for the account §12.2 calls *"more sensitive, not less"*.
  - **(c)** a founder-controlled delegation toggle. Deferred: §16 row 9.

### 6.3 An editor founder

They cannot approve until promoted to `approver`. That is consistent with §5.4 and with L-2 never loosening the ADR 0013
matrix.

### 6.4 Bulk approval (FOUNDER-BULK-APPROVE-CALLERS, the APV-BULK lesson)

- `bulkApproveDraftPosts` (`lib/db/posts.ts:702`) puts the founder filter **inside the UPDATE's own WHERE**: a sub-select
  excluding rows pinned to a founder account whose `connected_by` is not `auth.uid()`. Not a separate read `[sec-6]`.
- The trigger still rejects a row re-pinned or re-labelled between render and submit. The action maps that error to a
  typed retry, never a generic failure.
- `APV-BULK-ATOMIC` and `APV-COUNT-CONSISTENT` (ADR 0014) keep holding: the button label, the rows approved, the rows
  removed and the announced count all use the **filtered** set.
- Both callers of the shared action are covered:

| Caller | What it renders | Test |
|---|---|---|
| `app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx:160` | per-campaign "Approve N", where N excludes posts waiting on another person | `ApprovalsInbox.test.tsx` new arm |
| `app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx:144` | "Approve N" over approvable drafts, minus founder posts not the viewer's | `PostsClient.test.tsx` new arm |
| `posts/actions.ts:218` (the action) | — | `posts/actions.test.ts` mixed-set arm |
| `bulkApproveDraftPosts` (DB) | — | Tier-1 live: a mixed set approves only the caller's rows |

### 6.5 Waiting on the founder, and notification

- **A derived state, not stored:** status `draft`, pinned to a founder account, and the viewer is not its connector.
- The card and the inbox show **"Waiting for <founder display name> to approve"** as text, and the approve control is
  disabled with that reason.
- The founder gets a **"Waiting on you"** filter and count in the approvals inbox.
- **Notification is in-app only.** **No new `EmailKind`**: no CHECK widening, no new template.
  - **Loser:** an email kind (a CHECK widening, a template in three locales, unsubscribe semantics) for a state the founder
    sees on their next visit.
  - Deferred with a trigger: §16 row 10.

---

## 7. Memory and backfill scope (Q5, A-9)

- **(a) Provenance.** Founder-account backfill already writes business-level memory marked `source = 'import'` with
  `import_run_id` (ADR 0025 §5.1). The run belongs to exactly one account, which now carries its role.
  *Provenance survives*, with no change. **FOUNDER-MEMORY-PROVENANCE** relies on ADR 0025's `BACKFILL-*` provenance
  constraints unchanged.
- **(b) No account dimension in `RetrieveScope` / `MemoryScope` (A-9, ruled per recommendation).**
  - `MemoryScope` stays `'brand' | 'campaign' | 'platform' | 'contact'` (`types.ts:1220`).
  - `RetrieveScope` stays `{ campaignId?, confidenceFloor? }` (`lib/memory/scoring.ts:18-21`).
  - No field without a consuming term (`SUBSTRATE-QUERY-FIELD-CONSUMED`).
  - **The accepted leak, stated plainly:** the founder's first-person stories and opinions, imported from their personal
    account, **can condition brand-page generation**. Brand claims can condition founder posts, which is acceptable: the
    founder speaks for the company.
  - **Why accept it:** an account dimension means a new `MemoryScope` value, a writer emitting it, a scoring term
    consuming it, and changes to the scope CHECKs on four tables. That is an ADR 0030 substrate change, for a risk no real
    tenant has yet exhibited, because no production account exists.
  - Un-defer trigger: §16 row 6.
- **(c) Performance and outcome patterns stay per platform.** Founder and brand engagement **mix in one base** on the same
  platform: the same base-mixing ADR 0031 L-3 names. Recorded as a known limitation.
  - The analytics surface already separates accounts for a human reader (ADR 0031 §4.4).
  - The edit-learning loop now classifies against each post's own voice (§4.6), which removes the worst cross-voice
    contamination at the input.
  - Un-defer: §16 row 7.
- **(d) The interview (ADR 0029).** Answers stay business-level and condition both identities. There is no preferential
  founder conditioning, because that would need (b)'s dimension. `INTERVIEW-NO-VOICE-WRITE` holds.

---

## 8. (Section order: the scope table is §9 and plans, trial and counsel are §10, matching Q6 then Q7.)

## 9. The verified OAuth scope table (Q6, L-8, A-3)

**Read 2026-10-10.** ADR 0028's 2026-09-03 reading was re-checked, not relied on.

| Platform | Identity | Capability | Scope | Access tier | Vendor doc (updated) |
|---|---|---|---|---|---|
| LinkedIn | founder (member) | identity | `openid`, `profile` (`email` requested, unused for identity) | **Open**, self-serve "Sign in with LinkedIn using OpenID Connect" | [Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) (2026-06-03); [Sign In with LinkedIn using OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) (2024-08-08) |
| LinkedIn | founder | publish | `w_member_social` | **Open**, self-serve "Share on LinkedIn" | Getting Access (2026-06-03); [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09) (2026-05-13) |
| LinkedIn | founder | historical read | `r_member_social` | **Restricted**: *"available to approved users only"* | Posts API (2026-05-13) |
| LinkedIn | founder | metrics | `r_member_postAnalytics` | **Community Management API** permission, API versions ≥ `202506` (code: `LINKEDIN_VERSION = '202608'`, `lib/social/constants.ts:41`) | [Increasing Access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09) (2026-08-17); [Member Post Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-09) (2026-05-15) |
| LinkedIn | brand (organization) | publish / read | `w_organization_social`, `r_organization_social` | **Community Management API** (A-8; Company Page `coming_soon`) | Increasing Access (2026-08-17); Posts API |
| X | founder **and** brand (identical) | identity, publish, historical read, metrics | `tweet.read`, `tweet.write`, `users.read`, `offline.access` | No approval stated on the page; access through the pay-per-use developer account (ADR 0028 §14.2, `launch-checklist.md` §16b) | [X OAuth 2.0 authorization code](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) (page undated; read 2026-10-10) |

**The Community Management API gate, verified.**
- *"Only available to registered legal organizations for commercial use cases only"*. It requires business email, legal
  name, registered address, website, privacy policy, and a LinkedIn Page super-admin verification. Standard tier needs a
  screencast per use case, and a rejection needs a new app
  ([Community Management App Review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-09),
  2026-02-11).
- **New fact for registration:** *"The Community Management API requires that it be the only product associated with a
  developer application … create a new developer application"* for the request. That app *"is used for verification
  purposes only and can be discarded after approval"*
  ([LinkedIn API Partner Support](https://learn.microsoft.com/en-us/linkedin/shared/linkedin-api-partner-support-guide),
  2026-06-03).
- Whether Standard access can then coexist with "Sign In" and "Share on LinkedIn" on the production app is **not stated**.
  If it cannot, LinkedIn access moves to a new client id, and **every connected LinkedIn account must re-authorise**.

| Review-gated scope | Application it needs | Needs the legal entity? | Re-authorisation consequence | Launch-checklist row |
|---|---|---|---|---|
| `r_member_postAnalytics` | Community Management API (Development, then Standard) | **Yes** | every LinkedIn founder re-authorises, possibly under a new client id | §16a (new rows, §16.1) |
| `w_organization_social` / `r_organization_social` | the same application | **Yes** | as ADR 0028 §16 item 7 | §16a (existing) |
| `r_member_social` | restricted program; *"approved users only"* | not stated; access is case by case | every LinkedIn founder re-authorises | §16a (new row) |

- **The ADR 0031 deferral closes** (ADR 0031 §14, row 1). LinkedIn engagement metrics for the **founder** identity need
  `r_member_postAnalytics`, a Community Management API permission. **They therefore share A-8's legal-entity gate** and
  are not a separate review. Nothing changes for the founder identity before that gate opens:
  `metricsReadAvailable: false` and `fetchPostMetrics` NOT_IMPLEMENTED stay (`linkedin-provider.ts:352-359`).
- **Correction recorded, not made here:** the name `r_member_social_feed` used in that error reason and in ADR 0031's
  deferral row does not appear in LinkedIn's permission tables; `w_member_social_feed` is the comments permission. The
  reason string is backlog (§16 row 13).
- **No scope changes. No non-review scope is needed** for the founder identity (L-8, A-3). `PLATFORM_CONFIGS` is unchanged.
- **The pairwise-`sub` question remains open** (ADR 0028 §16 item 9).
  - The discovery document still declares `subject_types_supported: ["pairwise"]` (verified 2026-10-10 on the OIDC page).
  - The Share documentation requires the author to be the member's Person URN.
  - **Stage-1 check:** with real credentials, connect a real founder profile, publish with `urn:li:person:{sub}` as the
    author, and confirm a `201` and the post on that profile.

---

## 10. Plans, trial and counsel (Q7)

### 10.1 The Plus identity allowance (A-5)

- **Ruled per recommendation:** Plus's *"LinkedIn + X"* means **brand and founder on both** (four identities). At launch
  the LinkedIn brand identity is `coming_soon` (A-8), so Plus delivers founder LinkedIn plus brand and founder X.
- **Enforcement:** the universal index of §5.6 (at most one brand and one founder per platform, A-7) is the only limit,
  and it is server-side.
- `allowedPlatforms` keeps gating platforms, not accounts. `lib/stripe/plan.ts` is unchanged, and there is **no per-plan
  account limit**.
- **Alternative preserved:** two identities on Plus (one per platform). Rejected because it would force a Plus customer to
  choose between the brand and founder X, on the ICP's best channel.
- **Pricing-copy note (not edited, L-1):** the pricing page's *"LinkedIn + X"* is accurate under A-5. Whether to say *"for
  your company and its founder"* is a copy decision for the C-2 pricing pass.

### 10.2 Posts per month

- Founder-account posts count like any post of the business.
- **Finding (recorded, not fixed):** `postsPerMonth` and `allowedPlatforms` have **no runtime gate anywhere**. They are
  read only by `pricingFeatureRows` (`lib/stripe/plan.ts:100-111`); `lib/campaigns/enforcement.ts:25` reads only
  `activeCampaigns`.
- **The Plus limits drift is recorded, not fixed:** coded `postsPerMonth: 50, activeCampaigns: 5` (`plan.ts:57-58`) against
  `CLAUDE.md`'s 250 / 25.
- Both go to the founder via `docs/backlog.md` (§16 rows 11–12).

### 10.3 The trial clock

**Confirmed:** a founder account as the first connection starts it. `trg_social_accounts_start_trial` counts any
`social_accounts` row (`20260430120008:9-38`). **Loser:** exempting founder accounts. The clock rule ("first social
account connection") is a locked decision and draws no such distinction.

### 10.4 Counsel

**New `launch-checklist.md` §9 row** (text for the Builder to add verbatim):

> - [ ] **Founder personal accounts — counsel line (ADR 0032 §5.7, §10.4).**
>   - A founder's personal LinkedIn/X profile is personal data of a named individual acting partly in a personal
>     capacity. Owed:
>     1. the lawful basis for processing it for the business;
>     2. the controller split between the business and the founder on disconnect, on departure (member removal) and on
>        erasure, including whether a business may keep a departed founder's voice preset and examples (ADR 0032 clears
>        examples on departure pending this answer);
>     3. what `/privacy` must say about founder accounts, `connected_by`, and founder-only approval.
>   - No legal prose written and no `[LEGAL ENTITY]` placeholder touched by Session 38.

- **Evidence Pack impact:** `docs/evidence/0010-legal-evidence.md` needs an entry for `social_accounts.connected_by`,
  `account_role`, `voice_variation_id`, the widened variation fields (founder examples), and `campaign_targets`.
- The `evidenceRef` on any `content/legal/*.mdx` that describes founder accounts (`privacy.en.mdx` §4 already flags them,
  ADR 0025) is bumped **when that prose changes**, after counsel.
- **No MDX is edited in this session** (L-1).

---

## 11. The UX contract the Builder is held to (Q8)

Specified here and designed by the Builder against this contract (CLAUDE.md UI/UX phase rule):

- **`impeccable`:** UX, states and copy, every surface.
- **`taste-skill`:** only if a surface reads as generic.
- **`ui-ux-pro-max`:** to validate any new visual token (the role badge).
- **`emil-design-eng`:** the final polish pass.

The Architect ran none of them.

**Every surface, without exception:**
- Server Component page, Client Component interactivity.
- **Zod on every Server Action.**
- shadcn v4 / Base UI with **no `asChild`**.
- **Native `<select>` for every identity picker** (the options are a small static set per render).
- Tailwind only.
- **i18n en/pt/es simultaneously.**
- **WCAG 2.2 AA:** keyboard-reachable, and **every post's identity readable as text** (display name + role word), never
  only as an avatar or colour.

### 11.1 Accounts (`settings/accounts/AccountsClient.tsx`, `components/social/PlatformConnectionCard.tsx`)

**Information hierarchy, per platform:**
1. the platform;
2. each identity as its own card: role badge as **text** ("Company" / "Founder"), `@username`, display name, "Connected by
   <member name>", connection status (the five existing states);
3. actions.

- **Brand and founder side by side** on LinkedIn: the founder card working, the Company Page card `coming_soon` with its
  existing truthful copy.
- "Connect your personal profile" and "Connect your company account" are **separate, obvious actions**, each starting the
  role-declared connect. Neither reads as a reconnect (ADR 0028 §9.4).
- The connect step asks "Whose account is this?" with two labelled choices. Required.
- The **"Default" badge is retired**. Posts name their identity; there is no default (`connection-status.ts:57-60`
  `pickDefaultAccountId` remains for the legacy resolver path only).
- Disconnect is shown only to whoever may disconnect (§5.5).
- **States:**
  - empty;
  - one identity;
  - two identities;
  - founder disconnected;
  - founder departed (an inactive founder card with "Reconnect as company or founder" for an admin, §5.3);
  - `founder_exists` / `brand_exists` / `reconnect_owned_by_other` / `invalid_state` error banners, all localised;
  - loading;
  - error.

### 11.2 Onboarding `step-3/Step3Client.tsx`

**Finding:** it is single-identity today. It keeps `Record<Platform, account>` and the last write wins (`:60-62`), so a
second account silently disappears. It becomes multi-identity with the same cards as §11.1, with the same states.

### 11.3 Campaign targeting (campaign create/edit)

- Per selected platform, a native `<select>` labelled "Publishes from", listing that platform's active identities by role
  word and name. Auto-filled and shown read-only when exactly one identity exists. Hidden with "Connect an account" when
  none exist.
- When the founder identity is chosen: the voice line reads "Written in <founder>'s voice" (or the cold notice, §4.6), and
  the campaign voice selector notes that it does not apply to founder posts.
- **States:** none, one, two, founder inactive (the option is disabled, with its reason), `missing_target` (the generation
  error surfaces here), loading, error.

### 11.4 Per-post identity (post card, approvals inbox, calendar)

- Every post shows **"From <name> · <Company|Founder>"** as text.
- The `account_ambiguous` **state for new posts disappears** by construction.
- For **draft** legacy unpinned posts on a two-identity platform, the failed-state copy is replaced by an **inline native
  `<select>` picker** that calls `pin_post_account`.
- **Approved** posts show identity read-only, with "Unapprove to change".
- **Waiting-on-founder** (§6.5) badge plus a disabled approve control with its reason. The founder's "Waiting on you"
  filter.
- **Cold founder** notice (§4.6).
- **Founder departed** (posts reverted to draft, §5.7): "Founder account removed. Choose another identity or remove".
- The calendar chip carries the identity as text in its accessible name.

### 11.5 The founder voice editor

- The existing `VoiceEditor` (`components/voice/VoiceEditor.tsx`), in **founder mode**: the axes, the must/cannot words,
  and the ≤ 3-example chooser that brand mode already has (`:87-91` today shows the founder an axes-only note, which is
  removed).
- A line states the merge rule in plain words: *"Words your company always avoids still apply."*
- Reached from the founder account card, the cold notice, and backfill review (`step-2/VoiceReviewHost.tsx`).
- **States:** cold (no voice yet: start from "Thought leader" or from your posts), editing, saved, cap reached
  (`VoiceVariationCapError`, retryable), loading, error.

---

## 12. Test plan (Q8) and measurement

### 12.1 Tier 1 — live Postgres (`supabase/__tests__/`, `db-tests.yml`)

Every seed uses explicit `status = 'active'` / `is_active = true` (cerebrum, Session 34 K1). Every tenancy arm uses one
user in **two** businesses, with B's positive control seeded.

1. **The new `social_accounts` columns.**
   - `account_role` NOT NULL and its CHECK.
   - `connected_by` CHECK. The named `check_violation` fires on deleting a user who connected an active founder row, and
     the deletion succeeds after disconnect.
   - The `voice_variation_id` CHECK and composite FK.
   - None of the three is updatable by `authenticated` (allowlist exclusion).
2. **The partial unique index:** a second active founder, and a second active brand, refused per platform; inactive rows
   don't count.
3. **Composite FK on posts:**
   - business B's account on business A's post refused on INSERT (service-role), on `pin_post_account`, and on a raw
     update;
   - a wrong-platform pin refused;
   - account deletion sets only the pin NULL.
4. **Trigger:**
   - a raw INSERT of `approved` / `scheduled` refused (bug-1948);
   - a raw `draft → scheduled` refused;
   - a raw pin refused on INSERT and UPDATE;
   - `pin_post_account` on a draft succeeds and on an approved post is refused;
   - approval of an unpinned post refused when the platform has an active account, and allowed when it has none;
   - approval of a pin to an inactive account refused;
   - a founder post approved by the founder succeeds, by another approver is refused, by the owner is refused, and with a
     NULL connector is refused;
   - `purge_business` with pinned published posts succeeds (FK SET NULL is not blocked).
5. **Connect RPC:**
   - insert;
   - same-founder reconnect;
   - another active member's reconnect refused, with no secret orphaned;
   - an admin re-declaring an inactive founder row whose connector left;
   - brand refresh;
   - `id` unchanged on reconnect;
   - reactivation breaching the index gives a typed error;
   - two concurrent connects serialised;
   - every cell of §3.5's sweep table.
6. **Member-removal trigger:** revoke and member delete both deactivate the founder row and revert its approved/scheduled
   posts; brand rows untouched.
7. **`campaign_targets`:** RLS (members read, `author` writes, UPDATE with USING and WITH CHECK, two-business arm),
   composite FKs, cascade from campaigns and businesses, `purge_business`.
8. **`brand_voice_variations`:** the widened CHECK (4 examples refused); RLS hardened to the InitPlan form with `author` on
   writes (a viewer write refused); `create_voice_variation` old signature absent and new signature `service_role`-only;
   create-and-bind atomic.
9. **Bulk approve:** a mixed set flips only the caller-approvable rows, and the returned count equals the rows flipped.
10. **`ratify_backfill_run`:** raises on a role mismatch with the account.

### 12.2 Tier 2 — vitest (`app-tests.yml`)

- **Targeting:**
  - `resolveCampaignTargets` (every result branch);
  - the target Server Action (Zod; platform not in `campaigns.platforms` refused);
  - `pinPostAccount` wrapper and action;
  - **one two-identity test per caller in §3.8**.
- **Voice:**
  - `retrieveVoice` merge per field (NULL, `[]`, non-empty; `avoid_words` union de-duplicated);
  - precedence for every row of §4.2;
  - the cold fallback source;
  - the required target at every caller in §4.6 (regenerate and learning pass the post's target);
  - the source-scan confining raw variation readers.
- **OAuth:**
  - state claims parsed with the shared role enum;
  - an old-format state rejected;
  - cookie-nonce mismatch, session-user mismatch, and `user_can` false each refused **before** the exchange and before
    any vault call;
  - every new error code mapped and localised.
- **Disconnect authority** (§5.5).
- **Bulk approve:** **both callers** (`ApprovalsInbox.tsx`, `PostsClient.tsx`) render and announce the filtered count; the
  action's typed retry.
- **Backfill:** the founder apply writes the widened fields to the bound variation, else creates and binds; the radio is
  gone and the role is read server-side.
- **UI:** every state in §11, en/pt/es key parity, accessible names carry identity as text.
- Role-tuple and `Platform` parity tests.

### 12.3 Tier 3 — properties of absence (diff-verified, no runtime test by decision)

1. `resolvePublishAccount`'s body and branches (`lib/db/social-accounts.ts:203-220`) are unchanged in the diff.
2. `PLATFORM_CONFIGS` scopes are unchanged; no review-gated scope appears.
3. No new voice table: no `CREATE TABLE … voice` migration.
4. No organization-posting path: no `w_organization_social` in config, no org-author publish branch added.
5. No user id is taken from client input: `connected_by` is written only by the connect RPC from the verified session.
6. No account dimension in `MemoryScope` / `RetrieveScope`.
7. No new `EmailKind`.
8. No edit to `CLAUDE.md`, the pricing page or `content/legal/*.mdx`.

### 12.4 Measurement: what mocks can and cannot show

**Seeded data and mocks prove:**
- every DB boundary above;
- that pins are set and honoured;
- that the resolver receives the right account id;
- that the provider is called with that account;
- the voice merge;
- every UI state.

**They cannot prove, without a real LinkedIn and X credential:**
1. a real founder connect against LinkedIn's production app;
2. a real publish under `urn:li:person:{sub}` (the pairwise-`sub` question, §9);
3. a real second X account connected as founder and publishing as a distinct identity;
4. the cookie-nonce flow across the real provider redirect;
5. founder-only approval exercised in a browser.

**ADR 0028 §14 gains one Stage-1 row**, to fill once a LinkedIn app and an X developer account exist:

| Date | Platform | Identity | Operator | Result |
|---|---|---|---|---|
| — | LinkedIn | founder (member): connect, publish as `urn:li:person:{sub}`, confirm on profile (pairwise-`sub` check) | — | — |
| — | X | founder (second account beside a brand account): connect, publish, confirm distinct author | — | — |
| — | both | founder-only approval and waiting-on-founder in a real browser | — | — |

**Nothing here is Tier E.** No judgment-quality property is claimed. Voice fidelity of the founder variation is
**reported** after real tenants exist, not measured by this session.

---

## 13. GDPR and tenancy (L-9)

### 13.1 Every new column and table

| Object | ON DELETE | RLS | §D2.5 |
|---|---|---|---|
| `social_accounts.account_role` | — | existing policies; outside the allowlist | no new row (existing `social_accounts` row covers the table by its `business_id` CASCADE) |
| `social_accounts.connected_by` → `auth.users` | **SET NULL**, guarded by the founder CHECK (§5.1, §5.7) | existing; outside the allowlist | no new row (same). **PII note:** holds a user id, erased with the row by the business cascade and nulled on user erasure |
| `social_accounts.voice_variation_id` → variations (composite) | **SET NULL (voice_variation_id)** | existing; outside the allowlist | no new row |
| `posts` composite FK (replaces the single-column FK) | **SET NULL (social_account_id)** | existing policies; new trigger rules (§6.1) | no new row (existing `posts` row; the ADR 0028 note at `0010-legal-surface.md:1151-1158` still holds) |
| `brand_voice_variations.keywords / avoid_words / writing_examples` | — | **hardened** (§13.2) | no new row (existing row). **PII note:** `writing_examples` may hold a founder's verbatim posts; erased by the business cascade; cleared on departure (§5.7) |
| `campaigns UNIQUE (id, business_id)`, `social_accounts UNIQUE (id, business_id, platform)`, `brand_voice_variations UNIQUE (id, business_id)` | — | — | none (constraints only) |
| **`campaign_targets`** (new table) | CASCADE from `campaigns` (composite) and `businesses`; CASCADE from `social_accounts` (composite) | enabled; SELECT for members; INSERT/UPDATE/DELETE require `user_can(business_id,'author')`; all in the InitPlan form `business_id = ANY ((SELECT public.get_user_business_ids()))` with `(SELECT public.user_can(…))`; UPDATE has USING **and** WITH CHECK; anon revoked | **new row, verbatim below** |

**The ADR 0010 Amendment 2 §D2.5 row**, added in the same commit as the migration (L-9):

> `| campaign_targets | yes (business_id + campaign_id + social_account_id) | CASCADE (business_id; campaign_id and social_account_id via composite FKs) | yes | none — cascade = erasure (holds only identifiers: which connected account a campaign publishes from; no free text) |`

**`purge_business` coverage.**
- `campaign_targets` cascades from the root `DELETE FROM public.businesses` (`20260702120700:62`). The migration comment
  states it, as `20260623210000` did for variations.
- `purge_business` needs **no body change**: its vault loop already deletes the secrets of every `social_accounts` row of
  the business (`:33-42`).

### 13.2 `brand_voice_variations` RLS, hardened `[db-10]`

Today's policies (`20260623210000:88-103`) are the bare form with **no capability check**, so any member, viewer included,
can insert, update and delete a variation. Founder `writing_examples` are personal data now living there, so this ADR
replaces them:
- SELECT: members.
- INSERT, UPDATE and DELETE: `user_can(business_id,'author')`.
- All in the InitPlan form; UPDATE has USING and WITH CHECK.

`brand_voices` is left as is (§16 row 14).

### 13.3 Tenancy, per new read and write

| New read or write | Client | Tenant boundary | Two-businesses-one-user arm (Tier 1) |
|---|---|---|---|
| post pin (insert, RPC, sweep) | service-role / DEFINER | composite FK on the post's own `business_id` | A's post cannot hold B's account by any path |
| `campaign_targets` | authenticated (Server Action) | RLS plus composite FKs | A's campaign cannot target B's account |
| connect RPC | service-role | `claims.businessId` from the signed state, plus the per-business `user_can` re-check in the callback, plus the RPC's own membership check | a user in A and B connecting while A is active cannot write into B unless the state names B and they may connect there |
| founder lookup in the trigger | invoker | the account is reached through the post's own pin, which the FK ties to the same business | — |
| `retrieveVoice` (post target) | service-role | account and variation read with `.eq('business_id')` (cerebrum 36-D: the explicit filter is the boundary on a service-role path) | A's post never resolves B's variation |

### 13.4 The SECURITY DEFINER audit gate

The standing A-8 gate applies to each new or changed DEFINER function:
- `search_path` pinned to `public, pg_temp`;
- REVOKE ALL from PUBLIC, `anon`, `authenticated` unless granted below;
- explicit GRANTs;
- business scoping re-checked inside;
- no dynamic SQL;
- named in the Builder's report.

| Function | Grant |
|---|---|
| `pin_post_account` | `authenticated` |
| `upsert_social_account_connection` | `service_role` |
| `create_voice_variation` (new signature; old dropped) | `service_role` |
| `set_social_account_role` (the role-change path, if built as an RPC) | `service_role` |
| member-removal trigger function | owner-run trigger, no direct EXECUTE grant |
| user-erasure function | `service_role` |
| extended `enforce_post_transition_capability` and the new INSERT trigger function | INVOKER, as today |

The hosted-drift lesson (`20261004100000_repair_hosted_client_exec_drift.sql`) applies: grants are asserted by a Tier-1
test against the live database, not assumed from the migration text.

---

## 14. The constraint table (the Reviewer's checklist)

**48 constraints.** Tier 1 = `supabase/__tests__` under `db-tests`; Tier 2 = vitest under `app-tests`; Tier 3 =
diff-verified absence. "Relies on / extends" names the prior constraint where one exists.

| # | Constraint | Tier | Proof (§12) | Relies on / extends |
|---|---|---|---|---|
| 1 | IDENTITY-NO-UNPINNED-NEW-POST | 1 + 2 | 12.1 #4 (approval of unpinned refused), 12.2 (insert type, target plan) | extends ADR 0028 `SOCIAL-DUAL-IDENTITY` |
| 2 | IDENTITY-SETTER-TENANT-CHECKED | 1 | 12.1 #3 | extends `SOCIAL-PINNED-ACCOUNT-TENANT-CHECKED` |
| 3 | IDENTITY-PIN-RAW-WRITE-REFUSED | 1 | 12.1 #4 | — |
| 4 | IDENTITY-PIN-DRAFT-ONLY | 1 | 12.1 #4 | — |
| 5 | IDENTITY-APPROVE-REQUIRES-ACTIVE-PIN | 1 | 12.1 #4 | — |
| 6 | IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED | 3 | 12.3 #1 | relies on ADR 0028 §5.3 / L-3 |
| 7 | IDENTITY-ROLE-PERSISTED | 1 | 12.1 #1 | supersedes ADR 0025 interpretation note 2's "not on social_accounts" |
| 8 | IDENTITY-ROLE-NOT-FROM-URN | 2 + 3 | callback test writes the declared role; no URN-prefix role derivation in the diff | relies on ADR 0028 §5.1 |
| 9 | IDENTITY-ROLE-CLOSED-UNION | 2 | role-tuple parity test; state parser rejects unknown/missing role | — |
| 10 | IDENTITY-ROLE-CHANGE-GUARDED | 1 + 2 | role change refused with a non-draft pinned post; only the connector | — |
| 11 | IDENTITY-CAMPAIGN-TARGET-ONE-PER-PLATFORM | 1 | 12.1 #7 (PK, composite FKs) | — |
| 12 | IDENTITY-TARGET-PLAN-TOTAL | 2 | `resolveCampaignTargets` branches; generate accepts only the plan | — |
| 13 | IDENTITY-CONNECT-SWEEP-ATOMIC | 1 | 12.1 #5 sweep table + concurrency | — |
| 14 | IDENTITY-CALLERS-TWO-ACCOUNT-COVERED | 2 | one test per §3.8 row | closes ADR 0028 §5.3's `AUTHORED-NOT-EXECUTED` note |
| 15 | APPROVAL-GATE-INSERT-CLOSED (A-6) | 1 | 12.1 #4 | amends ADR 0013 `RLS-POST-APPROVE-DB` |
| 16 | APPROVAL-GATE-SCHEDULED-CLOSED (A-6) | 1 | 12.1 #4 | amends ADR 0013 `RLS-POST-APPROVE-DB` |
| 17 | FOUNDER-CONNECTED-BY-SELF | 1 + 2 | 12.1 #1 (CHECK); 12.2 (`connected_by` = session user) | A-1 |
| 18 | FOUNDER-OWNER-UNFORGEABLE | 2 | 12.2 OAuth arms (nonce, session user, old state) | — |
| 19 | FOUNDER-OWNER-NOT-MEMBER-UPDATABLE | 1 | 12.1 #1 allowlist exclusion | extends ADR 0025 identity lock |
| 20 | FOUNDER-CALLBACK-RECHECKS | 2 | `user_can` false → refused before exchange and vault | ADR 0013 `RLS-SOCIAL-APPLAYER` |
| 21 | FOUNDER-ONE-PER-PLATFORM | 1 | 12.1 #2 | A-2 |
| 22 | FOUNDER-RECONNECT-NO-TAKEOVER | 1 | 12.1 #5 | — |
| 23 | FOUNDER-RECONNECT-NO-PK-REWRITE | 1 | 12.1 #5 (`id` unchanged) | — |
| 24 | FOUNDER-DISCONNECT-AUTHORITY | 2 | 12.2 disconnect authority | — |
| 25 | FOUNDER-DISCONNECT-GDPR | 1 + 2 | three steps unchanged + lock; existing disconnect tests extended | relies on ADR 0028 `SOCIAL-DISCONNECT-*` / L-7 |
| 26 | FOUNDER-DEPARTURE-HANDLED (A-8) | 1 + 2 | 12.1 #6; action completes GDPR steps, clears examples | — |
| 27 | FOUNDER-ERASURE-ORDERED | 1 | 12.1 #1 (named violation; success after disconnect) | — |
| 28 | FOUNDER-VOICE-THROUGH-EXISTING | 3 | 12.3 #3 | ADR 0016 `MEM-VOICE-THROUGH-EXISTING` |
| 29 | FOUNDER-VOICE-WIDENED | 1 | 12.1 #8 | amends ADR 0011 §3.2; closes ADR 0025 §13 row |
| 30 | FOUNDER-VOICE-MERGE-RULE | 2 | 12.2 merge per field | — |
| 31 | FOUNDER-VOICE-PRECEDENCE | 2 | 12.2 every §4.2 row | — |
| 32 | FOUNDER-VOICE-COLD-HANDLED | 2 | 12.2 cold source + notice | — |
| 33 | FOUNDER-VOICE-BINDING-TENANT | 1 | 12.1 #1 composite FK | — |
| 34 | FOUNDER-VARIATION-RLS-HARDENED | 1 | 12.1 #8 | amends ADR 0011 §3.2 RLS |
| 35 | FOUNDER-VOICE-TARGET-REQUIRED | 2 | every §4.6 caller passes an explicit target; raw-reader source scan | — |
| 36 | FOUNDER-APPROVAL-NOT-RELAXED | 1 | 12.1 #4 (nothing approvable that was not before) | L-2 |
| 37 | FOUNDER-APPROVAL-ENFORCED-IN-DB (A-4) | 1 | 12.1 #4 founder arms | — |
| 38 | FOUNDER-BULK-APPROVE-CALLERS | 1 + 2 | 12.1 #9; §6.4 table | extends ADR 0014 `APV-BULK-ATOMIC`, `APV-COUNT-CONSISTENT` |
| 39 | FOUNDER-MEMORY-PROVENANCE | 3 | 12.3 #6; ADR 0025 provenance constraints unchanged | relies on ADR 0025 §5 |
| 40 | FOUNDER-SCOPES-VERIFIED | 3 | §9 table, dated with URLs | re-verifies ADR 0028 §2.2 / §16 item 11 |
| 41 | FOUNDER-NO-REVIEW-GATED-SCOPE | 3 | 12.3 #2 | A-3 |
| 42 | FOUNDER-NO-ORG-POSTING | 3 | 12.3 #4 | ADR 0028 A-8 |
| 43 | FOUNDER-PLAN-ENFORCED-SERVER (A-5, A-7) | 1 | 12.1 #2 (the index is the limit) | — |
| 44 | FOUNDER-CASCADE-COMPLETE | 1 + doc | 12.1 #7; the §D2.5 row present in the migration commit | CLAUDE.md erasure-cascade rule |
| 45 | FOUNDER-I18N-COMPLETE | 2 | en/pt/es parity for every new key | — |
| 46 | FOUNDER-A11Y-FLOOR | 2 | identity as text in accessible names; keyboard paths | — |
| 47 | FOUNDER-NO-USER-ID-FROM-CLIENT | 3 | 12.3 #5 | L-5 |
| 48 | FOUNDER-DEFINER-AUDIT | 1 | live-grant assertions per §13.4 | standing A-8 gate |

---

## 15. Reviewer dispositions (one batch, not re-consulted)

| Finding | Disposition |
|---|---|
| `[sec-1]` / `[db-3]` approval bypass by INSERT and `draft → scheduled` (CRITICAL / HIGH) | **Accepted**; escalated as **A-6**; §1.5, §6.1 |
| `[sec-2]` raw INSERT pins a founder account | **Accepted**; §3.3 (i), §6.1 |
| `[sec-3]` / `[db-4](i)` key the rule on `current_user`, not `auth.uid()`; audit existing DEFINER writers | **Accepted**; §3.3 |
| `[db-4](ii)` "draft only" would block FK SET NULL | **Accepted**; the rules are scoped to raw-client and RPC callers |
| `[db-4](iii)` pin to an inactive account satisfies NOT NULL | **Accepted**; active pin required |
| `[sec-4]` cookie nonce, session-user match, `user_can`, checks before exchange, reject old states | **Accepted**; §5.1 |
| `[sec-5]` / `[db-5]` connect RPC: lock, `SELECT … FOR UPDATE`, never write `id`, vault inside the transaction, typed unique violations, `IS DISTINCT FROM`, RPC re-verifies membership, deadlock on a departed founder's inactive row | **Accepted**; §5.3 |
| `[sec-6]` founder rule on every entry into `approved`/`scheduled`; bulk filter inside the UPDATE WHERE; typed retry; owner strictness stated | **Accepted**; §6 |
| `[sec-6]` restrict unapprove of founder posts | **Rejected**: unapproving cannot cause a publish, and approvers need it as a brake (§6.2) |
| `[sec-7]` / `[db-2]` departure must be DB-enforced; worker race bounded; order of steps | **Accepted**; §5.7 |
| `[sec-7]` BEFORE DELETE trigger on `auth.users` | **Rejected**: triggers on the auth schema are discouraged; an ordered erasure function plus the named CHECK as safety net (§5.7) |
| `[sec-8]` / `[db-5]` sweep inside the RPC; never attach a founder identity to an approved post | **Accepted**; §3.5 |
| `[sec-9]` composite FK: PG version, inactive accounts | **Accepted**; PG 17 confirmed; active checked in the RPC and trigger |
| `[sec-10]` / `[db-6]` advisory-lock key, single-founder-person trigger | Lock key **accepted**; the trigger **dropped** on `[db-6]`'s advice (§5.6) |
| `[db-1]` legacy backfill can violate the CHECK and indexes (BLOCKER) | **Accepted**; all legacy rows to `brand`, pre-flight raises (§3.1) |
| `[db-6]` one index subsumes the founder index; role change refused with any non-draft pinned post; a change path | **Accepted**; §5.6, §3.1 |
| `[db-7]` name the composite FK; drop the old one | **Accepted**; §3.3 |
| `[db-8]` `campaign_targets` business tie, ON DELETE, indexes, RLS, §D2.5 | **Accepted**; §3.2, §13 |
| `[db-9]` composite variation binding; `campaigns.voice_variation_id` cross-tenant gap | Binding **accepted**; the campaigns gap **recorded, not fixed** (§16 row 15). Generation reads variations through the tenant-checked `getVariationForBusiness`, so it is a representability gap, not a leak |
| `[db-10]` variation RLS without capability, not InitPlan | **Accepted**; §13.2 |
| `[db-11]` drop the old `create_voice_variation` signature; grants; create-and-bind atomic | **Accepted**; §4.5 |
| `[type-1]` pinned-at-insert types; read-side identity union | **Accepted**; §3.3, §3.7 (one `unpinned` member; no marker column) |
| `[type-2]` total target plan | **Accepted**; §3.6 |
| `[type-3]` single role source; discriminated account type | **Accepted**; §3.1 |
| `[type-4]` resolved voice not a row; override decoding; raw readers confined | **Accepted**; §4.4 |
| `[type-5]` voice target encodes outcomes; the retriever reads the role; required parameter; one constructor; closed `source` | **Accepted**; §4.6 |
| `[type-6]` a typed failure code in place of `TOKEN_REVOKED` / `account_ambiguous` | **Rejected**: it would touch the resolver's fail-closed outcome mapping, which L-3 fences, and the existing UI and analytics read that reason |
| `[type-7]` `Platform` parity | **Accepted**; §3.6 |

---

## 16. Explicitly deferred (owning session or trigger named)

| # | Item | Owner | Un-defer trigger (`docs/backlog.md` row) |
|---|---|---|---|
| 1 | LinkedIn Company Page posting | ADR 0028 A-8 | legal entity registered **and** Community Management API granted (`launch-checklist.md` §16a) |
| 2 | LinkedIn founder metrics (`r_member_postAnalytics`) | a LinkedIn amendment to ADR 0028 | the same Community Management API grant (§9). Closes ADR 0031 §14 row 1 as "same gate" |
| 3 | LinkedIn founder historical read (`r_member_social`) | ADR 0025 §13 row | restricted access granted (`S38-LI-MEMBER-READ`) |
| 4 | Multi-founder workspaces (and "one founder person across platforms") | unassigned | a founder ruling to support more than one founder person (`S38-MULTI-FOUNDER`) |
| 5 | Personal profiles on Instagram / Facebook / Threads | the provider session for each | a provider exists for that platform |
| 6 | Account dimension in memory retrieval | an ADR 0030 amendment | first real tenant with a founder backfill **and** an observed first-person-on-brand output or an eval showing it (`S38-MEMORY-ACCOUNT-SCOPE`) |
| 7 | Per-account outcome patterns | an ADR 0026 amendment | ≥ the pattern n-floor of posts per account on one platform for a real tenant (`S38-PATTERNS-PER-ACCOUNT`) |
| 8 | Outbound-activity backfill | `docs/ideas.md` §2.7 | its feasibility gate |
| 9 | Founder approval delegation toggle | follow-on | a founder asks to let approvers approve their posts (`S38-FOUNDER-DELEGATION`) |
| 10 | Waiting-on-founder email (new `EmailKind`) | follow-on | in-app wait time on founder posts observed above a threshold with real tenants (`S38-FOUNDER-EMAIL`) |
| 11 | Plus limits drift (50/5 vs 250/25) | founder | founder ruling (existing drift; recorded, not fixed) |
| 12 | `postsPerMonth` / `allowedPlatforms` unenforced at runtime | founder | founder ruling before the Stripe live flip (`S38-PLAN-GATES-UNENFORCED`) |
| 13 | `r_member_social_feed` misnomer in the LinkedIn reason string and ADR 0031 | LinkedIn amendment | the LinkedIn metrics work (row 2) |
| 14 | `brand_voices` RLS without capability check | follow-on | next voice-surface change (`S38-BRAND-VOICE-RLS`) |
| 15 | `campaigns.voice_variation_id` single-column FK (cross-tenant representable) | follow-on | next `campaigns` migration (`S38-CAMPAIGN-VARIATION-FK`) |
| 16 | Similarity exemplars | `docs/ideas.md` §2.5 | Tier 1 closed and a real backfilled corpus |
| 17 | CMA single-product app topology | founder (registration) | before production LinkedIn app registration (§16.1 row) |

**ADRs this one amends, by section:**
- **ADR 0011:** §3.2 (variation columns, RLS), §3.4 (the RPC signature), §8.2 (lifecycle: bind), L-10.
- **ADR 0013:** §5.1 (the transition trigger, INSERT trigger), §5.4 (the callback re-check).
- **ADR 0025:**
  - interpretation note 2 (the role now lives on the account);
  - §4.2 (the founder branch writes the widened voice);
  - §5.2 (the discriminator is now also on the account);
  - §10.3 (ratification no longer asks the role);
  - §13 (the richer-founder-voice row closed).
- **ADR 0028:** §5.3 (targeting closes the dual-identity model), §9.4 (no default badge; role declared), §14 (the Stage-1
  row), §16 items 9 (pairwise, re-verified) and 11 (`r_member_postAnalytics` = CMA).
- **ADR 0031:** §14 row 1 (LinkedIn metrics: same gate).
- **ADR 0010 Amendment 2:** §D2.5 (one row).

### 16.1 Launch-checklist rows owed (the Builder adds them at close-out)

- **§9:** the counsel row of §10.4.
- **§16a, new rows:**
  - *"Community Management API must be the only product on its developer app; decide the production app topology (one
    app vs a verification app) and whether Sign In / Share coexist after Standard approval, before registration; a client
    id change forces every LinkedIn connection to re-authorise."*
  - *"`r_member_postAnalytics` (founder metrics) is a Community Management API permission: same entity gate."*
  - *"`r_member_social` restricted: apply only if LinkedIn historical read is pursued."*
- **Ops row:** *"No inactive founder `social_accounts` row retains vault ids (query in ADR 0032 §5.7)."*

---

## 17. Builder order (prose, no code)

1. **Migration A.**
   - Pre-flight; role column (backfill `brand`, NOT NULL); `connected_by` and `voice_variation_id` with CHECKs.
   - The three supporting UNIQUE constraints.
   - The posts composite FK replacing the old one.
   - The single partial unique index.
   - `campaign_targets` with RLS.
   - The widened variation columns and hardened RLS.
   - The §D2.5 row in the same commit.
2. **Migration B.**
   - The posts INSERT trigger and the extended transition trigger.
   - `pin_post_account`.
   - `upsert_social_account_connection` (with the sweep).
   - The widened `create_voice_variation` (old signature dropped).
   - The member-removal trigger.
   - The user-erasure function.
   - The `ratify_backfill_run` role assertion.
3. **The role module**, state and callback changes.
4. Target plan, generation, promote.
5. `retrieveVoice` and context, all callers.
6. Backfill apply.
7. Disconnect and departure actions.
8. Bulk approve.
9. UI (§11), running the design skills in the order named.
10. Tier 3 diff checks and the callers report.

---

## 18. Amendment R (2026-10-10): the P1 review

**Author and scope.** Written the same day, after a read-only review of §0–§17 against the code at `ae481d295`. Nothing
above this heading was edited, apart from the one-line pointer in the header. Where an earlier section and this one
disagree, **this one wins**; each item names the text it replaces. The review's findings are numbered R-1…R-8 here.

### R-1 — Never revert a claimed post (replaces the `scheduled` arms of §3.5 and §5.7; A-8 → A-8′)

**The defect.** In this codebase `scheduled` is not a future state. It means *claimed by the worker and being published*:
`claim_posts_for_publishing` moves `approved → scheduled` (`20260524230000_publishing_worker.sql:27-41`), and only the
reaper moves it back (`20260525100000:30-33`). `publish_post_complete` completes only `WHERE status = 'scheduled'`
(`20260616210000_publish_complete_rpc.sql:30`) and treats zero rows as a no-op. So a revert of a `scheduled` row to
`draft` while the worker is mid-publish leaves **a live platform post on a `draft` row**. A later approval publishes it a
second time. §5.7's sentence *"already claimed or publishing posts cannot be reverted, because the claim is atomic"* is
contradicted by its own `WHERE status IN ('approved','scheduled')`.

**The rule.** No writer added by this ADR changes the `status` of a `scheduled` row. Reverts touch `approved` only.

**§5.7, the member-removal trigger,** reverts with `WHERE status = 'approved'` (was `IN ('approved','scheduled')`). A
`scheduled` post pinned to the departing founder is left alone. Deactivating the account makes it fail closed: if the
worker has not yet resolved the account, `resolvePublishAccount` re-reads `is_active` and fails it. If it has, it
publishes **at most once** under the founder's earlier approval. That is the window §5.7 already accepts. If the reaper
bounces it to `approved`, the next tick fails it the same way. **A-8 → A-8′:** *approved* founder posts revert to draft;
claimed posts are left to fail closed or complete once.

**§3.5's sweep table, replaced:**

| Unpinned post status | `prior` is brand | `prior` is founder | no `prior` |
|---|---|---|---|
| `draft` | pin to `prior` | pin to `prior` | pin to the new account |
| `approved` | pin to `prior` | pin to `prior` **and** revert to `draft` | new account brand: pin; new account founder: pin **and** revert to `draft` |
| `scheduled` (claimed) | pin to `prior`; **status untouched** | pin to `prior`; **status untouched** | **untouched** |
| `failed`, `published`, `skipped` | untouched | untouched | untouched |

- **`scheduled` rows are pinned to `prior` and their status is never touched.** The claim happened while `prior` was
  the only active account, so `prior` is the account the resolver would have used. Pinning keeps that answer true after
  the second account commits, so the worker does not fail the post as `account_ambiguous` mid-flight. A founder identity
  attached here was already implied at approval time: the founder was the only account then, so the post would have
  published from it.
- **`scheduled` with no `prior`** is a post claimed while the platform had no account. Its resolver call can land after
  the commit and pick the new account by the single-row branch. This window is one worker tick, the same as §5.7's. It is
  **accepted and stated**, not closed.
- The revert cells now say which account the reverted draft is pinned to. It is the account in the same cell (the small
  gap the review noted in §3.5).

**Test (Tier 1, added to §12.1 #5 and #6):** with a `scheduled` row pinned to the founder (departure) and an unpinned
`scheduled` row (sweep, both `prior` cases), the status is still `scheduled` after the write. `publish_post_complete`
then returns the row as `published`.

### R-2 — What the trigger can tell apart (replaces §3.3 rule (ii) and §6.1's fourth row)

**The defect.** The trigger scopes on `current_user`. Inside every SECURITY DEFINER function, `current_user` is the
function owner, so `pin_post_account`, the connect sweep, the member-removal trigger and the publishing functions all
look the same to it. Rule (ii) as written (*"draft only … for raw-client and RPC callers"*) therefore cannot be
implemented. Read literally, it would also refuse the sweep's required pins of `approved` and `scheduled` rows (R-1).

**The contract, restated:**

- **In the trigger, raw clients only** (`current_user IN ('authenticated','anon')`):
  - INSERT with `social_account_id` non-NULL is refused;
  - UPDATE that changes `social_account_id` is refused, **whatever the status**.

  Every other `posts` rule in §6.1 stands unchanged.
- **Draft-only for `pin_post_account` lives in its body**, as §3.3 already lists. It locks the row `FOR UPDATE`, requires
  `status = 'draft'` and `deleted_at IS NULL`, and requires `user_can(post.business_id,'author')` against `auth.uid()`.
  The trigger does not and cannot re-check it.
- **The non-raw writers of `posts.social_account_id` are a closed list**, enforced by diff, not by the trigger:
  - the service-role `createPosts` path (generation);
  - `pin_post_account`;
  - the connect sweep;
  - the FK's `SET NULL`.

  New §12.3 row #9: no other function or `lib/db` path in the diff writes `social_account_id`. The member-removal trigger
  changes only `status` (R-1), never the pin.

**§12.1 #4 changes accordingly:** a raw UPDATE that changes the pin is refused on a `draft` row too, and
`pin_post_account` on an `approved` row is refused **by its body**.

### R-3 — `promote.ts` is decided, not delegated (replaces the "Builder confirms" bullet of §3.3 and the `promote.ts` rows of §3.6 and §3.8)

**The fact.** `promoteDraftToCampaignCore(client, …)` (`lib/campaigns/promote.ts:73`) runs on the **authenticated**
client, on purpose. ADR 0022 A-2 binds its Tier-1 test to a real signed-in client. It creates the campaign (`:99`) and
inserts the post as `draft` (`:116`). It is not moved to service-role: that would break A-2 and put service-role in a
user path.

**The flow, in order:**

1. **Resolve the target first (reads only), before ADR 0022's claim.**
   - The promote action takes an optional `socialAccountId`, Zod-validated.
   - It calls `resolveCampaignTargets` with a one-platform campaign shape and that id as the target. On `missing_target`,
     `target_inactive` or `target_platform_mismatch`, it returns a typed outcome **without claiming**. ADR 0022's
     claim-first rule governs the first *write* and is unchanged.
2. Claim, then create the campaign, then write back. All three are unchanged.
3. **Write the `campaign_targets` row** for the platform when the plan entry is *pinned*. This uses the same
   authenticated client, under §13's `author` RLS.
4. **Insert and pin through one new lib/db helper, `createPinnedDraftAsMember`.**
   - It inserts the draft unpinned. A raw INSERT may not pin (R-2).
   - It then calls `pin_post_account` with the plan's pinned identity and returns the pinned row.
   - The interim "pending pin" state never leaves the helper. It is not a third member of `createPosts`' `identity`
     union, which stays service-role-only.
   - When the plan entry is *unconnected*, the helper inserts the draft and does not pin. The connect sweep covers it
     later (§3.4).
5. **If step 4's pin fails after the insert,** the result is an unpinned draft, which the existing picker repairs. §11.4's
   picker is widened from *"draft legacy unpinned posts on a two-identity platform"* to **any unpinned draft on a
   platform with at least one active account**. Promote is already a multi-step, non-atomic flow under ADR 0022, so this
   adds no new kind of partial state.

**UX (adds to §11).** Studio's promote dialog gains the §11.3 "Publishes from" native `<select>` when the chosen platform
has two active identities. It shows read-only with one identity, and nothing with none. It has the same states, plus the
typed refusal from step 1.

**Callers table (§3.8), the `createPosts` second row, replaced:**

| Function | Production caller | Client | Two-identity test |
|---|---|---|---|
| `createPinnedDraftAsMember` (new) → INSERT then `pin_post_account` | `lib/campaigns/promote.ts` | authenticated → DEFINER | promoted post pinned to the chosen identity; `missing_target` refused **before the claim** (no claimed draft left behind); Tier-1 through the A-2 signed-in client |

### R-4 — Legacy rows can be relabelled (amends §3.1 and §5.3)

**The defect.** Migration A labels every existing row `brand`, including LinkedIn rows that are personal profiles
(`urn:li:person`). Their `connected_by` is NULL. §3.1 lets only the connecting member change a role, and §5.3 keeps the
role on a brand reconnect. So no path can ever relabel them.

**The fix: a row with `connected_by IS NULL` is re-declared by its next connect.** §5.3's decision table gains a row
that applies **before** the brand and founder rows:

| Existing row | Session user | Outcome |
|---|---|---|
| any role, active or inactive, `connected_by IS NULL` | any connect-capable member | **fresh declaration:** the declared role and `connected_by` = the session user are written, subject to the role-change guard below |

Reconnecting is the right path because it proves the member holds the platform credential, which an admin toggle could
not. After that one reconnect `connected_by` is set, and the ordinary rules apply.

**The role-change guard, restated for both paths** (§3.1's path and this one). A role change is refused if either:
- (a) the account has any non-draft post pinned to it (unchanged from §3.1); or
- (b) the account is the platform's **only** active account and any **`approved` or `scheduled` unpinned** post exists
  on that business and platform. Those posts resolve to it today, so relabelling would change who must have approved
  them.

Published unpinned history does not block a change: analytics files it under NULL, not under the account (ADR 0031
§4.4). In the connect RPC, a refused change returns the typed outcome `role_change_blocked` and writes nothing. That code
is added to §5.3 step 8's list and to §11.1's localised banners.

### R-5 — Reactivation sweeps too (amends §3.5)

*"A reconnect of the same row (no new identity) sweeps nothing"* is true only when the row was already active. **The
sweep runs whenever the connect leaves the business with an active account on the platform that was not active a moment
before:** an INSERT, or a reactivation of an inactive row. `prior` is the platform's single other active account
immediately before the connect, or none. Reconnecting a row that was already active sweeps nothing, as before.

**Test (§12.1 #5, new arm):** deactivate the founder row, leave the brand row active, create unpinned posts in every
status, then reconnect the founder. The sweep table is applied with `prior` = brand.

### R-6 — "Founder" is any personal profile at launch: raised as A-10, pending

**The consequence §10.1 does not state.** With the Company Page `coming_soon` (D-8), the only LinkedIn connect action at
launch is the personal profile, so **every LinkedIn connection is founder-role**. Combined with A-4, this means:
- one person per business (§5.6) is the only one who can approve **any** LinkedIn post;
- the owner cannot approve it (§6.2);
- a marketing lead connecting their own profile is shown as "Founder".

For the ICP's teams of 1–100 people, that is a single-approver bottleneck from the first day.

**A-10 is raised, not ruled.** Options:
- **(a)** As written: accept the bottleneck and the label.
- **(b)** Bring §16 row 9's **founder-controlled delegation toggle** into Session 38. It lives on the founder's account,
  defaults to off, and can be set only by the connecting member. When on, it lets `approve` holders approve that
  account's posts. That means one boolean column on `social_accounts` (outside the allowlist) and one more branch in
  §6.1's founder arm.
- **(c)** Keep the data model, but change the user-facing role word from "Founder" to "Personal".

**Recommendation: (b) + (c).** (b) keeps A-4's default and the founder's control, and removes the bottleneck only by the
founder's own choice. (c) costs only i18n. The column name `account_role = 'founder'` is not renamed.

**Gate:** P2 does not apply Migration A until A-10 is ruled, because (b) adds a column to it. Everything else in this
ADR is unaffected by the ruling.

### R-7 — Voice mismatch made visible (amends §3.5 and §11.4)

When the sweep pins a draft to a founder account, the draft was written in the campaign or brand voice. That is the
averaging §4.2 forbids, so it must be shown, not left silent. Nothing is stored for this.
- The post card derives a **voice-mismatch notice** for any post pinned to a founder account whose
  `ai_generation_metadata` voice `source` (§4.6) is not `founder_variation` or `founder_cold_fallback`: *"Written in your
  company voice before this account was connected. Regenerate to use <founder>'s voice."*
- Regenerate already takes the post's target (§4.6).
- A post with no metadata (human-written) shows no notice.

This is added to §11.4's states, and to the en/pt/es parity test.

### R-8 — The member-removal trigger function is SECURITY DEFINER (amends §5.7 and §13.4)

The function writes `social_accounts.is_active`, which `authenticated` cannot update (it is outside the
`20260913120000` allowlist), and it runs on an authenticated `revokeMemberAction`. It is therefore **SECURITY DEFINER**,
not "owner-run". §13.4's row becomes:

| Function | Grant |
|---|---|
| member-removal trigger function | SECURITY DEFINER; `search_path = public, pg_temp`; EXECUTE revoked from PUBLIC, `anon`, `authenticated` (fired only as a trigger) |

Its post revert runs as the owner, so §6.1's raw-client rules do not apply to it. Its writes are fixed by R-1 (only
`approved` rows revert, and only `status` changes) and named in R-2's closed list. FOUNDER-DEFINER-AUDIT (#48) covers it
with a live-grant assertion.

### R-9 — Housekeeping

- **§8** is an intentionally empty heading kept for numbering. It stays, so §9–§17 citations elsewhere remain valid.
- **The `CLAUDE.md` working-tree edits** (the design-skills table) are unrelated to Session 38. They are committed
  separately, never inside a P2 commit: §12.3 #8 is checked against the Builder's diff.

### Constraint changes

| # | Constraint | Tier | Proof | Note |
|---|---|---|---|---|
| 4 | IDENTITY-PIN-DRAFT-ONLY | 1 | `pin_post_account` on `approved` refused **by its body** (R-2) | proof re-homed; name kept |
| 26 | FOUNDER-DEPARTURE-HANDLED (A-8′) | 1 + 2 | 12.1 #6 with the `scheduled`-untouched arm (R-1) | amended |
| 48 | FOUNDER-DEFINER-AUDIT | 1 | adds the member-removal function (R-8) | amended |
| 49 | IDENTITY-REVERT-SKIPS-CLAIMED | 1 | R-1 test: sweep and departure leave `scheduled` status untouched; completion still succeeds | new |
| 50 | IDENTITY-PIN-WRITERS-CLOSED | 3 | §12.3 #9 (R-2) | new |
| 51 | IDENTITY-PROMOTE-PINNED | 1 + 2 | R-3: promoted draft pinned through the A-2 signed-in client; `missing_target` refused before the claim | new |
| 52 | IDENTITY-REACTIVATION-SWEEPS | 1 | R-5 test | new |
| 53 | IDENTITY-LEGACY-ROLE-REDECLARED | 1 | R-4: a `connected_by IS NULL` row re-declared on reconnect; guard (b) refuses with `role_change_blocked` | new |
| 54 | FOUNDER-VOICE-MISMATCH-SHOWN | 2 | R-7 notice derivation, all three cases | new |

**ADR 0032's total after Amendment R: 54 constraints.** Builder order (§17) is unchanged, except:
- `createPinnedDraftAsMember` and the promote dialog join step 4;
- Migration A waits on A-10.

---

## 19. Amendment A-10 (2026-10-10): delegation and the "Personal" label

**Ruling.** The founder approved A-10 as recommended in §18 R-6: **(b) + (c)**. This section fixes the contract the
build guide's precondition requires, so that the Builder transcribes it rather than designing it. Nothing above this
heading was edited, apart from the header pointer. Where this section and an earlier one disagree, this one wins.

### 19.1 (b) The founder delegation toggle

**What it does.** A founder may let the business's approvers approve posts pinned to the founder's own account. It is
**off by default** and **only the founder can turn it on**. A-4 stays the default; the bottleneck is lifted only by the
founder's choice. §16 row 9 (`S38-FOUNDER-DELEGATION`) is **closed by this section**, not deferred.

**Column.** `social_accounts.approval_delegated boolean NOT NULL DEFAULT false`, with a named CHECK
`approval_delegated = false OR account_role = 'founder'`. It lands in Migration A. It is **outside** the authenticated
UPDATE allowlist (§5.2), like the other three new columns.

**The one writer: `set_founder_approval_delegation(p_account_id uuid, p_enabled boolean)`.**
- SECURITY DEFINER, `SET search_path = public, pg_temp`, REVOKE from PUBLIC and `anon`, GRANT EXECUTE to
  `authenticated` only. It joins §13.4's table and FOUNDER-DEFINER-AUDIT (#48).
- It locks the account row `FOR UPDATE` and requires:
  - `account_role = 'founder'`;
  - `is_active`;
  - `connected_by IS NOT NULL AND connected_by = auth.uid()`;
  - the caller is still an active member of the account's business.
- **An admin or owner cannot set it.** The decision belongs to the founder whose name the posts carry, for the same
  reason an admin cannot declare someone else's account `founder` (§3.1).
- It is reached through a `lib/db/social-accounts.ts` wrapper, called by a Zod-validated Server Action.
- **Loser:** a service-role setter that checks the connector in the app. The identity check belongs in the database,
  next to `auth.uid()`, where an app bug cannot skip it.

**Reset to `false`, written by the connect RPC (§5.3):**
- on every **fresh declaration** (R-4's `connected_by IS NULL` row, and §5.3's departed-founder row), so a new person
  never inherits someone else's consent;
- on any change of role away from `founder`, which the CHECK requires anyway.

A same-founder reconnect keeps the value.

**The trigger branch (amends §6.1's founder arm).** Entry into `approved` or `scheduled` on a founder-pinned post
requires `user_can(business,'approve')`, which is unchanged. It also requires **either**:
- `auth.uid() IS NOT DISTINCT FROM connected_by` with `connected_by` NOT NULL; **or**
- `approval_delegated = true`.

**A NULL `connected_by` is still approvable by nobody**: a delegated account always has a connector, because the
setter requires one and reset follows re-declaration.

**Bulk approve (amends §6.4).** The founder filter inside the UPDATE's WHERE excludes a founder-pinned row unless
`connected_by = auth.uid()` **or** `approval_delegated`. The typed retry also covers delegation being switched off
between render and submit.

**Waiting on the founder (amends §6.5).** The derived state needs `approval_delegated = false`. When delegation is on,
the post is approvable by any approver and shows no waiting badge.

**Switching it off.** Posts already approved under delegation **stay approved**: they were legitimately approved.
Switching off affects only future approvals. The founder can still unapprove (§6.2 keeps unapprove at `author`). This
is stated, not hidden: the toggle's help text says so.

**Departure.** The departure trigger (§5.7) deactivates the account, so the value is moot. If the row is later
re-declared, it resets to `false` (above).

### 19.2 (c) The user-facing word is "Personal"

- In every user-facing string, the founder role reads **"Personal"** (en), **"Pessoal"** (pt), **"Personal"** (es).
  This covers role badges, "From <name> · Personal", the connect choice, filters, notices and the voice editor's
  heading ("Your personal voice").
- The brand role keeps **"Company"** / **"Empresa"** / **"Empresa"**.
- **Nothing else is renamed.** The column value stays `'founder'`; constraint names (`FOUNDER-*`), types,
  `ACCOUNT_ROLES`, `source` values (`founder_variation`, `founder_cold_fallback`), test titles and code identifiers are
  unchanged. "Founder" stays the internal term and appears in no user-visible string.
- **Why:** at launch every LinkedIn connection is a personal profile (§18 R-6), and a marketing lead's profile is not
  a founder's. The label describes the account, not the person's title.
- **Loser:** renaming the column and the constraints. That would churn every ADR and test name for a word users never
  see.
- §11's copy that says "Founder" (§11.1 role badge, "Connect your personal profile", §11.4 "From <name> ·
  <Company|Founder>") is read with "Personal" in place of "Founder" from this section on.

### 19.3 Constraint changes

| # | Constraint | Tier | Proof | Note |
|---|---|---|---|---|
| 37 | FOUNDER-APPROVAL-ENFORCED-IN-DB (A-4) | 1 | 12.1 #4 founder arms **plus**: with `approval_delegated = true` another approver succeeds; with it false they are refused | amended |
| 38 | FOUNDER-BULK-APPROVE-CALLERS | 1 + 2 | adds a delegated row to the mixed set | amended |
| 48 | FOUNDER-DEFINER-AUDIT | 1 | adds `set_founder_approval_delegation` (`authenticated`) | amended |
| 55 | FOUNDER-DELEGATION-FOUNDER-CONTROLLED | 1 + 2 | Tier 1: default false; the brand CHECK; the setter refused for an admin, the owner, another approver, an inactive account and a NULL connector, and allowed for the connector; reset to false on fresh declaration; a same-founder reconnect keeps it. Tier 2: the toggle rendered only to the connector; the action's Zod; the help text | new |
| 56 | FOUNDER-PERSONAL-LABEL | 2 | no en/pt/es string value under the touched namespaces contains "Founder" / "Fundador" / "Fundador(a)" as the role word; the role word maps through one function from `AccountRole` | new |

**ADR 0032's total after Amendment A-10: 56 constraints.**

**Builder order (§17) additions:**
- the column in Migration A;
- the setter and the trigger branch with Migration B1;
- the connect-RPC reset with Migration B2;
- the toggle and the label in the UI step.

_End ADR 0032._
