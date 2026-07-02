import { describe, it, expect } from 'vitest'
import { buildPlatformPostUrl } from './platform-url'

describe('buildPlatformPostUrl', () => {
  // ---- null cases ---------------------------------------------------------

  it('returns null when platformPostId is null', () => {
    expect(buildPlatformPostUrl('twitter', null)).toBeNull()
  })

  it('returns null when platformPostId is empty string', () => {
    expect(buildPlatformPostUrl('twitter', '')).toBeNull()
  })

  it('returns null for linkedin (IDs are opaque URNs without user context)', () => {
    expect(buildPlatformPostUrl('linkedin', 'urn:li:share:7123456789012345678')).toBeNull()
  })

  it('returns null for instagram (requires username not stored)', () => {
    expect(buildPlatformPostUrl('instagram', '17846368219941196')).toBeNull()
  })

  it('returns null for facebook (requires page slug not stored)', () => {
    expect(buildPlatformPostUrl('facebook', '123456789_987654321')).toBeNull()
  })

  it('returns null for threads (requires username not stored)', () => {
    expect(buildPlatformPostUrl('threads', 'CaBcDeFgHiJ')).toBeNull()
  })

  // ---- derivable URL cases ------------------------------------------------

  it('returns an x.com URL for twitter with a valid tweet id', () => {
    const url = buildPlatformPostUrl('twitter', '1234567890123456789')
    expect(url).toBe('https://x.com/i/web/status/1234567890123456789')
  })

  it('twitter URL contains the exact platformPostId', () => {
    const id = '9876543210987654321'
    const url = buildPlatformPostUrl('twitter', id)
    expect(url).toContain(id)
  })

  it('returns null for twitter when id is whitespace only', () => {
    expect(buildPlatformPostUrl('twitter', '   ')).toBeNull()
  })

  // ---- MINOR-3: encodeURIComponent hardening -------------------------------

  it('encodes a crafted id so it cannot break out of the path segment', () => {
    const craftedId = '../../evil?x=1#frag'
    const url = buildPlatformPostUrl('twitter', craftedId)
    expect(url).toBe(`https://x.com/i/web/status/${encodeURIComponent(craftedId)}`)
    expect(url).not.toContain('../../evil')
  })

  it('encodes special characters in the id (slash, question mark, ampersand)', () => {
    const url = buildPlatformPostUrl('twitter', 'abc/def?x=1&y=2')
    expect(url).toBe('https://x.com/i/web/status/abc%2Fdef%3Fx%3D1%26y%3D2')
  })
})
