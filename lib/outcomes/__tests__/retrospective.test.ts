import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addDays, formatISO } from 'date-fns'

// ADR 0026 §8.2 (J2.11) — the retrospective's deterministic verdict, due-date and once-only evaluation.
// OUTCOME-RETROSPECTIVE-WRITES-BACK (25): nothing here writes to memory; a completed retrospective is a row.

const store = vi.hoisted(() => ({
  campaigns: [] as Array<{ id: string; name: string }>,
  posts: {} as Record<string, Array<{ id: string; status: string; published_at: string | null; role: string | null }>>,
  outcomes: {} as Record<string, Array<{ post_id: string; beat_baseline: boolean | null; log_lift: number | null; metric_basis: 'rate' | 'count' }>>,
  brief: {} as Record<string, Record<string, unknown> | null>,
  retros: [] as Array<Record<string, unknown>>,
  inserts: 0,
}))

vi.mock('@/lib/db/campaign-retrospectives', () => ({
  listCampaignsAwaitingRetrospective: async () => store.campaigns.filter((c) => !store.retros.some((r) => r.campaign_id === c.id)),
  listCampaignPostStatesForWorker: async (_b: string, id: string) => store.posts[id] ?? [],
  listOutcomesForCampaign: async (_b: string, id: string) => store.outcomes[id] ?? [],
  getFrozenBriefContentForWorker: async (_b: string, id: string) => store.brief[id] ?? null,
  wilsonBounds: async () => ({ low: 0.5, high: 0.9 }),
  insertCampaignRetrospective: async (row: Record<string, unknown>) => {
    store.inserts += 1
    if (store.retros.some((r) => r.campaign_id === row.campaign_id)) return false
    store.retros.push(row)
    return true
  },
}))

import { computeVerdict, isDue, resolveHypothesis, retrospectiveDueAt, runRetrospectivePhase, IMPLICIT_HYPOTHESIS } from '../retrospective'
import type { SuccessCriteria } from '../hypothesis'

const win = (target: number): SuccessCriteria => ({ metric: 'win_rate', target, evaluationWindowDays: 14 })
const lift = (target: number): SuccessCriteria => ({ metric: 'median_lift', target, evaluationWindowDays: 14 })
const obs = (n: number, wins: number, logLift: number | null = null) =>
  Array.from({ length: n }, (_, i) => ({ post_id: `p${i}`, beat_baseline: i < wins, log_lift: logLift, metric_basis: 'rate' as const }))
const noRoles = new Map<string, string | null>()

describe('computeVerdict — win_rate', () => {
  it.each([
    [10, 9, 0.9, 'supported'],       // the exact boundary: wins / n == target
    [10, 9, 0.91, 'not_supported'],
    [5, 3, 0.6, 'supported'],        // 3/5 == 0.6 (a decimal target)
    [5, 2, 0.6, 'not_supported'],
    [11, 6, 0.5, 'supported'],
    [4, 4, 0.5, 'inconclusive'],     // n = 4: never a verdict, however good
    [0, 0, 0.5, 'inconclusive'],
  ])('n=%i wins=%i target=%f -> %s', (n, wins, target, verdict) => {
    expect(computeVerdict(win(target), obs(n, wins), noRoles).verdict).toBe(verdict)
  })
})

describe('computeVerdict — median_lift', () => {
  it.each([
    [Math.log(1.5), 1.5, 'supported'],   // exp(median) == target
    [Math.log(1.6), 1.5, 'supported'],
    [Math.log(1.4), 1.5, 'not_supported'],
    [Math.log(1.0), 1.0, 'supported'],
  ])('median log lift %f target %f -> %s', (logLift, target, verdict) => {
    expect(computeVerdict(lift(target), obs(6, 3, logLift), noRoles).verdict).toBe(verdict)
  })

  it('no usable log_lift at all -> inconclusive, never a guess', () => {
    expect(computeVerdict(lift(1.5), obs(6, 3, null), noRoles).verdict).toBe('inconclusive')
  })
})

describe('computeVerdict — what counts', () => {
  it('only outcomes WITH a baseline are observations (beat_baseline null is excluded from n)', () => {
    const rows = [...obs(5, 4), { post_id: 'nb', beat_baseline: null, log_lift: null, metric_basis: 'rate' as const }]
    expect(computeVerdict(win(0.5), rows, noRoles)).toMatchObject({ n: 5, wins: 4, verdict: 'supported' })
  })

  it('by_role is per-role n and wins', () => {
    const roles = new Map<string, string | null>([['p0', 'anchor_thesis'], ['p1', 'anchor_thesis'], ['p2', 'customer_proof'], ['p3', 'customer_proof'], ['p4', null]])
    expect(computeVerdict(win(0.5), obs(5, 3), roles).byRole).toEqual({
      anchor_thesis: { n: 2, wins: 2 }, customer_proof: { n: 2, wins: 1 }, unassigned: { n: 1, wins: 0 },
    })
  })
})

describe('the implicit hypothesis', () => {
  it('a pre-amendment brief (or none) uses win_rate 0.5 / 7 days and is LABELLED implicit', () => {
    for (const brief of [null, { narrative: 'x' }]) {
      const r = resolveHypothesis(brief)
      expect(r).toEqual(IMPLICIT_HYPOTHESIS)
      expect(r).toMatchObject({ source: 'implicit', criteria: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 } })
    }
  })

  it('a valid brief hypothesis is used and labelled brief; an out-of-range one falls back to implicit', () => {
    const good = { hypothesis: 'Threads win', successCriteria: { metric: 'median_lift', target: 1.5, evaluationWindowDays: 30 } }
    expect(resolveHypothesis(good)).toEqual({ hypothesis: 'Threads win', criteria: good.successCriteria, source: 'brief' })
    expect(resolveHypothesis({ ...good, successCriteria: { ...good.successCriteria, target: 9 } }).source).toBe('implicit')
  })
})

describe('isDue', () => {
  const published = (at: string) => ({ id: at, status: 'published', published_at: at, role: null })
  const criteria = win(0.5) // window 14 -> due at last published + max(7, 14) = 14 days

  it('due exactly at last published_at + max(7, window); false one day before', () => {
    const last = new Date('2026-09-01T12:00:00Z')
    const posts = [published(formatISO(addDays(last, -3))), published(formatISO(last))]
    expect(retrospectiveDueAt(posts, criteria)?.toISOString()).toBe(addDays(last, 14).toISOString())
    expect(isDue(posts, criteria, addDays(last, 14))).toBe(true)
    expect(isDue(posts, criteria, addDays(last, 13))).toBe(false)
  })

  it('the 7-day floor applies when the window is shorter', () => {
    const last = new Date('2026-09-01T12:00:00Z')
    expect(isDue([published(formatISO(last))], { ...criteria, evaluationWindowDays: 7 }, addDays(last, 7))).toBe(true)
  })

  it.each(['draft', 'approved', 'scheduled'])('false while ANY post is still %s', (status) => {
    const last = new Date('2026-09-01T12:00:00Z')
    const posts = [published(formatISO(last)), { id: 'x', status, published_at: null, role: null }]
    expect(isDue(posts, criteria, addDays(last, 90))).toBe(false)
  })

  it('failed / skipped posts are terminal and do not hold it back; no published post is never due', () => {
    const last = new Date('2026-09-01T12:00:00Z')
    const posts = [published(formatISO(last)), { id: 'f', status: 'failed', published_at: null, role: null }]
    expect(isDue(posts, criteria, addDays(last, 14))).toBe(true)
    expect(isDue([{ id: 'f', status: 'failed', published_at: null, role: null }], criteria, addDays(last, 90))).toBe(false)
  })
})

describe('runRetrospectivePhase — evaluated ONCE', () => {
  const NOW = new Date('2026-09-30T00:00:00Z')
  beforeEach(() => {
    store.campaigns = [{ id: 'c1', name: 'Q3' }]
    store.posts = { c1: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, status: 'published', published_at: '2026-09-01T00:00:00Z', role: 'anchor_thesis' })) }
    store.outcomes = { c1: obs(6, 5) }
    store.brief = {}
    store.retros = []
    store.inserts = 0
  })

  it('writes a completed retrospective for a due campaign, with the implicit label and the SQL interval', async () => {
    expect(await runRetrospectivePhase('b1', NOW)).toEqual({ completed: 1, errors: 0 })
    expect(store.retros[0]).toMatchObject({ campaign_id: 'c1', verdict: 'supported', n: 6, wins: 5, hypothesis_source: 'implicit', interval_low: 0.5, interval_high: 0.9 })
  })

  it('a SECOND tick does not re-evaluate an evaluated campaign', async () => {
    await runRetrospectivePhase('b1', NOW)
    const inserts = store.inserts
    expect(await runRetrospectivePhase('b1', NOW)).toEqual({ completed: 0, errors: 0 })
    expect(store.inserts).toBe(inserts)
    expect(store.retros).toHaveLength(1)
  })

  it('a campaign that is not yet due writes nothing', async () => {
    expect(await runRetrospectivePhase('b1', new Date('2026-09-03T00:00:00Z'))).toEqual({ completed: 0, errors: 0 })
    expect(store.retros).toHaveLength(0)
  })

  it('a due campaign with too few outcomes is recorded as inconclusive (never dropped, never a verdict)', async () => {
    store.outcomes = { c1: obs(4, 4) }
    await runRetrospectivePhase('b1', NOW)
    expect(store.retros[0]).toMatchObject({ verdict: 'inconclusive', n: 4 })
  })
})
