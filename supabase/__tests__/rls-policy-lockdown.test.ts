import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

describe('RLS policy lockdown — pg_catalog audit', () => {
  let pg: Client

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for RLS lockdown tests')
    pg = new Client({ connectionString: url })
    await pg.connect()
  })

  afterAll(async () => {
    await pg?.end()
  })

  async function getPolicies(tablename: string) {
    const { rows } = await pg.query<{
      policyname: string
      permissive: string
      roles: string[]
      cmd: string
      qual: string | null
      with_check: string | null
    }>(
      `SELECT policyname, permissive, roles, cmd, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY policyname`,
      [tablename],
    )
    return rows
  }

  async function isRlsEnabled(tablename: string): Promise<boolean> {
    const { rows } = await pg.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity
         FROM pg_class
        WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
      [tablename],
    )
    return rows[0]?.relrowsecurity === true
  }

  it('business_deletion_requests has RLS enabled', async () => {
    expect(await isRlsEnabled('business_deletion_requests')).toBe(true)
  })

  it('business_deletion_requests has exactly one authenticated SELECT policy', async () => {
    const policies = await getPolicies('business_deletion_requests')
    const selectPolicies = policies.filter(
      (p) => p.cmd === 'SELECT' && p.roles.includes('authenticated'),
    )
    expect(selectPolicies).toHaveLength(1)
    expect(selectPolicies[0].policyname).toBe('owner can read own deletion request')
  })

  it('business_deletion_requests SELECT policy uses array ANY pattern (not IN subquery)', async () => {
    const policies = await getPolicies('business_deletion_requests')
    const policy = policies.find((p) => p.policyname === 'owner can read own deletion request')
    expect(policy).toBeDefined()
    // Postgres normalises the qual expression; verify it references get_user_business_ids
    expect(policy?.qual).toMatch(/get_user_business_ids/)
    // Must NOT contain the broken "= uuid[]" comparison (IN subquery artefact)
    expect(policy?.qual).not.toMatch(/= uuid\[\]/)
  })

  it('business_deletion_requests has no INSERT/UPDATE/DELETE policies for authenticated role', async () => {
    const policies = await getPolicies('business_deletion_requests')
    const mutatePolicies = policies.filter(
      (p) =>
        ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(p.cmd) &&
        p.roles.includes('authenticated'),
    )
    expect(mutatePolicies).toHaveLength(0)
  })

  it('email_outbox has RLS enabled', async () => {
    expect(await isRlsEnabled('email_outbox')).toBe(true)
  })

  it('email_outbox SELECT policy uses array ANY pattern (not IN subquery)', async () => {
    const policies = await getPolicies('email_outbox')
    const policy = policies.find((p) => p.policyname === 'email_outbox_select_own')
    expect(policy).toBeDefined()
    expect(policy?.qual).toMatch(/get_user_business_ids/)
    expect(policy?.qual).not.toMatch(/= uuid\[\]/)
  })

  it('claim_deletion_requests function is executable by service_role only', async () => {
    const { rows } = await pg.query<{ grantee: string }>(
      `SELECT grantee
         FROM information_schema.routine_privileges
        WHERE routine_name = 'claim_deletion_requests'
          AND privilege_type = 'EXECUTE'`,
    )
    const grantees = rows.map((r) => r.grantee)
    expect(grantees).not.toContain('PUBLIC')
    expect(grantees).not.toContain('public')
    expect(grantees).toContain('service_role')
  })

  // B3 / RLS-MEMBERS-USINGCHECK — every write policy must carry the correct
  // clause(s) per command: INSERT gets WITH CHECK only, DELETE gets USING
  // only, UPDATE gets BOTH (guards tenant tunnelling, ADR 0013 §2.1/§5/§5.3/§5.4).
  const WRITE_POLICY_TABLES = ['business_members', 'posts', 'campaigns', 'social_accounts'] as const

  it.each(WRITE_POLICY_TABLES)('%s: every authenticated INSERT policy has WITH CHECK', async (tablename) => {
    const policies = await getPolicies(tablename)
    const inserts = policies.filter((p) => p.cmd === 'INSERT' && p.roles.includes('authenticated'))
    expect(inserts.length).toBeGreaterThan(0)
    for (const p of inserts) {
      expect(p.with_check).not.toBeNull()
    }
  })

  it.each(WRITE_POLICY_TABLES)('%s: every authenticated UPDATE policy has both USING and WITH CHECK', async (tablename) => {
    const policies = await getPolicies(tablename)
    const updates = policies.filter((p) => p.cmd === 'UPDATE' && p.roles.includes('authenticated'))
    expect(updates.length).toBeGreaterThan(0)
    for (const p of updates) {
      expect(p.qual).not.toBeNull()
      expect(p.with_check).not.toBeNull()
    }
  })

  it('posts/campaigns/social_accounts: every authenticated DELETE policy has USING', async () => {
    for (const tablename of ['posts', 'campaigns', 'social_accounts'] as const) {
      const policies = await getPolicies(tablename)
      const deletes = policies.filter((p) => p.cmd === 'DELETE' && p.roles.includes('authenticated'))
      expect(deletes.length).toBeGreaterThan(0)
      for (const p of deletes) {
        expect(p.qual).not.toBeNull()
      }
    }
  })

  it('business_members has no DELETE policy for authenticated (revocation is UPDATE status=revoked, §2.1)', async () => {
    const policies = await getPolicies('business_members')
    const deletes = policies.filter(
      (p) => ['DELETE', 'ALL'].includes(p.cmd) && p.roles.includes('authenticated'),
    )
    expect(deletes).toHaveLength(0)
  })

  it('purge_business function is executable by service_role only', async () => {
    const { rows } = await pg.query<{ grantee: string }>(
      `SELECT grantee
         FROM information_schema.routine_privileges
        WHERE routine_name = 'purge_business'
          AND privilege_type = 'EXECUTE'`,
    )
    const grantees = rows.map((r) => r.grantee)
    expect(grantees).not.toContain('PUBLIC')
    expect(grantees).not.toContain('public')
    expect(grantees).toContain('service_role')
  })
})
