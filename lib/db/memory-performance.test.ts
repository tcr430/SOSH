import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  listPerformanceMemoryCandidates,
  listDistilledPatternsForSummary,
  upsertDistilledPerformancePattern,
  countProcessedSignalsForPattern,
  promotePerformancePattern,
  demotePerformancePattern,
} from './memory-performance'
import type { PerformanceMemoryRow, PerformanceMemoryInsert } from './types'

function makeRow(overrides: Partial<PerformanceMemoryRow> = {}): PerformanceMemoryRow {
  return {
    id: 'pf-1',
    business_id: 'biz-1',
    source: 'manual',
    confidence: 0.8,
    observation_count: 3,
    status: 'active',
    sensitivity: 'internal',
    public_use_permission: false,
    scope: 'brand',
    scope_ref: null,
    last_confirmed_at: '2026-07-01T00:00:00Z',
    recency_at: '2026-07-01T00:00:00Z',
    expires_at: null,
    deleted_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    dimension: 'topic',
    pattern: 'technical-comparison posts perform well for CTO audiences',
    platform: 'linkedin',
    pattern_key: null,
    ...overrides,
  }
}

describe('listPerformanceMemoryCandidates', () => {
  it('queries performance_memory filtered by business_id, status=active, deleted_at null, ordered and limited', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await listPerformanceMemoryCandidates(client, 'biz-1')

    expect(client.from).toHaveBeenCalledWith('performance_memory')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(builder.order).toHaveBeenNthCalledWith(1, 'confidence', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'recency_at', { ascending: false })
    expect(builder.order).not.toHaveBeenCalledWith('last_confirmed_at', expect.anything())
  })

  it('scopes the read to business_id — the sole tenancy guard on this service-role query (MINOR-1)', async () => {
    // The generation path reads via service-role, which BYPASSES RLS (ADR
    // 0016 §4), so this .eq('business_id') is the ONLY thing preventing a
    // cross-tenant memory leak. Pinned on its own — not incidentally inside
    // the omnibus filter test above — so dropping it reddens loudly and
    // unmistakably.
    const { client, builder } = createMockClient([makeRow()], null)
    await listPerformanceMemoryCandidates(client, 'biz-42')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-42')
  })

  it('applies the given limit, defaulting to MEMORY_CANDIDATE_LIMIT', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await listPerformanceMemoryCandidates(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)

    await listPerformanceMemoryCandidates(client, 'biz-1', 3)
    expect(builder.limit).toHaveBeenCalledWith(3)
  })

  // [Session 25-D correction, MINOR-6] Without this filter, a 90-day-stale
  // 'active' pattern (expires_at in the past) would still reach generation —
  // the decay column upsert_distilled_performance_pattern writes on every
  // upsert would be write-only, doing nothing. NULL is included via `.or()`
  // so manual/import rows (which never get an expires_at) aren't wrongly
  // treated as expired. Reddens if the `.or(...)` call is removed from the
  // implementation — verified by temporarily removing it and re-running.
  it('filters out expired rows via expires_at.is.null OR expires_at.gt.now() (MINOR-6)', async () => {
    const { client, builder } = createMockClient([makeRow()], null)
    await listPerformanceMemoryCandidates(client, 'biz-1')
    expect(builder.or).toHaveBeenCalledWith('expires_at.is.null,expires_at.gt.now()')
  })

  it('a fresh, never-confirmed row (last_confirmed_at NULL) still lands in the candidate window', async () => {
    // ADR 0016 §5.3: a freshly-distilled row with no last_confirmed_at must
    // not be silently excluded by this layer's query — it is present in the
    // result here because the query has no filter that would drop it.
    // Actual COALESCE-ranking is a DB-level guarantee (the recency_at
    // generated column, migration 20260719020000), not something this
    // mocked-client test can prove — that needs a Tier-1 live-Postgres test.
    const freshRow = makeRow({
      id: 'pf-fresh',
      source: 'distilled',
      last_confirmed_at: null,
      recency_at: '2026-07-10T00:00:00Z',
      created_at: '2026-07-10T00:00:00Z',
      confidence: 0.9,
    })
    const { client } = createMockClient([freshRow], null)

    const result = await listPerformanceMemoryCandidates(client, 'biz-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('pf-fresh')
    expect(result[0].last_confirmed_at).toBeNull()
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(listPerformanceMemoryCandidates(client, 'biz-1')).rejects.toThrow('connection reset')
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = createMockClient([], null)
    const result = await listPerformanceMemoryCandidates(client, 'biz-1')
    expect(result).toEqual([])
  })
})

describe('listDistilledPatternsForSummary', () => {
  it('filters by business_id and source=distilled, excludes retired, requires deleted_at null — but NOT status=active', async () => {
    const { client, builder } = createMockClient([makeRow({ source: 'distilled', status: 'candidate' })], null)

    await listDistilledPatternsForSummary(client, 'biz-1')

    expect(client.from).toHaveBeenCalledWith('performance_memory')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('source', 'distilled')
    expect(builder.neq).toHaveBeenCalledWith('status', 'retired')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(builder.eq).not.toHaveBeenCalledWith('status', 'active')
  })

  it('applies the given limit, defaulting to MEMORY_CANDIDATE_LIMIT', async () => {
    const { client, builder } = createMockClient([], null)
    await listDistilledPatternsForSummary(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)

    await listDistilledPatternsForSummary(client, 'biz-1', 10)
    expect(builder.limit).toHaveBeenCalledWith(10)
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(listDistilledPatternsForSummary(client, 'biz-1')).rejects.toThrow('connection reset')
  })
})

function makeInsert(overrides: Partial<PerformanceMemoryInsert> = {}): PerformanceMemoryInsert {
  return {
    business_id: 'biz-1',
    dimension: 'format',
    pattern: 'Human editors shorten AI-generated LinkedIn posts by ~22%',
    pattern_key: 'length_delta:shorter:linkedin',
    platform: 'linkedin',
    scope: 'platform',
    scope_ref: 'linkedin',
    confidence: 0.714,
    observation_count: 5,
    ...overrides,
  }
}

describe('upsertDistilledPerformancePattern', () => {
  it('calls the upsert RPC with the full parameter set, mapped from the insert shape', async () => {
    const row = makeRow({ id: 'pf-new', source: 'distilled', status: 'candidate' })
    const { client } = createMockClient(row, null)

    await upsertDistilledPerformancePattern(client, makeInsert())

    expect(client.rpc).toHaveBeenCalledWith('upsert_distilled_performance_pattern', {
      p_business_id: 'biz-1',
      p_dimension: 'format',
      p_pattern: 'Human editors shorten AI-generated LinkedIn posts by ~22%',
      p_pattern_key: 'length_delta:shorter:linkedin',
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0.714,
      p_observation_count: 5,
    })
  })

  it('unwraps a SETOF-shaped array response to the single row', async () => {
    const row = makeRow({ id: 'pf-new' })
    const { client } = createMockClient([row], null)
    const result = await upsertDistilledPerformancePattern(client, makeInsert())
    expect(result.id).toBe('pf-new')
  })

  it('throws when the RPC returns an error', async () => {
    const { client } = createMockClient(null, { message: 'constraint violation' })
    await expect(upsertDistilledPerformancePattern(client, makeInsert())).rejects.toThrow('constraint violation')
  })

  it('throws when the RPC returns no row at all', async () => {
    const { client } = createMockClient([], null)
    await expect(upsertDistilledPerformancePattern(client, makeInsert())).rejects.toThrow(
      'upsert_distilled_performance_pattern returned no row',
    )
  })
})

describe('countProcessedSignalsForPattern', () => {
  it('queries post_edit_signals filtered by business_id, pattern_key, status=processed, AND class=preference', async () => {
    const { client, builder } = createMockClient(null, null)
    await countProcessedSignalsForPattern(client, 'biz-1', 'length_delta:shorter:linkedin')

    expect(client.from).toHaveBeenCalledWith('post_edit_signals')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('pattern_key', 'length_delta:shorter:linkedin')
    expect(builder.eq).toHaveBeenCalledWith('status', 'processed')
    // database-reviewer (C2.6, MAJOR): without this filter, a signal
    // reclassified away from 'preference' after a pattern_key row already
    // exists would still be counted on every future recompute, since the
    // upsert's ON CONFLICT DO UPDATE never re-arms the DB-side voice-write
    // guard (its conflict target IS the columns that guard re-checks).
    expect(builder.eq).toHaveBeenCalledWith('class', 'preference')
  })

  it('returns 0 when count is null/undefined rather than throwing', async () => {
    const { client } = createMockClient(null, null)
    const result = await countProcessedSignalsForPattern(client, 'biz-1', 'k')
    expect(result).toBe(0)
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(countProcessedSignalsForPattern(client, 'biz-1', 'k')).rejects.toThrow('connection reset')
  })
})

describe('promotePerformancePattern', () => {
  it('calls the promote RPC with business_id/pattern_key/dimension/platform', async () => {
    const { client } = createMockClient([makeRow({ status: 'active' })], null)
    await promotePerformancePattern(client, 'biz-1', 'length_delta:shorter:linkedin', 'format', 'linkedin')

    expect(client.rpc).toHaveBeenCalledWith('promote_performance_pattern', {
      p_business_id: 'biz-1',
      p_pattern_key: 'length_delta:shorter:linkedin',
      p_dimension: 'format',
      p_platform: 'linkedin',
    })
  })

  it('returns null (not an error) when the guard did not hold — no row promoted', async () => {
    const { client } = createMockClient([], null)
    const result = await promotePerformancePattern(client, 'biz-1', 'k', 'format', 'linkedin')
    expect(result).toBeNull()
  })

  it('throws when the RPC returns an error', async () => {
    const { client } = createMockClient(null, { message: 'permission denied' })
    await expect(promotePerformancePattern(client, 'biz-1', 'k', 'format', 'linkedin')).rejects.toThrow(
      'permission denied',
    )
  })
})

describe('demotePerformancePattern', () => {
  // [Session 25-D correction, MINOR-8] `net` (a plain number the caller
  // computed) is replaced by `contradictingPatternKey` — the RPC now
  // recomputes the contradiction count itself from this key, via a live
  // correlated subquery, rather than trusting caller arithmetic.
  it('calls the demote RPC with business_id/pattern_key/dimension/platform/contradictingPatternKey', async () => {
    const { client } = createMockClient([makeRow({ status: 'candidate' })], null)
    await demotePerformancePattern(
      client,
      'biz-1',
      'length_delta:shorter:linkedin',
      'format',
      'linkedin',
      'length_delta:longer:linkedin',
    )

    expect(client.rpc).toHaveBeenCalledWith('demote_performance_pattern', {
      p_business_id: 'biz-1',
      p_pattern_key: 'length_delta:shorter:linkedin',
      p_dimension: 'format',
      p_platform: 'linkedin',
      p_contradicting_pattern_key: 'length_delta:longer:linkedin',
    })
  })

  it('passes null through for a signal kind with no natural opposite', async () => {
    const { client } = createMockClient([makeRow({ status: 'candidate' })], null)
    await demotePerformancePattern(client, 'biz-1', 'avoid_word_removed:fixed:linkedin', 'format', 'linkedin', null)

    expect(client.rpc).toHaveBeenCalledWith('demote_performance_pattern', {
      p_business_id: 'biz-1',
      p_pattern_key: 'avoid_word_removed:fixed:linkedin',
      p_dimension: 'format',
      p_platform: 'linkedin',
      p_contradicting_pattern_key: null,
    })
  })

  it('returns null (not an error) when the guard did not hold — no row demoted', async () => {
    const { client } = createMockClient([], null)
    const result = await demotePerformancePattern(client, 'biz-1', 'k', 'format', 'linkedin', 'k-opposite')
    expect(result).toBeNull()
  })

  it('throws when the RPC returns an error', async () => {
    const { client } = createMockClient(null, { message: 'permission denied' })
    await expect(demotePerformancePattern(client, 'biz-1', 'k', 'format', 'linkedin', 'k-opposite')).rejects.toThrow(
      'permission denied',
    )
  })
})
