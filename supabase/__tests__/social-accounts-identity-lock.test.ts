import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// BACKFILL-SOCIAL-ACCOUNT-IDENTITY-LOCKED (ADR 0025 §7.3/§12 constraint 14,
// Tier 1). Asserts the ACTUAL UPDATE outcome against live Postgres — never a
// pg_policies or information_schema read, per this constraint's own proof
// requirement. One case per locked column, plus one allowlisted column that
// must still succeed (so a too-broad REVOKE would also redden here).
const PASSWORD = 'TestPass123!'

describe('social_accounts identity lock (ADR 0025 §7.3, 20260913120000_social_accounts_identity_lock.sql)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let ownerId: string
  let ownerEmail: string
  let socialAccountId: string

  async function signInAsOwner() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    ownerEmail = `social-lock-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: PASSWORD,
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Social Lock Test Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-locked-user-id',
        platform_username: 'locked_handle',
        platform_display_name: 'Locked Handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000001',
        vault_refresh_token_id: null,
        token_expires_at: null,
        is_active: true,
        connected_at: new Date().toISOString(),
        scopes_granted: null,
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('social_accounts').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  const LOCKED_COLUMN_CASES: Array<{ column: string; value: unknown }> = [
    // NIT-4 (Session 32-D, D3) — id was the one column in the ALLOWLIST
    // EXCEPT list (20260913120000's header comment) never actually covered
    // by a case here.
    { column: 'id', value: '00000000-0000-4000-8000-000000000099' },
    { column: 'platform_user_id', value: 'attacker-controlled-user-id' },
    { column: 'vault_access_token_id', value: '00000000-0000-4000-8000-000000000002' },
    { column: 'vault_refresh_token_id', value: '00000000-0000-4000-8000-000000000003' },
    { column: 'is_active', value: false },
    { column: 'token_expires_at', value: '2099-01-01T00:00:00Z' },
    { column: 'scopes_granted', value: ['forged.scope'] },
    { column: 'business_id', value: '00000000-0000-4000-8000-000000000099' },
    { column: 'platform', value: 'linkedin' },
    { column: 'connected_at', value: '2020-01-01T00:00:00Z' },
  ]

  it.each(LOCKED_COLUMN_CASES)(
    'authenticated UPDATE of locked column "$column" fails with a privilege error (42501)',
    async ({ column, value }) => {
      const client = await signInAsOwner()
      const { error } = await client
        .from('social_accounts')
        .update({ [column]: value })
        .eq('id', socialAccountId)

      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    },
  )

  it('authenticated UPDATE of an allowlisted column (platform_username) SUCCEEDS', async () => {
    const client = await signInAsOwner()
    const { data, error } = await client
      .from('social_accounts')
      .update({ platform_username: 'renamed_by_owner' })
      .eq('id', socialAccountId)
      .select('platform_username')
      .single()

    expect(error).toBeNull()
    expect(data?.platform_username).toBe('renamed_by_owner')
  })

  // MINOR-8 (Session 32-D, D3) — authenticated held a table-level INSERT and
  // DELETE grant on social_accounts (same over-wide-grant shape UPDATE had
  // before this migration's predecessor), closed by a table-level REVOKE.
  // Both fail with 42501 — a privilege error, never an RLS-policy-shaped
  // empty result.
  it('authenticated INSERT on social_accounts fails with a privilege error (42501)', async () => {
    const client = await signInAsOwner()
    const { error } = await client.from('social_accounts').insert({
      business_id: businessId,
      platform: 'twitter',
      platform_user_id: 'attacker-inserted-account',
      platform_username: 'attacker_handle',
      vault_access_token_id: '00000000-0000-4000-8000-000000000098',
      connected_at: new Date().toISOString(),
    })

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('authenticated DELETE on social_accounts fails with a privilege error (42501)', async () => {
    const client = await signInAsOwner()
    const { error } = await client.from('social_accounts').delete().eq('id', socialAccountId)

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('the service-role OAuth callback path (upsert) is unaffected — positive control', async () => {
    const { data, error } = await admin
      .from('social_accounts')
      .update({ platform_username: 'service-role-still-works' })
      .eq('id', socialAccountId)
      .select('platform_username')
      .single()

    expect(error).toBeNull()
    expect(data?.platform_username).toBe('service-role-still-works')
  })
})
