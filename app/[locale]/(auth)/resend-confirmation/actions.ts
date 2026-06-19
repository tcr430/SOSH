'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'
import { canonicalizeEmail } from '@/lib/auth/email'

const resendConfirmationSchema = z.object({
  email: z.preprocess(
    (val) => (typeof val === 'string' ? canonicalizeEmail(val) : val),
    z.string().email(),
  ),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
})

export type ResendConfirmationState = {
  sent?: boolean
  errors?: {
    _form?: string
  }
}

export async function resendConfirmationAction(
  _prevState: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const parsed = resendConfirmationSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })

  // Always return sent:true regardless of validation outcome — never reveal
  // whether a given email address is registered or needs confirmation.
  if (!parsed.success) {
    return { sent: true }
  }

  const { email } = parsed.data

  const ip = resolveIp(await headers())
  const allowed = await consumeRateLimit('resend-confirmation', ip, email)
  if (!allowed) return { errors: { _form: 'errors.rate_limit' } }

  const client = await createClient()
  await client.auth.resend({ type: 'signup', email })

  return { sent: true }
}
