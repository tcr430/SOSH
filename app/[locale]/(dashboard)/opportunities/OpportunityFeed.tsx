'use client'

// ADR 0021 §5.2/§9 — the opportunity feed. Interaction ONLY; all data is
// server-fetched (page.tsx) and passed as props (approvals precedent). Every
// state field renders as PLAIN TEXT (React's default JSX escaping, never
// markdown/dangerouslySetInnerHTML — §7.6's render-side control, closing the
// markdown-image/link exfiltration vector by construction).
//
// NOTE: §9.1 lists "the source link to the release" in the hierarchy, but
// insight_cards (§4.1) carries no html_url column — only an evidence id
// array. Rendering that link would require joining back to signals, which
// is out of E5.9's additive scope; omitted here rather than fabricated.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { approveCardAction, dismissCardAction, saveCardAction } from './actions'
import type { InsightCardRow, InsightCardStatus, InsightCardDismissReason } from '@/lib/db/types'

const DISMISS_REASONS: InsightCardDismissReason[] = [
  'not_relevant',
  'already_covered',
  'too_sensitive',
  'wrong_timing',
  'weak_evidence',
]

// §4.4 — rule-derived sensitivity; a card is "high sensitivity" past this
// threshold. Mirrors the 0-100 CHECK bound on insight_cards.sensitivity.
const HIGH_SENSITIVITY_THRESHOLD = 60

interface OpportunityFeedProps {
  locale: string
  hasConnection: boolean
  cards: InsightCardRow[]
  expiredCards: InsightCardRow[]
  showExpired: boolean
  hasTriageFailures: boolean
  isTriagePaused: boolean
}

export function OpportunityFeed({
  locale,
  hasConnection,
  cards: initialCards,
  expiredCards,
  showExpired,
  hasTriageFailures,
  isTriagePaused,
}: OpportunityFeedProps) {
  const t = useTranslations('opportunities')
  const [cards, setCards] = useState(initialCards)
  const [isPending, startTransition] = useTransition()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  function patchCard(id: string, patch: Partial<InsightCardRow>) {
    setCards(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }

  function handleApprove(cardId: string) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await approveCardAction(cardId)
      if (result.success) {
        patchCard(cardId, { status: 'approved' })
        setStatusMessage(t('actions.announceApproved'))
      } else if (result.outcome === 'already_triaged' && result.currentStatus) {
        // §5.3's two-admins problem: re-render THIS card's real state,
        // never a generic error.
        patchCard(cardId, { status: result.currentStatus })
        setStatusMessage(t('actions.announceAlreadyTriaged'))
      } else {
        setErrorKey(cardId)
      }
    })
  }

  function handleDismiss(cardId: string, reason?: InsightCardDismissReason) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await dismissCardAction(cardId, reason)
      if (result.success) {
        patchCard(cardId, { status: 'dismissed', dismiss_reason: reason ?? null })
        setStatusMessage(t('actions.announceDismissed'))
      } else if (result.outcome === 'already_triaged' && result.currentStatus) {
        patchCard(cardId, { status: result.currentStatus })
        setStatusMessage(t('actions.announceAlreadyTriaged'))
      } else {
        setErrorKey(cardId)
      }
    })
  }

  function handleSave(cardId: string) {
    setErrorKey(null)
    startTransition(async () => {
      const result = await saveCardAction(cardId)
      if (result.success) {
        patchCard(cardId, { status: 'saved', expires_at: null })
        setStatusMessage(t('actions.announceSaved'))
      } else if (result.outcome === 'already_triaged' && result.currentStatus) {
        patchCard(cardId, { status: result.currentStatus })
        setStatusMessage(t('actions.announceAlreadyTriaged'))
      } else {
        setErrorKey(cardId)
      }
    })
  }

  const visibleCards = showExpired ? expiredCards : cards
  const isEmpty = visibleCards.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Live region — status changes announced (§9.3 accessibility floor) */}
      <div aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {/* Triage failed — visible, not silently absent (L-3) */}
      {hasTriageFailures && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-medium text-destructive">{t('status.triageFailedTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('status.triageFailedBody')}</p>
        </div>
      )}

      {/* Triage paused — dated "daily limit reached" */}
      {isTriagePaused && (
        <div className="rounded-md border border-warning-border bg-warning px-4 py-3">
          <p className="text-sm font-medium text-warning-foreground">{t('status.pausedTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('status.pausedBody')}</p>
        </div>
      )}

      {/* Filter toggle — the explicit gate expired cards live behind (§9.2) */}
      <div>
        <Link
          href={showExpired ? `/${locale}/opportunities` : `/${locale}/opportunities?expired=1`}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {showExpired ? t('filters.hideExpired') : t('filters.showExpired')}
        </Link>
      </div>

      {/* Empty states — distinguishable per §9.2 */}
      {!showExpired && isEmpty && !hasConnection && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty.noConnectionTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('empty.noConnectionBody')}</p>
          <Link href={`/${locale}/settings/signals`} className={cn(buttonVariants({ size: 'sm' }))}>
            {t('empty.noConnectionCta')}
          </Link>
        </div>
      )}

      {!showExpired && isEmpty && hasConnection && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty.connectedNothingYetTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('empty.connectedNothingYetBody')}</p>
        </div>
      )}

      {showExpired && isEmpty && (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('filters.noneVisible')}</p>
        </div>
      )}

      <ul className="space-y-4">
        {visibleCards.map(card => (
          <OpportunityCard
            key={card.id}
            card={card}
            isPending={isPending}
            hasError={errorKey === card.id}
            readOnly={showExpired}
            onApprove={() => handleApprove(card.id)}
            onDismiss={reason => handleDismiss(card.id, reason)}
            onSave={() => handleSave(card.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function OpportunityCard({
  card,
  isPending,
  hasError,
  readOnly,
  onApprove,
  onDismiss,
  onSave,
}: {
  card: InsightCardRow
  isPending: boolean
  hasError: boolean
  readOnly: boolean
  onApprove: () => void
  onDismiss: (reason?: InsightCardDismissReason) => void
  onSave: () => void
}) {
  const t = useTranslations('opportunities')
  const [showDismissReason, setShowDismissReason] = useState(false)
  const [confirmingApprove, setConfirmingApprove] = useState(false)
  const [reason, setReason] = useState<InsightCardDismissReason | ''>('')

  const isHighSensitivity = card.sensitivity >= HIGH_SENSITIVITY_THRESHOLD
  const isExpired =
    readOnly || (card.status === 'pending' && card.expires_at !== null && new Date(card.expires_at) < new Date())
  const statusLabel: InsightCardStatus = card.status

  function requestApprove() {
    if (isHighSensitivity && !confirmingApprove) {
      setConfirmingApprove(true)
      return
    }
    setConfirmingApprove(false)
    onApprove()
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* §9.1 information hierarchy: observation -> why it matters ->
          audience -> verified evidence (distinct from assessment) -> angle
          options -> scores. */}
      {/* §7.5/MINOR-5 (Session 28-D, D5) — the model's ASSESSMENT, visually
          distinct from verified evidence below. The marker is VISIBLE TEXT
          on every unverified field, not a `title` attribute (unreliable to
          AT, not keyboard-reachable) and not styling (italics/colour) alone
          — the same class of problem §9.3 names for sensitivity. */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('card.observation')}</p>
        <p className="text-sm leading-relaxed">{card.observation}</p>
        <p className="mt-0.5 text-[11px] font-medium italic text-muted-foreground">{t('card.modelAssessment')}</p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('card.whyItMatters')}</p>
        <p className="text-sm leading-relaxed">{card.why_it_matters}</p>
        <p className="mt-0.5 text-[11px] font-medium italic text-muted-foreground">{t('card.modelAssessment')}</p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('card.audience')}</p>
        <p className="text-sm leading-relaxed">{card.audience}</p>
        <p className="mt-0.5 text-[11px] font-medium italic text-muted-foreground">{t('card.modelAssessment')}</p>
      </div>

      {/* Verified evidence — renders the evidence set's CONTENT (each
          citable evidence-memory id), not merely its count (a bare number
          carries no more visual weight than any other digit and ran opposite
          the "verified" oracle it names). insight_cards.evidence carries only
          an id array (§4.6) — no title/body join exists on this row — so the
          id itself is the content available to show. */}
      {card.evidence.length > 0 && (
        <div className="rounded-md border border-success-border bg-success px-3 py-2">
          <p className="text-xs font-medium text-success-foreground">{t('card.verifiedEvidence')}</p>
          <ul className="mt-1 space-y-0.5">
            {card.evidence.map(evidenceId => (
              <li key={evidenceId} className="font-mono text-xs text-success-foreground">
                {evidenceId}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.angle_options.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('card.angleOptions')}</p>
          <p className="text-[11px] text-muted-foreground">{t('card.angleOptionsHint')}</p>
          <ul className="mt-1 space-y-1">
            {card.angle_options.map((opt, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{opt.angle}</span>
                <span className="text-muted-foreground"> — {opt.rationale}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>{t('card.confidence')}: {card.confidence}</span>
        <span>{t('card.novelty')}: {card.novelty}</span>
        <span>{t('card.freshness')}: {card.freshness}</span>
      </div>

      {/* High-sensitivity warning band — TEXT, not colour alone */}
      {isHighSensitivity && (
        <div className="rounded-md border border-warning-border bg-warning px-3 py-2">
          <p className="text-xs font-medium text-warning-foreground">{t('sensitivity.warning')}</p>
          <p className="text-[11px] text-muted-foreground">{t('sensitivity.excludedFromDigest')}</p>
        </div>
      )}

      {/* Expired — labelled, actions disabled */}
      {isExpired && <p className="text-xs font-medium text-muted-foreground">{t('status.expiredHint')}</p>}

      {/* Saved — distinct, no countdown */}
      {statusLabel === 'saved' && (
        <p className="text-xs font-medium text-info-foreground">{t('status.savedHint')}</p>
      )}

      {/* Approved and in flight — gate count legible; link inert until
          Stage F (E5.10) wires a card->campaign reference. */}
      {statusLabel === 'approved' && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium text-foreground">{t('status.approved')}</p>
          <p className="text-xs text-muted-foreground">{t('status.approvedInFlightBody')}</p>
          <span className="mt-1 inline-block cursor-not-allowed text-xs text-muted-foreground underline underline-offset-2 opacity-60">
            {t('status.approvedLinkPendingHint')}
          </span>
        </div>
      )}

      {statusLabel === 'dismissed' && (
        <p className="text-xs font-medium text-muted-foreground">{t('status.dismissed')}</p>
      )}

      {hasError && (
        <p role="alert" className="text-xs text-destructive">
          {t('actions.error')}
        </p>
      )}

      {!isExpired && (statusLabel === 'pending' || statusLabel === 'saved') && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmingApprove ? (
            <Button size="sm" disabled={isPending} onClick={requestApprove}>
              {t('actions.approve')}
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={isPending} onClick={requestApprove}>
                {t('actions.approveConfirm')}
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmingApprove(false)}>
                {t('actions.cancel')}
              </Button>
            </>
          )}

          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setShowDismissReason(v => !v)}>
            {showDismissReason ? t('actions.cancel') : t('actions.dismiss')}
          </Button>

          {statusLabel === 'pending' && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={onSave}>
              {t('actions.save')}
            </Button>
          )}
        </div>
      )}

      {showDismissReason && (
        <div className="flex items-center gap-2">
          <label htmlFor={`dismiss-reason-${card.id}`} className="text-xs text-muted-foreground">
            {t('actions.dismissReasonPrompt')}
          </label>
          <select
            id={`dismiss-reason-${card.id}`}
            value={reason}
            onChange={e => setReason(e.target.value as InsightCardDismissReason)}
            className="rounded-md border px-2 py-1 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="">{t('actions.dismissReasonPrompt')}</option>
            {DISMISS_REASONS.map(r => (
              <option key={r} value={r}>
                {t(`dismissReason.${r}`)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              onDismiss(reason || undefined)
              setShowDismissReason(false)
            }}
          >
            {t('actions.dismiss')}
          </Button>
        </div>
      )}
    </li>
  )
}
