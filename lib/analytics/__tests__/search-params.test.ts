import { describe, it, expect } from 'vitest'
import { currentPeriod, monthOptions, parsePeriod, parsePostFilters } from '../search-params'

// ADR 0031 §4.1, §10.6 — every search param is Zod-validated; the business is never one of them; an invalid value falls
// back to its default instead of reaching a reader.
const FALLBACK = '2026-04'
const UUID = '40000000-0000-4000-8000-000000000001'

describe('parsePeriod', () => {
  it('accepts YYYY-MM', () => expect(parsePeriod({ month: '2026-03' }, FALLBACK)).toBe('2026-03'))
  it.each([['2026-3'], ['2026-13'], ['2026-00'], ['march'], [''], ['2026-03-01'], ['../etc'], ["2026-03'; drop"]])('%j falls back', (month) => {
    expect(parsePeriod({ month }, FALLBACK)).toBe(FALLBACK)
  })
  it('takes the first of a repeated param, and falls back when absent', () => {
    expect(parsePeriod({ month: ['2026-02', '2026-03'] }, FALLBACK)).toBe('2026-02')
    expect(parsePeriod({}, FALLBACK)).toBe(FALLBACK)
  })
})

describe('parsePostFilters', () => {
  it('reads a platform, an account, a campaign and the month', () => {
    expect(parsePostFilters({ month: '2026-03', platform: 'twitter', account: UUID, campaign: UUID }, FALLBACK)).toEqual({
      period: '2026-03',
      platform: 'twitter',
      accountId: UUID,
      campaignId: UUID,
    })
  })
  it('"none" is the NULL-account bucket', () => {
    expect(parsePostFilters({ account: 'none' }, FALLBACK)).toEqual({ period: FALLBACK, accountId: 'none' })
  })
  it('an unknown platform, a malformed id and an empty value are DROPPED, never passed on', () => {
    expect(parsePostFilters({ platform: 'myspace', account: 'x', campaign: 'not-a-uuid' }, FALLBACK)).toEqual({ period: FALLBACK })
    expect(parsePostFilters({ platform: '', account: '', campaign: '' }, FALLBACK)).toEqual({ period: FALLBACK })
  })
  it('a business id in the query is ignored: it is not a recognised key', () => {
    expect(parsePostFilters({ business: UUID, business_id: UUID, businessId: UUID }, FALLBACK)).toEqual({ period: FALLBACK })
  })
})

describe('the picker options', () => {
  it('are the current month and the 11 before it, newest first, across a year boundary', () => {
    const o = monthOptions('2026-03')
    expect(o).toHaveLength(12)
    expect(o[0]).toBe('2026-03')
    expect(o[11]).toBe('2025-04')
  })
  it('the default month is the business-local month: 2026-03-31T23:30Z is April in Lisbon and still March in UTC', () => {
    expect(currentPeriod('2026-03-31T23:30:00Z', 'Europe/Lisbon')).toBe('2026-04')
    expect(currentPeriod('2026-03-31T23:30:00Z', 'UTC')).toBe('2026-03')
  })
})
