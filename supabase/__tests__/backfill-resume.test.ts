import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'

// MAJOR-4 (Session 32-D, D7, ADR 0025 §2.3/§4.1/§6.4). No prior test ever
// writes real memory rows, crashes between a pass's writes and
// increment_backfill_passes_done, resumes the SAME run id, and counts
// what landed. fetch-phase.test.ts:274 only checks staging against MOCKED
// lib/db wrappers; the Tier-1 RPC tests only prove a byte-identical
// re-insert is ignored (ON CONFLICT), never a differently-worded resend
// after a real crash. This file drives fetchPhase/runExtractionUnit/
// resumeBackfillRun for real, against live Postgres, with ONLY the social
// provider and the AI runner call mocked (matching
// studio-promote-brief-end-to-end.test.ts's established Tier-1 pattern).

vi.mock('@/lib/social', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
  return { ...actual, getRegistry: vi.fn() }
})
vi.mock('@/lib/ai/runner', () => ({ runPromptWithCost: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn().mockResolvedValue({}) }))

// MAJOR-4(b)'s fault-injection seam: everything else in this module is
// REAL (importActual) — only incrementBackfillPassesDone can be made to
// throw, and only for a run id a test explicitly opts in via
// crashOnThirdIncrement, and only on that run's 3rd call (pass 0's, pass
// 1's, then pass 2/insights' — the exact "crash between writes and
// increment" window the defect describes). Every other call for every
// other run goes straight to the real implementation.
const crashOnThirdIncrement = new Set<string>()
const incrementCounts = new Map<string, number>()
vi.mock('@/lib/db/backfill-runs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/backfill-runs')>()
  return {
    ...actual,
    incrementBackfillPassesDone: vi.fn(async (runId: string) => {
      const n = (incrementCounts.get(runId) ?? 0) + 1
      incrementCounts.set(runId, n)
      if (n === 3 && crashOnThirdIncrement.has(runId)) {
        crashOnThirdIncrement.delete(runId) // only once — the resumed retry must succeed
        throw new Error('MAJOR-4 simulated crash: between a pass\'s writes and increment_backfill_passes_done')
      }
      return actual.incrementBackfillPassesDone(runId)
    }),
  }
})

import { getRegistry, SocialProviderError } from '@/lib/social'
import type { SocialProvider, RecentPost } from '@/lib/social'
import { runPromptWithCost } from '@/lib/ai/runner'
import { fetchPhase } from '@/lib/backfill/orchestrator'
import { runExtractionUnit } from '@/lib/backfill/extract'
import { resumeBackfillRun } from '@/lib/db/backfill-runs'

const mockGetRegistry = vi.mocked(getRegistry)
const mockRunPromptWithCost = vi.mocked(runPromptWithCost)

const PASSWORD = 'TestPass123!'

describe('backfill crash-and-resume (ADR 0025 §2.3/§4.1/§6.4, Session 32-D D7, MAJOR-4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-resume-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Resume Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  let accountCounter = 0
  async function makeQueuedRun(): Promise<string> {
    accountCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-resume-user-${accountCounter}`,
        platform_username: `resume_handle_${accountCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(80 + accountCounter).padStart(2, '0')}`,
        connected_at: new Date().toISOString(),
        is_active: true,
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr

    const { data, error } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: account.id, platform: 'twitter', status: 'queued' })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  function makeFakeProvider(): SocialProvider {
    return {
      platform: 'twitter',
      historicalReadAvailable: true,
      getOAuthAuthorizeUrl: vi.fn(),
      exchangeOAuthCode: vi.fn(),
      publish: vi.fn(),
      fetchPostMetrics: vi.fn(),
      fetchEngagement: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAccessToken: vi.fn(),
      fetchRecentPosts: vi.fn(),
    }
  }

  function registryWith(provider: SocialProvider) {
    mockGetRegistry.mockReturnValue({ get: () => provider, register: vi.fn() })
  }

  function post(platformPostId: string, daysAgoN: number, overrides: Partial<RecentPost> = {}): RecentPost {
    return {
      platformPostId,
      publishedAt: new Date(Date.now() - daysAgoN * 24 * 60 * 60 * 1000).toISOString(),
      content: `content for ${platformPostId}`,
      url: null,
      format: 'text',
      metrics: null,
      ...overrides,
    }
  }

  async function stagedCount(runId: string): Promise<number> {
    const { data, error } = await admin.from('social_backfill_posts').select('id').eq('run_id', runId)
    if (error) throw error
    return (data ?? []).length
  }

  const voiceOutput = {
    tone: ['direct'],
    targetAudience: 'B2B founders',
    keywords: [],
    avoidWords: [],
    uniqueValueProp: 'a platform for founders',
    competitors: [],
    voiceAxes: {
      formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50,
      calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50,
    },
  }

  // ── (a) fail on page 3, resume the SAME run id, complete -> staged rows unique ──
  it('(a) a fetch that fails on page 3 resumes on the same run id and stages no duplicate rows', async () => {
    const runId = await makeQueuedRun()
    const provider = makeFakeProvider()
    registryWith(provider)

    provider.fetchRecentPosts = vi
      .fn()
      .mockImplementationOnce(async () => ({
        posts: Array.from({ length: 10 }, (_, i) => post(`page1-${i}`, 5)),
        nextCursor: 'c2',
      }))
      .mockImplementationOnce(async () => ({
        posts: Array.from({ length: 10 }, (_, i) => post(`page2-${i}`, 6)),
        nextCursor: 'c3',
      }))
      .mockRejectedValueOnce(new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired', platform: 'twitter' }))

    const firstResult = await fetchPhase(runId)
    expect(firstResult).toEqual({ status: 'failed', errorCode: 'TOKEN_EXPIRED' })
    expect(await stagedCount(runId)).toBe(20)

    const { data: failedRun } = await admin.from('social_backfill_runs').select('status, error_code').eq('id', runId).single()
    expect(failedRun.status).toBe('failed')
    expect(failedRun.error_code).toBe('TOKEN_EXPIRED')

    const resumed = await resumeBackfillRun(runId)
    expect(resumed?.id).toBe(runId) // SAME run id — never a fresh row
    expect(resumed?.status).toBe('queued')

    // Resume re-serves the SAME two pages (a real provider replays from
    // cursor=null on every fresh call, ADR §6.5) plus one new page, then ends.
    provider.fetchRecentPosts = vi
      .fn()
      .mockImplementationOnce(async () => ({
        posts: Array.from({ length: 10 }, (_, i) => post(`page1-${i}`, 5)),
        nextCursor: 'c2',
      }))
      .mockImplementationOnce(async () => ({
        posts: Array.from({ length: 10 }, (_, i) => post(`page2-${i}`, 6)),
        nextCursor: 'c3',
      }))
      .mockImplementationOnce(async () => ({
        posts: Array.from({ length: 10 }, (_, i) => post(`page3-${i}`, 7)),
        nextCursor: null,
      }))

    const secondResult = await fetchPhase(runId)
    expect(secondResult.status).toBe('extracting')
    // 30 unique posts total (page1/page2 re-served but deduped by
    // platform_post_id, page3 genuinely new) — never 50.
    expect(await stagedCount(runId)).toBe(30)

    const { data: finalRun } = await admin.from('social_backfill_runs').select('id, status').eq('id', runId).single()
    expect(finalRun.id).toBe(runId)
    expect(finalRun.status).toBe('extracting')
  })

  // ── (b) crash between writes and increment_backfill_passes_done, resume with
  // DIFFERENTLY WORDED output -> caps hold, zero exact duplicates, passes_done
  // advances exactly once ──────────────────────────────────────────────────────
  it('(b) a crash between insights writes and increment_backfill_passes_done resumes and re-runs without duplicating or over-capping memory', async () => {
    const runId = await makeQueuedRun()
    const provider = makeFakeProvider()
    registryWith(provider)

    // 5 high-engagement posts (lift ~1.8, clears BACKFILL_PATTERN_MIN_LIFT)
    // and 5 low-engagement posts (baseline) — BACKFILL_PATTERN_MIN_N is 5.
    const highEngagement = Array.from({ length: 5 }, (_, i) =>
      post(`high-${i}`, 10 + i, { metrics: { likes: 10, comments: 0, shares: 0, saves: 0, clicks: null, reach: null, impressions: null, fetchedAt: new Date().toISOString() } }),
    )
    const lowEngagement = Array.from({ length: 5 }, (_, i) =>
      post(`low-${i}`, 20 + i, { metrics: { likes: 1, comments: 0, shares: 0, saves: 0, clicks: null, reach: null, impressions: null, fetchedAt: new Date().toISOString() } }),
    )
    provider.fetchRecentPosts = vi.fn().mockResolvedValue({ posts: [...highEngagement, ...lowEngagement], nextCursor: null })

    const fetchResult = await fetchPhase(runId)
    expect(fetchResult.status).toBe('extracting')

    // Pass 0 (stats/weighting/format — no model call): passes_done 0 -> 1.
    const statsResult = await runExtractionUnit(runId)
    expect(statsResult).toEqual({ status: 'progressed', pass: 'stats' })

    // Pass 1 (voice): passes_done 1 -> 2.
    mockRunPromptWithCost.mockResolvedValueOnce({ output: voiceOutput, costCents: 1 })
    const voiceResult = await runExtractionUnit(runId)
    expect(voiceResult).toEqual({ status: 'progressed', pass: 'voice' })

    // Pass 2 (insights), attempt 1: writes land, THEN increment throws
    // (crashOnThirdIncrement's 3rd call for this run — stats + voice were
    // calls 1 and 2). Each attempt below offers MORE distinct patterns/
    // statements than the caps allow (20 each, vs. BACKFILL_PERFORMANCE_CAP
    // 15 / BACKFILL_AUDIENCE_CAP 25) — two attempts uncapped would total 40
    // of each, so the cap is actually load-bearing for this assertion, not
    // trivially satisfied by a small fixture.
    const backingIds = highEngagement.map((p) => p.platformPostId)
    function patternsFor(label: string, n: number) {
      return Array.from({ length: n }, (_, i) => ({
        dimension: 'topic' as const,
        pattern: `${label} pattern ${i}: cutting onboarding time for enterprise buyers`,
        backingPostIds: backingIds,
      }))
    }
    function statementsFor(label: string, n: number) {
      return Array.from({ length: n }, (_, i) => ({
        kind: 'problem' as const,
        statement: `${label} statement ${i}: onboarding takes too long`,
        backingPostIds: [highEngagement[0].platformPostId, highEngagement[1].platformPostId],
      }))
    }

    crashOnThirdIncrement.add(runId)
    mockRunPromptWithCost.mockResolvedValueOnce({
      output: { patterns: patternsFor('attempt-one', 20), audienceStatements: statementsFor('attempt-one', 20) },
      costCents: 1,
    })
    await expect(runExtractionUnit(runId)).rejects.toThrow('MAJOR-4 simulated crash')

    const { data: afterCrash } = await admin.from('social_backfill_runs').select('passes_done').eq('id', runId).single()
    expect(afterCrash.passes_done).toBe(2) // NOT incremented by the crashed attempt

    const { data: perfAfterCrash } = await admin.from('performance_memory').select('id').eq('import_run_id', runId)
    const { data: audAfterCrash } = await admin.from('audience_memory').select('id').eq('import_run_id', runId)
    expect((perfAfterCrash ?? []).length).toBeGreaterThan(0) // the pre-crash writes DID land
    expect((audAfterCrash ?? []).length).toBeGreaterThan(0)

    // Resume: next tick re-enters passes_done===2 -> runInsightsPass AGAIN.
    // DIFFERENTLY WORDED output (a real model call is non-deterministic
    // across retries) — this must NOT duplicate or exceed the caps.
    mockRunPromptWithCost.mockResolvedValueOnce({
      output: { patterns: patternsFor('attempt-two', 20), audienceStatements: statementsFor('attempt-two', 20) },
      costCents: 1,
    })
    const resumedInsights = await runExtractionUnit(runId)
    expect(resumedInsights).toEqual({ status: 'progressed', pass: 'insights' })

    const { data: perfFinal } = await admin.from('performance_memory').select('id, pattern').eq('import_run_id', runId)
    const { data: audFinal } = await admin.from('audience_memory').select('id, statement').eq('import_run_id', runId)

    expect((perfFinal ?? []).length).toBeLessThanOrEqual(15) // BACKFILL_PERFORMANCE_CAP
    expect((audFinal ?? []).length).toBeLessThanOrEqual(25) // BACKFILL_AUDIENCE_CAP

    const perfPatterns = (perfFinal ?? []).map((r: { pattern: string }) => r.pattern)
    expect(new Set(perfPatterns).size).toBe(perfPatterns.length) // zero exact duplicates
    const audStatements = (audFinal ?? []).map((r: { statement: string }) => r.statement)
    expect(new Set(audStatements).size).toBe(audStatements.length) // zero exact duplicates

    // passes_done advanced by exactly ONE total across both attempts (the
    // crashed attempt did not increment; the resumed attempt did, once).
    const { data: finalRun } = await admin.from('social_backfill_runs').select('passes_done').eq('id', runId).single()
    expect(finalRun.passes_done).toBe(3)
  })

  // ── (c) caller_bug not resumable; a genuinely retryable failure IS ─────────
  it('(c) a caller_bug-coded failed run is not resumable; a retryable failure moves failed -> queued on the SAME row', async () => {
    const callerBugRunId = await makeQueuedRun()
    await admin.from('social_backfill_runs').update({ status: 'failed', error_code: 'caller_bug' }).eq('id', callerBugRunId)

    const notResumed = await resumeBackfillRun(callerBugRunId)
    expect(notResumed).toBeNull()
    const { data: stillFailed } = await admin.from('social_backfill_runs').select('status').eq('id', callerBugRunId).single()
    expect(stillFailed.status).toBe('failed')

    const retryableRunId = await makeQueuedRun()
    await admin.from('social_backfill_runs').update({ status: 'failed', error_code: 'TOKEN_EXPIRED' }).eq('id', retryableRunId)

    const resumed = await resumeBackfillRun(retryableRunId)
    expect(resumed?.id).toBe(retryableRunId) // same row
    expect(resumed?.status).toBe('queued')
  })
})
