'use client'

// ADR 0025 §10.3 (Session 32 I2.14) — step-2 backfill mode (?run=<id>).
// Scope note: the ADR text says this pre-fills "the existing VoiceEditor";
// this ships as a dedicated review surface instead, reusing the same
// VoiceAxes type and the same Server Actions (applyBackfillVoiceAction /
// declineBackfillVoiceAction) rather than restructuring VoiceEditor's
// multi-step calibration flow to support an axes-only rendering mode and a
// writing-example chooser — a materially larger change than this step's
// budget covers. The founder/brand behavioural contract (axes-only vs.
// <=3-example chooser, refused/failed states, retry) is unchanged.

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { applyBackfillVoiceAction, declineBackfillVoiceAction } from '../step-4/backfill-actions'
import { AxisTrack } from '@/components/voice/AxisTrack'
import type { VoiceAxes } from '@/lib/validation/voice'
import type { SocialBackfillRunRow, BackfillAccountRole } from '@/lib/db/types'

const AXIS_ORDER: ReadonlyArray<keyof VoiceAxes> = [
  'formal_casual', 'expert_peer', 'serious_playful', 'reserved_warm',
  'calm_energetic', 'rational_emotional', 'exclusive_inclusive',
]
const AXIS_POLES: Record<keyof VoiceAxes, [string, string]> = {
  formal_casual: ['Formal', 'Casual'],
  expert_peer: ['Expert', 'Peer'],
  serious_playful: ['Serious', 'Playful'],
  reserved_warm: ['Reserved', 'Warm'],
  calm_energetic: ['Calm', 'Energetic'],
  rational_emotional: ['Rational', 'Emotional'],
  exclusive_inclusive: ['Exclusive', 'Inclusive'],
}

export function BackfillVoiceReview({
  locale,
  run,
  existingWritingExamples,
}: {
  locale: string
  run: SocialBackfillRunRow
  existingWritingExamples: string[]
}) {
  const t = useTranslations('onboarding.backfill')
  const [isPending, startTransition] = useTransition()
  const [accountRole, setAccountRole] = useState<BackfillAccountRole>(run.account_role ?? 'founder')
  const [selectedExamples, setSelectedExamples] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<SocialBackfillRunRow>(run)

  const stagedVoice = (run.staged_voice ?? {}) as { voice_axes?: VoiceAxes; writing_examples?: string[] }
  const axes = stagedVoice.voice_axes
  const stagedExamples = stagedVoice.writing_examples ?? []
  const allExamples = [...existingWritingExamples, ...stagedExamples]

  function toggleExample(example: string) {
    setSelectedExamples((prev) => {
      const next = new Set(prev)
      if (next.has(example)) next.delete(example)
      else if (next.size < 3) next.add(example)
      return next
    })
  }

  function handleApply() {
    startTransition(async () => {
      const payload =
        accountRole === 'brand'
          ? {
              runId: run.id,
              accountRole: 'brand' as const,
              tone: [],
              keywords: [],
              avoidWords: [],
              writingExamples: [...selectedExamples],
            }
          : { runId: run.id, accountRole: 'founder' as const }
      const res = await applyBackfillVoiceAction(payload)
      if (res.ok) setResult(res.run)
    })
  }

  function handleDecline() {
    startTransition(async () => {
      const res = await declineBackfillVoiceAction({ runId: run.id })
      if (res.ok) setResult(res.run)
    })
  }

  if (!axes) {
    return (
      <div className="max-w-lg mx-auto space-y-4 py-8">
        <OnboardingProgress step={2} />
        <p className="text-sm text-muted-foreground">{t('nothing_to_learn.body')}</p>
        <Link href={`/${locale}/onboarding/step-4`} className="text-sm underline underline-offset-4">
          {t('actions.discard')}
        </Link>
      </div>
    )
  }

  if (result.voice_status === 'applied') {
    return (
      <div className="max-w-lg mx-auto space-y-4 py-8" data-state="applied">
        <OnboardingProgress step={2} />
        <p className="text-sm font-medium">{t('ratified.title')}</p>
        <Link href={`/${locale}/onboarding/step-4`} className="text-sm underline underline-offset-4">
          {t('back')}
        </Link>
      </div>
    )
  }

  if (result.voice_status === 'declined') {
    return (
      <div className="max-w-lg mx-auto space-y-4 py-8" data-state="declined">
        <OnboardingProgress step={2} />
        <p className="text-sm text-muted-foreground">{t('nothing_to_learn.body')}</p>
        <Link href={`/${locale}/onboarding/step-4`} className="text-sm underline underline-offset-4">
          {t('back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8" data-state={result.voice_status ?? 'pending'}>
      <OnboardingProgress step={2} />
      <h1 className="text-2xl font-semibold tracking-tight">{t('voice.summary_title')}</h1>

      {result.voice_status === 'refused_cap' && (
        <p className="text-sm text-destructive">{t('failed.reason.unknown')}</p>
      )}
      {result.voice_status === 'failed' && (
        <p className="text-sm text-destructive">{t('failed.title')}</p>
      )}

      <div className="space-y-3">
        {AXIS_ORDER.map((axis) => (
          <AxisTrack
            key={axis}
            lowLabel={AXIS_POLES[axis][0]}
            highLabel={AXIS_POLES[axis][1]}
            value={axes[axis]}
            locked
            highlighted={false}
          />
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('role.question')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={accountRole === 'founder'} onChange={() => setAccountRole('founder')} />
          {t('role.founder')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={accountRole === 'brand'} onChange={() => setAccountRole('brand')} />
          {t('role.brand')}
        </label>
      </fieldset>

      {accountRole === 'brand' && allExamples.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('performed.title')}</p>
          <ul className="space-y-1">
            {allExamples.map((example, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedExamples.has(example)}
                  onChange={() => toggleExample(example)}
                  disabled={!selectedExamples.has(example) && selectedExamples.size >= 3}
                />
                <span>{example}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button onClick={handleApply} disabled={isPending}>
          {t('actions.ratify')}
        </Button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={isPending}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t('actions.discard')}
        </button>
      </div>
    </div>
  )
}
