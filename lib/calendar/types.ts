import type { Platform, PostStatus } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// CalendarPostRow — flat read result from listPostsForCalendar (lib/db/posts.ts).
// Defined here so pure calendar helpers (group, reschedule) can import it
// without touching the DB layer. lib/db/posts.ts re-exports this type in BP2.
// ---------------------------------------------------------------------------

export interface CalendarPostMetrics {
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  reach: number | null
  impressions: number | null
  last_synced_at: string
}

export interface CalendarPostRow {
  id: string
  campaign_id: string
  campaign_name: string
  platform: Platform
  status: PostStatus
  content: string
  hashtags: string[]
  scheduled_at: string         // UTC ISO
  published_at: string | null
  platform_post_id: string | null
  metrics: CalendarPostMetrics | null
}

export interface CalendarReadResult {
  rows: CalendarPostRow[]
  overflow: boolean
}

// ---------------------------------------------------------------------------
// CampaignDayCell — one (campaign × business-tz day) box on the grid.
// Computed by groupByCampaignDay(); never stored (CAL-1).
// ---------------------------------------------------------------------------

export interface CampaignDayCell {
  campaignId: string
  campaignName: string
  dayKey: string          // business-tz 'yyyy-MM-dd'
  colorIndex: number
  platforms: Platform[]   // distinct, stable-sorted
  postIds: string[]
  allPublished: boolean
  anyDraft: boolean
  anyFailed: boolean
  allMovable: boolean     // every post status ∈ {draft, approved}
  allSkipped: boolean     // every post status === 'skipped' (R7)
}
