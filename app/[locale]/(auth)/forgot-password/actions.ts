'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { config } from '@/lib/config'

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
})

export type ForgotPasswordState = {
  sent?: boolean
  values?: {
    email?: string
  }
}

export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })

  // Always return sent:true regardless of validation outcome — never reveal
  // whether a given email address is registered.
  if (!parsed.success) {
    return { sent: true }
  }

  const { email, locale } = parsed.data
  const redirectTo = `${config.server.APP_URL}/${locale}/reset-password`

  const client = await createClient()
  await client.auth.resetPasswordForEmail(email, { redirectTo })

  return { sent: true }
}
