'use client'

import { memo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { CampaignDayCell } from '@/lib/calendar/types'
import { formatDayKeyForLocale, type DragData } from '@/lib/calendar/drag'
import type { Platform } from '@/lib/db/types'

// 8 solid hues — each achieves ≥4.5:1 contrast ratio with #ffffff text (WCAG AA).
// Spans 8 perceptually distinct hue sectors so campaigns remain separable
// under common CVD variants (protanopia / deuteranopia / tritanopia).
// Colour is a secondary cue — campaign name text is always the primary identifier.
export const CALENDAR_PALETTE = [
  '#4f46e5',  // indigo-600    — white text contrast ~6.3:1
  '#a21caf',  // fuchsia-700   — white text contrast ~6.3:1
  '#b45309',  // amber-700     — white text contrast ~4.9:1
  '#047857',  // emerald-700   — white text contrast ~5.5:1
  '#1d4ed8',  // blue-700      — white text contrast ~6.7:1
  '#6d28d9',  // violet-700    — white text contrast ~7.1:1
  '#c2410c',  // orange-700    — white text contrast ~5.2:1
  '#0e7490',  // cyan-700      — white text contrast ~5.4:1
] as const

export type CampaignDayBoxState = {
  color: string
  isTransparent: boolean
  showDraftBadge: boolean
  showFailedDot: boolean
  isMuted: boolean
}

export function deriveCampaignDayBoxState(cell: CampaignDayCell): CampaignDayBoxState {
  return {
    color: CALENDAR_PALETTE[cell.colorIndex % CALENDAR_PALETTE.length],
    isTransparent: cell.allPublished,
    // allSkipped implies !anyDraft by construction (groupByCampaignDay derives allSkipped
    // as "every status === 'skipped'"), so the !allSkipped guard was unreachable (NIT-1).
    showDraftBadge: cell.anyDraft,
    showFailedDot: cell.anyFailed,
    isMuted: cell.allSkipped,
  }
}

const PLATFORM_ABBR: Record<Platform, string> = {
  linkedin:  'Li',
  twitter:   'X',
  instagram: 'Ig',
  facebook:  'Fb',
  threads:   'Th',
}

function PlatformIcon({ platform }: { platform: Platform }) {
  return (
    <span className="text-[9px] font-bold leading-none" aria-hidden>
      {PLATFORM_ABBR[platform] ?? platform.slice(0, 2)}
    </span>
  )
}

interface CampaignDayBoxProps {
  cell: CampaignDayCell
  onSelect: (cell: CampaignDayCell) => void
  isSelected: boolean
}

export const CampaignDayBox = memo(function CampaignDayBox({ cell, onSelect, isSelected }: CampaignDayBoxProps) {
  const t = useTranslations('calendar')
  const locale = useLocale()
  const { color, isTransparent, showDraftBadge, showFailedDot, isMuted } = deriveCampaignDayBoxState(cell)

  const dragData: DragData = {
    type: 'campaign-day-box',
    campaignId: cell.campaignId,
    sourceDayKey: cell.dayKey,
    campaignName: cell.campaignName,
    colorIndex: cell.colorIndex,
  }

  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging, transform } = useDraggable({
    id: `${cell.campaignId}::${cell.dayKey}`,
    disabled: !cell.allMovable,
    data: dragData,
  })

  // Published (all-published): pastel tint bg (~31% opacity); foreground text has high contrast
  // on the light surface and communicates a "done/completed" register. All other states: solid
  // palette colour + white text (each hue achieves WCAG AA ≥4.5:1 with #fff at full opacity).
  const bgColor = isTransparent ? `${color}50` : color
  const textColorClass = isTransparent ? 'text-foreground' : 'text-white'

  // MAJOR-4: dnd-kit's KeyboardSensor activator listens on the same node's onKeyDown
  // and calls preventDefault() for Space/Enter before the box's own click can fire —
  // when {...attributes}/{...listeners} lived on the box itself, Space/Enter on an
  // allMovable box always started a drag and could never open the pane via keyboard.
  // Fix: the box is a plain role="button" div handling its own Enter/Space → onSelect;
  // dnd-kit's listeners move to a dedicated small grip handle that is the only drag
  // activator (still ONE drag system — just a narrower activation target).
  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(cell)}
      onKeyDown={(e) => {
        // Ignore Enter/Space bubbled up from the drag handle — dnd-kit's own
        // keydown handler only calls preventDefault(), not stopPropagation(),
        // so without this guard the box would also fire onSelect on every drag activation.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(cell)
        }
      }}
      aria-pressed={isSelected}
      className={[
        'group relative w-full text-left rounded px-1.5 py-1.5 min-h-[28px] text-xs leading-tight',
        'transition-[opacity,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        isMuted ? 'opacity-40 hover:opacity-55' : 'hover:opacity-90',
        isDragging ? 'opacity-20' : '',
        textColorClass,
      ].filter(Boolean).join(' ')}
      style={{
        backgroundColor: bgColor,
        // CSS outline for selected ring — avoids conflict with Tailwind ring-* (both use box-shadow)
        outline: isSelected ? `2px solid ${color}` : undefined,
        outlineOffset: isSelected ? '2px' : undefined,
        transform: CSS.Transform.toString(transform),
      }}
      aria-label={t('box.open_label', { campaign: cell.campaignName, date: formatDayKeyForLocale(cell.dayKey, locale) })}
    >
      {/* Drag handle — the ONLY drag activator; quiet grip glyph, own keyboard focus stop */}
      {cell.allMovable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('box.drag_handle_label')}
          className="absolute top-1/2 right-0.5 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
        >
          <GripVertical className="h-3 w-3" aria-hidden />
        </button>
      )}

      {/* Campaign name */}
      <span className={`block truncate font-medium ${cell.allMovable ? 'pr-3' : ''} ${isMuted ? 'line-through' : ''}`}>
        {cell.campaignName}
      </span>

      {/* Platform icons + indicator badges */}
      <div className="flex items-center gap-0.5 mt-0.5">
        {cell.platforms.map(p => (
          <span key={p} title={t(`platform.${p}`)}>
            <span className="sr-only">{t(`platform.${p}`)}</span>
            <PlatformIcon platform={p} />
          </span>
        ))}

        <span className="flex-1" />

        {/* Failed indicator — "!" glyph + aria-label; never colour-only (WCAG 1.4.1) */}
        {showFailedDot && (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
            role="img"
            aria-label={t('box.failed_dot_label')}
          >
            <span className="text-[8px] font-bold leading-none" aria-hidden>!</span>
          </span>
        )}

        {/* Draft badge — "?" glyph + aria-label; never colour-only (WCAG 1.4.1) */}
        {showDraftBadge && (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-700 text-white"
            role="img"
            aria-label={t('box.draft_badge_label')}
          >
            <span className="text-[8px] font-bold leading-none" aria-hidden>?</span>
          </span>
        )}
      </div>

      {/* Skipped — sr-only text alternative for the struck/muted visual state */}
      {isMuted && <span className="sr-only">{t('box.skipped_label')}</span>}
    </div>
  )
})
