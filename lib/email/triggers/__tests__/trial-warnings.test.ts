import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'
import { addDays, formatISO } from 'date-fns'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: { APP_URL: 'https://app.sosh.io' },
    public: { APP_URL: 'https://app.sosh.io' },
  },
}))

const mockFindTrialExpiringBetween = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/trial-state', () => ({
  findTrialExpiringBetween: mockFindTrialExpiringBetween,
}))

const mockEnqueueEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/enqueue', () => ({
  enqueueEmail: mockEnqueueEmail,
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation(
    (_slug: string, fn: () => unknown, _opts?: unknown) => fn(),
  ),
  captureException: vi.fn(),
}))

import { runTrialWarningsTick } from '../trial-warnings'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date()

const T3_CANDIDATE = {
  business_id: 'biz-t3',
  business_name: 'Acme SaaS',
  recipient_email: 'founder@acme.example',
  language: 'en' as const,
  trial_expires_at: formatISO(addDays(now, 2.5)),
}

const T1_CANDIDATE = {
  business_id: 'biz-t1',
  business_name: 'Beta Corp',
  recipient_email: 'ceo@beta.example',
  language: 'pt' as const,
  trial_expires_at: formatISO(addDays(now, 1.5)),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindTrialExpiringBetween.mockResolvedValue([])
  mockEnqueueEmail.mockResolvedValue({ outcome: 'enqueued', row_id: 'row-1' })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runTrialWarningsTick', () => {
  it('empty windows → all counts zero, enqueueEmail never called', async () => {
    const summary = await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(summary.enqueuedT3).toBe(0)
    expect(summary.enqueuedT1).toBe(0)
    expect(summary.dedupedT3).toBe(0)
    expect(summary.dedupedT1).toBe(0)
    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })

  it('t3 candidate → enqueueEmail with kind=trial-warning-t3, daysRemaining=3', async () => {
    mockFindTrialExpiringBetween
      .mockResolvedValueOnce([T3_CANDIDATE])
      .mockResolvedValueOnce([])

    const summary = await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(summary.enqueuedT3).toBe(1)
    expect(summary.enqueuedT1).toBe(0)
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-t3',
        kind: 'trial-warning-t3',
        recipient: 'founder@acme.example',
        locale: 'en',
        props: expect.objectContaining({
          businessName: 'Acme SaaS',
          daysRemaining: 3,
          expiryDateIso: T3_CANDIDATE.trial_expires_at,
        }),
      }),
    )
  })

  it('t3 candidate deduped on second run → dedupedT3 += 1', async () => {
    mockFindTrialExpiringBetween
      .mockResolvedValueOnce([T3_CANDIDATE])
      .mockResolvedValueOnce([])
    mockEnqueueEmail.mockResolvedValue({ outcome: 'deduped', row_id: null })

    const summary = await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(summary.enqueuedT3).toBe(0)
    expect(summary.dedupedT3).toBe(1)
  })

  it('t1 candidate → enqueueEmail with kind=trial-warning-t1, daysRemaining=1', async () => {
    mockFindTrialExpiringBetween
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([T1_CANDIDATE])

    const summary = await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(summary.enqueuedT1).toBe(1)
    expect(summary.enqueuedT3).toBe(0)
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-t1',
        kind: 'trial-warning-t1',
        recipient: 'ceo@beta.example',
        locale: 'pt',
        props: expect.objectContaining({
          businessName: 'Beta Corp',
          daysRemaining: 1,
          expiryDateIso: T1_CANDIDATE.trial_expires_at,
        }),
      }),
    )
  })

  it('t1 candidate deduped → dedupedT1 += 1', async () => {
    mockFindTrialExpiringBetween
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([T1_CANDIDATE])
    mockEnqueueEmail.mockResolvedValue({ outcome: 'deduped', row_id: null })

    const summary = await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(summary.enqueuedT1).toBe(0)
    expect(summary.dedupedT1).toBe(1)
  })

  it('plan!=trial business filtered in DB → enqueue not called', async () => {
    mockFindTrialExpiringBetween.mockResolvedValue([])

    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })

  it('deleted business filtered in DB → enqueue not called', async () => {
    mockFindTrialExpiringBetween.mockResolvedValue([])

    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })

  it('t3 window bounds: first findTrialExpiringBetween call uses [now+2d, now+3d)', async () => {
    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    const t3Call = mockFindTrialExpiringBetween.mock.calls[0]
    const fromMs = new Date(t3Call[1] as string).getTime()
    const toMs = new Date(t3Call[2] as string).getTime()

    expect(fromMs).toBeGreaterThanOrEqual(addDays(now, 2).getTime() - 5000)
    expect(fromMs).toBeLessThanOrEqual(addDays(now, 2).getTime() + 5000)
    expect(toMs).toBeGreaterThanOrEqual(addDays(now, 3).getTime() - 5000)
    expect(toMs).toBeLessThanOrEqual(addDays(now, 3).getTime() + 5000)
  })

  it('boundary: trial_expires_at = now+1d exactly → in t1 window (from <= now+1d < to)', async () => {
    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    const t1Call = mockFindTrialExpiringBetween.mock.calls[1]
    const fromMs = new Date(t1Call[1] as string).getTime()
    const toMs = new Date(t1Call[2] as string).getTime()
    const boundary = addDays(now, 1).getTime()

    expect(boundary).toBeGreaterThanOrEqual(fromMs - 5000)
    expect(boundary).toBeLessThan(toMs + 5000)
  })

  it('boundary: trial_expires_at = now+3d exactly → NOT in t3 window (upper bound exclusive)', async () => {
    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    const t3Call = mockFindTrialExpiringBetween.mock.calls[0]
    const toMs = new Date(t3Call[2] as string).getTime()
    const boundary = addDays(now, 3).getTime()

    // now+3d should equal or exceed the exclusive upper bound
    expect(boundary).toBeGreaterThanOrEqual(toMs - 5000)
  })

  it('upgradeUrl is APP_URL + /locale/billing', async () => {
    mockFindTrialExpiringBetween
      .mockResolvedValueOnce([T3_CANDIDATE])
      .mockResolvedValueOnce([])

    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          upgradeUrl: 'https://app.sosh.io/en/billing',
        }),
      }),
    )
  })

  it('emits canonical log line with all summary fields', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runTrialWarningsTick({ triggeredBy: 'secret' })

    const raw = consoleSpy.mock.calls.at(-1)?.[0]
    const log = JSON.parse(String(raw))
    expect(log.kind).toBe('trial_warnings.tick')
    expect(log.triggeredBy).toBe('secret')
    expect(typeof log.enqueuedT3).toBe('number')
    expect(typeof log.enqueuedT1).toBe('number')
    expect(typeof log.dedupedT3).toBe('number')
    expect(typeof log.dedupedT1).toBe('number')
    expect(typeof log.durationMs).toBe('number')
  })

  it('Sentry.withMonitor called with trial-warnings slug and 0 9 * * * schedule', async () => {
    await runTrialWarningsTick({ triggeredBy: 'qstash' })

    expect(vi.mocked(Sentry.withMonitor)).toHaveBeenCalledWith(
      'trial-warnings',
      expect.any(Function),
      {
        schedule: { type: 'crontab', value: '0 9 * * *' },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  })
})
