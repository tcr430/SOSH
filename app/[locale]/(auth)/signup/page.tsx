'use client'

import { useActionState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { signupAction, type SignupState } from './actions'

const initialState: SignupState = {}

export default function SignupPage() {
  const t = useTranslations('auth')
  const params = useParams()
  const locale = (params.locale as string) ?? 'en'

  const [state, action, isPending] = useActionState(signupAction, initialState)

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('signup.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('signup.subtitle')}</p>
        </div>

        <form action={action} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('signup.fields.name')}</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              defaultValue={state.values?.name}
              aria-describedby={state.errors?.name ? 'name-error' : undefined}
            />
            {state.errors?.name && (
              <p id="name-error" className="text-sm text-destructive">
                {t(state.errors.name as Parameters<typeof t>[0])}
              </p>
            )}
          </div>

          {/* Work email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('signup.fields.email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.values?.email}
              aria-describedby={state.errors?.email ? 'email-error' : undefined}
            />
            {state.errors?.email && (
              <p id="email-error" className="text-sm text-destructive">
                {t(state.errors.email as Parameters<typeof t>[0])}
                {state.errors.email === 'errors.signup.email_taken' && (
                  <>
                    {' '}
                    <Link
                      href={`/${locale}/login`}
                      className="underline underline-offset-4 hover:text-primary"
                    >
                      {t('signup.login_link')}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('signup.fields.password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby="password-hint password-error"
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              {t('signup.fields.password_hint')}
            </p>
            {state.errors?.password && (
              <p id="password-error" className="text-sm text-destructive">
                {t(state.errors.password as Parameters<typeof t>[0])}
              </p>
            )}
          </div>

          {/* Company name */}
          <div className="space-y-1.5">
            <Label htmlFor="company">{t('signup.fields.company')}</Label>
            <Input
              id="company"
              name="company"
              type="text"
              autoComplete="organization"
              required
              defaultValue={state.values?.company}
              aria-describedby={state.errors?.company ? 'company-error' : undefined}
            />
            {state.errors?.company && (
              <p id="company-error" className="text-sm text-destructive">
                {t(state.errors.company as Parameters<typeof t>[0])}
              </p>
            )}
          </div>

          {/* Form-level error */}
          {state.errors?._form && (
            <p className="text-sm text-destructive text-center">
              {t(state.errors._form as Parameters<typeof t>[0])}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('signup.cta')}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {t('signup.have_account')}{' '}
          <Link
            href={`/${locale}/login`}
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('signup.login_link')}
          </Link>
        </p>
      </div>
    </div>
  )
}
