import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const INTEGRATION = process.env.DELETION_INTEGRATION_TEST_ENABLED === 'true'

describe.skipIf(!INTEGRATION)('purge_business RPC — integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any
  let businessId: string
  let requestId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    client = createServiceRoleClient()

    // Create a test owner in auth.users
    const { data: authUser, error: authErr } = await client.auth.admin.createUser({
      email: `deletion-test-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    const ownerId = authUser.user.id

    // Create a business owned by that user
    const { data: biz, error: bizErr } = await client
      .from('businesses')
      .insert({
        name: 'Integration Test Business',
        owner_id: ownerId,
        plan: 'plus',
        trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    // Create a deletion request (31 days ago, already verified)
    const requestedAt = new Date(Date.now() - 31 * 86400000).toISOString()
    const { data: req, error: reqErr } = await client
      .from('business_deletion_requests')
      .insert({
        business_id: businessId,
        requested_at: requestedAt,
        verified_at: requestedAt,
        status: 'processing',
      })
      .select('id')
      .single()
    if (reqErr) throw reqErr
    requestId = req.id
  })

  afterAll(async () => {
    if (!client) return
    // The business is deleted by the test; only the audit row remains.
    await client
      .from('business_deletion_requests')
      .delete()
      .eq('id', requestId)
  })

  it('purge_business deletes the business and returns correct metadata', async () => {
    const { data, error } = await client.rpc('purge_business', {
      p_business_id: businessId,
    })

    expect(error).toBeNull()
    expect(data.already_purged).toBe(false)
    expect(data.business_id).toBe(businessId)
    expect(typeof data.vault_secrets_deleted).toBe('number')
    expect(typeof data.billing_events_redacted).toBe('number')
    expect(data.purged_at).toBeTruthy()

    // Verify business row is gone
    const { data: gone } = await client
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .maybeSingle()
    expect(gone).toBeNull()
  })

  it('purge_business is idempotent: second call returns already_purged=true', async () => {
    const { data, error } = await client.rpc('purge_business', {
      p_business_id: businessId,
    })

    expect(error).toBeNull()
    expect(data.already_purged).toBe(true)
    expect(data.business_id).toBe(businessId)
  })

  it('business_deletion_requests row survives business deletion (GDPR audit trail)', async () => {
    const { data } = await client
      .from('business_deletion_requests')
      .select('id, business_id, status')
      .eq('id', requestId)
      .maybeSingle()

    expect(data).not.toBeNull()
    expect(data.business_id).toBe(businessId)
  })
})
