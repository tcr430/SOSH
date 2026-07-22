# Session 20 — Content Calendar (ADR 0012)

> **Goal:** A month-grid content calendar. Scheduled and published posts appear as
> **per-campaign, per-day boxes** (campaign colour + the platform icons present that day).
> Click a box → a left preview/edit pane lists that campaign's posts for that day (one row per
> platform). Drafts show an approval-required affordance and can be approved in place; published
> posts render in a more transparent box and show metrics. Movable posts reschedule by drag
> (day-only, never into the past). Create-campaign is live; create-post is a disabled
> "coming soon" stub.
>
> **How to use this file:** paste each phase into Claude Code in order. **Architect → Opus.
> Builder → Sonnet. Reviewer → Opus. Correction → Opus.** The Architect prompt below is
> complete; Builder / Reviewer / Correction are **stubs** to expand once the ADR exists.
>
> **§0 holds the decisions already locked with the founder on claude.ai.** They are *binding
> input* to the Architect prompt — pasted inside it so the Architect does not re-litigate them.

---

## §0 — Locked decisions (binding input — adjudicated on claude.ai)

**Locked (L):**

- **L-A** Box per `(campaign, day)`; click opens a left pane previewing each per-platform post.
- **L-B** No roles. One user/business (owner). Approval = owner flips `draft → approved`.
  `business_members` / "approval credentials" stay Phase 2. No permission concept this session.
- **L-C** Draggable set = `draft` + `approved` only (`scheduled` excluded — it's worker-claimed).
  Reschedule is day-only and may never target a past day (business-tz).
- **L-D** Editing an `approved` post reverts it to `draft`. Published posts are read-only.
- **L-E** New read path acceptable in this window: `(business_id, scheduled_at)` index + bounded
  calendar helper.
- **L-F** Calendar coexists with the existing approve-queue + campaign detail; it is launch-
  blocking. Create-campaign live (redirect to campaign creation); create-post disabled + "coming
  soon" hover.
- **L-G** Box is transparent only when *every* contained post is `published`; else solid.
  Approval badge if *any* draft; failure dot if *any* failed.
- **L-H** Drag model: group-drag the box when *all* its posts are movable; per-post date control
  in the pane for mixed boxes / single-platform precision. No second drag system.
- **L-I** `/ecc:` prefix; `impeccable-design-and-taste` + taste pass on calendar shell, box, pane.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-A | Grouping key | `(campaign_id, business-tz day)`, derived | per-post blocks (doesn't match box-per-campaign-day); `(generationSessionId, day)` (a session spans many days/platforms) |
| D-B | Box visual state | transparent iff all-published; badge iff any-draft; failure dot | per-icon status tinting (grid noise) |
| D-C | Draggable set | `{draft, approved}` | include `scheduled` (worker-claimed/in-flight — races publish + reaper) |
| D-D | Drag model | group-drag all-movable + per-post date control | pane→grid individual drag (fiddly, +build); per-post blocks w/ drag (conflicts with grouped box) |
| D-E | Reschedule semantics | day-only, preserve local time, no past, atomic guard | free datetime drag (scope; optimal-time schedule already chose times) |
| D-F | Edit of approved | revert → draft | edit-in-place keep-approved (integrity: approved ≠ published content) |
| D-G | DnD lib | `@dnd-kit/core` | native HTML5 DnD (a11y/touch); react-dnd (heavier) |
| D-H | Read path | new `(business_id, scheduled_at)` partial index + bounded helper + transform | reuse `(business_id, created_at)` (wrong sort key → range full scan) |
| D-I | Timezone | business IANA tz for grid/day/past/preserve | UTC-day grouping (wrong calendar day off-UTC) |
| D-J | Create-post button | disabled + coming-soon | omit (loses discoverability); ship now (deferred feature) |
| D-K | Coexistence | additive; keep approve-queue + campaign detail | replace existing surfaces pre-launch (needless risk) |
| D-L | Reschedule helper | net-new `reschedulePost`; reuse approve/edit/metrics | reuse worker requeue helpers (different invariants) |

**Anchor ADRs:** 0001 (schema: flat `posts` per `(campaign,platform)`, `scheduled_at NOT NULL`,
no colour/group column, `post_metrics` NULL=missing vs 0=real, RLS), 0004 (generation: schedule
algorithm, `ai_generation_metadata.generationSessionId`), 0005 (publishing: `approved →
scheduled → published`; **`scheduled` = worker-claimed**; `scheduled_at` mutable — Reversal 3;
helpers `claimPostsForPublishing`/`markPostPublished`/`requeueScheduledPost`/`reapStuckScheduledPosts`),
0006 (metrics worker).

---

## §1 — Architect prompt  (paste into Claude Code · Opus · FULL)

```
You are the ARCHITECT for SŌSH Session 20. Produce ONE design-only ADR. Do not write .ts or
.sql files this phase — TypeScript signatures appear as contract code blocks inside the ADR; the
Builder writes the real files next session.

OUTPUT: docs/decisions/0012-content-calendar.md

READ FIRST (ground every claim in the actual repo — do not guess):
- CLAUDE.md (conventions, strategic decisions).
- docs/build-guide/session-20.md
- docs/decisions/0001 (posts/campaigns/post_metrics, status enum, RLS), 0004 (schedule algo +
  generationSessionId), 0005 (publish state machine; scheduled = worker-claimed; Reversal 3),
  0006 (post_metrics shape).
- lib/db/posts.ts, lib/db/campaigns.ts, lib/db/post-metrics.ts — existing helpers + the post
  status VALID_TRANSITIONS.
- The existing post review/approve UI and its Server Actions; the existing post-edit surface;
  the Session-18 unapprove/revert path.
- supabase/migrations/ — the latest sequential migration number.
- package.json — whether date-fns-tz is already a dependency.

BINDING DECISIONS (already adjudicated with the founder — encode them, DO NOT re-open them):
[session-20.md §0 L-A…L-I and the D-A…D-L]

THE ADR MUST SPECIFY:
1. Reversals / relationship to prior ADRs. (Expect: none — purely additive: one new index + one
   net-new mutation `reschedulePost`; everything else composes existing helpers. Depends on ADR
   0005 Reversal 3 — ours is the first USER-driven scheduled_at write.)
2. Named constraints the Reviewer can grep — author them as CAL-1..CAL-9 covering at minimum:
   grouping is derived not stored (no post_group_id, no campaigns.color); business-timezone is
   the calendar's clock for day-assignment, grid edges, "is it past", and preserved time-of-day,
   while storage stays UTC; draggable set = {draft, approved} enforced in the SQL WHERE guard;
   no past target (server-authoritative); atomic worker-safe reschedule (guarded single-statement
   UPDATE, zero-row ⇒ "claimed", no FOR UPDATE); edit-of-approved reverts to draft in the write
   path; bounded read (LIMIT + ORDER BY + overflow signal); no new quota/plan-limit path; reuse
   existing approve/unapprove/edit/updatePost/metrics — only reschedule is net-new.
3. Surface & routes under app/[locale]/(dashboard)/calendar/ (page.tsx Server Component; actions.ts;
   CalendarView client; components MonthGrid/DayCell/CampaignDayBox/PostDayPanel/PostRow/
   CalendarToolbar). Add a 6th DashboardShell nav item.
4. Read path: (a) migration adding a PARTIAL index idx_posts_business_scheduled_at on
   posts(business_id, scheduled_at) WHERE deleted_at IS NULL — allocate the real next number;
   (b) lib/db/posts.ts listPostsForCalendar({businessId, rangeStartUtc, rangeEndUtc, limit?})
   returning flat rows joined to campaigns(name) + LEFT JOIN post_metrics, ORDER BY scheduled_at,
   explicit LIMIT+1 overflow; range edges are the business-tz visible-grid edges converted to UTC;
   (c) lib/calendar/group.ts pure groupByCampaignDay(rows, tz) → CampaignDayCell[] computing
   platforms/allPublished/anyDraft/anyFailed/allMovable; (d) lib/calendar/colors.ts pure
   deterministic colorIndex = hash(campaignId) % PALETTE.length (mechanism only; palette hex owned
   by the design plugin).
5. Box visual aggregation per L-G/D-B (colour, transparent-iff-all-published, badge-iff-any-draft,
   failure dot, distinct platform icons; status nuance lives in the pane, not per-icon).
6. Left pane PostDayPanel: per-post preview, status chip, Edit (reverts approved→draft via the
   existing revert helper), Approve (if draft, existing action), per-post "move to…" date control,
   and metrics for published posts rendering NULL ("—", not reported) distinctly from real 0.
7. Reschedule: net-new lib/db/posts.ts reschedulePost(client,{postId,businessId,newScheduledAtUtc})
   = UPDATE ... WHERE id=$ AND business_id=$ AND status IN ('draft','approved') AND
   published_at IS NULL AND deleted_at IS NULL RETURNING id (updated = rowCount===1). new instant
   computed by pure lib/calendar/reschedule.ts preserving the post's business-tz time-of-day on
   the target day (date-fns-tz), written with formatISO. Two Server Actions: reschedulePostAction
   (per-post) and rescheduleDayGroupAction (group; proceeds only if EVERY post in the source box
   is movable; one transaction; returns {moved,skipped}). Both re-derive businessId server-side
   (IDOR) and reject past business-tz days. Include the worker-race worked example (worker-wins ⇒
   our update hits 0 rows ⇒ reason 'claimed'; user-wins ⇒ future scheduled_at ⇒ worker predicate
   no longer matches).
8. Create buttons (L-F/D-J): create-campaign live redirect; create-post disabled + coming-soon.
9. DnD: @dnd-kit/core (+utilities), pinned; keyboard + pointer sensors. Box draggable iff
   allMovable; DayCell droppable; drop → rescheduleDayGroupAction.
10. Cross-cutting: i18n/{en,pt,es}/calendar.json (EN authored; PT/ES mirror, flagged for the
    deferred translation session; no hardcoded strings); a11y (boxes are buttons; DnD keyboard
    path; transparent-box contrast; badges/dots carry text alternatives); observability (3 canonical
    JSON log lines: reschedule_post / reschedule_group / reschedule_rejected{reason}; Sentry id-only);
    security (RLS reads, server-derived businessId, SQL-guarded reschedule, bounded queries);
    config/boundaries (env via lib/config.ts; db via lib/db/; no process.env / console.* / any).
11. File manifest (NEW vs EDIT vs CONFIRM-EXISTING-EXPORT).
12. Decision ledger — restate D-A..D-L AND surface a named loser at any further contested point
    you introduce.
13. Test plan (TDD order: colors → group → reschedule(tz/DST) → db helpers → actions(IDOR/past/
    claimed/mixed-refusal) → components).
14. Open follow-ups: single-post create; campaign-bound clamping (NOT v1 — only "no past"); PT/ES
    calendar strings; multi-user approval (Phase 2); promote group reschedule to an RPC if hot.

RESOLVE FROM THE REPO (state each explicitly in the ADR; do not invent):
- exact existing export names for approve, unapprove/revert, edit, updatePost, and the metrics read;
- the real next migration number;
- whether date-fns-tz is installed (add to manifest if not).

GUARDRAILS: design-only; no schema COLUMN added (colour + grouping are derived); every contested
decision shows a named loser; honour all CLAUDE.md conventions. Finish with a ≤15-line summary
listing any place the repo was ambiguous and the assumption you made.
```

---

## §2 — Part B · Builder (Sonnet)

> Transcribes **ADR 0012 Rev B** into code. Seven BP prompts in three groups; each runs
> `/ecc:plan` (wait for approval) → `/ecc:tdd-workflow` → `/ecc:verification-loop`. Mandatory stop
> between prompts; `/exit` + fresh Claude Code session between groups. `claude-mem` runs throughout
> as usual. The Builder transcribes, never redesigns — ADR conflicts are **surfaced**, not resolved.

### Before Part B (pre-flight checklist)

- [ ] ADR `docs/decisions/0012-content-calendar.md` is at **Rev B** and committed (every `§`/`CAL`/`R`
      reference below points at Rev B).
- [ ] `date-fns-tz`, `@dnd-kit/core`, `@dnd-kit/utilities` are **absent** from `package.json`
      (ADR §11) — installed inside the BPs that first need them.
- [ ] Existing exports resolved (ADR §11) — fix the BP body before running if any name differs:
      `approvePost`/`approvePostAction`, `unapprovePost`/`unapprovePostAction`,
      `updatePostContent`/`updatePostContentAction`, `getPostMetricsByPostId`, `getBusinessByOwner`,
      `getPostById`, `toUtcIso`, `BusinessRow.timezone`.
- [ ] `calendar` is present in `COMING_SOON_NAV` in `DashboardShell` (BP4 promotes it).
- [ ] Migrations are timestamp-prefixed; latest is `20260623210000_voice_axes.sql` (BP2 bumps if a
      newer one has since landed).
- [ ] `session-20.md` + ADR 0012 committed so the Reviewer can diff against the brief.

### Run order & session hygiene

Dependencies: **BP1** (pure) is foundation → **BP2** (data) → **BP3** (actions) depend on it;
**BP4** (shell+grid) depends on BP1+BP2; **BP5** (pane) and **BP6** (DnD) depend on BP3+BP4;
**BP7** (taste/a11y) depends on BP4–BP6. Groups (fresh session each, `/exit` between):
**{BP1–BP3 backend}** · **{BP4–BP6 UI}** · **{BP7 design/taste}**.

### Builder Primer (paste once at the start of the first Builder session)

```
You are the Builder for SOSH Session 20, Part B (Sonnet). You transcribe ADR 0012 Rev B into
code; you do not redesign it.

Read before starting and confirm:
- CLAUDE.md — conventions (env only via lib/config; DB only via lib/db; authenticated client for
  calendar reads, NO service-role; date-fns formatISO for timestamp writes; no unbounded queries;
  no any; no console.*; all strings via next-intl).
- docs/decisions/0012-content-calendar.md — Rev B, in full (this is the spec).
- docs/sessions/session-20.md — Part B (this file): run order, the seven BP prompts, and the
  per-BP "Read first" list. Read the ADR sections named in each BP before that BP's /ecc:plan.

Restate these invariants back to me before BP1:
1. ADR 0012 Rev B is the contract. Transcribe; do not redesign. Reuse the existing approve /
   unapprove / edit / metrics exports (CAL-9). The ONLY net-new DB mutation is reschedulePost.
2. Business timezone is the calendar's clock (CAL-2): day buckets, visible-grid edges, the "is it
   past?" test, the preserved time-of-day, AND the group source-box re-read are all in
   business.timezone. Storage stays UTC (formatISO). The group re-read uses a UTC range derived
   from sourceDayKey — NEVER date(scheduled_at) (R3).
3. Reschedule is atomic + worker-safe (CAL-5): one guarded UPDATE, status IN ('draft','approved')
   AND published_at IS NULL AND deleted_at IS NULL; 0 rows => {updated:false} => reason 'claimed'.
   Never throw, no FOR UPDATE, no SELECT-then-write.
4. Draggable set = {draft, approved} only (CAL-3). Minimum reschedule target = TOMORROW in
   business tz (CAL-4 / R6); today or earlier => 'too_soon'.
5. Edit-of-approved reverts FIRST, then writes (CAL-6 / R2): unapprovePost -> updatePostContent.
6. Read is bounded (CAL-7): LIMIT = CALENDAR_POST_LIMIT (5000) + a +1 overflow probe; overflow
   drives a VISIBLE header banner, never silent truncation (the dropped rows are the latest
   in-window).
7. No new quota / plan-limit path (CAL-8). No service-role anywhere in the calendar path.

Workflow per BP: /ecc:plan (wait for approval) -> /ecc:tdd-workflow -> /ecc:verification-loop.
Confirm the invariants, then wait for BP1. Do not start coding from the primer alone.
```

---

### BP1 — Pure calendar core (ADR §4c/§4d/§7b/§5/§6 · D-A/D-B/D-O · R5/R7/R8)

**Read first:** ADR 0012 Rev B **§4c** (group), **§4d** (colors), **§7b** (reschedule instant),
**§5** (box flags), **§6** (platform link); CLAUDE.md (pure-module placement, no `any`).

```
You are the Builder for SOSH Session 20B — the pure calendar layer (no I/O, no React, no DB).

DELIVERABLES:
- Install date-fns-tz (pin the version).
- lib/calendar/colors.ts — colorIndex(campaignId, paletteLength): stable hash % length. Mechanism
  only; no palette hex here (CAL-1).
- lib/calendar/group.ts — groupByCampaignDay(rows: CalendarPostRow[], tz): CampaignDayCell[].
  Day bucket = formatInTimeZone(scheduled_at, tz, 'yyyy-MM-dd'). Compute platforms (distinct,
  stable), allPublished, anyDraft, anyFailed, allMovable (every status in {draft,approved}),
  allSkipped (every status === 'skipped' — R7). Deterministic cell order (dayKey, campaignName,
  campaignId). PURE — "today" is passed in where needed, never Date.now() inside.
- lib/calendar/reschedule.ts — computeRescheduledInstant(currentScheduledAtUtc, targetDayKey, tz):
  take the post's business-tz wall-clock time-of-day, place it on targetDayKey in tz, convert back
  to UTC (toZonedTime / fromZonedTime), return formatISO. DST policy (R8): on a gap, forward-shift;
  on an overlap, earlier offset (date-fns-tz default — adopted intentionally).
- lib/calendar/platform-url.ts — buildPlatformPostUrl(platform, platformPostId): string | null.
  Null for opaque/missing ids; a real URL only for platforms whose id maps to a public URL (R5).

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD TEST LIST:
- colors: deterministic; in [0, paletteLength); spreads across the palette for different ids.
- group: multi-platform same day -> one cell, distinct icons; same-platform twice -> one icon, two
  posts; mixed statuses -> correct allPublished/anyDraft/anyFailed/allMovable/allSkipped; an off-UTC
  tz (e.g. Pacific/Honolulu) buckets a near-midnight instant onto the correct LOCAL day; stable order.
- reschedule: preserves business-tz wall time onto the target day across DST forward AND backward
  (Europe/Lisbon spring-forward + autumn-back) and off-UTC (Pacific/Honolulu); output is formatISO UTC.
- platform-url: null for missing/opaque id; URL for a known platform + id.

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- Grouping is derived, never stored (CAL-1). allMovable = draft|approved only. allSkipped = all
  skipped (R7). DST gap/overlap policy is the named R8 behaviour. buildPlatformPostUrl is nullable
  and the link renders only when non-null (R5).

BUILDER BOUNDARY:
- No DB, no React, no Date.now() inside the pure fns. If a "pure" fn seems to need I/O or the spec
  seems wrong, STOP and output: "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP1 complete. Awaiting next prompt." Then stop.
```

---

### BP2 — Migration + read/reschedule DB helpers (ADR §4a/§4b/§7a · CAL-1/5/7 · D-H · R1)

**Read first:** ADR 0012 Rev B **§4a** (index), **§4b** (`listPostsForCalendar` + `CalendarPostRow`),
**§7a** (`reschedulePost`); ADR 0001 (`posts`/`campaigns`/`post_metrics` + RLS); CLAUDE.md
(`lib/db`, no-unbounded-query, formatISO).

```
You are the Builder for SOSH Session 20B — the calendar's data layer: one index migration and two
DB helpers.

DELIVERABLES:
- Migration supabase/migrations/20260628120000_posts_scheduled_at_idx.sql (confirm this is still the
  latest timestamp; bump if a newer migration landed). INDEX ONLY — no column, no grouping stored:
    create index if not exists idx_posts_business_scheduled_at
      on public.posts (business_id, scheduled_at) where deleted_at is null;
- lib/db/posts.ts additions:
  - CalendarPostRow type: campaign_id, campaign_name (join), platform, status, content, hashtags,
    scheduled_at, published_at, platform_post_id (raw), metrics (nested nullable object; LEFT JOIN
    post_metrics — null row => never synced).
  - CALENDAR_POST_LIMIT module const = 5000.
  - listPostsForCalendar(client, {businessId, rangeStartUtc, rangeEndUtc, limit?}): WHERE
    business_id + scheduled_at >= start AND < end AND deleted_at IS NULL; JOIN campaigns(name);
    LEFT JOIN post_metrics; ORDER BY scheduled_at; ask LIMIT (limit ?? 5000) + 1; if the extra row
    returns, drop it and set overflow = true. Use the AUTHENTICATED client (RLS) — never service-role.
  - reschedulePost(client, {postId, businessId, newScheduledAtUtc}): single guarded statement
    UPDATE public.posts SET scheduled_at = :new WHERE id=:postId AND business_id=:businessId AND
    status IN ('draft','approved') AND published_at IS NULL AND deleted_at IS NULL RETURNING id;
    return {updated: rowCount === 1}. No FOR UPDATE, no prior SELECT.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD TEST LIST:
- listPostsForCalendar: range filter; ORDER BY scheduled_at; LIMIT+1 overflow flag; soft-deleted
  excluded; campaign-name joined; null metrics row preserved (distinct from zeros).
- reschedulePost: updates draft/approved; 0 rows for scheduled/published/failed/deleted/
  wrong-business; updated reflects rowCount.

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- Index-only migration, no grouping/colour column (CAL-1). Bounded read + overflow flag at 5000
  (CAL-7 / R1). Guarded single-statement UPDATE; {updated:false} is a legitimate outcome, never an
  exception (CAL-5). RLS read client only (no service-role).

BUILDER BOUNDARY:
- No actions, no UI here. Do NOT touch the worker helpers (claimPostsForPublishing /
  requeueScheduledPost / reapStuckScheduledPosts) — different invariants (CAL-9). ADR conflict =>
  "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP2 complete. Awaiting next prompt." Then stop.
```

---

### BP3 — Server actions (ADR §6/§7c · CAL-3/4/5/6 · R2/R3/R4/R6/R9)

**Read first:** ADR 0012 Rev B **§7c** (actions), **§6** (edit/approve), **§2** CAL-3..6; CLAUDE.md
(server actions, `revalidatePath`, Zod, server-derived businessId).

```
You are the Builder for SOSH Session 20B — the calendar's Server Actions.
File: app/[locale]/(dashboard)/calendar/actions.ts

DELIVERABLES (all re-derive businessId server-side via getBusinessByOwner; all Zod-validate input;
all revalidatePath('/[locale]/calendar','page') on success — verify this form for the dynamic
[locale] segment under Next 16, R11):
- reschedulePostAction(postId, targetDayKey):
  Zod (uuid + 'yyyy-MM-dd'); reject targetDayKey earlier than TOMORROW in business.timezone ->
  reason 'too_soon' (CAL-4 / R6); load the post (getPostById, RLS); computeRescheduledInstant
  (BP1); reschedulePost (BP2). {updated:false} -> reason 'claimed'. Returns
  {ok:true} | {ok:false, reason:'invalid_input'|'too_soon'|'claimed'|'generic'}.
- rescheduleDayGroupAction(campaignId, sourceDayKey, targetDayKey):
  Reconstruct the source box TZ-CORRECTLY (R3): convert sourceDayKey to a [startUtc,endUtc) range in
  business.timezone (same edge math the page uses) and read the campaign's posts in that range —
  NEVER date(scheduled_at). If ANY post is not in {draft,approved} -> {ok:false, reason:'mixed'}
  (move nothing). Else move each (preserve per-post wall time) in ONE transaction (a small RPC or a
  single multi-row guarded UPDATE keyed by post ids); return {ok:true, moved, skipped} where skipped
  counts rows that returned 0 (worker claimed one mid-flight — partial success is fine). 'too_soon'
  guard as above.
- updatePostFromCalendarAction(postId, content fields):
  If the post is 'approved', call unapprovePost FIRST (-> draft), THEN updatePostContent (CAL-6/R2) —
  a failure after the revert leaves a safe un-edited draft. Reject for published/scheduled.
- approvePostFromCalendarAction(postId): thin wrapper calling approvePostAction AND
  revalidatePath the calendar (R4).

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD TEST LIST:
- IDOR: businessId re-derived; a client-supplied post from another business is rejected.
- today-or-earlier rejected as 'too_soon' in an OFF-UTC tz (R6).
- group source-box re-read is tz-correct: an off-UTC business buckets posts to the right local day (R3).
- 'claimed': reschedulePost 0-row -> reason, no throw.
- 'mixed': one non-movable post in the box -> nothing moves.
- partial 'skipped' on a simulated worker race (one row returns 0).
- revert-first ordering: a failure injected BETWEEN unapprove and update leaves an un-edited DRAFT,
  never edited-but-approved content (R2).
- Zod rejection on malformed uuid/date.

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- Min target tomorrow (CAL-4/R6). Atomic guard (CAL-5). Revert-first edit (CAL-6/R2). Tz-correct
  group re-read (R3). Reuse approve/unapprove/edit (CAL-9). No new quota path (CAL-8).

BUILDER BOUNDARY:
- No UI. The group action only RETURNS {moved, skipped}; per-post reconciliation is the client's job
  (BP6). ADR conflict => "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP3 complete. Awaiting next prompt." Then stop.
```

> **Group gate:** BP1–BP3 all green. `/exit`, fresh Claude Code session for the UI group.

---

### BP4 — Shell, read wiring, month grid + box (read-only) (ADR §3/§4/§5/§8/§10 · L-F/L-G · R1/R7)

**Read first:** ADR 0012 Rev B **§3** (routes/nav), **§4** (read path), **§5** (box aggregation),
**§8** (create buttons), **§10** (i18n/a11y); CLAUDE.md (next-intl, shadcn/ui).

```
You are the Builder for SOSH Session 20B — the calendar shell, server read wiring, month grid, and
the read-only campaign-day box. No pane interactivity (BP5), no drag (BP6).

DESIGN POSTURE (impeccable-design-and-taste, embedded — not a CC plugin):
- Quiet, professional B2B calendar. Generous whitespace, restrained motion. Campaign colour is the
  organizing signal; published work RECEDES (transparent), pending work is SOLID. shadcn/ui per stack.

DELIVERABLES:
- page.tsx (Server Component): auth + business resolve; compute the visible month's business-tz grid
  edges and convert to UTC; listPostsForCalendar (BP2); groupByCampaignDay(rows, tz) (BP1); pass
  cells + tz + overflow to CalendarView. No other data props.
- CalendarView.tsx ('use client'): month state + prev/next/today; renders MonthGrid; renders a
  NON-BLOCKING overflow banner in the header when overflow is true (R1 — "some posts aren't shown").
- components/MonthGrid.tsx + DayCell.tsx: 6x7 grid; mark past / today / out-of-month; render the
  day's CampaignDayBox[]. (Static render only — droppable wiring is BP6.)
- components/CampaignDayBox.tsx: a real <button> (opens the pane in BP5). Colour = palette[colorIndex];
  transparent iff allPublished, else solid; approval badge iff anyDraft; failure dot iff anyFailed;
  muted/struck iff allSkipped (R7); distinct platform icons (presence-only). Badge/dot/muted carry
  TEXT ALTERNATIVES (never colour-only).
- components/CalendarToolbar.tsx: month nav; Create campaign (live -> existing campaign-create route);
  Create post (disabled + "coming soon" title; no handler — L-F/D-J).
- DashboardShell.tsx: promote calendar from COMING_SOON_NAV to ACTIVE_NAV (D-Q) — do not add a
  duplicate key.
- i18n/en/calendar.json (EN authored); i18n/pt + i18n/es mirror EN verbatim, flagged for the
  translation session. No hardcoded user-facing strings.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.
(UI tests cover the behavioral contract — render logic from a cell — not pixel snapshots.)

TDD TEST LIST:
- Box renders transparency/badge/dot/muted/icons correctly from a given cell.
- Overflow banner shows iff overflow.
- Create post is disabled; Create campaign links to the campaign-create route.
- Nav: calendar moved to ACTIVE_NAV (no duplicate key).

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- §5 aggregation incl. muted-skipped (R7/L-G). Visible overflow banner (R1/CAL-7). Create-post
  disabled (L-F/D-J). Palette hex is finalized in BP7 — here use the colorIndex mechanism with
  placeholder tokens.

BUILDER BOUNDARY:
- No pane interactivity (BP5), no DnD (BP6). ADR conflict => "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP4 complete. Awaiting next prompt." Then stop.
```

---

### BP5 — Left pane: preview / approve / edit / metrics / move-to (ADR §6 · CAL-4/6 · R2/R5/R6/R10)

**Read first:** ADR 0012 Rev B **§6** (pane), **§7c** (actions consumed); locks L-D/L-F; CLAUDE.md.

```
You are the Builder for SOSH Session 20B — the left preview/edit pane. Consumes the BP3 actions;
re-implements no business logic.

DESIGN POSTURE (impeccable-design-and-taste, embedded):
- Selecting a box animates the grid to the right and opens the pane on the left (calm, restrained
  transition; narrow-viewport overlay-sheet behaviour is finalized in BP7). Readable post rows;
  metrics legible with an unmistakable "—" (not reported) vs "0" (real).

DELIVERABLES:
- PostDayPanel.tsx: opens on box select OR keyboard activation; header (campaign + business-tz date)
  then a PostRow per post in the cell.
- PostRow.tsx: preview (content + hashtags + platform); status chip; Approve iff status==='draft' ->
  approvePostFromCalendarAction; Edit -> updatePostFromCalendarAction (reverts approved->draft FIRST,
  R2/CAL-6), disabled for published/scheduled; per-post "move to..." date picker whose MINIMUM is
  tomorrow computed in business.timezone (R6/R10) -> reschedulePostAction; metrics for published
  (NULL -> "—", real 0 -> "0"); "View on platform" (published) shown ONLY when
  buildPlatformPostUrl(platform, platform_post_id) is non-null (R5).
- Split-pane layout in CalendarView (grid pushes right when a box is selected).

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD TEST LIST:
- Approve shown only for draft.
- Edit triggers the revert-first action; disabled for published/scheduled.
- Metrics "—" vs "0" distinction.
- "move to..." disables today/earlier in BUSINESS tz and is rejected server-side too.
- "View on platform" hidden when buildPlatformPostUrl returns null.

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- Edit revert-first (CAL-6/R2). Min target tomorrow + business-tz picker (CAL-4/R6/R10). Conditional
  platform link (R5). Reuse BP3 actions (CAL-9) — no logic re-impl in the component.

BUILDER BOUNDARY:
- No DnD (BP6). ADR conflict => "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP5 complete. Awaiting next prompt." Then stop.
```

---

### BP6 — Drag-to-reschedule (group-drag, @dnd-kit) (ADR §9/§7c · CAL-3/4/5 · D-D/D-G · R6/R9)

**Read first:** ADR 0012 Rev B **§9** (DnD), **§7c** (group action + per-post reconcile); lock L-H.

```
You are the Builder for SOSH Session 20B — group drag-to-reschedule on the calendar.

DESIGN POSTURE (impeccable-design-and-taste, embedded):
- Drag is calm and legible: movable boxes have a clear affordance; valid drop days highlight;
  today / past / out-of-month visibly reject. Understated, no bounce.

DELIVERABLES:
- Install @dnd-kit/core + @dnd-kit/utilities (pin versions).
- DndContext in CalendarView with PointerSensor AND KeyboardSensor (keyboard reschedule path required).
- CampaignDayBox draggable IFF allMovable; otherwise static (mixed/precision moves use the BP5
  per-post "move to..." — single drag system, L-H/D-D).
- DayCell droppable; today, past days, and out-of-month days REJECT the drop (min target = tomorrow,
  R6; the server still rejects, CAL-4).
- On drop: call rescheduleDayGroupAction(campaignId, sourceDayKey, targetDayKey) with optimistic UI;
  reconcile PER-POST (R9) — a partial 'skipped' snaps back ONLY the unmoved posts, not the whole box;
  handle 'mixed' and 'too_soon' by reverting the optimistic move with a message.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD TEST LIST:
- Draggable only when allMovable.
- Keyboard drag path operable.
- Drop on today / past / out-of-month rejected.
- On drop calls rescheduleDayGroupAction with the right keys.
- Partial 'skipped' reconciles per-post (only unmoved snap back); 'mixed' moves nothing.

LOCKED CONSTRAINTS (ADR 0012 Rev B):
- Draggable set draft+approved (CAL-3). Min tomorrow (CAL-4/R6). Per-post reconcile (R9). Single
  drag system: group-drag + the pane date control (L-H/D-D). @dnd-kit (D-G).

BUILDER BOUNDARY:
- Do NOT add pane->grid individual drag (L-H loser). ADR conflict => "Stopping — ADR conflict at §<n>. Surfacing."

When tests pass and /ecc:verification-loop is clean, output exactly:
"20B-BP6 complete. Awaiting next prompt." Then stop.
```

> **Group gate:** BP4–BP6 all green. `/exit`, fresh Claude Code session for the design/taste pass.

---

### BP7 — Taste & design pass + a11y hardening (impeccable-design-and-taste + taste-skill)

**Read first:** ADR 0012 Rev B **§5**, **§9**, **§10** (a11y); the assembled calendar surface.

```
You are the Builder for SOSH Session 20B — the design/taste pass over the built calendar. This BP is
visual + accessibility only; it must not change any behavioral contract from BP1–BP6.

RUN THE DESIGN PASS:
- Invoke the taste-skill AND impeccable-design-and-taste over the calendar shell, CampaignDayBox,
  PostDayPanel, and the split-pane transition. (If impeccable-design-and-taste is not invokable in
  this CC stack — as in Session 19 — apply its postures from the BP4/BP5/BP6 prompt bodies instead;
  still run the taste-skill pass.)

TARGETS:
- Finalize the campaign palette: >= 8 distinguishable, colour-blind-aware hues; the transparent
  (all-published) variants must keep WCAG AA contrast for text + icons.
- Approval badge, failure dot, and muted-skipped treatment are NON-colour-only (glyph + text alt).
- Split-pane: smooth restrained transition; narrow viewport -> pane becomes an overlay SHEET with the
  grid full-width behind it.
- DnD: visible drag affordance, valid-drop highlight, clear reject styling for today/past; the
  keyboard drag is operable and announced.
- Empty states: a month with no posts; a campaign-day box that is only skipped — both read correctly.

WORKFLOW: run the design/taste pass, then /ecc:verification-loop to confirm NO behavioral regression
(lint, typecheck, scoped vitest). Manual check via npm run dev.

BOUNDARY:
- Visual + a11y only. If a taste fix would require a logic/contract change, SURFACE it — do not
  silently alter BP1–BP6 behaviour.

When the pass is done and /ecc:verification-loop is clean, output exactly:
"20B-BP7 complete. Part B done — ready for Part C (Reviewer)." Then stop.
```

### Verification (every BP)

```
npx vitest run lib/db lib/calendar "app/[locale]/(dashboard)/calendar"
npx tsc --noEmit --skipLibCheck
```

No bare `vitest` / `tsc` (they pull in ECC remotion files). `npm run build` is broken pre-existing;
use `npm run dev` for manual checks.

---

## §3 — Part C · Reviewer (Opus)

> Runs after the Builder commits Part B. Audits the diff against **ADR 0012 Rev B** area by area,
> writes one tiered findings report, and folds in the ECC reviewer agents. The Reviewer writes no
> code and does not redesign — disagreement with a locked decision is a follow-up ADR amendment, not
> a finding.

### How to run

1. Fresh terminal — `/exit` from the Builder session first.
2. `claude` → `/model` → **Claude Opus**.
3. Plugins: `claude-mem` only. **`impeccable-design-and-taste` is off** — the Reviewer *audits* the
   taste/a11y outcomes of BP7 (contrast, non-colour-only signals, keyboard DnD) but does not apply them.
4. Paste the **Primer**; the Reviewer confirms it has read ADR 0012 Rev B and walked the diff.
5. Paste the **Reviewer Prompt**. It writes a tiered report to
   `/docs/reviews/0012-content-calendar-review.md` and runs the ECC reviewer agents, folding findings in.
6. You classify any disputed findings, then ship to the **Part D** correction pass or accept and close.

### Primer

```
/resume-session

Read /CLAUDE.md and /docs/current-phase.md.

Read /docs/decisions/0012-content-calendar.md — Rev B, END TO END.
This is the contract you audit against.

Read the adjacent ADRs this session touches: 0001 §posts/§campaigns/
§post_metrics + RLS; 0004 (flat per-platform posts + the schedule
algorithm); 0005 (publish state machine — approved -> scheduled
(WORKER-CLAIMED) -> published; scheduled_at mutable, Reversal 3;
the worker claim/requeue/reap helpers); 0006 (post_metrics: NULL =
not reported vs 0 = real).

Walk the Builder's Session 20 diff from ADR §4 outward — every file
created or modified is in scope: the posts_scheduled_at index
migration; lib/calendar/{colors,group,reschedule,platform-url}.ts;
lib/db/posts.ts (listPostsForCalendar + reschedulePost +
CalendarPostRow); app/[locale]/(dashboard)/calendar/* (page,
actions, CalendarView, components); DashboardShell nav; and
i18n/{en,pt,es}/calendar.json.

You are the Reviewer. Output is ONE markdown findings report,
tiered: BLOCKER (must fix before merge), MAJOR (should fix before
launch), MINOR (would improve), NIT (preference). You write NO
code. You do NOT redesign — the design is locked in ADR 0012
Rev B; disagreement with a decision is a follow-up ADR amendment,
not a finding. For each finding: name the ADR section / CAL- / R-
or CLAUDE.md convention it violates, quote the offending
code/string briefly, state the expected behaviour. No essays.
```

### Reviewer Prompt

```
You are the Reviewer for SOSH Session 20 — Content Calendar.

DELIVERABLE: a markdown findings report at
/docs/reviews/0012-content-calendar-review.md (create the dir if
missing). Tiered BLOCKER / MAJOR / MINOR / NIT. End with a
one-line verdict: "Ready to ship" / "Ship after correction pass"
/ "Re-architect".

AUDIT AGAINST ADR 0012 REV B, AREA BY AREA. State what you checked
and what you found. A clean area => say "Clean" and move on — no
padding.

§4a READ PATH — index + nav (CAL-1, D-H, D-Q).
 - Migration is INDEX ONLY: idx_posts_business_scheduled_at on
   posts(business_id, scheduled_at) WHERE deleted_at IS NULL. A
   stored grouping key (post_group_id) or a campaigns.color column
   => BLOCKER (CAL-1 — grouping/colour are derived, not stored).
 - calendar promoted COMING_SOON_NAV -> ACTIVE_NAV, no duplicate
   nav key (D-Q). A second literal item => MINOR.

§4b READ HELPER — bounded + RLS (CAL-7, CAL-8 posture, R1).
 - listPostsForCalendar has an explicit LIMIT = CALENDAR_POST_LIMIT
   (5000) + a +1 overflow probe, ORDER BY scheduled_at, a
   scheduled_at range, and deleted_at IS NULL. Missing LIMIT /
   unbounded join => BLOCKER (CAL-7). No overflow flag => MAJOR.
 - Uses the AUTHENTICATED (RLS) client. Service-role anywhere in
   the calendar read OR write path => BLOCKER (security).
 - CalendarPostRow carries raw platform_post_id and a nullable
   nested metrics object (LEFT JOIN; null row preserved, NOT
   coerced to zeros).

§4c/§5 GROUPING + BOX (CAL-1/CAL-2, D-B, R7).
 - groupByCampaignDay buckets by BUSINESS-TZ day
   (formatInTimeZone), not UTC. UTC/date() bucketing => BLOCKER
   (CAL-2 — off-UTC posts land on the wrong calendar day).
 - Box flags exactly: transparent IFF allPublished; approval badge
   IFF anyDraft; failure dot IFF anyFailed; muted/struck IFF
   allSkipped (R7). Wrong opacity/badge rule => MAJOR.
 - Badge / failure dot / muted carry a TEXT ALTERNATIVE — never
   colour-only. Colour-only signal => MAJOR (a11y).
 - colorIndex is a deterministic mechanism; no colour persisted
   (CAL-1).

§6 OVERFLOW BANNER (CAL-7, R1).
 - overflow === true renders a VISIBLE non-blocking header banner.
   Silent truncation (no banner) => MAJOR (the dropped rows are the
   latest scheduled_at in-window — the end of the month blanks).

§7a RESCHEDULE MUTATION — the concurrency heart (CAL-3/CAL-5).
 - reschedulePost is ONE guarded statement: WHERE id=:id AND
   business_id=:biz AND status IN ('draft','approved') AND
   published_at IS NULL AND deleted_at IS NULL RETURNING id. Any
   missing guard clause => BLOCKER (CAL-5).
 - 'scheduled' is NOT movable (it is worker-claimed/in-flight). A
   path that updates scheduled/published/failed => BLOCKER (CAL-3 —
   races the publish + reaper).
 - 0 rows => {updated:false} => surfaced as 'claimed'. Throwing on
   0 rows, or using FOR UPDATE / SELECT-then-write => MAJOR (the
   named loser; the guarded UPDATE is the concurrency primitive).
 - reschedule is the ONLY net-new DB mutation. A new status helper
   duplicating worker logic (claim/requeue/reap) => MAJOR (CAL-9).

§7b TIME MATH (CAL-2, R8).
 - computeRescheduledInstant preserves the post's BUSINESS-TZ
   wall-clock time-of-day on the target day, then converts to UTC
   (formatISO). DST: forward-shift on a gap, earlier offset on an
   overlap (R8). Carrying the UTC time-of-day (local time drifts) =>
   MAJOR. A DST test absent for both directions => MINOR.

§7c ACTIONS — guards, tenancy, tz re-read (CAL-4/CAL-6, R2/R3/R4/R6).
 - Min target = TOMORROW in business.timezone; today or earlier =>
   'too_soon', server-authoritative. Accepting today/past =>
   BLOCKER (CAL-4/R6). "today" computed in browser tz => BLOCKER
   (CAL-2).
 - rescheduleDayGroupAction reconstructs the source box
   TZ-CORRECTLY: sourceDayKey -> [startUtc,endUtc) in
   business.timezone, then reads the campaign's posts in range.
   date(scheduled_at) / UTC bucketing => BLOCKER (R3 — moves the
   wrong posts for off-UTC businesses).
 - Group refusal is ATOMIC: any non-movable post in the box =>
   {ok:false, reason:'mixed'}, MOVES NOTHING. A box that half-moves
   => BLOCKER. Per-post updates run in ONE transaction (RPC or a
   single multi-row UPDATE); sequential awaits with no txn => MAJOR
   (half-moved on crash — named loser).
 - IDOR: businessId re-derived server-side in EVERY action; a
   client-supplied post/business id is never trusted. An action
   that mutates a row keyed only by client input => BLOCKER
   (tenancy).
 - updatePostFromCalendarAction reverts FIRST then writes:
   unapprovePost (-> draft) THEN updatePostContent (CAL-6/R2). Write
   -then-revert, or any single write that can persist edited content
   while status stays 'approved' => BLOCKER (the integrity violation
   CAL-6 exists to prevent). Editing a published post => MAJOR.
 - revalidatePath('/[locale]/calendar','page') on every mutation
   AND in the approvePostFromCalendarAction wrapper (R4). Missing
   on the approve wrapper => MINOR (stale badge). Confirm the form
   is correct for the dynamic [locale] segment under Next 16 (R11).

§6 PANE — metrics + platform link (R5).
 - Metrics distinguish NULL ("—", not reported) from real 0
   (ADR 0006). Rendering null as 0 => MAJOR.
 - "View on platform" (published only) renders ONLY when
   buildPlatformPostUrl(platform, platform_post_id) is non-null.
   A link always built from a raw/opaque id => MINOR (broken links).

§8 CREATE BUTTONS (L-F, D-J).
 - Create campaign links to the existing campaign-create route.
   Create post is DISABLED + "coming soon", no handler. A working
   single-post create (deferred feature) => MAJOR (scope).

§9 DRAG-AND-DROP (CAL-3/CAL-4, D-D/D-G, R6/R9).
 - @dnd-kit; CampaignDayBox draggable IFF allMovable; mixed /
   single-platform precision goes through the pane date control —
   ONE drag system (L-H). A second pane->grid drag system => MINOR
   (L-H loser).
 - DayCell rejects today / past / out-of-month drops (R6); the
   server still rejects (CAL-4). Keyboard sensor present and the
   keyboard reschedule path operable. No keyboard path => MAJOR
   (a11y).
 - Optimistic UI reconciles PER-POST: a partial 'skipped' snaps
   back ONLY the unmoved posts (R9). Whole-box snap-back, or no
   reconcile on 'mixed'/'too_soon' => MAJOR.

§10 CROSS-CUTTING (i18n, plan limits, observability).
 - All user-facing strings via next-intl (calendar namespace);
   pt/es mirror present. Hardcoded English in TSX => MAJOR.
 - No new quota / plan-limit path; no NEW hardcoded plan limit
   (CAL-8 — the plan-limit sweep is still open debt). A fresh
   hardcoded limit => MAJOR.
 - Canonical log lines for reschedule (reschedule_post /
   reschedule_group / reschedule_rejected{reason}); Sentry id-only.
   Missing => MINOR.

CROSS-CUTTING — run the ECC reviewer agents and fold findings in:
 - /ecc:typescript-reviewer — no any; CalendarPostRow / CampaignDayCell
   are shared types; no console.* in committed code; formatISO for
   timestamp writes; listPostsForCalendar bounded; the lib/calendar/*
   modules are pure (no Date.now / no I/O).
 - /ecc:security-reviewer — RLS reads with no service-role in the
   calendar path; businessId server-derived in all actions (IDOR);
   the reschedule guard blocks cross-business AND published/scheduled
   mutation; no personal data placed in URL params by the move-to
   picker or nav.
 - /ecc:cost-aware-llm-pipeline — assert the calendar path makes ZERO
   AI calls (nothing imports lib/ai/runner.ts); it is a pure
   read/mutation surface and adds no per-render or per-mutation model
   call.

Close with the verdict line.
```
---

## §4 — Part D · Correction pass (from the 20C findings)

> **Model:** Builder = **Sonnet**. **Plugins:** `claude-mem` + `/ecc:plan` → `/ecc:tdd-workflow` →
> `/ecc:verification-loop`. 20D-4 embeds `impeccable-design-and-taste` postures in its body; 20D-2
> re-runs `/ecc:security-reviewer`; 20D-5 re-runs `/ecc:security-reviewer`. Mandatory stop between
> prompts.
>
> **Verdict from 20C:** *Ship after correction pass.* The spine conforms; security found no
> BLOCKER/MAJOR; no re-architecture. This pass clears **1 BLOCKER, 4 MAJORs, 6 MINORs, 3 NITs —
> all addressed, none deferred.** Surgical fixes only: a finding that would require **new design**
> is an ADR 0012 amendment, not a correction (this can only apply to **20D-4/MAJOR-4** — see its note).
>
> **Two adjudication calls (flagging, not deferring):** MINOR-2 (approve wrapper business_id guard)
> is a pre-existing helper posture, not a Session-20 regression — fixed here anyway for consistency.
> NIT-3 (pt/es fully translated vs the "mirror verbatim" plan) is harmless over-delivery — **no code
> change**; handled in the closeout by updating the translation tracker.
>
> **Environment:** the 20C review could run `tsc` but the diff **fails the enforced ESLint gate** —
> run `npm install` before the first prompt and let every `/ecc:verification-loop` actually execute
> `eslint` + the scoped `vitest`/`tsc`. **Run 20D-1 first** — it clears the merge-blocking gate.

### Run order

`20D-1` (BLOCKER + the tz-today MAJOR, overlapping files) → `20D-2` (group-move RPC) →
`20D-3` (shared types) → `20D-4` (UI/a11y) → `20D-5` (hardening + observability). 20D-2/20D-3/20D-4/
20D-5 are independent of each other; 20D-1 goes first because BLOCKER-1 blocks merge and it touches
the same `CalendarView` lines as MAJOR-2.

### Verification (every prompt)

```
npx eslint app/[locale]/(dashboard)/calendar lib/calendar lib/db/posts.ts components/calendar components/layout/DashboardShell.tsx
npx vitest run lib/db lib/calendar "app/[locale]/(dashboard)/calendar"
npx tsc --noEmit --skipLibCheck
```

The pre-existing unrelated `refine-from-posts-action.test.ts` tsc error is out of scope — do not fix it.

---

### 20D-1 — Timestamp discipline + business-tz "today" + CalendarView lint (BLOCKER-1 · MAJOR-2 · NIT-2)

```
You are the Builder for SOSH Session 20D — clear the enforced ESLint gate and the UTC "today" bug.
These two findings overlap on CalendarView, so they are fixed together.

DELIVERABLES:
- Route EVERY banned raw .toISOString() through toUtcIso() from @/lib/utils (eslint
  no-restricted-properties TO_ISO_STRING_BAN; CLAUDE.md date rule). The 11 sites (20C BLOCKER-1):
  - lib/calendar/reschedule.ts:38 (drop the false "sanctioned via toUtcIso" comment — actually call it)
  - app/[locale]/(dashboard)/calendar/page.tsx:45,46,49,50
  - app/[locale]/(dashboard)/calendar/actions.ts:79,81
  - app/[locale]/(dashboard)/calendar/CalendarView.tsx:46,52
  - components/calendar/PostRow.tsx:21
- MAJOR-2 (CAL-2 / D-I): CalendarView.tsx getTodayKey() currently uses UTC
  (new Date().toISOString().split('T')[0]). Replace with the BUSINESS-tz day:
  formatInTimeZone(new Date(), tz, 'yyyy-MM-dd') (tz is already a prop). This key feeds isToday
  (grid highlight) and isDayDroppable (client drop boundary) — both must be business-tz. This also
  removes the CalendarView.tsx:52 .toISOString() (do not also "toUtcIso" a value you are deleting).
- BLOCKER-1 effect: CalendarView.tsx:73 useEffect(() => setLocalCells(cells), [cells]) trips
  react-hooks/set-state-in-effect. Remove the prop->state sync effect: derive from cells during
  render, or reset local optimistic state via a keyed remount / useState initializer keyed on a
  cells identity. No eslint-disable without a WHY comment.
- NIT-2: CalendarView.tsx:197,201 ternary-as-statement -> if/else (clears the 2 no-unused-expressions
  warnings).

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD / CHECKS:
- eslint is CLEAN across the calendar diff (0 errors, 0 warnings) — this is the gate.
- A unit test: for an off-UTC tz (e.g. Pacific/Honolulu) near UTC midnight, the client today key
  equals the business-tz local day, and a business-tz-valid "tomorrow" is droppable client-side.
- Existing reschedule/round-trip tests still green (toUtcIso must be behaviourally identical on
  already-UTC instants).

LOCKED CONSTRAINTS (ADR 0012 Rev B): business-tz is the calendar clock (CAL-2). No behaviour change
beyond the tz-today fix; toUtcIso is a formatting swap on already-correct instants.

BUILDER BOUNDARY: do not touch server-side isTooSoon (already correct). ADR conflict =>
"Stopping — ADR conflict at §<n>. Surfacing."

When eslint + scoped vitest + tsc are clean, output exactly:
"20D-1 complete. Awaiting next prompt." Then stop.
```

---

### 20D-2 — Group reschedule atomicity via RPC (MAJOR-1 · D-N)

```
You are the Builder for SOSH Session 20D — make the group move ONE atomic statement, not a
sequential await loop (20C MAJOR-1; D-N names the loop as the rejected loser).

WHY AN RPC (not a plain multi-row UPDATE): each post keeps its OWN business-tz wall-time, so every
row gets a DIFFERENT new scheduled_at — a single .update({scheduled_at}) can't express per-row
values. A SECURITY INVOKER function with jsonb_to_recordset does it in one statement while RLS still
applies (NO service-role — preserve the calendar's no-service-role posture).

DELIVERABLES:
- Migration supabase/migrations/<next-timestamp>_reschedule_posts_batch.sql:
    create or replace function public.reschedule_posts_batch(
      p_business_id uuid, p_moves jsonb
    ) returns setof uuid
    language sql
    security invoker
    set search_path = public
    as $$
      update public.posts p
        set scheduled_at = m.ts, updated_at = now()
      from jsonb_to_recordset(p_moves) as m(id uuid, ts timestamptz)
      where p.id = m.id
        and p.business_id = p_business_id
        and p.status in ('draft','approved')
        and p.published_at is null
        and p.deleted_at is null
      returning p.id;
    $$;
    revoke all on function public.reschedule_posts_batch(uuid, jsonb) from public;
    grant execute on function public.reschedule_posts_batch(uuid, jsonb) to authenticated;
  (SECURITY INVOKER + pinned search_path; RLS on posts still gates. Do NOT grant service_role.)
- lib/db/posts.ts: reschedulePostsBatch(client, { businessId, moves: {id, newScheduledAtUtc}[] })
  -> string[] (moved ids). Calls client.rpc('reschedule_posts_batch', { p_business_id, p_moves }).
  Timestamps via toUtcIso().
- app/[locale]/(dashboard)/calendar/actions.ts rescheduleDayGroupAction: KEEP the tz-correct
  source-box re-read (dayKeyToUtcRange, R3) and the up-front allMovable/mixed refusal. Replace the
  per-post loop with: compute each post's new instant (computeRescheduledInstant), build moves[],
  call reschedulePostsBatch ONCE, then moved = movedIds.length, skipped = requested - moved.
  'too_soon' guard and revalidatePath unchanged.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop; then re-run
/ecc:security-reviewer on the new function.

TDD TEST LIST:
- Batch moves all movable rows in ONE rpc call (no N-call loop).
- A row claimed mid-flight (status flipped to 'scheduled') is ABSENT from moved -> counted in
  skipped; the box reconciles per-post (R9), not whole-box.
- Cross-business rows never move (business_id guard + RLS); function is SECURITY INVOKER, granted
  to authenticated only, search_path pinned.
- Mixed box still refuses up front (moves nothing).

LOCKED CONSTRAINTS: one atomic statement (D-N); guards identical to reschedulePost (CAL-5); no
service-role (security); tz-correct re-read preserved (R3).

BUILDER BOUNDARY: keep single-post reschedulePost as-is. ADR conflict =>
"Stopping — ADR conflict at §<n>. Surfacing."

When clean, output exactly: "20D-2 complete. Awaiting next prompt." Then stop.
```

---

### 20D-3 — Shared calendar types + read typing (MAJOR-3 · MINOR-5)

```
You are the Builder for SOSH Session 20D — collapse the duplicated calendar row types and tighten
the list-read cast (20C MAJOR-3, MINOR-5).

DELIVERABLES:
- MAJOR-3: CalendarPostRow / CalendarPostMetrics are declared TWICE (lib/calendar/types.ts:9-32 and
  independently lib/db/posts.ts:11-34; the promised re-export never happened). Keep ONE canonical
  definition (lib/calendar/types.ts) and `export { CalendarPostRow, CalendarPostMetrics } from
  '@/lib/calendar/types'` (or import + re-export) in lib/db/posts.ts. Delete the divergent copy.
  Nothing in the codebase should import two different shapes (CLAUDE.md: shared types).
- MINOR-5: posts.ts:101 `(data ?? []) as unknown as RawCalendarRow[]` — remove the double cast.
  Type the .select() via the Supabase generic (typed joined shape) or a single narrow cast with a
  runtime-shape rationale comment. No `as unknown as`.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop; re-run
/ecc:typescript-reviewer.

TDD / CHECKS:
- tsc clean; a compile-time assertion (or type test) that lib/db and lib/calendar import the SAME
  CalendarPostRow (identity), so a new field on one cannot silently diverge.
- Existing listPostsForCalendar tests unchanged and green.

LOCKED CONSTRAINTS: one source-of-truth type; no behavioural change.

BUILDER BOUNDARY: types + cast only; no logic edits. When clean, output exactly:
"20D-3 complete. Awaiting next prompt." Then stop.
```

---

### 20D-4 — UI / a11y corrections (MAJOR-4 · MINOR-4 · MINOR-6 · NIT-1)

```
You are the Builder for SOSH Session 20D — the calendar's remaining a11y + UI corrections.

DESIGN POSTURE (impeccable-design-and-taste, embedded — not a CC plugin):
- Any new affordance (a drag handle, if needed) is quiet and unobtrusive — a small grip glyph, not a
  loud control; keyboard focus states are clear; nothing bounces.

DELIVERABLES:
- MAJOR-4 (VERIFY FIRST, then fix): CampaignDayBox is both the dnd-kit draggable (KeyboardSensor) and
  the <button> that opens the pane. Verify by keyboard whether Space/Enter on an allMovable box is
  shadowed by the KeyboardSensor (drag start) so the pane can't be opened via keyboard on exactly the
  actionable boxes. If CONFIRMED: split the drag activator from the open action — put the dnd-kit
  listeners on a dedicated small drag HANDLE inside the box (grip glyph, aria-label "drag to
  reschedule"), leaving the box's Enter/Space to open the pane. Mixed/non-movable boxes are unchanged
  (open-only). If verification shows the two interactions CANNOT be reconciled without changing the
  box-as-button interaction model itself, STOP and output: "Stopping — MAJOR-4 needs an ADR 0012
  interaction amendment, not a correction." (This is the ONE finding that may exceed correction scope.)
- MINOR-4: PostRow.tsx:175 shows Edit whenever !isPublishedOrScheduled, i.e. also for failed/skipped
  (where updatePostContent silently no-ops and the action falsely returns ok:true). Gate Edit to
  status in {draft, approved} only.
- MINOR-6: CampaignDayBox.tsx:114 passes cell.dayKey ('2026-07-01') into box.open_label, so AT reads
  the ISO string. Format a localized date (next-intl / Intl.DateTimeFormat in the active locale) for
  the aria-label.
- NIT-1: CampaignDayBox.tsx:39 showDraftBadge = anyDraft && !allSkipped — drop the redundant
  !allSkipped (allSkipped implies !anyDraft).

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop.

TDD / CHECKS:
- If the drag handle lands: keyboard Enter/Space on an allMovable box opens the pane; the handle is
  the drag activator and is labelled; non-movable boxes still open on Enter.
- Edit is offered only for draft/approved (not failed/skipped/published/scheduled).
- Box aria-label reads a localized date, not the ISO key.

LOCKED CONSTRAINTS: single drag system preserved (L-H) — a drag handle is still ONE drag path, not a
second pane->grid system. Keyboard reschedule path remains operable (§9/§10).

BUILDER BOUNDARY: visual + a11y + the edit gate only; no action/DB changes. ADR/interaction conflict
=> stop per MAJOR-4 above.

When clean, output exactly: "20D-4 complete. Awaiting next prompt." Then stop.
```

---

### 20D-5 — Observability + security hardening (MINOR-1 · MINOR-2 · MINOR-3)

```
You are the Builder for SOSH Session 20D — the mandated log lines and two defense-in-depth hardenings.

DELIVERABLES:
- MINOR-1 (§10 observability): emit the three canonical id-only JSON log lines via the project logger
  from the reschedule actions — reschedule_post, reschedule_group, reschedule_rejected{reason}
  (reason in too_soon|claimed|mixed|not_eligible|generic). Ids only, no content/PII; Sentry capture
  stays id-only. No new logger, use the project's.
- MINOR-2 (defense-in-depth): approvePostFromCalendarAction -> approvePost filters only by id +
  status='draft' + deleted_at (RLS-only tenancy). Add an explicit business_id predicate to match
  reschedulePost's belt-and-suspenders posture. (Pre-existing helper posture, not a Session-20
  regression — tighten without breaking existing approve callers; if the shared helper can't take an
  optional business_id without touching other call sites, add a calendar-scoped guard in the wrapper.)
- MINOR-3: platform-url.ts:22 interpolates platformPostId raw — wrap it in encodeURIComponent.

WORKFLOW: /ecc:plan (approve) -> /ecc:tdd-workflow -> /ecc:verification-loop; re-run
/ecc:security-reviewer.

TDD TEST LIST:
- Each action emits exactly its canonical line with reason on the reject paths; lines carry ids only.
- approve wrapper: a post from another business is not approvable (guard + RLS); existing approve
  callers unaffected.
- buildPlatformPostUrl encodes the id; a crafted id does not break out of the URL.

LOCKED CONSTRAINTS: no service-role; no PII in logs (REDACTED posture); no behavioural change to the
happy paths.

BUILDER BOUNDARY: hardening + logging only. When clean, output exactly:
"20D-5 complete. Correction pass done." Then stop.
```

---

### After Part D (closeout)

- Re-run the full scoped **eslint + vitest + tsc** once more; confirm **BLOCKER-1 cleared (eslint
  green)** and all four MAJORs resolved. If **20D-4/MAJOR-4** stopped for an interaction amendment,
  open an **ADR 0012 amendment** (box-as-button vs keyboard-drag) and re-run 20D-4 against it — do
  not force a workaround.
- Update `docs/current-phase.md` (Session 20 → done; calendar shipped) and `launch-checklist.md`
  (content calendar = done; the deferred single-post create stays parked).
- **NIT-3 tracking (no code):** pt/es `calendar.json` are fully translated — mark them **done, pending
  native review** in the translation tracker so the deferred PT/ES pass doesn't redo them.
- Then Part C can re-audit the corrected diff, or you accept and close the Session 20 cycle.
