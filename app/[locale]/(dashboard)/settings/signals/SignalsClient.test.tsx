// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))

vi.mock('./actions', () => ({
  connectGithubAction: vi.fn(),
  disconnectGithubAction: vi.fn(),
  addWatchedRepoAction: vi.fn(),
  removeWatchedRepoAction: vi.fn(),
  toggleWatchedRepoAction: vi.fn(),
  listInstallationRepositoriesAction: vi.fn(),
}))

import { SignalsClient, type SignalsClientProps } from './SignalsClient'
import type { WatchedRepoRow, SignalRow } from '@/lib/db/types'

function makeWatchedRepo(overrides: Partial<WatchedRepoRow> = {}): WatchedRepoRow {
  return {
    id: 'wr-1',
    business_id: 'biz-1',
    connection_id: 'conn-1',
    repo_id: 1,
    owner: 'acme',
    name: 'widgets',
    is_active: true,
    releases_etag: null,
    last_polled_at: null,
    weight: 1,
    added_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSignal(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'sig-1',
    business_id: 'biz-1',
    watched_repo_id: 'wr-1',
    source: 'github',
    kind: 'release',
    external_id: 'ext-1',
    title: 'v1.0.0' as SignalRow['title'],
    body: 'Release body text' as SignalRow['body'],
    body_truncated: false,
    html_url: 'https://github.com/acme/widgets/releases/tag/v1.0.0',
    occurred_at: '2026-01-01T00:00:00Z',
    is_prerelease: false,
    author_is_bot: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as SignalRow
}

function baseProps(overrides: Partial<SignalsClientProps> = {}): SignalsClientProps {
  return {
    state: 'not_connected',
    isRateLimited: false,
    watchedRepos: [],
    activeWatchedCount: 0,
    recentSignals: [],
    locale: 'en',
    banner: null,
    ...overrides,
  }
}

function renderClient(props: SignalsClientProps) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(SignalsClient, props))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe('SignalsClient — the four honest states', () => {
  it('not_connected: states what SOSH reads and what it NEVER does, with a connect form', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected' }))
    expect(container.textContent).toContain('not_connected.what_we_read')
    expect(container.textContent).toContain('not_connected.what_we_never_do')
    expect(container.querySelector('form')).not.toBeNull()
    cleanup()
  })

  it('awaiting_approval: distinct copy, no watch-list/picker rendered', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'awaiting_approval' }))
    expect(container.textContent).toContain('awaiting_approval.title')
    expect(container.textContent).toContain('awaiting_approval.body')
    expect(container.textContent).not.toContain('picker.heading')
    cleanup()
  })

  it('reconnect_required: distinct copy naming GitHub-side revocation, with a reconnect CTA', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'reconnect_required' }))
    expect(container.textContent).toContain('reconnect_required.title')
    expect(container.textContent).toContain('reconnect_required.body')
    expect(container.textContent).toContain('reconnect_required.cta')
    cleanup()
  })

  it('connected: renders the watch list and repo picker heading', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'connected', watchedRepos: [makeWatchedRepo()], activeWatchedCount: 1 }),
    )
    expect(container.textContent).toContain('watch_list.heading')
    expect(container.textContent).toContain('picker.heading')
    cleanup()
  })

  it('connected + repo_unavailable: a deactivated watched repo shows the honest badge, never the word "error"', () => {
    const { container, cleanup } = renderClient(
      baseProps({
        state: 'connected',
        watchedRepos: [makeWatchedRepo({ is_active: false })],
        activeWatchedCount: 0,
      }),
    )
    expect(container.textContent).toContain('repo_unavailable.badge')
    expect(container.textContent?.toLowerCase()).not.toContain('error:')
    cleanup()
  })

  it('connected + rate limited: the rate-limited banner renders alongside the connected view', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'connected', isRateLimited: true }))
    expect(container.textContent).toContain('rate_limited.banner')
    expect(container.textContent).toContain('watch_list.heading')
    cleanup()
  })
})

describe('SignalsClient — the 20-repo cap surfaced before rejection', () => {
  it('renders the at-cap state when activeWatchedCount is exactly 20', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'connected', activeWatchedCount: 20 }))
    expect(container.textContent).toContain('at_cap.title')
    expect(container.textContent).toContain('at_cap.body')
    cleanup()
  })

  it('does not render the at-cap state below 20', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'connected', activeWatchedCount: 19 }))
    expect(container.textContent).not.toContain('at_cap.title')
    cleanup()
  })
})

describe('SignalsClient — recent signals rendering (§5.4, zero dangerouslySetInnerHTML)', () => {
  it('renders a truncated body always alongside its html_url link', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'connected', recentSignals: [makeSignal({ body_truncated: true })] }),
    )
    const link = container.querySelector('a[href="https://github.com/acme/widgets/releases/tag/v1.0.0"]')
    expect(link).not.toBeNull()
    expect(container.textContent).toContain('Release body text')
    cleanup()
  })
})

describe('SignalsClient — disconnect copy tells the truth (§2.5, sec-HIGH-3)', () => {
  it('renders the "uninstall on GitHub" instruction and a deep link, not just a disconnect button', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'connected' }))
    expect(container.textContent).toContain('disconnect.confirm_body_stops_ingestion')
    expect(container.textContent).toContain('disconnect.confirm_body_full_revocation')
    const deepLink = container.querySelector('a[href="https://github.com/settings/installations"]')
    expect(deepLink).not.toBeNull()
    cleanup()
  })
})
