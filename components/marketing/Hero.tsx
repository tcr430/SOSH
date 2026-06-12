import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'

/**
 * Hero (ADR 0009 §4.1 row 1). Typography carries the section — no imagery.
 * One-time entrance via the canonical <Section> wrapper (§8).
 */
export default async function Hero() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.hero')

  return (
    <Section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-24 text-center sm:pb-32 sm:pt-32">
      <p className="text-sm font-medium text-muted-foreground">{t('eyebrow')}</p>
      <h1 className="mt-6 text-balance text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
        {t('headline')}
      </h1>
      <p className="mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
        {t('subhead')}
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <Link href={`/${locale}/signup`} className={cn(buttonVariants({ size: 'lg' }))}>
          {t('cta_primary')}
        </Link>
        <Link
          href={`/${locale}#how`}
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
        >
          {t('cta_secondary')}
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{t('trust')}</p>
    </Section>
  )
}
