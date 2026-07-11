import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

// Quiet, neutral tone (18B posture) — no red-alert scolding. Every failure
// class (mismatch/expired/consumed/revoked/unknown/malformed) renders this
// exact same card (ADR 0014 §4.3, INV-ACCEPT-ANTI-ENUM).
export async function InvalidInviteCard({ locale }: { locale: string }) {
  const t = await getTranslations('auth')

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('invite.accept.invalid_heading')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('invite.accept.invalid')}</p>
        <Link
          href={`/${locale}/login`}
          className="inline-block text-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {t('invite.accept.go_to_login')}
        </Link>
      </div>
    </div>
  )
}
