import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-PROVENANCE-SURVIVES-PROMOTION (ADR 0025 §12 constraint 40, Tier
// 1). An import performance row survives ratify (still 'import', same
// run), survives retire, and survives a colliding
// upsert_distilled_performance_pattern call for the same pattern — which
// creates a SEPARATE distilled row (ADR §5.4) and leaves the import row
// byte-identical on source/import_run_id/import_source_post_ids.
describe('performance_memory import row survives ratify, retire and a colliding distilled upsert (ADR 0025 §5.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let runId: string
  const PATTERN_TEXT = 'Shared pattern text for promotion survival test'

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `mem-promotion-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Memory Promotion Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    // The owner is already an approver+admin member automatically
    // (trg_ensure_owner_membership, 20260702120800_ensure_owner_membership.sql)
    // — no explicit business_members insert needed for ratify_backfill_run.

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-promotion-user',
        platform_username: 'promotion_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000070',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({
        business_id: businessId,
        social_account_id: socialAccountId,
        platform: 'twitter',
        // MINOR-3 (Session 32-D, D3) — import_performance_memory now writes
        // zero rows unless the run is 'extracting'; the test below moves it
        // to 'awaiting_ratification' itself before ratifying.
        status: 'extracting',
      })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('survives ratify, retire, and a colliding distilled upsert — provenance columns byte-identical throughout', async () => {
    const now = new Date().toISOString()

    const { data: importRows, error: importErr } = await admin.rpc('import_performance_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-a', 'post-b'],
      p_dimension: 'topic',
      p_pattern: PATTERN_TEXT,
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: now,
      p_expires_at: null,
    })
    if (importErr) throw importErr
    const importRow = importRows[0]
    const originalProvenance = {
      source: importRow.source,
      import_run_id: importRow.import_run_id,
      import_source_post_ids: importRow.import_source_post_ids,
    }
    expect(originalProvenance.source).toBe('import')

    // MAJOR-2 (Session 32-D, D3) — ratify now refuses a run that is not
    // 'awaiting_ratification'.
    const { error: transitionErr } = await admin
      .from('social_backfill_runs')
      .update({ status: 'awaiting_ratification' })
      .eq('id', runId)
    if (transitionErr) throw transitionErr

    // Ratify — accepted, flips candidate -> active.
    const { data: ratifyRows, error: ratifyErr } = await admin.rpc('ratify_backfill_run', {
      p_user_id: ownerId,
      p_run_id: runId,
      p_accepted_ids: [importRow.id],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (ratifyErr) throw ratifyErr
    expect(ratifyRows[0].status).toBe('ratified')

    const { data: afterRatify, error: afterRatifyErr } = await admin
      .from('performance_memory')
      .select('*')
      .eq('id', importRow.id)
      .single()
    if (afterRatifyErr) throw afterRatifyErr
    expect(afterRatify.status).toBe('active')
    expect(afterRatify.source).toBe(originalProvenance.source)
    expect(afterRatify.import_run_id).toBe(originalProvenance.import_run_id)
    expect(afterRatify.import_source_post_ids).toEqual(originalProvenance.import_source_post_ids)

    // Retire (status can move active -> retired without touching provenance
    // — the trigger only guards source/import_run_id/import_source_post_ids).
    const { error: retireErr } = await admin.from('performance_memory').update({ status: 'retired' }).eq('id', importRow.id)
    if (retireErr) throw retireErr

    const { data: afterRetire, error: afterRetireErr } = await admin
      .from('performance_memory')
      .select('*')
      .eq('id', importRow.id)
      .single()
    if (afterRetireErr) throw afterRetireErr
    expect(afterRetire.status).toBe('retired')
    expect(afterRetire.source).toBe(originalProvenance.source)
    expect(afterRetire.import_run_id).toBe(originalProvenance.import_run_id)
    expect(afterRetire.import_source_post_ids).toEqual(originalProvenance.import_source_post_ids)

    // A colliding distilled upsert for the SAME pattern text creates a
    // SEPARATE row — never touches the import row.
    const { data: distilledRows, error: distilledErr } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'topic',
      p_pattern: PATTERN_TEXT,
      p_pattern_key: 'promotion-survival-test-key',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.7,
      p_observation_count: 6,
    })
    if (distilledErr) throw distilledErr
    const distilledRow = distilledRows[0]
    expect(distilledRow.id).not.toBe(importRow.id)
    expect(distilledRow.source).toBe('distilled')

    const { data: finalImportRow, error: finalErr } = await admin
      .from('performance_memory')
      .select('*')
      .eq('id', importRow.id)
      .single()
    if (finalErr) throw finalErr
    expect(finalImportRow.source).toBe(originalProvenance.source)
    expect(finalImportRow.import_run_id).toBe(originalProvenance.import_run_id)
    expect(finalImportRow.import_source_post_ids).toEqual(originalProvenance.import_source_post_ids)
  })
})
