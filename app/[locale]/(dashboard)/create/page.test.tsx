// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => {
    const table: Record<string, string> = {
      heading: 'How do you want to create this post?',
      subheading: 'Pick the workflow that fits what you\'re starting with.',
      'mode1.title': 'Studio',
      'mode1.description': 'Paste a draft.',
      'mode2.title': 'Objective-driven',
      'mode2.description': 'Tell us your goal.',
      'mode3.title': 'Signal-driven',
      'mode3.description': 'Turn a trending topic into a post.',
      'mode3.unavailableLabel': 'Signal-driven creation is not available yet — coming soon',
      'mode3.badge': 'Coming soon',
    }
    return table[key] ?? key
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import CreatePickerPage from './page'

const BUSINESS = { id: 'biz-1' }

function mockAuthed() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
}

async function renderPage() {
  const element = await CreatePickerPage({ params: Promise.resolve({ locale: 'en' }) })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthed()
})

describe('CreatePickerPage — renders all three options (ADR 0019 §3.2)', () => {
  it('renders a link to /en/studio for Mode 1', async () => {
    const { container, cleanup } = await renderPage()
    const link = container.querySelector('a[href="/en/studio"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Studio')
    cleanup()
  })

  it('renders a PLAIN link to /en/campaigns/new for Mode 2', async () => {
    const { container, cleanup } = await renderPage()
    const link = container.querySelector('a[href="/en/campaigns/new"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Objective-driven')
    // Not a shared component with special markup — a bare anchor.
    expect(link?.tagName).toBe('A')
    cleanup()
  })

  it('STUDIO-MODE3-NOT-ROUTABLE: Mode 3 renders a disabled <button>, not a <Link>, with NO href anywhere in its markup', async () => {
    const { container, cleanup } = await renderPage()
    const buttons = Array.from(container.querySelectorAll('button'))
    const mode3Button = buttons.find((b) => b.textContent?.includes('Signal-driven'))
    expect(mode3Button).toBeDefined()
    expect(mode3Button?.disabled).toBe(true)
    expect(mode3Button?.hasAttribute('href')).toBe(false)
    // No anchor anywhere renders the Mode 3 title either.
    const anchors = Array.from(container.querySelectorAll('a'))
    expect(anchors.some((a) => a.textContent?.includes('Signal-driven'))).toBe(false)
    cleanup()
  })

  it('Mode 3\'s accessible name STATES THE REASON, not merely "disabled"', async () => {
    const { container, cleanup } = await renderPage()
    const buttons = Array.from(container.querySelectorAll('button'))
    const mode3Button = buttons.find((b) => b.textContent?.includes('Signal-driven'))
    const accessibleName = mode3Button?.getAttribute('aria-label')
    expect(accessibleName).toBeTruthy()
    expect(accessibleName?.toLowerCase()).not.toBe('disabled')
    expect(accessibleName?.toLowerCase()).toContain('not available')
    cleanup()
  })

  it('Mode 3 shows a visible "coming soon" badge', async () => {
    const { container, cleanup } = await renderPage()
    expect(container.textContent).toContain('Coming soon')
    cleanup()
  })

  it('renders the picker heading and subheading', async () => {
    const { container, cleanup } = await renderPage()
    expect(container.textContent).toContain('How do you want to create this post?')
    expect(container.textContent).toContain('workflow that fits')
    cleanup()
  })
})

describe('CreatePickerPage — auth guards (unchanged pattern)', () => {
  it('redirects unauthenticated users to login', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    await expect(CreatePickerPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow('NEXT_REDIRECT')
  })

  it('redirects to onboarding when the user has no business', async () => {
    vi.mocked(getBusinessForUser).mockResolvedValue(null)
    await expect(CreatePickerPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow('NEXT_REDIRECT')
  })
})
