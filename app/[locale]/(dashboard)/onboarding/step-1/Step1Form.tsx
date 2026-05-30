'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { useActiveBusiness } from '@/lib/contexts/business-context'
import { saveStep1Action, type Step1State } from './actions'
import { skipOnboardingAction } from '../actions'
import { SkipButton } from '@/components/onboarding/SkipButton'

const INDUSTRIES = ['saas', 'ecommerce', 'agency', 'consulting', 'other'] as const

const initialState: Step1State = {}

export function Step1Form({ locale }: { locale: string }) {
  const t = useTranslations('onboarding')
  const tErrors = useTranslations('errors.onboarding')
  const { activeBusiness } = useActiveBusiness()
  const [state, formAction, isPending] = useActionState(saveStep1Action, initialState)

  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
      <OnboardingProgress step={1} />

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('step1.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('step1.subtitle')}</p>
      </div>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="locale" value={locale} />

        <div className="space-y-1.5">
          <Label htmlFor="name">{t('step1.fields.name')}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            defaultValue={activeBusiness.name}
            required
            aria-describedby={state.errors?.name ? 'name-error' : undefined}
          />
          {state.errors?.name && (
            <p id="name-error" className="text-sm text-destructive">
              {tErrors(state.errors.name)}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website">{t('step1.fields.website')}</Label>
          <Input
            id="website"
            name="website"
            type="url"
            defaultValue={activeBusiness.website ?? ''}
            placeholder="https://"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="industry">{t('step1.fields.industry')}</Label>
          <select
            id="industry"
            name="industry"
            defaultValue={activeBusiness.industry ?? ''}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">—</option>
            {INDUSTRIES.map((key) => (
              <option key={key} value={key}>
                {t(`step1.industry.${key}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">{t('step1.fields.description')}</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={activeBusiness.description ?? ''}
            placeholder={t('step1.fields.description_hint')}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <form action={skipOnboardingAction}>
            <input type="hidden" name="locale" value={locale} />
            <SkipButton label={t('skip')} />
          </form>

          <Button type="submit" disabled={isPending}>
            {isPending ? '…' : t('continue')}
          </Button>
        </div>
      </form>
    </div>
  )
}
