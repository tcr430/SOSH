import { redirect, notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { BriefReviewForm } from './BriefReviewForm'

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

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <BriefReviewForm key={brief.id} campaignId={id} brief={brief} />
    </div>
  )
}
