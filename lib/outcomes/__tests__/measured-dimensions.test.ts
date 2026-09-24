import { describe, it, expect } from 'vitest'
import { ctaPresent, firstSentence, hookSurvived, lengthBand, THREAD_SEGMENT_SEPARATOR } from '../measured'
import { hasCta } from '@/lib/learning/diff'

// ADR 0026 §4.4 — measured dimensions, measured once from the immutable published artefact. Every band
// boundary is asserted on BOTH sides. The CTA rule is ADR 0018's function, imported unmodified.

const chars = (n: number) => 'x'.repeat(n)
const thread = (segments: number) => Array.from({ length: segments }, (_, i) => `part ${i + 1}`).join(THREAD_SEGMENT_SEPARATOR)

describe('lengthBand (ADR 0026 §4.4)', () => {
  it.each([
    [99, 'short'], [100, 'medium'], [220, 'medium'], [221, 'long'],
  ])('X single, %i chars -> %s', (n, band) => {
    expect(lengthBand({ platform: 'twitter', content: chars(n) })).toBe(band)
  })

  it.each([
    [3, 'short'], [4, 'medium'], [6, 'medium'], [7, 'long'],
  ])('X thread, %i segments -> %s', (segments, band) => {
    expect(lengthBand({ platform: 'twitter', content: thread(segments) })).toBe(band)
    expect(lengthBand({ platform: 'twitter', content: thread(segments), format: 'thread' })).toBe(band)
  })

  it.each([
    [599, 'short'], [600, 'medium'], [1300, 'medium'], [1301, 'long'],
  ])('LinkedIn, %i chars -> %s', (n, band) => {
    expect(lengthBand({ platform: 'linkedin', content: chars(n) })).toBe(band)
  })

  it("an explicit snapshot format wins over content sniffing (a 'single' is measured in chars even if it contains a rule)", () => {
    expect(lengthBand({ platform: 'twitter', content: chars(150), format: 'single' })).toBe('medium')
  })

  it('a platform without a length dimension yields null', () => {
    expect(lengthBand({ platform: 'instagram', content: chars(50) })).toBeNull()
  })
})

describe("ctaPresent — through ADR 0018's function, imported unmodified", () => {
  const cases = [
    'Visit our pricing page for the full comparison',
    'Subscribe to get the next teardown',
    'A plain observation about onboarding with no ask at all.',
    'Read the whole story here https://acme.example/blog/churn',
    '',
  ]
  it.each(cases)('agrees with hasCta for %j', (content) => {
    expect(ctaPresent(content)).toBe(hasCta(content))
  })

  it('finds a CTA where one exists and not where none does', () => {
    expect(ctaPresent('Visit our pricing page for the full comparison')).toBe(true)
    expect(ctaPresent('A plain observation about onboarding with no ask at all.')).toBe(false)
  })
})

describe('hookSurvived', () => {
  it('true when the normalised first sentence is unchanged (case, whitespace and end punctuation ignored)', () => {
    expect(hookSurvived('Most teams post daily and learn nothing. Here is why.', 'most teams  post daily and learn nothing! Then more.')).toBe(true)
  })

  it('false when the human rewrote the opening', () => {
    expect(hookSurvived('A completely different opening. Rest stays.', 'Most teams post daily and learn nothing. Rest stays.')).toBe(false)
  })

  it('null when there is no snapshot to compare (a human-written post)', () => {
    expect(hookSurvived('Anything at all.', null)).toBeNull()
  })

  it("compares a thread's FIRST post only", () => {
    const published = ['Hook stays the same.', 'Body was rewritten entirely.'].join(THREAD_SEGMENT_SEPARATOR)
    const original = ['Hook stays the same.', 'Original body.'].join(THREAD_SEGMENT_SEPARATOR)
    expect(hookSurvived(published, original)).toBe(true)
  })

  it('firstSentence with no terminator falls back to the first line', () => {
    expect(firstSentence('No terminator here\nsecond line')).toBe('no terminator here')
    expect(firstSentence('  Hello   world?  Next.')).toBe('hello world')
  })
})
