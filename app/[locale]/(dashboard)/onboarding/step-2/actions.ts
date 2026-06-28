'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getBrandVoice, upsertBrandVoice } from '@/lib/db/brand-voices'
import { voicePayloadSchema } from '@/lib/validation/voice'
import type { BrandVoiceRow } from '@/lib/db/types'
import type { VoiceEditorSavePayload } from '@/lib/voice/editor-state'

export type SaveVoiceAxesResult = { error: 'validation' | 'generic' }

export async function saveVoiceAxesAction(
  payload: VoiceEditorSavePayload,
  locale: string,
): Promise<SaveVoiceAxesResult | undefined> {
  const parsed = voicePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return { error: 'validation' }
  }

  const client = await createClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) return { error: 'generic' }

  const business = await getBusinessByOwner(client, user.id)
  if (!business) return { error: 'generic' }

  await upsertBrandVoice(client, {
    business_id: business.id,
    voice_axes: parsed.data.voiceAxes,
    tone: parsed.data.tone,
    keywords: parsed.data.keywords,
    avoid_words: parsed.data.avoidWords,
  })

  redirect(`/${locale}/onboarding/step-3`)
}

export async function getBrandVoiceAction(): Promise<BrandVoiceRow | null> {
  const client = await createClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) return null

  const business = await getBusinessByOwner(client, user.id)
  if (!business) return null

  return getBrandVoice(client, business.id)
}
