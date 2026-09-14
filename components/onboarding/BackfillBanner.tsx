'use client'

// ADR 0025 §10.1 (Session 32 I2.14) — "a dismissible dashboard banner links
// back while a run awaits ratification." Dismissal is per-browser
// (localStorage), not persisted server-side — reappears in a new
// browser/session, which is acceptable for a "you left something behind"
// nudge and avoids a new column/table for a single boolean.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

export function BackfillBanner({ locale, runId }: { locale: string; runId: string }) {
  const t = useTranslations('onboarding.backfill')
  const storageKey = `backfill-banner-dismissed-${runId}`
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1')
    } catch {
      setDismissed(false)
    }
  }, [storageKey])

  if (dismissed) return null

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-muted/40 px-4 py-2 text-sm">
      <Link href={`/${locale}/onboarding/step-4`} className="underline underline-offset-4">
        {t('banner.link')}
      </Link>
      <button
        type="button"
        aria-label={t('banner.dismiss')}
        onClick={() => {
          try {
            localStorage.setItem(storageKey, '1')
          } catch {
            // best-effort only
          }
          setDismissed(true)
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
