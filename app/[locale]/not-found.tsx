import { getTranslations, getLocale } from 'next-intl/server'
import Link from 'next/link'

export default async function LocaleNotFound() {
  const [t, locale] = await Promise.all([
    getTranslations('errors.not_found'),
    getLocale(),
  ])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground [text-wrap:balance]">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[44ch]">
            {t('body')}
          </p>
        </div>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-85 transition-opacity duration-150 motion-reduce:transition-none"
        >
          {t('home')}
        </Link>
      </div>
    </div>
  )
}
