import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { addDays, formatISO } from 'date-fns'

// ADR 0026 §7 / J2.8 — the extract-outcomes tick over an in-memory fake of the lib/db layer.
// OUTCOME-DESCRIPTIVE-ONLY (7), MATURED-SNAPSHOT (9), CONTRADICTION-DEMOTES-ATOMIC (21, the call half),
// WINDOWED-DECAY (22, the eligibility half), PROVENANCE-PROPAGATED (23, the row the wrapper writes),
// TICK-IDEMPOTENT (32).

interface FakePost {
  id: string; business_id: string; campaign_id: string; platform: 'twitter' | 'linkedin'
  content: string; published_at: string; due: 'ready' | 'no_metrics'
  metrics: Record<string, number | null> | null
}

const db = vi.hoisted(() => ({
  businesses: [] as string[],
  posts: [] as unknown[],
  outcomes: new Map<string, Record<string, unknown>>(),
  snapshots: [] as Array<{ id: string; post_id: string; rendered_content: string; format: 'single' | 'thread' }>,
  dims: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  promotes: [] as string[],
  demotes: [] as string[],
  failDueFor: null as string | null,
  batch: 200,
}))

vi.mock('@sentry/nextjs', () => ({ withMonitor: (_s: string, fn: () => Promise<void>) => fn(), captureException: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { server: { get OUTCOME_BATCH_SIZE() { return db.batch } } } }))
vi.mock('@/lib/db/businesses', () => ({
  listBusinessIdsPage: async (after: string | null, limit: number) =>
    db.businesses.filter((b) => after === null || b > after).sort().slice(0, limit),
}))
vi.mock('@/lib/db/post-outcomes', () => ({
  listPostsDueForOutcome: async (businessId: string, opts: { limit: number }) => {
    if (db.failDueFor === businessId) throw new Error('boom')
    return (db.posts as FakePost[])
      .filter((p) => p.business_id === businessId && !db.outcomes.has(p.id))
      .slice(0, opts.limit)
      .map((p) => ({ post: p, metrics: p.metrics, due: p.due }))
  },
  listLatestSnapshotsForPosts: async (_b: string, ids: string[]) => db.snapshots.filter((s) => ids.includes(s.post_id)),
  listPostDimensionsBySnapshot: async (_b: string, ids: string[]) => db.dims.filter((d) => ids.includes(d.ai_original_id as string)),
  getEngagementSeed: async () => null,
  listMaturedOutcomesForBaseline: async (businessId: string, platform: string, o: { before: string }) =>
    [...db.outcomes.values()].filter((r) => r.business_id === businessId && r.platform === platform && (r.published_at as string) < o.before),
  insertPostOutcome: async (row: Record<string, unknown>) => {
    if (db.outcomes.has(row.post_id as string)) return false
    db.outcomes.set(row.post_id as string, row)
    return true
  },
}))
vi.mock('@/lib/db/memory-performance', () => ({
  upsertOutcomePattern: async (input: Record<string, unknown>) => {
    db.upserts.push(input)
    if (input.direction !== 'above') return null
    if (input.dimension === 'role') return { pattern_key: `outcome:role:${input.value}:above:${input.platform}`, status: 'candidate' }
    if (input.dimension === 'format') return { pattern_key: `outcome:format:${input.value}:above:${input.platform}`, status: 'active' }
    return null
  },
  promoteOutcomePattern: async (_b: string, key: string) => { db.promotes.push(key); return { status: 'active' } },
  demoteOutcomePattern: async (_b: string, key: string) => { db.demotes.push(key); return { status: 'candidate' } },
}))

import { runOutcomeTick } from '../orchestrator'
import { isEligible } from '@/lib/memory/scoring'

const NOW = new Date('2026-09-19T04:00:00Z')
const iso = (d: Date) => formatISO(d)

function seedPriors(business: string, platform: 'twitter' | 'linkedin', n: number, value: number) {
  for (let i = 0; i < n; i += 1) {
    db.outcomes.set(`prior-${business}-${platform}-${i}`, {
      post_id: `prior-${business}-${platform}-${i}`, business_id: business, platform,
      published_at: iso(addDays(new Date('2026-07-01T10:00:00Z'), i)), value, metric_basis: platform === 'twitter' ? 'rate' : 'count',
    })
  }
}

const post = (over: Partial<FakePost> & { id: string }): FakePost => ({
  business_id: 'b1', campaign_id: 'c1', platform: 'twitter', content: 'A plain observation about onboarding.',
  published_at: '2026-08-10T10:00:00Z', due: 'ready',
  metrics: { likes: 8, comments: 4, shares: 4, impressions: 100 }, ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.businesses = ['b1']
  db.posts = []
  db.outcomes = new Map()
  db.snapshots = []
  db.dims = []
  db.upserts = []
  db.promotes = []
  db.demotes = []
  db.failDueFor = null
  db.batch = 200
})
afterEach(() => vi.useRealTimers())

function seedMix() {
  seedPriors('b1', 'twitter', 8, 0.05)
  db.posts = [
    post({ id: 'p-win' }), // rate 0.16 > 0.05 -> a win
    post({ id: 'p-bad', metrics: { likes: 8, comments: 4, shares: null, impressions: 100 } }), // ineligible field
    post({ id: 'p-li', platform: 'linkedin', metrics: { likes: 9, comments: 3, shares: 3, impressions: null } }), // no baseline
    post({ id: 'p-stale', due: 'no_metrics', metrics: null }), // day-7 sync never arrived
  ]
  db.snapshots = [{ id: 'snap-win', post_id: 'p-win', rendered_content: 'A plain observation about onboarding.', format: 'thread' }]
  db.dims = [{ ai_original_id: 'snap-win', role: 'customer_proof', format: 'thread', origin_mode: 'objective_generated', hook_type: 'question', proof_type: 'quote' }]
}

describe('runOutcomeTick counters', () => {
  it('counts a seeded mix exactly', async () => {
    seedMix()
    const s = await runOutcomeTick({ triggeredBy: 'secret' })
    expect(s).toMatchObject({
      triggeredBy: 'secret', candidates: 4, matured: 3, outcomesWritten: 2,
      skippedNoMetrics: 1, skippedNoBaseline: 1, skippedIneligibleField: 1, errors: 0, retrospectivesCompleted: 0,
    })
    // p-win: role, format, origin_mode, length_band, cta = 5 cells x 2 directions.
    expect(s.cellsRecomputed).toBe(10)
    expect(s.candidatesUpserted).toBe(2)
    expect(s.promoted).toBe(1)
    expect(s.demoted).toBe(1)
    expect(s.tick).toBe(iso(NOW))
  })

  it('a post past maturity + grace with no day-7 sync writes NO outcome (MATURED-SNAPSHOT: never zeroed)', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    expect(db.outcomes.has('p-stale')).toBe(false)
    expect(db.outcomes.has('p-bad')).toBe(false) // an ineligible field is excluded, not zeroed
  })

  it('a no-baseline post is RECORDED with baseline / log_lift / beat_baseline all null, and touches no cell', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    expect(db.outcomes.get('p-li')).toMatchObject({ baseline: null, log_lift: null, beat_baseline: null, metric_basis: 'count', value: 15 })
    expect(db.upserts.some((u) => u.platform === 'linkedin')).toBe(false)
  })

  it('freezes the latest snapshot id and the measured dimensions on the row', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    expect(db.outcomes.get('p-win')).toMatchObject({ ai_original_id: 'snap-win', beat_baseline: true, cta_present: false, length_band: 'short', hook_survived: true })
    expect(db.outcomes.get('p-li')).toMatchObject({ ai_original_id: null, hook_survived: null }) // human-written
  })
})

describe('OUTCOME-DESCRIPTIVE-ONLY — hook_type / proof_type never reach the wrapper', () => {
  it('only the five promotable dimensions are ever upserted, with closed-template sentences', async () => {
    seedMix()
    const s = await runOutcomeTick({ triggeredBy: 'secret' })
    // A hook_type cell would be refused by the closed template and swallowed as an error — so errors is part of the proof.
    expect(s.errors).toBe(0)
    const dimensions = new Set(db.upserts.map((u) => u.dimension))
    expect(dimensions).toEqual(new Set(['role', 'format', 'origin_mode', 'length_band', 'cta']))
    for (const u of db.upserts) {
      expect(u.dimension).not.toMatch(/hook|proof/)
      expect(String(u.value)).not.toMatch(/question|quote/)
      expect(u.pattern).toMatch(/^On (X|LinkedIn), .+ (beat|were below) this brand's usual engagement/)
    }
  })

  it('passes the identifying cell only — no n, wins, campaigns or bound (the floor is SQL)', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    for (const u of db.upserts) expect(Object.keys(u).sort()).toEqual(['business_id', 'dimension', 'direction', 'pattern', 'platform', 'value'])
  })
})

describe('promote / demote calls (CONTRADICTION-DEMOTES-ATOMIC, the call half)', () => {
  it('asks to promote a candidate and to demote an active row, by key', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    expect(db.promotes).toEqual(['outcome:role:customer_proof:above:twitter'])
    expect(db.demotes).toEqual(['outcome:format:thread:above:twitter'])
  })
})

describe('OUTCOME-TICK-IDEMPOTENT', () => {
  it('a REPLAYED tick writes nothing and recomputes nothing', async () => {
    seedMix()
    await runOutcomeTick({ triggeredBy: 'secret' })
    const snapshot = JSON.stringify([...db.outcomes.entries()])
    const upserts = db.upserts.length

    const again = await runOutcomeTick({ triggeredBy: 'secret' })
    expect(JSON.stringify([...db.outcomes.entries()])).toBe(snapshot)
    expect(again).toMatchObject({ outcomesWritten: 0, cellsRecomputed: 0, candidatesUpserted: 0, promoted: 0, demoted: 0 })
    expect(db.upserts.length).toBe(upserts)
  })
})

describe('isolation and budget', () => {
  it('an error on one business does not stop the next', async () => {
    seedMix()
    db.businesses = ['b1', 'b2']
    db.failDueFor = 'b1'
    seedPriors('b2', 'twitter', 8, 0.05)
    db.posts = [post({ id: 'p-b2', business_id: 'b2' })]
    const s = await runOutcomeTick({ triggeredBy: 'qstash' })
    expect(s.errors).toBe(1)
    expect(s.outcomesWritten).toBe(1)
    expect(db.outcomes.has('p-b2')).toBe(true)
  })

  it('OUTCOME_BATCH_SIZE bounds the ready posts frozen per tick; the rest wait for the next tick', async () => {
    seedPriors('b1', 'twitter', 8, 0.05)
    db.posts = ['a', 'b', 'c'].map((id, i) => post({ id, published_at: `2026-08-1${i}T10:00:00Z` }))
    db.batch = 2
    const first = await runOutcomeTick({ triggeredBy: 'secret' })
    expect(first.matured).toBe(2)
    const second = await runOutcomeTick({ triggeredBy: 'secret' })
    expect(second.matured).toBe(1)
  })
})

describe('OUTCOME-WINDOWED-DECAY — a pattern whose newest agreeing observation is 91 days old is not returned', () => {
  // The row the SQL writes carries expires_at = newest agreeing observation + 90 days (OUTCOME_PATTERN_TTL_DAYS);
  // retrieval's eligibility gate (lib/memory/scoring.isEligible) is what drops it. Fake timers, never wall clock.
  const newestAgreeing = new Date('2026-06-01T12:00:00Z')
  const row = { status: 'active' as const, expires_at: iso(addDays(newestAgreeing, 90)) }

  it('eligible at day 89, gone at day 91', () => {
    vi.setSystemTime(addDays(newestAgreeing, 89))
    expect(isEligible(row, new Date())).toBe(true)
    vi.setSystemTime(addDays(newestAgreeing, 91))
    expect(isEligible(row, new Date())).toBe(false)
  })
})
