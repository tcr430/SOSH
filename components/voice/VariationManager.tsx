'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AxisTrack } from './AxisTrack'
import { suggestVariations } from '@/lib/voice/variations'
import type { BrandVoiceVariationRow } from '@/lib/db/types'
import type { VoiceAxes } from '@/lib/validation/voice'
import type {
  addVariationAction,
  renameVariationAction,
  deleteVariationAction,
  updateVariationAxesAction,
  VoiceVariationActionState,
} from '@/app/[locale]/(dashboard)/settings/voice/actions'

const AXIS_ORDER: ReadonlyArray<keyof VoiceAxes> = [
  'formal_casual',
  'expert_peer',
  'serious_playful',
  'reserved_warm',
  'calm_energetic',
  'rational_emotional',
  'exclusive_inclusive',
]

const AXIS_LABELS: Record<keyof VoiceAxes, [string, string]> = {
  formal_casual:       ['Formal',    'Casual'],
  expert_peer:         ['Expert',    'Peer'],
  serious_playful:     ['Serious',   'Playful'],
  reserved_warm:       ['Reserved',  'Warm'],
  calm_energetic:      ['Calm',      'Energetic'],
  rational_emotional:  ['Rational',  'Emotional'],
  exclusive_inclusive: ['Exclusive', 'Inclusive'],
}

interface VariationManagerProps {
  baseAxes: VoiceAxes
  variations: BrandVoiceVariationRow[]
  addAction: typeof addVariationAction
  renameAction: typeof renameVariationAction
  deleteAction: typeof deleteVariationAction
  updateAxesAction: typeof updateVariationAxesAction
}

export function VariationManager({
  baseAxes,
  variations,
  addAction,
  renameAction,
  deleteAction,
  updateAxesAction,
}: VariationManagerProps) {
  const t = useTranslations('variations')
  const suggestions = suggestVariations(baseAxes, variations.map(v => v.name))
  const [addState, addDispatch, isAdding] = useActionState<VoiceVariationActionState, FormData>(
    addAction,
    {},
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {/* ── Existing variations ── */}
      {variations.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('your_variations')}</h3>
          <ul className="space-y-2">
            {variations.map(v => (
              <VariationRow
                key={v.id}
                variation={v}
                isExpanded={expandedId === v.id}
                onToggleExpand={() => setExpandedId(expandedId === v.id ? null : v.id)}
                renameAction={renameAction}
                deleteAction={deleteAction}
                updateAxesAction={updateAxesAction}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Suggested presets ── */}
      {suggestions.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('suggestions_title')}</h3>
          <p className="text-xs text-muted-foreground">{t('suggestions_hint')}</p>

          {addState.error === 'variation_cap_reached' && (
            <p className="text-sm text-destructive">{t('cap_reached')}</p>
          )}
          {addState.error === 'generic' && (
            <p className="text-sm text-destructive">{t('error_generic')}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <SuggestedPresetButton
                key={s.name}
                suggestion={s}
                dispatch={addDispatch}
                isAdding={isAdding}
              />
            ))}
          </div>
        </section>
      )}

      {suggestions.length === 0 && variations.length >= 5 && (
        <p className="text-sm text-muted-foreground">{t('cap_reached')}</p>
      )}
    </div>
  )
}

// ── SuggestedPresetButton ─────────────────────────────────────────────────────

function SuggestedPresetButton({
  suggestion,
  dispatch,
  isAdding,
}: {
  suggestion: { name: string; voiceAxes: VoiceAxes }
  dispatch: (fd: FormData) => void
  isAdding: boolean
}) {
  function handleClick() {
    const fd = new FormData()
    fd.set('name', suggestion.name)
    for (const [k, v] of Object.entries(suggestion.voiceAxes)) {
      fd.set(k, String(v))
    }
    dispatch(fd)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isAdding}
      className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-muted/30 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      + {suggestion.name}
    </button>
  )
}

// ── VariationRow ──────────────────────────────────────────────────────────────

function VariationRow({
  variation,
  isExpanded,
  onToggleExpand,
  renameAction,
  deleteAction,
  updateAxesAction,
}: {
  variation: BrandVoiceVariationRow
  isExpanded: boolean
  onToggleExpand: () => void
  renameAction: typeof renameVariationAction
  deleteAction: typeof deleteVariationAction
  updateAxesAction: typeof updateVariationAxesAction
}) {
  const t = useTranslations('variations')
  const [renameState, renameDispatch, isRenaming] = useActionState<VoiceVariationActionState, FormData>(
    renameAction,
    {},
  )
  const [deleteState, deleteDispatch, isDeleting] = useActionState<VoiceVariationActionState, FormData>(
    deleteAction,
    {},
  )
  const [axesState, axesDispatch, isSavingAxes] = useActionState<VoiceVariationActionState, FormData>(
    updateAxesAction,
    {},
  )
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(variation.name)
  const [localAxes, setLocalAxes] = useState<VoiceAxes>(variation.voice_axes)

  function handleRename() {
    if (!nameValue.trim() || nameValue === variation.name) { setEditingName(false); return }
    const fd = new FormData()
    fd.set('id', variation.id)
    fd.set('name', nameValue.trim())
    renameDispatch(fd)
    setEditingName(false)
  }

  function handleDelete() {
    const fd = new FormData()
    fd.set('id', variation.id)
    deleteDispatch(fd)
  }

  function handleSaveAxes() {
    const fd = new FormData()
    fd.set('id', variation.id)
    for (const [k, v] of Object.entries(localAxes)) fd.set(k, String(v))
    axesDispatch(fd)
  }

  return (
    <li className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 px-4 py-3">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setEditingName(false)
            }}
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="flex-1 text-left text-sm font-medium hover:text-primary transition-colors"
            title={t('rename_hint')}
          >
            {variation.name}
          </button>
        )}

        {renameState.error && <span className="text-xs text-destructive">{t('error_generic')}</span>}
        {isRenaming && <span className="text-xs text-muted-foreground">{t('saving')}</span>}

        <button
          type="button"
          onClick={onToggleExpand}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? t('collapse') : t('fine_tune')}
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-xs text-destructive hover:text-destructive/70 disabled:opacity-40 transition-colors"
          aria-label={`${t('delete')} ${variation.name}`}
        >
          {isDeleting ? '…' : t('delete')}
        </button>

        {deleteState.error && <span className="text-xs text-destructive">{t('error_generic')}</span>}
      </div>

      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          <div className="space-y-3">
            {AXIS_ORDER.map(axis => (
              <AxisTrack
                key={axis}
                lowLabel={AXIS_LABELS[axis][0]}
                highLabel={AXIS_LABELS[axis][1]}
                value={localAxes[axis]}
                locked={false}
                highlighted={false}
                onChange={v => setLocalAxes(prev => ({ ...prev, [axis]: v }))}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveAxes}
              disabled={isSavingAxes}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {isSavingAxes ? t('saving') : t('save_axes')}
            </button>
            {axesState.success && <span className="text-xs text-muted-foreground">{t('saved')}</span>}
            {axesState.error && <span className="text-xs text-destructive">{t('error_generic')}</span>}
          </div>
        </div>
      )}
    </li>
  )
}
