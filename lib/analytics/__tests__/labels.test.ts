import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Session 37-D D2 (MINOR-7, A-12(a)): the resolver turns a stored payload's ids into the names and labels a reader sees, by
// (business, ids) through the caller's authenticated client. The two readers are faked as a LEAKY database: they answer by id
// only and ignore the business, so every guarantee asserted here is the resolver's own.
const mocks = vi.hoisted(() => ({ listCampaignNamesByIds: vi.fn(), listAccountLabels: vi.fn(), listCitedPostsByIds: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ listCampaignNamesByIds: mocks.listCampaignNamesByIds }))
vi.mock('@/lib/db/social-accounts', () => ({ listAccountLabels: mocks.listAccountLabels }))
vi.mock('@/lib/db/posts', () => ({ listCitedPostsByIds: mocks.listCitedPostsByIds }))

import { hydrateActivity, hydrateCampaigns, labelIdsOf, resolveReportLabels, NO_LABELS } from '../labels'

const client = { tag: 'authenticated-client' } as unknown as SupabaseClient
const A = 'biz-a'
const B = 'biz-b'

const TABLE_CAMPAIGNS = [
  { id: 'ca1', business_id: A, name: 'Launch week' },
  { id: 'ca2', business_id: A, name: 'Case studies' },
  { id: 'cb1', business_id: B, name: 'B secret campaign' },
]
const TABLE_ACCOUNTS = [
  { id: 'xa1', business_id: A, platform: 'twitter', platform_username: 'founder_handle', platform_display_name: null },
  { id: 'la1', business_id: A, platform: 'linkedin', platform_username: 'acme-page', platform_display_name: 'Acme on LinkedIn' },
  { id: 'xb1', business_id: B, platform: 'twitter', platform_username: 'b_secret_handle', platform_display_name: null },
]

const TABLE_POSTS = [
  { id: 'pa1', business_id: A, platform: 'twitter', published_at: '2026-03-04T10:00:00Z', campaign_id: 'ca1' },
  { id: 'pa2', business_id: A, platform: 'twitter', published_at: '2026-03-09T10:00:00Z', campaign_id: 'ca2' },
  { id: 'pb1', business_id: B, platform: 'twitter', published_at: '2026-03-05T10:00:00Z', campaign_id: 'cb1' },
]

const payload = (campaignIds: string[], accountIds: Array<string | null>, postIds: string[] = []) => ({
  ratedPosts: { titleKey: 'k', caveatKey: 'k', state: 'shown' as const, byPlatform: postIds.length > 0 ? [{ platform: 'twitter', posts: postIds.map((postId) => ({ postId, rate: '1.0%', badge: 'above' as const })) }] : [] },
  campaigns: campaignIds.map((campaignId) => ({ campaignId, status: 'active', published: 1, href: '/campaigns/' + campaignId, retro: null })),
  activity: { total: accountIds.length, previousTotal: 0, campaigns: { withPosts: 0, retrospectivesCompleted: 0 }, rows: accountIds.map((accountId) => ({ platform: 'twitter', accountId, count: 1 })) },
})

beforeEach(() => {
  mocks.listCampaignNamesByIds.mockReset().mockImplementation(async (_c: unknown, _b: string, ids: string[]) => TABLE_CAMPAIGNS.filter((c) => ids.includes(c.id)))
  mocks.listAccountLabels.mockReset().mockImplementation(async (_c: unknown, _b: string, ids: string[]) => TABLE_ACCOUNTS.filter((a) => ids.includes(a.id)))
  mocks.listCitedPostsByIds.mockReset().mockImplementation(async (_c: unknown, _b: string, ids: string[]) => TABLE_POSTS.filter((p) => ids.includes(p.id)))
})

describe('labelIdsOf', () => {
  it('lists the cited ids once each, without the NULL account bucket', () => {
    expect(labelIdsOf(payload(['ca1', 'ca2', 'ca1'], ['xa1', null, 'xa1', 'la1']))).toEqual({ campaignIds: ['ca1', 'ca2'], accountIds: ['xa1', 'la1'], postIds: [] })
  })
  it('is empty for a stub payload (no sections)', () => {
    expect(labelIdsOf({})).toEqual({ campaignIds: [], accountIds: [], postIds: [] })
  })
})

describe('resolveReportLabels', () => {
  it('reads exactly the cited ids for THIS business with the caller\'s client, and returns names and labels', async () => {
    const labels = await resolveReportLabels(client, A, payload(['ca1', 'ca2'], ['xa1', 'la1', null]))
    expect(mocks.listCampaignNamesByIds).toHaveBeenCalledWith(client, A, ['ca1', 'ca2'])
    expect(mocks.listAccountLabels).toHaveBeenCalledWith(client, A, ['xa1', 'la1'])
    // platform_display_name wins, the username is the fallback.
    expect(labels).toEqual({ campaigns: { ca1: 'Launch week', ca2: 'Case studies' }, accounts: { xa1: 'founder_handle', la1: 'Acme on LinkedIn' }, posts: {} })
  })

  it('a FOREIGN id never resolves to the other business\'s name or handle, even when the database returns that row', async () => {
    const labels = await resolveReportLabels(client, A, payload(['ca1', 'cb1'], ['xa1', 'xb1']))
    expect(labels.campaigns).toEqual({ ca1: 'Launch week' })
    expect(labels.accounts).toEqual({ xa1: 'founder_handle' })
    expect(JSON.stringify(labels)).not.toContain('secret')
  })

  it('a removed campaign and a removed account are simply absent (their rows render the fallback)', async () => {
    const labels = await resolveReportLabels(client, A, payload(['ca1', 'gone'], ['xa1', 'gone-account']))
    expect(labels.campaigns).toEqual({ ca1: 'Launch week' })
    expect(labels.accounts).toEqual({ xa1: 'founder_handle' })
  })

  it('MINOR-4: the cited posts are read by (business, ids) with the caller client; platform, date and campaign come back, a foreign or removed post is absent', async () => {
    const labels = await resolveReportLabels(client, A, payload([], [], ['pa1', 'pa2', 'pb1', 'gone']))
    expect(mocks.listCitedPostsByIds).toHaveBeenCalledWith(client, A, ['pa1', 'pa2', 'pb1', 'gone'])
    expect(labels.posts).toEqual({
      pa1: { platform: 'twitter', publishedAt: '2026-03-04T10:00:00Z', campaignId: 'ca1' },
      pa2: { platform: 'twitter', publishedAt: '2026-03-09T10:00:00Z', campaignId: 'ca2' },
    })
    expect(JSON.stringify(labels)).not.toContain('cb1')
  })

  it('MINOR-4: ids are listed once each, in first-seen order, across platforms', () => {
    expect(labelIdsOf(payload([], [], ['pa1', 'pa2', 'pa1'])).postIds).toEqual(['pa1', 'pa2'])
  })

  it('makes no read at all for a payload that cites nothing', async () => {
    expect(await resolveReportLabels(client, A, {})).toEqual(NO_LABELS)
    expect(mocks.listCampaignNamesByIds).not.toHaveBeenCalled()
    expect(mocks.listAccountLabels).not.toHaveBeenCalled()
    expect(mocks.listCitedPostsByIds).not.toHaveBeenCalled()
  })

  it('does not swallow a read failure: no report is rendered from a half-resolved set', async () => {
    mocks.listAccountLabels.mockRejectedValue(new Error('db down'))
    await expect(resolveReportLabels(client, A, payload(['ca1'], ['xa1']))).rejects.toThrow('db down')
  })
})

describe('hydration', () => {
  const labels = { campaigns: { ca1: 'Launch week' }, accounts: { xa1: 'founder_handle' }, posts: {} }

  it('puts the account label back; the NULL bucket and a removed account both read as unrecorded', () => {
    const stored = payload([], ['xa1', null, 'removed']).activity
    expect(hydrateActivity(stored, labels).rows).toEqual([
      { platform: 'twitter', accountId: 'xa1', count: 1, label: 'founder_handle', labelKey: null },
      { platform: 'twitter', accountId: null, count: 1, label: null, labelKey: 'analytics.account.unrecorded' },
      { platform: 'twitter', accountId: 'removed', count: 1, label: null, labelKey: 'analytics.account.unrecorded' },
    ])
  })

  it('puts the campaign name back; a campaign without one keeps name null (the "Open campaign" fallback)', () => {
    const rows = hydrateCampaigns(payload(['ca1', 'gone'], []).campaigns, labels)
    expect(rows.map((r) => [r.campaignId, r.name])).toEqual([['ca1', 'Launch week'], ['gone', null]])
  })
})
