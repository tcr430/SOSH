import { describe, it, expect } from 'vitest'
import { NativeOutputSchema, SinglePostOutputSchema, ThreadOutputSchema, CarouselOutputSchema } from './schemas'

describe('NativeOutputSchema (MODE2-FORMAT-FAMILY-STRUCTURAL)', () => {
  it('accepts a well-formed single-post payload', () => {
    const result = NativeOutputSchema.safeParse({ format: 'single', body: 'Hello world', imageBrief: null })
    expect(result.success).toBe(true)
  })

  it('accepts a well-formed thread payload (3 posts, valid roles)', () => {
    const result = NativeOutputSchema.safeParse({
      format: 'thread',
      posts: [
        { text: 'Hook tweet', role: 'hook' },
        { text: 'Body tweet', role: 'body' },
        { text: 'Close tweet', role: 'close' },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(true)
  })

  it('REJECTS prose where a thread schema was expected (bare string)', () => {
    const result = NativeOutputSchema.safeParse('Just a plain prose string, not structured content')
    expect(result.success).toBe(false)
  })

  it('rejects a payload with an unrecognized format tag', () => {
    // 'carousel' is now a REAL branch (F1b.7) — this must use a genuinely
    // unrecognized tag to keep testing what its name claims.
    const result = NativeOutputSchema.safeParse({ format: 'script', body: 'x' })
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed carousel payload (3 slides, valid roles)', () => {
    const result = NativeOutputSchema.safeParse({
      format: 'carousel',
      slides: [
        { text: 'Cover slide', role: 'cover', imageBrief: null },
        { text: 'Body slide', role: 'body', imageBrief: null },
        { text: 'CTA slide', role: 'cta', imageBrief: null },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a single post with empty body', () => {
    const result = SinglePostOutputSchema.safeParse({ format: 'single', body: '', imageBrief: null })
    expect(result.success).toBe(false)
  })

  it('rejects a thread with fewer than 3 posts', () => {
    const result = ThreadOutputSchema.safeParse({
      format: 'thread',
      posts: [
        { text: 'Only one', role: 'hook' },
        { text: 'Only two', role: 'close' },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a thread with more than 8 posts', () => {
    const posts = Array.from({ length: 9 }, (_, i) => ({ text: `Tweet ${i}`, role: 'body' as const }))
    const result = ThreadOutputSchema.safeParse({ format: 'thread', posts, imageBrief: null })
    expect(result.success).toBe(false)
  })

  it('rejects a thread post with an invalid role', () => {
    const result = ThreadOutputSchema.safeParse({
      format: 'thread',
      posts: [
        { text: 'a', role: 'intro' },
        { text: 'b', role: 'body' },
        { text: 'c', role: 'close' },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(false)
  })

  it('does not accept a posts[].order field as meaningful — schema has no such key ([type-2])', () => {
    const parsed = ThreadOutputSchema.parse({
      format: 'thread',
      posts: [
        { text: 'a', role: 'hook', order: 99 },
        { text: 'b', role: 'body' },
        { text: 'c', role: 'close' },
      ],
      imageBrief: null,
    })
    // zod strips unknown keys by default — order never survives into the typed output.
    expect(parsed.posts[0]).not.toHaveProperty('order')
  })
})

// ADR 0022 §6.1 (Session 29, F1b.7) — CAROUSEL-SCHEMA-STRUCTURAL: safeParse
// REJECTS structurally, not by a downstream string check (mirrors the
// thread bound tests above exactly, at carousel's own 3..10 bound).
describe('CarouselOutputSchema (CAROUSEL-SCHEMA-STRUCTURAL)', () => {
  function makeSlides(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      text: `Slide ${i}`,
      role: (i === 0 ? 'cover' : i === n - 1 ? 'cta' : 'body') as 'cover' | 'body' | 'cta',
      imageBrief: null,
    }))
  }

  it('rejects a carousel with fewer than 3 slides', () => {
    const result = CarouselOutputSchema.safeParse({ format: 'carousel', slides: makeSlides(2), imageBrief: null })
    expect(result.success).toBe(false)
  })

  it('rejects a carousel with more than 10 slides', () => {
    const result = CarouselOutputSchema.safeParse({ format: 'carousel', slides: makeSlides(11), imageBrief: null })
    expect(result.success).toBe(false)
  })

  it('accepts a carousel at exactly the 3 and 10 slide bounds', () => {
    expect(CarouselOutputSchema.safeParse({ format: 'carousel', slides: makeSlides(3), imageBrief: null }).success).toBe(true)
    expect(CarouselOutputSchema.safeParse({ format: 'carousel', slides: makeSlides(10), imageBrief: null }).success).toBe(true)
  })

  it('rejects a slide with an invalid role', () => {
    const result = CarouselOutputSchema.safeParse({
      format: 'carousel',
      slides: [
        { text: 'a', role: 'intro', imageBrief: null },
        { text: 'b', role: 'body', imageBrief: null },
        { text: 'c', role: 'cta', imageBrief: null },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(false)
  })

  it('REJECTS prose where a carousel schema was expected (bare string)', () => {
    const result = NativeOutputSchema.safeParse('Just a plain prose string, not a structured carousel')
    expect(result.success).toBe(false)
  })

  it('does not accept a slides[].order field as meaningful — schema has no such key ([type-2])', () => {
    const parsed = CarouselOutputSchema.parse({
      format: 'carousel',
      slides: [
        { text: 'a', role: 'cover', imageBrief: null, order: 99 },
        { text: 'b', role: 'body', imageBrief: null },
        { text: 'c', role: 'cta', imageBrief: null },
      ],
      imageBrief: null,
    })
    expect(parsed.slides[0]).not.toHaveProperty('order')
  })

  it('each slide carries its OWN imageBrief, independent of the branch-level imageBrief', () => {
    const parsed = CarouselOutputSchema.parse({
      format: 'carousel',
      slides: [
        { text: 'a', role: 'cover', imageBrief: 'A cover image' },
        { text: 'b', role: 'body', imageBrief: null },
        { text: 'c', role: 'cta', imageBrief: 'A CTA image' },
      ],
      imageBrief: 'An overall carousel image',
    })
    expect(parsed.slides[0].imageBrief).toBe('A cover image')
    expect(parsed.slides[1].imageBrief).toBeNull()
    expect(parsed.imageBrief).toBe('An overall carousel image')
  })
})
