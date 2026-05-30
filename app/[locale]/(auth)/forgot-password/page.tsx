'use client'

import { useActionState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { forgotPasswordAction, type ForgotPasswordState } from './actions'

const initialState: ForgotPasswordState = {}

export default function ForgotPasswordPage() {
  const t = useTranslations('auth')
  const params = useParams()
  const locale = (params.locale as string) ?? 'en'

  const [state, action, isPending] = useActionState(forgotPasswordAction, initialState)

  if (state.sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('forgot_password.title')}</h1>
          <p className="text-muted-foreground">{t('forgot_password.sent_if_exists')}</p>
          <Link
            href={`/${locale}/login`}
            className="block text-sm font-medium underline underline-offset-4 hover:text-primary"
          >
            {t('forgot_password.back_to_login')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('forgot_password.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('forgot_password.subtitle')}</p>
        </div>

        <form action={action} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />

          <div className="space-y-1.5">
            <Label htmlFor="email">{t('login.fields.email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.values?.email}
            />
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('forgot_password.cta')}
          </Button>
        </form>

        <p className="text-center text-sm">
          <Link
            href={`/${locale}/login`}
            className="text-muted-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('forgot_password.back_to_login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
