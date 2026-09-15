import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// BACKFILL-RATIFY-ATOMIC (ADR 0025 §12 constraint 45, Tier 1) — exactly ADR
// §9.4. A non-member and a 'viewer' are refused; an approver succeeds; a
// stuck summarize: (distilled) candidate with no run id in the SAME
// business is NOT activated; an import row from a DIFFERENT run passed in
// p_accepted_ids is NOT activated; staged_voice is untouched; staging is
// gone; authenticated EXECUTE is refused.
const PASSWORD = 'TestPass123!'

describe('ratify_backfill_run (ADR 0025 §9.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let approverId: string
  let approverEmail: string
  let viewerId: string
  let viewerEmail: string
  let nonMemberId: string
  let nonMemberEmail: string

  async function createUser(label: string) {
    const email = `ratify-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Ratify Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const approver = await createUser('approver')
    approverId = approver.id
    approverEmail = approver.email
    const viewer = await createUser('viewer')
    viewerId = viewer.id
    viewerEmail = viewer.email
    const nonMember = await createUser('nonmember')
    nonMemberId = nonMember.id
    nonMemberEmail = nonMember.email

    const { error: membersErr } = await admin.from('business_members').insert([
      { business_id: businessId, user_id: approverId, email: approverEmail, role: 'approver', status: 'active' },
      { business_id: businessId, user_id: viewerId, email: viewerEmail, role: 'viewer', status: 'active' },
    ])
    if (membersErr) throw membersErr

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-ratify-user',
        platform_username: 'ratify_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000090',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    for (const id of [ownerId, approverId, viewerId, nonMemberId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  async function signInAs(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  let runCounter = 0

  // Each call needs its OWN account — social_backfill_runs_live_account_uq
  // (BACKFILL-ONCE-PER-ACCOUNT) is a real DB constraint that blocks a second
  // non-discarded run for the same account, and some tests call this twice.
  async function makeRun(overrides: Record<string, unknown> = {}) {
    runCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-ratify-user-${runCounter}`,
        platform_username: `ratify_handle_${runCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(90 + runCounter)}`,
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
        status: 'awaiting_ratification',
        staged_voice: { tone: ['direct'] },
        ...overrides,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  it('a non-member is refused', async () => {
    const runId = await makeRun()
    const { error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: nonMemberId,
      p_run_id: runId,
      p_accepted_ids: [],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    expect(error).not.toBeNull()
  })

  it("a 'viewer' is refused", async () => {
    const runId = await makeRun()
    const { error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: viewerId,
      p_run_id: runId,
      p_accepted_ids: [],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    expect(error).not.toBeNull()
  })

  it('an approver succeeds; staged_voice is untouched; staging is gone', async () => {
    const runId = await makeRun()
    const { error: postErr } = await admin.from('social_backfill_posts').insert({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: 'ratify-staging-post-1',
      published_at: new Date().toISOString(),
      content: 'staged content',
      format: 'text',
    })
    if (postErr) throw postErr

    const { data, error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runId,
      p_accepted_ids: [],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (error) throw error
    expect(data[0].status).toBe('ratified')
    expect(data[0].staged_voice).toEqual({ tone: ['direct'] })
    expect(data[0].voice_status).toBe('pending')

    const { data: staging } = await admin.from('social_backfill_posts').select('id').eq('run_id', runId)
    expect(staging ?? []).toEqual([])
  })

  it('a stuck summarize: (distilled) candidate with no run id, same business, is NOT activated', async () => {
    const runId = await makeRun()
    const { data: stuckRow, error: stuckErr } = await admin
      .from('performance_memory')
      .insert({
        business_id: businessId,
        source: 'distilled',
        scope: 'brand',
        dimension: 'format',
        pattern: 'stuck summarize candidate',
        pattern_key: 'summarize:stuck-candidate',
        status: 'candidate',
      })
      .select('id')
      .single()
    if (stuckErr) throw stuckErr

    const { error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runId,
      p_accepted_ids: [stuckRow.id],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (error) throw error

    const { data: afterRow } = await admin.from('performance_memory').select('status').eq('id', stuckRow.id).single()
    expect(afterRow.status).toBe('candidate')
  })

  it('an import row from a DIFFERENT run, passed in p_accepted_ids, is NOT activated', async () => {
    const runA = await makeRun()
    // MINOR-3 (Session 32-D, D3) — import_evidence_memory now writes zero
    // rows unless the owning run is 'extracting'; makeRun's default status
    // is 'awaiting_ratification'.
    const runB = await makeRun({ status: 'extracting' })

    const { data: importRows, error: importErr } = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runB,
      p_import_source_post_ids: ['cross-run-post'],
      p_kind: 'quote',
      p_content: 'Cross-run evidence content',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (importErr) throw importErr
    const rowFromRunB = importRows[0]

    // Try to ratify runA, accepting the row that actually belongs to runB.
    const { error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runA,
      p_accepted_ids: [rowFromRunB.id],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (error) throw error

    const { data: afterRow } = await admin.from('evidence_memory').select('status').eq('id', rowFromRunB.id).single()
    expect(afterRow.status).toBe('candidate')
  })

  // MAJOR-2 (Session 32-D, D3) — the status guard moved BEFORE the memory
  // UPDATEs and the staging DELETE. Ratifying an 'extracting' run (not
  // 'awaiting_ratification') must touch NOTHING: zero status changes on any
  // candidate, staging still present, zero rows returned.
  it("ratifying an 'extracting' run: zero status changes, staging count unchanged, zero rows returned", async () => {
    const runId = await makeRun({ status: 'extracting' })

    const { data: candidate, error: candidateErr } = await admin
      .from('evidence_memory')
      .insert({
        business_id: businessId,
        source: 'import',
        import_run_id: runId,
        import_source_post_ids: ['major-2-post'],
        confidence: 0.5,
        status: 'candidate',
        sensitivity: 'internal',
        public_use_permission: false,
        scope: 'brand',
        kind: 'quote',
        content: 'MAJOR-2 guard-order candidate',
      })
      .select('id')
      .single()
    if (candidateErr) throw candidateErr

    const { error: postErr } = await admin.from('social_backfill_posts').insert({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: 'major-2-staging-post-1',
      published_at: new Date().toISOString(),
      content: 'staged content',
      format: 'text',
    })
    if (postErr) throw postErr

    const { data, error } = await admin.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runId,
      p_accepted_ids: [candidate.id],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (error) throw error
    expect(data).toEqual([])

    const { data: afterCandidate } = await admin.from('evidence_memory').select('status').eq('id', candidate.id).single()
    expect(afterCandidate.status).toBe('candidate')

    const { data: staging } = await admin.from('social_backfill_posts').select('id').eq('run_id', runId)
    expect(staging).toHaveLength(1)

    const { data: afterRun } = await admin.from('social_backfill_runs').select('status').eq('id', runId).single()
    expect(afterRun.status).toBe('extracting')
  })

  it('authenticated EXECUTE is refused', async () => {
    const runId = await makeRun()
    const client = await signInAs(approverEmail)
    const { error } = await client.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runId,
      p_accepted_ids: [],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    expect(error).not.toBeNull()
  })
})
