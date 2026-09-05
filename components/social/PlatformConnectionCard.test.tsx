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

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/lib/members/useCan', () => ({ useCan: vi.fn(() => true) }))

// Mirrors house convention (e.g. connect.test.ts) — mocking the '@/lib/social'
// barrel avoids pulling in lib/config.ts's Zod env validation via
// oauth/state.ts. Only buildDisconnectUrl's real logic is under test here
// (disconnect-url.test.ts covers it); this mock just needs the same shape.
vi.mock('@/lib/social', () => ({
  buildDisconnectUrl: (platform: string, accountId?: string) =>
    accountId ? `/api/social/${platform}/disconnect?accountId=${accountId}` : `/api/social/${platform}/disconnect`,
}))

import { PlatformConnectionCard, type PlatformConnectionCardProps } from './PlatformConnectionCard'
import type { SocialAccountPublic } from '@/lib/db/social-accounts'
import { PLATFORM_CONFIGS } from '@/lib/social/platforms/config'

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

function renderCard(props: Partial<PlatformConnectionCardProps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const merged: PlatformConnectionCardProps = {
    platform: 'linkedin',
    config: PLATFORM_CONFIGS.linkedin,
    account: null,
    status: 'disconnected',
    locale: 'en',
    onDisconnect: () => {},
    variant: 'settings',
    ...props,
  }
  act(() => {
    root.render(React.createElement(PlatformConnectionCard, merged))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe('PlatformConnectionCard — ADR 0028 §9.4 states', () => {
  it('disconnected: shows a Connect link and no username', () => {
    const { container, cleanup } = renderCard({ status: 'disconnected', account: null })
    expect(container.querySelector('a[href^="/api/social/linkedin/connect"]')).not.toBeNull()
    expect(container.textContent).not.toContain('@acme_corp')
    cleanup()
  })

  it('connected: shows the username and a Disconnect trigger, no Default badge by default', () => {
    const account = makeAccount()
    const { container, cleanup } = renderCard({ status: 'connected', account })
    expect(container.textContent).toContain('@acme_corp')
    expect(container.textContent).toContain('disconnect')
    expect(container.textContent).not.toContain('default_badge')
    cleanup()
  })

  it('connected + isDefault: renders the Default badge', () => {
    const account = makeAccount()
    const { container, cleanup } = renderCard({ status: 'connected', account, isDefault: true })
    expect(container.textContent).toContain('default_badge')
    cleanup()
  })

  it('expiring_soon: states the exact expiry date, not just a day count', () => {
    const account = makeAccount({ token_expires_at: '2026-11-03T00:00:00Z' })
    const { container, cleanup } = renderCard({ status: 'expiring_soon', account })
    expect(container.textContent).toContain('reconnect_by')
    expect(container.textContent).toContain('date=3 Nov 2026')
    expect(container.textContent).toContain('platform=LinkedIn')
    cleanup()
  })

  it('coming_soon: Connect button is disabled and its tooltip names Meta review, truthfully', () => {
    const { container, cleanup } = renderCard({
      platform: 'instagram',
      config: PLATFORM_CONFIGS.instagram,
      status: 'coming_soon',
      account: null,
    })
    const button = container.querySelector('button[disabled]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('title')).toBe('connect_coming_soon_tooltip')
    cleanup()
  })

  it('connected_coming_soon: shows the truthful Meta-review badge, no disconnect needed to see it', () => {
    const account = makeAccount({ platform: 'instagram' })
    const { container, cleanup } = renderCard({
      platform: 'instagram',
      config: PLATFORM_CONFIGS.instagram,
      status: 'connected_coming_soon',
      account,
    })
    expect(container.textContent).toContain('publishing_soon')
    cleanup()
  })
})
