import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { differenceInDays, addDays, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { getPlanCapabilities } from '@/lib/stripe/plan'
import { PricingCards } from './PricingCards'

type Props = {
  params: Promise<{ locale: string }>
}

export default async function BillingPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('billing')

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const trialState = await getTrialStateMaybe(client, business.id)

  let daysRemaining: number | null = null
  if (business.plan === 'trial' && trialState?.trial_started_at) {
    daysRemaining = Math.max(
      0,
      differenceInDays(addDays(parseISO(trialState.trial_started_at), 14), new Date()),
    )
  }

  const plusCaps = getPlanCapabilities('plus')
  const proCaps = getPlanCapabilities('pro')

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 sm:px-6 space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Current plan banner */}
      <CurrentPlanBanner
        plan={business.plan}
        daysRemaining={daysRemaining}
        trialStarted={!!trialState?.trial_started_at}
        locale={locale}
        hasStripeCustomer={!!business.stripe_customer_id}
        t={t}
      />

      {/* Pricing cards */}
      <PricingCards
        currentPlan={business.plan}
        locale={locale}
        plusCaps={plusCaps}
        proCaps={proCaps}
      />
    </div>
  )
}

function CurrentPlanBanner({
  plan,
  daysRemaining,
  trialStarted,
  locale,
  hasStripeCustomer,
  t,
}: {
  plan: string
  daysRemaining: number | null
  trialStarted: boolean
  locale: string
  hasStripeCustomer: boolean
  t: Awaited<ReturnType<typeof getTranslations<'billing'>>>
}) {
  if (plan === 'trial') {
    const copy = !trialStarted
      ? t('current.trial_not_started')
      : t('current.trial')

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{copy}</p>
        {trialStarted && daysRemaining !== null && (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
            {t.rich('current.days_remaining', { days: daysRemaining })}
          </p>
        )}
      </div>
    )
  }

  const planName = plan.charAt(0).toUpperCase() + plan.slice(1)

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-sm font-medium text-foreground">
        {t('current.paid', { plan: planName })}
        {hasStripeCustomer && (
          <>
            {' '}
            <a
              href={`/${locale}/billing/portal`}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {t('current.manage')}
            </a>
          </>
        )}
      </p>
    </div>
  )
}
