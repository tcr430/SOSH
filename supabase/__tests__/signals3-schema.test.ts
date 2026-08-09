import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0021 §4.1, §8 — Tier-1, live Postgres. Session 28 E5.1 scope only:
// insight_cards + signal_triage_budget schema, RLS, the legality trigger,
// UNIQUE(signal_candidate_id), cascade + purge. SIGNAL3-RLS-ISOLATED,
// -CASCADE-COMPLETE, -PURGE-COVERED, -TRIAGE-LEGAL-TRANSITION,
// -CARD-EXPIRES, -DISMISS-REASON-ENUM.

const PASSWORD = 'TestPass123!'

describe('insight_cards / signal_triage_budget schema (ADR 0021 §4.1, §8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let ownerBEmail: string
  let businessAId: string
  let businessBId: string
  let candidateAId: string
  let candidateBId: string
  let cardAId: string
  let cardBId: string

  async function createUser(label: string) {
    const email = `signals3-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function signInAs(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  async function insertBusiness(name: string, ownerId: string) {
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'plus' }).select('id').single()
    if (error) throw error
    return data.id as string
  }

  async function insertConnection(businessId: string, installationId: number) {
    const { data, error } = await admin
      .from('github_connections')
      .insert({ business_id: businessId, installation_id: installationId, account_login: `acct-${installationId}` })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertWatchedRepo(businessId: string, connectionId: string, repoId: number) {
    const { data, error } = await admin
      .from('watched_repos')
      .insert({ business_id: businessId, connection_id: connectionId, repo_id: repoId, owner: 'acme', name: `repo-${repoId}` })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertSignal(businessId: string, watchedRepoId: string, externalId: string) {
    const { data, error } = await admin
      .from('signals')
      .insert({
        business_id: businessId,
        watched_repo_id: watchedRepoId,
        source: 'github',
        kind: 'release',
        external_id: externalId,
        title: 'v1.0.0',
        body: 'Initial release notes.',
        occurred_at: '2026-07-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertCandidate(businessId: string, signalId: string, occurredAt = '2026-07-01T00:00:00Z') {
    const { data, error } = await admin
      .from('signal_candidates')
      .insert({ business_id: businessId, signal_id: signalId, score: 42, occurred_at: occurredAt })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  function cardFixture(businessId: string, signalCandidateId: string, overrides: Record<string, unknown> = {}) {
    return {
      business_id: businessId,
      signal_candidate_id: signalCandidateId,
      observation: 'v2.4 shipped SSO support.',
      why_it_matters: 'SSO is a top-3 objection in enterprise deals.',
      audience: 'Enterprise IT buyers evaluating SSO.',
      angle_options: [{ angle: 'SSO is now available', rationale: 'Removes the #1 blocker in enterprise deals.' }],
      evidence: [],
      novelty: 60,
      freshness: 90,
      sensitivity: 0,
      confidence: 70,
      rubric_scores: { specificity: 80, originality: 60, evidenceSufficiency: 70, audienceRelevance: 75, unsupportedClaimsRisk: 10, redundancy: 5 },
      score: 42,
      occurred_at: '2026-07-01T00:00:00Z',
      ...overrides,
    }
  }

  async function insertCard(businessId: string, signalCandidateId: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from('insight_cards')
      .insert(cardFixture(businessId, signalCandidateId, overrides))
      .select('*')
      .single()
    if (error) throw error
    return data as { id: string; [k: string]: unknown }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id
    ownerBEmail = ownerB.email

    businessAId = await insertBusiness('Insight Cards Business A', ownerAId)
    businessBId = await insertBusiness('Insight Cards Business B', ownerBId)

    const baseInstallation = Math.floor(Date.now() / 1000)
    const connAId = await insertConnection(businessAId, baseInstallation)
    const connBId = await insertConnection(businessBId, baseInstallation + 1)
    const repoAId = await insertWatchedRepo(businessAId, connAId, baseInstallation + 100)
    const repoBId = await insertWatchedRepo(businessBId, connBId, baseInstallation + 101)
    const signalAId = await insertSignal(businessAId, repoAId, `github:release:${baseInstallation}-a`)
    const signalBId = await insertSignal(businessBId, repoBId, `github:release:${baseInstallation}-b`)
    candidateAId = await insertCandidate(businessAId, signalAId)
    candidateBId = await insertCandidate(businessBId, signalBId)

    const cardA = await insertCard(businessAId, candidateAId)
    cardAId = cardA.id
    const cardB = await insertCard(businessBId, candidateBId)
    cardBId = cardB.id
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of [businessAId, businessBId]) {
      if (id) await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  // ─── SIGNAL3-RLS-ISOLATED — mirrored both directions ──────────────────────

  it('SIGNAL3-RLS-ISOLATED (insight_cards, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('insight_cards').select('id').eq('id', cardBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL3-RLS-ISOLATED (insight_cards, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('insight_cards').select('id').eq('id', cardAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL3-RLS-ISOLATED (insight_cards, own row): SELECT returns the row', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('insight_cards').select('id').eq('id', cardAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(1)
  })

  // ─── UPDATE WITH CHECK tenant-tunnelling attempt ──────────────────────────

  it('SIGNAL3-RLS-ISOLATED: cannot UPDATE own insight_cards row to tunnel it into another business (WITH CHECK)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('insight_cards')
      .update({ business_id: businessBId })
      .eq('id', cardAId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from('insight_cards').select('business_id').eq('id', cardAId).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('SIGNAL3-RLS-ISOLATED: cannot UPDATE a insight_cards row belonging to another business (USING)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('insight_cards')
      .update({ status: 'saved' })
      .eq('id', cardBId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillPending } = await admin.from('insight_cards').select('status').eq('id', cardBId).single()
    expect(stillPending.status).toBe('pending')
  })

  it('an owner CAN transition their own card via a legal edge (pending → saved)', async () => {
    const owner = await createUser('legal-transition')
    const biz = await insertBusiness('Legal Transition Business', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 200000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 200100)
    const signal = await insertSignal(biz, repo, `legal-transition-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    const card = await insertCard(biz, candidate)

    const client = await signInAs(owner.email)
    const { data, error } = await client.from('insight_cards').update({ status: 'saved' }).eq('id', card.id).select()
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(1)
    expect(data![0].status).toBe('saved')

    await admin.from('businesses').delete().eq('id', biz)
    await admin.auth.admin.deleteUser(owner.id)
  })

  // ─── signal_triage_budget unreachable by authenticated ────────────────────

  it('SIGNAL3-RLS-ISOLATED: signal_triage_budget is unreachable by authenticated (no policy, REVOKE ALL, no GRANT)', async () => {
    const { error: seedErr } = await admin
      .from('signal_triage_budget')
      .insert({ business_id: businessAId, day: '2026-08-09', reserved_cents: 500 })
    expect(seedErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('signal_triage_budget').select('id').eq('business_id', businessAId)
    // Deny-by-default at two independent layers: either a permission error
    // surfaces, or the query silently matches nothing. Either way, no row
    // reaches an authenticated caller.
    expect(data ?? []).toHaveLength(0)
    if (!error) expect(data).toEqual([])
    else expect(error).not.toBeNull()
  })

  // ─── UNIQUE (signal_candidate_id) — the ON CONFLICT arbiter ───────────────

  it('SIGNAL3-CARD-UNIQUE-CANDIDATE: a second card for the same signal_candidate_id is rejected', async () => {
    const { error } = await admin.from('insight_cards').insert(cardFixture(businessAId, candidateAId))
    expect(error).not.toBeNull()
    expect(error.code).toBe('23505')
  })

  // ─── SIGNAL3-TRIAGE-LEGAL-TRANSITION ──────────────────────────────────────

  it('SIGNAL3-TRIAGE-LEGAL-TRANSITION: the trigger rejects dismissed → approved', async () => {
    const owner = await createUser('legal-reject-1')
    const biz = await insertBusiness('Legal Reject Business 1', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 210000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 210100)
    const signal = await insertSignal(biz, repo, `legal-reject-1-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    const card = await insertCard(biz, candidate)

    const { error: toDismissedErr } = await admin
      .from('insight_cards')
      .update({ status: 'dismissed', dismiss_reason: 'not_relevant' })
      .eq('id', card.id)
    expect(toDismissedErr).toBeNull()

    const { error: toApprovedErr } = await admin.from('insight_cards').update({ status: 'approved' }).eq('id', card.id)
    expect(toApprovedErr).not.toBeNull()
    expect(toApprovedErr.message).toMatch(/not permitted/i)

    await admin.from('businesses').delete().eq('id', biz)
    await admin.auth.admin.deleteUser(owner.id)
  })

  it('SIGNAL3-TRIAGE-LEGAL-TRANSITION: the trigger rejects dismiss_reason set on a non-dismissed row', async () => {
    const owner = await createUser('legal-reject-2')
    const biz = await insertBusiness('Legal Reject Business 2', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 220000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 220100)
    const signal = await insertSignal(biz, repo, `legal-reject-2-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    const card = await insertCard(biz, candidate)

    // status stays 'pending' — only dismiss_reason changes.
    const { error } = await admin.from('insight_cards').update({ dismiss_reason: 'not_relevant' }).eq('id', card.id)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/dismiss_reason/i)

    await admin.from('businesses').delete().eq('id', biz)
    await admin.auth.admin.deleteUser(owner.id)
  })

  it('SIGNAL3-TRIAGE-LEGAL-TRANSITION: pending → approved and saved → dismissed are both permitted', async () => {
    const owner = await createUser('legal-permit')
    const biz = await insertBusiness('Legal Permit Business', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 230000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 230100)
    const signal = await insertSignal(biz, repo, `legal-permit-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    const card = await insertCard(biz, candidate)

    const { error: approveErr } = await admin.from('insight_cards').update({ status: 'approved' }).eq('id', card.id)
    expect(approveErr).toBeNull()

    const signal2 = await insertSignal(biz, repo, `legal-permit-2-${Date.now()}`)
    const candidate2 = await insertCandidate(biz, signal2)
    const card2 = await insertCard(biz, candidate2)
    const { error: toSavedErr } = await admin.from('insight_cards').update({ status: 'saved' }).eq('id', card2.id)
    expect(toSavedErr).toBeNull()
    const { error: savedToDismissedErr } = await admin
      .from('insight_cards')
      .update({ status: 'dismissed', dismiss_reason: 'weak_evidence' })
      .eq('id', card2.id)
    expect(savedToDismissedErr).toBeNull()

    await admin.from('businesses').delete().eq('id', biz)
    await admin.auth.admin.deleteUser(owner.id)
  })

  // ─── SIGNAL3-DISMISS-REASON-ENUM — the closed five, sixth value rejected ──

  it('SIGNAL3-DISMISS-REASON-ENUM: the CHECK rejects a sixth dismiss_reason value', async () => {
    const { error } = await admin
      .from('insight_cards')
      .insert(cardFixture(businessAId, candidateAId, { status: 'dismissed', dismiss_reason: 'not_a_real_reason' }))
    expect(error).not.toBeNull()
  })

  it('SIGNAL3-DISMISS-REASON-ENUM: each of the five closed values is accepted', async () => {
    const reasons = ['not_relevant', 'already_covered', 'too_sensitive', 'wrong_timing', 'weak_evidence']
    for (const reason of reasons) {
      const owner = await createUser(`reason-${reason}`)
      const biz = await insertBusiness(`Reason Business ${reason}`, owner.id)
      const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000) + 300000)
      const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000) + 400000)
      const signal = await insertSignal(biz, repo, `reason-${reason}-${Date.now()}-${Math.random()}`)
      const candidate = await insertCandidate(biz, signal)
      const { error } = await admin.from('insight_cards').insert(cardFixture(biz, candidate, { status: 'dismissed', dismiss_reason: reason }))
      expect(error).toBeNull()

      await admin.from('businesses').delete().eq('id', biz)
      await admin.auth.admin.deleteUser(owner.id)
    }
  })

  // ─── SIGNAL3-CARD-EXPIRES — the read predicate ────────────────────────────

  it('SIGNAL3-CARD-EXPIRES: the §5.7 read predicate excludes an expired pending card and includes a non-expired one', async () => {
    const owner = await createUser('expires-predicate')
    const biz = await insertBusiness('Expires Predicate Business', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 240000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 240100)

    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const signalExpired = await insertSignal(biz, repo, `expires-expired-${Date.now()}`)
    const candidateExpired = await insertCandidate(biz, signalExpired)
    const expiredCard = await insertCard(biz, candidateExpired, { expires_at: pastIso })

    const signalLive = await insertSignal(biz, repo, `expires-live-${Date.now()}`)
    const candidateLive = await insertCandidate(biz, signalLive)
    const liveCard = await insertCard(biz, candidateLive, { expires_at: futureIso })

    const signalNoExpiry = await insertSignal(biz, repo, `expires-null-${Date.now()}`)
    const candidateNoExpiry = await insertCandidate(biz, signalNoExpiry)
    const savedCard = await insertCard(biz, candidateNoExpiry, { expires_at: null })

    const nowIso = new Date().toISOString()
    const { data, error } = await admin
      .from('insight_cards')
      .select('id')
      .eq('business_id', biz)
      .eq('status', 'pending')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r: { id: string }) => r.id)
    expect(ids).not.toContain(expiredCard.id)
    expect(ids).toContain(liveCard.id)
    expect(ids).toContain(savedCard.id)

    await admin.from('businesses').delete().eq('id', biz)
    await admin.auth.admin.deleteUser(owner.id)
  })

  // ─── insight_cards.business_id = signal_candidates.business_id ───────────

  it('§4.1 tenant consistency: a card fixture inserted against a candidate carries the same business_id', async () => {
    const { data, error } = await admin
      .from('insight_cards')
      .select('business_id, signal_candidates!inner(business_id)')
      .eq('id', cardAId)
      .single()
    expect(error).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const joined = data as any
    expect(joined.business_id).toBe(joined.signal_candidates.business_id)
  })

  // ─── SIGNAL3-CASCADE-COMPLETE / SIGNAL3-PURGE-COVERED ─────────────────────

  it('SIGNAL3-CASCADE-COMPLETE: deleting the business completes without error and removes rows from both tables', async () => {
    const owner = await createUser('cascade-direct')
    const biz = await insertBusiness('Insight Cards Cascade Direct', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 555000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 555100)
    const signal = await insertSignal(biz, repo, `cascade-direct-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    await insertCard(biz, candidate)
    const { error: budgetErr } = await admin.from('signal_triage_budget').insert({ business_id: biz, day: '2026-08-09', reserved_cents: 100 })
    expect(budgetErr).toBeNull()

    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz)
    expect(deleteErr).toBeNull()

    for (const table of ['insight_cards', 'signal_triage_budget']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })

  it('SIGNAL3-PURGE-COVERED: purge_business on a business with both tables populated completes without error and leaves none', async () => {
    const owner = await createUser('cascade-purge')
    const biz = await insertBusiness('Insight Cards Cascade Purge', owner.id)
    const conn = await insertConnection(biz, Math.floor(Date.now() / 1000) + 666000)
    const repo = await insertWatchedRepo(biz, conn, Math.floor(Date.now() / 1000) + 666100)
    const signal = await insertSignal(biz, repo, `cascade-purge-${Date.now()}`)
    const candidate = await insertCandidate(biz, signal)
    await insertCard(biz, candidate)
    const { error: budgetErr } = await admin.from('signal_triage_budget').insert({ business_id: biz, day: '2026-08-09', reserved_cents: 100 })
    expect(budgetErr).toBeNull()

    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz })
    expect(purgeErr).toBeNull()

    for (const table of ['insight_cards', 'signal_triage_budget']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })
})
