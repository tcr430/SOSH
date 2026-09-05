'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RegenerateDialog } from '@/components/posts/RegenerateDialog'
import {
  approvePostAction,
  unapprovePostAction,
  skipPostAction,
  unskipPostAction,
  updatePostContentAction,
} from '@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions'
import type { PostRow, Platform, AiGenerationMetadata } from '@/lib/db/types'
import { parseAiGenerationMetadata } from '@/lib/db/utils'
import { useCan } from '@/lib/members/useCan'
import { CAPABILITIES } from '@/lib/members/capabilities'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

const PLATFORM_COLORS: Record<Platform, string> = {
  linkedin: '#0A66C2',
  twitter: '#000000',
  instagram: '#E1306C',
  facebook: '#1877F2',
  threads: '#000000',
}

const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
}

const STATUS_PILL_CLASS: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300',
  approved: 'bg-emerald-900/60 text-emerald-300',
  skipped: 'bg-amber-900/60 text-amber-300',
}

// ---------------------------------------------------------------------------
// PostCard
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: PostRow
  onOptimisticUpdate: (postId: string, patch: Partial<PostRow>) => void
}

export function PostCard({ post, onOptimisticUpdate }: PostCardProps) {
  const t = useTranslations('posts')
  const [isPending, startTransition] = useTransition()

  // ADR 0014 §6 — capability-gate echo (UX only, DB is the boundary — L-3).
  const canApprove = useCan(CAPABILITIES.APPROVE)
  const canAuthor = useCan(CAPABILITIES.AUTHOR)
  const [cardError, setCardError] = useState<string | null>(null)

  const [isSkipOpen, setIsSkipOpen] = useState(false)
  const [skipNote, setSkipNote] = useState('')

  const [isEditMode, setIsEditMode] = useState(false)
  const [editContent, setEditContent] = useState(post.content)
  const [editHashtags, setEditHashtags] = useState(
    (post.hashtags ?? []).join(', '),
  )

  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const meta = parseAiGenerationMetadata(post.ai_generation_metadata)
  const accentColor = PLATFORM_COLORS[post.platform]
  const scheduledLabel =
    format(new Date(post.scheduled_at), 'EEE d MMM · HH:mm') +
    ' ' +
    t('card.utcNote')

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleApprove() {
    setCardError(null)
    const prev = post.status
    onOptimisticUpdate(post.id, { status: 'approved' })
    startTransition(async () => {
      const result = await approvePostAction(post.id)
      if (!result.success) {
        onOptimisticUpdate(post.id, { status: prev })
        // ADR 0022 §2.5 (Session 29-D, MAJOR-4) — a typed message, not the
        // generic fallback: this surface has no inline re-pick input (that
        // full treatment lives in ApprovalsInbox.tsx), so the message
        // directs the user to this page's existing reschedule control.
        setCardError(result.error === 'schedule_expired' ? t('regenerate.error.scheduleExpired') : t('regenerate.error.generic'))
      }
    })
  }

  function handleUnapprove() {
    setCardError(null)
    const prev = post.status
    onOptimisticUpdate(post.id, { status: 'draft' })
    startTransition(async () => {
      const result = await unapprovePostAction(post.id)
      if (!result.success) {
        onOptimisticUpdate(post.id, { status: prev })
        setCardError(t('regenerate.error.generic'))
      }
    })
  }

  function handleSkipConfirm() {
    if (skipNote.trim().length < 3) return
    setCardError(null)
    const prev: Partial<PostRow> = { status: post.status, rejection_note: post.rejection_note }
    onOptimisticUpdate(post.id, { status: 'skipped', rejection_note: skipNote })
    setIsSkipOpen(false)
    startTransition(async () => {
      const result = await skipPostAction(post.id, skipNote)
      if (!result.success) {
        onOptimisticUpdate(post.id, prev)
        setCardError(t('regenerate.error.generic'))
      }
    })
  }

  function handleUnskip() {
    setCardError(null)
    const prev: Partial<PostRow> = { status: post.status, rejection_note: post.rejection_note }
    onOptimisticUpdate(post.id, { status: 'draft', rejection_note: null })
    startTransition(async () => {
      const result = await unskipPostAction(post.id)
      if (!result.success) {
        onOptimisticUpdate(post.id, prev)
        setCardError(t('regenerate.error.generic'))
      }
    })
  }

  function handleSaveEdit() {
    setCardError(null)
    const hashtags = editHashtags
      .split(',')
      .map(h => h.trim().replace(/^#/, ''))
      .filter(Boolean)
    const prevContent = post.content
    const prevHashtags = post.hashtags
    onOptimisticUpdate(post.id, { content: editContent, hashtags })
    setIsEditMode(false)
    startTransition(async () => {
      const result = await updatePostContentAction(post.id, editContent, hashtags)
      if (!result.success) {
        onOptimisticUpdate(post.id, { content: prevContent, hashtags: prevHashtags })
        setIsEditMode(true)
        setCardError(t('regenerate.error.generic'))
      }
    })
  }

  function handleRegenerateSuccess(content: string, hashtags: string[]) {
    onOptimisticUpdate(post.id, { content, hashtags })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hashtags = post.hashtags ?? []
  const isLongContent = post.content.length > 300
  const contentClass = isLongContent && !isExpanded ? 'max-h-48 overflow-y-auto' : ''
  const pillClass = STATUS_PILL_CLASS[post.status] ?? STATUS_PILL_CLASS.draft

  const failedAtLabel = post.status === 'failed' && post.last_publish_attempt_at
    ? t('card.tooltip.failedAt', { at: format(new Date(post.last_publish_attempt_at), 'dd MMM HH:mm') })
    : null

  // MINOR-7 (Session 30.5-D, D6): resolvePublishAccount's 'ambiguous' outcome
  // is marked errorCode: 'TOKEN_REVOKED' (the code L-1 permits — no new
  // union member) with errorDetails.reason: 'account_ambiguous', stored at
  // ai_generation_metadata.publish_error.reason by markPostFailed. TOKEN_
  // REVOKED alone maps to "reconnect", the wrong instruction when the real
  // problem is two identities needing one picked — branch on the reason.
  function getPublishErrorReason(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object') return null
    const publishError = (metadata as Record<string, unknown>).publish_error
    if (!publishError || typeof publishError !== 'object') return null
    const reason = (publishError as Record<string, unknown>).reason
    return typeof reason === 'string' ? reason : null
  }

  function resolveErrorLabel(code: string | null, reason: string | null): string {
    if (code === 'TOKEN_REVOKED' && reason === 'account_ambiguous') {
      return t('card.error.account_ambiguous')
    }
    switch (code) {
      case 'TOKEN_EXPIRED': return t('card.error.token_expired')
      case 'TOKEN_REVOKED': return t('card.error.token_revoked')
      case 'RATE_LIMITED': return t('card.error.rate_limited')
      case 'PLATFORM_REJECTED': return t('card.error.platform_rejected')
      case 'NETWORK': return t('card.error.network')
      case 'NOT_IMPLEMENTED': return t('card.error.not_implemented')
      case 'PROVIDER_NOT_CONFIGURED': return t('card.error.provider_not_configured')
      case 'UNKNOWN': return t('card.error.unknown')
      default: return t('card.error.generic')
    }
  }
  const errorLabel = post.status === 'failed'
    ? resolveErrorLabel(post.last_publish_error, getPublishErrorReason(post.ai_generation_metadata))
    : null

  return (
    <article
      className="rounded-lg border border-border bg-card overflow-hidden transition-shadow hover:shadow-sm"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {PLATFORM_LABELS[post.platform]}
            </span>

            {post.status === 'scheduled' && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-900/60 text-indigo-300">
                <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
                {t('card.status.scheduled')}
              </span>
            )}
            {post.status === 'published' && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {t('card.status.published')}
                {post.platform_url && (
                  <a
                    href={post.platform_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('card.action.openOnPlatform')}
                    className="ml-0.5 hover:text-emerald-200"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </span>
            )}
            {post.status === 'failed' && (
              <span
                title={failedAtLabel ?? undefined}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-900/60 text-amber-300 cursor-help"
              >
                <span className="size-1.5 rounded-full bg-amber-400" />
                {t('card.status.failed')}
                {errorLabel && <span className="opacity-80">— {errorLabel}</span>}
              </span>
            )}
            {(post.status === 'draft' || post.status === 'approved' || post.status === 'skipped') && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pillClass}`}>
                {t(`card.status.${post.status}`)}
              </span>
            )}
            {(meta.regenerationCount ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('card.regeneratedCount', { count: meta.regenerationCount ?? 0 })}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {scheduledLabel}
          </span>
        </div>

        {/* Content — edit mode or read mode */}
        {isEditMode ? (
          <div className="flex flex-col gap-2 mb-3">
            <Textarea
              aria-label={t('card.edit.contentLabel')}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={6}
              className="resize-y text-sm"
            />
            <input
              type="text"
              aria-label={t('card.edit.hashtagsLabel')}
              value={editHashtags}
              onChange={e => setEditHashtags(e.target.value)}
              placeholder={t('card.edit.hashtagsLabel')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>
        ) : (
          <div className="mb-3">
            <p className={`text-sm leading-relaxed whitespace-pre-wrap ${contentClass}`}>
              {post.content}
            </p>
            {isLongContent && (
              <button
                type="button"
                onClick={() => setIsExpanded(v => !v)}
                className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? `↑ ${t('card.showLess')}` : `↓ ${t('card.showMore')}`}
              </button>
            )}
          </div>
        )}

        {/* Hashtag pills */}
        {!isEditMode && hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {hashtags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Skipped reason */}
        {post.status === 'skipped' && post.rejection_note && !isEditMode && (
          <p className="text-xs text-amber-400/80 mb-3 italic">
            {t('card.skippedReason', { note: post.rejection_note.slice(0, 40) })}
            {post.rejection_note.length > 40 && '…'}
          </p>
        )}

        {/* Inline error */}
        {cardError && (
          <p role="alert" className="text-xs text-destructive mb-3">
            {cardError}
          </p>
        )}

        {/* Skip inline form */}
        {isSkipOpen && (
          <div className="flex flex-col gap-2 mb-3 rounded-md border border-border bg-muted/30 p-3">
            <label className="text-xs font-medium text-muted-foreground">
              {t('skip.label')}
            </label>
            <input
              type="text"
              value={skipNote}
              onChange={e => setSkipNote(e.target.value)}
              placeholder={t('skip.placeholder')}
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={skipNote.trim().length < 3 || isPending}
                onClick={handleSkipConfirm}
              >
                {t('card.actions.skip')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setIsSkipOpen(false); setSkipNote('') }}
              >
                {t('card.actions.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {post.status === 'draft' && !isEditMode && !isSkipOpen && (
            <>
              {canApprove && (
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={handleApprove}
                  className="bg-emerald-700 hover:bg-emerald-600 text-white"
                >
                  ✓ {t('card.actions.approve')}
                </Button>
              )}
              {!canApprove && canAuthor && (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-disabled="true"
                    aria-label={t('card.actions.approve_disabled_tooltip')}
                    onClick={e => e.preventDefault()}
                    className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground cursor-not-allowed"
                  >
                    ✓ {t('card.actions.approve')}
                  </TooltipTrigger>
                  <TooltipContent>{t('card.actions.approve_disabled_tooltip')}</TooltipContent>
                </Tooltip>
              )}
              {canAuthor && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setIsSkipOpen(true)}
                    className="text-amber-400 hover:text-amber-300 hover:bg-amber-950/30"
                  >
                    ✗ {t('card.actions.skip')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => {
                      setEditContent(post.content)
                      setEditHashtags((post.hashtags ?? []).join(', '))
                      setIsEditMode(true)
                    }}
                  >
                    ✎ {t('card.actions.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setIsRegenerateOpen(true)}
                    className="text-muted-foreground"
                  >
                    ↻ {t('card.actions.regenerate')}
                  </Button>
                </>
              )}
            </>
          )}

          {post.status === 'approved' && !isEditMode && canAuthor && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={handleUnapprove}
                className="text-muted-foreground hover:text-foreground"
              >
                ↩ {t('card.actions.undo')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => {
                  setEditContent(post.content)
                  setEditHashtags((post.hashtags ?? []).join(', '))
                  setIsEditMode(true)
                }}
              >
                ✎ {t('card.actions.edit')}
              </Button>
            </>
          )}

          {post.status === 'skipped' && !isEditMode && !isSkipOpen && canAuthor && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={handleUnskip}
              className="text-muted-foreground hover:text-foreground"
            >
              ↩ {t('card.actions.undo')}
            </Button>
          )}

          {isEditMode && (
            <>
              <Button
                size="sm"
                disabled={isPending || editContent.trim().length === 0}
                onClick={handleSaveEdit}
              >
                {t('card.actions.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditMode(false)
                  setCardError(null)
                }}
              >
                {t('card.actions.cancel')}
              </Button>
            </>
          )}
        </div>
      </div>

      <RegenerateDialog
        postId={post.id}
        open={isRegenerateOpen}
        onOpenChange={setIsRegenerateOpen}
        onSuccess={handleRegenerateSuccess}
      />
    </article>
  )
}
