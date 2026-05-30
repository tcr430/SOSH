'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
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
import { PLATFORM_CONFIGS } from '@/lib/social'
import {
  pauseCampaignAction,
  resumeCampaignAction,
  deleteCampaignAction,
} from '@/app/[locale]/(dashboard)/campaigns/actions'
import type { CampaignRow, CampaignStatus } from '@/lib/db/types'

interface CampaignCardProps {
  campaign: CampaignRow
  locale: string
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  completed: 'bg-muted text-muted-foreground opacity-60',
}

const ACTION_ERROR_KEYS = new Set([
  'invalid_state',
  'delete_active_error',
  'not_found',
  'generic',
])

export function CampaignCard({ campaign, locale }: CampaignCardProps) {
  const t = useTranslations('campaigns.list')
  const tStatus = useTranslations('campaigns.status')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  function clearError() {
    setErrorKey(null)
  }

  function handlePause() {
    clearError()
    startTransition(async () => {
      const res = await pauseCampaignAction(campaign.id)
      if (res.success) router.refresh()
      else setErrorKey(ACTION_ERROR_KEYS.has(res.error ?? '') ? res.error! : 'generic')
    })
  }

  function handleResume() {
    clearError()
    startTransition(async () => {
      const res = await resumeCampaignAction(campaign.id)
      if (res.success) router.refresh()
      else setErrorKey(ACTION_ERROR_KEYS.has(res.error ?? '') ? res.error! : 'generic')
    })
  }

  function handleDeleteConfirm() {
    setDeleteOpen(false)
    clearError()
    startTransition(async () => {
      const res = await deleteCampaignAction(campaign.id)
      if (res.success) router.refresh()
      else setErrorKey(ACTION_ERROR_KEYS.has(res.error ?? '') ? res.error! : 'generic')
    })
  }

  const platformNames = campaign.platforms
    .map((p) => PLATFORM_CONFIGS[p]?.displayName ?? p)
    .join(', ')

  const createdDate = format(parseISO(campaign.created_at), 'PP')

  return (
    <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3">
      {/* Top row: name + status badge */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          {campaign.name}
        </h3>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
            STATUS_STYLES[campaign.status],
          )}
        >
          {tStatus(campaign.status)}
        </span>
      </div>

      {/* Objective */}
      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
        {campaign.objective}
      </p>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{platformNames}</span>
        <span>
          {t('card.posts', {
            published: campaign.total_posts_published,
            planned: campaign.total_posts_planned,
          })}
        </span>
        <span>{t('card.created', { date: createdDate })}</span>
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link
          href={`/${locale}/campaigns/${campaign.id}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t('card.view')}
        </Link>

        {campaign.status === 'active' && (
          <button
            type="button"
            disabled={isPending}
            onClick={handlePause}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {t('card.pause')}
          </button>
        )}

        {campaign.status === 'paused' && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleResume}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {t('card.resume')}
          </button>
        )}

        {(campaign.status === 'draft' || campaign.status === 'completed') && (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger
              disabled={isPending}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'text-destructive hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {t('card.delete')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('card.delete_confirm_title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('card.delete_confirm_body')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('card.delete_confirm_cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
                  {t('card.delete_confirm_confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Inline error */}
      {errorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(`card.${errorKey}`)}
        </p>
      )}
    </div>
  )
}
