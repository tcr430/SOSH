'use client'

import { useActionState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  loginAction,
  resendConfirmationAction,
  type LoginState,
  type ResendState,
} from './actions'

const loginInitial: LoginState = {}
const resendInitial: ResendState = {}

export default function LoginPage() {
  const t = useTranslations('auth')
  const params = useParams()
  const searchParams = useSearchParams()
  const locale = (params.locale as string) ?? 'en'
  const redirectTo = searchParams.get('redirect') ?? ''

  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, loginInitial)
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendConfirmationAction,
    resendInitial,
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('login.title')}</h1>
        </div>

        <form action={loginFormAction} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

          <div className="space-y-1.5">
            <Label htmlFor="email">{t('login.fields.email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={loginState.values?.email}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('login.fields.password')}</Label>
              <Link
                href={`/${locale}/forgot-password`}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-primary"
              >
                {t('login.forgot_password')}
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {loginState.errors?._form && (
            <p className="text-sm text-destructive text-center">
              {t(loginState.errors._form as Parameters<typeof t>[0])}
            </p>
          )}

          {loginState.unconfirmedEmail && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-sm text-amber-800">
                {t('errors.login.confirm_email')}
              </p>
              {resendState.success ? (
                <p className="text-sm font-medium text-green-700">
                  {t('login.resend_confirmation')} ✓
                </p>
              ) : (
                <form action={resendFormAction}>
                  <input type="hidden" name="email" value={loginState.unconfirmedEmail} />
                  <input type="hidden" name="locale" value={locale} />
                  <button
                    type="submit"
                    disabled={resendPending}
                    className="text-sm font-medium text-amber-900 underline underline-offset-4 hover:text-amber-700 disabled:opacity-50"
                  >
                    {resendPending ? '…' : t('login.resend_confirmation')}
                  </button>
                </form>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loginPending}>
            {loginPending ? '…' : t('login.cta')}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {t('login.no_account')}{' '}
          <Link
            href={`/${locale}/signup`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('login.signup_link')}
          </Link>
        </p>
      </div>
    </div>
  )
}
