'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { consumeRateLimit, resolveIp } from '@/lib/auth/rate-limit'

const resetPasswordSchema = z.object({
  code: z.string().min(1),
  password: z
    .string()
    .min(12, 'errors.signup.weak_password')
    .refine((val) => /[a-zA-Z]/.test(val) && /[0-9]/.test(val), {
      message: 'errors.signup.weak_password',
    }),
  confirm: z.string().min(1),
  locale: z.enum(['en', 'pt', 'es']).default('en'),
}).superRefine((data, ctx) => {
  if (data.password !== data.confirm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'errors.reset_password.mismatch',
      path: ['confirm'],
    })
  }
})

export type ResetPasswordState = {
  errors?: {
    password?: string
    confirm?: string
    _form?: string
  }
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    code: formData.get('code'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    locale: formData.get('locale'),
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue.path[0] as string
    if (field === 'password') return { errors: { password: issue.message } }
    if (field === 'confirm') return { errors: { confirm: issue.message } }
    return { errors: { _form: 'errors.reset_password.generic' } }
  }

  const { code, password, locale } = parsed.data

  const ip = resolveIp(await headers())
  const allowed = await consumeRateLimit('reset-password', ip)
  if (!allowed) return { errors: { _form: 'errors.rate_limit' } }

  const client = await createClient()

  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return { errors: { _form: 'errors.reset_password.generic' } }
  }

  const { error: updateError } = await client.auth.updateUser({ password })
  if (updateError) {
    return { errors: { _form: 'errors.reset_password.generic' } }
  }

  redirect(`/${locale}/campaigns`)
}
