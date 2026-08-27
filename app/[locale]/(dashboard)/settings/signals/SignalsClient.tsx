'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { formatISO, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import type { WatchedRepoRow, WatchedFeedRow, SignalRow } from '@/lib/db/types'
import type { GithubRepoSummary } from '@/lib/signals'
import {
  connectGithubAction,
  disconnectGithubAction,
  addWatchedRepoAction,
  removeWatchedRepoAction,
  toggleWatchedRepoAction,
  listInstallationRepositoriesAction,
  addWatchedFeedAction,
  removeWatchedFeedAction,
  toggleWatchedFeedAction,
  type ActionState,
} from './actions'

// ADR 0020 §3.2 — mirrors actions.ts's own MAX_ACTIVE_WATCHED_REPOS. The cap
// is surfaced HERE, before the picker ever attempts a 21st add — not as an
// error toast after a rejected submission.
const MAX_ACTIVE_WATCHED_REPOS = 20

// ADR 0023 §8.4 (Session 30 G1b.9) — mirrors actions.ts's own
// MAX_ACTIVE_WATCHED_FEEDS, same reason: surfaced here before the add-feed
// form ever attempts a 21st add. Same disclaimer as its repo precedent — a
// UX/cost guardrail, NOT a security boundary.
const MAX_ACTIVE_WATCHED_FEEDS = 20

// The universal GitHub deep link (§2.5, [sec-HIGH-3]): a per-installation
// URL differs for personal vs organization installs, and account_type isn't
// stored on github_connections. This link resolves correctly for both —
// GitHub lists every installation the signed-in user can administer here.
const GITHUB_INSTALLATIONS_URL = 'https://github.com/settings/installations'

export type SignalsPageState = 'not_connected' | 'awaiting_approval' | 'reconnect_required' | 'connected'

export interface SignalsClientProps {
  state: SignalsPageState
  isRateLimited: boolean
  watchedRepos: WatchedRepoRow[]
  activeWatchedCount: number
  watchedFeeds: WatchedFeedRow[]
  activeWatchedFeedCount: number
  recentSignals: SignalRow[]
  locale: string
  banner: { type: 'success' | 'error'; message: string } | null
}

const initialActionState: ActionState = {}

export function SignalsClient({
  state,
  isRateLimited,
  watchedRepos,
  activeWatchedCount,
  watchedFeeds,
  activeWatchedFeedCount,
  recentSignals,
  banner,
}: SignalsClientProps) {
  const t = useTranslations('signals')
  const router = useRouter()

  return (
    <div className="space-y-6">
      {banner && (
        <div
          role="alert"
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
          )}
        >
          {banner.message}
        </div>
      )}

      {state === 'not_connected' && <NotConnectedPanel t={t} />}
      {state === 'awaiting_approval' && <AwaitingApprovalPanel t={t} />}
      {state === 'reconnect_required' && <ReconnectRequiredPanel t={t} />}
      {state === 'connected' && (
        <ConnectedPanel
          t={t}
          isRateLimited={isRateLimited}
          watchedRepos={watchedRepos}
          activeWatchedCount={activeWatchedCount}
          recentSignals={recentSignals}
          onChanged={() => router.refresh()}
        />
      )}

      {/* ADR 0023 §3.1/§8.4 (Session 30 G1b.9) — market-responsive feeds have
          NO connection state of their own (no OAuth install flow, no
          credential boundary), so this section renders regardless of the
          GitHub `state` switch above — a business can watch feeds with zero
          GitHub connection at all. */}
      <MarketResponsiveSection
        t={t}
        watchedFeeds={watchedFeeds}
        activeWatchedFeedCount={activeWatchedFeedCount}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

type Translate = ReturnType<typeof useTranslations>

// connectGithubAction redirects on success (throwing NEXT_REDIRECT) and only
// ever RETURNS a value on the forbidden branch — a plain `<form action>`
// requires (formData) => void | Promise<void>, so the ActionState return is
// discarded here; the redirect is what actually navigates.
async function submitConnect(): Promise<void> {
  await connectGithubAction()
}

function NotConnectedPanel({ t }: { t: Translate }) {
  return (
    <div className="space-y-4 rounded-lg border p-6">
      <p className="text-sm text-foreground">{t('not_connected.what_we_read')}</p>
      <p className="text-sm font-medium text-foreground">{t('not_connected.what_we_never_do')}</p>
      <form action={submitConnect}>
        <Button type="submit">{t('not_connected.connect_cta')}</Button>
      </form>
    </div>
  )
}

function AwaitingApprovalPanel({ t }: { t: Translate }) {
  return (
    <div className="space-y-2 rounded-lg border p-6" role="status">
      <h2 className="text-sm font-semibold">{t('awaiting_approval.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('awaiting_approval.body')}</p>
    </div>
  )
}

function ReconnectRequiredPanel({ t }: { t: Translate }) {
  return (
    <div className="space-y-4 rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{t('reconnect_required.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('reconnect_required.body')}</p>
      <form action={submitConnect}>
        <Button type="submit">{t('reconnect_required.cta')}</Button>
      </form>
    </div>
  )
}

function ConnectedPanel({
  t,
  isRateLimited,
  watchedRepos,
  activeWatchedCount,
  recentSignals,
  onChanged,
}: {
  t: Translate
  isRateLimited: boolean
  watchedRepos: WatchedRepoRow[]
  activeWatchedCount: number
  recentSignals: SignalRow[]
  onChanged: () => void
}) {
  return (
    <div className="space-y-6">
      {isRateLimited && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t('rate_limited.banner')}
        </div>
      )}

      <WatchListSection t={t} watchedRepos={watchedRepos} onChanged={onChanged} />
      <PickerSection t={t} activeWatchedCount={activeWatchedCount} onChanged={onChanged} />
      <RecentSignalsSection t={t} recentSignals={recentSignals} />
      <DisconnectSection t={t} onChanged={onChanged} />
    </div>
  )
}

function WatchListSection({
  t,
  watchedRepos,
  onChanged,
}: {
  t: Translate
  watchedRepos: WatchedRepoRow[]
  onChanged: () => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{t('watch_list.heading')}</h2>
      {watchedRepos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('watch_list.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {watchedRepos.map((repo) => (
            <WatchedRepoRowItem key={repo.id} t={t} repo={repo} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  )
}

function WatchedRepoRowItem({
  t,
  repo,
  onChanged,
}: {
  t: Translate
  repo: WatchedRepoRow
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      await removeWatchedRepoAction({ watchedRepoId: repo.id })
      onChanged()
    })
  }

  function toggle(isActive: boolean) {
    startTransition(async () => {
      await toggleWatchedRepoAction({ watchedRepoId: repo.id, isActive })
      onChanged()
    })
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <div>
        <span className="font-medium">
          {repo.owner}/{repo.name}
        </span>
        {!repo.is_active && (
          <p className="mt-1 text-xs text-muted-foreground">{t('repo_unavailable.badge')}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {repo.is_active ? (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggle(false)}>
            {t('watch_list.pause')}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggle(true)}>
            {t('watch_list.resume')}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={remove}>
          {t('watch_list.remove')}
        </Button>
      </div>
    </li>
  )
}

function PickerSection({
  t,
  activeWatchedCount,
  onChanged,
}: {
  t: Translate
  activeWatchedCount: number
  onChanged: () => void
}) {
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const atCap = activeWatchedCount >= MAX_ACTIVE_WATCHED_REPOS

  function loadRepos() {
    startTransition(async () => {
      const result = await listInstallationRepositoriesAction()
      if (result.success) {
        setRepos(result.repos)
        setError(null)
      } else {
        setError(result.error)
      }
    })
  }

  function addRepo(repo: GithubRepoSummary) {
    startTransition(async () => {
      await addWatchedRepoAction({ repoId: repo.id, owner: repo.owner.login, name: repo.name })
      setRepos(null)
      onChanged()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{t('picker.heading')}</h2>

      {atCap ? (
        <div role="status" className="space-y-1">
          <p className="text-sm font-medium">{t('at_cap.title')}</p>
          <p className="text-sm text-muted-foreground">{t('at_cap.body')}</p>
        </div>
      ) : (
        <>
          {repos === null && (
            <Button type="button" variant="outline" disabled={isPending} onClick={loadRepos}>
              {t('picker.heading')}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(error as Parameters<typeof t>[0])}
            </p>
          )}
          {repos !== null && repos.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('picker.empty')}</p>
          )}
          {repos !== null && repos.length > 0 && (
            <ul className="space-y-2">
              {repos.map((repo) => (
                <li key={repo.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {repo.owner.login}/{repo.name}
                  </span>
                  <Button type="button" size="sm" disabled={isPending} onClick={() => addRepo(repo)}>
                    {t('picker.add_cta')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function RecentSignalsSection({ t, recentSignals }: { t: Translate; recentSignals: SignalRow[] }) {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{t('recent_signals.heading')}</h2>
      {recentSignals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('recent_signals.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {recentSignals.map((signal) => (
            <li key={signal.id} className="space-y-1 text-sm">
              <p className="font-medium">{signal.title}</p>
              <p className="text-muted-foreground">{signal.body}</p>
              {signal.html_url && (
                <a
                  href={signal.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {t('recent_signals.view_link')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DisconnectSection({ t, onChanged }: { t: Translate; onChanged: () => void }) {
  const [state, action, isPending] = useActionState(async (): Promise<ActionState> => {
    const result = await disconnectGithubAction()
    if (result.success) onChanged()
    return result
  }, initialActionState)

  return (
    <div className="space-y-3 rounded-lg border p-6">
      <h2 className="text-sm font-semibold">{t('disconnect.confirm_title')}</h2>
      <p className="text-sm text-muted-foreground">{t('disconnect.confirm_body_stops_ingestion')}</p>
      <p className="text-sm font-medium text-foreground">{t('disconnect.confirm_body_full_revocation')}</p>

      <div className="flex items-center gap-3">
        <a
          href={GITHUB_INSTALLATIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t('disconnect.deep_link_cta')}
        </a>
        <form action={action}>
          <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
            {t('disconnect.cta')}
          </Button>
        </form>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(state.error as Parameters<typeof t>[0])}
        </p>
      )}
    </div>
  )
}

// ── ADR 0023 §8.4 (Session 30 G1b.9) — market-responsive (RSS/Atom) feeds ──

type FeedStatus = 'paused' | 'rate_limited' | 'fetch_failing' | 'not_modified' | 'active'

// §8.4's required state list, per row (a feed has no page-level connection
// state — each row carries its own): paused (is_active=false) takes priority
// over everything else (a paused feed's stale error/rate-limit state is not
// "the problem" right now, being paused is), then rate_limited, then
// fetch_failing, then not_modified (304-unchanged — reachable, just nothing
// new), else active.
function feedStatus(feed: WatchedFeedRow, now: Date): FeedStatus {
  if (!feed.is_active) return 'paused'
  if (feed.rate_limited_until && parseISO(feed.rate_limited_until) > now) return 'rate_limited'
  if (feed.last_fetch_status === 'error') return 'fetch_failing'
  if (feed.last_fetch_status === 'not_modified') return 'not_modified'
  return 'active'
}

function MarketResponsiveSection({
  t,
  watchedFeeds,
  activeWatchedFeedCount,
  onChanged,
}: {
  t: Translate
  watchedFeeds: WatchedFeedRow[]
  activeWatchedFeedCount: number
  onChanged: () => void
}) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const atCap = activeWatchedFeedCount >= MAX_ACTIVE_WATCHED_FEEDS

  function announce(key: Parameters<typeof t>[0]) {
    setStatusMessage(t(key))
  }

  return (
    <div className="space-y-4 rounded-lg border p-6">
      <div>
        <h2 className="text-sm font-semibold">{t('market_responsive.heading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('market_responsive.subtitle')}</p>
      </div>

      {/* §8.4 disclosure, both sentences — required, not optional copy. The
          human approval gate (ADR 0021) is only meaningful if the human is
          told what they are looking at. */}
      <div className="space-y-1 rounded-md border border-warning-border bg-warning px-3 py-2">
        <p className="text-xs font-medium text-warning-foreground">{t('market_responsive.disclosure_lower_confidence')}</p>
        <p className="text-xs font-medium text-warning-foreground">{t('market_responsive.disclosure_standing_slot')}</p>
      </div>

      <FeedListSection t={t} watchedFeeds={watchedFeeds} onChanged={onChanged} announce={announce} />
      <AddFeedForm t={t} atCap={atCap} onChanged={onChanged} announce={announce} />

      {/* Live region — status changes announced (§8.4 accessibility floor) */}
      <div aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
    </div>
  )
}

function FeedListSection({
  t,
  watchedFeeds,
  onChanged,
  announce,
}: {
  t: Translate
  watchedFeeds: WatchedFeedRow[]
  onChanged: () => void
  announce: (key: Parameters<Translate>[0]) => void
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('market_responsive.feed_list.heading')}</h3>
      {watchedFeeds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('market_responsive.feed_list.empty')}</p>
      ) : (
        <ul aria-label={t('market_responsive.feed_list.heading')} className="space-y-2">
          {watchedFeeds.map((feed) => (
            <WatchedFeedRowItem key={feed.id} t={t} feed={feed} onChanged={onChanged} announce={announce} />
          ))}
        </ul>
      )}
    </div>
  )
}

function WatchedFeedRowItem({
  t,
  feed,
  onChanged,
  announce,
}: {
  t: Translate
  feed: WatchedFeedRow
  onChanged: () => void
  announce: (key: Parameters<Translate>[0]) => void
}) {
  const [isPending, startTransition] = useTransition()
  const status = feedStatus(feed, new Date())

  function remove() {
    startTransition(async () => {
      const result = await removeWatchedFeedAction({ watchedFeedId: feed.id })
      if (result.success) announce('market_responsive.feed_list.announce_removed')
      onChanged()
    })
  }

  function toggle(isActive: boolean) {
    startTransition(async () => {
      const result = await toggleWatchedFeedAction({ watchedFeedId: feed.id, isActive })
      if (result.success) {
        announce(isActive ? 'market_responsive.feed_list.announce_resumed' : 'market_responsive.feed_list.announce_paused')
      }
      onChanged()
    })
  }

  // §8.4 accessibility floor — status conveyed by TEXT (the label below),
  // never by colour alone; the colour is a reinforcing signal, not the only
  // one. Every status label is source-agnostic i18n copy, not a raw string.
  const statusLabelKey = {
    active: 'market_responsive.feed_list.status_active',
    paused: 'market_responsive.feed_list.status_paused',
    rate_limited: 'market_responsive.feed_list.status_rate_limited',
    fetch_failing: 'market_responsive.feed_list.status_fetch_failing',
    not_modified: 'market_responsive.feed_list.status_not_modified',
  } as const satisfies Record<FeedStatus, Parameters<Translate>[0]>

  const statusClassName = {
    active: 'text-success-foreground',
    paused: 'text-muted-foreground',
    rate_limited: 'text-warning-foreground',
    fetch_failing: 'text-destructive',
    not_modified: 'text-muted-foreground',
  } as const satisfies Record<FeedStatus, string>

  return (
    <li className="space-y-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-medium">{feed.label}</span>
          <p className="text-xs text-muted-foreground">{feed.url}</p>
        </div>
        <div className="flex items-center gap-2">
          {feed.is_active ? (
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggle(false)}>
              {t('market_responsive.feed_list.pause')}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggle(true)}>
              {t('market_responsive.feed_list.resume')}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={remove}>
            {t('market_responsive.feed_list.remove')}
          </Button>
        </div>
      </div>

      <p className={cn('text-xs font-medium', statusClassName[status])}>{t(statusLabelKey[status])}</p>

      {status === 'fetch_failing' && (
        <p className="text-xs text-muted-foreground">
          {feed.last_error_code && t('market_responsive.feed_list.last_error', { code: feed.last_error_code })}
          {feed.last_success_at && (
            <>
              {' — '}
              {t('market_responsive.feed_list.last_success', { date: formatISO(parseISO(feed.last_success_at)) })}
            </>
          )}
        </p>
      )}
    </li>
  )
}

function AddFeedForm({
  t,
  atCap,
  onChanged,
  announce,
}: {
  t: Translate
  atCap: boolean
  onChanged: () => void
  announce: (key: Parameters<Translate>[0]) => void
}) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [state, action, isPending] = useActionState(async (): Promise<ActionState> => {
    const result = await addWatchedFeedAction({ url, label })
    if (result.success) {
      setUrl('')
      setLabel('')
      announce('market_responsive.feed_list.announce_added')
      onChanged()
    }
    return result
  }, initialActionState)

  if (atCap) {
    return (
      <div role="status" className="space-y-1 rounded-md border px-3 py-2">
        <p className="text-sm font-medium">{t('market_responsive.at_cap.title')}</p>
        <p className="text-sm text-muted-foreground">{t('market_responsive.at_cap.body')}</p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-md border px-3 py-3">
      <h3 className="text-sm font-medium">{t('market_responsive.add.heading')}</h3>

      <div className="space-y-1">
        <label htmlFor="feed-url" className="text-xs font-medium text-muted-foreground">
          {t('market_responsive.add.url_label')}
        </label>
        <input
          id="feed-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('market_responsive.add.url_placeholder')}
          aria-describedby={state.error ? 'feed-url-error' : undefined}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="feed-label" className="text-xs font-medium text-muted-foreground">
          {t('market_responsive.add.label_label')}
        </label>
        <input
          id="feed-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('market_responsive.add.label_placeholder')}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? t('market_responsive.add.adding') : t('market_responsive.add.submit_cta')}
      </Button>

      {state.error && (
        <p id="feed-url-error" role="alert" className="text-sm text-destructive">
          {t(state.error as Parameters<typeof t>[0])}
        </p>
      )}
    </form>
  )
}
