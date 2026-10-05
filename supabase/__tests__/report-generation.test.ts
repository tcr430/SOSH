import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  A_CAMPAIGN_ACTIVE_ID,
  A_LI_ACCOUNT_ID,
  A_X_ACCOUNT_ID,
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  B_CAMPAIGN_ACTIVE_ID,
  B_LI_ACCOUNT_ID,
  B_X_ACCOUNT_ID,
  FIXTURE_POSTS,
  MARCH_REPORT_OUTCOMES_THROUGH,
  postIdFor,
} from '@/lib/analytics/__fixtures__/portfolio'
import { cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'
import { generateReportForBusiness } from '@/lib/reports/generate'

// ADR 0031 §9.3, §12.1 — Tier 1, live Postgres (Session 37 O2.7).
//
//   27 REPORT-RLS-ISOLATED       seed A and B, run the REAL worker (service-role readers, RLS bypassed) for A, and assert no B
//                                post id, business id, campaign id or account id appears anywhere in A's stored payload
//   22 REPORT-ONE-PER-PERIOD     (Tier-1 half) a second run, and two CONCURRENT runs, insert exactly one row
//   40 REPORT-ELIGIBLE-LIVE-ONLY (live half) the liveness predicate reads the real businesses.stripe_subscription_id
const NOW = MARCH_REPORT_OUTCOMES_THROUGH // 2026-04-10T06:00:00Z: Lisbon 07:00 and Sao Paulo 03:00 on day 10
const loaderDeps = { retrievePatterns: async () => [] }

describe('report generation against the live stack (ADR 0031 §5.2, §9.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    await seedPortfolio(admin)
  })

  afterAll(async () => {
    if (admin) await cleanPortfolio(admin)
  })

  const reportsOf = async (businessId: string) => (await admin.from('analytics_reports').select('*').eq('business_id', businessId)).data as Array<Record<string, unknown>>

  it('a business with NO subscription (and a trial clock that never started) is not live: no report, no stub', async () => {
    const out = await generateReportForBusiness(BUSINESS_A_ID, NOW, { loaderDeps })
    expect(out).toEqual({ status: 'ineligible', inserted: false })
    expect(await reportsOf(BUSINESS_A_ID)).toHaveLength(0)
  })

  it('once it has a live subscription, business A (Pro) gets its March report', async () => {
    const { error } = await admin.from('businesses').update({ stripe_subscription_id: 'sub_report_fixture_a' }).eq('id', BUSINESS_A_ID)
    expect(error).toBeNull()
    const out = await generateReportForBusiness(BUSINESS_A_ID, NOW, { loaderDeps })
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: false, tier: 'advanced', period: '2026-03' })
    const rows = await reportsOf(BUSINESS_A_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ business_id: BUSINESS_A_ID, period_month: '2026-03-01', tier: 'advanced', schema_version: 1 })
    expect(new Date(rows[0].outcomes_through as string).toISOString()).toBe('2026-04-10T06:00:00.000Z')
  })

  it('#27: nothing of business B appears anywhere in A\'s payload: no post, business, campaign or account id', async () => {
    const text = JSON.stringify((await reportsOf(BUSINESS_A_ID))[0].payload)
    expect(text).not.toContain(BUSINESS_B_ID)
    for (const id of [B_CAMPAIGN_ACTIVE_ID, B_X_ACCOUNT_ID, B_LI_ACCOUNT_ID]) expect(text, id).not.toContain(id)
    for (const p of FIXTURE_POSTS.filter((x) => x.business_id === BUSINESS_B_ID)) expect(text, p.id).not.toContain(p.id)
    // Positive control: A's own ids ARE there (the payload is not simply empty), and the literal numbers hold.
    expect(text).toContain(A_CAMPAIGN_ACTIVE_ID)
    expect(text).toContain(postIdFor('a_x07'))
    const payload = JSON.parse(text) as { activity: { total: number }; xResults: Array<{ current: { typical: { params: { n: number; rate: string } } } }> }
    expect(payload.activity.total).toBe(13)
    expect(payload.xResults[0].current.typical.params).toMatchObject({ n: 7, rate: '3.1%' })
    expect(text).not.toContain('Fixture post')
    void A_X_ACCOUNT_ID
    void A_LI_ACCOUNT_ID
  })

  it('#22: a SECOND run inserts nothing', async () => {
    const again = await generateReportForBusiness(BUSINESS_A_ID, NOW, { loaderDeps })
    expect(again).toEqual({ status: 'exists', inserted: false })
    expect(await reportsOf(BUSINESS_A_ID)).toHaveLength(1)
  })

  it('#22: two CONCURRENT runs for business B (Plus) insert exactly one row', async () => {
    await admin.from('businesses').update({ stripe_subscription_id: 'sub_report_fixture_b' }).eq('id', BUSINESS_B_ID)
    const results = await Promise.all([generateReportForBusiness(BUSINESS_B_ID, NOW, { loaderDeps }), generateReportForBusiness(BUSINESS_B_ID, NOW, { loaderDeps })])
    const inserted = results.filter((r) => r.inserted)
    expect(inserted).toHaveLength(1)
    const rows = await reportsOf(BUSINESS_B_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ business_id: BUSINESS_B_ID, tier: 'basic', period_month: '2026-03-01' })
    // And B's report holds nothing of A's.
    const text = JSON.stringify(rows[0].payload)
    expect(text).not.toContain(BUSINESS_A_ID)
    expect(text).not.toContain(A_CAMPAIGN_ACTIVE_ID)
    expect(text).not.toContain(postIdFor('a_x07'))
  })

  it('a basic (Plus) stored payload has no Pro key', async () => {
    const payload = (await reportsOf(BUSINESS_B_ID))[0].payload as Record<string, unknown>
    for (const key of ['trend', 'observed', 'patterns']) expect(payload).not.toHaveProperty(key)
    expect((payload.methodology as { keys: string[] }).keys).toHaveLength(8)
  })

  it('an empty live month stores a STUB for A (November 2025, nothing published)', async () => {
    const out = await generateReportForBusiness(BUSINESS_A_ID, '2025-12-10T06:00:00Z', { loaderDeps })
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: true, period: '2025-11' })
    const stub = (await reportsOf(BUSINESS_A_ID)).find((r) => r.period_month === '2025-11-01')!
    expect((stub.payload as { stub: boolean }).stub).toBe(true)
  })
})
