import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBrandVoice } from '@/lib/db/brand-voices'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const client = await createClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/signup`)

  if (business.onboarding_completed) redirect(`/${locale}/campaigns`)

  // Route to the step that needs completing
  if (!business.website && !business.industry && !business.description) {
    redirect(`/${locale}/onboarding/step-1`)
  }

  const brandVoice = await getBrandVoice(client, business.id)
  if (!brandVoice?.target_audience) {
    redirect(`/${locale}/onboarding/step-2`)
  }

  redirect(`/${locale}/onboarding/step-3`)
}
