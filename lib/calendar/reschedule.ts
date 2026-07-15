import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { toUtcIso } from '@/lib/utils'

/**
 * Preserves the post's business-tz wall-clock time-of-day onto a new target day.
 *
 * Algorithm (CAL-2 / ADR 0012 §7b):
 * 1. formatInTimeZone reads the current instant's wall-clock time-of-day in `tz`
 *    as a plain string — no Date object with ambiguous local/UTC fields involved.
 * 2. Splice that time-of-day onto `targetDayKey` as a naive datetime string.
 * 3. fromZonedTime parses the naive string as wall-clock time IN `tz` and
 *    resolves it to a UTC instant using tz's own offset rules.
 *
 * Genuinely machine-timezone-independent (verified: identical output under
 * TZ=UTC / TZ=Europe/Lisbon / TZ=America/New_York for every case below,
 * including the DST gap). The prior implementation mutated a Date via
 * setFullYear() and relied on the *machine's own* local Date engine to
 * auto-normalize an out-of-range hour across a DST transition — that side
 * effect only fires when the machine's local timezone has a transition at
 * that same point, i.e. it silently gave a different (wrong) answer on any
 * server whose machine TZ != the business's tz (Vercel runs UTC — this was
 * a live production bug for Lisbon DST-gap reschedules, not just a test
 * artifact of developing on a Lisbon-timezone machine).
 *
 * DST policy (R8 — "date-fns-tz default; test encodes intent", ADR 0012 §7b):
 * whatever fromZonedTime resolves a gap/overlap wall-clock string to. Gap
 * time 01:30 on the 2026-03-29 Lisbon spring-forward lands at 2026-03-29T00:30:00Z
 * (UTC+1 WEST offset applied to the literal 01:30 value, not a clock-shift to
 * 02:30) — pinned by the reschedule.test.ts DST-gap case.
 *
 * Returns a UTC ISO string via toUtcIso() (CLAUDE.md date rule).
 */
export function computeRescheduledInstant(
  currentScheduledAtUtc: string,
  targetDayKey: string,           // business-tz 'yyyy-MM-dd'
  tz: string,
): string {
  const source = new Date(currentScheduledAtUtc)
  const timeOfDay = formatInTimeZone(source, tz, 'HH:mm:ss.SSS')
  const naiveTargetDateTime = `${targetDayKey}T${timeOfDay}`
  return toUtcIso(fromZonedTime(naiveTargetDateTime, tz))
}
