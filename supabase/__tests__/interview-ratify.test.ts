import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0029 §8.5, §4.5, §2.6 — INTERVIEW-RATIFY-ATOMIC (10), INTERVIEW-EXPIRY-FROM-FINAL-CATEGORY (28), and the Tier-1
// halves of INTERVIEW-RATIFY-AUTHORISED (11), INTERVIEW-CONFLICT-TENANT-BOUNDED (26) and INTERVIEW-EDIT-PRESERVES-PROVENANCE
// (29). Live Postgres.
//
// ratify_interview_round is the ONLY path that activates an interview candidate. Its order is the constraint [db-MAJOR-3]:
//   (1) lock the round FOR UPDATE and derive the business  (2) return unless awaiting_ratification, BEFORE any memory write
//   (3) approver-or-admin membership  (4) validate everything  (5) per-item conditional UPDATEs  (6) guarded flip.
// The tests prove that order from BEHAVIOUR: a non-awaiting round leaves every memory row byte-identical, two REAL
// concurrent connections flip a round exactly once, and a failure anywhere in (4) or (5) rolls the whole call back.
//
// There is NO accept-all anywhere: every candidate of the round must be decided exactly once, or the RPC raises.

const PASSWORD = 'TestPass123!'

const answerText = (n: number) =>
  `Answer ${n}. We integrate natively with Slack and Linear. Pricing starts at 49 euros per month. ` +
  'Buyers keep asking about security reviews. One customer said: "it saved us hours every week". Usage doubled in the third quarter.'
const SPAN_BRAND = 'We integrate natively with Slack and Linear'
const SPAN_PRICING = 'Pricing starts at 49 euros per month'
const SPAN_AUDIENCE = 'Buyers keep asking about security reviews'
const SPAN_QUOTE = 'it saved us hours every week'
const SPAN_USAGE = 'Usage doubled in the third quarter'

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({ questionKey: `q-${i + 1}`, slotType: 'brand', slotCategory: 'positioning', bankVersion: 1 }))

type Type = 'brand' | 'audience' | 'evidence'
const TABLE: Record<Type, string> = { brand: 'brand_memory', audience: 'audience_memory', evidence: 'evidence_memory' }
const CAT_COL: Record<Type, string> = { brand: 'category', audience: 'kind', evidence: 'kind' }

type Cand = { type: Type; id: string; category: string; answerId: string }
type Round = {
  businessId: string
  roundId: string
  owner: string
  editor: string
  adminEditor: string
  viewer: string
  revoked: string
  stranger: string
  answers: { id: string; position: number }[]
  cands: Cand[]
}

const at = (r: Round, key: string): Cand => {
  const [type, category] = key.split(':')
  const found = r.cands.find((c) => c.type === type && c.category === category)
  if (!found) throw new Error(`no candidate ${key}`)
  return found
}

describe('ratify_interview_round (ADR 0029 §8.5)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(label: string): Promise<string> {
    const email = `intw-ratify-${label}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return data.user.id as string
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args)
    return { data, error }
  }
  const ratify = (r: { roundId: string }, userId: string | null, decisions: unknown) =>
    rpc('ratify_interview_round', { p_user_id: userId, p_round_id: r.roundId, p_decisions: decisions })

  async function addMember(businessId: string, userId: string, role: string, status = 'active', isAdmin = false) {
    await pg.query(
      `INSERT INTO public.business_members (business_id, user_id, email, role, status, is_admin, accepted_at) VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [businessId, userId, `m-${userId}@integration.test`, role, status, isAdmin],
    )
  }

  const DEFAULT_ITEMS = (a: { id: string }[]) => [
    { answerId: a[0].id, type: 'brand', category: 'positioning', text: 'Positioning candidate', span: SPAN_BRAND },
    { answerId: a[0].id, type: 'brand', category: 'pricing', text: 'Pricing candidate', span: SPAN_PRICING },
    { answerId: a[1].id, type: 'audience', category: 'objection', text: 'Objection candidate', span: SPAN_AUDIENCE },
    { answerId: a[1].id, type: 'evidence', category: 'quote', text: SPAN_QUOTE, span: SPAN_QUOTE },
    { answerId: a[2].id, type: 'evidence', category: 'usage_data', text: SPAN_USAGE, span: SPAN_USAGE },
  ]

  // A business whose round is AWAITING RATIFICATION with five candidates, built through the real lifecycle and writer RPCs.
  // Passing an existing Round adds a SECOND round to the same business (the caller must have backdated the first).
  async function awaitingRound(existing?: Round, textPrefix = '', itemExtras: Record<string, Record<string, unknown>> = {}): Promise<Round> {
    const owner = existing?.owner ?? (await newUser('owner'))
    let businessId: string
    let members = existing
    if (existing) {
      businessId = existing.businessId
    } else {
      const { data: biz, error } = await admin.from('businesses').insert({ name: `Interview Ratify ${seq}`, owner_id: owner, plan: 'plus' }).select('id').single()
      if (error) throw error
      businessId = biz.id as string
      businessIds.push(businessId)
    }
    if (!members) {
      const editor = await newUser('editor')
      const adminEditor = await newUser('admin-editor')
      const viewer = await newUser('viewer')
      const revoked = await newUser('revoked')
      const stranger = await newUser('stranger')
      await addMember(businessId, editor, 'editor')
      await addMember(businessId, adminEditor, 'editor', 'active', true)
      await addMember(businessId, viewer, 'viewer')
      await addMember(businessId, revoked, 'approver', 'revoked')
      members = { businessId, roundId: '', owner, editor, adminEditor, viewer, revoked, stranger, answers: [], cands: [] }
    }
    const created = await rpc('create_interview_round', { p_user_id: owner, p_business_id: businessId, p_questions: QUESTIONS })
    if (created.error) throw created.error
    const roundId = created.data.roundId as string
    const { rows: ar } = await pg.query<{ id: string; position: number }>('SELECT id, position FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])
    for (const a of ar) await rpc('save_interview_answer', { p_user_id: owner, p_answer_id: a.id, p_text: answerText(a.position) })
    await rpc('submit_interview_round', { p_user_id: owner, p_round_id: roundId })
    await rpc('claim_interview_extraction', { p_round_id: roundId })
    const items = DEFAULT_ITEMS(ar).map((i) => {
      const text = i.type === 'evidence' ? i.text : `${textPrefix}${i.text}`
      return { ...i, text, storedText: text, storedSpan: i.span, ...(itemExtras[`${i.type}:${i.category}`] ?? {}) }
    })
    const w = await rpc('write_interview_candidates', { p_round_id: roundId, p_items: { items, counters: { proposed: items.length, droppedUngrounded: 0, droppedPerformanceClaim: 0 } } })
    expect(w.data.status).toBe('awaiting_ratification')
    const cands: Cand[] = []
    for (const type of ['brand', 'audience', 'evidence'] as Type[]) {
      const { rows } = await pg.query<{ id: string; cat: string; aid: string }>(
        `SELECT m.id, m.${CAT_COL[type]} AS cat, m.interview_answer_id AS aid FROM public.${TABLE[type]} m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id WHERE a.round_id = $1`,
        [roundId],
      )
      for (const r of rows) cands.push({ type, id: r.id, category: r.cat, answerId: r.aid })
    }
    return { ...members, roundId, answers: ar, cands }
  }

  const acceptAll = (r: Round, edits: Record<string, Record<string, unknown>> = {}): Record<string, unknown>[] =>
    r.cands.map((c) => ({ type: c.type, id: c.id, decision: 'accept', ...(edits[`${c.type}:${c.category}`] ?? {}) }))

  async function snapshot(businessId: string): Promise<string> {
    const parts: unknown[] = []
    for (const t of Object.values(TABLE)) {
      const { rows } = await pg.query<{ j: unknown }>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) AS j FROM public.${t} m WHERE m.business_id = $1`, [businessId])
      parts.push(rows[0].j)
    }
    return JSON.stringify(parts)
  }
  const row = async (c: Cand) => (await pg.query(`SELECT * FROM public.${TABLE[c.type]} WHERE id = $1`, [c.id])).rows[0]
  const round = async (id: string) => (await pg.query('SELECT * FROM public.founder_interview_rounds WHERE id = $1', [id])).rows[0]

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

  // ─── the happy path ─────────────────────────────────────────────────────────

  describe('the decision set', () => {
    it('accepts and rejects PER ITEM: accepted -> active, rejected -> retired; the round becomes ratified with the counters', async () => {
      const r = await awaitingRound()
      const usage = at(r, 'evidence:usage_data')
      const decisions = acceptAll(r).map((d) => (d.id === usage.id ? { ...d, decision: 'reject' } : d))
      const res = await ratify(r, r.owner, decisions)
      expect(res.error).toBeNull()
      expect(res.data).toMatchObject({ outcome: 'ratified', accepted: 4, rejected: 1, edited: 0, replaced: 0 })
      for (const c of r.cands) expect((await row(c)).status).toBe(c.id === usage.id ? 'retired' : 'active')
      const rd = await round(r.roundId)
      expect(rd).toMatchObject({ status: 'ratified', ratified_by: r.owner, accepted: 4, rejected: 1, edited: 0, replaced: 0 })
      expect(rd.ratified_at).not.toBeNull()
      expect(rd.terminal_at).not.toBeNull()
    })

    it('accepted rows become RETRIEVABLE (active) and rejected ones do not; confidence, last_confirmed_at and provenance are untouched', async () => {
      const { listBrandMemoryCandidates } = await import('@/lib/db/memory-brand')
      const r = await awaitingRound()
      const before = await Promise.all(r.cands.map(row))
      expect(await listBrandMemoryCandidates(admin, r.businessId)).toEqual([])
      await ratify(r, r.owner, acceptAll(r).map((d) => (d.id === at(r, 'brand:pricing').id ? { ...d, decision: 'reject' } : d)))
      const visible = (await listBrandMemoryCandidates(admin, r.businessId)) as { id: string }[]
      expect(visible.map((v) => v.id)).toEqual([at(r, 'brand:positioning').id])
      const after = await Promise.all(r.cands.map(row))
      r.cands.forEach((c, i) => {
        expect(after[i].confidence, `${c.type}:${c.category} confidence`).toBe(before[i].confidence)
        expect(after[i].last_confirmed_at, `${c.type}:${c.category} last_confirmed_at`).toEqual(before[i].last_confirmed_at)
        expect(after[i].source).toBe('interview')
        expect(after[i].interview_answer_id).toBe(before[i].interview_answer_id)
        expect(after[i].interview_span).toBe(before[i].interview_span)
        expect(after[i].public_use_permission).toBe(false)
      })
    })
  })

  // ─── INTERVIEW-RATIFY-ATOMIC (10) ───────────────────────────────────────────

  describe('INTERVIEW-RATIFY-ATOMIC — lock, status re-check, then write', () => {
    it('TWO REAL CONCURRENT ratify calls from TWO CONNECTIONS: exactly ONE flips the round, the other blocks on the lock and no-ops; nothing is written twice', async () => {
      const r = await awaitingRound()
      const decisions = JSON.stringify(acceptAll(r))
      const clients = [new Client({ connectionString: process.env.DATABASE_URL }), new Client({ connectionString: process.env.DATABASE_URL })]
      await Promise.all(clients.map((c) => c.connect()))
      try {
        const results = await Promise.all(
          clients.map((c) => c.query<{ r: { outcome: string; status?: string } }>('SELECT public.ratify_interview_round($1, $2, $3::jsonb) AS r', [r.owner, r.roundId, decisions])),
        )
        const outcomes = results.map((x) => x.rows[0].r.outcome).sort()
        expect(outcomes).toEqual(['not_awaiting', 'ratified'])
        expect(results.map((x) => x.rows[0].r).find((x) => x.outcome === 'not_awaiting')?.status).toBe('ratified')
        const rd = await round(r.roundId)
        expect(rd).toMatchObject({ status: 'ratified', accepted: 5, rejected: 0 })
        for (const c of r.cands) expect((await row(c)).status).toBe('active')
      } finally {
        await Promise.all(clients.map((c) => c.end()))
      }
    })

    it.each(['open', 'submitted', 'extracting', 'extraction_failed', 'ratified', 'skipped', 'expired', 'failed', 'no_records'])(
      "a round that is '%s' (not awaiting ratification) writes NOTHING — every memory row and the round row are byte-identical",
      async (status) => {
        const r = await awaitingRound()
        await pg.query('UPDATE public.founder_interview_rounds SET status = $2 WHERE id = $1', [r.roundId, status])
        const memBefore = await snapshot(r.businessId)
        const roundBefore = await round(r.roundId)
        const res = await ratify(r, r.owner, acceptAll(r))
        expect(res.error).toBeNull()
        expect(res.data).toEqual({ outcome: 'not_awaiting', status })
        expect(await snapshot(r.businessId)).toBe(memBefore)
        expect(await round(r.roundId)).toEqual(roundBefore)
      },
    )

    it('the STATUS re-check precedes the membership check: a non-member on a non-awaiting round gets the no-op, never a write (and an unknown round is not_found)', async () => {
      const r = await awaitingRound()
      await pg.query("UPDATE public.founder_interview_rounds SET status = 'ratified' WHERE id = $1", [r.roundId])
      const res = await ratify(r, r.stranger, acceptAll(r))
      expect(res.error).toBeNull()
      expect(res.data.outcome).toBe('not_awaiting')
      const unknown = await rpc('ratify_interview_round', { p_user_id: r.owner, p_round_id: '00000000-0000-4000-8000-0000000000dd', p_decisions: [] })
      expect(unknown.data).toEqual({ outcome: 'not_found' })
    })

    it('the whole call is ATOMIC: a valid first decision followed by an invalid replace target rolls back every earlier update', async () => {
      const r = await awaitingRound()
      const before = await snapshot(r.businessId)
      const decisions = acceptAll(r)
      decisions[decisions.length - 1] = { ...decisions[decisions.length - 1], replaces: { type: 'brand', id: '00000000-0000-4000-8000-0000000000ee' } }
      const res = await ratify(r, r.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(await snapshot(r.businessId)).toBe(before)
      expect((await round(r.roundId)).status).toBe('awaiting_ratification')
    })
  })

  // ─── INTERVIEW-RATIFY-AUTHORISED (11), Tier-1 half ──────────────────────────

  describe('INTERVIEW-RATIFY-AUTHORISED — approver OR admin, active, of THAT business', () => {
    it.each(['editor', 'viewer', 'stranger', 'revoked'] as const)('a %s p_user_id RAISES 42501 and changes nothing', async (who) => {
      const r = await awaitingRound()
      const before = await snapshot(r.businessId)
      const res = await ratify(r, r[who], acceptAll(r))
      expect(res.error?.code).toBe('42501')
      expect(res.error?.message).toMatch(/not an approver\/admin member/)
      expect(await snapshot(r.businessId)).toBe(before)
      expect((await round(r.roundId)).status).toBe('awaiting_ratification')
    })

    it('a NULL p_user_id RAISES 42501', async () => {
      const r = await awaitingRound()
      expect((await ratify(r, null, acceptAll(r))).error?.code).toBe('42501')
    })

    it('an ADMIN who is NOT an approver SUCCEEDS (the ADR 0025 predicate: role = approver OR is_admin), and so does the owner', async () => {
      const a = await awaitingRound()
      const res = await ratify(a, a.adminEditor, acceptAll(a))
      expect(res.data.outcome).toBe('ratified')
      expect((await round(a.roundId)).ratified_by).toBe(a.adminEditor)
      const b = await awaitingRound()
      expect((await ratify(b, b.owner, acceptAll(b))).data.outcome).toBe('ratified')
    })

    it('an approver of ANOTHER business cannot ratify this one (the business is derived from the round)', async () => {
      const a = await awaitingRound()
      const b = await awaitingRound()
      const res = await ratify(a, b.owner, acceptAll(a))
      expect(res.error?.code).toBe('42501')
      expect((await round(a.roundId)).status).toBe('awaiting_ratification')
    })

    it('EXECUTE is held by service_role alone; the signature is (uuid, uuid, jsonb) with no business parameter', async () => {
      const { rows } = await pg.query<{ oid: string; args: string; secdef: boolean }>(
        "SELECT p.oid::text AS oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS secdef FROM pg_proc p WHERE p.proname = 'ratify_interview_round' AND p.pronamespace = 'public'::regnamespace",
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].args).toBe('p_user_id uuid, p_round_id uuid, p_decisions jsonb')
      expect(rows[0].secdef).toBe(true)
      for (const role of ['anon', 'authenticated']) {
        const { rows: g } = await pg.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2::oid, $3) AS ok', [role, rows[0].oid, 'EXECUTE'])
        expect(g[0].ok, role).toBe(false)
      }
      const { rows: sr } = await pg.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', $1::oid, 'EXECUTE') AS ok", [rows[0].oid])
      expect(sr[0].ok).toBe(true)
    })
  })

  // ─── validation: no accept-all, edits, tenant-bound replace ─────────────────

  describe('validation (step 4) — nothing is written unless every decision is valid', () => {
    async function rejectedWith(r: Round, decisions: unknown, fragment: RegExp) {
      const before = await snapshot(r.businessId)
      const res = await ratify(r, r.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(res.error?.message).toMatch(fragment)
      expect(await snapshot(r.businessId)).toBe(before)
      expect((await round(r.roundId)).status).toBe('awaiting_ratification')
    }

    it('a decision set MISSING one candidate RAISES — there is no accept-all and no implicit default', async () => {
      const r = await awaitingRound()
      await rejectedWith(r, acceptAll(r).slice(1), /every candidate of the round must be decided exactly once/)
    })

    it('a duplicate decision, an extra unknown id, and an empty set RAISE', async () => {
      const r = await awaitingRound()
      const all = acceptAll(r)
      await rejectedWith(r, [...all.slice(0, 4), all[0]], /exactly once|more than once/)
      await rejectedWith(r, [...all, { type: 'brand', id: '00000000-0000-4000-8000-0000000000ff', decision: 'accept' }], /every candidate|not an interview candidate/)
      await rejectedWith(r, [], /every candidate of the round must be decided exactly once/)
    })

    it('a candidate of ANOTHER ROUND (even of the same business) is rejected', async () => {
      const first = await awaitingRound()
      await ratify(first, first.owner, acceptAll(first))
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [first.roundId])
      const second = await awaitingRound(first, 'Second ')
      const decisions = acceptAll(second)
      decisions[0] = { type: first.cands[0].type, id: first.cands[0].id, decision: 'accept' }
      await rejectedWith(second, decisions, /not an interview candidate/)
    })

    it('a candidate of ANOTHER BUSINESS is rejected', async () => {
      const a = await awaitingRound()
      const b = await awaitingRound()
      const decisions = acceptAll(a)
      decisions[0] = { type: b.cands[0].type, id: b.cands[0].id, decision: 'accept' }
      await rejectedWith(a, decisions, /not an interview candidate/)
    })

    it('an EVIDENCE text edit RAISES (evidence stays verbatim); a brand text edit over 280 or blank RAISES; an unknown category RAISES', async () => {
      const r = await awaitingRound()
      await rejectedWith(r, acceptAll(r, { 'evidence:quote': { text: 'a paraphrase' } }), /evidence records cannot be edited/)
      await rejectedWith(r, acceptAll(r, { 'brand:pricing': { text: 'x'.repeat(281) } }), /1\.\.280 characters/)
      await rejectedWith(r, acceptAll(r, { 'brand:pricing': { text: '   ' } }), /1\.\.280 characters/)
      await rejectedWith(r, acceptAll(r, { 'brand:pricing': { category: 'problem' } }), /not in the brand enum/)
      await rejectedWith(r, acceptAll(r, { 'audience:objection': { category: 'quote' } }), /not in the audience enum/)
    })

    it('a REJECT may not carry an edit or a replace target', async () => {
      const r = await awaitingRound()
      const withEdit = acceptAll(r).map((d) => (d.id === at(r, 'brand:pricing').id ? { ...d, decision: 'reject', text: 'edited' } : d))
      await rejectedWith(r, withEdit, /only an accepted candidate/)
    })

    it('malformed decisions RAISE: an unknown decision value, an unknown type, a bad id, a non-array', async () => {
      const r = await awaitingRound()
      const base = acceptAll(r)
      await rejectedWith(r, base.map((d, i) => (i === 0 ? { ...d, decision: 'maybe' } : d)), /decision must be accept or reject/)
      await rejectedWith(r, base.map((d, i) => (i === 0 ? { ...d, type: 'performance' } : d)), /type must be/)
      await rejectedWith(r, base.map((d, i) => (i === 0 ? { ...d, id: 'not-a-uuid' } : d)), /malformed|must carry/)
      // db-review MINOR-6: 36 characters that pass a loose pattern but are not a uuid must raise 22023, never 22P02 on the cast
      await rejectedWith(r, base.map((d, i) => (i === 0 ? { ...d, id: '-'.repeat(36) } : d)), /must carry/)
      await rejectedWith(r, base.map((d, i) => (i === 0 ? { ...d, replaces: { type: 'brand', id: '-'.repeat(36) } } : d)), /replaces must carry/)
      await rejectedWith(r, { decisions: base }, /must be a jsonb array/)
    })
  })

  // ─── INTERVIEW-CONFLICT-TENANT-BOUNDED (26), Tier-1 half: replace ───────────

  describe('INTERVIEW-CONFLICT-TENANT-BOUNDED — replace retires only an ACTIVE interview row of the SAME business', () => {
    async function withActiveInterviewRow(): Promise<{ first: Round; target: Cand }> {
      const first = await awaitingRound()
      await ratify(first, first.owner, acceptAll(first))
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [first.roundId])
      return { first, target: at(first, 'brand:positioning') }
    }

    it('REPLACE retires the old ACTIVE interview row in the same transaction the new one is accepted (replaced = 1)', async () => {
      const { first, target } = await withActiveInterviewRow()
      // [post-D11] a replace target must be one of the ACCEPTING candidate's own persisted conflict ids.
      const second = await awaitingRound(first, 'Second ', { 'brand:positioning': { conflictIds: [target.id] } })
      const decisions = acceptAll(second).map((d) => (d.id === at(second, 'brand:positioning').id ? { ...d, replaces: { type: target.type, id: target.id } } : d))
      const res = await ratify(second, second.owner, decisions)
      expect(res.data).toMatchObject({ outcome: 'ratified', accepted: 5, replaced: 1 })
      expect((await row(target)).status).toBe('retired')
      expect((await row(at(second, 'brand:positioning'))).status).toBe('active')
      expect(await round(second.roundId)).toMatchObject({ replaced: 1 })
    })

    // [post-D11 follow-up] The writer (D4) only ever keeps a conflict id that is a row of the SAME TABLE as the item's own
    // type, so a real extraction can never produce a cross-type conflict id — ratify's own type-match check is defence in
    // depth for that invariant, provable only by writing a row directly (bypassing the writer), as this test does.
    it('a replace target of a DIFFERENT TYPE than the candidate — even if present in its own conflict_ids (a hand-written row, bypassing the writer) — is rejected', async () => {
      const { first, target } = await withActiveInterviewRow() // target is an ACTIVE brand row
      const second = await awaitingRound(first, 'Second ')
      const anyAnswerId = second.answers[0].id
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.audience_memory
           (business_id, source, confidence, status, sensitivity, public_use_permission, scope, observation_count,
            last_confirmed_at, kind, statement, interview_answer_id, interview_span, interview_extracted_text, interview_conflict_ids)
         VALUES ($1, 'interview', 0.5, 'candidate', 'internal', false, 'brand', 1,
                 now(), 'objection', 'A hand-written audience candidate', $2, 'span text', 'A hand-written audience candidate', ARRAY[$3::uuid])
         RETURNING id`,
        [second.businessId, anyAnswerId, target.id],
      )
      const decisions = [
        ...acceptAll(second),
        { type: 'audience', id: rows[0].id, decision: 'accept', category: 'objection', replaces: { type: target.type, id: target.id } },
      ]
      const res = await ratify(second, second.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(res.error?.message).toMatch(/not the same type as the candidate replacing it/)
      expect((await row(target)).status).toBe('active')
      expect((await pg.query('SELECT status FROM public.audience_memory WHERE id = $1', [rows[0].id])).rows[0].status).toBe('candidate')
    })

    // Session 35-D D4, founder ruling A-6(a): the sweep deletes a REJECTED candidate 30 days after its round's terminal_at, and
    // must never delete a row a later round REPLACED (both are 'retired'). interview_rejected is the marker that tells them
    // apart, set ONLY by the reject branch, in the same UPDATE that retires the candidate.
    it('[A-6(a)] REJECT marks interview_rejected on the rejected candidate ONLY: an accepted row, and a row a later round REPLACED, stay false', async () => {
      const { first, target } = await withActiveInterviewRow()
      const second = await awaitingRound(first, 'Second ', { 'brand:positioning': { conflictIds: [target.id] } })
      const rejected = at(second, 'evidence:usage_data')
      const decisions = acceptAll(second).map((d) => {
        if (d.id === at(second, 'brand:positioning').id) return { ...d, replaces: { type: target.type, id: target.id } }
        if (d.id === rejected.id) return { ...d, decision: 'reject' }
        return d
      })
      const res = await ratify(second, second.owner, decisions)
      expect(res.data).toMatchObject({ outcome: 'ratified', accepted: 4, rejected: 1, replaced: 1 })
      expect(await row(rejected)).toMatchObject({ status: 'retired', interview_rejected: true })
      expect(await row(target), 'a row a later round REPLACED is retired but NOT rejected').toMatchObject({ status: 'retired', interview_rejected: false })
      for (const c of second.cands.filter((x) => x.id !== rejected.id)) {
        expect(await row(c), `${c.type}:${c.category}`).toMatchObject({ status: 'active', interview_rejected: false })
      }
    })

    // Session 35-D D5 (MAJOR-3): before D4/D5 the hedge flag and the conflict ids were computed and discarded, so a Replace
    // decision could never carry a real conflict target and `replaced` was structurally 0 from the product. END TO END, live
    // Postgres: the writer persists the id the extraction named (and drops and counts a foreign one), the ratify decision uses
    // ONLY the persisted id, and the round reaches replaced = 1 with the old row retired and NOT marked rejected.
    it('[D5 MAJOR-3] END TO END: the writer persists the conflict id, and a Replace decision built from the PERSISTED id reaches replaced = 1', async () => {
      const { first, target } = await withActiveInterviewRow()
      const foreign = '00000000-0000-4000-8000-0000000000ee'
      const second = await awaitingRound(first, 'Second ', { 'brand:positioning': { hedgeFlagged: true, conflictIds: [target.id, foreign] } })
      const cand = at(second, 'brand:positioning')

      const persisted = await row(cand)
      expect(persisted.interview_hedge_flagged).toBe(true)
      expect(persisted.interview_conflict_ids, 'the real target is kept; the id that is no row of this business is dropped').toEqual([target.id])
      expect((await round(second.roundId)).dropped_conflict_foreign).toBe(1)

      const decisions = acceptAll(second).map((d) => (d.id === cand.id ? { ...d, replaces: { type: 'brand', id: (persisted.interview_conflict_ids as string[])[0] } } : d))
      const res = await ratify(second, second.owner, decisions)
      expect(res.data).toMatchObject({ outcome: 'ratified', accepted: 5, replaced: 1 })
      expect(await row(target)).toMatchObject({ status: 'retired', interview_rejected: false })
      expect((await row(cand)).status).toBe('active')
      expect(await round(second.roundId)).toMatchObject({ replaced: 1 })
    })

    it("a replace target in ANOTHER BUSINESS is rejected — [post-D11] caught even earlier than the business check: the writer's own tenant-bound conflict-id verification (MAJOR-3) means a foreign tenant's id can never appear in a candidate's OWN interview_conflict_ids in the first place, so a hand-crafted call naming one is rejected by the new ownership gate before the business/active/source check is even reached — nothing changes", async () => {
      const { target } = await withActiveInterviewRow() // an active interview row of business A
      const other = await awaitingRound() // a fresh business B; its candidates' conflict_ids never contain business A's ids
      const before = await snapshot(other.businessId)
      const decisions = acceptAll(other).map((d) => (d.id === at(other, 'brand:positioning').id ? { ...d, replaces: { type: target.type, id: target.id } } : d))
      const res = await ratify(other, other.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(res.error?.message).toMatch(/not one of this candidate's own conflict ids/)
      expect(await snapshot(other.businessId)).toBe(before)
      expect((await row(target)).status).toBe('active') // the foreign row was NOT retired
    })

    it.each(['manual', 'distilled'])("a replace target with source '%s' is rejected — only an interview row may be retired here", async (source) => {
      const first = await awaitingRound()
      // terminalise and backdate so a second round can be created in the same business (withActiveInterviewRow's pattern).
      await ratify(first, first.owner, acceptAll(first))
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [first.roundId])
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.brand_memory (business_id, source, scope, category, statement, status) VALUES ($1, $2, 'brand', 'positioning', 'A ${source} row', 'active') RETURNING id`,
        [first.businessId, source],
      )
      // [post-D11] a SECOND round of the SAME business, with the extra row named as a conflict at WRITE time — the only way
      // interview_conflict_ids can legitimately carry it (the column is immutable after insert), so the call reaches the
      // source check this test is actually about, rather than the new ownership gate.
      const r = await awaitingRound(first, 'Second ', { 'brand:positioning': { conflictIds: [rows[0].id] } })
      const cand = at(r, 'brand:positioning')
      const decisions = acceptAll(r).map((d) => (d.id === cand.id ? { ...d, replaces: { type: 'brand', id: rows[0].id } } : d))
      const res = await ratify(r, r.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect((await pg.query('SELECT status FROM public.brand_memory WHERE id = $1', [rows[0].id])).rows[0].status).toBe('active')
    })

    it("a replace target with source 'import' is rejected (a real import row, with its run)", async () => {
      const first = await awaitingRound()
      await ratify(first, first.owner, acceptAll(first))
      await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [first.roundId])
      const { rows: acct } = await pg.query<{ id: string }>(
        `INSERT INTO public.social_accounts (business_id, platform, platform_user_id, platform_username, vault_access_token_id, connected_at)
         VALUES ($1, 'twitter', $2, 'ratify_handle', '00000000-0000-4000-8000-0000000000c1', now()) RETURNING id`,
        [first.businessId, `x-ratify-${seq++}`],
      )
      const { rows: run } = await pg.query<{ id: string }>("INSERT INTO public.social_backfill_runs (business_id, social_account_id, platform) VALUES ($1, $2, 'twitter') RETURNING id", [first.businessId, acct[0].id])
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.brand_memory (business_id, source, scope, category, statement, status, import_run_id, import_source_post_ids)
         VALUES ($1, 'import', 'brand', 'positioning', 'An imported row', 'active', $2, ARRAY['p1']) RETURNING id`,
        [first.businessId, run[0].id],
      )
      // [post-D11] same pattern: a second same-business round, the import row named as a conflict at write time.
      const r = await awaitingRound(first, 'Second ', { 'brand:positioning': { conflictIds: [rows[0].id] } })
      const cand = at(r, 'brand:positioning')
      const decisions = acceptAll(r).map((d) => (d.id === cand.id ? { ...d, replaces: { type: 'brand', id: rows[0].id } } : d))
      const res = await ratify(r, r.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(res.error?.message).toMatch(/not an active interview record of this business/)
      expect((await pg.query('SELECT status FROM public.brand_memory WHERE id = $1', [rows[0].id])).rows[0].status).toBe('active')
    })

    it('a replace target that is not ACTIVE, the SAME target used twice, and a replace on a REJECT are rejected', async () => {
      const { first, target } = await withActiveInterviewRow()
      // [post-D11] both positioning and pricing need target.id in their OWN conflict_ids to reach the "twice" sub-case's
      // dedup check below (it sends replaces: target.id on EVERY brand-type decision). interview_conflict_ids is immutable
      // after insert, so this must be set at WRITE time.
      const second = await awaitingRound(first, 'Second ', {
        'brand:positioning': { conflictIds: [target.id] },
        'brand:pricing': { conflictIds: [target.id] },
      })
      const own = at(second, 'brand:positioning')
      const pricing = at(second, 'brand:pricing')
      // a candidate of this same round is not an ACTIVE row — positioning's OWN conflict_ids do not include pricing.id, so
      // this is rejected at the ownership gate rather than the deeper "not active" check; still 22023, nothing changes.
      const asCandidate = acceptAll(second).map((d) => (d.id === own.id ? { ...d, replaces: { type: pricing.type, id: pricing.id } } : d))
      expect((await ratify(second, second.owner, asCandidate)).error?.code).toBe('22023')
      // the same target twice
      const twice = acceptAll(second).map((d) => (d.type === 'brand' ? { ...d, replaces: { type: target.type, id: target.id } } : d))
      const t = await ratify(second, second.owner, twice)
      expect(t.error?.code).toBe('22023')
      expect(t.error?.message).toMatch(/more than once/)
      // a replace on a REJECT
      const onReject = acceptAll(second).map((d) => (d.id === own.id ? { ...d, decision: 'reject', replaces: { type: target.type, id: target.id } } : d))
      expect((await ratify(second, second.owner, onReject)).error?.code).toBe('22023')
      expect((await row(target)).status).toBe('active')
      expect((await round(second.roundId)).status).toBe('awaiting_ratification')
    })
  })

  // ─── INTERVIEW-EXPIRY-FROM-FINAL-CATEGORY (28) and INTERVIEW-EDIT-PRESERVES-PROVENANCE (29) ──

  describe('INTERVIEW-EXPIRY-FROM-FINAL-CATEGORY and INTERVIEW-EDIT-PRESERVES-PROVENANCE', () => {
    const days = async (c: Cand) => {
      const { rows } = await pg.query<{ d: string | null }>(
        `SELECT round(extract(epoch FROM (m.expires_at - a.answered_at)) / 86400)::text AS d FROM public.${TABLE[c.type]} m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id WHERE m.id = $1`,
        [c.id],
      )
      return rows[0].d === null ? null : Number(rows[0].d)
    }

    it("re-selecting a brand category 'pricing' -> 'positioning' moves expires_at from answered_at + 180 d to answered_at + 540 d; confidence and last_confirmed_at are unchanged", async () => {
      const r = await awaitingRound()
      const pricing = at(r, 'brand:pricing')
      expect(await days(pricing)).toBe(180)
      const before = await row(pricing)
      await ratify(r, r.owner, acceptAll(r, { 'brand:pricing': { category: 'positioning' } }))
      const after = await row(pricing)
      expect(after.category).toBe('positioning')
      expect(await days(pricing)).toBe(540)
      expect(after.confidence).toBe(before.confidence)
      expect(after.last_confirmed_at).toEqual(before.last_confirmed_at)
      expect(after.interview_edited).toBe(true) // a re-selected category is an edit
    })

    it('the anchor is answered_at, never now(): a backdated answer keeps its own expiry when ratified later', async () => {
      const r = await awaitingRound()
      await pg.query("UPDATE public.founder_interview_answers SET answered_at = now() - interval '100 days' WHERE id = $1", [r.answers[0].id])
      await ratify(r, r.owner, acceptAll(r))
      const pricing = at(r, 'brand:pricing')
      expect(await days(pricing)).toBe(180)
      const { rows } = await pg.query<{ soon: boolean }>('SELECT expires_at < now() + interval \'81 days\' AS soon FROM public.brand_memory WHERE id = $1', [pricing.id])
      expect(rows[0].soon).toBe(true) // 100 days already elapsed of 180: the expiry is ~80 days away, not 180
    })

    it('every category/kind recomputes from the FINAL value: an audience re-select stays 365; evidence quote <-> usage_data swaps NULL and 365', async () => {
      const r = await awaitingRound()
      await ratify(r, r.owner, acceptAll(r, { 'evidence:quote': { category: 'usage_data' }, 'evidence:usage_data': { category: 'quote' }, 'audience:objection': { category: 'trigger' } }))
      const evidence = r.cands.filter((c) => c.type === 'evidence')
      const expiries = await Promise.all(evidence.map(days))
      expect([...expiries].sort()).toEqual([365, null].sort())
      expect(await days(at(r, 'audience:objection'))).toBe(365)
      expect((await row(at(r, 'audience:objection'))).kind).toBe('trigger')
    })

    it('an un-edited accept keeps the ORIGINAL expiry and interview_edited = false', async () => {
      const r = await awaitingRound()
      await ratify(r, r.owner, acceptAll(r))
      for (const c of r.cands) expect((await row(c)).interview_edited, `${c.type}:${c.category}`).toBe(false)
      expect(await days(at(r, 'brand:pricing'))).toBe(180)
      expect(await days(at(r, 'brand:positioning'))).toBe(540)
    })

    it('an EDITED brand/audience record keeps source, the answer pointer and the span; interview_extracted_text is UNCHANGED; interview_edited is true; the text changes', async () => {
      const r = await awaitingRound()
      const brand = at(r, 'brand:positioning')
      const audience = at(r, 'audience:objection')
      const before = { brand: await row(brand), audience: await row(audience) }
      const res = await ratify(r, r.owner, acceptAll(r, { 'brand:positioning': { text: 'An edited positioning' }, 'audience:objection': { text: 'An edited objection' } }))
      expect(res.data).toMatchObject({ outcome: 'ratified', edited: 2 })
      for (const [key, c, text] of [['brand', brand, 'An edited positioning'], ['audience', audience, 'An edited objection']] as const) {
        const after = await row(c)
        expect(after.statement).toBe(text)
        expect(after.interview_edited).toBe(true)
        expect(after.interview_extracted_text).toBe(before[key].interview_extracted_text)
        expect(after.interview_extracted_text).not.toBe(text)
        expect(after.source).toBe('interview')
        expect(after.interview_answer_id).toBe(before[key].interview_answer_id)
        expect(after.interview_span).toBe(before[key].interview_span)
        expect(after.confidence).toBe(before[key].confidence)
      }
      expect(await round(r.roundId)).toMatchObject({ edited: 2 })
    })

    it('the provenance trigger still stands after ratification: the extracted text cannot be rewritten by a later UPDATE', async () => {
      const r = await awaitingRound()
      await ratify(r, r.owner, acceptAll(r))
      const c = at(r, 'brand:positioning')
      await expect(pg.query('UPDATE public.brand_memory SET interview_extracted_text = $2 WHERE id = $1', [c.id, 'rewritten'])).rejects.toMatchObject({ message: expect.stringMatching(/immutable/) })
    })

    it('an edit that collides with another candidate of the same answer and category raises a clear error and rolls back', async () => {
      const r = await awaitingRound()
      const c = at(r, 'brand:positioning')
      await pg.query(
        `INSERT INTO public.brand_memory (business_id, source, confidence, status, scope, last_confirmed_at, category, statement, interview_answer_id, interview_span, interview_extracted_text)
         SELECT business_id, 'interview', confidence, 'candidate', scope, last_confirmed_at, category, 'Colliding statement', interview_answer_id, interview_span, 'Colliding statement' FROM public.brand_memory WHERE id = $1`,
        [c.id],
      )
      const { rows } = await pg.query<{ id: string }>("SELECT id FROM public.brand_memory WHERE business_id = $1 AND statement = 'Colliding statement'", [r.businessId])
      const decisions = [...acceptAll(r), { type: 'brand', id: rows[0].id, decision: 'accept' }].map((d) => (d.id === c.id ? { ...d, text: 'colliding statement' } : d))
      const res = await ratify(r, r.owner, decisions)
      expect(res.error?.code).toBe('22023')
      expect(res.error?.message).toMatch(/collides with another candidate/)
      expect((await round(r.roundId)).status).toBe('awaiting_ratification')
    })
  })
})
