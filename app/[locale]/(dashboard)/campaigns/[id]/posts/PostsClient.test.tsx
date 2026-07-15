// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

const bulkApprovePostsAction = vi.fn().mockResolvedValue({ success: true, count: 0 })

vi.mock('@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions', () => ({
  bulkApprovePostsAction: (...args: unknown[]) => bulkApprovePostsAction(...args),
}))

vi.mock('@/lib/members/useCan', () => ({ useCan: vi.fn(() => true) }))

vi.mock('@/components/posts/PostCard', () => ({
  PostCard: ({ post }: { post: { id: string; status: string; platform: string } }) =>
    React.createElement('div', { 'data-testid': `post-${post.id}`, 'data-status': post.status }, post.platform),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { PostsClient } from './PostsClient'
import type { PostRow, CampaignRow } from '@/lib/db/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CAMPAIGN: CampaignRow = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  business_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Launch Campaign',
  objective: 'Grow awareness',
  special_instructions: null,
  platforms: ['linkedin', 'twitter'],
  frequency: 'weekly',
  posts_per_week: 3,
  start_date: '2026-07-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 10,
  total_posts_published: 0,
  voice_variation_id: null,
  deleted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function makePost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaign_id: CAMPAIGN.id,
    business_id: CAMPAIGN.business_id,
    platform: 'linkedin',
    content: 'Draft content',
    hashtags: [],
    media_urls: [],
    scheduled_at: '2026-07-01T10:00:00Z',
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    status: 'draft',
    rejection_note: null,
    ai_generation_metadata: {},
    publish_attempts: 0,
    last_publish_attempt_at: null,
    last_publish_error: null,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function renderClient(posts: PostRow[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(PostsClient, { posts, campaign: CAMPAIGN, locale: 'en' }),
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function bulkButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('bulkApprove'))
}

beforeEach(() => {
  vi.clearAllMocks()
  bulkApprovePostsAction.mockResolvedValue({ success: true, count: 0 })
})

// ── BLOCKER-1: bulk approve respects the active platform filter ────────────────

describe('PostsClient — bulk approve respects the active platform filter (BLOCKER-1)', () => {
  it('THE 21C M1 SCENARIO: 3 linkedin + 2 twitter drafts, filter=X calls bulkApprovePostsAction with exactly the 2 rendered X ids', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', platform: 'twitter' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderClient(posts)

    const twitterPill = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Twitter')
    act(() => { twitterPill?.click() })

    act(() => { bulkButton(container)?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(CAMPAIGN.id, [posts[3].id, posts[4].id])
    cleanup()
  })
})

// ── BLOCKER-2: bulk approve never reaches drafts outside the rendered window ──

describe('PostsClient — bulk approve stays inside the rendered window (BLOCKER-2)', () => {
  it('a truncated 5-post window approves exactly those 5 ids — never an id it was not given', () => {
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePost({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${i}0` }),
    )
    const { container, cleanup } = renderClient(posts)

    act(() => { bulkButton(container)?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(CAMPAIGN.id, posts.map(p => p.id))
    const [, calledIds] = vi.mocked(bulkApprovePostsAction).mock.calls[0] as [string, string[]]
    expect(calledIds).toHaveLength(5)
    cleanup()
  })
})

// ── Regression: unfiltered bulk over a fully-rendered small campaign ──────────

describe('PostsClient — regression: unfiltered bulk over a fully-rendered campaign', () => {
  it('still approves all rendered drafts when no filter is active', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' }),
    ]
    const { container, cleanup } = renderClient(posts)

    act(() => { bulkButton(container)?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(CAMPAIGN.id, posts.map(p => p.id))
    cleanup()
  })

  it('does not render a bulk approve control when there are no drafts', () => {
    const posts = [makePost({ status: 'approved' })]
    const { container, cleanup } = renderClient(posts)

    expect(bulkButton(container)).toBeUndefined()
    cleanup()
  })
})
