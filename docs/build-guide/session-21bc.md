# Sessions 21B/21C — Seats & Permissions: Flow & Surface (ADR 0014)

> **Goal:** Turn the 21A backend spine into a usable multi-member product. **21B** ships the
> membership-aware business resolver (a non-owner member currently 404s everywhere), the HMAC
> invite **email** (Resend) + `/invite/accept` route, `/settings/team` (member list, invite,
> change-role, revoke, remove, seat meter), the capability-gate **retrofit** across calendar /
> campaigns / accounts / billing, the app-layer `connect_accounts` gate in the service-role social
> route handlers, and the Pro→Plus **overage-lock** UX. **21C** ships the role-gated approver
> **quick-approve inbox** wiring the existing (surface-less) approve path. The permission MODEL is
> locked in ADR 0013 Rev B — this ADR designs the **surface**, not the model.

> **How to use this file:** paste each phase into Claude Code in order. **Architect → Opus.
> Builder → Sonnet. Reviewer → Opus. Correction → Opus.** §1 (Architect) opens with a **primer** —
> paste the primer first, wait for its acknowledgement, then paste the full prompt. §0 must be
> adjudicated (below) before §1b runs. §2–§4 remain stubs until the ADR is drafted and reviewed.

> **Design plugins — when relevant.** This is the first UI phase of the feature.
> `impeccable-design-and-taste` + the taste skill are **OFF for the Architect** (ADR-only). They
> activate at **21B Builder** time on the `/settings/team`, `/invite/accept`, and **Approvals**
> inbox templates, behind the usual confirmation gate — mirroring Session 20 BP7. The Architect's
> only job re design is to **name the direction** in the ADR so the Builder doesn't reach for the
> wrong thing.

> **§0 holds the decisions surfaced with named losers for the founder.** Each carries a
> recommendation; they are *binding input* to the Architect prompt once adjudicated — pasted inside
> §1b so the Architect does not re-litigate them. **Nothing in §1b runs until §0 is signed off.**

---

## §0 — Decisions (surfaced with named losers · adjudicate before §1b)

**Naming:** marketing **Plus** = DB `plan = 'plus'`; **Pro** = `plan = 'pro'`. Seats are a plan
capability cap (trial 10 / plus 10 / pro `null`), never a billed quantity — Stripe stays untouched.

**Where the model ends and this ADR begins:** ADR **0013 Rev B** is the locked model (two-axis
role × `is_admin`, `user_can` capability oracle, DB-enforced seat cap, HMAC invite + email-match
accept RPC, owner-membership trigger). This ADR (**0014**) is **surface + flow + app-layer** only —
no model or RLS-policy reversal.

**Build split** (this file = the 21B/21C Architect session; one ADR, two build sessions):
- **21B — Flow + surface:** resolver, invite email, `/invite/accept`, `/settings/team`, seat meter,
  capability-gate retrofit, `connect_accounts` app-layer gate, overage-lock UX.
- **21C — Approver quick-approve inbox:** role-gated pending-drafts queue wiring the existing approve path.

**Locked (L):**

- **L-1** ADR **0014** is surface-only. It introduces **no** new table, **no** RLS-policy body change,
  **no** Stripe schema change. Everything new is a route, a component, a resolver swap, an email kind,
  an app-layer `user_can` check, or i18n copy.
- **L-2** The **resolver lands first.** Until `getBusinessByOwner` resolves via `owner_id ∪ active
  membership`, every accepted member 404s. This is the gating deliverable of 21B.
- **L-3** UI capability gates **echo `user_can`** — they are UX, not the security boundary. The DB is
  already the real boundary (anon key + RLS). Hiding a button is never the control.
- **L-4** The invitee must sign in with the **invited work email** (0013's `accept_invite` email-match).
  Cross-account forwarding is intentionally unsupported; the accept UX is designed around that.
- **L-5** Editing an approved post **reverts it to draft** (ADR 0012). The approver inbox's
  "edit then approve" is therefore **two explicit steps**, never a silent combined action.
- **L-6** All new user-facing strings go through next-intl in **all three locales** (en/pt/es); dates
  via `date-fns formatISO`; no unbounded queries (every list `LIMIT` + `ORDER BY`); no `console.*`,
  no `any`; new surfaces inherit Session 20's a11y/WCAG-AA bar.
- **L-7** `/ecc:` prefix throughout. Architect produces **only**
  `docs/decisions/0014-seats-and-permissions-surface.md` — no `.ts`, no `.sql`. Design skills OFF this phase.

**Decision ledger (D — recommendation + named loser · adjudicate by number):**

| # | Decision | Recommendation | Loser (rationale) |
|---|---|---|---|
| M-1 | Scope | One ADR 0014, 21B fully specified + 21C contracts; build splits 21B→21C | Two separate architect sessions (re-loads model + resolver context 21C strictly depends on; 21C too thin for its own ADR) |
| M-2 | Artifact | New ADR **0014** (Flow & Surface) | 0013 Rev C amendment (additive UX ≠ model reversal; keeps the model doc clean/auditable) |
| B-1 | Resolver / "current business" | Prefer the **owned** business; else the single active membership. Persist a `last_active_business` seam for Phase-2 switching, **don't build** the switcher | Newest-membership-wins (non-deterministic for an owner who is also a member); build switcher now (Phase-2 creep) |
| B-2 | Accept flow, new user | **Sign-up first** with the invited email pre-filled + locked, then accept. Non-match → block at accept, name the invited address | Accept-then-signup (orphaned membership on abandon); any-email-then-rebind (defeats the email-match hijack guard) |
| B-3 | Confirmations + remove semantics | Role-change = inline confirm; remove = explicit dialog; removal is **soft** (`status='revoked'`) | Hard delete (loses audit trail, fights 21A's no-DELETE RLS); no confirm on remove (destructive misclick) |
| B-4 | Seat-meter copy + CTA | Meter "X of Y seats" (Y = "Unlimited" when `null`). `seat_cap_reached` → "Upgrade to Pro for unlimited seats." `overage_locked` → **not** upgrade: "Remove N−10 members or stay on Pro" → member mgmt + portal | Same CTA for both (overage isn't fixed by upgrading — they're mid-downgrade; conflating misdirects) |
| B-5 | Invite resend / expiry | **Re-issue** a fresh token on the same reserved row (new `exp`, resend email); expired row shows a "resend" affordance | New row per resend (double-counts the seat, trips the `(business_id, lower(email))` partial unique index) |
| B-6 | Retrofit affordance rule | **Hide** by default (clean read-only for viewer); **disable-with-tooltip** only where absence is confusing — chiefly the Approve button an editor can see but not use ("Only approvers can approve") | Disable-everything (dead-control clutter for viewer); hide-everything (editors can't see why the human-in-the-loop gate exists) |
| C-1 | Inbox affordances | Single **+ batch** approve; edit-then-approve is **two explicit steps** (edit reverts to draft per L-5 — make the loop legible); reject/skip available | Single-only (defeats "clear fast"); silent edit-and-approve (hides the 0012 revert; approver never consciously re-approves) |
| C-2 | Inbox vs existing surfaces | New role-gated **"Approvals"** nav (approver + admin); **complements**, doesn't replace, calendar/campaign approve; reads the **same** pending-draft data path (no dedupe drift) | Replace the calendar approve affordance (breaks working in-context approve); bury it inside campaigns (kills the cross-campaign "clear all" purpose) |
| C-3 | Empty / scale / filter | Empty = "No posts waiting for approval" (positive, not error); paginate/virtualize; filter by campaign + channel | No filter (unusable past one campaign with pending posts); load-all (violates the no-unbounded-query rule) |

**Anchor artefacts (READ, do not re-derive):** ADR 0013 Rev B (the locked model — capability matrix,
`user_can` strings, seat model, invite/accept contract, `ensure_owner_membership` trigger, the
21B/21C deferral list), `session-21a.md` + the 21A reviewer report (`docs/reviews/` — find the exact
path), ADR 0012 (calendar approve/edit/reschedule surfaces + the edit-reverts-to-draft rule), ADR 0008
(transactional-email outbox conventions the invite email extends), ADR 0010 Amendment 2 §D2.5
(erasure cascade — `business_members` already registered in 21A; confirm no new table means no new row),
Session 18B (login/forgot-password anti-enumeration posture the accept-failure copy mirrors), CLAUDE.md
(RLS `USING`+`WITH CHECK`; three Supabase client roles + lazy import; no service-role in a user path;
i18n-3-locales; `date-fns formatISO`; no unbounded queries; Architect role boundary).

**Contracts 21A already shipped that 21B/21C consume** (do not re-derive — cite):
`get_user_business_ids()` (owner ∪ active members), `user_can(business_id, capability)`,
`enforce_seat_cap` trigger + `plan_max_seats`, `enforce_post_transition_capability` (gates `→approved`),
`protect_primary_admin_membership`, `ensure_owner_membership` (AFTER INSERT — **21B prerequisite**),
`accept_invite(p_member_id, p_business_id)` RPC (email-match + expiry + idempotent);
`lib/db/business-members.ts` (`countSeatUsage`, `listMembers`, `createInvite`, `revokeMember`,
`acceptInvite`, `getMemberById`); `lib/members/{seats,enforcement,capabilities,invite-token}.ts`;
`lib/stripe/plan.ts` `getPlanCapabilities().maxSeats`.

---

## §1 — Architect: primer + prompt  (paste into Claude Code · Opus)

**Paste the primer first. Wait for the acknowledgement. Then paste the FULL prompt.** The primer loads
context and pins the role boundary so the Architect does not start drafting before it has read the repo;
the full prompt is the working brief. **§0 must be adjudicated before §1b is pasted.**

### §1a — Primer (paste first · wait for acknowledgement)

```
Sessions 21B/21C — Seats & Permissions: Flow & Surface (Architect phase). You will produce ONE
design-only ADR next (0014). 21A shipped the DB-enforced backend spine (ADR 0013 Rev B); the UI and
flows do not exist yet, and a non-owner member currently 404s everywhere. This ADR designs the surface.

Read now, before doing anything else:
- CLAUDE.md — RLS conventions (USING + WITH CHECK on every UPDATE; no new table without RLS), the three
  Supabase client roles + lazy-import rule, the atomic-guard pattern, erasure-cascade, i18n-3-locales,
  date-fns formatISO, no-unbounded-query, Architect role boundary (ADR only).
- docs/current-phase.md — where the build is (21A complete through 21A-D).
- docs/decisions/0013-seats-and-permissions.md (Rev B) — THE LOCKED MODEL. Do not re-litigate it; build
  the surface on it. Note the capability matrix, user_can strings, seat model, invite/accept contract,
  the ensure_owner_membership AFTER INSERT trigger (21A-D/D1), and what 0013 explicitly deferred to 21B/21C.
- session-21a.md — the 21A build guide (contracts 21B/21C consume) — and the 21A reviewer report under
  docs/reviews/ (find its exact path).
- docs/decisions/0012-content-calendar.md — the calendar approve/edit/reschedule surfaces you'll retrofit;
  the rule that editing an approved post reverts it to draft.
- docs/decisions/0008-transactional-email.md — the Resend outbox conventions the invite email extends.
- lib/db/businesses.ts (getBusinessByOwner — the resolver to replace), lib/db/business-members.ts (21A's
  countSeatUsage/listMembers/createInvite/revokeMember/acceptInvite/getMemberById), lib/members/*.ts
  (seats, enforcement, capabilities, invite-token), lib/stripe/plan.ts (getPlanCapabilities().maxSeats).
- The existing approve Server Action + any approve-queue surface (21C wires it — verify what already exists).
- The social connect/disconnect route handlers (service-role) — where the app-layer connect_accounts gate lands.
- proxy.ts — whether resolver/role resolution belongs at the middleware boundary (likely not; confirm).

Invoke the `architect` ECC agent. Design skills (impeccable-design-and-taste, taste-skill) are OFF this
phase — this is ADR-only; they activate at 21B Builder time. No .ts, no .sql — SQL/TS appear only as
fenced contract blocks inside the ADR. You did not write the existing code; ground every claim in the
files above — do not guess a filename, column, function, or policy.

Do NOT draft the ADR yet. When oriented, reply with:
(1) the current signature + one-line body of getBusinessByOwner (the 404 root cause you'll fix),
(2) confirmation that lib/db/business-members.ts exists and its exported function list,
(3) how a new email "kind" is registered in the transactional outbox (cite the module),
(4) the file + name of the existing approve Server Action, and whether an approver-facing surface exists,
(5) confirmation that the ensure_owner_membership AFTER INSERT trigger (21A-D/D1) is merged,
(6) "Ready for the 21B/21C brief."
Then stop and wait.
```

### §1b — Architect prompt (paste after acknowledgement · FULL)

```
You are the ARCHITECT for SŌSH Sessions 21B/21C. Produce ONE design-only ADR: 0014. Do NOT write .ts or
.sql this phase — signatures and SQL appear ONLY as fenced contract blocks INSIDE the ADR. Architect role
boundary per CLAUDE.md: ADR only, last action is a single confirmation line, then /exit.

OUTPUT: docs/decisions/0014-seats-and-permissions-surface.md

SCOPE: 0013 Rev B is the LOCKED MODEL — do not re-open it. This ADR designs the SURFACE + FLOWS on top of
it. FULLY SPECIFY 21B (membership-aware resolver, invite email, /invite/accept route, /settings/team,
capability-gate retrofit, connect/disconnect app-layer gate, overage-lock UX) and DEFINE the contracts 21C
(approver quick-approve inbox) consumes. The build/review/correct cadence splits 21B then 21C; this ADR
covers both but marks each clause 21B or 21C. Explicitly list what is deferred (multi-business switching →
Phase 2; per-seat billing → dropped; anything else you find).

READ FIRST (ground every claim in the actual repo — no guessed filenames/columns/policies):
- CLAUDE.md; docs/current-phase.md.
- docs/decisions/0013-seats-and-permissions.md (Rev B) — the locked model; do not re-open.
- session-21a.md + the 21A reviewer report (docs/reviews/ — find the path).
- docs/decisions/0012-content-calendar.md — calendar gates being retrofitted + edit-reverts-to-draft.
- docs/decisions/0008-transactional-email.md — the outbox this extends.
- lib/db/businesses.ts (getBusinessByOwner), lib/db/business-members.ts, lib/members/*.ts, lib/stripe/plan.ts.
- The existing approve Server Action + any approve-queue surface; the social connect/disconnect route
  handlers (service-role); proxy.ts.
- The 18B anti-enumeration posture (login/forgot-password indistinguishability) — the accept-failure copy
  mirrors it.
- Session 20's a11y/i18n bar (keyboard, aria, WCAG-AA CVD-safe palette) — the new surfaces inherit it.
- i18n/{en,pt,es} — new namespaces (team, invite, approvals) land in all three.

BINDING DECISIONS (adjudicated with the founder — encode them, DO NOT re-open):
[paste the finalized §0 ledger M-1…C-3 and L-1…L-7 verbatim once locked]

THE ADR MUST SPECIFY:

1. Relationship to prior ADRs. 0013 Rev B = locked model (no reversal). 0012 = calendar gates being
   retrofitted + the edit-reverts-to-draft rule. 0008 = the outbox this extends. Name the 21A-D/D1 owner
   trigger as a hard prerequisite. Confirm NO model/RLS change is introduced — this is surface + app-layer.

2. [21B] Membership-aware resolver. Replace/augment getBusinessByOwner so a user resolves via
   owner_id ∪ active membership (matching get_user_business_ids). Give the new signature as a contract
   block. Specify the deterministic "current business" default (per §0 B-1) and design the multi-business
   SEAM (last_active_business) without building the switcher. Enumerate EVERY caller of getBusinessByOwner
   that must migrate. This lands FIRST — until it does, accepted members 404.

3. [21B] Invite email. New Resend outbox kind carrying the signed invite link; respect the Session 8/17
   outbox conventions (cite them); 3-locale bodies; no email/token in logs. Contract block for the new kind.

4. [21B] /invite/accept?token= route. Verify token app-side (sig + expiry) → accept_invite RPC. Branch:
   brand-new user (sign-up with invited email pre-filled+locked, then accept, per §0 B-2) vs existing authed
   user. email-match failure AND expired/consumed → ONE generic "invite no longer valid" (anti-enumeration,
   mirror 18B). Success → land in the business. Specify the state machine.

5. [21B] /settings/team. Admin-gated (user_can('manage_members')). Member list (role, status), invite
   (email + role), change-role, revoke pending, remove member (soft per §0 B-3, with confirmations).
   Seat meter driven by countSeatUsage + evaluateSeatState; empty / at-cap / overage states; exact copy +
   CTA targets per §0 B-4. Contract-level component/data map, not implementation.

6. [21B] Capability-gate retrofit. The exact per-surface, per-role AFFORDANCE MAP (hide vs
   disable-with-tooltip per §0 B-6) across calendar approve/edit/reschedule, campaigns, connect, billing.
   State plainly: this ECHOES user_can — UX, not the security boundary (the DB already is).

7. [21B] connect/disconnect authoritative gate. The route handlers run service-role (bypass RLS), so the
   real connect_accounts check is an app-layer user_can call in those handlers (RLS-SOCIAL-APPLAYER,
   deferred from 21A). Specify where and the failure shape.

8. [21B] Overage-lock UX. Surface the Pro→Plus over-cap state + portal messaging around the existing
   openBillingPortalAction flow. NO Stripe schema change; messaging + gating only.

9. [21C] Approver quick-approve inbox. Role-gated (approver + admin) surface wiring the EXISTING approve
   path (enforce_post_transition_capability already gates →approved). Single + batch approve; the
   edit-then-approve loop made legible (edit reverts to draft per 0012); reject/skip; nav placement +
   dedupe vs calendar/queue (§0 C-2); empty / at-scale / filter-by-campaign+channel (§0 C-3). Depends on
   21B's resolver + gates. Contracts only — 21C builds after 21B merges.

10. Named constraints the Reviewer can grep: RES-* (resolver + seam + caller migration), INV-* (invite
    email, token re-issue, accept state machine, email-match, expiry, anti-enumeration), UI-* (affordance
    map, seat-meter copy, confirmations), SEAT-* (overage-lock UX, meter = countSeatUsage), ROLE-*
    (connect_accounts app-layer gate, approver inbox gating), APV-* (batch/edit-revert/reject loop). Each
    must map to an EXECUTED test — behavioral, against the CI Supabase stack for anything touching
    RLS/RPC/policies. "Covered" = "executed green," never "authored."

11. File manifest (design-level): NEW vs CHANGED, each marked 21B or 21C.

12. Design direction. Name the impeccable-design-and-taste + taste-skill posture for the three UI surfaces
    (/settings/team, /invite/accept, Approvals inbox) so the 21B Builder has direction; inherit Session 20's
    a11y/i18n/palette bar. The skills are NOT invoked by you — you set the brief.

13. Deferred list — explicit.

CONSTRAINTS ON YOU (the Architect):
- Build on 0013 Rev B; do not re-litigate the model. Where §0 forces a shape, encode it. Where §0 is silent
  (e.g. resolver seam column name, exact anti-enumeration copy, nav label), DECIDE and justify.
- No new dependency. No Stripe schema edit. No service-role in a user path EXCEPT the established DEFINER-RPC
  / documented app-layer-gate patterns — cite the precedent when you use one.
- Surface any genuinely contested sub-decision with a named loser; do not silently pick.
- If a binding decision is infeasible against the actual repo, STOP and output
  "Stopping — §0 conflict at <id>: <one line>." Do not invent a workaround.

When the ADR is complete, output exactly:
"ADR 0014 drafted. Awaiting review." Then /exit.
```

---

## §2 — Builder session · 21B (paste into Claude Code · Sonnet)

One ADR, **two build sub-sessions**. **21B is this section** (B1–B8): resolver + RLS delta first
(L-2), then the connect gate, invite email, accept route, team surface, capability retrofit, and a
consolidated taste/a11y pass. **21C (§2C) runs in a later session, after 21B is merged through its
Reviewer + correction pass** — its surface depends on 21B's resolver and gate echo.

Eight steps, dependency-ordered, each a self-contained `/ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait for acknowledgement, then paste
B1…B8 one at a time**, letting each finish (green + committed) before the next. Do **not** batch them.
**B1** (the sole RLS delta + resolver) and **B2** (login/layout ownership-scoping across ~25 call sites)
are the two to review in isolation.

All steps inherit these **hard rules** (CLAUDE.md — repeated in each prompt so they can't be skipped):
env only via `lib/config.ts`; DB only via `lib/db/`; service-role client via lazy import and **never**
in a user path; timestamps via `date-fns formatISO`; no `any`, no `console.*`; every UPDATE policy has
both `USING` and `WITH CHECK`; every list `LIMIT` + `ORDER BY`; atomic state transitions via conditional
`WHERE` guards; every new user-facing string in **en/pt/es**. Unlike 21A, this session **has UI** —
`.tsx`, routes, and the invite email are all in scope. **`impeccable-design-and-taste` + taste-skill
activate on the UI steps only** (B5 accept page, B6 team surface, B7 retrofit tooltips, B8 pass), behind
the confirmation gate; they stay **off** for B1–B4 (backend/routing) and the invite email (which matches
the five existing templates' shape, not a bespoke pass). Anything touching RLS/RPC/policy is **executed
green against the CI Supabase stack**, never merely authored.

### §2a — Builder primer (paste first · wait for acknowledgement)

```
Sessions 21B/21C — Seats & Permissions: Flow & Surface, BUILDER phase (21B). You transcribe ADR 0014
into the resolver, routes, email, and UI across eight steps. You are not the designer: ADR 0014 is
authoritative; 0013 Rev B is the locked model beneath it.

Read now, before anything else:
- docs/decisions/0014-seats-and-permissions-surface.md — the whole ADR. §10's named constraints
  (RES-*, INV-*, UI-*, SEAT-*, ROLE-*, APV-*) are your acceptance checklist; every one ends up covered
  by an EXECUTED test.
- docs/decisions/0013-seats-and-permissions.md (Rev B) — the model contracts you consume (user_can,
  accept_invite, enforce_seat_cap, the invite-token signer).
- CLAUDE.md — the hard rules (config/db/service-role/formatISO/no-any/no-console/RLS USING+WITH CHECK/
  bounded queries/i18n-3-locale/erasure-cascade).
- The files ADR §11 marks NEW/CHANGED, plus the precedents it reuses: lib/email/{enqueue.ts,types.ts,
  templates/index.ts} and an existing template (the shape to mirror), lib/members/{invite-token,seats,
  enforcement,capabilities}.ts, lib/db/{businesses,business-members,posts}.ts, and
  app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts (the approve/skip/bulk actions 21C reuses).

Invoke ECC in build posture (/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop per step). Do NOT
invoke impeccable-design-and-taste yet — it activates from B5, gated, on the UI surfaces only.

Do NOT write code yet. First confirm the grounding facts the ADR depends on (a wrong one is a STOP):
(1) businesses_select_own's current body is `owner_id = auth.uid() AND deleted_at IS NULL`
    (supabase/migrations/20260430120003_businesses.sql) — the asymmetry §2.1 fixes. AND grep every
    other table's SELECT policy: is `businesses` the ONLY parent whose SELECT still keys on owner_id
    directly rather than get_user_business_ids()? If another exists, report it before B1.
(2) login/actions.ts post-login resolve is getBusinessByOwner (~:74) with a `!business`/`!onboarding_
    completed` redirect branch, and layout.tsx has the matching `!onboarding_completed` redirect
    (~:47-53) — the two sites §2.4 makes ownership-scoped.
(3) the email outbox shape: enqueueEmail path, the EmailKind union, the TEMPLATES registry, and the
    ADR-0008 §17 enqueue-log fields — confirm team-invite slots in without a new delivery mechanism.
(4) the existing approve/skip/bulk Server Actions in campaigns/[id]/posts/actions.ts (names) — 21C wires
    these unchanged.
(5) signInviteToken/verifyInviteToken (lib/members/invite-token.ts) and accept_invite's signature
    (p_member_id, p_business_id).
(6) whether SOSH signup requires email confirmation before a session exists (the token-round-trip premise
    for B5's spike).
Then output those six findings and "Ready for B1." Then stop.
```

### §2b — Builder steps (21B)

#### B1 — RLS delta + membership resolver + parent-table sweep · ADR §2.1, §2.2
```
BUILDER — 21B · B1. Transcribe ADR 0014 §2.1 + §2.2. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. This lands FIRST (L-2): until it does, every accepted member 404s.

BUILD:
- Migration <next-ts>_businesses_select_membership.sql: DROP/CREATE businesses_select_own exactly per
  §2.1 — SELECT-only, TO authenticated, USING (id = ANY (SELECT unnest(public.get_user_business_ids()))
  AND deleted_at IS NULL). INSERT/UPDATE/DELETE policies UNCHANGED (stay owner_id-scoped). This is the
  ONE RLS delta 0014 permits (L-1a); do not touch any other policy body.
- If the primer's grep found ANOTHER parent table with the same owner_id-only SELECT asymmetry, STOP and
  report — do not widen it silently (that is a new §0 decision).
- lib/db/businesses.ts: add getBusinessForUser(client, userId, preferredBusinessId?) exactly per §2.2 —
  one RLS-scoped SELECT, deterministic pick (preferred-if-visible → owned → earliest → null). Keep
  getBusinessByOwner (owner-only service paths still use it).

TESTS (TDD · CI Supabase for the policy):
- RES-BIZ-SELECT-WIDEN: a non-owner ACTIVE member SELECTs their businesses row; a revoked member gets
  zero rows; a non-member gets zero rows; a soft-deleted business is invisible. Run against the CI
  Supabase stack (executed green, not authored).
- RES-RESOLVER-DETERMINISTIC / -OWNED-WINS / RES-SEAM-PARAM-ONLY: owner+member → owned; member-only →
  that business; none → null; preferredBusinessId honored iff in the visible set, else the default.

BOUNDARY: no caller migration yet (B2); no other policy edits; no UI.
On green + commit, output "B1 complete — businesses SELECT widened + getBusinessForUser." Then stop.
```

#### B2 — Caller migration + ownership-scoped post-login/onboarding redirects · ADR §2.4
```
BUILDER — 21B · B2. Transcribe ADR 0014 §2.4. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- Migrate every §2.4 dashboard call site from getBusinessByOwner to getBusinessForUser (layout,
  campaigns, calendar, onboarding, settings/voice, settings/accounts, billing, and the social/billing
  route handlers — the full table in §2.4). Inline getContext() helpers included.
- login/actions.ts: swap to getBusinessForUser AND make the redirect OWNERSHIP-SCOPED exactly per §2.4:
  redirectTo → as-is; else !business → /onboarding; else (owner_id === userId && !onboarding_completed)
  → /onboarding; else → /campaigns. A member never enters the owner's onboarding wizard.
- layout.tsx: the `!onboarding_completed` guard becomes owner-scoped (owner_id === userId &&
  !onboarding_completed) so a member of a not-yet-onboarded owner's business isn't bounced into it.
- Do NOT touch proxy.ts for resolution — it stays auth-session + route-gating only (RES-NO-MIDDLEWARE).

TESTS (TDD):
- RES-CALLER-MIGRATION: a repo grep-guard test asserts no production dashboard path calls
  getBusinessByOwner except the kept owner-only service paths.
- RES-LOGIN-MEMBER-NO-LOCKOUT: a member (owns no business) logging in lands in /campaigns, never
  /onboarding, on every login.
- RES-ONBOARDING-OWNER-SCOPED: the onboarding redirect fires only for the owner of a not-onboarded
  business; a member bypasses it (login + layout).

BOUNDARY: resolver call-swap + redirect scoping only; no new UI, no email.
On green + commit, output "B2 complete — callers migrated + member lockout closed." Then stop.
```

#### B3 — connect/disconnect authoritative gate · ADR §7
```
BUILDER — 21B · B3. Transcribe ADR 0014 §7. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD (the real connect/disconnect writes run service-role, bypassing RLS — the authoritative check is
app-layer, per 0013 §5.4 / L-3):
- app/api/social/[platform]/connect/route.ts (GET): after resolving business via getBusinessForUser and
  BEFORE the service path, call the user_can RPC under the AUTHENTICATED client:
  client.rpc('user_can', { p_business_id: business.id, p_capability: 'connect_accounts' }). On false →
  redirect /${locale}/settings/accounts?error=forbidden (mirrors the existing ?error=connect_failed shape).
- app/api/social/[platform]/disconnect/route.ts (DELETE): same RPC gate; on false → 403 (matches its
  existing 401/404 JSON shape).

TESTS (TDD): ROLE-CONNECT-APPLAYER-GATE / -DISCONNECT-APPLAYER-GATE — a member WITHOUT connect_accounts
(viewer, editor) is blocked in the route (redirect / 403); an approver or admin passes. user_can itself
is DB-tested in 21A; here you test the route-level wiring.

BOUNDARY: route-handler gating only; no UI, no design skills.
On green + commit, output "B3 complete — connect/disconnect app-layer gate." Then stop.
```

#### B4 — Invite email kind (team-invite) · ADR §3
```
BUILDER — 21B · B4. Transcribe ADR 0014 §3. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD (extend ADR 0008's outbox; no new delivery mechanism; MATCH the five existing templates' shape —
no bespoke design pass):
- lib/email/types.ts: EmailKind += 'team-invite'.
- lib/email/templates/team-invite.tsx: TeamInvitePropsSchema (Zod), teamInviteSubject(t, props),
  TeamInviteEmail — props { inviterName, businessName, roleLabelKey, acceptUrl }. roleLabelKey is an
  i18n key, never a raw role string.
- lib/email/templates/index.ts: register the KindEntry in TEMPLATES.
- lib/email/triggers/invite.ts: enqueueTeamInvite(...) → signInviteToken({memberId, businessId}) →
  build acceptUrl `${APP_URL}/${locale}/invite/accept?token=…` → enqueueEmail with
  dedupe_token `invite:${memberId}:${issuedAtEpoch}` (distinct per re-issue → resend actually sends).
- i18n/{en,pt,es}/invite.json: subject + body, 3 locales.

TESTS (TDD): INV-EMAIL-KIND / INV-3-LOCALE — team-invite is registered in TEMPLATES and renders in
en/pt/es. INV-NO-TOKEN-IN-LOGS — the enqueue log emits only {kind, email_kind, business_id, locale,
outcome}; token/acceptUrl live only in props and the recipient is not logged.

BOUNDARY: email plumbing only; the invite Server Action that CALLS enqueueTeamInvite lands in B6.
On green + commit, output "B4 complete — team-invite email kind." Then stop.
```

#### B5 — `/invite/accept` route + accept state machine + signup email-lock · ADR §4  ·  UI (impeccable + taste)
```
BUILDER — 21B · B5. Transcribe ADR 0014 §4. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

STEP-ZERO SPIKE (do this first, before building the happy path): confirm the invite token survives the
signup email-confirmation bounce. SOSH keeps email confirmation for invited users deliberately — it is
the guard that stops a FORWARDED accept link from letting a third party create the account under the
invited address (email-match alone doesn't). So: verify the confirm-link redirect preserves the token
across confirmation; if Supabase's confirm redirect can't carry it, set a signed httpOnly cookie BEFORE
the confirm email is sent and re-read it on return. If neither path works cleanly, STOP and surface it —
do not weaken confirmation to simplify the flow.

BUILD:
- proxy.ts: PUBLIC_SEGMENTS += 'invite' (an invitee may arrive unauthenticated).
- app/[locale]/invite/accept/page.tsx (+ accept client component): the §4.2 state machine —
  verifyInviteToken(token) fails → generic [INVALID]; verified + unauthenticated → [SIGNUP-GATE]
  (reuse (auth)/signup with the email PRE-FILLED + LOCKED to the invited address, token preserved per
  the spike); verified + authenticated → call accept_invite(memberId, businessId); success → land in
  /campaigns; 'already active' → friendly [ALREADY-MEMBER] → land in business; any RPC not-available
  (mismatch / expired / claimed / unknown) → generic [INVALID].
- §4.3 anti-enum: mismatch/expired/consumed/revoked/unknown ALL collapse to one neutral message
  (invite.accept.invalid, 3 locales) + a single "Go to sign in" action. No hint which condition failed
  (mirrors 18B).

DESIGN POSTURE (impeccable-design-and-taste + taste-skill, gated — invoke on this page; if not invokable
in this CC stack, apply the postures from this block, per Session 19/20 precedent): a single-purpose,
high-trust ARRIVAL — one card, one action. Business name + inviter carry the warmth; the locked email
field reassures ("you're joining as name@work"). The [INVALID] state is quiet and non-alarming (18B's
neutral tone, no red-alert scolding). Full keyboard operability, correct ARIA, WCAG-AA. This is someone's
first impression of SOSH.

TESTS (TDD): INV-TOKEN-VERIFY-APPSIDE (bad/expired sig → invalid); INV-ACCEPT-EMAIL-MATCH / -EXPIRY /
-ANTI-ENUM (all failure classes → one generic message — route test; the RPC itself is 21A-tested);
INV-SIGNUP-EMAIL-LOCKED (the signup gate locks the email to the invited address).

BOUNDARY: the accept route + signup lock. The resend affordance that re-issues the token lands with the
team surface (B6, §4.4). Do NOT weaken email confirmation.
On green + commit, output "B5 complete — /invite/accept route + signup lock." Then stop.
```

#### B6 — `/settings/team` surface + Server Actions + seat meter + overage UX · ADR §5, §5.4, §8, §4.4  ·  UI (impeccable + taste)
```
BUILDER — 21B · B6. Transcribe ADR 0014 §5, §5.4, §8, and the §4.4 resend action. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- app/[locale]/(dashboard)/settings/team/page.tsx: Server Component; server guard
  user_can(businessId,'manage_members') else redirect (whole surface admin-only — ROLE-TEAM-ADMIN-GATED).
  Children: SeatMeter, InviteMemberForm (email + role<approver|editor|viewer> + is_admin?), MemberList →
  MemberRow (email, role badge, status badge, is_admin badge; RoleSelect→changeRole inline confirm;
  Resend on invited-&-expired; Remove/Revoke→explicit dialog).
- settings/team/actions.ts (Zod-validated; capability-echoed, DB-enforced):
  inviteMemberAction — reuse signup's work-email rule; fail-fast checkInviteAllowed(...) BEFORE insert
    (over-cap → typed reason, no insert; DB enforce_seat_cap is the real boundary); else createInvite →
    signInviteToken → enqueueTeamInvite (B4).
  changeMemberRoleAction — UPDATE via business_members_update; primary-admin trigger blocks demoting owner.
  revokeMemberAction — revokeMember → status='revoked' (SOFT; never DELETE — UI-REMOVE-SOFT).
  resendInviteAction — §4.4: re-issue a fresh token on the SAME reserved row (new exp, new dedupe_token),
    re-enqueue; no new row (would double-count the seat + trip the (business_id,lower(email)) index).
- SeatMeter states + copy per §5.4 (team.json, 3 locales): Normal "{used} of {max} seats"; Unlimited
  "{used} of Unlimited seats"; At-cap (seat_cap_reached) → "Upgrade to Pro for unlimited seats" → /billing;
  Overage-locked (overage>0) → "Remove {overage} member(s) or stay on Pro" → member list + /billing.
  The overage CTA is deliberately NOT "upgrade".
- §8 overage UX: /settings/team blocks new invites while overage>0 (checkInviteAllowed reason
  'overage_locked'; DB trigger is the hard boundary); revoke/remove + all content ops stay allowed.
  billing/actions.ts surfaces the same state near openBillingPortalAction with links to /settings/team
  and the portal. No Stripe schema change.

DESIGN POSTURE (impeccable + taste, gated): an ADMINISTRATIVE surface — calm, dense-but-legible table;
the seat meter is the one confident focal element (a quiet progress indicator, not a marketing gauge).
Status/role are CVD-safe badges (shape + label, not colour-only). Remove uses an explicit dialog naming
the subject; role change is a low-friction inline confirm. No decorative flourish — trust from clarity.
Full keyboard + ARIA (dialog/tooltip/live-region for action feedback), WCAG-AA.

TESTS (TDD · CI Supabase where marked): UI-REMOVE-SOFT / UI-ROLE-CONFIRM; SEAT-METER-COPY /
-OVERAGE-CTA-DISTINCT (4 states, distinct CTAs); SEAT-INVITE-FAILFAST-ECHO (over-cap invite blocked
in-action AND by the DB trigger — CI Supabase); INV-REISSUE-SAME-ROW (resend updates the same row, no new
seat, no index trip — CI Supabase); SEAT-OVERAGE-LOCK-UX (overage blocks invites; revoke/content allowed
— CI Supabase).

BOUNDARY: the team surface + its actions + overage messaging. Capability gates on OTHER surfaces are B7.
On green + commit, output "B6 complete — /settings/team + seat meter + overage UX." Then stop.
```

#### B7 — Capability-gate retrofit (affordance map) · ADR §6  ·  UI (impeccable posture on tooltips)
```
BUILDER — 21B · B7. Transcribe ADR 0014 §6. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD (this ECHOES user_can — UX, not the security boundary; the DB already denies — L-3):
- App-layer helpers alongside lib/members/capabilities.ts: a useCan(capability) client helper + a
  canServer(...) server echo, both derived from the member (role, is_admin) already resolved by the
  layout (B1/B2). Use the CAPABILITIES constants.
- Apply the §6 affordance map across calendar/campaign Approve, post edit, reschedule, unapprove/skip/
  remove, campaign create/edit, connect/disconnect, billing, /settings/team. Rule (B-6): HIDE by default;
  DISABLE-with-tooltip only where absence confuses — chiefly the Approve control an editor can see but
  cannot use ("Only approvers can approve"). Viewer = clean read-only.
- DashboardShell: capability-aware nav (Billing/Team gated to admin; the Approvals link ships gated but
  inert here — it activates in 21C/C1).

DESIGN POSTURE (impeccable, gated — light: this is affordance-map application over existing surfaces, not
a new template): the disabled-Approve tooltip is quiet and informative, not a scold; the human-in-the-loop
gate should read as intentional. Keyboard-reachable tooltip; ARIA disabled state announced.

TESTS (TDD): UI-AFFORDANCE-MAP / UI-APPROVE-DISABLED-EDITOR — per-role hide/disable matches the §6 table
(component tests across the listed surfaces).

BOUNDARY: affordance echoes only; no behavioral/authorization change (the DB gates are untouched).
On green + commit, output "B7 complete — capability-gate retrofit." Then stop.
```

#### B8 — 21B taste & a11y pass (impeccable-design-and-taste + taste-skill)
```
BUILDER — 21B · B8. Consolidated design/taste + a11y pass over the two new 21B surfaces
(/invite/accept, /settings/team) and the B7 retrofit tooltips. Visual + a11y ONLY — no behavioral
contract from B1–B7 may change.

RUN THE PASS:
- Invoke taste-skill AND impeccable-design-and-taste over /invite/accept and /settings/team (SeatMeter,
  InviteMemberForm, MemberList/MemberRow, the remove dialog, the invalid-invite card). If
  impeccable-design-and-taste is not invokable in this CC stack (as in Session 19), apply its postures
  from the B5/B6/B7 DESIGN POSTURE blocks instead; still run the taste-skill pass.
TARGETS (inherit Session 20's bar): CVD-safe status/role badges (shape + label, never colour-only);
  seat-meter as a quiet confident focal, correct at Normal/Unlimited/At-cap/Overage; the invalid-invite
  state neutral (18B tone); full keyboard operability + correct ARIA (dialog/tooltip/live-region);
  WCAG-AA contrast; empty/at-cap/overage states all read correctly; the accept arrival feels intentional
  and safe. Manual check via npm run dev.

WORKFLOW: run the pass, then /ecc:verification-loop to confirm NO behavioral regression (lint, typecheck,
scoped vitest).
BOUNDARY: visual + a11y only. If a taste fix needs a logic/contract change, SURFACE it — don't silently
alter B1–B7.
When the pass is done and verification is clean, output exactly:
"21B-B8 complete. 21B ready for Reviewer (§3)." Then stop.
```

**Verification (every 21B step):**
```
npx tsc --noEmit --skipLibCheck
npx vitest run lib/db lib/members lib/email "app/[locale]/(dashboard)/settings/team" "app/[locale]/invite" "app/[locale]/(auth)" app/api/social
# RLS/RPC/policy constraints (RES-BIZ-SELECT-WIDEN, INV-REISSUE-SAME-ROW, SEAT-*): CI Supabase stack — executed green.
```

---

## §2C — Builder session · 21C (paste into Claude Code · Sonnet — **only after 21B is merged + corrected**)

21C depends on 21B's resolver (§2) and gate echo (§6). Two steps: build the inbox, then its taste/a11y
pass. Same hard rules and ECC cycle as 21B. Adds **no** new authorization — it is a faster lane to the
existing approve path (`enforce_post_transition_capability` already gates `→approved`).

### §2C-a — Builder primer (paste first · wait for acknowledgement)

```
Session 21C — approver quick-approve inbox, BUILDER phase. 21B is merged. You transcribe ADR 0014 §9.
Read: ADR 0014 §9 + §12 (design direction); the existing approve/skip/bulk Server Actions in
app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts; the pending-draft read in lib/db/posts.ts;
DashboardShell (the gated Approvals nav item shipped inert in 21B/B7). Invoke ECC build posture.
Do NOT write code yet: confirm (1) the exact names of the approve/bulk-approve/skip actions you will
reuse UNCHANGED, (2) the posts query you will filter to status='draft' (bounded), (3) that the
Approvals nav item exists in DashboardShell awaiting activation. Then "Ready for C1." Then stop.
```

### §2C-b — Builder steps (21C)

#### C1 — Approvals inbox · ADR §9  ·  UI (impeccable + taste)
```
BUILDER — 21C · C1. Transcribe ADR 0014 §9. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- app/[locale]/(dashboard)/approvals/page.tsx: server guard visible to approve-capable members
  (approver) AND admins; non-approver-non-admin redirected (ROLE-APPROVALS-GATED).
- Data path (§9.2): read pending drafts via the EXISTING lib/db/posts.ts query, filtered status='draft'
  (draft = the pending set — confirmed), scoped to the resolved business, LIMIT + explicit ORDER BY
  (paginate/virtualize). No new query surface that could diverge from the calendar's "pending".
- Affordances (§9.3): filters (by campaign, by channel); a bulk bar [Approve selected] → the EXISTING
  bulkApprovePostsAction; DraftRow with single Approve → approvePostAction, Reject/Skip → skipPostAction.
  Edit is a SEPARATE step — after editing, the row stays and must be Approved explicitly (edit-then-
  approve is two steps; the inbox never silently approves an edited post — L-5/C-1).
- i18n/{en,pt,es}/approvals.json. Activate the Approvals nav link in DashboardShell (approver+admin).

DESIGN POSTURE (impeccable + taste, gated): a fast TRIAGE lane — scannable rows, obvious primary action
(Approve), keyboard-first (approve/skip without leaving the keyboard), legible batch selection. The
edit→draft→approve two-step must be VISIBLE, not hidden. Empty state = "No posts waiting for approval."
— a positive, finished feeling, not an error. WCAG-AA, correct ARIA, CVD-safe badges.

TESTS (TDD): ROLE-APPROVALS-GATED (guard redirects the uncapable); APV-SINGLE-AND-BATCH / -EDIT-REVERT-
LEGIBLE / -REJECT-SKIP (wired to the existing actions; edit is a separate step); APV-EMPTY-STATE /
-FILTER / -PAGINATED (empty copy; filters; bounded query).

BOUNDARY: wires EXISTING actions — no new authorization, no change to the approve path.
On green + commit, output "C1 complete — approvals inbox." Then stop.
```

#### C2 — 21C taste & a11y pass (impeccable-design-and-taste + taste-skill)
```
BUILDER — 21C · C2. Design/taste + a11y pass over the Approvals inbox. Visual + a11y ONLY — no
behavioral change from C1. Invoke taste-skill AND impeccable-design-and-taste (fallback: apply the C1
DESIGN POSTURE if not invokable). Targets: scannable triage rhythm; obvious Approve; keyboard-first
approve/skip + batch; visible edit→approve two-step; positive empty state; WCAG-AA + ARIA. Then
/ecc:verification-loop (no regression). SURFACE any taste fix needing a logic change.
Output exactly: "21C-C2 complete. 21C ready for Reviewer (§3)." Then stop.
```

## §3 — Reviewer session · 21B (paste into Claude Code · Opus)

Run **only after** B1–B8 are committed and the suite is green — with the RLS/RPC constraints **executed
against the CI Supabase stack**. The Reviewer is independent (did not write the code) and **modifies
nothing**; its output is a review document. Paste the primer (§3a) first: it forces **test-execution
reality** before the audit, because on this feature "covered" has already once meant "authored," and an
unrun policy test is exactly where a read-widening bug hides — and 21B *widens a read policy*.

`impeccable-design-and-taste` is **OFF** for the Reviewer (it audits taste, does not apply it).

**The two highest-risk things in 21B, which the audit is built around:**
1. **B1's RLS delta** — the one policy body 0014 permits. If it over-widens, every business row leaks.
2. **B2's redirect scoping** — the member-lockout fix. A regression here locks members out on *every*
   login, or drags them into the owner's onboarding wizard.

### §3a — Reviewer primer (paste first · wait for acknowledgement)

```
Sessions 21B — Seats & Permissions: Flow & Surface, REVIEWER phase. You are an INDEPENDENT reviewer: you
did NOT write this code and you will NOT modify any file. Your output is a review document only.

Read now:
- docs/decisions/0014-seats-and-permissions-surface.md — the whole ADR. Its §10 named constraints
  (RES-*, INV-*, UI-*, SEAT-*, ROLE-*) are your acceptance checklist. §11 is the file manifest.
- docs/decisions/0013-seats-and-permissions.md (Rev B) — the locked model beneath it (user_can,
  accept_invite, enforce_seat_cap, the primary-admin trigger). 21B must not have altered it.
- CLAUDE.md — the hard rules and the three Supabase client roles.
- The full 21B diff (commit range B1→B8), the businesses_select_membership migration, and every *.test
  file added this session.

Invoke the `security-reviewer` AND `database-reviewer` ECC agents. Do NOT invoke
impeccable-design-and-taste (you audit the taste pass, you do not run it).

Before you review anything, ESTABLISH TEST-EXECUTION REALITY and report it — this is the gate:
(1) Confirm the policy/RPC-behaviour tests (RES-BIZ-SELECT-WIDEN, INV-REISSUE-SAME-ROW,
    SEAT-INVITE-FAILFAST-ECHO, SEAT-OVERAGE-LOCK-UX) ACTUALLY EXECUTED against a real Postgres+RLS
    (the CI Supabase stack) and are GREEN — not authored-only, not mock-client, not
    pg_policies-metadata-only. State the target and point to the passing run.
(2) Confirm the businesses_select_membership migration applies forward on a FRESH DB (clean-room replay)
    with the full 21A chain, and that businesses_select_own's new body is the ONLY policy body changed in
    this diff (grep the migration for any other CREATE/DROP POLICY).
(3) List which §10 constraints have an EXECUTED passing test vs which rest on diff-inspection only.

If (1) or (2) cannot be confirmed, STOP and say so — do not proceed to a code-only review of a widened
read policy that has never run. Otherwise output the three findings and "Ready to review 21B." Then wait.
```

### §3b — Reviewer prompt (paste after acknowledgement)

```
REVIEWER — Session 21B. Audit the 21B diff section-by-section against ADR 0014. Where you can, RE-DERIVE
the adversarial check yourself (write the query, reason the outcome) rather than trust a test's name.
Tier every finding BLOCKER / MAJOR / MINOR / NIT.

SECTION A — THE RLS DELTA  (ADR §2.1 · RES-BIZ-SELECT-WIDEN · the single highest-blast-radius change)
A1. businesses_select_own is SELECT-only, TO authenticated, USING (id = ANY(SELECT unnest(
    get_user_business_ids())) AND deleted_at IS NULL). Confirm the INSERT/UPDATE/DELETE policies on
    businesses were NOT touched and remain owner_id-scoped (a widened WRITE policy is a BLOCKER).
A2. RE-DERIVE the read matrix on businesses with a RAW authenticated (anon-key) client — not a Server
    Action: owner sees own row; ACTIVE member sees the row; INVITED (user_id NULL) sees NOTHING; REVOKED
    sees NOTHING; cross-tenant member sees NOTHING; member of a soft-deleted business sees NOTHING. Any
    leak is a BLOCKER.
A3. No recursion: get_user_business_ids is SECURITY DEFINER + STABLE, so the businesses policy calling it
    does not re-enter RLS. Prove a query on businesses under an active member returns without error.
A4. Confirm the B1 grep for OTHER parent tables with the same owner_id-only SELECT asymmetry was run and
    reported. An unreported second asymmetric table is a MAJOR (a member is still 404ing somewhere).

SECTION B — RESOLVER & THE MEMBER LOCKOUT  (ADR §2.2, §2.4 · RES-* )
B1. getBusinessForUser: ONE RLS-scoped SELECT; deterministic pick (preferred-if-visible → owned →
    earliest → null). Non-deterministic ordering (no explicit ORDER BY) is a MAJOR — it makes a member's
    "current business" flap between requests.
B2. RES-SEAM-PARAM-ONLY: the multi-business seam is a PARAMETER, no schema column, no switcher UI shipped.
B3. RES-CALLER-MIGRATION: no production dashboard path still calls getBusinessByOwner (grep it yourself);
    the only survivors are the owner-only service paths ADR §2.4 explicitly keeps. A missed dashboard
    caller = a member still 404s = BLOCKER.
B4. THE LOCKOUT FIX (RES-LOGIN-MEMBER-NO-LOCKOUT, RES-ONBOARDING-OWNER-SCOPED) — re-derive both sites:
    login/actions.ts redirect order is redirectTo → !business → (owner && !onboarding_completed) →
    else /campaigns; AND layout.tsx's !onboarding_completed guard is owner-scoped. Prove: a pure member
    (owns nothing) logging in lands in /campaigns, never /onboarding, on EVERY login; and a member whose
    owner has NOT completed onboarding is not bounced into the owner's wizard. Either failing = BLOCKER.
B5. RES-NO-MIDDLEWARE: proxy.ts does no business/role resolution (auth-session + route-gating only).

SECTION C — CONNECT/DISCONNECT GATE  (ADR §7 · ROLE-CONNECT-APPLAYER-GATE, ROLE-DISCONNECT-APPLAYER-GATE)
C1. Both route handlers call user_can(business_id,'connect_accounts') under the AUTHENTICATED client
    BEFORE any service-role work. A gate evaluated with the service-role client (auth.uid() NULL) would
    silently pass everyone — check the client used. That is a BLOCKER.
C2. A viewer/editor is blocked (redirect ?error=forbidden / 403); an approver or admin passes. Failure
    shapes match each route's existing convention.
C3. No OTHER user-facing path acquired a service-role client in this diff (RLS-NO-SERVICE-IN-USER-PATH).

SECTION D — INVITE EMAIL & ACCEPT  (ADR §3, §4 · INV-*)
D1. INV-NO-TOKEN-IN-LOGS: the enqueue log emits only {kind, email_kind, business_id, locale, outcome} —
    no token, no acceptUrl, no recipient address. A token in a log line is a BLOCKER (it is a bearer
    credential to join a business).
D2. INV-TOKEN-VERIFY-APPSIDE: tampered/expired signatures are rejected before accept_invite is called.
D3. INV-ACCEPT-ANTI-ENUM: mismatch / expired / consumed / revoked / unknown ALL collapse to ONE neutral
    message with no distinguishing hint (copy, status code, AND timing shape). A branch that reveals
    "this invite was for someone else" is a MAJOR (18B posture regression).
D4. INV-SIGNUP-EMAIL-LOCKED: the signup gate pre-fills AND locks the invited email — re-derive that a
    user cannot edit it client-side to bind a different address (the DB email-match is the real boundary;
    confirm it still backs this).
D5. EMAIL CONFIRMATION PRESERVED — the deliberate call: confirm the invited-user signup still requires
    email confirmation and the Builder did NOT weaken/skip it to make the token round-trip easier. If
    confirmation was bypassed for invitees, that is a BLOCKER: it re-opens the forwarded-link hole
    (email-match alone does not stop a forwarder from creating the account).
D6. INV-REISSUE-SAME-ROW: resend re-issues a fresh token on the SAME reserved row (new exp, new
    dedupe_token) — no second row (would double-count the seat and trip the
    (business_id, lower(email)) partial unique index), and the resend actually sends (dedupe not
    swallowing it).
D7. INV-3-LOCALE: team-invite renders in en/pt/es; roleLabelKey is an i18n key, not a raw role string.

SECTION E — TEAM SURFACE, SEATS, OVERAGE  (ADR §5, §5.4, §8 · UI-*, SEAT-*, ROLE-TEAM-ADMIN-GATED)
E1. ROLE-TEAM-ADMIN-GATED: /settings/team is server-guarded by user_can('manage_members') — a
    non-admin is redirected, not merely hidden. A client-only gate here is a MAJOR.
E2. SEAT-INVITE-FAILFAST-ECHO: checkInviteAllowed fail-fasts BEFORE insert, AND the DB enforce_seat_cap
    trigger still rejects an over-cap raw INSERT (the app check is an echo, never the boundary — L-3).
    Prove the trigger with a raw anon client.
E3. SEAT-METER-COPY / SEAT-OVERAGE-CTA-DISTINCT: all four states (Normal / Unlimited / At-cap /
    Overage-locked) render with the ADR's copy, and the overage CTA is member-removal + portal — NOT
    "upgrade" (they are already mid-downgrade; an upgrade CTA misdirects). Same-CTA-for-both = MAJOR.
E4. SEAT-OVERAGE-LOCK-UX: while overage > 0, new invites are blocked while revoke/remove and all content
    ops stay allowed (locking content would be a product-breaking overreach).
E5. UI-REMOVE-SOFT: removal sets status='revoked' — NO hard DELETE anywhere (there is no DELETE policy;
    a raw delete attempt must fail). UI-ROLE-CONFIRM: role change confirms; remove uses an explicit
    dialog naming the subject.
E6. The primary-admin trigger still blocks demoting/revoking the owner row through the NEW UI path
    (re-derive: attempt it via the Server Action).
E7. Work-email rule applied to invited addresses, consistent with signup.
E8. SEAT-NO-STRIPE: no Stripe schema/webhook/checkout change in this diff — messaging only.

SECTION F — CAPABILITY RETROFIT  (ADR §6 · UI-AFFORDANCE-MAP, UI-APPROVE-DISABLED-EDITOR)
F1. The affordance map matches §6 per role×surface: HIDE by default; DISABLE-with-tooltip for the
    editor's Approve. Viewer is clean read-only.
F2. CRITICAL FRAMING: these are ECHOES (L-3). Confirm NO authorization decision now depends on a hidden
    control — the DB still denies every gated write. Spot-prove one: a viewer calling the approve Server
    Action DIRECTLY (bypassing the hidden button) is still denied by the DB trigger. If hiding the button
    is the only thing stopping them, that is a BLOCKER.
F3. Nav gating (Billing/Team admin-only; Approvals shipped gated + inert until 21C).

SECTION G — TASTE & A11Y PASS  (B8 · ADR §12)
G1. B8 changed visuals/a11y ONLY — no behavioral contract from B1–B7 altered (diff-check it).
G2. Session 20's bar holds on the new surfaces: status/role badges are NOT colour-only (shape + label);
    WCAG-AA contrast; dialog/tooltip/live-region ARIA correct; full keyboard operability; the
    invalid-invite state is neutral in tone (18B), not alarming.
G3. i18n: every new user-facing string in en/pt/es — no hardcoded English (grep the new .tsx).

SECTION H — HYGIENE & SCOPE
H1. Hard rules: env via lib/config.ts; DB via lib/db/; formatISO; no `any`; no `console.*`; every new
    list query has LIMIT + explicit ORDER BY (an unbounded member/draft list is a MINOR→MAJOR at scale).
H2. Scope: no 0013 model change (no user_can/accept_invite/trigger edits); ADR §11 manifest matches the
    diff — flag files touched that the manifest does not list, and manifest files never delivered.

SECTION I — CONSTRAINT COVERAGE AUDIT  (the §10 checklist)
I1. Every §10 constraint (21B rows) maps to an EXECUTED passing test OR is explicitly a diff-verified
    design constraint. Anything RLS/RPC/policy-touching that rests on an authored-but-unrun test is a
    MAJOR — "covered" means executed green.
I2. A security-relevant uncovered constraint (RES-BIZ-SELECT-WIDEN, the connect gate, the accept guards,
    the seat cap) is a BLOCKER.

OUTPUT: docs/reviews/0014-21b-surface-review.md —
- A table: Section / Check / Status (✅/❌/⚠️) / File:Line / Fix.
- Then every BLOCKER with an exact fix instruction, then MAJOR, then MINOR, then NIT.
- A VERDICT section: blockers before merge · blockers before 21C can build on this · tech-debt
  acceptable to defer.
Do NOT modify any code. Do NOT write the correction prompts — those come from claude.ai after this report.
```

---

## §3C — Reviewer session · 21C (paste into Claude Code · Opus)

Run after C1–C2 are committed and green. Much lighter than 21B: 21C introduces **no new authorization**
and **no new DB surface** — it wires *existing* actions behind an existing gate. The audit therefore
concentrates on exactly that claim ("nothing new was authorized") plus the correctness of the approval
loop it exposes. `impeccable-design-and-taste` **OFF**.

### §3C-a — Reviewer primer (paste first · wait for acknowledgement)

```
Session 21C — approver quick-approve inbox, REVIEWER phase. You are an INDEPENDENT reviewer: you did NOT
write this code and you will NOT modify any file. Output is a review document only.

Read: docs/decisions/0014-seats-and-permissions-surface.md §9 + §10 (APV-*, ROLE-APPROVALS-GATED) and
§12; ADR 0012 (the edit-reverts-to-draft rule); the campaigns/[id]/posts/actions.ts approve/skip/bulk
actions; the full 21C diff. Invoke the `security-reviewer` ECC agent.

Before reviewing, establish and report:
(1) Whether the 21C diff calls the EXISTING approve/skip/bulk Server Actions UNCHANGED, or introduced any
    new write path to post status. A new write path is the thing this session was designed NOT to create.
(2) Whether any DB object (policy, RPC, trigger, migration) was added or edited in 21C. Expected: none.
(3) Which APV-*/ROLE-* constraints have an EXECUTED passing test.
Then output those three and "Ready to review 21C." Then wait.
```

### §3C-b — Reviewer prompt (paste after acknowledgement)

```
REVIEWER — Session 21C. Audit the 21C diff against ADR 0014 §9. Tier findings BLOCKER/MAJOR/MINOR/NIT.

SECTION A — NO NEW AUTHORIZATION  (the core claim of 21C)
A1. The inbox calls the EXISTING approve/bulk-approve/skip actions unchanged. Any new status-write path
    (a fresh Server Action, a direct client update, a service-role call) is a BLOCKER — the approve
    boundary must stay exactly one code path, DB-gated by enforce_post_transition_capability.
A2. Zero DB objects added/edited in this diff.
A3. ROLE-APPROVALS-GATED: the route is SERVER-guarded (approver-capable OR admin); a non-approver is
    redirected, not merely nav-hidden. Re-derive: an editor hitting /approvals directly is redirected;
    and even if they weren't, the DB still denies their approve (spot-prove the trigger still holds).

SECTION B — THE APPROVAL LOOP  (APV-* · ADR §9.3 · ADR 0012)
B1. APV-SINGLE-AND-BATCH: single Approve and batch [Approve selected] both route to the existing actions;
    batch is not a client-side loop that swallows partial failures — a failed row in a batch must surface,
    not silently drop (silent partial failure is a MAJOR: the approver believes posts are approved).
B2. APV-EDIT-REVERT-LEGIBLE: editing is a SEPARATE step; after an edit the post is draft again and must be
    APPROVED EXPLICITLY. Prove the inbox cannot silently approve an edited post (that would defeat ADR
    0012's human-in-the-loop revert — BLOCKER).
B3. APV-REJECT-SKIP wired to the existing skip action.
B4. APV-DATA-PATH: the pending set is read via the EXISTING posts query filtered status='draft', scoped to
    the resolved business — no second, divergent "pending" definition that could drift from the calendar's.

SECTION C — SCALE, STATE, SURFACE  (§9.3, §9.5)
C1. APV-PAGINATED: bounded query (LIMIT + explicit ORDER BY) — an unbounded draft list is a MAJOR.
C2. APV-FILTER: campaign + channel filters work and compose.
C3. APV-EMPTY-STATE: "No posts waiting for approval" — positive/finished, not an error.
C4. The calendar/campaign approve affordances still work — 21C COMPLEMENTS, it does not replace (§9.5).

SECTION D — TASTE, A11Y, HYGIENE  (C2 · ADR §12)
D1. C2 changed visuals/a11y only; no behavioral change from C1.
D2. Keyboard-first triage (approve/skip/batch-select operable without a mouse); ARIA correct; WCAG-AA;
    CVD-safe badges; the edit→approve two-step is VISIBLE.
D3. i18n en/pt/es complete (approvals.json); no hardcoded English.
D4. Hard rules: no `any`, no `console.*`, DB via lib/db/, no service-role in the user path.

SECTION E — CONSTRAINT COVERAGE
E1. Every §10 21C constraint (APV-*, ROLE-APPROVALS-GATED) maps to an EXECUTED passing test; a
    security-relevant gap (the route guard, the edit-revert) is a BLOCKER.

OUTPUT: docs/reviews/0014-21c-approvals-review.md — same shape as the 21B report (table; BLOCKER →
MAJOR → MINOR → NIT with exact fixes; VERDICT: blockers before merge · tech-debt to defer).
Do NOT modify any code. Do NOT write the correction prompts.
```

## §4 — Correction pass · 21B (paste into Claude Code · Opus)

Run against the Reviewer report (`docs/reviews/0014-21b-surface-review.md`). **Verdict: zero BLOCKERs** —
no security boundary is defended by UI alone; the one RLS delta is SELECT-only and correct; the read
matrix and the member-lockout fix both survived independent re-derivation. This pass is therefore
**hygiene + one real UX loop**, not a rescue. Correction passes are normal, not failures.

**Two adjudications made here (encoded in the prompts below):**

1. **M1 → fix as INERT.** The reviewer offers "inert, flag, or land with 21C." Since **21C is a separate
   session** in this plan, 21B may well merge alone — so the Approvals entry ships **inert**
   (`COMING_SOON_NAV` pattern) and **C1 activates it**. Safe under either outcome: if 21B and 21C end up
   shipping as one unit, C1 flips it live regardless. (An amendment to §2C/C1 is included below.)
2. **n3 → ELEVATED from NIT to a real fix.** The reviewer scoped it as "depends on the Supabase
   confirmation setting" — but we **deliberately keep email confirmation ON for invitees** (it is the
   guard against a *forwarded* accept link; email-match alone doesn't stop a forwarder creating the
   account). So the bounce is real, not hypothetical: `signup/actions.ts:139` → `/invite/accept?token=`
   with no session yet → `accept/actions.ts:40` bounces back to `/signup?token=`. That is a **loop on the
   invitee's very first impression of SŌSH**. D3 verifies the live setting first, then fixes.

**Deferred by decision (do NOT fix in this pass):** n4 (per-request memo — single indexed query, premature);
the **pre-existing roster read** (any co-member can read the member roster via the API — that is the *locked
0013 model*, not a 21B defect; if you want it changed it is a 0013 revision, not a correction).

**Out of code scope — own task (backlog, not this pass):** the CI Postgres **OOM/recovery crash** on the
2-core runner. The security suites *did* pass when the DB stayed up, but until the stack survives a full
run, "executed green" is not reproducible on demand and the DB suite cannot be trusted as a *merge gate*.
This must be hardened before it is relied on as one — file it, don't bury it in 21B.

### §4a — Correction primer (paste first · wait for acknowledgement)

```
Session 21B — CORRECTION pass. An independent Reviewer audited the 21B diff against ADR 0014 and found
ZERO BLOCKERS. You are fixing one MAJOR, four MINORs, and two NITs — plus one NIT the founder elevated.
You are NOT re-opening the design: ADR 0014 and ADR 0013 Rev B are both locked.

Read now:
- docs/reviews/0014-21b-surface-review.md — the whole report. Findings M1, m1–m4, n1–n3 are your worklist.
- docs/decisions/0014-seats-and-permissions-surface.md — §5.3 (the "capability-echoed" claim m2 says is
  unmet), §11 (the manifest n1 says is incomplete + stale), §9.5/§11 (Approvals ships in 21C — the basis
  of M1).
- CLAUDE.md — the formatISO rule (m1/n2) and the list-query LIMIT rule (m3).

Invoke ECC in build posture (/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop per step). Do NOT
invoke impeccable-design-and-taste except where D3 touches the interstitial copy/layout.

Do NOT write code yet. First establish the one fact D3 depends on (getting this wrong wastes the step):
(1) Is Supabase email confirmation ACTUALLY ON for this project (signup returns no session until the user
    confirms)? Check the Supabase project auth settings / config.toml, and confirm what signUp returns
    today. SŌSH keeps confirmation ON for invitees deliberately — do NOT propose turning it off.
(2) Confirm DashboardShell's COMING_SOON_NAV renders inert <span>s (the pattern D1 will reuse) and that
    app/[locale]/(dashboard)/approvals/ is genuinely absent from the 21B tree.
(3) List the current production callers of getBusinessByOwner (expected: none).
Then output those three findings and "Ready for D1." Then stop.
```

### §4b — Correction steps (21B)

#### D1 — ~~M1: Approvals nav ships inert until 21C~~  ·  **WITHDRAWN — DO NOT RUN**

> **21B/M1 was withdrawn by the 21C reviewer.** The finding was derived from reading `DashboardShell.tsx`
> at **HEAD** (which already contained 21C's activation), not at the 21B commit `c07dafda` — where the
> Approvals entry *was* correctly an inert `<span title=coming_soon>`, exactly as the ADR required. The
> live `<Link>` was introduced in **21C**, where `/approvals` exists. There was never a 404 window.
>
> **DO NOT RUN D1.** Running it now would revert the nav to inert *after* 21C activated it, breaking the
> live link. The only residual is comment rot, which is fixed as **C-n1 in §4C/E2**.
>
> **Lesson (fold into future Reviewer primers):** a reviewer reading files at HEAD instead of at the
> stated commit range will produce confident, well-argued, wrong findings. The §3 primers already pin a
> commit range — they should also say *"read every file AT that range, not at HEAD."*
>
> The original D1 prompt is retained below, struck, for the record only.

```
[WITHDRAWN — DO NOT PASTE. Retained for audit trail only.]
BUILDER — 21B · D1 (correction). Fix M1. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

PROBLEM: DashboardShell.tsx:156-169 renders a LIVE <Link href="/approvals"> gated on canApprove, but
app/[locale]/(dashboard)/approvals/ does not exist in 21B (it ships in 21C per ADR §9.5/§11). Merging 21B
alone → an approver or admin clicks "Approvals" → 404. The adjacent comment (:47-48) claims the entry is
"gated and inert, matching COMING_SOON_NAV" — it is not; COMING_SOON_NAV renders inert <span>s (:142-154).

DECISION (founder-adjudicated — do not re-litigate): ship the Approvals entry INERT now, exactly like
COMING_SOON_NAV, and let 21C/C1 activate it. Do NOT create a stub /approvals route to satisfy the link.

BUILD:
- Render the Approvals entry with the COMING_SOON_NAV inert treatment (same <span> shape, same disabled
  affordance), STILL gated on canApprove (approver || isAdmin) so the capability echo is already correct
  when C1 flips it live.
- Correct the :47-48 comment to describe what actually ships ("inert until 21C/C1 activates the route").

TESTS (TDD): a non-navigable-until-21C test — for an approver AND an admin, the Approvals entry renders
but is NOT a navigable link (no href / inert span); for viewer/editor it does not render at all.

BOUNDARY: nav rendering + comment only. No route creation, no capability change.
On green + commit, output "D1 complete — Approvals nav inert until 21C." Then stop.
```

#### D2 — m1/m2/m3/m4/n2: hygiene + the missing capability echo  ·  review m1–m4, n2
```
BUILDER — 21B · D2 (correction). Fix m1, m2, m3, m4, n2 in one step (all small, all independent).
Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

m1 — lib/db/business-members.ts:140 (reissueInvite) uses new Date().toISOString(). CLAUDE.md forbids it:
     use formatISO(new Date()). Behaviour identical; style/convention only.
n2 — components/.../MemberList.tsx:32-34 (isExpiredInvite) does client-side epoch math
     (new Date(x).getTime() / Date.now()). Same class as m1 — move to date-fns (e.g. isAfter/isBefore).
     Display-only; do not change the expiry SEMANTICS (the DB remains the boundary).
m3 — lib/db/businesses.ts:41-46 (getBusinessForUser) has no .limit(). RLS already bounds it to the
     caller's own businesses and ORDER BY is present, so this is convention not DoS — add .limit(50).
     Do NOT change the deterministic pick order (preferred → owned → earliest → null).
m2 — app/[locale]/(dashboard)/settings/team/actions.ts: invite/change-role/revoke/resend have NO
     app-layer capability echo — they lean entirely on the page guard + DB RLS. The DB DOES deny a forged
     non-admin POST (business_members_insert/_update gate on user_can('manage_members') → 0 rows → error),
     so this is a defense-in-depth + UX gap, NOT a hole. But ADR §5.3 describes these actions as
     "capability-echoed", so code and ADR currently disagree. Add a canServer('manage_members') pre-check
     to all four actions, returning the typed ActionState denial instead of an opaque failure.
     CRITICAL FRAMING (L-3): this echo is UX, NOT the security boundary. Do not weaken, bypass, or
     "optimize away" any DB check on the strength of it.
m4 — lib/db/businesses.ts:22 getBusinessByOwner now has ZERO production callers (the Stripe/service paths
     use findBusinessByStripeCustomerId / updateBusinessPlan directly). The caller-migration test comment
     claiming it "stays exported for owner-only service paths" is false. REMOVE the export and its unit
     test, and correct that comment. (If your grep finds a real remaining caller, STOP and report instead
     of deleting.)

TESTS (TDD): m2 — a non-admin calling each of the four team actions directly gets the TYPED denial (and
the DB still denies independently — do not replace the DB assertion with the echo assertion). m3 — the
resolver's pick order is unchanged with the limit applied. m4 — the caller-migration grep-guard still
passes with the export removed.

BOUNDARY: no behavioral change to the DB boundary; no ADR contract change.
On green + commit, output "D2 complete — hygiene + team-action capability echoes." Then stop.
```

#### D3 — n3 (ELEVATED): the invite-signup confirmation bounce  ·  review n3
```
BUILDER — 21B · D3 (correction). Fix n3 — elevated from NIT by the founder, because SŌSH keeps email
confirmation ON for invitees DELIBERATELY (it is what stops a FORWARDED accept link from letting a third
party create the account; the DB email-match alone does not). Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

STEP ZERO (gate — from the primer): confirm email confirmation is ACTUALLY ON (signUp returns no session).
- If it is ON → the bug is real; build the fix below.
- If it is OFF → STOP and report. Do not "fix" a phantom, and do NOT turn confirmation off to make the
  flow simpler — that re-opens the forwarded-link hole and is a hard NO.

PROBLEM (when confirmation is ON): signup/actions.ts:139 redirects to /invite/accept?token=… immediately
after auth.signUp. No session exists yet, so accept/actions.ts:40 bounces the user back to
/signup?token=… — the invitee lands in a loop on their FIRST impression of SŌSH.

BUILD:
- After signUp in the INVITE flow, do not redirect into /invite/accept. Send the invitee to a
  "check your email" INTERSTITIAL that (a) names the invited address, (b) explains the confirmation step
  is what keeps the invite secure, (c) offers resend-confirmation, and (d) preserves the invite token
  across the confirmation bounce (via emailRedirectTo, per the B5 spike; a signed httpOnly cookie is the
  fallback if the redirect cannot carry it).
- On returning from the confirmation link with a session, the accept flow proceeds as designed
  (accept_invite → land in the business). The non-invite signup flow is UNCHANGED.
- i18n en/pt/es for all new copy.

DESIGN POSTURE (impeccable + taste, gated — this is the invitee's first impression): calm, single-purpose,
reassuring. Not an error state — a normal, expected step. Reuse the /invite/accept arrival's visual
language so the flow feels continuous. WCAG-AA, keyboard-operable, correct ARIA.

TESTS (TDD): INV-SIGNUP-NO-BOUNCE — an invited NEW user completing signup lands on the interstitial, NOT
in a /signup ⇄ /invite/accept loop; the token survives the confirmation round-trip and accept then
succeeds. Confirm the existing INV-SIGNUP-EMAIL-LOCKED and the DB email-match still hold (do not regress
B5).

BOUNDARY: the invite-signup path only. Do NOT weaken email confirmation. Do NOT touch accept_invite.
On green + commit, output "D3 complete — invite-signup confirmation interstitial." Then stop.
```

#### D4 — n1: ADR §11 manifest reconciliation + docs  ·  review n1
```
BUILDER — 21B · D4 (correction). Fix n1 (documentation only — no code).

- ADR 0014 §11 manifest: ADD the files the 21B diff legitimately touched under §6 but the manifest omits —
  components/ui/tooltip.tsx (NEW), components/campaigns/CampaignCard.tsx,
  components/social/PlatformConnectionCard.tsx, lib/contexts/business-context.tsx,
  lib/members/{useCan,invite-preview}.ts, lib/db/types.ts.
- ADR 0014 §11 / §2.1: CORRECT the stale line claiming a NEW 21B migration
  (…_businesses_select_membership.sql). That widening actually shipped in 21A (ef6b3bf8, an in-place edit
  of 20260430120017_fix_rls_function_caching.sql); 21B correctly re-shipped nothing. Mark it as
  "delivered in 21A" so no future reader hunts for a migration that does not exist.
- Note in §11 that the Approvals nav entry shipped INERT in 21B (as designed) and is ACTIVATED by 21C/C1.
  (Do NOT re-inert it — 21B/M1 was withdrawn; see D1.)

BOUNDARY: docs only. No code, no test, no ADR DECISION change — this is manifest/reality reconciliation.
On green (lint/build clean), output "D4 complete — ADR 0014 manifest reconciled. 21B correction done."
Then stop.
```

#### ~~Amendment to §2C/C1 (21C Builder)~~ — **already delivered; no action**

> C1 shipped the nav activation (inert `<span>` → live `<Link href="/approvals">`, gate unchanged).
> Nothing to carry forward. The only leftover is the stale export-area comment → **§4C/E2 (C-n1)**.

**Verification (21B correction):**
```
npx tsc --noEmit --skipLibCheck
npx vitest run lib/db lib/members lib/email "app/[locale]/(dashboard)/settings/team" "app/[locale]/invite" "app/[locale]/(auth)" components
# No new RLS/RPC constraints in this pass — the DB boundary is untouched. Re-run the existing DB suite
# only to confirm no regression (and see the CI OOM caveat below before trusting a red run).
```

### §4c — Follow-ups NOT in this pass (file them, don't bury them)

| Item | Disposition |
|---|---|
| **CI Postgres OOM / recovery crash** (2-core runner; `[analytics] enabled=false` did not resolve it) | **Own hardening task — do before the DB suite is trusted as a merge gate.** The security suites passed when the DB stayed up, but "executed green" must be reproducible on demand or the gate is theatre. |
| m2 residual — live end-to-end "viewer hits /connect → blocked" test (route gate is currently mock-tested; `user_can` itself is live-tested) | Backlog. Composition is sound; not a BLOCKER. |
| n4 — per-request memo for repeated `getBusinessForUser` calls | Deferred. Single indexed query per call; premature optimization. |
| **Member-roster read visibility** — any co-member (viewer/editor) can read the roster (emails/roles) via the API, though `/settings/team` is admin-gated | **Not a 21B defect — this is the locked ADR 0013 model.** If you want it narrowed, that is a 0013 revision (a model change), not a correction pass. Flagging it as a product decision, not a bug. |

## §4C — Correction pass · 21C (paste into Claude Code · Opus)

Run against `docs/reviews/0014-21c-approvals-review.md`. **Verdict: zero BLOCKERs.** 21C's central claim
held under re-derivation: no new write path, no new DB object, the approve boundary is still the single
DB-gated `enforce_post_transition_capability` transition, and batch approve is one atomic UPDATE (no
silent partial failure). The route guard is server-side and the DB denies regardless.

**But M1 is the most important finding of the whole session, and it is not an authorization bug.**
Bulk "Approve all" ignores the active **platform filter**: the DB approves *every* draft in the campaign,
while the button label counts only the filtered rows. Filter to X, see *"Approve all (2)"*, click →
**5 posts approve**, including 3 LinkedIn drafts the approver filtered out and **never read** — and the
live region then announces "5 approved." Authorization is intact (an approver is allowed to approve all
five), which is exactly why no gate caught it. What it breaks is **human-in-the-loop itself** — the
product's core promise. A control that says 2 and does 5 is worse than no control. **Fix before merge.**

**Adjudications encoded below:**

1. **M1 → fix (a): disable per-campaign bulk while a platform filter is active**, and make label /
   removal / announcement all read from one set. The reviewer's (b) — loop `approvePostAction` over
   visible rows — is rejected: it trades one atomic all-or-nothing UPDATE for N round-trips with real
   partial-failure states, re-introducing precisely the silent-partial-approve class that B1 proved
   *absent*. (The genuinely better long-term fix — an optional `platform` predicate on
   `bulkApproveDraftPosts`, preserving atomicity — touches a write path shared with the campaigns
   surface, so it is a **backlog** item, not a correction.)
2. **m2 (contrast) → fix now, not deferred.** The reviewer lists it as deferrable tech-debt; it is a
   miss against an **explicit bar we set** (Session 20 / §12 WCAG-AA). 1.7:1 is not a near-miss. It's a
   one-token change.
3. **m1 (pagination) → defer, with an overflow signal added now.** Real pagination is over-engineering at
   launch caps (trial/Plus ≈50 posts/mo vs a LIMIT of 200). But *silently* hiding drafts past the 200th
   is unacceptable — a cheap "showing 200 of N" honesty signal ships now; real pagination goes to backlog.
4. **n2 (C1/C2 squashed) → accept, no action.** The phase-isolation claim is unverifiable from history;
   the code is behaviorally coherent. Note it and move on — do not rewrite history.

### §4C-a — Correction primer (paste first · wait for acknowledgement)

```
Session 21C — CORRECTION pass. An independent Reviewer audited the 21C diff against ADR 0014 §9 and found
ZERO BLOCKERS. You are fixing one MAJOR, two MINORs, and one NIT. You are NOT re-opening the design:
ADR 0014 and ADR 0013 Rev B are locked.

Read now:
- docs/reviews/0014-21c-approvals-review.md — the whole report. M1, m1, m2, n1 are your worklist.
- docs/decisions/0014-seats-and-permissions-surface.md §9.3 (single + batch, filters), §9.4 (paginate/
  virtualize), §12 (the a11y/WCAG-AA bar).
- components/.../ApprovalsInbox.tsx and lib/db/posts.ts (listPendingDraftPosts :97-134;
  bulkApproveDraftPosts :474-487).

Invoke ECC in build posture (/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop per step). Invoke
impeccable-design-and-taste ONLY for E2's contrast/overflow-signal treatment.

CRITICAL CONTEXT — do not undo it: the 21C reviewer WITHDREW the earlier 21B/M1 finding (it was read at
HEAD, not at the 21B commit). The Approvals nav is CORRECTLY a live <Link> now. Do NOT re-inert it. The
only nav work in this pass is a stale COMMENT (n1).

Do NOT write code yet. First confirm:
(1) bulkApproveDraftPosts (posts.ts:474-487) takes campaignId only and carries NO platform predicate —
    i.e. it approves every draft in the campaign regardless of the UI's platform filter.
(2) In ApprovalsInbox.tsx, the per-campaign bulk button's LABEL count (:192, filtered `rows.length`) and
    the success ANNOUNCEMENT count (:112, unfiltered `items.filter(...)`) come from DIFFERENT sets.
(3) Whether bulkApproveDraftPosts has any caller OTHER than the inbox (the campaigns surface) — you must
    not change its signature/behaviour for that caller in this pass.
Then output those three findings and "Ready for E1." Then stop.
```

### §4C-b — Correction steps (21C)

#### E1 — M1: bulk approve must never approve what the approver filtered out  ·  review M1
```
BUILDER — 21C · E1 (correction). Fix M1 — the human-in-the-loop erosion. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

PROBLEM: handleBulkApprove(campaignId) (ApprovalsInbox.tsx:106-119) calls bulkApprovePostsAction(campaignId)
→ bulkApproveDraftPosts approves EVERY draft in that campaign (posts.ts:481 — campaign_id + status='draft',
NO platform predicate). Meanwhile the button LABEL shows the platform-FILTERED count (:192) and the success
announcement shows the UNFILTERED count (:112). Campaign X with 3 LinkedIn + 2 X drafts, filter=X →
button reads "Approve all (2)" → click approves all 5, including 3 drafts the approver never saw.
Authorization is intact (an approver MAY approve all 5) — which is why no gate caught it. The breakage is
the product's human-in-the-loop promise: a control that says 2 and does 5.

DECISION (founder-adjudicated — do not re-litigate):
- Fix (a): while platformFilter !== 'all', DISABLE (or hide) the per-campaign "Approve all" button, with a
  short explanatory tooltip/hint ("Clear the platform filter to approve the whole campaign"). Single-row
  Approve stays available under any filter — that is the reviewed, per-post path.
- REJECTED — do NOT implement: looping approvePostAction over the visible rows. That replaces ONE atomic
  all-or-nothing UPDATE with N round-trips carrying real partial-failure states, re-introducing exactly the
  silent-partial-approve class the reviewer proved ABSENT (report B1). Do not trade that away.
- Do NOT add a platform predicate to bulkApproveDraftPosts in this pass — it is a shared write path (the
  campaigns surface calls it). That is backlog, not correction.
- Make LABEL, ROW-REMOVAL, and the LIVE-REGION ANNOUNCEMENT all derive from the SAME set, so the count the
  approver reads is always the count the DB acts on. No unfiltered/filtered mismatch anywhere.

TESTS (TDD) — the report notes the current Vitest suite does NOT assert this; add it:
- APV-BULK-RESPECTS-FILTER: with an active platform filter, bulk approve is unavailable (disabled/hidden)
  AND no drafts outside the filter can be approved through the inbox.
- APV-BULK-COUNT-CONSISTENT: unfiltered, the button label, the rows removed, and the announced count are
  the SAME number.
- Keep the existing atomic-batch guarantee green (B1): unfiltered bulk remains one all-or-nothing action.

BOUNDARY: inbox UI + its call-site only. No change to bulkApproveDraftPosts, approvePostAction, or any DB
object. No new write path.
On green + commit, output "E1 complete — bulk approve respects the filter." Then stop.
```

#### E2 — m2 (contrast), m1 (overflow signal), n1 (comment rot)  ·  review m2, m1, n1
```
BUILDER — 21C · E2 (correction). Fix m2, m1 (partial), n1. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

m2 — WCAG-AA MISS (fix now, not deferred — it fails an explicit bar we set in Session 20 / ADR §12).
     ApprovalsInbox.tsx:270 — the Skip label uses text-amber-400 on bg-card: ≈1.7:1 in light theme,
     against a 4.5:1 AA floor. Not a near-miss. Darken for light theme (e.g. amber-700) or give the ghost
     button a filled background. Verify the fixed value against the AA floor; do not eyeball it. (Approve
     emerald-700-on-white ≈4.8:1 and the platform badge already pass — leave them.)

m1 — PAGINATION: real pagination is DEFERRED (launch caps are ~50 posts/mo against a LIMIT of 200 — real
     pagination now is over-engineering). But drafts past the 200th are currently invisible with NO signal,
     and silently hiding a post from the approver is not acceptable. Ship the honesty signal only:
     surface an overflow indicator ("Showing the first 200 of N") when the pending count exceeds the limit,
     so nothing is hidden without the approver knowing. Do NOT build paging/virtualization in this pass.

n1 — COMMENT ROT: DashboardShell.tsx, the export-area comment near APPROVALS_NAV_CAPABILITY still says the
     entry is "gated and inert here, matching COMING_SOON_NAV's rendering". 21C made it a LIVE <Link>
     (:157-169) and the render-area comment was already corrected. Update the export-area comment to match
     reality. DO NOT change the nav's behaviour — the live link is CORRECT (21B/M1 was withdrawn).

DESIGN POSTURE (impeccable + taste, gated — light): the overflow indicator is quiet and factual, not an
alarm; the Skip button stays visually subordinate to Approve while clearing AA.

TESTS (TDD): the Skip label meets the AA contrast floor in BOTH themes; the overflow indicator appears
only when the pending count exceeds the limit and states the true total.

BOUNDARY: visual/a11y + one read-path count + a comment. No behavioral change to approve/skip/bulk.
On green + commit, output "E2 complete — contrast, overflow signal, comment." Then stop.
```

#### E3 — Close Session 21  ·  docs
```
BUILDER — 21C · E3. Documentation only — no code.

- docs/current-phase.md: Session 21 (21A + 21B + 21C) CLOSED. Record what shipped: DB-enforced
  permission model (0013 Rev B), membership resolver + member-lockout fix, invite email + accept flow,
  /settings/team + seat meter + overage UX, capability retrofit, approver inbox. Name the next phase.
- docs/launch-checklist.md: tick the invite flow, /settings/team, and approver-inbox rows (the
  Postiz-removal rows are unaffected).
- docs/decisions/0014-...md §11: confirm the manifest now matches the delivered 21B + 21C reality
  (this completes the §4B/D4 reconciliation).
- backlog.md: file the deferred items listed in §4C-c below. Do not silently drop them.

On completion, output "E3 complete — Session 21 closed." Then stop.
```

**Verification (21C correction):**
```
npx tsc --noEmit --skipLibCheck
npx vitest run lib/db components "app/[locale]/(dashboard)/approvals"
# No DB objects touched in this pass — the approve boundary is unchanged. The existing CI-executed
# posts-approval-boundary suite remains the authority for the security constraint.
```

### §4C-c — Follow-ups NOT in this pass (file them in backlog.md)

| Item | Disposition |
|---|---|
| **CI: no job runs the app-layer Vitest suite** — `db-tests.yml` runs `supabase/__tests__` only, so every APV-*/ROLE-*/UI-* test (all of 21C's inbox tests included) executes **locally only** | **Fix next — this is the same covered≠executed trap as 21A, one layer up.** Tests that no CI job runs will rot silently. Add a CI job running the full Vitest suite on every push. ✅ **Fixed Session 22 W1 (ADR 0015)** — new standalone required `app-tests.yml` runs `vitest run app/ lib/ components/` on every push/PR. |
| **CI Postgres OOM / recovery crash** (carried over from 21B) | **Own hardening task.** Until the stack survives a full run, the DB suite cannot honestly serve as a merge gate. ✅ **Fixed Session 22 W1** — see 21B follow-up above; same fix. |
| Optional `platform` predicate on `bulkApproveDraftPosts` (would allow *filtered* bulk approve while keeping ONE atomic UPDATE) | Backlog — the right long-term fix for M1's underlying limitation, but it touches a write path shared with the campaigns surface. Not a correction-pass change. ✅ **Fixed Session 22 W2 (A1)** — `bulkApproveDraftPosts(campaignId, platforms?)`, filter-scoped and atomic. |
| m1 residual — real pagination/virtualization beyond LIMIT 200 | Backlog. Revisit before high-volume plans; the overflow signal (E2) makes the truncation honest in the meantime. ⚠️ **Partially addressed Session 22 W2 (A2)** — overflow signal now backed by a real server-side filter-scoped `total`; real pagination still open (`21C-pagination` in `docs/backlog.md`). |
| n3 — `listPendingDraftPosts` accepts `campaignId`/`platform` params that are never passed (dead params; filtering is client-side) | Backlog. Harmless; wire them if/when server-side filtering is needed (it pairs naturally with the pagination item). ✅ **Fixed Session 22 W2 (A2)** — params now honored server-side; `page.tsx` passes them from `searchParams`. |
| n2 — C1/C2 squashed into one commit, so "C2 was visual-only" is unverifiable from history | **Accepted, no action.** Code is behaviorally coherent. Do not rewrite history. Still open/accepted — not addressed by Session 22 (by design). |
| **Member-roster read** (any co-member can read the roster via the API) | Still open from 21B — a **locked 0013 model** property, not a defect. A product decision, not a correction. |
