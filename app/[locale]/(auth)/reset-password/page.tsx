'use client'

import { useActionState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { resetPasswordAction, type ResetPasswordState } from './actions'

const initialState: ResetPasswordState = {}

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const params = useParams()
  const searchParams = useSearchParams()
  const locale = (params.locale as string) ?? 'en'
  const code = searchParams.get('code') ?? ''

  const [state, action, isPending] = useActionState(resetPasswordAction, initialState)

  if (!code) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <p className="text-sm text-destructive">
            {t('errors.reset_password.generic' as Parameters<typeof t>[0])}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('reset_password.title')}</h1>
        </div>

        <form action={action} className="space-y-5">
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="locale" value={locale} />

          <div className="space-y-1.5">
            <Label htmlFor="password">{t('reset_password.fields.password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby={state.errors?.password ? 'password-error' : undefined}
            />
            {state.errors?.password && (
              <p id="password-error" className="text-sm text-destructive">
                {t(state.errors.password as Parameters<typeof t>[0])}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">{t('reset_password.fields.confirm')}</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby={state.errors?.confirm ? 'confirm-error' : undefined}
            />
            {state.errors?.confirm && (
              <p id="confirm-error" className="text-sm text-destructive">
                {t(state.errors.confirm as Parameters<typeof t>[0])}
              </p>
            )}
          </div>

          {state.errors?._form && (
            <p className="text-sm text-destructive text-center">
              {t(state.errors._form as Parameters<typeof t>[0])}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('reset_password.cta')}
          </Button>
        </form>
      </div>
    </div>
  )
}
