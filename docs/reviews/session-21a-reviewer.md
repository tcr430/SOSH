# Review — ADR 0013 (Rev A) Seats & Permissions, Session 21A

**Reviewer:** independent (no code written this session) · **Scope:** commits `f1b929f7^..ef6b3bf8`
minus the unrelated marketing commit `f337231c "new"` (verified single-parent, touches only
`app/[locale]/(marketing)/**`, `components/marketing/**`, `i18n/**`, `app/globals.css` — not part of
this ADR; excluded from scope below). True 21A diff: 37 files, +3433/−26, zero `.tsx`, zero `app/`
routes, zero `lib/email/` changes.

**Method:** every check below was re-derived from the actual migration SQL, test source, and lib code
(not from test names or the ADR's own claims) unless marked "diff-verified only." CI run
`28680665063` (head `ef6b3bf8`) is `conclusion: success`; `supabase start` + `supabase db reset` both
succeeded, confirming clean-room M1→M8 replay.

---

## Findings table

| Section | Check | Status | File:Line | Fix |
|---|---|---|---|---|
| A1 | No existing SELECT policy body edited for reads; only the helper changed | ✅ | `20260702120100_get_user_business_ids_multimember.sql` (whole file); confirmed via `grep CREATE POLICY` across all 21A migrations — none touch `*_select_own` on any pre-existing table | — |
| A2 | Read matrix proven on posts + campaigns + social_accounts + a metrics table | ⚠️ | `supabase/__tests__/get-user-business-ids-matrix.test.ts:195-256` tests only `businesses` + `posts` | Add campaigns/social_accounts/one metrics table (e.g. `post_metrics`) to the matrix suite |
| A3 | Non-recursion: active member queries `business_members` without error | ✅ | `get-user-business-ids-matrix.test.ts:248-256` | — |
| B1 | `user_can` resolves L-2 matrix exactly, incl. owner override, unknown cap, null auth | ✅ | `user-can-matrix.test.ts:122-185`, cross-checked `expectedFor()` (line 22) against `20260702120200_user_can.sql:35-43` CASE — exact match | — |
| B2 | Raw anon-client DB boundary: viewer denied, editor floor, editor blocked from granting approval, editor allowed to unapprove/remove, approver allowed, service-role exempt | ✅ | `posts-approval-boundary.test.ts:138-227`; all via `signInAs()` (anon-key), not service-role or Server Action | — |
| B3 | Atomic guard intact (zero rows, no exception); every new/edited write policy has USING+WITH CHECK | ✅ / ⚠️ | Guard test at `posts-approval-boundary.test.ts:229-242`. USING+WITH CHECK presence confirmed by direct source read of `20260702120000`, `20260702120200`, `20260702120300`, `20260702120400` — correct per-command (INSERT=WITH CHECK only, DELETE=USING only, UPDATE=both) — but **no automated pg_catalog test** asserts this (unlike the pattern already used for `business_deletion_requests`/`email_outbox` in `rls-policy-lockdown.test.ts:63-93`) | Extend `rls-policy-lockdown.test.ts` to assert USING+WITH CHECK on `business_members`/`posts`/`campaigns`/`social_accounts` write policies |
| C1 | DEFINER fns: STABLE/IMMUTABLE as appropriate, `SET search_path=public`, REVOKE ALL + scoped GRANT | ✅ | `get_user_business_ids` (STABLE), `user_can` (STABLE), `accept_invite` (VOLATILE, correct — it writes), `enforce_seat_cap` (trigger fn, DEFINER + search_path set) — all confirmed by direct read | — |
| C2 | n3: both trigger fns carry `SET search_path=public` | ✅ | `enforce_post_transition_capability` — `20260702120300...sql:39`; `protect_primary_admin_membership` — `20260702120000...sql:80`. Both closed per Rev A reviewer note | — |
| C3 | No DEFINER fn trusts client-supplied identity over `auth.uid()` | ✅ | `user_can`/`accept_invite` both resolve identity exclusively via `auth.uid()`/`auth.users` lookup, never a client-passed user id | — |
| D1 | m4 hijack closure: peer can SELECT pending row but cannot bind it (email-match) | ✅ / ⚠️ | Hijack-immunity re-derived from `20260702120500...sql:53-61` (WHERE clause requires `lower(email)=v_auth_email` from `auth.uid()`, never client input) and empirically proven by `accept-invite-rpc.test.ts:100-111` ("rejects on email-mismatch"). The pure visibility half (a peer literally CAN `SELECT` the pending row) is **not directly tested** — true by inspection of `business_members_select`'s unconditional USING clause (`20260702120000...sql:62-66`, no status filter), but no test exercises it | Add a peer-SELECT-sees-pending-row assertion to `business-members-constraints.test.ts` |
| D2 | m1: DB-side 7-day expiry, independent of app token | ✅ | `accept-invite-rpc.test.ts:113-125`; matches `invited_at > now() - interval '7 days'` guard, `20260702120500...sql:60` | — |
| D3 | m2: clean coded error, not raw 23505, on double-membership | ✅ | `accept-invite-rpc.test.ts:127-153` | — |
| D4 | accept_invite is the only not-yet-member write; idempotent same-user; single-use replay blocked | ✅ / ⚠️ | Idempotency tested (`accept-invite-rpc.test.ts:155-174`). Single-use-vs-**third-party** replay after bind is **not adversarially tested** (only inferred from the `status='invited' AND user_id IS NULL` WHERE guard) | Add a test: user B attempts `accept_invite` on a row already bound to user A → generic "invite not available" |
| D4 | Revoke frees the seat | ✅ | `accept-invite-rpc.test.ts:176-199` (SEAT-REVOKE-FREES-SEAT) | — |
| D5 | invite-token mirrors OAuth-state signer; tamper/expiry/wrong-secret/short-secret throw; distinct secret via config.ts | ✅ | `lib/members/invite-token.test.ts` (all 6 cases); `lib/config.ts:32-33` — separate `z.string().min(32)` schemas for `OAUTH_STATE_SECRET` and `INVITE_TOKEN_SECRET` | — |
| E1 | Seat cap enforced by DB trigger, not app-layer only; checkInviteAllowed mirrors campaign-enforcement shape | ✅ / ⚠️ | Trigger-boundary proven (`seat-cap-enforcement.test.ts:75-102`) but **only via the service-role admin client**, never a real authenticated (anon-key) admin client — the literal "raw anon INSERT is rejected" claim rests on the role-agnostic nature of `BEFORE INSERT` triggers (verified architecturally: triggers fire before RLS `WITH CHECK`, regardless of caller role) rather than a direct anon-key test. `checkInviteAllowed`/`upgradeCtaTargetFor` shape confirmed identical to `lib/campaigns/enforcement.ts:9-44` | Add one seat-cap test using `signInAs()` for a genuine admin member, not `admin` service-role |
| E2 | SEAT-CAP-SSOT-SYNC (named B9 gap) closed | ✅ | `seat-cap-enforcement.test.ts:69-73`, `it.each(ALL_PLANS)` — CLOSED | — |
| E3 | `maxSeats:null` ⇒ unlimited; seat usage = active+pending incl. owner | ✅ / ❌ | Unlimited case tested (`seat-cap-enforcement.test.ts:96-102`). "Owner included" is **false for every business created after 21A ships** — see MAJOR-1 below | See MAJOR-1 |
| E4 | Overage lock: Pro→Plus downgrade blocks further invites; revoke/content ops remain allowed | ✅ | `seat-cap-enforcement.test.ts:104-122` (downgrade blocks new invite). Revoke-still-allowed and content-ops-still-allowed under overage are **not independently re-tested** in this file (implied by the trigger only gating `business_members` INSERT, never touching `posts`/`campaigns`, and revoke being an UPDATE not an INSERT) | Low priority — architecturally sound, could add an explicit test |
| F1 | No owner role value, no transfer_ownership anywhere | ✅ | `grep -r transfer_ownership lib/members` → no matches; `business_members.role CHECK IN ('approver','editor','viewer')` — no `'owner'` value possible | — |
| F2 | Primary-admin trigger blocks demote/revoke/rebind; no-op elsewhere | ✅ | `business-members-constraints.test.ts:159-250`, all 5 cases (3 blocked + 2 no-op) | — |
| F3 | `delete_account`/`transfer_ownership` both resolve false via `user_can`; `businesses` UPDATE/DELETE unchanged, owner_id-scoped | ✅ / ⚠️ | `delete_account` tested (`user-can-matrix.test.ts:162-172`); `transfer_ownership` **not literally tested as a string** — same CASE/ELSE mechanism, inferred safe not proven. `businesses_update_own`/no-DELETE-policy confirmed untouched by any 21A migration (`20260430120017...sql:25-28`, no 21A migration references `businesses`' write policies) | Add `'transfer_ownership'` to the unknown-capability test loop |
| G1 | `purge_business` has explicit `DELETE FROM business_members` before root delete + CASCADE backstop; ADR 0010 §D2.5 row added | ✅ | `20260702120700...sql:57` (explicit delete), `business_members.business_id ... ON DELETE CASCADE` (M1); test proves rows gone (`backfill-owner-members-and-purge.test.ts:150-178`); §D2.5 row confirmed at `docs/decisions/0010-legal-surface.md:1064` | — |
| G2 | `purge_business` other behavior (vault delete, billing redaction, idempotency, return shape) unchanged | ✅ | `20260702120700...sql` is a `CREATE OR REPLACE` preserving vault-delete loop, billing_events redaction, and idempotency check verbatim — only the explicit member-delete line is new | — |
| H1 | DROP POLICY names in M4/M5 match live pre-21A names | ✅ | Grepped live names in `20260430120010_posts.sql`, `20260430120009_campaigns.sql`, `20260430120006_social_accounts.sql` (as re-affirmed by `20260430120017`) — exact match to the names dropped in `20260702120300`/`20260702120400`; corroborated by successful `supabase db reset` in CI | — |
| H2 | Backfill idempotent, covers all non-deleted businesses, creator passes all 6 capabilities | ✅ | `WHERE b.deleted_at IS NULL` (`20260702120600...sql:19`); idempotency + zero-regression tests at `backfill-owner-members-and-purge.test.ts:111-148` | — |
| H3 | SEAT-NO-STRIPE: only `maxSeats` change in `lib/stripe/plan.ts` | ✅ | Diff-verified: `lib/stripe/plan.ts` diff is 5 lines (the `maxSeats` field + values); no other Stripe/webhook/checkout file appears in the true 21A diff | — |
| H4 | Zero `.tsx`/app routes/`lib/email`; no service-role in user path; no `any`/`console.*`; env via config.ts only; DB via lib/db only | ✅ | True 21A diff (37 files) contains zero `.tsx`, zero `app/`, zero `lib/email/`. All `: any` occurrences are test-fixture admin-client typings with adjacent `eslint-disable-next-line` comments. All `process.env.*` reads are either inside `lib/config.ts` (correct) or inside `supabase/__tests__/*.test.ts` (an established pre-existing pattern, commented as matching `lib/email/__integration__/round-trip.test.ts`). No `console.*` in the diff | — |
| I1 | Diff-verified-only constraints correctly scoped as such | ✅ | `RLS-READ-HELPER-ONLY`, `RLS-NO-MIDDLEWARE-ROLE`, `RLS-NO-SERVICE-IN-USER-PATH`, `SEAT-NO-STRIPE` — all negative/structural claims, appropriately not runtime-tested, all diff-verified above | — |
| I2 | Four named B9 gaps closed with executed tests | ⚠️ | `SEAT-CAP-SSOT-SYNC` — **closed** (E2). `RLS-INVITED-VISIBLE-ALL` — **partially closed**: hijack-immunity is tested, raw visibility is not (D1). `RLS-MEMBERS-USINGCHECK` — **not closed**: policy body verified by source read only, no automated pg_catalog assertion for `business_members`/`posts` (B3). `SEAT-STATUS-3` — **not closed**: no test attempts a 4th status value against the `CHECK (status IN (...))` constraint to confirm it's rejected | See B3, D1 fixes above; add a 4th-status-value rejection test for `SEAT-STATUS-3` |

---

## BLOCKER

None. Every check in Section B (capability enforcement — the actual approval gate), Section D's hijack-closure argument, Section F (primary-admin protection), and Section G (GDPR erasure) held up under direct adversarial re-derivation against the real SQL and a real anon-key client. The one thing that would have been an automatic BLOCKER per your brief — "an editor being able to grant approval" — is proven false: `posts-approval-boundary.test.ts:189-202` shows the raw anon UPDATE is rejected by the trigger with `error!.message` matching `/approve capability required/`, and the row is confirmed unmutated via a service-role read immediately after.

---

## MAJOR

**MAJOR-1 — No mechanism backfills the owner's `business_members` row for businesses created *after* 21A ships; seat accounting silently undercounts by 1 for every new business going forward.**

- `M7` (`20260702120600_backfill_owner_members.sql`) is one-time DML — it runs once, at migration-apply time, over businesses that exist *at that moment*.
- `createBusiness()` (`lib/db/businesses.ts:36-48`) inserts only into `businesses`; it never inserts a corresponding `business_members` row.
- There is no `AFTER INSERT ON businesses` trigger anywhere in the migration set — the only trigger on `businesses` is `trg_businesses_updated_at` (`set_updated_at`), unrelated.
- Consequence: any business created after this migration applies has `owner_id` set but **no `business_members` row** until 21B's invite/member UI (or a manual insert) creates one.
- This is **not a security leak** — `get_user_business_ids()` and `user_can()` both have an explicit `owner_id` override branch independent of `business_members`, so the owner's own access is unaffected (ROLE-CREATOR-NOREG holds for the *backfilled* population, and the owner-override branches hold for everyone).
- It **is** a correctness gap in the seat-accounting design the ADR explicitly claims is solved: `lib/db/business-members.ts:34-35` states *"Owner is an active member row (backfill) → counted naturally, no special-case"* — true only for businesses that existed at backfill time. For every new business, `countSeatUsage()` will report 1 fewer active member than reality, `listMembers()` (21B's team list) won't show the owner at all, and the seat cap will effectively allow one extra real occupant than `plan_max_seats` intends.
- Notably, **every fixture in this test suite reproduces the same gap** — `seat-cap-enforcement.test.ts`, `accept-invite-rpc.test.ts`, `user-can-matrix.test.ts`, and others all create businesses via `admin.from('businesses').insert(...)` without ever inserting the owner's member row, so nothing in CI exercises the "new business + owner counted" path. The gap is invisible to the existing suite by construction.

**Fix instruction:** add either (a) an `AFTER INSERT ON businesses FOR EACH ROW` trigger that inserts the `approver`+`is_admin`+`active` owner row (mirroring M7's shape, DEFINER, idempotent via the same partial unique index), or (b) make `createBusiness()` perform both inserts transactionally at the app layer. Given L-10 ("role enforcement lives in the database") and that this is a data-integrity invariant rather than a permission check, a DB trigger is the more consistent choice with the rest of this ADR's design. This should land before 21B builds the seat meter and team list on top of `countSeatUsage`/`listMembers`, since both will be wrong for any business created after 21A merges.

**MAJOR-2 — RLS-READ-MATRIX coverage proves only `businesses` + `posts`; `campaigns`, `social_accounts`, and every read-only table (`post_metrics`, `ai_usage`, `engagement_inbox`, `trial_state`, `brand_voices`) widened by the same helper are untested for the invited/revoked/cross-tenant/soft-deleted matrix.**

- `get_user_business_ids()` is, by the ADR's own words, *"the single hardest test target"* and *"highest blast radius change"* (§3) — it widens read access on nine tables simultaneously.
- `get-user-business-ids-matrix.test.ts` exercises exactly two of those nine (`businesses`, `posts`).
- The underlying mechanism (`business_id = ANY (SELECT unnest(public.get_user_business_ids()))`) is textually identical across all nine tables, confirmed by direct read of `20260430120017_fix_rls_function_caching.sql` — so this is lower-probability-of-live-bug than a from-scratch policy would be, but it's still an untested claim on 7 of 9 tables. A future edit to any one of those SELECT policies (e.g., a well-intentioned "optimization" that drops the `unnest`, reintroducing the `uuid = uuid[]` bug this session already hit twice on other tables per git history) would not be caught by this suite.

**Fix instruction:** extend `get-user-business-ids-matrix.test.ts` (or a new file) to run the same six-actor matrix (owner / active member / invited member / revoked member / cross-tenant / soft-deleted-business member) against `campaigns`, `social_accounts`, and at least one of `post_metrics`/`ai_usage`/`trial_state`.

---

## MINOR

- **B3 / I2** — No automated `pg_catalog` test asserts `business_members`/`posts`/`campaigns`/`social_accounts` write policies carry both `USING` and `WITH CHECK` where required (the pattern exists for `business_deletion_requests`/`email_outbox` in `rls-policy-lockdown.test.ts` but wasn't extended to this session's tables). Verified correct by direct source read only.
- **D1 / I2** — `RLS-INVITED-VISIBLE-ALL`'s visibility half (a peer member can literally `SELECT` a pending invited row) is untested; only the resulting hijack-immunity is tested. True by inspection of the unconditional `business_members_select` USING clause.
- **D4** — No test attempts a third-party replay of `accept_invite` against a row already bound to a different user (only same-user idempotency is tested). Covered by code inspection of the `status='invited' AND user_id IS NULL` guard, not adversarially exercised.
- **E1** — `seat-cap-enforcement.test.ts` exercises `enforce_seat_cap` exclusively through the service-role admin client; the ADR's "raw anon INSERT is rejected" claim is architecturally sound (BEFORE INSERT triggers are role-agnostic and fire before RLS WITH CHECK) but not literally proven via an anon-key authenticated-admin client.
- **F3** — `user_can(b, 'transfer_ownership')` is not tested as a literal string (only `'delete_account'` stands in for "unknown capability"); same CASE/ELSE mechanism, not independently proven for this exact value.
- **I2** — `SEAT-STATUS-3` (the 3-valued status CHECK constraint) has no test that attempts a 4th value and confirms rejection; enum enforcement is currently diff-verified only.

---

## NIT

- `docs/decisions/0010-legal-surface.md:1085` still reads *"Phase-2 `business_members` is not yet live but the schema permits it"* — stale now that 21A shipped `business_members`. The underlying guard logic (multi-business check via `owner_id` only) remains correct per ADR 0013 §8's PII note, but the comment should be updated to avoid confusing a future reader into thinking the table doesn't exist yet.
- All nine `supabase/__tests__/*.test.ts` files type their service-role admin client as `any` with an adjacent `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment. Consistent and low-risk (test-fixture only), but it's a second `any`-adjacent pattern beyond CLAUDE.md's one documented carve-out (`lib/email/templates/index.ts`) — worth a one-line mention in CLAUDE.md if this pattern is intended to be the house style for integration-test admin clients going forward.
- The naive `git diff --stat f1b929f7^..ef6b3bf8` includes an unrelated commit (`f337231c "new"`, marketing/i18n work) interleaved in the same push. Anyone re-deriving scope from that raw range without excluding it would wrongly conclude 21A touched `.tsx`/`app/` files. Worth noting in the PR description so a future auditor doesn't get tripped up the same way this review almost did.

---

## VERDICT

**Blockers before merge:** none. The database-enforced permission boundary — the part of this ADR carrying the real security weight (approval gate, primary-admin protection, accept-invite hijack closure, seat-cap trigger, GDPR erasure) — is real, DB-side, and proven against a raw anon-key client, not just diff-inspected.

**Blockers before 21B can build on this:** **MAJOR-1** (owner backfill for new businesses). 21B's seat meter and `/settings/team` list are both built directly on `countSeatUsage`/`listMembers`, and both will silently misreport for every business created after this session merges. This should be fixed as a small follow-up migration (a trigger, mirroring M7's INSERT shape) before or concurrently with 21B, not deferred into it as an unknown bug to rediscover later.

**Tech-debt acceptable to defer:**
- MAJOR-2 (read-matrix coverage on campaigns/social_accounts/metrics tables) — the mechanism is shared and diff-verified identical across all nine tables; widening the test matrix is good hygiene but not urgent given the shared-mechanism argument, as long as it lands before any future edit touches those SELECT policies independently.
- All MINOR items — each is a coverage gap on a claim that holds by direct code inspection, not a live defect. Reasonable to batch into a single test-hardening pass rather than block on individually.
- All NIT items — no functional risk.

RLS-SOCIAL-APPLAYER remains correctly scoped to 21B per the ADR's own admission (DB-side defense-in-depth is tested; the authoritative app-layer gate is explicitly out of scope this session) — not a finding, just confirming it's not accidentally missing.

---

## Resolution Log (21A-D)

Original findings above are left unedited as the historical record. This log maps each finding to what closed it. Full detail in `docs/decisions/0013-seats-and-permissions.md` (Rev B changelog + §9/M9) and `docs/current-phase.md` (Session 21A entry).

**MAJOR-1 — ✅ RESOLVED (D1).** `ensure_owner_membership()` DEFINER + `AFTER INSERT ON businesses` trigger (migration `20260702120800_ensure_owner_membership.sql`, M9), mirroring M7's row shape, idempotent via `business_members_uniq_user`. `lib/db/business-members.ts:34-35` comment corrected to credit both M7 (backfill) and M9 (go-forward). Fixture ripple fixed in `business-members-constraints.test.ts` and `backfill-owner-members-and-purge.test.ts` (manual owner inserts removed — the trigger now owns that row) and `seat-cap-enforcement.test.ts` (trial-cap loop corrected 10→9 now that the auto-owner consumes a seat). New dedicated regression suite: `ensure-owner-membership.test.ts` (createBusiness + raw-insert paths, idempotency, seat-cap interaction).

**MAJOR-2 — ✅ RESOLVED (D2).** `get-user-business-ids-matrix.test.ts` widened from businesses/posts to also run the same six-actor matrix (owner/active/invited/revoked/cross-tenant/soft-deleted) against `campaigns`, `social_accounts`, and `post_metrics` via a shared `expectWideMatrix()` helper.

**MINOR — B3 / I2 (RLS-MEMBERS-USINGCHECK) — ✅ RESOLVED (D2).** `rls-policy-lockdown.test.ts` extended with `it.each` blocks asserting `pg_policies.qual`/`with_check` presence per command (INSERT=WITH CHECK, UPDATE=both) across `business_members`/`posts`/`campaigns`/`social_accounts`, plus a DELETE=USING check and confirmation `business_members` has no DELETE policy at all (by design, §2.1).

**MINOR — D1 / I2 (RLS-INVITED-VISIBLE-ALL, visibility half) — ✅ RESOLVED (D2).** `business-members-constraints.test.ts` gained a `signInAs()`-based test: a peer active member can SELECT a pending invited row of the same business.

**MINOR — D4 (third-party replay) — ✅ RESOLVED (D2).** `accept-invite-rpc.test.ts` gained a test: user B calling `accept_invite` on a row already bound to user A gets the generic "invite not available" error; A's row confirmed unchanged via a service-role read.

**MINOR — E1 (authenticated-admin seat-cap path) — ✅ RESOLVED (D2).** `seat-cap-enforcement.test.ts` gained a test driving the over-cap rejection through `signInAs()` (anon key, genuine authenticated admin member) instead of only the service-role client.

**MINOR — F3 (`transfer_ownership` untested) — ✅ RESOLVED (D2).** `user-can-matrix.test.ts` gained `'transfer_ownership'` alongside the existing `'delete_account'` unknown-capability assertion.

**MINOR — I2 (SEAT-STATUS-3) — ✅ RESOLVED (D2).** `business-members-constraints.test.ts` gained two tests: a 4th status value (`'removed'`) is rejected by the CHECK constraint on both INSERT and UPDATE.

**MINOR — E4 (overage-lock revoke/content-ops not independently re-tested) — not addressed.** Left as explicitly low-priority per the original review ("architecturally sound, could add an explicit test") and not in the D1–D3 fix list; still open if a future session wants full closure.

**NIT — `docs/decisions/0010-legal-surface.md:1085` stale comment — ✅ RESOLVED (D3).** Corrected to note `business_members` shipped in 21A and that the multi-business guard is unchanged (stays `owner_id`-scoped) because `purge_business`'s explicit member erasure already clears membership rows on purge.

**NIT — CLAUDE.md second `any`-adjacent pattern undocumented — ✅ RESOLVED (D3).** `CLAUDE.md`'s TypeScript strict-mode carve-out list extended to name the `supabase/__tests__/*.test.ts` service-role admin client pattern as accepted house style, alongside the existing `lib/email/templates/index.ts` carve-out.

**NIT — commit `f337231c` scope-confusion risk — ✅ RESOLVED (D3, folded into session reply since no PR flow exists in this environment).** Noted for the record: `f337231c` ("new", marketing/i18n) is interleaved in the local history but unrelated to 21A/ADR 0013 — don't derive 21A's scope from the raw commit range around it.

**Overall: BLOCKER — none (unchanged). MAJOR — 2/2 closed. MINOR — 6/7 closed (E4 deferred, low-priority per original review). NIT — 3/3 closed.**
