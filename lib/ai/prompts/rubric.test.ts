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
})
