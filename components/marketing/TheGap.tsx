import { getTranslations } from 'next-intl/server'
import { Users, BellOff, LayoutGrid, type LucideIcon } from 'lucide-react'
import { Section, StaggerItem } from '@/components/marketing/Section'

const CARDS = ['team', 'quiet', 'generic'] as const

type Card = (typeof CARDS)[number]

const CARD_ICONS: Record<Card, LucideIcon> = {
  team: Users,
  quiet: BellOff,
  generic: LayoutGrid,
}

function CardIcon({ card }: { card: Card }) {
  const Icon = CARD_ICONS[card]
  return (
    <div className="flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-5" />
    </div>
  )
}

/** The Gap (ADR 0009 §4.1 row 2) — the villain: obscurity. */
export default async function TheGap() {
  const t = await getTranslations('marketing.gap')

  return (
    <Section id="gap" className="mesh-glow border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="max-w-3xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t('heading')}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">{t('subhead')}</p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <StaggerItem key={card} index={i}>
              <div className="glass-shell h-full">
                <div className="glass-core h-full p-6">
                  <CardIcon card={card} />
                  <h3 className="mt-4 font-semibold">{t(`card_${card}_title`)}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(`card_${card}_body`)}
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
