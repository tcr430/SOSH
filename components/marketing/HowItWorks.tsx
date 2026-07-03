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
        <ol className="mt-14 grid gap-x-8 gap-y-8 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step}>
              <StaggerItem index={i}>
                <div className="glass-shell h-full">
                  <div className="glass-core flex h-full items-start gap-4 p-6">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
                      {step}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight">
                        {t(`step${step}_title`)}
                      </h3>
                      <p className="mt-2 leading-relaxed text-muted-foreground">
                        {t(`step${step}_body`)}
                      </p>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
