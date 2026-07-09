'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import {
  addVariation,
  renameVariation,
  deleteVariation,
  updateVariationAxes,
  VoiceVariationCapError,
} from '@/lib/db/voice'
import { voiceAxesCoerceSchema, voicePayloadSchema } from '@/lib/validation/voice'
import type { BrandVoiceVariationRow } from '@/lib/db/types'
import type { VoiceAxes } from '@/lib/validation/voice'
import type { VoiceEditorSavePayload } from '@/lib/voice/editor-state'

export type VoiceVariationActionState = {
  success?: boolean
  error?: 'variation_cap_reached' | 'generic'
  variation?: BrandVoiceVariationRow
}

export type SaveBaseVoiceResult = { error?: 'validation' | 'generic'; success?: true }

const AXIS_KEYS = [
  'formal_casual',
  'expert_peer',
  'serious_playful',
  'reserved_warm',
  'calm_energetic',
  'rational_emotional',
  'exclusive_inclusive',
] as const

function parseVoiceAxes(formData: FormData): VoiceAxes {
  const raw = Object.fromEntries(AXIS_KEYS.map(k => [k, formData.get(k)]))
  return voiceAxesCoerceSchema.parse(raw)
}

async function getAuthenticatedBusiness(client: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null
  return getBusinessForUser(client, user.id)
}

export async function saveBaseVoiceAction(payload: VoiceEditorSavePayload): Promise<SaveBaseVoiceResult> {
  const parsed = voicePayloadSchema.safeParse(payload)
  if (!parsed.success) return { error: 'validation' }

  try {
    const client = await createClient()
    const business = await getAuthenticatedBusiness(client)
    if (!business) return { error: 'generic' }

    await upsertBrandVoice(client, {
      business_id: business.id,
      voice_axes: parsed.data.voiceAxes,
      tone: parsed.data.tone,
      keywords: parsed.data.keywords,
      avoid_words: parsed.data.avoidWords,
    })

    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

export async function addVariationAction(
  _prevState: VoiceVariationActionState,
  formData: FormData,
): Promise<VoiceVariationActionState> {
  try {
    const client = await createClient()
    const business = await getAuthenticatedBusiness(client)
    if (!business) return { error: 'generic' }

    const name = formData.get('name') as string
    const voiceAxes = parseVoiceAxes(formData)

    const variation = await addVariation({ businessId: business.id, name, voiceAxes })
    revalidatePath('/[locale]/settings/voice', 'page')
    return { success: true, variation }
  } catch (err) {
    if (err instanceof VoiceVariationCapError) return { error: 'variation_cap_reached' }
    return { error: 'generic' }
  }
}

export async function renameVariationAction(
  _prevState: VoiceVariationActionState,
  formData: FormData,
): Promise<VoiceVariationActionState> {
  try {
    const client = await createClient()
    const business = await getAuthenticatedBusiness(client)
    if (!business) return { error: 'generic' }

    const id = formData.get('id') as string
    const name = formData.get('name') as string

    await renameVariation(client, id, name)
    revalidatePath('/[locale]/settings/voice', 'page')
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

export async function updateVariationAxesAction(
  _prevState: VoiceVariationActionState,
  formData: FormData,
): Promise<VoiceVariationActionState> {
  try {
    const client = await createClient()
    const business = await getAuthenticatedBusiness(client)
    if (!business) return { error: 'generic' }

    const id = formData.get('id') as string
    const voiceAxes = parseVoiceAxes(formData)

    await updateVariationAxes(client, id, voiceAxes)
    revalidatePath('/[locale]/settings/voice', 'page')
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}

export async function deleteVariationAction(
  _prevState: VoiceVariationActionState,
  formData: FormData,
): Promise<VoiceVariationActionState> {
  try {
    const client = await createClient()
    const business = await getAuthenticatedBusiness(client)
    if (!business) return { error: 'generic' }

    const id = formData.get('id') as string
    await deleteVariation(client, id)
    revalidatePath('/[locale]/settings/voice', 'page')
    return { success: true }
  } catch {
    return { error: 'generic' }
  }
}
