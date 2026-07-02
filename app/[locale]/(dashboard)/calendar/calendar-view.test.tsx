// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Stub out child components to isolate CalendarView's own render
vi.mock('@/components/calendar/CalendarToolbar', () => ({
  CalendarToolbar: () => React.createElement('div', { 'data-testid': 'toolbar' }),
  CREATE_POST_DISABLED: true as const,
}))

vi.mock('@/components/calendar/MonthGrid', () => ({
  MonthGrid: () => React.createElement('div', { 'data-testid': 'month-grid' }),
}))

vi.mock('@/components/calendar/PostDayPanel', () => ({
  PostDayPanel: () => React.createElement('div', { 'data-testid': 'post-day-panel' }),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: vi.fn().mockImplementation(function({ children }: { children: React.ReactNode }) {
    return children
  }),
  DragOverlay: vi.fn().mockImplementation(() => null),
  PointerSensor: class PointerSensor {},
  KeyboardSensor: class KeyboardSensor {},
  useSensor: vi.fn().mockImplementation((cls: unknown) => cls),
  useSensors: vi.fn().mockReturnValue([]),
}))

vi.mock('./actions', () => ({
  rescheduleDayGroupAction: vi.fn().mockResolvedValue({ ok: true, moved: 2, skipped: 0 }),
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { CalendarView } from './CalendarView'
import { DndContext } from '@dnd-kit/core'
import { rescheduleDayGroupAction } from './actions'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderView(overflow: boolean) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(CalendarView, {
        initialMonth: '2026-06',
        cells: [],
        rows: [],
        tz: 'UTC',
        overflow,
        locale: 'en',
      }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CalendarView overflow banner (R1 / CAL-7)', () => {
  it('shows [role="status"] banner when overflow=true', () => {
    const { container, cleanup } = renderView(true)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    cleanup()
  })

  it('does NOT render the banner when overflow=false', () => {
    const { container, cleanup } = renderView(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    cleanup()
  })
})

// ── BP6: drag-to-reschedule ───────────────────────────────────────────────────

function makeDragEvent(
  sourceDayKey: string,
  targetDayKey: string,
  isDroppable: boolean,
) {
  return {
    active: {
      id: `cam-1::${sourceDayKey}`,
      data: {
        current: {
          type: 'campaign-day-box' as const,
          campaignId: 'cam-1',
          sourceDayKey,
          campaignName: 'Test Campaign',
          colorIndex: 0,
        },
      },
    },
    over: {
      id: targetDayKey,
      data: { current: { isDroppable } },
    },
  }
}

function getOnDragEnd() {
  const calls = vi.mocked(DndContext).mock.calls
  // Each React render call passes props as first arg; pick the most recent
  const lastProps = calls.at(-1)?.[0] as { onDragEnd?: (e: unknown) => void } | undefined
  return lastProps?.onDragEnd
}

describe('CalendarView drag-to-reschedule (BP6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply default resolved value after clearAllMocks resets call history
    vi.mocked(rescheduleDayGroupAction).mockResolvedValue({ ok: true, moved: 2, skipped: 0 })
  })

  it('calls rescheduleDayGroupAction with the correct keys on a valid drop', async () => {
    const { cleanup } = renderView(false)

    const onDragEnd = getOnDragEnd()
    await act(async () => {
      onDragEnd?.(makeDragEvent('2026-06-25', '2026-06-30', true))
    })

    expect(rescheduleDayGroupAction).toHaveBeenCalledWith('cam-1', '2026-06-25', '2026-06-30')
    cleanup()
  })

  it('does NOT call rescheduleDayGroupAction when isDroppable is false (today/past/out-of-month)', async () => {
    const { cleanup } = renderView(false)

    const onDragEnd = getOnDragEnd()
    await act(async () => {
      onDragEnd?.(makeDragEvent('2026-06-25', '2026-06-29', false))
    })

    expect(rescheduleDayGroupAction).not.toHaveBeenCalled()
    cleanup()
  })

  it('shows drag-error banner when action returns "mixed" (full revert, nothing moved)', async () => {
    vi.mocked(rescheduleDayGroupAction).mockResolvedValueOnce({ ok: false, reason: 'mixed' })

    const { container, cleanup } = renderView(false)

    const onDragEnd = getOnDragEnd()
    await act(async () => {
      onDragEnd?.(makeDragEvent('2026-06-25', '2026-06-30', true))
    })

    expect(container.querySelector('[data-testid="drag-error"]')).not.toBeNull()
    cleanup()
  })

  it('shows drag-error banner when action returns "too_soon"', async () => {
    vi.mocked(rescheduleDayGroupAction).mockResolvedValueOnce({ ok: false, reason: 'too_soon' })

    const { container, cleanup } = renderView(false)

    const onDragEnd = getOnDragEnd()
    await act(async () => {
      onDragEnd?.(makeDragEvent('2026-06-25', '2026-06-30', true))
    })

    expect(container.querySelector('[data-testid="drag-error"]')).not.toBeNull()
    cleanup()
  })

  it('does NOT show drag-error banner when partial skipped (ok: true, skipped > 0) — per-post reconcile via server revalidation (R9)', async () => {
    vi.mocked(rescheduleDayGroupAction).mockResolvedValueOnce({ ok: true, moved: 1, skipped: 1 })

    const { container, cleanup } = renderView(false)

    const onDragEnd = getOnDragEnd()
    await act(async () => {
      onDragEnd?.(makeDragEvent('2026-06-25', '2026-06-30', true))
    })

    expect(container.querySelector('[data-testid="drag-error"]')).toBeNull()
    cleanup()
  })
})
