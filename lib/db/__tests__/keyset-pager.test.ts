import { describe, it, expect } from 'vitest'
import { READ_CEILING, ReadCeilingExceeded, keysetFilterDesc, readAllPages } from '../keyset-pager'
import { typicalOf } from '@/lib/analytics/rates'
import { monthOf } from '@/lib/analytics/period'
import { fixtureRecords } from '@/lib/analytics/__fixtures__/adapters'
import { BUSINESS_A_ID } from '@/lib/analytics/__fixtures__/portfolio'

// ADR 0031 §2.7 (ANALYTICS-NO-SILENT-TRUNCATION): every aggregate read pages on its ORDER BY columns until it is
// exhausted, and a hard ceiling of 5,000 rows stops a runaway. The ceiling THROWS: there is no truncated return.
type Row = { published_at: string; id: string; value: number }

// An in-memory table honouring the keyset: rows are published_at DESC, id DESC and a page starts strictly after its cursor.
function table(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => (a.published_at === b.published_at ? b.id.localeCompare(a.id) : b.published_at.localeCompare(a.published_at)))
  const calls: Array<{ after: Row | null; limit: number }> = []
  const fetchPage = async (after: Row | null, limit: number): Promise<Row[]> => {
    calls.push({ after, limit })
    const start = after === null ? 0 : sorted.findIndex((r) => r.id === after.id) + 1
    return sorted.slice(start, start + limit)
  }
  return { sorted, calls, fetchPage }
}

const make = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    published_at: `2026-03-${String(1 + (i % 28)).padStart(2, '0')}T09:00:00+00:00`,
    id: `id-${String(i).padStart(6, '0')}`,
    value: i / 1000,
  }))

describe('readAllPages', () => {
  it('crosses a page boundary: 7 rows at 3 a page are 3 requests, each starting after the previous last row, in order', async () => {
    const t = table(make(7))
    const out = await readAllPages({ read: 'posts', pageSize: 3, fetchPage: t.fetchPage })
    expect(out).toEqual(t.sorted)
    expect(t.calls.map((c) => c.limit)).toEqual([3, 3, 3])
    expect(t.calls[0].after).toBeNull()
    expect(t.calls[1].after).toEqual(t.sorted[2])
    expect(t.calls[2].after).toEqual(t.sorted[5])
  })

  it('an exact multiple costs one empty extra request and returns every row once', async () => {
    const t = table(make(6))
    const out = await readAllPages({ read: 'posts', pageSize: 3, fetchPage: t.fetchPage })
    expect(out).toHaveLength(6)
    expect(new Set(out.map((r) => r.id)).size).toBe(6)
    expect(t.calls).toHaveLength(3)
  })

  it('an empty table is one request and an empty list', async () => {
    const t = table([])
    expect(await readAllPages({ read: 'posts', pageSize: 3, fetchPage: t.fetchPage })).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('the median over two pages EQUALS the median over the unpaged read (March, business A, X: 0.031)', async () => {
    const measured = fixtureRecords(BUSINESS_A_ID)
      .filter((r) => r.outcome && r.post.platform === 'twitter' && monthOf(r.post.publishedAt, 'Europe/Lisbon') === '2026-03')
      .map((r) => ({ published_at: r.post.publishedAt, id: r.post.postId, value: r.outcome!.value }))
    expect(measured).toHaveLength(7)
    const t = table(measured)
    const paged = await readAllPages({ read: 'outcomes', pageSize: 4, fetchPage: t.fetchPage })
    expect(t.calls.length).toBeGreaterThanOrEqual(2)
    expect(typicalOf(paged.map((r) => r.value))).toEqual(typicalOf(measured.map((r) => r.value)))
    expect(typicalOf(paged.map((r) => r.value)).median).toBe(0.031)
  })

  it('a tie on the primary key does not drop or repeat a row: ten rows on ONE instant page cleanly at 3', async () => {
    const same = Array.from({ length: 10 }, (_, i) => ({ published_at: '2026-03-05T09:00:00+00:00', id: `t-${i}`, value: i }))
    const out = await readAllPages({ read: 'posts', pageSize: 3, fetchPage: table(same).fetchPage })
    expect(out.map((r) => r.id)).toEqual(['t-9', 't-8', 't-7', 't-6', 't-5', 't-4', 't-3', 't-2', 't-1', 't-0'])
  })
})

describe('the 5,000-row ceiling throws ReadCeilingExceeded (never a truncated aggregate)', () => {
  it('the ceiling is 5,000', () => {
    expect(READ_CEILING).toBe(5000)
  })

  it('5,001 rows THROW, typed, naming the read and the ceiling', async () => {
    const t = table(make(5001))
    const err = await readAllPages({ read: 'month outcomes', pageSize: 500, fetchPage: t.fetchPage }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReadCeilingExceeded)
    expect((err as ReadCeilingExceeded).read).toBe('month outcomes')
    expect((err as ReadCeilingExceeded).ceiling).toBe(5000)
    expect((err as Error).message).toMatch(/truncated/)
  })

  it('exactly 5,000 rows are returned in full', async () => {
    const t = table(make(5000))
    const out = await readAllPages({ read: 'posts', pageSize: 500, fetchPage: t.fetchPage })
    expect(out).toHaveLength(5000)
  })

  it('it never asks the database for more than ceiling + 1 rows in total', async () => {
    const t = table(make(9000))
    await readAllPages({ read: 'posts', pageSize: 500, fetchPage: t.fetchPage }).catch(() => undefined)
    expect(t.calls.reduce((sum, c) => sum + c.limit, 0)).toBeLessThanOrEqual(5001)
  })

  it('a ceiling smaller than the fixture throws on the fixture (the ceiling is live, not decorative)', async () => {
    const t = table(make(40))
    await expect(readAllPages({ read: 'posts', pageSize: 10, ceiling: 25, fetchPage: t.fetchPage })).rejects.toBeInstanceOf(ReadCeilingExceeded)
  })
})

describe('keysetFilterDesc: rows strictly after the cursor on (primary DESC, tiebreak DESC)', () => {
  it('is the quoted PostgREST or() expression', () => {
    expect(keysetFilterDesc('published_at', 'id', { primary: '2026-03-05T09:00:00+00:00', tiebreak: 'abc' })).toBe(
      'published_at.lt."2026-03-05T09:00:00+00:00",and(published_at.eq."2026-03-05T09:00:00+00:00",id.lt."abc")',
    )
  })

  it('escapes a double quote so a value cannot break out of its quotes', () => {
    expect(keysetFilterDesc('a', 'b', { primary: 'x"y', tiebreak: 'z' })).toContain('a.lt."x\\"y"')
  })
})
