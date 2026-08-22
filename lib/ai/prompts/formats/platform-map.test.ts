import { describe, it, expect } from 'vitest'
import { selectFormatFamily } from './platform-map'

describe('selectFormatFamily (ADR 0017 §4.3)', () => {
  it.each(['linkedin', 'facebook', 'instagram'] as const)(
    '%s is always single, regardless of content volume',
    (platform) => {
      expect(selectFormatFamily(platform, 0, false)).toBe('single')
      expect(selectFormatFamily(platform, 5, false)).toBe('single')
      expect(selectFormatFamily(platform, 100, false)).toBe('single')
    },
  )

  it.each(['twitter', 'threads'] as const)('%s: below 3 tweets worth stays single', (platform) => {
    expect(selectFormatFamily(platform, 0, false)).toBe('single')
    expect(selectFormatFamily(platform, 1, false)).toBe('single')
    expect(selectFormatFamily(platform, 2.9, false)).toBe('single')
  })

  it.each(['twitter', 'threads'] as const)('%s: 3 or more tweets worth becomes a thread', (platform) => {
    expect(selectFormatFamily(platform, 3, false)).toBe('thread')
    expect(selectFormatFamily(platform, 5, false)).toBe('thread')
    expect(selectFormatFamily(platform, 8, false)).toBe('thread')
  })

  it('twitter and threads apply the IDENTICAL volume rule (distinctness is in constraints text, not this function)', () => {
    for (const volume of [0, 1, 2.9, 3, 5, 8]) {
      expect(selectFormatFamily('twitter', volume, false)).toBe(selectFormatFamily('threads', volume, false))
    }
  })
})
