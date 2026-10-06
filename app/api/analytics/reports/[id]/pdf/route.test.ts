import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ADR 0031 §5.5, §9.5 — the PDF route. #14 ANALYTICS-PLAN-GATE-SERVER (third arm), #30 REPORT-PDF-ISOLATED (auth, business binding
// and plan gate run BEFORE Chromium launches), Tier 2. The launcher is a spy: every rejected path must leave it uncalled.

const order: string[] = vi.hoisted(() => [])
const getUser = vi.hoisted(() => vi.fn())
const getBusinessForUser = vi.hoisted(() => vi.fn())
const getReportById = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const capture = vi.hoisted(() => vi.fn())
const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() } }))

vi.mock('@sentry/nextjs', () => ({ captureException: capture }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => (order.push('client'), client) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser }))
vi.mock('@/lib/db/analytics-reports', () => ({ getReportById }))
// A Pro reader being called from the PDF route would be a bug: it renders the STORED payload and recomputes nothing. These are
// call-through spies (the fixture assembler below uses the real loader to build the stored payload), cleared after that build.
vi.mock('@/lib/analytics/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics/load')>()
  return { ...actual, loadPortfolio: vi.fn(actual.loadPortfolio), loadPortfolioWith: vi.fn(actual.loadPortfolioWith) }
})
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/reports/pdf-launch', () => ({ launchChromium: launch }))
// Call-through spy: lets a test assert the document was (or was not) built.
vi.mock('@/lib/reports/pdf-html', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports/pdf-html')>()
  return { ...actual, buildReportHtml: vi.fn(actual.buildReportHtml) }
})

import { GET } from './route'
import { PdfBusyError, PdfTimeoutError } from '@/lib/reports/pdf'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport } from '@/lib/reports/assemble'
import { fixtureReaders } from '@/lib/reports/__fixtures__/readers'
import type { PdfBrowser } from '@/lib/reports/pdf'
import * as load from '@/lib/analytics/load'
import * as pdfHtml from '@/lib/reports/pdf-html'

const REPORT_ID = '3f2b8a54-9c1d-4e0a-8a6b-7d5c2e1f9a10'
const OTHER_ID = '9a1c7e22-4b3d-4c5e-9f60-1a2b3c4d5e6f'
const A = { id: 'biz-a', plan: 'pro', timezone: 'Europe/Lisbon', language: 'en' }

let storedPayload: unknown
let setContentHtml: string | undefined

function fakeBrowser(): PdfBrowser {
  const page = {
    setJavaScriptEnabled: async () => undefined,
    setRequestInterception: async () => undefined,
    on: () => undefined,
    setContent: async (html: string) => void ((setContentHtml = html), order.push('setContent')),
    pdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  }
  return { createBrowserContext: async () => ({ newPage: async () => page, close: async () => undefined }), close: async () => undefined }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: REPORT_ID,
  business_id: 'biz-a',
  period_month: '2026-03-01',
  tier: 'advanced',
  schema_version: 1,
  payload: storedPayload,
  outcomes_through: MARCH_REPORT_OUTCOMES_THROUGH,
  generated_at: MARCH_REPORT_OUTCOMES_THROUGH,
  ...over,
})

const call = (id: string = REPORT_ID) => GET(new NextRequest('http://localhost/api/analytics/reports/' + id + '/pdf'), { params: Promise.resolve({ id }) })

beforeEach(async () => {
  order.length = 0
  setContentHtml = undefined
  storedPayload ??= (
    await assembleReport({
      readers: fixtureReaders({ patterns: [{ business_id: BUSINESS_A_ID, pattern_key: null, platform: 'twitter' as const, pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }] }),
      businessId: BUSINESS_A_ID,
      period: '2026-03',
      now: MARCH_REPORT_OUTCOMES_THROUGH,
    })
  ).payload
  client.auth.getUser = getUser.mockReset().mockImplementation(async () => (order.push('getUser'), { data: { user: { id: 'user-a' } } }))
  getBusinessForUser.mockReset().mockImplementation(async () => (order.push('business'), A))
  // The fake database: keyed on (business, id), exactly as RLS plus .eq('business_id') would answer.
  getReportById.mockReset().mockImplementation(async (_c: unknown, businessId: string, id: string) => (order.push('report'), businessId === 'biz-a' && id === REPORT_ID ? row() : null))
  launch.mockReset().mockImplementation(async () => (order.push('launch'), fakeBrowser()))
  capture.mockReset()
  vi.mocked(load.loadPortfolio).mockClear()
  vi.mocked(load.loadPortfolioWith).mockClear()
})

describe('every rejection happens BEFORE Chromium launches', () => {
  it.each([['not-a-uuid'], ['123'], [''], ['../../etc/passwd'], ['3f2b8a54-9c1d-4e0a-8a6b-7d5c2e1f9a1'], [REPORT_ID + 'x']])('an invalid id %j is a 404: no auth call, no database read, no launch', async (id) => {
    expect((await call(id)).status).toBe(404)
    expect(order).toEqual([])
    expect(launch).not.toHaveBeenCalled()
  })

  it('an unauthenticated request is a 401: no business or report is read, no launch', async () => {
    getUser.mockImplementation(async () => (order.push('getUser'), { data: { user: null } }))
    expect((await call()).status).toBe(401)
    expect(getBusinessForUser).not.toHaveBeenCalled()
    expect(getReportById).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('a user with no business is a 404, no launch', async () => {
    getBusinessForUser.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(getReportById).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it("ANOTHER business's report id is a 404 indistinguishable from an unknown one, and Chromium never launches", async () => {
    const other = await call(OTHER_ID)
    const unknown = await call('00000000-0000-4000-8000-000000000000')
    expect(other.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await other.text()).toBe(await unknown.text())
    // The read was keyed on the SESSION business, never on anything in the URL.
    for (const c of getReportById.mock.calls) expect(c[1]).toBe('biz-a')
    expect(launch).not.toHaveBeenCalled()
  })

  it('a session in business B cannot read business A\'s report even with A\'s real id', async () => {
    getBusinessForUser.mockResolvedValue({ ...A, id: 'biz-b' })
    expect((await call()).status).toBe(404)
    expect(getReportById.mock.calls[0][1]).toBe('biz-b')
    expect(launch).not.toHaveBeenCalled()
  })

  it('a payload schema this build does not read is a 404, and so is a malformed period', async () => {
    getReportById.mockResolvedValueOnce(row({ schema_version: 2 }))
    expect((await call()).status).toBe(404)
    getReportById.mockResolvedValueOnce(row({ period_month: '2026-13-01' }))
    expect((await call()).status).toBe(404)
    getReportById.mockResolvedValueOnce(row({ period_month: '2026-03-01; rm -rf' }))
    expect((await call()).status).toBe(404)
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('the order is auth, business, report, THEN the browser', () => {
  it('records getUser, business, report and only then the launch and the document', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(order).toEqual(['client', 'getUser', 'business', 'report', 'launch', 'setContent'])
  })

  it('the launcher is handed to the renderer only after the document is built (a build failure never launches)', async () => {
    getReportById.mockResolvedValueOnce(row({ payload: { schemaVersion: 1 } }))
    await expect(call()).rejects.toBeTruthy()
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('A-5 and #14: the plan gate on the PDF path', () => {
  it('a Pro business gets the Pro sections in the document', async () => {
    await call()
    expect(setContentHtml).toContain('id="trend-title"')
    expect(setContentHtml).toContain('id="patterns-title"')
    expect(setContentHtml).not.toContain('analytics.gated.prefix')
  })

  it('a business on a plan without Pro (a downgrade) gets the plain "Available on Pro" lines and none of the Pro content', async () => {
    getBusinessForUser.mockResolvedValue({ ...A, plan: 'plus' })
    expect((await call()).status).toBe(200)
    expect(setContentHtml).toContain('analytics.gated.prefix')
    expect(setContentHtml).not.toContain('Posts with a question opening beat your usual.')
    expect(setContentHtml).not.toContain('id="trend-posts"')
  })

  it('an unknown plan fails CLOSED to the basic document', async () => {
    getBusinessForUser.mockResolvedValue({ ...A, plan: 'enterprise-from-the-future' })
    await call()
    expect(setContentHtml).toContain('analytics.gated.prefix')
  })

  it('no Pro reader is called: the route renders the STORED payload and recomputes nothing', async () => {
    await call()
    getBusinessForUser.mockResolvedValue({ ...A, plan: 'plus' })
    await call()
    expect(load.loadPortfolio).not.toHaveBeenCalled()
    expect(load.loadPortfolioWith).not.toHaveBeenCalled()
  })
})

describe('the response', () => {
  it('is the PDF bytes, an attachment named for the period, uncacheable, and not sniffable', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="report-2026-03.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-')
  })

  it('hands the browser one string document with the CSP meta, and nothing from the request', async () => {
    await call()
    expect(typeof setContentHtml).toBe('string')
    expect(setContentHtml).toContain('Content-Security-Policy')
    expect(setContentHtml).not.toContain(REPORT_ID)
    expect(setContentHtml).not.toContain('localhost')
  })
})

describe('a saturated instance refuses BEFORE it builds anything', () => {
  it('with one render running and two waiting, the route answers 503 without building the document or touching the launcher', async () => {
    const { renderPdf } = await import('@/lib/reports/pdf')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = async () => (await gate, fakeBrowser())
    const held = [0, 1, 2].map(() => renderPdf('<html></html>', { launch: slow }))
    launch.mockClear()
    vi.mocked(pdfHtml.buildReportHtml).mockClear()
    const res = await call()
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('10')
    // The point of asking early: no HTML build and no CSS compile were spent on a request that is going to be refused.
    expect(pdfHtml.buildReportHtml).not.toHaveBeenCalled()
    expect(setContentHtml).toBeUndefined()
    expect(launch).not.toHaveBeenCalled()
    release()
    await Promise.all(held)
  })
})

describe('failures are mapped and never leak', () => {
  it('a busy renderer is a 503 with Retry-After', async () => {
    launch.mockImplementation(async () => { throw new PdfBusyError() })
    const res = await call()
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('10')
  })

  it('a timeout is a 504', async () => {
    launch.mockImplementation(async () => { throw new PdfTimeoutError() })
    expect((await call()).status).toBe(504)
  })

  it('any other failure is a 500 with a bare body, captured with a tag and NO report content, id or business', async () => {
    launch.mockImplementation(async () => { throw new Error('chromium crashed for biz-a and ' + REPORT_ID) })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][1]).toEqual({ tags: { route: 'report-pdf' } })
  })
})
