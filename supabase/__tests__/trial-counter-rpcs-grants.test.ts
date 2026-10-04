import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { createWorld, destroyWorld, type World } from '../__helpers__/outcome-fixtures'

// Session 36-D MAJOR-2 follow-up (20260930120000). increment_brand_voice_attempts and increment_posts_generated are SECURITY DEFINER and take a
// caller-supplied p_business_id; with no ACL they were executable by anon and authenticated (any user could bump another business's trial counters).
// This is Tier 1 on a live Postgres: the privilege matrix, the refusal over PostgREST for a member and for anon (even for the member's OWN business, so
// the refusal can only come from the EXECUTE grant), and a service-role positive control proving the counters still move.
//
// The function list is DERIVED from the migration (never hand-written), the plan-proposals-rpc-grants.test.ts shape.

const MIGRATION = '20260930120000_trial_counter_rpcs_revoke_client_roles.sql'

function deriveFunctionNames(): string[] {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', MIGRATION), 'utf8')
  return [...new Set([...sql.matchAll(/^REVOKE ALL ON FUNCTION public\.(\w+)\(uuid\)/gm)].map((m) => m[1]))].sort()
}

describe('trial-counter SECURITY DEFINER RPCs are executable by service_role only (live Postgres)', () => {
  const names = deriveFunctionNames()
  let w: World
  let pg: Client
  let member: SupabaseClient
  let anon: SupabaseClient

  beforeAll(async () => {
    w = await createWorld('trial-counter-grants')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await member.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
    if (error) throw error
    anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
  })

  afterAll(async () => {
    await destroyWorld(w)
    await pg?.end()
  })

  it('the derived set is exactly the two trial-counter RPCs, and both exist in the live database', async () => {
    expect(names).toEqual(['increment_brand_voice_attempts', 'increment_posts_generated'])
    const { rows } = await pg.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`, [names])
    expect(rows.map((r) => r.proname).sort()).toEqual(names)
  })

  it('PUBLIC, anon and authenticated hold no EXECUTE on either function; service_role does (the ACL is explicit, not NULL)', async () => {
    for (const name of names) {
      const { rows } = await pg.query(
        `SELECT p.proacl IS NOT NULL AS has_acl,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
                EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`,
        [name],
      )
      expect(rows[0], name).toEqual({ has_acl: true, anon: false, authenticated: false, service_role: true, public_exec: false })
    }
  })

  it.each(['increment_brand_voice_attempts', 'increment_posts_generated'] as const)(
    "%s: a signed-in member and an anonymous caller are refused over PostgREST, even for the member's OWN business",
    async (name) => {
      for (const [who, client] of [['member', member], ['anon', anon]] as const) {
        const { error } = await client.rpc(name, { p_business_id: w.businessId })
        expect(error, `${who} calling ${name}`).not.toBeNull()
        expect(error?.code, `${who} calling ${name}`).toBe('42501')
      }
      // and nothing moved
      const { rows } = await pg.query('SELECT posts_generated_count, brand_voice_inference_attempts FROM public.trial_state WHERE business_id = $1', [w.businessId])
      expect(rows[0]).toEqual({ posts_generated_count: 0, brand_voice_inference_attempts: 0 })
    },
  )

  it('positive control: the service role still moves both counters by exactly one', async () => {
    const before = (await pg.query('SELECT posts_generated_count AS p, brand_voice_inference_attempts AS b FROM public.trial_state WHERE business_id = $1', [w.businessId])).rows[0]
    const r1 = await w.admin.rpc('increment_posts_generated', { p_business_id: w.businessId })
    const r2 = await w.admin.rpc('increment_brand_voice_attempts', { p_business_id: w.businessId })
    expect(r1.error, JSON.stringify(r1.error)).toBeNull()
    expect(r2.error, JSON.stringify(r2.error)).toBeNull()
    const after = (await pg.query('SELECT posts_generated_count AS p, brand_voice_inference_attempts AS b FROM public.trial_state WHERE business_id = $1', [w.businessId])).rows[0]
    expect(after.p).toBe(before.p + 1)
    expect(after.b).toBe(before.b + 1)
  })
})
