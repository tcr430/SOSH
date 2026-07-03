import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
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
    <div className="hero-bg">
    <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-28 pt-28 text-center sm:pb-36 sm:pt-36">
      <p
        className="hero-enter rounded-full border border-border/70 bg-background/60 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase backdrop-blur-sm"
        style={enterDelay(0)}
      >
        {t('eyebrow')}
      </p>
      <h1
        className="hero-enter hero-enter-blur mt-8 text-balance text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl"
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
          className={cn(
            buttonVariants({ variant: 'brand', size: 'lg' }),
            'magnetic-cta rounded-full py-5 pr-2 pl-6'
          )}
        >
          <span>{t('cta_primary')}</span>
          <span className="cta-orb flex size-7 items-center justify-center rounded-full bg-brand-foreground/15">
            <ChevronRight aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </span>
        </Link>
        <Link
          href={`/${locale}#how`}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'active:scale-[0.98] rounded-full py-5'
          )}
        >
          {t('cta_secondary')}
        </Link>
      </div>
    </section>
    </div>
  )
}
