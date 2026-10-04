import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// Session 36 / A-8 follow-up (20261004110000). The launch-checklist audit (S36-FRESH-DB-RPC-ACL-AUDIT) as a standing Tier-1 gate on a fresh database:
// the set of SECURITY DEFINER functions in `public` executable by anon or authenticated must equal the justified allow-list below, so a NEW function
// created with default grants fails CI here instead of waiting for someone to re-run the query by hand.
//
// To add a function to the allow-list you must justify it in the launch-checklist row and in 20261004110000's header, then add it here.

const ALLOW_LIST: Record<string, { anon: boolean; authenticated: boolean; why: string }> = {
  'public.accept_invite(uuid,uuid)': { anon: false, authenticated: true, why: "called with the signed-in invitee's client (lib/db/business-members.ts)" },
  'public.get_user_business_ids()': { anon: false, authenticated: true, why: 'every RLS policy calls it as authenticated' },
  'public.user_can(uuid,text)': { anon: true, authenticated: true, why: 'authenticated callers + RLS; the anon grant is deliberate (20260715200000) and returns false when auth.uid() IS NULL' },
}

describe('SECURITY DEFINER functions executable by anon or authenticated equal the justified allow-list (live Postgres)', () => {
  let pg: Client

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })

  afterAll(async () => {
    await pg?.end()
  })

  it('the audit query returns exactly the allow-list, with the expected anon/authenticated grants', async () => {
    const { rows } = await pg.query(
      `SELECT p.oid::regprocedure::text AS sig,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        ORDER BY 1`,
    )
    const actual = Object.fromEntries(rows.map((r) => [r.sig, { anon: r.anon, authenticated: r.authenticated }]))
    const expected = Object.fromEntries(Object.entries(ALLOW_LIST).map(([sig, v]) => [sig.replace(/^public\./, ''), { anon: v.anon, authenticated: v.authenticated }]))
    expect(actual).toEqual(expected)
  })

  it('the three trigger functions closed by 20261004110000 have no client EXECUTE', async () => {
    for (const sig of ['public.enforce_seat_cap()', 'public.enqueue_post_edit_signal()', 'public.ensure_owner_membership()']) {
      const { rows } = await pg.query(
        `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS authenticated`,
        [sig],
      )
      expect(rows[0], sig).toEqual({ anon: false, authenticated: false })
    }
  })
})
