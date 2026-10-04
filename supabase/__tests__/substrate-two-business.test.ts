import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBiz, createUser, seedRepo, seedCard, recompute, dismissalRows, destroy, PASSWORD, type Biz } from '../__helpers__/dismissal-fixtures'

// ADR 0030 §7.3 (Session 36 L2.5) — SUBSTRATE-RLS-ISOLATED (24) and SUBSTRATE-DISMISS-TENANT-BOUND (20): the TWO-BUSINESSES-ONE-USER arm.
//
// get_user_business_ids() returns an ARRAY, so for a user who belongs to two businesses RLS does NOT isolate one from the other, and
// `.eq('business_id', …)` on the query is the sole boundary (cerebrum, Session 34 K1). That is exactly the situation this file builds:
// ONE user who owns businesses A and B. Every arm has a POSITIVE CONTROL (B holds at least one ACTIVE dismissal row), so "nothing was
// written in B" cannot be vacuously true. Later steps (L2.7-L2.9) extend this file with the bundle and the triage reader.

describe('two businesses, one user (ADR 0030 §7.3)', () => {
  let pg: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let user: { id: string; email: string }
  let A: Biz
  let B: Biz
  let member: SupabaseClient
  const bizIds: string[] = []
  const userIds: string[] = []

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    user = await createUser(admin, 'two-biz')
    userIds.push(user.id)
    A = await createBiz(admin, 'two-biz-a', user)
    B = await createBiz(admin, 'two-biz-b', user)
    bizIds.push(A.id, B.id)

    member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await member.auth.signInWithPassword({ email: user.email, password: PASSWORD })
    if (error) throw error
  })

  afterAll(async () => {
    await destroy(admin, pg, bizIds, userIds)
    await pg.end()
  }, 180_000)

  // B holds an ACTIVE dismissal row (3 of 3) — the positive control every arm below relies on.
  async function seedBActiveRow() {
    const repo = await seedRepo(admin, B, { owner: 'bcorp', name: `widgets-${Math.random().toString(36).slice(2, 8)}` })
    const cards = await Promise.all([1, 2, 3].map(() => seedCard(admin, B, repo, { status: 'dismissed', reason: 'not_relevant' })))
    await recompute(admin, cards[0])
    const rows = await dismissalRows(pg, B.id)
    const row = rows.find((r) => r.decision_key === `dismissal:not_relevant:github:${repo.id}`)
    expect(row, 'the positive control did not materialise').toBeDefined()
    expect(row.status).toBe('active')
    return row
  }

  it("a dismissal in business A writes a row in A and NOTHING in B; B's active row is byte-identical afterwards (positive control)", async () => {
    const before = await seedBActiveRow()
    const repo = await seedRepo(admin, A, { owner: 'acorp', name: 'gadgets' })
    const card = await seedCard(admin, A, repo, { status: 'pending' })
    // the member's own client, exactly the transition dismissCardAction makes, filtered by the ACTIVE business (A)
    const { data, error } = await member.from('insight_cards').update({ status: 'dismissed', dismiss_reason: 'not_relevant' }).eq('id', card).eq('business_id', A.id).select('id')
    expect(error, JSON.stringify(error)).toBeNull()
    expect(data).toHaveLength(1)
    expect((await recompute(admin, card)).error).toBeNull()

    const aRows = await dismissalRows(pg, A.id)
    expect(aRows).toHaveLength(1)
    expect(aRows[0].statement).toContain('acorp/gadgets')
    const bRows = await dismissalRows(pg, B.id)
    const after = bRows.find((r) => r.id === before.id)
    expect(after).toEqual(before)
    expect(bRows.every((r) => !r.statement.includes('acorp/gadgets'))).toBe(true)
  })

  it("dismissing A's card while B is the ACTIVE business updates ZERO rows: the transition fails, so no RPC call and no write anywhere", async () => {
    const before = await seedBActiveRow()
    const repo = await seedRepo(admin, A, { owner: 'acorp', name: 'thingamajigs' })
    const card = await seedCard(admin, A, repo, { status: 'pending' })
    const aBefore = await dismissalRows(pg, A.id)

    // the SAME member, the SAME card id, but the query is scoped to business B (the active-business context is B)
    const { data, error } = await member.from('insight_cards').update({ status: 'dismissed', dismiss_reason: 'not_relevant' }).eq('id', card).eq('business_id', B.id).select('id')
    expect(error, JSON.stringify(error)).toBeNull()
    expect(data ?? []).toHaveLength(0)
    const { rows } = await pg.query('SELECT status, dismiss_reason FROM public.insight_cards WHERE id = $1', [card])
    expect(rows[0]).toEqual({ status: 'pending', dismiss_reason: null })

    // the action stops at the failed transition and never calls the RPC; even if something DID call it, a pending card is a no-op
    expect((await recompute(admin, card)).data).toBe('noop_card_state')
    expect(await dismissalRows(pg, A.id)).toEqual(aBefore)
    const bRows = await dismissalRows(pg, B.id)
    expect(bRows.find((r) => r.id === before.id)).toEqual(before)
  })

  it('the RPC re-derives the business from the CARD: a card of A is never attributed to B, whatever is in flight for B', async () => {
    await seedBActiveRow()
    const repo = await seedRepo(admin, A, { owner: 'acorp', name: 'gizmos' })
    const cards = await Promise.all([1, 2, 3].map(() => seedCard(admin, A, repo, { status: 'dismissed', reason: 'not_relevant' })))
    await recompute(admin, cards[0])
    const aRows = (await dismissalRows(pg, A.id)).filter((r) => r.decision_key === `dismissal:not_relevant:github:${repo.id}`)
    expect(aRows).toHaveLength(1)
    expect(aRows[0].business_id).toBe(A.id)
    expect((await dismissalRows(pg, B.id)).every((r) => r.business_id === B.id)).toBe(true)
  })

  // ADR 0030 §6.8 / §7.3 row 5 (L2.9) — the triage READ of dismissal rows. B holds >= 1 ACTIVE dismissal row (positive control), so "A's read holds none
  // of B's" is not vacuous. Run under BOTH clients the read can be handed: the service-role one (no RLS at all) and the member's own (RLS admits BOTH
  // businesses to this user, because get_user_business_ids() is an array), so `.eq('business_id')` is the only boundary in either.
  it("A's triage list_audience_notes returns 0 of B's dismissal rows while B holds >= 1 ACTIVE one (service-role AND member client)", async () => {
    const before = await seedBActiveRow()
    expect(before.business_id).toBe(B.id)
    const repoA = await seedRepo(admin, A, { owner: 'acorp', name: `triage-${Math.random().toString(36).slice(2, 8)}` })
    const cardsA = await Promise.all([1, 2, 3].map(() => seedCard(admin, A, repoA, { status: 'dismissed', reason: 'not_relevant' })))
    await recompute(admin, cardsA[0])
    const aActive = (await dismissalRows(pg, A.id)).filter((r) => r.status === 'active')
    expect(aActive.length, "A's own dismissal positive control did not materialise").toBeGreaterThanOrEqual(1)

    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const { SOURCE_DISMISSAL_CAP } = await import('@/lib/memory/constants')
    const read = async (client: SupabaseClient, biz: Biz) => {
      const tool = buildTriageTools(client, biz.id).find((t) => t.name === 'list_audience_notes')!
      return (await tool.execute({})) as unknown as Array<{ id: string; statement: string }>
    }

    for (const [label, client] of [['service-role', admin as SupabaseClient], ['member', member]] as const) {
      const forB = await read(client, B)
      expect(forB.some((r) => r.statement.includes('bcorp/')), `${label}: B's own read must see its dismissal row`).toBe(true)
      expect(forB.some((r) => r.statement.includes('acorp/')), `${label}: B's read holds a row of A`).toBe(false)

      const forA = await read(client, A)
      expect(forA.length, `${label}: A's read is exactly A's active dismissal rows (capped)`).toBe(Math.min(aActive.length, SOURCE_DISMISSAL_CAP))
      expect(forA.every((r) => r.statement.includes('acorp/')), `${label}: A's read holds a row that is not A's`).toBe(true)
      expect(forA.some((r) => r.statement.includes('bcorp/')), `${label}: A's read holds a row of B`).toBe(false)
    }
  })
})

// ADR 0030 §3.4 / §7.3 (Session 36 L2.7) — SUBSTRATE-EXISTENCE-READ (13) Tier 2 + the authored two-businesses arm of SUBSTRATE-RLS-ISOLATED (24).
// hasActiveEvidence runs under SERVICE ROLE on the generation path (which bypasses RLS), so `.eq('business_id')` is the ONLY tenant boundary. The
// positive control is B holding an ACTIVE, unexpired evidence row: "A gets false" is meaningless unless the row exists for someone.
describe('hasActiveEvidence — an existence read under service role (ADR 0030 §3.4)', () => {
  let pgc: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adm: any
  const bizs: string[] = []
  const users: string[] = []

  beforeAll(async () => {
    pgc = new Client({ connectionString: process.env.DATABASE_URL })
    await pgc.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    adm = createServiceRoleClient()
  })
  afterAll(async () => {
    await destroy(adm, pgc, bizs, users)
    await pgc.end()
  }, 120_000)

  async function evBiz(label: string): Promise<Biz> {
    const u = await createUser(adm, label)
    users.push(u.id)
    const b = await createBiz(adm, label, u)
    bizs.push(b.id)
    return b
  }
  const evidence = (businessId: string, over: Record<string, unknown> = {}) =>
    pgc.query(
      `INSERT INTO public.evidence_memory (business_id, source, scope, kind, content, status, expires_at) VALUES ($1, 'manual', 'brand', 'quote', $2, $3, $4)`,
      [businessId, `evidence ${Math.random().toString(36).slice(2)}`, over.status ?? 'active', over.expires_at ?? null],
    )

  it('A has NO evidence and B holds one ACTIVE row -> false for A, true for B (positive control)', async () => {
    const { hasActiveEvidence } = await import('@/lib/db/memory-evidence')
    const a = await evBiz('ev-a')
    const b = await evBiz('ev-b')
    await evidence(b.id)
    expect(await hasActiveEvidence(adm, b.id), 'the positive control did not materialise').toBe(true)
    expect(await hasActiveEvidence(adm, a.id)).toBe(false)
  })

  it('an EXPIRED-only corpus -> false; one unexpired active row alongside -> true', async () => {
    const { hasActiveEvidence } = await import('@/lib/db/memory-evidence')
    const a = await evBiz('ev-expired')
    await evidence(a.id, { expires_at: new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z') })
    expect(await hasActiveEvidence(adm, a.id)).toBe(false)
    await evidence(a.id, { expires_at: null })
    expect(await hasActiveEvidence(adm, a.id)).toBe(true)
  })

  it('candidate and retired rows do not count; a soft-deleted active row does not count', async () => {
    const { hasActiveEvidence } = await import('@/lib/db/memory-evidence')
    const a = await evBiz('ev-inactive')
    await evidence(a.id, { status: 'candidate' })
    await evidence(a.id, { status: 'retired' })
    await pgc.query(`INSERT INTO public.evidence_memory (business_id, source, scope, kind, content, status, deleted_at) VALUES ($1, 'manual', 'brand', 'quote', 'soft deleted', 'active', now())`, [a.id])
    expect(await hasActiveEvidence(adm, a.id)).toBe(false)
  })
})

// ADR 0030 §5 / §7.3 (Session 36 L2.8) — the bundle arm of SUBSTRATE-RLS-ISOLATED (24), SUBSTRATE-CROSS-TYPE-BUDGET (14) and
// SUBSTRATE-OUTCOME-SEPARATE (16). retrieveMemoryBundle runs under SERVICE ROLE on the brief path (RLS bypassed), so `.eq('business_id')` inside
// the four listers is the ONLY tenant boundary. Business B holds an ACTIVE row of EVERY type, plus an ACTIVE 'outcome' performance row and an
// ACTIVE 'dismissal' audience row: "A gets nothing of B's" and "the bundle omits outcome and dismissal rows" are meaningless without them.
describe('retrieveMemoryBundle — a service-role cross-type read (ADR 0030 §5)', () => {
  let pgb: Client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adm: any
  const bizs: string[] = []
  const users: string[] = []

  beforeAll(async () => {
    pgb = new Client({ connectionString: process.env.DATABASE_URL })
    await pgb.connect()
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    adm = createServiceRoleClient()
  })
  afterAll(async () => {
    await destroy(adm, pgb, bizs, users)
    await pgb.end()
  }, 120_000)

  async function bundleBiz(label: string): Promise<Biz> {
    const u = await createUser(adm, label)
    users.push(u.id)
    const b = await createBiz(adm, label, u)
    bizs.push(b.id)
    return b
  }

  async function seedEveryType(biz: Biz, tag: string) {
    await pgb.query(`INSERT INTO public.brand_memory (business_id, source, scope, category, statement, status) VALUES ($1, 'manual', 'brand', 'positioning', $2, 'active')`, [biz.id, `${tag} brand fact`])
    await pgb.query(`INSERT INTO public.evidence_memory (business_id, source, scope, kind, content, status) VALUES ($1, 'manual', 'brand', 'quote', $2, 'active')`, [biz.id, `${tag} evidence quote`])
    await pgb.query(`INSERT INTO public.audience_memory (business_id, source, scope, kind, statement, status) VALUES ($1, 'manual', 'brand', 'problem', $2, 'active')`, [biz.id, `${tag} audience note`])
    await pgb.query(`INSERT INTO public.performance_memory (business_id, source, scope, dimension, pattern, status, observation_count) VALUES ($1, 'manual', 'brand', 'topic', $2, 'active', 9)`, [biz.id, `${tag} governed pattern`])
  }

  it("A's bundle holds none of B's rows of any type while B holds one ACTIVE row of every type (positive control)", async () => {
    const { retrieveMemoryBundle, renderMemoryBundleForPrompt } = await import('@/lib/memory')
    const a = await bundleBiz('bundle-a')
    const b = await bundleBiz('bundle-b')
    await seedEveryType(b, 'B-only')

    const forB = await retrieveMemoryBundle(adm, b.id, { task: 'post' })
    expect({ brand: forB.count('brand'), evidence: forB.count('evidence'), audience: forB.count('audience'), performance: forB.count('performance') }, 'the positive control did not materialise')
      .toEqual({ brand: 1, evidence: 1, audience: 1, performance: 1 })

    const forA = await retrieveMemoryBundle(adm, a.id, { task: 'post' })
    expect(JSON.parse(JSON.stringify(forA))).toEqual({ brand: 0, evidence: 0, audience: 0, performance: 0 })
    expect(forA.evidenceIds()).toEqual([])
    const rendered = await renderMemoryBundleForPrompt(forA)
    expect(`${rendered.brand}${rendered.audience}${rendered.performance}${rendered.evidence.rendered}`).not.toContain('B-only')
  })

  it("the brief bundle reads NO performance even when the business has an ACTIVE governed pattern (ceiling 0)", async () => {
    const { retrieveMemoryBundle } = await import('@/lib/memory')
    const b = await bundleBiz('bundle-brief')
    await seedEveryType(b, 'brief')
    const bundle = await retrieveMemoryBundle(adm, b.id, { task: 'brief' })
    expect(bundle.count('performance')).toBe(0)
    expect([bundle.count('brand'), bundle.count('evidence'), bundle.count('audience')]).toEqual([1, 1, 1])
  })

  it("an ACTIVE 'outcome' performance row and an ACTIVE 'dismissal' audience row never enter the bundle (positive controls exist)", async () => {
    const { retrieveMemoryBundle, renderMemoryBundleForPrompt } = await import('@/lib/memory')
    const b = await bundleBiz('bundle-separate')
    await seedEveryType(b, 'sep')
    await pgb.query(
      `INSERT INTO public.performance_memory (business_id, source, scope, dimension, pattern, pattern_key, status, observation_count, outcome_n, outcome_wins, outcome_distinct_campaigns, interval_low, interval_high, metric_basis, baseline_seeded)
       VALUES ($1, 'outcome', 'brand', 'role', 'OUTCOME-ROW-MARKER', 'outcome:role:sep', 'active', 8, 8, 6, 2, 0.4, 0.9, 'count', false)`,
      [b.id],
    )
    const repo = await seedRepo(adm, b, { owner: 'sepcorp', name: `widgets-${Math.random().toString(36).slice(2, 8)}` })
    const cards = await Promise.all([1, 2, 3].map(() => seedCard(adm, b, repo, { status: 'dismissed', reason: 'not_relevant' })))
    await recompute(adm, cards[0])
    const dismissals = (await dismissalRows(pgb, b.id)).filter((r) => r.status === 'active')
    expect(dismissals.length, 'the dismissal positive control did not materialise').toBeGreaterThanOrEqual(1)
    const { rows: outcome } = await pgb.query(`SELECT count(*)::int AS n FROM public.performance_memory WHERE business_id = $1 AND source = 'outcome' AND status = 'active'`, [b.id])
    expect(outcome[0].n, 'the outcome positive control did not materialise').toBe(1)

    const bundle = await retrieveMemoryBundle(adm, b.id, { task: 'post' })
    expect(bundle.count('performance')).toBe(1)
    expect(bundle.count('audience')).toBe(1)
    const r = await renderMemoryBundleForPrompt(bundle)
    expect(r.performance).not.toContain('OUTCOME-ROW-MARKER')
    expect(r.performance).toContain('sep governed pattern')
    expect(r.audience).not.toContain('sepcorp/')
    expect(r.audience).toContain('sep audience note')
  })
})
