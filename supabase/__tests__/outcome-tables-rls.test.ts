import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0026 §11 — OUTCOME-RLS-ISOLATED (33). Tier 1, live Postgres.
//
// Each of the three tables has ONE SELECT policy in the InitPlan form and NO
// authenticated INSERT/UPDATE/DELETE policy — writes are the DEFINER trigger, the
// service-role worker and the acknowledge RPC. Cross-tenant SELECT is denied, and an
// authenticated member cannot write at all: no policy AND (defence in depth) no
// privilege, so a permissive policy added later cannot silently open a write path.

const PASSWORD = 'TestPass123!'
const TABLES = ['post_dimensions', 'post_outcomes', 'campaign_retrospectives'] as const
type OutcomeTable = (typeof TABLES)[number]

// A permission-denied write, not a coincidental constraint error.
const PERMISSION_DENIED = '42501'

interface Tenant {
  userId: string
  email: string
  businessId: string
  campaignId: string
  postId: string
  originId: string
}

describe('outcome tables — RLS isolation (ADR 0026 §11)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let a: Tenant
  let b: Tenant
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  async function signInAs(email: string): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  async function createTenant(label: string): Promise<Tenant> {
    const email = `outcome-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (userErr) throw userErr
    const userId = user.user.id as string

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: `Outcome RLS ${label}`, owner_id: userId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .insert({
        business_id: biz.id,
        name: `Outcome RLS Campaign ${label}`,
        objective: 'fixtures',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-09-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campErr) throw campErr

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaign.id,
        business_id: biz.id,
        platform: 'linkedin',
        content: `RLS post ${label}`,
        hashtags: [],
        scheduled_at: '2026-09-15T12:00:00Z',
        status: 'draft',
        role: 'anchor_thesis',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    // The AFTER INSERT trigger tags this snapshot -> a post_dimensions row exists.
    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: biz.id,
        post_id: post.id,
        campaign_id: campaign.id,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'x' },
        rendered_content: 'x',
        hashtags: [],
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr

    const { error: outErr } = await admin.from('post_outcomes').insert({
      post_id: post.id,
      business_id: biz.id,
      campaign_id: campaign.id,
      platform: 'linkedin',
      published_at: '2026-09-01T12:00:00Z',
      ai_original_id: origin.id,
      metric_basis: 'count',
      value: 12,
      measured_at: '2026-09-08T12:00:00Z',
    })
    if (outErr) throw outErr

    const { error: retroErr } = await admin.from('campaign_retrospectives').insert({
      campaign_id: campaign.id,
      business_id: biz.id,
      hypothesis_snapshot: `Hypothesis ${label}`,
      hypothesis_source: 'implicit',
      criteria_snapshot: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 },
      verdict: 'supported',
      n: 8,
      wins: 6,
      completed_at: '2026-09-15T12:00:00Z',
    })
    if (retroErr) throw retroErr

    return { userId, email, businessId: biz.id, campaignId: campaign.id, postId: post.id, originId: origin.id }
  }

  const keyOf = (t: OutcomeTable, tenant: Tenant): [string, string] =>
    t === 'post_dimensions'
      ? ['ai_original_id', tenant.originId]
      : t === 'post_outcomes'
        ? ['post_id', tenant.postId]
        : ['campaign_id', tenant.campaignId]

  async function countFor(table: OutcomeTable, businessId: string): Promise<number> {
    const { data, error } = await admin.from(table).select('business_id').eq('business_id', businessId)
    if (error) throw error
    return (data ?? []).length
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for catalogue checks')
    pg = new Client({ connectionString: url })
    await pg.connect()

    a = await createTenant('a')
    b = await createTenant('b')
    clientA = await signInAs(a.email)
    clientB = await signInAs(b.email)
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    for (const t of [a, b]) {
      if (t?.businessId) await admin.from('businesses').delete().eq('id', t.businessId)
      if (t?.userId) await admin.auth.admin.deleteUser(t.userId)
    }
  })

  it.each(TABLES)('%s: each tenant sees ONLY its own rows (and does see them)', async (table) => {
    const ownA = await clientA.from(table).select('business_id')
    expect(ownA.error).toBeNull()
    expect(ownA.data!.length).toBeGreaterThanOrEqual(1)
    expect(new Set(ownA.data!.map((r) => r.business_id))).toEqual(new Set([a.businessId]))

    const ownB = await clientB.from(table).select('business_id')
    expect(ownB.error).toBeNull()
    expect(ownB.data!.length).toBeGreaterThanOrEqual(1)
    expect(new Set(ownB.data!.map((r) => r.business_id))).toEqual(new Set([b.businessId]))
  })

  it.each(TABLES)('%s: a targeted cross-tenant SELECT returns nothing, both directions', async (table) => {
    const aReadsB = await clientA.from(table).select('business_id').eq('business_id', b.businessId)
    expect(aReadsB.error).toBeNull()
    expect(aReadsB.data).toEqual([])

    const bReadsA = await clientB.from(table).select('business_id').eq('business_id', a.businessId)
    expect(bReadsA.error).toBeNull()
    expect(bReadsA.data).toEqual([])

    // Even asking for the other tenant's exact primary key finds nothing.
    const [keyCol, keyVal] = keyOf(table, b)
    const byKey = await clientA.from(table).select('business_id').eq(keyCol, keyVal)
    expect(byKey.data ?? []).toEqual([])
  })

  it.each(TABLES)('%s: an authenticated member cannot INSERT (permission denied, no row created)', async (table) => {
    const before = await countFor(table, a.businessId)
    const row: Record<OutcomeTable, Record<string, unknown>> = {
      post_dimensions: {
        ai_original_id: a.originId,
        business_id: a.businessId,
        post_id: a.postId,
        campaign_id: a.campaignId,
        platform: 'linkedin',
        taxonomy_version: 1,
      },
      post_outcomes: {
        post_id: a.postId,
        business_id: a.businessId,
        campaign_id: a.campaignId,
        platform: 'linkedin',
        published_at: '2026-09-01T12:00:00Z',
        metric_basis: 'count',
        value: 1,
        measured_at: '2026-09-08T12:00:00Z',
      },
      campaign_retrospectives: {
        campaign_id: a.campaignId,
        business_id: a.businessId,
        hypothesis_snapshot: 'forged',
        hypothesis_source: 'implicit',
        criteria_snapshot: {},
        verdict: 'supported',
        n: 1,
        wins: 1,
        completed_at: '2026-09-15T12:00:00Z',
      },
    }
    const { error } = await clientA.from(table).insert(row[table])
    expect(error, 'an authenticated INSERT must fail').not.toBeNull()
    expect(error!.code).toBe(PERMISSION_DENIED)
    expect(await countFor(table, a.businessId)).toBe(before)
  })

  it.each(TABLES)('%s: an authenticated member cannot UPDATE its OWN row (permission denied, row unchanged)', async (table) => {
    const [keyCol, keyVal] = keyOf(table, a)
    const patch: Record<OutcomeTable, Record<string, unknown>> = {
      post_dimensions: { role: 'follow_up' },
      post_outcomes: { value: 999 },
      campaign_retrospectives: { verdict: 'not_supported' },
    }
    const { error } = await clientA.from(table).update(patch[table]).eq(keyCol, keyVal)
    expect(error, 'an authenticated UPDATE must fail').not.toBeNull()
    expect(error!.code).toBe(PERMISSION_DENIED)

    const { data } = await admin.from(table).select('*').eq(keyCol, keyVal).single()
    if (table === 'post_dimensions') expect(data.role).toBe('anchor_thesis')
    if (table === 'post_outcomes') expect(Number(data.value)).toBe(12)
    if (table === 'campaign_retrospectives') expect(data.verdict).toBe('supported')
  })

  it.each(TABLES)('%s: an authenticated member cannot DELETE its OWN row (permission denied, row survives)', async (table) => {
    const [keyCol, keyVal] = keyOf(table, a)
    const { error } = await clientA.from(table).delete().eq(keyCol, keyVal)
    expect(error, 'an authenticated DELETE must fail').not.toBeNull()
    expect(error!.code).toBe(PERMISSION_DENIED)
    const { data } = await admin.from(table).select('business_id').eq(keyCol, keyVal)
    expect(data).toHaveLength(1)
  })

  it.each(TABLES)('%s: an unauthenticated (anon) client reads nothing', async (table) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data } = await anon.from(table).select('business_id')
    expect(data ?? []).toEqual([])
  })

  describe('the policies and privileges as they exist in the catalogue', () => {
    it.each(TABLES)('%s: RLS is enabled with exactly ONE policy — SELECT, TO authenticated, InitPlan form', async (table) => {
      const { rows: rls } = await pg.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
        [table],
      )
      expect(rls[0].relrowsecurity).toBe(true)

      const { rows } = await pg.query<{ policyname: string; cmd: string; roles: string[]; qual: string }>(
        `SELECT policyname, cmd, roles::text[] AS roles, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [table],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].policyname).toBe(`${table}_select_own`)
      expect(rows[0].cmd).toBe('SELECT')
      expect(rows[0].roles).toEqual(['authenticated'])
      // InitPlan form: the function is evaluated once per query, not once per row.
      // Postgres stores `= ANY (SELECT unnest(...))` normalised as `IN (SELECT unnest(...))`,
      // so the assertion is PARITY with the already-shipped governed-memory policy — the
      // established form (CLAUDE.md: wrapped in SELECT) — rather than a hand-written regex.
      expect(rows[0].qual).toMatch(/get_user_business_ids\(\)/)
      expect(rows[0].qual).toMatch(/SELECT unnest\(/i)
      const { rows: reference } = await pg.query<{ qual: string }>(
        `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'performance_memory' AND policyname = 'performance_memory_select_own'`,
      )
      expect(rows[0].qual).toBe(reference[0].qual)
    })

    it.each(TABLES)('%s: privileges — authenticated may only SELECT; anon nothing; service_role writes', async (table) => {
      const has = async (role: string, priv: string) => {
        const { rows } = await pg.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, priv])
        return rows[0].ok
      }
      expect(await has('authenticated', 'SELECT')).toBe(true)
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(await has('authenticated', priv), `authenticated ${priv}`).toBe(false)
        expect(await has('anon', priv), `anon ${priv}`).toBe(false)
      }
      expect(await has('anon', 'SELECT')).toBe(false)
      expect(await has('service_role', 'INSERT')).toBe(true)
    })
  })
})
