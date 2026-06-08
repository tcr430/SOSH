import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

export const WelcomeToPlanPropsSchema = z.object({
  businessName: z.string().min(1),
  planName: z.enum(['Plus', 'Pro']),
  dashboardUrl: z.string().url(),
})
export type WelcomeToPlanProps = z.infer<typeof WelcomeToPlanPropsSchema>

export function welcomeToPlanSubject(t: TranslatorFn, props: WelcomeToPlanProps): string {
  return t('welcome_to_plan.subject', { planName: props.planName })
}

export function WelcomeToPlanEmail(
  props: WelcomeToPlanProps & { locale: EmailLocale; t: TranslatorFn },
) {
  const { locale, t, businessName, planName, dashboardUrl } = props
  return (
    <EmailLayout locale={locale} preheader={t('welcome_to_plan.preheader')}>
      <Heading
        style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}
      >
        {t('welcome_to_plan.heading', { businessName, planName })}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>
        {t('welcome_to_plan.lead')}
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 28px 0' }}>
        {t('welcome_to_plan.supporting')}
      </Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={dashboardUrl} style={emailCtaStyle}>
          {t('welcome_to_plan.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
