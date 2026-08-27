import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isAfter, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getGithubConnectionByBusinessId } from '@/lib/db/github-connections'
import { listWatchedReposForBusiness } from '@/lib/db/watched-repos'
import { listWatchedFeedsForBusiness } from '@/lib/db/watched-feeds'
import { listRecentSignalsForBusiness } from '@/lib/db/signals'
import { SignalsClient, type SignalsPageState } from './SignalsClient'

const ERROR_KEYS = [
  'invalid_request',
  'invalid_state',
  'forbidden',
  'exchange_failed',
  'not_your_installation',
  'already_connected',
] as const
type ErrorKey = (typeof ERROR_KEYS)[number]

function isErrorKey(k: string): k is ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k)
}

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ connected?: string; error?: string; awaiting_approval?: string }>
}

export default async function SignalsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { connected, error, awaiting_approval: awaitingApprovalParam } = await searchParams

  const t = await getTranslations('signals')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const [connection, watchedRepos, watchedFeeds, recentSignals] = await Promise.all([
    getGithubConnectionByBusinessId(client, business.id),
    listWatchedReposForBusiness(client, business.id),
    listWatchedFeedsForBusiness(client, business.id),
    listRecentSignalsForBusiness(client, business.id, 10),
  ])

  const activeWatchedCount = watchedRepos.filter((r) => r.is_active).length
  const activeWatchedFeedCount = watchedFeeds.filter((f) => f.is_active).length

  let state: SignalsPageState
  if (awaitingApprovalParam === '1') {
    state = 'awaiting_approval'
  } else if (connection?.is_active) {
    state = 'connected'
  } else if (connection && !connection.is_active && connection.last_poll_status === 'revoked') {
    state = 'reconnect_required'
  } else {
    state = 'not_connected'
  }

  const isRateLimited = Boolean(
    connection?.rate_limited_until && isAfter(parseISO(connection.rate_limited_until), new Date()),
  )

  let banner: { type: 'success' | 'error'; message: string } | null = null
  if (connected === 'github') {
    banner = { type: 'success', message: t('success.connected') }
  } else if (error) {
    const message = isErrorKey(error) ? t(`errors.${error}`) : t('errors.generic')
    banner = { type: 'error', message }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <SignalsClient
        state={state}
        isRateLimited={isRateLimited}
        watchedRepos={watchedRepos}
        activeWatchedCount={activeWatchedCount}
        watchedFeeds={watchedFeeds}
        activeWatchedFeedCount={activeWatchedFeedCount}
        recentSignals={recentSignals}
        locale={locale}
        banner={banner}
      />
    </div>
  )
}
