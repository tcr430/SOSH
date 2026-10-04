import { describe, it, expect } from 'vitest'
import { monthOf, previousPeriod, periodBounds } from '../period'
import { EXPECTED } from '../__fixtures__/portfolio'

// ADR 0031 §2.3: a post belongs to the calendar month, in the BUSINESS timezone, that contains its published_at.
describe('monthOf (ADR 0031 §2.3)', () => {
  it('Lisbon 2026-03-31T23:30Z is 00:30 on 1 April local: APRIL (UTC says March)', () => {
    const b = EXPECTED.boundaries.lisbon
    expect(monthOf(b.at, b.timezone)).toBe('2026-04')
    expect(monthOf(b.at, 'UTC')).toBe('2026-03')
    // The literals, not the fixture's own, so a wrong EXPECTED cannot hide a wrong monthOf.
    expect(monthOf('2026-03-31T23:30:00Z', 'Europe/Lisbon')).toBe('2026-04')
  })

  it('Sao Paulo 2026-04-01T00:30Z is 21:30 on 31 March local: MARCH (UTC says April)', () => {
    const b = EXPECTED.boundaries.saoPaulo
    expect(monthOf(b.at, b.timezone)).toBe('2026-03')
    expect(monthOf(b.at, 'UTC')).toBe('2026-04')
    expect(monthOf('2026-04-01T00:30:00Z', 'America/Sao_Paulo')).toBe('2026-03')
  })

  it('the boundary is exact to the instant: Lisbon summer time starts 29 March 2026, so 22:59:59Z is still March, 23:00:00Z is April', () => {
    expect(monthOf('2026-03-31T22:59:59Z', 'Europe/Lisbon')).toBe('2026-03')
    expect(monthOf('2026-03-31T23:00:00Z', 'Europe/Lisbon')).toBe('2026-04')
  })

  it('Lisbon in winter (UTC+0) agrees with UTC', () => {
    expect(monthOf('2026-01-31T23:30:00Z', 'Europe/Lisbon')).toBe('2026-01')
  })

  it('year boundary: Sao Paulo 2027-01-01T01:00Z is 22:00 on 31 December 2026 local', () => {
    expect(monthOf('2027-01-01T01:00:00Z', 'America/Sao_Paulo')).toBe('2026-12')
  })

  it('a non-finite timestamp and an unknown timezone THROW rather than file the post somewhere', () => {
    expect(() => monthOf('not-a-date', 'Europe/Lisbon')).toThrow(/timestamp/)
    expect(() => monthOf('2026-03-01T00:00:00Z', 'Mars/Olympus')).toThrow()
  })
})

describe('previousPeriod', () => {
  it('steps one calendar month back, across a year boundary', () => {
    expect(previousPeriod('2026-03')).toBe('2026-02')
    expect(previousPeriod('2026-01')).toBe('2025-12')
  })
  it('rejects anything that is not YYYY-MM', () => {
    expect(() => previousPeriod('2026-3')).toThrow(/period/)
    expect(() => previousPeriod('2026-13')).toThrow(/period/)
  })
})

describe('periodBounds: [start, end) in UTC for a month in the business timezone', () => {
  it('Lisbon April 2026 (UTC+1 from 29 March): 2026-03-31T23:00Z to 2026-04-30T23:00Z', () => {
    expect(periodBounds('2026-04', 'Europe/Lisbon')).toEqual({ start: '2026-03-31T23:00:00.000Z', end: '2026-04-30T23:00:00.000Z' })
  })
  it('Sao Paulo March 2026 (UTC-3, no DST): 2026-03-01T03:00Z to 2026-04-01T03:00Z', () => {
    expect(periodBounds('2026-03', 'America/Sao_Paulo')).toEqual({ start: '2026-03-01T03:00:00.000Z', end: '2026-04-01T03:00:00.000Z' })
  })
  it('a post on the Lisbon boundary falls inside April bounds and outside March bounds', () => {
    const at = '2026-03-31T23:30:00Z'
    const april = periodBounds('2026-04', 'Europe/Lisbon')
    const march = periodBounds('2026-03', 'Europe/Lisbon')
    expect(at >= april.start && at < april.end).toBe(true)
    expect(at >= march.start && at < march.end).toBe(false)
  })
})
