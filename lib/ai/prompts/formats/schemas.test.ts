import { describe, it, expect } from 'vitest'
import { NativeOutputSchema, SinglePostOutputSchema, ThreadOutputSchema } from './schemas'

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
    const result = NativeOutputSchema.safeParse({ format: 'carousel', slides: [] })
    expect(result.success).toBe(false)
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
