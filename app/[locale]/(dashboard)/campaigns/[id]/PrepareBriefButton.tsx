'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { prepareBriefAction } from './prepare-brief-action'

// K2.12 — retry the brief pipeline for a campaign left 'draft' (Stage A failed at submit). On success the customer lands
// on brief review, exactly where createCampaignAction sends them when it succeeds first time.

const ERROR_KEYS = new Set(['forbidden', 'failed'])

interface PrepareBriefButtonProps {
  campaignId: string
  locale: string
}

export function PrepareBriefButton({ campaignId, locale }: PrepareBriefButtonProps) {
  const t = useTranslations('campaigns.detail.prepare_brief')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await prepareBriefAction(campaignId)
      if ('error' in result) {
        setError(ERROR_KEYS.has(result.error) ? result.error : 'generic')
        return
      }
      router.push(`/${locale}/campaigns/${campaignId}/brief`)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {pending ? (
        <p className="text-sm text-muted-foreground animate-pulse" role="status">
          {t('starting')}
        </p>
      ) : (
        <button type="button" onClick={handleClick} className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}>
          {error ? t('try_again') : t('cta')}
        </button>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`error.${error}`)}
        </p>
      )}
    </div>
  )
}
