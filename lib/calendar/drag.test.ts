import { describe, it, expect, vi, afterEach } from 'vitest'
import { isDayDroppable, moveBoxOptimistically, getTodayKeyInTz, formatDayKeyForLocale } from './drag'
import type { CampaignDayCell } from './types'

const TODAY = '2026-06-29'
const YEAR = 2026
const MONTH = 6

function makeCell(overrides: Partial<CampaignDayCell> = {}): CampaignDayCell {
  return {
    campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaignName: 'Test Campaign',
    colorIndex: 0,
    dayKey: '2026-06-20',
    platforms: ['linkedin'],
    postIds: ['post-1', 'post-2'],
    allPublished: false,
    anyDraft: true,
    anyFailed: false,
    allMovable: true,
    allSkipped: false,
    ...overrides,
  }
}

// ── getTodayKeyInTz ───────────────────────────────────────────────────────────

describe('getTodayKeyInTz', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the business-tz local day, not the UTC day, near UTC midnight', () => {
    // 2026-06-30T05:00:00Z is 2026-06-29T19:00 in Pacific/Honolulu (UTC-10) —
    // UTC's calendar day has already rolled to the 30th while Honolulu is still on the 29th.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T05:00:00Z'))

    expect(getTodayKeyInTz('Pacific/Honolulu')).toBe('2026-06-29')
  })

  it('a business-tz-valid tomorrow is droppable client-side at the same instant', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T05:00:00Z'))

    const todayKey = getTodayKeyInTz('Pacific/Honolulu')
    expect(isDayDroppable('2026-06-30', todayKey, 2026, 6)).toBe(true)
  })
})

// ── formatDayKeyForLocale ─────────────────────────────────────────────────────

describe('formatDayKeyForLocale', () => {
  it('formats an en day key as a localized long date', () => {
    expect(formatDayKeyForLocale('2026-07-01', 'en')).toBe('July 1, 2026')
  })

  it('formats the same day key differently for pt', () => {
    const result = formatDayKeyForLocale('2026-07-01', 'pt')
    expect(result).not.toBe('2026-07-01')
    expect(result).not.toBe('July 1, 2026')
  })

  it('formats the same day key differently for es', () => {
    const result = formatDayKeyForLocale('2026-07-01', 'es')
    expect(result).not.toBe('2026-07-01')
    expect(result).not.toBe('July 1, 2026')
  })

  it('does not leak the raw ISO day key into the output', () => {
    expect(formatDayKeyForLocale('2026-07-01', 'en')).not.toContain('2026-07-01')
  })
})

// ── isDayDroppable ────────────────────────────────────────────────────────────

describe('isDayDroppable', () => {
  it('rejects today', () => {
    expect(isDayDroppable(TODAY, TODAY, YEAR, MONTH)).toBe(false)
  })

  it('rejects a past day in the same month', () => {
    expect(isDayDroppable('2026-06-01', TODAY, YEAR, MONTH)).toBe(false)
  })

  it('rejects a past day in a previous month', () => {
    expect(isDayDroppable('2026-05-31', TODAY, YEAR, MONTH)).toBe(false)
  })

  it('rejects an out-of-month future day (next month)', () => {
    expect(isDayDroppable('2026-07-01', TODAY, YEAR, MONTH)).toBe(false)
  })

  it('accepts tomorrow when it is in the current month', () => {
    expect(isDayDroppable('2026-06-30', TODAY, YEAR, MONTH)).toBe(true)
  })

  it('accepts a future in-month day', () => {
    expect(isDayDroppable('2026-06-25', '2026-06-10', YEAR, MONTH)).toBe(true)
  })
})

// ── moveBoxOptimistically ─────────────────────────────────────────────────────

describe('moveBoxOptimistically', () => {
  it('updates the dayKey of the matching cell', () => {
    const cells = [makeCell({ dayKey: '2026-06-20' })]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-20',
      '2026-06-25',
    )
    expect(result[0].dayKey).toBe('2026-06-25')
  })

  it('leaves other campaigns on the same day unchanged', () => {
    const cells = [
      makeCell({ campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dayKey: '2026-06-20' }),
      makeCell({ campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dayKey: '2026-06-20' }),
    ]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-20',
      '2026-06-25',
    )
    expect(result[1].dayKey).toBe('2026-06-20')
  })

  it('is a no-op for an unknown campaignId', () => {
    const cells = [makeCell({ dayKey: '2026-06-20' })]
    const result = moveBoxOptimistically(cells, 'unknown-id', '2026-06-20', '2026-06-25')
    expect(result[0].dayKey).toBe('2026-06-20')
  })

  it('is a no-op when sourceDayKey does not match', () => {
    const cells = [makeCell({ dayKey: '2026-06-20' })]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-15',
      '2026-06-25',
    )
    expect(result[0].dayKey).toBe('2026-06-20')
  })

  it('returns a new array (immutable)', () => {
    const cells = [makeCell()]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-20',
      '2026-06-25',
    )
    expect(result).not.toBe(cells)
  })

  it('returns a new cell object for the moved cell', () => {
    const cells = [makeCell()]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-20',
      '2026-06-25',
    )
    expect(result[0]).not.toBe(cells[0])
  })

  it('preserves all other cell fields when moving', () => {
    const cells = [makeCell({ dayKey: '2026-06-20', postIds: ['p1', 'p2'] })]
    const result = moveBoxOptimistically(
      cells,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-06-20',
      '2026-06-25',
    )
    expect(result[0].postIds).toEqual(['p1', 'p2'])
    expect(result[0].campaignId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})
