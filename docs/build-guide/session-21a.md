# Session 21A — Seats & Permissions: Backend Spine (ADR 0013)

> **Goal:** Turn SŌSH from single-owner into a multi-member tenant. Introduce a two-axis
> permission model — a **content role** (`approver | editor | viewer`) plus an orthogonal
> **admin stamp** (`is_admin`, governs billing/invitations/member management) — enforced in the
> database via a `user_can(business_id, capability)` helper wired into RLS write policies. Add
> **seats as a plan capability cap** (trial 10 / plus 10 / pro unlimited), **DB-enforced** by a
> `BEFORE INSERT` trigger (Rev A). Create `business_members`, backfill the creator as the primary
> admin, widen `get_user_business_ids()` to `owner_id ∪ active members`, and register the new table
> in the GDPR erasure path. **No Stripe work. No invite email flow, no `/settings/team`, no UI
> retrofit** — those are 21B/21C.
>
> **How to use this file:** paste each phase into Claude Code in order. **Architect → Opus.
> Builder → Sonnet. Reviewer → Opus. Correction → Opus.** §1 (Architect) and §2 (Builder) each open
> with a **primer** — paste the primer first, wait for its acknowledgement, then paste the working
> prompts. The ADR (0013, Rev A) is accepted; §2 is now live. §3–§4 remain stubs until the Builder commits.
>
> **Design plugins — when relevant.** 21A is backend-only (migrations, RLS, DB/TS helpers); it has no
> UI surface, so `impeccable-design-and-taste` and the taste skill are **intentionally not invoked**
> here. They activate in **21B** on the `/settings/team` templates, behind the usual confirmation gate.
>
> **§0 holds the decisions already locked with the founder on claude.ai.** They are *binding
> input* to the Architect prompt — pasted inside it so the Architect does not re-litigate them.

---

## §0 — Locked decisions (binding input — adjudicated on claude.ai)

**Naming:** marketing **Plus** = DB `plan = 'starter'`; **Pro** = `plan = 'pro'`. §0 uses DB values.

**Three-way build split** (this file = 21A only):
- **21A — Backend spine (this session):** `business_members` + creator backfill; `get_user_business_ids()`
  swap; `user_can` helper + role-aware write policies; `maxSeats` capability + seat-cap enforcement;
  erasure-cascade / `purge_business` registration. No Stripe, no email, no UI.
- **21B — Flow + surface:** HMAC invite/accept email flow; `/settings/team`; seat meter; retrofit
  capability gates across calendar / campaigns / accounts / billing.
- **21C — Approver quick-approve tab:** role-gated pending-approvals inbox that wires up the existing
  (currently surface-less) approve-queue for approvers.

**Locked (L):**

- **L-1** Two independent axes. Content **role** ∈ `{approver, editor, viewer}` on `business_members.role`.
  Orthogonal **admin stamp** `business_members.is_admin boolean`. There is **no `owner`/`admin` role
  value** — the account creator is simply `is_admin = true`.
- **L-2** Capability matrix (the authoritative source for `user_can`):

  | Capability | viewer | editor | approver | +admin |
  |---|:--:|:--:|:--:|:--:|
  | Tenant reads (calendar, campaigns, analytics, member list) | ✓ | ✓ | ✓ | — |
  | Author: create/edit **drafts**, create/edit campaigns | — | ✓ | ✓ | — |
  | Reschedule **draft + approved** posts | — | ✓ | ✓ | — |
  | **Approve** (`draft → approved`) | — | — | ✓ | — |
  | Connect / disconnect social accounts | — | — | ✓ | ✓ (union) |
  | Invite / revoke invite / change role / remove member | — | — | — | ✓ |
  | Manage subscription / payments | — | — | — | ✓ |
  | **Delete account / transfer ownership** | — | — | — | **`owner_id` only** |

- **L-3** `is_admin` is the *only* gate for billing, invitations, and member/seat management. Content role
  is irrelevant to those. A member may hold any (role × is_admin) combination.
- **L-4** Seats are a **plan capability cap, not a billed quantity.** `getPlanCapabilities` gains
  `maxSeats`: **trial 10, starter 10, pro `null` (unlimited)**. **No Stripe change of any kind** this
  session — no seat line item, no proration, no webhook edit.
- **L-5** Seat usage = **count(active members) + count(pending invites)**, owner included. Compared to
  `maxSeats`.
- **L-6** A pending invite **reserves a seat**. An admin can **revoke** an invite to release it.
- **L-7** **Pro → Plus downgrade with seat usage > 10 is hard-blocked.** Because the Stripe Customer Portal
  is Stripe-hosted and cannot be conditionally gated pre-transaction, the "block" is realised as an
  **app-layer overage lock**: 21A ships the pure overage-evaluation helper + the lock semantics; the
  billing/portal wiring lands in 21B. 21A must define, not defer, the semantics.
- **L-8** Backfill the account creator as a `business_members` row: `role = 'approver'`, `is_admin = true`,
  `status = 'active'`, `user_id = businesses.owner_id`. This guarantees **zero capability regression** for
  existing single-user accounts (creator retains every capability).
- **L-9** `get_user_business_ids()` widens to resolve `businesses.owner_id` **∪** `business_members` where
  `status = 'active'`. Remains `SECURITY DEFINER` / `STABLE` to avoid RLS recursion and to evaluate once
  per statement.
- **L-10** Role enforcement lives in the **database**, via `user_can(business_id, capability)`
  (`SECURITY DEFINER`, hardened `search_path`) referenced in the `USING`/`WITH CHECK` of write policies on
  the sensitive tables. Server Actions **also** check `user_can` for fail-fast UX, but the DB is the real
  boundary (anon key + RLS means app-layer-only checks are bypassable).
- **L-11** Invites use a **signed HMAC token** (reuse the existing OAuth-state signer pattern), a reserved
  `business_members` row (`status = 'invited'`, `user_id NULL`, `email` set), and **7-day expiry**.
  Acceptance runs through a `SECURITY DEFINER` RPC (the accepting user is not yet a tenant member, so RLS
  cannot admit their write). *(Email delivery + accept UI = 21B; 21A specifies the token, the row, and the
  RPC contract only.)*
- **L-12** `businesses.owner_id` is the **protected-admin invariant**: un-removable, sole holder of
  delete-account / transfer-ownership. Admins cannot demote or remove the owner.
- **L-13** Every new business-scoped table (`business_members`, any invite-state table) is added to the
  **ADR 0010 Amendment 2 §D2.5 erasure-cascade table** and to `purge_business`, in this session's PR
  (CLAUDE.md erasure-cascade rule). No exceptions.
- **L-14** `/ecc:` prefix throughout. Architect produces **only** `docs/decisions/0013-seats-and-permissions.md`
  — no `.ts`, no `.sql`.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | Permission shape | Two axes: role + orthogonal `is_admin` stamp | Single hierarchical ladder (owner>admin>approver>editor>viewer) — conflates billing authority with content trust; founder explicitly wanted admin as a separable stamp |
| D-2 | Who approves | `approver` only | editor approves (collapses the human-in-the-loop trust gate — the product's core promise) |
| D-3 | Reschedule of approved | editor + approver | approver-only (founder adjudicated editors may move approved posts; a day-move ≠ content edit, so ADR 0012's revert-to-draft rule doesn't fire) |
| D-4 | Connect/disconnect accounts | `role = 'approver' OR is_admin` | admin-only (founder extended it to approvers) |
| D-5 | Seat billing | Plan capability cap, uncharged | Metered / second-line-item seat billing (dropped once Plus capped at 10 and Pro made unlimited — no per-seat charge, Stripe untouched) |
| D-6 | maxSeats | trial 10 / starter 10 / pro null | trial single-user; trial unlimited (founder: "trial as paid" → Plus level = 10) |
| D-7 | Seat count basis | active + pending invites, owner incl. | accepted-only (billing/cap jumps unpredictably at accept-time) |
| D-8 | Pending invite | reserves a seat, admin-revocable | no reservation (over-invite races the cap) |
| D-9 | Pro→Plus over-cap | hard block via app-layer overage lock | soft recompute (N/A — no per-seat billing; founder chose hard block) |
| D-10 | Owner representation | member row (`approver`+`is_admin`) **and** `owner_id` pointer | owner-only-in-`owner_id` (forks seat math + member lists into two code paths) |
| D-11 | Access resolution | `get_user_business_ids()` = `owner_id ∪ active members`, DEFINER/STABLE | keep ownership-only (blocks the feature entirely) |
| D-12 | Role enforcement locus | `user_can` SECURITY DEFINER helper in RLS write policies + app-layer echo | app-layer-only (anon+RLS lets a member issue role-violating writes); inline per-policy predicates (matrix smeared, unauditable) |
| D-13 | Invite storage | signed HMAC token + reserved member row + accept RPC | separate `invites` table (redundant with the reserved row) |

**Anchor artefacts (READ, do not re-derive):** ADR 0001 (§A `get_user_business_ids` ownership-only +
"same function resolves via `business_members` join without policy changes"; §J follow-up
"`business_members` when teammates/seats arrive"; RLS conventions; service-role rules; soft-delete list),
ADR 0010 Amendment 2 §D2.5 (erasure-cascade table + `purge_business`), ADR 0012 (calendar surfaces whose
gates 21B retrofits — informational only here), `lib/stripe/plan.ts` `getPlanCapabilities` (SSOT to
extend), `lib/campaigns/enforcement.ts` (the cap-enforcement pattern to mirror for seats), CLAUDE.md
(RLS rule: every UPDATE policy has both `USING` and `WITH CHECK`; no new table without RLS; erasure-cascade
rule; three Supabase client roles; atomic-guard pattern).

---

## §1 — Architect: primer + prompt  (paste into Claude Code · Opus)

**Paste the primer first. Wait for the acknowledgement. Then paste the FULL prompt.** The primer
loads context and pins the role boundary so the Architect does not start drafting before it has read
the repo; the full prompt is the working brief.

### §1a — Primer (paste first · wait for acknowledgement)

```
Session 21A — Seats & Permissions (Architect phase). You will produce ONE design-only ADR next.

Read now, before doing anything else:
- CLAUDE.md — RLS conventions (USING + WITH CHECK on every UPDATE; no new table without RLS), the
  three Supabase client roles + lazy-import rule, the atomic-guard pattern, the erasure-cascade rule.
- docs/current-phase.md — where the build actually is (Session 20 shipped; 659 tests).
- docs/decisions/0001-database-schema.md (§A get_user_business_ids + the business_members join promise,
  §B businesses, §C RLS, §G soft-delete, §J follow-ups), 0010-legal-surface.md + its Amendment 2 §D2.5
  cascade table + purge_business, 0012-content-calendar.md (the write surfaces about to become role-aware).
- lib/stripe/plan.ts, lib/campaigns/enforcement.ts, lib/db/{businesses,posts,campaigns,social-accounts}.ts,
  and the migrations that create the posts / campaigns / social_accounts RLS policies.
- The existing approve Server Action + approve-queue, and the existing HMAC OAuth-state signer.

Invoke the `architect` ECC agent.

Role boundary (CLAUDE.md): this is an ADR-only session. No .ts, no .sql — SQL and TypeScript appear
ONLY as fenced contract blocks inside the ADR. You did not write the existing code; ground every claim
in the files above, do not guess a filename, column, or policy.

Do NOT draft the ADR yet. When you have read the above and are oriented, reply with:
(1) the latest migration timestamp you found in supabase/migrations/,
(2) the current one-line body of get_user_business_ids(),
(3) the file + function name of the existing HMAC signer you'll reuse for invite tokens,
(4) "Ready for the 21A brief."
Then stop and wait.
```

### §1b — Architect prompt (paste after acknowledgement · FULL)

```
You are the ARCHITECT for SŌSH Session 21A. Produce ONE design-only ADR. Do NOT write .ts or .sql
files this phase — TypeScript signatures and SQL appear ONLY as fenced contract blocks INSIDE the
ADR; the Builder writes the real files next session. Architect role boundary per CLAUDE.md: ADR
only, last action is a single confirmation line, then /exit.

OUTPUT: docs/decisions/0013-seats-and-permissions.md

SCOPE: This ADR designs the COMPLETE seats-&-permissions MODEL so it is internally coherent, but it
must FULLY SPECIFY only the 21A BACKEND SPINE and define the contracts that 21B (invite email flow +
/settings/team + UI gate retrofit) and 21C (approver quick-approve tab) will consume. Do NOT design
21B/21C UI, email templates, or routes. Explicitly list what is deferred to 21B/21C.

READ FIRST (ground every claim in the actual repo — do not guess a filename, a column, or a policy):
- CLAUDE.md — RLS conventions (USING + WITH CHECK on every UPDATE; no new table without RLS), the
  three Supabase client roles + lazy-import rule, the atomic-guard pattern, and the erasure-cascade rule.
- docs/decisions/0001-database-schema.md — §A (get_user_business_ids current body; the promise that it
  swaps to a business_members join with NO policy changes; owner_id RESTRICT), §B businesses (plan CHECK,
  stripe_* columns, owner_id), §C RLS, §G soft-delete list, §J follow-ups (business_members).
- docs/decisions/0010-legal-surface.md AND the Amendment 2 cascade table (§D2.5) + the purge_business
  function — you MUST slot the new tables in here.
- docs/decisions/0012-content-calendar.md — the calendar write surfaces (approve / reschedule / edit)
  whose policies you are about to make role-aware; and the reschedule_posts_batch RPC as a precedent
  for a SECURITY-context RPC that RLS still gates.
- lib/stripe/plan.ts — PlanCapabilities interface + getPlanCapabilities(). You are ADDING maxSeats.
- lib/campaigns/enforcement.ts — the existing plan-cap enforcement shape (how a cap is read, how the
  "over cap → upgrade CTA" result is returned). Seat enforcement MIRRORS this; do not invent a new shape.
- lib/db/businesses.ts — getBusinessByOwner and every function that assumes single ownership; the
  Stripe billing helpers. Identify callers that will still assume owner==only-user.
- lib/db/posts.ts, lib/db/campaigns.ts, lib/db/social-accounts.ts — the current write helpers and the
  existing RLS policies for posts / campaigns / social_accounts (read the migration files that create
  them). You will specify the role-aware policy DELTA, not rewrite them.
- The existing approve Server Action + approve-queue (find it) — 21C consumes it; note its shape.
- The existing OAuth-state signer (lib/social/oauth/state.ts or similar — HMAC sign/verify) — the
  invite token reuses this pattern; cite the actual module.
- supabase/migrations/ — the latest sequential migration TIMESTAMP; allocate real next numbers.
- proxy.ts — whether any membership/role resolution belongs at the middleware boundary (likely not;
  confirm and state).

BINDING DECISIONS (already adjudicated with the founder — encode them, DO NOT re-open them):
[paste session-21a.md §0 L-1 … L-14 and the D-1 … D-13 ledger verbatim]

THE ADR MUST SPECIFY:

1. Reversals / relationship to prior ADRs. Expect at least: ADR 0001 §A (get_user_business_ids body
   changes — this is the promised join swap, so frame it as fulfilment, not reversal) and ADR 0001's
   "one business per user enforced in app code" (now genuinely multi-member). Confirm NO RLS POLICY
   BODIES on existing tables need to change for the READ widening (only the helper). Enumerate every
   existing table whose WRITE policy DOES change (role-aware) and confirm the backfilled creator
   (approver + is_admin) suffers zero regression.

2. business_members table — full column list, types, constraints, indexes, RLS. At minimum:
   id, business_id (FK businesses, ON DELETE CASCADE), user_id (FK auth.users, NULLABLE until accept),
   email (citext or lower()-normalised — decide and justify; used for invite + duplicate-guard),
   role text CHECK in (approver, editor, viewer), is_admin boolean, status text CHECK in
   (invited, active, revoked) [decide whether 'removed' is distinct from 'revoked' or folded],
   invited_by (FK auth.users / business_members — decide), invited_at, accepted_at, created_at,
   updated_at (set_updated_at trigger). Uniqueness: one active/invited membership per (business_id,
   user_id) and per (business_id, lower(email)) — specify the partial unique indexes precisely.
   RLS: SELECT for any member of the business (tenant read via get_user_business_ids); INSERT/UPDATE/
   DELETE gated by user_can(business_id, 'manage_members') EXCEPT the accept path (RPC). State the
   owner-protection: the owner_id member row cannot be removed or demoted (enforce in the write policy
   and/or a trigger — pick one and justify).

3. get_user_business_ids() new body — owner_id ∪ (business_members where status='active' and
   user_id = auth.uid()). Keep SECURITY DEFINER + STABLE + SET search_path. Prove it cannot recurse
   (business_members has RLS; DEFINER runs as owner). Give the exact SQL in a fenced block. Note the
   read-blast-radius: this widens access on EVERY RLS table simultaneously — call it out as the single
   hardest test target and specify the test matrix (owner sees own; active member sees; invited/revoked
   member does NOT; cross-tenant denied).

4. user_can(business_id uuid, capability text) RETURNS boolean — SECURITY DEFINER, STABLE,
   SET search_path, REVOKE public / GRANT authenticated. It resolves the caller's (role, is_admin) for
   the business (owner_id → approver+admin equivalent; else the active business_members row) and maps
   capability → boolean per the L-2 matrix. Enumerate the capability string constants (e.g. 'author',
   'reschedule', 'approve', 'connect_accounts', 'manage_members', 'manage_billing'). Give the full
   function body. The 'connect_accounts' predicate is the UNION (role='approver' OR is_admin) — show it.
   Note that delete_account / transfer_ownership are NOT user_can capabilities — they are owner_id-only,
   enforced separately.

5. THE HARD ONE — capability-differentiated writes on ONE table. posts receives writes that need
   DIFFERENT capabilities: author-edit (editor+), reschedule (editor+), approve draft→approved
   (approver only). RLS policies are per-command (UPDATE), not per-intent, and WITH CHECK sees only the
   NEW row, not the transition. Resolve this explicitly and document the chosen mechanism with named
   losers. Candidate mechanisms to weigh:
   (a) Role FLOOR in the posts UPDATE policy (user_can(business_id,'reschedule') ⇒ editor+ may UPDATE at
       all), and route the approve TRANSITION through a SECURITY DEFINER/INVOKER RPC approve_post(...)
       that internally asserts user_can(...,'approve') AND does the atomic status='draft' guard — mirrors
       the reschedule_posts_batch precedent. (Lean.)
   (b) Column-level UPDATE policies distinguishing a status write from a scheduled_at/content write.
   (c) A BEFORE UPDATE trigger comparing OLD.status/NEW.status and asserting the capability.
   Pick one, justify, and specify it for posts AND note the same reasoning applied (or not needed) to
   campaigns and social_accounts. Whatever is chosen must keep the existing atomic-guard pattern intact
   and must not require service-role in the user path.

6. Seat model. Extend PlanCapabilities with maxSeats: number | null (trial 10, starter 10, pro null) —
   give the getPlanCapabilities delta as a contract block. Specify a PURE helper (e.g.
   lib/members/seats.ts) evaluateSeatState({ plan, activeCount, pendingCount }) →
   { used, max, remaining, atCap, overage } with max=null meaning unlimited. Specify the read helper that
   counts active + pending for a business (lib/db/business-members.ts countSeatUsage(businessId)). Specify
   the invite-time enforcement mirroring lib/campaigns/enforcement.ts (over cap → typed result carrying an
   upgrade-CTA target, NOT a thrown error) — cite the existing shape and match it. Specify the OVERAGE-LOCK
   semantics for L-7/D-9: given the Stripe portal cannot be pre-gated, define evaluateSeatState().overage
   as the signal, define what an over-cap business is blocked from (invites + any write that increases
   footprint — decide the exact blocked set), and state clearly that the portal/billing WIRING is 21B.
   Do NOT touch lib/stripe/ this session.

7. Invite + accept contracts (design only — email + UI are 21B). Specify: the reserved business_members
   row on invite (status='invited'); the signed token payload ({ memberId, businessId, exp }) and that it
   reuses the existing HMAC signer (cite it); a SECURITY DEFINER RPC accept_invite(p_token text) that
   verifies signature + expiry, confirms the row is still 'invited', binds user_id = auth.uid(), sets
   status='active' and accepted_at, and is idempotent + safe under a mismatched auth user (the accepting
   auth email need not equal the invited email — decide and justify: bind-on-accept vs enforce-email-match).
   Specify revoke (admin sets status='revoked', frees the seat) and its policy path. NO Resend calls, NO
   /invite/accept route here — name them as 21B deliverables.

8. Erasure cascade (MANDATORY, CLAUDE.md). Add business_members (and any invite-state table) to the ADR
   0010 Amendment 2 §D2.5 cascade table with its PII classification (email, user_id are identity PII) and
   confirm ON DELETE CASCADE from businesses OR explicit handling in purge_business. Give the exact
   §D2.5 row(s) to add and the purge_business delta. A business-scoped table omitted here is a GDPR leak.

9. Migration plan — the exact ordered list of new migration files (real allocated timestamps) and what
   each contains (business_members + its RLS + indexes + trigger; get_user_business_ids replacement;
   user_can; approve_post RPC if chosen in §5; accept_invite RPC; the creator backfill data migration;
   purge_business update). Backfill migration must be idempotent and cover ALL existing businesses.

10. Named constraints the Reviewer can grep — author them as SEAT-*, ROLE-*, RLS-* covering at minimum:
    role enforcement is in the DB not only the app (RLS-); read-widening is helper-only, no existing
    policy body edits (RLS-); the accept path is the ONLY non-service write by a not-yet-member and is a
    DEFINER RPC (RLS-); owner_id member row is un-removable / un-demotable (ROLE-); seat count = active +
    pending incl. owner (SEAT-); maxSeats null = unlimited (SEAT-); invite reserves a seat, revoke frees it
    (SEAT-); Pro→Plus over-cap is blocked via overage lock, billing wiring deferred (SEAT-); NO Stripe
    change this session (SEAT-); backfilled creator = approver+admin ⇒ zero regression (ROLE-); every new
    write policy has both USING and WITH CHECK (RLS-); no service-role in any user request path.

11. File manifest (design-level): NEW (business_members migration, helper-swap migration, user_can
    migration, RPC migration(s), backfill migration, lib/db/business-members.ts, lib/members/seats.ts,
    lib/members/enforcement.ts, lib/stripe/plan.ts delta) and CHANGED (get_user_business_ids, purge_business,
    ADR 0010 cascade table, existing posts/campaigns/social_accounts write policies — DELTA only,
    getPlanCapabilities). Mark clearly what is 21A vs deferred-to-21B/21C.

CONSTRAINTS ON YOU (the Architect):
- Surface the §5 decision with real trade-offs and a named loser; do not silently pick.
- No new dependency. No service-role in a user-facing path. No Stripe edits.
- Where a binding decision (§0) forces a shape, encode it — do not re-open it. Where §0 is silent
  (e.g. status enum granularity, email-match-on-accept, owner-protection mechanism), DECIDE and justify.
- If any binding decision is internally contradictory or infeasible against the actual repo, STOP and
  output "Stopping — §0 conflict at L-<n>: <one line>." Do not invent a workaround.

When the ADR is complete, output exactly:
"ADR 0013 drafted. Awaiting review." Then /exit.
```

---

## §2 — Builder session  (paste into Claude Code · Sonnet)

Nine steps, dependency-ordered, each a self-contained `/ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait for acknowledgement, then paste
B1…B9 one at a time**, letting each finish (green + committed) before the next. Do **not** batch them —
each has its own verification gate, and B2 (read blast-radius) and B5 (capability-differentiated writes)
are the two you most want reviewed in isolation.

All steps inherit these **hard rules** (CLAUDE.md — repeated in each prompt so they can't be skipped):
env only via `lib/config.ts`; DB only via `lib/db/`; service-role client via lazy import and **never**
in a user-facing path; timestamps via `date-fns formatISO`; no `any`, no `console.*`; every UPDATE policy
has both `USING` and `WITH CHECK`; atomic state transitions via conditional `WHERE` guards; no unbounded
queries. This is backend-only: **no `.tsx`, no routes, no email, no `lib/stripe/` behaviour change** (the
sole `lib/stripe/plan.ts` edit is the `maxSeats` constant). `impeccable`/taste are **not** used in 21A.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 21A — Seats & Permissions, BUILDER phase. You will transcribe ADR 0013 (Rev A) into
migrations + typed lib code across nine steps. You are not the designer: the ADR is authoritative.

Read now, before anything else:
- docs/decisions/0013-seats-and-permissions.md (Rev A) — the whole ADR. The §10 named constraints
  (RLS-*, ROLE-*, SEAT-*) are your acceptance checklist; every one must end up covered by a test.
- CLAUDE.md — the hard rules (config/db/service-role/formatISO/no-any/no-console/RLS USING+WITH CHECK/
  atomic guards) and the erasure-cascade rule.
- The files the ADR §11 manifest marks NEW/CHANGED, plus the three precedents it reuses:
  lib/campaigns/enforcement.ts (the cap-enforcement SHAPE to mirror), lib/social/oauth/state.ts (the
  HMAC signer to mirror for invite tokens), and the reschedule_posts_batch RPC (SECURITY-context RPC
  precedent). Read lib/stripe/plan.ts (getPlanCapabilities) and lib/db/{businesses,posts,campaigns,
  social-accounts}.ts.
- supabase/migrations/ — the latest existing timestamp, and the CREATE POLICY statements for posts,
  campaigns, social_accounts (you will DROP/CREATE these by their real names).

Invoke ECC in build posture (you will run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop per
step). Do NOT invoke impeccable-design-and-taste — 21A has no UI.

Do NOT write code yet. First confirm the grounding facts the ADR depends on (a wrong one is a STOP):
(1) the live `plan` enum values — confirm it is ('trial','plus','pro','agency') and that
    getPlanCapabilities is keyed on `plus` (not `starter`). If it is still `starter`, STOP and report.
(2) the exact existing policy names on posts / campaigns / social_accounts that M4/M5 will DROP.
(3) that purge_business ends in a hard `DELETE FROM public.businesses` (so the M8 explicit delete is a
    backstop, not the sole erasure) — or note if it does not.
(4) the latest migration timestamp in supabase/migrations/.
(5) confirm lib/social/oauth/state.ts exposes an HS256 sign/verify pair keyed off a config secret.
Then output those five findings and "Ready for B1." Then stop.
```

### §2b — Builder steps

#### B1 — `business_members` table, RLS, triggers  ·  ADR §2, §2.1, §2.2

```
BUILDER — Session 21A · B1. Transcribe ADR 0013 §2 / §2.1 / §2.2. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- Migration 20260702120000_business_members.sql (allocate the real next timestamp if taken):
  the table exactly as ADR §2 (columns, CHECK business_members_active_has_user, the two partial
  unique indexes business_members_uniq_user / _uniq_email, the two read indexes, set_updated_at
  trigger); RLS per §2.1 (SELECT visible to ALL members — Rev A/m4; INSERT/UPDATE gated by
  user_can('manage_members') — NOTE: user_can does not exist until B3, so this migration must be
  ordered AFTER B3's, OR create business_members with RLS referencing user_can which is created in
  B3; resolve by SEQUENCING — see ORDERING below); no DELETE policy; the
  protect_primary_admin_membership BEFORE UPDATE trigger per §2.2.
- lib/db/business-members.ts — start the module: getMemberById, listMembers (RLS-scoped, ORDER BY +
  bounded). Typed rows; no `any`.

ORDERING: the business_members INSERT/UPDATE policies reference user_can (B3). Either (a) split so the
table+indexes+triggers land here and the policies land in B3, or (b) create user_can first. Choose (a):
here, ship table + indexes + set_updated_at + protect_primary_admin_membership + the SELECT policy
(which needs only get_user_business_ids, already live). Defer the INSERT/UPDATE policies to B3's
migration, immediately after user_can. State this split in your /ecc:plan.

TESTS (TDD): active_has_user CHECK rejects active+null user; partial unique indexes allow re-invite of a
revoked email but block a second active/invited row per (business_id,user_id) and per (business_id,
lower(email)); protect_primary_admin_membership blocks demote/revoke/rebind of the owner_id row and is a
no-op for non-owner rows and for invited rows (OLD.user_id NULL). Constraints touched: SEAT-EMAIL-LOWER,
SEAT-STATUS-3, ROLE-PRIMARY-ADMIN-PROTECT, RLS-INVITED-VISIBLE-ALL, RLS-MEMBERS-USINGCHECK.

Hard rules: config/db boundaries, no any/console, formatISO, RLS USING+WITH CHECK where applicable.
On green + commit, output "B1 complete — business_members table + triggers." Then stop.
```

#### B2 — `get_user_business_ids()` swap + read blast-radius matrix  ·  ADR §3

```
BUILDER — Session 21A · B2. Transcribe ADR 0013 §3. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

BUILD:
- Migration 20260702120100_get_user_business_ids_multimember.sql: CREATE OR REPLACE the helper to the
  exact body in §3 (owner_id ∪ active members, join businesses b ON deleted_at IS NULL, SECURITY
  DEFINER + STABLE + SET search_path=public, REVOKE/GRANT). No other function or policy is edited
  (RLS-READ-HELPER-ONLY).

TESTS (TDD) — the read blast-radius matrix from §3, asserted on a representative RLS table AND on posts
specifically, with seeded fixtures:
  owner → sees own business rows; active member (user_id bound, status=active) → sees the business rows;
  invited member (status=invited, user_id NULL) → sees NOTHING; revoked member → NOTHING; cross-tenant
  user (member of business B) → no rows of business A; member of a soft-deleted business → NOTHING.
Also assert non-recursion holds (a query on business_members under an active member returns without
error). Constraints: RLS-READ-HELPER-ONLY, RLS-HELPER-NORECURSE, RLS-READ-MATRIX.

This is the highest-blast-radius change in the session; the matrix is the gate. Hard rules as B1.
On green + commit, output "B2 complete — get_user_business_ids widened + matrix green." Then stop.
```

#### B3 — `user_can` + business_members write policies  ·  ADR §4, §2.1

```
BUILDER — Session 21A · B3. Transcribe ADR 0013 §4 (and the deferred §2.1 INSERT/UPDATE policies).
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- Migration 20260702120200_user_can.sql: user_can(uuid,text) exactly per §4 (owner override →
  approver+admin; else active member row; capability CASE incl. connect_accounts = approver OR
  is_admin; unknown → false; auth.uid() IS NULL → false), SECURITY DEFINER + STABLE + SET
  search_path=public, REVOKE/GRANT. Then the business_members INSERT + UPDATE policies deferred from
  B1 (§2.1), both carrying USING/WITH CHECK as applicable.
- lib/members/capabilities.ts: the capability string constants ('author','reschedule','approve',
  'connect_accounts','manage_members','manage_billing') as the app-layer echo (constants only in 21A).

TESTS (TDD): a full role×capability matrix table test — for each of viewer/editor/approver (and each
with/without is_admin) assert every capability resolves per ADR §L-2; owner override resolves
approver+admin even with no member row; unknown capability → false; non-member → false; null-auth →
false. Constraints: RLS-USERCAN-DEFINER, RLS-MEMBERS-USINGCHECK, and the L-2 matrix.

Hard rules as B1. On green + commit, output "B3 complete — user_can + member write policies." Stop.
```

#### B4 — seat cap: DB trigger + capabilities + pure evaluator + enforcement  ·  ADR §6

```
BUILDER — Session 21A · B4. Transcribe ADR 0013 §6 (all of it). Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

BUILD:
- lib/stripe/plan.ts: add maxSeats to PlanCapabilities and values — trial 10, plus 10, pro null,
  agency null (§6.1). NO other Stripe/plan change (SEAT-NO-STRIPE).
- Migration 20260702120250_seat_cap_enforcement.sql: plan_max_seats(text) IMMUTABLE (fail-closed
  ELSE 0) + enforce_seat_cap() SECURITY DEFINER (authoritative count) + BEFORE INSERT trigger, exactly
  per §6.6.
- lib/members/seats.ts: pure evaluateSeatState / SeatState per §6.2 (no I/O).
- lib/db/business-members.ts: add countSeatUsage per §6.3 (RLS-scoped active + invited counts).
- lib/members/enforcement.ts: checkInviteAllowed / upgradeCtaTargetFor per §6.4, mirroring the EXACT
  shape of lib/campaigns/enforcement.ts (typed result, not a throw).

TESTS (TDD):
- SSOT sync test (SEAT-CAP-SSOT-SYNC): iterate every Plan value asserting
  plan_max_seats(p) === getPlanCapabilities(p).maxSeats.
- trigger (SEAT-CAP-DB): at cap (used=max) → INSERT rejected; below cap → allowed; unlimited (pro) →
  always allowed; overage (used>max after a simulated plan drop) → INSERT rejected (SEAT-OVERAGE-LOCK).
- evaluateSeatState unit cases incl. max=null (remaining null, atCap false, overage 0).
- checkInviteAllowed returns seat_cap_reached vs overage_locked with the right upgrade CTA.
Constraints: SEAT-MAXSEATS-NULL-UNLIMITED, SEAT-COUNT-ACTIVE-PLUS-PENDING, SEAT-CAP-DB,
SEAT-CAP-SSOT-SYNC, SEAT-OVERAGE-LOCK, SEAT-NO-STRIPE.

Hard rules as B1. On green + commit, output "B4 complete — seat cap DB-enforced + evaluator." Stop.
```

#### B5 — posts role-aware policies + transition-capability trigger  ·  ADR §5

```
BUILDER — Session 21A · B5. Transcribe ADR 0013 §5 / §5.1 / §5.1b. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. THIS IS THE APPROVAL BOUNDARY — treat the test matrix as the acceptance gate.

BUILD:
- Migration 20260702120300_posts_role_aware_and_status_trigger.sql: DROP+CREATE the posts INSERT/
  UPDATE/DELETE policies by their REAL live names (confirmed in the primer) with the user_can
  predicates from §5.1a (author on INSERT/DELETE, reschedule-floor on UPDATE, both USING+WITH CHECK);
  the enforce_post_transition_capability BEFORE UPDATE trigger EXACTLY per §5.1b — gate on →approved
  ONLY (NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' ⇒ require approve; every other
  human transition ⇒ author; auth.uid() IS NULL ⇒ exempt service path). Do NOT touch the posts SELECT
  policy. Do NOT change approvePost / the .eq('status','draft') atomic guard.

TESTS (TDD) — the §5 behaviour matrix, via a raw authenticated (anon-key) client to prove the DB
boundary, not just Server Actions:
  viewer → any posts UPDATE denied; editor → edit/reschedule (status unchanged) allowed; editor →
  approved→draft (unapprove) allowed; editor → approved→skipped (remove) allowed; editor →
  draft→approved (raw write) DENIED (trigger RAISE); approver → draft→approved allowed; service-role →
  approved→scheduled→published allowed (auth.uid() NULL exempt). Assert the atomic guard still yields
  zero-rows (not exception) on a stale draft→approved by an approver. Constraints: RLS-POST-APPROVE-DB,
  RLS-POSTS-USINGCHECK, SEAT-ATOMIC-GUARD-INTACT.

Hard rules as B1; no service-role in the user path. On green + commit, output
"B5 complete — posts approval boundary DB-enforced." Then stop.
```

#### B6 — campaigns + social_accounts role policies  ·  ADR §5.3, §5.4

```
BUILDER — Session 21A · B6. Transcribe ADR 0013 §5.3 / §5.4. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

BUILD:
- Migration 20260702120400_campaigns_social_accounts_role_policies.sql: DROP+CREATE campaigns INSERT/
  UPDATE/DELETE with user_can('author') in USING/WITH CHECK (§5.3); DROP+CREATE social_accounts INSERT/
  UPDATE/DELETE with user_can('connect_accounts') as DEFENSE-IN-DEPTH (§5.4). SELECT policies untouched.
  Use the REAL live policy names (confirmed in the primer).

NOTE (do not implement here): connect/disconnect run under service-role and bypass RLS, so the
authoritative connect_accounts gate is the route-handler user_can call — that is 21B (RLS-SOCIAL-APPLAYER).
This step only adds the defense-in-depth predicate.

TESTS (TDD): viewer → campaigns write denied; editor+ → allowed; a raw authenticated write to
social_accounts without connect_accounts is denied by the predicate. Constraints: (author gate on
campaigns), RLS-SOCIAL-APPLAYER (defense-in-depth predicate present).

Hard rules as B1. On green + commit, output "B6 complete — campaigns/social role policies." Stop.
```

#### B7 — invite token + accept RPC + invite/revoke queries  ·  ADR §7

```
BUILDER — Session 21A · B7. Transcribe ADR 0013 §7 (§7.1–§7.4). Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. Design only — NO Resend, NO route, NO UI.

BUILD:
- lib/config.ts: add INVITE_TOKEN_SECRET (server, ≥32 chars), separate from OAUTH_STATE_SECRET.
- lib/members/invite-token.ts: signInviteToken / verifyInviteToken (HS256, exp 7d, payload
  {memberId,businessId}), mirroring lib/social/oauth/state.ts. Throws on bad sig/expiry.
- Migration 20260702120500_accept_invite_rpc.sql: accept_invite(uuid,uuid) SECURITY DEFINER EXACTLY per
  §7.3 — auth required; idempotent for the same user; double-membership pre-check (raise
  unique_violation-coded error); bind guard with status='invited' AND user_id IS NULL AND
  lower(email)=lower(auth email) AND invited_at > now()-interval '7 days'; ambiguous failure message.
  REVOKE/GRANT.
- lib/db/business-members.ts: add createInvite (INSERTs the reserved row; the seat-cap trigger from B4
  is the boundary), revokeMember (UPDATE status='revoked' under manage_members), acceptInvite (wraps
  the RPC).

TESTS (TDD): token roundtrip, tamper → throw, expiry → throw; accept binds on email-match and rejects
on email-mismatch; accept rejects an invite older than 7 days (DB expiry) even with a valid token;
double-membership → clean error, no raw 23505; idempotent second accept by same user returns the row;
revoke frees the seat (drops out of countSeatUsage) and re-invite of the revoked email is allowed.
Constraints: RLS-ACCEPT-DEFINER-ONLY, SEAT-ACCEPT-EMAIL-MATCH, SEAT-ACCEPT-DB-EXPIRY,
SEAT-ACCEPT-DOUBLE-MEMBER-CHECK, SEAT-REVOKE-FREES-SEAT.

Hard rules as B1. On green + commit, output "B7 complete — invite token + accept RPC." Then stop.
```

#### B8 — primary-admin backfill + purge_business + cascade doc  ·  ADR §8, §9 (M7/M8)

```
BUILDER — Session 21A · B8. Transcribe ADR 0013 §9 M7 + §8/M8. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

BUILD:
- Migration 20260702120600_backfill_owner_members.sql: the idempotent backfill from §9 M7 (INSERT an
  approver + is_admin + active member row for every non-deleted business's owner_id, ON CONFLICT DO
  NOTHING via the partial unique index). Must run AFTER the table/indexes/triggers exist.
- Migration 20260702120700_purge_business_member_delete.sql: CREATE OR REPLACE purge_business adding an
  explicit DELETE FROM public.business_members WHERE business_id = p_business_id BEFORE the root delete
  (§8, Rev A/M3). Preserve all existing purge_business behaviour otherwise.
- docs/decisions/0010-legal-surface.md §D2.5: add the business_members cascade row exactly per ADR §8.

TESTS (TDD): backfill covers ALL seeded businesses, is a no-op on re-run, and the resulting creator row
passes user_can for author/reschedule/approve/connect_accounts/manage_members/manage_billing
(ROLE-CREATOR-NOREG); purge_business erases member rows (GDPR) and remains correct if the cascade is
also present. Constraints: ROLE-CREATOR-BACKFILL-IDEMPOTENT, ROLE-CREATOR-NOREG,
RLS-PURGE-EXPLICIT-MEMBER-DELETE.

Hard rules as B1. On green + commit, output "B8 complete — backfill + purge." Then stop.
```

#### B9 — full verification sweep  ·  the pre-Reviewer gate

```
BUILDER — Session 21A · B9. No new feature code. Run /ecc:verification-loop as a whole-session gate.

DO:
- Scoped typecheck + lint: tsc + eslint over lib/db, lib/members, lib/stripe, supabase/migrations touched
  this session. Zero `any`, zero `console.*`, all env via lib/config, all DB via lib/db.
- Run the FULL migration chain (M1→M8) forward on a fresh DB seeded with ≥2 businesses, each with an
  owner + at least one editor, viewer, approver, one pending invite, and one revoked member. Assert:
  read matrix (B2), approval boundary (B5), seat cap incl. overage (B4), accept incl. email-match/expiry
  (B7), backfill + purge (B8) all hold end-to-end.
- Confirm every §10 named constraint (RLS-*, ROLE-*, SEAT-*) maps to at least one passing test; list any
  that do not and STOP if a constraint is uncovered.
- Confirm NO change under lib/stripe/ beyond plan.ts maxSeats, NO .tsx, NO route, NO email in the diff.

Output a short coverage table (constraint → test file) and "B9 complete — 21A green, ready for review."
Then stop. Do NOT write Reviewer prompts.
```

---

## §3 — Reviewer session  (paste into Claude Code · Opus)

Run **only after** B1–B9, the CI-DB step, and B9-FIX are committed and the DB suite is green against a
real Postgres. The Reviewer is independent (did not write the code) and modifies nothing. Paste the
primer (§3a) first; it forces the Reviewer to establish **test-execution reality** before it audits —
because on this session "covered" has already been shown to mean "authored," and reviewing an unrun RLS
suite is exactly where a read-widening bug hides. Then paste the prompt (§3b).

The audit folds in every item raised in the claude.ai ADR review (M1–M3, m1–m5, n1–n3) plus the two
things this session surfaced: the covered≠executed trap and the B9 coverage gaps.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 21A — Seats & Permissions, REVIEWER phase. You are an INDEPENDENT reviewer: you did NOT write
this code, and you will not modify any file. Your output is a review document only.

Read now:
- docs/decisions/0013-seats-and-permissions.md (Rev A) — the whole ADR. Its §10 named constraints
  (RLS-*, ROLE-*, SEAT-*) are your acceptance checklist.
- CLAUDE.md — the hard rules and the three Supabase client roles.
- The full 21A diff (the PR / commit range), every supabase/migration M1→M8, and every *.test file
  added this session.
- The B9 + B9-FIX coverage tables and the CI-DB workflow (.github/workflows) that runs the DB suite.

Invoke the `database-reviewer` AND `security-reviewer` ECC agents. Do NOT invoke impeccable-design-and-taste
(no UI in 21A).

Before you review anything, ESTABLISH TEST-EXECUTION REALITY and report it — this is the gate:
(1) Confirm the DB-behaviour suite (get-user-business-ids-matrix, user-can-matrix, posts-approval-
    boundary, seat-cap-enforcement, accept-invite-rpc, business-members-constraints, backfill-owner-
    members-and-purge, campaigns-social-accounts-role-policies, and the B9-FIX additions) ACTUALLY
    EXECUTED against a real Postgres+RLS (the CI Supabase stack) and is GREEN — not authored-only, not
    mock-client, not pg_policies-metadata-only. State the target and paste/point to the passing run.
(2) Confirm the full M1→M8 chain applies forward on a FRESH DB in that target (clean-room replay), and
    that the B1/B3 ordering split (business_members write policies reference user_can, created in a
    later migration) applies WITHOUT a missing-function error.
(3) List which §10 constraints have an EXECUTED passing test vs which rest on diff-inspection only.

If (1) or (2) cannot be confirmed, STOP and say so — do not proceed to a code-only review of RLS that
has never run. Otherwise output the three findings above and "Ready to review 21A." Then wait.
```

### §3b — Reviewer prompt  (paste after acknowledgement)

```
REVIEWER — Session 21A. Audit the 21A diff section-by-section against ADR 0013 Rev A. Where you can,
RE-DERIVE the adversarial checks yourself (write the query, reason about the outcome) rather than trust
a test's name. Tier every finding BLOCKER / MAJOR / MINOR / NIT.

SECTION A — READ BLAST-RADIUS  (ADR §3 · RLS-READ-MATRIX, RLS-READ-HELPER-ONLY, RLS-HELPER-NORECURSE)
A1. get_user_business_ids widened to owner_id ∪ active members; SECURITY DEFINER + STABLE + SET
    search_path. Confirm NO existing RLS policy body was edited for reads (only the helper).
A2. Prove the matrix on MORE THAN business_members — pick posts + campaigns + social_accounts + at least
    one metrics table: active member sees tenant rows; invited (user_id NULL) sees NOTHING; revoked sees
    NOTHING; cross-tenant sees NOTHING; member of a soft-deleted business sees NOTHING. This is the
    highest-blast-radius change; a single leaking table is a BLOCKER.
A3. Confirm no recursion: a query on business_members under an active member returns without error.

SECTION B — CAPABILITY ENFORCEMENT IN THE DB  (ADR §4, §5 · RLS-POST-APPROVE-DB, RLS-USERCAN-DEFINER)
B1. user_can resolves the L-2 matrix exactly (re-derive a spot sample per role×capability); owner
    override → approver+admin; connect_accounts = approver OR is_admin (the union); unknown capability →
    false; null auth → false.
B2. Using a RAW authenticated (anon-key) client — NOT a Server Action — prove the DB boundary:
    - viewer → any posts UPDATE denied;
    - editor → edit/reschedule (status unchanged) allowed;
    - editor → draft→approved (grant approval) DENIED by the trigger (Rev A/m3 gate: →approved only);
    - editor → approved→draft (unapprove) and approved→skipped (remove) ALLOWED;
    - approver → draft→approved allowed;
    - service-role → approved→scheduled→published allowed (auth.uid() NULL exempt).
    An editor being able to grant approval is a BLOCKER. An editor being unable to remove is a MAJOR
    (Rev A/m3 regression).
B3. Confirm the atomic guard is intact: a stale draft→approved by an approver yields zero rows, NOT an
    exception (SEAT-ATOMIC-GUARD-INTACT). Confirm every new/edited write policy has USING AND WITH CHECK.

SECTION C — DEFINER FUNCTION HARDENING  (n3 · all SECURITY DEFINER fns)
C1. get_user_business_ids, user_can, accept_invite, enforce_seat_cap — each is SECURITY DEFINER with
    STABLE/IMMUTABLE as appropriate AND SET search_path = public, with REVOKE ALL FROM public / GRANT to
    the intended role only.
C2. n3 CHECK: the two TRIGGER functions enforce_post_transition_capability and
    protect_primary_admin_membership carry SET search_path = public (or every referenced object is
    schema-qualified). Flag if absent.
C3. No DEFINER function trusts a client-supplied identity where auth.uid() should be used.

SECTION D — INVITE / ACCEPT SECURITY  (ADR §7 · m1, m2, m4 · RLS-ACCEPT-DEFINER-ONLY, SEAT-ACCEPT-*)
D1. m4 hijack closure — RE-DERIVE it: invited rows are visible to ALL members (RLS-INVITED-VISIBLE-ALL);
    prove a NON-admin member who reads a pending row's id CANNOT accept it for themselves because
    accept_invite enforces lower(auth.email()) = lower(row.email). A viewer binding an approver invite is
    a BLOCKER.
D2. m1 — accept_invite rejects an invite older than 7 days IN THE DB (invited_at guard), even with a
    still-valid signed token.
D3. m2 — an already-active member accepting a second invite gets a clean coded error, not a raw 23505.
D4. accept_invite is the ONLY non-service write by a not-yet-member; idempotent for the same user;
    single-use (replay after bind fails). Revoke frees the seat (SEAT-REVOKE-FREES-SEAT).
D5. Invite token (lib/members/invite-token.ts) mirrors the OAuth-state signer; tamper/expiry throw;
    INVITE_TOKEN_SECRET is distinct from OAUTH_STATE_SECRET and read via lib/config.ts.

SECTION E — SEATS  (ADR §6 · M2 · SEAT-CAP-DB, SEAT-CAP-SSOT-SYNC, SEAT-OVERAGE-LOCK)
E1. M2 — the seat cap is enforced by the enforce_seat_cap BEFORE INSERT trigger (the boundary), not
    app-layer only: a raw anon INSERT of an over-cap invite is rejected. checkInviteAllowed is a
    fail-fast echo, mirroring lib/campaigns/enforcement.ts shape (typed result, not a throw).
E2. SEAT-CAP-SSOT-SYNC (a B9 gap — verify it is now CLOSED): a test asserts plan_max_seats(p) ===
    getPlanCapabilities(p).maxSeats for EVERY Plan value. Missing this is a MAJOR — it is the only thing
    stopping the SQL map and the TS SSOT from drifting.
E3. maxSeats null (pro/agency) ⇒ unlimited (trigger short-circuits). Seat usage = active + pending,
    owner included; and with m4 visibility, countSeatUsage is accurate for NON-admin callers too (the
    original m4 concern) — confirm.
E4. Overage lock: after a simulated Pro→Plus drop leaving used>max, a new invite INSERT is rejected by
    the same trigger; content ops and revoke remain allowed.

SECTION F — PRIMARY ADMIN & DESTRUCTIVE  (n1 · ADR §2.2, §4 · ROLE-PRIMARY-ADMIN-*)
F1. n1 — there is NO owner role value and NO transfer_ownership anywhere; owner_id is only plumbing.
F2. protect_primary_admin_membership blocks demote/revoke/rebind of the owner_id row; no-op for other
    rows and for invited rows (OLD.user_id NULL).
F3. user_can(b,'delete_account') and user_can(b,'transfer_ownership') both return false; businesses
    UPDATE/DELETE policies remain owner_id-scoped and were NOT edited (ROLE-PRIMARY-ADMIN-ONLY-DESTRUCTIVE).

SECTION G — GDPR ERASURE  (M3 · ADR §8 · RLS-PURGE-EXPLICIT-MEMBER-DELETE)
G1. M3 — purge_business contains an EXPLICIT DELETE FROM business_members before the root delete, AND the
    ON DELETE CASCADE exists as backstop; prove member rows (email, user_id — identity PII) are gone
    after purge. Confirm ADR 0010 §D2.5 has the business_members row.
G2. Confirm purge_business's existing behaviour is otherwise unchanged.

SECTION H — MIGRATION HYGIENE & REGRESSION  (m5 · SEAT-NO-STRIPE, RLS-NO-SERVICE-IN-USER-PATH)
H1. m5 — the DROP POLICY statements in M4/M5 name the ACTUAL live policy names (compare against the
    pre-21A policies on posts/campaigns/social_accounts); a wrong name would have errored the chain —
    confirm the fresh replay proves it.
H2. Backfill (M7): idempotent, covers ALL non-deleted businesses, and the resulting creator row passes
    user_can for author/reschedule/approve/connect_accounts/manage_members/manage_billing
    (ROLE-CREATOR-NOREG). Re-run is a no-op.
H3. SEAT-NO-STRIPE — the ONLY lib/stripe change is maxSeats on PlanCapabilities (+its test). No other
    Stripe/webhook/checkout change.
H4. Scope: zero .tsx, zero app routes, zero lib/email in the diff; no service-role client in any
    user-facing path; no `any`, no `console.*`; env only via lib/config.ts, DB only via lib/db.

SECTION I — CONSTRAINT COVERAGE AUDIT  (the §10 checklist)
I1. Every §10 constraint maps to an EXECUTED passing test OR is explicitly a diff-verified design
    constraint (RLS-READ-HELPER-ONLY, RLS-NO-MIDDLEWARE-ROLE, RLS-NO-SERVICE-IN-USER-PATH, SEAT-NO-STRIPE).
I2. The four B9 gaps are CLOSED with executed tests: SEAT-CAP-SSOT-SYNC, RLS-INVITED-VISIBLE-ALL,
    RLS-MEMBERS-USINGCHECK (the policy itself is exercised — non-admin denied, admin allowed — not just
    user_can the function), SEAT-STATUS-3 (status CHECK rejects a 4th value). Any still-uncovered
    constraint named in §10 is at least a MINOR, and a security-relevant one (approve gate, read matrix,
    accept guards) is a MAJOR/BLOCKER.

OUTPUT: docs/reviews/0013-seats-and-permissions-review.md —
- A table: Section / Check / Status (✅/❌/⚠️) / File:Line / Fix.
- Then every BLOCKER with an exact fix instruction, then MAJOR, then MINOR, then NIT.
- A VERDICT section: blockers before merge · blockers before 21B can build on this · tech-debt
  acceptable to defer.
Do NOT modify any code. Do NOT write the correction prompts — those come from claude.ai after this report.
```

## §4 — Correction pass (STUB)

> Standard Part D (Session 21A-D). Address BLOCKER/MAJOR first. Escape-hatch: if a finding shows an
> ADR-Rev-A contract is infeasible against the repo, open an ADR 0013 **Rev B** amendment rather than
> forcing a workaround. Update `docs/current-phase.md` (21A done, 21B next) and `launch-checklist.md`
> (multi-seat backend row). Then **21B** — invite email (Resend) + `/invite/accept` route + `/settings/team`
> + seat meter + capability-gate retrofit + membership-aware business resolver; **this is where
> `impeccable-design-and-taste` + the taste skill activate**, on the settings/team templates, behind the
> confirmation gate.
