import { getInvitePreview } from '@/lib/members/invite-preview'
import { AcceptClient } from './AcceptClient'
import { InvalidInviteCard } from './InvalidInviteCard'

export default async function InviteAcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string; code?: string }>
}) {
  const { locale } = await params
  const { token, code } = await searchParams

  const preview = token ? await getInvitePreview(token) : null

  if (!token || !preview) {
    return <InvalidInviteCard locale={locale} />
  }

  return (
    <AcceptClient
      preview={preview}
      token={token}
      code={code}
      locale={locale}
    />
  )
}
