'use client'

import { useState, useEffect, KeyboardEvent, useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { useActiveBusiness } from '@/lib/contexts/business-context'
import { saveStep2Action, getBrandVoiceAction, type Step2State } from './actions'
import { skipOnboardingAction } from '../actions'
import { inferBrandVoiceAction } from '../infer-brand-voice/actions'
import { SkipButton } from '@/components/onboarding/SkipButton'
import type { BrandVoiceRow } from '@/lib/db/types'

type AiErrorCode = 'quota_exceeded' | 'rate_limited' | 'provider_error' | 'invalid_response' | 'timeout'
const KNOWN_AI_ERROR_CODES: AiErrorCode[] = ['quota_exceeded', 'rate_limited', 'provider_error', 'invalid_response', 'timeout']

function normalizeAiErrorCode(code: string | undefined): AiErrorCode {
  if (code && (KNOWN_AI_ERROR_CODES as string[]).includes(code)) return code as AiErrorCode
  return 'provider_error'
}

const TONE_OPTIONS = [
  'professional', 'conversational', 'authoritative',
  'friendly', 'educational', 'inspiring', 'bold', 'witty',
] as const

const POLL_INTERVAL = 2_000
const POLL_MAX = 30_000

function hasInferredContent(bv: BrandVoiceRow | null): boolean {
  if (!bv) return false
  return bv.tone.length > 0 || !!bv.target_audience || bv.keywords.length > 0
}

const initialFormState: Step2State = {}

function TagInput({
  name,
  initialTags,
  placeholder,
}: {
  name: string
  initialTags: string[]
  placeholder: string
}) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [input, setInput] = useState('')

  function addTag() {
    const trimmed = input.trim()
    if (trimmed && !tags.includes(trimmed)) setTags((prev) => [...prev, trimmed])
    setInput('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !input) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={tags.join(',')} />
      <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-md border border-input bg-transparent px-3 py-2">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1 cursor-pointer"
            onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
          >
            {tag} ×
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-violet-200 px-2 py-0.5 text-xs font-normal text-violet-600">
      {label}
    </span>
  )
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

function BrandVoiceFields({
  locale,
  formData,
  isAiSuggested,
}: {
  locale: string
  formData: BrandVoiceRow | null
  isAiSuggested: boolean
}) {
  const t = useTranslations('onboarding')
  const tErrors = useTranslations('errors.onboarding')
  const [selectedTones, setSelectedTones] = useState<string[]>(formData?.tone ?? [])
  const [state, formAction, isPending] = useActionState(saveStep2Action, initialFormState)

  function toggleTone(tone: string) {
    setSelectedTones((prev) =>
      prev.includes(tone) ? prev.filter((t) => t !== tone) : [...prev, tone],
    )
  }

  const showBadge = (hasValue: boolean) => isAiSuggested && hasValue

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tone" value={JSON.stringify(selectedTones)} />

      {state.errors?._form && (
        <p role="alert" className="text-sm text-destructive">
          {tErrors(state.errors._form)}
        </p>
      )}

      <div className="space-y-2">
        <Label>
          {t('step2.fields.tone')}
          {showBadge(selectedTones.length > 0) && <AiBadge label={t('step2.ai_suggested')} />}
        </Label>
        <p className="text-xs text-muted-foreground">{t('step2.fields.tone_hint')}</p>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((tone) => {
            const active = selectedTones.includes(tone)
            return (
              <button
                key={tone}
                type="button"
                onClick={() => toggleTone(tone)}
                className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-input text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                {t(`step2.tones.${tone}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="target_audience">
          {t('step2.fields.target_audience')}
          {showBadge(!!formData?.target_audience) && <AiBadge label={t('step2.ai_suggested')} />}
        </Label>
        <Textarea
          id="target_audience"
          name="target_audience"
          rows={2}
          defaultValue={formData?.target_audience ?? ''}
          placeholder={t('step2.fields.target_audience_hint')}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          {t('step2.fields.keywords')}
          {showBadge((formData?.keywords?.length ?? 0) > 0) && (
            <AiBadge label={t('step2.ai_suggested')} />
          )}
        </Label>
        <TagInput
          name="keywords"
          initialTags={formData?.keywords ?? []}
          placeholder={t('step2.fields.keywords_hint')}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          {t('step2.fields.avoid_words')}
          {showBadge((formData?.avoid_words?.length ?? 0) > 0) && (
            <AiBadge label={t('step2.ai_suggested')} />
          )}
        </Label>
        <TagInput
          name="avoid_words"
          initialTags={formData?.avoid_words ?? []}
          placeholder={t('step2.fields.avoid_words_hint')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="unique_value_prop">
          {t('step2.fields.unique_value_prop')}
          {showBadge(!!formData?.unique_value_prop) && (
            <AiBadge label={t('step2.ai_suggested')} />
          )}
        </Label>
        <Textarea
          id="unique_value_prop"
          name="unique_value_prop"
          rows={2}
          defaultValue={formData?.unique_value_prop ?? ''}
          placeholder={t('step2.fields.unique_value_prop_hint')}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          {t('step2.fields.competitors')}
          {showBadge((formData?.competitors?.length ?? 0) > 0) && (
            <AiBadge label={t('step2.ai_suggested')} />
          )}
        </Label>
        <TagInput
          name="competitors"
          initialTags={formData?.competitors ?? []}
          placeholder={t('step2.fields.competitors_hint')}
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <form action={skipOnboardingAction}>
          <input type="hidden" name="locale" value={locale} />
          <SkipButton label={t('skip')} />
        </form>

        <div className="flex gap-3">
          <Link
            href={`/${locale}/onboarding/step-1`}
            className="inline-flex items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {t('back')}
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? '…' : t('continue')}
          </Button>
        </div>
      </div>
    </form>
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

  const isAiSuggested = !!formData?.inferred_from_url && pollState === 'ready'

  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
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

      <BrandVoiceFields
        key={formKey}
        locale={locale}
        formData={formData}
        isAiSuggested={isAiSuggested}
      />
    </div>
  )
}
