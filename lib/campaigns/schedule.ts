import { addDays, addWeeks, getISOWeek, getISOWeekYear, isAfter } from 'date-fns'
import type { Platform, CampaignFrequency, CampaignRow } from '@/lib/db/types'
import { toUtcIso } from '@/lib/utils'

export interface ScheduleInput {
  startDate: string         // YYYY-MM-DD (campaigns.start_date)
  endDate: string | null    // YYYY-MM-DD or null
  frequency: CampaignFrequency
  postsPerWeek: number
  platform: Platform
  count: number             // exact number of posts to schedule for this platform
  timezone: string          // IANA zone from businesses.timezone
}

interface SlotConfig {
  days: number[]  // 0=Sun … 6=Sat per getUTCDay()
  hours: number[] // hours in the business's local timezone
}

export const OPTIMAL_SLOTS: Record<Platform, SlotConfig> = {
  linkedin:  { days: [2, 3, 4],          hours: [9] },         // Tue/Wed/Thu 09:00
  twitter:   { days: [1, 2, 3, 4, 5],    hours: [12, 17] },    // weekdays noon/17:00
  instagram: { days: [1, 3, 5],          hours: [12] },        // Mon/Wed/Fri 12:00
  facebook:  { days: [1, 2, 3, 4, 5],    hours: [13] },        // weekdays 13:00
  threads:   { days: [1, 2, 3, 4, 5],    hours: [12] },        // weekdays 12:00
}

const WEEKDAYS = [1, 2, 3, 4, 5]
const MAX_WIDENING_PASSES = 3

function weekCapFor(frequency: CampaignFrequency, postsPerWeek: number): number {
  if (frequency === 'daily') return 7
  if (frequency === 'weekly') return 1
  return postsPerWeek // '3x_week' | 'custom'
}

function isoWeekKey(date: Date): string {
  return `${getISOWeekYear(date)}-W${getISOWeek(date)}`
}

function utcDateStr(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Converts a local-time hour on a calendar date in the given timezone to a UTC ISO string.
// Uses Intl.DateTimeFormat to find the offset; handles standard DST for typical
// scheduling hours (9am, 12pm, 1pm, 5pm).
function localHourToUTCIso(dateStr: string, localHour: number, timezone: string): string {
  const h = String(localHour).padStart(2, '0')
  // Naive candidate: treat local time as if it were UTC
  const naive = new Date(`${dateStr}T${h}:00:00.000Z`)
  // Find what hour this naive UTC moment shows as in the target timezone
  const tzHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(naive)
  const tzHour = parseInt(tzHourStr, 10) % 24
  // Subtract the difference so local time lands on localHour
  return toUtcIso(new Date(naive.getTime() - (tzHour - localHour) * 3_600_000))
}

function buildCandidates(
  startDate: string,
  endDate: string,
  platform: Platform,
  frequency: CampaignFrequency,
  postsPerWeek: number,
  timezone: string,
): string[] {
  const { days, hours } = OPTIMAL_SLOTS[platform]
  const validDays = frequency === 'daily' ? WEEKDAYS : days
  const weekCap = weekCapFor(frequency, postsPerWeek)

  const candidates: string[] = []
  const weekCounts = new Map<string, number>()

  // Noon UTC anchor avoids DST day-boundary issues when walking day-by-day
  let cursor = new Date(`${startDate}T12:00:00.000Z`)
  const end = new Date(`${endDate}T12:00:00.000Z`)
  let hourIndex = 0

  while (cursor <= end) {
    const dow = cursor.getUTCDay() // noon UTC = same calendar day in all UTC-11…UTC+12

    if (validDays.includes(dow)) {
      const wk = isoWeekKey(cursor)
      const used = weekCounts.get(wk) ?? 0

      if (used < weekCap) {
        const localHour = hours[hourIndex % hours.length]
        hourIndex++
        candidates.push(localHourToUTCIso(utcDateStr(cursor), localHour, timezone))
        weekCounts.set(wk, used + 1)
      }
    }

    cursor = addDays(cursor, 1)
  }

  return candidates
}

function pickEvenlySpaced(candidates: string[], count: number): string[] {
  if (count <= 0) return []
  if (candidates.length <= count) return [...candidates]
  if (count === 1) return [candidates[0]]

  const result: string[] = []
  const step = (candidates.length - 1) / (count - 1)
  for (let i = 0; i < count; i++) {
    result.push(candidates[Math.round(i * step)])
  }
  return result
}

// Fills remaining slots by adding extra hours (+1h, +2h, …) on already-scheduled dates.
// Falls back to startDate when no base dates exist.
function fillExtraSlots(
  base: string[],
  needed: number,
  startDate: string,
  platform: Platform,
  timezone: string,
): string[] {
  if (needed <= 0) return base

  const result = [...base]
  const used = new Set(base)
  const baseDates = base.length > 0
    ? [...new Set(base.map(s => s.slice(0, 10)))]
    : [startDate]

  const baseHour = OPTIMAL_SLOTS[platform].hours[0]
  let extraOffset = base.length > 0 ? 1 : 0
  let dateIdx = 0

  while (result.length - base.length < needed) {
    const date = baseDates[dateIdx % baseDates.length]
    const h = (baseHour + extraOffset) % 24
    const iso = localHourToUTCIso(date, h, timezone)

    if (!used.has(iso)) {
      result.push(iso)
      used.add(iso)
    }

    dateIdx++
    if (dateIdx % baseDates.length === 0) extraOffset++
    if (extraOffset > 23) break
  }

  return result
}

export function schedulePosts(input: ScheduleInput): string[] {
  const { startDate, endDate, frequency, postsPerWeek, platform, count, timezone } = input

  // Step 1 — Derive window end date
  const windowEnd = endDate !== null
    ? endDate
    : utcDateStr(addWeeks(new Date(`${startDate}T12:00:00.000Z`), Math.ceil(count / postsPerWeek)))

  // Steps 2–5 — Try initial window, widen up to MAX_WIDENING_PASSES times
  let currentEnd = windowEnd
  let candidates: string[] = []

  for (let pass = 0; pass <= MAX_WIDENING_PASSES; pass++) {
    candidates = buildCandidates(startDate, currentEnd, platform, frequency, postsPerWeek, timezone)
    if (candidates.length >= count) break
    currentEnd = utcDateStr(addWeeks(new Date(`${currentEnd}T12:00:00.000Z`), 1))
  }

  // Step 4 / fallback — pick or fill to reach exactly count
  let selected: string[]
  if (candidates.length >= count) {
    selected = pickEvenlySpaced(candidates, count)
  } else {
    const partial = pickEvenlySpaced(candidates, candidates.length)
    selected = fillExtraSlots(partial, count - partial.length, startDate, platform, timezone)
  }

  // Step 6 — clamp to endDate, sort ascending, return up to count
  // Use end-of-day UTC so slots ON the endDate (e.g. 09:00) are not incorrectly filtered.
  const endLimit = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null
  const clamped = endLimit
    ? selected.filter(slot => !isAfter(new Date(slot), endLimit))
    : selected

  return clamped
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .slice(0, count)
}

// Estimates total posts a campaign will generate across all platforms.
// Used at campaign-creation time to set total_posts_planned.
// Timezone-neutral (UTC equivalent) — exact counts are determined at generation time.
export function estimateTotalPosts(campaign: CampaignRow): number {
  const platforms = campaign.platforms as Platform[]
  const totalDays = campaign.end_date
    ? (new Date(`${campaign.end_date}T00:00:00Z`).getTime() -
       new Date(`${campaign.start_date}T00:00:00Z`).getTime()) / 86_400_000
    : 28

  const weeks = Math.max(1, totalDays / 7)
  const frequency = campaign.frequency as CampaignFrequency
  const weekCap = weekCapFor(frequency, campaign.posts_per_week)

  return platforms.reduce((sum, platform) => {
    const validDays = frequency === 'daily' ? WEEKDAYS : OPTIMAL_SLOTS[platform].days
    const naturalPerWeek = Math.min(validDays.length, weekCap)
    return sum + Math.round(naturalPerWeek * weeks)
  }, 0)
}
