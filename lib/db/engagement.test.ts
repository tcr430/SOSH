import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  listEngagementItems,
  createEngagementItem,
  updateEngagementItem,
} from './engagement'
import type { EngagementInboxRow, EngagementInboxInsert } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const mockItem: EngagementInboxRow = {
  id: 'ei-1',
  business_id: 'biz-1',
  post_id: 'post-1',
  platform: 'linkedin',
  type: 'comment',
  platform_item_id: 'lnk-comment-1',
  author_username: 'john_doe',
  author_display_name: 'John Doe',
  content: 'Great post!',
  received_at: '2026-04-30T10:00:00Z',
  sentiment: 'positive',
  ai_draft_reply: null,
  status: 'pending',
  replied_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('listEngagementItems', () => {
  it('returns list of engagement items', async () => {
    const { client } = createMockClient([mockItem])
    const result = await listEngagementItems(client, 'biz-1')
    expect(result).toEqual([mockItem])
    expect(client.from).toHaveBeenCalledWith('engagement_inbox')
  })

  it('filters by status when provided', async () => {
    const { client, builder } = createMockClient([mockItem])
    await listEngagementItems(client, 'biz-1', 'pending')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('applies limit and offset', async () => {
    const { client, builder } = createMockClient([mockItem])
    await listEngagementItems(client, 'biz-1', undefined, 25, 50)
    expect(builder.limit).toHaveBeenCalledWith(25)
    expect(builder.range).toHaveBeenCalledWith(50, 74)
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listEngagementItems(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listEngagementItems(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('createEngagementItem', () => {
  const insertData: EngagementInboxInsert = {
    business_id: 'biz-1',
    platform: 'linkedin',
    type: 'comment',
    platform_item_id: 'lnk-comment-1',
    author_username: 'john_doe',
    content: 'Great post!',
    received_at: '2026-04-30T10:00:00Z',
  }

  it('returns the created engagement item', async () => {
    const { client } = createMockClient(mockItem)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await createEngagementItem(insertData)
    expect(result).toEqual(mockItem)
    expect(client.from).toHaveBeenCalledWith('engagement_inbox')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(createEngagementItem(insertData)).rejects.toThrow('Insert error')
  })
})

describe('updateEngagementItem', () => {
  it('returns the updated engagement item', async () => {
    const { client } = createMockClient(mockItem)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await updateEngagementItem('ei-1', { status: 'replied' })
    expect(result).toEqual(mockItem)
    expect(client.from).toHaveBeenCalledWith('engagement_inbox')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(updateEngagementItem('ei-1', { status: 'replied' })).rejects.toThrow('Update error')
  })
})
