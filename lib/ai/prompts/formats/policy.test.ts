import { describe, it, expect } from 'vitest'
import { validateThreadPolicy, validateCarouselPolicy } from './policy'
import { AiError } from '@/lib/ai/errors'
import { CarouselOutputSchema } from './schemas'
import type { ThreadOutput, CarouselOutput } from './schemas'

function makeThread(overrides: Partial<ThreadOutput['posts'][number]>[] = []): ThreadOutput {
  const base: ThreadOutput['posts'] = [
    { text: 'Hook', role: 'hook' },
    { text: 'Quote', role: 'pull_quote' },
    { text: 'Close', role: 'close' },
  ]
  return {
    format: 'thread',
    imageBrief: null,
    scriptBrief: null,
    posts: overrides.length > 0 ? (overrides as ThreadOutput['posts']) : base,
  }
}

describe('validateThreadPolicy (MODE2-THREAD-GUARDRAILS)', () => {
  it('accepts a valid sequence: hook first, close last, >=1 pull_quote', () => {
    expect(() => validateThreadPolicy(makeThread())).not.toThrow()
  })

  it('throws policy_violation (not invalid_response) when posts[0] is not hook', () => {
    const thread = makeThread([
      { text: 'Not a hook', role: 'body' },
      { text: 'Quote', role: 'pull_quote' },
      { text: 'Close', role: 'close' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/hook/)
    }
  })

  it('throws policy_violation when the last post is not close', () => {
    const thread = makeThread([
      { text: 'Hook', role: 'hook' },
      { text: 'Quote', role: 'pull_quote' },
      { text: 'Not closing', role: 'body' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/close/)
    }
  })

  it('throws policy_violation when there is no pull_quote', () => {
    const thread = makeThread([
      { text: 'Hook', role: 'hook' },
      { text: 'Body', role: 'body' },
      { text: 'Close', role: 'close' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/pull_quote/)
    }
  })

  it('reports ALL violated rules in one message, not just the first', () => {
    const thread = makeThread([
      { text: 'Not a hook', role: 'body' },
      { text: 'Not closing', role: 'body' },
    ])
    try {
      validateThreadPolicy(thread)
      expect.unreachable('should have thrown')
    } catch (err) {
      const msg = (err as AiError).message
      expect(msg).toMatch(/hook/)
      expect(msg).toMatch(/close/)
      expect(msg).toMatch(/pull_quote/)
    }
  })
})

// ADR 0022 §6.2 (Session 29, F1b.7) — CAROUSEL-POLICY-SEQUENCE. Mirrors the
// thread suite's shape: a shape-VALID-but-policy-violating carousel throws
// policy_violation; a shape-INVALID one never reaches this function at all
// (it fails earlier, at the zod schema layer) — the two failure channels
// stay DISTINGUISHABLE (ADR 0017 §4.2), asserted explicitly below.
function makeCarousel(overrides: CarouselOutput['slides'] = []): CarouselOutput {
  const base: CarouselOutput['slides'] = [
    { text: 'Cover', role: 'cover', imageBrief: null },
    { text: 'Body', role: 'body', imageBrief: null },
    { text: 'CTA', role: 'cta', imageBrief: null },
  ]
  return {
    format: 'carousel',
    imageBrief: null,
    scriptBrief: null,
    slides: overrides.length > 0 ? overrides : base,
  }
}

describe('validateCarouselPolicy (CAROUSEL-POLICY-SEQUENCE)', () => {
  it('accepts a valid sequence: cover first, >=1 cta', () => {
    expect(() => validateCarouselPolicy(makeCarousel())).not.toThrow()
  })

  it('throws policy_violation (not invalid_response) when slides[0] is not cover', () => {
    const carousel = makeCarousel([
      { text: 'Not a cover', role: 'body', imageBrief: null },
      { text: 'CTA', role: 'cta', imageBrief: null },
      { text: 'Body', role: 'body', imageBrief: null },
    ])
    try {
      validateCarouselPolicy(carousel)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/cover/)
    }
  })

  it('throws policy_violation when there is no cta slide', () => {
    const carousel = makeCarousel([
      { text: 'Cover', role: 'cover', imageBrief: null },
      { text: 'Body', role: 'body', imageBrief: null },
      { text: 'Body 2', role: 'body', imageBrief: null },
    ])
    try {
      validateCarouselPolicy(carousel)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AiError).code).toBe('policy_violation')
      expect((err as AiError).message).toMatch(/cta/)
    }
  })

  it('reports ALL violated rules in one message, not just the first', () => {
    const carousel = makeCarousel([
      { text: 'Not a cover', role: 'body', imageBrief: null },
      { text: 'Also not cta', role: 'body', imageBrief: null },
    ])
    try {
      validateCarouselPolicy(carousel)
      expect.unreachable('should have thrown')
    } catch (err) {
      const msg = (err as AiError).message
      expect(msg).toMatch(/cover/)
      expect(msg).toMatch(/cta/)
    }
  })

  it('DISTINGUISHABLE codes: a shape-invalid carousel fails at the schema layer, never reaching validateCarouselPolicy as a policy_violation', () => {
    // Too few slides (2, below the 3-slide bound) — a structural failure
    // the zod schema rejects BEFORE any policy check could run. This is the
    // 'invalid_response' channel's source (runner.ts's zod-parse failure
    // handling, unchanged by this step) — proven distinguishable from
    // policy_violation by construction: this shape never reaches
    // validateCarouselPolicy in the real pipeline (generate-native.ts calls
    // runPrompt, which parses against CarouselOutputSchema first).
    const result = CarouselOutputSchema.safeParse({
      format: 'carousel',
      slides: [
        { text: 'Not a cover', role: 'body', imageBrief: null },
        { text: 'Also not cta', role: 'body', imageBrief: null },
      ],
      imageBrief: null,
    })
    expect(result.success).toBe(false)
  })
})
