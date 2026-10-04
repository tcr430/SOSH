import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { BUSINESS_A_ID, BUSINESS_B_ID } from '@/lib/analytics/__fixtures__/portfolio'
import { SEED_OWNER_EMAIL, SEED_PASSWORD, cleanPortfolio, seedPortfolio } from '@/lib/analytics/__fixtures__/seed-live'

// ADR 0031 §5.1, §5.4, §11, §12.1 items 2-5, 7, 8 and 10 — Tier 1, live Postgres (Session 37 O2.2).
//
//   21 REPORT-SNAPSHOT-IMMUTABLE   write-once for service-role too; the trigger is reject_outcome_table_update, BEFORE
//                                  UPDATE only (a DELETE and the FK cascade still work)
//   22 REPORT-ONE-PER-PERIOD       (Tier-1 half) UNIQUE (business_id, period_month) and ON CONFLICT DO NOTHING
//   41 REPORT-EMAIL-KIND-WIDENED   the kind CHECK accepts monthly-report AND all six prior kinds; the dedupe index holds
//   42 REPORT-EMAIL-SETTING-...    (Tier-1 half) report_email CHECK; ONLY the owner can write it (founder ruling O-3)
// plus the grants (error.code 42501, never merely a non-null error), the DEFINER audit gate (no new function) and the
// posts index matching the report's predicates literally.
const PERMISSION_DENIED = '42501'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

// 20260709120000:3-9 plus the new kind. Spelled out here, not imported, so a dropped kind fails THIS file.
const SIX_PRIOR_KINDS = [
  'trial-warning-t3',
  'trial-warning-t1',
  'welcome-to-plan',
  'payment-failed-courtesy',
  'first-post-published',
  'team-invite',
] as const

const REPORT = {
  tier: 'advanced',
  schema_version: 1,
  payload: { marker: 'constraints' },
  outcomes_through: '2026-04-10T06:00:00Z',
  generated_at: '2026-04-10T06:05:00Z',
}

describe('analytics_reports — constraints, write-once, grants (ADR 0031 §5.1, §11)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let viewerA: SupabaseClient
  let owner: SupabaseClient
  let adminMember: SupabaseClient
  let anon: SupabaseClient
  let baseReportId = ''

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

    const { data, error } = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-03-01' }).select('id').single()
    if (error) throw error
    baseReportId = data.id as string

    owner = await signInAs(SEED_OWNER_EMAIL)
    viewerA = await signInAs('portfolio-viewer@integration.test')
    adminMember = await signInAs('portfolio-admin2@integration.test')
    anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    await admin.from('email_outbox').delete().in('business_id', [BUSINESS_A_ID, BUSINESS_B_ID])
    await cleanPortfolio(admin)
  })

  // ─── the two CHECKs ──────────────────────────────────────────────────────────────────────────────────────
  it('period_month must be the FIRST of its month: the 15th is rejected (23514), the 1st is accepted', async () => {
    const bad = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-04-15' })
    expect(bad.error?.code).toBe(CHECK_VIOLATION)
    expect(bad.error?.message).toContain('analytics_reports_period_month_check')
    const lastDay = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-04-30' })
    expect(lastDay.error?.code).toBe(CHECK_VIOLATION)
    const good = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-04-01' })
    expect(good.error).toBeNull()
  })

  it('tier is exactly basic | advanced: anything else is rejected (23514), both values are accepted', async () => {
    const bad = await admin.from('analytics_reports').insert({ ...REPORT, tier: 'premium', business_id: BUSINESS_A_ID, period_month: '2026-05-01' })
    expect(bad.error?.code).toBe(CHECK_VIOLATION)
    expect(bad.error?.message).toContain('analytics_reports_tier_check')
    for (const [tier, month] of [['basic', '2026-05-01'], ['advanced', '2026-06-01']] as const) {
      const ok = await admin.from('analytics_reports').insert({ ...REPORT, tier, business_id: BUSINESS_A_ID, period_month: month })
      expect(ok.error, `${tier} accepted`).toBeNull()
    }
  })

  // ─── one per (business, month) ───────────────────────────────────────────────────────────────────────────
  it('UNIQUE (business_id, period_month): a duplicate is rejected (23505) and the SAME month of ANOTHER business is accepted', async () => {
    const dup = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-03-01' })
    expect(dup.error?.code).toBe(UNIQUE_VIOLATION)
    expect(dup.error?.message).toContain('analytics_reports_business_period_uq')
    const other = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_B_ID, period_month: '2026-03-01' })
    expect(other.error).toBeNull()
  })

  it('INSERT ... ON CONFLICT DO NOTHING returns NO row for the loser and one row for a new month', async () => {
    const sql = `INSERT INTO public.analytics_reports (business_id, period_month, tier, schema_version, payload, outcomes_through, generated_at)
                 VALUES ($1, $2, 'basic', 1, '{}'::jsonb, now(), now())
                 ON CONFLICT (business_id, period_month) DO NOTHING RETURNING id`
    const loser = await pg.query(sql, [BUSINESS_A_ID, '2026-03-01'])
    expect(loser.rows).toHaveLength(0)
    const winner = await pg.query(sql, [BUSINESS_A_ID, '2026-07-01'])
    expect(winner.rows).toHaveLength(1)
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM public.analytics_reports WHERE business_id = $1 AND period_month = '2026-03-01'`, [BUSINESS_A_ID])
    expect(rows[0].n).toBe(1)
  })

  // ─── write-once ──────────────────────────────────────────────────────────────────────────────────────────
  it('UPDATE raises for the SERVICE ROLE too, whatever column it touches, and the row is unchanged', async () => {
    for (const patch of [{ payload: { forged: true } }, { tier: 'basic' }, { generated_at: '2027-01-01T00:00:00Z' }]) {
      const res = await admin.from('analytics_reports').update(patch).eq('id', baseReportId).select('id')
      expect(res.error, JSON.stringify(patch)).not.toBeNull()
      expect(res.error.message).toMatch(/analytics_reports rows are immutable/)
    }
    const { data } = await admin.from('analytics_reports').select('payload, tier').eq('id', baseReportId).single()
    expect(data).toEqual({ payload: { marker: 'constraints' }, tier: 'advanced' })
  })

  it('UPDATE raises for the table owner connection as well (the trigger, not a privilege, is what stops it)', async () => {
    await expect(pg.query(`UPDATE public.analytics_reports SET schema_version = 2 WHERE id = $1`, [baseReportId])).rejects.toThrow(
      /analytics_reports rows are immutable/,
    )
  })

  it('the ONLY trigger is a BEFORE UPDATE row trigger calling reject_outcome_table_update (no DELETE trigger, no new function)', async () => {
    const { rows } = await pg.query(
      `SELECT t.tgname, t.tgtype, p.proname, p.prosecdef
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.analytics_reports'::regclass AND NOT t.tgisinternal`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].tgname).toBe('trg_analytics_reports_write_once')
    expect(rows[0].proname).toBe('reject_outcome_table_update')
    expect(rows[0].prosecdef).toBe(false)
    // tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE.
    expect(rows[0].tgtype & 1).toBe(1)
    expect(rows[0].tgtype & 2).toBe(2)
    expect(rows[0].tgtype & 16).toBe(16)
    expect(rows[0].tgtype & (4 | 8 | 32)).toBe(0)
  })

  it('DELETE is NOT blocked: a report row can be deleted (so the FK cascade and purge_business work)', async () => {
    const { data, error } = await admin.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-08-01' }).select('id').single()
    expect(error).toBeNull()
    const del = await admin.from('analytics_reports').delete().eq('id', data.id).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toHaveLength(1)
  })

  // ─── grants ──────────────────────────────────────────────────────────────────────────────────────────────
  it('an authenticated member cannot INSERT, UPDATE or DELETE: permission denied (42501), not merely some error', async () => {
    const ins = await viewerA.from('analytics_reports').insert({ ...REPORT, business_id: BUSINESS_A_ID, period_month: '2026-09-01' })
    expect(ins.error?.code).toBe(PERMISSION_DENIED)
    const upd = await viewerA.from('analytics_reports').update({ tier: 'basic' }).eq('id', baseReportId)
    expect(upd.error?.code).toBe(PERMISSION_DENIED)
    const del = await viewerA.from('analytics_reports').delete().eq('id', baseReportId)
    expect(del.error?.code).toBe(PERMISSION_DENIED)
    const { data } = await admin.from('analytics_reports').select('id').eq('id', baseReportId)
    expect(data).toHaveLength(1)
  })

  it('authenticated cannot TRUNCATE either: permission denied (42501)', async () => {
    await pg.query('BEGIN')
    try {
      await pg.query('SET LOCAL ROLE authenticated')
      await expect(pg.query('TRUNCATE public.analytics_reports')).rejects.toMatchObject({ code: PERMISSION_DENIED })
    } finally {
      await pg.query('ROLLBACK')
    }
  })

  it('the privilege matrix: authenticated has SELECT only; anon has nothing; service_role keeps INSERT and SELECT', async () => {
    const priv = async (role: string, p: string) => {
      const { rows } = await pg.query(`SELECT has_table_privilege($1, 'public.analytics_reports', $2) AS ok`, [role, p])
      return rows[0].ok as boolean
    }
    expect(await priv('authenticated', 'SELECT')).toBe(true)
    for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('authenticated', p), `authenticated ${p}`).toBe(false)
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('anon', p), `anon ${p}`).toBe(false)
    expect(await priv('service_role', 'INSERT')).toBe(true)
    expect(await priv('service_role', 'SELECT')).toBe(true)
    const { data } = await anon.from('analytics_reports').select('id')
    expect(data ?? []).toEqual([])
  })

  // ─── the email kind ──────────────────────────────────────────────────────────────────────────────────────
  it('the kind CHECK accepts monthly-report AND each of the six prior kinds', async () => {
    for (const kind of [...SIX_PRIOR_KINDS, 'monthly-report']) {
      const { error } = await admin.from('email_outbox').insert({
        business_id: BUSINESS_A_ID,
        kind,
        recipient: `kind-${kind}@integration.test`,
        locale: 'en',
        props: {},
        dedupe_token: `kind-check:${kind}`,
        status: 'pending',
      })
      expect(error, `kind ${kind} accepted`).toBeNull()
    }
  })

  it('an unknown kind is still rejected (23514), and the constraint lists exactly seven kinds', async () => {
    const bad = await admin.from('email_outbox').insert({
      business_id: BUSINESS_A_ID,
      kind: 'weekly-digest',
      recipient: 'x@integration.test',
      locale: 'en',
      props: {},
      status: 'pending',
    })
    expect(bad.error?.code).toBe(CHECK_VIOLATION)
    const { rows } = await pg.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'email_outbox_kind_check'`)
    const kinds = [...(rows[0].def as string).matchAll(/'([a-z0-9-]+)'::text/g)].map((m) => m[1]).sort()
    expect(kinds).toEqual([...SIX_PRIOR_KINDS, 'monthly-report'].sort())
  })

  it('dedupe uniqueness holds on the token: the same (business, kind, token) twice is rejected (23505), another token is accepted', async () => {
    const row = (token: string) => ({
      business_id: BUSINESS_A_ID,
      kind: 'monthly-report',
      recipient: 'dedupe@integration.test',
      locale: 'en',
      props: {},
      dedupe_token: token,
      status: 'pending',
    })
    expect((await admin.from('email_outbox').insert(row('report:2026-03:member-1'))).error).toBeNull()
    const again = await admin.from('email_outbox').insert(row('report:2026-03:member-1'))
    expect(again.error?.code).toBe(UNIQUE_VIOLATION)
    expect((await admin.from('email_outbox').insert(row('report:2026-03:member-2'))).error).toBeNull()
  })

  // ─── no new SQL function ─────────────────────────────────────────────────────────────────────────────────
  it('the DEFINER audit gate returns the BASE count (3) and names no analytics function: this migration created no function', async () => {
    const { rows } = await pg.query(
      `SELECT p.oid::regprocedure::text AS sig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        ORDER BY 1`,
    )
    expect(rows.map((r) => r.sig)).toEqual(['accept_invite(uuid,uuid)', 'get_user_business_ids()', 'user_can(uuid,text)'])
    const { rows: fn } = await pg.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname ILIKE '%analytics_report%'`)
    expect(fn[0].n).toBe(0)
  })

  // ─── businesses.report_email (A-6; founder ruling O-3: owner-only through RLS) ──────────────────────────
  it('report_email defaults to admins and its CHECK admits exactly admins | all_members | off', async () => {
    const { data } = await admin.from('businesses').select('id, report_email').in('id', [BUSINESS_A_ID, BUSINESS_B_ID])
    expect(data.map((r: { report_email: string }) => r.report_email)).toEqual(['admins', 'admins'])
    const bad = await admin.from('businesses').update({ report_email: 'everyone' }).eq('id', BUSINESS_A_ID)
    expect(bad.error?.code).toBe(CHECK_VIOLATION)
    expect(bad.error?.message).toContain('businesses_report_email_check')
    for (const v of ['all_members', 'off', 'admins']) {
      expect((await admin.from('businesses').update({ report_email: v }).eq('id', BUSINESS_A_ID)).error, v).toBeNull()
    }
  })

  it('the OWNER can change report_email through the authenticated client', async () => {
    const res = await owner.from('businesses').update({ report_email: 'off' }).eq('id', BUSINESS_A_ID).select('report_email')
    expect(res.error).toBeNull()
    expect(res.data).toEqual([{ report_email: 'off' }])
    await admin.from('businesses').update({ report_email: 'admins' }).eq('id', BUSINESS_A_ID)
  })

  it('a NON-owner cannot change it: an ADMIN member and a viewer both update zero rows and the value is unchanged', async () => {
    for (const [who, client] of [['admin member', adminMember], ['viewer', viewerA]] as const) {
      const res = await client.from('businesses').update({ report_email: 'off' }).eq('id', BUSINESS_A_ID).select('report_email')
      expect(res.data ?? [], `${who} wrote nothing`).toEqual([])
    }
    const { data } = await admin.from('businesses').select('report_email').eq('id', BUSINESS_A_ID).single()
    expect(data.report_email).toBe('admins')
  })

  // ─── the posts index ─────────────────────────────────────────────────────────────────────────────────────
  it('posts_business_published_idx is (business_id, published_at DESC) WHERE status = published AND deleted_at IS NULL', async () => {
    const { rows } = await pg.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'posts_business_published_idx'`)
    expect(rows).toHaveLength(1)
    const def = rows[0].indexdef as string
    expect(def).toMatch(/\(business_id, published_at DESC\)/)
    expect(def).toMatch(/status = 'published'::text/)
    expect(def).toMatch(/deleted_at IS NULL/)
  })

  it('the report\'s own query (both predicates repeated literally, ORDER BY published_at DESC) USES the index; one missing predicate does NOT', async () => {
    const q = (extra: string) =>
      `EXPLAIN SELECT id FROM public.posts
        WHERE business_id = '${BUSINESS_A_ID}' AND status = 'published' ${extra}
          AND published_at >= '2026-03-01T00:00:00Z' AND published_at < '2026-04-01T00:00:00Z'
        ORDER BY published_at DESC, id DESC LIMIT 500`
    // Planner-independent (database-reviewer MINOR-1, then proven wrong to rely on statistics: with real stats on a tiny
    // table the planner prefers posts_business_id_status_idx plus a sort). So take the OTHER business_id indexes away
    // inside a transaction we roll back: the new partial index can then be used if and only if the query's predicates
    // imply its WHERE clause, which is exactly "matches the queries' predicates literally".
    await pg.query('BEGIN')
    await pg.query('DROP INDEX public.posts_business_id_status_idx')
    await pg.query('DROP INDEX public.posts_business_id_created_at_idx')
    await pg.query('DROP INDEX public.idx_posts_business_scheduled_at')
    await pg.query('SET LOCAL enable_seqscan = off')
    try {
      const withBoth = (await pg.query(q('AND deleted_at IS NULL'))).rows.map((r) => r['QUERY PLAN']).join('\n')
      expect(withBoth).toContain('posts_business_published_idx')
      const missing = (await pg.query(q(''))).rows.map((r) => r['QUERY PLAN']).join('\n')
      expect(missing).not.toContain('posts_business_published_idx')
    } finally {
      await pg.query('ROLLBACK')
    }
  })
})
