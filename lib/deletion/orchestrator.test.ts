import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'
import { runDeletionTick, computeBackoff } from './orchestrator'
import type { DeletionRequestRow } from '@/lib/db/deletion-requests'
import {
  claimDeletionRequests,
  transitionDeletionRequest,
  purgeBusiness,
  getBusinessOwnerId,
  countRemainingBusinesses,
} from '@/lib/db/deletion-requests'

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockDeleteUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({
    auth: { admin: { deleteUser: mockDeleteUser } },
  })),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      DELETION_RETENTION_DAYS: 30,
      DELETION_MAX_ATTEMPTS: 3,
      DELETION_RETRY_BACKOFF_BASE_MINUTES: 60,
    },
  },
}))

vi.mock('@/lib/db/deletion-requests', () => ({
  claimDeletionRequests: vi.fn(),
  transitionDeletionRequest: vi.fn().mockResolvedValue(undefined),
  purgeBusiness: vi.fn(),
  getBusinessOwnerId: vi.fn(),
  countRemainingBusinesses: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation(
    (_slug: string, fn: () => unknown) => fn(),
  ),
  captureException: vi.fn(),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<DeletionRequestRow> = {}): DeletionRequestRow {
  return {
    id: 'req-1',
    business_id: 'biz-1',
    requested_at: '2026-05-01T00:00:00.000Z',
    verified_at: '2026-05-01T01:00:00.000Z',
    scheduled_purge_at: null,
    purged_at: null,
    status: 'processing',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

const FRESH_PURGE = {
  already_purged: false as const,
  business_id: 'biz-1',
  vault_secrets_deleted: 2,
  billing_events_redacted: 1,
  purged_at: '2026-06-15T03:00:00.000Z',
}

const ALREADY_PURGED = {
  already_purged: true as const,
  business_id: 'biz-1',
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(transitionDeletionRequest).mockResolvedValue(undefined)
  vi.mocked(mockDeleteUser).mockResolvedValue({ error: null })
  vi.mocked(getBusinessOwnerId).mockResolvedValue('owner-uuid')
  vi.mocked(countRemainingBusinesses).mockResolvedValue(0)
  vi.mocked(purgeBusiness).mockResolvedValue(FRESH_PURGE)
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runDeletionTick', () => {
  it('empty queue → claimed=0, no db calls beyond claim', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([])

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.claimed).toBe(0)
    expect(summary.purged).toBe(0)
    expect(vi.mocked(purgeBusiness)).not.toHaveBeenCalled()
    expect(vi.mocked(transitionDeletionRequest)).not.toHaveBeenCalled()
  })

  it('happy path: fresh purge + auth delete → purged=1, completed, deleteUser called', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow()])

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.claimed).toBe(1)
    expect(summary.purged).toBe(1)
    expect(summary.retried).toBe(0)
    expect(summary.abandoned).toBe(0)
    expect(vi.mocked(mockDeleteUser)).toHaveBeenCalledWith('owner-uuid')
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({ status: 'completed', purged_at: expect.any(String) }),
    )
  })

  it('already_purged (idempotent replay): ownerId null → completed without deleteUser', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow()])
    vi.mocked(getBusinessOwnerId).mockResolvedValue(null)
    vi.mocked(purgeBusiness).mockResolvedValue(ALREADY_PURGED)

    const summary = await runDeletionTick({ triggeredBy: 'secret' })

    expect(summary.purged).toBe(1)
    expect(vi.mocked(mockDeleteUser)).not.toHaveBeenCalled()
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({ status: 'completed' }),
    )
  })

  it('multi-business guard: remaining=1 → auth user NOT deleted', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow()])
    vi.mocked(countRemainingBusinesses).mockResolvedValue(1)

    await runDeletionTick({ triggeredBy: 'secret' })

    expect(vi.mocked(mockDeleteUser)).not.toHaveBeenCalled()
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({ status: 'completed' }),
    )
  })

  it('permanent SQLSTATE 23502 → abandoned immediately + Sentry.captureException', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow()])
    const pgErr = Object.assign(new Error('not-null violation'), { code: '23502' })
    vi.mocked(purgeBusiness).mockRejectedValueOnce(pgErr)

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.abandoned).toBe(1)
    expect(summary.retried).toBe(0)
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({ status: 'abandoned' }),
    )
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      pgErr,
      expect.objectContaining({ extra: expect.objectContaining({ class: 'permanent' }) }),
    )
  })

  it('transient error (attempts=0, maxAttempts=3) → failed with retry, retried=1', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow({ attempts: 0 })])
    vi.mocked(purgeBusiness).mockRejectedValueOnce(new Error('network timeout'))

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.retried).toBe(1)
    expect(summary.abandoned).toBe(0)
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({
        status: 'failed',
        attempts: 1,
        next_attempt_at: expect.any(String),
      }),
    )
  })

  it('attempts exhausted (attempts=2, maxAttempts=3) → abandoned + Sentry', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow({ attempts: 2 })])
    vi.mocked(purgeBusiness).mockRejectedValueOnce(new Error('network timeout'))

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.abandoned).toBe(1)
    expect(summary.retried).toBe(0)
    expect(vi.mocked(transitionDeletionRequest)).toHaveBeenCalledWith(
      expect.anything(),
      'req-1',
      expect.objectContaining({ status: 'abandoned', attempts: 3 }),
    )
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ class: 'transient_exhausted' }),
      }),
    )
  })

  it('auth.admin.deleteUser failure → transient retry path', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow()])
    vi.mocked(mockDeleteUser).mockResolvedValueOnce({
      error: new Error('auth service unavailable'),
    })

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.retried).toBe(1)
    expect(summary.purged).toBe(0)
  })

  it('mixed batch: 2 purged + 1 retried → correct summary counters', async () => {
    const rows = [makeRow({ id: 'r1' }), makeRow({ id: 'r2' }), makeRow({ id: 'r3' })]
    vi.mocked(claimDeletionRequests).mockResolvedValue(rows)
    vi.mocked(purgeBusiness)
      .mockResolvedValueOnce(FRESH_PURGE)
      .mockResolvedValueOnce(FRESH_PURGE)
      .mockRejectedValueOnce(new Error('transient'))

    const summary = await runDeletionTick({ triggeredBy: 'qstash' })

    expect(summary.claimed).toBe(3)
    expect(summary.purged).toBe(2)
    expect(summary.retried).toBe(1)
    expect(summary.abandoned).toBe(0)
  })

  it('emits deletion.tick.start log with claimed count and triggeredBy', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([makeRow(), makeRow({ id: 'r2' })])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runDeletionTick({ triggeredBy: 'qstash' })

    const startLog = consoleSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((log) => log.kind === 'deletion.tick.start')
    expect(startLog).toBeDefined()
    expect(startLog.claimed).toBe(2)
    expect(startLog.triggeredBy).toBe('qstash')
  })

  it('emits deletion.tick.end log with all summary fields', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runDeletionTick({ triggeredBy: 'secret' })

    const endLog = consoleSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((log) => log.kind === 'deletion.tick.end')
    expect(endLog).toBeDefined()
    expect(endLog.triggeredBy).toBe('secret')
    expect(typeof endLog.claimed).toBe('number')
    expect(typeof endLog.purged).toBe('number')
    expect(typeof endLog.retried).toBe('number')
    expect(typeof endLog.abandoned).toBe('number')
    expect(typeof endLog.durationMs).toBe('number')
  })

  it('Sentry.withMonitor called with process-deletions slug and daily 03:00 UTC schedule', async () => {
    vi.mocked(claimDeletionRequests).mockResolvedValue([])

    await runDeletionTick({ triggeredBy: 'qstash' })

    expect(vi.mocked(Sentry.withMonitor)).toHaveBeenCalledWith(
      'process-deletions',
      expect.any(Function),
      {
        schedule: { type: 'crontab', value: '0 3 * * *' },
        checkinMargin: 5,
        maxRuntime: 50,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    )
  })
})

describe('computeBackoff', () => {
  it('is capped at 1440 minutes (24h) regardless of attempt count', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1.0)
    // attempts=20 with base=60 → 60 * 2^19 * 1.25 → must cap to 1440
    expect(computeBackoff(20)).toBe(1440)
    randomSpy.mockRestore()
  })

  it('attempt=1 produces result within [base*0.75, base*1.25] jitter band', () => {
    const minSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const min = computeBackoff(1)
    minSpy.mockRestore()

    const maxSpy = vi.spyOn(Math, 'random').mockReturnValue(1)
    const max = computeBackoff(1)
    maxSpy.mockRestore()

    // base=60, attempts=1 → exp=60; band [60*0.75, 60*1.25] = [45, 75]
    expect(min).toBeGreaterThanOrEqual(45)
    expect(max).toBeLessThanOrEqual(75)
  })
})
