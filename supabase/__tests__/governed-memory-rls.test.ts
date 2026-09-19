import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0016 §4 / §8 — MEM-RLS-ISOLATED, MEM-CASCADE-COMPLETE (Tier-1, live Postgres).
// Cross-tenant SELECT/INSERT/UPDATE must be denied on all four governed-memory
// tables (USING + WITH CHECK proven, not assumed), and business erasure must
// cascade the rows away.

const PASSWORD = 'TestPass123!'

type MemoryTable = 'brand_memory' | 'evidence_memory' | 'audience_memory' | 'performance_memory'

// Minimal valid domain columns per table (ADR §3.1-§3.4), on top of the
// shared governance block's required columns (source, scope).
const DOMAIN_COLUMNS: Record<MemoryTable, Record<string, unknown>> = {
  brand_memory: { category: 'positioning', statement: 'We integrate natively with every platform' },
  evidence_memory: { kind: 'quote', content: 'This tool saved us hours every week' },
  audience_memory: { kind: 'problem', statement: 'CTOs struggle to keep a consistent posting cadence' },
  performance_memory: { dimension: 'topic', pattern: 'technical-comparison posts perform well for CTO audiences' },
}

const MEMORY_TABLES: MemoryTable[] = ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory']

async function isRlsEnabled(tablename: string): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for RLS-enabled checks')
  const pg = new Client({ connectionString: url })
  await pg.connect()
  try {
    const { rows } = await pg.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity
         FROM pg_class
        WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
      [tablename],
    )
    return rows[0]?.relrowsecurity === true
  } finally {
    await pg.end()
  }
}

describe('governed-memory RLS (ADR 0016 §4, §8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let businessAId: string
  let businessBId: string

  async function createUser(label: string) {
    const email = `govmem-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function signInAs(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Governed Memory Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Governed Memory Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id
  })

  afterAll(async () => {
    if (!admin) return
    for (const table of MEMORY_TABLES) {
      await admin.from(table).delete().eq('business_id', businessAId)
      await admin.from(table).delete().eq('business_id', businessBId)
    }
    if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
    if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it.each(MEMORY_TABLES)('%s has RLS enabled', async (table) => {
    expect(await isRlsEnabled(table)).toBe(true)
  })

  it.each(MEMORY_TABLES)('%s: cross-tenant SELECT returns zero rows', async (table) => {
    const { data: row, error: insertErr } = await admin
      .from(table)
      .insert({
        business_id: businessBId,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from(table).select('id').eq('id', row.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it.each(MEMORY_TABLES)('%s: cannot INSERT a row for a business the caller does not belong to', async (table) => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from(table)
      .insert({
        business_id: businessBId,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it.each(MEMORY_TABLES)('%s: cannot UPDATE a row belonging to another business (USING)', async (table) => {
    const { data: row, error: insertErr } = await admin
      .from(table)
      .insert({
        business_id: businessBId,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from(table)
      .update({ confidence: 0.9 })
      .eq('id', row.id)
      .select()
    // RLS's USING clause makes the row invisible to the UPDATE match — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin.from(table).select('confidence').eq('id', row.id).single()
    expect(Number(stillThere.confidence)).toBe(0.5)
  })

  it.each(MEMORY_TABLES)('%s: cannot UPDATE own row to tunnel it into another business (WITH CHECK)', async (table) => {
    const { data: row, error: insertErr } = await admin
      .from(table)
      .insert({
        business_id: businessAId,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from(table)
      .update({ business_id: businessBId })
      .eq('id', row.id)
      .select()
    // RLS's WITH CHECK clause rejects the post-update row — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from(table).select('business_id').eq('id', row.id).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it.each(MEMORY_TABLES)('%s: cannot DELETE a row belonging to another business (USING)', async (table) => {
    const { data: row, error: insertErr } = await admin
      .from(table)
      .insert({
        business_id: businessBId,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client.from(table).delete().eq('id', row.id).select()
    // RLS's DELETE USING clause makes the row invisible to the match — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere, error: stillThereErr } = await admin.from(table).select('id').eq('id', row.id).single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(row.id)
  })

  it('erasure: deleting a business cascades its governed-memory rows', async () => {
    const ownerC = await createUser('owner-c')
    const { data: bizC, error: bizCErr } = await admin
      .from('businesses')
      .insert({ name: 'Governed Memory Business C (erasure)', owner_id: ownerC.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizCErr) throw bizCErr

    for (const table of MEMORY_TABLES) {
      const { error } = await admin.from(table).insert({
        business_id: bizC.id,
        source: 'manual',
        scope: 'brand',
        ...DOMAIN_COLUMNS[table],
      })
      expect(error).toBeNull()
    }

    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', bizC.id)
    expect(deleteErr).toBeNull()

    for (const table of MEMORY_TABLES) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', bizC.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(ownerC.id)
  })
})
