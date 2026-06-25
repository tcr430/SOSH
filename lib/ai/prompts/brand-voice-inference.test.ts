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

// ── Output schema — existing fields ──────────────────────────────────────

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

// ── Output schema — voiceAxes (BP3) ──────────────────────────────────────

const validVoiceAxes = {
  formal_casual: 45,
  expert_peer: 30,
  serious_playful: 60,
  reserved_warm: 70,
  calm_energetic: 50,
  rational_emotional: 40,
  exclusive_inclusive: 55,
}

describe('BrandVoiceInferredSchema — voiceAxes', () => {
  it('accepts a full valid object including voiceAxes', () => {
    const full = { ...fixture, voiceAxes: validVoiceAxes }
    expect(() => BrandVoiceInferredSchema.parse(full)).not.toThrow()
  })

  it('rejects when voiceAxes is missing', () => {
    const { voiceAxes: _unused, ...withoutAxes } = { ...fixture, voiceAxes: validVoiceAxes }
    expect(() => BrandVoiceInferredSchema.parse(withoutAxes)).toThrow()
  })

  it('rejects when a required axis key is missing', () => {
    const { formal_casual: _unused, ...missingOne } = validVoiceAxes
    const invalid = { ...fixture, voiceAxes: missingOne }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects axis value above 100', () => {
    const invalid = { ...fixture, voiceAxes: { ...validVoiceAxes, formal_casual: 101 } }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects axis value below 0', () => {
    const invalid = { ...fixture, voiceAxes: { ...validVoiceAxes, expert_peer: -1 } }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('rejects non-integer axis value', () => {
    const invalid = { ...fixture, voiceAxes: { ...validVoiceAxes, serious_playful: 50.5 } }
    expect(() => BrandVoiceInferredSchema.parse(invalid)).toThrow()
  })

  it('accepts boundary values 0 and 100', () => {
    const boundary = { ...validVoiceAxes, formal_casual: 0, expert_peer: 100 }
    expect(() => BrandVoiceInferredSchema.parse({ ...fixture, voiceAxes: boundary })).not.toThrow()
  })
})

// ── Per-axis scoring rubric in prompt body (R4) ──────────────────────────

describe('buildSystemPrompt — per-axis scoring rubric (R4)', () => {
  const AXES = [
    'formal_casual',
    'expert_peer',
    'serious_playful',
    'reserved_warm',
    'calm_energetic',
    'rational_emotional',
    'exclusive_inclusive',
  ] as const

  it('contains a rubric anchor for every one of the 7 axes', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    for (const axis of AXES) {
      expect(prompt, `missing rubric anchor for axis "${axis}"`).toContain(axis)
    }
  })

  it('instructs scoring from 0 to 100', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(prompt).toContain('0–100')
  })

  it('mentions ~50 default when site gives no signal', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(prompt).toContain('50')
  })

  it('mentions voiceAxes key in the JSON structure block', () => {
    const prompt = brandVoiceInferencePrompt.buildSystemPrompt(mockContext)
    expect(prompt).toContain('voiceAxes')
  })
})

// ── Input cap: at most 3 writing samples (ADR 0011 §5) ───────────────────

describe('buildUserMessage — writing sample cap', () => {
  it('feeds at most 3 writing samples and labels them correctly', () => {
    const samples = ['Sample A', 'Sample B', 'Sample C']
    const msg = brandVoiceInferencePrompt.buildUserMessage(
      { writingExamples: samples, websiteText: null },
      mockContext,
    )
    expect(msg).toContain('Sample A')
    expect(msg).toContain('Sample B')
    expect(msg).toContain('Sample C')
    const matches = msg.match(/Writing Example \d+:/g)
    expect(matches).toHaveLength(3)
  })
})
