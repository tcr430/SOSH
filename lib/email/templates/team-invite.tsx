import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

export const TeamInvitePropsSchema = z.object({
  inviterName: z.string().min(1),
  businessName: z.string().min(1),
  roleLabelKey: z.string().min(1),
  acceptUrl: z.string().url(),
})
export type TeamInviteProps = z.infer<typeof TeamInvitePropsSchema>

export function teamInviteSubject(t: TranslatorFn, props?: TeamInviteProps): string {
  return t('team_invite.subject', { businessName: props?.businessName ?? '' })
}

export function TeamInviteEmail(
  props: TeamInviteProps & { locale: EmailLocale; t: TranslatorFn },
) {
  const { locale, t, inviterName, businessName, roleLabelKey, acceptUrl } = props
  const roleLabel = t(roleLabelKey)
  return (
    <EmailLayout locale={locale} preheader={t('team_invite.preheader', { businessName })}>
      <Heading
        style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}
      >
        {t('team_invite.heading', { businessName })}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>
        {t('team_invite.lead', { inviterName, businessName, roleLabel })}
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 28px 0' }}>
        {t('team_invite.supporting')}
      </Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={acceptUrl} style={emailCtaStyle}>
          {t('team_invite.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
