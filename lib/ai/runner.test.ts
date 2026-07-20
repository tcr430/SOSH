import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      AI_RATE_LIMIT_BRAND_VOICE_PER_MIN: 10,
      AI_RATE_LIMIT_POST_GENERATION_PER_MIN: 30,
    },
  },
}))

vi.mock('@/lib/ai/client', () => ({
  getAnthropicClient: vi.fn(),
}))

vi.mock('@/lib/db/ai-usage', () => ({
  recordAiUsage: vi.fn().mockResolvedValue({}),
  countRecentCalls: vi.fn(),
}))

vi.mock('@/lib/db/trial-state', () => ({
  incrementBrandVoiceAttempts: vi.fn().mockResolvedValue(undefined),
  incrementPostsGenerated: vi.fn().mockResolvedValue(undefined),
}))

import { runPrompt } from './runner'
import { getAnthropicClient } from '@/lib/ai/client'
import { recordAiUsage, countRecentCalls } from '@/lib/db/ai-usage'
import { incrementBrandVoiceAttempts, incrementPostsGenerated } from '@/lib/db/trial-state'
import type { Prompt } from '@/lib/ai/prompts/types'
import type { CustomerContext } from '@/lib/ai/context'
// The REAL templates — MAJOR-1a asserts what each of them actually sends.
// mockPrompt below cannot serve that purpose: its buildUserMessage just
// echoes input.text and never touches the context.
import { postGenerationPrompt } from '@/lib/ai/prompts/post-generation'
import { postRegenerationPrompt } from '@/lib/ai/prompts/post-regeneration'
import { brandVoiceInferencePrompt } from '@/lib/ai/prompts/brand-voice-inference'
import type { BrandVoiceRow } from '@/lib/db/types'

// ── Fixtures ──────────────────────────────────────────────────────────────

const mockOutputSchema = z.object({ result: z.string() })
type MockOutput = { result: string }
type MockInput = { text: string }

const validOutput: MockOutput = { result: 'generated' }

const validSdkResponse = {
  content: [{ type: 'text', text: JSON.stringify(validOutput) }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
}

const mockPrompt: Prompt<MockInput, MockOutput> = {
  id: 'post-generation',
  version: 1,
  modelKey: 'SONNET_4_6',
  outputSchema: mockOutputSchema,
  buildSystemPrompt: () => 'Short system prompt.',
  buildUserMessage: (input) => input.text,
}

const brandVoicePrompt: Prompt<MockInput, MockOutput> = {
  ...mockPrompt,
  id: 'brand-voice-inference',
}

const mockContext: CustomerContext = {
  business: {
    id: 'biz-1',
    name: 'Acme',
    industry: 'SaaS',
    description: null,
    language: 'en',
    website: null,
    timezone: 'Europe/London',
  },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: {
    isTrial: true,
    postsRemaining: 10,
    campaignsRemaining: 1,
    brandVoiceAttemptsRemaining: 3,
  },
}

const paidContext: CustomerContext = { ...mockContext, trialState: null }

const trialExhaustedPosts: CustomerContext = {
  ...mockContext,
  trialState: { isTrial: true, postsRemaining: 0, campaignsRemaining: 0, brandVoiceAttemptsRemaining: 3 },
}

const trialExhaustedBrandVoice: CustomerContext = {
  ...mockContext,
  trialState: { isTrial: true, postsRemaining: 10, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 0 },
}

const mockCreate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
  mockCreate.mockResolvedValue(validSdkResponse)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
})

// ── Trial cap (Step 1) ────────────────────────────────────────────────────

describe('Step 1 — trial cap', () => {
  it('throws quota_exceeded when post generation cap is reached', async () => {
    await expect(runPrompt(mockPrompt, trialExhaustedPosts, { text: 'hi' })).rejects.toMatchObject({
      code: 'quota_exceeded',
    })
  })

  it('throws quota_exceeded when brand voice cap is reached', async () => {
    await expect(
      runPrompt(brandVoicePrompt, trialExhaustedBrandVoice, { text: 'hi' }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' })
  })

  it('does NOT call rate-limit query when trial cap is exceeded (step 1 fires first)', async () => {
    await expect(runPrompt(mockPrompt, trialExhaustedPosts, { text: 'hi' })).rejects.toBeDefined()
    expect(countRecentCalls).not.toHaveBeenCalled()
  })

  it('does NOT call SDK when trial cap is exceeded', async () => {
    await expect(runPrompt(mockPrompt, trialExhaustedPosts, { text: 'hi' })).rejects.toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does NOT write ai_usage row when trial cap is exceeded', async () => {
    await expect(runPrompt(mockPrompt, trialExhaustedPosts, { text: 'hi' })).rejects.toBeDefined()
    expect(recordAiUsage).not.toHaveBeenCalled()
  })

  it('allows paid plan through with no cap check', async () => {
    const result = await runPrompt(mockPrompt, paidContext, { text: 'hi' })
    expect(result).toEqual(validOutput)
  })
})

// ── Rate limit (Step 2) ───────────────────────────────────────────────────

describe('Step 2 — rate limit', () => {
  it('throws rate_limited when recent call count meets the limit', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(10) // equals brand-voice limit of 10
    await expect(runPrompt(brandVoicePrompt, mockContext, { text: 'hi' })).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('passes prompt.id to countRecentCalls for per-prompt rate limiting', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(countRecentCalls).toHaveBeenCalledWith(
      expect.anything(),
      'biz-1',
      60,
      'post-generation',
    )
  })

  it('does NOT call SDK when rate limited', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(99)
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).rejects.toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does NOT write ai_usage row when rate limited', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(99)
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).rejects.toBeDefined()
    expect(recordAiUsage).not.toHaveBeenCalled()
  })
})

// ── SDK call and retry (Step 4) ───────────────────────────────────────────

describe('Step 4 — SDK call and retry', () => {
  it('returns parsed output on a clean first-call success', async () => {
    const result = await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(result).toEqual(validOutput)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('retries exactly once on 429, succeeds on second call', async () => {
    vi.useFakeTimers()
    try {
      mockCreate
        .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
        .mockResolvedValueOnce(validSdkResponse)
      const promise = runPrompt(mockPrompt, mockContext, { text: 'hello' })
      await vi.runAllTimersAsync()
      await expect(promise).resolves.toEqual(validOutput)
      expect(mockCreate).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries exactly once on 5xx, succeeds on second call', async () => {
    vi.useFakeTimers()
    try {
      mockCreate
        .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
        .mockResolvedValueOnce(validSdkResponse)
      const promise = runPrompt(mockPrompt, mockContext, { text: 'hello' })
      await vi.runAllTimersAsync()
      await expect(promise).resolves.toEqual(validOutput)
      expect(mockCreate).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT retry a third time when both calls fail on 429', async () => {
    vi.useFakeTimers()
    try {
      mockCreate
        .mockRejectedValueOnce({ status: 429 })
        .mockRejectedValueOnce({ status: 429 })
      const promise = runPrompt(mockPrompt, mockContext, { text: 'hello' })
      // Prevent unhandled-rejection warning while timers are pending
      promise.catch(() => undefined)
      await vi.runAllTimersAsync()
      await expect(promise).rejects.toBeDefined()
      expect(mockCreate).toHaveBeenCalledTimes(2) // exactly 2, not 3
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT retry on parse failure (invalid_response)', async () => {
    mockCreate.mockResolvedValue({
      ...validSdkResponse,
      content: [{ type: 'text', text: 'not json at all' }],
    })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hello' })).rejects.toMatchObject({
      code: 'invalid_response',
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

// ── ai_usage (Step 7) ─────────────────────────────────────────────────────

describe('Step 7 — ai_usage recording', () => {
  it('writes ai_usage row with success=true on clean call', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-1',
        prompt_id: 'post-generation',
        success: true,
        error_code: null,
      }),
    )
  })

  it('stores input_tokens as raw total including cache_read_input_tokens (ADR §10)', async () => {
    mockCreate.mockResolvedValue({
      ...validSdkResponse,
      usage: { input_tokens: 80, output_tokens: 50, cache_read_input_tokens: 20 },
    })
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ input_tokens: 100 }), // 80 + 20
    )
  })

  it('writes ai_usage row with success=false on parse failure', async () => {
    mockCreate.mockResolvedValue({
      ...validSdkResponse,
      content: [{ type: 'text', text: 'not json' }],
    })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hello' })).rejects.toBeDefined()
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error_code: 'invalid_response' }),
    )
  })

  it('writes ai_usage row with success=false on SDK error', async () => {
    mockCreate.mockRejectedValue({ status: 500, message: 'Server error' })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hello' })).rejects.toBeDefined()
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    )
  })
})

// ── Trial counter (Step 8) ────────────────────────────────────────────────

describe('Step 8 — trial counter', () => {
  it('increments brand_voice_inference_attempts on brand-voice success', async () => {
    await runPrompt(brandVoicePrompt, mockContext, { text: 'hello' })
    expect(incrementBrandVoiceAttempts).toHaveBeenCalledWith('biz-1')
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
  })

  it('does NOT increment posts_generated_count for post-generation (R-1: orchestrator owns this)', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
    expect(incrementBrandVoiceAttempts).not.toHaveBeenCalled()
  })

  it('does NOT increment trial counter on failure', async () => {
    mockCreate.mockRejectedValue({ status: 500 })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hello' })).rejects.toBeDefined()
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
    expect(incrementBrandVoiceAttempts).not.toHaveBeenCalled()
  })

  it('does NOT increment trial counter for paid plan', async () => {
    await runPrompt(mockPrompt, paidContext, { text: 'hello' })
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
    expect(incrementBrandVoiceAttempts).not.toHaveBeenCalled()
  })
})

// ── Cache control (Step 3) ────────────────────────────────────────────────

describe('Step 3 — cache_control', () => {
  it('applies cache_control to system prompt exceeding 1024 tokens (~4096 chars)', async () => {
    const longPrompt: Prompt<MockInput, MockOutput> = {
      ...mockPrompt,
      buildSystemPrompt: () => 'x'.repeat(4097),
    }
    await runPrompt(longPrompt, mockContext, { text: 'hello' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('does NOT apply cache_control to short system prompts', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system[0].cache_control).toBeUndefined()
  })
})

// ── Context assembly — no raw JSON dump (B4, ADR 0016 §7, L-8) ────────────

describe('Step 3 — context assembly (no raw JSON.stringify(context) dump)', () => {
  it('sends exactly ONE user text block (buildUserMessage output), not two', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toHaveLength(1)
    expect(callArgs.messages[0].content[0]).toEqual({ type: 'text', text: 'hello' })
  })

  it('the user message does NOT contain a JSON.stringify(context) dump of the full context object', async () => {
    // If the dump were still present, a field unique to CustomerContext but
    // absent from mockPrompt's trivial buildUserMessage (which just echoes
    // input.text) would leak into the request — e.g. the business id.
    await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    const callArgs = mockCreate.mock.calls[0][0]
    const sentText = callArgs.messages[0].content[0].text as string
    expect(sentText).not.toContain(mockContext.business.id)
    expect(sentText).not.toContain('"trialState"')
  })

  // NOTE: a case named "generation output is fixture-identical after removing
  // the dump (bounds the change to L-7)" stood here and was DELETED in
  // Session 23-D (MAJOR-1a). Its own comment explained why it could not fail:
  // the mock routes on _sosh.promptId/model, NOT on message content, so the
  // parsed OUTPUT is unaffected by what rides in the request BY CONSTRUCTION.
  // It would have stayed green if B4 had deleted the entire user message. It
  // was offered as proof of behaviour-equivalence and proved nothing.
  // Its replacement — assertions over the REQUEST ACTUALLY SENT, per real
  // template — is the final describe block in this file.

  it('the retrieved (per-call) slice rides the UNCACHED user message, and the stable slice rides the CACHED system block — they do not cross', async () => {
    const STABLE_MARKER = 'STABLE-BUSINESS-IDENTITY-MARKER'
    const RETRIEVED_MARKER = 'RETRIEVED-PERFORMANCE-PATTERN-MARKER'

    const splitPrompt: Prompt<MockInput, MockOutput> = {
      ...mockPrompt,
      // Padded past CACHE_CONTROL_CHAR_THRESHOLD so cache_control actually
      // applies — proving the split matters where the token economics pay
      // off, not just in a short prompt that skips caching entirely.
      buildSystemPrompt: () => `${STABLE_MARKER} ${'x'.repeat(4200)}`,
      buildUserMessage: () => RETRIEVED_MARKER,
    }

    await runPrompt(splitPrompt, mockContext, { text: 'hello' })
    const callArgs = mockCreate.mock.calls[0][0]

    const systemText = callArgs.system[0].text as string
    const userText = callArgs.messages[0].content[0].text as string

    expect(systemText).toContain(STABLE_MARKER)
    expect(systemText).not.toContain(RETRIEVED_MARKER)
    expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' })

    expect(userText).toContain(RETRIEVED_MARKER)
    expect(userText).not.toContain(STABLE_MARKER)
    // The user message carries no cache_control of its own — it is the
    // uncached per-call slice, never entering the cached prefix.
    expect(callArgs.messages[0].content[0].cache_control).toBeUndefined()
  })
})

// ── MAJOR-1a: what actually reaches the MODEL, per real template ──────────
//
// B4 deleted `JSON.stringify(context)` from the first user message. Before
// that, ALL FIVE CustomerContext fields reached the model on every call,
// regardless of which template was running. After it, each prompt sees only
// what it explicitly renders — a real change to model input, adopted under a
// comment asserting it was "not a behaviour change".
//
// These cases pin the resulting narrowing as INTENTIONAL and redden on drift
// in EITHER direction: a field silently dropped from a template, or the raw
// dump silently returning.
//
// Method: each context field carries a unique SENTINEL string, so presence /
// absence is unambiguous and independent of how a template phrases its
// section headings. Assertions run over system[0].text + the user message —
// i.e. everything the model receives.
describe('Step 3 — per-template model input (MEM-RUNNER-CACHE-SPLIT, MAJOR-1a)', () => {
  const S = {
    business: 'SENTINEL-BUSINESS-NAME',
    voice: 'SENTINEL-VOICE-DESCRIPTOR',
    campaign: 'SENTINEL-RECENT-CAMPAIGN',
    performance: 'SENTINEL-PERFORMANCE-SNIPPET',
    // trialState holds only numbers, so its sentinel is a distinctive value.
    trial: '4242',
  }

  const sentinelVoice: BrandVoiceRow & { readonly descriptor: string } = {
    id: 'bv-1',
    business_id: 'biz-1',
    voice_axes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
    tone: ['professional'],
    target_audience: 'B2B SaaS founders',
    keywords: ['growth'],
    avoid_words: [],
    writing_examples: [],
    competitors: [],
    unique_value_prop: 'The best',
    inferred_from_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    descriptor: S.voice,
  }

  const sentinelContext: CustomerContext = {
    business: {
      id: 'biz-1',
      name: S.business,
      industry: 'SaaS',
      description: null,
      language: 'en',
      website: null,
      timezone: 'Europe/London',
    },
    brandVoice: sentinelVoice,
    recentCampaigns: [{ id: 'camp-9', name: S.campaign, objective: 'Recent objective', status: 'active' }],
    // likes/impressions deliberately NOT 4242 — they must not collide with
    // the trialState sentinel.
    recentPostPerformance: [{ platform: 'linkedin', topContent: S.performance, likes: 7, impressions: 8 }],
    trialState: { isTrial: true, postsRemaining: 4242, campaignsRemaining: 4242, brandVoiceAttemptsRemaining: 4242 },
  }

  // The campaign passed as INPUT is deliberately named differently from the
  // recentCampaigns sentinel — otherwise a template rendering only the input
  // campaign would look like it rendered recentCampaigns.
  const inputCampaign = {
    id: 'camp-input',
    name: 'INPUT-CAMPAIGN-NOT-A-SENTINEL',
    objective: 'Input objective',
    special_instructions: null,
    platforms: ['linkedin' as const],
    frequency: 'weekly' as const,
    posts_per_week: 1,
    start_date: '2026-08-01',
    end_date: null,
  }

  async function requestFor<I, O>(prompt: Prompt<I, O>, input: I, output: unknown) {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(output) }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })
    await runPrompt(prompt, sentinelContext, input)
    const callArgs = mockCreate.mock.calls[0][0]
    const system = callArgs.system[0].text as string
    const user = callArgs.messages[0].content[0].text as string
    return `${system}\n${user}`
  }

  const postGenerationOutput = {
    posts: [{ content: 'c', hashtags: [], scheduledAt: '2026-08-01T10:00:00Z', rationale: 'a valid rationale string' }],
  }
  const postRegenerationOutput = { content: 'c', hashtags: [], rationale: 'a valid rationale string' }
  const brandVoiceOutput = {
    tone: ['professional'],
    targetAudience: 'B2B SaaS founders and marketing teams',
    keywords: ['growth', 'pipeline', 'retention'],
    avoidWords: [],
    uniqueValueProp: 'We help B2B SaaS teams ship content faster.',
    competitors: [],
    voiceAxes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
  }

  it('post-generation sends business + brandVoice + recentCampaigns + recentPostPerformance, but NOT trialState', async () => {
    const sent = await requestFor(
      postGenerationPrompt,
      {
        campaign: inputCampaign,
        targetPlatform: 'linkedin' as const,
        postsToGenerate: 1,
        scheduledDates: ['2026-08-01T10:00:00Z'],
        alreadyGeneratedTopics: [],
      },
      postGenerationOutput,
    )

    expect(sent).toContain(S.business)
    expect(sent).toContain(S.voice)
    expect(sent).toContain(S.campaign)
    expect(sent).toContain(S.performance)
    // trialState is a BILLING/quota concern enforced in runner Step 1. It was
    // only ever in the prompt because the raw dump swept it in; the model has
    // no use for it and it is not re-added.
    expect(sent).not.toContain(S.trial)
  })

  it('post-regeneration sends business + brandVoice + recentCampaigns + recentPostPerformance, but NOT trialState', async () => {
    const sent = await requestFor(
      postRegenerationPrompt,
      {
        postId: 'post-1',
        previousContent: 'previous content',
        previousRationale: 'previous rationale',
        previousHashtags: [],
        feedbackNote: 'make it punchier',
        campaign: {
          id: inputCampaign.id,
          name: inputCampaign.name,
          objective: inputCampaign.objective,
          special_instructions: null,
        },
        targetPlatform: 'linkedin' as const,
        scheduledAt: '2026-08-01T10:00:00Z',
        siblingPostsTopics: [],
      },
      postRegenerationOutput,
    )

    expect(sent).toContain(S.business)
    expect(sent).toContain(S.voice)
    // MAJOR-1b, founder-adjudicated as RESTORE. B4 removed these two from
    // regeneration's view as a side effect of deleting the JSON dump, under a
    // comment asserting no behaviour change. They are now rendered explicitly
    // by post-regeneration.ts, which makes that claim true and keeps
    // regeneration's context aligned with post-generation's — the two
    // templates do the same job.
    expect(sent).toContain(S.campaign)
    expect(sent).toContain(S.performance)
    // trialState stays gone on every template: a quota concern enforced in
    // runner Step 1, of no use to the model. It was only ever present because
    // the dump swept it in.
    expect(sent).not.toContain(S.trial)
  })

  it('brand-voice-inference sends business ONLY — no brandVoice, recentCampaigns, recentPostPerformance or trialState', async () => {
    const sent = await requestFor(
      brandVoiceInferencePrompt,
      { writingExamples: ['an example of our writing'], websiteText: null },
      brandVoiceOutput,
    )

    expect(sent).toContain(S.business)
    // Inferring a voice from writing samples must not be primed by the voice
    // already on file — that would bias the inference toward the existing
    // record instead of the evidence.
    expect(sent).not.toContain(S.voice)
    expect(sent).not.toContain(S.campaign)
    expect(sent).not.toContain(S.performance)
    expect(sent).not.toContain(S.trial)
  })

  it('no template receives a raw JSON dump of the context object', async () => {
    const sent = await requestFor(
      postGenerationPrompt,
      {
        campaign: inputCampaign,
        targetPlatform: 'linkedin' as const,
        postsToGenerate: 1,
        scheduledDates: ['2026-08-01T10:00:00Z'],
        alreadyGeneratedTopics: [],
      },
      postGenerationOutput,
    )

    // The dump's tell is CustomerContext's own key names, which no template
    // renders as prose.
    expect(sent).not.toContain('"recentPostPerformance"')
    expect(sent).not.toContain('"trialState"')
    expect(sent).not.toContain('"brandVoice"')
  })
})
