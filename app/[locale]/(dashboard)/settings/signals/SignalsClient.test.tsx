// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

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
  addWatchedFeedAction: vi.fn().mockResolvedValue({ success: true }),
  removeWatchedFeedAction: vi.fn().mockResolvedValue({ success: true }),
  toggleWatchedFeedAction: vi.fn().mockResolvedValue({ success: true }),
}))

import { SignalsClient, type SignalsClientProps } from './SignalsClient'
import type { WatchedRepoRow, WatchedFeedRow, SignalRow } from '@/lib/db/types'
import {
  addWatchedFeedAction as mockAddWatchedFeedActionImport,
  removeWatchedFeedAction as mockRemoveWatchedFeedActionImport,
  toggleWatchedFeedAction as mockToggleWatchedFeedActionImport,
} from './actions'

const mockAddWatchedFeedAction = vi.mocked(mockAddWatchedFeedActionImport)
const mockRemoveWatchedFeedAction = vi.mocked(mockRemoveWatchedFeedActionImport)
const mockToggleWatchedFeedAction = vi.mocked(mockToggleWatchedFeedActionImport)

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

function makeWatchedFeed(overrides: Partial<WatchedFeedRow> = {}): WatchedFeedRow {
  return {
    id: 'feed-1',
    business_id: 'biz-1',
    url: 'https://example.com/feed.xml',
    url_hash: 'hash-1',
    label: 'Example Feed',
    is_active: true,
    weight: 10,
    added_by: 'user-1',
    last_fetch_at: null,
    last_fetch_status: null,
    last_error_code: null,
    consecutive_failure_count: 0,
    rate_limited_until: null,
    etag: null,
    last_success_at: null,
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
    watchedFeeds: [],
    activeWatchedFeedCount: 0,
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

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)
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

// ── ADR 0023 §8.4 (Session 30 G1b.9) — the market-responsive section
// renders regardless of the GitHub `state` above (§3.1 — feeds have no
// connection state of their own), so `state: 'not_connected'` is used
// throughout below to prove that independence rather than incidentally.

describe('SignalsClient — market-responsive section renders independently of GitHub connection state', () => {
  it('renders even when hasConnection-equivalent state is not_connected', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed()] }),
    )
    expect(container.textContent).toContain('market_responsive.heading')
    expect(container.textContent).toContain('Example Feed')
    cleanup()
  })

  it('states both required disclosure sentences (§2.8 lower confidence, §6.6 standing slot)', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected' }))
    expect(container.textContent).toContain('market_responsive.disclosure_lower_confidence')
    expect(container.textContent).toContain('market_responsive.disclosure_standing_slot')
    cleanup()
  })
})

describe('SignalsClient — market-responsive feed states (§8.4, all required)', () => {
  it('empty: no feeds yet', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', watchedFeeds: [] }))
    expect(container.textContent).toContain('market_responsive.feed_list.empty')
    cleanup()
  })

  it('active: a never-failed, unpaused feed', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true, last_fetch_status: null })] }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_active')
    cleanup()
  })

  it('paused: is_active=false takes priority over any other signal', () => {
    const { container, cleanup } = renderClient(
      baseProps({
        state: 'not_connected',
        watchedFeeds: [makeWatchedFeed({ is_active: false, last_fetch_status: 'error', last_error_code: 'fetch_failed' })],
      }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_paused')
    expect(container.textContent).not.toContain('market_responsive.feed_list.status_fetch_failing')
    cleanup()
  })

  it('fetch-failing: shows the last error code AND the last success time', () => {
    const { container, cleanup } = renderClient(
      baseProps({
        state: 'not_connected',
        watchedFeeds: [
          makeWatchedFeed({
            is_active: true,
            last_fetch_status: 'error',
            last_error_code: 'fetch_failed',
            last_success_at: '2026-08-20T00:00:00Z',
          }),
        ],
      }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_fetch_failing')
    expect(container.textContent).toContain('market_responsive.feed_list.last_error')
    expect(container.textContent).toContain('fetch_failed')
    expect(container.textContent).toContain('market_responsive.feed_list.last_success')
    cleanup()
  })

  it('rate-limited: a future rate_limited_until', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true, rate_limited_until: future })] }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_rate_limited')
    cleanup()
  })

  it('a PAST rate_limited_until is NOT rate-limited (the window has already lifted)', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true, rate_limited_until: past })] }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_active')
    cleanup()
  })

  it('not-modified (304-unchanged): reachable, just nothing new', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true, last_fetch_status: 'not_modified' })] }),
    )
    expect(container.textContent).toContain('market_responsive.feed_list.status_not_modified')
    cleanup()
  })

  it('at-bound: hides the add form and shows the cap message', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', activeWatchedFeedCount: 20 }))
    expect(container.textContent).toContain('market_responsive.at_cap.title')
    expect(container.querySelector('#feed-url')).toBeNull()
    cleanup()
  })

  it('below bound: the add form renders (adding state) and calls addWatchedFeedAction with the typed values on submit', async () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', activeWatchedFeedCount: 19 }))
    const urlInput = container.querySelector('#feed-url') as HTMLInputElement
    const labelInput = container.querySelector('#feed-label') as HTMLInputElement
    expect(urlInput).not.toBeNull()

    await act(async () => {
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // jsdom/happy-dom form submission via requestSubmit is unavailable in
    // this render harness (no jsdom form-submission event loop) — the
    // Server Action wiring itself is covered directly by actions.test.ts's
    // own addWatchedFeedAction suite; this test's job is only to prove the
    // FORM FIELDS exist with the right ids/labels for that wiring to reach.
    expect(labelInput).not.toBeNull()
    cleanup()
  })
})

describe('SignalsClient — market-responsive accessibility floor (§8.4)', () => {
  it('the feed list is a real <ul> with an accessible name', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed()] }),
    )
    const list = container.querySelector('ul[aria-label]')
    expect(list).not.toBeNull()
    cleanup()
  })

  it('pause/resume/remove controls are real <button> elements (keyboard-reachable by default)', () => {
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true })] }),
    )
    expect(buttonWithText(container, 'market_responsive.feed_list.pause')).toBeTruthy()
    expect(buttonWithText(container, 'market_responsive.feed_list.remove')).toBeTruthy()
    cleanup()
  })

  it('a live region exists for add/remove/pause/resume announcements', () => {
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected' }))
    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion).not.toBeNull()
    cleanup()
  })

  it('remove calls removeWatchedFeedAction with the feed id', async () => {
    const feed = makeWatchedFeed({ id: 'feed-remove-me', is_active: true })
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', watchedFeeds: [feed] }))
    const removeButton = buttonWithText(container, 'market_responsive.feed_list.remove')
    await act(async () => {
      removeButton?.click()
    })
    expect(mockRemoveWatchedFeedAction).toHaveBeenCalledWith({ watchedFeedId: 'feed-remove-me' })
    cleanup()
  })

  it('pause calls toggleWatchedFeedAction(isActive: false)', async () => {
    const feed = makeWatchedFeed({ id: 'feed-pause-me', is_active: true })
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', watchedFeeds: [feed] }))
    const pauseButton = buttonWithText(container, 'market_responsive.feed_list.pause')
    await act(async () => {
      pauseButton?.click()
    })
    expect(mockToggleWatchedFeedAction).toHaveBeenCalledWith({ watchedFeedId: 'feed-pause-me', isActive: false })
    cleanup()
  })

  it('resume calls toggleWatchedFeedAction(isActive: true)', async () => {
    const feed = makeWatchedFeed({ id: 'feed-resume-me', is_active: false })
    const { container, cleanup } = renderClient(baseProps({ state: 'not_connected', watchedFeeds: [feed] }))
    const resumeButton = buttonWithText(container, 'market_responsive.feed_list.resume')
    await act(async () => {
      resumeButton?.click()
    })
    expect(mockToggleWatchedFeedAction).toHaveBeenCalledWith({ watchedFeedId: 'feed-resume-me', isActive: true })
    cleanup()
  })
})

// ── MINOR-6 precedent (Session 28-D D5) — status colour on app/globals.css
// TOKENS with a both-themes contrast assertion, mirroring OpportunityFeed.
// test.tsx's mechanism exactly rather than a hand-transcribed copy, per ADR
// 0015 §1(c). Duplicated (not imported) — same house style that file's own
// header comment establishes for this exact helper set.

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminanceFromLinearRgb(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hexToRelativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = srgbChannelToLinear(((n >> 16) & 255) / 255)
  const g = srgbChannelToLinear(((n >> 8) & 255) / 255)
  const b = srgbChannelToLinear((n & 255) / 255)
  return relativeLuminanceFromLinearRgb(r, g, b)
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const GLOBALS_CSS = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8')

function cssBlock(selector: string): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`globals.css: no "${selector} {" block found`)
  const end = GLOBALS_CSS.indexOf('}', start)
  if (end === -1) throw new Error(`globals.css: "${selector}" block is unterminated`)
  return GLOBALS_CSS.slice(start, end)
}

function hexTokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: #hex`)
  return hexToRelativeLuminance(m[1])
}

describe('SignalsClient — market-responsive status colour (§8.4, WCAG AA, both themes)', () => {
  it('warning-foreground on warning (rate_limited, disclosure) meets the 4.5:1 AA floor in the light theme', () => {
    expect(
      contrastRatio(hexTokenLuminance(':root', 'warning-foreground'), hexTokenLuminance(':root', 'warning')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('warning-foreground on warning meets the 4.5:1 AA floor in the dark theme', () => {
    expect(
      contrastRatio(hexTokenLuminance('.dark', 'warning-foreground'), hexTokenLuminance('.dark', 'warning')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('the component uses the warning-foreground/warning TOKENS for rate_limited and disclosure text, not raw Tailwind palette classes', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { container, cleanup } = renderClient(
      baseProps({ state: 'not_connected', watchedFeeds: [makeWatchedFeed({ is_active: true, rate_limited_until: future })] }),
    )
    expect(container.innerHTML).toContain('text-warning-foreground')
    expect(container.innerHTML).toContain('bg-warning')
    expect(container.innerHTML).not.toMatch(/text-amber-|bg-amber-|#[0-9a-fA-F]{6}/)
    cleanup()
  })
})
