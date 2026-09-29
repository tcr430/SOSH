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
