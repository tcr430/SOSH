import { describe, it, expect } from 'vitest'
import { SinglePostOutputSchema, ThreadOutputSchema, CarouselOutputSchema, ClaimSchema, CLAIMS_MAX, CLAIM_TEXT_MAX_CHARS } from './schemas'
import { createNativeGenerationPrompt } from './native-generation-prompt'
import { FROZEN_TABLE } from '../frozen-table'
import type { CustomerContext } from '@/lib/ai/context'
import type { FormatFamily } from './platform-map'
import { assertNever } from '@/lib/utils'

// createNativeGenerationPrompt is overloaded per LITERAL family (ADR 0017 §4.4 [type-1]); a loop over a union needs
// an exhaustive switch, never a cast (cerebrum, 2026-09-19).
function promptFor(family: FormatFamily) {
  switch (family) {
    case 'single': return createNativeGenerationPrompt('single')
    case 'thread': return createNativeGenerationPrompt('thread')
    case 'carousel': return createNativeGenerationPrompt('carousel')
    default: return assertNever(family)
  }
}

// ADR 0027 §4.1 (Session 34 K2.9) — `claims` on the native-generation output. z.object STRIPS unknown keys, so the
// field must be declared on EACH branch or it is silently discarded; these tests are what notices a branch missing it.

const ctx: CustomerContext = {
  business: { id: 'b', name: 'Acme SaaS', industry: 'Software', description: null, language: 'en', website: null, timezone: 'UTC' },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: null,
}

const claims = [{ text: 'We cut churn by 42%.', evidenceMemoryId: 'ev-1' }, { text: 'The fastest tool.' }]
const single = { format: 'single', body: 'b', imageBrief: null, claims }
const thread = { format: 'thread', posts: [{ text: 'h', role: 'hook' }, { text: 'b', role: 'body' }, { text: 'c', role: 'close' }], imageBrief: null, claims }
const carousel = { format: 'carousel', slides: [{ text: 'c', role: 'cover', imageBrief: null }, { text: 'b', role: 'body', imageBrief: null }, { text: 'x', role: 'cta', imageBrief: null }], imageBrief: null, claims }

describe('the claims field survives parsing on EVERY branch (it would be silently stripped on one that lacks it)', () => {
  it.each([
    ['single', SinglePostOutputSchema, single],
    ['thread', ThreadOutputSchema, thread],
    ['carousel', CarouselOutputSchema, carousel],
  ] as const)('%s keeps claims, including a claim with no evidenceMemoryId', (_n, schema, input) => {
    const parsed = schema.parse(input)
    expect(parsed.claims).toEqual(claims)
  })

  it.each([
    ['single', SinglePostOutputSchema, single],
    ['thread', ThreadOutputSchema, thread],
    ['carousel', CarouselOutputSchema, carousel],
  ] as const)('%s: claims is OPTIONAL — an output without it (or with null) still parses', (_n, schema, input) => {
    const without: Record<string, unknown> = { ...(input as Record<string, unknown>) }
    delete without.claims
    expect(schema.safeParse(without).success).toBe(true)
    expect(schema.safeParse({ ...without, claims: null }).success).toBe(true)
    expect(schema.safeParse({ ...without, claims: [] }).success).toBe(true)
  })
})

describe('ClaimSchema bounds', () => {
  it('needs non-empty text, accepts a null/absent id, rejects an empty id string and oversize text', () => {
    expect(ClaimSchema.safeParse({ text: 'x' }).success).toBe(true)
    expect(ClaimSchema.safeParse({ text: 'x', evidenceMemoryId: null }).success).toBe(true)
    expect(ClaimSchema.safeParse({ text: '' }).success).toBe(false)
    expect(ClaimSchema.safeParse({ text: 'x', evidenceMemoryId: '' }).success).toBe(false)
    expect(ClaimSchema.safeParse({ text: 'x'.repeat(CLAIM_TEXT_MAX_CHARS + 1) }).success).toBe(false)
  })
  it('caps the number of claims per post', () => {
    const many = Array.from({ length: CLAIMS_MAX + 1 }, (_, i) => ({ text: `c${i}` }))
    expect(SinglePostOutputSchema.safeParse({ ...single, claims: many }).success).toBe(false)
  })
})

describe('the prompt asks for claims, in all three families, and shows the model a real id to cite', () => {
  it.each(['single', 'thread', 'carousel'] as const)('%s system prompt carries the claims shape and the narrow claim definition', (family) => {
    const sys = promptFor(family).buildSystemPrompt(ctx)
    expect(sys).toContain('"claims": [ { "text": "string", "evidenceMemoryId": "string" } ]')
    expect(sys).toContain('CHECKABLE ASSERTION')
    expect(sys).toContain('a number, a percentage, a named customer')
    expect(sys).toContain('Opinion and general prose are NOT claims')
    expect(sys).toContain('Never invent an id')
    expect(sys).toContain('"Evidence id"')
    // the JSON shape stays valid: hookType is now followed by a comma, claims is last
    expect(sys).toMatch(/"hookType": [^\n]* \| null,\n {2}"claims"/)
  })
})

describe('version bump discipline: the prompt text changed, so the version and the frozen table moved together', () => {
  it.each(['single', 'thread', 'carousel'] as const)('native-generation-%s is version 4 in both the prompt and the frozen table', (family) => {
    const prompt = promptFor(family)
    expect(prompt.version).toBe(4)
    expect(FROZEN_TABLE[prompt.id].version).toBe(4)
  })
})
