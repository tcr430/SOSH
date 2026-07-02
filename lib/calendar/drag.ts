import { formatInTimeZone } from 'date-fns-tz'
import type { CampaignDayCell } from './types'

// ── Drag payload attached to every draggable CampaignDayBox ──────────────────

export interface DragData {
  type: 'campaign-day-box'
  campaignId: string
  sourceDayKey: string  // business-tz 'yyyy-MM-dd' where the box started
  campaignName: string
  colorIndex: number
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Returns today's day key ('yyyy-MM-dd') in the business timezone (CAL-2).
 * The calendar clock is business-tz, not machine/UTC — this feeds both the
 * grid's isToday highlight and the client-side drop boundary.
 */
export function getTodayKeyInTz(tz: string): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
}

/**
 * Returns true iff a day cell may receive a drop.
 * Rejects: today, any past day, any out-of-month day (R6 / CAL-4 / ADR 0012).
 * The server re-enforces this guard — this is a client-side UX hint only.
 */
export function isDayDroppable(
  dayKey: string,
  todayKey: string,
  currentYear: number,
  currentMonth: number,
): boolean {
  if (dayKey <= todayKey) return false  // today and all past days rejected
  const [y, mo] = dayKey.split('-').map(Number)
  return y === currentYear && mo === currentMonth  // out-of-month rejected
}

/**
 * Formats a 'yyyy-MM-dd' day key as a localized long date (e.g. "July 1, 2026")
 * for screen-reader-facing labels (20D-4 / MINOR-6) — never expose the raw ISO
 * key to assistive technology.
 */
export function formatDayKeyForLocale(dayKey: string, locale: string): string {
  const [y, mo, d] = dayKey.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(Date.UTC(y, mo - 1, d)))
}

/**
 * Returns a new cells array with the matching box moved to targetDayKey.
 * Immutable — does NOT mutate the input array.
 * Used for optimistic UI updates on drag end.
 */
export function moveBoxOptimistically(
  cells: CampaignDayCell[],
  campaignId: string,
  sourceDayKey: string,
  targetDayKey: string,
): CampaignDayCell[] {
  return cells.map(cell =>
    cell.campaignId === campaignId && cell.dayKey === sourceDayKey
      ? { ...cell, dayKey: targetDayKey }
      : cell,
  )
}
