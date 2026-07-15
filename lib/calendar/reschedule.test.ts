import { describe, it, expect } from 'vitest'
import { computeRescheduledInstant } from './reschedule'

// Europe/Lisbon 2026 DST:
//   Spring forward: 2026-03-29 01:00 WET → 02:00 WEST  (gap: 01:xx doesn't exist)
//   Autumn back:    2026-10-25 02:00 WEST → 01:00 WET   (overlap: 01:xx occurs twice)
// Pacific/Honolulu: UTC-10, no DST

describe('computeRescheduledInstant', () => {
  // ---- Basic preservation -------------------------------------------------

  it('preserves Lisbon WEST wall-clock time onto a future summer day', () => {
    // 2026-07-10T09:00:00Z = 10:00 WEST in Lisbon; move to July 15
    // Expected: 10:00 WEST = 09:00 UTC on July 15
    expect(computeRescheduledInstant(
      '2026-07-10T09:00:00Z',
      '2026-07-15',
      'Europe/Lisbon',
    )).toBe('2026-07-15T09:00:00.000Z')
  })

  it('preserves Lisbon WET wall-clock time onto a future winter day', () => {
    // 2026-01-10T09:00:00Z = 09:00 WET (UTC+0); move to Jan 20
    // Expected: 09:00 WET = 09:00 UTC on Jan 20
    expect(computeRescheduledInstant(
      '2026-01-10T09:00:00Z',
      '2026-01-20',
      'Europe/Lisbon',
    )).toBe('2026-01-20T09:00:00.000Z')
  })

  // ---- DST: spring forward (gap) -----------------------------------------

  it('DST spring-forward gap: 01:30 WET source lands on gap day — resolved via WEST offset, machine-tz-independent (R8)', () => {
    // Source: 2026-03-28T01:30:00Z = 01:30 WET in Lisbon
    // Target: 2026-03-29 — gap day; 01:30 local doesn't exist (clocks jump 01:00->02:00)
    // fromZonedTime resolves the literal '01:30' wall-clock string against the WEST
    // (UTC+1, post-transition) offset => 01:30 - 1h = 00:30 UTC. Verified identical
    // under TZ=UTC / TZ=Europe/Lisbon / TZ=America/New_York (R8: "date-fns-tz default").
    expect(computeRescheduledInstant(
      '2026-03-28T01:30:00Z',
      '2026-03-29',
      'Europe/Lisbon',
    )).toBe('2026-03-29T00:30:00.000Z')
  })

  it('DST spring-forward: a time outside the gap is correctly mapped on the transition day', () => {
    // 2026-03-28T02:00:00Z = 02:00 WET (UTC+0) on March 28 (pre-spring-forward)
    // On March 29, 02:00 is past the gap (gap was 01:00→02:00) → 02:00 WEST = 01:00 UTC
    expect(computeRescheduledInstant(
      '2026-03-28T02:00:00Z',
      '2026-03-29',
      'Europe/Lisbon',
    )).toBe('2026-03-29T01:00:00.000Z') // 02:00 WEST = 01:00 UTC
  })

  // ---- DST: autumn back (overlap) -----------------------------------------

  it('DST autumn-back overlap: 01:30 WEST source on overlap day uses date-fns-tz default (R8)', () => {
    // Source: 2026-10-24T00:30:00Z = 01:30 WEST (UTC+1) in Lisbon
    // Target: 2026-10-25 — overlap day; 01:30 appears twice (WEST then WET)
    // date-fns-tz picks WET (UTC+0) → 01:30 UTC (R8 named behaviour)
    expect(computeRescheduledInstant(
      '2026-10-24T00:30:00Z',
      '2026-10-25',
      'Europe/Lisbon',
    )).toBe('2026-10-25T01:30:00.000Z')
  })

  it('DST autumn-back: a mid-morning time avoids the overlap zone entirely', () => {
    // 2026-10-24T08:00:00Z = 09:00 WEST (UTC+1) on Oct 24
    // On Oct 25, 09:00 is after the fall-back (02:00 WEST→01:00 WET at 01:00 UTC)
    // → 09:00 WET (UTC+0) = 09:00 UTC
    expect(computeRescheduledInstant(
      '2026-10-24T08:00:00Z',
      '2026-10-25',
      'Europe/Lisbon',
    )).toBe('2026-10-25T09:00:00.000Z') // 09:00 WET = 09:00 UTC
  })

  // ---- Off-UTC timezone (Pacific/Honolulu, UTC-10, no DST) ----------------

  it('preserves Honolulu wall-clock time (UTC-10) correctly across the date-line', () => {
    // 2026-07-10T00:00:00Z = 2026-07-09T14:00:00-10:00 (Honolulu)
    // Move to Honolulu day '2026-07-20': 14:00 HST = 00:00 UTC July 21
    expect(computeRescheduledInstant(
      '2026-07-10T00:00:00Z',
      '2026-07-20',
      'Pacific/Honolulu',
    )).toBe('2026-07-21T00:00:00.000Z')
  })

  it('Honolulu midnight preserves correctly (UTC-10)', () => {
    // 2026-07-10T10:00:00Z = 2026-07-10T00:00:00-10:00
    // Move to July 20 local: 00:00 HST = 10:00 UTC
    expect(computeRescheduledInstant(
      '2026-07-10T10:00:00Z',
      '2026-07-20',
      'Pacific/Honolulu',
    )).toBe('2026-07-20T10:00:00.000Z')
  })

  // ---- Output format ------------------------------------------------------

  it('returns a UTC ISO string ending in Z', () => {
    const result = computeRescheduledInstant(
      '2026-07-10T09:00:00Z',
      '2026-07-15',
      'UTC',
    )
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
