'use client'

import { useState, useTransition } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import type { WatchedRepoRow, SignalRow } from '@/lib/db/types'
import type { GithubRepoSummary } from '@/lib/signals'
import {
  connectGithubAction,
  disconnectGithubAction,
  addWatchedRepoAction,
  removeWatchedRepoAction,
  toggleWatchedRepoAction,
  listInstallationRepositoriesAction,
  type ActionState,
} from './actions'

// ADR 0020 §3.2 — mirrors actions.ts's own MAX_ACTIVE_WATCHED_REPOS. The cap
// is surfaced HERE, before the picker ever attempts a 21st add — not as an
// error toast after a rejected submission.
const MAX_ACTIVE_WATCHED_REPOS = 20

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
