import { getTranslations } from 'next-intl/server'
import { Section } from '@/components/marketing/Section'

/**
 * Where We Stand (ADR 0009 §4.1 row 5, D2) — point of view in place of
 * social proof. The pull line is emphasized via scale, not color (§13).
 */
export default async function WhereWeStand() {
  const t = await getTranslations('marketing.pov')

  return (
    <Section className="border-t bg-muted/40">
      <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
        <p className="text-sm font-medium text-muted-foreground">{t('eyebrow')}</p>
        <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t('heading')}
        </h2>
        <p className="mt-8 text-pretty leading-relaxed text-muted-foreground">{t('body')}</p>
        <p className="mt-12 border-l-2 border-brand pl-6 text-balance text-3xl font-semibold leading-snug tracking-tight sm:text-4xl">
          {t('pull')}
        </p>
      </div>
    </Section>
  )
}
