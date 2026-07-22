# ADR 0014 — Seats & Permissions: Flow & Surface

- **Status:** Delivered — 21B (build → review → D1–D4 correction) and 21C (build → review → E1–E3
  correction) both merged; Session 21 closed 2026-07-12.
- **Date:** 2026-07-08
- **Supersedes / amends:** none. **Builds on** ADR 0013 Rev B (locked model). Carries a **single**
  RLS delta (`businesses_select_own`, §2.1 / L-1a) — the only policy-body change this ADR permits.
- **Phase split:** one ADR, two build sessions — **21B** (flow + surface) fully specified; **21C**
  (approver quick-approve inbox) specified at contract level. Every clause below is tagged **[21B]** or **[21C]**.
- **Scope boundary:** surface + flow + app-layer only. No new table. No Stripe schema change. No model
  or capability-matrix change. The permission **model** is locked in 0013 Rev B; this ADR designs the
  **surface** that makes it usable, and fixes one latent 21A parent/child RLS asymmetry (§2.1).

---

## §0 — Binding decisions (from `docs/build-guide/session-21bc.md`, adjudicated — encoded, not re-opened)

**Locked (L):**

- **L-1** 0014 is surface-only: no new table, no Stripe schema change; everything new is a route,
  component, resolver swap, email kind, app-layer `user_can` check, or i18n copy — **plus the single RLS
  delta in L-1a**.
- **L-1a (founder-adjudicated 2026-07-08)** The one permitted RLS body change is a **SELECT-only** widening
  of `businesses_select_own` to the `get_user_business_ids()` pattern its child tables already use
  (§2.1). SELECT `USING` only; INSERT/UPDATE/DELETE stay `owner_id`-scoped. Loser: service-role read in
  the user path.
- **L-2** The resolver **lands first**. Until it resolves `owner_id ∪ active membership`, every accepted
  member 404s. Gating deliverable of 21B.
- **L-3** UI capability gates **echo `user_can`** — UX, never the security boundary. The DB (anon key +
  RLS + triggers) is already the real boundary. Hiding a button is never the control.
- **L-4** The invitee signs in with the **invited work email** (0013 `accept_invite` email-match).
  Cross-account forwarding is intentionally unsupported; the accept UX is built around that.
- **L-5** Editing an approved post **reverts it to draft** (ADR 0012). The inbox "edit then approve" is
  **two explicit steps**, never a silent combined action.
- **L-6** All new strings via next-intl in **en/pt/es**; dates via `date-fns formatISO`; every list has
  `LIMIT` + `ORDER BY`; no `console.*`, no `any`; new surfaces inherit Session 20's a11y/WCAG-AA bar.
- **L-7** Architect produces only this ADR — no `.ts`, no `.sql`. Design skills OFF this phase.

**Ledger (M/B/C) — encoded verbatim in intent:**

| # | Decision (encoded) |
|---|---|
| M-1 | One ADR 0014: 21B fully specified + 21C contracts; build splits 21B→21C. |
| M-2 | New ADR 0014 (Flow & Surface), not a 0013 Rev C (additive UX ≠ model reversal). |
| B-1 | Resolver: prefer the **owned** business; else the single active membership. Seam for Phase-2 switching; **switcher not built** (§2.3). |
| B-2 | New-user accept: **sign-up first** with invited email pre-filled + **locked**, then accept; non-match blocks at accept, naming the invited address (§4). |
| B-3 | Role-change = inline confirm; remove = explicit dialog; removal is **soft** (`status='revoked'`) (§5). |
| B-4 | Meter "X of Y seats" (Y = "Unlimited" when `null`); `seat_cap_reached` → "Upgrade to Pro"; `overage_locked` → "Remove N−10 members or stay on Pro" → member-mgmt + portal (§5.4, §8). |
| B-5 | Invite resend/expiry: **re-issue** a fresh token on the same reserved row; expired row shows a "resend" affordance (§4.4). |
| B-6 | Retrofit affordance: **hide** by default; **disable-with-tooltip** only where absence confuses — chiefly the Approve button an editor sees but cannot use (§6). |
| C-1 | Inbox: single **+ batch** approve; edit-then-approve is **two explicit steps** (edit reverts to draft, L-5); reject/skip available (§9). |
| C-2 | New role-gated **"Approvals"** nav (approver + admin); **complements** calendar/campaign approve; reads the **same** pending-draft data path (§9.3). |
| C-3 | Empty = "No posts waiting for approval"; paginate/virtualize; filter by campaign + channel (§9.4). |

---

## §1 — Relationship to prior ADRs, and the model invariant

- **ADR 0013 Rev B — the locked model, no reversal.** This ADR consumes, and never redefines: the
  capability matrix (0013 §L-2), the `user_can(business_id, capability)` DEFINER oracle and its six
  capability strings (`author`, `reschedule`, `approve`, `connect_accounts`, `manage_members`,
  `manage_billing`, 0013 §4), the seat model (`plan_max_seats`, `enforce_seat_cap` BEFORE INSERT trigger,
  0013 §6.6), the invite/accept contract (HMAC token + `accept_invite(p_member_id, p_business_id)`
  email-match DEFINER RPC, 0013 §7.3), and the primary-admin protection trigger (0013 §2.2).
- **ADR 0012 — calendar surfaces being retrofitted.** The capability gate (§6) is applied to the existing
  `approvePostFromCalendarAction`, edit, and reschedule affordances. **The edit-reverts-to-draft rule**
  (`app/[locale]/(dashboard)/calendar/actions.ts:248-251`, `updatePostFromCalendarAction` calls
  `unapprovePost` before editing an approved post) is preserved and made **legible** in the 21C inbox (L-5, C-1).
- **ADR 0008 — the transactional-email outbox this extends.** The invite email is a new `EmailKind`
  enqueued through the existing `enqueueEmail()` path (`lib/email/enqueue.ts` → `insertEmailOutboxRow`
  under service-role → drained by the `drain-email-outbox` cron), with the ADR 0008 §17 structured
  enqueue log and `dedupe_token` idempotency. No new delivery mechanism.
- **Hard prerequisite:** the **21A-D / MAJOR-1** owner-membership trigger
  (`supabase/migrations/20260702120800_ensure_owner_membership.sql`, `ensure_owner_membership()`
  AFTER INSERT on `businesses`) **is merged**. Without it, a newly created business has no owner
  `business_members` row and the seat meter + resolver would undercount. Confirmed present. (**RES-OWNER-TRIGGER-PRESENT**.)
- **Model-change confirmation:** this ADR introduces **no** capability-matrix change, **no** trigger/RPC
  logic change, **no** new table. The **only** DB delta is the SELECT-only `businesses_select_own`
  widening in §2.1 (L-1a) — a correction of a 21A parent/child RLS asymmetry, not a model change.
  Everything else is a route, a component, a resolver swap, an email kind, an app-layer `user_can` echo,
  or i18n copy.

---

## §2 — [21B] Membership-aware resolver (RES-*)

### 2.1 The blocking asymmetry and its one-line fix (RES-BIZ-SELECT-WIDEN)

**Grounded finding.** 0013 M2 widened `get_user_business_ids()` to `owner_id ∪ active members`, and 0013
M4/M5 widened the SELECT policies of every **child** business-scoped table to
`business_id = ANY (SELECT unnest(public.get_user_business_ids()))`. But the **parent** table's own SELECT
policy was never touched: `supabase/migrations/20260430120003_businesses.sql:41-45` still reads
`USING (owner_id = auth.uid() AND deleted_at IS NULL)`, and 0013 §3's read-blast-radius list omits
`businesses`. A non-owner member's authenticated client therefore returns **zero rows** from
`businesses`, even though `get_user_business_ids()` includes that id — so no app-layer resolver can read
the business row. This is a latent 21A bug independent of 0014.

**Fix (the sole RLS delta 0014 permits, per L-1a).** Recreate `businesses_select_own` with the same
pattern its children use:

```sql
-- 0014 migration (Builder, 21B): SELECT-only widening. USING only; no WITH CHECK.
-- businesses INSERT/UPDATE/DELETE policies are UNCHANGED (stay owner_id-scoped).
DROP POLICY IF EXISTS businesses_select_own ON public.businesses;
CREATE POLICY businesses_select_own ON public.businesses
  FOR SELECT
  TO authenticated
  USING (
    id = ANY (SELECT unnest(public.get_user_business_ids()))
    AND deleted_at IS NULL
  );
```

Members gain read of `name`, `plan`, `language`, `onboarding_completed`, etc. — exactly what the
dashboard shell needs. Write scoping is unchanged: only the primary admin (`owner_id`) updates the
business row; plan changes remain the service-role Stripe path. (**RES-BIZ-SELECT-WIDEN**.)

### 2.2 New resolver signature (replaces `getBusinessByOwner` as the app resolver)

`lib/db/businesses.ts` keeps `getBusinessByOwner` (still used by owner-only service paths that legitimately
key on ownership — e.g. Stripe reconciliation), and **adds** the membership-aware resolver that dashboard
call sites migrate to:

```typescript
// lib/db/businesses.ts — NEW. Authenticated-client read; RLS (now widened, §2.1) scopes
// the visible set to owner_id ∪ active memberships. Deterministic pick per §0 B-1.
export async function getBusinessForUser(
  client: SupabaseClient,
  userId: string,
  preferredBusinessId?: string,   // Phase-2 switcher seam (§2.3); ignored if not resolvable
): Promise<BusinessRow | null>
// Body contract:
//   SELECT * FROM businesses WHERE deleted_at IS NULL         (RLS = owner ∪ active member)
//   ORDER BY created_at ASC, id ASC                           (deterministic; L-6)
//   → pick preferredBusinessId if present AND in the set;
//     else the OWNED row (owner_id === userId) if present;    (B-1: owned wins)
//     else the first row (sole/earliest active membership);
//     else null.
```

**Why not enumerate memberships separately:** the widened RLS already returns exactly the user's
businesses; a second membership query would duplicate `get_user_business_ids()` in app code. One scoped
`SELECT` is sufficient and cannot leak (RLS-enforced). (**RES-RESOLVER-DETERMINISTIC**,
**RES-RESOLVER-OWNED-WINS**.)

### 2.3 Multi-business seam — designed, not built (B-1)

The `preferredBusinessId` parameter is the switcher seam. At launch a user has at most one owned business
plus, rarely, one accepted membership; the deterministic default (owned > earliest membership) is
unambiguous, so **no persistence is shipped in 0014**. Phase-2 persistence lands as a per-user preference
(`last_active_business_id`) in a future user-preferences store — **not created here** (L-1 forbids new
tables; auth-metadata writes need service-role, out of scope). Architect-decided: seam = parameter now,
store = Phase 2. **Named loser:** add a `last_active_business_id` column in 0014 — rejected (schema creep
for a switcher that does not exist yet; violates L-1's spirit). (**RES-SEAM-PARAM-ONLY**.)

### 2.4 Caller migration — every dashboard resolver call site

`getBusinessByOwner` has **one definition + one owner-only service caller to keep**, and the following
**production dashboard call sites must migrate to `getBusinessForUser`** (each currently 404s a member).
Grounded from a full-repo grep; test files excluded (they update alongside):

| File | Note |
|---|---|
| `app/[locale]/(dashboard)/layout.tsx` | Dashboard shell — the top-level 404 source (`getBusinessByOwner(client, user.id)` → redirect `/signup`). |
| `app/[locale]/(dashboard)/campaigns/page.tsx` | |
| `app/[locale]/(dashboard)/campaigns/actions.ts` | inline `getContext()` helper. |
| `app/[locale]/(dashboard)/campaigns/new/page.tsx` | |
| `app/[locale]/(dashboard)/campaigns/new/actions.ts` | |
| `app/[locale]/(dashboard)/campaigns/[id]/page.tsx` | |
| `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts` | |
| `app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx` | |
| `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts` | inline `getContext()` (lines 46-53). |
| `app/[locale]/(dashboard)/calendar/page.tsx` | |
| `app/[locale]/(dashboard)/calendar/actions.ts` | inline `getContext()`. |
| `app/[locale]/(dashboard)/onboarding/page.tsx` | |
| `app/[locale]/(dashboard)/onboarding/actions.ts` | |
| `app/[locale]/(dashboard)/onboarding/step-1/actions.ts` | |
| `app/[locale]/(dashboard)/onboarding/step-2/actions.ts` | |
| `app/[locale]/(dashboard)/onboarding/step-3/page.tsx` | |
| `app/[locale]/(dashboard)/onboarding/step-4/actions.ts` | |
| `app/[locale]/(dashboard)/onboarding/infer-brand-voice/actions.ts` | |
| `app/[locale]/(dashboard)/settings/voice/page.tsx` | |
| `app/[locale]/(dashboard)/settings/voice/actions.ts` | |
| `app/[locale]/(dashboard)/settings/voice/refine-from-posts-action.ts` | |
| `app/[locale]/(dashboard)/settings/accounts/page.tsx` | |
| `app/[locale]/(dashboard)/billing/page.tsx` | |
| `app/[locale]/(dashboard)/billing/actions.ts` | |
| `app/api/social/[platform]/connect/route.ts` | also gains the §7 `connect_accounts` gate. |
| `app/api/social/[platform]/disconnect/route.ts` | also gains the §7 gate. |
| `app/api/social/accounts/route.ts` | |
| `app/api/billing/session-status/route.ts` | |

**`app/[locale]/(auth)/login/actions.ts` — MUST migrate (decided, not punted).** The current post-login
resolve is `getBusinessByOwner(client, userId)` (`login/actions.ts:74`); for a pure member (accepted an
invite, owns no business) it returns `null`, falls into the `!business` branch (`:80`), and redirects to
`/onboarding` on **every** login — a **member lockout**. Login migrates to `getBusinessForUser`. But the
resolver swap alone is insufficient: the `!onboarding_completed` branch is **also** owner-semantics —
onboarding is the owner's business-setup wizard and a member must never be routed through it. The post-login
redirect therefore becomes **ownership-scoped**:

```
business = getBusinessForUser(client, userId)
if redirectTo is a safe target        → redirect(redirectTo)                 // unchanged
else if !business                     → redirect(`/${locale}/onboarding`)    // truly no business & no membership (fresh owner mid-signup)
else if business.owner_id === userId
        && !business.onboarding_completed
                                      → redirect(`/${locale}/onboarding`)    // owner must finish their own wizard
else                                  → redirect(`/${locale}/campaigns`)     // owner done, OR a member (onboarding is not the member's flow)
```

**The dashboard layout guard shares the fix.** `app/[locale]/(dashboard)/layout.tsx:47-53` redirects to
`/onboarding` on `!business.onboarding_completed` for *everyone*; once migrated to `getBusinessForUser`
that same branch must be **owner-scoped** (`business.owner_id === userId && !onboarding_completed`), so a
member of a business whose owner hasn't finished onboarding is not bounced into the owner's wizard. Normal
case (owner already onboarded → `onboarding_completed = true`) is unaffected; this closes the residual
edge where an invite predates the owner's onboarding completion. (**RES-LOGIN-MEMBER-NO-LOCKOUT**,
**RES-ONBOARDING-OWNER-SCOPED**.)

**Kept on `getBusinessByOwner` (owner-semantics genuinely correct):** service-role owner lookups
(`findBusinessByStripeCustomerId`, `updateBusinessPlan`, `completeOnboarding`, etc.) — these key on
ownership by design and are unaffected. (**RES-CALLER-MIGRATION**.)

**Not in scope for the resolver:** `proxy.ts`. Confirmed — the middleware does auth-session refresh and
route-gating only (`updateSession`, `PUBLIC_SEGMENTS`); it never resolves a business and must not (no DB
round-trip in middleware). Business resolution stays in the layout/actions. (**RES-NO-MIDDLEWARE**.)

---

## §3 — [21B] Invite email (INV-*)

A new outbox kind carrying the signed accept link. It extends ADR 0008, changing nothing about delivery.

**Registration (four edits, all app-layer):**
1. Add `'team-invite'` to the `EmailKind` union — `lib/email/types.ts`.
2. New template `lib/email/templates/team-invite.tsx` exporting `TeamInvitePropsSchema` (Zod),
   `teamInviteSubject(t, props)`, `TeamInviteEmail` — same shape as the five existing templates.
3. Register the `KindEntry` in `TEMPLATES` — `lib/email/templates/index.ts`.
4. New trigger `enqueueTeamInvite(...)` (a `lib/email/triggers/` module) called by the invite Server
   Action (§5), invoking `enqueueEmail`.

```typescript
// enqueueEmail input for the invite (existing enqueue path — lib/email/enqueue.ts)
{
  business_id: string,
  kind: 'team-invite',
  recipient: string,              // the invited work email (lower-cased by enqueueEmail)
  locale: EmailLocale,            // the inviting business's language
  props: {
    inviterName: string,
    businessName: string,
    roleLabelKey: string,         // i18n key for approver|editor|viewer (never a raw string)
    acceptUrl: string,            // `${APP_URL}/${locale}/invite/accept?token=${signedToken}`
  },
  dedupe_token: `invite:${memberId}:${issuedAtEpoch}`,  // distinct per re-issue → resend sends (B-5)
}
```

**Constraints:** 3-locale subject + body (`i18n/{en,pt,es}/invite.json`, L-6). **No token or email in
logs** — the ADR 0008 §17 enqueue log already emits only `{kind, email_kind, business_id, locale,
outcome}`; the `acceptUrl`/token live only in `props` (never logged) and the `recipient` is not logged.
The signed token is produced by the existing `signInviteToken({memberId, businessId})` (HS256, 7-day
expiry, `lib/members/invite-token.ts`). (**INV-EMAIL-KIND**, **INV-NO-TOKEN-IN-LOGS**, **INV-3-LOCALE**.)

---

## §4 — [21B] `/invite/accept?token=` route (INV-*)

Public route (added to `proxy.ts` `PUBLIC_SEGMENTS` as `invite`) — an invitee may arrive unauthenticated.

### 4.1 Token verification (app-side, per 0013 §7.3 rationale)
`verifyInviteToken(token)` → `{ memberId, businessId }` (validates HS256 sig + 7-day `exp`). The secret
stays app-side (never in Postgres) — the deliberate deviation from an in-DB `p_token`, decided in
0013 §7.3. On **any** verification failure (bad sig, expired, malformed) → the generic invalid state
(§4.3). (**INV-TOKEN-VERIFY-APPSIDE**.)

### 4.2 Accept state machine

```
arrive /invite/accept?token=T
  │
  ├─ verifyInviteToken(T) fails ───────────────────────────────► [INVALID]  (generic copy, §4.3)
  │
  ├─ verified {memberId, businessId}
  │     │
  │     ├─ NOT authenticated ──► [SIGNUP-GATE]
  │     │      sign-up form, email PRE-FILLED + LOCKED to the invited address (B-2, L-4),
  │     │      token preserved across the flow (query or signed cookie).
  │     │      After email-confirm + session established → re-enter accept.
  │     │
  │     └─ authenticated as U
  │            │  call accept_invite(memberId, businessId)  [DEFINER RPC, 0013 §7.3]
  │            │
  │            ├─ success (row bound active) ─────────────────► [ACCEPTED] → land in business
  │            │        redirect `/${locale}/campaigns`; resolver (§2) now returns it.
  │            ├─ RPC 'already an active member' (23505 pre-check) ─► [ALREADY-MEMBER]
  │            │        friendly "You're already on this team" → land in business.
  │            └─ RPC 'invite not available (…)' (email-mismatch / expired / claimed / unknown)
  │                     └────────────────────────────────────► [INVALID]  (generic copy, §4.3)
```

### 4.3 Anti-enumeration copy (mirrors Session 18B)
Email-mismatch, expired, already-consumed, revoked, and unknown-id **all collapse to one generic state** —
the `accept_invite` RPC is intentionally ambiguous on `NOT FOUND` (0013 §7.3 comment). Copy
(`invite.accept.invalid`, 3 locales): **"This invitation is no longer valid."** with a single neutral
action → "Go to sign in". No hint of which condition failed, no confirmation the address exists —
mirroring the login/forgot-password indistinguishability posture of 18B. Architect-decided exact string
(§0 silent). (**INV-ACCEPT-ANTI-ENUM**, **INV-ACCEPT-EMAIL-MATCH**, **INV-ACCEPT-EXPIRY**.)

### 4.4 Re-issue / resend (B-5)
Resend (triggered from `/settings/team`, §5) **re-issues a fresh token on the same reserved row** (new
`exp`, new `dedupe_token`) and re-enqueues `team-invite`. No new `business_members` row (would double-count
the seat and trip the `(business_id, lower(email))` partial unique index). An expired-but-still-`invited`
row surfaces a "Resend invite" affordance in the member list. (**INV-REISSUE-SAME-ROW**.)

### 4.5 New-user sign-up binding (B-2)
The `[SIGNUP-GATE]` reuses the existing `(auth)/signup` surface with the email field **pre-filled from the
verified token's row email and locked** (read-only). Non-matching sign-up is impossible at the field
level; the ultimate guard remains the RPC's email-match. On abandon, no membership is created (the row is
already reserved as `invited` from the original invite — no orphan is minted by the accept flow). Loser
(0013-decided, restated): accept-then-signup (orphaned membership) and any-email-then-rebind (defeats the
hijack guard). (**INV-SIGNUP-EMAIL-LOCKED**.)

---

## §5 — [21B] `/settings/team` (UI-*, SEAT-*)

Route: `app/[locale]/(dashboard)/settings/team/`. Admin-gated: server-side `user_can(businessId,
'manage_members')` check on load — a non-admin is redirected (not shown a disabled page; per B-6 the whole
surface is admin-only, so hide). (**ROLE-TEAM-ADMIN-GATED**.)

### 5.1 Data map (all through `lib/db/` + `lib/members/`)
- Member list: `listMembers(client, businessId, limit)` (`lib/db/business-members.ts`; already
  `ORDER BY created_at ASC`, `limit` default 50 — L-6 satisfied).
- Seat meter: `checkInviteAllowed(client, business)` (`lib/members/enforcement.ts`) → `{ allowed, reason?,
  seats }` where `seats = evaluateSeatState({ plan, activeCount, pendingCount })` over
  `countSeatUsage(...)`. Meter reads `seats.used` / `seats.max`.

### 5.2 Component contract (not implementation)
```
TeamSettingsPage (Server Component)
  ├─ server guard: user_can('manage_members') else redirect
  ├─ SeatMeter          (used / max; states below; §5.4)
  ├─ InviteMemberForm   (email + role<approver|editor|viewer> + is_admin?; Server Action §5.3)
  └─ MemberList
       └─ MemberRow (email, role badge, status badge[active|invited|revoked], is_admin badge)
            ├─ RoleSelect         → changeMemberRoleAction  (inline confirm — B-3)
            ├─ Resend (invited & expired only)  → resendInviteAction (§4.4)
            └─ Remove / Revoke    → revoke dialog (explicit confirm — B-3) → revokeMemberAction
```

### 5.3 Server Actions (new; Zod-validated; capability-echoed, DB-enforced)
```typescript
inviteMemberAction(input: { email: string; role: MemberRole; isAdmin?: boolean }): Promise<ActionState>
//   Zod-validate; work-email rule reused from signup validation (block free providers, per trial policy).
//   Fail-fast echo: checkInviteAllowed(...) → if !allowed, return typed reason (§5.4) WITHOUT inserting.
//   Else createInvite(...) [DB enforce_seat_cap trigger is the real boundary, 0013 §6.6]
//     → signInviteToken → enqueueTeamInvite (§3).
changeMemberRoleAction(memberId, role, isAdmin): Promise<ActionState>
//   UPDATE via business_members_update (user_can('manage_members')); primary-admin trigger blocks demoting owner.
revokeMemberAction(memberId): Promise<ActionState>          // revokeMember(...) → status='revoked' (B-3 soft)
resendInviteAction(memberId): Promise<ActionState>          // §4.4 re-issue
```
Removal is **soft** (`status='revoked'`, `revokeMember` already does this) — never a DELETE (fights 0013's
no-DELETE RLS + loses audit). (**UI-REMOVE-SOFT**, **UI-ROLE-CONFIRM**, **SEAT-INVITE-FAILFAST-ECHO**.)

### 5.4 Seat-meter states + copy (B-4; i18n `team.json`, 3 locales)
| State | Condition (`SeatState`) | Copy | CTA |
|---|---|---|---|
| Normal | `!atCap && overage===0`, `max!==null` | "{used} of {max} seats" | Invite enabled |
| Unlimited | `max===null` (Pro/agency) | "{used} of Unlimited seats" | Invite enabled |
| At cap | `atCap` (reason `seat_cap_reached`) | "{used} of {max} seats — team is full." | **"Upgrade to Pro for unlimited seats"** → `/billing` (`upgradeCtaTargetFor`) |
| Overage-locked | `overage>0` (reason `overage_locked`) | "{used} of {max} seats — {overage} over your plan limit." | **"Remove {overage} member(s) or stay on Pro"** → member list + `/billing` (§8) |

The overage CTA is deliberately **not** "upgrade" (they are mid-downgrade Pro→Plus; upgrading is not the
fix — B-4). (**SEAT-METER-COPY**, **SEAT-OVERAGE-CTA-DISTINCT**.)

---

## §6 — [21B] Capability-gate retrofit — the affordance map (UI-*)

**This ECHOES `user_can`; it is UX, not the security boundary (L-3).** The DB triggers/policies already
deny — this only stops a user from being invited to click a control that will fail. App-layer reads use
the `CAPABILITIES` constants (`lib/members/capabilities.ts`) resolved against the current member's
`(role, is_admin)`; a `useCan(capability)` client helper + a server `canServer(...)` echo derive from the
member row already resolved by the layout (§2). The rule (B-6): **hide by default; disable-with-tooltip
only where the control's absence would confuse** — chiefly the Approve control an editor can see on shared
surfaces.

| Surface / control | viewer | editor | approver | +admin | Mode when denied |
|---|---|---|---|---|---|
| Calendar/campaign **Approve** (`approvePost*`) | hide | **disable + tooltip** "Only approvers can approve" | show | (role decides) | **disable-w-tooltip** for editor (B-6); hide for viewer |
| Post **edit content** (`updatePostContent*`) | hide | show | show | — | hide |
| Post **reschedule** (`reschedule*`) | hide | show | show | — | hide |
| **Unapprove / skip / remove** (`author`) | hide | show | show | — | hide |
| Campaign **create/edit** (`author`) | hide | show | show | — | hide |
| **Connect / disconnect account** (`connect_accounts`) | hide | hide | show | show | hide (authoritative gate = §7) |
| **Billing / portal** (`manage_billing`) | hide | hide | hide | show | hide |
| **/settings/team** (`manage_members`) | hide | hide | hide | show | hide (whole route, §5) |

Editor sees a disabled Approve so the human-in-the-loop gate is legible; everything else a role cannot do
is hidden to keep a viewer's read-only view clean. (**UI-AFFORDANCE-MAP**, **UI-APPROVE-DISABLED-EDITOR**.)

---

## §7 — [21B] connect/disconnect authoritative gate (ROLE-*)

**Grounded (0013 §5.4):** the real connect path writes `social_accounts` via **service-role** (Vault
token-id write in `.../callback/route.ts`), and disconnect runs service-role (`deactivateSocialAccount`).
Service-role **bypasses RLS**, so the `connect_accounts` RLS predicate is defense-in-depth only — the
**authoritative** check must be an **app-layer `user_can` call in the route handlers** (RLS-SOCIAL-APPLAYER,
deferred from 21A). This is the documented, precedented app-layer-authoritative exception (0013 §5.4, L-10).

**Where:** after resolving the business (now via `getBusinessForUser`, §2) and before the service path, in:
- `app/api/social/[platform]/connect/route.ts` (GET) — call the `user_can` RPC under the **authenticated**
  client: `client.rpc('user_can', { p_business_id: business.id, p_capability: 'connect_accounts' })`.
  On `false` → `NextResponse.redirect('/${locale}/settings/accounts?error=forbidden')` (mirrors the
  existing `?error=connect_failed` shape).
- `app/api/social/[platform]/disconnect/route.ts` (DELETE) — same RPC gate; on `false` →
  `new NextResponse(null, { status: 403 })` (JSON route; matches its existing 401/404 shape).

The RPC runs under the caller's authenticated client so `auth.uid()` is correct; `user_can` is
`EXECUTE`-granted to `authenticated` (0013 §4). (**ROLE-CONNECT-APPLAYER-GATE**, **ROLE-DISCONNECT-APPLAYER-GATE**.)

---

## §8 — [21B] Overage-lock UX (SEAT-*)

**No Stripe schema change — messaging + gating only.** When `evaluateSeatState` reports `overage > 0`
(a Pro→Plus downgrade left the team over the Plus cap of 10):
- `/settings/team` shows the **overage-locked** meter state (§5.4) and **blocks new invites**
  (`checkInviteAllowed` returns `allowed:false, reason:'overage_locked'`; the DB `enforce_seat_cap`
  trigger is the hard boundary, 0013 §6.6). Revoke/remove and all content ops stay allowed (so the admin
  can clear the lock by removing members).
- `/billing` surfaces the same state near the existing `openBillingPortalAction` flow
  (`app/[locale]/(dashboard)/billing/actions.ts`): copy explains "You have {overage} member(s) over the
  Plus limit. Remove members on your Team page, or stay on Pro." with links to `/settings/team` and the
  Stripe portal. Clearing the lock is a member-count action, not a billing action (B-4). (**SEAT-OVERAGE-LOCK-UX**.)

---

## §9 — [21C] Approver quick-approve inbox (APV-*) — contracts only

Role-gated surface wiring the **existing** approve path. Builds after 21B merges (depends on the resolver
§2 and the gate echo §6). `enforce_post_transition_capability` already gates `→approved` (0013 §5.1) — the
inbox adds **no** new authorization; it is a faster lane to the same action.

### 9.1 Route + gate
`app/[locale]/(dashboard)/approvals/`. Server guard: visible to `approve`-capable members (**approver**)
**and admins** (C-2). A non-approver non-admin is redirected. (**ROLE-APPROVALS-GATED**.)

### 9.2 Data path (same as calendar/campaign — no dedupe drift, C-2)
Reads pending drafts via the existing posts query layer (`lib/db/posts.ts`), filtered `status='draft'`,
scoped to the resolved business, `LIMIT` + explicit `ORDER BY` (paginate/virtualize — C-3, L-6). **No new
query surface** that could diverge from the calendar's notion of "pending".

### 9.3 Affordances (C-1)
```
ApprovalsInbox
  ├─ Filters: by campaign, by channel/platform (C-3)
  ├─ Bulk bar: [Approve selected]  → bulkApprovePostsAction (exists) / per-id approvePostAction (exists)
  └─ DraftRow (post preview, platform badge, campaign)
       ├─ Approve            → approvePostAction(postId)            [single]
       ├─ Edit → (reverts approved→draft per L-5; here rows are already draft, so edit stays draft)
       │         edit is a SEPARATE step; after editing, the row remains and must be Approved explicitly
       ├─ Reject / Skip      → skipPostAction (exists)
       └─ (unapprove not needed — inbox shows drafts)
```
Edit-then-approve is **two explicit steps** — the inbox never silently approves an edited post (C-1, L-5).
Single **and** batch approve both wire the **existing** Server Actions (`approvePostAction`,
`bulkApprovePostsAction`, `skipPostAction` in `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts`).
(**APV-SINGLE-AND-BATCH**, **APV-EDIT-REVERT-LEGIBLE**, **APV-REJECT-SKIP**.)

### 9.4 States (C-3)
Empty = **"No posts waiting for approval."** (positive, not an error). At-scale → paginate/virtualize.
Filter by campaign + channel. (**APV-EMPTY-STATE**, **APV-FILTER**, **APV-PAGINATED**.)

### 9.5 Nav placement (C-2)
New **"Approvals"** entry in the dashboard nav (`components/layout/DashboardShell.tsx`), visible only to
approver+admin. **Complements** — does not replace — the in-context calendar/campaign approve affordances.
Architect-decided label "Approvals" (§0 silent on exact label; C-2 names the concept). (**APV-NAV-COMPLEMENTS**.)

---

## §10 — Named constraints → executed tests

"Covered" = **executed green**, never "authored". Anything touching RLS/RPC/policy runs against the CI
Supabase stack (the `supabase/__tests__/*` integration suites, gated on a live instance). App-layer/UI
logic runs under Vitest (`lib/**`, action unit tests).

| Constraint | Assertion | Test home (executed) |
|---|---|---|
| **RES-BIZ-SELECT-WIDEN** | Non-owner active member SELECTs their `businesses` row; revoked member cannot; non-member cannot | `supabase/__tests__/` (new: businesses-select-membership) — CI Supabase |
| **RES-RESOLVER-DETERMINISTIC / -OWNED-WINS** | owner+member → owned; member-only → that business; none → null | `lib/db/businesses.test.ts` |
| **RES-SEAM-PARAM-ONLY** | `preferredBusinessId` honored iff in visible set; else default | `lib/db/businesses.test.ts` |
| **RES-CALLER-MIGRATION** | No production dashboard path calls `getBusinessByOwner` (grep guard) except the kept service-role owner paths | lint/grep test in `lib/db` or a repo-guard test |
| **RES-LOGIN-MEMBER-NO-LOCKOUT** | A member (owns no business) logging in lands in `/campaigns`, never `/onboarding` | `app/[locale]/(auth)/login/actions.test.ts` |
| **RES-ONBOARDING-OWNER-SCOPED** | Onboarding redirect fires only for the owner of a not-onboarded business; a member bypasses it | `login/actions.test.ts` + `app/[locale]/(dashboard)/layout.test.tsx` |
| **RES-OWNER-TRIGGER-PRESENT** | New business auto-provisions owner member row | `supabase/__tests__/ensure-owner-membership.test.ts` (exists) |
| **RES-NO-MIDDLEWARE** | `proxy.ts` performs no business resolution | proxy unit test / review assertion |
| **INV-EMAIL-KIND / -3-LOCALE** | `team-invite` renders in en/pt/es; registered in `TEMPLATES` | `lib/email/templates/__tests__/` |
| **INV-NO-TOKEN-IN-LOGS** | enqueue log omits token + recipient PII | `lib/email/__tests__/enqueue.test.ts` |
| **INV-TOKEN-VERIFY-APPSIDE** | verify sig+expiry; bad/expired → invalid | `lib/members/invite-token.test.ts` (exists) + route test |
| **INV-ACCEPT-EMAIL-MATCH / -EXPIRY / -ANTI-ENUM** | mismatch/expired/claimed/unknown → one generic message | `supabase/__tests__/accept-invite-rpc.test.ts` (exists) + route test |
| **INV-SIGNUP-EMAIL-LOCKED** | signup gate locks email to invited address | accept-route component test |
| **INV-REISSUE-SAME-ROW** | resend updates same row, no new seat, no index trip | `lib/db/business-members.test.ts` + CI Supabase |
| **UI-AFFORDANCE-MAP / -APPROVE-DISABLED-EDITOR** | per-role hide/disable matches the §6 table | component tests |
| **UI-REMOVE-SOFT / -ROLE-CONFIRM** | remove → `revoked`; confirmations fire | action + component tests |
| **SEAT-METER-COPY / -OVERAGE-CTA-DISTINCT** | 4 states + distinct CTAs | `lib/members/seats.test.ts` (exists) + component test |
| **SEAT-INVITE-FAILFAST-ECHO** | over-cap invite blocked in-action AND by DB trigger | action test + `supabase/__tests__/seat-cap-enforcement.test.ts` (exists) |
| **SEAT-OVERAGE-LOCK-UX** | overage blocks invites; revoke/content allowed | `lib/members/enforcement.test.ts` (exists) + CI Supabase |
| **ROLE-CONNECT-APPLAYER-GATE / -DISCONNECT-APPLAYER-GATE** | non-`connect_accounts` member blocked in route (redirect / 403) | `app/api/social/[platform]/{connect,disconnect}` route tests |
| **ROLE-TEAM-ADMIN-GATED / ROLE-APPROVALS-GATED** | route guards redirect the uncapable | route/page tests |
| **APV-SINGLE-AND-BATCH / -EDIT-REVERT-LEGIBLE / -REJECT-SKIP** | wired to existing actions; edit is a separate step | `campaigns/[id]/posts/actions` tests + `supabase/__tests__/posts-approval-boundary.test.ts` (exists) |
| **APV-EMPTY-STATE / -FILTER / -PAGINATED** | empty copy; filters; bounded query | inbox component + `lib/db/posts` tests |

---

## §11 — File manifest (design-level; NEW / CHANGED; phase-tagged)

**NEW — 21B**
- `lib/email/templates/team-invite.tsx`; `lib/email/triggers/invite.ts` (`enqueueTeamInvite`).
- `app/[locale]/invite/accept/page.tsx` (+ accept client component); signup email-lock wiring.
- `app/[locale]/(dashboard)/settings/team/page.tsx` + `actions.ts` + components
  (`SeatMeter`, `InviteMemberForm`, `MemberList`, `MemberRow`).
- `components/ui/tooltip.tsx` — new shadcn primitive backing the B7 disabled-affordance tooltips.
- `i18n/{en,pt,es}/team.json`, `i18n/{en,pt,es}/invite.json`.
- app-layer capability helpers (`useCan` client + `canServer` server echo) alongside `lib/members/capabilities.ts`.
- `lib/members/invite-preview.ts` — invite-preview helper consumed by the accept/signup flow.

**CHANGED — 21B**
- `lib/db/businesses.ts` — add `getBusinessForUser` export (§2.2).
- `lib/db/types.ts` — types supporting the §2/§6 retrofit (member/business shapes for the resolver + capability echoes).
- `lib/email/types.ts` (`EmailKind` += `'team-invite'`); `lib/email/templates/index.ts` (`TEMPLATES`).
- All §2.4 dashboard resolver call sites (layout, campaigns, calendar, onboarding, settings, billing, social/billing routes) — layout's onboarding redirect becomes owner-scoped (§2.4).
- `app/[locale]/(auth)/login/actions.ts` — migrate to `getBusinessForUser` + ownership-scoped post-login redirect (§2.4, closes the member lockout).
- `app/api/social/[platform]/connect/route.ts`, `.../disconnect/route.ts` (§7 gate).
- `proxy.ts` (`PUBLIC_SEGMENTS` += `invite`).
- `components/layout/DashboardShell.tsx` (capability-aware nav; §6/§9.5) — nav item ships gated in 21B, Approvals link lands with §9.
- `app/[locale]/(dashboard)/billing/*` (§8 overage messaging).
- `components/campaigns/CampaignCard.tsx`, `components/social/PlatformConnectionCard.tsx` — §6 capability-echo retrofit (affordance hide/disable per the role matrix).
- `lib/contexts/business-context.tsx` — carries the resolved `member` context (role/isAdmin) consumed by `useCan` and the nav gate.
- `lib/members/useCan.ts` — client-side capability-echo hook (§6), paired with `canServer`.

**RLS delta (§2.1) — delivered in 21A, not 21B**
- The `businesses` SELECT-only widening described in §2.1 shipped in **21A** (`ef6b3bf8`), as an in-place
  edit of `supabase/migrations/20260430120017_fix_rls_function_caching.sql` — there is no separate
  `..._businesses_select_membership.sql` migration file. 21B correctly re-ships no RLS/migration change;
  a prior draft of this manifest listed a NEW-21B migration under this name, which does not exist and
  should not be searched for.

**NEW — 21C**
- `app/[locale]/(dashboard)/approvals/page.tsx` + inbox components (filters, bulk bar, draft rows).
- `i18n/{en,pt,es}/approvals.json`.

**CHANGED — 21C**
- `components/layout/DashboardShell.tsx` (activate Approvals nav link).
- Reuse (no change) `campaigns/[id]/posts/actions.ts` approve/skip/bulk actions.

**Approvals nav (§9.5) — clarification of M1**
- The nav entry was implemented as a **live**, capability-gated `<Link>` from 21B onward — not an inert
  `<span>` like `COMING_SOON_NAV`. The 21B reviewer's M1 finding (a live link pointing at a route that
  didn't exist yet in the isolated 21B diff) was accurate against that diff.
- M1 never manifested in production because 21B and 21C landed in the **same merge** (`9acc0133`) —
  `/approvals` already existed by the time the live link shipped. The safety came from merge sequencing,
  not from an inert-until-21C design; there was no inert-then-activated state at any point.
- ~~Follow-up (code, not this pass): `components/layout/DashboardShell.tsx:47-48` still carries a stale
  comment claiming the entry is "gated and inert here, matching `COMING_SOON_NAV`'s rendering" — that
  should be corrected to match the actual (always-live) implementation.~~ **Resolved (21C/E2, n1):** the
  export-area comment now describes the live-link reality; no behavior change.

**§11 reconciliation status — CLOSED (21C/E3).** With the n1 comment fix landed, this manifest now
matches the delivered 21B + 21C reality end to end: every file the diffs actually touched is listed
(D4), the RLS-delta note correctly points to its 21A origin (D4), and the last drift item (this
Approvals-nav clarification) is resolved. No further §11 corrections are outstanding. (Completes the
§4B/D4 reconciliation thread.)

---

## §12 — Design direction (brief for the 21B/21C Builder; skills invoked at Builder time, not here)

The three UI surfaces inherit **Session 20's bar**: full keyboard operability, correct ARIA
(dialogs/tooltips/live-regions for action feedback), WCAG-AA contrast, and the CVD-safe palette already in
`app/globals.css` / the calendar palette. `impeccable-design-and-taste` + the taste skill activate on
these templates at 21B Builder time (mirroring Session 20 BP7), behind the confirmation gate.

- **/settings/team** — an administrative surface. Posture: **calm, dense-but-legible table**; the seat
  meter is the one confident focal element (a quiet progress indicator, not a marketing gauge). Status and
  role are **badges**, not color-only (CVD-safe: shape + label). Destructive actions (remove) use an
  explicit dialog with a named subject; role change is a low-friction inline confirm. No decorative
  flourish — trust comes from clarity.
- **/invite/accept** — a **single-purpose, high-trust arrival**. One card, one action. The business name +
  inviter carry the warmth; the locked email field reassures ("you're joining as name@work"). The invalid
  state is quiet and non-alarming (mirror 18B's neutral tone — no red-alert scolding). This page is
  someone's first impression of SOSH; it should feel intentional and safe.
- **Approvals inbox (21C)** — a **fast triage lane**. Scannable rows, obvious primary action (Approve),
  keyboard-first (approve/skip without leaving the keyboard), batch selection legible. The edit→draft→approve
  two-step must be *visible*, not hidden — the approver should always consciously re-approve. Empty state
  is a positive, finished feeling, not an error.

The Architect sets direction only; the Builder invokes the skills.

---

## §13 — Explicitly deferred

- **Multi-business switcher UI** → Phase 2. Seam shipped (`preferredBusinessId`, §2.3); persistence store
  (`last_active_business_id`) not built (no new table per L-1).
- **Per-seat billing** → **dropped** (0013 §0: seats are a plan capability cap, never a billed quantity;
  Stripe untouched).
- **Transfer-ownership** → not a feature (0013 n1). `owner_id` is the un-removable primary-admin invariant.
- **Agency tier seat divergence** → Phase 4 (agency currently mirrors Pro, `lib/stripe/plan.ts`).
- **Cross-account invite forwarding** → intentionally unsupported (L-4 / 0013 §7.3 email-match).
- **Image generation, engagement inbox** → unchanged phase boundaries (Phase 2+), untouched here.
- **In-DB token verification** (`accept_invite(p_token)`) → rejected in 0013 §7.3; app-side verification stands.

---

_End ADR 0014 (original body)._

---

# Amendment A — Session 22 (Approvals hardening)

- **Status:** Accepted (design). Session 22 W2. Appends to — does not rewrite — the body above.
- **Date:** 2026-07-12 · **Corrected:** 2026-07-12 (B0 founder-review pass — F1 added §A1.1
  `APV-BULK-VISIBLE-ONLY`, which supersedes the pre-correction A1 to the extent A1 implied the platform
  filter was the only rendered-set/DB-set divergence; truncation is the other).
- **Governed by:** ADR 0015 (test-execution tiers; every constraint below states its ADR 0015 §2 tier).
- **Binding input:** `docs/build-guide/session-22.md` §0 — L-6, L-7, L-8, D-5, D-6, D-7, and the
  findings ledger. Encoded, not re-opened.
- **Hard constraint (restated from the brief):** the approve boundary is **not** weakened. The DB trigger
  `enforce_post_transition_capability`
  (`supabase/migrations/20260702120300_posts_role_aware_and_status_trigger.sql:38-72`) stays the sole
  authority; the new platform predicate is a **narrowing** of an already-gated `UPDATE`, never a new write
  path. **No new DB object** (no function, RPC, policy, or migration) — proven feasible as a pure query
  change in A1.

---

## A0 — Findings ledger (every open 21B/21C finding dispositioned)

| Origin | Finding | Disposition (this Amendment / Session 22) |
|---|---|---|
| 21C M1 | bulk approve ignores platform filter | **A1** — atomic platform predicate, button re-enabled (L-6 / D-5). Current stopgap = the button is *disabled* under a filter (`app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx:210-232`); A1 replaces it. |
| 21C m1 / n3 | `LIMIT 200` no overflow signal; filter params dead | **A2** — bounded total + honest overflow; server-side predicates wired (L-7 / D-6). |
| 21C m2 | skip label `amber-400` fails WCAG-AA (light) | **A3** `APV-CONTRAST-AA`. *(Note: HEAD already moved to `text-amber-700` / dark `amber-300`, `ApprovalsInbox.tsx:309`; B5 must verify BOTH themes, not assume.)* |
| 21C n1 | stale `DashboardShell` export-area comment | Already resolved in 21C/E2 (§11 close-out, this ADR `:566-569`); B6 re-verifies, no new work expected. |
| 21B m2 | team actions lack `canServer` echo | **`ROLE-TEAM-ECHO` (A3)** — *already delivered in HEAD*: all four actions call `canServer(client, business, user.id, CAPABILITIES.MANAGE_MEMBERS)` (`app/[locale]/(dashboard)/settings/team/actions.ts:101,160,186,213`). The constraint **formalizes and regression-guards** it; L-8 is satisfied, not outstanding. |
| 21B n1 | §11 manifest omissions / stale §2.1 line | **A4** — already reconciled 21C/E3 (`:571-575`); A4 confirms and adds the Session-22 manifest block. |
| 21B n2 | `MemberList.isExpiredInvite` epoch math | B6 (date-fns) — hygiene, no constraint. |
| 21B n4 | repeated `getBusinessForUser` calls | **defer** — single indexed query; backlog only. |
| 21C n2 | C1+C2 squashed → phase isolation unverifiable | process, not code — Session 22 commits **one step per commit** (B3 behaviour vs B5 visual are separate). |

---

## A1 — Bulk approve: filter-scoped and atomic (L-6 / D-5) — `APV-BULK-*`

> **⚠️ MECHANISM SUPERSEDED BY §A1.2 (2026-07-16).** The `platforms?: Platform[]` signature and
> `.in('platform', platforms)` predicate specified below **no longer exist in the code**. Bulk approve takes
> an explicit `renderedIds: string[]`. A1's *constraints* still hold; read §A1.2 for the mechanism that
> satisfies them. Do not "restore" the code to match this section.

**Current state (grounded).** `bulkApproveDraftPosts(client, campaignId): Promise<number>`
(`lib/db/posts.ts:491-504`) runs one statement:
`.eq('campaign_id', campaignId).eq('status','draft').is('deleted_at', null).select('id')` — **campaign-scoped,
no platform predicate.** `bulkApprovePostsAction(campaignId)` (`app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:191-205`)
returns `{ success, count }` where `count` is the RETURNING length. The inbox currently **disables** the bulk
button whenever `platformFilter !== 'all'` (`ApprovalsInbox.tsx:210-232`) — the 21C-correction stopgap A1 removes.

**New DB signature (the only change; no new DB object):**

```typescript
// lib/db/posts.ts — bulkApproveDraftPosts gains an OPTIONAL platform narrowing.
// Platform is the existing column enum (lib/db/types.ts:31):
//   type Platform = 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'
export async function bulkApproveDraftPosts(
  client: SupabaseClient,
  campaignId: string,
  platforms?: Platform[],   // NEW — when present & non-empty, restrict to these platforms; else unchanged
): Promise<number>
```

**The single-statement WHERE (stays ONE statement, all-or-nothing):**

```sql
UPDATE posts SET status = 'approved'
WHERE campaign_id = :campaignId
  AND status      = 'draft'
  AND deleted_at IS NULL
  [ AND platform = ANY(:platforms) ]     -- appended IFF platforms?.length, via one .in('platform', platforms)
RETURNING id;
```

PostgREST expression — the predicate is appended conditionally to the **same** builder, compiling to one
`platform=in.(…)` filter on one `UPDATE`:

```typescript
let query = client.from('posts')
  .update({ status: 'approved' })
  .eq('campaign_id', campaignId)
  .eq('status', 'draft')
  .is('deleted_at', null)
if (platforms && platforms.length > 0) query = query.in('platform', platforms)   // NARROWS; one statement
const { data, error } = await query.select('id')
```

**Why no new DB object is needed (the required proof).** The requirement is "approve only the drafts
matching the active platform filter, atomically". A conditional `.in('platform', …)` on the existing
single `UPDATE` expresses exactly that: the filter is a WHERE-clause narrowing, and PostgREST emits it as
one statement. There is no aggregation, no cross-row dependency, and no per-row branching that would force
a function/RPC. The alternatives were adjudicated losers (D-5): a per-id loop over `approvePostAction`
**destroys atomicity** (the property bulk exists to provide, and re-introduces partial-failure UX); leaving
the button disabled is a product regression. Neither needs a DB object either — so introducing one would be
gratuitous. **A query change suffices; no migration.** (`APV-BULK-NO-NEW-DB-OBJECT`, Tier-3 diff-verified.)

**The boundary is intact (`APV-BULK-DB-BOUNDARY`, Tier-1).** `trg_enforce_post_transition_capability` is
`BEFORE UPDATE ON public.posts FOR EACH ROW`
(`supabase/migrations/20260702120300_posts_role_aware_and_status_trigger.sql:70-72`); on any row moving to
`approved` from a non-approved status it calls `user_can(NEW.business_id, 'approve')` and RAISEs if false
(`:53-57`). The trigger fires **per row regardless of the WHERE**. Narrowing the WHERE only *reduces the row
set*; it cannot bypass the trigger. A non-approver (e.g. editor) calling the predicate'd `UPDATE` under a raw
authenticated client hits the RAISE on the first row → the whole statement aborts → **zero** rows change →
the action's `catch` returns `{ error: 'generic' }` (`actions.ts:202-204`). **Proof obligation:** a Tier-1
test in `supabase/__tests__/posts-approval-boundary.test.ts` exercises exactly this — an editor client
calling the predicate'd bulk `UPDATE` is denied, zero rows flip. Executed against live Postgres in
`db-tests` (ADR 0015 §2 Tier-1), or it does not count.

**The count invariant (`APV-COUNT-CONSISTENT`, Tier-2) — the regression this forbids.** Because the DB
predicate **equals** the UI's active platform filter, the filtered row set, the DB-approved set, and the
RETURNING count are the same set. The invariant, stated so a test can assert it:

> **BUTTON LABEL = ROWS APPROVED (DB `count`) = ROWS REMOVED FROM THE LIST = NUMBER ANNOUNCED (live region).**

The 21C failure was: label read `rows.length` (filtered = 2), the DB approved **all 5** (predicate absent),
and the live region announced 5 (`docs/reviews/session-21c-reviewer.md:51-52`). A1 forbids any divergence:
`handleBulkApprove` passes the active `platformFilter` (mapped to `platforms` = `[platformFilter]` when
`!== 'all'`, else `undefined`) into `bulkApprovePostsAction`; the label uses the same filtered `rows.length`;
optimistic removal removes exactly the filtered set; the announcement uses the DB `count`. With the predicate
present these are provably equal — the test asserts all four are the same N, **filtered and unfiltered**.

**Atomicity (`APV-BULK-ATOMIC`, Tier-1/Tier-2).** One statement ⇒ all-or-nothing: a caller lacking
`approve` flips **zero** rows, nothing is optimistically removed, the action returns an error. No partial
application, ever. (A per-row loop is explicitly rejected, D-5.)

**Action signature change (Tier-2):**

```typescript
// app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts
// Zod-validate platforms as an optional array of the Platform enum; pass through unchanged otherwise.
export async function bulkApprovePostsAction(
  campaignId: string,
  platforms?: Platform[],
): Promise<PostActionState>
```

Unfiltered bulk (`platforms` omitted / `'all'`) keeps its exact current behaviour — a regression test pins it.

---

## A1.1 — Bulk approve only over a COMPLETE rendered set (F3 founder-review correction, 2026-07-12) — `APV-BULK-VISIBLE-ONLY`

> **⚠️ MECHANISM SUPERSEDED BY §A1.2 (2026-07-16).** The `APV-BULK-VISIBLE-ONLY` **invariant below still
> binds**, but the count-based completeness gate that enforced it is gone — the invariant is now true by
> construction from the rendered id list. Note especially that this section's "Rejected alternatives (i)"
> **is the mechanism now in use**; §A1.2 records why the rejection was revisited and what makes it safe.

**Supersedes the pre-correction A1 to the extent A1's count invariant implied the platform filter was the
*only* way the rendered set and the DB set can diverge.** They also diverge by **truncation**, and A2 (in
this same amendment) is what introduces it.

**The bug A1 alone did not close (grounded).** `bulkApproveDraftPosts` has **no row limit** — its WHERE is
`campaign_id + status='draft' + deleted_at IS NULL [+ platform]` (`lib/db/posts.ts:491-504`), so it approves
**every** matching draft in the campaign. But the inbox renders from `listPendingDraftPosts`, capped at
`APPROVALS_POST_LIMIT = 200` (`lib/db/posts.ts:95,106,129`; `page.tsx:40` passes no `limit`), and the bulk
button's label is the **rendered** row count (`ApprovalsInbox.tsx:214,217,228`). So whenever a campaign's
pending drafts exceed what the 200-row window shows for it, the rendered set is a **strict subset** of the
DB set:

> Campaign X has 60 pending drafts; the 200-row window shows only 12 of them. The button reads *"Approve
> all (12)"*. Click → `bulkApproveDraftPosts` approves **all 60** in the DB, including the 48 the approver
> never saw; the live region announces 60.

This is **21C M1 exactly** (`docs/reviews/session-21c-reviewer.md:50-52`), with truncation as the mechanism
instead of a platform filter. The A1 count invariant (`BUTTON LABEL = ROWS APPROVED = ROWS REMOVED =
ANNOUNCED`) holds **only when the rendered set is complete**; truncation breaks it just as the platform
filter did.

**The rule (`APV-BULK-VISIBLE-ONLY`).** Bulk approve is **OFFERED for a campaign IFF its rendered set (for
that campaign + all active filters) is provably COMPLETE** — i.e. the number of rows shown for that predicate
**equals the server's total for the SAME predicate**. **Bulk must never approve a draft outside the rendered
set.** When the rendered set is *incomplete* (rendered count < server total for that campaign+filter), the
per-campaign bulk button is **DISABLED with an honest message** — *"Filter down to approve in bulk"* — never
a silent over-approve. This subsumes the A1 platform-filter handling: a filter is just one way to make the
rendered set complete enough to offer bulk; the completeness test is the single gate.

**Data contract A1.1 requires from A2 (stated explicitly).** The per-campaign completeness signal must come
from the **same filter-scoped total A2 introduces** — not a business-wide number. For each campaign group the
inbox renders, it needs `renderedCount(campaignId, activeFilters)` and `serverTotal(campaignId,
activeFilters)`; bulk is offered iff they are equal. Concretely, A2's `{ rows, total }` must be resolvable
**per campaign under the active filters** (either by grouping the returned `rows` and comparing against a
per-campaign filtered count, or by the inbox only offering bulk when the *global* view is non-truncated
(`total <= rows.length`) AND the active filter narrows to a single complete campaign). The Builder picks the
narrowest sufficient mechanism; the invariant it must satisfy is `offered ⇒ rendered == serverTotal for that
predicate`.

**Rejected alternatives (with rationale).**
- **(i) Bulk by explicit visible ids** (`.in('id', renderedIds)`): the invariant would hold by construction
  (you approve exactly what you rendered). Rejected as the *general* mechanism because ~200 UUIDs ≈ 7 KB of
  PostgREST URL, uncomfortably near the 8 KB request-line limit — it works at 12 ids and silently breaks near
  the cap, exactly where correctness matters most. *(It remains a legitimate implementation for the
  already-complete case, since there the id list is small by definition; the Builder may use it there.)*
- **(ii) Accept over-approval above 200**: breaks the human-in-the-loop promise 21C M1 exists to protect
  (approving posts the approver never saw). Rejected outright.

**Consequence for A2 — the un-defer trigger sharpens.** With A1.1, the first production overflow no longer
degrades a passive banner only; it **kills a real affordance** (bulk goes dead for the affected campaign
until the approver filters down). So A2's cursor-pagination un-defer trigger (`total > 200` observed in
production) is now a *functional* regression signal, not merely cosmetic — the banner firing means an
approver has lost bulk approve. `backlog.md` records this sharpened trigger (session-22 B6).

`APV-BULK-VISIBLE-ONLY` is added to the A3 constraint table (Tier-2). *(A1's `APV-BULK-FILTER-SCOPED`,
`-ATOMIC`, `-DB-BOUNDARY`, `-COUNT-CONSISTENT`, `-NO-NEW-DB-OBJECT` are unchanged and still hold; A1.1 adds
the completeness precondition under which the count invariant is even askable.)*

---

## A1.2 — Reversal: bulk approve IS by explicit rendered ids (Session 22-D/22-E correction, 2026-07-16)

**This section supersedes A1's `platforms?: Platform[]` mechanism and A1.1's count-based completeness gate.**
Where A1/A1.1 and this section conflict, A1.2 governs. A1's *constraints* (`APV-BULK-FILTER-SCOPED`,
`-ATOMIC`, `-DB-BOUNDARY`, `-COUNT-CONSISTENT`, `-NO-NEW-DB-OBJECT`) and A1.1's *invariant*
(`APV-BULK-VISIBLE-ONLY`) all still hold — only the mechanism that satisfies them changed.

**What happened.** Sessions 21C, 22-B3 and the Session 22 review each verified `APV-BULK-*` against only one
of `bulkApprovePostsAction`'s two callers. `PostsClient.tsx` (`/campaigns/[id]/posts`) went unaudited for
three consecutive sessions while exhibiting both bugs the constraints existed to prevent — bulk ignoring the
active platform filter (21C M1, re-found as Session 22 BLOCKER-1) and approving drafts outside the rendered
50-row window (BLOCKER-2). The platform-predicate mechanism made the invariant something each caller had to
*re-implement correctly*; the review's own recommendation was that ids make it true **by construction**.
Session 22-D adopted that. This section records the reversal, which 22-D performed but did not write down.

**The adopted mechanism.**

```typescript
export async function bulkApproveDraftPosts(
  client: SupabaseClient,
  campaignId: string,
  renderedIds: string[],   // exactly the ids the caller painted for the human
  businessId: string,      // server-derived (ctx.business.id); defence-in-depth
): Promise<number>
```
```sql
UPDATE posts SET status = 'approved'
WHERE id = ANY(:renderedIds)
  AND campaign_id = :campaignId
  AND business_id = :businessId
  AND status      = 'draft'
  AND deleted_at IS NULL
RETURNING id;
```

Still ONE statement, no loop, no RPC, no new DB object. `enforce_post_transition_capability` (0013 §5)
remains the approval boundary and aborts the whole statement on an unauthorised row.

**Why A1.1 rejected this, and what changed.** A1.1 rejected alternative (i) because ~200 UUIDs ≈ 7 KB of
PostgREST query string, "uncomfortably near the 8 KB request-line limit — it works at 12 ids and silently
breaks near the cap." **That analysis was correct and remains correct.** Two things make the reversal sound
anyway:

1. **The failure is fail-closed, not silent.** An oversized list is rejected by the gateway (414/400); the
   error propagates, the action returns `{ error: 'generic' }`, and the optimistic UI rolls back. It cannot
   over-approve. A1.1's word "silently" overstated the risk — the *availability* cost is real, the
   *correctness* cost is not.
2. **The cap is now explicit.** `bulkApproveSchema.renderedIds` is
   `z.array(z.string().uuid()).max(APPROVALS_POST_LIMIT)` (200). Both surfaces sit at or under it (Approvals
   fetches `APPROVALS_POST_LIMIT`; campaign posts fetches 50, `posts/page.tsx`). The A1.1 carve-out ("the
   already-complete case, since there the id list is small by definition") was **false at the cap** — a
   complete inbox group can be 200 ids — so the bound is stated in code rather than assumed from the UI.

Against that: the id list makes `APV-BULK-VISIBLE-ONLY` **unconditionally true by construction** for every
caller, present and future, instead of a property each caller re-derives and one of two got wrong for three
sessions. That trade is worth 7 KB of URL.

**What this deletes.** The business-wide `countPendingDraftPosts()` gate in `bulkApprovePostsAction` is gone.
It was never the guarantee A1.1 named: it refused when a *business-wide* total exceeded 200 — an orthogonal
proxy for "is this group complete?" — and it was a separate statement in a separate snapshot, i.e.
TOCTOU-racy (Session 22 MINOR-2). The predicate and the write are now the same statement, so the race cannot
exist. `countPendingDraftPosts` remains live as the A2 **read-side overflow signal** only.

**What is NOT server-verifiable, stated plainly.** The server cannot verify that `renderedIds` is what a
human actually saw — it trusts the caller's list. This is not a regression: `approvePostAction(id)` in a loop
already achieves any state bulk can reach, so bulk grants no capability the caller lacks, and the old count
gate did not verify renderedness either. `APV-BULK-VISIBLE-ONLY` is therefore a **UI-integrity constraint
enforced at the caller**, and its Tier-2 tests must pin *each caller* (both are now pinned:
`ApprovalsInbox.test.tsx`, `PostsClient.test.tsx`). The DB-layer scoping (`campaign_id`, `business_id`,
`status`, RLS, trigger) is what bounds the blast radius of a forged list.

**Scope note on `business_id`.** It is honest defence-in-depth, not load-bearing: a campaign belongs to
exactly one business, so `campaign_id` pins `business_id` transitively via the FK. No fixture can make it
independently load-bearing, and `supabase/__tests__/posts-approval-boundary.test.ts` says so rather than
claiming otherwise. Its value is that this write path no longer relies on RLS alone (Session 22 MINOR-3).

**Index note — and a correction.** The *bulk write* needs no new index: `id = ANY(:renderedIds)` is a
unique-key lookup on `posts_pkey` bounded by the input array (≤200 rows), with `campaign_id`/`business_id`/
`status`/`deleted_at` applied as a recheck on those ≤200 heap tuples. No composite index can beat that.
**This does not touch Session 22 MINOR-5**, which concerns a different query — `countPendingDraftPosts`'s
`(business_id, status, deleted_at, scheduled_at)` *read* predicate (`lib/db/posts.ts:150-166`). That function
stays live as A2's overflow signal, so MINOR-5 stands as filed and its backlog entry remains open under the
same Pro-account un-defer trigger. (The 22-E review initially reported MINOR-5 as moot by conflating the two
predicates; recorded here so the error is not re-inherited.)

**Consequence for A2's un-defer trigger.** Unchanged in substance but softened in urgency: overflow no longer
*kills* bulk for a campaign (ids work regardless of the business-wide total) — it only means the rendered set
is a subset, which the approver is told. `total > APPROVALS_POST_LIMIT` remains the cursor-pagination trigger.

`APV-BULK-CAP` is added to the A3 constraint table (Tier-2): *`renderedIds` is bounded by
`APPROVALS_POST_LIMIT` at the Zod boundary; an over-cap array is rejected before any DB call.*

---

## A2 — The read path: server-side filters + overflow total (L-7 / D-6) — `APV-SERVER-FILTER`, `APV-PAGINATED`

**Current state (grounded).** `listPendingDraftPosts(client, opts)` **already applies** `campaignId` /
`platform` server-side (`lib/db/posts.ts:125-126`) and returns `CalendarPostRow[]` capped at
`APPROVALS_POST_LIMIT = 200` (`:95,129`), `ORDER BY scheduled_at ASC` (`:128`). `countPendingDraftPosts`
already returns the unbounded pending total but is **business-scoped only** (`:139-151`) — it does **not**
honor `campaignId`/`platform`. The dead part (21C n3) is that `page.tsx:40` passes only `{ businessId }`.

**A2 contract.** Close n3 at the page layer and make the overflow total honest **per active filter**:

1. **`listPendingDraftPosts` returns rows AND a filter-scoped bounded total.** Signature becomes:

```typescript
// lib/db/posts.ts
export async function listPendingDraftPosts(
  client: SupabaseClient,
  opts: { businessId: string; campaignId?: string; platform?: Platform; limit?: number },
): Promise<{ rows: CalendarPostRow[]; total: number }>
//   rows  = first (limit ?? 200) drafts matching businessId [+ campaignId] [+ platform], ORDER BY scheduled_at ASC
//   total = EXACT count of drafts matching the SAME predicate (head:true count), UNBOUNDED by the limit
//   → overflow is honest per the active filter: "showing rows.length of total".
```

`countPendingDraftPosts` is **extended to accept the same optional `campaignId`/`platform`** (or folded into
the `head:true` count above) so the total matches the filtered rows — otherwise a filtered view would show a
business-wide total and lie in the other direction. Both remain bounded, indexed, single queries (no
unbounded scan introduced).

2. **`page.tsx` passes the filter through** from `searchParams` (`?campaign=&platform=`), closing n3: a
   deep-linked filtered view fetches server-filtered rows and a matching total. It threads `total` to the
   inbox alongside `rows`.

3. **Overflow contract (`APV-PAGINATED`, redefined — see A3).** `overflow = total > rows.length`. When
   `overflow` is true the surface MUST say so — the honest string is *"Showing the first {rows.length} of
   {total} pending posts — narrow with a campaign or platform filter."* When `total <= 200`, no overflow
   state. **Silent truncation is forbidden** (the 21C m1 finding). *(B4 ships the data + a minimal truthful
   string so the state is testable; B5 owns the banner's copy, layout, a11y and i18n — the current inbox
   already renders an overflow notice at `ApprovalsInbox.tsx:138-142,157-161`, which B4/B5 point at the new
   total.)*

**Interaction note (launch-scoped, honest about the limit).** At launch caps (trial 50 generated / Plus 50
per month, `CLAUDE.md` pricing) a business cannot hold >200 simultaneous pending drafts, so the inbox's
interactive filters may remain client-side over the fetched ≤200 rows for responsiveness; the server-side
predicate + total is what makes a **deep-linked** or **overflowing** view honest. The overflow banner is the
tripwire for the one case client-side filtering cannot serve (filtering a truncated 200).

**Cursor pagination is deferred (D-6).** Not built now — unearned at launch caps. **Un-defer trigger
(named):** the first business observed with `total > APPROVALS_POST_LIMIT` (200) pending drafts — i.e. the
first time the overflow banner actually fires in production for a real account (most plausibly a Pro account,
whose posts are uncapped). The banner is the monitoring signal that unlocks the backlog item. Filed to
`backlog.md` (session-22 B6) with this exact trigger. (`APV-PAGINATED` = overflow-signal, Tier-2.)

---

## A3 — Supersession + updated §10 constraint list

**Supersedes in the body above:**

- **§9.4, `:474`** — *"At-scale → paginate/virtualize."* → **superseded.** Replaced by A2: a bounded query
  (`LIMIT 200`) **plus an honest overflow signal** ("showing N of M"). No pagination/virtualization ships in
  Phase 1; cursor pagination is deferred with the A2 un-defer trigger.
- **§9.4 `APV-PAGINATED`** — **redefined** from "paginate/virtualize" to "bounded query + honest overflow
  signal; real pagination deferred (A2)".
- **§9.5, `:477-480`** — **NOT superseded.** The "Approvals" nav entry is delivered as-is (live,
  role-gated `<Link>`; `APV-NAV-COMPLEMENTS` stands). The only residual (stale export-area comment, 21C n1)
  was resolved in 21C/E2 (`:566-569`); B6 re-verifies.

**§10 additions (each with its ADR 0015 §2 tier). "Covered" = executed green in the stated CI job:**

| Constraint | Assertion | Tier (ADR 0015 §2) | Test home / executing job |
|---|---|---|---|
| **APV-BULK-FILTER-SCOPED** | bulk approves only drafts matching the active platform filter (3 LinkedIn + 2 X, filter=X → exactly the 2 X flip; the 3 LinkedIn stay `draft`) | Tier-2 (behaviour) + Tier-1 (predicate live) | `campaigns/[id]/posts/actions` + `approvals/ApprovalsInbox` tests (`app-tests`); predicate exercised live in `posts-approval-boundary` (`db-tests`) |
| **APV-BULK-VISIBLE-ONLY** (A1.1, mechanism per A1.2) | the write reaches exactly the ids the caller rendered — true by construction from `renderedIds`, not by a count gate. Enforced **per caller**: every caller must pass only what it painted | Tier-2 | **Both** callers pinned (`app-tests`): `approvals/ApprovalsInbox.test.tsx` (filter → exactly the filtered ids; truncated group disables bulk) **and** `campaigns/[id]/posts/PostsClient.test.tsx` (21C-M1 scenario; rendered-window scenario). A new caller with no test is `AUTHORED-NOT-EXECUTED` for this constraint (CLAUDE.md SHARED-FUNCTION CALLERS) |
| **APV-BULK-CAP** (A1.2) | `renderedIds` is bounded by `APPROVALS_POST_LIMIT` (200) at the Zod boundary; an over-cap array is rejected with `invalid_input` before any DB call, so the id list cannot cross PostgREST's ~8 KB request-line limit | Tier-2 | `campaigns/[id]/posts/actions.test.ts` (`app-tests`) — asserts `APPROVALS_POST_LIMIT + 1` ids → `invalid_input` with zero DB calls, and exactly `APPROVALS_POST_LIMIT` ids → success |
| **APV-BULK-ATOMIC** | one statement; caller lacking `approve` flips ZERO rows; nothing removed from list | Tier-1 | `supabase/__tests__/posts-approval-boundary.test.ts` (`db-tests`) |
| **APV-BULK-DB-BOUNDARY** | raw authenticated EDITOR client calling the predicate'd UPDATE is denied by `enforce_post_transition_capability` | Tier-1 | `supabase/__tests__/posts-approval-boundary.test.ts` (`db-tests`) |
| **APV-BULK-NO-NEW-DB-OBJECT** | the predicate is a query change; diff contains no new function/RPC/policy/migration | Tier-3 (diff-verified) | Reviewer diff-scan (`supabase/`/`.sql` empty in the bulk-approve commit) |
| **APV-COUNT-CONSISTENT** | label = DB `count` = rows removed = announced, filtered AND unfiltered | Tier-2 | `approvals/ApprovalsInbox` test (`app-tests`) |
| **APV-SERVER-FILTER** | `listPendingDraftPosts` honors `campaignId`/`platform` server-side; `page.tsx` passes them; a param'd call returns a strictly narrower set, never a row outside the predicate | Tier-2 | `lib/db/posts` + `approvals/page` tests (`app-tests`) |
| **APV-PAGINATED** *(redefined)* | `LIMIT 200` + `ORDER BY scheduled_at ASC` hold; `total > rows.length` ⇒ surface reports overflow; `total <= 200` ⇒ no overflow; never silent truncation | Tier-2 | `lib/db/posts` + `approvals/ApprovalsInbox` tests (`app-tests`) |
| **APV-CONTRAST-AA** | skip label and the disabled bulk badge meet WCAG-AA 4.5:1 in **both** light and dark themes | Tier-2 (single tier — see Session 22-D MINOR-1 correction below) | `approvals/ApprovalsInbox.test.tsx` (`app-tests`): computes each color's relative luminance from `app/globals.css`'s actual oklch custom properties / Tailwind hex values and asserts the WCAG contrast ratio ≥4.5 in both themes — not a code comment, not a design-agent review |
| **ROLE-TEAM-ECHO** | the four team actions call `canServer('manage_members')` and return the typed denial; the DB still denies independently (echo is not the boundary) | Tier-2 (echo) + Tier-1 (DB denial) | `settings/team/actions` test (`app-tests`) + `members`/`user-can` suites (`db-tests`). **Already implemented** at `settings/team/actions.ts:101,160,186,213`; the test regression-guards it. |

*(All pre-existing §10 rows are unchanged; the RES-*/INV-*/SEAT-*/UI-* constraints keep their homes. ADR
0015 §2 retro-tiers them: `supabase/__tests__` rows = Tier-1, `lib/**`/component rows = Tier-2,
`RES-NO-MIDDLEWARE` = Tier-3.)*

**Correction (Session 22-D, MINOR-1) — `APV-CONTRAST-AA` resolved as a single Tier-2 constraint, not a
dual-tier maybe.** The original A3 row named its home as *"`approvals/ApprovalsInbox` a11y test (`app-tests`)
+ `impeccable-design-and-taste` review (B5)"* with a "Tier-2 where harness supports / Tier-3 visual" tier —
neither artifact existed (no design-review agent by that name is installed; the test file had zero
contrast/amber/4.5 assertions), and the dual-tier wording let the gap read as covered. **Decision:** Tier-2,
executing test only — no design-agent review, no Tier-3 fallback. `ApprovalsInbox.test.tsx` now computes
`text-amber-700`/`dark:text-amber-300` (skip label) and `text-foreground`-on-`bg-muted` (disabled bulk badge)
relative luminance directly from `app/globals.css`'s oklch custom properties and Tailwind's hex values, and
asserts each pairing clears the 4.5:1 AA floor in both themes. The code comment at `ApprovalsInbox.tsx` that
previously asserted a contrast measurement with no test behind it was deleted — the test is the proof now,
not a comment claiming one.

---

## A4 — Manifest hygiene (21B n1) — status + Session-22 additions

**Already reconciled.** The 21B n1 concerns were closed in 21C/E3: the §11 close-out (`:571-575`) states the
manifest matches delivered reality, the retrofit files are listed (`components/ui/tooltip.tsx`,
`components/campaigns/CampaignCard.tsx`, `components/social/PlatformConnectionCard.tsx`,
`lib/contexts/business-context.tsx`, `lib/members/useCan.ts`, `lib/db/types.ts` — `:525-542`), and the stale
§2.1 line is corrected — the `businesses` SELECT-widening is recorded as **delivered in 21A `ef6b3bf8`, not
21B** (`:544-549`). **No re-fix is required**; A4 records that these are closed and adds the files Session 22
itself touches.

**CHANGED — 22 (approvals hardening; app-layer + query only, no migration):**
- `lib/db/posts.ts` — `bulkApproveDraftPosts` optional `platforms` predicate (A1); `listPendingDraftPosts`
  returns `{ rows, total }` with server-side filter-scoped total (A2); `countPendingDraftPosts` accepts the
  same optional predicate (A2).
- `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts` — `bulkApprovePostsAction(campaignId, platforms?)` (A1).
- `app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx` — re-enable the filtered bulk button (remove the
  `:210-232` stopgap); pass the active filter; label/removal/announce from the same filtered set (A1); consume
  the new `total` (A2). *(B3 = behaviour commit; B5 = the contrast/a11y/banner commit — separate commits.)*
- `app/[locale]/(dashboard)/approvals/page.tsx` — pass `campaignId`/`platform` from `searchParams`; thread
  `total` (A2).
- `i18n/{en,pt,es}/approvals.json` — overflow-banner + bulk-button accessible-name strings (B5).

*(`settings/team/actions.ts` needs no change for ROLE-TEAM-ECHO — the echo already exists, `:101,160,186,213`
— only a regression test is added, Tier-2.)*

---

_End Amendment A._
