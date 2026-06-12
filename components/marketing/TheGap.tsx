import { getTranslations } from 'next-intl/server'
import { Section } from '@/components/marketing/Section'

const CARDS = ['team', 'quiet', 'generic'] as const

/** The Gap (ADR 0009 §4.1 row 2) — the villain: obscurity. */
export default async function TheGap() {
  const t = await getTranslations('marketing.gap')

  return (
    <Section id="gap" className="border-t bg-muted/40">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="max-w-3xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t('heading')}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">{t('subhead')}</p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {CARDS.map((card) => (
            <div key={card} className="rounded-2xl border bg-card p-6">
              <h3 className="font-semibold">{t(`card_${card}_title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t(`card_${card}_body`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
