import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: { server: { APP_URL: 'https://app.example.com' } },
}))

import { getSocialRedirectUri } from './redirect-uri'

describe('getSocialRedirectUri — SOCIAL-REDIRECT-URI-MATCH (ADR 0028 §2.5, D-β)', () => {
  it('builds the redirect URI from config.server.APP_URL only, per platform', () => {
    expect(getSocialRedirectUri('linkedin')).toBe('https://app.example.com/api/social/linkedin/callback')
    expect(getSocialRedirectUri('twitter')).toBe('https://app.example.com/api/social/twitter/callback')
  })

  it('is deterministic — the exact property connect and callback both rely on for exact-match redirect_uri', () => {
    expect(getSocialRedirectUri('linkedin')).toBe(getSocialRedirectUri('linkedin'))
  })
})
