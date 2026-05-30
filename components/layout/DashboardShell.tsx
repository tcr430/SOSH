'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Megaphone,
  CalendarDays,
  BarChart2,
  Inbox,
  Settings,
  CreditCard,
  ChevronDown,
  LogOut,
  User,
  X,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveBusiness } from '@/lib/contexts/business-context'
import { logoutAction } from '@/app/[locale]/(dashboard)/actions'

const ACTIVE_NAV = [
  { key: 'campaigns', href: 'campaigns',         icon: Megaphone  },
  { key: 'billing',   href: 'billing',            icon: CreditCard },
  { key: 'settings',  href: 'settings/accounts', icon: Settings   },
] as const

const COMING_SOON_NAV = [
  { key: 'calendar',  icon: CalendarDays },
  { key: 'inbox',     icon: Inbox        },
  { key: 'analytics', icon: BarChart2    },
] as const

const BANNER_KEY = 'sosh_connect_banner_dismissed'
const TRIAL_BILLING_BANNER_KEY = 'sosh_trial_billing_banner_dismissed'

export function DashboardShell({
  locale,
  hasSocialAccounts,
  daysRemaining,
  children,
}: {
  locale: string
  hasSocialAccounts: boolean
  daysRemaining: number | null
  children: React.ReactNode
}) {
  const t = useTranslations('nav')
  const tDashboard = useTranslations('dashboard')
  const pathname = usePathname()
  const { activeBusiness, user } = useActiveBusiness()
  const [bannerDismissed, setBannerDismissed] = useState(true)
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBannerDismissed(sessionStorage.getItem(BANNER_KEY) === '1')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrialBannerDismissed(sessionStorage.getItem(TRIAL_BILLING_BANNER_KEY) === '1')
  }, [])

  function dismissBanner() {
    sessionStorage.setItem(BANNER_KEY, '1')
    setBannerDismissed(true)
  }

  function dismissTrialBanner() {
    sessionStorage.setItem(TRIAL_BILLING_BANNER_KEY, '1')
    setTrialBannerDismissed(true)
  }

  const showBanner = !hasSocialAccounts && !bannerDismissed
  const showTrialBanner =
    hasSocialAccounts &&
    activeBusiness.plan === 'trial' &&
    daysRemaining !== null &&
    !trialBannerDismissed

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-card px-3 py-6 gap-1">
        <div className="px-3 mb-6">
          <span className="text-lg font-semibold tracking-tight">SŌSH</span>
        </div>

        {ACTIVE_NAV.map(({ key, href, icon: Icon }) => {
          const isActive = pathname.includes(`/${key === 'settings' ? 'settings' : href}`)
          const showDot = key === 'settings' && !hasSocialAccounts
          return (
            <Link
              key={key}
              href={`/${locale}/${href}`}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(key)}
              {showDot && (
                <span className="ml-auto h-2 w-2 rounded-full bg-amber-400 shrink-0" />
              )}
            </Link>
          )
        })}

        <div className="my-1 border-t border-border" />

        {COMING_SOON_NAV.map(({ key, icon: Icon }) => (
          <span
            key={key}
            title={t('coming_soon')}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground opacity-50 cursor-not-allowed select-none"
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(key)}
            <span className="ml-auto text-[10px] font-normal leading-none opacity-70">
              {t('coming_soon')}
            </span>
          </span>
        ))}
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <span className="text-sm font-medium text-foreground truncate max-w-xs">
            {activeBusiness.name}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors outline-none">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">
                {user.user_metadata?.full_name ?? user.email}
              </span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <Link
                  href={`/${locale}/settings/profile`}
                  className="flex w-full items-center gap-2"
                >
                  <User className="h-4 w-4" />
                  {t('profile')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <form action={logoutAction} className="w-full">
                  <input type="hidden" name="locale" value={locale} />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2"
                  >
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Connection banner */}
        {showBanner && (
          <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-6 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
            <Link
              href={`/${locale}/settings/accounts`}
              className="text-sm font-medium text-amber-800 hover:underline dark:text-amber-300"
            >
              {tDashboard('banner.no_accounts')}
            </Link>
            <button
              type="button"
              onClick={dismissBanner}
              aria-label="Dismiss"
              className="text-amber-600 hover:text-amber-900 dark:text-amber-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Trial expiry billing banner — only when social connected, mutually exclusive with connect banner */}
        {showTrialBanner && (
          <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-6 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
            <Link
              href={`/${locale}/billing`}
              className="text-sm font-medium text-amber-800 hover:underline dark:text-amber-300"
            >
              {tDashboard.rich('banner.trial_active', { days: daysRemaining ?? 0 })}
            </Link>
            <button
              type="button"
              onClick={dismissTrialBanner}
              aria-label="Dismiss"
              className="text-amber-600 hover:text-amber-900 dark:text-amber-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
