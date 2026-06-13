import { getTranslations } from 'next-intl/server'
import { Section, StaggerItem } from '@/components/marketing/Section'

const FEATURES = ['voice', 'campaigns', 'native', 'approval', 'analytics', 'languages'] as const

type Feature = (typeof FEATURES)[number]

function FeatureIcon({ feature }: { feature: Feature }) {
  const icons: Record<Feature, React.ReactNode> = {
    voice: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8" />
      </svg>
    ),
    campaigns: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    native: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
    approval: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    analytics: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
    languages: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  }
  return <div className="mb-4 size-10 text-brand">{icons[feature]}</div>
}

/**
 * What You Get (ADR 0009 §4.1 row 4) — the "more than a scheduler" proof.
 * Borderless tiles (TheGap already carries the card treatment).
 */
export default async function WhatYouGet() {
  const t = await getTranslations('marketing.features')

  return (
    <Section id="features" className="scroll-mt-16 border-t">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="max-w-3xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t('heading')}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">{t('subhead')}</p>
        </div>
        <div className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <StaggerItem key={feature} index={i}>
              <FeatureIcon feature={feature} />
              <h3 className="font-semibold">{t(`${feature}_title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t(`${feature}_body`)}
              </p>
            </StaggerItem>
          ))}
        </div>
      </div>
    </Section>
  )
}
