import { getTranslations } from 'next-intl/server'

// ADR 0031 §8.2, §10.2 — the loading state: a skeleton with an accessible "Loading results" label. No motion under
// prefers-reduced-motion.
export default async function AnalyticsLoading() {
  const t = await getTranslations('analytics.state')
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <span className="sr-only">{t('loading')}</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="h-32 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="h-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    </div>
  )
}
