import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function MarketingHeader() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.nav')

  return (
    // Fluid Island nav: detached floating glass pill (§5A). The hairline ring
    // + tint replace the old bottom border — no scroll-driven border needed,
    // the island reads as afloat regardless of scroll position.
    <header className="sticky top-4 z-40 px-4">
      <div className="glass-shell mx-auto max-w-2xl">
        <div className="glass-core flex h-14 items-center justify-between gap-4 px-3 pl-5">
          <Link
            href={`/${locale}`}
            className="text-base font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('brand')}
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href={`/${locale}/pricing`}
              className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline"
            >
              {t('pricing')}
            </Link>
            <Link
              href={`/${locale}/login`}
              className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline"
            >
              {t('signin')}
            </Link>
            <Link
              href={`/${locale}/signup`}
              className={cn(
                buttonVariants({ variant: 'brand', size: 'sm' }),
                'magnetic-cta rounded-full pr-1.5'
              )}
            >
              <span>{t('cta')}</span>
              <span className="cta-orb flex size-6 items-center justify-center rounded-full bg-brand-foreground/15">
                <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3" />
              </span>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  )
}
