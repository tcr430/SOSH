# Session 38 — Founder and personal profiles: the founder identity made first-class (ADR 0032) · Track P

> **Goal:** ship **T1-E** (`docs/pre-launch-scope.md` §4, §12.2). A founder's personal LinkedIn or X
> profile is connected **as an account belonging to the business workspace**. It is **targeted
> deliberately**: a post knows which identity it publishes from, chosen before approval and never guessed.
> It is generated in a **distinct founder voice** through the existing ADR 0011 variation machinery,
> widened so that the voice is more than seven sliders. The **approval gate is unchanged**, and §12.2 is
> explicit that *"a founder's personal account is more sensitive, not less, so nothing about
> human-in-the-loop relaxes."*
>
> **Much of the account model already exists, and this session must not rebuild it.** ADR 0028 (Session
> 30.5, founder ruling A-6) shipped the **dual-identity model**: two rows per platform on
> `social_accounts`, `posts.social_account_id`, `resolvePublishAccount` and a two-identity accounts surface
> (Reality §1). What it did **not** ship is everything that makes a second identity usable (Reality §2–§7).
> Nothing sets `posts.social_account_id`. Campaigns target platforms, not accounts. A connection does not
> record whether it is the brand or the founder. The founder voice is stored as axes only and bound to
> campaigns, not accounts. Nobody records who connected an account. **The result today:** a business that
> connects a second X account gets every unpinned X post failed as `account_ambiguous`, and the copy tells
> the user to *"pick which one this post publishes from"* through a picker that does not exist.
>
> **What this session does NOT ship, explicitly (§12.2 and L-1):** **multi-founder workspaces**;
> **per-person seats mapped to personal accounts** beyond what ADR 0013/0014 already give; *"anything
> resembling posting as a person who has not personally connected their own account"*; **LinkedIn Company
> Page posting** (it stays `coming_soon` behind the legal-entity and Community Management API gate, ADR 0028
> A-8 / A-9′, `launch-checklist.md` §16a, and no ruling here can lift it); **any OAuth scope that requires
> platform review** (L-8 ⚑); **LinkedIn metrics or LinkedIn historical read** (both review-gated, Reality
> §11); **personal profiles on Instagram, Facebook or Threads**; **the engagement inbox** (T1-A, Session 40);
> **carousels** (T1-C, Session 39); **outbound-activity backfill** (`docs/ideas.md` §2.7); **voice exemplars
> by similarity** (`ideas.md` §2.5, which waits behind Sessions 37–40 per `pre-launch-scope.md` §15.2).
>
> **Prerequisite, absolute.** Session 38 does not begin until Session 37 has closed **and merged to
> `master`**. That is satisfied: PR #20 merged as `841b3b08` on top of the Session 37-D close
> (`ae481d29`). **Soft prerequisites, both still open:** **no production OAuth app is registered** with
> LinkedIn or X (`docs/current-phase.md`, `launch-checklist.md` §16a), so no real founder has connected
> anything. And `S34-E2E-UNVERIFIED` / `S36-UX-UNVERIFIED-IN-BROWSER` (`docs/backlog.md`) are still open.
> **This session's verified scope table (Q6) is an input to production app registration, so it must be
> done from current vendor documentation, dated, and not from memory.**

---

## Reality check — to be re-verified against the live repo before the Architect runs

> Read at `origin/master` `841b3b08` (the PR #20 merge), 2026-10-10. **If any item has changed, correct this
> file before the Architect runs.**

1. **The dual-identity model shipped in Session 30.5, and its plumbing is not this session's to rebuild.**
   ADR 0028 §5.3 (founder ruling A-6): *"A client connects **both** a personal founder profile and a
   business page."* `social_accounts` has `UNIQUE (business_id, platform, platform_user_id)`
   (`supabase/migrations/20260430120006_social_accounts.sql:26`), which admits two rows per platform.
   `posts.social_account_id` is a nullable FK with `ON DELETE SET NULL`
   (`20260904100000_posts_social_account_id.sql:21-27`): *"disconnecting a social account must never delete a
   business's published post history."* `resolvePublishAccount` (`lib/db/social-accounts.ts:203-220`) takes
   the pinned account if there is one, otherwise the single active row, and otherwise fails. Its comment
   reads: *"publishing (or syncing metrics for) the wrong identity is worse than not doing so at all."* It has
   **two production callers**, `lib/publishing/orchestrator.ts:107` and `lib/metrics/orchestrator.ts:67`, and
   `listActiveByBusinessAndPlatform` has a third, `app/api/social/[platform]/disconnect/route.ts:57`. **Q1
   builds on these. SHARED-FUNCTION CALLERS applies to all three.**

2. **Nothing writes `posts.social_account_id`.** A grep across `app/`, `lib/` and `components/` (tests
   excluded) finds only readers: the two orchestrators, analytics (`lib/analytics/load.ts:297-612`) and
   backfill. `PostUpdate` excludes the column as tenancy-critical (`lib/db/types.ts:384`), so the ordinary
   update path cannot set it either. **So with two active accounts on one platform, every unpinned post
   resolves `ambiguous`** and is failed with `TOKEN_REVOKED` / `reason: 'account_ambiguous'`
   (`components/posts/PostCard.tsx:191-196`). The user sees *"Two accounts connected — pick which one this
   post publishes from"* (`i18n/en/posts.json:67`), and **no picker exists**. **This is the core defect T1-E
   closes. Q1 decides who sets the column, when, and through which dedicated path.**

3. **Campaigns and posts are platform-shaped, not account-shaped.** `CampaignRow.platforms: Platform[]`
   (`lib/db/types.ts:271`), and the posts header comment reads *"one row per (campaign, platform)"*
   (`20260430120010_posts.sql:3`). A campaign today cannot say "the founder's X", and it cannot target the
   brand's X and the founder's X at once. **Q1 decides whether targeting lives on the campaign, the post or
   both, and what "one row per (campaign, platform)" becomes.**

4. **On LinkedIn, every connection today is already a personal profile.** The scopes are
   `['openid', 'profile', 'email', 'w_member_social']` (`lib/social/platforms/config.ts:26`), and the
   identity is `urn:li:person:{sub}` (`lib/social/linkedin-provider.ts:183`). Organization posting is deferred
   by ADR 0028 A-8, because `w_organization_social` needs a registered legal entity. The founder ruled
   (A-9′, ADR 0028 §16 item 1): *"I want to ship with both account types."* The Company Page renders
   `coming_soon` while the external gate holds. **So at launch the founder identity is the only LinkedIn
   identity that works.** A person URN does not prove that the person is *the founder*, because a
   marketing lead's personal profile is also `urn:li:person:`. **Q1 must not derive "founder" from the URN
   prefix.** `isOrganizationAuthorUrn` (`linkedin-provider.ts:90-96`) answers person-or-page, a different
   question.

5. **The brand/founder distinction exists, but only on the backfill run, never on the connection.**
   `social_backfill_runs.account_role text NULL CHECK (account_role IN ('brand','founder'))`
   (`20260913130000_social_backfill_runs_and_posts.sql:24`), set at ratification
   (`lib/db/backfill-runs.ts:374-383`). ADR 0025's interpretation note 2 (`0025-social-read-path-and-backfill.md:55-58`):
   *"Which account is 'brand' and which is 'founder' (L-11) cannot be derived for X ... The founder
   **declares it once, at ratification** ... recorded on the run row — not on `social_accounts`."* ADR 0028
   §5.1 rejected a `platform_account_type` column for **person vs. organization**, and that is a different
   axis from **brand vs. founder**. **Q1 decides where the role is persisted, and whether the backfill's
   `account_role` is migrated, mirrored or left alone.**

6. **The founder voice is seven sliders, bound to campaigns, and its widening was explicitly deferred to
   this session.** `brand_voice_variations` holds `name` and `voice_axes` only
   (`20260623210000_voice_axes.sql:47-78`), with a cap of 5 per business enforced by
   `create_voice_variation` (`:119` onward, *"voice_variation_cap_reached"*). It is bound through
   `campaigns.voice_variation_id` (`:105-109`), not through any account. `retrieveVoice` overrides **only
   the axes** (`lib/memory/voice.ts:22-36`), so tone, keywords, avoid-words and writing examples always come
   from the brand. ADR 0025 §4.2 (`:361-370`): *"a founder voice is applied as axes only, and the synthesised
   tone, keywords, avoid-words and examples for a founder account are not persisted."* ADR 0025 §13 deferral
   row: *"Richer founder voice (`tone`, `keywords`, `avoid_words`, examples on `brand_voice_variations`) |
   T1-E founder-profile work | an ADR 0011 amendment."* **Q2 owns this. `MEM-VOICE-THROUGH-EXISTING` binds
   it (L-4).**

7. **Nobody records who connected an account, so "personally connected" is not enforceable today.**
   `social_accounts` has no user column (`20260430120006_social_accounts.sql:11-27`, plus `scopes_granted`).
   The OAuth state JWT carries only `businessId`, `platform`, `nonce` and `locale`
   (`lib/social/oauth/state.ts:31`). The callback upserts through the service-role client
   (`app/api/social/[platform]/callback/route.ts:137-163`) with `onConflict:
   'business_id,platform,platform_user_id'`, so **a reconnect by a different member silently overwrites the
   tokens of an existing row**. Connect is gated by `user_can(business_id, 'connect_accounts')`
   (`connect/route.ts:42-46`), which means *approver or admin*
   (`20260702120200_user_can.sql:38`). Authenticated UPDATE on `social_accounts` is a **column allowlist**
   (`20260913120000_social_accounts_identity_lock.sql:58-65`): *"A column added later is NOT updatable by
   `authenticated` until it is explicitly added here — fail-closed by construction."* **Q3 decides
   ownership, and any new column inherits this lock.**

8. **Approval is a role, not a person.** Granting `approved` requires `user_can(..., 'approve')`, which
   is the `approver` role only (`20260702120300_posts_role_aware_and_status_trigger.sql:54-57`;
   `user_can.sql:37`). The owner is always approver and admin (`user_can.sql:20-22`). **Any approver can
   approve a post that publishes from the founder's personal account.** Bulk approval is a shared action
   with three files involved: `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts`, and the callers
   `ApprovalsInbox.tsx` and `PostsClient.tsx`. That is the `APV-BULK` precedent, where one caller went
   unaudited for three sessions. **Q4 decides whether founder-account approval is narrowed. SHARED-FUNCTION
   CALLERS applies.**

9. **Plans gate platforms, not accounts, and the code's Plus limits disagree with the constitution.**
   `PlanCapabilities.allowedPlatforms` (`lib/stripe/plan.ts:16`) is `['linkedin','twitter']` for trial and
   Plus (`:23`, `:49`, `:60`), and there is no per-account cap anywhere. Separately, Plus is coded
   `postsPerMonth: 50, activeCampaigns: 5` (`plan.ts:57-58`), while `CLAUDE.md` says *"250 posts/month, 25
   active campaigns"*. **That drift is not this session's to fix.** Q7 must state which number a founder
   account's posts count against, and record the drift as a finding. The trial clock starts on the first
   `social_accounts` row of any kind (`20260430120008_social_accounts_trial_trigger.sql`), founder accounts
   included.

10. **Memory has no account scope.** `MemoryScope = 'brand' | 'campaign' | 'platform' | 'contact'`
    (`lib/db/types.ts:1220`), and `RetrieveScope` is `{ campaignId?, confidenceFloor? }`
    (`lib/memory/scoring.ts:18-23`; ADR 0030 narrowed it, and an unconsumed field is a violation,
    `SUBSTRATE-QUERY-FIELD-CONSUMED`). A founder's backfilled posts land in business-level memory beside the
    brand's. **Q5 decides whether the founder's opinions and first-person stories may condition brand-page
    generation, and whether an account dimension is added. If added, it must be consumed by a scoring
    term.**

11. **The platform scope reality, as recorded, and it is a claim to re-verify rather than a fact to
    trust.** LinkedIn historical read needs `r_member_social`, which is review-gated
    (`historicalReadAvailable = false`, `linkedin-provider.ts:109`). LinkedIn metrics need
    `r_member_social_feed`, which is *"Restricted"* (`:343-357`). `r_member_postAnalytics` is review-gated
    (ADR 0028 §16 item 11). ADR 0031 deferred LinkedIn engagement metrics to *"**Session 38** OAuth scope
    review (T1-E)"* (`0031-analytics-and-monthly-report.md:1149`). X needs no scope change for a second,
    personal account: `tweet.read tweet.write users.read offline.access` (`config.ts:34`). **Scopes are baked
    into a token at authorisation** (ADR 0028 §14.1, §16 item 7), so a scope added after customers connect
    forces every one of them to re-authorise. **Q6 produces the dated, verified per-platform, per-identity
    scope table that production app registration will be done against.**

12. **Analytics is already account-sliceable and treats NULL honestly.** `lib/analytics/load.ts:46`:
    *"ACCOUNTS: grouped by posts.social_account_id. NULL is its own labelled bucket and is never resolved to
    a default."* ADR 0031 §4.4 (`:456-463`) warned that defaulting *"would misattribute posts once Session 38"*
    lands. **Q1's targeting must leave every newly created post with a non-NULL account, so that the NULL
    bucket shrinks to legacy rows only. No analytics code change is expected. If one is needed, the
    analytics loaders join SHARED-FUNCTION CALLERS.**

13. **Tenancy has the known array trap.** `get_user_business_ids()` returns an array, so for a user in two
    businesses RLS alone does not isolate one from the other. `.eq('business_id', …)` is the boundary
    (cerebrum, Session 34 K1; ADR 0030 §7). `resolvePublishAccount` is called with the service-role client
    and checks `business_id` and `platform` itself (`SOCIAL-PINNED-ACCOUNT-TENANT-CHECKED`,
    `social-accounts.ts:197-202`). **Any new setter of `posts.social_account_id` must re-check that the
    account belongs to the post's business and platform. A pinned account from business B on a post of
    business A is the cross-tenant publish to design against.**

---

## §0 — Locked decisions (binding input — derived from existing rulings; ⚑ items awaiting founder confirmation)

These are decided. The Architect (P1) **encodes** them in ADR 0032 and names their losers. It does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong: flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**.

**Where these come from.** Unmarked items restate rulings that already exist: `pre-launch-scope.md` §12.2
(T1-E's scope and exclusions), ADR 0028 §5.3 and A-8 / A-9′, ADR 0025 L-11 and §13, ADR 0016's
`MEM-VOICE-THROUGH-EXISTING`, and the constitution's human-in-the-loop, Vault and tenancy rules. **Items
marked ⚑ are this guide's proposals.** They follow the nearest precedent, but no founder has ruled on them
yet. **The founder confirms or revises each ⚑ item before §1a is pasted.** A revision is recorded with a
prime (`L-5` → `L-5′`), and the original stays visible.

**Locked (L):**

- **L-1 — Session 38 makes the founder identity usable end to end, and builds nothing beside it.**
  *In scope:* a persisted brand/founder role on a connection; **deliberate account targeting**, with the
  dedicated, tenant-checked path that sets `posts.social_account_id`, so that no newly generated post on a
  two-identity platform is left unpinned; binding a founder voice to the founder account and **widening
  `brand_voice_variations`** per ADR 0025 §13 (an ADR 0011 amendment); recording who connected an account,
  and the personally-connected rule; the approval semantics for founder-account posts; the backfill's
  founder path writing into the widened variation; plan and trial accounting for a founder account; the
  verified OAuth scope table (Q6); the accounts, campaign and post UI this needs, in en/pt/es; and the
  counsel question, written into the ADR. *Out of scope, explicitly:* **multi-founder workspaces**; **seats
  mapped to personal accounts beyond ADR 0013/0014**; **connecting a personal account on someone else's
  behalf**; **LinkedIn Company Page posting** (A-8 holds); **any review-gated scope** (L-8 ⚑);
  **LinkedIn metrics and historical read**; **Instagram / Facebook / Threads personal profiles**; **the
  inbox, carousels, image generation**; **outbound-activity backfill**; **embeddings or similarity
  exemplars**; **any change to `resolvePublishAccount`'s fail-closed contract** (L-3); **fixing the Plus
  limits drift** (Reality §9: it is recorded, not fixed); and **editing `CLAUDE.md`, the pricing page or
  any `content/legal/*.mdx`**. If a step appears to need any of these, **STOP and report**.

- **L-2 — Human-in-the-loop does not relax for a founder account. If anything, it tightens.** §12.2
  verbatim: *"a founder's personal account is more sensitive, not less, so nothing about human-in-the-loop
  relaxes."* No founder-account post publishes without a fresh `draft → approved` transition. No
  auto-approve, not even when the founder wrote the brief or answered the interview the post came from.
  Loser: *"founder posts auto-approve because the founder is the author."* The founder is the author of
  the **input**, never of the generated text, and §15 of `ai-quality-track-ideas-and-build-path.md` puts
  publishing in the irreversible row, *"gated, permanently."* **Whether approval narrows further, to the
  founder only, is Q4 and a founder adjudication.** It is never a loosening.

- **L-3 — Publishing as the wrong identity is worse than not publishing (ADR 0028 §5.3), and the resolver
  stays fail-closed.** `resolvePublishAccount`'s order and its `ambiguous → failure` outcome are unchanged.
  This session removes the *cause* of ambiguity, which is unpinned posts. It does not add a fallback.
  Loser: a "most recently connected wins" default, or a business-level default-account setting that the
  resolver falls back to. Either turns a missing decision into a silent publish under someone's personal
  name. A pinned account that is inactive, or that belongs to another business or platform, still resolves
  `none` (`SOCIAL-PINNED-ACCOUNT-TENANT-CHECKED`).

- **L-4 — The founder voice lives in the existing voice stores (`MEM-VOICE-THROUGH-EXISTING`), and the two
  voices never average (ADR 0025 L-11).** The founder voice is a `brand_voice_variations` row, widened by
  an ADR 0011 amendment so that it can carry what ADR 0025 §4.2 had to drop (tone, keywords, avoid-words,
  writing examples). Loser: a `founder_voices` table or a voice memory table. ADR 0016 forbids both by
  design, and both would give generation a second voice-resolution path. `retrieveVoice` remains the
  **sole** implementation of voice resolution (`lib/memory/voice.ts:15-21`).

- **L-5 ⚑ — A personal account is connected only by the person it belongs to, and that person is recorded
  server-side.** The connecting member's user id is taken from the authenticated session at the connect
  step, carried through the signed OAuth state, written by the callback, and **never** taken from client
  input. It is not updatable by `authenticated` (Reality §7's allowlist). A founder-role account is bound to
  that member. A reconnect by a **different** member does not silently take over an existing founder row.
  Loser: an admin connecting the founder's account with the founder's credentials. That is the *"posting
  as a person who has not personally connected their own account"* §12.2 excludes, and credential sharing
  is what the rule exists to stop. **The honest limit:** OAuth cannot prove which human typed the password.
  The rule binds the account to a **member's session**, and the ADR says so instead of claiming more.

- **L-6 ⚑ — At most one founder-role account per platform per business.** §12.2 puts multi-founder
  workspaces out of scope. Loser: N founder accounts per platform. Each one needs its own voice, its own
  owner and its own approval story, and that is the multi-founder workspace by another name. A second
  founder on the same platform is a STOP, not a variant.

- **L-7 — Token, Vault and disconnect obligations are unchanged.** Tokens live only in Vault. Disconnect
  remains the three-step GDPR sequence: `is_active = false`, null the vault id columns, delete the vault
  secrets. Posts survive a disconnect with `social_account_id` cleared (`ON DELETE SET NULL`). A founder
  account's disconnect is reachable by the founder and by an admin (an admin must be able to stop a
  compromised or departed founder's account publishing). Q3 states the exact authority.

- **L-8 ⚑ — No review-gated OAuth scope is requested in this session.** The Architect produces the
  verified scope table (Q6) and names any platform application (for example `r_member_social`) as a
  **launch-checklist row and a founder action**, not as code. Loser: adding a review-gated scope now.
  ADR 0028 §5.3's logic holds, *"an app cannot request an ungranted scope, so adding it now would break the
  authorize URL rather than future-proof it."* If Q6 finds a **non-review** scope that the founder identity
  needs before registration, it is flagged for founder adjudication, because adding it changes every
  connection's consent screen.

- **L-9 — GDPR, tenancy and RLS obligations in full.** Any new column on `social_accounts`,
  `brand_voice_variations` or `posts`, and any new table, follows the house form: RLS in the InitPlan-wrapped
  form, **`USING` and `WITH CHECK`** on every UPDATE, `ON DELETE CASCADE` (or an argued `SET NULL`) from
  its parent, **a row in ADR 0010 Amendment 2 §D2.5's cascade table in the same commit as the migration, or
  an explicit note that no new row is required** (the Session 28-D D7 precedent), and `purge_business`
  coverage. A user id column on `social_accounts` needs an argued `ON DELETE` behaviour for `auth.users`
  and for member removal. Every setter of a tenancy-critical column is a service-role worker or a
  `SECURITY DEFINER` RPC that re-checks business scoping. Every new function passes the standing A-8
  SECURITY DEFINER audit gate.

- **L-10 — Contract discipline and constitution rules, inherited by every step.** Provider code only
  under `lib/social/`, consumed via `lib/social/index.ts`; Anthropic SDK only via `lib/ai/`, with a
  `CustomerContext`; DB only via `lib/db/`; memory only via `lib/memory/`; Zod on every Server Action and
  route; every list query **bounded, with an explicit `ORDER BY`** on an existing index; date-fns; **no
  `any`**; **no `console.*`** beyond the single canonical worker line; env only via `lib/config.ts`;
  service-role never in a user-facing read; **i18n en/pt/es simultaneously**; Server Components by
  default; shadcn v4 / Base UI (**no `asChild`**); native `<select>` for static options; and
  **SHARED-FUNCTION CALLERS** for every existing function touched (Reality §1, §8, §12).

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | Account model | **reuse ADR 0028's dual identity**: rows on `social_accounts`, `posts.social_account_id`, `resolvePublishAccount` | a `founder_profiles` table (a second identity store beside the one that publishes); a separate "personal workspace" per founder (that is the multi-founder workspace, which is out, §12.2) |
| D-2 | Ambiguity handling | **remove its cause (unpinned posts); the resolver stays fail-closed (L-3)** | a resolver fallback to the newest or a "default" account (a silent publish under a person's name); auto-pinning at publish time (the decision would be made after approval, not before) |
| D-3 | Founder voice store | **the existing `brand_voice_variations`, widened by an ADR 0011 amendment (L-4)** | a founder voice table (forbidden by `MEM-VOICE-THROUGH-EXISTING`); leaving it at axes only (ADR 0025 §13 deferred exactly this widening to T1-E) |
| D-4 ⚑ | Who connects a personal account | **the person, bound to their member session, recorded server-side (L-5)** | an admin on the founder's behalf (credential sharing, excluded by §12.2); no record at all (today's state, Reality §7) |
| D-5 ⚑ | Founder accounts per platform | **at most one (L-6)** | unlimited (the multi-founder workspace by another name) |
| D-6 ⚑ | OAuth scopes | **no review-gated scope; a verified table plus launch-checklist rows (L-8)** | requesting `r_member_social` now (breaks the authorize URL until granted); silently widening scopes (forces every connected user to re-authorise) |
| D-7 | Human-in-the-loop | **unchanged or tighter, never looser (L-2)** | auto-approval of founder posts (publishing is the irreversible row, permanently) |
| D-8 | LinkedIn Company Page | **stays `coming_soon` behind A-8 / A-9′** | building org posting here (an external gate no ruling can lift; ADR 0028 §16 item 1) |

---

## §0.1 — Questions the Architect (P1) must resolve IN the ADR (BINDING)

**P1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (ADR 0015
§2). Ground every answer in the real seams. Let the single `ecc:code-explorer` sweep map them and cite
`file:line`.

- **Q1 — Account identity and targeting: how every new post comes to know which identity it publishes
  from (the load-bearing question).** (a) **Where the brand/founder role is persisted.** Options include a
  column on `social_accounts`, the backfill's `account_role` promoted or mirrored, or something else.
  Argue the loser against ADR 0028 §5.1 (which rejected a person/organization column, a different axis,
  Reality §5) and against Reality §4 (a person URN is not a founder). State what the role is for an account
  that has none yet (legacy rows, a single-account business), and who may set or change it. (b) **Where
  targeting lives**: on the campaign (`platforms: Platform[]` becomes accounts), on each post, or both, with
  the precedence rule. Say what *"one row per (campaign, platform)"* (Reality §3) becomes. Can one campaign
  produce posts for the brand X and the founder X, and if so, how many posts? (c) **The setter of
  `posts.social_account_id`** (Reality §2): which function, which client, at which moment (generation,
  creation or before approval), and the re-check that the account belongs to the post's business and
  platform (Reality §13). `PostUpdate` excludes the column, so the setter is a dedicated path, and the ADR
  names it. (d) **The single-account business**: does it get auto-pinned, or stay NULL and resolve through
  the single-row branch? Argue it against ADR 0031's NULL bucket (Reality §12) and against L-3. (e) **What
  happens to existing unpinned drafts** when a second account is connected. (f) **The callers table**:
  every caller of `resolvePublishAccount`, `listActiveByBusinessAndPlatform`, the post-creation writer(s) in
  `lib/db/posts.ts`, and `lib/campaigns/generate.ts`, each with the test that will cover two-identity
  behaviour. ADR 0028 §5.3 recorded all three as *"`AUTHORED-NOT-EXECUTED` for two-identity behaviour."*

- **Q2 — The founder voice: binding, precedence and the ADR 0011 widening.** (a) **Binding**: how a
  variation attaches to a founder account (a column on `social_accounts`, a column on the variation, or
  another seam), and what happens on disconnect. (b) **Precedence** when a post targets the founder
  account and its campaign also names a `voice_variation_id`: which voice wins, and why. (c) **The
  widening**: which of `tone`, `keywords`, `avoid_words` and `writing_examples` the variation gains, the
  cardinality caps (`brand_voices.writing_examples` is `<= 3`), and how `retrieveVoice` merges a variation
  with the brand. Does a founder variation **replace** the brand's keywords and avoid-words, or **add** to
  them? (`retrieveVoice` stays the sole resolver, L-4.) (d) **The 5-variation cap**
  (`create_voice_variation`): does a founder variation count against it? (e) **The backfill path**: ADR
  0025 §4.2's founder branch, which applies axes only today. What it writes after the widening, through
  which existing path, and whether runs already ratified as founder are revisited (they cannot be, if
  their synthesis was never persisted; say so). (f) **The cold founder**: a founder account with no
  variation yet. Does generation block, fall back to the brand voice with a visible notice, or prompt a
  voice step? (g) The `CustomerContext` shape change, if any, and its callers.

- **Q3 — Ownership: who connects, who owns, who may disconnect, and what happens when the person leaves.**
  (a) The recorded connecting member (L-5 ⚑): the column, how it travels through the OAuth state (Reality
  §7: the state carries no user today) without being forgeable, and its place in the authenticated-UPDATE
  allowlist (it is **not** added). (b) **The capability**: `connect_accounts` is approver-or-admin. Can an
  `editor` founder connect their own profile? Argue whether a self-connect needs a narrower or a different
  capability. (c) **The reconnect race**: the callback's upsert overwrites tokens on conflict. State what
  happens when member B completes OAuth for a founder row owned by member A. (d) **Disconnect authority**
  (L-7): the founder, an admin, both? (e) **The departing founder**: on member removal
  (`purge_business_member_delete` and the member lifecycle) and on `auth.users` deletion, what happens to
  the account, its tokens, its scheduled and approved posts, and its voice. Name the GDPR position: whose
  personal data is the founder's personal profile, and who is the controller for posts already published?
  (f) The one-founder-per-platform rule (L-6 ⚑): where it is enforced. A partial unique index is the
  obvious candidate; argue it.

- **Q4 — Approval semantics for founder-account posts.** Is approval of a post that publishes from a
  founder's personal account **restricted to that founder**, open to any approver as today (Reality §8), or
  configurable by the founder? This is always flagged for founder adjudication. P1 recommends and the
  founder rules. If narrowed: where it is enforced. The DB trigger on `posts` is the only enforcement that
  survives a bypassed UI. Also say what happens to bulk approval (`bulkApprovePostsAction` **and both of its
  callers**, `ApprovalsInbox.tsx` and `PostsClient.tsx`, the `APV-BULK` lesson), to the approvals inbox's
  filtering, and to a founder who is an `editor`. What does the founder see for a post that is waiting on
  them? Notification: none, in-app, or an email kind? A new `EmailKind` is a CHECK widening and is argued.

- **Q5 — Memory and backfill scope: does the founder's voice leak into the brand page, or the brand's into
  the founder's?** (a) Whether founder-account backfill (ADR 0025) writes into business-level
  brand/evidence/audience/performance memory, and with what provenance, so that founder-earned memory stays
  distinguishable (the constitution's *"provenance survives"*). (b) **Retrieval**: Reality §10 says memory
  has no account scope. Can the founder's first-person stories and opinions condition **brand-page**
  generation? Can brand claims condition the **founder's** posts? Decide whether an account dimension is
  added to `RetrieveScope` / `MemoryScope`. If it is, it must be consumed by a scoring term
  (`SUBSTRATE-QUERY-FIELD-CONSUMED`). If it is not, state the leak that is accepted and why. (c)
  **Performance memory**: are patterns per platform as today, or per account? A founder account's
  engagement is not comparable to a brand account's, which is the same base-mixing error ADR 0031 L-3 names.
  (d) **The interview (ADR 0029)**: its answers are the founder's own words. Do they preferentially
  condition founder-account generation?

- **Q6 — The OAuth scope set, verified per platform and per identity, before production app
  registration.** A table with these columns: **platform × identity (founder / brand) × capability
  (publish, identity, historical read, metrics) × scope × access tier (open / review-gated / restricted) ×
  vendor-doc URL × date read**. It is verified against **current vendor documentation**, not ADR 0028's
  2026-09-03 reading, which is restated as a claim to re-check. For each review-gated scope: the
  application it needs, whether it needs the legal entity, the re-authorisation consequence (Reality §11),
  and the launch-checklist row it becomes (L-8 ⚑). Close the ADR 0031 deferral (Reality §11) explicitly:
  what LinkedIn metrics need, and whether anything changes for the founder identity. **The
  pairwise-`sub` question** (`linkedin-provider.ts:52-58`, ADR 0028 §16 item 9) is restated as open, with
  the Stage-1 real-credential check that resolves it.

- **Q7 — Plans, trial and counsel.** (a) Does a founder account count against Plus's *"LinkedIn + X"*?
  `allowedPlatforms` gates platforms, not accounts (Reality §9). State whether Plus gets brand **and**
  founder on both platforms (four identities), and where any limit is enforced server-side. (b) Do
  founder-account posts count against `postsPerMonth`? Record the code-vs-constitution drift (50/5 against
  250/25) as a finding for the founder, without fixing it (L-1). (c) The trial clock: a founder account as
  the first connection starts it (Reality §9). Confirm or argue. (d) **Counsel**: the founder's personal
  profile is personal data of a named individual acting partly in a personal capacity. Write the counsel
  question (lawful basis, the business-vs-founder controller split on disconnect and on erasure, and what
  the privacy notice must say) as a `launch-checklist.md` §9 row. State whether the Evidence Pack
  (`docs/evidence/0010-legal-evidence.md`) and any `content/legal/*.mdx` `evidenceRef` are affected. The
  MDX itself is not edited (L-1).

- **Q8 — The UX contract P1 specifies, the test plan across the tiers, and measurement honesty.** **UX,
  which P1 specifies and does not design:** the accounts surface (`settings/accounts/AccountsClient.tsx`,
  `components/social/PlatformConnectionCard.tsx`, onboarding `step-3/Step3Client.tsx`). Cover the
  brand/founder role, the owner shown, the Company Page `coming_soon` card beside a working founder card, and
  connecting a second identity as an obvious action, not a re-connect (ADR 0028 §9.4). Then the campaign
  creation target (accounts, not platforms, per Q1); the per-post identity on the post card, the approvals
  inbox and the calendar; **the `account_ambiguous` state**, which must become a real picker or disappear
  for new posts; the founder voice editor (the widened variation, through the existing `VoiceEditor`); and
  the waiting-on-founder approval state (Q4). For each: every state (empty, one identity, two identities,
  founder disconnected, founder departed, cold founder voice, loading, error), the information hierarchy,
  the Server/Client split, Zod on every Server Action, native `<select>` for the identity picker, Tailwind
  only, i18n en/pt/es, and WCAG 2.2 AA (keyboard reachable; the identity of every post readable as text,
  never only as an avatar or colour). **Tests:** **Tier 1** for every new column's RLS, allowlist exclusion,
  cascade and `purge_business`; the one-founder-per-platform index; the cross-tenant pin (business B's
  account on business A's post must be refused by the setter); the reconnect-by-another-member case; and
  any approval-trigger narrowing. **Tier 2** for the targeting setter and every caller of Q1(f); voice
  precedence and the widened merge in `retrieveVoice`; the cold-founder fallback; every bulk-approve
  caller; the state JWT carrying the member without being forgeable; and every state of the picker.
  **Tier 3**, enumerated as properties of absence: no change to `resolvePublishAccount`'s fail-closed
  branches; no review-gated scope in `PLATFORM_CONFIGS`; no new voice table; no org-posting code path; no
  user id taken from client input. **Measurement:** what seeded data and mocks can show, against what
  **cannot be proven without a real LinkedIn and X credential**: a real founder connect, a real publish
  under `urn:li:person`, the pairwise-`sub` check, and a real second X account. Name the ADR 0028 §14
  Stage-1 row this session adds. Say whether anything is Tier E (ADR 0015 Amendment B4) or simply reported.

Where a P1 answer and this build-guide disagree, **the ADR wins once written**. But P1 must not silently
contradict a §0 Locked decision. If it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **AWAITING THE FOUNDER (⚑ confirmations) AND THEN THE ARCHITECT (A-n onward). This section is the
> Builder's gate; P2 does not start without it.**
>
> Recorded here **before** §2 is authored, in the Sessions 22–37 form:
> `| # | Question | Decision | Where encoded |`. **The ⚑ confirmations of §0 (L-5 / D-4, L-6 / D-5,
> L-8 / D-6) are recorded first, before §1a is pasted**, as rulings in their own right.
>
> **Most likely escalations from P1:** **founder-only approval** (Q4, which is always flagged: P1
> recommends, the founder rules); **the Plus identity allowance** (Q7(a): whether "LinkedIn + X" means two
> identities or four is a pricing decision); **any non-review scope the founder identity needs** (Q6, L-8 ⚑:
> it changes every connection's consent screen); **an account dimension in memory** (Q5(b): it changes ADR
> 0030's narrowed `RetrieveScope`); **the departing-founder behaviour for already-approved posts** (Q3(e));
> **a new `EmailKind`** for waiting-on-founder approvals (Q4); and **the Plus limits drift** (Reality §9:
> recorded for the founder, not fixed here).
>
> Where an adjudication goes **against** P1's recommendation, the recommendation is **preserved in the ADR
> and the reasoning recorded here**. Nothing is rewritten in place. A revised ruling gets a prime, with
> both versions visible. The section closes by naming any constraints the adjudications added and ADR
> 0032's total count.

| # | Question | Decision | Where encoded |
|---|---|---|---|
| A-1 | ⚑ L-5 / D-4: a personal account is connected only by its owner, bound to the member session, recorded server-side | **Approved** | §0 L-5, D-4 |
| A-2 | ⚑ L-6 / D-5: at most one founder-role account per platform per business | **Approved** | §0 L-6, D-5 |
| A-3 | ⚑ L-8 / D-6: no review-gated OAuth scope in this session; a verified table plus launch-checklist rows | **Approved** | §0 L-8, D-6 |
| A-4 | Q4: approval of a founder-account post | **Founder-only** (the connecting member, who must also hold `approve`), enforced in the posts trigger — P1's recommendation, adopted | ADR 0032 §6.2 |
| A-5 | Q7(a): the Plus identity allowance | **Four identities** (brand and founder on LinkedIn and X); no per-plan account limit — P1's recommendation, adopted | ADR 0032 §10.1 |
| A-6 | P1 finding: the pre-existing approval-gate bypass (INSERT of `approved`; `draft → scheduled`; bug-1948) | **Close it in Session 38**, inside the same trigger change — P1's recommendation, adopted | ADR 0032 §1.5, §6.1 |
| A-7 | Q3(f)/Q7: one active brand account per platform, beside L-6's one founder | **Adopted** (one partial unique index on `(business_id, platform, account_role) WHERE is_active`) | ADR 0032 §5.6 |
| A-8 | Q3(e): the departing founder | **Approved/scheduled founder posts revert to draft; the bound variation's examples are cleared** (counsel row owed) — P1's recommendation, adopted | ADR 0032 §5.7 |
| A-9 | Q5(b): an account dimension in memory | **Not added; the leak is accepted and stated**, with an un-defer trigger — P1's recommendation, adopted | ADR 0032 §7 |

> **How A-4…A-9 were ruled (2026-10-10).** The founder instructed *"write the adr following recommendations"*. Each
> row above is P1's recommendation adopted on that instruction, not an independent per-item sign-off (the Session 35-D
> D4 precedent). The alternatives are preserved in ADR 0032 (§6.2, §10.1). **Constraints added by these rulings:**
> APPROVAL-GATE-INSERT-CLOSED, APPROVAL-GATE-SCHEDULED-CLOSED (A-6), FOUNDER-APPROVAL-ENFORCED-IN-DB (A-4),
> FOUNDER-PLAN-ENFORCED-SERVER (A-5/A-7), FOUNDER-DEPARTURE-HANDLED (A-8). **ADR 0032's total: 48 constraints.**

**Added after the P1 review (ADR 0032 Amendment R, §18, 2026-10-10).** The rows above are not edited.

| # | Question | Decision | Where encoded |
|---|---|---|---|
| A-8′ | Revises A-8: which founder posts revert on departure (and in the connect sweep) | **`approved` only.** A `scheduled` row has been claimed by the worker and is mid-publish. Reverting it could publish the same post twice, so it is left to fail closed or complete once | ADR 0032 §18 R-1 |
| A-10 | R-6: at launch every LinkedIn connection is founder-role, so A-4 makes one person the only LinkedIn approver | **Approved (2026-10-10), as recommended: (b) + (c).** (b) A founder-controlled delegation toggle, off by default and set only by the connecting member, lets approvers approve that account's posts. (c) The founder role is shown to users as "Personal". The internal value `founder` and every `FOUNDER-*` name are unchanged | ADR 0032 §18 R-6, **§19** |

> **Constraints added by Amendment R:** IDENTITY-REVERT-SKIPS-CLAIMED, IDENTITY-PIN-WRITERS-CLOSED,
> IDENTITY-PROMOTE-PINNED, IDENTITY-REACTIVATION-SWEEPS, IDENTITY-LEGACY-ROLE-REDECLARED, FOUNDER-VOICE-MISMATCH-SHOWN.
> **ADR 0032's total: 54 constraints.**
>
> **A-10 ruled (2026-10-10), encoded as ADR 0032 Amendment A-10 (§19).** It adds FOUNDER-DELEGATION-FOUNDER-CONTROLLED
> (#55) and FOUNDER-PERSONAL-LABEL (#56), and amends #37, #38 and #48. **ADR 0032's total: 56 constraints.**

---

## §1 — Architect session (P1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **one document and no code**:
`docs/decisions/0032-founder-and-personal-profiles.md` (Accepted). No `.ts`, no `.sql`, no `.tsx`, no
prompt template, no i18n strings beyond literal copy quoted inside the ADR. Any code attempted here is
discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase: four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list. Then **exactly three** advisory reviewers, dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation. The three are chosen for
where this session's risk actually sits:
- **`ecc:security-reviewer`**: the session's defining failure is **a post published under a real
  person's name that they did not choose**. Cover the cross-tenant pin on the new setter (Reality §13);
  forging the connecting member through the OAuth state (Reality §7); the reconnect-by-another-member
  overwrite; founder-only approval and its bypass paths (the trigger against the UI, and bulk approval's
  two callers); and the departing-founder token lifecycle.
- **`ecc:database-reviewer`**: the role and owner columns and their `ON DELETE` behaviour; the
  one-founder-per-platform partial unique index; the widened `brand_voice_variations` and its CHECKs; the
  authenticated-UPDATE allowlist (new columns must stay out of it); any approval-trigger change; RLS,
  cascade, `purge_business`, the §D2.5 rows and the A-8 DEFINER audit gate.
- **`ecc:type-design-analyzer`**: L-3 is best enforced by making an untargeted post on a two-identity
  platform **unrepresentable** after creation, not by remembering to check. It reads Q1's targeting types,
  the widened voice type that `retrieveVoice` returns, and the brand/founder role, for invariants that the
  types can express instead of runtime checks.

`ecc:architecture-decision-records`, `claude-mem`'s `mem-search`, `supabase:supabase-postgres-best-practices`
and `ecc:cost-aware-llm-pipeline` are **skills**. They are free and do not consume the budget. ⚠️
`cost-aware-llm-pipeline` is a **SKILL in this install, not an agent** (the Session 28 error); it is needed
only if Q2's widened voice changes prompt size materially. **Vendor-documentation verification for Q6 uses
`WebFetch` / `WebSearch` directly** (tools, not subagents). **`taste-skill`, `ui-ux-pro-max` and
`emil-design-eng` are NOT invoked.** P1 specifies the Q8 UX contract, and the Builder runs them against it.
**`impeccable` is permitted exactly once, read-only**, under the Session 29 precedent: an audit of the
shipped accounts surface and the post card's `account_ambiguous` state, to ground the UX contract in what
exists. No design output.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 38 - Founder and personal profiles: the founder identity made first-class.
ARCHITECT phase (Track P). You produce ONE artefact and NO code:
  docs/decisions/0032-founder-and-personal-profiles.md (status: Accepted)
No .ts, no .sql, no .tsx, no prompt template. If you catch yourself writing a migration, an RPC body, a
zod schema body, a type definition, a component or a prompt, stop: that is the Builder's job (P2), and the
constitution requires Architect-attempted code to be discarded.

PREREQUISITES - verify before anything else, and STOP if any fails.
(1) Session 37 (ADR 0031) must have CLOSED and MERGED to master. Confirm with git log origin/master that
    the PR #20 merge (841b3b08) is present.
(2) Section 0.2 of docs/build-guide/session-38.md must record rulings A-1 (L-5/D-4, who connects), A-2
    (L-6/D-5, one founder per platform) and A-3 (L-8/D-6, no review-gated scope). If any says "Awaiting
    founder", STOP and ask - do not assume the proposal stands.
(3) Soft, both open: no production OAuth app is registered (no real founder has connected anything) and
    S34-E2E-UNVERIFIED / S36-UX-UNVERIFIED-IN-BROWSER. Do not stop - state both in the ADR's context
    section. Your Q6 scope table is an INPUT to production app registration, so it is verified against
    current vendor docs, dated, never from memory.

THE FACT TO HOLD ONTO: the dual-identity model ALREADY SHIPPED (ADR 0028 section 5.3, A-6). Two rows per
platform, posts.social_account_id, resolvePublishAccount and a two-identity accounts surface exist. What is
missing is everything that makes a second identity USABLE: nothing writes posts.social_account_id, campaigns
target platforms not accounts, no brand/founder role is stored on the connection, the founder voice is
seven sliders bound to campaigns, and nobody records who connected an account. Do not redesign what
exists. Close what is missing.

ECC BUDGET - FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. file:line citations and the shape of
   each seam - nothing else. In particular have it produce (a) the CALLER TABLE for resolvePublishAccount,
   listActiveByBusinessAndPlatform, getActiveById, retrieveVoice, buildCustomerContext and
   bulkApprovePostsAction; (b) every writer of posts rows in lib/db/posts.ts and who calls each; (c) every
   reader of social_backfill_runs.account_role; (d) the full column list of social_accounts,
   brand_voice_variations and posts as they stand after every migration, with the authenticated-UPDATE
   allowlist; (e) the OAuth state claims and every place the callback trusts them; (f) the member-removal
   and auth.users-deletion paths that touch social_accounts. Q1, Q2, Q3, Q4 and Q5 depend on these.
2. Skills are free: ecc:architecture-decision-records for structure; claude-mem's mem-search for
   prior-session context (Sessions 19B (voice model), 21 (seats and roles), 30.5 (native providers, A-6/A-8/
   A-9'), 32 (backfill, account_role, L-11) and 36 (RetrieveScope narrowing) especially);
   supabase:supabase-postgres-best-practices for the partial unique index, the new columns and any trigger
   change; ecc:cost-aware-llm-pipeline as a SKILL only if the widened voice changes prompt size materially.
3. Q6 is vendor verification: use WebFetch / WebSearch directly against LinkedIn (Microsoft Learn) and X
   developer documentation. Record the URL and the date read for every row. ADR 0028's 2026-09-03 reading
   is a claim to re-check, not a source.
4. OPTIONAL, at most ONCE, read-only: impeccable as an AUDIT of the shipped accounts surface
   (app/[locale]/(dashboard)/settings/accounts/AccountsClient.tsx, components/social/PlatformConnectionCard.tsx)
   and the post card's account_ambiguous state (components/posts/PostCard.tsx) - to ground the Q8 UX
   contract in what exists (the Session 29 precedent). No design output. Do NOT invoke taste-skill,
   ui-ux-pro-max or emil-design-eng: you SPECIFY the UX contract; P2 runs them against it.
5. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - ecc:security-reviewer - on Q1(c), Q3 and Q4. The cross-tenant pin: can any setter put business B's
     social account on business A's post (get_user_business_ids returns an ARRAY - RLS alone does not
     isolate; the publishing worker uses service-role)? Can the connecting member be forged through the
     OAuth state? What does the callback's upsert-on-conflict do when member B re-authorises member A's
     founder row? Founder-only approval: enforced in the posts trigger, or bypassable through the UI or
     either bulk-approve caller? The departing founder's tokens and already-approved posts.
   - ecc:database-reviewer - on Q1(a), Q2(c)-(d), Q3(a)/(e)/(f). The role and owner columns and their ON
     DELETE behaviour (auth.users and member removal); the one-founder-per-platform partial unique index;
     the widened brand_voice_variations with CHECKs matching brand_voices (writing_examples <= 3); the
     authenticated-UPDATE allowlist (new columns stay OUT); any approval-trigger change; RLS in the
     InitPlan form with USING + WITH CHECK; cascade, purge_business, the ADR 0010 Amendment 2 section
     D2.5 rows; and the SECURITY DEFINER audit gate for any new function.
   - ecc:type-design-analyzer - on Q1(b)-(d) and Q2(b)-(c). Can the types make an untargeted post on a
     two-identity platform unrepresentable after creation (L-3)? Is the brand/founder role a closed union
     everywhere it travels? Does the widened voice type returned by retrieveVoice express the merge rule
     (replace vs add) rather than leave it to each caller?
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.

Read now, before anything else:
- docs/build-guide/session-38.md - the goal block, the Reality block (13 items), section 0 (Locked
  L-1..L-10 + the D-1..D-8 ledger), section 0.1 (Q1..Q8) and section 0.2. This is your binding input.
- docs/pre-launch-scope.md - section 4 T1-E, section 9 C-4, section 10 (the launch gate), section 12.2
  (T1-E's scope and exclusions, verbatim), section 12.8, and section 15 (why this session is 38).
- docs/product-status.md - the founder-profile line and the accounts/publishing lines.
- docs/ideas.md sections 2.5 (voice exemplars - waits, not this session) and 2.7 (outbound-activity
  backfill - not this session, and why).
- docs/brainstorm/ai-quality-track-ideas-and-build-path.md section 12 (cold start from social history,
  points 3 and 4) and section 15 (agency scales with reversibility x verifiability; publishing is the
  irreversible row).
- docs/decisions/0028-native-social-providers.md - section 5 (identity, dual identity, A-6, A-8, A-8a),
  section 9.4 (the accounts surface), section 14 (the staged verification table) and section 16 items 1, 7,
  9 and 11.
- docs/decisions/0025-social-read-path-and-backfill.md - the interpretation notes, section 4.2 (founder
  voice applied as axes only), section 10.3 (ratification) and section 13 (the deferral to T1-E).
- docs/decisions/0011-voice-model.md - the variation model you will amend.
- docs/decisions/0013-seats-and-permissions.md and 0014-seats-and-permissions-surface.md - roles,
  capabilities, the owner override, and the member lifecycle.
- docs/decisions/0016-governed-memory.md (MEM-VOICE-THROUGH-EXISTING, provenance) and
  docs/decisions/0030-memory-platform-substrate.md section 3 (RetrieveScope; a field with no consuming term
  is removed) and section 7 (two-businesses-one-user).
- docs/decisions/0029-founder-input-engine.md - the interview as founder-authored input (Q5(d)).
- docs/decisions/0031-analytics-and-monthly-report.md section 4.4 (the NULL account bucket) and the
  deferred row that names Session 38.
- docs/decisions/0010-legal-surface.md Amendment 2 section D2.5 - the cascade table format.
- docs/decisions/0015-test-execution-and-ci-gates.md section 2 and Amendment B - the tiers, and Tier E.
- docs/launch-checklist.md - section 9 (legal and ops slots), sections 16a and 16c.
- CLAUDE.md - the launch platforms (Business and Founder), pricing, "What we don't do" (no auto-publish,
  no auto-reply), the Vault and disconnect rule, the three-client rule, Zod, i18n, bounded queries, the UI
  Component patterns section (Base UI: NO asChild; native select for static options), the UI/UX tooling
  phase rule, and SHARED-FUNCTION CALLERS.

The CLOSED file list for the ONE ecc:code-explorer sweep - map these, cite file:line, nothing beyond:
- supabase/migrations/20260430120006_social_accounts.sql, 20260430120008_social_accounts_trial_trigger.sql,
  20260702120400_campaigns_social_accounts_role_policies.sql, 20260913120000_social_accounts_identity_lock.sql,
  20260917100000_social_accounts_vault_id_nullable.sql, 20260904100000_posts_social_account_id.sql,
  20260430120010_posts.sql, 20260702120300_posts_role_aware_and_status_trigger.sql,
  20260702120200_user_can.sql, 20260702120000_business_members.sql,
  20260702120700_purge_business_member_delete.sql, 20260623210000_voice_axes.sql,
  20260913130000_social_backfill_runs_and_posts.sql, 20260914060000_backfill_voice_transition.sql.
- lib/db/social-accounts.ts, lib/db/posts.ts, lib/db/voice.ts, lib/db/brand-voices.ts,
  lib/db/backfill-runs.ts, lib/db/types.ts (Platform, Plan, MemberRole, CampaignRow, PostRow, PostUpdate,
  SocialAccountRow, MemoryScope).
- lib/social/index.ts, lib/social/platforms/config.ts, lib/social/linkedin-provider.ts (identity, author
  URN, scopes, historicalReadAvailable, fetchPostMetrics), lib/social/twitter-provider.ts (identity),
  lib/social/oauth/state.ts, lib/social/connection-status.ts.
- app/api/social/[platform]/connect/route.ts, callback/route.ts, disconnect/route.ts,
  app/api/social/accounts/route.ts.
- lib/publishing/orchestrator.ts, lib/metrics/orchestrator.ts, lib/campaigns/generate.ts,
  lib/campaigns/enforcement.ts, lib/stripe/plan.ts, lib/members/seats.ts.
- lib/memory/voice.ts, lib/memory/scoring.ts, lib/ai/context.ts lines 50-110.
- lib/backfill/orchestrator.ts and app/[locale]/(dashboard)/onboarding/step-4/backfill-actions.ts (the
  founder/brand declaration and the voice apply path).
- app/[locale]/(dashboard)/settings/accounts/AccountsClient.tsx, components/social/PlatformConnectionCard.tsx,
  app/[locale]/(dashboard)/onboarding/step-3/Step3Client.tsx, components/posts/PostCard.tsx,
  app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts, .../PostsClient.tsx,
  app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx.
- lib/analytics/load.ts lines 40-60 and 290-310 (the account grouping and its NULL bucket).

Do NOT write the ADR yet. First OUTPUT your answers to the eight section-0.1 questions (Q1 account identity
and targeting; Q2 the founder voice and the ADR 0011 widening; Q3 ownership; Q4 approval semantics; Q5
memory and backfill scope; Q6 the verified OAuth scope table; Q7 plans, trial and counsel; Q8 UX contract,
tests and measurement honesty), EACH with its named loser and its ADR 0015 tier, AND a one-line note on any
place a section-0 Locked decision constrains the answer. State plainly, in Q1, what happens TODAY when a
business connects a second X account, and what happens after this session. Flag explicitly if any answer
needs: a change to resolvePublishAccount's fail-closed branches, a review-gated or any new OAuth scope, a
new voice table, more than one founder account per platform, an account dimension in memory, a new
EmailKind, a per-account plan limit, a fix to the Plus limits drift, an org-posting code path, or an edit
to CLAUDE.md, the pricing page or content/legal - those are founder adjudications, not your call.
Founder-only approval (Q4) and the Plus identity allowance (Q7(a)) are ALWAYS flagged: you recommend, the
founder rules. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT - Session 38. Write docs/decisions/0032-founder-and-personal-profiles.md (status: Accepted).
Ground every claim in the real repo (cite file:line from the ecc:code-explorer sweep). You have already
dispatched your ONE batch of three advisory reviewers - fold their objections in now, or record why you
rejected them. Do not re-consult them.

1. Context + decision summary. State the structural facts plainly: the dual-identity model shipped in ADR
   0028 (A-6) and is reused, not rebuilt; nothing writes posts.social_account_id, so a second account on a
   platform fails every unpinned post as account_ambiguous; campaigns are platform-shaped; every LinkedIn
   connection is already a person (w_member_social) and the Company Page stays coming_soon behind A-8 /
   A-9'; the brand/founder role exists only on social_backfill_runs; the founder voice is axes only and
   campaign-bound; no connecting member is recorded; no production OAuth app exists. Name the losers per
   section 0's D-1..D-8 ledger.

2. Account identity and targeting (Q1, L-3) - the load-bearing section. Where the brand/founder role is
   persisted, its default for legacy and single-account rows, and who may set it. Where targeting lives
   (campaign, post or both) and the precedence rule; what "one row per (campaign, platform)" becomes. The
   ONE dedicated setter of posts.social_account_id: function, client, moment, and the business + platform
   re-check. The single-account business. Existing unpinned drafts when a second account arrives. The
   CALLERS TABLE: every caller of resolvePublishAccount, listActiveByBusinessAndPlatform, the posts writers
   and generate.ts, each with the test that will cover two-identity behaviour.

3. The founder voice (Q2, L-4) - the ADR 0011 amendment, written as one. Binding to the account and
   behaviour on disconnect; precedence against campaigns.voice_variation_id; the widened
   brand_voice_variations columns with caps; retrieveVoice's merge rule (replace vs add, per field) as the
   sole resolver; the 5-variation cap; the backfill founder branch after the widening (and that previously
   ratified founder runs cannot be revisited, because their synthesis was never persisted); the cold-founder
   behaviour; any CustomerContext change and its callers. Name ADR 0011 and ADR 0025 section 4.2 / section
   13 as amended, by section.

4. Ownership (Q3, L-5, L-6, L-7). The connecting-member column, how it travels through the signed OAuth
   state without being forgeable, and that it stays OUT of the authenticated-UPDATE allowlist. The
   capability for a self-connect (editor founders included or not, argued). The reconnect-by-another-member
   outcome. Disconnect authority. The departing founder: member removal and auth.users deletion, for the
   account, its tokens, its scheduled/approved posts and its voice. The one-founder-per-platform
   enforcement.

5. Approval (Q4, L-2). Your recommendation on founder-only approval, marked as awaiting founder
   adjudication, and its enforcement point (the posts trigger, so a bypassed UI cannot approve). Bulk
   approval with BOTH callers named (ApprovalsInbox.tsx, PostsClient.tsx). The waiting-on-founder state.
   Notification, and if it needs a new EmailKind, the CHECK widening, flagged.

6. Memory and backfill scope (Q5). Founder-backfill provenance; whether an account dimension enters
   RetrieveScope / MemoryScope and the scoring term that consumes it, or the accepted leak stated plainly;
   performance patterns per platform or per account (never mixing bases); the interview's founder-authored
   answers.

7. The verified OAuth scope table (Q6, L-8). Platform x identity x capability x scope x access tier x
   vendor URL x date read. Every review-gated scope with its application, entity dependency,
   re-authorisation consequence and launch-checklist row. The ADR 0031 LinkedIn-metrics deferral closed
   explicitly. The pairwise-sub question restated with its Stage-1 check. Any non-review scope the founder
   identity needs, FLAGGED.

8. Plans, trial and counsel (Q7). Your recommendation on the Plus identity allowance, FLAGGED, and its
   server-side enforcement point if any; postsPerMonth accounting; the Plus limits drift recorded as a
   finding, not fixed; the trial clock. The counsel question as a launch-checklist section 9 row, and the
   Evidence Pack / evidenceRef impact (the MDX is not edited).

9. The UX contract the Builder is held to - you SPECIFY it, you do not design it (Q8). The accounts
   surface, campaign targeting, the per-post identity on the post card / approvals inbox / calendar, the
   account_ambiguous state's fate, the founder voice editor through the existing VoiceEditor, and the
   waiting-on-founder state. Per surface: information hierarchy; every state (empty, one identity, two
   identities, founder disconnected, founder departed, cold founder voice, loading, error); the
   Server/Client split; Zod on every Server Action; native select for the identity picker; Tailwind only;
   i18n en/pt/es; WCAG 2.2 AA with a post's identity always readable as text. Name which design skill the
   Builder must run against which part (impeccable for UX and states, taste-skill only if a surface reads
   as generic, ui-ux-pro-max to validate any new visual token, emil-design-eng for the final polish pass) -
   naming them, not running them.

10. GDPR + tenancy (L-9). Every new column and table: RLS in the InitPlan-wrapped form with USING and WITH
    CHECK on UPDATE, its ON DELETE behaviour argued, the ADR 0010 Amendment 2 section D2.5 row VERBATIM (or
    the explicit no-new-row note), purge_business coverage, and the SECURITY DEFINER audit gate for any new
    function.

11. Test plan across the tiers (Q8), then the MEASUREMENT section. Tier 1 (new columns' RLS and allowlist
    exclusion, cascade, purge_business, the partial unique index, the cross-tenant pin refused, the
    reconnect-by-another-member case, any trigger narrowing); Tier 2 (the targeting setter and one test
    per CALLER of section 2's table, voice precedence and merge, the cold founder, every bulk-approve caller,
    the unforgeable member claim, every picker state); Tier 3 enumerated as properties of ABSENCE (no
    change to resolvePublishAccount's fail-closed branches, no review-gated scope in PLATFORM_CONFIGS, no
    new voice table, no org-posting path, no user id from client input). Then what mocks and seeded data
    can show against what cannot be proven without real LinkedIn and X credentials, with the ADR 0028
    section 14 Stage-1 row this session adds, and any Tier E item framed MEASURED-never-COVERED.

12. A constraint table: every FOUNDER-* / IDENTITY-* constraint, its tier, and the test that proves it -
    the Reviewer's checklist. Cover at least: IDENTITY-NO-UNPINNED-NEW-POST, IDENTITY-SETTER-TENANT-CHECKED,
    IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED, IDENTITY-ROLE-PERSISTED, IDENTITY-ROLE-NOT-FROM-URN,
    IDENTITY-CALLERS-TWO-ACCOUNT-COVERED, FOUNDER-CONNECTED-BY-SELF, FOUNDER-OWNER-UNFORGEABLE,
    FOUNDER-OWNER-NOT-MEMBER-UPDATABLE, FOUNDER-ONE-PER-PLATFORM, FOUNDER-RECONNECT-NO-TAKEOVER,
    FOUNDER-DISCONNECT-GDPR, FOUNDER-DEPARTURE-HANDLED, FOUNDER-VOICE-THROUGH-EXISTING,
    FOUNDER-VOICE-WIDENED, FOUNDER-VOICE-PRECEDENCE, FOUNDER-VOICE-COLD-HANDLED,
    FOUNDER-APPROVAL-NOT-RELAXED, FOUNDER-APPROVAL-ENFORCED-IN-DB (if narrowed),
    FOUNDER-BULK-APPROVE-CALLERS, FOUNDER-MEMORY-PROVENANCE, FOUNDER-SCOPES-VERIFIED,
    FOUNDER-NO-REVIEW-GATED-SCOPE, FOUNDER-NO-ORG-POSTING, FOUNDER-PLAN-ENFORCED-SERVER,
    FOUNDER-CASCADE-COMPLETE, FOUNDER-I18N-COMPLETE, FOUNDER-A11Y-FLOOR. Where an ADR 0028 SOCIAL-* or
    ADR 0025 constraint is relied on or extended, say so row by row.

13. Explicit "deferred" section with the owning session or trigger named for each: LinkedIn Company Page
    posting (A-8, the entity and the Community Management API); LinkedIn historical read and metrics (the
    review-gated scopes, as launch-checklist rows); multi-founder workspaces; personal profiles on
    Instagram / Facebook / Threads; outbound-activity backfill (ideas 2.7); similarity exemplars (ideas
    2.5); the Plus limits drift (founder); anything Q1-Q8 pushed to a follow-on, each with an un-defer
    trigger for docs/backlog.md. Also list every ADR this one amends, with the section amended (at least
    ADR 0011, ADR 0025 sections 4.2 and 13, and ADR 0028 section 5.3 / section 14).

Do NOT write code. End with one line: "ADR 0032 written and accepted - <n> FOUNDER-*/IDENTITY-*
constraints, role persisted on <seam>, targeting at <campaign|post|both>, setter <function>, founder voice
<widened: fields|axes only>, connected-by <column|none>, one founder per platform <enforced at seam>,
approval <unchanged|founder-only flagged>, memory account scope <added|accepted leak>, new scopes
<none|flagged>, Plus identities <n flagged>, new tables <list|none>." Then /exit.
```

**Gate:** do not author §2 until ADR 0032 exists and is Accepted, the eight §0.1 answers are on the record,
and every founder adjudication is recorded in §0.2. That means **the ⚑ confirmations A-1…A-3, plus
founder-only approval (Q4) and the Plus identity allowance (Q7(a)), which P1 always flags.** Then author §2
and §3 below from the accepted ADR's real `FOUNDER-*` / `IDENTITY-*` constraint names.

---

## §2 — Builder session (P2)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0032 is Accepted and §0.2 records every founder adjudication
> (A-1…A-3 and whatever P1 flags), or records "no adjudications required".** Nothing in this section may
> be pasted until then. It holds the specification §2 will be written against, not the section itself.
>
> **What §2 will contain when authored:**
>
> - **A preamble (prose, not a prompt)** restating the hard rules every step inherits: the §0 Locked list
>   (L-1…L-10), the §0.2 adjudications, and the scope tripwires below. Then the ADR 0032 decisions the
>   Builder **transcribes rather than re-derives**: where the role lives, the targeting model, the setter's
>   name, the voice merge rule, the ownership column, and the approval decision.
> - **§2a — Builder primer**: the prerequisites (ADR 0032 Accepted, §0.2 complete, branch cut from
>   `master` at or after `841b3b08`); the read list (ADR 0032 in full, ADR 0028 §5, ADR 0025 §4.2, ADR
>   0011); the verification commands from `CLAUDE.md` (`npx tsc --noEmit --skipLibCheck`; `npx vitest run`
>   on the scoped paths); the ECC budget for the phase; and a closing instruction to stop for
>   acknowledgement.
> - **§2b — one paste block per step, `P2.0 … P2.n`**, each a self-contained `/ecc:plan →
>   /ecc:tdd-workflow → /ecc:verification-loop` cycle that **names the ADR 0032 constraints it closes and
>   the test that proves each**. A step that closes no constraint does not exist.
>
> **Ordering, and the reason for it.** The order runs from the database outward, so that each layer is
> tested against the one beneath it, and **the defect users can actually hit (Reality §2) is closed
> before any new surface makes it more reachable:**
>
> 1. `P2.0`: a grounding step that re-verifies Reality §1–§13 at the branch head and records the callers
>    tables as they actually are. Any drift goes back to §0.2 as a ruling, the Session 37 O-1/O-2/O-3
>    precedent.
> 2. Schema: the role, owner and voice-widening migrations, each with its §D2.5 row in the same commit;
>    the one-founder-per-platform index; any approval-trigger change. All Tier 1.
> 3. The OAuth state carrying the connecting member, and the callback writing it. The
>    reconnect-no-takeover behaviour.
> 4. The targeting setter and the generation path that pins every new post. One test per caller of the
>    ADR's callers table.
> 5. `retrieveVoice`'s widened merge and the backfill founder branch.
> 6. Approval: the trigger, then both bulk-approve callers.
> 7. The UI surfaces, against the Q8 contract, with `impeccable` for states and `emil-design-eng` for the
>    final pass.
> 8. Docs: the launch-checklist rows (scopes, counsel, the ADR 0028 §14 Stage-1 row) and the amended ADRs'
>    notes.
>
> **Scope tripwires, to be written as executable scans, not review comments:**
>
> - `IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED`: a source scan asserting that `resolvePublishAccount`'s
>   `none` and `ambiguous` branches are byte-identical to `841b3b08`, or a behavioural test pinned to them.
> - `FOUNDER-NO-REVIEW-GATED-SCOPE`: a test over `PLATFORM_CONFIGS` asserting that the LinkedIn and X scope
>   arrays equal the ADR 0032 Q6 table's "requested now" column exactly.
> - `FOUNDER-NO-ORG-POSTING`: a scan asserting that no `w_organization_social` string and no organization
>   connect flow appears under `lib/social/` or `app/api/social/`.
> - `FOUNDER-VOICE-THROUGH-EXISTING`: a scan asserting that no migration creates a table whose name
>   contains `voice` other than the existing two, and that `retrieveVoice` has a single implementation.
> - `FOUNDER-OWNER-UNFORGEABLE`: a scan asserting that the owner column is absent from the
>   authenticated-UPDATE `GRANT` allowlist, plus a Tier-1 attempt to update it as `authenticated`.
>
> **Binding process rules for the phase:** `SHARED-FUNCTION CALLERS` for `resolvePublishAccount`,
> `listActiveByBusinessAndPlatform`, `retrieveVoice`, `buildCustomerContext` and `bulkApprovePostsAction`,
> with each caller named and its test listed. Test-execution integrity (ADR 0015): a constraint is covered
> only when it is **executed green in CI at the head it is dated to**, never because the test was authored.
>
> **Design skills (Builder phase only, against the ADR's Q8 contract):** `impeccable` for the identity
> picker's and the accounts surface's states; `taste-skill` only if a surface reads as templated;
> `ui-ux-pro-max` only to validate a new visual token, such as the brand/founder badge; `emil-design-eng`
> for the final polish pass. All within shadcn v4 / Base UI, Tailwind only, and i18n in all three locales.

**✅ AUTHORED 2026-10-10 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Written from ADR 0032 as Accepted, **including Amendment R
(§18)** and **Amendment A-10 (§19)**, which bring the total to **56**. A-10 was ruled (b) + (c) on 2026-10-10. Its
contract is §19, and the steps below carry it: the column in `P2.2`, the setter and trigger branch in `P2.3`, the
reset in `P2.4`, the bulk filter in `P2.9`, and the toggle and the label in `P2.10`.

**Seven corrections to the placeholder, carried into the primer:**

1. **Approval moves into the schema phase.** The placeholder ordered "approval: the trigger, then both bulk-approve
   callers" sixth. ADR 0032 §6.1 puts founder-only approval, the A-6 bug-1948 closure and the pin rules in **one
   trigger contract**. They are written and tested together in `P2.3`, right after the schema. Bulk approve stays
   late (`P2.9`) because it depends on the targeting path.
2. **The OAuth work is split in two.** The DB half (the connect RPC with the sweep, `P2.4`) lands before the app
   half (role module, signed state, cookie nonce, callback, `P2.5`). Each is then tested against the layer beneath
   it.
3. **The placeholder's `FOUNDER-OWNER-UNFORGEABLE` tripwire was mislabelled.** "The owner column is absent from the
   authenticated-UPDATE allowlist" is **#19 FOUNDER-OWNER-NOT-MEMBER-UPDATABLE** (Tier 1, `P2.2`).
   **#18 FOUNDER-OWNER-UNFORGEABLE** is the OAuth arms: nonce, session user, old-format state (`P2.5`).
4. **The callers list grows.** `bulkApprovePostsAction` is the Server Action. The DB function the ADR fences is
   `bulkApproveDraftPosts`, and both are listed. `createPosts`, `pin_post_account` / `pinPostAccount`,
   `approvePost`, `getActiveById` and the new `createPinnedDraftAsMember` (R-3) join the table.
5. **Tier labels follow the ADR.** The placeholder asked for every tripwire as an executable scan. ADR 0032 §12.3
   assigns those properties **Tier 3 (diff-verified)**. `P2.1` still writes a cheap scan for each, as a guard, but
   the tier stays 3. A scan never upgrades a Tier-3 property to "COVERED".
6. **`promote.ts` is decided, not discovered** (R-3). It stays on the authenticated client. The ADR fixes the
   flow, and the Builder transcribes it.
7. **No step runs against a real platform.** There is no production OAuth app (§1.4). Everything is proven against
   `SOCIAL_PROVIDER_MODE=mock` and seeded data. ADR §12.4's five items are recorded **UNPROVEN**, never passed.

**The ADR decisions P2 TRANSCRIBES rather than re-derives.** Each carries a named loser in ADR 0032. A Builder that
changes one has re-opened an adjudicated decision.

| Decision | Value | ADR |
|---|---|---|
| Role | `social_accounts.account_role text NOT NULL`, named CHECK `('brand','founder')`, **no default**; backfill every legacy row to `'brand'`; a pre-flight that RAISES naming the business if any `(business_id, platform)` has more than one active row | §3.1 |
| Role source | `ACCOUNT_ROLES` const tuple + `AccountRole` + Zod enum in **one** `lib/social/` module, re-exported by `lib/social/index.ts`; parity test against the CHECK; **never derived from the URN** | §3.1 |
| Targeting | `campaign_targets` PK `(campaign_id, platform)`; composite FKs to `campaigns(id, business_id)` and `social_accounts(id, business_id, platform)`; `campaigns.platforms` unchanged; the pin on `posts` is the authority | §3.2 |
| Pin boundary | composite FK `posts (social_account_id, business_id, platform)` → `social_accounts (id, business_id, platform)` `ON DELETE SET NULL (social_account_id)`, named, **replacing** `posts_social_account_id_fkey` | §3.3 |
| Pin writers | **closed list:** service-role `createPosts` (generation), `pin_post_account`, the connect sweep, the FK's SET NULL. Raw clients may never set or change the pin, whatever the status. Draft-only lives **in the body of** `pin_post_account` | §3.3, §18 R-2 |
| Promote | stays authenticated; resolve targets **before** the claim; `campaign_targets` row; `createPinnedDraftAsMember` (insert unpinned → `pin_post_account`); Studio "Publishes from" picker | §18 R-3 |
| Sweep | inside `upsert_social_account_connection`, under `pg_advisory_xact_lock(business_id, platform)`; the **R-1 table** (never changes a `scheduled` row's status); runs on INSERT **and** reactivation (R-5) | §3.5, §18 R-1, R-5 |
| Resolver | `resolvePublishAccount` **byte-for-byte unchanged** | §2, §12.3 #1 |
| Connect RPC | `SELECT … FOR UPDATE`, never `ON CONFLICT`; vault secrets created inside it; the UPDATE branch never writes `id`; typed outcomes `reconnect_owned_by_other`, `founder_exists`, `brand_exists`, `invalid_state`, `role_change_blocked`; the `connected_by IS NULL` re-declaration row (R-4); `service_role` only | §5.3, §18 R-4 |
| OAuth | state signs `{businessId, platform, nonce, locale, userId, role}`; nonce cookie httpOnly, Secure, SameSite=Lax, path `/api/social`, 10 min, deleted on use; the callback checks cookie, session user and `user_can(…,'connect_accounts')` **before the exchange and before any vault call**; old-format states rejected | §5.1 |
| One per platform | one partial unique index `(business_id, platform, account_role) WHERE is_active` | §5.6 |
| Approval | raw INSERT only `draft`/`skipped` with a NULL pin; any entry into `approved`/`scheduled` needs `approve`, an active pin unless the platform has no active account, and, for a founder pin, `auth.uid() = connected_by` (NOT NULL); unapprove stays `author` | §6.1, §6.2 |
| Bulk | the founder filter **inside the UPDATE's WHERE**; typed retry; filtered counts everywhere | §6.4 |
| Departure | a DEFINER trigger on `business_members` (revoke + delete): deactivate the leaver's founder rows; revert pinned **`approved` only** to draft (A-8′); the action completes the GDPR steps and clears `writing_examples` | §5.7, §18 R-1, R-8 |
| Erasure | one service-role function: disconnect every founder row the user connected, then delete through the Auth admin API; the §5.1 CHECK is the safety net. **No trigger on `auth.users`** | §5.7 |
| Voice binding | `social_accounts.voice_variation_id` composite FK, `ON DELETE SET NULL (voice_variation_id)`, CHECK founder-only | §4.1 |
| Voice widening | `keywords`, `avoid_words`, `writing_examples` (≤ 3, named CHECK) on `brand_voice_variations`; **no `tone`**; `[]` ≠ NULL | §4.3 |
| Merge | inside `retrieveVoice` only; axes, examples and keywords replace; `avoid_words` **union**; the rest inherits; `source` is a closed tuple set in `lib/memory/voice.ts` | §4.4 |
| Voice target | **required** closed union `base` / `campaign` / `post`, one constructor; the §4.6 caller table | §4.6 |
| Variation RPC | `create_voice_variation` widened plus optional bind; **old `(uuid, text, jsonb)` signature dropped explicitly**; `service_role` only; counts against the cap of 5 | §4.5 |
| Variation RLS | SELECT members; INSERT/UPDATE/DELETE `user_can(…,'author')`; InitPlan form; UPDATE USING + WITH CHECK | §13.2 |
| Memory | **no** account dimension; the leak is accepted (A-9) | §7 |
| Scopes | **no change** to `PLATFORM_CONFIGS` | §9 |
| Email | **no new `EmailKind`**; "Waiting on you" is in-app only | §6.5 |
| GDPR | the §D2.5 `campaign_targets` row **verbatim, in Migration A's commit**; `purge_business` body unedited | §13.1 |

**Ordering, restated as binding.** Each position is forced by something that breaks under the alternative.

1. **`P2.0` grounds and ships nothing.** It runs the hosted-DB pre-flight query **read-only** first, because a
   business with two active rows on one platform makes Migration A's index fail, and that is a human decision.
2. **Scans before the code they fence (`P2.1`).** A pin writer or a scope added in `P2.3`–`P2.10` then fails CI as
   it lands.
3. **Migration A (`P2.2`) before anything reads a new column.** `database-reviewer` runs at its end, **before it
   commits**, while the schema can still change. Migrations are never edited after commit.
4. **The trigger contract (`P2.3`) before any new writer.** Otherwise every later writer is tested against a
   boundary that does not exist yet.
5. **The connect RPC (`P2.4`), then the OAuth app half (`P2.5`).** `security-reviewer` runs at the end of `P2.5`,
   over `P2.3`–`P2.5`: the trigger, the RPC and the callback, the three places an approval or an ownership claim can
   be forged.
6. **Departure, erasure, disconnect and role change (`P2.6`)** close every path by which an identity ends.
7. **Targeting (`P2.7`), then voice (`P2.8`), then bulk approve (`P2.9`).** Voice needs a post's pinned identity.
   Bulk approve needs pinned founder posts to filter.
8. **UI (`P2.10`) after every state exists. The design pass and the browser measurement (`P2.11`) after that.**
   `react-reviewer` runs at the end of `P2.11`, before it commits.
9. **Close-out (`P2.12`)**: the constraint→CI map, the callers report, the documents and the PR.

**ECC budget for the Builder phase: four subagent invocations, total.** Each is dispatched once, read-only, at the
step whose risk it owns, before that step commits, and never re-consulted.

| # | Agent | Step | Over |
|---|---|---|---|
| 1 | `ecc:code-explorer` | `P2.0` | a closed file list (premises only) |
| 2 | `ecc:database-reviewer` | end of `P2.2`, before commit | Migration A, its Tier-1 tests, the §D2.5 row |
| 3 | `ecc:security-reviewer` | end of `P2.5`, before commit | the posts trigger, `pin_post_account`, the connect RPC, the state, cookie and callback |
| 4 | `ecc:react-reviewer` | end of `P2.11`, before commit | every new or changed component, the Server/Client split, a11y |

**Not dispatched, by decision:**
- `ecc:type-design-analyzer` / `ecc:typescript-reviewer`: the type design (branded pinned identity, total plan,
  resolved voice, voice-target union) was settled by `[type-1]`…`[type-7]` in P1. The Builder transcribes it.
  `npm run typecheck` and the no-`any` lint enforce it.
- A second `database-reviewer` for the later SQL in `P2.3`/`P2.4`/`P2.6`/`P2.8`: those functions are
  `security-reviewer`'s lens (`P2.3`–`P2.5`), and the rest is P3's own work at the range.
- `ecc:tdd-guide`: `/ecc:tdd-workflow` is the same discipline, as a free skill.
- `ecc:e2e-runner` and `ecc:a11y-architect`: the browser pass uses the Playwright MCP tools directly, and
  `/impeccable` owns accessibility.
- `ecc:pr-test-analyzer` and `ecc:silent-failure-hunter`: both are P3's.

**Skills are free and do not count:**
- every code step: `/ecc:plan`, `/ecc:tdd-workflow` and `/ecc:verification-loop`;
- `P2.2`, `P2.3`, `P2.4`, `P2.6` and `P2.8`: `supabase:supabase-postgres-best-practices`;
- `P2.0`: `claude-mem` `mem-search`.

**The design skills run in `P2.11` only**, against ADR §11 and §18 R-3/R-7, and nowhere else:
- **`/impeccable`:** hierarchy, every state in §11.1–§11.5, UX copy (the role words, the error banners, the
  waiting and cold notices), accessibility (identity as **text** in every accessible name) and responsive
  behaviour at 1280/640/320.
- **`/taste-skill`:** only if the accounts surface or the identity picker reads as generic. If it does not run,
  the commit body says so and why.
- **`/ui-ux-pro-max`:** validates the one new visual token, the brand/founder role badge: AA in light and dark, and
  never colour alone.
- **`/emil-design-eng`:** the final polish: focus rings, the disabled-approve affordance and its reason, the picker's
  feel. No animation by default, and `prefers-reduced-motion` respected.
- **`/break-ui`:** worst-case data: four identities on two platforms, a 60-character display name, an unbreakable
  handle, a non-Latin founder name, the longest pt/es strings, 320 px.

**None of them may change** a role word's meaning, a state, a gate (who may approve, connect or disconnect), the
Server/Client split, or the data a component receives. Nor may they add a client island beyond the ones §11 implies,
an animation library, a dependency, `asChild`, a CSS module, or a non-native select for an identity picker. **Each
skill's changes, and whether any touched the §11 contract, are recorded in the `P2.11` commit body.** The Reviewer
checks exactly that.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 38 Track P - BUILDER phase (P2). You implement ADR 0032, INCLUDING Amendment R (section 18), and the
amendments it names. You write code; you do NOT make architectural decisions. Every decision you need has
already been made and carries a named loser. If you find yourself choosing between two designs, STOP and
report - that is an ADR gap, not your call.

PRECONDITION - verify before anything else, and STOP if any fails:
(1) docs/build-guide/session-38.md section 0.2 records A-1..A-10 and A-8', and NONE says "Pending". A-10 is
    ruled (b) + (c).
(2) ADR 0032 carries Amendment A-10 (section 19), a DATED amendment after section 18
    that fixes the column (name, type, default false, outside the authenticated UPDATE allowlist), its ONE
    writer (connecting member only), the extra branch in the section 6.1 founder arm, and its constraint
    name and tier (#55, #56). If section 19 does not exist, STOP: you do not design it.
(3) docs/decisions/0032-founder-and-personal-profiles.md reads "Status: Accepted" and contains section 18.
(4) ADR 0032 and the build guide are COMMITTED in one docs-only commit (supabase/.temp/ excluded; the unrelated
    CLAUDE.md design-skills edit in its OWN commit, never this one), merged to master by a PR whose base was
    master.
(5) You are on a NEW branch session-38-adr-0032 cut from master at that merge. Record its SHA as BASE.

READ FIRST, in this order:
- docs/decisions/0032-founder-and-personal-profiles.md - ALL of it. Section 18 (Amendment R) WINS wherever it
  disagrees with an earlier section; read it BEFORE you read sections 3, 5 and 6 a second time. The constraint
  table is section 14 (#1-#48) PLUS section 18's table (#4, #26, #48 amended; #49-#54 new) PLUS section 19's
  table (#37, #38, #48 amended; #55-#56 new) = 56. Section 19 also WINS over earlier sections. Section 3.8
  (with R-3's replacement row) is your SHARED-FUNCTION CALLERS table; section 4.6 is the voice callers table.
  Sections 15 and 16 record why each advisory finding was adopted or rejected - do not re-open any of them.
- docs/build-guide/session-38.md - the goal block, Reality, section 0 (L-1..L-10, D-1..D-8), section 0.2
  (A-1..A-10, A-8'). SECTION 0.2 IS YOUR GATE. Section 2's preamble lists SEVEN places the authored section
  overrides its placeholder, and the transcription table; read both before the step table.
- docs/decisions/0028-native-social-providers.md sections 5 and 14; 0025-social-read-path-and-backfill.md
  sections 4.2, 5 and 10.3; 0011-voice-model.md sections 3.2, 3.4 and L-10; 0013-seats-and-permissions.md
  section 5; 0014-seats-and-permissions-surface.md (APV-BULK-ATOMIC, APV-COUNT-CONSISTENT);
  0022-promote-to-campaign-and-format-families.md section 2 and A-2; 0010-legal-surface.md Amendment 2
  section D2.5; 0015-test-execution-and-ci-gates.md section 2. You declare NO Tier E.
- .wolf/cerebrum.md - Do-Not-Repeat in full, and the Key Learning that posts.status 'scheduled' means CLAIMED.
- CLAUDE.md - DB access, the three Supabase clients and the lazy service-role import, Vault token storage and the
  three GDPR disconnect steps, RLS (InitPlan form; UPDATE with USING and WITH CHECK) and the erasure cascade,
  atomic transitions, Zod, i18n, bounded queries, date-fns, UI Component patterns (NO asChild; native select),
  the UI/UX tooling phase rule, test-execution integrity, SHARED-FUNCTION CALLERS.

BINDING RULES YOU WILL BE REVIEWED AGAINST:

1. TRANSCRIBE, DO NOT RE-DERIVE. Every name, column, constraint, outcome code and table cell in section 2's
   transcription table is the ADR's. ACCOUNT_ROLES = ['brand','founder'] exactly. The examples cap is 3. The
   variation cap stays 5. The nonce cookie TTL is 10 minutes. None is read from env.

2. NEVER CHANGE THE STATUS OF A 'scheduled' ROW (R-1, A-8'). 'scheduled' means claimed by the worker and being
   published. The connect sweep may PIN a scheduled row to `prior`; the departure trigger and the sweep revert
   'approved' rows ONLY. A WHERE clause containing 'scheduled' in any revert is a BLOCKER.

3. THE PIN WRITERS ARE A CLOSED LIST (R-2): service-role createPosts (generation), pin_post_account, the connect
   sweep, the FK's SET NULL - plus createPinnedDraftAsMember, which is an INSERT of a NULL pin followed by
   pin_post_account and therefore adds no writer. A raw client may never set or change the pin. Draft-only is
   enforced IN pin_post_account's body; the trigger cannot tell DEFINER callers apart and must not try.

4. resolvePublishAccount IS BYTE-FOR-BYTE UNCHANGED (lib/db/social-accounts.ts:203-220 at BASE).

5. NO USER ID FROM CLIENT INPUT. connected_by is written ONLY by upsert_social_account_connection, from the
   verified session user the callback passes it. The RPC re-verifies that user's membership and connect right
   itself (user_can reads auth.uid(), which is NULL under service-role).

6. NO BUSINESS ID FROM INPUT. Every route, loader and action takes the business from the server-side
   active-business resolver; every read applies .eq('business_id', businessId) - get_user_business_ids()
   returns an ARRAY. Every tenancy arm in Tier 1 uses ONE user in TWO businesses, with B's positive control.

7. EVERY DEFINER FUNCTION PASSES THE AUDIT GATE (section 13.4 plus R-8): search_path = public, pg_temp;
   REVOKE ALL from PUBLIC, anon, authenticated unless granted; the explicit grant in the table; business
   scoping re-checked inside; no dynamic SQL. Grants are ASSERTED by a Tier-1 test against the live database
   (the 20261004100000 hosted-drift lesson), not assumed from the migration text.

8. SHARED-FUNCTION CALLERS. Section 3.8 (with R-3's row) and section 4.6 are the tables: resolvePublishAccount,
   listActiveByBusinessAndPlatform, getActiveById, createPosts, createPinnedDraftAsMember, pinPostAccount /
   pin_post_account, the connect sweep, approvePost (posts/actions.ts and calendar/actions.ts),
   bulkApprovePostsAction -> bulkApproveDraftPosts (ApprovalsInbox.tsx AND PostsClient.tsx),
   buildCustomerContext and retrieveVoice. Before marking ANY constraint on a shared function tested, git grep
   its callers and state PER CALLER which test exercises it. A caller with no listed test is
   AUTHORED-NOT-EXECUTED for that caller.

9. CONTRACT DISCIPLINE. DB only via lib/db/; the service-role client only in generation, the connect callback's
   RPC call, the role-change and binding paths, the departure/erasure functions and the backfill apply, via the
   lazy-import pattern, never in a page or component; Zod on every Server Action and route input; every list
   query bounded with an explicit ORDER BY on an index; date-fns; no `any`; no console.*; env only via
   lib/config.ts; Server Components by default; shadcn v4 / Base UI with NO asChild; native <select> for every
   identity picker; Tailwind only; i18n en/pt/es IN THE SAME COMMIT as the string.

10. SCOPE (L-1). No Company Page posting, no OAuth scope change, no review-gated scope, no new voice table, no
    account dimension in MemoryScope/RetrieveScope, no new EmailKind, no per-plan account limit, no edit to
    lib/stripe/plan.ts, the pricing page, CLAUDE.md or content/legal/*.mdx, no [LEGAL ENTITY] touched, no
    typed failure code replacing account_ambiguous ([type-6], rejected). If a step appears to need any of
    these, STOP and report.

ECC BUDGET FOR THIS PHASE: FOUR subagent invocations, total. One ecc:code-explorer in P2.0. One
ecc:database-reviewer at the end of P2.2, before it commits. One ecc:security-reviewer at the end of P2.5,
before it commits, over P2.3-P2.5. One ecc:react-reviewer at the end of P2.11, before it commits. No reviewer
per step, no re-consultation, no type-design-analyzer (settled in P1), no pr-test-analyzer or
silent-failure-hunter (both are P3's), no e2e-runner (use the Playwright MCP tools directly). Record each
invocation's findings, and what you did with each, in the appended verification section (V.n). Skills are free:
/ecc:plan, /ecc:tdd-workflow, /ecc:verification-loop every code step;
supabase:supabase-postgres-best-practices in P2.2, P2.3, P2.4, P2.6, P2.8; claude-mem mem-search in P2.0.
impeccable, taste-skill, ui-ux-pro-max, emil-design-eng and break-ui run in P2.11 ONLY, against ADR 0032
section 11 and R-3/R-7, and may not change a gate, a state, a role word's meaning or the Server/Client split.

NO REAL PLATFORM. There is no production OAuth app. Run with SOCIAL_PROVIDER_MODE=mock and seeded data. The
five items of ADR 12.4 are recorded UNPROVEN, never passed. Make no live model call.

VERIFICATION, every step, IN THIS ORDER: npm run typecheck ; npm run lint ; npm run test:app ; npm run
test:db where the step touches DB behaviour. NEVER bare `npx vitest run`. If test:db fails, distinguish a
DB-behaviour regression from a local stack failure and say which. Every Tier-1 seed uses EXPLICIT status /
is_active values (cerebrum, Session 34 K1). Each named constraint must be DEMONSTRATED TO REDDEN against the
pre-fix code (or a planted violation, for a scan) and then reverted, WITH THE TRANSCRIPT PASTED INTO THE COMMIT
BODY. One commit per step, subject naming the step id and the constraints it closes, IN FULL. Evidence that is
not a commit body goes in an appended "## Builder verification (P2)" section at the END of ADR 0032, after
section 18 (V.1, V.2, ...); nothing above it is edited.

Acknowledge in ONE line: the BASE SHA, the A-10 ruling as recorded in section 0.2 and section 19's two
constraint names, confirmation you have read ADR 0032 sections 1-18, and that you understand rule 2 (never
revert 'scheduled'), rule 3 (the closed writer list) and rule 5 (connected_by from the verified session only).
Then STOP and wait for P2.0.
```

### §2b — Builder steps

Each step is one paste and one commit. **A step that closes no ADR constraint does not exist.** `P2.0` is the
deliberate exception: it carries the premise risk and the hosted pre-flight. **Every constraint is closed by exactly
one step.** Where a constraint has a half authored earlier, the step that lands its last half closes it, and the
table says so. **Do not claim a count until it is executed green in CI at the head it is dated to** (Session 28's
false *"29/29"*).

| Step | What it ships | Constraints closed (ADR §14 / §18 #) | Tier |
|---|---|---|---|
| **P2.0** | **Grounding, the hosted pre-flight (read-only), baselines. No code, no commit** · `code-explorer` | — | — |
| **P2.1** | `lib/social/founder-source-scans.test.ts`: every Tier-3 absence, with planted pairs | 6, 28, 39, 41, 42 *(authors the scan halves of 8, 47, 50)* | 3 (scan-guarded) |
| **P2.2** | **Migration A**: role, `connected_by`, `voice_variation_id`, `approval_delegated` (§19), CHECKs, three UNIQUEs, posts composite FK, the partial index, `campaign_targets`, variation widening + RLS; §D2.5 row · **database-reviewer** | 7, 11, 19, 21, 29, 33, 34, 43, 44 | 1 |
| **P2.3** | **Migration B1**: the posts INSERT trigger, the extended transition trigger (with §19's delegation branch), `pin_post_account`, `set_founder_approval_delegation` | 2, 3, 4, 5, 15, 16, 36, 37 *(authors the DB half of 55)* | 1 |
| **P2.4** | **Migration B2**: `upsert_social_account_connection` with the R-1/R-4/R-5 sweep | 13, 22, 23, 52, 53 *(authors 49's sweep arm)* | 1 |
| **P2.5** | Role module, signed state, cookie nonce, callback rewired to the RPC · **security-reviewer** | 8, 9, 17, 18, 20, 47 | 1 + 2 |
| **P2.6** | **Migration B3**: the member-removal trigger (DEFINER, `approved` only), the user-erasure function; the disconnect authority, order and lock; `revokeMemberAction`; the role-change path | 10, 24, 25, 26, 27, 49 | 1 + 2 |
| **P2.7** | `resolveCampaignTargets`, `campaign_targets` lib/db + action, the `createPosts` identity union, generation, promote (R-3), `pinPostAccount` | 1, 12, 50, 51 | 1 + 2 |
| **P2.8** | **Migration B4**: `create_voice_variation` widened (old signature dropped), the ratify role assertion; `retrieveVoice` merge, the voice target, every caller; backfill founder branch | 30, 31, 32, 35, 48 | 1 + 2 |
| **P2.9** | Bulk approve: the filter in the WHERE, typed retry, both callers | 14, 38 | 1 + 2 |
| **P2.10** | UI: accounts (with the delegation toggle), step-3, campaign targeting, per-post identity, waiting/cold/mismatch/departed states, founder `VoiceEditor`, Studio promote picker, the "Personal" label | 54, 55, 56 | 1 + 2 |
| **P2.11** | Design pass: impeccable → taste-skill (if generic) → ui-ux-pro-max → emil-design-eng → break-ui; the real-browser measurement · **react-reviewer** | 45, 46 | 2 + manual QA |
| **P2.12** | Constraint→CI map, callers report, ADR amendment notes, launch-checklist and backlog rows, the PR | 40 | 3 |

**Tally: 0 + 5 + 9 + 8 + 5 + 6 + 6 + 4 + 5 + 2 + 3 + 2 + 1 = 56.** #55 has its DB half authored in `P2.3` (the setter
and the trigger branch, with the reset in `P2.4`) and closes in `P2.10` with its UI half. Every
commit subject and test title uses the full constraint name.

The thirteen pastes follow, one per step.

#### P2.0 — Grounding, the hosted pre-flight and baselines  ·  no code, no commit

```
BUILDER - Session 38 - P2.0. NO CODE, NO COMMIT. Produce a premise -> file:line -> still-true? table, the hosted
pre-flight result, and the BASELINES later steps are measured against. If a premise has drifted, the step that
depends on it is NOT built until the drift is reconciled and recorded here as V.1.

ECC BUDGET INVOCATION 1 of 4. Invoke ecc:code-explorer ONCE over exactly this closed file list and no other:
  lib/db/social-accounts.ts, posts.ts, types.ts (SocialAccountRow/Public/Update, PostRow/Insert/Update,
  CampaignRow, MemoryScope), backfill-runs.ts, voice.ts, business-members.ts
  lib/social/index.ts, lib/social/oauth/state.ts, lib/social/platforms/config.ts, lib/social/constants.ts
  app/api/social/[platform]/connect/route.ts, callback/route.ts, disconnect/route.ts
  lib/publishing/orchestrator.ts, lib/metrics/orchestrator.ts
  lib/campaigns/generate.ts, promote.ts, enforcement.ts, brief.ts, planner/orchestrator.ts
  lib/memory/voice.ts, lib/memory/scoring.ts, lib/ai/context.ts (buildCustomerContext)
  lib/learning/orchestrator.ts
  app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts, PostsClient.tsx
  app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx, app/[locale]/(dashboard)/calendar/actions.ts
  app/[locale]/(dashboard)/settings/team/actions.ts (revokeMemberAction)
  app/[locale]/(dashboard)/settings/accounts/AccountsClient.tsx, components/social/PlatformConnectionCard.tsx
  the onboarding step-3/Step3Client.tsx, step-2/VoiceReviewHost.tsx and the backfill-actions.ts /
  BackfillPanel.tsx pair, components/voice/VoiceEditor.tsx, VariationManager.tsx
  supabase/migrations/20260430120006_social_accounts.sql, 20260430120008_social_accounts_trial_trigger.sql,
  20260430120010_posts.sql, 20260702120300_posts_role_aware_and_status_trigger.sql,
  20260524230000_publishing_worker.sql, 20260525100000_publishing_worker_helpers.sql,
  20260616210000_publish_complete_rpc.sql, 20260623210000_voice_axes.sql,
  20260904100000_posts_social_account_id.sql, 20260913120000_social_accounts_identity_lock.sql,
  20260915120000_backfill_correction_pass.sql, 20260702120700_purge_business_member_delete.sql
  supabase/__tests__/posts-approval-boundary.test.ts, posts-social-account-id.test.ts,
  social-accounts-identity-lock.test.ts, security-definer-client-exec-allowlist.test.ts
  lib/signals/source-scans.test.ts
Ask it ONE question: "for each file, with line numbers: exported functions and which Supabase client each uses;
every write to posts.social_account_id, posts.status, social_accounts and brand_voice_variations; every caller
of resolvePublishAccount, listActiveByBusinessAndPlatform, getActiveById, createPosts, approvePost,
bulkApprovePostsAction/bulkApproveDraftPosts, buildCustomerContext and retrieveVoice; how the OAuth state is
signed and verified; how revokeMemberAction and the owner erasure flow (ADR 0010 D2.7) are ordered; and the
shape of an existing source-scan test." Do not ask it to propose changes.

Skill (free): claude-mem mem-search for Session 30.5 (ADR 0028 dual identity), 32 (backfill role), 36-D (the
DEFINER grant drift) and 37 (the NULL account bucket).

VERIFY THESE PREMISES. Each is load-bearing for a named later step.
1. HOSTED PRE-FLIGHT (P2.2). Using the supabase MCP execute_sql tool with a SELECT ONLY - never a write, never
   apply_migration - count (business_id, platform) groups with more than one is_active social_accounts row, and
   the total legacy rows by platform. Record both as V.1. If any group exists, STOP: the pre-flight would raise
   on deploy, and which row becomes inactive is a founder decision.
2. 'scheduled' IS CLAIMED (P2.4, P2.6). Quote claim_posts_for_publishing (20260524230000:27-41) and
   publish_post_complete's WHERE (20260616210000:30). Confirm nothing else sets status = 'scheduled'.
3. THE UI NEVER SCHEDULES (P2.3). Confirm calendar/actions.ts and posts/actions.ts never write 'scheduled'.
4. EVERY DEFINER FUNCTION THAT WRITES posts (P2.3, rule 7): list each with file:line and its current grants -
   at least claim_posts_for_publishing, publish_post_complete, reap_stuck_scheduled_posts, the learning
   writers; and reschedule_posts_batch's security mode. These are named in the P2.3 report.
5. PROMOTE (P2.7). Confirm promoteDraftToCampaignCore runs on the passed authenticated client
   (promote.ts:73, 99, 116) and inserts status 'draft' - R-3 relies on it.
6. COLUMN-LIST SET NULL (P2.2). Confirm supabase/config.toml major_version = 17 and the local stack runs 17.
7. THE CALLERS (P2.7-P2.9). Produce the ACTUAL tables for ADR 3.8 and 4.6 at BASE. If buildCustomerContext's
   caller count or any file:line differs from the ADR, record the real one as V.1 - the step that consumes it
   uses the real table, and the difference is noted, not "fixed" in the ADR.
8. BASELINES (V.2): the DEFINER audit gate's function count (the security-definer-client-exec-allowlist query);
   the test counts of posts-approval-boundary, posts-social-account-id, social-accounts-identity-lock, the
   publishing and metrics orchestrator tests, lib/memory/voice tests, ApprovalsInbox.test.tsx,
   PostsClient.test.tsx and posts/actions.test.ts; and a sha256 of lib/db/social-accounts.ts lines 203-220
   (resolvePublishAccount) for P2.1's byte-identity scan.

Output: the premise table, V.1 (pre-flight, drift, decisions), V.2 (baselines). Then STOP and wait for P2.1.
```

#### P2.1 — Absence scans  ·  Tier 3, scan-guarded

```
BUILDER - Session 38 - P2.1. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: lib/social/founder-source-scans.test.ts, modelled on lib/signals/source-scans.test.ts. The scans come
BEFORE the code they fence, so a violation introduced in P2.2-P2.11 fails CI the moment it lands. Each
property is TIER 3 by ADR 12.3; the scan is a guard, not an upgrade - title each test with its constraint name
and "(Tier 3 guard)".

THE SCANS, each with a PLANTED POSITIVE and a PLANTED NEGATIVE inside the test file, written in the detector's
OWN vocabulary (cerebrum 2026-09-24):
 #6  IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED - the source of resolvePublishAccount equals the V.2 sha256
     (extract the function body by its signature, not by line numbers).
 #28 FOUNDER-VOICE-THROUGH-EXISTING - no migration after BASE contains CREATE TABLE whose name matches /voice/
     other than the existing brand_voices and brand_voice_variations.
 #39 FOUNDER-MEMORY-PROVENANCE - the MemoryScope union in lib/db/types.ts and RetrieveScope in
     lib/memory/scoring.ts equal their BASE literals; no 'account' scope string in lib/memory/**.
 #41 FOUNDER-NO-REVIEW-GATED-SCOPE - PLATFORM_CONFIGS' LinkedIn and X scope arrays equal, exactly, the BASE
     arrays (openid profile email w_member_social; tweet.read tweet.write users.read offline.access); no
     r_member_social, r_member_postAnalytics, w_organization_social or r_organization_social anywhere under
     lib/social/ or app/api/social/.
 #42 FOUNDER-NO-ORG-POSTING - no organization connect flow and no org-author publish branch: no
     'urn:li:organization' constructed in lib/social/platforms/linkedin*, and isOrganizationAuthorUrn has no new
     caller.
AUTHOR NOW, CLOSED LATER (the arm lands here; the constraint closes in the step named):
 #8  no role derived from a URN prefix - no isOrganizationAuthorUrn / 'urn:li:person' test feeding an
     account_role value (closes P2.5);
 #47 connected_by is assigned only inside upsert_social_account_connection; no lib/, app/ or components/ file
     writes a connected_by property (closes P2.5);
 #50 IDENTITY-PIN-WRITERS-CLOSED - the only TypeScript writers of social_account_id on posts are createPosts
     (service-role path) and the pinPostAccount / createPinnedDraftAsMember wrappers; the only SQL writers are
     pin_post_account and upsert_social_account_connection (closes P2.7).

VERIFICATION: typecheck, lint, test:app. REDDEN each scan against its planted positive and paste the
transcript into the commit body.

CONSTRAINTS CLOSED (Tier 3, scan-guarded): 6 IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED,
28 FOUNDER-VOICE-THROUGH-EXISTING, 39 FOUNDER-MEMORY-PROVENANCE, 41 FOUNDER-NO-REVIEW-GATED-SCOPE,
42 FOUNDER-NO-ORG-POSTING. Scan halves AUTHORED: 8, 47, 50.

Commit: "P2.1 IDENTITY-RESOLVER-FAIL-CLOSED-UNCHANGED FOUNDER-VOICE-THROUGH-EXISTING FOUNDER-MEMORY-PROVENANCE
FOUNDER-NO-REVIEW-GATED-SCOPE FOUNDER-NO-ORG-POSTING (Tier-3 scans; halves of 8/47/50 authored)".
```

#### P2.2 — Migration A, the cascade row, and the database review

```
BUILDER - Session 38 - P2.2. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skill (free):
supabase:supabase-postgres-best-practices.

SHIP ONE MIGRATION, its Tier-1 tests, and the ADR 0010 Amendment 2 section D2.5 row IN THE SAME COMMIT. Do NOT
apply it to the hosted database.

THE MIGRATION (ADR 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.6, 13), its header naming ADR 0032 and Amendment R:
 1. PRE-FLIGHT: a DO block that RAISES, naming the business_id and platform, if any (business_id, platform) has
    more than one is_active social_accounts row.
 2. social_accounts.account_role: add nullable; UPDATE every row to 'brand'; SET NOT NULL; named CHECK IN
    ('brand','founder'); NO default.
 3. social_accounts.connected_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL; named CHECK
    account_role <> 'founder' OR is_active = false OR connected_by IS NOT NULL.
 4. UNIQUE (id, business_id) on campaigns and on brand_voice_variations; UNIQUE (id, business_id, platform) on
    social_accounts - each named.
 5. social_accounts.voice_variation_id uuid NULL, composite FK (voice_variation_id, business_id) ->
    brand_voice_variations (id, business_id) ON DELETE SET NULL (voice_variation_id); named CHECK
    voice_variation_id IS NULL OR account_role = 'founder'.
 6. posts: DROP posts_social_account_id_fkey; ADD a NAMED composite FK (social_account_id, business_id,
    platform) -> social_accounts (id, business_id, platform) ON DELETE SET NULL (social_account_id). Correct the
    "one row per (campaign, platform)" header comment of 20260430120010 in THIS migration's comment (the old
    file is never edited).
 7. ONE named partial unique index on social_accounts (business_id, platform, account_role) WHERE is_active.
 8. campaign_targets exactly as ADR 3.2: PK (campaign_id, platform); social_account_id NOT NULL; composite FKs
    with ON DELETE CASCADE; business_id -> businesses ON DELETE CASCADE; indexes on social_account_id and
    business_id; RLS enabled; SELECT for members; INSERT/UPDATE/DELETE with (SELECT
    public.user_can(business_id,'author')); all in the InitPlan form; UPDATE with USING AND WITH CHECK; anon
    revoked. A comment stating it cascades from the purge_business root DELETE (20260702120700:62).
 9. brand_voice_variations: keywords text[] NULL, avoid_words text[] NULL, writing_examples text[] NULL with
    the named CHECK writing_examples IS NULL OR cardinality(writing_examples) <= 3. NO tone column. Replace
    its RLS policies (20260623210000:88-103) per ADR 13.2.
10. account_role, connected_by and voice_variation_id are NOT added to the 20260913120000 UPDATE allowlist.
11. ADR section 19.1: social_accounts.approval_delegated boolean NOT NULL DEFAULT false; named CHECK
    approval_delegated = false OR account_role = 'founder'; NOT added to the UPDATE allowlist. Tier 1: the
    default, the CHECK, and authenticated UPDATE refused 42501.
Then the D2.5 row for campaign_targets VERBATIM from ADR 0032 section 13.1.

TIER 1 (supabase/__tests__/founder-identity-schema.test.ts; ADR 12.1 items 1, 2, 3 (FK arms), 7, 8 (CHECK
and RLS arms)): account_role NOT NULL and CHECK; the connected_by CHECK; the voice_variation_id CHECK and its
composite FK (B's variation on A's account refused); authenticated UPDATE of each of the three columns refused
with error.code 42501 - NOT merely a non-null error; a second active founder AND a second active brand
refused per platform while inactive rows do not count; the posts composite FK refuses B's account on A's post
(service-role INSERT) and a wrong-platform pin, and an account delete nulls ONLY the pin; campaign_targets RLS
(member reads, viewer write refused, author writes, UPDATE USING/WITH CHECK, one user in A and B cannot target
B's account from A's campaign), cascade from campaigns and businesses, purge_business removes it; variation
RLS: a viewer insert refused, 4 examples refused, [] accepted and distinct from NULL. The pre-flight: seed two
active rows on one platform in a scratch schema state and show the migration RAISES naming the business.

ECC BUDGET INVOCATION 2 of 4 - BEFORE YOU COMMIT. Dispatch ecc:database-reviewer ONCE, read-only, over the
migration, the Tier-1 file and the D2.5 diff. Its question: "against ADR 0032 sections 3.1-3.3, 4.1, 4.3, 5.1,
5.6, 13 and Amendment R: is any constraint, FK action, index, policy, grant or cascade wrong or missing; does
the backfill-then-NOT-NULL ordering hold under concurrent inserts; does the column-list SET NULL behave on PG
17 as the ADR assumes; is any policy not in the InitPlan form?" Fix what it finds here, before the commit.
Record its findings and your disposition as V.3.

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: drop the partial index and show the second-founder
test fails; grant UPDATE (account_role) to authenticated and show the 42501 test fails; revert to the
single-column FK and show the cross-tenant pin test fails.

CONSTRAINTS CLOSED (Tier 1): 7 IDENTITY-ROLE-PERSISTED, 11 IDENTITY-CAMPAIGN-TARGET-ONE-PER-PLATFORM,
19 FOUNDER-OWNER-NOT-MEMBER-UPDATABLE, 21 FOUNDER-ONE-PER-PLATFORM, 29 FOUNDER-VOICE-WIDENED,
33 FOUNDER-VOICE-BINDING-TENANT, 34 FOUNDER-VARIATION-RLS-HARDENED, 43 FOUNDER-PLAN-ENFORCED-SERVER,
44 FOUNDER-CASCADE-COMPLETE.

Commit: "P2.2 IDENTITY-ROLE-PERSISTED IDENTITY-CAMPAIGN-TARGET-ONE-PER-PLATFORM FOUNDER-OWNER-NOT-MEMBER-UPDATABLE
FOUNDER-ONE-PER-PLATFORM FOUNDER-VOICE-WIDENED FOUNDER-VOICE-BINDING-TENANT FOUNDER-VARIATION-RLS-HARDENED
FOUNDER-PLAN-ENFORCED-SERVER FOUNDER-CASCADE-COMPLETE (Migration A, D2.5 row; database-reviewer V.3)".
```

#### P2.3 — Migration B1: the posts trigger contract and `pin_post_account`

```
BUILDER - Session 38 - P2.3. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skill (free):
supabase:supabase-postgres-best-practices.

SHIP ONE MIGRATION and its Tier-1 tests. This closes bug-1948 (A-6) and lands founder-only approval (A-4).
READ ADR 6.1 AND 18 R-2 TOGETHER: R-2 replaces section 3.3 rule (ii) and section 6.1's fourth row.

THE MIGRATION:
 1. A NEW BEFORE INSERT trigger on posts. For a raw client (current_user IN ('authenticated','anon')):
    status IN ('draft','skipped') AND social_account_id IS NULL, else RAISE with a named message.
 2. enforce_post_transition_capability EXTENDED (20260702120300), for a raw client only:
    - UPDATE that changes social_account_id: refused, WHATEVER the status (R-2);
    - status changing INTO 'approved' or 'scheduled' from any other status: user_can(business,'approve') AND an
      active pin unless the business has NO active account on that platform AND, if the pinned account's
      account_role = 'founder', auth.uid() IS NOT DISTINCT FROM connected_by with connected_by NOT NULL;
      OR, per ADR 19.1, approval_delegated = true on that account (approve still required; a NULL
      connected_by is still approvable by nobody);
    - any other status change: user_can(business,'author'), unchanged.
    SET search_path pinned. The founder lookup reads social_accounts through the post's own pin.
    The trigger does NOT try to tell DEFINER callers apart (R-2) - say so in a comment.
 3. pin_post_account(p_post_id uuid, p_account_id uuid): SECURITY DEFINER; SET search_path = public, pg_temp;
    REVOKE ALL from PUBLIC, anon; GRANT EXECUTE to authenticated only. Body: lock the post FOR UPDATE; require
    user_can(post.business_id,'author'); require status = 'draft' AND deleted_at IS NULL (THE draft-only rule
    lives HERE); require the account is_active and of the post's business and platform (the FK re-asserts the
    last two). Typed RAISE messages for each refusal.
 4. set_founder_approval_delegation(p_account_id uuid, p_enabled boolean), exactly ADR 19.1: SECURITY DEFINER;
    search_path = public, pg_temp; REVOKE from PUBLIC, anon; GRANT EXECUTE to authenticated only. Lock the
    account FOR UPDATE; require account_role = 'founder', is_active, connected_by IS NOT NULL AND connected_by =
    auth.uid(), and the caller still an active member. An admin or owner is REFUSED.
Audit every existing DEFINER function that writes posts (P2.0 premise 4) against the new rules and list each
in the commit body with its verdict.

TIER 1 (supabase/__tests__/posts-founder-approval.test.ts, extending posts-approval-boundary.test.ts's
fixtures; ADR 12.1 item 4 as amended by R-2): raw INSERT of 'approved' and of 'scheduled' refused (bug-1948);
raw INSERT with a pin refused; raw 'draft' -> 'scheduled' refused; raw UPDATE of the pin refused on a DRAFT;
pin_post_account on a draft succeeds and on an approved post is refused BY ITS BODY; pin_post_account with
B's account from a user in A and B refused (FK); approval of an unpinned post refused when the platform has an
active account, allowed when it has none; approval with a pin to an inactive account refused; a founder post
approved by its connector succeeds, by another approver refused, by the owner refused, with a NULL connector
refused; unapprove (approved -> draft) by an author still allowed; claim_posts_for_publishing still moves
approved -> scheduled (service path exempt); purge_business with pinned published posts succeeds. Every
pre-existing posts-approval-boundary arm still green - nothing approvable now that was not before (#36).

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: remove the INSERT trigger (bug-1948 arms fail);
drop the founder arm (the "another approver" arm fails); move the draft check out of pin_post_account (the
approved-pin arm fails).

CONSTRAINTS CLOSED (Tier 1): 2 IDENTITY-SETTER-TENANT-CHECKED, 3 IDENTITY-PIN-RAW-WRITE-REFUSED,
4 IDENTITY-PIN-DRAFT-ONLY (in the body, R-2), 5 IDENTITY-APPROVE-REQUIRES-ACTIVE-PIN,
15 APPROVAL-GATE-INSERT-CLOSED, 16 APPROVAL-GATE-SCHEDULED-CLOSED, 36 FOUNDER-APPROVAL-NOT-RELAXED,
37 FOUNDER-APPROVAL-ENFORCED-IN-DB (as amended by section 19). AUTHORED: 55's DB half (the setter and the branch;
closed in P2.10).

Commit: "P2.3 IDENTITY-SETTER-TENANT-CHECKED IDENTITY-PIN-RAW-WRITE-REFUSED IDENTITY-PIN-DRAFT-ONLY
IDENTITY-APPROVE-REQUIRES-ACTIVE-PIN APPROVAL-GATE-INSERT-CLOSED APPROVAL-GATE-SCHEDULED-CLOSED
FOUNDER-APPROVAL-NOT-RELAXED FOUNDER-APPROVAL-ENFORCED-IN-DB (Migration B1; closes bug-1948)".
```

#### P2.4 — Migration B2: the connect RPC and the sweep

```
BUILDER - Session 38 - P2.4. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skill (free):
supabase:supabase-postgres-best-practices.

SHIP ONE MIGRATION and its Tier-1 tests: upsert_social_account_connection, exactly ADR 5.3 as amended by
R-1, R-4 and R-5. SECURITY DEFINER; search_path = public, pg_temp; REVOKE ALL from PUBLIC, anon,
authenticated; GRANT EXECUTE to service_role ONLY (it takes the user id as a parameter).

THE BODY, in order:
 1. pg_advisory_xact_lock on (business_id, platform) - the key derivation in a comment; disconnect (P2.6) takes
    the same one.
 2. Re-verify p_user_id is an ACTIVE member of p_business_id holding connect_accounts (user_can cannot be used:
    auth.uid() is NULL under service-role). Refuse invalid_state otherwise.
 3. SELECT ... FOR UPDATE the row on (business_id, platform, platform_user_id). NOT INSERT ... ON CONFLICT.
 4. Decide, in THIS order (R-4's row first):
    - any row with connected_by IS NULL -> fresh declaration (declared role, connected_by = p_user_id),
      subject to the role-change guard;
    - none -> INSERT with the declared role and connected_by = p_user_id;
    - founder, connected_by IS NOT DISTINCT FROM p_user_id -> refresh tokens, reactivate, role UNCHANGED;
    - founder, connector a different STILL-ACTIVE member -> refuse reconnect_owned_by_other, write NOTHING;
    - founder, inactive row whose connector is no longer an active member -> fresh declaration;
    - brand -> refresh tokens, reactivate, connected_by = p_user_id, role unchanged.
    THE ROLE-CHANGE GUARD (R-4): refuse role_change_blocked, writing nothing, if (a) any non-draft post is
    pinned to the account, or (b) the account is the platform's ONLY active account and any 'approved' or
    'scheduled' UNPINNED post exists on that business and platform.
 5. Vault secrets created INSIDE the transaction through the existing wrappers; the prior secret ids read under
    the row lock and deleted AFTER the row points at the new ones.
 6. The UPDATE branch NEVER writes id. Every FRESH DECLARATION (the connected_by IS NULL row and the
    departed-founder row) and every role change away from 'founder' writes approval_delegated = false (ADR 19.1);
    a same-founder reconnect leaves it unchanged.
 7. Unique violations from the partial index translated to founder_exists / brand_exists.
 8. THE SWEEP (R-1 table, R-5 trigger). It runs iff this connect leaves an active account on the platform that
    was not active a moment before (INSERT or reactivation). prior = the single OTHER active account just
    before. Apply R-1's table cell by cell. NO statement in the sweep changes the status of a 'scheduled' row;
    its only revert is WHERE status = 'approved'.
 9. Return the account id and the outcome.

TIER 1 (supabase/__tests__/social-connect-rpc.test.ts; ADR 12.1 item 5 plus R-1, R-4, R-5 arms): insert;
same-founder reconnect; another active member's reconnect refused WITH NO SECRET ORPHANED (count vault rows
before/after); an admin re-declaring an inactive founder row whose connector left; brand refresh; id unchanged
on reconnect; a reactivation breaching the index gives founder_exists; two concurrent connects serialised
(two connections, one blocks on the lock); EVERY CELL of R-1's table, including: a 'scheduled' unpinned post
with prior founder is PINNED and its status is STILL 'scheduled', and publish_post_complete then returns it
as 'published'; R-5: deactivate the founder, keep the brand, seed unpinned posts in every status, reconnect
the founder - the table applies with prior = brand; R-4: a legacy row with connected_by NULL re-declared as
founder; guard (b) refuses with role_change_blocked; authenticated EXECUTE refused (42501).

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: add 'scheduled' to the sweep's revert WHERE (the
IDENTITY-REVERT-SKIPS-CLAIMED sweep arm fails); skip the sweep on reactivation (the R-5 arm fails); write id in
the UPDATE branch (the id arm fails).

CONSTRAINTS CLOSED (Tier 1): 13 IDENTITY-CONNECT-SWEEP-ATOMIC, 22 FOUNDER-RECONNECT-NO-TAKEOVER,
23 FOUNDER-RECONNECT-NO-PK-REWRITE, 52 IDENTITY-REACTIVATION-SWEEPS, 53 IDENTITY-LEGACY-ROLE-REDECLARED.
AUTHORED: 49 IDENTITY-REVERT-SKIPS-CLAIMED (sweep arm; closes at P2.6 with the departure arm).

Commit: "P2.4 IDENTITY-CONNECT-SWEEP-ATOMIC FOUNDER-RECONNECT-NO-TAKEOVER FOUNDER-RECONNECT-NO-PK-REWRITE
IDENTITY-REACTIVATION-SWEEPS IDENTITY-LEGACY-ROLE-REDECLARED (Migration B2: connect RPC + R-1/R-4/R-5 sweep;
49 sweep arm authored)".
```

#### P2.5 — The role module, the signed state, the cookie nonce, the callback, and the security review

```
BUILDER - Session 38 - P2.5. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP (ADR 3.1, 5.1, 5.3 step 8, 13.3):
 1. ONE role module under lib/social/ exporting ACCOUNT_ROLES = ['brand','founder'] as const, AccountRole and
    its Zod enum; re-exported by lib/social/index.ts. Replace the inline literals at lib/db/backfill-runs.ts:374
    and lib/validation/backfill.ts:18. SocialAccountRow gains account_role, connected_by, voice_variation_id;
    SocialAccountPublic becomes DISCRIMINATED on role; founder-gated logic takes the narrowed founder type.
    A parity test pins the tuple to the P2.2 CHECK (parse the migration text).
 2. lib/social/oauth/state.ts: claims { businessId, platform, nonce, locale, userId, role }; role parsed with
    the shared enum; an old-format state (no userId or no role) REJECTED.
 3. connect/route.ts: require user_can(business,'connect_accounts') as today and the role field (Zod, the
    shared enum); sign userId = the session user; set the nonce cookie httpOnly, Secure, SameSite=Lax, path
    /api/social, 10-minute max-age.
 4. callback/route.ts, BEFORE the code exchange and BEFORE any vault call: a valid JWT; cookie nonce === claim
    nonce (delete the cookie on use); auth.getUser().id === claims.userId; user_can(claims.businessId,
    'connect_accounts') re-checked. Then the exchange, then ONE call to upsert_social_account_connection via a
    lib/db wrapper (service-role, lazy import) passing the VERIFIED session user. The old client-side upsert
    (callback/route.ts:137-163) is DELETED. Map outcomes to the existing error-redirect convention, gaining
    reconnect_owned_by_other, founder_exists, brand_exists, invalid_state, role_change_blocked.
 5. Every new error code localised in en, pt and es in THIS commit.

TIER 2 (app/api/social/**/*.test.ts, lib/social/oauth/*.test.ts): state claims parsed with the shared enum;
unknown and missing role rejected; an old-format state rejected; cookie-nonce mismatch, session-user mismatch
and user_can false EACH refused with ZERO calls to the token exchange and ZERO vault/RPC calls (a recording
mock proves the absence); the RPC receives the session user, never a client-supplied id; every outcome mapped
to its redirect and its key present in all three locales; the declared role reaches the RPC unchanged
(IDENTITY-ROLE-NOT-FROM-URN: a person URN with role 'brand' stays brand). P2.1's #8 and #47 scan arms now run
against real roots.

ECC BUDGET INVOCATION 3 of 4 - BEFORE YOU COMMIT. Dispatch ecc:security-reviewer ONCE, read-only, over the
P2.3 and P2.4 migrations and this step's diff (state.ts, connect, callback, the RPC wrapper). Its question:
"against ADR 0032 sections 3.3, 5.1, 5.3, 6.1 and Amendment R: can any client path approve a post without a
fresh approver transition, approve a founder post as someone other than its connector, set or change a pin,
forge connected_by, take over another member's founder account, orphan or leak a vault secret, or reach the
exchange or the vault before the nonce, session and user_can checks?" Fix what it finds here, before the
commit. Any finding in the already-committed P2.3/P2.4 migrations is fixed by a NEW migration in this commit
(never an edit). Record its findings and your disposition as V.4.

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: skip the cookie check (the nonce arm fails);
take userId from the query string (the #47 scan and the session arm fail); delete the parity test's literal.

CONSTRAINTS CLOSED: 8 IDENTITY-ROLE-NOT-FROM-URN (2 + 3), 9 IDENTITY-ROLE-CLOSED-UNION (2),
17 FOUNDER-CONNECTED-BY-SELF (1 + 2), 18 FOUNDER-OWNER-UNFORGEABLE (2), 20 FOUNDER-CALLBACK-RECHECKS (2),
47 FOUNDER-NO-USER-ID-FROM-CLIENT (3).

Commit: "P2.5 IDENTITY-ROLE-NOT-FROM-URN IDENTITY-ROLE-CLOSED-UNION FOUNDER-CONNECTED-BY-SELF
FOUNDER-OWNER-UNFORGEABLE FOUNDER-CALLBACK-RECHECKS FOUNDER-NO-USER-ID-FROM-CLIENT (role module, signed state,
cookie nonce, callback via RPC; security-reviewer V.4)".
```

#### P2.6 — Migration B3: departure, erasure, disconnect and role change

```
BUILDER - Session 38 - P2.6. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skill (free):
supabase:supabase-postgres-best-practices.

SHIP ONE MIGRATION, the app changes, and their tests (ADR 3.1, 5.5, 5.7, 13.4; R-1, R-4, R-8; A-8').
 1. THE MEMBER-REMOVAL TRIGGER on business_members, AFTER UPDATE when status becomes 'revoked' and AFTER
    DELETE. Its function is SECURITY DEFINER, search_path = public, pg_temp, EXECUTE revoked from PUBLIC, anon,
    authenticated (R-8). In one transaction: is_active = false on every founder-role social_accounts row in that
    business whose connected_by is that user; then revert that account's pinned posts WHERE status =
    'approved' ONLY (R-1, A-8') to draft. It changes status only, never the pin. It does NOT null the vault ids.
 2. THE USER-ERASURE FUNCTION (service_role only): disconnect every founder row the user connected across all
    their businesses, then return; the Auth admin delete is the caller's next step. A lib/db wrapper plus its
    one caller in the owner/member erasure path (P2.0 named it). No trigger on auth.users.
 3. DISCONNECT (disconnect/route.ts, lib/db/social-accounts.ts): takes the P2.4 advisory lock; founder row - its
    connector OR an admin, anyone else refused (narrowed founder type); brand row - connect_accounts as today;
    two identities and no accountId -> 409. ORDER: deactivate, then revert pinned APPROVED founder posts, then
    the three GDPR steps (deactivateSocialAccount, unchanged otherwise).
 4. revokeMemberAction (settings/team/actions.ts): after the trigger, complete the three GDPR steps for the
    accounts it deactivated, and clear writing_examples on each one's bound variation (axes and keywords kept).
 5. THE ROLE-CHANGE PATH: a service-role lib/db function + a Zod-validated Server Action; only the account's
    connecting member; the R-4 guard (a) AND (b), refusing with role_change_blocked. If you build it as an RPC,
    name it set_social_account_role, service_role only.

TIER 1 (supabase/__tests__/founder-departure.test.ts): revoke and member delete both deactivate the founder row
and revert its APPROVED posts; a 'scheduled' post pinned to the departing founder keeps status 'scheduled'
(the departure arm of #49) and the resolver then fails it closed on is_active; brand rows the leaver connected
are untouched; the residue query (inactive founder row with vault ids) returns the row until the action
completes; deleting an auth user who connected an ACTIVE founder row raises the NAMED check_violation, and
succeeds after the erasure function ran; the trigger function's grants asserted live.
TIER 2: disconnect authority (connector allowed, admin allowed, other approver refused, brand unchanged);
the 409; the revert-before-secret-delete order (a recording mock); revokeMemberAction completes the GDPR
steps and clears examples; the role-change action refused for a non-connector, for guard (a), for guard (b).

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: add 'scheduled' to the trigger's revert WHERE
(#49's departure arm fails); let an approver disconnect a founder row; drop guard (b).

CONSTRAINTS CLOSED: 10 IDENTITY-ROLE-CHANGE-GUARDED (1 + 2), 24 FOUNDER-DISCONNECT-AUTHORITY (2),
25 FOUNDER-DISCONNECT-GDPR (1 + 2), 26 FOUNDER-DEPARTURE-HANDLED (A-8') (1 + 2), 27 FOUNDER-ERASURE-ORDERED (1),
49 IDENTITY-REVERT-SKIPS-CLAIMED (1; both arms now exist).

Commit: "P2.6 IDENTITY-ROLE-CHANGE-GUARDED FOUNDER-DISCONNECT-AUTHORITY FOUNDER-DISCONNECT-GDPR
FOUNDER-DEPARTURE-HANDLED FOUNDER-ERASURE-ORDERED IDENTITY-REVERT-SKIPS-CLAIMED (Migration B3: departure
trigger, erasure function, disconnect order, role change)".
```

#### P2.7 — Targeting: the plan, generation, promote and the re-pin path

```
BUILDER - Session 38 - P2.7. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP (ADR 3.2-3.8; R-3):
 1. lib/campaigns/resolve-targets.ts: resolveCampaignTargets(campaign, activeAccounts, targetRows) returning
    ok (a read-only plan keyed by EVERY platform in campaign.platforms; each entry pinned {identity, role} or
    unconnected) or error (missing_target | target_inactive | target_platform_mismatch). The single-account
    auto-fill lives INSIDE it. The PinnedIdentity brand is constructible only here.
 2. lib/db/campaign-targets.ts + a Zod-validated Server Action on campaign create/edit: platform must be in
    campaigns.platforms; account active; authenticated client under P2.2's RLS.
 3. createPosts accepts a base insert plus an identity that is PINNED (from the plan) or NO-ACCOUNT-YET (from a
    helper that has just observed zero active accounts). A bare null does not compile.
 4. lib/campaigns/generate.ts consumes ONLY the plan; missing_target refuses generation with a typed error.
 5. lib/campaigns/promote.ts per R-3, IN ORDER: resolve targets (reads only) BEFORE the ADR 0022 claim, with an
    optional Zod-validated socialAccountId; claim, create campaign, write back (unchanged); write the
    campaign_targets row when pinned; createPinnedDraftAsMember (INSERT unpinned, then pin_post_account,
    return the pinned row). Stays on the AUTHENTICATED client (ADR 0022 A-2).
 6. lib/db/posts.ts pinPostAccount -> pin_post_account, and its Zod-validated Server Action.
 7. postIdentityOf(row): pinned { socialAccountId } | unpinned.

TESTS - one per section 3.8 row (R-3's row replacing promote's):
 Tier 2: resolveCampaignTargets, every result branch; generate.ts with founder-LinkedIn + brand-X targets
 creates rows pinned per platform and refuses missing_target; the target action refuses a platform outside
 campaigns.platforms; pinPostAccount wrapper and action; postIdentityOf; publishing orchestrator - brand-pinned
 and founder-pinned posts on one platform publish through their own accounts, an unpinned legacy post with two
 active accounts still fails account_ambiguous; metrics orchestrator - each post's pinned account, unpinned
 and ambiguous skipped.
 Tier 1 (through the A-2 signed-in client): promote pins to the chosen identity; missing_target refused BEFORE
 the claim (the draft is NOT claimed afterwards); a draft promoted on a platform with no account is unpinned
 and is swept by a later connect.
P2.1's #50 scan now runs against the real writers.

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: let generate.ts accept a raw row (the plan-only
test fails); claim before resolving in promote (the before-the-claim arm fails); add a stray
.update({ social_account_id }) in lib/db (the #50 scan fails).

CONSTRAINTS CLOSED: 1 IDENTITY-NO-UNPINNED-NEW-POST (1 + 2), 12 IDENTITY-TARGET-PLAN-TOTAL (2),
50 IDENTITY-PIN-WRITERS-CLOSED (3), 51 IDENTITY-PROMOTE-PINNED (1 + 2).

Commit: "P2.7 IDENTITY-NO-UNPINNED-NEW-POST IDENTITY-TARGET-PLAN-TOTAL IDENTITY-PIN-WRITERS-CLOSED
IDENTITY-PROMOTE-PINNED (target plan, generation, promote per R-3, re-pin path)".
```

#### P2.8 — Migration B4 and the founder voice

```
BUILDER - Session 38 - P2.8. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skill (free):
supabase:supabase-postgres-best-practices.

SHIP (ADR 4.1-4.7, 3.1's ratify bullet, 13.4):
 1. MIGRATION B4: create_voice_variation widened to take keywords, avoid_words, writing_examples and an optional
    p_bind_social_account_id (binds in the same transaction after checking the account is a founder account of
    the same business); the OLD (uuid, text, jsonb) signature DROPPED EXPLICITLY; search_path pinned; REVOKE
    from PUBLIC, anon, authenticated; GRANT service_role only. ratify_backfill_run raises if p_account_role
    differs from the run's account's role.
 2. The binding path: a service-role lib/db function behind a Zod-validated Server Action, callable by the
    account's connecting member or an admin.
 3. lib/memory/voice.ts: retrieveVoice takes a REQUIRED voice target (base | campaign { variationId } | post
    { identity, campaignVariationId | null }); the retriever reads the account's role itself; ONE constructor
    builds the post target from a post and its campaign. The resolved-voice type is NOT a row. NULL vs [] is
    decoded at the DB boundary into inherit-or-replace per field. The per-field rule is one table-driven,
    exhaustive function (ADR 4.4's table). source is the closed tuple, set here only. buildCustomerContext takes
    the same required target; CustomerContext.brandVoice becomes the resolved type. Founder cold fallback
    writes source = 'founder_cold_fallback' into ai_generation_metadata.
 4. EVERY caller per ADR 4.6 (or V.1's real table): generate.ts one context per DISTINCT target; regenerate
    (campaigns/[id]/posts/actions.ts) and lib/learning/orchestrator.ts the POST's target; brief.ts and the
    planner 'campaign'; the eight others 'base' EXPLICITLY.
 5. A source scan (in the source-scans style) confining getVariationForBusiness and any raw variation reader to
    lib/memory/.
 6. Backfill: the founder branch of the apply action writes axes, keywords, avoid_words and up to 3
    writing_examples to the account's bound variation, else creates-and-binds through the RPC; the BackfillPanel
    radio becomes a read-only display of the account's role; the role is read server-side; the ratification
    copy no longer says "tone sliders".

TESTS: Tier 1 - the old signature absent and the new one service_role-only (asserted live); create-and-bind
atomic (a failed bind leaves no variation); the ratify role mismatch raises; a 4-example call refused.
Tier 2 - retrieveVoice per field for NULL, [] and non-empty; avoid_words union de-duplicated; every row of
ADR 4.2's precedence table; the cold-fallback source; every section 4.6 caller passes an explicit target
(regenerate and learning pass the POST's target - this FIXES today's dropped campaign variation); the
raw-reader scan with a planted pair; the backfill founder apply both arms; the radio gone.

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: make avoid_words replace (the union arm fails); give
the target a default (the required-target compile/test fails); keep the old signature (the live-grant arm
fails).

CONSTRAINTS CLOSED: 30 FOUNDER-VOICE-MERGE-RULE (2), 31 FOUNDER-VOICE-PRECEDENCE (2),
32 FOUNDER-VOICE-COLD-HANDLED (2), 35 FOUNDER-VOICE-TARGET-REQUIRED (2), 48 FOUNDER-DEFINER-AUDIT (1) - every
new or changed DEFINER function now exists: pin_post_account, upsert_social_account_connection, the
member-removal trigger function, the user-erasure function, set_social_account_role if built,
create_voice_variation. Assert each grant live and the DEFINER audit gate count = V.2 + the exact number added,
named one by one.

Commit: "P2.8 FOUNDER-VOICE-MERGE-RULE FOUNDER-VOICE-PRECEDENCE FOUNDER-VOICE-COLD-HANDLED
FOUNDER-VOICE-TARGET-REQUIRED FOUNDER-DEFINER-AUDIT (Migration B4, retrieveVoice merge, every caller,
backfill founder branch)".
```

#### P2.9 — Bulk approve, both callers

```
BUILDER - Session 38 - P2.9. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP (ADR 6.4; the APV-BULK lesson - BLOCKER-1/BLOCKER-2 of Session 22 were one caller left unaudited):
 1. bulkApproveDraftPosts (lib/db/posts.ts:702): the founder filter INSIDE the UPDATE's own WHERE - a
    sub-select excluding rows pinned to a founder account whose connected_by is not auth.uid(). Not a separate
    read. The section 19 delegation exception (approval_delegated = true) sits inside the same WHERE, and the
    mixed set gains a delegated row.
 2. bulkApprovePostsAction (posts/actions.ts:218): the trigger's rejection of a row re-pinned or re-labelled
    between render and submit maps to a TYPED retry, never a generic failure. APV-BULK-ATOMIC and
    APV-COUNT-CONSISTENT keep holding over the FILTERED set.
 3. BOTH callers render and announce the filtered count: ApprovalsInbox.tsx:160 (per-campaign "Approve N", N
    excluding posts waiting on another person) and PostsClient.tsx:144.

TESTS: Tier 1 - a mixed set (own founder posts, another founder's posts, brand posts) flips only the
caller-approvable rows and the returned count equals the rows flipped. Tier 2 - ApprovalsInbox.test.tsx new
arm; PostsClient.test.tsx new arm; posts/actions.test.ts mixed-set and typed-retry arms; approvePost from
calendar/actions.ts:289 refuses a founder post for a non-founder approver. Then produce the FULL section 3.8
callers table at this head (git grep), every row with its test - nothing left AUTHORED-NOT-EXECUTED.

VERIFICATION: typecheck, lint, test:app, test:db. REDDEN: move the filter into a separate SELECT (the Tier-1
race arm fails); drop the arm from PostsClient only (its test fails while ApprovalsInbox's stays green - the
exact Session 22 shape).

CONSTRAINTS CLOSED: 14 IDENTITY-CALLERS-TWO-ACCOUNT-COVERED (2; its last rows land here),
38 FOUNDER-BULK-APPROVE-CALLERS (1 + 2).

Commit: "P2.9 IDENTITY-CALLERS-TWO-ACCOUNT-COVERED FOUNDER-BULK-APPROVE-CALLERS (filter in the WHERE, typed
retry, both callers; full 3.8 callers table)".
```

#### P2.10 — The UI surfaces, every state

```
BUILDER - Session 38 - P2.10. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. NO design skill
in this step - this step makes every state EXIST and be correct; P2.11 makes them good.

SHIP ADR 0032 section 11 plus R-3 (Studio picker) and R-7 (voice mismatch), Server Components by default:
 - 11.1 accounts (AccountsClient.tsx, PlatformConnectionCard.tsx): per platform, each identity a card with the
   role word as TEXT ("Company"/"Personal" - ADR 19.2, through ONE function from AccountRole), @username,
   display name, "Connected
   by <member>", the five existing statuses; separate "Connect your personal profile" / "Connect your company
   account" actions starting the role-declared connect; "Whose account is this?" required; the "Default" badge
   retired; disconnect only for whoever may; states: empty, one, two, founder disconnected, founder departed
   (admin "Reconnect as company or founder"), the five error banners (incl. role_change_blocked), loading,
   error. LinkedIn Company Page stays coming_soon with its existing copy.
 - 11.2 step-3/Step3Client.tsx: multi-identity (the Record<Platform, account> last-write-wins at :60-62 goes).
 - 11.3 campaign create/edit: native <select> "Publishes from" per platform; read-only with one identity;
   "Connect an account" with none; founder voice line or the cold notice; the campaign voice selector notes it
   does not apply to founder posts; the missing_target state.
 - 11.4 post card, approvals inbox, calendar: "From <name> . <role word>" as text; the inline native <select>
   picker for ANY unpinned draft on a platform with >= 1 active account (R-3 step 5); approved read-only with
   "Unapprove to change"; waiting-on-founder badge plus the disabled approve with its reason; the founder's
   "Waiting on you" filter and count; the cold notice; the founder-departed state; R-7's voice-mismatch notice
   (derived from ai_generation_metadata source; none for human-written posts); the calendar chip's accessible
   name carries the identity.
 - 11.5 VoiceEditor founder mode: axes, must/cannot words, the <= 3-example chooser (the axes-only note at
   :87-91 removed); "Words your company always avoids still apply."; reached from the founder card, the cold
   notice and VoiceReviewHost; states cold/editing/saved/cap reached (VoiceVariationCapError, retryable)/
   loading/error; the delete dialog names the account a variation voices.
 - Studio promote dialog: the "Publishes from" picker and the step-1 typed refusal (R-3).
Every string in en, pt and es in THIS commit. No asChild. Native <select> for every identity picker.

TIER 2: every state above rendered at least once; identity present as text in every accessible name; the
waiting/cold/mismatch/departed derivations as pure functions with literal cases; the mismatch notice for all
three cases (founder_variation: none; campaign/base source on a founder pin: shown; no metadata: none).

VERIFICATION: typecheck, lint, test:app. REDDEN: render identity as an avatar only (the a11y test fails);
show the mismatch notice for a human-written post (the derivation test fails).

ADR 19.1 DELEGATION, UI half: on the founder's own card ONLY (connected_by = the viewer), a labelled toggle "Let
approvers approve posts from my profile" with help text stating that switching it off does not unapprove posts
already approved; it calls set_founder_approval_delegation through a Zod-validated Server Action; others see
the state as text. The waiting-on-founder state requires approval_delegated = false.
ADR 19.2 LABEL: "Personal"/"Pessoal"/"Personal" for the founder role and "Company"/"Empresa"/"Empresa" for
brand, in every user-visible string; "Founder"/"Fundador" appears in no string value under the touched
namespaces (a Tier-2 lint with a planted pair). Code, types, column values and constraint names keep
"founder".

TIER 1 (for #55, extending P2.3's file): delegation default false; the setter refused for an admin, the owner,
another approver, an inactive account and a NULL connector, and allowed for the connector; with delegation on,
another approver approves; with it off they are refused; reset to false on fresh declaration (P2.4's RPC); a
same-founder reconnect keeps it. Its grant asserted live.

CONSTRAINTS CLOSED: 54 FOUNDER-VOICE-MISMATCH-SHOWN (2), 55 FOUNDER-DELEGATION-FOUNDER-CONTROLLED (1 + 2),
56 FOUNDER-PERSONAL-LABEL (2).

Commit: "P2.10 FOUNDER-VOICE-MISMATCH-SHOWN (section 11 surfaces and every state; Studio picker R-3; voice
mismatch R-7)".
```

#### P2.11 — Design pass, the browser measurement, and the React review

```
BUILDER - Session 38 - P2.11. The design skills run HERE ONLY, against ADR 0032 section 11 and R-3/R-7, in this
order:
1. /impeccable - hierarchy per 11.1's order; every state in 11.1-11.5 and the Studio picker; UX copy (role
   words, the five banners, waiting/cold/mismatch/departed notices - plain, never blaming); accessibility
   (identity as text, keyboard paths through connect, picker, approve and disconnect; focus visible; the
   disabled approve exposes its reason to assistive tech); responsive at 1280/640/320.
2. /taste-skill - ONLY if the accounts surface or the identity picker reads as generic after (1). If you do not
   run it, say so and why in the commit body.
3. /ui-ux-pro-max - validate the ONE new token, the role badge: AA in light AND dark; never colour alone (the
   word is always present).
4. /emil-design-eng - the final polish: focus rings, the disabled-approve affordance, the picker's feel; NO
   animation by default; prefers-reduced-motion respected. No motion library.
5. /break-ui - worst-case data: four identities across two platforms, a 60-character display name, an
   unbreakable handle, a non-Latin founder name, the longest pt and es strings, 320 px. Fix what breaks.

NONE OF THEM MAY change a role word's meaning, a state, a gate (who may connect, approve, disconnect), the
Server/Client split or the data a component receives; nor add a client island, an animation library, a
dependency, asChild, a CSS module, a non-native identity picker, or an inline style that is not truly dynamic.
A skill that proposes one of those is overruled; say so in the commit body.

THEN THE BROWSER, yourself, with the Playwright MCP tools (no subagent), SOCIAL_PROVIDER_MODE=mock, the local
stack seeded with: one business with brand X + founder X + founder LinkedIn; a second member who is an
approver; one user in two businesses. For en and pt at 1280, 640 and 320 px: settings/accounts, onboarding
step 3, a campaign's targeting, a campaign's posts, the approvals inbox (as the founder AND as the other
approver), the calendar, the founder VoiceEditor, Studio promote. Record document.documentElement.scrollWidth
on every page at every width (each <= the viewport) and keyboard-only passes. Record as V.5 with screenshots
under docs/reviews/assets/session-38/ (committed). A defect is FIXED here, with a test where one can be
written, and re-measured. The five ADR 12.4 items stay UNPROVEN - a mock connect is not a real one.

ECC BUDGET INVOCATION 4 of 4 - BEFORE YOU COMMIT. Dispatch ecc:react-reviewer ONCE, read-only, over every
component and page changed in P2.10-P2.11. Its question: "is any component a Client Component that need not
be; does any receive more data than it renders (e.g. connected_by ids sent to the client); does any identity
reach the accessibility tree only as an image or colour; does anything break the Base UI rules (asChild), the
native-select rule or the Server Component default?" Fix what it finds. Record its findings and your
disposition as V.6.

TIER 2: en/pt/es key parity across every namespace touched (FOUNDER-I18N-COMPLETE); every P2.10 test re-run
green over the post-design strings; the a11y assertions (FOUNDER-A11Y-FLOOR).

RECORD IN THE COMMIT BODY, per skill: what it changed (files, one line each) and whether it touched the
section 11 contract. The Reviewer checks exactly that.

VERIFICATION: typecheck, lint, test:app. REDDEN: delete one pt key; strip the role word from one accessible
name.

CONSTRAINTS CLOSED (Tier 2): 45 FOUNDER-I18N-COMPLETE, 46 FOUNDER-A11Y-FLOOR.

Commit: "P2.11 FOUNDER-I18N-COMPLETE FOUNDER-A11Y-FLOOR (impeccable -> taste-skill? -> ui-ux-pro-max ->
emil-design-eng -> break-ui against ADR 0032 section 11; browser V.5; react-reviewer V.6)".
```

#### P2.12 — Close-out: the constraint→CI map, documents and the PR

```
BUILDER - Session 38 - P2.12. /ecc:plan then /ecc:verification-loop.

1. RE-RUN EVERY SCAN AT HEAD (P2.1's file and P2.8's raw-reader scan) and paste the transcript: every planted
   pair still reddens.
2. SHARED-FUNCTION CALLERS (ADR 3.8 with R-3's row, and 4.6): git grep each function at HEAD and produce the
   table - caller, file:line, the test that exercises it. Compare the V.2 baseline test counts at HEAD - a DROP
   is a STOP, even if green. The DEFINER audit gate count equals V.2 plus the functions P2.8 named.
3. FOUNDER-SCOPES-VERIFIED (#40, Tier 3): the section 9 table carried into docs/launch-checklist.md section 16a
   as the three new rows of ADR 16.1, plus the CMA single-product topology row; the counsel row of ADR 10.4
   VERBATIM in section 9; the ops row (inactive founder rows with vault ids, the R-1/section 5.7 query).
4. AMENDMENT NOTES (ADR 16's list), each a DATED note appended to the amended ADR, never an in-place rewrite:
   ADR 0011 (3.2, 3.4, 8.2, L-10), ADR 0013 (5.1, 5.4), ADR 0025 (interpretation note 2, 4.2, 5.2, 10.3, 13),
   ADR 0028 (5.3, 9.4, the section 14 Stage-1 rows of ADR 12.4, 16 items 9 and 11), ADR 0031 (section 14 row 1).
   The D2.5 row: confirm it landed in P2.2's commit (git show it).
5. docs/backlog.md: every ADR 16 deferral with its un-defer trigger (S38-LI-MEMBER-READ, S38-MULTI-FOUNDER,
   S38-MEMORY-ACCOUNT-SCOPE, S38-PATTERNS-PER-ACCOUNT (S38-FOUNDER-DELEGATION is NOT added: section 19 closed it),
   S38-FOUNDER-EMAIL, S38-PLAN-GATES-UNENFORCED, S38-BRAND-VOICE-RLS, S38-CAMPAIGN-VARIATION-FK), the Plus
   limits drift, the r_member_social_feed misnomer; bug-1948 marked closed with P2.3's SHA in
   .wolf/buglog.json.
6. THE CONSTRAINT -> CI MAP (V.7). For each of the 56: its tier, the test file(s) or scan,
   and THE CI JOB THAT EXECUTES EACH (app-tests or db-tests). Tier-3 rows cite their diff check and, where one
   exists, the guarding scan. A constraint whose file no job runs is AUTHORED-NOT-EXECUTED and you say so
   rather than counting it.
7. MEASUREMENT (ADR 12.4), as V.8 and in docs/current-phase.md, REPORTED and never called COVERED: what mocks
   and seeds prove; the five items UNPROVEN until a LinkedIn app and an X developer account exist. No sentence
   implies a real founder has connected anything.
8. .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md.

FINALLY: push session-38-adr-0032 and OPEN A PR TO master - CHECK THE BASE IS master (cerebrum 2026-10-04).
Read both runs' logs with gh run view <id> --log, quote the db-tests skip-guard line (files / tests), grep the
db log for SIGSEGV / signal 11 / OOMKilled / out of memory, and record in docs/current-phase.md the Session 38
entry and the db-tests tally WITH ITS EVENT TYPE (pull_request runs never move the promotion tally). DO NOT
CLAIM A TOTAL UNTIL IT IS EXECUTED GREEN IN CI AT THE HEAD IT IS DATED TO.

CONSTRAINT CLOSED (Tier 3): 40 FOUNDER-SCOPES-VERIFIED.

Commit: "P2.12 FOUNDER-SCOPES-VERIFIED close-out: constraint->CI map (V.7), measurement (V.8), ADR
0011/0013/0025/0028/0031 notes, launch-checklist and backlog rows".
```

**Gate:** P3 runs only after `P2.12`'s PR exists, both CI runs have been read, and `V.1`…`V.8` exist in ADR 0032's
appended Builder verification section.

---

## §3 — Reviewer session (P3)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0032 is Accepted, alongside §2.** The checklist *is* ADR 0032's
> constraint table, so it can be written before the Builder runs. Only the commit range is filled in at
> run time, by the Reviewer itself.
>
> **What §3 will contain when authored:**
>
> - **§3a — Reviewer primer**: the prerequisites (the Builder's last step committed and pushed, CI runs
>   named); the read list (ADR 0032, this guide's §0/§0.2, the Builder's per-step reports); the binding
>   rules below; the ECC budget for the phase; and a closing instruction to stop for acknowledgement.
> - **§3b — Reviewer prompt**: walk ADR 0032's constraint table row by row, recording a verdict, the
>   evidence (`git show <sha>:<path>` at the range), and whether the test that proves it is **executed
>   green in CI at the reviewed head**. Severity ids `BLOCKER-n`, `MAJOR-n`, `MINOR-n`, `NIT-n`. Write the
>   report to `docs/reviews/session-38-reviewer.md`.
>
> **Binding rules the prompt will carry verbatim in substance:**
>
> - **`PROC-REVIEW-AT-COMMIT`**: every file is read at the stated range (`git diff <base>..<head>`,
>   `git show <sha>:<path>`), **never at HEAD**. The report **opens by naming the exact range read**. A
>   report that does not name its range is not a valid review.
> - **`SHARED-FUNCTION CALLERS`**: for `resolvePublishAccount`, `listActiveByBusinessAndPlatform`,
>   `retrieveVoice`, `buildCustomerContext` and `bulkApprovePostsAction` (both callers), the Reviewer runs
>   `git grep` at the head, lists every caller, and names the test (if any) that exercises each. A caller
>   with no test is `AUTHORED-NOT-EXECUTED` for that caller, even if another caller is fully covered.
> - **The session's highest-risk properties, to be read hardest:** the cross-tenant pin
>   (`IDENTITY-SETTER-TENANT-CHECKED`); the unforgeable owner and reconnect-no-takeover; founder approval
>   enforced in the DB if it was narrowed; and no newly generated post left unpinned on a two-identity
>   platform.
> - **Tier 3 properties of absence** are verified by running their scans, not by reading the diff and
>   finding nothing.
> - **What cannot be verified without real credentials** (Q8's measurement section) is recorded as
>   UNPROVEN, never as passed.

**✅ AUTHORED 2026-10-10 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** It was authored alongside §2, from ADR 0032 as Accepted with
Amendment R. **The primer may not be pasted until P2.12's PR exists.** Only the commit range is filled in at run
time, by the Reviewer itself.

**Four corrections to the placeholder, carried into the primer:**

1. **The highest-risk list grows by two, both from Amendment R:**
   - **no revert ever touches a `scheduled` row** (R-1, #49). A mid-publish revert double-publishes, and the tests
     pass either way unless the claimed arm exists;
   - **the closed writer list** (R-2, #50). The trigger cannot see DEFINER callers, so the list is the only
     boundary on non-raw writers.
2. **`bulkApprovePostsAction` → `bulkApproveDraftPosts`, both callers.** The callers list also gains
   `createPinnedDraftAsMember` (R-3), `approvePost` on both of its callers, and the connect sweep.
3. **No `database-reviewer` or `security-reviewer` in P3.** The Builder spends each while the code can still change
   (`P2.2`, `P2.5`) and records the findings as `V.3` and `V.4`. A cold second pass over a frozen diff would
   re-derive what was already acted on (the Session 35 `M3`, 36 `L3` and 37 corrections). P3 does that work
   **itself** at the range: it re-runs the trigger, RPC, grant and two-business arms, and checks that every
   `V.3` / `V.4` / `V.6` finding was actually fixed.
4. **The browser pass is the Reviewer's own**, through the Playwright MCP tools, and **`/impeccable` runs
   read-only** against ADR §11. `taste-skill`, `ui-ux-pro-max` and `emil-design-eng` are **not run**: they give
   direction, and a reviewer has none to give. P3 checks, from the `P2.11` commit body, what each changed and
   whether any change touched the §11 contract.

**ECC budget for the Reviewer phase: two subagent invocations, total.** Each is dispatched once, read-only, at the
range, over a closed file list, after the Reviewer's own pass.

- **`ecc:pr-test-analyzer`** over the new and changed `supabase/__tests__/*` files, the source scans, and the
  targeting, voice, OAuth, disconnect and bulk-approve tests. This session's test risk is **a boundary test that
  stays green with the boundary gone**:
  - a Tier-1 seed with a default status;
  - a founder-approval arm run as the founder (so it never exercises the refusal);
  - a claimed-row arm that never seeds a `scheduled` row;
  - a "refused before exchange" test that checks the redirect but not that the exchange was never called;
  - a two-business arm without B's positive control.
- **`ecc:silent-failure-hunter`** over the callback, the connect RPC wrapper, the sweep, `pin_post_account`'s
  wrapper and action, the bulk-approve typed retry, the cold fallback, the departure action and
  `promote.ts`'s R-3 path. **Five paths here are non-fatal by design:**
  - `account_ambiguous`;
  - the cold fallback;
  - the pin-failed-after-insert draft;
  - the swallowed-or-mapped RPC outcomes;
  - the residue of vault ids after a revoke.

  Telling a decided no-op from a swallowed error is that agent's lens.

**Skills are free:** `supabase:supabase-postgres-best-practices` for the migrations; **`/impeccable`, READ-ONLY**,
as an audit of the shipped surfaces against ADR §11. **Its output is evidence for findings, never a patch.**

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 38 Track P - REVIEWER phase (P3). You are independent. You MODIFY NOTHING: no source, no tests, no
migration, no ADR, no build guide. Your single output is docs/reviews/session-38-reviewer.md. This is the ONE
review pass for this session.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE - git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR in Session
21B. Your report MUST OPEN with:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.
Exception (Session 22-F, NEW-12): documents you audit AGAINST are named at their own commits, SEPARATELY:
  "ADR 0032 read at <sha>; build guide read at <sha>; reviewed artefacts read at <base>..<head>."
<base> is the master merge the Builder branched from (the section 2 precondition). If ADR 0032 was not in git
with "Status: Accepted" AND section 18 at <base>, or section 0.2 still read "Pending" for A-10 there, that is
your first finding. ADR 0032's appended "## Builder verification (P2)" section is written INSIDE the range;
read it at <head> and cite it as such.

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0032-founder-and-personal-profiles.md - ALL of it. SECTION 18 (Amendment R) WINS wherever it
  disagrees with an earlier section. The checklist is section 14 (#1-#48) as amended by section 18's table
  (#4, #26, #48 amended; #49-#54 new) and section 19's table (#37, #38, #48 amended; #55-#56 new) = 56.
  Section 19 (A-10: delegation and the "Personal" label) also wins over earlier sections. Section 3.8 (with R-3's row) and 4.6 are the SHARED-FUNCTION CALLERS tables. Sections 15 and 16
  are RULINGS, not open questions - do not re-open one.
- docs/build-guide/session-38.md: section 0 (L-1..L-10, D-1..D-8), section 0.2 (A-1..A-10 and A-8' as ruled),
  section 2's seven overrides and transcription table, and section 2b's step table (which step closes which
  constraint; the 0+5+9+8+5+6+6+4+5+2+3+2+1 = 56 tally).
- ADR 0028 sections 5 and 14; ADR 0025 sections 4.2, 5 and 10.3; ADR 0011 sections 3.2 and 3.4; ADR 0013
  section 5; ADR 0014 (APV-BULK-ATOMIC, APV-COUNT-CONSISTENT); ADR 0022 section 2 and A-2; ADR 0010 Amendment 2
  section D2.5; ADR 0015 section 2.
- CLAUDE.md: test-execution integrity, DB access, the three clients, Vault and the three GDPR disconnect steps,
  RLS and the erasure cascade, atomic transitions, Zod, i18n, bounded queries, UI Component patterns.

KNOWN AND NOT FINDINGS AGAINST THE BUILDER:
- resolvePublishAccount unchanged, and an unpinned legacy post with two active accounts still failing
  account_ambiguous, is the design (ADR 2, L-3). A typed failure code replacing it was REJECTED ([type-6]);
  ADDING one is the finding.
- Founder-only approval - the owner and other approvers cannot approve a founder post - is A-4, stated
  strictness. Unapprove staying `author` is ruled (ADR 6.2). The section 19 delegation
  branch (approval_delegated = true, set ONLY by the connector) is ruled; anything wider - an admin able to set
  it, delegation surviving a fresh declaration - is the finding.
- A claimed ('scheduled') founder post publishing at most once after departure, and a post claimed with no
  account picking up the new account within one tick, are ACCEPTED windows (R-1). A revert of a 'scheduled' row
  is the finding.
- The founder's first-person memory conditioning brand posts is the accepted leak (A-9, ADR 7). An account
  dimension in MemoryScope is the finding.
- No OAuth scope change, LinkedIn Company Page still coming_soon, LinkedIn founder metrics still
  NOT_IMPLEMENTED (ADR 9, D-6, D-8).
- No new EmailKind; "Waiting on you" in-app only (ADR 6.5).
- Two different people as founder on LinkedIn and X being representable is an accepted residual (ADR 5.6).
- brand_voices RLS and campaigns.voice_variation_id's single-column FK left alone are deferred (ADR 16 rows
  14-15). A change to either is out of scope, not a fix.
- postsPerMonth / allowedPlatforms unenforced and the Plus limits drift are recorded, not fixed (ADR 10.2).
- The five ADR 12.4 items UNPROVEN is correct; claiming any of them passed IS a finding.

THE TEN THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. A CLAIMED POST REVERTED (R-1, #49). Read every UPDATE posts statement added in the range - the sweep, the
   departure trigger, disconnect, revokeMemberAction. Any revert whose WHERE admits 'scheduled' is a BLOCKER.
   Re-run both #49 arms yourself; on a scratch branch add 'scheduled' to one WHERE and confirm a test fails.

2. AN APPROVAL WITHOUT A FRESH APPROVER, OR A FOUNDER POST APPROVED BY SOMEONE ELSE (bug-1948, A-4, A-6). As an
   authenticated editor and as a non-founder approver, through PostgREST: INSERT 'approved'; INSERT
   'scheduled'; INSERT with a pin; UPDATE draft -> scheduled; UPDATE draft -> approved on a founder pin; UPDATE
   the pin on a draft. Every one must be refused. Then as the founder: approve succeeds. Run them yourself
   against the local stack at <head>.

3. A PIN WRITER OUTSIDE THE CLOSED LIST (R-2, #50). git grep at <head> for social_account_id writes in lib/,
   app/, components/ and supabase/migrations after <base>. The list is: service-role createPosts,
   pin_post_account, the connect sweep, the FK SET NULL, and createPinnedDraftAsMember (insert NULL, then the
   RPC). Anything else is a finding. Confirm pin_post_account's BODY enforces draft-only.

4. A FORGEABLE OWNER OR A TAKEOVER (L-5, A-1). Where does connected_by come from? Only the RPC, only from the
   verified session user. Does the callback check cookie nonce, session user and user_can BEFORE the exchange
   and BEFORE any vault call (a recording mock, not a redirect assertion)? Are old-format states rejected? Does
   the RPC re-verify membership itself? Is EXECUTE on it service_role only (asserted live)? Can another active
   member's reconnect write anything, and does a refusal orphan a vault secret?

5. CROSS-TENANT REACH (L-9). One user in A and B: A's post pinned to B's account by INSERT (service-role), by
   pin_post_account, by raw update; A's campaign targeting B's account; A's founder variation bound to B's
   account; retrieveVoice for A's post resolving B's variation (the explicit .eq('business_id') on the
   service-role path). Every one refused, each with B's positive control seeded.

6. A NEW POST LEFT UNPINNED ON A TWO-IDENTITY PLATFORM (#1, #51). Generation with two active accounts and no
   target must refuse (missing_target). Promote must resolve BEFORE the claim and leave no claimed draft on a
   refusal. A single-account business must auto-pin. Re-run the R-3 Tier-1 test through the signed-in client.

7. THE SWEEP WRONG IN ONE CELL (R-1, R-5). Re-derive R-1's table yourself and run every cell, including
   reactivation with prior = brand, and the 'scheduled' cells (pinned, status untouched, then
   publish_post_complete returns it published).

8. THE VOICE MERGE OR PRECEDENCE (ADR 4.2, 4.4). By hand: a founder variation with keywords [] (explicitly
   none), avoid_words NULL (inherit, then union), writing_examples non-empty (replace). Compare with what
   retrieveVoice returns. A founder post with a campaign variation set must use the FOUNDER's. Regenerate and
   learning must pass the POST's target.

9. SHARED-FUNCTION CALLERS, PER CALLER, AT THE RANGE. git grep at <head>: resolvePublishAccount,
   listActiveByBusinessAndPlatform, getActiveById, createPosts, createPinnedDraftAsMember, pinPostAccount,
   approvePost (posts/actions.ts AND calendar/actions.ts), bulkApprovePostsAction -> bulkApproveDraftPosts
   (ApprovalsInbox.tsx AND PostsClient.tsx), buildCustomerContext, retrieveVoice. Produce the table: caller,
   file:line, the test that exercises it. Compare with ADR 3.8/4.6 and the V.2 baseline counts: a DROP is a
   finding even if CI is green. A caller with no listed test is AUTHORED-NOT-EXECUTED for that caller.
   Cross-check with pr-test-analyzer's output.

10. A GRANT, CHECK, INDEX OR COUNT THAT IS WRONG. Query at <head>: the three new social_accounts columns
    absent from the UPDATE allowlist; every CHECK by name; the partial unique index; the posts composite FK
    (named, column-list SET NULL, the old FK gone); campaign_targets and brand_voice_variations policies
    (InitPlan, UPDATE USING + WITH CHECK, author on writes); every DEFINER function's search_path and grants
    against ADR 13.4 + R-8; create_voice_variation's OLD signature absent; the DEFINER audit gate count against
    V.2 plus the functions P2.8 named. The D2.5 row VERBATIM and IN MIGRATION A's COMMIT (git show it). THEN
    OPEN THE CI RUNS FOR <head>: read the db-tests skip-guard line FROM THE LOG and record file and test
    counts. If db-tests is red, distinguish a DB-behaviour regression from a stack failure and say which.
    pull_request runs never move the promotion tally.

ALSO VERIFY, and do not take the Builder's word for any of it:
- Every scan re-run BY YOU at <head> and REDDENED against a planted violation in the detector's OWN vocabulary:
  6, 8, 28, 39, 41, 42, 47, 50 and P2.8's raw-variation-reader scan. A scan without a redden transcript in its
  commit body is AUTHORED, not proven. Tier-3 rows stay Tier 3; a scan is a guard, not an upgrade.
- Migrations: none edited after commit (git log --follow per file); a V.4 finding against a committed migration
  fixed by a NEW migration; V.3, V.4 and V.6 findings each actually fixed.
- THE BROWSER, yourself, with the Playwright MCP tools, SOCIAL_PROVIDER_MODE=mock: settings/accounts, step 3, a
  campaign's targeting, a campaign's posts, the approvals inbox AS THE FOUNDER AND AS ANOTHER APPROVER, the
  calendar, the founder VoiceEditor, Studio promote - at 1280, 640 and 320 px in en and pt; scrollWidth
  compared with V.5; every section 11 state seen at least once; keyboard-only through connect, the picker,
  approve (disabled with its reason) and disconnect. A V.5 number you cannot reproduce is a finding.
- UX (ADR 11, R-3, R-7): identity as TEXT everywhere ("From <name> . <role word>"); the Default badge gone;
  disconnect shown only to whoever may; the waiting, cold, mismatch and departed states honest; native
  <select> for every identity picker; no asChild. RECORD WHAT impeccable, taste-skill, ui-ux-pro-max,
  emil-design-eng AND break-ui CHANGED, per the P2.11 commit body, and whether any touched the section 11
  contract. A skill change that altered a gate, a state or the Server/Client split is a MAJOR finding.
- L-1 scope: no scope change, no org posting, no voice table, no memory dimension, no EmailKind, no plan.ts,
  pricing-page, CLAUDE.md or legal MDX edit, no [LEGAL ENTITY] touched.
- The documents landed IN THE COMMIT OF THE CHANGE THEY DESCRIBE (git show each): the D2.5 row at P2.2; the
  launch-checklist rows, the ADR amendment notes and the backlog rows at P2.12. A document that lagged its
  change is a MINOR finding.
- ECC budget: at most FOUR Builder subagent invocations, per the commit bodies and V.3/V.4/V.6. Exceeding it is
  a PROCESS finding, not a code defect.
- docs/current-phase.md and V.8: the measurement statement says plainly that no real founder has connected
  anything. A sentence implying otherwise is a finding.

ECC BUDGET FOR YOU: TWO subagent invocations, each ONCE, read-only, AT THE RANGE, after your own pass.
- ecc:pr-test-analyzer over the new and changed supabase/__tests__/* files, lib/social/founder-source-scans.
  test.ts, and the targeting, voice, OAuth, disconnect, departure and bulk-approve tests. One question: "which
  of these tests would stay green if the property it names broke - a Tier-1 seed with a default status, a
  founder-approval refusal arm run as the founder, a claimed-row arm with no 'scheduled' row seeded, a
  'refused before exchange' test that checks only the redirect, a two-business arm without B's positive
  control, an expected merge result computed by the code under test?"
- ecc:silent-failure-hunter over app/api/social/[platform]/callback/route.ts, the connect RPC wrapper, the
  departure and disconnect paths, pinPostAccount and its action, createPinnedDraftAsMember and promote.ts, the
  bulk-approve typed retry, and lib/memory/voice.ts's cold fallback. One question: "which catch, early return,
  mapped outcome, fallback or skipped pin here hides an ERROR rather than recording a DECIDED, user-visible
  state - and does every RPC outcome reach the user as its own localised message?"
Their output is evidence you verify, not findings you copy. You do NOT dispatch database-reviewer or
security-reviewer - both passes were spent by the Builder (P2.2, P2.5) while the code could still change;
items 1-5 and 10 above are that work, and you do it yourself, including checking V.3 and V.4 were acted on.
Skills are free: supabase:supabase-postgres-best-practices; impeccable READ-ONLY as an audit of the shipped
surfaces against ADR 0032 section 11 (its output is evidence, never a patch). Do not run taste-skill,
ui-ux-pro-max or emil-design-eng.

Acknowledge in ONE line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 38 Track P Builder range and write docs/reviews/session-38-reviewer.md.

Open with the range line (PROC-REVIEW-AT-COMMIT), and name SEPARATELY the commits at which you read ADR 0032
and docs/build-guide/session-38.md.

Organise findings by ADR 0032's own sections so the correction pass can cite them:
  1. Identity and targeting: the role, campaign_targets, the pin boundary and its writers, the single-account
     business, the sweep, the target plan, promote, the read side (Section 3; R-1, R-2, R-3, R-5; L-3)
  2. The founder voice: binding, precedence, widening, the merge, the RPC, backfill, the cold founder, the
     callers - WITH YOUR HAND RE-DERIVATION of the merge (Section 4; R-7; L-4)
  3. Ownership: connected_by, the allowlist, the connect RPC, capability, disconnect, one per platform,
     departure and erasure (Section 5; R-4, R-8; A-1, A-2, A-7, A-8')
  4. Approval: the trigger contract, founder-only approval, bulk approve on both callers, waiting on the
     founder (Section 6; A-4, A-6, and A-10 as ruled)
  5. Memory and backfill scope (Section 7; A-9)
  6. Scopes and plans: PLATFORM_CONFIGS unchanged, the launch-checklist rows, the Plus allowance (Sections 9,
     10; A-3, A-5)
  7. The UX contract, your browser pass, and what each design skill changed (Section 11)
  8. GDPR and tenancy: every new column and table, the variation RLS, the two-business arms, the DEFINER audit
     (Section 13; L-9)
  9. The test plan: every constraint's tier, its executing CI job, whether it REDDENS if the property breaks,
     the scans re-run by you, SHARED-FUNCTION CALLERS per caller (Sections 12, 14, 18)
 10. Scope and documents: L-1's out-of-scope list not shipped; the Section 16 amendment notes landed in the
     right commits; the measurement statement honest

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) that the
correction pass will cite. For each: what is wrong, file:line AT THE RANGE, why it matters, and what would
prove it fixed. Do not propose patches - you write no code.

Where you believe ADR 0032 ITSELF is wrong rather than the implementation, say so and mark it an ADR finding,
not a Builder finding. The ADR already absorbed one three-agent advisory round (security, database,
type-design - Section 15) and a same-day review that produced Amendment R (Section 18, which found that
'scheduled' means claimed). A further defect is entirely possible, and you should say so if you find one.

Run the verification yourself rather than trusting the Builder's report:
  npm run typecheck ; npm run lint ; npm run test:app ; npm run test:db
  the ten checks of the primer, each against the local stack at <head>
  your hand re-derivation of R-1's sweep table and ADR 4.4's merge for the three-field case
  every scan, each reddened by you against a planted violation in the detector's own vocabulary
  the #49 arms with 'scheduled' planted into a revert on a scratch branch
  git grep for every SHARED-FUNCTION CALLERS surface and its callers
  pg_policy, the grants, the CHECKs, the indexes, the FKs and every DEFINER function's settings, queried at
    <head>, and the DEFINER audit gate count
  the browser pass at 1280 / 640 / 320 px in en and pt, compared with V.5
Open the CI runs for <head> and read the db-tests skip-guard line from the log. If db-tests is red,
distinguish a DB-behaviour regression from a stack failure and say which.

State plainly anything you could NOT verify and why. A real founder connecting on LinkedIn's production app,
a real publish under urn:li:person:{sub} (the pairwise-sub question), a real second X account publishing as a
distinct author, the cookie nonce across a real provider redirect, and founder-only approval in a real
customer's browser are all unverifiable in this session (ADR 12.4) - saying so is worth more than a confident
guess. Do not pad the report.

End with one line: "Session 38 review complete - <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni> NIT)
over range <base>..<head>; <c>/56 FOUNDER-*/IDENTITY-*/APPROVAL-* constraints verified executed green in CI; claimed-row revert <absent|PRESENT>; ADR 12.4 items: 5 UNPROVEN, correctly; Tier E:
none declared, correctly." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and `docs/reviews/session-38-reviewer.md`
exists. A correction pass is a response to findings. Inventing them ahead of time produces a fictional
resolution log.

---

## §4 — Correction pass (Session 38-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored only after the Reviewer has run and `docs/reviews/session-38-reviewer.md`
> exists.** A correction pass responds to findings. Until they exist there is nothing to order, prioritise
> or resolve, and writing them ahead of time would produce a fictional resolution log.
>
> **What §4 will contain when authored, in this order:** founder adjudications on any findings that need
> a ruling; *"What the Reviewer found (summary — `docs/reviews/session-38-reviewer.md` is
> authoritative)"*; the ordering rationale; where resolutions go; **§4.0** correction primer; **§4.1** one
> paste block per correction step, `D0 … Dn`; **§4.2** the resolution log; and **§4.3** close-out.
>
> **Where resolutions go: `REVIEWER-REPORT APPEND-ONLY` (CLAUDE.md, revised Session 23-D), all four
> conditions binding:**
>
> 1. **No in-place edit, ever.** Not one character of the reviewer's text changes: no verdict flipped, no
>    status rewritten, no RESOLVED stamped onto a finding, nothing reworded, deleted or reordered.
> 2. **One appended, attributed section**, `## CORRECTION PASS (Session 38-D)`, at the end of
>    `docs/reviews/session-38-reviewer.md`. It opens with its author, its date and the commit range it
>    fixed.
> 3. **Findings are referenced, never restated as resolved**: *finding id → fix → the test that now proves
>    it → commit SHA*.
> 4. **A disputed or withdrawn finding is argued in the appendix, not erased.** The reviewer's original
>    text stays as the evidence.
>
> Every correction step re-dates the constraints it touches to the head at which CI executed them green.
> A count of covered constraints is quoted from CI logs at that head, never asserted (the Session 28
> "29/29" lesson).

---

## §5 — Docs to update at close-out (Track P done)

- [ ] `docs/current-phase.md` — Session 38 closed; ADR 0032 Accepted; CI run ids at the closing head.
- [ ] `docs/decisions/0032-founder-and-personal-profiles.md` — Accepted, with Builder verification and
      correction amendments appended.
- [ ] `docs/decisions/0011-voice-model.md` — the variation-widening amendment, cross-referenced.
- [ ] `docs/decisions/0025-social-read-path-and-backfill.md` — §4.2 and §13 amendment notes: the founder
      voice is no longer axes-only, and the §13 deferral row is closed.
- [ ] `docs/decisions/0028-native-social-providers.md` — §5.3 note (the targeting setter now exists, and
      the two-identity callers are covered) and the §14 Stage-1 row this session adds.
- [ ] `docs/decisions/0031-analytics-and-monthly-report.md` — the LinkedIn-metrics deferral row's
      Session 38 disposition.
- [ ] ADR 0010 Amendment 2 §D2.5 — a row for every new business-scoped table, **or an explicit note that
      no new row was required** (the Session 28-D D7 precedent).
- [ ] `docs/launch-checklist.md` — the Q6 scope rows, the counsel row (§9), and the Stage-1 founder
      connect/publish row.
- [ ] `docs/pre-launch-scope.md` — §10's T1-E checkbox, with evidence (append, do not rewrite §12).
- [ ] `docs/product-status.md` — the founder-profile line, now true and stated plainly (LinkedIn Company
      Page still `coming_soon`).
- [ ] `docs/backlog.md` — deferred rows from ADR 0032 with triggers; the Plus limits drift recorded.
- [ ] `docs/build-guide/session-38.md` — §2/§3/§4 authored at their gates, with placeholders retained.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md`.

**Next:** **Session 39 — template carousels (T1-C)**, `docs/build-guide/session-39.md`. It builds against
the account-shaped targeting this session lands.
