import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listEvidenceMemoryCandidates, getEvidenceMemoryByIds } from './memory-evidence'
import type { EvidenceMemoryRow } from './types'

function makeRow(overrides: Partial<EvidenceMemoryRow> = {}): EvidenceMemoryRow {
  return {
    id: 'ev-1',
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
    kind: 'quote',
    content: 'This tool saved us hours every week',
    source_url: null,
    ...overrides,
  }
}

describe('listEvidenceMemoryCandidates', () => {
  it('queries evidence_memory filtered by business_id, status=active, deleted_at null, ordered and limited', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await listEvidenceMemoryCandidates(client, 'biz-1')

    expect(client.from).toHaveBeenCalledWith('evidence_memory')
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
    await listEvidenceMemoryCandidates(client, 'biz-42')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-42')
  })

  it('applies the given limit, defaulting to MEMORY_CANDIDATE_LIMIT', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await listEvidenceMemoryCandidates(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)

    await listEvidenceMemoryCandidates(client, 'biz-1', 5)
    expect(builder.limit).toHaveBeenCalledWith(5)
  })

  it('a fresh, never-confirmed row (last_confirmed_at NULL) still lands in the candidate window', async () => {
    // ADR 0016 §5.3: a freshly-distilled row with no last_confirmed_at must
    // not be silently excluded by this layer's query — it is present in the
    // result here because the query has no filter that would drop it.
    // Actual COALESCE-ranking is a DB-level guarantee (the recency_at
    // generated column, migration 20260719020000), not something this
    // mocked-client test can prove — that needs a Tier-1 live-Postgres test.
    const freshRow = makeRow({
      id: 'ev-fresh',
      source: 'distilled',
      last_confirmed_at: null,
      recency_at: '2026-07-10T00:00:00Z',
      created_at: '2026-07-10T00:00:00Z',
      confidence: 0.9,
    })
    const { client } = createMockClient([freshRow], null)

    const result = await listEvidenceMemoryCandidates(client, 'biz-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ev-fresh')
    expect(result[0].last_confirmed_at).toBeNull()
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(listEvidenceMemoryCandidates(client, 'biz-1')).rejects.toThrow('connection reset')
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = createMockClient([], null)
    const result = await listEvidenceMemoryCandidates(client, 'biz-1')
    expect(result).toEqual([])
  })
})

describe('getEvidenceMemoryByIds', () => {
  it('queries evidence_memory filtered by id list, status=active, deleted_at null', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await getEvidenceMemoryByIds(client, ['ev-1', 'ev-2'])

    expect(client.from).toHaveBeenCalledWith('evidence_memory')
    expect(builder.in).toHaveBeenCalledWith('id', ['ev-1', 'ev-2'])
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('returns an empty array when given an empty id list (no query needed)', async () => {
    const { client, from } = createMockClient([makeRow()], null)
    const result = await getEvidenceMemoryByIds(client, [])
    expect(result).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(getEvidenceMemoryByIds(client, ['ev-1'])).rejects.toThrow('connection reset')
  })

  it('returns fewer rows than ids requested when some are retired/deleted (the staleness-gap close)', async () => {
    const { client } = createMockClient([makeRow({ id: 'ev-1' })], null)
    const result = await getEvidenceMemoryByIds(client, ['ev-1', 'ev-retired'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ev-1')
  })
})
