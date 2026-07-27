import { describe, it, expect } from 'vitest'
import {
  splitThreadSegments,
  lengthDelta,
  hashtagDelta,
  firstUrlSegmentIndex,
  hasCta,
  opensWithNumbering,
  removedSentences,
  hasFactualMarker,
  containsWord,
} from '@/lib/learning/diff'

describe('splitThreadSegments', () => {
  it('splits on the fixed generate.ts delimiter', () => {
    expect(splitThreadSegments('a\n\n---\n\nb\n\n---\n\nc')).toEqual(['a', 'b', 'c'])
  })
  it('returns a single segment for single-format content', () => {
    expect(splitThreadSegments('just one post')).toEqual(['just one post'])
  })
})

describe('lengthDelta', () => {
  it('computes (human - original) / original', () => {
    expect(lengthDelta('12345', '1234567890')).toBeCloseTo(1, 5)
  })
  it('guards div-by-zero on empty original', () => {
    expect(lengthDelta('', 'anything')).toBe(0)
  })
})

describe('hashtagDelta', () => {
  it('reports added and removed as a set difference', () => {
    expect(hashtagDelta(['#a', '#b'], ['#b', '#c'])).toEqual({ added: ['#c'], removed: ['#a'] })
  })
  it('is empty when identical', () => {
    expect(hashtagDelta(['#a'], ['#a'])).toEqual({ added: [], removed: [] })
  })
})

describe('firstUrlSegmentIndex', () => {
  it('finds the segment index of the first URL', () => {
    expect(firstUrlSegmentIndex(['no link here', 'visit https://sosh.app now'])).toBe(1)
  })
  it('returns null when no segment has a URL', () => {
    expect(firstUrlSegmentIndex(['nothing', 'here'])).toBeNull()
  })
})

describe('hasCta', () => {
  it('detects an imperative opener', () => {
    expect(hasCta('Sign up today for early access.')).toBe(true)
  })
  it('detects an outbound URL in the final segment', () => {
    expect(hasCta('Some thoughts.\n\n---\n\nRead more: https://sosh.app')).toBe(true)
  })
  it('is false with neither signal', () => {
    expect(hasCta('Just an observation about the market.')).toBe(false)
  })
})

describe('opensWithNumbering', () => {
  it.each(['1/ first point', '1. first point', '(1/7) first point'])('matches %s', (segment) => {
    expect(opensWithNumbering(segment)).toBe(true)
  })
  it('is false with no marker', () => {
    expect(opensWithNumbering('First point, no marker')).toBe(false)
  })
})

describe('removedSentences', () => {
  it('returns sentences present in original and absent from human, in original casing', () => {
    const original = 'We serve 500 customers. Our platform is great. It works well.'
    const human = 'Our platform is great. It works well.'
    expect(removedSentences(original, human)).toEqual(['We serve 500 customers.'])
  })
  it('is case/whitespace-insensitive for the membership check', () => {
    const original = 'This is Great.'
    const human = 'this   is   great.'
    expect(removedSentences(original, human)).toEqual([])
  })
})

describe('hasFactualMarker', () => {
  it('flags a numeral', () => expect(hasFactualMarker('We serve 500 customers.')).toBe(true))
  it('flags a percent sign', () => expect(hasFactualMarker('Up 20% this quarter.')).toBe(true))
  it('flags a superlative', () => expect(hasFactualMarker('The best tool on the market.')).toBe(true))
  it('flags a named entity', () => expect(hasFactualMarker('Acme Corp uses it daily.')).toBe(true))
  it('is false on a plain sentence', () => expect(hasFactualMarker('it works well for teams')).toBe(false))
})

describe('containsWord', () => {
  it('matches on word boundaries, case-insensitive', () => {
    expect(containsWord('We are Synergistic leaders', 'synergistic')).toBe(true)
  })
  it('does not match a substring of another word', () => {
    expect(containsWord('disruptive innovation', 'disrupt')).toBe(false)
  })
})
