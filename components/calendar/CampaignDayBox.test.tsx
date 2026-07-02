// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocale: () => 'en',
}))

// Marks which DOM node the dnd-kit activator props land on via a distinctive
// attribute/listener pair — the real useDraggable would return keyboard/pointer
// listeners, but for this test only their placement (box vs handle) matters.
const dragHandleKeyDown = vi.fn()

vi.mock('@dnd-kit/core', () => ({
  useDraggable: vi.fn(({ disabled }: { disabled: boolean }) => ({
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    attributes: { 'data-dnd-activator': 'true' },
    listeners: disabled ? undefined : { onKeyDown: dragHandleKeyDown },
    isDragging: false,
    transform: null,
  })),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { CampaignDayBox } from '@/components/calendar/CampaignDayBox'
import type { CampaignDayCell } from '@/lib/calendar/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<CampaignDayCell> = {}): CampaignDayCell {
  return {
    campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaignName: 'Test Campaign',
    colorIndex: 0,
    dayKey: '2026-07-01',
    platforms: ['linkedin'],
    postIds: ['post-1'],
    allPublished: false,
    anyDraft: true,
    anyFailed: false,
    allMovable: true,
    allSkipped: false,
    ...overrides,
  }
}

function renderBox(cell: CampaignDayCell, onSelect = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(CampaignDayBox, { cell, onSelect, isSelected: false }),
    )
  })
  return {
    container,
    onSelect,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function pressKey(el: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => { el.dispatchEvent(event) })
}

// ── MAJOR-4: box vs handle keyboard activation ────────────────────────────────

describe('CampaignDayBox — MAJOR-4 keyboard activation split', () => {
  it('Enter on an allMovable box opens the pane (onSelect called)', () => {
    const { container, onSelect, cleanup } = renderBox(makeCell({ allMovable: true }))
    const box = container.querySelector('[role="button"]') as HTMLElement
    pressKey(box, 'Enter')
    expect(onSelect).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('Space on an allMovable box opens the pane (onSelect called)', () => {
    const { container, onSelect, cleanup } = renderBox(makeCell({ allMovable: true }))
    const box = container.querySelector('[role="button"]') as HTMLElement
    pressKey(box, ' ')
    expect(onSelect).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('Enter on the box does NOT invoke the dnd-kit drag activator', () => {
    const { container, cleanup } = renderBox(makeCell({ allMovable: true }))
    const box = container.querySelector('[role="button"]') as HTMLElement
    pressKey(box, 'Enter')
    expect(dragHandleKeyDown).not.toHaveBeenCalled()
    cleanup()
  })

  it('a dedicated drag handle button carries the dnd-kit activator props and is labelled', () => {
    const { container, cleanup } = renderBox(makeCell({ allMovable: true }))
    const handle = container.querySelector('button[data-dnd-activator="true"]')
    expect(handle).not.toBeNull()
    expect(handle?.getAttribute('aria-label')).toBe('box.drag_handle_label')
    cleanup()
  })

  it('the box itself does not carry the dnd-kit activator props', () => {
    const { container, cleanup } = renderBox(makeCell({ allMovable: true }))
    const box = container.querySelector('[role="button"]')
    expect(box?.hasAttribute('data-dnd-activator')).toBe(false)
    cleanup()
  })

  it('pressing Enter/Space on the handle activates the drag listener, not onSelect', () => {
    const { container, onSelect, cleanup } = renderBox(makeCell({ allMovable: true }))
    const handle = container.querySelector('button[data-dnd-activator="true"]') as HTMLElement
    pressKey(handle, 'Enter')
    expect(dragHandleKeyDown).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    cleanup()
  })

  it('non-movable boxes render no drag handle and still open on Enter', () => {
    const { container, onSelect, cleanup } = renderBox(makeCell({ allMovable: false }))
    expect(container.querySelector('button[data-dnd-activator="true"]')).toBeNull()
    const box = container.querySelector('[role="button"]') as HTMLElement
    pressKey(box, 'Enter')
    expect(onSelect).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('clicking the handle does not also open the pane (stopPropagation)', () => {
    const { container, onSelect, cleanup } = renderBox(makeCell({ allMovable: true }))
    const handle = container.querySelector('button[data-dnd-activator="true"]') as HTMLElement
    act(() => {
      handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onSelect).not.toHaveBeenCalled()
    cleanup()
  })
})

// ── MINOR-6: localized aria-label ─────────────────────────────────────────────

describe('CampaignDayBox — MINOR-6 localized aria-label', () => {
  it('does not leak the raw ISO day key into the box aria-label', () => {
    const { container, cleanup } = renderBox(makeCell({ dayKey: '2026-07-01' }))
    const box = container.querySelector('[role="button"]')
    expect(box?.getAttribute('aria-label')).not.toContain('2026-07-01')
    cleanup()
  })

  it('includes a localized long-form date in the box aria-label', () => {
    const { container, cleanup } = renderBox(makeCell({ dayKey: '2026-07-01' }))
    const box = container.querySelector('[role="button"]')
    expect(box?.getAttribute('aria-label')).toContain('July 1, 2026')
    cleanup()
  })
})
