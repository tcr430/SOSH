import { describe, it, expect } from 'vitest'
import { campaignCellKeys, classifyObservedRows } from '../campaign-view'
import type { PerformanceMemoryRow } from '@/lib/db/types'

// ADR 0026 §10.1 (J2.12) — the list is restricted to cells THIS campaign's posts contributed to; one line per cell;
// a dimension with a single value has nothing to compare.

const pm = (key: string, over: Partial<PerformanceMemoryRow> = {}): PerformanceMemoryRow => ({
  id: key, business_id: 'b', source: 'outcome', confidence: 0.4, observation_count: 10, status: 'active', sensitivity: 'internal',
  public_use_permission: false, scope: 'platform', scope_ref: 'twitter', last_confirmed_at: null, recency_at: '2026-09-01T00:00:00Z',
  expires_at: null, deleted_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', import_run_id: null,
  import_source_post_ids: null, dimension: key.split(':')[1], pattern: 'p', platform: key.split(':')[4], pattern_key: key,
  outcome_n: 11, outcome_wins: 9, outcome_distinct_campaigns: 3, interval_low: 0.6, interval_high: 0.95, metric_basis: 'rate',
  baseline_seeded: false, contradicted_at: null, ...over,
} as PerformanceMemoryRow)

const source = (over: Record<string, unknown> = {}) => ({ platform: 'twitter', length_band: 'short', cta_present: false, role: 'anchor_thesis', format: 'thread', origin_mode: 'manual', ...over })

describe('campaignCellKeys', () => {
  it('lists the dimension:value:platform cells a campaign contributed to (cta as true/false)', () => {
    expect([...campaignCellKeys([source()])].sort()).toEqual([
      'cta:false:twitter', 'format:thread:twitter', 'length_band:short:twitter', 'origin_mode:manual:twitter', 'role:anchor_thesis:twitter',
    ])
  })
  it('null dimensions (a human-written post) contribute no generation-time cell', () => {
    expect([...campaignCellKeys([source({ role: null, format: null, origin_mode: null })])].sort()).toEqual(['cta:false:twitter', 'length_band:short:twitter'])
  })
})

describe('classifyObservedRows', () => {
  const cells = new Set(['format:thread:twitter', 'length_band:short:twitter'])

  it("restricts to this campaign's cells", () => {
    const rows = [pm('outcome:format:thread:above:twitter'), pm('outcome:format:single:above:twitter'), pm('outcome:length_band:short:above:twitter'), pm('outcome:length_band:long:above:twitter')]
    expect(classifyObservedRows(rows, cells).map((r) => r.cell)).toEqual(['format:thread:twitter', 'length_band:short:twitter'])
  })

  it('one line per cell: the direction with the larger share of agreeing posts leads', () => {
    const rows = [
      pm('outcome:format:thread:above:twitter', { outcome_wins: 3, outcome_n: 10 }),
      pm('outcome:format:thread:below:twitter', { outcome_wins: 7, outcome_n: 10 }),
      pm('outcome:format:single:above:twitter'),
    ]
    const out = classifyObservedRows(rows, cells)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ direction: 'below', wins: 7, n: 10 })
  })

  it('states: live (active), provisional (candidate), contradicted (candidate with contradicted_at), no_variety (one value)', () => {
    const rows = [
      pm('outcome:format:thread:above:twitter'), pm('outcome:format:single:above:twitter'),
      pm('outcome:length_band:short:above:twitter', { status: 'candidate' }), pm('outcome:length_band:long:above:twitter'),
    ]
    const byCell = Object.fromEntries(classifyObservedRows(rows, cells).map((r) => [r.cell, r.state]))
    expect(byCell).toEqual({ 'format:thread:twitter': 'live', 'length_band:short:twitter': 'provisional' })

    const contradicted = classifyObservedRows(
      [pm('outcome:format:thread:above:twitter', { status: 'candidate', contradicted_at: '2026-09-22T00:00:00Z' }), pm('outcome:format:single:above:twitter')],
      cells,
    )
    expect(contradicted[0]).toMatchObject({ state: 'contradicted', pausedAt: '2026-09-22T00:00:00Z' })

    const single = classifyObservedRows([pm('outcome:format:thread:above:twitter')], cells)
    expect(single[0].state).toBe('no_variety')
  })

  it('carries seeded and the count basis through; ignores hypothesis and malformed rows', () => {
    const rows = [
      pm('outcome:format:thread:above:linkedin', { baseline_seeded: true, metric_basis: 'count' }), pm('outcome:format:single:above:linkedin'),
      pm('outcome:hypothesis:campaign-1', { dimension: 'hypothesis' }), pm('nonsense', { pattern_key: null }),
    ]
    const out = classifyObservedRows(rows, new Set(['format:thread:linkedin']))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ seeded: true, basis: 'count', platform: 'linkedin' })
  })
})
