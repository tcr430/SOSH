import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listCampaignsByIds } from './campaigns'

// Session 37-D D3 (MAJOR-10): the analytics loaders read campaigns BY ID for one business. The business filter is the boundary a
// foreign id meets, the read is chunked and bounded by the ids (never a page of the business's campaigns), and a soft-deleted
// campaign is not returned (its row renders the "Open campaign" fallback). New file: campaigns.test.ts is untouched.

const ids = (n: number) => Array.from({ length: n }, (_, i) => 'c' + String(i).padStart(3, '0'))

describe('listCampaignsByIds', () => {
  it('reads only these ids of ONE business, live campaigns only, and selects exactly id, business_id, name, status', async () => {
    const { client, builder, from } = createMockClient([{ id: 'c000', business_id: 'biz-1', name: 'Launch', status: 'active' }])
    const out = await listCampaignsByIds(client, 'biz-1', ['c000'])
    expect(out).toEqual([{ id: 'c000', business_id: 'biz-1', name: 'Launch', status: 'active' }])
    expect(from).toHaveBeenCalledWith('campaigns')
    expect(builder.select).toHaveBeenCalledWith('id, business_id, name, status')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(builder.in).toHaveBeenCalledWith('id', ['c000'])
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
  })

  it('chunks by 20 and bounds each chunk, so 45 ids are three bounded reads and never a 100-row page', async () => {
    const { client, builder } = createMockClient([])
    await listCampaignsByIds(client, 'biz-1', ids(45))
    const sizes = (builder.in as unknown as { mock: { calls: Array<[string, string[]]> } }).mock.calls.map((c) => c[1].length)
    expect(sizes).toEqual([20, 20, 5])
    for (const c of (builder.limit as unknown as { mock: { calls: number[][] } }).mock.calls) expect(c[0]).toBe(20)
  })

  it('de-duplicates the ids and makes NO read for none', async () => {
    const { client, builder, from } = createMockClient([])
    await listCampaignsByIds(client, 'biz-1', ['c000', 'c000', 'c000'])
    expect((builder.in as unknown as { mock: { calls: Array<[string, string[]]> } }).mock.calls[0][1]).toEqual(['c000'])
    from.mockClear()
    expect(await listCampaignsByIds(client, 'biz-1', [])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws on a database error rather than returning a partial result', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listCampaignsByIds(client, 'biz-1', ['c000'])).rejects.toThrow('DB error')
  })
})
