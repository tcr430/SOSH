'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { CampaignDayCell, CalendarPostRow } from '@/lib/calendar/types'
import { moveBoxOptimistically, getTodayKeyInTz, type DragData } from '@/lib/calendar/drag'
import { toUtcIso } from '@/lib/utils'
import { rescheduleDayGroupAction } from './actions'
import { CALENDAR_PALETTE } from '@/components/calendar/CampaignDayBox'
import { CalendarToolbar } from '@/components/calendar/CalendarToolbar'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import { PostDayPanel } from '@/components/calendar/PostDayPanel'

interface CalendarViewProps {
  initialMonth: string      // 'yyyy-MM'
  cells: CampaignDayCell[]
  rows: CalendarPostRow[]   // raw rows for pane post lookup
  tz: string                // business timezone — passed to PostRow for min-date
  overflow: boolean
  locale: string
}

// Computes the 42 day-key strings (Mon-Sun ISO weeks) for a given month.
// Pure date arithmetic on ISO strings — no timezone conversion needed here
// because day keys are business-TZ strings already handled server-side.
function computeGridDayKeys(year: number, month: number): string[] {
  const firstDayKey = `${year}-${String(month).padStart(2, '0')}-01`
  // getUTCDay() at noon UTC is timezone-independent for date-string arithmetic
  const firstDow = new Date(`${firstDayKey}T12:00:00Z`).getUTCDay()  // 0=Sun
  const daysSinceMonday = (firstDow + 6) % 7  // 0=Mon…6=Sun
  const gridStartMs = Date.UTC(year, month - 1, 1 - daysSinceMonday)

  const keys: string[] = []
  for (let i = 0; i < 42; i++) {
    keys.push(toUtcIso(new Date(gridStartMs + i * 86_400_000)).split('T')[0])
  }
  return keys
}

export function CalendarView({
  initialMonth,
  cells,
  rows,
  tz,
  overflow,
  locale,
}: CalendarViewProps) {
  const t = useTranslations('calendar')
  const router = useRouter()
  const [monthKey, setMonthKey] = useState(initialMonth)
  const [selectedCell, setSelectedCell] = useState<CampaignDayCell | null>(null)
  const [cellsSnapshot, setCellsSnapshot] = useState(cells)
  const [localCells, setLocalCells] = useState<CampaignDayCell[]>(cells)
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null)
  const [dragErrorKey, setDragErrorKey] = useState<string | null>(null)
  const [year, month] = monthKey.split('-').map(Number)

  // Adjust local (optimistic) state during render when the server sends freshly
  // revalidated `cells` (R9 per-post reconcile) — not an effect, so no extra
  // render/commit round-trip and no react-hooks/set-state-in-effect violation.
  if (cells !== cellsSnapshot) {
    setCellsSnapshot(cells)
    setLocalCells(cells)
  }

  // Focus management for the detail pane — open moves focus to close button,
  // close restores focus to the triggering element (skipped during drag).
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const panelCloseRef = useRef<HTMLButtonElement>(null)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    if (selectedCell) {
      const frame = requestAnimationFrame(() => panelCloseRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    } else if (!isDraggingRef.current && lastFocusedRef.current) {
      lastFocusedRef.current.focus()
      lastFocusedRef.current = null
    }
  }, [selectedCell])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  )

  const gridDayKeys = useMemo(() => computeGridDayKeys(year, month), [year, month])

  const cellsByDay = useMemo(() => {
    const map = new Map<string, CampaignDayCell[]>()
    for (const cell of localCells) {
      const bucket = map.get(cell.dayKey) ?? []
      bucket.push(cell)
      map.set(cell.dayKey, bucket)
    }
    return map
  }, [localCells])

  // Build postId → row map so the pane can look up full post data by ID
  const postRowMap = useMemo(() => {
    const map = new Map<string, CalendarPostRow>()
    for (const row of rows) {
      map.set(row.id, row)
    }
    return map
  }, [rows])

  const selectedPosts = useMemo(
    () =>
      selectedCell
        ? selectedCell.postIds
            .map(id => postRowMap.get(id))
            .filter((p): p is CalendarPostRow => p !== undefined)
        : [],
    [selectedCell, postRowMap],
  )

  const selectedCellKey = selectedCell
    ? `${selectedCell.campaignId}::${selectedCell.dayKey}`
    : null

  const todayKey = getTodayKeyInTz(tz)
  const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy')

  function handleCellSelect(cell: CampaignDayCell) {
    lastFocusedRef.current = document.activeElement as HTMLElement
    setSelectedCell(cell)
  }

  function handlePanelClose() {
    setSelectedCell(null)
  }

  function navigate(y: number, m: number) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    setMonthKey(key)
    setSelectedCell(null)
    setDragErrorKey(null)
    lastFocusedRef.current = null  // no focus restoration on month navigation
    router.push(`?month=${key}`, { scroll: false })
  }

  function handleDragStart(event: DragStartEvent) {
    isDraggingRef.current = true
    setActiveDragData(event.active.data.current as DragData)
    setSelectedCell(null)  // close pane during drag
    setDragErrorKey(null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    isDraggingRef.current = false
    setActiveDragData(null)
    const { active, over } = event
    if (!over) return

    const dragData = active.data.current as DragData
    const dropData = over.data.current as { isDroppable: boolean } | undefined

    // Client-side guard — server enforces the same rule (CAL-4 / R6)
    if (!dropData?.isDroppable) return

    const targetDayKey = String(over.id)
    if (dragData.sourceDayKey === targetDayKey) return  // same-day no-op

    const { campaignId, sourceDayKey } = dragData

    // Snapshot for full revert on hard failures (mixed / too_soon / generic)
    const snapshot = localCells

    // Optimistic move — entire box jumps to target day immediately
    setLocalCells(prev => moveBoxOptimistically(prev, campaignId, sourceDayKey, targetDayKey))

    const result = await rescheduleDayGroupAction(campaignId, sourceDayKey, targetDayKey)

    if (result.ok) {
      // Partial skipped: server revalidatePath fires → new cells prop arrives → useEffect
      // syncs localCells — only the genuinely skipped posts snap back (R9 per-post reconcile)
    } else {
      // Nothing moved server-side — revert the full optimistic move
      setLocalCells(snapshot)
      if (result.reason === 'too_soon') setDragErrorKey('drag.error_too_soon')
      else if (result.reason === 'mixed') setDragErrorKey('drag.error_mixed')
      else setDragErrorKey('drag.error_generic')
    }
  }

  function onPrev() {
    if (month === 1) navigate(year - 1, 12)
    else navigate(year, month - 1)
  }

  function onNext() {
    if (month === 12) navigate(year + 1, 1)
    else navigate(year, month + 1)
  }

  function onToday() {
    const [ty, tm] = todayKey.split('-').map(Number)
    navigate(ty, tm)
  }

  const overlayColor = activeDragData
    ? `${CALENDAR_PALETTE[activeDragData.colorIndex % CALENDAR_PALETTE.length]}cc`
    : undefined

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t('drag.instruct_draggable') },
        announcements: {
          onDragStart({ active }) {
            return t('drag.announce_start', { campaign: (active.data.current as DragData).campaignName })
          },
          onDragOver({ active, over }) {
            const campaign = (active.data.current as DragData).campaignName
            return over
              ? t('drag.announce_over', { campaign, day: format(new Date(`${String(over.id)}T12:00:00Z`), 'MMMM d') })
              : t('drag.announce_off', { campaign })
          },
          onDragEnd({ active, over }) {
            const campaign = (active.data.current as DragData).campaignName
            return over
              ? t('drag.announce_end', { campaign, day: format(new Date(`${String(over.id)}T12:00:00Z`), 'MMMM d') })
              : t('drag.announce_cancelled')
          },
          onDragCancel() {
            return t('drag.announce_cancelled')
          },
        },
      }}
    >
      <div className="flex h-full min-h-0 overflow-hidden">
        {/* Mobile backdrop — dims the grid while the overlay panel is open */}
        {selectedCell && (
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            aria-hidden
            onClick={handlePanelClose}
          />
        )}

        {/*
          lg+: in-flow pane with smooth width transition (grid shrinks beside it).
          <lg: fixed right-side sheet that slides in from the edge (grid stays full-width).
        */}
        <div
          className={[
            'shrink-0 overflow-hidden border-r border-border bg-card',
            'lg:transition-[width] lg:duration-200 lg:ease-in-out',
            selectedCell ? 'lg:w-80' : 'lg:w-0',
            'max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50',
            'max-lg:w-full max-lg:max-w-sm max-lg:shadow-2xl',
            'max-lg:transition-transform max-lg:duration-200 max-lg:ease-in-out',
            selectedCell ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full max-lg:pointer-events-none',
          ].join(' ')}
        >
          {selectedCell && (
            <PostDayPanel
              cell={selectedCell}
              posts={selectedPosts}
              tz={tz}
              onClose={handlePanelClose}
              closeRef={panelCloseRef}
            />
          )}
        </div>

        {/* Right — calendar column */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Non-blocking overflow banner (R1 / CAL-7) */}
          {overflow && (
            <div
              role="status"
              aria-live="polite"
              className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 border-b border-border"
            >
              {t('overflow_banner')}
            </div>
          )}

          {/* Drag error banner — shown when a group reschedule fails */}
          {dragErrorKey && (
            <div
              role="alert"
              data-testid="drag-error"
              className="shrink-0 px-4 py-1.5 text-xs text-destructive bg-destructive/5 border-b border-destructive/20"
            >
              {t(dragErrorKey)}
            </div>
          )}

          <CalendarToolbar
            monthLabel={monthLabel}
            locale={locale}
            onPrev={onPrev}
            onNext={onNext}
            onToday={onToday}
          />

          {/* Grid wrapper — relative so the empty-month hint can be centred absolutely */}
          <div className="flex-1 min-h-0 relative">
            <MonthGrid
              gridDayKeys={gridDayKeys}
              currentYear={year}
              currentMonth={month}
              monthLabel={monthLabel}
              cellsByDay={cellsByDay}
              todayKey={todayKey}
              onCellSelect={handleCellSelect}
              selectedCellKey={selectedCellKey}
            />
            {localCells.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-sm text-muted-foreground/50 select-none">
                  {t('grid.empty_month')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating drag ghost — calm visual, no bounce */}
      <DragOverlay>
        {activeDragData && (
          <div
            className="rounded px-1.5 py-1 text-xs text-white shadow-lg ring-2 ring-primary ring-offset-1 pointer-events-none select-none"
            style={{ backgroundColor: overlayColor }}
          >
            {activeDragData.campaignName}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
