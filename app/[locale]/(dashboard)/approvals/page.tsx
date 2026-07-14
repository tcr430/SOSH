import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { listCampaigns } from '@/lib/db/campaigns'
import { listPendingDraftPosts } from '@/lib/db/posts'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import type { Platform } from '@/lib/db/types'
import { ApprovalsInbox } from './ApprovalsInbox'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parsePlatform(value: string | undefined): Platform | undefined {
  return value && (PLATFORMS as readonly string[]).includes(value) ? (value as Platform) : undefined
}

function parseCampaignId(value: string | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined
}

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ campaign?: string; platform?: string }>
}) {
  const { locale } = await params
  // ADR 0014 Amendment A2 (APV-SERVER-FILTER, closing 21C n3) — a deep-linked
  // filtered view fetches server-filtered rows and a matching total, not just
  // the business-wide set.
  const { campaign: campaignParam, platform: platformParam } = await searchParams
  const campaignId = parseCampaignId(campaignParam)
  const platform = parsePlatform(platformParam)
  const t = await getTranslations('approvals')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const memberRow =
    business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
  const member = resolveMemberContext(business, user.id, memberRow)

  // ROLE-APPROVALS-GATED (§9.1): visible to approve-capable members
  // (approver) AND admins — not a plain CAPABILITIES.APPROVE echo, which
  // only covers the approver role. This is UX only; enforce_post_transition_
  // capability is the real boundary on the approve action itself (0013 §5.1).
  const canSeeApprovals = hasCapability(member, CAPABILITIES.APPROVE) || member.isAdmin
  if (!canSeeApprovals) redirect(`/${locale}/campaigns`)

  const [{ rows: posts, total: totalPendingCount }, campaigns] = await Promise.all([
    listPendingDraftPosts(client, { businessId: business.id, campaignId, platform }),
    listCampaigns(client, business.id),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ApprovalsInbox posts={posts} campaigns={campaigns} totalPendingCount={totalPendingCount} />
    </div>
  )
}
