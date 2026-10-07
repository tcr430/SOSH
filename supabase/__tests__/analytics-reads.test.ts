import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import {
  A_LI_ACCOUNT_ID,
  A_X_ACCOUNT_ID,
  B_X_ACCOUNT_ID,
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  EXPECTED,
  FIXTURE_POSTS,
  FIXTURE_POST_OUTCOMES,
  MARCH_REPORT_OUTCOMES_THROUGH,
} from '@/lib/analytics/__fixtures__/portfolio'
import { SEED_OWNER_EMAIL, SEED_PASSWORD, cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'
import { periodBounds } from '@/lib/analytics/period'
import { countPublishedPostsInRange, listPublishedPostsInRange } from '@/lib/db/posts'
import { listDimensionsForAnalytics, listMonthOutcomes } from '@/lib/db/post-outcomes'
import { listMetricsForPosts } from '@/lib/db/post-metrics'
import { listAccountLabels } from '@/lib/db/social-accounts'
import { listCampaignsByIds } from '@/lib/db/campaigns'
import { getReportById, getReportByPeriod, listReports } from '@/lib/db/analytics-reports'

// ADR 0031 §9.1, §12.1 — Tier 1, live Postgres (Session 37 O2.4).
//
//   16 ANALYTICS-AUTHENTICATED-READS  the REAL readers, run through an AUTHENTICATED client whose user OWNS BOTH
//                                     businesses: only the explicit .eq('business_id') separates A from B (RLS returns
//                                     an array of business ids), and the seeded B is the positive control.
//   18 ANALYTICS-BOUNDED-INDEXED      EXPLAIN on the monthly posts read and the month's outcomes read names the index
//   36 ANALYTICS-NO-SILENT-TRUNCATION the keyset .or() filter works against PostgREST: a page size of 1 returns what a
//                                     page size of 500 returns, in the same order
const LISBON_MARCH = periodBounds('2026-03', 'Europe/Lisbon')
const SAO_PAULO_MARCH = periodBounds('2026-03', 'America/Sao_Paulo')

const idsOf = <T extends { id?: string; post_id?: string }>(rows: T[]) => rows.map((r) => (r.id ?? r.post_id) as string)

describe('analytics reads — authenticated, business-bound, paged, indexed (ADR 0031 §9.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let owner: SupabaseClient

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    await seedPortfolio(admin)

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for the plan checks')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    owner = createClient(supabaseUrl, anonKey)
    const { error } = await owner.auth.signInWithPassword({ email: SEED_OWNER_EMAIL, password: SEED_PASSWORD })
    if (error) throw error
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (admin) await cleanPortfolio(admin)
  })

  // ─── published posts ─────────────────────────────────────────────────────────────────────────────────────
  it('A, March (Lisbon): the 13 published posts, newest first, and NOTHING of B, though the same user owns both', async () => {
    const rows = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)
    expect(rows).toHaveLength(EXPECTED.march.activity.totalPublished)
    expect(rows.every((r) => r.business_id === BUSINESS_A_ID)).toBe(true)
    const times = rows.map((r) => r.published_at)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('draft, failed and soft-deleted posts are filtered by the reader itself (the fixture holds one of each in March)', async () => {
    const rows = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)
    const excluded = FIXTURE_POSTS.filter((p) => p.business_id === BUSINESS_A_ID && (p.status !== 'published' || p.deleted_at !== null)).map((p) => p.id)
    expect(excluded).toHaveLength(3)
    for (const id of excluded) expect(idsOf(rows)).not.toContain(id)
  })

  it('the Lisbon boundary post (23:30Z on 31 March) is OUT of March and IN April, by the [start, end) bounds', async () => {
    const march = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)
    const april = await listPublishedPostsInRange(owner, BUSINESS_A_ID, periodBounds('2026-04', 'Europe/Lisbon'))
    expect(march.map((r) => r.published_at)).not.toContain('2026-03-31T23:30:00+00:00')
    expect(april.map((r) => r.published_at)).toContain('2026-03-31T23:30:00+00:00')
  })

  it('positive control: B reads its own 3 March posts (Sao Paulo) and none of A\'s', async () => {
    const rows = await listPublishedPostsInRange(owner, BUSINESS_B_ID, SAO_PAULO_MARCH)
    expect(rows).toHaveLength(EXPECTED.businessB.xPublished + EXPECTED.businessB.linkedinPublished)
    expect(rows.every((r) => r.business_id === BUSINESS_B_ID)).toBe(true)
  })

  it('a page size of 1 and of 2 return EXACTLY the rows of a page size of 500, in the same order (the keyset works against PostgREST)', async () => {
    const whole = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH, { pageSize: 500 })
    for (const pageSize of [1, 2, 5]) {
      const paged = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH, { pageSize })
      expect(idsOf(paged), `page size ${pageSize}`).toEqual(idsOf(whole))
    }
  })

  it('the activity count equals the rows', async () => {
    expect(await countPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)).toBe(13)
    expect(await countPublishedPostsInRange(owner, BUSINESS_B_ID, SAO_PAULO_MARCH)).toBe(3)
  })

  // ─── outcomes ────────────────────────────────────────────────────────────────────────────────────────────
  it('A, March, X: the 7 measured outcomes, their values as NUMBERS, bounded by outcomes_through', async () => {
    const rows = await listMonthOutcomes(owner, BUSINESS_A_ID, { platform: 'twitter', ...LISBON_MARCH, outcomesThrough: MARCH_REPORT_OUTCOMES_THROUGH })
    expect(rows).toHaveLength(EXPECTED.march.x.measured)
    expect(rows.every((r) => r.business_id === BUSINESS_A_ID && typeof r.value === 'number')).toBe(true)
    expect([...rows.map((r) => r.value)].sort((a, b) => a - b)).toEqual([0, 0.018, 0.025, 0.031, 0.04, 0.047, 0.064])
  })

  it('measured_at <= outcomes_through: an earlier instant drops the outcomes measured after it (3 of 7 by 20 March 00:00Z)', async () => {
    const rows = await listMonthOutcomes(owner, BUSINESS_A_ID, { platform: 'twitter', ...LISBON_MARCH, outcomesThrough: '2026-03-20T00:00:00Z' })
    expect(rows).toHaveLength(3)
    const late = FIXTURE_POST_OUTCOMES.filter((o) => o.business_id === BUSINESS_A_ID && o.measured_at > '2026-03-20T00:00:00Z').map((o) => o.post_id)
    for (const id of late) expect(idsOf(rows)).not.toContain(id)
  })

  it('a page size of 3 returns exactly what 500 returns, in the same order', async () => {
    const q = { platform: 'twitter', ...LISBON_MARCH, outcomesThrough: MARCH_REPORT_OUTCOMES_THROUGH }
    const whole = await listMonthOutcomes(owner, BUSINESS_A_ID, q, { pageSize: 500 })
    const paged = await listMonthOutcomes(owner, BUSINESS_A_ID, q, { pageSize: 3 })
    expect(idsOf(paged)).toEqual(idsOf(whole))
  })

  it('LinkedIn: 3 COUNT-basis outcomes for A, and B\'s X reads only B\'s two', async () => {
    const li = await listMonthOutcomes(owner, BUSINESS_A_ID, { platform: 'linkedin', ...LISBON_MARCH, outcomesThrough: MARCH_REPORT_OUTCOMES_THROUGH })
    expect(li).toHaveLength(3)
    expect(li.every((r) => r.metric_basis === 'count')).toBe(true)
    const b = await listMonthOutcomes(owner, BUSINESS_B_ID, { platform: 'twitter', ...SAO_PAULO_MARCH, outcomesThrough: MARCH_REPORT_OUTCOMES_THROUGH })
    expect(b).toHaveLength(EXPECTED.businessB.xMeasured)
    expect(b.every((r) => r.business_id === BUSINESS_B_ID)).toBe(true)
  })

  // ─── dimensions, metrics, labels ─────────────────────────────────────────────────────────────────────────
  it('dimensions: the 5 AI posts of A\'s March X outcomes, by snapshot id', async () => {
    const outcomes = await listMonthOutcomes(owner, BUSINESS_A_ID, { platform: 'twitter', ...LISBON_MARCH, outcomesThrough: MARCH_REPORT_OUTCOMES_THROUGH })
    const snapshotIds = outcomes.flatMap((o) => (o.ai_original_id ? [o.ai_original_id] : []))
    expect(snapshotIds).toHaveLength(5)
    const dims = await listDimensionsForAnalytics(owner, BUSINESS_A_ID, snapshotIds)
    expect(dims).toHaveLength(5)
    expect(dims.map((d) => d.role).sort()).toEqual(['anchor_thesis', 'anchor_thesis', 'customer_proof', 'customer_proof', 'founder_perspective'])
    // A snapshot id asked for under the WRONG business returns nothing, though the owner can see both.
    expect(await listDimensionsForAnalytics(owner, BUSINESS_B_ID, snapshotIds)).toEqual([])
  })

  it('metrics: A\'s posts return A\'s rows; B\'s post ids asked for under A return NOTHING', async () => {
    const aPosts = await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)
    const mine = await listMetricsForPosts(owner, BUSINESS_A_ID, idsOf(aPosts))
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((m) => m.business_id === BUSINESS_A_ID)).toBe(true)
    const bPosts = await listPublishedPostsInRange(owner, BUSINESS_B_ID, SAO_PAULO_MARCH)
    expect(await listMetricsForPosts(owner, BUSINESS_A_ID, idsOf(bPosts))).toEqual([])
  })

  it('account labels: A\'s two accounts, never B\'s, even when B\'s id is asked for', async () => {
    const rows = await listAccountLabels(owner, BUSINESS_A_ID, [A_X_ACCOUNT_ID, A_LI_ACCOUNT_ID, B_X_ACCOUNT_ID])
    expect(rows.map((r) => r.id).sort()).toEqual([A_X_ACCOUNT_ID, A_LI_ACCOUNT_ID].sort())
    expect(Object.keys(rows[0]).sort()).toEqual(['business_id', 'id', 'platform', 'platform_display_name', 'platform_username'])
  })
  it('campaigns by id (MAJOR-10): the owning business campaigns with exactly four columns, never the other business, even when its id is asked for', async () => {
    const aIds = [...new Set((await listPublishedPostsInRange(owner, BUSINESS_A_ID, LISBON_MARCH)).map((p) => p.campaign_id))]
    const bIds = [...new Set((await listPublishedPostsInRange(owner, BUSINESS_B_ID, SAO_PAULO_MARCH)).map((p) => p.campaign_id))]
    expect(aIds.length).toBeGreaterThan(0)
    expect(bIds.length).toBeGreaterThan(0)
    const rows = await listCampaignsByIds(owner, BUSINESS_A_ID, [...aIds, ...bIds])
    expect(rows.map((r) => r.id).sort()).toEqual([...aIds].sort())
    expect(rows.every((r) => r.business_id === BUSINESS_A_ID)).toBe(true)
    expect(Object.keys(rows[0]).sort()).toEqual(['business_id', 'id', 'name', 'status'])
  })

  // ─── reports ─────────────────────────────────────────────────────────────────────────────────────────────
  it('reports: by period, by id, and the list, each bound to the business', async () => {
    const base = { tier: 'basic', schema_version: 1, payload: { marker: 'reads' }, outcomes_through: '2026-04-10T06:00:00Z', generated_at: '2026-04-10T06:05:00Z' }
    const a = await admin.from('analytics_reports').insert({ ...base, business_id: BUSINESS_A_ID, period_month: '2026-03-01' }).select('id').single()
    const b = await admin.from('analytics_reports').insert({ ...base, business_id: BUSINESS_B_ID, period_month: '2026-03-01' }).select('id').single()
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()

    expect((await getReportByPeriod(owner, BUSINESS_A_ID, '2026-03-01'))?.id).toBe(a.data.id)
    expect((await getReportByPeriod(owner, BUSINESS_B_ID, '2026-03-01'))?.id).toBe(b.data.id)
    expect(await getReportByPeriod(owner, BUSINESS_A_ID, '2026-02-01')).toBeNull()
    // B's report id under A's business is not found, though RLS lets the owner read it.
    expect(await getReportById(owner, BUSINESS_A_ID, b.data.id)).toBeNull()
    expect((await getReportById(owner, BUSINESS_A_ID, a.data.id))?.business_id).toBe(BUSINESS_A_ID)
    const list = await listReports(owner, BUSINESS_A_ID)
    expect(list.map((r) => r.id)).toEqual([a.data.id])
  })

  // ─── the plans ───────────────────────────────────────────────────────────────────────────────────────────
  // Planner-independent, as in analytics-reports-constraints: take the OTHER indexes away inside a transaction that is
  // rolled back, so the named index is used iff the query's predicates imply its definition.
  async function planOf(sql: string, drop: string[]): Promise<string> {
    await pg.query('BEGIN')
    try {
      for (const index of drop) await pg.query(`DROP INDEX public.${index}`)
      await pg.query('SET LOCAL enable_seqscan = off')
      return (await pg.query(`EXPLAIN ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n')
    } finally {
      await pg.query('ROLLBACK')
    }
  }

  it('the monthly posts read USES posts_business_published_idx (the reader\'s predicates, ORDER BY and LIMIT, page one)', async () => {
    const plan = await planOf(
      `SELECT id, business_id, platform, published_at, social_account_id, campaign_id FROM public.posts
        WHERE business_id = '${BUSINESS_A_ID}' AND status = 'published' AND deleted_at IS NULL
          AND published_at >= '${LISBON_MARCH.start}' AND published_at < '${LISBON_MARCH.end}'
        ORDER BY published_at DESC, id DESC LIMIT 500`,
      ['posts_business_id_status_idx', 'posts_business_id_created_at_idx', 'idx_posts_business_scheduled_at'],
    )
    expect(plan).toContain('posts_business_published_idx')
  })

  it('the month\'s outcomes read USES post_outcomes_business_platform_published_idx', async () => {
    const plan = await planOf(
      `SELECT post_id, business_id, platform, published_at, value FROM public.post_outcomes
        WHERE business_id = '${BUSINESS_A_ID}' AND platform = 'twitter'
          AND published_at >= '${LISBON_MARCH.start}' AND published_at < '${LISBON_MARCH.end}'
          AND measured_at <= '${MARCH_REPORT_OUTCOMES_THROUGH}'
        ORDER BY published_at DESC, post_id DESC LIMIT 500`,
      [],
    )
    expect(plan).toContain('post_outcomes_business_platform_published_idx')
  })
})
