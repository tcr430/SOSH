import { describe, it, expect } from 'vitest'
import { buildDisconnectUrl } from './disconnect-url'

describe('buildDisconnectUrl — ADR 0028 §5.3', () => {
  it('names the identity explicitly when accountId is given', () => {
    expect(buildDisconnectUrl('linkedin', 'acc-1')).toBe(
      '/api/social/linkedin/disconnect?accountId=acc-1',
    )
  })

  it('falls back to the pre-dual-identity single-account shape when accountId is absent', () => {
    expect(buildDisconnectUrl('twitter')).toBe('/api/social/twitter/disconnect')
  })
})
