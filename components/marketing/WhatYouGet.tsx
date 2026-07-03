import { getTranslations } from 'next-intl/server'
import { Mic, Flag, Share2, ShieldCheck, BarChart3, Globe, type LucideIcon } from 'lucide-react'
import { Section, StaggerItem } from '@/components/marketing/Section'

const FEATURES = ['voice', 'campaigns', 'native', 'approval', 'analytics', 'languages'] as const

type Feature = (typeof FEATURES)[number]

const FEATURE_ICONS: Record<Feature, LucideIcon> = {
  voice: Mic,
  campaigns: Flag,
  native: Share2,
  approval: ShieldCheck,
  analytics: BarChart3,
  languages: Globe,
}

function FeatureIcon({ feature }: { feature: Feature }) {
  const Icon = FEATURE_ICONS[feature]
  return (
    <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-brand/10 text-brand">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-5" />
    </div>
  )
}

/**
 * What You Get (ADR 0009 §4.1 row 4) — the "more than a scheduler" proof.
 * Borderless tiles (TheGap already carries the card treatment). Uniform
 * 3-col / 2-row grid — 6 items, no spanning tile, so no empty cells.
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
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <StaggerItem key={feature} index={i}>
              <div className="glass-shell h-full">
                <div className="glass-core h-full p-6">
                  <FeatureIcon feature={feature} />
                  <h3 className="font-semibold">{t(`${feature}_title`)}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(`${feature}_body`)}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </div>
      </div>
    </Section>
  )
}
