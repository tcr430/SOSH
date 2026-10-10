import { describe, it, expect, vi } from 'vitest'
import { readAllPages, ReadCeilingExceeded } from '@/lib/db/keyset-pager'
import type { PublishedPostForAnalytics } from '@/lib/db/posts'
import { BUSINESS_A_ID, FIXTURE_NOW } from '../__fixtures__/portfolio'
import { fixtureReaders } from '@/lib/reports/__fixtures__/readers'
import { generateReportForBusiness, runReportTick, type GenerateDeps } from '@/lib/reports/generate'
import { loadPortfolioWith, type AdvancedPortfolio, type Readers } from '../load'
import type { AnalyticsReportInsert } from '@/lib/db/analytics-reports'

// Session 37-D D5 (MINOR-11, ADR 0031 s2.7 / constraint #36): "an error state, never a number" proven END TO END. The readers below run
// the REAL readAllPages over an in-memory paged source (the O2.1 fixture's published posts in A's two-month window: 13 in March and
// 5 in February = 18), and the ceiling reaches it through the loader's own dependencies. The pager unit tests pin the constant and the
// page arithmetic; these pin the COMPOSITION: pager -> reader -> loader -> section -> report.

const RANGE_PAGE = 5

function pagedReaders(): Readers {
  const base = fixtureReaders()
  return {
    ...base,
    listPublishedPostsInRange: async (businessId, range, opts) => {
      const rows = await base.listPublishedPostsInRange(businessId, range)
      return readAllPages<PublishedPostForAnalytics>({
        read: 'published posts in the month',
        pageSize: RANGE_PAGE,
        ceiling: opts?.ceiling,
        fetchPage: async (after, limit) => {
          const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0
          return rows.slice(start, start + limit)
        },
      })
    },
  }
}

const load = (readCeiling?: number) => loadPortfolioWith(pagedReaders(), BUSINESS_A_ID, '2026-03', { now: () => FIXTURE_NOW, ...(readCeiling === undefined ? {} : { readCeiling }) })

describe('the loader over the real pager (MINOR-11)', () => {
  it('control: at the default ceiling the same readers give the numbers (13 published in March)', async () => {
    const p = await load()
    expect(p.activity).toMatchObject({ status: 'ok', data: { total: 13, previousTotal: 5 } })
  })

  it('18 posts in the window and a ceiling of 17 -> the sections are the error state; at exactly 18 it is a number', async () => {
    expect((await load(18)).activity.status).toBe('ok')
    const p = await load(17)
    expect(p.activity).toEqual({ status: 'error', reason: 'ceiling' })
    expect(p.platforms).toEqual({ status: 'error', reason: 'ceiling' })
    expect(p.campaigns).toEqual({ status: 'error', reason: 'ceiling' })
  })

  it('ceiling 10 over the 18 posts: the error state, and no figure of the activity appears anywhere in the view model', async () => {
    const p = (await load(10)) as AdvancedPortfolio
    expect(p.activity).toEqual({ status: 'error', reason: 'ceiling' })
    const text = JSON.stringify(p)
    for (const key of ['"total"', '"previousTotal"', '"rows"', '"withPosts"', '"retrospectivesCompleted"', '"published"']) expect(text).not.toContain(key)
  })
})

describe('the report generator over the real pager (MINOR-11)', () => {
  function deps(inserts: AnalyticsReportInsert[], readCeiling?: number): Partial<GenerateDeps> {
    return {
      readers: pagedReaders(),
      loaderDeps: readCeiling === undefined ? undefined : { readCeiling },
      trialStartedAt: async (businessId) => ({ business_id: businessId, trial_started_at: null }),
      reportExists: async () => false,
      redeliveryOf: async () => null,
      insert: async (row) => (inserts.push(row), true),
    }
  }
  const DUE = '2026-04-10T06:00:00Z'

  it('control: at the default ceiling the report is stored', async () => {
    const inserts: AnalyticsReportInsert[] = []
    expect(await generateReportForBusiness(BUSINESS_A_ID, DUE, deps(inserts))).toMatchObject({ status: 'generated', inserted: true })
    expect(inserts).toHaveLength(1)
  })

  it('ceiling 10: NO analytics_reports row is inserted, and the tick records the business as errored', async () => {
    const inserts: AnalyticsReportInsert[] = []
    const capture = vi.fn()
    const summary = await runReportTick(DUE, { ...deps(inserts, 10), listBusinessIds: async (after) => (after === null || after < BUSINESS_A_ID ? [BUSINESS_A_ID] : []), scanOffset: '00000000-0000-0000-0000-000000000000', capture })
    expect(inserts).toEqual([])
    expect(summary).toMatchObject({ errors: 1, inserted: 0, scanned: 1 })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(String((capture.mock.calls[0][0] as Error).message)).toContain('exceeded its ceiling')
  })

  it('the pager error itself is the typed ReadCeilingExceeded (not a generic failure)', async () => {
    await expect(pagedReaders().listPublishedPostsInRange(BUSINESS_A_ID, { start: '2026-02-01T00:00:00Z', end: '2026-04-01T00:00:00Z' }, { ceiling: 10 })).rejects.toBeInstanceOf(ReadCeilingExceeded)
  })
})
