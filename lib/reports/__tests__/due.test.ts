import { describe, it, expect } from 'vitest'
import { periodMonthDate, reportPeriodDue } from '../due'

// ADR 0031 §5.2 (REPORT-ONE-PER-PERIOD, the due rule). Both conditions: local day >= 10 of M+1 AND now >= 06:00 UTC on
// day 10 of M+1; only the month before the business's current local month is ever generated.
describe('reportPeriodDue', () => {
  it('Europe/Lisbon (UTC+1 in April): local day 9 is NOT due', () => {
    expect(reportPeriodDue('2026-04-09T22:59:59Z', 'Europe/Lisbon')).toBeNull() // 23:59 on 9 April
  })

  it('Lisbon at local midnight on day 10 (23:00Z on the 9th) is still NOT due: the UTC condition holds it until 06:00Z', () => {
    expect(reportPeriodDue('2026-04-09T23:00:00Z', 'Europe/Lisbon')).toBeNull()
    expect(reportPeriodDue('2026-04-10T05:59:59Z', 'Europe/Lisbon')).toBeNull()
  })

  it('Lisbon, 06:00:00Z on day 10: due, and the period is MARCH', () => {
    expect(reportPeriodDue('2026-04-10T06:00:00Z', 'Europe/Lisbon')).toBe('2026-03')
  })

  it('Pacific/Auckland is on local day 10 from 12:00Z on the 9th but is NOT due before 06:00Z on day 10 (the UTC condition)', () => {
    expect(reportPeriodDue('2026-04-09T12:30:00Z', 'Pacific/Auckland')).toBeNull() // local 00:30 on 10 April
    expect(reportPeriodDue('2026-04-10T05:59:59Z', 'Pacific/Auckland')).toBeNull() // local 17:59 on 10 April
    expect(reportPeriodDue('2026-04-10T06:00:00Z', 'Pacific/Auckland')).toBe('2026-03')
  })

  it('America/Sao_Paulo (UTC-3): local day 10 starts at 03:00Z, but 06:00Z governs', () => {
    expect(reportPeriodDue('2026-04-10T05:00:00Z', 'America/Sao_Paulo')).toBeNull()
    expect(reportPeriodDue('2026-04-10T06:00:00Z', 'America/Sao_Paulo')).toBe('2026-03')
  })

  it('Pacific/Honolulu (UTC-10): local day 10 starts at 10:00Z, LATER than 06:00Z, so the local condition governs', () => {
    expect(reportPeriodDue('2026-04-10T07:00:00Z', 'Pacific/Honolulu')).toBeNull() // 21:00 on 9 April
    expect(reportPeriodDue('2026-04-10T09:59:59Z', 'Pacific/Honolulu')).toBeNull()
    expect(reportPeriodDue('2026-04-10T10:00:00Z', 'Pacific/Honolulu')).toBe('2026-03')
  })

  it('ONLY M-1 is ever the answer: later in the month it is still the previous month, never one earlier', () => {
    expect(reportPeriodDue('2026-04-25T12:00:00Z', 'Europe/Lisbon')).toBe('2026-03')
    expect(reportPeriodDue('2026-05-20T12:00:00Z', 'Europe/Lisbon')).toBe('2026-04')
    expect(reportPeriodDue('2026-05-20T12:00:00Z', 'Europe/Lisbon')).not.toBe('2026-03')
  })

  it('days 1 to 9 of a month are never due, so a gap is not back-filled', () => {
    for (const day of ['01', '05', '09']) expect(reportPeriodDue('2026-05-' + day + 'T12:00:00Z', 'Europe/Lisbon')).toBeNull()
  })

  it('across a year boundary: January 2027 reports December 2026', () => {
    expect(reportPeriodDue('2027-01-12T12:00:00Z', 'Europe/Lisbon')).toBe('2026-12')
  })

  it('a non-finite timestamp and an unknown timezone THROW', () => {
    expect(() => reportPeriodDue('garbage', 'Europe/Lisbon')).toThrow(/timestamp/)
    expect(() => reportPeriodDue('2026-04-10T06:00:00Z', 'Mars/Olympus')).toThrow()
  })
})

describe('periodMonthDate', () => {
  it('is the first of the month, as the table CHECK requires', () => {
    expect(periodMonthDate('2026-03')).toBe('2026-03-01')
  })
})
