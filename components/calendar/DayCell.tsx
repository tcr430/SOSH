'use client'

import { useTranslations } from 'next-intl'
import { useDroppable } from '@dnd-kit/core'
import type { CampaignDayCell } from '@/lib/calendar/types'
import { CampaignDayBox } from './CampaignDayBox'

interface DayCellProps {
  dayKey: string
  isToday: boolean
  isOutOfMonth: boolean
  isDroppable: boolean
  cells: CampaignDayCell[]
  onCellSelect: (cell: CampaignDayCell) => void
  selectedCellKey: string | null  // `${campaignId}::${dayKey}`
}

export function DayCell({ dayKey, isToday, isOutOfMonth, isDroppable, cells, onCellSelect, selectedCellKey }: DayCellProps) {
  const t = useTranslations('calendar')
  const dayNumber = parseInt(dayKey.split('-')[2], 10)

  const { setNodeRef, isOver, active } = useDroppable({
    id: dayKey,
    data: { isDroppable },
  })

  const isDraggingAny = active !== null
  const isValidTarget = isDraggingAny && isDroppable && isOver
  const isRejectedTarget = isDraggingAny && !isDroppable && isOver

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${dayNumber}${isToday ? `, ${t('day.today')}` : ''}`}
      className={`min-h-[120px] p-1.5 border-r border-b border-border/40 transition-colors ${
        isValidTarget
          ? 'bg-primary/15 ring-2 ring-inset ring-primary/50'
          : isRejectedTarget
          ? 'bg-destructive/10 ring-2 ring-inset ring-destructive/30 cursor-not-allowed'
          : isOutOfMonth
          ? 'bg-muted/20'
          : 'bg-background'
      }`}
    >
      <div className="mb-1">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium leading-none ${
            isToday
              ? 'bg-primary text-primary-foreground'
              : isOutOfMonth
              ? 'text-muted-foreground/60'
              : 'text-muted-foreground'
          }`}
        >
          {/* sr-only prefix announces "Today, " before the day number for AT users */}
          {isToday && <span className="sr-only">{t('day.today')},&nbsp;</span>}
          {dayNumber}
        </span>
      </div>

      <div className="space-y-0.5">
        {cells.map(cell => {
          const cellKey = `${cell.campaignId}::${cell.dayKey}`
          return (
            <CampaignDayBox
              key={cellKey}
              cell={cell}
              onSelect={onCellSelect}
              isSelected={selectedCellKey === cellKey}
            />
          )
        })}
      </div>
    </div>
  )
}
