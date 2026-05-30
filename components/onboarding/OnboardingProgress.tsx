'use client'

import { useTranslations } from 'next-intl'

export function OnboardingProgress({ step, total = 4 }: { step: number; total?: number }) {
  const t = useTranslations('onboarding')
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('progress', { current: step, total })}</p>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? 'bg-primary' : 'bg-muted'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
