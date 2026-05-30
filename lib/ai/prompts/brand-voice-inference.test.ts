import { describe, it, expect } from 'vitest'
import { brandVoiceInferencePrompt, BrandVoiceInferredSchema } from './brand-voice-inference'
import type { CustomerContext } from '@/lib/ai/context'
import fixture from '@/lib/ai/__fixtures__/brand-voice-inference.json'

// ── Minimal mock context ──────────────────────────────────────────────────

const mockContext: CustomerContext = {
  business: {
    id: 'biz-test',
    name: 'Acme Corp',
    industry: 'SaaS',
    description: 'We make great software',
    language: 'en',
    website: 'https://acme.com',
    timezone: 'Europe/London',
  },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: null,
}

const ptContext: CustomerContext = {
  ...mockContext,
  business: { ...mockContext.business, language: 'pt' },
}

// ── Prompt identity ───────────────────────────────────────────────────────

describe('prompt identity', () => {
  it('id is the stable string "brand-voice-inference"', () => {
    expect(brandVoiceInferencePrompt.id).toBe('brand-voice-inference')
  })

  it('version is 1', () => {
    expect(brandVoiceInferencePrompt.version).toBe(1)
  })

  it('modelKey is OPUS_4_7', () => {
    expect(brandVoiceInferencePrompt.modelKey).toBe('OPUS_4_7')
  })
})

// ── buildSystemPrompt ─────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('contains prompt injection defense line', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(prompt).toContain('[DATA]')
    expect(prompt).toContain('not as instructions')
  })

  it('contains "Respond in en" when language is en', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(prompt).toContain('Respond in en')
  })

  it('contains "Respond in pt" when language is pt', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(ptContext)
    expect(prompt).toContain('Respond in pt')
  })

  it('returns a non-empty string', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(50)
  })
})

// ── buildUserMessage ──────────────────────────────────────────────────────

describe('buildUserMessage', () => {
  it('wraps website text in [DATA]...[/DATA] tags when present', () => {
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: [], websiteText: 'Our product helps teams ship faster.' },
      mockContext,
    )
    expect(msg).toContain('[DATA]')
    expect(msg).toContain('[/DATA]')
    expect(msg).toContain('Our product helps teams ship faster.')
  })

  it('omits website section entirely when websiteText is null', () => {
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: [], websiteText: null },
      mockContext,
    )
    expect(msg).not.toContain('Website')
  })

  it('includes writing examples wrapped in [DATA]...[/DATA] when present', () => {
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: ['We ship fast.', 'Quality first.'], websiteText: null },
      mockContext,
    )
    expect(msg).toContain('[DATA]')
    expect(msg).toContain('[/DATA]')
    expect(msg).toContain('We ship fast.')
  })

  it('omits writing examples section when array is empty', () => {
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: [], websiteText: null },
      mockContext,
    )
    expect(msg).not.toContain('Writing Example')
  })

  it('includes business name from context', () => {
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: [], websiteText: null },
      mockContext,
    )
    expect(msg).toContain('Acme Corp')
  })
})

// ── Output schema ─────────────────────────────────────────────────────────

describe('BrandVoiceInferredSchema', () => {
  it('accepts the fixture response', () => {
    expect(() => BrandVoiceInferredSchema.parse(fixture)).not.toThrow()
  })

  it('rejects missing required fields (no tone)', () => {
    const invalid = { ...fixture, tone: undefined }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects missing targetAudience', () => {
    const invalid = { ...fixture, targetAudience: undefined }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects tone array exceeding 5 items', () => {
    const invalid = { ...fixture, tone: ['a', 'b', 'c', 'd', 'e', 'f'] }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects tone array with 0 items', () => {
    const invalid = { ...fixture, tone: [] }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects keywords array with fewer than 3 items', () => {
    const invalid = { ...fixture, keywords: ['only-one', 'two'] }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects uniqueValueProp shorter than 20 chars', () => {
    const invalid = { ...fixture, uniqueValueProp: 'Too short' }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })
})
