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
  // MAJOR-1/MINOR-10 (Session 32-D, D8) — the role is fixed at ratification
  // (run.account_role) and shown here, never editable: step-2/page.tsx only
  // renders this component for a 'ratified' run, so account_role is always
  // non-null by the time this component mounts.
  const accountRole: BackfillAccountRole = run.account_role ?? 'founder'
  const [selectedExamples, setSelectedExamples] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<SocialBackfillRunRow>(run)

  // Field-name fix (found while implementing D8): runVoiceSynthesisPass
  // spreads the model's BrandVoiceOutput (camelCase `voiceAxes`) plus its
  // own `examples` field into staged_voice — this read snake_case keys
  // (`voice_axes`, `writing_examples`) that were never written, so a real
  // run's axes and examples never actually reached this component.
  const stagedVoice = (run.staged_voice ?? {}) as { voiceAxes?: VoiceAxes; examples?: string[] }
  const axes = stagedVoice.voiceAxes
  const stagedExamples = stagedVoice.examples ?? []
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
      // MAJOR-1 (Session 32-D, D8) — accountRole is never sent; the action
      // routes strictly by run.account_role (set at ratification).
      const payload =
        accountRole === 'brand'
          ? { runId: run.id, tone: [], keywords: [], avoidWords: [], writingExamples: [...selectedExamples] }
          : { runId: run.id }
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

      {/* MAJOR-1/MINOR-10 (Session 32-D, D8) — role is declared at ratify
          and shown here, never re-editable. */}
      <p className="text-sm">
        <span className="font-medium">{t('role.question')} </span>
        {accountRole === 'brand' ? t('role.brand') : t('role.founder')}
      </p>

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
