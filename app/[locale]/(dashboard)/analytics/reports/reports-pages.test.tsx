// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ADR 0031 §5.4, §9.1, constraint #17 ANALYTICS-TENANT-BOUNDED (Tier-2 half): the report page reads the SERVER-SIDE active
// business and nothing a URL says. A user who belongs to businesses A and B, with A active, who asks for the period only B
// has, gets a 404 and never B's report. Plus the list page: newest first, the form for the owner only.

class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly to: string) {
    super('redirect ' + to)
  }
}

const getUser = vi.hoisted(() => vi.fn())
const getBusinessForUser = vi.hoisted(() => vi.fn())
const getReportByPeriod = vi.hoisted(() => vi.fn())
const listReports = vi.hoisted(() => vi.fn())
const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound()
  },
  redirect: (to: string) => {
    throw new Redirect(to)
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser }))
vi.mock('@/lib/db/analytics-reports', () => ({ getReportByPeriod, listReportIndex: listReports }))
vi.mock('./actions', () => ({ setReportEmailAction: vi.fn() }))
// The label readers the page resolves the payload's ids through (MINOR-7). The fake tables answer by id only, never by business.
const listCampaignNamesByIds = vi.hoisted(() => vi.fn())
const listAccountLabels = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/campaigns', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db/campaigns')>()), listCampaignNamesByIds }))
vi.mock('@/lib/db/social-accounts', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db/social-accounts')>()), listAccountLabels }))

import ReportPage from './[period]/page'
import ReportsPage from './page'

const A = { id: 'biz-a', name: 'Acme', owner_id: 'user-owner', plan: 'pro', timezone: 'Europe/Lisbon', report_email: 'admins' }
const row = (businessId: string, period: string, extra: Record<string, unknown> = {}) => ({
  id: 'r-' + businessId + '-' + period,
  business_id: businessId,
  period_month: period + '-01',
  tier: 'advanced',
  schema_version: 2,
  // The fields ReportBody reads (the page tests below render it): a header, a summary and the methodology keys.
  payload: {
    schemaVersion: 2,
    stub: false,
    period,
    timezone: 'Europe/Lisbon',
    outcomesThrough: '2026-04-10T06:00:00Z',
    generatedAt: '2026-04-10T06:00:00Z',
    tier: 'advanced',
    header: { key: 'analytics.report.header', params: { month: period, measuredAsOf: '2026-04-10T06:00:00Z', generatedOn: '2026-04-10T06:00:00Z' } },
    summary: [],
    methodology: { keys: [] },
    ...extra,
  },
  outcomes_through: '2026-04-10T06:00:00Z',
  generated_at: '2026-04-10T06:00:00Z',
})
// The fake database: what RLS plus `.eq('business_id', …)` would return. B has a 2026-02 report; A has 2026-03 and 2026-04.
const DB = [row('biz-a', '2026-03'), row('biz-a', '2026-04', { stub: true }), row('biz-b', '2026-02')]

beforeEach(() => {
  client.auth.getUser = getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-owner' } } })
  getBusinessForUser.mockReset().mockResolvedValue(A)
  listCampaignNamesByIds.mockReset().mockImplementation(async (_c: unknown, _b: string, ids: string[]) => ids.map((id) => ({ id, business_id: 'biz-a', name: 'Name of ' + id })))
  listAccountLabels.mockReset().mockImplementation(async (_c: unknown, _b: string, ids: string[]) => ids.map((id) => ({ id, business_id: 'biz-a', platform: 'twitter', platform_username: 'user_' + id, platform_display_name: null })))
  getReportByPeriod.mockReset().mockImplementation(async (_c: unknown, businessId: string, periodMonth: string) => DB.find((r) => r.business_id === businessId && r.period_month === periodMonth) ?? null)
  // The index reader returns id, month and the stub flag only: never a payload.
  listReports.mockReset().mockImplementation(async (_c: unknown, businessId: string) =>
    DB.filter((r) => r.business_id === businessId)
      .sort((a, b) => b.period_month.localeCompare(a.period_month))
      .map((r) => ({ id: r.id, period_month: r.period_month, stub: r.payload.stub === true })),
  )
})

const page = (period: string, locale = 'en') => ReportPage({ params: Promise.resolve({ locale, period }) })

describe('the report page is bound to the active business (closes #17, Tier 2)', () => {
  it("a user in A and B, with A active, asking for B's period gets a 404 and B's report is never read", async () => {
    await expect(page('2026-02')).rejects.toBeInstanceOf(NotFound)
    // The read was keyed on the SESSION business: it asked for A, never for B.
    expect(getReportByPeriod).toHaveBeenCalledTimes(1)
    expect(getReportByPeriod.mock.calls[0][1]).toBe('biz-a')
    expect(JSON.stringify(getReportByPeriod.mock.calls)).not.toContain('biz-b')
  })

  it("A's own period renders: the read is (client, the session business, YYYY-MM-01)", async () => {
    const el = (await page('2026-03')) as React.ReactElement
    expect(el).toBeTruthy()
    expect(getReportByPeriod).toHaveBeenCalledWith(client, 'biz-a', '2026-03-01')
  })

  it('the business is read from the SESSION user, and the params carry no business id at all', async () => {
    await page('2026-03')
    expect(getBusinessForUser).toHaveBeenCalledWith(client, 'user-owner')
  })

  it.each(['2026-13', '2026-00', '2026-3', 'abc', '2026-03-01', '../2026-03', '', '2026-03%00', '20260-03'])('rejects the period %j with a 404 before any database read', async (period) => {
    await expect(page(period)).rejects.toBeInstanceOf(NotFound)
    expect(getReportByPeriod).not.toHaveBeenCalled()
    expect(getBusinessForUser).not.toHaveBeenCalled()
  })

  it('a month with no report is a 404, not an empty page', async () => {
    await expect(page('2024-01')).rejects.toBeInstanceOf(NotFound)
  })

  it('a stored payload with a schema version this build does not read is a 404 (never reinterpreted)', async () => {
    getReportByPeriod.mockResolvedValue({ ...row('biz-a', '2026-03'), schema_version: 3 })
    await expect(page('2026-03')).rejects.toBeInstanceOf(NotFound)
    // Version 1 (names in the payload) never shipped and is not reinterpreted either.
    getReportByPeriod.mockResolvedValue({ ...row('biz-a', '2026-03'), schema_version: 1 })
    await expect(page('2026-03')).rejects.toBeInstanceOf(NotFound)
  })

  it('resolves the payload\'s ids for the SESSION business with the authenticated client, and hands ReportBody the business name and the labels (MINOR-7)', async () => {
    getReportByPeriod.mockResolvedValue(row('biz-a', '2026-03', { campaigns: [{ campaignId: 'c1', status: 'active', published: 2, href: '/campaigns/c1', retro: null }], activity: { total: 2, previousTotal: 0, campaigns: { withPosts: 1, retrospectivesCompleted: 0 }, rows: [{ platform: 'twitter', accountId: 'acc1', count: 2 }] } }))
    const el = (await page('2026-03')) as React.ReactElement<{ children: React.ReactNode }>
    const body = (React.Children.toArray(el.props.children) as React.ReactElement<{ proAllowed?: boolean; businessName?: string; labels?: { campaigns: Record<string, string>; accounts: Record<string, string> } }>[]).find((c) => c.props && 'proAllowed' in c.props)!
    expect(listCampaignNamesByIds).toHaveBeenCalledWith(client, 'biz-a', ['c1'])
    expect(listAccountLabels).toHaveBeenCalledWith(client, 'biz-a', ['acc1'])
    expect(body.props.businessName).toBe('Acme')
    expect(body.props.labels).toEqual({ campaigns: { c1: 'Name of c1' }, accounts: { acc1: 'user_acc1' } })
  })

  it('offers Download PDF (ADR §10.1): a plain download anchor to the PDF route for THIS report row, hidden in print, with the focus style', async () => {
    const out = renderToStaticMarkup((await page('2026-03')) as React.ReactElement)
    const m = /<a href="(\/api\/analytics\/reports\/[^"]+\/pdf)"([^>]*)>/.exec(out)
    expect(m, 'no Download PDF anchor').toBeTruthy()
    expect(m![1]).toBe('/api/analytics/reports/r-biz-a-2026-03/pdf')
    expect(m![2]).toContain('download')
    expect(m![2]).toContain('focus-visible:outline-foreground')
    // The action row is outside the report body and hidden in print, so it can never be in the PDF or on paper.
    expect(out).toMatch(/print:hidden[^>]*>[\s\S]*?\/pdf"/)
    expect(out).toContain('analytics.report.actions.pdf')
  })

  it('the PDF link uses the row id the SESSION business loaded, never a value from the URL (a different period gives that row\'s id)', async () => {
    const out = renderToStaticMarkup((await page('2026-04')) as React.ReactElement)
    expect(out).toContain('/api/analytics/reports/r-biz-a-2026-04/pdf')
    expect(out).not.toContain('r-biz-a-2026-03')
  })

  it('redirects an unauthenticated visitor to login and a user without a business to onboarding', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(page('2026-03')).rejects.toMatchObject({ to: '/en/login' })
    getUser.mockResolvedValue({ data: { user: { id: 'user-owner' } } })
    getBusinessForUser.mockResolvedValue(null)
    await expect(page('2026-03', 'pt')).rejects.toMatchObject({ to: '/pt/onboarding' })
    expect(getReportByPeriod).not.toHaveBeenCalled()
  })

  it('gates the Pro sections on the CURRENT plan: pro allows them, plus does not (A-5)', async () => {
    const proEl = (await page('2026-03')) as React.ReactElement<{ children: React.ReactNode }>
    const body = (el: React.ReactElement<{ children: React.ReactNode }>) => (React.Children.toArray(el.props.children) as React.ReactElement<{ proAllowed?: boolean }>[]).find((c) => c.props && 'proAllowed' in c.props)!
    expect(body(proEl).props.proAllowed).toBe(true)
    getBusinessForUser.mockResolvedValue({ ...A, plan: 'plus' })
    expect(body((await page('2026-03')) as React.ReactElement<{ children: React.ReactNode }>).props.proAllowed).toBe(false)
    getBusinessForUser.mockResolvedValue({ ...A, plan: 'a-plan-nobody-heard-of' })
    expect(body((await page('2026-03')) as React.ReactElement<{ children: React.ReactNode }>).props.proAllowed).toBe(false)
  })
})

describe('the list page', () => {
  const html = async (over: Record<string, unknown> = {}, userId = 'user-owner') => {
    getUser.mockResolvedValue({ data: { user: { id: userId } } })
    getBusinessForUser.mockResolvedValue({ ...A, ...over })
    return renderToStaticMarkup((await ReportsPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement)
  }

  it("lists only the active business's reports, newest first, each linking to its period", async () => {
    const out = await html()
    expect(listReports).toHaveBeenCalledWith(client, 'biz-a')
    const hrefs = [...out.matchAll(/href="(\/en\/analytics\/reports\/[^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual(['/en/analytics/reports/2026-04', '/en/analytics/reports/2026-03'])
    expect(out).not.toContain('2026-02')
  })

  it('marks a stub month as having no posts', async () => {
    const out = await html()
    expect(out).toContain('analytics.report.list.stub')
    expect(out).toContain('analytics.report.list.open')
  })

  it('the OWNER gets the setting form with the current value selected', async () => {
    const out = await html({ report_email: 'all_members' })
    expect(out).toContain('<select')
    expect(out).toMatch(/<option[^>]*value="all_members"[^>]*selected|selected=""[^>]*value="all_members"|value="all_members"[^>]*selected/)
  })

  it('a member who is not the owner gets no form, only the current value in words', async () => {
    const out = await html({ report_email: 'off' }, 'user-admin')
    expect(out).not.toContain('<select')
    expect(out).not.toContain('<form')
    expect(out).toContain('analytics.report.setting.current')
    expect(out).toContain('analytics.report.setting.option.off')
  })

  it('a business without the column yet reads as admins; an empty list shows the empty state', async () => {
    listReports.mockResolvedValue([])
    const out = await html({ report_email: undefined })
    expect(out).toContain('analytics.report.list.empty')
    expect(out).not.toContain('<ul class="divide-y')
  })
})
