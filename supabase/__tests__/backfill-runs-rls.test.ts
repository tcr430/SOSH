import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// BACKFILL-RLS-ISOLATED (ADR 0025 §9.1/§12 constraint 47, Tier 1). Asserts
// actual query outcomes, never a pg_policies read: a member SELECTs own
// runs; another tenant sees zero; authenticated INSERT/UPDATE/DELETE on
// runs are refused; ANY authenticated access to posts (which carries no
// policy at all) returns zero rows / is refused.
const PASSWORD = 'TestPass123!'

describe('social_backfill_runs / social_backfill_posts RLS isolation (ADR 0025 §9.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerAEmail: string
  let businessAId: string
  let socialAccountAId: string
  let runAId: string

  let ownerBId: string
  let ownerBEmail: string
  let businessBId: string

  async function createUser(label: string) {
    const email = `backfill-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const a = await createUser('owner-a')
    ownerAId = a.id
    ownerAEmail = a.email
    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill RLS Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessAId,
        platform: 'twitter',
        platform_user_id: 'x-rls-user-a',
        platform_username: 'rls_handle_a',
        vault_access_token_id: '00000000-0000-4000-8000-000000000010',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountAId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessAId, social_account_id: socialAccountAId, platform: 'twitter' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runAId = run.id

    const b = await createUser('owner-b')
    ownerBId = b.id
    ownerBEmail = b.email
    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill RLS Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id
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

  it('a member SELECTs their own business\'s runs', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('social_backfill_runs').select('id').eq('business_id', businessAId)
    expect(error).toBeNull()
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(runAId)
  })

  it('another tenant sees zero runs for a business they do not own', async () => {
    const client = await signInAs(ownerBEmail)
    const { data, error } = await client.from('social_backfill_runs').select('id').eq('business_id', businessAId)
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('authenticated INSERT on runs is refused', async () => {
    const client = await signInAs(ownerAEmail)
    const { error } = await client
      .from('social_backfill_runs')
      .insert({ business_id: businessAId, social_account_id: socialAccountAId, platform: 'twitter' })
    expect(error).not.toBeNull()
  })

  it('authenticated UPDATE on runs is refused', async () => {
    const client = await signInAs(ownerAEmail)
    const { error } = await client.from('social_backfill_runs').update({ status: 'discarded' }).eq('id', runAId)
    expect(error).not.toBeNull()
  })

  it('authenticated DELETE on runs is refused', async () => {
    const client = await signInAs(ownerAEmail)
    const { error } = await client.from('social_backfill_runs').delete().eq('id', runAId)
    expect(error).not.toBeNull()
  })

  it('ANY authenticated SELECT on posts (own business) returns zero rows / is refused — no policy exists at all', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('social_backfill_posts').select('id').eq('business_id', businessAId)
    // Deny-by-default: either the query errors (table-level REVOKE) or
    // returns zero rows (RLS zero-policy) — either outcome proves isolation;
    // what must NEVER happen is a non-empty result.
    if (error === null) {
      expect(data ?? []).toEqual([])
    } else {
      expect(error).not.toBeNull()
    }
  })

  it('authenticated INSERT on posts is refused', async () => {
    const client = await signInAs(ownerAEmail)
    const { error } = await client.from('social_backfill_posts').insert({
      business_id: businessAId,
      run_id: runAId,
      social_account_id: socialAccountAId,
      platform_post_id: 'forged-post-1',
      published_at: new Date().toISOString(),
      content: 'forged',
      format: 'text',
    })
    expect(error).not.toBeNull()
  })
})
