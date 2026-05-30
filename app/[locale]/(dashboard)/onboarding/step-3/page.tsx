import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { listByBusiness } from '@/lib/db/social-accounts'
import { PLATFORM_CONFIGS } from '@/lib/social'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { Step3Client } from './Step3Client'
import type { Platform, SocialAccountPublic } from '@/lib/social'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ connected?: string }>
}

export default async function Step3Page({ params, searchParams }: Props) {
  const { locale } = await params
  const { connected } = await searchParams

  const t = await getTranslations('onboarding.step3')

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const accounts = await listByBusiness(client, business.id)

  const accountsByPlatform = Object.fromEntries(
    accounts.map(a => [a.platform, a]),
  ) as Partial<Record<Platform, SocialAccountPublic>>

  const connectedParam =
    connected && connected in PLATFORM_CONFIGS ? (connected as Platform) : null

  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
      <OnboardingProgress step={3} />

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Step3Client
        platforms={PLATFORMS}
        initialAccounts={accountsByPlatform}
        locale={locale}
        connectedParam={connectedParam}
      />
    </div>
  )
}
