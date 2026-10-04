import { parseISO, isValid } from 'date-fns'

// Display formatting only: no aggregation lives here. Months are labelled from their own digits (UTC, so the machine's
// timezone cannot move a label); a date is shown in the business timezone.

export function monthLabel(period: string, locale: string, style: 'long' | 'short' = 'long'): string {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { month: style, year: style === 'long' ? 'numeric' : '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function dateLabel(iso: string, locale: string, timezone: string): string {
  const at = parseISO(iso)
  if (!isValid(at)) throw new Error('analytics format: non-finite timestamp ' + JSON.stringify(iso))
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }).format(at)
}
