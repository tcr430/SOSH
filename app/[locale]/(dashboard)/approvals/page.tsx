import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { listCampaigns } from '@/lib/db/campaigns'
import { listPendingDraftPosts, listClaimChecksByPostIds, listRedundancyByPostIds } from '@/lib/db/posts'
import { retrieveEvidenceMemory } from '@/lib/memory'
import { listLatestPostAiOriginalsByPostIds } from '@/lib/db/post-ai-originals'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import type { Platform } from '@/lib/db/types'
import { ApprovalsInbox } from './ApprovalsInbox'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A short, plain-text label for an evidence row in the picker. Cut by code points so a surrogate pair is never split.
const SNIPPET_MAX_CHARS = 120
function toSnippet(content: string): string {
  const chars = Array.from(content.replace(/\s+/g, ' ').trim())
  return chars.length <= SNIPPET_MAX_CHARS ? chars.join('') : `${chars.slice(0, SNIPPET_MAX_CHARS).join('')}...`
}

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

  // ADR 0022 §10 (Session 29, F1b.9) — carousel/script previews need each
  // rendered post's latest post_ai_originals snapshot. A plain object, not the
  // Map listLatestPostAiOriginalsByPostIds returns — a Map isn't a serializable
  // prop across the Server->Client boundary.
  const originalsMap = await listLatestPostAiOriginalsByPostIds(client, posts.map(p => p.id))
  const originalsByPostId = Object.fromEntries(originalsMap)

  // ADR 0027 §4/§8 (K2.10) — the claim-verification verdicts for THIS page of posts (one bounded read by id; a post
  // with none is simply absent and renders "not checked", never "clean"), and — only when some post actually has an
  // open flag — the EXISTING evidence a reviewer may link to a claim (business-scoped, active, capped, through
  // lib/memory; it selects, never creates). A failed evidence read degrades to an empty picker, never a broken inbox.
  // ADR 0027 §5.8(b) (Session 34-D D9, MAJOR-5) — the redundancy flags for the same page, read the same way (one
  // bounded read by id through the caller's client; a flag on text since edited or regenerated is dropped).
  const [claimChecksByPostId, redundancyByPostId] = await Promise.all([
    listClaimChecksByPostIds(client, posts.map((p) => p.id)),
    listRedundancyByPostIds(client, posts.map((p) => p.id)),
  ])
  const anyOpenFlag = Object.values(claimChecksByPostId).some(
    (c) => c.status === 'checked' && c.claims.some((claim) => claim.outcome !== 'supported' && !claim.resolution),
  )
  const evidenceRows = anyOpenFlag ? await retrieveEvidenceMemory(client, business.id, {}).catch(() => []) : []
  const evidenceOptions = evidenceRows.map((row) => ({ id: row.id, snippet: toSnippet(row.content) }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ApprovalsInbox
        posts={posts}
        campaigns={campaigns}
        totalPendingCount={totalPendingCount}
        originalsByPostId={originalsByPostId}
        claimChecksByPostId={claimChecksByPostId}
        redundancyByPostId={redundancyByPostId}
        evidenceOptions={evidenceOptions}
      />
    </div>
  )
}
