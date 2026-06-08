import { config } from '@/lib/config'
import type { EmailProvider } from './types'
import { MockEmailProvider } from './mock-provider'
import { ResendEmailProvider } from './resend-provider'

let cached: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cached) return cached
  cached =
    config.server.EMAIL_PROVIDER === 'mock'
      ? new MockEmailProvider()
      : new ResendEmailProvider()
  return cached
}

export function _resetEmailProviderForTests(): void {
  cached = null
}
