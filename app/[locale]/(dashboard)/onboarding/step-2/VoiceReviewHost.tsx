'use client'

// ADR 0025 §10.3 (Session 32-D, D9, A-7 — REUSE VoiceEditor, not a second
// voice editor, ADR §0 note 1). Replaces the retired BackfillVoiceReview.tsx:
// this is the thin, page-level state/Server-Action host — the actual
// editing surface is the SHARED VoiceEditor's "review" mode (axes-only for
// founder, <=3-example chooser for brand), never a duplicated component.

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { VoiceEditor } from '@/components/voice/VoiceEditor'
import { applyBackfillVoiceAction, declineBackfillVoiceAction } from '../step-4/backfill-actions'
import type { SocialBackfillRunRow, BackfillAccountRole } from '@/lib/db/types'
import type { VoiceAxes } from '@/lib/validation/voice'

export function VoiceReviewHost({
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
  const [result, setResult] = useState<SocialBackfillRunRow>(run)

  // The role is fixed at ratification (run.account_role) — step-2/page.tsx
  // only renders this host for a 'ratified' run, so it is always non-null.
  const accountRole: BackfillAccountRole = run.account_role ?? 'founder'

  const stagedVoice = (run.staged_voice ?? {}) as { voiceAxes?: VoiceAxes; examples?: string[] }
  const axes = stagedVoice.voiceAxes
  const stagedExamples = stagedVoice.examples ?? []
  const allExamples = [...existingWritingExamples, ...stagedExamples]

  function handleApply(writingExamples: string[]) {
    startTransition(async () => {
      const payload =
        accountRole === 'brand'
          ? { runId: run.id, tone: [], keywords: [], avoidWords: [], writingExamples }
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

      <VoiceEditor
        mode="review"
        initialAxes={axes}
        accountRole={accountRole}
        examples={allExamples}
        onApply={handleApply}
        onDecline={handleDecline}
        isPending={isPending}
      />
    </div>
  )
}
