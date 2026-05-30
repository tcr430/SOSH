'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function logoutAction(formData: FormData) {
  const locale = (formData.get('locale') as string) ?? 'en'
  const client = await createClient()
  await client.auth.signOut()
  redirect(`/${locale}/login`)
}
