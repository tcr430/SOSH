import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Session 32-D, D10 (MINOR-7) — the real lib/social import chain reads
// lib/config.ts at load; mock it so this file needs no env vars.
vi.mock('@/lib/config', () => ({ config: { server: {}, public: {} } }))
vi.mock('@/lib/social', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
  return { ...actual, getRegistry: vi.fn() }
})
vi.mock('@/lib/db/backfill-runs', () => ({
  getBackfillRunById: vi.fn(),
  transitionBackfillRun: vi.fn(),
  recordBackfillFetchProgress: vi.fn(),
  getNextBackfillRunForTick: vi.fn(),
  sweepStalledBackfillRuns: vi.fn(),
  sweepExpiredBackfillStaging: vi.fn(),
  sweepExpiredStagedVoice: vi.fn(),
  sweepExpiredBackfillCandidates: vi.fn(),
}))
vi.mock('@/lib/db/backfill-posts', () => ({
  stageBackfillPosts: vi.fn(),
}))
vi.mock('../extract', () => ({
  runExtractionUnit: vi.fn(),
}))

import { getRegistry } from '@/lib/social'
import type { SocialProvider } from '@/lib/social'
import {
  getBackfillRunById,
  transitionBackfillRun,
  getNextBackfillRunForTick,
  sweepStalledBackfillRuns,
  sweepExpiredBackfillStaging,
  sweepExpiredStagedVoice,
  sweepExpiredBackfillCandidates,
} from '@/lib/db/backfill-runs'
import type { SocialBackfillRunRow } from '@/lib/db/types'
import { runBackfillTick } from '../orchestrator'
import { runExtractionUnit } from '../extract'
import { BACKFILL_STALL_MINUTES, BACKFILL_STAGING_TTL_DAYS } from '../constants'

const mockGetRegistry = vi.mocked(getRegistry)
const mockRunExtractionUnit = vi.mocked(runExtractionUnit)
const mockGetBackfillRunById = vi.mocked(getBackfillRunById)
const mockTransitionBackfillRun = vi.mocked(transitionBackfillRun)
const mockGetNextBackfillRunForTick = vi.mocked(getNextBackfillRunForTick)
const mockSweepStalledBackfillRuns = vi.mocked(sweepStalledBackfillRuns)
const mockSweepExpiredBackfillStaging = vi.mocked(sweepExpiredBackfillStaging)
const mockSweepExpiredStagedVoice = vi.mocked(sweepExpiredStagedVoice)
const mockSweepExpiredBackfillCandidates = vi.mocked(sweepExpiredBackfillCandidates)

let consoleLogSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  mockSweepStalledBackfillRuns.mockResolvedValue(0)
  mockSweepExpiredBackfillStaging.mockResolvedValue(0)
  mockSweepExpiredStagedVoice.mockResolvedValue(0)
  mockSweepExpiredBackfillCandidates.mockResolvedValue(0)
})

afterEach(() => {
  vi.clearAllMocks()
  consoleLogSpy.mockRestore()
})

function makeRun(overrides: Partial<SocialBackfillRunRow> = {}): SocialBackfillRunRow {
  return {
    id: 'run-1',
    business_id: 'biz-1',
    social_account_id: 'sa-1',
    platform: 'twitter',
    status: 'queued',
    partial: false,
    account_role: null,
    weighting: null,
    posts_fetched: 0,
    posts_extracted: 0,
    platform_posts_read: 0,
    spend_cents: 0,
    ceiling_cents: 50,
    passes_done: 0,
    summary: {},
    staged_voice: null,
    voice_status: null,
    voice_applied_to: null,
    voice_applied_at: null,
    error_code: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    ratified_at: null,
    ...overrides,
  }
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
    fetchRecentPosts: vi.fn().mockResolvedValue({ posts: [], nextCursor: null }),
  }
}

describe('runBackfillTick (ADR 0025 §6.6, Session 32 I2.9)', () => {
  it('a queued/fetching run dispatches fetchPhase and runs all four sweeps', async () => {
    const run = makeRun({ status: 'queued' })
    mockGetNextBackfillRunForTick.mockResolvedValue(run)
    mockGetBackfillRunById.mockResolvedValue(run)
    mockTransitionBackfillRun.mockResolvedValue({ ...run, status: 'extracting' })
    mockGetRegistry.mockReturnValue({ get: () => makeFakeProvider(), register: vi.fn() })

    const summary = await runBackfillTick()

    expect(summary.runId).toBe('run-1')
    expect(summary.outcome).toBe('extracting')
    expect(mockSweepStalledBackfillRuns).toHaveBeenCalledWith(BACKFILL_STALL_MINUTES)
    expect(mockSweepExpiredBackfillStaging).toHaveBeenCalledWith(BACKFILL_STAGING_TTL_DAYS)
    expect(mockSweepExpiredStagedVoice).toHaveBeenCalledWith(BACKFILL_STAGING_TTL_DAYS)
    expect(mockSweepExpiredBackfillCandidates).toHaveBeenCalledWith(BACKFILL_STAGING_TTL_DAYS)
  })

  it('an extracting run dispatches to runExtractionUnit, never fetchPhase (fetchRecentPosts is never called)', async () => {
    const run = makeRun({ status: 'extracting' })
    mockGetNextBackfillRunForTick.mockResolvedValue(run)
    mockRunExtractionUnit.mockResolvedValue({ status: 'progressed', pass: 'stats' })
    const provider = makeFakeProvider()
    mockGetRegistry.mockReturnValue({ get: () => provider, register: vi.fn() })

    const summary = await runBackfillTick()

    expect(mockRunExtractionUnit).toHaveBeenCalledWith('run-1')
    expect(summary.outcome).toBe('extraction_unit_pending')
    expect(provider.fetchRecentPosts).not.toHaveBeenCalled()
    expect(mockGetBackfillRunById).not.toHaveBeenCalled() // fetchPhase never invoked
  })

  it('an extracting run that finishes extraction reports the real outcome (awaiting_ratification), not the generic pending label', async () => {
    const run = makeRun({ status: 'extracting' })
    mockGetNextBackfillRunForTick.mockResolvedValue(run)
    mockRunExtractionUnit.mockResolvedValue({ status: 'awaiting_ratification', partial: false })

    const summary = await runBackfillTick()

    expect(summary.outcome).toBe('awaiting_ratification')
  })

  it('no run needing work: outcome idle, sweeps still run', async () => {
    mockGetNextBackfillRunForTick.mockResolvedValue(null)

    const summary = await runBackfillTick()

    expect(summary).toMatchObject({ runId: null, runStatus: null, outcome: 'idle' })
    expect(mockSweepStalledBackfillRuns).toHaveBeenCalledTimes(1)
  })

  // BACKFILL-ERROR-DETAILS-CONTENT-FREE (ADR 0025 constraint 9, Tier 2) —
  // closes here (the provider half already proven in I2.3). The tick's
  // ONE canonical console.log line is asserted to carry ONLY the known-safe
  // field set: run counts, state transitions, reason codes, durations —
  // never content, cursors, tokens, handles, or platform_post_ids. Redden:
  // add `cursor` (or any staged post field) to the logged summary object —
  // this allowlist assertion fails. Reverted after confirming red.
  it('the tick log line carries only run counts/transitions/reason codes/durations — never content, cursors, tokens, or post ids', async () => {
    const run = makeRun({ status: 'fetching' })
    mockGetNextBackfillRunForTick.mockResolvedValue(run)
    mockGetBackfillRunById.mockResolvedValue(run)
    mockTransitionBackfillRun.mockResolvedValue(null) // no_op path, keeps the test focused on log shape
    mockGetRegistry.mockReturnValue({ get: () => makeFakeProvider(), register: vi.fn() })

    await runBackfillTick()

    const logCall = consoleLogSpy.mock.calls.find(([arg]: unknown[]) => typeof arg === 'string' && arg.includes('"kind":"backfill-tick"'))
    expect(logCall).toBeDefined()
    const logged = JSON.parse(logCall![0] as string)
    expect(Object.keys(logged).sort()).toEqual(
      [
        'kind',
        'tick',
        'durationMs',
        'runId',
        'runStatus',
        'outcome',
        'errorCode',
        'staleFailed',
        'stagingPurged',
        'stagedVoiceNulled',
        'candidatesSwept',
      ].sort(),
    )
  })

  it('a fetch error surfaces only its errorCode string in the log, never message/details content', async () => {
    const run = makeRun({ status: 'fetching' })
    mockGetNextBackfillRunForTick.mockResolvedValue(run)
    mockGetBackfillRunById.mockResolvedValue(run)
    mockTransitionBackfillRun.mockImplementation(async (_id, from, to, errorCode) =>
      from.includes('fetching') ? { ...run, status: to, error_code: errorCode ?? null } : null,
    )
    const provider = makeFakeProvider()
    const { SocialProviderError } = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
    provider.fetchRecentPosts = vi.fn().mockRejectedValue(
      new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'a message that must never reach the log: secret-cursor-abc123',
        platform: 'twitter',
        details: { cursor: 'secret-cursor-abc123', platformPostId: 'p-999' },
      }),
    )
    mockGetRegistry.mockReturnValue({ get: () => provider, register: vi.fn() })

    await runBackfillTick()

    const logCall = consoleLogSpy.mock.calls.find(([arg]: unknown[]) => typeof arg === 'string' && arg.includes('"kind":"backfill-tick"'))
    const loggedRaw = logCall![0] as string
    expect(loggedRaw).not.toContain('secret-cursor-abc123')
    expect(loggedRaw).not.toContain('p-999')
    expect(JSON.parse(loggedRaw).errorCode).toBe('PLATFORM_REJECTED')
  })
})
