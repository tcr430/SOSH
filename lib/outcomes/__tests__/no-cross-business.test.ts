import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// OUTCOME-NO-CROSS-BUSINESS (ADR 0026 §12, constraint 30) — Tier 2 + Tier 3. No outcome read or write can cross a
// tenant boundary through the service-role path, which bypasses RLS.
//   Tier 2: every exported outcome wrapper takes a businessId and filters EVERY query it issues on it (asserted on
//           a recording client, not on the source text).
//   Tier 3: the outcome RPC SQL BODIES — not their signatures (the ADR 0025 §15.1 lesson) — carry a business_id
//           predicate on every table each body reads or updates. get_learning_cycles_northstar is the ONE
//           declared exception (below), allowlisted BY NAME with its reason.

// ─── Tier 2 ───────────────────────────────────────────────────────────────────

interface Chain { table: string; calls: Array<[string, ...unknown[]]> }
const chains: Chain[] = []
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
let rows: unknown = []

function makeChain(table: string): Record<string, unknown> {
  const chain: Chain = { table, calls: [] }
  chains.push(chain)
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'not', 'is', 'in', 'or', 'order', 'limit', 'upsert', 'insert', 'update']) {
    c[m] = (...args: unknown[]) => { chain.calls.push([m, ...args]); return c }
  }
  c.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? null : rows, error: null })
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej)
  return c
}

// ONE recording client. The service-role factory returns it (worker functions), and the page readers are HANDED it
// (MAJOR-1: they take the caller's client first) — so every query either path issues is recorded the same way.
const recordingClient = {
  from: (table: string) => makeChain(table),
  rpc: (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return Promise.resolve({ data: null, error: null }) },
} as never
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => recordingClient }))

import * as postOutcomes from '@/lib/db/post-outcomes'
import * as retros from '@/lib/db/campaign-retrospectives'
import * as memory from '@/lib/db/memory-performance'

const BIZ = 'biz-under-test'

beforeEach(() => {
  chains.length = 0
  rpcs.length = 0
  rows = []
})

// Each entry: a call that supplies BIZ as the business. Every chain it opens must filter on it; every RPC must pass it.
const CALLS: Array<[string, () => Promise<unknown>, { rpc?: string }]> = [
  ['post-outcomes.listMaturedOutcomesForBaseline', () => postOutcomes.listMaturedOutcomesForBaseline(BIZ, 'twitter', { before: '2026-09-01T00:00:00Z' }), {}],
  ['post-outcomes.listPostsDueForOutcome', () => { rows = [{ id: 'p', published_at: '2026-09-01T00:00:00Z', post_metrics: null }]; return postOutcomes.listPostsDueForOutcome(BIZ, { now: '2026-09-19T00:00:00Z' }) }, {}],
  ['post-outcomes.listLatestSnapshotsForPosts', () => postOutcomes.listLatestSnapshotsForPosts(BIZ, ['p1']), {}],
  ['post-outcomes.listPostDimensionsBySnapshot', () => postOutcomes.listPostDimensionsBySnapshot(BIZ, ['s1']), {}],
  ['post-outcomes.getEngagementSeed', () => postOutcomes.getEngagementSeed(BIZ, 'twitter'), {}],
  ['campaign-retrospectives.getCampaignRetrospective', () => retros.getCampaignRetrospective(recordingClient, BIZ, 'c1'), {}],
  ['campaign-retrospectives.listCampaignRetrospectives', () => retros.listCampaignRetrospectives(BIZ), {}],
  ['campaign-retrospectives.listCampaignsAwaitingRetrospective', () => { rows = [{ id: 'c1', name: 'n' }]; return retros.listCampaignsAwaitingRetrospective(BIZ) }, {}],
  ['campaign-retrospectives.listCampaignPostStates', () => retros.listCampaignPostStates(recordingClient, BIZ, 'c1'), {}],
  ['campaign-retrospectives.listOutcomesForCampaign', () => retros.listOutcomesForCampaign(BIZ, 'c1'), {}],
  ['campaign-retrospectives.getFrozenBriefContent', () => retros.getFrozenBriefContent(recordingClient, BIZ, 'c1'), {}],
  ['campaign-retrospectives.listCampaignOutcomeCellSources', () => { rows = [{ platform: 'twitter', length_band: null, cta_present: null, ai_original_id: 'a1' }]; return retros.listCampaignOutcomeCellSources(recordingClient, BIZ, 'c1') }, {}],
  ['campaign-retrospectives.acknowledgeRetrospective', () => retros.acknowledgeRetrospective({ businessId: BIZ, campaignId: 'c1', userId: 'u1', patternText: null }), { rpc: 'acknowledge_campaign_retrospective' }],
  ['campaign-retrospectives.listCampaignPostStatesForWorker', () => retros.listCampaignPostStatesForWorker(BIZ, 'c1'), {}],
  ['campaign-retrospectives.getFrozenBriefContentForWorker', () => retros.getFrozenBriefContentForWorker(BIZ, 'c1'), {}],
  ['memory-performance.listOutcomePatterns', () => memory.listOutcomePatterns(recordingClient, BIZ), {}],
  ['memory-performance.listOutcomePatternsForGeneration', () => memory.listOutcomePatternsForGeneration(BIZ), {}],
  ['memory-performance.upsertOutcomePattern', () => memory.upsertOutcomePattern({ business_id: BIZ, dimension: 'role', value: 'customer_proof', platform: 'linkedin', direction: 'above', pattern: 'p' }), { rpc: 'upsert_outcome_performance_pattern' }],
  ['memory-performance.promoteOutcomePattern', () => memory.promoteOutcomePattern(BIZ, 'k'), { rpc: 'promote_outcome_pattern' }],
  ['memory-performance.demoteOutcomePattern', () => memory.demoteOutcomePattern(BIZ, 'k'), { rpc: 'demote_outcome_pattern' }],
]

// Exported functions that legitimately take no businessId, with the reason. Anything else exported from these
// modules that is not in CALLS above fails the completeness check below.
const NOT_BUSINESS_PARAMETERISED: Record<string, string> = {
  'post-outcomes.insertPostOutcome': 'takes a full row whose business_id column is set by the worker (a write, not a read)',
  'campaign-retrospectives.insertCampaignRetrospective': 'takes a full row whose business_id column is set by the worker (a write, not a read)',
  'campaign-retrospectives.getLearningCyclesNorthstar': 'THE declared exception: an ops aggregate across brands, service-role only, counts only',
  'campaign-retrospectives.wilsonBounds': 'pure arithmetic over two numbers; reads no table',
}

describe('Tier 2 — every outcome wrapper filters every query it issues on the business', () => {
  it.each(CALLS)('%s', async (_name, call, expectation) => {
    await call()
    expect(chains.length + rpcs.length).toBeGreaterThan(0)
    for (const chain of chains) {
      const filtered = chain.calls.some(([m, col, val]) => m === 'eq' && col === 'business_id' && val === BIZ)
      expect(filtered, `${chain.table} query has no .eq('business_id', ...)`).toBe(true)
    }
    for (const rpc of rpcs) expect(rpc.args.p_business_id, `${rpc.fn} did not pass p_business_id`).toBe(BIZ)
    if (expectation.rpc) expect(rpcs.map((r) => r.fn)).toContain(expectation.rpc)
  })

  it('COMPLETENESS: every exported function of the modules is either exercised above or explained', () => {
    const exercised = new Set(CALLS.map(([name]) => name))
    const modules: Array<[string, Record<string, unknown>]> = [
      ['post-outcomes', postOutcomes], ['campaign-retrospectives', retros],
    ]
    const missing: string[] = []
    for (const [mod, exports] of modules) {
      for (const [name, value] of Object.entries(exports)) {
        if (typeof value !== 'function') continue
        const key = `${mod}.${name}`
        if (!exercised.has(key) && !(key in NOT_BUSINESS_PARAMETERISED)) missing.push(key)
      }
    }
    // the outcome functions of memory-performance are the ones named *Outcome*
    for (const name of Object.keys(memory).filter((n) => /Outcome/.test(n))) {
      if (!exercised.has(`memory-performance.${name}`)) missing.push(`memory-performance.${name}`)
    }
    expect(missing).toEqual([])
  })

  it('the declared exceptions are exactly the four named, each with a reason', () => {
    expect(Object.keys(NOT_BUSINESS_PARAMETERISED).sort()).toEqual([
      'campaign-retrospectives.getLearningCyclesNorthstar',
      'campaign-retrospectives.insertCampaignRetrospective',
      'campaign-retrospectives.wilsonBounds',
      'post-outcomes.insertPostOutcome',
    ])
    for (const reason of Object.values(NOT_BUSINESS_PARAMETERISED)) expect(reason.length).toBeGreaterThan(10)
  })
})

// ─── Tier 3 ───────────────────────────────────────────────────────────────────

const ROOT = process.cwd()
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')

// get_learning_cycles_northstar is the ONE declared exception (ADR 0026 §8.5, constraint 30): an OPS AGGREGATE
// across brands BY DESIGN — it returns counts only, no row or text, is REVOKEd from every client role and GRANTed
// to service_role only, and is called only by scripts/northstar-report.ts.
const SQL_EXCEPTIONS: Record<string, string> = {
  get_learning_cycles_northstar: 'ops aggregate across brands by design; counts only; service_role only (ADR 0026 s8.5)',
}

// The outcome RPCs whose BODIES are scanned. wilson_bounds reads no table (pure arithmetic) and is scanned to prove it.
const SCANNED = [
  'wilson_bounds', 'outcome_cell_stats', 'upsert_outcome_performance_pattern', 'promote_outcome_pattern',
  'demote_outcome_pattern', 'acknowledge_campaign_retrospective', 'get_learning_cycles_northstar',
]

function stripSqlComments(sql: string): string {
  return sql.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
}

// The LATEST definition of each function across all migrations (CREATE OR REPLACE later wins), body only.
function latestFunctionBodies(dir: string): Map<string, string> {
  const bodies = new Map<string, string>()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi)) {
      bodies.set(m[1], m[3])
    }
  }
  return bodies
}

const KEYWORDS = new Set(['on', 'where', 'left', 'right', 'inner', 'cross', 'join', 'lateral', 'set', 'group', 'order', 'limit', 'returning', 'using', 'and', 'or', 'as', 'select', 'from', 'values', 'for'])

// Tables a body reads or updates (FROM / JOIN / UPDATE public.<table>; a name followed by "(" is a function call),
// each with the alias it is referred to by.
function readTables(body: string): Array<{ table: string; ref: string }> {
  const out: Array<{ table: string; ref: string }> = []
  for (const m of body.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+public\.(\w+)(?!\w|\s*\()(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const alias = m[2] && !KEYWORDS.has(m[2].toLowerCase()) ? m[2] : m[1]
    out.push({ table: m[1], ref: alias })
  }
  return out
}

// Every table reference must be tied to the business: `<ref>.business_id = p_business_id` (or to another already-
// scoped reference), or, for an un-aliased table, `business_id = p_business_id`.
function unscopedTables(body: string): string[] {
  return readTables(body)
    .filter(({ table, ref }) => {
      const qualified = new RegExp(`\\b${ref}\\.business_id\\s*=\\s*(?:p_business_id|\\w+\\.business_id)`, 'i')
      const bare = /(?<![.\w])business_id\s*=\s*p_business_id/i
      return !(qualified.test(body) || (ref === table && bare.test(body)))
    })
    .map(({ table }) => table)
}

describe('Tier 3 — the outcome RPC SQL bodies carry a business_id predicate on every table they read', () => {
  it('the detector flags a body whose subquery drops the predicate (planted)', () => {
    const scoped = `SELECT 1 FROM public.post_outcomes AS o WHERE o.business_id = p_business_id AND o.x = 1;`
    const unscoped = `SELECT 1 FROM public.post_outcomes AS o WHERE o.business_id = p_business_id AND EXISTS (SELECT 1 FROM public.post_dimensions AS d WHERE d.ai_original_id = o.ai_original_id);`
    expect(unscopedTables(scoped)).toEqual([])
    expect(unscopedTables(unscoped)).toEqual(['post_dimensions'])
    expect(unscopedTables(`UPDATE public.performance_memory AS pm SET status = 'active' WHERE pm.id = 1;`)).toEqual(['performance_memory'])
  })

  it('the detector does not mistake a function call for a table, and accepts an un-aliased scoped table', () => {
    expect(readTables(`SELECT * FROM public.wilson_bounds(1, 2, 1.96) AS b`)).toEqual([])
    expect(unscopedTables(`SELECT 1 FROM public.business_members WHERE business_id = p_business_id AND user_id = p_user_id`)).toEqual([])
  })

  const bodies = latestFunctionBodies(MIGRATIONS)

  it('finds every scanned function in the migrations (so the scan cannot pass vacuously)', () => {
    for (const fn of SCANNED) expect(bodies.has(fn), `${fn} not found`).toBe(true)
  })

  it.each(SCANNED.filter((fn) => !(fn in SQL_EXCEPTIONS)))('%s: every table it reads or updates is scoped by business_id', (fn) => {
    expect(unscopedTables(bodies.get(fn) as string)).toEqual([])
  })

  it('wilson_bounds reads no table at all', () => {
    expect(readTables(bodies.get('wilson_bounds') as string)).toEqual([])
  })

  it('the exception is exactly one function, allowlisted by name WITH its reason, and it really does read across brands', () => {
    expect(Object.keys(SQL_EXCEPTIONS)).toEqual(['get_learning_cycles_northstar'])
    expect(SQL_EXCEPTIONS.get_learning_cycles_northstar.length).toBeGreaterThan(20)
    expect(unscopedTables(bodies.get('get_learning_cycles_northstar') as string).length).toBeGreaterThan(0)
  })
})
