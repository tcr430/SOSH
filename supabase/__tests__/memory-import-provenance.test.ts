import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-PROVENANCE-MARKED (ADR 0025 §12 constraint 38) and
// BACKFILL-PROVENANCE-IMMUTABLE (constraint 39), Tier 1. On EACH of the
// four *_memory tables: source='import' with a NULL run id fails; a run id
// with source='manual' fails; NULL post ids with source='import' fails; the
// BEFORE UPDATE trigger rejects changing each of the three provenance
// columns, even from a service-role UPDATE (the trigger holds regardless of
// which code path issues the write).
describe('memory import provenance marker + immutability (ADR 0025 §5.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let runId: string
  let otherRunId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `mem-provenance-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Memory Provenance Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-provenance-user',
        platform_username: 'provenance_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000060',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id

    // A second run needs its OWN account — social_backfill_runs_live_account_uq
    // (BACKFILL-ONCE-PER-ACCOUNT) is a real DB constraint, not something a
    // service-role client bypasses; it blocks a second non-discarded run for
    // the SAME account regardless of caller.
    const { data: otherAccount, error: otherAccountErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-provenance-user-2',
        platform_username: 'provenance_handle_2',
        vault_access_token_id: '00000000-0000-4000-8000-000000000061',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (otherAccountErr) throw otherAccountErr

    const { data: otherRun, error: otherRunErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: otherAccount.id, platform: 'twitter' })
      .select('id')
      .single()
    if (otherRunErr) throw otherRunErr
    otherRunId = otherRun.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  const TABLES = [
    { table: 'brand_memory', domain: { category: 'other', statement: 'Test brand statement' } },
    { table: 'evidence_memory', domain: { kind: 'quote', content: 'Test evidence content' } },
    { table: 'audience_memory', domain: { kind: 'problem', statement: 'Test audience statement' } },
    { table: 'performance_memory', domain: { dimension: 'topic', pattern: 'Test pattern' } },
  ]

  for (const { table, domain } of TABLES) {
    describe(table, () => {
      it("source='import' with NULL import_run_id fails", async () => {
        const { error } = await admin.from(table).insert({
          business_id: businessId,
          source: 'import',
          scope: 'brand',
          import_run_id: null,
          import_source_post_ids: ['post-1'],
          ...domain,
        })
        expect(error).not.toBeNull()
      })

      it("a non-null import_run_id with source='manual' fails", async () => {
        const { error } = await admin.from(table).insert({
          business_id: businessId,
          source: 'manual',
          scope: 'brand',
          import_run_id: runId,
          import_source_post_ids: null,
          ...domain,
        })
        expect(error).not.toBeNull()
      })

      it("source='import' with NULL import_source_post_ids fails", async () => {
        const { error } = await admin.from(table).insert({
          business_id: businessId,
          source: 'import',
          scope: 'brand',
          import_run_id: runId,
          import_source_post_ids: null,
          ...domain,
        })
        expect(error).not.toBeNull()
      })

      it('the trigger rejects changing source, import_run_id or import_source_post_ids on UPDATE — even from service-role', async () => {
        const { data: row, error: insertErr } = await admin
          .from(table)
          .insert({
            business_id: businessId,
            source: 'import',
            scope: 'brand',
            import_run_id: runId,
            import_source_post_ids: ['post-1'],
            ...domain,
          })
          .select('id')
          .single()
        if (insertErr) throw insertErr

        const { error: sourceErr } = await admin.from(table).update({ source: 'manual' }).eq('id', row.id)
        expect(sourceErr).not.toBeNull()

        const { error: runIdErr } = await admin.from(table).update({ import_run_id: otherRunId }).eq('id', row.id)
        expect(runIdErr).not.toBeNull()

        const { error: postIdsErr } = await admin
          .from(table)
          .update({ import_source_post_ids: ['different-post'] })
          .eq('id', row.id)
        expect(postIdsErr).not.toBeNull()
      })
    })
  }
})
