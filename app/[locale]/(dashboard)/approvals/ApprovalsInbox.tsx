'use client'

// ADR 0014 §9.3/§9.4 — the Approvals inbox. A fast triage lane wiring the
// EXISTING approve/skip/bulk-approve Server Actions unchanged (BOUNDARY:
// no new authorization). Edit is a SEPARATE step: the row links out to the
// campaign posts surface where editing an approved post reverts it to draft
// (ADR 0012) — the inbox never silently approves an edited post (L-5/C-1).

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  approvePostAction,
  bulkApprovePostsAction,
  skipPostAction,
} from '@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions'
import type { CalendarPostRow } from '@/lib/calendar/types'
import type { CampaignRow, Platform } from '@/lib/db/types'

const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
}

interface ApprovalsInboxProps {
  posts: CalendarPostRow[]
  campaigns: CampaignRow[]
  // True pending-draft total (unbounded by APPROVALS_POST_LIMIT) — lets the
  // overflow notice tell the approver when drafts are hidden past the cap
  // (m1, ADR 0014 §9.4). Real pagination is deferred; this is the honesty
  // signal only.
  totalPendingCount: number
}

export function ApprovalsInbox({ posts, campaigns, totalPendingCount }: ApprovalsInboxProps) {
  const t = useTranslations('approvals')
  const params = useParams<{ locale: string }>()
  const locale = params.locale

  // Fixed at the initial fetch — `items` shrinks as posts are approved/skipped,
  // but that doesn't change how many drafts exist beyond the cap.
  const hasOverflow = totalPendingCount > posts.length

  const [items, setItems] = useState(posts)
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [isPending, startTransition] = useTransition()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // Action feedback for screen-reader users — rows are removed from the DOM on
  // success, which would otherwise announce nothing (ARIA live-region, §12).
  const [statusMessage, setStatusMessage] = useState('')

  const platformsPresent = useMemo(
    () => Array.from(new Set(items.map(p => p.platform))),
    [items],
  )
  const campaignsPresent = useMemo(() => {
    const ids = new Set(items.map(p => p.campaign_id))
    return campaigns.filter(c => ids.has(c.id))
  }, [items, campaigns])

  const filtered = items.filter(
    p =>
      (campaignFilter === 'all' || p.campaign_id === campaignFilter) &&
      (platformFilter === 'all' || p.platform === platformFilter),
  )

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarPostRow[]>()
    for (const p of filtered) {
      const list = map.get(p.campaign_id) ?? []
      list.push(p)
      map.set(p.campaign_id, list)
    }
    return map
  }, [filtered])

  function removeFromList(postId: string) {
    setItems(prev => prev.filter(p => p.id !== postId))
  }

  function handleApprove(postId: string) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await approvePostAction(postId)
      if (result.success) {
        removeFromList(postId)
        setStatusMessage(t('row.announceApproved'))
      } else {
        setErrorKey(postId)
      }
    })
  }

  function handleSkip(postId: string, note: string) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await skipPostAction(postId, note)
      if (result.success) {
        removeFromList(postId)
        setStatusMessage(t('row.announceSkipped'))
      } else {
        setErrorKey(postId)
      }
    })
  }

  // Session 22-D (BLOCKER-1/2) — renderedIds are exactly the rows this group
  // is currently showing (already filtered by campaign + platform), so the
  // write can never reach a draft the approver didn't see, and the label,
  // optimistic removal, and announcement all derive from the same set.
  function handleBulkApprove(campaignId: string, renderedIds: string[]) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await bulkApprovePostsAction(campaignId, renderedIds)
      if (result.success) {
        const campaignName = campaigns.find(c => c.id === campaignId)?.name ?? ''
        const idSet = new Set(renderedIds)
        // Rows are removed from the DOM regardless (their end state is
        // 'approved' either way) — but the ANNOUNCED number is the DB row
        // count the write actually flipped (result.count), not the rendered
        // length. Session 22 P2 (NEW-1): under concurrency another approver
        // may flip a rendered draft between render and write; the atomic
        // .eq('status','draft') guard correctly drops it from the UPDATE,
        // count comes back lower, and renderedIds.length would overstate
        // what the action did.
        setItems(prev => prev.filter(p => !idSet.has(p.id)))
        setStatusMessage(t('bulk.announceApproved', { count: result.count ?? 0, campaign: campaignName }))
      } else {
        setErrorKey(campaignId)
      }
    })
  }

  // APV-EMPTY-STATE — positive, finished feeling, not an error. Still surfaces
  // the overflow notice: approving all visible drafts must not read as "done"
  // when more exist past the cap (m1).
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{t('empty.title')}</p>
        {hasOverflow && (
          <p className="text-xs text-muted-foreground">
            {t('overflow.notice', { shown: posts.length, total: totalPendingCount })}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Live region — announces approve/skip/bulk outcomes to screen readers,
          since the acted-on row is removed from the DOM on success (§12). */}
      <div aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {/* Overflow notice (m1) — quiet, factual, not an alarm. Only rendered
          when the true pending total exceeds the fetched (APPROVALS_POST_LIMIT) list. */}
      {hasOverflow && (
        <p className="text-xs text-muted-foreground">
          {t('overflow.notice', { shown: posts.length, total: totalPendingCount })}
        </p>
      )}

      {/* Filters — APV-FILTER */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('filters.campaign')}</span>
          <select
            value={campaignFilter}
            onChange={e => setCampaignFilter(e.target.value)}
            className="rounded-md border px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="all">{t('filters.all')}</option>
            {campaignsPresent.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('filters.platform')}</span>
          <select
            value={platformFilter}
            onChange={e => setPlatformFilter(e.target.value)}
            className="rounded-md border px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="all">{t('filters.all')}</option>
            {platformsPresent.map(p => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty.filtered')}</p>
        </div>
      )}

      {Array.from(grouped.entries()).map(([campaignId, rows]) => {
        const campaign = campaigns.find(c => c.id === campaignId)
        // The visible label is just the count ("Approve all (12)") — a blind
        // approver must not have to infer the active platform filter from a
        // number, so the accessible name states the actual scope (ADR 0014
        // Amendment A, B5 a11y pass).
        const bulkAriaLabel =
          platformFilter === 'all'
            ? t('bulk.approveAllLabel', { count: rows.length, campaign: campaign?.name ?? '' })
            : t('bulk.approveAllLabelFiltered', {
                count: rows.length,
                platform: PLATFORM_LABELS[platformFilter as Platform],
                campaign: campaign?.name ?? '',
              })
        return (
          <section key={campaignId} className="space-y-3" aria-label={campaign?.name ?? ''}>
            {/* Bulk bar — APV-SINGLE-AND-BATCH, wires the EXISTING bulkApprovePostsAction */}
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-4 py-2.5">
              <span className="text-sm font-medium">{campaign?.name ?? ''}</span>
              {/* ADR 0014 A1.1 (APV-BULK-VISIBLE-ONLY): bulk is offered iff the
                  rendered set is provably complete. hasOverflow means the
                  business-wide pending total exceeds what was ever fetched —
                  in that case NO group (filtered or not) can be proven
                  complete, so bulk is disabled everywhere, not just here. */}
              {!hasOverflow ? (
                <Button
                  size="sm"
                  disabled={isPending}
                  aria-label={bulkAriaLabel}
                  onClick={() => handleBulkApprove(campaignId, rows.map(r => r.id))}
                  className="bg-emerald-700 hover:bg-emerald-600 text-white"
                >
                  {t('bulk.approveAll', { count: rows.length })}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-disabled="true"
                    aria-label={t('bulk.incompleteSetHint')}
                    onClick={e => e.preventDefault()}
                    // WCAG AA (B5/MINOR-1): text-foreground on bg-muted — see the
                    // real contrast assertion in ApprovalsInbox.test.tsx (both
                    // themes), not a comment claiming a measurement.
                    className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium bg-muted text-foreground cursor-not-allowed"
                  >
                    {t('bulk.approveAll', { count: rows.length })}
                  </TooltipTrigger>
                  <TooltipContent>{t('bulk.incompleteSetHint')}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {errorKey === campaignId && (
              <p role="alert" className="text-xs text-destructive">
                {t('row.error')}
              </p>
            )}

            <ul className="space-y-2">
              {rows.map(post => (
                <DraftRow
                  key={post.id}
                  post={post}
                  locale={locale}
                  isPending={isPending}
                  hasError={errorKey === post.id}
                  onApprove={() => handleApprove(post.id)}
                  onSkip={note => handleSkip(post.id, note)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function DraftRow({
  post,
  locale,
  isPending,
  hasError,
  onApprove,
  onSkip,
}: {
  post: CalendarPostRow
  locale: string
  isPending: boolean
  hasError: boolean
  onApprove: () => void
  onSkip: (note: string) => void
}) {
  const t = useTranslations('approvals')
  const [isSkipOpen, setIsSkipOpen] = useState(false)
  const [note, setNote] = useState('')

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
              {PLATFORM_LABELS[post.platform]}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {format(new Date(post.scheduled_at), 'EEE d MMM · HH:mm')}
            </span>
          </div>
          <p className="line-clamp-2 text-sm leading-relaxed">{post.content}</p>
        </div>

        {!isSkipOpen && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={onApprove}
              className="bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              <span aria-hidden="true">✓</span> {t('row.approve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setIsSkipOpen(true)}
              className="text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30 dark:hover:text-amber-200"
            >
              <span aria-hidden="true">✗</span> {t('row.skip')}
            </Button>
            <Link
              href={`/${locale}/campaigns/${post.campaign_id}/posts`}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
            >
              {t('row.edit')}
            </Link>
          </div>
        )}
      </div>

      {hasError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t('row.error')}
        </p>
      )}

      {isSkipOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`skip-note-${post.id}`}
          >
            {t('row.skipLabel')}
          </label>
          <input
            id={`skip-note-${post.id}`}
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('row.skipPlaceholder')}
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={note.trim().length < 3 || isPending}
              onClick={() => {
                onSkip(note)
                setIsSkipOpen(false)
              }}
            >
              {t('row.skip')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsSkipOpen(false)
                setNote('')
              }}
            >
              {t('row.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
