// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions', () => ({
  approvePostAction: vi.fn().mockResolvedValue({ success: true }),
  unapprovePostAction: vi.fn().mockResolvedValue({ success: true }),
  skipPostAction: vi.fn().mockResolvedValue({ success: true }),
  unskipPostAction: vi.fn().mockResolvedValue({ success: true }),
  updatePostContentAction: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/components/posts/RegenerateDialog', () => ({
  RegenerateDialog: () => null,
}))

vi.mock('@/lib/members/useCan', () => ({ useCan: vi.fn(() => true) }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { PostCard } from '@/components/posts/PostCard'
import { useCan } from '@/lib/members/useCan'
import type { Capability } from '@/lib/members/capabilities'
import type { PostRow } from '@/lib/db/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaign_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    business_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    social_account_id: null,
    platform: 'linkedin',
    content: 'Test post content',
    hashtags: [],
    media_urls: [],
    scheduled_at: '2026-07-01T10:00:00Z',
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    status: 'draft',
    role: null,
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

function renderCard(post: PostRow) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(PostCard, { post, onOptimisticUpdate: () => {} }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function mockRole(role: 'viewer' | 'editor' | 'approver') {
  const grants: Record<'viewer' | 'editor' | 'approver', Capability[]> = {
    viewer: [],
    editor: ['author', 'reschedule'],
    approver: ['author', 'reschedule', 'approve'],
  }
  vi.mocked(useCan).mockImplementation(
    (cap: Capability) => grants[role].includes(cap),
  )
}

// ── Render tests — capability-gate retrofit (ADR 0014 §6, UI-AFFORDANCE-MAP /
//    UI-APPROVE-DISABLED-EDITOR) ──────────────────────────────────────────────

describe('PostCard — capability gate: viewer (clean read-only)', () => {
  it('shows no action buttons on a draft post', () => {
    mockRole('viewer')
    const { container, cleanup } = renderCard(makePost({ status: 'draft' }))
    expect(container.querySelector('button')).toBeNull()
    cleanup()
  })
})

describe('PostCard — capability gate: editor (UI-APPROVE-DISABLED-EDITOR)', () => {
  it('shows a disabled Approve control with the "only approvers" tooltip, alongside enabled skip/edit/regenerate', () => {
    mockRole('editor')
    const { container, cleanup } = renderCard(makePost({ status: 'draft' }))
    const approve = container.querySelector('[aria-label="card.actions.approve_disabled_tooltip"]')
    expect(approve).not.toBeNull()
    expect(approve?.getAttribute('aria-disabled')).toBe('true')

    const buttonTexts = Array.from(container.querySelectorAll('button')).map(b => b.textContent)
    expect(buttonTexts.some(t => t?.includes('card.actions.skip'))).toBe(true)
    expect(buttonTexts.some(t => t?.includes('card.actions.edit'))).toBe(true)
    expect(buttonTexts.some(t => t?.includes('card.actions.regenerate'))).toBe(true)
    cleanup()
  })
})

describe('PostCard — capability gate: approver (full access)', () => {
  it('shows an enabled Approve button on a draft post', () => {
    mockRole('approver')
    const { container, cleanup } = renderCard(makePost({ status: 'draft' }))
    const buttons = Array.from(container.querySelectorAll('button'))
    const approve = buttons.find(b => b.textContent?.includes('card.actions.approve'))
    expect(approve).not.toBeUndefined()
    expect(approve?.hasAttribute('aria-disabled')).toBe(false)
    cleanup()
  })
})
