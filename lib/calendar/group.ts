import { formatInTimeZone } from 'date-fns-tz'
import { colorIndex } from './colors'
import type { CalendarPostRow, CampaignDayCell } from './types'
import type { Platform } from '@/lib/db/types'

// Grouping key: (campaign_id, business-tz calendar day) — never stored (CAL-1)
function cellKey(campaignId: string, dayKey: string): string {
  return `${campaignId}::${dayKey}`
}

/**
 * Groups a flat post list into per-(campaign × business-tz-day) cells.
 *
 * Pure: no I/O, no Date.now(). "Today" is passed in by the caller where needed.
 * Day bucket uses formatInTimeZone so off-UTC timezones bucket correctly (CAL-2 / R3).
 */
export function groupByCampaignDay(
  rows: CalendarPostRow[],
  tz: string,
): CampaignDayCell[] {
  const map = new Map<string, {
    campaignId: string
    campaignName: string
    dayKey: string
    platformSet: Set<Platform>
    postIds: string[]
    statuses: string[]
  }>()

  for (const row of rows) {
    const dayKey = formatInTimeZone(new Date(row.scheduled_at), tz, 'yyyy-MM-dd')
    const key = cellKey(row.campaign_id, dayKey)

    let entry = map.get(key)
    if (!entry) {
      entry = {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        dayKey,
        platformSet: new Set(),
        postIds: [],
        statuses: [],
      }
      map.set(key, entry)
    }

    entry.platformSet.add(row.platform)
    entry.postIds.push(row.id)
    entry.statuses.push(row.status)
  }

  const cells: CampaignDayCell[] = []

  for (const entry of map.values()) {
    const statuses = entry.statuses
    cells.push({
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      dayKey: entry.dayKey,
      colorIndex: colorIndex(entry.campaignId, 8),
      platforms: [...entry.platformSet].sort() as Platform[],
      postIds: entry.postIds,
      allPublished: statuses.every(s => s === 'published'),
      anyDraft: statuses.some(s => s === 'draft'),
      anyFailed: statuses.some(s => s === 'failed'),
      allMovable: statuses.every(s => s === 'draft' || s === 'approved'),
      allSkipped: statuses.every(s => s === 'skipped'),
    })
  }

  // Deterministic order: dayKey → campaignName → campaignId (CAL-2 / §4c)
  cells.sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey)
    if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName)
    return a.campaignId.localeCompare(b.campaignId)
  })

  return cells
}
