import { describe, it, expect } from 'vitest'
import { createNativeGenerationPrompt, type NativeGenInput } from './native-generation-prompt'
import { SinglePostOutputSchema, ThreadOutputSchema } from './schemas'
import type { CustomerContext } from '@/lib/ai/context'
import type { RenderedEvidence } from '@/lib/ai/wrap-evidence'

function makeCtx(): CustomerContext {
  return {
    business: { id: 'biz-1', name: 'Acme SaaS', industry: 'Software', description: null, language: 'en', website: null, timezone: 'UTC' },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

function makeInput(overrides: Partial<NativeGenInput> = {}): NativeGenInput {
  return {
    angle: 'Show the churn-reduction proof point',
    role: 'customer_proof',
    platform: 'linkedin',
    narrative: 'We help B2B SaaS teams post consistently.',
    renderedEvidence: '' as RenderedEvidence,
    scheduledAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  }
}

describe('createNativeGenerationPrompt ([type-1] per-family factory)', () => {
  it('single family: concrete id/schema, matching the SinglePostOutputSchema instance', () => {
    const prompt = createNativeGenerationPrompt('single')
    expect(prompt.id).toBe('native-generation-single')
    expect(prompt.outputSchema).toBe(SinglePostOutputSchema)
  })

  it('thread family: concrete id/schema, matching the ThreadOutputSchema instance', () => {
    const prompt = createNativeGenerationPrompt('thread')
    expect(prompt.id).toBe('native-generation-thread')
    expect(prompt.outputSchema).toBe(ThreadOutputSchema)
  })

  it('builds a system prompt mentioning the shared brand name', () => {
    const prompt = createNativeGenerationPrompt('single')
    const sys = prompt.buildSystemPrompt(makeCtx())
    expect(sys).toContain('Acme SaaS')
  })

  it('renders pre-rendered evidence VERBATIM without re-sanitizing', () => {
    const prompt = createNativeGenerationPrompt('single')
    const alreadyGuarded = '[DATA]\nSome pinned proof\n[/DATA]' as RenderedEvidence
    const msg = prompt.buildUserMessage(makeInput({ renderedEvidence: alreadyGuarded }), makeCtx())
    expect(msg).toContain(alreadyGuarded)
  })

  it('appends a correction section only when correctionNote is set', () => {
    const prompt = createNativeGenerationPrompt('single')
    const withoutCorrection = prompt.buildUserMessage(makeInput(), makeCtx())
    expect(withoutCorrection).not.toContain('Correction Needed')

    const withCorrection = prompt.buildUserMessage(
      makeInput({ correctionNote: 'Your JSON was missing the imageBrief field.' }),
      makeCtx(),
    )
    expect(withCorrection).toContain('Correction Needed')
    expect(withCorrection).toContain('imageBrief field')
  })

  it('thread system prompt mentions the hook/close/pull_quote structural rules and explicitly excludes order', () => {
    const prompt = createNativeGenerationPrompt('thread')
    const sys = prompt.buildSystemPrompt(makeCtx())
    expect(sys).toContain('hook')
    expect(sys).toContain('close')
    expect(sys).toContain('pull_quote')
    // The prompt explicitly instructs the model NOT to include an order
    // field ([type-2]) — it necessarily mentions the word while doing so.
    expect(sys).toMatch(/do not include an "order" field/i)
  })
})
