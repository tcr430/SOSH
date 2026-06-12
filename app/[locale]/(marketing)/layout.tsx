import MotionProviders from '@/components/marketing/MotionProviders'
import MarketingHeader from '@/components/marketing/MarketingHeader'
import MarketingFooter from '@/components/marketing/MarketingFooter'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionProviders>
      {/* ADR 0009 §3.2/§13: first focusable element targets #main. The label is
          hardcoded per the ADR snippet — §6 defines no i18n key for it (Reviewer finding). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
    </MotionProviders>
  )
}
