import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0023 §3.2, §7.6, §10.1 — Tier-1, live Postgres. SIGNAL-MR-RLS-ISOLATED,
// SIGNAL-MR-CASCADE-COMPLETE, plus the widened CHECKs and the fifth identity
// guard (watched_feed_id). Mirrors signals-schema.test.ts's pattern.

const PASSWORD = 'TestPass123!'

describe('market-responsive signal source schema (ADR 0023 §3.2/§7.6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let ownerBEmail: string
  let businessAId: string
  let businessBId: string
  let feedAId: string
  let feedBId: string
  let rssSignalAId: string
  let rssSignalBId: string

  async function createUser(label: string) {
    const email = `mrsignal-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  async function insertFeed(businessId: string, urlHash: string) {
    const { data, error } = await admin
      .from('watched_feeds')
      .insert({ business_id: businessId, url: `https://example.com/${urlHash}/feed.xml`, url_hash: urlHash, label: `Feed ${urlHash}` })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertRssSignal(businessId: string, watchedFeedId: string, externalId: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from('signals')
      .insert({
        business_id: businessId,
        watched_feed_id: watchedFeedId,
        source: 'rss',
        kind: 'article',
        external_id: externalId,
        title: 'Competitor ships a thing',
        body: 'Article summary text.',
        occurred_at: '2026-08-01T00:00:00Z',
        ...overrides,
      })
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

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Signals Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Signals Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    const base = Date.now().toString(36)
    feedAId = await insertFeed(businessAId, `${base}-a`)
    feedBId = await insertFeed(businessBId, `${base}-b`)
    const sigA = await insertRssSignal(businessAId, feedAId, `rss:${base}-a`)
    rssSignalAId = sigA.id
    const sigB = await insertRssSignal(businessBId, feedBId, `rss:${base}-b`)
    rssSignalBId = sigB.id
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

  // ─── SIGNAL-MR-RLS-ISOLATED ────────────────────────────────────────────────

  it('SIGNAL-MR-RLS-ISOLATED (watched_feeds, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('watched_feeds').select('id').eq('id', feedBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-MR-RLS-ISOLATED (watched_feeds, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('watched_feeds').select('id').eq('id', feedAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-MR-RLS-ISOLATED (rss signals, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('signals').select('id').eq('id', rssSignalBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-MR-RLS-ISOLATED: cannot UPDATE own watched_feeds row to tunnel it into another business (WITH CHECK)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('watched_feeds')
      .update({ business_id: businessBId })
      .eq('id', feedAId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from('watched_feeds').select('business_id').eq('id', feedAId).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('SIGNAL-MR-RLS-ISOLATED: cannot UPDATE a watched_feeds row belonging to another business (USING)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('watched_feeds')
      .update({ is_active: false })
      .eq('id', feedBId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillActive } = await admin.from('watched_feeds').select('is_active').eq('id', feedBId).single()
    expect(stillActive.is_active).toBe(true)
  })

  it('watched_feeds has no authenticated DELETE policy: an owner cannot delete their own watched feed', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('watched_feeds').delete().eq('id', feedAId).select()
    expect(data ?? []).toHaveLength(0)
    if (error) expect(error).not.toBeNull()

    const { data: stillThere, error: stillThereErr } = await admin.from('watched_feeds').select('id').eq('id', feedAId).single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(feedAId)
  })

  // ─── Widened CHECKs ─────────────────────────────────────────────────────────

  it('signals_source_check accepts rss, signals_kind_check accepts article (both proved above by seed insert succeeding)', async () => {
    const { data, error } = await admin.from('signals').select('source, kind').eq('id', rssSignalAId).single()
    expect(error).toBeNull()
    expect(data.source).toBe('rss')
    expect(data.kind).toBe('article')
  })

  it('signals_source_check rejects an unrecognized source value', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_feed_id: feedAId,
      source: 'twitter',
      kind: 'article',
      external_id: `rss:${Date.now()}-bad-source`,
      title: 'x',
      occurred_at: '2026-08-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  it('signals_kind_check rejects an unrecognized kind value', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_feed_id: feedAId,
      source: 'rss',
      kind: 'commit',
      external_id: `rss:${Date.now()}-bad-kind`,
      title: 'x',
      occurred_at: '2026-08-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  // ─── Exactly-one-parent CHECK ───────────────────────────────────────────────

  it('signals_exactly_one_parent_check rejects a row with BOTH parents non-null', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_feed_id: feedAId,
      watched_repo_id: '00000000-0000-0000-0000-000000000000',
      source: 'rss',
      kind: 'article',
      external_id: `rss:${Date.now()}-two-parents`,
      title: 'x',
      occurred_at: '2026-08-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  it('signals_exactly_one_parent_check rejects a row with BOTH parents null', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      source: 'rss',
      kind: 'article',
      external_id: `rss:${Date.now()}-no-parents`,
      title: 'x',
      occurred_at: '2026-08-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  it('signals_exactly_one_parent_check rejects a source/parent mismatch (source=github with only watched_feed_id set)', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_feed_id: feedAId,
      source: 'github',
      kind: 'release',
      external_id: `github:release:${Date.now()}-mismatch`,
      title: 'x',
      occurred_at: '2026-08-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  // ─── The fifth identity guard ───────────────────────────────────────────────

  it('the fifth identity guard: an UPDATE reparenting watched_feed_id is refused', async () => {
    const { error } = await admin.from('signals').update({ watched_feed_id: feedBId }).eq('id', rssSignalAId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/immutable/i)
  })

  it('an unrelated UPDATE on an existing rss row still succeeds (the guard does not over-fire)', async () => {
    const { error, data } = await admin
      .from('signals')
      .update({ title: 'Updated article title' })
      .eq('id', rssSignalAId)
      .select('title')
      .single()
    expect(error).toBeNull()
    expect(data.title).toBe('Updated article title')
  })

  it('an unrelated UPDATE on an existing github row still succeeds (watched_feed_id stays NULL-vs-NULL, not distinct)', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()
    const { data: conn, error: connErr } = await client
      .from('github_connections')
      .insert({ business_id: businessAId, installation_id: Math.floor(Date.now() / 1000) + 850000, account_login: 'acct-mr' })
      .select('id')
      .single()
    if (connErr) throw connErr
    const { data: repo, error: repoErr } = await client
      .from('watched_repos')
      .insert({ business_id: businessAId, connection_id: conn.id, repo_id: Math.floor(Date.now() / 1000) + 850100, owner: 'acme', name: 'widgets-mr' })
      .select('id')
      .single()
    if (repoErr) throw repoErr
    const { data: signal, error: signalErr } = await client
      .from('signals')
      .insert({
        business_id: businessAId,
        watched_repo_id: repo.id,
        source: 'github',
        kind: 'release',
        external_id: `github:release:${Date.now()}-mr-unrelated`,
        title: 'v1.0.0',
        body: 'notes',
        occurred_at: '2026-08-01T00:00:00Z',
      })
      .select('id')
      .single()
    if (signalErr) throw signalErr

    const { error, data } = await client
      .from('signals')
      .update({ title: 'v1.0.1' })
      .eq('id', signal.id)
      .select('title')
      .single()
    expect(error).toBeNull()
    expect(data!.title).toBe('v1.0.1')
  })

  // ─── SIGNAL-MR-CASCADE-COMPLETE ─────────────────────────────────────────────

  it('SIGNAL-MR-CASCADE-COMPLETE: deleting the business erases watched_feeds AND its rss signals; purge_business needs no edit', async () => {
    const owner = await createUser('cascade-direct')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Cascade Direct', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const feedId = await insertFeed(biz.id, `${Date.now()}-cascade`)
    await insertRssSignal(biz.id, feedId, `rss:${biz.id}-cascade`)

    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz.id)
    expect(deleteErr).toBeNull()

    for (const table of ['watched_feeds', 'signals']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })

  it('SIGNAL-MR-CASCADE-COMPLETE: purge_business on a business with a watched feed + rss signal completes without error and leaves none', async () => {
    const owner = await createUser('cascade-purge')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'MR Cascade Purge', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const feedId = await insertFeed(biz.id, `${Date.now()}-purge`)
    await insertRssSignal(biz.id, feedId, `rss:${biz.id}-purge`)

    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz.id })
    expect(purgeErr).toBeNull()

    for (const table of ['watched_feeds', 'signals']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })

  // ─── watched_feeds UNIQUE arbiter ───────────────────────────────────────────

  it('UNIQUE (business_id, url_hash): a second feed with the same hash for the same business hits 23505', async () => {
    const hash = `${Date.now()}-dup`
    const { error: firstErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: businessAId, url: 'https://example.com/dup/feed.xml', url_hash: hash, label: 'Dup 1' })
    expect(firstErr).toBeNull()

    const { error: dupErr } = await admin
      .from('watched_feeds')
      .insert({ business_id: businessAId, url: 'https://example.com/dup/other-feed.xml', url_hash: hash, label: 'Dup 2' })
    expect(dupErr).not.toBeNull()
    expect(dupErr.code).toBe('23505')
  })
})
