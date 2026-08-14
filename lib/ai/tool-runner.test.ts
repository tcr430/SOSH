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
  TRIAGE_MAX_WALL_CLOCK_MS,
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
      costCents: expect.any(Number),
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

    expect(result).toEqual({ outcome: 'failed', reason: 'quota_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('fails closed with rate_limited when countRecentCalls is at the ceiling — no SDK call made', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(30)

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'rate_limited', costCents: expect.any(Number) })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // ─── Each bound breached in its own case, each producing zero cards ──────
  // (the loop never writes to the DB by construction — no insight_cards or
  // signal_candidates reference anywhere in tool-runner.ts, see the source
  // scan below)

  it('TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS: fails closed with input_token_cap_exceeded', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('oversized-input-tokens'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'input_token_cap_exceeded', costCents: expect.any(Number) })
  })

  it('TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN: fails closed with output_token_per_turn_exceeded', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('oversized-output-per-turn'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'output_token_per_turn_exceeded', costCents: expect.any(Number) })
  })

  it('TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS: fails closed with output_token_cap_exceeded once turns sum past it', async () => {
    // Each turn is 1000 output tokens (under the 1024 per-turn cap); five
    // turns cross the 4000 cumulative cap.
    for (let i = 0; i < 5; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-heavy-output'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'output_token_cap_exceeded', costCents: expect.any(Number) })
  })

  it('response_truncated: fails closed when stop_reason is max_tokens', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('truncated'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'response_truncated', costCents: expect.any(Number) })
  })

  it('invalid_response: fails closed when the decision text is not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('invalid-json-decision'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'invalid_response', costCents: expect.any(Number) })
  })

  it('TRIAGE_MAX_TURNS: fails closed with max_turns_exceeded when every turn is spent on tool calls with no decision', async () => {
    for (let i = 0; i < 6; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'max_turns_exceeded', costCents: expect.any(Number) })
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

    expect(result).toEqual({ outcome: 'failed', reason: 'wall_clock_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).not.toHaveBeenCalled()

    vi.spyOn(Date, 'now').mockRestore()
  })

  // ─── D6 (MAJOR-7) — TRIAGE_MAX_WALL_CLOCK_MS enforced INSIDE
  // callWithRetryBudget, not merely checked between turns ────────────────

  it('D6: a retryable failure that consumes ~all remaining budget is retried once (clamped), then the deadline is exhausted before a third attempt — returns wall_clock_exceeded within the bound, never a 3rd call', async () => {
    // Simulates a fixture that "times out twice": attempt 1 consumes 30s of
    // the 45s budget (leaving 15s, enough to fit RETRY_DELAY_MS so the retry
    // proceeds); attempt 2 is then clamped to the remaining 13s rather than
    // the full TRIAGE_REQUEST_TIMEOUT_MS, and consumes all of it, leaving 0ms
    // — not enough to fit another RETRY_DELAY_MS, so the loop fails closed
    // instead of attempting a 3rd call. Pre-D6, callWithRetryBudget knew
    // nothing about the loop deadline: it would have retried a 3rd time
    // (still under TRIAGE_RETRY_BUDGET=2) and only reported
    // retry_budget_exhausted after 3 real mockCreate calls.
    const simulatedTimes = [
      0,
      0,
      0,
      TRIAGE_MAX_WALL_CLOCK_MS - 15_000,
      TRIAGE_MAX_WALL_CLOCK_MS - 13_000,
      TRIAGE_MAX_WALL_CLOCK_MS,
    ]
    let call = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      const t = call < simulatedTimes.length ? simulatedTimes[call] : simulatedTimes[simulatedTimes.length - 1]
      call += 1
      return t
    })
    mockCreate.mockRejectedValueOnce({ status: 503, message: 'attempt 1 (simulated 30s)' })
    mockCreate.mockRejectedValueOnce({ status: 503, message: 'attempt 2 (simulated 13s, clamped)' })

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'wall_clock_exceeded', costCents: expect.any(Number) })
    // Exactly 2 attempts — the 3rd retry (still within TRIAGE_RETRY_BUDGET)
    // was refused because it could not fit inside the remaining budget.
    expect(mockCreate).toHaveBeenCalledTimes(2)

    vi.spyOn(Date, 'now').mockRestore()
  })

  it('D6: a retry that cannot fit the remaining loop budget is refused outright — no sleep, no further attempt', async () => {
    // Attempt 1 alone consumes 44s of the 45s budget, leaving only 1000ms —
    // under RETRY_DELAY_MS (2000ms) — so the retry is refused before it is
    // ever attempted, even though 2 retries remain in TRIAGE_RETRY_BUDGET.
    const simulatedTimes = [0, 0, 0, TRIAGE_MAX_WALL_CLOCK_MS - 1_000]
    let call = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      const t = call < simulatedTimes.length ? simulatedTimes[call] : simulatedTimes[simulatedTimes.length - 1]
      call += 1
      return t
    })
    mockCreate.mockRejectedValueOnce({ status: 503, message: 'attempt 1 (simulated 44s)' })

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'wall_clock_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(1)

    vi.spyOn(Date, 'now').mockRestore()
  })

  // ─── Retry budget (§2.7) ────────────────────────────────────────────────

  it(`TRIAGE_RETRY_BUDGET (${TRIAGE_RETRY_BUDGET}): exhausting the shared retry pool fails closed with retry_budget_exhausted`, async () => {
    mockCreate.mockRejectedValue({ status: 429, message: 'rate limited' })

    const result = await runToolLoop(baseInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'retry_budget_exhausted', costCents: expect.any(Number) })
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

// ─── SIGNAL3-TOOL-INVOCATION-EXPECTED (ADR 0021 §11, Amendment B1.2) ───────
// Session 28-D, D3 (MAJOR-3 closed) — this constraint never existed before
// this test: `git grep -rn "TOOL-INVOCATION-EXPECTED"` hit only
// docs/decisions/, and Amendment B1.2 names it explicitly as a property
// that must stay Tier 2, never be absorbed into the statistical Tier-E gate
// (SIGNAL3-TRIAGE-QUALITY speaks only to "was some tool called, in
// aggregate, at some rate" — this speaks to "did THIS fixture's expected
// tool get called with THIS fixture's exact input," deterministically, not
// as a rate that could silently drift below 100% forever without failing a
// single test).
describe('SIGNAL3-TOOL-INVOCATION-EXPECTED (ADR 0021 §11, Amendment B1.2) — exact-match, per fixture, never an aggregate rate', () => {
  function mockTool(name: string): TriageTool {
    return {
      name,
      description: `mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue([]),
    }
  }

  it.each([
    ['tool-use-list-evidence', 'list_evidence', { query: 'SSO' }],
    ['tool-use-list-audience-notes', 'list_audience_notes', { audience: 'enterprise IT buyers' }],
    ['tool-use-list-brand-claims', 'list_brand_claims', { objective: 'check for conflicting prior claims' }],
  ] as const)(
    "%s: the loop calls %s's execute with the fixture's exact input at least once (exact-match, not a rate)",
    async (fixtureName, toolName, expectedInput) => {
      const tools = [
        mockTool('list_evidence'),
        mockTool('list_audience_notes'),
        mockTool('list_brand_claims'),
        mockTool('list_recent_campaigns'),
      ]
      mockCreate.mockResolvedValueOnce(loadFixture(fixtureName))
      mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))

      const result = await runToolLoop(baseInput({ tools }))

      expect(result.outcome).toBe('decision')
      const expectedTool = tools.find((t) => t.name === toolName)!
      expect(expectedTool.execute).toHaveBeenCalledWith(expectedInput)
      // Exact-match, not aggregate: this fixture named exactly one tool —
      // every OTHER tool in the closed four must NOT have been called.
      for (const other of tools) {
        if (other.name !== toolName) expect(other.execute).not.toHaveBeenCalled()
      }
    },
  )
})
