import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { config } from '@/lib/config'

// ADR 0021 §2.9, §2.11, §3.3, §0.2 A-4′ — Tier-1, live Postgres, REAL
// concurrency. Session 28 E5.2 scope: signal_candidates' widened status +
// triage_claimed_at, the amended upsert_signal_candidate guard, and the two
// cost-ceiling RPCs. SIGNAL3-COST-CEILING-ATOMIC, -CLAIM-RECLAIMABLE,
// -RESCORE-INVALIDATES-TRIAGE.

describe('triage state + cost ceiling (ADR 0021 §2.9, §2.11, §3.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const ownerIds: string[] = []
  const businessIds: string[] = []

  async function createUser(label: string) {
    const email = `signals3-triage-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    ownerIds.push(data.user.id as string)
    return data.user.id as string
  }

  async function insertBusiness(name: string) {
    const ownerId = await createUser(name.replace(/\s+/g, '-'))
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'plus' }).select('id').single()
    if (error) throw error
    businessIds.push(data.id as string)
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

  async function candidateChainFor(businessId: string, label: string) {
    const seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 500000)
    const conn = await insertConnection(businessId, seed)
    const repo = await insertWatchedRepo(businessId, conn, seed + 1)
    const signal = await insertSignal(businessId, repo, `${label}-${seed}`)
    return insertCandidate(businessId, signal)
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of businessIds) {
      await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of ownerIds) {
      await admin.auth.admin.deleteUser(id)
    }
  })

  // ─── SIGNAL3-COST-CEILING-ATOMIC ───────────────────────────────────────────

  it('SIGNAL3-COST-CEILING-ATOMIC: two concurrent reservations against one cap — exactly one wins', async () => {
    const biz = await insertBusiness('Cost Ceiling Race Business')

    const [first, second] = await Promise.all([
      admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 22, p_cap: 25 }),
      admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 22, p_cap: 25 }),
    ])

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    const wonCount = [first, second].filter((r) => (r.data ?? []).length === 1).length
    const deniedCount = [first, second].filter((r) => (r.data ?? []).length === 0).length
    expect(wonCount).toBe(1)
    expect(deniedCount).toBe(1)

    const { data: row } = await admin.from('signal_triage_budget').select('reserved_cents').eq('business_id', biz).single()
    expect(Number(row.reserved_cents)).toBe(22)
  })

  it('SIGNAL3-COST-CEILING-ATOMIC: the first call of the day succeeds ([db-BLOCKER-1] — zero existing rows must not read as capped)', async () => {
    const biz = await insertBusiness('First Call Of Day Business')

    const { data, error } = await admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 22, p_cap: 125 })
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(1)
    expect(Number(data[0].reserved_cents)).toBe(22)
  })

  it('SIGNAL3-COST-CEILING-ATOMIC: a reservation that would exceed the cap is refused (zero rows, not an error)', async () => {
    const biz = await insertBusiness('Over Cap Business')

    const first = await admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 100, p_cap: 125 })
    expect(first.error).toBeNull()
    expect(first.data ?? []).toHaveLength(1)

    const second = await admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 30, p_cap: 125 })
    expect(second.error).toBeNull()
    expect(second.data ?? []).toHaveLength(0)

    const { data: row } = await admin.from('signal_triage_budget').select('reserved_cents').eq('business_id', biz).single()
    expect(Number(row.reserved_cents)).toBe(100)
  })

  it('reconcile_triage_budget settles a reservation down to actual spend', async () => {
    const biz = await insertBusiness('Reconcile Business')
    const { data: reserved } = await admin.rpc('reserve_triage_budget', { p_business_id: biz, p_cents: 22, p_cap: 125 })
    expect(reserved[0]).toBeDefined()

    const { data: reconciled, error } = await admin.rpc('reconcile_triage_budget', {
      p_business_id: biz,
      p_reserved_cents: 22,
      p_actual_cents: 8,
    })
    expect(error).toBeNull()
    expect(Number(reconciled[0].reserved_cents)).toBe(8)
  })

  // ─── SIGNAL3-CLAIM-RECLAIMABLE ─────────────────────────────────────────────

  it('SIGNAL3-CLAIM-RECLAIMABLE: a stale triaging claim older than 30 minutes is reclaimed to new', async () => {
    const biz = await insertBusiness('Stale Claim Business')
    const candidateId = await candidateChainFor(biz, 'stale-claim')

    const staleClaim = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    const { error: claimErr } = await admin
      .from('signal_candidates')
      .update({ status: 'triaging', triage_claimed_at: staleClaim })
      .eq('id', candidateId)
    expect(claimErr).toBeNull()

    // The reclaim sweep predicate a later tick runs (§2.9), index-served by
    // signal_candidates_triage_claim_idx.
    const { error: sweepErr } = await admin
      .from('signal_candidates')
      .update({ status: 'new', triage_claimed_at: null })
      .eq('status', 'triaging')
      .lt('triage_claimed_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .eq('id', candidateId)
    expect(sweepErr).toBeNull()

    const { data: after } = await admin.from('signal_candidates').select('status, triage_claimed_at').eq('id', candidateId).single()
    expect(after.status).toBe('new')
    expect(after.triage_claimed_at).toBeNull()
  })

  it('SIGNAL3-CLAIM-RECLAIMABLE: a fresh (non-stale) triaging claim is NOT reclaimed', async () => {
    const biz = await insertBusiness('Fresh Claim Business')
    const candidateId = await candidateChainFor(biz, 'fresh-claim')

    const freshClaim = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await admin.from('signal_candidates').update({ status: 'triaging', triage_claimed_at: freshClaim }).eq('id', candidateId)

    await admin
      .from('signal_candidates')
      .update({ status: 'new', triage_claimed_at: null })
      .eq('status', 'triaging')
      .lt('triage_claimed_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .eq('id', candidateId)

    const { data: after } = await admin.from('signal_candidates').select('status, triage_claimed_at').eq('id', candidateId).single()
    expect(after.status).toBe('triaging')
    expect(after.triage_claimed_at).not.toBeNull()
  })

  // ─── SIGNAL3-RESCORE-INVALIDATES-TRIAGE (§0.2 A-4′) ────────────────────────

  it('A-4′: a re-score against a triaging row resets it to new and clears triage_claimed_at', async () => {
    const biz = await insertBusiness('Rescore Triaging Business')
    const seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 500000)
    const conn = await insertConnection(biz, seed)
    const repo = await insertWatchedRepo(biz, conn, seed + 1)
    const signalId = await insertSignal(biz, repo, `rescore-triaging-${seed}`)
    const candidateId = await insertCandidate(biz, signalId)

    const claimedAt = new Date().toISOString()
    await admin.from('signal_candidates').update({ status: 'triaging', triage_claimed_at: claimedAt }).eq('id', candidateId)

    const { data, error } = await admin.rpc('upsert_signal_candidate', {
      p_business_id: biz,
      p_signal_id: signalId,
      p_score: 91,
      p_score_inputs: { edited: true },
      p_occurred_at: '2026-07-05T00:00:00Z',
    })
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(1)
    expect(data[0].status).toBe('new')
    expect(data[0].triage_claimed_at).toBeNull()
    expect(Number(data[0].score)).toBe(91)
  })

  it('A-4′: a card insert conditioned on the consumed claim writes zero rows after a re-score invalidates it', async () => {
    const biz = await insertBusiness('Rescore Card Insert Business')
    const seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 500000)
    const conn = await insertConnection(biz, seed)
    const repo = await insertWatchedRepo(biz, conn, seed + 1)
    const signalId = await insertSignal(biz, repo, `rescore-card-${seed}`)
    const candidateId = await insertCandidate(biz, signalId)

    const claimedAt = new Date().toISOString()
    await admin.from('signal_candidates').update({ status: 'triaging', triage_claimed_at: claimedAt }).eq('id', candidateId)

    // A GitHub edit re-scores the candidate mid-flight — the re-score resets
    // status/triage_claimed_at (proven above), invalidating the claim Stage D
    // read before starting its loop.
    await admin.rpc('upsert_signal_candidate', {
      p_business_id: biz,
      p_signal_id: signalId,
      p_score: 91,
      p_score_inputs: { edited: true },
      p_occurred_at: '2026-07-05T00:00:00Z',
    })

    // Stage D's eventual card insert (E5.6+) is conditional on the exact
    // claim it read — INSERT ... SELECT ... WHERE the candidate is still
    // 'triaging' with THIS claimed_at. Proven directly against live Postgres
    // via the raw shape Stage D will use, since no lib/db/insight-cards.ts
    // helper exists yet at this step.
    const rawClient = new Client({ connectionString: config.server.DATABASE_URL })
    await rawClient.connect()
    try {
      const result = await rawClient.query(
        `INSERT INTO public.insight_cards (
           business_id, signal_candidate_id, observation, why_it_matters, audience,
           angle_options, evidence, novelty, freshness, sensitivity, confidence,
           rubric_scores, score, occurred_at
         )
         SELECT c.business_id, c.id, 'obs', 'why', 'aud',
                '[]'::jsonb, '[]'::jsonb, 0, 0, 0, 0, '{}'::jsonb, c.score, c.occurred_at
           FROM public.signal_candidates c
          WHERE c.id = $1 AND c.status = 'triaging' AND c.triage_claimed_at = $2
         RETURNING id`,
        [candidateId, claimedAt],
      )
      expect(result.rowCount).toBe(0)
    } finally {
      await rawClient.end()
    }

    const { data: cards } = await admin.from('insight_cards').select('id').eq('signal_candidate_id', candidateId)
    expect(cards ?? []).toHaveLength(0)
  })

  // ─── SIGNAL-DEDUP-STABLE-ON-EDIT — terminal statuses still refused ────────

  it.each(['carded', 'no_card', 'triage_failed'])(
    'terminal status %s is still refused by upsert_signal_candidate (SIGNAL-DEDUP-STABLE-ON-EDIT intact)',
    async (terminalStatus) => {
      const biz = await insertBusiness(`Terminal ${terminalStatus} Business`)
      const seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 500000)
      const conn = await insertConnection(biz, seed)
      const repo = await insertWatchedRepo(biz, conn, seed + 1)
      const signalId = await insertSignal(biz, repo, `terminal-${terminalStatus}-${seed}`)
      const candidateId = await insertCandidate(biz, signalId)

      await admin.from('signal_candidates').update({ status: terminalStatus }).eq('id', candidateId)

      const { data, error } = await admin.rpc('upsert_signal_candidate', {
        p_business_id: biz,
        p_signal_id: signalId,
        p_score: 999,
        p_score_inputs: { attempted: 'resurrection' },
        p_occurred_at: '2099-01-01T00:00:00Z',
      })
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)

      const { data: after } = await admin.from('signal_candidates').select('status, score').eq('id', candidateId).single()
      expect(after.status).toBe(terminalStatus)
      expect(Number(after.score)).toBe(42)
    },
  )
})
