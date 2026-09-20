import { describe, it, expect, vi, beforeEach } from 'vitest'

// NIT-3 (Session 33-D D6): getEngagementSeed reads the newest run whose extraction FINISHED, never merely the newest
// run. Unlike post-outcomes.test.ts (a recording mock), this fake really APPLIES eq / in / order / limit to an
// in-memory social_backfill_runs table, so a predicate that is missing changes the RESULT, not just a recorded call.

type Run = { business_id: string; platform: string; status: string; created_at: string; summary: Record<string, unknown> }
const table = vi.hoisted(() => ({ runs: [] as Run[] }))

function fakeQuery(rows: Run[]) {
  let result = [...rows]
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = (col: keyof Run, val: unknown) => { result = result.filter((r) => r[col] === val); return q }
  q.in = (col: keyof Run, vals: unknown[]) => { result = result.filter((r) => vals.includes(r[col])); return q }
  q.order = (col: keyof Run, o: { ascending: boolean }) => {
    result.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (o.ascending ? 1 : -1))
    return q
  }
  q.limit = (n: number) => { result = result.slice(0, n); return q }
  q.maybeSingle = () => Promise.resolve({ data: result[0] ?? null, error: null })
  return q
}
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: () => fakeQuery(table.runs) }) }))

import { getEngagementSeed, SEED_RUN_STATUSES } from './post-outcomes'

const run = (over: Partial<Run> & { engagementBaseline?: number; basis?: string }): Run => ({
  business_id: 'biz', platform: 'twitter', status: 'awaiting_ratification', created_at: '2026-09-01T00:00:00Z',
  summary: { engagementBaseline: over.engagementBaseline ?? 0.02, engagementBaselineBasis: over.basis ?? 'impressions' },
  ...over,
})

beforeEach(() => { table.runs = [] })

describe('getEngagementSeed — only a run whose extraction finished can seed a baseline', () => {
  it('a NEWER non-terminal run carrying an engagementBaseline is IGNORED in favour of the older finished run', async () => {
    table.runs = [
      run({ status: 'ratified', created_at: '2026-08-01T00:00:00Z', engagementBaseline: 0.02 }),
      run({ status: 'failed', created_at: '2026-09-10T00:00:00Z', engagementBaseline: 0.99 }),
    ]
    expect(await getEngagementSeed('biz', 'twitter')).toEqual({ value: 0.02, basis: 'rate' })
  })

  it.each(['queued', 'fetching', 'extracting', 'failed', 'discarded', 'unsupported'])(
    'a business whose ONLY run is %s gets NO seed (the post is then unseeded, not mis-seeded)',
    async (status) => {
      table.runs = [run({ status, engagementBaseline: 0.5 })]
      expect(await getEngagementSeed('biz', 'twitter')).toBeNull()
    },
  )

  it.each(['awaiting_ratification', 'ratified'])('a %s run seeds the baseline, and the newest finished run wins', async (status) => {
    table.runs = [
      run({ status: 'ratified', created_at: '2026-08-01T00:00:00Z', engagementBaseline: 0.01 }),
      run({ status, created_at: '2026-09-01T00:00:00Z', engagementBaseline: 0.04 }),
    ]
    expect(await getEngagementSeed('biz', 'twitter')).toEqual({ value: 0.04, basis: 'rate' })
  })

  it('the finished set is exactly the two states ADR 0025 defines as a completed extraction', () => {
    expect([...SEED_RUN_STATUSES]).toEqual(['awaiting_ratification', 'ratified'])
  })

  it('business and platform scoping and the basis mapping are unchanged (raw -> count, unknown -> null)', async () => {
    table.runs = [
      run({ business_id: 'other', status: 'ratified', engagementBaseline: 0.9 }),
      run({ platform: 'linkedin', status: 'ratified', engagementBaseline: 0.8 }),
      run({ status: 'ratified', basis: 'raw', engagementBaseline: 30 }),
    ]
    expect(await getEngagementSeed('biz', 'twitter')).toEqual({ value: 30, basis: 'count' })
    table.runs = [run({ status: 'ratified', basis: 'none', engagementBaseline: 0 })]
    expect(await getEngagementSeed('biz', 'twitter')).toBeNull()
  })
})
