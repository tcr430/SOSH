'use server'

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import {
  runPrompt,
  buildCustomerContext,
  brandVoiceInferencePrompt,
  fetchWebsiteText,
  AiError,
} from '@/lib/ai'

export async function inferBrandVoiceAction(): Promise<{ success: boolean; errorCode?: string }> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { success: false }

  const business = await getBusinessForUser(client, user.id)
  if (!business) return { success: false }

  const websiteText = business.website ? await fetchWebsiteText(business.website) : null

  try {
    const ctx = await buildCustomerContext(business.id)
    const result = await runPrompt(brandVoiceInferencePrompt, ctx, {
      writingExamples: [],
      websiteText,
    })

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()

    await upsertBrandVoice(serviceClient, {
      business_id: business.id,
      voice_axes: result.voiceAxes,
      tone: result.tone,
      target_audience: result.targetAudience,
      keywords: result.keywords,
      avoid_words: result.avoidWords,
      unique_value_prop: result.uniqueValueProp,
      competitors: result.competitors,
      inferred_from_url: business.website ?? null,
    })

    return { success: true }
  } catch (err) {
    if (err instanceof AiError) {
      return { success: false, errorCode: err.code }
    }
    return { success: false, errorCode: 'provider_error' }
  }
}
