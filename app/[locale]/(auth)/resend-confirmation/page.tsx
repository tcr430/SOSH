'use client'

import { useActionState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { resendConfirmationAction, type ResendConfirmationState } from './actions'

const initialState: ResendConfirmationState = {}

export default function ResendConfirmationPage() {
  const t = useTranslations('auth')
  const params = useParams()
  const locale = (params.locale as string) ?? 'en'

  const [state, action, isPending] = useActionState(resendConfirmationAction, initialState)

  if (state.sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('resend_confirmation.title')}</h1>
          <p className="text-muted-foreground">{t('resend_confirmation.sent_if_needs')}</p>
          <Link
            href={`/${locale}/login`}
            className="block text-sm font-medium underline underline-offset-4 hover:text-primary"
          >
            {t('resend_confirmation.back_to_login')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('resend_confirmation.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('resend_confirmation.subtitle')}</p>
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
            />
          </div>

          {state.errors?._form && (
            <p className="text-sm text-destructive text-center">
              {t(state.errors._form as Parameters<typeof t>[0])}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('resend_confirmation.cta')}
          </Button>
        </form>

        <p className="text-center text-sm">
          <Link
            href={`/${locale}/login`}
            className="text-muted-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('resend_confirmation.back_to_login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
