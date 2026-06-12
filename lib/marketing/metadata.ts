import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { config } from '@/lib/config'

const LOCALES = ['en', 'pt', 'es'] as const

export type MarketingRoute = 'home' | 'pricing' | 'terms' | 'privacy'

const ROUTE_PATHS: Record<MarketingRoute, string> = {
  home: '',
  pricing: '/pricing',
  terms: '/terms',
  privacy: '/privacy',
}

/** §6.10 defines descriptions for home/pricing only; terms/privacy are title-only. */
const HAS_DESCRIPTION: Record<MarketingRoute, boolean> = {
  home: true,
  pricing: true,
  terms: false,
  privacy: false,
}

/**
 * Per-route marketing metadata (ADR 0009 §9): title/description from
 * marketing.meta.*, OG image via the runtime /og route with the locked
 * §6.14 line as alt text (§13), twitter card, self-canonical + hreflang
 * alternates with x-default → /en.
 */
export async function marketingMetadata(
  locale: string,
  route: MarketingRoute,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'marketing' })
  const path = ROUTE_PATHS[route]
  const title = t(`meta.${route}_title`)
  const description = HAS_DESCRIPTION[route] ? t(`meta.${route}_description`) : undefined
  const ogAlt = t(`og.${route}`)
  const languages = Object.fromEntries(LOCALES.map((l) => [l, `/${l}${path}`]))

  return {
    metadataBase: new URL(config.public.APP_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      locale,
      url: `/${locale}${path}`,
      images: [
        {
          url: `/${locale}/og?route=${route}`,
          width: 1200,
          height: 630,
          alt: ogAlt,
        },
      ],
    },
    twitter: { card: 'summary_large_image' },
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { ...languages, 'x-default': `/en${path}` },
    },
  }
}
