'use client'

import { useTranslations } from 'next-intl'

// ADR 0031 §8.2, §10.6 — the route-segment error boundary behind the ERROR state. Next.js requires it to be a Client
// Component. It renders the §8.2 error copy and a "Reload" control that calls reset(), and it receives NO data: the
// error object is deliberately not read (its message could carry anything).
export default function AnalyticsError({ reset }: { error?: unknown; reset: () => void }) {
  const t = useTranslations('analytics.state')
  return (
    <div role="alert" className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6">
      <p className="text-sm text-foreground">{t('error')}</p>
      <button type="button" onClick={() => reset()} className="min-h-8 rounded-md border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
        {t('reload')}
      </button>
    </div>
  )
}
