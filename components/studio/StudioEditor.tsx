'use client'

import { useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DiffView } from './DiffView'
import { SuggestionCard } from './SuggestionCard'
import { DraftObservations } from './DraftObservations'
import { PromoteDraftDialog } from './PromoteDraftDialog'
import {
  suggestStudioSuggestions,
  acceptStudioSuggestion,
  createStudioDraftAction,
  saveStudioDraftAction,
  type StudioActionErrorCode,
  type SuggestStudioSuggestionsState,
  type PromoteDraftToCampaignState,
} from '@/app/[locale]/(dashboard)/studio/actions'
// Imported directly, not from the '@/lib/social' barrel — see
// AccountsClient.tsx's comment for why (Vercel build fix, 2026-09-06).
import { VALID_PLATFORMS } from '@/lib/social/platforms/guards'
import { PLATFORM_CONFIGS } from '@/lib/social/platforms/config'
import type { Platform } from '@/lib/db/types'

// ADR 0019 §11 — the Studio drafting page's Client Component half (the
// Server Component page.tsx files fetch/redirect only, per CLAUDE.md's
// split). Owns every one of the nine §11.2 states plus the a11y floor
// (§11.3). Accept follows PostCard.tsx/RegenerateDialog.tsx's
// useTransition + optimistic-update + rollback-on-failure shape — never a
// third pattern.

type SuggestSuccess = Extract<SuggestStudioSuggestionsState, { success: true }>

interface StudioEditorProps {
  locale: string
  draftId: string | null
  initialContent: string
  initialPlatform: Platform | null
  // ADR 0022 §10 (Session 29 F1b.5) — the promote affordance's server-read
  // facts. initialPromotedCampaignId is null for every pre-existing draft
  // and for the new-draft page (studio/page.tsx). isClaimReclaimable is
  // computed server-side (it needs config.server.PROMOTE_CLAIM_STALE_MINUTES,
  // a server-only constant) — never recomputed client-side.
  initialPromotedCampaignId?: string | null
  isClaimReclaimable?: boolean
}

export function StudioEditor({
  locale,
  draftId: initialDraftId,
  initialContent,
  initialPlatform,
  initialPromotedCampaignId = null,
  isClaimReclaimable = false,
}: StudioEditorProps) {
  const t = useTranslations('studio.editor')
  const router = useRouter()

  const [draftId, setDraftId] = useState(initialDraftId)
  const [content, setContent] = useState(initialContent)
  const [platform, setPlatform] = useState<Platform | null>(initialPlatform)

  // ADR 0022 §10 — promote state. promotedCampaignId is the terminal fact
  // (server-seeded, or set the moment THIS session's own promote succeeds);
  // promoteOutcome is ephemeral messaging for the non-terminal typed
  // outcomes (§3.3's already_promoted/claimed_by_another, plus 'error').
  const [promotedCampaignId, setPromotedCampaignId] = useState(initialPromotedCampaignId)
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false)
  // Session 29-D, D8 (MINOR-8) — 'not_found' is distinct from the generic
  // 'error': the draft was soft-deleted or removed, not a transient failure,
  // and the reclaimable-after-staleness framing 'error' implies is wrong for it.
  const [promoteOutcome, setPromoteOutcome] = useState<'already_promoted' | 'claimed_by_another' | 'error' | 'not_found' | null>(null)

  const [suggestionResult, setSuggestionResult] = useState<SuggestSuccess | null>(null)
  const [stale, setStale] = useState(false)
  const [staleAccept, setStaleAccept] = useState(false)
  const [errorCode, setErrorCode] = useState<StudioActionErrorCode | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [pendingAction, setPendingAction] = useState<'suggest' | 'save' | 'accept' | null>(null)
  const [, startTransition] = useTransition()

  // ADR §11.3 — focus is managed on accept; the set invalidating must not
  // drop focus to document.body. This status region is always present
  // (never unmounted alongside the suggestion cards), so it is always a
  // valid focus target.
  const statusRef = useRef<HTMLDivElement>(null)

  function handleContentChange(value: string) {
    setContent(value)
    setSavedFlash(false)
    // §10.2 — client-side staleness is defence in depth; the server's
    // content_hash guard is the correctness mechanism.
    if (suggestionResult !== null && !stale) setStale(true)
  }

  function handlePlatformChange(value: Platform) {
    setPlatform(value)
    setSavedFlash(false)
    if (suggestionResult !== null && !stale) setStale(true)
  }

  async function ensureDraft(): Promise<string | null> {
    if (draftId !== null) return draftId
    const result = await createStudioDraftAction(content, platform)
    if (!result.success) {
      setErrorCode(result.error)
      return null
    }
    setDraftId(result.draftId)
    router.replace(`/${locale}/studio/${result.draftId}`)
    return result.draftId
  }

  function handleSave() {
    // NIT-4 (Session 26-D correction) — defence-in-depth: the disabled
    // attribute (below) is client-side only. Mirrors handleSuggest/
    // handleAccept's existing guard.
    if (pendingAction !== null) return
    setErrorCode(null)
    setPendingAction('save')
    startTransition(async () => {
      const wasNew = draftId === null
      const id = await ensureDraft()
      if (id === null) {
        setPendingAction(null)
        return
      }
      if (wasNew) {
        // ensureDraft just created the row with this exact content/platform
        // — nothing further to persist.
        setPendingAction(null)
        setSavedFlash(true)
        return
      }
      const result = await saveStudioDraftAction(id, content, platform)
      setPendingAction(null)
      if (!result.success) {
        setErrorCode(result.error)
        return
      }
      setSavedFlash(true)
    })
  }

  const isEmptyDraft = content.trim().length === 0
  const missingPlatform = platform === null
  const suggestDisabledReason = isEmptyDraft ? t('suggestDisabled.emptyDraft') : missingPlatform ? t('suggestDisabled.noPlatform') : null

  // ADR 0022 §10 — the seven promote states, precedence order:
  // 1. promoted (terminal — a real fact once set, outlives any later edit)
  // 2. claimed_by_another (a live, non-stale claim held elsewhere right now)
  // 3. failed (§3.4's residual — the claim is still held, fresh; an
  //    immediate retry would just return claimed_by_another, so this takes
  //    precedence over 'promotable' rather than rendering alongside it) —
  //    Session 29-D, D8 (MINOR-8) adds 'not_found' alongside 'failed' here,
  //    a distinct sub-case rendered with its own message, not a new state.
  // 4. not eligible (content/platform, OR no saved draft yet to promote)
  // 5. reclaimable (server-computed: claimed, stale, no campaign)
  // 6. promotable (otherwise)
  const promoteState: 'promoted' | 'already_promoted' | 'claimed_by_another' | 'failed' | 'not_found' | 'not_eligible' | 'reclaimable' | 'promotable' =
    promotedCampaignId !== null
      ? promoteOutcome === 'already_promoted'
        ? 'already_promoted'
        : 'promoted'
      : promoteOutcome === 'claimed_by_another'
        ? 'claimed_by_another'
        : promoteOutcome === 'not_found'
          ? 'not_found'
          : promoteOutcome === 'error'
            ? 'failed'
            : draftId === null || isEmptyDraft || missingPlatform
              ? 'not_eligible'
              : isClaimReclaimable
                ? 'reclaimable'
                : 'promotable'

  // impeccable review (Session 29 F1b.5) — the third case here (neither
  // reason true) is a real, reachable state: content and platform are BOTH
  // fine but draftId is still null (the new-draft page before first save/
  // suggest). Naming it distinctly avoids the earlier bug where that case
  // fell through to the "add content" message even though content wasn't
  // empty.
  const notEligibleReasonKey = isEmptyDraft
    ? 'promote.notEligible.emptyDraft'
    : missingPlatform
      ? 'promote.notEligible.noPlatform'
      : 'promote.notEligible.notSaved'

  function handlePromoteOutcome(result: PromoteDraftToCampaignState) {
    if (result.outcome === 'promoted') {
      setPromotedCampaignId(result.campaignId)
      setPromoteOutcome(null)
      return
    }
    if (result.outcome === 'already_promoted') {
      setPromotedCampaignId(result.draft.promoted_campaign_id)
      setPromoteOutcome('already_promoted')
      return
    }
    if (result.outcome === 'claimed_by_another') {
      setPromoteOutcome('claimed_by_another')
      return
    }
    // Session 29-D, D8 (MINOR-8) — the draft is gone (soft-deleted or
    // removed between page load and this attempt), not merely stale-claimed.
    if (result.outcome === 'error' && result.error === 'draft_not_found') {
      setPromoteOutcome('not_found')
      return
    }
    // 'not_eligible' and 'error' — §3.4's stranded-claim residual. The
    // draft stays claimed until PROMOTE_CLAIM_STALE_MINUTES elapses; this
    // page has no live countdown, so it renders the honest "failed, draft
    // is safe" message rather than a state it cannot actually observe yet.
    setPromoteOutcome('error')
  }

  function handleSuggest() {
    if (isEmptyDraft || missingPlatform || pendingAction !== null) return
    setErrorCode(null)
    setStaleAccept(false)
    setPendingAction('suggest')
    startTransition(async () => {
      const id = await ensureDraft()
      if (id === null) {
        setPendingAction(null)
        return
      }
      const result = await suggestStudioSuggestions(id)
      setPendingAction(null)
      if (!result.success) {
        setErrorCode(result.error)
        return
      }
      setSuggestionResult(result)
      setStale(false)
    })
  }

  function handleAccept(suggestionId: string) {
    if (suggestionResult === null || draftId === null || stale || pendingAction !== null) return
    const edit = suggestionResult.edits[suggestionId]
    if (edit === undefined) return

    const prevContent = content
    const prevSuggestionResult = suggestionResult
    const { contentHash, suggestionsForHash } = suggestionResult
    const newContent = content.slice(0, edit.originalStart) + edit.replacement + content.slice(edit.originalEnd)

    setContent(newContent)
    // §11.1 — accepting ONE suggestion invalidates the WHOLE set,
    // regardless of server outcome: the honest model is accept -> re-run.
    setSuggestionResult(null)
    setStale(false)
    setStaleAccept(false)
    setErrorCode(null)
    setSavedFlash(false)
    setPendingAction('accept')

    startTransition(async () => {
      const result = await acceptStudioSuggestion(draftId, newContent, contentHash, suggestionsForHash)
      setPendingAction(null)
      if (result.outcome === 'stale') {
        setContent(prevContent)
        setStaleAccept(true)
        statusRef.current?.focus()
        return
      }
      if (result.outcome === 'error') {
        setContent(prevContent)
        setSuggestionResult(prevSuggestionResult)
        setErrorCode(result.error)
        statusRef.current?.focus()
        return
      }
      setContent(result.content)
      statusRef.current?.focus()
    })
  }

  const hasChanges = suggestionResult !== null && suggestionResult.hunks.some((h) => h.kind !== 'equal')
  const suggestLabel = suggestionResult !== null || stale ? t('regenerateButton') : t('suggestButton')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>

      <div className="flex flex-col gap-2">
        <label htmlFor="studio-platform" className="text-sm font-medium">
          {t('platformLabel')}
        </label>
        <select
          id="studio-platform"
          value={platform ?? ''}
          onChange={(e) => handlePlatformChange(e.target.value as Platform)}
          disabled={pendingAction !== null}
          className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          <option value="" disabled>
            {t('platformPlaceholder')}
          </option>
          {VALID_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_CONFIGS[p].displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="studio-content" className="text-sm font-medium">
          {t('contentLabel')}
        </label>
        <Textarea
          id="studio-content"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder={t('contentPlaceholder')}
          rows={8}
          disabled={pendingAction !== null}
          className="resize-y text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleSuggest}
          disabled={isEmptyDraft || missingPlatform || pendingAction !== null}
          aria-describedby={suggestDisabledReason ? 'studio-suggest-reason' : undefined}
        >
          {suggestLabel}
        </Button>
        <Button variant="ghost" onClick={handleSave} disabled={pendingAction !== null}>
          {t('saveButton')}
        </Button>
        {savedFlash && pendingAction === null && <span className="text-xs text-muted-foreground">{t('saved')}</span>}
      </div>
      {(isEmptyDraft || missingPlatform) && (
        <p id="studio-suggest-reason" className="text-xs text-muted-foreground">
          {suggestDisabledReason}
        </p>
      )}

      {/* ADR §11.3 — announced to assistive technology, not merely animated;
          also the stable focus target on accept so focus never drops to
          document.body. tabIndex=-1 makes an otherwise non-interactive div
          programmatically focusable without adding it to tab order. */}
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm outline-none">
        {pendingAction === 'suggest' && <p className="text-muted-foreground">{t('generating')}</p>}
        {staleAccept && <p className="text-destructive">{t('staleAcceptError')}</p>}
        {errorCode !== null && <p role="alert" className="text-destructive">{t(`error.${errorCode}`)}</p>}
      </div>

      {stale && suggestionResult !== null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{t('staleBanner')}</p>
      )}

      {/* ADR 0022 §10 (Session 29 F1b.5) — the seven promote states. Terminal
          states (promoted/already_promoted) render a REAL link (D7's
          insight_cards.campaign_id precedent), never an inert placeholder. */}
      <div className="flex flex-col gap-2 border-t border-border pt-6">
        <h2 className="text-sm font-medium">{t('promote.heading')}</h2>
        <p className="text-xs text-muted-foreground">{t('promote.description')}</p>

        {(promoteState === 'promoted' || promoteState === 'already_promoted') && (
          <div className="rounded-md border border-success-border bg-success px-3 py-2">
            <p className="text-xs font-medium text-success-foreground">
              {t(promoteState === 'already_promoted' ? 'promote.alreadyPromoted.heading' : 'promote.promoted.heading')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(promoteState === 'already_promoted' ? 'promote.alreadyPromoted.body' : 'promote.promoted.body')}
            </p>
            <Link
              href={`/${locale}/campaigns/${promotedCampaignId}/brief`}
              className="mt-1 inline-block text-xs text-info-foreground underline underline-offset-2"
            >
              {t(promoteState === 'already_promoted' ? 'promote.alreadyPromoted.link' : 'promote.promoted.link')}
            </Link>
          </div>
        )}

        {promoteState === 'claimed_by_another' && (
          <p className="text-xs text-muted-foreground">{t('promote.claimedByAnother')}</p>
        )}

        {promoteState === 'not_eligible' && (
          <p className="text-xs text-muted-foreground">{t(notEligibleReasonKey)}</p>
        )}

        {promoteState === 'reclaimable' && (
          <div className="rounded-md border border-warning-border bg-warning px-3 py-2">
            <p className="text-xs font-medium text-warning-foreground">{t('promote.reclaimable')}</p>
            <Button className="mt-2" size="sm" onClick={() => setPromoteDialogOpen(true)} disabled={pendingAction !== null}>
              {t('promote.retryButton')}
            </Button>
          </div>
        )}

        {promoteState === 'promotable' && (
          <Button onClick={() => setPromoteDialogOpen(true)} disabled={pendingAction !== null} className="self-start">
            {t('promote.button')}
          </Button>
        )}

        {promoteState === 'failed' && (
          <p role="alert" className="text-xs text-destructive">
            {t('promote.failed')}
          </p>
        )}

        {promoteState === 'not_found' && (
          <p role="alert" className="text-xs text-destructive">
            {t('promote.notFound')}
          </p>
        )}
      </div>

      {draftId !== null && (
        <PromoteDraftDialog
          draftId={draftId}
          open={promoteDialogOpen}
          onOpenChange={setPromoteDialogOpen}
          onOutcome={handlePromoteOutcome}
        />
      )}

      {suggestionResult !== null && (
        <>
          <DraftObservations observations={suggestionResult.draftObservations} />

          {suggestionResult.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('zeroSuggestions')}</p>
          ) : (
            <>
              {hasChanges && (
                <DiffView hunks={suggestionResult.hunks} originalLabel={t('diff.originalLabel')} revisedLabel={t('diff.revisedLabel')} />
              )}
              <div className="flex flex-col gap-3">
                {suggestionResult.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    canAccept={!stale && suggestionResult.edits[suggestion.id] !== undefined}
                    isPending={pendingAction !== null}
                    onAccept={() => handleAccept(suggestion.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
