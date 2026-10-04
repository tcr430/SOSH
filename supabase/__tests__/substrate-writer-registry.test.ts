import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { MEMORY_WRITERS, MEMORY_TABLES, SOURCES_BY_TABLE, WRITER_IDS } from '@/lib/memory/writers'

// ADR 0030 §2.1 (Session 36 L2.5) — SUBSTRATE-WRITER-REGISTERED (1) and SUBSTRATE-WRITER-CONTRACT (2), Tier 1, live Postgres.
//
// The TS registry (lib/memory/writers.ts) is the mirror the scans read; THIS file is the drift test that proves the mirror matches the
// database: the four `<table>_source_check` constraints, read BY NAME, exactly one each, with a value set equal to the registry's; and for
// EVERY registered RPC, SECURITY DEFINER with a pinned search_path and no EXECUTE for anon, authenticated or PUBLIC (has_function_privilege,
// so the owner's implicit grant cannot fail the test, R-11).

describe('the writer registry matches the database (ADR 0030 §2.1, §2.2 W1)', () => {
  let pg: Client

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
  })
  afterAll(async () => {
    await pg.end()
  })

  it.each(MEMORY_TABLES)("%s: EXACTLY ONE <table>_source_check, VALIDATED, and its value set equals the registry's", async (table) => {
    const { rows } = await pg.query<{ conname: string; def: string; convalidated: boolean }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`,
      [`public.${table}`, `${table}_source_check`],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].convalidated).toBe(true)
    const listed = [...rows[0].def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
    expect(listed).toEqual([...SOURCES_BY_TABLE[table]].sort())
  })

  it('no OTHER constraint on the four tables has the source-list shape (the by-definition lookup regex stays unambiguous)', async () => {
    for (const table of MEMORY_TABLES) {
      const { rows } = await pg.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '^CHECK \\(\\(source = ANY \\(ARRAY\\['`,
        [`public.${table}`],
      )
      expect(rows.map((r) => r.conname), table).toEqual([`${table}_source_check`])
    }
  })

  const RPCS = WRITER_IDS.flatMap((id) => MEMORY_WRITERS[id].rpcNames.map((rpc) => [id, rpc] as const))

  it('the registry lists the expected number of RPCs (a writer added without a drift row is a review finding)', () => {
    expect(RPCS.length).toBe(13)
  })

  it.each(RPCS)('%s writer: %s is SECURITY DEFINER, pins search_path, and is executable by service_role ONLY', async (_writer, rpc) => {
    const { rows } = await pg.query<{ prosecdef: boolean; proconfig: string[] | null; anon: boolean; auth: boolean; pub: boolean; svc: boolean }>(
      `SELECT p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`,
      [rpc],
    )
    expect(rows, `${rpc} must have exactly ONE definition`).toHaveLength(1)
    expect(rows[0].prosecdef, `${rpc} is not SECURITY DEFINER`).toBe(true)
    expect(rows[0].proconfig ?? [], `${rpc} does not pin its search_path`).toContain('search_path=public, pg_temp')
    expect(rows[0].anon, `anon can EXECUTE ${rpc}`).toBe(false)
    expect(rows[0].auth, `authenticated can EXECUTE ${rpc}`).toBe(false)
    expect(rows[0].pub, `PUBLIC can EXECUTE ${rpc}`).toBe(false)
    expect(rows[0].svc, `service_role cannot EXECUTE ${rpc}`).toBe(true)
  })

  it('every audience_memory `dismissal` value in the CHECK belongs to a REGISTERED writer, and the dismissal writer owns exactly the recompute RPC', () => {
    expect(WRITER_IDS).toContain('dismissal')
    expect([...MEMORY_WRITERS.dismissal.rpcNames]).toEqual(['recompute_dismissal_audience_signal'])
    expect([...MEMORY_WRITERS.dismissal.tables]).toEqual(['audience_memory'])
  })
})
