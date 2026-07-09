'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser, updateBusiness } from '@/lib/db/businesses'
import { inferBrandVoiceAction } from '../infer-brand-voice/actions'

const step1Schema = z.object({
  locale: z.enum(['en', 'pt', 'es']).default('en'),
  name: z.string().min(1, 'name_required'),
  website: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
})

export type Step1State = { errors?: { name?: string; _form?: string } }

export async function saveStep1Action(
  _prev: Step1State,
  formData: FormData,
): Promise<Step1State> {
  const parsed = step1Schema.safeParse({
    locale: formData.get('locale'),
    name: formData.get('name'),
    website: formData.get('website') ?? '',
    industry: formData.get('industry') ?? '',
    description: formData.get('description') ?? '',
  })

  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((i) => i.path[0] === 'name')
    return { errors: { name: nameIssue?.message } }
  }

  const { locale, name, website, industry, description } = parsed.data
  const client = await createClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) return { errors: { _form: 'generic' } }

  const business = await getBusinessForUser(client, user.id)
  if (!business) return { errors: { _form: 'generic' } }

  await updateBusiness(client, business.id, {
    name,
    website: website || null,
    industry: industry || null,
    description: description || null,
  })

  after(() => {
    void inferBrandVoiceAction()
  })

  redirect(`/${locale}/onboarding/step-2`)
}
