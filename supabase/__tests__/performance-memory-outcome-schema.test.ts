import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0026 §5.1 / §5.3 / §5.5 (ADR 0016 Amendment C, founder ruling A-2, J2.5) —
// OUTCOME-TWO-WRITERS-DISTINGUISHED (18), OUTCOME-KEY-COLLISION-DEFINED (19),
// OUTCOME-WRITE-PROTECTED (20). Tier 1, live Postgres.
//
// performance_memory gains a THIRD writer (source='outcome') beside the ADR 0018
// edit-learning pipeline (source='distilled') and the ADR 0025 import path
// (source='import'). The three are distinguished IN THE ROW and enforced by the
// database, not by convention: the source CHECK, namespace CHECKs on pattern_key, a
// sibling partial UNIQUE index, typed stats columns tied to source='outcome', and a
// narrowed authenticated write surface.

const PASSWORD = 'TestPass123!'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const RLS_OR_PRIVILEGE = '42501'

const OUTCOME_DIMENSIONS = ['role', 'format', 'length_band', 'cta', 'origin_mode', 'hypothesis'] as const

describe('performance_memory — outcome schema and write protection (ADR 0026 §5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let clientA: SupabaseClient
  let userAId: string
  let businessId: string
  let otherBusinessId: string
  let otherUserId: string
  let seq = 0

  const outcomeRow = (over: Record<string, unknown> = {}) => {
    seq += 1
    return {
      business_id: businessId,
      source: 'outcome',
      status: 'candidate',
      scope: 'brand',
      dimension: 'role',
      pattern: "Customer-proof posts beat this brand's usual engagement in 9 of 11 posts (3 campaigns)",
      pattern_key: `outcome:role:customer_proof:above:linkedin:${seq}`,
      platform: 'linkedin',
      confidence: 0.3,
      observation_count: 11,
      outcome_n: 11,
      outcome_wins: 9,
      outcome_distinct_campaigns: 3,
      interval_low: 0.6,
      interval_high: 0.95,
      metric_basis: 'rate',
      baseline_seeded: false,
      ...over,
    }
  }

  const distilledRow = (over: Record<string, unknown> = {}) => {
    seq += 1
    return {
      business_id: businessId,
      source: 'distilled',
      status: 'candidate',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'Distilled pattern',
      pattern_key: `kind:direction:linkedin:${seq}`,
      platform: 'linkedin',
      confidence: 0.5,
      observation_count: 1,
      ...over,
    }
  }

  const manualRow = (over: Record<string, unknown> = {}) => {
    seq += 1
    return {
      business_id: businessId,
      source: 'manual',
      scope: 'brand',
      dimension: 'topic',
      pattern: `Manual pattern ${seq}`,
      platform: 'linkedin',
      ...over,
    }
  }

  async function insert(row: Record<string, unknown>): Promise<{ id?: string; code?: string; message?: string }> {
    const { data, error } = await admin.from('performance_memory').insert(row).select('id').single()
    return error ? { code: error.code, message: error.message } : { id: data.id as string }
  }

  async function mustInsert(row: Record<string, unknown>): Promise<string> {
    const r = await insert(row)
    if (!r.id) throw new Error(`fixture insert failed: ${r.code} ${r.message}`)
    return r.id
  }

  async function signInAs(email: string): Promise<SupabaseClient> {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const mk = async (label: string) => {
      const email = `pm-outcome-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
      if (error) throw error
      const { data: biz, error: bizErr } = await admin
        .from('businesses')
        .insert({ name: `PM Outcome ${label}`, owner_id: data.user.id, plan: 'plus' })
        .select('id')
        .single()
      if (bizErr) throw bizErr
      return { userId: data.user.id as string, email, businessId: biz.id as string }
    }
    const a = await mk('a')
    const b = await mk('b')
    userAId = a.userId
    businessId = a.businessId
    otherUserId = b.userId
    otherBusinessId = b.businessId
    clientA = await signInAs(a.email)
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    for (const id of [businessId, otherBusinessId]) if (id) await admin.from('businesses').delete().eq('id', id)
    for (const id of [userAId, otherUserId]) if (id) await admin.auth.admin.deleteUser(id)
  })

  // ─── The CHECK widenings, found BY DEFINITION (J2.0 premise 3) ──────────────

  describe('the source and dimension CHECKs are widened, found by definition, and validated', () => {
    const lookup = (col: 'source' | 'dimension') =>
      pg.query<{ conname: string; def: string; convalidated: boolean }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
           FROM pg_constraint
          WHERE conrelid = 'public.performance_memory'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ~ $1`,
        [`^CHECK \\(\\(${col} = ANY \\(ARRAY\\[`],
      )

    it('EXACTLY ONE constraint matches each by-definition lookup, is VALIDATED, and now lists the new values', async () => {
      const source = await lookup('source')
      expect(source.rows).toHaveLength(1)
      expect(source.rows[0].convalidated).toBe(true)
      for (const v of ['manual', 'distilled', 'import', 'outcome']) expect(source.rows[0].def).toContain(`'${v}'`)

      const dimension = await lookup('dimension')
      expect(dimension.rows).toHaveLength(1)
      expect(dimension.rows[0].convalidated).toBe(true)
      for (const v of ['topic', 'hook', 'format', 'proof_type', 'role', 'origin_mode', 'length_band', 'cta', 'hypothesis']) {
        expect(dimension.rows[0].def).toContain(`'${v}'`)
      }
    })

    it('the lookup detects AMBIGUITY: a second CHECK with the same shape makes it match two rows (the migration RAISEs on that)', async () => {
      await pg.query('BEGIN')
      try {
        await pg.query(
          `ALTER TABLE public.performance_memory ADD CONSTRAINT zz_dup_source_check
             CHECK (source = ANY (ARRAY['manual'::text, 'distilled'::text, 'import'::text, 'outcome'::text]))`,
        )
        expect((await lookup('source')).rows).toHaveLength(2)
      } finally {
        await pg.query('ROLLBACK')
      }
      expect((await lookup('source')).rows).toHaveLength(1)
    })

    it('the migration finds by definition, RAISEs unless exactly one, drops by the found name, re-adds NAMED as NOT VALID and VALIDATEs separately', () => {
      const sql = fs.readFileSync(
        path.join(process.cwd(), 'supabase', 'migrations', '20260919130000_performance_memory_outcome_schema.sql'),
        'utf8',
      )
      expect(sql).toMatch(/\^CHECK \\\(\\\(source = ANY/)
      expect(sql).toMatch(/\^CHECK \\\(\\\(dimension = ANY/)
      expect(sql).toMatch(/RAISE EXCEPTION[^;]*exactly one/i)
      expect(sql).toMatch(/DROP CONSTRAINT %I/)
      expect(sql).toMatch(/ADD CONSTRAINT performance_memory_source_check[\s\S]*?NOT VALID/)
      expect(sql).toMatch(/ADD CONSTRAINT performance_memory_dimension_check[\s\S]*?NOT VALID/)
      expect(sql).toMatch(/VALIDATE CONSTRAINT performance_memory_source_check/)
      expect(sql).toMatch(/VALIDATE CONSTRAINT performance_memory_dimension_check/)
      // Never a guessed name.
      expect(sql).not.toMatch(/DROP CONSTRAINT IF EXISTS performance_memory_(source|dimension)_check/)
    })
  })

  // ─── Distinguished IN THE ROW ───────────────────────────────────────────────

  describe('OUTCOME-TWO-WRITERS-DISTINGUISHED — source, namespace and stats are enforced by the database', () => {
    it("accepts source='outcome' with an 'outcome:' key and every stats column", async () => {
      const r = await insert(outcomeRow())
      expect(r.code).toBeUndefined()
    })

    it("rejects source='outcome' with a key outside the outcome: namespace", async () => {
      expect((await insert(outcomeRow({ pattern_key: 'kind:direction:linkedin' }))).code).toBe(CHECK_VIOLATION)
    })

    it("rejects source='outcome' with a NULL key", async () => {
      expect((await insert(outcomeRow({ pattern_key: null }))).code).toBe(CHECK_VIOLATION)
    })

    it("rejects source='distilled' with an 'outcome:' key (a distilled writer can never squat the outcome namespace)", async () => {
      expect((await insert(distilledRow({ pattern_key: 'outcome:role:x:above:linkedin' }))).code).toBe(CHECK_VIOLATION)
    })

    it('a distilled row with an ordinary key is still accepted (nothing about the distilled writer changed)', async () => {
      expect((await insert(distilledRow())).code).toBeUndefined()
    })

    it.each([
      ['outcome_n', 5],
      ['outcome_wins', 3],
      ['outcome_distinct_campaigns', 2],
      ['interval_low', 0.5],
      ['interval_high', 0.9],
      ['metric_basis', 'rate'],
      ['baseline_seeded', true],
    ])('rejects %s set on a NON-outcome row', async (col, value) => {
      expect((await insert(distilledRow({ [col]: value }))).code).toBe(CHECK_VIOLATION)
      expect((await insert(manualRow({ [col]: value }))).code).toBe(CHECK_VIOLATION)
    })

    it.each(['outcome_n', 'outcome_wins', 'outcome_distinct_campaigns', 'interval_low', 'interval_high', 'metric_basis', 'baseline_seeded'])(
      'rejects an OUTCOME row missing %s (the marker is an equivalence, not one direction)',
      async (col) => {
        expect((await insert(outcomeRow({ [col]: null }))).code).toBe(CHECK_VIOLATION)
      },
    )

    it('rejects an unknown metric_basis and inconsistent counts / intervals', async () => {
      expect((await insert(outcomeRow({ metric_basis: 'ratio' }))).code).toBe(CHECK_VIOLATION)
      expect((await insert(outcomeRow({ outcome_wins: 12, outcome_n: 11 }))).code).toBe(CHECK_VIOLATION)
      expect((await insert(outcomeRow({ outcome_distinct_campaigns: 12, outcome_n: 11 }))).code).toBe(CHECK_VIOLATION)
      expect((await insert(outcomeRow({ interval_low: 0.9, interval_high: 0.6 }))).code).toBe(CHECK_VIOLATION)
    })

    it('contradicted_at is nullable on EVERY row, outcome or not', async () => {
      const when = new Date('2026-09-19T12:00:00Z').toISOString()
      expect((await insert(outcomeRow({ contradicted_at: when }))).code).toBeUndefined()
      expect((await insert(distilledRow({ contradicted_at: when }))).code).toBeUndefined()
    })

    it.each(OUTCOME_DIMENSIONS)("accepts the outcome dimension '%s'", async (dimension) => {
      expect((await insert(outcomeRow({ dimension }))).code).toBeUndefined()
    })

    it.each(['topic', 'hook', 'proof_type'])(
      "rejects an OUTCOME row with dimension '%s' — descriptive-only and unlisted dimensions can never be promoted into an outcome pattern",
      async (dimension) => {
        expect((await insert(outcomeRow({ dimension }))).code).toBe(CHECK_VIOLATION)
      },
    )

    it('an existing dimension is still valid for the other writers (topic on a distilled row)', async () => {
      expect((await insert(distilledRow({ dimension: 'topic' }))).code).toBeUndefined()
    })
  })

  // ─── Key collision, defined ─────────────────────────────────────────────────

  describe('OUTCOME-KEY-COLLISION-DEFINED — the sibling partial UNIQUE index and cross-writer isolation', () => {
    it('the distilled partial UNIQUE index is UNCHANGED', async () => {
      const { rows } = await pg.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'performance_memory' AND indexname = 'performance_memory_distilled_pattern_key_uq'`,
      )
      expect(rows[0].indexdef).toBe(
        "CREATE UNIQUE INDEX performance_memory_distilled_pattern_key_uq ON public.performance_memory USING btree (business_id, dimension, COALESCE(platform, ''::text), pattern_key) WHERE ((source = 'distilled'::text) AND (deleted_at IS NULL))",
      )
    })

    it('the outcome sibling index exists with exactly the ADR shape', async () => {
      const { rows } = await pg.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'performance_memory' AND indexname = 'performance_memory_outcome_pattern_key_uq'`,
      )
      expect(rows[0].indexdef).toBe(
        "CREATE UNIQUE INDEX performance_memory_outcome_pattern_key_uq ON public.performance_memory USING btree (business_id, dimension, COALESCE(platform, ''::text), pattern_key) WHERE ((source = 'outcome'::text) AND (deleted_at IS NULL))",
      )
    })

    it('two live outcome rows with the same (business, dimension, platform, key) collide; a soft-deleted one does not; NULL platform dedupes', async () => {
      const key = `outcome:role:dup:above:${++seq}`
      expect((await insert(outcomeRow({ pattern_key: key }))).code).toBeUndefined()
      expect((await insert(outcomeRow({ pattern_key: key }))).code).toBe(UNIQUE_VIOLATION)
      expect((await insert(outcomeRow({ pattern_key: key, deleted_at: new Date().toISOString() }))).code).toBeUndefined()

      const nullKey = `outcome:role:nullplat:above:${++seq}`
      expect((await insert(outcomeRow({ pattern_key: nullKey, platform: null }))).code).toBeUndefined()
      expect((await insert(outcomeRow({ pattern_key: nullKey, platform: null }))).code).toBe(UNIQUE_VIOLATION)
    })

    it('a service-role INSERT ... ON CONFLICT on the SIBLING index dedupes outcome rows in place and never matches a distilled one', async () => {
      const key = `outcome:format:conflict:above:${++seq}`
      const sql = `INSERT INTO public.performance_memory
          (business_id, source, status, scope, dimension, pattern, pattern_key, platform, confidence, observation_count,
           outcome_n, outcome_wins, outcome_distinct_campaigns, interval_low, interval_high, metric_basis, baseline_seeded)
        VALUES ($1, 'outcome', 'candidate', 'brand', 'format', 'p', $2, 'linkedin', 0.3, $3, $3, 6, 3, 0.5, 0.9, 'rate', false)
        ON CONFLICT (business_id, dimension, coalesce(platform, ''), pattern_key)
          WHERE source = 'outcome' AND deleted_at IS NULL
        DO UPDATE SET outcome_n = EXCLUDED.outcome_n, observation_count = EXCLUDED.observation_count
        RETURNING id`
      const first = await pg.query(sql, [businessId, key, 8])
      const second = await pg.query(sql, [businessId, key, 12])
      expect(second.rows[0].id).toBe(first.rows[0].id)
      const { rows } = await pg.query('SELECT outcome_n, source FROM public.performance_memory WHERE business_id = $1 AND pattern_key = $2', [businessId, key])
      expect(rows).toEqual([{ outcome_n: 12, source: 'outcome' }])
    })

    it('upsert_distilled_performance_pattern beside an outcome row with the SAME (business, dimension, platform) touches ONLY the distilled row', async () => {
      const outcomeId = await mustInsert(outcomeRow({ dimension: 'format', platform: 'twitter', pattern: 'outcome text', pattern_key: `outcome:format:iso:above:${++seq}` }))
      const args = {
        p_business_id: businessId,
        p_dimension: 'format',
        p_pattern: 'distilled text v1',
        p_pattern_key: `format:iso:twitter:${seq}`,
        p_platform: 'twitter',
        p_scope: 'brand',
        p_scope_ref: null,
        p_confidence: 0.6,
        p_observation_count: 3,
      }
      const first = await admin.rpc('upsert_distilled_performance_pattern', args)
      expect(first.error).toBeNull()
      const second = await admin.rpc('upsert_distilled_performance_pattern', { ...args, p_pattern: 'distilled text v2', p_observation_count: 4 })
      expect(second.error).toBeNull()

      const { data: outcome } = await admin.from('performance_memory').select('pattern, source, outcome_n').eq('id', outcomeId).single()
      expect(outcome).toEqual({ pattern: 'outcome text', source: 'outcome', outcome_n: 11 })
      const { data: distilled } = await admin
        .from('performance_memory')
        .select('pattern, source, observation_count')
        .eq('business_id', businessId)
        .eq('pattern_key', args.p_pattern_key)
      expect(distilled).toEqual([{ pattern: 'distilled text v2', source: 'distilled', observation_count: 4 }])
    })
  })

  // ─── Write protection ──────────────────────────────────────────────────────

  describe('OUTCOME-WRITE-PROTECTED — an authenticated member cannot forge provenance or statistics', () => {
    const authInsert = async (row: Record<string, unknown>) => {
      const { error } = await clientA.from('performance_memory').insert(row)
      return error?.code
    }
    const authUpdate = async (id: string, patch: Record<string, unknown>) => {
      const { error } = await clientA.from('performance_memory').update(patch).eq('id', id)
      return error
    }

    it("INSERT with source <> 'manual' is rejected by the policy (distilled, import, outcome)", async () => {
      for (const source of ['distilled', 'outcome', 'import']) {
        const row = source === 'outcome' ? outcomeRow() : { ...distilledRow(), source }
        const c = await authInsert(row)
        expect(c, source).toBe(RLS_OR_PRIVILEGE)
      }
    })

    it("INSERT with source='manual' still works (the one authenticated write path that remains)", async () => {
      expect(await authInsert(manualRow())).toBeUndefined()
    })

    it("INSERT cannot smuggle stats onto a manual row (source='manual' + outcome_n)", async () => {
      expect(await authInsert(manualRow({ outcome_n: 50 }))).toBe(CHECK_VIOLATION)
    })

    it("UPDATE of an outcome row's outcome_n, pattern or source is rejected; the row is unchanged", async () => {
      const id = await mustInsert(outcomeRow({ pattern: 'original outcome text' }))
      const cases: Array<[string, Record<string, unknown>]> = [
        ['outcome_n', { outcome_n: 999 }],
        ['outcome_wins', { outcome_wins: 11 }],
        ['pattern', { pattern: 'forged text' }],
        ['source', { source: 'manual' }],
        ['pattern_key', { pattern_key: 'outcome:role:forged:above:linkedin' }],
        ['dimension', { dimension: 'format' }],
        ['status promote', { status: 'active' }],
      ]
      for (const [label, patch] of cases) {
        const error = await authUpdate(id, patch)
        expect(error, label).not.toBeNull()
      }
      const { data } = await admin.from('performance_memory').select('pattern, outcome_n, source, status').eq('id', id).single()
      expect(data).toEqual({ pattern: 'original outcome text', outcome_n: 11, source: 'outcome', status: 'candidate' })
    })

    it('RETIRING an outcome row is allowed, and so is soft-deleting it; un-retiring is not', async () => {
      const retireId = await mustInsert(outcomeRow())
      expect(await authUpdate(retireId, { status: 'retired' })).toBeNull()
      const { data } = await admin.from('performance_memory').select('status').eq('id', retireId).single()
      expect(data.status).toBe('retired')
      expect(await authUpdate(retireId, { status: 'active' })).not.toBeNull()

      const deleteId = await mustInsert(outcomeRow())
      expect(await authUpdate(deleteId, { deleted_at: new Date().toISOString() })).toBeNull()
    })

    it('RETIRING while ALSO changing a stats column is rejected (the stats branch is independently load-bearing)', async () => {
      const id = await mustInsert(outcomeRow())
      const error = await authUpdate(id, { status: 'retired', outcome_n: 999 })
      expect(error).not.toBeNull()
      const { data } = await admin.from('performance_memory').select('status, outcome_n').eq('id', id).single()
      expect(data).toEqual({ status: 'candidate', outcome_n: 11 })
    })

    it('a DISTILLED row: content edits and promotion are rejected, retirement is allowed', async () => {
      const id = await mustInsert(distilledRow())
      expect(await authUpdate(id, { pattern: 'edited' })).not.toBeNull()
      expect(await authUpdate(id, { status: 'active' })).not.toBeNull()
      expect(await authUpdate(id, { status: 'retired' })).toBeNull()
    })

    it('a MANUAL row stays fully editable, but can never become another source', async () => {
      const id = await mustInsert(manualRow({ pattern: 'my note' }))
      expect(await authUpdate(id, { pattern: 'my edited note', status: 'active' })).toBeNull()
      const { data } = await admin.from('performance_memory').select('pattern, status').eq('id', id).single()
      expect(data).toEqual({ pattern: 'my edited note', status: 'active' })
      expect(await authUpdate(id, { source: 'outcome' })).not.toBeNull()
    })

    it("cross-tenant: a member cannot touch another business's outcome row (RLS), let alone forge it", async () => {
      const foreign = await mustInsert({ ...outcomeRow(), business_id: otherBusinessId })
      const { data } = await clientA.from('performance_memory').update({ status: 'retired' }).eq('id', foreign).select('id')
      expect(data ?? []).toEqual([])
      const { data: still } = await admin.from('performance_memory').select('status').eq('id', foreign).single()
      expect(still.status).toBe('candidate')
    })
  })

  describe('the service role (the outcome RPCs and worker) is NOT restricted where it must write', () => {
    it('may update the stats columns and contradicted_at of an outcome row (upsert / demote paths)', async () => {
      const id = await mustInsert(outcomeRow())
      const { error } = await admin
        .from('performance_memory')
        .update({ outcome_n: 13, outcome_wins: 10, interval_low: 0.55, contradicted_at: new Date().toISOString(), status: 'active' })
        .eq('id', id)
      expect(error).toBeNull()
    })

    it("still cannot change an outcome row's identity: source, pattern_key and dimension are immutable for EVERY role", async () => {
      const id = await mustInsert(outcomeRow())
      expect((await admin.from('performance_memory').update({ pattern_key: 'outcome:role:other:above:linkedin' }).eq('id', id)).error).not.toBeNull()
      expect((await admin.from('performance_memory').update({ dimension: 'format' }).eq('id', id)).error).not.toBeNull()
      expect((await admin.from('performance_memory').update({ source: 'distilled', pattern_key: 'x' }).eq('id', id)).error).not.toBeNull()
    })
  })

  describe('what must NOT be disturbed', () => {
    it("the voice-write guard is untouched and still fires only for source='distilled' AND dimension IN ('format','hook')", async () => {
      const { rows: fn } = await pg.query<{ prosrc: string }>(`SELECT prosrc FROM pg_proc WHERE proname = 'enforce_voice_write_preference_only'`)
      expect(fn[0].prosrc).toContain("NEW.source = 'distilled' AND NEW.dimension IN ('format', 'hook')")
      expect(fn[0].prosrc).not.toMatch(/outcome/)
      const { rows: trg } = await pg.query<{ tgtype: number }>(
        `SELECT tgtype FROM pg_trigger WHERE tgname = 'trg_performance_memory_voice_write_guard'`,
      )
      expect(trg[0].tgtype).toBe(23) // BEFORE INSERT OR UPDATE FOR EACH ROW, as shipped
    })

    it('the import-immutable trigger and the write-protect trigger coexist on the table', async () => {
      const { rows } = await pg.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.performance_memory'::regclass AND NOT tgisinternal ORDER BY tgname`,
      )
      const names = rows.map((r) => r.tgname)
      expect(names).toContain('trg_performance_memory_import_immutable')
      expect(names).toContain('trg_performance_memory_voice_write_guard')
      expect(names).toContain('trg_performance_memory_outcome_write_protect')
    })

    it("the INSERT policy's WITH CHECK carries the source predicate", async () => {
      const { rows } = await pg.query<{ with_check: string | null }>(
        `SELECT with_check FROM pg_policies WHERE tablename = 'performance_memory' AND policyname = 'performance_memory_insert_own'`,
      )
      expect(rows[0].with_check).toMatch(/source = 'manual'/)
      expect(rows[0].with_check).toMatch(/get_user_business_ids/)
    })
  })
})
