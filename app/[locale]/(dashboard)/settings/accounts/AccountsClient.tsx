'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PlatformConnectionCard } from '@/components/social/PlatformConnectionCard'
import { PLATFORM_CONFIGS } from '@/lib/social'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'

interface Banner {
  type: 'success' | 'error'
  message: string
}

interface AccountsClientProps {
  platforms: readonly Platform[]
  accounts: Partial<Record<Platform, SocialAccountPublic>>
  statuses: Record<Platform, ConnectionStatus>
  locale: string
  banner: Banner | null
}

export function AccountsClient({
  platforms,
  accounts,
  statuses,
  locale,
  banner: initialBanner,
}: AccountsClientProps) {
  const router = useRouter()
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
        {platforms.map(platform => (
          <PlatformConnectionCard
            key={platform}
            platform={platform}
            config={PLATFORM_CONFIGS[platform]}
            account={accounts[platform] ?? null}
            status={statuses[platform]}
            locale={locale}
            onDisconnect={() => router.refresh()}
            variant="settings"
          />
        ))}
      </div>
    </div>
  )
}
