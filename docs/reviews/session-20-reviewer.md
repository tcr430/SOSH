# Reviewer Report — ADR 0012 Content Calendar (Session 20 Builder diff)

- **Reviewer:** Claude Code (Session 20 Reviewer)
- **Date:** 2026-07-01
- **Audited against:** ADR 0012 **Rev B** (contract), ADR 0001/0004/0005/0006, CLAUDE.md conventions
- **Diff in scope:** migration `20260628120000_posts_scheduled_at_idx.sql`; `lib/calendar/{colors,group,reschedule,platform-url,drag,types}.ts`; `lib/db/posts.ts` calendar additions; `app/[locale]/(dashboard)/calendar/{page,actions,CalendarView}.tsx`; `components/calendar/{MonthGrid,DayCell,CampaignDayBox,PostDayPanel,PostRow,CalendarToolbar}.tsx`; `components/layout/DashboardShell.tsx` nav; `i18n/{en,pt,es}/calendar.json`; `i18n/request.ts`.
- **Build state:** `tsc --noEmit --skipLibCheck` clean for calendar (only the pre-existing unrelated `refine-from-posts-action.test.ts` error remains). **`eslint` FAILS: 12 errors, 2 warnings across 6 calendar files** (see BLOCKER-1).

Folded in: `ecc:typescript-reviewer`, `ecc:security-reviewer`, and a direct AI-call sweep (the `ecc:cost-aware-llm-pipeline` agent type is unavailable; check run manually).

---

## Area-by-area audit

**§4a Read path — index + nav (CAL-1 / D-H / D-Q).** Clean.
Migration is **index only** — `idx_posts_business_scheduled_at on public.posts (business_id, scheduled_at) where deleted_at is null`. No `post_group_id`, no `campaigns.color` column anywhere. Nav: `calendar` promoted from `COMING_SOON_NAV` → `ACTIVE_NAV` as `{ key:'calendar', href:'calendar', icon: CalendarDays }` (`DashboardShell.tsx:31`); no duplicate key. `i18n/request.ts` wires the new namespace.

**§4b Read helper — bounded + RLS (CAL-7 / CAL-8 / R1).** Clean.
`listPostsForCalendar` (`posts.ts:68-105`): `.eq(business_id)` + `.gte/.lt(scheduled_at)` range + `.is(deleted_at,null)` + `.order('scheduled_at', asc)` + `.limit(CALENDAR_POST_LIMIT + 1)` with `overflow = raw.length > effectiveLimit`. `CALENDAR_POST_LIMIT = 5000` is a module const (D-P). Authenticated RLS client passed from the page; **no service-role anywhere in the calendar path** (security-reviewer confirmed). `CalendarPostRow` carries raw `platform_post_id` and a nullable nested `metrics` (LEFT JOIN, null row preserved — not coerced to zeros).

**§4c/§5 Grouping + box (CAL-1/CAL-2 / D-B / R7).** Clean.
`groupByCampaignDay` buckets by `formatInTimeZone(scheduled_at, tz, 'yyyy-MM-dd')` — business-tz day, not UTC. Flags exact: `allPublished = every published`, `anyDraft`, `anyFailed`, `allMovable = every ∈ {draft,approved}`, `allSkipped = every skipped`. Box (`deriveCampaignDayBoxState`): transparent iff `allPublished`; draft badge iff `anyDraft`; failure dot iff `anyFailed`; muted/struck iff `allSkipped`. Badge (`?`), failure dot (`!`) and muted state all carry `aria-label`/`sr-only` **text alternatives** — never colour-only (WCAG 1.4.1). `colorIndex` = FNV-1a hash % paletteLength — deterministic, nothing persisted.

**§6 Overflow banner (CAL-7 / R1).** Clean.
`overflow` renders a visible non-blocking `role="status"` header banner (`CalendarView.tsx:281-289`), not a silent truncation.

**§7a Reschedule mutation (CAL-3/CAL-5).** Clean.
`reschedulePost` (`posts.ts:107-126`) is a single guarded UPDATE: `.eq(id).eq(business_id).in('status',['draft','approved']).is('published_at',null).is('deleted_at',null).select('id')`; `updated = rowCount === 1`. `scheduled`/`published`/`failed`/`skipped`/`deleted` never match. No `FOR UPDATE`, no read-then-write, no throw on 0 rows → surfaced as `claimed`. It is the only net-new DB mutation; no worker claim/requeue/reap helper duplicated (CAL-9).

**§7b Time math (CAL-2 / R8).** Clean (bar the `.toISOString()` lint issue, see BLOCKER-1).
`computeRescheduledInstant` takes the business-tz wall-clock time-of-day from the source instant (`toZonedTime`), stamps it on the target day, converts back with `fromZonedTime`. DST **both directions + off-UTC** are pinned in `reschedule.test.ts` (Lisbon spring-forward gap, autumn-back overlap, Honolulu UTC-10). Time-input-pure (no `new Date()` without args).

**§7c Actions — guards, tenancy, tz re-read (CAL-4/CAL-6 / R2/R3/R4/R6/R10).** Mostly clean; see MAJOR-1, MAJOR-2.
- Min target = **tomorrow in `business.timezone`**, server-authoritative: `isTooSoon(targetDayKey, tz) = targetDayKey <= formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` — correct in both actions.
- Group source-box re-read is **tz-correct**: `dayKeyToUtcRange` uses `fromZonedTime('${dayKey} 00:00:00', tz)`, never `date(scheduled_at)` (R3).
- Group refusal is atomic on the mixed case: `allMovable` checked up front → `reason:'mixed'` moves nothing. **BUT the per-post moves run as a sequential await loop, not one txn/RPC** → MAJOR-1.
- IDOR: `businessId` re-derived via `getAuthContext()` → `getBusinessByOwner(client, user.id)` in every action; never a client argument. Zod validates every input.
- `updatePostFromCalendarAction` reverts **first** (`unapprovePost` → draft) **then** `updatePostContent` (CAL-6/R2); published/scheduled rejected as `not_eligible`.
- `revalidatePath('/[locale]/calendar','page')` on every mutation incl. the approve wrapper (R4).

**§6 Pane — metrics + platform link (R5 / ADR 0006).** Clean.
`formatMetricValue(null) → '—'`, `formatMetricValue(0) → '0'`; `post.metrics?.[key] ?? null` preserves real `0`. "View on platform" renders only when `buildPlatformPostUrl` is non-null and status is `published`.

**§8 Create buttons (L-F / D-J).** Clean.
Create campaign → `buttonVariants` `<Link href={/${locale}/campaigns/new}>`. Create post is `disabled`, `title="coming soon"`, no handler. No deferred single-post create shipped.

**§9 Drag-and-drop (CAL-3/CAL-4 / D-D/D-G / R6/R9).** See MAJOR-2, MAJOR-4.
`@dnd-kit/core` + `PointerSensor` + `KeyboardSensor`. `CampaignDayBox` draggable iff `allMovable`; single drag system (mixed/precision routes through the pane date control). `isDayDroppable` rejects today/past/out-of-month; server re-rejects (CAL-4). Optimistic reconcile is per-post on partial `skipped` (full snapshot revert only on hard `mixed`/`too_soon`/`generic`). **Client "today" boundary uses UTC** → MAJOR-2; **keyboard pane-open shadowed on movable boxes** → MAJOR-4.

**§10 Cross-cutting (i18n / plan limits / observability).** See MINOR-1.
All strings via `next-intl` `calendar` namespace; `en/pt/es` present (pt/es fully translated — exceeds the "mirror verbatim" plan, harmless; see NIT-3). No new quota/plan-limit path (CAL-8). **No canonical log lines** → MINOR-1.

**Cross-cutting — AI cost.** Clean. Grep for `@/lib/ai` / `anthropic` across `lib/calendar/**`, `components/calendar/**`, `app/[locale]/(dashboard)/calendar/**` → zero matches. The surface makes no LLM calls.

---

## Findings

**Correction status (2026-07-01/02, Sessions 20D-1–20D-5):** Every BLOCKER, MAJOR, and MINOR below is now ✅ **CORRECTED**. NIT-3 required no action (see disposition inline). Final state: ESLint clean, `tsc --noEmit --skipLibCheck` clean (bar the pre-existing unrelated `refine-from-posts-action.test.ts` error), 659 tests passing across the calendar/db scope, security-reviewer and typescript-reviewer re-runs both returned clean/PASS on the corrected diffs.

### BLOCKER

**BLOCKER-1 — Calendar diff fails the enforced ESLint gate (12 errors). ✅ CORRECTED (20D-1).** `eslint.config.mjs:78` sets `no-restricted-properties: ["error", TO_ISO_STRING_BAN]` — raw `.toISOString()` is banned outside tests ("Use `toUtcIso()` … banned to prevent local-offset bugs — see CLAUDE.md date rule"). ADR §4b/§7b also explicitly say writes go through **`formatISO`**. The Builder used raw `.toISOString()` in **11 places**:
- `lib/calendar/reschedule.ts:38` — `fromZonedTime(zoned, tz).toISOString()` (comment even claims "project-sanctioned via toUtcIso" but never calls it)
- `app/[locale]/(dashboard)/calendar/page.tsx:45,46,49,50`
- `app/[locale]/(dashboard)/calendar/actions.ts:79,81` (×3)
- `app/[locale]/(dashboard)/calendar/CalendarView.tsx:46,52`
- `components/calendar/PostRow.tsx:21`

Plus a 12th error: `react-hooks/set-state-in-effect` at `CalendarView.tsx:73` (`useEffect(() => setLocalCells(cells), [cells])`). Expected: route every timestamp write through `toUtcIso()` from `@/lib/utils`; resolve or justify the effect-setState (e.g. derive from a key, or an eslint-disable with a WHY). Most `.toISOString()` calls operate on already-UTC instants so are functionally correct, but `CalendarView.tsx:52` is both a lint error **and** the exact bug the rule exists to prevent (see MAJOR-2).

### MAJOR

**MAJOR-1 — Group reschedule is a sequential await loop, not one transaction (§7c / D-N named loser). ✅ CORRECTED (20D-2).** `actions.ts:160-176` issues `reschedulePost` per post in a `for` loop. ADR §7c requires "the guarded updates **in one transaction** (an RPC the Builder adds, or a single multi-row UPDATE keyed by the post ids)"; D-N names "sequential awaits … no txn (half-moved box on crash)" as the rejected loser. The mixed-refusal is atomic, so the only exposure is a mid-loop crash leaving the box half-moved — but that is precisely the case the txn requirement removes. Expected: single guarded multi-row `UPDATE … WHERE id = ANY(:ids) AND status IN ('draft','approved') …` (or an RPC) returning the moved ids; `skipped = requested − moved`.

**MAJOR-2 — Client "today" computed in UTC, not business tz (CAL-2 / D-I). ✅ CORRECTED (20D-1).** `CalendarView.tsx:51-52` `getTodayKey() = new Date().toISOString().split('T')[0]` yields the **UTC** day, then flows into `isToday` (grid highlight) and `isDayDroppable` (client drop boundary). CAL-2 says the "is it past?" test uses `business.timezone`. For an off-UTC business near midnight UTC this highlights the wrong "today" and shifts the tomorrow boundary by one day — a business-tz-valid tomorrow can be client-rejected, or a business-tz "today" client-accepted then server-rejected (jarring `too_soon`). Not a BLOCKER only because the server (`isTooSoon`) is authoritative and correct. Expected: compute the client today key with `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` (tz is already passed to `CalendarView`).

**MAJOR-3 — `CalendarPostRow` / `CalendarPostMetrics` type duplication drift (typescript-reviewer). ✅ CORRECTED (20D-3).** Declared twice: `lib/calendar/types.ts:9-32` (comment: "lib/db/posts.ts re-exports this type in BP2") **and** independently in `lib/db/posts.ts:11-34`. The re-export never happened; nothing enforces they stay in sync — a future field on one silently diverges from the other, and the two halves of the codebase import different copies. Expected: keep one definition and `export { … }` it from the other (CLAUDE.md: shared types).

**MAJOR-4 — Keyboard users cannot open the pane on movable boxes (a11y, §9/§10). [PLAUSIBLE — verify in browser] ✅ VERIFIED (confirmed) + CORRECTED (20D-4).** `CampaignDayBox` is simultaneously the dnd-kit draggable (with `KeyboardSensor`) and the `<button>` whose `onClick` opens the pane. dnd-kit's `KeyboardSensor` claims Space/Enter to start a keyboard drag and `preventDefault`s, so on `allMovable` (draft/approved) boxes the keyboard "click" that opens the pane is shadowed — i.e. exactly the actionable boxes (approve/edit/move-to live in the pane) become keyboard-unreachable for opening. Expected: verify with a keyboard; if confirmed, add a distinct keyboard affordance to open the pane (e.g. a separate drag handle, or open-on-Enter with drag on a modifier).

### MINOR

**MINOR-1 — Observability absent (§10). ✅ CORRECTED (20D-5).** None of the three mandated canonical log lines (`reschedule_post`, `reschedule_group`, `reschedule_rejected{reason}`) nor Sentry id-only capture exist; `actions.ts` has no logger calls at all. Expected: emit the three id-only JSON lines via the project logger.

**MINOR-2 — `approvePostFromCalendarAction` lacks the defense-in-depth business_id guard (security-reviewer). ✅ CORRECTED (20D-5).** `actions.ts:225-241` → `approvePost` filters only by `id` + `status='draft'` + `deleted_at IS NULL`, relying solely on RLS for tenant isolation (vs `reschedulePost`'s explicit `business_id`). Consistent with the pre-existing `approvePost` helper, so not a regression — worth tightening to match.

**MINOR-3 — `buildPlatformPostUrl` omits `encodeURIComponent` (security-reviewer). ✅ CORRECTED (20D-5).** `platform-url.ts:22` interpolates `platformPostId` straight into the URL. Server/worker-populated so low exploitability, but encode for defense-in-depth.

**MINOR-4 — Edit offered on `failed`/`skipped` posts. ✅ CORRECTED (20D-4).** `PostRow.tsx:175` shows Edit whenever `!isPublishedOrScheduled`, i.e. also for `failed`/`skipped`. `updatePostFromCalendarAction` only blocks published/scheduled, then `updatePostContent`'s `status IN (draft,approved)` guard silently no-ops → the action returns `ok:true` with nothing changed. Expected: gate Edit to `draft`/`approved`.

**MINOR-5 — Unsafe cast on the list-read (typescript-reviewer). ✅ CORRECTED (20D-3).** `posts.ts:101` `(data ?? []) as unknown as RawCalendarRow[]` erases structural checking on the joined shape. Prefer typing the `.select()` generic or a narrower cast.

**MINOR-6 — Box aria-label announces a raw ISO date. ✅ CORRECTED (20D-4).** `CampaignDayBox.tsx:114` passes `date: cell.dayKey` (`2026-07-01`) into `box.open_label`; screen readers read the ISO string rather than a localized "July 1". Format for AT.

### NIT

**NIT-1 — ✅ CORRECTED (20D-4).** `CampaignDayBox.tsx:39` `showDraftBadge = cell.anyDraft && !cell.allSkipped`; `!allSkipped` is redundant (`allSkipped ⇒ !anyDraft`).

**NIT-2 — ✅ CORRECTED (20D-1).** `CalendarView.tsx:197,201` use a ternary as a statement (`month === 1 ? navigate(...) : navigate(...)`) → 2 eslint `no-unused-expressions` warnings. Use `if/else`.

**NIT-3 — NO ACTION NEEDED.** pt/es `calendar.json` are fully translated rather than the ADR §10/§14 "mirror EN verbatim, defer translation" plan. Harmless over-delivery; just reflect "done" (or "needs native review") in the deferred-translation tracking so it isn't re-done.

---

## Verdict

**Shipped — correction pass complete.**

The architecture is faithful to ADR 0012 Rev B — the concurrency-critical pieces (the guarded single-statement `reschedulePost`, the `scheduled`-excluded draggable set, tz-correct grouping and source-box re-read, server-authoritative `too_soon`, revert-first edit, RLS-only reads with server-derived `businessId`) are all correct, and security found no BLOCKER/MAJOR. No re-architecture was needed.

The correction pass ran as three sequential Builder sessions:
- **20D-1:** BLOCKER-1 (enforced ESLint gate — `toUtcIso()` sweep), MAJOR-2 (business-tz "today"), NIT-2 (ternary-as-statement).
- **20D-2:** MAJOR-1 (group reschedule → one atomic `reschedule_posts_batch` RPC; security-reviewer confirmed RLS still gates every row).
- **20D-3:** MAJOR-3 (type duplication collapsed to one source of truth), MINOR-5 (unsafe cast removed; typescript-reviewer PASS).
- **20D-4:** MAJOR-4 (keyboard shadowing — confirmed in code review, not just plausible; fixed via a dedicated drag-handle button, catching and fixing a related double-activation bug along the way), MINOR-4 (Edit gating), MINOR-6 (localized aria-label), NIT-1 (redundant guard).
- **20D-5:** MINOR-1 (id-only observability), MINOR-2 (`approvePost` business_id guard), MINOR-3 (`encodeURIComponent`); security-reviewer re-run returned clean.

Final state: ESLint clean, `tsc --noEmit --skipLibCheck` clean (bar the pre-existing unrelated error), 659 tests passing. No open findings remain from this report.
