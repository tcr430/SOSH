import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { addDays, formatISO } from 'date-fns'
import type { PerformanceMemoryRow } from '@/lib/db/types'

// ADR 0026 §6.4 (J2.9) — retrieveOutcomePatterns: only active, unexpired, non-hypothesis outcome rows, ranked
// and capped at OUTCOME_CAP (3) AMONG OUTCOME ROWS ONLY.

const listOutcomePatterns = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/memory-performance', () => ({ listOutcomePatterns }))

import { retrieveOutcomePatterns, retrieveHypothesisResults } from './outcomes'

const NOW = new Date('2026-09-19T12:00:00Z')

function row(over: Partial<PerformanceMemoryRow> & { id: string }): PerformanceMemoryRow {
  return {
    business_id: 'biz-1', source: 'outcome', confidence: 0.5, observation_count: 10, status: 'active',
    sensitivity: 'internal', public_use_permission: false, scope: 'platform', scope_ref: 'twitter',
    last_confirmed_at: formatISO(addDays(NOW, -5)), recency_at: formatISO(addDays(NOW, -5)),
    expires_at: formatISO(addDays(NOW, 60)), deleted_at: null, created_at: formatISO(addDays(NOW, -30)),
    updated_at: formatISO(addDays(NOW, -5)), import_run_id: null, import_source_post_ids: null,
    dimension: 'format', pattern: "On X, thread posts beat this brand's usual engagement.", platform: 'twitter',
    pattern_key: 'outcome:format:thread:above:twitter',
    outcome_n: 11, outcome_wins: 9, outcome_distinct_campaigns: 3, interval_low: 0.6, interval_high: 0.95,
    metric_basis: 'rate', baseline_seeded: false, contradicted_at: null,
    ...over,
  } as PerformanceMemoryRow
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  listOutcomePatterns.mockReset()
})
afterEach(() => vi.useRealTimers())

// ADR 0026 §8.4 / J2.10 — Stage A is the ONLY reader of hypothesis rows.
describe('retrieveHypothesisResults', () => {
  const hyp = (id: string, over: Partial<PerformanceMemoryRow> = {}) =>
    row({ id, dimension: 'hypothesis' as never, pattern: `Campaign ${id} tested: 'x'. Result: supported.`, pattern_key: `outcome:hypothesis:${id}`, ...over })

  it('asks the reader for hypothesis rows only, and returns the last three with their n', async () => {
    listOutcomePatterns.mockResolvedValue([hyp('a'), hyp('b'), hyp('c'), hyp('d')])
    const out = await retrieveHypothesisResults('biz-1')
    expect(listOutcomePatterns).toHaveBeenCalledWith('biz-1', expect.objectContaining({ dimension: 'hypothesis', status: 'active' }))
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ n: 11, wins: 9 })
  })

  it('drops expired rows and any non-hypothesis row the reader might return', async () => {
    listOutcomePatterns.mockResolvedValue([hyp('old', { expires_at: formatISO(addDays(NOW, -1)) }), row({ id: 'fmt' }), hyp('ok')])
    expect((await retrieveHypothesisResults('biz-1')).map((o) => o.pattern)).toEqual(["Campaign ok tested: 'x'. Result: supported."])
  })

  it('retrieveOutcomePatterns never returns a hypothesis row (post prompts cannot see them)', async () => {
    listOutcomePatterns.mockResolvedValue([hyp('a')])
    expect(await retrieveOutcomePatterns('biz-1')).toEqual([])
  })
})

describe('retrieveOutcomePatterns', () => {
  it('returns the closed-template text with the SQL-computed wins / n / campaigns', async () => {
    listOutcomePatterns.mockResolvedValue([row({ id: 'a' })])
    expect(await retrieveOutcomePatterns('biz-1')).toEqual([
      { platform: 'twitter', pattern: "On X, thread posts beat this brand's usual engagement.", wins: 9, n: 11, campaigns: 3 },
    ])
    expect(listOutcomePatterns).toHaveBeenCalledWith('biz-1', { status: 'active', platform: undefined })
  })

  it('caps at OUTCOME_CAP (3), keeping the highest-ranked three', async () => {
    listOutcomePatterns.mockResolvedValue(
      [0.9, 0.8, 0.7, 0.6, 0.5].map((confidence, i) => row({ id: `r${i}`, confidence, pattern: `P${i}.`, pattern_key: `outcome:format:k${i}:above:twitter` })),
    )
    const out = await retrieveOutcomePatterns('biz-1', { platform: 'twitter' })
    expect(out.map((o) => o.pattern)).toEqual(['P0.', 'P1.', 'P2.'])
  })

  it('excludes candidate, expired and hypothesis rows', async () => {
    listOutcomePatterns.mockResolvedValue([
      row({ id: 'cand', status: 'candidate', pattern: 'CANDIDATE.' }),
      row({ id: 'exp', expires_at: formatISO(addDays(NOW, -1)), pattern: 'EXPIRED.' }),
      row({ id: 'hyp', dimension: 'hypothesis' as never, pattern: 'HYPOTHESIS.' }),
      row({ id: 'ok', pattern: 'OK.' }),
    ])
    expect((await retrieveOutcomePatterns('biz-1')).map((o) => o.pattern)).toEqual(['OK.'])
  })

  it('drops a row that lacks its counts rather than rendering an observation without evidence', async () => {
    listOutcomePatterns.mockResolvedValue([row({ id: 'x', outcome_n: null })])
    expect(await retrieveOutcomePatterns('biz-1')).toEqual([])
  })
})
