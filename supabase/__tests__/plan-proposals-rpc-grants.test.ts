import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { createWorld, destroyWorld, type World } from '../__helpers__/outcome-fixtures'

// ADR 0027 — MAJOR-6 (Session 34-D, D1). apply_brief_proposals and decide_plan_proposal take p_user_id as a
// PARAMETER and check the capability of THAT id, so the whole authorisation model rests on the
// REVOKE/GRANT lines in the two plan-proposal migrations. A later DROP FUNCTION ... CREATE FUNCTION restores
// the default PUBLIC EXECUTE and nothing else would go red. Precedent shape: rls-policy-lockdown.test.ts,
// "purge_business function is executable by service_role only".
//
// The function list is DERIVED from the migrations (never hand-written): every
// `CREATE OR REPLACE FUNCTION public.<name>(` in the two files below.

const MIGRATIONS = [
  '20260922110000_campaign_plan_proposal_rpcs.sql',
  '20260923100000_plan_proposal_version_scope_and_reason_check.sql',
]

const REQUIRED = [
  'apply_brief_proposals',
  'decide_plan_proposal',
  'approve_brief_and_supersede_proposals',
  'revise_brief_and_supersede_proposals',
  'assert_plan_proposal_author',
  'reserve_ai_budget',
]

function deriveFunctionNames(): string[] {
  const names = new Set<string>()
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8')
    for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\s*\(/g)) names.add(m[1])
  }
  return [...names].sort()
}

interface FnRow {
  oid: number
  name: string
  argnames: string[]
  argtypes: string[]
}

describe('plan-proposal SECURITY DEFINER RPCs are executable by service_role only (ADR 0027, MAJOR-6, live Postgres)', () => {
  const functionNames = deriveFunctionNames()
  let w: World
  let pg: Client
  let member: SupabaseClient
  let anon: SupabaseClient
  const fns: FnRow[] = []

  beforeAll(async () => {
    w = await createWorld('plan-rpc-grants')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()

    member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await member.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
    if (error) throw error
    anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)

    const { rows } = await pg.query<{ oid: number; proname: string; argnames: string[] | null; argtypes: string[] }>(
      `SELECT p.oid::int AS oid, p.proname, p.proargnames AS argnames,
              ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY u(t, i) ORDER BY i) AS argtypes
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
      [functionNames],
    )
    for (const r of rows) fns.push({ oid: r.oid, name: r.proname, argnames: r.argnames ?? [], argtypes: r.argtypes })
  })

  afterAll(async () => {
    await destroyWorld(w)
    await pg?.end()
  })

  it('the derived function set is non-empty and covers the security-critical RPCs', () => {
    expect(functionNames.length).toBeGreaterThan(0)
    for (const required of REQUIRED) expect(functionNames).toContain(required)
  })

  it('every derived function exists in the live database', () => {
    const live = new Set(fns.map((f) => f.name))
    for (const name of functionNames) expect(live.has(name), `${name} not found in pg_proc`).toBe(true)
  })

  it('anon, authenticated and PUBLIC hold no EXECUTE on any derived function; service_role does', async () => {
    for (const f of fns) {
      const { rows } = await pg.query<{ grantee: string }>(
        `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee
           FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = $1 AND a.privilege_type = 'EXECUTE'`,
        [f.oid],
      )
      const grantees = rows.map((r) => r.grantee)
      expect(grantees, `${f.name} grantees`).not.toContain('PUBLIC')
      expect(grantees, `${f.name} grantees`).not.toContain('anon')
      expect(grantees, `${f.name} grantees`).not.toContain('authenticated')
      expect(grantees, `${f.name} grantees`).toContain('service_role')

      const { rows: priv } = await pg.query<{ anon: boolean; authenticated: boolean }>(
        `SELECT has_function_privilege('anon', $1::oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1::oid, 'EXECUTE') AS authenticated`,
        [f.oid],
      )
      expect(priv[0].anon, `${f.name} anon`).toBe(false)
      expect(priv[0].authenticated, `${f.name} authenticated`).toBe(false)
    }
  })

  // Plausible arguments: the OWNER's id wherever the function takes a p_user_id, the real business id for
  // p_business_id, so a refusal can only come from the EXECUTE grant, never from a bad argument.
  function argsFor(f: FnRow): Record<string, unknown> {
    const args: Record<string, unknown> = {}
    f.argnames.forEach((name, i) => {
      const type = f.argtypes[i]
      if (name === 'p_user_id') args[name] = w.userId
      else if (name === 'p_business_id') args[name] = w.businessId
      else if (type === 'uuid') args[name] = crypto.randomUUID()
      else if (type === 'uuid[]') args[name] = []
      else if (type === 'integer') args[name] = 1
      else if (type === 'text') args[name] = 'accepted'
      else if (type === 'jsonb') args[name] = {}
      else throw new Error(`no plausible argument for ${f.name}.${name} (${type})`)
    })
    return args
  }

  it('an authenticated member calling rpc() on any derived function is refused 42501 — even passing the owner id', async () => {
    expect(fns.length).toBe(functionNames.length)
    for (const f of fns) {
      const { error } = await member.rpc(f.name, argsFor(f))
      expect(error, `${f.name} was callable by an authenticated member`).not.toBeNull()
      expect(error?.code, `${f.name} refusal code`).toBe('42501')
    }
  })

  it('an anon client calling rpc() on any derived function is refused 42501', async () => {
    for (const f of fns) {
      const { error } = await anon.rpc(f.name, argsFor(f))
      expect(error, `${f.name} was callable by anon`).not.toBeNull()
      expect(error?.code, `${f.name} refusal code`).toBe('42501')
    }
  })
})
