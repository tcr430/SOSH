import { getInvitePreview } from '@/lib/members/invite-preview'
import { SignupForm, type SignupInvite } from './SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  let invite: SignupInvite | null = null
  if (token) {
    const preview = await getInvitePreview(token)
    if (preview) {
      invite = { token, email: preview.email, businessName: preview.businessName }
    }
  }

  return <SignupForm invite={invite} />
}
