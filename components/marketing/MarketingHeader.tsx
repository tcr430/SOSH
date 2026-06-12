import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function MarketingHeader() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.nav')

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href={`/${locale}`}
          className="text-lg font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('brand')}
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            href={`/${locale}/pricing`}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('pricing')}
          </Link>
          <Link
            href={`/${locale}/login`}
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline"
          >
            {t('signin')}
          </Link>
          <Link href={`/${locale}/signup`} className={cn(buttonVariants({ size: 'sm' }))}>
            {t('cta')}
          </Link>
        </nav>
      </div>
    </header>
  )
}
