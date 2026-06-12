import type { MetadataRoute } from 'next'
import { config } from '@/lib/config'

const LOCALES = ['en', 'pt', 'es'] as const

// ADR 0009 §16: all marketing routes across en/pt/es. Root-level sitemap
// (not app/[locale]/) so it serves at /sitemap.xml where robots.txt and
// crawlers expect it — flagged deviation from the ADR §3.1 path.
const ROUTES = [
  { path: '', priority: 1.0, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  // APP_URL may carry a trailing slash; strip it before path concatenation.
  const base = config.public.APP_URL.replace(/\/+$/, '')
  return ROUTES.flatMap((route) =>
    LOCALES.map((locale) => ({
      url: `${base}/${locale}${route.path}`,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((l) => [l, `${base}/${l}${route.path}`]),
        ),
      },
    })),
  )
}
