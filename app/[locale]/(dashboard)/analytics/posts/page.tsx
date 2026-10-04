import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { formatISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listCampaigns } from '@/lib/db/campaigns'
import { listByBusiness } from '@/lib/db/social-accounts'
import { loadPosts } from '@/lib/analytics/load'
import { monthLabel } from '@/lib/analytics/format'
import { FILTER_PLATFORMS, currentPeriod, monthOptions, parsePostFilters } from '@/lib/analytics/search-params'
import { PostsFilters, PostsTable } from '@/components/analytics/PostsView'
import type { T } from '@/components/analytics/shared'

// ADR 0031 §4.1, §10.1 — the post level. Filters (month, platform, account, campaign) are GET search params, Zod-validated
// in parsePostFilters; the business is the server-side active business, never a param.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AnalyticsPostsPage({ params, searchParams }: Props) {
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
  const filters = parsePostFilters(raw, current)
  const [model, accounts, campaigns] = await Promise.all([
    loadPosts(client, business.id, filters),
    listByBusiness(client, business.id),
    listCampaigns(client, business.id),
  ])

  const periods = monthOptions(current)
  if (!periods.includes(filters.period)) periods.unshift(filters.period)

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.posts.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('analytics.posts.description')}</p>
        <Link href={'/' + locale + '/analytics?month=' + filters.period} className="text-sm font-medium underline underline-offset-2">
          {t('analytics.backLink')}
        </Link>
      </header>
      <PostsFilters
        t={t}
        action={'/' + locale + '/analytics/posts'}
        state={filters}
        months={periods.map((p) => ({ value: p, label: monthLabel(p, locale) }))}
        platforms={FILTER_PLATFORMS.map((p) => ({ value: p, label: t('analytics.platform.' + p) }))}
        accounts={accounts.map((a) => ({ value: a.id, label: a.platform_display_name ?? a.platform_username }))}
        campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))}
      />
      <PostsTable t={t} locale={locale} timezone={business.timezone} model={model} />
    </div>
  )
}
