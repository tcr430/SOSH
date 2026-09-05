import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listByBusiness } from '@/lib/db/social-accounts'
import { getConnectionStatus, pickDefaultAccountId } from '@/lib/social'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'
import { AccountsClient } from './AccountsClient'
import { resolveAccountsBanner } from './resolve-banner'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ connected?: string; error?: string; platform?: string }>
}

export default async function AccountsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const resolvedSearchParams = await searchParams

  const t = await getTranslations('settings.accounts')

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const accounts = await listByBusiness(client, business.id)

  // ADR 0028 §5.3/§9.4 — grouped, never collapsed. The prior
  // Object.fromEntries(accounts.map(a => [a.platform, a])) kept only the
  // LAST row per platform, silently dropping a second identity (a founder
  // profile + a business page, or two X connections).
  const accountsByPlatform = PLATFORMS.reduce((acc, platform) => {
    acc[platform] = accounts.filter(a => a.platform === platform)
    return acc
  }, {} as Record<Platform, SocialAccountPublic[]>)

  const statuses = Object.fromEntries(
    PLATFORMS.map(p => {
      const active = accountsByPlatform[p].find(a => a.is_active) ?? null
      return [p, getConnectionStatus(active, p)]
    }),
  ) as Record<Platform, ConnectionStatus>

  const defaultAccountIds = Object.fromEntries(
    PLATFORMS.map(p => [p, pickDefaultAccountId(accountsByPlatform[p])]),
  ) as Record<Platform, string | null>

  const banner = resolveAccountsBanner(resolvedSearchParams, t)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <AccountsClient
        platforms={PLATFORMS}
        accounts={accountsByPlatform}
        statuses={statuses}
        defaultAccountIds={defaultAccountIds}
        locale={locale}
        banner={banner}
      />
    </div>
  )
}
