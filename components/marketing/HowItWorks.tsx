import { getTranslations } from 'next-intl/server'
import { Section, StaggerItem } from '@/components/marketing/Section'

const STEPS = ['1', '2', '3', '4'] as const

/**
 * How It Works (ADR 0009 §4.1 row 3) — four steps, founder in control.
 * Steps stagger in sequence (§8); the order is real, so the numbers
 * (carried in the locked step titles) earn their place.
 */
export default async function HowItWorks() {
  const t = await getTranslations('marketing.how')

  return (
    <Section id="how" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="max-w-3xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {t('heading')}
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">{t('subhead')}</p>
        </div>
        <ol className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step}>
              <StaggerItem index={i}>
                <h3 className="text-lg font-semibold tracking-tight">{t(`step${step}_title`)}</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{t(`step${step}_body`)}</p>
              </StaggerItem>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
