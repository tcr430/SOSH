'use server'

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listActiveSocialAccounts } from '@/lib/db/social-accounts'
import { listRecentPublishedPostTexts } from '@/lib/db/posts'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import {
  runPrompt,
  buildCustomerContext,
  brandVoiceInferencePrompt,
  AiError,
} from '@/lib/ai'

export type RefineFromPostsResult =
  | { success: true }
  | {
      error: 'no_connected_accounts' | 'no_posts' | 'trial_cap_reached' | 'generic'
      errorCode?: string
    }

const MAX_SAMPLE_POSTS = 3 // cap-3 per ADR 0011 §7

export async function refineFromPostsAction(): Promise<RefineFromPostsResult> {
  const client = await createClient()

  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { error: 'generic' }

  const business = await getBusinessForUser(client, user.id)
  if (!business) return { error: 'generic' }

  const accounts = await listActiveSocialAccounts(client, business.id)
  if (accounts.length === 0) return { error: 'no_connected_accounts' }

  const postTexts = await listRecentPublishedPostTexts(client, business.id, MAX_SAMPLE_POSTS)
  if (postTexts.length === 0) return { error: 'no_posts' }

  try {
    const ctx = await buildCustomerContext(business.id)
    const result = await runPrompt(brandVoiceInferencePrompt, ctx, {
      writingExamples: postTexts,
      websiteText: null,
    })

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()

    await upsertBrandVoice(serviceClient, {
      business_id: business.id,
      voice_axes: result.voiceAxes,
      tone: result.tone,
      keywords: result.keywords,
      avoid_words: result.avoidWords,
    })

    return { success: true }
  } catch (err) {
    if (err instanceof AiError) {
      if (err.code === 'quota_exceeded') {
        return { error: 'trial_cap_reached', errorCode: err.code }
      }
      return { error: 'generic', errorCode: err.code }
    }
    return { error: 'generic' }
  }
}
