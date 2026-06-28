import { describe, it, expect } from 'vitest'
import { groupByCampaignDay } from './group'
import type { CalendarPostRow } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: CalendarPostRow = {
  id: 'post-aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  campaign_id: 'camp-aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  campaign_name: 'Alpha Campaign',
  platform: 'linkedin',
  status: 'draft',
  content: 'Hello',
  hashtags: [],
  scheduled_at: '2026-07-10T09:00:00Z',
  published_at: null,
  platform_post_id: null,
  metrics: null,
}

function post(overrides: Partial<CalendarPostRow>): CalendarPostRow {
  return { ...BASE, ...overrides }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('groupByCampaignDay', () => {
  it('returns an empty array for empty input', () => {
    expect(groupByCampaignDay([], 'UTC')).toEqual([])
  })

  it('single post produces one cell with correct fields', () => {
    const cells = groupByCampaignDay([BASE], 'UTC')
    expect(cells).toHaveLength(1)
    const cell = cells[0]
    expect(cell.campaignId).toBe(BASE.campaign_id)
    expect(cell.campaignName).toBe(BASE.campaign_name)
    expect(cell.dayKey).toBe('2026-07-10')
    expect(cell.platforms).toEqual(['linkedin'])
    expect(cell.postIds).toEqual([BASE.id])
    expect(cell.anyDraft).toBe(true)
    expect(cell.allPublished).toBe(false)
    expect(cell.anyFailed).toBe(false)
    expect(cell.allMovable).toBe(true)
    expect(cell.allSkipped).toBe(false)
  })

  it('two posts same campaign + day → one cell, two postIds', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'linkedin' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'twitter' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells).toHaveLength(1)
    expect(cells[0].postIds).toHaveLength(2)
    expect(cells[0].platforms).toEqual(['linkedin', 'twitter'])
  })

  it('two posts same campaign + day, same platform → one platform icon in cell', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'linkedin' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'linkedin' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells).toHaveLength(1)
    expect(cells[0].platforms).toEqual(['linkedin']) // deduplicated
    expect(cells[0].postIds).toHaveLength(2)
  })

  it('two campaigns same day → two cells', () => {
    const p1 = post({ campaign_id: 'camp-aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaign_name: 'Alpha' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaign_id: 'camp-bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', campaign_name: 'Beta' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells).toHaveLength(2)
  })

  it('same campaign different days → two cells', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduled_at: '2026-07-10T09:00:00Z' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduled_at: '2026-07-11T09:00:00Z' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells).toHaveLength(2)
    const keys = cells.map(c => c.dayKey).sort()
    expect(keys).toEqual(['2026-07-10', '2026-07-11'])
  })

  // ---- Status flag tests --------------------------------------------------

  it('allPublished true iff every post is published', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'published', published_at: '2026-07-10T10:00:00Z' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'published', published_at: '2026-07-10T10:00:00Z' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allPublished).toBe(true)
  })

  it('allPublished false when one post is not published', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'published', published_at: '2026-07-10T10:00:00Z' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allPublished).toBe(false)
  })

  it('anyDraft true when at least one post is draft', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'approved' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].anyDraft).toBe(true)
  })

  it('anyFailed true when at least one post is failed', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'published', published_at: '2026-07-10T10:00:00Z' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'failed' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].anyFailed).toBe(true)
  })

  it('allMovable true when every post is draft or approved (CAL-3)', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'approved' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allMovable).toBe(true)
  })

  it('allMovable false when any post is scheduled (CAL-3)', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'scheduled' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allMovable).toBe(false)
  })

  it('allSkipped true iff every post is skipped (R7)', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'skipped' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'skipped' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allSkipped).toBe(true)
  })

  it('allSkipped false when one post is not skipped (R7)', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'skipped' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft' })
    const cells = groupByCampaignDay([p1, p2], 'UTC')
    expect(cells[0].allSkipped).toBe(false)
  })

  // ---- Timezone bucketing -------------------------------------------------

  it('off-UTC tz: 23:00 UTC stays on the same local day in Pacific/Honolulu', () => {
    // 2026-07-10T23:00:00Z = 2026-07-10T13:00:00-10:00 (Honolulu)
    const p = post({ scheduled_at: '2026-07-10T23:00:00Z' })
    const cells = groupByCampaignDay([p], 'Pacific/Honolulu')
    expect(cells[0].dayKey).toBe('2026-07-10')
  })

  it('off-UTC tz: UTC July 11 instant that is still July 10 in Pacific/Honolulu', () => {
    // 2026-07-11T08:00:00Z = 2026-07-10T22:00:00-10:00 (Honolulu — still July 10)
    const p = post({ scheduled_at: '2026-07-11T08:00:00Z' })
    const cells = groupByCampaignDay([p], 'Pacific/Honolulu')
    expect(cells[0].dayKey).toBe('2026-07-10')
  })

  // ---- Deterministic ordering ---------------------------------------------

  it('cells are ordered by dayKey then campaignName then campaignId', () => {
    const rows: CalendarPostRow[] = [
      post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduled_at: '2026-07-12T09:00:00Z', campaign_id: 'camp-cccc-cccc-4ccc-8ccc-cccccccccccc', campaign_name: 'Zeta' }),
      post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduled_at: '2026-07-10T09:00:00Z', campaign_id: 'camp-aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaign_name: 'Alpha' }),
      post({ id: 'post-3333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduled_at: '2026-07-10T09:00:00Z', campaign_id: 'camp-bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', campaign_name: 'Beta' }),
    ]
    const cells = groupByCampaignDay(rows, 'UTC')
    expect(cells.map(c => c.dayKey)).toEqual(['2026-07-10', '2026-07-10', '2026-07-12'])
    expect(cells.map(c => c.campaignName)).toEqual(['Alpha', 'Beta', 'Zeta'])
  })

  it('platforms list is stable-sorted', () => {
    const p1 = post({ id: 'post-1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'twitter' })
    const p2 = post({ id: 'post-2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'linkedin' })
    const p3 = post({ id: 'post-3333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', platform: 'instagram' })
    const cells = groupByCampaignDay([p1, p2, p3], 'UTC')
    expect(cells[0].platforms).toEqual([...cells[0].platforms].sort())
  })
})
