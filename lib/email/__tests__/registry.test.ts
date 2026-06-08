import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      EMAIL_PROVIDER: 'mock',
      RESEND_API_KEY: 'test-key',
    },
  },
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: vi.fn() } }
  }),
}))

import { getEmailProvider, _resetEmailProviderForTests } from '../registry'
import { MockEmailProvider } from '../mock-provider'
import { ResendEmailProvider } from '../resend-provider'
import { config } from '@/lib/config'

type MutableServerConfig = { EMAIL_PROVIDER: 'mock' | 'resend'; RESEND_API_KEY: string }
const mockConfig = vi.mocked(config) as unknown as { server: MutableServerConfig }

beforeEach(() => {
  _resetEmailProviderForTests()
})

describe('getEmailProvider', () => {
  it('returns MockEmailProvider when EMAIL_PROVIDER is mock', () => {
    mockConfig.server.EMAIL_PROVIDER = 'mock'
    const provider = getEmailProvider()
    expect(provider).toBeInstanceOf(MockEmailProvider)
  })

  it('returns ResendEmailProvider when EMAIL_PROVIDER is resend', () => {
    mockConfig.server.EMAIL_PROVIDER = 'resend'
    const provider = getEmailProvider()
    expect(provider).toBeInstanceOf(ResendEmailProvider)
  })

  it('caches the provider across calls', () => {
    mockConfig.server.EMAIL_PROVIDER = 'mock'
    const first = getEmailProvider()
    const second = getEmailProvider()
    expect(first).toBe(second)
  })

  it('_resetEmailProviderForTests clears the cache so a new instance is returned', () => {
    mockConfig.server.EMAIL_PROVIDER = 'mock'
    const first = getEmailProvider()
    _resetEmailProviderForTests()
    const second = getEmailProvider()
    expect(first).not.toBe(second)
  })
})
