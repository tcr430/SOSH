import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { countProcessedSignalsSince, listRecentHumanEditExcerpts } from './post-edit-signals'

describe('countProcessedSignalsSince', () => {
  it('filters by business_id and status=processed, with no gt() when since is null', async () => {
    const { client, builder } = createMockClient(null, null)
    await countProcessedSignalsSince(client, 'biz-1', null)

    expect(client.from).toHaveBeenCalledWith('post_edit_signals')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'processed')
    expect(builder.gt).not.toHaveBeenCalled()
  })

  it('adds a gt(processed_at, since) filter when since is provided', async () => {
    const { client, builder } = createMockClient(null, null)
    await countProcessedSignalsSince(client, 'biz-1', '2026-07-01T00:00:00Z')
    expect(builder.gt).toHaveBeenCalledWith('processed_at', '2026-07-01T00:00:00Z')
  })

  it('returns 0 when count is null', async () => {
    const { client } = createMockClient(null, null)
    expect(await countProcessedSignalsSince(client, 'biz-1', null)).toBe(0)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(countProcessedSignalsSince(client, 'biz-1', null)).rejects.toThrow('DB error')
  })
})

describe('listRecentHumanEditExcerpts', () => {
  it('filters by business_id/status=processed, orders by processed_at desc, and applies the limit', async () => {
    const { client, builder } = createMockClient([{ human_content: 'a' }, { human_content: 'b' }], null)
    const result = await listRecentHumanEditExcerpts(client, 'biz-1', null, 200)

    expect(client.from).toHaveBeenCalledWith('post_edit_signals')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'processed')
    expect(builder.order).toHaveBeenCalledWith('processed_at', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(200)
    expect(result).toEqual(['a', 'b'])
  })

  it('adds a gt(processed_at, since) filter when since is provided', async () => {
    const { client, builder } = createMockClient([], null)
    await listRecentHumanEditExcerpts(client, 'biz-1', '2026-07-01T00:00:00Z', 200)
    expect(builder.gt).toHaveBeenCalledWith('processed_at', '2026-07-01T00:00:00Z')
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = createMockClient(null, null)
    expect(await listRecentHumanEditExcerpts(client, 'biz-1', null, 200)).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listRecentHumanEditExcerpts(client, 'biz-1', null, 200)).rejects.toThrow('DB error')
  })
})
