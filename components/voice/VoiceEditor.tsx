'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AxisTrack } from './AxisTrack'
import {
  initialEditorState,
  isLocked,
  isFinalStep,
  currentQuestion,
  answerQuestion,
  manuallyAdjustAxes,
  setKeywords,
  setAvoidWords,
  buildSavePayload,
  type VoiceEditorState,
  type VoiceEditorSavePayload,
} from '@/lib/voice/editor-state'
import { CALIBRATION_BANK } from '@/lib/voice/calibration'
import type { VoiceAxes } from '@/lib/validation/voice'
import type { CalibrationOption } from '@/lib/voice/calibration'

const AXIS_ORDER: ReadonlyArray<keyof VoiceAxes> = [
  'formal_casual',
  'expert_peer',
  'serious_playful',
  'reserved_warm',
  'calm_energetic',
  'rational_emotional',
  'exclusive_inclusive',
]

const AXIS_POLES: Record<keyof VoiceAxes, [string, string]> = {
  formal_casual:       ['Formal',    'Casual'],
  expert_peer:         ['Expert',    'Peer'],
  serious_playful:     ['Serious',   'Playful'],
  reserved_warm:       ['Reserved',  'Warm'],
  calm_energetic:      ['Calm',      'Energetic'],
  rational_emotional:  ['Rational',  'Emotional'],
  exclusive_inclusive: ['Exclusive', 'Inclusive'],
}

export interface VoiceEditorProps {
  initialAxes: VoiceAxes
  initialKeywords?: string[]
  initialAvoidWords?: string[]
  /** AI-derived summary line shown atop the left pane */
  aiSummary?: string | null
  onSave: (payload: VoiceEditorSavePayload) => void | Promise<unknown>
}

export function VoiceEditor({
  initialAxes,
  initialKeywords = [],
  initialAvoidWords = [],
  aiSummary,
  onSave,
}: VoiceEditorProps) {
  const t = useTranslations('voiceEditor')
  const tCal = useTranslations('calibration')

  const [state, setState] = useState<VoiceEditorState>(() =>
    initialEditorState(initialAxes, initialKeywords, initialAvoidWords),
  )
  const [highlightedAxes, setHighlightedAxes] = useState<Set<keyof VoiceAxes>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [trackExpanded, setTrackExpanded] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [avoidInput, setAvoidInput] = useState('')

  const locked = isLocked(state)
  const final = isFinalStep(state)
  const question = currentQuestion(state)

  function handleAnswer(option: CalibrationOption) {
    const q = CALIBRATION_BANK[state.step]
    if (!q) return
    setState(prev => answerQuestion(prev, option))
    const targeted = new Set(q.targetsAxes as Array<keyof VoiceAxes>)
    setHighlightedAxes(targeted)
    setTimeout(() => setHighlightedAxes(new Set()), 700)
  }

  function handleAxisChange(axis: keyof VoiceAxes, value: number) {
    if (locked) return
    setState(prev => manuallyAdjustAxes(prev, { ...prev.axes, [axis]: value }))
  }

  function addKeyword() {
    const word = keywordInput.trim()
    if (!word || state.keywords.includes(word)) { setKeywordInput(''); return }
    setState(prev => setKeywords(prev, [...prev.keywords, word]))
    setKeywordInput('')
  }

  function removeKeyword(word: string) {
    setState(prev => setKeywords(prev, prev.keywords.filter(k => k !== word)))
  }

  function addAvoidWord() {
    const word = avoidInput.trim()
    if (!word || state.avoidWords.includes(word)) { setAvoidInput(''); return }
    setState(prev => setAvoidWords(prev, [...prev.avoidWords, word]))
    setAvoidInput('')
  }

  function removeAvoidWord(word: string) {
    setState(prev => setAvoidWords(prev, prev.avoidWords.filter(w => w !== word)))
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave(buildSavePayload(state))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 lg:gap-14">
      {/* ── Left pane: questions then word inputs ── */}
      <div className="flex-1 min-w-0 space-y-6">
        {aiSummary && (
          <p className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3 leading-relaxed">
            {aiSummary}
          </p>
        )}

        {question !== null && !final ? (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {t('question_count', { current: state.step + 1, total: CALIBRATION_BANK.length })}
              </p>
              <p className="text-base font-medium leading-snug">
                {tCal(question.promptKey.replace(/^calibration\./, ''))}
              </p>
            </div>

            <div className="space-y-2">
              {question.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleAnswer(option)}
                  className="w-full text-left rounded-lg border border-input px-4 py-3 text-sm leading-snug hover:border-foreground/40 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {tCal(option.textKey.replace(/^calibration\./, ''))}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // ── Final step: word inputs (L-7) and save ──
          <div className="space-y-6">
            <WordTagSection
              label={t('keywords_label')}
              hint={t('keywords_hint')}
              placeholder={t('keywords_placeholder')}
              tags={[...state.keywords]}
              inputValue={keywordInput}
              onInputChange={setKeywordInput}
              onAdd={addKeyword}
              onRemove={removeKeyword}
            />
            <WordTagSection
              label={t('avoid_label')}
              hint={t('avoid_hint')}
              placeholder={t('avoid_placeholder')}
              tags={[...state.avoidWords]}
              inputValue={avoidInput}
              onInputChange={setAvoidInput}
              onAdd={addAvoidWord}
              onRemove={removeAvoidWord}
            />
            <div className="pt-1">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right pane: 7-axis tracks ──
           Mobile: sticky bottom bar, collapsible; questions render first (L-13).
           lg+: static fixed-width side column, always expanded. */}
      <div className="sticky bottom-0 z-10 bg-background border-t border-border py-3 lg:static lg:border-0 lg:py-0 w-full lg:w-72 xl:w-80 shrink-0">
        {/* Toggle button — mobile only */}
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm text-muted-foreground lg:hidden"
          onClick={() => setTrackExpanded(prev => !prev)}
          aria-expanded={trackExpanded}
          aria-controls="voice-track-panel"
        >
          <span>{trackExpanded ? t('tracks_toggle_hide') : t('tracks_toggle_show')}</span>
          <svg
            aria-hidden="true"
            className={`h-3.5 w-3.5 transition-transform duration-150 ${trackExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Track panel: hidden on mobile until expanded; always visible on desktop */}
        <div
          id="voice-track-panel"
          className={`space-y-5 ${trackExpanded ? 'mt-3' : 'hidden'} lg:mt-0 lg:block`}
        >
          {locked && (
            <p className="text-xs text-muted-foreground">{t('tracks_hint')}</p>
          )}
          {AXIS_ORDER.map(axis => (
            <AxisTrack
              key={axis}
              lowLabel={AXIS_POLES[axis][0]}
              highLabel={AXIS_POLES[axis][1]}
              value={state.axes[axis]}
              locked={locked}
              highlighted={highlightedAxes.has(axis)}
              onChange={v => handleAxisChange(axis, v)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── WordTagSection ────────────────────────────────────────────────────────────

function WordTagSection({
  label,
  hint,
  placeholder,
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
}: {
  label: string
  hint: string
  placeholder: string
  tags: string[]
  inputValue: string
  onInputChange: (v: string) => void
  onAdd: () => void
  onRemove: (tag: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <WordTagInput
        value={inputValue}
        onChange={onInputChange}
        onAdd={onAdd}
        tags={tags}
        onRemove={onRemove}
        placeholder={placeholder}
      />
    </div>
  )
}

// ── WordTagInput ──────────────────────────────────────────────────────────────

function WordTagInput({
  value,
  onChange,
  onAdd,
  tags,
  onRemove,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onAdd: () => void
  tags: string[]
  onRemove: (tag: string) => void
  placeholder: string
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      onAdd()
    } else if (e.key === 'Backspace' && !value && tags.length > 0) {
      onRemove(tags[tags.length - 1])
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 min-h-[38px] rounded-md border border-input bg-transparent px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(tag)}
            aria-label={`Remove ${tag}`}
            className="text-muted-foreground hover:text-foreground leading-none"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onAdd}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
