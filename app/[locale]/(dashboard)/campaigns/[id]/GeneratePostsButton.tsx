'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { startGenerationAction, getGenerationSessionAction } from './generate-action'

const POLL_INTERVAL_MS = 2000

type UiPhase =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'generating'; postsCreated: number; postsPlanned: number }
  | { phase: 'complete'; postsCreated: number }
  | { phase: 'failed'; errorCode: string | null }
  | { phase: 'timeout_ui' }

const ERROR_CODES = new Set([
  'quota_exceeded',
  'rate_limited',
  'provider_error',
  'invalid_response',
  'timeout',
  'invalid_campaign_state',
  'already_generated',
])

function toErrorKey(errorCode: string | null): string {
  if (errorCode && ERROR_CODES.has(errorCode)) return `error.${errorCode}`
  return 'error.generic'
}

interface GeneratePostsButtonProps {
  campaignId: string
  locale: string
  pollMaxSeconds: number
}

export function GeneratePostsButton({ campaignId, locale, pollMaxSeconds }: GeneratePostsButtonProps) {
  const MAX_POLLS = pollMaxSeconds / (POLL_INTERVAL_MS / 1000)
  const t = useTranslations('campaigns.detail.generate')
  const router = useRouter()
  const [uiPhase, setUiPhase] = useState<UiPhase>({ phase: 'idle' })
  const [sessionId, setSessionId] = useState<string | null>(null)
  const pollCountRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearPoll() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    if (!sessionId) return
    pollCountRef.current = 0

    intervalRef.current = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current > MAX_POLLS) {
        clearPoll()
        setUiPhase({ phase: 'timeout_ui' })
        return
      }

      const result = await getGenerationSessionAction(sessionId)
      if ('error' in result) return

      if (result.status === 'generating') {
        setUiPhase({ phase: 'generating', postsCreated: result.postsCreated, postsPlanned: result.postsPlanned })
      } else if (result.status === 'complete') {
        clearPoll()
        setUiPhase({ phase: 'complete', postsCreated: result.postsCreated })
        setTimeout(() => {
          router.push(`/${locale}/campaigns/${campaignId}/posts`)
        }, 1500)
      } else if (result.status === 'failed') {
        clearPoll()
        setUiPhase({ phase: 'failed', errorCode: result.errorCode })
      }
    }, POLL_INTERVAL_MS)

    return clearPoll
  }, [sessionId, campaignId, locale, router])

  async function handleGenerate() {
    setUiPhase({ phase: 'pending' })
    const result = await startGenerationAction(campaignId)
    if ('error' in result) {
      setUiPhase({ phase: 'failed', errorCode: result.error })
      return
    }
    setSessionId(result.sessionId)
  }

  function handleRetry() {
    clearPoll()
    setUiPhase({ phase: 'idle' })
    setSessionId(null)
    pollCountRef.current = 0
  }

  if (uiPhase.phase === 'idle') {
    return (
      <button
        type="button"
        onClick={handleGenerate}
        className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}
      >
        {t('cta')}
      </button>
    )
  }

  if (uiPhase.phase === 'pending') {
    return (
      <p className="text-sm text-muted-foreground animate-pulse" role="status">
        {t('starting')}
      </p>
    )
  }

  if (uiPhase.phase === 'generating') {
    return (
      <p className="text-sm text-muted-foreground animate-pulse" role="status">
        {t('in_progress', { created: uiPhase.postsCreated, planned: uiPhase.postsPlanned })}
      </p>
    )
  }

  if (uiPhase.phase === 'complete') {
    return (
      <p className="text-sm text-green-700 dark:text-green-400" role="status">
        {t('success', { count: uiPhase.postsCreated })}
      </p>
    )
  }

  if (uiPhase.phase === 'timeout_ui') {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t('timeout')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-destructive" role="alert">
        {t(toErrorKey(uiPhase.errorCode))}
      </p>
      <button
        type="button"
        onClick={handleRetry}
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-fit')}
      >
        {t('try_again')}
      </button>
    </div>
  )
}
