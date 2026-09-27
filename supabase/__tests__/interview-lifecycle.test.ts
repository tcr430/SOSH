import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0029 §5.1, §5.2, §5.8, §7.2, §9.2 — INTERVIEW-COST-CEILING (30), the Tier-1 half of
// INTERVIEW-ANSWER-AUTHORISED (12) and the RPC half of INTERVIEW-QUESTIONS-BOUNDED (15). Live Postgres.
//
// The lifecycle RPCs are the ONLY write path onto founder_interview_rounds / _answers, granted to
// service_role alone. They are called here through the service-role client (as the Server Actions do,
// with a p_user_id read from getUser()); authorisation is proved against real business_members rows:
// a non-member, a viewer and a REVOKED editor each RAISE 42501, an editor and the owner (approver) are
// admitted, and a member of business A can never act on business B's rows (no RPC trusts a business id).
//
// The reservation (claim_interview_extraction) is proved as ONE conditional UPDATE: a fourth attempt, a
// reservation over the 30-cent ceiling and a fresh 'extracting' claim are refused with a TYPED outcome
// and change nothing; a claim older than 10 minutes is admitted; two REAL CONCURRENT connections claiming
// one round yield exactly one claim.

const PASSWORD = 'TestPass123!'

const GOOD_QUESTIONS = (n: number, bankVersion = 1) => {
  const slots: [string, string][] = [
    ['brand', 'positioning'],
    ['brand', 'capability'],
    ['brand', 'competitor'],
    ['audience', 'objection'],
    ['audience', 'problem'],
    ['audience', 'question'],
    ['evidence', 'case_study'],
    ['evidence', 'usage_data'],
    ['audience', 'trigger'],
  ]
  return Array.from({ length: n }, (_, i) => ({
    questionKey: `q-${i + 1}`,
    slotType: slots[i % slots.length][0],
    slotCategory: slots[i % slots.length][1],
    bankVersion,
  }))
}

describe('founder-interview lifecycle RPCs (ADR 0029 §5, §7.2, §9.2)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(label: string): Promise<string> {
    const email = `intw-life-${label}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return data.user.id as string
  }

  type World = { businessId: string; owner: string; editor: string; viewer: string; revoked: string; stranger: string }

  async function newWorld(): Promise<World> {
    const owner = await newUser('owner')
    const editor = await newUser('editor')
    const viewer = await newUser('viewer')
    const revoked = await newUser('revoked')
    const stranger = await newUser('stranger')
    const { data: biz, error } = await admin
      .from('businesses')
      .insert({ name: `Interview Lifecycle ${seq}`, owner_id: owner, plan: 'plus' })
      .select('id')
      .single()
    if (error) throw error
    const businessId = biz.id as string
    businessIds.push(businessId)
    for (const [user, role, status] of [
      [editor, 'editor', 'active'],
      [viewer, 'viewer', 'active'],
      [revoked, 'editor', 'revoked'],
    ] as [string, string, string][]) {
      await pg.query(
        `INSERT INTO public.business_members (business_id, user_id, email, role, status, accepted_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [businessId, user, `m-${user}@integration.test`, role, status],
      )
    }
    return { businessId, owner, editor, viewer, revoked, stranger }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args)
    return { data, error }
  }

  async function createRound(w: World, n = 5, user = w.owner) {
    const { data, error } = await rpc('create_interview_round', { p_user_id: user, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(n) })
    if (error) throw error
    expect(data.outcome).toBe('ok')
    return data.roundId as string
  }

  async function answersOf(roundId: string) {
    const { rows } = await pg.query<{ id: string; position: number; status: string; answer_text: string | null }>(
      'SELECT id, position, status, answer_text FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position',
      [roundId],
    )
    return rows
  }

  async function roundRow(roundId: string) {
    const { rows } = await pg.query<{
      status: string
      spend_cents: number
      extraction_attempts: number
      claimed_at: string | null
      error_code: string | null
      terminal_at: string | null
      submitted_at: string | null
    }>('SELECT status, spend_cents, extraction_attempts, claimed_at, error_code, terminal_at, submitted_at FROM public.founder_interview_rounds WHERE id = $1', [roundId])
    return rows[0]
  }

  async function countRounds(businessId: string) {
    const { rows } = await pg.query<{ n: string }>('SELECT count(*)::text AS n FROM public.founder_interview_rounds WHERE business_id = $1', [businessId])
    return Number(rows[0].n)
  }

  // A submitted round ready to be claimed.
  async function submittedRound(w: World) {
    const roundId = await createRound(w)
    const [first] = await answersOf(roundId)
    await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'we think we are fast' })
    const sub = await rpc('submit_interview_round', { p_user_id: w.owner, p_round_id: roundId })
    expect(sub.data.outcome).toBe('ok')
    return roundId
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  // This file creates ~200 users (five per world), so a sequential cleanup outran vitest's 10 s default hook timeout on a
  // slow run (Session 35 M2.5: every test passed, then afterAll timed out and failed the suite). Businesses first (one
  // statement each, cascading everything), then users in concurrent batches, under an explicit generous timeout.
  afterAll(async () => {
    for (const id of businessIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
    for (let i = 0; i < userIds.length; i += 20) {
      await Promise.all(userIds.slice(i, i + 20).map((id) => admin.auth.admin.deleteUser(id)))
    }
    await pg.end()
  }, 180_000)

  // ─── INTERVIEW-ANSWER-AUTHORISED (12), Tier-1 half ──────────────────────────

  describe('INTERVIEW-ANSWER-AUTHORISED — authorisation is enforced INSIDE the RPCs', () => {
    it.each(['stranger', 'viewer', 'revoked'] as const)('a %s p_user_id RAISES 42501 on create, save, skip, submit and snooze, and NOTHING changes', async (who) => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first, second] = await answersOf(roundId)
      const user = w[who]

      const created = await rpc('create_interview_round', { p_user_id: user, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(created.error?.code).toBe('42501')
      const saved = await rpc('save_interview_answer', { p_user_id: user, p_answer_id: first.id, p_text: 'x' })
      expect(saved.error?.code).toBe('42501')
      const skipA = await rpc('skip_interview_answer', { p_user_id: user, p_answer_id: second.id })
      expect(skipA.error?.code).toBe('42501')
      const submitted = await rpc('submit_interview_round', { p_user_id: user, p_round_id: roundId })
      expect(submitted.error?.code).toBe('42501')
      const skipR = await rpc('skip_interview_round', { p_user_id: user, p_round_id: roundId })
      expect(skipR.error?.code).toBe('42501')
      const snoozed = await rpc('snooze_interview', { p_user_id: user, p_business_id: w.businessId })
      expect(snoozed.error?.code).toBe('42501')

      expect((await roundRow(roundId)).status).toBe('open')
      expect(await countRounds(w.businessId)).toBe(1)
      expect((await answersOf(roundId)).every((a) => a.status === 'pending' && a.answer_text === null)).toBe(true)
      const { rows } = await pg.query('SELECT interview_snoozed_until FROM public.businesses WHERE id = $1', [w.businessId])
      expect(rows[0].interview_snoozed_until).toBeNull()
    })

    it.each(['editor', 'owner'] as const)('a %s (author-level) is ADMITTED: create, save, submit, snooze', async (who) => {
      const w = await newWorld()
      const roundId = await createRound(w, 5, w[who])
      const [first] = await answersOf(roundId)
      const saved = await rpc('save_interview_answer', { p_user_id: w[who], p_answer_id: first.id, p_text: 'a real answer' })
      expect(saved.error).toBeNull()
      expect(saved.data.outcome).toBe('ok')
      const submitted = await rpc('submit_interview_round', { p_user_id: w[who], p_round_id: roundId })
      expect(submitted.data.outcome).toBe('ok')
      const snoozed = await rpc('snooze_interview', { p_user_id: w[who], p_business_id: w.businessId })
      expect(snoozed.data.outcome).toBe('ok')
    })

    it('a NULL p_user_id RAISES 42501 (no membership can match it)', async () => {
      const w = await newWorld()
      const r = await rpc('create_interview_round', { p_user_id: null, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(r.error?.code).toBe('42501')
    })

    it('NO RPC TRUSTS A BUSINESS ID: an editor of business A cannot create for, or act on rows of, business B', async () => {
      const a = await newWorld()
      const b = await newWorld()
      const roundB = await createRound(b)
      const [answerB] = await answersOf(roundB)

      // create with B's id: the caller must be a member of THE BUSINESS NAMED, not of some business.
      const create = await rpc('create_interview_round', { p_user_id: a.editor, p_business_id: b.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(create.error?.code).toBe('42501')
      // every other RPC derives the business from the row, so A's editor cannot touch B's row
      expect((await rpc('save_interview_answer', { p_user_id: a.editor, p_answer_id: answerB.id, p_text: 'hijack' })).error?.code).toBe('42501')
      expect((await rpc('skip_interview_answer', { p_user_id: a.editor, p_answer_id: answerB.id })).error?.code).toBe('42501')
      expect((await rpc('submit_interview_round', { p_user_id: a.editor, p_round_id: roundB })).error?.code).toBe('42501')
      expect((await rpc('skip_interview_round', { p_user_id: a.editor, p_round_id: roundB })).error?.code).toBe('42501')
      expect((await rpc('snooze_interview', { p_user_id: a.editor, p_business_id: b.businessId })).error?.code).toBe('42501')
      expect((await answersOf(roundB))[0].answer_text).toBeNull()
      expect((await roundRow(roundB)).status).toBe('open')
    })
  })

  // ─── create_interview_round — INTERVIEW-QUESTIONS-BOUNDED (15), RPC half ────

  describe('create_interview_round', () => {
    it.each([0, 4, 9, 12])('%s questions RAISE 22023 and write nothing', async (n) => {
      const w = await newWorld()
      const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(n) })
      expect(r.error?.code).toBe('22023')
      expect(await countRounds(w.businessId)).toBe(0)
    })

    it.each([5, 8])('%s questions are accepted: one open round, n pending answers at positions 1..n, the round bank_version, created_by', async (n) => {
      const w = await newWorld()
      const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(n, 3) })
      expect(r.data.outcome).toBe('ok')
      const round = await pg.query('SELECT status, question_count, bank_version, created_by, spend_cents, extraction_attempts, ceiling_cents FROM public.founder_interview_rounds WHERE id = $1', [r.data.roundId])
      expect(round.rows[0]).toEqual({ status: 'open', question_count: n, bank_version: 3, created_by: w.owner, spend_cents: 0, extraction_attempts: 0, ceiling_cents: 30 })
      const answers = await pg.query('SELECT position, question_key, slot_type, slot_category, bank_version, status FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [r.data.roundId])
      expect(answers.rows).toHaveLength(n)
      expect(answers.rows.map((a) => a.position)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
      expect(answers.rows.map((a) => a.question_key)).toEqual(GOOD_QUESTIONS(n).map((q) => q.questionKey))
      expect(answers.rows.every((a) => a.status === 'pending' && a.bank_version === 3)).toBe(true)
    })

    it('a round created inside the last 30 days — ANY status — is refused with too_soon (the 30-day re-check)', async () => {
      const w = await newWorld()
      const first = await createRound(w)
      // still open -> too_soon (30-day rule reached before the open-round guard)
      expect((await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })).data.outcome).toBe('too_soon')
      // terminal (skipped) but recent -> still too_soon
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'skipped', terminal_at = now() WHERE id = $1", [first])
      expect((await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })).data.outcome).toBe('too_soon')
      expect(await countRounds(w.businessId)).toBe(1)
      // 31 days old and terminal -> a new round IS created
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '31 days' WHERE id = $1", [first])
      expect((await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })).data.outcome).toBe('ok')
      // 29 days old is still inside the window
      const w2 = await newWorld()
      const old = await createRound(w2)
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'ratified', created_at = now() - interval '29 days' WHERE id = $1", [old])
      expect((await rpc('create_interview_round', { p_user_id: w2.owner, p_business_id: w2.businessId, p_questions: GOOD_QUESTIONS(5) })).data.outcome).toBe('too_soon')
    })

    it('an OLD round that is still non-terminal blocks a new one with round_open (the partial UNIQUE, surfaced as a typed outcome)', async () => {
      const w = await newWorld()
      const stale = await createRound(w)
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [stale])
      const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(r.error).toBeNull()
      expect(r.data.outcome).toBe('round_open')
      expect(await countRounds(w.businessId)).toBe(1)
    })

    it('two CONCURRENT creates for one business produce exactly one round', async () => {
      const w = await newWorld()
      const results = await Promise.all(
        [0, 1].map(() => rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })),
      )
      const outcomes = results.map((r) => r.data?.outcome)
      expect(results.every((r) => r.error === null)).toBe(true)
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
      expect(await countRounds(w.businessId)).toBe(1)
      const { rows } = await pg.query<{ n: string }>('SELECT count(*)::text AS n FROM public.founder_interview_answers WHERE business_id = $1', [w.businessId])
      expect(Number(rows[0].n)).toBe(5)
    })

    it('malformed questions RAISE 22023: duplicate keys, mixed bank versions, a missing field, a non-array — and write nothing', async () => {
      const w = await newWorld()
      const dup = GOOD_QUESTIONS(5)
      dup[1].questionKey = dup[0].questionKey
      const mixed = GOOD_QUESTIONS(5)
      mixed[2].bankVersion = 2
      const missing = GOOD_QUESTIONS(5).map((q, i) => (i === 0 ? { questionKey: q.questionKey, slotType: q.slotType, bankVersion: 1 } : q))
      for (const bad of [dup, mixed, missing, { not: 'an array' }, null]) {
        const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: bad })
        expect(r.error?.code, JSON.stringify(bad)).toBe('22023')
      }
      expect(await countRounds(w.businessId)).toBe(0)
    })

    it('an unknown slot category is rejected by the column CHECK (23514), and the whole round rolls back', async () => {
      const w = await newWorld()
      const bad = GOOD_QUESTIONS(5)
      bad[3].slotCategory = 'other'
      const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: bad })
      expect(r.error?.code).toBe('23514')
      expect(await countRounds(w.businessId)).toBe(0)
    })
  })

  // ─── save_interview_answer ───────────────────────────────────────────────────

  describe('save_interview_answer', () => {
    it('ONE conditional UPDATE sets text, char_count, status answered, answered_by and answered_at; a re-save overwrites', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first] = await answersOf(roundId)
      const r = await rpc('save_interview_answer', { p_user_id: w.editor, p_answer_id: first.id, p_text: 'we ship weekly' })
      expect(r.data).toEqual({ outcome: 'ok', answerId: first.id })
      const row = await pg.query('SELECT status, answer_text, char_count, answered_by, answered_at FROM public.founder_interview_answers WHERE id = $1', [first.id])
      expect(row.rows[0]).toMatchObject({ status: 'answered', answer_text: 'we ship weekly', char_count: 14, answered_by: w.editor })
      expect(row.rows[0].answered_at).not.toBeNull()
      await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'we ship daily now' })
      const again = await pg.query('SELECT answer_text, char_count, answered_by FROM public.founder_interview_answers WHERE id = $1', [first.id])
      expect(again.rows[0]).toEqual({ answer_text: 'we ship daily now', char_count: 17, answered_by: w.owner })
    })

    it.each(['submitted', 'skipped', 'extracting', 'extraction_failed', 'awaiting_ratification', 'ratified', 'expired', 'failed', 'no_records'])(
      "a round that is '%s' (not open): save writes NOTHING and returns not_open",
      async (status) => {
        const w = await newWorld()
        const roundId = await createRound(w)
        const [first] = await answersOf(roundId)
        await pg.query('UPDATE public.founder_interview_rounds SET status = $2 WHERE id = $1', [roundId, status])
        const r = await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'too late' })
        expect(r.error).toBeNull()
        expect(r.data.outcome).toBe('not_open')
        const row = await pg.query('SELECT status, answer_text, answered_at FROM public.founder_interview_answers WHERE id = $1', [first.id])
        expect(row.rows[0]).toEqual({ status: 'pending', answer_text: null, answered_at: null })
      },
    )

    it('over 2000 characters, blank and NULL text RAISE 22023 and change nothing; exactly 2000 is accepted', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first] = await answersOf(roundId)
      for (const bad of ['x'.repeat(2001), '   ', '', null]) {
        const r = await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: bad })
        expect(r.error?.code, String(bad).slice(0, 12)).toBe('22023')
      }
      expect((await answersOf(roundId))[0].answer_text).toBeNull()
      const ok = await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'x'.repeat(2000) })
      expect(ok.data.outcome).toBe('ok')
    })

    it('an answer id that does not exist is not_found', async () => {
      const w = await newWorld()
      const r = await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: '00000000-0000-4000-8000-0000000000aa', p_text: 'x' })
      expect(r.data).toEqual({ outcome: 'not_found' })
    })
  })

  // ─── skip / submit / snooze ──────────────────────────────────────────────────

  describe('skip_interview_answer, skip_interview_round, submit_interview_round, snooze_interview', () => {
    it('skip answer: pending or answered -> skipped, the saved text is DROPPED, answered_at is the cooldown clock; a second skip is not_skippable', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first, second] = await answersOf(roundId)
      await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'some answer' })
      expect((await rpc('skip_interview_answer', { p_user_id: w.owner, p_answer_id: first.id })).data.outcome).toBe('ok')
      expect((await rpc('skip_interview_answer', { p_user_id: w.owner, p_answer_id: second.id })).data.outcome).toBe('ok')
      const rows = await pg.query('SELECT status, answer_text, char_count, answered_at FROM public.founder_interview_answers WHERE id = ANY($1::uuid[])', [[first.id, second.id]])
      for (const r of rows.rows) {
        expect(r.status).toBe('skipped')
        expect(r.answer_text).toBeNull()
        expect(r.char_count).toBeNull()
        expect(r.answered_at).not.toBeNull()
      }
      expect((await rpc('skip_interview_answer', { p_user_id: w.owner, p_answer_id: first.id })).data.outcome).toBe('not_skippable')
    })

    it('skip answer on a round that is not open is not_skippable and changes nothing', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const [, second] = await answersOf(roundId)
      expect((await rpc('skip_interview_answer', { p_user_id: w.owner, p_answer_id: second.id })).data.outcome).toBe('not_skippable')
      expect((await answersOf(roundId))[1].status).toBe('pending')
    })

    it('skip round: open -> skipped (terminal, terminal_at set), its PENDING questions are skipped, answered ones keep their answer; a second skip is not_open', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first] = await answersOf(roundId)
      await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'kept' })
      const r = await rpc('skip_interview_round', { p_user_id: w.owner, p_round_id: roundId })
      expect(r.data).toEqual({ outcome: 'ok', skippedAnswers: 4 })
      const round = await roundRow(roundId)
      expect(round.status).toBe('skipped')
      expect(round.terminal_at).not.toBeNull()
      const answers = await answersOf(roundId)
      expect(answers[0]).toMatchObject({ status: 'answered', answer_text: 'kept' })
      expect(answers.slice(1).every((a) => a.status === 'skipped')).toBe(true)
      expect((await rpc('skip_interview_round', { p_user_id: w.owner, p_round_id: roundId })).data.outcome).toBe('not_open')
    })

    it('submit: needs at least ONE answered question (no_answers), then open -> submitted with submitted_at; a second submit is not_open', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first] = await answersOf(roundId)
      expect((await rpc('submit_interview_round', { p_user_id: w.owner, p_round_id: roundId })).data.outcome).toBe('no_answers')
      expect((await roundRow(roundId)).status).toBe('open')
      await rpc('skip_interview_answer', { p_user_id: w.owner, p_answer_id: first.id })
      expect((await rpc('submit_interview_round', { p_user_id: w.owner, p_round_id: roundId })).data.outcome).toBe('no_answers')
      const [, second] = await answersOf(roundId)
      await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: second.id, p_text: 'one real answer' })
      expect((await rpc('submit_interview_round', { p_user_id: w.owner, p_round_id: roundId })).data.outcome).toBe('ok')
      const round = await roundRow(roundId)
      expect(round.status).toBe('submitted')
      expect(round.submitted_at).not.toBeNull()
      expect((await rpc('submit_interview_round', { p_user_id: w.owner, p_round_id: roundId })).data.outcome).toBe('not_open')
    })

    it('a submitted round can no longer be answered (the round is not open) — save returns not_open', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const [, second] = await answersOf(roundId)
      expect((await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: second.id, p_text: 'late' })).data.outcome).toBe('not_open')
    })

    it('snooze: sets interview_snoozed_until 7 days ahead; a repeat click while snoozed is already_snoozed and does not extend it', async () => {
      const w = await newWorld()
      const first = await rpc('snooze_interview', { p_user_id: w.owner, p_business_id: w.businessId })
      expect(first.data.outcome).toBe('ok')
      const { rows } = await pg.query<{ days: string }>(
        'SELECT round(extract(epoch FROM (interview_snoozed_until - now())) / 86400)::text AS days FROM public.businesses WHERE id = $1',
        [w.businessId],
      )
      expect(Number(rows[0].days)).toBe(7)
      const stamp = (await pg.query('SELECT interview_snoozed_until FROM public.businesses WHERE id = $1', [w.businessId])).rows[0].interview_snoozed_until
      expect((await rpc('snooze_interview', { p_user_id: w.owner, p_business_id: w.businessId })).data.outcome).toBe('already_snoozed')
      expect((await pg.query('SELECT interview_snoozed_until FROM public.businesses WHERE id = $1', [w.businessId])).rows[0].interview_snoozed_until).toEqual(stamp)
      // an EXPIRED snooze can be re-set
      await pg.query("UPDATE public.businesses SET interview_snoozed_until = now() - interval '1 minute' WHERE id = $1", [w.businessId])
      expect((await rpc('snooze_interview', { p_user_id: w.owner, p_business_id: w.businessId })).data.outcome).toBe('ok')
    })
  })

  // ─── INTERVIEW-COST-CEILING (30) — the reservation ──────────────────────────

  describe('INTERVIEW-COST-CEILING — claim_interview_extraction is ONE conditional UPDATE', () => {
    it('claims a submitted round: status extracting, +10 cents, attempt 1, claimed_at stamped', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const r = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(r.data).toEqual({ outcome: 'claimed', businessId: w.businessId, attempt: 1, spendCents: 10 })
      const row = await roundRow(roundId)
      expect(row).toMatchObject({ status: 'extracting', spend_cents: 10, extraction_attempts: 1 })
      expect(row.claimed_at).not.toBeNull()
    })

    it("refuses a FRESH 'extracting' claim with not_claimable and changes nothing", async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      const before = await roundRow(roundId)
      const second = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(second.data).toEqual({ outcome: 'not_claimable', status: 'extracting' })
      expect(await roundRow(roundId)).toEqual(before)
      // 9 minutes old is still fresh
      await pg.query("UPDATE public.founder_interview_rounds SET claimed_at = now() - interval '9 minutes' WHERE id = $1", [roundId])
      expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.outcome).toBe('not_claimable')
    })

    it("ADMITS an 'extracting' claim older than 10 minutes: a stuck claim is re-taken (attempt 2, spend 20)", async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      await pg.query("UPDATE public.founder_interview_rounds SET claimed_at = now() - interval '11 minutes' WHERE id = $1", [roundId])
      const r = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(r.data).toEqual({ outcome: 'claimed', businessId: w.businessId, attempt: 2, spendCents: 20 })
      expect(await roundRow(roundId)).toMatchObject({ status: 'extracting', spend_cents: 20, extraction_attempts: 2 })
    })

    it('refuses a FOURTH attempt with the typed outcome `attempts` and changes nothing', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      // three attempts, each a failed extraction that reconciled to a small actual cost
      for (let i = 0; i < 3; i++) {
        expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.outcome).toBe('claimed')
        const rec = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 2, p_outcome: 'failed', p_error_code: 'model_error' })
        expect(rec.data.outcome).toBe('reconciled')
      }
      // the 3rd failure ends the round ('failed'); force the retry state to prove the GUARD itself
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'extraction_failed', terminal_at = NULL WHERE id = $1", [roundId])
      const before = await roundRow(roundId)
      expect(before).toMatchObject({ extraction_attempts: 3, spend_cents: 6 })
      const fourth = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(fourth.data).toEqual({ outcome: 'attempts', attempts: 3 })
      expect(await roundRow(roundId)).toEqual(before)
    })

    it('refuses a reservation that would exceed the 30-cent ceiling with the typed outcome `ceiling` and changes nothing', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await pg.query('UPDATE public.founder_interview_rounds SET spend_cents = 21, extraction_attempts = 1 WHERE id = $1', [roundId])
      const before = await roundRow(roundId)
      const r = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(r.data).toEqual({ outcome: 'ceiling', spendCents: 21, ceilingCents: 30 })
      expect(await roundRow(roundId)).toEqual(before)
      // exactly 20 + 10 = 30 fits
      await pg.query('UPDATE public.founder_interview_rounds SET spend_cents = 20 WHERE id = $1', [roundId])
      expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data).toEqual({ outcome: 'claimed', businessId: w.businessId, attempt: 2, spendCents: 30 })
    })

    it.each(['open', 'skipped', 'awaiting_ratification', 'ratified', 'expired', 'failed', 'no_records'])("a round that is '%s' is not_claimable", async (status) => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await pg.query('UPDATE public.founder_interview_rounds SET status = $2 WHERE id = $1', [roundId, status])
      const r = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(r.data).toEqual({ outcome: 'not_claimable', status })
      expect((await roundRow(roundId)).spend_cents).toBe(0)
    })

    it('an unknown round is not_found, never a bare null', async () => {
      const r = await rpc('claim_interview_extraction', { p_round_id: '00000000-0000-4000-8000-0000000000bb' })
      expect(r.error).toBeNull()
      expect(r.data).toEqual({ outcome: 'not_found' })
    })

    it('TWO REAL CONCURRENT connections claiming one round: exactly ONE claim, spend 10, attempt 1 (the guard is atomic)', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const clients = [new Client({ connectionString: process.env.DATABASE_URL }), new Client({ connectionString: process.env.DATABASE_URL })]
      await Promise.all(clients.map((c) => c.connect()))
      try {
        const results = await Promise.all(
          clients.map((c) => c.query<{ r: { outcome: string } }>('SELECT public.claim_interview_extraction($1) AS r', [roundId])),
        )
        const outcomes = results.map((res) => res.rows[0].r.outcome).sort()
        expect(outcomes).toEqual(['claimed', 'not_claimable'])
        expect(await roundRow(roundId)).toMatchObject({ status: 'extracting', spend_cents: 10, extraction_attempts: 1 })
      } finally {
        await Promise.all(clients.map((c) => c.end()))
      }
    })
  })

  // ─── reconcile_interview_spend (SUGGESTION-7) ───────────────────────────────

  describe('reconcile_interview_spend — the actual cost replaces the reservation on EVERY outcome', () => {
    it('success: spend becomes the ACTUAL cost (reserved 10 -> 4), the round STAYS extracting, no error code', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      const r = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 4, p_outcome: 'succeeded' })
      expect(r.data).toEqual({ outcome: 'reconciled', status: 'extracting', spendCents: 4, clamped: false })
      expect(await roundRow(roundId)).toMatchObject({ status: 'extracting', spend_cents: 4, error_code: null })
    })

    it('failure: writes the ACTUAL spend too, sets extraction_failed with the error code, and the round can be claimed again', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      const r = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 7, p_outcome: 'failed', p_error_code: 'invalid_response' })
      expect(r.data).toEqual({ outcome: 'reconciled', status: 'extraction_failed', spendCents: 7, clamped: false })
      expect(await roundRow(roundId)).toMatchObject({ status: 'extraction_failed', spend_cents: 7, error_code: 'invalid_response', extraction_attempts: 1 })
      const again = await rpc('claim_interview_extraction', { p_round_id: roundId })
      expect(again.data).toEqual({ outcome: 'claimed', businessId: w.businessId, attempt: 2, spendCents: 17 })
    })

    it("the THIRD failure ends the round: status 'failed' (terminal), terminal_at set, error code kept", async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      let last
      for (let i = 0; i < 3; i++) {
        await rpc('claim_interview_extraction', { p_round_id: roundId })
        last = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 3, p_outcome: 'failed', p_error_code: 'model_error' })
      }
      expect(last?.data.status).toBe('failed')
      const row = await roundRow(roundId)
      expect(row).toMatchObject({ status: 'failed', error_code: 'model_error', extraction_attempts: 3, spend_cents: 9 })
      expect(row.terminal_at).not.toBeNull()
    })

    it('is guarded on extracting: any other status returns not_extracting and changes nothing', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const before = await roundRow(roundId)
      const r = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 5, p_outcome: 'succeeded' })
      expect(r.data).toEqual({ outcome: 'not_extracting' })
      expect(await roundRow(roundId)).toEqual(before)
    })

    it('an actual cost ABOVE the reservation is clamped to the ceiling — a failure must always be recordable', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await pg.query('UPDATE public.founder_interview_rounds SET spend_cents = 20, extraction_attempts = 1 WHERE id = $1', [roundId])
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      const r = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 90, p_outcome: 'failed', p_error_code: 'model_error' })
      expect(r.error).toBeNull()
      expect(r.data.spendCents).toBe(30)
    })

    it('malformed arguments RAISE 22023: a negative or NULL cost, an unknown outcome, a failure without a code, a success WITH a code', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      for (const args of [
        { p_actual_cents: -1, p_outcome: 'succeeded' },
        { p_actual_cents: null, p_outcome: 'succeeded' },
        { p_actual_cents: 1, p_outcome: 'maybe' },
        { p_actual_cents: 1, p_outcome: 'failed' },
        { p_actual_cents: 1, p_outcome: 'failed', p_error_code: '  ' },
        { p_actual_cents: 1, p_outcome: 'succeeded', p_error_code: 'oops' },
      ]) {
        const r = await rpc('reconcile_interview_spend', { p_round_id: roundId, ...args })
        expect(r.error?.code, JSON.stringify(args)).toBe('22023')
      }
      expect((await roundRow(roundId)).spend_cents).toBe(10)
    })
  })

  // ─── database-reviewer findings (Session 35 M2.6) ───────────────────────────

  describe('db-review MINOR-3 / MINOR-4 — reconcile is bound to an attempt, reports a clamp, and has an order contract', () => {
    it('a late reconcile from a SUPERSEDED attempt matches nothing and changes nothing; the live attempt still reconciles', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.attempt).toBe(1)
      await pg.query("UPDATE public.founder_interview_rounds SET claimed_at = now() - interval '11 minutes' WHERE id = $1", [roundId])
      expect((await rpc('claim_interview_extraction', { p_round_id: roundId })).data.attempt).toBe(2)
      const before = await roundRow(roundId)
      const stale = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 3, p_outcome: 'failed', p_error_code: 'model_error', p_attempt: 1 })
      expect(stale.data).toEqual({ outcome: 'not_extracting' })
      expect(await roundRow(roundId)).toEqual(before)
      const live = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 4, p_outcome: 'succeeded', p_attempt: 2 })
      expect(live.data).toMatchObject({ outcome: 'reconciled', status: 'extracting', spendCents: 14 })
    })

    it('a clamped spend is REPORTED: clamped is true only when the actual cost pushed the round past its ceiling', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      const ok = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 4, p_outcome: 'succeeded', p_attempt: 1 })
      expect(ok.data.clamped).toBe(false)
      const w2 = await newWorld()
      const r2 = await submittedRound(w2)
      await pg.query('UPDATE public.founder_interview_rounds SET spend_cents = 20, extraction_attempts = 1 WHERE id = $1', [r2])
      await rpc('claim_interview_extraction', { p_round_id: r2 })
      const over = await rpc('reconcile_interview_spend', { p_round_id: r2, p_actual_cents: 90, p_outcome: 'failed', p_error_code: 'model_error', p_attempt: 2 })
      expect(over.data).toMatchObject({ spendCents: 30, clamped: true })
    })

    it('ORDER CONTRACT: once the writer has moved the round out of extracting, a late reconcile is not_extracting and the reservation stays un-trued', async () => {
      const w = await newWorld()
      const roundId = await submittedRound(w)
      const claim = await rpc('claim_interview_extraction', { p_round_id: roundId })
      const counters = { proposed: 0, droppedUngrounded: 0, droppedPerformanceClaim: 0 }
      await rpc('write_interview_candidates', { p_round_id: roundId, p_items: { items: [], counters } })
      expect((await roundRow(roundId)).status).not.toBe('extracting')
      const late = await rpc('reconcile_interview_spend', { p_round_id: roundId, p_actual_cents: 4, p_outcome: 'succeeded', p_attempt: claim.data.attempt })
      expect(late.data).toEqual({ outcome: 'not_extracting' })
      expect((await roundRow(roundId)).spend_cents).toBe(10)
    })
  })

  describe('db-review MINOR-5 — save and submit serialise on the round', () => {
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function twoClients(): Promise<[Client, Client]> {
      const a = new Client({ connectionString: process.env.DATABASE_URL })
      const b = new Client({ connectionString: process.env.DATABASE_URL })
      await Promise.all([a.connect(), b.connect()])
      return [a, b]
    }

    it('a SUBMIT waits for an in-flight save and then sees its answer', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first] = await answersOf(roundId)
      const [a, b] = await twoClients()
      try {
        await a.query('BEGIN')
        await a.query('SELECT public.save_interview_answer(p_user_id => $1, p_answer_id => $2, p_text => $3)', [w.owner, first.id, 'an answer still in flight'])
        const pending = b.query('SELECT public.submit_interview_round(p_user_id => $1, p_round_id => $2) AS r', [w.owner, roundId])
        await pause(500)
        await a.query('COMMIT')
        expect((await pending).rows[0].r.outcome).toBe('ok')
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    })

    it('a SAVE waits for an in-flight submit and is then refused (not_open)', async () => {
      const w = await newWorld()
      const roundId = await createRound(w)
      const [first, second] = await answersOf(roundId)
      await rpc('save_interview_answer', { p_user_id: w.owner, p_answer_id: first.id, p_text: 'the answer that lets it submit' })
      const [a, b] = await twoClients()
      try {
        await a.query('BEGIN')
        await a.query('SELECT public.submit_interview_round(p_user_id => $1, p_round_id => $2)', [w.owner, roundId])
        const pending = b.query('SELECT public.save_interview_answer(p_user_id => $1, p_answer_id => $2, p_text => $3) AS r', [w.owner, second.id, 'a late answer'])
        await pause(500)
        await a.query('COMMIT')
        expect((await pending).rows[0].r.outcome).toBe('not_open')
        expect((await answersOf(roundId))[1].answer_text).toBeNull()
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    })
  })

  describe('db-review NIT-8 — a soft-deleted business cannot start a round', () => {
    it('create_interview_round raises 42501 for a business whose deleted_at is set', async () => {
      const w = await newWorld()
      await pg.query('UPDATE public.businesses SET deleted_at = now() WHERE id = $1', [w.businessId])
      const r = await rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(r.error?.code).toBe('42501')
      expect(await countRounds(w.businessId)).toBe(0)
    })
  })

  // ─── the grant shape and the signatures ─────────────────────────────────────

  describe('every lifecycle RPC is service_role-only and takes no governance value', () => {
    const FUNCTIONS = [
      'create_interview_round',
      'save_interview_answer',
      'skip_interview_answer',
      'skip_interview_round',
      'submit_interview_round',
      'snooze_interview',
      'claim_interview_extraction',
      'reconcile_interview_spend',
    ]

    it('EXECUTE is held by service_role and by neither anon, authenticated nor PUBLIC; each is SECURITY DEFINER with a pinned search_path', async () => {
      const { rows } = await pg.query<{ proname: string; secdef: boolean; cfg: string[] | null; oid: string }>(
        `SELECT p.proname, p.prosecdef AS secdef, p.proconfig AS cfg, p.oid::text AS oid
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY($1::text[]) ORDER BY p.proname`,
        [FUNCTIONS],
      )
      expect(rows.map((r) => r.proname)).toEqual([...FUNCTIONS].sort())
      for (const r of rows) {
        expect(r.secdef, `${r.proname} is not SECURITY DEFINER`).toBe(true)
        expect(r.cfg?.join(',') ?? '', `${r.proname} search_path`).toContain('search_path=public, pg_temp')
        for (const role of ['anon', 'authenticated']) {
          const { rows: g } = await pg.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2::oid, $3) AS ok', [role, r.oid, 'EXECUTE'])
          expect(g[0].ok, `${role} can EXECUTE ${r.proname}`).toBe(false)
        }
        const { rows: pub } = await pg.query<{ ok: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = $1::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS ok",
          [r.oid],
        )
        expect(pub[0].ok, `PUBLIC can EXECUTE ${r.proname}`).toBe(false)
        const { rows: sr } = await pg.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2::oid, $3) AS ok', ['service_role', r.oid, 'EXECUTE'])
        expect(sr[0].ok, `service_role cannot EXECUTE ${r.proname}`).toBe(true)
      }
    })

    it('a signed-in MEMBER calling an RPC directly is refused at the grant layer (42501 permission denied)', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const w = await newWorld()
      const { data: userRow } = await admin.auth.admin.getUserById(w.owner)
      const email = userRow.user.email as string
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
      expect(signInErr).toBeNull()
      const r = await client.rpc('create_interview_round', { p_user_id: w.owner, p_business_id: w.businessId, p_questions: GOOD_QUESTIONS(5) })
      expect(r.error?.code).toBe('42501')
      expect(r.error?.message).toMatch(/permission denied/i)
      expect(await countRounds(w.businessId)).toBe(0)
    })

    it('NO parameter of any lifecycle RPC is a governance value; only create and snooze take a business id (both verify membership first)', async () => {
      const GOVERNANCE = ['source', 'status', 'confidence', 'sensitivity', 'public_use_permission', 'scope', 'scope_ref', 'expires_at', 'observation_count', 'last_confirmed_at']
      const { rows } = await pg.query<{ proname: string; args: string[] | null }>(
        `SELECT p.proname, p.proargnames AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
        [FUNCTIONS],
      )
      const withBusiness: string[] = []
      for (const r of rows) {
        const names = (r.args ?? []).map((a) => a.replace(/^p_/, ''))
        for (const g of GOVERNANCE) expect(names, `${r.proname} takes a governance parameter`).not.toContain(g)
        if ((r.args ?? []).includes('p_business_id')) withBusiness.push(r.proname)
      }
      expect(withBusiness.sort()).toEqual(['create_interview_round', 'snooze_interview'])
    })
  })

  // ─── MAJOR-1 fix (Session 35-D · D3) — listInterviewCooldownRows, live Postgres ────────────────────────────
  // The Reviewer reproduced a late-sorting question key's recent answer being dropped once a business's total
  // answered/skipped row count passed ~33 (the old bank-size row-count LIMIT, ordered by question_key ASC).
  // The fix windows the read by TIME (answered_at >= now - 180d) and only THEN applies a derived row cap
  // (INTERVIEW_COOLDOWN_ROW_CAP = 56). This seeds 40 answered rows (> 33, < 56) directly — bypassing the
  // lifecycle RPCs, since this test targets the READ, not round creation — for one business, with the
  // alphabetically-LAST key answered most recently, and proves the member's own RLS client still gets it back.
  describe('MAJOR-1 fix — the cooldown read survives a >33-row history (live Postgres)', () => {
    it("returns a late-sorting key's recent row even past 33 total answered rows", async () => {
      const w = await newWorld()
      const TOTAL = 40
      const roundIds: string[] = []
      for (let r = 0; r < Math.ceil(TOTAL / 8); r++) {
        const { rows } = await pg.query<{ id: string }>(
          `INSERT INTO public.founder_interview_rounds (business_id, status, question_count, bank_version, created_by)
           VALUES ($1, 'ratified', 8, 1, $2) RETURNING id`,
          [w.businessId, w.owner],
        )
        roundIds.push(rows[0].id)
      }
      const lateKey = `interview-d3-key-${String(TOTAL - 1).padStart(3, '0')}`
      for (let i = 0; i < TOTAL; i++) {
        const roundId = roundIds[Math.floor(i / 8)]
        const position = (i % 8) + 1
        const key = `interview-d3-key-${String(i).padStart(3, '0')}`
        const daysAgo = TOTAL - i // the alphabetically-LAST key (highest i) gets the SMALLEST daysAgo
        await pg.query(
          `INSERT INTO public.founder_interview_answers
             (business_id, round_id, position, question_key, bank_version, slot_type, slot_category, status, answer_text, char_count, answered_by, answered_at)
           VALUES ($1, $2, $3, $4, 1, 'brand', 'positioning', 'answered', 'x', 1, $5, now() - ($6 || ' days')::interval)`,
          [w.businessId, roundId, position, key, w.owner, daysAgo],
        )
      }

      const { createClient } = await import('@supabase/supabase-js')
      const { data: userRow } = await admin.auth.admin.getUserById(w.owner)
      const email = userRow.user.email as string
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
      expect(signInErr).toBeNull()

      const { listInterviewCooldownRows } = await import('@/lib/db/founder-interview-answers')
      const { INTERVIEW_COOLDOWN_ROW_CAP } = await import('@/lib/interview/constants')
      const rows = await listInterviewCooldownRows(client, w.businessId, new Date(), INTERVIEW_COOLDOWN_ROW_CAP)
      expect(rows.length, 'more rows were seeded than the OLD 33-row limit').toBeGreaterThan(33)
      expect(rows.map((r) => r.question_key)).toContain(lateKey)
    })
  })
})
