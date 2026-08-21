import { describe, it, expect } from 'vitest'
import { rubricPrompt, RubricOutputSchema, BRIEF_QUALITY_THRESHOLD, type RubricInput } from './rubric'
import type { CustomerContext } from '@/lib/ai/context'

function makeCtx(): CustomerContext {
  return {
    business: {
      id: 'biz-1',
      name: 'Acme SaaS',
      industry: 'Software',
      description: 'B2B analytics platform',
      language: 'en',
      website: 'https://acme.example.com',
      timezone: 'Europe/London',
    },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

const ALL_DIMENSIONS = [
  'specificity',
  'originality',
  'evidenceSufficiency',
  'audienceRelevance',
  'platformNativeness',
  'brandVoiceAlignment',
  'openingStrength',
  'ctaFit',
  'unsupportedClaimsRisk',
  'redundancy',
] as const

function makeDimension(score = 80) {
  return { score, note: 'Reasonably strong on this dimension.' }
}

function makeWellFormedPayload() {
  const dimensions = Object.fromEntries(ALL_DIMENSIONS.map((d) => [d, makeDimension()]))
  return {
    dimensions,
    overall: 80,
    critique: ['What proof would make the claim in paragraph two undeniable?'],
    verdict: 'pass' as const,
  }
}

describe('RubricOutputSchema', () => {
  it('accepts a well-formed payload with all ten dimensions, critique, and verdict', () => {
    const result = RubricOutputSchema.safeParse(makeWellFormedPayload())
    expect(result.success).toBe(true)
  })

  it('rejects a passive-score-only payload (missing critique and verdict)', () => {
    const dimensions = Object.fromEntries(ALL_DIMENSIONS.map((d) => [d, makeDimension()]))
    const passiveOnly = { dimensions, overall: 80 }
    const result = RubricOutputSchema.safeParse(passiveOnly)
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing critique[] specifically', () => {
    const payload = makeWellFormedPayload() as Record<string, unknown>
    delete payload.critique
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing verdict specifically', () => {
    const payload = makeWellFormedPayload() as Record<string, unknown>
    delete payload.verdict
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it.each(ALL_DIMENSIONS)('rejects a payload missing the %s dimension', (missingDim) => {
    const payload = makeWellFormedPayload()
    const dims = payload.dimensions as Record<string, unknown>
    delete dims[missingDim]
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects a dimension score outside 0-100', () => {
    const payload = makeWellFormedPayload()
    ;(payload.dimensions as Record<string, unknown>).specificity = { score: 150, note: 'too high' }
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects an overall score outside 0-100', () => {
    const payload = { ...makeWellFormedPayload(), overall: -1 }
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects an invalid verdict value', () => {
    const payload = { ...makeWellFormedPayload(), verdict: 'maybe' }
    const result = RubricOutputSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })
})

describe('BRIEF_QUALITY_THRESHOLD', () => {
  it('has the intended value', () => {
    expect(BRIEF_QUALITY_THRESHOLD).toBe(70)
  })

  it('is a number in the 0-100 range the rubric scores against', () => {
    expect(BRIEF_QUALITY_THRESHOLD).toBeGreaterThanOrEqual(0)
    expect(BRIEF_QUALITY_THRESHOLD).toBeLessThanOrEqual(100)
  })
})

describe('rubricPrompt', () => {
  it('is identified as the single shared rubric prompt', () => {
    expect(rubricPrompt.id).toBe('rubric')
  })

  it('uses the cheap model tier (L-7 Tier-1)', () => {
    expect(rubricPrompt.modelKey).toBe('HAIKU_4_5')
  })

  it('exposes its output schema as RubricOutputSchema (single instance, no fork)', () => {
    expect(rubricPrompt.outputSchema).toBe(RubricOutputSchema)
  })

  it('brief mode renders without a platform suffix', () => {
    const input: RubricInput = { mode: 'brief', contentLabel: 'campaign brief', content: 'Our narrative.' }
    const msg = rubricPrompt.buildUserMessage(input, makeCtx())
    expect(msg).toContain('Content to score: campaign brief')
    expect(msg).not.toContain('target platform')
  })

  it('post mode requires and renders the platform (structurally, not optionally)', () => {
    const input: RubricInput = {
      mode: 'post',
      contentLabel: 'LinkedIn post draft',
      content: 'Our post copy.',
      platform: 'linkedin',
    }
    const msg = rubricPrompt.buildUserMessage(input, makeCtx())
    expect(msg).toContain('target platform: linkedin')
  })

  // ADR 0021 §4.3 (Session 28 E5.7) — SIGNAL3-RUBRIC-UNCHANGED, as FIXTURE
  // EQUIVALENCE: mode:'card' was added ADDITIVELY (A-1). buildSystemPrompt
  // takes no `input` param (Prompt<TInput,TOutput>'s own interface), so it
  // is byte-identical for every mode by construction — asserted anyway,
  // exactly, not just "no error." buildUserMessage's card-mode branch is a
  // pure ADDITION at the end of the section list; brief/post mode output
  // must be byte-identical to what it was before this session's edit.
  describe('SIGNAL3-RUBRIC-UNCHANGED — mode:card is additive, brief/post output is byte-identical', () => {
    it("buildSystemPrompt is identical regardless of mode (it doesn't receive mode at all)", () => {
      const briefSystem = rubricPrompt.buildSystemPrompt(makeCtx())
      expect(briefSystem).not.toContain('TRIAGE CARD DRAFT')
      expect(briefSystem).toContain('exactly these ten dimensions')
    })

    it('mode:brief buildUserMessage is byte-identical to its pre-E5.7 form (no card-mode text leaks in)', () => {
      const input: RubricInput = { mode: 'brief', contentLabel: 'campaign brief', content: 'Our narrative.' }
      const msg = rubricPrompt.buildUserMessage(input, makeCtx())
      expect(msg).toBe(
        [
          '## Content to score: campaign brief\n[DATA]\nOur narrative.\n[/DATA]',
          'Score the content above across all ten dimensions. Return ONLY the JSON object.',
        ].join('\n\n'),
      )
      expect(msg).not.toContain('TRIAGE CARD DRAFT')
    })

    it('mode:post buildUserMessage is byte-identical to its pre-E5.7 form (no card-mode text leaks in)', () => {
      const input: RubricInput = { mode: 'post', contentLabel: 'LinkedIn post draft', content: 'Our post copy.', platform: 'linkedin' }
      const msg = rubricPrompt.buildUserMessage(input, makeCtx())
      expect(msg).toBe(
        [
          '## Content to score: LinkedIn post draft (target platform: linkedin)\n[DATA]\nOur post copy.\n[/DATA]',
          'Score the content above across all ten dimensions. Return ONLY the JSON object.',
        ].join('\n\n'),
      )
      expect(msg).not.toContain('TRIAGE CARD DRAFT')
    })

    it('mode:card appends the four-dimension n/a instruction, additively', () => {
      const input: RubricInput = { mode: 'card', contentLabel: 'triage card draft', content: 'Observation. Why it matters. Audience.' }
      const msg = rubricPrompt.buildUserMessage(input, makeCtx())
      expect(msg).toContain('## Content to score: triage card draft')
      expect(msg).toContain('TRIAGE CARD DRAFT')
      expect(msg).toContain('platformNativeness, brandVoiceAlignment, openingStrength, and ctaFit as 0')
      // Not the structural platform-suffix mode:'post' renders — the n/a
      // guidance prose legitimately mentions "no target platform" in
      // passing, which is a different string.
      expect(msg).not.toContain('(target platform:')
    })

    it('RubricOutputSchema is untouched — still exactly ten dimensions, no eleventh', () => {
      const shape = RubricOutputSchema.shape.dimensions.shape
      expect(Object.keys(shape).sort()).toEqual([...ALL_DIMENSIONS].sort())
    })
  })
})
