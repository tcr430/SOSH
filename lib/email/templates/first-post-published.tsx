import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

export const FirstPostPublishedPropsSchema = z.object({
  businessName: z.string().min(1),
  platform: z.enum(['LinkedIn', 'X', 'Instagram', 'Facebook', 'Threads']),
  postUrl: z.string().url(),
})
export type FirstPostPublishedProps = z.infer<typeof FirstPostPublishedPropsSchema>

export function firstPostPublishedSubject(t: TranslatorFn, _props?: FirstPostPublishedProps): string {
  return t('first_post_published.subject')
}

export function FirstPostPublishedEmail(
  props: FirstPostPublishedProps & { locale: EmailLocale; t: TranslatorFn },
) {
  const { locale, t, businessName, platform, postUrl } = props
  return (
    <EmailLayout locale={locale} preheader={t('first_post_published.preheader', { platform })}>
      <Heading
        style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}
      >
        {t('first_post_published.heading', { platform })}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>
        {t('first_post_published.lead', { platform, businessName })}
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 28px 0' }}>
        {t('first_post_published.supporting')}
      </Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={postUrl} style={emailCtaStyle}>
          {t('first_post_published.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
