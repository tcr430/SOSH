import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BUSINESS_A_ID, BUSINESS_B_ID } from '@/lib/analytics/__fixtures__/portfolio'
import { cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'

// ADR 0031 §11 / constraint 28 REPORT-CASCADE-COMPLETE (Tier 1; the §D2.5 row-presence half is
// lib/db/__tests__/d2.5-analytics-reports-row.test.ts). analytics_reports has business_id ON DELETE CASCADE and NO
// BEFORE DELETE trigger, so purge_business (which is NOT edited: it relies on the root DELETE FROM businesses,
// 20260702120700:62) removes a business's reports, and a business's erasure leaves another business's report alone.
//
// This is the test that catches the mistake ADR 0018 [db-BLOCKER-1] records: a BEFORE DELETE guard on a child table
// fires on the FK cascade and aborts the purge. The write-once trigger here is BEFORE UPDATE only.
describe('analytics_reports — erasure cascade (ADR 0031 §11, REPORT-CASCADE-COMPLETE)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any

  const report = (businessId: string, month: string) => ({
    business_id: businessId,
    period_month: month,
    tier: 'advanced',
    schema_version: 1,
    payload: { marker: businessId },
    outcomes_through: '2026-04-10T06:00:00Z',
    generated_at: '2026-04-10T06:05:00Z',
  })

  async function reportCount(businessId: string): Promise<number> {
    const { count, error } = await admin.from('analytics_reports').select('id', { count: 'exact', head: true }).eq('business_id', businessId)
    if (error) throw error
    return count as number
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    await seedPortfolio(admin)
    for (const row of [report(BUSINESS_A_ID, '2026-03-01'), report(BUSINESS_A_ID, '2026-02-01'), report(BUSINESS_B_ID, '2026-03-01')]) {
      const { error } = await admin.from('analytics_reports').insert(row)
      if (error) throw error
    }
  })

  afterAll(async () => {
    if (admin) await cleanPortfolio(admin)
  })

  it('purge_business(A) SUCCEEDS with reports present, leaves A with none, and leaves B\'s report untouched', async () => {
    expect(await reportCount(BUSINESS_A_ID), 'precondition: A holds reports').toBe(2)
    expect(await reportCount(BUSINESS_B_ID), 'precondition: B holds a report').toBe(1)

    const { data, error } = await admin.rpc('purge_business', { p_business_id: BUSINESS_A_ID })
    expect(error, 'purge_business must SUCCEED with analytics_reports rows').toBeNull()
    expect(data.already_purged).toBe(false)

    expect(await reportCount(BUSINESS_A_ID)).toBe(0)
    expect(await reportCount(BUSINESS_B_ID)).toBe(1)
    const { data: biz } = await admin.from('businesses').select('id').eq('id', BUSINESS_A_ID)
    expect(biz).toEqual([])
  })

  it('a plain DELETE of the business (the FK cascade alone) removes its reports: the write-once trigger does not fire on a cascade', async () => {
    const del = await admin.from('businesses').delete().eq('id', BUSINESS_B_ID).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toHaveLength(1)
    expect(await reportCount(BUSINESS_B_ID)).toBe(0)
  })
})
