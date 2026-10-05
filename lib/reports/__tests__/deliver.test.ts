import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0031 §5.4, REPORT-MEMBERS-ONLY (Tier-2): who is mailed, to what address, with what token, and what is NOT sent.

const order: string[] = vi.hoisted(() => [])
const getBusiness = vi.hoisted(() => vi.fn())
const resolveRecipients = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
const capture = vi.hoisted(() => vi.fn())

vi.mock('@/lib/config', () => ({ config: { server: { APP_URL: 'https://app.example.test' } } }))
vi.mock('@sentry/nextjs', () => ({ captureException: capture }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessByIdForWorker: getBusiness }))
vi.mock('@/lib/db/business-members', () => ({ resolveReportRecipients: resolveRecipients }))
vi.mock('@/lib/email/enqueue', () => ({ enqueueEmail: enqueue }))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string, params?: Record<string, unknown>) =>
    `[${locale}] ${key} ${JSON.stringify(params ?? {})}`,
}))

import { deliverMonthlyReport, REPORT_EMAIL_MAX_LINES, type DeliveredReport } from '../deliver'

const BUSINESS_A = '11111111-1111-4111-8111-111111111111'
const report: DeliveredReport = {
  businessId: BUSINESS_A,
  period: '2026-09',
  summary: [
    { key: 'analytics.activity.total', params: { count: 12, prev: 9 } },
    { key: 'analytics.typical.number', params: { n: 8, rate: '4.2%' } },
  ],
}
const OWNER = { id: 'member-owner', email: 'owner@example.com' }
const EDITOR = { id: 'member-editor', email: 'editor@example.com' }

function business(over: Record<string, unknown> = {}) {
  return { id: BUSINESS_A, name: 'Acme', language: 'pt', report_email: 'admins', ...over }
}

beforeEach(() => {
  order.length = 0
  getBusiness.mockReset().mockImplementation(async () => (order.push('business'), business()))
  resolveRecipients.mockReset().mockImplementation(async () => (order.push('resolve'), [OWNER, EDITOR]))
  enqueue.mockReset().mockImplementation(async () => (order.push('enqueue'), { outcome: 'enqueued', row_id: 'row' }))
  capture.mockReset()
})

describe('who is mailed, and to what address', () => {
  it('enqueues one monthly-report per resolved member, to the address on the member row, in the business language', async () => {
    const result = await deliverMonthlyReport(report)
    expect(result).toEqual({ recipients: 2, enqueued: 2, deduped: 0, suppressed: 0, errors: 0 })
    expect(enqueue).toHaveBeenCalledTimes(2)
    const [first, second] = enqueue.mock.calls.map((c) => c[0])
    expect(first).toMatchObject({ business_id: BUSINESS_A, kind: 'monthly-report', recipient: 'owner@example.com', locale: 'pt' })
    expect(second).toMatchObject({ recipient: 'editor@example.com' })
  })

  it('asks for the recipients of THIS business only, with the business setting', async () => {
    getBusiness.mockImplementation(async () => business({ report_email: 'all_members' }))
    await deliverMonthlyReport(report)
    expect(resolveRecipients).toHaveBeenCalledTimes(1)
    expect(resolveRecipients).toHaveBeenCalledWith(BUSINESS_A, 'all_members')
  })

  it("a business row without the column falls back to 'admins'", async () => {
    getBusiness.mockImplementation(async () => business({ report_email: undefined }))
    await deliverMonthlyReport(report)
    expect(resolveRecipients).toHaveBeenCalledWith(BUSINESS_A, 'admins')
  })

  it("'off' enqueues nothing (the resolver returns nobody) and reports zero recipients", async () => {
    getBusiness.mockImplementation(async () => business({ report_email: 'off' }))
    resolveRecipients.mockImplementation(async (_id: string, setting: string) => (setting === 'off' ? [] : [OWNER]))
    const result = await deliverMonthlyReport(report)
    expect(result).toEqual({ recipients: 0, enqueued: 0, deduped: 0, suppressed: 0, errors: 0 })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('re-resolves the recipients immediately before enqueueing (business, then resolve, then every enqueue)', async () => {
    await deliverMonthlyReport(report)
    expect(order).toEqual(['business', 'resolve', 'enqueue', 'enqueue'])
  })
})

describe('the dedupe token', () => {
  it('is report:{YYYY-MM}:{member id}: the immutable id, never the email', async () => {
    await deliverMonthlyReport(report)
    const tokens = enqueue.mock.calls.map((c) => c[0].dedupe_token)
    expect(tokens).toEqual(['report:2026-09:member-owner', 'report:2026-09:member-editor'])
    for (const token of tokens) expect(token).not.toContain('@')
  })

  it('differs by month, so September and October to the same member never collide', async () => {
    await deliverMonthlyReport(report)
    await deliverMonthlyReport({ ...report, period: '2026-10' })
    const tokens = enqueue.mock.calls.map((c) => c[0].dedupe_token)
    expect(new Set(tokens).size).toBe(4)
  })
})

describe('what the email carries', () => {
  it('the stored summary sentences rendered in the business language, the month label, the business name and the report link', async () => {
    await deliverMonthlyReport(report)
    const { props } = enqueue.mock.calls[0][0]
    expect(props.summaryLines).toEqual([
      '[pt] analytics.activity.total {"count":12,"prev":9}',
      '[pt] analytics.typical.number {"n":8,"rate":"4.2%"}',
    ])
    expect(props.businessName).toBe('Acme')
    expect(typeof props.periodLabel).toBe('string')
    expect(props.reportUrl).toBe('https://app.example.test/pt/analytics/reports/2026-09')
  })

  it('carries no member address, id or token inside the props (the recipient is a field of the outbox row, not of the message)', async () => {
    await deliverMonthlyReport(report)
    const raw = JSON.stringify(enqueue.mock.calls[0][0].props)
    expect(raw).not.toMatch(/owner@example\.com|editor@example\.com|member-owner/)
  })

  it(`shows at most ${REPORT_EMAIL_MAX_LINES} summary sentences`, async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: 'analytics.activity.total', params: { count: i, prev: 0 } }))
    await deliverMonthlyReport({ ...report, summary: many })
    expect(enqueue.mock.calls[0][0].props.summaryLines).toHaveLength(REPORT_EMAIL_MAX_LINES)
  })
})

describe('outcomes and failures', () => {
  it('counts deduped and suppressed enqueues separately', async () => {
    enqueue
      .mockResolvedValueOnce({ outcome: 'deduped', row_id: null })
      .mockResolvedValueOnce({ outcome: 'suppressed', row_id: 'r' })
    expect(await deliverMonthlyReport(report)).toEqual({ recipients: 2, enqueued: 0, deduped: 1, suppressed: 1, errors: 0 })
  })

  it('one failing member is captured and the others are still mailed', async () => {
    const boom = new Error('outbox down')
    enqueue.mockRejectedValueOnce(boom).mockResolvedValueOnce({ outcome: 'enqueued', row_id: 'r' })
    const result = await deliverMonthlyReport(report)
    expect(result).toEqual({ recipients: 2, enqueued: 1, deduped: 0, suppressed: 0, errors: 1 })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0]).toBe(boom)
    expect(JSON.stringify(capture.mock.calls[0][1])).not.toMatch(/@example\.com/)
  })

  it('no recipients: nothing is rendered or enqueued and the result is all zero', async () => {
    resolveRecipients.mockImplementation(async () => [])
    expect(await deliverMonthlyReport(report)).toEqual({ recipients: 0, enqueued: 0, deduped: 0, suppressed: 0, errors: 0 })
    expect(enqueue).not.toHaveBeenCalled()
  })
})
