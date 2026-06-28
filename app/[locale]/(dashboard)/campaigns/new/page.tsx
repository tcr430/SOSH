import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { listVariations } from '@/lib/db/voice'
import { CampaignForm } from './CampaignForm'

type Props = {
  params: Promise<{ locale: string }>
}

export default async function NewCampaignPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('campaigns.new')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const [connectedAccounts, variations] = await Promise.all([
    listActiveSocialAccounts(client, business.id),
    listVariations(client, business.id),
  ])

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>
      <CampaignForm connectedAccounts={connectedAccounts} variations={variations} locale={locale} />
    </div>
  )
}
