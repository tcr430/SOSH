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
// "additional evidence" to rank against a query context. This mirrors the
// resolvedBrandVoice logic in lib/ai/context.ts:87-96 exactly, so B3's
// rewire can call this instead of duplicating it.
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
