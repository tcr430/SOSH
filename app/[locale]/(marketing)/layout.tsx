import { getTranslations } from 'next-intl/server'
import MarketingHeader from '@/components/marketing/MarketingHeader'
import MarketingFooter from '@/components/marketing/MarketingFooter'

// Reduced motion is honored once, in CSS (globals.css wraps all marketing
// motion in prefers-reduced-motion: no-preference) — ADR 0009 §8 Amendment A1
// replaced the MotionConfig client boundary.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('marketing')
  return (
    <>
      {/* ADR 0009 §3.2/§13: first focusable element targets #main. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        {t('accessibility.skip_to_content')}
      </a>
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
    </>
  )
}
