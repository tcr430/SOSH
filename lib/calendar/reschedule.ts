import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { toUtcIso } from '@/lib/utils'

/**
 * Preserves the post's business-tz wall-clock time-of-day onto a new target day.
 *
 * Algorithm (CAL-2 / ADR 0012 §7b):
 * 1. Convert the current UTC instant to a "zoned" Date via toZonedTime so that
 *    the UTC fields of the returned Date equal the LOCAL hour/minute/second.
 * 2. Overwrite the UTC date components (year/month/day) with the target day —
 *    machine-timezone-independent because we use UTC setters.
 * 3. fromZonedTime converts the local-time-in-tz back to UTC.
 *
 * DST policy (R8, adopted intentionally):
 * - Gap (spring forward): date-fns-tz forward-shifts the non-existent local time.
 * - Overlap (autumn back): date-fns-tz picks the later UTC+0 occurrence.
 *
 * Returns a UTC ISO string via toUtcIso() (CLAUDE.md date rule).
 */
export function computeRescheduledInstant(
  currentScheduledAtUtc: string,
  targetDayKey: string,           // business-tz 'yyyy-MM-dd'
  tz: string,
): string {
  const source = new Date(currentScheduledAtUtc)

  // toZonedTime stores the LOCAL time in the UTC fields of the returned Date,
  // making subsequent UTC-field reads portable across machine timezones.
  const zoned = toZonedTime(source, tz)

  // Replace only the date component; preserve the local-stored time-of-day.
  // toZonedTime stores the tz-local values in getDate()/getHours() (machine-local
  // fields), so we must use setFullYear (not setUTCFullYear) to stay in sync
  // with what fromZonedTime will read back.
  const [y, mo, d] = targetDayKey.split('-').map(Number)
  zoned.setFullYear(y, mo - 1, d)

  // Convert the local (tz) wall time back to UTC.
  return toUtcIso(fromZonedTime(zoned, tz))
}
