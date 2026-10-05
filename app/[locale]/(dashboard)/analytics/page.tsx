import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { formatISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { loadPortfolio } from '@/lib/analytics/load'
import { monthLabel } from '@/lib/analytics/format'
import { currentPeriod, monthOptions, parsePeriod } from '@/lib/analytics/search-params'
import { PortfolioView } from '@/components/analytics/PortfolioView'
import { MonthPicker, type T } from '@/components/analytics/shared'

// ADR 0031 §4.1, §10.1 — the portfolio. The business is the SERVER-SIDE active business (never a param); the month is a
// Zod-validated search param that falls back to the current month in the business timezone. The picker is a GET form.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const raw = await searchParams
  const translate = await getTranslations()
  const t: T = (key, values) => translate(key as never, values as never)

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect('/' + locale + '/login')
  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect('/' + locale + '/onboarding')

  const current = currentPeriod(formatISO(new Date()), business.timezone)
  const month = parsePeriod(raw, current)
  const portfolio = await loadPortfolio(client, business.id, month)

  const periods = monthOptions(current)
  if (!periods.includes(month)) periods.unshift(month)

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('analytics.description')}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Link href={'/' + locale + '/analytics/posts?month=' + month} className="text-sm font-medium underline underline-offset-2">
            {t('analytics.postsLink')}
          </Link>
          <Link href={'/' + locale + '/analytics/reports'} className="text-sm font-medium underline underline-offset-2">
            {t('analytics.report.listLink')}
          </Link>
        </div>
      </header>
      <MonthPicker
        t={t}
        action={'/' + locale + '/analytics'}
        value={month}
        options={periods.map((p) => ({ value: p, label: monthLabel(p, locale) }))}
      />
      <PortfolioView t={t} locale={locale} timezone={business.timezone} portfolio={portfolio} />
    </div>
  )
}
