'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

const LOCALES = ['en', 'pt', 'es'] as const

/**
 * Footer locale control (ADR 0009 §3.5). Re-routes to the same pathname under
 * the chosen locale. PT/ES render EN strings at launch (§10) — the switcher
 * changes the URL segment and lang attribute, not yet the visible copy.
 */
export default function LocaleSwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const currentLocale = useLocale()
  const t = useTranslations('marketing.footer')

  function switchTo(locale: string) {
    if (locale === currentLocale) return
    // localePrefix is "always", so the pathname starts with /{locale}
    const rest = pathname.replace(/^\/[^/]+/, '')
    router.push(`/${locale}${rest}`)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t('locale_label')}</span>
      <div className="flex items-center gap-1">
        {LOCALES.map((locale, i) => (
          <span key={locale} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/50">·</span>}
            <button
              type="button"
              onClick={() => switchTo(locale)}
              aria-current={locale === currentLocale ? 'true' : undefined}
              className={
                locale === currentLocale
                  ? 'text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                  : 'text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              }
            >
              {locale.toUpperCase()}
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
