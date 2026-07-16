# ADR 0012 — Content Calendar (month grid, per-campaign-day boxes, drag reschedule)

- **Status:** Accepted — **Rev B** (design-only; Builder transcribes next session)
- **Date:** 2026-06-28 (Rev B: adjudicated review refinements R1–R11)
- **Session:** 20 (Architect)
- **Supersedes / Reverses:** Nothing. Purely additive.

### Revision history — Rev A → Rev B (eleven post-Architect adjudications)

- **R1** Read cap 500 → **5000** + overflow now drives a visible header banner (dropped rows are the latest in-window); per-week segmentation considered and rejected. [§2 CAL-7, §4b, §12 D-R]
- **R2** Edit-of-approved revert **order pinned**: `unapprovePost` → then → `updatePostContent` (a mid-write failure leaves a safe un-edited draft). [§2 CAL-6, §6, §12 D-V, §15]
- **R3** Group reschedule **re-reads the source box tz-correctly** (`sourceDayKey` → UTC range in `business.timezone`, never `date(scheduled_at)`). [§7c, §13]
- **R4** In-pane approve wrapper now **`revalidatePath`s the calendar**. [§3, §10]
- **R5** `platform_url` → raw **`platform_post_id` + nullable `buildPlatformPostUrl`**; "view on platform" renders only when derivable. [§4b, §6, §11, §12 D-U, §15]
- **R6** Minimum reschedule target = **tomorrow** (business-tz); today/earlier → `too_soon` (removes the past-instant-within-today edge). [§2 CAL-4, §6, §7c, §9, §12 D-S]
- **R7** **`allSkipped`** flag; skipped-only boxes render **muted/struck** (kept for pane context). [§4c, §5, §12 D-T]
- **R8** **DST gap/overlap policy named** (date-fns-tz default; test encodes intent). [§7b, §12 D-O]
- **R9** Group optimistic UI reconciles **per-post** (partial `skipped` snaps back only unmoved posts). [§7c, §9, §13]
- **R10** Pane date picker computes min-target in **business tz**, not browser tz. [§6]
- **R11** Builder verifies `revalidatePath('/[locale]/calendar','page')` for the dynamic `[locale]` segment under **Next 16**. [§10, §15]
- **Depends on:** ADR 0001 (schema: flat `posts`, `post_metrics`, status enum, RLS), ADR 0004 (schedule algorithm + `generationSessionId`), ADR 0005 (publish state machine; `scheduled` = worker-claimed; **Reversal 3** = `scheduled_at` is mutable), ADR 0006 (`post_metrics` NULL=missing vs 0=real).

> This ADR is a **contract**, not code. TypeScript and SQL appear as illustrative signature blocks
> only. The Builder writes the real files in Session 20-Builder.

---

## 1. Context & relationship to prior ADRs

SŌSH already has an **approve queue** (`campaigns/[id]/posts`) and **campaign detail** surfaces.
Session 20 adds a **month-grid calendar** that visualises scheduled + published work as
**per-`(campaign, business-tz day)` boxes**, lets the owner approve drafts in place, and lets
movable posts be **rescheduled by day** via drag or a per-post date control.

This is **purely additive**:

- **One new index** — a partial index on `posts(business_id, scheduled_at)` for the date-range read.
- **One net-new mutation** — `reschedulePost` (the calendar's only write that is not already in the
  codebase). Everything else *composes existing helpers*.
- **No new schema column.** Grouping and colour are **derived at read time**, never stored.

**Relationship to ADR 0005 — Reversal 3.** ADR 0005 made `scheduled_at` mutable so the publishing
worker could requeue (`requeueScheduledPost`). This ADR is the **first USER-driven `scheduled_at`
write**. The invariant we inherit and must not break: a post in `scheduled` status is **worker-
claimed / in-flight** and must never be moved by the user (it races `publish_post_complete` and the
reaper). Hence the draggable set excludes `scheduled` (see CAL-3).

**Why no reversal is needed:** the existing state machine, RLS, soft-delete filtering, and the
`scheduled_at`-mutable rule all already permit this feature. We add capability, we do not change any
existing contract.

---

## 2. Named constraints (CAL-1 … CAL-9 — grep anchors for the Reviewer)

| ID | Constraint | Enforced where |
|---|---|---|
| **CAL-1** | **Grouping is derived, never stored.** No `post_group_id` column, no `campaigns.color` column, no migration adds either. Boxes are computed by `groupByCampaignDay()` keyed on `(campaign_id, business-tz calendar day)`. | `lib/calendar/group.ts` (pure); migration adds **index only** |
| **CAL-2** | **Business timezone is the calendar's clock.** Day-assignment, visible-grid edges, the "is it past?" test, and the preserved time-of-day on reschedule all use `business.timezone` (IANA). **Storage stays UTC** (`scheduled_at` is `timestamptz`, written with `formatISO`). | `lib/calendar/{group,reschedule}.ts`, `listPostsForCalendar`, both actions |
| **CAL-3** | **Draggable set = `{draft, approved}` only.** `scheduled`/`published`/`failed`/`skipped` are immovable. Enforced **in the SQL `WHERE` guard** of `reschedulePost`, not only in the UI. | `reschedulePost` `WHERE status IN ('draft','approved')` |
| **CAL-4** | **Minimum target = tomorrow (business-tz).** A reschedule may only land on a business-tz day **≥ tomorrow**; today and earlier are rejected (`reason:'too_soon'`). This also removes the "past instant within today" edge. **Server-authoritative** (re-checked in the action, not trusted from the client). | `reschedulePostAction`, `rescheduleDayGroupAction` |
| **CAL-5** | **Atomic, worker-safe reschedule.** Single-statement guarded `UPDATE … RETURNING id`. **Zero rows ⇒ "claimed"** (the worker won the race) — return a reason, never throw, never partial-write. **No `FOR UPDATE`, no read-then-write.** | `reschedulePost` |
| **CAL-6** | **Edit-of-approved reverts to draft, revert-first.** Editing content of an `approved` post drops it to `draft` by composing **`unapprovePost` first (→ draft), then `updatePostContent`** — a mid-write failure leaves a safe un-edited draft, never edited-but-approved content (R2). Not a UI hint alone. | `updatePostFromCalendarAction` (`unapprovePost` → `updatePostContent`) |
| **CAL-7** | **Bounded read + visible overflow.** `listPostsForCalendar` has `ORDER BY scheduled_at`, a date range, and `LIMIT = CALENDAR_POST_LIMIT (5000)` with a `+1` overflow probe. On overflow the calendar renders a **non-blocking header banner** ("some posts aren't shown") — never a silent truncation (the dropped rows are the latest `scheduled_at` in-window). | `listPostsForCalendar`, `CalendarView` |
| **CAL-8** | **No new quota / plan-limit path.** The calendar reads and reschedules only; it introduces no plan gate, no posts/month counter, no trial decrement. | absence verified across calendar files |
| **CAL-9** | **Reuse, don't reinvent.** Approve / unapprove(revert) / edit / metrics-read are the **existing** exports. **Only `reschedulePost` + `listPostsForCalendar` are net-new DB helpers.** No new requeue/claim helper; the worker helpers are off-limits (different invariants). | `lib/db/posts.ts`, `lib/db/post-metrics.ts` |

---

## 3. Surface & routes

All under `app/[locale]/(dashboard)/calendar/`:

| File | Kind | Responsibility |
|---|---|---|
| `page.tsx` | Server Component | Auth + business resolve; compute the visible month's business-tz grid edges → UTC; call `listPostsForCalendar`; pass flat rows + `tz` + `overflow` to `CalendarView`. No data props beyond that. |
| `actions.ts` | Server Actions | `reschedulePostAction`, `rescheduleDayGroupAction`, `updatePostFromCalendarAction`, plus a thin `approvePostFromCalendarAction` wrapper that calls `approvePostAction` **and `revalidatePath`s the calendar** (R4). |
| `CalendarView.tsx` | `'use client'` | Owns month state, selected-day/box state, DnD context, optimistic UI. |
| `components/MonthGrid.tsx` | client | 6×7 (or 5×7) grid of `DayCell`. |
| `components/DayCell.tsx` | client | One calendar day; droppable; renders its `CampaignDayBox[]`; marks past/today/out-of-month. |
| `components/CampaignDayBox.tsx` | client | One `(campaign, day)` box — colour, transparency, badge, failure dot, platform icons; draggable iff `allMovable`; button (opens pane). |
| `components/PostDayPanel.tsx` | client | Left pane: per-post `PostRow[]` for the clicked box. |
| `components/PostRow.tsx` | client | One per-platform post: preview, status chip, Edit, Approve, "move to…", metrics. |
| `components/CalendarToolbar.tsx` | client | Month prev/next/today; **Create campaign** (live); **Create post** (disabled, coming-soon). |

**Nav.** `components/layout/DashboardShell.tsx` currently lists `calendar` in `COMING_SOON_NAV`.
The Builder **promotes** it: remove from `COMING_SOON_NAV`, add to `ACTIVE_NAV` as
`{ key: 'calendar', href: 'calendar', icon: CalendarDays }`. (See §15 ambiguity note — the prompt
says "add a 6th nav item"; in reality the item already exists as a stub and is promoted, leaving
4 active + 2 coming-soon.)

---

## 4. Read path

### 4a. Migration — partial index (index only, no column)

Migrations are **timestamp-prefixed**, not sequentially numbered. Latest existing is
`20260623210000_voice_axes.sql`. Next file:

```
supabase/migrations/20260628120000_posts_scheduled_at_idx.sql
```

```sql
-- Calendar date-range read (ADR 0012). Index only — no column, no grouping stored (CAL-1).
create index if not exists idx_posts_business_scheduled_at
  on public.posts (business_id, scheduled_at)
  where deleted_at is null;
```

Rationale (D-H): the existing publishing-queue and `(business_id, created_at)` indexes have the wrong
sort key for a `scheduled_at` range scan → full scan. The partial predicate matches the soft-delete
filter every calendar read carries.

### 4b. `listPostsForCalendar` — bounded flat read (net-new)

```ts
// lib/db/posts.ts
export interface CalendarPostRow {
  id: string
  campaign_id: string
  campaign_name: string          // joined from campaigns(name)
  platform: Platform
  status: PostStatus
  content: string
  hashtags: string[]
  scheduled_at: string           // UTC ISO (timestamptz)
  published_at: string | null
  platform_post_id: string | null  // raw platform id; "view on platform" URL derived (R5), nullable
  metrics: {                     // LEFT JOIN post_metrics — null row ⇒ never synced
    likes: number | null; comments: number | null; shares: number | null
    saves: number | null; clicks: number | null; reach: number | null
    impressions: number | null; last_synced_at: string
  } | null
}

export interface CalendarReadResult {
  rows: CalendarPostRow[]
  overflow: boolean              // true when LIMIT+1 hit (CAL-7)
}

export async function listPostsForCalendar(
  client: SupabaseClient,
  opts: { businessId: string; rangeStartUtc: string; rangeEndUtc: string; limit?: number },
): Promise<CalendarReadResult>
```

Contract:
- `WHERE business_id = $ AND scheduled_at >= rangeStartUtc AND scheduled_at < rangeEndUtc AND deleted_at IS NULL`.
- `ORDER BY scheduled_at` (matches the new index). **`limit` default = `CALENDAR_POST_LIMIT` (5000)**;
  query asks for `limit + 1`; if `limit + 1` rows return, drop the extra and set `overflow = true`.
  **`overflow` MUST surface a non-blocking banner** in the calendar header — the dropped rows are the
  *latest* `scheduled_at` in-window, so silent truncation would blank the end of the month. (Named
  loser: per-week segmented reads — rejected; the indexed range scan is cheap and 5000 + a banner is
  simpler than stitching six weekly reads.)
- Range edges are the **business-tz visible-grid edges converted to UTC** by the page (a 6-week grid
  can span ~42 days; both edge days belong to adjacent months). The read returns all non-deleted
  statuses in range; the UI decides rendering. (Named loser: filtering `skipped` in SQL — rejected
  because the pane should still show a skipped post for context, and the box `allMovable` calc already
  treats it as immovable.)
- RLS scopes the read; the page passes the **authenticated** server client (anon-key, ADR 0001 RLS),
  never service-role.

### 4c. `groupByCampaignDay` — pure grouping (net-new)

```ts
// lib/calendar/group.ts
export interface CampaignDayCell {
  campaignId: string
  campaignName: string
  dayKey: string                 // business-tz 'yyyy-MM-dd'
  colorIndex: number             // from colors.ts
  platforms: Platform[]          // distinct, stable-sorted
  postIds: string[]
  allPublished: boolean          // transparent iff every post published
  anyDraft: boolean              // approval badge
  anyFailed: boolean             // failure dot
  allMovable: boolean            // every post status ∈ {draft, approved}
  allSkipped: boolean            // muted/struck box iff every post skipped (R7)
}

export function groupByCampaignDay(rows: CalendarPostRow[], tz: string): CampaignDayCell[]
```

- **Pure** (no I/O, no `Date.now()` inside — "today" is passed in where needed). Day bucket =
  `formatInTimeZone(scheduled_at, tz, 'yyyy-MM-dd')` (date-fns-tz).
- `allMovable` = `posts.every(p => p.status === 'draft' || p.status === 'approved')`.
- `allPublished` = `posts.every(p => p.status === 'published')`.
- `allSkipped` = `posts.every(p => p.status === 'skipped')` (R7).
- Deterministic ordering of cells (by `dayKey`, then `campaignName`, then `campaignId`) so the grid is
  stable across renders.

### 4d. `colorIndex` — deterministic palette mechanism (net-new)

```ts
// lib/calendar/colors.ts
export function colorIndex(campaignId: string, paletteLength: number): number
// = hash(campaignId) % paletteLength ; stable, no storage (CAL-1)
```

This file owns **the mechanism only** — a stable hash → index. The **palette hex values** are owned by
the design plugin (`impeccable-design-and-taste` pass), not hardcoded here. `paletteLength ≥ 8`
distinguishable hues (per the §builder taste gate).

---

## 5. Box visual aggregation (L-G / D-B)

`CampaignDayBox` renders, derived purely from its `CampaignDayCell`:

- **Colour** = palette[`colorIndex`] — one hue per campaign, consistent across all its days.
- **Transparent iff `allPublished`** (done work recedes); otherwise **solid** (work pending).
- **Approval badge iff `anyDraft`** — a non-colour glyph + text alternative ("needs approval").
- **Failure dot iff `anyFailed`** — a distinct mark + text alternative ("publish failed").
- **Muted/struck iff `allSkipped`** — a skipped-only box is de-emphasised so it doesn't read as pending work; kept visible for pane context (R7 / D-T).
- **Distinct platform icons** for `platforms` (deduped). Icons are presence-only.
- **Status nuance lives in the pane, not per-icon** (D-B loser: per-icon status tinting → grid noise).

---

## 6. Left pane — `PostDayPanel`

Opens when a box is clicked (or activated by keyboard). Lists one `PostRow` per contained post:

- **Per-post preview** — content excerpt + hashtags + platform.
- **Status chip** — draft / approved / scheduled / published / failed / skipped.
- **Edit** — opens the content editor. On save calls `updatePostFromCalendarAction`, which **reverts
  `approved → draft` first, then writes content** (CAL-6 / R2). Disabled for `published` (read-only,
  L-D) and for in-flight `scheduled`.
- **Approve** — shown iff `draft`; calls the **existing** `approvePostAction` (atomic draft→approved).
- **Per-post "move to…" date control** — business-tz date picker; calls `reschedulePostAction`. Shown
  iff status ∈ {draft, approved}; **minimum selectable day = tomorrow (business-tz)** — today and
  earlier are disabled in the picker AND rejected server-side (R6/R10; the picker's "today" is computed
  in `business.timezone`, not the browser's).
- **Metrics for published posts** — render each metric distinguishing **NULL ("—", not reported)** from
  **real 0** (ADR 0006: `metrics === null` or a field `=== null` → "—"; `=== 0` → "0").
- **View on platform** (published only) — link derived via `buildPlatformPostUrl(platform, platform_post_id)`;
  rendered **only when the helper returns non-null** (R5). No link for opaque/missing ids.

---

## 7. Reschedule (the only net-new mutation)

### 7a. DB helper — guarded single-statement UPDATE

```ts
// lib/db/posts.ts
export async function reschedulePost(
  client: SupabaseClient,
  args: { postId: string; businessId: string; newScheduledAtUtc: string },
): Promise<{ updated: boolean }>   // updated = (rowCount === 1)
```

```sql
update public.posts
   set scheduled_at = :newScheduledAtUtc
 where id = :postId
   and business_id = :businessId
   and status in ('draft','approved')   -- CAL-3
   and published_at is null             -- defence in depth
   and deleted_at is null
returning id;                           -- 0 rows ⇒ {updated:false} (CAL-5 'claimed')
```

- **No `FOR UPDATE`, no prior `SELECT`.** The `WHERE` is the guard. `{updated:false}` is a legitimate
  outcome (the worker claimed it, or someone else moved/edited it), **never an exception**.
- `newScheduledAtUtc` is produced by the pure reschedule fn and written verbatim (already `formatISO`).

### 7b. Pure instant computation — preserve local time-of-day

```ts
// lib/calendar/reschedule.ts
export function computeRescheduledInstant(
  currentScheduledAtUtc: string,   // post's existing instant
  targetDayKey: string,            // business-tz 'yyyy-MM-dd'
  tz: string,
): string                          // UTC ISO via formatISO
```

- Take the post's **business-tz wall-clock time-of-day** from `currentScheduledAtUtc`, place it on
  `targetDayKey` in `tz`, convert back to UTC. (date-fns-tz `toZonedTime` / `fromZonedTime`.)
- **DST policy (named, R8):** the preserved wall time is placed on the target day in `tz`; on a DST
  **gap** date-fns-tz forward-shifts, on an **overlap** it takes the earlier offset. This is adopted as
  the intended behaviour and the §13 DST test pins the expected instant. (Named loser: "carry the UTC
  time-of-day" → rejected, drifts the displayed local time across DST and off-tz.)

### 7c. Server Actions

```ts
// app/[locale]/(dashboard)/calendar/actions.ts
export async function reschedulePostAction(
  postId: string, targetDayKey: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid_input' | 'too_soon' | 'claimed' | 'generic' }>

export async function rescheduleDayGroupAction(
  campaignId: string, sourceDayKey: string, targetDayKey: string,
): Promise<
  | { ok: true; moved: number; skipped: number }
  | { ok: false; reason: 'invalid_input' | 'too_soon' | 'mixed' | 'generic' }
>
```

Both actions:
- **Re-derive `businessId` server-side** via `getBusinessByOwner(client, user.id)` — never trust a
  client-supplied business/post owner (IDOR, CAL-4 + security).
- **Reject targets earlier than tomorrow** before any write (CAL-4 / R6): compare `targetDayKey` to
  **tomorrow** in `business.timezone`; today and earlier → `reason:'too_soon'`.
- Validate inputs with **Zod** (uuid, `yyyy-MM-dd` shape).
- `revalidatePath('/[locale]/calendar', 'page')` on success.

**`reschedulePostAction`** (per-post): load the post (RLS-scoped), compute the new instant, call
`reschedulePost`. `{updated:false}` → `reason:'claimed'`.

**`rescheduleDayGroupAction`** (group, L-H): reconstruct the source box **timezone-correctly** —
convert `sourceDayKey` to a `[startUtc, endUtc)` range in `business.timezone` (the same edge math the
page uses) and read the campaign's posts in that range; **never `date(scheduled_at)`** (that buckets in
UTC and mis-groups every off-UTC business — R3). The group moves **only if EVERY post in the box is
movable** ({draft, approved}) — authoritative, not just UI-disabled (CAL-3/CAL-5); if any is not →
`{ ok:false, reason:'mixed' }` (refuse, move nothing). Otherwise issue the guarded updates **in one
transaction (an RPC the Builder adds, or a single multi-row UPDATE keyed by the post ids)** and return
`{ moved, skipped }`, where `skipped` counts rows that returned 0 (a worker claimed one mid-flight —
partial success is acceptable; no invariant requires all-or-nothing). The client reconciles **per-post**
(R9): a `skipped` post snaps back individually, not the whole box. (Named loser: per-post sequential
awaits without a txn → leaves the box half-moved on a mid-loop crash.)

### 7d. Worker-race worked example

- **Worker wins:** worker's `claim_posts_for_publishing` flips the post `approved → scheduled` first.
  Our `reschedulePost` `WHERE status IN ('draft','approved')` now matches 0 rows → `{updated:false}` →
  action returns `reason:'claimed'`. No throw, no write. UI tells the user the post is publishing.
- **User wins:** our UPDATE commits first, pushing `scheduled_at` to a future day. The worker's claim
  predicate (`status='approved' AND scheduled_at <= now`) **no longer matches** → the worker skips it.
  Both outcomes are consistent; no lost update, no double publish.

---

## 8. Create buttons (L-F / D-J)

`CalendarToolbar`:
- **Create campaign** — live; links/redirects to the existing campaign-creation flow.
- **Create post** — **disabled**, with a "coming soon" hover/title (D-J loser: omit → loses
  discoverability; ship now → out of scope this session). No handler wired.

---

## 9. Drag & drop

- **Library:** `@dnd-kit/core` + `@dnd-kit/utilities` (D-G loser: native HTML5 DnD → poor a11y/touch;
  react-dnd → heavier). **Pin exact versions** in the manifest.
- **Sensors:** `PointerSensor` **and** `KeyboardSensor` (a11y — keyboard reschedule path required).
- **Draggable:** a `CampaignDayBox` is draggable **iff `allMovable`**; otherwise static (use the
  per-post "move to…" in the pane for mixed/precision moves — single drag system, L-H/D-D).
- **Droppable:** each `DayCell`. **Today, past days, and out-of-month days reject the drop** (min target
  = tomorrow; the server still rejects, CAL-4 / R6).
- **On drop:** call `rescheduleDayGroupAction(campaignId, sourceDayKey, targetDayKey)` with optimistic
  UI; reconcile **per-post** on the result (`mixed`/`too_soon`/partial `skipped` snaps back only the
  unmoved posts — R9).

---

## 10. Cross-cutting

- **i18n:** new namespace `i18n/{en,pt,es}/calendar.json`. **EN authored** this session; **PT/ES
  mirror EN verbatim, flagged for the deferred translation session** (consistent with existing split-
  namespace files: `posts.json`, `billing.json`, …). The existing `nav.calendar` key already exists.
  **No hardcoded user-facing strings** — all via `next-intl`.
- **a11y:** boxes are real `<button>`s (keyboard-openable pane); DnD keyboard sensor; transparent
  (all-published) boxes must keep text/contrast within WCAG AA; the approval badge and failure dot
  carry **text alternatives** (never colour-only).
- **Observability:** exactly **3 canonical JSON log lines**, ids only (no content):
  `reschedule_post`, `reschedule_group`, `reschedule_rejected` (with `{ reason }`). Sentry captures
  id-only on `generic`. (Use the project logger, **no `console.*`**.)
- **Security:** RLS-scoped reads (authenticated client); **server-derived `businessId`**; SQL-guarded
  reschedule; bounded queries (CAL-7); no service-role anywhere in the calendar path.
- **Cache revalidation (R4/R11):** every calendar mutation — reschedule, group reschedule, edit, and the
  **in-pane approve wrapper** — calls `revalidatePath('/[locale]/calendar', 'page')` so the box
  re-derives immediately. Builder verifies this exact form is correct for the dynamic `[locale]` segment
  under Next 16 (the all-params signature has shifted before).
- **Config / boundaries:** env via `lib/config.ts` only; DB via `lib/db/` only; **no `process.env`,
  no `console.*`, no `any`** in any calendar file. `CALENDAR_POST_LIMIT` is a module const, not an env var.

---

## 11. File manifest

**NEW**
- `supabase/migrations/20260628120000_posts_scheduled_at_idx.sql`
- `lib/calendar/colors.ts`, `lib/calendar/group.ts`, `lib/calendar/reschedule.ts`, `lib/calendar/platform-url.ts` (`buildPlatformPostUrl`, R5)
- `app/[locale]/(dashboard)/calendar/page.tsx`
- `app/[locale]/(dashboard)/calendar/actions.ts`
- `app/[locale]/(dashboard)/calendar/CalendarView.tsx`
- `app/[locale]/(dashboard)/calendar/components/{MonthGrid,DayCell,CampaignDayBox,PostDayPanel,PostRow,CalendarToolbar}.tsx`
- `i18n/en/calendar.json` (+ `pt`/`es` mirror)
- Tests: `lib/calendar/{colors,group,reschedule}.test.ts`, `lib/db/posts.calendar.test.ts`,
  `app/[locale]/(dashboard)/calendar/actions.test.ts`, component tests.

**EDIT**
- `lib/db/posts.ts` — add `listPostsForCalendar`, `reschedulePost` (+ `CalendarPostRow`,
  `CalendarReadResult` types or co-locate in `lib/db/types.ts`).
- `components/layout/DashboardShell.tsx` — promote `calendar` from `COMING_SOON_NAV` to `ACTIVE_NAV`.
- `package.json` — add deps (see below).

**ADD DEPENDENCIES** (none currently installed — confirmed against `package.json`)
- `date-fns-tz` (pin) — **not installed**; `date-fns@^4.1.0` is present but tz helpers are a separate package.
- `@dnd-kit/core` + `@dnd-kit/utilities` (pin) — **not installed**.

**CONFIRM-EXISTING-EXPORT (reuse verbatim — resolved from the repo)**
- `approvePost` → `lib/db/posts.ts`; action `approvePostAction` → `campaigns/[id]/posts/actions.ts`.
- `unapprovePost` (the approved→draft revert; this is the "Session-18 unapprove/revert path") →
  `lib/db/posts.ts`; action `unapprovePostAction`.
- `updatePostContent` (edit; guards `status IN ('draft','approved')`, keeps status) → `lib/db/posts.ts`;
  action `updatePostContentAction`. **Note:** it does **not** itself revert approved→draft — CAL-6
  composes `updatePostContent` + `unapprovePost`.
- `getPostMetricsByPostId` (metrics read) → `lib/db/post-metrics.ts`.
- `getBusinessByOwner` → `lib/db/businesses.ts` (server-side businessId derivation).
- `getPostById` → `lib/db/posts.ts`.
- `toUtcIso` → `lib/utils.ts`; `formatISO` → `date-fns`.
- `business.timezone` (IANA) → `BusinessRow.timezone` (`lib/db/types.ts`).

---

## 12. Decision ledger (D-A … D-L restated + new contested points)

Restated from session-20 §0 (do not re-open):

| # | Decision | Chosen | Losers |
|---|---|---|---|
| D-A | Grouping key | `(campaign_id, business-tz day)`, derived | per-post blocks; `(generationSessionId, day)` |
| D-B | Box visual state | transparent iff all-published; badge iff any-draft; failure dot | per-icon status tinting |
| D-C | Draggable set | `{draft, approved}` | include `scheduled` |
| D-D | Drag model | group-drag all-movable + per-post date control | pane→grid individual drag; per-post drag |
| D-E | Reschedule semantics | day-only, preserve local time, no past, atomic guard | free datetime drag |
| D-F | Edit of approved | revert → draft | edit-in-place keep-approved |
| D-G | DnD lib | `@dnd-kit/core` | native HTML5 DnD; react-dnd |
| D-H | Read path | new partial `(business_id, scheduled_at)` index + bounded helper | reuse `(business_id, created_at)` |
| D-I | Timezone | business IANA tz for grid/day/past/preserve | UTC-day grouping |
| D-J | Create-post button | disabled + coming-soon | omit; ship now |
| D-K | Coexistence | additive; keep approve-queue + campaign detail | replace existing surfaces |
| D-L | Reschedule helper | net-new `reschedulePost`; reuse approve/edit/metrics | reuse worker requeue helpers |

**New contested points introduced this ADR (with named losers):**

| # | Decision | Chosen | Loser (rationale) |
|---|---|---|---|
| D-M | `skipped` posts in the read | include in `listPostsForCalendar`, exclude from `allMovable` | filter in SQL (pane loses context) |
| D-N | Group reschedule atomicity | one txn / RPC, refuse `mixed`, allow `skipped` partial on worker race | sequential awaits, no txn (half-moved box on crash) |
| D-O | Preserve time-of-day basis | business-tz wall clock | UTC time-of-day (drifts across DST / off-tz) |
| D-P | `CALENDAR_POST_LIMIT` location | module const (5000) | env var (over-config for a UI bound) |
| D-Q | Nav item | promote existing `calendar` stub to active | add a literal new item (would duplicate the key) |
| D-R | Read cap vs overflow | 5000 const + visible header banner on overflow (R1) | per-week segmented reads (more code; indexed range read already cheap) |
| D-S | Min reschedule target | **tomorrow** business-tz (R6) | allow today (re-introduces the past-instant-within-today edge) |
| D-T | Skipped-only box | **muted/struck**, kept visible (R7) | filter from grid (pane loses context) / render normally (reads as pending) |
| D-U | Published-post URL | raw `platform_post_id` + nullable `buildPlatformPostUrl` (R5) | a `platform_url` column/select (no such column; adapter-dependent value) |
| D-V | Edit-revert order | **revert → then → write** (R2) | write → then → revert (failure window persists edited-but-approved content) |

---

## 13. Test plan (TDD order)

1. **`colors.ts`** — `colorIndex` deterministic; stable across calls; in `[0, paletteLength)`;
   different ids spread across the palette.
2. **`group.ts`** — grouping by `(campaign, business-tz day)`; `allPublished`/`anyDraft`/`anyFailed`/
   `allMovable` flags; distinct platforms; stable cell ordering; an off-UTC tz buckets a near-midnight
   instant onto the correct local day.
3. **`reschedule.ts`** — preserves business-tz time-of-day onto target day; **DST forward + backward**
   cases (e.g. `Europe/Lisbon` spring-forward); off-UTC case (`Pacific/Honolulu`); output is
   `formatISO` UTC.
4. **DB helpers** — `listPostsForCalendar`: range filter, `ORDER BY scheduled_at`, `LIMIT+1` overflow
   flag, soft-delete excluded, campaign-name + metrics join (null metrics row preserved).
   `reschedulePost`: updates draft/approved; **0 rows for scheduled/published/failed/deleted/wrong-
   business**; `updated` reflects `rowCount`.
5. **Actions** — `reschedulePostAction` / `rescheduleDayGroupAction`: **IDOR** (businessId re-derived,
   client id ignored); **today-or-earlier (`too_soon`) rejected** server-side in an off-UTC tz (R6);
   group **source-box re-read is tz-correct** (off-UTC business buckets to the right day — R3);
   **`claimed`** (0-row → reason, no throw); **`mixed` group refusal** (one non-movable post → nothing
   moves); partial `skipped` on simulated worker race; Zod input rejection.
6. **Components** — box renders transparency/badge/dot/icons/**muted-when-`allSkipped`** from a cell;
   pane Approve only on draft; Edit reverts approved→draft via the action; metrics "—" vs "0";
   **"view on platform" only when `buildPlatformPostUrl` is non-null** (R5); DnD draggable only when
   `allMovable`; **group move reconciles per-post on partial `skipped`** (R9); keyboard activation opens
   the pane.

Run scope (per CLAUDE.md): `npx vitest run lib/db lib/calendar "app/[locale]/(dashboard)/calendar"`
and `npx tsc --noEmit --skipLibCheck`.

---

## 14. Open follow-ups (explicitly NOT in v1)

- **Single-post create** from the calendar (the disabled button).
- **Campaign-bound clamping** of reschedule targets to `[start_date, end_date]` — **NOT v1**; v1 only
  enforces "no past".
- **PT/ES calendar strings** — real translations (deferred translation session).
- **Multi-user approval / roles** (`business_members`) — Phase 2 (L-B).
- **Promote `rescheduleDayGroupAction` to a dedicated RPC** if the multi-row update proves hot.

---

## 15. Architect summary — repo ambiguities & assumptions (≤15 lines)

1. **Migration numbering:** the Builder stub says `0NN_…`; the repo uses **timestamp prefixes**.
   Assumed next file `20260628120000_posts_scheduled_at_idx.sql`. Builder may rename if a later
   migration lands first.
2. **Nav "6th item":** `calendar` already exists in `COMING_SOON_NAV`; assumed **promote**, not add a
   literal new entry (D-Q). Net result is 4 active / 2 coming-soon, not 6 active.
3. **Edit-of-approved revert (order pinned, R2):** `updatePostContent` keeps status (guards
   draft|approved) and does **not** itself revert. CAL-6 is satisfied by `updatePostFromCalendarAction`
   composing **`unapprovePost` first (→ draft), then `updatePostContent`** — a failure after the revert
   leaves a safe un-edited draft, never edited-but-approved content.
4. **Metrics shape:** assumed `metrics` is exposed as a nested nullable object on `CalendarPostRow`
   (LEFT JOIN); the Builder may instead surface flat columns — either satisfies CAL/ADR 0006 as long
   as NULL vs 0 stays distinguishable.
5. **Group txn:** assumed the Builder adds either a small RPC or a single multi-row guarded UPDATE for
   `rescheduleDayGroupAction`; both honour CAL-5. Promotion to a standalone RPC is a follow-up.
6. **`date-fns-tz` + `@dnd-kit/*`** confirmed **absent** from `package.json` — added to the manifest.
7. Everything else (existing helper names, `business.timezone`, RLS read client, soft-delete filter,
   `formatISO` writes) was resolved directly from the repo and cited in §11.
8. **Published-post URL (R5):** there is no `platform_url` column; the row carries raw `platform_post_id`
   and the pane derives the link via `buildPlatformPostUrl(platform, platform_post_id)` (Builder confirms
   whether an equivalent already exists in `lib/social/`), rendering nothing when it returns null.
9. **Min target / Next 16 (R6/R11):** minimum reschedule day is **tomorrow** in business tz; the
   `revalidatePath('/[locale]/calendar','page')` form is flagged for Builder verification under Next 16.
