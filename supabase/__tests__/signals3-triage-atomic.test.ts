import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0021 §5.3, §10.1, §11 — SIGNAL3-TRIAGE-ATOMIC, Tier 1, REAL concurrency.
// Session 28 E5.12 finding (ecc:pr-test-analyzer, the phase's closing
// verification pass): §10.1/§11 both claim this constraint as Tier 1 —
// "Two concurrent triage transitions on one card" — but no
// supabase/__tests__ file actually raced two concurrent UPDATEs against a
// real insight_cards row. lib/db/insight-cards.test.ts and
// app/[locale]/(dashboard)/opportunities/actions.test.ts both mock the
// Supabase client and hand-supply the "loser" response, which proves the JS
// branch logic and the presence of `.eq('status', expected)` in the call —
// not that Postgres itself serialises two real concurrent writers to
// exactly one winner. This closes that gap: EXECUTED-AND-PROVING-NOTHING
// (ADR 0015 §1(c)) until now for the live-concurrency half of this claim.

const PASSWORD = 'TestPass123!'

describe('SIGNAL3-TRIAGE-ATOMIC (ADR 0021 §5.3, live Postgres, real concurrency)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let candidateId: string
  let cardId: string

  async function createUser(label: string) {
    const email = `signals3-atomic-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return data.user.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    ownerId = await createUser('owner')
    const { data: business, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Triage Atomic Race Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = business.id

    const { data: connection, error: connErr } = await admin
      .from('github_connections')
      .insert({ business_id: businessId, installation_id: 991001, account_login: 'acct-991001' })
      .select('id')
      .single()
    if (connErr) throw connErr

    const { data: repo, error: repoErr } = await admin
      .from('watched_repos')
      .insert({ business_id: businessId, connection_id: connection.id, repo_id: 991001, owner: 'acme', name: 'repo-991001' })
      .select('id')
      .single()
    if (repoErr) throw repoErr

    const { data: signal, error: sigErr } = await admin
      .from('signals')
      .insert({
        business_id: businessId,
        watched_repo_id: repo.id,
        source: 'github',
        kind: 'release',
        external_id: 'atomic-race-ext-1',
        title: 'v3.0.0',
        body: 'Race test release.',
        occurred_at: '2026-07-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (sigErr) throw sigErr

    const { data: candidate, error: candErr } = await admin
      .from('signal_candidates')
      .insert({ business_id: businessId, signal_id: signal.id, score: 42, occurred_at: '2026-07-01T00:00:00Z' })
      .select('id')
      .single()
    if (candErr) throw candErr
    candidateId = candidate.id

    const { data: card, error: cardErr } = await admin
      .from('insight_cards')
      .insert({
        business_id: businessId,
        signal_candidate_id: candidateId,
        observation: 'v3.0 race-test observation.',
        why_it_matters: 'Race-test why-it-matters.',
        audience: 'Race-test audience.',
        angle_options: [],
        evidence: [],
        novelty: 50,
        freshness: 80,
        sensitivity: 0,
        confidence: 60,
        rubric_scores: {},
        score: 42,
        occurred_at: '2026-07-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (cardErr) throw cardErr
    cardId = card.id
  })

  afterAll(async () => {
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('two concurrent transitions on the SAME card (approve vs dismiss, both from pending) — exactly one wins, the loser matches zero rows', async () => {
    const [approveResult, dismissResult] = await Promise.all([
      admin.from('insight_cards').update({ status: 'approved' }).eq('id', cardId).eq('status', 'pending').select('id'),
      admin.from('insight_cards').update({ status: 'dismissed' }).eq('id', cardId).eq('status', 'pending').select('id'),
    ])

    expect(approveResult.error).toBeNull()
    expect(dismissResult.error).toBeNull()

    const wonCount = [approveResult, dismissResult].filter(r => (r.data ?? []).length === 1).length
    const lostCount = [approveResult, dismissResult].filter(r => (r.data ?? []).length === 0).length
    // Real Postgres row-level locking under two genuinely concurrent
    // UPDATE...WHERE status='pending' statements: the second to acquire the
    // row's lock evaluates the predicate against the ALREADY-CHANGED row and
    // matches zero rows — this is the DB itself proving the race, not a
    // hand-supplied mock response.
    expect(wonCount).toBe(1)
    expect(lostCount).toBe(1)

    const { data: finalRow, error: finalErr } = await admin.from('insight_cards').select('status').eq('id', cardId).single()
    if (finalErr) throw finalErr
    expect(['approved', 'dismissed']).toContain(finalRow.status)
  })
})
