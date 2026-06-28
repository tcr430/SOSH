'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { VoiceEditor } from '@/components/voice/VoiceEditor'
import { useActiveBusiness } from '@/lib/contexts/business-context'
import { saveVoiceAxesAction, getBrandVoiceAction } from './actions'
import { skipOnboardingAction } from '../actions'
import { inferBrandVoiceAction } from '../infer-brand-voice/actions'
import { SkipButton } from '@/components/onboarding/SkipButton'
import { NEUTRAL_VOICE_AXES } from '@/lib/validation/voice'
import type { BrandVoiceRow } from '@/lib/db/types'
import type { VoiceEditorSavePayload } from '@/lib/voice/editor-state'

type AiErrorCode = 'quota_exceeded' | 'rate_limited' | 'provider_error' | 'invalid_response' | 'timeout'
const KNOWN_AI_ERROR_CODES: AiErrorCode[] = [
  'quota_exceeded', 'rate_limited', 'provider_error', 'invalid_response', 'timeout',
]

function normalizeAiErrorCode(code: string | undefined): AiErrorCode {
  if (code && (KNOWN_AI_ERROR_CODES as string[]).includes(code)) return code as AiErrorCode
  return 'provider_error'
}

const POLL_INTERVAL = 2_000
const POLL_MAX = 30_000

function hasInferredContent(bv: BrandVoiceRow | null): boolean {
  if (!bv) return false
  return !!bv.target_audience
}

function FormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function Step2Form({ locale }: { locale: string }) {
  const t = useTranslations('onboarding')
  const tAiErrors = useTranslations('errors.ai')
  const { brandVoice } = useActiveBusiness()

  const [formData, setFormData] = useState<BrandVoiceRow | null>(brandVoice)
  const [formKey, setFormKey] = useState(0)
  const [pollState, setPollState] = useState<'idle' | 'polling' | 'ready' | 'timeout' | 'failed'>(
    hasInferredContent(brandVoice) ? 'ready' : 'idle',
  )
  const [aiErrorCode, setAiErrorCode] = useState<AiErrorCode>('provider_error')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pollState !== 'idle') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPollState('polling')

    let stopped = false
    let timerId: ReturnType<typeof setTimeout>
    let elapsed = 0

    async function start() {
      const inference = await inferBrandVoiceAction()
      if (stopped) return
      if (!inference.success) {
        setAiErrorCode(normalizeAiErrorCode(inference.errorCode))
        setPollState('failed')
        return
      }
      timerId = setTimeout(poll, POLL_INTERVAL)
    }

    async function poll() {
      if (stopped) return

      const result = await getBrandVoiceAction()

      if (stopped) return

      if (hasInferredContent(result)) {
        setFormData(result)
        setFormKey((k) => k + 1)
        setPollState('ready')
        return
      }

      elapsed += POLL_INTERVAL
      if (elapsed >= POLL_MAX) {
        setPollState('timeout')
        return
      }

      timerId = setTimeout(poll, POLL_INTERVAL)
    }

    start()

    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }, [])

  async function handleSave(payload: VoiceEditorSavePayload) {
    await saveVoiceAxesAction(payload, locale)
  }

  if (pollState === 'polling') {
    return (
      <div className="max-w-lg mx-auto space-y-8 py-8">
        <OnboardingProgress step={2} />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('step2.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('step2.analyzing')}</p>
        </div>
        <FormSkeleton />
      </div>
    )
  }

  const initialAxes = formData?.voice_axes ?? NEUTRAL_VOICE_AXES
  const initialKeywords = formData?.keywords ?? []
  const initialAvoidWords = formData?.avoid_words ?? []
  const isAiSuggested = !!formData?.inferred_from_url && pollState === 'ready'
  const aiSummary = isAiSuggested ? t('step2.subtitle') : null

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <OnboardingProgress step={2} />

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('step2.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {pollState === 'failed'
            ? tAiErrors(aiErrorCode)
            : pollState === 'timeout'
            ? t('step2.inference_failed')
            : t('step2.subtitle')}
        </p>
      </div>

      <VoiceEditor
        key={formKey}
        initialAxes={initialAxes}
        initialKeywords={initialKeywords}
        initialAvoidWords={initialAvoidWords}
        aiSummary={aiSummary}
        onSave={handleSave}
      />

      <div className="flex items-center justify-between pt-2">
        <form action={skipOnboardingAction}>
          <input type="hidden" name="locale" value={locale} />
          <SkipButton label={t('skip')} />
        </form>

        <Link
          href={`/${locale}/onboarding/step-1`}
          className="inline-flex items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  )
}
