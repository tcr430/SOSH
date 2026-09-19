// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    let out = key
    for (const [k, v] of Object.entries(values ?? {})) {
      out += ` ${k}=${v}`
    }
    return out
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/lib/members/useCan', () => ({ useCan: vi.fn(() => true) }))

// Mirrors house convention (e.g. connect.test.ts) — mocking the '@/lib/social'
// barrel avoids pulling in lib/config.ts's Zod env validation via
// oauth/state.ts.
vi.mock('@/lib/social', async () => {
  const { PLATFORM_CONFIGS, isPublishingPlatform } = await import('@/lib/social/platforms/config')
  const { getConnectionStatus } = await import('@/lib/social/connection-status')
  return {
    PLATFORM_CONFIGS,
    isPublishingPlatform,
    getConnectionStatus,
    buildDisconnectUrl: (platform: string, accountId?: string) =>
      accountId ? `/api/social/${platform}/disconnect?accountId=${accountId}` : `/api/social/${platform}/disconnect`,
  }
})

import { AccountsClient } from './AccountsClient'
import { getConnectionStatus } from '@/lib/social/connection-status'
import type { Platform, ConnectionStatus, SocialAccountPublic } from '@/lib/social'

const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

function makeAccount(overrides: Partial<SocialAccountPublic> = {}): SocialAccountPublic {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    platform: 'linkedin',
    platform_username: 'acme_corp',
    platform_display_name: 'Acme Corp',
    is_active: true,
    connected_at: '2026-01-01T00:00:00Z',
    token_expires_at: null,
    ...overrides,
  }
}

function emptyAccounts(): Record<Platform, SocialAccountPublic[]> {
  return Object.fromEntries(PLATFORMS.map(p => [p, [] as SocialAccountPublic[]])) as Record<
    Platform,
    SocialAccountPublic[]
  >
}

function statusesFor(accounts: Record<Platform, SocialAccountPublic[]>): Record<Platform, ConnectionStatus> {
  return Object.fromEntries(
    PLATFORMS.map(p => [p, getConnectionStatus(accounts[p].find(a => a.is_active) ?? null, p)]),
  ) as Record<Platform, ConnectionStatus>
}

function defaultsFor(accounts: Record<Platform, SocialAccountPublic[]>): Record<Platform, string | null> {
  return Object.fromEntries(
    PLATFORMS.map(p => {
      const active = accounts[p].filter(a => a.is_active)
      return [p, active.length === 1 ? active[0]!.id : null]
    }),
  ) as Record<Platform, string | null>
}

function render(accounts: Record<Platform, SocialAccountPublic[]>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(AccountsClient, {
        platforms: PLATFORMS,
        accounts,
        statuses: statusesFor(accounts),
        defaultAccountIds: defaultsFor(accounts),
        locale: 'en',
        banner: null,
      }),
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe('AccountsClient — ADR 0028 §9.4 dual identity', () => {
  it('single active LinkedIn identity: renders one row, marked Default, no "no default" note', () => {
    const accounts = emptyAccounts()
    accounts.linkedin = [makeAccount({ id: 'a1' })]
    const { container, cleanup } = render(accounts)

    expect(container.textContent).toContain('@acme_corp')
    expect(container.textContent).toContain('default_badge')
    expect(container.textContent).not.toContain('no_default')
    cleanup()
  })

  it('two active X identities: renders two rows, two disconnect controls, no default marked, and a "no default" note', () => {
    const accounts = emptyAccounts()
    accounts.twitter = [
      makeAccount({ id: 'a1', platform: 'twitter', platform_username: 'founder_x' }),
      makeAccount({ id: 'a2', platform: 'twitter', platform_username: 'biz_x' }),
    ]
    const { container, cleanup } = render(accounts)

    expect(container.textContent).toContain('@founder_x')
    expect(container.textContent).toContain('@biz_x')
    expect(container.textContent).not.toContain('default_badge')
    expect(container.textContent).toContain('no_default')

    const disconnectTriggers = Array.from(container.querySelectorAll('button')).filter(
      b => b.textContent === 'disconnect',
    )
    expect(disconnectTriggers).toHaveLength(2)
    cleanup()
  })

  it('renders "connect another" for LinkedIn/X but not for Meta platforms', () => {
    const accounts = emptyAccounts()
    accounts.linkedin = [makeAccount({ id: 'a1' })]
    const { container, cleanup } = render(accounts)

    expect(container.querySelector('a[href="/api/social/linkedin/connect?locale=en"]')).not.toBeNull()
    cleanup()
  })

  it('zero identities for a publishing platform: shows the plain Connect card, no "connect another"', () => {
    const accounts = emptyAccounts()
    const { container, cleanup } = render(accounts)

    const linkedinConnectLinks = Array.from(container.querySelectorAll('a')).filter(a =>
      a.getAttribute('href')?.startsWith('/api/social/linkedin/connect'),
    )
    expect(linkedinConnectLinks).toHaveLength(1)
    cleanup()
  })

  it('Meta platforms (instagram, facebook, threads): render coming_soon truthfully, offer no connect action', () => {
    const accounts = emptyAccounts()
    const { container, cleanup } = render(accounts)

    for (const platform of ['instagram', 'facebook', 'threads']) {
      const link = container.querySelector(`a[href^="/api/social/${platform}/connect"]`)
      expect(link).toBeNull()
    }
    const tooltips = container.querySelectorAll('button[title="connect_coming_soon_tooltip"]')
    expect(tooltips).toHaveLength(3)
    cleanup()
  })
})
