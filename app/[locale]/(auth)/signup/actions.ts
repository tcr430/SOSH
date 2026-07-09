'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'
import { createBusiness } from '@/lib/db/businesses'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { workEmailSchema } from '@/lib/validation/email'
import { config } from '@/lib/config'
import type { Language } from '@/lib/db/types'

const passwordSchema = z
  .string()
  .min(12, 'errors.signup.weak_password')
  .refine((val) => /[a-zA-Z]/.test(val) && /[0-9]/.test(val), {
    message: 'errors.signup.weak_password',
  })

// Founding signup: creates a new trial business, so the work-email restriction
// (block free providers) applies and a company name is required.
const signupSchema = z.object({
  name: z.string().min(1, 'errors.signup.name_required'),
  email: workEmailSchema,
  password: passwordSchema,
  company: z.string().min(1, 'errors.signup.company_required'),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
})

// Invite-flavored signup (ADR 0014 §4.5): joining an EXISTING business, not
// starting a trial — no company field, no free-provider restriction (the
// email is a pre-vetted, locked value from the invite, not a founder's pick).
// The field lock is UI-level only; the RPC's email-match remains the
// ultimate guard (INV-SIGNUP-EMAIL-LOCKED).
const inviteSignupSchema = z.object({
  name: z.string().min(1, 'errors.signup.name_required'),
  email: z.string().email('errors.email.invalid_format'),
  password: passwordSchema,
  locale: z.enum(['en', 'pt', 'es']).default('en'),
  token: z.string().min(1),
})

export type SignupState = {
  errors?: {
    name?: string
    email?: string
    password?: string
    company?: string
    _form?: string
  }
  values?: {
    name?: string
    email?: string
    company?: string
  }
}

export async function signupAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const rawToken = formData.get('token')
  const isInviteFlow = typeof rawToken === 'string' && rawToken.length > 0

  const parsed = isInviteFlow
    ? inviteSignupSchema.safeParse({
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        locale: formData.get('locale'),
        token: rawToken,
      })
    : signupSchema.safeParse({
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        company: formData.get('company'),
        locale: formData.get('locale'),
      })

  if (!parsed.success) {
    const fieldErrors: SignupState['errors'] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as string
      if (field === 'name' && !fieldErrors.name) fieldErrors.name = issue.message
      else if (field === 'email' && !fieldErrors.email) fieldErrors.email = issue.message
      else if (field === 'password' && !fieldErrors.password) fieldErrors.password = issue.message
      else if (field === 'company' && !fieldErrors.company) fieldErrors.company = issue.message
    }
    return {
      errors: fieldErrors,
      values: {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        company: String(formData.get('company') ?? ''),
      },
    }
  }

  const { name, email, password, locale } = parsed.data
  const company = 'company' in parsed.data ? parsed.data.company : ''
  const token = 'token' in parsed.data ? parsed.data.token : undefined

  const ip = resolveIp(await headers())
  const allowed = await consumeRateLimit('signup', ip)
  if (!allowed) return { errors: { _form: 'errors.rate_limit' } }

  const client = await createClient()

  const { data: authData, error: authError } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      ...(token
        ? { emailRedirectTo: `${config.server.APP_URL}/${locale}/invite/accept?token=${encodeURIComponent(token)}` }
        : {}),
    },
  })

  if (authError) {
    if (authError.message.toLowerCase().includes('already registered')) {
      return { errors: { email: 'errors.signup.email_taken' }, values: { name, email, company } }
    }
    return { errors: { _form: 'errors.signup.generic' }, values: { name, email, company } }
  }

  const userId = authData.user?.id
  if (!userId) {
    return { errors: { _form: 'errors.signup.generic' }, values: { name, email, company } }
  }

  // Invite-flavored signup joins an EXISTING business — no business/brand-voice
  // is created here. The invite/accept route (§4) performs the accept_invite
  // bind once a session exists, whether that's immediately (email confirmation
  // disabled) or after the Supabase confirm-email PKCE bounce.
  if (token) {
    redirect(`/${locale}/invite/accept?token=${encodeURIComponent(token)}`)
  }

  // Service-role bypasses RLS so business creation succeeds even when email
  // confirmation is required (no session cookie exists yet in that case).
  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()

    const business = await createBusiness(serviceClient, {
      name: company,
      owner_id: userId,
      plan: 'trial',
      language: locale as Language,
    })

    await upsertBrandVoice(serviceClient, { business_id: business.id })
  } catch (err) {
    console.error('[signup] Post-auth setup failed for user', userId, err)
    return {
      errors: { _form: 'errors.signup.setup_incomplete' },
      values: { name, email, company },
    }
  }

  redirect(`/${locale}/onboarding`)
}
