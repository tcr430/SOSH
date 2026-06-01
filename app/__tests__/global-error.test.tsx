// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn().mockReturnValue('mock-event-id'),
}))

function setPathname(path: string) {
  Object.defineProperty(window, 'location', {
    value: { pathname: path },
    configurable: true,
    writable: true,
  })
}

describe('GlobalError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setPathname('/en/somewhere')
  })

  it('renders without crashing when given a fake Error', async () => {
    const { default: GlobalError } = await import('../global-error')
    const reset = vi.fn()
    const html = renderToString(
      React.createElement(GlobalError, { error: new Error('test error'), reset }),
    )
    expect(html).toBeTruthy()
    expect(html).toContain('Something went wrong')
  })

  it('detects locale pt when window.location is /pt/something', async () => {
    setPathname('/pt/something')
    const { detectLocale } = await import('../global-error')
    expect(detectLocale()).toBe('pt')
  })

  it('falls back to en for unknown segment', async () => {
    setPathname('/unknown/route')
    const { detectLocale } = await import('../global-error')
    expect(detectLocale()).toBe('en')
  })
})
