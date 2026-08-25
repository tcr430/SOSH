import { describe, it, expect, vi } from 'vitest'
import { createMockClient, createSequentialMockClient } from './__test-utils__/mock-client'
import {
  listPostsByCampaign,
  getPostById,
  createPosts,
  updatePost,
  approvePost,
  schedulePost,
  markPostFailed,
  skipPost,
  skipScheduledPost,
  listPostsDue,
  unapprovePost,
  unskipPost,
  updatePostContent,
  bulkApproveDraftPosts,
  getPostSiblingTopics,
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
  platform_url: null,
  status: 'approved',
  role: null,
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
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
    expect(result).toEqual({ outcome: 'approved', post: mockPost })
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
  })

  // ADR 0022 §2.5 (Session 29-D, MAJOR-4) — the atomic guard: when no
  // replacement time is supplied, the existing scheduled_at must itself be
  // in the future for the UPDATE to match any row.
  it('adds a scheduled_at > now guard when newScheduledAt is not supplied', async () => {
    const { client, builder } = createMockClient(mockPost)
    await approvePost(client, 'post-1')
    expect(builder.gt).toHaveBeenCalledWith('scheduled_at', expect.any(String))
  })

  it('does not add the scheduled_at > now guard when newScheduledAt is supplied — the write sets it instead', async () => {
    const { client, builder } = createMockClient(mockPost)
    await approvePost(client, 'post-1', undefined, '2099-01-01T09:00:00.000Z')
    expect(builder.gt).not.toHaveBeenCalled()
    expect(builder.update).toHaveBeenCalledWith({ status: 'approved', scheduled_at: '2099-01-01T09:00:00.000Z' })
  })

  it('returns schedule_expired without any DB call when newScheduledAt is itself in the past', async () => {
    const { client, from } = createMockClient(mockPost)
    const result = await approvePost(client, 'post-1', undefined, '2020-01-01T00:00:00.000Z')
    expect(result).toEqual({ outcome: 'schedule_expired' })
    expect(from).not.toHaveBeenCalled()
  })

  // database-reviewer (Session 29-D, MAJOR-4 review) — a STRING comparison
  // of ISO-8601 timestamps is wrong when fractional-second precision
  // differs: '2026-...:00Z' <= '2026-...:00.500Z' is FALSE under ASCII
  // comparison ('Z' sorts after '.') even though the left side names the
  // earlier instant. This pins the fix as a numeric instant comparison.
  it('classifies newScheduledAt as expired via instant comparison, not string comparison, across fractional-second precision', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T22:35:00.500Z'))
    try {
      const { client, from } = createMockClient(mockPost)
      // No milliseconds — lexicographically this STRING sorts before the
      // fake "now" above only by coincidence of the 'Z' vs '.' bytes; as an
      // instant it is the SAME second and must read as already past/at now.
      const result = await approvePost(client, 'post-1', undefined, '2026-08-23T22:35:00Z')
      expect(result).toEqual({ outcome: 'schedule_expired' })
      expect(from).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns not_eligible when the atomic UPDATE matches no row and the diagnostic read finds no draft', async () => {
    // Sequential: [0] the atomic UPDATE (no match), [1] the diagnostic SELECT (no such row).
    const { client } = createSequentialMockClient([
      { data: null, error: null },
      { data: null, error: null },
    ])
    const result = await approvePost(client, 'post-1')
    expect(result).toEqual({ outcome: 'not_eligible' })
  })

  it('returns schedule_expired when the atomic UPDATE matches no row but the diagnostic read finds a draft (schedule already passed)', async () => {
    // Sequential: [0] the atomic UPDATE (no match — scheduled_at > now failed),
    // [1] the diagnostic SELECT (status IS draft — so the schedule was the reason).
    const { client } = createSequentialMockClient([
      { data: null, error: null },
      { data: { status: 'draft', scheduled_at: '2020-01-01T00:00:00.000Z' }, error: null },
    ])
    const result = await approvePost(client, 'post-1')
    expect(result).toEqual({ outcome: 'schedule_expired' })
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(approvePost(client, 'post-1')).rejects.toThrow('Update error')
  })

  // MINOR-2: optional belt-and-suspenders business_id predicate, matching reschedulePost.
  it('adds a business_id predicate when businessId is provided', async () => {
    const { client, builder } = createMockClient(mockPost)
    await approvePost(client, 'post-1', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })

  it('does not add a business_id predicate when businessId is omitted (existing callers unaffected)', async () => {
    const { client, builder } = createMockClient(mockPost)
    await approvePost(client, 'post-1')
    expect(builder.eq).not.toHaveBeenCalledWith('business_id', expect.anything())
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
    const failedPost = { ...mockPost, status: 'failed' as const }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 0 }, error: null })
      .mockResolvedValueOnce({ data: failedPost, error: null })
    const result = await markPostFailed(client, 'post-1', { errorCode: 'UNKNOWN', errorDetails: {} })
    expect(result).toEqual(failedPost)
    expect(builder.eq).toHaveBeenCalledWith('status', 'scheduled')
  })

  it('throws when post not found or wrong status', async () => {
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: null })
    await expect(markPostFailed(client, 'post-1', { errorCode: 'UNKNOWN', errorDetails: {} })).rejects.toThrow("not found or not in 'scheduled' status")
  })

  it('throws when supabase returns an error on read', async () => {
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: { message: 'Update error' } })
    await expect(markPostFailed(client, 'post-1', { errorCode: 'UNKNOWN', errorDetails: {} })).rejects.toThrow('Update error')
  })
})

describe('skipScheduledPost', () => {
  it('returns the skipped post when in a skippable status', async () => {
    const { client, builder } = createMockClient(mockPost)
    const result = await skipScheduledPost(client, 'post-1')
    expect(result).toEqual(mockPost)
    expect(builder.in).toHaveBeenCalledWith('status', ['draft', 'approved', 'scheduled'])
  })

  it('throws when post not found or in terminal status', async () => {
    const { client } = createMockClient(null, null)
    await expect(skipScheduledPost(client, 'post-1')).rejects.toThrow('not in a skippable status')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(skipScheduledPost(client, 'post-1')).rejects.toThrow('Update error')
  })
})

describe('skipPost', () => {
  it('returns skipped row with rejection_note', async () => {
    const skipped = { ...mockPost, status: 'skipped' as const, rejection_note: 'off topic' }
    const { client, builder } = createMockClient(skipped)
    const result = await skipPost(client, 'post-1', 'off topic')
    expect(result.status).toBe('skipped')
    expect(result.rejection_note).toBe('off topic')
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('throws when post not found or not in draft', async () => {
    const { client } = createMockClient(null, null)
    await expect(skipPost(client, 'post-1', 'too long')).rejects.toThrow("not found or not in 'draft' status")
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'constraint violation' })
    await expect(skipPost(client, 'post-1', 'bad')).rejects.toThrow('constraint violation')
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

describe('unapprovePost', () => {
  it('returns draft row on success', async () => {
    const draft = { ...mockPost, status: 'draft' as const }
    const { client, builder } = createMockClient(draft)
    const result = await unapprovePost(client, 'post-1')
    expect(result.status).toBe('draft')
    expect(builder.eq).toHaveBeenCalledWith('status', 'approved')
  })

  it('throws when post not found or not approved', async () => {
    const { client } = createMockClient(null, null)
    await expect(unapprovePost(client, 'post-1')).rejects.toThrow("not found or not in 'approved' status")
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'rls denied' })
    await expect(unapprovePost(client, 'post-1')).rejects.toThrow('rls denied')
  })
})

describe('unskipPost', () => {
  it('returns draft row with null rejection_note', async () => {
    const restored = { ...mockPost, status: 'draft' as const, rejection_note: null }
    const { client, builder } = createMockClient(restored)
    const result = await unskipPost(client, 'post-1')
    expect(result.status).toBe('draft')
    expect(result.rejection_note).toBeNull()
    expect(builder.eq).toHaveBeenCalledWith('status', 'skipped')
  })

  it('throws when post not found or not skipped', async () => {
    const { client } = createMockClient(null, null)
    await expect(unskipPost(client, 'post-1')).rejects.toThrow("not found or not in 'skipped' status")
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'network error' })
    await expect(unskipPost(client, 'post-1')).rejects.toThrow('network error')
  })
})

describe('updatePostContent', () => {
  it('returns updated row with new content and hashtags', async () => {
    const updated = { ...mockPost, content: 'New content', hashtags: ['#b2b', '#saas'] }
    const { client, builder } = createMockClient(updated)
    const result = await updatePostContent(client, 'post-1', { content: 'New content', hashtags: ['#b2b', '#saas'] })
    expect(result.content).toBe('New content')
    expect(result.hashtags).toEqual(['#b2b', '#saas'])
    expect(builder.in).toHaveBeenCalledWith('status', ['draft', 'approved'])
  })

  it('throws when post is in a non-editable status (published/skipped/null)', async () => {
    const { client } = createMockClient(null, null)
    await expect(
      updatePostContent(client, 'post-1', { content: 'x', hashtags: [] }),
    ).rejects.toThrow('not in an editable status')
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'column missing' })
    await expect(
      updatePostContent(client, 'post-1', { content: 'x', hashtags: [] }),
    ).rejects.toThrow('column missing')
  })
})

describe('bulkApproveDraftPosts', () => {
  it('returns the count of approved posts (3)', async () => {
    const { client } = createMockClient([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    const count = await bulkApproveDraftPosts(client, 'camp-1', ['p1', 'p2', 'p3'], 'biz-1')
    expect(count).toBe(3)
  })

  it('returns the count of approved posts (1)', async () => {
    const { client } = createMockClient([{ id: 'p1' }])
    const count = await bulkApproveDraftPosts(client, 'camp-1', ['p1'], 'biz-1')
    expect(count).toBe(1)
  })

  it('returns 0 when data is null', async () => {
    const { client } = createMockClient(null, null)
    const count = await bulkApproveDraftPosts(client, 'camp-1', ['p1'], 'biz-1')
    expect(count).toBe(0)
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'permission denied' })
    await expect(bulkApproveDraftPosts(client, 'camp-1', ['p1'], 'biz-1')).rejects.toThrow('permission denied')
  })

  it('returns 0 without calling the DB when renderedIds is empty', async () => {
    const { client, from } = createMockClient([{ id: 'p1' }])
    const count = await bulkApproveDraftPosts(client, 'camp-1', [], 'biz-1')
    expect(count).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it('scopes the update with .in("id", renderedIds), .eq("campaign_id", ...) and .eq("business_id", ...) (Session 22-D)', async () => {
    const { client, builder } = createMockClient([{ id: 'p1' }, { id: 'p2' }])
    await bulkApproveDraftPosts(client, 'camp-1', ['p1', 'p2'], 'biz-1')
    expect(builder.in).toHaveBeenCalledWith('id', ['p1', 'p2'])
    expect(builder.eq).toHaveBeenCalledWith('campaign_id', 'camp-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft')
    // Soft-delete filtering is a /lib/db/ responsibility (CLAUDE.md), so the
    // clause belongs in the pinned chain like every other predicate.
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
  })
})

describe('getPostSiblingTopics', () => {
  it('returns rationale strings from sibling posts', async () => {
    const rows = [
      { ai_generation_metadata: { rationale: 'Angle: product launch' } },
      { ai_generation_metadata: { rationale: 'Angle: customer pain point' } },
    ]
    const { client, builder } = createMockClient(rows)
    const topics = await getPostSiblingTopics(client, 'camp-1', 'post-99')
    expect(topics).toEqual(['Angle: product launch', 'Angle: customer pain point'])
    expect(builder.neq).toHaveBeenCalledWith('id', 'post-99')
  })

  it('filters out rows with missing or empty rationale', async () => {
    const rows = [
      { ai_generation_metadata: { rationale: 'Angle: pricing' } },
      { ai_generation_metadata: {} },
      { ai_generation_metadata: { rationale: '' } },
      { ai_generation_metadata: null },
    ]
    const { client } = createMockClient(rows)
    const topics = await getPostSiblingTopics(client, 'camp-1', 'post-99')
    expect(topics).toEqual(['Angle: pricing'])
  })

  it('returns empty array when data is null', async () => {
    const { client } = createMockClient(null, null)
    const topics = await getPostSiblingTopics(client, 'camp-1', 'post-99')
    expect(topics).toEqual([])
  })

  it('returns empty array when no siblings exist', async () => {
    const { client } = createMockClient([])
    const topics = await getPostSiblingTopics(client, 'camp-1', 'post-99')
    expect(topics).toEqual([])
  })

  it('throws supabase error message', async () => {
    const { client } = createMockClient(null, { message: 'query failed' })
    await expect(getPostSiblingTopics(client, 'camp-1', 'post-99')).rejects.toThrow('query failed')
  })
})
