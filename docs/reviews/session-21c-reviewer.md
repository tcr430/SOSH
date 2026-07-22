# ADR 0014 — Session 21C (Approver quick-approve inbox) — Independent Review

- **Reviewer role:** independent; did not author 21C; no code modified in producing this report.
- **Scope reviewed:** `c07dafda..9acc0133` ("session 21", 11 files, +968/-12) — the `/approvals` route + inbox, the `listPendingDraftPosts` read, the DashboardShell nav activation, and i18n.
- **Method:** section-by-section against ADR 0014 §9/§10 (APV-*, ROLE-APPROVALS-GATED) and §12; adversarial checks re-derived from code.
- **Gate (pre-review, established):** (1) inbox wires the **existing** approve/skip/bulk actions unchanged; the only new DB-layer code is the read-only `listPendingDraftPosts`; **no new write path**. (2) **No DB object** added/edited. (3) APV/ROLE tests are authored Vitest; the security boundary rests on the existing CI-executed `posts-approval-boundary.test.ts`.

---

## Summary table

| § | Check | Status | File:Line | Note |
|---|---|---|---|---|
| A1 | inbox calls existing approve/bulk/skip unchanged; no new status-write path | ✅ | `ApprovalsInbox.tsx:17-20,83/96/109`; `actions.ts` not in diff | writes go through the existing DB-gated path |
| A2 | zero DB objects added/edited | ✅ | diff | no `supabase/`/`.sql` |
| A3 | ROLE-APPROVALS-GATED: server guard (approver OR admin), redirect; DB still denies | ✅ | `page.tsx:36-37` + 0013 `enforce_post_transition_capability` | re-derived below |
| B1 | single + batch route to existing actions; batch not a silent partial-fail loop | ✅ | `ApprovalsInbox.tsx:106-119`; `posts.ts:474-487` | bulk = one atomic UPDATE (all-or-nothing) |
| B2 | edit is a SEPARATE step; inbox cannot silently approve an edited post | ✅ | `ApprovalsInbox.tsx:274-279` | "Edit" is a `<Link>` out to campaign posts; no inline edit |
| B3 | APV-REJECT-SKIP wired to existing skip action | ✅ | `ApprovalsInbox.tsx:96` → `skipPostAction` | note ≥3 chars enforced client + Zod |
| B4 | pending set = existing posts query, status='draft', business-scoped; no divergent def | ✅ | `posts.ts:97-134` | `.eq('business_id').eq('status','draft')`, reuses `mapCalendarRow` |
| C1 | APV-PAGINATED: bounded (LIMIT+ORDER) | ⚠️ | `posts.ts:106,128-129` | `LIMIT 200`, ORDER `scheduled_at`; no pagination/overflow signal → **m1** |
| C2 | APV-FILTER: campaign + channel compose | ✅ Session 22 | `ApprovalsInbox.tsx:60-64` | filters compose, BUT bulk ignores the platform filter → **M1** — ✅ fixed Session 22 W2 (A1) |
| C3 | APV-EMPTY-STATE positive/finished | ✅ | `ApprovalsInbox.tsx:121-129,173-177` | empty + filtered-empty both handled |
| C4 | complements calendar/campaign approve, doesn't replace | ✅ | PostRow/PostCard untouched in diff | — |
| D1 | C2 taste = visual/a11y only, no behavioral change from C1 | ⚠️ | single squashed commit | C1+C2 squashed → not commit-verifiable → **n2** |
| D2 | keyboard-first; ARIA; WCAG-AA; edit→approve visible | ✅ Session 22 | `ApprovalsInbox.tsx` | live-region + real buttons ✅; amber-400 skip label contrast → **m2** — ✅ fixed Session 22 W2 (A3), verified both themes |
| D3 | i18n en/pt/es complete, no hardcoded English | ✅ | `i18n/{en,pt,es}/approvals.json` (22 keys each) | brand names (LinkedIn/X) are proper nouns |
| D4 | no `any`/`console`; DB via lib/db; no service-role in user path | ✅ | diff grep CLEAN | date via `date-fns format` |
| E1 | §10 21C constraints map to executed tests | ⚠️ | see Section E | APV/ROLE = Vitest (not CI); DB boundary = CI-executed |

---

## Re-derived adversarial checks

**A1 / A3 — one boundary, still enforced.** `ApprovalsInbox` imports only `approvePostAction`, `bulkApprovePostsAction`, `skipPostAction` from `campaigns/[id]/posts/actions.ts` (unchanged, not in diff). Each runs `getAuthContext()` (authenticated client) → `approvePost`/`bulkApproveDraftPosts`/`skipPost` in `lib/db/posts.ts` → the `posts` UPDATE is gated by `enforce_post_transition_capability` (0013 §5.1). **Spot-proof:** an *editor* who reaches `/approvals` is redirected by `page.tsx:37` (`hasCapability(member, APPROVE) || member.isAdmin` false → `/campaigns`). Even if they bypassed the redirect and POSTed `approvePostAction` directly, `approvePost` under their authenticated client hits the trigger → raises → caught → `{error:'generic'}`. The button-hide/redirect is UX; the DB is the boundary. No new authorization, no new path. ✅

**B1 — batch is atomic, no silent partial failure.** `bulkApproveDraftPosts` (`posts.ts:474-487`) is a single `UPDATE posts SET status='approved' WHERE campaign_id=? AND status='draft' AND deleted_at IS NULL RETURNING id`. All-or-nothing: if the caller lacks `approve`, the per-row trigger raises and the whole statement aborts → action returns `{error}` → the inbox shows the error and removes **nothing** (`handleBulkApprove:115-117`). No path where some rows flip and the UI reports success. ✅

**B2 — edit cannot silently approve.** The row's "Edit" (`:274-279`) is a `<Link href="/campaigns/{id}/posts">` — it navigates away; there is no inline edit and no combined edit+approve in the inbox. ADR 0012's revert-to-draft happens on that other surface. The inbox only ever shows drafts and only ever calls approve/skip explicitly. ✅

---

## Findings (tiered)

### BLOCKER — none
21C adds no write path and no DB object; the approve boundary remains the single DB-gated `enforce_post_transition_capability` transition. The route is server-guarded and the DB denies regardless.

### MAJOR

**M1 — Bulk "Approve all" ignores the active platform filter, silently approving un-reviewed drafts and showing an inconsistent count.** ✅ **Fixed Session 22 W2 (A1/A1.1)** — `bulkApproveDraftPosts` now takes an optional `platforms` predicate (filter-scoped, single atomic UPDATE); bulk is additionally disabled whenever the rendered set is incomplete relative to the server-side total (`APV-BULK-VISIBLE-ONLY`, added on founder review). See `docs/decisions/0014-seats-and-permissions-surface.md` Amendment A and `docs/backlog.md` (`21C-bulk-platform`).
`handleBulkApprove(campaignId)` (`ApprovalsInbox.tsx:106-119`) calls `bulkApprovePostsAction(campaignId)` → `bulkApproveDraftPosts` approves **every** draft in the campaign (`posts.ts:481` — `.eq('campaign_id', campaignId).eq('status','draft')`, no platform predicate). But the per-campaign section renders from `filtered` rows, and its button label is `rows.length` (the platform-filtered count, `:192`), while the success announcement uses `items.filter(p => p.campaign_id === campaignId).length` (the **unfiltered** count, `:112`).
- **Failure scenario:** campaign X has 3 LinkedIn + 2 X drafts. Approver sets platform filter = X → the section shows 2 rows, button reads *"Approve all (2)"*. Click → all **5** drafts are approved in the DB, including the 3 LinkedIn drafts the approver filtered out and never reviewed; the live region then announces *"5 approved."* Human-in-the-loop erosion (approves posts never seen) + a button that says 2 but does 5.
- **Fix (no new write path needed):** while `platformFilter !== 'all'`, either (a) hide/disable the per-campaign bulk button, or (b) approve only the visible IDs by iterating the existing `approvePostAction` over `rows`, or (c) make the label + removal + announce all use the same filtered set and accept that campaign-scoped bulk is the documented behavior only when unfiltered. (a) is the smallest safe change.

### MINOR

**m1 — APV-PAGINATED is a hard `LIMIT 200` with no pagination/virtualization and no overflow signal.** `posts.ts:106,129`. Drafts beyond the 200th (ORDER `scheduled_at ASC`) are silently invisible — no "showing 200 of N", no next page. Low impact at launch caps (trial 50, Plus 50/mo) but the ADR §9.4 called for paginate/virtualize. Add an overflow indicator or real pagination before high-volume plans. ⚠️ **Partially addressed Session 22 W2 (A2)** — the "no overflow signal" half is fixed (honest "showing N of total" via the server-side filter-scoped `total`); real pagination/virtualization remains open, tracked as `21C-pagination` in `docs/backlog.md`.

**m2 — Skip button label fails WCAG-AA contrast in light theme.** `ApprovalsInbox.tsx:270` uses `text-amber-400` on `bg-card`. In light mode amber-400 (~#fbbf24) on near-white is ≈1.7:1 — well below the 4.5:1 AA floor the Session-20/§12 bar requires. (Approve/bulk `emerald-700`+white ≈4.8:1 pass; platform badge `slate-800`/`slate-300` passes.) Darken for light theme (e.g. `amber-700`) or give the ghost button a filled background. ✅ **Fixed Session 22 W2 (A3)** — contrast verified AA-compliant in both light and dark themes.

### NIT

- **n1 — Stale comment in `DashboardShell.tsx` (export area, near `APPROVALS_NAV_CAPABILITY`):** still reads *"…gated (approver + admin) and inert here, matching COMING_SOON_NAV's rendering,"* but 21C changed the entry to a live `<Link href="/approvals">` (`:157-169`; the render-area comment was correctly updated to "activated 21C/C1"). Comment rot — update the export-area comment to match. ✅ **Re-verified Session 22 B6** — already closed at HEAD (comment reads "activated 21C/C1", `DashboardShell.tsx:157`); no new work needed.
- **n2 — C1 and C2 are squashed into one commit** ("session 21"), so D1 ("C2 visual/a11y-only, no behavioral change from C1") cannot be verified by commit boundary. The inbox is behaviorally coherent, but the phase-isolation claim is unverifiable from history.
- **n3 — Server-side filter params unused.** `listPendingDraftPosts` accepts `campaignId`/`platform` (`posts.ts:101-102,125-126`) but `page.tsx:40` passes only `businessId`; all filtering is client-side over ≤200 rows. Fine, but the params are currently dead. ✅ **Fixed Session 22 W2 (A2)** — `listPendingDraftPosts`/`countPendingDraftPosts` now honor `campaignId`/`platform` server-side; `page.tsx` passes them from `searchParams` (also closes `m1`'s "no overflow signal" via the new filter-scoped `total`).

---

## Section E — constraint coverage

- **Security boundary (non-approver cannot `→approved`):** CI-executed via the existing `posts-approval-boundary.test.ts` (21A, `POSTS_APPROVAL` flag, live Postgres). 21C adds no write path, so this is untouched and still green.
- **ROLE-APPROVALS-GATED, APV-SINGLE-AND-BATCH, APV-EDIT-REVERT-LEGIBLE, APV-REJECT-SKIP, APV-EMPTY-STATE, APV-FILTER, APV-PAGINATED:** covered by authored Vitest (`page.test.tsx`, `ApprovalsInbox.test.tsx`, `posts.calendar.test.ts`), run by `npx vitest run` locally. ⚠️ **No CI workflow executes them** — the sole workflow (`db-tests.yml`) runs `supabase/__tests__` only (same coverage-visibility gap flagged in the 21B review). Not a BLOCKER: the redirect/UX constraints are echoes, and the real boundary is CI-covered. Note the M1 filter/bulk mismatch is a behavior these Vitest tests do **not** currently assert (add a test: bulk-approve under an active platform filter must not approve filtered-out drafts). ✅ **Fixed Session 22 W1 (ADR 0015)** — the new `app-tests.yml` runs `vitest run app/ lib/ components/` (this whole suite) as a standalone required CI job on every push/PR, and the M1 regression test now exists (bulk-approve under an active filter is asserted server-side, A1).

---

## Verdict

**Blockers before merge:** none.

**Should fix before merge:** **M1** (bulk-approve ignoring the platform filter → over-approval of un-reviewed drafts + misleading count). This is the one finding that touches the product's human-in-the-loop promise, even though authorization is intact. ✅ **Fixed Session 22 W2 (A1/A1.1).**

**Tech-debt acceptable to defer:** m1 (pagination beyond 200 — overflow-signal half ✅ fixed Session 22 A2, real pagination still deferred), m2 (skip-label contrast — ✅ fixed Session 22 A3), n1 (comment rot — ✅ re-verified already closed, Session 22 B6), n2 (still open, historical/unfixable), n3 (✅ fixed Session 22 A2).

**Correction to the 21B review (this reviewer's own error):** the 21B report's **M1** ("DashboardShell ships a live `/approvals` link that 404s on 21B-alone") was **incorrect** — it was derived from reading `DashboardShell.tsx` at HEAD, which already contained 21C. At the actual 21B commit `c07dafda`, the Approvals entry was an inert `<span title=coming_soon>` (correctly gated + inert per the ADR), and the live `<Link>` was introduced here in 21C, where `/approvals` exists. **21B M1 is withdrawn.** The only residual is the stale export-area comment (n1 above). No other 21B finding is affected.

**Process (unchanged from 21B):** the `db-tests` CI stack still OOM/recovery-crashes intermittently; the app-layer Vitest suite (including all of 21C's inbox tests) is not wired into any CI job. Recommend (a) fixing the OOM and (b) adding a CI job that runs the full Vitest suite, so APV/ROLE coverage is executed on every push rather than locally only. ✅ **Fixed Session 22 W1 (ADR 0015)** — filed as backlog `21C-ci-gap` (app-tests.yml) and `21C-pg-oom` (config.toml service disables + memory knobs + skip-guard; `db-tests` promotion now tracked via the three-green tally in `docs/current-phase.md`).
