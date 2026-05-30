import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { listCampaigns } from '@/lib/db/campaigns'
import { CampaignCard } from '@/components/campaigns/CampaignCard'

type Props = {
  params: Promise<{ locale: string }>
}

export default async function CampaignsPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('campaigns.list')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const campaigns = await listCampaigns(client, business.id)

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="flex flex-col items-center gap-6 max-w-sm">
          <CampaignEmptyIcon />
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">{t('empty.title')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('empty.description')}
            </p>
          </div>
          <Link href={`/${locale}/campaigns/new`} className={cn(buttonVariants())}>
            {t('empty.cta')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Link
          href={`/${locale}/campaigns/new`}
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          {t('new_button')}
        </Link>
      </div>

      <div className="space-y-4">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} locale={locale} />
        ))}
      </div>
    </div>
  )
}

function CampaignEmptyIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-muted-foreground/50"
      aria-hidden="true"
    >
      <rect x="12" y="8" width="40" height="48" rx="4" stroke="currentColor" strokeWidth="2" />
      <line x1="20" y1="20" x2="44" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="36" x2="36" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="44" cy="46" r="8" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
      <path
        d="M40.5 46l2.5 2.5 4.5-4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
