import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'

/** Final CTA (ADR 0009 §4.1 row 7) — restate the promise, repeat the trust line. */
export default async function FinalCta() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.finalCta')

  return (
    <Section className="relative overflow-hidden bg-foreground text-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, oklch(0.65 0.18 265 / 0.22), transparent 65%)',
        }}
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t('heading')}
        </h2>
        <p className="mt-6 max-w-2xl text-pretty leading-relaxed text-background/70">
          {t('subhead')}
        </p>
        <Link
          href={`/${locale}/signup`}
          className={cn(
            buttonVariants({ variant: 'brand', size: 'lg' }),
            'magnetic-cta mt-10 rounded-full py-5 pr-2 pl-6'
          )}
        >
          <span>{t('cta')}</span>
          <span className="cta-orb flex size-7 items-center justify-center rounded-full bg-brand-foreground/15">
            <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </span>
        </Link>
        <p className="mt-6 text-sm text-background/50">{t('trust')}</p>
      </div>
    </Section>
  )
}
