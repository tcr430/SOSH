import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0029 §2.4 / §10.1 — INTERVIEW-MEMBER-WRITE-CLOSED (13) and the Tier-1 half of
// INTERVIEW-PERFORMANCE-POLICY-UNCHANGED (14). Live Postgres.
//
// As an AUTHENTICATED MEMBER (the anon client signed in — NOT the admin client) of business A, a
// direct INSERT, UPDATE and DELETE on brand_memory, evidence_memory and audience_memory must each
// fail with error code 42501 — nine cases. NOT `error !== null` and NOT `data === null`: a silent
// zero-row RLS filter satisfies both and proves nothing ([test-2]).
//
// 42501 alone is still ambiguous: Postgres raises it for BOTH an RLS violation ("new row violates
// row-level security policy") and a missing grant ("permission denied for table"). The migration
// under test closes the door at the GRANT layer, before RLS is consulted, so each case also asserts
// the "permission denied" message. Before the migration the same INSERT succeeds and the same
// UPDATE/DELETE succeed (the any-member policies are open), which is the REDDEN direction.
//
// The three tables are closed to member writes; every writer is a service-role SECURITY DEFINER
// function or the admin client, which do not depend on `authenticated` privileges. performance_memory
// is UNTOUCHED (a deliberate Session 33 path — ADR 0026 §5.5): its policies and grants are asserted
// unchanged below.

const PASSWORD = 'TestPass123!'

type ClosedTable = 'brand_memory' | 'evidence_memory' | 'audience_memory'
const CLOSED_TABLES: ClosedTable[] = ['brand_memory', 'evidence_memory', 'audience_memory']

// Minimal valid domain columns per table (ADR 0016 §3.1-§3.3) and the text column each carries.
const DOMAIN: Record<ClosedTable, { textColumn: 'statement' | 'content'; columns: Record<string, unknown> }> = {
  brand_memory: { textColumn: 'statement', columns: { category: 'positioning' } },
  evidence_memory: { textColumn: 'content', columns: { kind: 'quote' } },
  audience_memory: { textColumn: 'statement', columns: { kind: 'problem' } },
}

function baseRow(table: ClosedTable, businessId: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    business_id: businessId,
    source: 'manual',
    scope: 'brand',
    ...DOMAIN[table].columns,
    [DOMAIN[table].textColumn]: text,
    ...extra,
  }
}

describe('INTERVIEW-MEMBER-WRITE-CLOSED (ADR 0029 §2.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let ownerAEmail: string
  let ownerAId: string
  let ownerBId: string
  let businessAId: string
  let businessBId: string
  let memberA: SupabaseClient
  const seededA: Record<ClosedTable, string> = {} as Record<ClosedTable, string>
  const seededB: Record<ClosedTable, string> = {} as Record<ClosedTable, string>
  // A row no write case touches, so the positive-control SELECT never depends on whether an earlier
  // DELETE case (which SUCCEEDS on the pre-migration schema) removed seededA.
  const readableA: Record<ClosedTable, string> = {} as Record<ClosedTable, string>

  async function createUser(label: string) {
    const email = `intw-wc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  async function seed(table: ClosedTable, businessId: string, text: string): Promise<string> {
    const { data, error } = await admin
      .from(table)
      .insert(baseRow(table, businessId, text, { status: 'active' }))
      .select('id')
      .single()
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
      .insert({ name: 'Interview Write-Closed Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id
    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Interview Write-Closed Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    for (const table of CLOSED_TABLES) {
      seededA[table] = await seed(table, businessAId, `M22 own-tenant active row for ${table}`)
      seededB[table] = await seed(table, businessBId, `M22 other-tenant active row for ${table}`)
      readableA[table] = await seed(table, businessAId, `M22 own-tenant read-only row for ${table}`)
    }

    memberA = await signInAs(ownerAEmail)
  })

  afterAll(async () => {
    if (admin) {
      for (const table of CLOSED_TABLES) {
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

  // ─── The nine write cases ───────────────────────────────────────────────────

  it.each(CLOSED_TABLES)('%s: a member INSERT into their own business fails with 42501 (permission denied)', async (table) => {
    const marker = `M22 member insert probe ${table}`
    const { data, error } = await memberA.from(table).insert(baseRow(table, businessAId, marker)).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    // The row must not exist: the admin client sees every row.
    const { data: rows, error: readErr } = await admin.from(table).select('id').eq(DOMAIN[table].textColumn, marker)
    expect(readErr).toBeNull()
    expect(rows ?? []).toHaveLength(0)
  })

  it.each(CLOSED_TABLES)('%s: a member UPDATE of their own row fails with 42501 (permission denied)', async (table) => {
    const { data, error } = await memberA.from(table).update({ confidence: 0.9 }).eq('id', seededA[table]).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    const { data: row } = await admin.from(table).select('confidence').eq('id', seededA[table]).single()
    expect(Number(row.confidence)).toBe(0.5)
  })

  it.each(CLOSED_TABLES)('%s: a member DELETE of their own row fails with 42501 (permission denied)', async (table) => {
    const { data, error } = await memberA.from(table).delete().eq('id', seededA[table]).select()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/permission denied/i)
    expect(data ?? []).toHaveLength(0)

    const { data: row, error: readErr } = await admin.from(table).select('id').eq('id', seededA[table]).single()
    expect(readErr).toBeNull()
    expect(row.id).toBe(seededA[table])
  })

  // ─── Positive control and tenant isolation: SELECT is KEPT ──────────────────

  it.each(CLOSED_TABLES)('%s: a member can still SELECT their own active row (positive control)', async (table) => {
    const { data, error } = await memberA.from(table).select('id').eq('id', readableA[table])
    expect(error).toBeNull()
    expect((data ?? []).map((r: { id: string }) => r.id)).toEqual([readableA[table]])
  })

  // The onboarding step-4 page reads IMPORT CANDIDATES through the MEMBER client
  // (listEvidenceCandidatesForRun / listAudienceCandidatesForRun, status = 'candidate'). That page has
  // no test file, so this control is the only executed proof that closing the write policies did not
  // take those reads with them: the SELECT policy has no status filter and is untouched.
  it.each(['evidence_memory', 'audience_memory'] as const)('%s: a member can still SELECT a status=candidate row (the step-4 reader shape)', async (table) => {
    const { data: created, error: seedErr } = await admin
      .from(table)
      .insert(baseRow(table, businessAId, `M22 own-tenant candidate row for ${table}`, { status: 'candidate' }))
      .select('id')
      .single()
    expect(seedErr).toBeNull()

    const { data, error } = await memberA.from(table).select('id, status').eq('business_id', businessAId).eq('status', 'candidate')
    expect(error).toBeNull()
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(created.id)
  })

  it.each(CLOSED_TABLES)("%s: a member still cannot SELECT another business's row", async (table) => {
    const { data, error } = await memberA.from(table).select('id').eq('id', seededB[table])
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  // ─── The grant and policy layer, read straight from the catalog ─────────────

  it.each(CLOSED_TABLES)('%s: authenticated and anon hold no INSERT/UPDATE/DELETE/TRUNCATE; authenticated keeps SELECT', async (table) => {
    for (const role of ['authenticated', 'anon']) {
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const { rows } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${table}`, priv])
        expect(rows[0].ok, `${role} still holds ${priv} on ${table}`).toBe(false)
      }
    }
    const { rows } = await pg.query<{ ok: boolean }>("SELECT has_table_privilege('authenticated', $1, 'SELECT') AS ok", [`public.${table}`])
    expect(rows[0].ok).toBe(true)
    // The service-role writers do not depend on authenticated privileges.
    const { rows: sr } = await pg.query<{ ok: boolean }>("SELECT has_table_privilege('service_role', $1, 'INSERT') AS ok", [`public.${table}`])
    expect(sr[0].ok).toBe(true)
  })

  it.each(CLOSED_TABLES)('%s: exactly one policy remains — <table>_select_own, FOR SELECT', async (table) => {
    const { rows } = await pg.query<{ policyname: string; cmd: string }>(
      'SELECT policyname, cmd FROM pg_policies WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname',
      ['public', table],
    )
    expect(rows).toEqual([{ policyname: `${table}_select_own`, cmd: 'SELECT' }])
  })

  // ─── INTERVIEW-PERFORMANCE-POLICY-UNCHANGED (14), Tier-1 half ───────────────

  it('performance_memory is UNTOUCHED: its four policies and its member INSERT/UPDATE/DELETE grants remain', async () => {
    const { rows } = await pg.query<{ policyname: string; cmd: string }>(
      'SELECT policyname, cmd FROM pg_policies WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname',
      ['public', 'performance_memory'],
    )
    expect(rows).toEqual([
      { policyname: 'performance_memory_delete_own', cmd: 'DELETE' },
      { policyname: 'performance_memory_insert_own', cmd: 'INSERT' },
      { policyname: 'performance_memory_select_own', cmd: 'SELECT' },
      { policyname: 'performance_memory_update_own', cmd: 'UPDATE' },
    ])
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows: g } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', ['authenticated', 'public.performance_memory', priv])
      expect(g[0].ok, `authenticated lost ${priv} on performance_memory`).toBe(true)
    }
  })
})
