import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, destroyWorld, seedCell, type World } from '../__helpers__/outcome-fixtures'

// ADR 0030 §2.1, §4.1, §6.6 (Session 36 L2.3) — SUBSTRATE-PROVENANCE-DISTINCT (3) and SUBSTRATE-CONFIDENCE-CALIBRATED (8),
// Tier 1, live Postgres. One migration adds: 'dismissal' to audience_memory's NAMED source CHECK; the decision_key
// provenance marker (biconditional + namespace CHECKs, partial UNIQUE, a SIBLING immutability trigger); and EIGHT named
// confidence-ceiling CHECKs.
//
// Every seed row here is explicitly status = 'active' where a status is chosen at all (memory defaults to 'candidate', so a
// careless seed is vacuously green — cerebrum, Session 34 K1).
//
// confidence is numeric(3,2): a value is stored rounded to two decimals. 0.605 is stored as 0.61, so "just over the 0.60
// ceiling" is 0.61 here — asserted, not assumed.

const CEILING_MIGRATION_TABLES = ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'] as const
type Table = (typeof CEILING_MIGRATION_TABLES)[number]

// The eight ceilings ADR 0030 §4.1 names, and nothing else (no outcome, no manual).
const CEILINGS: Array<{ table: Table; source: 'import' | 'interview' | 'dismissal' | 'distilled'; name: string; max: number }> = [
  { table: 'evidence_memory', source: 'import', name: 'evidence_memory_import_confidence_ceiling', max: 0.6 },
  { table: 'audience_memory', source: 'import', name: 'audience_memory_import_confidence_ceiling', max: 0.6 },
  { table: 'performance_memory', source: 'import', name: 'performance_memory_import_confidence_ceiling', max: 0.6 },
  { table: 'brand_memory', source: 'interview', name: 'brand_memory_interview_confidence_ceiling', max: 0.6 },
  { table: 'evidence_memory', source: 'interview', name: 'evidence_memory_interview_confidence_ceiling', max: 0.6 },
  { table: 'audience_memory', source: 'interview', name: 'audience_memory_interview_confidence_ceiling', max: 0.6 },
  { table: 'audience_memory', source: 'dismissal', name: 'audience_memory_dismissal_confidence_ceiling', max: 0.5 },
  { table: 'performance_memory', source: 'distilled', name: 'performance_memory_distilled_confidence_ceiling', max: 0.95 },
]

const PASSWORD = 'TestPass123!'

describe('memory substrate schema (ADR 0030 §2.1, §4.1, §6.6)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let world: World
  let runId: string
  let answerId: string
  let seq = 0
  const extraBusinessIds: string[] = []
  const extraUserIds: string[] = []

  const unique = (label: string) => `L2.3 ${label} ${++seq} ${Math.random().toString(36).slice(2, 8)}`

  const DOMAIN: Record<Table, () => Record<string, unknown>> = {
    brand_memory: () => ({ category: 'other', statement: unique('brand') }),
    evidence_memory: () => ({ kind: 'quote', content: unique('evidence') }),
    audience_memory: () => ({ kind: 'problem', statement: unique('audience') }),
    performance_memory: () => ({ dimension: 'topic', pattern: unique('performance'), platform: 'linkedin' }),
  }

  // A row that satisfies every OTHER constraint of its (table, source), so the ONLY thing under test is the ceiling.
  function rowFor(table: Table, source: string, confidence: number, businessId = world.businessId): Record<string, unknown> {
    const row: Record<string, unknown> = { business_id: businessId, source, scope: 'brand', status: 'active', confidence, ...DOMAIN[table]() }
    if (source === 'import') {
      row.import_run_id = runId
      row.import_source_post_ids = [`post-${seq}`]
    }
    if (source === 'interview') {
      row.interview_answer_id = answerId
      row.interview_extracted_text = 'the founder said something'
      row.interview_span = 'the founder said something'
    }
    if (source === 'dismissal') row.decision_key = `dismissal:not_relevant:github:${unique('repo')}`
    if (source === 'distilled' && table === 'performance_memory') row.pattern_key = `kind:direction:linkedin:${seq}`
    return row
  }

  const insert = async (table: Table, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert(row).select('id').single()
    return error ? { code: error.code as string, message: error.message as string } : { id: data.id as string }
  }

  async function newBusiness(label: string): Promise<string> {
    const email = `subst-schema-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: u, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    extraUserIds.push(u.user.id)
    const { data: b, error: bErr } = await admin.from('businesses').insert({ name: `Substrate ${label}`, owner_id: u.user.id, plan: 'plus' }).select('id').single()
    if (bErr) throw bErr
    extraBusinessIds.push(b.id)
    return b.id as string
  }

  const rpc = async (name: string, args: Record<string, unknown>) => admin.rpc(name, args)

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
    world = await createWorld('substrate-schema')
    admin = world.admin

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: world.businessId,
        platform: 'twitter',
        platform_user_id: `x-substrate-${Date.now()}`,
        platform_username: 'substrate_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000091',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: world.businessId, social_account_id: account.id, platform: 'twitter', status: 'extracting' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id

    const questions = Array.from({ length: 5 }, (_, i) => ({ questionKey: `q-${i + 1}`, slotType: 'brand', slotCategory: 'positioning', bankVersion: 1 }))
    const created = await rpc('create_interview_round', { p_user_id: world.userId, p_business_id: world.businessId, p_questions: questions })
    if (created.error) throw created.error
    const { rows } = await pg.query<{ id: string }>('SELECT id FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [created.data.roundId])
    answerId = rows[0].id
  })

  afterAll(async () => {
    if (pg) {
      for (const id of extraBusinessIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
    }
    if (admin) for (const id of extraUserIds) await admin.auth.admin.deleteUser(id)
    await destroyWorld(world)
    if (pg) await pg.end()
  }, 120_000)

  // ─── 1. The source swap, by name ────────────────────────────────────────────

  describe('the source CHECKs', () => {
    const SOURCE_VALUES: Record<Table, string[]> = {
      brand_memory: ['distilled', 'import', 'interview', 'manual'],
      evidence_memory: ['distilled', 'import', 'interview', 'manual'],
      audience_memory: ['dismissal', 'distilled', 'import', 'interview', 'manual'],
      performance_memory: ['distilled', 'import', 'manual', 'outcome'],
    }

    it.each(CEILING_MIGRATION_TABLES)('%s: EXACTLY ONE <table>_source_check, VALIDATED, listing exactly the ADR 0030 §2.1 set', async (table) => {
      const { rows } = await pg.query<{ conname: string; def: string; convalidated: boolean }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '^CHECK \\(\\(source = ANY \\(ARRAY\\['`,
        [`public.${table}`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].conname).toBe(`${table}_source_check`)
      expect(rows[0].convalidated).toBe(true)
      const listed = [...rows[0].def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
      expect(listed).toEqual(SOURCE_VALUES[table])
    })

    it("audience_memory accepts 'dismissal'; brand, evidence and performance still REJECT it (23514 naming their source CHECK)", async () => {
      const ok = await insert('audience_memory', rowFor('audience_memory', 'dismissal', 0.4))
      expect(ok.id, JSON.stringify(ok)).toBeDefined()
      for (const table of ['brand_memory', 'evidence_memory', 'performance_memory'] as const) {
        const bad = await insert(table, { business_id: world.businessId, source: 'dismissal', scope: 'brand', status: 'active', ...DOMAIN[table]() })
        expect(bad.code, table).toBe('23514')
        expect(bad.message, table).toContain(`${table}_source_check`)
      }
    })
  })

  // ─── 2. The eight ceilings ──────────────────────────────────────────────────

  describe('SUBSTRATE-CONFIDENCE-CALIBRATED — the eight named ceiling CHECKs', () => {
    it('exactly these eight exist, each VALIDATED, and none begins "CHECK ((source = ANY (ARRAY[" (the old lookup-regex shape stays unambiguous)', async () => {
      const { rows } = await pg.query<{ conname: string; def: string; convalidated: boolean }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
          WHERE contype = 'c' AND conname ~ '_(import|interview|dismissal|distilled)_confidence_ceiling$' AND connamespace = 'public'::regnamespace
          ORDER BY conname`,
      )
      expect(rows.map((r) => r.conname)).toEqual(CEILINGS.map((c) => c.name).sort())
      for (const r of rows) {
        expect(r.convalidated, `${r.conname} was never VALIDATED`).toBe(true)
        expect(r.def, r.conname).not.toMatch(/^CHECK \(\(source = ANY \(ARRAY\[/)
      }
    })

    it('there is NO outcome ceiling and NO manual ceiling', async () => {
      const { rows } = await pg.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace
            AND conname ~ '(outcome|manual)_confidence_ceiling'`,
      )
      expect(rows).toEqual([])
    })

    it.each(CEILINGS)('$name: a violating insert is rejected with 23514 naming it; one at exactly the ceiling succeeds', async ({ table, source, name, max }) => {
      const over = Number((max + 0.01).toFixed(2))
      const bad = await insert(table, rowFor(table, source, over))
      expect(bad.code, `${source} ${over} on ${table}: ${JSON.stringify(bad)}`).toBe('23514')
      expect(bad.message).toContain(name)

      const atCeiling = await insert(table, rowFor(table, source, max))
      expect(atCeiling.id, JSON.stringify(atCeiling)).toBeDefined()
    })

    it('confidence is numeric(3,2): 0.605 is STORED as 0.61, so it is over the 0.60 import ceiling and is refused', async () => {
      const bad = await insert('evidence_memory', rowFor('evidence_memory', 'import', 0.605))
      expect(bad.code).toBe('23514')
      expect(bad.message).toContain('evidence_memory_import_confidence_ceiling')
    })

    it('outcome and manual rows above 0.95 are NOT refused by a ceiling (their own bounds are the 0..1 CHECK)', async () => {
      const outcome = await insert('performance_memory', {
        business_id: world.businessId, source: 'outcome', status: 'candidate', scope: 'brand', dimension: 'role', pattern: unique('outcome'),
        pattern_key: `outcome:role:big:above:linkedin:${++seq}`, platform: 'linkedin', confidence: 0.99, observation_count: 30, outcome_n: 30,
        outcome_wins: 29, outcome_distinct_campaigns: 4, interval_low: 0.8, interval_high: 0.99, metric_basis: 'rate', baseline_seeded: false,
      })
      expect(outcome.id, JSON.stringify(outcome)).toBeDefined()
      const manual = await insert('brand_memory', rowFor('brand_memory', 'manual', 1.0))
      expect(manual.id, JSON.stringify(manual)).toBeDefined()
    })
  })

  // ─── 3. VALIDATE against rows the four writers' own RPCs produced ───────────

  describe('SUBSTRATE-CONFIDENCE-CALIBRATED — VALIDATE passes on rows produced by all four writers, by their own RPCs', () => {
    const produced: Record<string, string[]> = {}

    it('seeds rows through import_*_memory, write_interview_candidates, upsert_distilled_* and upsert_outcome_*', async () => {
      const now = new Date().toISOString()
      // import — confidences are the shipped constants (evidence 0.5, audience 0.3, performance 0.6*n/(n+5))
      const ev = await rpc('import_evidence_memory', { p_business_id: world.businessId, p_import_run_id: runId, p_import_source_post_ids: ['rpc-e'], p_kind: 'quote', p_content: unique('rpc evidence'), p_source_url: null, p_scope: 'platform', p_scope_ref: 'twitter', p_confidence: 0.5, p_last_confirmed_at: now, p_expires_at: null })
      const au = await rpc('import_audience_memory', { p_business_id: world.businessId, p_import_run_id: runId, p_import_source_post_ids: ['rpc-a'], p_segment: null, p_kind: 'problem', p_statement: unique('rpc audience'), p_scope: 'platform', p_scope_ref: 'twitter', p_confidence: 0.3, p_last_confirmed_at: now, p_expires_at: null })
      const pf = await rpc('import_performance_memory', { p_business_id: world.businessId, p_import_run_id: runId, p_import_source_post_ids: ['rpc-p'], p_dimension: 'topic', p_pattern: unique('rpc perf'), p_platform: 'twitter', p_scope: 'platform', p_scope_ref: 'twitter', p_confidence: 0.55, p_observation_count: 6, p_last_confirmed_at: now, p_expires_at: null })
      for (const r of [ev, au, pf]) expect(r.error, JSON.stringify(r.error)).toBeNull()
      produced.import = [ev.data[0].id, au.data[0].id, pf.data[0].id]

      // distilled — at EXACTLY the 0.95 ceiling
      const di = await rpc('upsert_distilled_performance_pattern', { p_business_id: world.businessId, p_dimension: 'format', p_pattern: unique('rpc distilled'), p_pattern_key: `format:rpc:linkedin:${++seq}`, p_platform: 'linkedin', p_scope: 'brand', p_scope_ref: null, p_confidence: 0.95, p_observation_count: 40 })
      expect(di.error, JSON.stringify(di.error)).toBeNull()
      produced.distilled = [di.data.id]

      // outcome — a real cell of 10 observations across 3 campaigns
      await seedCell(world, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
      const oc = await rpc('upsert_outcome_performance_pattern', { p_business_id: world.businessId, p_dimension: 'role', p_value: 'customer_proof', p_platform: 'linkedin', p_direction: 'above', p_pattern_text: unique('rpc outcome') })
      expect(oc.error, JSON.stringify(oc.error)).toBeNull()
      expect(oc.data, 'the outcome RPC returned no row for a 10-observation cell').not.toBeNull()
      produced.outcome = [oc.data.id]

      // interview — a real claimed round
      const questions = Array.from({ length: 5 }, (_, i) => ({ questionKey: `q-${i + 1}`, slotType: 'brand', slotCategory: 'positioning', bankVersion: 1 }))
      const bizId = await newBusiness('interview')
      const { rows: ownerRow } = await pg.query<{ owner_id: string }>('SELECT owner_id FROM public.businesses WHERE id = $1', [bizId])
      const created = await rpc('create_interview_round', { p_user_id: ownerRow[0].owner_id, p_business_id: bizId, p_questions: questions })
      expect(created.error, JSON.stringify(created.error)).toBeNull()
      const roundId = created.data.roundId as string
      const { rows: answers } = await pg.query<{ id: string; position: number }>('SELECT id, position FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])
      const text = 'We integrate natively with Slack and Linear. Buyers keep asking about security reviews. One customer said: "it saved us hours every week".'
      for (const a of answers) expect((await rpc('save_interview_answer', { p_user_id: ownerRow[0].owner_id, p_answer_id: a.id, p_text: text })).data.outcome).toBe('ok')
      expect((await rpc('submit_interview_round', { p_user_id: ownerRow[0].owner_id, p_round_id: roundId })).data.outcome).toBe('ok')
      expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.outcome).toBe('claimed')
      const item = (type: string, category: string, t: string, span: string) => ({ answerId: answers[0].id, type, category, text: t, span, storedText: t, storedSpan: span })
      const w = await rpc('write_interview_candidates', {
        p_round_id: roundId,
        p_items: {
          items: [
            item('brand', 'positioning', 'We integrate natively with Slack and Linear', 'We integrate natively with Slack and Linear'),
            item('audience', 'objection', 'Buyers worry about security reviews', 'Buyers keep asking about security reviews'),
            item('evidence', 'quote', 'it saved us hours every week', 'it saved us hours every week'),
          ],
          counters: { proposed: 3, droppedUngrounded: 0, droppedPerformanceClaim: 0 },
        },
      })
      expect(w.error, JSON.stringify(w.error)).toBeNull()
      const { rows: iv } = await pg.query<{ t: string; n: string; mx: string }>(
        `SELECT 'brand_memory' AS t, count(*)::text AS n, max(confidence)::text AS mx FROM public.brand_memory WHERE business_id = $1 AND source = 'interview'
         UNION ALL SELECT 'audience_memory', count(*)::text, max(confidence)::text FROM public.audience_memory WHERE business_id = $1 AND source = 'interview'
         UNION ALL SELECT 'evidence_memory', count(*)::text, max(confidence)::text FROM public.evidence_memory WHERE business_id = $1 AND source = 'interview'`,
        [bizId],
      )
      expect(iv.map((r) => [r.t, r.n, Number(r.mx)])).toEqual([['brand_memory', '1', 0.6], ['audience_memory', '1', 0.5], ['evidence_memory', '1', 0.4]])
    })

    it.each(CEILINGS)('$name RE-VALIDATES against the live rows (drop, add NOT VALID, VALIDATE — in a transaction that is rolled back)', async ({ table, source, name, max }) => {
      const { rows: live } = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${table} WHERE source = $1`, [source])
      // the ceiling is only meaningful if rows of that source exist; the direct inserts above guarantee at least one
      expect(Number(live[0].n), `no ${source} rows in ${table} to validate against`).toBeGreaterThan(0)
      await pg.query('BEGIN')
      try {
        await pg.query(`ALTER TABLE public.${table} DROP CONSTRAINT ${name}`)
        await pg.query(`ALTER TABLE public.${table} ADD CONSTRAINT ${name} CHECK (source <> '${source}' OR confidence <= ${max}) NOT VALID`)
        await pg.query(`ALTER TABLE public.${table} VALIDATE CONSTRAINT ${name}`) // throws if any live row violates it
      } finally {
        await pg.query('ROLLBACK')
      }
    })

    it('the rows the writers produced are all present (the validation above ran against real writer output)', async () => {
      for (const ids of Object.values(produced)) expect(ids.length).toBeGreaterThan(0)
      expect(Object.keys(produced).sort()).toEqual(['distilled', 'import', 'outcome'])
    })
  })

  // ─── 4. The decision_key provenance marker (constraint 3) ───────────────────

  describe('SUBSTRATE-PROVENANCE-DISTINCT — the decision_key marker on audience_memory', () => {
    it('source=dismissal with a NULL decision_key fails audience_memory_decision_key_marker_check', async () => {
      const row = rowFor('audience_memory', 'dismissal', 0.4)
      row.decision_key = null
      const r = await insert('audience_memory', row)
      expect(r.code).toBe('23514')
      expect(r.message).toContain('audience_memory_decision_key_marker_check')
    })

    it('a non-null decision_key with any other source fails the same CHECK (both directions of the biconditional)', async () => {
      for (const source of ['manual', 'distilled', 'import', 'interview']) {
        const row = rowFor('audience_memory', source, 0.3)
        row.decision_key = 'dismissal:not_relevant:github:owner/name'
        const r = await insert('audience_memory', row)
        expect(r.code, source).toBe('23514')
        expect(r.message, source).toContain('audience_memory_decision_key_marker_check')
      }
    })

    it("a dismissal decision_key outside the 'dismissal:' namespace fails audience_memory_decision_key_namespace_check", async () => {
      const row = rowFor('audience_memory', 'dismissal', 0.4)
      row.decision_key = 'interview:not_relevant:github:owner/name'
      const r = await insert('audience_memory', row)
      expect(r.code).toBe('23514')
      expect(r.message).toContain('audience_memory_decision_key_namespace_check')
    })

    it('the partial UNIQUE index: one live dismissal row per (business, decision_key); a soft-deleted one does not collide; another business may reuse the key', async () => {
      const key = `dismissal:not_relevant:github:${unique('uq')}`
      const a = await insert('audience_memory', { ...rowFor('audience_memory', 'dismissal', 0.4), decision_key: key })
      expect(a.id, JSON.stringify(a)).toBeDefined()
      const dup = await insert('audience_memory', { ...rowFor('audience_memory', 'dismissal', 0.4), decision_key: key })
      expect(dup.code).toBe('23505')
      expect(dup.message).toContain('audience_memory_dismissal_key_uq')
      const softDeleted = await insert('audience_memory', { ...rowFor('audience_memory', 'dismissal', 0.4), decision_key: key, deleted_at: new Date().toISOString() })
      expect(softDeleted.id, JSON.stringify(softDeleted)).toBeDefined()
      const otherBusiness = await newBusiness('uq-other')
      const other = await insert('audience_memory', { ...rowFor('audience_memory', 'dismissal', 0.4, otherBusiness), decision_key: key })
      expect(other.id, JSON.stringify(other)).toBeDefined()
    })

    describe('enforce_memory_dismissal_immutable (a SIBLING trigger)', () => {
      let rowId: string
      let key: string
      beforeAll(async () => {
        key = `dismissal:not_relevant:github:${unique('trg')}`
        const r = await insert('audience_memory', { ...rowFor('audience_memory', 'dismissal', 0.3), decision_key: key, observation_count: 3 })
        if (!r.id) throw new Error(JSON.stringify(r))
        rowId = r.id
      })

      const update = async (patch: Record<string, unknown>) => {
        const { error } = await admin.from('audience_memory').update(patch).eq('id', rowId)
        return error ? { code: error.code as string, message: error.message as string } : null
      }

      it("rejects a change to source, with the trigger's own message (not a CHECK)", async () => {
        const e = await update({ source: 'manual' })
        expect(e?.message).toMatch(/dismissal provenance columns \(source, decision_key\) are immutable/)
      })

      it("rejects a change to decision_key, with the trigger's own message", async () => {
        const e = await update({ decision_key: 'dismissal:not_relevant:github:other/repo' })
        expect(e?.message).toMatch(/dismissal provenance columns \(source, decision_key\) are immutable/)
      })

      it("rejects turning ANOTHER source's row into a dismissal row", async () => {
        const manual = await insert('audience_memory', rowFor('audience_memory', 'manual', 0.5))
        const { error } = await admin.from('audience_memory').update({ source: 'dismissal', decision_key: `dismissal:x:${++seq}` }).eq('id', manual.id)
        expect(error?.message).toMatch(/dismissal provenance columns \(source, decision_key\) are immutable/)
      })

      it.each([
        ['statement', { statement: 'Updates from the GitHub repository o/n were dismissed as not relevant in 4 of 5 recent cards.' }],
        ['confidence', { confidence: 0.45 }],
        ['observation_count', { observation_count: 4 }],
        ['status', { status: 'retired' }],
        ['last_confirmed_at', { last_confirmed_at: new Date().toISOString() }],
        ['expires_at', { expires_at: new Date(Date.now() + 86_400_000).toISOString() }],
      ])('PERMITS the recompute to change %s', async (_label, patch) => {
        expect(await update(patch)).toBeNull()
      })
    })

    it('the existing import and interview immutability triggers are NOT edited: still present, and the dismissal trigger is a distinct function', async () => {
      const { rows } = await pg.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.audience_memory'::regclass AND NOT tgisinternal ORDER BY tgname`,
      )
      const names = rows.map((r) => r.tgname)
      expect(names).toContain('trg_audience_memory_import_immutable')
      expect(names).toContain('trg_audience_memory_interview_immutable')
      expect(names).toContain('trg_audience_memory_dismissal_immutable')
      const { rows: fn } = await pg.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname IN ('enforce_memory_import_immutable','enforce_memory_interview_immutable','enforce_memory_dismissal_immutable') ORDER BY proname`,
      )
      expect(fn.map((r) => r.proname)).toEqual(['enforce_memory_dismissal_immutable', 'enforce_memory_import_immutable', 'enforce_memory_interview_immutable'])
    })

    it('decision_key has NO foreign key (a removed watched source leaves a row that simply expires)', async () => {
      const { rows } = await pg.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'public.audience_memory'::regclass AND c.contype = 'f' AND a.attname = 'decision_key'`,
      )
      expect(rows[0].n).toBe('0')
    })
  })
})
