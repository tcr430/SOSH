import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0029 §9.2–§9.4 — INTERVIEW-RLS-ISOLATED (38) and INTERVIEW-CASCADE-COMPLETE (39). Tier 1, live
// Postgres. Tenant isolation on both new tables, 42501 on every authenticated write, the root
// DELETE FROM businesses AND the purge_business RPC each erasing rounds, answers AND interview memory
// rows (the memory -> answer NO ACTION key must pass at statement end), the user FKs SET NULL, and the
// two ADR 0010 Amendment 2 §D2.5 rows present verbatim.

const PASSWORD = 'TestPass123!'
const ROOT = process.cwd()

type NewTable = 'founder_interview_rounds' | 'founder_interview_answers'
const NEW_TABLES: NewTable[] = ['founder_interview_rounds', 'founder_interview_answers']
type MemoryTable = 'brand_memory' | 'evidence_memory' | 'audience_memory'
const MEMORY_TABLES: MemoryTable[] = ['brand_memory', 'evidence_memory', 'audience_memory']

const MEMORY_COLS: Record<MemoryTable, Record<string, unknown>> = {
  brand_memory: { category: 'positioning', statement: 'We integrate natively with every platform' },
  evidence_memory: { kind: 'quote', content: 'This tool saved us hours every week' },
  audience_memory: { kind: 'problem', statement: 'CTOs struggle to keep a consistent posting cadence' },
}

describe('founder-interview RLS and cascade (ADR 0029 §9)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(label: string): Promise<{ id: string; email: string }> {
    const email = `intw-rls-${label}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return { id: data.user.id as string, email }
  }

  async function newBusiness(label: string): Promise<{ businessId: string; ownerId: string; email: string }> {
    const owner = await newUser(label)
    const { data, error } = await admin
      .from('businesses')
      .insert({ name: `Interview RLS ${label}`, owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (error) throw error
    businessIds.push(data.id)
    return { businessId: data.id as string, ownerId: owner.id, email: owner.email }
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  // A round with two answers and one interview row on each memory table, for one business.
  async function seedInterview(businessId: string, actorId?: string) {
    const { rows: r } = await pg.query<{ id: string }>(
      `INSERT INTO public.founder_interview_rounds (business_id, status, question_count, bank_version, created_by, ratified_by)
       VALUES ($1, 'awaiting_ratification', 5, 1, $2, $2) RETURNING id`,
      [businessId, actorId ?? null],
    )
    const roundId = r[0].id
    const answerIds: string[] = []
    for (const position of [1, 2]) {
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.founder_interview_answers
           (business_id, round_id, position, question_key, bank_version, slot_type, slot_category, status, answer_text, answered_at, answered_by)
         VALUES ($1, $2, $3, $4, 1, 'brand', 'positioning', 'answered', 'we think we are fast', now(), $5) RETURNING id`,
        [businessId, roundId, position, `q-${position}`, actorId ?? null],
      )
      answerIds.push(rows[0].id)
    }
    const memoryIds: Record<string, string> = {}
    for (const table of MEMORY_TABLES) {
      const cols = {
        business_id: businessId,
        source: 'interview',
        scope: 'brand',
        status: 'candidate',
        interview_answer_id: answerIds[0],
        interview_span: 'we think we are fast',
        interview_extracted_text: 'The founder believes the product is fast',
        ...MEMORY_COLS[table],
      }
      const keys = Object.keys(cols)
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(cols),
      )
      memoryIds[table] = rows[0].id
    }
    return { roundId, answerIds, memoryIds }
  }

  async function countFor(table: string, businessId: string): Promise<number> {
    const { rows } = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${table} WHERE business_id = $1`, [businessId])
    return Number(rows[0].n)
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  afterAll(async () => {
    for (const id of businessIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
    await pg.end()
  })

  // ─── INTERVIEW-RLS-ISOLATED (38) ────────────────────────────────────────────

  describe('INTERVIEW-RLS-ISOLATED', () => {
    let a: { businessId: string; ownerId: string; email: string }
    let b: { businessId: string; ownerId: string; email: string }
    let seedA: Awaited<ReturnType<typeof seedInterview>>
    let seedB: Awaited<ReturnType<typeof seedInterview>>
    let memberA: SupabaseClient

    beforeAll(async () => {
      a = await newBusiness('a')
      b = await newBusiness('b')
      seedA = await seedInterview(a.businessId)
      seedB = await seedInterview(b.businessId)
      memberA = await signIn(a.email)
    })

    it.each(NEW_TABLES)('%s: RLS is enabled', async (table) => {
      const { rows } = await pg.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace",
        [table],
      )
      expect(rows[0].relrowsecurity).toBe(true)
    })

    it.each(NEW_TABLES)('%s: exactly ONE policy, FOR SELECT TO authenticated, with the InitPlan form of the existing memory policy', async (table) => {
      const { rows } = await pg.query<{ policyname: string; cmd: string; roles: string[]; qual: string; with_check: string | null }>(
        'SELECT policyname, cmd, roles::text[] AS roles, qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        ['public', table],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].policyname).toBe(`${table}_select_own`)
      expect(rows[0].cmd).toBe('SELECT')
      expect(rows[0].roles).toEqual(['authenticated'])
      expect(rows[0].with_check).toBeNull()
      // Parity with an existing policy's qual — Postgres normalises the wrapped form (cerebrum), so
      // the assertion is equality with brand_memory_select_own, not a literal string.
      const { rows: ref } = await pg.query<{ qual: string }>("SELECT qual FROM pg_policies WHERE policyname = 'brand_memory_select_own'")
      expect(rows[0].qual).toBe(ref[0].qual)
    })

    it.each(NEW_TABLES)('%s: anon holds NO privilege of any kind; authenticated holds SELECT only', async (table) => {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const { rows } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', ['anon', `public.${table}`, priv])
        expect(rows[0].ok, `anon holds ${priv} on ${table}`).toBe(false)
      }
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const { rows } = await pg.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', ['authenticated', `public.${table}`, priv])
        expect(rows[0].ok, `authenticated holds ${priv} on ${table}`).toBe(false)
      }
      const { rows: sel } = await pg.query<{ ok: boolean }>("SELECT has_table_privilege('authenticated', $1, 'SELECT') AS ok", [`public.${table}`])
      expect(sel[0].ok).toBe(true)
    })

    it("a member reads their own round and answers, and cannot read another business's (positive control + isolation)", async () => {
      const own = await memberA.from('founder_interview_rounds').select('id').eq('id', seedA.roundId)
      expect(own.error).toBeNull()
      expect((own.data ?? []).map((r: { id: string }) => r.id)).toEqual([seedA.roundId])

      const ownAnswers = await memberA.from('founder_interview_answers').select('id').eq('round_id', seedA.roundId)
      expect(ownAnswers.error).toBeNull()
      expect((ownAnswers.data ?? []).map((r: { id: string }) => r.id).sort()).toEqual([...seedA.answerIds].sort())

      const foreign = await memberA.from('founder_interview_rounds').select('id').eq('id', seedB.roundId)
      expect(foreign.error).toBeNull()
      expect(foreign.data ?? []).toHaveLength(0)
      const foreignAnswers = await memberA.from('founder_interview_answers').select('id').eq('round_id', seedB.roundId)
      expect(foreignAnswers.error).toBeNull()
      expect(foreignAnswers.data ?? []).toHaveLength(0)
    })

    it.each(NEW_TABLES)('%s: a member INSERT, UPDATE and DELETE each fail with 42501 (permission denied) and change nothing', async (table) => {
      const ownRow =
        table === 'founder_interview_rounds'
          ? { business_id: a.businessId, status: 'skipped', question_count: 5, bank_version: 1 }
          : { business_id: a.businessId, round_id: seedA.roundId, position: 3, question_key: 'probe', bank_version: 1, slot_type: 'brand', slot_category: 'pricing' }
      const ins = await memberA.from(table).insert(ownRow).select()
      expect(ins.error?.code).toBe('42501')
      expect(ins.error?.message).toMatch(/permission denied/i)

      const targetId = table === 'founder_interview_rounds' ? seedA.roundId : seedA.answerIds[0]
      const upd = await memberA.from(table).update({ updated_at: new Date().toISOString() }).eq('id', targetId).select()
      expect(upd.error?.code).toBe('42501')
      expect(upd.error?.message).toMatch(/permission denied/i)

      const del = await memberA.from(table).delete().eq('id', targetId).select()
      expect(del.error?.code).toBe('42501')
      expect(del.error?.message).toMatch(/permission denied/i)

      expect(await countFor(table, a.businessId)).toBe(table === 'founder_interview_rounds' ? 1 : 2)
    })
  })

  // ─── INTERVIEW-CASCADE-COMPLETE (39) ────────────────────────────────────────

  describe('INTERVIEW-CASCADE-COMPLETE', () => {
    async function assertAllGone(businessId: string) {
      for (const table of [...NEW_TABLES, ...MEMORY_TABLES]) {
        expect(await countFor(table, businessId), `${table} rows survived the erasure`).toBe(0)
      }
    }

    it('a ROOT DELETE FROM businesses erases rounds, answers AND interview memory rows — the memory -> answer NO ACTION key passes at statement end', async () => {
      const { businessId } = await newBusiness('root-delete')
      await seedInterview(businessId)
      for (const table of [...NEW_TABLES, ...MEMORY_TABLES]) expect(await countFor(table, businessId), `${table} seed`).toBeGreaterThan(0)
      await pg.query('DELETE FROM public.businesses WHERE id = $1', [businessId])
      await assertAllGone(businessId)
    })

    it('the purge_business RPC erases them too, with no dedicated clause (ADR 0029 §9.3)', async () => {
      const { businessId } = await newBusiness('purge')
      await seedInterview(businessId)
      const { data, error } = await admin.rpc('purge_business', { p_business_id: businessId })
      expect(error).toBeNull()
      expect(data.already_purged).toBe(false)
      await assertAllGone(businessId)
    })

    it('a round cannot be hard-deleted while interview memory still points at one of its answers (NO ACTION), and the business cascade is what may', async () => {
      const { businessId } = await newBusiness('round-delete')
      const { roundId } = await seedInterview(businessId)
      await expect(pg.query('DELETE FROM public.founder_interview_rounds WHERE id = $1', [roundId])).rejects.toMatchObject({ code: '23503' })
      expect(await countFor('founder_interview_rounds', businessId)).toBe(1)
    })

    it('a user deletion SETS NULL created_by, ratified_by and answered_by — the rows survive, anonymised', async () => {
      const { businessId } = await newBusiness('set-null')
      const actor = await newUser('actor')
      const { roundId, answerIds } = await seedInterview(businessId, actor.id)
      const before = await pg.query('SELECT created_by, ratified_by FROM public.founder_interview_rounds WHERE id = $1', [roundId])
      expect(before.rows[0]).toEqual({ created_by: actor.id, ratified_by: actor.id })

      const { error } = await admin.auth.admin.deleteUser(actor.id)
      expect(error).toBeNull()

      const round = await pg.query('SELECT created_by, ratified_by FROM public.founder_interview_rounds WHERE id = $1', [roundId])
      expect(round.rows).toHaveLength(1)
      expect(round.rows[0]).toEqual({ created_by: null, ratified_by: null })
      const answers = await pg.query('SELECT answered_by FROM public.founder_interview_answers WHERE id = ANY($1::uuid[])', [answerIds])
      expect(answers.rows).toHaveLength(2)
      expect(answers.rows.every((r: { answered_by: string | null }) => r.answered_by === null)).toBe(true)
    })

    it('the FK actions are exactly as specified: business CASCADE, round CASCADE, memory -> answer NO ACTION, user FKs SET NULL', async () => {
      const { rows } = await pg.query<{ tbl: string; col: string; ref: string; del: string }>(
        `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS ref, c.confdeltype::text AS del
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND (c.conrelid::regclass::text IN ('founder_interview_rounds', 'founder_interview_answers')
                 OR (a.attname = 'interview_answer_id'))`,
      )
      const action = (tbl: string, col: string) => rows.find((r) => r.tbl === tbl && r.col === col)?.del
      // pg_constraint.confdeltype: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT
      expect(action('founder_interview_rounds', 'business_id')).toBe('c')
      expect(action('founder_interview_answers', 'business_id')).toBe('c')
      expect(action('founder_interview_answers', 'round_id')).toBe('c')
      for (const [tbl, col] of [
        ['founder_interview_rounds', 'created_by'],
        ['founder_interview_rounds', 'ratified_by'],
        ['founder_interview_answers', 'answered_by'],
      ]) {
        expect(action(tbl, col), `${tbl}.${col}`).toBe('n')
      }
      for (const table of MEMORY_TABLES) expect(action(table, 'interview_answer_id'), `${table}.interview_answer_id`).toBe('a')
    })

    it('the two ADR 0010 Amendment 2 §D2.5 rows are present VERBATIM from ADR 0029 §9.4 (same commit as the migration)', () => {
      const adr0029 = fs.readFileSync(path.join(ROOT, 'docs', 'decisions', '0029-founder-input-engine.md'), 'utf8').replace(/\r\n/g, '\n')
      const adr0010 = fs.readFileSync(path.join(ROOT, 'docs', 'decisions', '0010-legal-surface.md'), 'utf8').replace(/\r\n/g, '\n')
      // §9.4 quotes each row as a blockquote line holding one backticked table row.
      const quoted = [...adr0029.matchAll(/^> `(\| founder_interview_(?:rounds|answers) \|.*\|)`$/gm)].map((m) => m[1])
      expect(quoted, 'ADR 0029 §9.4 must quote exactly the two rows').toHaveLength(2)
      expect(quoted.map((r) => r.split('|')[1].trim())).toEqual(['founder_interview_rounds', 'founder_interview_answers'])
      const lines = adr0010.split('\n').map((l) => l.trimEnd())
      for (const row of quoted) {
        expect(lines, `ADR 0010 §D2.5 is missing: ${row.slice(0, 60)}…`).toContain(row)
      }
      // ...and they sit inside the cascade table, i.e. after the D2.5 heading.
      const heading = adr0010.indexOf('#### D2.5')
      expect(heading).toBeGreaterThan(0)
      for (const row of quoted) expect(adr0010.indexOf(row)).toBeGreaterThan(heading)
    })
  })
})
