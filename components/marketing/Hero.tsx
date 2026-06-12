import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Hero (ADR 0009 §4.1 row 1). Typography carries the section — no imagery.
 * One-time orchestrated entrance (§8 Amendment A1): pure CSS via
 * @starting-style (`.hero-enter` in globals.css), eyebrow → headline →
 * subhead → CTAs → trust at 70ms steps, headline with a 4px blur settle.
 * Runs off the main thread during page load; no JS, no Section wrapper.
 */

const STEP_MS = 70

function enterDelay(step: number): React.CSSProperties {
  return { '--enter-delay': `${step * STEP_MS}ms` } as React.CSSProperties
}

export default async function Hero() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.hero')

  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-24 text-center sm:pb-32 sm:pt-32">
      <p className="hero-enter text-sm font-medium text-muted-foreground" style={enterDelay(0)}>
        {t('eyebrow')}
      </p>
      <h1
        className="hero-enter hero-enter-blur mt-6 text-balance text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl"
        style={enterDelay(1)}
      >
        {t('headline')}
      </h1>
      <p
        className="hero-enter mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground"
        style={enterDelay(2)}
      >
        {t('subhead')}
      </p>
      <div
        className="hero-enter mt-10 flex flex-col items-center gap-4 sm:flex-row"
        style={enterDelay(3)}
      >
        <Link
          href={`/${locale}/signup`}
          className={cn(buttonVariants({ size: 'lg' }), 'active:scale-[0.98]')}
        >
          {t('cta_primary')}
        </Link>
        <Link
          href={`/${locale}#how`}
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'active:scale-[0.98]')}
        >
          {t('cta_secondary')}
        </Link>
      </div>
      <p className="hero-enter mt-6 text-sm text-muted-foreground" style={enterDelay(4)}>
        {t('trust')}
      </p>
    </section>
  )
}
