import { parseISO, isValid } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { monthOf, previousPeriod } from '@/lib/analytics/period'
import { REPORT_DUE_DAY, REPORT_DUE_UTC_HOUR } from './constants'

// ADR 0031 §5.2 (REPORT-ONE-PER-PERIOD) — when a business's report for month M is due. Pure: the clock is an argument.
//
// Due when BOTH hold:
//   1. its local date (businesses.timezone) is on or after day 10 of month M+1; and
//   2. now is at or after 06:00 UTC on day 10 of M+1.
// Day 10 works because the last day's posts mature at day 7 plus 2 days' grace, and extract-outcomes runs daily at
// 04:00 UTC. Condition 2 matters EAST of UTC: in Pacific/Auckland local day 10 starts around 12:00 UTC on day 9, before
// that grace has run out for a post published late on local day 31, so the 04:00 UTC run of day 10 must have finished.
// West of UTC condition 1 is the later and governs.
//
// ONLY M-1 is ever generated: the answer is always the month before the business's CURRENT local month, so a gap is
// never back-filled and a month older than that is never produced.
//
// (The UTC condition is evaluated per business against ITS month M+1, not once for the whole tick: a tick-wide "UTC day
// >= 10" would hold back a west-of-UTC business whose local month is still the previous UTC month.)

export function reportPeriodDue(now: string, timezone: string): string | null {
  const at = parseISO(now)
  if (!isValid(at)) throw new Error('reports due: non-finite timestamp ' + JSON.stringify(now))
  const localMonth = monthOf(now, timezone)
  const localDay = Number(formatInTimeZone(at, timezone, 'd'))
  if (localDay < REPORT_DUE_DAY) return null

  const [year, month] = localMonth.split('-').map(Number)
  const gate = Date.UTC(year, month - 1, REPORT_DUE_DAY, REPORT_DUE_UTC_HOUR, 0, 0)
  if (at.getTime() < gate) return null

  return previousPeriod(localMonth)
}

/** The `period_month` date column value for a `YYYY-MM` period. */
export function periodMonthDate(period: string): string {
  return period + '-01'
}
