import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { marketingMetadata } from '@/lib/marketing/metadata'
import Hero from '@/components/marketing/Hero'
import TheGap from '@/components/marketing/TheGap'
import HowItWorks from '@/components/marketing/HowItWorks'
import WhatYouGet from '@/components/marketing/WhatYouGet'
import WhereWeStand from '@/components/marketing/WhereWeStand'
import FinalCta from '@/components/marketing/FinalCta'
import PricingCards from '@/components/marketing/PricingCards'
import { Section } from '@/components/marketing/Section'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return marketingMetadata(locale, 'home')
}

// `/{locale}` — the canonical homepage spine (ADR 0009 §3.4, §4.1).
// The pricing heading lives here, outside <PricingCards />, per §5.3.
export default async function MarketingHomePage() {
  const locale = await getLocale()
  const t = await getTranslations('marketing.pricing')

  return (
    <>
      <Hero />
      <TheGap />
      <HowItWorks />
      <WhatYouGet />
      <WhereWeStand />
      <Section id="pricing" className="scroll-mt-16 border-t">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {t('heading')}
            </h2>
            <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
              {t('subhead')}
            </p>
          </div>
          <div className="mt-14">
            <PricingCards />
          </div>
          <p className="mt-8 text-center">
            <Link
              href={`/${locale}/pricing`}
              className="text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('see_all')}
            </Link>
          </p>
        </div>
      </Section>
      <FinalCta />
    </>
  )
}
