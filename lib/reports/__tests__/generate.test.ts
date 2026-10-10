import { describe, it, expect, vi } from 'vitest'
import { BUSINESS_A_ID, BUSINESS_B_ID } from '@/lib/analytics/__fixtures__/portfolio'
import type { Readers } from '@/lib/analytics/load'
import type { AnalyticsReportInsert } from '@/lib/db/analytics-reports'
import { generateReportForBusiness, reportScanOffset, runReportTick, type GenerateDeps } from '../generate'
import { REPORT_ERROR_CAP, REPORT_SCAN_CAP } from '../constants'
import { TenantMismatchError } from '../isolation'
import { fixtureReaders } from '../__fixtures__/readers'

// ADR 0031 §5.2, §5.6, §9.3 — generating one business's report and running the tick. The db is faked in memory: the
// unique key behaves like the table's, so a second run really returns inserted = false.
const DUE = '2026-04-10T06:00:00Z' // Lisbon 07:00 on day 10, Sao Paulo 03:00 on day 10: due for March

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
    trialStartedAt: async (businessId) => ({ business_id: businessId, trial_started_at: null }),
    reportExists: async () => false,
    redeliveryOf: async () => null,
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
    expect(m.rows[0]).toMatchObject({ business_id: BUSINESS_A_ID, tier: 'basic', schema_version: 2, outcomes_through: DUE, generated_at: DUE })
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
    expect(s).toMatchObject({ inserted: 1, capped: true, reason: 'generation_cap' })
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

// ─── MAJOR-5 (Session 37-D D4): the tick wraps from a per-hour offset, errors have their own cap, a capped tick says so ───────────────

// ids spread evenly over the WHOLE uuid space, so a per-hour offset really lands among them (ids near zero would never be wrapped).
const spread = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    const hex = ((BigInt(i) * BigInt('0x1' + '0'.repeat(32))) / BigInt(n)).toString(16).padStart(32, '0')
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
  })
// A pager that honours the cursor AND the limit, like businesses.listBusinessIdsPage.
const pager = (sorted: string[]) => async (after: string | null, limit: number) => sorted.filter((i) => after === null || i > after).slice(0, limit)
const ZERO = '00000000-0000-0000-0000-000000000000'
const hoursAfter = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3_600_000).toISOString().replace('.000Z', 'Z')

// Readers for a synthetic fleet: ids in `due` are live Pro businesses (a stub report is generated for them: the fixture holds no posts
// for an unknown id); every other id is a trial whose clock never started (ineligible); ids in `failing` throw.
function fleetReaders(due: Set<string>, failing: Set<string> = new Set(), seen?: string[]): Readers {
  const real = fixtureReaders()
  return {
    ...real,
    getBusinessById: async (id) => {
      seen?.push(id)
      if (failing.has(id)) throw new Error('boom ' + id)
      const base = await real.getBusinessById(BUSINESS_A_ID)
      return { ...base, id, plan: due.has(id) ? 'pro' : 'trial', stripe_subscription_id: due.has(id) ? 'sub_x' : null } as never
    },
  }
}

describe('runReportTick wraps from a per-hour offset (MAJOR-5)', () => {
  it('the offset is a uuid, stable within an hour and different the next hour', () => {
    const a = reportScanOffset('2026-10-10T07:20:00Z')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(reportScanOffset('2026-10-10T07:59:59Z')).toBe(a)
    expect(reportScanOffset('2026-10-10T08:00:00Z')).not.toBe(a)
  })

  it('2,100 candidates, only the LAST due: a tick that cannot reach it says capped, and the exact tick the offsets reach it generates it', async () => {
    const all = spread(2100)
    const last = all[all.length - 1]
    const m = memory({ readers: fleetReaders(new Set([last])) })
    // The scan visits ids above the offset, then the ids at or below it: the last id's place in that order.
    const rank = (offset: string) => (offset < last ? all.filter((i) => i > offset).length - 1 : all.length - 1)
    const at = (k: number) => hoursAfter(DUE, k)
    let start = 0
    while (rank(reportScanOffset(at(start))) < REPORT_SCAN_CAP) start += 1
    expect(start).toBeLessThan(400) // the same month, so every tick is "due"
    let expectedTick = start + 1
    while (rank(reportScanOffset(at(expectedTick))) >= REPORT_SCAN_CAP) expectedTick += 1

    let generatedAt: number | null = null
    for (let k = start; k <= expectedTick; k += 1) {
      const s = await runReportTick(at(k), { ...m.deps, listBusinessIds: pager(all) })
      if (m.rows.some((r) => r.business_id === last)) {
        generatedAt = k
        break
      }
      expect(s).toMatchObject({ capped: true, reason: 'scan_cap', scanned: REPORT_SCAN_CAP })
    }
    expect(generatedAt).toBe(expectedTick)
  })

  it('a tick that sees every business is not capped', async () => {
    const all = spread(150)
    const m = memory({ readers: fleetReaders(new Set()) })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all) })
    expect(s).toMatchObject({ scanned: 150, ineligible: 150, capped: false, reason: null })
  })

  it('exactly REPORT_SCAN_CAP businesses: all are visited and the tick is NOT capped; one more and it is, with the scan reason', async () => {
    const exact = spread(REPORT_SCAN_CAP)
    const m1 = memory({ readers: fleetReaders(new Set()) })
    const s1 = await runReportTick(DUE, { ...m1.deps, listBusinessIds: pager(exact) })
    expect(s1).toMatchObject({ scanned: REPORT_SCAN_CAP, capped: false, reason: null })
    const m2 = memory({ readers: fleetReaders(new Set()) })
    const s2 = await runReportTick(DUE, { ...m2.deps, listBusinessIds: pager(spread(REPORT_SCAN_CAP + 1)) })
    expect(s2).toMatchObject({ scanned: REPORT_SCAN_CAP, capped: true, reason: 'scan_cap' })
  })

  it('exactly maxPerTick due businesses and nobody left: generated, NOT capped; one fewer slot and it is, with the generation reason', async () => {
    const two = spread(2)
    const m1 = memory({ readers: fleetReaders(new Set(two)) })
    const s1 = await runReportTick(DUE, { ...m1.deps, listBusinessIds: pager(two), scanOffset: ZERO, maxPerTick: 2 })
    expect(s1).toMatchObject({ inserted: 2, capped: false, reason: null })
    const m2 = memory({ readers: fleetReaders(new Set(two)) })
    const s2 = await runReportTick(DUE, { ...m2.deps, listBusinessIds: pager(two), scanOffset: ZERO, maxPerTick: 1 })
    expect(s2).toMatchObject({ inserted: 1, capped: true, reason: 'generation_cap' })
  })

  it('25 failing ids ahead of one due business: the due business is generated in the FIRST tick (errors do not spend the generation budget)', async () => {
    const all = spread(26)
    const m = memory({ readers: fleetReaders(new Set([all[25]]), new Set(all.slice(0, 25))) })
    const capture = vi.fn()
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all), scanOffset: ZERO, capture })
    expect(s).toMatchObject({ errors: REPORT_ERROR_CAP, inserted: 1, capped: false, reason: null })
    expect(m.rows.map((r) => r.business_id)).toEqual([all[25]])
    expect(capture).toHaveBeenCalledTimes(REPORT_ERROR_CAP)
  })

  it('more failures than the error cap end the tick as capped with reason error_cap, and the rest wait', async () => {
    const all = spread(40)
    const m = memory({ readers: fleetReaders(new Set([all[39]]), new Set(all.slice(0, 30))) })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all), scanOffset: ZERO, capture: vi.fn() })
    expect(s).toMatchObject({ errors: REPORT_ERROR_CAP + 1, capped: true, reason: 'error_cap', inserted: 0 })
  })

  it('an offset equal to an existing id visits every business exactly once, in wrap order, with no skip at the seam', async () => {
    const all = spread(7)
    const seen: string[] = []
    const m = memory({ readers: fleetReaders(new Set(), new Set(), seen) })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all), scanOffset: all[3] })
    expect(seen).toEqual([...all.slice(4), ...all.slice(0, 4)])
    expect(new Set(seen).size).toBe(7)
    expect(s).toMatchObject({ scanned: 7, capped: false })
  })

  it('an offset past the last id, and one below the first, both visit everything once', async () => {
    const all = spread(5).slice(1)
    for (const offset of ['ffffffff-ffff-ffff-ffff-ffffffffffff', ZERO]) {
      const seen: string[] = []
      const m = memory({ readers: fleetReaders(new Set(), new Set(), seen) })
      await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all), scanOffset: offset })
      expect([...seen].sort()).toEqual([...all].sort())
      expect(seen).toHaveLength(all.length)
    }
  })
})

describe('an existing report inside its redelivery window is a candidate (MINOR-8, A-13(a))', () => {
  const stored = (hoursAgo: number, over: Partial<{ stub: boolean }> = {}) => ({
    generated_at: hoursAfter(DUE, -hoursAgo),
    stub: false,
    summary: [{ key: 'analytics.activity.total', params: { count: 3, prev: 1 } }],
    ...over,
  })
  const run = (row: ReturnType<typeof stored> | null) => {
    const m = memory({ reportExists: async () => true, redeliveryOf: async () => row })
    return generateReportForBusiness(BUSINESS_A_ID, DUE, m.deps)
  }

  it('a non-stub report generated 10 hours ago is a candidate, carrying its stored summary', async () => {
    expect(await run(stored(10))).toEqual({ status: 'exists', inserted: false, redeliver: { businessId: BUSINESS_A_ID, period: '2026-03', summary: stored(10).summary } })
  })

  it('71 hours is inside the window; 72 hours and 73 hours are not: nothing happens after 72 hours', async () => {
    expect((await run(stored(71))) as { redeliver?: unknown }).toHaveProperty('redeliver')
    expect(await run(stored(72))).toEqual({ status: 'exists', inserted: false })
    expect(await run(stored(73))).toEqual({ status: 'exists', inserted: false })
  })

  it('a STUB is never a candidate, and neither is a report the read cannot find', async () => {
    expect(await run(stored(1, { stub: true }))).toEqual({ status: 'exists', inserted: false })
    expect(await run(null)).toEqual({ status: 'exists', inserted: false })
  })

  it('the tick collects the candidates and counts the business as exists', async () => {
    const m = memory({ reportExists: async () => true, redeliveryOf: async () => stored(5) })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager([BUSINESS_A_ID]) })
    expect(s).toMatchObject({ exists: 1, inserted: 0 })
    expect(s.redeliverReports).toEqual([{ businessId: BUSINESS_A_ID, period: '2026-03', summary: stored(5).summary }])
  })
})

describe('a failing redelivery read is its own signal (silent-failure-hunter M1)', () => {
  it('is captured and counted on its own counter, and never spends the error cap or ends the tick', async () => {
    const all = spread(REPORT_ERROR_CAP + 5)
    const capture = vi.fn()
    const m = memory({
      readers: fleetReaders(new Set(all)),
      reportExists: async () => true,
      redeliveryOf: async () => {
        throw new Error('read failed')
      },
    })
    const s = await runReportTick(DUE, { ...m.deps, listBusinessIds: pager(all), scanOffset: ZERO, capture })
    expect(s).toMatchObject({ scanned: all.length, exists: all.length, errors: 0, redeliveryReadErrors: all.length, capped: false })
    expect(capture).toHaveBeenCalledTimes(all.length)
    expect(s.redeliverReports).toEqual([])
  })
})
