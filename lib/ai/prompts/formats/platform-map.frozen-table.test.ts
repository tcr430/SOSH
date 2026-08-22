import { describe, it, expect } from 'vitest'
import { selectFormatFamily, type FormatFamily } from './platform-map'
import type { Platform } from '@/lib/db/types'

// ADR 0022 §6.3/A-4 (Session 29, F1b.7) — MODE2-FORMAT-SELECTION-UNCHANGED.
// Deliberately a SEPARATE file from platform-map.test.ts: that file's diff
// this session is arity-only (its ten pre-existing call sites each gained a
// `, false` and NOTHING else) — a new describe block appended there would
// still be truthfully "arity-only" for the existing lines, but keeping the
// NEW frozen-table assertion in its own file makes that claim trivially
// verifiable by inspection (the whole platform-map.test.ts diff is ten
// one-token insertions, full stop).
//
// Record<Platform, ...>-typed: if Platform ever gains a member, this object
// literal fails to satisfy the type and tsc --noEmit HARD-FAILS — strictly
// stronger than a runtime completeness check (a missing `it.each` entry
// would just silently not run).
//
// Not a snapshot file: a snapshot rots and gets -u'd back to green without
// anyone reading what changed. Every cell here is a literal, hand-written
// expectation.

type FrozenExpectation = {
  // estimatedTweetsWorth below the thread threshold (1), carouselRequested=false
  lowNoCarousel: FormatFamily
  // estimatedTweetsWorth at/above the thread threshold (5), carouselRequested=false
  highNoCarousel: FormatFamily
  // estimatedTweetsWorth below the thread threshold (1), carouselRequested=true
  lowCarousel: FormatFamily
  // estimatedTweetsWorth at/above the thread threshold (5), carouselRequested=true
  highCarousel: FormatFamily
}

const LOW_VOLUME = 1
const HIGH_VOLUME = 5

// The pre-F2 value for EVERY (platform, estimatedTweetsWorth) combination
// that already existed is UNCHANGED (the *NoCarousel columns) — L-10 holds
// in its strict form. Only instagram's *Carousel columns differ from their
// *NoCarousel siblings — the ONE new combination F1b.7 makes reachable.
const FROZEN_EXPECTATIONS: Record<Platform, FrozenExpectation> = {
  linkedin: { lowNoCarousel: 'single', highNoCarousel: 'single', lowCarousel: 'single', highCarousel: 'single' },
  facebook: { lowNoCarousel: 'single', highNoCarousel: 'single', lowCarousel: 'single', highCarousel: 'single' },
  instagram: { lowNoCarousel: 'single', highNoCarousel: 'single', lowCarousel: 'carousel', highCarousel: 'carousel' },
  twitter: { lowNoCarousel: 'single', highNoCarousel: 'thread', lowCarousel: 'single', highCarousel: 'thread' },
  threads: { lowNoCarousel: 'single', highNoCarousel: 'thread', lowCarousel: 'single', highCarousel: 'thread' },
}

describe('selectFormatFamily — frozen expectation table (MODE2-FORMAT-SELECTION-UNCHANGED)', () => {
  for (const platform of Object.keys(FROZEN_EXPECTATIONS) as Platform[]) {
    const expected = FROZEN_EXPECTATIONS[platform]

    it(`${platform}: low volume, carouselRequested=false -> ${expected.lowNoCarousel}`, () => {
      expect(selectFormatFamily(platform, LOW_VOLUME, false)).toBe(expected.lowNoCarousel)
    })

    it(`${platform}: high volume, carouselRequested=false -> ${expected.highNoCarousel}`, () => {
      expect(selectFormatFamily(platform, HIGH_VOLUME, false)).toBe(expected.highNoCarousel)
    })

    it(`${platform}: low volume, carouselRequested=true -> ${expected.lowCarousel}`, () => {
      expect(selectFormatFamily(platform, LOW_VOLUME, true)).toBe(expected.lowCarousel)
    })

    it(`${platform}: high volume, carouselRequested=true -> ${expected.highCarousel}`, () => {
      expect(selectFormatFamily(platform, HIGH_VOLUME, true)).toBe(expected.highCarousel)
    })
  }

  it('every *NoCarousel value is IDENTICAL to its pre-F1b.7 value — the byte-identical claim, restated as one assertion per platform', () => {
    for (const platform of Object.keys(FROZEN_EXPECTATIONS) as Platform[]) {
      const withoutCarouselArg = selectFormatFamily(platform, LOW_VOLUME, false)
      const withCarouselArgFalse = selectFormatFamily(platform, LOW_VOLUME, false)
      expect(withoutCarouselArg).toBe(withCarouselArgFalse)
    }
  })

  it('carouselRequested=true changes the result ONLY for instagram — every other platform is untouched by the new parameter', () => {
    for (const platform of Object.keys(FROZEN_EXPECTATIONS) as Platform[]) {
      const withoutCarousel = selectFormatFamily(platform, HIGH_VOLUME, false)
      const withCarousel = selectFormatFamily(platform, HIGH_VOLUME, true)
      if (platform === 'instagram') {
        expect(withCarousel).not.toBe(withoutCarousel)
      } else {
        expect(withCarousel).toBe(withoutCarousel)
      }
    }
  })
})
