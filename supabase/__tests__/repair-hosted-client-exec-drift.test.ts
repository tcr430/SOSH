import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

// Session 36 / A-8 follow-up (20261004100000). On hosted, 18 SECURITY DEFINER functions kept the platform's default anon/authenticated EXECUTE grants
// while a fresh database has them service_role-only. The migration re-states the fresh-database ACLs; this is Tier 1 on a live Postgres, and it is
// the guard that a fresh database keeps these ACLs (the hosted half is the launch-checklist row's before/after audit).
//
// The function list is DERIVED from the migration (never hand-written): every `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` line is a
// service-role RPC; the two trigger functions and the two authenticated-only functions end differently and are asserted by name.

const MIGRATION = '20261004100000_repair_hosted_client_exec_drift.sql'

function deriveServiceRoleSignatures(): string[] {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8')
  return [...sql.matchAll(/^REVOKE ALL ON FUNCTION (public\.\w+\([^)]*\)) FROM PUBLIC, anon, authenticated;\r?$/gm)].map((m) => m[1]).sort()
}

describe('hosted client-EXECUTE drift repair: ACLs on a fresh database (live Postgres)', () => {
  const signatures = deriveServiceRoleSignatures()
  let pg: Client

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })

  afterAll(async () => {
    await pg?.end()
  })

  async function priv(signature: string) {
    const { rows } = await pg.query(
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS service_role`,
      [signature],
    )
    return rows[0] as { anon: boolean; authenticated: boolean; service_role: boolean }
  }

  it('the derived set is the 16 service-role RPCs, and each resolves to a live function', async () => {
    expect(signatures).toHaveLength(16)
    for (const signature of signatures) {
      const { rows } = await pg.query(`SELECT $1::regprocedure::text AS sig`, [signature])
      expect(rows).toHaveLength(1)
    }
  })

  it('each service-role RPC: anon and authenticated hold no EXECUTE, service_role does', async () => {
    for (const signature of signatures) {
      expect(await priv(signature), signature).toEqual({ anon: false, authenticated: false, service_role: true })
    }
  })

  it('the two trigger functions have no client EXECUTE', async () => {
    for (const signature of ['public.create_trial_state_for_new_business()', 'public.start_trial_on_first_social_account()']) {
      const p = await priv(signature)
      expect(p.anon, signature).toBe(false)
      expect(p.authenticated, signature).toBe(false)
    }
  })

  it('accept_invite and get_user_business_ids stay callable by authenticated, never by anon', async () => {
    for (const signature of ['public.accept_invite(uuid, uuid)', 'public.get_user_business_ids()']) {
      const p = await priv(signature)
      expect(p.authenticated, signature).toBe(true)
      expect(p.anon, signature).toBe(false)
    }
  })

  it('the migration is idempotent: running it again changes nothing', async () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8')
    const snapshot = `SELECT p.oid::regprocedure::text AS sig, coalesce(p.proacl::text, 'NULL') AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1`
    const before = (await pg.query(snapshot)).rows
    await pg.query(sql)
    const after = (await pg.query(snapshot)).rows
    expect(after).toEqual(before)
  })
})
