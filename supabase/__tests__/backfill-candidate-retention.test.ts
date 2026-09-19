import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// MINOR-9 per A-8 (Session 32-D, D3, ADR 0025 §8.3 gap). Two-stage sweep:
// import candidates of a run STILL awaiting_ratification, completed_at
// older than p_ttl_days, are retired; once retired AND the run is past
// 2*p_ttl_days, they are deleted. A ratified run's ACTIVE rows are never
// touched, regardless of age.
describe('sweep_expired_backfill_candidates (ADR 0025 §8.3, MINOR-9/A-8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-retention-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Retention Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  let runCounter = 0
  // A fresh account per run — social_backfill_runs_live_account_uq
  // (BACKFILL-ONCE-PER-ACCOUNT) blocks a second non-discarded run on the
  // same account, and every test here creates a non-discarded run.
  async function makeRun(overrides: Record<string, unknown>) {
    runCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-retention-user-${runCounter}`,
        platform_username: `retention_handle_${runCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(60 + runCounter).padStart(2, '0')}`,
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr

    const { data, error } = await admin
      .from('social_backfill_runs')
      .insert({
        business_id: businessId,
        social_account_id: account.id,
        platform: 'twitter',
        ...overrides,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertCandidate(table: string, runId: string, extra: Record<string, unknown> = {}) {
    const base: Record<string, unknown> = {
      business_id: businessId,
      source: 'import',
      import_run_id: runId,
      import_source_post_ids: [`retention-post-${runId}`],
      confidence: 0.5,
      status: 'candidate',
      sensitivity: 'internal',
      public_use_permission: false,
      scope: 'brand',
    }
    if (table === 'evidence_memory') Object.assign(base, { kind: 'quote', content: `retention-${table}-${runId}` }, extra)
    if (table === 'audience_memory') Object.assign(base, { kind: 'problem', statement: `retention-${table}-${runId}` }, extra)
    if (table === 'performance_memory')
      Object.assign(base, { dimension: 'topic', pattern: `retention-${table}-${runId}`, observation_count: 5 }, extra)
    const { data, error } = await admin.from(table).insert(base).select('id').single()
    if (error) throw error
    return data.id as string
  }

  it('a run backdated past p_ttl_days: candidates on all three tables -> retired', async () => {
    const runId = await makeRun({ status: 'awaiting_ratification', completed_at: daysAgo(31) })
    const evidenceId = await insertCandidate('evidence_memory', runId)
    const audienceId = await insertCandidate('audience_memory', runId)
    const performanceId = await insertCandidate('performance_memory', runId)

    const { error } = await admin.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    if (error) throw error

    const { data: e } = await admin.from('evidence_memory').select('status').eq('id', evidenceId).single()
    const { data: a } = await admin.from('audience_memory').select('status').eq('id', audienceId).single()
    const { data: p } = await admin.from('performance_memory').select('status').eq('id', performanceId).single()
    expect(e.status).toBe('retired')
    expect(a.status).toBe('retired')
    expect(p.status).toBe('retired')
  })

  it('a fresh run (well within p_ttl_days): candidates remain untouched', async () => {
    const runId = await makeRun({ status: 'awaiting_ratification', completed_at: daysAgo(5) })
    const evidenceId = await insertCandidate('evidence_memory', runId)

    const { error } = await admin.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    if (error) throw error

    const { data: e } = await admin.from('evidence_memory').select('status').eq('id', evidenceId).single()
    expect(e.status).toBe('candidate')
  })

  it('a run backdated past 2 * p_ttl_days: already-retired candidates are deleted', async () => {
    const runId = await makeRun({ status: 'awaiting_ratification', completed_at: daysAgo(61) })
    const evidenceId = await insertCandidate('evidence_memory', runId, { status: 'retired' })

    const { error } = await admin.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    if (error) throw error

    const { data: e } = await admin.from('evidence_memory').select('id').eq('id', evidenceId).maybeSingle()
    expect(e).toBeNull()
  })

  it("a ratified run's ACTIVE rows are never touched, regardless of age", async () => {
    const runId = await makeRun({ status: 'ratified', completed_at: daysAgo(90), ratified_at: daysAgo(90) })
    const evidenceId = await insertCandidate('evidence_memory', runId, { status: 'active' })

    const { error } = await admin.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    if (error) throw error

    const { data: e } = await admin.from('evidence_memory').select('status').eq('id', evidenceId).single()
    expect(e.status).toBe('active')
  })

  it("a discarded run's already-retired rows (from discard_backfill_run) are never deleted by this sweep", async () => {
    const runId = await makeRun({ status: 'discarded', completed_at: daysAgo(90) })
    const evidenceId = await insertCandidate('evidence_memory', runId, { status: 'retired' })

    const { error } = await admin.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    if (error) throw error

    const { data: e } = await admin.from('evidence_memory').select('id').eq('id', evidenceId).maybeSingle()
    expect(e).not.toBeNull()
  })

  it('authenticated EXECUTE is refused', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const { createClient } = await import('@supabase/supabase-js')
    const email = `backfill-retention-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { error: createErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (createErr) throw createErr
    const client = createClient(url, anonKey)
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password: 'TestPass123!' })
    if (signInErr) throw signInErr

    const { error } = await client.rpc('sweep_expired_backfill_candidates', { p_ttl_days: 30 })
    expect(error).not.toBeNull()

    await admin.auth.admin.deleteUser((await client.auth.getUser()).data.user!.id)
  })
})
