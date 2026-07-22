import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandVoiceRow } from '@/lib/db/types'
import { getBrandVoice } from '@/lib/db/brand-voices'
import { getVariationForBusiness } from '@/lib/db/voice'
import { vectorToVoiceFields } from '@/lib/voice/translate'

export type CoreVoiceRules = BrandVoiceRow & { readonly descriptor: string }

// MEM-VOICE-THROUGH-EXISTING (ADR 0016 §3.5) — voice has NO dedicated memory
// table; it reads through the existing brand_voices / brand_voice_variations
// stores (ADR 0011). Core voice rules are ALWAYS returned, uncapped,
// unscored — voice is the baseline every generation call needs, not
// "additional evidence" to rank against a query context.
//
// This is the SOLE implementation of voice resolution as of Session 23-D
// (D2). It previously mirrored an inline copy in lib/ai/context.ts, which is
// now deleted — buildCustomerContext calls this function through the
// lib/memory barrel. Do not reintroduce a second copy: the variation-override
// branch below is depended on by lib/campaigns/generate.ts, the only caller
// that passes a voiceVariationId, and two copies drifting apart is what
// MAJOR-3 of the Session 23 review caught.
export async function retrieveVoice(
  client: SupabaseClient,
  businessId: string,
  voiceVariationId?: string | null,
): Promise<CoreVoiceRules | null> {
  const brandVoice = await getBrandVoice(client, businessId)
  if (!brandVoice) return null

  let axesToUse = brandVoice.voice_axes
  if (voiceVariationId) {
    const variation = await getVariationForBusiness(client, voiceVariationId, businessId)
    if (variation) axesToUse = variation.voice_axes
  }
  const { descriptor } = vectorToVoiceFields(axesToUse)
  return { ...brandVoice, voice_axes: axesToUse, descriptor }
}
