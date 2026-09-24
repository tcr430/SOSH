import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ADR 0027 §5.3 / §6.3 — Session 34-D D8 (MAJOR-4, NIT-4). runToolLoop is SHARED by Stage C triage and the campaign
// planner, so these assertions live in a NEW file: lib/ai/tool-runner.test.ts and
// lib/signals/triage/orchestrator.test.ts are byte-unchanged (rule 9) and stay green as the proof triage is untouched.
//
// SHARED-FUNCTION CALLERS (git grep at D8) — runToolLoop:
//   lib/signals/triage/orchestrator.ts:128    Stage C triage, passes NO usageId   -> lib/signals/triage/orchestrator.test.ts,
//                                                                                     lib/ai/tool-runner.test.ts, and the
//                                                                                     "absent" cases of THIS file
//   lib/campaigns/planner/orchestrator.ts:107 the planner, passes usageId          -> lib/campaigns/planner/__tests__/orchestrator.test.ts
//                                                                                     (the id equals plannerRunId) and the
//                                                                                     "present" cases of THIS file

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/config', () => ({ config: { server: { AI_RATE_LIMIT_POST_GENERATION_PER_MIN: 30 } } }))
vi.mock('@/lib/ai/client', () => ({ getAnthropicClient: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({ recordAiUsage: vi.fn(), countRecentCalls: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { runToolLoop, ToolResultEnvelopeViolation, TRIAGE_MAX_TOOL_CALLS, type TriageTool } from './tool-runner'
import { getAnthropicClient } from '@/lib/ai/client'
import { recordAiUsage, countRecentCalls } from '@/lib/db/ai-usage'
import type { CustomerContext } from '@/lib/ai/context'

const FIXTURES_DIR = path.join(process.cwd(), 'lib', 'signals', '__fixtures__', 'triage')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadFixture = (name: string): any => JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8'))

const RUN_ID = '9f2c1d3e-7a4b-4c5d-8e6f-0a1b2c3d4e5f'

const mockContext: CustomerContext = {
  business: { id: 'biz-1', name: 'Acme', industry: 'SaaS', description: null, language: 'en', website: null, timezone: 'Europe/London' },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: { isTrial: true, postsRemaining: 10, campaignsRemaining: 1, brandVoiceAttemptsRemaining: 3 },
}

const mockCreate = vi.fn()
const guardedTool = (execute: () => Promise<unknown>): TriageTool => ({
  name: 'list_evidence',
  description: 'List evidence memory candidates.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: execute as never,
})

const input = (over: Partial<Parameters<typeof runToolLoop>[0]> = {}) => ({
  context: mockContext,
  systemPrompt: 'Short system prompt.',
  userMessage: 'A release happened.',
  tools: [guardedTool(async () => [])],
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  mockCreate.mockReset()
  vi.mocked(getAnthropicClient).mockResolvedValue({ messages: { create: mockCreate } } as never)
  vi.mocked(countRecentCalls).mockResolvedValue(0)
  vi.mocked(recordAiUsage).mockResolvedValue({} as never)
})

describe("MAJOR-4 — usageId: the loop's ONE ai_usage row is inserted under the id the caller minted", () => {
  it('WITH usageId: recordAiUsage receives { id: usageId, ... } — one record for the whole loop', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    await runToolLoop(input({ usageId: RUN_ID }))
    expect(recordAiUsage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordAiUsage).mock.calls[0][0]).toMatchObject({ id: RUN_ID, business_id: 'biz-1', prompt_id: 'signal-triage' })
  })

  it('WITHOUT usageId (Stage C triage): the insert payload has NO id key and every other field is the current shape', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    await runToolLoop(input())
    const payload = vi.mocked(recordAiUsage).mock.calls[0][0]
    expect(payload).not.toHaveProperty('id')
    expect(Object.keys(payload).sort()).toEqual(
      ['business_id', 'cost_cents', 'error_code', 'input_tokens', 'latency_ms', 'model', 'output_tokens', 'prompt_id', 'prompt_version', 'success'].sort(),
    )
  })

  it('the id is used on a FAILED loop too (the finally block writes the row on every outcome)', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('truncated'))
    const result = await runToolLoop(input({ usageId: RUN_ID }))
    expect(result.outcome).toBe('failed')
    expect(vi.mocked(recordAiUsage).mock.calls[0][0]).toMatchObject({ id: RUN_ID, success: false })
  })

  it('a FAILING usage write with an id is captured with the run id and phase "planner-usage-record"', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    vi.mocked(recordAiUsage).mockRejectedValue(new Error('db: connection refused'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await runToolLoop(input({ usageId: RUN_ID }))

    expect(result.outcome).toBe('decision') // a usage failure never discards the result
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    const [err, hint] = vi.mocked(Sentry.captureException).mock.calls[0]
    expect((err as Error).message).not.toContain('connection refused') // a fixed message, never the DB's
    expect(hint).toEqual({ tags: { business_id: 'biz-1', run_id: RUN_ID, phase: 'planner-usage-record' } })
    errorSpy.mockRestore()
  })

  it("a FAILING usage write WITHOUT an id is NOT captured — triage's path is exactly what it was (console only)", async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    vi.mocked(recordAiUsage).mockRejectedValue(new Error('db: connection refused'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runToolLoop(input())

    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('tool-runner: failed to record ai_usage', expect.any(Error))
    errorSpy.mockRestore()
  })
})

describe('NIT-4 — an envelope violation is a NAMED, captured error that still fails closed exactly as before', () => {
  const leaking = () => guardedTool(async () => ({ leaked: 'plain unguarded model-visible text' }))

  it("is captured under its own name with the consumer's prompt id and phase \"tool-result-envelope\"", async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runToolLoop(input({ tools: [leaking()] }))

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    const [err, hint] = vi.mocked(Sentry.captureException).mock.calls[0]
    expect(err).toBeInstanceOf(ToolResultEnvelopeViolation)
    expect((err as Error).name).toBe('ToolResultEnvelopeViolation')
    expect(hint).toEqual({ tags: { prompt_id: 'signal-triage', phase: 'tool-result-envelope' } })
    // The capture carries a JSON path, never the offending text.
    expect((err as Error).message).not.toContain('plain unguarded model-visible text')
    errorSpy.mockRestore()
  })

  it('the model STILL receives only the constant TOOL_EXECUTION_ERROR_MESSAGE, flagged is_error', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runToolLoop(input({ tools: [leaking()] }))

    const secondCall = mockCreate.mock.calls[1][0]
    const toolResult = secondCall.messages[secondCall.messages.length - 1].content[0]
    expect(toolResult).toMatchObject({ type: 'tool_result', content: 'Tool execution failed.', is_error: true })
    expect(JSON.stringify(secondCall.messages)).not.toContain('plain unguarded model-visible text')
    errorSpy.mockRestore()
  })

  it('the call is COUNTED exactly as before: after TRIAGE_MAX_TOOL_CALLS violations the tools are withheld', async () => {
    for (let i = 0; i < TRIAGE_MAX_TOOL_CALLS; i++) mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await runToolLoop(input({ tools: [leaking()] }))

    expect(result.outcome).toBe('decision')
    expect(Sentry.captureException).toHaveBeenCalledTimes(TRIAGE_MAX_TOOL_CALLS)
    expect(mockCreate.mock.calls[TRIAGE_MAX_TOOL_CALLS][0].tools).toBeUndefined()
    errorSpy.mockRestore()
  })

  it('an ORDINARY tool error is NOT captured as an envelope violation — it is the same fail-closed path, unnamed', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runToolLoop(input({ tools: [guardedTool(async () => { throw new Error('db exploded') })] }))

    expect(Sentry.captureException).not.toHaveBeenCalled()
    const secondCall = mockCreate.mock.calls[1][0]
    expect(secondCall.messages[secondCall.messages.length - 1].content[0]).toMatchObject({ content: 'Tool execution failed.', is_error: true })
    errorSpy.mockRestore()
  })

  it('a guarded result (an id and an enveloped string) is NOT a violation', async () => {
    mockCreate.mockResolvedValueOnce(loadFixture('tool-use-list-evidence'))
    mockCreate.mockResolvedValueOnce(loadFixture('decision-card'))
    await runToolLoop(input({ tools: [guardedTool(async () => ({ id: RUN_ID, statement: '[DATA]\nplain\n[/DATA]' }))] }))
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
