import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0023 §5.5a (Session 30 G1b.7) — Tier-1, live Postgres.
// SIGNAL-MR-BUSINESS-ENUMERATION: a feed-only business (no GitHub
// connection at all) must appear in listBusinessesWithNewCandidates —
// the real defect the old listActiveConnectionBusinessIds (github_
// connections alone) had, which this step closes.

describe('market-responsive business enumeration (ADR 0023 §5.5a)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let feedOnlyBusinessId: string
  let noCandidateBusinessId: string
  let noCandidateOwnerId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `mrenum-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (userErr) throw userErr
    ownerId = user.user.id

    // A business with ZERO github_connections rows — only a watched feed,
    // an rss signal, and a 'new' candidate. The OLD enumeration
    // (listActiveConnectionBusinessIds, github_connections alone) would
    // never have surfaced this business at all.
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Enumeration Feed-Only Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    feedOnlyBusinessId = biz.id

    const hash = `${Date.now()}-enum`
    const { data: feed, error: feedErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: feedOnlyBusinessId, url: 'https://example.com/enum/feed.xml', url_hash: hash, label: 'Enum Feed' })
      .select('id')
      .single()
    if (feedErr) throw feedErr

    const { data: signal, error: signalErr } = await admin
      .from('signals')
      .insert({
        business_id: feedOnlyBusinessId,
        watched_feed_id: feed.id,
        source: 'rss',
        kind: 'article',
        external_id: `rss:${Date.now()}-enum`,
        title: 'Feed-only business story',
        body: 'Body text.',
        occurred_at: '2026-08-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (signalErr) throw signalErr

    const { error: candidateErr } = await admin
      .from('signal_candidates')
      .insert({ business_id: feedOnlyBusinessId, signal_id: signal.id, score: 50, occurred_at: '2026-08-01T00:00:00Z' })
    if (candidateErr) throw candidateErr

    // A second business with NO candidates at all (status='new' or
    // otherwise) — must NOT appear in the enumeration, confirming the
    // query is genuinely scoped to status='new', not every business.
    const noCandEmail = `mrenum-nocand-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: noCandUser, error: noCandUserErr } = await admin.auth.admin.createUser({ email: noCandEmail, password: 'TestPass123!', email_confirm: true })
    if (noCandUserErr) throw noCandUserErr
    noCandidateOwnerId = noCandUser.user.id
    const { data: noCandBiz, error: noCandBizErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Enumeration No-Candidate Business', owner_id: noCandidateOwnerId, plan: 'plus' })
      .select('id')
      .single()
    if (noCandBizErr) throw noCandBizErr
    noCandidateBusinessId = noCandBiz.id
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of [feedOnlyBusinessId, noCandidateBusinessId]) {
      if (id) await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of [ownerId, noCandidateOwnerId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('SIGNAL-MR-BUSINESS-ENUMERATION: a feed-only business (no github_connections row) appears in the enumeration', async () => {
    const { listBusinessesWithNewCandidates } = await import('@/lib/db/signal-candidates')
    const ids = await listBusinessesWithNewCandidates(admin)
    expect(ids).toContain(feedOnlyBusinessId)
  })

  it('confirms the feed-only business genuinely has zero github_connections rows (the old enumeration would have missed it)', async () => {
    const { data, error } = await admin.from('github_connections').select('id').eq('business_id', feedOnlyBusinessId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('a business with no "new" candidates at all does NOT appear in the enumeration', async () => {
    const { listBusinessesWithNewCandidates } = await import('@/lib/db/signal-candidates')
    const ids = await listBusinessesWithNewCandidates(admin)
    expect(ids).not.toContain(noCandidateBusinessId)
  })
})
