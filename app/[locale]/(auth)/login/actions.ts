'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
  redirectTo: z.string().optional(),
})

const resendSchema = z.object({
  email: z.string().email(),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
})

export type LoginState = {
  errors?: {
    _form?: string
  }
  unconfirmedEmail?: string
  resendSuccess?: boolean
  values?: {
    email?: string
  }
}

export type ResendState = {
  success?: boolean
  error?: string
}

function isSafeRedirect(value: string, locale: string): boolean {
  return (
    value.startsWith(`/${locale}/`) &&
    !value.includes('://') &&
    !value.includes('..')
  )
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
    if (error.message.toLowerCase().includes('email not confirmed')) {
      return { unconfirmedEmail: email, values: { email } }
    }
    // Deliberately vague — do not reveal whether the email exists.
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

export async function resendConfirmationAction(
  _prevState: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const parsed = resendSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })

  if (!parsed.success) {
    return { error: 'errors.signup.generic' }
  }

  const client = await createClient()
  await client.auth.resend({ type: 'signup', email: parsed.data.email })

  // Always return success — never reveal whether the email is registered.
  return { success: true }
}
