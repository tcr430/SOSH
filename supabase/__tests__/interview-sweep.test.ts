import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0029 §5.4, §6.3 — INTERVIEW-RETENTION-REDACTED (36) and INTERVIEW-CANDIDATE-RETENTION (37). Live Postgres.
//
// sweep_interview_data() is the daily retention job's ONE service-role RPC. In THIS order:
//   (1) rounds stuck in extracting / extraction_failed for > 7 days -> failed
//   (2) open rounds 30 days after created_at, awaiting_ratification rounds 30 days after extracted_at -> expired,
//       their candidates retired
//   (3) answer_text (NULL + redacted_at) AND interview_span (NULL + interview_span_redacted_at) 30 days after terminal_at
//   (4) retired candidates of EXPIRED rounds deleted 30 days after their retirement (= the round's terminal_at)
//   (4b) [D4, founder ruling A-6(a)] REJECTED candidates of RATIFIED rounds deleted at terminal_at + 30 days
// It never changes the status, text or expiry of a ratified round's ACTIVE rows, and it never deletes a row a founder
// ratified (active) or a row a later round replaced. It is bounded per run and idempotent.
//
// Deadlines are LITERAL: timestamps are backdated in the fixture and each rule is asserted at deadline + 1 minute (acts) and
// deadline - 1 minute (does not). The sweep is global, so assertions are on THIS test's rows, never on global counts.

const PASSWORD = 'TestPass123!'
const answerText = (n: number) =>
  `Answer ${n}. We integrate natively with Slack and Linear. Pricing starts at 49 euros per month. Buyers keep asking about security reviews.`
const SPAN_BRAND = 'We integrate natively with Slack and Linear'
const SPAN_AUDIENCE = 'Buyers keep asking about security reviews'
const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({ questionKey: `q-${i + 1}`, slotType: 'brand', slotCategory: 'positioning', bankVersion: 1 }))

type Fixture = { businessId: string; owner: string; roundId: string; answerIds: string[]; brandId: string | null; audienceId: string | null }

describe('sweep_interview_data (ADR 0029 §5.4, §6.3)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(): Promise<string> {
    const email = `intw-sweep-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return data.user.id as string
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args)
    return { data, error }
  }
  const sweep = async () => {
    const r = await rpc('sweep_interview_data', {})
    expect(r.error).toBeNull()
    return r.data as Record<string, number>
  }

  // An OPEN round (no candidates), or — with `candidates` — a round AWAITING RATIFICATION holding a brand and an audience row.
  async function makeRound(opts: { candidates?: boolean; toStatus?: string } = {}): Promise<Fixture> {
    const owner = await newUser()
    const { data: biz, error } = await admin.from('businesses').insert({ name: `Interview Sweep ${seq}`, owner_id: owner, plan: 'plus' }).select('id').single()
    if (error) throw error
    const businessId = biz.id as string
    businessIds.push(businessId)
    const created = await rpc('create_interview_round', { p_user_id: owner, p_business_id: businessId, p_questions: QUESTIONS })
    if (created.error) throw created.error
    const roundId = created.data.roundId as string
    const { rows: ar } = await pg.query<{ id: string; position: number }>('SELECT id, position FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])
    const answerIds = ar.map((a) => a.id)
    let brandId: string | null = null
    let audienceId: string | null = null
    if (opts.candidates || opts.toStatus) {
      for (const a of ar) await rpc('save_interview_answer', { p_user_id: owner, p_answer_id: a.id, p_text: answerText(a.position) })
      await rpc('submit_interview_round', { p_user_id: owner, p_round_id: roundId })
      await rpc('claim_interview_extraction', { p_round_id: roundId })
      if (opts.candidates) {
        const items = [
          { answerId: answerIds[0], type: 'brand', category: 'positioning', text: 'Brand candidate', span: SPAN_BRAND, storedText: 'Brand candidate', storedSpan: SPAN_BRAND },
          { answerId: answerIds[1], type: 'audience', category: 'objection', text: 'Audience candidate', span: SPAN_AUDIENCE, storedText: 'Audience candidate', storedSpan: SPAN_AUDIENCE },
        ]
        const w = await rpc('write_interview_candidates', { p_round_id: roundId, p_items: { items, counters: { proposed: 2, droppedUngrounded: 0, droppedPerformanceClaim: 0 } } })
        expect(w.data.status).toBe('awaiting_ratification')
        brandId = (await pg.query<{ id: string }>('SELECT id FROM public.brand_memory WHERE business_id = $1', [businessId])).rows[0].id
        audienceId = (await pg.query<{ id: string }>('SELECT id FROM public.audience_memory WHERE business_id = $1', [businessId])).rows[0].id
      }
    }
    return { businessId, owner, roundId, answerIds, brandId, audienceId }
  }

  const setRound = (id: string, sets: string) => pg.query(`UPDATE public.founder_interview_rounds SET ${sets} WHERE id = $1`, [id])
  const round = async (id: string) => (await pg.query('SELECT * FROM public.founder_interview_rounds WHERE id = $1', [id])).rows[0]
  const memRow = async (table: string, id: string) => (await pg.query(`SELECT * FROM public.${table} WHERE id = $1`, [id])).rows[0]
  const exists = async (table: string, id: string | null) => (await pg.query(`SELECT 1 FROM public.${table} WHERE id = $1`, [id])).rowCount === 1
  const answers = async (roundId: string) => (await pg.query('SELECT * FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])).rows

  // A timestamp `days` days ago, shifted by `minutes` (negative = OLDER, i.e. past the deadline).
  const ago = (days: number, minutes: number) => `now() - interval '${days} days' + interval '${minutes} minutes'`

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
    for (let i = 0; i < userIds.length; i += 20) await Promise.all(userIds.slice(i, i + 20).map((id) => admin.auth.admin.deleteUser(id)))
    await pg.end()
  }, 180_000)

  // ─── step 1: stuck rounds ───────────────────────────────────────────────────

  describe('(1) rounds stuck in extracting / extraction_failed for more than 7 days -> failed', () => {
    it.each(['extracting', 'extraction_failed'])("a '%s' round claimed 7 days + 1 minute ago becomes failed (terminal); at 7 days - 1 minute it does not", async (status) => {
      const stuck = await makeRound({ toStatus: status })
      const fresh = await makeRound({ toStatus: status })
      await setRound(stuck.roundId, `status = '${status}', error_code = ${status === 'extraction_failed' ? "'model_error'" : 'NULL'}, claimed_at = ${ago(7, -1)}`)
      await setRound(fresh.roundId, `status = '${status}', claimed_at = ${ago(7, 1)}`)
      await sweep()
      const s = await round(stuck.roundId)
      expect(s.status).toBe('failed')
      expect(s.terminal_at).not.toBeNull()
      expect(s.error_code).toBe(status === 'extraction_failed' ? 'model_error' : 'stuck') // an existing code is kept
      expect((await round(fresh.roundId)).status).toBe(status)
    })
  })

  describe('(1) db-review MAJOR-1 — a SUBMITTED round older than 7 days (its extraction never ran) -> failed', () => {
    it('submitted 7 days + 1 minute ago becomes failed (terminal, terminal_at set) and frees the business; at 7 days - 1 minute it does not', async () => {
      const stuck = await makeRound({ toStatus: 'submitted' })
      const fresh = await makeRound({ toStatus: 'submitted' })
      await setRound(stuck.roundId, `status = 'submitted', claimed_at = NULL, submitted_at = ${ago(7, -1)}`)
      await setRound(fresh.roundId, `status = 'submitted', claimed_at = NULL, submitted_at = ${ago(7, 1)}`)
      await sweep()
      const s = await round(stuck.roundId)
      expect(s.status).toBe('failed')
      expect(s.terminal_at).not.toBeNull()
      expect(s.error_code).toBe('stuck')
      expect((await round(fresh.roundId)).status).toBe('submitted')
      // the one-open-round slot is free again: a new round may be opened once the 30-day window allows it
      await setRound(stuck.roundId, `created_at = ${ago(31, 0)}`)
      const again = await rpc('create_interview_round', { p_user_id: stuck.owner, p_business_id: stuck.businessId, p_questions: QUESTIONS })
      expect(again.data.outcome).toBe('ok')
    })

    it('a failed round becomes redactable: its answers are redacted 30 days after the sweep stamped terminal_at', async () => {
      const f = await makeRound({ toStatus: 'submitted' })
      await setRound(f.roundId, `status = 'submitted', claimed_at = NULL, submitted_at = ${ago(8, 0)}`)
      await sweep()
      await setRound(f.roundId, `terminal_at = ${ago(30, -1)}`)
      await sweep()
      for (const a of await answers(f.roundId)) expect(a.answer_text).toBeNull()
    })
  })

  // ─── step 2: expiry ─────────────────────────────────────────────────────────

  describe('(2) open rounds 30 days after created_at, awaiting_ratification rounds 30 days after extracted_at -> expired', () => {
    it('an OPEN round created 30 days + 1 minute ago expires (terminal_at set); 30 days - 1 minute does not', async () => {
      const old = await makeRound()
      const young = await makeRound()
      await setRound(old.roundId, `created_at = ${ago(30, -1)}`)
      await setRound(young.roundId, `created_at = ${ago(30, 1)}`)
      await sweep()
      expect(await round(old.roundId)).toMatchObject({ status: 'expired' })
      expect((await round(old.roundId)).terminal_at).not.toBeNull()
      expect((await round(young.roundId)).status).toBe('open')
    })

    it('an AWAITING round extracted 30 days + 1 minute ago expires and its CANDIDATES are retired; at 30 days - 1 minute nothing changes', async () => {
      const old = await makeRound({ candidates: true })
      const young = await makeRound({ candidates: true })
      await setRound(old.roundId, `extracted_at = ${ago(30, -1)}`)
      await setRound(young.roundId, `extracted_at = ${ago(30, 1)}`)
      await sweep()
      expect((await round(old.roundId)).status).toBe('expired')
      expect((await memRow('brand_memory', old.brandId as string)).status).toBe('retired')
      expect((await memRow('audience_memory', old.audienceId as string)).status).toBe('retired')
      expect((await round(young.roundId)).status).toBe('awaiting_ratification')
      expect((await memRow('brand_memory', young.brandId as string)).status).toBe('candidate')
      expect((await memRow('audience_memory', young.audienceId as string)).status).toBe('candidate')
    })

    it('the ORDER matters: a round expired in THIS run is not also redacted or deleted in this run (its 30-day clocks start now)', async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `extracted_at = ${ago(31, 0)}`)
      await sweep()
      expect((await round(f.roundId)).status).toBe('expired')
      const answered = (await answers(f.roundId)).filter((a) => a.status === 'answered')
      expect(answered.length).toBeGreaterThan(0)
      expect(answered.every((a) => a.answer_text !== null && a.redacted_at === null)).toBe(true)
      const brand = await memRow('brand_memory', f.brandId as string)
      expect(brand.status).toBe('retired') // retired, NOT deleted
      expect(brand.interview_span).not.toBeNull()
    })
  })

  // ─── step 3: redaction ──────────────────────────────────────────────────────

  describe('INTERVIEW-RETENTION-REDACTED — (3) answer_text AND interview_span are NULL 30 days after terminal_at; the stub survives', () => {
    it.each(['skipped', 'failed', 'no_records', 'ratified'])("a '%s' round 30 days + 1 minute past terminal_at: answer_text and interview_span are redacted, the stub row survives", async (status) => {
      const f = await makeRound({ candidates: true })
      const before = await answers(f.roundId)
      await setRound(f.roundId, `status = '${status}', terminal_at = ${ago(30, -1)}`)
      await sweep()
      const after = await answers(f.roundId)
      expect(after).toHaveLength(before.length)
      expect(before.filter((a) => a.answer_text !== null).length).toBe(5)
      for (const a of after) {
        expect(a.answer_text).toBeNull()
        expect(a.redacted_at).not.toBeNull()
      }
      // the STUB survives: key, position, status, char_count and answered_at are untouched
      after.forEach((a, i) => {
        expect(a.question_key).toBe(before[i].question_key)
        expect(a.position).toBe(before[i].position)
        expect(a.status).toBe(before[i].status)
        expect(a.char_count).toBe(before[i].char_count)
        expect(a.answered_at).toEqual(before[i].answered_at)
      })
      // the grounding SPAN goes on the same deadline; the RECORD text stays (only the provenance copy is removed)
      const brand = await memRow('brand_memory', f.brandId as string)
      expect(brand.interview_span).toBeNull()
      expect(brand.interview_span_redacted_at).not.toBeNull()
      expect(brand.statement).toBe('Brand candidate')
      expect(brand.interview_extracted_text).toBe('Brand candidate')
    })

    it("an 'expired' round's answers are redacted at terminal_at + 30 days too (its retired candidates are deleted in the same run)", async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'expired', terminal_at = ${ago(30, -1)}`)
      await pg.query("UPDATE public.brand_memory SET status = 'retired' WHERE id = $1", [f.brandId])
      await sweep()
      for (const a of await answers(f.roundId)) expect(a.answer_text).toBeNull()
      expect(await exists('brand_memory', f.brandId)).toBe(false)
    })

    it('at terminal_at + 30 days - 1 minute NOTHING is redacted', async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'skipped', terminal_at = ${ago(30, 1)}`)
      await sweep()
      for (const a of await answers(f.roundId)) {
        if (a.status === 'answered') expect(a.answer_text).not.toBeNull()
        expect(a.redacted_at).toBeNull()
      }
      expect((await memRow('brand_memory', f.brandId as string)).interview_span).toBe(SPAN_BRAND)
    })

    it("a RATIFIED round's ACTIVE rows are never changed except the span: status, statement, confidence, expiry and provenance are untouched", async () => {
      const f = await makeRound({ candidates: true })
      await pg.query("UPDATE public.brand_memory SET status = 'active' WHERE id = $1", [f.brandId])
      await pg.query("UPDATE public.audience_memory SET status = 'active' WHERE id = $1", [f.audienceId])
      const before = { brand: await memRow('brand_memory', f.brandId as string), audience: await memRow('audience_memory', f.audienceId as string) }
      await setRound(f.roundId, "status = 'ratified', terminal_at = now() - interval '400 days'")
      await sweep()
      for (const [table, id, b] of [['brand_memory', f.brandId, before.brand], ['audience_memory', f.audienceId, before.audience]] as const) {
        const after = await memRow(table, id as string)
        expect(after.status).toBe('active')
        expect(after.statement).toBe(b.statement)
        expect(after.confidence).toBe(b.confidence)
        expect(after.expires_at).toEqual(b.expires_at)
        expect(after.last_confirmed_at).toEqual(b.last_confirmed_at)
        expect(after.source).toBe('interview')
        expect(after.interview_answer_id).toBe(b.interview_answer_id)
        expect(after.interview_extracted_text).toBe(b.interview_extracted_text)
        expect(after.interview_span).toBeNull() // redacted with its answer
        expect(after.interview_span_redacted_at).not.toBeNull()
      }
    })

    it('redaction is one-way and idempotent: a second sweep changes nothing (the trigger forbids re-stamping)', async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'skipped', terminal_at = ${ago(31, 0)}`)
      await sweep()
      const first = { answers: await answers(f.roundId), brand: await memRow('brand_memory', f.brandId as string) }
      await sweep()
      expect(await answers(f.roundId)).toEqual(first.answers)
      expect(await memRow('brand_memory', f.brandId as string)).toEqual(first.brand)
    })
  })

  // ─── step 4: candidate retention ────────────────────────────────────────────

  describe('INTERVIEW-CANDIDATE-RETENTION — (4) retired candidates of EXPIRED rounds are deleted 30 days after retirement', () => {
    async function expiredWithRetired(minutesPastDeadline: number) {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'expired', terminal_at = ${ago(30, -minutesPastDeadline)}`)
      await pg.query("UPDATE public.brand_memory SET status = 'retired' WHERE id = $1", [f.brandId])
      await pg.query("UPDATE public.audience_memory SET status = 'retired' WHERE id = $1", [f.audienceId])
      return f
    }

    it("deleted at retirement + 30 days + 1 minute, and NOT at + 30 days - 1 minute (retirement = the round's terminal_at)", async () => {
      const due = await expiredWithRetired(1)
      const notYet = await expiredWithRetired(-1)
      await sweep()
      expect(await exists('brand_memory', due.brandId)).toBe(false)
      expect(await exists('audience_memory', due.audienceId)).toBe(false)
      expect(await exists('brand_memory', notYet.brandId)).toBe(true)
      expect(await exists('audience_memory', notYet.audienceId)).toBe(true)
      // the stubs of the deleted rows' answers survive (an answer row is never hard-deleted)
      expect((await answers(due.roundId)).length).toBe(5)
    })

    // ── INVERTED in Session 35-D D4 (the pass's ONE permitted assertion flip; build-guide section 4, rule 4). This test used to
    // pin "a RATIFIED round's retired rows — a rejected candidate, and a row a later round replaced — are NEVER deleted, at any
    // age", because ADR 0029 6.3 was silent on a rejected candidate. Founder ruling A-6(a) (2026-09-28, adopting the guide's
    // recommendation): "a rejected candidate is an unratified candidate under A-3, and so deleted at its round's
    // answer-redaction deadline (terminal_at + INTERVIEW_ANSWER_TTL_DAYS, 30 d) — not 30 days after that, because a rejected
    // evidence row's content is a verbatim excerpt of the answer". Only the REJECTED half flips. The other two halves hold
    // exactly as before: an ACTIVE row is never deleted, and a row a later round REPLACED (retired, interview_rejected = false)
    // is never deleted, at any age. The replaced case is the one that would fail if the sweep deleted "every retired row of a
    // ratified round", which is why the schema carries interview_rejected (set by ratify's REJECT branch alone).
    describe('[A-6(a)] REJECTED candidates of RATIFIED rounds are deleted at terminal_at + 30 days', () => {
      async function ratifiedWithRejected(minutesPastDeadline: number) {
        const f = await makeRound({ candidates: true })
        await setRound(f.roundId, `status = 'ratified', terminal_at = ${ago(30, -minutesPastDeadline)}`)
        // a REJECT, exactly as ratify_interview_round writes it: candidate -> retired with the marker in ONE statement
        await pg.query("UPDATE public.brand_memory SET status = 'retired', interview_rejected = true WHERE id = $1", [f.brandId])
        await pg.query("UPDATE public.audience_memory SET status = 'active' WHERE id = $1", [f.audienceId])
        return f
      }

      it('a rejected candidate is deleted at + 30 days + 1 minute and survives at + 30 days - 1 minute; the ACTIVE row of the same round survives both, its span redacted at the same deadline as before', async () => {
        const due = await ratifiedWithRejected(1)
        const notYet = await ratifiedWithRejected(-1)
        await sweep()
        expect(await exists('brand_memory', due.brandId), 'rejected, + 30 d + 1 min').toBe(false)
        expect(await exists('brand_memory', notYet.brandId), 'rejected, + 30 d - 1 min').toBe(true)
        expect((await memRow('brand_memory', notYet.brandId as string)).status).toBe('retired')

        const dueActive = await memRow('audience_memory', due.audienceId as string)
        expect(dueActive.status).toBe('active')
        expect(dueActive.interview_span, 'span redacted, as before').toBeNull()
        expect(dueActive.interview_span_redacted_at).not.toBeNull()
        const notYetActive = await memRow('audience_memory', notYet.audienceId as string)
        expect(notYetActive.status).toBe('active')
        expect(notYetActive.interview_span).toBe(SPAN_AUDIENCE)
        // the answers' stubs survive (an answer row is never hard-deleted)
        expect((await answers(due.roundId)).length).toBe(5)
      })

      it('a row a LATER round replaced — retired, interview_rejected = false — is NEVER deleted, at any age, and neither is an active row', async () => {
        const f = await makeRound({ candidates: true })
        await setRound(f.roundId, "status = 'ratified', terminal_at = now() - interval '400 days'")
        await pg.query("UPDATE public.brand_memory SET status = 'active' WHERE id = $1", [f.brandId])
        await pg.query("UPDATE public.brand_memory SET status = 'retired' WHERE id = $1", [f.brandId]) // replaced: NOT rejected
        await pg.query("UPDATE public.audience_memory SET status = 'active' WHERE id = $1", [f.audienceId])
        await sweep()
        expect(await exists('brand_memory', f.brandId)).toBe(true)
        expect((await memRow('brand_memory', f.brandId as string)).interview_rejected).toBe(false)
        expect((await memRow('audience_memory', f.audienceId as string)).status).toBe('active')
      })

      it('only a RATIFIED round is in scope: a rejected-marked row of a round in another terminal status (skipped) is left alone by step 4b', async () => {
        const f = await makeRound({ candidates: true })
        await setRound(f.roundId, `status = 'skipped', terminal_at = ${ago(31, 0)}`)
        await pg.query("UPDATE public.brand_memory SET status = 'retired', interview_rejected = true WHERE id = $1", [f.brandId])
        await sweep()
        expect(await exists('brand_memory', f.brandId)).toBe(true)
      })

      it('is counted in candidatesDeleted (the run still returns the same six counters) and is IDEMPOTENT', async () => {
        const f = await ratifiedWithRejected(1)
        const first = await sweep()
        expect(Object.keys(first).sort()).toEqual(['answersRedacted', 'candidatesDeleted', 'candidatesRetired', 'expired', 'failedStuck', 'spansRedacted'])
        expect(first.candidatesDeleted).toBeGreaterThanOrEqual(1)
        expect(await exists('brand_memory', f.brandId)).toBe(false)
        const snap = async () => JSON.stringify([await round(f.roundId), await answers(f.roundId), await memRow('audience_memory', f.audienceId as string)])
        const before = await snap()
        await sweep()
        expect(await snap()).toBe(before)
      })
    })

    it('only RETIRED rows of an expired round are deleted: a still-CANDIDATE row of one survives', async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'expired', terminal_at = ${ago(31, 0)}`)
      await pg.query("UPDATE public.brand_memory SET status = 'retired' WHERE id = $1", [f.brandId])
      await sweep()
      expect(await exists('brand_memory', f.brandId)).toBe(false)
      expect(await exists('audience_memory', f.audienceId)).toBe(true)
    })

    it('step 4 leaves the round row itself untouched', async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'expired', terminal_at = ${ago(31, 0)}`)
      await pg.query("UPDATE public.brand_memory SET status = 'retired' WHERE id = $1", [f.brandId])
      const before = await round(f.roundId)
      await sweep()
      const after = await round(f.roundId)
      expect(after.status).toBe('expired')
      expect(after.terminal_at).toEqual(before.terminal_at)
    })
  })

  // ─── the whole run ──────────────────────────────────────────────────────────

  describe('the run as a whole', () => {
    it("is IDEMPOTENT: a second sweep changes none of this test's rows", async () => {
      const f = await makeRound({ candidates: true })
      await setRound(f.roundId, `status = 'expired', terminal_at = ${ago(31, 0)}`)
      await sweep()
      const snap = async () => JSON.stringify([await round(f.roundId), await answers(f.roundId)])
      const first = await snap()
      await sweep()
      expect(await snap()).toBe(first)
    })

    it('returns the six counters, all numbers', async () => {
      const counts = await sweep()
      expect(Object.keys(counts).sort()).toEqual(['answersRedacted', 'candidatesDeleted', 'candidatesRetired', 'expired', 'failedStuck', 'spansRedacted'])
      for (const v of Object.values(counts)) expect(typeof v).toBe('number')
    })

    it('SKIPS a round another transaction holds locked (a ratification in flight) and takes it on the next run — the sweep never blocks a ratify', async () => {
      const f = await makeRound()
      await setRound(f.roundId, `created_at = ${ago(31, 0)}`)
      const holder = new Client({ connectionString: process.env.DATABASE_URL })
      await holder.connect()
      try {
        await holder.query('BEGIN')
        await holder.query('SELECT id FROM public.founder_interview_rounds WHERE id = $1 FOR UPDATE', [f.roundId])
        const t0 = Date.now()
        await sweep() // must return promptly, not wait for the lock
        expect(Date.now() - t0).toBeLessThan(8000)
        expect((await round(f.roundId)).status).toBe('open')
        await holder.query('COMMIT')
      } finally {
        await holder.end()
      }
      await sweep()
      expect((await round(f.roundId)).status).toBe('expired')
    })
  })

  // ─── grants, signature, bound ───────────────────────────────────────────────

  describe('grant, signature and bound', () => {
    it('takes NO arguments, is SECURITY DEFINER with a pinned search_path, and EXECUTE is held by service_role alone', async () => {
      const { rows } = await pg.query<{ oid: string; args: string; secdef: boolean; cfg: string[] | null }>(
        "SELECT p.oid::text AS oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS secdef, p.proconfig AS cfg FROM pg_proc p WHERE p.proname = 'sweep_interview_data' AND p.pronamespace = 'public'::regnamespace",
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].args).toBe('')
      expect(rows[0].secdef).toBe(true)
      expect(rows[0].cfg?.join(',')).toContain('search_path=public, pg_temp')
      for (const role of ['anon', 'authenticated']) {
        const { rows: g } = await pg.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2::oid, $3) AS ok', [role, rows[0].oid, 'EXECUTE'])
        expect(g[0].ok, role).toBe(false)
      }
      const { rows: sr } = await pg.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', $1::oid, 'EXECUTE') AS ok", [rows[0].oid])
      expect(sr[0].ok).toBe(true)
    })

    it('every step is BOUNDED per run (LIMIT v_limit, a constant 500) and skips locked rounds', async () => {
      const { rows } = await pg.query<{ def: string }>("SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE p.proname = 'sweep_interview_data' AND p.pronamespace = 'public'::regnamespace")
      const def = rows[0].def
      expect((def.match(/LIMIT v_limit/g) ?? []).length).toBeGreaterThanOrEqual(8)
      expect(def).toMatch(/v_limit\s+constant\s+(?:integer|int)\s*:?=\s*500/i)
      expect(def).toMatch(/SKIP LOCKED/)
    })
  })
})
