import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReportTickSummary } from '../generate'

// ADR 0031 §5.4: the job mails ONLY the reports the tick inserted and that are not stubs.

const withMonitor = vi.hoisted(() => vi.fn((...args: [slug: string, fn: () => unknown, config: unknown]) => args[1]()))
const captureException = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => ({ withMonitor, captureException }))
// deliver.ts is injected below, but job.ts imports its symbols at load: keep that import free of config and i18n.
vi.mock('../deliver', () => ({ deliverMonthlyReport: vi.fn() }))

import { runReportJob } from '../job'

const NOW = '2026-10-10T07:20:00Z'

function tickSummary(over: Partial<ReportTickSummary> = {}): ReportTickSummary {
  return {
    scanned: 3, notDue: 0, ineligible: 0, exists: 0, inserted: 0, stubs: 0, raced: 0, errors: 0, capped: false,
    insertedBusinessIds: [], insertedReports: [],
    ...over,
  }
}
const sum = (businessId: string) => ({ businessId, period: '2026-09', summary: [{ key: 'analytics.activity.total', params: { count: 1, prev: 0 } }] })

const tick = vi.fn()
const deliver = vi.fn()
const capture = vi.fn()

beforeEach(() => {
  tick.mockReset().mockResolvedValue(tickSummary())
  deliver.mockReset().mockResolvedValue({ recipients: 2, enqueued: 2, deduped: 0, suppressed: 0, errors: 0 })
  capture.mockReset()
  withMonitor.mockClear()
  captureException.mockClear()
})

describe('runReportJob', () => {
  it('delivers exactly the reports the tick inserted (one deliver per report), and passes the tick instant through', async () => {
    tick.mockResolvedValue(tickSummary({ inserted: 2, insertedBusinessIds: ['a', 'b'], insertedReports: [sum('a'), sum('b')] }))
    const out = await runReportJob(NOW, { tick, deliver, capture })
    expect(tick).toHaveBeenCalledWith(NOW, undefined)
    expect(deliver.mock.calls.map((c) => c[0].businessId)).toEqual(['a', 'b'])
    expect(out.emails).toEqual({ recipients: 4, enqueued: 4, deduped: 0, suppressed: 0, errors: 0 })
  })

  it('mails nothing when the tick inserted nothing (a replay, a lost race, stub months and not-due businesses)', async () => {
    tick.mockResolvedValue(tickSummary({ exists: 2, raced: 1, stubs: 1, inserted: 1, insertedBusinessIds: [], insertedReports: [] }))
    const out = await runReportJob(NOW, { tick, deliver, capture })
    expect(deliver).not.toHaveBeenCalled()
    expect(out.emails).toEqual({ recipients: 0, enqueued: 0, deduped: 0, suppressed: 0, errors: 0 })
  })

  it('one failing delivery is captured with only the business id and the others still run', async () => {
    tick.mockResolvedValue(tickSummary({ insertedReports: [sum('a'), sum('b')] }))
    const boom = new Error('business read failed')
    deliver.mockRejectedValueOnce(boom)
    const out = await runReportJob(NOW, { tick, deliver, capture })
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(capture).toHaveBeenCalledWith(boom, { businessId: 'a' })
    expect(out.emails.errors).toBe(1)
    expect(out.emails.enqueued).toBe(2)
  })

  it('sums the per-business delivery counters, deduped and suppressed included', async () => {
    tick.mockResolvedValue(tickSummary({ insertedReports: [sum('a'), sum('b')] }))
    deliver
      .mockResolvedValueOnce({ recipients: 3, enqueued: 1, deduped: 1, suppressed: 1, errors: 0 })
      .mockResolvedValueOnce({ recipients: 1, enqueued: 0, deduped: 0, suppressed: 0, errors: 1 })
    expect((await runReportJob(NOW, { tick, deliver, capture })).emails).toEqual({ recipients: 4, enqueued: 1, deduped: 1, suppressed: 1, errors: 1 })
  })

  it('returns the tick counters and the instant, and NEVER the business ids or the summary lines (counts only)', async () => {
    tick.mockResolvedValue(tickSummary({ inserted: 1, insertedBusinessIds: ['secret-business'], insertedReports: [sum('secret-business')] }))
    const out = await runReportJob(NOW, { tick, deliver, capture })
    expect(out).toMatchObject({ scanned: 3, inserted: 1, capped: false, tick: NOW })
    expect(JSON.stringify(out)).not.toMatch(/secret-business|analytics\.activity/)
    expect(Object.keys(out)).not.toContain('insertedBusinessIds')
    expect(Object.keys(out)).not.toContain('insertedReports')
  })
})

describe('the Sentry monitor', () => {
  it('wraps the job in the generate-reports monitor on the hourly :20 schedule', async () => {
    await runReportJob(NOW, { tick, deliver, capture })
    expect(withMonitor).toHaveBeenCalledTimes(1)
    expect(withMonitor.mock.calls[0][0]).toBe('generate-reports')
    expect(withMonitor.mock.calls[0][2]).toMatchObject({ schedule: { type: 'crontab', value: '20 * * * *' } })
  })

  it('the default capture reports to Sentry tagged with the worker and phase', async () => {
    tick.mockResolvedValue(tickSummary({ insertedReports: [sum('a')] }))
    const boom = new Error('x')
    deliver.mockRejectedValueOnce(boom)
    await runReportJob(NOW, { tick, deliver })
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { worker: 'generate-reports', phase: 'deliver' }, extra: { businessId: 'a' } })
  })
})
