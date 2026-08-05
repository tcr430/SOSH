import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0020 §3 — Tier-1, live Postgres. SIGNAL-RLS-ISOLATED (mirrored both
// directions, per table, per the Session 26-D MINOR-2 precedent),
// SIGNAL-CASCADE-COMPLETE, SIGNAL-PURGE-COVERED, SIGNAL-INGEST-IDEMPOTENT,
// SIGNAL-CALLBACK-TENANT-BOUND, SIGNAL-RAW-IMMUTABLE-IDENTITY,
// SIGNAL-BODY-CAPPED (DB half), and the signal_candidates upsert arbiter.

const PASSWORD = 'TestPass123!'

describe('signal ingestion schema (ADR 0020 §3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let ownerBEmail: string
  let businessAId: string
  let businessBId: string
  let connAId: string
  let connBId: string
  let repoAId: string
  let repoBId: string
  let signalAId: string
  let signalBId: string
  let candidateAId: string
  let candidateBId: string

  async function createUser(label: string) {
    const email = `signals-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  async function insertSignal(businessId: string, watchedRepoId: string, externalId: string, overrides: Record<string, unknown> = {}) {
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
        ...overrides,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as { id: string; content_hash: string; [k: string]: unknown }
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
      .insert({ name: 'Signals Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Signals Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    const baseInstallation = Math.floor(Date.now() / 1000)
    connAId = await insertConnection(businessAId, baseInstallation)
    connBId = await insertConnection(businessBId, baseInstallation + 1)
    repoAId = await insertWatchedRepo(businessAId, connAId, baseInstallation + 100)
    repoBId = await insertWatchedRepo(businessBId, connBId, baseInstallation + 101)
    const signalA = await insertSignal(businessAId, repoAId, `github:release:${baseInstallation}-a`)
    signalAId = signalA.id
    const signalB = await insertSignal(businessBId, repoBId, `github:release:${baseInstallation}-b`)
    signalBId = signalB.id
    candidateAId = await insertCandidate(businessAId, signalAId)
    candidateBId = await insertCandidate(businessBId, signalBId)
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

  // ─── SIGNAL-RLS-ISOLATED — per table, mirrored both directions ───────────

  it('SIGNAL-RLS-ISOLATED (github_connections, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('github_connections').select('id').eq('id', connBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (github_connections, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('github_connections').select('id').eq('id', connAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (watched_repos, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('watched_repos').select('id').eq('id', repoBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (watched_repos, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('watched_repos').select('id').eq('id', repoAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (signals, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('signals').select('id').eq('id', signalBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (signals, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('signals').select('id').eq('id', signalAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (signal_candidates, A→B): cross-tenant SELECT returns zero rows', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('signal_candidates').select('id').eq('id', candidateBId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('SIGNAL-RLS-ISOLATED (signal_candidates, B→A): cross-tenant SELECT returns zero rows, real signed-in owner-B session', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('signal_candidates').select('id').eq('id', candidateAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  // ─── watched_repos write-path: WITH CHECK tunnelling + absent DELETE ─────

  it('SIGNAL-RLS-ISOLATED: cannot UPDATE own watched_repos row to tunnel it into another business (WITH CHECK)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('watched_repos')
      .update({ business_id: businessBId })
      .eq('id', repoAId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from('watched_repos').select('business_id').eq('id', repoAId).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('SIGNAL-RLS-ISOLATED: cannot UPDATE a watched_repos row belonging to another business (USING)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('watched_repos')
      .update({ is_active: false })
      .eq('id', repoBId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillActive } = await admin.from('watched_repos').select('is_active').eq('id', repoBId).single()
    expect(stillActive.is_active).toBe(true)
  })

  it('[db-MAJOR-D] watched_repos has no authenticated DELETE policy: an owner cannot delete their own watched repo', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('watched_repos').delete().eq('id', repoAId).select()
    // Deny-by-default: no matching DELETE policy means zero rows affected,
    // not necessarily a surfaced error (RLS + no GRANT can either error or
    // silently match nothing depending on privilege vs. policy denial).
    expect(data ?? []).toHaveLength(0)
    if (error) expect(error).not.toBeNull()

    const { data: stillThere, error: stillThereErr } = await admin.from('watched_repos').select('id').eq('id', repoAId).single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(repoAId)
  })

  // ─── SIGNAL-INGEST-IDEMPOTENT / SIGNAL-CALLBACK-TENANT-BOUND ─────────────

  it('SIGNAL-INGEST-IDEMPOTENT: a second insert with the same (business_id, source, external_id) hits 23505', async () => {
    const dupExternalId = `github:release:${signalAId}-dup-source`
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_repo_id: repoAId,
      source: 'github',
      kind: 'release',
      external_id: dupExternalId,
      title: 'dup attempt',
      body: 'x',
      occurred_at: '2026-07-01T00:00:00Z',
    })
    expect(error).toBeNull()

    const { error: dupErr } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_repo_id: repoAId,
      source: 'github',
      kind: 'release',
      external_id: dupExternalId,
      title: 'dup attempt 2',
      body: 'y',
      occurred_at: '2026-07-01T00:00:00Z',
    })
    expect(dupErr).not.toBeNull()
    expect(dupErr.code).toBe('23505')
  })

  it('SIGNAL-CALLBACK-TENANT-BOUND: a second github_connections row with the same installation_id across two businesses hits 23505', async () => {
    // businessAId/businessBId already each own a connection (UNIQUE(business_id)
    // would trip first) — use two fresh, connection-less businesses so the
    // ONLY constraint in play is UNIQUE(installation_id).
    const ownerX = await createUser('squat-x')
    const ownerY = await createUser('squat-y')
    const { data: bizX, error: bizXErr } = await admin
      .from('businesses')
      .insert({ name: 'Squat Business X', owner_id: ownerX.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizXErr) throw bizXErr
    const { data: bizY, error: bizYErr } = await admin
      .from('businesses')
      .insert({ name: 'Squat Business Y', owner_id: ownerY.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizYErr) throw bizYErr

    const squatInstallation = Math.floor(Date.now() / 1000) + 999999
    const { error: firstErr } = await admin
      .from('github_connections')
      .insert({ business_id: bizX.id, installation_id: squatInstallation, account_login: 'squat-owner' })
    expect(firstErr).toBeNull()

    const { error: squatErr } = await admin
      .from('github_connections')
      .insert({ business_id: bizY.id, installation_id: squatInstallation, account_login: 'squat-attacker' })
    expect(squatErr).not.toBeNull()
    expect(squatErr.code).toBe('23505')

    await admin.from('businesses').delete().eq('id', bizX.id)
    await admin.from('businesses').delete().eq('id', bizY.id)
    await admin.auth.admin.deleteUser(ownerX.id)
    await admin.auth.admin.deleteUser(ownerY.id)
  })

  it('signal_candidates UNIQUE (signal_id): a second candidate for the same signal is rejected', async () => {
    const { error } = await admin
      .from('signal_candidates')
      .insert({ business_id: businessAId, signal_id: signalAId, score: 10, occurred_at: '2026-07-01T00:00:00Z' })
    expect(error).not.toBeNull()
    expect(error.code).toBe('23505')
  })

  // ─── SIGNAL-RAW-IMMUTABLE-IDENTITY ────────────────────────────────────────

  it('SIGNAL-RAW-IMMUTABLE-IDENTITY: the BEFORE UPDATE trigger raises on external_id change', async () => {
    const { error } = await admin.from('signals').update({ external_id: 'attacker-changed' }).eq('id', signalAId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/immutable/i)
  })

  it('SIGNAL-RAW-IMMUTABLE-IDENTITY: the BEFORE UPDATE trigger raises on business_id change', async () => {
    const { error } = await admin.from('signals').update({ business_id: businessBId }).eq('id', signalAId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/immutable/i)
  })

  it('SIGNAL-RAW-IMMUTABLE-IDENTITY: the trigger permits a body/title change and recomputes content_hash', async () => {
    const { data: before } = await admin.from('signals').select('content_hash').eq('id', signalAId).single()

    const { data: updated, error } = await admin
      .from('signals')
      .update({ title: 'v1.0.1', body: 'Updated release notes.' })
      .eq('id', signalAId)
      .select('content_hash, title, body')
      .single()
    expect(error).toBeNull()
    expect(updated.title).toBe('v1.0.1')
    expect(updated.content_hash).not.toBe(before.content_hash)
  })

  // ─── SIGNAL-BODY-CAPPED (DB half) ─────────────────────────────────────────

  it('SIGNAL-BODY-CAPPED: the length(body) <= 8000 CHECK rejects 8001 characters', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_repo_id: repoAId,
      source: 'github',
      kind: 'release',
      external_id: `github:release:${signalAId}-overlong`,
      title: 'overlong body',
      body: 'x'.repeat(8001),
      occurred_at: '2026-07-01T00:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  it('SIGNAL-BODY-CAPPED: exactly 8000 characters is accepted', async () => {
    const { error } = await admin.from('signals').insert({
      business_id: businessAId,
      watched_repo_id: repoAId,
      source: 'github',
      kind: 'release',
      external_id: `github:release:${signalAId}-exactly-8000`,
      title: 'exactly at cap',
      body: 'x'.repeat(8000),
      occurred_at: '2026-07-01T00:00:00Z',
    })
    expect(error).toBeNull()
  })

  // ─── SIGNAL-CASCADE-COMPLETE / SIGNAL-PURGE-COVERED ───────────────────────

  it('SIGNAL-CASCADE-COMPLETE: deleting the business completes without error and removes rows from all four tables', async () => {
    const owner = await createUser('cascade-direct')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Signals Cascade Direct', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const connId = await insertConnection(biz.id, Math.floor(Date.now() / 1000) + 555000)
    const repoId = await insertWatchedRepo(biz.id, connId, Math.floor(Date.now() / 1000) + 555100)
    const signal = await insertSignal(biz.id, repoId, `github:release:${biz.id}-cascade`)
    await insertCandidate(biz.id, signal.id)

    // The assertion that matters: the delete call itself must not error — a
    // BEFORE DELETE guard would abort the cascade and surface here.
    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz.id)
    expect(deleteErr).toBeNull()

    for (const table of ['github_connections', 'watched_repos', 'signals', 'signal_candidates']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })

  it('SIGNAL-PURGE-COVERED: purge_business on a business with all four populated completes without error and leaves none', async () => {
    const owner = await createUser('cascade-purge')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Signals Cascade Purge', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const connId = await insertConnection(biz.id, Math.floor(Date.now() / 1000) + 666000)
    const repoId = await insertWatchedRepo(biz.id, connId, Math.floor(Date.now() / 1000) + 666100)
    const signal = await insertSignal(biz.id, repoId, `github:release:${biz.id}-purge`)
    await insertCandidate(biz.id, signal.id)

    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz.id })
    expect(purgeErr).toBeNull()

    for (const table of ['github_connections', 'watched_repos', 'signals', 'signal_candidates']) {
      const { data, error } = await admin.from(table).select('id').eq('business_id', biz.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    }

    await admin.auth.admin.deleteUser(owner.id)
  })
})
