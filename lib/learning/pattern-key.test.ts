import { describe, it, expect } from 'vitest'
import { computePatternKey, computeContradictingPatternKey } from '@/lib/learning/pattern-key'
import type { PreferenceSignal } from '@/lib/learning/classify'
import type { Platform } from '@/lib/db/types'

function signal(overrides: Partial<PreferenceSignal> = {}): PreferenceSignal {
  return {
    _class: 'preference',
    kind: 'thread_shortened',
    postId: 'post-1',
    platform: 'linkedin' as Platform,
    detail: {},
    ...overrides,
  }
}

describe('computePatternKey', () => {
  it('keys the same phenomenon identically regardless of prose (two different post ids/detail text)', () => {
    const a = signal({ postId: 'post-a', detail: { from: 3, to: 2 } })
    const b = signal({ postId: 'post-b', detail: { from: 5, to: 4 } })
    expect(computePatternKey(a)).toBe(computePatternKey(b))
  })

  it('keys two distinct phenomena differently — different kind', () => {
    const a = signal({ kind: 'thread_shortened' })
    const b = signal({ kind: 'thread_lengthened' })
    expect(computePatternKey(a)).not.toBe(computePatternKey(b))
  })

  it('keys two distinct phenomena differently — different platform', () => {
    const a = signal({ platform: 'linkedin' as Platform })
    const b = signal({ platform: 'twitter' as Platform })
    expect(computePatternKey(a)).not.toBe(computePatternKey(b))
  })

  it('keys length_delta by the SIGN of the delta, not its magnitude', () => {
    const shrunkALittle = signal({ kind: 'length_delta', detail: { delta: -0.16 } })
    const shrunkALot = signal({ kind: 'length_delta', detail: { delta: -0.8 } })
    const grew = signal({ kind: 'length_delta', detail: { delta: 0.2 } })
    expect(computePatternKey(shrunkALittle)).toBe(computePatternKey(shrunkALot))
    expect(computePatternKey(shrunkALittle)).not.toBe(computePatternKey(grew))
  })

  it('is deterministic across repeated calls on the same signal', () => {
    const s = signal()
    expect(computePatternKey(s)).toBe(computePatternKey(s))
  })
})

describe('computeContradictingPatternKey', () => {
  it('cta_added contradicts cta_removed on the same platform', () => {
    const added = signal({ kind: 'cta_added' })
    const removed = signal({ kind: 'cta_removed' })
    expect(computeContradictingPatternKey(added)).toBe(computePatternKey(removed))
  })

  it('thread_shortened contradicts thread_lengthened on the same platform', () => {
    const shortened = signal({ kind: 'thread_shortened' })
    const lengthened = signal({ kind: 'thread_lengthened' })
    expect(computeContradictingPatternKey(shortened)).toBe(computePatternKey(lengthened))
  })

  it('length_delta shorter contradicts length_delta longer', () => {
    const shorter = signal({ kind: 'length_delta', detail: { delta: -0.5 } })
    const longer = signal({ kind: 'length_delta', detail: { delta: 0.5 } })
    expect(computeContradictingPatternKey(shorter)).toBe(computePatternKey(longer))
  })

  it('returns null for kinds with no natural opposite', () => {
    for (const kind of ['avoid_word_removed', 'hashtag_delta', 'link_moved', 'numbering_stripped'] as const) {
      expect(computeContradictingPatternKey(signal({ kind }))).toBeNull()
    }
  })
})
