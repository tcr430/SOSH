import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  FIXTURE_POSTS,
  FIXTURE_POST_DIMENSIONS,
  FIXTURE_POST_METRICS,
  FIXTURE_POST_OUTCOMES,
  USER_ID,
} from '@/lib/analytics/__fixtures__/portfolio'
import { cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'

// ADR 0031 §12.1 item 9 / constraint 27 REPORT-RLS-ISOLATED — the Tier-1 SEED half (Session 37 O2.2). The worker
// isolation test itself lands with the assembler (O2.7); this proves the shared fixture loads into a live database,
// that business B (the positive control) holds an ACTIVE row of every kind, and that the post_dimensions the tagging
// trigger derives equal the fixture's dimensions, so the Tier-1 and Tier-2 suites can never read different numbers.
describe('portfolio fixture seeds into live Postgres (ADR 0031 §12.1 item 9, seed half)', () => {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function count(table: string, businessId: string, extra?: (q: any) => any): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin.from(table).select('business_id', { count: 'exact', head: true }).eq('business_id', businessId)
    if (extra) q = extra(q)
    const { count: n, error } = await q
    if (error) throw error
    return n as number
  }

  it.each([
    ['posts', FIXTURE_POSTS],
    ['post_metrics', FIXTURE_POST_METRICS],
    ['post_outcomes', FIXTURE_POST_OUTCOMES],
    ['post_dimensions', FIXTURE_POST_DIMENSIONS],
  ] as const)('%s: each business holds exactly the fixture rows', async (table, rows) => {
    for (const businessId of [BUSINESS_A_ID, BUSINESS_B_ID]) {
      expect(await count(table, businessId), `${table} ${businessId}`).toBe(rows.filter((r) => r.business_id === businessId).length)
    }
  })

  it('B holds an ACTIVE row of every kind (the positive control for every isolation test)', async () => {
    expect(await count('campaigns', BUSINESS_B_ID, (q) => q.eq('status', 'active'))).toBeGreaterThanOrEqual(1)
    expect(await count('social_accounts', BUSINESS_B_ID, (q) => q.eq('is_active', true))).toBeGreaterThanOrEqual(1)
    expect(await count('business_members', BUSINESS_B_ID, (q) => q.eq('status', 'active'))).toBeGreaterThanOrEqual(1)
    expect(await count('posts', BUSINESS_B_ID, (q) => q.eq('status', 'published').is('deleted_at', null))).toBeGreaterThanOrEqual(1)
    expect(await count('post_outcomes', BUSINESS_B_ID)).toBeGreaterThanOrEqual(1)
    expect(await count('post_dimensions', BUSINESS_B_ID)).toBeGreaterThanOrEqual(1)
  })

  it('the rows that must NOT count are really there with their explicit statuses (draft, failed, soft-deleted)', async () => {
    expect(await count('posts', BUSINESS_A_ID, (q) => q.eq('status', 'draft'))).toBe(1)
    expect(await count('posts', BUSINESS_A_ID, (q) => q.eq('status', 'failed'))).toBe(1)
    expect(await count('posts', BUSINESS_A_ID, (q) => q.not('deleted_at', 'is', null))).toBe(1)
    expect(await count('posts', BUSINESS_A_ID, (q) => q.is('social_account_id', null))).toBe(1)
    const { data } = await admin.from('business_members').select('status').eq('business_id', BUSINESS_A_ID)
    expect(new Set((data as { status: string }[]).map((r) => r.status))).toEqual(new Set(['active', 'invited', 'revoked']))
  })

  it('the post_dimensions the tagging trigger derived equal the fixture dimensions (role, format, origin_mode, hook_type, platform)', async () => {
    const { data, error } = await admin
      .from('post_dimensions')
      .select('ai_original_id, business_id, post_id, campaign_id, platform, role, format, origin_mode, hook_type')
      .in('business_id', [BUSINESS_A_ID, BUSINESS_B_ID])
      .order('ai_original_id', { ascending: true })
    expect(error).toBeNull()
    const expected = [...FIXTURE_POST_DIMENSIONS].sort((a, b) => a.ai_original_id.localeCompare(b.ai_original_id))
    expect(data).toEqual(expected)
  })

  it('the shared owner is an active admin member of BOTH businesses (the two-business user the isolation tests rely on)', async () => {
    const { data } = await admin.from('business_members').select('business_id, status, is_admin').eq('user_id', USER_ID)
    expect(new Set((data as { business_id: string }[]).map((r) => r.business_id))).toEqual(new Set([BUSINESS_A_ID, BUSINESS_B_ID]))
    for (const r of data as { status: string; is_admin: boolean }[]) {
      expect(r.status).toBe('active')
      expect(r.is_admin).toBe(true)
    }
  })

  it('re-seeding is idempotent (a crashed earlier run cannot poison this one)', async () => {
    await seedPortfolio(admin)
    expect(await count('posts', BUSINESS_A_ID)).toBe(FIXTURE_POSTS.filter((p) => p.business_id === BUSINESS_A_ID).length)
  })
})
