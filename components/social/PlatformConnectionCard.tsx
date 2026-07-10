'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { differenceInCalendarDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PlatformIcon } from '@/components/social/PlatformIcon'
import { useCan } from '@/lib/members/useCan'
import { CAPABILITIES } from '@/lib/members/capabilities'
import type { Platform } from '@/lib/db/types'
import type { PlatformOAuthConfig } from '@/lib/social'
import type { ConnectionStatus } from '@/lib/social'
import type { SocialAccountPublic } from '@/lib/db/social-accounts'

export interface PlatformConnectionCardProps {
  platform: Platform
  config: PlatformOAuthConfig
  account: SocialAccountPublic | null
  status: ConnectionStatus
  locale: string
  onDisconnect: () => void
  variant: 'settings' | 'onboarding'
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: 'bg-green-500',
  connected_coming_soon: 'bg-green-500',
  expiring_soon: 'bg-amber-500',
  disconnected: 'bg-zinc-300 dark:bg-zinc-600',
  coming_soon: 'bg-violet-400',
}

export function PlatformConnectionCard({
  platform,
  config,
  account,
  status,
  locale,
  onDisconnect,
  variant,
}: PlatformConnectionCardProps) {
  const t = useTranslations('settings.accounts')
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  // ADR 0014 §6 — capability-gate echo (UX only, DB is the boundary — the
  // authoritative check is the app-layer user_can gate in the connect/
  // disconnect route handlers themselves, ADR 0014 §7).
  const canConnect = useCan(CAPABILITIES.CONNECT_ACCOUNTS)

  const isActuallyConnected = account !== null && account.is_active

  const daysUntilExpiry =
    status === 'expiring_soon' && account?.token_expires_at
      ? differenceInCalendarDays(new Date(account.token_expires_at), new Date())
      : null

  async function handleDisconnect() {
    setIsDisconnecting(true)
    setDisconnectError(null)
    try {
      const res = await fetch(`/api/social/${platform}/disconnect`, { method: 'DELETE' })
      if (!res.ok) throw new Error('disconnect_failed')
      onDisconnect()
    } catch {
      setDisconnectError(t('disconnect_error'))
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border border-border',
        variant === 'settings' ? 'bg-card shadow-xs p-4' : 'p-3',
      )}
    >
      {/* Platform identity */}
      <div className="flex items-center gap-3 min-w-0">
        <PlatformIcon platform={platform} className="h-8 w-8 shrink-0" />

        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium leading-none">{config.displayName}</span>
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT[status])} />
              <span className="text-xs text-muted-foreground">{t(`status.${status}`)}</span>
            </div>
          </div>

          {isActuallyConnected && (
            <p className="text-xs text-muted-foreground truncate">
              @{account.platform_username}
            </p>
          )}

          {status === 'expiring_soon' && daysUntilExpiry !== null && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
              {t('reconnect', { days: daysUntilExpiry })}
            </p>
          )}

          {(status === 'coming_soon' || status === 'connected_coming_soon') && (
            <span className="inline-flex items-center rounded-md bg-violet-50 dark:bg-violet-950/50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-700/20">
              {t('publishing_soon')}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {!canConnect ? null : isActuallyConnected ? (
          <AlertDialog>
            <AlertDialogTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? '…' : t('disconnect')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('confirm_disconnect_title', { platform: config.displayName })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('confirm_disconnect_body')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('confirm_disconnect_cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDisconnect}>
                  {t('confirm_disconnect_confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : status === 'coming_soon' ? (
          <button
            disabled
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'opacity-50 cursor-not-allowed')}
            title={t('connect_coming_soon_tooltip')}
          >
            {t('connect')}
          </button>
        ) : (
          <Link
            href={`/api/social/${platform}/connect?locale=${locale}`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {t('connect')}
          </Link>
        )}

        {disconnectError && (
          <p className="text-xs text-destructive">{disconnectError}</p>
        )}
      </div>
    </div>
  )
}
