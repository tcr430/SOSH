import { getTranslations } from 'next-intl/server'
import { Section, StaggerItem } from '@/components/marketing/Section'

const FEATURES = ['voice', 'campaigns', 'native', 'approval', 'analytics', 'languages'] as const

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
