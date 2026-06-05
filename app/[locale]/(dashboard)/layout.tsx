import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { differenceInDays, addDays, parseISO } from 'date-fns'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { getTrialStateMaybe } from '@/lib/db/trial-state'
import { BusinessProvider } from '@/lib/contexts/business-context'
import { DashboardShell } from '@/components/layout/DashboardShell'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const client = await createClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  Sentry.setUser({ id: user.id })

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/signup`)

  const [brandVoice, activeAccounts, trialState] = await Promise.all([
    getBrandVoice(client, business.id),
    listActiveSocialAccounts(client, business.id),
    getTrialStateMaybe(client, business.id),
  ])
  const hasSocialAccounts = activeAccounts.length > 0

  let daysRemaining: number | null = null
  if (business.plan === 'trial' && trialState?.trial_started_at) {
    daysRemaining = Math.max(
      0,
      differenceInDays(addDays(parseISO(trialState.trial_started_at), 14), new Date()),
    )
  }

  // Guard: incomplete onboarding redirects to wizard unless already there
  if (!business.onboarding_completed) {
    const headersList = await headers()
    const pathname = headersList.get('x-pathname') ?? ''
    if (!pathname.includes('/onboarding')) {
      redirect(`/${locale}/onboarding`)
    }
  }

  return (
    <BusinessProvider user={user} activeBusiness={business} brandVoice={brandVoice}>
      <DashboardShell locale={locale} hasSocialAccounts={hasSocialAccounts} daysRemaining={daysRemaining}>
        {children}
      </DashboardShell>
    </BusinessProvider>
  )
}
