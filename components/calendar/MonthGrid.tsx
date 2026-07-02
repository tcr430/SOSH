'use client'

import { useTranslations } from 'next-intl'
import type { CampaignDayCell } from '@/lib/calendar/types'
import { isDayDroppable } from '@/lib/calendar/drag'
import { DayCell } from './DayCell'

interface MonthGridProps {
  gridDayKeys: string[]
  currentYear: number
  currentMonth: number
  monthLabel: string
  cellsByDay: Map<string, CampaignDayCell[]>
  todayKey: string
  onCellSelect: (cell: CampaignDayCell) => void
  selectedCellKey: string | null
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export function MonthGrid({
  gridDayKeys,
  currentYear,
  currentMonth,
  monthLabel,
  cellsByDay,
  todayKey,
  onCellSelect,
  selectedCellKey,
}: MonthGridProps) {
  const t = useTranslations('calendar')

  return (
    <div className="h-full overflow-auto">
      {/*
        min-w-[560px] → 80px per cell minimum — prevents the 7-column
        grid from compressing to illegibility on narrow viewports.
        The outer overflow-auto allows horizontal scroll below that width.
      */}
      <div className="min-w-[560px]">
        {/* Weekday header — role="row" + role="columnheader" for AT grid navigation */}
        <div
          role="grid"
          aria-label={t('grid.aria_label', { month: monthLabel })}
          aria-readonly="true"
        >
          <div role="row" className="grid grid-cols-7 border-t border-l border-border/40 sticky top-0 bg-card z-10">
            {WEEKDAY_KEYS.map(key => (
              <div
                key={key}
                role="columnheader"
                aria-label={t(`grid.weekday_${key}`)}
                className="border-r border-b border-border/40 px-2 py-1.5 text-xs font-medium text-muted-foreground text-center select-none"
              >
                {t(`grid.weekday_${key}`)}
              </div>
            ))}
          </div>

          {/* 6 week rows — each row has role="row" so AT can navigate row by row */}
          <div className="border-l border-border/40">
            {Array.from({ length: 6 }, (_, weekIdx) => (
              <div key={weekIdx} role="row" className="grid grid-cols-7">
                {gridDayKeys.slice(weekIdx * 7, weekIdx * 7 + 7).map(dayKey => {
                  const [y, mo] = dayKey.split('-').map(Number)
                  const isOutOfMonth = y !== currentYear || mo !== currentMonth
                  const isToday = dayKey === todayKey

                  return (
                    <DayCell
                      key={dayKey}
                      dayKey={dayKey}
                      isToday={isToday}
                      isOutOfMonth={isOutOfMonth}
                      isDroppable={isDayDroppable(dayKey, todayKey, currentYear, currentMonth)}
                      cells={cellsByDay.get(dayKey) ?? []}
                      onCellSelect={onCellSelect}
                      selectedCellKey={selectedCellKey}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
