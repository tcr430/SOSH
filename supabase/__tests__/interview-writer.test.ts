import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0029 §2.3, §2.6, §4.3 — INTERVIEW-WRITER-TENANT-BOUND (7), INTERVIEW-RATIFY-BEFORE-ACTIVE (9),
// INTERVIEW-EVIDENCE-PERMISSION-OFF (20, Tier-1 half), INTERVIEW-RETRY-IDEMPOTENT (31), and the Tier-1 halves of
// INTERVIEW-GOVERNANCE-NOT-MODEL-SUPPLIED (6) and INTERVIEW-GROUNDED (8). Live Postgres.
//
// write_interview_candidates is the ONLY SQL path that produces source = 'interview' rows. The guarantees proved here:
//  - its signature is EXACTLY (uuid, jsonb): no business parameter, no governance parameter, one overload;
//  - every governance column is FIXED IN SQL: a payload that smuggles confidence 1.0, status 'active', source 'manual',
//    public_use_permission true, a foreign business_id, a wider scope, a far-future expiry... is ignored;
//  - the business comes from the LOCKED ROUND, and an answer of another round or business is rejected;
//  - grounding is re-checked in SQL on RAW text, while the STORED text and span are the neutralised forms;
//  - a retry inserts nothing and never flips a round that already holds candidates to no_records.
//
// All assertions on failure are on the SQLSTATE (22023 invalid_parameter_value) AND a message fragment: a wrong check
// firing for a different reason must not pass.

const PASSWORD = 'TestPass123!'

// One answer text used for every position; each position gets a distinct prefix so spans are contained in ALL of them.
const answerText = (n: number) =>
  `Answer ${n}. We integrate natively with Slack and Linear. Pricing starts at 49 euros per month. ` +
  'Buyers keep asking about security reviews. One customer said: "it saved us hours every week". Usage doubled in the third quarter.'

const SPAN_BRAND = 'We integrate natively with Slack and Linear'
const SPAN_PRICING = 'Pricing starts at 49 euros per month'
const SPAN_AUDIENCE = 'Buyers keep asking about security reviews'
const SPAN_QUOTE = 'it saved us hours every week'
const SPAN_USAGE = 'Usage doubled in the third quarter'

const GOOD_QUESTIONS = Array.from({ length: 5 }, (_, i) => ({
  questionKey: `q-${i + 1}`,
  slotType: 'brand',
  slotCategory: 'positioning',
  bankVersion: 1,
}))

type Item = {
  answerId: string
  type: string
  category: string
  text: string
  span: string
  storedText?: string
  storedSpan?: string
  [extra: string]: unknown
}
const item = (answerId: string, type: string, category: string, text: string, span: string, extra: Partial<Item> = {}): Item => ({
  answerId,
  type,
  category,
  text,
  span,
  storedText: text,
  storedSpan: span,
  ...extra,
})
const counters = (proposed: number, droppedUngrounded = 0, droppedPerformanceClaim = 0) => ({ proposed, droppedUngrounded, droppedPerformanceClaim })

describe('write_interview_candidates (ADR 0029 §2.3, §2.6)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(label: string): Promise<string> {
    const email = `intw-writer-${label}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return data.user.id as string
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args)
    return { data, error }
  }
  const write = (roundId: string, items: unknown[], c: Record<string, unknown> = counters(items.length), extraEnvelope: Record<string, unknown> = {}) =>
    rpc('write_interview_candidates', { p_round_id: roundId, p_items: { items, counters: c, ...extraEnvelope } })

  type Setup = { businessId: string; owner: string; roundId: string; answers: { id: string; position: number; text: string }[] }

  // A business with an EXTRACTING round: five answered questions, submitted and claimed through the real lifecycle RPCs.
  async function extractingRound(): Promise<Setup> {
    const owner = await newUser('owner')
    const { data: biz, error } = await admin.from('businesses').insert({ name: `Interview Writer ${seq}`, owner_id: owner, plan: 'plus' }).select('id').single()
    if (error) throw error
    const businessId = biz.id as string
    businessIds.push(businessId)
    const created = await rpc('create_interview_round', { p_user_id: owner, p_business_id: businessId, p_questions: GOOD_QUESTIONS })
    if (created.error) throw created.error
    const roundId = created.data.roundId as string
    const { rows } = await pg.query<{ id: string; position: number }>('SELECT id, position FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])
    const answers: Setup['answers'] = []
    for (const r of rows) {
      const text = answerText(r.position)
      const saved = await rpc('save_interview_answer', { p_user_id: owner, p_answer_id: r.id, p_text: text })
      expect(saved.data.outcome).toBe('ok')
      answers.push({ id: r.id, position: r.position, text })
    }
    expect((await rpc('submit_interview_round', { p_user_id: owner, p_round_id: roundId })).data.outcome).toBe('ok')
    expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.outcome).toBe('claimed')
    return { businessId, owner, roundId, answers }
  }

  const roundRow = async (roundId: string) => (await pg.query('SELECT * FROM public.founder_interview_rounds WHERE id = $1', [roundId])).rows[0]

  async function candidateCount(roundId: string): Promise<number> {
    let n = 0
    for (const t of ['brand_memory', 'audience_memory', 'evidence_memory']) {
      const { rows } = await pg.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${t} m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id WHERE a.round_id = $1`,
        [roundId],
      )
      n += Number(rows[0].n)
    }
    return n
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  // ~40 businesses and users are created across these tests: clean up in concurrent batches under an explicit timeout
  // (a sequential cleanup outran vitest's 10 s default hook timeout in interview-lifecycle.test.ts on a slow run).
  afterAll(async () => {
    for (const id of businessIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
    for (let i = 0; i < userIds.length; i += 20) {
      await Promise.all(userIds.slice(i, i + 20).map((id) => admin.auth.admin.deleteUser(id)))
    }
    await pg.end()
  }, 180_000)

  // ─── INTERVIEW-WRITER-TENANT-BOUND (7): the signature ───────────────────────

  describe('INTERVIEW-WRITER-TENANT-BOUND — the signature and the grant', () => {
    it('there is exactly ONE write_interview_candidates and its signature is (uuid, jsonb): no business parameter, no governance parameter', async () => {
      const { rows } = await pg.query<{ args: string; nargs: number; types: string; names: string[] | null }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args, p.pronargs AS nargs, array_to_string(p.proargtypes::oid[]::regtype[], ',') AS types, p.proargnames AS names
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'write_interview_candidates'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].nargs).toBe(2)
      expect(rows[0].types).toBe('uuid,jsonb')
      expect(rows[0].names).toEqual(['p_round_id', 'p_items'])
      expect(rows[0].args).toBe('p_round_id uuid, p_items jsonb')
    })

    it('EXECUTE is held by service_role alone, and the function is SECURITY DEFINER with a pinned search_path', async () => {
      const { rows } = await pg.query<{ oid: string; secdef: boolean; cfg: string[] | null }>(
        "SELECT p.oid::text AS oid, p.prosecdef AS secdef, p.proconfig AS cfg FROM pg_proc p WHERE p.proname = 'write_interview_candidates' AND p.pronamespace = 'public'::regnamespace",
      )
      expect(rows[0].secdef).toBe(true)
      expect(rows[0].cfg?.join(',')).toContain('search_path=public, pg_temp')
      for (const role of ['anon', 'authenticated']) {
        const { rows: g } = await pg.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2::oid, $3) AS ok', [role, rows[0].oid, 'EXECUTE'])
        expect(g[0].ok, `${role} can EXECUTE the writer`).toBe(false)
      }
      const { rows: pub } = await pg.query<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = $1::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS ok",
        [rows[0].oid],
      )
      expect(pub[0].ok).toBe(false)
      const { rows: sr } = await pg.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', $1::oid, 'EXECUTE') AS ok", [rows[0].oid])
      expect(sr[0].ok).toBe(true)
    })
  })

  // ─── INTERVIEW-GOVERNANCE-NOT-MODEL-SUPPLIED (6), Tier-1 half ────────────────

  describe('INTERVIEW-GOVERNANCE-NOT-MODEL-SUPPLIED — governance is fixed in SQL', () => {
    it('a payload smuggling confidence 1.0, status active, source manual, public_use_permission true, a foreign business_id, scope, sensitivity, expiry and last_confirmed_at produces rows with EXACTLY the fixed values', async () => {
      const s = await extractingRound()
      const other = await extractingRound() // another tenant whose id the payload tries to write into
      const smuggle = {
        confidence: 1.0,
        status: 'active',
        source: 'manual',
        public_use_permission: true,
        business_id: other.businessId,
        scope: 'campaign',
        scope_ref: 'x',
        sensitivity: 'public',
        observation_count: 99,
        expires_at: '2099-01-01T00:00:00Z',
        last_confirmed_at: '2099-01-01T00:00:00Z',
        interview_edited: true,
        deleted_at: '2020-01-01T00:00:00Z',
      }
      const items = [
        item(s.answers[0].id, 'brand', 'positioning', 'The product integrates natively with Slack and Linear', SPAN_BRAND, smuggle),
        item(s.answers[0].id, 'audience', 'objection', 'Buyers worry about security reviews', SPAN_AUDIENCE, smuggle),
        item(s.answers[0].id, 'evidence', 'quote', SPAN_QUOTE, SPAN_QUOTE, smuggle),
      ]
      const r = await write(s.roundId, items, { ...counters(3), ...smuggle }, smuggle)
      expect(r.error).toBeNull()
      expect(r.data).toMatchObject({ outcome: 'written', status: 'awaiting_ratification', inserted: 3 })

      const answerAt = (await pg.query<{ answered_at: string }>('SELECT answered_at FROM public.founder_interview_answers WHERE id = $1', [s.answers[0].id])).rows[0].answered_at
      for (const [table, confidence] of [['brand_memory', '0.60'], ['audience_memory', '0.50'], ['evidence_memory', '0.40']] as const) {
        const { rows } = await pg.query(`SELECT * FROM public.${table} WHERE interview_answer_id = $1`, [s.answers[0].id])
        expect(rows, table).toHaveLength(1)
        const row = rows[0]
        expect(row.business_id, `${table} business is the ROUND's, not the payload's`).toBe(s.businessId)
        expect(row.source).toBe('interview')
        expect(row.status).toBe('candidate')
        expect(row.sensitivity).toBe('internal')
        expect(row.public_use_permission).toBe(false)
        expect(row.scope).toBe('brand')
        expect(row.scope_ref).toBeNull()
        expect(row.observation_count).toBe(1)
        expect(row.confidence).toBe(confidence)
        expect(row.interview_edited).toBe(false)
        expect(row.deleted_at).toBeNull()
        expect(new Date(row.last_confirmed_at).getTime(), `${table} last_confirmed_at is the ANSWER's answered_at`).toBe(new Date(answerAt).getTime())
        expect(new Date(row.expires_at ?? answerAt).getFullYear()).toBeLessThan(2030)
      }
      expect(await candidateCount(other.roundId)).toBe(0)
    })

    it("the expiry table of ADR 0029 §2.6, from the answer's answered_at: every category/kind of all three types", async () => {
      const s = await extractingRound()
      // 14 (type, category) pairs spread over five answers, at most three per answer
      const plan: [string, string, string, string, number | null][] = [
        ['brand', 'positioning', 'Positioning restated', SPAN_BRAND, 540],
        ['brand', 'capability', 'Capability restated', SPAN_BRAND, 540],
        ['brand', 'pricing', 'Pricing restated', SPAN_PRICING, 180],
        ['brand', 'competitor', 'Competitor restated', SPAN_BRAND, 365],
        ['brand', 'other', 'Other brand restated', SPAN_BRAND, 365],
        ['audience', 'problem', 'Problem restated', SPAN_AUDIENCE, 365],
        ['audience', 'objection', 'Objection restated', SPAN_AUDIENCE, 365],
        ['audience', 'question', 'Question restated', SPAN_AUDIENCE, 365],
        ['audience', 'trigger', 'Trigger restated', SPAN_AUDIENCE, 365],
        ['audience', 'other', 'Other audience restated', SPAN_AUDIENCE, 365],
        ['evidence', 'quote', SPAN_QUOTE, SPAN_QUOTE, null],
        ['evidence', 'case_study', SPAN_QUOTE, SPAN_QUOTE, null],
        ['evidence', 'usage_data', SPAN_USAGE, SPAN_USAGE, 365],
        ['evidence', 'other', SPAN_QUOTE, SPAN_QUOTE, null],
      ]
      const items = plan.map(([type, cat, text, span], i) => item(s.answers[i % 5].id, type, cat, text, span))
      const r = await write(s.roundId, items)
      expect(r.error).toBeNull()
      expect(r.data.inserted).toBe(14)
      for (const [type, cat, , , days] of plan) {
        const table = type === 'brand' ? 'brand_memory' : type === 'audience' ? 'audience_memory' : 'evidence_memory'
        const col = type === 'brand' ? 'category' : 'kind'
        const { rows } = await pg.query<{ days: string | null }>(
          `SELECT round(extract(epoch FROM (m.expires_at - m.last_confirmed_at)) / 86400)::text AS days
             FROM public.${table} m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
            WHERE a.round_id = $1 AND m.${col} = $2`,
          [s.roundId, cat],
        )
        expect(rows, `${type}/${cat}`).toHaveLength(1)
        expect(rows[0].days === null ? null : Number(rows[0].days), `${type}/${cat} expiry`).toBe(days)
      }
    })
  })

  // ─── INTERVIEW-WRITER-TENANT-BOUND (7): the round binds the answers ─────────

  describe('INTERVIEW-WRITER-TENANT-BOUND — the business comes from the locked round', () => {
    it('an answer of ANOTHER BUSINESS is rejected with 22023 and nothing is written', async () => {
      const a = await extractingRound()
      const b = await extractingRound()
      const r = await write(a.roundId, [item(a.answers[0].id, 'brand', 'positioning', 'ok record', SPAN_BRAND), item(b.answers[0].id, 'brand', 'pricing', 'foreign record', SPAN_PRICING)])
      expect(r.error?.code).toBe('22023')
      expect(r.error?.message).toMatch(/is not an answered question of round/)
      expect(await candidateCount(a.roundId)).toBe(0)
      expect(await candidateCount(b.roundId)).toBe(0)
      expect((await roundRow(a.roundId)).status).toBe('extracting')
    })

    it('an answer of ANOTHER ROUND of the same business is rejected', async () => {
      const s = await extractingRound()
      // finish round 1 and open round 2 for the same business
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'ratified', created_at = now() - interval '40 days' WHERE id = $1", [s.roundId])
      const second = await rpc('create_interview_round', { p_user_id: s.owner, p_business_id: s.businessId, p_questions: GOOD_QUESTIONS })
      expect(second.data.outcome).toBe('ok')
      const r2 = second.data.roundId as string
      const { rows } = await pg.query<{ id: string }>('SELECT id FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [r2])
      await rpc('save_interview_answer', { p_user_id: s.owner, p_answer_id: rows[0].id, p_text: answerText(1) })
      await rpc('submit_interview_round', { p_user_id: s.owner, p_round_id: r2 })
      await rpc('claim_interview_extraction', { p_round_id: r2 })
      // round 2's writer is handed an answer of round 1
      const r = await write(r2, [item(s.answers[0].id, 'brand', 'positioning', 'stale record', SPAN_BRAND)])
      expect(r.error?.code).toBe('22023')
      expect(await candidateCount(r2)).toBe(0)
    })

    it.each(['pending', 'skipped'])(
      'a %s answer is rejected even when it still CARRIES its text — only an ANSWERED question can ground a record (the status guard, not the redaction guard)',
      async (status) => {
        const s = await extractingRound()
        // Force the state directly and KEEP answer_text: through the lifecycle RPCs a skipped or pending answer has NULL text,
        // which the redacted-answer check would reject first and mask a missing status guard.
        await pg.query('UPDATE public.founder_interview_answers SET status = $2 WHERE id = $1', [s.answers[1].id, status])
        const kept = await pg.query('SELECT answer_text FROM public.founder_interview_answers WHERE id = $1', [s.answers[1].id])
        expect(kept.rows[0].answer_text).not.toBeNull()
        const r = await write(s.roundId, [item(s.answers[1].id, 'brand', 'positioning', 'from a non-answered question', SPAN_BRAND)])
        expect(r.error?.code).toBe('22023')
        expect(r.error?.message).toMatch(/is not an answered question of round/)
        expect(await candidateCount(s.roundId)).toBe(0)
      },
    )

    it('an unknown round is not_found (never an exception), and a payload cannot name a business at all', async () => {
      const r = await rpc('write_interview_candidates', { p_round_id: '00000000-0000-4000-8000-0000000000cc', p_items: { items: [], counters: counters(0) } })
      expect(r.error).toBeNull()
      expect(r.data).toEqual({ outcome: 'not_found' })
      const s = await extractingRound()
      const named = await rpc('write_interview_candidates', { p_round_id: s.roundId, p_business_id: s.businessId, p_items: { items: [], counters: counters(0) } })
      expect(named.error).not.toBeNull() // PostgREST: no function with that argument list
    })
  })

  // ─── INTERVIEW-GROUNDED (8), Tier-1 half ────────────────────────────────────

  describe('INTERVIEW-GROUNDED — SQL re-checks grounding on RAW text', () => {
    it('a span NOT contained in its answer is rejected with 22023 and NOTHING is written (the whole call rolls back)', async () => {
      const s = await extractingRound()
      const r = await write(s.roundId, [
        item(s.answers[0].id, 'brand', 'positioning', 'a fine record', SPAN_BRAND),
        item(s.answers[0].id, 'brand', 'pricing', 'an invented record', 'We are SOC 2 certified and always have been'),
      ])
      expect(r.error?.code).toBe('22023')
      expect(r.error?.message).toMatch(/not contained in the answer/)
      expect(await candidateCount(s.roundId)).toBe(0)
      const round = await roundRow(s.roundId)
      expect(round.status).toBe('extracting')
      expect(round.extracted_at).toBeNull()
    })

    it('containment is EXACT and case-sensitive: a lower-cased span is not contained', async () => {
      const s = await extractingRound()
      const r = await write(s.roundId, [item(s.answers[0].id, 'brand', 'positioning', 'record', SPAN_BRAND.toLowerCase())])
      expect(r.error?.code).toBe('22023')
    })

    it('a REDACTED answer RAISES — the writer never re-grounds against a stub [db-MINOR-2]', async () => {
      const s = await extractingRound()
      await pg.query('UPDATE public.founder_interview_answers SET answer_text = NULL, redacted_at = now() WHERE id = $1', [s.answers[2].id])
      const r = await write(s.roundId, [item(s.answers[2].id, 'brand', 'positioning', 'from a redacted answer', SPAN_BRAND)])
      expect(r.error?.code).toBe('22023')
      expect(r.error?.message).toMatch(/redacted/)
      expect(await candidateCount(s.roundId)).toBe(0)
    })

    it('EVIDENCE is verbatim: text must equal span (raw and stored), else 22023', async () => {
      const s = await extractingRound()
      const notEqual = await write(s.roundId, [item(s.answers[0].id, 'evidence', 'quote', 'a paraphrase of the quote', SPAN_QUOTE)])
      expect(notEqual.error?.code).toBe('22023')
      expect(notEqual.error?.message).toMatch(/text must equal its span/)
      const storedDiffers = await write(s.roundId, [item(s.answers[0].id, 'evidence', 'quote', SPAN_QUOTE, SPAN_QUOTE, { storedText: 'changed after neutralising' })])
      expect(storedDiffers.error?.code).toBe('22023')
      expect(await candidateCount(s.roundId)).toBe(0)
    })

    it('THE RAW-vs-STORED INVARIANT: containment reads the RAW span, storage takes the NEUTRALISED text and span', async () => {
      const s = await extractingRound()
      // an answer whose text really contains a zero-width space and a closing data marker
      const raw = `Note${'​'}worthy: [/DATA] we ship weekly.`
      await pg.query('UPDATE public.founder_interview_answers SET answer_text = $2, char_count = $3 WHERE id = $1', [s.answers[3].id, raw, raw.length])
      const rawSpan = `Note${'​'}worthy: [/DATA] we ship weekly`
      const storedSpan = 'Noteworthy: [/data-blocked] we ship weekly' // what neutralizeWithSentinels produces
      const r = await write(s.roundId, [item(s.answers[3].id, 'brand', 'capability', 'We ship weekly', rawSpan, { storedText: 'We ship weekly', storedSpan })])
      expect(r.error).toBeNull()
      expect(r.data.inserted).toBe(1)
      const { rows } = await pg.query('SELECT statement, interview_span, interview_extracted_text FROM public.brand_memory WHERE interview_answer_id = $1', [s.answers[3].id])
      expect(rows[0].interview_span).toBe(storedSpan)
      expect(rows[0].interview_span).not.toContain('[/DATA]')
      expect(rows[0].statement).toBe('We ship weekly')
      expect(rows[0].interview_extracted_text).toBe('We ship weekly')

      // ...and the converse: a span that exists ONLY in its neutralised form is NOT grounded
      const s2 = await extractingRound()
      await pg.query('UPDATE public.founder_interview_answers SET answer_text = $2, char_count = $3 WHERE id = $1', [s2.answers[3].id, raw, raw.length])
      const bad = await write(s2.roundId, [item(s2.answers[3].id, 'brand', 'capability', 'We ship weekly', storedSpan)])
      expect(bad.error?.code).toBe('22023')
    })

    it('lengths: brand/audience text <= 280, evidence text <= 500, span <= 500 — raw AND stored — and blank is not a record', async () => {
      const s = await extractingRound()
      const long = 'x'.repeat(281)
      const cases: [string, Item][] = [
        ['281-char brand text', item(s.answers[0].id, 'brand', 'positioning', long, SPAN_BRAND)],
        ['281-char audience text', item(s.answers[0].id, 'audience', 'problem', long, SPAN_AUDIENCE)],
        ['stored text longer than raw', item(s.answers[0].id, 'brand', 'positioning', 'fine', SPAN_BRAND, { storedText: long })],
        ['stored span longer than 500', item(s.answers[0].id, 'brand', 'positioning', 'fine', SPAN_BRAND, { storedSpan: 'y'.repeat(501) })],
        ['blank text', item(s.answers[0].id, 'brand', 'positioning', '   ', SPAN_BRAND)],
        ['blank span', item(s.answers[0].id, 'brand', 'positioning', 'fine', '  ')],
      ]
      for (const [label, it] of cases) {
        const r = await write(s.roundId, [it])
        expect(r.error?.code, label).toBe('22023')
      }
      expect(await candidateCount(s.roundId)).toBe(0)
      // exactly at the bounds is accepted
      const long280 = 'a'.repeat(280)
      const ok = await write(s.roundId, [item(s.answers[0].id, 'brand', 'positioning', long280, SPAN_BRAND)])
      expect(ok.error).toBeNull()
    })

    it('a 501-character span and a 501-character evidence text are rejected, 500 is accepted', async () => {
      const s = await extractingRound()
      const span501 = 'z'.repeat(501)
      const span500 = 'z'.repeat(500)
      await pg.query('UPDATE public.founder_interview_answers SET answer_text = $2, char_count = $3 WHERE id = $1', [s.answers[0].id, `start ${span501} end`, span501.length + 10])
      const tooLong = await write(s.roundId, [item(s.answers[0].id, 'evidence', 'quote', span501, span501)])
      expect(tooLong.error?.code).toBe('22023')
      const exact = await write(s.roundId, [item(s.answers[0].id, 'evidence', 'quote', span500, span500)])
      expect(exact.error).toBeNull()
    })

    it("an unknown type, or a category outside THAT type's enum, is rejected", async () => {
      const s = await extractingRound()
      for (const [type, cat] of [['performance', 'topic'], ['brand', 'problem'], ['audience', 'quote'], ['evidence', 'positioning'], ['brand', '']] as [string, string][]) {
        const r = await write(s.roundId, [item(s.answers[0].id, type, cat, 'record', SPAN_BRAND)])
        expect(r.error?.code, `${type}/${cat}`).toBe('22023')
      }
      expect(await candidateCount(s.roundId)).toBe(0)
    })
  })

  // ─── bounds: 3 per answer, 24 per round ─────────────────────────────────────

  describe('bounds', () => {
    it('FOUR items for one answer are rejected; three are accepted', async () => {
      const s = await extractingRound()
      const four = [
        item(s.answers[0].id, 'brand', 'positioning', 'record 0', SPAN_BRAND),
        item(s.answers[0].id, 'audience', 'problem', 'record 1', SPAN_AUDIENCE),
        item(s.answers[0].id, 'evidence', 'quote', SPAN_QUOTE, SPAN_QUOTE),
        item(s.answers[0].id, 'brand', 'pricing', 'record 3', SPAN_PRICING),
      ]
      const r = await write(s.roundId, four)
      expect(r.error?.code).toBe('22023')
      expect(r.error?.message).toMatch(/at most 3 items per answer/)
      expect(await candidateCount(s.roundId)).toBe(0)
      expect((await write(s.roundId, four.slice(0, 3))).error).toBeNull()
    })

    it('25 items for one round are rejected (the cap is 24, checked before anything is read)', async () => {
      const s = await extractingRound()
      const many = Array.from({ length: 25 }, (_, i) => item(s.answers[i % 5].id, 'brand', 'positioning', `record ${i}`, SPAN_BRAND))
      const r = await write(s.roundId, many, counters(25))
      expect(r.error?.code).toBe('22023')
      expect(r.error?.message).toMatch(/at most 24 items/)
      expect(await candidateCount(s.roundId)).toBe(0)
    })

    it('malformed envelopes RAISE 22023: a bare array, missing or non-integer counters, proposed below the items written, a malformed item', async () => {
      const s = await extractingRound()
      const good = item(s.answers[0].id, 'brand', 'positioning', 'record', SPAN_BRAND)
      const bad: unknown[] = [
        [good], // the bare array the ADR sketches: this writer needs the counters, so it is an object
        { items: [good] },
        { items: [good], counters: { proposed: 'many', droppedUngrounded: 0, droppedPerformanceClaim: 0 } },
        { items: [good], counters: { proposed: -1, droppedUngrounded: 0, droppedPerformanceClaim: 0 } },
        { items: [good, { ...good, text: 'second' }], counters: counters(1) },
        { items: [{ ...good, answerId: 'not-a-uuid' }], counters: counters(1) },
        { items: [{ answerId: good.answerId, type: 'brand' }], counters: counters(1) },
        { items: 'nope', counters: counters(0) },
        null,
      ]
      for (const p of bad) {
        const r = await rpc('write_interview_candidates', { p_round_id: s.roundId, p_items: p })
        expect(r.error?.code, JSON.stringify(p).slice(0, 80)).toBe('22023')
      }
      expect(await candidateCount(s.roundId)).toBe(0)
    })
  })

  // ─── the round: state guard, no_records, counters ───────────────────────────

  describe('the round flip and the yield counters', () => {
    it.each(['open', 'submitted', 'extraction_failed', 'awaiting_ratification', 'ratified', 'skipped', 'expired', 'failed', 'no_records'])(
      "a round that is '%s' (not extracting) writes NOTHING",
      async (status) => {
        const s = await extractingRound()
        await pg.query('UPDATE public.founder_interview_rounds SET status = $2 WHERE id = $1', [s.roundId, status])
        const r = await write(s.roundId, [item(s.answers[0].id, 'brand', 'positioning', 'record', SPAN_BRAND)])
        expect(r.error).toBeNull()
        expect(r.data).toEqual({ outcome: 'not_extracting', status })
        expect(await candidateCount(s.roundId)).toBe(0)
        expect((await roundRow(s.roundId)).status).toBe(status)
      },
    )

    it("ZERO valid items flips the round to 'no_records' (terminal) and records the dropped counts", async () => {
      const s = await extractingRound()
      const r = await write(s.roundId, [], counters(3, 2, 1))
      expect(r.error).toBeNull()
      expect(r.data).toEqual({ outcome: 'written', status: 'no_records', inserted: 0, candidates: { brand: 0, audience: 0, evidence: 0 } })
      const round = await roundRow(s.roundId)
      expect(round).toMatchObject({
        status: 'no_records',
        items_proposed: 3,
        dropped_ungrounded: 2,
        dropped_performance_claim: 1,
        candidates_written_brand: 0,
        candidates_written_audience: 0,
        candidates_written_evidence: 0,
      })
      expect(round.terminal_at).not.toBeNull()
      expect(round.extracted_at).not.toBeNull()
    })

    it("a write with candidates flips to 'awaiting_ratification' with the counters, and terminal_at stays NULL", async () => {
      const s = await extractingRound()
      const r = await write(
        s.roundId,
        [
          item(s.answers[0].id, 'brand', 'positioning', 'Brand one', SPAN_BRAND),
          item(s.answers[1].id, 'brand', 'pricing', 'Brand two', SPAN_PRICING),
          item(s.answers[1].id, 'audience', 'objection', 'Audience one', SPAN_AUDIENCE),
          item(s.answers[2].id, 'evidence', 'usage_data', SPAN_USAGE, SPAN_USAGE),
        ],
        counters(7, 2, 1),
      )
      expect(r.data).toEqual({ outcome: 'written', status: 'awaiting_ratification', inserted: 4, candidates: { brand: 2, audience: 1, evidence: 1 } })
      const round = await roundRow(s.roundId)
      expect(round).toMatchObject({
        status: 'awaiting_ratification',
        items_proposed: 7,
        dropped_ungrounded: 2,
        dropped_performance_claim: 1,
        candidates_written_brand: 2,
        candidates_written_audience: 1,
        candidates_written_evidence: 1,
        terminal_at: null,
      })
    })

    it("another round's candidates are never counted in this round's counters (recomputed per round)", async () => {
      const a = await extractingRound()
      const b = await extractingRound()
      await write(a.roundId, [item(a.answers[0].id, 'brand', 'positioning', 'A record', SPAN_BRAND)])
      await write(b.roundId, [item(b.answers[0].id, 'audience', 'problem', 'B record', SPAN_AUDIENCE)])
      expect(await roundRow(a.roundId)).toMatchObject({ candidates_written_brand: 1, candidates_written_audience: 0 })
      expect(await roundRow(b.roundId)).toMatchObject({ candidates_written_brand: 0, candidates_written_audience: 1 })
    })
  })

  // ─── INTERVIEW-RATIFY-BEFORE-ACTIVE (9) and INTERVIEW-EVIDENCE-PERMISSION-OFF (20) ─

  describe('INTERVIEW-RATIFY-BEFORE-ACTIVE and INTERVIEW-EVIDENCE-PERMISSION-OFF', () => {
    it('EVERY written row is a candidate; every evidence row has public_use_permission = false; retrieval returns NONE of them', async () => {
      const { listBrandMemoryCandidates } = await import('@/lib/db/memory-brand')
      const { listEvidenceMemoryCandidates } = await import('@/lib/db/memory-evidence')
      const { listAudienceMemoryCandidates } = await import('@/lib/db/memory-audience')
      const s = await extractingRound()
      await write(
        s.roundId,
        [
          item(s.answers[0].id, 'brand', 'positioning', 'Brand candidate', SPAN_BRAND),
          item(s.answers[0].id, 'audience', 'objection', 'Audience candidate', SPAN_AUDIENCE),
          item(s.answers[0].id, 'evidence', 'quote', SPAN_QUOTE, SPAN_QUOTE),
          item(s.answers[1].id, 'evidence', 'usage_data', SPAN_USAGE, SPAN_USAGE),
        ],
        counters(4),
      )
      for (const t of ['brand_memory', 'audience_memory', 'evidence_memory']) {
        const { rows } = await pg.query<{ status: string }>(`SELECT status FROM public.${t} WHERE business_id = $1`, [s.businessId])
        expect(rows.length, t).toBeGreaterThan(0)
        expect(rows.every((r) => r.status === 'candidate'), `${t} holds a non-candidate`).toBe(true)
      }
      const { rows: ev } = await pg.query<{ public_use_permission: boolean }>('SELECT public_use_permission FROM public.evidence_memory WHERE business_id = $1', [s.businessId])
      expect(ev).toHaveLength(2)
      expect(ev.every((r) => r.public_use_permission === false)).toBe(true)

      // retrieval reads ACTIVE only: none of the candidates is visible...
      expect(await listBrandMemoryCandidates(admin, s.businessId)).toEqual([])
      expect(await listEvidenceMemoryCandidates(admin, s.businessId)).toEqual([])
      expect(await listAudienceMemoryCandidates(admin, s.businessId)).toEqual([])
      // ...and the reader is not vacuous: an ACTIVE row IS returned (positive control)
      await pg.query(
        "INSERT INTO public.brand_memory (business_id, source, scope, category, statement, status) VALUES ($1, 'manual', 'brand', 'positioning', 'An active control row', 'active')",
        [s.businessId],
      )
      const visible = await listBrandMemoryCandidates(admin, s.businessId)
      expect(visible.map((r: { statement: string }) => r.statement)).toEqual(['An active control row'])
    })

    it('provenance on every row: source interview, the answer pointer, the span, the extracted text, not edited', async () => {
      const s = await extractingRound()
      await write(s.roundId, [item(s.answers[4].id, 'brand', 'positioning', 'Provenance record', SPAN_BRAND)])
      const { rows } = await pg.query('SELECT source, interview_answer_id, interview_span, interview_extracted_text, statement, interview_edited FROM public.brand_memory WHERE business_id = $1', [s.businessId])
      expect(rows).toEqual([
        { source: 'interview', interview_answer_id: s.answers[4].id, interview_span: SPAN_BRAND, interview_extracted_text: 'Provenance record', statement: 'Provenance record', interview_edited: false },
      ])
    })
  })

  // ─── INTERVIEW-RETRY-IDEMPOTENT (31) ────────────────────────────────────────

  describe('INTERVIEW-RETRY-IDEMPOTENT', () => {
    it('a SECOND identical call inserts nothing and does not re-flip the round (it is no longer extracting)', async () => {
      const s = await extractingRound()
      const items = [item(s.answers[0].id, 'brand', 'positioning', 'Once only', SPAN_BRAND), item(s.answers[0].id, 'audience', 'problem', 'Also once', SPAN_AUDIENCE)]
      const first = await write(s.roundId, items, counters(5, 3, 0))
      expect(first.data.inserted).toBe(2)
      const before = await roundRow(s.roundId)
      const second = await write(s.roundId, items, counters(9, 9, 9))
      expect(second.data).toEqual({ outcome: 'not_extracting', status: 'awaiting_ratification' })
      expect(await candidateCount(s.roundId)).toBe(2)
      expect(await roundRow(s.roundId)).toEqual(before) // counters, extracted_at and updated_at untouched by the second call
    })

    it("a RETRY of a round put back to 'extracting' inserts NOTHING new (ON CONFLICT DO NOTHING) and does NOT flip it to no_records — the candidates it already holds count", async () => {
      const s = await extractingRound()
      const items = [item(s.answers[0].id, 'brand', 'positioning', 'Survives the retry', SPAN_BRAND)]
      expect((await write(s.roundId, items)).data.inserted).toBe(1)
      // simulate a stuck retry: the round is extracting again with its candidates in place
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'extracting', extracted_at = NULL WHERE id = $1", [s.roundId])
      const retry = await write(s.roundId, items)
      expect(retry.data).toEqual({ outcome: 'written', status: 'awaiting_ratification', inserted: 0, candidates: { brand: 1, audience: 0, evidence: 0 } })
      expect(await candidateCount(s.roundId)).toBe(1)
      expect(await roundRow(s.roundId)).toMatchObject({ status: 'awaiting_ratification', candidates_written_brand: 1 })
    })

    it('duplicates WITHIN one call collapse: the same answer, category and (case-insensitive) statement is written once', async () => {
      const s = await extractingRound()
      const r = await write(s.roundId, [
        item(s.answers[0].id, 'brand', 'positioning', 'Duplicate statement', SPAN_BRAND),
        item(s.answers[0].id, 'brand', 'positioning', 'DUPLICATE STATEMENT', SPAN_BRAND),
      ])
      expect(r.data.inserted).toBe(1)
      expect(await candidateCount(s.roundId)).toBe(1)
      // a different category is NOT a duplicate (the dedupe key carries the type column)
      const s2 = await extractingRound()
      const r2 = await write(s2.roundId, [
        item(s2.answers[0].id, 'brand', 'positioning', 'Same words', SPAN_BRAND),
        item(s2.answers[0].id, 'brand', 'capability', 'Same words', SPAN_BRAND),
      ])
      expect(r2.data.inserted).toBe(2)
    })

    it('the whole call is ATOMIC: a valid item followed by an invalid one writes neither', async () => {
      const s = await extractingRound()
      const r = await write(s.roundId, [
        item(s.answers[0].id, 'brand', 'positioning', 'valid', SPAN_BRAND),
        item(s.answers[1].id, 'audience', 'problem', 'invalid', 'a span that is nowhere in the answer'),
      ])
      expect(r.error?.code).toBe('22023')
      expect(await candidateCount(s.roundId)).toBe(0)
      expect((await roundRow(s.roundId)).status).toBe('extracting')
    })
  })
})
