'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner, completeOnboarding } from '@/lib/db/businesses'

export async function skipOnboardingAction(formData: FormData) {
  const locale = (formData.get('locale') as string) ?? 'en'
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)
  const business = await getBusinessByOwner(client, user.id)
  if (business) await completeOnboarding(business.id)
  redirect(`/${locale}/campaigns`)
}
