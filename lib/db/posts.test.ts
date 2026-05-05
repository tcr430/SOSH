import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  listPostsByCampaign,
  getPostById,
  createPosts,
  updatePost,
  approvePost,
  schedulePost,
  markPostFailed,
  skipPost,
  listPostsDue,
} from './posts'
import type { PostRow, PostInsert } from './types'

const mockPost: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  content: 'Hello world',
  hashtags: ['#AI'],
  media_urls: [],
  scheduled_at: '2026-05-01T10:00:00Z',
  published_at: null,
  platform_post_id: null,
  status: 'approved',
  rejection_note: null,
  ai_generation_metadata: {},
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('listPostsByCampaign', () => {
  it('returns list of posts', async () => {
    const { client } = createMockClient([mockPost])
    const result = await listPostsByCampaign(client, 'camp-1')
    expect(result).toEqual([mockPost])
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listPostsByCampaign(client, 'camp-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listPostsByCampaign(client, 'camp-1')).rejects.toThrow('DB error')
  })
})

describe('getPostById', () => {
  it('returns a post when found', async () => {
    const { client } = createMockClient(mockPost)
    const result = await getPostById(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getPostById(client, 'post-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getPostById(client, 'missing')).rejects.toThrow()
  })
})

describe('createPosts', () => {
  const insertData: PostInsert[] = [
    {
      campaign_id: 'camp-1',
      business_id: 'biz-1',
      platform: 'linkedin',
      content: 'Hello world',
      scheduled_at: '2026-05-01T10:00:00Z',
    },
  ]

  it('returns the created posts', async () => {
    const { client } = createMockClient([mockPost])
    const result = await createPosts(client, insertData)
    expect(result).toEqual([mockPost])
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('returns empty array when data is null', async () => {
    const { client } = createMockClient(null, null)
    const result = await createPosts(client, insertData)
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    await expect(createPosts(client, insertData)).rejects.toThrow('Insert error')
  })
})

describe('updatePost', () => {
  it('returns the updated post', async () => {
    const { client } = createMockClient(mockPost)
    // mockPost.status = 'approved'; valid transition: approved → scheduled
    const result = await updatePost(client, 'post-1', { status: 'scheduled' })
    expect(result).toEqual(mockPost)
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('rejects invalid status transition', async () => {
    const { client } = createMockClient(mockPost)
    // approved → published is not a direct transition
    await expect(updatePost(client, 'post-1', { status: 'published' })).rejects.toThrow(
      'Invalid status transition: approved → published',
    )
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(updatePost(client, 'post-1', { status: 'scheduled' })).rejects.toThrow('Update error')
  })
})

describe('approvePost', () => {
  it('returns the approved post when currently draft', async () => {
    const { client, builder } = createMockClient(mockPost)
    const result = await approvePost(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('throws when post not found or wrong status', async () => {
    const { client } = createMockClient(null, null)
    await expect(approvePost(client, 'post-1')).rejects.toThrow("not found or not in 'draft' status")
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(approvePost(client, 'post-1')).rejects.toThrow('Update error')
  })
})

describe('schedulePost', () => {
  it('returns the scheduled post when currently approved', async () => {
    const { client, builder } = createMockClient(mockPost)
    const result = await schedulePost(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(builder.eq).toHaveBeenCalledWith('status', 'approved')
  })

  it('throws when post not found or wrong status', async () => {
    const { client } = createMockClient(null, null)
    await expect(schedulePost(client, 'post-1')).rejects.toThrow("not found or not in 'approved' status")
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(schedulePost(client, 'post-1')).rejects.toThrow('Update error')
  })
})

describe('markPostFailed', () => {
  it('returns the failed post when currently scheduled', async () => {
    const { client, builder } = createMockClient(mockPost)
    const result = await markPostFailed(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(builder.eq).toHaveBeenCalledWith('status', 'scheduled')
  })

  it('throws when post not found or wrong status', async () => {
    const { client } = createMockClient(null, null)
    await expect(markPostFailed(client, 'post-1')).rejects.toThrow("not found or not in 'scheduled' status")
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(markPostFailed(client, 'post-1')).rejects.toThrow('Update error')
  })
})

describe('skipPost', () => {
  it('returns the skipped post when in a skippable status', async () => {
    const { client, builder } = createMockClient(mockPost)
    const result = await skipPost(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(builder.in).toHaveBeenCalledWith('status', ['draft', 'approved', 'scheduled'])
  })

  it('throws when post not found or in terminal status', async () => {
    const { client } = createMockClient(null, null)
    await expect(skipPost(client, 'post-1')).rejects.toThrow('not in a skippable status')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(skipPost(client, 'post-1')).rejects.toThrow('Update error')
  })
})

describe('listPostsDue', () => {
  it('returns list of due posts', async () => {
    const { client } = createMockClient([mockPost])
    const result = await listPostsDue(client)
    expect(result).toEqual([mockPost])
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('returns empty array when none due', async () => {
    const { client } = createMockClient(null, null)
    const result = await listPostsDue(client)
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listPostsDue(client)).rejects.toThrow('DB error')
  })
})
