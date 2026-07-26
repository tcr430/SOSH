import { describe, it, expect } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'
import {
  createPostAiOriginal,
  getLatestRevision,
  createNextPostAiOriginalRevision,
  AI_ORIGINAL_SCHEMA_VERSION,
} from './post-ai-originals'
import type { PostAiOriginalRow, PostAiOriginalInsert } from './types'

const mockRow: PostAiOriginalRow = {
  id: 'origin-1',
  business_id: 'biz-1',
  post_id: 'post-1',
  campaign_id: 'camp-1',
  revision: 1,
  generation_kind: 'initial',
  format: 'single',
  payload: { format: 'single', body: 'Original content', imageBrief: null },
  rendered_content: 'Original content',
  hashtags: [],
  schema_version: AI_ORIGINAL_SCHEMA_VERSION,
  created_at: '2026-07-26T00:00:00Z',
}

const insertPayload: PostAiOriginalInsert = {
  business_id: 'biz-1',
  post_id: 'post-1',
  campaign_id: 'camp-1',
  revision: 1,
  generation_kind: 'initial',
  format: 'single',
  payload: { format: 'single', body: 'Original content', imageBrief: null },
  rendered_content: 'Original content',
  schema_version: AI_ORIGINAL_SCHEMA_VERSION,
}

describe('AI_ORIGINAL_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(AI_ORIGINAL_SCHEMA_VERSION).toBe(1)
  })
})

describe('createPostAiOriginal', () => {
  it('inserts and returns the created row', async () => {
    const { client, builder } = createMockClient(mockRow)
    const result = await createPostAiOriginal(client, insertPayload)
    expect(result).toEqual(mockRow)
    expect(client.from).toHaveBeenCalledWith('post_ai_originals')
    expect(builder.insert).toHaveBeenCalledWith(insertPayload)
  })

  it('throws on error', async () => {
    const { client } = createMockClient(null, { message: 'insert failed' })
    await expect(createPostAiOriginal(client, insertPayload)).rejects.toThrow('insert failed')
  })
})

describe('getLatestRevision', () => {
  it('returns the latest revision number when a snapshot exists', async () => {
    const { client, builder } = createMockClient({ revision: 3 })
    const result = await getLatestRevision(client, 'post-1')
    expect(result).toBe(3)
    expect(client.from).toHaveBeenCalledWith('post_ai_originals')
    expect(builder.eq).toHaveBeenCalledWith('post_id', 'post-1')
    expect(builder.order).toHaveBeenCalledWith('revision', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(1)
  })

  it('returns 0 when no snapshot exists yet ([db-MAJOR-1] snapshot-less posts)', async () => {
    const { client } = createMockClient(null, null)
    const result = await getLatestRevision(client, 'post-1')
    expect(result).toBe(0)
  })

  it('throws on error', async () => {
    const { client } = createMockClient(null, { message: 'query failed' })
    await expect(getLatestRevision(client, 'post-1')).rejects.toThrow('query failed')
  })
})

describe('createNextPostAiOriginalRevision', () => {
  const { revision: _revision, ...insertWithoutRevision } = insertPayload
  void _revision

  it('writes revision = latest + 1', async () => {
    const { client } = createSequentialMockClient([
      { data: { revision: 1 }, error: null }, // getLatestRevision
      { data: { ...mockRow, revision: 2 }, error: null }, // insert
    ])
    const result = await createNextPostAiOriginalRevision(client, {
      ...insertWithoutRevision,
      generation_kind: 'regeneration',
    })
    expect(result.revision).toBe(2)
  })

  it('[db-MINOR-1] retries once on a 23505 collision and succeeds, without surfacing an error', async () => {
    const { client } = createSequentialMockClient([
      { data: { revision: 1 }, error: null }, // getLatestRevision, attempt 1
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert, attempt 1 — loses the race
      { data: { revision: 2 }, error: null }, // getLatestRevision, attempt 2 — sees the winner's row
      { data: { ...mockRow, revision: 3 }, error: null }, // insert, attempt 2 — succeeds
    ])
    const result = await createNextPostAiOriginalRevision(client, {
      ...insertWithoutRevision,
      generation_kind: 'regeneration',
    })
    expect(result.revision).toBe(3)
  })

  it('surfaces a non-23505 error immediately, without retrying', async () => {
    const { client } = createSequentialMockClient([
      { data: { revision: 1 }, error: null }, // getLatestRevision
      { data: null, error: { code: '23503', message: 'foreign key violation' } }, // insert
    ])
    await expect(
      createNextPostAiOriginalRevision(client, {
        ...insertWithoutRevision,
        generation_kind: 'regeneration',
      }),
    ).rejects.toThrow('foreign key violation')
  })
})
