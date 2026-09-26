import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listAudienceSlotRows } from './memory-audience'
import { listBrandSlotRows } from './memory-brand'
import { listEvidenceSlotRows } from './memory-evidence'

// ADR 0029 §3.2 / §9.5 (Session 35 M2.7) — INTERVIEW-BOUNDED-QUERIES, the thinness read. Per table: business-scoped,
// ACTIVE + undeleted + unexpired, every source, ordered on the retrieval index's sort key, limit 500 by default.
// SHARED-FUNCTION CALLERS: the only caller of each is lib/memory/interview-coverage.ts (tested in
// lib/memory/interview-coverage.test.ts); the /interview page and the Start action (M2.9/M2.10) call THAT.

const NOW_ISO = '2026-09-26T12:00:00.000Z'

const CASES = [
  { name: 'brand', fn: listBrandSlotRows, table: 'brand_memory', column: 'category' },
  { name: 'audience', fn: listAudienceSlotRows, table: 'audience_memory', column: 'kind' },
  { name: 'evidence', fn: listEvidenceSlotRows, table: 'evidence_memory', column: 'kind' },
] as const

describe.each(CASES)('list$name SlotRows', ({ fn, table, column }) => {
  it('reads only the columns thinness needs, from the right table', async () => {
    const { client, builder, from } = createMockClient([])
    await fn(client, 'biz-1', NOW_ISO)
    expect(from).toHaveBeenCalledWith(table)
    expect(builder.select).toHaveBeenCalledWith(`${column}, status, recency_at, expires_at, deleted_at`)
  })

  it('is scoped to ONE business and to active, undeleted, unexpired rows — from every source (no source filter)', async () => {
    const { client, builder } = createMockClient([])
    await fn(client, 'biz-1', NOW_ISO)
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(builder.or).toHaveBeenCalledWith(`expires_at.is.null,expires_at.gt.${NOW_ISO}`)
    for (const call of (builder.eq as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(call[0], 'must not filter by source').not.toBe('source')
    }
  })

  it('is bounded: limit 500 by default, and an explicit limit is honoured', async () => {
    const a = createMockClient([])
    await fn(a.client, 'biz-1', NOW_ISO)
    expect(a.builder.limit).toHaveBeenCalledWith(500)
    const b = createMockClient([])
    await fn(b.client, 'biz-1', NOW_ISO, 25)
    expect(b.builder.limit).toHaveBeenCalledWith(25)
  })

  it("has an explicit ORDER BY on the retrieval index's sort key (confidence DESC, recency_at DESC)", async () => {
    const { client, builder } = createMockClient([])
    await fn(client, 'biz-1', NOW_ISO)
    expect(builder.order).toHaveBeenNthCalledWith(1, 'confidence', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'recency_at', { ascending: false })
  })

  it('returns the rows, and [] for a null result', async () => {
    const rows = [{ [column]: 'positioning', status: 'active', recency_at: NOW_ISO, expires_at: null, deleted_at: null }]
    expect(await fn(createMockClient(rows).client, 'biz-1', NOW_ISO)).toEqual(rows)
    expect(await fn(createMockClient(null).client, 'biz-1', NOW_ISO)).toEqual([])
  })

  it('throws the database error rather than returning an empty (falsely thin) list', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    await expect(fn(client, 'biz-1', NOW_ISO)).rejects.toThrow(/boom/)
  })
})
