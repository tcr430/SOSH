import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

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
  assertDecisionSchemaIsStrict,
  TOOL_LOOP_FAILURE_REASONS,
  FORBIDDEN_DECISION_FIELDS,
  TRIAGE_LOOP_BOUNDS,
  TRIAGE_PROMPT_ID,
  TRIAGE_PROMPT_VERSION,
  TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS,
  TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN,
  TRIAGE_MAX_TOOL_CALLS,
  TRIAGE_MAX_WALL_CLOCK_MS,
  TRIAGE_RETRY_BUDGET,
  type ToolLoopBounds,
  type ToolLoopFailureReason,
  type TriageTool,
} from './tool-runner'
import { MODELS } from './models'
import { getAnthropicClient } from '@/lib/ai/client'
import { recordAiUsage, countRecentCalls } from '@/lib/db/ai-usage'
import type { CustomerContext } from '@/lib/ai/context'
import {
  AI_PLANNER_MAX_TOOL_CALLS,
  AI_PLANNER_MAX_TURNS,
  AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS,
  AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN,
  AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS,
  AI_PLANNER_MAX_WALL_CLOCK_MS,
  AI_PLANNER_RETRY_BUDGET,
} from '@/lib/campaigns/planner/constants'

// ADR 0027 §3.1 / §3.3 / §3.4 / §3.5 (Session 34 K2.2) — runToolLoop made generic.
// SHARED-FUNCTION CALLERS: runToolLoop has exactly ONE production caller today,
// lib/signals/triage/orchestrator.ts:128, exercised by lib/signals/triage/orchestrator.test.ts (which mocks
// runToolLoop) and, for the loop's own behaviour, by lib/ai/tool-runner.test.ts — run UNCHANGED in this commit
// as the byte-identical proof (AGENCY-LOOP-BOUNDS-PARAMETERISED). The second consumer (the planner, K2.7) does
// not exist yet; these tests drive the loop with the planner's bounds directly.

const PLANNER_BOUNDS: ToolLoopBounds = {
  maxToolCalls: AI_PLANNER_MAX_TOOL_CALLS,
  maxTurns: AI_PLANNER_MAX_TURNS,
  maxCumulativeInputTokens: AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS,
  maxOutputTokensPerTurn: AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN,
  maxCumulativeOutputTokens: AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS,
  maxWallClockMs: AI_PLANNER_MAX_WALL_CLOCK_MS,
  retryBudget: AI_PLANNER_RETRY_BUDGET,
}

// The planner's real id lands in K2.7; this only has to be DISTINCT from triage's.
const PLANNER_PROMPT_ID = 'campaign-planner'
const PLANNER_PROMPT_VERSION = 1

const PlannerDecisionSchema = z.strictObject({ proposals: z.array(z.string()), note: z.string() })
const PLANNER_DECISION = { proposals: ['drop 3'], note: 'no evidence for customer_proof' }

const mockContext: CustomerContext = {
  business: { id: 'biz-1', name: 'Acme', industry: 'SaaS', description: null, language: 'en', website: null, timezone: 'Europe/London' },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: { isTrial: true, postsRemaining: 10, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 3 },
}
const trialExhausted: CustomerContext = {
  ...mockContext,
  trialState: { isTrial: true, postsRemaining: 0, campaignsRemaining: 0, brandVoiceAttemptsRemaining: 3 },
}

const lookupTool: TriageTool = {
  name: 'list_evidence',
  description: 'List evidence.',
  inputSchema: { type: 'object', properties: {} },
  execute: vi.fn(),
}

type Usage = { input_tokens: number; output_tokens: number }
const usage = (input_tokens = 1000, output_tokens = 100): Usage => ({ input_tokens, output_tokens })

function textResponse(text: string, u: Usage = usage()) {
  return { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: u }
}
function toolUseResponse(u: Usage = usage(), name = 'list_evidence') {
  return { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input: {} }], stop_reason: 'tool_use', usage: u }
}
const triageDecisionText = JSON.stringify({
  verdict: 'card',
  reason: 'r',
  citableEvidenceIds: [],
  citableBrandIds: [],
  audienceNote: 'a',
})

const mockCreate = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  mockCreate.mockReset()
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  vi.mocked(recordAiUsage).mockResolvedValue({} as never)
  lookupTool.execute = vi.fn().mockResolvedValue([{ id: 'ev-1' }])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function base(overrides: Record<string, unknown> = {}) {
  return { context: mockContext, systemPrompt: 'System.', userMessage: 'Plan.', tools: [lookupTool], ...overrides }
}

function plannerInput(overrides: Record<string, unknown> = {}) {
  return base({
    bounds: PLANNER_BOUNDS,
    promptId: PLANNER_PROMPT_ID,
    promptVersion: PLANNER_PROMPT_VERSION,
    enforceTrialQuota: false,
    outputSchema: PlannerDecisionSchema,
    ...overrides,
  })
}

// ═══ AGENCY-LOOP-BOUNDS-PARAMETERISED (10) ═══════════════════════════════════
describe('AGENCY-LOOP-BOUNDS-PARAMETERISED (ADR 0027 §3.1, constraint 10)', () => {
  it("TRIAGE_LOOP_BOUNDS is exactly triage's seven constants — the named default", () => {
    expect(TRIAGE_LOOP_BOUNDS).toEqual({
      maxToolCalls: TRIAGE_MAX_TOOL_CALLS,
      maxTurns: expect.any(Number),
      maxCumulativeInputTokens: TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS,
      maxOutputTokensPerTurn: TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN,
      maxCumulativeOutputTokens: expect.any(Number),
      maxWallClockMs: TRIAGE_MAX_WALL_CLOCK_MS,
      retryBudget: TRIAGE_RETRY_BUDGET,
    })
    expect(Object.keys(TRIAGE_LOOP_BOUNDS)).toHaveLength(7)
  })

  it('the DEFAULT call (Stage C passes nothing) uses triage bounds, prompt id, version and model', async () => {
    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText))

    const result = await runToolLoop(base())

    expect(result.outcome).toBe('decision')
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN)
    expect(mockCreate.mock.calls[0][0].model).toBe(MODELS.SONNET_4_6.id)
    expect(countRecentCalls).toHaveBeenCalledWith(expect.anything(), 'biz-1', 60, TRIAGE_PROMPT_ID)
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt_id: TRIAGE_PROMPT_ID, prompt_version: TRIAGE_PROMPT_VERSION, model: MODELS.SONNET_4_6.id }),
    )
  })

  it('a passed bounds object REPLACES triage cumulative input cap: a response between the two caps fails by default and passes with the planner bounds', async () => {
    const between = TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS + 1
    expect(between).toBeLessThan(AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS)

    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText, usage(between)))
    const asTriage = await runToolLoop(base())
    expect(asTriage).toEqual({ outcome: 'failed', reason: 'input_token_cap_exceeded', costCents: expect.any(Number) })

    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION), usage(between)))
    const asPlanner = await runToolLoop(plannerInput())
    expect(asPlanner.outcome).toBe('decision')
  })

  it('the planner per-turn output cap is what the outgoing request asks for — and its cumulative cap fires on the third maximal turn', async () => {
    // Three maximal turns must be needed to cross the cumulative cap, or this test would not discriminate.
    expect(AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN * 2).toBeLessThanOrEqual(AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS)
    expect(AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN * 3).toBeGreaterThan(AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS)
    mockCreate.mockResolvedValue(toolUseResponse(usage(100, AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN)))

    const result = await runToolLoop(plannerInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'output_token_cap_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(3)
    for (const call of mockCreate.mock.calls) expect(call[0].max_tokens).toBe(AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN)
  })

  it('the planner tool-call cap withholds tools once spent (no failure outcome — the cap only withholds)', async () => {
    mockCreate.mockResolvedValue(toolUseResponse())

    await runToolLoop(plannerInput())

    const withTools = mockCreate.mock.calls.filter((c) => c[0].tools !== undefined).length
    expect(withTools).toBe(AI_PLANNER_MAX_TOOL_CALLS)
    expect(mockCreate.mock.calls[AI_PLANNER_MAX_TOOL_CALLS][0].tools).toBeUndefined()
  })

  it('the planner turn cap fails with max_turns_exceeded when every turn is a tool call', async () => {
    mockCreate.mockResolvedValue(toolUseResponse())

    const result = await runToolLoop(plannerInput({ bounds: { ...PLANNER_BOUNDS, maxToolCalls: PLANNER_BOUNDS.maxTurns + 1 } }))

    expect(result).toEqual({ outcome: 'failed', reason: 'max_turns_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(AI_PLANNER_MAX_TURNS)
  })

  it('the wall-clock bound is the PASSED one: elapsed just past the planner ceiling (but under triage) fails the planner and not triage', async () => {
    expect(AI_PLANNER_MAX_WALL_CLOCK_MS).toBeLessThan(TRIAGE_MAX_WALL_CLOCK_MS)
    vi.useFakeTimers()
    const elapse = () => vi.setSystemTime(Date.now() + AI_PLANNER_MAX_WALL_CLOCK_MS + 1)

    mockCreate.mockImplementationOnce(async () => {
      elapse()
      return toolUseResponse()
    })
    const planner = await runToolLoop(plannerInput())
    expect(planner).toEqual({ outcome: 'failed', reason: 'wall_clock_exceeded', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(1)

    mockCreate.mockReset()
    mockCreate.mockImplementationOnce(async () => {
      elapse()
      return toolUseResponse()
    })
    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText))
    const triage = await runToolLoop(base())
    expect(triage.outcome).toBe('decision')
  })

  it('the passed retry budget is honoured: exhausting it costs 1 + AI_PLANNER_RETRY_BUDGET attempts, not triage 1 + TRIAGE_RETRY_BUDGET', async () => {
    expect(AI_PLANNER_RETRY_BUDGET).toBeLessThan(TRIAGE_RETRY_BUDGET)
    vi.useFakeTimers()
    mockCreate.mockRejectedValue({ status: 429, message: 'rate limited' })

    const pending = runToolLoop(plannerInput())
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result).toEqual({ outcome: 'failed', reason: 'retry_budget_exhausted', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(1 + AI_PLANNER_RETRY_BUDGET)
  })

  it('costing and the ai_usage row name the model actually used, not a hardcoded Sonnet', async () => {
    const wide = { ...PLANNER_BOUNDS, maxCumulativeInputTokens: AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS * 100 }
    const heavy = usage(AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS * 10, 100)
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION), heavy))
    const haiku = await runToolLoop(plannerInput({ model: 'HAIKU_4_5', bounds: wide }))
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION), heavy))
    const sonnet = await runToolLoop(plannerInput({ bounds: wide }))

    expect(mockCreate.mock.calls[0][0].model).toBe(MODELS.HAIKU_4_5.id)
    expect(vi.mocked(recordAiUsage).mock.calls[0][0].model).toBe(MODELS.HAIKU_4_5.id)
    expect(haiku.costCents).toBeLessThan(sonnet.costCents)
  })
})

// ═══ AGENCY-LOOP-SCHEMA-STRICT (11) — Tier 2 half ════════════════════════════
describe('AGENCY-LOOP-SCHEMA-STRICT (ADR 0027 §3.1, constraint 11)', () => {
  it('accepts a z.strictObject with no verdict-shaped field and returns its inferred decision', async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))

    const result = await runToolLoop(plannerInput())

    expect(result).toEqual({ outcome: 'decision', decision: PLANNER_DECISION, costCents: expect.any(Number) })
  })

  it('REJECTS a z.object (it strips unknown keys, so a smuggled "approved" would be silently dropped) — before any model call', async () => {
    await expect(runToolLoop(plannerInput({ outputSchema: z.object({ proposals: z.array(z.string()) }) }))).rejects.toThrow(/strictObject/)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(countRecentCalls).not.toHaveBeenCalled()
  })

  it('REJECTS a z.looseObject (it passes unknown keys straight through)', () => {
    expect(() => assertDecisionSchemaIsStrict(z.looseObject({ proposals: z.array(z.string()) }))).toThrow(/strictObject/)
  })

  it.each(FORBIDDEN_DECISION_FIELDS)('REJECTS a strictObject carrying a verdict-shaped field: %s', (field) => {
    const schema = z.strictObject({ proposals: z.array(z.string()), [field]: z.string() })
    expect(() => assertDecisionSchemaIsStrict(schema)).toThrow(/verdict-shaped field/)
  })

  it('the forbidden list is exactly applied, status, approved, verified', () => {
    expect([...FORBIDDEN_DECISION_FIELDS]).toEqual(['applied', 'status', 'approved', 'verified'])
  })

  it('the model cannot smuggle a status key through a strict schema: the extra key fails the parse as invalid_response', async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify({ ...PLANNER_DECISION, status: 'approved' })))

    const result = await runToolLoop(plannerInput())

    expect(result).toEqual({ outcome: 'failed', reason: 'invalid_response', costCents: expect.any(Number) })
  })

  it('a strictObject without a forbidden field is accepted — the guard does not break a legitimate schema', () => {
    expect(() => assertDecisionSchemaIsStrict(z.strictObject({ verdict: z.string(), reason: z.string() }))).not.toThrow()
  })
})

// ═══ AGENCY-FAILURE-REASONS-RUNTIME (14) ═════════════════════════════════════
// A consumer's mapping is exhaustive BY CONSTRUCTION: `satisfies Record<ToolLoopFailureReason, ...>` fails to
// COMPILE if a reason is missing or unknown. This is the shape K2.7's planner mapping takes.
const SOFT_FAILURE_MAPPING = {
  quota_exceeded: 'unavailable',
  rate_limited: 'unavailable',
  wall_clock_exceeded: 'unavailable',
  input_token_cap_exceeded: 'unavailable',
  output_token_per_turn_exceeded: 'unavailable',
  output_token_cap_exceeded: 'unavailable',
  retry_budget_exhausted: 'unavailable',
  max_turns_exceeded: 'unavailable',
  response_truncated: 'unavailable',
  invalid_response: 'unavailable',
  provider_error: 'unavailable',
} satisfies Record<ToolLoopFailureReason, 'unavailable'>

// @ts-expect-error — a mapping missing a reason MUST NOT compile; if this line compiles the union is no longer exhaustive
const INCOMPLETE_MAPPING = { quota_exceeded: 'unavailable' } satisfies Record<ToolLoopFailureReason, 'unavailable'>

describe('AGENCY-FAILURE-REASONS-RUNTIME (ADR 0027 §3.3, constraint 14)', () => {
  it('the runtime array carries all ELEVEN non-decision outcomes, once each', () => {
    expect([...TOOL_LOOP_FAILURE_REASONS].sort()).toEqual(
      [
        'quota_exceeded',
        'rate_limited',
        'wall_clock_exceeded',
        'input_token_cap_exceeded',
        'output_token_per_turn_exceeded',
        'output_token_cap_exceeded',
        'retry_budget_exhausted',
        'max_turns_exceeded',
        'response_truncated',
        'invalid_response',
        'provider_error',
      ].sort(),
    )
    expect(TOOL_LOOP_FAILURE_REASONS).toHaveLength(11)
    expect(new Set(TOOL_LOOP_FAILURE_REASONS).size).toBe(11)
  })

  it('an exhaustive mapping over the runtime array covers every reason and none maps to "ok"', () => {
    expect(Object.keys(SOFT_FAILURE_MAPPING).sort()).toEqual([...TOOL_LOOP_FAILURE_REASONS].sort())
    for (const reason of TOOL_LOOP_FAILURE_REASONS) expect(SOFT_FAILURE_MAPPING[reason]).not.toBe('ok')
    expect(Object.keys(INCOMPLETE_MAPPING)).toHaveLength(1)
  })

  it('every reason the loop ACTUALLY emits in these tests is a member of the runtime array', async () => {
    const seen = new Set<string>()
    const record = (r: { outcome: string; reason?: string }) => {
      if (r.outcome === 'failed' && r.reason) seen.add(r.reason)
    }
    record(await runToolLoop(base({ context: trialExhausted })))
    vi.mocked(countRecentCalls).mockResolvedValueOnce(1_000)
    record(await runToolLoop(base()))
    mockCreate.mockResolvedValueOnce(textResponse('not json'))
    record(await runToolLoop(base()))
    expect(seen).toEqual(new Set(['quota_exceeded', 'rate_limited', 'invalid_response']))
    for (const r of seen) expect(TOOL_LOOP_FAILURE_REASONS as readonly string[]).toContain(r)
  })
})

// ═══ AGENCY-PLANNER-TRIAL-EXEMPT (16) ════════════════════════════════════════
describe('AGENCY-PLANNER-TRIAL-EXEMPT (ADR 0027 §3.4, constraint 16)', () => {
  it('a planner run (enforceTrialQuota: false) proceeds when postsRemaining is 0 — a plan is not a post', async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))

    const result = await runToolLoop(plannerInput({ context: trialExhausted }))

    expect(result.outcome).toBe('decision')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('a planner run does not decrement postsRemaining (the loop never mutates the context)', async () => {
    const before = mockContext.trialState?.postsRemaining
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))

    await runToolLoop(plannerInput())

    expect(mockContext.trialState?.postsRemaining).toBe(before)
  })

  it('the DEFAULT (triage) still fails quota_exceeded at postsRemaining 0 — the exemption is opt-in, not global', async () => {
    const result = await runToolLoop(base({ context: trialExhausted }))

    expect(result).toEqual({ outcome: 'failed', reason: 'quota_exceeded', costCents: 0 })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// ═══ AGENCY-PLANNER-PROMPT-ID-DISTINCT (17) ══════════════════════════════════
describe('AGENCY-PLANNER-PROMPT-ID-DISTINCT (ADR 0027 §3.1, constraint 17)', () => {
  it("the planner's id is not triage's", () => {
    expect(PLANNER_PROMPT_ID).not.toBe(TRIAGE_PROMPT_ID)
  })

  it("the rate-limit read keys on the PASSED id, never the 'signal-triage' literal", async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))

    await runToolLoop(plannerInput())

    expect(countRecentCalls).toHaveBeenCalledWith(expect.anything(), 'biz-1', 60, PLANNER_PROMPT_ID)
    expect(countRecentCalls).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), TRIAGE_PROMPT_ID)
  })

  it('a planner-heavy minute cannot rate-limit triage, and vice versa: each read is keyed to its own id', async () => {
    vi.mocked(countRecentCalls).mockImplementation(async (_c, _b, _m, promptId) => (promptId === PLANNER_PROMPT_ID ? 1_000 : 0))
    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText))

    const planner = await runToolLoop(plannerInput())
    const triage = await runToolLoop(base())

    expect(planner).toEqual({ outcome: 'failed', reason: 'rate_limited', costCents: 0 })
    expect(triage.outcome).toBe('decision')
  })

  it('the ai_usage row records the passed id and version', async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))

    await runToolLoop(plannerInput())

    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ prompt_id: PLANNER_PROMPT_ID, prompt_version: PLANNER_PROMPT_VERSION }))
  })
})

// ═══ ADR 0027 §3.5 — the three inherited test holes ══════════════════════════
describe('ADR 0027 §3.5 — inherited holes, closed (under fail-soft an unexercised reason falls through to "proposed nothing")', () => {
  it('provider_error: a non-retryable status is NOT retried and maps to provider_error', async () => {
    mockCreate.mockRejectedValue({ status: 400, message: 'bad request' })

    const result = await runToolLoop(base())

    expect(result).toEqual({ outcome: 'failed', reason: 'provider_error', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('provider_error: withTimeout — a hung request rejects with NO status, is deliberately NOT retried, and maps to provider_error', async () => {
    vi.useFakeTimers()
    mockCreate.mockImplementation(() => new Promise(() => {}))

    const pending = runToolLoop(base())
    await vi.advanceTimersByTimeAsync(TRIAGE_MAX_WALL_CLOCK_MS)
    const result = await pending

    expect(result).toEqual({ outcome: 'failed', reason: 'provider_error', costCents: expect.any(Number) })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('the tool-execution-error path relays the CONSTANT message to the model — never the raw DB text', async () => {
    const dbText = 'relation "evidence_memory" does not exist'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    lookupTool.execute = vi.fn().mockRejectedValue(new Error(dbText))
    mockCreate.mockResolvedValueOnce(toolUseResponse())
    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText))

    const result = await runToolLoop(base())

    expect(result.outcome).toBe('decision')
    const relayed = JSON.stringify(mockCreate.mock.calls[1][0].messages)
    expect(relayed).toContain('Tool execution failed.')
    expect(relayed).not.toContain(dbText)
    expect(relayed).not.toContain('evidence_memory')
    const toolResult = mockCreate.mock.calls[1][0].messages.at(-1).content[0]
    expect(toolResult).toMatchObject({ type: 'tool_result', content: 'Tool execution failed.', is_error: true })
  })

  it('max_tokens REACHABILITY INVARIANT: every outgoing request asks for exactly the configured per-turn cap (output_token_per_turn_exceeded is structurally unreachable, so this is the honest coverage)', async () => {
    mockCreate.mockResolvedValueOnce(toolUseResponse())
    mockCreate.mockResolvedValueOnce(textResponse(triageDecisionText))
    await runToolLoop(base())
    for (const call of mockCreate.mock.calls) expect(call[0].max_tokens).toBe(TRIAGE_LOOP_BOUNDS.maxOutputTokensPerTurn)

    mockCreate.mockReset()
    mockCreate.mockResolvedValueOnce(toolUseResponse())
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify(PLANNER_DECISION)))
    await runToolLoop(plannerInput())
    for (const call of mockCreate.mock.calls) expect(call[0].max_tokens).toBe(AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN)
  })
})
