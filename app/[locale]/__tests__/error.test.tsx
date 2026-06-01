// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import * as Sentry from '@sentry/nextjs'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn().mockReturnValue('mock-event-id'),
}))

vi.mock('next-intl', () => ({
  useTranslations: vi.fn().mockReturnValue((key: string) => key),
}))

vi.mock('next/navigation', () => ({
  useParams: vi.fn().mockReturnValue({ locale: 'en' }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
  getLocale: vi.fn().mockResolvedValue('en'),
}))

describe('LocaleError', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('wraps Sentry.captureException once on mount', async () => {
    const { default: LocaleError } = await import('../error')

    await act(async () => {
      createRoot(container).render(
        React.createElement(LocaleError, { error: new Error('test error'), reset: vi.fn() }),
      )
    })

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('LocaleNotFound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('does NOT call Sentry.captureException', async () => {
    const { default: LocaleNotFound } = await import('../not-found')
    await LocaleNotFound()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
