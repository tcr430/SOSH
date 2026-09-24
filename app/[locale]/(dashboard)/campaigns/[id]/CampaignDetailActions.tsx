'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { formatDistanceToNowStrict } from 'date-fns'
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
import {
  pauseCampaignAction,
  resumeCampaignAction,
  deleteCampaignAction,
} from '@/app/[locale]/(dashboard)/campaigns/actions'
import { GeneratePostsButton } from './GeneratePostsButton'
import { PrepareBriefButton } from './PrepareBriefButton'
import { generateStage } from '@/lib/campaigns/generate-stage'
import { useCan } from '@/lib/members/useCan'
import { CAPABILITIES } from '@/lib/members/capabilities'
import type { CampaignBriefRow, CampaignRow } from '@/lib/db/types'

interface CampaignDetailActionsProps {
  campaign: CampaignRow
  // The persisted brief status (null when there is no brief or the campaign is not awaiting one). generateStage decides
  // what the customer is offered from this and campaign.status: see lib/campaigns/generate-stage.ts.
  briefStatus: CampaignBriefRow['status'] | null
  locale: string
  pollMaxSeconds: number
  nextScheduledAt: string | null
  failedCount: number
}

export function CampaignDetailActions({ campaign, briefStatus, locale, pollMaxSeconds, nextScheduledAt, failedCount }: CampaignDetailActionsProps) {
  const t = useTranslations('campaigns.detail')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dangerOpen, setDangerOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // ADR 0014 §6 — capability-gate echo (UX only, DB is the boundary — L-3).
  const canAuthor = useCan(CAPABILITIES.AUTHOR)

  function handleResume() {
    setActionError(null)
    startTransition(async () => {
      const res = await resumeCampaignAction(campaign.id)
      if (res.success) {
        router.refresh()
      } else {
        const key = res.error === 'invalid_state' ? 'danger.error_invalid_state' : 'danger.error_generic'
        setActionError(t(key))
      }
    })
  }

  function handlePause() {
    setActionError(null)
    startTransition(async () => {
      const res = await pauseCampaignAction(campaign.id)
      if (res.success) {
        router.refresh()
      } else {
        const key = res.error === 'invalid_state' ? 'danger.error_invalid_state' : 'danger.error_generic'
        setActionError(t(key))
      }
    })
  }

  function handleDeleteConfirm() {
    setDeleteDialogOpen(false)
    setActionError(null)
    startTransition(async () => {
      const res = await deleteCampaignAction(campaign.id)
      if (res.success) {
        router.push(`/${locale}/campaigns`)
      } else {
        const key = res.error === 'delete_active_error' ? 'danger.error_invalid_state' : 'danger.error_generic'
        setActionError(t(key))
      }
    })
  }

  const stage = generateStage(campaign.status, briefStatus)

  return (
    <div className="space-y-4">
      {/* Prepare brief (draft, Stage A failed) / Review brief / Generate posts (approved brief) / Posts summary */}
      {stage === 'prepare_brief' && canAuthor ? (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-base font-semibold mb-1.5">{t('prepare_brief.title')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t('prepare_brief.body')}</p>
          <PrepareBriefButton campaignId={campaign.id} locale={locale} />
        </section>
      ) : stage === 'review_brief' ? (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-base font-semibold mb-1.5">{t('review_brief.title')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t('review_brief.body')}</p>
          <Link
            href={`/${locale}/campaigns/${campaign.id}/brief`}
            className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}
          >
            {t('review_brief.cta')}
          </Link>
        </section>
      ) : stage === 'generate' && canAuthor ? (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-base font-semibold mb-1.5">{t('generate.title')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {t('generate.body', { count: campaign.total_posts_planned })}
          </p>
          <div className="flex flex-col gap-3">
            <GeneratePostsButton campaignId={campaign.id} locale={locale} pollMaxSeconds={pollMaxSeconds} />
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {t('posts.published', {
                  published: campaign.total_posts_published,
                  total: campaign.total_posts_planned,
                })}
              </p>
              {nextScheduledAt && (
                <p className="text-xs text-muted-foreground">
                  {t('nextPost', { in: formatDistanceToNowStrict(new Date(nextScheduledAt)) })}
                </p>
              )}
            </div>
            <Link
              href={`/${locale}/campaigns/${campaign.id}/posts`}
              className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
            >
              {t('posts.view_cta')}
            </Link>
          </div>

          {failedCount > 0 && (
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-3">
              <p className="text-xs text-amber-400">
                {failedCount === 1
                  ? t('failedBanner', { count: failedCount })
                  : t('failedBanner_plural', { count: failedCount })}
              </p>
              <Link
                href={`/${locale}/campaigns/${campaign.id}/posts?filter=failed`}
                className="text-xs text-amber-400 underline underline-offset-2 hover:text-amber-300 shrink-0"
              >
                {t('openFailed')}
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Danger zone — author capability only (ADR 0014 §6) */}
      {canAuthor && (
      <section className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setDangerOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={dangerOpen}
        >
          <span>{t('danger.title')}</span>
          <span className="text-xs" aria-hidden="true">
            {dangerOpen ? '▲' : '▼'}
          </span>
        </button>

        {dangerOpen && (
          <div className="px-5 pb-5 flex flex-wrap gap-3 border-t border-border pt-4">
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
                {t('danger.pause')}
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
                {t('danger.resume')}
              </button>
            )}

            {(campaign.status === 'draft' || campaign.status === 'completed') && (
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogTrigger
                  disabled={isPending}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'text-destructive hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {t('danger.delete')}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('danger.delete_confirm_title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('danger.delete_confirm_body')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('danger.confirm_cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
                      {t('danger.confirm_delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}

        {actionError && (
          <p role="alert" className="px-5 pb-4 text-sm text-destructive">
            {actionError}
          </p>
        )}
      </section>
      )}
    </div>
  )
}
