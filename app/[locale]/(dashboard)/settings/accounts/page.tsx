import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listByBusiness } from '@/lib/db/social-accounts'
import { PLATFORM_CONFIGS, getConnectionStatus } from '@/lib/social'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'
import { AccountsClient } from './AccountsClient'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

const ERROR_KEYS = [
  'invalid_state',
  'forbidden',
  'oauth_denied',
  'exchange_failed',
  'vault_write_failed',
  'db_write_failed',
  'provider_unavailable',
  'connect_failed',
] as const
type ErrorKey = (typeof ERROR_KEYS)[number]

function isErrorKey(k: string): k is ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k)
}

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ connected?: string; error?: string; platform?: string }>
}

export default async function AccountsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { connected, error, platform: errorPlatform } = await searchParams

  const t = await getTranslations('settings.accounts')

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const accounts = await listByBusiness(client, business.id)

  const accountsByPlatform = Object.fromEntries(
    accounts.map(a => [a.platform, a]),
  ) as Partial<Record<Platform, SocialAccountPublic>>

  const statuses = Object.fromEntries(
    PLATFORMS.map(p => [p, getConnectionStatus(accountsByPlatform[p] ?? null, p)]),
  ) as Record<Platform, ConnectionStatus>

  let banner: { type: 'success' | 'error'; message: string } | null = null
  if (connected) {
    const config = PLATFORM_CONFIGS[connected as Platform]
    if (config) {
      banner = {
        type: 'success',
        message: t('success.connected', { platform: config.displayName }),
      }
    }
  } else if (error) {
    const platformName =
      PLATFORM_CONFIGS[errorPlatform as Platform]?.displayName ?? errorPlatform ?? ''
    const message = isErrorKey(error)
      ? t(`error.${error}`, { platform: platformName })
      : t('error.exchange_failed')
    banner = { type: 'error', message }
  }

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
        locale={locale}
        banner={banner}
      />
    </div>
  )
}
