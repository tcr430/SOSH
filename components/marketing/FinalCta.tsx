import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'

/** Final CTA (ADR 0009 §4.1 row 7) — restate the promise, repeat the trust line. */
export default async function FinalCta() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.finalCta')

  return (
    <Section className="border-t">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-24">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t('heading')}
        </h2>
        <p className="mt-6 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
          {t('subhead')}
        </p>
        <Link
          href={`/${locale}/signup`}
          className={cn(buttonVariants({ size: 'lg' }), 'mt-10 active:scale-[0.98]')}
        >
          {t('cta')}
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">{t('trust')}</p>
      </div>
    </Section>
  )
}
