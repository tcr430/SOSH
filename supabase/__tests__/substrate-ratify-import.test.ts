import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0030 §4.2 (Session 36 L2.4, founder ruling A-6) — SUBSTRATE-CONTRADICTION-CROSS-WRITER (9), Tier 1, live Postgres.
//
// ratify_interview_round's Replace admits an IMPORT-sourced target as well as an interview-sourced one, and NOTHING else.
// The failure mode this file exists to catch is a Replace that retires a row it must not: an earned row (distilled, outcome,
// dismissal), a manual row, a row the candidate never listed as a conflict, or another business's row.
//
// EVERY seed row is explicitly status = 'active' (memory defaults to 'candidate', so a careless seed makes "the target was not
// retired" vacuously green — cerebrum, Session 34 K1). Every rejection is asserted on the SQLSTATE (22023) AND a message
// fragment, and on the target row being byte-untouched.
//
// The setup is the one interview-ratify.test.ts uses: a first round is ratified and backdated so a SECOND round can exist in the
// same business, and the target is named in the second round's candidate as a conflict AT WRITE TIME (interview_conflict_ids is
// immutable afterwards).

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
type Cand = { type: Type; id: string; category: string }
type Round = { businessId: string; roundId: string; owner: string; cands: Cand[] }

const at = (r: Round, key: string): Cand => {
  const [type, category] = key.split(':')
  const found = r.cands.find((c) => c.type === type && c.category === category)
  if (!found) throw new Error(`no candidate ${key}`)
  return found
}

describe('ratify_interview_round — Replace admits import (ADR 0030 §4.2, A-6)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const userIds: string[] = []
  const businessIds: string[] = []
  let seq = 0

  async function newUser(label: string): Promise<string> {
    const email = `subst-ratify-${label}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    return data.user.id as string
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args)
    return { data, error }
  }
  const ratify = (r: { roundId: string }, userId: string, decisions: unknown) =>
    rpc('ratify_interview_round', { p_user_id: userId, p_round_id: r.roundId, p_decisions: decisions })

  const ITEMS = (a: { id: string }[]) => [
    { answerId: a[0].id, type: 'brand', category: 'positioning', text: 'Positioning candidate', span: SPAN_BRAND },
    { answerId: a[0].id, type: 'brand', category: 'pricing', text: 'Pricing candidate', span: SPAN_PRICING },
    { answerId: a[1].id, type: 'audience', category: 'objection', text: 'Objection candidate', span: SPAN_AUDIENCE },
    { answerId: a[1].id, type: 'evidence', category: 'quote', text: SPAN_QUOTE, span: SPAN_QUOTE },
    { answerId: a[2].id, type: 'evidence', category: 'usage_data', text: SPAN_USAGE, span: SPAN_USAGE },
  ]

  async function awaitingRound(existing?: Round, textPrefix = '', itemExtras: Record<string, Record<string, unknown>> = {}): Promise<Round> {
    const owner = existing?.owner ?? (await newUser('owner'))
    let businessId: string
    if (existing) {
      businessId = existing.businessId
    } else {
      const { data: biz, error } = await admin.from('businesses').insert({ name: `Substrate Ratify ${seq}`, owner_id: owner, plan: 'plus' }).select('id').single()
      if (error) throw error
      businessId = biz.id as string
      businessIds.push(businessId)
    }
    const created = await rpc('create_interview_round', { p_user_id: owner, p_business_id: businessId, p_questions: QUESTIONS })
    if (created.error) throw created.error
    const roundId = created.data.roundId as string
    const { rows: ar } = await pg.query<{ id: string; position: number }>('SELECT id, position FROM public.founder_interview_answers WHERE round_id = $1 ORDER BY position', [roundId])
    for (const a of ar) await rpc('save_interview_answer', { p_user_id: owner, p_answer_id: a.id, p_text: answerText(a.position) })
    await rpc('submit_interview_round', { p_user_id: owner, p_round_id: roundId })
    await rpc('claim_interview_extraction', { p_round_id: roundId })
    const items = ITEMS(ar).map((i) => {
      const text = i.type === 'evidence' ? i.text : `${textPrefix}${i.text}`
      return { ...i, text, storedText: text, storedSpan: i.span, ...(itemExtras[`${i.type}:${i.category}`] ?? {}) }
    })
    const w = await rpc('write_interview_candidates', { p_round_id: roundId, p_items: { items, counters: { proposed: items.length, droppedUngrounded: 0, droppedPerformanceClaim: 0 } } })
    expect(w.data.status).toBe('awaiting_ratification')
    const cands: Cand[] = []
    for (const type of ['brand', 'audience', 'evidence'] as Type[]) {
      const { rows } = await pg.query<{ id: string; cat: string }>(
        `SELECT m.id, m.${CAT_COL[type]} AS cat FROM public.${TABLE[type]} m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id WHERE a.round_id = $1`,
        [roundId],
      )
      for (const r of rows) cands.push({ type, id: r.id, category: r.cat })
    }
    return { businessId, roundId, owner, cands }
  }

  const acceptAll = (r: Round, replaces?: { candKey: string; type: Type; id: string }) =>
    r.cands.map((c) => ({
      type: c.type,
      id: c.id,
      decision: 'accept',
      ...(replaces && `${c.type}:${c.category}` === replaces.candKey ? { replaces: { type: replaces.type, id: replaces.id } } : {}),
    }))

  // A business with one RATIFIED, backdated first round, ready for a second.
  async function withFirstRound(): Promise<Round> {
    const first = await awaitingRound()
    const res = await ratify(first, first.owner, acceptAll(first))
    expect(res.data?.outcome).toBe('ratified')
    await pg.query("UPDATE public.founder_interview_rounds SET created_at = now() - interval '40 days' WHERE id = $1", [first.roundId])
    return first
  }

  async function importRun(businessId: string): Promise<string> {
    const { rows: acct } = await pg.query<{ id: string }>(
      `INSERT INTO public.social_accounts (business_id, platform, platform_user_id, platform_username, vault_access_token_id, connected_at)
       VALUES ($1, 'twitter', $2, 'subst_ratify_handle', '00000000-0000-4000-8000-0000000000d1', now()) RETURNING id`,
      [businessId, `x-subst-ratify-${seq++}`],
    )
    const { rows: run } = await pg.query<{ id: string }>("INSERT INTO public.social_backfill_runs (business_id, social_account_id, platform) VALUES ($1, $2, 'twitter') RETURNING id", [businessId, acct[0].id])
    return run[0].id
  }

  // An ACTIVE audience_memory row of the given source (audience is the type the import writer AND the dismissal writer share).
  async function audienceRow(businessId: string, source: 'import' | 'dismissal' | 'distilled' | 'manual', statement: string): Promise<{ id: string; runId: string | null }> {
    if (source === 'import') {
      const runId = await importRun(businessId)
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.audience_memory (business_id, source, scope, kind, statement, status, confidence, import_run_id, import_source_post_ids)
         VALUES ($1, 'import', 'platform', 'objection', $2, 'active', 0.3, $3, ARRAY['p1']) RETURNING id`,
        [businessId, statement, runId],
      )
      return { id: rows[0].id, runId }
    }
    if (source === 'dismissal') {
      const { rows } = await pg.query<{ id: string }>(
        `INSERT INTO public.audience_memory (business_id, source, scope, kind, statement, status, confidence, decision_key)
         VALUES ($1, 'dismissal', 'brand', 'other', $2, 'active', 0.4, $3) RETURNING id`,
        [businessId, statement, `dismissal:not_relevant:github:subst/${seq++}`],
      )
      return { id: rows[0].id, runId: null }
    }
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.audience_memory (business_id, source, scope, kind, statement, status, confidence) VALUES ($1, $2, 'brand', 'objection', $3, 'active', 0.3) RETURNING id`,
      [businessId, source, statement],
    )
    return { id: rows[0].id, runId: null }
  }

  const audRow = async (id: string) => (await pg.query('SELECT * FROM public.audience_memory WHERE id = $1', [id])).rows[0]

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

  // ─── the new capability ─────────────────────────────────────────────────────

  it("an ACTIVE import target listed in the accepting candidate's own conflict ids is RETIRED, keeping source=import AND import_run_id", async () => {
    const first = await withFirstRound()
    const target = await audienceRow(first.businessId, 'import', 'Imported: buyers worry about security')
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [target.id] } })
    const cand = at(r, 'audience:objection')
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))
    expect(res.error, JSON.stringify(res.error)).toBeNull()
    expect(res.data).toMatchObject({ outcome: 'ratified', accepted: 5, replaced: 1 })

    const retired = await audRow(target.id)
    expect(retired.status).toBe('retired')
    expect(retired.source).toBe('import') // provenance survives its own retirement (L-5)
    expect(retired.import_run_id).toBe(target.runId)
    expect(retired.import_source_post_ids).toEqual(['p1'])
    expect((await audRow(cand.id)).status).toBe('active')
    expect((await audRow(cand.id)).source).toBe('interview')
  })

  it('remove_import_source_post tolerates that RETIRED import row (L2.0 premise 6): it does not throw', async () => {
    const first = await withFirstRound()
    const target = await audienceRow(first.businessId, 'import', 'Imported: pricing is unclear')
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [target.id] } })
    expect((await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))).data?.outcome).toBe('ratified')
    expect((await audRow(target.id)).status).toBe('retired')
    const removed = await rpc('remove_import_source_post', { p_business_id: first.businessId, p_platform_post_id: 'p1' })
    expect(removed.error, JSON.stringify(removed.error)).toBeNull()
  })

  // ─── the bounds that did NOT move ───────────────────────────────────────────

  it("the SAME import id NOT listed in the candidate's conflict ids is REJECTED (22023) and stays active", async () => {
    const first = await withFirstRound()
    const target = await audienceRow(first.businessId, 'import', 'Imported: an unlisted claim')
    const r = await awaitingRound(first, 'Second ') // no conflictIds at all
    const before = await audRow(target.id)
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))
    expect(res.error?.code).toBe('22023')
    expect(res.error?.message).toMatch(/not one of this candidate's own conflict ids/)
    expect(await audRow(target.id)).toEqual(before)
    expect((await pg.query('SELECT status FROM public.founder_interview_rounds WHERE id = $1', [r.roundId])).rows[0].status).toBe('awaiting_ratification')
  })

  it("a business-B import id placed in a business-A candidate's conflict list is dropped at write time and REJECTED at ratify; B's row stays active", async () => {
    const first = await withFirstRound()
    const other = await awaitingRound() // business B, with its own owner
    const foreign = await audienceRow(other.businessId, 'import', 'Imported in business B')
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [foreign.id] } })
    const { rows } = await pg.query<{ ids: string[] | null }>('SELECT interview_conflict_ids AS ids FROM public.audience_memory WHERE id = $1', [at(r, 'audience:objection').id])
    expect(rows[0].ids ?? [], "the foreign id must not have been persisted as A's conflict").not.toContain(foreign.id)
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: foreign.id }))
    expect(res.error?.code).toBe('22023')
    expect((await audRow(foreign.id)).status).toBe('active')
  })

  it('an INTERVIEW target still works exactly as before (regression arm): retired, still source=interview', async () => {
    const first = await withFirstRound()
    const target = at(first, 'audience:objection') // ratified above, so it is an ACTIVE interview row
    expect((await audRow(target.id)).status).toBe('active')
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [target.id] } })
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))
    expect(res.data).toMatchObject({ outcome: 'ratified', replaced: 1 })
    const retired = await audRow(target.id)
    expect(retired.status).toBe('retired')
    expect(retired.source).toBe('interview')
  })

  // ─── never an earned or manual row ──────────────────────────────────────────

  it.each(['distilled', 'manual', 'dismissal'] as const)("a replace target with source '%s' is REJECTED (22023) even when listed — the allow-list is explicit, not 'everything except'", async (source) => {
    const first = await withFirstRound()
    const target = await audienceRow(first.businessId, source, `A ${source} row`)
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [target.id] } })
    expect((await audRow(target.id)).status, 'seed must be ACTIVE').toBe('active')
    const before = await audRow(target.id)
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))
    expect(res.error?.code).toBe('22023')
    expect(res.error?.message).toMatch(/not an active interview record of this business/)
    expect(await audRow(target.id)).toEqual(before)
    expect((await pg.query('SELECT status FROM public.founder_interview_rounds WHERE id = $1', [r.roundId])).rows[0].status).toBe('awaiting_ratification')
  })

  it('an OUTCOME performance_memory row cannot be replaced: its id is never a conflict of a brand candidate, and it stays active', async () => {
    const first = await withFirstRound()
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.performance_memory (business_id, source, status, scope, dimension, pattern, pattern_key, platform, confidence, observation_count,
         outcome_n, outcome_wins, outcome_distinct_campaigns, interval_low, interval_high, metric_basis, baseline_seeded)
       VALUES ($1, 'outcome', 'active', 'brand', 'role', 'outcome text', $2, 'linkedin', 0.4, 11, 11, 9, 3, 0.6, 0.95, 'rate', false) RETURNING id`,
      [first.businessId, `outcome:role:subst:above:linkedin:${seq++}`],
    )
    const r = await awaitingRound(first, 'Second ', { 'brand:positioning': { conflictIds: [rows[0].id] } })
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'brand:positioning', type: 'brand', id: rows[0].id }))
    expect(res.error?.code).toBe('22023')
    expect((await pg.query('SELECT status FROM public.performance_memory WHERE id = $1', [rows[0].id])).rows[0].status).toBe('active')
  })

  it('a replace of a RETIRED import row (not active) is REJECTED — only an ACTIVE target may be replaced', async () => {
    const first = await withFirstRound()
    const target = await audienceRow(first.businessId, 'import', 'Imported, later retired')
    await pg.query("UPDATE public.audience_memory SET status = 'retired' WHERE id = $1", [target.id])
    const r = await awaitingRound(first, 'Second ', { 'audience:objection': { conflictIds: [target.id] } })
    const res = await ratify(r, r.owner, acceptAll(r, { candKey: 'audience:objection', type: 'audience', id: target.id }))
    expect(res.error?.code).toBe('22023')
    expect((await audRow(target.id)).status).toBe('retired')
  })

  // ─── the function itself ────────────────────────────────────────────────────

  it('the function has ONE definition, is SECURITY DEFINER with a fixed search_path, and is executable by service_role ONLY (CREATE OR REPLACE kept the ACLs)', async () => {
    const { rows } = await pg.query<{ n: string; secdef: boolean; cfg: string[] | null; anon: boolean; auth: boolean; pub: boolean; svc: boolean }>(
      `SELECT count(*) OVER ()::text AS n, p.prosecdef AS secdef, p.proconfig AS cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p WHERE p.proname = 'ratify_interview_round'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ n: '1', secdef: true, anon: false, auth: false, pub: false, svc: true })
    expect(rows[0].cfg).toEqual(['search_path=public, pg_temp'])
  })

  it("the allow-list is EXPLICIT in the function body: source IN ('interview', 'import') at the probe and the retire, and never a source <> / NOT IN form", async () => {
    const { rows } = await pg.query<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'ratify_interview_round'")
    const src = rows[0].src
    expect((src.match(/source IN \(''interview'', ''import''\)/g) ?? []).length).toBe(2)
    expect(src).not.toMatch(/source <> ''/)
    expect(src).not.toMatch(/source NOT IN/i)
    // v_rep_type stays limited to the three interview tables
    expect(src).toMatch(/\(v_rep ->> 'type'\) NOT IN \('brand', 'audience', 'evidence'\)/)
  })
})
