import { addMonths, format, isValid, parse, parseISO, subMonths } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

// ADR 0031 §2.3 — a post belongs to the calendar month, in `businesses.timezone`, that contains its `published_at`.
// Not the viewing member's timezone (two members would see different months and a snapshot cannot be per-viewer) and
// not UTC (a post at 00:30 Lisbon summer time on 1 April is 23:30 UTC on 31 March). Pure: no clock, no I/O.

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

function assertPeriod(period: string): void {
  if (!PERIOD.test(period)) throw new Error(`analytics period: expected YYYY-MM, got ${JSON.stringify(period)}`)
}

/** `YYYY-MM` of the business-local calendar month that contains the instant. Throws on a non-finite timestamp or an unknown timezone. */
export function monthOf(publishedAt: string, timezone: string): string {
  const at = parseISO(publishedAt)
  if (!isValid(at)) throw new Error(`analytics period: non-finite timestamp ${JSON.stringify(publishedAt)}`)
  return formatInTimeZone(at, timezone, 'yyyy-MM')
}

// Month arithmetic runs on a LOCAL Date built from the period's own digits and is formatted back locally, so the
// machine's timezone cancels out (a UTC-midnight Date shifted in a UTC-3 process would land on the wrong month).
function shiftPeriod(period: string, months: number): string {
  assertPeriod(period)
  const first = parse(period, 'yyyy-MM', new Date(2000, 0, 1, 12))
  return format(months < 0 ? subMonths(first, -months) : addMonths(first, months), 'yyyy-MM')
}

export function previousPeriod(period: string): string {
  return shiftPeriod(period, -1)
}

function utcIso(instant: Date): string {
  return formatInTimeZone(instant, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
}

/** The half-open UTC interval [start, end) covered by the business-local month. */
export function periodBounds(period: string, timezone: string): { start: string; end: string } {
  assertPeriod(period)
  const start = fromZonedTime(`${period}-01T00:00:00`, timezone)
  const end = fromZonedTime(`${shiftPeriod(period, 1)}-01T00:00:00`, timezone)
  if (!isValid(start) || !isValid(end)) throw new Error(`analytics period: cannot place ${period} in ${JSON.stringify(timezone)}`)
  return { start: utcIso(start), end: utcIso(end) }
}
