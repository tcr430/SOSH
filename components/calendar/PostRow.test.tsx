// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/(dashboard)/calendar/actions', () => ({
  approvePostFromCalendarAction: vi.fn().mockResolvedValue({ ok: true }),
  updatePostFromCalendarAction: vi.fn().mockResolvedValue({ ok: true }),
  reschedulePostAction: vi.fn().mockResolvedValue({ ok: true }),
}))

// formatInTimeZone fixed to return a known "today" date so getTomorrowKeyInBizTz
// is deterministic — avoids real-clock dependence in CI.
vi.mock('date-fns-tz', () => ({
  formatInTimeZone: () => '2026-06-29',
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  PostRow,
  formatMetricValue,
  getTomorrowKeyInBizTz,
} from '@/components/calendar/PostRow'
import type { CalendarPostRow } from '@/lib/calendar/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<CalendarPostRow> = {}): CalendarPostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaign_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    campaign_name: 'Test Campaign',
    platform: 'instagram',
    status: 'draft',
    content: 'Test post content',
    hashtags: ['test', 'sosh'],
    scheduled_at: '2026-07-01T10:00:00Z',
    published_at: null,
    platform_post_id: null,
    metrics: null,
    ...overrides,
  }
}

function renderRow(post: CalendarPostRow, tz = 'UTC') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(PostRow, { post, tz }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

// ── Unit tests — pure helpers ─────────────────────────────────────────────────

describe('formatMetricValue', () => {
  it('returns "—" for null (not reported)', () => {
    expect(formatMetricValue(null)).toBe('—')
  })

  it('returns "0" for real zero engagement', () => {
    expect(formatMetricValue(0)).toBe('0')
  })

  it('returns the number as string for positive values', () => {
    expect(formatMetricValue(42)).toBe('42')
  })
})

describe('getTomorrowKeyInBizTz (formatInTimeZone mocked → today = 2026-06-29)', () => {
  it('returns the next calendar day in business timezone', () => {
    expect(getTomorrowKeyInBizTz('Europe/Lisbon')).toBe('2026-06-30')
  })
})

// ── Render tests — Approve button (CAL-5) ────────────────────────────────────

describe('PostRow — Approve button', () => {
  it('shows Approve button for status=draft', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'draft' }))
    expect(container.querySelector('[aria-label="post.approve"]')).not.toBeNull()
    cleanup()
  })

  it('does NOT show Approve button for status=approved', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'approved' }))
    expect(container.querySelector('[aria-label="post.approve"]')).toBeNull()
    cleanup()
  })

  it('does NOT show Approve button for status=published', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'published' }))
    expect(container.querySelector('[aria-label="post.approve"]')).toBeNull()
    cleanup()
  })

  it('does NOT show Approve button for status=scheduled', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'scheduled' }))
    expect(container.querySelector('[aria-label="post.approve"]')).toBeNull()
    cleanup()
  })
})

// ── Render tests — Edit button (CAL-6 / R2) ───────────────────────────────────

describe('PostRow — Edit button', () => {
  it('shows Edit button for status=draft', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'draft' }))
    expect(container.querySelector('[aria-label="post.edit"]')).not.toBeNull()
    cleanup()
  })

  it('shows Edit button for status=approved (revert-first happens in action)', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'approved' }))
    expect(container.querySelector('[aria-label="post.edit"]')).not.toBeNull()
    cleanup()
  })

  it('does NOT show Edit button for status=published', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'published' }))
    expect(container.querySelector('[aria-label="post.edit"]')).toBeNull()
    cleanup()
  })

  it('does NOT show Edit button for status=scheduled', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'scheduled' }))
    expect(container.querySelector('[aria-label="post.edit"]')).toBeNull()
    cleanup()
  })

  it('does NOT show Edit button for status=failed (MINOR-4 — updatePostContent silently no-ops)', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'failed' }))
    expect(container.querySelector('[aria-label="post.edit"]')).toBeNull()
    cleanup()
  })

  it('does NOT show Edit button for status=skipped (MINOR-4 — updatePostContent silently no-ops)', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'skipped' }))
    expect(container.querySelector('[aria-label="post.edit"]')).toBeNull()
    cleanup()
  })
})

// ── Render tests — "move to…" date picker (R6 / R10) ─────────────────────────

describe('PostRow — move-to date picker', () => {
  it('sets min attribute to tomorrow in business tz (mocked today = 2026-06-29)', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'draft' }), 'Europe/Lisbon')
    const input = container.querySelector('input[type="date"]')
    expect(input).not.toBeNull()
    expect(input?.getAttribute('min')).toBe('2026-06-30')
    cleanup()
  })

  it('does NOT render date picker for published posts', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'published' }))
    expect(container.querySelector('input[type="date"]')).toBeNull()
    cleanup()
  })

  it('does NOT render date picker for scheduled posts', () => {
    const { container, cleanup } = renderRow(makePost({ status: 'scheduled' }))
    expect(container.querySelector('input[type="date"]')).toBeNull()
    cleanup()
  })
})

// ── Render tests — "View on platform" link (R5) ───────────────────────────────

describe('PostRow — View on platform link', () => {
  it('shows a link for twitter + platform_post_id (derivable URL)', () => {
    const { container, cleanup } = renderRow(makePost({
      status: 'published',
      platform: 'twitter',
      platform_post_id: '123456789',
    }))
    const link = container.querySelector('a[href]')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toContain('123456789')
    cleanup()
  })

  it('does NOT show link for instagram (URL not derivable without username)', () => {
    const { container, cleanup } = renderRow(makePost({
      status: 'published',
      platform: 'instagram',
      platform_post_id: 'some-post-id',
    }))
    expect(container.querySelector('a[href]')).toBeNull()
    cleanup()
  })

  it('does NOT show link for twitter without platform_post_id', () => {
    const { container, cleanup } = renderRow(makePost({
      status: 'published',
      platform: 'twitter',
      platform_post_id: null,
    }))
    expect(container.querySelector('a[href]')).toBeNull()
    cleanup()
  })

  it('does NOT show link for non-published post even if platform_post_id exists', () => {
    const { container, cleanup } = renderRow(makePost({
      status: 'draft',
      platform: 'twitter',
      platform_post_id: '123456789',
    }))
    expect(container.querySelector('a[href]')).toBeNull()
    cleanup()
  })
})
