import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatISO, subDays } from 'date-fns'
import {
  shouldSummarize,
  renderTierZeroSummary,
  computeSummaryPatternKey,
  summarizeBusinessLearning,
} from '@/lib/learning/summarize'
import { LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS } from '@/lib/learning/constants'
import type { CustomerContext } from '@/lib/ai/context'
import type { PerformanceMemoryRow } from '@/lib/db/types'

vi.mock('@/lib/ai/runner', () => ({ runPrompt: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({
  countRecentCalls: vi.fn(),
  getLastSuccessfulCallAt: vi.fn(),
}))
vi.mock('@/lib/db/post-edit-signals', () => ({
  countProcessedSignalsSince: vi.fn(),
  listRecentHumanEditExcerpts: vi.fn(),
}))
vi.mock('@/lib/db/memory-performance', () => ({
  listDistilledPatternsForSummary: vi.fn(),
  upsertDistilledPerformancePattern: vi.fn(),
}))

import { runPrompt } from '@/lib/ai/runner'
import { buildCustomerContext } from '@/lib/ai/context'
import { countRecentCalls, getLastSuccessfulCallAt } from '@/lib/db/ai-usage'
import { countProcessedSignalsSince, listRecentHumanEditExcerpts } from '@/lib/db/post-edit-signals'
import { listDistilledPatternsForSummary, upsertDistilledPerformancePattern } from '@/lib/db/memory-performance'

describe('shouldSummarize — THE TWO-GATE FLOOR', () => {
  it('19 signals + 8 days elapsed -> no call (signal gate fails)', () => {
    expect(shouldSummarize({ newSignalCount: 19, daysSinceLastSummary: 8 })).toBe(false)
  })

  it('25 signals + 3 days elapsed -> no call (interval gate fails)', () => {
    expect(shouldSummarize({ newSignalCount: 25, daysSinceLastSummary: 3 })).toBe(false)
  })

  it('both gates pass -> one call', () => {
    expect(shouldSummarize({ newSignalCount: 25, daysSinceLastSummary: 8 })).toBe(true)
  })

  it('exactly at both thresholds passes (>=, not >)', () => {
    expect(shouldSummarize({ newSignalCount: 20, daysSinceLastSummary: 7 })).toBe(true)
  })

  it('never-summarized (daysSinceLastSummary=null) trivially satisfies the interval gate', () => {
    expect(shouldSummarize({ newSignalCount: 20, daysSinceLastSummary: null })).toBe(true)
  })

  it('never-summarized still requires the signal-count gate', () => {
    expect(shouldSummarize({ newSignalCount: 5, daysSinceLastSummary: null })).toBe(false)
  })
})

describe('renderTierZeroSummary', () => {
  it('pluralizes observation count correctly', () => {
    expect(renderTierZeroSummary('Shortens LinkedIn posts', 1)).toBe('Shortens LinkedIn posts (1 observation)')
    expect(renderTierZeroSummary('Shortens LinkedIn posts', 7)).toBe('Shortens LinkedIn posts (7 observations)')
  })
})

describe('computeSummaryPatternKey', () => {
  it('is deterministic for the same dimension + statement', () => {
    const a = computeSummaryPatternKey('topic', 'Replaces vendor-speak with plain verbs')
    const b = computeSummaryPatternKey('topic', 'Replaces vendor-speak with plain verbs')
    expect(a).toBe(b)
  })

  it('is insensitive to case/whitespace differences in the statement (normalized before hashing)', () => {
    const a = computeSummaryPatternKey('topic', 'Replaces vendor-speak with plain verbs')
    const b = computeSummaryPatternKey('topic', '  replaces   vendor-speak with plain verbs  ')
    expect(a).toBe(b)
  })

  it('differs for a different dimension with the same statement text', () => {
    const a = computeSummaryPatternKey('topic', 'Same text')
    const b = computeSummaryPatternKey('hook', 'Same text')
    expect(a).not.toBe(b)
  })

  it('differs for different statement text', () => {
    const a = computeSummaryPatternKey('topic', 'First statement')
    const b = computeSummaryPatternKey('topic', 'Second statement')
    expect(a).not.toBe(b)
  })

  it('is namespaced under summarize: so it can never collide with a Tier-0 kind:direction:platform key', () => {
    expect(computeSummaryPatternKey('topic', 'anything')).toMatch(/^summarize:/)
  })
})

function ctxFor(businessId: string): CustomerContext {
  return {
    business: {
      id: businessId,
      name: `Business ${businessId}`,
      industry: null,
      description: null,
      language: 'en',
      website: null,
      timezone: 'UTC',
    },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

describe('summarizeBusinessLearning', () => {
  const mockClient = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countRecentCalls).mockResolvedValue(0)
    vi.mocked(getLastSuccessfulCallAt).mockResolvedValue(null)
    vi.mocked(countProcessedSignalsSince).mockResolvedValue(25)
    vi.mocked(listRecentHumanEditExcerpts).mockResolvedValue([])
    vi.mocked(listDistilledPatternsForSummary).mockResolvedValue([])
    vi.mocked(buildCustomerContext).mockResolvedValue(ctxFor('biz-1'))
    vi.mocked(runPrompt).mockResolvedValue({ statements: [] })
    vi.mocked(upsertDistilledPerformancePattern).mockResolvedValue({} as PerformanceMemoryRow)
  })

  it('the monthly ceiling blocks the call — no runPrompt invocation', async () => {
    vi.mocked(countRecentCalls).mockResolvedValue(LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS)
    const result = await summarizeBusinessLearning(mockClient, 'biz-1')
    expect(result).toEqual({ skipped: 'monthly_ceiling', statementsWritten: 0, statementsRejected: 0 })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('gates_not_met (signal count too low) skips without calling runPrompt', async () => {
    vi.mocked(countProcessedSignalsSince).mockResolvedValue(5)
    const result = await summarizeBusinessLearning(mockClient, 'biz-1')
    expect(result).toEqual({ skipped: 'gates_not_met', statementsWritten: 0, statementsRejected: 0 })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('gates_not_met (interval too short) skips without calling runPrompt', async () => {
    vi.mocked(getLastSuccessfulCallAt).mockResolvedValue(formatISO(subDays(new Date(), 3)))
    const result = await summarizeBusinessLearning(mockClient, 'biz-1')
    expect(result).toEqual({ skipped: 'gates_not_met', statementsWritten: 0, statementsRejected: 0 })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('both gates passing -> exactly one runPrompt call', async () => {
    await summarizeBusinessLearning(mockClient, 'biz-1')
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('the outgoing context has trialState forced to null (never gated by post-generation trial quota)', async () => {
    vi.mocked(buildCustomerContext).mockResolvedValue({
      ...ctxFor('biz-1'),
      trialState: { isTrial: true, postsRemaining: 0, campaignsRemaining: 0, brandVoiceAttemptsRemaining: 0 },
    })
    await summarizeBusinessLearning(mockClient, 'biz-1')
    const [, contextArg] = vi.mocked(runPrompt).mock.calls[0]
    expect(contextArg.trialState).toBeNull()
  })

  it('writes each returned statement as a candidate row (observation_count=1 — never a shortcut into active)', async () => {
    vi.mocked(runPrompt).mockResolvedValue({
      statements: [{ statement: 'Replaces vendor-speak with plain verbs', dimension: 'topic' }],
    })
    const result = await summarizeBusinessLearning(mockClient, 'biz-1')

    expect(result).toEqual({ skipped: null, statementsWritten: 1, statementsRejected: 0 })
    expect(upsertDistilledPerformancePattern).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        business_id: 'biz-1',
        dimension: 'topic',
        pattern: 'Replaces vendor-speak with plain verbs',
        observation_count: 1,
        // computeConfidence(1, 0) = 1/(1+2) ≈ 0.333 — well below both
        // LEARN_PROMOTION_MIN_OBSERVATIONS (5) and _MIN_CONFIDENCE (0.70),
        // so this can never promote on its own regardless of the exact
        // confidence value; asserted precisely so a future change to
        // computeConfidence's formula is caught here too.
        confidence: 1 / 3,
        platform: null,
        scope: 'brand',
      }),
    )
  })

  it('writes nothing when the model returns zero statements', async () => {
    const result = await summarizeBusinessLearning(mockClient, 'biz-1')
    expect(result).toEqual({ skipped: null, statementsWritten: 0, statementsRejected: 0 })
    expect(upsertDistilledPerformancePattern).not.toHaveBeenCalled()
  })

  // ADR 0022 §5.3, §17 item 3 (Session 29, F1b.10) — the per-statement
  // log-and-skip. MUST REDDEN without the try/catch: prior to this fix, a
  // rejection on statement #1 threw out of the loop entirely, so statement
  // #2 was never even attempted — this test proves both halves at once
  // (the survivor is written AND the rejection is counted, not silently
  // dropped by an unrelated code path).
  it('a rejected statement does not prevent subsequent statements in the same batch from being written, and statementsRejected increments', async () => {
    vi.mocked(runPrompt).mockResolvedValue({
      statements: [
        { statement: 'Rejected statement', dimension: 'topic' },
        { statement: 'Surviving statement', dimension: 'hook' },
      ],
    })
    vi.mocked(upsertDistilledPerformancePattern)
      .mockRejectedValueOnce(new Error('performance_memory_pattern_length_check violation'))
      .mockResolvedValueOnce({} as PerformanceMemoryRow)

    const result = await summarizeBusinessLearning(mockClient, 'biz-1')

    expect(result).toEqual({ skipped: null, statementsWritten: 1, statementsRejected: 1 })
    expect(upsertDistilledPerformancePattern).toHaveBeenCalledTimes(2)
    expect(upsertDistilledPerformancePattern).toHaveBeenNthCalledWith(
      2,
      mockClient,
      expect.objectContaining({ pattern: 'Surviving statement' }),
    )
  })

  // §10.3 — ONE business per call, proven end-to-end: two sequential calls
  // for two DIFFERENT businesses must never cross-contaminate. Each mock is
  // asserted against the SPECIFIC businessId argument each call received,
  // not just "was called with something."
  it('one business\'s input strictly cannot produce another business\'s write (§10.3)', async () => {
    vi.mocked(buildCustomerContext).mockImplementation(async (businessId: string) => ctxFor(businessId))
    vi.mocked(runPrompt).mockImplementation(async (_prompt, ctx: CustomerContext) => ({
      statements: [{ statement: `Pattern for ${ctx.business.id}`, dimension: 'topic' as const }],
    }))

    await summarizeBusinessLearning(mockClient, 'biz-A')
    await summarizeBusinessLearning(mockClient, 'biz-B')

    expect(buildCustomerContext).toHaveBeenNthCalledWith(1, 'biz-A')
    expect(buildCustomerContext).toHaveBeenNthCalledWith(2, 'biz-B')

    const writeCalls = vi.mocked(upsertDistilledPerformancePattern).mock.calls
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls[0][1]).toEqual(expect.objectContaining({ business_id: 'biz-A', pattern: 'Pattern for biz-A' }))
    expect(writeCalls[1][1]).toEqual(expect.objectContaining({ business_id: 'biz-B', pattern: 'Pattern for biz-B' }))

    // Every read this call made was scoped to ITS OWN business id — not a
    // shared/captured variable that could carry the previous call's value.
    expect(countProcessedSignalsSince).toHaveBeenNthCalledWith(1, mockClient, 'biz-A', null)
    expect(countProcessedSignalsSince).toHaveBeenNthCalledWith(2, mockClient, 'biz-B', null)
  })
})
