import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
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

import {
  runToolLoop,
  TRIAGE_MAX_TOOL_CALLS,
  TRIAGE_RETRY_BUDGET,
  type TriageTool,
} from './tool-runner'
import { getAnthropicClient } from '@/lib/ai/client'
import { recordAiUsage, countRecentCalls } from '@/lib/db/ai-usage'
import type { CustomerContext } from '@/lib/ai/context'

const FIXTURES_DIR = path.join(process.cwd(), 'lib', 'signals', '__fixtures__', 'triage')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadFixture(name: string): any {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8'))
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
  trialState: { isTrial: true, postsRemaining: 10, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 3 },
}

const trialExhausted: CustomerContext = {
  ...mockContext,
  trialState: { isTrial: true, postsRemaining: 0, campaignsRemaining: 0, brandVoiceAttemptsRemaining: 3 },
}

const listEvidenceTool: TriageTool = {
  name: 'list_evidence',
  description: 'List evidence memory candidates.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: vi.fn().mockResolvedValue([{ id: 'ev-1', content: 'test evidence' }]),
}

const mockCreate = vi.fn()

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): clears queued mockResolvedValueOnce/
  // mockRejectedValueOnce values too — without this, a test whose loop
  // fails BEFORE calling mockCreate (e.g. the wall-clock case) leaves its
  // queued fixture to leak into the next test's first call.
  vi.resetAllMocks()
  mockCreate.mockReset()
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  vi.mocked(recordAiUsage).mockResolvedValue({} as never)
  listEvidenceTool.execute = vi.fn().mockResolvedValue([{ id: 'ev-1', content: 'test evidence' }])
})

function baseInput(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  return {
    context: mockContext,
    systemPrompt: 'Short system prompt.',
    userMessage: 'A release happened.',
    tools: [listEvidenceTool],
    ...overrides,
  }
}

describe('runToolLoop (ADR 0021 §2, Session 28 E5.4)', () => {
  it('returns a decision on a single no-tools turn', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({
      outcome: 'decision',
      decision: {
        verdict: 'card',
        reason: 'Notable SSO release.',
        citableEvidenceIds: ['ev-1'],
        citableBrandIds: [],
        audienceNote: 'Enterprise IT buyers.',
      },
    })
  })

  it('dispatches a tool call, feeds the result back, and reaches a decision', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-no-card'))

    const result = await runToolLoop(baseInput())

    expect(result.outcome).toBe('decision')
    expect(listEvidenceTool.execute).toHaveBeenCalledWith({ query: 'SSO' })
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  // ─── Pre-flight (shared with runPrompt) ───────────────────────────────────

  it('fails closed with quota_exceeded when the trial cap is spent — no SDK call made', async () => {
    const result = await runToolLoop(baseInput({ context: trialExhausted }))

    expect(result).toEqual({ outcome: 'failed', reason: 'quota_exceeded' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('fails closed with rate_limited when countRecentCalls is at the ceiling — no SDK call made', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(30)

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'rate_limited' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // ─── Each bound breached in its own case, each producing zero cards ──────
  // (the loop never writes to the DB by construction — no insight_cards or
  // signal_candidates reference anywhere in tool-runner.ts, see the source
  // scan below)

  it('TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS: fails closed with input_token_cap_exceeded', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('oversized-input-tokens'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'input_token_cap_exceeded' })
  })

  it('TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN: fails closed with output_token_per_turn_exceeded', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('oversized-output-per-turn'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'output_token_per_turn_exceeded' })
  })

  it('TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS: fails closed with output_token_cap_exceeded once turns sum past it', async () => {
    // Each turn is 1000 output tokens (under the 1024 per-turn cap); five
    // turns cross the 4000 cumulative cap.
    for (let i = 0; i < 5; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-heavy-output'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'output_token_cap_exceeded' })
  })

  it('response_truncated: fails closed when stop_reason is max_tokens', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('truncated'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'response_truncated' })
  })

  it('invalid_response: fails closed when the decision text is not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('invalid-json-decision'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'invalid_response' })
  })

  it('TRIAGE_MAX_TURNS: fails closed with max_turns_exceeded when every turn is spent on tool calls with no decision', async () => {
    for (let i = 0; i < 6; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'max_turns_exceeded' })
    expect(mockCreate).toHaveBeenCalledTimes(6)
  })

  it('TRIAGE_MAX_TOOL_CALLS: tools are withheld once the cap is spent, forcing a no-tools decision turn', async () => {
    for (let i = 0; i < TRIAGE_MAX_TOOL_CALLS; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

    const result = await runToolLoop(baseInput())

    expect(result.outcome).toBe('decision')
    expect(listEvidenceTool.execute).toHaveBeenCalledTimes(TRIAGE_MAX_TOOL_CALLS)
    // The 5th (final) call must not have offered tools.
    const fifthCallParams = mockCreate.mock.calls[4]?.[0]
    expect(fifthCallParams.tools).toBeUndefined()
  })

  it('wall_clock: fails closed with wall_clock_exceeded once elapsed time exceeds the bound', async () => {
    const realNow = Date.now
    let call = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      call += 1
      // First call establishes startTime; every subsequent call reports
      // elapsed time already past TRIAGE_MAX_WALL_CLOCK_MS (45_000).
      return call === 1 ? realNow() : realNow() + 100_000
    })
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'wall_clock_exceeded' })
    expect(mockCreate).not.toHaveBeenCalled()

    vi.spyOn(Date, 'now').mockRestore()
  })

  // ─── Retry budget (§2.7) ────────────────────────────────────────────────

  it(`TRIAGE_RETRY_BUDGET (${TRIAGE_RETRY_BUDGET}): exhausting the shared retry pool fails closed with retry_budget_exhausted`, async () => {
    mockCreate.mockRejectedValue({ status: 429, message: 'rate limited' })

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'retry_budget_exhausted' })
    // 1 initial attempt + TRIAGE_RETRY_BUDGET retries, all against the same turn.
    expect(mockCreate).toHaveBeenCalledTimes(1 + TRIAGE_RETRY_BUDGET)
  }, 15000)

  it('a transient error recovers within the retry budget and still reaches a decision', async () => {
    mockCreate.mockRejectedValueOnce({ status: 503, message: 'server error' })
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

    const result = await runToolLoop(baseInput())

    expect(result.outcome).toBe('decision')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  }, 15000)

  // ─── A malformed tool block consumes the spare turn ────────────────────

  it('a malformed/unknown tool block is absorbed by a spare turn rather than failing closed immediately', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-unknown'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

    const result = await runToolLoop(baseInput())

    expect(result.outcome).toBe('decision')
    expect(mockCreate).toHaveBeenCalledTimes(2)
    // The unknown tool never executed, and toolCallsUsed was not consumed —
    // the second call still offers tools.
    expect(listEvidenceTool.execute).not.toHaveBeenCalled()
    const secondCallParams = mockCreate.mock.calls[1]?.[0]
    expect(secondCallParams.tools).toBeDefined()
  })

  // ─── ai_usage: cumulative, written once, even on failure ──────────────

  it('records exactly one cumulative ai_usage row per loop, across multiple turns', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

    await runToolLoop(baseInput())

    expect(recordAiUsage).toHaveBeenCalledTimes(1)
    const call = vi.mocked(recordAiUsage).mock.calls[0][0]
    expect(call.input_tokens).toBe(3400 + 3400)
    expect(call.output_tokens).toBe(120 + 120)
    expect(call.success).toBe(true)
  })

  it('still writes ai_usage on a fail-closed outcome (success: false)', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('oversized-input-tokens'))

    await runToolLoop(baseInput())

    expect(recordAiUsage).toHaveBeenCalledTimes(1)
    const call = vi.mocked(recordAiUsage).mock.calls[0][0]
    expect(call.success).toBe(false)
    expect(call.error_code).toBe('input_token_cap_exceeded')
  })

  it('quota_exceeded and rate_limited never write ai_usage — no SDK call was attempted', async () => {
    await runToolLoop(baseInput({ context: trialExhausted }))
    expect(recordAiUsage).not.toHaveBeenCalled()
  })
})
