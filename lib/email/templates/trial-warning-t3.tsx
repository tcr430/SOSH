import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

export const TrialWarningT3PropsSchema = z.object({
  businessName: z.string().min(1),
  daysRemaining: z.literal(3),
  expiryDateIso: z.string().datetime(),
  upgradeUrl: z.string().url(),
})
export type TrialWarningT3Props = z.infer<typeof TrialWarningT3PropsSchema>

export function trialWarningT3Subject(t: TranslatorFn, _props?: TrialWarningT3Props): string {
  return t('trial_warning_t3.subject')
}

export function TrialWarningT3Email(
  props: TrialWarningT3Props & { locale: EmailLocale; t: TranslatorFn },
) {
  const { locale, t, businessName, daysRemaining, expiryDateIso, upgradeUrl } = props
  const formattedExpiry = new Intl.DateTimeFormat(locale === 'pt' ? 'pt-PT' : locale, {
    dateStyle: 'long',
  }).format(new Date(expiryDateIso))
  return (
    <EmailLayout locale={locale} preheader={t('trial_warning_t3.preheader')}>
      <Heading
        style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}
      >
        {t('trial_warning_t3.heading', { businessName })}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>
        {t('trial_warning_t3.lead', { days: daysRemaining, date: formattedExpiry })}
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 28px 0' }}>
        {t('trial_warning_t3.supporting')}
      </Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={upgradeUrl} style={emailCtaStyle}>
          {t('trial_warning_t3.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
