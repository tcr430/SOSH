'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { pt } from 'date-fns/locale/pt'
import { es } from 'date-fns/locale/es'
import type { Locale } from 'date-fns'
import { PostCard } from '@/components/posts/PostCard'
import { bulkApprovePostsAction } from '@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions'
import type { PostRow, CampaignRow, Platform } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Filter type
// ---------------------------------------------------------------------------

type FilterValue = 'all' | Platform | 'approved' | 'skipped' | 'failed'

// ---------------------------------------------------------------------------
// Date-fns locale map
// ---------------------------------------------------------------------------

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, pt, es }

// ---------------------------------------------------------------------------
// FilterPill
// ---------------------------------------------------------------------------

const filterPillBase =
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer'
const filterPillActive = 'bg-foreground text-background'
const filterPillInactive = 'bg-muted text-muted-foreground hover:bg-muted/70'

interface FilterPillProps {
  value: FilterValue
  label: string
  activeFilter: FilterValue
  onSelect: (v: FilterValue) => void
}

function FilterPill({ value, label, activeFilter, onSelect }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`${filterPillBase} ${
        activeFilter === value ? filterPillActive : filterPillInactive
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PostsClientProps {
  posts: PostRow[]
  campaign: CampaignRow
  locale: string
  initialFilter?: FilterValue
}

// ---------------------------------------------------------------------------
// PostsClient
// ---------------------------------------------------------------------------

export function PostsClient({ posts, campaign, locale, initialFilter = 'all' }: PostsClientProps) {
  const t = useTranslations('posts')
  const [isPending, startTransition] = useTransition()
  const [activeFilter, setActiveFilter] = useState<FilterValue>(initialFilter)
  const [localPosts, setLocalPosts] = useState<PostRow[]>(posts)

  function handleOptimisticUpdate(postId: string, patch: Partial<PostRow>) {
    setLocalPosts(prev =>
      prev.map(p => (p.id === postId ? { ...p, ...patch } : p)),
    )
  }

  // Counts
  const draftCount = localPosts.filter(p => p.status === 'draft').length
  const approvedCount = localPosts.filter(p => p.status === 'approved').length
  const skippedCount = localPosts.filter(p => p.status === 'skipped').length
  const failedCount = localPosts.filter(p => p.status === 'failed').length

  // Unique platforms present
  const platformsPresent = Array.from(
    new Set(localPosts.map(p => p.platform)),
  ) as Platform[]

  // Bulk approve
  function handleBulkApprove() {
    const snapshot = localPosts
    setLocalPosts(prev =>
      prev.map(p =>
        p.status === 'draft' ? { ...p, status: 'approved' as const } : p,
      ),
    )
    startTransition(async () => {
      const result = await bulkApprovePostsAction(campaign.id)
      if (!result.success) {
        setLocalPosts(snapshot)
      }
    })
  }

  // Filtered + sorted list
  const filtered = localPosts
    .filter(p => {
      if (activeFilter === 'all') return true
      if (activeFilter === 'approved') return p.status === 'approved'
      if (activeFilter === 'skipped') return p.status === 'skipped'
      if (activeFilter === 'failed') return p.status === 'failed'
      return p.platform === activeFilter
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  let lastDateKey = ''

  return (
    <div>
      {/* Filter bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border pb-3 mb-6 -mx-4 px-4 pt-2 sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterPill
              value="all"
              label={t('filter.all', { count: localPosts.length })}
              activeFilter={activeFilter}
              onSelect={setActiveFilter}
            />
            {platformsPresent.map(platform => (
              <FilterPill
                key={platform}
                value={platform}
                label={platform.charAt(0).toUpperCase() + platform.slice(1)}
                activeFilter={activeFilter}
                onSelect={setActiveFilter}
              />
            ))}
            {approvedCount > 0 && (
              <FilterPill
                value="approved"
                label={t('filter.approved', { count: approvedCount })}
                activeFilter={activeFilter}
                onSelect={setActiveFilter}
              />
            )}
            {skippedCount > 0 && (
              <FilterPill
                value="skipped"
                label={t('filter.skipped', { count: skippedCount })}
                activeFilter={activeFilter}
                onSelect={setActiveFilter}
              />
            )}
            {failedCount > 0 && (
              <FilterPill
                value="failed"
                label={t('filter.failed', { count: failedCount })}
                activeFilter={activeFilter}
                onSelect={setActiveFilter}
              />
            )}
          </div>

          {draftCount > 0 && (
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={isPending}
              className="inline-flex items-center rounded-md bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              ✓ {t('bulkApprove')}
            </button>
          )}
        </div>
      </div>

      {/* Post list with date dividers */}
      <div className="flex flex-col gap-4">
        {filtered.map(post => {
          const dateKey = post.scheduled_at.slice(0, 10)
          const showDivider = dateKey !== lastDateKey
          // eslint-disable-next-line react-hooks/immutability
          lastDateKey = dateKey
          const dividerLabel = format(new Date(dateKey), 'EEEE, d MMMM', {
            locale: dateFnsLocale,
          })

          return (
            <div key={post.id}>
              {showDivider && (
                <p className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border pb-1 mb-3 mt-5 first:mt-0">
                  {dividerLabel}
                </p>
              )}
              <PostCard post={post} onOptimisticUpdate={handleOptimisticUpdate} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
