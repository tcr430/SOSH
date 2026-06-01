'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.locale_error')
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'en'
  const [eventId, setEventId] = useState<string | undefined>()

  useEffect(() => {
    const id = Sentry.captureException(error)
    setEventId(id)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground [text-wrap:balance]">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[44ch]">
            {t('body')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-85 transition-opacity duration-150 motion-reduce:transition-none"
          >
            {t('retry')}
          </button>
          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium text-foreground border border-border rounded-md hover:bg-secondary transition-colors duration-150 motion-reduce:transition-none"
          >
            {t('home')}
          </Link>
        </div>
        {eventId && (
          <p className="text-[0.6875rem] text-muted-foreground/50 font-mono tabular-nums">
            {t('reference')}: {eventId}
          </p>
        )}
      </div>
    </div>
  )
}
