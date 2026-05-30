import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { completeOnboardingAction } from './actions'

export default async function Step4Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('onboarding')

  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
      <OnboardingProgress step={4} />

      <div className="space-y-4 text-center py-8">
        <div className="text-5xl" aria-hidden="true">🎉</div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('step4.title')}</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t('step4.subtitle')}</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <form action={completeOnboardingAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" size="lg">
            {t('step4.cta')}
          </Button>
        </form>

        <Link
          href={`/${locale}/onboarding/step-3`}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  )
}
