import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0030 §2.4 / §11.1 #10 (Session 36 L2.2, A-5) — SUBSTRATE-MEMBER-WRITE-CLOSED, Tier 1, live Postgres.
//
// As an AUTHENTICATED MEMBER (the anon client signed in — NOT the admin client) of business A, a direct INSERT,
// UPDATE and DELETE on performance_memory must each fail with error.code === '42501' AND a "permission denied"
// message. NOT `error !== null` and NOT `data === null`: a silent zero-row RLS filter satisfies both and proves
// nothing. 42501 alone is ambiguous (RLS violation vs missing grant), and the migration under test closes the door
// at the GRANT layer, before RLS is consulted — so the message is asserted too.
//
// REDDEN DIRECTION (ADR 0030 §1.1 fact 6): before the migration a member's INSERT of source='manual', status='active',
// confidence 1.0 SUCCEEDS and the row is ACTIVE. That is why these cases exist.
//
// The same three cases run on audience_memory, which ADR 0029 (Session 35 M2.2) already closed: this file proves both
// halves of "the member write path is closed on all four memory tables". brand_memory and evidence_memory are proven
// by interview-member-write-closed.test.ts and not repeated.

const PASSWORD = 'TestPass123!'

describe('SUBSTRATE-MEMBER-WRITE-CLOSED (ADR 0030 §2.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let ownerAEmail: string
  let ownerAId: string
  let ownerBId: string
  let businessAId: string
  let businessBId: string
  let memberA: SupabaseClient
  let seq = 0
  const perfA = { target: '', readable: '' }
  let perfB = ''
  const audA = { target: '', readable: '' }
  let audB = ''

  async function createUser(label: string) {
    const email = `subst-wc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function signInAs(email: string): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  const perfRow = (businessId: string, over: Record<string, unknown> = {}) => {
    seq += 1
    return {
      business_id: businessId,
      source: 'manual',
      scope: 'brand',
      dimension: 'topic',
      pattern: `L2.2 performance row ${seq}`,
      platform: 'linkedin',
      status: 'active',
      confidence: 0.5,
      ...over,
    }
  }
  const audRow = (businessId: string, text: string, over: Record<string, unknown> = {}) => ({
    business_id: businessId,
    source: 'manual',
    scope: 'brand',
    kind: 'problem',
    statement: text,
    status: 'active',
    ...over,
  })

  async function seed(table: 'performance_memory' | 'audience_memory', row: Record<string, unknown>): Promise<string> {
    const { data, error } = await admin.from(table).insert(row).select('id').single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for the privilege and policy checks')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Substrate Write-Closed Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id
    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Substrate Write-Closed Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    // ACTIVE rows (memory defaults to 'candidate', so a careless seed is vacuously green), one the write cases
    // target and one they never touch, so the positive-control SELECT never depends on an earlier DELETE case.
    perfA.target = await seed('performance_memory', perfRow(businessAId))
    perfA.readable = await seed('performance_memory', perfRow(businessAId))
    perfB = await seed('performance_memory', perfRow(businessBId))
    audA.target = await seed('audience_memory', audRow(businessAId, 'L2.2 own-tenant target'))
    audA.readable = await seed('audience_memory', audRow(businessAId, 'L2.2 own-tenant readable'))
    audB = await seed('audience_memory', audRow(businessBId, 'L2.2 other-tenant'))

    memberA = await signInAs(ownerAEmail)
  })

  afterAll(async () => {
    if (admin) {
      for (const table of ['performance_memory', 'audience_memory']) {
        if (businessAId) await admin.from(table).delete().eq('business_id', businessAId)
        if (businessBId) await admin.from(table).delete().eq('business_id', businessBId)
      }
      if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
      if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
      for (const id of [ownerAId, ownerBId]) {
        if (id) await admin.auth.admin.deleteUser(id)
      }
    }
    if (pg) await pg.end()
  })

  // ─── performance_memory: the path A-5 closes ────────────────────────────────

  it('performance_memory: a member INSERT (source manual, status active, confidence 1.0) fails with 42501 (permission denied)', async () => {
    const marker = 'L2.2 member insert probe (performance_memory)'
    const { data, error } = await memberA
      .from('performance_memory')
      .insert(perfRow(businessAId, { pattern: marker, status: 'active', confidence: 1.0, public_use_permission: true }))
      .select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    // The row must not exist: the admin client sees every row.
    const { data: rows, error: readErr } = await admin.from('performance_memory').select('id').eq('pattern', marker)
    expect(readErr).toBeNull()
    expect(rows ?? []).toHaveLength(0)
  })

  it('performance_memory: a member UPDATE of their own row fails with 42501 (permission denied), and the row is unchanged', async () => {
    const { data, error } = await memberA.from('performance_memory').update({ confidence: 0.9 }).eq('id', perfA.target).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    const { data: row } = await admin.from('performance_memory').select('confidence').eq('id', perfA.target).single()
    expect(Number(row.confidence)).toBe(0.5)
  })

  it('performance_memory: a member DELETE of their own row fails with 42501 (permission denied), and the row survives', async () => {
    const { data, error } = await memberA.from('performance_memory').delete().eq('id', perfA.target).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    const { data: row, error: readErr } = await admin.from('performance_memory').select('id').eq('id', perfA.target).single()
    expect(readErr).toBeNull()
    expect(row.id).toBe(perfA.target)
  })

  // ─── audience_memory: already closed by ADR 0029 (the ADR 0030 §11.1 #10 arm) ───

  it('audience_memory: a member INSERT fails with 42501 (permission denied)', async () => {
    const marker = 'L2.2 member insert probe (audience_memory)'
    const { data, error } = await memberA.from('audience_memory').insert(audRow(businessAId, marker)).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)
    const { data: rows } = await admin.from('audience_memory').select('id').eq('statement', marker)
    expect(rows ?? []).toHaveLength(0)
  })

  it('audience_memory: a member UPDATE of their own row fails with 42501 (permission denied)', async () => {
    const { data, error } = await memberA.from('audience_memory').update({ confidence: 0.9 }).eq('id', audA.target).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)
  })

  it('audience_memory: a member DELETE of their own row fails with 42501 (permission denied)', async () => {
    const { data, error } = await memberA.from('audience_memory').delete().eq('id', audA.target).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)
    const { data: row } = await admin.from('audience_memory').select('id').eq('id', audA.target).single()
    expect(row.id).toBe(audA.target)
  })

  // ─── Positive control and tenant isolation: SELECT is KEPT ──────────────────

  it.each([
    ['performance_memory', () => perfA.readable],
    ['audience_memory', () => audA.readable],
  ] as const)('%s: a member can still SELECT their own ACTIVE row (positive control)', async (table, id) => {
    const { data, error } = await memberA.from(table).select('id, status').eq('id', id())
    expect(error).toBeNull()
    expect(data ?? []).toEqual([{ id: id(), status: 'active' }])
  })

  it.each([
    ['performance_memory', () => perfB],
    ['audience_memory', () => audB],
  ] as const)("%s: a member still cannot SELECT another business's row", async (table, id) => {
    const { data, error } = await memberA.from(table).select('id').eq('id', id())
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  // ─── The grant and policy layer, read straight from the catalog ─────────────

  it.each(['performance_memory', 'audience_memory'])(
    '%s: authenticated and anon hold no INSERT/UPDATE/DELETE/TRUNCATE; authenticated keeps SELECT; service_role keeps INSERT',
    async (table) => {
      for (const role of ['authenticated', 'anon']) {
        for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          const { rows } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${table}`, priv])
          expect(rows[0].ok, `${role} still holds ${priv} on ${table}`).toBe(false)
        }
      }
      const { rows } = await pg.query<{ ok: boolean }>("SELECT has_table_privilege('authenticated', $1, 'SELECT') AS ok", [`public.${table}`])
      expect(rows[0].ok).toBe(true)
      const { rows: sr } = await pg.query<{ ok: boolean }>("SELECT has_table_privilege('service_role', $1, 'INSERT') AS ok", [`public.${table}`])
      expect(sr[0].ok).toBe(true)
    },
  )

  it.each(['performance_memory', 'audience_memory'])('%s: exactly one policy remains — <table>_select_own, FOR SELECT', async (table) => {
    const { rows } = await pg.query<{ policyname: string; cmd: string }>(
      'SELECT policyname, cmd FROM pg_policies WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname',
      ['public', table],
    )
    expect(rows).toEqual([{ policyname: `${table}_select_own`, cmd: 'SELECT' }])
  })

  // The defence in depth is KEPT and NOT edited (ADR 0030 §2.4): unreachable by clients, still present.
  it('the write-protection trigger and the delete guard are kept (defence in depth)', async () => {
    const { rows } = await pg.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.performance_memory'::regclass AND NOT tgisinternal ORDER BY tgname`,
    )
    const names = rows.map((r) => r.tgname)
    expect(names).toContain('trg_performance_memory_outcome_write_protect')
    expect(names).toContain('trg_performance_memory_import_immutable')
    expect(names).toContain('trg_performance_memory_voice_write_guard')
    const { rows: fn } = await pg.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc WHERE proname = 'enforce_performance_memory_write_protection'`,
    )
    expect(fn[0].n).toBe('1')
  })
})
