import { describe, it, expect, vi } from 'vitest'
import { BUSINESS_A_ID, BUSINESS_B_ID } from '@/lib/analytics/__fixtures__/portfolio'
import type { Readers } from '@/lib/analytics/load'
import type { AnalyticsReportInsert } from '@/lib/db/analytics-reports'
import { generateReportForBusiness, runReportTick, type GenerateDeps } from '../generate'
import { TenantMismatchError } from '../isolation'
import { fixtureReaders } from '../__fixtures__/readers'

// ADR 0031 §5.2, §5.6, §9.3 — generating one business's report and running the tick. The db is faked in memory: the
// unique key behaves like the table's, so a second run really returns inserted = false.
const DUE = '2026-04-10T06:00:00Z' // Lisbon 07:00 on day 10, Sao Paulo 03:00 on day 10: due for March
const loaderDeps = { retrievePatterns: async () => [] }

function memory(over: Partial<GenerateDeps> = {}) {
  const rows: AnalyticsReportInsert[] = []
  const keys = new Set<string>()
  const insert = vi.fn(async (row: AnalyticsReportInsert) => {
    const key = row.business_id + '|' + row.period_month
    if (keys.has(key)) return false
    keys.add(key)
    rows.push(row)
    return true
  })
  const deps: Partial<GenerateDeps> = {
    readers: fixtureReaders(),
    loaderDeps,
    trialStartedAt: async (businessId) => ({ business_id: businessId, trial_started_at: null }),
    reportExists: async () => false,
    insert,
    ...over,
  }
  return { rows, insert, deps }
}

const withBusiness = (readers: Readers, patch: Record<string, unknown>): Readers => ({
  ...readers,
  getBusinessById: async (id) => ({ ...(await readers.getBusinessById(id)), ...patch }) as never,
})

describe('due', () => {
  it('day 9 local is not due and inserts nothing', async () => {
    const m = memory()
    expect(await generateReportForBusiness(BUSINESS_A_ID, '2026-04-09T22:59:59Z', m.deps)).toEqual({ status: 'not_due', inserted: false })
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('day 10 local (and 06:00Z) is due: March is generated', async () => {
    const m = memory()
    const out = await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: false, tier: 'advanced', period: '2026-03' })
    expect(m.rows[0].period_month).toBe('2026-03-01')
  })

  it('Pacific/Auckland at local day 10 but before 06:00Z is not due; at 06:00Z it is', async () => {
    const m = memory({ readers: withBusiness(fixtureReaders(), { timezone: 'Pacific/Auckland' }) })
    expect((await generateReportForBusiness(BUSINESS_A_ID, '2026-04-10T05:59:59Z', m.deps)).status).toBe('not_due')
    expect((await generateReportForBusiness(BUSINESS_A_ID, '2026-04-10T06:00:00Z', m.deps)).status).toBe('generated')
  })

  it('M-2 is never generated: later in the month the report is still for the month before, not two before', async () => {
    const m = memory()
    await generateReportForBusiness(BUSINESS_A_ID, '2026-05-20T12:00:00Z', m.deps)
    expect(m.rows.map((r) => r.period_month)).toEqual(['2026-04-01'])
  })
})

describe('eligible: live trial or live paid only (REPORT-ELIGIBLE-LIVE-ONLY)', () => {
  const bare = (patch: Record<string, unknown>, trialStartedAt: string | null = null) =>
    memory({ readers: withBusiness(fixtureReaders(), patch), trialStartedAt: async (id) => ({ business_id: id, trial_started_at: trialStartedAt }) })

  it('a CANCELLED business (plan trial, no subscription, an old trial clock) is skipped: no report, no stub', async () => {
    const m = bare({ plan: 'trial', stripe_subscription_id: null }, '2026-01-01T00:00:00Z')
    expect(await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).toEqual({ status: 'ineligible', inserted: false })
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('a trial whose clock never started is skipped', async () => {
    expect((await generateReportForBusiness(BUSINESS_A_ID, DUE, bare({ plan: 'trial', stripe_subscription_id: null }, null).deps)).status).toBe('ineligible')
  })

  it('a LIVE TRIAL (started 5 days ago) gets a BASIC report', async () => {
    const m = bare({ plan: 'trial', stripe_subscription_id: null }, '2026-04-05T06:00:00Z')
    expect(await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).toMatchObject({ status: 'generated', tier: 'basic' })
  })

  it('a lapsed paid business (no subscription) is skipped', async () => {
    expect((await generateReportForBusiness(BUSINESS_A_ID, DUE, bare({ plan: 'pro', stripe_subscription_id: null }).deps)).status).toBe('ineligible')
  })

  it('an UNKNOWN plan on a live business gets the BASIC report, never none', async () => {
    const m = bare({ plan: 'enterprise', stripe_subscription_id: 'sub_1' })
    expect(await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).toMatchObject({ status: 'generated', tier: 'basic' })
    expect(m.rows[0].tier).toBe('basic')
  })

  it('a trial_state row of ANOTHER business throws', async () => {
    const m = memory({ trialStartedAt: async () => ({ business_id: BUSINESS_B_ID, trial_started_at: null }) })
    await expect(generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).rejects.toThrow(/another business/)
  })
})

describe('what is stored (REPORT-ONE-PER-PERIOD, REPORT-FALLBACK)', () => {
  it('the row\'s business_id and tier are the LOOP variable and the plan read, and the payload agrees', async () => {
    const m = memory({ readers: withBusiness(fixtureReaders(), { plan: 'plus' }) })
    await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)
    expect(m.rows[0]).toMatchObject({ business_id: BUSINESS_A_ID, tier: 'basic', schema_version: 1, outcomes_through: DUE, generated_at: DUE })
    expect((m.rows[0].payload as { tier: string }).tier).toBe('basic')
  })

  it('a SECOND run inserts nothing: the probe says it exists', async () => {
    const m = memory()
    expect((await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).inserted).toBe(true)
    m.deps.reportExists = async () => m.rows.length > 0
    expect(await generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).toEqual({ status: 'exists', inserted: false })
    expect(m.rows).toHaveLength(1)
  })

  it('two OVERLAPPING runs (the probe says no to both): the loser\'s insert returns false', async () => {
    const m = memory()
    const [a, b] = await Promise.all([generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps), generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)])
    expect([a, b].map((r) => (r.status === 'generated' ? r.inserted : null)).sort()).toEqual([false, true])
    expect(m.rows).toHaveLength(1)
  })

  it('an EMPTY month stores a STUB (inserted, stub = true) so the history has no gap', async () => {
    const m = memory()
    const out = await generateReportForBusiness(BUSINESS_A_ID, '2025-12-10T06:00:00Z', m.deps) // November 2025: nothing published
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: true, period: '2025-11' })
    expect((m.rows[0].payload as { stub: boolean }).stub).toBe(true)
  })

  it('every generated payload, the stub included, carries all eight methodology keys', async () => {
    const full = memory()
    const stub = memory()
    await generateReportForBusiness(BUSINESS_A_ID, DUE, full.deps)
    await generateReportForBusiness(BUSINESS_A_ID, '2025-12-10T06:00:00Z', stub.deps)
    for (const m of [full, stub]) expect((m.rows[0].payload as { methodology: { keys: string[] } }).methodology.keys).toHaveLength(8)
  })
})

describe('isolation: one mismatched row aborts that business\'s report (REPORT-RLS-ISOLATED)', () => {
  it('a planted B row in a worker read throws, and NO row is inserted for A', async () => {
    const real = fixtureReaders()
    const m = memory({
      readers: {
        ...real,
        listPublishedPostsInRange: async (id, r) => {
          const rows = await real.listPublishedPostsInRange(id, r)
          return [...rows, { ...rows[0], id: 'planted', business_id: BUSINESS_B_ID }]
        },
      },
    })
    await expect(generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)).rejects.toBeInstanceOf(TenantMismatchError)
    expect(m.insert).not.toHaveBeenCalled()
  })
})

describe('runReportTick', () => {
  const ids = (list: string[]) => async (after: string | null) => list.filter((i) => after === null || i > after)

  it('visits each business once, generates the due ones, and lists the non-stub ids (their email is O2.8\'s)', async () => {
    const m = memory()
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID, BUSINESS_B_ID]) })
    expect(s).toMatchObject({ scanned: 2, inserted: 2, stubs: 0, errors: 0, capped: false })
    expect(s.insertedBusinessIds).toEqual([BUSINESS_A_ID, BUSINESS_B_ID])
  })

  it('a stub is inserted but is not in the email list', async () => {
    const m = memory()
    const s = await runReportTick('2025-12-10T06:00:00Z', { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID]) })
    expect(s).toMatchObject({ inserted: 1, stubs: 1 })
    expect(s.insertedBusinessIds).toEqual([])
  })

  it('at most maxPerTick reports are generated; the rest wait for the next tick', async () => {
    const m = memory()
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID, BUSINESS_B_ID]), maxPerTick: 1 })
    expect(s).toMatchObject({ inserted: 1, capped: true })
  })

  it('one failing business never fails the tick: it is captured and the next one is processed', async () => {
    const real = fixtureReaders()
    const capture = vi.fn()
    const m = memory({
      readers: { ...real, getBusinessById: async (id) => { if (id === BUSINESS_A_ID) throw new Error('boom'); return real.getBusinessById(id) } },
    })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID, BUSINESS_B_ID]), capture })
    expect(s).toMatchObject({ errors: 1, inserted: 1 })
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { businessId: BUSINESS_A_ID })
    expect(m.rows.map((r) => r.business_id)).toEqual([BUSINESS_B_ID])
  })

  it('a mismatched row is CAPTURED and that business stores nothing, while the tick continues', async () => {
    const real = fixtureReaders()
    const capture = vi.fn()
    const m = memory({
      readers: {
        ...real,
        listPublishedPostsInRange: async (id, r) => {
          const rows = await real.listPublishedPostsInRange(id, r)
          return id === BUSINESS_A_ID ? [...rows, { ...rows[0], business_id: BUSINESS_B_ID }] : rows
        },
      },
    })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID, BUSINESS_B_ID]), capture })
    expect(capture.mock.calls[0][0]).toBeInstanceOf(TenantMismatchError)
    expect(s.errors).toBe(1)
    expect(m.rows.map((r) => r.business_id)).toEqual([BUSINESS_B_ID])
  })

  it('not-due and ineligible businesses are counted, never generated', async () => {
    const m = memory()
    const s = await runReportTick('2026-04-09T22:00:00Z', { ...m.deps, listBusinessIds: ids([BUSINESS_A_ID, BUSINESS_B_ID]) })
    expect(s).toMatchObject({ scanned: 2, notDue: 2, inserted: 0 })
    expect(m.insert).not.toHaveBeenCalled()
  })
})
