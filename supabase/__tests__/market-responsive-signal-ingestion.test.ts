import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SignalInsert } from '@/lib/db/types'

// ADR 0023 §3.4/§9 — Tier-1, live Postgres. SIGNAL-MR-INGEST-ATOMIC,
// SIGNAL-MR-DEDUP-STABLE, plus the terminal-candidate-refuses-rescore guard
// exercised through the RSS caller specifically (SHARED-FUNCTION CALLERS
// discipline — the guard is already proven for the GitHub caller in
// signals-schema.test.ts; this proves the RSS caller too).

describe('market-responsive signal ingestion (ADR 0023 §3.4/§9)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let feedId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `mringest-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (userErr) throw userErr
    ownerId = user.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Ingestion Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const hash = `${Date.now()}-ingestion`
    const { data: feed, error: feedErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: businessId, url: 'https://example.com/ingestion/feed.xml', url_hash: hash, label: 'Ingestion Feed' })
      .select('id')
      .single()
    if (feedErr) throw feedErr
    feedId = feed.id
  })

  afterAll(async () => {
    if (!admin || !businessId) return
    await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser(ownerId)
  })

  function makeInsert(externalId: string, overrides: Record<string, unknown> = {}): SignalInsert {
    return {
      business_id: businessId,
      watched_feed_id: feedId,
      source: 'rss',
      kind: 'article',
      external_id: externalId,
      ingested_via: 'poll',
      title: 'A competitor launches a thing' as SignalInsert['title'],
      body: 'Body text about the launch.' as SignalInsert['body'],
      occurred_at: '2026-08-01T09:00:00Z',
      ...overrides,
    } as SignalInsert
  }

  // ─── SIGNAL-MR-INGEST-ATOMIC ────────────────────────────────────────────

  it('SIGNAL-MR-INGEST-ATOMIC: two simultaneous inserts of the same (business_id, source, external_id) produce ONE row and ONE 23505', async () => {
    const { insertSignal } = await import('@/lib/db/signals')
    const externalId = `rss:${Date.now()}-atomic`

    const [first, second] = await Promise.all([
      insertSignal(makeInsert(externalId)),
      insertSignal(makeInsert(externalId)),
    ])

    const insertedCount = [first, second].filter((r) => r.status === 'inserted').length
    const duplicateCount = [first, second].filter((r) => r.status === 'duplicate').length
    expect(insertedCount).toBe(1)
    expect(duplicateCount).toBe(1)

    const { data, error } = await admin.from('signals').select('id').eq('business_id', businessId).eq('external_id', externalId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a byte-identical re-ingest (same external_id, same everything) is a no-op — a second insertSignal call hits 23505', async () => {
    const { insertSignal } = await import('@/lib/db/signals')
    const externalId = `rss:${Date.now()}-byte-identical`

    const first = await insertSignal(makeInsert(externalId))
    expect(first.status).toBe('inserted')

    const second = await insertSignal(makeInsert(externalId))
    expect(second.status).toBe('duplicate')

    const { data, error } = await admin.from('signals').select('id').eq('business_id', businessId).eq('external_id', externalId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('an edited item updates content columns in place and re-scores the SAME candidate row', async () => {
    const { insertSignal, updateSignalContent } = await import('@/lib/db/signals')
    const { upsertScoredCandidate, scoreSignal } = await import('@/lib/signals/score')
    const externalId = `rss:${Date.now()}-edited`

    const inserted = await insertSignal(makeInsert(externalId))
    if (inserted.status !== 'inserted') throw new Error('setup failed')
    const originalHash = inserted.signal.content_hash

    const now = new Date('2026-08-01T10:00:00Z')
    const firstScore = scoreSignal(
      { externalId, occurredAt: inserted.signal.occurred_at, bodyLen: inserted.signal.body.length, isBot: false, repoWeight: 10, kind: 'article' },
      now,
    )
    const firstCandidate = await upsertScoredCandidate(businessId, inserted.signal.id, firstScore)
    expect(firstCandidate).not.toBeNull()
    const candidateId = firstCandidate!.id

    const updated = await updateSignalContent(inserted.signal.id, businessId, {
      title: 'A competitor launches a thing — UPDATED' as never,
      body: 'Updated body text about the launch.' as never,
      body_truncated: false,
    })
    expect(updated.content_hash).not.toBe(originalHash)

    const secondScore = scoreSignal(
      { externalId, occurredAt: updated.occurred_at, bodyLen: updated.body.length, isBot: false, repoWeight: 10, kind: 'article' },
      now,
    )
    const secondCandidate = await upsertScoredCandidate(businessId, updated.id, secondScore)
    expect(secondCandidate).not.toBeNull()
    // SAME candidate row, not a new one — the UNIQUE(signal_id) arbiter.
    expect(secondCandidate!.id).toBe(candidateId)
  })

  // ─── SIGNAL-MR-DEDUP-STABLE ─────────────────────────────────────────────

  it('SIGNAL-MR-DEDUP-STABLE: listRecentSignalsByBusinessAndSource finds a guid-churned item by content_hash within the window', async () => {
    const { insertSignal, listRecentSignalsByBusinessAndSource } = await import('@/lib/db/signals')
    const sharedTitle = 'Guid-churn story, same content'
    const sharedBody = 'This exact story got republished under a new URL.'

    const original = await insertSignal(
      makeInsert(`rss:${Date.now()}-guid-churn-original`, {
        title: sharedTitle,
        body: sharedBody,
        occurred_at: new Date().toISOString(),
      }),
    )
    if (original.status !== 'inserted') throw new Error('setup failed')

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const recent = await listRecentSignalsByBusinessAndSource(businessId, 'rss', since)
    const match = recent.find((s) => s.content_hash === original.signal.content_hash)
    expect(match).toBeDefined()
    expect(match!.id).toBe(original.signal.id)
  })

  it("a signal whose STORY is old (occurred_at old) falls outside the window even though it was just inserted — the window filters occurred_at, not created_at, matching the orchestrator's own query shape", async () => {
    const { insertSignal, listRecentSignalsByBusinessAndSource } = await import('@/lib/db/signals')
    const old = await insertSignal(
      makeInsert(`rss:${Date.now()}-old-occurred-at`, { occurred_at: '2020-01-01T00:00:00Z' }),
    )
    if (old.status !== 'inserted') throw new Error('setup failed')

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const recent = await listRecentSignalsByBusinessAndSource(businessId, 'rss', since)
    expect(recent.some((s) => s.id === old.signal.id)).toBe(false)
  })

  // ─── Terminal candidate refuses re-score, through the RSS caller ────────

  it('a terminal candidate refuses re-score via upsertScoredCandidate called from the RSS path (SHARED-FUNCTION CALLERS)', async () => {
    const { insertSignal } = await import('@/lib/db/signals')
    const { upsertScoredCandidate, scoreSignal } = await import('@/lib/signals/score')
    const externalId = `rss:${Date.now()}-terminal`

    const inserted = await insertSignal(makeInsert(externalId))
    if (inserted.status !== 'inserted') throw new Error('setup failed')

    const now = new Date('2026-08-01T10:00:00Z')
    const score = scoreSignal(
      { externalId, occurredAt: inserted.signal.occurred_at, bodyLen: inserted.signal.body.length, isBot: false, repoWeight: 10, kind: 'article' },
      now,
    )
    const candidate = await upsertScoredCandidate(businessId, inserted.signal.id, score)
    expect(candidate).not.toBeNull()

    const { error: transitionErr } = await admin.from('signal_candidates').update({ status: 'no_card' }).eq('id', candidate!.id)
    expect(transitionErr).toBeNull()

    const rescoreAttempt = scoreSignal(
      { externalId, occurredAt: inserted.signal.occurred_at, bodyLen: inserted.signal.body.length, isBot: false, repoWeight: 10, kind: 'article' },
      new Date('2099-01-01T00:00:00Z'),
    )
    const resurrected = await upsertScoredCandidate(businessId, inserted.signal.id, rescoreAttempt)
    // The guard's no-op outcome: zero rows RETURNING, surfaced as null —
    // never a thrown error, never a resurrected row.
    expect(resurrected).toBeNull()

    const { data: after, error: afterErr } = await admin.from('signal_candidates').select('status, score').eq('id', candidate!.id).single()
    expect(afterErr).toBeNull()
    expect(after.status).toBe('no_card')
  })
})
