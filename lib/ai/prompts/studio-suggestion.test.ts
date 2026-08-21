import { describe, it, expect } from 'vitest'
import { studioSuggestionPrompt, StudioSuggestionOutputSchema, type StudioSuggestionInput } from './studio-suggestion'
import { PLATFORM_CONSTRAINTS } from './post-generation'
import { STUDIO_SUGGEST_MAX_TOKENS } from '@/lib/studio/guard'
import type { CustomerContext } from '@/lib/ai/context'

const mockContext: CustomerContext = {
  business: { id: 'biz-1', name: 'Acme', industry: 'SaaS', description: null, language: 'en', website: null, timezone: 'UTC' },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: null,
}

function makeInput(overrides: Partial<StudioSuggestionInput> = {}): StudioSuggestionInput {
  return {
    draft: 'Our onboarding is fast.',
    platform: 'linkedin',
    nonce: 'deadbeef',
    governedPatterns: [],
    evidenceRendered: '' as StudioSuggestionInput['evidenceRendered'],
    ...overrides,
  }
}

describe('studioSuggestionPrompt', () => {
  it('sets modelKey HAIKU_4_5 and the derived maxTokens (ADR §4/§4.5)', () => {
    expect(studioSuggestionPrompt.modelKey).toBe('HAIKU_4_5')
    expect(studioSuggestionPrompt.maxTokens).toBe(STUDIO_SUGGEST_MAX_TOKENS)
  })

  it('PLATFORM_CONSTRAINTS for the target platform is present in the built USER message', () => {
    for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const) {
      const user = studioSuggestionPrompt.buildUserMessage(makeInput({ platform }), mockContext)
      expect(user).toContain(PLATFORM_CONSTRAINTS[platform])
    }
  })

  it('STUDIO-CACHE-PREFIX-STABLE: the nonce is in the user message, NEVER the system block', () => {
    const nonce = 'cafebabe'
    const system = studioSuggestionPrompt.buildSystemPrompt(mockContext)
    const user = studioSuggestionPrompt.buildUserMessage(makeInput({ nonce }), mockContext)
    expect(user).toContain(nonce)
    expect(system).not.toContain(nonce)
  })

  it('STUDIO-CACHE-PREFIX-STABLE: the draft is in the user message, NEVER the system block', () => {
    const draft = 'UNIQUE-DRAFT-MARKER-xyz123'
    const system = studioSuggestionPrompt.buildSystemPrompt(mockContext)
    const user = studioSuggestionPrompt.buildUserMessage(makeInput({ draft }), mockContext)
    expect(user).toContain(draft)
    expect(system).not.toContain(draft)
  })

  it('the system prompt is IDENTICAL across two calls with different nonces/drafts (a genuinely stable cache prefix)', () => {
    const systemA = studioSuggestionPrompt.buildSystemPrompt(mockContext)
    const systemB = studioSuggestionPrompt.buildSystemPrompt(mockContext)
    expect(systemA).toBe(systemB)
  })

  it('STUDIO-NO-MODEL-OFFSETS: the output schema has no field named or shaped like a character offset', () => {
    const shape = StudioSuggestionOutputSchema.shape
    expect(Object.keys(shape)).not.toContain('offset')
    expect(Object.keys(shape.suggestions.element.shape)).not.toContain('offset')
  })

  it('rejects a suggestion carrying a bare free-text memorySource (must be the discriminated union, never a string)', () => {
    const result = StudioSuggestionOutputSchema.safeParse({
      revision: 'x',
      suggestions: [{ id: 's1', category: 'specificity', rationale: 'r', memorySource: 'some sentence' }],
      draftObservations: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a rationale over 280 characters', () => {
    const result = StudioSuggestionOutputSchema.safeParse({
      revision: 'x',
      suggestions: [{ id: 's1', category: 'specificity', rationale: 'r'.repeat(281) }],
      draftObservations: [],
    })
    expect(result.success).toBe(false)
  })

  it('BLOCKER-1 fix (Session 26-D): passes input.draft into the [DATA] block UNCHANGED — buildUserMessage no longer re-guards it, because guarding is the CALLER\'s job (actions.ts\'s single guardStudioField call, threaded through the model, the join, the citation oracle, the diff and persistence alike)', () => {
    // Simulates what actions.ts actually passes: the ALREADY-GUARDED draft
    // (a raw sentinel would never survive guardStudioField, so it is not
    // present here — that guarantee now lives in actions.ts/guard.ts, not
    // in this function).
    const alreadyGuardedDraft = 'text more text'
    const user = studioSuggestionPrompt.buildUserMessage(makeInput({ draft: alreadyGuardedDraft }), mockContext)
    const dataBlock = user.match(/## The draft to revise\n\[DATA\]\n([\s\S]*?)\n\[\/DATA\]/)?.[1]
    expect(dataBlock).toBe(alreadyGuardedDraft)
  })
})
