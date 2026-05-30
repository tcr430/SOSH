import { describe, test, expect } from 'vitest'
import { schedulePosts, estimateTotalPosts } from './schedule'
import type { CampaignRow } from '@/lib/db/types'

// Anchored to a Monday so day-of-week assertions are deterministic
const START = '2026-05-25'  // Monday
const END_2W = '2026-06-07' // Sunday, 13 days later (~2 weeks)
const TZ = 'UTC'

describe('schedulePosts', () => {
  test('returns exactly count strings', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 4,
      timezone: TZ,
    })
    expect(result).toHaveLength(4)
  })

  test('all strings are valid ISO-8601 UTC', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 3,
      timezone: TZ,
    })
    for (const s of result) {
      expect(new Date(s).toISOString()).toBe(s)
    }
  })

  test('output is sorted ascending', () => {
    const result = schedulePosts({
      platform: 'twitter',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 5,
      timezone: TZ,
    })
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i]).getTime()).toBeGreaterThan(new Date(result[i - 1]).getTime())
    }
  })

  test('no duplicate timestamps', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 5,
      timezone: TZ,
    })
    expect(new Set(result).size).toBe(result.length)
  })

  test('count=1 returns exactly one string', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 1,
      timezone: TZ,
    })
    expect(result).toHaveLength(1)
  })

  // ── Platform optimal slots ────────────────────────────────────────────────

  test('linkedin: Tue/Wed/Thu at 09:00 UTC', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 4,
      timezone: TZ,
    })
    for (const s of result) {
      const d = new Date(s)
      expect([2, 3, 4]).toContain(d.getUTCDay())
      expect(d.getUTCHours()).toBe(9)
    }
  })

  test('twitter: hours are 12 or 17 UTC', () => {
    const result = schedulePosts({
      platform: 'twitter',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 5,
      timezone: TZ,
    })
    for (const s of result) {
      expect([12, 17]).toContain(new Date(s).getUTCHours())
    }
  })

  test('instagram: Mon/Wed/Fri at 12:00 UTC', () => {
    const result = schedulePosts({
      platform: 'instagram',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 4,
      timezone: TZ,
    })
    for (const s of result) {
      const d = new Date(s)
      expect([1, 3, 5]).toContain(d.getUTCDay())
      expect(d.getUTCHours()).toBe(12)
    }
  })

  test('facebook: weekdays at 13:00 UTC', () => {
    const result = schedulePosts({
      platform: 'facebook',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 3,
      timezone: TZ,
    })
    for (const s of result) {
      const d = new Date(s)
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay())
      expect(d.getUTCHours()).toBe(13)
    }
  })

  test('threads: weekdays at 12:00 UTC', () => {
    const result = schedulePosts({
      platform: 'threads',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 3,
      timezone: TZ,
    })
    for (const s of result) {
      const d = new Date(s)
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay())
      expect(d.getUTCHours()).toBe(12)
    }
  })

  // ── Frequency modes ───────────────────────────────────────────────────────

  test('daily: uses all weekdays regardless of platform optimal days', () => {
    // linkedin optimal is Tue/Wed/Thu only — daily should open Mon/Fri too
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: 'daily',
      postsPerWeek: 5,
      count: 8,
      timezone: TZ,
    })
    expect(result).toHaveLength(8)
    for (const s of result) {
      expect([1, 2, 3, 4, 5]).toContain(new Date(s).getUTCDay())
    }
  })

  test('weekly: at most 1 post per ISO week', () => {
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: 'weekly',
      postsPerWeek: 1,
      count: 2,
      timezone: TZ,
    })
    expect(result).toHaveLength(2)
    const d1 = new Date(result[0])
    const d2 = new Date(result[1])
    expect(d1.getUTCDate()).not.toBe(d2.getUTCDate())
  })

  // ── Window derivation ─────────────────────────────────────────────────────

  test('null endDate: window = ceil(count/postsPerWeek) weeks from startDate', () => {
    // count=6, postsPerWeek=3 → 2-week window; linkedin has exactly 6 Tue/Wed/Thu slots
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: null,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 6,
      timezone: TZ,
    })
    expect(result).toHaveLength(6)
  })

  // ── Fallback behaviour ────────────────────────────────────────────────────

  test('count exceeding natural candidates returns exactly count strings', () => {
    // No endDate so clamp does not apply; widening finds enough within MAX_WIDENING_PASSES
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: null,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 4,
      timezone: TZ,
    })
    expect(result).toHaveLength(4)
  })

  test('startDate === endDate returns available slots within that day', () => {
    // Monday is a valid threads day (12:00 UTC); count=1 fits within the single-day window
    const result = schedulePosts({
      platform: 'threads',
      startDate: START,
      endDate: START,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 1,
      timezone: TZ,
    })
    expect(result).toHaveLength(1)
  })

  // ── End-date clamping ─────────────────────────────────────────────────────

  test('clamps output to endDate — no slot returned after endDate', () => {
    // LinkedIn optimal Tue/Wed/Thu. endDate is Tuesday May 26 (1 natural slot).
    // count=3 forces widening to Wed/Thu and beyond; clamp must remove those.
    const endDate = '2026-05-26'
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 3,
      timezone: TZ,
    })
    const ceiling = new Date(`${endDate}T23:59:59.999Z`).getTime()
    for (const slot of result) {
      expect(new Date(slot).getTime()).toBeLessThanOrEqual(ceiling)
    }
    expect(result).toHaveLength(1)
  })

  // ── Timezone conversion ───────────────────────────────────────────────────

  test('timezone offset shifts UTC hour correctly', () => {
    // Europe/Lisbon in summer = WEST = UTC+1; LinkedIn 09:00 local → 08:00 UTC
    const result = schedulePosts({
      platform: 'linkedin',
      startDate: START,
      endDate: END_2W,
      frequency: '3x_week',
      postsPerWeek: 3,
      count: 3,
      timezone: 'Europe/Lisbon',
    })
    expect(result).toHaveLength(3)
    for (const s of result) {
      expect(new Date(s).getUTCHours()).toBe(8)
    }
  })
})

describe('estimateTotalPosts', () => {
  test('returns sum of estimated posts across all platforms', () => {
    const campaign = {
      id: 'test',
      business_id: 'biz',
      name: 'Test',
      objective: 'test',
      special_instructions: null,
      platforms: ['linkedin', 'twitter'],
      frequency: '3x_week',
      posts_per_week: 3,
      start_date: START,
      end_date: END_2W,
      status: 'draft',
      total_posts_planned: 0,
      total_posts_published: 0,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as CampaignRow

    // linkedin: 6 (Tue/Wed/Thu × 2 weeks, cap 3/week)
    // twitter: 6 (weekdays capped at 3/week × 2 weeks)
    expect(estimateTotalPosts(campaign)).toBe(12)
  })

  test('single platform returns that platform estimate', () => {
    const campaign = {
      platforms: ['instagram'],
      frequency: '3x_week',
      posts_per_week: 3,
      start_date: START,
      end_date: END_2W,
    } as unknown as CampaignRow

    // instagram: Mon/Wed/Fri × 2 weeks = 6
    expect(estimateTotalPosts(campaign)).toBe(6)
  })
})
