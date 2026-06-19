'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'
import { isSafeRedirect } from '@/lib/auth/safe-redirect'
import { canonicalizeEmail } from '@/lib/auth/email'

const loginSchema = z.object({
  email: z.preprocess(
    (val) => (typeof val === 'string' ? canonicalizeEmail(val) : val),
    z.string().email(),
  ),
  password: z.string().min(1),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
  redirectTo: z.string().optional(),
})

export type LoginState = {
  errors?: {
    _form?: string
  }
  values?: {
    email?: string
  }
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    locale: formData.get('locale'),
    redirectTo: formData.get('redirectTo') ?? undefined,
  })

  if (!parsed.success) {
    return {
      errors: { _form: 'errors.login.invalid' },
      values: { email: String(formData.get('email') ?? '') },
    }
  }

  const { email, password, locale, redirectTo } = parsed.data

  const ip = resolveIp(await headers())
  const allowed = await consumeRateLimit('login', ip, email)
  if (!allowed) return { errors: { _form: 'errors.rate_limit' } }

  const client = await createClient()

  const { data, error } = await client.auth.signInWithPassword({ email, password })

  if (error) {
    // Deliberately vague — do not reveal whether the email exists or is confirmed.
    // Residual: response shape is uniform across all failure states, but GoTrue may still leak
    // existence via timing (nonexistent user may return faster than wrong-password on a real
    // account, depending on dummy-hash behaviour). Accepted — Supabase owns auth timing;
    // app-layer constant-time is explicitly out of scope and would give false assurance.
    // Matches forgot-password posture. (B18-060)
    return { errors: { _form: 'errors.login.invalid' }, values: { email } }
  }

  const userId = data.user?.id
  if (!userId) {
    return { errors: { _form: 'errors.login.invalid' }, values: { email } }
  }

  const business = await getBusinessByOwner(client, userId)

  if (redirectTo && isSafeRedirect(redirectTo, locale)) {
    redirect(redirectTo)
  }

  if (!business || !business.onboarding_completed) {
    redirect(`/${locale}/onboarding`)
  }

  redirect(`/${locale}/campaigns`)
}
