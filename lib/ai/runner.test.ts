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
// D2/MAJOR-1 — the REAL native-generation factory, not a synthetic prompt
// with a copied id: the constraint is about the actual generation path
// sending temperature at the SDK level, and a synthetic prompt would pass
// even if the factory stopped declaring it.
import { createNativeGenerationPrompt, type NativeGenInput } from '@/lib/ai/prompts/formats/native-generation-prompt'
import type { RenderedEvidence } from '@/lib/ai/wrap-evidence'

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

// B2.6 BLOCKER fix — these must ALSO skip Step 8, exactly like post-generation.
const nativeGenerationSinglePrompt: Prompt<MockInput, MockOutput> = {
  ...mockPrompt,
  id: 'native-generation-single',
}
const nativeGenerationThreadPrompt: Prompt<MockInput, MockOutput> = {
  ...mockPrompt,
  id: 'native-generation-thread',
}
const rubricScoringPrompt: Prompt<MockInput, MockOutput> = {
  ...mockPrompt,
  id: 'rubric',
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

  // D2 (Session 30-D, MAJOR-1 + A-8) — extractJsonBlock's balanced-brace
  // fallback (lib/ai/parsers.ts, G1b.13) changed safeParseOrAiError's
  // behaviour for EVERY runPrompt caller — Mode 1/2 post generation among
  // them — but this caller had no test pinning the new semantics
  // (AUTHORED-NOT-EXECUTED per the Reviewer). These two cases close that.
  it('D2 — prose-prefixed output now parses via the balanced-brace fallback, not invalid_response', async () => {
    mockCreate.mockResolvedValue({
      ...validSdkResponse,
      content: [{ type: 'text', text: 'Here is the result you asked for:\n\n{"result":"generated"}' }],
    })
    const result = await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(result).toEqual(validOutput)
  })

  it('D2 — two concatenated JSON objects resolve to the FIRST object, the second is silently discarded', async () => {
    mockCreate.mockResolvedValue({
      ...validSdkResponse,
      content: [{ type: 'text', text: '{"result":"first"}{"result":"second"}' }],
    })
    const result = await runPrompt(mockPrompt, mockContext, { text: 'hello' })
    expect(result).toEqual({ result: 'first' })
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

  // B2.6 BLOCKER fix — native-generation-* prompt ids match neither
  // isBrandVoice nor (pre-fix) isPostGeneration, so every native-generation
  // call AND every hook-loop rubric-scoring call was ALSO incrementing
  // posts_generated_count on top of generate.ts's own batch increment
  // (STEP 11) — silently over-counting trial quota 3-4x. These three tests
  // prove the fix: NEITHER counter fires for any of these prompt ids.
  it('does NOT increment posts_generated_count for native-generation-single (B2.6 BLOCKER fix)', async () => {
    await runPrompt(nativeGenerationSinglePrompt, mockContext, { text: 'hello' })
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
    expect(incrementBrandVoiceAttempts).not.toHaveBeenCalled()
  })

  it('does NOT increment posts_generated_count for native-generation-thread (B2.6 BLOCKER fix)', async () => {
    await runPrompt(nativeGenerationThreadPrompt, mockContext, { text: 'hello' })
    expect(incrementPostsGenerated).not.toHaveBeenCalled()
    expect(incrementBrandVoiceAttempts).not.toHaveBeenCalled()
  })

  it('does NOT increment EITHER trial counter for a rubric scoring call (B2.6 BLOCKER fix)', async () => {
    await runPrompt(rubricScoringPrompt, mockContext, { text: 'hello' })
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

// ── STUDIO-RUNNER-DEFAULT-PRESERVED (ADR 0019 §4.5, founder ruling A-5's
// CONDITION) — "an optional field with the existing 4096 default preserved
// is not a Mode 2 behaviour change... on the condition that the promised
// regression test is actually written, since that's the only thing making
// the claim true." Two halves, together: (1) every REAL existing prompt
// object leaves maxTokens unset (static); (2) an unset maxTokens resolves
// to EXACTLY DEFAULT_MAX_TOKENS=4096 at the SDK call site (behavioural).
describe('STUDIO-RUNNER-DEFAULT-PRESERVED (ADR 0019 §4.5 / A-5)', () => {
  it('none of the OTHER existing prompt objects sets maxTokens — the SHARED-FUNCTION CALLERS table for runPrompt, one row per prompt', async () => {
    const { postGenerationPrompt: pg } = await import('@/lib/ai/prompts/post-generation')
    const { postRegenerationPrompt: pr } = await import('@/lib/ai/prompts/post-regeneration')
    const { rubricPrompt } = await import('@/lib/ai/prompts/rubric')
    const { learningSummarizerPrompt } = await import('@/lib/ai/prompts/learning-summarizer')
    const { brandVoiceInferencePrompt: bv } = await import('@/lib/ai/prompts/brand-voice-inference')
    const { createNativeGenerationPrompt } = await import('@/lib/ai/prompts/formats/native-generation-prompt')

    // Caller table — every existing runPrompt call site's prompt object:
    //   post-generation.ts (lib/campaigns/generate.ts)
    //   post-regeneration.ts (app/.../posts/actions.ts)
    //   rubric.ts (lib/campaigns/generate.ts, lib/campaigns/brief.ts)
    //   learning-summarizer.ts (lib/learning/summarize.ts)
    //   brand-voice-inference.ts (onboarding/infer-brand-voice, settings/voice/refine-from-posts)
    //   native-generation-prompt.ts ×2 families (lib/campaigns/generate.ts)
    // brief-assembly is EXCLUDED here as of ADR 0024 §3.3a (H2.2) — it now
    // legitimately declares maxTokens: 12_000 alongside its thinking budget.
    // See QUAL-THINKING-BUDGETED below, which asserts that value directly.
    const prompts = [pg, pr, rubricPrompt, learningSummarizerPrompt, bv, createNativeGenerationPrompt('single'), createNativeGenerationPrompt('thread')]
    expect(prompts).toHaveLength(7)
    for (const prompt of prompts) {
      expect(prompt.maxTokens).toBeUndefined()
    }
  })

  it('an unset maxTokens resolves to EXACTLY 4096 at the SDK call site', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hi' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.max_tokens).toBe(4096)
  })

  it('a prompt that DOES set maxTokens overrides the default (proves the ?? actually reads prompt.maxTokens, not a constant)', async () => {
    const withMaxTokens: Prompt<MockInput, MockOutput> = { ...mockPrompt, maxTokens: 8192 }
    await runPrompt(withMaxTokens, mockContext, { text: 'hi' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.max_tokens).toBe(8192)
  })
})

// ── QUAL-THINKING-BUDGETED (ADR 0024 §3.3/§3.3a, H2.2) ─────────────────────
// Sibling of STUDIO-RUNNER-DEFAULT-PRESERVED immediately above: brief-
// assembly is the ONE prompt that declares thinking, and it must declare
// maxTokens: 12_000 in the SAME version bump (a thinking budget is spent
// OUT OF maxTokens, not additive — §3.3a). Every other id stays undeclared.
// The two sets (native-generation's temperature, brief-assembly's thinking)
// are disjoint by construction — asserted here so a future prompt cannot
// silently acquire both.
describe('QUAL-THINKING-BUDGETED (ADR 0024 §3.3/§3.3a)', () => {
  it('brief-assembly declares thinking:4000 AND maxTokens:12_000 at version:2', async () => {
    const { briefAssemblyPrompt } = await import('@/lib/ai/prompts/brief')
    expect(briefAssemblyPrompt.version).toBe(2)
    expect(briefAssemblyPrompt.thinking).toBe(4000)
    expect(briefAssemblyPrompt.maxTokens).toBe(12_000)
  })

  it('no other of the ten prompt ids declares thinking', async () => {
    const { postGenerationPrompt: pg } = await import('@/lib/ai/prompts/post-generation')
    const { postRegenerationPrompt: pr } = await import('@/lib/ai/prompts/post-regeneration')
    const { rubricPrompt } = await import('@/lib/ai/prompts/rubric')
    const { learningSummarizerPrompt } = await import('@/lib/ai/prompts/learning-summarizer')
    const { brandVoiceInferencePrompt: bv } = await import('@/lib/ai/prompts/brand-voice-inference')
    const { studioSuggestionPrompt } = await import('@/lib/ai/prompts/studio-suggestion')
    const { createNativeGenerationPrompt } = await import('@/lib/ai/prompts/formats/native-generation-prompt')

    const others = [
      pg,
      pr,
      rubricPrompt,
      learningSummarizerPrompt,
      bv,
      studioSuggestionPrompt,
      createNativeGenerationPrompt('single'),
      createNativeGenerationPrompt('thread'),
      createNativeGenerationPrompt('carousel'),
    ]
    expect(others).toHaveLength(9)
    for (const prompt of others) {
      expect(prompt.thinking, `${prompt.id} must not declare thinking`).toBeUndefined()
    }
  })

  it('no prompt declares BOTH temperature and thinking — the two sets stay disjoint', async () => {
    const { briefAssemblyPrompt } = await import('@/lib/ai/prompts/brief')
    const { postGenerationPrompt: pg } = await import('@/lib/ai/prompts/post-generation')
    const { postRegenerationPrompt: pr } = await import('@/lib/ai/prompts/post-regeneration')
    const { rubricPrompt } = await import('@/lib/ai/prompts/rubric')
    const { learningSummarizerPrompt } = await import('@/lib/ai/prompts/learning-summarizer')
    const { brandVoiceInferencePrompt: bv } = await import('@/lib/ai/prompts/brand-voice-inference')
    const { studioSuggestionPrompt } = await import('@/lib/ai/prompts/studio-suggestion')
    const { createNativeGenerationPrompt } = await import('@/lib/ai/prompts/formats/native-generation-prompt')

    const all = [
      briefAssemblyPrompt,
      pg,
      pr,
      rubricPrompt,
      learningSummarizerPrompt,
      bv,
      studioSuggestionPrompt,
      createNativeGenerationPrompt('single'),
      createNativeGenerationPrompt('thread'),
      createNativeGenerationPrompt('carousel'),
    ]
    expect(all).toHaveLength(10)
    for (const prompt of all) {
      const hasBoth = prompt.temperature !== undefined && prompt.thinking !== undefined
      expect(hasBoth, `${prompt.id} declares both temperature and thinking`).toBe(false)
    }
  })

  it('a thinking block followed by a text block parses exactly as a text-only response would', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'reasoning about the brief...' },
        { type: 'text', text: JSON.stringify(validOutput) },
      ],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).resolves.toEqual(validOutput)
  })

  it('a thinking budget is sent in the SDK thinking-block form, and omitted entirely when unset', async () => {
    const withThinking: Prompt<MockInput, MockOutput> = { ...mockPrompt, thinking: 4000, maxTokens: 12_000 }
    await runPrompt(withThinking, mockContext, { text: 'hi' })
    let callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 })

    await runPrompt(mockPrompt, mockContext, { text: 'hi' })
    callArgs = mockCreate.mock.calls[1][0]
    expect(callArgs).not.toHaveProperty('thinking')
  })
})

// ── QUAL-SAMPLING-DEFAULT-PRESERVED, the SDK-params half (ADR 0024 §3.1,
// Session 31-D D2/MAJOR-1) ──────────────────────────────────────────────
// Sibling of the maxTokens pair (:703-715) and the thinking pair (:799-808)
// immediately above, at the SAME level: the prompt-object field (asserted
// by prompt-properties.frozen-table.test.ts) is not the same claim as "the
// field arrives in the SDK call" — before this pair, nothing asserted the
// latter for temperature, so deleting runner.ts's temperature spread left
// every existing test green.
describe('QUAL-SAMPLING-DEFAULT-PRESERVED — temperature at the SDK params level (D2/MAJOR-1)', () => {
  const nativeGenInput: NativeGenInput = {
    angle: 'Show the churn-reduction proof point',
    role: 'customer_proof',
    platform: 'linkedin',
    narrative: 'We help B2B SaaS teams post consistently.',
    renderedEvidence: '' as RenderedEvidence,
    scheduledAt: '2026-08-01T09:00:00.000Z',
  }

  it('a native-generation prompt (temperature: 1.0) sends temperature 1.0 at the SDK params level', async () => {
    // The real prompt carries the real SinglePostOutputSchema — the mock
    // response must satisfy IT, not the generic mockOutputSchema every
    // other test in this file uses.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ format: 'single', body: 'post body', imageBrief: null }) }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })
    await runPrompt(createNativeGenerationPrompt('single'), mockContext, nativeGenInput)
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.temperature).toBe(1.0)
  })

  it('a prompt declaring no temperature sends NO temperature key at all — not undefined, absent', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hi' })
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('temperature')
  })
})

// ── ADR 0024 §7.1-§7.3 — the guards at N (Session 31 H2.6) ────────────────
//
// H2.6 ships no new production mechanism inside runPrompt — only the config
// default move (lib/config.test.ts) — so these are regression tests over
// what already holds true "by construction" (ADR §7.2/§7.3), guarding
// against a future change silently narrowing or reordering any of it.
describe('ADR 0024 §7.1-§7.3 — guards at N (H2.6)', () => {
  // QUAL-GUARD-ORDER-PRESERVED — STEP 1 (trial cap) fires strictly before
  // STEP 2 (rate limit), which fires strictly before STEP 3 (SDK call).
  // Composed from the two existing skip-on-earlier-failure assertions into
  // one test that states the ORDER explicitly, not just each pairwise skip.
  it('QUAL-GUARD-ORDER-PRESERVED — trial cap, then rate limit, then SDK call, in that order', async () => {
    // Trial cap denies -> neither the rate-limit query nor the SDK is reached.
    await expect(runPrompt(mockPrompt, trialExhaustedPosts, { text: 'hi' })).rejects.toMatchObject({
      code: 'quota_exceeded',
    })
    expect(countRecentCalls).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)

    // Trial cap clears, rate limit denies -> the SDK is still not reached.
    vi.mocked(countRecentCalls).mockResolvedValue(30)
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).rejects.toMatchObject({
      code: 'rate_limited',
    })
    expect(countRecentCalls).toHaveBeenCalledTimes(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // QUAL-RATE-LIMIT-COUNTS-CALLS — N runPrompt calls issue N separate
  // countRecentCalls checks (never batched/undercounted as one unit), and
  // generation vs. judge calls are counted under their OWN prompt id, never
  // merged into a shared bucket.
  it('QUAL-RATE-LIMIT-COUNTS-CALLS — three generation calls plus three judge calls are six separately-counted checks', async () => {
    for (let i = 0; i < 3; i++) {
      await runPrompt(mockPrompt, mockContext, { text: `gen-${i}` })
    }
    for (let i = 0; i < 3; i++) {
      await runPrompt(rubricScoringPrompt, mockContext, { text: `judge-${i}` })
    }

    expect(countRecentCalls).toHaveBeenCalledTimes(6)
    const promptIdsCounted = vi.mocked(countRecentCalls).mock.calls.map((call) => call[3])
    expect(promptIdsCounted.filter((id) => id === 'post-generation')).toHaveLength(3)
    expect(promptIdsCounted.filter((id) => id === 'rubric')).toHaveLength(3)
  })

  // QUAL-TRIAL-UNIT-PER-POST — the negative obligation: isPostGeneration and
  // isScoringOnly's membership must not be narrowed (every id below must
  // keep skipping BOTH trial counters), and the predicate set must not be
  // widened to swallow an unrelated prompt id (the control case below must
  // keep incrementing).
  it('QUAL-TRIAL-UNIT-PER-POST — the full skip set is exactly {native-generation-single, native-generation-thread, post-generation, rubric}, no more, no less', async () => {
    const skippedIds: Array<Prompt<MockInput, MockOutput>> = [
      mockPrompt, // post-generation
      nativeGenerationSinglePrompt,
      nativeGenerationThreadPrompt,
      rubricScoringPrompt,
    ]
    for (const prompt of skippedIds) {
      vi.clearAllMocks()
      vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
      mockCreate.mockResolvedValue(validSdkResponse)
      vi.mocked(countRecentCalls).mockResolvedValue(0)

      await runPrompt(prompt, mockContext, { text: 'hi' })
      expect(incrementPostsGenerated, `${prompt.id} must skip the per-call counter`).not.toHaveBeenCalled()
      expect(incrementBrandVoiceAttempts, `${prompt.id} must not touch brand-voice quota`).not.toHaveBeenCalled()
    }

    // Control: an id OUTSIDE the named set must still increment — proves the
    // predicates are narrow, not "skip everything."
    vi.clearAllMocks()
    vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
    mockCreate.mockResolvedValue(validSdkResponse)
    vi.mocked(countRecentCalls).mockResolvedValue(0)
    const unrelatedPrompt: Prompt<MockInput, MockOutput> = { ...mockPrompt, id: 'some-other-prompt' }
    await runPrompt(unrelatedPrompt, mockContext, { text: 'hi' })
    expect(incrementPostsGenerated).toHaveBeenCalledWith('biz-1')
  })
})

describe('response_truncated (ADR 0019 §5.4 [sec-HIGH-7])', () => {
  it('stop_reason === "max_tokens" throws response_truncated, distinct from invalid_response, and never reaches the parse step', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"incomplete json' }], // would otherwise fail as invalid_response
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).rejects.toMatchObject({
      code: 'response_truncated',
    })
  })

  it('a normal end_turn completion with valid JSON is unaffected', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ result: 'ok' }) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })
    await expect(runPrompt(mockPrompt, mockContext, { text: 'hi' })).resolves.toEqual({ result: 'ok' })
  })
})

// ADR 0024 §6 (Session 31, H2.10) — tool_use structured output, migrated for
// exactly one prompt (learningSummarizerPrompt). `toolPrompt` below stands
// in for it — same outputSchema/id shape as `mockPrompt`, `useToolOutput`
// added — so these tests exercise the runner's generic mechanism, not the
// real prompt's own copy.
describe('QUAL-STRUCTURED-OUTPUT / QUAL-MALFORMED-TOOL-CALL (ADR 0024 §6, H2.10)', () => {
  const toolPrompt: Prompt<MockInput, MockOutput> = {
    ...mockPrompt,
    id: 'learning-summarizer',
    useToolOutput: true,
  }

  it('QUAL-STRUCTURED-OUTPUT — sends a tool derived from the prompt\'s outputSchema, forces it via tool_choice, and parses the tool_use input through Zod', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'learning-summarizer_output', input: { result: 'from tool' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })

    const result = await runPrompt(toolPrompt, mockContext, { text: 'hi' })

    expect(result).toEqual({ result: 'from tool' })
    const sentParams = mockCreate.mock.calls[0][0]
    expect(sentParams.tool_choice).toEqual({ type: 'tool', name: 'learning-summarizer_output' })
    expect(sentParams.tools).toHaveLength(1)
    expect(sentParams.tools[0]).toMatchObject({ name: 'learning-summarizer_output' })
    expect(sentParams.tools[0].input_schema).toBeDefined()
  })

  it('a non-tool prompt never sends tools/tool_choice — the migration is per-prompt, not global', async () => {
    await runPrompt(mockPrompt, mockContext, { text: 'hi' })

    const sentParams = mockCreate.mock.calls[0][0]
    expect(sentParams.tools).toBeUndefined()
    expect(sentParams.tool_choice).toBeUndefined()
  })

  it('QUAL-MALFORMED-TOOL-CALL — no tool_use block in the response throws invalid_response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'the model ignored the tool' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })

    await expect(runPrompt(toolPrompt, mockContext, { text: 'hi' })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('QUAL-MALFORMED-TOOL-CALL — a tool_use block whose input fails Zod throws invalid_response carrying the Zod message', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'learning-summarizer_output', input: { result: 42 } }], // wrong type
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })

    await expect(runPrompt(toolPrompt, mockContext, { text: 'hi' })).rejects.toMatchObject({
      code: 'invalid_response',
      message: expect.stringContaining('Response schema validation failed'),
    })
  })

  it('QUAL-MALFORMED-TOOL-CALL — a response carrying BOTH a text block and a tool_use block: the tool_use block wins, and the mixed case logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify({ result: 'from text — must lose' }) },
        { type: 'tool_use', id: 'tu_1', name: 'learning-summarizer_output', input: { result: 'from tool — must win' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    })

    const result = await runPrompt(toolPrompt, mockContext, { text: 'hi' })

    expect(result).toEqual({ result: 'from tool — must win' })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('runner.mixed_tool_text_response'))
    logSpy.mockRestore()
  })
})
