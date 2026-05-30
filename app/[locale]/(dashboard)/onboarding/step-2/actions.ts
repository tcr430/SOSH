'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getBrandVoice, upsertBrandVoice } from '@/lib/db/brand-voices'
import type { BrandVoiceRow } from '@/lib/db/types'

const step2Schema = z.object({
  tone: z.array(z.string()).default([]),
  target_audience: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  avoid_words: z.array(z.string()).default([]),
  unique_value_prop: z.string().optional(),
  competitors: z.array(z.string()).default([]),
  locale: z.enum(['en', 'pt', 'es']).optional(),
})

export type Step2State = {
  errors?: { _form?: string; [field: string]: string | undefined }
}

export async function saveStep2Action(
  _prev: Step2State,
  formData: FormData,
): Promise<Step2State> {
  const client = await createClient()

  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { errors: { _form: 'generic' } }

  const business = await getBusinessByOwner(client, user.id)
  if (!business) return { errors: { _form: 'generic' } }

  let parsedTone: string[] = []
  try {
    const raw = JSON.parse((formData.get('tone') as string) ?? '[]')
    parsedTone = z.array(z.string()).catch([]).parse(raw)
  } catch {
    parsedTone = []
  }

  const keywordsRaw = String(formData.get('keywords') ?? '')
  const avoidWordsRaw = String(formData.get('avoid_words') ?? '')
  const competitorsRaw = String(formData.get('competitors') ?? '')

  const parsed = step2Schema.safeParse({
    tone: parsedTone,
    target_audience: formData.get('target_audience') || undefined,
    keywords: keywordsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    avoid_words: avoidWordsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    unique_value_prop: formData.get('unique_value_prop') || undefined,
    competitors: competitorsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    locale: formData.get('locale') || undefined,
  })

  if (!parsed.success) return { errors: { _form: 'generic' } }

  const { tone, target_audience, keywords, avoid_words, unique_value_prop, competitors, locale } =
    parsed.data

  await upsertBrandVoice(client, {
    business_id: business.id,
    tone,
    target_audience: target_audience ?? null,
    keywords,
    avoid_words,
    unique_value_prop: unique_value_prop ?? null,
    competitors,
  })

  redirect(`/${locale ?? 'en'}/onboarding/step-3`)
}

export async function getBrandVoiceAction(): Promise<BrandVoiceRow | null> {
  const client = await createClient()

  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null

  const business = await getBusinessByOwner(client, user.id)
  if (!business) return null

  return getBrandVoice(client, business.id)
}
