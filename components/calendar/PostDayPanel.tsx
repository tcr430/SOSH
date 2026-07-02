'use client'

import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { format } from 'date-fns'
import type { CampaignDayCell, CalendarPostRow } from '@/lib/calendar/types'
import { PostRow } from './PostRow'

interface PostDayPanelProps {
  cell: CampaignDayCell
  posts: CalendarPostRow[]
  tz: string
  onClose: () => void
  closeRef?: React.RefObject<HTMLButtonElement | null>
}

export function PostDayPanel({ cell, posts, tz, onClose, closeRef }: PostDayPanelProps) {
  const t = useTranslations('calendar')

  // dayKey is 'yyyy-MM-dd' — parse at noon UTC so no machine-TZ edge cases
  const dateLabel = format(new Date(`${cell.dayKey}T12:00:00Z`), 'MMMM d, yyyy')

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">{cell.campaignName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('panel.close')}
          className="shrink-0 mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Post list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('panel.empty')}
          </p>
        ) : (
          posts.map(post => (
            <PostRow key={post.id} post={post} tz={tz} />
          ))
        )}
      </div>
    </div>
  )
}
