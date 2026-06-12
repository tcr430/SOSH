import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import PricingCards from '@/components/marketing/PricingCards'
import PricingFaq from '@/components/marketing/PricingFaq'
import { marketingMetadata } from '@/lib/marketing/metadata'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return marketingMetadata(locale, 'pricing')
}

// `/pricing` composition (ADR 0009 §4.2): compact hero → shared cards → FAQ.
// No second nav, no duplicated homepage sections.
export default async function PricingPage() {
  const t = await getTranslations('marketing.pricingPage')

  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-4 pt-20 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t('subtitle')}</p>
      </section>
      <section className="px-6 py-12">
        <PricingCards />
      </section>
      <PricingFaq />
    </>
  )
}
