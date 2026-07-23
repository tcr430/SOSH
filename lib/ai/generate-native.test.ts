import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./runner', () => ({
  runPrompt: vi.fn(),
}))
vi.mock('./wrap-evidence', () => ({
  wrapEvidenceForPrompt: vi.fn().mockResolvedValue(''),
}))

import { runPrompt } from './runner'
import { generateNativeContent, type GenerateNativeContentInput } from './generate-native'
import { AiError } from './errors'
import type { CustomerContext } from './context'
import type { SinglePostOutput, ThreadOutput } from './prompts/formats/schemas'

function makeCtx(): CustomerContext {
  return {
    business: { id: 'biz-1', name: 'Acme SaaS', industry: 'Software', description: null, language: 'en', website: null, timezone: 'UTC' },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

const validSingle: SinglePostOutput = { format: 'single', body: 'Great post content', imageBrief: null }
const validThread: ThreadOutput = {
  format: 'thread',
  posts: [
    { text: 'Hook', role: 'hook' },
    { text: 'Quote', role: 'pull_quote' },
    { text: 'Close', role: 'close' },
  ],
  imageBrief: null,
}
const policyBrokenThread: ThreadOutput = {
  format: 'thread',
  posts: [
    { text: 'Not a hook', role: 'body' },
    { text: 'Quote', role: 'pull_quote' },
    { text: 'Close', role: 'close' },
  ],
  imageBrief: null,
}

function singleInput(overrides: Partial<GenerateNativeContentInput> = {}): GenerateNativeContentInput {
  return {
    angle: 'proof point',
    role: 'customer_proof',
    platform: 'linkedin',
    narrative: 'narrative text',
    pinnedEvidenceIds: [],
    scheduledAt: '2026-08-01T09:00:00.000Z',
    estimatedTweetsWorth: 0,
    ...overrides,
  }
}

function threadInput(overrides: Partial<GenerateNativeContentInput> = {}): GenerateNativeContentInput {
  return {
    angle: 'proof point',
    role: 'customer_proof',
    platform: 'twitter',
    narrative: 'narrative text',
    pinnedEvidenceIds: [],
    scheduledAt: '2026-08-01T09:00:00.000Z',
    estimatedTweetsWorth: 5,
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = {} as any

beforeEach(() => {
  vi.mocked(runPrompt).mockReset()
})

describe('generateNativeContent — bounded re-prompt (MODE2-NATIVE-RETRY)', () => {
  it('success on the first attempt: runPrompt called exactly ONCE', async () => {
    vi.mocked(runPrompt).mockResolvedValueOnce(validSingle)
    const result = await generateNativeContent(client, makeCtx(), singleInput())
    expect(result).toEqual(validSingle)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('invalid_response then success: runPrompt called EXACTLY TWICE, second call carries a correction note', async () => {
    vi.mocked(runPrompt)
      .mockRejectedValueOnce(new AiError('invalid_response', 'not valid JSON'))
      .mockResolvedValueOnce(validSingle)

    const result = await generateNativeContent(client, makeCtx(), singleInput())

    expect(result).toEqual(validSingle)
    expect(runPrompt).toHaveBeenCalledTimes(2)
    const secondCallInput = vi.mocked(runPrompt).mock.calls[1][2] as { correctionNote?: string }
    expect(secondCallInput.correctionNote).toBeTruthy()
  })

  it('policy_violation (thread) then a policy-passing thread: runPrompt called EXACTLY TWICE', async () => {
    vi.mocked(runPrompt).mockResolvedValueOnce(policyBrokenThread).mockResolvedValueOnce(validThread)

    const result = await generateNativeContent(client, makeCtx(), threadInput())

    expect(result).toEqual(validThread)
    expect(runPrompt).toHaveBeenCalledTimes(2)
    const secondCallInput = vi.mocked(runPrompt).mock.calls[1][2] as { correctionNote?: string }
    expect(secondCallInput.correctionNote).toMatch(/hook/)
  })

  it('THE CEILING: two consecutive invalid_response failures — runPrompt called EXACTLY TWICE, NOT three times, and the original error propagates unchanged', async () => {
    const secondFailure = new AiError('invalid_response', 'still not valid JSON')
    vi.mocked(runPrompt)
      .mockRejectedValueOnce(new AiError('invalid_response', 'not valid JSON'))
      .mockRejectedValueOnce(secondFailure)

    await expect(generateNativeContent(client, makeCtx(), singleInput())).rejects.toBe(secondFailure)
    expect(runPrompt).toHaveBeenCalledTimes(2)
  })

  it('THE CEILING (thread/policy variant): two consecutive policy_violation failures — runPrompt called EXACTLY TWICE, error propagates unchanged', async () => {
    // Both attempts return a policy-broken thread; validateThreadPolicy throws
    // on the SECOND one too, and that throw must NOT trigger a third attempt.
    vi.mocked(runPrompt).mockResolvedValueOnce(policyBrokenThread).mockResolvedValueOnce(policyBrokenThread)

    await expect(generateNativeContent(client, makeCtx(), threadInput())).rejects.toMatchObject({
      code: 'policy_violation',
    })
    expect(runPrompt).toHaveBeenCalledTimes(2)
  })

  it('a NON-retriable error (quota_exceeded) is NOT re-prompted: runPrompt called exactly ONCE, error propagates immediately', async () => {
    const quotaError = new AiError('quota_exceeded', 'Post generation trial limit reached')
    vi.mocked(runPrompt).mockRejectedValueOnce(quotaError)

    await expect(generateNativeContent(client, makeCtx(), singleInput())).rejects.toBe(quotaError)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('a NON-retriable error (provider_error / 5xx) is NOT re-prompted', async () => {
    const providerError = new AiError('provider_error', 'API server error 500')
    vi.mocked(runPrompt).mockRejectedValueOnce(providerError)

    await expect(generateNativeContent(client, makeCtx(), singleInput())).rejects.toBe(providerError)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('a non-AiError thrown by runPrompt propagates without a re-prompt', async () => {
    const genericError = new Error('unexpected crash')
    vi.mocked(runPrompt).mockRejectedValueOnce(genericError)

    await expect(generateNativeContent(client, makeCtx(), singleInput())).rejects.toBe(genericError)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('selects the thread family and validates policy on a single-attempt success', async () => {
    vi.mocked(runPrompt).mockResolvedValueOnce(validThread)
    const result = await generateNativeContent(client, makeCtx(), threadInput())
    expect(result).toEqual(validThread)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('low content-volume twitter input selects single, not thread', async () => {
    vi.mocked(runPrompt).mockResolvedValueOnce(validSingle)
    await generateNativeContent(client, makeCtx(), singleInput({ platform: 'twitter', estimatedTweetsWorth: 1 }))
    const promptArg = vi.mocked(runPrompt).mock.calls[0][0] as { id: string }
    expect(promptArg.id).toBe('native-generation-single')
  })
})
