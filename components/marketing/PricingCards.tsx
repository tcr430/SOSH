import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { MARKETING_PLANS, pricingFeatureRows } from '@/lib/stripe/plan'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shared pricing cards (ADR 0009 §5.3). NO PROPS — `/` and `/pricing` render
 * this identically, so the two surfaces cannot drift. Feature rows derive
 * from getPlanCapabilities via pricingFeatureRows; only label templates live
 * in i18n (§5.1). Contextual differences (surrounding heading, FAQ) live
 * outside the component.
 */
export default async function PricingCards() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.pricing')

  return (
    <div>
      <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
        {MARKETING_PLANS.map((plan) => (
          <div key={plan} className="flex flex-col rounded-lg border bg-card p-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t(`tiers.${plan}.name`)}</h3>
              {plan === 'pro' && (
                <span className="rounded-full px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/30">
                  {t('tiers.pro.badge')}
                </span>
              )}
            </div>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight">{t(`tiers.${plan}.price`)}</span>
              <span className="text-sm text-muted-foreground">{t(`tiers.${plan}.cadence`)}</span>
            </p>
            <p className="mt-3 text-sm text-muted-foreground">{t(`tiers.${plan}.tagline`)}</p>
            <ul className="mt-6 flex-1 space-y-3">
              {pricingFeatureRows(plan).map((row) => (
                <li key={row.key} className="flex items-start gap-2 text-sm">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 8.5l3.5 3.5L13 4.5" />
                  </svg>
                  <span>{t(`feature.${row.key}`, row.values)}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`/${locale}/signup`}
              className={cn(buttonVariants({ size: 'lg' }), 'mt-8 w-full')}
            >
              {t(`tiers.${plan}.cta`)}
            </Link>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted-foreground">
        {t('trial_note')}
      </p>
    </div>
  )
}
