'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { key: 'accounts', href: 'accounts', enabled: true },
  { key: 'voice',    href: 'voice',    enabled: true },
  { key: 'billing',  href: 'billing',  enabled: false },
  { key: 'profile',  href: 'profile',  enabled: false },
] as const

export function SettingsNav({ locale }: { locale: string }) {
  const t = useTranslations('settings.nav')
  const pathname = usePathname()

  return (
    <nav className="w-44 shrink-0">
      <ul className="space-y-0.5">
        {NAV_ITEMS.map(({ key, href, enabled }) => {
          const isActive =
            pathname === `/${locale}/settings/${href}` ||
            pathname.startsWith(`/${locale}/settings/${href}/`)

          if (!enabled) {
            return (
              <li key={key}>
                <span className="flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground/40 cursor-not-allowed select-none">
                  {t(key)}
                </span>
              </li>
            )
          }

          return (
            <li key={key}>
              <Link
                href={`/${locale}/settings/${href}`}
                className={cn(
                  'flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
