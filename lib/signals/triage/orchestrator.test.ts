import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SignalCandidateWithSignal, UntrustedText } from '@/lib/db/types'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation((_slug: string, fn: () => unknown) => fn()),
  captureException: vi.fn(),
}))

const mockListNewCandidatesPoolWithSource = vi.hoisted(() => vi.fn())
const mockListBusinessesWithNewCandidates = vi.hoisted(() => vi.fn())
const mockClaimCandidateForTriage = vi.hoisted(() => vi.fn())
const mockReclaimStaleTriagingCandidates = vi.hoisted(() => vi.fn())
const mockSetCandidateTriageOutcome = vi.hoisted(() => vi.fn())
const mockAgeGateCandidate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/signal-candidates', () => ({
  listNewCandidatesPoolWithSource: mockListNewCandidatesPoolWithSource,
  listBusinessesWithNewCandidates: mockListBusinessesWithNewCandidates,
  claimCandidateForTriage: mockClaimCandidateForTriage,
  reclaimStaleTriagingCandidates: mockReclaimStaleTriagingCandidates,
  setCandidateTriageOutcome: mockSetCandidateTriageOutcome,
  ageGateCandidate: mockAgeGateCandidate,
}))

const mockReserveTriageBudget = vi.hoisted(() => vi.fn())
const mockReconcileTriageBudget = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/signal-triage-budget', () => ({
  reserveTriageBudget: mockReserveTriageBudget,
  reconcileTriageBudget: mockReconcileTriageBudget,
}))

const mockBuildCustomerContext = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: mockBuildCustomerContext,
}))

const mockRunToolLoop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/tool-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/tool-runner')>()
  return { ...actual, runToolLoop: mockRunToolLoop }
})

const mockBuildTriageTools = vi.hoisted(() => vi.fn())
vi.mock('./tools', () => ({
  buildTriageTools: mockBuildTriageTools,
}))

const mockGenerateCard = vi.hoisted(() => vi.fn())
vi.mock('./card', () => ({
  generateCard: mockGenerateCard,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: { server: { TRIAGE_DAILY_CAP_CENTS: 125 } },
}))

import { runSignalsTriageTick } from './orchestrator'
import * as Sentry from '@sentry/nextjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SECRET_BODY_MARKER = 'ATTACKER-INJECTED-BODY-MARKER-DO-NOT-LEAK'

function makeCandidate(overrides: Partial<SignalCandidateWithSignal> = {}): SignalCandidateWithSignal {
  return {
    id: 'cand-1',
    business_id: 'biz-1',
    signal_id: 'sig-1',
    score: 80,
    score_inputs: {},
    occurred_at: new Date().toISOString(),
    status: 'new',
    triage_claimed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    signals: {
      title: 'v2.4.0' as unknown as UntrustedText,
      body: SECRET_BODY_MARKER as unknown as UntrustedText,
      html_url: null,
      occurred_at: new Date().toISOString(),
      author_is_bot: false,
      // ADR 0023 §5.3 (Session 30 G1b.7) — the pool reader's join now
      // carries these two; default to 'github'/null so every EXISTING
      // github-flow test in this file still passes through
      // allocateReservedShortlist unchanged (a candidate whose source
      // matches neither 'rss' nor 'github' would be silently dropped by
      // the allocator, which is deliberately strict about that).
      source: 'github',
      watched_feed_id: null,
    },
    ...overrides,
  } as SignalCandidateWithSignal
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListBusinessesWithNewCandidates.mockResolvedValue(['biz-1'])
  mockReclaimStaleTriagingCandidates.mockResolvedValue(0)
  mockListNewCandidatesPoolWithSource.mockResolvedValue([])
  mockReserveTriageBudget.mockResolvedValue({ business_id: 'biz-1', reserved_cents: 22 })
  mockReconcileTriageBudget.mockResolvedValue({ business_id: 'biz-1', reserved_cents: 8 })
  mockClaimCandidateForTriage.mockResolvedValue(makeCandidate({ status: 'triaging' }))
  mockSetCandidateTriageOutcome.mockResolvedValue(makeCandidate({ status: 'no_card' }))
  mockAgeGateCandidate.mockResolvedValue(makeCandidate({ status: 'no_card' }))
  mockBuildCustomerContext.mockResolvedValue({
    business: { id: 'biz-1', name: 'Acme', industry: 'SaaS', description: null, language: 'en', website: null, timezone: 'UTC' },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  })
  mockBuildTriageTools.mockReturnValue([])
  mockGenerateCard.mockResolvedValue({ outcome: 'inserted', card: { id: 'card-1' } })
  mockRunToolLoop.mockResolvedValue({
    outcome: 'decision',
    decision: { verdict: 'no_card', reason: 'x', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' },
    costCents: 5,
  })
})

describe('runSignalsTriageTick (ADR 0021 §3, Session 28 E5.6)', () => {
  it('the age gate makes ZERO LLM calls', async () => {
    const oldCandidate = makeCandidate({ occurred_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([oldCandidate])

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockAgeGateCandidate).toHaveBeenCalledWith(expect.anything(), oldCandidate.id)
    expect(mockRunToolLoop).not.toHaveBeenCalled()
    expect(mockClaimCandidateForTriage).not.toHaveBeenCalled()
    expect(summary.ageGated).toBe(1)
  })

  it('an exhausted deadline claims ZERO further candidates', async () => {
    const recentCandidate = makeCandidate({ id: 'cand-deadline' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([recentCandidate])

    const realNow = Date.now
    let call = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      call += 1
      // First call establishes startedAt; every subsequent call reports
      // elapsed time already within TRIAGE_MAX_WALL_CLOCK_MS of
      // TICK_MAX_DURATION_MS, tripping the deadline before the claim.
      return call === 1 ? realNow() : realNow() + 260_000
    })

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockClaimCandidateForTriage).not.toHaveBeenCalled()
    expect(summary.deadlineDeferred).toBe(1)

    vi.spyOn(Date, 'now').mockRestore()
  })

  it("the cap path leaves the candidate 'new' and increments cappedBusinesses", async () => {
    const candidate = makeCandidate({ id: 'cand-capped' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])
    mockReserveTriageBudget.mockResolvedValue(null)

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockClaimCandidateForTriage).not.toHaveBeenCalled()
    expect(summary.cappedBusinesses).toBe(1)
  })

  it('a loop failure lands triage_failed and logs the candidate ID to Sentry, never the body', async () => {
    const candidate = makeCandidate({ id: 'cand-fail' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])
    mockRunToolLoop.mockResolvedValue({ outcome: 'failed', reason: 'invalid_response', costCents: 2 })

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockSetCandidateTriageOutcome).toHaveBeenCalledWith(expect.anything(), 'cand-fail', expect.any(String), 'triage_failed')
    expect(summary.triageFailed).toBe(1)

    expect(Sentry.captureException).toHaveBeenCalled()
    const calls = vi.mocked(Sentry.captureException).mock.calls
    expect(calls.some((c) => JSON.stringify(c).includes('cand-fail'))).toBe(true)
    expect(calls.some((c) => JSON.stringify(c).includes(SECRET_BODY_MARKER))).toBe(false)
  })

  it('SIGNAL-MR-METADATA-NOT-PROMPTED (ADR 0023 §6.3) — source, watched_feed_id and html_url never reach the triage prompt', async () => {
    const base = makeCandidate({ id: 'cand-rss-metadata' })
    const candidate = {
      ...base,
      signals: {
        ...base.signals,
        source: 'rss',
        watched_feed_id: 'ffffffff-feed-marker-eeee-dddddddddddd',
        html_url: 'https://blog.example-attacker.test/marker-canonical-link',
      },
    } as unknown as SignalCandidateWithSignal
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])

    await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockRunToolLoop).toHaveBeenCalledTimes(1)
    const [args] = mockRunToolLoop.mock.calls[0]
    const serialized = JSON.stringify({ systemPrompt: args.systemPrompt, userMessage: args.userMessage })
    expect(serialized).not.toContain('feed-marker')
    expect(serialized).not.toContain('example-attacker.test')
    expect(serialized).not.toContain('watched_feed_id')
    expect(serialized).not.toContain('rss')
  })

  it('G1b.13 fix — a github candidate gets release framing, an rss candidate gets article framing (prompt branches on source, never mentions it)', async () => {
    const githubCandidate = makeCandidate({ id: 'cand-github-framing' })
    mockListNewCandidatesPoolWithSource.mockResolvedValueOnce([githubCandidate])
    await runSignalsTriageTick({ triggeredBy: 'secret' })
    expect(mockRunToolLoop).toHaveBeenCalledTimes(1)
    const githubArgs = mockRunToolLoop.mock.calls[0][0]
    expect(githubArgs.systemPrompt).toContain('GitHub release')
    expect(githubArgs.userMessage).toContain('GitHub release')

    mockRunToolLoop.mockClear()
    mockClaimCandidateForTriage.mockClear()
    const rssCandidate = {
      ...makeCandidate({ id: 'cand-rss-framing' }),
      signals: { ...makeCandidate().signals, source: 'rss', watched_feed_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    } as unknown as SignalCandidateWithSignal
    mockListNewCandidatesPoolWithSource.mockResolvedValueOnce([rssCandidate])
    await runSignalsTriageTick({ triggeredBy: 'secret' })
    expect(mockRunToolLoop).toHaveBeenCalledTimes(1)
    const rssArgs = mockRunToolLoop.mock.calls[0][0]
    expect(rssArgs.systemPrompt).toContain('news article')
    expect(rssArgs.userMessage).toContain('news article')
    expect(rssArgs.systemPrompt).not.toContain('GitHub release')
    expect(rssArgs.userMessage).not.toContain('GitHub release')
    // Same metadata boundary the test above already proves — reasserted here
    // because this test is the one that actually exercises the rss BRANCH.
    expect(rssArgs.systemPrompt).not.toContain('rss')
    expect(rssArgs.userMessage).not.toContain('rss')
  })

  it('the tick line carries every required field', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(line.kind).toBe('signals-triage.tick')
    for (const field of [
      'tick', 'triggeredBy', 'durationMs', 'businessesConsidered', 'staleReclaimed',
      'triaged', 'carded', 'cardSkipped', 'noCard', 'ageGated', 'triageFailed', 'cappedBusinesses', 'deadlineDeferred',
    ]) {
      expect(line).toHaveProperty(field)
    }

    logSpy.mockRestore()
  })

  it("a 'card' verdict calls generateCard with the captured CardCitableContext, and a real insert reaches 'carded'", async () => {
    const candidate = makeCandidate({ id: 'cand-card' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])
    const decision = { verdict: 'card' as const, reason: 'x', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' }
    mockRunToolLoop.mockResolvedValue({ outcome: 'decision', decision, costCents: 6 })
    mockGenerateCard.mockResolvedValue({ outcome: 'inserted', card: { id: 'card-1' } })

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    // buildTriageTools' THIRD argument is the CardCitableContext each tool
    // populates as a side effect — without it, generateCard's citation
    // verification has nothing to verify against (§4.6).
    expect(mockBuildTriageTools).toHaveBeenCalledWith(
      expect.anything(),
      'biz-1',
      expect.objectContaining({ evidence: expect.any(Map), brandClaims: expect.any(Map) }),
    )
    expect(mockGenerateCard).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate,
        claimedAtIso: expect.any(String),
        decision,
        citable: expect.objectContaining({ evidence: expect.any(Map), brandClaims: expect.any(Map) }),
      }),
    )
    expect(summary.carded).toBe(1)
    expect(summary.cardSkipped).toBe(0)
    expect(summary.triaged).toBe(1)
    // generateCard (Stage D, mocked here) owns the terminal 'carded'
    // transition itself — the orchestrator never calls it directly.
    expect(mockSetCandidateTriageOutcome).not.toHaveBeenCalled()
  })

  it("a 'skipped' generateCard outcome is NOT a card: no 'carded' transition, the new counter moves instead", async () => {
    const candidate = makeCandidate({ id: 'cand-card-skip' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])
    mockRunToolLoop.mockResolvedValue({
      outcome: 'decision',
      decision: { verdict: 'card', reason: 'x', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' },
      costCents: 6,
    })
    mockGenerateCard.mockResolvedValue({ outcome: 'skipped', reason: 'citations_rejected' })

    const summary = await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(summary.carded).toBe(0)
    expect(summary.cardSkipped).toBe(1)
    expect(summary.triaged).toBe(1)
    expect(mockSetCandidateTriageOutcome).not.toHaveBeenCalled()
  })

  it("reconciles the reservation against the loop's actual cost on every outcome", async () => {
    const candidate = makeCandidate({ id: 'cand-reconcile' })
    mockListNewCandidatesPoolWithSource.mockResolvedValue([candidate])
    mockRunToolLoop.mockResolvedValue({
      outcome: 'decision',
      decision: { verdict: 'no_card', reason: 'x', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' },
      costCents: 7,
    })

    await runSignalsTriageTick({ triggeredBy: 'secret' })

    expect(mockReconcileTriageBudget).toHaveBeenCalledWith('biz-1', 22, 7)
  })
})
