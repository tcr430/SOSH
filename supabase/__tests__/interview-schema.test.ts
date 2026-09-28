import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0029 §2.1, §2.2, §3.6, §5.2, §9.1 — INTERVIEW-PROVENANCE-DISTINCT (1), INTERVIEW-ANSWER-TRACEABLE
// (2), INTERVIEW-PROVENANCE-IMMUTABLE (3), INTERVIEW-ONE-OPEN-ROUND (18) and the SQL half of
// INTERVIEW-QUESTIONS-BOUNDED (15). Tier 1, live Postgres.
//
// These are CHECK / trigger / unique-index behaviours, so they can only be proved against a real
// database (a CHECK cannot be proved at Tier 2 — cerebrum, Postgres/RLS). Every assertion is on the
// Postgres error CODE (23514 check_violation, 23505 unique_violation, 23503 foreign_key_violation),
// never merely "an error": a wrong constraint firing for a different reason must not pass.
//
// Rows are inserted over a direct pg connection (the postgres role), which bypasses RLS and grants but
// NOT constraints or triggers — exactly the layer under test.

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

type MemoryTable = 'brand_memory' | 'evidence_memory' | 'audience_memory'
const MEMORY_TABLES: MemoryTable[] = ['brand_memory', 'evidence_memory', 'audience_memory']

const DOMAIN: Record<MemoryTable, Record<string, unknown>> = {
  brand_memory: { category: 'positioning', statement: 'We integrate natively with every platform' },
  evidence_memory: { kind: 'quote', content: 'This tool saved us hours every week' },
  audience_memory: { kind: 'problem', statement: 'CTOs struggle to keep a consistent posting cadence' },
}

const TERMINAL = ['ratified', 'skipped', 'expired', 'failed', 'no_records']
const NON_TERMINAL = ['open', 'submitted', 'extracting', 'extraction_failed', 'awaiting_ratification']

describe('founder-interview schema (ADR 0029 §2, §5.2, §9.1)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newBusiness(): Promise<{ businessId: string; ownerId: string }> {
    const email = `intw-schema-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (userErr) throw userErr
    userIds.push(user.user.id)
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: `Interview Schema Business ${seq}`, owner_id: user.user.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessIds.push(biz.id)
    return { businessId: biz.id as string, ownerId: user.user.id as string }
  }

  async function newRound(businessId: string, status = 'open', extra: Record<string, unknown> = {}): Promise<string> {
    const cols = { business_id: businessId, status, question_count: 5, bank_version: 1, ...extra }
    const keys = Object.keys(cols)
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.founder_interview_rounds (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(cols),
    )
    return rows[0].id
  }

  async function newAnswer(businessId: string, roundId: string, position: number, extra: Record<string, unknown> = {}): Promise<string> {
    const cols = {
      business_id: businessId,
      round_id: roundId,
      position,
      question_key: `q-${position}-${Math.random().toString(36).slice(2, 8)}`,
      bank_version: 1,
      slot_type: 'brand',
      slot_category: 'positioning',
      ...extra,
    }
    const keys = Object.keys(cols)
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.founder_interview_answers (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(cols),
    )
    return rows[0].id
  }

  // A round + one answered answer for a fresh business: the anchor an interview memory row needs.
  async function fixture(): Promise<{ businessId: string; roundId: string; answerId: string }> {
    const { businessId } = await newBusiness()
    const roundId = await newRound(businessId)
    const answerId = await newAnswer(businessId, roundId, 1, { status: 'answered', answered_at: new Date().toISOString(), answer_text: 'we think we are fast' })
    return { businessId, roundId, answerId }
  }

  async function insertMemory(table: MemoryTable, businessId: string, cols: Record<string, unknown>): Promise<string> {
    const all = { business_id: businessId, scope: 'brand', ...DOMAIN[table], ...cols }
    const keys = Object.keys(all)
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(all),
    )
    return rows[0].id
  }

  const interviewCols = (answerId: string | null, extra: Record<string, unknown> = {}) => ({
    source: 'interview',
    interview_answer_id: answerId,
    interview_span: 'we think we are fast',
    interview_extracted_text: 'The founder believes the product is fast',
    ...extra,
  })

  async function pgError(work: Promise<unknown>): Promise<{ code?: string; message?: string }> {
    try {
      await work
    } catch (err) {
      return err as { code?: string; message?: string }
    }
    return {}
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
    // Root delete: rounds, answers and interview memory rows cascade in ONE statement. Users go in concurrent batches under an
    // explicit timeout: ~60 sequential deletes can outrun vitest's 10 s default hook timeout on a slow run (see
    // interview-lifecycle.test.ts, where exactly that happened).
    for (const id of businessIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
    for (let i = 0; i < userIds.length; i += 20) {
      await Promise.all(userIds.slice(i, i + 20).map((id) => admin.auth.admin.deleteUser(id)))
    }
    await pg.end()
  }, 180_000)

  // ─── INTERVIEW-PROVENANCE-DISTINCT (1) ──────────────────────────────────────

  describe('INTERVIEW-PROVENANCE-DISTINCT', () => {
    it.each(MEMORY_TABLES)("%s: the source CHECK accepts 'interview' (positive), alongside manual and distilled", async (table) => {
      const { businessId, answerId } = await fixture()
      await expect(insertMemory(table, businessId, interviewCols(answerId))).resolves.toBeTruthy()
      await expect(insertMemory(table, businessId, { source: 'manual' })).resolves.toBeTruthy()
      await expect(insertMemory(table, businessId, { source: 'distilled' })).resolves.toBeTruthy()
    })

    it.each(MEMORY_TABLES)('%s: an unknown source value is still rejected with 23514', async (table) => {
      const { businessId } = await newBusiness()
      const err = await pgError(insertMemory(table, businessId, { source: 'made-up' }))
      expect(err.code).toBe(CHECK_VIOLATION)
    })

    it("performance_memory still REJECTS source 'interview' — its CHECK is not touched (D-4)", async () => {
      const { businessId } = await newBusiness()
      const err = await pgError(
        pg.query(
          "INSERT INTO public.performance_memory (business_id, source, scope, dimension, pattern) VALUES ($1, 'interview', 'brand', 'topic', 'a pattern')",
          [businessId],
        ),
      )
      expect(err.code).toBe(CHECK_VIOLATION)
    })

    it.each(MEMORY_TABLES)('%s: exactly ONE source-ANY-ARRAY CHECK exists and it names interview, so a later by-definition lookup stays exactly-one', async (table) => {
      const { rows } = await pg.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ~ '^CHECK \\(\\(source = ANY \\(ARRAY\\['`,
        [`public.${table}`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].conname).toBe(`${table}_source_check`)
      expect(rows[0].def).toContain("'interview'")
    })

    it('the import immutability trigger function is UNEDITED: it still guards exactly its three columns and knows nothing of interview (db-MINOR-1)', async () => {
      const { rows } = await pg.query<{ def: string }>("SELECT pg_get_functiondef('public.enforce_memory_import_immutable()'::regprocedure) AS def")
      expect(rows[0].def).toContain('import_source_post_ids')
      expect(rows[0].def).not.toMatch(/interview/i)
    })
  })

  // ─── INTERVIEW-ANSWER-TRACEABLE (2) ─────────────────────────────────────────

  describe('INTERVIEW-ANSWER-TRACEABLE — both biconditionals and the clean-row CHECKs', () => {
    it.each(MEMORY_TABLES)("%s: an 'interview' row with NO answer id is rejected with 23514", async (table) => {
      const { businessId } = await newBusiness()
      const err = await pgError(insertMemory(table, businessId, interviewCols(null)))
      expect(err.code).toBe(CHECK_VIOLATION)
      expect(err.message).toMatch(/interview_answer_id_marker_check/)
    })

    it.each(MEMORY_TABLES)("%s: a 'manual' row CARRYING an answer id is rejected with 23514", async (table) => {
      const { businessId, answerId } = await fixture()
      const err = await pgError(insertMemory(table, businessId, { source: 'manual', interview_answer_id: answerId }))
      expect(err.code).toBe(CHECK_VIOLATION)
      expect(err.message).toMatch(/interview_answer_id_marker_check/)
    })

    it.each(MEMORY_TABLES)("%s: an 'interview' row with NO extracted text is rejected; a 'manual' row WITH extracted text is rejected", async (table) => {
      const { businessId, answerId } = await fixture()
      const missing = await pgError(insertMemory(table, businessId, interviewCols(answerId, { interview_extracted_text: null })))
      expect(missing.code).toBe(CHECK_VIOLATION)
      expect(missing.message).toMatch(/interview_extracted_text_marker_check/)
      const stray = await pgError(insertMemory(table, businessId, { source: 'manual', interview_extracted_text: 'x' }))
      expect(stray.code).toBe(CHECK_VIOLATION)
    })

    it.each(MEMORY_TABLES)("%s: an 'interview' row needs a span OR a redaction stamp — neither is rejected, the stamp alone is accepted", async (table) => {
      const { businessId, answerId } = await fixture()
      const neither = await pgError(insertMemory(table, businessId, interviewCols(answerId, { interview_span: null })))
      expect(neither.code).toBe(CHECK_VIOLATION)
      expect(neither.message).toMatch(/interview_span_or_redacted_check/)
      await expect(
        insertMemory(table, businessId, interviewCols(answerId, { interview_span: null, interview_span_redacted_at: new Date().toISOString() })),
      ).resolves.toBeTruthy()
    })

    it.each(MEMORY_TABLES)('%s: a NON-interview row may not carry a span, a redaction stamp, or interview_edited = true (23514)', async (table) => {
      const { businessId } = await newBusiness()
      for (const stray of [{ interview_span: 'x' }, { interview_span_redacted_at: new Date().toISOString() }, { interview_edited: true }]) {
        const err = await pgError(insertMemory(table, businessId, { source: 'distilled', ...stray }))
        expect(err.code, JSON.stringify(stray)).toBe(CHECK_VIOLATION)
      }
    })

    it.each(MEMORY_TABLES)('%s: a span longer than 500 characters is rejected with 23514', async (table) => {
      const { businessId, answerId } = await fixture()
      const err = await pgError(insertMemory(table, businessId, interviewCols(answerId, { interview_span: 'x'.repeat(501) })))
      expect(err.code).toBe(CHECK_VIOLATION)
      await expect(insertMemory(table, businessId, interviewCols(answerId, { interview_span: 'x'.repeat(500) }))).resolves.toBeTruthy()
    })

    it.each(MEMORY_TABLES)('%s: an answer id that does not exist is rejected with 23503', async (table) => {
      const { businessId } = await newBusiness()
      const err = await pgError(insertMemory(table, businessId, interviewCols('00000000-0000-4000-8000-000000000001')))
      expect(err.code).toBe(FK_VIOLATION)
    })

    it.each(MEMORY_TABLES)('%s: the answer a memory row points at CANNOT be hard-deleted (ON DELETE NO ACTION, 23503)', async (table) => {
      const { businessId, answerId } = await fixture()
      await insertMemory(table, businessId, interviewCols(answerId))
      const err = await pgError(pg.query('DELETE FROM public.founder_interview_answers WHERE id = $1', [answerId]))
      expect(err.code).toBe(FK_VIOLATION)
    })
  })

  // ─── INTERVIEW-PROVENANCE-IMMUTABLE (3) ─────────────────────────────────────

  describe('INTERVIEW-PROVENANCE-IMMUTABLE — the sibling trigger', () => {
    async function seedRow(table: MemoryTable) {
      const fx = await fixture()
      const id = await insertMemory(table, fx.businessId, interviewCols(fx.answerId))
      return { ...fx, id }
    }

    it.each(MEMORY_TABLES)('%s: the trigger itself (not a CHECK) rejects a change to source, interview_answer_id or interview_extracted_text', async (table) => {
      const { id, businessId, roundId } = await seedRow(table)
      const otherAnswer = await newAnswer(businessId, roundId, 2)
      const a = await pgError(pg.query(`UPDATE public.${table} SET interview_answer_id = $2 WHERE id = $1`, [id, otherAnswer]))
      expect(a.message).toMatch(/interview provenance columns .* are immutable/)
      const b = await pgError(pg.query(`UPDATE public.${table} SET interview_extracted_text = 'changed' WHERE id = $1`, [id]))
      expect(b.message).toMatch(/interview provenance columns .* are immutable/)
      // source is guarded by BOTH triggers. BEFORE UPDATE triggers fire in name order, so
      // trg_<t>_import_immutable raises first with its own message; either one blocking is the
      // property (a change to source cannot land), and the sibling still guards it independently.
      const c = await pgError(pg.query(`UPDATE public.${table} SET source = 'manual' WHERE id = $1`, [id]))
      expect(c.message).toMatch(/(import|interview) provenance columns .* are immutable/)
    })

    it.each(MEMORY_TABLES)('%s: the span may change ONLY to NULL, and only in the statement that sets interview_span_redacted_at', async (table) => {
      const { id } = await seedRow(table)
      // to a different non-null value: rejected
      const changed = await pgError(pg.query(`UPDATE public.${table} SET interview_span = 'a different span' WHERE id = $1`, [id]))
      expect(changed.message).toMatch(/interview_span may only change to NULL/)
      // to NULL alone (no redaction stamp): rejected
      const alone = await pgError(pg.query(`UPDATE public.${table} SET interview_span = NULL WHERE id = $1`, [id]))
      expect(alone.message).toMatch(/interview_span may only change to NULL/)
      // the stamp alone, span left in place: rejected
      const stampOnly = await pgError(pg.query(`UPDATE public.${table} SET interview_span_redacted_at = now() WHERE id = $1`, [id]))
      expect(stampOnly.message).toMatch(/interview_span_redacted_at may only be set once/)
      // both in ONE statement: accepted
      await expect(pg.query(`UPDATE public.${table} SET interview_span = NULL, interview_span_redacted_at = now() WHERE id = $1`, [id])).resolves.toBeTruthy()
      const { rows } = await pg.query<{ interview_span: string | null; interview_span_redacted_at: string | null }>(
        `SELECT interview_span, interview_span_redacted_at FROM public.${table} WHERE id = $1`,
        [id],
      )
      expect(rows[0].interview_span).toBeNull()
      expect(rows[0].interview_span_redacted_at).not.toBeNull()
      // and the stamp cannot be cleared afterwards
      const cleared = await pgError(pg.query(`UPDATE public.${table} SET interview_span_redacted_at = NULL WHERE id = $1`, [id]))
      expect(cleared.message).toMatch(/interview_span_redacted_at may only be set once/)
    })

    it.each(MEMORY_TABLES)('%s: the record text and interview_edited STAY editable at ratification, and non-interview rows are unaffected', async (table) => {
      const { id, businessId } = await seedRow(table)
      const textColumn = table === 'evidence_memory' ? 'content' : 'statement'
      await expect(
        pg.query(`UPDATE public.${table} SET ${textColumn} = 'an edited restatement', interview_edited = true, status = 'active' WHERE id = $1`, [id]),
      ).resolves.toBeTruthy()
      const manualId = await insertMemory(table, businessId, { source: 'manual' })
      await expect(pg.query(`UPDATE public.${table} SET confidence = 0.9, status = 'active' WHERE id = $1`, [manualId])).resolves.toBeTruthy()
    })
  })

  // ─── INTERVIEW-ONE-OPEN-ROUND (18) ──────────────────────────────────────────

  describe('INTERVIEW-ONE-OPEN-ROUND — the partial UNIQUE over non-terminal statuses', () => {
    it.each(NON_TERMINAL)("a second round while one is '%s' is rejected with 23505", async (status) => {
      const { businessId } = await newBusiness()
      await newRound(businessId, status)
      for (const second of ['open', 'submitted', 'awaiting_ratification']) {
        const err = await pgError(newRound(businessId, second))
        expect(err.code, `${status} then ${second}`).toBe(UNIQUE_VIOLATION)
      }
    })

    it('any number of TERMINAL rounds coexist with one open round (the partial predicate, not an unconditional UNIQUE)', async () => {
      const { businessId } = await newBusiness()
      for (const status of [...TERMINAL, ...TERMINAL]) await newRound(businessId, status)
      await expect(newRound(businessId, 'open')).resolves.toBeTruthy()
      const err = await pgError(newRound(businessId, 'open'))
      expect(err.code).toBe(UNIQUE_VIOLATION)
    })

    it('another business is unaffected, and a round can be opened again once the first turns terminal', async () => {
      const a = await newBusiness()
      const b = await newBusiness()
      const first = await newRound(a.businessId, 'awaiting_ratification')
      await expect(newRound(b.businessId, 'open')).resolves.toBeTruthy()
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'ratified' WHERE id = $1", [first])
      await expect(newRound(a.businessId, 'open')).resolves.toBeTruthy()
    })
  })

  // ─── INTERVIEW-QUESTIONS-BOUNDED (15) — SQL half, and the rest of §9.1 ───────

  describe('INTERVIEW-QUESTIONS-BOUNDED (SQL half) and the §9.1 column checks', () => {
    it('question_count must be 5..8: 4 and 9 are rejected with 23514, 5 and 8 are accepted', async () => {
      const { businessId } = await newBusiness()
      for (const bad of [0, 4, 9, 12]) {
        const err = await pgError(newRound(businessId, 'skipped', { question_count: bad }))
        expect(err.code, `question_count ${bad}`).toBe(CHECK_VIOLATION)
      }
      for (const ok of [5, 8]) await expect(newRound(businessId, 'skipped', { question_count: ok })).resolves.toBeTruthy()
    })

    it('answer position must be 1..8, and (round_id, position) and (round_id, question_key) are unique', async () => {
      const { businessId } = await newBusiness()
      const roundId = await newRound(businessId)
      for (const bad of [0, 9]) {
        const err = await pgError(newAnswer(businessId, roundId, bad))
        expect(err.code, `position ${bad}`).toBe(CHECK_VIOLATION)
      }
      await newAnswer(businessId, roundId, 1, { question_key: 'k1' })
      await newAnswer(businessId, roundId, 8, { question_key: 'k8' })
      expect((await pgError(newAnswer(businessId, roundId, 1, { question_key: 'other' }))).code).toBe(UNIQUE_VIOLATION)
      expect((await pgError(newAnswer(businessId, roundId, 2, { question_key: 'k1' }))).code).toBe(UNIQUE_VIOLATION)
    })

    it('defaults and bounds on the round: ceiling 30, attempts 0, attempts <= 3, spend <= ceiling, a known status', async () => {
      const { businessId } = await newBusiness()
      const id = await newRound(businessId, 'skipped')
      const { rows } = await pg.query<{ ceiling_cents: number; spend_cents: number; extraction_attempts: number }>(
        'SELECT ceiling_cents, spend_cents, extraction_attempts FROM public.founder_interview_rounds WHERE id = $1',
        [id],
      )
      expect(rows[0]).toEqual({ ceiling_cents: 30, spend_cents: 0, extraction_attempts: 0 })
      expect((await pgError(newRound(businessId, 'skipped', { extraction_attempts: 4 }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newRound(businessId, 'skipped', { spend_cents: 31 }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newRound(businessId, 'skipped', { spend_cents: 30 }))).code).toBeUndefined()
      expect((await pgError(newRound(businessId, 'not-a-status'))).code).toBe(CHECK_VIOLATION)
    })

    it('answer_text is at most 2000 characters; an answered row needs answered_at; a redacted row has no text; slot values are enumerated', async () => {
      const { businessId } = await newBusiness()
      const roundId = await newRound(businessId)
      expect((await pgError(newAnswer(businessId, roundId, 1, { answer_text: 'x'.repeat(2001) }))).code).toBe(CHECK_VIOLATION)
      await expect(newAnswer(businessId, roundId, 1, { answer_text: 'x'.repeat(2000) })).resolves.toBeTruthy()
      expect((await pgError(newAnswer(businessId, roundId, 2, { status: 'answered' }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newAnswer(businessId, roundId, 3, { answer_text: 'still here', redacted_at: new Date().toISOString() }))).code).toBe(CHECK_VIOLATION)
      await expect(newAnswer(businessId, roundId, 4, { answer_text: null, redacted_at: new Date().toISOString() })).resolves.toBeTruthy()
      expect((await pgError(newAnswer(businessId, roundId, 5, { slot_type: 'performance' }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newAnswer(businessId, roundId, 6, { slot_category: 'other' }))).code).toBe(CHECK_VIOLATION)
    })

    it('a slot category must belong to its slot type (db-review NIT-8)', async () => {
      const { businessId } = await newBusiness()
      const roundId = await newRound(businessId)
      expect((await pgError(newAnswer(businessId, roundId, 1, { slot_type: 'brand', slot_category: 'problem' }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newAnswer(businessId, roundId, 2, { slot_type: 'audience', slot_category: 'quote' }))).code).toBe(CHECK_VIOLATION)
      expect((await pgError(newAnswer(businessId, roundId, 3, { slot_type: 'evidence', slot_category: 'positioning' }))).code).toBe(CHECK_VIOLATION)
      const ok: [string, string][] = [['brand', 'pricing'], ['audience', 'trigger'], ['evidence', 'usage_data']]
      for (const [i, [t, c]] of ok.entries()) {
        await expect(newAnswer(businessId, roundId, i + 4, { slot_type: t, slot_category: c })).resolves.toBeTruthy()
      }
    })

    it('businesses gained interview_snoozed_until, nullable', async () => {
      const { businessId } = await newBusiness()
      const { rows } = await pg.query<{ interview_snoozed_until: string | null }>('SELECT interview_snoozed_until FROM public.businesses WHERE id = $1', [businessId])
      expect(rows[0].interview_snoozed_until).toBeNull()
    })
  })
})
