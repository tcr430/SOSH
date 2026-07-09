import { config } from '@/lib/config'
import type { EmailLocale } from '@/lib/email/types'
import { enqueueEmail, type EnqueueEmailResult } from '@/lib/email/enqueue'
import { signInviteToken } from '@/lib/members/invite-token'

export interface EnqueueTeamInviteInput {
  memberId: string
  businessId: string
  recipientEmail: string
  locale: EmailLocale
  inviterName: string
  businessName: string
  roleLabelKey: string
}

export async function enqueueTeamInvite(
  input: EnqueueTeamInviteInput,
): Promise<EnqueueEmailResult> {
  const { memberId, businessId, recipientEmail, locale, inviterName, businessName, roleLabelKey } =
    input

  const token = await signInviteToken({ memberId, businessId })
  const acceptUrl = `${config.server.APP_URL}/${locale}/invite/accept?token=${token}`
  const issuedAtEpoch = Date.now()

  return enqueueEmail({
    business_id: businessId,
    kind: 'team-invite',
    recipient: recipientEmail,
    locale,
    props: {
      inviterName,
      businessName,
      roleLabelKey,
      acceptUrl,
    },
    dedupe_token: `invite:${memberId}:${issuedAtEpoch}`,
  })
}
