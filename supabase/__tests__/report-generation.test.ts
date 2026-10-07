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
import { getReportForRedeliveryForWorker } from '@/lib/db/analytics-reports'
import { countMonthlyReportEmailsForWorker } from '@/lib/db/email-outbox'
import { TenantMismatchError } from '@/lib/reports/isolation'
import { analyticsWorkerReaders } from '@/lib/db/analytics-worker-reads'
import { selectOutcomePatterns } from '@/lib/memory'

// ADR 0031 §9.3, §12.1 — Tier 1, live Postgres (Session 37 O2.7).
//
//   27 REPORT-RLS-ISOLATED       seed A and B, run the REAL worker (service-role readers, RLS bypassed) for A, and assert no B
//                                post id, business id, campaign id or account id appears anywhere in A's stored payload
//   22 REPORT-ONE-PER-PERIOD     (Tier-1 half) a second run, and two CONCURRENT runs, insert exactly one row
//   40 REPORT-ELIGIBLE-LIVE-ONLY (live half) the liveness predicate reads the real businesses.stripe_subscription_id
//   MAJOR-4 (Session 37-D D1)    the patterns read is the REAL listPatterns binding (no stub): A's payload holds A's pattern and none of B's,
//                                and the same read with its business filter dropped is refused by verifiedReaders (TenantMismatchError)
const NOW = MARCH_REPORT_OUTCOMES_THROUGH // 2026-04-10T06:00:00Z: Lisbon 07:00 and Sao Paulo 03:00 on day 10

// An ACTIVE outcome pattern, exactly the columns the floor RPC would have written. A report stores the parsed CELL of the key, never
// the sentence (Session 37-D D2), so B's canary differs from A's by cell and counts: only the business filter keeps it out of A's payload.
const A_KEY = 'outcome:format:thread:above:twitter'
const B_KEY = 'outcome:role:customer_proof:below:twitter'
const outcomePattern = (businessId: string, key: string, wins: number, n: number, campaigns: number) => {
  const [, dimension] = key.split(':')
  return {
    business_id: businessId, source: 'outcome', status: 'active', scope: 'platform', scope_ref: 'twitter', dimension, pattern: 'Stored English sentence for ' + key,
    pattern_key: key, platform: 'twitter', confidence: 0.5, observation_count: n,
    outcome_n: n, outcome_wins: wins, outcome_distinct_campaigns: campaigns, interval_low: 0.4, interval_high: 0.9, metric_basis: 'rate', baseline_seeded: false,
  }
}

describe('report generation against the live stack (ADR 0031 §5.2, §9.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    await seedPortfolio(admin)
    for (const row of [outcomePattern(BUSINESS_A_ID, A_KEY, 7, 10, 3), outcomePattern(BUSINESS_B_ID, B_KEY, 9, 12, 4)]) {
      const { error } = await admin.from('performance_memory').insert(row)
      if (error) throw new Error('seed performance_memory: ' + error.message)
    }
  })

  afterAll(async () => {
    if (admin) await cleanPortfolio(admin)
  })

  const reportsOf = async (businessId: string) => (await admin.from('analytics_reports').select('*').eq('business_id', businessId)).data as Array<Record<string, unknown>>

  it('a business with NO subscription (and a trial clock that never started) is not live: no report, no stub', async () => {
    const out = await generateReportForBusiness(BUSINESS_A_ID, NOW)
    expect(out).toEqual({ status: 'ineligible', inserted: false })
    expect(await reportsOf(BUSINESS_A_ID)).toHaveLength(0)
  })

  it('once it has a live subscription, business A (Pro) gets its March report', async () => {
    const { error } = await admin.from('businesses').update({ stripe_subscription_id: 'sub_report_fixture_a' }).eq('id', BUSINESS_A_ID)
    expect(error).toBeNull()
    const out = await generateReportForBusiness(BUSINESS_A_ID, NOW)
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: false, tier: 'advanced', period: '2026-03' })
    const rows = await reportsOf(BUSINESS_A_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ business_id: BUSINESS_A_ID, period_month: '2026-03-01', tier: 'advanced', schema_version: 2 })
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

  it('MAJOR-4: the patterns read is the REAL binding (no stub): the stored patterns of business A are its own row and nothing of business B', async () => {
    const payload = (await reportsOf(BUSINESS_A_ID))[0].payload as { patterns: Array<Record<string, unknown>> }
    expect(payload.patterns).toEqual([{ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate', wins: 7, n: 10, campaigns: 3 }])
    // B's cell (a customer_proof role pattern, below, 9 of 12) is not among them, and no stored sentence of either business is in the payload.
    expect(JSON.stringify(payload)).not.toContain('Stored English sentence')
  })

  it('MAJOR-4: the SAME read with its business filter dropped returns a row of business B, and verifiedReaders REFUSES it (TenantMismatchError); no report is stored', async () => {
    const unfiltered = async (_businessId: string, options: { platform?: string }) => {
      const { data, error } = await admin.from('performance_memory').select('*').eq('source', 'outcome').eq('status', 'active')
      if (error) throw new Error(error.message)
      return selectOutcomePatterns(data, options)
    }
    // Sanity: the unfiltered read really does return a foreign row, so a refusal below is the wrapper's doing and not an empty result.
    expect((await unfiltered(BUSINESS_A_ID, {})).some((r) => r.business_id === BUSINESS_B_ID)).toBe(true)
    // January 2026 is due on 2026-02-10 and A has no January report yet, so the generator reaches the patterns read.
    await expect(generateReportForBusiness(BUSINESS_A_ID, '2026-02-10T06:00:00Z', { readers: { ...analyticsWorkerReaders(), listPatterns: unfiltered } })).rejects.toBeInstanceOf(TenantMismatchError)
    expect((await reportsOf(BUSINESS_A_ID)).some((r) => r.period_month === '2026-01-01')).toBe(false)
  })

  it('#22: a SECOND run inserts nothing', async () => {
    const again = await generateReportForBusiness(BUSINESS_A_ID, NOW)
    expect(again).toMatchObject({ status: 'exists', inserted: false, redeliver: { businessId: BUSINESS_A_ID, period: '2026-03' } })
    expect(await reportsOf(BUSINESS_A_ID)).toHaveLength(1)
  })

  it('#22: two CONCURRENT runs for business B (Plus) insert exactly one row', async () => {
    await admin.from('businesses').update({ stripe_subscription_id: 'sub_report_fixture_b' }).eq('id', BUSINESS_B_ID)
    const results = await Promise.all([generateReportForBusiness(BUSINESS_B_ID, NOW), generateReportForBusiness(BUSINESS_B_ID, NOW)])
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
    const out = await generateReportForBusiness(BUSINESS_A_ID, '2025-12-10T06:00:00Z')
    expect(out).toMatchObject({ status: 'generated', inserted: true, stub: true, period: '2025-11' })
    const stub = (await reportsOf(BUSINESS_A_ID)).find((r) => r.period_month === '2025-11-01')!
    expect((stub.payload as { stub: boolean }).stub).toBe(true)
  })

  it('MINOR-8: the redelivery read returns the stored generated_at, stub flag and summary for ONE business and month', async () => {
    const march = await getReportForRedeliveryForWorker(BUSINESS_A_ID, '2026-03-01')
    expect(march).not.toBeNull()
    expect(march!.stub).toBe(false)
    expect(Number.isNaN(new Date(march!.generated_at).getTime())).toBe(false)
    expect(march!.summary.length).toBeGreaterThan(0)
    expect(march!.summary[0]).toHaveProperty('key')
    expect((await getReportForRedeliveryForWorker(BUSINESS_A_ID, '2025-11-01'))!.stub).toBe(true)
    expect(await getReportForRedeliveryForWorker(BUSINESS_A_ID, '2020-01-01')).toBeNull()
    // B's report is never read under A's id.
    expect(await getReportForRedeliveryForWorker(BUSINESS_B_ID, '2025-11-01')).toBeNull()
  })

  it('M2: a stored report with no boolean stub flag or no summary list is an ERROR on the redelivery read, never a default', async () => {
    const base = { business_id: BUSINESS_A_ID, tier: 'basic', schema_version: 2, outcomes_through: '2026-04-10T06:00:00Z', generated_at: '2026-04-10T06:05:00Z' }
    const bad = await admin.from('analytics_reports').insert([
      { ...base, period_month: '2025-01-01', payload: { summary: [{ key: 'k', params: {} }] } },
      { ...base, period_month: '2025-02-01', payload: { stub: false } },
    ]).select('id')
    expect(bad.error).toBeNull()
    try {
      await expect(getReportForRedeliveryForWorker(BUSINESS_A_ID, '2025-01-01')).rejects.toThrow('boolean stub flag')
      await expect(getReportForRedeliveryForWorker(BUSINESS_A_ID, '2025-02-01')).rejects.toThrow('summary list')
    } finally {
      await admin.from('analytics_reports').delete().in('id', (bad.data as Array<{ id: string }>).map((r) => r.id))
    }
  })

  it('MINOR-8: the outbox count is per business, kind and month, on the dedupe token prefix', async () => {
    const row = (businessId: string, token: string, kind = 'monthly-report') => ({ business_id: businessId, kind, recipient: 'x@example.com', locale: 'en', dedupe_token: token })
    const rows = [
      row(BUSINESS_A_ID, 'report:2026-03:m1'),
      row(BUSINESS_A_ID, 'report:2026-03:m2'),
      row(BUSINESS_A_ID, 'report:2026-04:m1'),
      row(BUSINESS_B_ID, 'report:2026-03:m1'),
    ]
    const inserted = await admin.from('email_outbox').insert(rows).select('id')
    expect(inserted.error).toBeNull()
    try {
      expect(await countMonthlyReportEmailsForWorker(BUSINESS_A_ID, '2026-03')).toBe(2)
      expect(await countMonthlyReportEmailsForWorker(BUSINESS_A_ID, '2026-04')).toBe(1)
      expect(await countMonthlyReportEmailsForWorker(BUSINESS_B_ID, '2026-03')).toBe(1)
      expect(await countMonthlyReportEmailsForWorker(BUSINESS_A_ID, '2026-05')).toBe(0)
      // The unique dedupe index is what makes a re-run a no-op: the same token for the same business cannot be inserted twice.
      const dup = await admin.from('email_outbox').insert(row(BUSINESS_A_ID, 'report:2026-03:m1'))
      expect(dup.error?.code).toBe('23505')
    } finally {
      await admin.from('email_outbox').delete().in('id', (inserted.data as Array<{ id: string }>).map((r) => r.id))
    }
  })
})
