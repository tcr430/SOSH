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

// D3 (Session 30-D, MAJOR-2) — SIGNAL-MR-BUSINESS-ENUMERATION-PAGED. The
// original `listBusinessesWithNewCandidates` had NO explicit ORDER BY and
// capped ROWS (5000), not businesses: once a 'new' backlog exceeded that
// row cap, a business whose candidates sorted outside the unordered window
// was silently never enumerated. This test forces the equivalent of "beyond
// the window" at a tractable scale against a real Postgres instance: a
// FILLER business whose explicit UUID sorts FIRST (business_id ASC, the
// enumeration's own ordering) with three 'new' candidates, and a TARGET
// business whose explicit UUID sorts LAST with exactly one. Calling the
// enumeration with a small pageSize (2) forces at least three `.range()`
// fetches to cover all four rows — the target's row lands in the SECOND
// page, never the first — so if pagination silently stopped after one
// page (the shape of the original defect), the target would be missing.
describe('SIGNAL-MR-BUSINESS-ENUMERATION-PAGED (ADR 0023 §5.5a, Session 30-D D3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let fillerOwnerId: string
  let targetOwnerId: string
  // Explicit UUIDs (Postgres accepts any well-formed uuid literal on
  // INSERT, overriding the gen_random_uuid() default) so business_id
  // ordering is deterministic rather than left to random UUID generation.
  const fillerBusinessId = '00000000-0000-4000-8000-000000000001'
  const targetBusinessId = 'ffffffff-ffff-4fff-8fff-fffffffffffe'

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const fillerEmail = `mrenum-paged-filler-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: fillerUser, error: fillerUserErr } = await admin.auth.admin.createUser({
      email: fillerEmail,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (fillerUserErr) throw fillerUserErr
    fillerOwnerId = fillerUser.user.id

    const targetEmail = `mrenum-paged-target-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: targetUser, error: targetUserErr } = await admin.auth.admin.createUser({
      email: targetEmail,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (targetUserErr) throw targetUserErr
    targetOwnerId = targetUser.user.id

    const { error: fillerBizErr } = await admin
      .from('businesses')
      .insert({ id: fillerBusinessId, name: 'D3 Paged Filler Business', owner_id: fillerOwnerId, plan: 'plus' })
    if (fillerBizErr) throw fillerBizErr

    const { error: targetBizErr } = await admin
      .from('businesses')
      .insert({ id: targetBusinessId, name: 'D3 Paged Target Business (sorts last)', owner_id: targetOwnerId, plan: 'plus' })
    if (targetBizErr) throw targetBizErr

    // signals_exactly_one_parent_check requires source='rss' rows to carry
    // a watched_feed_id (and no watched_repo_id) — one feed per business,
    // same shape as the feed-only fixture above.
    const { data: fillerFeed, error: fillerFeedErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: fillerBusinessId, url: 'https://example.com/d3-paged/filler.xml', url_hash: `${Date.now()}-d3-filler`, label: 'D3 Filler Feed' })
      .select('id')
      .single()
    if (fillerFeedErr) throw fillerFeedErr

    // Three 'new' candidates for the filler business — occupies all of a
    // pageSize-2 first page on its own, since business_id ASC sorts it
    // before the target business.
    for (let i = 0; i < 3; i++) {
      const { data: signal, error: signalErr } = await admin
        .from('signals')
        .insert({
          business_id: fillerBusinessId,
          watched_feed_id: fillerFeed.id,
          source: 'rss',
          kind: 'article',
          external_id: `d3-paged-filler-${Date.now()}-${i}`,
          title: `Filler release ${i}`,
          body: 'Body text.',
          occurred_at: '2026-08-01T00:00:00Z',
        })
        .select('id')
        .single()
      if (signalErr) throw signalErr
      const { error: candidateErr } = await admin
        .from('signal_candidates')
        .insert({ business_id: fillerBusinessId, signal_id: signal.id, score: 50, occurred_at: '2026-08-01T00:00:00Z' })
      if (candidateErr) throw candidateErr
    }

    const { data: targetFeed, error: targetFeedErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: targetBusinessId, url: 'https://example.com/d3-paged/target.xml', url_hash: `${Date.now()}-d3-target`, label: 'D3 Target Feed' })
      .select('id')
      .single()
    if (targetFeedErr) throw targetFeedErr

    // One 'new' candidate for the target business — sorts LAST, so it can
    // only be reached once the enumeration pages past the filler business.
    const { data: targetSignal, error: targetSignalErr } = await admin
      .from('signals')
      .insert({
        business_id: targetBusinessId,
        watched_feed_id: targetFeed.id,
        source: 'rss',
        kind: 'article',
        external_id: `d3-paged-target-${Date.now()}`,
        title: 'Target release',
        body: 'Body text.',
        occurred_at: '2026-08-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (targetSignalErr) throw targetSignalErr
    const { error: targetCandidateErr } = await admin
      .from('signal_candidates')
      .insert({ business_id: targetBusinessId, signal_id: targetSignal.id, score: 50, occurred_at: '2026-08-01T00:00:00Z' })
    if (targetCandidateErr) throw targetCandidateErr
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of [fillerBusinessId, targetBusinessId]) {
      await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of [fillerOwnerId, targetOwnerId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('a business whose only candidate sorts LAST is still enumerated when the read page size is smaller than the total backlog', async () => {
    const { listBusinessesWithNewCandidates } = await import('@/lib/db/signal-candidates')
    // pageSize=2 forces >= 3 `.range()` fetches to cover the 4 seeded rows
    // (3 filler + 1 target) — the target's row falls in the second fetch.
    const ids = await listBusinessesWithNewCandidates(admin, 2)
    expect(ids).toContain(fillerBusinessId)
    expect(ids).toContain(targetBusinessId)
  })
})
