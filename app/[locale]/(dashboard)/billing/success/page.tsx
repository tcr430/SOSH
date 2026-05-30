'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

type PollState = 'polling' | 'resolved' | 'timedOut'

const MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS = 1500

export default function BillingSuccessPage() {
  const t = useTranslations('billing')
  const router = useRouter()
  const params = useParams()
  const locale = params.locale as string

  const [state, setState] = useState<PollState>('polling')
  const [planName, setPlanName] = useState<string>('')
  const [attempts, setAttempts] = useState(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/session-status')
      if (!res.ok) return false
      const data = await res.json() as { plan: string; planUpdated: boolean }
      if (data.planUpdated) {
        setPlanName(data.plan.charAt(0).toUpperCase() + data.plan.slice(1))
        setState('resolved')
        return true
      }
    } catch {
      // network error — keep polling
    }
    return false
  }, [])

  useEffect(() => {
    if (state !== 'polling') return

    const run = async () => {
      const done = await poll()
      if (done) return

      setAttempts((prev) => {
        const next = prev + 1
        if (next >= MAX_ATTEMPTS) {
          setState('timedOut')
        }
        return next
      })
    }

    const id = setTimeout(run, attempts === 0 ? 500 : POLL_INTERVAL_MS)
    return () => clearTimeout(id)
  }, [state, attempts, poll])

  useEffect(() => {
    if (state !== 'resolved') return
    const id = setTimeout(() => router.push(`/${locale}/campaigns`), 2000)
    return () => clearTimeout(id)
  }, [state, router, locale])

  function retry() {
    setAttempts(0)
    setState('polling')
  }

  if (state === 'timedOut') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-6">
        <div className="max-w-sm space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('success.timeout')}
          </p>
          <button
            type="button"
            onClick={retry}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {t('success.check_again')}
          </button>
        </div>
      </div>
    )
  }

  if (state === 'resolved') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
        <p className="text-lg font-semibold tracking-tight">
          {t('success.activated', { plan: planName })}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t('success.activating')}</p>
    </div>
  )
}
