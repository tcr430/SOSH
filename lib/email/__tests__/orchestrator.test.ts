import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'
import { runEmailDrainTick } from '../orchestrator'
import { getEmailProvider, _resetEmailProviderForTests } from '@/lib/email/registry'
import { MockEmailProvider } from '@/lib/email/mock-provider'
import { EmailProviderError } from '@/lib/email/errors'
import type { EmailOutboxRow } from '@/lib/db/types'
import { claimEmailOutboxBatch, transitionEmailOutboxRow } from '@/lib/db/email-outbox'
import { isEmailSuppressed } from '@/lib/db/email-suppressions'
import { renderTemplate } from '@/lib/email/render'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      EMAIL_DRAIN_BATCH_SIZE: 5,
      EMAIL_MAX_ATTEMPTS: 3,
      EMAIL_RETRY_BACKOFF_SECONDS: 60,
      EMAIL_REPLY_TO: 'support@sosh.app',
      EMAIL_PROVIDER: 'mock',
    },
  },
}))

vi.mock('@/lib/db/email-outbox', () => ({
  claimEmailOutboxBatch: vi.fn(),
  transitionEmailOutboxRow: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/db/email-suppressions', () => ({
  isEmailSuppressed: vi.fn(),
}))

vi.mock('@/lib/email/render', () => ({
  renderTemplate: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation(
    (_slug: string, fn: () => unknown, _opts?: unknown) => fn(),
  ),
  captureException: vi.fn(),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RENDERED = {
  subject: 'Your trial ends soon',
  html: '<html><body>Your trial ends soon</body></html>',
  text: 'Your trial ends soon',
}

function makeRow(overrides: Partial<EmailOutboxRow> = {}): EmailOutboxRow {
  return {
    id: 'row-1',
    business_id: 'biz-1',
    kind: 'trial-warning-t3',
    recipient: 'user@example.com',
    locale: 'en',
    props: {},
    dedupe_token: null,
    status: 'sending',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    provider_message_id: null,
    created_at: '2026-06-08T00:00:00.000Z',
    updated_at: '2026-06-08T00:00:00.000Z',
    sent_at: null,
    ...overrides,
  }
}

let mockProvider: MockEmailProvider

beforeEach(() => {
  vi.clearAllMocks()
  _resetEmailProviderForTests()
  mockProvider = getEmailProvider() as MockEmailProvider
  mockProvider.reset()
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(renderTemplate).mockResolvedValue(RENDERED)
  vi.mocked(transitionEmailOutboxRow).mockResolvedValue(null)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runEmailDrainTick', () => {
  it('empty queue → claimed=0, no provider calls', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([])

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.claimed).toBe(0)
    expect(summary.sent).toBe(0)
    expect(mockProvider.getSends()).toHaveLength(0)
    expect(vi.mocked(transitionEmailOutboxRow)).not.toHaveBeenCalled()
  })

  it('happy path: 3 rows → all sent, transitions to sent', async () => {
    const rows = [makeRow({ id: 'r1' }), makeRow({ id: 'r2' }), makeRow({ id: 'r3' })]
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue(rows)

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.claimed).toBe(3)
    expect(summary.sent).toBe(3)
    expect(summary.failed).toBe(0)
    expect(mockProvider.getSends()).toHaveLength(3)
    const transitions = vi.mocked(transitionEmailOutboxRow).mock.calls
    expect(transitions).toHaveLength(3)
    for (const call of transitions) {
      expect(call[2]).toMatchObject({ status: 'sent' })
    }
  })

  it('drain-time suppression → status suppressed, provider never called', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([makeRow()])
    vi.mocked(isEmailSuppressed).mockResolvedValue(true)

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.suppressed).toBe(1)
    expect(summary.sent).toBe(0)
    expect(mockProvider.getSends()).toHaveLength(0)
    expect(vi.mocked(transitionEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      { status: 'suppressed' },
    )
  })

  it('transient failure (attempts remaining) → pending, attempts+1, next_attempt_at set, retried+=1', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([makeRow({ attempts: 0 })])
    mockProvider.failNextSend('provider_rate_limit')

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.retried).toBe(1)
    expect(summary.failed).toBe(0)
    expect(vi.mocked(transitionEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        next_attempt_at: expect.any(String),
      }),
    )
  })

  it('transient failure at MAX attempts (attempts=2, MAX=3) → failed, Sentry captured', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([makeRow({ attempts: 2 })])
    mockProvider.failNextSend('provider_rate_limit')

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.failed).toBe(1)
    expect(summary.retried).toBe(0)
    expect(vi.mocked(transitionEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      expect.objectContaining({ status: 'failed', attempts: 3 }),
    )
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled()
  })

  it('terminal failure (invalid_recipient) → failed, Sentry captured', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([makeRow()])
    mockProvider.failNextSend('invalid_recipient')

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.failed).toBe(1)
    expect(vi.mocked(transitionEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      expect.objectContaining({ status: 'failed' }),
    )
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled()
  })

  it('template_render_failed → failed, Sentry captured, provider never called', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([makeRow()])
    vi.mocked(renderTemplate).mockRejectedValue(
      new EmailProviderError('template_render_failed', 'Props validation failed', {}),
    )

    const summary = await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(summary.failed).toBe(1)
    expect(mockProvider.getSends()).toHaveLength(0)
    expect(vi.mocked(transitionEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      expect.objectContaining({ status: 'failed' }),
    )
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled()
  })

  it('idempotency-key sent to provider equals the outbox row id', async () => {
    const row = makeRow({ id: 'idempotency-row-uuid' })
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([row])

    await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(mockProvider.getSends()[0].idempotencyKey).toBe('idempotency-row-uuid')
  })

  it('emits canonical log line with all summary fields and triggeredBy', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runEmailDrainTick({ triggeredBy: 'secret' })

    const raw = consoleSpy.mock.calls.at(-1)?.[0]
    const log = JSON.parse(String(raw))
    expect(log.kind).toBe('email.drain.tick')
    expect(log.triggeredBy).toBe('secret')
    expect(typeof log.claimed).toBe('number')
    expect(typeof log.sent).toBe('number')
    expect(typeof log.retried).toBe('number')
    expect(typeof log.failed).toBe('number')
    expect(typeof log.suppressed).toBe('number')
    expect(typeof log.durationMs).toBe('number')
  })

  it('Sentry.withMonitor called with drain-email-outbox slug and exact ADR 0008 §9 options', async () => {
    vi.mocked(claimEmailOutboxBatch).mockResolvedValue([])

    await runEmailDrainTick({ triggeredBy: 'qstash' })

    expect(vi.mocked(Sentry.withMonitor)).toHaveBeenCalledWith(
      'drain-email-outbox',
      expect.any(Function),
      {
        schedule: { type: 'crontab', value: '* * * * *' },
        checkinMargin: 2,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  })
})
