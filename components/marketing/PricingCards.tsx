import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { MARKETING_PLANS, pricingFeatureRows } from '@/lib/stripe/plan'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { StaggerItem } from '@/components/marketing/Section'

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
        {MARKETING_PLANS.map((plan) => {
          const isPro = plan === 'pro'
          return (
          <div key={plan} className={cn('glass-shell', isPro && 'bg-foreground/8')}>
            <div
              className={cn(
                'glass-core flex h-full flex-col p-8',
                isPro && 'bg-foreground text-background'
              )}
            >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t(`tiers.${plan}.name`)}</h3>
              {isPro && (
                <span className="rounded-full px-3 py-1 text-xs font-medium ring-1 text-background/80 ring-background/20">
                  {t('tiers.pro.badge')}
                </span>
              )}
            </div>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight">{t(`tiers.${plan}.price`)}</span>
              <span className={cn('text-sm', isPro ? 'text-background/60' : 'text-muted-foreground')}>
                {t(`tiers.${plan}.cadence`)}
              </span>
            </p>
            <p className={cn('mt-3 text-sm', isPro ? 'text-background/70' : 'text-muted-foreground')}>
              {t(`tiers.${plan}.tagline`)}
            </p>
            <ul className="mt-6 flex-1 space-y-3">
              {pricingFeatureRows(plan).map((row, i) => (
                <li key={row.key}>
                  {/* §8 A1: dense list — 40ms stagger draws the eye down in reading order */}
                  <StaggerItem index={i} stepMs={40} className="flex items-start gap-2 text-sm">
                  <Check
                    aria-hidden="true"
                    strokeWidth={2}
                    className={cn('mt-0.5 size-4 shrink-0', isPro ? 'text-background/70' : 'text-brand')}
                  />
                  <span className={isPro ? 'text-background/80' : undefined}>
                    {t(`feature.${row.key}`, row.values)}
                  </span>
                  </StaggerItem>
                </li>
              ))}
            </ul>
            <Link
              href={`/${locale}/signup`}
              className={cn(
                buttonVariants({ variant: isPro ? 'default' : 'brand', size: 'lg' }),
                'magnetic-cta mt-8 w-full rounded-full py-5 pr-2 pl-6',
                isPro && 'bg-background text-foreground hover:bg-background/90'
              )}
            >
              <span className="flex-1 text-left">{t(`tiers.${plan}.cta`)}</span>
              <span
                className={cn(
                  'cta-orb flex size-7 items-center justify-center rounded-full',
                  isPro ? 'bg-foreground/10' : 'bg-brand-foreground/15'
                )}
              >
                <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
              </span>
            </Link>
            </div>
          </div>
          )
        })}
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted-foreground">
        {t('trial_note')}
      </p>
    </div>
  )
}
