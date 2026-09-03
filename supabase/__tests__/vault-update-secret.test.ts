import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

// ADR 0028 §4.1, A-2, D-alpha — Tier-1, live Postgres. public.vault_update_secret
// must (1) exist, (2) update a Vault secret IN PLACE — same secret id before and
// after, new decrypted value — and (3) deny EXECUTE to anon and authenticated
// while granting it to service_role. D-alpha: the function did not exist and
// native token refresh has never worked as a result — this suite is the
// compensating proof that it now does.
//
// Verification reads vault.decrypted_secrets directly over a raw Postgres
// connection (mirroring supabase/__tests__/rls-policy-lockdown.test.ts's
// pattern), rather than through the public.get_vault_secret RPC wrapper —
// that wrapper's migration (20260504120024_vault_helpers.sql) is present in
// the repo but not applied to this environment's live database, a
// pre-existing drift unrelated to this step and out of this step's scope to
// fix.

const PASSWORD = 'TestPass123!'

describe('public.vault_update_secret (ADR 0028 §4.1, A-2, D-alpha)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let secretId: string
  let userId: string
  let userEmail: string

  async function readDecryptedSecret(id: string): Promise<string | null> {
    const { rows } = await pg.query<{ decrypted_secret: string }>(
      'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1',
      [id],
    )
    return rows[0]?.decrypted_secret ?? null
  }

  async function signInAsUser() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email: userEmail, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL is required for vault_update_secret Tier-1 tests')
    pg = new Client({ connectionString: dbUrl })
    await pg.connect()

    const email = `vault-upd-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (userErr) throw userErr
    userId = user.user.id
    userEmail = email

    const { data: created, error: createErr } = await admin.rpc('vault_create_secret', {
      secret: 'initial-secret-value',
      name: `vault-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: 'N2.3 vault_update_secret Tier-1 test fixture',
    })
    if (createErr) throw createErr
    secretId = created as string
  })

  afterAll(async () => {
    if (admin && secretId) {
      try {
        await admin.rpc('vault_delete_secret', { secret_id: secretId })
      } catch {
        // best-effort cleanup
      }
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId)
    await pg?.end()
  })

  it('the function exists and is callable by service_role', async () => {
    const { error } = await admin.rpc('vault_update_secret', {
      secret_id: secretId,
      new_secret: 'updated-secret-value-1',
    })
    expect(error).toBeNull()
  })

  it('updates the secret IN PLACE — same secret id, new decrypted value', async () => {
    const { error: updateErr } = await admin.rpc('vault_update_secret', {
      secret_id: secretId,
      new_secret: 'updated-secret-value-2',
    })
    expect(updateErr).toBeNull()

    const decrypted = await readDecryptedSecret(secretId)
    expect(decrypted).toBe('updated-secret-value-2')

    // The id itself must not have changed — social_accounts.vault_access_token_id
    // stays stable across a refresh (ADR 0002 §8), which is the entire reason an
    // in-place update function exists instead of delete-then-create.
    const secondRead = await readDecryptedSecret(secretId)
    expect(secondRead).toBe('updated-secret-value-2')
  })

  it('EXECUTE is denied to anon — a permission test that only proves the happy path proves nothing', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('Supabase env vars required')
    const anon = createClient(url, anonKey)
    const { error } = await anon.rpc('vault_update_secret', {
      secret_id: secretId,
      new_secret: 'anon-should-not-work',
    })
    expect(error).not.toBeNull()

    // Confirm the denial actually held — the value must be unchanged.
    const unchanged = await readDecryptedSecret(secretId)
    expect(unchanged).not.toBe('anon-should-not-work')
  })

  it('EXECUTE is denied to authenticated', async () => {
    const client = await signInAsUser()
    const { error } = await client.rpc('vault_update_secret', {
      secret_id: secretId,
      new_secret: 'authenticated-should-not-work',
    })
    expect(error).not.toBeNull()

    const unchanged = await readDecryptedSecret(secretId)
    expect(unchanged).not.toBe('authenticated-should-not-work')
  })

  it('EXECUTE is granted to service_role (positive control for the two denials above)', async () => {
    const { error } = await admin.rpc('vault_update_secret', {
      secret_id: secretId,
      new_secret: 'service-role-control-value',
    })
    expect(error).toBeNull()

    const value = await readDecryptedSecret(secretId)
    expect(value).toBe('service-role-control-value')
  })
})
