import { getTranslations } from 'next-intl/server'
import { Section } from '@/components/marketing/Section'

/**
 * Where We Stand (ADR 0009 §4.1 row 5, D2) — point of view in place of
 * social proof. The pull line is emphasized via scale, not color (§13).
 */
export default async function WhereWeStand() {
  const t = await getTranslations('marketing.pov')

  return (
    <Section className="mesh-glow border-t bg-muted/30">
      <div className="mx-auto max-w-3xl px-6 py-24 sm:py-32">
        <p className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase w-fit backdrop-blur-sm">
          {t('eyebrow')}
        </p>
        <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t('heading')}
        </h2>
        <p className="mt-8 text-pretty leading-relaxed text-muted-foreground">{t('body')}</p>
        <div className="glass-shell mt-12">
          <p className="glass-core border-l-2 border-brand p-8 text-balance text-3xl font-semibold leading-snug tracking-tight sm:text-4xl">
            {t('pull')}
          </p>
        </div>
      </div>
    </Section>
  )
}
