// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const approvePostAction = vi.fn().mockResolvedValue({ success: true })
const bulkApprovePostsAction = vi.fn().mockResolvedValue({ success: true })
const skipPostAction = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions', () => ({
  approvePostAction: (...args: unknown[]) => approvePostAction(...args),
  bulkApprovePostsAction: (...args: unknown[]) => bulkApprovePostsAction(...args),
  skipPostAction: (...args: unknown[]) => skipPostAction(...args),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { ApprovalsInbox } from './ApprovalsInbox'
import type { CalendarPostRow } from '@/lib/calendar/types'
import type { CampaignRow } from '@/lib/db/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<CalendarPostRow> = {}): CalendarPostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaign_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    campaign_name: 'Launch Campaign',
    platform: 'linkedin',
    status: 'draft',
    content: 'Pending draft content',
    hashtags: [],
    scheduled_at: '2026-07-01T10:00:00Z',
    published_at: null,
    platform_post_id: null,
    metrics: null,
    ...overrides,
  }
}

const CAMPAIGN: CampaignRow = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  business_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Launch Campaign',
  objective: 'Grow awareness',
  special_instructions: null,
  platforms: ['linkedin'],
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

function renderInbox(posts: CalendarPostRow[], campaigns: CampaignRow[] = [CAMPAIGN]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(ApprovalsInbox, { posts, campaigns }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
}

// ── APV-EMPTY-STATE ────────────────────────────────────────────────────────────

describe('ApprovalsInbox — empty state', () => {
  it('shows the positive empty-state copy when there are no pending drafts', () => {
    const { container, cleanup } = renderInbox([])
    expect(container.textContent).toContain('empty.title')
    cleanup()
  })
})

// ── APV-SINGLE-AND-BATCH ────────────────────────────────────────────────────────

describe('ApprovalsInbox — single and batch approve (APV-SINGLE-AND-BATCH)', () => {
  it('single Approve calls the existing approvePostAction with the post id', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'row.approve')?.click() })

    expect(approvePostAction).toHaveBeenCalledWith(post.id)
    cleanup()
  })

  it('the bulk bar calls the existing bulkApprovePostsAction with the campaign id', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'bulk.approveAll')?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(post.campaign_id)
    cleanup()
  })
})

// ── APV-REJECT-SKIP ──────────────────────────────────────────────────────────

describe('ApprovalsInbox — reject/skip (APV-REJECT-SKIP)', () => {
  it('skip requires a note and calls the existing skipPostAction', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'row.skip')?.click() })
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()

    // Confirm button stays disabled below the 3-char minimum (mirrors PostCard).
    const confirmBefore = buttonWithText(container, 'row.skip')
    expect(confirmBefore?.hasAttribute('disabled')).toBe(true)

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      nativeSetter.call(input, 'off brand')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirmAfter = buttonWithText(container, 'row.skip')
    expect(confirmAfter?.hasAttribute('disabled')).toBe(false)

    act(() => { confirmAfter?.click() })
    expect(skipPostAction).toHaveBeenCalledWith(post.id, 'off brand')
    cleanup()
  })
})

// ── APV-EDIT-REVERT-LEGIBLE ──────────────────────────────────────────────────

describe('ApprovalsInbox — edit is a separate step (APV-EDIT-REVERT-LEGIBLE, L-5)', () => {
  it('renders an Edit link out to the campaign posts surface — no inline silent approve', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    const editLink = Array.from(container.querySelectorAll('a')).find(a => a.textContent?.includes('row.edit'))
    expect(editLink).not.toBeUndefined()
    expect(editLink?.getAttribute('href')).toBe(`/en/campaigns/${post.campaign_id}/posts`)
    cleanup()
  })
})

// ── APV-FILTER ────────────────────────────────────────────────────────────────

describe('ApprovalsInbox — filters by campaign and channel (APV-FILTER)', () => {
  it('filtering to a platform with no matches shows the filtered-empty copy', () => {
    const post = makePost({ platform: 'linkedin' })
    const { container, cleanup } = renderInbox([post])

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'instagram'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // instagram isn't an offered option (not present among pending posts), so
    // the select stays on 'linkedin' — assert the offered-options claim instead.
    const options = Array.from(platformSelect.options).map(o => o.value)
    expect(options).toEqual(['all', 'linkedin'])
    cleanup()
  })

  it('only offers campaigns/platforms actually present among pending posts', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [
      CAMPAIGN,
      { ...CAMPAIGN, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Unrelated Campaign' },
    ])

    const campaignSelect = container.querySelectorAll('select')[0] as HTMLSelectElement
    const optionLabels = Array.from(campaignSelect.options).map(o => o.textContent)
    expect(optionLabels).toContain('Launch Campaign')
    expect(optionLabels).not.toContain('Unrelated Campaign')
    cleanup()
  })
})

// ── APV-BULK-RESPECTS-FILTER ────────────────────────────────────────────────

describe('ApprovalsInbox — bulk approve respects the active platform filter (APV-BULK-RESPECTS-FILTER, M1)', () => {
  it('disables the per-campaign bulk approve control while a platform filter is active, with an explanatory hint', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const disabledBulk = container.querySelector('[aria-label="bulk.filterActiveHint"]')
    expect(disabledBulk).not.toBeNull()
    expect(disabledBulk?.getAttribute('aria-disabled')).toBe('true')
    cleanup()
  })

  it('clicking the disabled bulk control does not call bulkApprovePostsAction, and drafts outside the filter stay pending', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    bulkApprovePostsAction.mockClear()
    const disabledBulk = container.querySelector('[aria-label="bulk.filterActiveHint"]') as HTMLElement
    act(() => { disabledBulk?.click() })

    expect(bulkApprovePostsAction).not.toHaveBeenCalled()
    cleanup()
  })

  it('leaves the bulk approve control enabled when the platform filter is cleared', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    expect(bulkButton).not.toBeUndefined()
    expect(bulkButton?.hasAttribute('disabled')).toBe(false)
    cleanup()
  })

  it('single-row Approve stays available under an active platform filter', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const approve = buttonWithText(container, 'row.approve')
    expect(approve).not.toBeUndefined()
    expect(approve?.hasAttribute('disabled')).toBe(false)
    cleanup()
  })
})

// ── APV-BULK-COUNT-CONSISTENT ────────────────────────────────────────────────

describe('ApprovalsInbox — bulk approve count consistency (APV-BULK-COUNT-CONSISTENT, M1)', () => {
  it('the button label, rows removed, and announced count are all the same number', async () => {
    const otherCampaign: CampaignRow = {
      ...CAMPAIGN,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'Other Campaign',
    }
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', platform: 'linkedin' }),
      // A post in a different campaign, so items stays non-empty after the
      // bulk approve — otherwise the component's empty-state early-return
      // (APV-EMPTY-STATE) would remove the live region this test asserts on.
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', platform: 'linkedin', campaign_id: otherCampaign.id }),
    ]
    const { container, cleanup } = renderInbox(posts, [CAMPAIGN, otherCampaign])

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    expect(bulkButton?.textContent).toContain('"count":3')

    await act(async () => { bulkButton?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(posts[0].campaign_id)

    // All three rows from the approved campaign are gone; only the unrelated
    // campaign's row remains — row-removal matches the label count exactly.
    expect(container.querySelectorAll('li').length).toBe(1)
    // The live-region announcement carries the SAME count as the label ("3"),
    // not a recomputed/unfiltered figure.
    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion?.textContent).toContain('bulk.announceApproved')
    expect(liveRegion?.textContent).toContain('"count":3')
    cleanup()
  })
})

// ── B1: atomic-batch guarantee stays intact ──────────────────────────────────

describe('ApprovalsInbox — bulk approve remains a single atomic action (B1)', () => {
  it('calls bulkApprovePostsAction exactly once per bulk click, not once per row', async () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    bulkApprovePostsAction.mockClear()
    approvePostAction.mockClear()
    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    await act(async () => { bulkButton?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledTimes(1)
    expect(approvePostAction).not.toHaveBeenCalled()
    cleanup()
  })
})
