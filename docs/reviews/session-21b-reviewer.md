# ADR 0014 — Session 21B (Seats & Permissions: Flow & Surface) — Independent Review

- **Reviewer role:** independent; did not author 21B; no code modified in producing this report.
- **Scope reviewed:** git range `c46211fe^..c07dafda` (B1→B8), the businesses-SELECT RLS state, and every `*.test` added this session.
- **Method:** section-by-section against ADR 0014 §10 named constraints; adversarial checks **re-derived from the code/policies** (not trusted by test name).
- **Gate (pre-review):** the INV-REISSUE-SAME-ROW false-green was closed this session — `REISSUE_INVITE_INTEGRATION_TEST_ENABLED` added to `db-tests.yml`; `reissue-invite.test.ts` now **executes green against live Postgres (3/3, two runs)**. Note the CI DB stack is **intermittently red from a reproducible Postgres OOM/recovery crash** (pre-existing, unrelated to 21B code) — see Verdict §Process.

---

## Summary table

| § | Check | Status | File:Line | Note / Fix |
|---|---|---|---|---|
| A1 | businesses SELECT-only widen; INSERT/UPDATE/DELETE untouched, owner-scoped | ✅ | `20260430120017_fix_rls_function_caching.sql:17-28` | insert/update `WITH CHECK owner_id=auth.uid()`; no DELETE policy |
| A2 | Read matrix re-derived (owner/active ✅ see; invited/revoked/cross-tenant/soft-deleted ✗) | ✅ | policy L19 + `get-user-business-ids-matrix.test.ts:244-307` | re-derived below; executed green this run |
| A3 | `get_user_business_ids` DEFINER+STABLE → no RLS recursion | ✅ | `20260702120100_...multimember.sql:20-21` | matrix `:309` proves member query returns w/o error |
| A4 | grep other parent tables for owner-only SELECT asymmetry | ✅ | — | only `businesses` (superseded orig) + `business_deletion_requests` (fixed 21A `ef6b3bf8`); none live |
| B1 | resolver: one RLS SELECT, deterministic pick, explicit ORDER BY | ✅ | `businesses.ts:41-61` | ORDER BY `created_at, id`; preferred→owned→first→null |
| B2 | RES-SEAM-PARAM-ONLY (param, no column, no switcher) | ✅ | `businesses.ts:39` | — |
| B3 | RES-CALLER-MIGRATION (no dashboard caller of getBusinessByOwner) | ✅ / ⚠️ | `businesses.ts:22` | zero prod callers at all → **dead code (m4)** |
| B4 | member no-lockout + onboarding owner-scoped (both sites re-derived) | ✅ | `login/actions.ts:74-88`, `layout.tsx:56-62` | member → `/campaigns` every login; not bounced into owner wizard |
| B5 | RES-NO-MIDDLEWARE | ✅ | `proxy.ts` | auth + route-gate + i18n + CSP only; `invite` added to PUBLIC_SEGMENTS `:26` |
| C1 | connect/disconnect user_can under **authenticated** client, pre-service-role | ✅ | `connect/route.ts:42`, `disconnect/route.ts:33` | `supabase=createClient()` (anon/authed); fail-closed on `capError` |
| C2 | viewer/editor blocked (redirect `?error=forbidden` / 403); approver/admin pass | ✅ | `connect:46-50`, `disconnect:37-39` | matches each route's existing shape |
| C3 | no new service-role client in a user-facing path | ✅ | diff scan | all new `createServiceRoleClient` sites are test files |
| D1 | INV-NO-TOKEN-IN-LOGS | ✅ | `enqueue.ts:40-48` | logs only `{email_kind,business_id,locale,outcome}` |
| D2 | INV-TOKEN-VERIFY-APPSIDE (HS256, exp) | ✅ | `invite-token.ts:27-38` | `algorithms:['HS256']` pins alg (blocks confusion/`none`) |
| D3 | INV-ACCEPT-ANTI-ENUM (all failures → one message) | ✅ | `business-members.ts:186-202`, `accept/actions.ts:24-49` | non-23505 → throw → `invalid`; 23505 → `already-member` |
| D4 | INV-SIGNUP-EMAIL-LOCKED (UI lock + DB email-match boundary) | ✅ | `SignupForm.tsx:71` readOnly; `accept_invite` RPC | edit-client-side still blocked by RPC email-match |
| D5 | email confirmation NOT weakened for invitees | ✅ | `signup/actions.ts:111-120` | uses `auth.signUp`+`emailRedirectTo`; no `admin.createUser`/`email_confirm` |
| D6 | INV-REISSUE-SAME-ROW (same row, new token/dedupe, actually sends) | ✅ | `business-members.ts:134-148`, `triggers/invite.ts:24,37` | executed green in CI |
| D7 | INV-3-LOCALE, roleLabelKey is an i18n key | ✅ | `team-invite.tsx:22`, `i18n/{en,pt,es}/invite.json` | `t(roleLabelKey)`, role key `team_invite.role.<role>` |
| E1 | ROLE-TEAM-ADMIN-GATED (server guard, redirect) | ✅ | `settings/team/page.tsx:31-35` | `user_can('manage_members')` → redirect `/campaigns` |
| E2 | SEAT-INVITE-FAILFAST-ECHO (echo before insert; trigger is boundary) | ✅ | `actions.ts:99-107` + `enforce_seat_cap` | DB half executed (`seat-cap-enforcement`) |
| E3 | SEAT-METER-COPY + OVERAGE-CTA-DISTINCT (4 states, distinct CTA) | ✅ | `seats.ts:42-73`, `SeatMeter.tsx` | overage checked before atCap; overage CTA ≠ upgrade CTA |
| E4 | SEAT-OVERAGE-LOCK-UX (block invites; allow revoke/content) | ✅ | `enforcement.ts:16-22`, `page.tsx:52` | content ops gated by capability, not seat state |
| E5 | UI-REMOVE-SOFT + ROLE-CONFIRM (dialog names subject; no DELETE) | ✅ | `MemberList.tsx:122-153,43-96`; no DELETE policy | revoke = UPDATE status='revoked' |
| E6 | primary-admin trigger blocks owner demote/revoke via new UI | ✅ | `MemberList.tsx:54,185` (UI) + 0013 trigger (DB) | owner row: no select, no revoke |
| E7 | work-email rule on invited addresses | ✅ | `actions.ts:29` (`workEmailSchema`) | — |
| E8 | SEAT-NO-STRIPE (messaging only) | ✅ | diff | no Stripe schema/webhook/checkout change |
| F1 | affordance map matches §6 (hide default; editor Approve disabled+tooltip) | ✅ | `PostRow.tsx:171-208`, `PostCard.tsx:362-449` | viewer read-only clean |
| F2 | echoes only — DB still denies a direct forged action | ✅ | 0013 `enforce_post_transition_capability` | hiding button is not the control |
| F3 | nav gating (Billing/Team admin-only; Approvals gated) | ✅ | `DashboardShell.tsx:37-38,157-169` | Approvals link is **live, not inert** → **M1** — ✅ self-healed when 21C merged (see Verdict); comment corrected, re-verified Session 22 B6 |
| G1 | B8 = visual/a11y only, no behavioral change | ✅ | `c07dafda` | 8 files, +19/-10, zero rpc/db/redirect lines |
| G2 | badges shape+label (CVD-safe); progressbar/dialog/tooltip ARIA; keyboard | ✅ | `MemberList.tsx:37-41`, `SeatMeter.tsx:38-43`, `PostRow.tsx:184-195` | status shown as color **and** text |
| G3 | i18n en/pt/es, no hardcoded English | ✅ | grep | no new user-facing literal strings |
| H1 | env/db/formatISO/no-any/no-console/limit+order | ✅ | see m1, m3 | one `toISOString` (m1) — ✅ fixed; resolver missing `limit` (m3) — ✅ fixed (`.limit(50)`) |
| H2 | no 0013 model change; §11 manifest matches diff | ✅ | `user_can.sql` unchanged | manifest omits some retrofit files → **n1** — ✅ re-verified already closed, Session 22 B6 |
| I | §10 coverage: executed vs diff-verified | ✅ | see Section I | no security constraint rests on an unrun test |

---

## Re-derived adversarial checks (the ones that matter)

**A2 — businesses read matrix (raw authenticated client).** Policy: `id = ANY(SELECT unnest(get_user_business_ids())) AND deleted_at IS NULL`, where `get_user_business_ids() = {owner_id=auth.uid()} ∪ {business_members.business_id WHERE user_id=auth.uid() AND status='active'}`.
- owner → id∈set via owner_id, not deleted → **sees**. active member → id∈set via active row → **sees**. invited (user_id NULL / status='invited') → not active → **∅**. revoked (status='revoked') → excluded by `status='active'` → **∅**. cross-tenant → other business_id → **∅**. soft-deleted → `deleted_at IS NULL` false even for owner → **∅**. No leak. Matches `get-user-business-ids-matrix.test.ts:244-307`, which asserts exactly this with anon-key `signInAs` clients and **passed in this session's CI run**.

**B4 — member lockout / onboarding scoping.** `login/actions.ts` order: safe `redirectTo` → `!business`→`/onboarding` → `owner && !onboarding_completed`→`/onboarding` → else `/campaigns`. A pure member: `getBusinessForUser` returns their membership business, `owner_id !== userId`, so it skips the onboarding branch → `/campaigns` on **every** login. A member whose owner hasn't onboarded: same skip → not bounced. `layout.tsx:56` guard is `owner_id === user.id && !onboarding_completed` — identical scoping. Both hold; **no BLOCKER**.

**C1 — connect/disconnect authoritative gate.** Both handlers bind `supabase = await createClient()` (the anon/authenticated server client, `lib/supabase/server.ts`), resolve the business via RLS-scoped `getBusinessForUser`, then `supabase.rpc('user_can', …)` — so `auth.uid()` is the caller, and the RPC evaluates the real role. Denied (or `capError`) → block **before** the service-role write. A gate run under the service-role client (`auth.uid()` NULL → `user_can` returns false, `user_can.sql:15-16`) would have *failed closed*, not opened — but that path isn't taken here anyway. **No bypass.**

**D3 — accept anti-enumeration.** `acceptInvite` maps: RPC error `23505` → `already_member`; any other RPC error → **throws**; success → `accepted`. `accept/actions.ts` catches the throw → `{status:'invalid'}`. So email-mismatch / expired / claimed / revoked / unknown (all raised, not 23505, by the locked `accept_invite` DEFINER RPC) collapse to the single generic `invalid` state. Covered by executed `accept-invite-rpc.test.ts`. **No oracle.**

---

## Findings (tiered)

### BLOCKER — none
No security boundary is defended by UI alone. Every gated write (approve/author/reschedule, connect/disconnect, member invite/role/revoke, seat cap, invite accept) is enforced by DB RLS/trigger/RPC under the authenticated client; the app layer only echoes. The one permitted RLS delta is SELECT-only and correct; writes stay owner-scoped.

### MAJOR

**M1 — Approvals nav link ships *live* in 21B but the `/approvals` route does not exist in this diff (404 for approver/admin), and the code comment misdescribes it as inert.**
`DashboardShell.tsx:156-169` renders a real `<Link href="/approvals">` gated on `canApprove = useCan(APPROVE) || member.isAdmin`. The adjacent comment (`:47-48`) says *"this entry is gated and inert here, matching COMING_SOON_NAV's rendering"* — but it is **not** rendered like `COMING_SOON_NAV` (which are inert `<span>`s, `:142-154`); it is a navigable link. `app/[locale]/(dashboard)/approvals/` is **not** part of the 21B diff (it is untracked 21C WIP). ADR §11 (CHANGED-21B) explicitly says *"Approvals link lands with §9"* (i.e. 21C), and §9.5 says the surface ships in 21C.
- **Failure scenario:** merge 21B alone → an approver or admin sees "Approvals" in the sidebar → clicks → 404.
- **Fix:** either render the Approvals entry inert like `COMING_SOON_NAV` until 21C, or gate it behind a flag, **or** land it together with 21C/C1. Correct the comment to match whatever ships. (Self-heals the moment 21C/C1 merges, so downgrade to MINOR if 21B and 21C ship as one unit.)
- ✅ **Resolved.** 21C merged, so `/approvals` exists and the link is live and correct — the 404 window never existed in production (also see the 21C reviewer's withdrawal of this finding in its own report). The stale comment was corrected to "activated 21C/C1"; re-verified still correct at HEAD in Session 22 B6.

### MINOR

**m1 — `reissueInvite` uses `new Date().toISOString()` (L-6 / date-fns violation).** `business-members.ts:140`. New in 21B. Use `formatISO(new Date())` per CLAUDE.md ("never `new Date().toISOString()` directly"). Behaviorally correct (UTC ISO), style-only. ✅ **Fixed** — `business-members.ts:141` now uses `formatISO(new Date())` (verified prior to Session 22; confirmed still correct at HEAD).

**m2 — Team Server Actions have no app-layer capability echo; they rely solely on the page guard + DB RLS.** `invite/change-role/revoke/resend` in `settings/team/actions.ts` never call `canServer('manage_members')`. Verified the DB **does** deny a direct POST by a non-admin: `business_members_insert`/`_update` gate on `user_can('manage_members')`, so a forged call yields 0 rows → error → generic `ActionState.error` (no escalation). But ADR §5.3 described these as "capability-echoed"; the echo is absent, so a non-admin who bypasses the page gets an opaque failure instead of a clean typed denial. Defense-in-depth gap, not a hole. Add a `canServer` pre-check for parity/UX. ✅ **Fixed** — all four actions now call `canServer(client, business, user.id, CAPABILITIES.MANAGE_MEMBERS)` (`actions.ts:101,160,186,213`), returning the typed `errors.forbidden` denial before touching the DB layer. **Session 22 W2 (`ROLE-TEAM-ECHO`)** added a regression test asserting this so the echo can't silently regress, backed by the existing Tier-1 `user-can-matrix.test.ts` proof that `manage_members` resolves `false` for every non-admin role×combo.

**m3 — `getBusinessForUser` has no `limit` (CLAUDE.md list-query rule).** `businesses.ts:41-46`. Naturally bounded by RLS to the caller's own businesses (1–2 at launch) and ORDER BY is present, so not a real DoS — but the rule wants an explicit cap. Add `.limit(50)`. ✅ **Fixed** — `businesses.ts:33` now has `.limit(50)`.

**m4 — `getBusinessByOwner` is now dead code.** Zero production callers (grep across `app/`, `lib/`, `components/`); only its definition and tests reference it. `businesses.caller-migration.test.ts:23` comments that it "stays exported for owner-only service paths," but no such path calls it (the Stripe/service paths use `findBusinessByStripeCustomerId`/`updateBusinessPlan` directly). Either wire the intended caller or remove the export + its unit test. ✅ **Fixed** — `getBusinessByOwner` has been removed entirely (repo-wide grep for the name returns zero matches).

### NIT

- **n1 — ADR §11 manifest omits several files the 21B diff touches** for the §6 retrofit / echo plumbing: `components/ui/tooltip.tsx` (new), `components/campaigns/CampaignCard.tsx`, `components/social/PlatformConnectionCard.tsx`, `lib/contexts/business-context.tsx`, `lib/members/{useCan,invite-preview}.ts`, `lib/db/types.ts`. All legitimate under §6, but the manifest should list them. Also: the §2.1 line in §11 ("NEW — 21B: `…_businesses_select_membership.sql`") is **stale** — that widening shipped in 21A `ef6b3bf8` (in-place edit of `20260430120017`); 21B correctly re-ships nothing. ✅ **Re-verified Session 22 B6** — already closed at HEAD from the 21C/E2–E3 correction pass; no new work needed.
- **n2 — `MemberList.isExpiredInvite` (`:32-34`) does client-side epoch math** (`new Date(x).getTime()` / `Date.now()`) rather than date-fns. Display-only; same class as m1. ✅ **Re-verified Session 22 B6** — already using `date-fns` (`addDays`/`isAfter`/`parseISO`, `MemberList.tsx:5,31-34`), not raw epoch math; no new work needed.
- **n3 — invite-signup post-`signUp` redirect may bounce.** `signup/actions.ts:139` redirects to `/invite/accept?token=` immediately after `signUp`; if the project has email-confirmation ON there is no session yet, so `accept/actions.ts:40` bounces to `/signup?token=`. Consider a "check your email" interstitial. Depends on the Supabase confirmation setting.
- **n4 — repeated `getBusinessForUser` calls** across layout/login/page/routes each re-run the scoped SELECT (no request-level memo). Each is a single indexed query; acceptable.

---

## Section I — §10 constraint coverage (executed vs diff-verified)

**Executed against live Postgres (CI, flags set):** RES-BIZ-SELECT-WIDEN (`get-user-business-ids-matrix`), RES-OWNER-TRIGGER-PRESENT (`ensure-owner-membership`), ROLE-* DB predicates (`user-can-matrix`, `campaigns-social-accounts-role-policies`), INV-ACCEPT-EMAIL-MATCH/-EXPIRY/-ANTI-ENUM (`accept-invite-rpc`), INV-REISSUE-SAME-ROW (`reissue-invite` — **enabled this session**), SEAT-INVITE-FAILFAST-ECHO + SEAT-OVERAGE-LOCK-UX (`seat-cap-enforcement` trigger half), APV-EDIT-REVERT (`posts-approval-boundary`).

**Vitest unit-level (correct by design):** RES-RESOLVER-*, RES-SEAM-PARAM-ONLY, RES-CALLER-MIGRATION, RES-LOGIN-MEMBER-NO-LOCKOUT, RES-ONBOARDING-OWNER-SCOPED, INV-EMAIL-KIND/-3-LOCALE, INV-NO-TOKEN-IN-LOGS, INV-TOKEN-VERIFY-APPSIDE, INV-SIGNUP-EMAIL-LOCKED, UI-AFFORDANCE-MAP/-APPROVE-DISABLED-EDITOR, UI-REMOVE-SOFT/-ROLE-CONFIRM, SEAT-METER-COPY/-OVERAGE-CTA-DISTINCT, ROLE-TEAM-ADMIN-GATED.

**Route gate tested with mocks only (not live Postgres):** ROLE-CONNECT-APPLAYER-GATE / ROLE-DISCONNECT-APPLAYER-GATE — `connect.test.ts` / `disconnect.test.ts` assert the route *calls* `user_can` under the authenticated client and blocks on false; the *correctness* of `user_can` itself is covered live by `user-can-matrix`. Composition is sound; no live end-to-end "viewer hits connect → blocked" test exists. Acceptable (not a BLOCKER).

**Diff-verified design constraint (no test):** RES-NO-MIDDLEWARE.

**I1/I2 verdict:** every §10 constraint maps to an executed test or a diff-verified design constraint; **no security-relevant constraint (RES-BIZ-SELECT-WIDEN, connect/disconnect gate, accept guards, seat cap) rests on an authored-but-unrun test.**

---

## Verdict

**Blockers before merge:** none.

**Blockers before 21C can build on this:** none. The resolver (§2), the capability echoes (§6), and the same pending-draft data path 21C consumes are all present and DB-backed. **M1 is effectively a 21C-coupling issue** — the Approvals nav link should either go inert or land with 21C/C1; as long as 21C/C1 merges together, the 404 window never exists in production.

**Should fix before this merges standalone:** M1 (live link → 404 + misleading comment). Quick fixes: m1 (`formatISO`), m3 (`.limit`), m4 (dead code). ✅ **All fixed** — M1 self-healed on 21C merge; m1/m3/m4 confirmed fixed in the codebase (verified ahead of/at Session 22).

**Tech-debt acceptable to defer:** m2 (add `canServer` echoes to team actions for parity — DB already enforces) — ✅ **fixed**, echoes present and now regression-tested (Session 22 W2, `ROLE-TEAM-ECHO`); n1 (manifest hygiene) — ✅ re-verified closed, Session 22 B6; n2 — ✅ re-verified closed, Session 22 B6; n3/n4 — still open (n3: invite-signup post-confirm redirect edge case; n4: repeated `getBusinessForUser` calls, filed as backlog `21B-n4`, Session 22 B6).

**Process (out of code scope, but blocks confidence):** the `db-tests` workflow is **intermittently red from a reproducible Postgres OOM/recovery-mode crash** on the 2-core CI runner (both attempts this session crashed *after* the invite/RLS suites passed; `9acc0133`/`6ec7fdb2` were red pre-change too). Until the stack survives a full run, "executed green in CI" for the integration suite is not reproducible on demand — the individual security suites *did* pass when the DB stayed up, but a green-on-every-run signal requires fixing the OOM (memory S425–S430; `config.toml [analytics] enabled=false` did not fully resolve it). Recommend treating this as its own hardening task before relying on the DB suite as a merge gate. ✅ **Fixed Session 22 W1 (ADR 0015)** — `config.toml` disables `[studio]`/`[inbucket]`/`[storage]`/`[edge_runtime]` and sets verified memory knobs (`shared_buffers`/`max_connections`/`work_mem` in `[db.settings]`, not `ALTER SYSTEM`); a skip-guard script fails the job on any empty/all-skipped suite. `db-tests` promotion to a required gate is tracked via the three-green-runs tally in `docs/current-phase.md` (0/3 as of Session 22 close).

**Pre-existing (not a 21B defect), noted for the record:** `business_members_select` is `business_id = ANY(get_user_business_ids())`, so any co-member (incl. viewer/editor) can read the full member roster (emails/roles) of their business via the API even though `/settings/team` is admin-gated. This is the locked 0013 model, not introduced by 21B.
