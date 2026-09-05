'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PlatformConnectionCard } from '@/components/social/PlatformConnectionCard'
import { PLATFORM_CONFIGS, getConnectionStatus, isPublishingPlatform } from '@/lib/social'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'

interface Banner {
  type: 'success' | 'error'
  message: string
}

interface AccountsClientProps {
  platforms: readonly Platform[]
  accounts: Record<Platform, SocialAccountPublic[]>
  statuses: Record<Platform, ConnectionStatus>
  defaultAccountIds: Record<Platform, string | null>
  locale: string
  banner: Banner | null
}

export function AccountsClient({
  platforms,
  accounts,
  statuses,
  defaultAccountIds,
  locale,
  banner: initialBanner,
}: AccountsClientProps) {
  const router = useRouter()
  const t = useTranslations('settings.accounts')
  const [banner, setBanner] = useState<Banner | null>(initialBanner)

  // Remove search params from URL after banner is shown to prevent re-display on refresh
  useEffect(() => {
    if (initialBanner) {
      router.replace(`/${locale}/settings/accounts`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-5">
      {banner && (
        <div
          role="alert"
          className={cn(
            'flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
          )}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {platforms.map(platform => {
          const platformAccounts = accounts[platform]
          const activeAccounts = platformAccounts.filter(a => a.is_active)
          const config = PLATFORM_CONFIGS[platform]
          const supportsMultipleIdentities = isPublishingPlatform(platform)
          const defaultAccountId = defaultAccountIds[platform]
          const hasNoDefault = supportsMultipleIdentities && activeAccounts.length > 1

          if (activeAccounts.length === 0) {
            return (
              <PlatformConnectionCard
                key={platform}
                platform={platform}
                config={config}
                account={null}
                status={statuses[platform]}
                locale={locale}
                onDisconnect={() => router.refresh()}
                variant="settings"
              />
            )
          }

          return (
            <div key={platform} className="space-y-2">
              {activeAccounts.map(account => (
                <PlatformConnectionCard
                  key={account.id}
                  platform={platform}
                  config={config}
                  account={account}
                  status={getConnectionStatus(account, platform)}
                  locale={locale}
                  onDisconnect={() => router.refresh()}
                  variant="settings"
                  accountId={account.id}
                  isDefault={account.id === defaultAccountId}
                />
              ))}

              {hasNoDefault && (
                <p className="text-xs text-muted-foreground px-1">{t('no_default')}</p>
              )}

              {supportsMultipleIdentities && (
                <a
                  href={`/api/social/${platform}/connect?locale=${locale}`}
                  className="inline-block text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 px-1"
                >
                  {t('connect_another', { platform: config.displayName })}
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
