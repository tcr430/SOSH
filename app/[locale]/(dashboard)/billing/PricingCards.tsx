'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { startCheckoutAction } from './actions'
import type { PlanCapabilities } from '@/lib/stripe/plan'
import type { Plan } from '@/lib/db/types'
import type { PaidPlan } from '@/lib/stripe/products'

interface Props {
  currentPlan: Plan
  locale: string
  plusCaps: PlanCapabilities
  proCaps: PlanCapabilities
}

export function PricingCards({ currentPlan, locale, plusCaps, proCaps }: Props) {
  const t = useTranslations('billing')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <PricingCard
        plan="plus"
        caps={plusCaps}
        currentPlan={currentPlan}
        locale={locale}
        features={[
          t('tiers.plus.features.posts'),
          t('tiers.plus.features.campaigns'),
          t('tiers.plus.features.platforms'),
          t('tiers.plus.features.analytics'),
        ]}
        t={t}
      />
      <PricingCard
        plan="pro"
        caps={proCaps}
        currentPlan={currentPlan}
        locale={locale}
        popular
        features={[
          t('tiers.pro.features.posts'),
          t('tiers.pro.features.campaigns'),
          t('tiers.pro.features.platforms'),
          t('tiers.pro.features.analytics'),
          t('tiers.pro.features.inbox'),
        ]}
        t={t}
      />
    </div>
  )
}

function PricingCard({
  plan,
  caps,
  currentPlan,
  locale,
  popular,
  features,
  t,
}: {
  plan: PaidPlan
  caps: PlanCapabilities
  currentPlan: Plan
  locale: string
  popular?: boolean
  features: string[]
  t: ReturnType<typeof useTranslations<'billing'>>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCurrent = currentPlan === plan
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1)
  const tierKey = plan as 'plus' | 'pro'

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const result = await startCheckoutAction(locale, plan)
      if (result.url) {
        window.location.href = result.url
      } else {
        setError(t(`errors.${result.error ?? 'generic'}` as Parameters<typeof t>[0]))
        setLoading(false)
      }
    } catch {
      setError(t('errors.generic'))
      setLoading(false)
    }
  }

  const ctaLabel = isCurrent
    ? t('cta.current')
    : currentPlan !== 'trial'
      ? t('cta.switch', { plan: planName })
      : t('cta.upgrade', { plan: planName })

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-xl border bg-card p-6 shadow-sm',
        popular && 'border-primary ring-1 ring-primary',
      )}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
          {t('tiers.pro.popular')}
        </span>
      )}

      <div className="mb-6 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{t(`tiers.${tierKey}.name`)}</h2>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tracking-tight">{t(`tiers.${tierKey}.price`)}</span>
          <span className="text-sm text-muted-foreground">{t(`tiers.${tierKey}.cadence`)}</span>
        </div>
      </div>

      <ul className="mb-8 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mb-3 text-xs text-destructive">{error}</p>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={isCurrent || loading}
        className={cn(
          buttonVariants({ variant: isCurrent ? 'outline' : 'default' }),
          'w-full',
          (isCurrent || loading) && 'opacity-60 cursor-not-allowed',
        )}
      >
        {loading ? t('cta.loading') : ctaLabel}
      </button>
    </div>
  )
}
