import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import {
  BUSINESS_A_ID,
  BUSINESS_B_ID,
  OTHER_ADMIN_USER_ID,
  USER_ID,
  VIEWER_USER_ID,
} from '@/lib/analytics/__fixtures__/portfolio'
import { SEED_OWNER_EMAIL, SEED_PASSWORD, cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'

// ADR 0031 §11 / §12.1 item 1 — REPORT-SNAPSHOT-IMMUTABLE's read side and ANALYTICS-TENANT-BOUNDED's two-business arm
// (constraint 17, Tier-1 half). Tier 1, live Postgres.
//
//   * a member of A reads A's report (the POSITIVE CONTROL: nothing below means anything if this fails);
//   * a user who is a member of BOTH A and B, asking for A, gets A's row and never B's: get_user_business_ids()
//     returns an ARRAY, so for that user RLS alone does NOT separate the two (the unfiltered read returns both), and
//     the explicit business_id filter every reader applies is the boundary;
//   * a user in B only cannot read A; anon reads nothing (no privilege at all);
//   * email_outbox_select_own is now the InitPlan form and still separates tenants.
const PERMISSION_DENIED = '42501'

function reportRow(businessId: string, month: string) {
  return {
    business_id: businessId,
    period_month: month,
    tier: 'advanced',
    schema_version: 1,
    payload: { marker: `${businessId}:${month}` },
    outcomes_through: '2026-04-10T06:00:00Z',
    generated_at: '2026-04-10T06:05:00Z',
  }
}

describe('analytics_reports — RLS isolation (ADR 0031 §11, §12.1 item 1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let ownerBoth: SupabaseClient // member of A AND B (the fixture's shared user)
  let viewerA: SupabaseClient // member of A only
  let userB: SupabaseClient // member of B only
  let bOnlyUserId = ''
  let anon: SupabaseClient

  async function signInAs(email: string): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    await seedPortfolio(admin)

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for catalogue checks')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const bOnlyEmail = `analytics-b-only-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email: bOnlyEmail, password: SEED_PASSWORD, email_confirm: true })
    if (uErr) throw uErr
    bOnlyUserId = u.user.id as string
    const { error: mErr } = await admin.from('business_members').insert({
      business_id: BUSINESS_B_ID,
      user_id: bOnlyUserId,
      email: bOnlyEmail,
      role: 'viewer',
      is_admin: false,
      status: 'active',
    })
    if (mErr) throw mErr

    for (const row of [reportRow(BUSINESS_A_ID, '2026-03-01'), reportRow(BUSINESS_A_ID, '2026-02-01'), reportRow(BUSINESS_B_ID, '2026-03-01')]) {
      const { error } = await admin.from('analytics_reports').insert(row)
      if (error) throw error
    }
    for (const [businessId, token] of [[BUSINESS_A_ID, 'report:2026-03:a'], [BUSINESS_B_ID, 'report:2026-03:b']] as const) {
      const { error } = await admin.from('email_outbox').insert({
        business_id: businessId,
        kind: 'monthly-report',
        recipient: `rls-${token}@integration.test`,
        locale: 'en',
        props: {},
        dedupe_token: token,
        status: 'pending',
      })
      if (error) throw error
    }

    ownerBoth = await signInAs(SEED_OWNER_EMAIL)
    viewerA = await signInAs('portfolio-viewer@integration.test')
    userB = await signInAs(bOnlyEmail)
    const url2 = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    anon = createClient(url2, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    await admin.from('email_outbox').delete().in('business_id', [BUSINESS_A_ID, BUSINESS_B_ID])
    await cleanPortfolio(admin)
    if (bOnlyUserId) await admin.auth.admin.deleteUser(bOnlyUserId)
  })

  it('the fixture users are the ones this file assumes (a guard against a re-numbered fixture)', () => {
    expect(USER_ID).toBeTruthy()
    expect(VIEWER_USER_ID).not.toBe(OTHER_ADMIN_USER_ID)
  })

  it('POSITIVE CONTROL: a member of A (a viewer) reads A\'s reports', async () => {
    const { data, error } = await viewerA.from('analytics_reports').select('business_id, period_month').order('period_month', { ascending: false })
    expect(error).toBeNull()
    expect(data).toEqual([
      { business_id: BUSINESS_A_ID, period_month: '2026-03-01' },
      { business_id: BUSINESS_A_ID, period_month: '2026-02-01' },
    ])
  })

  it('a member of A asking for B\'s report by its business id and by its row id gets NOTHING', async () => {
    const byBusiness = await viewerA.from('analytics_reports').select('id').eq('business_id', BUSINESS_B_ID)
    expect(byBusiness.error).toBeNull()
    expect(byBusiness.data).toEqual([])
    const { data: bRow } = await admin.from('analytics_reports').select('id').eq('business_id', BUSINESS_B_ID).single()
    const byId = await viewerA.from('analytics_reports').select('id').eq('id', bRow.id)
    expect(byId.data).toEqual([])
  })

  it('a user in B only cannot read A, and does read B (both directions of the control)', async () => {
    const readsA = await userB.from('analytics_reports').select('id').eq('business_id', BUSINESS_A_ID)
    expect(readsA.error).toBeNull()
    expect(readsA.data).toEqual([])
    const readsB = await userB.from('analytics_reports').select('business_id').eq('business_id', BUSINESS_B_ID)
    expect(readsB.data).toEqual([{ business_id: BUSINESS_B_ID }])
  })

  it('TWO-BUSINESS ARM: a user in A and B who asks for A gets only A\'s rows, never B\'s', async () => {
    const { data, error } = await ownerBoth.from('analytics_reports').select('business_id, period_month').eq('business_id', BUSINESS_A_ID)
    expect(error).toBeNull()
    expect(data!.length).toBe(2)
    expect(new Set(data!.map((r) => r.business_id))).toEqual(new Set([BUSINESS_A_ID]))
  })

  it('...and that is the filter\'s doing, not RLS\'s: the same user reading WITHOUT the filter sees both businesses', async () => {
    const { data } = await ownerBoth.from('analytics_reports').select('business_id')
    expect(new Set(data!.map((r) => r.business_id))).toEqual(new Set([BUSINESS_A_ID, BUSINESS_B_ID]))
  })

  it('anon reads nothing: it has no privilege on the table at all (permission denied, not an empty set)', async () => {
    const { data, error } = await anon.from('analytics_reports').select('id')
    expect(data ?? []).toEqual([])
    expect(error?.code).toBe(PERMISSION_DENIED)
  })

  it('exactly ONE policy exists, SELECT for authenticated, in the InitPlan form, and no write policy', async () => {
    const { rows } = await pg.query(
      `SELECT policyname, cmd, roles::text AS roles, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_reports'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].policyname).toBe('analytics_reports_select_own')
    expect(rows[0].cmd).toBe('SELECT')
    expect(rows[0].roles).toBe('{authenticated}')
    expect(rows[0].qual).toMatch(/SELECT\s+unnest\(get_user_business_ids\(\)/i)
  })

  it('email_outbox_select_own is the InitPlan form and still separates tenants (a member of A sees A\'s row, never B\'s)', async () => {
    const { rows } = await pg.query(
      `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_outbox' AND policyname = 'email_outbox_select_own'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].qual).toMatch(/SELECT\s+unnest\(get_user_business_ids\(\)/i)

    const own = await viewerA.from('email_outbox').select('business_id, kind')
    expect(own.error).toBeNull()
    expect(own.data).toEqual([{ business_id: BUSINESS_A_ID, kind: 'monthly-report' }])
    const other = await userB.from('email_outbox').select('business_id').eq('business_id', BUSINESS_A_ID)
    expect(other.data).toEqual([])
  })
})
