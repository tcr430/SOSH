'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { PlatformConnectionCard } from '@/components/social/PlatformConnectionCard'
import { SkipButton } from '@/components/onboarding/SkipButton'
import { PLATFORM_CONFIGS, getConnectionStatus } from '@/lib/social'
import { skipOnboardingAction } from '../actions'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'

const POLL_INTERVAL_MS = 3_000
const MAX_POLL_MS = 60_000

interface Step3ClientProps {
  platforms: readonly Platform[]
  initialAccounts: Partial<Record<Platform, SocialAccountPublic>>
  locale: string
  connectedParam: Platform | null
}

export function Step3Client({
  platforms,
  initialAccounts,
  locale,
  connectedParam,
}: Step3ClientProps) {
  const t = useTranslations('onboarding.step3')
  const tOnboarding = useTranslations('onboarding')
  const router = useRouter()
  const [accounts, setAccounts] = useState(initialAccounts)
  const [showSkipWarning, setShowSkipWarning] = useState(false)
  const [successPlatform] = useState<Platform | null>(connectedParam)

  const statuses = useMemo(
    () =>
      Object.fromEntries(
        platforms.map(p => [p, getConnectionStatus(accounts[p] ?? null, p)]),
      ) as Record<Platform, ConnectionStatus>,
    [accounts, platforms],
  )

  const hasConnected = useMemo(
    () => Object.values(accounts).some(a => a?.is_active),
    [accounts],
  )

  const fetchAccounts = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/social/accounts')
      if (!res.ok) return false
      const fetched = (await res.json()) as SocialAccountPublic[]
      setAccounts(
        Object.fromEntries(fetched.map(a => [a.platform, a])) as Partial<
          Record<Platform, SocialAccountPublic>
        >,
      )
      return fetched.some(a => a.is_active)
    } catch {
      return false
    }
  }, [])

  // Poll for newly connected accounts until one is active or 60s elapses
  useEffect(() => {
    const initiallyConnected = Object.values(initialAccounts).some(a => a?.is_active)
    if (initiallyConnected) return

    const startTime = Date.now()
    const interval = setInterval(async () => {
      if (Date.now() - startTime >= MAX_POLL_MS) {
        clearInterval(interval)
        return
      }
      const nowConnected = await fetchAccounts()
      if (nowConnected) clearInterval(interval)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [fetchAccounts, initialAccounts])

  // Clean URL after showing connected param banner
  useEffect(() => {
    if (connectedParam) {
      router.replace(`/${locale}/onboarding/step-3`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-5">
      {successPlatform && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300"
        >
          {t('connected_success', { platform: PLATFORM_CONFIGS[successPlatform].displayName })}
        </div>
      )}

      <div className="space-y-2">
        {platforms.map(platform => (
          <PlatformConnectionCard
            key={platform}
            platform={platform}
            config={PLATFORM_CONFIGS[platform]}
            account={accounts[platform] ?? null}
            status={statuses[platform]}
            locale={locale}
            onDisconnect={fetchAccounts}
            variant="onboarding"
          />
        ))}
      </div>

      {showSkipWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm text-amber-800 dark:text-amber-300">{t('skip_warning')}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSkipWarning(false)}
              className="text-sm text-amber-700 hover:text-amber-900 dark:text-amber-400 underline underline-offset-4"
            >
              {tOnboarding('back')}
            </button>
            <form action={skipOnboardingAction}>
              <input type="hidden" name="locale" value={locale} />
              <SkipButton label={t('skip_confirm')} />
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => setShowSkipWarning(s => !s)}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t('skip')}
        </button>

        <div className="flex gap-3">
          <Link
            href={`/${locale}/onboarding/step-2`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {tOnboarding('back')}
          </Link>
          <button
            type="button"
            disabled={!hasConnected}
            onClick={() => router.push(`/${locale}/onboarding/step-4`)}
            className={cn(
              buttonVariants({ size: 'sm' }),
              !hasConnected && 'opacity-50 cursor-not-allowed',
            )}
          >
            {t('continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
