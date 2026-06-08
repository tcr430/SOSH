import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

export const PaymentFailedCourtesyPropsSchema = z.object({
  businessName: z.string().min(1),
  billingPortalUrl: z.string().url(),
})
export type PaymentFailedCourtesyProps = z.infer<typeof PaymentFailedCourtesyPropsSchema>

export function paymentFailedCourtesySubject(t: TranslatorFn, _props?: PaymentFailedCourtesyProps): string {
  return t('payment_failed_courtesy.subject')
}

export function PaymentFailedCourtesyEmail(
  props: PaymentFailedCourtesyProps & { locale: EmailLocale; t: TranslatorFn },
) {
  const { locale, t, businessName, billingPortalUrl } = props
  return (
    <EmailLayout locale={locale} preheader={t('payment_failed_courtesy.preheader')}>
      <Heading
        style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}
      >
        {t('payment_failed_courtesy.heading', { businessName })}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>
        {t('payment_failed_courtesy.lead')}
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 28px 0' }}>
        {t('payment_failed_courtesy.supporting')}
      </Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={billingPortalUrl} style={emailCtaStyle}>
          {t('payment_failed_courtesy.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
