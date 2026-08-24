import { describe, it, expect } from 'vitest'
import { selectFormatFamily, type FormatFamily } from './platform-map'
import type { Platform } from '@/lib/db/types'

// ADR 0022 §6.3/A-4 (Session 29, F1b.7) — MODE2-FORMAT-SELECTION-UNCHANGED.
// Deliberately a SEPARATE file from platform-map.test.ts: that file's diff
// this session is arity-only (its eleven pre-existing call sites each
// gained a `, false` and NOTHING else — Session 29-D, D7 (NIT-1) corrected
// this count from the previously-stated "ten"; the final `it` block has TWO
// calls on one line) — a new describe block appended there would still be
// truthfully "arity-only" for the existing lines, but keeping the NEW
// frozen-table assertion in its own file makes that claim trivially
// verifiable by inspection.
//
// Record<Platform, ...>-typed: if Platform ever gains a member, this object
// literal fails to satisfy the type and tsc --noEmit HARD-FAILS — strictly
// stronger than a runtime completeness check (a missing `it.each` entry
// would just silently not run).
//
// Not a snapshot file: a snapshot rots and gets -u'd back to green without
// anyone reading what changed. Every cell here is a literal, hand-written
// expectation.
//
// Session 29-D, D7 (MINOR-1) — the table originally used only two volume
// points (1 and 5), neither adjacent to platform-map.ts's `>= 3` threshold,
// so editing that threshold to `>= 2` or `>= 4` left every row here green;
// the boundary survived only in the weaker platform-map.test.ts:17-21.
// The table now includes 2, 2.9 and 3 — the two points immediately below
// the boundary and the boundary value itself — for every platform and both
// carouselRequested values, so a shifted threshold reddens HERE, not just
// in the co-editable file.

type VolumeExpectation = {
  noCarousel: FormatFamily
  carousel: FormatFamily
}

type FrozenExpectation = {
  low: VolumeExpectation // 1 — well below the thread threshold
  belowBoundary: VolumeExpectation // 2 — still below
  justBelowBoundary: VolumeExpectation // 2.9 — the closest non-integer approach from below
  atBoundary: VolumeExpectation // 3 — AT the threshold itself
  high: VolumeExpectation // 5 — well above the threshold
}

const VOLUMES = {
  low: 1,
  belowBoundary: 2,
  justBelowBoundary: 2.9,
  atBoundary: 3,
  high: 5,
} as const

type VolumeKey = keyof typeof VOLUMES

// The pre-F2 value for EVERY (platform, estimatedTweetsWorth) combination
// that already existed is UNCHANGED (every *.noCarousel cell) — L-10 holds
// in its strict form. Only instagram's *.carousel cells differ from their
// *.noCarousel siblings — the ONE new combination F1b.7 makes reachable.
// twitter/threads' cells are the ones that actually move at the `>= 3`
// boundary: single through belowBoundary/justBelowBoundary, thread from
// atBoundary onward, for BOTH carouselRequested values (carousel only
// affects instagram).
const FROZEN_EXPECTATIONS: Record<Platform, FrozenExpectation> = {
  linkedin: {
    low: { noCarousel: 'single', carousel: 'single' },
    belowBoundary: { noCarousel: 'single', carousel: 'single' },
    justBelowBoundary: { noCarousel: 'single', carousel: 'single' },
    atBoundary: { noCarousel: 'single', carousel: 'single' },
    high: { noCarousel: 'single', carousel: 'single' },
  },
  facebook: {
    low: { noCarousel: 'single', carousel: 'single' },
    belowBoundary: { noCarousel: 'single', carousel: 'single' },
    justBelowBoundary: { noCarousel: 'single', carousel: 'single' },
    atBoundary: { noCarousel: 'single', carousel: 'single' },
    high: { noCarousel: 'single', carousel: 'single' },
  },
  instagram: {
    low: { noCarousel: 'single', carousel: 'carousel' },
    belowBoundary: { noCarousel: 'single', carousel: 'carousel' },
    justBelowBoundary: { noCarousel: 'single', carousel: 'carousel' },
    atBoundary: { noCarousel: 'single', carousel: 'carousel' },
    high: { noCarousel: 'single', carousel: 'carousel' },
  },
  twitter: {
    low: { noCarousel: 'single', carousel: 'single' },
    belowBoundary: { noCarousel: 'single', carousel: 'single' },
    justBelowBoundary: { noCarousel: 'single', carousel: 'single' },
    atBoundary: { noCarousel: 'thread', carousel: 'thread' },
    high: { noCarousel: 'thread', carousel: 'thread' },
  },
  threads: {
    low: { noCarousel: 'single', carousel: 'single' },
    belowBoundary: { noCarousel: 'single', carousel: 'single' },
    justBelowBoundary: { noCarousel: 'single', carousel: 'single' },
    atBoundary: { noCarousel: 'thread', carousel: 'thread' },
    high: { noCarousel: 'thread', carousel: 'thread' },
  },
}

describe('selectFormatFamily — frozen expectation table (MODE2-FORMAT-SELECTION-UNCHANGED)', () => {
  for (const platform of Object.keys(FROZEN_EXPECTATIONS) as Platform[]) {
    const expected = FROZEN_EXPECTATIONS[platform]

    for (const volumeKey of Object.keys(VOLUMES) as VolumeKey[]) {
      const volume = VOLUMES[volumeKey]
      const cell = expected[volumeKey]

      it(`${platform}: estimatedTweetsWorth=${volume} (${volumeKey}), carouselRequested=false -> ${cell.noCarousel}`, () => {
        expect(selectFormatFamily(platform, volume, false)).toBe(cell.noCarousel)
      })

      it(`${platform}: estimatedTweetsWorth=${volume} (${volumeKey}), carouselRequested=true -> ${cell.carousel}`, () => {
        expect(selectFormatFamily(platform, volume, true)).toBe(cell.carousel)
      })
    }
  }

  it('carouselRequested=true changes the result ONLY for instagram — every other platform is untouched by the new parameter', () => {
    for (const platform of Object.keys(FROZEN_EXPECTATIONS) as Platform[]) {
      const withoutCarousel = selectFormatFamily(platform, VOLUMES.high, false)
      const withCarousel = selectFormatFamily(platform, VOLUMES.high, true)
      if (platform === 'instagram') {
        expect(withCarousel).not.toBe(withoutCarousel)
      } else {
        expect(withCarousel).toBe(withoutCarousel)
      }
    }
  })
})
