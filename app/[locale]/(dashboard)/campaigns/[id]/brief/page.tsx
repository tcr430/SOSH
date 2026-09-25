import { redirect, notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { getMemberForUser } from '@/lib/db/business-members'
import { listCurrentVersionPlanProposals } from '@/lib/db/campaign-plan-proposals'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import { BriefReviewForm } from './BriefReviewForm'
import { PlanReviewPanel } from './PlanReviewPanel'

type Props = {
  params: Promise<{ locale: string; id: string }>
}

// ADR 0017 §10 — minimal Server Component shell (Server-Component-page +
// Client-form split, CLAUDE.md): fetches campaign + brief, delegates all
// interactivity to BriefReviewForm.
export default async function CampaignBriefPage({ params }: Props) {
  const { locale, id } = await params
  const t = await getTranslations('campaigns.brief')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/login`)

  const campaign = await getCampaignById(client, id)
  if (!campaign || campaign.business_id !== business.id) notFound()

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const serviceClient = createServiceRoleClient()
  const brief = await getBriefByCampaign(serviceClient, id)
  if (!brief) notFound()

  // ADR 0027 §8.4 (K2.10) — proposals are read through the CALLER'S client (the table's member-scoped SELECT policy
  // applies; it has no authenticated write grant at all), BOUNDED and all-ASC-ordered by
  // listCurrentVersionPlanProposals. Capability is user_can(business_id,'author'), REUSED (A-5): a UX echo only — the
  // RPCs enforce it.
  const memberRow = business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
  const canAuthor = hasCapability(resolveMemberContext(business, user.id, memberRow), CAPABILITIES.AUTHOR)
  // Session 34-D D10 (MINOR-7): the CURRENT version's proposals only, every status (§8.2 renders decided and
  // brief_frozen states), bounded and ordered to match campaign_plan_proposals_brief_version_idx.
  const proposals = await listCurrentVersionPlanProposals(client, brief.id, brief.version)

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      {/* Keyed on brief id + version: a ratified round advances the version, which remounts the panel with an empty
          selection. State is passed FROM THE PERSISTED ROW (plan_analysis_status / _reason), never derived. */}
      <PlanReviewPanel
        key={`${brief.id}-${brief.version}`}
        campaignId={id}
        briefVersion={brief.version}
        briefStatus={brief.status}
        planStatus={brief.plan_analysis_status}
        planReason={brief.plan_analysis_reason}
        proposals={proposals.map((p) => ({
          id: p.id,
          kind: p.kind,
          targetOrder: p.target_order,
          proposedRole: p.proposed_role,
          proposedOrder: p.proposed_order,
          reason: p.reason,
          status: p.status,
          supersededReason: p.superseded_reason,
          briefVersion: p.brief_version,
        }))}
        roleSequence={brief.content.roleSequence}
        canAuthor={canAuthor}
      />
      <BriefReviewForm key={brief.id} campaignId={id} brief={brief} />
    </div>
  )
}
