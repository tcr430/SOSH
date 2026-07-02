'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { formatInTimeZone } from 'date-fns-tz'
import { toUtcIso } from '@/lib/utils'
import type { CalendarPostRow } from '@/lib/calendar/types'
import type { PostStatus } from '@/lib/db/types'
import { buildPlatformPostUrl } from '@/lib/calendar/platform-url'
import {
  approvePostFromCalendarAction,
  updatePostFromCalendarAction,
  reschedulePostAction,
} from '@/app/[locale]/(dashboard)/calendar/actions'

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function getTomorrowKeyInBizTz(tz: string): string {
  const todayInBizTz = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const [y, mo, d] = todayInBizTz.split('-').map(Number)
  // Date.UTC arithmetic is machine-timezone-independent (R10)
  return toUtcIso(new Date(Date.UTC(y, mo - 1, d + 1))).split('T')[0]
}

export function formatMetricValue(value: number | null): string {
  if (value === null) return '—'
  return String(value)
}

// ── Status chip styles ────────────────────────────────────────────────────────

const STATUS_CHIP: Record<PostStatus, string> = {
  draft:     'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved:  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  scheduled: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  skipped:   'bg-muted text-muted-foreground',
}

const METRIC_KEYS = [
  'likes', 'comments', 'shares', 'saves', 'clicks', 'reach', 'impressions',
] as const
type MetricKey = typeof METRIC_KEYS[number]

// ── Component ─────────────────────────────────────────────────────────────────

interface PostRowProps {
  post: CalendarPostRow
  tz: string  // business timezone — used for min-date calculation (R6 / R10)
}

export function PostRow({ post, tz }: PostRowProps) {
  const t = useTranslations('calendar')
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(post.content)
  const [editHashtags, setEditHashtags] = useState(post.hashtags.join(' '))

  const isDraft = post.status === 'draft'
  const canReschedule = post.status === 'draft' || post.status === 'approved'
  const minDate = getTomorrowKeyInBizTz(tz)

  // Only show the platform link for published posts where a URL is derivable (R5)
  const platformUrl = post.status === 'published'
    ? buildPlatformPostUrl(post.platform, post.platform_post_id)
    : null

  function handleApprove() {
    startTransition(async () => {
      await approvePostFromCalendarAction(post.id)
    })
  }

  function handleEditSave() {
    const hashtags = editHashtags
      .split(/[\s,#]+/)
      .map(h => h.trim())
      .filter(Boolean)
    startTransition(async () => {
      const result = await updatePostFromCalendarAction(post.id, editContent, hashtags)
      if (result.ok) setIsEditing(false)
    })
  }

  function handleEditCancel() {
    setIsEditing(false)
    setEditContent(post.content)
    setEditHashtags(post.hashtags.join(' '))
  }

  function handleReschedule(e: React.ChangeEvent<HTMLInputElement>) {
    const targetDayKey = e.target.value
    if (!targetDayKey) return
    startTransition(async () => {
      await reschedulePostAction(post.id, targetDayKey)
    })
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
      {/* Platform label + status chip */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t(`platform.${post.platform}`)}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[post.status]}`}>
          {t(`post.status.${post.status}`)}
        </span>
      </div>

      {/* Content — edit mode or read-only preview */}
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={4}
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            aria-label={t('post.content_label')}
          />
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={editHashtags}
            onChange={e => setEditHashtags(e.target.value)}
            placeholder={t('post.hashtags_placeholder')}
            aria-label={t('post.hashtags_label')}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={handleEditSave}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t('post.save')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleEditCancel}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {t('post.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="leading-snug text-foreground line-clamp-3">{post.content}</p>
          {post.hashtags.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {post.hashtags.map(h => `#${h}`).join(' ')}
            </p>
          )}
        </div>
      )}

      {/* Actions row — hidden while editing */}
      {!isEditing && (
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleApprove}
              aria-label={t('post.approve')}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t('post.approve')}
            </button>
          )}

          {canReschedule && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsEditing(true)}
              aria-label={t('post.edit')}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {t('post.edit')}
            </button>
          )}

          {canReschedule && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{t('post.move_to')}</span>
              <input
                type="date"
                min={minDate}
                disabled={isPending}
                onChange={handleReschedule}
                aria-label={t('post.move_to')}
                className="rounded border border-border bg-background px-1 py-0.5 text-xs disabled:opacity-50"
              />
            </label>
          )}

          {platformUrl && (
            <a
              href={platformUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              {t('post.view_on_platform', { platform: t(`platform.${post.platform}`) })}
            </a>
          )}
        </div>
      )}

      {/* Metrics — published posts only; null metric → "—", real 0 → "0" */}
      {post.status === 'published' && (
        <div className="pt-1 border-t border-border/50">
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
            {METRIC_KEYS.map(key => {
              const value = post.metrics?.[key as MetricKey] ?? null
              return (
                <div key={key} className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground/70 leading-none mb-0.5">
                    {t(`post.metrics.${key}`)}
                  </span>
                  <span className="text-xs font-medium tabular-nums">
                    {formatMetricValue(value)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
