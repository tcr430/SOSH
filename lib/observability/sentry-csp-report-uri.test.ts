import { describe, it, expect } from 'vitest'
import { deriveSentryCspReportUri } from './sentry-csp-report-uri'

describe('deriveSentryCspReportUri', () => {
  it('returns correct URL for a valid DSN', () => {
    const dsn = 'https://pubkey123@o123.ingest.sentry.io/456789'
    const result = deriveSentryCspReportUri(dsn)
    expect(result).toBe('https://o123.ingest.sentry.io/api/456789/security/?sentry_key=pubkey123')
  })

  it('returns null for undefined', () => {
    expect(deriveSentryCspReportUri(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(deriveSentryCspReportUri('')).toBeNull()
  })

  it('returns null for a malformed DSN', () => {
    expect(deriveSentryCspReportUri('not-a-url')).toBeNull()
  })
})
