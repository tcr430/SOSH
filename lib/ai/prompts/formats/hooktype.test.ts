import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  HOOK_TYPES,
  NativeOutputSchema,
  SinglePostOutputSchema,
  ThreadOutputSchema,
  CarouselOutputSchema,
} from './schemas'
import { createNativeGenerationPrompt } from './native-generation-prompt'
import { classify, type ClassifyAiOriginal } from '@/lib/learning/classify'
import { AI_ORIGINAL_SCHEMA_VERSION } from '@/lib/db/post-ai-originals'
import type { CustomerContext } from '@/lib/ai/context'

// ADR 0026 §4.3 (founder ruling A-6) — OUTCOME-HOOKTYPE-ADDITIVE (constraint 8).
//
// `hookType` is the model's own statement of the OPENING type it used, requested
// inside the EXISTING generation call (no new model call, no model/tier change).
// It is collected and shown, never promoted (ADR 0026 §4.1: the model's
// self-report is unvalidated until a kappa >= 0.6 agreement check). The schema
// addition must be ADDITIVE: an older payload without it still parses, the stored
// snapshot version does not move, and ADR 0018's classifier is unaffected.

const POSTS = [
  { text: 'Most teams post daily and learn nothing.', role: 'hook' as const },
  { text: 'Here is what we changed and what happened.', role: 'pull_quote' as const },
  { text: 'Try it for two weeks.', role: 'close' as const },
]
const SLIDES = [
  { text: 'Cover', role: 'cover' as const, imageBrief: null },
  { text: 'Body', role: 'body' as const, imageBrief: null },
  { text: 'Act', role: 'cta' as const, imageBrief: null },
]

// A v1-shaped payload for each family: exactly what a snapshot written before
// this change contains (no hookType key at all).
const WITHOUT = {
  single: { format: 'single' as const, body: 'Most teams post daily and learn nothing.', imageBrief: null },
  thread: { format: 'thread' as const, posts: POSTS, imageBrief: null },
  carousel: { format: 'carousel' as const, slides: SLIDES, imageBrief: null },
}
const SCHEMAS = {
  single: SinglePostOutputSchema,
  thread: ThreadOutputSchema,
  carousel: CarouselOutputSchema,
}
const FAMILIES = ['single', 'thread', 'carousel'] as const

// createNativeGenerationPrompt is overloaded per LITERAL family (ADR 0017 §4.4
// [type-1]) and does not accept a union, so the parameterised tests go through this
// exhaustive switch rather than a cast.
function promptFor(family: (typeof FAMILIES)[number]) {
  switch (family) {
    case 'single':
      return createNativeGenerationPrompt('single')
    case 'thread':
      return createNativeGenerationPrompt('thread')
    case 'carousel':
      return createNativeGenerationPrompt('carousel')
  }
}

function makeCtx(): CustomerContext {
  return {
    business: { id: 'biz-1', name: 'Acme SaaS', industry: 'Software', description: null, language: 'en', website: null, timezone: 'UTC' },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

describe('hookType — the single value list', () => {
  it('is exactly the six ADR 0026 §4.1 values, in ADR order', () => {
    expect([...HOOK_TYPES]).toEqual(['question', 'statistic', 'contrarian', 'story', 'announcement', 'how_to'])
  })

  // The list lives in ONE TS place (schemas.ts). The database holds two twins
  // (the post_dimensions CHECK and the tagging trigger's CASE sanitiser), read
  // here from the migration file itself so a value added to one and not the other
  // fails this test instead of silently untagging every post that uses it.
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260919110000_outcome_tables.sql'),
    'utf8',
  )
  const quoted = (list: string) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])

  it('equals the post_dimensions.hook_type CHECK list in the J2.3 migration', () => {
    const m = /hook_type\s+text\s+CHECK \(hook_type IS NULL OR hook_type IN \(([^)]*)\)\)/.exec(migration)
    expect(m, 'the hook_type CHECK was not found in the J2.3 migration').not.toBeNull()
    expect(quoted(m![1])).toEqual([...HOOK_TYPES])
  })

  it("equals the tagging trigger's CASE sanitiser list in the J2.3 migration", () => {
    const m = /NEW\.payload ->> 'hookType' IN \(([^)]*)\)/.exec(migration)
    expect(m, "the trigger's hookType sanitiser was not found in the J2.3 migration").not.toBeNull()
    expect(quoted(m![1])).toEqual([...HOOK_TYPES])
  })
})

describe.each(FAMILIES)('hookType is ADDITIVE on the %s schema (OUTCOME-HOOKTYPE-ADDITIVE)', (family) => {
  const schema = SCHEMAS[family]

  it('a v1 payload WITHOUT hookType still parses, and gains no hookType key', () => {
    const result = schema.safeParse(WITHOUT[family])
    expect(result.success).toBe(true)
    expect('hookType' in (result.data as object)).toBe(false)
  })

  it.each([...HOOK_TYPES])('a payload WITH hookType %s parses and the value survives (zod strips unknown keys, so it must be in the schema)', (hook) => {
    const result = schema.safeParse({ ...WITHOUT[family], hookType: hook })
    expect(result.success).toBe(true)
    expect((result.data as { hookType?: string }).hookType).toBe(hook)
  })

  it('hookType null is accepted and kept as null (the model may say none fits)', () => {
    const result = schema.safeParse({ ...WITHOUT[family], hookType: null })
    expect(result.success).toBe(true)
    expect((result.data as { hookType?: string | null }).hookType).toBeNull()
  })

  it('an UNKNOWN hookType is REJECTED — the whole output is invalid (ADR 0026 §4.3 states the schema literally as z.enum(...).nullish())', () => {
    // Stated plainly because it is a real consequence, not a detail: an unrecognised
    // value fails the parse, which the runner surfaces as invalid_response and the
    // ADR 0017 §4.4 bounded re-prompt handles (one retry). The prompt lists the closed
    // set, so this should be rare. The database is separately total: the tagging
    // trigger turns any out-of-vocabulary payload value into NULL, so an
    // already-stored payload can never abort a generation.
    for (const bad of ['clickbait', 'Question', '', 5, {}, ['question']]) {
      expect(schema.safeParse({ ...WITHOUT[family], hookType: bad }).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('the discriminated union accepts it too', () => {
    expect(NativeOutputSchema.safeParse({ ...WITHOUT[family], hookType: 'story' }).success).toBe(true)
    expect(NativeOutputSchema.safeParse(WITHOUT[family]).success).toBe(true)
  })
})

describe('the generation prompts ask the model for its opening type — inside the existing call', () => {
  const list = HOOK_TYPES.map((v) => `"${v}"`).join(' | ')

  it.each(FAMILIES)('%s: the system prompt names hookType, offers exactly the HOOK_TYPES list (rendered from the one source), and allows null', (family) => {
    const sys = promptFor(family).buildSystemPrompt(makeCtx())
    expect(sys).toContain('"hookType"')
    expect(sys).toContain(list)
    expect(sys).toMatch(/hookType[^\n]*(?:opening|first)/i)
    expect(sys).toMatch(/null/)
    for (const hook of HOOK_TYPES) expect(sys).toContain(`"${hook}"`)
  })

  it.each(FAMILIES)('%s: still a single model call configuration — same model key and temperature, and the schema is the family schema', (family) => {
    const prompt = promptFor(family)
    expect(prompt.modelKey).toBe('SONNET_4_6')
    expect(prompt.temperature).toBe(1.0)
    expect(prompt.outputSchema).toBe(SCHEMAS[family])
  })
})

describe('the stored snapshot version is NOT bumped (ADR 0018 §2.4)', () => {
  it('AI_ORIGINAL_SCHEMA_VERSION is unchanged at 2', () => {
    // ADR 0026 §4.3 and the build guide say "stays 1"; that wording predates ADR 0024
    // H2.4, which bumped the constant 1 -> 2 (lib/db/post-ai-originals.ts:16). The
    // requirement is "not bumped by this change", so what is pinned is the CURRENT
    // value. Bumping it would make ADR 0018's classifier abandon every new signal
    // (orchestrator.ts: a schema_version mismatch is refused, not best-effort parsed).
    expect(AI_ORIGINAL_SCHEMA_VERSION).toBe(2)
  })
})

describe("ADR 0018's classifier, imported UNMODIFIED, is unaffected by hookType", () => {
  // classify() reads only the rendered text, hashtags, platform, format and a thread
  // post count — never the payload. Inputs are derived the way the orchestrator
  // derives them (the thread's posts[] length; the same '\n\n---\n\n' join generate.ts
  // uses for content). Same rendered text, with and without hookType => identical output.
  const JOIN = '\n\n---\n\n'

  function aiOriginalFrom(family: 'single' | 'thread', payload: { format: string; body?: string; posts?: { text: string }[] }): ClassifyAiOriginal {
    return {
      postId: 'post-1',
      platform: 'linkedin',
      format: family,
      renderedContent: family === 'single' ? payload.body! : payload.posts!.map((p) => p.text).join(JOIN),
      hashtags: ['#saas'],
      threadPostCount: family === 'thread' ? payload.posts!.length : null,
    }
  }

  const humanEdits = [
    (rendered: string) => rendered, // approved untouched
    (rendered: string) => `${rendered}\n\nBook a demo: https://acme.example/demo`, // adds a CTA + link
    (rendered: string) => rendered.slice(0, Math.floor(rendered.length / 2)), // shortened
    (rendered: string) => rendered.replace(/^[^.\n]+/, 'A completely different opening'), // rewrote the hook
  ]

  it.each(['single', 'thread'] as const)('%s: classify() output is deep-equal with and without hookType across a battery of human edits', (family) => {
    const withoutParsed = SCHEMAS[family].parse(WITHOUT[family])
    const withParsed = SCHEMAS[family].parse({ ...WITHOUT[family], hookType: 'contrarian' })
    const without = aiOriginalFrom(family, withoutParsed as never)
    const withHook = aiOriginalFrom(family, withParsed as never)

    // The derived inputs are themselves identical — hookType never reaches the rendered text.
    expect(withHook).toEqual(without)

    for (const edit of humanEdits) {
      const human = { humanContent: edit(without.renderedContent), humanHashtags: ['#saas'] }
      expect(classify(withHook, human, null, [])).toEqual(classify(without, human, null, []))
    }
  })

  it('nothing in the learning pipeline reads hookType (lib/learning is untouched by this change)', () => {
    const dir = path.join(process.cwd(), 'lib', 'learning')
    const sources = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    expect(sources.length).toBeGreaterThan(5)
    for (const source of sources) expect(source).not.toMatch(/hook_?type/i)
  })
})
