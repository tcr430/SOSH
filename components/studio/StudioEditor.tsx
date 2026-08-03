'use client'

import { useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DiffView } from './DiffView'
import { SuggestionCard } from './SuggestionCard'
import { DraftObservations } from './DraftObservations'
import {
  suggestStudioSuggestions,
  acceptStudioSuggestion,
  createStudioDraftAction,
  saveStudioDraftAction,
  type StudioActionErrorCode,
  type SuggestStudioSuggestionsState,
} from '@/app/[locale]/(dashboard)/studio/actions'
import { VALID_PLATFORMS, PLATFORM_CONFIGS } from '@/lib/social'
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
}

export function StudioEditor({ locale, draftId: initialDraftId, initialContent, initialPlatform }: StudioEditorProps) {
  const t = useTranslations('studio.editor')
  const router = useRouter()

  const [draftId, setDraftId] = useState(initialDraftId)
  const [content, setContent] = useState(initialContent)
  const [platform, setPlatform] = useState<Platform | null>(initialPlatform)

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
