import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listReportIndex } from '../analytics-reports'

// The list page's index reader (react review, O2.10): id, month and the stub flag, NEVER the payload; same filter, order and
// bound as listReports. A fake query builder records what was asked.

function fake(rows: unknown[] | null, error: { message: string } | null = null) {
  const calls: Record<string, unknown[]> = {}
  const q: Record<string, (...a: unknown[]) => unknown> = {}
  for (const name of ['select', 'eq', 'order', 'limit']) {
    q[name] = (...args: unknown[]) => {
      calls[name] = args
      return q
    }
  }
  ;(q as unknown as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve({ data: rows, error })
  const client = { from: (table: string) => ((calls.from = [table]), q) } as unknown as SupabaseClient
  return { client, calls }
}

describe('listReportIndex', () => {
  it('asks for id, period_month and a jsonb-path stub flag only: no payload column, no star', async () => {
    const { client, calls } = fake([])
    await listReportIndex(client, 'biz-a')
    expect(calls.from).toEqual(['analytics_reports'])
    expect(calls.select?.[0]).toBe('id, period_month, stub:payload->>stub')
    expect(String(calls.select?.[0])).not.toMatch(/\*|payload,|payload\s/)
  })

  it('is keyed on the business, newest month first, and bounded at 24 whatever the caller asks', async () => {
    const { client, calls } = fake([])
    await listReportIndex(client, 'biz-a', 1000)
    expect(calls.eq).toEqual(['business_id', 'biz-a'])
    expect(calls.order).toEqual(['period_month', { ascending: false }])
    expect(calls.limit).toEqual([24])
    const small = fake([])
    await listReportIndex(small.client, 'biz-a', 0)
    expect(small.calls.limit).toEqual([1])
  })

  it('maps the stub flag from the text "true" (PostgREST returns ->> as text) and from a boolean, and anything else is not a stub', async () => {
    const { client } = fake([
      { id: 'a', period_month: '2026-04-01', stub: 'true' },
      { id: 'b', period_month: '2026-03-01', stub: 'false' },
      { id: 'c', period_month: '2026-02-01', stub: true },
      { id: 'd', period_month: '2026-01-01', stub: null },
    ])
    expect((await listReportIndex(client, 'biz-a')).map((r) => r.stub)).toEqual([true, false, true, false])
  })

  it('returns only id, period_month and stub on each row', async () => {
    const { client } = fake([{ id: 'a', period_month: '2026-04-01', stub: 'false', payload: { secret: 1 } }])
    const [row] = await listReportIndex(client, 'biz-a')
    expect(Object.keys(row).sort()).toEqual(['id', 'period_month', 'stub'])
  })

  it('an empty result is an empty list, and a database error throws', async () => {
    expect(await listReportIndex(fake(null).client, 'biz-a')).toEqual([])
    await expect(listReportIndex(fake(null, { message: 'rls' }).client, 'biz-a')).rejects.toThrow()
  })
})
