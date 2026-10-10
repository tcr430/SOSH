import type { SupabaseClient } from '@supabase/supabase-js'
import { listAccountLabels } from '@/lib/db/social-accounts'
import { listCampaignNamesByIds } from '@/lib/db/campaigns'
import { listCitedPostsByIds } from '@/lib/db/posts'
import type { ReportPayload, StoredActivity, StoredCampaignRow } from '@/lib/reports/assemble'
import type { Activity, CampaignTableRow } from './load'

// Session 37-D D2 (MINOR-7, ruling A-12(a)): a stored report holds IDS, never a name. The write-once table cannot be rectified,
// and an account handle is a natural person's data once founder profiles ship. So the campaign names and the account labels a
// report prints are resolved HERE, at read time, by (business, ids), through the caller's AUTHENTICATED client:
//
//   * a campaign that no longer exists (or was deleted) has no name here, and the section renders its existing "Open campaign" fallback;
//   * an account that was removed has no label, and the row renders UNRECORDED_KEY ("Account not recorded or since removed");
//   * a row that does not carry THIS business's id is ignored (the fallback, never another business's label), whatever the client returns.
//
// The business name is the business row the page already holds; the email, sent once and never stored, uses live labels too.

/** A cited post as it is NOW: its platform, when it went out, and the campaign it belongs to (for the link). Absent = removed. */
export interface CitedPost {
  platform: string
  publishedAt: string
  campaignId: string
}

export interface ReportLabels {
  campaigns: Readonly<Record<string, string>>
  accounts: Readonly<Record<string, string>>
  /** Posts the report cites (section 5), by id. A post that is gone has no entry and renders "Post removed" (MINOR-4). */
  posts: Readonly<Record<string, CitedPost>>
}

export const NO_LABELS: ReportLabels = { campaigns: {}, accounts: {}, posts: {} }

const UNRECORDED_KEY = 'analytics.account.unrecorded'

/** The ids a stored payload cites, in first-seen order and de-duplicated. */
export function labelIdsOf(payload: Pick<ReportPayload, 'activity' | 'campaigns'> & Partial<Pick<ReportPayload, 'ratedPosts'>>): { campaignIds: string[]; accountIds: string[]; postIds: string[] } {
  return {
    postIds: [...new Set((payload.ratedPosts?.byPlatform ?? []).flatMap((p) => p.posts.map((post) => post.postId)))],
    campaignIds: [...new Set((payload.campaigns ?? []).map((c) => c.campaignId))],
    accountIds: [...new Set((payload.activity?.rows ?? []).flatMap((r) => (r.accountId === null ? [] : [r.accountId])))],
  }
}

export async function resolveReportLabels(client: SupabaseClient, businessId: string, payload: Pick<ReportPayload, 'activity' | 'campaigns'> & Partial<Pick<ReportPayload, 'ratedPosts'>>): Promise<ReportLabels> {
  const { campaignIds, accountIds, postIds } = labelIdsOf(payload)
  const [campaigns, accounts, posts] = await Promise.all([
    campaignIds.length > 0 ? listCampaignNamesByIds(client, businessId, campaignIds) : Promise.resolve([]),
    accountIds.length > 0 ? listAccountLabels(client, businessId, accountIds) : Promise.resolve([]),
    postIds.length > 0 ? listCitedPostsByIds(client, businessId, postIds) : Promise.resolve([]),
  ])
  return {
    posts: Object.fromEntries(posts.filter((p) => p.business_id === businessId).map((p) => [p.id, { platform: p.platform, publishedAt: p.published_at, campaignId: p.campaign_id }])),
    campaigns: Object.fromEntries(campaigns.filter((c) => c.business_id === businessId && c.name).map((c) => [c.id, c.name])),
    accounts: Object.fromEntries(
      accounts.flatMap((a) => {
        const label = a.platform_display_name ?? a.platform_username
        return a.business_id === businessId && label ? [[a.id, label] as const] : []
      }),
    ),
  }
}

/** The stored activity block, with account labels put back for display (the NULL bucket and a removed account both read as unrecorded). */
export function hydrateActivity(stored: StoredActivity, labels: ReportLabels): Activity {
  return {
    ...stored,
    rows: stored.rows.map((r) => {
      const label = r.accountId === null ? undefined : labels.accounts[r.accountId]
      return { ...r, label: label ?? null, labelKey: label === undefined ? UNRECORDED_KEY : null }
    }),
  }
}

/** The stored campaign rows, with names put back; a campaign without one keeps `name: null` (the "Open campaign" fallback). */
export function hydrateCampaigns(stored: readonly StoredCampaignRow[], labels: ReportLabels): CampaignTableRow[] {
  return stored.map((c) => ({ ...c, name: labels.campaigns[c.campaignId] ?? null }))
}
