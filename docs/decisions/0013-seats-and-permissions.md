# ADR 0013 — Seats & Permissions (Backend Spine)

- **Status:** Proposed · **Rev B** (Session 21A-D — MAJOR-1 correction applied)
- **Date:** 2026-07-02
- **Supersedes / amends:** ADR 0001 §A (the promised `get_user_business_ids` join swap; "one business per user" app-code assumption), ADR 0010 Amendment 2 §D2.5 (cascade-table addition) + `purge_business` (explicit member erasure)
- **Scope:** This ADR designs the **complete** two-axis seats-&-permissions model so it is internally coherent, but it **fully specifies only the 21A backend spine** and defines the contracts that 21B (invite email flow, `/settings/team`, capability-gate retrofit) and 21C (approver quick-approve tab) consume. UI, email templates, and route retrofits are explicitly deferred (§13).

> **Naming.** The live DB `plan` enum is `('trial','plus','pro','agency')` — the `starter→plus` rename shipped in migration `20260527190000` (confirmed with the founder). Marketing **Plus** = DB `plus`, **Pro** = DB `pro`. `agency` mirrors `pro` and is **slated for removal from planning** — out of scope here; this ADR does not add or drop it, only mirrors `pro`'s `maxSeats: null`.

> **Terminology — no "owner" concept.** Per review (n1) there is **no user-facing owner role and no transfer-ownership feature**. `businesses.owner_id` is retained **only as schema plumbing** denoting the **primary admin** (the account creator). It exists for exactly one reason: something must be un-removable so admins cannot lock each other — or the whole business — out. Every "owner_id" reference below means this plumbing; "primary admin" is the human-facing term. Delete-account is restricted to the primary admin; there is no transfer flow.

> **Rev A — review-response changelog (claude.ai review, 2026-07-02):**
> - **M2** Seat cap is now **DB-enforced** (`plan_max_seats()` helper + `BEFORE INSERT` trigger on `business_members`), not app-layer-only; `checkInviteAllowed` demoted to a fail-fast echo. The same trigger DB-enforces the overage-lock's "block new invites". (§6.4–§6.6)
> - **M3** GDPR: `purge_business` gains an **explicit** `DELETE FROM business_members` (belt-and-suspenders over the cascade). (§8–§9)
> - **m1** `accept_invite` gains a **DB-side 7-day expiry** guard. (§7.3)
> - **m2** `accept_invite` gains a **double-membership pre-check** (graceful "already a member"). (§7.3)
> - **m3** The post-transition gate now fires **only on `→approved`** (granting approval). Editors may remove / skip / unapprove-to-edit / reschedule. (§5.1b)
> - **m4** Pending invites are **visible to all members**; the invite-hijack vector is now closed by **email-match on accept** (reverses the prior no-email-match decision). (§2.1, §7.3)
> - **n1** "Owner" concept + transfer-ownership **removed**; `owner_id` reframed as primary-admin plumbing. (terminology note above; §2.2, §4, §11)
> - **Reviewer must verify (non-blocking, per m5/n3):** (1) the live policy names dropped in M4/M5 (`posts_insert_own` / `_update_own` / `_delete_own`, and the `campaigns` / `social_accounts` equivalents) match the repo before `DROP POLICY`; (2) the two trigger functions (`enforce_post_transition_capability`, `protect_primary_admin_membership`) carry `SET search_path = public` for parity with the DEFINER helpers.

> **Rev B — 21A-D / MAJOR-1 correction (session-21a-reviewer.md, 2026-07-03):**
> - **MAJOR-1** Owner membership is provisioned on business creation by an **AFTER INSERT DEFINER trigger** `ensure_owner_membership` (migration `20260702120800`), mirroring M7's row shape and idempotent via `business_members_uniq_user`. M7 backfills businesses that existed at migration time; the trigger covers every business created afterward. Without it, `countSeatUsage`/`listMembers` under-report the owner for post-21A businesses (not a security gap — the `owner_id` override branches in `get_user_business_ids`/`user_can` are independent of `business_members`). (§9 M9)

---

## 0. Binding decisions (verbatim, adjudicated with the founder — not re-opened)

**Locked (L):**

- **L-1** Two independent axes. Content **role** ∈ `{approver, editor, viewer}` on `business_members.role`. Orthogonal **admin stamp** `business_members.is_admin boolean`. There is **no `owner`/`admin` role value** — the account creator is simply `is_admin = true`.
- **L-2** Capability matrix (authoritative source for `user_can`):

  | Capability | viewer | editor | approver | +admin |
  |---|:--:|:--:|:--:|:--:|
  | Tenant reads (calendar, campaigns, analytics, member list) | ✓ | ✓ | ✓ | — |
  | Author: create/edit **drafts**, create/edit campaigns | — | ✓ | ✓ | — |
  | Reschedule **draft + approved** posts | — | ✓ | ✓ | — |
  | **Approve** (`draft → approved`) | — | — | ✓ | — |
  | Connect / disconnect social accounts | — | — | ✓ | ✓ (union) |
  | Invite / revoke invite / change role / remove member | — | — | — | ✓ |
  | Manage subscription / payments | — | — | — | ✓ |
  | **Delete account** (no transfer feature — n1) | — | — | — | **primary admin (`owner_id`) only** |

- **L-3** `is_admin` is the *only* gate for billing, invitations, and member/seat management. Content role is irrelevant to those. A member may hold any (role × is_admin) combination.
- **L-4** Seats are a **plan capability cap, not a billed quantity.** `getPlanCapabilities` gains `maxSeats`: **trial 10, plus 10, pro `null` (unlimited)**. **No Stripe change of any kind** this session.
- **L-5** Seat usage = **count(active members) + count(pending invites)**, owner included. Compared to `maxSeats`.
- **L-6** A pending invite **reserves a seat**. An admin can **revoke** an invite to release it.
- **L-7** **Pro → Plus downgrade with seat usage > 10 is hard-blocked** via an **app-layer overage lock**. 21A ships the pure overage-evaluation helper + lock semantics; billing/portal wiring lands in 21B. 21A must define, not defer, the semantics.
- **L-8** Backfill the account creator as a `business_members` row: `role='approver'`, `is_admin=true`, `status='active'`, `user_id=businesses.owner_id`. Zero capability regression for existing single-user accounts.
- **L-9** `get_user_business_ids()` widens to `businesses.owner_id` **∪** `business_members` where `status='active'`. Remains `SECURITY DEFINER` / `STABLE`.
- **L-10** Role enforcement lives in the **database**, via `user_can(business_id, capability)` referenced in `USING`/`WITH CHECK` of write policies. Server Actions **also** check `user_can` for fail-fast UX, but the DB is the real boundary.
- **L-11** Invites use a **signed HMAC token** (reuse the OAuth-state signer pattern), a reserved `business_members` row (`status='invited'`, `user_id NULL`, `email` set), and **7-day expiry — enforced BOTH app-side (token) and in-DB (Rev A / m1)**. Acceptance runs through a `SECURITY DEFINER` RPC that **requires email-match** (Rev A / m4) and **pre-checks double-membership** (Rev A / m2). *(Email + accept UI = 21B.)*
- **L-12** `businesses.owner_id` is the **primary-admin invariant**: un-removable, sole holder of delete-account. **No transfer-ownership feature** (Rev A / n1). Admins cannot demote or remove the primary admin.
- **L-13** Every new business-scoped table is added to **ADR 0010 Amendment 2 §D2.5** and to `purge_business` handling — with an **explicit** member-delete (Rev A / M3) — in this PR.
- **L-14** Architect produces **only** this ADR — no `.ts`, no `.sql`.
- **L-15 (Rev A / M2)** The seat cap is **DB-enforced** — a `plan_max_seats(plan)` SQL helper + a `BEFORE INSERT` trigger on `business_members` reject over-cap invites; the app-layer `checkInviteAllowed` is a fail-fast echo, not the boundary. A test asserts the SQL map equals `getPlanCapabilities`.
- **L-16 (Rev A / m4)** Pending (`invited`) rows are **visible to all members**. The in-tenant invite-hijack vector is closed by **email-match on accept** (the accepting auth email must equal the invited email), not by admin-only visibility.
- **L-17 (Rev A / m3)** The post status-transition capability gate fires on **`→approved` only** (granting approval = `approve`, approver-only). All other human transitions (remove/skip/unapprove/reschedule/author) require `author` (editor+). Nothing publishes without a fresh `draft→approved` by an approver.

**Adjudicated decision ledger (D — chosen · named losers):**

| # | Decision | Chosen | Losers |
|---|---|---|---|
| D-1 | Permission shape | role + orthogonal `is_admin` stamp | single hierarchical ladder (conflates billing with content trust) |
| D-2 | Who approves | `approver` only | editor approves (collapses the human-in-the-loop gate) |
| D-3 | Reschedule of approved | editor + approver | approver-only (a day-move ≠ content edit) |
| D-4 | Connect/disconnect | `approver OR is_admin` | admin-only |
| D-5 | Seat billing | plan capability cap, uncharged | metered per-seat billing |
| D-6 | maxSeats | trial 10 / plus 10 / pro null | trial single-user; trial unlimited |
| D-7 | Seat count basis | active + pending, owner incl. | accepted-only |
| D-8 | Pending invite | reserves a seat, admin-revocable | no reservation |
| D-9 | Pro→Plus over-cap | hard block via app-layer overage lock | soft recompute |
| D-10 | Owner representation | member row (approver+admin) **and** `owner_id` pointer | owner-only-in-`owner_id` |
| D-11 | Access resolution | `owner_id ∪ active members`, DEFINER/STABLE | ownership-only |
| D-12 | Role enforcement locus | `user_can` DEFINER helper in RLS + app echo | app-only; inline per-policy predicates |
| D-13 | Invite storage | signed token + reserved row + accept RPC | separate `invites` table |

---

## 1. Relationship to prior ADRs

### 1.1 Fulfilment, not reversal — `get_user_business_ids`
ADR 0001 §A promised: *"the same function will resolve via a `business_members` join table without changes to any policy."* This ADR **fulfils** that promise. Migration 4's helper body (`SELECT … FROM businesses WHERE owner_id = auth.uid()`) is replaced by `owner_id ∪ active members` (§3). Because **every** existing RLS policy already references the helper output (`business_id = ANY ((SELECT public.get_user_business_ids()))`, established in migration `20260430120017`), **no existing RLS policy body is edited for the READ widening.** The helper is the single point of change. This is a design invariant the Reviewer must verify (**RLS-READ-HELPER-ONLY**).

### 1.2 Reversal — "one business per user, enforced in app code"
ADR 0001 §B/§J stated one-business-per-user is enforced in app code and `business_members` is a deferred follow-up. This ADR makes the tenant genuinely multi-member. The schema already permitted it (`owner_id` is not unique); no migration reverses anything. The app-code assumption that surfaces is `getBusinessByOwner(client, user.id)` (see §1.4).

### 1.3 Existing tables whose WRITE policies change (role-aware DELTA)
Read widening touches **no** policy body. Write gating adds a `user_can(...)` predicate to the **write** policies of exactly three tables:

| Table | Write policies changed | Added predicate | Transition-differentiated? |
|---|---|---|---|
| `posts` | INSERT, UPDATE, DELETE (`posts_insert_own` / `_update_own` / `_delete_own`) | `user_can(business_id,'author')` (INSERT/DELETE); `user_can(business_id,'reschedule')` floor (UPDATE) + **status-transition trigger** for `approve` | **Yes** (see §5) |
| `campaigns` | INSERT, UPDATE, DELETE | `user_can(business_id,'author')` | No |
| `social_accounts` | INSERT, UPDATE, DELETE | `user_can(business_id,'connect_accounts')` (defense-in-depth) | No — real path is service-role; app-layer is authoritative (§5.4) |

`SELECT` policies on all tables are **unchanged** (the helper widening handles read access).

**Zero-regression proof for the backfilled creator.** The creator row is `role='approver', is_admin=true`. Against the L-2 matrix, `approver` satisfies `author`, `reschedule`, `approve`, and `connect_accounts`; `is_admin` satisfies `manage_members`, `manage_billing`. `user_can(owner)` additionally hard-codes approver+admin for `owner_id` (§4). Therefore every write an existing single-user owner performs today continues to pass. Verified by **ROLE-CREATOR-NOREG**.

### 1.4 App-code caller that assumes owner == only user
`app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts` (`getAuthContext()`, line ~51) resolves the tenant via `getBusinessByOwner(client, user.id)`. A **non-owner member** has no owned business → `getBusinessByOwner` returns `null` → the action returns `generic`. **Every Server Action using this `owner`-scoped resolution will 404 for members.** This ADR flags it; the **membership-aware business resolver** and the Server-Action `user_can` echo are **21B** deliverables (§13). 21A does **not** change these actions — the DB boundary (RLS + trigger + `user_can`) is the load-bearing enforcement and is complete without them.

### 1.5 `proxy.ts` — no middleware role resolution
`proxy.ts` performs session refresh + an unauthenticated-vs-authenticated route gate only. It has **no business context** (role is per-business, resolved after the tenant is known) and uses the anon session. **Membership/role resolution does not belong at the middleware boundary and is not added there.** Confirmed. (**RLS-NO-MIDDLEWARE-ROLE**.)

---

## 2. `business_members` table

```sql
-- Migration: 20260702120000_business_members.sql
CREATE TABLE public.business_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,   -- NULL until accept
  email        text        NOT NULL,                                      -- stored lower-cased by app
  role         text        NOT NULL CHECK (role IN ('approver','editor','viewer')),
  is_admin     boolean     NOT NULL DEFAULT false,
  status       text        NOT NULL DEFAULT 'invited'
                             CHECK (status IN ('invited','active','revoked')),
  invited_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL for backfilled owner
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- An active member must be bound to a user; an invited member must not be.
  CONSTRAINT business_members_active_has_user
    CHECK ((status = 'active' AND user_id IS NOT NULL)
        OR (status <> 'active'))
);

-- One active/invited membership per user per business (revoked excluded → re-invite allowed).
CREATE UNIQUE INDEX business_members_uniq_user
  ON public.business_members (business_id, user_id)
  WHERE user_id IS NOT NULL AND status IN ('invited','active');

-- One active/invited membership per email per business (revoked excluded).
CREATE UNIQUE INDEX business_members_uniq_email
  ON public.business_members (business_id, lower(email))
  WHERE status IN ('invited','active');

-- Read path: get_user_business_ids() scans active members by user_id.
CREATE INDEX business_members_active_user_idx
  ON public.business_members (user_id) WHERE status = 'active';
-- Member-list + seat-count path.
CREATE INDEX business_members_business_idx
  ON public.business_members (business_id);

CREATE TRIGGER trg_business_members_updated_at
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Decisions where §0 is silent:**

- **`email` normalisation — lower()-normalised `text`, not `citext`.** Justification: `citext` adds an extension to the schema surface for one column; the uniqueness guarantee is fully expressed by `lower(email)` in the partial index, and the app normalises on write. No new extension dependency (aligns with the "no new dependency" constraint). (**SEAT-EMAIL-LOWER**.)
- **`status` enum — `'removed'` is folded into `'revoked'`.** A removed active member and a revoked pending invite are the same terminal inactive state: both free the seat, both drop out of `active`, neither cascades differently. Distinguishing them adds enum granularity with no capability or GDPR consequence; who/when is captured by `updated_at`. Enum = `('invited','active','revoked')`. (**SEAT-STATUS-3**.)
- **`invited_by` → `auth.users` `ON DELETE SET NULL`.** The inviter may later be removed/erased; the membership must survive that. Referencing `auth.users` (not `business_members`) avoids a self-FK and is stable across the inviter's own membership changes.
- **`user_id` → `auth.users` `ON DELETE CASCADE`.** If a user's identity is erased, their memberships vanish. Nullable (invited rows have no user yet), which `ON DELETE CASCADE` tolerates.

### 2.1 RLS

```sql
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the tenant sees ALL member rows, including pending
-- invites (Rev A / m4 — full team + seat-meter transparency for every member,
-- so a non-admin seat meter is accurate without a definer count). The invite-
-- hijack vector this visibility would otherwise open is closed NOT here but at
-- accept time, by the email-match guard in accept_invite (§7.3): reading a
-- pending row's id is harmless because binding it requires the auth email to
-- equal the invited email. No sensitive possession secret lives on the row.
CREATE POLICY business_members_select ON public.business_members
  FOR SELECT TO authenticated
  USING (
    business_id = ANY ((SELECT public.get_user_business_ids()))
  );

-- INSERT (invite): admins only; new rows are reserved invites.
CREATE POLICY business_members_insert ON public.business_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.user_can(business_id, 'manage_members'))
    AND status = 'invited' AND user_id IS NULL
  );

-- UPDATE (change role / revoke): admins only. Primary-admin protection is a trigger (§2.2).
-- The accept path is NOT here — the invitee is not yet a member, so user_can is
-- false for them; acceptance runs through the DEFINER RPC accept_invite (§7).
CREATE POLICY business_members_update ON public.business_members
  FOR UPDATE TO authenticated
  USING      ((SELECT public.user_can(business_id, 'manage_members')))
  WITH CHECK ((SELECT public.user_can(business_id, 'manage_members')));

-- No DELETE policy. Revocation is an UPDATE to status='revoked' (frees the seat,
-- retains the audit row). Hard delete happens only via ON DELETE CASCADE on
-- business purge. This is also why owner protection (§2.2) is UPDATE-only.
```

Every write policy carries both `USING` and `WITH CHECK` where the command requires them (**RLS-MEMBERS-USINGCHECK**). No new table without RLS — satisfied.

### 2.2 Primary-admin protection — **BEFORE UPDATE trigger** (chosen)

The primary admin is the account creator (`businesses.owner_id`). This trigger guarantees at least
one un-removable admin so admins cannot lock each other — or the whole business — out. There is no
"owner" role and no transfer feature (n1); this is purely the un-removable-admin safety invariant.

```sql
CREATE OR REPLACE FUNCTION public.protect_primary_admin_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only the primary admin's own membership row is protected.
  IF OLD.user_id = (SELECT owner_id FROM public.businesses WHERE id = OLD.business_id) THEN
    IF NEW.is_admin IS DISTINCT FROM true
       OR NEW.role   IS DISTINCT FROM 'approver'
       OR NEW.status IS DISTINCT FROM 'active'
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'primary admin membership cannot be demoted, revoked, or rebound';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_primary_admin_membership
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_admin_membership();
```

**Why a trigger over a policy clause (chosen; loser named):** the invariant ("the primary-admin row stays `approver`+`admin`+`active`") is a single centralised rule with a clear error message, robust to future policy edits, and enforced on **every** write path (including the DEFINER `accept_invite` RPC and any future service write). A `WITH CHECK` clause could express it (owner's `user_id` is stable, so the new-row predicate suffices), but it would smear the invariant across the UPDATE policy and be silently droppable by a later policy rewrite. **Loser: RLS `WITH CHECK`/`USING` clause** — feasible but less auditable and only guards the two policy commands, not the DEFINER path.

**Why BEFORE UPDATE only (not DELETE):** in this model removal = `status='revoked'` (an UPDATE). There is no user-facing DELETE. Making the trigger UPDATE-only leaves the `ON DELETE CASCADE` purge path (§8) unblocked — a BEFORE DELETE guard would `RAISE` on the primary-admin row during business purge and **break GDPR erasure.** (**ROLE-PRIMARY-ADMIN-PROTECT**, **RLS-PURGE-EXPLICIT-MEMBER-DELETE**.)

Primary-admin protection is triple-layered: (1) `get_user_business_ids` retains access via its `owner_id` branch regardless of the row; (2) `user_can` hard-codes approver+admin for `owner_id` (§4); (3) this trigger prevents the row itself from being demoted, revoked, or rebound.

---

## 3. `get_user_business_ids()` — new body

```sql
-- Migration: 20260702120100_get_user_business_ids_multimember.sql
CREATE OR REPLACE FUNCTION public.get_user_business_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT bid), ARRAY[]::uuid[])
  FROM (
    SELECT id AS bid
    FROM public.businesses
    WHERE owner_id = auth.uid()
      AND deleted_at IS NULL
    UNION
    SELECT m.business_id AS bid
    FROM public.business_members m
    JOIN public.businesses b ON b.id = m.business_id AND b.deleted_at IS NULL
    WHERE m.user_id = auth.uid()
      AND m.status = 'active'
  ) s;
$$;

REVOKE ALL ON FUNCTION public.get_user_business_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_business_ids() TO authenticated;
```

- **Owner branch retained** so ownership access never depends on the member row (belt-and-suspenders, and correct during the backfill window).
- **`b.deleted_at IS NULL` join** so a member of a soft-deleted business loses access, matching the owner branch.
- **`SECURITY DEFINER` + `STABLE` + `SET search_path=public` preserved.**

**Non-recursion proof.** `SECURITY DEFINER` runs the function as its owner (the migration/superuser role), for whom RLS is not applied. Reading `business_members` (which has RLS whose INSERT/UPDATE policies call `user_can`, and whose SELECT policy calls `get_user_business_ids`) inside a DEFINER function does **not** re-enter those policies — RLS is bypassed for the definer. This is the identical argument migration 4 used for reading `businesses`. If this function ran `SECURITY INVOKER`, the `business_members` SELECT policy would call `get_user_business_ids` → infinite recursion; DEFINER is therefore mandatory. (**RLS-HELPER-NORECURSE**.)

**Read blast radius (the single hardest test target).** This one function widens access on **every** RLS-protected table simultaneously (`brand_voices`, `social_accounts`, `trial_state`, `campaigns`, `posts`, `post_metrics`, `engagement_inbox`, `ai_usage`, `post_generation_sessions`, `business_members`). The Builder test matrix (21A verification / 21B B2) must assert, on a representative RLS table **and** on `posts` specifically:

| Actor | Expectation |
|---|---|
| Owner | sees own business rows |
| Active member (`status='active'`, `user_id` bound) | sees the business's rows |
| Invited member (`status='invited'`, `user_id NULL`) | sees **nothing** (not yet active) |
| Revoked member (`status='revoked'`) | sees **nothing** |
| Cross-tenant user (member of business B) | sees **no** rows of business A |
| Member of a soft-deleted business | sees **nothing** |

(**RLS-READ-MATRIX**.)

---

## 4. `user_can(business_id, capability)`

```sql
-- Migration: 20260702120200_user_can.sql
CREATE OR REPLACE FUNCTION public.user_can(p_business_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;                       -- no anonymous / service capability here
  END IF;

  -- Owner override: the owner is approver + admin, independent of any member row.
  IF EXISTS (SELECT 1 FROM public.businesses
             WHERE id = p_business_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    v_role := 'approver'; v_is_admin := true;
  ELSE
    SELECT m.role, m.is_admin INTO v_role, v_is_admin
    FROM public.business_members m
    WHERE m.business_id = p_business_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN false;                     -- not a member of this tenant
    END IF;
  END IF;

  RETURN CASE p_capability
    WHEN 'author'           THEN v_role IN ('editor','approver')
    WHEN 'reschedule'       THEN v_role IN ('editor','approver')
    WHEN 'approve'          THEN v_role =  'approver'
    WHEN 'connect_accounts' THEN v_role =  'approver' OR v_is_admin   -- L-2 union / D-4
    WHEN 'manage_members'   THEN v_is_admin
    WHEN 'manage_billing'   THEN v_is_admin
    ELSE false                          -- unknown capability → deny
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.user_can(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.user_can(uuid, text) TO authenticated;
```

**Capability string constants** (the Builder mirrors these in `lib/members/capabilities.ts` for the app-layer echo): `'author'`, `'reschedule'`, `'approve'`, `'connect_accounts'`, `'manage_members'`, `'manage_billing'`. `author` and `reschedule` resolve identically today (editor+) but are kept as distinct rows so they map 1:1 to the L-2 matrix and can diverge later without touching call sites.

**`delete_account` is NOT a `user_can` capability; there is no `transfer_ownership` (n1).** Delete is **primary-admin-only** (`owner_id`), enforced separately: `businesses` UPDATE/DELETE remain `owner_id`-scoped (migration `20260430120003` policies are **unchanged**; there is no DELETE policy — deletion is the service-role purge path). `user_can` never returns true for a destructive capability; passing such a string hits the `ELSE false` deny. (**ROLE-PRIMARY-ADMIN-ONLY-DESTRUCTIVE**.)

**Non-recursion:** `SECURITY DEFINER` bypasses `business_members`/`businesses` RLS, so `user_can` used inside `business_members`'s own INSERT/UPDATE policies does not recurse into them. `SET search_path=public` blocks search-path privilege escalation on the DEFINER function. (**RLS-USERCAN-DEFINER**.)

**`auth.uid() IS NULL ⇒ false`** means service-role callers get no capability from `user_can`; this is intentional — service paths are trusted by other means and must not route capability through this helper. It also means `user_can` is safe to reference in triggers that also fire on the service path (§5.2 exempts the service path *before* consulting `user_can`).

---

## 5. THE HARD ONE — capability-differentiated writes on `posts`

`posts` receives three writes needing **different** capabilities: author-edit content (editor+), reschedule `scheduled_at` (editor+), and **approve** `draft→approved` (approver only). The publishing/metrics workers additionally drive `approved→scheduled→published→failed` via **service-role**.

**The core problem.** RLS policies are **per-command** (one `UPDATE` policy), not per-intent. A single policy predicate cannot correlate `OLD` and `NEW`: `USING` sees only the old row, `WITH CHECK` sees only the new row, and neither expression sees both together. So RLS alone **cannot** express "if `status` goes `draft→approved`, require `approve`; otherwise require `editor+`." Proven.

### 5.1 Mechanism chosen: (c) BEFORE UPDATE trigger + editor-floor RLS policy

The `posts` `UPDATE` policy provides the **tenant + editor-floor** (any editor+ may update the row at all); a `BEFORE UPDATE` **trigger** enforces the **transition-differentiated** capability by comparing `OLD.status`/`NEW.status`.

```sql
-- Migration: 20260702120300_posts_role_aware_and_status_trigger.sql

-- 5.1a — Role-aware write policies (DELTA; SELECT policy untouched).
DROP POLICY posts_insert_own ON public.posts;
DROP POLICY posts_update_own ON public.posts;
DROP POLICY posts_delete_own ON public.posts;

CREATE POLICY posts_insert_own ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = ANY ((SELECT public.get_user_business_ids()))
    AND (SELECT public.user_can(business_id, 'author'))
  );

-- Editor-floor: any editor+ may UPDATE the row. The trigger differentiates the
-- approval boundary. Keeps the existing atomic-guard pattern (callers still add
-- .eq('status','draft')); the WHERE guard and the capability check are orthogonal.
CREATE POLICY posts_update_own ON public.posts
  FOR UPDATE TO authenticated
  USING      (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'reschedule')))
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'reschedule')));

CREATE POLICY posts_delete_own ON public.posts
  FOR DELETE TO authenticated
  USING (business_id = ANY ((SELECT public.get_user_business_ids()))
         AND (SELECT public.user_can(business_id, 'author')));

-- 5.1b — Status-transition capability trigger (the real approval boundary).
CREATE OR REPLACE FUNCTION public.enforce_post_transition_capability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Service path (publishing/metrics workers) has no auth.uid(): exempt.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Rev A / m3 / L-17: ONLY *granting* approval is approver-gated. Every other
    -- human transition — unapprove (approved->draft to edit), remove (->skipped),
    -- author (draft<->skipped) — is editor+. Rationale: the gate exists to control
    -- what PUBLISHES, and nothing publishes without a fresh draft->approved; letting
    -- editors move/remove/unapprove approved posts cannot cause a publish and matches
    -- their existing ability to reschedule approved posts (D-3).
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      IF NOT public.user_can(NEW.business_id, 'approve') THEN
        RAISE EXCEPTION 'approve capability required to grant approval (% -> %)',
          OLD.status, NEW.status;
      END IF;
    ELSE
      -- All other human status changes (incl. approved->draft, approved->skipped) are authoring.
      IF NOT public.user_can(NEW.business_id, 'author') THEN
        RAISE EXCEPTION 'author capability required for status transition % -> %',
          OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_post_transition_capability
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_transition_capability();
```

**Behaviour matrix:**

| Actor · action | Editor-floor policy | Trigger | Result |
|---|---|---|---|
| viewer · anything | fails `USING` (`reschedule`=false) | — | **denied** |
| editor · edit content / reschedule (`status` unchanged) | passes | no transition → no assert | **allowed** |
| editor · `draft→approved` (raw anon write) | passes floor | `→approved` → `approve`=false → RAISE | **denied** ✅ |
| editor · `approved→draft` (unapprove to edit) | passes | not `→approved` → `author`=true | **allowed** (Rev A / m3) |
| editor · `approved→skipped` (remove) | passes | not `→approved` → `author`=true | **allowed** (Rev A / m3) |
| approver · `draft→approved` (grant approval) | passes | `approve`=true | **allowed** |
| worker (service-role) · `approved→scheduled→published` | RLS bypassed | `auth.uid() IS NULL` → exempt | **allowed** |

The existing `approvePost` helper (`.update({status:'approved'}).eq('status','draft')`, `lib/db/posts.ts`) is **unchanged**: its `.eq('status','draft')` remains the atomic state guard; the trigger adds the capability guard. No service-role enters the user path. (**RLS-POST-APPROVE-DB**, **SEAT-ATOMIC-GUARD-INTACT**.)

### 5.2 Why (c) wins — named losers

- **(a) Editor-floor policy + `approve_post` DEFINER/INVOKER RPC — LOSER (insufficient).** The floor policy admits any editor UPDATE, and `WITH CHECK` (new row) sees a perfectly valid `status='approved'` row. An editor can therefore issue a **raw anon-client** `update({status:'approved'})` and bypass the RPC entirely — the RPC is never on the critical path. This directly fails the Reviewer test "a viewer/editor cannot approve via a raw anon write." Routing through an RPC only helps if editors are *forbidden* from writing `status` at all, which RLS cannot express per-user (see (b)). Rejected despite being the "lean" candidate.
- **(b) Column-level UPDATE privileges (`GRANT UPDATE(status)` vs `UPDATE(content, scheduled_at)`) — LOSER (infeasible at app-user granularity).** Postgres column privileges are granted to **database roles**. Every SOSH end-user authenticates as the single `authenticated` role; there is no `approver` DB role vs `editor` DB role. You cannot `GRANT UPDATE(status)` to approver-users but not editor-users because they are the same DB principal. Rejected.
- **(c) BEFORE UPDATE trigger — WINNER.** The trigger is the only mechanism that sees `OLD` and `NEW` together, runs on **every** write path including a raw anon client, keeps the atomic-guard pattern intact, and cleanly exempts the service worker via `auth.uid() IS NULL`. It needs no new DB role, no service-role in the user path, and no new dependency.

### 5.3 `campaigns` — simple policy delta, no trigger
`campaigns` has no capability-differentiated transition (post-level approval is the only approval gate). Its INSERT/UPDATE/DELETE policies gain `AND (SELECT public.user_can(business_id, 'author'))` in both `USING` and `WITH CHECK`. A viewer cannot write campaigns; editor+ can. (Migration `20260702120400`.)

### 5.4 `social_accounts` — app-layer authoritative, policy delta is defense-in-depth
**Grounded finding:** the real connect path writes the `social_accounts` row via **service-role** (`app/api/social/[platform]/callback/route.ts` switches to `createServiceRoleClient()` before the `insert`, because the vault token ids must be written), and disconnect runs entirely under service-role (`deactivateSocialAccount`, `lib/db/social-accounts.ts`). Service-role **bypasses RLS**, so a role-aware `social_accounts` write policy **cannot** gate the actual connect/disconnect flow.

Therefore `connect_accounts` is the **one capability whose authoritative enforcement is app-layer**: the connect and disconnect route handlers MUST call `user_can(businessId,'connect_accounts')` before invoking the service path. This is a justified, documented exception to L-10's "DB is the real boundary" — here the DB boundary is unavailable because Vault *forces* service-role. We still add the `connect_accounts` predicate to the `social_accounts` authenticated-client write policies (INSERT/UPDATE/DELETE) as defense-in-depth for any future authenticated write. **Wiring the route-handler `user_can` gate is 21B** (§0 lists "accounts" under the 21B retrofit). (**RLS-SOCIAL-APPLAYER**.)

---

## 6. Seat model

### 6.1 `PlanCapabilities.maxSeats` (contract delta — `lib/stripe/plan.ts`)

```typescript
export interface PlanCapabilities {
  // …existing fields…
  /** Max total seats (active members + pending invites, owner incl.). null = unlimited. */
  maxSeats: number | null
}

// CAPABILITIES delta (keyed by the live Plan enum: trial | plus | pro | agency):
//   trial:  maxSeats: 10
//   plus:   maxSeats: 10
//   pro:    maxSeats: null      // via PRO_CAPABILITIES
//   agency: maxSeats: null      // mirrors pro (Phase 4)
```

`PRO_CAPABILITIES` gains `maxSeats: null`; `trial` and `plus` get `maxSeats: 10`. No other capability changes. (**SEAT-MAXSEATS-NULL-UNLIMITED**.)

### 6.2 Pure evaluator — `lib/members/seats.ts`

```typescript
export interface SeatState {
  used: number
  max: number | null          // null = unlimited
  remaining: number | null    // null when max is null
  atCap: boolean              // used >= max (false when unlimited)
  overage: number             // max===null ? 0 : Math.max(0, used - max)
}

export function evaluateSeatState(input: {
  plan: Plan
  activeCount: number
  pendingCount: number
}): SeatState
// used = activeCount + pendingCount
// max  = getPlanCapabilities(input.plan).maxSeats
// remaining = max === null ? null : max - used
// atCap = max !== null && used >= max
// overage = max === null ? 0 : Math.max(0, used - max)
```

Pure, deterministic, no I/O. `overage > 0` is the **only** signal an over-cap tenant exists (e.g. after a Pro→Plus downgrade drops `max` from `null`→`10` while `used=15` ⇒ `overage=5`).

### 6.3 Read helper — `lib/db/business-members.ts`

```typescript
// Counts active + pending (invited) members for a business. Owner is an active
// member row (backfill) → counted naturally, no special-case. status='revoked' excluded.
export async function countSeatUsage(
  client: SupabaseClient,
  businessId: string,
): Promise<{ activeCount: number; pendingCount: number }>
```

Counts via RLS-scoped `business_members` (`status='active'` and `status='invited'`). (**SEAT-COUNT-ACTIVE-PLUS-PENDING**.)

### 6.4 Invite-time enforcement — `lib/members/enforcement.ts` (mirrors `lib/campaigns/enforcement.ts`)

Mirrors the **exact shape** of `checkCampaignCreationAllowed` / `upgradeCtaTargetFor`: a typed result, **not** a thrown error, carrying an upgrade-CTA target.

```typescript
export type SeatEnforcementReason = 'seat_cap_reached' | 'overage_locked'

export async function checkInviteAllowed(
  client: SupabaseClient,
  business: BusinessRow,
): Promise<{ allowed: boolean; reason?: SeatEnforcementReason; seats: SeatState }>
// atCap (used >= max, max != null)  → { allowed:false, reason:'seat_cap_reached' }
// overage > 0                       → { allowed:false, reason:'overage_locked' }
// otherwise                         → { allowed:true }

export function upgradeCtaTargetFor(reason: SeatEnforcementReason): '/billing' | null
// both reasons → '/billing'   (matches campaigns/enforcement.ts:34 shape)
```

The invite Server Action (21B) calls this **as a fail-fast echo** for UX (typed reason + upgrade CTA). It is **not** the boundary: the real seat-cap boundary is the DB `BEFORE INSERT` trigger in **§6.6** (Rev A / M2 — corrects the earlier claim that the `business_members_insert` policy stops over-cap invites; that policy checks `manage_members` + shape only and does **not** count seats).

### 6.5 Overage-lock semantics (L-7 / D-9) — defined, not deferred

Because the Stripe Customer Portal is Stripe-hosted, a Pro→Plus downgrade **cannot** be pre-gated at transaction time. 21A therefore defines the **post-hoc overage lock**:

- **Signal:** `evaluateSeatState().overage > 0` for a business.
- **Blocked action set (exact):** **seat-footprint-increasing actions only** — i.e. **new invites**. This is **DB-enforced**: the §6.6 `BEFORE INSERT` trigger rejects any invite while `count(active+invited) ≥ plan_max_seats`, which is exactly the over-cap condition (an over-cap tenant already has `used > max ≥` the threshold). `checkInviteAllowed` additionally returns `reason:'overage_locked'` for the UX message. Nothing that raises `used` is permitted while over cap.
- **Explicitly NOT blocked:** **revoke** (it *reduces* `used` — it is the way out of the lock), and **all content operations** (authoring, rescheduling, approving posts/campaigns) — those do not consume seats, and locking the whole product on a billing edge would be user-hostile and is out of scope for a seat cap.
- **Clearing the lock:** an admin revokes members until `used ≤ max` (`overage=0`).
- **21B owns the wiring:** surfacing the lock in `/settings/team`/billing, the portal messaging, and any decision to broaden the lock. **`lib/stripe/` is not touched this session.** (**SEAT-OVERAGE-LOCK**, **SEAT-NO-STRIPE**.)

### 6.6 DB-level seat-cap enforcement (Rev A / M2 — the real boundary)

The seat cap is **enforced in the database**, not app-side only. A tiny SQL helper encodes the
plan→max map and a `BEFORE INSERT` trigger on `business_members` rejects an invite that would exceed
it. `null` (pro/agency) means unlimited → the trigger short-circuits.

```sql
-- Migration: 20260702120250_seat_cap_enforcement.sql

-- Plan→max-seats map, SQL-side. Kept trivially small; a Builder test asserts it
-- equals lib/stripe/plan.ts getPlanCapabilities().maxSeats for every Plan value.
CREATE OR REPLACE FUNCTION public.plan_max_seats(p_plan text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_plan
    WHEN 'trial' THEN 10
    WHEN 'plus'  THEN 10
    WHEN 'pro'   THEN NULL      -- unlimited
    WHEN 'agency'THEN NULL      -- mirrors pro; slated for removal
    ELSE 0                      -- unknown plan → no seats (fail closed)
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_seat_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max  integer;
  v_used integer;
BEGIN
  -- Only invited/active rows consume seats; anything else (shouldn't INSERT) is ignored.
  IF NEW.status NOT IN ('invited','active') THEN
    RETURN NEW;
  END IF;

  SELECT public.plan_max_seats(b.plan) INTO v_max
  FROM public.businesses b WHERE b.id = NEW.business_id;

  IF v_max IS NULL THEN
    RETURN NEW;                       -- unlimited (pro/agency)
  END IF;

  -- Count existing seat-consuming rows for this business (authoritative: DEFINER
  -- bypasses RLS so the count is independent of the caller's visibility).
  SELECT count(*) INTO v_used
  FROM public.business_members
  WHERE business_id = NEW.business_id AND status IN ('invited','active');

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'seat cap reached for plan (% of % seats used)', v_used, v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_seat_cap
  BEFORE INSERT ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_seat_cap();
```

- **Why DEFINER + authoritative count:** the count must not depend on the inserting caller's RLS
  visibility. DEFINER makes it exact regardless.
- **Why it also enforces the overage lock:** a Pro→Plus downgrade leaves `v_used > v_max`; the next
  invite INSERT hits `v_used >= v_max` → rejected. No separate lock mechanism needed (§6.5).
- **App-layer echo stays:** `checkInviteAllowed` (§6.4) runs first for a clean typed error + upgrade
  CTA; the trigger is the boundary that holds even against a raw anon INSERT.
- **SSOT guard:** the SQL map duplicates `getPlanCapabilities().maxSeats`. A Builder unit test iterates
  every `Plan` value asserting `plan_max_seats(p) === getPlanCapabilities(p).maxSeats` so the two
  cannot drift. (**SEAT-CAP-DB**, **SEAT-CAP-SSOT-SYNC**.)

---

## 7. Invite + accept contracts (design only — email + UI are 21B)

### 7.1 Reserved row on invite
An invite INSERTs a `business_members` row: `status='invited'`, `user_id=NULL`, `email=lower(input)`, `role`, `is_admin`, `invited_by=auth.uid()`. Gated by `business_members_insert` (admins only) + `checkInviteAllowed` (seat cap). The row **reserves the seat** (L-6). Revoke frees it (§7.4).

### 7.2 Signed token — reuse the existing HMAC signer pattern
The invite token reuses the **pattern** of `lib/social/oauth/state.ts` (`signOAuthState`/`verifyOAuthState`, `jose` HS256 keyed off `config.server.OAUTH_STATE_SECRET`). New module `lib/members/invite-token.ts`, new secret `config.server.INVITE_TOKEN_SECRET` (≥32 chars, separate from the OAuth secret so blast radius and rotation are independent).

```typescript
// lib/members/invite-token.ts  (contract; Builder writes it in 21A-B5, wired in 21B)
export interface InviteTokenClaims { memberId: string; businessId: string }
export function signInviteToken(input: InviteTokenClaims): Promise<string>   // HS256, exp 7d
export function verifyInviteToken(token: string): Promise<InviteTokenClaims> // throws on bad sig/expiry
```

Payload = `{ memberId, businessId, exp: 7d }` (L-11). The HMAC provides integrity + expiry, verified **app-side** in the 21B Server Action.

### 7.3 `accept_invite` — SECURITY DEFINER RPC

```sql
-- Migration: 20260702120500_accept_invite_rpc.sql
CREATE OR REPLACE FUNCTION public.accept_invite(p_member_id uuid, p_business_id uuid)
RETURNS public.business_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       public.business_members;
  v_auth_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(email) INTO v_auth_email FROM auth.users WHERE id = auth.uid();

  -- Idempotency: already accepted by THIS user → return the row unchanged.
  SELECT * INTO v_row FROM public.business_members
   WHERE id = p_member_id AND business_id = p_business_id;
  IF FOUND AND v_row.status = 'active' AND v_row.user_id = auth.uid() THEN
    RETURN v_row;
  END IF;

  -- Rev A / m2 — double-membership pre-check: if this user is ALREADY an active
  -- member of this business via a different row, don't trip the unique index with
  -- a raw 23505; raise a clear, catchable message for 21B to surface (e.g. auto-
  -- revoke the redundant invite + "you're already on this team").
  IF EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND id <> p_member_id
  ) THEN
    RAISE EXCEPTION 'already an active member of this business'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Bind. Guards, all atomic in one WHERE:
  --   status='invited' AND user_id IS NULL   → single-use (replay fails once bound)
  --   lower(email)=v_auth_email              → Rev A / m4 email-match (closes the
  --                                             in-tenant hijack now that invited
  --                                             rows are visible to all members)
  --   invited_at > now()-7d                  → Rev A / m1 DB-side expiry (holds even
  --                                             if the app-side token check is skipped)
  UPDATE public.business_members
     SET user_id = auth.uid(), status = 'active', accepted_at = now()
   WHERE id = p_member_id
     AND business_id = p_business_id
     AND status = 'invited'
     AND user_id IS NULL
     AND lower(email) = v_auth_email
     AND invited_at > now() - interval '7 days'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Ambiguous by design: don't leak whether it was expiry / email-mismatch /
    -- already-claimed / unknown. 21B shows a generic "invite is no longer valid".
    RAISE EXCEPTION 'invite not available (expired, already accepted, revoked, wrong account, or unknown)';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid, uuid) TO authenticated;
```

**Why DEFINER:** the accepting user is **not yet a member**, so `get_user_business_ids()` does not include the business and the `business_members_update` policy (`user_can(...,'manage_members')`) is false for them. RLS cannot admit this write; a DEFINER RPC is the only correct mechanism. This is the **only** non-service write performed by a not-yet-member, and it is a DEFINER RPC with an atomic guard. (**RLS-ACCEPT-DEFINER-ONLY**.)

**Signature deviates from the brief's `accept_invite(p_token text)` — decided and justified.** In-DB verification of an HS256 token would require the signing secret to live inside Postgres (a GUC or Vault) and either `pgjwt` or a hand-rolled `pgcrypto` HMAC — enlarging the secret's blast radius into the database and adding schema surface. Instead the **21B Server Action verifies the token app-side** (`verifyInviteToken`, same secret custody as OAuth state) and passes the verified `{memberId, businessId}` to the RPC. **Named loser: in-DB `p_token` verification** — rejected to keep the secret app-side and avoid coupling.

**Closing the in-tenant hijack vector (Rev A / m4 — via email-match, not visibility).** Pending rows are now visible to **all** members (§2.1, L-16), so admin-only visibility no longer guards the invite `id`. The residual risk — an existing member reads a pending row's `id` and calls `accept_invite` directly to claim its seat *and role* (a privilege escalation: a viewer binding an approver invite) — is instead closed by the **email-match guard**: the bind only succeeds when `lower(auth.email()) = lower(row.email)`. A member cannot forge their authenticated email, so knowing the `id` is insufficient. Nothing secret lives on the row, so full visibility is safe. **Loser considered: an `accept_nonce` column** (a possession secret echoed in the token) — rejected because, with invited rows visible to all, the nonce would itself be readable unless hidden behind a column-masking view (column privileges are per-DB-role and all users share `authenticated`), which is heavier than one email-equality predicate. **Loser considered: keep invites admin-only + a DEFINER count for the meter** — viable and would preserve no-email-match, but the founder chose full invite visibility (m4).

**Email match — ENFORCED on accept (Rev A / m4 — reverses the prior decision).** The accepting auth user's email **must** equal the invited email (lower-cased). This is the security substitute for admin-only invite visibility. Cost: the "invitee forwarded the invite to a different account" flow is no longer supported — acceptable for a work-email-enforced B2B product where the invitee signs in with the invited work email. Single-use is still guaranteed by `status='invited' AND user_id IS NULL`; expiry by `invited_at > now()-7d` (m1); idempotent for the same user. (**SEAT-ACCEPT-EMAIL-MATCH**, **SEAT-ACCEPT-DB-EXPIRY**, **SEAT-ACCEPT-DOUBLE-MEMBER-CHECK**.)

### 7.4 Revoke
Revoke is a normal admin **UPDATE** `status='revoked'` under the `business_members_update` policy (`user_can(...,'manage_members')`) — **no RPC required**. It frees the seat (excluded from active + pending counts) and retains the audit row. The primary-admin protection trigger blocks revoking the primary admin. Re-inviting a revoked email is allowed (the partial unique indexes exclude `status='revoked'`). (**SEAT-REVOKE-FREES-SEAT**.)

### 7.5 Deferred to 21B (named)
Resend email delivery of the invite; the `/invite/accept` route + accept UI; `/settings/team` and the seat meter; the connect/disconnect route `user_can` gate (§5.4); membership-aware business resolution in Server Actions (§1.4).

---

## 8. Erasure cascade (ADR 0010 Amendment 2 §D2.5)

`business_members` is business-scoped and holds **identity PII** (`email`, `user_id`). Its FK is `business_id → businesses ON DELETE CASCADE` and it holds **no Vault secrets**, so the existing `purge_business` root `DELETE FROM public.businesses` purges it automatically — **the `purge_business` function body needs no change.** No separate invite-state table exists (D-13 folds invites into the reserved row), so there is nothing else to register.

**§D2.5 cascade-table row to add** (insert after `post_generation_sessions`):

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| `business_members` | yes (business_id) | CASCADE | yes | none — cascade = erasure (holds `email` + `user_id` identity PII of members) |

**PII note for D2.6:** cascade-deleting `business_members` erases the **business's record of the membership relationship** (the member's email + the link). It does **not** delete the member's own `auth.users` identity — a member may belong to other tenants or own their own business. The existing D2.7 `auth.users` deletion (with its multi-business guard) governs only the **owner's** identity and is unaffected: `user_id → auth.users ON DELETE CASCADE` means an independent erasure of a member's own account also removes their memberships, which is correct.

**`purge_business` delta — explicit member erasure (Rev A / M3, per GDPR guidance).** Rather than rely on the cascade firing (which requires `purge_business` to end in a hard `DELETE FROM public.businesses` — a property the Builder must confirm), this ADR adds an **explicit** `DELETE FROM public.business_members WHERE business_id = p_business_id;` inside `purge_business`, before the root delete. It is functionally redundant with the `ON DELETE CASCADE` but removes any dependency on the root-delete assumption for erasing member PII — the conservative, GDPR-safe choice. (**RLS-PURGE-EXPLICIT-MEMBER-DELETE**, GDPR-leak check satisfied.)

---

## 9. Migration plan (real allocated timestamps; latest existing = `20260701210000`)

Ordered; each is idempotent-safe to re-run where noted.

| # | File | Contents |
|---|---|---|
| M1 | `20260702120000_business_members.sql` | `business_members` table + CHECK constraints + partial unique indexes + read/list indexes + `set_updated_at` trigger + `protect_primary_admin_membership` trigger + RLS (SELECT visible to all members — Rev A/m4; INSERT/UPDATE via `user_can('manage_members')`; no DELETE). |
| M2 | `20260702120100_get_user_business_ids_multimember.sql` | `CREATE OR REPLACE` the helper → `owner_id ∪ active members` (§3). Idempotent. |
| M3 | `20260702120200_user_can.sql` | `user_can(uuid,text)` DEFINER helper (§4) + REVOKE/GRANT. |
| M3.5 | `20260702120250_seat_cap_enforcement.sql` | **Rev A/M2** — `plan_max_seats(text)` IMMUTABLE helper + `enforce_seat_cap()` DEFINER + `BEFORE INSERT` trigger on `business_members` (§6.6). |
| M4 | `20260702120300_posts_role_aware_and_status_trigger.sql` | Drop+recreate `posts` INSERT/UPDATE/DELETE policies with `user_can` predicates (editor-floor on UPDATE) + `enforce_post_transition_capability` trigger — **gate on `→approved` only** (Rev A/m3, §5). |
| M5 | `20260702120400_campaigns_social_accounts_role_policies.sql` | Drop+recreate `campaigns` INSERT/UPDATE/DELETE with `user_can('author')`; `social_accounts` INSERT/UPDATE/DELETE with `user_can('connect_accounts')` (defense-in-depth). SELECT policies untouched. |
| M6 | `20260702120500_accept_invite_rpc.sql` | `accept_invite(uuid,uuid)` DEFINER RPC (§7.3) — **email-match + DB expiry + double-membership pre-check** (Rev A) + REVOKE/GRANT. |
| M7 | `20260702120600_backfill_owner_members.sql` | **Idempotent** primary-admin backfill (below), covering **all** existing businesses. |
| M8 | `20260702120700_purge_business_member_delete.sql` | **Rev A/M3** — `CREATE OR REPLACE public.purge_business` adding an explicit `DELETE FROM public.business_members WHERE business_id = p_business_id;` before the root delete (§8). |
| M9 | `20260702120800_ensure_owner_membership.sql` | **Rev B/MAJOR-1** — `ensure_owner_membership()` DEFINER + `AFTER INSERT` trigger on `businesses` (go-forward counterpart to M7's one-time backfill; idempotent via `business_members_uniq_user`). |

**M7 backfill (idempotent, all businesses):**

```sql
INSERT INTO public.business_members
  (business_id, user_id, email, role, is_admin, status, invited_at, accepted_at)
SELECT b.id, b.owner_id, lower(u.email), 'approver', true, 'active', b.created_at, b.created_at
FROM public.businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id, user_id) WHERE (user_id IS NOT NULL AND status IN ('invited','active'))
DO NOTHING;
```

Re-runnable: the partial unique index makes the owner row insert a no-op on retry. Runs **after** M1–M6 so the table, indexes, and helpers exist. (**ROLE-CREATOR-BACKFILL-IDEMPOTENT**.)

**M9 go-forward trigger (Rev B/MAJOR-1):**

```sql
CREATE OR REPLACE FUNCTION public.ensure_owner_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.business_members
      (business_id, user_id, email, role, is_admin, status, invited_at, accepted_at)
    SELECT NEW.id, NEW.owner_id, lower(u.email), 'approver', true, 'active', now(), now()
    FROM auth.users u WHERE u.id = NEW.owner_id
    ON CONFLICT (business_id, user_id) WHERE (user_id IS NOT NULL AND status IN ('invited','active'))
    DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ensure_owner_membership
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.ensure_owner_membership();
```

M7 and M9 together give full coverage: M7 is one-time DML for businesses that existed when it ran; M9 is a standing trigger for every business created since. Must be `SECURITY DEFINER` — at business-creation time the creator has no `business_members` row yet, so `business_members` RLS would otherwise reject the insert (the same chicken-and-egg problem M7 sidesteps via service-role).

> `purge_business`: **M8** adds the explicit `DELETE FROM business_members` (Rev A/M3); the `ON DELETE CASCADE` remains as backstop. ADR 0010 §D2.5 is also amended as documentation (M-doc).

---

## 10. Named constraints (Reviewer-greppable)

**RLS / enforcement locus**
- **RLS-READ-HELPER-ONLY** — read widening changes only `get_user_business_ids()`; **no existing RLS policy body is edited** for reads.
- **RLS-HELPER-NORECURSE** — `get_user_business_ids` is `SECURITY DEFINER` so reading `business_members` (RLS) does not recurse into its policies.
- **RLS-USERCAN-DEFINER** — `user_can` is `SECURITY DEFINER` + `SET search_path=public`; safe inside `business_members` policies; unknown capability → deny.
- **RLS-POST-APPROVE-DB** — **granting approval (`→approved`) only** is enforced in the DB (trigger), not just the app; an editor cannot grant approval via a raw anon write. Remove/skip/unapprove are `author` (editor+) by design (Rev A/m3).
- **RLS-MEMBERS-USINGCHECK / RLS-POSTS-USINGCHECK** — every new/edited write policy has both `USING` and `WITH CHECK`.
- **RLS-INVITED-VISIBLE-ALL** — pending (`invited`) rows are visible to all members (Rev A/m4); no possession secret lives on the row.
- **RLS-ACCEPT-DEFINER-ONLY** — `accept_invite` is the ONLY non-service write by a not-yet-member; DEFINER RPC with an atomic guard **plus email-match + DB expiry** (the escalation guard now that invited rows are visible).
- **RLS-PURGE-EXPLICIT-MEMBER-DELETE** — `purge_business` explicitly deletes `business_members` (Rev A/M3), independent of the cascade.
- **RLS-SOCIAL-APPLAYER** — `connect_accounts` is authoritatively enforced app-side (connect/disconnect run service-role); RLS predicate is defense-in-depth. Wiring = 21B.
- **RLS-NO-MIDDLEWARE-ROLE** — no membership/role resolution in `proxy.ts`.
- **RLS-NO-SERVICE-IN-USER-PATH** — no service-role client in any user-facing request path introduced by 21A.

**Role / primary admin**
- **ROLE-PRIMARY-ADMIN-PROTECT** — the `owner_id` member row cannot be demoted, revoked, or rebound (BEFORE UPDATE trigger); guarantees at least one un-removable admin.
- **ROLE-PRIMARY-ADMIN-ONLY-DESTRUCTIVE** — `delete_account` is primary-admin (`owner_id`)-only; **there is no `transfer_ownership`** (n1); neither is a `user_can` capability.
- **ROLE-CREATOR-NOREG** — backfilled creator (`approver`+`is_admin`) suffers zero capability regression.
- **ROLE-CREATOR-BACKFILL-IDEMPOTENT** — backfill covers all businesses and is re-runnable.

**Seats**
- **SEAT-COUNT-ACTIVE-PLUS-PENDING** — seat usage = active + pending (invited), owner included.
- **SEAT-MAXSEATS-NULL-UNLIMITED** — `maxSeats: null` ⇒ unlimited (pro/agency).
- **SEAT-CAP-DB** — the seat cap is enforced by the `enforce_seat_cap` `BEFORE INSERT` trigger (Rev A/M2), not app-layer only; an over-cap invite fails even on a raw anon INSERT.
- **SEAT-CAP-SSOT-SYNC** — a test asserts `plan_max_seats(p)` equals `getPlanCapabilities(p).maxSeats` for every `Plan`.
- **SEAT-REVOKE-FREES-SEAT** — invite reserves a seat; revoke (status='revoked') frees it.
- **SEAT-OVERAGE-LOCK** — Pro→Plus over-cap blocks new invites; DB-enforced by the same `enforce_seat_cap` trigger (`used ≥ max`); revoke and content ops remain allowed; billing wiring deferred to 21B.
- **SEAT-NO-STRIPE** — no Stripe / `lib/stripe/` change this session (only `plan.ts` capability constant `maxSeats`).
- **SEAT-ACCEPT-EMAIL-MATCH** — accept requires `lower(auth.email()) = lower(row.email)` (Rev A/m4); the escalation guard for visible-to-all invites.
- **SEAT-ACCEPT-DB-EXPIRY** — accept enforces `invited_at > now()-7d` in-DB (Rev A/m1), independent of the app-side token check.
- **SEAT-ACCEPT-DOUBLE-MEMBER-CHECK** — accept pre-checks existing active membership and raises a clean error instead of a raw unique-index violation (Rev A/m2).
- **SEAT-ATOMIC-GUARD-INTACT** — the existing conditional-UPDATE atomic guard on `posts` is preserved.
- **SEAT-EMAIL-LOWER / SEAT-STATUS-3** — email lower()-normalised (no citext); status enum is 3-valued (`removed` folded into `revoked`).

---

## 11. File manifest

**NEW — 21A**
- `supabase/migrations/20260702120000_business_members.sql`
- `supabase/migrations/20260702120100_get_user_business_ids_multimember.sql`
- `supabase/migrations/20260702120200_user_can.sql`
- `supabase/migrations/20260702120250_seat_cap_enforcement.sql` *(Rev A/M2 — `plan_max_seats` + `enforce_seat_cap` trigger)*
- `supabase/migrations/20260702120300_posts_role_aware_and_status_trigger.sql`
- `supabase/migrations/20260702120400_campaigns_social_accounts_role_policies.sql`
- `supabase/migrations/20260702120500_accept_invite_rpc.sql`
- `supabase/migrations/20260702120600_backfill_owner_members.sql`
- `supabase/migrations/20260702120700_purge_business_member_delete.sql` *(Rev A/M3 — explicit member erasure)*
- `lib/db/business-members.ts` — typed queries: `countSeatUsage`, `listMembers`, `createInvite`, `revokeMember`, `getMemberById` (RLS-scoped; `acceptInvite` wraps the RPC)
- `lib/members/seats.ts` — pure `evaluateSeatState` / `SeatState`
- `lib/members/enforcement.ts` — `checkInviteAllowed` / `upgradeCtaTargetFor` (mirrors `lib/campaigns/enforcement.ts`)
- `lib/members/capabilities.ts` — capability string constants (app-layer echo of §4)
- `lib/members/invite-token.ts` — `signInviteToken` / `verifyInviteToken` (mirrors `lib/social/oauth/state.ts`)

**CHANGED — 21A**
- `lib/stripe/plan.ts` — add `maxSeats` to `PlanCapabilities` + values (trial/plus 10, pro/agency null); **no other Stripe change**
- `lib/config.ts` — add `INVITE_TOKEN_SECRET` (server, ≥32 chars)
- `get_user_business_ids()` (via M2), `posts`/`campaigns`/`social_accounts` write policies (via M4/M5)
- `docs/decisions/0010-legal-surface.md` §D2.5 — add the `business_members` cascade row (§8); **`purge_business` gains an explicit member delete via M8** (Rev A/M3)

**DEFERRED — 21B** (contracts only here): Resend invite email; `/invite/accept` route + UI; `/settings/team` + seat meter; capability-gate retrofit across calendar/campaigns/accounts/billing; membership-aware business resolver replacing `getBusinessByOwner` in Server Actions; connect/disconnect route `user_can` gate; overage-lock billing/portal messaging.

**DEFERRED — 21C**: approver quick-approve tab wiring the existing (surface-less) approve queue (`approvePost` / `bulkApproveDraftPosts` already exist in `lib/db/posts.ts`; the pending-approvals read is role-gated to `approve`).

---

## 12. Consequences

- **Positive.** The ADR 0001 §A promise is fulfilled with a one-function read swap; the DB is the real permission boundary (survives raw anon writes) for **both** roles and the seat cap; the seat cap reuses the audited campaign-cap *shape* app-side but is DB-enforced by a trigger; GDPR erasure is satisfied by an explicit member delete plus cascade backstop; the primary admin is triple-protected.
- **Negative / watch-items.** (1) The read widening is a single high-blast-radius function — mandatory full RLS-READ-MATRIX coverage. (2) `connect_accounts` is the one app-layer-authoritative capability (service-role path) — must not be forgotten in 21B. (3) Server Actions still resolve the tenant via `getBusinessByOwner` and will 404 for members until the 21B resolver lands — 21A ships the backend spine; the member-facing app surface is intentionally incomplete until 21B.

## 13. Explicitly deferred (summary)
21B: invite email, accept route/UI, `/settings/team`, seat meter, capability-gate retrofit, membership-aware resolver, connect/disconnect `user_can` gate, overage-lock billing wiring. 21C: approver quick-approve tab. No `lib/stripe/` edits, no email templates, no routes in 21A.

---

ADR 0013 drafted. Awaiting review.
